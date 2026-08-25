/**
 * Unit Tests for the search_documentation type/subType filter contract
 *
 * Covers:
 * - The `type` enum matches the values the doc-indexer actually stores
 *   (documentation, template-pattern, code-example)
 * - The `subType` enum is present and both filters are optional
 * - Valid filter values validate; invalid values are rejected
 * - Omitting both filters leaves validation (and controller passthrough) unchanged
 * - The advertised tool schema (settings.availableToolsList) agrees with the
 *   SchemaValidator schema, and both descriptions carry the refine hint
 * - No pre-existing search_documentation input field was removed or renamed
 *
 * Requirements: 8.3, 10.1, 10.4
 */

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

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

const { validate, getSchema } = require('../../../utils/schema-validator');
const settings = require('../../../config/settings');
const { extendedDescriptions } = require('../../../config/tool-descriptions');

/** Values written by the doc-indexer extractors (markdown / cloudformation / jsdoc / python). */
const STORED_TYPES = ['documentation', 'template-pattern', 'code-example'];
const STORED_SUB_TYPES = ['guide', 'function', 'parameter'];

describe('search_documentation filter schema', () => {

  describe('type filter', () => {
    test.each(STORED_TYPES)('should accept stored type value "%s"', (type) => {
      const result = validate('search_documentation', { query: 'cache-data', type });

      expect(result.valid).toBe(true);
    });

    test('should reject the legacy enum values that matched nothing in the index', () => {
      for (const legacy of ['guide', 'tutorial', 'reference', 'troubleshooting', 'template pattern', 'code example']) {
        const result = validate('search_documentation', { query: 'cache-data', type: legacy });

        expect(result.valid).toBe(false);
      }
    });

    test('should reject an unknown type value', () => {
      const result = validate('search_documentation', { query: 'cache-data', type: 'not-a-type' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be one of'))).toBe(true);
    });
  });

  describe('subType filter', () => {
    test.each(STORED_SUB_TYPES)('should accept stored subType value "%s"', (subType) => {
      const result = validate('search_documentation', { query: 'cache-data', subType });

      expect(result.valid).toBe(true);
    });

    test('should reject an unknown subType value', () => {
      const result = validate('search_documentation', { query: 'cache-data', subType: 'not-a-subtype' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be one of'))).toBe(true);
    });

    test('should accept type and subType together', () => {
      const result = validate('search_documentation', {
        query: 'cache-data',
        type: 'code-example',
        subType: 'function'
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('both filters are optional', () => {
    test('should accept a query with no filters (unchanged behavior)', () => {
      const result = validate('search_documentation', { query: 'cache-data' });

      expect(result.valid).toBe(true);
    });

    test('should not list type or subType as required', () => {
      const schema = getSchema('search_documentation');

      expect(schema.required).toEqual(['query']);
      expect(schema.required).not.toContain('type');
      expect(schema.required).not.toContain('subType');
    });
  });

  describe('backward compatibility (Req 10.1, 10.4)', () => {
    test('should retain every pre-existing input field', () => {
      const schema = getSchema('search_documentation');

      // Fields that existed before this change; none may be removed or renamed.
      expect(Object.keys(schema.properties)).toEqual(
        expect.arrayContaining(['query', 'type', 'ghusers'])
      );
      expect(schema.properties.query.type).toBe('string');
      expect(schema.properties.ghusers.type).toBe('array');
    });

    test('should keep ghusers filtering working alongside the new filters', () => {
      const result = validate('search_documentation', {
        query: 'cache-data',
        type: 'documentation',
        subType: 'guide',
        ghusers: ['63klabs']
      });

      expect(result.valid).toBe(true);
    });
  });
});

describe('search_documentation advertised tool metadata', () => {
  const tool = settings.tools.availableToolsList.find(t => t.name === 'search_documentation');

  test('should advertise the same type/subType enums as the validator', () => {
    const schema = getSchema('search_documentation');

    expect(tool.inputSchema.properties.type.enum).toEqual(schema.properties.type.enum);
    expect(tool.inputSchema.properties.subType.enum).toEqual(schema.properties.subType.enum);
    expect(tool.inputSchema.properties.type.enum).toEqual(STORED_TYPES);
    expect(tool.inputSchema.properties.subType.enum).toEqual(STORED_SUB_TYPES);
  });

  test('should mark both filters optional in the advertised schema', () => {
    expect(tool.inputSchema.required).toEqual(['query']);
  });

  test('should describe both filters as optional and hint at refining broad results', () => {
    expect(tool.description).toMatch(/refine/i);
    expect(tool.description).toContain('subType');
    expect(tool.inputSchema.properties.type.description).toMatch(/optional/i);
    expect(tool.inputSchema.properties.subType.description).toMatch(/optional/i);
  });

  test('should carry the refine hint and stored enum values in the extended description', () => {
    const description = extendedDescriptions.search_documentation;

    expect(description).toMatch(/refine/i);
    for (const value of [...STORED_TYPES, ...STORED_SUB_TYPES]) {
      expect(description).toContain(value);
    }
  });
});
