/**
 * Property-Based Tests for Version Resolver Short_Version Resolution
 *
 * Feature: flexible-version-lookup
 * Property 2: Short_Version resolution round-trip
 *
 * For any version history containing an entry with `version` starting with
 * a given Short_Version prefix, `resolve` shall return the full
 * Human_Readable_Version from that entry. For any version history that does
 * not contain a matching entry, `resolve` shall return the original
 * Short_Version string unchanged.
 *
 * Validates: Requirements 2.1, 2.2, 2.3
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
 * Generator for a Short_Version string: vX.Y.Z
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
 * Generator for a date part string: YYYY-MM-DD
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing date strings
 */
function datePartArb() {
  return fc.tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 })
  ).map(([year, month, day]) => {
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  });
}

/**
 * Generator for a version history entry.
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
 * Produces entries whose Short_Version prefix will not collide with a given prefix.
 *
 * @param {string} excludePrefix - Short_Version prefix to avoid
 * @returns {fc.Arbitrary<Array<Object>>} Arbitrary producing arrays of version entries
 */
function otherEntriesArb(excludePrefix) {
  return fc.array(
    fc.tuple(shortVersionArb(), datePartArb(), fc.hexaString({ minLength: 6, maxLength: 12 })),
    { minLength: 0, maxLength: 5 }
  ).map(entries =>
    entries
      .filter(([sv]) => sv !== excludePrefix)
      .map(([sv, date, id]) => makeEntry(`${sv}/${date}`, id))
  );
}

/* ------------------------------------------------------------------ */
/*  Property 2: Short_Version resolution round-trip                   */
/*  Validates: Requirements 2.1, 2.2, 2.3                            */
/* ------------------------------------------------------------------ */

describe('Feature: flexible-version-lookup, Property 2: Short_Version resolution round-trip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * When a version history contains an entry whose version starts with the
   * given Short_Version, resolve returns the full Human_Readable_Version.
   */
  it('resolves Short_Version to full Human_Readable_Version when match exists in history', async () => {
    await fc.assert(
      fc.asyncProperty(
        shortVersionArb(),
        datePartArb(),
        otherEntriesArb('__placeholder__'),
        async (shortVersion, datePart, others) => {
          const fullVersion = `${shortVersion}/${datePart}`;
          const matchEntry = makeEntry(fullVersion, 'match-id');

          // Build history with the known entry plus other entries
          const filteredOthers = others.filter(
            e => !e.version.startsWith(shortVersion + '/')
          );
          const versions = [...filteredOthers, matchEntry];

          Services.Templates.listVersions.mockResolvedValue({
            templateName: 'test-template',
            category: 'storage',
            versions
          });

          const result = await resolve(shortVersion, templateInfo);
          expect(result).toBe(fullVersion);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * When a version history does not contain any entry whose version starts
   * with the given Short_Version, resolve returns the original Short_Version
   * unchanged.
   */
  it('returns original Short_Version unchanged when no match exists in history', async () => {
    await fc.assert(
      fc.asyncProperty(
        shortVersionArb(),
        otherEntriesArb('__placeholder__'),
        async (shortVersion, others) => {
          // Ensure none of the other entries match the generated Short_Version
          const nonMatchingEntries = others.filter(
            e => !e.version.startsWith(shortVersion + '/')
          );

          Services.Templates.listVersions.mockResolvedValue({
            templateName: 'test-template',
            category: 'storage',
            versions: nonMatchingEntries
          });

          const result = await resolve(shortVersion, templateInfo);
          expect(result).toBe(shortVersion);
        }
      ),
      { numRuns: 100 }
    );
  });
});
