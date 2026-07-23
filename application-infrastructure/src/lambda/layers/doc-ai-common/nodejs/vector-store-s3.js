'use strict';

/**
 * S3VectorStore — the Amazon S3 Vectors-backed concrete {@link VectorStore}. It stores
 * documentation embeddings in a single S3 Vectors vector bucket + index and answers
 * nearest-neighbour queries with the native `QueryVectors` similarity search (no
 * in-Lambda scoring, unlike {@link module:vector-store-dynamodb DynamoDbVectorStore}).
 *
 * This module is loaded lazily by the {@link module:vector-store createVectorStore}
 * factory when `vectorStore === 's3-vectors'`. Callers should obtain the store through
 * that factory rather than requiring this module directly, so the DynamoDB and S3
 * backends stay interchangeable behind one contract (Requirement 4.5): both return
 * `[{ hash, score, metadata }]` ordered by DESCENDING similarity.
 *
 * Data model (one S3 Vectors index holds EVERY index version):
 *   - S3 Vectors keys must be unique within an index, and multiple index versions must
 *     coexist in the SAME index. Each vector is therefore stored under a version-scoped
 *     key `` `${version}#${hash}` `` ({@link makeVectorKey}) and carries a `version`
 *     metadata field so {@link S3VectorStore#query} can filter to the active version and
 *     {@link parseHashFromKey} can recover the bare `hash`.
 *   - Stored metadata is `{ version, hash, type, subType, repository, owner,
 *     embeddingInputHash, model, dims }` (undefined/null omitted). `type`/`subType` are
 *     used as filterable query keys; `repository`/`owner`/`embeddingInputHash` ride along
 *     so the RetrievalStrategy can enrich results the same way the keyword path does; and
 *     `model`/`dims` are persisted so the doc-indexer can reuse an unchanged embedding
 *     across index versions (Req 6.2), matching {@link module:vector-store-dynamodb
 *     DynamoDbVectorStore}.
 *
 * Distance → score mapping (IMPORTANT):
 *   - The index is created (Task 4.1 spike) with a COSINE metric, so `QueryVectors`
 *     returns results already ordered nearest-first and, with `returnDistance: true`, a
 *     per-vector `distance`. Per the S3 Vectors API, that `distance` is a cosine
 *     DISTANCE (0 = identical direction, growing to 2 = opposite), NOT a similarity.
 *   - To match {@link module:vector-store-dynamodb DynamoDbVectorStore}, whose `score`
 *     is a cosine SIMILARITY in `[-1, 1]` where HIGHER = more similar, this store
 *     converts via `score = 1 - distance` ({@link distanceToScore}). Because that
 *     transform is monotonic (lower distance → higher score), S3's native nearest-first
 *     ordering is preserved without re-sorting. // >!
 *
 * Cleanup / TTL:
 *   - S3 Vectors has NO TTL, so superseded versions do not expire on their own. Explicit
 *     deletion ({@link S3VectorStore#deleteVersion}) — or overwrite by re-indexing the
 *     same keys — is the cleanup path. `deleteVersion` enumerates keys via `ListVectors`
 *     and removes the ones prefixed with `` `${version}#` `` via `DeleteVectors`.
 *
 * Security:
 *   - AWS SDK v3 clients are normally provided by the Lambda runtime and required
 *     directly. `@aws-sdk/client-s3vectors` is a NEW client and may not yet be bundled
 *     in the nodejs runtime — see the `// >!` note on the require below and Task 8.3. // >!
 *   - No region or credentials are hardcoded: the client resolves the region from the
 *     Lambda environment (`AWS_REGION`) via the SDK default provider chain. // >!
 *   - Inputs are treated as untrusted and validated before any AWS call; query filters
 *     are restricted to a fixed allowlist of filterable keys so a caller cannot trigger a
 *     400 by filtering on a non-filterable metadata key. // >!
 *   - Vector contents are never logged; errors reference versions/counts, not values. // >!
 *
 * @module vector-store-s3
 * @example
 * // Obtain via the factory (intended entry point):
 * const { createVectorStore } = require('/opt/nodejs/vector-store');
 * const store = createVectorStore({
 *   vectorStore: 's3-vectors',
 *   dimensions: 1024,
 *   s3Vectors: { bucket: process.env.DOC_AI_S3_VECTOR_BUCKET, index: process.env.DOC_AI_S3_VECTOR_INDEX }
 * });
 *
 * await store.upsertVectors('v3', [
 *   { hash: 'abc123', vector: [0.1, 0.2, 0.3], metadata: { type: 'guide', subType: 'howto', repository: 'core', owner: '63klabs', embeddingInputHash: 'h1' } }
 * ]);
 *
 * const hits = await store.query(queryVector, { version: 'v3', filters: { type: 'guide' }, topK: 10 });
 * // hits === [{ hash, score, metadata }, ...] ordered by descending similarity
 */

