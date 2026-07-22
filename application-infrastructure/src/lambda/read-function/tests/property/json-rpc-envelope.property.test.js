/**
 * Property-Based Tests for JSON-RPC 2.0 Response Envelope
 *
 * Feature: get-integration-working, Property 1: JSON-RPC 2.0 Response Envelope
 *
 * For any JSON-RPC 2.0 request (valid or invalid), the response SHALL always
 * contain `jsonrpc: "2.0"` and an `id` field. Success responses have `result`
 * and no `error`. Error responses have `error` and no `result`. The `id` in
 * the response matches the request `id` for valid id types (string, number),
 * and is passed through as-is by the formatters (the router normalizes
 * invalid id types to null before calling formatters).
 *
 * Validates: Requirements 1.1, 1.2, 1.4
 */

const fc = require('fast-check');
const {
  jsonRpcSuccess,
  jsonRpcError,
  JSON_RPC_ERRORS
} = require('../../utils/mcp-protocol');

describe('Feature: get-integration-working, Property 1: JSON-RPC 2.0 Response Envelope', () => {

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any valid id (string or number) and any result payload,
   * jsonRpcSuccess always produces a response with jsonrpc: "2.0",
   * matching id, a result field, and no error field.
   */
  test('jsonRpcSuccess always returns jsonrpc "2.0", matching id, result, and no error for valid id types', () => {
    const validIdArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 50 }),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true })
    );

    const resultArb = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.constant(null),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string()),
      fc.array(fc.string(), { maxLength: 5 })
    );

    fc.assert(
      fc.property(validIdArb, resultArb, (id, result) => {
        const response = jsonRpcSuccess(id, result);

        // Must have jsonrpc "2.0"
        expect(response.jsonrpc).toBe('2.0');

        // id must match
        expect(response.id).toBe(id);

        // Must have result
        expect(response).toHaveProperty('result');
        expect(response.result).toEqual(result);

        // Must NOT have error
        expect(response).not.toHaveProperty('error');
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any valid id (string or number) and any error details,
   * jsonRpcError always produces a response with jsonrpc: "2.0",
   * matching id, an error field with integer code and string message,
   * and no result field.
   */
  test('jsonRpcError always returns jsonrpc "2.0", matching id, error with code/message, and no result for valid id types', () => {
    const validIdArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 50 }),
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true })
    );

    const errorCodeArb = fc.constantFrom(
      JSON_RPC_ERRORS.PARSE_ERROR,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      JSON_RPC_ERRORS.INVALID_PARAMS,
      JSON_RPC_ERRORS.INTERNAL_ERROR
    );

    const errorMessageArb = fc.string({ minLength: 1, maxLength: 100 });

    fc.assert(
      fc.property(validIdArb, errorCodeArb, errorMessageArb, (id, code, message) => {
        const response = jsonRpcError(id, code, message);

        // Must have jsonrpc "2.0"
        expect(response.jsonrpc).toBe('2.0');

        // id must match
        expect(response.id).toBe(id);

        // Must have error with code and message
        expect(response).toHaveProperty('error');
        expect(typeof response.error.code).toBe('number');
        expect(Number.isInteger(response.error.code)).toBe(true);
        expect(response.error.code).toBe(code);
        expect(typeof response.error.message).toBe('string');
        expect(response.error.message).toBe(message);

        // Must NOT have result
        expect(response).not.toHaveProperty('result');
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * When the router normalizes invalid id types (objects, arrays, booleans,
   * undefined) to null before calling formatters, the response id is null.
   * This tests that the formatters correctly pass through null id.
   */
  test('jsonRpcSuccess and jsonRpcError pass through null id (used for invalid/missing id types)', () => {
    const resultArb = fc.oneof(
      fc.string(),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string()),
      fc.array(fc.integer(), { maxLength: 5 })
    );

    fc.assert(
      fc.property(resultArb, (result) => {
        const successResponse = jsonRpcSuccess(null, result);
        expect(successResponse.jsonrpc).toBe('2.0');
        expect(successResponse.id).toBeNull();
        expect(successResponse).toHaveProperty('result');
        expect(successResponse).not.toHaveProperty('error');

        const errorResponse = jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid Request');
        expect(errorResponse.jsonrpc).toBe('2.0');
        expect(errorResponse.id).toBeNull();
        expect(errorResponse).toHaveProperty('error');
        expect(errorResponse).not.toHaveProperty('result');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any id type and any error data payload, jsonRpcError includes
   * the optional data field in the error object when provided.
   */
  test('jsonRpcError includes optional data field when provided', () => {
    const idArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 30 }),
      fc.integer(),
      fc.constant(null)
    );

    const dataArb = fc.oneof(
      fc.string(),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string()),
      fc.array(fc.string(), { maxLength: 3 })
    );

    fc.assert(
      fc.property(idArb, dataArb, (id, data) => {
        const response = jsonRpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error', data);

        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe(id);
        expect(response.error).toHaveProperty('data');
        expect(response.error.data).toEqual(data);
        expect(response).not.toHaveProperty('result');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1**
   *
   * jsonRpcError omits the data field when data is undefined.
   */
  test('jsonRpcError omits data field when not provided', () => {
    const idArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 30 }),
      fc.integer(),
      fc.constant(null)
    );

    fc.assert(
      fc.property(idArb, (id) => {
        const response = jsonRpcError(id, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error');

        expect(response.jsonrpc).toBe('2.0');
        expect(response.error).not.toHaveProperty('data');
      }),
      { numRuns: 100 }
    );
  });
});
