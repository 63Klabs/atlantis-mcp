/**
 * Unit Tests for GET/POST Response Parity
 *
 * Feature: allow-get-on-tools-that-list
 *
 * Tests that GET and POST requests to the same tool produce identical responses:
 * - GET and POST to list_tools return same response body structure
 * - GET and POST to list_templates return same response body structure
 * - Error responses from GET have same format as POST errors
 * - CORS headers are identical for GET and POST responses
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 7.6
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
const ErrorHandler = require('../../../utils/error-handler');

describe('Feature: allow-get-on-tools-that-list — GET/POST response parity', () => {

  const mockContext = { requestId: 'test-request-id' };

  beforeEach(() => {
    jest.clearAllMocks();
    lastCreateErrorOpts = null;
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;
  });

  /**
   * **Validates: Requirements 5.1, 7.6**
   *
   * GET and POST to list_tools should call the same controller and
   * produce the same response body via setBody.
   */
  test('GET and POST to list_tools return same response body', async () => {
    // --- GET request ---
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

    const getEvent = { httpMethod: 'GET', path: '/mcp/list_tools' };
    await Routes.process(getEvent, mockContext);

    expect(ToolsController.list).toHaveBeenCalledTimes(1);
    const getSetBodyCalls = mockResponseInstance.setBody.mock.calls.slice();

    jest.clearAllMocks();
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;

    // --- POST request ---
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

    const postEvent = { body: JSON.stringify({ tool: 'list_tools' }) };
    await Routes.process(postEvent, mockContext);

    expect(ToolsController.list).toHaveBeenCalledTimes(1);
    const postSetBodyCalls = mockResponseInstance.setBody.mock.calls.slice();

    // Both should have called setBody with the same resolved value
    expect(getSetBodyCalls.length).toBe(1);
    expect(postSetBodyCalls.length).toBe(1);
    expect(getSetBodyCalls[0]).toEqual(postSetBodyCalls[0]);
  });

  /**
   * **Validates: Requirements 5.1, 5.2, 7.6**
   *
   * GET and POST to list_templates should call the same controller and
   * produce the same response body via setBody.
   */
  test('GET and POST to list_templates return same response body', async () => {
    // --- GET request ---
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

    const getEvent = { httpMethod: 'GET', path: '/mcp/list_templates', queryStringParameters: { category: 'storage' } };
    await Routes.process(getEvent, mockContext);

    expect(TemplatesController.list).toHaveBeenCalledTimes(1);
    const getSetBodyCalls = mockResponseInstance.setBody.mock.calls.slice();

    jest.clearAllMocks();
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;

    // --- POST request ---
    ClientRequest.mockImplementation(() => ({
      isValid: jest.fn().mockReturnValue(true),
      getProps: jest.fn().mockReturnValue({
        method: 'POST',
        path: '/mcp',
        bodyParameters: { tool: 'list_templates', input: { category: 'storage' } },
        pathParameters: {},
        pathArray: ['', 'list_templates'],
        queryStringParameters: null,
        body: {}
      })
    }));

    const postEvent = { body: JSON.stringify({ tool: 'list_templates', input: { category: 'storage' } }) };
    await Routes.process(postEvent, mockContext);

    expect(TemplatesController.list).toHaveBeenCalledTimes(1);
    const postSetBodyCalls = mockResponseInstance.setBody.mock.calls.slice();

    // Both should have called setBody with the same resolved value
    expect(getSetBodyCalls.length).toBe(1);
    expect(postSetBodyCalls.length).toBe(1);
    expect(getSetBodyCalls[0]).toEqual(postSetBodyCalls[0]);
  });

  /**
   * **Validates: Requirements 5.3, 7.6**
   *
   * When a controller throws an error, both GET and POST should produce
   * the same error response format via RESP.reset().
   */
  test('Error responses from GET have same format as POST errors', async () => {
    // Make the tools controller throw an error for both requests
    const controllerError = new Error('Controller failure');
    ToolsController.list.mockRejectedValue(controllerError);

    // --- GET request ---
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

    const getEvent = { httpMethod: 'GET', path: '/mcp/list_tools' };
    await Routes.process(getEvent, mockContext);

    // Capture GET error response
    const getResetCalls = mockResponseInstance.reset.mock.calls.slice();

    jest.clearAllMocks();
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;
    ToolsController.list.mockRejectedValue(controllerError);

    // --- POST request ---
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

    const postEvent = { body: JSON.stringify({ tool: 'list_tools' }) };
    await Routes.process(postEvent, mockContext);

    // Capture POST error response
    const postResetCalls = mockResponseInstance.reset.mock.calls.slice();

    // Both should have called reset with the same error format
    expect(getResetCalls.length).toBe(1);
    expect(postResetCalls.length).toBe(1);
    expect(getResetCalls[0]).toEqual(postResetCalls[0]);
  });

  /**
   * **Validates: Requirements 5.2, 7.6**
   *
   * Since CORS headers are added by API Gateway (not the Lambda), the test
   * verifies that the Response object behavior is the same for both methods:
   * same setBody calls and same return value from Routes.process().
   */
  test('Response object behavior is identical for GET and POST', async () => {
    // --- GET request ---
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

    const getEvent = { httpMethod: 'GET', path: '/mcp/list_tools' };
    const getResult = await Routes.process(getEvent, mockContext);

    // Capture GET response interactions
    const getSetBodyCount = mockResponseInstance.setBody.mock.calls.length;
    const getResetCount = mockResponseInstance.reset.mock.calls.length;

    jest.clearAllMocks();
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;

    // --- POST request ---
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

    const postEvent = { body: JSON.stringify({ tool: 'list_tools' }) };
    const postResult = await Routes.process(postEvent, mockContext);

    // Capture POST response interactions
    const postSetBodyCount = mockResponseInstance.setBody.mock.calls.length;
    const postResetCount = mockResponseInstance.reset.mock.calls.length;

    // Both should interact with the Response object the same way
    expect(getSetBodyCount).toBe(postSetBodyCount);
    expect(getResetCount).toBe(postResetCount);

    // Both return the same mock response instance
    expect(getResult).toBe(postResult);
  });
});
