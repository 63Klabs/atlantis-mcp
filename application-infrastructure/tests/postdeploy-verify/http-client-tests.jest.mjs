/**
 * Unit tests for the Verifier's HTTP client (design section 5, Data Models / Exchange).
 *
 * Covers: headers sent as written, the User-Agent, no key and no Authorization on
 * preflights, the key only as X-API-Key and only when given, no X-Forwarded-For or
 * cookies, a fresh timeout signal on every attempt, each row of the retry table,
 * a redirect returned without a second request, and error classification.
 *
 * The client talks to an inline fake `fetch` that records every call. No real
 * network is used and `sleep` is a jest.fn that resolves immediately.
 *
 * Validates: Requirements 6.5, 13.2, 13.3, 13.5, 13.6, 13.8, 16.4
 */
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { loadVerifier } from './helpers/load-verifier.mjs';

// No real network: any accidental use of the global fetch fails loudly.
globalThis.fetch = () => {
  throw new Error('Real network access is not allowed in these tests');
};

const { createHttpClient, USER_AGENT, DEFAULT_TIMEOUT_MS } = loadVerifier();

const POST_URL = 'https://abc.execute-api.us-east-1.amazonaws.com/test/mcp/v1';
const API_KEY = 'atl_0123456789abcdef0123456789abcdef';

/**
 * Build a fake `fetch` that plays back one step per call and records every call.
 * A step is a Response (returned), an Error or other thrown value wrapped as
 * `{ throws }`, or a function `(url, init) => Promise<Response>`. The last step
 * repeats when the script runs out, so a test that expects no extra call can
 * assert on `calls.length`.
 *
 * @param {Array} steps - Script, one entry per call
 * @returns {{fetchImpl: function, calls: Array<{url: string, init: Object}>}} Fake and its call log
 */
function makeFakeFetch(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (typeof step === 'function') {
      return step(url, init);
    }
    if (step !== null && typeof step === 'object' && 'throws' in step) {
      throw step.throws;
    }
    // A Response body can be read once; hand out a copy so a repeated step works
    return step.clone();
  };
  return { fetchImpl, calls };
}

/**
 * Build a Response with a JSON body.
 *
 * @param {number} [status=200] - HTTP status
 * @param {Object} [body] - Value to serialize
 * @param {Object.<string, string>} [headers] - Response headers
 * @returns {Response} Response
 */
