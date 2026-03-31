/**
 * Property-Based Tests for Controller Resolution Integration
 *
 * Feature: flexible-version-lookup
 * Property 5: Controller resolution integration
 *
 * For any `currentVersion` input in Human_Readable_Version format, the value
 * passed to `Templates.checkUpdates` shall be identical to the input.
 * For any `currentVersion` in Short_Version or S3_VersionId format that resolves
 * successfully, the value passed to `Templates.checkUpdates` shall be the resolved
 * Human_Readable_Version. For any S3_VersionId that fails resolution, the controller
 * shall return an MCP error response with code `VERSION_RESOLUTION_FAILED`.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 */

const fc = require('fast-check');

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

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


/* ------------------------------------------------------------------ */
/*  Generators                                                        */
/* ------------------------------------------------------------------ */

/**
 * Generator for valid Human_Readable_Version strings: vX.Y.Z/YYYY-MM-DD
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing Human_Readable_Version strings
 */
function humanReadableVersionArb() {
  return fc.tuple(
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 })
  ).map(([major, minor, patch, year, month, day]) => {
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `v${major}.${minor}.${patch}/${year}-${mm}-${dd}`;
  });
}

/**
 * Generator for valid Short_Version strings: vX.Y.Z
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing Short_Version strings
 */
function shortVersionArb() {
  return fc.tuple(
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 })
  ).map(([major, minor, patch]) => `v${major}.${minor}.${patch}`);
}

/**
 * Generator for S3_VersionId strings that do not match version patterns.
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing S3_VersionId-like strings
 */
