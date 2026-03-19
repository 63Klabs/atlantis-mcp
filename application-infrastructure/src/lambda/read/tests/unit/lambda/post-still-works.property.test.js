/**
 * Property-Based Tests for POST Still Works for All Tools
 *
 * Feature: allow-get-on-tools-that-list
 * Property 4: POST continues to work for all tools
 *
 * For each tool in `availableToolsList`, sending a POST request must be
 * accepted and routed to the appropriate controller — GET support does
 * not break existing POST behavior.
 *
 * Validates: Requirements 4.4
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

describe('Feature: allow-get-on-tools-that-list, Property 4: POST continues to work for all tools', () => {

  // Get all tool names from availableToolsList
  const allToolNames = settings.tools.availableToolsList.map(tool => tool.name);

  const mockContext = { requestId: 'test-request-id' };

  beforeEach(() => {
    jest.clearAllMocks();
    lastCreateErrorOpts = null;
    mockResponseInstance.statusCode = undefined;
    mockResponseInstance.body = undefined;
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * For any tool in availableToolsList, sending a POST request must be
   * accepted (not 405). POST should always work regardless of GET eligibility.
   */
  test('POST to any tool is accepted and does not return 405', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...allToolNames),
        async (toolName) => {
          // Build required params for tools that need them
          const toolDef = settings.tools.availableToolsList.find(t => t.name === toolName);
          const requiredParams = toolDef.inputSchema.required || [];
          const input = {};
          for (const param of requiredParams) {
            input[param] = 'test-value';
          }

          // Configure ClientRequest mock to return a POST request to the selected tool
          ClientRequest.mockImplementation(() => ({
            isValid: jest.fn().mockReturnValue(true),
            getProps: jest.fn().mockReturnValue({
              method: 'POST',
              path: `/mcp/${toolName}`,
              bodyParameters: { tool: toolName, input },
              pathParameters: { tool: toolName },
              pathArray: ['', toolName],
              queryStringParameters: null,
              body: { tool: toolName, input }
            })
          }));

          lastCreateErrorOpts = null;

          const mockEvent = { httpMethod: 'POST', path: `/mcp/${toolName}` };
          await Routes.process(mockEvent, mockContext);

          // Verify createError was NOT called with METHOD_NOT_ALLOWED
          if (lastCreateErrorOpts !== null) {
            expect(lastCreateErrorOpts.code).not.toBe('METHOD_NOT_ALLOWED');
          }

          // Verify the response statusCode is NOT 405
          expect(mockResponseInstance.statusCode).not.toBe(405);
        }
      ),
      { numRuns: 100 }
    );
  });
});
