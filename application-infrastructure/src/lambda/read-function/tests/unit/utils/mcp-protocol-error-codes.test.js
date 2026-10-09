/**
 * Unit Tests for JSON-RPC Error Codes in mcp-protocol.js
 *
 * Tests that JSON_RPC_ERRORS constant contains the correct error codes
 * including both standard JSON-RPC 2.0 codes and MCP protocol-specific codes.
 *
 * Requirements: 7.1, 7.2, 7.3
 */

const { JSON_RPC_ERRORS } = require('../../../utils/mcp-protocol');

describe('JSON_RPC_ERRORS', () => {
  describe('Standard JSON-RPC 2.0 Error Codes', () => {
    it('should define PARSE_ERROR as -32700', () => {
      expect(JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700);
    });

    it('should define INVALID_REQUEST as -32600', () => {
      expect(JSON_RPC_ERRORS.INVALID_REQUEST).toBe(-32600);
    });

    it('should define METHOD_NOT_FOUND as -32601', () => {
      expect(JSON_RPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
    });

    it('should define INVALID_PARAMS as -32602', () => {
      expect(JSON_RPC_ERRORS.INVALID_PARAMS).toBe(-32602);
    });

    it('should define INTERNAL_ERROR as -32603', () => {
      expect(JSON_RPC_ERRORS.INTERNAL_ERROR).toBe(-32603);
    });
  });

  describe('MCP Protocol-Specific Error Codes', () => {
    it('should define HEADER_MISMATCH as -32020', () => {
      expect(JSON_RPC_ERRORS.HEADER_MISMATCH).toBe(-32020);
    });

    it('should define MISSING_REQUIRED_CLIENT_CAPABILITY as -32021', () => {
      expect(JSON_RPC_ERRORS.MISSING_REQUIRED_CLIENT_CAPABILITY).toBe(-32021);
    });

    it('should define UNSUPPORTED_PROTOCOL_VERSION as -32022', () => {
      expect(JSON_RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION).toBe(-32022);
    });
  });

  describe('Error Code Properties', () => {
    it('should have exactly 8 error codes defined', () => {
      expect(Object.keys(JSON_RPC_ERRORS)).toHaveLength(8);
    });

    it('should have all error codes as negative integers', () => {
      Object.values(JSON_RPC_ERRORS).forEach(code => {
        expect(typeof code).toBe('number');
        expect(code).toBeLessThan(0);
        expect(Number.isInteger(code)).toBe(true);
      });
    });

    it('should have unique error code values', () => {
      const values = Object.values(JSON_RPC_ERRORS);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it('should use uppercase snake_case for error code names', () => {
      Object.keys(JSON_RPC_ERRORS).forEach(name => {
        expect(name).toMatch(/^[A-Z_]+$/);
      });
    });
  });

  describe('Error Code Ranges', () => {
    it('should have standard JSON-RPC codes in -327xx range', () => {
      expect(JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700);
    });

    it('should have standard JSON-RPC codes in -326xx range', () => {
      const standardCodes = [
        JSON_RPC_ERRORS.INVALID_REQUEST,
        JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        JSON_RPC_ERRORS.INVALID_PARAMS,
        JSON_RPC_ERRORS.INTERNAL_ERROR
      ];
      standardCodes.forEach(code => {
        expect(code).toBeGreaterThanOrEqual(-32699);
        expect(code).toBeLessThanOrEqual(-32600);
      });
    });

    it('should have MCP protocol codes in -320xx range', () => {
      const mcpCodes = [
        JSON_RPC_ERRORS.HEADER_MISMATCH,
        JSON_RPC_ERRORS.MISSING_REQUIRED_CLIENT_CAPABILITY,
        JSON_RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION
      ];
      mcpCodes.forEach(code => {
        expect(code).toBeGreaterThanOrEqual(-32099);
        expect(code).toBeLessThanOrEqual(-32000);
      });
    });
  });

  describe('Semantic Validation', () => {
    it('HEADER_MISMATCH code should be appropriate for header inconsistency errors', () => {
      // -32020 is in the implementation-defined range (-32000 to -32099)
      expect(JSON_RPC_ERRORS.HEADER_MISMATCH).toBe(-32020);
    });

    it('MISSING_REQUIRED_CLIENT_CAPABILITY code should be appropriate for capability errors', () => {
      expect(JSON_RPC_ERRORS.MISSING_REQUIRED_CLIENT_CAPABILITY).toBe(-32021);
    });

    it('UNSUPPORTED_PROTOCOL_VERSION code should be appropriate for version negotiation errors', () => {
      expect(JSON_RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION).toBe(-32022);
    });
  });
});
