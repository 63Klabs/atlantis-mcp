/**
 * Unit Tests for GET Method Handling in Router
 *
 * Feature: allow-get-on-tools-that-list
 *
 * Tests that the router correctly handles GET requests:
 * - GET to GET-eligible tools returns 200
 * - GET query string parameters are mapped to controller input
 * - GET to non-GET-eligible tools returns 405
 * - GET to unknown tools returns 400 (not 405) — 400 avoids CloudFront 404 interception
 * - POST continues to work for all tools after GET support
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 7.2, 7.3, 7.4, 7.5
 */

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

// Track createError calls to inspect error details
let lastCreateErrorOpts = null;

// Mock @63klabs/cache-data
const mockResponseInstance = {
  addHeader: jest.fn().mockReturnThis(),
  setBody: jest.fn().mockReturnThis(),
  reset: jest.fn().mockImplementation(function (opts) {
    this.statusCode = opts.statusCode;
    this.body = opts.body;
    return this;
  }),
  finalize: jest.fn()
};

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    ClientRequest: jest.fn().mockImplementation(() => ({
      isValid: jest.fn().mockReturnValue(true),
      getProps: jest.fn().mockReturnValue({
        method: 'POST',
        path: '/mcp',
        bodyParameters: { tool: 'PLACEHOLDER' },
        pathParameters: {},
        pathArray: ['', 'PLACEHOLDER'],
        queryStringParameters: null,
        body: {}
      })
    })),
    Response: jest.fn().mockImplementation(() => mockResponseInstance),
    DebugAndLog: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    CachedSsmParameter: jest.fn().mockImplementation(() => ({
      getValue: jest.fn().mockResolvedValue('mock-value')
    }))
  }
}));

// Mock error handler — capture createError opts for inspection
jest.mock('../../../utils/error-handler', () => ({
  createError: jest.fn().mockImplementation((opts) => {
    lastCreateErrorOpts = opts;
    const err = new Error(opts.message);
    err.code = opts.code;
    err.category = opts.category;
    err.statusCode = opts.statusCode;
    err.details = opts.details;
    err.availableTools = opts.details?.availableTools;
    err.requestId = opts.requestId;
    return err;
  }),
  logError: jest.fn(),
  toUserResponse: jest.fn().mockReturnValue({ error: 'mock error response' }),
  getStatusCode: jest.fn().mockReturnValue(500),
  ErrorCode: {
    INVALID_INPUT: 'INVALID_INPUT',
    UNKNOWN_TOOL: 'UNKNOWN_TOOL',
    METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
    INTERNAL_ERROR: 'INTERNAL_ERROR'
  },
  ErrorCategory: {
    CLIENT_ERROR: 'CLIENT_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    SERVER_ERROR: 'SERVER_ERROR'
  }
}));

// Mock controllers
jest.mock('../../../controllers/templates', () => ({
  list: jest.fn().mockResolvedValue({ tool: 'list_templates', templates: [] }),
  get: jest.fn().mockResolvedValue({ tool: 'get_template', template: {} }),
  listVersions: jest.fn().mockResolvedValue({ tool: 'list_template_versions', versions: [] }),
  listCategories: jest.fn().mockResolvedValue({ tool: 'list_categories', categories: [] })
}));

jest.mock('../../../controllers/tools', () => ({
  list: jest.fn().mockResolvedValue({ tool: 'list_tools', tools: [] })
}));

jest.mock('../../../controllers/starters', () => ({
  list: jest.fn().mockResolvedValue({ tool: 'list_starters', starters: [] }),
  get: jest.fn().mockResolvedValue({ tool: 'get_starter_info', starter: {} })
}));

jest.mock('../../../controllers/documentation', () => ({
  search: jest.fn().mockResolvedValue({ tool: 'search_documentation', results: [] })
}));

jest.mock('../../../controllers/validation', () => ({
  validate: jest.fn().mockResolvedValue({ tool: 'validate_naming', valid: true })
}));

jest.mock('../../../controllers/updates', () => ({
  check: jest.fn().mockResolvedValue({ tool: 'check_template_updates', updates: [] })
}));

const { tools: { ClientRequest } } = require('@63klabs/cache-data');
const Routes = require('../../../routes');
const ToolsController = require('../../../controllers/tools');
const TemplatesController = require('../../../controllers/templates');

