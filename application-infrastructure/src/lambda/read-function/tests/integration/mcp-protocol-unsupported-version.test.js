/**
 * Integration tests: -32022 UnsupportedProtocolVersion
 *
 * Drives requests through handleJsonRpc() and asserts that a request declaring a
 * revision outside `supportedVersions` is rejected with -32022, that the error data
 * reports what the client declared, and that it enumerates the supported versions.
 *
 * The rejection is an HTTP 400 and its error data uses the key names from the MCP
 * 2026-07-28 schema's UnsupportedProtocolVersionError: `requested` (what the client
 * declared) and `supported` (what it may retry with).
 *
 * Also covers the guard rails around that rejection: the legacy `initialize`
 * handshake counter-offers instead of failing, and `server/discover` is always answerable.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.4, 6.2, 15.5, 16.1
 */

const { describe, it, expect } = require('@jest/globals');
const { handleJsonRpc } = require('../../utils/json-rpc-router');
const { SUPPORTED_PROTOCOL_VERSIONS, JSON_RPC_ERRORS } = require('../../utils/mcp-protocol');

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
 * @param {Object} [headers] - HTTP headers
 * @param {number} [expectedStatus=200] - HTTP status the response must carry
 * @returns {Promise<Object>} Parsed JSON-RPC response
 */
async function send(body, headers, expectedStatus = 200) {
  const response = await handleJsonRpc(makeClientRequest(body, headers), null);
  expect(response.statusCode).toBe(expectedStatus);
  return JSON.parse(response.body);
}

/** HTTP status the specification requires for -32022. */
const UNSUPPORTED_STATUS = 400;

