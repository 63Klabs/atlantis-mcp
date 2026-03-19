/**
 * Unit tests for Updates Controller
 *
 * Tests Updates controller check() function:
 * - Check if newer versions of templates are available
 *
 * Tests include:
 * - Input validation (JSON Schema)
 * - Service orchestration
 * - MCP response formatting
 * - Error handling (INVALID_INPUT, UPDATE_CHECK_FAILED, INTERNAL_ERROR)
 * - Update information with breaking changes
 */

// Mock dependencies before requiring controller
jest.mock('../../../services', () => ({
  Templates: {
    checkUpdates: jest.fn()
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

const UpdatesController = require('../../../controllers/updates');
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
const { tools } = require('@63klabs/cache-data');

describe('Updates Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('check()', () => {
    test('should check for updates successfully when update available', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4/2024-01-10',
            category: 'Storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockUpdateResult = [
        {
          templateName: 'template-storage-s3-artifacts',
          category: 'Storage',
          currentVersion: 'v1.3.4/2024-01-10',
          latestVersion: 'v1.3.5/2024-01-15',
          updateAvailable: true,
          releaseDate: '2024-01-15',
          changelog: 'Bug fixes and performance improvements',
          breakingChanges: false,
          migrationGuide: null,
          s3Path: 's3://bucket/templates/v2/storage/template-storage-s3-artifacts.yml',
          namespace: 'atlantis',
          bucket: 'test-bucket'
        }
      ];

      Services.Templates.checkUpdates.mockResolvedValue(mockUpdateResult);

      // Act
      const result = await UpdatesController.check(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('check_template_updates', props.bodyParameters.input);
      expect(Services.Templates.checkUpdates).toHaveBeenCalledWith({
        templates: [{
          category: 'Storage',
          templateName: 'template-storage-s3-artifacts',
          currentVersion: 'v1.3.4/2024-01-10'
        }],
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('check_template_updates', {
        templateName: 'template-storage-s3-artifacts',
        category: 'Storage',
        currentVersion: 'v1.3.4/2024-01-10',
        latestVersion: 'v1.3.5/2024-01-15',
        updateAvailable: true,
        releaseDate: '2024-01-15',
        changelog: 'Bug fixes and performance improvements',
        breakingChanges: false,
        migrationGuide: null,
        s3Path: 's3://bucket/templates/v2/storage/template-storage-s3-artifacts.yml',
        namespace: 'atlantis',
        bucket: 'test-bucket'
      });
      expect(result.success).toBe(true);
    });

    test('should check for updates when no update available', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.5/2024-01-15',
            category: 'Storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockUpdateResult = [
        {
          templateName: 'template-storage-s3-artifacts',
          category: 'Storage',
          currentVersion: 'v1.3.5/2024-01-15',
          latestVersion: 'v1.3.5/2024-01-15',
          updateAvailable: false,
          releaseDate: '2024-01-15',
          changelog: null,
          breakingChanges: false,
          migrationGuide: null,
          s3Path: 's3://bucket/templates/v2/storage/template-storage-s3-artifacts.yml',
          namespace: 'atlantis',
          bucket: 'test-bucket'
        }
      ];

      Services.Templates.checkUpdates.mockResolvedValue(mockUpdateResult);

      // Act
      const result = await UpdatesController.check(props);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.updateAvailable).toBe(false);
      expect(result.data.changelog).toBeNull();
    });

    test('should handle update with breaking changes', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-pipeline',
            currentVersion: 'v2.0.18/2024-01-01',
            category: 'Pipeline'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockUpdateResult = [
        {
          templateName: 'template-pipeline',
          category: 'Pipeline',
          currentVersion: 'v2.0.18/2024-01-01',
          latestVersion: 'v3.0.0/2024-01-20',
          updateAvailable: true,
          releaseDate: '2024-01-20',
          changelog: 'Major version upgrade with breaking changes',
          breakingChanges: true,
          migrationGuide: 'https://docs.example.com/migration-v2-to-v3',
          s3Path: 's3://bucket/templates/v2/pipeline/template-pipeline.yml',
          namespace: 'atlantis',
          bucket: 'test-bucket'
        }
      ];

      Services.Templates.checkUpdates.mockResolvedValue(mockUpdateResult);

      // Act
      const result = await UpdatesController.check(props);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.breakingChanges).toBe(true);
      expect(result.data.migrationGuide).toBe('https://docs.example.com/migration-v2-to-v3');
    });

    test('should handle missing optional category parameter', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4/2024-01-10'
            // category is optional
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Templates.checkUpdates.mockResolvedValue([
        {
          templateName: 'template-storage-s3-artifacts',
          category: undefined,
          currentVersion: 'v1.3.4/2024-01-10',
          latestVersion: 'v1.3.5/2024-01-15',
          updateAvailable: true
        }
      ]);

      // Act
      const result = await UpdatesController.check(props);

      // Assert
      expect(Services.Templates.checkUpdates).toHaveBeenCalledWith({
        templates: [{
          category: undefined,
          templateName: 'template-storage-s3-artifacts',
          currentVersion: 'v1.3.4/2024-01-10'
        }],
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(result.success).toBe(true);
    });

    test('should pass s3Buckets filter parameter', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4/2024-01-10',
            category: 'Storage',
            s3Buckets: ['bucket1', 'bucket2']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Templates.checkUpdates.mockResolvedValue([
        {
          templateName: 'template-storage-s3-artifacts',
          updateAvailable: false
        }
      ]);

      // Act
      await UpdatesController.check(props);

      // Assert
      expect(Services.Templates.checkUpdates).toHaveBeenCalledWith({
        templates: [{
          category: 'Storage',
          templateName: 'template-storage-s3-artifacts',
          currentVersion: 'v1.3.4/2024-01-10'
        }],
        s3Buckets: ['bucket1', 'bucket2'],
        namespace: undefined
      });
    });

    test('should handle missing body', async () => {
      // Arrange
      const props = {};

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'templateName', message: 'Required field missing' }]
      });

      // Act
      const result = await UpdatesController.check(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('check_template_updates', {});
      expect(result.success).toBe(false);
    });

    test('should return error for invalid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            // Missing required templateName and currentVersion
            category: 'Storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [
          { field: 'templateName', message: 'Required field missing' },
          { field: 'currentVersion', message: 'Required field missing' }
        ]
      });

      // Act
      const result = await UpdatesController.check(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed',
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'templateName' }),
            expect.objectContaining({ field: 'currentVersion' })
          ])
        }),
        'check_template_updates'
      );
      expect(Services.Templates.checkUpdates).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle service error from update check', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4/2024-01-10',
            category: 'Storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockUpdateResult = [
        {
          templateName: 'template-storage-s3-artifacts',
          error: 'Template not found in any configured bucket'
        }
      ];

      Services.Templates.checkUpdates.mockResolvedValue(mockUpdateResult);

      // Act
      const result = await UpdatesController.check(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'UPDATE_CHECK_FAILED',
        expect.objectContaining({
          message: 'Template not found in any configured bucket',
          templateName: 'template-storage-s3-artifacts',
          currentVersion: 'v1.3.4/2024-01-10'
        }),
        'check_template_updates'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle generic service errors', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4/2024-01-10',
            category: 'Storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('S3 connection timeout');
      Services.Templates.checkUpdates.mockRejectedValue(serviceError);

      // Act
      const result = await UpdatesController.check(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to check template updates',
          error: 'S3 connection timeout'
        }),
        'check_template_updates'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should log request and response details', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4/2024-01-10',
            category: 'Storage',
            s3Buckets: ['bucket1']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Templates.checkUpdates.mockResolvedValue([
        {
          templateName: 'template-storage-s3-artifacts',
          currentVersion: 'v1.3.4/2024-01-10',
          latestVersion: 'v1.3.5/2024-01-15',
          updateAvailable: true,
          breakingChanges: false
        }
      ]);

      // Act
      await UpdatesController.check(props);

      // Assert
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'check_template_updates request',
        expect.objectContaining({
          templateName: 'template-storage-s3-artifacts',
          currentVersion: 'v1.3.4/2024-01-10',
          category: 'Storage',
          s3BucketsCount: 1
        })
      );
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'check_template_updates response',
        expect.objectContaining({
          templateName: 'template-storage-s3-artifacts',
          currentVersion: 'v1.3.4/2024-01-10',
          latestVersion: 'v1.3.5/2024-01-15',
          updateAvailable: true,
          breakingChanges: false
        })
      );
    });

    test('should handle invalid version format', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'invalid-version',
            category: 'Storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockUpdateResult = [
        {
          templateName: 'template-storage-s3-artifacts',
          error: 'Invalid version format. Expected: vX.X.X/YYYY-MM-DD'
        }
      ];

      Services.Templates.checkUpdates.mockResolvedValue(mockUpdateResult);

      // Act
      const result = await UpdatesController.check(props);

      // Assert
      expect(result.success).toBe(false);
      expect(result.details.message).toContain('Invalid version format');
    });
  });
});
