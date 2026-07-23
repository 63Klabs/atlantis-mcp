'use strict';

/**
 * Unit tests for AssistProvider (doc-ai-common Lambda Layer).
 *
 * Purpose: Verify the Amazon Nova `InvokeModel` re-rank wrapper (task 7.1) against its
 * contract: it builds the correct Nova request body (messages schema, JSON-array system
 * prompt, query + numbered candidates, deterministic temperature 0), strictly parses the
 * model's ordering into valid integer candidate indices (rejecting prose, out-of-range,
 * duplicate, and non-integer entries), caps/truncates candidate input to bound cost, and
 * surfaces typed AssistError codes so the calling strategy can degrade gracefully.
 *
 * Setup: A plain fake Bedrock client (`{ send: jest.fn() }`) is injected via the
 * constructor test seam so NO real Bedrock/network call happens. The InvokeModelCommand
 * is still constructed by the AWS SDK (a devDependency of this layer), and its params are
 * inspected via `command.input` (mirrors embedding-provider.test.js).
 *
 * Teardown: `jest.restoreAllMocks()` / `jest.clearAllMocks()` in afterEach keeps tests
 * isolated.
 *
 * Validates: Requirements 5.1 (deterministic re-rank of top candidates), 5.2 (no
 * synthesized prose — only an ordering of existing indices), and the typed-error paths
 * (INVALID_INPUT / INVOCATION_FAILED / INVALID_ASSIST_RESPONSE) that enable the
 * `semantic-assisted` graceful degrade (Requirement 5.3) — delivered as a shared Layer
 * (Requirement 8.5).
 */

const { AssistProvider, AssistError } = require('../../nodejs/assist-provider');

/**
 * Build a fake Amazon Nova `InvokeModel` response.
 *
 * The real Bedrock response `body` is a Uint8Array of UTF-8 JSON bytes shaped like
 * `{ output: { message: { role, content: [{ text }] } }, usage: {...} }`. The assistant
 * text is the first content block exposing a string `text`.
 *
 * @param {string} text - The assistant text (typically a JSON array of indices).
 * @param {Object} [usage] - Optional token-usage object; omitted entirely when undefined.
 * @returns {{body: Uint8Array}} A fake response object accepted by AssistProvider.
 */
