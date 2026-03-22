/**
 * Property-Based Tests for Correct Method Dispatch
 *
 * Feature: get-integration-working, Property 3: Correct Method Dispatch
 *
 * For any valid JSON-RPC 2.0 request to /mcp/v1 where the method is tools/call
 * and params.name is a known tool name, the JSON-RPC Router SHALL dispatch to
 * the controller corresponding to that tool name, and the response result SHALL
 * contain the output from that controller.
 *
 * Validates: Requirements 2.1, 2.4, 3.2, 8.2
 */

const fc = require('fast-check');

// Mock controllers before requiring the router
jest.mock('../../controllers', () => {
  const mockControllers = {
    Templates: {
      list: jest.fn(),
      get: jest.fn(),
      listVersions: jest.fn(),
      listCategories: jest.fn()
    },
    Starters: {
      list: jest.fn(),
      get: jest.fn()
    },
    Documentation: {
      search: jest.fn()
    },
    Validation: {
      validate: jest.fn()
    },
    Updates: {
      check: jest.fn()
    },
    Tools: {
      list: jest.fn()
    }
  };
  return mockControllers;
});

const { handleJsonRpc, TOOL_DISPATCH } = require('../../utils/json-rpc-router');
const Controllers = require('../../controllers');

/**
 * Map of tool names to their expected controller function reference.
 * This mirrors the TOOL_DISPATCH map in json-rpc-router.js.
 */
const TOOL_TO_CONTROLLER = {
  list_templates: Controllers.Templates.list,
  get_template: Controllers.Templates.get,
  list_template_versions: Controllers.Templates.listVersions,
  list_categories: Controllers.Templates.listCategories,
  list_starters: Controllers.Starters.list,
  get_starter_info: Controllers.Starters.get,
  search_documentation: Controllers.Documentation.search,
  validate_naming: Controllers.Validation.validate,
  check_template_updates: Controllers.Updates.check,
  list_tools: Controllers.Tools.list
};

const KNOWN_TOOL_NAMES = Object.keys(TOOL_TO_CONTROLLER);

describe('Feature: get-integration-working, Property 3: Correct Method Dispatch', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Arbitrary for generating a known tool name from the TOOL_DISPATCH set.
   */
  const toolNameArb = fc.constantFrom(...KNOWN_TOOL_NAMES);

  /**
   * Arbitrary for generating random tool arguments objects.
   */
  const toolArgsArb = fc.oneof(
    fc.constant({}),
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
   * Arbitrary for generating valid JSON-RPC 2.0 request ids.
   */
  const idArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.integer({ min: 1, max: 999999 })
  );


  /**
   * **Validates: Requirements 2.1, 2.4, 3.2, 8.2**
   *
   * For any known tool name and random arguments, sending a valid tools/call
   * JSON-RPC request through handleJsonRpc dispatches to the correct controller
   * function with the right props structure.
   */
  test('tools/call dispatches to the correct controller for any known tool name', async () => {
    await fc.assert(
      fc.asyncProperty(toolNameArb, toolArgsArb, idArb, async (toolName, toolArgs, id) => {
        // Reset all mocks for each iteration
        jest.clearAllMocks();

        // Configure the expected controller to return a successful legacy response
        const mockData = { result: `mock-data-for-${toolName}` };
        const controllerFn = TOOL_TO_CONTROLLER[toolName];
        controllerFn.mockResolvedValue({
          protocol: 'mcp',
          version: '1.0',
          tool: toolName,
          success: true,
          data: mockData,
          timestamp: new Date().toISOString()
        });

        // Build a valid JSON-RPC 2.0 tools/call request
        const event = {
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            id: id,
            params: {
              name: toolName,
              arguments: toolArgs
            }
          })
        };

        const response = await handleJsonRpc(event, {});

        // The correct controller must have been called exactly once
        expect(controllerFn).toHaveBeenCalledTimes(1);

        // Verify the props structure passed to the controller
        const calledProps = controllerFn.mock.calls[0][0];
        expect(calledProps).toHaveProperty('bodyParameters');
        expect(calledProps.bodyParameters.tool).toBe(toolName);
        expect(calledProps.bodyParameters.input).toEqual(toolArgs);

        // No other controller should have been called
        for (const [otherToolName, otherFn] of Object.entries(TOOL_TO_CONTROLLER)) {
          if (otherToolName !== toolName) {
            expect(otherFn).not.toHaveBeenCalled();
          }
        }

        // Response should be a valid JSON-RPC 2.0 success response
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBe(id);
        expect(body).toHaveProperty('result');
        expect(body).not.toHaveProperty('error');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.4**
   *
   * For any known tool name, the controller result data is correctly wrapped
   * in the MCP content format within the JSON-RPC 2.0 response.
   */
  test('tools/call wraps controller output in MCP content format', async () => {
    await fc.assert(
      fc.asyncProperty(toolNameArb, idArb, async (toolName, id) => {
        jest.clearAllMocks();

        const mockData = { items: ['a', 'b', 'c'], count: 3 };
        const controllerFn = TOOL_TO_CONTROLLER[toolName];
        controllerFn.mockResolvedValue({
          protocol: 'mcp',
          version: '1.0',
          tool: toolName,
          success: true,
          data: mockData,
          timestamp: new Date().toISOString()
        });

        const event = {
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            id: id,
            params: { name: toolName, arguments: {} }
          })
        };

        const response = await handleJsonRpc(event, {});
        const body = JSON.parse(response.body);

        // Result should contain MCP content format
        expect(body.result).toHaveProperty('content');
        expect(Array.isArray(body.result.content)).toBe(true);
        expect(body.result.content.length).toBeGreaterThan(0);
        expect(body.result.content[0]).toHaveProperty('type', 'text');
        expect(body.result.content[0]).toHaveProperty('text');

        // The text content should be the JSON-serialized controller data
        const parsedContent = JSON.parse(body.result.content[0].text);
        expect(parsedContent).toEqual(mockData);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4, 8.2**
   *
   * Verify that TOOL_DISPATCH contains exactly the 10 known tool names
   * and each maps to a function.
   */
  test('TOOL_DISPATCH contains all known tool names mapped to functions', () => {
    const dispatchKeys = Object.keys(TOOL_DISPATCH);

    expect(dispatchKeys).toHaveLength(KNOWN_TOOL_NAMES.length);

    for (const toolName of KNOWN_TOOL_NAMES) {
      expect(TOOL_DISPATCH).toHaveProperty(toolName);
      expect(typeof TOOL_DISPATCH[toolName]).toBe('function');
    }
  });
});
