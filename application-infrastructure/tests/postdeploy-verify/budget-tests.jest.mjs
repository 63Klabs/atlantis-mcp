/**
 * Request budget of the post-deploy Verifier on a healthy stage.
 *
 * Design sections 5, 7, and 11; Requirements 13.1, 13.4, and 16.4. A "counted"
 * request is a POST other than S1 (the invalid-key probe, answered 401 before the
 * rate limiter) and other than O1.1 (the request without the origin secret, which the
 * guard refuses with 401 before authentication and the rate limiter, Requirements 7.7
 * and 8.6). Preflights are OPTIONS and the 405 probes (M1.1, X2.5) are GETs;
 * API Gateway answers both before the rate limiter, so neither is counted. No real
 * network request is made.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createFakeMcpServer, FAKE_API_KEY, FAKE_ORIGIN_SECRET } from './helpers/fake-mcp-server.mjs';
import { runVerifier, guardRealFetch } from './helpers/run-verifier.mjs';

/** Expected counted POSTs without an edge target (design section 5). */
const COUNTED_NO_EDGE = 21;

/** Expected counted POSTs with an edge target (design section 5): the 21 plus X2b to X2d. */
const COUNTED_WITH_EDGE = 24;

/** Request order of the check families, by first request (design section 5). */
const FAMILY_ORDER = ['P1', 'S1', 'S2', 'P2', 'P3', 'P4', 'P5', 'P6', 'M1', 'T1', 'X1', 'X2'];

/** The same order on a protected stage, where O1 runs between M1 and T1. */
const FAMILY_ORDER_PROTECTED = ['P1', 'S1', 'S2', 'P2', 'P3', 'P4', 'P5', 'P6', 'M1', 'O1', 'T1', 'X1', 'X2'];

let restoreFetch;

beforeAll(() => {
  restoreFetch = guardRealFetch();
});

afterAll(() => {
  restoreFetch();
});

/**
 * Run the Verifier against a fresh healthy fake server.
 *
 * @param {Object} [settings] - Run settings
 * @param {boolean} [settings.hasEdge=false] - Pass an edge target (`MCP_EDGE_URL`)
 * @param {boolean} [settings.hasKey=false] - Store an accepted key (private tier)
 * @param {Array.<string>} [settings.extraRevisions=[]] - Extra revisions the server advertises
 * @param {boolean} [settings.isProtected=false] - The server guards the raw target and the run is told so
 * @returns {Promise.<{result: Object, server: Object}>} The run result and the server
 */
async function runHealthy({ hasEdge = false, hasKey = false, extraRevisions = [], isProtected = false } = {}) {
  const server = createFakeMcpServer({
    extraRevisions,
    validKeys: hasKey ? { [FAKE_API_KEY]: 'private' } : {},
    ...(isProtected ? { originSecret: FAKE_ORIGIN_SECRET } : {})
  });
  const env = { MCP_URL: server.rawUrl, EXPECTED_VERSION: '0.0.7' };
  if (isProtected) {
    env.MCP_ORIGIN_PROTECTION = 'true';
    env.MCP_ORIGIN_SECRET = FAKE_ORIGIN_SECRET;
  }
  if (hasEdge) {
    env.MCP_EDGE_URL = server.edgeUrl;
  }
  if (hasKey) {
    env.MCP_API_KEY = FAKE_API_KEY;
    env.MCP_KEY_STATUS = 'ok';
  }
  const result = await runVerifier({ command: 'run', env, server });
  return { result, server };
}

/**
 * Whether a call carried an API key header.
 *
 * @param {Object} call - A recorded fake-server call
 * @returns {boolean} True when `X-API-Key` or `Authorization` was sent
 */
function hasKeyHeader(call) {
  return call.headersLower['x-api-key'] !== undefined || call.headersLower.authorization !== undefined;
}

/**
 * Whether a call is O1.1's request: a POST the origin guard refused (it carried no origin secret).
 *
 * @param {Object} call - A recorded fake-server call
 * @returns {boolean} True for O1.1
 */
