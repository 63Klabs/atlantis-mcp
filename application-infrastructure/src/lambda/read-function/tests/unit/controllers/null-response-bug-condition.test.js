/**
 * Bug Condition Exploration Test - Null Service Result Crashes Controller
 *
 * This test encodes the EXPECTED behavior: when Services.Templates.get() or
 * Services.Starters.get() returns null, the controller should return a proper
 * not-found MCP error response (TEMPLATE_NOT_FOUND / STARTER_NOT_FOUND).
 *
 * On UNFIXED code, this test WILL FAIL because the controller crashes with
 * TypeError: Cannot read properties of null (reading 'name') at the
 * DebugAndLog.info line, and the catch block returns a generic INTERNAL_ERROR.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2
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
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');

describe('Bug Condition: Null Service Result Crashes Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // All inputs pass schema validation
    SchemaValidator.validate.mockReturnValue({ valid: true });
  });

  /**
   * Property 1: Bug Condition - Null Service Result Crashes Controller
   *
   * **Validates: Requirements 1.1, 1.3, 2.1**
   *
   * For any valid templateName/category input where Services.Templates.get()
   * returns null, the controller SHOULD return a TEMPLATE_NOT_FOUND error
   * response without throwing a TypeError.
   */
  test('Templates.get() with null service result should return TEMPLATE_NOT_FOUND (not crash)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        async (templateName, category) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });

          // Service returns null (the bug condition)
          Services.Templates.get.mockResolvedValue(null);

          const props = {
            bodyParameters: {
              input: { templateName, category }
            }
          };

          // Call the controller - on unfixed code this will crash
          const result = await TemplatesController.get(props);

          // Expected behavior: proper not-found error response
          expect(result.success).toBe(false);
          expect(result.code).toBe('TEMPLATE_NOT_FOUND');
        }
      ),
      { numRuns: 25 }
    );
  });

  /**
   * Property 1: Bug Condition - Null Service Result Crashes Controller
   *
   * **Validates: Requirements 1.2, 1.3, 2.2**
   *
   * For any valid starterName input where Services.Starters.get() returns null,
   * the controller SHOULD return a STARTER_NOT_FOUND error response without
   * throwing a TypeError.
   */
  test('Starters.get() with null service result should return STARTER_NOT_FOUND (not crash)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (starterName) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });

          // Service returns null (the bug condition)
          Services.Starters.get.mockResolvedValue(null);

          const props = {
            bodyParameters: {
              input: { starterName }
            }
          };

          // Call the controller - on unfixed code this will crash
          const result = await StartersController.get(props);

          // Expected behavior: proper not-found error response
          expect(result.success).toBe(false);
          expect(result.code).toBe('STARTER_NOT_FOUND');
        }
      ),
      { numRuns: 25 }
    );
  });
});
