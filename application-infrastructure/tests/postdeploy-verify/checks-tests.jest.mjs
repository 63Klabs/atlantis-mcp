/**
 * Check tests for the post-deploy verifier (design sections 6, 7, and 11).
 *
 * Every test runs the Verifier's `run` command in process against the fake MCP
 * server (`helpers/fake-mcp-server.mjs`) through `runVerifier()`. No socket is
 * opened and no real network request is made.
 *
 * Coverage:
 * - a healthy stage passes all 45 sub-checks, with and without an edge target, with and without a key
 * - for every sub-check, at least one fake-server fault fails it with the documented reason
 *   (report `checks` entry and the sub-check line on standard output)
 * - the owner and "no usable response; see <owner>" reasons
 * - "not attempted" after a P1 timeout and after a P1 502 (X2 still runs), and after a P1 500
 * - a P1 HTTP 429: the "no baseline" skips, every other sub-check still reports
 * - S2 falling back to no key after a 401, the degraded header, and a limit that is not higher
 * - X2 skipped without an edge target
 * - extra revisions beyond the floor
 *
 * Known gap (reported, not tested): `ctx.reportedVersions.edge` is never set by checkX2.
 *
 * Requirements: 4.6, 9.4, 9.5, 9.7, 10.4, 10.6, 16.4.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { loadVerifier } from './helpers/load-verifier.mjs';
import { runVerifier, guardRealFetch } from './helpers/run-verifier.mjs';
import { createFakeMcpServer, FAKE_API_KEY } from './helpers/fake-mcp-server.mjs';

const { SUB_CHECKS } = loadVerifier();

/** Release version every run expects. */
const EXPECTED_VERSION = '0.0.7';

/** `_meta` key that carries the server identity on modern results. */
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

/** `params._meta` key under which a modern client declares its revision. */
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';

/** Environment that gives the run a stored key the fake server accepts as `registered`. */
const KEY_ENV = Object.freeze({ MCP_API_KEY: FAKE_API_KEY, MCP_KEY_STATUS: 'ok' });

/** Environment of a run whose key parameter holds the placeholder. */
const NO_KEY_ENV = Object.freeze({ MCP_API_KEY: 'BLANK', MCP_KEY_STATUS: 'ok' });

/** Server options that make the fake server accept the stored key at the registered tier. */
const ACCEPT_KEY = Object.freeze({ validKeys: { [FAKE_API_KEY]: 'registered' } });

let restoreFetch;

beforeAll(() => {
  restoreFetch = guardRealFetch();
});

afterAll(() => {
  restoreFetch();
});

/* ------------------------------------------------------------------ */
/*  Request predicates over a recorded call                           */
/* ------------------------------------------------------------------ */

/**
 * Predicates that recognize a catalog request from the fake server's recorded call
 * (`target`, `rpcMethod`, `toolName`, `json`, `headers` as written, `headersLower`).
 * The catalog is design section 7; P4a and P4d differ only in header-name case.
 *
 * @type {Object.<string, function(Object): boolean>}
 */
