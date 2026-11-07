/**
 * Self-test of the fake MCP server (helpers/fake-mcp-server.mjs).
 *
 * The check tests of the post-deploy verifier rest on this model, so this file pins
 * two things:
 *
 * 1. With no options, the model answers each method and revision with the response
 *    shapes documented in `docs/end-user/supported-protocol-revisions.md` and
 *    `docs/admin-ops/cors-and-response-headers.md`.
 * 2. Each option changes only the behavior it names; everything else stays the same
 *    as the healthy model.
 *
 * No network: the fake server never opens a socket, and the global `fetch` is replaced
 * with a function that throws.
 *
 * Validates: Requirement 16.4
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import {
  createFakeMcpServer,
  readCorsStanza,
  selectLegacyRevision,
  FAKE_API_KEY,
  SERVER_NAME,
  DEFAULT_VERSION,
  DEFAULT_RAW_URL,
  DEFAULT_EDGE_URL,
  DEFAULT_SUPPORTED_VERSIONS,
  DEFAULT_TOOL_NAMES,
  DEFAULT_RATE_LIMITS,
  TOOLS_LIST_TTL_MS
} from './helpers/fake-mcp-server.mjs';

// No real network: any accidental use of the global fetch fails loudly.
globalThis.fetch = () => {
  throw new Error('Real network access is not allowed in these tests');
};

const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';
const PROTOCOL_KEY = 'io.modelcontextprotocol/protocolVersion';

/** Fixed clock: 2026-10-01T12:30:00Z, so window resets are predictable. */
const FIXED_NOW_MS = Date.UTC(2026, 9, 1, 12, 30, 0);
const fixedNow = () => FIXED_NOW_MS;

/**
 * Build a JSON-RPC request object.
 *
 * @param {string} method - JSON-RPC method
 * @param {Object} [params] - Parameters
 * @param {number} [id=1] - Request id
 * @returns {Object} Request body
 */
function rpc(method, params, id = 1) {
  const body = { jsonrpc: '2.0', id, method };
  if (params !== undefined) {
    body.params = params;
  }
  return body;
}

/**
 * Send a POST to the fake server and parse the answer.
 *
 * @param {Object} server - Fake server
 * @param {Object|string} body - Request body (object is serialized)
 * @param {Object<string, string>} [headers] - Extra request headers
 * @param {string} [url] - Target (default: the raw URL)
 * @returns {Promise<{response: Response, status: number, json: (Object|null), text: string}>} Answer
 */
async function post(server, body, headers = {}, url = server.rawUrl) {
  const response = await server.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await response.text();
  return { response, status: response.status, json: text ? JSON.parse(text) : null, text };
}

/**
 * Send a CORS preflight to the fake server.
 *
 * @param {Object} server - Fake server
 * @param {string} [url] - Target (default: the raw URL)
 * @returns {Promise<Response>} Preflight response
 */
function preflight(server, url = server.rawUrl) {
  return server.fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://client.example.org',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,mcp-protocol-version'
    }
  });
}

/**
 * Await a promise that must reject and return the rejection.
 *
 * @param {Promise<*>} promise - Promise expected to reject
 * @returns {Promise<*>} The rejection reason
 */
async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

/**
 * Run a fixed set of requests and record status and body of each.
 *
 * @param {Object} server - Fake server
 * @returns {Promise<Array<{status: number, text: string}>>} One entry per request
 */
async function transcript(server) {
  const out = [];
  const record = async (promise) => {
    const result = await promise;
    out.push({ status: result.status, text: result.text });
  };
  await record(post(server, rpc('server/discover', undefined, 1)));
  await record(post(server, rpc('tools/list', undefined, 2), { 'MCP-Protocol-Version': '2026-07-28' }));
  await record(post(server, rpc('tools/call', { name: 'list_tools' }, 3), { 'MCP-Protocol-Version': '2025-11-25' }));
  const optionsResponse = await preflight(server);
  out.push({ status: optionsResponse.status, text: JSON.stringify([...optionsResponse.headers.entries()]) });
  return out;
}

const healthy = (extra = {}) => createFakeMcpServer({ now: fixedNow, ...extra });

describe('Fake MCP server: construction', () => {
  it('returns fetch, calls, both targets, and counters', () => {
    const server = healthy();
    expect(typeof server.fetch).toBe('function');
    expect(server.calls).toEqual([]);
    expect(server.rawUrl).toBe(DEFAULT_RAW_URL);
    expect(server.edgeUrl).toBe(DEFAULT_EDGE_URL);
    expect(server.stats).toEqual({ inFlight: 0, maxInFlight: 0 });
  });

  it('accepts custom targets', async () => {
    const server = healthy({
      rawUrl: 'https://raw.example.test/stage/mcp/v1',
      edgeUrl: 'https://edge.example.test/mcp/v1'
    });
    expect((await post(server, rpc('server/discover'))).status).toBe(200);
    expect((await post(server, rpc('server/discover'), {}, server.edgeUrl)).status).toBe(200);
  });

  it('exports a well-formed fake key built at run time', () => {
    expect(FAKE_API_KEY).toMatch(/^atl_[0-9a-f]{32}$/);
  });
});

