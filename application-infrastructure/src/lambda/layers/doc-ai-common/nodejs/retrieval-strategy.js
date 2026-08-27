'use strict';

/**
 * RetrievalStrategy — the retrieval-mode-agnostic interface (plus concrete
 * {@link KeywordRetrieval} and {@link SemanticRetrieval} strategies) that the
 * `search_documentation` tool uses to fetch documentation results. It is shared (via the
 * `doc-ai-common` Lambda Layer) so the read-function's documentation service can select a
 * strategy by configuration and caller tier without changing its call sites.
 *
 * This module defines the abstract base, the two concrete strategies delivered by task
 * 6.2 ({@link KeywordRetrieval}, {@link SemanticRetrieval}), the typed {@link RetrievalError},
 * the {@link selectStrategy} factory plus its {@link FallbackRetrieval} wrapper (task 6.3),
 * and the {@link SemanticAssistedRetrieval} strategy (task 7.1) that re-ranks a plain
 * semantic result set with a small assist model (via an injected
 * {@link module:assist-provider AssistProvider}) without ever synthesizing prose.
 *
 * Design notes:
 *   - Dependency injection / decoupling: every collaborator a strategy needs (the keyword
 *     search function, the {@link module:embedding-provider EmbeddingProvider}, the
 *     {@link module:vector-store VectorStore}, the content-lookup/`buildResults` function,
 *     and the query-embedding cache) is INJECTED via the constructor. This layer never
 *     requires anything from the read-function or doc-indexer, so it stays independently
 *     testable and the two functions stay decoupled from each other.
 *   - Result-shape parity: both strategies return the SAME response object as today's
 *     keyword path — `{ results, totalResults, query, suggestions }` — where each result
 *     matches `Models.DocIndex.queryIndex`'s shape (`title, excerpt, filePath, githubUrl,
 *     type, subType, relevanceScore, repository, repositoryType, namespace, codeExamples?,
 *     context?`). {@link SemanticRetrieval} maps each vector hit's cosine `score` onto the
 *     `relevanceScore` field so callers cannot tell which strategy produced the results
 *     (Requirements 2.2, 3.4).
 *   - Typed errors: {@link SemanticRetrieval} surfaces every failure (embedding, vector
 *     store, or content lookup) as a {@link RetrievalError}. It does NOT fall back to
 *     keyword itself; `selectStrategy` (task 6.3) catches the typed error and performs the
 *     keyword fallback (Requirement 2.4). Raising a typed error is exactly the seam 6.3
 *     needs.
 *   - Query-embedding cache: {@link SemanticRetrieval} caches query embeddings keyed by
 *     normalized query + embedding model + dimensions (Requirement 7.2), so repeated
 *     identical queries do not re-invoke Bedrock. The cache is a bounded in-memory Map
 *     (injectable, with stats/clear hooks) so task 6.4 can assert cache hits.
 *
 * Security:
 *   - The query string is treated as untrusted input and validated before it is embedded
 *     or used to build a cache key. // >!
 *   - No AWS SDK is required at module load and no credentials/region are handled here;
 *     the injected EmbeddingProvider/VectorStore own their clients. // >!
 *   - Query filters are built from a fixed, known set of fields (`type`, `ghusers`), never
 *     from arbitrary caller keys, so a caller cannot inject an unexpected filter key. // >!
 *
 * @module retrieval-strategy
 * @example
 * // Keyword strategy simply wraps the existing search (result shape preserved exactly):
 * const { KeywordRetrieval } = require('/opt/nodejs/retrieval-strategy');
 * const keyword = new KeywordRetrieval({ keywordSearchFn: Services.Documentation.search });
 * const result = await keyword.retrieve({ query: 'cache-data', type: 'documentation' });
 *
 * @example
 * // Semantic strategy embeds the query, queries the vector store, and maps hits back to
 * // the keyword result shape via an injected content-lookup/buildResults function:
 * const { SemanticRetrieval } = require('/opt/nodejs/retrieval-strategy');
 * const semantic = new SemanticRetrieval({
 *   embeddingProvider,   // EmbeddingProvider instance
 *   vectorStore,         // VectorStore instance (createVectorStore(...))
 *   buildResults,        // (hits, context) => Promise<result[]>  (content lookup + shape)
 *   topK: 10
 * });
 * const result = await semantic.retrieve({
 *   query: 'rotate the cache secure data key',
 *   type: 'documentation',
 *   ghusers: ['63klabs'],
 *   version: 'v3'
 * });
 */

/**
 * Default number of results a {@link SemanticRetrieval} returns when neither the call nor
 * the constructor supplies a valid positive `topK`. Mirrors `documentation.ai.topK`.
 *
 * @constant {number}
 */
const DEFAULT_TOP_K = 10;

/**
 * Default maximum number of query embeddings retained in a {@link SemanticRetrieval}
 * instance's in-memory cache before the oldest entry is evicted (FIFO). Bounds memory in
 * a warm Lambda while keeping repeat-query cache hits cheap.
 *
 * @constant {number}
 */
const DEFAULT_QUERY_CACHE_SIZE = 128;

/**
 * Default multiplier applied to the effective `topK` by {@link SemanticAssistedRetrieval} to
 * decide how many semantic candidates to fetch before re-ranking. Mirrors
 * `documentation.ai.candidateMultiplier`. Fetching more candidates than needed gives the
 * assist model room to promote a strong-but-lower-ranked hit into the top results.
 *
 * @constant {number}
 */
const DEFAULT_CANDIDATE_MULTIPLIER = 3;

/**
 * Default upper bound on how many candidates {@link SemanticAssistedRetrieval} fetches and
 * feeds to the assist model, regardless of `topK * candidateMultiplier`. Mirrors
 * `documentation.ai.assist.maxCandidates`; caps tokens/cost per assisted request.
 *
 * @constant {number}
 */
const DEFAULT_ASSIST_MAX_CANDIDATES = 25;

/**
 * Stable strategy label emitted in {@link SemanticAssistedRetrieval}'s usage and degrade
 * log lines. Kept as a fixed constant (matching `DOC_AI_RETRIEVAL_MODE=semantic-assisted`)
 * so task 8.2's CloudWatch metric filter can match it reliably.
 *
 * @constant {string}
 */
const ASSISTED_STRATEGY_LABEL = 'semantic-assisted';

/**
 * Fixed leading token for the machine-parseable usage/cost log line
 * {@link SemanticAssistedRetrieval} emits after a SUCCESSFUL assist re-rank (Requirements
 * 5.5, 7.4). A CloudWatch metric filter (task 8.2) matches this token to extract Bedrock
 * token counts per strategy/store. The EXACT emitted line is a fixed token, one space, then
 * compact JSON with a stable key order, e.g.:
 *   `DOC_AI_USAGE {"strategy":"semantic-assisted","store":"s3-vectors","inputTokens":123,"outputTokens":7,"totalTokens":130}`
 *
 * The line is emitted at INFO level (via the injected logger's `info`) so it is visible in
 * PROD, where the consuming read-function runs at `LOG_LEVEL=INFO`. Cost tracking matters
 * most in PROD, so INFO (not `debug`, which PROD suppresses) is what lets task 8.2's metric
 * filter populate the usage/per-store metrics in PROD.
 *
 * @constant {string}
 */
const USAGE_LOG_PREFIX = 'DOC_AI_USAGE';

/**
 * Default vector store label used in {@link SemanticAssistedRetrieval}'s logging when the
 * consuming function does not inject a `storeType` (sourced later from
 * `documentation.ai.vectorStore`). Logging only — it never affects retrieval behavior.
 *
 * @constant {string}
 */
const DEFAULT_STORE_LABEL = 'unknown';

/**
 * Stable event name for the additional ERROR-level log emitted (alongside the routine
 * WARN degrade) when a retrieval degrade is caused by a Bedrock model / inference profile
 * that is not available in the targeted region/account (`code === 'MODEL_NOT_AVAILABLE'`).
 *
 * A misconfigured region/model is a configuration problem, not routine degrade noise, so it
 * is logged loudly and searchably at ERROR level (Requirement 10.5) without changing the
 * degrade behavior itself. The emitted line is this fixed token, one space, then compact
 * JSON carrying the strategy label, the Bedrock model id, and the region that was targeted —
 * mirroring the indexer's `doc_ai_bedrock_model_unavailable` line (index-builder.js) so one
 * metric filter can match both the index-time and query-time occurrences.
 *
 * @constant {string}
 */
const MODEL_UNAVAILABLE_EVENT = 'doc_ai_bedrock_model_unavailable';

/**
 * Helpful suggestions returned (matching the keyword path's wording) when a semantic
 * search yields no results — including the "no active index version" case (Requirement
 * 2.5). Copied per call so callers cannot mutate the shared array.
 *
 * @constant {string[]}
 */
const SEMANTIC_EMPTY_SUGGESTIONS = [
  'Try using fewer or more general keywords',
  'Try filtering by type: documentation, template-pattern, or code-example'
];

/**
 * Fixed tier privilege ranking used by {@link selectStrategy} to gate the semantic path.
 * A higher rank is more privileged; the order is `public < registered < paid < private`
 * (matching the design's tier order map). Frozen so the ranking cannot be mutated at
 * runtime.
 *
 * @constant {Object<string, number>}
 */
const TIER_RANK = Object.freeze({
  public: 0,
  registered: 1,
  paid: 2,
  private: 3
});

/**
 * Fail-secure rank used for an unknown/missing/invalid `minTier`: treat it as `paid` so a
 * misconfigured `minTier` makes the gated semantic path HARDER to qualify for, never
 * easier. Mirrors the `documentation.ai.minTier` default.
 *
 * @constant {number}
 */
const DEFAULT_MIN_TIER_RANK = TIER_RANK.paid;

/**
 * No-op function used to fill any missing logger method so this layer stays silent and
 * decoupled — it never imports `DebugAndLog`/`console` — unless the consuming function
 * injects a real logger.
 *
 * @constant {function(): void}
 */
const NOOP = () => {};

