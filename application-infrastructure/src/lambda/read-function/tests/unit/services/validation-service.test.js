/**
 * Unit Tests for Validation Service
 *
 * Tests the Validation service layer including:
 * - validateNaming() for various resource types
 * - Auto-detection of resource types
 * - Validation against configuration
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

// Mock dependencies before importing service
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    AWS: {
      REGION: 'us-east-1'
    }
  }
}));

jest.mock('../../../config', () => ({
  Config: {
    settings: jest.fn()
  }
}));

jest.mock('../../../utils/naming-rules', () => ({
  detectResourceType: jest.fn(),
  validateNaming: jest.fn()
}));

const { Config } = require('../../../config');
const NamingRules = require('../../../utils/naming-rules');
const Validation = require('../../../services/validation');

describe('Validation Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    Config.settings.mockReturnValue({
      naming: {
        parameters: {
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod'
        }
      },
      aws: {
        region: 'us-east-1'
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('validateNaming()', () => {
    it('should validate application resource name', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
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
      });

      // Act
      const result = await Validation.validateNaming({
        resourceName: 'acme-myapp-prod-GetUserFunction'
      });

      // Assert
      expect(NamingRules.detectResourceType).toHaveBeenCalledWith('acme-myapp-prod-GetUserFunction');
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'acme-myapp-prod-GetUserFunction',
        expect.objectContaining({
          resourceType: 'application',
          config: expect.objectContaining({
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod'
          }),
          partial: false
        })
      );
      expect(result.valid).toBe(true);
      expect(result.resourceType).toBe('application');
    });

    it('should validate S3 bucket name', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('s3');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 's3',
        components: {
          orgPrefix: '63k',
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod',
          region: 'us-east-1',
          accountId: '123456789012'
        },
        errors: [],
        suggestions: [],
        pattern: 'pattern1'
      });

      // Act
      const result = await Validation.validateNaming({
        resourceName: '63k-acme-myapp-prod-us-east-1-123456789012',
        resourceType: 's3'
      });

      // Assert
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        '63k-acme-myapp-prod-us-east-1-123456789012',
        expect.objectContaining({
          resourceType: 's3',
          config: expect.not.objectContaining({
            region: expect.anything()
          })
        })
      );
      expect(result.valid).toBe(true);
      expect(result.pattern).toBe('pattern1');
    });

    it('should auto-detect resource type when not provided', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('lambda');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'lambda',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: 'acme-myapp-prod-MyFunction'
      });

      // Assert
      expect(NamingRules.detectResourceType).toHaveBeenCalledWith('acme-myapp-prod-MyFunction');
    });

    it('should default to application type if detection fails', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue(null);
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'application',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: 'some-resource-name'
      });

      // Assert
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'some-resource-name',
        expect.objectContaining({
          resourceType: 'application'
        })
      );
    });

    it('should support partial name validation', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'application',
        components: {
          prefix: 'acme',
          projectId: 'myapp'
        },
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: 'acme-myapp',
        partial: true
      });

      // Assert
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'acme-myapp',
        expect.objectContaining({
          partial: true
        })
      );
    });

    it('should return validation errors', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: false,
        resourceType: 'application',
        components: {},
        errors: [
          'Prefix does not match configuration (expected: acme, got: wrong)',
          'Missing StageId component'
        ],
        suggestions: [
          'Use format: acme-myapp-prod-ResourceName',
          'Ensure all components are present'
        ]
      });

      // Act
      const result = await Validation.validateNaming({
        resourceName: 'wrong-myapp-GetUserFunction'
      });

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.suggestions).toHaveLength(2);
    });

    it('should return error for invalid input', async () => {
      // Act
      const result1 = await Validation.validateNaming({});
      const result2 = await Validation.validateNaming({ resourceName: null });
      const result3 = await Validation.validateNaming({ resourceName: 123 });

      // Assert
      expect(result1.valid).toBe(false);
      expect(result1.errors[0]).toContain('required');

      expect(result2.valid).toBe(false);
      expect(result2.errors[0]).toContain('required');

      expect(result3.valid).toBe(false);
      expect(result3.errors[0]).toContain('must be a string');
    });

    it('should pass configuration to naming rules', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'application',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: 'acme-myapp-prod-Resource'
      });

      // Assert
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'acme-myapp-prod-Resource',
        expect.objectContaining({
          config: {
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod',
            isShared: false,
            hasOrgPrefix: undefined
          }
        })
      );
    });

    it('should NOT include server region in config for S3 validation', async () => {
      // Arrange - S3 buckets can target any AWS region, not just the server's region
      NamingRules.detectResourceType.mockReturnValue('s3');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 's3',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: '63k-acme-myapp-prod-us-east-1-123456789012',
        resourceType: 's3'
      });

      // Assert - region should NOT be in config (format validation is handled by naming-rules)
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        '63k-acme-myapp-prod-us-east-1-123456789012',
        expect.objectContaining({
          config: expect.not.objectContaining({
            region: expect.anything()
          })
        })
      );
    });

    it('should validate DynamoDB table name', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('dynamodb');
      NamingRules.validateNaming.mockReturnValue({
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
      });

      // Act
      const result = await Validation.validateNaming({
        resourceName: 'acme-myapp-prod-UsersTable',
        resourceType: 'dynamodb'
      });

      // Assert
      expect(result.valid).toBe(true);
      expect(result.resourceType).toBe('dynamodb');
    });

    it('should validate Lambda function name', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('lambda');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'lambda',
        components: {
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod',
          resourceName: 'ProcessorFunction'
        },
        errors: [],
        suggestions: []
      });

      // Act
      const result = await Validation.validateNaming({
        resourceName: 'acme-myapp-prod-ProcessorFunction',
        resourceType: 'lambda'
      });

      // Assert
      expect(result.valid).toBe(true);
      expect(result.resourceType).toBe('lambda');
    });

    it('should validate CloudFormation stack name', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('cloudformation');
      NamingRules.validateNaming.mockReturnValue({
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
      });

      // Act
      const result = await Validation.validateNaming({
        resourceName: 'acme-myapp-prod-StorageStack',
        resourceType: 'cloudformation'
      });

      // Assert
      expect(result.valid).toBe(true);
      expect(result.resourceType).toBe('cloudformation');
    });

    it('should provide suggestions for invalid names', async () => {
      // Arrange
      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: false,
        resourceType: 'application',
        components: {},
        errors: ['Invalid format'],
        suggestions: [
          'Use format: acme-myapp-prod-ResourceName',
          'Ensure Prefix matches: acme',
          'Ensure ProjectId matches: myapp',
          'Ensure StageId is one of: test, beta, stage, prod'
        ]
      });

      // Act
      const result = await Validation.validateNaming({
        resourceName: 'invalid-name'
      });

      // Assert
      expect(result.valid).toBe(false);
      expect(result.suggestions).toHaveLength(4);
      expect(result.suggestions[0]).toContain('acme-myapp-prod');
    });

    it('should prefer caller-provided prefix over environment config', async () => {
      // Arrange
      Config.settings.mockReturnValue({
        naming: {
          parameters: {
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod'
          }
        }
      });

      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'application',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: 'my-org-myapp-prod-GetFunction',
        prefix: 'my-org'
      });

      // Assert
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'my-org-myapp-prod-GetFunction',
        expect.objectContaining({
          config: expect.objectContaining({
            prefix: 'my-org',
            projectId: 'myapp',
            stageId: 'prod'
          })
        })
      );
    });

    it('should prefer caller-provided projectId over environment config', async () => {
      // Arrange
      Config.settings.mockReturnValue({
        naming: {
          parameters: {
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod'
          }
        }
      });

      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'application',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: 'acme-person-api-prod-GetFunction',
        projectId: 'person-api'
      });

      // Assert
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'acme-person-api-prod-GetFunction',
        expect.objectContaining({
          config: expect.objectContaining({
            prefix: 'acme',
            projectId: 'person-api',
            stageId: 'prod'
          })
        })
      );
    });

    it('should prefer caller-provided stageId over environment config', async () => {
      // Arrange
      Config.settings.mockReturnValue({
        naming: {
          parameters: {
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod'
          }
        }
      });

      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'application',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: 'acme-myapp-beta-GetFunction',
        stageId: 'beta'
      });

      // Assert
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'acme-myapp-beta-GetFunction',
        expect.objectContaining({
          config: expect.objectContaining({
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'beta'
          })
        })
      );
    });

    it('should pass all disambiguation parameters to naming rules', async () => {
      // Arrange
      Config.settings.mockReturnValue({
        naming: {
          parameters: {
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod'
          }
        }
      });

      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'application',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: 'my-org-person-api-test-GetFunction',
        prefix: 'my-org',
        projectId: 'person-api',
        stageId: 'test',
        orgPrefix: '63k'
      });

      // Assert
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'my-org-person-api-test-GetFunction',
        expect.objectContaining({
          config: {
            prefix: 'my-org',
            projectId: 'person-api',
            stageId: 'test',
            orgPrefix: '63k',
            isShared: false,
            hasOrgPrefix: undefined
          }
        })
      );
    });

    it('should pass orgPrefix to naming rules for S3 validation', async () => {
      // Arrange
      Config.settings.mockReturnValue({
        naming: {
          parameters: {
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod'
          }
        }
      });

      NamingRules.detectResourceType.mockReturnValue('s3');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 's3',
        components: {},
        errors: [],
        suggestions: [],
        pattern: 'pattern1'
      });

      // Act
      await Validation.validateNaming({
        resourceName: '63k-acme-myapp-prod-123456789012-us-east-1-an',
        resourceType: 's3',
        orgPrefix: '63k',
        hasOrgPrefix: true
      });

      // Assert - region should NOT be in config (S3 buckets can target any region)
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        '63k-acme-myapp-prod-123456789012-us-east-1-an',
        expect.objectContaining({
          config: expect.objectContaining({
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod',
            orgPrefix: '63k',
            hasOrgPrefix: true
          })
        })
      );
      // Verify region is NOT passed in config
      const actualCall = NamingRules.validateNaming.mock.calls[0][1];
      expect(actualCall.config).not.toHaveProperty('region');
    });

    it('should fall back to environment config when caller values not provided', async () => {
      // Arrange
      Config.settings.mockReturnValue({
        naming: {
          parameters: {
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod'
          }
        }
      });

      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: true,
        resourceType: 'application',
        components: {},
        errors: [],
        suggestions: []
      });

      // Act
      await Validation.validateNaming({
        resourceName: 'acme-myapp-prod-GetFunction'
      });

      // Assert
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'acme-myapp-prod-GetFunction',
        expect.objectContaining({
          config: expect.objectContaining({
            prefix: 'acme',
            projectId: 'myapp',
            stageId: 'prod',
            orgPrefix: undefined
          })
        })
      );
    });

    it('should handle missing configuration gracefully', async () => {
      // Arrange
      Config.settings.mockReturnValue({
        naming: {
          parameters: {
            // Missing prefix, projectId, stageId
          }
        },
        aws: {
          region: 'us-east-1'
        }
      });

      NamingRules.detectResourceType.mockReturnValue('application');
      NamingRules.validateNaming.mockReturnValue({
        valid: false,
        resourceType: 'application',
        components: {},
        errors: ['Configuration not set'],
        suggestions: ['Configure Prefix, ProjectId, and StageId']
      });

      // Act
      const result = await Validation.validateNaming({
        resourceName: 'some-resource'
      });

      // Assert
      expect(result.valid).toBe(false);
      expect(NamingRules.validateNaming).toHaveBeenCalledWith(
        'some-resource',
        expect.objectContaining({
          config: expect.objectContaining({
            prefix: undefined,
            projectId: undefined,
            stageId: undefined
          })
        })
      );
    });
  });
});
