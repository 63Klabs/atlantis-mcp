/**
 * Unit Tests for JSON-RPC Router - server/discover method
 *
 * Tests the handleJsonRpc function's support for the server/discover method,
 * which is part of the modern MCP protocol era (2026-07-28+). This method
 * allows clients to discover server capabilities without a handshake.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 11.4
 */

const { handleJsonRpc } = require('../../../utils/json-rpc-router');
const { CACHE_SCOPES, TOOLS_LIST_CACHE_SCOPE, TOOLS_LIST_TTL_MS } = require('../../../utils/mcp-protocol');

/**
 * Helper: build a valid JSON-RPC 2.0 event body
 */
function makeEvent(body, headers = {}) {
  if (body === null || body === undefined) {
    return { body: null, headers };
  }
  if (typeof body === 'string') {
    return { body, headers };
  }
  return { body: JSON.stringify(body), headers };
}

/**
 * Helper: wrap a raw event in a mock clientRequest object
 */
function makeClientRequest(body, headers = {}) {
  const event = makeEvent(body, headers);
  return {
    getEvent: () => event,
    getProps: () => ({ path: 'mcp/v1', method: 'POST' }),
    addQueryLog: jest.fn()
  };
}

/**
 * Helper: parse the response body JSON
 */
function parseBody(response) {
  return JSON.parse(response.body);
}

