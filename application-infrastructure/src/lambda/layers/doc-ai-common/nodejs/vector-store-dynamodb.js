'use strict';

/**
 * DynamoDbVectorStore — the DynamoDB-backed concrete {@link VectorStore}. It reuses
 * the existing DocIndex table (no new table, no GSI) to store documentation
 * embeddings and answers nearest-neighbour queries by computing cosine similarity
 * in-Lambda over a version's loaded vector set.
 *
 * This module is loaded lazily by the {@link module:vector-store createVectorStore}
 * factory when `vectorStore === 'dynamodb'`. Callers should obtain the store through
 * that factory rather than requiring this module directly.
 *
 * Why in-Lambda cosine (rather than a DynamoDB-side operation)? DynamoDB has no
 * vector/similarity capability, and the DocIndex table is pk/sk only (no GSI to
 * enumerate a version). So the store keeps an explicit per-version manifest of the
 * vector hashes, BatchGets those vectors, decodes them, and ranks them in memory.
 *
 * Data model (all items live in the DocIndex table, `config.dynamodb.tableName`):
 *   - Vector item:
 *       pk = `vector:{hash}`, sk = `v:{version}`
 *       attributes: `{ version, vector, dims, model, embeddingInputHash, type,
 *                       subType, repository, owner, ttl }`
 *       `vector` is the embedding encoded as a base64 string of its Float32 bytes
 *       (compact: 1024 dims ≈ 4KB raw → ≈ 5.5KB base64, well under the 400KB item cap).
 *   - Version manifest (lets `query`/`deleteVersion` enumerate a version WITHOUT a Scan):
 *       meta item:   pk = `vectormanifest:{version}`, sk = `meta`
 *                    attributes: `{ version, count, model, dimensions, totalChunks, ttl }`
 *       hash chunks: pk = `vectormanifest:{version}`, sk = `hashes:{i}`
 *                    attributes: `{ version, hashes: string[], chunkIndex, ttl }`
 *       The hash list is chunked ({@link MANIFEST_HASH_CHUNK_SIZE} per item) to stay
 *       under the 400KB item limit, mirroring the existing chunked main-index pattern.
 *
 * Warm cache: a module-level {@link Map} caches each loaded+decoded vector set keyed by
 * `{tableName}#{version}` so repeated queries in a warm Lambda reuse the loaded vectors
 * instead of re-reading DynamoDB (Requirement 7 cost/warm reuse). At most one version
 * per table is retained (loading a new version evicts the previous one) to bound memory;
 * {@link clearVectorCache} resets it (used by tests).
 *
 * TTL: every written item carries a `ttl` of now + 7 days ({@link SEVEN_DAYS_SECONDS}),
 * mirroring the indexer's 7-day previous-version cleanup so superseded vectors expire.
 *
 * Security:
 *   - AWS SDK v3 is provided by the Lambda runtime and required normally; this layer
 *     bundles no production dependencies (see AGENTS.md). // >!
 *   - No region or credentials are hardcoded: the client resolves the region from the
 *     Lambda environment (`AWS_REGION`) via the SDK default provider chain. // >!
 *   - Stored metadata and vectors are treated as untrusted data: the base64 decode is
 *     bounded by `dims` so a corrupt/oversized stored value cannot allocate unbounded
 *     memory, and filters are applied by strict equality (no dynamic code). // >!
 *   - Vector contents are never logged; errors reference versions/counts, not values. // >!
 *
 * @module vector-store-dynamodb
 * @example
 * // Obtain via the factory (intended entry point):
 * const { createVectorStore } = require('/opt/nodejs/vector-store');
 * const store = createVectorStore({
 *   vectorStore: 'dynamodb',
 *   dimensions: 1024,
 *   dynamodb: { tableName: process.env.DOC_INDEX_TABLE }
 * });
 *
 * await store.upsertVectors('v3', [
 *   { hash: 'abc123', vector: [0.1, 0.2, 0.3], metadata: { type: 'guide', subType: 'howto', repository: 'core', owner: '63klabs', embeddingInputHash: 'h1' } }
 * ]);
 *
 * const hits = await store.query(queryVector, { version: 'v3', filters: { type: 'guide' }, topK: 10 });
 * // hits === [{ hash, score, metadata }, ...] ordered by descending cosine similarity
 */

// >! AWS SDK v3 is provided by the Lambda runtime; require it normally (do NOT bundle).
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  BatchGetCommand,
  GetCommand
} = require('@aws-sdk/lib-dynamodb');

const { VectorStore, VectorStoreError } = require('./vector-store');

/**
 * Maximum items per DynamoDB BatchWriteItem request.
 * @constant {number}
 */
const BATCH_LIMIT = 25;

/**
 * Maximum keys per DynamoDB BatchGetItem request.
 * @constant {number}
 */
const BATCH_GET_LIMIT = 100;

/**
 * Seven days in seconds, used for TTL calculation (mirrors the indexer's cleanup window).
 * @constant {number}
 */
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