function isO1(call) {
  return call.method === 'POST' && call.guarded === true && call.status === 401;
}

/**
 * Whether a call is S1, the invalid-key probe (a POST rejected with 401 by the key check).
 *
 * @param {Object} call - A recorded fake-server call
 * @returns {boolean} True for S1
 */
function isS1(call) {
  return call.method === 'POST' && call.status === 401 && !isO1(call);
}

/**
 * The POSTs that count against a budget: every POST except S1 and O1.1.
 *
 * @param {Array.<Object>} calls - Recorded calls
 * @returns {Array.<Object>} The counted calls
 */
function countedPosts(calls) {
  return calls.filter((call) => call.method === 'POST' && !isS1(call) && !isO1(call));
}

/**
 * Map one call to the check family it belongs to, from its method, target, and headers.
 *
 * @param {Object} call - A recorded fake-server call
 * @param {number} position - Zero-based position among all calls
 * @param {boolean} hasKey - Whether the run had an accepted key
 * @returns {string} Family name from `FAMILY_ORDER`
 */
function familyOf(call, position, hasKey) {
  if (call.method === 'OPTIONS') {
    return call.target === 'edge' ? 'X2' : 'X1';
  }
  if (call.target === 'edge') {
    return 'X2';
  }
  if (call.method === 'GET') {
    return 'M1';
  }
  if (isO1(call)) {
    return 'O1';
  }
  if (position === 0) {
    return 'P1';
  }
  if (isS1(call)) {
    return 'S1';
  }
  if (call.rpcMethod === 'server/discover') {
    return 'P1';
  }
  const mcpName = call.headersLower['mcp-name'];
  const protocol = call.headersLower['mcp-protocol-version'];
  const metaVersion = call.json?.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
  if (hasKey && hasKeyHeader(call) && call.rpcMethod === 'initialize' && call.json?.params === undefined
      && position <= 3) {
    return 'S2';
  }
  if (call.rpcMethod === 'initialize') {
    return 'P2';
  }
  if (call.toolName === 'list_templates') {
    return 'T1';
  }
  if (call.headersLower['mcp-method'] !== undefined) {
    return 'P4';
  }
  if (call.rpcMethod === 'tools/call') {
    return 'P6';
  }
  if (protocol === '2099-01-01' || metaVersion === '2099-01-01') {
    return 'P3';
  }
  if (mcpName !== undefined) {
    return 'P4';
  }
  return 'P5';
}

/**
 * Collapse consecutive equal family names into one entry each.
 *
 * @param {Array.<string>} families - Family per call
 * @returns {Array.<string>} The families in order of first appearance of each run
 */
function collapse(families) {
  return families.filter((family, index) => index === 0 || family !== families[index - 1]);
}

