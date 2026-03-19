/**
 * Property-Based Tests for GET/POST Error Response Parity
 *
 * Feature: allow-get-on-tools-that-list
 * Property 6: GET and POST error response parity
 *
 * For any error condition that can occur while processing a GET request
 * to a GET-eligible tool, the error response format (status code, error
 * body structure, CORS headers) must match the format that would be
 * returned for the same error triggered via POST.
 *
 * Validates: Requirements 5.3
 */

const fc = require('fast-check');

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

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
        path: '/mcp/PLACEHOLDER',
        bodyParameters: { tool: 'PLACEHOLDER', input: {} },
        pathParameters: { tool: 'PLACEHOLDER' },
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

// Mock error handler
jest.mock('../../../utils/error-handler', () => ({
  createError: jest.fn().mockImplementation((opts) => {
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
const mockToolsList = jest.fn().mockResolvedValue({ tool: 'list_tools', tools: [] });
const mockTemplatesList = jest.fn().mockResolvedValue({ tool: 'list_templates', templates: [] });
const mockListCategories = jest.fn().mockResolvedValue({ tool: 'list_categories', categories: [] });
const mockStartersList = jest.fn().mockResolvedValue({ tool: 'list_starters', starters: [] });

jest.mock('../../../controllers/tools', () => ({
  list: mockToolsList
}));

jest.mock('../../../controllers/templates', () => ({
  list: mockTemplatesList,
  get: jest.fn().mockResolvedValue({ tool: 'get_template', template: {} }),
  listVersions: jest.fn().mockResolvedValue({ tool: 'list_template_versions', versions: [] }),
  listCategories: mockListCategories
}));

jest.mock('../../../controllers/starters', () => ({
  list: mockStartersList,
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

/**
 * Map GET-eligible tool names to their controller mock functions.
 */
const controllerMockMap = {
  list_tools: mockToolsList,
  list_templates: mockTemplatesList,
  list_categories: mockListCategories,
  list_starters: mockStartersList
};

describe('Feature: allow-get-on-tools-that-list, Property 6: GET and POST error response parity', () => {

  const getEligibleTools = ['list_tools', 'list_templates', 'list_categories', 'list_starters'];
  const mockContext = { requestId: 'test-request-id' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * For each GET-eligible tool, trigger an error by making the controller
   * reject with a random error message. Verify that both GET and POST
   * produce the same error response via RESP.reset().
   */
  test('GET and POST error responses have the same format for any GET-eligible tool', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...getEligibleTools),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (toolName, errorMessage) => {
          // Make the relevant controller reject
          const controllerMock = controllerMockMap[toolName];
          controllerMock.mockRejectedValue(new Error(errorMessage));

          // --- GET request ---
          ClientRequest.mockImplementation(() => ({
            isValid: jest.fn().mockReturnValue(true),
            getProps: jest.fn().mockReturnValue({
              method: 'GET',
              path: `/mcp/${toolName}`,
              bodyParameters: {},
              pathParameters: { tool: toolName },
              pathArray: ['', toolName],
              queryStringParameters: null,
              body: {}
            })
          }));

          mockResponseInstance.reset.mockClear();
          mockResponseInstance.setBody.mockClear();
          mockResponseInstance.statusCode = undefined;
          mockResponseInstance.body = undefined;

          await Routes.process(
            { httpMethod: 'GET', path: `/mcp/${toolName}` },
            mockContext
          );

          const getResetCalls = mockResponseInstance.reset.mock.calls.slice();

          // --- POST request ---
          ClientRequest.mockImplementation(() => ({
            isValid: jest.fn().mockReturnValue(true),
            getProps: jest.fn().mockReturnValue({
              method: 'POST',
              path: `/mcp/${toolName}`,
              bodyParameters: { tool: toolName, input: {} },
              pathParameters: { tool: toolName },
              pathArray: ['', toolName],
              queryStringParameters: null,
              body: { tool: toolName, input: {} }
            })
          }));

          mockResponseInstance.reset.mockClear();
          mockResponseInstance.setBody.mockClear();
          mockResponseInstance.statusCode = undefined;
          mockResponseInstance.body = undefined;

          await Routes.process(
            { httpMethod: 'POST', path: `/mcp/${toolName}` },
            mockContext
          );

          const postResetCalls = mockResponseInstance.reset.mock.calls.slice();

          // Both should have triggered the error path via reset
          expect(getResetCalls.length).toBe(postResetCalls.length);
          expect(getResetCalls.length).toBeGreaterThan(0);

          // Both should have the same error response arguments
          expect(getResetCalls[0]).toEqual(postResetCalls[0]);

          // Restore the controller mock for next iteration
          controllerMock.mockReset();
        }
      ),
      { numRuns: 100 }
    );
  });
});
