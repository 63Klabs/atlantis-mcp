/**
 * Unit Tests for JSON Schema Validator
 *
 * Tests the JSON Schema validation for all MCP tool inputs.
 */

const {
  validate,
  getSchema,
  getToolNames
} = require('../../../utils/schema-validator');

describe('JSON Schema Validator', () => {
  describe('getToolNames()', () => {
    test('should return array of tool names', () => {
      const toolNames = getToolNames();

      expect(Array.isArray(toolNames)).toBe(true);
      expect(toolNames.length).toBeGreaterThan(0);
    });

    test('should include expected tool names', () => {
      const toolNames = getToolNames();

      expect(toolNames).toContain('list_templates');
      expect(toolNames).toContain('get_template');
      expect(toolNames).toContain('list_starters');
      expect(toolNames).toContain('validate_naming');
    });
  });

  describe('getSchema()', () => {
    test('should return schema for valid tool name', () => {
      const schema = getSchema('list_templates');

      expect(schema).not.toBeNull();
      expect(schema).toHaveProperty('type', 'object');
      expect(schema).toHaveProperty('properties');
    });

    test('should return null for invalid tool name', () => {
      const schema = getSchema('nonexistent_tool');

      expect(schema).toBeNull();
    });

    test('should return schema with correct structure', () => {
      const schema = getSchema('get_template');

      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('templateName');
      expect(schema.required).toContain('templateName');
    });
  });

  describe('validate() - General Validation', () => {
    test('should return error for unknown tool', () => {
      const result = validate('unknown_tool', {});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown tool: unknown_tool');
    });

    test('should return error for non-object input', () => {
      const result = validate('list_templates', 'not an object');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Input must be an object');
    });

    test('should return error for null input', () => {
      const result = validate('list_templates', null);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Input must be an object');
    });

    test('should return error for array input', () => {
      const result = validate('list_templates', []);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Input must be an object');
    });

    test('should accept empty object for tools with no required fields', () => {
      const result = validate('list_categories', {});

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('validate() - list_templates', () => {
    test('should accept valid input with category', () => {
      const result = validate('list_templates', { category: 'storage' });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('should accept valid input with version (now rejected as unknown property)', () => {
      const result = validate('list_templates', { version: 'v1.2.3' });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown property: version');
    });

    test('should accept valid input with s3Buckets array', () => {
      const result = validate('list_templates', {
        s3Buckets: ['bucket1', 'bucket2']
      });

      expect(result.valid).toBe(true);
    });

    test('should reject invalid category', () => {
      const result = validate('list_templates', { category: 'InvalidCategory' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be one of'))).toBe(true);
    });

    test('should reject additional properties', () => {
      const result = validate('list_templates', { unknownProp: 'value' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown property'))).toBe(true);
    });

    test('should reject empty s3Buckets array', () => {
      const result = validate('list_templates', { s3Buckets: [] });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 1 items'))).toBe(true);
    });

    test('should reject s3Buckets with invalid bucket names', () => {
      const result = validate('list_templates', { s3Buckets: ['ab'] });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 3 characters'))).toBe(true);
    });
  });

  describe('validate() - get_template', () => {
    test('should accept valid input with required fields', () => {
      const result = validate('get_template', {
        templateName: 'template-storage-s3.yml'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject missing required field templateName', () => {
      const result = validate('get_template', {});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required property: templateName');
    });

    test('should accept optional category field', () => {
      const result = validate('get_template', {
        templateName: 'template.yml',
        category: 'storage'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject empty templateName', () => {
      const result = validate('get_template', { templateName: '' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 1 characters'))).toBe(true);
    });

    test('should accept version and versionId together', () => {
      const result = validate('get_template', {
        templateName: 'template.yml',
        version: 'v1.0.0',
        versionId: 'abc123'
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('validate() - list_starters', () => {
    test('should accept empty input', () => {
      const result = validate('list_starters', {});

      expect(result.valid).toBe(true);
    });

    test('should accept valid s3Buckets array', () => {
      const result = validate('list_starters', {
        s3Buckets: ['63klabs', 'mybucket']
      });

      expect(result.valid).toBe(true);
    });

    test('should accept valid namespace', () => {
      const result = validate('list_starters', {
        namespace: '63klabs'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject empty s3Buckets array', () => {
      const result = validate('list_starters', { s3Buckets: [] });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 1 items'))).toBe(true);
    });

    test('should reject s3Buckets with short bucket names', () => {
      const result = validate('list_starters', { s3Buckets: ['ab'] });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 3 characters'))).toBe(true);
    });

    test('should reject ghusers as unknown property', () => {
      const result = validate('list_starters', { ghusers: ['63klabs'] });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown property'))).toBe(true);
    });
  });

  describe('validate() - get_starter_info', () => {
    test('should accept valid input with required starterName', () => {
      const result = validate('get_starter_info', {
        starterName: 'atlantis-starter-01'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject missing required field starterName', () => {
      const result = validate('get_starter_info', {});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required property: starterName');
    });

    test('should accept optional s3Buckets field', () => {
      const result = validate('get_starter_info', {
        starterName: 'starter',
        s3Buckets: ['63klabs']
      });

      expect(result.valid).toBe(true);
    });

    test('should accept optional namespace field', () => {
      const result = validate('get_starter_info', {
        starterName: 'starter',
        namespace: '63klabs'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject ghusers as unknown property', () => {
      const result = validate('get_starter_info', {
        starterName: 'starter',
        ghusers: ['63klabs']
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown property'))).toBe(true);
    });
  });

  describe('validate() - search_documentation', () => {
    test('should accept valid input with required query', () => {
      const result = validate('search_documentation', {
        query: 'CloudFormation templates'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject missing required field query', () => {
      const result = validate('search_documentation', {});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required property: query');
    });

    test('should reject empty query string', () => {
      const result = validate('search_documentation', { query: '' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 1 characters'))).toBe(true);
    });

    test('should accept valid type filter', () => {
      const result = validate('search_documentation', {
        query: 'test',
        type: 'guide'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject invalid type value', () => {
      const result = validate('search_documentation', {
        query: 'test',
        type: 'invalid'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be one of'))).toBe(true);
    });
  });

  describe('validate() - validate_naming', () => {
    test('should accept valid input with required resourceName', () => {
      const result = validate('validate_naming', {
        resourceName: 'my-resource-name'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject missing required field resourceName', () => {
      const result = validate('validate_naming', {});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required property: resourceName');
    });

    test('should accept valid resourceType', () => {
      const result = validate('validate_naming', {
        resourceName: 'test',
        resourceType: 's3'
      });

      expect(result.valid).toBe(true);
    });

    test('should accept any string resourceType (no enum constraint)', () => {
      const result = validate('validate_naming', {
        resourceName: 'test',
        resourceType: 'custom-type'
      });

      // resourceType has no enum constraint — any string is valid
      expect(result.valid).toBe(true);
    });
  });

  describe('validate() - check_template_updates', () => {
    test('should accept valid input with required fields', () => {
      const result = validate('check_template_updates', {
        templateName: 'template.yml',
        currentVersion: 'v1.0.0'
      });

      expect(result.valid).toBe(true);
    });

    test('should reject missing required field templateName', () => {
      const result = validate('check_template_updates', {
        currentVersion: 'v1.0.0'
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required property: templateName');
    });

    test('should reject missing required field currentVersion', () => {
      const result = validate('check_template_updates', {
        templateName: 'template.yml'
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required property: currentVersion');
    });

    test('should accept optional category field', () => {
      const result = validate('check_template_updates', {
        templateName: 'template.yml',
        currentVersion: 'v1.0.0',
        category: 'storage'
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Type Validation', () => {
    test('should reject wrong type for string property', () => {
      const result = validate('get_template', {
        templateName: 123
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be of type string'))).toBe(true);
    });

    test('should reject wrong type for array property', () => {
      const result = validate('list_templates', {
        s3Buckets: 'not-an-array'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be of type array'))).toBe(true);
    });

    test('should validate array item types', () => {
      const result = validate('list_starters', {
        s3Buckets: [123, 456]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be of type string'))).toBe(true);
    });
  });

  describe('Pattern Validation', () => {
    test('should validate version pattern', () => {
      const result = validate('get_template', {
        templateName: 'template.yml',
        version: 'invalid-version'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('does not match required pattern'))).toBe(true);
    });

    test('should accept valid version pattern', () => {
      const result = validate('get_template', {
        templateName: 'template.yml',
        version: 'v1.2.3'
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Length Validation', () => {
    test('should validate minLength for strings', () => {
      const result = validate('get_template', {
        templateName: ''
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 1 characters'))).toBe(true);
    });

    test('should validate minItems for arrays', () => {
      const result = validate('list_templates', {
        s3Buckets: []
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 1 items'))).toBe(true);
    });

    test('should validate maxLength for strings', () => {
      const longBucketName = 'a'.repeat(64);
      const result = validate('list_templates', {
        s3Buckets: [longBucketName]
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at most 63 characters'))).toBe(true);
    });
  });

  describe('Enum Validation', () => {
    test('should validate enum values for category', () => {
      const validCategories = ['storage', 'network', 'pipeline', 'service-role', 'modules'];

      validCategories.forEach(category => {
        const result = validate('list_templates', { category });
        expect(result.valid).toBe(true);
      });
    });

    test('should reject invalid enum values', () => {
      const result = validate('list_templates', { category: 'InvalidCategory' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('must be one of'))).toBe(true);
    });
  });

  describe('Additional Properties Validation', () => {
    test('should reject additional properties when not allowed', () => {
      const result = validate('list_templates', {
        category: 'storage',
        unknownField: 'value'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown property'))).toBe(true);
    });

    test('should list all unknown properties', () => {
      const result = validate('list_templates', {
        unknown1: 'value1',
        unknown2: 'value2'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.filter(e => e.includes('Unknown property')).length).toBe(2);
    });
  });

  describe('Complex Validation Scenarios', () => {
    test('should validate multiple errors at once', () => {
      const result = validate('get_template', {
        templateName: '',
        category: 'Invalid',
        unknownProp: 'value'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    test('should validate nested array item properties', () => {
      const result = validate('list_templates', {
        s3Buckets: ['valid-bucket', 'ab', '']
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
});