// >! AWS SDK v3 clients are normally provided by the Lambda runtime and required
// >! directly (kept as devDependencies here, used only by tests). @aws-sdk/client-s3vectors
// >! is the EXCEPTION and the SINGLE bundled PRODUCTION dependency of this layer: it is a
// >! NEW client not guaranteed to be present in the nodejs24.x runtime, and the buildspec
// >! builds layers with `npm install --omit=dev`, so leaving it in devDependencies would
// >! omit it from the deployed layer and crash this DOC_AI_VECTOR_STORE=s3-vectors path at
// >! runtime. It is therefore declared under `dependencies` in package.json (mirrors the
// >! s3-vectors-provisioner precedent). Resolved in Task 8.3.
const {
  S3VectorsClient,
  PutVectorsCommand,
  QueryVectorsCommand,
  ListVectorsCommand,
  DeleteVectorsCommand,
  GetVectorsCommand
} = require('@aws-sdk/client-s3vectors');

const { VectorStore, VectorStoreError } = require('./vector-store');

/**
 * Separator between the version prefix and the content hash in an S3 Vectors key
 * (`` `${version}#${hash}` ``). Chosen because embedding content hashes are hex/base64url
 * and never contain `#`, so the version prefix is unambiguously separable.
 * @constant {string}
 */
const KEY_SEPARATOR = '#';

/**
 * Metadata keys a caller may filter on at query time. S3 Vectors rejects (400) a filter
 * that references a non-filterable metadata key, so callers' filters are intersected with
 * this allowlist. `version` is always applied separately by {@link buildS3Filter}.
 * @constant {string[]}
 */
// >! Fixed allowlist of filterable keys; filtering on anything else 400s in S3 Vectors.
const FILTERABLE_FILTER_KEYS = ['type', 'subType'];

/**
 * Maximum vectors per `PutVectors` request. S3 Vectors caps the number of vectors per
 * request; 100 is a conservative chunk size well within that limit (do NOT assume
 * unlimited). Larger upserts are split into multiple requests.
 * @constant {number}
 */
const PUT_VECTORS_CHUNK_SIZE = 100;

/**
 * Maximum keys per `DeleteVectors` request (conservative; the true limit is higher).
 * @constant {number}
 */
const DELETE_VECTORS_CHUNK_SIZE = 100;

/**
 * Maximum keys per `GetVectors` request during {@link S3VectorStore#getVersionVectors}
 * (conservative; the true limit is higher). Larger enumerations are fetched in chunks.
 * @constant {number}
 */
const GET_VECTORS_CHUNK_SIZE = 100;

/**
 * `maxResults` requested per `ListVectors` page during {@link S3VectorStore#deleteVersion}.
 * @constant {number}
 */
const LIST_VECTORS_PAGE_SIZE = 500;

/**
 * Default number of results returned by {@link S3VectorStore#query} when the caller does
 * not supply a valid positive `topK`.
 * @constant {number}
 */
const DEFAULT_TOP_K = 10;

/**
 * Safety cap on `QueryVectors` pagination passes, so a pathological `nextToken` stream
 * cannot loop forever. The loop also stops once `topK` results are collected.
 * @constant {number}
 */
const MAX_QUERY_PAGES = 20;

/**
 * Safety cap on `ListVectors` pagination passes during cleanup. Generously bounds a full
 * index enumeration (LIST_VECTORS_PAGE_SIZE * MAX_LIST_PAGES vectors) while preventing an
 * unbounded loop.
 * @constant {number}
 */
const MAX_LIST_PAGES = 1000;

/**
 * Lazily initialized S3 Vectors client shared by the module.
 * @type {?S3VectorsClient}
 */
let s3VectorsClient = null;

