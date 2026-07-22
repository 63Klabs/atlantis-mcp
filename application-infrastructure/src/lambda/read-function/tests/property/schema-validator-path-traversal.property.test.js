/**
 * Property-Based Tests for Path Traversal Rejection in Schema Validator
 *
 * Feature: modules-nested-directory-support, Property 7: Path traversal rejection
 *
 * For any string containing a forward slash (`/`) or backslash (`\`),
 * the Schema Validator SHALL reject it as an invalid `templateName`
 * with a validation error.
 *
 * Validates: Requirements 8.2
 */

const fc = require('fast-check');
const { validate } = require('../../utils/schema-validator');

/** Tools that have a templateName property with the path traversal pattern */
const TOOLS_WITH_TEMPLATE_NAME = [
  'get_template',
  'list_template_versions',
  'check_template_updates',
  'get_template_chunk'
];

/**
 * Arbitrary that generates strings guaranteed to contain at least one
 * forward slash or backslash (path separator characters).
 */
const pathTraversalNameArb = fc.tuple(
  fc.string({ minLength: 0, maxLength: 20 }),
  fc.constantFrom('/', '\\'),
  fc.string({ minLength: 0, maxLength: 20 })
).map(([prefix, sep, suffix]) => `${prefix}${sep}${suffix}`)
  .filter(s => s.length >= 1);

/**
 * Arbitrary that generates valid template names: non-empty strings
 * containing only alphanumeric characters, hyphens, dots, and underscores
 * (no path separators).
 */
const validTemplateNameArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz0123456789-._'.split('')
  ),
  { minLength: 1, maxLength: 60 }
);

/**
 * Build minimal valid input for a given tool, using the provided templateName.
 *
 * @param {string} toolName - MCP tool name
 * @param {string} templateName - Template name to validate
 * @returns {Object} Minimal valid input object
 */
function buildInput(toolName, templateName) {
  const base = { templateName };

  if (toolName === 'check_template_updates') {
    base.currentVersion = 'v1.0.0';
  }

  if (toolName === 'get_template_chunk') {
    base.category = 'storage';
    base.chunkIndex = 0;
  }

  return base;
}

describe('Feature: modules-nested-directory-support, Property 7: Path traversal rejection', () => {

  /**
   * **Validates: Requirements 8.2**
   *
   * Any templateName containing `/` or `\` must be rejected by the
   * schema validator across all tools that accept templateName.
   */
  test('templateName containing path separators is rejected for all tools', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOOLS_WITH_TEMPLATE_NAME),
        pathTraversalNameArb,
        (toolName, badName) => {
          const input = buildInput(toolName, badName);
          const result = validate(toolName, input);

          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);

          const hasPatternError = result.errors.some(
            err => err.includes('templateName') && err.includes('pattern')
          );
          expect(hasPatternError).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * Valid template names (alphanumeric, hyphens, dots, underscores)
   * must pass validation for all tools that accept templateName.
   */
  test('valid templateName without path separators passes validation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TOOLS_WITH_TEMPLATE_NAME),
        validTemplateNameArb,
        (toolName, goodName) => {
          const input = buildInput(toolName, goodName);
          const result = validate(toolName, input);

          // Should not have a pattern error for templateName
          const hasPatternError = result.errors.some(
            err => err.includes('templateName') && err.includes('pattern')
          );
          expect(hasPatternError).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * Specific path traversal attack patterns must be rejected.
   */
  test('common path traversal attack patterns are rejected', () => {
    const attackPatterns = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32',
      'template/../secret',
      'template/../../etc/shadow',
      'foo\\bar',
      'modules/vpc/template',
      '.\\template'
    ];

    for (const toolName of TOOLS_WITH_TEMPLATE_NAME) {
      for (const attackName of attackPatterns) {
        const input = buildInput(toolName, attackName);
        const result = validate(toolName, input);

        expect(result.valid).toBe(false);
        expect(
          result.errors.some(err => err.includes('templateName') && err.includes('pattern'))
        ).toBe(true);
      }
    }
  });
});
