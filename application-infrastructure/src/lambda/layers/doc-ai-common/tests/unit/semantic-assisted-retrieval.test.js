'use strict';

/**
 * Unit tests for SemanticAssistedRetrieval + its selectStrategy wiring (doc-ai-common
 * Lambda Layer).
 *
 * Purpose: Verify the already-implemented `semantic-assisted` strategy (tasks 7.1/7.2)
 * against its contract, covering the four areas named by task 7.3:
 *   1. Deterministic reorder — the EXISTING semantic result objects are reordered exactly
 *      by the assist ordering, unreferenced candidates are appended in original order, the
 *      list is sliced to the effective topK, and the same inputs always yield the same
 *      output (Req 5.1). The reused objects are the SAME references (no re-creation).
 *   2. No-prose guarantee — every returned result is one of the original semantic result
 *      objects (by identity) with no assist/model-authored fields added; the assist output
 *      is used ONLY as an ordering (Req 5.2).
 *   3. Fallback (graceful degrade) — an assist `rerank` rejection does NOT throw: it logs
 *      exactly one warning, emits NO usage line, and returns the plain semantic results
 *      (Req 5.3). A semantic-strategy failure (before assist) PROPAGATES instead, so the
 *      outer FallbackRetrieval still degrades to keyword (Req 2.4).
 *   4. Mode switch requires no code change — the assisted envelope shape is identical to
 *      the plain semantic/keyword envelope, and the `<= 1 candidate` short-circuit skips
 *      the assist call entirely (Req 5.4).
 *   Plus usage/cost logging (Req 5.5), constructor validation, and the selectStrategy
 *   integration that routes `semantic-assisted` to the assisted strategy.
 *
 * Setup: Every collaborator is INJECTED as a plain fake / `jest.fn()` — a `semantic`
 * strategy (`{ retrieve }`), an `assist` provider (`{ rerank }`), and a
 * `{ warn, error, debug, info }` logger. There are NO real AWS SDK calls and no network.
 *
 * Teardown: `jest.restoreAllMocks()` / `jest.clearAllMocks()` in `afterEach` keeps tests
 * isolated.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5 (semantic-assisted behavior) and 7.4
 * (usage/cost observability).
 */

const {
  SemanticAssistedRetrieval,
  FallbackRetrieval,
  RetrievalError,
  selectStrategy
} = require('../../nodejs/retrieval-strategy');

/**
 * The response-envelope keys shared by the keyword, semantic, and semantic-assisted paths.
 * @constant {string[]}
 */
const ENVELOPE_KEYS = ['query', 'results', 'suggestions', 'totalResults'];

/**
 * The documented `search_documentation` result-object fields (used to assert the
 * assisted path adds no extra/synthesized fields).
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
 * Build a single documented-shape semantic result object.
 *
 * @param {number} i - The result's index (varies the sample fields; higher = lower score).
 * @returns {Object} A result object with exactly the {@link DOCUMENTED_RESULT_KEYS}.
 */
function makeResult(i) {
  return {
    title: `Doc ${i}`,
    excerpt: `Excerpt ${i}`,
    filePath: `docs/${i}.md`,
    githubUrl: `https://github.com/63klabs/atlantis/blob/main/docs/${i}.md`,
    type: 'documentation',
    subType: 'guide',
    relevanceScore: 1 - i / 100,
    repository: 'atlantis',
    repositoryType: 'github',
    namespace: 'default'
  };
}

/**
 * Build `count` documented-shape result objects (stable references for identity checks).
 *
 * @param {number} count - Number of results to build.
 * @returns {Object[]} The result objects, in semantic (descending-score) order.
 */
function makeResults(count) {
  return Array.from({ length: count }, (_, i) => makeResult(i));
}

/**
 * Build a semantic response envelope wrapping the given results (parity with the keyword
 * path: suggestions only when empty).
 *
 * @param {Object[]} results - The semantic result objects.
 * @param {string} [query='rotate the key'] - The query echoed in the envelope.
 * @returns {{results: Object[], totalResults: number, query: string, suggestions: string[]}} The envelope.
 */
function makeEnvelope(results, query = 'rotate the key') {
  return {
    results,
    totalResults: results.length,
    query,
    suggestions: results.length === 0
      ? ['Try using fewer or more general keywords', 'Try filtering by type']
      : []
  };
}