describe('Verifier request budget on a healthy stage', () => {
  it('does not count O1.1: 21 counted POSTs without an edge target and 24 with one, on a protected stage', async () => {
    const withoutEdge = await runHealthy({ isProtected: true });
    const withEdge = await runHealthy({ isProtected: true, hasEdge: true });

    expect(withoutEdge.result.exitCode).toBe(0);
    expect(withEdge.result.exitCode).toBe(0);
    expect(countedPosts(withoutEdge.server.calls)).toHaveLength(COUNTED_NO_EDGE);
    expect(countedPosts(withEdge.server.calls)).toHaveLength(COUNTED_WITH_EDGE);
    // O1.1 sent exactly one more POST, refused with 401 by the guard, and S1 is the other 401
    for (const run of [withoutEdge, withEdge]) {
      expect(run.server.calls.filter(isO1)).toHaveLength(1);
      expect(run.server.calls.filter(isS1)).toHaveLength(1);
      expect(run.server.calls.filter((call) => call.method === 'POST')).toHaveLength(
        countedPosts(run.server.calls).length + 2
      );
    }
  });

  it('sends nothing for O1.1 on a stage that is not protected, so the totals are as before', async () => {
    const { server } = await runHealthy();

    expect(server.calls.filter(isO1)).toHaveLength(0);
    expect(server.calls.filter((call) => call.method === 'POST')).toHaveLength(COUNTED_NO_EDGE + 1);
  });

  it('uses no counted request of the public tier for O1.1: the guard answers before the rate limiter', async () => {
    const server = createFakeMcpServer({
      originSecret: FAKE_ORIGIN_SECRET,
      rateLimits: { public: { limitPerWindow: COUNTED_NO_EDGE, windowInMinutes: 60 } }
    });
    const result = await runVerifier({
      command: 'run',
      env: {
        MCP_URL: server.rawUrl,
        EXPECTED_VERSION: '0.0.7',
        MCP_ORIGIN_PROTECTION: 'true',
        MCP_ORIGIN_SECRET: FAKE_ORIGIN_SECRET
      },
      server
    });

    // A public limit of exactly 21 is enough: no request is answered 429
    expect(result.exitCode).toBe(0);
    expect(server.calls.some((call) => call.status === 429)).toBe(false);
  });

  it('sends the checks in the documented order with O1 between M1 and T1 on a protected stage', async () => {
    const { server } = await runHealthy({ isProtected: true, hasKey: true, hasEdge: true });
    const families = collapse(server.calls.map((call, position) => familyOf(call, position, true)));

    expect(families).toEqual(FAMILY_ORDER_PROTECTED);
    expect(server.stats.maxInFlight).toBeLessThanOrEqual(1);
  });

  it('sends 21 counted POSTs with no edge target and no key', async () => {
    const { result, server } = await runHealthy();

    expect(result.exitCode).toBe(0);
    expect(countedPosts(server.calls)).toHaveLength(COUNTED_NO_EDGE);
    // No key anywhere: every POST goes to the client IP, and S1 is the only 401
    expect(server.calls.filter((call) => call.method === 'POST' && hasKeyHeader(call) && !isS1(call))).toHaveLength(0);
  });

  it('sends 24 counted POSTs with an edge target and no key', async () => {
    const { result, server } = await runHealthy({ hasEdge: true });

    expect(result.exitCode).toBe(0);
    expect(countedPosts(server.calls)).toHaveLength(COUNTED_WITH_EDGE);
    expect(countedPosts(server.calls).filter((call) => call.target === 'edge')).toHaveLength(3);
  });

  it('does not count preflights: they are OPTIONS, and the edge adds one more', async () => {
    const withoutEdge = await runHealthy();
    const withEdge = await runHealthy({ hasEdge: true });

    expect(withoutEdge.server.calls.filter((call) => call.method === 'OPTIONS')).toHaveLength(1);
    expect(withEdge.server.calls.filter((call) => call.method === 'OPTIONS')).toHaveLength(2);
    expect(withoutEdge.server.calls.every((call) => ['POST', 'OPTIONS', 'GET'].includes(call.method))).toBe(true);
  });

  it('sends the 405 probes as GETs that are recorded as calls but never counted as POSTs', async () => {
    const withoutEdge = await runHealthy();
    const withEdge = await runHealthy({ hasEdge: true, hasKey: true });

    // M1.1 goes to the raw target; X2.5 goes to the edge
    const rawGets = withoutEdge.server.calls.filter((call) => call.method === 'GET');
    expect(rawGets).toHaveLength(1);
    expect(rawGets[0].target).toBe('raw');
    expect(rawGets[0].status).toBe(405);
    expect(countedPosts(withoutEdge.server.calls).some((call) => call.method === 'GET')).toBe(false);
    expect(withoutEdge.server.calls).toHaveLength(COUNTED_NO_EDGE + 1 + 1 + 1); // POSTs, S1, preflight, GET

    const gets = withEdge.server.calls.filter((call) => call.method === 'GET');
    expect(gets.map((call) => call.target)).toEqual(['raw', 'edge']);
    for (const call of gets) {
      expect(call.status).toBe(405);
      expect(hasKeyHeader(call)).toBe(false);
    }
    expect(countedPosts(withEdge.server.calls).some((call) => call.method === 'GET')).toBe(false);
  });

  it('sends exactly one POST without a key (P1) and 22 with it, with an accepted key and no edge target', async () => {
    const { result, server } = await runHealthy({ hasKey: true });

    expect(result.exitCode).toBe(0);
    const counted = countedPosts(server.calls);
    const unkeyed = counted.filter((call) => call.headersLower['x-api-key'] === undefined
      && call.headersLower.authorization === undefined);
    const keyed = counted.filter(hasKeyHeader);

    expect(unkeyed).toHaveLength(1);
    expect(unkeyed[0].rpcMethod).toBe('server/discover');
    expect(server.calls.indexOf(unkeyed[0])).toBe(0);
    expect(keyed).toHaveLength(22);
    // S2a uses X-API-Key and S2b uses a Bearer token
    expect(keyed[0].headersLower['x-api-key']).toBe(FAKE_API_KEY);
    expect(keyed[1].headersLower.authorization).toBe(`Bearer ${FAKE_API_KEY}`);
  });

  it('sends exactly one POST without a key (P1) and 25 with it, with an accepted key and an edge target', async () => {
    const { result, server } = await runHealthy({ hasKey: true, hasEdge: true });

    expect(result.exitCode).toBe(0);
    const counted = countedPosts(server.calls);
    expect(counted.filter((call) => !hasKeyHeader(call))).toHaveLength(1);
    expect(counted.filter(hasKeyHeader)).toHaveLength(25);
  });

  // With a key, the total is P1 (against the IP) plus 22 or 25 keyed requests: 23 or 26 POSTs
  it.each([
    ['no key, no edge target', {}, COUNTED_NO_EDGE],
    ['no key, edge target', { hasEdge: true }, COUNTED_WITH_EDGE],
    ['key, no edge target', { hasKey: true }, 1 + 22],
    ['key, edge target', { hasKey: true, hasEdge: true }, 1 + 25]
  ])('adds one counted POST for each extra revision (%s)', async (label, settings, baseCounted) => {
    const base = await runHealthy(settings);
    const one = await runHealthy({ ...settings, extraRevisions: ['2027-01-15'] });
    const two = await runHealthy({ ...settings, extraRevisions: ['2027-01-15', '2027-06-30'] });

    expect(countedPosts(base.server.calls)).toHaveLength(baseCounted);
    expect(countedPosts(one.server.calls)).toHaveLength(baseCounted + 1);
    expect(countedPosts(two.server.calls)).toHaveLength(baseCounted + 2);

    // Each extra revision is a keyed POST when there is a key, otherwise an unkeyed one
    const sentWithHeader = (run) => countedPosts(run.server.calls)
      .filter((call) => call.headersLower['mcp-protocol-version'] === '2027-01-15');
    expect(sentWithHeader(one)).toHaveLength(1);
    expect(hasKeyHeader(sentWithHeader(one)[0])).toBe(Boolean(settings.hasKey));
  });

  it('sends the checks in the documented order and never has two requests in flight', async () => {
    const { server } = await runHealthy({ hasKey: true, hasEdge: true });
    const families = collapse(server.calls.map((call, position) => familyOf(call, position, true)));

    expect(families).toEqual(FAMILY_ORDER);
    expect(server.stats.maxInFlight).toBeLessThanOrEqual(1);
    expect(server.stats.inFlight).toBe(0);
  });

  it('sends the checks in the documented order without a key or edge target', async () => {
    const { server } = await runHealthy();
    const families = collapse(server.calls.map((call, position) => familyOf(call, position, false)));

    // S2 is not run without a key, and X2 is not run without an edge target
    expect(families).toEqual(FAMILY_ORDER.filter((family) => family !== 'S2' && family !== 'X2'));
    expect(server.stats.maxInFlight).toBeLessThanOrEqual(1);
  });
});