/**
 * Maximum number of vector hashes stored per manifest chunk item. Each hash is a short
 * hex string (~16-64 bytes); 500 per chunk keeps each item well under the 400KB limit,
 * mirroring the existing main-index chunking approach.
 * @constant {number}
 */
const MANIFEST_HASH_CHUNK_SIZE = 500;

/**
 * Default number of results returned by {@link DynamoDbVectorStore#query} when the
 * caller does not supply a valid positive `topK`.
 * @constant {number}
 */
const DEFAULT_TOP_K = 10;

/**
 * Safety cap on BatchGet UnprocessedKeys retries, so a pathological response cannot
 * loop forever. Partial results (degraded) are preferable to an unbounded loop.
 * @constant {number}
 */
const MAX_BATCH_GET_ATTEMPTS = 10;

/** DynamoDB partition-key prefix for a stored vector item. */
const VECTOR_PK_PREFIX = 'vector:';
/** DynamoDB sort-key prefix for a stored vector item (`v:{version}`). */
const VECTOR_SK_PREFIX = 'v:';
/** DynamoDB partition-key prefix for a version manifest (`vectormanifest:{version}`). */
const MANIFEST_PK_PREFIX = 'vectormanifest:';
/** DynamoDB sort key for the manifest meta item. */
const MANIFEST_META_SK = 'meta';
/** DynamoDB sort-key prefix for a manifest hash-list chunk (`hashes:{i}`). */
const MANIFEST_HASHES_SK_PREFIX = 'hashes:';

/**
 * Lazily initialized DynamoDB Document Client shared by the module.
 * @type {?DynamoDBDocumentClient}
 */
let docClient = null;

/**
 * Module-level warm cache of loaded+decoded vector sets, keyed by `{tableName}#{version}`.
 * Persists across invocations in a warm Lambda container so repeated queries reuse the
 * loaded vectors instead of re-reading DynamoDB.
 * @type {Map<string, Array<{hash: string, vector: number[], metadata: Object}>>}
 */
const vectorCache = new Map();

/**
 * Get or create the shared DynamoDB Document Client singleton. Constructed on first use
 * (never at module load) so merely attaching the layer costs nothing.
 *
 * @returns {DynamoDBDocumentClient} The shared document client.
 * @example
 * const client = getDocClient();
 * await client.send(command);
 */
function getDocClient() {
  if (!docClient) {
    // >! The SDK default provider chain resolves the region from the Lambda
    // >! environment (AWS_REGION); do not hardcode a region or credentials.
    const client = new DynamoDBClient({});
    docClient = DynamoDBDocumentClient.from(client, {
      // >! removeUndefinedValues lets us set optional metadata attributes without
      // >! guarding each one; undefined attributes are simply omitted from the item.
      marshallOptions: { removeUndefinedValues: true }
    });
  }
  return docClient;
}

/**
 * Override the shared DynamoDB Document Client (test seam).
 *
 * @param {?DynamoDBDocumentClient} client - Client instance, or `null` to reset the singleton.
 * @returns {void}
 * @example
 * setDocClient(mockDocumentClient); // inject a mock in tests
 * setDocClient(null);               // reset afterwards
 */
function setDocClient(client) {
  docClient = client;
}

/**
 * Clears the module-level warm vector cache. Intended for test isolation so cached
 * vectors from one test do not leak into another.
 *
 * @returns {void}
 * @example
 * afterEach(() => clearVectorCache());
 */
function clearVectorCache() {
  vectorCache.clear();
}

/**
 * Compute a TTL timestamp approximately 7 days from now.
 *
 * @returns {number} Unix timestamp in seconds ({@link SEVEN_DAYS_SECONDS} in the future).
 * @example
 * const ttl = computeTtl(); // e.g. 1731801600
 */
function computeTtl() {
  return Math.floor(Date.now() / 1000) + SEVEN_DAYS_SECONDS;
}

/**
 * Split an array into chunks of at most `size` elements.
 *
 * @param {Array<*>} items - Array to split.
 * @param {number} size - Maximum chunk size (must be a positive integer).
 * @returns {Array<Array<*>>} Array of chunks (empty when `items` is empty).
 * @example
 * chunk([1, 2, 3], 2); // [[1, 2], [3]]
 */
function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Deduplicate DynamoDB items/keys by their `pk`+`sk` composite key, keeping the last
 * occurrence. Used before BatchWrite/BatchDelete because DynamoDB rejects a batch that
 * contains two requests for the same key.
 *
 * @param {Array<{pk: string, sk: string}>} items - Items or keys with `pk` and `sk`.
 * @returns {Array<{pk: string, sk: string}>} Deduplicated array (last write wins).
 * @example
 * deduplicateItems([{ pk: 'a', sk: '1' }, { pk: 'a', sk: '1' }]); // one item
 */
