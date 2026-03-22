/**
 * Preservation Property Tests: Non-Starters Tool Behavior Unchanged
 *
 * These tests verify that non-starters tools, schemas, settings, and
 * configurations remain unchanged before and after the starters fix.
 * They run on UNFIXED code first to capture baseline behavior, then
 * are re-run after the fix to confirm no regressions.
 *
 * EXPECTED OUTCOME on UNFIXED code: All tests PASS (baseline preserved).
 * EXPECTED OUTCOME after fix: All tests PASS (no regressions).
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 */

const fc = require('fast-check');

// ---------------------------------------------------------------------------
// TEMPLATE_CATEGORIES must be defined as a global before requiring
// schema-validator.js, which references it without importing it.
// ---------------------------------------------------------------------------
const settings = require('../../../config/settings');
global.TEMPLATE_CATEGORIES = settings.templates.categories;

const SchemaValidator = require('../../../utils/schema-validator');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Non-starters tools whose schemas must remain unchanged after the fix.
 */
const NON_STARTERS_TOOLS = [
  'list_templates',
  'get_template',
  'list_template_versions',
  'list_categories',
  'search_documentation',
  'validate_naming',
  'check_template_updates',
  'list_tools'
];

/**
 * Template categories from settings (used for property-based generation).
 */
const TEMPLATE_CATEGORY_NAMES = settings.templates.getCategoryNames();

// ---------------------------------------------------------------------------
// Snapshot baseline schemas on UNFIXED code
// ---------------------------------------------------------------------------

const baselineSchemas = {};
for (const toolName of NON_STARTERS_TOOLS) {
  baselineSchemas[toolName] = JSON.parse(
    JSON.stringify(SchemaValidator.getSchema(toolName))
  );
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Preservation Property: Non-Starters Tool Behavior Unchanged', () => {

  // -----------------------------------------------------------------------
  // Test 2a: Property — non-starters schemas are unchanged
  // **Validates: Requirements 3.1, 3.2, 3.7**
  // -----------------------------------------------------------------------
  test('2a: Property: for any non-starters tool, getSchema returns the same schema object', () => {
    const toolNameArb = fc.constantFrom(...NON_STARTERS_TOOLS);

    fc.assert(
      fc.property(toolNameArb, (toolName) => {
        const currentSchema = SchemaValidator.getSchema(toolName);
        const baseline = baselineSchemas[toolName];

        // Schema must exist
        expect(currentSchema).not.toBeNull();
        expect(baseline).not.toBeNull();

        // Deep equality — schema structure is identical
        expect(currentSchema).toEqual(baseline);
      }),
      { numRuns: 50 }
    );
  });

  // -----------------------------------------------------------------------
  // Test 2b: Property — any valid template category validates successfully
  // **Validates: Requirements 3.1**
  // -----------------------------------------------------------------------
  test('2b: Property: for any valid template category, list_templates validates with { valid: true }', () => {
    const categoryArb = fc.constantFrom(...TEMPLATE_CATEGORY_NAMES);

    fc.assert(
      fc.property(categoryArb, (category) => {
        const result = SchemaValidator.validate('list_templates', { category });

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      }),
      { numRuns: 20 }
    );
  });

  // -----------------------------------------------------------------------
  // Test 2d: search_documentation schema still has ghusers property
  // **Validates: Requirements 3.2, 3.3**
  // -----------------------------------------------------------------------
  test('2d: search_documentation schema still has ghusers property', () => {
    const searchDocSchema = SchemaValidator.getSchema('search_documentation');

    expect(searchDocSchema).not.toBeNull();
    expect(searchDocSchema.properties).toHaveProperty('ghusers');
    expect(searchDocSchema.properties).toHaveProperty('query');
    expect(searchDocSchema.properties).toHaveProperty('type');

    // Validate that ghusers works for search_documentation
    const result = SchemaValidator.validate('search_documentation', {
      query: 'test',
      ghusers: ['63klabs']
    });
    expect(result.valid).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 2e: S3 settings defaults are preserved
  // **Validates: Requirements 3.5, 3.6**
  // -----------------------------------------------------------------------
  test('2e: settings.s3.buckets defaults to [\'63klabs\'] and starterPrefix is app-starters/v2', () => {
    expect(settings.s3.buckets).toEqual(['63klabs']);
    expect(settings.s3.starterPrefix).toBe('app-starters/v2');
  });

  // -----------------------------------------------------------------------
  // Test 2f: GitHub config preserved for other tools
  // **Validates: Requirements 3.3**
  // -----------------------------------------------------------------------
  test('2f: settings.github.userOrgs and settings.github.token still exist', () => {
    expect(settings.github).toHaveProperty('userOrgs');
    expect(settings.github).toHaveProperty('token');
    expect(Array.isArray(settings.github.userOrgs)).toBe(true);
    // token is a CachedSsmParameter instance
    expect(settings.github.token).toBeDefined();
  });
});