/**
 * Error thrown for any retrieval-strategy failure. Callers (notably `selectStrategy` in
 * task 6.3) can catch this typed error to distinguish a semantic-path failure from other
 * errors and fall back to keyword search (Requirement 2.4).
 *
 * A distinct `RetrievalError` (rather than reusing `EmbeddingError`/`VectorStoreError`)
 * keeps the retrieval layer decoupled from its collaborators while following the same
 * shape (`message`, `code`, optional `cause`).
 *
 * @example
 * try {
 *   await semantic.retrieve({ query, version });
 * } catch (error) {
 *   if (error instanceof RetrievalError) {
 *     // error.code is one of: NOT_IMPLEMENTED | INVALID_CONFIG | INVALID_QUERY |
 *     //   RETRIEVAL_FAILED. Fall back to keyword search.
 *   }
 * }
 */
class RetrievalError extends Error {
  /**
   * Creates a new RetrievalError.
   *
   * @param {string} message - Human-readable description (never includes the query text or vector data).
   * @param {Object} [options] - Additional error context.
   * @param {string} [options.code='RETRIEVAL_ERROR'] - Stable, machine-readable code
   *   (e.g. `'NOT_IMPLEMENTED'`, `'INVALID_CONFIG'`, `'INVALID_QUERY'`, `'RETRIEVAL_FAILED'`).
   * @param {Error} [options.cause] - The underlying error (e.g. an `EmbeddingError` or `VectorStoreError`), when applicable.
   */
  constructor(message, { code = 'RETRIEVAL_ERROR', cause } = {}) {
    super(message);
    this.name = 'RetrievalError';
    this.code = code;
    // >! Preserve the underlying error as `cause` so callers can inspect/log it without
    // >! the wrapper discarding the original failure detail.
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Normalize a query string for use in the query-embedding cache key: trim, lowercase, and
 * collapse internal whitespace. Two queries that differ only in surrounding/among-word
 * whitespace or letter case therefore share one cached embedding (Requirement 7.2).
 *
 * @param {string} query - The raw query string.
 * @returns {string} The normalized query (empty string when `query` is not a string).
 * @example
 * normalizeQuery('  Rotate   the KEY '); // 'rotate the key'
 */
function normalizeQuery(query) {
  if (typeof query !== 'string') {
    return '';
  }
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normalize a `ghusers` input into a deduplicated array of non-empty, trimmed strings.
 * Accepts a single string or an array; anything else yields an empty array.
 *
 * @private
 * @param {(string|string[])} [ghusers] - GitHub user/org filter value from the tool input.
 * @returns {string[]} Deduplicated, cleaned owner values (empty when none are valid).
 */
function normalizeGhusers(ghusers) {
  if (typeof ghusers === 'string' && ghusers.trim().length > 0) {
    return [ghusers.trim()];
  }
  if (!Array.isArray(ghusers)) {
    return [];
  }
  const cleaned = ghusers
    .filter((owner) => typeof owner === 'string' && owner.trim().length > 0)
    .map((owner) => owner.trim());
  return Array.from(new Set(cleaned));
}

/**
 * Build the flat metadata equality-filter object that {@link module:vector-store VectorStore}
 * implementations expect, from the tool's `type`/`ghusers` inputs. The DynamoDB store
 * applies these by strict equality over stored metadata keys; the S3 store honors the
 * filterable keys (`type`, `subType`) and always constrains to the active version.
 *
 * Mapping:
 *   - `type` (non-empty string) -> `filters.type` (both stores filter on `type`).
 *   - `ghusers` -> `filters.owner`, but ONLY when exactly one owner is requested. The
 *     stores filter by strict equality (single value); an array of owners cannot be
 *     expressed as one equality condition, so multiple/zero owners are not pushed down
 *     (the index scope already limits content to configured orgs, matching the keyword
 *     path, which does not push `ghusers` into the index query). Note the S3 store does
 *     not include `owner` in its filterable allowlist, so `owner` narrows the DynamoDB
 *     store and is ignored by S3.
 *
 * @param {Object} [options] - Filter inputs.
 * @param {string} [options.type] - Result type filter (documentation, template-pattern, code-example).
 * @param {(string|string[])} [options.ghusers] - GitHub users/orgs to narrow to.
 * @returns {Object} A flat equality-filter object (possibly empty) for `VectorStore.query`.
 * @example
 * buildSemanticFilters({ type: 'documentation' });
 * // { type: 'documentation' }
 *
 * @example
 * buildSemanticFilters({ type: 'documentation', ghusers: ['63klabs'] });
 * // { type: 'documentation', owner: '63klabs' }
 *
 * @example
 * buildSemanticFilters({ ghusers: ['63klabs', 'acme'] });
 * // {}  (multiple owners cannot be a single equality filter)
 */
function buildSemanticFilters({ type, ghusers } = {}) {
  const filters = {};
  // >! Only accept the known filter fields; never spread arbitrary caller keys into the
  // >! store filter (which could reference a non-filterable/unexpected metadata key).
  if (typeof type === 'string' && type.trim().length > 0) {
    filters.type = type;
  }
  const owners = normalizeGhusers(ghusers);
  if (owners.length === 1) {
    filters.owner = owners[0];
  }
  return filters;
}

/**
 * Abstract retrieval strategy. Concrete strategies extend this class and override
 * {@link RetrievalStrategy#retrieve}. Calling `retrieve` on the base class throws a
 * {@link RetrievalError} with `code === 'NOT_IMPLEMENTED'`, so a partially implemented
 * subclass fails loudly rather than silently returning nothing.
 *
 * The retrieval contract (implemented by every concrete strategy):
 *   `retrieve({ query, type, ghusers, topK, authInfo, version })` resolves to
 *   `{ results, totalResults, query, suggestions }`, where `results` is an array of the
 *   existing `search_documentation` result objects. All strategies return this SAME shape
 *   so the tool's response contract is identical regardless of the active strategy.
 *
 * @abstract
 * @example
 * // Concrete strategies are constructed with their injected dependencies:
 * const keyword = new KeywordRetrieval({ keywordSearchFn });
 * const semantic = new SemanticRetrieval({ embeddingProvider, vectorStore, buildResults });
 */
class RetrievalStrategy {
  /**
   * Creates a new RetrievalStrategy. The base class stores nothing; subclasses capture
   * their own injected dependencies. Accepting the deps object here keeps a uniform
   * constructor signature across strategies.
   *
   * @param {Object} [_deps] - Injected dependencies (subclass-specific).
   */
  constructor(_deps = {}) {
    // Intentionally empty: subclasses capture the dependencies they need.
  }

  /**
   * Retrieves documentation results for a query. Overridden by concrete strategies.
   *
   * @abstract
   * @async
   * @param {Object} _options - Retrieval options.
   * @param {string} _options.query - The search query (keywords or natural language).
   * @param {string} [_options.type] - Result type filter (documentation, template-pattern, code-example).
   * @param {(string|string[])} [_options.ghusers] - GitHub users/orgs to narrow to.
   * @param {number} [_options.topK] - Maximum number of results to return.
   * @param {Object} [_options.authInfo] - Resolved caller auth context (`{ tier, ... }`); used for gating/observability, never logged as PII.
   * @param {string} [_options.version] - Active index version to search (semantic strategies).
   * @returns {Promise<{results: Array<Object>, totalResults: number, query: string, suggestions: string[]}>} The search response.
   * @throws {RetrievalError} Always on the base class (`code === 'NOT_IMPLEMENTED'`); concrete strategies throw strategy-specific codes on failure.
   */
  async retrieve(_options) {
    throw RetrievalStrategy.#notImplemented('retrieve');
  }

  /**
   * Builds the standard "not implemented" error for an un-overridden abstract method.
   *
   * @private
   * @param {string} methodName - The abstract method name that was called.
   * @returns {RetrievalError} A `NOT_IMPLEMENTED` error to throw.
   */
  static #notImplemented(methodName) {
    return new RetrievalError(
      `${methodName}() is not implemented on the abstract RetrievalStrategy base class. ` +
      'Use a concrete strategy (KeywordRetrieval, SemanticRetrieval) instead of instantiating RetrievalStrategy directly.',
      { code: 'NOT_IMPLEMENTED' }
    );
  }
}

/**
 * Keyword retrieval strategy: a thin wrapper over the EXISTING keyword search. It performs
 * no re-mapping and adds no behavior of its own, so the current `search_documentation`
 * result shape is preserved exactly (Requirements 3.2, 3.4). The keyword search function
 * is injected (dependency injection) so this layer stays decoupled from the read-function.
 *
 * @augments RetrievalStrategy
 * @example
 * const keyword = new KeywordRetrieval({ keywordSearchFn: Services.Documentation.search });
 * const result = await keyword.retrieve({ query: 'cache-data', type: 'documentation' });
 * // result === { results, totalResults, query, suggestions } (unchanged keyword shape)
 */
class KeywordRetrieval extends RetrievalStrategy {
  /**
   * Injected keyword-search function. Kept private so the strategy exposes only `retrieve`.
   *
   * @private
   * @type {Function}
   */
  #keywordSearchFn;

  /**
   * Creates a new KeywordRetrieval.
   *
   * @param {Object} deps - Injected dependencies.
   * @param {Function} deps.keywordSearchFn - The existing keyword search function
   *   (e.g. the documentation service `search`). Called with the retrieve options unchanged;
   *   its return value is passed through untouched to preserve the current result shape.
   * @throws {RetrievalError} `INVALID_CONFIG` when `keywordSearchFn` is not a function.
   */
  constructor({ keywordSearchFn } = {}) {
    super({ keywordSearchFn });
    if (typeof keywordSearchFn !== 'function') {
      throw new RetrievalError(
        'KeywordRetrieval requires a "keywordSearchFn" function dependency.',
        { code: 'INVALID_CONFIG' }
      );
    }
    this.#keywordSearchFn = keywordSearchFn;
  }

  /**
   * Delegates to the injected keyword search function and returns its result unchanged.
   *
   * @async
   * @param {Object} options - Retrieval options (`{ query, type, ghusers, topK, authInfo, version }`).
   * @returns {Promise<{results: Array<Object>, totalResults: number, query: string, suggestions: string[]}>} The keyword search response, passed through unchanged.
   * @example
   * const result = await keyword.retrieve({ query: 'S3 bucket', ghusers: ['63klabs'] });
   */
  async retrieve(options) {
    // >! Pure pass-through: forward the same arguments and return the result unchanged so
    // >! the existing search_documentation result shape is preserved exactly. No added
    // >! validation here, so empty/invalid-query behavior matches the current keyword path.
    return this.#keywordSearchFn(options);
  }
}

/**
 * Semantic retrieval strategy: embeds the query (with caching), queries the configured
 * {@link module:vector-store VectorStore} for nearest neighbours, and maps the hits back
 * to the existing keyword result shape via an injected content-lookup/`buildResults`
 * function (Requirements 2.1, 2.2, 2.3). Each hit's cosine `score` becomes the result's
 * `relevanceScore` so results are indistinguishable in shape from keyword results.
 *
 * On ANY failure (embedding, vector store, or content lookup) it throws a
 * {@link RetrievalError} rather than falling back — the keyword fallback is
 * `selectStrategy`'s responsibility (task 6.3), and a typed error is the seam it catches
 * (Requirement 2.4).
 *
 * @augments RetrievalStrategy
 * @example
 * const semantic = new SemanticRetrieval({
 *   embeddingProvider,   // EmbeddingProvider (or any object with an async embed(text))
 *   vectorStore,         // VectorStore (createVectorStore(...))
 *   buildResults,        // (hits, context) => Promise<result[]>
 *   topK: 10
 * });
 * const result = await semantic.retrieve({ query: 'rotate key', type: 'documentation', version: 'v3' });
 */
class SemanticRetrieval extends RetrievalStrategy {
  /**
   * Injected embedding provider (exposes an async `embed(text)` and, ideally, `model` and
   * `dimensions` used in the cache key).
   * @private
   * @type {Object}
   */
  #embeddingProvider;

  /**
   * Injected vector store (exposes `query(embedding, { version, filters, topK })`).
   * @private
   * @type {Object}
   */
  #vectorStore;

  /**
   * Injected content-lookup/result-building function. Given the ranked vector hits and a
   * query context, it looks up content metadata and returns fully-shaped result objects
   * (including `relevanceScore` mapped from each hit's `score`), in ranked order.
   * @private
   * @type {Function}
   */
  #buildResults;

  /**
   * In-memory query-embedding cache, keyed by normalized query + model + dimensions.
   * @private
   * @type {Map<string, number[]>}
   */
  #cache;

  /**
   * Maximum number of cached query embeddings before FIFO eviction.
   * @private
   * @type {number}
   */
  #maxCacheSize;

  /**
   * Default result count when a call/constructor does not supply a positive `topK`.
   * @private
   * @type {number}
   */
  #defaultTopK;

  /**
   * Count of query-embedding cache hits (for observability/tests).
   * @private
   * @type {number}
   */
  #cacheHits;

  /**
   * Count of query-embedding cache misses (for observability/tests).
   * @private
   * @type {number}
   */
  #cacheMisses;

  /**
   * TEMPORARY DIAGNOSTIC (spec 0-0-6-fix-documentation-index-ai-assist): optional injected
   * logger used ONLY for temporary trace-level diagnostics inside retrieve(), added to find
   * why semantic-assisted retrieval silently returns keyword-shaped results in production.
   * Defaults to a no-op logger, so omitting it is fully backward compatible.
   * @private
   * @type {{warn: Function, error: Function, debug: Function, info: Function}}
   */
  #logger;

  /**
   * Creates a new SemanticRetrieval.
   *
   * @param {Object} deps - Injected dependencies.
   * @param {Object} deps.embeddingProvider - An {@link module:embedding-provider EmbeddingProvider} (or compatible object exposing an async `embed(text)` returning `number[]`; `model`/`dimensions` are used for the cache key when present).
   * @param {Object} deps.vectorStore - A {@link module:vector-store VectorStore} exposing `query(embedding, { version, filters, topK })` returning `Array<{hash, score, metadata}>`.
   * @param {Function} deps.buildResults - Content-lookup/result-building function `(hits, context) => Promise<Array<Object>>`. It looks up content metadata for the hit hashes and returns result objects in the existing `search_documentation` shape (with `relevanceScore` set from each hit's `score`), in ranked order.
   * @param {Map<string, number[]>} [deps.cache] - Optional pre-constructed cache Map (test seam / shared cache); a new Map is created when omitted.
   * @param {number} [deps.maxCacheSize=128] - Maximum cached embeddings before FIFO eviction.
   * @param {number} [deps.topK=10] - Default result count when a call omits a positive `topK`.
   * @param {Object} [deps.logger] - TEMPORARY DIAGNOSTIC seam (see `#logger` above); optional, defaults to a no-op logger.
   * @throws {RetrievalError} `INVALID_CONFIG` when `embeddingProvider`/`vectorStore`/`buildResults` are missing or of the wrong type.
   */
  constructor({ embeddingProvider, vectorStore, buildResults, cache, maxCacheSize, topK, logger } = {}) {
    super({ embeddingProvider, vectorStore, buildResults });

    // >! Fail fast when a required collaborator is missing/wrong-typed, so misconfiguration
    // >! surfaces as a clear typed error rather than a late TypeError mid-retrieve.
    if (!embeddingProvider || typeof embeddingProvider.embed !== 'function') {
      throw new RetrievalError(
        'SemanticRetrieval requires an "embeddingProvider" with an embed(text) method.',
        { code: 'INVALID_CONFIG' }
      );
    }
    if (!vectorStore || typeof vectorStore.query !== 'function') {
      throw new RetrievalError(
        'SemanticRetrieval requires a "vectorStore" with a query(embedding, options) method.',
        { code: 'INVALID_CONFIG' }
      );
    }
    if (typeof buildResults !== 'function') {
      throw new RetrievalError(
        'SemanticRetrieval requires a "buildResults" function dependency.',
        { code: 'INVALID_CONFIG' }
      );
    }

    this.#embeddingProvider = embeddingProvider;
    this.#vectorStore = vectorStore;
    this.#buildResults = buildResults;
    this.#cache = (cache instanceof Map) ? cache : new Map();
    this.#maxCacheSize = (Number.isInteger(maxCacheSize) && maxCacheSize > 0)
      ? maxCacheSize
      : DEFAULT_QUERY_CACHE_SIZE;
    this.#defaultTopK = (Number.isInteger(topK) && topK > 0) ? topK : DEFAULT_TOP_K;
    this.#cacheHits = 0;
    this.#cacheMisses = 0;
    // >! TEMPORARY DIAGNOSTIC: see #logger field doc above.
    this.#logger = normalizeLogger(logger);
  }

  /**
   * Retrieves semantically ranked documentation results for a query.
   *
   * Flow: validate the query → (no active version → empty result set with suggestions,
   * Req 2.5) → embed the query (cached) → build metadata filters from `type`/`ghusers` →
   * `vectorStore.query(embedding, { version, filters, topK })` → map hits to the keyword
   * result shape via the injected `buildResults` (with `score` → `relevanceScore`) →
   * assemble `{ results, totalResults, query, suggestions }`.
   *
   * @async
   * @param {Object} options - Retrieval options.
   * @param {string} options.query - The search query. Must be a non-empty string.
   * @param {string} [options.type] - Result type filter (documentation, template-pattern, code-example).
   * @param {(string|string[])} [options.ghusers] - GitHub users/orgs to narrow to.
   * @param {number} [options.topK] - Maximum number of results (defaults to the constructor `topK`, else 10).
   * @param {Object} [options.authInfo] - Resolved caller auth context (`{ tier, ... }`); passed to `buildResults` context, never logged as PII.
   * @param {string} [options.version] - Active index version to search. When absent, an empty result set with suggestions is returned (Req 2.5).
   * @returns {Promise<{results: Array<Object>, totalResults: number, query: string, suggestions: string[]}>} The semantic search response, in the same shape as keyword results.
   * @throws {RetrievalError} `INVALID_QUERY` when `query` is not a non-empty string; `RETRIEVAL_FAILED` (with `cause`) when embedding, the vector-store query, or content lookup fails.
   * @example
   * const result = await semantic.retrieve({ query: 'rotate the key', type: 'documentation', version: 'v3' });
   * console.log(result.results[0].relevanceScore); // cosine similarity of the top hit
   */
  async retrieve(options) {
    const opts = (options && typeof options === 'object') ? options : {};
    const { query, type, ghusers, topK, authInfo, version } = opts;

    // >! Validate the untrusted query before embedding or building a cache key.
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new RetrievalError(
        'SemanticRetrieval requires a non-empty "query" string.',
        { code: 'INVALID_QUERY' }
      );
    }

    // >! No active index version -> return an empty result set with suggestions (Req 2.5),
    // >! matching the keyword path instead of erroring, and skipping the Bedrock call.
    if (typeof version !== 'string' || version.trim().length === 0) {
      return SemanticRetrieval.#emptyResponse(query);
    }

    const effectiveTopK = (Number.isInteger(topK) && topK > 0) ? topK : this.#defaultTopK;

    try {
      // >! TEMPORARY DIAGNOSTIC (remove after root-causing spec 0-0-6-fix-documentation-index-ai-assist):
      // >! trace every stage of SemanticRetrieval.retrieve() at INFO level (visible in PROD),
      // >! since production traces show zero log output between strategy selection and the
      // >! cache write despite keyword-shaped results being returned.
      this.#logger.info('DIAG: SemanticRetrieval.retrieve start', { version, effectiveTopK });

      const embedding = await this.#embedQuery(query);
      this.#logger.info('DIAG: SemanticRetrieval embedding obtained', {
        embeddingLength: Array.isArray(embedding) ? embedding.length : null,
        cacheStats: this.getCacheStats()
      });

      const filters = buildSemanticFilters({ type, ghusers });
      this.#logger.info('DIAG: SemanticRetrieval filters built', { filters });

      const hits = await this.#vectorStore.query(embedding, {
        version,
        filters,
        topK: effectiveTopK
      });
      const rankedHits = Array.isArray(hits) ? hits : [];
      this.#logger.info('DIAG: SemanticRetrieval vectorStore.query resolved', {
        hitsLength: rankedHits.length,
        topHashes: rankedHits.slice(0, 3).map((h) => h && h.hash)
      });

      // >! Content lookup + shaping is injected (decoupling): it fetches content metadata
      // >! for the hit hashes and returns result objects in the existing shape, with each
      // >! hit's cosine `score` mapped onto `relevanceScore` so parity holds.
      const built = await this.#buildResults(rankedHits, {
        query,
        type,
        ghusers,
        topK: effectiveTopK,
        version,
        authInfo
      });
      const results = Array.isArray(built) ? built : [];
      this.#logger.info('DIAG: SemanticRetrieval buildResults resolved', {
        resultsLength: results.length,
        firstRelevanceScore: results[0] ? results[0].relevanceScore : null
      });

      return {
        results,
        totalResults: results.length,
        query,
        suggestions: results.length === 0 ? SEMANTIC_EMPTY_SUGGESTIONS.slice() : []
      };
    } catch (error) {
      // >! TEMPORARY DIAGNOSTIC: capture what actually failed before wrapping/re-throwing,
      // >! since the wrapped RetrievalError's cause has not been consistently surfaced by
      // >! callers in production traces gathered so far. Also captures error.cause — the
      // >! ORIGINAL underlying error (e.g. the raw AWS SDK exception from a failed
      // >! QueryVectorsCommand) that S3VectorStore.#wrap()/VectorStoreError attaches as
      // >! `cause` when wrapping a non-VectorStoreError failure. The outer code/message/name
      // >! alone (e.g. "QUERY_FAILED") only identifies WHICH call failed, not WHY.
      const cause = error && error.cause;
      this.#logger.warn('DIAG: SemanticRetrieval.retrieve caught an error', {
        code: (error && error.code) || null,
        message: (error && error.message) || null,
        name: (error && error.name) || null,
        causeName: (cause && cause.name) || null,
        causeMessage: (cause && cause.message) || null,
        causeCode: (cause && (cause.code || cause.Code)) || null,
        causeHttpStatus: (cause && cause.$metadata && cause.$metadata.httpStatusCode) || null
      });
      // >! Wrap ANY semantic-path failure as a typed RetrievalError so selectStrategy (6.3)
      // >! can catch it and fall back to keyword search. No fallback is performed here.
      // >! Note (Req 10.5): this strategy does NOT degrade — it re-throws — so the additional
      // >! model-unavailable ERROR line is intentionally NOT emitted here. It is emitted once,
      // >! at the actual degrade point in FallbackRetrieval (which catches this wrapped error
      // >! via error.cause.code and carries the embedding model/region context). Emitting here
      // >! too would double-log the same misconfiguration.
      throw SemanticRetrieval.#wrap(error, 'Semantic retrieval failed.', 'RETRIEVAL_FAILED');
    }
  }

  /**
   * Returns the current query-embedding cache statistics (for observability and tests).
   *
   * @returns {{hits: number, misses: number, size: number, maxSize: number}} Cache stats.
   * @example
   * const { hits, misses, size } = semantic.getCacheStats();
   */
  getCacheStats() {
    return {
      hits: this.#cacheHits,
      misses: this.#cacheMisses,
      size: this.#cache.size,
      maxSize: this.#maxCacheSize
    };
  }

  /**
   * Clears the query-embedding cache and resets the hit/miss counters. Intended for test
   * isolation so cached embeddings from one test do not leak into another.
   *
   * @returns {void}
   * @example
   * afterEach(() => semantic.clearCache());
   */
  clearCache() {
    this.#cache.clear();
    this.#cacheHits = 0;
    this.#cacheMisses = 0;
  }

  /**
   * Embeds a query, returning a cached embedding on a hit and otherwise delegating to the
   * injected embedding provider and caching the result. Updates the hit/miss counters.
   *
   * @private
   * @async
   * @param {string} query - The validated (non-empty) query string.
   * @returns {Promise<number[]>} The query embedding vector.
   */
  async #embedQuery(query) {
    const key = this.#cacheKey(query);
    if (this.#cache.has(key)) {
      // >! Cache hit avoids a repeat Bedrock InvokeModel for an identical query (Req 7.2).
      this.#cacheHits++;
      return this.#cache.get(key);
    }

    this.#cacheMisses++;
    const embedding = await this.#embeddingProvider.embed(query);
    this.#storeInCache(key, embedding);
    return embedding;
  }

  /**
   * Builds the cache key for a query from the normalized query plus the embedding model
   * and dimensions, so different models/dimensions never collide on one cached embedding
   * (Requirement 7.2).
   *
   * @private
   * @param {string} query - The query string.
   * @returns {string} The cache key.
   */
  #cacheKey(query) {
    const model = (typeof this.#embeddingProvider.model === 'string')
      ? this.#embeddingProvider.model
      : '';
    const dims = Number.isInteger(this.#embeddingProvider.dimensions)
      ? this.#embeddingProvider.dimensions
      : 0;
    // NUL separators cannot appear in a model id / normalized query, so the key is
    // unambiguous across the (model, dims, query) triple.
    return `${model}\u0000${dims}\u0000${normalizeQuery(query)}`;
  }

  /**
   * Stores an embedding in the bounded cache, evicting the oldest entry (FIFO by insertion
   * order) when the cache is full, so memory stays bounded and eviction is deterministic.
   *
   * @private
   * @param {string} key - The cache key.
   * @param {number[]} embedding - The embedding vector to cache.
   * @returns {void}
   */
  #storeInCache(key, embedding) {
    if (!this.#cache.has(key) && this.#cache.size >= this.#maxCacheSize) {
      const oldestKey = this.#cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.#cache.delete(oldestKey);
      }
    }
    this.#cache.set(key, embedding);
  }

  /**
   * Builds the standard empty-result response (used when there is no active index version).
   *
   * @private
   * @param {string} query - The query string echoed back in the response.
   * @returns {{results: Array<Object>, totalResults: number, query: string, suggestions: string[]}} The empty response.
   */
  static #emptyResponse(query) {
    return {
      results: [],
      totalResults: 0,
      query,
      suggestions: SEMANTIC_EMPTY_SUGGESTIONS.slice()
    };
  }

  /**
   * Wraps a caught error as a typed {@link RetrievalError}, passing through errors that are
   * already `RetrievalError` (so specific codes like `INVALID_QUERY` are preserved).
   *
   * @private
   * @param {Error} error - The caught error (e.g. an `EmbeddingError` or `VectorStoreError`).
   * @param {string} message - Human-readable wrapper message (never includes the query or vector data).
   * @param {string} code - The `RetrievalError` code to use when wrapping.
   * @returns {RetrievalError} The typed error to throw.
   */
  static #wrap(error, message, code) {
    if (error instanceof RetrievalError) {
      return error;
    }
    return new RetrievalError(message, { code, cause: error });
  }
}