function deduplicateItems(items) {
  const seen = new Map();
  for (const item of items) {
    seen.set(`${item.pk}#${item.sk}`, item);
  }
  return Array.from(seen.values());
}

/**
 * Encode an embedding vector as a base64 string of its little-endian Float32 bytes.
 * This is the on-DynamoDB representation of a vector: compact and safely under the
 * 400KB item limit (a 1024-dim vector is ~4KB raw, ~5.5KB base64).
 *
 * @param {number[]} vector - Non-empty array of finite numbers (the embedding).
 * @returns {string} Base64 string of the Float32 little-endian byte representation.
 * @throws {VectorStoreError} `INVALID_VECTOR` when `vector` is not a non-empty array of finite numbers.
 * @example
 * const encoded = encodeVector([0.1, 0.2, 0.3]);
 * const decoded = decodeVector(encoded, 3); // ≈ [0.1, 0.2, 0.3] (Float32 precision)
 */
function encodeVector(vector) {
  // >! Validate untrusted input before allocating/writing bytes.
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new VectorStoreError('encodeVector requires a non-empty array of numbers.', {
      code: 'INVALID_VECTOR'
    });
  }
  const buffer = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new VectorStoreError('encodeVector requires all elements to be finite numbers.', {
        code: 'INVALID_VECTOR'
      });
    }
    // >! Explicit little-endian encoding; decodeVector reads with readFloatLE so the
    // >! representation is stable regardless of host byte order.
    buffer.writeFloatLE(value, i * 4);
  }
  return buffer.toString('base64');
}

/**
 * Decode a base64-encoded Float32 vector (produced by {@link encodeVector}) back into a
 * number array. The number of decoded floats is bounded by `dims` (and by the available
 * byte length) so a corrupt or oversized stored value cannot allocate unbounded memory.
 *
 * @param {string} base64 - Base64 string of little-endian Float32 bytes.
 * @param {number} [dims] - Expected vector length; caps the number of decoded floats. When omitted or invalid, all available floats are decoded.
 * @returns {number[]} The decoded embedding vector.
 * @throws {VectorStoreError} `INVALID_VECTOR` when `base64` is not a string.
 * @example
 * const vector = decodeVector('AAAAPwAAAD8=', 2); // two floats
 */
function decodeVector(base64, dims) {
  if (typeof base64 !== 'string') {
    throw new VectorStoreError('decodeVector requires a base64 string.', {
      code: 'INVALID_VECTOR'
    });
  }
  const buffer = Buffer.from(base64, 'base64');
  const availableFloats = Math.floor(buffer.length / 4);
  // >! Bound the decode by dims (when provided) AND by the actual byte length, so a
  // >! malformed/oversized stored value never drives an out-of-range read.
  const count = (Number.isInteger(dims) && dims > 0)
    ? Math.min(dims, availableFloats)
    : availableFloats;
  const vector = new Array(count);
  for (let i = 0; i < count; i++) {
    vector[i] = buffer.readFloatLE(i * 4);
  }
  return vector;
}

/**
 * Compute the cosine similarity between two equal-length numeric vectors. Returns a
 * value in `[-1, 1]` where higher means more similar. Degenerate inputs (mismatched
 * lengths, empty vectors, or a zero-norm vector) return `0` rather than throwing or
 * producing `NaN`, so ranking stays well-defined.
 *
 * Titan V2 vectors are normalized (so cosine ≈ dot product), but this computes true
 * cosine for correctness regardless of normalization.
 *
 * @param {number[]} a - First vector.
 * @param {number[]} b - Second vector (same length as `a`).
 * @returns {number} Cosine similarity in `[-1, 1]`; `0` for degenerate/mismatched inputs.
 * @example
 * cosineSimilarity([1, 0], [1, 0]); // 1
 * cosineSimilarity([1, 0], [0, 1]); // 0
 * cosineSimilarity([1, 0], [-1, 0]); // -1
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    // >! Guard degenerate/mismatched inputs: return 0 instead of throwing or NaN.
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) {
    // >! Avoid divide-by-zero for a zero/degenerate vector.
    return 0;
  }
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  // >! Clamp to [-1, 1] so floating-point error cannot push the score slightly out of
  // >! range; the value is still true cosine, only numerically guarded.
  if (similarity > 1) {
    return 1;
  }
  if (similarity < -1) {
    return -1;
  }
  return similarity;
}

/**
 * Build the module-level warm-cache key for a `(tableName, version)` pair.
 *
 * @private
 * @param {string} tableName - The DocIndex table name.
 * @param {string} version - The index version.
 * @returns {string} Cache key of the form `{tableName}#{version}`.
 */
function cacheKeyFor(tableName, version) {
  return `${tableName}#${version}`;
}

/**
 * DynamoDB-backed vector store. Extends {@link VectorStore} and implements the full
 * contract (`upsertVectors`, `query`, `deleteVersion`) against the DocIndex table.
 *
 * @augments VectorStore
 * @example
 * // Created via the factory rather than directly:
 * const store = createVectorStore({
 *   vectorStore: 'dynamodb',
 *   dimensions: 1024,
 *   dynamodb: { tableName: process.env.DOC_INDEX_TABLE }
 * });
 */