function jsonResponse(status = 200, body = { ok: true }, headers = {}) {
  // A 204 (like 205 and 304) cannot carry a body
  if (status === 204) {
    return new Response(null, { status, headers });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

/**
 * Create a client over a fake fetch with an immediate sleep and a fixed clock.
 *
 * @param {Array} steps - Script for the fake fetch
 * @param {Object} [options] - Extra createHttpClient options
 * @returns {{http: Object, calls: Array, sleep: function}} Client, call log, and sleep mock
 */
function makeClient(steps, options = {}) {
  const { fetchImpl, calls } = makeFakeFetch(steps);
  const sleep = jest.fn(() => Promise.resolve());
  const http = createHttpClient({ fetchImpl, sleep, timeoutMs: 5000, ...options });
  return { http, calls, sleep };
}

const postSpec = (overrides = {}) => ({
  url: POST_URL,
  method: 'POST',
  headers: {},
  body: { jsonrpc: '2.0', method: 'tools/list' },
  ...overrides
});

const preflightSpec = (overrides = {}) => ({
  url: POST_URL,
  method: 'OPTIONS',
  headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' },
  ...overrides
});

/** Lower-case header names of a recorded call. */
const headerNames = (call) => Object.keys(call.init.headers).map((name) => name.toLowerCase());

afterEach(() => {
  globalThis.fetch = () => {
    throw new Error('Real network access is not allowed in these tests');
  };
});

describe('HTTP client: request headers (Requirements 13.2, 13.3)', () => {
  it('sends header names with the case the spec wrote them', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({
      headers: { 'MCP-Protocol-Version': '2026-07-28', 'mcp-METHOD': 'tools/list', 'X-Custom-Header': 'Value' }
    }));

    const sent = calls[0].init.headers;
    expect(sent['MCP-Protocol-Version']).toBe('2026-07-28');
    expect(sent['mcp-METHOD']).toBe('tools/list');
    expect(sent['X-Custom-Header']).toBe('Value');
    expect(Object.keys(sent)).not.toContain('mcp-protocol-version');
    expect(Object.keys(sent)).not.toContain('Mcp-Method');
  });

  it('passes headers as a plain object, not a Headers instance, so case reaches the wire', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ headers: { 'MCP-Method': 'tools/list' } }));

    const sent = calls[0].init.headers;
    expect(Object.getPrototypeOf(sent)).toBe(Object.prototype);
    expect(sent instanceof Headers).toBe(false);
  });

  it('sends the User-Agent on a POST and on a preflight', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec());
    await http.send(preflightSpec());

    expect(USER_AGENT).toBe('atlantis-mcp-postdeploy-verify');
    expect(calls[0].init.headers['User-Agent']).toBe(USER_AGENT);
    expect(calls[1].init.headers['User-Agent']).toBe(USER_AGENT);
  });

  it('orders headers User-Agent, Content-Type, spec headers, then X-API-Key', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ headers: { 'MCP-Method': 'tools/list' }, apiKey: API_KEY }));

    expect(Object.keys(calls[0].init.headers)).toEqual([
      'User-Agent',
      'Content-Type',
      'MCP-Method',
      'X-API-Key'
    ]);
  });

  it('defaults Content-Type to application/json on a POST only', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec());
    await http.send(preflightSpec());

    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
    expect(headerNames(calls[1])).not.toContain('content-type');
  });

  it('lets a spec User-Agent replace the default instead of merging with it', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ headers: { 'user-agent': 'custom-agent/1.0' } }));

    const sent = calls[0].init.headers;
    expect(sent['user-agent']).toBe('custom-agent/1.0');
    expect(Object.keys(sent).filter((name) => name.toLowerCase() === 'user-agent')).toEqual(['user-agent']);
  });

  it('lets a spec Content-Type replace the default, whatever its casing', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ headers: { 'CONTENT-TYPE': 'text/plain' } }));

    const sent = calls[0].init.headers;
    expect(sent['CONTENT-TYPE']).toBe('text/plain');
    expect(Object.keys(sent).filter((name) => name.toLowerCase() === 'content-type')).toEqual(['CONTENT-TYPE']);
  });

  it('sends the preflight headers the spec gives, such as Origin', async () => {
    const { http, calls } = makeClient([jsonResponse(204, {})]);
    await http.send(preflightSpec());

    expect(calls[0].init.method).toBe('OPTIONS');
    expect(calls[0].init.headers.Origin).toBe('https://example.com');
    expect(calls[0].init.headers['Access-Control-Request-Method']).toBe('POST');
  });

  it('sends to the full spec.url', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ url: 'https://mcp.example.com/mcp/v1' }));

    expect(calls[0].url).toBe('https://mcp.example.com/mcp/v1');
  });
});

describe('HTTP client: credentials (Requirements 13.5, 13.8)', () => {
  it('sends the key as X-API-Key on a POST that is given one', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ apiKey: API_KEY }));

    expect(calls[0].init.headers['X-API-Key']).toBe(API_KEY);
  });

  it('puts the key nowhere else: not in Authorization, other headers, or the body', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ apiKey: API_KEY, headers: { 'MCP-Method': 'tools/list' } }));

    const { headers, body } = calls[0].init;
    expect(headerNames(calls[0])).not.toContain('authorization');
    const carriers = Object.entries(headers).filter(([, value]) => String(value).includes(API_KEY));
    expect(carriers).toEqual([['X-API-Key', API_KEY]]);
    expect(body).not.toContain(API_KEY);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', '']
  ])('sends no X-API-Key when the key is %s', async (label, apiKey) => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ apiKey }));

    expect(headerNames(calls[0])).not.toContain('x-api-key');
    expect(headerNames(calls[0])).not.toContain('authorization');
  });

  it('does not duplicate the key when the spec also lists an X-API-Key header', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ apiKey: API_KEY, headers: { 'x-api-key': 'stray-value' } }));

    const sent = calls[0].init.headers;
    expect(Object.keys(sent).filter((name) => name.toLowerCase() === 'x-api-key')).toEqual(['X-API-Key']);
    expect(sent['X-API-Key']).toBe(API_KEY);
  });

  it('sends neither a key nor Authorization on a preflight, even when given both', async () => {
    const { http, calls } = makeClient([jsonResponse(204, {})]);
    await http.send(preflightSpec({
      apiKey: API_KEY,
      headers: {
        Origin: 'https://example.com',
        Authorization: 'Bearer token',
        'X-API-Key': API_KEY,
        'x-api-key': API_KEY
      }
    }));

    const names = headerNames(calls[0]);
    expect(names).not.toContain('x-api-key');
    expect(names).not.toContain('authorization');
    expect(JSON.stringify(calls[0].init)).not.toContain(API_KEY);
  });

  it('never stores the key on the Exchange', async () => {
    const { http } = makeClient([jsonResponse()]);
    const exchange = await http.send(postSpec({ apiKey: API_KEY }));

    expect(JSON.stringify(exchange)).not.toContain(API_KEY);
  });
});