/**
 * Build a `{ warn, error, debug, info }` logger of jest mocks. `info` is included because the
 * usage/cost line is emitted at INFO level (so it is visible in PROD, `LOG_LEVEL=INFO`).
 *
 * @returns {{warn: jest.Mock, error: jest.Mock, debug: jest.Mock, info: jest.Mock}} The logger fake.
 */
function makeLogger() {
  return { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() };
}

/**
 * Return the subset of `logger.info` calls that emitted a `DOC_AI_USAGE` line. The usage/cost
 * line is emitted via `info` (INFO level, PROD-visible), not `debug`.
 *
 * @param {{info: jest.Mock}} logger - The logger fake.
 * @returns {Array<Array<*>>} The matching info-call argument arrays.
 */
function usageLogCalls(logger) {
  return logger.info.mock.calls.filter(
    (args) => typeof args[0] === 'string' && args[0].startsWith('DOC_AI_USAGE')
  );
}

/**
 * Construct a {@link SemanticAssistedRetrieval} wired to injected fakes, returning the
 * strategy and its collaborators for assertions.
 *
 * @param {Object} [overrides] - Optional dependency/config overrides.
 * @param {Object[]} [overrides.results] - Results the semantic strategy resolves (default 5).
 * @param {Object} [overrides.envelope] - Full envelope override (takes precedence over results).
 * @param {Object} [overrides.semantic] - Custom semantic strategy fake.
 * @param {number[]} [overrides.order] - Order the assist provider resolves.
 * @param {Object|null} [overrides.usage] - Usage the assist provider resolves.
 * @param {Object} [overrides.assist] - Custom assist provider fake.
 * @param {Object} [overrides.logger] - Injected logger.
 * @param {string} [overrides.storeType] - Vector-store label for logging.
 * @param {number} [overrides.topK] - Constructor default topK.
 * @param {number} [overrides.candidateMultiplier] - Candidate multiplier.
 * @param {number} [overrides.maxCandidates] - Candidate cap.
 * @returns {{assisted: SemanticAssistedRetrieval, semantic: Object, assist: Object, logger: (Object|undefined), results: Object[]}} The strategy and fakes.
 */
function makeAssisted(overrides = {}) {
  const results = overrides.results !== undefined ? overrides.results : makeResults(5);
  const envelope = overrides.envelope !== undefined
    ? overrides.envelope
    : makeEnvelope(results, overrides.query);
  const semantic = overrides.semantic
    || { retrieve: jest.fn().mockResolvedValue(envelope) };
  const assist = overrides.assist || {
    rerank: jest.fn().mockResolvedValue({
      order: overrides.order || [],
      usage: overrides.usage === undefined ? null : overrides.usage
    })
  };

  const assisted = new SemanticAssistedRetrieval({
    semantic,
    assist,
    candidateMultiplier: overrides.candidateMultiplier,
    maxCandidates: overrides.maxCandidates,
    topK: overrides.topK,
    logger: overrides.logger,
    storeType: overrides.storeType
  });

  return { assisted, semantic, assist, logger: overrides.logger, results };
}