/**
 * Semantic-assisted retrieval strategy: runs a plain {@link SemanticRetrieval} to fetch a
 * slightly larger candidate set, then uses a small assist model (via an injected
 * {@link module:assist-provider AssistProvider}) to RE-RANK those candidates by relevance
 * to the query. The assist model returns ONLY an ordering of candidate indices — never
 * prose — so the final results are a reordering of the SAME result objects the semantic
 * path produced (Requirements 5.1, 5.2). The response shape is byte-for-byte identical to
 * the semantic/keyword path, so switching `DOC_AI_RETRIEVAL_MODE` to `semantic-assisted`
 * requires no caller change (Requirement 5.4).
 *
 * This strategy reuses (rather than reimplements) {@link SemanticRetrieval}: that gives it
 * query-embedding caching, the vector query, the "no active index version -> empty result
 * set" behavior, and the exact result shaping for free, and keeps the two strategies
 * consistent.
 *
 * Resilience & observability:
 *   - Graceful degrade (Requirement 5.3): on ANY assist/LLM re-rank failure this strategy
 *     does NOT throw — it logs ONE non-sensitive warning (strategy + store + error
 *     code/message) and returns the plain semantic results it already fetched BEFORE the
 *     re-rank, sliced to the effective `topK`. Only the assist step degrades; a failure in
 *     the underlying semantic strategy (embedding / vector store) is thrown BEFORE the
 *     assist try/catch (the semantic call sits outside it), so it propagates as that
 *     strategy's own typed {@link RetrievalError} and {@link selectStrategy}'s
 *     {@link FallbackRetrieval} still falls back to keyword for a genuine semantic failure
 *     (Requirement 2.4). The class therefore no longer throws `ASSIST_FAILED` in normal
 *     operation.
 *   - Usage/cost logging (Requirements 5.5, 7.4): on a SUCCESSFUL assist re-rank it emits a
 *     stable, greppable {@link USAGE_LOG_PREFIX} log line carrying the strategy label, the
 *     injected vector-store label, and the assist model's `inputTokens`/`outputTokens`/
 *     `totalTokens` (from `assist.rerank`'s `usage`) so cost can be compared across
 *     stores/modes. It is emitted at INFO level (via the injected logger's `info`) so it is
 *     visible in PROD, where the read-function runs at `LOG_LEVEL=INFO` and cost tracking
 *     matters — that is what lets task 8.2's metric filter populate in PROD (a `debug` line
 *     would be suppressed there). The `<= 1 candidate` short-circuit spends no assist tokens
 *     and emits no usage line (only a `debug` trace). The logging path never throws and never
 *     includes PII (no query text, candidate titles/excerpts, embeddings, or caller identity).
 *
 * @augments RetrievalStrategy
 * @example
 * const assisted = new SemanticAssistedRetrieval({
 *   semantic,            // a SemanticRetrieval instance
 *   assist,              // an AssistProvider instance (assist.rerank({ query, candidates, topK }))
 *   candidateMultiplier: 3,
 *   maxCandidates: 25,
 *   topK: 10,
 *   storeType: 's3-vectors', // vector-store label, used ONLY for usage/degrade logging
 *   logger: DebugAndLog      // optional { warn, error, debug, info }
 * });
 * const result = await assisted.retrieve({ query: 'rotate the key', type: 'documentation', version: 'v3' });
 * // result === { results, totalResults, query, suggestions } (same shape as semantic/keyword)
 */
