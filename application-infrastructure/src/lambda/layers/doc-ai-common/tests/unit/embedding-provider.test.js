'use strict';

/**
 * Unit tests for EmbeddingProvider (doc-ai-common Lambda Layer).
 *
 * Purpose: Verify the Bedrock Titan Text Embeddings V2 wrapper builds the correct
 * InvokeModel request, returns a vector of the configured length, truncates
 * oversized input, and surfaces typed errors so callers can fall back to keyword
 * search.
 *
 * Setup: A plain fake Bedrock client (`{ send: jest.fn() }`) is injected via the
 * constructor test seam so NO real Bedrock/network call happens. The InvokeModelCommand
 * is still constructed by the AWS SDK (a devDependency of this layer), and its params
 * are inspected via `command.input`.
 *
 * Teardown: `jest.restoreAllMocks()` / `jest.clearAllMocks()` in afterEach keeps tests
 * isolated.
 *
 * Validates: Requirements 2.1 (semantic vector retrieval request/return shape),
 * 6.5 (index-time input truncation to the token budget), and the typed-error paths
 * that enable the keyword fallback (Requirement 2.4) — delivered as a shared Layer
 * (Requirement 8.5).
 */

const {
  EmbeddingProvider,
  EmbeddingError,
  EmbeddingInvalidInputError
} = require('../../nodejs/embedding-provider');

/**
 * Build a fake Amazon Titan Text Embeddings V2 InvokeModel response.
 *
 * The real Bedrock response `body` is a Uint8Array of UTF-8 JSON bytes shaped like
 * `{ embedding: number[], inputTextTokenCount: number }`.
 *
 * @param {number[]} embedding - The embedding vector to return.
 * @param {number} [inputTextTokenCount=3] - Reported token count (unused by the parser).
 * @returns {{body: Uint8Array}} A fake response object accepted by EmbeddingProvider.
 */
function titanResponse(embedding, inputTextTokenCount = 3) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ embedding, inputTextTokenCount })
    )
  };
}

/**
 * Build a deterministic embedding vector of a given length.
 *
 * @param {number} length - Desired vector length.
 * @returns {number[]} A vector `[0, 1, 2, ...]` of the requested length.
 */
function makeEmbedding(length) {
  return Array.from({ length }, (_, index) => index / 10);
}

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

