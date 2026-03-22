/**
 * Property-Based Tests for Content-Type Header on All Responses
 *
 * Feature: get-integration-working, Property 5: Content-Type Header on All Responses
 *
 * For any request to the /mcp/v1 endpoint (success or error), the response
 * SHALL include the header Content-Type: application/json. The response
 * SHALL never return Content-Type: text/html.
 *
 * Validates: Requirements 4.1, 4.2
 */

const fc = require('fast-check');

// Mock controllers to avoid real service calls
jest.mock('../../controllers', () => ({
  Templates: {
    list: jest.fn().mockResolvedValue({ success: true, data: [] }),
    get: jest.fn().mockResolvedValue({ success: true, data: {} }),
    listVersions: jest.fn().mockResolvedValue({ success: true, data: [] }),
    listCategories: jest.fn().mockResolvedValue({ success: true, data: [] })
  },
  Starters: {
    list: jest.fn().mockResolvedValue({ success: true, data: [] }),
    get: jest.fn().mockResolvedValue({ success: true, data: {} })
  },
  Documentation: {
    search: jest.fn().mockResolvedValue({ success: true, data: [] })
  },
  Validation: {
    validate: jest.fn().mockResolvedValue({ success: true, data: {} })
  },
  Updates: {
    check: jest.fn().mockResolvedValue({ success: true, data: {} })
  },
  Tools: {
    list: jest.fn().mockResolvedValue({ success: true, data: [] })
  }
}));

const { handleJsonRpc } = require('../../utils/json-rpc-router');

/** Known MCP methods */
const KNOWN_METHODS = ['initialize', 'tools/list'];

/** Known tool names for tools/call dispatch */
const KNOWN_TOOLS = [
  'list_templates', 'get_template', 'list_template_versions',
  'list_categories', 'list_starters', 'get_starter_info',
  'search_documentation', 'validate_naming', 'check_template_updates',
  'list_tools'
];

describe('Feature: get-integration-working, Property 5: Content-Type Header on All Responses', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * Valid JSON-RPC 2.0 requests (initialize, tools/list) must return
   * Content-Type: application/json and never text/html.
   */
  test('valid JSON-RPC 2.0 requests always return Content-Type application/json', async () => {
    const idArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.integer({ min: 1, max: 999999 })
    );

    const methodArb = fc.constantFrom(...KNOWN_METHODS);

    await fc.assert(
      fc.asyncProperty(methodArb, idArb, async (method, id) => {
        const event = {
          body: JSON.stringify({ jsonrpc: '2.0', method, id })
        };

        const response = await handleJsonRpc(event, {});

        expect(response.headers['Content-Type']).toBe('application/json');
        expect(response.headers['Content-Type']).not.toBe('text/html');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * Valid tools/call requests with known tool names must return
   * Content-Type: application/json and never text/html.
   */
  test('tools/call requests always return Content-Type application/json', async () => {
    const idArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.integer({ min: 1, max: 999999 })
    );

    const toolNameArb = fc.constantFrom(...KNOWN_TOOLS);

    const argsArb = fc.oneof(
      fc.constant({}),
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        { minKeys: 0, maxKeys: 3 }
      )
    );

    await fc.assert(
      fc.asyncProperty(toolNameArb, idArb, argsArb, async (toolName, id, args) => {
        const event = {
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            id,
            params: { name: toolName, arguments: args }
          })
        };

        const response = await handleJsonRpc(event, {});

        expect(response.headers['Content-Type']).toBe('application/json');
        expect(response.headers['Content-Type']).not.toBe('text/html');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * Invalid JSON (parse errors) must return Content-Type: application/json
   * and never text/html.
   */
  test('invalid JSON requests always return Content-Type application/json', async () => {
    const nonJsonArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 100 }).filter(s => {
        try { JSON.parse(s); return false; } catch { return true; }
      }),
      fc.constantFrom(
        '{invalid json',
        '{"key": undefined}',
        "{'single': 'quotes'}",
        '<html>not json</html>',
        'just plain text'
      )
    );

    await fc.assert(
      fc.asyncProperty(nonJsonArb, async (badBody) => {
        const event = { body: badBody };
        const response = await handleJsonRpc(event, {});

        expect(response.headers['Content-Type']).toBe('application/json');
        expect(response.headers['Content-Type']).not.toBe('text/html');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * Valid JSON missing required JSON-RPC fields (invalid request errors)
   * must return Content-Type: application/json and never text/html.
   */
  test('valid JSON missing required fields always returns Content-Type application/json', async () => {
    const invalidRequestArb = fc.oneof(
      // Missing jsonrpc field
      fc.string({ minLength: 1, maxLength: 20 }).map(method => ({ method })),
      // Missing method field
      fc.constant({ jsonrpc: '2.0' }),
      // Wrong jsonrpc version
      fc.string({ minLength: 1, maxLength: 10 })
        .filter(s => s !== '2.0')
        .map(version => ({ jsonrpc: version, method: 'initialize' })),
      // Empty object
      fc.constant({})
    );

    await fc.assert(
      fc.asyncProperty(invalidRequestArb, async (invalidObj) => {
        const event = { body: JSON.stringify(invalidObj) };
        const response = await handleJsonRpc(event, {});

        expect(response.headers['Content-Type']).toBe('application/json');
        expect(response.headers['Content-Type']).not.toBe('text/html');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * Valid JSON-RPC 2.0 with unknown methods (method not found errors)
   * must return Content-Type: application/json and never text/html.
   */
  test('unknown method requests always return Content-Type application/json', async () => {
    const unknownMethodArb = fc.string({ minLength: 1, maxLength: 50 })
      .filter(s => !['initialize', 'tools/list', 'tools/call'].includes(s));

    const idArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.integer({ min: 1, max: 999999 })
    );

    await fc.assert(
      fc.asyncProperty(unknownMethodArb, idArb, async (method, id) => {
        const event = {
          body: JSON.stringify({ jsonrpc: '2.0', method, id })
        };

        const response = await handleJsonRpc(event, {});

        expect(response.headers['Content-Type']).toBe('application/json');
        expect(response.headers['Content-Type']).not.toBe('text/html');
      }),
      { numRuns: 100 }
    );
  });
});