describe('Fake MCP server: server/discover', () => {
  it('answers the modern envelope with revisions, capabilities, and instructions', async () => {
    const { status, json, response } = await post(healthy(), rpc('server/discover'));
    expect(status).toBe(200);
    expect(json.jsonrpc).toBe('2.0');
    expect(json.id).toBe(1);
    expect(json.error).toBeUndefined();
    expect(json.result.supportedVersions).toEqual([...DEFAULT_SUPPORTED_VERSIONS]);
    expect(json.result.supportedVersions).toEqual(['2024-11-05', '2025-11-25', '2026-07-28']);
    expect(json.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(typeof json.result.instructions).toBe('string');
    expect(json.result.instructions.length).toBeGreaterThan(0);
    // Literals on purpose: the fake models the specification, not the Read Function.
    expect(json.result.ttlMs).toBe(600000);
    expect(json.result.cacheScope).toBe('public');
    expect(json.result.resultType).toBe('complete');
    expect(json.result._meta[SERVER_INFO_KEY]).toEqual({ name: SERVER_NAME, version: DEFAULT_VERSION });
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('is never rejected for an unlisted declared revision', async () => {
    const { json } = await post(healthy(), rpc('server/discover'), { 'MCP-Protocol-Version': '2099-01-01' });
    expect(json.error).toBeUndefined();
    expect(json.result.supportedVersions).toContain('2026-07-28');
  });

  it('answers without a key and without any prior request', async () => {
    const server = healthy({ validKeys: { [FAKE_API_KEY]: 'private' } });
    const { status, json } = await post(server, rpc('server/discover'));
    expect(status).toBe(200);
    expect(json.result.resultType).toBe('complete');
    expect(server.calls).toHaveLength(1);
  });
});

describe('Fake MCP server: initialize', () => {
  it('echoes a supported legacy revision and carries instructions and serverInfo', async () => {
    for (const revision of ['2024-11-05', '2025-11-25']) {
      const { json } = await post(healthy(), rpc('initialize', { protocolVersion: revision }));
      expect(json.result.protocolVersion).toBe(revision);
      expect(json.result.serverInfo).toEqual({ name: SERVER_NAME, version: DEFAULT_VERSION });
      expect(json.result.capabilities).toEqual({ tools: { listChanged: false } });
      expect(typeof json.result.instructions).toBe('string');
      expect(json.result.resultType).toBeUndefined();
      expect(json.result._meta).toBeUndefined();
    }
  });

  it('counter-offers the highest legacy revision not newer than an in-between request', async () => {
    const { json } = await post(healthy(), rpc('initialize', { protocolVersion: '2025-06-18' }));
    expect(json.result.protocolVersion).toBe('2024-11-05');
  });

  it('counter-offers 2025-11-25 when the request is newer than every legacy revision', async () => {
    const { json } = await post(healthy(), rpc('initialize', { protocolVersion: '2099-01-01' }));
    expect(json.result.protocolVersion).toBe('2025-11-25');
  });

  it('counter-offers the highest legacy revision when none is requested', async () => {
    const { json } = await post(healthy(), rpc('initialize', {}));
    expect(json.result.protocolVersion).toBe('2025-11-25');
  });

  it('selectLegacyRevision applies the same rule directly', () => {
    expect(selectLegacyRevision('2024-11-05')).toBe('2024-11-05');
    expect(selectLegacyRevision('2024-01-01')).toBe('2025-11-25');
    expect(selectLegacyRevision('2025-06-18')).toBe('2024-11-05');
    expect(selectLegacyRevision('2099-01-01')).toBe('2025-11-25');
    expect(selectLegacyRevision(undefined)).toBe('2025-11-25');
    expect(selectLegacyRevision('')).toBe('2025-11-25');
  });
});

describe('Fake MCP server: tools/list by revision', () => {
  it('a request declaring nothing is legacy and carries the baseline tool fields only', async () => {
    const { json } = await post(healthy(), rpc('tools/list'));
    expect(json.error).toBeUndefined();
    expect(Object.keys(json.result)).toEqual(['tools']);
    expect(json.result.tools.map((tool) => tool.name)).toEqual([...DEFAULT_TOOL_NAMES]);
    for (const tool of json.result.tools) {
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toEqual({ type: 'object', properties: {} });
      expect(tool.title).toBeUndefined();
      expect(tool.annotations).toBeUndefined();
    }
  });

  it('2024-11-05 carries only tools, with baseline tool fields', async () => {
    const { json } = await post(healthy(), rpc('tools/list'), { 'MCP-Protocol-Version': '2024-11-05' });
    expect(Object.keys(json.result)).toEqual(['tools']);
    expect(json.result.tools.every((tool) => tool.title === undefined && tool.annotations === undefined)).toBe(true);
  });

  it('2025-11-25 carries only tools, with title and annotations on every tool', async () => {
    const { json } = await post(healthy(), rpc('tools/list'), { 'MCP-Protocol-Version': '2025-11-25' });
    expect(Object.keys(json.result)).toEqual(['tools']);
    for (const tool of json.result.tools) {
      expect(typeof tool.title).toBe('string');
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    }
  });

  it('2026-07-28 by header is a modern cacheable result', async () => {
    const { json } = await post(healthy(), rpc('tools/list'), { 'MCP-Protocol-Version': '2026-07-28' });
    expect(json.result.resultType).toBe('complete');
    expect(json.result.ttlMs).toBe(TOOLS_LIST_TTL_MS);
    expect(json.result.ttlMs).toBe(600000);
    expect(json.result.cacheScope).toBe('public');
    expect(json.result._meta[SERVER_INFO_KEY].name).toBe(SERVER_NAME);
    expect(json.result.tools.length).toBe(DEFAULT_TOOL_NAMES.length);
    expect(json.result.tools.every((tool) => typeof tool.title === 'string' && tool.annotations)).toBe(true);
  });

  it('2026-07-28 by params._meta is a modern cacheable result', async () => {
    const { json } = await post(healthy(), rpc('tools/list', { _meta: { [PROTOCOL_KEY]: '2026-07-28' } }));
    expect(json.result.resultType).toBe('complete');
    expect(json.result.ttlMs).toBe(600000);
    expect(json.result.cacheScope).toBe('public');
    expect(json.result._meta[SERVER_INFO_KEY].version).toBe(DEFAULT_VERSION);
  });

  it('2026-07-28 by a top-level _meta is accepted too', async () => {
    const body = { ...rpc('tools/list'), _meta: { [PROTOCOL_KEY]: '2026-07-28' } };
    const { json } = await post(healthy(), body);
    expect(json.result.resultType).toBe('complete');
  });

  it('2025-11-25 by params._meta carries titles and no modern fields', async () => {
    const { json } = await post(healthy(), rpc('tools/list', { _meta: { [PROTOCOL_KEY]: '2025-11-25' } }));
    expect(json.result.ttlMs).toBeUndefined();
    expect(json.result.tools[0].title).toBeDefined();
  });

  it('the header wins over _meta when both are present', async () => {
    const { json } = await post(
      healthy(),
      rpc('tools/list', { _meta: { [PROTOCOL_KEY]: '2026-07-28' } }),
      { 'MCP-Protocol-Version': '2024-11-05' }
    );
    expect(json.result.ttlMs).toBeUndefined();
    expect(json.result.tools[0].title).toBeUndefined();
  });

  it('a blank header counts as not declared', async () => {
    const { json } = await post(
      healthy(),
      rpc('tools/list', { _meta: { [PROTOCOL_KEY]: '2026-07-28' } }),
      { 'MCP-Protocol-Version': '   ' }
    );
    expect(json.result.resultType).toBe('complete');
    const { json: bare } = await post(healthy(), rpc('tools/list'), { 'MCP-Protocol-Version': '   ' });
    expect(Object.keys(bare.result)).toEqual(['tools']);
  });

  it('reads the header name without regard to case', async () => {
    const { json } = await post(healthy(), rpc('tools/list'), { 'mcp-protocol-version': '2026-07-28' });
    expect(json.result.resultType).toBe('complete');
  });
});

describe('Fake MCP server: -32022 unsupported protocol version', () => {
  it('answers HTTP 400 on every method except server/discover, with the requested and supported revisions', async () => {
    const methods = [
      rpc('tools/list'),
      rpc('tools/call', { name: 'list_tools' }),
      rpc('initialize', { protocolVersion: '2025-11-25' }),
      rpc('ping')
    ];
    for (const body of methods) {
      const { status, json } = await post(healthy(), body, { 'MCP-Protocol-Version': '2099-01-01' });
      expect(status).toBe(400);
      expect(json.error.code).toBe(-32022);
      expect(json.error.message).toBe('Unsupported protocol version');
      expect(json.error.data.requested).toBe('2099-01-01');
      expect(json.error.data.supported).toEqual(['2024-11-05', '2025-11-25', '2026-07-28']);
      expect(json.error.data.declaredRevision).toBeUndefined();
      expect(json.error.data.supportedVersions).toBeUndefined();
      expect(json.result).toBeUndefined();
    }
  });

  it('is raised for an unlisted revision declared in params._meta', async () => {
    const { status, json } = await post(healthy(), rpc('tools/list', { _meta: { [PROTOCOL_KEY]: '2030-01-01' } }));
    expect(status).toBe(400);
    expect(json.error.code).toBe(-32022);
    expect(json.error.data.requested).toBe('2030-01-01');
  });

  it('is answered with HTTP 400 on the edge target too, when the edge forwards the headers', async () => {
    const server = healthy();
    const { status, json } = await post(server, rpc('tools/list'), { 'MCP-Protocol-Version': '2099-01-01' }, server.edgeUrl);
    expect(status).toBe(400);
    expect(json.error.code).toBe(-32022);
    expect(json.error.data.requested).toBe('2099-01-01');
  });

  it('server/discover with an unlisted declared revision is still answered with HTTP 200', async () => {
    const { status, json } = await post(healthy(), rpc('server/discover'), { 'MCP-Protocol-Version': '2099-01-01' });
    expect(status).toBe(200);
    expect(json.error).toBeUndefined();
  });
});

describe('Fake MCP server: -32020 header mismatch', () => {
  const modern = { 'MCP-Protocol-Version': '2026-07-28' };

  it('rejects a modern request whose Mcp-Method disagrees with the body', async () => {
    const { status, json } = await post(healthy(), rpc('tools/list'), { ...modern, 'Mcp-Method': 'tools/call' });
    expect(status).toBe(400);
    expect(json.error.code).toBe(-32020);
    expect(json.error.message).toBe('Header mismatch');
    expect(json.error.data.headerValue).toBe('tools/call');
    expect(json.error.data.bodyValue).toBe('tools/list');
  });

  it('answers HTTP 400 on the edge target too, when the edge forwards the headers', async () => {
    const server = healthy();
    const { status, json } = await post(server, rpc('tools/list'), { ...modern, 'Mcp-Method': 'tools/call' }, server.edgeUrl);
    expect(status).toBe(400);
    expect(json.error.code).toBe(-32020);
  });

  it('rejects a modern tools/call whose Mcp-Name disagrees with params.name', async () => {
    const { status, json } = await post(
      healthy(),
      rpc('tools/call', { name: 'list_tools' }),
      { ...modern, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'list_categories' }
    );
    expect(status).toBe(400);
    expect(json.error.code).toBe(-32020);
    expect(json.error.data.headerValue).toBe('list_categories');
    expect(json.error.data.bodyValue).toBe('list_tools');
  });

  it('accepts matching Mcp-Method and Mcp-Name on a modern request', async () => {
    const { json } = await post(
      healthy(),
      rpc('tools/call', { name: 'list_tools' }),
      { ...modern, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'list_tools' }
    );
    expect(json.error).toBeUndefined();
    expect(json.result.resultType).toBe('complete');
  });

  it('rejects a mismatch declared by params._meta as well', async () => {
    const { status, json } = await post(
      healthy(),
      rpc('tools/list', { _meta: { [PROTOCOL_KEY]: '2026-07-28' } }),
      { 'Mcp-Method': 'tools/call' }
    );
    expect(status).toBe(400);
    expect(json.error.code).toBe(-32020);
  });

  it('a legacy request ignores mismatched Mcp-* headers', async () => {
    for (const legacy of [{}, { 'MCP-Protocol-Version': '2025-11-25' }, { 'MCP-Protocol-Version': '2024-11-05' }]) {
      const { json } = await post(healthy(), rpc('tools/list'), { ...legacy, 'Mcp-Method': 'tools/call', 'Mcp-Name': 'x' });
      expect(json.error).toBeUndefined();
      expect(json.result.tools.length).toBeGreaterThan(0);
    }
  });

  it('server/discover is modern, so a mismatched Mcp-Method is rejected there', async () => {
    const { status, json } = await post(healthy(), rpc('server/discover'), { 'Mcp-Method': 'tools/list' });
    expect(status).toBe(400);
    expect(json.error.code).toBe(-32020);
  });
});

describe('Fake MCP server: tools/call', () => {
  it('list_tools succeeds on a legacy request with a bare result', async () => {
    const { json } = await post(healthy(), rpc('tools/call', { name: 'list_tools' }));
    expect(json.error).toBeUndefined();
    expect(Object.keys(json.result)).toEqual(['content']);
    expect(json.result.content[0].type).toBe('text');
    const payload = JSON.parse(json.result.content[0].text);
    expect(payload.tools.map((tool) => tool.name)).toEqual([...DEFAULT_TOOL_NAMES]);
  });

  it('list_tools on a modern request carries the modern envelope', async () => {
    const { json } = await post(healthy(), rpc('tools/call', { name: 'list_tools' }), { 'MCP-Protocol-Version': '2026-07-28' });
    expect(json.result.resultType).toBe('complete');
    expect(json.result._meta[SERVER_INFO_KEY]).toEqual({ name: SERVER_NAME, version: DEFAULT_VERSION });
    expect(json.result.content).toHaveLength(1);
  });

  it('list_categories and list_templates return non-empty data', async () => {
    const server = healthy();
    const categories = JSON.parse((await post(server, rpc('tools/call', { name: 'list_categories' }))).json.result.content[0].text);
    expect(categories.categories.length).toBeGreaterThan(0);
    const templates = JSON.parse((await post(server, rpc('tools/call', { name: 'list_templates' }))).json.result.content[0].text);
    expect(templates.templates.length).toBeGreaterThan(0);
  });

  it('an unknown tool is -32601 and a missing name is -32602', async () => {
    const unknown = await post(healthy(), rpc('tools/call', { name: 'no_such_tool' }));
    expect(unknown.json.error.code).toBe(-32601);
    const missing = await post(healthy(), rpc('tools/call', {}));
    expect(missing.json.error.code).toBe(-32602);
  });
});

describe('Fake MCP server: request errors', () => {
  it('an unknown method is -32601', async () => {
    const { status, json } = await post(healthy(), rpc('resources/list'));
    expect(status).toBe(200);
    expect(json.error.code).toBe(-32601);
    expect(json.id).toBe(1);
  });

  it('a body that is not JSON is -32700 with no id member', async () => {
    const { json } = await post(healthy(), '{not json');
    expect(json.error.code).toBe(-32700);
    expect(json).not.toHaveProperty('id');
  });

  it('a body without jsonrpc 2.0 or a method is -32600', async () => {
    const noVersion = await post(healthy(), { id: 7, method: 'tools/list' });
    expect(noVersion.json.error.code).toBe(-32600);
    expect(noVersion.json.id).toBe(7);
    const noMethod = await post(healthy(), { jsonrpc: '2.0', id: 8 });
    expect(noMethod.json.error.code).toBe(-32600);
  });

  it('a non-object body is -32603', async () => {
    const { json } = await post(healthy(), 'null');
    expect(json.error.code).toBe(-32603);
  });

  it('an unknown path, with any method, gets 400 and the unsupported-path message', async () => {
    // The status, Allow value, and messages are literals on purpose: the fake restates the
    // contract, so a change to the Lambda code cannot hide behind the same change here.
    const server = healthy();
    for (const url of [server.rawUrl, server.edgeUrl]) {
      const wrongPath = await server.fetch(`${url}/nope`, { method: 'POST', body: JSON.stringify(rpc('tools/list')) });
      expect(wrongPath.status).toBe(400);
      expect(wrongPath.headers.get('content-type')).toContain('application/json');
      expect((await wrongPath.json()).message).toBe('Unsupported path or method for this API.');

      for (const method of ['GET', 'PUT', 'DELETE']) {
        const other = await server.fetch(`${url}/nope`, { method });
        expect(other.status).toBe(400);
        expect((await other.json()).message).toBe('Unsupported path or method for this API.');
      }
    }
  });

  it('a host that is neither target does not resolve', async () => {
    const server = healthy();
    const error = await rejection(server.fetch('https://unknown.example.test/mcp/v1', { method: 'POST', body: '{}' }));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('fetch failed');
    expect(error.cause.code).toBe('ENOTFOUND');
  });

  it('an already-aborted signal rejects before the stage answers', async () => {
    const server = healthy();
    const controller = new AbortController();
    controller.abort();
    const error = await rejection(server.fetch(server.rawUrl, { method: 'POST', body: '{}', signal: controller.signal }));
    expect(['AbortError']).toContain(error.name);
    expect(server.calls[0].outcome).toBe('aborted');
  });
});

describe('Fake MCP server: unsupported methods on the endpoint path', () => {
  // Literals on purpose (see the unknown-path case above): the fake restates the contract.
  const UNSUPPORTED_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'];
  const MESSAGE = 'Method not allowed. This endpoint accepts POST only.';
  const TARGETS = [['raw', 'rawUrl'], ['edge', 'edgeUrl']];

  /**
   * Send a request with no body and read the answer.
   *
   * @param {Object} server - Fake server
   * @param {string} url - Target URL
   * @param {string} method - HTTP method
   * @returns {Promise<{response: Response, text: string}>} The answer and its body text
   */
  async function send(server, url, method) {
    const response = await server.fetch(url, { method });
    return { response, text: await response.text() };
  }

  it.each(TARGETS)('%s target: GET, HEAD, PUT, PATCH, and DELETE get 405 with Allow: POST and a JSON message', async (_name, urlKey) => {
    const server = healthy();
    for (const method of UNSUPPORTED_METHODS) {
      const { response, text } = await send(server, server[urlKey], method);
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('cache-control')).toBe('no-store');
      if (method === 'HEAD') {
        expect(text).toBe('');
      } else {
        const body = JSON.parse(text);
        expect(typeof body.message).toBe('string');
        expect(body.message.length).toBeGreaterThan(0);
        expect(body.message).toBe(MESSAGE);
      }
    }
  });

  it.each(TARGETS)('%s target: GET and DELETE with Content-Type text/plain get the same 405 (task 14.2)', async (_name, urlKey) => {
    // The deployed mock answered these with a 500 until it had a request template for text/plain.
    const server = healthy();
    for (const method of ['GET', 'DELETE']) {
      const response = await server.fetch(server[urlKey], { method, headers: { 'Content-Type': 'text/plain' }, ...(method === 'DELETE' ? { body: 'x' } : {}) });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(await response.text()).message).toBe(MESSAGE);
    }
  });
  it('POST and OPTIONS on the endpoint path are not answered as 405', async () => {
    const server = healthy();
    const { status } = await post(server, rpc('tools/list'));
    expect(status).toBe(200);
    expect((await preflight(server)).status).not.toBe(405);
  });

  describe.each([
    ['methodNotAllowed', 'raw', 'rawUrl', 'edge', 'edgeUrl'],
    ['edgeMethodNotAllowed', 'edge', 'edgeUrl', 'raw', 'rawUrl']
  ])('option %s (%s target)', (option, _name, faultedKey, _otherName, otherKey) => {
    const faulted = (fault) => healthy({ [option]: { fault } });

    it('html: HTTP 200, text/html, an HTML page', async () => {
      const server = faulted('html');
      const { response, text } = await send(server, server[faultedKey], 'GET');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html');
      expect(text).toContain('<html');
      expect(response.headers.get('allow')).toBeNull();
      const head = await send(server, server[faultedKey], 'HEAD');
      expect(head.response.status).toBe(200);
      expect(head.text).toBe('');
    });

    it('no-allow: 405 without Allow, still a JSON message', async () => {
      const server = faulted('no-allow');
      const { response, text } = await send(server, server[faultedKey], 'GET');
      expect(response.status).toBe(405);
      expect(response.headers.has('allow')).toBe(false);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(text).message).toBe(MESSAGE);
    });

    it('not-json: 405 with Allow: POST and a text/plain body', async () => {
      const server = faulted('not-json');
      const { response, text } = await send(server, server[faultedKey], 'GET');
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expect(response.headers.get('content-type')).toBe('text/plain');
      expect(text).toBe(MESSAGE);
      expect(() => JSON.parse(text)).toThrow();
    });

    it('gateway-403: HTTP 403 with the Missing Authentication Token message', async () => {
      const server = faulted('gateway-403');
      const { response, text } = await send(server, server[faultedKey], 'GET');
      expect(response.status).toBe(403);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(JSON.parse(text)).toEqual({ message: 'Missing Authentication Token' });
    });

    it.each(['html', 'no-allow', 'not-json', 'gateway-403'])('%s affects only its own target and leaves POST alone', async (fault) => {
      const server = faulted(fault);
      const other = await send(server, server[otherKey], 'GET');
      expect(other.response.status).toBe(405);
      expect(other.response.headers.get('allow')).toBe('POST');
      expect(other.response.headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(other.text).message).toBe(MESSAGE);

      const answer = await post(server, rpc('tools/list'), {}, server[faultedKey]);
      expect(answer.status).toBe(200);
      expect(answer.json.result.tools.length).toBeGreaterThan(0);
    });
  });
});

