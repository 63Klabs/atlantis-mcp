/**
 * Documentation Service
 *
 * Provides business logic for documentation search operations with caching.
 * Implements pass-through caching using cache-data package for:
 * - Documentation and code pattern search across GitHub repositories
 * - Filtering by documentation type (guide, tutorial, reference, troubleshooting, template pattern, code example)
 * - Keyword-based search with relevance ranking
 * - Suggestions when no results found
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

  const vectorStore = createVectorStore({
    vectorStore: ai.vectorStore,
    dimensions: ai.embedding.dimensions,
    dynamodb: { tableName: Config.settings().docIndexTable },
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
    storeType: ai.vectorStore,
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
 * @returns {Promise<Object>} { results: Array, totalResults: number, query: string, suggestions: Array, errors: Array, partialData: boolean }
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
    // >! Disabled uses a fixed 'keyword' token; enabled varies by mode|store|tier so a
    // >! paid/private semantic hit is never served to a below-tier (keyword) caller and
    // >! vice versa. Discriminator only; caching/TTLs are otherwise unchanged.
    docAiMode: (ai.enabled === true) ? `${ai.retrievalMode}|${ai.vectorStore}|${tier}` : 'keyword'
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
    const returnObject = {
      results: searchResult.results || [],
      totalResults: searchResult.totalResults || 0,
      query: connection.parameters.query,
      suggestions: searchResult.suggestions || [],
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
  TestHarness
};
