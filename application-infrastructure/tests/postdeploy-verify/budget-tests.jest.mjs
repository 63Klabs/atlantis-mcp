/**
 * Request budget of the post-deploy Verifier on a healthy stage.
 *
 * Design sections 5, 7, and 11; Requirements 13.1, 13.4, and 16.4. A "counted"
 * request is a POST other than S1 (the invalid-key probe, answered 401 before the
 * rate limiter). Preflights are OPTIONS and are answered by API Gateway, so they
 * are not counted. No real network request is made.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createFakeMcpServer, FAKE_API_KEY } from './helpers/fake-mcp-server.mjs';
import { runVerifier, guardRealFetch } from './helpers/run-verifier.mjs';

/** Expected counted POSTs without an edge target (design section 5). */
const COUNTED_NO_EDGE = 21;

/** Expected counted POSTs with an edge target (design section 5): the 21 plus X2b to X2d. */
const COUNTED_WITH_EDGE = 24;

/** Request order of the check families, by first request (design section 5). */
const FAMILY_ORDER = ['P1', 'S1', 'S2', 'P2', 'P3', 'P4', 'P5', 'P6', 'T1', 'X1', 'X2'];

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
 * @returns {Promise.<{result: Object, server: Object}>} The run result and the server
 */
async function runHealthy({ hasEdge = false, hasKey = false, extraRevisions = [] } = {}) {
  const server = createFakeMcpServer({
    extraRevisions,
    validKeys: hasKey ? { [FAKE_API_KEY]: 'private' } : {}
  });
  const env = { MCP_URL: server.rawUrl, EXPECTED_VERSION: '0.0.7' };
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
 * Whether a call is S1, the invalid-key probe (a POST rejected with 401).
 *
 * @param {Object} call - A recorded fake-server call
 * @returns {boolean} True for S1
 */
function isS1(call) {
  return call.method === 'POST' && call.status === 401;
}

/**
 * The POSTs that count against a budget: every POST except S1.
 *
 * @param {Array.<Object>} calls - Recorded calls
 * @returns {Array.<Object>} The counted calls
 */
function countedPosts(calls) {
  return calls.filter((call) => call.method === 'POST' && !isS1(call));
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
    expect(withoutEdge.server.calls.every((call) => call.method === 'POST' || call.method === 'OPTIONS')).toBe(true);
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
