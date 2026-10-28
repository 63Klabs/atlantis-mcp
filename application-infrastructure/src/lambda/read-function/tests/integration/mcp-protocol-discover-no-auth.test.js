/**
 * Integration tests: server/discover at the public tier
 *
 * `server/discover` must be answerable by an unauthenticated client, before any other
 * method has been called, with the same content the legacy `initialize` carries.
 *
 * Rate limiting is applied upstream of the router (index.js) and is covered by the
 * existing rate-limiting suites; authentication is the only thing asserted absent here.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 15.4, 15.9
 */

const { describe, it, expect } = require('@jest/globals');
const { handleJsonRpc } = require('../../utils/json-rpc-router');
const { SUPPORTED_PROTOCOL_VERSIONS, SERVER_NAME, getCapabilities } = require('../../utils/mcp-protocol');
const { buildInstructions } = require('../../config/server-instructions');

/**
 * Build a minimal ClientRequest double for handleJsonRpc().
 *
 * @param {Object} body - JSON-RPC request body
 * @param {Object} [headers] - HTTP headers
 * @returns {{getEvent: Function, addQueryLog: Function}} ClientRequest double
 */
function makeClientRequest(body, headers = {}) {
  const event = { httpMethod: 'POST', headers, body: JSON.stringify(body) };
  return { getEvent: () => event, addQueryLog: () => {} };
}

/**
 * Send a request through the router and parse the JSON-RPC response.
 *
 * @param {Object} body - JSON-RPC request body
 * @param {Object|null} authInfo - Resolved auth context, or null for none
 * @param {Object} [headers] - HTTP headers
 * @returns {Promise<Object>} Parsed JSON-RPC response
 */
async function send(body, authInfo, headers) {
  const response = await handleJsonRpc(makeClientRequest(body, headers), authInfo);
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body);
}

const DISCOVER = { jsonrpc: '2.0', id: 'disc', method: 'server/discover' };

describe('Integration: server/discover (public tier)', () => {
  it('is answerable with no auth context at all', async () => {
    const body = await send(DISCOVER, null);

    expect(body.error).toBeUndefined();
    expect(body.id).toBe('disc');
    expect(body.result.supportedVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
  });

  it('is answerable with an explicit unauthenticated public-tier context', async () => {
    const body = await send(DISCOVER, { tier: 'public', isAuthenticated: false });

    expect(body.error).toBeUndefined();
    expect(body.result.capabilities).toEqual(getCapabilities().capabilities);
  });

  it('needs no prior initialize call and no protocol-version metadata', async () => {
    // First and only request on a cold router: no handshake, no headers, no _meta.
    const body = await send({ jsonrpc: '2.0', id: 'cold', method: 'server/discover' }, null, {});

    expect(body.error).toBeUndefined();
    expect(body.result.resultType).toBe('complete');
  });

  it('accepts optional params and ignores them', async () => {
    const body = await send({ ...DISCOVER, params: { anything: true } }, null);

    expect(body.error).toBeUndefined();
    expect(body.result.supportedVersions).toBeDefined();
  });

  it('returns modern-shaped identity in result _meta, not a legacy serverInfo', async () => {
    const body = await send(DISCOVER, null);
    const identity = body.result._meta['io.modelcontextprotocol/serverInfo'];

    expect(identity.name).toBe(SERVER_NAME);
    expect(identity.version).toBe(getCapabilities().serverInfo.version);
    expect(body.result.serverInfo).toBeUndefined();
    expect(body.result.protocolVersion).toBeUndefined();
  });

  it('carries the same instructions string as initialize, byte for byte', async () => {
    const discover = await send(DISCOVER, null);
    const initialize = await send(
      { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      null
    );

    expect(discover.result.instructions.length).toBeGreaterThan(0);
    expect(discover.result.instructions).toBe(initialize.result.instructions);
    expect(discover.result.instructions).toBe(buildInstructions());
  });

  it('reports the same capabilities and identity as initialize', async () => {
    const discover = await send(DISCOVER, null);
    const initialize = await send({ jsonrpc: '2.0', id: 'init', method: 'initialize' }, null);

    expect(discover.result.capabilities).toEqual(initialize.result.capabilities);
    expect(discover.result._meta['io.modelcontextprotocol/serverInfo']).toEqual(initialize.result.serverInfo);
  });

  it('works with an empty headers object and with no headers property at all', async () => {
    const withEmpty = await send(DISCOVER, null, {});

    const event = { httpMethod: 'POST', body: JSON.stringify(DISCOVER) };
    const response = await handleJsonRpc({ getEvent: () => event, addQueryLog: () => {} }, null);
    const withoutProperty = JSON.parse(response.body);

    expect(withEmpty.error).toBeUndefined();
    expect(withoutProperty.error).toBeUndefined();
    expect(withoutProperty.result).toEqual(withEmpty.result);
  });

  it('returns an identical result with or without an authenticated caller', async () => {
    const anonymous = await send(DISCOVER, null);
    const authenticated = await send(DISCOVER, { tier: 'private', isAuthenticated: true });
    const publicTier = await send(DISCOVER, { tier: 'public', isAuthenticated: false });

    // The public read-only server exposes the same discovery document to everyone.
    expect(authenticated.result).toEqual(anonymous.result);
    expect(publicTier.result).toEqual(anonymous.result);
  });

  it('still answers when supported protocol-version metadata is supplied', async () => {
    const viaHeader = await send(DISCOVER, null, { 'MCP-Protocol-Version': '2026-07-28' });
    const viaMeta = await send(
      { ...DISCOVER, params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } },
      null
    );

    expect(viaHeader.error).toBeUndefined();
    expect(viaMeta.result).toEqual(viaHeader.result);
  });

  it('answers unknown protocol-version metadata with the discovery document, not an error', async () => {
    const body = await send(DISCOVER, null, { 'MCP-Protocol-Version': '2099-01-01' });

    // server/discover is how a client learns which versions it may use, so it must not refuse.
    expect(body.error).toBeUndefined();
    expect(body.result.supportedVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
  });

  it('returns a consistent document across many concurrent requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => send({ ...DISCOVER, id: `c${i}` }, null))
    );

    results.forEach((body, i) => {
      expect(body.id).toBe(`c${i}`);
      expect(body.result).toEqual(results[0].result);
    });
  });

  it('echoes numeric and string ids and returns null for an invalid id type', async () => {
    expect((await send({ ...DISCOVER, id: 7 }, null)).id).toBe(7);
    expect((await send({ ...DISCOVER, id: 'abc' }, null)).id).toBe('abc');
    expect((await send({ ...DISCOVER, id: { bad: true } }, null)).id).toBeNull();
  });
});
