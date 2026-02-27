/**
 * Unit tests for JSON Schema validation across all controllers
 *
 * Tests that all controllers properly validate input using JSON Schema:
 * - Templates controller (list, get, listVersions, listCategories)
 * - Starters controller (list, get)
 * - Documentation controller (search)
 * - Validation controller (validate)
 * - Updates controller (check)
 *
 * Tests include:
 * - Required field validation
 * - Type validation
 * - Format validation
 * - Array validation
 * - Enum validation
 * - Error message clarity
 */

// Mock dependencies
jest.mock('../../../services', () => ({
  Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn(),
    listCategories: jest.fn(),
    checkUpdates: jest.fn()
  },
  Starters: {
    list: jest.fn(),
    get: jest.fn()
  },
  Documentation: {
    search: jest.fn()
  },
  Validation: {
    validateNaming: jest.fn()
  }
}));

jest.mock('../../../utils/schema-validator', () => ({
  validate: jest.fn()
}));

jest.mock('../../../utils/mcp-protocol', () => ({
  successResponse: jest.fn((tool, data) => ({ success: true, tool, data })),
  errorResponse: jest.fn((code, details, tool) => ({ success: false, code, details, tool }))
}));

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    }
  }
}));

const TemplatesController = require('../../../controllers/templates');
const StartersController = require('../../../controllers/starters');
const DocumentationController = require('../../../controllers/documentation');
const ValidationController = require('../../../controllers/validation');
const UpdatesController = require('../../../controllers/updates');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');

