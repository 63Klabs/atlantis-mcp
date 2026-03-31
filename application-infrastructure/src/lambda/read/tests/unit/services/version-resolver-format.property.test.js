/**
 * Property-Based Tests for Version Resolver Format Detection
 *
 * Feature: flexible-version-lookup
 * Property 1: Format detection is a total partition
 *
 * For any non-empty string, `detectFormat` returns exactly one of
 * HUMAN_READABLE_VERSION, SHORT_VERSION, or S3_VERSION_ID. Specifically:
 * - Strings matching vX.Y.Z/YYYY-MM-DD → HUMAN_READABLE_VERSION
 * - Strings matching vX.Y.Z (without date) → SHORT_VERSION
 * - All other non-empty strings → S3_VERSION_ID
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4
 */

const fc = require('fast-check');
const {
  detectFormat,
  HUMAN_READABLE_VERSION,
  SHORT_VERSION,
  S3_VERSION_ID
} = require('../../../services/version-resolver');

/** All valid format constants returned by detectFormat */
const VALID_FORMATS = [HUMAN_READABLE_VERSION, SHORT_VERSION, S3_VERSION_ID];

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
 * Generator for strings that do not match Human_Readable_Version or Short_Version patterns.
 * Produces strings that don't start with 'v' or are random alphanumeric strings.
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing S3_VERSION_ID-like strings
 */
function s3VersionIdArb() {
  return fc.oneof(
    // Strings not starting with 'v'
    fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-'.split('')),
      { minLength: 1, maxLength: 50 }
    ).filter(s => !s.startsWith('v')),
    // Random alphanumeric strings (typical S3 version IDs)
    fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.'.split('')),
      { minLength: 8, maxLength: 40 }
    ).filter(s => !/^v\d+\.\d+\.\d+(\/\d{4}-\d{2}-\d{2})?$/.test(s))
  );
}

/* ------------------------------------------------------------------ */
/*  Property 1: Format detection is a total partition                 */
/*  Validates: Requirements 1.1, 1.2, 1.3, 1.4                       */
/* ------------------------------------------------------------------ */

describe('Feature: flexible-version-lookup, Property 1: Format detection is a total partition', () => {

  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   *
   * For any non-empty string, detectFormat returns exactly one of the three format constants.
   */
  it('detectFormat returns exactly one of three formats for any non-empty string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (input) => {
          const result = detectFormat(input);
          expect(VALID_FORMATS).toContain(result);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1**
   *
   * Valid vX.Y.Z/YYYY-MM-DD strings are classified as HUMAN_READABLE_VERSION.
   */
  it('classifies valid vX.Y.Z/YYYY-MM-DD strings as HUMAN_READABLE_VERSION', () => {
    fc.assert(
      fc.property(
        humanReadableVersionArb(),
        (version) => {
          expect(detectFormat(version)).toBe(HUMAN_READABLE_VERSION);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Valid vX.Y.Z strings (without date) are classified as SHORT_VERSION.
   */
  it('classifies valid vX.Y.Z strings as SHORT_VERSION', () => {
    fc.assert(
      fc.property(
        shortVersionArb(),
        (version) => {
          expect(detectFormat(version)).toBe(SHORT_VERSION);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * Strings not matching either version pattern are classified as S3_VERSION_ID.
   */
  it('classifies non-matching strings as S3_VERSION_ID', () => {
    fc.assert(
      fc.property(
        s3VersionIdArb(),
        (input) => {
          expect(detectFormat(input)).toBe(S3_VERSION_ID);
        }
      ),
      { numRuns: 100 }
    );
  });
});
