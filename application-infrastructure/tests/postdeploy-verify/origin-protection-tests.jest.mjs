/**
 * Origin protection tests for the post-deploy verifier (Part B of the client-address
 * spec, Requirements 7 and 8; design B3).
 *
 * Every run executes the Verifier's `run` command in process against the fake MCP server
 * (`helpers/fake-mcp-server.mjs`) through `runVerifier()`. No socket is opened and no real
 * network request is made.
 *
 * Coverage:
 * - the catalog: `O1.1` is one core sub-check between `M1.1` and `T1.1`, 48 in all (38 core, 10 advisory)
 * - `X-Atlantis-Origin-Secret` goes on every request to the raw target except `O1.1`'s, and never to the edge
 * - `O1.1` passes against the modelled guard, and fails for each fault of Requirement 8.2 (and two more)
 *   with the documented reason, with only `O1.1` failing
 * - `O1.1` is skipped, without making the run inconclusive, when protection is off
 * - the configuration error when the stack parameter cannot be read, and the failure when protection is on
 *   and the secret is missing (the run never falls back to sending no header)
 * - the guard rejecting the Verifier's own header fails the other checks and not `O1.1`
 * - the secret never appears in standard output, standard error, or the report
 * - the inputs, `NEVER_SENT_HEADERS`, and the dependency-free CommonJS shape (Requirement 7.8)
 *
 * **Validates: Requirements 7.1 to 7.9, 8.1 to 8.5**
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fc from 'fast-check';
import { loadVerifier } from './helpers/load-verifier.mjs';
import { runVerifier, guardRealFetch } from './helpers/run-verifier.mjs';
import {
  createFakeMcpServer,
  FAKE_API_KEY,
  FAKE_ORIGIN_SECRET,
  ORIGIN_SECRET_HEADER,
  ORIGIN_GUARD_MESSAGE
} from './helpers/fake-mcp-server.mjs';

const {
  SUB_CHECKS,
  CHECK_ORDER,
  CHECK_FUNCTIONS,
  readInputs,
  validateConfig,
  createHttpClient,
  buildRequest,
  computeOutcome
} = loadVerifier();

const VERIFIER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../postdeploy-scripts/verify-deployment.js'
);

/** Release version every run expects. */
const EXPECTED_VERSION = '0.0.7';

/** Reason `O1.1` carries when protection is off (the exact words are part of the contract of Requirement 7.3). */
const PROTECTION_OFF_REASON = 'origin protection is off for this stage (ApiIsBehindCloudFront is false)';

let restoreFetch;

beforeAll(() => {
  restoreFetch = guardRealFetch();
});

afterAll(() => {
  restoreFetch();
});

/**
 * Run the Verifier against a fresh fake server.
 *
 * @param {Object} [settings] - Run settings
 * @param {boolean} [settings.isProtected=true] - The server guards the raw target and the run is told so
 * @param {boolean} [settings.hasEdge=true] - Pass an edge target
 * @param {boolean} [settings.hasKey=true] - Store a key the server accepts (so S2 runs and every sub-check can pass)
 * @param {string} [settings.secret=FAKE_ORIGIN_SECRET] - The secret handed to the Verifier
 * @param {string} [settings.serverSecret=settings.secret] - The secret the server expects
 * @param {Object} [settings.server] - More fake-server options
 * @param {Object} [settings.env] - More environment variables (a value of `undefined` removes one)
 * @returns {Promise.<{result: Object, server: Object}>} The run result and the server
 */
async function runProtected({
  isProtected = true,
  hasEdge = true,
  hasKey = true,
  secret = FAKE_ORIGIN_SECRET,
  serverSecret = secret,
  server: serverOptions = {},
  env: extraEnv = {}
} = {}) {
  const server = createFakeMcpServer({
    ...(isProtected ? { originSecret: serverSecret } : {}),
    ...(hasKey ? { validKeys: { [FAKE_API_KEY]: 'registered' } } : {}),
    ...serverOptions
  });
  const env = { MCP_URL: server.rawUrl, EXPECTED_VERSION, ...(hasKey ? { MCP_API_KEY: FAKE_API_KEY, MCP_KEY_STATUS: 'ok' } : {}), ...extraEnv };
  if (hasEdge) {
    env.MCP_EDGE_URL = server.edgeUrl;
  }
  if (isProtected) {
    env.MCP_ORIGIN_PROTECTION = 'true';
    env.MCP_ORIGIN_SECRET = secret;
  }
  const result = await runVerifier({ command: 'run', env, server });
  return { result, server };
}

