/**
 * Property-Based Tests for GET Eligibility Derivation
 *
 * Feature: allow-get-on-tools-that-list
 * Property 1: GET eligibility is determined by absence of required parameters
 *
 * For any set of tool definitions, getGetEligibleTools() returns exactly
 * those tools whose inputSchema has no `required` array or has an empty
 * `required` array.
 *
 * Validates: Requirements 1.2, 1.3
 */

const fc = require('fast-check');

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

// Mock @63klabs/cache-data since settings.js imports it
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    CachedSsmParameter: jest.fn().mockImplementation(() => ({
      getValue: jest.fn().mockResolvedValue('mock-value')
    }))
  }
}));

const settings = require('../../../config/settings');

describe('Feature: allow-get-on-tools-that-list, Property 1: GET eligibility is determined by absence of required parameters', () => {

  // Save original list for restoration
  const originalList = settings.tools.availableToolsList;

  afterEach(() => {
    settings.tools.availableToolsList = originalList;
  });

  /**
   * **Validates: Requirements 1.2, 1.3**
   *
   * For any randomly generated set of tool definitions, getGetEligibleTools()
   * returns exactly the names of tools without a `required` array.
   */
  test('getGetEligibleTools() returns exactly tools without required arrays for any generated tool set', () => {
    // Arbitrary for a single tool definition: randomly has or lacks a required array
    const toolDefArb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 30 }).filter(n => /^[a-z_][a-z0-9_]*$/.test(n)),
      hasRequired: fc.boolean()
    }).map(({ name, hasRequired }) => {
      if (hasRequired) {
        return {
          name,
          description: `Description for ${name}`,
          inputSchema: {
            type: 'object',
            properties: { param: { type: 'string' } },
            required: ['param']
          }
        };
      }
      return {
        name,
        description: `Description for ${name}`,
        inputSchema: {
          type: 'object',
          properties: {}
        }
      };
    });

    // Generate arrays of 1-20 tool definitions with unique names
    const toolListArb = fc.array(toolDefArb, { minLength: 1, maxLength: 20 })
      .map(tools => {
        // Deduplicate by name, keeping first occurrence
        const seen = new Set();
        return tools.filter(t => {
          if (seen.has(t.name)) return false;
          seen.add(t.name);
          return true;
        });
      })
      .filter(tools => tools.length > 0);

    fc.assert(
      fc.property(toolListArb, (toolDefs) => {
        // Set the generated tools as availableToolsList
        settings.tools.availableToolsList = toolDefs;

        // Call the method under test
        const result = settings.tools.getGetEligibleTools();

        // Compute expected: tools without a required array
        const expected = toolDefs
          .filter(t => !t.inputSchema.required || t.inputSchema.required.length === 0)
          .map(t => t.name);

        // Assert exact match
        expect(result).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });
});
