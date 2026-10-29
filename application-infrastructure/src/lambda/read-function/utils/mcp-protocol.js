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
  } catch {
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
 * Legacy-era (handshake-based, `initialize`) MCP protocol revisions this server
 * implements, ordered oldest to newest.
 *
 * This is the single definition of which revisions belong to the legacy era.
 * `utils/mcp-era.js` re-exports it; nothing else may hardcode a revision string.
 *
 * Requirements: 3.1, 3.3, 4.1, 11.1
 *
 * @constant {ReadonlyArray<string>}
 */
const LEGACY_REVISIONS = Object.freeze(['2024-11-05', '2025-11-25']);

/**
 * Modern-era (stateless, `server/discover`) MCP protocol revisions this server
 * recognizes, ordered oldest to newest.
 *
 * A revision listed here is *recognized* (routed to the modern branch) but is
 * only *advertised* once it appears in `SUPPORTED_PROTOCOL_VERSIONS`.
 *
 * Requirements: 3.1, 3.3, 4.2
 *
 * @constant {ReadonlyArray<string>}
 */
const MODERN_REVISIONS = Object.freeze(['2026-07-28']);

/**
 * The revisions this server advertises as fully implemented, ordered oldest to newest.
 * This is the single source of truth for `supportedVersions` on every surface
 * (`server/discover`, `getCapabilities()`, `negotiateProtocol()`, `-32022` error data).
 *
 * A revision MUST NOT be added here until every field it requires is implemented
 * and tested (Requirements 3.4, 12.1). Legacy clients cannot fall forward from a
 * half-implemented advertisement.
 *
 * Requirements: 3.1, 3.3, 3.4, 12.1
 *
 * @constant {ReadonlyArray<string>}
 */
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([...LEGACY_REVISIONS, ...MODERN_REVISIONS]);

/**
 * Alias of `SUPPORTED_PROTOCOL_VERSIONS`, retained for existing call sites and tests.
 *
 * @constant {ReadonlyArray<string>}
 */
const ALLOWED_REVISIONS = SUPPORTED_PROTOCOL_VERSIONS;

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
 * Advisory TTL for tools/list responses in milliseconds.
 * This informs modern clients how long they may cache the tool catalog.
 * The 10-minute interval balances freshness with client efficiency:
 * tools rarely change mid-session, but a client reconnecting after
 * a deploy should see the updated catalog within a reasonable window.
 *
 * This is an advisory for the client, not a server-side cache TTL.
 *
 * The same value applies to both tools/list and server/discover results: the
 * discover result changes only on deploy, so it is cached for the same interval.
 *
 * Requirements: 7.3
 *
 * @constant {number}
 */
const TOOLS_LIST_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Cache scopes the MCP 2026-07-28 specification allows on a cacheable result.
 * Any other value makes a validating client reject the result and fail to
 * connect.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching
 * @constant {ReadonlyArray<string>}
 */
const CACHE_SCOPES = Object.freeze(['public', 'private']);

/**
 * Cache scope of the modern tools/list and server/discover results.
 *
 * "public" is correct because neither result varies by caller: the tool
 * catalog is built without a tier or authentication parameter (see
 * buildToolCatalog in utils/tool-catalog.js), and the discover content is
 * the same for everyone.
 *
 * >! "public" lets a shared cache or gateway serve the result across
 * >! authorization contexts. If the catalog is ever filtered per tier or
 * >! personalized per caller, change this to "private" in the same change,
 * >! or the cache can hand one caller's list to another.
 *
 * Not operator-configurable on purpose: a bad value here is the exact
 * failure this constant exists to prevent.
 *
 * @constant {string}
 */
const TOOLS_LIST_CACHE_SCOPE = 'public';

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
 * Choose the legacy revision to answer an `initialize` request with.
 *
 * Per the legacy handshake: if the client's requested revision is supported, echo it.
 * Otherwise offer another supported revision. We offer the highest legacy revision that
 * is not newer than the one requested, so a client on an in-between revision this server
 * does not list (e.g. a client pinned to an older SDK) is offered a revision it is most
 * likely to understand rather than one newer than it. When the request is newer than
 * everything we support, or absent, the highest legacy revision is offered.
 *
 * Revision strings are `YYYY-MM-DD`, so lexicographic comparison orders them correctly.
 *
 * Requirements: 4.1, 16.1
 *
 * @param {string} [requestedRevision] - Revision the client asked for in `initialize`
 * @returns {string} A revision from `LEGACY_REVISIONS`
 * @private
 */
function selectLegacyRevision(requestedRevision) {
  const highest = LEGACY_REVISIONS[LEGACY_REVISIONS.length - 1];
  if (typeof requestedRevision !== 'string' || requestedRevision.length === 0) {
    return highest;
  }
  if (LEGACY_REVISIONS.includes(requestedRevision)) {
    return requestedRevision;
  }
  const notNewer = LEGACY_REVISIONS.filter((revision) => revision <= requestedRevision);
  return notNewer.length > 0 ? notNewer[notNewer.length - 1] : highest;
}

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

  // Legacy handshake echoes the client's revision back when supported, and otherwise
  // offers another supported legacy revision (see selectLegacyRevision).
  return jsonRpcSuccess(id, {
    protocolVersion: selectLegacyRevision(declaredRevision),
    capabilities: caps.capabilities,
    serverInfo: caps.serverInfo,
    instructions: caps.instructions
  });
}