/**
 * Get or create the shared S3 Vectors client singleton. Constructed on first use (never
 * at module load) so merely attaching the layer costs nothing.
 *
 * @returns {S3VectorsClient} The shared S3 Vectors client.
 * @example
 * const client = getS3VectorsClient();
 * await client.send(command);
 */
function getS3VectorsClient() {
  if (!s3VectorsClient) {
    // >! The SDK default provider chain resolves the region from the Lambda environment
    // >! (AWS_REGION); do not hardcode a region or credentials.
    s3VectorsClient = new S3VectorsClient({});
  }
  return s3VectorsClient;
}

/**
 * Override the shared S3 Vectors client (test seam).
 *
 * @param {?S3VectorsClient} client - Client instance, or `null` to reset the singleton.
 * @returns {void}
 * @example
 * setS3VectorsClient(mockClient); // inject a mock in tests
 * setS3VectorsClient(null);       // reset afterwards
 */
function setS3VectorsClient(client) {
  s3VectorsClient = client;
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
 * Build the version-scoped S3 Vectors key for a content hash. Keys are version-scoped so
 * that multiple index versions can coexist in ONE index while staying unique.
 *
 * @param {string} version - The index version (e.g. `'v3'`).
 * @param {string} hash - The content hash (pass `''` to build the version key prefix).
 * @returns {string} A key of the form `` `${version}#${hash}` ``.
 * @example
 * makeVectorKey('v3', 'abc123'); // 'v3#abc123'
 * makeVectorKey('v3', '');       // 'v3#'  (prefix for enumerating a version)
 */
function makeVectorKey(version, hash) {
  return `${version}${KEY_SEPARATOR}${hash}`;
}

/**
 * Recover the bare content hash from an S3 Vectors key. Strips the known
 * `` `${version}#` `` prefix when present; otherwise falls back to the substring after the
 * first separator (and finally returns the key unchanged when it has no separator).
 *
 * @param {string} key - The S3 Vectors key (typically `` `${version}#${hash}` ``).
 * @param {string} [version] - The version whose prefix should be stripped.
 * @returns {string} The content hash, or `''` when `key` is not a string.
 * @example
 * parseHashFromKey('v3#abc123', 'v3'); // 'abc123'
 * parseHashFromKey('v3#abc123');       // 'abc123' (falls back to first separator)
 */
function parseHashFromKey(key, version) {
  if (typeof key !== 'string') {
    return '';
  }
  if (typeof version === 'string' && version.length > 0) {
    const prefix = `${version}${KEY_SEPARATOR}`;
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
  }
  const separatorIndex = key.indexOf(KEY_SEPARATOR);
  return separatorIndex >= 0 ? key.slice(separatorIndex + 1) : key;
}

/**
 * Convert an S3 Vectors cosine `distance` into a similarity `score` where HIGHER = more
 * similar, matching {@link module:vector-store-dynamodb DynamoDbVectorStore}.
 *
 * The index uses a cosine metric, so `QueryVectors` (with `returnDistance: true`) returns
 * a cosine DISTANCE — `0` for identical direction, growing toward `2` for opposite
 * direction. `score = 1 - distance` maps that back to a cosine similarity in `[-1, 1]`.
 * The transform is monotonic, so it never changes S3's native nearest-first ordering.
 *
 * @param {number} distance - The cosine distance returned by S3 Vectors.
 * @returns {number} The similarity score (`1 - distance`); `0` when `distance` is not a finite number.
 * @example
 * distanceToScore(0);   // 1   (identical direction)
 * distanceToScore(1);   // 0   (orthogonal)
 * distanceToScore(0.2); // 0.8
 */
function distanceToScore(distance) {
  // >! Guard non-finite/absent distance so a malformed response cannot produce NaN and
  // >! corrupt ranking; treat it as the least-similar score.
  if (typeof distance !== 'number' || !Number.isFinite(distance)) {
    return 0;
  }
  return 1 - distance;
}

/**
 * Copy an object, dropping keys whose value is `undefined` or `null`, so stored metadata
 * carries only meaningful fields (S3 Vectors metadata is treated as clean JSON data).
 *
 * @private
 * @param {Object} source - The object to prune.
 * @returns {Object} A new object without `undefined`/`null` values.
 */
function pruneEmptyValues(source) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Validate an embedding vector is a non-empty array of finite numbers and return it.
 * S3 Vectors enforces the index dimension server-side, so dimension is not checked here.
 *
 * @private
 * @param {number[]} vector - The embedding vector to validate.
 * @returns {number[]} The validated `vector` (returned unchanged).
 * @throws {VectorStoreError} `INVALID_VECTOR` when `vector` is not a non-empty array of finite numbers.
 */
function assertFiniteVector(vector) {
  // >! Validate untrusted input before sending it to S3 Vectors.
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new VectorStoreError('Each upsert item must have a non-empty numeric vector.', {
      code: 'INVALID_VECTOR'
    });
  }
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new VectorStoreError('Vector elements must all be finite numbers.', {
        code: 'INVALID_VECTOR'
      });
    }
  }
  return vector;
}

