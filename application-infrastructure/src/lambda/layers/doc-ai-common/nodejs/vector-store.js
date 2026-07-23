'use strict';

/**
 * VectorStore — the storage-agnostic interface (plus a {@link createVectorStore}
 * factory) for reading and writing documentation embeddings. It is shared (via the
 * `doc-ai-common` Lambda Layer) by the doc-indexer (index-time `upsertVectors`) and
 * the read-function (query-time `query`).
 *
 * This module intentionally defines ONLY the abstract contract and the factory. The
 * concrete stores live in sibling modules and are loaded lazily by the factory:
 *   - `dynamodb`   -> `./vector-store-dynamodb` exporting `DynamoDbVectorStore` (task 3.2)
 *   - `s3-vectors` -> `./vector-store-s3` exporting `S3VectorStore` (task 4.2)
 * A future `opensearch` store plugs in the same way (Requirement 4.5): the factory is
 * the single extension point, so callers never change when a new backend is added.
 *
 * Design notes:
 *   - No AWS SDK at module load: this file requires no AWS SDK client at the top level,
 *     and the concrete store modules are required LAZILY inside the factory. Merely
 *     attaching the layer or requiring this module therefore costs nothing and works
 *     even before the concrete stores exist (Requirement 7.1).
 *   - Typed errors: every failure surfaces as {@link VectorStoreError} with a stable,
 *     machine-readable `code` (mirrors the EmbeddingError pattern), so callers such as
 *     SemanticRetrieval can catch it and fall back to keyword search.
 *   - Abstract base: instantiating {@link VectorStore} directly and calling a method
 *     throws `NOT_IMPLEMENTED`; subclasses MUST override all three methods.
 *
 * Contract (implemented by every concrete store):
 *   - `upsertVectors(version, items)` — write/overwrite the vectors for an index
 *     `version`. `items` is an array of `{ hash: string, vector: number[], metadata:
 *     object }`. `metadata` carries at least `{ type, subType, repository, ... }` used
 *     for query-time filtering. Resolves (no value) on success.
 *   - `query(embedding, { version, filters, topK })` — given a query `embedding`
 *     (`number[]`), return the top `topK` nearest neighbours from index `version`,
 *     applying `filters` (e.g. `{ type, subType }`) equivalently to keyword filtering.
 *     Resolves to an array of `{ hash: string, score: number, metadata: object }`
 *     ordered by DESCENDING cosine similarity (Requirements 4.3, 4.4).
 *   - `deleteVersion(version)` — remove/clean up all vectors for a superseded version.
 *
 * Security:
 *   - The factory dispatches through a fixed internal allowlist (`STORE_REGISTRY`); the
 *     `config.vectorStore` value is never interpolated into a `require()` path, so it
 *     cannot be used to load an arbitrary module. // >!
 *   - No credentials or region are handled here; concrete stores resolve region via the
 *     AWS SDK default provider chain (`AWS_REGION`) and are never hardcoded.
 *   - `config` is treated as untrusted input and validated before use.
 *
 * @module vector-store
 * @example
 * // Obtain a concrete store via the factory (the intended entry point):
 * const { createVectorStore } = require('/opt/nodejs/vector-store');
 *
 * const store = createVectorStore({
 *   vectorStore: 'dynamodb',
 *   dimensions: 1024,
 *   dynamodb: { tableName: process.env.DOC_INDEX_TABLE }
 * });
 *
 * await store.upsertVectors('v3', [
 *   { hash: 'abc123', vector: [0.1, 0.2], metadata: { type: 'guide', subType: 'howto', repository: 'core' } }
 * ]);
 *
 * const hits = await store.query(queryVector, {
 *   version: 'v3',
 *   filters: { type: 'guide' },
 *   topK: 10
 * });
 * // hits === [{ hash, score, metadata }, ...] ordered by descending similarity
 */

