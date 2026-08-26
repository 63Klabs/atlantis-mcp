/**
 * Documentation Service
 *
 * Provides business logic for documentation search operations with caching.
 * Implements pass-through caching using cache-data package for:
 * - Documentation and code pattern search across GitHub repositories
 * - Filtering by documentation type (guide, tutorial, reference, troubleshooting, template pattern, code example)
 * - Keyword-based search with relevance ranking
 * - Suggestions when no results are found, or when the matched set is large enough to warrant
 *   narrowing by type/subType
 * - Additive `availableFilters` facets (distinct type/subType values with counts)
 * - Storage-only retrieval of a full source file by `filePath`/`hash` ({@link getDocument});
 *   the server never fetches from GitHub
 *
 * Searches across:
 * - Markdown documentation from GitHub repositories
 * - CloudFormation template sections and patterns
 * - Python and Node.js code from app starters
 * - cache-data package usage patterns
 * - README headings and top-of-file comments
 *
 * @module services/documentation
 */

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { tools: { DebugAndLog, ApiRequest } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const Models = require('../models');
const { hashContentPath, stripSlug } = require('../utils/content-hash');

/**
 * Default Lambda mount path for the `doc-ai-common` layer modules. In the Lambda runtime
 * the layer is extracted to `/opt/nodejs`; tests override this via `DOC_AI_LAYER_PATH` to
 * point at the local layer `nodejs/` directory so the real layer modules load without the
 * runtime layer present.
 *
 * @constant {string}
 */
const DEFAULT_DOC_AI_LAYER_PATH = '/opt/nodejs';

/**
 * Vector-store label reported in the semantic-assisted usage/degrade log lines. S3 Vectors
 * is the sole backend (spec 0-0-6, Requirement 7), so this is a fixed label rather than a
 * configurable setting. Logging only — it never affects retrieval behavior.
 *
 * @constant {string}
 */
const VECTOR_STORE_LABEL = 's3-vectors';

/**
 * `totalResults` count at (or above) which the search envelope's existing `suggestions`
 * array gains a "narrow by type/subType" nudge (spec 0-0-6, Requirement 8.4). Below this
 * the result set is considered small enough that refinement guidance is noise, and
 * `suggestions` keeps its current zero-results-only usage.
 *
 * @constant {number}
 */
const NARROW_SUGGESTION_THRESHOLD = 25;

/**
 * Result fields exposed as facets in `availableFilters`. These are exactly the fields the
 * `search_documentation` tool accepts as filters, so every facet value an agent sees is a
 * value it can pass straight back as a filter.
 *
 * @constant {Array<string>}
 */
const FACET_FIELDS = ['type', 'subType'];

/**
 * Count the distinct values of one facet field across a result set.
 *
 * Empty, `null`, `undefined`, and non-string values are ignored so a partially indexed
 * result (whose `type`/`subType` may be `''`) never produces a facet value an agent cannot
 * filter by. Ordering is deterministic — descending count, then ascending value — so cached
 * and freshly computed envelopes are byte-identical for the same result set.
 *
 * @param {Array<Object>} results - Assembled search result objects.
 * @param {string} field - Result field to count (`'type'` or `'subType'`).
 * @returns {Array<{value: string, count: number}>} Distinct values with counts, or `[]` when none.
 * @example
 * countFacetValues([{ type: 'documentation' }, { type: 'documentation' }], 'type');
 * // => [{ value: 'documentation', count: 2 }]
 */
function countFacetValues(results, field) {
  const counts = new Map();
  for (const result of results) {
    const value = result ? result[field] : null;
    if (typeof value !== 'string' || value.length === 0) {
      continue;
    }
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return Array.from(counts, ([value, count]) => ({ value, count }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));
}

/**
 * Build the additive `availableFilters` facet block for a search result set.
 *
 * Lists the distinct `type` and `subType` values present with their counts so an agent can
 * see exactly what a follow-up query can be narrowed to (spec 0-0-6, Requirement 8.1).
 * Returns `undefined` when no facet value is present at all (no results, or results whose
 * `type`/`subType` are absent), which keeps the envelope byte-identical to the pre-facet
 * response in those cases — the field is additive and optional (Requirement 8.5).
 *
 * Facets are computed over the results the retrieval path assembled for this request; a
 * field with no values is omitted rather than emitted as an empty array.
 *
 * @param {Array<Object>} results - Assembled search result objects.
 * @returns {?{type: Array<{value: string, count: number}>, subType: Array<{value: string, count: number}>}} Facet block, or `undefined` when there is nothing to report.
 * @example
 * buildAvailableFilters([
 *   { type: 'documentation', subType: 'guide' },
 *   { type: 'documentation', subType: 'reference' }
 * ]);
 * // => { type: [{ value: 'documentation', count: 2 }],
 * //      subType: [{ value: 'guide', count: 1 }, { value: 'reference', count: 1 }] }
 */
function buildAvailableFilters(results) {
  const list = Array.isArray(results) ? results : [];
  const facets = {};
  for (const field of FACET_FIELDS) {
    const values = countFacetValues(list, field);
    if (values.length > 0) {
      facets[field] = values;
    }
  }

  return Object.keys(facets).length > 0 ? facets : undefined;
}

/**
 * Append the "narrow by type/subType" nudge to a search envelope's `suggestions` array when
 * the matched set is large (spec 0-0-6, Requirement 8.4).
 *
 * Extends the existing zero-results-only usage of `suggestions` without changing its type:
 * the array is copied, existing entries are preserved in order, and the hint is appended.
 * Below the threshold the original entries are returned unchanged.
 *
 * @param {Array<string>} suggestions - Suggestions produced by the retrieval path.
 * @param {number} totalResults - Size of the matched set (pre-limit).
 * @returns {Array<string>} Suggestions, with the narrowing hint appended when warranted.
 * @example
 * withNarrowSuggestion([], 120);
 * // => ['120 results matched. Narrow the search with a type or subType filter (see availableFilters).']
 */
function withNarrowSuggestion(suggestions, totalResults) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  if (!(totalResults >= NARROW_SUGGESTION_THRESHOLD)) {
    return list;
  }

  return [
    ...list,
    `${totalResults} results matched. Narrow the search with a type or subType filter (see availableFilters).`
  ];
}

/**
 * Require a `doc-ai-common` layer module by base name.
 *
 * The read-function does NOT declare the layer as an npm dependency (it is provided at
 * runtime by the attached Lambda Layer), so the layer's modules are loaded from the layer
 * mount path via this helper rather than a package import. Isolating the require here keeps
 * the layer-load target in one place and lets tests point `DOC_AI_LAYER_PATH` at the local
 * layer directory.
 *
 * @param {string} name - Layer module base name (e.g. `'embedding-provider'`, `'retrieval-strategy'`).
 * @returns {Object} The required layer module's exports.
 * @example
 * const { selectStrategy } = loadLayerModule('retrieval-strategy');
 */
function loadLayerModule(name) {
  // >! Layer path from a fixed env var with a safe default; `name` is a first-party
  // >! constant (never user input), so this is not a dynamic-require injection risk.
  const base = process.env.DOC_AI_LAYER_PATH || DEFAULT_DOC_AI_LAYER_PATH;
  return require(`${base}/${name}`);
}

/**
 * Memoized doc-ai retrieval components, constructed once per warm container the first time
 * an AI-enabled request is served. Memoizing at module scope keeps the SemanticRetrieval
 * query-embedding cache warm across invocations and avoids re-instantiating the
 * Bedrock/vector clients per request. Stays `null` on the disabled path so keyword-only
 * deployments never load the layer or construct any AWS AI clients.
 *
 * @type {?{embeddingProvider: Object, vectorStore: Object, semantic: Object, assist: Object, semanticAssisted: Object}}
 */
let docAiComponents = null;

/**
 * Map ranked vector hits back to the existing `search_documentation` result shape.
 *
 * Injected into the semantic strategy so semantic hits are enriched with the SAME content
 * metadata the keyword path returns and are therefore indistinguishable in shape from
 * keyword results. Content metadata is fetched via
 * `Models.DocIndex.getContentMetadataByHashes` (`pk=content:{hash}, sk=v:{version}:metadata`);
 * hits whose metadata is missing are dropped, while ranked order and each hit's cosine
 * `score` (mapped onto `relevanceScore`) are preserved so the two retrieval paths share one
 * enrichment source and one result shape.
 *
 * @param {Array<{hash: string, score: number, metadata: Object}>} hits - Ranked vector hits from the store.
 * @param {Object} context - Retrieval context supplied by the semantic strategy.
 * @param {string} context.version - Active index version to read content metadata from.
 * @returns {Promise<Array<Object>>} Result objects in `queryIndex` shape, in ranked order.
 */
async function buildResults(hits, context) {
  const rankedHits = Array.isArray(hits) ? hits : [];
  if (rankedHits.length === 0) {
    return [];
  }

  const version = context && context.version;
  const tableName = Config.settings().docIndexTable;
  const hashes = rankedHits.map((hit) => hit.hash);

  // >! Fetch content metadata (hash -> item) in the model layer. Missing items are
  // >! tolerated there and simply absent from the map, so a partial index cannot fail here.
  const metadataByHash = await Models.DocIndex.getContentMetadataByHashes(tableName, version, hashes);

  const results = [];
  for (const hit of rankedHits) {
    const content = metadataByHash[hit.hash];
    // >! Drop hits whose content metadata is missing so semantic results never contain
    // >! half-populated entries; ranked order is preserved for the remaining hits.
    if (!content) {
      continue;
    }
    results.push({
      title: content.title || '',
      excerpt: (content.excerpt || '').substring(0, 200),
      filePath: content.path || '',
      githubUrl: content.githubUrl || null,
      type: content.type || '',
      subType: content.subType || '',
      // >! Cosine similarity from the vector hit becomes the result's relevanceScore so the
      // >! semantic and keyword result shapes are identical.
      relevanceScore: hit.score,
      repository: content.repository || null,
      repositoryType: content.repositoryType || null,
      namespace: content.namespace || null,
      codeExamples: content.codeExamples || undefined,
      context: content.context || undefined
    });
  }

  return results;
}

/**
 * Construct (once per container) and return the memoized doc-ai retrieval components for
 * the semantic and semantic-assisted paths. Layer modules are loaded via
 * {@link loadLayerModule}; the Bedrock/vector clients they wrap are created lazily on first
 * use, so this is safe to call as soon as the feature is enabled (Requirement 7.1).
 *
 * @param {Object} ai - The `documentation.ai` settings block.
 * @returns {{embeddingProvider: Object, vectorStore: Object, semantic: Object, assist: Object, semanticAssisted: Object}} The memoized components.
 */
function getDocAiComponents(ai) {
  if (docAiComponents) {
    return docAiComponents;
  }

  const { EmbeddingProvider } = loadLayerModule('embedding-provider');
  const { createVectorStore } = loadLayerModule('vector-store');
  const { SemanticRetrieval, SemanticAssistedRetrieval } = loadLayerModule('retrieval-strategy');
  const { AssistProvider } = loadLayerModule('assist-provider');

  const embeddingProvider = new EmbeddingProvider({
    model: ai.embedding.model,
    dimensions: ai.embedding.dimensions,
    maxInputTokens: ai.embedding.maxInputTokens,
    // >! Optional cross-region pin (Requirement 10.1). Read defensively: this settings
    // >! field may be absent until the settings module adds it, and an empty/unset value
    // >! cleanly falls back to the Lambda's deployment region (identical to prior behavior).
    region: ai.embedding.region ?? ''
  });

  // S3 Vectors is the sole backend (spec 0-0-6, Requirement 7); the factory needs only
  // the embedding dimensions and the vector bucket/index location.
  const vectorStore = createVectorStore({
    dimensions: ai.embedding.dimensions,
    s3Vectors: ai.s3Vectors
  });

  const semantic = new SemanticRetrieval({
    embeddingProvider,
    vectorStore,
    buildResults,
    topK: ai.topK
  });

  const assist = new AssistProvider({
    model: ai.assist.model,
    maxCandidates: ai.assist.maxCandidates
  });

  const semanticAssisted = new SemanticAssistedRetrieval({
    semantic,
    assist,
    candidateMultiplier: ai.candidateMultiplier,
    maxCandidates: ai.assist.maxCandidates,
    topK: ai.topK,
    storeType: VECTOR_STORE_LABEL,
    logger: DebugAndLog
  });

  docAiComponents = { embeddingProvider, vectorStore, semantic, assist, semanticAssisted };
  return docAiComponents;
}

/**
 * Search documentation with cache-data pass-through caching
 *
 * Searches across all configured GitHub users/orgs repositories,
 * filtering by atlantis_repository-type custom property.
 * Returns search results with title, excerpt, file path, GitHub URL, and result type.
 *
 * @param {Object} options - Search options
 * @param {string} options.query - Search query (keywords, required)
 * @param {string} [options.type] - Filter by type (documentation, template-pattern, code-example)
 * @param {string} [options.subType] - Filter by subType (guide, tutorial, reference, troubleshooting, function, resource)
 * @param {number} [options.limit=10] - Maximum results to return
 * @param {Array<string>} [options.ghusers] - Filter to specific GitHub users/orgs (optional, validated against settings)
 * @param {Object} [options.authInfo] - Optional resolved auth context ({ tier, isAuthenticated, ... }).
 *   Threaded from the controller; the caller tier gates retrieval-strategy selection (task 8.4).
 *   When the AI feature is disabled or the tier is below the configured minimum, the keyword
 *   path is used and behaves byte-for-byte as before. Only the tier is used/logged; never PII.
 * @returns {Promise<Object>} { results: Array, totalResults: number, query: string, suggestions: Array, availableFilters: Object|undefined, errors: Array, partialData: boolean }
 *
 * `availableFilters` is additive and optional: when the matched results carry `type`/`subType`
 * values it lists each distinct value with its count (e.g.
 * `{ type: [{ value: 'documentation', count: 22 }], subType: [ ... ] }`) so a follow-up query
 * can be narrowed; it is absent when there is nothing to report. When `totalResults` is large,
 * `suggestions` also gains a "narrow by type/subType" hint.
 *
 * Each result object includes:
 * - title: string - Result title
 * - excerpt: string - Brief excerpt (max 200 chars)
 * - filePath: string - File path in repository or S3
 * - githubUrl: string - GitHub URL to full document (if available)
 * - type: string - Result type (documentation, template-pattern, code-example)
 * - subType: string - Result subtype (guide, tutorial, reference, troubleshooting, function, resource)
 * - relevanceScore: number - Relevance ranking score
 * - repository: string - Repository name (if from GitHub)
 * - repositoryType: string - Repository type (documentation, app-starter, templates, package, mcp)
 * - namespace: string - S3 namespace (if from S3)
 * - codeExamples: Array - Code snippets with context (if type is code-example)
 * - context: Object - Additional context (line numbers, function name, template section, etc.)
 *
 * @example
 * // Search all documentation
 * const result = await Documentation.search({ query: 'cache-data' });
 *
 * @example
 * // Search for specific type
 * const result = await Documentation.search({
 *   query: 'Lambda function',
 *   type: 'code-example'
 * });
 *
 * @example
 * // Search with subtype filter
 * const result = await Documentation.search({
 *   query: 'getting started',
 *   type: 'documentation',
 *   subType: 'tutorial'
 * });
 *
 * @example
 * // Search specific GitHub users/orgs
 * const result = await Documentation.search({
 *   query: 'CloudFormation',
 *   ghusers: ['63klabs']
 * });
 */
async function search(options = {}) {
  const { query, type, subType, limit = 10, ghusers, authInfo } = options;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('query is required and must be a non-empty string');
  }

  // >! Resolve the AI feature config and the caller tier used to gate/select the retrieval
  // >! strategy (task 8.4). Log the tier only for observability; never log the auth
  // >! identity/PII.
  const ai = Config.settings().documentation.ai;
  const tier = authInfo?.tier || 'public';
  DebugAndLog.debug('Documentation.search invoked', { tier, docAiEnabled: ai.enabled === true });

  // >! Get connection and cache profile from config
  const { conn, cacheProfile } = Config.getConnCacheProfile('documentation-index', 'doc-index');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for doc-index/search');
  }

  // >! Determine which GitHub users/orgs to search (filtered or all)
  let usersOrgsToSearch = ghusers;
  if (!usersOrgsToSearch || usersOrgsToSearch.length === 0) {
    usersOrgsToSearch = Config.settings().github.userOrgs;
  } else {
    // >! Validate that requested users/orgs are in configured users/orgs
    const validUsersOrgs = Config.settings().github.userOrgs;
    usersOrgsToSearch = usersOrgsToSearch.filter(u => validUsersOrgs.includes(u));
    if (usersOrgsToSearch.length === 0) {
      throw new Error('No valid GitHub users/orgs specified');
    }
  }

  // >! Set host to array of users/orgs (used in cache key)
  conn.host = usersOrgsToSearch;

  // >! Set parameters for cache key and DAO filtering
  conn.parameters = {
    query: query.trim(),
    type,
    subType,
    limit,
    // >! Cache-key discriminator: keyword vs semantic/semantic-assisted results (and the
    // >! per-tier gating outcome) must not collide in the shared documentation-index cache.
    // >! Disabled uses a fixed 'keyword' token; enabled varies by mode|tier so a
    // >! paid/private semantic hit is never served to a below-tier (keyword) caller and
    // >! vice versa. The former store segment is gone because S3 Vectors is the only
    // >! backend (spec 0-0-6, Requirement 7); stale keyed entries expire on the normal
    // >! TTL. Discriminator only; caching/TTLs are otherwise unchanged.
    docAiMode: (ai.enabled === true) ? `${ai.retrievalMode}|${tier}` : 'keyword'
  };

  // >! Define fetch function for cache miss
  const fetchFunction = async (connection, _opts) => {
    DebugAndLog.debug('Searching documentation (cache miss)', {
      query: connection.parameters.query,
      type: connection.parameters.type,
      subType: connection.parameters.subType,
      limit: connection.parameters.limit,
      usersOrgs: connection.host
    });

    // >! Keyword search fn: wraps the existing DynamoDB keyword query and returns its
    // >! { results, totalResults, query, suggestions } shape UNCHANGED. This is both the
    // >! disabled-path search and the tier/error fallback for the semantic path, so keyword
    // >! behavior stays byte-for-byte the current search.
    const keywordSearchFn = async () => {
      const keywordResult = await Models.DocIndex.queryIndex({
        query: connection.parameters.query,
        type: connection.parameters.type,
        subType: connection.parameters.subType,
        limit: connection.parameters.limit
      });
      return {
        results: keywordResult.results || [],
        totalResults: keywordResult.totalResults || 0,
        query: connection.parameters.query,
        suggestions: keywordResult.suggestions || []
      };
    };

    let searchResult;
    if (ai.enabled !== true) {
      // >! Disabled: keyword-only, byte-for-byte current behavior. The layer is never
      // >! loaded and no Bedrock/vector clients are constructed on this path.
      searchResult = await keywordSearchFn();
    } else {
      // >! Enabled: build the keyword strategy (cheap, no AWS clients) and reuse the
      // >! memoized semantic/assisted components, then let selectStrategy gate on the caller
      // >! tier + retrieval mode. Any semantic-path error transparently falls back to keyword.
      const { KeywordRetrieval, selectStrategy } = loadLayerModule('retrieval-strategy');
      const keyword = new KeywordRetrieval({ keywordSearchFn });
      const { semantic, semanticAssisted } = getDocAiComponents(ai);

      // >! Active index version is required by the semantic path; resolved per cache-miss.
      const version = await Models.DocIndex.getActiveVersion(Config.settings().docIndexTable);

      // >! TEMPORARY DIAGNOSTIC (remove after root-causing the silent keyword fallback):
      // >! logs the exact runtime inputs selectStrategy() uses to decide wantsSemantic,
      // >! since every downstream log line (selectStrategy/strategies) has come back empty
      // >! despite settings/tier/layer content all checking out via static inspection.
      DebugAndLog.info('DIAG: pre-selectStrategy snapshot', {
        enabled: ai.enabled,
        enabledType: typeof ai.enabled,
        retrievalMode: ai.retrievalMode,
        minTier: ai.minTier,
        callerTier: authInfo?.tier,
        version,
        hasSemantic: Boolean(semantic),
        semanticHasRetrieve: typeof semantic?.retrieve === 'function',
        hasSemanticAssisted: Boolean(semanticAssisted),
        semanticAssistedHasRetrieve: typeof semanticAssisted?.retrieve === 'function'
      });

      const strategy = selectStrategy({
        config: ai,
        tier: authInfo?.tier,
        strategies: { keyword, semantic, semanticAssisted },
        logger: DebugAndLog
      });

      searchResult = await strategy.retrieve({
        query: connection.parameters.query,
        type: connection.parameters.type,
        ghusers,
        topK: (limit || ai.topK),
        authInfo,
        version
      });
    }

    // >! Return search results with metadata. The shape is identical across the keyword and
    // >! semantic paths so the tool's response contract is unchanged either way.
    const results = searchResult.results || [];
    const totalResults = searchResult.totalResults || 0;
    const returnObject = {
      results,
      totalResults,
      query: connection.parameters.query,
      // >! Existing suggestions are preserved in order; a "narrow by type/subType" hint is
      // >! appended only when the matched set is large (R8.4).
      suggestions: withNarrowSuggestion(searchResult.suggestions || [], totalResults),
      // >! Additive, optional facet block (R8.1/R8.5): distinct type/subType values with
      // >! counts over the matched set, so an agent can see what it can narrow to. Left
      // >! `undefined` (and therefore absent from the serialized response) when there is
      // >! nothing to report, keeping the envelope unchanged for existing clients.
      availableFilters: buildAvailableFilters(results),
      // No errors surfaced by the retrieval path, but we include the field for consistency
      errors: undefined,
      partialData: false
    };

    // >! Wrap the result in a response format suitable for CacheableDataAccess
    return ApiRequest.success({body: returnObject});
  };

  // >! Use cache-data pass-through caching
  const cacheObj = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}, // options: for functions, tokens, non-cache data
  );

  return cacheObj.getBody(true);
}