describe('HTTP client: headers that are never sent (Requirement 13.6)', () => {
  const FORBIDDEN = [
    'X-Forwarded-For',
    'x-forwarded-for',
    'X-FORWARDED-FOR',
    'Cookie',
    'cookie',
    'COOKIE'
  ];

  it.each(['POST', 'OPTIONS'])('drops X-Forwarded-For and cookies in any casing on %s', async (method) => {
    const { http, calls } = makeClient([jsonResponse()]);
    const headers = Object.fromEntries(FORBIDDEN.map((name) => [name, '203.0.113.9']));
    headers['MCP-Method'] = 'tools/list';
    await http.send({ url: POST_URL, method, headers, body: { jsonrpc: '2.0', method: 'x' } });

    const names = headerNames(calls[0]);
    expect(names).not.toContain('x-forwarded-for');
    expect(names).not.toContain('cookie');
    expect(calls[0].init.headers['MCP-Method']).toBe('tools/list');
  });

  it('adds none of them by itself', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ apiKey: API_KEY }));
    await http.send(preflightSpec());

    for (const call of calls) {
      expect(headerNames(call)).not.toContain('x-forwarded-for');
      expect(headerNames(call)).not.toContain('cookie');
    }
  });
});

describe('HTTP client: request body and ids', () => {
  it('adds a run-unique id to a POST body and returns it as jsonRpcId', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    const first = await http.send(postSpec());
    const second = await http.send(postSpec({ body: { jsonrpc: '2.0', method: 'server/discover' } }));

    expect(first.jsonRpcId).toBe('verify-1');
    expect(second.jsonRpcId).toBe('verify-2');
    expect(JSON.parse(calls[0].init.body)).toEqual({ jsonrpc: '2.0', method: 'tools/list', id: 'verify-1' });
    expect(JSON.parse(calls[1].init.body)).toEqual({ jsonrpc: '2.0', method: 'server/discover', id: 'verify-2' });
  });

  it('overwrites an id the spec body carries', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    const exchange = await http.send(postSpec({ body: { jsonrpc: '2.0', method: 'x', id: 'mine' } }));

    expect(JSON.parse(calls[0].init.body).id).toBe(exchange.jsonRpcId);
  });

  it('sends a preflight with no body and a null jsonRpcId, without using an id', async () => {
    const { http, calls } = makeClient([jsonResponse(204, {})]);
    const preflight = await http.send(preflightSpec());
    const post = await http.send(postSpec());

    expect(preflight.jsonRpcId).toBeNull();
    expect(calls[0].init.body).toBeUndefined();
    expect(post.jsonRpcId).toBe('verify-1');
  });

  it('serializes the body with JSON.stringify so quotes and newlines stay escaped', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    await http.send(postSpec({ body: { jsonrpc: '2.0', method: 'a"b\nc' } }));

    expect(JSON.parse(calls[0].init.body).method).toBe('a"b\nc');
  });
});