function novaResponse(text, usage) {
  const payload = { output: { message: { role: 'assistant', content: [{ text }] } } };
  if (usage !== undefined) {
    payload.usage = usage;
  }
  return { body: new TextEncoder().encode(JSON.stringify(payload)) };
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

/**
 * Decode the user-turn prompt text from the single InvokeModel command a `.send` mock
 * received (the query + numbered-candidate list that AssistProvider built).
 *
 * @param {jest.Mock} send - The `.send` mock the provider called.
 * @returns {string} The user message text.
 */
function sentUserText(send) {
  const command = send.mock.calls[0][0];
  return JSON.parse(command.input.body).messages[0].content[0].text;
}

describe('AssistProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('rerank() request shape (Req 5.1, 5.2)', () => {
    it('sends a Nova body (messages-v1, JSON-array system prompt, query + numbered candidates, temperature 0) with the configured model', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('[0,1]', { inputTokens: 1, outputTokens: 1, totalTokens: 2 }));
      const provider = new AssistProvider({ model: 'amazon.nova-micro-v1:0', client: { send } });

      await provider.rerank({
        query: 'rotate the secure data key',
        candidates: [
          { index: 0, title: 'Caching overview', excerpt: 'How the cache stores data' },
          { index: 1, title: 'Rotating the secure data key', excerpt: 'Steps to rotate' }
        ],
        topK: 10
      });

      expect(send).toHaveBeenCalledTimes(1);
      // AWS SDK v3 command classes store their params on `.input`.
      const command = send.mock.calls[0][0];
      expect(command.input.modelId).toBe('amazon.nova-micro-v1:0');
      expect(command.input.contentType).toBe('application/json');
      expect(command.input.accept).toBe('application/json');

      const body = JSON.parse(command.input.body);
      expect(body.schemaVersion).toBe('messages-v1');
      // System prompt constrains the model to emitting ONLY a JSON array (no prose).
      expect(Array.isArray(body.system)).toBe(true);
      expect(body.system[0].text).toMatch(/JSON array/i);
      // Deterministic ordering: temperature must be 0.
      expect(body.inferenceConfig.temperature).toBe(0);

      // User turn carries the query and a numbered candidate list.
      expect(body.messages[0].role).toBe('user');
      const userText = body.messages[0].content[0].text;
      expect(userText).toContain('rotate the secure data key');
      expect(userText).toContain('#0:');
      expect(userText).toContain('#1:');
    });
  });

  describe('rerank() deterministic order parsing (Req 5.1)', () => {
    it('parses a bare JSON array response into the exact order and passes usage through', async () => {
      const usage = { inputTokens: 42, outputTokens: 5, totalTokens: 47 };
      const send = jest.fn().mockResolvedValue(novaResponse('[2,0,1]', usage));
      const provider = new AssistProvider({ client: { send } });

      const { order, usage: returnedUsage } = await provider.rerank({
        query: 'q',
        candidates: [{ index: 0 }, { index: 1 }, { index: 2 }]
      });

      expect(order).toEqual([2, 0, 1]);
      // usage is passed through unchanged from the Bedrock response for cost logging.
      expect(returnedUsage).toEqual(usage);
    });

    it('returns usage: null when the response omits a usage object', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('[0,1]'));
      const provider = new AssistProvider({ client: { send } });

      const { order, usage } = await provider.rerank({ query: 'q', candidates: [{ index: 0 }, { index: 1 }] });

      expect(order).toEqual([0, 1]);
      expect(usage).toBeNull();
    });
  });

  describe('rerank() no-prose / robust parsing (Req 5.2)', () => {
    it('extracts the ordering array even when the model wraps it in prose', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('Sure! [1,0] is best.'));
      const provider = new AssistProvider({ client: { send } });

      const { order } = await provider.rerank({ query: 'q', candidates: [{ index: 0 }, { index: 1 }] });

      expect(order).toEqual([1, 0]);
    });

    it('drops out-of-range, duplicate, and non-integer entries', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('[1, 5, 1, 0, "x", 2.5]'));
      const provider = new AssistProvider({ client: { send } });

      const { order } = await provider.rerank({
        query: 'q',
        candidates: [{ index: 0 }, { index: 1 }, { index: 2 }]
      });

      // 5 is out of range, the second 1 is a duplicate, "x"/2.5 are non-integers.
      expect(order).toEqual([1, 0]);
    });

    it('throws INVALID_ASSIST_RESPONSE when the text contains no JSON array', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('no array anywhere here'));
      const provider = new AssistProvider({ client: { send } });

      const error = await captureError(provider.rerank({ query: 'q', candidates: [{ index: 0 }] }));

      expect(error).toBeInstanceOf(AssistError);
      expect(error.code).toBe('INVALID_ASSIST_RESPONSE');
    });

    it('throws INVALID_ASSIST_RESPONSE when the array yields no valid candidate index', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('[9, 8, 7]'));
      const provider = new AssistProvider({ client: { send } });

      const error = await captureError(provider.rerank({ query: 'q', candidates: [{ index: 0 }, { index: 1 }] }));

      expect(error).toBeInstanceOf(AssistError);
      expect(error.code).toBe('INVALID_ASSIST_RESPONSE');
    });

    it('throws INVALID_ASSIST_RESPONSE when the response body is not valid JSON', async () => {
      const send = jest.fn().mockResolvedValue({ body: new TextEncoder().encode('not-json{') });
      const provider = new AssistProvider({ client: { send } });

      const error = await captureError(provider.rerank({ query: 'q', candidates: [{ index: 0 }] }));

      expect(error).toBeInstanceOf(AssistError);
      expect(error.code).toBe('INVALID_ASSIST_RESPONSE');
    });

    it('throws INVALID_ASSIST_RESPONSE when the response has no text content block', async () => {
      const body = new TextEncoder().encode(JSON.stringify({ output: { message: { content: [] } } }));
      const send = jest.fn().mockResolvedValue({ body });
      const provider = new AssistProvider({ client: { send } });

      const error = await captureError(provider.rerank({ query: 'q', candidates: [{ index: 0 }] }));

      expect(error).toBeInstanceOf(AssistError);
      expect(error.code).toBe('INVALID_ASSIST_RESPONSE');
    });
  });

  describe('rerank() candidate capping + truncation (bounded cost)', () => {
    it('caps the candidates sent to the model at maxCandidates and drops the overflow', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('[0,1,2]'));
      const provider = new AssistProvider({ maxCandidates: 3, client: { send } });
      const candidates = [0, 1, 2, 3, 4].map((index) => ({ index, title: `Title ${index}` }));

      await provider.rerank({ query: 'q', candidates });

      const userText = sentUserText(send);
      expect(userText).toContain('#0:');
      expect(userText).toContain('#2:');
      // The 4th/5th candidates (over the cap of 3) are never sent.
      expect(userText).not.toContain('#3:');
      expect(userText).not.toContain('#4:');
      expect(userText).not.toContain('Title 3');
      expect(userText).not.toContain('Title 4');
    });

    it('truncates an oversized title to maxTitleChars (the overflow tail is not sent)', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('[0]'));
      const provider = new AssistProvider({ maxTitleChars: 8, client: { send } });
      const longTitle = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // 26 distinct chars

      await provider.rerank({ query: 'q', candidates: [{ index: 0, title: longTitle }] });

      const userText = sentUserText(send);
      expect(userText).toContain('ABCDEFGH'); // first 8 chars kept
      expect(userText).not.toContain('ABCDEFGHI'); // 9th char (and tail) dropped
    });

    it('truncates an oversized excerpt to maxExcerptChars (the overflow tail is not sent)', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('[0]'));
      const provider = new AssistProvider({ maxExcerptChars: 6, client: { send } });
      const longExcerpt = 'abcdefghijklmnopqrstuvwxyz';

      await provider.rerank({ query: 'q', candidates: [{ index: 0, title: 'zzz', excerpt: longExcerpt }] });

      const userText = sentUserText(send);
      expect(userText).toContain('abcdef'); // first 6 chars kept
      expect(userText).not.toContain('abcdefg'); // 7th char (and tail) dropped
    });

    it('truncates an oversized query to maxQueryChars (the overflow tail is not sent)', async () => {
      const send = jest.fn().mockResolvedValue(novaResponse('[0]'));
      const provider = new AssistProvider({ maxQueryChars: 5, client: { send } });

      await provider.rerank({ query: 'ABCDEFGHIJ', candidates: [{ index: 0, title: 'zzz' }] });

      const userText = sentUserText(send);
      expect(userText).toContain('Query: ABCDE'); // first 5 query chars kept
      expect(userText).not.toContain('ABCDEF'); // 6th char (and tail) dropped
    });
  });

  describe('rerank() error paths', () => {
    it('wraps a Bedrock send() failure as AssistError INVOCATION_FAILED preserving the cause', async () => {
      const original = new Error('throttled');
      const send = jest.fn().mockRejectedValue(original);
      const provider = new AssistProvider({ client: { send } });

      const error = await captureError(provider.rerank({ query: 'q', candidates: [{ index: 0 }] }));

      expect(error).toBeInstanceOf(AssistError);
      expect(error.code).toBe('INVOCATION_FAILED');
      expect(error.cause).toBe(original);
    });

    const invalidInputCases = [
      ['nothing is provided', undefined],
      ['query is missing', { candidates: [{ index: 0 }] }],
      ['query is whitespace only', { query: '   ', candidates: [{ index: 0 }] }],
      ['candidates are missing', { query: 'q' }],
      ['candidates is an empty array', { query: 'q', candidates: [] }],
      ['no candidate has an integer index', { query: 'q', candidates: [{ foo: 1 }, { index: 'x' }] }]
    ];

    it.each(invalidInputCases)('throws INVALID_INPUT when %s and never calls send', async (_label, params) => {
      const send = jest.fn();
      const provider = new AssistProvider({ client: { send } });

      const error = await captureError(provider.rerank(params));

      expect(error).toBeInstanceOf(AssistError);
      expect(error.code).toBe('INVALID_INPUT');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('lazy Bedrock client', () => {
    it('does not throw at construction without an injected client and uses the injected client when reranking', async () => {
      // Merely instantiating (no rerank call) must not construct a real client or throw.
      expect(() => new AssistProvider({ model: 'amazon.nova-micro-v1:0' })).not.toThrow();

      // With an injected client, rerank() uses it — no real Bedrock construction/call.
      const send = jest.fn().mockResolvedValue(novaResponse('[0]'));
      const provider = new AssistProvider({ client: { send } });

      await provider.rerank({ query: 'q', candidates: [{ index: 0 }] });

      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