class SemanticAssistedRetrieval extends RetrievalStrategy {
  /**
   * Injected plain semantic strategy (exposes an async `retrieve(options)`), used to fetch
   * the candidate result set that the assist model then re-ranks.
   * @private
   * @type {Object}
   */
  #semantic;

  /**
   * Injected assist provider (exposes an async `rerank({ query, candidates, topK })`
   * returning `{ order, usage }`).
   * @private
   * @type {Object}
   */
  #assist;

  /**
   * Multiplier applied to the effective `topK` to size the candidate fetch.
   * @private
   * @type {number}
   */
  #candidateMultiplier;

  /**
   * Upper bound on candidates fetched/re-ranked, regardless of `topK * candidateMultiplier`.
   * @private
   * @type {number}
   */
  #maxCandidates;

  /**
   * Default result count when a call omits a positive `topK`.
   * @private
   * @type {number}
   */
  #topK;

  /**
   * Normalized `{ warn, error, debug, info }` logger used for the non-sensitive `<=1 candidate`
   * debug trace (debug), the successful-re-rank usage/cost line (info, so it is PROD-visible),
   * and the graceful-degrade warning (warn).
   * @private
   * @type {{warn: Function, error: Function, debug: Function, info: Function}}
   */
  #logger;

  /**
   * Vector-store label used ONLY in usage/degrade logging (e.g. `'s3-vectors'`,
   * `'dynamodb'`), sourced later from `documentation.ai.vectorStore`. Never affects
   * retrieval behavior; defaults to `'unknown'` when not injected.
   * @private
   * @type {string}
   */
  #storeType;