/**
 * Build the S3 Vectors metadata filter for a query: ALWAYS constrain to the active
 * `version`, then AND in the caller's filters (restricted to {@link FILTERABLE_FILTER_KEYS}
 * and with `undefined`/`null` dropped). A single condition is returned bare; two or more
 * are combined with `$and` (S3 Vectors' MongoDB-like filter syntax).
 *
 * @param {string} version - The active index version to constrain to (applied as `{ version: { $eq } }`).
 * @param {Object} [filters] - Caller filters (e.g. `{ type, subType }`); only filterable keys are used.
 * @returns {Object} The S3 Vectors filter object.
 * @example
 * buildS3Filter('v3');
 * // { version: { $eq: 'v3' } }
 *
 * @example
 * buildS3Filter('v3', { type: 'guide', subType: undefined });
 * // { $and: [ { version: { $eq: 'v3' } }, { type: { $eq: 'guide' } } ] }
 */
function buildS3Filter(version, filters) {
  const conditions = [{ version: { $eq: version } }];

  if (filters && typeof filters === 'object') {
    // >! Iterate a fixed allowlist (deterministic output) and only add filterable keys;
    // >! filtering on a non-filterable metadata key returns a 400 from S3 Vectors.
    for (const key of FILTERABLE_FILTER_KEYS) {
      const value = filters[key];
      if (value !== undefined && value !== null) {
        conditions.push({ [key]: { $eq: value } });
      }
    }
  }

  if (conditions.length === 1) {
    return conditions[0];
  }
  return { $and: conditions };
}

/**
 * S3 Vectors-backed vector store. Extends {@link VectorStore} and implements the full
 * contract (`upsertVectors`, `query`, `deleteVersion`) against one vector bucket + index.
 *
 * @augments VectorStore
 * @example
 * // Created via the factory rather than directly:
 * const store = createVectorStore({
 *   vectorStore: 's3-vectors',
 *   dimensions: 1024,
 *   s3Vectors: { bucket: process.env.DOC_AI_S3_VECTOR_BUCKET, index: process.env.DOC_AI_S3_VECTOR_INDEX }
 * });
 */
class S3VectorStore extends VectorStore {
  /**
   * Per-instance injected client (test seam). Takes precedence over the module-level
   * {@link getS3VectorsClient} singleton when set; `null` otherwise.
   *
   * @private
   * @type {?S3VectorsClient}
   */
  #injectedClient;

  /**
   * Creates a new S3VectorStore.
   *
   * @param {Object} config - Store configuration (typically the `documentation.ai`-derived config passed by the factory).
   * @param {Object} config.s3Vectors - S3 Vectors options.
   * @param {string} config.s3Vectors.bucket - Vector bucket name. Required; the store cannot function without it.
   * @param {string} config.s3Vectors.index - Vector index name. Required; the store cannot function without it.
   * @param {number} [config.dimensions] - Embedding vector length (informational; S3 Vectors enforces the index dimension server-side).
   * @param {S3VectorsClient} [config.client] - Optional pre-constructed client (test injection); takes precedence over the module singleton.
   * @throws {VectorStoreError} `INVALID_CONFIG` when `config.s3Vectors.bucket` or `config.s3Vectors.index` is missing or not a non-empty string.
   */
  constructor(config) {
    super();
    const s3Vectors = (config && config.s3Vectors) || {};
    const bucket = s3Vectors.bucket;
    const index = s3Vectors.index;

    // >! Fail fast in the constructor: the store cannot operate without a bucket + index.
    if (typeof bucket !== 'string' || bucket.trim().length === 0) {
      throw new VectorStoreError(
        'S3VectorStore requires config.s3Vectors.bucket.',
        { code: 'INVALID_CONFIG' }
      );
    }
    if (typeof index !== 'string' || index.trim().length === 0) {
      throw new VectorStoreError(
        'S3VectorStore requires config.s3Vectors.index.',
        { code: 'INVALID_CONFIG' }
      );
    }

    this.bucket = bucket;
    this.index = index;
    this.dimensions = (config && Number.isInteger(config.dimensions) && config.dimensions > 0)
      ? config.dimensions
      : undefined;
    this.#injectedClient = (config && config.client) || null;
  }