describe('JSON-RPC Router - server/discover method', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------
  // server/discover method - basic functionality
  // ---------------------------------------------------------------
  describe('server/discover basic functionality', () => {
    test('returns modern-shaped result with supportedVersions, capabilities, instructions, resultType, and _meta', async () => {
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-1'
      });

      const response = await handleJsonRpc(clientRequest);
      expect(response.statusCode).toBe(200);

      const body = parseBody(response);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('discover-1');
      expect(body.result).toBeDefined();

      const result = body.result;
      
      // Requirement 5.2: Modern-shaped result with _meta
      expect(result.supportedVersions).toBeDefined();
      expect(Array.isArray(result.supportedVersions)).toBe(true);
      expect(result.supportedVersions.length).toBeGreaterThan(0);
      
      expect(result.capabilities).toBeDefined();
      expect(typeof result.capabilities).toBe('object');
      
      expect(result.instructions).toBeDefined();
      expect(typeof result.instructions).toBe('string');
      
      // Requirement 7.1: resultType present in modern responses
      expect(result.resultType).toBe('complete');
      
      // Requirement 2.4: _meta with serverInfo
      expect(result._meta).toBeDefined();
      expect(result._meta['io.modelcontextprotocol/serverInfo']).toBeDefined();
      expect(result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('atlantis-mcp-server');
      expect(result._meta['io.modelcontextprotocol/serverInfo'].version).toBeDefined();
    });

    test('returns ttlMs and an allowed cacheScope through the router', async () => {
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-cache-hints'
      });

      const response = await handleJsonRpc(clientRequest);
      expect(response.statusCode).toBe(200);

      const result = parseBody(response).result;

      // >! The discover result is cacheable: the schema requires ttlMs and a valid cacheScope
      expect(Number.isInteger(result.ttlMs)).toBe(true);
      expect(result.ttlMs).toBeGreaterThanOrEqual(0);
      expect(result.ttlMs).toBe(TOOLS_LIST_TTL_MS);
      expect(CACHE_SCOPES).toContain(result.cacheScope);
      expect(result.cacheScope).toBe(TOOLS_LIST_CACHE_SCOPE);
    });

    test('works without prior handshake (Requirement 5.3)', async () => {
      // No initialize call required - server/discover works immediately
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-no-handshake'
      });

      const response = await handleJsonRpc(clientRequest);
      expect(response.statusCode).toBe(200);

      const body = parseBody(response);
      expect(body.result).toBeDefined();
      expect(body.result.supportedVersions).toBeDefined();
    });

    test('returns all supported protocol versions', async () => {
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-versions'
      });

      const response = await handleJsonRpc(clientRequest);
      const body = parseBody(response);
      const versions = body.result.supportedVersions;

      // Should include both legacy and modern revisions
      expect(versions).toContain('2024-11-05');
      expect(versions).toContain('2025-11-25');
      // Modern revision may not be in supportedVersions yet (Phase 4 gating)
    });
  });

  // ---------------------------------------------------------------
  // server/discover with protocol version headers
  // ---------------------------------------------------------------
  describe('server/discover with protocol version metadata', () => {
    test('accepts request with MCP-Protocol-Version header', async () => {
      const clientRequest = makeClientRequest(
        {
          jsonrpc: '2.0',
          method: 'server/discover',
          id: 'discover-with-header'
        },
        { 'mcp-protocol-version': '2026-07-28' }
      );

      const response = await handleJsonRpc(clientRequest);
      expect(response.statusCode).toBe(200);

      const body = parseBody(response);
      expect(body.result).toBeDefined();
    });

    test('accepts request with _meta protocol version', async () => {
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-with-meta',
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28'
        }
      });

      const response = await handleJsonRpc(clientRequest);
      expect(response.statusCode).toBe(200);

      const body = parseBody(response);
      expect(body.result).toBeDefined();
    });

    test('works without declaring any protocol version', async () => {
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-no-version'
      });

      const response = await handleJsonRpc(clientRequest);
      expect(response.statusCode).toBe(200);

      const body = parseBody(response);
      expect(body.result).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // server/discover always returns modern-shaped result
  // ---------------------------------------------------------------
  describe('server/discover era resolution', () => {
    test('always returns modern-shaped result (Requirement 5.1)', async () => {
      // Even if no version is declared, server/discover is always modern
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-era-test'
      });

      const response = await handleJsonRpc(clientRequest);
      const body = parseBody(response);
      const result = body.result;

      // Modern characteristics: resultType and _meta
      expect(result.resultType).toBe('complete');
      expect(result._meta).toBeDefined();
      expect(result._meta['io.modelcontextprotocol/serverInfo']).toBeDefined();
    });

    test('does not echo protocolVersion like initialize does', async () => {
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-no-echo',
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28'
        }
      });

      const response = await handleJsonRpc(clientRequest);
      const body = parseBody(response);
      const result = body.result;

      // server/discover does NOT echo protocolVersion (no handshake)
      expect(result.protocolVersion).toBeUndefined();
      // Instead, it returns supportedVersions
      expect(result.supportedVersions).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // server/discover integration with era resolution
  // ---------------------------------------------------------------
  describe('server/discover integration with era resolution', () => {
    test('resolveEra identifies server/discover as modern method', async () => {
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-era-resolve'
      });

      const response = await handleJsonRpc(clientRequest);
      expect(response.statusCode).toBe(200);

      const body = parseBody(response);
      // Modern-era result has resultType
      expect(body.result.resultType).toBe('complete');
    });

    test('server/discover bypasses header validation even in modern era', async () => {
      // server/discover doesn't require Mcp-Method header
      const clientRequest = makeClientRequest(
        {
          jsonrpc: '2.0',
          method: 'server/discover',
          id: 'discover-no-header'
        },
        {} // No Mcp-Method header
      );

      const response = await handleJsonRpc(clientRequest);
      expect(response.statusCode).toBe(200);

      const body = parseBody(response);
      expect(body.result).toBeDefined();
      // No -32020 HEADER_MISMATCH error
    });
  });

  // ---------------------------------------------------------------
  // server/discover response content
  // ---------------------------------------------------------------
  describe('server/discover response content', () => {
    test('includes server capabilities', async () => {
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-capabilities'
      });

      const response = await handleJsonRpc(clientRequest);
      const body = parseBody(response);
      const capabilities = body.result.capabilities;

      expect(capabilities).toBeDefined();
      expect(capabilities.tools).toBeDefined();
      expect(capabilities.tools.listChanged).toBe(false);
    });

    test('includes server instructions', async () => {
      const clientRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-instructions'
      });

      const response = await handleJsonRpc(clientRequest);
      const body = parseBody(response);

      expect(body.result.instructions).toBeDefined();
      expect(typeof body.result.instructions).toBe('string');
      expect(body.result.instructions.length).toBeGreaterThan(0);
    });

    test('instructions match those from initialize (Requirement 1.6)', async () => {
      // Get instructions from server/discover
      const discoverRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'server/discover',
        id: 'discover-instr'
      });
      const discoverResponse = await handleJsonRpc(discoverRequest);
      const discoverInstructions = parseBody(discoverResponse).result.instructions;

      // Get instructions from initialize
      const initRequest = makeClientRequest({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 'init-instr'
      });
      const initResponse = await handleJsonRpc(initRequest);
      const initInstructions = parseBody(initResponse).result.instructions;

      // They should be identical
      expect(discoverInstructions).toBe(initInstructions);
    });
  });
});
