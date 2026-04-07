/**
 * Unit Tests for /mcp/v1 Routing
 *
 * Tests the Routes.process() function in routes/index.js for correct
 * delegation of POST /mcp/v1 requests to the JSON-RPC Router and
 * rejection of all other paths/methods.
 *
 * Routes.process now accepts (clientRequest, response, event, context)
 * and populates the response instance instead of returning a wrapper.
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
  let mockClientRequest;
  let mockResponse;
  const mockContext = { requestId: 'test-req-id' };

  beforeEach(() => {
    jest.clearAllMocks();

    mockClientRequest = {
      getProps: jest.fn().mockReturnValue({ path: 'mcp/v1', method: 'POST' })
    };

    mockResponse = {
      setStatusCode: jest.fn().mockReturnThis(),
      setBody: jest.fn().mockReturnThis(),
      addHeader: jest.fn().mockReturnThis()
    };
  });

  // ---------------------------------------------------------------
  // POST /mcp/v1 → delegates to JSON-RPC Router
  // ---------------------------------------------------------------
  describe('POST /mcp/v1 delegates to JSON-RPC Router', () => {
    test('delegates POST to handleJsonRpc and populates response', async () => {
      const jsonRpcResult = { jsonrpc: '2.0', id: 'req-1', result: {} };
      const jsonRpcResponse = {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonRpcResult)
      };
      mockHandleJsonRpc.mockResolvedValue(jsonRpcResponse);

      const event = {
        path: '/mcp/v1',
        httpMethod: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 'req-1' })
      };

      const result = await Routes.process(mockClientRequest, mockResponse, event, mockContext);

      expect(mockHandleJsonRpc).toHaveBeenCalledWith(event, mockContext);
      expect(mockResponse.setStatusCode).toHaveBeenCalledWith(200);
      expect(mockResponse.setBody).toHaveBeenCalledWith(jsonRpcResult);
      expect(result).toBeUndefined();
    });

    test('forwards non-CORS headers from JSON-RPC Router to response', async () => {
      const jsonRpcResponse = {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })
      };
      mockHandleJsonRpc.mockResolvedValue(jsonRpcResponse);

      const event = { path: '/mcp/v1', httpMethod: 'POST', body: '{}' };

      await Routes.process(mockClientRequest, mockResponse, event, mockContext);

      // Custom header should be forwarded
      expect(mockResponse.addHeader).toHaveBeenCalledWith('X-Custom-Header', 'custom-value');
      // CORS headers should NOT be forwarded (managed by Response.finalize())
      const addHeaderCalls = mockResponse.addHeader.mock.calls.map(c => c[0]);
      expect(addHeaderCalls).not.toContain('Content-Type');
      expect(addHeaderCalls).not.toContain('Access-Control-Allow-Origin');
    });

    test('detects /mcp/v1 from clientRequest.getProps().path', async () => {
      mockClientRequest.getProps.mockReturnValue({ path: 'stage/mcp/v1', method: 'POST' });
      const jsonRpcResponse = { statusCode: 200, body: '{}' };
      mockHandleJsonRpc.mockResolvedValue(jsonRpcResponse);

      const event = {
        requestContext: { resourcePath: '/mcp/v1' },
        httpMethod: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
      };

      const result = await Routes.process(mockClientRequest, mockResponse, event, mockContext);

      expect(mockHandleJsonRpc).toHaveBeenCalledWith(event, mockContext);
      expect(mockResponse.setStatusCode).toHaveBeenCalledWith(200);
      expect(result).toBeUndefined();
    });

    test('still passes raw event and context to handleJsonRpc', async () => {
      const jsonRpcResponse = { statusCode: 200, body: '{}' };
      mockHandleJsonRpc.mockResolvedValue(jsonRpcResponse);

      const event = { path: '/mcp/v1', httpMethod: 'POST', body: '{}' };

      await Routes.process(mockClientRequest, mockResponse, event, mockContext);

      expect(mockHandleJsonRpc).toHaveBeenCalledWith(event, mockContext);
    });
  });

  // ---------------------------------------------------------------
  // Non-POST or non-/mcp/v1 requests return error
  // ---------------------------------------------------------------
  describe('Rejects non-POST and non-/mcp/v1 requests', () => {
    test('GET /mcp/v1 sets error on response', async () => {
      mockClientRequest.getProps.mockReturnValue({ path: 'mcp/v1', method: 'GET' });

      const event = { path: '/mcp/v1', httpMethod: 'GET' };

      const result = await Routes.process(mockClientRequest, mockResponse, event, mockContext);

      expect(mockHandleJsonRpc).not.toHaveBeenCalled();
      expect(mockJsonRpcError).toHaveBeenCalled();
      expect(mockResponse.setStatusCode).toHaveBeenCalledWith(400);
      expect(mockResponse.setBody).toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    test('POST /mcp/list_templates sets error (legacy path removed)', async () => {
      mockClientRequest.getProps.mockReturnValue({ path: '/mcp/list_templates', method: 'POST' });

      const event = {
        path: '/mcp/list_templates',
        httpMethod: 'POST',
        body: JSON.stringify({ tool: 'list_templates' })
      };

      const result = await Routes.process(mockClientRequest, mockResponse, event, mockContext);

      expect(mockHandleJsonRpc).not.toHaveBeenCalled();
      expect(mockResponse.setStatusCode).toHaveBeenCalledWith(400);
      expect(result).toBeUndefined();
    });

    test('POST to unknown path sets error on response', async () => {
      mockClientRequest.getProps.mockReturnValue({ path: '/mcp/unknown_tool', method: 'POST' });

      const event = {
        path: '/mcp/unknown_tool',
        httpMethod: 'POST',
        body: '{}'
      };

      const result = await Routes.process(mockClientRequest, mockResponse, event, mockContext);

      expect(mockHandleJsonRpc).not.toHaveBeenCalled();
      expect(mockResponse.setStatusCode).toHaveBeenCalledWith(400);
      expect(result).toBeUndefined();
    });
  });
});