describe('HTTP client: signals and redirects (Requirements 13.2, 13.3)', () => {
  it('passes a timeout signal and redirect: manual on every attempt', async () => {
    const { http, calls } = makeClient([{ throws: new TypeError('fetch failed') }, jsonResponse()]);
    await http.send(postSpec());

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
      expect(call.init.redirect).toBe('manual');
    }
  });

  it('gives the retry its own signal rather than reusing the first attempt', async () => {
    const { http, calls } = makeClient([jsonResponse(503, {}), jsonResponse()]);
    await http.send(postSpec());

    expect(calls[0].init.signal).not.toBe(calls[1].init.signal);
  });

  it('passes a signal on a preflight too', async () => {
    const { http, calls } = makeClient([jsonResponse(204, {})]);
    await http.send(preflightSpec());

    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts an attempt after timeoutMs and classifies the TimeoutError as timeout', async () => {
    // A fake that, like fetch, rejects with the signal's reason once it aborts
    const hangUntilAborted = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
    const { http, calls } = makeClient([hangUntilAborted], { timeoutMs: 20 });

    const exchange = await http.send(postSpec());

    expect(exchange).toMatchObject({ kind: 'no-response', error: 'timeout', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('falls back to the default timeout for a missing or unusable timeoutMs', async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30000);
    const spy = jest.spyOn(AbortSignal, 'timeout');
    try {
      for (const timeoutMs of [undefined, 0, -5, NaN]) {
        const { http } = makeClient([jsonResponse()], { timeoutMs });
        await http.send(postSpec());
      }
      expect(spy.mock.calls.map(([value]) => value)).toEqual([30000, 30000, 30000, 30000]);
    } finally {
      spy.mockRestore();
    }
  });

  it('uses the given timeoutMs for each attempt', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout');
    try {
      const { http } = makeClient([jsonResponse(502, {}), jsonResponse()], { timeoutMs: 1234 });
      await http.send(postSpec());
      expect(spy.mock.calls.map(([value]) => value)).toEqual([1234, 1234]);
    } finally {
      spy.mockRestore();
    }
  });

  it('returns a redirect as the answer, with its Location, without a second request', async () => {
    const redirect = new Response('', { status: 302, headers: { Location: 'https://elsewhere.example.com/mcp/v1' } });
    const { http, calls, sleep } = makeClient([redirect]);
    const exchange = await http.send(postSpec());

    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(exchange).toMatchObject({ kind: 'response', status: 302, attempts: 1 });
    expect(exchange.headers.location).toBe('https://elsewhere.example.com/mcp/v1');
  });

  it.each([301, 302, 303, 307, 308])('does not follow or retry a %i', async (status) => {
    const { http, calls, sleep } = makeClient([new Response('', { status, headers: { Location: 'https://x.test/' } })]);
    const exchange = await http.send(postSpec());

    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(exchange.status).toBe(status);
    expect(http.stats.retries).toBe(0);
  });
});

