/**
 * Tools Controller
 *
 * Handles MCP tool requests for tool discovery.
 * Returns the list of available tools with descriptions and input schemas.
 *
 * Supported operations:
 * - list() - List all available MCP tools
 *
 * @module controllers/tools
 */

const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');
const settings = require('../config/settings');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { extendedDescriptions } = require('../config/tool-descriptions');

/**
 * List all available MCP tools
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.bodyParameters - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with tool list
 *
 * @example
 * const response = await Tools.list({
 *   bodyParameters: { input: {} }
 * });
 */
async function list(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('list_tools', input);

    if (!validation.valid) {
      DebugAndLog.warn('list_tools validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'list_tools');
    }

    DebugAndLog.info('list_tools request');

    const tools = settings.tools.availableToolsList;

    // Merge extended descriptions at response time
    const mergedTools = tools.map(tool => {
      const extended = extendedDescriptions[tool.name];
      if (extended) {
        return { ...tool, description: extended };
      }
      return tool;
    });

    DebugAndLog.info('list_tools response', {
      toolCount: mergedTools.length
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('list_tools', { tools: mergedTools });

  } catch (error) {
    DebugAndLog.error('list_tools error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to list tools',
      error: error.message
    }, 'list_tools');
  }
}

module.exports = {
  list
};
