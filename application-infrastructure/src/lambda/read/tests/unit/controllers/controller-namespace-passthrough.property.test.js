/**
 * Property-Based Tests for Controller Namespace Passthrough
 *
 * Feature: add-namespace-filter-to-list-templates
 * Property 3: Controller passes namespace through to service layer
 *
 * Validates that all four controller handlers (list, get, listVersions, check)
 * pass the exact namespace value to the corresponding service function,
 * and pass undefined when namespace is omitted.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */

const fc = require('fast-check');

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

/**
 * Arbitrary that generates valid namespace strings matching ^[a-z0-9][a-z0-9-]*$
 * with maxLength 63.
 */
const validNamespaceArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 1, maxLength: 63 }
).filter(s => /^[a-z0-9][a-z0-9-]*$/.test(s));

/* ------------------------------------------------------------------ */
/*  Property 3: Controller passes namespace through to service layer  */
/*  Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5                  */
/* ------------------------------------------------------------------ */

describe('Feature: add-namespace-filter-to-list-templates, Property 3: Controller passes namespace through to service layer', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    SchemaValidator.validate.mockReturnValue({ valid: true });
  });

  test('list(): passes exact namespace value to Services.Templates.list()', async () => {
    Services.Templates.list.mockResolvedValue({ templates: [] });

    await fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Templates.list.mockResolvedValue({ templates: [] });

          const props = { bodyParameters: { input: { namespace } } };
          await TemplatesController.list(props);

          expect(Services.Templates.list).toHaveBeenCalledTimes(1);
          const callArg = Services.Templates.list.mock.calls[0][0];
          expect(callArg.namespace).toBe(namespace);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('get(): passes exact namespace value to Services.Templates.get()', async () => {
    Services.Templates.get.mockResolvedValue({
      name: 'tpl', version: 'v1.0.0', versionId: 'abc', namespace: 'ns', bucket: 'b'
    });

    await fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Templates.get.mockResolvedValue({
            name: 'tpl', version: 'v1.0.0', versionId: 'abc', namespace: 'ns', bucket: 'b'
          });

          const props = {
            bodyParameters: {
              input: { templateName: 'tpl.yml', category: 'storage', namespace }
            }
          };
          await TemplatesController.get(props);

          expect(Services.Templates.get).toHaveBeenCalledTimes(1);
          const callArg = Services.Templates.get.mock.calls[0][0];
          expect(callArg.namespace).toBe(namespace);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('listVersions(): passes exact namespace value to Services.Templates.listVersions()', async () => {
    Services.Templates.listVersions.mockResolvedValue({ templateName: 'tpl', versions: [] });

    await fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Templates.listVersions.mockResolvedValue({ templateName: 'tpl', versions: [] });

          const props = {
            bodyParameters: {
              input: { templateName: 'tpl.yml', category: 'storage', namespace }
            }
          };
          await TemplatesController.listVersions(props);

          expect(Services.Templates.listVersions).toHaveBeenCalledTimes(1);
          const callArg = Services.Templates.listVersions.mock.calls[0][0];
          expect(callArg.namespace).toBe(namespace);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('check(): passes exact namespace value to Services.Templates.checkUpdates()', async () => {
    Services.Templates.checkUpdates.mockResolvedValue([{
      templateName: 'tpl', updateAvailable: false
    }]);

    await fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Templates.checkUpdates.mockResolvedValue([{
            templateName: 'tpl', updateAvailable: false
          }]);

          const props = {
            bodyParameters: {
              input: {
                templateName: 'tpl.yml',
                currentVersion: 'v1.0.0',
                category: 'storage',
                namespace
              }
            }
          };
          await UpdatesController.check(props);

          expect(Services.Templates.checkUpdates).toHaveBeenCalledTimes(1);
          const callArg = Services.Templates.checkUpdates.mock.calls[0][0];
          expect(callArg.namespace).toBe(namespace);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('all handlers pass undefined when namespace is omitted', async () => {
    // list
    Services.Templates.list.mockResolvedValue({ templates: [] });
    await TemplatesController.list({ bodyParameters: { input: {} } });
    expect(Services.Templates.list.mock.calls[0][0].namespace).toBeUndefined();

    jest.clearAllMocks();
    SchemaValidator.validate.mockReturnValue({ valid: true });

    // get
    Services.Templates.get.mockResolvedValue({
      name: 'tpl', version: 'v1.0.0', versionId: 'abc', namespace: 'ns', bucket: 'b'
    });
    await TemplatesController.get({
      bodyParameters: { input: { templateName: 'tpl.yml', category: 'storage' } }
    });
    expect(Services.Templates.get.mock.calls[0][0].namespace).toBeUndefined();

    jest.clearAllMocks();
    SchemaValidator.validate.mockReturnValue({ valid: true });

    // listVersions
    Services.Templates.listVersions.mockResolvedValue({ templateName: 'tpl', versions: [] });
    await TemplatesController.listVersions({
      bodyParameters: { input: { templateName: 'tpl.yml', category: 'storage' } }
    });
    expect(Services.Templates.listVersions.mock.calls[0][0].namespace).toBeUndefined();

    jest.clearAllMocks();
    SchemaValidator.validate.mockReturnValue({ valid: true });

    // check
    Services.Templates.checkUpdates.mockResolvedValue([{ templateName: 'tpl', updateAvailable: false }]);
    await UpdatesController.check({
      bodyParameters: {
        input: { templateName: 'tpl.yml', currentVersion: 'v1.0.0', category: 'storage' }
      }
    });
    expect(Services.Templates.checkUpdates.mock.calls[0][0].namespace).toBeUndefined();
  });
});
