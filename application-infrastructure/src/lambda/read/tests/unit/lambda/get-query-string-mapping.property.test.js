/**
 * Property-Based Tests for Query String Parameter Mapping
 *
 * Feature: allow-get-on-tools-that-list
 * Property 2: Query string parameters are mapped to controller input
 *
 * For any GET request to a GET-eligible tool with query string parameters,
 * the parameters must be passed to the controller in the same structure as
 * POST body parameters (props.bodyParameters.input), preserving all
 * key-value pairs.
 *
 * Validates: Requirements 4.2
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
        method: 'GET',
        path: '/mcp/list_templates',
        bodyParameters: {},
        pathParameters: { tool: 'list_templates' },
        pathArray: ['', 'list_templates'],
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
const TemplatesController = require('../../../controllers/templates');

describe('Feature: allow-get-on-tools-that-list, Property 2: Query string parameters are mapped to controller input', () => {

  const mockContext = { requestId: 'test-request-id' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * For any GET request to a GET-eligible tool with query string parameters,
   * the parameters must be passed to the controller in props.bodyParameters.input,
   * preserving all key-value pairs.
   */
  test('query string parameters appear in props.bodyParameters.input for any key-value pairs', async () => {
    const validKeyArb = fc.string({ minLength: 1 })
      .filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s));

    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(validKeyArb, fc.string()),
        async (queryParams) => {
          // Configure ClientRequest mock to return a GET request with generated query params
          ClientRequest.mockImplementation(() => ({
            isValid: jest.fn().mockReturnValue(true),
            getProps: jest.fn().mockReturnValue({
              method: 'GET',
              path: '/mcp/list_templates',
              bodyParameters: {},
              pathParameters: { tool: 'list_templates' },
              pathArray: ['', 'list_templates'],
              queryStringParameters: Object.keys(queryParams).length > 0 ? queryParams : null,
              body: {}
            })
          }));

          TemplatesController.list.mockClear();

          const mockEvent = { httpMethod: 'GET', path: '/mcp/list_templates' };
          await Routes.process(mockEvent, mockContext);

          // Verify the templates controller list method was called
          expect(TemplatesController.list).toHaveBeenCalled();

          const calledProps = TemplatesController.list.mock.calls[0][0];

          if (Object.keys(queryParams).length > 0) {
            // All generated key-value pairs must appear in bodyParameters.input
            expect(calledProps.bodyParameters.input).toEqual(queryParams);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