describe('HTTP client: retry table (Requirements 6.5, 13.2, 13.3)', () => {
  describe('retried once, after a 1000 ms pause', () => {
    it.each([502, 503, 504])('retries HTTP %i and returns the second answer', async (status) => {
      const { http, calls, sleep } = makeClient([jsonResponse(status, { error: 'gateway' }), jsonResponse(200, { ok: true })]);
      const exchange = await http.send(postSpec());

      expect(calls).toHaveLength(2);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(1000);
      expect(exchange).toMatchObject({ kind: 'response', status: 200, attempts: 2, json: { ok: true } });
      expect(http.stats.retries).toBe(1);
    });

    it.each([502, 503, 504])('returns HTTP %i with attempts 2 when the retry fails the same way', async (status) => {
      const { http, calls, sleep } = makeClient([jsonResponse(status, {})]);
      const exchange = await http.send(postSpec());

      expect(calls).toHaveLength(2);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(exchange).toMatchObject({ kind: 'response', status, attempts: 2 });
    });

    it('retries a network error', async () => {
      const error = new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      const { http, calls, sleep } = makeClient([{ throws: error }, jsonResponse()]);
      const exchange = await http.send(postSpec());

      expect(calls).toHaveLength(2);
      expect(sleep).toHaveBeenCalledWith(1000);
      expect(exchange).toMatchObject({ kind: 'response', status: 200, attempts: 2 });
      expect(http.stats.retries).toBe(1);
    });

    it('retries a timeout', async () => {
      const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      const { http, calls, sleep } = makeClient([{ throws: timeout }, jsonResponse()]);
      const exchange = await http.send(postSpec());

      expect(calls).toHaveLength(2);
      expect(sleep).toHaveBeenCalledWith(1000);
      expect(exchange).toMatchObject({ kind: 'response', status: 200, attempts: 2 });
    });

    it('retries when reading the body fails', async () => {
      const brokenBody = () => {
        const response = new Response('x', { status: 200 });
        response.text = () => Promise.reject(new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }));
        return response;
      };
      const { http, calls } = makeClient([() => brokenBody(), jsonResponse()]);
      const exchange = await http.send(postSpec());

      expect(calls).toHaveLength(2);
      expect(exchange).toMatchObject({ kind: 'response', status: 200, attempts: 2 });
    });

    it('retries a preflight the same way', async () => {
      const { http, calls, sleep } = makeClient([jsonResponse(503, {}), jsonResponse(204, {})]);
      const exchange = await http.send(preflightSpec());

      expect(calls).toHaveLength(2);
      expect(sleep).toHaveBeenCalledWith(1000);
      expect(exchange).toMatchObject({ status: 204, attempts: 2, jsonRpcId: null });
      expect(http.stats).toEqual({ posts: 0, preflights: 1, retries: 1 });
    });
  });

  describe('never retried', () => {
    it.each([200, 201, 204, 301, 302, 400, 401, 403, 404, 429, 500, 501])('does not retry HTTP %i', async (status) => {
      const { http, calls, sleep } = makeClient([jsonResponse(status, {})]);
      const exchange = await http.send(postSpec());

      expect(calls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(exchange).toMatchObject({ kind: 'response', status, attempts: 1 });
      expect(http.stats.retries).toBe(0);
    });
  });

  describe('at most one retry', () => {
    it('makes no third attempt after two network errors', async () => {
      const error = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      const { http, calls, sleep } = makeClient([{ throws: error }]);
      const exchange = await http.send(postSpec());

      expect(calls).toHaveLength(2);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(exchange).toMatchObject({ kind: 'no-response', error: 'ECONNREFUSED', attempts: 2 });
    });

    it('makes no third attempt when a 502 is followed by a network error', async () => {
      const error = new TypeError('fetch failed');
      const { http, calls } = makeClient([jsonResponse(502, {}), { throws: error }]);
      const exchange = await http.send(postSpec());

      expect(calls).toHaveLength(2);
      expect(exchange).toMatchObject({ kind: 'no-response', error: 'network', attempts: 2 });
    });

    it('does not retry a 429 that follows a 503, and returns it as the answer', async () => {
      const { http, calls } = makeClient([jsonResponse(503, {}), jsonResponse(429, {}, { 'Retry-After': '60' })]);
      const exchange = await http.send(postSpec());

      expect(calls).toHaveLength(2);
      expect(exchange).toMatchObject({ status: 429, attempts: 2 });
      expect(exchange.headers['retry-after']).toBe('60');
    });
  });

  describe('a retry reuses the request', () => {
    it('reuses the jsonRpcId and the exact body, and counts one request', async () => {
      const { http, calls } = makeClient([jsonResponse(503, {}), jsonResponse()]);
      const exchange = await http.send(postSpec({ apiKey: API_KEY, headers: { 'MCP-Method': 'tools/list' } }));

      expect(exchange.jsonRpcId).toBe('verify-1');
      expect(calls[1].init.body).toBe(calls[0].init.body);
      expect(JSON.parse(calls[1].init.body).id).toBe('verify-1');
      expect(calls[1].init.headers).toEqual(calls[0].init.headers);
      expect(calls[1].url).toBe(calls[0].url);
      expect(http.stats).toEqual({ posts: 1, preflights: 0, retries: 1 });
    });

    it('moves on to the next id for the next request, not the retry', async () => {
      const { http } = makeClient([jsonResponse(503, {}), jsonResponse(), jsonResponse()]);
      const first = await http.send(postSpec());
      const second = await http.send(postSpec());

      expect(first.jsonRpcId).toBe('verify-1');
      expect(second.jsonRpcId).toBe('verify-2');
    });

    it('sends no cookie or forwarded header on the retry either', async () => {
      const { http, calls } = makeClient([jsonResponse(504, {}), jsonResponse()]);
      await http.send(postSpec({ headers: { Cookie: 'a=b', 'X-Forwarded-For': '1.2.3.4' } }));

      for (const call of calls) {
        expect(headerNames(call)).not.toContain('cookie');
        expect(headerNames(call)).not.toContain('x-forwarded-for');
      }
    });
  });

  describe('stats', () => {
    it('counts requests, not attempts, and every retry', async () => {
      const { http } = makeClient([
        jsonResponse(),
        jsonResponse(204, {}),
        jsonResponse(502, {}),
        jsonResponse(),
        jsonResponse(500, {})
      ]);
      await http.send(postSpec());
      await http.send(preflightSpec());
      await http.send(postSpec());
      await http.send(postSpec());

      expect(http.stats).toEqual({ posts: 3, preflights: 1, retries: 1 });
    });

    it('is live: the same object reflects later requests', async () => {
      const { http } = makeClient([jsonResponse()]);
      const { stats } = http;
      expect(stats).toEqual({ posts: 0, preflights: 0, retries: 0 });

      await http.send(postSpec());
      expect(stats.posts).toBe(1);
    });
  });
});