class DynamoDbVectorStore extends VectorStore {
  /**
   * Per-instance injected client (test seam). Takes precedence over the module-level
   * {@link getDocClient} singleton when set; `null` otherwise.
   *
   * @private
   * @type {?DynamoDBDocumentClient}
   */
  #injectedClient;

  /**
   * Creates a new DynamoDbVectorStore.
   *
   * @param {Object} config - Store configuration (typically the `documentation.ai`-derived config passed by the factory).
   * @param {Object} config.dynamodb - DynamoDB options.
   * @param {string} config.dynamodb.tableName - The DocIndex table name (`DOC_INDEX_TABLE`). Required; the store cannot function without it.
   * @param {number} [config.dimensions] - Embedding vector length; used as the manifest `dimensions` and to bound vector decoding.
   * @param {DynamoDBDocumentClient} [config.client] - Optional pre-constructed document client (test injection); takes precedence over the module singleton.
   * @throws {VectorStoreError} `INVALID_CONFIG` when `config.dynamodb.tableName` is missing or not a non-empty string.
   */
  constructor(config) {
    super();
    const tableName = config && config.dynamodb ? config.dynamodb.tableName : undefined;
    // >! Fail fast in the constructor: the store cannot operate without a table name.
    if (typeof tableName !== 'string' || tableName.trim().length === 0) {
      throw new VectorStoreError(
        'DynamoDbVectorStore requires config.dynamodb.tableName.',
        { code: 'INVALID_CONFIG' }
      );
    }
    this.tableName = tableName;
    this.dimensions = (config && Number.isInteger(config.dimensions) && config.dimensions > 0)
      ? config.dimensions
      : undefined;
    this.#injectedClient = (config && config.client) || null;
  }

  /**
   * Writes (or overwrites) the vectors for an index `version` and records a version
   * manifest so the version can later be enumerated without a table Scan.
   *
   * Each item's vector is base64-encoded, the metadata fields are copied onto the item,
   * and a `ttl` is set. Vector items are written via BatchWrite (deduplicated by key and
   * chunked at {@link BATCH_LIMIT}); then the manifest hash chunks and meta item are
   * written (chunks first, meta last, so a reader never sees a meta pointing at missing
   * chunks).
   *
   * @async
   * @param {string} version - The index version these vectors belong to (e.g. `'v3'`).
   * @param {Array.<{hash: string, vector: number[], metadata: Object}>} items - Vectors to store. `metadata` may include `{ type, subType, repository, owner, embeddingInputHash, model, dims }`.
   * @returns {Promise<void>} Resolves when all vector items and the manifest are persisted.
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when `version`/`items` are malformed, `INVALID_VECTOR` when a vector is not numeric, or `UPSERT_FAILED` (with `cause`) when a DynamoDB write fails.
   * @example
   * await store.upsertVectors('v3', [
   *   { hash: 'abc', vector: [0.1, 0.2], metadata: { type: 'guide', subType: 'howto', repository: 'core', owner: '63klabs', embeddingInputHash: 'h1', model: 'amazon.titan-embed-text-v2:0' } }
   * ]);
   */
  async upsertVectors(version, items) {
    this.#assertVersion(version);
    if (!Array.isArray(items)) {
      throw new VectorStoreError('upsertVectors requires an array of items.', {
        code: 'INVALID_ARGUMENT'
      });
    }

    // Build items and validate BEFORE any AWS call so validation errors surface as-is
    // (INVALID_ARGUMENT / INVALID_VECTOR) rather than being wrapped as UPSERT_FAILED.
    const ttl = computeTtl();
    const vectorItems = [];
    const hashes = [];
    for (const item of items) {
      vectorItems.push(this.#buildVectorItem(item, version, ttl));
      hashes.push(item.hash);
    }
    const uniqueHashes = Array.from(new Set(hashes));
    const model = this.#resolveModel(items);
    const dimensions = this.#resolveDimensions(items);

    try {
      await this.#batchWrite(vectorItems);
      await this.#writeManifest(version, uniqueHashes, { model, dimensions, ttl });
      // >! Invalidate any stale warm-cache entry for this version so a subsequent query
      // >! reloads the freshly written vectors rather than serving pre-upsert data.
      this.#dropCache(version);
    } catch (error) {
      throw DynamoDbVectorStore.#wrap(error, `Failed to upsert vectors for version "${version}".`, 'UPSERT_FAILED');
    }
  }

  /**
   * Returns the top `topK` nearest neighbours for a query `embedding` from a given index
   * `version`, ordered by descending cosine similarity. The version's vectors are loaded
   * (and cached warm) from DynamoDB, optional metadata `filters` are applied by equality,
   * and each candidate is scored with {@link cosineSimilarity}.
   *
   * @async
   * @param {number[]} embedding - The query embedding vector.
   * @param {Object} options - Query options.
   * @param {string} options.version - Index version to search.
   * @param {Object} [options.filters] - Metadata equality filters (e.g. `{ type, subType }`); non-matching vectors are skipped.
   * @param {number} [options.topK=10] - Maximum number of results to return.
   * @returns {Promise<Array.<{hash: string, score: number, metadata: Object}>>} Neighbours ordered by descending similarity. Empty array when the version has no manifest/vectors.
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when `version` is missing, `INVALID_QUERY` when `embedding` is not a non-empty array, or `QUERY_FAILED` (with `cause`) when a DynamoDB read fails.
   * @example
   * const hits = await store.query(queryVector, { version: 'v3', filters: { type: 'guide' }, topK: 5 });
   * // hits[0].score is the highest cosine similarity
   */
  async query(embedding, options) {
    const opts = (options && typeof options === 'object') ? options : {};
    this.#assertVersion(opts.version);
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new VectorStoreError('query requires a non-empty embedding array.', {
        code: 'INVALID_QUERY'
      });
    }

    const topK = (Number.isInteger(opts.topK) && opts.topK > 0) ? opts.topK : DEFAULT_TOP_K;

    let loaded;
    try {
      loaded = await this.#loadVectors(opts.version);
    } catch (error) {
      throw DynamoDbVectorStore.#wrap(error, `Failed to load vectors for version "${opts.version}".`, 'QUERY_FAILED');
    }

    // No manifest / no vectors for this version -> empty result set.
    if (loaded.length === 0) {
      return [];
    }

    const filterEntries = this.#normalizeFilters(opts.filters);
    const scored = [];
    for (const entry of loaded) {
      // >! Apply metadata filters by strict equality (equivalent to keyword filtering).
      if (!DynamoDbVectorStore.#matchesFilters(entry.metadata, filterEntries)) {
        continue;
      }
      scored.push({
        hash: entry.hash,
        score: cosineSimilarity(embedding, entry.vector),
        metadata: entry.metadata
      });
    }

    // Rank by descending similarity and return the top K.
    scored.sort((left, right) => right.score - left.score);
    return scored.slice(0, topK);
  }

