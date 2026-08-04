'use strict';

/**
 * Unit tests for the model-not-available ERROR logging in the retrieval strategies
 * (doc-ai-common Lambda Layer, spec 0-0-6, task 13.3).
 *
 * Tasks 13.1/13.2 added ONE additional ERROR-level log line
 * (event `doc_ai_bedrock_model_unavailable`, carrying the strategy label, Bedrock model id,
 * and the targeted region) emitted through the INJECTED logger's `error` method ONLY when a
 * caught degrade is classified as `MODEL_NOT_AVAILABLE` (via `error.code` or
 * `error.cause.code`), alongside the pre-existing WARN-level degrade line. It is emitted in:
 *   - `FallbackRetrieval.retrieve` — the single degrade-to-keyword point for a semantic
 *     failure (a `SemanticRetrieval` failure arrives here wrapped, so the classification
 *     lives on `error.cause.code`); carries the embedding model + region injected by
 *     `selectStrategy`.
 *   - `SemanticAssistedRetrieval.retrieve` — the assist-failure degrade-to-plain-semantic
 *     point (an `AssistError` carries the classification on `error.code`); carries the
 *     assist model + `AWS_REGION`.
 * `SemanticRetrieval` intentionally re-throws (it does NOT log) so the line is emitted
 * exactly once at the outer degrade point.
 *
 * These tests verify:
 *   - the exported `isModelUnavailableError` helper classifies both `code` and `cause.code`
 *     shapes and never throws on odd input;
 *   - `FallbackRetrieval` and `SemanticAssistedRetrieval` emit the `MODEL_UNAVAILABLE_EVENT`
 *     line ONLY for a `MODEL_NOT_AVAILABLE` degrade and NOT for other codes;
 *   - the existing WARN fallback/degrade behavior (fall back to keyword / degrade to plain
 *     semantic) is unchanged in both cases.
 *
 * Every collaborator is INJECTED as a plain fake / `jest.fn()`; there are NO real AWS SDK
 * calls and no network. `jest.clearAllMocks()` in afterEach keeps tests isolated.
 *
 * Validates: Requirements 10.5
 */

const {
  FallbackRetrieval,
  SemanticAssistedRetrieval,
  RetrievalError,
  isModelUnavailableError,
  MODEL_UNAVAILABLE_EVENT
} = require('../../nodejs/retrieval-strategy');

/**
 * Build a `{ warn, error, debug, info }` logger of jest mocks.
 *
 * @returns {{warn: jest.Mock, error: jest.Mock, debug: jest.Mock, info: jest.Mock}} The logger fake.
 */
function makeLogger() {
  return { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() };
}

/**
 * Return the `logger.error` calls that emitted a {@link MODEL_UNAVAILABLE_EVENT} line
 * (the fixed event token, one space, then compact JSON).
 *
 * @param {{error: jest.Mock}} logger - The logger fake.
 * @returns {Array<Array<*>>} The matching error-call argument arrays.
 */
function modelUnavailableCalls(logger) {
  return logger.error.mock.calls.filter(
    (args) => typeof args[0] === 'string' && args[0].startsWith(MODEL_UNAVAILABLE_EVENT)
  );
}

/**
 * Parse the compact-JSON payload from a {@link MODEL_UNAVAILABLE_EVENT} log line.
 *
 * @param {string} line - The full log line (`doc_ai_bedrock_model_unavailable {...}`).
 * @returns {Object} The parsed `{ strategy, model, region }` payload.
 */
function parseEventPayload(line) {
  return JSON.parse(line.slice(line.indexOf(' ') + 1));
}

/**
 * A minimal semantic response envelope (parity with the keyword path).
 *
 * @param {string} query - The query echoed in the envelope.
 * @returns {{results: Object[], totalResults: number, query: string, suggestions: string[]}} The envelope.
 */
function makeKeywordResponse(query) {
  return { results: [], totalResults: 0, query, suggestions: [] };
}

/**
 * Build `count` minimal semantic result objects (stable references).
 *
 * @param {number} count - Number of results to build.
 * @returns {Object[]} The result objects.
 */
function makeResults(count) {
  return Array.from({ length: count }, (_, i) => ({
    title: `Doc ${i}`,
    excerpt: `Excerpt ${i}`,
    relevanceScore: 1 - i / 100
  }));
}

