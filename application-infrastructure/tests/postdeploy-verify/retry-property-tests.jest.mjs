/**
 * Property test for the HTTP client's retry rule.
 *
 * Property 4: Bounded retries. For any first and second transport result
 * (a network error, a timeout, or HTTP 200 to 599), the client makes at most
 * two attempts. A second attempt happens only after a network error, a
 * timeout, or HTTP 502, 503, or 504, and never after HTTP 429 or another
 * status. Each retry is preceded by exactly one `sleep(1000)`.
 *
 * **Validates: Requirements 10.8, 13.3**
 *
 * The fake `fetch` is scripted with the two results and counts its calls; a
 * third call (which a correct client never makes) fails like a network error
 * so that an unbounded loop still ends. `sleep` resolves at once. Nothing
 * here touches the network, and fast-check runs its default 100 runs.
 */

import { describe, it, expect, jest } from '@jest/globals';
import fc from 'fast-check';
import { loadVerifier } from './helpers/load-verifier.mjs';

const { createHttpClient } = loadVerifier();

const TARGET_URL = 'https://stage.example.test/test/mcp/v1';
const RETRY_DELAY_MS = 1000;
const RETRYABLE_STATUSES = [502, 503, 504];
const NULL_BODY_STATUSES = [204, 205, 304];
const ERROR_CODES = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'UND_ERR_SOCKET'];

// ---------------------------------------------------------------------------
// The rule under test, written independently of the implementation
// ---------------------------------------------------------------------------

/** True when a transport result earns the one retry. */
const earnsRetry = (result) =>
  result.type === 'network'
  || result.type === 'timeout'
  || RETRYABLE_STATUSES.includes(result.status);

// ---------------------------------------------------------------------------
// Fake fetch
// ---------------------------------------------------------------------------

/** Turn a scripted result into what `fetch` does: reject, or resolve a Response. */
async function playResult(result) {
  if (result.type === 'timeout') {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  }
  if (result.type === 'network') {
    throw new TypeError('fetch failed', { cause: { code: result.code } });
  }
  const body = NULL_BODY_STATUSES.includes(result.status) ? null : '{"jsonrpc":"2.0"}';
  return new Response(body, { status: result.status });
}

/**
 * Build a `fetch` that serves the scripted results in order and counts calls.
 *
 * @param {Array.<Object>} script - Results for the first and second attempt
 * @returns {{fetchImpl: function(): Promise<Response>, calls: Array.<Object>}} Fake and its call log
 */
function createScriptedFetch(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const result = script[calls.length - 1];
    if (result === undefined) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    }
    return playResult(result);
  };
  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const networkResult = fc
  .constantFrom(...ERROR_CODES)
  .map((code) => ({ type: 'network', code }));

const timeoutResult = fc.constant({ type: 'timeout' });

/** Statuses the rule cares about come up often, then the whole 200 to 599 range. */
const statusResult = fc
  .oneof(
    fc.constantFrom(200, 301, 302, 400, 401, 404, 429, 500, 501, 502, 503, 504, 599),
    fc.integer({ min: 200, max: 599 })
  )
  .map((status) => ({ type: 'http', status }));

const transportResult = fc.oneof(networkResult, timeoutResult, statusResult);

const requestSpec = fc.constantFrom(
  {
    method: 'POST',
    url: TARGET_URL,
    headers: { 'MCP-Protocol-Version': '2026-07-28' },
    body: { jsonrpc: '2.0', method: 'tools/list' }
  },
  {
    method: 'OPTIONS',
    url: TARGET_URL,
    headers: { Origin: 'https://example.test', 'Access-Control-Request-Method': 'POST' }
  }
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 4: Bounded retries', () => {
  it('makes at most two attempts, and retries only after a network error, a timeout, or 502/503/504', async () => {
    await fc.assert(
      fc.asyncProperty(requestSpec, transportResult, transportResult, async (spec, first, second) => {
        const { fetchImpl, calls } = createScriptedFetch([first, second]);
        const sleep = jest.fn().mockResolvedValue(undefined);
        const http = createHttpClient({ fetchImpl, timeoutMs: 5000, sleep });

        const exchange = await http.send(spec);

        const expectedAttempts = earnsRetry(first) ? 2 : 1;

        // Never more than two attempts
        expect(calls.length).toBeLessThanOrEqual(2);
        // A second attempt if and only if the first result earns a retry
        expect(calls.length).toBe(expectedAttempts);
        expect(exchange.attempts).toBe(expectedAttempts);

        // One one-second pause per retry, and none otherwise
        expect(sleep).toHaveBeenCalledTimes(expectedAttempts - 1);
        for (const call of sleep.mock.calls) {
          expect(call).toEqual([RETRY_DELAY_MS]);
        }
        expect(http.stats.retries).toBe(expectedAttempts - 1);

        // The request is counted once, whatever the number of attempts
        expect(http.stats.posts).toBe(spec.method === 'POST' ? 1 : 0);
        expect(http.stats.preflights).toBe(spec.method === 'OPTIONS' ? 1 : 0);

        // The exchange reports the last attempt, and the retry reuses the same request
        const last = expectedAttempts === 2 ? second : first;
        if (last.type === 'http') {
          expect(exchange.kind).toBe('response');
          expect(exchange.status).toBe(last.status);
        } else {
          expect(exchange.kind).toBe('no-response');
          expect(exchange.error).toBe(last.type === 'timeout' ? 'timeout' : last.code);
        }
        if (expectedAttempts === 2) {
          expect(calls[1].url).toBe(calls[0].url);
          expect(calls[1].init.method).toBe(calls[0].init.method);
          expect(calls[1].init.body).toBe(calls[0].init.body);
        }
      })
    );
  });

  it('never retries after HTTP 429 or any other non-retryable status', async () => {
    const nonRetryable = fc
      .integer({ min: 200, max: 599 })
      .filter((status) => !RETRYABLE_STATUSES.includes(status));

    await fc.assert(
      fc.asyncProperty(requestSpec, nonRetryable, transportResult, async (spec, status, second) => {
        const { fetchImpl, calls } = createScriptedFetch([{ type: 'http', status }, second]);
        const sleep = jest.fn().mockResolvedValue(undefined);
        const http = createHttpClient({ fetchImpl, timeoutMs: 5000, sleep });

        const exchange = await http.send(spec);

        expect(calls).toHaveLength(1);
        expect(sleep).not.toHaveBeenCalled();
        expect(http.stats.retries).toBe(0);
        expect(exchange.attempts).toBe(1);
        expect(exchange.status).toBe(status);
      })
    );
  });

  it('does not retry after HTTP 429 (example)', async () => {
    const { fetchImpl, calls } = createScriptedFetch([{ type: 'http', status: 429 }, { type: 'http', status: 200 }]);
    const sleep = jest.fn().mockResolvedValue(undefined);
    const http = createHttpClient({ fetchImpl, timeoutMs: 5000, sleep });

    const exchange = await http.send({
      method: 'POST',
      url: TARGET_URL,
      headers: {},
      body: { jsonrpc: '2.0', method: 'tools/list' }
    });

    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(exchange.status).toBe(429);
  });
});