  /**
   * Removes all vectors for a superseded `version`: reads the manifest hash list, then
   * batch-deletes the vector items along with the manifest meta and hash-chunk items.
   * Also drops the version from the warm cache. TTL eventually cleans up any residue;
   * this provides explicit, immediate cleanup parity with the design.
   *
   * @async
   * @param {string} version - The index version to delete/clean up.
   * @returns {Promise<void>} Resolves when cleanup completes (a no-op when the version has no manifest and no vectors).
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when `version` is missing, or `DELETE_FAILED` (with `cause`) when a DynamoDB read/write fails.
   * @example
   * await store.deleteVersion('v2'); // remove the previous index version
   */
  async deleteVersion(version) {
    this.#assertVersion(version);

    try {
      const { meta, hashes } = await this.#readManifest(version);

      const keys = hashes.map((hash) => ({
        pk: `${VECTOR_PK_PREFIX}${hash}`,
        sk: `${VECTOR_SK_PREFIX}${version}`
      }));

      if (meta) {
        keys.push({ pk: `${MANIFEST_PK_PREFIX}${version}`, sk: MANIFEST_META_SK });
        const totalChunks = Number.isInteger(meta.totalChunks) ? meta.totalChunks : 0;
        for (let i = 0; i < totalChunks; i++) {
          keys.push({ pk: `${MANIFEST_PK_PREFIX}${version}`, sk: `${MANIFEST_HASHES_SK_PREFIX}${i}` });
        }
      }

      if (keys.length > 0) {
        await this.#batchDelete(keys);
      }
      this.#dropCache(version);
    } catch (error) {
      throw DynamoDbVectorStore.#wrap(error, `Failed to delete vectors for version "${version}".`, 'DELETE_FAILED');
    }
  }

  /**
   * Enumerate all stored vectors for an index `version` as `{ hash, vector, metadata }`.
   *
   * This is a thin, INDEX-TIME public wrapper over the internal loader (the same loader
   * {@link DynamoDbVectorStore#query} uses), added so the doc-indexer can read a prior
   * version's embeddings and decide, per entry, whether an embedding can be reused
   * instead of re-calling Bedrock (Requirement 6.2). It is additive: it does not change
   * the abstract {@link VectorStore} contract, and the retrieval/query path never calls
   * it. Each returned `metadata` includes `{ type, subType, repository, owner, model,
   * dims, embeddingInputHash, version }` (the reuse decision reads `embeddingInputHash`,
   * `model`, and `dims`).
   *
   * @async
   * @param {string} version - The index version to enumerate.
   * @returns {Promise<Array.<{hash: string, vector: number[], metadata: Object}>>} All decoded vectors for the version (empty array when the version has no manifest/vectors).
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when `version` is not a non-empty string, or `LOAD_FAILED` (with `cause`) when the underlying DynamoDB read fails.
   * @example
   * const priorVectors = await store.getVersionVectors('v2');
   * // [{ hash, vector, metadata: { embeddingInputHash, model, dims, ... } }, ...]
   */
  async getVersionVectors(version) {
    this.#assertVersion(version);
    try {
      return await this.#loadVectors(version);
    } catch (error) {
      throw DynamoDbVectorStore.#wrap(error, `Failed to load vectors for version "${version}".`, 'LOAD_FAILED');
    }
  }