describe('Integration: -32022 UnsupportedProtocolVersion', () => {
  describe('declared via MCP-Protocol-Version header', () => {
    it('rejects an unknown revision with -32022', async () => {
      const body = await send(
        { jsonrpc: '2.0', id: 'v1', method: 'tools/list' },
        { 'MCP-Protocol-Version': '2099-01-01' },
        UNSUPPORTED_STATUS
      );

      expect(body.result).toBeUndefined();
      expect(body.error.code).toBe(-32022);
      expect(body.error.code).toBe(JSON_RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION);
      expect(body.id).toBe('v1');
    });

    it('reports the revision the client declared in error.data.requested, not null', async () => {
      const body = await send(
        { jsonrpc: '2.0', id: 'v2', method: 'tools/list' },
        { 'mcp-protocol-version': '2099-01-01' },
        UNSUPPORTED_STATUS
      );

      expect(body.error.data.requested).toBe('2099-01-01');
    });

    it('enumerates the supported revisions in error.data.supported', async () => {
      const body = await send(
        { jsonrpc: '2.0', id: 'v3', method: 'tools/call', params: { name: 'list_tools' } },
        { 'MCP-Protocol-Version': '2099-01-01' },
        UNSUPPORTED_STATUS
      );

      expect(body.error.data.supported).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
      expect(body.error.data.supported.length).toBeGreaterThan(0);
    });

    it('does not carry the pre-schema key names declaredRevision or supportedVersions', async () => {
      const body = await send(
        { jsonrpc: '2.0', id: 'v4', method: 'tools/list' },
        { 'MCP-Protocol-Version': '2099-01-01' },
        UNSUPPORTED_STATUS
      );

      expect(body.error.data).not.toHaveProperty('declaredRevision');
      expect(body.error.data).not.toHaveProperty('supportedVersions');
    });
  });

  describe('declared via _meta', () => {
    it('rejects an unknown revision in params._meta (the specification location)', async () => {
      const body = await send(
        {
          jsonrpc: '2.0',
          id: 'm1',
          method: 'tools/list',
          params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } }
        },
        undefined,
        UNSUPPORTED_STATUS
      );

      expect(body.error.code).toBe(-32022);
      expect(body.error.data.requested).toBe('2099-01-01');
    });

    it('rejects an unknown revision in a top-level _meta', async () => {
      const body = await send(
        {
          jsonrpc: '2.0',
          id: 'm2',
          method: 'tools/list',
          _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' }
        },
        undefined,
        UNSUPPORTED_STATUS
      );

      expect(body.error.code).toBe(-32022);
    });

    it('lets the header win when header and _meta disagree', async () => {
      const body = await send(
        {
          jsonrpc: '2.0',
          id: 'm3',
          method: 'tools/list',
          params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2024-11-05' } }
        },
        { 'MCP-Protocol-Version': '2099-01-01' },
        UNSUPPORTED_STATUS
      );

      expect(body.error.code).toBe(-32022);
      expect(body.error.data.requested).toBe('2099-01-01');
    });
  });

  describe('malformed and edge-case declarations', () => {
    it.each([
      ['not-a-date', 'a non-date string'],
      ['2025-13-45', 'an impossible calendar date'],
      ['2025-11-25 ', 'a supported revision with trailing whitespace'],
      ['2025-11-25; drop', 'a supported revision with trailing junk']
    ])('rejects %j (%s) with -32022 and echoes it back', async (value) => {
      const body = await send(
        { jsonrpc: '2.0', id: 'bad', method: 'tools/list' },
        { 'MCP-Protocol-Version': value },
        UNSUPPORTED_STATUS
      );

      expect(body.error.code).toBe(-32022);
      expect(body.error.data.requested).toBe(value);
      expect(body.error.data.supported).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
    });

    it.each(['', '   '])('treats a blank header (%j) as not declared, for every method', async (blank) => {
      // Consistent across methods: a blank header must not be rejected on one path and
      // ignored on another (initialize and tools/list both go through era resolution).
      for (const method of ['tools/list', 'initialize', 'server/discover']) {
        const body = await send({ jsonrpc: '2.0', id: 'blank', method }, { 'MCP-Protocol-Version': blank });

        expect(body.error).toBeUndefined();
      }
    });

    it.each(['MCP-Protocol-Version', 'mcp-protocol-version', 'Mcp-Protocol-Version', 'MCP-PROTOCOL-VERSION'])(
      'recognizes the header name case-insensitively: %s',
      async (headerName) => {
        const body = await send(
          { jsonrpc: '2.0', id: 'case', method: 'tools/list' },
          { [headerName]: '2099-01-01' },
          UNSUPPORTED_STATUS
        );

        expect(body.error.code).toBe(-32022);
      }
    );

    it('copes with a request that has no headers property at all', async () => {
      const event = {
        httpMethod: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 'nohdr', method: 'tools/list' })
      };
      const response = await handleJsonRpc({ getEvent: () => event, addQueryLog: () => {} }, null);
      const body = JSON.parse(response.body);

      expect(body.error).toBeUndefined();
      expect(Array.isArray(body.result.tools)).toBe(true);
    });

    it('does not leak an unsupported declaration across consecutive requests', async () => {
      // The router is stateless: a rejected request must not affect the next one.
      const rejected = await send(
        { jsonrpc: '2.0', id: 'a', method: 'tools/list' },
        { 'MCP-Protocol-Version': '2099-01-01' },
        UNSUPPORTED_STATUS
      );
      const accepted = await send({ jsonrpc: '2.0', id: 'b', method: 'tools/list' });

      expect(rejected.error.code).toBe(-32022);
      expect(accepted.error).toBeUndefined();
    });
  });

  describe('is not raised for supported or undeclared revisions', () => {
    it.each(SUPPORTED_PROTOCOL_VERSIONS)('accepts supported revision %s', async (revision) => {
      const body = await send(
        { jsonrpc: '2.0', id: 'ok', method: 'tools/list' },
        { 'MCP-Protocol-Version': revision }
      );

      expect(body.error).toBeUndefined();
      expect(Array.isArray(body.result.tools)).toBe(true);
    });

    it('accepts a request that declares no revision (legacy default)', async () => {
      const body = await send({ jsonrpc: '2.0', id: 'none', method: 'tools/list' });

      expect(body.error).toBeUndefined();
      expect(Array.isArray(body.result.tools)).toBe(true);
    });
  });

  describe('guard rails (Requirement 16.1)', () => {
    it('server/discover stays answerable even when an unknown revision is declared', async () => {
      const body = await send(
        { jsonrpc: '2.0', id: 'd1', method: 'server/discover' },
        { 'MCP-Protocol-Version': '2099-01-01' }
      );

      expect(body.error).toBeUndefined();
      expect(body.result.supportedVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
    });

    it('initialize with an unlisted MCP-Protocol-Version header gets 400 and the schema key names', async () => {
      const body = await send(
        {
          jsonrpc: '2.0',
          id: 'i0',
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } }
        },
        { 'MCP-Protocol-Version': '2099-01-01' },
        UNSUPPORTED_STATUS
      );

      expect(body.result).toBeUndefined();
      expect(body.error.code).toBe(-32022);
      expect(body.error.data.requested).toBe('2099-01-01');
      expect(body.error.data.supported).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
      expect(body.error.data).not.toHaveProperty('declaredRevision');
      expect(body.error.data).not.toHaveProperty('supportedVersions');
    });

    it('server/discover with an unlisted declared revision in _meta gets 200 and no error', async () => {
      const body = await send(
        {
          jsonrpc: '2.0',
          id: 'd2',
          method: 'server/discover',
          params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } }
        },
        undefined,
        200
      );

      expect(body.error).toBeUndefined();
      expect(body.result).toBeDefined();
    });

    it('initialize counter-offers rather than failing when the client asks for an unlisted revision', async () => {
      // A legacy client on a revision this server does not list must still be able to connect.
      const body = await send({
        jsonrpc: '2.0',
        id: 'i1',
        method: 'initialize',
        params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 't', version: '1' } }
      });

      expect(body.error).toBeUndefined();
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(body.result.protocolVersion);
    });

    it('initialize offers the nearest older legacy revision for an in-between revision', async () => {
      // 2025-06-18 is not listed; the closest older listed revision is 2024-11-05.
      const body = await send({
        jsonrpc: '2.0',
        id: 'i2',
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' }
      });

      expect(body.error).toBeUndefined();
      expect(body.result.protocolVersion).toBe('2024-11-05');
    });

    it('initialize echoes a supported legacy revision', async () => {
      const body = await send({
        jsonrpc: '2.0',
        id: 'i3',
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' }
      });

      expect(body.result.protocolVersion).toBe('2024-11-05');
    });
  });
});