  /**
   * Writes (or overwrites) the vectors for an index `version`. Each vector is stored under
   * a version-scoped key (`` `${version}#${hash}` ``) with `{ version, hash, type, subType,
   * repository, owner, embeddingInputHash, model, dims }` metadata (undefined/null omitted),
   * so many versions can share one index, each hit maps back to its bare `hash`, and the
   * doc-indexer can reuse an unchanged embedding across versions (Req 6.2).
   *
   * Items are validated BEFORE any AWS call (so validation errors surface as
   * `INVALID_ARGUMENT`/`INVALID_VECTOR` rather than `UPSERT_FAILED`), then written via
   * `PutVectors` in {@link PUT_VECTORS_CHUNK_SIZE}-sized chunks.
   *
   * @async
   * @param {string} version - The index version these vectors belong to (e.g. `'v3'`).
   * @param {Array.<{hash: string, vector: number[], metadata: Object}>} items - Vectors to store. `metadata` may include `{ type, subType, repository, owner, embeddingInputHash, model, dims }` (all persisted; undefined/null omitted).
   * @returns {Promise<void>} Resolves when all vectors are persisted (a no-op when `items` is empty).
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when `version`/`items` are malformed, `INVALID_VECTOR` when a vector is not numeric, or `UPSERT_FAILED` (with `cause`) when `PutVectors` fails.
   * @example
   * await store.upsertVectors('v3', [
   *   { hash: 'abc', vector: [0.1, 0.2], metadata: { type: 'guide', subType: 'howto', repository: 'core', owner: '63klabs', embeddingInputHash: 'h1' } }
   * ]);
   */
  async upsertVectors(version, items) {
    this.#assertVersion(version);
    if (!Array.isArray(items)) {
      throw new VectorStoreError('upsertVectors requires an array of items.', {
        code: 'INVALID_ARGUMENT'
      });
    }

    // Build + validate BEFORE any AWS call so validation errors surface as-is.
    const records = items.map((item) => this.#buildVectorRecord(item, version));
    if (records.length === 0) {
      return;
    }

    const client = this.#s3Client();
    try {
      // >! Chunk to respect the PutVectors per-request vector limit (not unlimited).
      for (const batch of chunk(records, PUT_VECTORS_CHUNK_SIZE)) {
        await client.send(new PutVectorsCommand({
          vectorBucketName: this.bucket,
          indexName: this.index,
          vectors: batch
        }));
      }
    } catch (error) {
      throw S3VectorStore.#wrap(error, `Failed to upsert vectors for version "${version}".`, 'UPSERT_FAILED');
    }
  }

  /**
   * Returns the top `topK` nearest neighbours for a query `embedding` from a given index
   * `version`, ordered by DESCENDING similarity. Builds a metadata filter that ANDs the
   * active `version` with the caller's filterable filters ({@link buildS3Filter}), runs
   * `QueryVectors` (with `returnDistance`/`returnMetadata`), follows `nextToken`
   * pagination with a bounded loop, and maps each hit to `{ hash, score, metadata }` with
   * `score = 1 - distance` ({@link distanceToScore}).
   *
   * @async
   * @param {number[]} embedding - The query embedding vector.
   * @param {Object} options - Query options.
   * @param {string} options.version - Index version to search.
   * @param {Object} [options.filters] - Metadata equality filters (e.g. `{ type, subType }`); only filterable keys are applied.
   * @param {number} [options.topK=10] - Maximum number of results to return.
   * @returns {Promise<Array.<{hash: string, score: number, metadata: Object}>>} Neighbours ordered by descending similarity. Empty array when nothing matches.
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when `version` is missing, `INVALID_QUERY` when `embedding` is not a non-empty array, or `QUERY_FAILED` (with `cause`) when `QueryVectors` fails.
   * @example
   * const hits = await store.query(queryVector, { version: 'v3', filters: { type: 'guide' }, topK: 5 });
   * // hits[0].score is the highest similarity
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
    const filter = buildS3Filter(opts.version, opts.filters);

    const client = this.#s3Client();
    const results = [];
    let nextToken;
    let pages = 0;

    try {
      do {
        const response = await client.send(new QueryVectorsCommand({
          vectorBucketName: this.bucket,
          indexName: this.index,
          queryVector: { float32: embedding },
          topK,
          filter,
          returnDistance: true,
          returnMetadata: true,
          ...(nextToken ? { nextToken } : {})
        }));

        const vectors = Array.isArray(response && response.vectors) ? response.vectors : [];
        for (const vector of vectors) {
          results.push(S3VectorStore.#mapQueryVector(vector, opts.version));
        }

        nextToken = response ? response.nextToken : undefined;
        pages++;
        // >! Bounded loop: stop once we have topK, when pagination ends, or at the cap.
      } while (nextToken && results.length < topK && pages < MAX_QUERY_PAGES);
    } catch (error) {
      throw S3VectorStore.#wrap(error, `Failed to query vectors for version "${opts.version}".`, 'QUERY_FAILED');
    }

    // S3 Vectors returns nearest-first; the score transform is monotonic, so this order is
    // already descending-by-score. Preserve it and cap at topK.
    return results.slice(0, topK);
  }

  /**
   * Best-effort cleanup of all vectors for a superseded `version`. Since S3 Vectors has no
   * TTL, this enumerates keys with `ListVectors` (paginated, bounded by
   * {@link MAX_LIST_PAGES}), keeps only those prefixed with `` `${version}#` `` (client-side
   * filter, since `ListVectors` has no server-side key filter), and removes them with
   * `DeleteVectors` in {@link DELETE_VECTORS_CHUNK_SIZE}-sized chunks.
   *
   * @async
   * @param {string} version - The index version to delete/clean up.
   * @returns {Promise<void>} Resolves when cleanup completes (a no-op when the version has no vectors).
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when `version` is missing, or `DELETE_FAILED` (with `cause`) when a `ListVectors`/`DeleteVectors` call fails.
   * @example
   * await store.deleteVersion('v2'); // remove the previous index version
   */
  async deleteVersion(version) {
    this.#assertVersion(version);

    const client = this.#s3Client();
    const prefix = makeVectorKey(version, '');
    let pendingKeys = [];
    let nextToken;
    let pages = 0;

    try {
      do {
        const response = await client.send(new ListVectorsCommand({
          vectorBucketName: this.bucket,
          indexName: this.index,
          maxResults: LIST_VECTORS_PAGE_SIZE,
          ...(nextToken ? { nextToken } : {})
        }));

        const vectors = Array.isArray(response && response.vectors) ? response.vectors : [];
        for (const vector of vectors) {
          const key = vector ? vector.key : undefined;
          // >! Client-side prefix filter: only this version's keys are deleted, so
          // >! vectors for other versions sharing the index are never touched.
          if (typeof key === 'string' && key.startsWith(prefix)) {
            pendingKeys.push(key);
            if (pendingKeys.length >= DELETE_VECTORS_CHUNK_SIZE) {
              await this.#deleteKeys(client, pendingKeys);
              pendingKeys = [];
            }
          }
        }

        nextToken = response ? response.nextToken : undefined;
        pages++;
        // >! Bounded loop: stop when pagination ends or the safety cap is reached.
      } while (nextToken && pages < MAX_LIST_PAGES);

      if (pendingKeys.length > 0) {
        await this.#deleteKeys(client, pendingKeys);
      }
    } catch (error) {
      throw S3VectorStore.#wrap(error, `Failed to delete vectors for version "${version}".`, 'DELETE_FAILED');
    }
  }

  /**
   * Enumerate all stored vectors for an index `version` as `{ hash, vector, metadata }`.
   *
   * INDEX-TIME wrapper added so the doc-indexer can read a prior version's embeddings for
   * incremental reuse (Requirement 6.2); the retrieval/query path never calls it, and it
   * does not change the abstract {@link VectorStore} contract. Because `ListVectors` has
   * no server-side key filter, this enumerates keys (bounded by {@link MAX_LIST_PAGES}),
   * keeps only this version's keys (prefix `` `${version}#` ``), then fetches the vector
   * data + metadata via `GetVectors` (chunked, with `returnData`/`returnMetadata`). Each
   * result maps to `{ hash, vector, metadata }` with `vector = data.float32` and `hash`
   * taken from stored `metadata.hash` (falling back to parsing the key).
   *
   * Note: the S3 Vectors store persists `model`/`dims` in metadata (see
   * {@link S3VectorStore#upsertVectors}), so the returned `metadata` includes them and the
   * indexer's reuse check can reuse an unchanged prior embedding (Req 6.2) — matching the
   * {@link module:vector-store-dynamodb DynamoDbVectorStore} behavior.
   *
   * @async
   * @param {string} version - The index version to enumerate.
   * @returns {Promise<Array.<{hash: string, vector: number[], metadata: Object}>>} All vectors for the version (empty array when the version has none).
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when `version` is not a non-empty string, or `LOAD_FAILED` (with `cause`) when a `ListVectors`/`GetVectors` call fails.
   * @example
   * const priorVectors = await store.getVersionVectors('v2');
   * // [{ hash, vector, metadata: { version, hash, type, subType, embeddingInputHash, ... } }, ...]
   */
  async getVersionVectors(version) {
    this.#assertVersion(version);

    const client = this.#s3Client();
    const prefix = makeVectorKey(version, '');

    try {
      // Enumerate this version's keys via ListVectors (no server-side key filter).
      const keys = [];
      let nextToken;
      let pages = 0;
      do {
        const response = await client.send(new ListVectorsCommand({
          vectorBucketName: this.bucket,
          indexName: this.index,
          maxResults: LIST_VECTORS_PAGE_SIZE,
          ...(nextToken ? { nextToken } : {})
        }));

        const vectors = Array.isArray(response && response.vectors) ? response.vectors : [];
        for (const vector of vectors) {
          const key = vector ? vector.key : undefined;
          // >! Client-side prefix filter: only enumerate this version's keys, so vectors
          // >! for other versions sharing the index are never returned.
          if (typeof key === 'string' && key.startsWith(prefix)) {
            keys.push(key);
          }
        }

        nextToken = response ? response.nextToken : undefined;
        pages++;
        // >! Bounded loop: stop when pagination ends or the safety cap is reached.
      } while (nextToken && pages < MAX_LIST_PAGES);

      // Fetch vector data + metadata for the enumerated keys, chunked.
      const loaded = [];
      for (const keyBatch of chunk(keys, GET_VECTORS_CHUNK_SIZE)) {
        const response = await client.send(new GetVectorsCommand({
          vectorBucketName: this.bucket,
          indexName: this.index,
          keys: keyBatch,
          returnData: true,
          returnMetadata: true
        }));

        const vectors = Array.isArray(response && response.vectors) ? response.vectors : [];
        for (const vector of vectors) {
          loaded.push(S3VectorStore.#mapStoredVector(vector, version));
        }
      }
      return loaded;
    } catch (error) {
      throw S3VectorStore.#wrap(error, `Failed to load vectors for version "${version}".`, 'LOAD_FAILED');
    }
  }

  /**
   * Validates a single upsert item and builds its S3 Vectors put record.
   *
   * @private
   * @param {{hash: string, vector: number[], metadata: Object}} item - The item to build.
   * @param {string} version - Index version (used for the version-scoped key and metadata).
   * @returns {{key: string, data: {float32: number[]}, metadata: Object}} The S3 Vectors put record.
   * @throws {VectorStoreError} `INVALID_ARGUMENT` when the item/hash is malformed; `INVALID_VECTOR` when the vector is not numeric.
   */
  #buildVectorRecord(item, version) {
    if (!item || typeof item !== 'object') {
      throw new VectorStoreError('Each upsert item must be an object.', { code: 'INVALID_ARGUMENT' });
    }
    if (typeof item.hash !== 'string' || item.hash.trim().length === 0) {
      throw new VectorStoreError('Each upsert item must have a non-empty string hash.', {
        code: 'INVALID_ARGUMENT'
      });
    }

    const vector = assertFiniteVector(item.vector);
    const metadata = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {};

    return {
      key: makeVectorKey(version, item.hash),
      data: { float32: vector },
      // >! Persist the fields the retrieval layer and the index-time reuse check need.
      // >! `version` enables multiple versions to coexist in one index; `hash` maps a query
      // >! hit back to its content item; `type`/`subType` are the filterable query keys;
      // >! `model`/`dims` let the doc-indexer reuse an unchanged embedding across versions
      // >! (Req 6.2), matching the DynamoDB store. Undefined/null values are pruned.
      metadata: pruneEmptyValues({
        version,
        hash: item.hash,
        type: metadata.type,
        subType: metadata.subType,
        repository: metadata.repository,
        owner: metadata.owner,
        embeddingInputHash: metadata.embeddingInputHash,
        model: metadata.model,
        dims: metadata.dims
      })
    };
  }

  /**
   * Sends a single `DeleteVectors` request for a batch of keys.
   *
   * @private
   * @async
   * @param {S3VectorsClient} client - The S3 Vectors client to use.
   * @param {string[]} keys - The keys to delete (at most {@link DELETE_VECTORS_CHUNK_SIZE}).
   * @returns {Promise<void>} Resolves when the delete request completes.
   */
  async #deleteKeys(client, keys) {
    await client.send(new DeleteVectorsCommand({
      vectorBucketName: this.bucket,
      indexName: this.index,
      keys
    }));
  }

