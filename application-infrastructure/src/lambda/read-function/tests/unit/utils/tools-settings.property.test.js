/**
 * Property-Based Tests for Tool Definition Structural Invariant
 *
 * Feature: add-tools-endpoint-which-lists-available-tools
 * Property 1: Tool definition structural invariant
 *
 * For any entry in availableToolsList, verify name is a non-empty string,
 * description is a non-empty string, and inputSchema is a non-null object.
 *
 * Validates: Requirements 1.3, 3.3
 */

const fc = require('fast-check');

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

const settings = require('../../../config/settings');

describe('Feature: add-tools-endpoint-which-lists-available-tools, Property 1: Tool definition structural invariant', () => {

  const availableToolsList = settings.tools.availableToolsList;

  test('every tool definition has a non-empty name string, non-empty description string, and non-null inputSchema object', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: availableToolsList.length - 1 }),
        (index) => {
          const tool = availableToolsList[index];

          // name is a non-empty string
          expect(typeof tool.name).toBe('string');
          expect(tool.name.length).toBeGreaterThan(0);

          // description is a non-empty string
          expect(typeof tool.description).toBe('string');
          expect(tool.description.length).toBeGreaterThan(0);

          // inputSchema is a non-null object
          expect(tool.inputSchema).not.toBeNull();
          expect(typeof tool.inputSchema).toBe('object');
        }
      ),
      { numRuns: 100 }
    );
  });
});
