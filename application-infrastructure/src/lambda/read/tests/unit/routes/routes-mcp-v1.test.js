/**
 * Unit Tests for /mcp/v1 Routing
 *
 * Tests the Routes.process() function in routes/index.js for correct
 * delegation of POST /mcp/v1 requests to the JSON-RPC Router and
 * rejection of all other paths/methods.
 */

// --- Mock @63klabs/cache-data before any require ---
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn()
    }
  }
}));

// --- Mock json-rpc-router ---
const mockHandleJsonRpc = jest.fn();
const mockBuildResponse = jest.fn();

jest.mock('../../../utils/json-rpc-router', () => ({
  handleJsonRpc: mockHandleJsonRpc,
  buildResponse: mockBuildResponse
}));

// --- Mock mcp-protocol ---
const mockJsonRpcError = jest.fn().mockReturnValue({ jsonrpc: '2.0', error: { code: -32601, message: 'Not found' }, id: null });

jest.mock('../../../utils/mcp-protocol', () => ({
  toolsListResponse: jest.fn(),
  jsonRpcError: mockJsonRpcError,
  JSON_RPC_ERRORS: {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603
  },
  MCP_TOOLS: [
    { name: 'list_templates', description: 'List templates', inputSchema: { type: 'object', properties: {} } },
    { name: 'list_tools', description: 'List tools', inputSchema: { type: 'object', properties: {} } }
  ]
}));

// --- Require the module under test AFTER all mocks ---
const Routes = require('../../../routes');

describe('/mcp/v1 Routing', () => {
  const mockContext = { requestId: 'test-req-id' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------
  // POST /mcp/v1 → delegates to JSON-RPC Router
  // ---------------------------------------------------------------
  describe('POST /mcp/v1 delegates to JSON-RPC Router', () => {
    test('delegates POST to handleJsonRpc and wraps response with finalize', async () => {
      const jsonRpcResponse = {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'req-1', result: {} })
      };
      mockHandleJsonRpc.mockResolvedValue(jsonRpcResponse);

      const event = {
        path: '/mcp/v1',
        httpMethod: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 'req-1' })
      };

      const result = await Routes.process(event, mockContext);

      expect(mockHandleJsonRpc).toHaveBeenCalledWith(event, mockContext);
      expect(typeof result.finalize).toBe('function');
      expect(result.finalize()).toEqual(jsonRpcResponse);
    });

    test('detects /mcp/v1 from requestContext.resourcePath when event.path is absent', async () => {
      const jsonRpcResponse = { statusCode: 200, body: '{}' };
      mockHandleJsonRpc.mockResolvedValue(jsonRpcResponse);

      const event = {
        requestContext: { resourcePath: '/mcp/v1' },
        httpMethod: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
      };

      const result = await Routes.process(event, mockContext);

      expect(mockHandleJsonRpc).toHaveBeenCalledWith(event, mockContext);
      expect(typeof result.finalize).toBe('function');
    });
  });

  // ---------------------------------------------------------------
  // Non-POST or non-/mcp/v1 requests return error
  // ---------------------------------------------------------------
  describe('Rejects non-POST and non-/mcp/v1 requests', () => {
    test('GET /mcp/v1 returns error response', async () => {
      const errorResponse = { statusCode: 400, body: '{"error":"not found"}' };
      mockBuildResponse.mockReturnValue(errorResponse);

      const event = { path: '/mcp/v1', httpMethod: 'GET' };

      const result = await Routes.process(event, mockContext);

      expect(mockHandleJsonRpc).not.toHaveBeenCalled();
      expect(mockJsonRpcError).toHaveBeenCalled();
      expect(mockBuildResponse).toHaveBeenCalledWith(400, expect.anything());
      expect(typeof result.finalize).toBe('function');
      expect(result.finalize()).toEqual(errorResponse);
    });

    test('POST /mcp/list_templates returns error (legacy path removed)', async () => {
      const errorResponse = { statusCode: 400, body: '{"error":"not found"}' };
      mockBuildResponse.mockReturnValue(errorResponse);

      const event = {
        path: '/mcp/list_templates',
        httpMethod: 'POST',
        body: JSON.stringify({ tool: 'list_templates' })
      };

      const result = await Routes.process(event, mockContext);

      expect(mockHandleJsonRpc).not.toHaveBeenCalled();
      expect(mockBuildResponse).toHaveBeenCalledWith(400, expect.anything());
      expect(typeof result.finalize).toBe('function');
    });

    test('POST to unknown path returns error', async () => {
      const errorResponse = { statusCode: 400, body: '{"error":"not found"}' };
      mockBuildResponse.mockReturnValue(errorResponse);

      const event = {
        path: '/mcp/unknown_tool',
        httpMethod: 'POST',
        body: '{}'
      };

      const result = await Routes.process(event, mockContext);

      expect(mockHandleJsonRpc).not.toHaveBeenCalled();
      expect(mockBuildResponse).toHaveBeenCalledWith(400, expect.anything());
    });
  });
});