describe('Fake MCP server: CORS preflight', () => {
  it('answers from the template Cors stanza', async () => {
    const stanza = readCorsStanza();
    const response = await preflight(healthy());
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(stanza.allowOrigin);
    expect(response.headers.get('access-control-allow-methods')).toBe(stanza.allowMethods);
    expect(response.headers.get('access-control-allow-headers')).toBe(stanza.allowHeaders);
    expect(response.headers.get('access-control-max-age')).toBe(stanza.maxAge);
  });

  it('agrees with the template file itself', () => {
    const templateText = readFileSync(new URL('../../template.yml', import.meta.url), 'utf8');
    const stanza = readCorsStanza();
    expect(templateText).toContain(`AllowHeaders: "'${stanza.allowHeaders}'"`);
    expect(templateText).toContain(`AllowMethods: "'${stanza.allowMethods}'"`);
    expect(stanza.allowOrigin).toBe('*');
    expect(stanza.allowMethods).toBe('POST,OPTIONS');
    expect(stanza.maxAge).toBe('86400');
  });

  it('allows the three MCP request headers', async () => {
    const allowed = (await preflight(healthy())).headers.get('access-control-allow-headers').toLowerCase().split(',');
    expect(allowed).toEqual(expect.arrayContaining(['mcp-protocol-version', 'mcp-method', 'mcp-name']));
  });

  it('does not require a key and sends no body', async () => {
    const server = healthy({ validKeys: { [FAKE_API_KEY]: 'private' } });
    const response = await preflight(server);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('the edge answers the preflight too', async () => {
    const server = healthy();
    const response = await preflight(server, server.edgeUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('a POST answer carries the wildcard origin and the version header', async () => {
    const { response } = await post(healthy(), rpc('tools/list'));
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-mcp-version')).toBe('1.0');
  });
});

describe('Fake MCP server: API keys and tiers', () => {
  const validKeys = { [FAKE_API_KEY]: 'private', [`atl_${'f'.repeat(32)}`]: 'paid' };

  it('serves without a key at the public tier, 50 per hour', async () => {
    const { response } = await post(healthy({ validKeys }), rpc('tools/list'));
    expect(response.headers.get('x-ratelimit-limit')).toBe('50');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('49');
    const expectedReset = (Math.floor(FIXED_NOW_MS / 3600000) + 1) * 3600;
    expect(response.headers.get('x-ratelimit-reset')).toBe(String(expectedReset));
    expect(response.headers.get('x-mcp-auth-status')).toBeNull();
  });

  it('serves a valid private key at 6000 per day', async () => {
    const { response, status } = await post(healthy({ validKeys }), rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY });
    expect(status).toBe(200);
    expect(response.headers.get('x-ratelimit-limit')).toBe('6000');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('5999');
    const dayMs = 24 * 3600 * 1000;
    expect(response.headers.get('x-ratelimit-reset')).toBe(String((Math.floor(FIXED_NOW_MS / dayMs) + 1) * 86400));
  });

  it('serves a valid paid key at 3000 per day', async () => {
    const { response } = await post(healthy({ validKeys }), rpc('tools/list'), { 'X-API-Key': `atl_${'f'.repeat(32)}` });
    expect(response.headers.get('x-ratelimit-limit')).toBe('3000');
  });

  it('accepts the key as a Bearer token', async () => {
    const { response } = await post(healthy({ validKeys }), rpc('tools/list'), { Authorization: `Bearer ${FAKE_API_KEY}` });
    expect(response.headers.get('x-ratelimit-limit')).toBe('6000');
  });

  it('rejects an unknown key with HTTP 401 and -32001', async () => {
    const { status, json } = await post(healthy({ validKeys }), rpc('tools/list'), { 'X-API-Key': 'atl_unknown' });
    expect(status).toBe(401);
    expect(json.error.code).toBe(-32001);
    expect(json).not.toHaveProperty('id');
  });

  it('rejects any key when validKeys is empty', async () => {
    const { status } = await post(healthy(), rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY });
    expect(status).toBe(401);
  });

  it('a rejected key is answered before the rate limiter and costs nothing', async () => {
    const server = healthy({ validKeys, rateLimits: { public: { limitPerWindow: 1, windowInMinutes: 60 } } });
    await post(server, rpc('tools/list'), { 'X-API-Key': 'atl_unknown' });
    await post(server, rpc('tools/list'), { 'X-API-Key': 'atl_unknown' });
    const first = await post(server, rpc('tools/list'));
    expect(first.status).toBe(200);
  });

  it('counts remaining down per identity', async () => {
    const server = healthy({ validKeys });
    const a = await post(server, rpc('tools/list'));
    const b = await post(server, rpc('tools/list'));
    const keyed = await post(server, rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY });
    expect(a.response.headers.get('x-ratelimit-remaining')).toBe('49');
    expect(b.response.headers.get('x-ratelimit-remaining')).toBe('48');
    expect(keyed.response.headers.get('x-ratelimit-remaining')).toBe('5999');
  });

  it('the default limits match the documented tiers', () => {
    expect(DEFAULT_RATE_LIMITS.public.limitPerWindow).toBe(50);
    expect(DEFAULT_RATE_LIMITS.registered.limitPerWindow).toBe(100);
    expect(DEFAULT_RATE_LIMITS.paid.limitPerWindow).toBe(3000);
    expect(DEFAULT_RATE_LIMITS.private.limitPerWindow).toBe(6000);
  });

  it('rateLimits replaces the limits for the named tier only', async () => {
    const server = healthy({ validKeys, rateLimits: { public: { limitPerWindow: 2, windowInMinutes: 60 } } });
    const publicAnswer = await post(server, rpc('tools/list'));
    expect(publicAnswer.response.headers.get('x-ratelimit-limit')).toBe('2');
    const keyed = await post(server, rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY });
    expect(keyed.response.headers.get('x-ratelimit-limit')).toBe('6000');
  });

  it('exhausting the window answers 429 with Retry-After and a reset in the future', async () => {
    const server = healthy({ rateLimits: { public: { limitPerWindow: 2, windowInMinutes: 60 } } });
    await post(server, rpc('tools/list'));
    await post(server, rpc('tools/list'));
    const { status, response, json } = await post(server, rpc('tools/list'));
    expect(status).toBe(429);
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    expect(reset).toBeGreaterThan(FIXED_NOW_MS / 1000);
    expect(Number(response.headers.get('retry-after'))).toBe(Math.ceil(reset - FIXED_NOW_MS / 1000));
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(json.error).toBe('Too Many Requests');
  });

  it('the usage window rolls over with the clock', async () => {
    let currentMs = FIXED_NOW_MS;
    const server = createFakeMcpServer({
      now: () => currentMs,
      rateLimits: { public: { limitPerWindow: 1, windowInMinutes: 60 } }
    });
    expect((await post(server, rpc('tools/list'))).status).toBe(200);
    expect((await post(server, rpc('tools/list'))).status).toBe(429);
    currentMs += 3600 * 1000;
    expect((await post(server, rpc('tools/list'))).status).toBe(200);
  });
});

describe('Fake MCP server: option degradedAuth', () => {
  const validKeys = { [FAKE_API_KEY]: 'private' };

  it('serves a keyed request at the public tier with the degraded header', async () => {
    const { response, status, json } = await post(healthy({ validKeys, degradedAuth: true }), rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY });
    expect(status).toBe(200);
    expect(response.headers.get('x-mcp-auth-status')).toBe('degraded');
    expect(response.headers.get('x-ratelimit-limit')).toBe('50');
    expect(json.result.tools.length).toBeGreaterThan(0);
  });

  it('does not reject an unknown key', async () => {
    const { status, response } = await post(healthy({ degradedAuth: true }), rpc('tools/list'), { 'X-API-Key': 'atl_unknown' });
    expect(status).toBe(200);
    expect(response.headers.get('x-mcp-auth-status')).toBe('degraded');
  });

  it('leaves a request without a key untouched', async () => {
    const { response } = await post(healthy({ validKeys, degradedAuth: true }), rpc('tools/list'));
    expect(response.headers.get('x-mcp-auth-status')).toBeNull();
    expect(response.headers.get('x-ratelimit-limit')).toBe('50');
  });

  it('honors select and times', async () => {
    const server = healthy({ validKeys, degradedAuth: { times: 1 } });
    const first = await post(server, rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY });
    const second = await post(server, rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY });
    expect(first.response.headers.get('x-mcp-auth-status')).toBe('degraded');
    expect(second.response.headers.get('x-mcp-auth-status')).toBeNull();
    expect(second.response.headers.get('x-ratelimit-limit')).toBe('6000');
  });
});

