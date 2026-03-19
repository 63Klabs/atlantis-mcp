/**
 * Unit Tests for Controller Namespace Extraction
 *
 * Feature: add-namespace-filter-to-list-templates
 * Tests that each controller handler extracts namespace from input
 * and passes it to the corresponding service function.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */

// Mock dependencies before requiring controllers
jest.mock('../../../services', () => ({
  Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn(),
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

const TemplatesController = require('../../../controllers/templates');
const UpdatesController = require('../../../controllers/updates');
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');

describe('Controller Namespace Extraction', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    SchemaValidator.validate.mockReturnValue({ valid: true });
  });

  describe('Templates Controller - list()', () => {
    test('should pass namespace to Services.Templates.list() when provided', async () => {
      Services.Templates.list.mockResolvedValue({ templates: [] });

      await TemplatesController.list({
        bodyParameters: { input: { category: 'storage', namespace: 'acme' } }
      });

      expect(Services.Templates.list).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'acme' })
      );
    });

    test('should pass undefined namespace to Services.Templates.list() when omitted', async () => {
      Services.Templates.list.mockResolvedValue({ templates: [] });

      await TemplatesController.list({
        bodyParameters: { input: { category: 'storage' } }
      });

      expect(Services.Templates.list).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: undefined })
      );
    });

    test('should pass namespace alongside other parameters', async () => {
      Services.Templates.list.mockResolvedValue({ templates: [] });

      await TemplatesController.list({
        bodyParameters: {
          input: {
            category: 'storage',
            version: 'v1.0.0',
            versionId: 'abc123',
            s3Buckets: ['bucket1'],
            namespace: 'turbo-kiln'
          }
        }
      });

      expect(Services.Templates.list).toHaveBeenCalledWith({
        category: 'storage',
        version: 'v1.0.0',
        versionId: 'abc123',
        s3Buckets: ['bucket1'],
        namespace: 'turbo-kiln'
      });
    });
  });

  describe('Templates Controller - get()', () => {
    test('should pass namespace to Services.Templates.get() when provided', async () => {
      Services.Templates.get.mockResolvedValue({
        name: 'tpl', version: 'v1.0.0', versionId: 'abc', namespace: 'acme', bucket: 'b'
      });

      await TemplatesController.get({
        bodyParameters: {
          input: { templateName: 'tpl.yml', category: 'storage', namespace: 'acme' }
        }
      });

      expect(Services.Templates.get).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'acme' })
      );
    });

    test('should pass undefined namespace to Services.Templates.get() when omitted', async () => {
      Services.Templates.get.mockResolvedValue({
        name: 'tpl', version: 'v1.0.0', versionId: 'abc', namespace: 'ns', bucket: 'b'
      });

      await TemplatesController.get({
        bodyParameters: {
          input: { templateName: 'tpl.yml', category: 'storage' }
        }
      });

      expect(Services.Templates.get).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: undefined })
      );
    });
  });

  describe('Templates Controller - listVersions()', () => {
    test('should pass namespace to Services.Templates.listVersions() when provided', async () => {
      Services.Templates.listVersions.mockResolvedValue({ templateName: 'tpl', versions: [] });

      await TemplatesController.listVersions({
        bodyParameters: {
          input: { templateName: 'tpl.yml', category: 'storage', namespace: 'x1' }
        }
      });

      expect(Services.Templates.listVersions).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'x1' })
      );
    });

    test('should pass undefined namespace to Services.Templates.listVersions() when omitted', async () => {
      Services.Templates.listVersions.mockResolvedValue({ templateName: 'tpl', versions: [] });

      await TemplatesController.listVersions({
        bodyParameters: {
          input: { templateName: 'tpl.yml', category: 'storage' }
        }
      });

      expect(Services.Templates.listVersions).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: undefined })
      );
    });
  });

  describe('Updates Controller - check()', () => {
    test('should pass namespace to Services.Templates.checkUpdates() when provided', async () => {
      Services.Templates.checkUpdates.mockResolvedValue([{
        templateName: 'tpl', updateAvailable: false
      }]);

      await UpdatesController.check({
        bodyParameters: {
          input: {
            templateName: 'tpl.yml',
            currentVersion: 'v1.0.0',
            category: 'storage',
            namespace: 'atlantis'
          }
        }
      });

      expect(Services.Templates.checkUpdates).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'atlantis' })
      );
    });

    test('should pass undefined namespace to Services.Templates.checkUpdates() when omitted', async () => {
      Services.Templates.checkUpdates.mockResolvedValue([{
        templateName: 'tpl', updateAvailable: false
      }]);

      await UpdatesController.check({
        bodyParameters: {
          input: {
            templateName: 'tpl.yml',
            currentVersion: 'v1.0.0',
            category: 'storage'
          }
        }
      });

      expect(Services.Templates.checkUpdates).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: undefined })
      );
    });

    test('should pass namespace alongside s3Buckets and templates', async () => {
      Services.Templates.checkUpdates.mockResolvedValue([{
        templateName: 'tpl', updateAvailable: false
      }]);

      await UpdatesController.check({
        bodyParameters: {
          input: {
            templateName: 'tpl.yml',
            currentVersion: 'v1.0.0',
            category: 'storage',
            s3Buckets: ['bucket1'],
            namespace: 'turbo-kiln'
          }
        }
      });

      expect(Services.Templates.checkUpdates).toHaveBeenCalledWith({
        templates: [{
          category: 'storage',
          templateName: 'tpl.yml',
          currentVersion: 'v1.0.0'
        }],
        s3Buckets: ['bucket1'],
        namespace: 'turbo-kiln'
      });
    });
  });
});