/**
 * Build the ordered list of candidate document hashes to try for a `get_document` request.
 *
 * Resolution is a short, deterministic sequence rather than a single lookup because a
 * caller-supplied key can arrive in more than one form:
 *
 * 1. `metadataDocumentHash` — the `documentHash` pointer read from the section's metadata
 *    item. This is the authoritative answer whenever the section was indexed after spec
 *    0-0-6 task 1.6.
 * 2. `hashContentPath(stripSlug(filePath))` — the strip-slug fallback. A section contentPath
 *    is `{org}/{repo}/{filePath}/{slug}`, so removing the trailing heading slug reproduces
 *    the document path the indexer hashed. Covers sections indexed before `documentHash`
 *    was written, and sections whose metadata item has expired.
 * 3. `sectionHash` — the supplied `hash` (or `hashContentPath(filePath)`) used as-is, which
 *    resolves the case where the caller already handed us a document-level key rather than
 *    a section-level one.
 *
 * Duplicates and empty values are removed, so a request usually costs one document read and
 * at most three.
 *
 * @param {?string} metadataDocumentHash - `documentHash` from the section metadata item, if any.
 * @param {?string} filePath - Caller-supplied contentPath, if any.
 * @param {string} sectionHash - The resolved section hash (supplied or derived).
 * @returns {Array<string>} Candidate document hashes, in the order they should be tried.
 * @example
 * buildDocumentHashCandidates(null, '63klabs/cache-data/README.md/install', 'aabbccddeeff0011');
 * // [hashContentPath('63klabs/cache-data/README.md'), 'aabbccddeeff0011']
 */
