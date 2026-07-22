/**
 * Property-Based Tests for No Legacy Keys in JSON-RPC Responses
 *
 * Feature: get-integration-working, Property 2: No Legacy Keys in JSON-RPC Responses
 *
 * For any response produced by the MCP Protocol Layer's JSON-RPC 2.0 formatters
 * (jsonRpcSuccess or jsonRpcError), the top-level object SHALL NOT contain any
 * of the keys: protocol, version, tool, success, data, or timestamp.
 *
 * Validates: Requirements 1.3
 */

const fc = require('fast-check');
const {
  jsonRpcSuccess,
  jsonRpcError,
  JSON_RPC_ERRORS
} = require('../../utils/mcp-protocol');

/** Legacy keys that must never appear at the top level of JSON-RPC 2.0 responses */
const LEGACY_KEYS = ['protocol', 'version', 'tool', 'success', 'data', 'timestamp'];

describe('Feature: get-integration-working, Property 2: No Legacy Keys in JSON-RPC Responses', () => {

  /** Arbitrary for id values: strings, numbers, or null */
  const idArb = fc.oneof(
    fc.string({ minLength: 0, maxLength: 50 }),
    fc.integer(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.constant(null)
  );

  /** Arbitrary for result payloads */
  const resultArb = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.constant(null),
    fc.constant(undefined),
    fc.boolean(),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string()),
    fc.array(fc.string(), { maxLength: 5 })
  );

  /** Arbitrary for standard JSON-RPC error codes */
  const errorCodeArb = fc.constantFrom(
    JSON_RPC_ERRORS.PARSE_ERROR,
    JSON_RPC_ERRORS.INVALID_REQUEST,
    JSON_RPC_ERRORS.METHOD_NOT_FOUND,
    JSON_RPC_ERRORS.INVALID_PARAMS,
    JSON_RPC_ERRORS.INTERNAL_ERROR
  );

  /** Arbitrary for error messages */
  const errorMessageArb = fc.string({ minLength: 1, maxLength: 100 });

  /** Arbitrary for optional error data */
  const errorDataArb = fc.oneof(
    fc.constant(undefined),
    fc.string(),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string()),
    fc.array(fc.string(), { maxLength: 3 })
  );

  /**
   * **Validates: Requirements 1.3**
   *
   * For any id and result payload, jsonRpcSuccess never produces a response
   * containing legacy keys at the top level.
   */
  test('jsonRpcSuccess never contains legacy keys at top level', () => {
    fc.assert(
      fc.property(idArb, resultArb, (id, result) => {
        const response = jsonRpcSuccess(id, result);
        const topLevelKeys = Object.keys(response);

        for (const legacyKey of LEGACY_KEYS) {
          expect(topLevelKeys).not.toContain(legacyKey);
        }
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * For any id, error code, message, and optional data, jsonRpcError never
   * produces a response containing legacy keys at the top level.
   */
  test('jsonRpcError never contains legacy keys at top level', () => {
    fc.assert(
      fc.property(idArb, errorCodeArb, errorMessageArb, errorDataArb, (id, code, message, data) => {
        const response = data !== undefined
          ? jsonRpcError(id, code, message, data)
          : jsonRpcError(id, code, message);
        const topLevelKeys = Object.keys(response);

        for (const legacyKey of LEGACY_KEYS) {
          expect(topLevelKeys).not.toContain(legacyKey);
        }
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * Combined property: for any random inputs to either formatter, the response
   * only contains the allowed JSON-RPC 2.0 keys (jsonrpc, id, result, error).
   */
  test('JSON-RPC formatters only produce allowed top-level keys', () => {
    const ALLOWED_SUCCESS_KEYS = ['jsonrpc', 'id', 'result'];
    const ALLOWED_ERROR_KEYS = ['jsonrpc', 'id', 'error'];

    fc.assert(
      fc.property(idArb, resultArb, errorCodeArb, errorMessageArb, (id, result, code, message) => {
        const successResponse = jsonRpcSuccess(id, result);
        const successKeys = Object.keys(successResponse);
        for (const key of successKeys) {
          expect(ALLOWED_SUCCESS_KEYS).toContain(key);
        }

        const errorResponse = jsonRpcError(id, code, message);
        const errorKeys = Object.keys(errorResponse);
        for (const key of errorKeys) {
          expect(ALLOWED_ERROR_KEYS).toContain(key);
        }
      }),
      { numRuns: 100 }
    );
  });
});