  /**
   * Creates a new SemanticAssistedRetrieval.
   *
   * @param {Object} deps - Injected dependencies.
   * @param {Object} deps.semantic - REQUIRED plain semantic strategy (a {@link SemanticRetrieval} or compatible object exposing an async `retrieve(options)` that returns `{ results, totalResults, query, suggestions }`).
   * @param {Object} deps.assist - REQUIRED assist provider (an {@link module:assist-provider AssistProvider} or compatible object exposing an async `rerank({ query, candidates, topK })` returning `{ order, usage }`).
   * @param {number} [deps.candidateMultiplier=3] - Multiplier applied to the effective `topK` to size the candidate fetch.
   * @param {number} [deps.maxCandidates=25] - Upper bound on candidates fetched and re-ranked.
   * @param {number} [deps.topK=10] - Default result count when a call omits a positive `topK`.
   * @param {Object} [deps.logger] - Optional `{ warn, error, debug, info }` logger; defaults to a no-op logger (the layer never imports `DebugAndLog`). The usage/cost line is emitted via `info` so it is visible in PROD (`LOG_LEVEL=INFO`).
   * @param {string} [deps.storeType='unknown'] - Vector-store label (e.g. `'s3-vectors'`, `'dynamodb'`) used ONLY in usage/degrade logging; sourced later from `documentation.ai.vectorStore`. Never changes retrieval behavior.
   * @throws {RetrievalError} `INVALID_CONFIG` when `semantic` lacks a `retrieve()` method or `assist` lacks a `rerank()` method.
   */
  constructor({ semantic, assist, candidateMultiplier, maxCandidates, topK, logger, storeType } = {}) {
    super({ semantic, assist });

    // >! Fail fast when a required collaborator is missing/wrong-typed, so misconfiguration
    // >! surfaces as a clear typed error rather than a late TypeError mid-retrieve.
    if (!semantic || typeof semantic.retrieve !== 'function') {
      throw new RetrievalError(
        'SemanticAssistedRetrieval requires a "semantic" strategy with a retrieve() method.',
        { code: 'INVALID_CONFIG' }
      );
    }
    if (!assist || typeof assist.rerank !== 'function') {
      throw new RetrievalError(
        'SemanticAssistedRetrieval requires an "assist" provider with a rerank() method.',
        { code: 'INVALID_CONFIG' }
      );
    }

    this.#semantic = semantic;
    this.#assist = assist;
    this.#candidateMultiplier = (Number.isInteger(candidateMultiplier) && candidateMultiplier > 0)
      ? candidateMultiplier
      : DEFAULT_CANDIDATE_MULTIPLIER;
    this.#maxCandidates = (Number.isInteger(maxCandidates) && maxCandidates > 0)
      ? maxCandidates
      : DEFAULT_ASSIST_MAX_CANDIDATES;
    this.#topK = (Number.isInteger(topK) && topK > 0) ? topK : DEFAULT_TOP_K;
    this.#logger = normalizeLogger(logger);
    // >! Logging label only (never used to select a store or build a query), so an
    // >! unexpected value cannot change retrieval behavior; default keeps logs well-formed.
    this.#storeType = (typeof storeType === 'string' && storeType.trim().length > 0)
      ? storeType.trim()
      : DEFAULT_STORE_LABEL;
  }

  /**
   * Retrieves semantic results and re-ranks them with the assist model, logging usage on
   * success and gracefully degrading to plain semantic results on an assist failure.
   *
   * Flow: fetch `min(effectiveTopK * candidateMultiplier, maxCandidates)` candidates from
   * the injected semantic strategy -> if there is nothing meaningful to re-rank (<= 1
   * candidate, which also covers the "no active index version -> empty" case) return the
   * candidates sliced to `effectiveTopK` WITHOUT calling the LLM (and WITHOUT a usage line,
   * since no assist tokens are spent) -> otherwise build lightweight
   * `{ index, title, excerpt }` descriptors, ask the assist model for an ordering, emit a
   * usage/cost log line for the spent tokens (Req 5.5, 7.4), deterministically reorder the
   * EXISTING results by that ordering (appending any result the ordering did not reference,
   * preserving semantic order), and slice to `effectiveTopK`. If the assist re-rank throws,
   * log one non-sensitive warning and DEGRADE to the plain semantic results already fetched,
   * sliced to `effectiveTopK` (Req 5.3) — the response shape is unchanged either way.
   *
   * @async
   * @param {Object} options - Retrieval options.
   * @param {string} options.query - The search query.
   * @param {string} [options.type] - Result type filter (documentation, template-pattern, code-example).
   * @param {(string|string[])} [options.ghusers] - GitHub users/orgs to narrow to.
   * @param {number} [options.topK] - Maximum number of results (defaults to the constructor `topK`, else 10).
   * @param {Object} [options.authInfo] - Resolved caller auth context (`{ tier, ... }`); forwarded to the semantic strategy, never logged as PII.
   * @param {string} [options.version] - Active index version to search. When absent, the semantic strategy returns an empty set and this strategy returns it unchanged (no LLM call).
   * @returns {Promise<{results: Array<Object>, totalResults: number, query: string, suggestions: string[]}>} The re-ranked (or, on assist failure, plain semantic) search response, in the same shape as semantic/keyword results.
   * @throws {RetrievalError} A failure in the underlying semantic strategy (embedding / vector store) propagates as that strategy's own typed `RetrievalError`. An assist/LLM re-rank failure does NOT throw — it is caught, logged, and gracefully degraded to the plain semantic results.
   * @example
   * const result = await assisted.retrieve({ query: 'rotate the key', type: 'documentation', version: 'v3' });
   * console.log(result.results.length); // <= effective topK
   */
  async retrieve(options) {
    const opts = (options && typeof options === 'object') ? options : {};
    const { query, type, ghusers, topK, authInfo, version } = opts;

    const effectiveTopK = (Number.isInteger(topK) && topK > 0) ? topK : this.#topK;
    // Fetch more candidates than requested so the assist model can promote a strong hit.
    const candidateCount = Math.min(effectiveTopK * this.#candidateMultiplier, this.#maxCandidates);

    // >! Reuse the injected semantic strategy for embedding caching, the vector query, result
    // >! shaping, and the "no active version -> empty" behavior. A semantic failure here throws
    // >! its own typed RetrievalError, which propagates (and selectStrategy falls back to keyword).
    const candidateEnvelope = await this.#semantic.retrieve({
      query,
      type,
      ghusers,
      topK: candidateCount,
      authInfo,
      version
    });

    const candidateResults = (candidateEnvelope && Array.isArray(candidateEnvelope.results))
      ? candidateEnvelope.results
      : [];

    // Nothing meaningful to re-rank (0 results -> no active version/no hits; 1 result -> order
    // is already fixed). Return the candidates sliced to effectiveTopK WITHOUT an LLM call.
    if (candidateResults.length <= 1) {
      this.#logger.debug('SemanticAssistedRetrieval: <=1 candidate; returning semantic results without an assist re-rank.');
      return SemanticAssistedRetrieval.#sliceEnvelope(candidateEnvelope, candidateResults, effectiveTopK, query);
    }

