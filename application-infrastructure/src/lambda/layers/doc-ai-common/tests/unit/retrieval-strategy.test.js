'use strict';

/**
 * Unit tests for the retrieval strategies + tier threading (doc-ai-common Lambda Layer).
 *
 * Purpose: Verify the already-implemented strategy layer (tasks 6.2/6.3) against its
 * contract, covering the four areas named by task 6.4:
 *   1. Tier gating matrix — `selectStrategy` chooses semantic only when enabled + mode
 *      is not keyword + callerRank >= minTier rank (public < registered < paid < private).
 *   2. Disabled fallback — disabled / keyword mode / below-tier / missing-config all use
 *      the keyword strategy, and `selectStrategy` fails loudly when keyword is absent.
 *   3. Result-shape parity — `SemanticRetrieval` returns the SAME envelope as keyword
 *      (`{ results, totalResults, query, suggestions }`) with `relevanceScore` sourced
 *      from each vector hit's cosine `score`, and the fallback preserves that parity.
 *   4. Query-embedding cache — repeated queries that normalize to the same key embed once
 *      (a hit), while a different query / model identity forces a fresh embed (a miss).
 * Supporting behavior (`buildSemanticFilters`, `normalizeQuery`, the abstract base, query
 * validation, missing-version empty response, and the `FallbackRetrieval` warn/no-PII
 * path) is covered too so the suite is complete.
 *
 * Setup: Every collaborator is INJECTED as a plain fake / `jest.fn()` — `keywordSearchFn`,
 * an `embeddingProvider` (`{ embed, model, dimensions }`), a `vectorStore` (`{ query }`),
 * `buildResults`, and a `{ warn, error, debug }` logger. There are NO real AWS SDK calls
 * and no network; the layer requires nothing from the read-function or doc-indexer.
 *
 * Teardown: `jest.restoreAllMocks()` / `jest.clearAllMocks()` in `afterEach` keeps tests
 * isolated (the query-embedding cache is per-instance, so a fresh strategy per test starts
 * empty).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5 (semantic retrieval + result parity +
 * fallback + no-active-version), 3.1, 3.2, 3.3, 3.4, 3.5 (tier gating + shape unchanged),
 * and 7.2 (query-embedding cache).
 */

const {
  RetrievalStrategy,
  KeywordRetrieval,
  SemanticRetrieval,
  FallbackRetrieval,
  RetrievalError,
  selectStrategy,
  buildSemanticFilters,
  normalizeQuery,
  DEFAULT_TOP_K
} = require('../../nodejs/retrieval-strategy');

/**
 * The documented `search_documentation` result-object fields both retrieval paths must
 * produce (the semantic path maps each hit's `score` onto `relevanceScore`).
 * @constant {string[]}
 */
const DOCUMENTED_RESULT_KEYS = [
  'title',
  'excerpt',
  'filePath',
  'githubUrl',
  'type',
  'subType',
  'relevanceScore',
  'repository',
  'repositoryType',
  'namespace'
];

/**
 * The response-envelope keys shared by the keyword and semantic paths.
 * @constant {string[]}
 */
const ENVELOPE_KEYS = ['query', 'results', 'suggestions', 'totalResults'];

/**
 * Await a promise expected to reject and return the thrown error for assertions.
 * Fails the test if the promise resolves instead of rejecting.
 *
 * @param {Promise<*>} promise - The promise expected to reject.
 * @returns {Promise<Error>} The rejection reason.
 */
async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject, but it resolved');
}

/**
 * Capture a synchronously thrown error for assertions (used for constructor/factory
 * validation that throws rather than rejects).
 *
 * @param {function(): *} fn - The function expected to throw.
 * @returns {Error} The thrown error.
 */
function captureThrow(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the function to throw, but it did not');
}

/**
 * Build a documented-shape result object from a vector hit (relevanceScore <- score).
 *
 * @param {{hash: string, score: number}} hit - The ranked vector hit.
 * @param {number} index - The hit's rank index (used to vary the sample fields).
 * @returns {Object} A result object with exactly the {@link DOCUMENTED_RESULT_KEYS}.
 */
function resultFromHit(hit, index) {
  return {
    title: `Doc ${index}`,
    excerpt: `Excerpt for ${hit.hash}`,
    filePath: `docs/${hit.hash}.md`,
    githubUrl: `https://github.com/63klabs/atlantis/blob/main/docs/${hit.hash}.md`,
    type: 'documentation',
    subType: 'guide',
    relevanceScore: hit.score,
    repository: 'atlantis',
    repositoryType: 'github',
    namespace: 'default'
  };
}

