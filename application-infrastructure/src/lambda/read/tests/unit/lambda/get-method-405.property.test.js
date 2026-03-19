/**
 * Property-Based Tests for 405 on Non-GET-Eligible Tools
 *
 * Feature: allow-get-on-tools-that-list
 * Property 3: GET to non-GET-eligible tools returns 405
 *
 * For each tool with a non-empty `required` array in its inputSchema,
 * sending a GET request must return a 405 Method Not Allowed response
 * with an error body indicating the tool requires POST.
 *
 * Validates: Requirements 4.3
 */

const fc = require('fast-check');

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
        method: 'GET',
        path: '/mcp/PLACEHOLDER',
        bodyParameters: {},
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
const settings = require('../../../config/settings');
const Routes = require('../../../routes');

describe('Feature: allow-get-on-tools-that-list, Property 3: GET to non-GET-eligible tools returns 405', () => {

  // Derive non-GET-eligible tools: those with a non-empty required array
  const nonGetEligibleTools = settings.tools.availableToolsList
    .filter(tool => tool.inputSchema.required && tool.inputSchema.required.length > 0)
    .map(tool => tool.name);

  const mockContext = { requestId: 'test-request-id' };

  beforeEach(() => {
    jest.clearAllMocks();
    lastCreateErrorOpts = null;
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * For any tool with a non-empty required array, sending a GET request
   * must return a 405 Method Not Allowed response with code METHOD_NOT_ALLOWED
   * and statusCode 405.
   */
  test('GET to any non-GET-eligible tool returns 405 with METHOD_NOT_ALLOWED', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...nonGetEligibleTools),
        async (toolName) => {
          // Configure ClientRequest mock to return a GET request to the selected tool
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

          lastCreateErrorOpts = null;

          const mockEvent = { httpMethod: 'GET', path: `/mcp/${toolName}` };
          await Routes.process(mockEvent, mockContext);

          // Verify createError was called with METHOD_NOT_ALLOWED
          expect(lastCreateErrorOpts).not.toBeNull();
          expect(lastCreateErrorOpts.code).toBe('METHOD_NOT_ALLOWED');
          expect(lastCreateErrorOpts.statusCode).toBe(405);

          // Verify the response statusCode is 405
          expect(mockResponseInstance.statusCode).toBe(405);
        }
      ),
      { numRuns: 100 }
    );
  });
});