describe('JSON Schema Validation Across Controllers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Templates Controller Schema Validation', () => {
    test('list_templates: should reject invalid category type', async () => {
      const props = {
        body: {
          input: {
            category: 123 // Should be string
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'category', message: 'Must be a string' }]
      });

      const result = await TemplatesController.list(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'category' })
          ])
        }),
        'list_templates'
      );
    });

    test('list_templates: should reject invalid s3Buckets type', async () => {
      const props = {
        body: {
          input: {
            s3Buckets: 'not-an-array' // Should be array
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 's3Buckets', message: 'Must be an array' }]
      });

      const result = await TemplatesController.list(props);

      expect(result.success).toBe(false);
    });

    test('get_template: should reject missing required templateName', async () => {
      const props = {
        body: {
          input: {
            category: 'Storage'
            // Missing required templateName
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'templateName', message: 'Required field missing' }]
      });

      const result = await TemplatesController.get(props);

      expect(result.success).toBe(false);
    });

    test('list_template_versions: should reject missing required templateName', async () => {
      const props = {
        body: {
          input: {
            category: 'Storage'
            // Missing required templateName
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'templateName', message: 'Required field missing' }]
      });

      const result = await TemplatesController.listVersions(props);

      expect(result.success).toBe(false);
    });

    test('list_categories: should reject unknown parameters', async () => {
      const props = {
        body: {
          input: {
            unknownParam: 'value'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'unknownParam', message: 'Unknown parameter' }]
      });

      const result = await TemplatesController.listCategories(props);

      expect(result.success).toBe(false);
    });
  });

  describe('Starters Controller Schema Validation', () => {
    test('list_starters: should reject invalid ghusers type', async () => {
      const props = {
        body: {
          input: {
            ghusers: 'not-an-array' // Should be array
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'ghusers', message: 'Must be an array' }]
      });

      const result = await StartersController.list(props);

      expect(result.success).toBe(false);
    });

    test('list_starters: should reject empty array for ghusers', async () => {
      const props = {
        body: {
          input: {
            ghusers: [] // Should have at least one element
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'ghusers', message: 'Array must not be empty' }]
      });

      const result = await StartersController.list(props);

      expect(result.success).toBe(false);
    });

    test('get_starter_info: should reject missing required starterName', async () => {
      const props = {
        body: {
          input: {
            ghusers: ['63klabs']
            // Missing required starterName
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'starterName', message: 'Required field missing' }]
      });

      const result = await StartersController.get(props);

      expect(result.success).toBe(false);
    });

    test('get_starter_info: should reject invalid starterName type', async () => {
      const props = {
        body: {
          input: {
            starterName: 123 // Should be string
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'starterName', message: 'Must be a string' }]
      });

      const result = await StartersController.get(props);

      expect(result.success).toBe(false);
    });
  });

  describe('Documentation Controller Schema Validation', () => {
    test('search_documentation: should reject missing required query', async () => {
      const props = {
        body: {
          input: {
            type: 'documentation'
            // Missing required query
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'query', message: 'Required field missing' }]
      });

      const result = await DocumentationController.search(props);

      expect(result.success).toBe(false);
    });

    test('search_documentation: should reject invalid query type', async () => {
      const props = {
        body: {
          input: {
            query: 123 // Should be string
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'query', message: 'Must be a string' }]
      });

      const result = await DocumentationController.search(props);

      expect(result.success).toBe(false);
    });

    test('search_documentation: should reject invalid type enum value', async () => {
      const props = {
        body: {
          input: {
            query: 'test',
            type: 'invalid-type' // Should be one of allowed values
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'type', message: 'Must be one of: guide, tutorial, reference, troubleshooting, template pattern, code example' }]
      });

      const result = await DocumentationController.search(props);

      expect(result.success).toBe(false);
    });

    test('search_documentation: should reject empty query string', async () => {
      const props = {
        body: {
          input: {
            query: '' // Should not be empty
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'query', message: 'String must not be empty' }]
      });

      const result = await DocumentationController.search(props);

      expect(result.success).toBe(false);
    });
  });

  describe('Validation Controller Schema Validation', () => {
    test('validate_naming: should reject missing required resourceName', async () => {
      const props = {
        body: {
          input: {
            resourceType: 'application'
            // Missing required resourceName
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'resourceName', message: 'Required field missing' }]
      });

      const result = await ValidationController.validate(props);

      expect(result.success).toBe(false);
    });

    test('validate_naming: should reject invalid resourceName type', async () => {
      const props = {
        body: {
          input: {
            resourceName: 123 // Should be string
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'resourceName', message: 'Must be a string' }]
      });

      const result = await ValidationController.validate(props);

      expect(result.success).toBe(false);
    });

    test('validate_naming: should reject invalid resourceType enum value', async () => {
      const props = {
        body: {
          input: {
            resourceName: 'test-name',
            resourceType: 'invalid-type' // Should be one of allowed values
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'resourceType', message: 'Must be one of: s3, dynamodb, lambda, cloudformation, application' }]
      });

      const result = await ValidationController.validate(props);

      expect(result.success).toBe(false);
    });

    test('validate_naming: should reject empty resourceName', async () => {
      const props = {
        body: {
          input: {
            resourceName: '' // Should not be empty
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'resourceName', message: 'String must not be empty' }]
      });

      const result = await ValidationController.validate(props);

      expect(result.success).toBe(false);
    });
  });

  describe('Updates Controller Schema Validation', () => {
    test('check_template_updates: should reject missing required templateName', async () => {
      const props = {
        body: {
          input: {
            currentVersion: 'v1.3.4/2024-01-10'
            // Missing required templateName
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'templateName', message: 'Required field missing' }]
      });

      const result = await UpdatesController.check(props);

      expect(result.success).toBe(false);
    });

    test('check_template_updates: should reject missing required currentVersion', async () => {
      const props = {
        body: {
          input: {
            templateName: 'template-storage-s3-artifacts'
            // Missing required currentVersion
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'currentVersion', message: 'Required field missing' }]
      });

      const result = await UpdatesController.check(props);

      expect(result.success).toBe(false);
    });

    test('check_template_updates: should reject invalid templateName type', async () => {
      const props = {
        body: {
          input: {
            templateName: 123, // Should be string
            currentVersion: 'v1.3.4/2024-01-10'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'templateName', message: 'Must be a string' }]
      });

      const result = await UpdatesController.check(props);

      expect(result.success).toBe(false);
    });

    test('check_template_updates: should reject invalid currentVersion format', async () => {
      const props = {
        body: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'invalid-version' // Should match version format
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'currentVersion', message: 'Must match format: vX.X.X/YYYY-MM-DD' }]
      });

      const result = await UpdatesController.check(props);

      expect(result.success).toBe(false);
    });
  });

  describe('Multiple Validation Errors', () => {
    test('should return all validation errors at once', async () => {
      const props = {
        body: {
          input: {
            // Multiple invalid fields
            category: 123,
            version: true,
            s3Buckets: 'not-an-array'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [
          { field: 'category', message: 'Must be a string' },
          { field: 'version', message: 'Must be a string' },
          { field: 's3Buckets', message: 'Must be an array' }
        ]
      });

      const result = await TemplatesController.list(props);

      expect(result.success).toBe(false);
      expect(result.details.errors).toHaveLength(3);
    });

    test('should provide clear error messages for nested validation', async () => {
      const props = {
        body: {
          input: {
            s3Buckets: ['valid-bucket', 123, null] // Array with invalid elements
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [
          { field: 's3Buckets[1]', message: 'Array element must be a string' },
          { field: 's3Buckets[2]', message: 'Array element must be a string' }
        ]
      });

      const result = await TemplatesController.list(props);

      expect(result.success).toBe(false);
      expect(result.details.errors).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    test('should handle null input', async () => {
      const props = {
        body: {
          input: null
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'input', message: 'Input must be an object' }]
      });

      const result = await TemplatesController.list(props);

      expect(result.success).toBe(false);
    });

    test('should handle undefined input', async () => {
      const props = {
        body: {
          input: undefined
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'input', message: 'Input must be an object' }]
      });

      const result = await TemplatesController.list(props);

      expect(result.success).toBe(false);
    });

    test('should handle extra unknown fields', async () => {
      const props = {
        body: {
          input: {
            templateName: 'valid-template',
            unknownField1: 'value1',
            unknownField2: 'value2'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [
          { field: 'unknownField1', message: 'Unknown parameter' },
          { field: 'unknownField2', message: 'Unknown parameter' }
        ]
      });

      const result = await TemplatesController.get(props);

      expect(result.success).toBe(false);
    });
  });
});