describe('Fake MCP server: identity options', () => {
  it('version changes only the reported version', async () => {
    const stale = await post(healthy({ version: '0.0.6' }), rpc('server/discover'));
    expect(stale.json.result._meta[SERVER_INFO_KEY]).toEqual({ name: SERVER_NAME, version: '0.0.6' });
    const base = await post(healthy(), rpc('server/discover'));
    const staleCopy = JSON.parse(JSON.stringify(stale.json));
    staleCopy.result._meta[SERVER_INFO_KEY].version = DEFAULT_VERSION;
    expect(staleCopy).toEqual(base.json);
    const init = await post(healthy({ version: '0.0.6' }), rpc('initialize', { protocolVersion: '2025-11-25' }));
    expect(init.json.result.serverInfo.version).toBe('0.0.6');
  });

  it('serverName changes the reported name', async () => {
    const { json } = await post(healthy({ serverName: 'other-server' }), rpc('server/discover'));
    expect(json.result._meta[SERVER_INFO_KEY].name).toBe('other-server');
  });

  it('instructions replaces the instructions string on discover and initialize', async () => {
    const server = healthy({ instructions: 'Custom text' });
    expect((await post(server, rpc('server/discover'))).json.result.instructions).toBe('Custom text');
    expect((await post(server, rpc('initialize', { protocolVersion: '2025-11-25' }))).json.result.instructions).toBe('Custom text');
  });

  it('supportedVersions replaces the advertised list and makes dropped revisions unsupported', async () => {
    const server = healthy({ supportedVersions: ['2024-11-05', '2025-11-25'] });
    const discover = await post(server, rpc('server/discover'));
    expect(discover.json.result.supportedVersions).toEqual(['2024-11-05', '2025-11-25']);
    const modern = await post(server, rpc('tools/list'), { 'MCP-Protocol-Version': '2026-07-28' });
    expect(modern.json.error.code).toBe(-32022);
    expect(modern.json.error.data.supported).toEqual(['2024-11-05', '2025-11-25']);
    const legacy = await post(server, rpc('tools/list'), { 'MCP-Protocol-Version': '2025-11-25' });
    expect(legacy.json.error).toBeUndefined();
  });

  it('extraRevisions appends a revision that is served in the modern era with titles', async () => {
    const server = healthy({ extraRevisions: ['2027-01-15'] });
    const discover = await post(server, rpc('server/discover'));
    expect(discover.json.result.supportedVersions).toEqual(['2024-11-05', '2025-11-25', '2026-07-28', '2027-01-15']);
    const list = await post(server, rpc('tools/list'), { 'MCP-Protocol-Version': '2027-01-15' });
    expect(list.json.error).toBeUndefined();
    expect(list.json.result.resultType).toBe('complete');
    expect(list.json.result.tools[0].title).toBeDefined();
    expect(list.json.result.tools[0].annotations).toBeDefined();
  });

  it('tools limits the served tool names', async () => {
    const server = healthy({ tools: ['list_tools', 'list_categories'] });
    const { json } = await post(server, rpc('tools/list'));
    expect(json.result.tools.map((tool) => tool.name)).toEqual(['list_tools', 'list_categories']);
    const missing = await post(server, rpc('tools/call', { name: 'list_templates' }));
    expect(missing.json.error.code).toBe(-32601);
  });

  it('toolWithoutTitle drops the title of the named tool on titled revisions only', async () => {
    const server = healthy({ toolWithoutTitle: 'get_template' });
    const titled = await post(server, rpc('tools/list'), { 'MCP-Protocol-Version': '2025-11-25' });
    const untitled = titled.json.result.tools.filter((tool) => tool.title === undefined);
    expect(untitled.map((tool) => tool.name)).toEqual(['get_template']);
    expect(untitled[0].annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    const baseline = await post(server, rpc('tools/list'));
    expect(baseline.json.result.tools.every((tool) => tool.title === undefined)).toBe(true);
  });

  it('toolWithoutTitle accepts several names', async () => {
    const server = healthy({ toolWithoutTitle: ['get_template', 'list_tools'] });
    const { json } = await post(server, rpc('tools/list'), { 'MCP-Protocol-Version': '2026-07-28' });
    const names = json.result.tools.filter((tool) => tool.title === undefined).map((tool) => tool.name);
    expect(names.sort()).toEqual(['get_template', 'list_tools']);
  });

  it('failListTemplates fails list_templates as -32603 with HTTP 200 and no other tool', async () => {
    const server = healthy({ failListTemplates: true });
    const failed = await post(server, rpc('tools/call', { name: 'list_templates' }));
    expect(failed.status).toBe(200);
    expect(failed.json.error.code).toBe(-32603);
    expect(failed.json.error.data.toolName).toBe('list_templates');
    const other = await post(server, rpc('tools/call', { name: 'list_categories' }));
    expect(other.json.error).toBeUndefined();
    const list = await post(server, rpc('tools/list'));
    expect(list.json.error).toBeUndefined();
  });
});

describe('Fake MCP server: option edgeDropsMcpHeaders', () => {
  it('the edge does not forward the MCP headers, so a modern declaration by header is lost', async () => {
    const server = healthy({ edgeDropsMcpHeaders: true });
    const headers = { 'MCP-Protocol-Version': '2026-07-28' };
    const raw = await post(server, rpc('tools/list'), headers);
    const edge = await post(server, rpc('tools/list'), headers, server.edgeUrl);
    expect(raw.json.result.resultType).toBe('complete');
    expect(Object.keys(edge.json.result)).toEqual(['tools']);
  });

  it('the edge does not forward an unlisted revision header, so no -32022', async () => {
    const server = healthy({ edgeDropsMcpHeaders: true });
    const headers = { 'MCP-Protocol-Version': '2099-01-01' };
    expect((await post(server, rpc('tools/list'), headers)).json.error.code).toBe(-32022);
    expect((await post(server, rpc('tools/list'), headers, server.edgeUrl)).json.error).toBeUndefined();
  });

  it('the edge does not forward Mcp-Method, so a mismatch is not seen there', async () => {
    const server = healthy({ edgeDropsMcpHeaders: true });
    const headers = { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call' };
    expect((await post(server, rpc('tools/list'), headers)).json.error.code).toBe(-32020);
    expect((await post(server, rpc('tools/list'), headers, server.edgeUrl)).json.error).toBeUndefined();
  });

  it('a declaration in params._meta still reaches the Lambda through the edge', async () => {
    const server = healthy({ edgeDropsMcpHeaders: true });
    const { json } = await post(server, rpc('tools/list', { _meta: { [PROTOCOL_KEY]: '2026-07-28' } }), {}, server.edgeUrl);
    expect(json.result.resultType).toBe('complete');
  });

  it('the Lambda still sees the key through the edge', async () => {
    const server = healthy({ edgeDropsMcpHeaders: true, validKeys: { [FAKE_API_KEY]: 'private' } });
    const { response } = await post(server, rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY }, server.edgeUrl);
    expect(response.headers.get('x-ratelimit-limit')).toBe('6000');
  });

  it('the recorded call keeps the headers as sent', async () => {
    const server = healthy({ edgeDropsMcpHeaders: true });
    await post(server, rpc('tools/list'), { 'MCP-Protocol-Version': '2026-07-28' }, server.edgeUrl);
    expect(server.calls[0].headers['MCP-Protocol-Version']).toBe('2026-07-28');
  });
});

describe('Fake MCP server: option preflight and edgePreflight', () => {
  it('preflight overrides the raw preflight only', async () => {
    const server = healthy({ preflight: { status: 403, allowOrigin: 'https://only.example', allowHeaders: 'Content-Type' } });
    const raw = await preflight(server);
    expect(raw.status).toBe(403);
    expect(raw.headers.get('access-control-allow-origin')).toBe('https://only.example');
    expect(raw.headers.get('access-control-allow-headers')).toBe('Content-Type');
    expect(raw.headers.get('access-control-allow-methods')).toBe(readCorsStanza().allowMethods);
    const edge = await preflight(server, server.edgeUrl);
    expect(edge.status).toBe(200);
    expect(edge.headers.get('access-control-allow-headers')).toBe(readCorsStanza().allowHeaders);
  });

  it('edgePreflight overrides the edge preflight only', async () => {
    const server = healthy({ edgePreflight: { allowMethods: 'GET' } });
    expect((await preflight(server, server.edgeUrl)).headers.get('access-control-allow-methods')).toBe('GET');
    expect((await preflight(server)).headers.get('access-control-allow-methods')).toBe('POST,OPTIONS');
  });

  it('neither option changes a POST answer', async () => {
    const base = await post(healthy(), rpc('tools/list'));
    const changed = await post(healthy({ preflight: { status: 500 }, edgePreflight: { status: 500 } }), rpc('tools/list'));
    expect(changed.text).toBe(base.text);
    expect(changed.status).toBe(200);
  });
});

describe('Fake MCP server: option rateLimited', () => {
  it('answers 429 with Retry-After and X-RateLimit-Reset and then recovers with times', async () => {
    const server = healthy({ rateLimited: { times: 1, retryAfterSeconds: 42 } });
    const limited = await post(server, rpc('tools/list'));
    expect(limited.status).toBe(429);
    expect(limited.response.headers.get('retry-after')).toBe('42');
    expect(limited.response.headers.get('x-ratelimit-reset')).toBe(String(Math.floor(FIXED_NOW_MS / 1000) + 42));
    expect(limited.response.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(limited.json.retryAfter).toBe(42);
    const next = await post(server, rpc('tools/list'));
    expect(next.status).toBe(200);
  });

  it('resetEpochSeconds sets the reset header', async () => {
    const server = healthy({ rateLimited: { retryAfterSeconds: 5, resetEpochSeconds: 1900000000 } });
    const { response } = await post(server, rpc('tools/list'));
    expect(response.headers.get('x-ratelimit-reset')).toBe('1900000000');
    expect(response.headers.get('retry-after')).toBe('5');
  });

  it('omitRetryAfter and omitReset leave the headers out', async () => {
    const noRetry = await post(healthy({ rateLimited: { omitRetryAfter: true } }), rpc('tools/list'));
    expect(noRetry.status).toBe(429);
    expect(noRetry.response.headers.get('retry-after')).toBeNull();
    expect(noRetry.response.headers.get('x-ratelimit-reset')).not.toBeNull();
    const noReset = await post(healthy({ rateLimited: { omitReset: true } }), rpc('tools/list'));
    expect(noReset.response.headers.get('x-ratelimit-reset')).toBeNull();
    expect(noReset.response.headers.get('retry-after')).not.toBeNull();
  });

  it('true limits every POST', async () => {
    const server = healthy({ rateLimited: true });
    expect((await post(server, rpc('server/discover'))).status).toBe(429);
    expect((await post(server, rpc('tools/list'))).status).toBe(429);
  });

  it('does not touch the preflight', async () => {
    const server = healthy({ rateLimited: true });
    expect((await preflight(server)).status).toBe(200);
  });

  it('a rate-limited request does not use up the window', async () => {
    const server = healthy({ rateLimited: { times: 3 } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await post(server, rpc('tools/list'));
    }
    const served = await post(server, rpc('tools/list'));
    expect(served.response.headers.get('x-ratelimit-remaining')).toBe('49');
  });
});

describe('Fake MCP server: option serverError', () => {
  it('answers a gateway-style 503 by default', async () => {
    const { status, json } = await post(healthy({ serverError: true }), rpc('tools/list'));
    expect(status).toBe(503);
    expect(json.message).toBe('Service Unavailable');
  });

  it('honors status and the matching gateway message', async () => {
    const bad = await post(healthy({ serverError: { status: 502 } }), rpc('tools/list'));
    expect(bad.status).toBe(502);
    expect(bad.json.message).toBe('Internal server error');
    const gateway = await post(healthy({ serverError: { status: 504 } }), rpc('tools/list'));
    expect(gateway.status).toBe(504);
    expect(gateway.json.message).toBe('Endpoint request timed out');
  });

  it('applies to the preflight as well, being a transport-level fault', async () => {
    const server = healthy({ serverError: true });
    expect((await preflight(server)).status).toBe(503);
  });
});

describe('Fake MCP server: option timeout', () => {
  it('rejects the chosen request with a TimeoutError', async () => {
    const server = healthy({ timeout: { select: 'tools/list' } });
    const error = await rejection(post(server, rpc('tools/list')));
    expect(error.name).toBe('TimeoutError');
    expect(server.calls[0].outcome).toBe('timeout');
    expect((await post(server, rpc('server/discover'))).status).toBe(200);
  });
});

describe('Fake MCP server: option networkError', () => {
  it('rejects with a TypeError whose cause code defaults to ECONNREFUSED', async () => {
    const server = healthy({ networkError: true });
    const error = await rejection(post(server, rpc('tools/list')));
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('fetch failed');
    expect(error.cause.code).toBe('ECONNREFUSED');
  });

  it('honors code and target selection', async () => {
    const server = healthy({ networkError: { code: 'ECONNRESET', select: { target: 'edge' } } });
    expect((await post(server, rpc('tools/list'))).status).toBe(200);
    const error = await rejection(post(server, rpc('tools/list'), {}, server.edgeUrl));
    expect(error.cause.code).toBe('ECONNRESET');
  });
});

describe('Fake MCP server: option redirect', () => {
  it('answers 302 with a Location header by default', async () => {
    const { status, response } = await post(healthy({ redirect: true }), rpc('tools/list'));
    expect(status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^https:\/\//);
  });

  it('honors status and location', async () => {
    const { status, response } = await post(
      healthy({ redirect: { status: 308, location: 'https://elsewhere.example.test/x' } }),
      rpc('tools/list')
    );
    expect(status).toBe(308);
    expect(response.headers.get('location')).toBe('https://elsewhere.example.test/x');
  });
});

describe('Fake MCP server: fault selection', () => {
  const failing = (select, extra = {}) => healthy({ serverError: { select, ...extra } });

  async function statuses(server) {
    const out = [];
    for (let step = 0; step < 4; step += 1) {
      out.push((await post(server, rpc(step % 2 === 0 ? 'tools/list' : 'server/discover'))).status);
    }
    return out;
  }

  it('a string selects by JSON-RPC method', async () => {
    expect(await statuses(failing('tools/list'))).toEqual([503, 200, 503, 200]);
  });

  it('a string selects by HTTP method', async () => {
    const server = failing('OPTIONS');
    expect((await preflight(server)).status).toBe(503);
    expect((await post(server, rpc('tools/list'))).status).toBe(200);
  });

  it('a string selects by tool name', async () => {
    const server = failing('list_tools');
    expect((await post(server, rpc('tools/call', { name: 'list_tools' }))).status).toBe(503);
    expect((await post(server, rpc('tools/call', { name: 'list_categories' }))).status).toBe(200);
  });

  it('a number selects one request by 1-based index', async () => {
    expect(await statuses(failing(2))).toEqual([200, 503, 200, 200]);
  });

  it('an array selects several requests by index', async () => {
    expect(await statuses(failing([1, 4]))).toEqual([503, 200, 200, 503]);
  });

  it('times limits how many matching requests are affected', async () => {
    expect(await statuses(failing('tools/list', { times: 1 }))).toEqual([503, 200, 200, 200]);
  });

  it('an object selects by context fields', async () => {
    const server = failing({ target: 'edge', rpcMethod: 'tools/list' });
    expect((await post(server, rpc('tools/list'))).status).toBe(200);
    expect((await post(server, rpc('server/discover'), {}, server.edgeUrl)).status).toBe(200);
    expect((await post(server, rpc('tools/list'), {}, server.edgeUrl)).status).toBe(503);
  });

  it('an object can select on whether a key was sent', async () => {
    const server = healthy({
      validKeys: { [FAKE_API_KEY]: 'private' },
      serverError: { select: { hasKey: true } }
    });
    expect((await post(server, rpc('tools/list'))).status).toBe(200);
    expect((await post(server, rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY })).status).toBe(503);
  });

  it('a function receives the request context', async () => {
    const seen = [];
    const server = failing((context) => {
      seen.push(context);
      return context.headers['mcp-protocol-version'] === '2026-07-28';
    });
    expect((await post(server, rpc('tools/list'))).status).toBe(200);
    expect((await post(server, rpc('tools/list'), { 'MCP-Protocol-Version': '2026-07-28' })).status).toBe(503);
    expect(seen[1]).toMatchObject({ index: 2, target: 'raw', httpMethod: 'POST', rpcMethod: 'tools/list', hasKey: false });
  });
});

describe('Fake MCP server: option echoRequestHeaders', () => {
  it('repeats the request headers in JSON-RPC bodies, including the key', async () => {
    const server = healthy({ echoRequestHeaders: true, validKeys: { [FAKE_API_KEY]: 'private' } });
    const { json } = await post(server, rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY });
    expect(json.echo.headers['x-api-key']).toBe(FAKE_API_KEY);
    expect(json.echo.headers['content-type']).toBe('application/json');
  });

  it('changes nothing else in the body', async () => {
    const base = await post(healthy(), rpc('tools/list'));
    const echoed = await post(healthy({ echoRequestHeaders: true }), rpc('tools/list'));
    const { echo, ...rest } = echoed.json;
    expect(echo).toBeDefined();
    expect(rest).toEqual(base.json);
  });

  it('echoes into error bodies and 401 bodies, and leaves an empty preflight body empty', async () => {
    const server = healthy({ echoRequestHeaders: true });
    const unauthorized = await post(server, rpc('tools/list'), { 'X-API-Key': FAKE_API_KEY });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.json.echo.headers['x-api-key']).toBe(FAKE_API_KEY);
    const optionsResponse = await preflight(server);
    expect(await optionsResponse.text()).toBe('');
  });
});

describe('Fake MCP server: option mutate', () => {
  it('may change the body in place', async () => {
    const server = healthy({
      mutate: (context, body) => {
        if (context.rpcMethod === 'tools/list') {
          body.result.tools = [];
        }
      }
    });
    expect((await post(server, rpc('tools/list'))).json.result.tools).toEqual([]);
    expect((await post(server, rpc('server/discover'))).json.result.supportedVersions.length).toBe(3);
  });

  it('may return a replacement body', async () => {
    const server = healthy({ mutate: (context, body) => ({ ...body, result: { replaced: true } }) });
    expect((await post(server, rpc('tools/list'))).json.result).toEqual({ replaced: true });
  });

  it('may change the response headers', async () => {
    const server = healthy({ mutate: (context, body, headers) => { headers['x-mcp-version'] = '9.9'; } });
    expect((await post(server, rpc('tools/list'))).response.headers.get('x-mcp-version')).toBe('9.9');
  });

  it('rpcStatus replaces the HTTP status of the answers it selects, and a non-integer leaves it alone', async () => {
    const server = healthy({ rpcStatus: (context) => (context.rpcMethod === 'tools/list' ? 200 : undefined) });
    const unlisted = { 'MCP-Protocol-Version': '2099-01-01' };
    const replaced = await post(server, rpc('tools/list'), unlisted);
    expect(replaced.status).toBe(200);
    expect(replaced.json.error.code).toBe(-32022);
    expect((await post(server, rpc('ping'), unlisted)).status).toBe(400);
  });

  it('receives the method and tool name of the request', async () => {
    const seen = [];
    const server = healthy({ mutate: (context) => { seen.push([context.rpcMethod, context.toolName]); } });
    await post(server, rpc('tools/call', { name: 'list_tools' }));
    expect(seen).toEqual([['tools/call', 'list_tools']]);
  });
});

describe('Fake MCP server: recorded calls', () => {
  it('records URL, method, headers as written, body, and answer of each request', async () => {
    const server = healthy();
    await post(server, rpc('tools/call', { name: 'list_tools' }), { 'MCP-Protocol-Version': '2026-07-28', 'X-API-Key': 'k' });
    await preflight(server, server.edgeUrl);
    expect(server.calls).toHaveLength(2);
    const [first, second] = server.calls;
    expect(first.index).toBe(1);
    expect(first.url).toBe(server.rawUrl);
    expect(first.target).toBe('raw');
    expect(first.method).toBe('POST');
    expect(first.headers['MCP-Protocol-Version']).toBe('2026-07-28');
    expect(first.headersLower['mcp-protocol-version']).toBe('2026-07-28');
    expect(first.headers['X-API-Key']).toBe('k');
    expect(first.rpcMethod).toBe('tools/call');
    expect(first.toolName).toBe('list_tools');
    expect(first.json.method).toBe('tools/call');
    expect(first.status).toBe(401);
    expect(second.index).toBe(2);
    expect(second.target).toBe('edge');
    expect(second.method).toBe('OPTIONS');
    expect(second.status).toBe(200);
    expect(second.rpcMethod).toBeNull();
  });

  it('records whether a signal and a redirect mode were passed', async () => {
    const server = healthy();
    await server.fetch(server.rawUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rpc('server/discover')),
      signal: AbortSignal.timeout(1000),
      redirect: 'manual'
    });
    await post(server, rpc('server/discover'));
    expect(server.calls[0].hasSignal).toBe(true);
    expect(server.calls[0].redirectMode).toBe('manual');
    expect(server.calls[1].hasSignal).toBe(false);
  });

  it('records a transport fault as a call without a status', async () => {
    const server = healthy({ networkError: true });
    await rejection(post(server, rpc('tools/list')));
    expect(server.calls[0].status).toBeNull();
    expect(server.calls[0].outcome).toBe('network-error');
  });

  it('accepts headers as a Headers object or as pairs', async () => {
    const server = healthy();
    await server.fetch(server.rawUrl, {
      method: 'POST',
      headers: new Headers({ 'MCP-Protocol-Version': '2026-07-28' }),
      body: JSON.stringify(rpc('tools/list'))
    });
    await server.fetch(server.rawUrl, {
      method: 'POST',
      headers: [['MCP-Protocol-Version', '2026-07-28']],
      body: JSON.stringify(rpc('tools/list'))
    });
    expect(server.calls.map((call) => call.headersLower['mcp-protocol-version'])).toEqual(['2026-07-28', '2026-07-28']);
  });

  it('tracks that sequential requests never overlap', async () => {
    const server = healthy();
    await post(server, rpc('tools/list'));
    await post(server, rpc('tools/list'));
    expect(server.stats.inFlight).toBe(0);
    expect(server.stats.maxInFlight).toBe(1);
  });

  it('sees two requests sent at the same time', async () => {
    const server = healthy();
    await Promise.all([post(server, rpc('tools/list')), post(server, rpc('tools/list'))]);
    expect(server.stats.maxInFlight).toBe(2);
    expect(server.stats.inFlight).toBe(0);
  });
});

