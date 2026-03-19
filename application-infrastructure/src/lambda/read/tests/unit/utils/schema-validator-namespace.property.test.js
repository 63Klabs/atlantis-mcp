/**
 * Property-Based Tests for Schema Validator Namespace Parameter
 *
 * Feature: add-namespace-filter-to-list-templates
 * Validates correctness properties for the optional namespace parameter
 * added to list_templates, get_template, list_template_versions,
 * and check_template_updates schemas.
 */

const fc = require('fast-check');
const { validate } = require('../../../utils/schema-validator');

const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_NAMESPACE_LENGTH = 63;

const TOOLS_WITH_NAMESPACE = [
  'list_templates',
  'get_template',
  'list_template_versions',
  'check_template_updates'
];

/**
 * Build a minimal valid input object for a given tool (without namespace).
 *
 * @param {string} toolName - MCP tool name
 * @returns {Object} Minimal valid input
 */
function buildValidInput(toolName) {
  switch (toolName) {
    case 'list_templates':
      return {};
    case 'get_template':
      return { templateName: 'template.yml' };
    case 'list_template_versions':
      return { templateName: 'template.yml' };
    case 'check_template_updates':
      return { templateName: 'template.yml', currentVersion: 'v1.0.0' };
    default:
      return {};
  }
}

/* ------------------------------------------------------------------ */
/*  Property 1: Invalid namespace values are rejected by validation   */
/*  Validates: Requirements 1.6, 1.7, 6.1, 6.2, 6.3, 6.4, 6.5       */
/* ------------------------------------------------------------------ */

describe('Feature: add-namespace-filter-to-list-templates, Property 1: Invalid namespace values are rejected by validation', () => {

  /**
   * Arbitrary that generates strings NOT matching the namespace pattern.
   * Includes: uppercase, spaces, slashes, leading hyphens, empty strings,
   * and strings exceeding 63 characters.
   */
  const invalidNamespaceArb = fc.oneof(
    // Strings with uppercase characters
    fc.string({ minLength: 1, maxLength: 20 })
      .filter(s => /[A-Z]/.test(s)),
    // Strings with spaces
    fc.tuple(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ minLength: 1, maxLength: 10 }))
      .map(([a, b]) => `${a} ${b}`),
    // Strings with slashes
    fc.tuple(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ minLength: 1, maxLength: 10 }))
      .map(([a, b]) => `${a}/${b}`),
    // Strings starting with a hyphen
    fc.string({ minLength: 0, maxLength: 20 })
      .map(s => `-${s}`),
    // Empty string
    fc.constant(''),
    // Strings exceeding 63 characters (valid chars but too long)
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), { minLength: 64, maxLength: 128 })
      .map(s => s.startsWith('-') ? `a${s.slice(1)}` : s)
  );

  test.each(TOOLS_WITH_NAMESPACE)(
    'rejects invalid namespace values for %s',
    (toolName) => {
      fc.assert(
        fc.property(
          invalidNamespaceArb,
          (invalidNamespace) => {
            const input = { ...buildValidInput(toolName), namespace: invalidNamespace };
            const result = validate(toolName, input);

            // Must be rejected: either doesn't match pattern or exceeds maxLength
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});

/* ------------------------------------------------------------------ */
/*  Property 2: Valid inputs without namespace continue to pass       */
/*  validation                                                        */
/*  Validates: Requirements 1.8, 5.1, 5.2                             */
/* ------------------------------------------------------------------ */

describe('Feature: add-namespace-filter-to-list-templates, Property 2: Valid inputs without namespace continue to pass validation', () => {

  /**
   * Arbitrary that generates valid input objects without namespace
   * for each of the four affected tools.
   */
  const validCategoryArb = fc.constantFrom('storage', 'network', 'pipeline', 'service-role', 'modules');
  const validVersionArb = fc.tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 })
  ).map(([a, b, c]) => `v${a}.${b}.${c}`);
  const validTemplateNameArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-.'.split('')),
    { minLength: 1, maxLength: 30 }
  ).map(s => `${s}.yml`);

  test('list_templates: valid inputs without namespace pass validation', () => {
    fc.assert(
      fc.property(
        fc.record({
          category: validCategoryArb
        }),
        (input) => {
          const result = validate('list_templates', input);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('get_template: valid inputs without namespace pass validation', () => {
    fc.assert(
      fc.property(
        fc.record({
          templateName: validTemplateNameArb,
          category: validCategoryArb
        }),
        (input) => {
          const result = validate('get_template', input);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('list_template_versions: valid inputs without namespace pass validation', () => {
    fc.assert(
      fc.property(
        fc.record({
          templateName: validTemplateNameArb,
          category: validCategoryArb
        }),
        (input) => {
          const result = validate('list_template_versions', input);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('check_template_updates: valid inputs without namespace pass validation', () => {
    fc.assert(
      fc.property(
        fc.record({
          templateName: validTemplateNameArb,
          currentVersion: validVersionArb,
          category: validCategoryArb
        }),
        (input) => {
          const result = validate('check_template_updates', input);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });
});
