/**
 * Property-Based Tests for MCP Protocol passthrough and isValidTool consistency
 *
 * Feature: add-tools-endpoint-which-lists-available-tools
 *
 * Property 2: MCP Protocol passthrough from Settings
 * Property 3: isValidTool consistency with Available_Tools_List
 *
 * Validates: Requirements 1.2, 2.2, 2.3, 2.4
 */

const fc = require('fast-check');

// Set required env var before loading modules
process.env.PARAM_STORE_PATH = '/test/';

const settings = require('../../../config/settings');
const MCPProtocol = require('../../../utils/mcp-protocol');

describe('Feature: add-tools-endpoint-which-lists-available-tools, Property 2: MCP Protocol passthrough from Settings', () => {

  const availableToolsList = settings.tools.availableToolsList;

  /**
   * **Validates: Requirements 1.2, 2.2, 2.3**
   *
   * For any Available_Tools_List content in Settings, calling MCPProtocol.listTools()
   * must return exactly that list, and calling MCPProtocol.getCapabilities().tools
   * must return exactly that list.
   */
  test('listTools() returns exactly settings.tools.availableToolsList (reference identity)', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const tools = MCPProtocol.listTools();
          expect(tools).toBe(availableToolsList);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('getCapabilities().tools returns exactly settings.tools.availableToolsList (reference identity)', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const capabilities = MCPProtocol.getCapabilities();
          expect(capabilities.tools).toBe(availableToolsList);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: add-tools-endpoint-which-lists-available-tools, Property 3: isValidTool consistency with Available_Tools_List', () => {

  const availableToolsList = settings.tools.availableToolsList;
  const toolNames = availableToolsList.map(t => t.name);

  /**
   * **Validates: Requirements 2.4**
   *
   * For any string toolName, MCPProtocol.isValidTool(toolName) must return true
   * if and only if toolName appears as the name property of some entry in Available_Tools_List.
   */
  test('isValidTool(name) returns true iff name is in availableToolsList (random strings)', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (name) => {
          const result = MCPProtocol.isValidTool(name);
          const expected = toolNames.includes(name);
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('isValidTool(name) returns true for known tool names (constantFrom)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...toolNames),
        (name) => {
          expect(MCPProtocol.isValidTool(name)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
