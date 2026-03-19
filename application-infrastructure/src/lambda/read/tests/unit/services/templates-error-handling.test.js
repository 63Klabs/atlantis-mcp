/**
 * Templates Service Error Handling Tests
 *
 * Tests error handling in the Templates service, specifically:
 * - TEMPLATE_NOT_FOUND error with available templates list
 * - Helpful error messages for users
 */

// Mock cache-data at module level
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      warn: jest.fn()
    },
    ApiRequest: {
      success: jest.fn(({ body }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: 200 })),
      error: jest.fn(({ body, statusCode }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: statusCode || 500 }))
    }
  }
}));

// Mock config at module level
jest.mock('../../../config', () => ({
  Config: {
    getConnCacheProfile: jest.fn(),
    settings: jest.fn()
  }
}));

// Mock models at module level
jest.mock('../../../models', () => ({
  S3Templates: {
    get: jest.fn(),
    list: jest.fn()
  }
}));

// Import after mocking
const { cache: { CacheableDataAccess }, tools: { DebugAndLog } } = require('@63klabs/cache-data');
const Templates = require('../../../services/templates');
const Models = require('../../../models');
const { Config } = require('../../../config');

describe('Templates Service - Error Handling', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Setup default config mocks
    Config.getConnCacheProfile.mockReturnValue({
      conn: { 
        host: ['test-bucket-1', 'test-bucket-2'], 
        path: '/templates',
        parameters: {} 
      },
      cacheProfile: { 
        pathId: 'test-path',
        defaultExpirationInSeconds: 300,
        hostId: 's3-templates',
        profile: 'template-detail'
      }
    });

    Config.settings.mockReturnValue({
      s3: {
        buckets: ['test-bucket-1', 'test-bucket-2']
      },
      templates: {
        categories: [
          { name: 'Storage', description: 'Storage templates' },
          { name: 'Pipeline', description: 'Pipeline templates' }
        ]
      }
    });

    // Setup default CacheableDataAccess.getData mock
    // This mock calls the fetchFunction and returns the result wrapped in { body }
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      return await fetchFunction(conn, opts);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('get() - TEMPLATE_NOT_FOUND error', () => {
    it('should throw TEMPLATE_NOT_FOUND with available templates when template not found', async () => {
      // Mock S3Templates.get to return null (not found)
      Models.S3Templates.get.mockResolvedValue(null);

      // Mock S3Templates.list to return available templates
      Models.S3Templates.list.mockResolvedValue({
        templates: [
          { templateName: 'template-storage-s3-artifacts' },
          { templateName: 'template-storage-s3-oac-for-cloudfront' },
          { templateName: 'template-storage-dynamodb-table' }
        ],
        errors: [],
        partialData: false
      });

      // Attempt to get non-existent template
      await expect(
        Templates.get({
          category: 'Storage',
          templateName: 'template-storage-nonexistent'
        })
      ).rejects.toThrow(/Template not found: Storage\/template-storage-nonexistent/);

      // Verify error details
      try {
        await Templates.get({
          category: 'Storage',
          templateName: 'template-storage-nonexistent'
        });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.code).toBe('TEMPLATE_NOT_FOUND');
        expect(error.message).toContain('Available templates in category \'Storage\'');
        expect(error.message).toContain('template-storage-s3-artifacts');
        expect(error.message).toContain('template-storage-s3-oac-for-cloudfront');
        expect(error.message).toContain('template-storage-dynamodb-table');
        expect(error.availableTemplates).toEqual([
          'template-storage-s3-artifacts',
          'template-storage-s3-oac-for-cloudfront',
          'template-storage-dynamodb-table'
        ]);
      }
    });

    it('should include version in error message when version specified', async () => {
      Models.S3Templates.get.mockResolvedValue(null);
      Models.S3Templates.list.mockResolvedValue({
        templates: [{ templateName: 'template-storage-s3-artifacts' }],
        errors: [],
        partialData: false
      });

      try {
        await Templates.get({
          category: 'Storage',
          templateName: 'template-storage-s3-artifacts',
          version: 'v1.3.5/2024-01-15'
        });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Storage/template-storage-s3-artifacts:v1.3.5/2024-01-15');
        expect(error.code).toBe('TEMPLATE_NOT_FOUND');
      }
    });

    it('should include versionId in error message when versionId specified', async () => {
      Models.S3Templates.get.mockResolvedValue(null);
      Models.S3Templates.list.mockResolvedValue({
        templates: [{ templateName: 'template-storage-s3-artifacts' }],
        errors: [],
        partialData: false
      });

      try {
        await Templates.get({
          category: 'Storage',
          templateName: 'template-storage-s3-artifacts',
          versionId: 'abc123def456'
        });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Storage/template-storage-s3-artifacts?versionId=abc123def456');
        expect(error.code).toBe('TEMPLATE_NOT_FOUND');
      }
    });

    it('should handle list() failure gracefully when building error message', async () => {
      Models.S3Templates.get.mockResolvedValue(null);
      Models.S3Templates.list.mockRejectedValue(new Error('S3 access denied'));

      try {
        await Templates.get({
          category: 'Storage',
          templateName: 'template-storage-nonexistent'
        });
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.code).toBe('TEMPLATE_NOT_FOUND');
        expect(error.message).toContain('Template not found: Storage/template-storage-nonexistent');
        expect(error.message).not.toContain('Available templates');
        expect(error.availableTemplates).toEqual([]);

        // Verify warning was logged
        expect(DebugAndLog.warn).toHaveBeenCalledWith(
          'service.templates.get.fetchFunction: Failed to get available templates',
          expect.objectContaining({
            error: 'S3 access denied'
          })
        );
      }
    });

    it('should not throw error when template is found', async () => {
      const mockTemplate = {
        templateName: 'template-storage-s3-artifacts',
        category: 'Storage',
        version: 'v1.3.5/2024-01-15',
        content: 'AWSTemplateFormatVersion: "2010-09-09"'
      };

      Models.S3Templates.get.mockResolvedValue(mockTemplate);

      const result = await Templates.get({
        category: 'Storage',
        templateName: 'template-storage-s3-artifacts'
      });

      expect(result).toEqual(mockTemplate);
      expect(Models.S3Templates.get).toHaveBeenCalledTimes(1);
    });
  });
});