    try {
      // Lightweight descriptors: index is the candidate's position in the semantic result set,
      // so the assist ordering maps directly back onto candidateResults.
      const candidates = candidateResults.map((result, index) => ({
        index,
        title: SemanticAssistedRetrieval.#safeString(result && result.title),
        excerpt: SemanticAssistedRetrieval.#safeString(result && result.excerpt)
      }));

      const { order, usage } = await this.#rerank({ query, candidates, topK: effectiveTopK });

      // >! Assist re-rank succeeded: emit the usage/cost line for the tokens just spent
      // >! (Req 5.5, 7.4). #logUsage never throws, so it cannot turn success into a degrade.
      this.#logUsage(usage);

      // >! Deterministically reorder the EXISTING result objects by the assist ordering. The
      // >! assist output is used ONLY as an ordering of existing results — no model-generated
      // >! text is ever inserted into any result field (no-prose guarantee, Req 5.2).
      const reordered = SemanticAssistedRetrieval.#applyOrder(candidateResults, order);
      return SemanticAssistedRetrieval.#sliceEnvelope(candidateEnvelope, reordered, effectiveTopK, query);
    } catch (error) {
      // >! Graceful degrade (Req 5.3, 7.4): an assist/LLM re-rank failure must NOT fail the
      // >! request. Log ONE non-sensitive warning (strategy + store + error code/message only)
      // >! and return the plain semantic results already fetched BEFORE the re-rank, sliced to
      // >! effectiveTopK. NEVER log the query text, candidate titles/excerpts, embeddings, or
      // >! authInfo identity (PII). Only the assist step degrades here — a semantic-strategy
      // >! failure was thrown earlier (outside this try) and already propagated as its own
      // >! typed RetrievalError, so selectStrategy still falls back to keyword for a genuine
      // >! semantic failure.
      const code = (error && typeof error.code === 'string') ? error.code : 'UNKNOWN';
      const reason = (error && typeof error.message === 'string') ? error.message : 'unknown error';
      this.#logger.warn(
        `RetrievalStrategy "${ASSISTED_STRATEGY_LABEL}" (store=${this.#storeType}) assist re-rank failed ` +
        `(code=${code}); degrading to plain semantic results. Reason: ${reason}`
      );
      // >! A model-not-available classification (Req 10.5) is a configuration problem — the
      // >! assist model / inference profile is missing, invalid, or unauthorized in the
      // >! targeted region/account — not routine degrade noise. Emit ONE additional
      // >! ERROR-level line carrying the assist model id and the region the assist call
      // >! targeted. The assist path relies on AWS server-side cross-region routing (no
      // >! client-side region override, Req 10.3), so the targeted region is the Lambda's own
      // >! deployment region (AWS_REGION). This never changes the degrade above: the plain
      // >! semantic results are still returned below. No PII is logged.
      if (isModelUnavailableError(error)) {
        emitModelUnavailableLog(
          this.#logger,
          ASSISTED_STRATEGY_LABEL,
          this.#assist && this.#assist.model,
          process.env.AWS_REGION || ''
        );
      }
      return SemanticAssistedRetrieval.#sliceEnvelope(candidateEnvelope, candidateResults, effectiveTopK, query);
    }
  }

  /**
   * Isolated assist/LLM call seam. Any failure here is caught by
   * {@link SemanticAssistedRetrieval#retrieve}, which logs one non-sensitive warning and
   * gracefully degrades to the plain semantic results (it does NOT throw). On success the
   * returned `usage` (raw Bedrock token counts) is emitted by {@link SemanticAssistedRetrieval#logUsage}
   * as the {@link USAGE_LOG_PREFIX} usage/cost line.
   *
   * @private
   * @async
   * @param {{query: string, candidates: Array<{index: number, title: string, excerpt: string}>, topK: number}} params - Re-rank parameters passed straight through to the assist provider.
   * @returns {Promise<{order: number[], usage: (Object|null)}>} The assist ordering and raw token usage.
   */
  async #rerank(params) {
    return this.#assist.rerank(params);
  }

  /**
   * Emits the stable, machine-parseable usage/cost log line for a SUCCESSFUL assist re-rank
   * (Requirements 5.5, 7.4). The line is the fixed {@link USAGE_LOG_PREFIX} token, one
   * space, then compact JSON with a stable key order:
   *   `DOC_AI_USAGE {"strategy":"semantic-assisted","store":"<store>","inputTokens":<n>,"outputTokens":<n>,"totalTokens":<n>}`
   * Task 8.2 builds a CloudWatch metric filter against this exact prefix/shape.
   *
   * Emitted at INFO level (via the injected logger's `info`) so the usage/cost line is
   * visible in PROD, where the consuming read-function runs at `LOG_LEVEL=INFO` and cost
   * tracking matters. cache-data's `DebugAndLog` suppresses `debug` at `LOG_LEVEL=INFO`, so a
   * `debug` line would only surface in DEV/TEST and task 8.2's metric filter would never
   * populate in PROD; INFO keeps it PROD-visible while still keeping it out of `warn`/`error`.
   * A missing/null `usage` (or any missing field) logs the affected count as `0`. This method
   * NEVER throws: a logging failure must not turn a successful re-rank into a degrade.
   *
   * @private
   * @param {(Object|null)} usage - Raw Bedrock token-count object (`{ inputTokens, outputTokens, totalTokens }`) from `assist.rerank`, or `null`.
   * @returns {void}
   */
  #logUsage(usage) {
    try {
      // >! NO PII: only the fixed strategy label, the store label, and integer token counts
      // >! are logged — never the query text, candidate titles/excerpts, embeddings, or
      // >! authInfo identity. Stable key order keeps the line matchable by task 8.2's filter.
      const payload = {
        strategy: ASSISTED_STRATEGY_LABEL,
        store: this.#storeType,
        inputTokens: SemanticAssistedRetrieval.#tokenCount(usage, 'inputTokens'),
        outputTokens: SemanticAssistedRetrieval.#tokenCount(usage, 'outputTokens'),
        totalTokens: SemanticAssistedRetrieval.#tokenCount(usage, 'totalTokens')
      };
      // >! Emit at INFO (not debug) so this cost/usage line is visible in PROD (LOG_LEVEL=INFO),
      // >! where cache-data's DebugAndLog suppresses debug — that is what lets task 8.2's metric
      // >! filter populate in PROD. Kept out of warn/error since it is neither.
      this.#logger.info(`${USAGE_LOG_PREFIX} ${JSON.stringify(payload)}`);
    } catch {
      // >! Best-effort telemetry: swallow any logging error so it can never fail the request
      // >! or convert a successful assist re-rank into a degrade.
    }
  }

  /**
   * Deterministically reorders `results` by the assist `order`: applies valid, in-range,
   * non-duplicate indices in order, then appends any results the ordering did not reference
   * (preserving their original semantic order) so no result is silently lost.
   *
   * @private
   * @param {Array<Object>} results - The semantic candidate results (indexed by position).
   * @param {number[]} order - The assist ordering of candidate indices.
   * @returns {Array<Object>} The reordered results (same length as `results`).
   */
  static #applyOrder(results, order) {
    const used = new Set();
    const reordered = [];
    const orderList = Array.isArray(order) ? order : [];

    // >! Apply only valid, in-range, non-duplicate indices from the (untrusted) assist ordering.
    for (const index of orderList) {
      if (Number.isInteger(index) && index >= 0 && index < results.length && !used.has(index)) {
        used.add(index);
        reordered.push(results[index]);
      }
    }
    // Append any candidate the ordering skipped, in original semantic order, so nothing is lost.
    for (let i = 0; i < results.length; i++) {
      if (!used.has(i)) {
        reordered.push(results[i]);
      }
    }
    return reordered;
  }

  /**
   * Builds the standard response envelope from a (possibly reordered) result list, slicing
   * to `topK` and preserving the semantic path's `query`/`suggestions` semantics
   * (suggestions are kept only when the sliced result set is empty).
   *
   * @private
   * @param {Object} envelope - The candidate envelope returned by the semantic strategy.
   * @param {Array<Object>} results - The results to place in the envelope (already ordered).
   * @param {number} topK - Maximum number of results to keep.
   * @param {string} fallbackQuery - Query echoed when the candidate envelope has no string `query`.
   * @returns {{results: Array<Object>, totalResults: number, query: string, suggestions: string[]}} The response envelope.
   */
  static #sliceEnvelope(envelope, results, topK, fallbackQuery) {
    const env = (envelope && typeof envelope === 'object') ? envelope : {};
    const sliced = results.slice(0, topK);
    return {
      results: sliced,
      totalResults: sliced.length,
      query: (typeof env.query === 'string') ? env.query : fallbackQuery,
      // Preserve the semantic path's suggestions only for an empty result set (e.g. no active
      // index version); when results exist, no suggestions are returned (parity with semantic).
      suggestions: sliced.length === 0
        ? (Array.isArray(env.suggestions) ? env.suggestions.slice() : [])
        : []
    };
  }

  /**
   * Returns `value` when it is a string, otherwise an empty string. Keeps candidate
   * descriptors well-formed without inventing content.
   *
   * @private
   * @param {*} value - The candidate value (typically a result's `title` or `excerpt`).
   * @returns {string} `value` when a string, else `''`.
   */
  static #safeString(value) {
    return (typeof value === 'string') ? value : '';
  }

  /**
   * Safely reads a single token count from the raw assist `usage` object for the usage log,
   * returning `0` for a missing/null `usage`, a missing field, or any non-finite/negative
   * value. Keeps the emitted counts well-formed integers without ever throwing.
   *
   * @private
   * @param {(Object|null)} usage - The raw token-count object (or `null`).
   * @param {string} key - The token field to read (`'inputTokens'` | `'outputTokens'` | `'totalTokens'`).
   * @returns {number} The token count, or `0` when absent/invalid.
   */
  static #tokenCount(usage, key) {
    const value = (usage && typeof usage === 'object') ? usage[key] : undefined;
    return (Number.isFinite(value) && value >= 0) ? value : 0;
  }
}

/**
 * Rank a tier string against the fixed {@link TIER_RANK} map. The tier is treated as
 * UNTRUSTED input: it is trimmed and lower-cased before lookup, and any value not present
 * in the map resolves to `fallbackRank` (fail-secure) instead of throwing. This helper
 * never promotes an unknown value, so it cannot be used to escalate privilege.
 *
 * @param {string} tier - The tier string (e.g. from `authInfo.tier`).
 * @param {number} [fallbackRank=0] - Rank returned when `tier` is missing/unknown/invalid.
 * @returns {number} The tier's numeric rank, or `fallbackRank` when unrecognized.
 * @example
 * tierRank('paid');      // 2
 * tierRank('PRIVATE');   // 3 (case-insensitive)
 * tierRank(undefined);   // 0 (fallback: lowest tier, does not qualify for semantic)
 * tierRank('bogus', 2);  // 2 (fallback)
 */
function tierRank(tier, fallbackRank = 0) {
  if (typeof tier === 'string') {
    const key = tier.trim().toLowerCase();
    // >! Only accept known tier names; anything else fails secure to `fallbackRank` so an
    // >! unexpected/forged tier value can never rank higher than a real tier.
    if (Object.prototype.hasOwnProperty.call(TIER_RANK, key)) {
      return TIER_RANK[key];
    }
  }
  return fallbackRank;
}