/**
 * Find a sub-check entry in a report.
 *
 * @param {Object} report - Parsed report
 * @param {string} id - Sub-check ID
 * @returns {Object|undefined} The entry
 */
function checkOf(report, id) {
  return report.checks.find((entry) => entry.id === id);
}

/**
 * IDs of the sub-checks that did not pass.
 *
 * @param {Object} report - Parsed report
 * @returns {Array.<string>} IDs, in report order
 */
function notPassed(report) {
  return report.checks.filter((entry) => entry.outcome !== 'pass').map((entry) => entry.id);
}

/**
 * The request `O1.1` sends: a POST to the raw target that carries no origin secret header and is refused.
 *
 * @param {Array.<Object>} calls - Recorded calls
 * @returns {Array.<Object>} Calls that are raw POSTs without the header
 */
function unprotectedRawPosts(calls) {
  return calls.filter((call) => call.target === 'raw' && call.method === 'POST'
    && call.headersLower[ORIGIN_SECRET_HEADER] === undefined);
}

describe('Catalog (Requirement 7.1)', () => {
  it('adds O1.1 as one core sub-check between M1.1 and T1.1', () => {
    const ids = SUB_CHECKS.map((definition) => definition.id);
    const o1 = SUB_CHECKS.find((definition) => definition.id === 'O1.1');

    expect(o1).toMatchObject({ id: 'O1.1', check: 'O1', severity: 'core' });
    expect(o1.title).toMatch(/origin secret/i);
    expect(o1.title).toContain('401');
    expect(o1.title).toMatch(/JSON/);
    expect(ids.indexOf('O1.1')).toBe(ids.indexOf('M1.1') + 1);
    expect(ids.indexOf('T1.1')).toBe(ids.indexOf('O1.1') + 1);
    expect(SUB_CHECKS.filter((definition) => definition.check === 'O1')).toHaveLength(1);
  });

  it('holds 48 sub-checks: 38 core and 10 advisory', () => {
    expect(SUB_CHECKS).toHaveLength(48);
    expect(SUB_CHECKS.filter((definition) => definition.severity === 'core')).toHaveLength(38);
    expect(SUB_CHECKS.filter((definition) => definition.severity === 'advisory')).toHaveLength(10);
  });

  it('runs the O1 family after M1 and before T1, with a registered function', () => {
    expect(CHECK_ORDER.indexOf('O1')).toBe(CHECK_ORDER.indexOf('M1') + 1);
    expect(CHECK_ORDER.indexOf('T1')).toBe(CHECK_ORDER.indexOf('O1') + 1);
    expect(typeof CHECK_FUNCTIONS.O1).toBe('function');
  });

  it('builds the O1 request as a keyless tools/list POST to the raw target that opts out of the header', () => {
    const spec = buildRequest('O1');

    expect(spec).toMatchObject({ key: 'O1', target: 'raw', method: 'POST', apiKey: null });
    expect(spec.body).toEqual({ jsonrpc: '2.0', method: 'tools/list' });
    expect(spec.omitOriginSecret).toBe(true);
    expect(Object.keys(spec.headers).map((name) => name.toLowerCase())).not.toContain(ORIGIN_SECRET_HEADER);
  });
});

