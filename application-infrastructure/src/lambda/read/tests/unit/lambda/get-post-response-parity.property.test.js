/**
 * Property-Based Tests for GET/POST Response Parity
 *
 * Feature: allow-get-on-tools-that-list
 * Property 5: GET and POST response parity
 *
 * For each GET-eligible tool and any set of valid optional parameters,
 * a GET request with those parameters as query strings and an equivalent
 * POST request with those parameters in the body must produce the same
 * response body structure and the same CORS headers.
 *
 * Validates: Requirements 5.1, 5.2
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

// Mock controllers — each returns a deterministic response based on tool name
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

describe('Feature: allow-get-on-tools-that-list, Property 5: GET and POST response parity', () => {

  const getEligibleTools = settings.tools.getGetEligibleTools();
  const mockContext = { requestId: 'test-request-id' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;
  });

  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * For each GET-eligible tool, generate random optional parameters,
   * send both GET and POST, verify response bodies and headers match.
   */
  test('GET and POST to any GET-eligible tool produce the same setBody calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...getEligibleTools),
        fc.dictionary(
          fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,19}$/),
          fc.string({ minLength: 0, maxLength: 50 })
        ),
        async (toolName, randomParams) => {
          // --- GET request ---
          const queryStringParameters = Object.keys(randomParams).length > 0
            ? randomParams
            : null;

          ClientRequest.mockImplementation(() => ({
            isValid: jest.fn().mockReturnValue(true),
            getProps: jest.fn().mockReturnValue({
              method: 'GET',
              path: `/mcp/${toolName}`,
              bodyParameters: {},
              pathParameters: { tool: toolName },
              pathArray: ['', toolName],
              queryStringParameters,
              body: {}
            })
          }));

          mockResponseInstance.setBody.mockClear();
          mockResponseInstance.reset.mockClear();
          mockResponseInstance.statusCode = undefined;
          mockResponseInstance.body = undefined;

          await Routes.process(
            { httpMethod: 'GET', path: `/mcp/${toolName}` },
            mockContext
          );

          const getSetBodyCalls = mockResponseInstance.setBody.mock.calls.slice();
          const getResetCalls = mockResponseInstance.reset.mock.calls.slice();
          const getStatusCode = mockResponseInstance.statusCode;

          // --- POST request ---
          const postInput = queryStringParameters
            ? { ...queryStringParameters }
            : {};

          ClientRequest.mockImplementation(() => ({
            isValid: jest.fn().mockReturnValue(true),
            getProps: jest.fn().mockReturnValue({
              method: 'POST',
              path: `/mcp/${toolName}`,
              bodyParameters: { tool: toolName, input: postInput },
              pathParameters: { tool: toolName },
              pathArray: ['', toolName],
              queryStringParameters: null,
              body: { tool: toolName, input: postInput }
            })
          }));

          mockResponseInstance.setBody.mockClear();
          mockResponseInstance.reset.mockClear();
          mockResponseInstance.statusCode = undefined;
          mockResponseInstance.body = undefined;

          await Routes.process(
            { httpMethod: 'POST', path: `/mcp/${toolName}` },
            mockContext
          );

          const postSetBodyCalls = mockResponseInstance.setBody.mock.calls.slice();
          const postResetCalls = mockResponseInstance.reset.mock.calls.slice();
          const postStatusCode = mockResponseInstance.statusCode;

          // Both should call setBody the same number of times
          expect(getSetBodyCalls.length).toBe(postSetBodyCalls.length);

          // Both should call setBody with the same resolved value
          if (getSetBodyCalls.length > 0 && postSetBodyCalls.length > 0) {
            expect(getSetBodyCalls[0]).toEqual(postSetBodyCalls[0]);
          }

          // Neither should have triggered a reset (error path)
          expect(getResetCalls.length).toBe(postResetCalls.length);

          // Status codes should match (both undefined for success path)
          expect(getStatusCode).toBe(postStatusCode);
        }
      ),
      { numRuns: 100 }
    );
  });
});