/**
 * Cache hints of a modern cacheable result. Both tools/list and server/discover
 * read the hints from here, so one change moves both.
 *
 * @private
 * @returns {{ttlMs: number, cacheScope: string}} Fresh object on every call
 * @example
 * modernCacheHints();
 * // { ttlMs: 600000, cacheScope: 'public' }
 */
function modernCacheHints() {
  return { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: TOOLS_LIST_CACHE_SCOPE };
}

/**
 * Create an era-aware JSON-RPC 2.0 tools/list response.
 *
 * Legacy era (2024-11-05, 2025-11-25): Returns simple `{ tools }` payload
 * Modern era (2026-07-28+): Returns `CacheableResult` envelope with:
 *   - tools: Array of tool definitions
 *   - ttlMs: Advisory cache TTL
 *   - cacheScope: 'public' (the catalog is identical for every caller)
 *   - resultType: 'complete' (full catalog, not incremental)
 *   - _meta: Server identity metadata
 *
 * Requirements: 7.1, 7.3, 7.4, 7.5, 7.6
 *
 * @param {string|number|null} id - Request id
 * @param {Object} params - Response parameters
 * @param {string} params.era - Protocol era: 'legacy' or 'modern'
 * @param {Array<Object>} params.catalog - Array of tool definitions
 * @returns {Object} JSON-RPC 2.0 response with era-appropriate result shape
 * @example
 * // Legacy response
 * toolsListResult('req-1', { era: 'legacy', catalog: tools })
 * // { jsonrpc: '2.0', id: 'req-1', result: { tools: [...] } }
 *
 * // Modern response
 * toolsListResult('req-2', { era: 'modern', catalog: tools })
 * // {
 * //   jsonrpc: '2.0',
 * //   id: 'req-2',
 * //   result: {
 * //     tools: [...],
 * //     ttlMs: 600000,
 * //     cacheScope: 'public',
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
function toolsListResult(id, { era, catalog }) {
  if (era === 'modern') {
    const caps = getCapabilities();
    return jsonRpcSuccess(id, {
      tools: catalog,
      ...modernCacheHints(),
      resultType: 'complete',
      _meta: {
        'io.modelcontextprotocol/serverInfo': caps.serverInfo
      }
    });
  } else {
    // Legacy era: simple { tools } payload
    return jsonRpcSuccess(id, { tools: catalog });
  }
}

/**
 * Create a JSON-RPC 2.0 tools/call result response with era-aware envelope.
 *
 * Modern era (2026-07-28+) wraps tool call results with `resultType` and `_meta`
 * to provide execution metadata and server identity. Legacy era returns the bare
 * result without additional fields.
 *
 * Requirements: 14.3, 14.4
 *
 * @param {string|number|null} id - Request id
 * @param {Object} options - Configuration options
 * @param {string} options.era - Protocol era: 'modern' or 'legacy'
 * @param {Object} options.result - The tool call result object (with content array)
 * @returns {Object} JSON-RPC 2.0 response with era-appropriate envelope
 * @example
 * // Modern era response
 * const response = toolsCallResult('req-123', {
 *   era: 'modern',
 *   result: { content: [{ type: 'text', text: '{"data": "value"}' }] }
 * });
 * // Returns:
 * // {
 * //   jsonrpc: '2.0',
 * //   id: 'req-123',
 * //   result: {
 * //     content: [...],
 * //     resultType: 'complete',
 * //     _meta: { 'io.modelcontextprotocol/serverInfo': {...} }
 * //   }
 * // }
 *
 * @example
 * // Legacy era response (no wrapping)
 * const response = toolsCallResult('req-123', {
 *   era: 'legacy',
 *   result: { content: [{ type: 'text', text: '{"data": "value"}' }] }
 * });
 * // Returns:
 * // {
 * //   jsonrpc: '2.0',
 * //   id: 'req-123',
 * //   result: { content: [...] }
 * // }
 */