function buildDocumentHashCandidates(metadataDocumentHash, filePath, sectionHash) {
  const candidates = [metadataDocumentHash];

  if (typeof filePath === 'string' && filePath.length > 0) {
    const documentPath = stripSlug(filePath);
    if (documentPath) {
      candidates.push(hashContentPath(documentPath));
    }
  }

  candidates.push(sectionHash);

  return [...new Set(candidates.filter((candidate) => typeof candidate === 'string' && candidate.length > 0))];
}

/**
 * Retrieve the full stored source file for a search result (the `get_document` tool).
 *
 * Storage-only retrieval (Requirement 6.5): every read is against the DynamoDB documentation
 * index and the server NEVER fetches from GitHub. The MCP server serves many clients, so
 * concentrating GitHub traffic on it would exhaust a shared rate limit; on a storage miss the
 * client is handed the file-level GitHub URL and performs the fetch itself.
 *
 * Because it touches neither Bedrock nor the vector store, this works identically regardless
 * of `EnableDocAi` or the active `DocAiRetrievalMode`, at the same access level as keyword
 * `search_documentation` (Requirement 6.6).
 *
 * Resolution (Requirement 6.4): the active index version is resolved server-side (the caller
 * never supplies one), the section hash comes from `hash` or from hashing `filePath`, that
 * section's metadata yields the `documentHash`/`githubUrl` pointers, and the version-less
 * `document:{fileHash}` item is then read. See {@link buildDocumentHashCandidates} for the
 * fallbacks used when the section metadata is unavailable.
 *
 * Wrapped in `CacheableDataAccess` via the `document`/`doc-data` connection so a hot document
 * is served from cache. A storage miss is signalled by a thrown error rather than a returned
 * value specifically so the miss is NOT cached — the next indexer build may well store the
 * document, and a cached miss would outlive the gap.
 *
 * @param {Object} options - Lookup options.
 * @param {string} [options.filePath] - Section contentPath from a search result
 *   (`{org}/{repo}/{filePath}/{slug}`). Either this or `hash` is required.
 * @param {string} [options.hash] - Section content hash (16 hex characters). Either this or
 *   `filePath` is required.
 * @param {Object} [options.authInfo] - Resolved auth context. Accepted for interface
 *   symmetry with {@link search} and for logging the caller tier only; `get_document` applies
 *   no additional tier gating (Requirement 6.6) and the tier is deliberately NOT part of the
 *   cache key, since the returned document is identical for every caller.
 * @returns {Promise<{filePath: string, githubUrl: (string|null), repository: (string|null), repositoryType: (string|null), namespace: (string|null), content: string}>}
 *   The stored source file and its file-level metadata.
 * @throws {Error} When neither `filePath` nor `hash` is supplied (`code` is unset — invalid input).
 * @throws {Error} When the document is not in storage. The error carries
 *   `code = 'DOCUMENT_NOT_FOUND'` plus `filePath`, `hash`, and `githubUrl` (the derived
 *   file-level URL, or `null` when it could not be derived) so the caller can return a
 *   JSON-RPC error that lets the client fetch the file directly (Requirements 6.8, 6.9).
 * @example
 * // Retrieve by the filePath returned on a search result
 * const doc = await Documentation.getDocument({
 *   filePath: '63klabs/cache-data/README.md/installation'
 * });
 * console.log(doc.content);   // raw source file
 * console.log(doc.githubUrl); // file-level GitHub URL
 *
 * @example
 * // Retrieve by section hash, handling a storage miss
 * try {
 *   const doc = await Documentation.getDocument({ hash: 'ea6f1a2b3c4d5e6f' });
 * } catch (error) {
 *   if (error.code === 'DOCUMENT_NOT_FOUND') {
 *     // Fetch error.githubUrl client-side; the server never fetches from GitHub
 *   }
 * }
 */