  /**
   * Loads (and warm-caches) the decoded vector set for a version. Returns the cached set
   * on a warm hit; otherwise reads the manifest hash list, BatchGets the vector items in
   * {@link BATCH_GET_LIMIT}-sized chunks, decodes each vector, caches, and returns.
   *
   * @private
   * @async
   * @param {string} version - Index version to load.
   * @returns {Promise<Array<{hash: string, vector: number[], metadata: Object}>>} Loaded, decoded vectors (empty when the version has no manifest/hashes).
   */
  async #loadVectors(version) {
    const key = cacheKeyFor(this.tableName, version);
    const cached = vectorCache.get(key);
    if (cached) {
      return cached;
    }

    const { hashes } = await this.#readManifest(version);
    if (hashes.length === 0) {
      // Nothing to load; do not cache an empty set (re-checking the manifest is cheap).
      return [];
    }

    const rawItems = await this.#batchGetVectors(version, hashes);
    const loaded = rawItems.map((item) => ({
      hash: this.#hashFromVectorPk(item.pk),
      vector: decodeVector(item.vector, item.dims),
      metadata: {
        type: item.type,
        subType: item.subType,
        repository: item.repository,
        owner: item.owner,
        model: item.model,
        dims: item.dims,
        embeddingInputHash: item.embeddingInputHash,
        version: item.version
      }
    }));