function toolsCallResult(id, { era, result }) {
  if (era === 'modern') {
    const caps = getCapabilities();
    return jsonRpcSuccess(id, {
      ...result,
      resultType: 'complete',
      _meta: {
        'io.modelcontextprotocol/serverInfo': caps.serverInfo
      }
    });
  } else {
    // Legacy era: bare result, no wrapping
    return jsonRpcSuccess(id, result);
  }
}

/**
 * Create a JSON-RPC 2.0 server/discover response for modern protocol era.
 *
 * This formatter is used exclusively for modern-era protocol responses
 * (revision 2026-07-28 and later). It returns the server's capabilities,
 * supported protocol versions, and instructions without requiring a handshake.
 *
 * The content is identical for every caller and changes only on deploy, which
 * is why the "public" cache scope and the shared advisory TTL apply.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.2, 5.4, 7.1, 7.5
 *
 * @param {string|number|null} id - Request id
 * @returns {Object} JSON-RPC 2.0 response with discover result containing:
 *   - supportedVersions: Array of supported protocol revisions
 *   - capabilities: Server capabilities object
 *   - instructions: Server instructions string
 *   - ttlMs: Advisory cache TTL
 *   - cacheScope: 'public'
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
 * //     ttlMs: 600000,
 * //     cacheScope: 'public',
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
    ...modernCacheHints(),
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
  // >! Read from the single source of truth; never keep a local copy of the revision list
  const accepted = SUPPORTED_PROTOCOL_VERSIONS.includes(clientRevision);

  return {
    accepted,
    negotiatedRevision: accepted ? clientRevision : null,
    supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    message: accepted
      ? `Protocol version ${clientRevision} accepted`
      : `Protocol version ${clientRevision} not supported. Supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`
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
    supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
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
  TOOLS_LIST_TTL_MS,
  CACHE_SCOPES,
  TOOLS_LIST_CACHE_SCOPE,
  SUPPORTED_PROTOCOL_VERSIONS,
  ALLOWED_REVISIONS,
  LEGACY_REVISIONS,
  MODERN_REVISIONS,
  SERVER_NAME,
  SERVER_VERSION,

  // JSON-RPC 2.0 response formatters
  jsonRpcSuccess,
  jsonRpcError,
  initializeResult,
  toolsListResult,
  toolsCallResult,
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
