/**
 * Property-Based Tests for Prototype Chain Tool Name Rejection
 *
 * Bugfix: Unvalidated Dynamic Method Call in handleToolsCall
 * Property 1: Bug Condition — Prototype Chain Tool Names Are Rejected
 *
 * For any input where toolName is a property inherited from Object.prototype
 * or is __proto__, the handleToolsCall function SHALL return a JSON-RPC 2.0
 * error response with code -32601 (Method not found) and SHALL NOT throw
 * any exception.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3
 */

const fc = require('fast-check');

// Mock controllers before requiring the router (same pattern as method-dispatch.property.test.js)
jest.mock('../../controllers', () => {
  const mockControllers = {
    Templates: {
      list: jest.fn(),
      get: jest.fn(),
      getChunk: jest.fn(),
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

describe('Bugfix: Prototype Chain Tool Name Rejection — Property 1: Bug Condition', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Arbitrary for generating prototype-chain tool names that trigger the bug.
   * These are names that exist on Object.prototype plus __proto__.
   *
   * From Bug Condition in design:
   *   isBugCondition(input) = (input.toolName IN Object.getOwnPropertyNames(Object.prototype))
   *                           OR (input.toolName = "__proto__")
   */
  const prototypeToolNameArb = fc.constantFrom(
    ...Object.getOwnPropertyNames(Object.prototype),
    '__proto__'
  );

  /**
   * Arbitrary for generating valid JSON-RPC 2.0 request ids.
   */
  const idArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.integer({ min: 1, max: 999999 })
  );

  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
   *
   * For any prototype-chain tool name, sending a tools/call JSON-RPC request
   * through handleJsonRpc SHALL return a JSON-RPC 2.0 error with code -32601
   * (Method not found) and SHALL NOT throw any unhandled exception.
   *
   * EXPECTED TO FAIL on unfixed code: prototype names like hasOwnProperty,
   * constructor, toString, __proto__ bypass the !handler falsy check and
   * cause TypeError or unexpected responses instead of clean -32601 errors.
   */
  test('prototype-chain tool names return -32601 Method not found without exception', async () => {
    await fc.assert(
      fc.asyncProperty(prototypeToolNameArb, idArb, async (toolName, id) => {
        // Build a valid JSON-RPC 2.0 tools/call request with prototype-chain name
        const event = {
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            id: id,
            params: {
              name: toolName,
              arguments: {}
            }
          })
        };

        // Call handleJsonRpc — should NOT throw
        const response = await handleJsonRpc(event, {});

        // Response must be a valid API Gateway response
        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(typeof response.body).toBe('string');

        // Parse the response body
        const body = JSON.parse(response.body);

        // Must be a JSON-RPC 2.0 error response with -32601
        expect(body.jsonrpc).toBe('2.0');
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe(-32601);
        expect(body.error.message).toBe('Method not found');
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Map of tool names to their expected controller function reference.
 * Mirrors the TOOL_DISPATCH map in json-rpc-router.js.
 */
const TOOL_TO_CONTROLLER = {
  list_templates: Controllers.Templates.list,
  get_template: Controllers.Templates.get,
  get_template_chunk: Controllers.Templates.getChunk,
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

describe('Bugfix: Prototype Chain Tool Name Rejection — Property 2: Preservation', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Arbitrary for generating valid JSON-RPC 2.0 request ids.
   */
  const idArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.integer({ min: 1, max: 999999 })
  );

  /**
   * **Validates: Requirements 3.1**
   *
   * Property 2a — Valid tool dispatch preservation:
   * For any registered tool name, the correct controller is invoked exactly
   * once and the response contains body.result.content array with type 'text'.
   */
  test('valid tool names dispatch to correct controller and return MCP content format', async () => {
    const validToolNameArb = fc.constantFrom(...Object.keys(TOOL_DISPATCH));

    await fc.assert(
      fc.asyncProperty(validToolNameArb, idArb, async (toolName, id) => {
        jest.clearAllMocks();

        // Mock the expected controller to return a success response
        const controllerFn = TOOL_TO_CONTROLLER[toolName];
        controllerFn.mockResolvedValue({
          protocol: 'mcp',
          version: '1.0',
          tool: toolName,
          success: true,
          data: { result: `mock-data-for-${toolName}` },
          timestamp: new Date().toISOString()
        });

        const event = {
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            id: id,
            params: {
              name: toolName,
              arguments: {}
            }
          })
        };

        const response = await handleJsonRpc(event, {});

        // Correct controller called exactly once
        expect(controllerFn).toHaveBeenCalledTimes(1);

        // No other controller should have been called
        for (const [otherName, otherFn] of Object.entries(TOOL_TO_CONTROLLER)) {
          if (otherName !== toolName) {
            expect(otherFn).not.toHaveBeenCalled();
          }
        }

        // Response is valid JSON-RPC 2.0 success with MCP content format
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBe(id);
        expect(body.result).toBeDefined();
        expect(body.result.content).toBeDefined();
        expect(Array.isArray(body.result.content)).toBe(true);
        expect(body.result.content.length).toBeGreaterThan(0);
        expect(body.result.content[0].type).toBe('text');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Property 2b — Unknown tool rejection preservation:
   * For any string that is neither a registered tool name nor an
   * Object.prototype property, the response has error code -32601.
   */
  test('unknown tool names return -32601 Method not found', async () => {
    const prototypeNames = new Set(Object.getOwnPropertyNames(Object.prototype));
    prototypeNames.add('__proto__');
    const toolDispatchKeys = new Set(Object.keys(TOOL_DISPATCH));

    const unknownToolNameArb = fc.stringMatching(/^[a-z][a-z0-9_]{2,30}$/)
      .filter(s => !toolDispatchKeys.has(s) && !prototypeNames.has(s));

    await fc.assert(
      fc.asyncProperty(unknownToolNameArb, idArb, async (toolName, id) => {
        const event = {
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            id: id,
            params: {
              name: toolName,
              arguments: {}
            }
          })
        };

        const response = await handleJsonRpc(event, {});

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.jsonrpc).toBe('2.0');
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe(-32601);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Property 2c — Invalid params preservation:
   * Missing or non-string params.name returns error code -32602.
   */
  test('missing or non-string params.name returns -32602 Invalid params', async () => {
    const invalidParamsCases = [
      { arguments: {} },                // missing name entirely
      { name: 123 },                    // non-string name (number)
      { name: true },                   // non-string name (boolean)
      { name: null },                   // non-string name (null)
      { name: ['list_templates'] }      // non-string name (array)
    ];

    const invalidParamsArb = fc.constantFrom(...invalidParamsCases);

    await fc.assert(
      fc.asyncProperty(invalidParamsArb, idArb, async (params, id) => {
        const event = {
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            id: id,
            params: params
          })
        };

        const response = await handleJsonRpc(event, {});

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.jsonrpc).toBe('2.0');
        expect(body.error).toBeDefined();
        expect(body.error.code).toBe(-32602);
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property 2d — Export compatibility preservation:
   * TOOL_DISPATCH exports all 11 registered tool names, each mapping to a function.
   */
  test('TOOL_DISPATCH exports all 11 registered tool names mapped to functions', () => {
    const dispatchKeys = Object.keys(TOOL_DISPATCH);

    expect(dispatchKeys).toHaveLength(11);

    for (const name of dispatchKeys) {
      expect(typeof TOOL_DISPATCH[name]).toBe('function');
    }

    // Verify all expected tool names are present
    const expectedTools = [
      'list_templates',
      'get_template',
      'get_template_chunk',
      'list_template_versions',
      'list_categories',
      'list_starters',
      'get_starter_info',
      'search_documentation',
      'validate_naming',
      'check_template_updates',
      'list_tools'
    ];

    for (const toolName of expectedTools) {
      expect(TOOL_DISPATCH).toHaveProperty(toolName);
      expect(typeof TOOL_DISPATCH[toolName]).toBe('function');
    }
  });
});
