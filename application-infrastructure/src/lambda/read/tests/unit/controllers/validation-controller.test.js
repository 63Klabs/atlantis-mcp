/**
 * Unit tests for Validation Controller
 *
 * Tests Validation controller validate() function:
 * - Validate resource names against Atlantis naming conventions
 *
 * Tests include:
 * - Input validation (JSON Schema)
 * - Service orchestration
 * - MCP response formatting
 * - Error handling (INVALID_INPUT, VALIDATION_ERROR)
 * - Validation results with suggestions
 */

// Mock dependencies before requiring controller
jest.mock('../../../services', () => ({
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

const ValidationController = require('../../../controllers/validation');
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
const { tools } = require('@63klabs/cache-data');

describe('Validation Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validate()', () => {
    test('should validate valid application resource name', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'acme-myapp-prod-GetUserFunction',
            resourceType: 'application'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockValidationResult = {
        valid: true,
        resourceType: 'application',
        components: {
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod',
          resourceName: 'GetUserFunction'
        },
        errors: [],
        suggestions: []
      };

      Services.Validation.validateNaming.mockResolvedValue(mockValidationResult);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('validate_naming', props.bodyParameters.input);
      expect(Services.Validation.validateNaming).toHaveBeenCalledWith({
        resourceName: 'acme-myapp-prod-GetUserFunction',
        resourceType: 'application'
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('validate_naming', {
        resourceName: 'acme-myapp-prod-GetUserFunction',
        valid: true,
        resourceType: 'application',
        components: mockValidationResult.components,
        errors: [],
        suggestions: [],
        pattern: undefined
      });
      expect(result.success).toBe(true);
    });

    test('should validate valid S3 bucket name with pattern1', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'myorg-acme-myapp-prod-us-east-1-123456789012',
            resourceType: 's3'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockValidationResult = {
        valid: true,
        resourceType: 's3',
        components: {
          orgPrefix: 'myorg',
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod',
          region: 'us-east-1',
          accountId: '123456789012'
        },
        errors: [],
        suggestions: [],
        pattern: 'pattern1'
      };

      Services.Validation.validateNaming.mockResolvedValue(mockValidationResult);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.pattern).toBe('pattern1');
      expect(result.data.components.orgPrefix).toBe('myorg');
      expect(result.data.components.accountId).toBe('123456789012');
    });

    test('should validate valid S3 bucket name with pattern2', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'myorg-acme-myapp-us-east-1',
            resourceType: 's3'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockValidationResult = {
        valid: true,
        resourceType: 's3',
        components: {
          orgPrefix: 'myorg',
          prefix: 'acme',
          projectId: 'myapp',
          region: 'us-east-1'
        },
        errors: [],
        suggestions: [],
        pattern: 'pattern2'
      };

      Services.Validation.validateNaming.mockResolvedValue(mockValidationResult);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.pattern).toBe('pattern2');
      expect(result.data.components).not.toHaveProperty('stageId');
      expect(result.data.components).not.toHaveProperty('accountId');
    });

    test('should handle invalid resource name with errors and suggestions', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'invalid-name',
            resourceType: 'application'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockValidationResult = {
        valid: false,
        resourceType: 'application',
        components: {},
        errors: [
          'Missing required component: ProjectId',
          'Missing required component: StageId',
          'Missing required component: ResourceName'
        ],
        suggestions: [
          'Expected format: <Prefix>-<ProjectId>-<StageId>-<ResourceName>',
          'Example: acme-myapp-prod-GetUserFunction'
        ]
      };

      Services.Validation.validateNaming.mockResolvedValue(mockValidationResult);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(result.success).toBe(true); // Controller returns success, validation result indicates invalid
      expect(result.data.valid).toBe(false);
      expect(result.data.errors).toHaveLength(3);
      expect(result.data.suggestions).toHaveLength(2);
    });

    test('should handle auto-detection of resource type', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'acme-myapp-prod-MyTable'
            // resourceType not provided - should auto-detect
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockValidationResult = {
        valid: true,
        resourceType: 'application',
        components: {
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod',
          resourceName: 'MyTable'
        },
        errors: [],
        suggestions: []
      };

      Services.Validation.validateNaming.mockResolvedValue(mockValidationResult);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(Services.Validation.validateNaming).toHaveBeenCalledWith({
        resourceName: 'acme-myapp-prod-MyTable',
        resourceType: undefined
      });
      expect(result.data.resourceType).toBe('application');
    });

    test('should handle missing body', async () => {
      // Arrange
      const props = {};

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'resourceName', message: 'Required field missing' }]
      });

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('validate_naming', {});
      expect(result.success).toBe(false);
    });

    test('should return error for invalid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            // Missing required resourceName
            resourceType: 'application'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'resourceName', message: 'Required field missing' }]
      });

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Invalid input parameters',
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'resourceName' })
          ])
        }),
        'validate_naming'
      );
      expect(Services.Validation.validateNaming).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle service errors', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'test-name'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('Validation service failed');
      Services.Validation.validateNaming.mockRejectedValue(serviceError);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.objectContaining({
          message: 'Error occurred during validation',
          error: 'Validation service failed'
        }),
        'validate_naming'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should validate DynamoDB table name', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'acme-myapp-prod-UsersTable',
            resourceType: 'dynamodb'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockValidationResult = {
        valid: true,
        resourceType: 'dynamodb',
        components: {
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod',
          resourceName: 'UsersTable'
        },
        errors: [],
        suggestions: []
      };

      Services.Validation.validateNaming.mockResolvedValue(mockValidationResult);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.resourceType).toBe('dynamodb');
    });

    test('should validate Lambda function name', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'acme-myapp-prod-ProcessOrderFunction',
            resourceType: 'lambda'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockValidationResult = {
        valid: true,
        resourceType: 'lambda',
        components: {
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod',
          resourceName: 'ProcessOrderFunction'
        },
        errors: [],
        suggestions: []
      };

      Services.Validation.validateNaming.mockResolvedValue(mockValidationResult);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.resourceType).toBe('lambda');
    });

    test('should validate CloudFormation stack name', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'acme-myapp-prod-StorageStack',
            resourceType: 'cloudformation'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockValidationResult = {
        valid: true,
        resourceType: 'cloudformation',
        components: {
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod',
          resourceName: 'StorageStack'
        },
        errors: [],
        suggestions: []
      };

      Services.Validation.validateNaming.mockResolvedValue(mockValidationResult);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.resourceType).toBe('cloudformation');
    });

    test('should log validation request and result', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'acme-myapp-prod-TestResource',
            resourceType: 'application'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Validation.validateNaming.mockResolvedValue({
        valid: true,
        resourceType: 'application',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await ValidationController.validate(props);

      // Assert
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith('Validation controller: validate() called');
      expect(tools.DebugAndLog.debug).toHaveBeenCalledWith(
        'Validation controller: Validating resource name',
        expect.objectContaining({
          resourceName: 'acme-myapp-prod-TestResource',
          resourceType: 'application'
        })
      );
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'Validation controller: Validation completed',
        expect.objectContaining({
          resourceName: 'acme-myapp-prod-TestResource',
          valid: true,
          resourceType: 'application',
          errorCount: 0,
          suggestionCount: 0
        })
      );
    });

    test('should handle partial name validation', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            resourceName: 'acme-myapp',
            resourceType: 'application'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockValidationResult = {
        valid: false,
        resourceType: 'application',
        components: {
          prefix: 'acme',
          projectId: 'myapp'
        },
        errors: [
          'Missing required component: StageId',
          'Missing required component: ResourceName'
        ],
        suggestions: [
          'Add StageId (test, prod, etc.)',
          'Add ResourceName (e.g., MyFunction, MyTable)'
        ]
      };

      Services.Validation.validateNaming.mockResolvedValue(mockValidationResult);

      // Act
      const result = await ValidationController.validate(props);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.valid).toBe(false);
      expect(result.data.components.prefix).toBe('acme');
      expect(result.data.components.projectId).toBe('myapp');
      expect(result.data.errors).toHaveLength(2);
    });
  });
});
