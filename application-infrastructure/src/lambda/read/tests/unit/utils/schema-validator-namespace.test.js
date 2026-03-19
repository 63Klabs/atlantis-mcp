/**
 * Unit Tests for Schema Validator Namespace Parameter
 *
 * Feature: add-namespace-filter-to-list-templates
 * Tests specific invalid inputs, valid namespace values, and verifies
 * list_categories schema does NOT accept namespace.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 6.1, 6.2, 6.3, 6.4, 6.5
 */

const { validate, getSchema } = require('../../../utils/schema-validator');

const TOOLS_WITH_NAMESPACE = [
  'list_templates',
  'get_template',
  'list_template_versions',
  'check_template_updates'
];

/**
 * Build a minimal valid input object for a given tool.
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

describe('Schema Validator - Namespace Parameter', () => {

  describe('namespace property exists in affected schemas (Req 1.1-1.4)', () => {
    test.each(TOOLS_WITH_NAMESPACE)(
      '%s schema includes namespace property',
      (toolName) => {
        const schema = getSchema(toolName);
        expect(schema.properties).toHaveProperty('namespace');
        expect(schema.properties.namespace.type).toBe('string');
        expect(schema.properties.namespace.pattern).toBe('^[a-z0-9][a-z0-9-]*$');
        expect(schema.properties.namespace.maxLength).toBe(63);
      }
    );

    test.each(TOOLS_WITH_NAMESPACE)(
      '%s schema does NOT require namespace',
      (toolName) => {
        const schema = getSchema(toolName);
        const required = schema.required || [];
        expect(required).not.toContain('namespace');
      }
    );
  });

  describe('list_categories does NOT accept namespace (Req 1.5)', () => {
    test('list_categories schema has no namespace property', () => {
      const schema = getSchema('list_categories');
      expect(schema.properties).not.toHaveProperty('namespace');
    });

    test('list_categories rejects namespace as unknown property', () => {
      const result = validate('list_categories', { namespace: 'atlantis' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown property'))).toBe(true);
    });
  });

  describe('valid namespace values are accepted (Req 1.8)', () => {
    const validNamespaces = ['atlantis', 'acme', 'turbo-kiln', 'x1'];

    test.each(TOOLS_WITH_NAMESPACE)(
      '%s accepts valid namespace values',
      (toolName) => {
        validNamespaces.forEach((ns) => {
          const input = { ...buildValidInput(toolName), namespace: ns };
          const result = validate(toolName, input);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        });
      }
    );
  });

  describe('invalid namespace values are rejected', () => {
    test.each(TOOLS_WITH_NAMESPACE)(
      '%s rejects uppercase namespace (Req 6.1)',
      (toolName) => {
        const input = { ...buildValidInput(toolName), namespace: 'Acme' };
        const result = validate(toolName, input);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('pattern'))).toBe(true);
      }
    );

    test.each(TOOLS_WITH_NAMESPACE)(
      '%s rejects namespace with spaces (Req 6.2)',
      (toolName) => {
        const input = { ...buildValidInput(toolName), namespace: 'giga hut' };
        const result = validate(toolName, input);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('pattern'))).toBe(true);
      }
    );

    test.each(TOOLS_WITH_NAMESPACE)(
      '%s rejects namespace with slashes (Req 6.3)',
      (toolName) => {
        const input = { ...buildValidInput(toolName), namespace: 'acme/co' };
        const result = validate(toolName, input);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('pattern'))).toBe(true);
      }
    );

    test.each(TOOLS_WITH_NAMESPACE)(
      '%s rejects namespace starting with hyphen (Req 6.4)',
      (toolName) => {
        const input = { ...buildValidInput(toolName), namespace: '-start' };
        const result = validate(toolName, input);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('pattern'))).toBe(true);
      }
    );

    test.each(TOOLS_WITH_NAMESPACE)(
      '%s rejects empty string namespace (Req 6.5)',
      (toolName) => {
        const input = { ...buildValidInput(toolName), namespace: '' };
        const result = validate(toolName, input);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }
    );

    test.each(TOOLS_WITH_NAMESPACE)(
      '%s rejects namespace exceeding 63 characters (Req 1.7)',
      (toolName) => {
        const longNamespace = 'a'.repeat(64);
        const input = { ...buildValidInput(toolName), namespace: longNamespace };
        const result = validate(toolName, input);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('at most 63 characters'))).toBe(true);
      }
    );
  });

  describe('omitted namespace passes validation (Req 1.8)', () => {
    test.each(TOOLS_WITH_NAMESPACE)(
      '%s accepts input without namespace',
      (toolName) => {
        const input = buildValidInput(toolName);
        const result = validate(toolName, input);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      }
    );
  });
});