describe('HTTP client: error classification (Requirements 13.2, 13.3)', () => {
  /** Run one request whose every attempt rejects with `error` and return the Exchange. */
  async function failWith(error) {
    const { http } = makeClient([{ throws: error }]);
    return http.send(postSpec());
  }

  it('classifies a TimeoutError DOMException as timeout', async () => {
    const exchange = await failWith(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    expect(exchange).toEqual({
      kind: 'no-response',
      jsonRpcId: 'verify-1',
      error: 'timeout',
      attempts: 2,
      durationMs: expect.any(Number)
    });
  });

  it('classifies a TypeError with a cause code by that code', async () => {
    const exchange = await failWith(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));

    expect(exchange).toMatchObject({ kind: 'no-response', error: 'ECONNREFUSED' });
  });

  it.each(['ENOTFOUND', 'ECONNRESET', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'EAI_AGAIN'])(
    'keeps the plain error code %s',
    async (code) => {
      const exchange = await failWith(new TypeError('fetch failed', { cause: { code } }));

      expect(exchange.error).toBe(code);
    }
  );

  it('classifies a network failure with no cause as network', async () => {
    const exchange = await failWith(new TypeError('fetch failed'));

    expect(exchange).toMatchObject({ kind: 'no-response', error: 'network' });
  });

  it.each([
    ['a cause with no code', { cause: {} }],
    ['a non-string code', { cause: { code: 42 } }],
    ['a code with punctuation', { cause: { code: 'bad code!' } }],
    ['a code with a URL in it', { cause: { code: 'https://abc.example.com/x' } }],
    ['a code over 64 characters', { cause: { code: 'E'.repeat(65) } }],
    ['an empty code', { cause: { code: '' } }],
    ['a null cause', { cause: null }]
  ])('classifies %s as network', async (label, options) => {
    const error = new TypeError('fetch failed');
    Object.defineProperty(error, 'cause', { value: options.cause, configurable: true });
    const exchange = await failWith(error);

    expect(exchange.error).toBe('network');
  });

  it('accepts a code of exactly 64 characters', async () => {
    const code = 'E'.repeat(64);
    const exchange = await failWith(new TypeError('fetch failed', { cause: { code } }));

    expect(exchange.error).toBe(code);
  });

  it('does not treat an AbortError as a timeout', async () => {
    const exchange = await failWith(new DOMException('aborted', 'AbortError'));

    expect(exchange.error).toBe('network');
  });

  it.each([
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 7]
  ])('classifies a rejection with %s as network', async (label, value) => {
    const exchange = await failWith(value);

    expect(exchange.error).toBe('network');
  });

  it('keeps the error message, which can quote the URL, out of the Exchange', async () => {
    const exchange = await failWith(new TypeError(`request to ${POST_URL} failed`, { cause: { code: 'ECONNREFUSED' } }));

    expect(JSON.stringify(exchange)).not.toContain(POST_URL);
    expect(exchange.error).toBe('ECONNREFUSED');
  });

  it('classifies the final attempt, not the first', async () => {
    const { http } = makeClient([
      { throws: new DOMException('timeout', 'TimeoutError') },
      { throws: new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }) }
    ]);
    const exchange = await http.send(postSpec());

    expect(exchange).toMatchObject({ kind: 'no-response', error: 'ENOTFOUND', attempts: 2 });
  });

  it('carries no response fields on a no-response Exchange', async () => {
    const exchange = await failWith(new TypeError('fetch failed'));

    expect(exchange).not.toHaveProperty('status');
    expect(exchange).not.toHaveProperty('headers');
    expect(exchange).not.toHaveProperty('bodyText');
    expect(exchange).not.toHaveProperty('json');
  });

  it('returns a no-response Exchange for a preflight with a null jsonRpcId', async () => {
    const { http } = makeClient([{ throws: new TypeError('fetch failed') }]);
    const exchange = await http.send(preflightSpec());

    expect(exchange).toMatchObject({ kind: 'no-response', jsonRpcId: null, error: 'network', attempts: 2 });
  });
});