    this.#setCache(key, loaded);
    return loaded;
  }

  /**
   * Reads a version's manifest: the meta item plus each hash-list chunk. Mirrors the
   * chunked main-index read pattern (meta item records `totalChunks`; chunks hold the
   * hash arrays).
   *
   * @private
   * @async
   * @param {string} version - Index version.
   * @returns {Promise<{meta: ?Object, hashes: string[]}>} The manifest meta item (or `null`) and the flattened hash list.
   */
  async #readManifest(version) {
    const client = this.#docClient();
    const metaResult = await client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: `${MANIFEST_PK_PREFIX}${version}`, sk: MANIFEST_META_SK }
    }));

    if (!metaResult.Item) {
      return { meta: null, hashes: [] };
    }

    const totalChunks = Number.isInteger(metaResult.Item.totalChunks) ? metaResult.Item.totalChunks : 0;
    const hashes = [];
    for (let i = 0; i < totalChunks; i++) {
      const chunkResult = await client.send(new GetCommand({
        TableName: this.tableName,
        Key: { pk: `${MANIFEST_PK_PREFIX}${version}`, sk: `${MANIFEST_HASHES_SK_PREFIX}${i}` }
      }));
      if (chunkResult.Item && Array.isArray(chunkResult.Item.hashes)) {
        hashes.push(...chunkResult.Item.hashes);
      }
    }

    return { meta: metaResult.Item, hashes };
  }

  /**
   * BatchGet the vector items for a set of hashes in {@link BATCH_GET_LIMIT}-sized chunks,
   * retrying UnprocessedKeys up to {@link MAX_BATCH_GET_ATTEMPTS} times per chunk.
   *
   * @private
   * @async
   * @param {string} version - Index version (part of the vector sort key).
   * @param {string[]} hashes - Vector hashes to fetch.
   * @returns {Promise<Array<Object>>} Raw DynamoDB vector items (unordered).
   */
  async #batchGetVectors(version, hashes) {
    const client = this.#docClient();
    const uniqueHashes = Array.from(new Set(hashes));
    const items = [];

    for (const keyChunk of chunk(uniqueHashes, BATCH_GET_LIMIT)) {
      let requestKeys = keyChunk.map((hash) => ({
        pk: `${VECTOR_PK_PREFIX}${hash}`,
        sk: `${VECTOR_SK_PREFIX}${version}`
      }));

      let attempts = 0;
      while (requestKeys.length > 0 && attempts < MAX_BATCH_GET_ATTEMPTS) {
        attempts++;
        const result = await client.send(new BatchGetCommand({
          RequestItems: { [this.tableName]: { Keys: requestKeys } }
        }));

        const responses = result.Responses && result.Responses[this.tableName];
        if (Array.isArray(responses)) {
          items.push(...responses);
        }

        // >! Retry only the keys DynamoDB could not process this round; the set shrinks
        // >! each pass and the attempt cap prevents an unbounded loop.
        const unprocessed = result.UnprocessedKeys && result.UnprocessedKeys[this.tableName];
        requestKeys = (unprocessed && Array.isArray(unprocessed.Keys)) ? unprocessed.Keys : [];
      }
    }

    return items;
  }

  /**
   * Writes the version manifest: the hash-list chunks first, then the meta item last so a
   * reader never observes a meta pointing at missing chunks.
   *
   * @private
   * @async
   * @param {string} version - Index version.
   * @param {string[]} hashes - Deduplicated vector hashes for this version.
   * @param {{model: (string|undefined), dimensions: (number|undefined), ttl: number}} meta - Manifest metadata.
   * @returns {Promise<void>} Resolves when the manifest is written.
   */
  async #writeManifest(version, hashes, meta) {
    const hashChunks = chunk(hashes, MANIFEST_HASH_CHUNK_SIZE);

    const chunkItems = hashChunks.map((hashList, index) => ({
      pk: `${MANIFEST_PK_PREFIX}${version}`,
      sk: `${MANIFEST_HASHES_SK_PREFIX}${index}`,
      version,
      hashes: hashList,
      chunkIndex: index,
      ttl: meta.ttl
    }));

    if (chunkItems.length > 0) {
      await this.#batchWrite(chunkItems);
    }

    const metaItem = {
      pk: `${MANIFEST_PK_PREFIX}${version}`,
      sk: MANIFEST_META_SK,
      version,
      count: hashes.length,
      model: meta.model,
      dimensions: meta.dimensions,
      totalChunks: hashChunks.length,
      ttl: meta.ttl
    };
    await this.#batchWrite([metaItem]);
  }

  /**
   * Execute a BatchWrite of PutRequests, deduplicating by key and chunking at
   * {@link BATCH_LIMIT}.
   *
   * @private
   * @async
   * @param {Array<Object>} putItems - DynamoDB items (each with `pk`/`sk`) to put.
   * @returns {Promise<void>} Resolves when all batches are written.
   */
  async #batchWrite(putItems) {
    const client = this.#docClient();
    const deduped = deduplicateItems(putItems);
    for (const batch of chunk(deduped, BATCH_LIMIT)) {
      await client.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: batch.map((item) => ({ PutRequest: { Item: item } }))
        }
      }));
    }
  }

  /**
   * Execute a BatchWrite of DeleteRequests, deduplicating by key and chunking at
   * {@link BATCH_LIMIT}.
   *
   * @private
   * @async
   * @param {Array<{pk: string, sk: string}>} keys - Keys to delete.
   * @returns {Promise<void>} Resolves when all batches are deleted.
   */
  async #batchDelete(keys) {
    const client = this.#docClient();
    const deduped = deduplicateItems(keys);
    for (const batch of chunk(deduped, BATCH_LIMIT)) {
      await client.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: batch.map((key) => ({
            DeleteRequest: { Key: { pk: key.pk, sk: key.sk } }
          }))
        }
      }));
    }
  }

  /**
   * Validates a single upsert item and builds its DynamoDB vector item.
   *
   * @private
   * @param {{hash: string, vector: number[], metadata: Object}} item - The item to build.
   * @param {string} version - Index version.
   * @param {number} ttl - TTL timestamp to stamp on the item.
   * @returns {Object} The DynamoDB vector item.
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when the item/hash is malformed; `INVALID_VECTOR` when the vector is not numeric.
   */
  #buildVectorItem(item, version, ttl) {
    if (!item || typeof item !== 'object') {
      throw new VectorStoreError('Each upsert item must be an object.', { code: 'INVALID_ARGUMENT' });
    }
    if (typeof item.hash !== 'string' || item.hash.trim().length === 0) {
      throw new VectorStoreError('Each upsert item must have a non-empty string hash.', {
        code: 'INVALID_ARGUMENT'
      });
    }

    const metadata = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {};
    // encodeVector throws INVALID_VECTOR for a non-numeric/empty vector.
    const encoded = encodeVector(item.vector);
    const dims = (Number.isInteger(metadata.dims) && metadata.dims > 0)
      ? metadata.dims
      : item.vector.length;

    // >! Optional metadata attributes may be undefined; removeUndefinedValues on the
    // >! document client omits them from the stored item.
    return {
      pk: `${VECTOR_PK_PREFIX}${item.hash}`,
      sk: `${VECTOR_SK_PREFIX}${version}`,
      version,
      vector: encoded,
      dims,
      model: (typeof metadata.model === 'string') ? metadata.model : undefined,
      embeddingInputHash: metadata.embeddingInputHash,
      type: metadata.type,
      subType: metadata.subType,
      repository: metadata.repository,
      owner: metadata.owner,
      ttl
    };
  }

  /**
   * Resolves the embedding model for the manifest from the first item that carries one.
   *
   * @private
   * @param {Array<{metadata: Object}>} items - Upsert items.
   * @returns {(string|undefined)} The model id, or `undefined` when none is present.
   */
  #resolveModel(items) {
    for (const item of items) {
      if (item && item.metadata && typeof item.metadata.model === 'string' && item.metadata.model) {
        return item.metadata.model;
      }
    }
    return undefined;
  }

  /**
   * Resolves the manifest `dimensions`: the configured `dimensions` when set, otherwise
   * the length of the first non-empty vector.
   *
   * @private
   * @param {Array<{vector: number[]}>} items - Upsert items.
   * @returns {(number|undefined)} The dimension count, or `undefined` when indeterminable.
   */
  #resolveDimensions(items) {
    if (Number.isInteger(this.dimensions) && this.dimensions > 0) {
      return this.dimensions;
    }
    const first = items.find((item) => item && Array.isArray(item.vector) && item.vector.length > 0);
    return first ? first.vector.length : undefined;
  }

  /**
   * Normalizes a `filters` object into `[key, value]` pairs, dropping `undefined`/`null`
   * values so only meaningful equality filters are applied.
   *
   * @private
   * @param {Object} [filters] - Metadata filters.
   * @returns {Array<[string, *]>} Filter entries to apply.
   */
  #normalizeFilters(filters) {
    if (!filters || typeof filters !== 'object') {
      return [];
    }
    return Object.entries(filters).filter(([, value]) => value !== undefined && value !== null);
  }

  /**
   * Extracts the hash from a vector item's partition key (`vector:{hash}` -> `{hash}`).
   *
   * @private
   * @param {string} pk - The vector item partition key.
   * @returns {string} The hash.
   */
  #hashFromVectorPk(pk) {
    return typeof pk === 'string' ? pk.slice(VECTOR_PK_PREFIX.length) : '';
  }

  /**
   * Stores a loaded vector set in the warm cache, evicting any other cached version for
   * the same table so at most one version per table is retained (bounds memory use).
   *
   * @private
   * @param {string} key - Cache key (`{tableName}#{version}`).
   * @param {Array<{hash: string, vector: number[], metadata: Object}>} loaded - Loaded vectors.
   * @returns {void}
   */
  #setCache(key, loaded) {
    const prefix = `${this.tableName}#`;
    for (const existingKey of vectorCache.keys()) {
      if (existingKey.startsWith(prefix) && existingKey !== key) {
        vectorCache.delete(existingKey);
      }
    }
    vectorCache.set(key, loaded);
  }

  /**
   * Removes a version's loaded vectors from the warm cache.
   *
   * @private
   * @param {string} version - Index version to drop.
   * @returns {void}
   */
  #dropCache(version) {
    vectorCache.delete(cacheKeyFor(this.tableName, version));
  }

  /**
   * Resolves the document client, preferring a per-instance injected client (test seam)
   * over the module-level singleton.
   *
   * @private
   * @returns {DynamoDBDocumentClient} The document client to use.
   */
  #docClient() {
    return this.#injectedClient || getDocClient();
  }

  /**
   * Asserts that `version` is a non-empty string.
   *
   * @private
   * @param {string} version - Value to validate.
   * @returns {void}
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when `version` is not a non-empty string.
   */
  #assertVersion(version) {
    if (typeof version !== 'string' || version.trim().length === 0) {
      throw new VectorStoreError('A non-empty "version" string is required.', {
        code: 'INVALID_ARGUMENT'
      });
    }
  }

  /**
   * Determines whether stored metadata satisfies all filter entries (strict equality).
   *
   * @private
   * @param {Object} metadata - Stored vector metadata.
   * @param {Array<[string, *]>} filterEntries - Normalized `[key, value]` filters.
   * @returns {boolean} `true` when every filter matches (or there are no filters).
   */
  static #matchesFilters(metadata, filterEntries) {
    for (const [key, value] of filterEntries) {
      if (!metadata || metadata[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Wraps a caught error as a typed {@link VectorStoreError}, passing through errors that
   * are already `VectorStoreError` (so specific validation codes are preserved).
   *
   * @private
   * @param {Error} error - The caught error.
   * @param {string} message - Human-readable wrapper message (never includes vector data).
   * @param {string} code - The `VectorStoreError` code to use when wrapping.
   * @returns {VectorStoreError} The typed error to throw.
   */
  static #wrap(error, message, code) {
    if (error instanceof VectorStoreError) {
      return error;
    }
    return new VectorStoreError(message, { code, cause: error });
  }
}

module.exports = {
  DynamoDbVectorStore,
  // Exposed for testing (task 3.3: cosine property test, encode/decode round-trip,
  // ordering/filter unit tests, and client/cache seams for mocked DynamoDB).
  cosineSimilarity,
  encodeVector,
  decodeVector,
  getDocClient,
  setDocClient,
  clearVectorCache,
  computeTtl,
  chunk,
  deduplicateItems,
  BATCH_LIMIT,
  BATCH_GET_LIMIT,
  SEVEN_DAYS_SECONDS,
  MANIFEST_HASH_CHUNK_SIZE
};
