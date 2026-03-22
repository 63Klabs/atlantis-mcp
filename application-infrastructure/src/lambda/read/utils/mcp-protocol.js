/**
 * MCP Protocol Utilities
 *
 * Provides utilities for implementing the Model Context Protocol (MCP) v1.0 specification.
 * Includes functions for creating protocol-compliant responses, error handling, protocol
 * negotiation, and capability discovery.
 *
 * @module mcp-protocol
 */

const settings = require('../config/settings');

/**
 * MCP Protocol Version
 * @constant {string}
 */
const MCP_VERSION = '1.0';

// --- JSON-RPC 2.0 Constants and Formatters ---

/**
 * Standard JSON-RPC 2.0 error codes
 * @constant {Object}
 */
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};

/**
 * Create a JSON-RPC 2.0 success response
 *
 * @param {string|number|null} id - Request id (null if missing or invalid type)
 * @param {*} result - Response result payload
 * @returns {Object} JSON-RPC 2.0 success response
 */
function jsonRpcSuccess(id, result) {
  return {
    jsonrpc: '2.0',
    id: id,
    result: result
  };
}

/**
 * Create a JSON-RPC 2.0 error response
 *
 * @param {string|number|null} id - Request id (null if missing or invalid type)
 * @param {number} code - Integer error code
 * @param {string} message - Short error description
 * @param {*} [data] - Optional additional error data
 * @returns {Object} JSON-RPC 2.0 error response
 */
function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return {
    jsonrpc: '2.0',
    id: id,
    error: error
  };
}

/**
 * Create a JSON-RPC 2.0 initialize response with server info and capabilities
 *
 * @param {string|number|null} id - Request id
 * @returns {Object} JSON-RPC 2.0 response with serverInfo, capabilities, protocolVersion
 */
function initializeResponse(id) {
  return jsonRpcSuccess(id, {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: { listChanged: false }
    },
    serverInfo: {
      name: 'atlantis-mcp-server',
      version: '0.0.1'
    }
  });
}

/**
 * Create a JSON-RPC 2.0 tools/list response
 *
 * @param {string|number|null} id - Request id
 * @param {Array<Object>} tools - Array of tool definitions
 * @returns {Object} JSON-RPC 2.0 response with tools array in result
 */
function toolsListResponse(id, tools) {
  return jsonRpcSuccess(id, { tools: tools });
}

/**
 * MCP Protocol Capabilities
 * @constant {Object}
 */
const MCP_CAPABILITIES = {
  tools: true,
  resources: false,
  prompts: false,
  sampling: false
};

/**
 * MCP Tool Definitions — imported from the centralized settings module.
 * This is the single source of truth for tool metadata, defined in config/settings.js.
 * @constant {Array<ToolDefinition>}
 * @see module:config/settings
 */
const MCP_TOOLS = settings.tools.availableToolsList;

/**
 * Create a successful MCP protocol response
 *
 * @param {string} toolName - Name of the MCP tool that was invoked
 * @param {*} data - Response data (will be serialized to JSON)
 * @returns {Object} MCP-compliant success response
 * @example
 * const response = successResponse('list_templates', [
 *   { name: 'template-storage-s3.yml', version: 'v1.2.3/2024-01-15' }
 * ]);
 */
function successResponse(toolName, data) {
  return {
    protocol: 'mcp',
    version: MCP_VERSION,
    tool: toolName,
    success: true,
    data: data,
    timestamp: new Date().toISOString()
  };
}

/**
 * Create an error MCP protocol response
 *
 * @param {string} errorCode - Error code (e.g., 'INVALID_INPUT', 'TEMPLATE_NOT_FOUND')
 * @param {string|Object} errorDetails - Error message or detailed error object
 * @param {string} [toolName] - Name of the MCP tool that was invoked (optional)
 * @returns {Object} MCP-compliant error response
 * @example
 * const response = errorResponse('TEMPLATE_NOT_FOUND', {
 *   message: 'Template not found: template-storage-s3.yml',
 *   availableTemplates: ['template-storage-s3-v2.yml', 'template-network.yml']
 * }, 'get_template');
 */
