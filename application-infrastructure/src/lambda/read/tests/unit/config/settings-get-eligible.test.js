/**
 * Unit Tests for settings.tools.getGetEligibleTools()
 *
 * Feature: allow-get-on-tools-that-list
 *
 * Verifies that getGetEligibleTools() correctly derives GET-eligible tool names
 * from the availableToolsList based on the absence of required parameters.
 *
 * Requirements: 1.4, 1.5, 7.1
 */

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

const settings = require('../../../config/settings');

describe('settings.tools.getGetEligibleTools()', () => {

  test('returns an array', () => {
    const result = settings.tools.getGetEligibleTools();
    expect(Array.isArray(result)).toBe(true);
  });

  test('includes tools with no required parameters: list_tools, list_templates, list_categories, list_starters', () => {
    const eligible = settings.tools.getGetEligibleTools();
    expect(eligible).toContain('list_tools');
    expect(eligible).toContain('list_templates');
    expect(eligible).toContain('list_categories');
    expect(eligible).toContain('list_starters');
  });

  test('excludes tools with required parameters: get_template, list_template_versions, get_starter_info, search_documentation, validate_naming, check_template_updates', () => {
    const eligible = settings.tools.getGetEligibleTools();
    expect(eligible).not.toContain('get_template');
    expect(eligible).not.toContain('list_template_versions');
    expect(eligible).not.toContain('get_starter_info');
    expect(eligible).not.toContain('search_documentation');
    expect(eligible).not.toContain('validate_naming');
    expect(eligible).not.toContain('check_template_updates');
  });

  test('returns empty array when all tools have required parameters', () => {
    // Save original list
    const originalList = settings.tools.availableToolsList;

    // Replace with tools that all have required parameters
    settings.tools.availableToolsList = [
      {
        name: 'tool_a',
        description: 'Tool A',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
      },
      {
        name: 'tool_b',
        description: 'Tool B',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
      }
    ];

    const eligible = settings.tools.getGetEligibleTools();
    expect(eligible).toEqual([]);

    // Restore original list
    settings.tools.availableToolsList = originalList;
  });
});