/**
 * Normalize an injected logger into a complete `{ warn, error, debug, info }` object, filling
 * any missing method with a {@link NOOP}. Present methods are bound to the source logger so a
 * logger whose methods rely on `this` (e.g. a class exposing static methods like
 * `DebugAndLog`) keeps working when its method is called through the normalized object.
 *
 * `info` is included so the usage/cost line can be emitted at INFO level (visible in PROD,
 * where the consuming read-function runs at `LOG_LEVEL=INFO`); `warn`/`error` are also
 * PROD-visible, while `debug` is used only for non-essential traces suppressed in PROD.
 *
 * @private
 * @param {Object} [logger] - Optional logger exposing any subset of `warn`/`error`/`debug`/`info`.
 * @returns {{warn: Function, error: Function, debug: Function, info: Function}} A complete logger (no-op where a method is absent).
 */
function normalizeLogger(logger) {
  // >! FIX (spec 0-0-6-fix-documentation-index-ai-assist): `typeof logger === 'object'` is
  // >! false for a class reference used as a static-method namespace (e.g. cache-data's
  // >! `DebugAndLog`, which is exactly what this doc comment above describes and what every
  // >! call site in this file passes) — `typeof` on a class/function is `'function'`, not
  // >! `'object'`. The old object-only guard silently fell through to `{}`, turning every
  // >! returned method into a no-op NOOP for that entire class of logger. Accept both shapes.
  const src = (logger && (typeof logger === 'object' || typeof logger === 'function')) ? logger : {};
  return {
    warn: typeof src.warn === 'function' ? src.warn.bind(src) : NOOP,
    error: typeof src.error === 'function' ? src.error.bind(src) : NOOP,
    debug: typeof src.debug === 'function' ? src.debug.bind(src) : NOOP,
    info: typeof src.info === 'function' ? src.info.bind(src) : NOOP
  };
}

/**
 * Returns true when a caught error indicates the Bedrock model / inference profile is not
 * available in the targeted region/account — either directly (`error.code`) or via the
 * wrapped underlying error (`error.cause.code`). A `SemanticRetrieval` failure reaches
 * `FallbackRetrieval` as a wrapped `RetrievalError` (so the classification lives on
 * `error.cause.code`), while an assist failure reaches `SemanticAssistedRetrieval` as an
 * `AssistError` (so it lives on `error.code`); this helper handles both shapes.
 *
 * Used to decide whether to emit the extra ERROR-level {@link MODEL_UNAVAILABLE_EVENT} line
 * alongside the routine WARN degrade (Requirement 10.5). It never throws.
 *
 * @param {*} error - The caught error (e.g. a wrapped `RetrievalError` or an `AssistError`).
 * @returns {boolean} True when the failure is a `MODEL_NOT_AVAILABLE` classification.
 * @example
 * isModelUnavailableError(new RetrievalError('x', { code: 'RETRIEVAL_FAILED', cause: { code: 'MODEL_NOT_AVAILABLE' } })); // true
 * isModelUnavailableError(new RetrievalError('x', { code: 'RETRIEVAL_FAILED' })); // false
 */
function isModelUnavailableError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  if (error.code === 'MODEL_NOT_AVAILABLE') {
    return true;
  }
  return !!(error.cause && typeof error.cause === 'object' && error.cause.code === 'MODEL_NOT_AVAILABLE');
}

/**
 * Emit the single additional ERROR-level {@link MODEL_UNAVAILABLE_EVENT} log line through
 * the injected logger, carrying the strategy label, the Bedrock model id, and the region
 * that was targeted. The line is the fixed {@link MODEL_UNAVAILABLE_EVENT} token, one space,
 * then compact JSON with a stable key order, mirroring the indexer's line:
 *   `doc_ai_bedrock_model_unavailable {"strategy":"semantic","model":"amazon.titan-embed-text-v2:0","region":"us-east-1"}`
 *
 * Security / no-PII: only the fixed event token, the strategy label, the model id, and the
 * region are logged — never the query text, candidate titles/excerpts, embeddings, filters,
 * or caller identity. The `region` falls back to the Lambda deployment region (`AWS_REGION`)
 * when no explicit override is known, matching index-builder.js. This never changes the
 * degrade behavior and NEVER throws: a logging failure must not turn a graceful degrade into
 * a thrown error.
 *
 * @param {{error: Function}} logger - Normalized logger (its `error` method is used).
 * @param {string} strategy - Strategy label (e.g. `'semantic'`, `'semantic-assisted'`).
 * @param {string} model - The Bedrock model id that was targeted (embedding or assist).
 * @param {string} region - The region that was targeted; empty string when unknown.
 * @returns {void}
 */
function emitModelUnavailableLog(logger, strategy, model, region) {
  try {
    // >! NO PII: only the fixed event token, strategy label, model id, and region are
    // >! logged. Stable key order keeps the line matchable by a single CloudWatch metric
    // >! filter shared with the indexer's identical event name.
    logger.error(`${MODEL_UNAVAILABLE_EVENT} ${JSON.stringify({
      strategy: (typeof strategy === 'string') ? strategy : '',
      model: (typeof model === 'string') ? model : '',
      region: (typeof region === 'string') ? region : ''
    })}`);
  } catch {
    // >! Best-effort telemetry: swallow any logging error so it can never fail the request
    // >! or convert a graceful degrade into a thrown error.
  }
}

/**
 * Fallback-wrapping retrieval strategy produced by {@link selectStrategy} when a semantic
 * strategy is selected. Its {@link FallbackRetrieval#retrieve} runs the selected `primary`
 * strategy (semantic or semantic-assisted) and, on ANY thrown error, logs a non-sensitive
 * warning and delegates to the `fallback` (keyword) strategy (Requirement 2.4). Errors
 * thrown by the fallback itself are NOT caught, so a keyword failure propagates to the
 * caller rather than being masked by the wrapper.
 *
 * Exported alongside {@link selectStrategy} so task 6.4 can unit-test the fallback-on-error
 * behavior directly.
 *
 * @augments RetrievalStrategy
 * @example
 * const wrapped = new FallbackRetrieval({
 *   primary: semanticStrategy,   // tried first
 *   fallback: keywordStrategy,   // used when primary throws
 *   logger: DebugAndLog,         // optional; defaults to a no-op logger
 *   strategyName: 'semantic'
 * });
 * const result = await wrapped.retrieve({ query: 'rotate key', version: 'v3' });
 */
class FallbackRetrieval extends RetrievalStrategy {
  /**
   * Primary strategy attempted first.
   * @private
   * @type {Object}
   */
  #primary;

  /**
   * Fallback (keyword) strategy used when the primary throws.
   * @private
   * @type {Object}
   */
  #fallback;

  /**
   * Normalized `{ warn, error, debug }` logger used for the fallback notice.
   * @private
   * @type {{warn: Function, error: Function, debug: Function}}
   */
  #logger;

  /**
   * Human-readable primary strategy name, used only in the (non-sensitive) fallback log.
   * @private
   * @type {string}
   */
  #strategyName;

  /**
   * Bedrock embedding model id the wrapped semantic primary targets, used ONLY in the
   * additional model-unavailable ERROR log (Req 10.5); empty string when unknown. This is
   * the degrade-to-keyword point for a semantic failure, so the relevant model is always the
   * embedding model (an assist failure degrades inside `SemanticAssistedRetrieval` and never
   * reaches this wrapper).
   * @private
   * @type {string}
   */
  #modelId;

  /**
   * Region the wrapped semantic primary's embedding client targeted (the embedding region
   * override, else the Lambda deployment region), used ONLY in the model-unavailable ERROR
   * log (Req 10.5); empty string when unknown.
   * @private
   * @type {string}
   */
  #region;

  /**
   * Creates a new FallbackRetrieval.
   *
   * @param {Object} deps - Injected dependencies.
   * @param {Object} deps.primary - The primary strategy tried first (must expose an async `retrieve(options)`).
   * @param {Object} deps.fallback - The fallback strategy (keyword) used when `primary` throws (must expose an async `retrieve(options)`).
   * @param {Object} [deps.logger] - Optional `{ warn, error, debug }` logger; defaults to a no-op logger so the layer stays silent unless a logger is injected.
   * @param {string} [deps.strategyName='semantic'] - Name of the primary strategy, used only in the non-sensitive fallback log message.
   * @param {string} [deps.model] - The Bedrock embedding model id the semantic primary targets. Used ONLY in the additional `MODEL_NOT_AVAILABLE` ERROR log (Req 10.5); never affects retrieval.
   * @param {string} [deps.region] - The region the semantic primary's embedding client targets (embedding region override, else the deployment region). Used ONLY in the model-unavailable ERROR log (Req 10.5).
   * @throws {RetrievalError} `INVALID_CONFIG` when `primary` or `fallback` is missing or lacks a `retrieve()` method.
   */
  constructor({ primary, fallback, logger, strategyName, model, region } = {}) {
    super({ primary, fallback });

    // >! Fail fast on a missing/wrong-typed collaborator so misconfiguration surfaces as a
    // >! clear typed error rather than a late TypeError mid-retrieve.
    if (!primary || typeof primary.retrieve !== 'function') {
      throw new RetrievalError(
        'FallbackRetrieval requires a "primary" strategy with a retrieve() method.',
        { code: 'INVALID_CONFIG' }
      );
    }
    if (!fallback || typeof fallback.retrieve !== 'function') {
      throw new RetrievalError(
        'FallbackRetrieval requires a "fallback" strategy with a retrieve() method.',
        { code: 'INVALID_CONFIG' }
      );
    }

    this.#primary = primary;
    this.#fallback = fallback;
    this.#logger = normalizeLogger(logger);
    this.#strategyName = (typeof strategyName === 'string' && strategyName.trim().length > 0)
      ? strategyName.trim()
      : 'semantic';
    // >! Logging context only (Req 10.5): the embedding model id and targeted region for the
    // >! additional model-unavailable ERROR line. Never used to select a store or build a
    // >! query, so an unexpected/empty value cannot change retrieval behavior.
    this.#modelId = (typeof model === 'string') ? model : '';
    this.#region = (typeof region === 'string') ? region : '';
  }

