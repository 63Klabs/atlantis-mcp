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
const { buildInstructions } = require('../config/server-instructions');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Get the release version from the generated config file, with fallback to package.json.
 * 
 * The release version is generated at build time from CHANGELOG.md and written to
 * config/release-version.js. This ensures the deployed version matches the actual
 * release version. If the file is missing (e.g., during local development), falls
 * back to package.json version and logs an INFO-level event.
 * 
 * @returns {string} Release version string (e.g., '0.0.7')
 * @private
 */
function getReleaseVersion() {
  try {
    const { releaseVersion } = require('../config/release-version.js');
    return releaseVersion;
  } catch (error) {
    const { version } = require('../package.json');
    DebugAndLog.info('release_version_fallback', { version, reason: 'config/release-version.js not found' });
    return version;
  }
}

const SERVER_VERSION = getReleaseVersion();

/**
 * MCP Protocol Version
 * @constant {string}
 */
const MCP_VERSION = '1.0';

// --- MCP Protocol Revision Constants (Single Source of Truth) ---

/**
 * Legacy MCP protocol revision (oldest supported).
 * This is the baseline revision from the original MCP specification.
 * @constant {string}
 */
const LEGACY_REVISION = '2024-11-05';

/**
 * Modern MCP protocol revision (newest supported).
 * This is the current revision that introduces stateless operation.
 * @constant {string}
 */
const MODERN_REVISION = '2025-11-25';

/**
 * Array of all allowed MCP protocol revisions, ordered from oldest to newest.
 * This is the single source of truth for supported revisions.
 * All callers MUST read from this constant; no prose strings outside this module.
 * 
 * Requirements: 3.1, 3.2
 * 
 * @constant {ReadonlyArray<string>}
 */
const ALLOWED_REVISIONS = Object.freeze([LEGACY_REVISION, MODERN_REVISION]);

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
  INTERNAL_ERROR: -32603,
  
  // MCP protocol-specific error codes (Requirements 7.1, 7.2, 7.3)
  HEADER_MISMATCH: -32020,                      // When modern headers are inconsistent or missing
  MISSING_REQUIRED_CLIENT_CAPABILITY: -32021,   // When client lacks a required capability
  UNSUPPORTED_PROTOCOL_VERSION: -32022          // When client declares unsupported revision
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
 * Legacy MCP protocol revisions supported by this server.
 * These revisions use the handshake-based (initialize) model.
 * 
 * Requirements: 3.1, 4.1
 * 
 * @constant {ReadonlyArray<string>}
 */
const LEGACY_REVISIONS = Object.freeze([LEGACY_REVISION, MODERN_REVISION]);

/**
 * Create a JSON-RPC 2.0 initialize response with server info and capabilities.
 * This is a legacy-only envelope: no `resultType`, no `_meta`.
 * 
 * Per Requirement 7.2, the legacy initialize response carries:
 * - protocolVersion: the negotiated revision (echoed from client when supported, or highest legacy revision as default)
 * - capabilities: server capabilities object
 * - serverInfo: server identity (name and version from shared source)
 * - instructions: server instructions string
 * 
 * Requirements: 2.3, 7.2, 16.2
 *
 * @param {string|number|null} id - Request id
 * @param {Object} [options] - Optional configuration
 * @param {string} [options.declaredRevision] - Client's declared protocol revision from initialize params
 * @returns {Object} JSON-RPC 2.0 response with serverInfo, capabilities, protocolVersion, instructions
 * @example
 * // Client declares supported revision
 * const response = initializeResult(1, { declaredRevision: '2024-11-05' });
 * // response.result.protocolVersion === '2024-11-05'
 * 
 * @example
 * // Client omits declaredRevision (defaults to highest legacy revision)
 * const response = initializeResult(1);
 * // response.result.protocolVersion === '2025-11-25'
 */
function initializeResult(id, { declaredRevision } = {}) {
  const caps = getCapabilities();
  
  // Legacy handshake echoes the client's revision back when supported.
  // Pick highest supported legacy revision as default when client omits one
  // (some older clients did — not ours, but the spec permits it).
  const revision = declaredRevision && LEGACY_REVISIONS.includes(declaredRevision)
    ? declaredRevision
    : LEGACY_REVISIONS[LEGACY_REVISIONS.length - 1]; // highest supported legacy
  
  return jsonRpcSuccess(id, {
    protocolVersion: revision,
    capabilities: caps.capabilities,
    serverInfo: caps.serverInfo,
    instructions: caps.instructions
  });
}

/**
 * Create a JSON-RPC 2.0 initialize response with server info and capabilities.
 * 
 * @deprecated Use initializeResult(id, { declaredRevision }) instead. This function
 * is kept for backward compatibility with existing tests during the Phase 3-4 rollout
 * and will be removed in Phase 5 (task 19.1).
 *
 * @param {string|number|null} id - Request id
 * @returns {Object} JSON-RPC 2.0 response with serverInfo, capabilities, protocolVersion
 */
