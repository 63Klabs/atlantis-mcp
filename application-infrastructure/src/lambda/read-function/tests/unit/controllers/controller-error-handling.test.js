/**
 * Unit tests for error handling across all controllers
 *
 * Tests that all controllers properly handle errors:
 * - Service layer errors
 * - Network errors
 * - Timeout errors
 * - Not found errors
 * - Internal errors
 * - Error logging
 * - Error response formatting
 *
 * Ensures consistent error handling patterns across all controllers.
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
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    ApiRequest: {
      success: jest.fn((opts) => ({ statusCode: 200, ...opts })),
      error: jest.fn((opts) => ({ statusCode: 500, ...opts }))
    }
  }
}));

jest.mock('../../../config', () => ({
  Config: {
    getConnCacheProfile: jest.fn().mockReturnValue({
      conn: { host: 'internal', path: '/chunks', parameters: {} },
      cacheProfile: { profile: 'chunk-data', hostId: 'template-chunks', pathId: 'data' }
    }),
    settings: jest.fn().mockReturnValue({ s3Buckets: ['63klabs'] })
  }
}));

const TemplatesController = require('../../../controllers/templates');
const StartersController = require('../../../controllers/starters');
const DocumentationController = require('../../../controllers/documentation');
const ValidationController = require('../../../controllers/validation');
const UpdatesController = require('../../../controllers/updates');
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
const { tools } = require('@63klabs/cache-data');

describe('Controller Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SchemaValidator.validate.mockReturnValue({ valid: true });
  });

  describe('Templates Controller Error Handling', () => {
    test('list() should handle S3 connection errors', async () => {
      const props = { body: { input: {} } };
      const error = new Error('S3 connection timeout');
      Services.Templates.list.mockRejectedValue(error);

      const result = await TemplatesController.list(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to list templates',
          error: 'S3 connection timeout'
        }),
        'list_templates'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('get() should handle TEMPLATE_NOT_FOUND with available templates', async () => {
      const props = {
        body: {
          input: {
            templateName: 'non-existent',
            category: 'storage'
          }
        }
      };

      const error = new Error('Template not found');
      error.code = 'TEMPLATE_NOT_FOUND';
      error.availableTemplates = ['template1', 'template2'];
      Services.Templates.get.mockRejectedValue(error);

      const result = await TemplatesController.get(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'TEMPLATE_NOT_FOUND',
        expect.objectContaining({
          availableTemplates: ['template1', 'template2']
        }),
        'get_template'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    });

    test('listVersions() should handle S3 ListObjectVersions errors', async () => {
      const props = {
        body: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage'
          }
        }
      };

      const error = new Error('Access Denied');
      error.name = 'AccessDenied';
      Services.Templates.listVersions.mockRejectedValue(error);

      const result = await TemplatesController.listVersions(props);

      expect(result.success).toBe(false);
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('listCategories() should handle configuration errors', async () => {
      const props = { body: { input: {} } };
      const error = new Error('Missing configuration');
      Services.Templates.listCategories.mockRejectedValue(error);

      const result = await TemplatesController.listCategories(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to list categories'
        }),
        'list_categories'
      );
    });
  });

  describe('Starters Controller Error Handling', () => {
    test('list() should handle S3 connection errors', async () => {
      const props = { body: { input: {} } };
      const error = new Error('S3 connection timeout');
      error.status = 403;
      Services.Starters.list.mockRejectedValue(error);

      const result = await StartersController.list(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to list starters',
          error: 'S3 connection timeout'
        }),
        'list_starters'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('get() should handle STARTER_NOT_FOUND with available starters', async () => {
      const props = {
        body: {
          input: {
            starterName: 'non-existent-starter',
            s3Buckets: ['63klabs']
          }
        }
      };

      const error = new Error('Starter not found');
      error.code = 'STARTER_NOT_FOUND';
      error.availableStarters = ['starter1', 'starter2'];
      Services.Starters.get.mockRejectedValue(error);

      const result = await StartersController.get(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'STARTER_NOT_FOUND',
        expect.objectContaining({
          availableStarters: ['starter1', 'starter2']
        }),
        'get_starter_info'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    });

    test('get() should handle S3 access denied errors', async () => {
      const props = {
        body: {
          input: {
            starterName: 'atlantis-starter-02',
            s3Buckets: ['63klabs']
          }
        }
      };

      const error = new Error('Access Denied');
      error.name = 'AccessDenied';
      Services.Starters.get.mockRejectedValue(error);

      const result = await StartersController.get(props);

      expect(result.success).toBe(false);
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('list() should handle network timeout errors', async () => {
      const props = { body: { input: {} } };
      const error = new Error('Network timeout');
      error.code = 'ETIMEDOUT';
      Services.Starters.list.mockRejectedValue(error);

      const result = await StartersController.list(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          error: 'Network timeout'
        }),
        'list_starters'
      );
    });
  });

  describe('Documentation Controller Error Handling', () => {
    test('search() should handle GitHub API errors', async () => {
      const props = {
        body: {
          input: {
            query: 'test query'
          }
        }
      };

      const error = new Error('GitHub API unavailable');
      error.status = 503;
      Services.Documentation.search.mockRejectedValue(error);

      const result = await DocumentationController.search(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to search documentation',
          error: 'GitHub API unavailable'
        }),
        'search_documentation'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('search() should handle index build errors', async () => {
      const props = {
        body: {
          input: {
            query: 'test query'
          }
        }
      };

      const error = new Error('Failed to build documentation index');
      Services.Documentation.search.mockRejectedValue(error);

      const result = await DocumentationController.search(props);

      expect(result.success).toBe(false);
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('search() should handle connection refused errors', async () => {
      const props = {
        body: {
          input: {
            query: 'test query'
          }
        }
      };

      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';
      Services.Documentation.search.mockRejectedValue(error);

      const result = await DocumentationController.search(props);

      expect(result.success).toBe(false);
    });
  });

  describe('Validation Controller Error Handling', () => {
    test('validate() should handle validation service errors', async () => {
      const props = {
        body: {
          input: {
            resourceName: 'test-name'
          }
        }
      };

      const error = new Error('Validation service unavailable');
      Services.Validation.validateNaming.mockRejectedValue(error);

      const result = await ValidationController.validate(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'VALIDATION_ERROR',
        expect.objectContaining({
          message: 'Error occurred during validation',
          error: 'Validation service unavailable'
        }),
        'validate_naming'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('validate() should handle unexpected errors', async () => {
      const props = {
        body: {
          input: {
            resourceName: 'test-name'
          }
        }
      };

      const error = new Error('Unexpected error');
      Services.Validation.validateNaming.mockRejectedValue(error);

      const result = await ValidationController.validate(props);

      expect(result.success).toBe(false);
      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        'Validation controller: Error during validation',
        expect.objectContaining({
          error: 'Unexpected error'
        })
      );
    });
  });

  describe('Updates Controller Error Handling', () => {
    test('check() should handle service errors from update check', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4/2024-01-10',
            category: 'storage'
          }
        }
      };

      Services.Templates.checkUpdates.mockResolvedValue([
        {
          templateName: 'template-storage-s3-artifacts',
          error: 'Template not found in any bucket'
        }
      ]);

      const result = await UpdatesController.check(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'UPDATE_CHECK_FAILED',
        expect.objectContaining({
          message: 'Template not found in any bucket'
        }),
        'check_template_updates'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    });

    test('check() should handle S3 connection errors', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'v1.3.4/2024-01-10',
            category: 'storage'
          }
        }
      };

      const error = new Error('S3 connection failed');
      Services.Templates.checkUpdates.mockRejectedValue(error);

      const result = await UpdatesController.check(props);

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to check template updates',
          error: 'S3 connection failed'
        }),
        'check_template_updates'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('check() should handle version parsing errors', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            currentVersion: 'invalid-version',
            category: 'storage'
          }
        }
      };

      Services.Templates.checkUpdates.mockResolvedValue([
        {
          templateName: 'template-storage-s3-artifacts',
          error: 'Invalid version format'
        }
      ]);

      const result = await UpdatesController.check(props);

      expect(result.success).toBe(false);
    });
  });

  describe('Error Logging Consistency', () => {
    test('all controllers should log errors with stack traces', async () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:10:5';

      Services.Templates.list.mockRejectedValue(error);
      Services.Starters.list.mockRejectedValue(error);
      Services.Documentation.search.mockRejectedValue(error);
      Services.Validation.validateNaming.mockRejectedValue(error);
      Services.Templates.checkUpdates.mockRejectedValue(error);

      await TemplatesController.list({ body: { input: {} } });
      await StartersController.list({ body: { input: {} } });
      await DocumentationController.search({ body: { input: { query: 'test' } } });
      await ValidationController.validate({ body: { input: { resourceName: 'test' } } });
      await UpdatesController.check({ bodyParameters: { input: { templateName: 'test', currentVersion: 'v1.0.0/2024-01-01' } } });

      // All controllers should have logged errors
      expect(tools.DebugAndLog.error).toHaveBeenCalledTimes(5);
    });

    test('all controllers should include error message in logs', async () => {
      const error = new Error('Specific error message');
      Services.Templates.list.mockRejectedValue(error);

      await TemplatesController.list({ body: { input: {} } });

      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          error: 'Specific error message'
        })
      );
    });
  });

  describe('Error Response Consistency', () => {
    test('all controllers should return consistent error response structure', async () => {
      const error = new Error('Test error');

      Services.Templates.list.mockRejectedValue(error);
      Services.Starters.list.mockRejectedValue(error);
      Services.Documentation.search.mockRejectedValue(error);
      Services.Validation.validateNaming.mockRejectedValue(error);
      Services.Templates.checkUpdates.mockRejectedValue(error);

      const result1 = await TemplatesController.list({ body: { input: {} } });
      const result2 = await StartersController.list({ body: { input: {} } });
      const result3 = await DocumentationController.search({ body: { input: { query: 'test' } } });
      const result4 = await ValidationController.validate({ body: { input: { resourceName: 'test' } } });
      const result5 = await UpdatesController.check({ bodyParameters: { input: { templateName: 'test', currentVersion: 'v1.0.0/2024-01-01' } } });

      // All should have success: false
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
      expect(result3.success).toBe(false);
      expect(result4.success).toBe(false);
      expect(result5.success).toBe(false);

      // All should have called errorResponse
      expect(MCPProtocol.errorResponse).toHaveBeenCalledTimes(5);
    });

    test('all controllers should include tool name in error response', async () => {
      const error = new Error('Test error');

      Services.Templates.list.mockRejectedValue(error);
      await TemplatesController.list({ body: { input: {} } });

      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        'list_templates'
      );
    });
  });

  describe('Edge Cases', () => {
    test('should handle errors with no message', async () => {
      const error = new Error();
      Services.Templates.list.mockRejectedValue(error);

      const result = await TemplatesController.list({ body: { input: {} } });

      expect(result.success).toBe(false);
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('should handle non-Error objects', async () => {
      const error = { message: 'Not an Error object' };
      Services.Templates.list.mockRejectedValue(error);

      const result = await TemplatesController.list({ body: { input: {} } });

      expect(result.success).toBe(false);
    });

    test('should handle errors with circular references', async () => {
      const error = new Error('Test error');
      error.circular = error; // Create circular reference
      Services.Templates.list.mockRejectedValue(error);

      // Should not throw when logging
      await expect(TemplatesController.list({ body: { input: {} } })).resolves.toBeDefined();
    });
  });
});