  /**
   * Runs the primary strategy and, on any error, logs a warning and delegates to the
   * fallback (keyword) strategy. The fallback's own errors are intentionally not caught.
   *
   * @async
   * @param {Object} options - Retrieval options (`{ query, type, ghusers, topK, authInfo, version }`).
   * @returns {Promise<{results: Array<Object>, totalResults: number, query: string, suggestions: string[]}>} The primary result, or the keyword fallback result when the primary throws.
   * @example
   * const result = await wrapped.retrieve({ query: 'rotate key', type: 'documentation', version: 'v3' });
   */
  async retrieve(options) {
    try {
      // >! Await here so a rejected promise from the primary is caught by this try/catch
      // >! (and thus falls back to keyword) rather than leaking to the caller.
      return await this.#primary.retrieve(options);
    } catch (error) {
      // >! Log a NON-sensitive fallback notice: strategy name + error code/message only.
      // >! Never log the query text, embeddings, filters, or authInfo identity (PII).
      const code = (error && typeof error.code === 'string') ? error.code : 'UNKNOWN';
      const reason = (error && typeof error.message === 'string') ? error.message : 'unknown error';
      this.#logger.warn(
        `RetrievalStrategy "${this.#strategyName}" failed (code=${code}); falling back to keyword search. Reason: ${reason}`
      );
      // >! A model-not-available classification (Req 10.5) means the semantic path degraded
      // >! because the embedding model is missing/unauthorized in the targeted region — a
      // >! configuration problem, not routine degrade noise. Emit ONE additional ERROR-level
      // >! line carrying the embedding model id and region (injected from settings via
      // >! selectStrategy) so a misconfigured region/model is loud and searchable. This is the
      // >! single degrade point for every semantic failure (SemanticRetrieval re-throws to
      // >! here rather than degrading itself), so the line is emitted exactly once. It never
      // >! changes the keyword fallback below, and it logs no PII.
      if (isModelUnavailableError(error)) {
        emitModelUnavailableLog(this.#logger, this.#strategyName, this.#modelId, this.#region);
      }
      // >! Delegate to keyword. Its errors are intentionally NOT caught here, so a keyword
      // >! failure propagates to the caller instead of being masked by the fallback wrapper.
      return this.#fallback.retrieve(options);
    }
  }
}

/**
 * Selects the retrieval strategy for a `search_documentation` request from the feature
 * configuration and the caller's tier, returning a {@link RetrievalStrategy} that exposes
 * the standard async `retrieve(options)` contract regardless of which path is chosen.
 *
 * Selection predicate — the semantic path is chosen only when ALL hold:
 *   1. `config.enabled === true`
 *   2. `config.retrievalMode !== 'keyword'`
 *   3. `tierRank(tier) >= tierRank(config.minTier)`
 * Otherwise the keyword strategy is returned unchanged (exact result-shape parity;
 * Requirements 3.2, 3.3).
 *
 * Within the semantic path the mode picks the primary strategy:
 *   - `semantic-assisted` -> `strategies.semanticAssisted` when injected, else it DEGRADES
 *     to `strategies.semantic` (SemanticAssistedRetrieval is added in task 7.1, so this
 *     keeps 6.3 forward-compatible).
 *   - `semantic` (or any other non-keyword mode) -> `strategies.semantic`.
 * If the required semantic strategy was not injected, the keyword strategy is returned.
 *
 * When a semantic primary is selected it is wrapped in a {@link FallbackRetrieval} so ANY
 * semantic-path error falls back to keyword search and is logged (Requirement 2.4).
 *
 * Dependency injection: the concrete strategy instances are passed in via `strategies`;
 * this factory NEVER constructs an EmbeddingProvider/VectorStore, so the layer stays
 * decoupled from the read-function and independently testable.
 *
 * @param {Object} [options] - Selection inputs.
 * @param {Object} [options.config] - The `documentation.ai` settings object (`{ enabled, minTier, retrievalMode, ... }`). Missing/partial config is treated as disabled (keyword).
 * @param {string} [options.tier] - The caller's tier (from `authInfo.tier`). Treated as untrusted: an unknown/missing tier ranks as `public` and never qualifies for the semantic path.
 * @param {Object} options.strategies - Pre-built strategy instances.
 * @param {Object} options.strategies.keyword - REQUIRED keyword strategy (the fallback); must expose an async `retrieve(options)`.
 * @param {Object} [options.strategies.semantic] - Optional semantic strategy.
 * @param {Object} [options.strategies.semanticAssisted] - Optional semantic-assisted strategy (task 7.1).
 * @param {Object} [options.logger] - Optional `{ warn, error, debug }` logger for fallback logging; defaults to a no-op logger (the layer never imports `DebugAndLog`).
 * @returns {RetrievalStrategy} The keyword strategy (pass-through) or a {@link FallbackRetrieval}-wrapped semantic strategy — both expose the same `retrieve(options)` contract.
 * @throws {RetrievalError} `INVALID_CONFIG` when `strategies.keyword` is missing or lacks a `retrieve()` method (there is no safe fallback without it).
 * @example
 * // Disabled, keyword mode, or below tier -> keyword pass-through:
 * const strategy = selectStrategy({
 *   config: { enabled: false },
 *   tier: 'public',
 *   strategies: { keyword }
 * });
 * const result = await strategy.retrieve({ query: 'cache-data', type: 'documentation' });
 *
 * @example
 * // Enabled + paid minimum + private caller + semantic mode -> semantic wrapped with a
 * // keyword fallback (any semantic error transparently degrades to keyword):
 * const strategy = selectStrategy({
 *   config: { enabled: true, minTier: 'paid', retrievalMode: 'semantic' },
 *   tier: 'private',
 *   strategies: { keyword, semantic },
 *   logger: DebugAndLog
 * });
 * const result = await strategy.retrieve({ query: 'rotate the key', version: 'v3' });
 */
function selectStrategy({ config, tier, strategies, logger } = {}) {
  // >! Require the keyword strategy up front: it is the fallback, so without it there is no
  // >! safe path. Fail loudly with a typed error rather than returning something unusable.
  const strats = (strategies && typeof strategies === 'object') ? strategies : {};
  if (!strats.keyword || typeof strats.keyword.retrieve !== 'function') {
    throw new RetrievalError(
      'selectStrategy requires strategies.keyword with a retrieve() method (no safe fallback without it).',
      { code: 'INVALID_CONFIG' }
    );
  }

  const log = normalizeLogger(logger);
  const cfg = (config && typeof config === 'object') ? config : {};

  const enabled = cfg.enabled === true;
  const mode = cfg.retrievalMode;
  // >! Untrusted tier -> unknown/missing ranks as public (0), so it cannot reach the gate.
  const callerRank = tierRank(tier, TIER_RANK.public);
  // >! Unknown/missing minTier -> paid rank (fail secure: harder to qualify, never easier).
  const minRank = tierRank(cfg.minTier, DEFAULT_MIN_TIER_RANK);

  const wantsSemantic = enabled && mode !== 'keyword' && callerRank >= minRank;

  if (!wantsSemantic) {
    // Disabled, keyword mode, or below the minimum tier -> keyword (behavior/shape unchanged).
    return strats.keyword;
  }

  // Choose the semantic primary; semantic-assisted degrades to plain semantic when the
  // assisted strategy is not injected (forward-compatible until task 7.1 lands it).
  let primary = null;
  let strategyName = '';
  if (mode === 'semantic-assisted') {
    if (strats.semanticAssisted && typeof strats.semanticAssisted.retrieve === 'function') {
      primary = strats.semanticAssisted;
      strategyName = 'semantic-assisted';
    } else if (strats.semantic && typeof strats.semantic.retrieve === 'function') {
      primary = strats.semantic;
      strategyName = 'semantic';
      log.debug('selectStrategy: "semantic-assisted" requested but no assisted strategy injected; using plain semantic.');
    }
  } else if (strats.semantic && typeof strats.semantic.retrieve === 'function') {
    primary = strats.semantic;
    strategyName = 'semantic';
  }

  if (!primary) {
    // The mode/tier qualified for semantic, but the required semantic strategy was not
    // injected -> fall back to keyword directly (no wrapper needed) and note it.
    log.debug(`selectStrategy: semantic path selected for mode "${mode}" but no semantic strategy injected; using keyword.`);
    return strats.keyword;
  }

  // >! Embedding model/region context for the additional model-unavailable ERROR log
  // >! (Req 10.5), sourced from the `documentation.ai.embedding` settings already passed as
  // >! `config`. Read defensively (the block may be absent) and fall back to the Lambda
  // >! deployment region when no explicit override is set — matching index-builder.js. This
  // >! is logging context ONLY; it never affects strategy selection or retrieval. A semantic
  // >! failure that reaches FallbackRetrieval is always an embedding failure (an assist
  // >! failure degrades inside SemanticAssistedRetrieval and never propagates here), so the
  // >! embedding model/region is always the right context to log.
  const embeddingCfg = (cfg.embedding && typeof cfg.embedding === 'object') ? cfg.embedding : {};
  const embeddingModel = (typeof embeddingCfg.model === 'string') ? embeddingCfg.model : '';
  const embeddingRegion = (typeof embeddingCfg.region === 'string' && embeddingCfg.region.trim().length > 0)
    ? embeddingCfg.region.trim()
    : (process.env.AWS_REGION || '');

  // >! Wrap so ANY semantic-path error -> keyword fallback + warn log (Req 2.4). The wrapper
  // >! does not swallow keyword's own errors.
  return new FallbackRetrieval({
    primary,
    fallback: strats.keyword,
    logger: log,
    strategyName,
    model: embeddingModel,
    region: embeddingRegion
  });
}

module.exports = {
  RetrievalStrategy,
  KeywordRetrieval,
  SemanticRetrieval,
  SemanticAssistedRetrieval,
  FallbackRetrieval,
  RetrievalError,
  selectStrategy,
  // Exposed for testing (task 6.4: filter building, query normalization, cache behavior).
  buildSemanticFilters,
  normalizeQuery,
  DEFAULT_TOP_K,
  // Exposed for testing (task 13.3: model-not-available ERROR logging classification).
  isModelUnavailableError,
  MODEL_UNAVAILABLE_EVENT
};
