/**
 * Property-Based Tests for Schema Validator Version Pattern Bug
 *
 * Bug Condition Exploration: Date-Suffixed Versions Rejected by Validation
 *
 * The validate() function in schema-validator.js uses the regex pattern
 * ^v\d+\.\d+\.\d+$ which rejects valid Human_Readable_Version strings
 * that include a /YYYY-MM-DD date suffix (e.g., v0.0.14/2025-08-08).
 *
 * This test encodes the EXPECTED (correct) behavior: date-suffixed versions
 * should be accepted. On unfixed code, these tests will FAIL, confirming
 * the bug exists.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3
 */

const fc = require('fast-check');
const { validate } = require('../../../utils/schema-validator');

/**
 * Generator for valid Human_Readable_Version strings: vX.Y.Z/YYYY-MM-DD
 *
 * @returns {fc.Arbitrary<string>} Arbitrary producing version strings
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

/* ------------------------------------------------------------------ */
/*  Property 1: Bug Condition — Date-Suffixed Versions Rejected       */
/*  Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3       */
/* ------------------------------------------------------------------ */

describe('Bug Condition: Date-Suffixed Versions Rejected by Validation', () => {

  /**
   * **Validates: Requirements 2.1**
   */
  it('Property 1a: get_template accepts date-suffixed version strings', () => {
    fc.assert(
      fc.property(
        humanReadableVersionArb(),
        (version) => {
          const result = validate('get_template', {
            templateName: 'vpc',
            category: 'network',
            version
          });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.2**
   *
   * list_templates no longer accepts version parameter.
   * Version filtering was removed; use list_template_versions instead.
   */
  it('Property 1b: list_templates rejects version as unknown property', () => {
    fc.assert(
      fc.property(
        humanReadableVersionArb(),
        (version) => {
          const result = validate('list_templates', { version });
          expect(result.valid).toBe(false);
          expect(result.errors).toContain('Unknown property: version');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   */
  it('Property 1c: check_template_updates accepts date-suffixed currentVersion strings', () => {
    fc.assert(
      fc.property(
        humanReadableVersionArb(),
        (version) => {
          const result = validate('check_template_updates', {
            templateName: 'vpc',
            category: 'network',
            currentVersion: version
          });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Concrete examples from the bug report
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   */
  it('Concrete: v0.0.14/2025-08-08 accepted by get_template', () => {
    const result = validate('get_template', {
      templateName: 'vpc',
      category: 'network',
      version: 'v0.0.14/2025-08-08'
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('Concrete: v1.2.3/2024-01-15 rejected by list_templates as unknown property', () => {
    const result = validate('list_templates', {
      version: 'v1.2.3/2024-01-15'
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown property: version');
  });

  it('Concrete: v1.2.3/2024-01-15 accepted by check_template_updates', () => {
    const result = validate('check_template_updates', {
      templateName: 'vpc',
      category: 'network',
      currentVersion: 'v1.2.3/2024-01-15'
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
