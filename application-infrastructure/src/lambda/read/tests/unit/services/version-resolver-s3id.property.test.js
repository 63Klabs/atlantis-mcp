/**
 * Property-Based Tests for Version Resolver S3_VersionId Resolution
 *
 * Feature: flexible-version-lookup
 * Property 3: S3_VersionId resolution
 *
 * For any version history containing an entry whose `versionId` matches a
 * given S3_VersionId, `resolve` shall return the associated
 * Human_Readable_Version. For any version history that does not contain a
 * matching `versionId`, `resolve` shall throw an error with code
 * `VERSION_RESOLUTION_FAILED`.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

const fc = require('fast-check');

jest.mock('../../../services', () => ({
  Templates: {
    listVersions: jest.fn()
  }
}));

const { resolve } = require('../../../services/version-resolver');
const Services = require('../../../services');

/** Template info used for all tests */
const templateInfo = { category: 'storage', templateName: 'test-template' };

/* ------------------------------------------------------------------ */
/*  Generators                                                        */
/* ------------------------------------------------------------------ */

/**
 * Generator for an S3_VersionId string.
 * Produces hex/alphanumeric strings that clearly do not match vX.Y.Z
 * or vX.Y.Z/YYYY-MM-DD patterns.
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing S3_VersionId strings
 */
function s3VersionIdArb() {
  return fc.hexaString({ minLength: 8, maxLength: 32 })
    .filter(s => s.length > 0 && !/^v\d+\.\d+\.\d+(\/\d{4}-\d{2}-\d{2})?$/.test(s));
}

/**
 * Generator for a Human_Readable_Version string: vX.Y.Z/YYYY-MM-DD
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
 * Build a version history entry.
 *
 * @param {string} version - Human_Readable_Version string
 * @param {string} versionId - S3 version id
 * @returns {Object} Version history entry
 */
function makeEntry(version, versionId) {
  return {
    versionId,
    version,
    lastModified: new Date(),
    size: 4096,
    isLatest: false
  };
}

/**
 * Generator for additional (non-matching) version history entries.
 * Produces entries whose versionId will not collide with a given id.
 *
 * @param {string} excludeId - versionId to avoid
 * @returns {fc.Arbitrary<Array<Object>>} Arbitrary producing arrays of version entries
 */
function otherEntriesArb(excludeId) {
  return fc.array(
    fc.tuple(humanReadableVersionArb(), s3VersionIdArb()),
    { minLength: 0, maxLength: 5 }
  ).map(entries =>
    entries
      .filter(([, id]) => id !== excludeId)
      .map(([version, id]) => makeEntry(version, id))
  );
}

/* ------------------------------------------------------------------ */
/*  Property 3: S3_VersionId resolution                               */
/*  Validates: Requirements 3.1, 3.2, 3.3                            */
/* ------------------------------------------------------------------ */

describe('Feature: flexible-version-lookup, Property 3: S3_VersionId resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * When a version history contains an entry whose versionId matches the
   * given S3_VersionId, resolve returns the associated Human_Readable_Version.
   */
  it('resolves S3_VersionId to Human_Readable_Version when match exists in history', async () => {
    await fc.assert(
      fc.asyncProperty(
        s3VersionIdArb(),
        humanReadableVersionArb(),
        otherEntriesArb('__placeholder__'),
        async (versionId, humanVersion, others) => {
          const matchEntry = makeEntry(humanVersion, versionId);

          // Build history with the known entry plus other entries
          const filteredOthers = others.filter(e => e.versionId !== versionId);
          const versions = [...filteredOthers, matchEntry];

          Services.Templates.listVersions.mockResolvedValue({
            templateName: 'test-template',
            category: 'storage',
            versions
          });

          const result = await resolve(versionId, templateInfo);
          expect(result).toBe(humanVersion);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * When a version history does not contain any entry whose versionId matches
   * the given S3_VersionId, resolve throws an error with code
   * VERSION_RESOLUTION_FAILED.
   */
  it('throws VERSION_RESOLUTION_FAILED when no matching versionId exists in history', async () => {
    await fc.assert(
      fc.asyncProperty(
        s3VersionIdArb(),
        otherEntriesArb('__placeholder__'),
        async (versionId, others) => {
          // Ensure none of the other entries match the generated versionId
          const nonMatchingEntries = others.filter(e => e.versionId !== versionId);

          Services.Templates.listVersions.mockResolvedValue({
            templateName: 'test-template',
            category: 'storage',
            versions: nonMatchingEntries
          });

          await expect(resolve(versionId, templateInfo)).rejects.toMatchObject({
            code: 'VERSION_RESOLUTION_FAILED'
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});
