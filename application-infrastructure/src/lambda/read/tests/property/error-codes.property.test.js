/**
 * Property-Based Tests for Standard Error Codes for Invalid Requests
 *
 * Feature: get-integration-working, Property 4: Standard Error Codes for Invalid Requests
 *
 * For any request to /mcp/v1:
 * - If the body is not valid JSON, the response error code SHALL be -32700 (Parse error)
 * - If the body is valid JSON but missing jsonrpc or method, the response error code SHALL be -32600 (Invalid Request)
 * - If the method is not a recognized method, the response error code SHALL be -32601 (Method not found)
 *
 * Validates: Requirements 2.5, 2.6, 2.7
 */

const fc = require('fast-check');

// Mock controllers to avoid real service calls
jest.mock('../../controllers', () => ({
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
}));

const { handleJsonRpc } = require('../../utils/json-rpc-router');
const { JSON_RPC_ERRORS } = require('../../utils/mcp-protocol');

/** Known methods that the router recognizes */
const KNOWN_METHODS = ['initialize', 'tools/list', 'tools/call'];

describe('Feature: get-integration-working, Property 4: Standard Error Codes for Invalid Requests', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * Category A: Non-JSON strings → response error code should be -32700 (Parse error).
   * Generate random strings that are NOT valid JSON and verify the router
   * returns a Parse error.
   */
  test('non-JSON request bodies always produce error code -32700 (Parse error)', async () => {
    // Arbitrary that generates strings which are NOT valid JSON
    const nonJsonStringArb = fc.oneof(
      // Strings with unbalanced braces/brackets
      fc.string({ minLength: 1, maxLength: 100 }).filter(s => {
        try { JSON.parse(s); return false; } catch { return true; }
      }),
      // Strings with special characters that break JSON parsing
      fc.constantFrom(
        '{invalid json',
        '{"key": undefined}',
        "{'single': 'quotes'}",
        '{missing: "quotes on key"}',
        '{"trailing": "comma",}',
        '<html>not json</html>',
        'just plain text',
        '{{nested braces}}',
        '[unclosed array',
        '{"unterminated": "string'
      )
    );

    await fc.assert(
      fc.asyncProperty(nonJsonStringArb, async (nonJsonBody) => {
        const event = { body: nonJsonBody };
        const response = await handleJsonRpc(event, {});

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        // Must be a valid JSON-RPC 2.0 error response
        expect(body.jsonrpc).toBe('2.0');
        expect(body).toHaveProperty('error');
        expect(body).not.toHaveProperty('result');

        // Error code must be -32700 (Parse error)
        expect(body.error.code).toBe(JSON_RPC_ERRORS.PARSE_ERROR);
        expect(body.id).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.7**
   *
   * Category B: Valid JSON but missing required fields (jsonrpc or method)
   * → response error code should be -32600 (Invalid Request).
   * Generate valid JSON objects that are missing jsonrpc: "2.0" or missing method field.
   */
  test('valid JSON missing required fields always produces error code -32600 (Invalid Request)', async () => {
    const idArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.integer({ min: 1, max: 999999 }),
      fc.constant(undefined)
    );

    const methodArb = fc.string({ minLength: 1, maxLength: 30 });

    // Generate objects missing jsonrpc, missing method, or with wrong jsonrpc version
    const invalidRequestArb = fc.oneof(
      // Missing jsonrpc field entirely, has method
      idArb.chain(id =>
        methodArb.map(method => {
          const obj = { method };
          if (id !== undefined) obj.id = id;
          return obj;
        })
      ),
      // Missing method field entirely, has jsonrpc
      idArb.map(id => {
        const obj = { jsonrpc: '2.0' };
        if (id !== undefined) obj.id = id;
        return obj;
      }),
      // Wrong jsonrpc version (not "2.0")
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 10 }).filter(s => s !== '2.0'),
        methodArb,
        idArb
      ).map(([version, method, id]) => {
        const obj = { jsonrpc: version, method };
        if (id !== undefined) obj.id = id;
        return obj;
      }),
      // jsonrpc is a number instead of string "2.0"
      fc.tuple(fc.integer(), methodArb, idArb).map(([version, method, id]) => {
        const obj = { jsonrpc: version, method };
        if (id !== undefined) obj.id = id;
        return obj;
      }),
      // Both jsonrpc and method missing (just random JSON object)
      fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }).filter(k => k !== 'jsonrpc' && k !== 'method'),
        fc.string({ minLength: 0, maxLength: 20 }),
        { minKeys: 0, maxKeys: 3 }
      )
    );

    await fc.assert(
      fc.asyncProperty(invalidRequestArb, async (invalidObj) => {
        const event = { body: JSON.stringify(invalidObj) };
        const response = await handleJsonRpc(event, {});

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        // Must be a valid JSON-RPC 2.0 error response
        expect(body.jsonrpc).toBe('2.0');
        expect(body).toHaveProperty('error');
        expect(body).not.toHaveProperty('result');

        // Error code must be -32600 (Invalid Request)
        expect(body.error.code).toBe(JSON_RPC_ERRORS.INVALID_REQUEST);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.5**
   *
   * Category C: Valid JSON-RPC 2.0 with unknown/unrecognized methods
   * → response error code should be -32601 (Method not found).
   * Generate valid JSON-RPC 2.0 requests with random method names that are
   * NOT in the known set (initialize, tools/list, tools/call).
   */
  test('valid JSON-RPC 2.0 with unknown methods always produces error code -32601 (Method not found)', async () => {
    const unknownMethodArb = fc.string({ minLength: 1, maxLength: 50 })
      .filter(s => !KNOWN_METHODS.includes(s));

    const idArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.integer({ min: 1, max: 999999 })
    );

    await fc.assert(
      fc.asyncProperty(unknownMethodArb, idArb, async (method, id) => {
        const event = {
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: method,
            id: id
          })
        };

        const response = await handleJsonRpc(event, {});

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        // Must be a valid JSON-RPC 2.0 error response
        expect(body.jsonrpc).toBe('2.0');
        expect(body).toHaveProperty('error');
        expect(body).not.toHaveProperty('result');

        // Error code must be -32601 (Method not found)
        expect(body.error.code).toBe(JSON_RPC_ERRORS.METHOD_NOT_FOUND);

        // id should match the request id
        expect(body.id).toBe(id);
      }),
      { numRuns: 100 }
    );
  });
});