/**
 * Await a promise expected to reject and return the thrown error for assertions.
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
 * Capture a synchronously thrown error for assertions (constructor validation).
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

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('SemanticAssistedRetrieval — constructor validation', () => {
  it.each([
    ['semantic missing', { assist: { rerank: jest.fn() } }],
    ['semantic lacks retrieve()', { semantic: {}, assist: { rerank: jest.fn() } }],
    ['assist missing', { semantic: { retrieve: jest.fn() } }],
    ['assist lacks rerank()', { semantic: { retrieve: jest.fn() }, assist: {} }]
  ])('throws INVALID_CONFIG when %s', (_label, deps) => {
    const error = captureThrow(() => new SemanticAssistedRetrieval(deps));
    expect(error).toBeInstanceOf(RetrievalError);
    expect(error.code).toBe('INVALID_CONFIG');
  });
});

describe('SemanticAssistedRetrieval — deterministic reorder (Req 5.1)', () => {
  it('reorders the EXISTING result objects exactly by the assist order and appends unreferenced candidates', async () => {
    const results = makeResults(5);
    // Partial ordering: assist references only 3 of the 5 candidates.
    const { assisted, semantic, assist } = makeAssisted({ results, order: [2, 0, 3], topK: 10 });

    const result = await assisted.retrieve({ query: 'rotate the key', version: 'v3' });

    // Referenced indices first (2,0,3), then unreferenced (1,4) in original semantic order.
    expect(result.results).toEqual([results[2], results[0], results[3], results[1], results[4]]);
    // The SAME object references are reused — no re-creation.
    expect(result.results[0]).toBe(results[2]);
    expect(result.results[1]).toBe(results[0]);
    expect(result.results[2]).toBe(results[3]);
    expect(result.results[3]).toBe(results[1]);
    expect(result.results[4]).toBe(results[4]);

    expect(semantic.retrieve).toHaveBeenCalledTimes(1);
    expect(assist.rerank).toHaveBeenCalledTimes(1);
  });

  it('slices the reordered results to the effective topK', async () => {
    const results = makeResults(5);
    const { assisted } = makeAssisted({ results, order: [4, 3, 2, 1, 0], topK: 3 });

    const result = await assisted.retrieve({ query: 'q', version: 'v3', topK: 3 });

    expect(result.results).toHaveLength(3);
    // Reversed order, sliced to the first 3.
    expect(result.results).toEqual([results[4], results[3], results[2]]);
    expect(result.totalResults).toBe(3);
  });

  it('is deterministic: identical inputs produce identical output', async () => {
    const results = makeResults(5);
    const { assisted } = makeAssisted({ results, order: [3, 1, 4, 0, 2], topK: 10 });

    const first = await assisted.retrieve({ query: 'q', version: 'v3' });
    const second = await assisted.retrieve({ query: 'q', version: 'v3' });

    expect(second.results).toEqual(first.results);
    expect(second.results).toEqual([results[3], results[1], results[4], results[0], results[2]]);
  });

  it('feeds min(topK * candidateMultiplier, maxCandidates) as the semantic candidate fetch size', async () => {
    // topK 10 * multiplier 3 = 30, capped at maxCandidates 25.
    const { assisted, semantic } = makeAssisted({
      results: makeResults(2),
      order: [0, 1],
      topK: 10,
      candidateMultiplier: 3,
      maxCandidates: 25
    });

    await assisted.retrieve({ query: 'q', version: 'v3' });

    expect(semantic.retrieve.mock.calls[0][0].topK).toBe(25);
  });
});

describe('SemanticAssistedRetrieval — no-prose guarantee (Req 5.2)', () => {
  it('returns only original semantic result objects (by identity) with no added fields', async () => {
    const results = makeResults(3);
    // Freeze the originals: any attempt to write assist/model text onto a result would throw.
    results.forEach((result) => Object.freeze(result));
    const { assisted, assist } = makeAssisted({ results, order: [2, 1, 0], topK: 10 });

    const result = await assisted.retrieve({ query: 'rotate the key', version: 'v3' });

    // The assist provider was asked to re-rank and returned only an ordering (never text).
    expect(assist.rerank).toHaveBeenCalledTimes(1);
    // Every returned object is one of the originals (reference identity) with unchanged keys.
    for (const item of result.results) {
      expect(results).toContain(item);
      expect(Object.keys(item).sort()).toEqual([...DOCUMENTED_RESULT_KEYS].sort());
    }
    // No synthesized/extra result object was introduced.
    expect(result.results).toHaveLength(3);
    expect(new Set(result.results).size).toBe(3);
  });

  it('passes only { index, title, excerpt } descriptors to the assist provider (no model-authored content flows back)', async () => {
    const results = makeResults(2);
    const { assisted, assist } = makeAssisted({ results, order: [1, 0], topK: 10 });

    await assisted.retrieve({ query: 'q', version: 'v3' });

    const rerankArgs = assist.rerank.mock.calls[0][0];
    expect(rerankArgs.candidates).toEqual([
      { index: 0, title: 'Doc 0', excerpt: 'Excerpt 0' },
      { index: 1, title: 'Doc 1', excerpt: 'Excerpt 1' }
    ]);
  });
});

describe('SemanticAssistedRetrieval — fallback / graceful degrade (Req 5.3)', () => {
  it('does not throw on assist rerank rejection: logs one warn, emits no usage line, returns plain semantic results', async () => {
    const results = makeResults(5);
    const logger = makeLogger();
    const assist = { rerank: jest.fn().mockRejectedValue(new Error('bedrock throttled')) };
    const { assisted, semantic } = makeAssisted({ results, assist, logger, topK: 3, storeType: 's3-vectors' });

    const result = await assisted.retrieve({ query: 'rotate the key', version: 'v3', topK: 3 });

    // Degrades to the plain semantic results (in original order), sliced to topK.
    expect(result.results).toEqual([results[0], results[1], results[2]]);
    expect(result.totalResults).toBe(3);
    expect(semantic.retrieve).toHaveBeenCalledTimes(1);
    expect(assist.rerank).toHaveBeenCalledTimes(1);
    // Exactly one warning, and NO DOC_AI_USAGE line on the degrade path.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(usageLogCalls(logger)).toHaveLength(0);
  });

  it('logs the strategy label + store + error code on degrade but NOT the query text (no PII)', async () => {
    const secretQuery = 'super-secret-query-text-xyz';
    const logger = makeLogger();
    const assist = { rerank: jest.fn().mockRejectedValue(new RetrievalError('boom', { code: 'INVOCATION_FAILED' })) };
    const { assisted } = makeAssisted({ results: makeResults(3), assist, logger, storeType: 's3-vectors' });

    await assisted.retrieve({ query: secretQuery, version: 'v3' });

    const warnMessage = logger.warn.mock.calls[0][0];
    expect(warnMessage).toContain('semantic-assisted');
    expect(warnMessage).toContain('s3-vectors');
    expect(warnMessage).toContain('INVOCATION_FAILED');
    expect(warnMessage).not.toContain(secretQuery);
  });

  it('propagates a semantic-strategy failure (thrown BEFORE assist) and never calls assist or logs a degrade warning', async () => {
    const cause = new RetrievalError('vector store down', { code: 'RETRIEVAL_FAILED' });
    const semantic = { retrieve: jest.fn().mockRejectedValue(cause) };
    const assist = { rerank: jest.fn() };
    const logger = makeLogger();
    const { assisted } = makeAssisted({ semantic, assist, logger });

    const error = await captureError(assisted.retrieve({ query: 'q', version: 'v3' }));

    // The semantic error propagates unchanged (selectStrategy's FallbackRetrieval handles it).
    expect(error).toBe(cause);
    expect(assist.rerank).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('SemanticAssistedRetrieval — mode switch requires no code change (Req 5.4)', () => {
  it('returns the same envelope shape as the plain semantic/keyword path', async () => {
    const results = makeResults(4);
    const { assisted } = makeAssisted({ results, order: [0, 1, 2, 3], topK: 10 });

    const result = await assisted.retrieve({ query: 'rotate the key', version: 'v3' });

    expect(Object.keys(result).sort()).toEqual(ENVELOPE_KEYS);
    expect(result.totalResults).toBe(result.results.length);
    expect(result.query).toBe('rotate the key');
    expect(result.suggestions).toEqual([]);
  });

  it('short-circuits with a single candidate: does not call assist and emits no usage line', async () => {
    const logger = makeLogger();
    const { assisted, assist } = makeAssisted({ results: makeResults(1), logger });

    const result = await assisted.retrieve({ query: 'q', version: 'v3' });

    expect(result.results).toHaveLength(1);
    expect(assist.rerank).not.toHaveBeenCalled();
    expect(usageLogCalls(logger)).toHaveLength(0);
  });

  it('short-circuits with zero candidates (no active version): returns the empty envelope with suggestions, no assist call', async () => {
    const logger = makeLogger();
    const emptyEnvelope = makeEnvelope([], 'q'); // suggestions present when empty
    const { assisted, assist } = makeAssisted({ envelope: emptyEnvelope, logger });

    const result = await assisted.retrieve({ query: 'q' });

    expect(result.results).toEqual([]);
    expect(result.totalResults).toBe(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(assist.rerank).not.toHaveBeenCalled();
    expect(usageLogCalls(logger)).toHaveLength(0);
  });
});

describe('SemanticAssistedRetrieval — usage/cost logging (Req 5.5, 7.4)', () => {
  it('emits exactly one DOC_AI_USAGE info line with the injected store and the assist token counts', async () => {
    const logger = makeLogger();
    const usage = { inputTokens: 123, outputTokens: 7, totalTokens: 130 };
    const { assisted } = makeAssisted({
      results: makeResults(2),
      order: [0, 1],
      usage,
      logger,
      storeType: 's3-vectors',
      topK: 10
    });

    await assisted.retrieve({ query: 'q', version: 'v3' });

    // Emitted at INFO (PROD-visible), not debug. With >1 candidate the <=1 debug trace is skipped.
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'DOC_AI_USAGE {"strategy":"semantic-assisted","store":"s3-vectors","inputTokens":123,"outputTokens":7,"totalTokens":130}'
    );
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs zero token counts when the assist usage is null', async () => {
    const logger = makeLogger();
    const { assisted } = makeAssisted({
      results: makeResults(2),
      order: [0, 1],
      usage: null,
      logger,
      storeType: 'dynamodb',
      topK: 10
    });

    await assisted.retrieve({ query: 'q', version: 'v3' });

    expect(usageLogCalls(logger)).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      'DOC_AI_USAGE {"strategy":"semantic-assisted","store":"dynamodb","inputTokens":0,"outputTokens":0,"totalTokens":0}'
    );
  });

  it('defaults the store label to "unknown" when storeType is not injected', async () => {
    const logger = makeLogger();
    const { assisted } = makeAssisted({
      results: makeResults(2),
      order: [0, 1],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      logger,
      topK: 10
    });

    await assisted.retrieve({ query: 'q', version: 'v3' });

    expect(logger.info).toHaveBeenCalledWith(
      'DOC_AI_USAGE {"strategy":"semantic-assisted","store":"unknown","inputTokens":1,"outputTokens":2,"totalTokens":3}'
    );
  });
});

describe('selectStrategy — semantic-assisted integration', () => {
  const ASSISTED_CONFIG = { enabled: true, retrievalMode: 'semantic-assisted', minTier: 'paid' };

  it('routes a qualifying request to a REAL SemanticAssistedRetrieval (wrapped in FallbackRetrieval) which re-ranks', async () => {
    const results = makeResults(3);
    const innerSemantic = { retrieve: jest.fn().mockResolvedValue(makeEnvelope(results)) };
    const innerAssist = { rerank: jest.fn().mockResolvedValue({ order: [2, 1, 0], usage: null }) };
    const semanticAssisted = new SemanticAssistedRetrieval({ semantic: innerSemantic, assist: innerAssist, topK: 10 });

    const keyword = { retrieve: jest.fn() };
    const semantic = { retrieve: jest.fn() };

    const strategy = selectStrategy({
      config: ASSISTED_CONFIG,
      tier: 'private',
      strategies: { keyword, semantic, semanticAssisted }
    });
    const result = await strategy.retrieve({ query: 'q', version: 'v3' });

    expect(strategy).toBeInstanceOf(FallbackRetrieval);
    expect(innerAssist.rerank).toHaveBeenCalledTimes(1);
    // The assisted strategy was chosen — plain semantic and keyword are untouched.
    expect(semantic.retrieve).not.toHaveBeenCalled();
    expect(keyword.retrieve).not.toHaveBeenCalled();
    expect(result.results).toEqual([results[2], results[1], results[0]]);
  });

  it('falls back to keyword via the outer FallbackRetrieval when the assisted strategy throws (semantic failure)', async () => {
    // Force the assisted strategy to throw by making its inner semantic strategy reject
    // before the assist step (an assist failure would degrade, not throw).
    const innerSemantic = { retrieve: jest.fn().mockRejectedValue(new RetrievalError('down', { code: 'RETRIEVAL_FAILED' })) };
    const innerAssist = { rerank: jest.fn() };
    const semanticAssisted = new SemanticAssistedRetrieval({ semantic: innerSemantic, assist: innerAssist });

    const keywordResponse = makeEnvelope(makeResults(1), 'kw');
    const keyword = { retrieve: jest.fn().mockResolvedValue(keywordResponse) };
    const logger = makeLogger();

    const strategy = selectStrategy({
      config: ASSISTED_CONFIG,
      tier: 'private',
      strategies: { keyword, semanticAssisted },
      logger
    });
    const result = await strategy.retrieve({ query: 'q', version: 'v3' });

    expect(strategy).toBeInstanceOf(FallbackRetrieval);
    expect(result).toBe(keywordResponse);
    expect(innerAssist.rerank).not.toHaveBeenCalled();
    expect(keyword.retrieve).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