afterEach(() => {
  jest.clearAllMocks();
});

// ------------------------------------------------------------------------------------
// isModelUnavailableError
// ------------------------------------------------------------------------------------

describe('isModelUnavailableError', () => {
  it('returns true when error.code is MODEL_NOT_AVAILABLE', () => {
    expect(isModelUnavailableError(new RetrievalError('x', { code: 'MODEL_NOT_AVAILABLE' }))).toBe(true);
  });

  it('returns true when error.cause.code is MODEL_NOT_AVAILABLE (wrapped semantic failure)', () => {
    const wrapped = new RetrievalError('x', { code: 'RETRIEVAL_FAILED', cause: { code: 'MODEL_NOT_AVAILABLE' } });
    expect(isModelUnavailableError(wrapped)).toBe(true);
  });

  it('returns false for a different error code with no matching cause', () => {
    expect(isModelUnavailableError(new RetrievalError('x', { code: 'RETRIEVAL_FAILED' }))).toBe(false);
  });

  it('returns false when a cause exists but its code does not match', () => {
    const wrapped = new RetrievalError('x', { code: 'RETRIEVAL_FAILED', cause: { code: 'THROTTLED' } });
    expect(isModelUnavailableError(wrapped)).toBe(false);
  });

  it('returns false (never throws) for null / non-object input', () => {
    expect(isModelUnavailableError(null)).toBe(false);
    expect(isModelUnavailableError(undefined)).toBe(false);
    expect(isModelUnavailableError('MODEL_NOT_AVAILABLE')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------
// FallbackRetrieval (semantic degrade-to-keyword point)
// ------------------------------------------------------------------------------------

describe('FallbackRetrieval - model-unavailable ERROR logging (Req 10.5)', () => {
  const MODEL = 'amazon.titan-embed-text-v2:0';
  const REGION = 'us-west-2';

  it('emits ONE MODEL_UNAVAILABLE_EVENT error line (with strategy + model + region) when the wrapped semantic failure is MODEL_NOT_AVAILABLE, and still falls back to keyword', async () => {
    const keywordResponse = makeKeywordResponse('q');
    // A SemanticRetrieval failure reaches FallbackRetrieval wrapped -> classification on cause.code.
    const wrapped = new RetrievalError('semantic failed', { code: 'RETRIEVAL_FAILED', cause: { code: 'MODEL_NOT_AVAILABLE' } });
    const primary = { retrieve: jest.fn().mockRejectedValue(wrapped) };
    const fallback = { retrieve: jest.fn().mockResolvedValue(keywordResponse) };
    const logger = makeLogger();
    const wrappedStrategy = new FallbackRetrieval({
      primary, fallback, logger, strategyName: 'semantic', model: MODEL, region: REGION
    });

    const result = await wrappedStrategy.retrieve({ query: 'q', version: 'v1' });

    // Existing WARN fallback behavior is unchanged: one warn, keyword result returned.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(fallback.retrieve).toHaveBeenCalledTimes(1);
    expect(result).toBe(keywordResponse);

    // Exactly one additional ERROR line, carrying strategy + embedding model + region.
    const errorCalls = modelUnavailableCalls(logger);
    expect(errorCalls).toHaveLength(1);
    expect(parseEventPayload(errorCalls[0][0])).toEqual({ strategy: 'semantic', model: MODEL, region: REGION });
  });

  it('emits the ERROR line when the classification is directly on error.code', async () => {
    const primary = { retrieve: jest.fn().mockRejectedValue(new RetrievalError('boom', { code: 'MODEL_NOT_AVAILABLE' })) };
    const fallback = { retrieve: jest.fn().mockResolvedValue(makeKeywordResponse('q')) };
    const logger = makeLogger();
    const wrappedStrategy = new FallbackRetrieval({
      primary, fallback, logger, strategyName: 'semantic', model: MODEL, region: REGION
    });

    await wrappedStrategy.retrieve({ query: 'q', version: 'v1' });

    expect(modelUnavailableCalls(logger)).toHaveLength(1);
  });

  it('does NOT emit the ERROR line for a non-model-unavailable semantic failure, but WARN fallback is unchanged', async () => {
    const keywordResponse = makeKeywordResponse('q');
    const primary = { retrieve: jest.fn().mockRejectedValue(new RetrievalError('primary failed', { code: 'RETRIEVAL_FAILED' })) };
    const fallback = { retrieve: jest.fn().mockResolvedValue(keywordResponse) };
    const logger = makeLogger();
    const wrappedStrategy = new FallbackRetrieval({
      primary, fallback, logger, strategyName: 'semantic', model: MODEL, region: REGION
    });

    const result = await wrappedStrategy.retrieve({ query: 'q', version: 'v1' });

    // No model-unavailable ERROR line for a generic degrade.
    expect(modelUnavailableCalls(logger)).toHaveLength(0);
    // Existing WARN fallback behavior unchanged.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(fallback.retrieve).toHaveBeenCalledTimes(1);
    expect(result).toBe(keywordResponse);
  });
});

// ------------------------------------------------------------------------------------
// SemanticAssistedRetrieval (assist degrade-to-plain-semantic point)
// ------------------------------------------------------------------------------------

describe('SemanticAssistedRetrieval - model-unavailable ERROR logging (Req 10.5)', () => {
  const ASSIST_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';

  /**
   * Build a SemanticAssistedRetrieval wired to a semantic strategy that returns `results`
   * and an assist provider whose `rerank` rejects with `error`.
   *
   * @param {Object[]} results - The plain semantic results returned before the assist call.
   * @param {Error} error - The assist rerank rejection.
   * @param {{warn: jest.Mock, error: jest.Mock, debug: jest.Mock, info: jest.Mock}} logger - Injected logger.
   * @returns {{assisted: SemanticAssistedRetrieval, semantic: Object, assist: Object}} The strategy + fakes.
   */
  function makeAssisted(results, error, logger) {
    const envelope = { results, totalResults: results.length, query: 'rotate the key', suggestions: [] };
    const semantic = { retrieve: jest.fn().mockResolvedValue(envelope) };
    const assist = { model: ASSIST_MODEL, rerank: jest.fn().mockRejectedValue(error) };
    const assisted = new SemanticAssistedRetrieval({ semantic, assist, logger, storeType: 's3-vectors' });
    return { assisted, semantic, assist };
  }

  it('emits ONE MODEL_UNAVAILABLE_EVENT error line (assist model + AWS_REGION) on a MODEL_NOT_AVAILABLE assist failure, and still degrades to plain semantic results', async () => {
    const results = makeResults(5);
    const logger = makeLogger();
    const assistError = new RetrievalError('assist model missing', { code: 'MODEL_NOT_AVAILABLE' });
    const { assisted, assist } = makeAssisted(results, assistError, logger);

    const previousRegion = process.env.AWS_REGION;
    process.env.AWS_REGION = 'ap-southeast-2';
    let result;
    try {
      result = await assisted.retrieve({ query: 'rotate the key', version: 'v3', topK: 3 });
    } finally {
      if (previousRegion === undefined) {
        delete process.env.AWS_REGION;
      } else {
        process.env.AWS_REGION = previousRegion;
      }
    }

    // Existing degrade behavior unchanged: one warn, plain semantic results (sliced to topK).
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(assist.rerank).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([results[0], results[1], results[2]]);

    // Exactly one additional ERROR line, carrying the assist strategy label + model + region.
    const errorCalls = modelUnavailableCalls(logger);
    expect(errorCalls).toHaveLength(1);
    expect(parseEventPayload(errorCalls[0][0])).toEqual({
      strategy: 'semantic-assisted',
      model: ASSIST_MODEL,
      region: 'ap-southeast-2'
    });
  });

  it('does NOT emit the ERROR line for a non-model-unavailable assist failure, but the WARN degrade is unchanged', async () => {
    const results = makeResults(5);
    const logger = makeLogger();
    const assistError = new RetrievalError('bedrock throttled', { code: 'INVOCATION_FAILED' });
    const { assisted, assist } = makeAssisted(results, assistError, logger);

    const result = await assisted.retrieve({ query: 'rotate the key', version: 'v3', topK: 3 });

    // No model-unavailable ERROR line for a generic assist degrade.
    expect(modelUnavailableCalls(logger)).toHaveLength(0);
    // Existing degrade behavior unchanged: one warn, plain semantic results returned.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(assist.rerank).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([results[0], results[1], results[2]]);
  });
});
