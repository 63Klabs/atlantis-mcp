/**
 * Property test for secret redaction.
 *
 * Property 2: The key never reaches any output. For any key of the real form
 * (`atl_` plus 32 hex characters) or a random string of 20 to 64 characters
 * from `[A-Za-z0-9_-]`, and for each scenario
 *
 *   - a healthy stage (the key is accepted),
 *   - a rejected key (HTTP 401 on every keyed request),
 *   - HTTP 429 everywhere,
 *   - a server that echoes the request headers into its response bodies
 *     (the key is accepted, so it is sent and then echoed back),
 *
 * no standard output, standard error, report file, or report line contains the key.
 *
 * **Validates: Requirements 11.6, 14.7, 14.8, 16.5**
 *
 * Each run executes the whole Verifier against the in-process fake server: no real
 * network, and the injected `sleep` resolves at once. fast-check uses its default
 * 100 runs per scenario.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fc from 'fast-check';
import { createFakeMcpServer } from './helpers/fake-mcp-server.mjs';
import { runVerifier, guardRealFetch } from './helpers/run-verifier.mjs';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A key of the real form: `atl_` plus 32 hexadecimal characters. */
const realKeyArb = fc.stringMatching(/^[0-9a-f]{32}$/).map((hex) => `atl_${hex}`);

/** A random string of 20 to 64 characters from `[A-Za-z0-9_-]`. */
const randomKeyArb = fc.stringMatching(/^[A-Za-z0-9_-]{20,64}$/);

const keyArb = fc.oneof(realKeyArb, randomKeyArb);

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/**
 * Each scenario turns a key into fake-server options.
 *
 * @type {Object.<string, function(string): Object>}
 */
const SCENARIOS = {
  'a healthy stage': (key) => ({ validKeys: { [key]: 'private' } }),
  'a rejected key': () => ({ validKeys: {} }),
  'HTTP 429 everywhere': (key) => ({ validKeys: { [key]: 'private' }, rateLimited: true }),
  'a server that echoes request headers': (key) => ({
    validKeys: { [key]: 'private' },
    echoRequestHeaders: true
  })
};

/**
 * Run the Verifier once against a fresh fake server.
 *
 * @param {string} key - The API key handed to the Verifier
 * @param {Object} serverOptions - Options for the fake server
 * @returns {Promise.<Object>} The `runVerifier()` result plus the raw report text
 */
async function runOnce(key, serverOptions) {
  const server = createFakeMcpServer(serverOptions);
  return runVerifier({
    command: 'run',
    env: {
      MCP_URL: server.rawUrl,
      MCP_EDGE_URL: server.edgeUrl,
      EXPECTED_VERSION: '0.0.7',
      MCP_API_KEY: key,
      MCP_KEY_STATUS: 'ok'
    },
    server
  });
}

/**
 * Collect every place the key could appear.
 *
 * @param {Object} result - A `runVerifier()` result
 * @returns {Object.<string, string>} Output name to text
 */
function outputsOf(result) {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    report: JSON.stringify(result.report),
    reportLine: JSON.stringify(result.reportLine),
    reportLines: result.reportLines.join('\n')
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 2: the key never reaches any output', () => {
  let restoreFetch;

  beforeAll(() => {
    restoreFetch = guardRealFetch();
  });

  afterAll(() => {
    restoreFetch();
  });

  for (const [scenarioName, toServerOptions] of Object.entries(SCENARIOS)) {
    it(`never prints or writes the key for ${scenarioName}`, async () => {
      await fc.assert(
        fc.asyncProperty(keyArb, async (key) => {
          const result = await runOnce(key, toServerOptions(key));

          // The run must have produced output to search, or the property is vacuous.
          expect(result.stdout.length).toBeGreaterThan(0);
          expect(result.report).not.toBeNull();
          expect(result.reportLines.length).toBe(1);

          for (const [name, text] of Object.entries(outputsOf(result))) {
            // Report the output name only, never the key, if this fails.
            if (text.includes(key)) {
              throw new Error(`the key appeared in ${name} (scenario: ${scenarioName})`);
            }
          }
        }),
        { numRuns: 100 }
      );
    }, 120000);
  }

  it('sends the key in the echo scenario, so the echoed bodies really carry it', async () => {
    // Guards against a vacuous pass: the echo scenario must actually put the key in play.
    const key = `atl_${'0123456789abcdef'.repeat(2)}`;
    const result = await runOnce(key, SCENARIOS['a server that echoes request headers'](key));
    const keyedCalls = result.calls.filter((call) => JSON.stringify(call).includes(key));
    expect(keyedCalls.length).toBeGreaterThan(0);
    expect(result.stdout).not.toContain(key);
  });
});
