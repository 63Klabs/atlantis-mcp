/**
 * Property-Based Tests for Legacy Format Backward Compatibility
 *
 * Feature: get-integration-working, Property 6: Legacy Format Backward Compatibility
 *
 * For any POST request to a per-tool endpoint (e.g., /mcp/list_tools) whose body
 * does NOT contain a jsonrpc field, the router SHALL process the request using the
 * legacy format (extracting tool and input from the body) and return a response
 * in the legacy format.
 *
 * Validates: Requirements 8.1, 8.3
 */

const fc = require('fast-check');

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

// --- Mock json-rpc-router to verify it is NOT called ---
const mockHandleJsonRpc = jest.fn();
const mockBuildResponse = jest.fn();

jest.mock('../../utils/json-rpc-router', () => ({
  handleJsonRpc: mockHandleJsonRpc,
  buildResponse: mockBuildResponse
}));

// --- Mock mcp-protocol ---
jest.mock('../../utils/mcp-protocol', () => ({
  toolsListResponse: jest.fn(),
  MCP_TOOLS: []
}));

// --- Mock error-handler ---
jest.mock('../../utils/error-handler', () => ({
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

// --- Mock controllers ---
const mockTemplatesList = jest.fn().mockResolvedValue({ success: true, data: [] });
const mockTemplatesGet = jest.fn().mockResolvedValue({ success: true, data: {} });
const mockTemplatesListVersions = jest.fn().mockResolvedValue({ success: true, data: [] });
const mockTemplatesListCategories = jest.fn().mockResolvedValue({ success: true, data: [] });
const mockStartersList = jest.fn().mockResolvedValue({ success: true, data: [] });
const mockStartersGet = jest.fn().mockResolvedValue({ success: true, data: {} });
const mockDocSearch = jest.fn().mockResolvedValue({ success: true, data: [] });
const mockValidate = jest.fn().mockResolvedValue({ success: true, data: {} });
const mockUpdatesCheck = jest.fn().mockResolvedValue({ success: true, data: {} });
const mockToolsList = jest.fn().mockResolvedValue({ success: true, data: [] });

jest.mock('../../controllers/templates', () => ({
  list: mockTemplatesList,
  get: mockTemplatesGet,
  listVersions: mockTemplatesListVersions,
  listCategories: mockTemplatesListCategories
}));

jest.mock('../../controllers/starters', () => ({
  list: mockStartersList,
  get: mockStartersGet
}));

jest.mock('../../controllers/documentation', () => ({
  search: mockDocSearch
}));

jest.mock('../../controllers/validation', () => ({
  validate: mockValidate
}));

jest.mock('../../controllers/updates', () => ({
  check: mockUpdatesCheck
}));

jest.mock('../../controllers/tools', () => ({
  list: mockToolsList
}));

// --- Mock config/settings ---
jest.mock('../../config/settings', () => ({
  tools: {
    availableToolsList: [
      { name: 'list_templates', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_template', inputSchema: { type: 'object', properties: { name: {} }, required: ['name'] } },
      { name: 'list_template_versions', inputSchema: { type: 'object', properties: {} } },
      { name: 'list_categories', inputSchema: { type: 'object', properties: {} } },
      { name: 'list_starters', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_starter_info', inputSchema: { type: 'object', properties: { name: {} }, required: ['name'] } },
      { name: 'search_documentation', inputSchema: { type: 'object', properties: {} } },
      { name: 'validate_naming', inputSchema: { type: 'object', properties: {} } },
      { name: 'check_template_updates', inputSchema: { type: 'object', properties: {} } },
      { name: 'list_tools', inputSchema: { type: 'object', properties: {} } }
    ],
    getGetEligibleTools: jest.fn().mockReturnValue([
      'list_templates', 'list_template_versions', 'list_categories',
      'list_starters', 'search_documentation', 'validate_naming',
      'check_template_updates', 'list_tools'
    ])
  }
}));

// --- Require the module under test AFTER all mocks ---
const Routes = require('../../routes');

/**
 * Map of tool names to their mock controller function and legacy path.
 */
const TOOL_CONTROLLER_MAP = {
  list_templates:        { mock: mockTemplatesList,        path: '/mcp/list_templates' },
  get_template:          { mock: mockTemplatesGet,         path: '/mcp/get_template' },
  list_template_versions:{ mock: mockTemplatesListVersions,path: '/mcp/list_template_versions' },
  list_categories:       { mock: mockTemplatesListCategories, path: '/mcp/list_categories' },
  list_starters:         { mock: mockStartersList,         path: '/mcp/list_starters' },
  get_starter_info:      { mock: mockStartersGet,          path: '/mcp/get_starter_info' },
  search_documentation:  { mock: mockDocSearch,            path: '/mcp/search_documentation' },
  validate_naming:       { mock: mockValidate,             path: '/mcp/validate_naming' },
  check_template_updates:{ mock: mockUpdatesCheck,         path: '/mcp/check_template_updates' },
  list_tools:            { mock: mockToolsList,            path: '/mcp/list_tools' }
};

const KNOWN_TOOL_NAMES = Object.keys(TOOL_CONTROLLER_MAP);

describe('Feature: get-integration-working, Property 6: Legacy Format Backward Compatibility', () => {
  const mockContext = { requestId: 'test-req-id' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Arbitrary for generating a known tool name.
   */
  const toolNameArb = fc.constantFrom(...KNOWN_TOOL_NAMES);

  /**
   * Arbitrary for generating random legacy input objects.
   */
  const inputArb = fc.oneof(
    fc.constant({}),
    fc.constant(undefined),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)),
      fc.oneof(
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.integer(),
        fc.boolean(),
        fc.constant(null)
      ),
      { minKeys: 0, maxKeys: 5 }
    )
  );

  /**
   * **Validates: Requirements 8.1, 8.3**
   *
   * For any known tool name and random input, sending a legacy-format POST
   * request (with tool and input fields, WITHOUT jsonrpc) to the per-tool
   * endpoint routes through legacy routing, NOT the JSON-RPC Router.
   */
  test('legacy-format requests are NOT routed through JSON-RPC Router', async () => {
    await fc.assert(
      fc.asyncProperty(toolNameArb, inputArb, async (toolName, input) => {
        jest.clearAllMocks();

        const toolInfo = TOOL_CONTROLLER_MAP[toolName];
        const legacyPath = toolInfo.path;

        // Configure mockGetProps to return legacy-style props
        mockGetProps.mockReturnValue({
          method: 'POST',
          path: legacyPath,
          pathArray: legacyPath.split('/').filter(Boolean),
          bodyParameters: {
            tool: toolName,
            input: input || {}
          }
        });

        // Build a legacy-format request (NO jsonrpc field)
        const bodyObj = { tool: toolName };
        if (input !== undefined) {
          bodyObj.input = input;
        }

        const event = {
          path: legacyPath,
          httpMethod: 'POST',
          body: JSON.stringify(bodyObj)
        };

        await Routes.process(event, mockContext);

        // The JSON-RPC Router must NOT have been called
        expect(mockHandleJsonRpc).not.toHaveBeenCalled();

        // The correct legacy controller MUST have been called
        expect(toolInfo.mock).toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.3**
   *
   * For any known tool name, the legacy controller receives the correct
   * props structure with bodyParameters containing tool and input.
   */
  test('legacy controller receives correct props with tool and input', async () => {
    await fc.assert(
      fc.asyncProperty(toolNameArb, inputArb, async (toolName, input) => {
        jest.clearAllMocks();

        const toolInfo = TOOL_CONTROLLER_MAP[toolName];
        const legacyPath = toolInfo.path;
        const resolvedInput = input || {};

        // Configure mockGetProps to return legacy-style props
        const propsObj = {
          method: 'POST',
          path: legacyPath,
          pathArray: legacyPath.split('/').filter(Boolean),
          bodyParameters: {
            tool: toolName,
            input: resolvedInput
          }
        };
        mockGetProps.mockReturnValue(propsObj);

        const bodyObj = { tool: toolName };
        if (input !== undefined) {
          bodyObj.input = input;
        }

        const event = {
          path: legacyPath,
          httpMethod: 'POST',
          body: JSON.stringify(bodyObj)
        };

        await Routes.process(event, mockContext);

        // Verify the controller was called with the props object
        expect(toolInfo.mock).toHaveBeenCalledTimes(1);
        const calledProps = toolInfo.mock.mock.calls[0][0];
        expect(calledProps.bodyParameters.tool).toBe(toolName);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.3**
   *
   * Only the controller matching the tool name is called; no other
   * controllers are invoked for a given legacy request.
   */
  test('only the matching controller is called for each legacy tool', async () => {
    await fc.assert(
      fc.asyncProperty(toolNameArb, async (toolName) => {
        jest.clearAllMocks();

        const toolInfo = TOOL_CONTROLLER_MAP[toolName];
        const legacyPath = toolInfo.path;

        mockGetProps.mockReturnValue({
          method: 'POST',
          path: legacyPath,
          pathArray: legacyPath.split('/').filter(Boolean),
          bodyParameters: { tool: toolName, input: {} }
        });

        const event = {
          path: legacyPath,
          httpMethod: 'POST',
          body: JSON.stringify({ tool: toolName, input: {} })
        };

        await Routes.process(event, mockContext);

        // The correct controller was called
        expect(toolInfo.mock).toHaveBeenCalledTimes(1);

        // No other controllers were called
        for (const [otherTool, otherInfo] of Object.entries(TOOL_CONTROLLER_MAP)) {
          if (otherTool !== toolName) {
            expect(otherInfo.mock).not.toHaveBeenCalled();
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