describe('HTTP client: Exchange shape', () => {
  it('returns status, lower-case headers, body text, and parsed JSON for a JSON answer', async () => {
    const body = { jsonrpc: '2.0', id: 'verify-1', result: { tools: [] } };
    const { http } = makeClient([jsonResponse(200, body, { 'X-RateLimit-Remaining': '9', 'MCP-Protocol-Version': '2026-07-28' })]);
    const exchange = await http.send(postSpec());

    expect(exchange.kind).toBe('response');
    expect(exchange.status).toBe(200);
    expect(exchange.headers['x-ratelimit-remaining']).toBe('9');
    expect(exchange.headers['mcp-protocol-version']).toBe('2026-07-28');
    expect(exchange.headers['content-type']).toBe('application/json');
    expect(exchange.bodyText).toBe(JSON.stringify(body));
    expect(exchange.json).toEqual(body);
    expect(exchange.attempts).toBe(1);
  });

  it('leaves json off when the body is not JSON, and keeps the text', async () => {
    const { http } = makeClient([new Response('<html>Bad gateway</html>', { status: 400 })]);
    const exchange = await http.send(postSpec());

    expect(exchange).not.toHaveProperty('json');
    expect(exchange.bodyText).toBe('<html>Bad gateway</html>');
  });

  it('leaves json off for an empty body, such as a preflight 204', async () => {
    const { http } = makeClient([new Response(null, { status: 204 })]);
    const exchange = await http.send(preflightSpec());

    expect(exchange).not.toHaveProperty('json');
    expect(exchange.bodyText).toBe('');
  });

  it('keeps a JSON null body as json: null', async () => {
    const { http } = makeClient([new Response('null', { status: 200 })]);
    const exchange = await http.send(postSpec());

    expect(exchange).toHaveProperty('json', null);
  });

  it('measures durationMs with the injected clock, retry pause included', async () => {
    const ticks = [1000, 1750];
    const now = jest.fn(() => ticks.shift());
    const { http } = makeClient([jsonResponse(503, {}), jsonResponse()], { now });
    const exchange = await http.send(postSpec());

    expect(exchange.durationMs).toBe(750);
    expect(exchange.attempts).toBe(2);
  });

  it('measures durationMs on a no-response Exchange too', async () => {
    const ticks = [10, 40];
    const now = jest.fn(() => ticks.shift());
    const { http } = makeClient([{ throws: new TypeError('fetch failed') }], { now });
    const exchange = await http.send(postSpec());

    expect(exchange.durationMs).toBe(30);
  });
});

describe('HTTP client: dependencies and bad specs', () => {
  it('looks up the global fetch at call time when no fetchImpl is given', async () => {
    const http = createHttpClient({ sleep: () => Promise.resolve(), timeoutMs: 5000 });
    const fakeGlobalFetch = jest.fn(async () => jsonResponse());
    globalThis.fetch = fakeGlobalFetch;

    const exchange = await http.send(postSpec());

    expect(fakeGlobalFetch).toHaveBeenCalledTimes(1);
    expect(exchange.status).toBe(200);
  });

  it('rejects a spec with no URL as a programming error, without calling fetch', async () => {
    const { http, calls } = makeClient([jsonResponse()]);

    await expect(http.send({ method: 'POST', headers: {}, body: {} })).rejects.toThrow(TypeError);
    await expect(http.send({ url: '', method: 'POST' })).rejects.toThrow(TypeError);
    await expect(http.send(null)).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
    expect(http.stats).toEqual({ posts: 0, preflights: 0, retries: 0 });
  });

  it.each(['GET', 'PUT', 'DELETE', 'post', undefined])(
    'rejects method %s as a programming error, without calling fetch',
    async (method) => {
      const { http, calls } = makeClient([jsonResponse()]);

      await expect(http.send({ url: POST_URL, method, headers: {} })).rejects.toThrow(TypeError);
      expect(calls).toHaveLength(0);
    }
  );

  it('sends a POST with no headers or body in the spec', async () => {
    const { http, calls } = makeClient([jsonResponse()]);
    const exchange = await http.send({ url: POST_URL, method: 'POST' });

    expect(exchange.kind).toBe('response');
    expect(JSON.parse(calls[0].init.body)).toEqual({ id: 'verify-1' });
    expect(Object.keys(calls[0].init.headers)).toEqual(['User-Agent', 'Content-Type']);
  });
});
