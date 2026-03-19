/**
 * Property-Based Tests for 404 Response Tool Names
 *
 * Feature: add-tools-endpoint-which-lists-available-tools
 * Property 4: 404 response tool names match centralized list
 *
 * For any unknown tool name sent to the router, the error response
 * details.availableTools array must contain exactly the set of name
 * values from Available_Tools_List in Settings.
 *
 * Validates: Requirements 4.1, 4.2
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
        method: 'POST',
        path: '/mcp',
        bodyParameters: { tool: 'PLACEHOLDER' },
        pathParameters: {},
        pathArray: ['', 'PLACEHOLDER'],
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
  toUserResponse: jest.fn().mockReturnValue({ error: 'Not found' }),
  getStatusCode: jest.fn().mockReturnValue(404),
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

const { tools: { ClientRequest } } = require('@63klabs/cache-data');
const settings = require('../../../config/settings');
const Routes = require('../../../routes');

describe('Feature: add-tools-endpoint-which-lists-available-tools, Property 4: 404 response tool names match centralized list', () => {

  const expectedToolNames = settings.tools.availableToolsList.map(t => t.name);

  beforeEach(() => {
    jest.clearAllMocks();
    lastCreateErrorOpts = null;
  });

  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any unknown tool name sent to the router, the error response
   * details.availableTools array must contain exactly the set of name
   * values from Available_Tools_List in Settings.
   */
  test('404 error details.availableTools matches settings tool names for any unknown tool', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter(name => !expectedToolNames.includes(name)),
        async (unknownToolName) => {
          // Override ClientRequest mock to return the generated unknown tool name
          ClientRequest.mockImplementation(() => ({
            isValid: jest.fn().mockReturnValue(true),
            getProps: jest.fn().mockReturnValue({
              method: 'POST',
              path: '/mcp',
              bodyParameters: { tool: unknownToolName },
              pathParameters: {},
              pathArray: ['', unknownToolName],
              body: {}
            })
          }));

          lastCreateErrorOpts = null;

          const mockEvent = { body: JSON.stringify({ tool: unknownToolName }) };
          const mockContext = { requestId: 'test-request-id' };

          await Routes.process(mockEvent, mockContext);

          // Verify createError was called with the correct details
          expect(lastCreateErrorOpts).not.toBeNull();
          expect(lastCreateErrorOpts.code).toBe('UNKNOWN_TOOL');
          expect(lastCreateErrorOpts.statusCode).toBe(404);

          // The core property: availableTools in details must match the centralized list
          const actualToolNames = lastCreateErrorOpts.details.availableTools;
          expect(actualToolNames).toEqual(expectedToolNames);
        }
      ),
      { numRuns: 100 }
    );
  });
});