function errorResponse(errorCode, errorDetails, toolName = null) {
  const response = {
    protocol: 'mcp',
    version: MCP_VERSION,
    success: false,
    error: {
      code: errorCode,
      details: typeof errorDetails === 'string' ? { message: errorDetails } : errorDetails
    },
    timestamp: new Date().toISOString()
  };

  if (toolName) {
    response.tool = toolName;
  }

  return response;
}

/**
 * Negotiate MCP protocol version with client
 *
 * @param {string} clientVersion - Version requested by client
 * @returns {Object} Protocol negotiation response
 * @example
 * const negotiation = negotiateProtocol('1.0');
 * // Returns: { accepted: true, version: '1.0', capabilities: {...} }
 */
function negotiateProtocol(clientVersion) {
  // Currently only support version 1.0
  const supportedVersions = ['1.0'];
  const accepted = supportedVersions.includes(clientVersion);

  return {
    protocol: 'mcp',
    accepted: accepted,
    version: accepted ? clientVersion : MCP_VERSION,
    supportedVersions: supportedVersions,
    capabilities: accepted ? MCP_CAPABILITIES : null,
    message: accepted
      ? `Protocol version ${clientVersion} accepted`
      : `Protocol version ${clientVersion} not supported. Supported versions: ${supportedVersions.join(', ')}`
  };
}

/**
 * Get MCP server capabilities
 *
 * @returns {Object} Server capabilities and available tools
 * @example
 * const capabilities = getCapabilities();
 * // Returns: { protocol: 'mcp', version: '1.0', capabilities: {...}, tools: [...] }
 */
function getCapabilities() {
  return {
    protocol: 'mcp',
    version: MCP_VERSION,
    capabilities: MCP_CAPABILITIES,
    tools: MCP_TOOLS,
    description: 'Atlantis MCP Server - Phase 1 (Core Read-Only)',
    vendor: '63Klabs',
    serverInfo: {
      name: 'atlantis-mcp-server',
      version: '0.0.1',
      phase: 'Phase 1 - Read-Only Operations'
    }
  };
}

/**
 * Get list of available MCP tools
 *
 * @returns {Array<Object>} Array of tool definitions with names, descriptions, and input schemas
 * @example
 * const tools = listTools();
 * // Returns: [{ name: 'list_templates', description: '...', inputSchema: {...} }, ...]
 */
function listTools() {
  return MCP_TOOLS;
}

/**
 * Get definition for a specific MCP tool
 *
 * @param {string} toolName - Name of the tool
 * @returns {Object|null} Tool definition or null if not found
 * @example
 * const tool = getTool('list_templates');
 * // Returns: { name: 'list_templates', description: '...', inputSchema: {...} }
 */
function getTool(toolName) {
  return MCP_TOOLS.find(tool => tool.name === toolName) || null;
}

/**
 * Validate that a tool name is supported
 *
 * @param {string} toolName - Name of the tool to validate
 * @returns {boolean} True if tool is supported, false otherwise
 * @example
 * if (isValidTool('list_templates')) {
 *   // Process tool invocation
 * }
 */
function isValidTool(toolName) {
  return MCP_TOOLS.some(tool => tool.name === toolName);
}

module.exports = {
  // Constants
  MCP_VERSION,
  MCP_CAPABILITIES,
  MCP_TOOLS,
  JSON_RPC_ERRORS,

  // JSON-RPC 2.0 response formatters
  jsonRpcSuccess,
  jsonRpcError,
  initializeResponse,
  toolsListResponse,

  // Legacy response functions (backward compatibility)
  successResponse,
  errorResponse,

  // Protocol negotiation
  negotiateProtocol,

  // Capability discovery
  getCapabilities,
  listTools,
  getTool,
  isValidTool
};