/** Vector-store identifier: reuse the existing DocIndex DynamoDB table. */
const VECTOR_STORE_DYNAMODB = 'dynamodb';
/** Vector-store identifier: use an S3 Vectors vector bucket + index. */
const VECTOR_STORE_S3_VECTORS = 's3-vectors';

/**
 * Fixed allowlist mapping a supported `vectorStore` id to the sibling module that
 * implements it and the class that module is expected to export. Dispatching through
 * this constant (rather than interpolating a caller-supplied value into `require()`)
 * keeps module loading confined to known implementations.
 *
 * @constant {Object.<string, {module: string, exportName: string}>}
 */
// >! Static allowlist: `require()` targets come from here, never from `config`.
const STORE_REGISTRY = {
  [VECTOR_STORE_DYNAMODB]: { module: './vector-store-dynamodb', exportName: 'DynamoDbVectorStore' },
  [VECTOR_STORE_S3_VECTORS]: { module: './vector-store-s3', exportName: 'S3VectorStore' }
};

/**
 * Error thrown for any vector-store failure. Callers can catch this typed error to
 * distinguish store failures from other errors (e.g. to fall back to keyword search).
 *
 * A distinct `VectorStoreError` (rather than reusing `EmbeddingError`) keeps the
 * embedding and vector-store modules decoupled while following the same shape.
 *
 * @example
 * try {
 *   const store = createVectorStore(config);
 *   await store.query(vector, { version, topK: 10 });
 * } catch (error) {
 *   if (error instanceof VectorStoreError) {
 *     // error.code is one of: NOT_IMPLEMENTED | INVALID_CONFIG |
 *     //   UNSUPPORTED_STORE | STORE_NOT_AVAILABLE | (store-specific codes)
 *   }
 * }
 */