/**
 * A `buildResults` implementation that maps ranked hits to documented-shape results.
 *
 * @param {Array<{hash: string, score: number}>} hits - Ranked vector hits.
 * @returns {Object[]} Documented-shape result objects (relevanceScore from each score).
 */
function documentedBuildResults(hits) {
  return hits.map((hit, index) => resultFromHit(hit, index));
}

/**
 * Build a keyword-path response with the SAME envelope + result shape as the semantic
 * path, for parity comparisons.
 *
 * @param {string} query - The query echoed in the envelope.
 * @returns {{results: Object[], totalResults: number, query: string, suggestions: string[]}} A keyword-shaped response.
 */
function makeKeywordResponse(query) {
  const results = [resultFromHit({ hash: 'kw', score: 0.42 }, 0)];
  return { results, totalResults: results.length, query, suggestions: [] };
}

/**
 * Build a `{ warn, error, debug }` logger of jest mocks.
 *
 * @returns {{warn: jest.Mock, error: jest.Mock, debug: jest.Mock}} The logger fake.
 */
function makeLogger() {
  return { warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

/**
 * Construct a {@link SemanticRetrieval} wired to injected fakes, returning the strategy
 * and its collaborators for assertions.
 *
 * @param {Object} [overrides] - Optional dependency/config overrides.
 * @param {jest.Mock} [overrides.embed] - Custom `embed` mock (defaults to a fixed vector).
 * @param {string} [overrides.model] - Embedding model id (cache-key component).
 * @param {number} [overrides.dimensions=3] - Embedding dimensions (cache-key component).
 * @param {Array<Object>} [overrides.hits=[]] - Hits the vector store resolves.
 * @param {Object} [overrides.vectorStore] - Custom vector store fake.
 * @param {Function} [overrides.buildResults] - Custom buildResults fake.
 * @param {Map} [overrides.cache] - Shared cache Map (for model-identity tests).
 * @param {number} [overrides.maxCacheSize] - Bounded cache size (for eviction tests).
 * @param {number} [overrides.topK] - Constructor default topK.
 * @returns {{semantic: SemanticRetrieval, embed: jest.Mock, embeddingProvider: Object, vectorStore: Object, buildResults: jest.Mock}} The strategy and fakes.
 */
function makeSemantic(overrides = {}) {
  const embed = overrides.embed || jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
  const embeddingProvider = {
    embed,
    model: overrides.model || 'amazon.titan-embed-text-v2:0',
    dimensions: overrides.dimensions === undefined ? 3 : overrides.dimensions
  };
  const vectorStore = overrides.vectorStore
    || { query: jest.fn().mockResolvedValue(overrides.hits || []) };
  const buildResults = overrides.buildResults
    || jest.fn().mockImplementation((hits) => documentedBuildResults(hits));

  const semantic = new SemanticRetrieval({
    embeddingProvider,
    vectorStore,
    buildResults,
    cache: overrides.cache,
    maxCacheSize: overrides.maxCacheSize,
    topK: overrides.topK
  });

  return { semantic, embed, embeddingProvider, vectorStore, buildResults };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('buildSemanticFilters — type/ghusers mapping', () => {
  it('maps a non-empty type to { type }', () => {
    expect(buildSemanticFilters({ type: 'documentation' })).toEqual({ type: 'documentation' });
  });

  it('maps a single ghusers string to { owner }', () => {
    expect(buildSemanticFilters({ ghusers: '63klabs' })).toEqual({ owner: '63klabs' });
  });

  it('maps a single-element ghusers array to { owner }', () => {
    expect(buildSemanticFilters({ type: 'documentation', ghusers: ['63klabs'] }))
      .toEqual({ type: 'documentation', owner: '63klabs' });
  });

  it('omits owner when multiple ghusers are supplied (not a single equality filter)', () => {
    expect(buildSemanticFilters({ ghusers: ['63klabs', 'acme'] })).toEqual({});
  });

  it('omits owner when ghusers is empty', () => {
    expect(buildSemanticFilters({ ghusers: [] })).toEqual({});
  });

  it('returns {} for no inputs and ignores a whitespace-only type', () => {
    expect(buildSemanticFilters()).toEqual({});
    expect(buildSemanticFilters({})).toEqual({});
    expect(buildSemanticFilters({ type: '   ' })).toEqual({});
  });

  it('deduplicates a single distinct owner from a repeated ghusers array', () => {
    expect(buildSemanticFilters({ ghusers: ['63klabs', '63klabs'] })).toEqual({ owner: '63klabs' });
  });
});

describe('normalizeQuery — trim/lowercase/collapse whitespace', () => {
  it('lowercases and collapses internal whitespace', () => {
    expect(normalizeQuery('Rotate The Key')).toBe('rotate the key');
  });

  it('trims and collapses runs of whitespace to a single space', () => {
    expect(normalizeQuery('  rotate   the key ')).toBe('rotate the key');
  });

  it('treats the two spacing/casing variants as the same normalized key', () => {
    expect(normalizeQuery('Rotate The Key')).toBe(normalizeQuery('  rotate   the key '));
  });

  it('returns an empty string for non-string input', () => {
    expect(normalizeQuery(null)).toBe('');
    expect(normalizeQuery(undefined)).toBe('');
    expect(normalizeQuery(123)).toBe('');
  });
});

describe('RetrievalStrategy — abstract base', () => {
  it('retrieve() throws a RetrievalError with code NOT_IMPLEMENTED', async () => {
    const base = new RetrievalStrategy();

    const error = await captureError(base.retrieve({ query: 'x' }));

    expect(error).toBeInstanceOf(RetrievalError);
    expect(error.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('KeywordRetrieval — pure pass-through (Req 3.2, 3.4)', () => {
  it('throws INVALID_CONFIG when keywordSearchFn is not a function', () => {
    const error = captureThrow(() => new KeywordRetrieval({}));
    expect(error).toBeInstanceOf(RetrievalError);
    expect(error.code).toBe('INVALID_CONFIG');
  });

  it('forwards the options unchanged and returns the keyword result untouched', async () => {
    const keywordResponse = makeKeywordResponse('cache-data');
    const keywordSearchFn = jest.fn().mockResolvedValue(keywordResponse);
    const keyword = new KeywordRetrieval({ keywordSearchFn });
    const options = { query: 'cache-data', type: 'documentation', ghusers: ['63klabs'] };

    const result = await keyword.retrieve(options);

    expect(keywordSearchFn).toHaveBeenCalledTimes(1);
    expect(keywordSearchFn).toHaveBeenCalledWith(options);
    // Same reference: the strategy adds no re-mapping of its own.
    expect(result).toBe(keywordResponse);
  });
});

describe('SemanticRetrieval — constructor validation', () => {
  it.each([
    ['embeddingProvider missing', { vectorStore: { query: jest.fn() }, buildResults: jest.fn() }],
    ['embeddingProvider.embed not a function', { embeddingProvider: {}, vectorStore: { query: jest.fn() }, buildResults: jest.fn() }],
    ['vectorStore missing', { embeddingProvider: { embed: jest.fn() }, buildResults: jest.fn() }],
    ['vectorStore.query not a function', { embeddingProvider: { embed: jest.fn() }, vectorStore: {}, buildResults: jest.fn() }],
    ['buildResults missing', { embeddingProvider: { embed: jest.fn() }, vectorStore: { query: jest.fn() } }]
  ])('throws INVALID_CONFIG when %s', (_label, deps) => {
    const error = captureThrow(() => new SemanticRetrieval(deps));
    expect(error).toBeInstanceOf(RetrievalError);
    expect(error.code).toBe('INVALID_CONFIG');
  });
});

describe('SemanticRetrieval — query validation & missing version (Req 2.5)', () => {
  it.each([
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
    ['a non-string', 123],
    ['null', null]
  ])('throws INVALID_QUERY for %s and never embeds', async (_label, badQuery) => {
    const { semantic, embed, vectorStore } = makeSemantic();

    const error = await captureError(semantic.retrieve({ query: badQuery, version: 'v1' }));

    expect(error).toBeInstanceOf(RetrievalError);
    expect(error.code).toBe('INVALID_QUERY');
    expect(embed).not.toHaveBeenCalled();
    expect(vectorStore.query).not.toHaveBeenCalled();
  });

  it.each([
    ['version is undefined', undefined],
    ['version is an empty string', ''],
    ['version is whitespace only', '   ']
  ])('returns an empty response with suggestions (no embed/query) when %s', async (_label, version) => {
    const { semantic, embed, vectorStore } = makeSemantic();

    const result = await semantic.retrieve({ query: 'rotate the key', version });

    expect(result.results).toEqual([]);
    expect(result.totalResults).toBe(0);
    expect(result.query).toBe('rotate the key');
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
    // Req 2.5 must not spend a Bedrock call or hit the store.
    expect(embed).not.toHaveBeenCalled();
    expect(vectorStore.query).not.toHaveBeenCalled();
  });

  it('returns a fresh suggestions array per call (callers cannot mutate a shared array)', async () => {
    const { semantic } = makeSemantic();

    const first = await semantic.retrieve({ query: 'a', version: '' });
    const second = await semantic.retrieve({ query: 'b', version: '' });

    expect(first.suggestions).toEqual(second.suggestions);
    expect(first.suggestions).not.toBe(second.suggestions);
  });
});

describe('SemanticRetrieval — result-shape parity (Req 2.2, 2.3, 3.4)', () => {
  it('returns the keyword envelope shape with relevanceScore sourced from each hit score', async () => {
    const hits = [
      { hash: 'a', score: 0.95, metadata: { type: 'documentation' } },
      { hash: 'b', score: 0.80, metadata: { type: 'documentation' } }
    ];
    const { semantic, embeddingProvider, vectorStore, buildResults } = makeSemantic({ hits, topK: 10 });
    const authInfo = { tier: 'private' };

    const result = await semantic.retrieve({
      query: 'rotate the key',
      type: 'documentation',
      ghusers: ['63klabs'],
      version: 'v3',
      authInfo
    });

    // Envelope parity with the keyword path.
    expect(Object.keys(result).sort()).toEqual(ENVELOPE_KEYS);
    expect(Object.keys(result).sort()).toEqual(Object.keys(makeKeywordResponse('rotate the key')).sort());
    expect(result.query).toBe('rotate the key');
    expect(result.totalResults).toBe(2);
    expect(result.totalResults).toBe(result.results.length);
    expect(result.suggestions).toEqual([]);

    // Each result carries exactly the documented fields, with score -> relevanceScore.
    for (const item of result.results) {
      expect(Object.keys(item).sort()).toEqual([...DOCUMENTED_RESULT_KEYS].sort());
    }
    expect(result.results[0].relevanceScore).toBe(0.95);
    expect(result.results[1].relevanceScore).toBe(0.80);

    // Embedding + store wiring: type/ghusers become filters; version/topK are threaded.
    expect(embeddingProvider.embed).toHaveBeenCalledTimes(1);
    expect(vectorStore.query).toHaveBeenCalledTimes(1);
    const [embeddingArg, queryOptions] = vectorStore.query.mock.calls[0];
    expect(Array.isArray(embeddingArg)).toBe(true);
    expect(queryOptions).toEqual({
      version: 'v3',
      filters: { type: 'documentation', owner: '63klabs' },
      topK: 10
    });

    // buildResults receives the ranked hits and a query context (incl. authInfo).
    expect(buildResults).toHaveBeenCalledTimes(1);
    const [hitsArg, contextArg] = buildResults.mock.calls[0];
    expect(hitsArg).toHaveLength(2);
    expect(contextArg).toMatchObject({
      query: 'rotate the key',
      type: 'documentation',
      ghusers: ['63klabs'],
      topK: 10,
      version: 'v3',
      authInfo
    });
  });

  it('returns empty results with suggestions when the store yields no hits (still parity)', async () => {
    const { semantic } = makeSemantic({ hits: [] });

    const result = await semantic.retrieve({ query: 'no matches here', version: 'v3' });

    expect(Object.keys(result).sort()).toEqual(ENVELOPE_KEYS);
    expect(result.results).toEqual([]);
    expect(result.totalResults).toBe(0);
    expect(result.suggestions).toHaveLength(2);
  });

  it('defaults topK to DEFAULT_TOP_K, honors a constructor topK, and lets a call override it', async () => {
    const defaults = makeSemantic();
    await defaults.semantic.retrieve({ query: 'q', version: 'v1' });
    expect(defaults.vectorStore.query.mock.calls[0][1].topK).toBe(DEFAULT_TOP_K);

    const ctor = makeSemantic({ topK: 7 });
    await ctor.semantic.retrieve({ query: 'q', version: 'v1' });
    expect(ctor.vectorStore.query.mock.calls[0][1].topK).toBe(7);

    const override = makeSemantic({ topK: 7 });
    await override.semantic.retrieve({ query: 'q', version: 'v1', topK: 3 });
    expect(override.vectorStore.query.mock.calls[0][1].topK).toBe(3);
  });
});

describe('SemanticRetrieval — query-embedding cache (Req 7.2)', () => {
  it('embeds once for two queries that normalize to the same key (one hit, one miss)', async () => {
    const { semantic, embed } = makeSemantic();

    await semantic.retrieve({ query: 'Rotate The Key', version: 'v1' });
    await semantic.retrieve({ query: '  rotate   the key ', version: 'v1' });

    expect(embed).toHaveBeenCalledTimes(1);
    const stats = semantic.getCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it('embeds again (a miss) for a genuinely different query', async () => {
    const { semantic, embed } = makeSemantic();

    await semantic.retrieve({ query: 'rotate the key', version: 'v1' });
    await semantic.retrieve({ query: 'rotate the key', version: 'v1' }); // hit
    await semantic.retrieve({ query: 'a completely different query', version: 'v1' }); // miss

    expect(embed).toHaveBeenCalledTimes(2);
    const stats = semantic.getCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
    expect(stats.size).toBe(2);
  });

  it('does not collide across embedding-model identity (model is part of the cache key)', async () => {
    // Two providers sharing ONE cache Map but different models: the same query text must
    // NOT reuse the other model's embedding, so each still embeds once (a miss).
    const sharedCache = new Map();
    const embedA = jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const embedB = jest.fn().mockResolvedValue([0.4, 0.5, 0.6]);
    const { semantic: semanticA } = makeSemantic({ embed: embedA, model: 'model-a', cache: sharedCache });
    const { semantic: semanticB } = makeSemantic({ embed: embedB, model: 'model-b', cache: sharedCache });

    await semanticA.retrieve({ query: 'rotate the key', version: 'v1' });
    await semanticB.retrieve({ query: 'rotate the key', version: 'v1' });

    expect(embedA).toHaveBeenCalledTimes(1);
    expect(embedB).toHaveBeenCalledTimes(1);
    expect(semanticB.getCacheStats().misses).toBe(1);
    expect(semanticB.getCacheStats().hits).toBe(0);
    // Both distinct (model, query) keys now live in the shared cache.
    expect(sharedCache.size).toBe(2);
  });

  it('evicts the oldest entry (FIFO) when the bounded cache is full', async () => {
    const { semantic, embed } = makeSemantic({ maxCacheSize: 2 });

    await semantic.retrieve({ query: 'alpha query', version: 'v1' }); // miss -> [alpha]
    await semantic.retrieve({ query: 'beta query', version: 'v1' });  // miss -> [alpha, beta]
    await semantic.retrieve({ query: 'gamma query', version: 'v1' }); // miss -> evict alpha -> [beta, gamma]

    expect(embed).toHaveBeenCalledTimes(3);
    const stats = semantic.getCacheStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(2);

    // 'alpha query' was evicted, so it must be embedded again (a miss).
    await semantic.retrieve({ query: 'alpha query', version: 'v1' });
    expect(embed).toHaveBeenCalledTimes(4);
    expect(semantic.getCacheStats().size).toBe(2);
  });

  it('clearCache() empties the cache and resets the hit/miss counters', async () => {
    const { semantic, embed } = makeSemantic();

    await semantic.retrieve({ query: 'rotate the key', version: 'v1' });
    await semantic.retrieve({ query: 'rotate the key', version: 'v1' });
    expect(semantic.getCacheStats()).toMatchObject({ hits: 1, misses: 1, size: 1 });

    semantic.clearCache();
    expect(semantic.getCacheStats()).toMatchObject({ hits: 0, misses: 0, size: 0 });

    // After clearing, the same query is a fresh miss (re-embedded).
    await semantic.retrieve({ query: 'rotate the key', version: 'v1' });
    expect(embed).toHaveBeenCalledTimes(2);
    expect(semantic.getCacheStats()).toMatchObject({ hits: 0, misses: 1, size: 1 });
  });
});

describe('SemanticRetrieval — error wrapping enables keyword fallback (Req 2.4)', () => {
  it('wraps an embedding failure as RETRIEVAL_FAILED and preserves the cause', async () => {
    const cause = new Error('bedrock throttled');
    const { semantic } = makeSemantic({ embed: jest.fn().mockRejectedValue(cause) });

    const error = await captureError(semantic.retrieve({ query: 'rotate the key', version: 'v1' }));

    expect(error).toBeInstanceOf(RetrievalError);
    expect(error.code).toBe('RETRIEVAL_FAILED');
    expect(error.cause).toBe(cause);
  });

  it('wraps a vector-store failure as RETRIEVAL_FAILED and preserves the cause', async () => {
    const cause = new Error('dynamo unavailable');
    const vectorStore = { query: jest.fn().mockRejectedValue(cause) };
    const { semantic } = makeSemantic({ vectorStore });

    const error = await captureError(semantic.retrieve({ query: 'rotate the key', version: 'v1' }));

    expect(error.code).toBe('RETRIEVAL_FAILED');
    expect(error.cause).toBe(cause);
  });

  it('wraps a buildResults failure as RETRIEVAL_FAILED and preserves the cause', async () => {
    const cause = new Error('content lookup failed');
    const buildResults = jest.fn().mockRejectedValue(cause);
    const { semantic } = makeSemantic({ hits: [{ hash: 'a', score: 1 }], buildResults });

    const error = await captureError(semantic.retrieve({ query: 'rotate the key', version: 'v1' }));

    expect(error.code).toBe('RETRIEVAL_FAILED');
    expect(error.cause).toBe(cause);
  });

  it('passes an already-typed RetrievalError through unchanged (no double-wrap)', async () => {
    const typed = new RetrievalError('inner typed failure', { code: 'RETRIEVAL_FAILED' });
    const buildResults = jest.fn().mockRejectedValue(typed);
    const { semantic } = makeSemantic({ hits: [{ hash: 'a', score: 1 }], buildResults });

    const error = await captureError(semantic.retrieve({ query: 'rotate the key', version: 'v1' }));

    expect(error).toBe(typed);
  });
});

describe('selectStrategy — tier gating matrix (Req 3.1, 3.2, 3.5)', () => {
  /**
   * Run `selectStrategy` with stub strategies, invoke the chosen strategy, and report
   * which underlying stub actually ran.
   *
   * @param {Object} config - The `documentation.ai` config passed to selectStrategy.
   * @param {*} tier - The caller tier.
   * @returns {Promise<{keyword: jest.Mock, semantic: jest.Mock, result: Object, strategy: Object}>} Invocation record.
   */
  async function runGate(config, tier) {
    const keywordResult = { results: [], totalResults: 0, query: 'keyword', suggestions: [] };
    const semanticResult = { results: [], totalResults: 0, query: 'semantic', suggestions: [] };
    const keyword = { retrieve: jest.fn().mockResolvedValue(keywordResult) };
    const semantic = { retrieve: jest.fn().mockResolvedValue(semanticResult) };

    const strategy = selectStrategy({ config, tier, strategies: { keyword, semantic } });
    const result = await strategy.retrieve({ query: 'gating probe', version: 'v1' });

    return { keyword: keyword.retrieve, semantic: semantic.retrieve, result, strategy };
  }

  const SEMANTIC = 'semantic';
  const KEYWORD = 'keyword';

  it.each([
    // minTier = paid (rank 2)
    ['minTier=paid, public -> keyword', 'paid', 'public', KEYWORD],
    ['minTier=paid, registered -> keyword', 'paid', 'registered', KEYWORD],
    ['minTier=paid, paid -> semantic (boundary tier===minTier)', 'paid', 'paid', SEMANTIC],
    ['minTier=paid, private -> semantic', 'paid', 'private', SEMANTIC],
    ['minTier=paid, unknown tier -> keyword (ranks as public)', 'paid', 'bogus', KEYWORD],
    ['minTier=paid, missing tier -> keyword (ranks as public)', 'paid', undefined, KEYWORD],
    // minTier = registered (rank 1) exercises the low end of the ordering
    ['minTier=registered, public -> keyword', 'registered', 'public', KEYWORD],
    ['minTier=registered, registered -> semantic (boundary)', 'registered', 'registered', SEMANTIC],
    ['minTier=registered, paid -> semantic', 'registered', 'paid', SEMANTIC],
    // minTier = private (rank 3) exercises the high end of the ordering
    ['minTier=private, paid -> keyword', 'private', 'paid', KEYWORD],
    ['minTier=private, private -> semantic (boundary)', 'private', 'private', SEMANTIC]
  ])('%s', async (_label, minTier, tier, expectedPath) => {
    const config = { enabled: true, retrievalMode: 'semantic', minTier };

    const { keyword, semantic, result } = await runGate(config, tier);

    if (expectedPath === SEMANTIC) {
      expect(semantic).toHaveBeenCalledTimes(1);
      expect(keyword).not.toHaveBeenCalled();
      expect(result.query).toBe('semantic');
    } else {
      expect(keyword).toHaveBeenCalledTimes(1);
      expect(semantic).not.toHaveBeenCalled();
      expect(result.query).toBe('keyword');
    }
  });

  it('an unknown/missing minTier ranks as paid (private qualifies, registered does not)', async () => {
    const privateCall = await runGate({ enabled: true, retrievalMode: 'semantic' }, 'private');
    expect(privateCall.semantic).toHaveBeenCalledTimes(1);
    expect(privateCall.keyword).not.toHaveBeenCalled();

    const registeredCall = await runGate({ enabled: true, retrievalMode: 'semantic', minTier: 'bogus' }, 'registered');
    expect(registeredCall.keyword).toHaveBeenCalledTimes(1);
    expect(registeredCall.semantic).not.toHaveBeenCalled();
  });
});

describe('selectStrategy — disabled / keyword mode fallback (Req 3.3)', () => {
  /**
   * Build stub strategies for disabled-path assertions.
   *
   * @returns {{keyword: Object, semantic: Object}} Stub strategies with jest.fn retrieve.
   */
  function makeStubs() {
    return {
      keyword: { retrieve: jest.fn().mockResolvedValue({ results: [], totalResults: 0, query: 'keyword', suggestions: [] }) },
      semantic: { retrieve: jest.fn().mockResolvedValue({ results: [], totalResults: 0, query: 'semantic', suggestions: [] }) }
    };
  }

  it('uses keyword when disabled — even for a private caller — and never invokes semantic', async () => {
    const { keyword, semantic } = makeStubs();

    const strategy = selectStrategy({
      config: { enabled: false, retrievalMode: 'semantic', minTier: 'paid' },
      tier: 'private',
      strategies: { keyword, semantic }
    });
    // Disabled path returns the keyword strategy directly (exact shape parity).
    expect(strategy).toBe(keyword);

    await strategy.retrieve({ query: 'q', version: 'v1' });
    expect(keyword.retrieve).toHaveBeenCalledTimes(1);
    expect(semantic.retrieve).not.toHaveBeenCalled();
  });

  it('uses keyword when retrievalMode is "keyword" — even for a private caller', async () => {
    const { keyword, semantic } = makeStubs();

    const strategy = selectStrategy({
      config: { enabled: true, retrievalMode: 'keyword', minTier: 'paid' },
      tier: 'private',
      strategies: { keyword, semantic }
    });

    expect(strategy).toBe(keyword);
    await strategy.retrieve({ query: 'q', version: 'v1' });
    expect(semantic.retrieve).not.toHaveBeenCalled();
  });

  it('uses keyword when config is missing entirely (treated as disabled)', async () => {
    const { keyword, semantic } = makeStubs();

    const strategy = selectStrategy({ tier: 'private', strategies: { keyword, semantic } });

    expect(strategy).toBe(keyword);
    await strategy.retrieve({ query: 'q', version: 'v1' });
    expect(semantic.retrieve).not.toHaveBeenCalled();
  });

  it('falls back to keyword when the semantic path qualifies but no semantic strategy is injected', async () => {
    const keyword = { retrieve: jest.fn().mockResolvedValue({ results: [], totalResults: 0, query: 'keyword', suggestions: [] }) };

    const strategy = selectStrategy({
      config: { enabled: true, retrievalMode: 'semantic', minTier: 'paid' },
      tier: 'private',
      strategies: { keyword }
    });

    expect(strategy).toBe(keyword);
  });

  it.each([
    ['strategies.keyword is absent', { semantic: { retrieve: jest.fn() } }],
    ['strategies is empty', {}],
    ['strategies.keyword lacks a retrieve() method', { keyword: {} }]
  ])('throws INVALID_CONFIG when %s', (_label, strategies) => {
    const error = captureThrow(() => selectStrategy({
      config: { enabled: true, retrievalMode: 'semantic' },
      tier: 'private',
      strategies
    }));
    expect(error).toBeInstanceOf(RetrievalError);
    expect(error.code).toBe('INVALID_CONFIG');
  });
});

describe('selectStrategy — semantic-assisted mode', () => {
  it('degrades to plain semantic when no semanticAssisted strategy is injected', async () => {
    const keyword = { retrieve: jest.fn().mockResolvedValue({ results: [], totalResults: 0, query: 'keyword', suggestions: [] }) };
    const semantic = { retrieve: jest.fn().mockResolvedValue({ results: [], totalResults: 0, query: 'semantic', suggestions: [] }) };

    const strategy = selectStrategy({
      config: { enabled: true, retrievalMode: 'semantic-assisted', minTier: 'paid' },
      tier: 'private',
      strategies: { keyword, semantic }
    });
    const result = await strategy.retrieve({ query: 'q', version: 'v1' });

    expect(semantic.retrieve).toHaveBeenCalledTimes(1);
    expect(keyword.retrieve).not.toHaveBeenCalled();
    expect(result.query).toBe('semantic');
  });

  it('uses the assisted strategy when it is injected', async () => {
    const keyword = { retrieve: jest.fn().mockResolvedValue({ results: [], totalResults: 0, query: 'keyword', suggestions: [] }) };
    const semantic = { retrieve: jest.fn().mockResolvedValue({ results: [], totalResults: 0, query: 'semantic', suggestions: [] }) };
    const semanticAssisted = { retrieve: jest.fn().mockResolvedValue({ results: [], totalResults: 0, query: 'assisted', suggestions: [] }) };

    const strategy = selectStrategy({
      config: { enabled: true, retrievalMode: 'semantic-assisted', minTier: 'paid' },
      tier: 'private',
      strategies: { keyword, semantic, semanticAssisted }
    });
    const result = await strategy.retrieve({ query: 'q', version: 'v1' });

    expect(semanticAssisted.retrieve).toHaveBeenCalledTimes(1);
    expect(semantic.retrieve).not.toHaveBeenCalled();
    expect(keyword.retrieve).not.toHaveBeenCalled();
    expect(result.query).toBe('assisted');
  });
});

describe('selectStrategy — semantic error transparently falls back to keyword (Req 2.4)', () => {
  it('runs semantic first, logs one warn, and returns the keyword result on semantic failure', async () => {
    const keywordResponse = makeKeywordResponse('rotate the key');
    const keyword = { retrieve: jest.fn().mockResolvedValue(keywordResponse) };
    const semantic = { retrieve: jest.fn().mockRejectedValue(new RetrievalError('semantic boom', { code: 'RETRIEVAL_FAILED' })) };
    const logger = makeLogger();

    const strategy = selectStrategy({
      config: { enabled: true, retrievalMode: 'semantic', minTier: 'paid' },
      tier: 'private',
      strategies: { keyword, semantic },
      logger
    });
    const result = await strategy.retrieve({ query: 'rotate the key', version: 'v3' });

    expect(strategy).toBeInstanceOf(FallbackRetrieval);
    expect(semantic.retrieve).toHaveBeenCalledTimes(1);
    expect(keyword.retrieve).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // Fallback preserves the keyword result unchanged (shape parity on fallback).
    expect(result).toBe(keywordResponse);
    expect(Object.keys(result).sort()).toEqual(ENVELOPE_KEYS);
  });
});

describe('FallbackRetrieval', () => {
  it.each([
    ['primary is missing', { fallback: { retrieve: jest.fn() } }],
    ['primary lacks retrieve()', { primary: {}, fallback: { retrieve: jest.fn() } }],
    ['fallback is missing', { primary: { retrieve: jest.fn() } }],
    ['fallback lacks retrieve()', { primary: { retrieve: jest.fn() }, fallback: {} }]
  ])('throws INVALID_CONFIG when %s', (_label, deps) => {
    const error = captureThrow(() => new FallbackRetrieval(deps));
    expect(error).toBeInstanceOf(RetrievalError);
    expect(error.code).toBe('INVALID_CONFIG');
  });

  it('returns the primary result and never calls fallback when the primary succeeds', async () => {
    const primaryResponse = { results: [], totalResults: 0, query: 'primary', suggestions: [] };
    const primary = { retrieve: jest.fn().mockResolvedValue(primaryResponse) };
    const fallback = { retrieve: jest.fn() };
    const logger = makeLogger();
    const wrapped = new FallbackRetrieval({ primary, fallback, logger, strategyName: 'semantic' });

    const result = await wrapped.retrieve({ query: 'q', version: 'v1' });

    expect(result).toBe(primaryResponse);
    expect(fallback.retrieve).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('on primary error logs exactly one warn and returns the keyword result unchanged', async () => {
    const keywordResponse = makeKeywordResponse('q');
    const primary = { retrieve: jest.fn().mockRejectedValue(new RetrievalError('primary failed', { code: 'RETRIEVAL_FAILED' })) };
    const fallback = { retrieve: jest.fn().mockResolvedValue(keywordResponse) };
    const logger = makeLogger();
    const wrapped = new FallbackRetrieval({ primary, fallback, logger, strategyName: 'semantic' });

    const result = await wrapped.retrieve({ query: 'q', version: 'v1' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(fallback.retrieve).toHaveBeenCalledTimes(1);
    expect(result).toBe(keywordResponse);
  });

  it('does not swallow a fallback (keyword) error — it propagates to the caller', async () => {
    const primary = { retrieve: jest.fn().mockRejectedValue(new RetrievalError('primary failed', { code: 'RETRIEVAL_FAILED' })) };
    const keywordError = new Error('keyword also failed');
    const fallback = { retrieve: jest.fn().mockRejectedValue(keywordError) };
    const logger = makeLogger();
    const wrapped = new FallbackRetrieval({ primary, fallback, logger, strategyName: 'semantic' });

    const error = await captureError(wrapped.retrieve({ query: 'q', version: 'v1' }));

    // The fallback's own error is surfaced (not masked by the wrapper).
    expect(error).toBe(keywordError);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('logs the strategy name and error code but NOT the query text (no PII)', async () => {
    const secretQuery = 'super-secret-query-text-xyz';
    const primary = { retrieve: jest.fn().mockRejectedValue(new RetrievalError('boom', { code: 'RETRIEVAL_FAILED' })) };
    const fallback = { retrieve: jest.fn().mockResolvedValue(makeKeywordResponse(secretQuery)) };
    const logger = makeLogger();
    const wrapped = new FallbackRetrieval({ primary, fallback, logger, strategyName: 'semantic' });

    await wrapped.retrieve({ query: secretQuery, version: 'v1' });

    const warnMessage = logger.warn.mock.calls[0][0];
    expect(warnMessage).toContain('semantic');
    expect(warnMessage).toContain('RETRIEVAL_FAILED');
    expect(warnMessage).not.toContain(secretQuery);
  });
});
