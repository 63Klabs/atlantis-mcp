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
    checkUpdates: jest.fn(),
    listVersions: jest.fn()
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
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockUpdateResult = [
        {
          templateName: 'template-storage-s3-artifacts',
          category: 'storage',
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
          category: 'storage',
          templateName: 'template-storage-s3-artifacts',
          currentVersion: 'v1.3.4/2024-01-10'
        }],
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('check_template_updates', {
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
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
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockUpdateResult = [
        {
          templateName: 'template-storage-s3-artifacts',
          category: 'storage',
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
            category: 'pipeline'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockUpdateResult = [
        {
          templateName: 'template-pipeline',
          category: 'pipeline',
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
            category: 'storage',
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
          category: 'storage',
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
            category: 'storage'
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
            category: 'storage'
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
            category: 'storage'
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
            category: 'storage',
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
          category: 'storage',
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
      // Arrange — 'invalid-version' is classified as S3_VersionId by the version resolver
      // and fails resolution when no matching versionId exists in history
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'invalid-version',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Templates.listVersions.mockResolvedValue({
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        versions: []
      });

      // Act
      const result = await UpdatesController.check(props);

      // Assert — VERSION_RESOLUTION_FAILED because 'invalid-version' is treated as S3_VersionId
      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'VERSION_RESOLUTION_FAILED',
        expect.objectContaining({
          message: expect.any(String),
          versionId: 'invalid-version'
        }),
        'check_template_updates'
      );
    });
  });

  describe('version resolution flow', () => {
    test('should pass Human_Readable_Version through to service unchanged', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4/2024-01-10',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Templates.checkUpdates.mockResolvedValue([
        {
          templateName: 'template-storage-s3-artifacts',
          category: 'storage',
          currentVersion: 'v1.3.4/2024-01-10',
          latestVersion: 'v1.3.5/2024-01-15',
          updateAvailable: true,
          releaseDate: '2024-01-15',
          changelog: 'Bug fixes',
          breakingChanges: false,
          migrationGuide: null,
          s3Path: 's3://bucket/templates/v2/storage/template-storage-s3-artifacts.yml',
          namespace: 'atlantis',
          bucket: 'test-bucket'
        }
      ]);

      // Act
      const result = await UpdatesController.check(props);

      // Assert — Human_Readable_Version passed directly, no listVersions call
      expect(Services.Templates.listVersions).not.toHaveBeenCalled();
      expect(Services.Templates.checkUpdates).toHaveBeenCalledWith(
        expect.objectContaining({
          templates: [expect.objectContaining({
            currentVersion: 'v1.3.4/2024-01-10'
          })]
        })
      );
      expect(result.success).toBe(true);
      expect(result.data.currentVersion).toBe('v1.3.4/2024-01-10');
    });

    test('should resolve Short_Version before passing to service', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Templates.listVersions.mockResolvedValue({
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        versions: [
          { version: 'v1.3.5/2024-01-15', versionId: 'id-2', lastModified: '2024-01-15', size: 4096, isLatest: true },
          { version: 'v1.3.4/2024-01-10', versionId: 'id-1', lastModified: '2024-01-10', size: 4096, isLatest: false }
        ]
      });

      Services.Templates.checkUpdates.mockResolvedValue([
        {
          templateName: 'template-storage-s3-artifacts',
          category: 'storage',
          currentVersion: 'v1.3.4/2024-01-10',
          latestVersion: 'v1.3.5/2024-01-15',
          updateAvailable: true,
          releaseDate: '2024-01-15',
          changelog: 'Bug fixes',
          breakingChanges: false,
          migrationGuide: null,
          s3Path: 's3://bucket/templates/v2/storage/template-storage-s3-artifacts.yml',
          namespace: 'atlantis',
          bucket: 'test-bucket'
        }
      ]);

      // Act
      const result = await UpdatesController.check(props);

      // Assert — Short_Version resolved via listVersions
      expect(Services.Templates.listVersions).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'storage',
          templateName: 'template-storage-s3-artifacts'
        })
      );
      expect(Services.Templates.checkUpdates).toHaveBeenCalledWith(
        expect.objectContaining({
          templates: [expect.objectContaining({
            currentVersion: 'v1.3.4/2024-01-10'
          })]
        })
      );
      expect(result.success).toBe(true);
    });

    test('should resolve S3_VersionId before passing to service', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'abc123def456',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Templates.listVersions.mockResolvedValue({
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        versions: [
          { version: 'v1.3.4/2024-01-10', versionId: 'abc123def456', lastModified: '2024-01-10', size: 4096, isLatest: false }
        ]
      });

      Services.Templates.checkUpdates.mockResolvedValue([
        {
          templateName: 'template-storage-s3-artifacts',
          category: 'storage',
          currentVersion: 'v1.3.4/2024-01-10',
          latestVersion: 'v1.3.5/2024-01-15',
          updateAvailable: true,
          releaseDate: '2024-01-15',
          changelog: 'Bug fixes',
          breakingChanges: false,
          migrationGuide: null,
          s3Path: 's3://bucket/templates/v2/storage/template-storage-s3-artifacts.yml',
          namespace: 'atlantis',
          bucket: 'test-bucket'
        }
      ]);

      // Act
      const result = await UpdatesController.check(props);

      // Assert — S3_VersionId resolved via listVersions
      expect(Services.Templates.listVersions).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'storage',
          templateName: 'template-storage-s3-artifacts'
        })
      );
      expect(Services.Templates.checkUpdates).toHaveBeenCalledWith(
        expect.objectContaining({
          templates: [expect.objectContaining({
            currentVersion: 'v1.3.4/2024-01-10'
          })]
        })
      );
      expect(result.success).toBe(true);
    });

    test('should return VERSION_RESOLUTION_FAILED for unresolvable S3_VersionId', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'nonexistent-id',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Templates.listVersions.mockResolvedValue({
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        versions: [
          { version: 'v1.3.4/2024-01-10', versionId: 'other-id', lastModified: '2024-01-10', size: 4096, isLatest: false }
        ]
      });

      // Act
      const result = await UpdatesController.check(props);

      // Assert — VERSION_RESOLUTION_FAILED error returned
      expect(Services.Templates.checkUpdates).not.toHaveBeenCalled();
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'VERSION_RESOLUTION_FAILED',
        expect.objectContaining({
          message: expect.any(String),
          versionId: 'nonexistent-id',
          templateName: 'template-storage-s3-artifacts',
          category: 'storage'
        }),
        'check_template_updates'
      );
      expect(result.success).toBe(false);
    });

    test('should include resolved currentVersion in success response', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4',
            category: 'storage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Templates.listVersions.mockResolvedValue({
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        versions: [
          { version: 'v1.3.4/2024-01-10', versionId: 'id-1', lastModified: '2024-01-10', size: 4096, isLatest: false }
        ]
      });

      Services.Templates.checkUpdates.mockResolvedValue([
        {
          templateName: 'template-storage-s3-artifacts',
          category: 'storage',
          currentVersion: 'v1.3.4/2024-01-10',
          latestVersion: 'v1.3.5/2024-01-15',
          updateAvailable: true,
          releaseDate: '2024-01-15',
          changelog: 'Bug fixes',
          breakingChanges: false,
          migrationGuide: null,
          s3Path: 's3://bucket/templates/v2/storage/template-storage-s3-artifacts.yml',
          namespace: 'atlantis',
          bucket: 'test-bucket'
        }
      ]);

      // Act
      const result = await UpdatesController.check(props);

      // Assert — response contains the resolved version, not the original Short_Version
      expect(result.success).toBe(true);
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith(
        'check_template_updates',
        expect.objectContaining({
          currentVersion: 'v1.3.4/2024-01-10'
        })
      );
    });
  });
});
