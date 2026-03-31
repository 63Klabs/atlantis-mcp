/**
 * Preservation Property Tests - Valid Service Results and Thrown Errors Unchanged
 *
 * These tests capture the EXISTING correct behavior that must be PRESERVED
 * after the null-guard fix is applied. They verify:
 *
 * 1. Templates.get() with valid non-null service result returns success response
 * 2. Starters.get() with valid non-null service result returns success response
 * 3. Templates thrown TEMPLATE_NOT_FOUND error returns proper error response
 * 4. Starters thrown STARTER_NOT_FOUND error returns proper error response
 *
 * ALL tests MUST PASS on the current UNFIXED code.
 *
 * **Validates: Requirements 2.3, 3.1, 3.2, 3.5**
 */

const fc = require('fast-check');

// Mock dependencies following existing codebase pattern
jest.mock('../../../services', () => ({
  Templates: { list: jest.fn(), get: jest.fn(), listVersions: jest.fn(), listCategories: jest.fn() },
  Starters: { list: jest.fn(), get: jest.fn() }
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
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

describe('Preservation: Valid Service Results and Thrown Errors Unchanged', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SchemaValidator.validate.mockReturnValue({ valid: true });
  });

  /**
   * Property 2: Preservation - Templates.get() with valid non-null service result
   *
   * **Validates: Requirements 2.3, 3.1**
   *
   * For any valid template object returned by the service, the controller
   * logs via DebugAndLog.info and returns MCPProtocol.successResponse
   * with the template data.
   */
  test('Templates.get() with valid non-null service result returns success response', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          version: fc.string({ minLength: 1, maxLength: 30 }),
          versionId: fc.string({ minLength: 1, maxLength: 30 }),
          namespace: fc.string({ minLength: 1, maxLength: 30 }),
          bucket: fc.string({ minLength: 1, maxLength: 50 })
        }),
        async (template) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Templates.get.mockResolvedValue(template);

          const props = {
            bodyParameters: {
              input: { templateName: template.name, category: 'test-category' }
            }
          };

          const result = await TemplatesController.get(props);

          // Controller should log the response via DebugAndLog.info
          expect(DebugAndLog.info).toHaveBeenCalledWith(
            'get_template response',
            expect.objectContaining({
              templateName: template.name,
              version: template.version,
              versionId: template.versionId,
              namespace: template.namespace,
              bucket: template.bucket
            })
          );

          // Controller should return success response with template data
          expect(MCPProtocol.successResponse).toHaveBeenCalledWith('get_template', template);
          expect(result.success).toBe(true);
          expect(result.data).toEqual(template);
        }
      ),
      { numRuns: 25 }
    );
  });

  /**
   * Property 2: Preservation - Starters.get() with valid non-null service result
   *
   * **Validates: Requirements 2.3, 3.2**
   *
   * For any valid starter object returned by the service, the controller
   * logs via DebugAndLog.info and returns MCPProtocol.successResponse
   * with the starter data.
   */
  test('Starters.get() with valid non-null service result returns success response', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          source: fc.string({ minLength: 1, maxLength: 30 }),
          hasS3Package: fc.boolean(),
          hasSidecarMetadata: fc.boolean()
        }),
        async (starter) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Starters.get.mockResolvedValue(starter);

          const props = {
            bodyParameters: {
              input: { starterName: starter.name }
            }
          };

          const result = await StartersController.get(props);

          // Controller should log the response via DebugAndLog.info
          expect(DebugAndLog.info).toHaveBeenCalledWith(
            'get_starter_info response',
            expect.objectContaining({
              starterName: starter.name,
              hasS3Package: starter.hasS3Package,
              hasSidecarMetadata: starter.hasSidecarMetadata,
              source: starter.source
            })
          );

          // Controller should return success response with starter data
          expect(MCPProtocol.successResponse).toHaveBeenCalledWith('get_starter_info', starter);
          expect(result.success).toBe(true);
          expect(result.data).toEqual(starter);
        }
      ),
      { numRuns: 25 }
    );
  });

  /**
   * Property 2: Preservation - Templates thrown TEMPLATE_NOT_FOUND error
   *
   * **Validates: Requirements 3.5**
   *
   * When the service throws an error with code 'TEMPLATE_NOT_FOUND' and
   * an availableTemplates array, the catch block returns a TEMPLATE_NOT_FOUND
   * error response with the available templates.
   */
  test('Templates thrown TEMPLATE_NOT_FOUND error returns proper error response', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.array(fc.string({ minLength: 1, maxLength: 40 }), { minLength: 0, maxLength: 5 }),
        async (errorMessage, availableTemplates) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });

          const notFoundError = new Error(errorMessage);
          notFoundError.code = 'TEMPLATE_NOT_FOUND';
          notFoundError.availableTemplates = availableTemplates;
          Services.Templates.get.mockRejectedValue(notFoundError);

          const props = {
            bodyParameters: {
              input: { templateName: 'any-template', category: 'any-category' }
            }
          };

          const result = await TemplatesController.get(props);

          // Catch block should return TEMPLATE_NOT_FOUND error response
          expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
            'TEMPLATE_NOT_FOUND',
            expect.objectContaining({
              message: errorMessage,
              availableTemplates: availableTemplates
            }),
            'get_template'
          );
          expect(result.success).toBe(false);
          expect(result.code).toBe('TEMPLATE_NOT_FOUND');
        }
      ),
      { numRuns: 25 }
    );
  });

  /**
   * Property 2: Preservation - Starters thrown STARTER_NOT_FOUND error
   *
   * **Validates: Requirements 3.5**
   *
   * When the service throws an error with code 'STARTER_NOT_FOUND' and
   * an availableStarters array, the catch block returns a STARTER_NOT_FOUND
   * error response with the available starters.
   */
  test('Starters thrown STARTER_NOT_FOUND error returns proper error response', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.array(fc.string({ minLength: 1, maxLength: 40 }), { minLength: 0, maxLength: 5 }),
        async (errorMessage, availableStarters) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });

          const notFoundError = new Error(errorMessage);
          notFoundError.code = 'STARTER_NOT_FOUND';
          notFoundError.availableStarters = availableStarters;
          Services.Starters.get.mockRejectedValue(notFoundError);

          const props = {
            bodyParameters: {
              input: { starterName: 'any-starter' }
            }
          };

          const result = await StartersController.get(props);

          // Catch block should return STARTER_NOT_FOUND error response
          expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
            'STARTER_NOT_FOUND',
            expect.objectContaining({
              message: errorMessage,
              availableStarters: availableStarters
            }),
            'get_starter_info'
          );
          expect(result.success).toBe(false);
          expect(result.code).toBe('STARTER_NOT_FOUND');
        }
      ),
      { numRuns: 25 }
    );
  });
});