  /**
   * Resolves the S3 Vectors client, preferring a per-instance injected client (test seam)
   * over the module-level singleton.
   *
   * @private
   * @returns {S3VectorsClient} The client to use.
   */
  #s3Client() {
    return this.#injectedClient || getS3VectorsClient();
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
   * Maps a single `QueryVectors` result vector to the shared `{ hash, score, metadata }`
   * result shape. `hash` prefers the stored `metadata.hash` and falls back to parsing the
   * key; `score` is `1 - distance` ({@link distanceToScore}).
   *
   * @private
   * @param {{key?: string, distance?: number, metadata?: Object}} vector - A returned query vector.
   * @param {string} version - The queried version (used to strip the key prefix on fallback).
   * @returns {{hash: string, score: number, metadata: Object}} The mapped result.
   */
  static #mapQueryVector(vector, version) {
    const metadata = (vector && vector.metadata && typeof vector.metadata === 'object')
      ? vector.metadata
      : {};
    const hash = (typeof metadata.hash === 'string' && metadata.hash.length > 0)
      ? metadata.hash
      : parseHashFromKey(vector ? vector.key : undefined, version);

    return {
      hash,
      score: distanceToScore(vector ? vector.distance : undefined),
      metadata
    };
  }

  /**
   * Maps a single `GetVectors` result vector to the `{ hash, vector, metadata }` shape
   * returned by {@link S3VectorStore#getVersionVectors}. `vector` is the raw float array
   * (`data.float32`); `hash` prefers stored `metadata.hash` and falls back to parsing the
   * key (stripping the queried version's prefix).
   *
   * @private
   * @param {{key?: string, data?: {float32?: number[]}, metadata?: Object}} vector - A returned stored vector.
   * @param {string} version - The version whose key prefix to strip on hash fallback.
   * @returns {{hash: string, vector: number[], metadata: Object}} The mapped record.
   */
  static #mapStoredVector(vector, version) {
    const metadata = (vector && vector.metadata && typeof vector.metadata === 'object')
      ? vector.metadata
      : {};
    const data = (vector && vector.data && typeof vector.data === 'object') ? vector.data : {};
    const float32 = Array.isArray(data.float32) ? data.float32 : [];
    const hash = (typeof metadata.hash === 'string' && metadata.hash.length > 0)
      ? metadata.hash
      : parseHashFromKey(vector ? vector.key : undefined, version);

    return {
      hash,
      vector: float32,
      metadata
    };
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
  S3VectorStore,
  // Exposed for testing (task 4.4: filter translation, key encoding, distance→score
  // mapping, and the client seam for mocked S3 Vectors).
  buildS3Filter,
  makeVectorKey,
  parseHashFromKey,
  distanceToScore,
  chunk,
  getS3VectorsClient,
  setS3VectorsClient,
  KEY_SEPARATOR,
  FILTERABLE_FILTER_KEYS,
  PUT_VECTORS_CHUNK_SIZE,
  DELETE_VECTORS_CHUNK_SIZE,
  GET_VECTORS_CHUNK_SIZE,
  LIST_VECTORS_PAGE_SIZE,
  DEFAULT_TOP_K
};