describe('Fake MCP server: each option changes only the behavior it names', () => {
  /**
   * Compare a transcript from an option server with the healthy transcript.
   *
   * @param {Object} options - Options for the changed server
   * @param {number[]} changedIndexes - Zero-based transcript positions that may differ
   * @returns {Promise<Array<{status: number, text: string}>>} The changed transcript, for further asserts
   */
  async function expectOnly(options, changedIndexes) {
    const base = await transcript(healthy());
    const changed = await transcript(healthy(options));
    base.forEach((entry, position) => {
      if (changedIndexes.includes(position)) {
        expect(changed[position]).not.toEqual(entry);
      } else {
        expect(changed[position]).toEqual(entry);
      }
    });
    return changed;
  }

  it('version changes only the answers that carry serverInfo (the legacy tools/call result has none)', async () => {
    await expectOnly({ version: '0.0.6' }, [0, 1]);
  });

  it('instructions changes only server/discover among the transcript', async () => {
    await expectOnly({ instructions: 'Changed' }, [0]);
  });

  it('serverError on tools/list changes only tools/list', async () => {
    await expectOnly({ serverError: { select: 'tools/list' } }, [1]);
  });

  it('serverError on OPTIONS changes only the preflight', async () => {
    await expectOnly({ serverError: { select: 'OPTIONS' } }, [3]);
  });

  it('rateLimited on server/discover changes only server/discover', async () => {
    await expectOnly({ rateLimited: { select: 'server/discover' } }, [0]);
  });

  it('redirect on tools/call changes only tools/call', async () => {
    await expectOnly({ redirect: { select: 'tools/call' } }, [2]);
  });

  it('failListTemplates changes none of the transcript requests', async () => {
    await expectOnly({ failListTemplates: true }, []);
  });

  it('toolWithoutTitle changes only the titled tools/list', async () => {
    await expectOnly({ toolWithoutTitle: 'get_template' }, [1]);
  });

  it('edgeDropsMcpHeaders changes nothing on the raw target', async () => {
    await expectOnly({ edgeDropsMcpHeaders: true }, []);
  });

  it('preflight overrides change only the raw preflight', async () => {
    await expectOnly({ preflight: { allowHeaders: 'Content-Type' } }, [3]);
  });

  it('edgePreflight changes nothing on the raw target', async () => {
    await expectOnly({ edgePreflight: { status: 403 } }, []);
  });

  it('validKeys changes nothing for requests without a key', async () => {
    await expectOnly({ validKeys: { [FAKE_API_KEY]: 'private' } }, []);
  });

  it('degradedAuth changes nothing for requests without a key', async () => {
    await expectOnly({ degradedAuth: true }, []);
  });

  it('extraRevisions changes only the advertised list', async () => {
    await expectOnly({ extraRevisions: ['2027-01-15'] }, [0]);
  });

  it('a timeout on one request leaves the others as they were', async () => {
    const server = healthy({ timeout: { select: 'tools/call' } });
    const base = await transcript(healthy());
    const first = await post(server, rpc('server/discover', undefined, 1));
    expect({ status: first.status, text: first.text }).toEqual(base[0]);
    await rejection(post(server, rpc('tools/call', { name: 'list_tools' }, 3)));
    const list = await post(server, rpc('tools/list', undefined, 2), { 'MCP-Protocol-Version': '2026-07-28' });
    expect(list.json.result.resultType).toBe('complete');
  });
});
