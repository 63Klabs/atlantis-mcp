/**
 * Unit tests for Templates Controller
 *
 * Tests all Templates controller functions:
 * - list() - List all available templates with filtering
 * - get() - Retrieve specific template with full metadata
 * - listVersions() - List all versions of a template
 * - listCategories() - List all template categories
 *
 * Tests include:
 * - Input validation (JSON Schema)
 * - Service orchestration
 * - MCP response formatting
 * - Error handling (TEMPLATE_NOT_FOUND, INVALID_INPUT, INTERNAL_ERROR)
 */

// Mock dependencies before requiring controller
jest.mock('../../../services', () => ({
  Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn(),
    listCategories: jest.fn()
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
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
const { tools } = require('@63klabs/cache-data');

describe('Templates Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list()', () => {
    test('should list templates successfully with valid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockTemplates = {
        templates: [
          { name: 'template-storage-s3-artifacts', category: 'storage' },
          { name: 'template-storage-s3-oac-for-cloudfront', category: 'storage' }
        ]
      };

      Services.Templates.list.mockResolvedValue(mockTemplates);

      // Act
      const result = await TemplatesController.list(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_templates', props.bodyParameters.input);
      expect(Services.Templates.list).toHaveBeenCalledWith({
        category: 'storage',
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('list_templates', mockTemplates);
      expect(result.success).toBe(true);
    });

    test('should handle empty input', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Templates.list.mockResolvedValue({ templates: [] });

      // Act
      const result = await TemplatesController.list(props);

      // Assert
      expect(Services.Templates.list).toHaveBeenCalledWith({
        category: undefined,
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(result.success).toBe(true);
    });

    test('should handle missing body', async () => {
      // Arrange
      const props = {};
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Templates.list.mockResolvedValue({ templates: [] });

      // Act
      const result = await TemplatesController.list(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_templates', {});
      expect(result.success).toBe(true);
    });

    test('should return error for invalid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            category: 'InvalidCategory'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'category', message: 'Invalid category' }]
      });

      // Act
      const result = await TemplatesController.list(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed',
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'category' })
          ])
        }),
        'list_templates'
      );
      expect(Services.Templates.list).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle service errors', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('S3 connection failed');
      Services.Templates.list.mockRejectedValue(serviceError);

      // Act
      const result = await TemplatesController.list(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to list templates',
          error: 'S3 connection failed'
        }),
        'list_templates'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should pass all filter parameters to service', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            category: 'storage',
            s3Buckets: ['bucket1', 'bucket2']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Templates.list.mockResolvedValue({ templates: [] });

      // Act
      await TemplatesController.list(props);

      // Assert
      expect(Services.Templates.list).toHaveBeenCalledWith({
        category: 'storage',
        s3Buckets: ['bucket1', 'bucket2'],
        namespace: undefined
      });
    });

    test('should log request and response details', async () => {
      // Arrange
      const props = { bodyParameters: { input: { category: 'storage' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Templates.list.mockResolvedValue({
        templates: [{ name: 'template1' }],
        partialData: false
      });

      // Act
      await TemplatesController.list(props);

      // Assert
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'list_templates request',
        expect.objectContaining({ category: 'storage' })
      );
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'list_templates response',
        expect.objectContaining({ templateCount: 1 })
      );
    });
  });

  describe('get()', () => {
    test('should get template successfully with valid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockTemplate = {
        name: 'template-storage-s3-artifacts',
        version: 'v1.3.5/2024-01-15',
        versionId: 'abc123',
        category: 'storage',
        namespace: 'atlantis',
        bucket: 'test-bucket',
        content: '# CloudFormation template...'
      };

      Services.Templates.get.mockResolvedValue(mockTemplate);

      // Act
      const result = await TemplatesController.get(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('get_template', props.bodyParameters.input);
      expect(Services.Templates.get).toHaveBeenCalledWith({
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        version: undefined,
        versionId: undefined,
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('get_template', mockTemplate);
      expect(result.success).toBe(true);
    });

    test('should return error for invalid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            // Missing required templateName
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'templateName', message: 'Required field missing' }]
      });

      // Act
      const result = await TemplatesController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed'
        }),
        'get_template'
      );
      expect(Services.Templates.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle TEMPLATE_NOT_FOUND error with available templates', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'non-existent-template',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const notFoundError = new Error('Template not found');
      notFoundError.code = 'TEMPLATE_NOT_FOUND';
      notFoundError.availableTemplates = ['template1', 'template2'];

      Services.Templates.get.mockRejectedValue(notFoundError);

      // Act
      const result = await TemplatesController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'TEMPLATE_NOT_FOUND',
        expect.objectContaining({
          message: 'Template not found',
          availableTemplates: ['template1', 'template2']
        }),
        'get_template'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle TEMPLATE_NOT_FOUND error without available templates', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'non-existent-template',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const notFoundError = new Error('Template not found');
      notFoundError.code = 'TEMPLATE_NOT_FOUND';

      Services.Templates.get.mockRejectedValue(notFoundError);

      // Act
      const result = await TemplatesController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'TEMPLATE_NOT_FOUND',
        expect.objectContaining({
          availableTemplates: []
        }),
        'get_template'
      );
    });

    test('should handle generic service errors', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('Network timeout');
      Services.Templates.get.mockRejectedValue(serviceError);

      // Act
      const result = await TemplatesController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to retrieve template',
          error: 'Network timeout'
        }),
        'get_template'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should pass version and versionId parameters', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage',
            version: 'v1.3.5/2024-01-15',
            versionId: 'abc123'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Templates.get.mockResolvedValue({ name: 'template' });

      // Act
      await TemplatesController.get(props);

      // Assert
      expect(Services.Templates.get).toHaveBeenCalledWith({
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        version: 'v1.3.5/2024-01-15',
        versionId: 'abc123',
        s3Buckets: undefined,
        namespace: undefined
      });
    });
  });

  describe('listVersions()', () => {
    test('should list template versions successfully', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockVersions = {
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        versions: [
          { version: 'v1.3.5/2024-01-15', versionId: 'abc123', lastModified: '2024-01-15T10:00:00Z' },
          { version: 'v1.3.4/2024-01-10', versionId: 'def456', lastModified: '2024-01-10T10:00:00Z' }
        ]
      };

      Services.Templates.listVersions.mockResolvedValue(mockVersions);

      // Act
      const result = await TemplatesController.listVersions(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_template_versions', props.bodyParameters.input);
      expect(Services.Templates.listVersions).toHaveBeenCalledWith({
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('list_template_versions', mockVersions);
      expect(result.success).toBe(true);
    });

    test('should return error for invalid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            // Missing required templateName
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'templateName', message: 'Required field missing' }]
      });

      // Act
      const result = await TemplatesController.listVersions(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed'
        }),
        'list_template_versions'
      );
      expect(Services.Templates.listVersions).not.toHaveBeenCalled();
    });

    test('should handle service errors', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('S3 ListObjectVersions failed');
      Services.Templates.listVersions.mockRejectedValue(serviceError);

      // Act
      const result = await TemplatesController.listVersions(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to list template versions',
          error: 'S3 ListObjectVersions failed'
        }),
        'list_template_versions'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('should pass s3Buckets filter parameter', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage',
            s3Buckets: ['bucket1', 'bucket2']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Templates.listVersions.mockResolvedValue({ versions: [] });

      // Act
      await TemplatesController.listVersions(props);

      // Assert
      expect(Services.Templates.listVersions).toHaveBeenCalledWith({
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        s3Buckets: ['bucket1', 'bucket2'],
        namespace: undefined
      });
    });
  });

  describe('listCategories()', () => {
    test('should list categories successfully', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockCategories = [
        { name: 'storage', description: 'S3 and storage templates', count: 5 },
        { name: 'network', description: 'CloudFront and Route53 templates', count: 3 },
        { name: 'pipeline', description: 'CodePipeline templates', count: 2 }
      ];

      Services.Templates.listCategories.mockResolvedValue(mockCategories);

      // Act
      const result = await TemplatesController.listCategories(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_categories', {});
      expect(Services.Templates.listCategories).toHaveBeenCalled();
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('list_categories', {
        categories: mockCategories
      });
      expect(result.success).toBe(true);
    });

    test('should handle missing body', async () => {
      // Arrange
      const props = {};

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Templates.listCategories.mockResolvedValue([]);

      // Act
      const result = await TemplatesController.listCategories(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_categories', {});
      expect(result.success).toBe(true);
    });

    test('should return error for invalid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            invalidParam: 'value'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'invalidParam', message: 'Unknown parameter' }]
      });

      // Act
      const result = await TemplatesController.listCategories(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed'
        }),
        'list_categories'
      );
      expect(Services.Templates.listCategories).not.toHaveBeenCalled();
    });

    test('should handle service errors', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('Configuration error');
      Services.Templates.listCategories.mockRejectedValue(serviceError);

      // Act
      const result = await TemplatesController.listCategories(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to list categories',
          error: 'Configuration error'
        }),
        'list_categories'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('should log request and response', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Templates.listCategories.mockResolvedValue([
        { name: 'storage' },
        { name: 'network' }
      ]);

      // Act
      await TemplatesController.listCategories(props);

      // Assert
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith('list_categories request');
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'list_categories response',
        expect.objectContaining({ categoryCount: 2 })
      );
    });
  });
});
