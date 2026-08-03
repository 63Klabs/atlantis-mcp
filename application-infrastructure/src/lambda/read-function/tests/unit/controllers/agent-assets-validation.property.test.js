/**
 * Property-Based Tests for Agent Assets Controller Input Validation
 *
 * Feature: agent-asset-tools, Property 11: Input validation before any S3 read
 *
 * For any tool input that violates the schema -- an `assetType` that is
 * unknown or names a disabled type, a `name` containing `/` or `\`, a `name`
 * exceeding 255 characters, an empty `name`, or an unknown property -- the
 * `list_agent_assets`/`get_agent_asset` controller handlers reject the
 * request with an `INVALID_INPUT` error and never call
 * `Services.AgentAssets.list`/`.get` (i.e. no S3 read occurs).
 *
 * This test generalizes the fixed examples already covered by
 * `agent-assets-controller.test.js` (task 6.2) across many randomly
 * generated invalid inputs. It uses the REAL `SchemaValidator`
 * (`utils/schema-validator.js`, with the agent-asset schemas merged in via
 * task 8.2) and the REAL `AgentAssetTypes` registry -- both have no AWS or
 * `@63klabs/cache-data` dependency -- so real schema enforcement (the
 * `assetType` enum, the `name` pattern/length, and `additionalProperties:
 * false`) is what actually rejects each generated input. Only
 * `Services.AgentAssets`, `MCPProtocol`, and `@63klabs/cache-data` are
 * mocked, so `Services.AgentAssets.get`/`.list` can be asserted as never
 * invoked.
 *
 * Validates: Requirements 7.1, 7.2, 7.7, 7.8
 */

const fc = require('fast-check');

// Mock the service layer so we can assert it is never invoked -- the whole
// point of this property is "no S3 read", and the service is the boundary
// beyond which an S3 read would occur.
jest.mock('../../../services', () => ({
  AgentAssets: {
    list: jest.fn(),
    get: jest.fn(),
    listTypes: jest.fn()
  }
}));

// Mock MCPProtocol purely for response-shape inspection; NOT the validator.
jest.mock('../../../utils/mcp-protocol', () => ({
  successResponse: jest.fn((tool, data) => ({ success: true, tool, data })),
  errorResponse: jest.fn((code, details, tool) => ({ success: false, code, details, tool }))
}));

// >! Intentionally NOT mocking '../../../utils/schema-validator' or
// >! '../../../config/agent-asset-types' -- this property exercises the
// >! REAL schema enforcement (assetType enum, name pattern/length,
// >! additionalProperties: false) so a rejection here is a rejection by
// >! the actual validator the production controller relies on. Because
// >! that real schema-validator transitively requires
// >! '../../../config/settings', which itself requires
// >! `CachedSsmParameter` from '@63klabs/cache-data', the mock below stubs
// >! it as a no-op constructor rather than omitting it entirely.
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    CachedSsmParameter: class {
      constructor() {}
    }
  }
}));

const AgentAssetsController = require('../../../controllers/agent-assets');
const Services = require('../../../services');
const MCPProtocol = require('../../../utils/mcp-protocol');
const AgentAssetTypes = require('../../../config/agent-asset-types');

const ENABLED_ASSET_TYPES = AgentAssetTypes.getEnabledTypeNames();

/**
 * Arbitrary generating strings that are NOT one of the enabled
 * `assetType` values -- including `'skills'` (a real, disabled registry
 * entry), the empty string, and random garbage strings.
 */
const invalidAssetTypeArb = fc.oneof(
  fc.constant('skills'),
  fc.constant(''),
  fc.constantFrom('Steering', 'HOOKS', 'agents_md', 'templates', 'bogus-type', 'skill'),
  fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !ENABLED_ASSET_TYPES.includes(s))
);

/**
 * Arbitrary generating `name` values that violate the `name` schema:
 * containing a path separator (`/` or `\`), exceeding 255 characters, or
 * being an empty string.
 */
const invalidNameArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 256, maxLength: 300 }),
  fc.string({ minLength: 0, maxLength: 20 }).map((s) => `${s}/rest-of-name.md`),
  fc.string({ minLength: 0, maxLength: 20 }).map((s) => `${s}\\rest-of-name.md`)
);

