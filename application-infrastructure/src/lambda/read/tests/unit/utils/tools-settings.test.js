/**
 * Unit Tests for Settings Tools List
 *
 * Feature: add-tools-endpoint-which-lists-available-tools
 *
 * Verifies that settings.tools.availableToolsList is properly configured
 * with all required tool definitions including list_tools.
 *
 * Requirements: 1.1, 1.3, 1.4, 6.4
 */

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

const settings = require('../../../config/settings');

describe('settings.tools.availableToolsList', () => {

  test('is a non-empty array', () => {
    expect(Array.isArray(settings.tools.availableToolsList)).toBe(true);
    expect(settings.tools.availableToolsList.length).toBeGreaterThan(0);
  });

  test('contains a list_tools entry', () => {
    const listToolsEntry = settings.tools.availableToolsList.find(
      (tool) => tool.name === 'list_tools'
    );
    expect(listToolsEntry).toBeDefined();
  });

  test('every entry has name, description, and inputSchema properties', () => {
    for (const tool of settings.tools.availableToolsList) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
    }
  });
});