class VectorStoreError extends Error {
  /**
   * Creates a new VectorStoreError.
   *
   * @param {string} message - Human-readable description (never includes vector data or secrets).
   * @param {Object} [options] - Additional error context.
   * @param {string} [options.code='VECTOR_STORE_ERROR'] - Stable, machine-readable code
   *   (e.g. `'NOT_IMPLEMENTED'`, `'INVALID_CONFIG'`, `'UNSUPPORTED_STORE'`,
   *   `'STORE_NOT_AVAILABLE'`).
   * @param {Error} [options.cause] - The underlying error (e.g. a module-load error), when applicable.
   */
  constructor(message, { code = 'VECTOR_STORE_ERROR', cause } = {}) {
    super(message);
    this.name = 'VectorStoreError';
    this.code = code;
    // >! Preserve the underlying error as `cause` so callers can inspect/log it
    // >! without the wrapper discarding the original failure detail.
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Abstract vector-store interface. Concrete stores (obtained via {@link createVectorStore})
 * extend this class and override all three methods. Calling a method on the base class
 * throws a {@link VectorStoreError} with `code === 'NOT_IMPLEMENTED'`, so a partially
 * implemented subclass fails loudly rather than silently no-op'ing.
 *
 * See the module-level documentation for the precise cross-store contract (parameter
 * shapes, ordering, and filtering semantics).
 *
 * @abstract
 * @example
 * // Concrete stores are created via the factory, not instantiated directly:
 * const store = createVectorStore({ vectorStore: 'dynamodb', dimensions: 1024,
 *   dynamodb: { tableName: process.env.DOC_INDEX_TABLE } });
 *
 * @example
 * // A concrete store extends VectorStore and overrides every method:
 * class MyVectorStore extends VectorStore {
 *   async upsertVectors(version, items) { /* write vectors *\/ }
 *   async query(embedding, { version, filters, topK }) { /* return neighbours *\/ }
 *   async deleteVersion(version) { /* cleanup *\/ }
 * }
 */
class VectorStore {
  /**
   * Writes (or overwrites) the vectors for an index `version`.
   *
   * @abstract
   * @async
   * @param {string} _version - The index version these vectors belong to (e.g. `'v3'`).
   * @param {Array.<{hash: string, vector: number[], metadata: Object}>} _items - Vectors to
   *   store. Each item is `{ hash, vector, metadata }`; `metadata` carries at least
   *   `{ type, subType, repository }` (used for query-time filtering).
   * @returns {Promise<void>} Resolves when all vectors have been persisted.
   * @throws {VectorStoreError} Always on the base class (`code === 'NOT_IMPLEMENTED'`); concrete stores throw store-specific codes on failure.
   */
  async upsertVectors(_version, _items) {
    throw VectorStore.#notImplemented('upsertVectors');
  }

  /**
   * Returns the top `topK` nearest neighbours for a query `embedding` from a given
   * index `version`, ordered by descending cosine similarity.
   *
   * @abstract
   * @async
   * @param {number[]} _embedding - The query embedding vector.
   * @param {Object} _options - Query options.
   * @param {string} _options.version - Index version to search.
   * @param {Object} [_options.filters] - Metadata equality filters applied like keyword
   *   filtering (e.g. `{ type, subType }`).
   * @param {number} _options.topK - Maximum number of results to return.
   * @returns {Promise<Array.<{hash: string, score: number, metadata: Object}>>} Neighbours
   *   ordered by DESCENDING similarity `score`.
   * @throws {VectorStoreError} Always on the base class (`code === 'NOT_IMPLEMENTED'`); concrete stores throw store-specific codes on failure.
   */
  async query(_embedding, _options) {
    throw VectorStore.#notImplemented('query');
  }

  /**
   * Removes all vectors for a superseded index `version`.
   *
   * @abstract
   * @async
   * @param {string} _version - The index version to delete/clean up.
   * @returns {Promise<void>} Resolves when cleanup completes.
   * @throws {VectorStoreError} Always on the base class (`code === 'NOT_IMPLEMENTED'`); concrete stores throw store-specific codes on failure.
   */
  async deleteVersion(_version) {
    throw VectorStore.#notImplemented('deleteVersion');
  }

  /**
   * Builds the standard "not implemented" error for an un-overridden abstract method.
   *
   * @private
   * @param {string} methodName - The abstract method name that was called.
   * @returns {VectorStoreError} A `NOT_IMPLEMENTED` error to throw.
   */
  static #notImplemented(methodName) {
    return new VectorStoreError(
      `${methodName}() is not implemented on the abstract VectorStore base class. ` +
      'Obtain a concrete store via createVectorStore(config) instead of instantiating VectorStore directly.',
      { code: 'NOT_IMPLEMENTED' }
    );
  }
}

/**
 * Loads a concrete store class lazily from the sibling module named in `entry`, turning
 * a not-yet-implemented backend into a clean, typed error instead of a raw require crash.
 *
 * @private
 * @param {string} storeId - The requested `vectorStore` id (for error messages).
 * @param {{module: string, exportName: string}} entry - Registry entry to load.
 * @returns {Function} The concrete store constructor (a subclass of {@link VectorStore}).
 * @throws {VectorStoreError} `STORE_NOT_AVAILABLE` when the implementation module is
 *   absent or does not export the expected class.
 */
function loadStoreClass(storeId, entry) {
  let storeModule;
  try {
    // >! Lazy require of a fixed, internal module specifier (from STORE_REGISTRY, not
    // >! from caller input). Deferring the load keeps this module free of AWS SDK deps
    // >! and lets it be required/tested before the concrete stores exist.
    storeModule = require(entry.module);
  } catch (error) {
    // Only the concrete store module being absent maps to STORE_NOT_AVAILABLE. A
    // MODULE_NOT_FOUND for some OTHER (transitive) dependency, or any non-resolution
    // error, is unexpected and must propagate rather than be masked.
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes(entry.module)) {
      throw new VectorStoreError(
        `Vector store "${storeId}" is selected but its implementation module ` +
        `("${entry.module}") is not available yet. This backend has not been built.`,
        { code: 'STORE_NOT_AVAILABLE', cause: error }
      );
    }
    throw error;
  }

  const StoreClass = storeModule ? storeModule[entry.exportName] : undefined;
  if (typeof StoreClass !== 'function') {
    throw new VectorStoreError(
      `Vector store "${storeId}" module ("${entry.module}") did not export a ` +
      `"${entry.exportName}" class.`,
      { code: 'STORE_NOT_AVAILABLE' }
    );
  }
  return StoreClass;
}

/**
 * Factory that returns a concrete {@link VectorStore} for the configured backend. This
 * is the single extension point for retrieval backends: callers depend only on the
 * VectorStore contract, and a new backend is added by registering it in
 * `STORE_REGISTRY` and shipping its module (Requirement 4.5).
 *
 * The `config` may be a superset of what any single store needs; each concrete store
 * reads only the keys it cares about. This keeps the shape aligned with the
 * `documentation.ai` settings block (`vectorStore`, `embedding.dimensions`,
 * `s3Vectors.{bucket,index}`) and the DynamoDB DocIndex table name.
 *
 * @param {Object} config - Vector-store configuration (typically derived from `documentation.ai` settings).
 * @param {string} config.vectorStore - Backend selector: `'dynamodb'` or `'s3-vectors'` (a future `'opensearch'`).
 * @param {number} [config.dimensions] - Embedding vector length; passed through to the concrete store.
 * @param {Object} [config.dynamodb] - DynamoDB store options.
 * @param {string} [config.dynamodb.tableName] - The DocIndex table name (`DOC_INDEX_TABLE`).
 * @param {Object} [config.s3Vectors] - S3 Vectors store options.
 * @param {string} [config.s3Vectors.bucket] - Vector bucket name.
 * @param {string} [config.s3Vectors.index] - Vector index name.
 * @returns {VectorStore} A concrete store instance for the selected backend.
 * @throws {VectorStoreError} `INVALID_CONFIG` when `config` is missing/not an object or `vectorStore` is absent/not a string.
 * @throws {VectorStoreError} `UNSUPPORTED_STORE` when `vectorStore` is not a recognized backend (includes `'opensearch'` until it is added).
 * @throws {VectorStoreError} `STORE_NOT_AVAILABLE` when the selected backend's implementation module is not present yet.
 * @example
 * const store = createVectorStore({
 *   vectorStore: 's3-vectors',
 *   dimensions: 1024,
 *   s3Vectors: { bucket: process.env.DOC_AI_S3_VECTOR_BUCKET, index: process.env.DOC_AI_S3_VECTOR_INDEX }
 * });
 *
 * @example
 * // Unknown/unsupported backend throws a typed error:
 * try {
 *   createVectorStore({ vectorStore: 'opensearch' });
 * } catch (error) {
 *   console.error(error.code); // 'UNSUPPORTED_STORE'
 * }
 */
function createVectorStore(config) {
  // >! Validate untrusted config before use: fail with a typed error rather than
  // >! dereferencing undefined or dispatching on a non-string selector.
  if (!config || typeof config !== 'object') {
    throw new VectorStoreError(
      'createVectorStore(config) requires a config object.',
      { code: 'INVALID_CONFIG' }
    );
  }

  const storeId = config.vectorStore;
  if (typeof storeId !== 'string' || storeId.trim().length === 0) {
    throw new VectorStoreError(
      'createVectorStore config is missing a "vectorStore" selector.',
      { code: 'INVALID_CONFIG' }
    );
  }

  const entry = STORE_REGISTRY[storeId];
  if (!entry) {
    const supported = Object.keys(STORE_REGISTRY).join(', ');
    throw new VectorStoreError(
      `Unsupported vector store "${storeId}". Supported stores: ${supported}.`,
      { code: 'UNSUPPORTED_STORE' }
    );
  }

  const StoreClass = loadStoreClass(storeId, entry);
  return new StoreClass(config);
}

module.exports = {
  VectorStore,
  VectorStoreError,
  createVectorStore
};