describe('Feature: allow-get-on-tools-that-list — GET method handling', () => {

  const mockContext = { requestId: 'test-request-id' };

  beforeEach(() => {
    jest.clearAllMocks();
    lastCreateErrorOpts = null;
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;
  });

  /**
   * **Validates: Requirements 4.1, 7.2**
   *
   * GET request to a GET-eligible tool (list_tools) should return 200.
   */
  test('GET request to list_tools returns 200', async () => {
    ClientRequest.mockImplementation(() => ({
      isValid: jest.fn().mockReturnValue(true),
      getProps: jest.fn().mockReturnValue({
        method: 'GET',
        path: '/mcp/list_tools',
        bodyParameters: {},
        pathParameters: { tool: 'list_tools' },
        pathArray: ['', 'list_tools'],
        queryStringParameters: null,
        body: {}
      })
    }));

    const mockEvent = { httpMethod: 'GET', path: '/mcp/list_tools' };
    const result = await Routes.process(mockEvent, mockContext);

    // Should route to ToolsController.list, not return an error
    expect(ToolsController.list).toHaveBeenCalled();
    expect(lastCreateErrorOpts).toBeNull();
  });

  /**
   * **Validates: Requirements 4.2, 7.4**
   *
   * GET request to list_templates with query string parameters should
   * map them into bodyParameters.input for the controller.
   */
  test('GET request to list_templates?category=storage passes category to controller', async () => {
    ClientRequest.mockImplementation(() => ({
      isValid: jest.fn().mockReturnValue(true),
      getProps: jest.fn().mockReturnValue({
        method: 'GET',
        path: '/mcp/list_templates',
        bodyParameters: {},
        pathParameters: { tool: 'list_templates' },
        pathArray: ['', 'list_templates'],
        queryStringParameters: { category: 'storage' },
        body: {}
      })
    }));

    const mockEvent = { httpMethod: 'GET', path: '/mcp/list_templates', queryStringParameters: { category: 'storage' } };
    await Routes.process(mockEvent, mockContext);

    expect(TemplatesController.list).toHaveBeenCalled();
    const calledProps = TemplatesController.list.mock.calls[0][0];
    expect(calledProps.bodyParameters.input).toEqual({ category: 'storage' });
  });

  /**
   * **Validates: Requirements 4.3, 7.3**
   *
   * GET request to a non-GET-eligible tool (get_template) should return 405.
   */
  test('GET request to get_template returns 405 with METHOD_NOT_ALLOWED', async () => {
    ClientRequest.mockImplementation(() => ({
      isValid: jest.fn().mockReturnValue(true),
      getProps: jest.fn().mockReturnValue({
        method: 'GET',
        path: '/mcp/get_template',
        bodyParameters: {},
        pathParameters: { tool: 'get_template' },
        pathArray: ['', 'get_template'],
        queryStringParameters: null,
        body: {}
      })
    }));

    const mockEvent = { httpMethod: 'GET', path: '/mcp/get_template' };
    await Routes.process(mockEvent, mockContext);

    expect(lastCreateErrorOpts).not.toBeNull();
    expect(lastCreateErrorOpts.code).toBe('METHOD_NOT_ALLOWED');
    expect(lastCreateErrorOpts.statusCode).toBe(405);
    expect(mockResponseInstance.statusCode).toBe(405);
  });

  /**
   * **Validates: Requirements 4.3, 7.3**
   *
   * GET request to search_documentation (has required params) should return 405.
   */
  test('GET request to search_documentation returns 405', async () => {
    ClientRequest.mockImplementation(() => ({
      isValid: jest.fn().mockReturnValue(true),
      getProps: jest.fn().mockReturnValue({
        method: 'GET',
        path: '/mcp/search_documentation',
        bodyParameters: {},
        pathParameters: { tool: 'search_documentation' },
        pathArray: ['', 'search_documentation'],
        queryStringParameters: null,
        body: {}
      })
    }));

    const mockEvent = { httpMethod: 'GET', path: '/mcp/search_documentation' };
    await Routes.process(mockEvent, mockContext);

    expect(lastCreateErrorOpts).not.toBeNull();
    expect(lastCreateErrorOpts.code).toBe('METHOD_NOT_ALLOWED');
    expect(lastCreateErrorOpts.statusCode).toBe(405);
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * GET request to an unknown tool should return 400 (not 405).
   * Unknown tools fall through to the switch default regardless of method.
   * 400 is used instead of 404 because CloudFront intercepts 404s.
   */
  test('GET request to unknown tool returns 400 (not 405)', async () => {
    ClientRequest.mockImplementation(() => ({
      isValid: jest.fn().mockReturnValue(true),
      getProps: jest.fn().mockReturnValue({
        method: 'GET',
        path: '/mcp/nonexistent_tool',
        bodyParameters: {},
        pathParameters: { tool: 'nonexistent_tool' },
        pathArray: ['', 'nonexistent_tool'],
        queryStringParameters: null,
        body: {}
      })
    }));

    const mockEvent = { httpMethod: 'GET', path: '/mcp/nonexistent_tool' };
    await Routes.process(mockEvent, mockContext);

    expect(lastCreateErrorOpts).not.toBeNull();
    expect(lastCreateErrorOpts.code).toBe('UNKNOWN_TOOL');
    expect(lastCreateErrorOpts.statusCode).toBe(400);
    expect(mockResponseInstance.statusCode).toBe(400);
  });

  /**
   * **Validates: Requirements 4.4, 7.5**
   *
   * POST request to list_tools should still work after GET support is added.
   */
  test('POST request to list_tools still works after GET support added', async () => {
    ClientRequest.mockImplementation(() => ({
      isValid: jest.fn().mockReturnValue(true),
      getProps: jest.fn().mockReturnValue({
        method: 'POST',
        path: '/mcp',
        bodyParameters: { tool: 'list_tools', input: {} },
        pathParameters: {},
        pathArray: ['', 'list_tools'],
        queryStringParameters: null,
        body: {}
      })
    }));

    const mockEvent = { body: JSON.stringify({ tool: 'list_tools' }) };
    await Routes.process(mockEvent, mockContext);

    expect(ToolsController.list).toHaveBeenCalled();
    expect(lastCreateErrorOpts).toBeNull();
  });

  /**
   * **Validates: Requirements 4.4, 7.5**
   *
   * POST request to get_template should still work after GET support is added.
   */
  test('POST request to get_template still works after GET support added', async () => {
    ClientRequest.mockImplementation(() => ({
      isValid: jest.fn().mockReturnValue(true),
      getProps: jest.fn().mockReturnValue({
        method: 'POST',
        path: '/mcp',
        bodyParameters: { tool: 'get_template', input: { templateName: 'test', category: 'storage' } },
        pathParameters: {},
        pathArray: ['', 'get_template'],
        queryStringParameters: null,
        body: {}
      })
    }));

    const mockEvent = { body: JSON.stringify({ tool: 'get_template', input: { templateName: 'test', category: 'storage' } }) };
    await Routes.process(mockEvent, mockContext);

    expect(TemplatesController.get).toHaveBeenCalled();
    expect(lastCreateErrorOpts).toBeNull();
  });
});
