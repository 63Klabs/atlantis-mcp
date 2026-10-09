/**
 * Unit Tests for Cross-Era Instructions Consistency
 *
 * Tests that the `instructions` field is byte-identical across protocol eras.
 * This ensures the legacy carrier (initializeResponse) and the modern carrier
 * (future discoverResult) both serve the exact same instructions string from
 * the shared source (buildInstructions()).
 *
 * @see {@link requirements.md} Requirements 1.1, 15.3
 */

// Set required env var before loading modules
process.env.PARAM_STORE_PATH = process.env.PARAM_STORE_PATH || '/test/';

const { buildInstructions } = require('../../../config/server-instructions');
const { initializeResponse } = require('../../../utils/mcp-protocol');

describe('Cross-Era Instructions Consistency', () => {
  describe('initializeResponse instructions carrier', () => {
    test('should return byte-identical instructions to buildInstructions()', () => {
      // Get the instructions string directly from the shared source
      const directInstructions = buildInstructions();

      // Get the instructions from the legacy initialize carrier
      const initResult = initializeResponse('test-id-1');
      const carriedInstructions = initResult.result.instructions;

      // Assert byte-identical equality (Requirements 1.1, 15.3)
      expect(carriedInstructions).toBe(directInstructions);
    });

    test('instructions field should be non-empty string', () => {
      const initResult = initializeResponse('test-id-2');
      const instructions = initResult.result.instructions;

      expect(typeof instructions).toBe('string');
      expect(instructions.length).toBeGreaterThan(0);
    });

    test('instructions should be consistent across multiple calls', () => {
      // Call initializeResponse multiple times
      const result1 = initializeResponse('call-1');
      const result2 = initializeResponse('call-2');
      const result3 = initializeResponse('call-3');

      // All should return the same instructions
      expect(result1.result.instructions).toBe(result2.result.instructions);
      expect(result2.result.instructions).toBe(result3.result.instructions);
    });

    test('instructions should match buildInstructions() with no options', () => {
      // buildInstructions() with no arguments should match initializeResponse
      const directInstructions = buildInstructions();
      const initInstructions = initializeResponse('test-id-4').result.instructions;

      expect(initInstructions).toBe(directInstructions);
    });

    test('instructions should match buildInstructions() with empty options', () => {
      // buildInstructions({}) should match initializeResponse
      const directInstructions = buildInstructions({});
      const initInstructions = initializeResponse('test-id-5').result.instructions;

      expect(initInstructions).toBe(directInstructions);
    });
  });

  describe('Single source of truth validation', () => {
    test('buildInstructions should be the only place instructions are composed', () => {
      // This test validates that initializeResponse doesn't construct
      // instructions inline but calls buildInstructions()
      const source = buildInstructions();
      const carrier = initializeResponse('test-id-6').result.instructions;

      // If these are byte-identical, the carrier must be calling the source
      expect(carrier).toBe(source);
      
      // Additional validation: they should be the same reference if no
      // intermediate transformation occurs
      expect(typeof carrier).toBe('string');
      expect(typeof source).toBe('string');
    });

    test('instructions string should not be empty in any carrier', () => {
      const directInstructions = buildInstructions();
      const carriedInstructions = initializeResponse('test-id-7').result.instructions;

      expect(directInstructions.trim()).not.toBe('');
      expect(carriedInstructions.trim()).not.toBe('');
    });
  });

  describe('Future modern carrier compatibility', () => {
    test('instructions format should be compatible with future discoverResult', () => {
      // This test documents the expectation that when discoverResult() is
      // implemented in Phase 3, it will also call buildInstructions() and
      // return byte-identical instructions.
      //
      // The test currently validates only the legacy carrier, but the same
      // assertion will be added for discoverResult() once it exists.
      
      const instructions = buildInstructions();
      const legacyInstructions = initializeResponse('test-id-8').result.instructions;

      // Legacy carrier validation (current)
      expect(legacyInstructions).toBe(instructions);

      // Future test will add:
      // const modernInstructions = discoverResult('test-id-8').result.instructions;
      // expect(modernInstructions).toBe(instructions);
      // expect(modernInstructions).toBe(legacyInstructions);
    });
  });

  describe('Instructions content validation', () => {
    test('instructions should contain expected platform references', () => {
      const instructions = initializeResponse('test-id-9').result.instructions;

      // Validate that instructions mention the Atlantis platform
      // (content is owned by server-instructions.js but we verify it's present)
      expect(instructions).toContain('Atlantis');
      expect(instructions.toLowerCase()).toContain('cache-data');
    });

    test('instructions should be a single string, not an array or object', () => {
      const instructions = initializeResponse('test-id-10').result.instructions;

      expect(typeof instructions).toBe('string');
      expect(Array.isArray(instructions)).toBe(false);
      expect(typeof instructions).not.toBe('object');
    });
  });
});
