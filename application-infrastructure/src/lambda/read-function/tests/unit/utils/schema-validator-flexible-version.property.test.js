/**
 * Property-Based Tests for Schema Validator Flexible Version
 *
 * Feature: flexible-version-lookup
 * Property 4: Schema accepts any non-empty string for currentVersion
 *
 * For any non-empty string value, `SchemaValidator.validate('check_template_updates',
 * { templateName: 'test-template', currentVersion: value })` shall not produce a
 * pattern-related validation error for `currentVersion`. For any empty string,
 * validation shall reject it (minLength: 1 constraint).
 *
 * Validates: Requirements 4.1, 4.2, 4.3
 */

const fc = require('fast-check');
const { validate } = require('../../../utils/schema-validator');

/* ------------------------------------------------------------------ */
/*  Property 4: Schema accepts any non-empty string for currentVersion */
/*  Validates: Requirements 4.1, 4.2, 4.3                             */
/* ------------------------------------------------------------------ */

describe('Feature: flexible-version-lookup, Property 4: Schema accepts any non-empty string for currentVersion', () => {

  /**
   * **Validates: Requirements 4.1, 4.2, 4.3**
   *
   * Any non-empty string passed as currentVersion with a valid templateName
   * should produce a valid result with no errors.
   */
  it('accepts any non-empty string as currentVersion without pattern errors', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (currentVersion) => {
          const result = validate('check_template_updates', {
            templateName: 'test-template',
            currentVersion
          });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * Empty strings must be rejected due to the minLength: 1 constraint.
   */
  it('rejects empty string as currentVersion', () => {
    fc.assert(
      fc.property(
        fc.constant(''),
        (currentVersion) => {
          const result = validate('check_template_updates', {
            templateName: 'test-template',
            currentVersion
          });
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors.some(e => e.includes('at least 1 character'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