function s3VersionIdArb() {
  return fc.hexaString({ minLength: 8, maxLength: 32 })
    .filter(s => !/^v\d+\.\d+\.\d+(\/\d{4}-\d{2}-\d{2})?$/.test(s));
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a standard props object for the controller.
 *
 * @param {string} currentVersion - Version string to test
 * @returns {Object} Props object matching controller input shape
 */
function buildProps(currentVersion) {
  return {
    bodyParameters: {
      input: {
        templateName: 'test-template',
        currentVersion,
        category: 'storage'
      }
    }
  };
}

/**
 * Default mock checkUpdates result used across tests.
 */
const DEFAULT_CHECK_RESULT = [{
  templateName: 'test-template',
  category: 'storage',
  currentVersion: 'v1.0.0/2024-01-01',
  latestVersion: 'v1.0.0/2024-01-01',
  updateAvailable: false,
  releaseDate: '2024-01-01',
  changelog: null,
  breakingChanges: false,
  migrationGuide: null,
  s3Path: 's3://bucket/templates/test-template.yml',
  namespace: 'atlantis',
  bucket: 'test-bucket'
}];

/* ------------------------------------------------------------------ */
/*  Property 5: Controller resolution integration                     */
/*  Validates: Requirements 6.1, 6.2, 6.3, 6.4                       */
/* ------------------------------------------------------------------ */

describe('Feature: flexible-version-lookup, Property 5: Controller resolution integration', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    SchemaValidator.validate.mockReturnValue({ valid: true });
    Services.Templates.checkUpdates.mockResolvedValue(DEFAULT_CHECK_RESULT);
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * For any Human_Readable_Version input, the value passed to
   * Templates.checkUpdates is identical to the input (pass-through).
   */
  test('Human_Readable_Version is passed directly to checkUpdates without resolution', async () => {
    await fc.assert(
      fc.asyncProperty(
        humanReadableVersionArb(),
        async (hrVersion) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Templates.checkUpdates.mockResolvedValue(DEFAULT_CHECK_RESULT);

          const props = buildProps(hrVersion);
          await UpdatesController.check(props);

          expect(Services.Templates.checkUpdates).toHaveBeenCalledTimes(1);
          const callArg = Services.Templates.checkUpdates.mock.calls[0][0];
          expect(callArg.templates[0].currentVersion).toBe(hrVersion);

          // listVersions should NOT be called for Human_Readable_Version
          expect(Services.Templates.listVersions).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.2, 6.3**
   *
   * For any Short_Version input that resolves successfully, the resolved
   * Human_Readable_Version is passed to Templates.checkUpdates.
   */
  test('Short_Version is resolved and the resolved version is passed to checkUpdates', async () => {
    await fc.assert(
      fc.asyncProperty(
        shortVersionArb(),
        fc.integer({ min: 2000, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        async (shortVer, year, month, day) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Templates.checkUpdates.mockResolvedValue(DEFAULT_CHECK_RESULT);

          const mm = String(month).padStart(2, '0');
          const dd = String(day).padStart(2, '0');
          const fullVersion = `${shortVer}/${year}-${mm}-${dd}`;

          // Mock listVersions to return a history containing the matching entry
          Services.Templates.listVersions.mockResolvedValue({
            templateName: 'test-template',
            category: 'storage',
            versions: [
              { versionId: 'some-id', version: fullVersion, lastModified: new Date(), size: 1024, isLatest: true }
            ]
          });

          const props = buildProps(shortVer);
          await UpdatesController.check(props);

          expect(Services.Templates.listVersions).toHaveBeenCalledTimes(1);
          expect(Services.Templates.checkUpdates).toHaveBeenCalledTimes(1);
          const callArg = Services.Templates.checkUpdates.mock.calls[0][0];
          expect(callArg.templates[0].currentVersion).toBe(fullVersion);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.2, 6.3**
   *
   * For any S3_VersionId input that resolves successfully, the resolved
   * Human_Readable_Version is passed to Templates.checkUpdates.
   */
  test('S3_VersionId is resolved and the resolved version is passed to checkUpdates', async () => {
    await fc.assert(
      fc.asyncProperty(
        s3VersionIdArb(),
        humanReadableVersionArb(),
        async (versionId, resolvedVersion) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Templates.checkUpdates.mockResolvedValue(DEFAULT_CHECK_RESULT);

          // Mock listVersions to return a history containing the matching versionId
          Services.Templates.listVersions.mockResolvedValue({
            templateName: 'test-template',
            category: 'storage',
            versions: [
              { versionId, version: resolvedVersion, lastModified: new Date(), size: 1024, isLatest: true }
            ]
          });

          const props = buildProps(versionId);
          await UpdatesController.check(props);

          expect(Services.Templates.listVersions).toHaveBeenCalledTimes(1);
          expect(Services.Templates.checkUpdates).toHaveBeenCalledTimes(1);
          const callArg = Services.Templates.checkUpdates.mock.calls[0][0];
          expect(callArg.templates[0].currentVersion).toBe(resolvedVersion);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * For any S3_VersionId that fails resolution (not found in version history),
   * the controller returns an MCP error response with code VERSION_RESOLUTION_FAILED.
   */
  test('S3_VersionId that fails resolution returns VERSION_RESOLUTION_FAILED error', async () => {
    await fc.assert(
      fc.asyncProperty(
        s3VersionIdArb(),
        async (versionId) => {
          jest.clearAllMocks();
          SchemaValidator.validate.mockReturnValue({ valid: true });
          Services.Templates.checkUpdates.mockResolvedValue(DEFAULT_CHECK_RESULT);

          // Mock listVersions to return a history with NO matching versionId
          Services.Templates.listVersions.mockResolvedValue({
            templateName: 'test-template',
            category: 'storage',
            versions: [
              { versionId: 'completely-different-id', version: 'v9.9.9/2099-12-31', lastModified: new Date(), size: 1024, isLatest: true }
            ]
          });

          const props = buildProps(versionId);
          const result = await UpdatesController.check(props);

          // checkUpdates should NOT be called when resolution fails
          expect(Services.Templates.checkUpdates).not.toHaveBeenCalled();

          // Should return an error response with VERSION_RESOLUTION_FAILED
          expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
            'VERSION_RESOLUTION_FAILED',
            expect.objectContaining({
              message: expect.any(String),
              versionId,
              templateName: 'test-template',
              category: 'storage'
            }),
            'check_template_updates'
          );
          expect(result.success).toBe(false);
          expect(result.code).toBe('VERSION_RESOLUTION_FAILED');
        }
      ),
      { numRuns: 100 }
    );
  });
});