/**
 * Arbitrary generating an arbitrary extra (unknown) property name/value
 * pair, excluding the tools' documented parameter names so it is always
 * genuinely an "unknown property" as far as `additionalProperties: false`
 * is concerned.
 */
const DOCUMENTED_PROPS = ['assetType', 'name', 'namespace', 's3Buckets'];
const extraPropertyArb = fc.tuple(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !DOCUMENTED_PROPS.includes(s)),
  fc.oneof(fc.string(), fc.integer(), fc.boolean())
);

describe('Feature: agent-asset-tools, Property 11: Input validation before any S3 read', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * **Validates: Requirements 7.1, 7.8**
   *
   * For any string that does not name an enabled `assetType`, both
   * `get_agent_asset` and `list_agent_assets` reject the request with
   * `INVALID_INPUT` and never call the corresponding service method.
   */
  test('invalid assetType is rejected with INVALID_INPUT for both get() and list(), with no service call', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidAssetTypeArb,
        async (invalidAssetType) => {
          jest.clearAllMocks();

          // get_agent_asset
          const getResult = await AgentAssetsController.get({
            bodyParameters: { input: { assetType: invalidAssetType, name: 'valid-name.md' } }
          });

          expect(getResult.success).toBe(false);
          expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
            'INVALID_INPUT',
            expect.anything(),
            'get_agent_asset'
          );
          expect(Services.AgentAssets.get).not.toHaveBeenCalled();

          jest.clearAllMocks();

          // list_agent_assets
          const listResult = await AgentAssetsController.list({
            bodyParameters: { input: { assetType: invalidAssetType } }
          });

          expect(listResult.success).toBe(false);
          expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
            'INVALID_INPUT',
            expect.anything(),
            'list_agent_assets'
          );
          expect(Services.AgentAssets.list).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.7**
   *
   * For any `name` value containing a path separator, exceeding 255
   * characters, or empty, `get_agent_asset` rejects the request with
   * `INVALID_INPUT` and never calls `Services.AgentAssets.get`.
   */
  test('invalid name is rejected with INVALID_INPUT for get(), with no service call', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidNameArb,
        async (invalidName) => {
          jest.clearAllMocks();

          const result = await AgentAssetsController.get({
            bodyParameters: { input: { assetType: 'steering', name: invalidName } }
          });

          expect(result.success).toBe(false);
          expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
            'INVALID_INPUT',
            expect.anything(),
            'get_agent_asset'
          );
          expect(Services.AgentAssets.get).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2, 7.7**
   *
   * For any unknown extra property supplied to `get_agent_asset` (alongside
   * otherwise-valid `assetType`/`name`), the request is rejected with
   * `INVALID_INPUT` (via the schema's `additionalProperties: false`) and
   * `Services.AgentAssets.get` is never called.
   */
  test('unknown property is rejected with INVALID_INPUT for get(), with no service call', async () => {
    await fc.assert(
      fc.asyncProperty(
        extraPropertyArb,
        async ([propName, propValue]) => {
          jest.clearAllMocks();

          const result = await AgentAssetsController.get({
            bodyParameters: {
              input: { assetType: 'steering', name: 'valid-name.md', [propName]: propValue }
            }
          });

          expect(result.success).toBe(false);
          expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
            'INVALID_INPUT',
            expect.anything(),
            'get_agent_asset'
          );
          expect(Services.AgentAssets.get).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.2, 7.7**
   *
   * For any unknown extra property supplied to `list_agent_assets`, the
   * request is rejected with `INVALID_INPUT` and
   * `Services.AgentAssets.list` is never called.
   */
  test('unknown property is rejected with INVALID_INPUT for list(), with no service call', async () => {
    await fc.assert(
      fc.asyncProperty(
        extraPropertyArb,
        async ([propName, propValue]) => {
          jest.clearAllMocks();

          const result = await AgentAssetsController.list({
            bodyParameters: {
              input: { [propName]: propValue }
            }
          });

          expect(result.success).toBe(false);
          expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
            'INVALID_INPUT',
            expect.anything(),
            'list_agent_assets'
          );
          expect(Services.AgentAssets.list).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
