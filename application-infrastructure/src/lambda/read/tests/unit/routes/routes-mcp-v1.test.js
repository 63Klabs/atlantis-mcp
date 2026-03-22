/**
 * Unit Tests for /mcp/v1 Routing
 *
 * Tests the Routes.process() function in routes/index.js for correct
 * delegation of /mcp/v1 requests to the JSON-RPC Router, GET /mcp/v1
 * returning the tools list, backward compatibility of legacy per-tool
 * endpoints, and legacy request routing (no jsonrpc field).
 *
 * Validates: Requirements 3.2, 3.4, 8.1, 8.3
 */

// --- Mock @63klabs/cache-data before any require ---
const mockIsValid = jest.fn().mockReturnValue(true);
const mockGetProps = jest.fn();
const mockSetBody = jest.fn();
const mockReset = jest.fn().mockImplementation((opts) => ({
  statusCode: opts.statusCode,
  body: opts.body,
  finalize: () => ({ statusCode: opts.statusCode, body: JSON.stringify(opts.body) })
}));

const mockResponseInstance = {
  setBody: mockSetBody,
  reset: mockReset,
  finalize: jest.fn().mockReturnValue({ statusCode: 200, body: '{}' })
};

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    ClientRequest: jest.fn().mockImplementation(() => ({
      isValid: mockIsValid,
      getProps: mockGetProps
    })),
    Response: jest.fn().mockImplementation(() => mockResponseInstance),
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
const mockToolsListResponse = jest.fn();
const MOCK_MCP_TOOLS = [
  { name: 'list_templates', description: 'List templates', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_tools', description: 'List tools', inputSchema: { type: 'object', properties: {} } }
];

jest.mock('../../../utils/mcp-protocol', () => ({
  toolsListResponse: mockToolsListResponse,
  MCP_TOOLS: MOCK_MCP_TOOLS
}));

// --- Mock error-handler ---
jest.mock('../../../utils/error-handler', () => ({
  createError: jest.fn().mockImplementation((opts) => {
    const err = new Error(opts.message);
    err.code = opts.code;
    err.statusCode = opts.statusCode;
    err.category = opts.category;
    err.details = opts.details;
    return err;
  }),
  logError: jest.fn(),
  toUserResponse: jest.fn().mockReturnValue({ error: 'mocked error' }),
  getStatusCode: jest.fn().mockReturnValue(500),
  ErrorCode: {
    INVALID_INPUT: 'INVALID_INPUT',
    METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
    UNKNOWN_TOOL: 'UNKNOWN_TOOL'
  },
  ErrorCategory: {
    CLIENT_ERROR: 'CLIENT_ERROR',
    NOT_FOUND: 'NOT_FOUND'
  }
}));

// --- Mock controllers (used by legacy routing switch) ---
jest.mock('../../../controllers/templates', () => ({
  list: jest.fn().mockResolvedValue({ success: true, data: [] }),
  get: jest.fn().mockResolvedValue({ success: true, data: {} }),
  listVersions: jest.fn().mockResolvedValue({ success: true, data: [] }),
  listCategories: jest.fn().mockResolvedValue({ success: true, data: [] })
}));

jest.mock('../../../controllers/starters', () => ({
  list: jest.fn().mockResolvedValue({ success: true, data: [] }),
  get: jest.fn().mockResolvedValue({ success: true, data: {} })
}));

jest.mock('../../../controllers/documentation', () => ({
  search: jest.fn().mockResolvedValue({ success: true, data: [] })
}));

jest.mock('../../../controllers/validation', () => ({
  validate: jest.fn().mockResolvedValue({ success: true, data: {} })
}));

jest.mock('../../../controllers/updates', () => ({
  check: jest.fn().mockResolvedValue({ success: true, data: {} })
}));

jest.mock('../../../controllers/tools', () => ({
  list: jest.fn().mockResolvedValue({ success: true, data: MOCK_MCP_TOOLS })
}));

// --- Mock config/settings (used by legacy GET-eligibility check) ---
jest.mock('../../../config/settings', () => ({
  tools: {
    availableToolsList: [
      { name: 'list_templates', inputSchema: { type: 'object', properties: {} } },
      { name: 'list_tools', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_template', inputSchema: { type: 'object', properties: { name: {} }, required: ['name'] } }
    ],
    getGetEligibleTools: jest.fn().mockReturnValue(['list_templates', 'list_tools'])
  }
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
  // Validates: Requirements 3.2
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
  // GET /mcp/v1 → returns 200 with tool list
  // Validates: Requirements 3.4
  // ---------------------------------------------------------------
  describe('GET /mcp/v1 returns 200 with tool list', () => {
    test('returns toolsListResponse wrapped in finalize', async () => {
      const toolsBody = { jsonrpc: '2.0', id: null, result: { tools: MOCK_MCP_TOOLS } };
      mockToolsListResponse.mockReturnValue(toolsBody);

      const builtResponse = {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toolsBody)
      };
      mockBuildResponse.mockReturnValue(builtResponse);

      const event = {
        path: '/mcp/v1',
        httpMethod: 'GET'
      };

      const result = await Routes.process(event, mockContext);

      expect(mockToolsListResponse).toHaveBeenCalledWith(null, MOCK_MCP_TOOLS);
      expect(mockBuildResponse).toHaveBeenCalledWith(200, toolsBody);
      expect(typeof result.finalize).toBe('function');
      expect(result.finalize()).toEqual(builtResponse);
    });
  });

  // ---------------------------------------------------------------
  // Legacy per-tool endpoints still work (backward compatibility)
  // Validates: Requirements 8.1, 8.3
  // ---------------------------------------------------------------
  describe('Legacy per-tool endpoints (backward compatibility)', () => {
    test('POST to /mcp/list_tools routes through legacy switch, not JSON-RPC Router', async () => {
      mockGetProps.mockReturnValue({
        method: 'POST',
        path: '/mcp/list_tools',
        pathArray: ['mcp', 'list_tools'],
        bodyParameters: { tool: 'list_tools' }
      });

      const event = {
        path: '/mcp/list_tools',
        httpMethod: 'POST',
        body: JSON.stringify({ tool: 'list_tools' })
      };

      await Routes.process(event, mockContext);

      // JSON-RPC Router should NOT have been called
      expect(mockHandleJsonRpc).not.toHaveBeenCalled();

      // The legacy controller should have been called
      const ToolsController = require('../../../controllers/tools');
      expect(ToolsController.list).toHaveBeenCalled();
    });

    test('POST to /mcp/list_templates routes to Templates controller', async () => {
      mockGetProps.mockReturnValue({
        method: 'POST',
        path: '/mcp/list_templates',
        pathArray: ['mcp', 'list_templates'],
        bodyParameters: { tool: 'list_templates' }
      });

      const event = {
        path: '/mcp/list_templates',
        httpMethod: 'POST',
        body: JSON.stringify({ tool: 'list_templates' })
      };

      await Routes.process(event, mockContext);

      expect(mockHandleJsonRpc).not.toHaveBeenCalled();

      const TemplatesController = require('../../../controllers/templates');
      expect(TemplatesController.list).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // Legacy requests (no jsonrpc field) use legacy routing
  // Validates: Requirements 8.1, 8.3
  // ---------------------------------------------------------------
  describe('Legacy requests without jsonrpc field use legacy routing', () => {
    test('POST to non-/mcp/v1 path with legacy body uses legacy routing', async () => {
      mockGetProps.mockReturnValue({
        method: 'POST',
        path: '/mcp/search_documentation',
        pathArray: ['mcp', 'search_documentation'],
        bodyParameters: {
          tool: 'search_documentation',
          input: { query: 'test' }
        }
      });

      const event = {
        path: '/mcp/search_documentation',
        httpMethod: 'POST',
        body: JSON.stringify({
          tool: 'search_documentation',
          input: { query: 'test' }
        })
      };

      await Routes.process(event, mockContext);

      // JSON-RPC Router should NOT be called for legacy endpoints
      expect(mockHandleJsonRpc).not.toHaveBeenCalled();

      const DocController = require('../../../controllers/documentation');
      expect(DocController.search).toHaveBeenCalled();
    });

    test('legacy request body without jsonrpc field does not trigger JSON-RPC path', async () => {
      mockGetProps.mockReturnValue({
        method: 'POST',
        path: '/mcp/validate_naming',
        pathArray: ['mcp', 'validate_naming'],
        bodyParameters: {
          tool: 'validate_naming',
          input: { name: 'my-stack' }
        }
      });

      const event = {
        path: '/mcp/validate_naming',
        httpMethod: 'POST',
        body: JSON.stringify({
          tool: 'validate_naming',
          input: { name: 'my-stack' }
        })
      };

      await Routes.process(event, mockContext);

      expect(mockHandleJsonRpc).not.toHaveBeenCalled();

      const ValidationController = require('../../../controllers/validation');
      expect(ValidationController.validate).toHaveBeenCalled();
    });
  });
});