async function getDocument(options = {}) {
  const { filePath, hash, authInfo } = options;

  const hasFilePath = typeof filePath === 'string' && filePath.trim().length > 0;
  const hasHash = typeof hash === 'string' && hash.trim().length > 0;

  if (!hasFilePath && !hasHash) {
    throw new Error('getDocument requires either filePath or hash');
  }

  // >! Tier is logged for observability only; get_document applies no tier gating and the
  // >! tier is not part of the cache key. Never log the auth identity/PII.
  DebugAndLog.debug('Documentation.getDocument invoked', { tier: authInfo?.tier || 'public' });

  const { conn, cacheProfile } = Config.getConnCacheProfile('document', 'doc-data');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for document/doc-data');
  }

  // >! Cache key inputs. `filePath` and `hash` are opaque lookup keys — hashed and used as
  // >! DynamoDB key components only, never as a file-system path or shell argument.
  conn.parameters = {
    filePath: hasFilePath ? filePath.trim() : undefined,
    hash: hasHash ? hash.trim() : undefined
  };

  const fetchFunction = async (connection, _opts) => {
    const requestedFilePath = connection.parameters.filePath || null;
    const requestedHash = connection.parameters.hash || null;
    const tableName = Config.settings().docIndexTable;

    DebugAndLog.debug('Resolving document (cache miss)', {
      filePath: requestedFilePath,
      hash: requestedHash
    });

    // >! Active version is resolved server-side; the caller never supplies one (R2.4/R6).
    const version = await Models.DocIndex.getActiveVersion(tableName);

    // >! Section hash: the supplied hash wins, otherwise derive it from the contentPath the
    // >! same way the indexer did.
    const sectionHash = requestedHash || hashContentPath(requestedFilePath);

    // >! Section metadata supplies the documentHash pointer and the file-level GitHub URL.
    // >! Absent metadata (no active version, expired/superseded item) is not fatal — the
    // >! candidate fallbacks below can still resolve the document.
    const metadata = version
      ? await Models.DocIndex.getSectionMetadata(tableName, version, sectionHash)
      : null;

    const candidates = buildDocumentHashCandidates(
      metadata ? metadata.documentHash : null,
      requestedFilePath,
      sectionHash
    );

    let document = null;
    for (const candidate of candidates) {
      document = await Models.DocIndex.getDocumentByFileHash(tableName, candidate);
      if (document) {
        break;
      }
    }

    const metadataGithubUrl = metadata ? metadata.githubUrl : null;

    if (!document) {
      // >! Storage miss. Throw (rather than returning a value) so CacheableDataAccess does
      // >! NOT cache the miss: the next indexer build may store this document. The GitHub URL
      // >! rides along so the caller can hand it to the client, which fetches directly —
      // >! the server itself never fetches from GitHub (R6.8/R6.9).
      const error = new Error(
        `Document not found in storage: ${requestedFilePath || requestedHash}`
      );
      error.code = 'DOCUMENT_NOT_FOUND';
      error.filePath = requestedFilePath;
      error.hash = requestedHash;
      error.githubUrl = metadataGithubUrl;
      throw error;
    }

    return ApiRequest.success({
      body: {
        // >! Prefer the stored documentPath: it is the file the content actually came from,
        // >! whereas the caller's filePath may still carry a section slug.
        filePath: document.documentPath || requestedFilePath || '',
        // >! Section metadata and the document item store the same file-level URL; either is
        // >! acceptable, so take whichever is populated (R6.9).
        githubUrl: metadataGithubUrl || document.githubUrl || null,
        repository: document.repository || null,
        repositoryType: document.repositoryType || null,
        namespace: document.namespace || null,
        content: document.content || ''
      }
    });
  };

  const cacheObj = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}
  );

  return cacheObj.getBody(true);
}

/**
 * Test harness for resetting module-scoped state in tests.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
  /**
   * Reset the memoized doc-ai components so the next AI-enabled request rebuilds them.
   * Lets a test exercise multiple configurations in one file without warm-container
   * memoization leaking across cases. WARNING: For testing only; never use in production.
   *
   * @private
   * @returns {void}
   */
  static resetDocAiComponents() {
    docAiComponents = null;
  }
}

module.exports = {
  search,
  getDocument,
  TestHarness
};