const REQ = {
  isRaw: (call) => call.target === 'raw',
  P1: (call) => call.target === 'raw' && call.rpcMethod === 'server/discover',
  P2a: (call) => call.target === 'raw' && call.rpcMethod === 'initialize' && call.json?.params?.protocolVersion === '2025-11-25',
  P2b: (call) => call.target === 'raw' && call.rpcMethod === 'initialize' && call.json?.params?.protocolVersion === '2024-11-05',
  P2c: (call) => call.target === 'raw' && call.rpcMethod === 'initialize' && call.json?.params?.protocolVersion === '2025-06-18',
  P2d: (call) => call.target === 'raw' && call.rpcMethod === 'initialize' && call.json?.params?.protocolVersion === '2099-01-01',
  // Only unambiguous in a run without a key: with a key, S2a also has no params
  P2e: (call) => call.target === 'raw' && call.rpcMethod === 'initialize' && !call.json?.params && !call.headersLower['x-api-key'],
  P3a: (call) => call.target === 'raw' && call.rpcMethod === 'tools/list' && call.headersLower['mcp-protocol-version'] === '2099-01-01',
  P3b: (call) => call.target === 'raw' && call.rpcMethod === 'tools/list' && call.json?.params?._meta?.[PROTOCOL_VERSION_META_KEY] === '2099-01-01',
  P4a: (call) => call.target === 'raw' && call.rpcMethod === 'tools/list'
    && Object.hasOwn(call.headers, 'Mcp-Method') && !Object.hasOwn(call.headers, 'Mcp-Name'),
  P4b: (call) => call.target === 'raw' && call.rpcMethod === 'tools/call' && call.headers['Mcp-Name'] === 'list_categories',
  P4c: (call) => call.target === 'raw' && call.rpcMethod === 'tools/call' && call.headers['Mcp-Name'] === 'list_tools',
  P4d: (call) => call.target === 'raw' && Object.hasOwn(call.headers, 'MCP-METHOD'),
  P4e: (call) => call.target === 'raw' && call.headers['Mcp-Name'] === 'something_else',
  P5a: (call) => call.target === 'raw' && call.rpcMethod === 'tools/list'
    && call.headersLower['mcp-protocol-version'] === '2026-07-28' && !call.headersLower['mcp-method'],
  P5b: (call) => call.target === 'raw' && call.rpcMethod === 'tools/list'
    && call.json?.params?._meta?.[PROTOCOL_VERSION_META_KEY] === '2026-07-28',
  P5c: (call) => call.target === 'raw' && call.rpcMethod === 'tools/list' && call.headersLower['mcp-protocol-version'] === '2025-11-25',
  P5d: (call) => call.target === 'raw' && call.rpcMethod === 'tools/list' && call.headersLower['mcp-protocol-version'] === '2024-11-05',
  P5e: (call) => call.target === 'raw' && call.rpcMethod === 'tools/list'
    && !call.headersLower['mcp-protocol-version'] && !call.headersLower['mcp-method'] && !call.json?.params,
  P6a: (call) => call.target === 'raw' && call.toolName === 'list_tools'
    && call.headersLower['mcp-protocol-version'] === '2026-07-28' && !call.headersLower['mcp-method'],
  P6b: (call) => call.target === 'raw' && call.toolName === 'list_tools' && call.headersLower['mcp-protocol-version'] === '2025-11-25',
  T1: (call) => call.target === 'raw' && call.toolName === 'list_templates',
  X2b: (call) => call.target === 'edge' && call.rpcMethod === 'server/discover'
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a JSON-RPC success answer that replaces the one the fake server built.
 *
 * @param {Object} body - The answer being replaced (its `id` is kept)
 * @param {Object} payload - New `result`
 * @returns {Object} Replacement answer
 */
function asResult(body, payload) {
  return { jsonrpc: '2.0', id: body.id, result: payload };
}

/**
 * Build a JSON-RPC error answer that replaces the one the fake server built.
 *
 * @param {Object} body - The answer being replaced (its `id` is kept)
 * @param {number} code - Error code
 * @param {string} message - Error message
 * @returns {Object} Replacement answer
 */
function asError(body, code, message) {
  return { jsonrpc: '2.0', id: body.id, error: { code, message } };
}

/**
 * Create a fake server whose JSON-RPC answers are changed by `mutations`.
 *
 * Each mutation is `[predicate, change]`. `predicate` receives the recorded call; `change`
 * receives `(body, headers, call)` and may change `body` in place or return a replacement.
 *
 * @param {Object} [options] - Options of `createFakeMcpServer`, plus `mutations`
 * @param {Array.<[function(Object): boolean, function(Object, Object, Object): (Object|undefined)]>} [options.mutations] - Answer changes
 * @returns {Object} The fake server
 */
function makeServer({ mutations = [], ...options } = {}) {
  const server = createFakeMcpServer({
    ...options,
    mutate: mutations.length === 0
      ? undefined
      : (context, body, headers) => {
        const call = server.calls[context.index - 1];
        let current = body;
        for (const [matches, change] of mutations) {
          if (matches(call)) {
            const replacement = change(current, headers, call);
            if (replacement !== undefined) {
              current = replacement;
            }
          }
        }
        return current;
      }
  });
  return server;
}

/**
 * Run the Verifier's `run` command against a fake stage.
 *
 * @param {Object} [options] - Run options
 * @param {Object} [options.server] - Options of {@link makeServer}
 * @param {Object.<string, string>} [options.env] - Extra environment variables
 * @param {boolean} [options.edge=true] - Whether the run has an edge target
 * @returns {Promise.<Object>} The `runVerifier` result plus `server` and `check(id)`
 */
async function runStage({ server: serverOptions = {}, env = NO_KEY_ENV, edge = true } = {}) {
  const server = makeServer(serverOptions);
  const result = await runVerifier({
    command: 'run',
    env: {
      MCP_URL: server.rawUrl,
      MCP_EDGE_URL: edge ? server.edgeUrl : '',
      EXPECTED_VERSION,
      ...env
    },
    server
  });
  expect(result.report).not.toBeNull();
  return {
    ...result,
    server,
    check: (id) => result.report.checks.find((entry) => entry.id === id)
  };
}

/**
 * Find the sub-check line for an ID on standard output.
 *
 * @param {string} stdout - Captured standard output
 * @param {string} id - Sub-check ID
 * @returns {(string|undefined)} The line, or undefined when there is none
 */
function lineFor(stdout, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(PASS|FAIL|WARN|SKIP)\\s+${escaped}\\s{2,}`);
  return stdout.split('\n').find((line) => pattern.test(line));
}

/**
 * Collapse whitespace the way the sub-check line does.
 *
 * @param {string} text - Reason text
 * @returns {string} One-line text
 */
function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Assert that one sub-check failed with a reason, in the report and on its line
 * (FAIL for a core sub-check, WARN for an advisory one). Says nothing about the run outcome.
 *
 * @param {Object} run - Result of {@link runStage}
 * @param {string} id - Sub-check ID
 * @param {RegExp} reason - Pattern the reason must match
 */
function expectCheckFailed(run, id, reason) {
  const definition = SUB_CHECKS.find((entry) => entry.id === id);
  const entry = run.check(id);
  const label = definition.severity === 'core' ? 'FAIL' : 'WARN';

  expect(entry.outcome).toBe('fail');
  expect(entry.label).toBe(label);
  expect(entry.reason).toMatch(reason);

  const line = lineFor(run.stdout, id);
  expect(line).toBeDefined();
  expect(line.startsWith(label)).toBe(true);
  expect(line).toContain(`(${oneLine(entry.reason)})`);
}

/**
 * Assert that a sub-check failed with a reason, and what that means for the run.
 *
 * A core failure fails the run; an advisory failure prints WARN and leaves the run passed.
 *
 * @param {Object} run - Result of {@link runStage}
 * @param {string} id - Sub-check ID
 * @param {RegExp} reason - Pattern the reason must match
 */
function expectFailed(run, id, reason) {
  const definition = SUB_CHECKS.find((entry) => entry.id === id);
  expectCheckFailed(run, id, reason);

  if (definition.severity === 'core') {
    expect(run.exitCode).toBe(1);
    expect(run.report.outcome).toBe('failed');
    expect(run.report.failedCore).toContain(id);
  } else {
    expect(run.exitCode).toBe(0);
    expect(run.report.outcome).toBe('passed');
    expect(run.report.failedCore).toEqual([]);
    expect(run.report.warnings).toContain(id);
  }
}

/**
 * Assert that a sub-check was skipped with a reason, in the report and on its line.
 *
 * @param {Object} run - Result of {@link runStage}
 * @param {string} id - Sub-check ID
 * @param {(string|RegExp)} reason - Exact reason, or a pattern it must match
 */
function expectSkipped(run, id, reason) {
  const entry = run.check(id);
  expect(entry.outcome).toBe('skip');
  expect(entry.label).toBe('SKIP');
  if (typeof reason === 'string') {
    expect(entry.reason).toBe(reason);
  } else {
    expect(entry.reason).toMatch(reason);
  }
  const line = lineFor(run.stdout, id);
  expect(line.startsWith('SKIP')).toBe(true);
  expect(line).toContain(`(${oneLine(entry.reason)})`);
}

/**
 * List the calls that carried the stored key in `X-API-Key` or as a Bearer token.
 *
 * @param {Array.<Object>} calls - Calls recorded by the fake server
 * @returns {Array.<Object>} Calls that carried the key
 */
function callsWithKey(calls) {
  return calls.filter((call) =>
    call.headersLower['x-api-key'] === FAKE_API_KEY
    || call.headersLower.authorization === `Bearer ${FAKE_API_KEY}`);
}

/**
 * Find the index of the first call that carried the key in a Bearer token (S2b).
 *
 * @param {Array.<Object>} calls - Calls recorded by the fake server
 * @returns {number} Index into `calls`, or -1
 */
function indexOfBearerCall(calls) {
  return calls.findIndex((call) => call.headersLower.authorization === `Bearer ${FAKE_API_KEY}`);
}

const ALL_IDS = SUB_CHECKS.map((definition) => definition.id);

/* ------------------------------------------------------------------ */
/*  Healthy stage                                                     */
/* ------------------------------------------------------------------ */

describe('healthy stage', () => {
  it('has 45 sub-checks, 36 core and 9 advisory', () => {
    expect(SUB_CHECKS).toHaveLength(45);
    expect(SUB_CHECKS.filter((definition) => definition.severity === 'core')).toHaveLength(36);
    expect(SUB_CHECKS.filter((definition) => definition.severity === 'advisory')).toHaveLength(9);
  });

  it('passes all 45 sub-checks with a key and an edge target', async () => {
    const run = await runStage({ server: ACCEPT_KEY, env: KEY_ENV, edge: true });

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.report.outcome).toBe('passed');
    expect(run.report.checks.map((entry) => entry.id)).toEqual(ALL_IDS);
    for (const entry of run.report.checks) {
      expect(entry.outcome).toBe('pass');
      expect(entry.reason).toBeNull();
    }
    expect(run.report.counts).toEqual({
      core: { passed: 36, failed: 0, skipped: 0 },
      advisory: { passed: 9, warned: 0, skipped: 0 }
    });
    expect(run.report.failedCore).toEqual([]);
    expect(run.report.skippedCore).toEqual([]);
    expect(run.report.warnings).toEqual([]);

    // One PASS line per sub-check, in catalog order
    const passLines = run.stdout.split('\n').filter((line) => line.startsWith('PASS'));
    expect(passLines).toHaveLength(45);
    expect(passLines.map((line) => line.split(/\s+/)[1])).toEqual(ALL_IDS);
  });

  it('passes every sub-check it runs with a key and no edge target, and skips X2', async () => {
    const run = await runStage({ server: ACCEPT_KEY, env: KEY_ENV, edge: false });

    expect(run.exitCode).toBe(0);
    expect(run.report.outcome).toBe('passed');
    expect(run.report.checks.map((entry) => entry.id)).toEqual(ALL_IDS);
    for (const entry of run.report.checks) {
      expect(entry.outcome).toBe(entry.id.startsWith('X2.') ? 'skip' : 'pass');
    }
    expect(run.report.counts).toEqual({
      core: { passed: 36, failed: 0, skipped: 0 },
      advisory: { passed: 5, warned: 0, skipped: 4 }
    });
    expect(run.calls.some((call) => call.target === 'edge')).toBe(false);
  });

  it('passes every sub-check it runs with an edge target and no key, and skips S2', async () => {
    const run = await runStage({ env: NO_KEY_ENV, edge: true });

    expect(run.exitCode).toBe(0);
    expect(run.report.outcome).toBe('passed');
    expect(run.report.checks.map((entry) => entry.id)).toEqual(ALL_IDS);
    for (const entry of run.report.checks) {
      expect(entry.outcome).toBe(entry.id.startsWith('S2.') ? 'skip' : 'pass');
    }
    expect(run.report.counts).toEqual({
      core: { passed: 36, failed: 0, skipped: 0 },
      advisory: { passed: 6, warned: 0, skipped: 3 }
    });
    expectSkipped(run, 'S2.1', /placeholder BLANK/);
    expectSkipped(run, 'S2.2', /placeholder BLANK/);
    expectSkipped(run, 'S2.3', /placeholder BLANK/);
    expect(callsWithKey(run.calls)).toHaveLength(0);
  });

  it('passes every core sub-check with no key and no edge target', async () => {
    const run = await runStage({ env: NO_KEY_ENV, edge: false });

    expect(run.exitCode).toBe(0);
    expect(run.report.outcome).toBe('passed');
    for (const entry of run.report.checks) {
      const isSkipped = entry.id.startsWith('S2.') || entry.id.startsWith('X2.');
      expect(entry.outcome).toBe(isSkipped ? 'skip' : 'pass');
    }
    expect(run.report.counts).toEqual({
      core: { passed: 36, failed: 0, skipped: 0 },
      advisory: { passed: 2, warned: 0, skipped: 7 }
    });
  });

  it('notes "none advertised" on P5.9 when the server advertises no extra revision', async () => {
    const run = await runStage();

    expect(run.check('P5.9').outcome).toBe('pass');
    expect(run.check('P5.9').note).toBe('none advertised');
    expect(lineFor(run.stdout, 'P5.9')).toContain('(none advertised)');
  });
});

/* ------------------------------------------------------------------ */
/*  One failing fault per sub-check                                   */
/* ------------------------------------------------------------------ */

/**
 * One row per sub-check (some have more than one): the fake-server fault that fails it and
 * the pattern its documented reason matches.
 *
 * @type {Array.<{id: string, name: string, server: Object, env?: Object, reason: RegExp}>}
 */
const FAILURES = [
  // P1 and V1.1
  {
    id: 'P1.1',
    name: 'server/discover answers with a JSON-RPC error',
    server: { mutations: [[REQ.P1, (body) => asError(body, -32603, 'Internal error')]] },
    reason: /^response has error \{"code":-32603,"message":"Internal error"\}$/
  },
  {
    id: 'P1.2',
    name: 'server/discover resultType is not complete',
    server: { mutations: [[REQ.P1, (body) => { body.result.resultType = 'partial'; }]] },
    reason: /^result\.resultType is "partial", expected "complete"$/
  },
  {
    id: 'P1.2',
    name: 'server/discover carries a top-level protocolVersion',
    server: { mutations: [[REQ.P1, (body) => { body.result.protocolVersion = '2025-11-25'; }]] },
    reason: /^result has unexpected key "protocolVersion"$/
  },
  {
    id: 'P1.3',
    name: 'server/discover reports another server name',
    server: { mutations: [[REQ.P1, (body) => { body.result._meta[SERVER_INFO_META_KEY].name = 'other-server'; }]] },
    reason: /\.name is "other-server", expected "atlantis-mcp-server"$/
  },
  {
    id: 'P1.4',
    name: 'server/discover instructions is empty',
    server: { mutations: [[REQ.P1, (body) => { body.result.instructions = ''; }]] },
    reason: /^result\.instructions is "", expected a non-empty string$/
  },
  {
    id: 'P1.5',
    name: 'server/discover does not advertise 2026-07-28',
    server: { mutations: [[REQ.P1, (body) => { body.result.supportedVersions = ['2024-11-05', '2025-11-25']; }]] },
    reason: /^result\.supportedVersions is missing "2026-07-28"$/
  },
  {
    id: 'V1.1',
    name: 'a stale deploy reports an older version',
    server: { version: '0.0.6' },
    reason: /^expected version "0\.0\.7", server\/discover reported "0\.0\.6"$/
  },

  // S1
  {
    id: 'S1.1',
    name: 'the server serves the made-up key at the degraded tier',
    server: { degradedAuth: { select: { hasKey: true }, times: 1 } },
    reason: /^HTTP 200, expected 401; X-MCP-Auth-Status: degraded; body: /
  },
  {
    id: 'S1.1',
    name: 'the server accepts the made-up key',
    server: { validKeys: { 'postdeploy-verify-invalid-key': 'public' } },
    reason: /^HTTP 200, expected 401; body: /
  },

  // S2
  {
    id: 'S2.1',
    name: 'X-API-Key is served at the degraded tier',
    server: {
      ...ACCEPT_KEY,
      degradedAuth: { select: (context) => context.headers['x-api-key'] === FAKE_API_KEY, times: 1 }
    },
    env: KEY_ENV,
    reason: /^response carries X-MCP-Auth-Status: degraded, so the key was not applied to this request; the remaining checks run without the key$/
  },
  {
    id: 'S2.2',
    name: 'the Bearer token is served at the degraded tier',
    server: {
      ...ACCEPT_KEY,
      degradedAuth: { select: (context) => context.headers.authorization === `Bearer ${FAKE_API_KEY}`, times: 1 }
    },
    env: KEY_ENV,
    reason: /^response carries X-MCP-Auth-Status: degraded, so the key was not applied to this request$/
  },
  {
    id: 'S2.3',
    name: 'the key gets the public limit',
    server: { validKeys: { [FAKE_API_KEY]: 'public' } },
    env: KEY_ENV,
    reason: /^X-RateLimit-Limit is 50, expected more than P1's 50; the remaining checks run without the key$/
  },

  // P2 and V1.2
  {
    id: 'P2.1',
    name: 'initialize does not echo 2025-11-25',
    server: { mutations: [[REQ.P2a, (body) => { body.result.protocolVersion = '1999-01-01'; }]] },
    reason: /^result\.protocolVersion is "1999-01-01", expected "2025-11-25"$/
  },
  {
    id: 'P2.2',
    name: 'initialize does not echo 2024-11-05',
    server: { mutations: [[REQ.P2b, (body) => { body.result.protocolVersion = '1999-01-01'; }]] },
    reason: /^result\.protocolVersion is "1999-01-01", expected "2024-11-05"$/
  },
  {
    id: 'P2.3',
    name: 'initialize does not offer 2024-11-05 for 2025-06-18',
    server: { mutations: [[REQ.P2c, (body) => { body.result.protocolVersion = '2025-11-25'; }]] },
    reason: /^result\.protocolVersion is "2025-11-25", expected "2024-11-05"$/
  },
  {
    id: 'P2.4',
    name: 'initialize does not offer 2025-11-25 for 2099-01-01',
    server: { mutations: [[REQ.P2d, (body) => { body.result.protocolVersion = '2099-01-01'; }]] },
    reason: /^result\.protocolVersion is "2099-01-01", expected "2025-11-25"$/
  },
  {
    id: 'P2.5',
    name: 'initialize without params does not offer 2025-11-25',
    server: { mutations: [[REQ.P2e, (body) => { body.result.protocolVersion = '2024-11-05'; }]] },
    reason: /^result\.protocolVersion is "2024-11-05", expected "2025-11-25"$/
  },
  {
    id: 'P2.6',
    name: 'the legacy initialize result has a fifth key',
    server: { mutations: [[REQ.P2a, (body) => { body.result.resultType = 'complete'; }]] },
    reason: /^result has unexpected key "resultType"$/
  },
  {
    id: 'P2.6',
    name: 'the legacy initialize result lacks a key',
    server: { mutations: [[REQ.P2a, (body) => { delete body.result.instructions; }]] },
    reason: /^result is missing key "instructions"$/
  },
  {
    id: 'P2.7',
    name: 'one initialize answer carries other instructions',
    server: { mutations: [[REQ.P2c, (body) => { body.result.instructions = 'different'; }]] },
    reason: /^P2c \(2025-06-18\): result\.instructions \(9 characters\) differs from server\/discover's instructions \(\d+ characters\)$/
  },
  {
    id: 'V1.2',
    name: 'initialize reports an older version',
    server: { mutations: [[REQ.P2a, (body) => { body.result.serverInfo.version = '0.0.6'; }]] },
    reason: /^expected version "0\.0\.7", initialize reported "0\.0\.6"$/
  },

  // P3
  {
    id: 'P3.1',
    name: 'an unlisted revision in the header gets a result',
    server: { mutations: [[REQ.P3a, (body) => asResult(body, { tools: [] })]] },
    reason: /^response has a result instead of error -32022$/
  },
  {
    id: 'P3.2',
    name: 'an unlisted revision in params._meta gets a result',
    server: { mutations: [[REQ.P3b, (body) => asResult(body, { tools: [] })]] },
    reason: /^response has a result instead of error -32022$/
  },
  {
    id: 'P3.3',
    name: '-32022 lists supportedVersions in another order',
    server: {
      mutations: [[REQ.P3a, (body) => { body.error.data.supportedVersions = [...body.error.data.supportedVersions].reverse(); }]]
    },
    reason: /^header response: error\.data\.supportedVersions is \[.*\], expected \[.*\] \(server\/discover's list\)$/
  },

  // P4
  {
    id: 'P4.1',
    name: 'a mismatched Mcp-Method gets a result',
    server: { mutations: [[REQ.P4a, (body) => asResult(body, { tools: [] })]] },
    reason: /^response has a result instead of error -32020; the MCP-Protocol-Version or Mcp-\* headers may not be reaching the function$/
  },
  {
    id: 'P4.2',
    name: 'a mismatched Mcp-Name reports another headerValue',
    server: { mutations: [[REQ.P4b, (body) => { body.error.data.headerValue = 'wrong'; }]] },
    reason: /^error\.data\.headerValue is "wrong", expected "list_categories"$/
  },
  {
    id: 'P4.3',
    name: 'matching Mcp-* headers get a result that is not complete',
    server: { mutations: [[REQ.P4c, (body) => { body.result.resultType = 'partial'; }]] },
    reason: /^result\.resultType is "partial", expected "complete"$/
  },
  {
    id: 'P4.3',
    name: 'matching Mcp-* headers get an error',
    server: { mutations: [[REQ.P4c, (body) => asError(body, -32020, 'Header mismatch')]] },
    reason: /^response has error \{"code":-32020,"message":"Header mismatch"\}$/
  },
  {
    id: 'P4.4',
    name: 'differently cased Mcp-* headers are not matched',
    server: { mutations: [[REQ.P4d, (body) => asResult(body, { tools: [] })]] },
    reason: /^response has a result instead of error -32020; /
  },
  {
    id: 'P4.5',
    name: 'a legacy request is rejected for mismatched Mcp-* headers',
    server: { mutations: [[REQ.P4e, (body) => asError(body, -32020, 'Header mismatch')]] },
    reason: /^response has error \{"code":-32020/
  },

  // P5
  {
    id: 'P5.1',
    name: 'the modern tools/list has a negative ttlMs',
    server: { mutations: [[REQ.P5a, (body) => { body.result.ttlMs = -1; }]] },
    reason: /^result\.ttlMs is -1, expected a non-negative integer$/
  },
  {
    id: 'P5.2',
    name: 'the modern tools/list (params._meta) has an empty cacheScope',
    server: { mutations: [[REQ.P5b, (body) => { body.result.cacheScope = ''; }]] },
    reason: /^result\.cacheScope is "", expected a non-empty string$/
  },
  {
    id: 'P5.3',
    name: 'the 2025-11-25 tools/list carries ttlMs',
    server: { mutations: [[REQ.P5c, (body) => { body.result.ttlMs = 1; }]] },
    reason: /^result has unexpected key "ttlMs"$/
  },
  {
    id: 'P5.4',
    name: 'the 2024-11-05 tools/list carries _meta',
    server: { mutations: [[REQ.P5d, (body) => { body.result._meta = {}; }]] },
    reason: /^result has unexpected key "_meta"$/
  },
  {
    id: 'P5.5',
    name: 'the tools/list without a revision lists no tools',
    server: { mutations: [[REQ.P5e, (body) => { body.result.tools = []; }]] },
    reason: /^result\.tools is \[\], expected a non-empty array$/
  },
  {
    id: 'P5.6',
    name: 'a tool has no title on a titled revision',
    server: { toolWithoutTitle: 'list_tools' },
    reason: /^2026-07-28 \(header\): tool "list_tools" has no title$/
  },
  {
    id: 'P5.6',
    name: 'a tool has no annotations on 2025-11-25',
    server: { mutations: [[REQ.P5c, (body) => { delete body.result.tools[0].annotations; }]] },
    reason: /^2025-11-25: tool "list_templates" has no annotations$/
  },
  {
    id: 'P5.6',
    name: 'a tool is not read-only',
    server: { mutations: [[REQ.P5b, (body) => { body.result.tools[0].annotations.readOnlyHint = false; }]] },
    reason: /^2026-07-28 \(params\._meta\): tool "list_templates" annotations\.readOnlyHint is false, expected true$/
  },
  {
    id: 'P5.7',
    name: 'a tool has a title on 2024-11-05',
    server: { mutations: [[REQ.P5d, (body) => { body.result.tools[0].title = 'Title'; }]] },
    reason: /^2024-11-05: tool "list_templates" has unexpected title$/
  },
  {
    id: 'P5.8',
    name: 'one revision lists the tools in another order',
    server: { mutations: [[REQ.P5e, (body) => { body.result.tools.reverse(); }]] },
    reason: /^tools\/list for no revision has tool "get_agent_asset_chunk" at position 0, but 2026-07-28 \(header\) has "list_templates"$/
  },
  {
    id: 'P5.9',
    name: 'an advertised extra revision is rejected',
    server: {
      extraRevisions: ['2027-01-01'],
      mutations: [[
        (call) => call.target === 'raw' && call.headersLower['mcp-protocol-version'] === '2027-01-01',
        (body) => asError(body, -32022, 'Unsupported protocol version')
      ]]
    },
    reason: /^revision "2027-01-01" was rejected with error -32022 although server\/discover advertises it$/
  },
  {
    id: 'P5.9',
    name: 'an advertised extra revision lists no tools',
    server: {
      extraRevisions: ['2027-01-01'],
      mutations: [[
        (call) => call.target === 'raw' && call.headersLower['mcp-protocol-version'] === '2027-01-01',
        (body) => { body.result.tools = []; }
      ]]
    },
    reason: /^revision "2027-01-01": result\.tools is \[\], expected a non-empty array$/
  },

  // P6 and T1
  {
    id: 'P6.1',
    name: 'the modern tools/call has no resultType',
    server: { mutations: [[REQ.P6a, (body) => { delete body.result.resultType; }]] },
    reason: /^result\.resultType is undefined, expected "complete"$/
  },
  {
    id: 'P6.1',
    name: 'the modern tools/call has no serverInfo in _meta',
    server: { mutations: [[REQ.P6a, (body) => { body.result._meta = {}; }]] },
    reason: /^result\._meta is missing "io\.modelcontextprotocol\/serverInfo"$/
  },
  {
    id: 'P6.2',
    name: 'the legacy tools/call carries resultType',
    server: { mutations: [[REQ.P6b, (body) => { body.result.resultType = 'complete'; }]] },
    reason: /^result has unexpected key "resultType"$/
  },
  {
    id: 'T1.1',
    name: 'list_templates fails in the controller',
    server: { failListTemplates: true },
    reason: /^response has error \{"code":-32603/
  },
  {
    id: 'T1.1',
    name: 'list_templates returns text that is not JSON',
    server: { mutations: [[REQ.T1, (body) => { body.result.content[0].text = 'not json'; }]] },
    reason: /^result\.content\[0\]\.text is not JSON \(8 characters\)$/
  },

  // X1
  {
    id: 'X1.1',
    name: 'the preflight allows another origin',
    server: { preflight: { allowOrigin: 'https://other.example' } },
    reason: /^Access-Control-Allow-Origin is "https:\/\/other\.example", expected "\*" or "https:\/\/example\.com"$/
  },
  {
    id: 'X1.2',
    name: 'the preflight does not allow all three MCP headers',
    server: { preflight: { allowHeaders: 'Content-Type,Mcp-Method' } },
    reason: /^Access-Control-Allow-Headers is "Content-Type,Mcp-Method", missing MCP-Protocol-Version, Mcp-Name$/
  },
  {
    id: 'X1.3',
    name: 'the preflight does not allow POST',
    server: { preflight: { allowMethods: 'GET,OPTIONS' } },
    reason: /^Access-Control-Allow-Methods is "GET,OPTIONS", missing POST$/
  },

  // X2
  {
    id: 'X2.1',
    name: 'the edge preflight allows no MCP header',
    server: { edgePreflight: { allowHeaders: 'Content-Type' } },
    reason: /^Access-Control-Allow-Headers is "Content-Type", missing MCP-Protocol-Version, Mcp-Method, Mcp-Name$/
  },
  {
    id: 'X2.2',
    name: 'the edge reports an older version',
    server: { mutations: [[REQ.X2b, (body) => { body.result._meta[SERVER_INFO_META_KEY].version = '0.0.6'; }]] },
    reason: /^expected version "0\.0\.7", the edge's server\/discover reported "0\.0\.6"$/
  },
  {
    id: 'X2.3',
    name: 'the edge drops the MCP headers (mismatched Mcp-Method gets a result)',
    server: { edgeDropsMcpHeaders: true },
    reason: /^response has a result instead of error -32020; the edge may not be forwarding the MCP-Protocol-Version or Mcp-\* headers$/
  },
  {
    id: 'X2.4',
    name: 'the edge drops the MCP headers (mismatched Mcp-Name gets a result)',
    server: { edgeDropsMcpHeaders: true },
    reason: /^response has a result instead of error -32020; the edge may not be forwarding the MCP-Protocol-Version or Mcp-\* headers$/
  }
];

describe('every sub-check can fail with its documented reason', () => {
  it('has a failing fault for each of the 45 sub-checks', () => {
    const covered = new Set(FAILURES.map((row) => row.id));
    expect([...ALL_IDS].filter((id) => !covered.has(id))).toEqual([]);
    expect(covered.size).toBe(45);
  });

  it.each(FAILURES.map((row) => [`${row.id}: ${row.name}`, row]))('%s', async (_name, row) => {
    const run = await runStage({ server: row.server, env: row.env ?? NO_KEY_ENV });

    expectFailed(run, row.id, row.reason);
  });
});

/* ------------------------------------------------------------------ */
/*  Owner and "see" reasons                                           */
/* ------------------------------------------------------------------ */

describe('owner and "see" reasons', () => {
  it('gives the owner the HTTP status and body, and every dependent "see <owner>"', async () => {
    const run = await runStage({
      server: {
        serverError: {
          select: (context) => context.rpcMethod === 'initialize' && context.json?.params?.protocolVersion === '2025-11-25',
          status: 503
        }
      }
    });

    // Retried once, then the second 503 stands
    expect(run.calls.filter(REQ.P2a)).toHaveLength(2);

    expectFailed(run, 'P2.1', /^HTTP 503, expected 200; body: \{"message":"Service Unavailable"\}$/);
    for (const id of ['P2.6', 'P2.7', 'V1.2']) {
      expectFailed(run, id, /^no usable response; see P2\.1$/);
    }
    for (const id of ['P2.2', 'P2.3', 'P2.4', 'P2.5']) {
      expect(run.check(id).outcome).toBe('pass');
    }
    expect(run.report.failedCore).toEqual(['P2.1', 'P2.6', 'P2.7', 'V1.2']);
  });

  it('gives the first X1 sub-check the status and every other X1 sub-check "see X1.1"', async () => {
    const run = await runStage({ server: { preflight: { status: 403 } } });

    expectFailed(run, 'X1.1', /^HTTP 403, expected 200; body: \(empty\)$/);
    expectFailed(run, 'X1.2', /^no usable response; see X1\.1$/);
    expectFailed(run, 'X1.3', /^no usable response; see X1\.1$/);
    expect(run.report.failedCore).toEqual(['X1.1', 'X1.2', 'X1.3']);
  });

  it('refuses a redirect and names where it pointed', async () => {
    const run = await runStage({
      server: {
        redirect: {
          select: (context) => context.rpcMethod === 'tools/list' && context.headers['mcp-protocol-version'] === '2099-01-01'
            && context.json?.params === undefined,
          status: 302,
          location: 'https://redirected.example.net/mcp/v1'
        }
      }
    });

    expectFailed(run, 'P3.1', /^redirect \(HTTP 302\) to redirected\.example\.net was not followed$/);
    expectFailed(run, 'P3.3', /^no usable response; see P3\.1$/);
    expect(run.check('P3.2').outcome).toBe('pass');
  });
});

/* ------------------------------------------------------------------ */
/*  Raw target down: "not attempted"                                  */
/* ------------------------------------------------------------------ */

/** Select P1 in a fault option (the raw `server/discover`). */
const selectP1 = (context) => context.target === 'raw' && context.rpcMethod === 'server/discover';

/**
 * Assert what a run looks like after P1 showed the raw target is down.
 *
 * P1 sub-checks carry the gate reason (the first) and "see P1.1"; every other raw sub-check
 * fails with the "not attempted" reason, except P5.9, which has no exchange of its own and
 * fails on the missing baseline. X2 goes to the edge only and still passes.
 *
 * @param {Object} run - Result of {@link runStage}
 * @param {RegExp} p1Reason - Pattern the reason of P1.1 must match
 */
function expectRawTargetDown(run, p1Reason) {
  const notAttempted = 'not attempted: raw target did not answer P1';

  expectCheckFailed(run, 'P1.1', p1Reason);
  for (const id of ['P1.2', 'P1.3', 'P1.4', 'P1.5', 'V1.1']) {
    expectCheckFailed(run, id, /^no usable response; see P1\.1$/);
  }

  const notAttemptedIds = SUB_CHECKS
    .filter((definition) => /^(S1|P2|P3|P4|P5|P6|T1|X1)\./.test(definition.id) || definition.id === 'V1.2')
    .map((definition) => definition.id)
    .filter((id) => id !== 'P5.9');
  for (const id of notAttemptedIds) {
    expectCheckFailed(run, id, new RegExp(`^${notAttempted}$`));
  }
  expectCheckFailed(run, 'P5.9', /^no baseline: P1 returned no valid supportedVersions$/);

  // X2 still runs against the edge
  for (const id of ['X2.1', 'X2.2', 'X2.3', 'X2.4']) {
    expect(run.check(id).outcome).toBe('pass');
  }
  expect(run.calls.filter((call) => call.target === 'edge')).toHaveLength(4);
  expect(run.report.outcome).toBe('failed');
  expect(run.exitCode).toBe(1);
}

describe('raw target down: not attempted (Requirement 4.6)', () => {
  it('sends nothing more to the raw target after a P1 timeout, and X2 still runs', async () => {
    const run = await runStage({ server: { timeout: { select: selectP1 } } });

    expectRawTargetDown(run, /^no response \(timeout\) after 2 attempts$/);
    // Only P1's two attempts reached the raw target
    expect(run.calls.filter((call) => call.target === 'raw')).toHaveLength(2);
  });

  it('sends nothing more to the raw target after a P1 502, and X2 still runs', async () => {
    const run = await runStage({ server: { serverError: { select: selectP1, status: 502 } } });

    expectRawTargetDown(run, /^HTTP 502, expected 200; body: \{"message":"Internal server error"\}$/);
    expect(run.calls.filter((call) => call.target === 'raw')).toHaveLength(2);
  });

  it('treats a P1 500 as down too, without a retry', async () => {
    const run = await runStage({ server: { serverError: { select: selectP1, status: 500 } } });

    expectRawTargetDown(run, /^HTTP 500, expected 200; body: \{"message":"Internal server error"\}$/);
    expect(run.calls.filter((call) => call.target === 'raw')).toHaveLength(1);
  });

  it('does not treat a P1 network error as a reason to keep sending', async () => {
    const run = await runStage({ server: { networkError: { select: selectP1, code: 'ECONNREFUSED' } } });

    expectRawTargetDown(run, /^no response \(ECONNREFUSED\) after 2 attempts$/);
    expect(run.calls.filter((call) => call.target === 'raw')).toHaveLength(2);
  });

  it('fails S2 with "not attempted" and never sends the key when P1 is down', async () => {
    const run = await runStage({
      server: { ...ACCEPT_KEY, timeout: { select: selectP1 } },
      env: KEY_ENV
    });

    for (const id of ['S2.1', 'S2.2', 'S2.3']) {
      expectCheckFailed(run, id, /^not attempted: raw target did not answer P1$/);
    }
    expect(callsWithKey(run.calls)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  HTTP 429                                                          */
/* ------------------------------------------------------------------ */

describe('rate limited (Requirements 10.4, 10.6)', () => {
  const RATE_LIMITED = 'no answer: rate limited (HTTP 429)';
  const NO_BASELINE = 'no baseline: P1 had no answer';

  it('skips P1 and every baseline comparison on a P1 429, and every other sub-check still reports', async () => {
    const run = await runStage({
      server: {
        rateLimited: { select: selectP1, times: 1, retryAfterSeconds: 1830, resetEpochSeconds: 1792648800 }
      }
    });

    for (const id of ['P1.1', 'P1.2', 'P1.3', 'P1.4', 'P1.5', 'V1.1']) {
      expectSkipped(run, id, RATE_LIMITED);
    }
    for (const id of ['P2.7', 'P3.3', 'P5.9']) {
      expectSkipped(run, id, NO_BASELINE);
    }

    // Every other sub-check ran: S2 has no key, everything else passed
    const skippedIds = ['P1.1', 'P1.2', 'P1.3', 'P1.4', 'P1.5', 'V1.1', 'P2.7', 'P3.3', 'P5.9'];
    for (const entry of run.report.checks) {
      if (skippedIds.includes(entry.id)) {
        continue;
      }
      expect(entry.outcome).toBe(entry.id.startsWith('S2.') ? 'skip' : 'pass');
    }
    expect(run.report.checks).toHaveLength(45);

    // A skipped core sub-check makes the run inconclusive, never failed or passed
    expect(run.report.outcome).toBe('inconclusive');
    expect(run.exitCode).toBe(1);
    expect(run.report.failedCore).toEqual([]);
    expect(run.report.skippedCore).toEqual(skippedIds);
    expect(run.report.rateLimit).toEqual({ retryAfterSeconds: 1830, resetAt: 1792648800 });

    // P1 was not retried, and the raw target was not treated as down
    expect(run.calls.filter(REQ.P1)).toHaveLength(1);
    expect(run.calls.length).toBeGreaterThan(20);
  });

  it('still uses the key after a P1 429 (S2.3 is skipped, not failed)', async () => {
    const run = await runStage({
      server: { ...ACCEPT_KEY, rateLimited: { select: selectP1, times: 1 } },
      env: KEY_ENV
    });

    expect(run.check('S2.1').outcome).toBe('pass');
    expect(run.check('S2.2').outcome).toBe('pass');
    expectSkipped(run, 'S2.3', NO_BASELINE);

    const bearerIndex = indexOfBearerCall(run.calls);
    const later = run.calls.slice(bearerIndex + 1).filter((call) => call.method === 'POST');
    expect(later.length).toBeGreaterThan(15);
    for (const call of later) {
      expect(call.headersLower['x-api-key']).toBe(FAKE_API_KEY);
    }
  });

  it('skips only the sub-checks that depend on a 429 in the middle of the run', async () => {
    const run = await runStage({
      server: {
        rateLimited: {
          select: (context) => context.rpcMethod === 'tools/list' && context.headers['mcp-protocol-version'] === '2099-01-01'
            && context.json?.params === undefined,
          times: 1
        }
      }
    });

    expectSkipped(run, 'P3.1', RATE_LIMITED);
    expectSkipped(run, 'P3.3', RATE_LIMITED);
    expect(run.check('P3.2').outcome).toBe('pass');
    expect(run.check('P1.1').outcome).toBe('pass');
    expect(run.report.outcome).toBe('inconclusive');
    expect(run.report.skippedCore).toEqual(['P3.1', 'P3.3']);
    expect(run.report.failedCore).toEqual([]);
  });

  it('skips an advisory sub-check on a 429 without making the run inconclusive', async () => {
    const run = await runStage({
      server: { rateLimited: { select: (context) => context.toolName === 'list_templates', times: 1 } }
    });

    expectSkipped(run, 'T1.1', RATE_LIMITED);
    expect(run.report.outcome).toBe('passed');
    expect(run.exitCode).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  S2: the key                                                       */
/* ------------------------------------------------------------------ */

describe('S2 and the key (Requirements 9.4, 9.5)', () => {
  it('sends the accepted key on every later POST and on no preflight', async () => {
    const run = await runStage({ server: ACCEPT_KEY, env: KEY_ENV });

    const posts = run.calls.filter((call) => call.method === 'POST');
    const [p1, s1, s2a, s2b, ...rest] = posts;
    expect(p1.headersLower['x-api-key']).toBeUndefined();
    expect(s1.headersLower['x-api-key']).toBe('postdeploy-verify-invalid-key');
    expect(s2a.headersLower['x-api-key']).toBe(FAKE_API_KEY);
    expect(s2b.headersLower.authorization).toBe(`Bearer ${FAKE_API_KEY}`);
    expect(s2b.headersLower['x-api-key']).toBeUndefined();
    expect(rest.length).toBeGreaterThan(15);
    for (const call of rest) {
      expect(call.headersLower['x-api-key']).toBe(FAKE_API_KEY);
    }
    for (const call of run.calls.filter((entry) => entry.method === 'OPTIONS')) {
      expect(call.headersLower['x-api-key']).toBeUndefined();
      expect(call.headersLower.authorization).toBeUndefined();
    }
  });

  it('never prints the key', async () => {
    const run = await runStage({ server: ACCEPT_KEY, env: KEY_ENV });

    expect(run.stdout).not.toContain(FAKE_API_KEY);
    expect(run.stderr).not.toContain(FAKE_API_KEY);
    expect(JSON.stringify(run.report)).not.toContain(FAKE_API_KEY);
    expect(run.report.key.classification).toBe('present');
    expect(run.report.key.used).toBe(true);
  });

  it('falls back to no key after a 401, and the remaining checks still pass', async () => {
    // The fake server does not know the key, so it answers 401
    const run = await runStage({ env: KEY_ENV });

    expectFailed(run, 'S2.1', /^HTTP 401, expected 200; body: .*; the remaining checks run without the key$/);
    expectFailed(run, 'S2.2', /^HTTP 401, expected 200; body: /);
    expectFailed(run, 'S2.3', /^no usable response; see S2\.1$/);

    // Nothing after S2b carries the key
    const bearerIndex = indexOfBearerCall(run.calls);
    expect(bearerIndex).toBeGreaterThan(0);
    expect(callsWithKey(run.calls.slice(bearerIndex + 1))).toHaveLength(0);
    const later = run.calls.slice(bearerIndex + 1).filter((call) => call.method === 'POST');
    expect(later.length).toBeGreaterThan(15);

    // Every other sub-check passed at the public tier
    for (const entry of run.report.checks.filter((check) => !check.id.startsWith('S2.'))) {
      expect(entry.outcome).toBe('pass');
    }
    expect(run.report.key.used).toBe(false);
    expect(run.report.outcome).toBe('passed');
  });

  it('falls back to no key after the degraded header', async () => {
    const run = await runStage({
      server: {
        ...ACCEPT_KEY,
        degradedAuth: { select: (context) => context.headers['x-api-key'] === FAKE_API_KEY, times: 1 }
      },
      env: KEY_ENV
    });

    expectFailed(run, 'S2.1', /X-MCP-Auth-Status: degraded.*the remaining checks run without the key$/);
    // S2a was served at the public tier, so its limit is not higher either
    expectFailed(run, 'S2.3', /^X-RateLimit-Limit is 50, expected more than P1's 50 \(response carries X-MCP-Auth-Status: degraded\); the remaining checks run without the key$/);
    expect(run.check('S2.2').outcome).toBe('pass');

    const bearerIndex = indexOfBearerCall(run.calls);
    expect(callsWithKey(run.calls.slice(bearerIndex + 1))).toHaveLength(0);
    expect(run.report.outcome).toBe('passed');
  });

  it('falls back to no key when the limit is not higher than the public one', async () => {
    const run = await runStage({ server: { validKeys: { [FAKE_API_KEY]: 'public' } }, env: KEY_ENV });

    expect(run.check('S2.1').outcome).toBe('pass');
    expect(run.check('S2.2').outcome).toBe('pass');
    expectFailed(run, 'S2.3', /^X-RateLimit-Limit is 50, expected more than P1's 50; the remaining checks run without the key$/);

    const bearerIndex = indexOfBearerCall(run.calls);
    expect(callsWithKey(run.calls.slice(bearerIndex + 1))).toHaveLength(0);
    expect(run.report.key.used).toBe(false);
    expect(run.report.outcome).toBe('passed');
  });

  it('notes the two limits when the key gets a higher one', async () => {
    const run = await runStage({ server: ACCEPT_KEY, env: KEY_ENV });

    expect(run.check('S2.3').outcome).toBe('pass');
    expect(run.check('S2.3').note).toBe('limit 100 against 50 for the public tier');
  });

  it('skips S2 with the classification as the reason, and sends no key, when there is none', async () => {
    const run = await runStage({ env: { MCP_KEY_STATUS: 'ParameterNotFound' } });

    for (const id of ['S2.1', 'S2.2', 'S2.3']) {
      expectSkipped(run, id, 'no key configured: parameter not found');
    }
    expect(run.report.outcome).toBe('passed');
    expect(run.report.key.used).toBe(false);
    // Only S1 sends a key, and it is the made-up one
    const keyed = run.calls.filter((call) => call.headersLower['x-api-key']);
    expect(keyed).toHaveLength(1);
    expect(keyed[0].headersLower['x-api-key']).toBe('postdeploy-verify-invalid-key');
  });
});

/* ------------------------------------------------------------------ */
/*  X2 without an edge target                                         */
/* ------------------------------------------------------------------ */

describe('X2 without an edge target (Requirement 2.3)', () => {
  it('skips X2.1 to X2.4 with the documented reason and sends nothing to an edge', async () => {
    const run = await runStage({ edge: false });

    for (const id of ['X2.1', 'X2.2', 'X2.3', 'X2.4']) {
      expectSkipped(run, id, 'no custom domain for this stage');
    }
    expect(run.calls.filter((call) => call.target === 'edge')).toHaveLength(0);
    expect(run.report.targets.edge).toBeNull();
    expect(run.report.outcome).toBe('passed');
    expect(run.exitCode).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Extra revisions                                                   */
/* ------------------------------------------------------------------ */

describe('revisions beyond the floor', () => {
  it('sends one tools/list per extra revision, in the server order, and passes P5.9', async () => {
    const run = await runStage({ server: { extraRevisions: ['2027-01-01', '2028-02-02'] } });

    const extraCalls = run.calls.filter((call) =>
      ['2027-01-01', '2028-02-02'].includes(call.headersLower['mcp-protocol-version']));
    expect(extraCalls.map((call) => call.headersLower['mcp-protocol-version'])).toEqual(['2027-01-01', '2028-02-02']);
    for (const call of extraCalls) {
      expect(call.rpcMethod).toBe('tools/list');
      expect(call.target).toBe('raw');
    }

    expect(run.check('P5.9').outcome).toBe('pass');
    expect(run.check('P5.9').note).toBe('accepted ["2027-01-01","2028-02-02"]');
    // The extras are part of the advertised list, so P1.5 and P3.3 still pass
    expect(run.check('P1.5').outcome).toBe('pass');
    expect(run.check('P3.3').outcome).toBe('pass');
    expect(run.report.supportedVersions).toEqual(['2024-11-05', '2025-11-25', '2026-07-28', '2027-01-01', '2028-02-02']);
    expect(run.report.outcome).toBe('passed');
  });

  it('sends no extra request when the server advertises only the floor', async () => {
    const run = await runStage();

    const tools = run.calls.filter((call) => call.rpcMethod === 'tools/list' && call.target === 'raw');
    // P3a, P3b, P4a, P4d, P4e, and P5a to P5e
    expect(tools).toHaveLength(10);
    expect(run.report.supportedVersions).toEqual(['2024-11-05', '2025-11-25', '2026-07-28']);
  });
});