describe('The header on requests (Requirement 7.2)', () => {
  it('goes on every request to the raw target except the one O1.1 sends, and never to the edge', async () => {
    const { result, server } = await runProtected();

    expect(result.exitCode).toBe(0);
    const rawCalls = server.calls.filter((call) => call.target === 'raw');
    const edgeCalls = server.calls.filter((call) => call.target === 'edge');
    expect(edgeCalls.length).toBeGreaterThan(0);
    for (const call of edgeCalls) {
      expect(call.headersLower[ORIGIN_SECRET_HEADER]).toBeUndefined();
    }
    const withoutHeader = rawCalls.filter((call) => call.headersLower[ORIGIN_SECRET_HEADER] === undefined);
    expect(withoutHeader).toHaveLength(1);
    expect(withoutHeader[0]).toMatchObject({ method: 'POST', rpcMethod: 'tools/list', status: 401 });
    for (const call of rawCalls.filter((entry) => entry !== withoutHeader[0])) {
      expect(call.headersLower[ORIGIN_SECRET_HEADER]).toBe(FAKE_ORIGIN_SECRET);
    }
    // Preflights and the GET carry it too: "every request to the raw target"
    expect(rawCalls.filter((call) => call.method === 'OPTIONS' || call.method === 'GET')
      .every((call) => call.headersLower[ORIGIN_SECRET_HEADER] === FAKE_ORIGIN_SECRET)).toBe(true);
  });

  it('is not sent at all when protection is off, even if a secret value is present', async () => {
    const { result, server } = await runProtected({
      isProtected: false,
      env: { MCP_ORIGIN_PROTECTION: 'false', MCP_ORIGIN_SECRET: FAKE_ORIGIN_SECRET }
    });

    expect(result.exitCode).toBe(0);
    expect(server.calls.some((call) => call.headersLower[ORIGIN_SECRET_HEADER] !== undefined)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(FAKE_ORIGIN_SECRET);
  });
});

describe('O1.1 against the modelled guard (Requirements 7.5, 8.1, 8.4)', () => {
  it('passes, and the whole stage passes 48 of 48', async () => {
    const { result, server } = await runProtected();

    expect(result.exitCode).toBe(0);
    expect(result.report.outcome).toBe('passed');
    expect(result.report.checks).toHaveLength(48);
    expect(checkOf(result.report, 'O1.1')).toMatchObject({ outcome: 'pass', severity: 'core' });
    expect(result.report.counts).toEqual({
      core: { passed: 38, failed: 0, skipped: 0 },
      advisory: { passed: 10, warned: 0, skipped: 0 }
    });
    expect(result.stdout).toMatch(/PASS\s+O1\.1\s/);
    const unprotected = unprotectedRawPosts(server.calls);
    expect(unprotected).toHaveLength(1);
    expect(unprotected[0].headersLower['x-api-key']).toBeUndefined();
    expect(unprotected[0].headersLower.authorization).toBeUndefined();
  });

  it('serves the edge target as it always did', async () => {
    const { result, server } = await runProtected();

    expect(result.exitCode).toBe(0);
    expect(server.calls.filter((call) => call.target === 'edge' && call.method === 'POST')
      .every((call) => call.status === 200 || call.status === 400)).toBe(true);
  });

  const FAULTS = [
    ['open', 'the request was served without proof of origin'],
    ['non-json', 'content-type is'],
    ['forbidden', 'HTTP 403, expected 401'],
    ['no-message', 'body is not a JSON object with a string "message"'],
    ['landing-page', 'HTTP 200, expected 401']
  ];

  it.each(FAULTS)('fails only O1.1 when the unprotected request gets the %s answer', async (fault, expectedText) => {
    const { result } = await runProtected({ server: { originGuardFault: fault } });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('failed');
    expect(result.report.failedCore).toEqual(['O1.1']);
    expect(notPassed(result.report)).toEqual(['O1.1']);
    const entry = checkOf(result.report, 'O1.1');
    expect(entry.reason).toContain(expectedText);
    expect(result.stdout).toMatch(new RegExp(`FAIL\\s+O1\\.1\\s.*${expectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('says the request was served without proof of origin when the answer is a normal result', async () => {
    const { result } = await runProtected({ server: { originGuardFault: 'open' } });

    expect(checkOf(result.report, 'O1.1').reason).toMatch(/^HTTP 200, expected 401; the request was served without proof of origin; body: /);
  });

  it('does not assert the wording of the message', async () => {
    const server = createFakeMcpServer({ originSecret: FAKE_ORIGIN_SECRET, mutate: undefined });
    const originalFetch = server.fetch;
    const reworded = {
      ...server,
      fetch: async (input, init) => {
        const response = await originalFetch(input, init);
        if (response.status === 401) {
          return new Response(JSON.stringify({ message: 'Go away' }), { status: 401, headers: response.headers });
        }
        return response;
      }
    };
    const result = await runVerifier({
      command: 'run',
      env: {
        MCP_URL: server.rawUrl,
        EXPECTED_VERSION,
        MCP_ORIGIN_PROTECTION: 'true',
        MCP_ORIGIN_SECRET: FAKE_ORIGIN_SECRET
      },
      server: reworded
    });

    expect(ORIGIN_GUARD_MESSAGE).not.toBe('Go away');
    expect(checkOf(result.report, 'O1.1').outcome).toBe('pass');
  });

  it('is not counted: the request is refused before the rate limiter (Requirement 7.7)', async () => {
    const { server } = await runProtected({
      hasEdge: false,
      hasKey: false,
      server: { rateLimits: { public: { limitPerWindow: 21, windowInMinutes: 60 } } }
    });
    // Counted: every POST the guard and the key check did not refuse (S1 and O1.1 both answer 401)
    const counted = server.calls.filter((call) => call.method === 'POST' && call.status !== 401);

    // 21 counted POSTs exactly fit a public limit of 21; the O1.1 request did not use one
    expect(counted).toHaveLength(21);
    expect(server.calls.some((call) => call.status === 429)).toBe(false);
  });
});

describe('O1.1 when protection is off (Requirement 7.3)', () => {
  it.each([
    ['the flag is false', { MCP_ORIGIN_PROTECTION: 'false' }],
    ['nothing is set', {}]
  ])('is skipped with a reason that says so, and sends nothing, when %s', async (label, env) => {
    const { result, server } = await runProtected({ isProtected: false, hasEdge: false, hasKey: false, env });

    expect(result.exitCode).toBe(0);
    expect(result.report.outcome).toBe('passed');
    expect(checkOf(result.report, 'O1.1')).toMatchObject({ outcome: 'skip', reason: PROTECTION_OFF_REASON });
    expect(result.stdout).toMatch(/SKIP\s+O1\.1\s/);
    expect(result.stdout).toContain(PROTECTION_OFF_REASON);
    expect(result.report.counts.core).toEqual({ passed: 37, failed: 0, skipped: 1 });
    // 21 counted POSTs and S1: O1.1 added none
    expect(server.calls.filter((call) => call.method === 'POST')).toHaveLength(22);
  });

  it('does not make the run inconclusive: a core skip for this reason is not a missing answer', () => {
    const decision = computeOutcome({
      results: [
        { id: 'P1.1', severity: 'core', outcome: 'pass' },
        { id: 'O1.1', severity: 'core', outcome: 'skip', reason: PROTECTION_OFF_REASON }
      ]
    });

    expect(decision.outcome).toBe('passed');
    expect(decision.exitCode).toBe(0);
    expect(decision.skippedCore).toEqual([]);
  });

  it('still makes the run inconclusive for any other core skip', () => {
    const decision = computeOutcome({
      results: [
        { id: 'O1.1', severity: 'core', outcome: 'skip', reason: PROTECTION_OFF_REASON },
        { id: 'P1.1', severity: 'core', outcome: 'skip', reason: 'no answer: rate limited (HTTP 429)' }
      ]
    });

    expect(decision.outcome).toBe('inconclusive');
    expect(decision.skippedCore).toEqual(['P1.1']);
  });
});

describe('Configuration failures (Requirements 7.3, 7.4)', () => {
  it('reports the wrapper-supplied configuration error and sends no request', async () => {
    const configError = 'could not read the ApiIsBehindCloudFront parameter of stack acme-atlantis-mcp-test-application';
    const { result, server } = await runProtected({ isProtected: false, env: { VERIFY_CONFIG_ERROR: configError } });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('error');
    expect(result.report.error.message).toContain(configError);
    expect(`${result.stdout}${result.stderr}`).toContain(`ERROR: ${configError}`);
    expect(server.calls).toHaveLength(0);
  });

  it('fails, with a reason naming the variable, when protection is on and the secret is missing', async () => {
    const { result, server } = await runProtected({
      isProtected: false,
      env: { MCP_ORIGIN_PROTECTION: 'true' }
    });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('error');
    expect(result.report.error.message).toMatch(/MCP_ORIGIN_SECRET/);
    expect(result.report.error.message).toMatch(/no header|not fall back/);
    // The run never falls back to sending no header, which would test nothing
    expect(server.calls).toHaveLength(0);
  });

  it('fails when the flag is neither true nor false', async () => {
    const { result, server } = await runProtected({ isProtected: false, env: { MCP_ORIGIN_PROTECTION: 'maybe' } });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('error');
    expect(result.report.error.message).toContain('MCP_ORIGIN_PROTECTION must be true or false');
    expect(server.calls).toHaveLength(0);
  });
});

describe('A guard that rejects the Verifier\'s own header (Requirement 8.4)', () => {
  it('fails the other raw checks and not O1.1', async () => {
    const { result } = await runProtected({ serverSecret: 'a-different-secret-the-verifier-does-not-hold' });

    expect(result.exitCode).toBe(1);
    expect(result.report.outcome).toBe('failed');
    expect(checkOf(result.report, 'O1.1').outcome).toBe('pass');
    expect(result.report.failedCore).toContain('P1.1');
    expect(result.report.failedCore).not.toContain('O1.1');
    expect(checkOf(result.report, 'P1.1').reason).toMatch(/^HTTP 401, expected 200/);
    expect(JSON.stringify(result.report)).not.toContain('a-different-secret-the-verifier-does-not-hold');
  });
});

describe('Redaction of the secret (Requirement 7.6)', () => {
  /**
   * Every place the secret could appear.
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

  it('does not appear in any output, including failure messages that quote an echoing server', async () => {
    // The server answers every JSON-RPC request with HTTP 418 and a body that starts with the request headers,
    // so P1's failure reason quotes a body that holds the secret
    const { result } = await runProtected({
      server: {
        mutate: (context, body) => ({ echo: { headers: { ...context.headers } }, jsonrpc: '2.0', id: body.id }),
        rpcStatus: () => 418
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(checkOf(result.report, 'P1.1').reason).toContain('[REDACTED]');
    // The echo was real: the server did receive the secret
    expect(result.calls.some((call) => call.headersLower[ORIGIN_SECRET_HEADER] === FAKE_ORIGIN_SECRET)).toBe(true);
    for (const [name, text] of Object.entries(outputsOf(result))) {
      if (text.includes(FAKE_ORIGIN_SECRET)) {
        throw new Error(`the origin secret appeared in ${name}`);
      }
    }
  });

  it('does not appear in a healthy run either', async () => {
    const { result } = await runProtected({ server: { echoRequestHeaders: true } });

    expect(result.exitCode).toBe(0);
    for (const [name, text] of Object.entries(outputsOf(result))) {
      if (text.includes(FAKE_ORIGIN_SECRET)) {
        throw new Error(`the origin secret appeared in ${name}`);
      }
    }
  });

  it('Property: no output holds the secret, for any secret and any scenario', async () => {
    const secretArb = fc.stringMatching(/^[A-Za-z0-9]{24,64}$/);
    const scenarios = [
      { server: { echoRequestHeaders: true } },
      { server: { echoRequestHeaders: true, rpcStatus: () => 418 } },
      { server: { echoRequestHeaders: true, originGuardFault: 'open' } },
      { server: { originGuardFault: 'forbidden' } }
    ];
    await fc.assert(
      fc.asyncProperty(secretArb, fc.constantFrom(...scenarios), async (secret, scenario) => {
        const { result } = await runProtected({ secret, ...scenario });
        expect(result.stdout.length).toBeGreaterThan(0);
        expect(result.reportLines).toHaveLength(1);
        for (const [name, text] of Object.entries(outputsOf(result))) {
          if (text.includes(secret)) {
            throw new Error(`the origin secret appeared in ${name}`);
          }
        }
      }),
      { numRuns: 20 }
    );
  }, 120000);
});

describe('Inputs (Requirements 7.3, 7.4)', () => {
  it('reads the flag and the secret, trimmed, and leaves them empty when unset', () => {
    expect(readInputs({ MCP_ORIGIN_PROTECTION: ' true ', MCP_ORIGIN_SECRET: ' abc ' })).toMatchObject({
      originProtection: 'true',
      originSecret: 'abc'
    });
    expect(readInputs({})).toMatchObject({ originProtection: '', originSecret: '' });
  });

  const base = { MCP_URL: 'https://abc.execute-api.us-east-1.amazonaws.com/test/mcp/v1', EXPECTED_VERSION: EXPECTED_VERSION };

  it.each([
    ['unset', {}],
    ['false', { MCP_ORIGIN_PROTECTION: 'false' }],
    ['true with a secret', { MCP_ORIGIN_PROTECTION: 'true', MCP_ORIGIN_SECRET: 'abcdefghijkl' }],
    ['TRUE with a secret', { MCP_ORIGIN_PROTECTION: 'TRUE', MCP_ORIGIN_SECRET: 'abcdefghijkl' }]
  ])('accepts %s', (label, env) => {
    expect(validateConfig(readInputs({ ...base, ...env }), { cwd: '/work' })).toEqual([]);
  });

  it('reports a flag that is true with no secret, without echoing anything secret', () => {
    const problems = validateConfig(readInputs({ ...base, MCP_ORIGIN_PROTECTION: 'true' }), { cwd: '/work' });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('MCP_ORIGIN_SECRET');
  });

  it('reports a flag that is neither true nor false, quoting only the flag', () => {
    const problems = validateConfig(readInputs({ ...base, MCP_ORIGIN_PROTECTION: 'yes' }), { cwd: '/work' });

    expect(problems).toEqual([expect.stringContaining('MCP_ORIGIN_PROTECTION must be true or false')]);
  });
});

describe('Header rules of the HTTP client and the module shape (Requirement 7.8)', () => {
  it('keeps NEVER_SENT_HEADERS as x-forwarded-for and cookie, and still drops both', async () => {
    const source = fs.readFileSync(VERIFIER_PATH, 'utf8');
    expect(source).toMatch(/const NEVER_SENT_HEADERS = Object\.freeze\(\['x-forwarded-for', 'cookie'\]\);/);

    const seen = [];
    const http = createHttpClient({
      fetchImpl: async (url, init) => {
        seen.push(init.headers);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
      sleep: () => Promise.resolve()
    });
    await http.send({
      url: 'https://abc.execute-api.us-east-1.amazonaws.com/test/mcp/v1',
      method: 'POST',
      headers: { 'X-Forwarded-For': '1.2.3.4', Cookie: 'a=b', 'X-Atlantis-Origin-Secret': 'a-secret-value' },
      body: { jsonrpc: '2.0', method: 'tools/list' }
    });

    const names = Object.keys(seen[0]).map((name) => name.toLowerCase());
    expect(names).not.toContain('x-forwarded-for');
    expect(names).not.toContain('cookie');
    expect(seen[0]['X-Atlantis-Origin-Secret']).toBe('a-secret-value');
  });

  it('defines the header name and the expected status itself and imports nothing from Lambda code', () => {
    const source = fs.readFileSync(VERIFIER_PATH, 'utf8');

    expect(source).toMatch(/const ORIGIN_SECRET_HEADER = 'X-Atlantis-Origin-Secret';/);
    expect(source).toMatch(/const ORIGIN_REJECTION_STATUS = 401;/);
    const requires = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
    expect(requires.sort()).toEqual(['./settings-loader', 'fs', 'path']);
  });

  it('keeps the counts in the JSDoc current (no 47, 37 core)', () => {
    const source = fs.readFileSync(VERIFIER_PATH, 'utf8');

    expect(source).not.toMatch(/\b47\s+(\*\s+)?entries/);
    expect(source).not.toMatch(/\b37 core\b/);
    expect(source).toMatch(/\b48\s+(\*\s+)?entries \(38 core, 10 advisory\)/);
  });
});