describe('EmbeddingProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('embed() request shape (Req 2.1)', () => {
    it('sends one InvokeModel command with the configured model, JSON content types, and Titan v2 body', async () => {
      const send = jest.fn().mockResolvedValue(titanResponse(makeEmbedding(4)));
      const provider = new EmbeddingProvider({
        model: 'amazon.titan-embed-text-v2:0',
        dimensions: 4,
        maxInputTokens: 8000,
        client: { send }
      });

      await provider.embed('hello');

      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0][0];
      // AWS SDK v3 command classes store their params on `.input`.
      expect(command.input.modelId).toBe('amazon.titan-embed-text-v2:0');
      expect(command.input.contentType).toBe('application/json');
      expect(command.input.accept).toBe('application/json');
      expect(JSON.parse(command.input.body)).toEqual({
        inputText: 'hello',
        dimensions: 4,
        normalize: true
      });
    });
  });

  describe('embed() return value (Req 2.1)', () => {
    it('resolves to the exact embedding array of the configured length', async () => {
      const vector = [0.11, 0.22, 0.33, 0.44];
      const send = jest.fn().mockResolvedValue(titanResponse(vector));
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const result = await provider.embed('hello');

      expect(result).toEqual(vector);
      expect(result).toHaveLength(4);
    });
  });

  describe('input truncation (Req 6.5)', () => {
    it('truncates input to maxInputTokens * 4 characters (keeping the leading slice)', async () => {
      const send = jest.fn().mockResolvedValue(titanResponse(makeEmbedding(4)));
      // maxInputTokens = 2 -> maxChars = 2 * APPROX_CHARS_PER_TOKEN(4) = 8.
      const provider = new EmbeddingProvider({ dimensions: 4, maxInputTokens: 2, client: { send } });
      // 50 distinct characters so we can verify the FIRST 8 are kept.
      const longInput = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwx';
      expect(longInput).toHaveLength(50);

      await provider.embed(longInput);

      const body = JSON.parse(send.mock.calls[0][0].input.body);
      expect(body.inputText).toHaveLength(8);
      expect(body.inputText).toBe(longInput.slice(0, 8));
      expect(body.inputText).toBe('ABCDEFGH');
    });

    it('passes input at or under the character budget through untruncated', async () => {
      const send = jest.fn().mockResolvedValue(titanResponse(makeEmbedding(4)));
      // maxChars = 8; 'short' is 5 chars, so it must be sent unchanged.
      const provider = new EmbeddingProvider({ dimensions: 4, maxInputTokens: 2, client: { send } });

      await provider.embed('short');

      const body = JSON.parse(send.mock.calls[0][0].input.body);
      expect(body.inputText).toBe('short');
    });
  });

  describe('error paths', () => {
    it('rejects with DIMENSION_MISMATCH when the response vector length != configured dimensions', async () => {
      const send = jest.fn().mockResolvedValue(titanResponse(makeEmbedding(3)));
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const error = await captureError(provider.embed('hello'));

      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error.code).toBe('DIMENSION_MISMATCH');
    });

    it('rejects with INVALID_RESPONSE when the response body has no embedding array', async () => {
      const send = jest.fn().mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify({}))
      });
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const error = await captureError(provider.embed('hello'));

      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error.code).toBe('INVALID_RESPONSE');
    });

    it('rejects with INVALID_RESPONSE (preserving cause) when the response body is not valid JSON', async () => {
      const send = jest.fn().mockResolvedValue({
        body: new TextEncoder().encode('not-json{')
      });
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const error = await captureError(provider.embed('hello'));

      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error.code).toBe('INVALID_RESPONSE');
      expect(error.cause).toBeInstanceOf(Error);
    });

    it('wraps a send/SDK failure as EmbeddingError code INVOCATION_FAILED and preserves the original cause (Req 2.4 fallback enabler)', async () => {
      const original = new Error('throttled');
      const send = jest.fn().mockRejectedValue(original);
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const error = await captureError(provider.embed('hello'));

      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error.code).toBe('INVOCATION_FAILED');
      expect(error.cause).toBe(original);
    });
  });

  describe('invalid input (throws before any Bedrock call)', () => {
    const cases = [
      ['an empty string', ''],
      ['a whitespace-only string', '   '],
      ['null', null],
      ['a number', 123]
    ];

    it.each(cases)('rejects %s with EmbeddingInvalidInputError and never calls send', async (_label, badInput) => {
      const send = jest.fn();
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const error = await captureError(provider.embed(badInput));

      expect(error).toBeInstanceOf(EmbeddingInvalidInputError);
      // EmbeddingInvalidInputError is a subtype of EmbeddingError.
      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error.code).toBe('INVALID_INPUT');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('embedBatch()', () => {
    it('returns vectors aligned to input order', async () => {
      const vecA = [0.1, 0.2, 0.3, 0.4];
      const vecB = [0.5, 0.6, 0.7, 0.8];
      const send = jest.fn()
        .mockResolvedValueOnce(titanResponse(vecA))
        .mockResolvedValueOnce(titanResponse(vecB));
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const result = await provider.embedBatch(['a', 'b']);

      expect(result).toEqual([vecA, vecB]);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('rejects non-array input with EmbeddingInvalidInputError without calling send', async () => {
      const send = jest.fn();
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      const error = await captureError(provider.embedBatch('notArray'));

      expect(error).toBeInstanceOf(EmbeddingInvalidInputError);
      expect(error.code).toBe('INVALID_INPUT');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('lazy Bedrock client', () => {
    it('does not throw at construction without an injected client and uses the injected client when embedding', async () => {
      // Merely instantiating (no embed call) must not construct a real client or throw.
      expect(() => new EmbeddingProvider({ dimensions: 4 })).not.toThrow();

      // With an injected client, embed() uses it — no real Bedrock construction/call.
      const send = jest.fn().mockResolvedValue(titanResponse(makeEmbedding(4)));
      const provider = new EmbeddingProvider({ dimensions: 4, client: { send } });

      await provider.embed('hello');

      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