function initializeResponse(id) {
  return initializeResult(id);
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
 * Create a JSON-RPC 2.0 server/discover response for modern protocol era.
 * 
 * This formatter is used exclusively for modern-era protocol responses
 * (revision 2026-07-28 and later). It returns the server's capabilities,
 * supported protocol versions, and instructions without requiring a handshake.
 * 
 * Requirements: 5.1, 5.2, 5.4, 7.1, 7.5
 * 
 * @param {string|number|null} id - Request id
 * @returns {Object} JSON-RPC 2.0 response with discover result containing:
 *   - supportedVersions: Array of supported protocol revisions
 *   - capabilities: Server capabilities object
 *   - instructions: Server instructions string
 *   - resultType: 'complete' (modern protocol requirement)
 *   - _meta: Server identity metadata
 * @example
 * const response = discoverResult('req-123');
 * // Returns:
 * // {
 * //   jsonrpc: '2.0',
 * //   id: 'req-123',
 * //   result: {
 * //     supportedVersions: ['2024-11-05', '2025-11-25', '2026-07-28'],
 * //     capabilities: { tools: { listChanged: false } },
 * //     instructions: '...',
 * //     resultType: 'complete',
 * //     _meta: {
 * //       'io.modelcontextprotocol/serverInfo': {
 * //         name: 'atlantis-mcp-server',
 * //         version: '0.0.7'
 * //       }
 * //     }
 * //   }
 * // }
 */
function discoverResult(id) {
  const caps = getCapabilities();
  return jsonRpcSuccess(id, {
    supportedVersions: caps.supportedVersions,
    capabilities: caps.capabilities,
    instructions: caps.instructions,
    resultType: 'complete',
    _meta: {
      'io.modelcontextprotocol/serverInfo': caps.serverInfo
    }
  });
}

/**
 * Server name constant.
 * Single source of truth for server identity.
 * 
 * Requirements: 2.2, 3.1
 * 
 * @constant {string}
 */
const SERVER_NAME = 'atlantis-mcp-server';

/**
 * On-wire capability object. Matches the schema both eras use.
 * `tools.listChanged: false` because this server is stateless and
 * cannot push notifications. `resources`, `prompts`, `sampling` are
 * absent (not false-flagged), consistent with the modern schema.
 * 
 * Requirements: 3.1, 3.2
 * 
 * @constant {Object}
 */
const MCP_CAPABILITIES_WIRE = Object.freeze({
  tools: { listChanged: false }
});

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
 * Negotiate protocol version between client and server.
 * Determines if the requested protocol revision is supported and returns
 * a structured negotiation result.
 *
 * Requirements: 3.2, 3.3, 3.4
 *
 * @param {string} clientRevision - Protocol revision requested by client
 * @returns {{
 *   accepted: boolean,
 *   negotiatedRevision: string|null,
 *   supportedVersions: Array<string>,
 *   message: string
 * }} Protocol negotiation response
 * @example
 * // Supported revision
 * const result = negotiateProtocol('2024-11-05');
 * // Returns: {
 * //   accepted: true,
 * //   negotiatedRevision: '2024-11-05',
 * //   supportedVersions: ['2024-11-05'],
 * //   message: 'Protocol version 2024-11-05 accepted'
 * // }
 * 
 * @example
 * // Unsupported revision
 * const result = negotiateProtocol('2099-01-01');
 * // Returns: {
 * //   accepted: false,
 * //   negotiatedRevision: null,
 * //   supportedVersions: ['2024-11-05'],
 * //   message: 'Protocol version 2099-01-01 not supported. Supported versions: 2024-11-05'
 * // }
 */
function negotiateProtocol(clientRevision) {
  // Single source of truth for supported protocol revisions
  // Phase 3: Support both 2024-11-05 (legacy) and 2025-11-25 (modern)
  const ALLOWED_REVISIONS = ['2024-11-05', '2025-11-25'];
  
  const accepted = ALLOWED_REVISIONS.includes(clientRevision);

  return {
    accepted,
    negotiatedRevision: accepted ? clientRevision : null,
    supportedVersions: ALLOWED_REVISIONS,
    message: accepted
      ? `Protocol version ${clientRevision} accepted`
      : `Protocol version ${clientRevision} not supported. Supported versions: ${ALLOWED_REVISIONS.join(', ')}`
  };
}

/**
 * The shared capability source. Returns capabilities, server identity,
 * supported versions, and instructions in one call. Format is era-neutral;
 * the formatters shape it into era-appropriate envelopes.
 * 
 * Requirements: 3.1, 3.2, 3.3
 *
 * @param {Object} [options]
 * @param {Array<{name: string, repositoryType?: string}>} [options.repositories]
 * @returns {{
 *   supportedVersions: string[],
 *   capabilities: Object,
 *   serverInfo: {name: string, version: string},
 *   instructions: string
 * }}
 * @example
 * const capabilities = getCapabilities();
 * // Returns: { supportedVersions: [...], capabilities: {...}, serverInfo: {...}, instructions: '...' }
 */
function getCapabilities(options) {
  return {
    supportedVersions: ALLOWED_REVISIONS,
    capabilities: MCP_CAPABILITIES_WIRE,
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    instructions: buildInstructions(options)
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
  MCP_CAPABILITIES_WIRE,
  MCP_TOOLS,
  JSON_RPC_ERRORS,
  LEGACY_REVISION,
  MODERN_REVISION,
  ALLOWED_REVISIONS,
  LEGACY_REVISIONS,
  SERVER_NAME,
  SERVER_VERSION,

  // JSON-RPC 2.0 response formatters
  jsonRpcSuccess,
  jsonRpcError,
  initializeResult,
  initializeResponse,  // Backward compatibility shim (Phase 3-4), removed in Phase 5
  toolsListResponse,
  discoverResult,

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
