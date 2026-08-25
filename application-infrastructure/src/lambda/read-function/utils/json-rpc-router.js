/**
 * JSON-RPC 2.0 Router for MCP Protocol
 *
 * Parses incoming JSON-RPC 2.0 requests, validates the envelope,
 * dispatches to the appropriate controller based on the `method` field,
 * and wraps responses using the MCP protocol JSON-RPC 2.0 formatters.
 *
 * Supported methods:
 * - `initialize` — returns server capabilities
 * - `tools/list` — returns available tool definitions
 * - `tools/call` — dispatches to existing controllers by tool name
 *
 * @module utils/json-rpc-router
 */

const MCPProtocol = require('./mcp-protocol');
const ContentSizer = require('./content-sizer');
const ContentChunker = require('./content-chunker');
const Controllers = require('../controllers');
const AgentAssetTypes = require('../config/agent-asset-types');
const { extendedDescriptions } = require('../config/tool-descriptions');

/**
 * Standard CORS and MCP headers included on every response.
 * @constant {Object}
 */
const STANDARD_HEADERS = {
  'Content-Type': 'application/json',
  'X-MCP-Version': '1.0',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
};

/**
 * Base map of MCP tool names to their controller handler functions, covering
 * the templates, starters, documentation, naming, update-check, and
 * tool-listing tools.
 *
 * @constant {Object.<string, Function>}
 */
const baseDispatch = {
  list_templates: Controllers.Templates.list,
  get_template: Controllers.Templates.get,
  get_template_chunk: Controllers.Templates.getChunk,
  list_template_versions: Controllers.Templates.listVersions,
  list_categories: Controllers.Templates.listCategories,
  list_starters: Controllers.Starters.list,
  get_starter_info: Controllers.Starters.get,
  search_documentation: Controllers.Documentation.search,
  get_document: Controllers.Documentation.getDocument,
  get_document_chunk: Controllers.Documentation.getDocumentChunk,
  validate_naming: Controllers.Validation.validate,
  check_template_updates: Controllers.Updates.check,
  list_tools: Controllers.Tools.list
};

/**
 * Map of MCP tool names to their controller handler functions.
 *
 * Each entry maps a tool `name` (as defined in config/settings.js)
 * to the controller function that processes that tool's requests.
 *
 * Merges `baseDispatch` with the registry-generated agent-asset dispatch
 * entries (`list_agent_assets`, `get_agent_asset`, `list_agent_asset_types`)
 * produced by `AgentAssetTypes.getToolDispatch(Controllers.AgentAssets)`, so
 * a tool absent from either source still falls through to the
 * `Object.hasOwn(TOOL_DISPATCH, toolName)` guard in `handleToolsCall` and
 * returns a JSON-RPC `-32601` Method not found error.
 *
 * @constant {Object.<string, Function>}
 */
const TOOL_DISPATCH = {
  ...baseDispatch,
  ...AgentAssetTypes.getToolDispatch(Controllers.AgentAssets)
};

/**
 * Build an API Gateway–compatible response object.
 *
 * @param {number} statusCode - HTTP status code
 * @param {Object} body - Response body (will be JSON-stringified)
 * @returns {Object} API Gateway response with statusCode, headers, body
 */
function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...STANDARD_HEADERS },
    body: JSON.stringify(body)
  };
}

/**
 * Extract the JSON-RPC `id` from a parsed request body.
 *
 * Per JSON-RPC 2.0, valid id types are string and number.
 * Any other type (object, array, boolean, undefined) is treated as
 * missing and the response id is set to `null`.
 *
 * @param {*} rawId - The `id` value from the parsed request
 * @returns {string|number|null} Sanitised id value
 */
function extractId(rawId) {
  if (typeof rawId === 'string' || typeof rawId === 'number') {
    return rawId;
  }
  return null;
}

/**
 * Handle a JSON-RPC 2.0 request arriving at the `/mcp/v1` endpoint.
 *
 * Processing steps:
 * 1. Parse the event body as JSON (return `-32700` on failure).
 * 2. Validate required fields `jsonrpc` and `method` (return `-32600` if missing).
 * 3. Extract `id` (use `null` when missing or invalid type).
 * 4. Dispatch by `method`:
 *    - `initialize`  → server capabilities via `initializeResponse`
 *    - `tools/list`  → tool definitions via `toolsListResponse`
 *    - `tools/call`  → delegate to the matching controller
 *    - anything else → `-32601` Method not found
 * 5. Wrap every response with `Content-Type: application/json`.
 *
 * @async
 * @param {ClientRequest} clientRequest - ClientRequest object
 * @param {Object} [authInfo] - Optional resolved auth context
 *   (`{ tier, isAuthenticated, ... }`). Threaded to `tools/call` handlers so tier-aware
 *   tools can gate behavior. When omitted, a safe public-tier context is used downstream.
 *   Only the tier is consumed downstream; identity/PII is never logged.
 * @returns {Promise<Object>} API Gateway response with statusCode, headers, body
 *
 * @example
 * const response = await handleJsonRpc({
 *   body: JSON.stringify({
 *     jsonrpc: '2.0',
 *     method: 'initialize',
 *     id: 'req-1'
 *   })
 * }, authInfo);
 */
async function handleJsonRpc(clientRequest, authInfo) {

  const event = clientRequest.getEvent();

  let id = null;

  try {
    // --- Step 1: Parse body ---------------------------------------------------
    let body;
    try {
      if (typeof event.body === 'string') {
        body = JSON.parse(event.body);
      } else if (event.body && typeof event.body === 'object') {
        body = event.body;
      } else {
        // >! No body or unsupported type — treat as parse error
        return buildResponse(200, MCPProtocol.jsonRpcError(
          null,
          MCPProtocol.JSON_RPC_ERRORS.PARSE_ERROR,
          'Parse error',
          { details: 'Request body is empty or not valid JSON' }
        ));
      }
    } catch (parseErr) {
      // >! Malformed JSON
      return buildResponse(200, MCPProtocol.jsonRpcError(
        null,
        MCPProtocol.JSON_RPC_ERRORS.PARSE_ERROR,
        'Parse error',
        { details: parseErr.message }
      ));
    }

    // --- Step 2: Extract id early ---------------------------------------------
    id = extractId(body.id);

    // --- Step 3: Validate JSON-RPC 2.0 envelope -------------------------------
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return buildResponse(200, MCPProtocol.jsonRpcError(
        id,
        MCPProtocol.JSON_RPC_ERRORS.INVALID_REQUEST,
        'Invalid Request',
        { details: 'Missing or invalid "jsonrpc" or "method" field' }
      ));
    }

    const { method, params } = body;
    clientRequest.addQueryLog(`m:${method}`);

    // --- Step 4: Dispatch by method -------------------------------------------
    switch (method) {
      case 'initialize':
        return buildResponse(200, MCPProtocol.initializeResponse(id));

      case 'tools/list': {
        // Merge extended descriptions at response time
        const mergedTools = MCPProtocol.MCP_TOOLS.map(tool => {
          const extended = extendedDescriptions[tool.name];
          return extended ? { ...tool, description: extended } : tool;
        });
        return buildResponse(200, MCPProtocol.toolsListResponse(id, mergedTools));
      }

      case 'tools/call':
        return await handleToolsCall(id, params, clientRequest, authInfo);

      default:
        return buildResponse(200, MCPProtocol.jsonRpcError(
          id,
          MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          'Method not found',
          { method }
        ));
    }
  } catch (err) {
    // >! Catch-all for unexpected errors — return -32603 Internal error
    // >! Never expose stack traces to the client
    return buildResponse(200, MCPProtocol.jsonRpcError(
      id,
      MCPProtocol.JSON_RPC_ERRORS.INTERNAL_ERROR,
      'Internal error',
      { details: err.message }
    ));
  }
}

/**
 * Handle a `tools/call` JSON-RPC method.
 *
 * Extracts `params.name` and `params.arguments`, looks up the controller
 * in TOOL_DISPATCH, invokes it with a props object matching the controller
 * interface, and wraps the result in MCP content format.
 *
 * @async
 * @param {string|number|null} id - JSON-RPC request id
 * @param {Object} params - JSON-RPC params object
 * @param {string} params.name - Tool name to invoke
 * @param {Object} [params.arguments] - Tool arguments
 * @param {ClientRequest} clientRequest - Object containing client request information
 * @param {Object} [authInfo] - Optional resolved auth context
 *   (`{ tier, isAuthenticated, ... }`). Added to the controller `props` generically for all
 *   tools so tier-aware tools (e.g. documentation search) can read the caller's tier.
 *   Tier-unaware controllers ignore it. Defaults to a public-tier context when omitted.
 * @returns {Promise<Object>} API Gateway response
 */
async function handleToolsCall(id, params, clientRequest, authInfo) {
  // >! Validate that params.name is present
  if (!params || typeof params.name !== 'string') {
    return buildResponse(200, MCPProtocol.jsonRpcError(
      id,
      MCPProtocol.JSON_RPC_ERRORS.INVALID_PARAMS,
      'Invalid params',
      { details: 'Missing required "params.name" for tools/call' }
    ));
  }

  const toolName = params.name;
  const toolArgs = params.arguments || {};

  // >! Validate toolName is an own property of TOOL_DISPATCH to prevent
  // >! prototype chain lookups (hasOwnProperty, constructor, __proto__, etc.)
  if (!Object.hasOwn(TOOL_DISPATCH, toolName)) {
    return buildResponse(200, MCPProtocol.jsonRpcError(
      id,
      MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      'Method not found',
      { details: `Unknown tool: ${toolName}` }
    ));
  }

  const handler = TOOL_DISPATCH[toolName];

  // >! Defense-in-depth: verify the resolved handler is callable
  if (typeof handler !== 'function') {
    return buildResponse(200, MCPProtocol.jsonRpcError(
      id,
      MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      'Method not found',
      { details: `Unknown tool: ${toolName}` }
    ));
  }

  // log the tool name
  clientRequest.addQueryLog(`t:${toolName}`);

  // >! Default to a safe public-tier context so callers/tests that omit authInfo keep working.
  // >! Only the tier is consumed downstream; identity/PII is never logged here.
  const auth = authInfo || { tier: 'public', isAuthenticated: false };

  // >! Build props object matching the controller interface
  // Controllers expect props.bodyParameters.input. props.authInfo is threaded generically
  // for ALL tools so tier-aware tools (e.g. documentation search) can read the caller's
  // tier; tier-unaware controllers simply ignore props.authInfo.
  const props = {
    authInfo: auth,
    bodyParameters: {
      tool: toolName,
      input: toolArgs
    }
  };

  // >! Invoke the controller
  const controllerResult = await handler(props);

  // >! Adapt legacy controller response to JSON-RPC 2.0 MCP content format
  // Controllers return { protocol, version, tool, success, data, timestamp }
  // or { protocol, version, success: false, error, timestamp }
  if (controllerResult && controllerResult.success === false) {
    // Controller returned an error in legacy format
    return buildResponse(200, MCPProtocol.jsonRpcError(
      id,
      MCPProtocol.JSON_RPC_ERRORS.INTERNAL_ERROR,
      controllerResult.error?.details?.message || 'Tool execution failed',
      {
        toolName,
        errorCode: controllerResult.error?.code,
        details: controllerResult.error?.details
      }
    ));
  }

  // >! Wrap successful result in MCP content format
  const resultData = controllerResult?.data !== undefined ? controllerResult.data : controllerResult;
  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify(resultData)
      }
    ]
  };

  // >! Size-aware response for get_template: return summary if payload exceeds threshold
  if (toolName === 'get_template') {
    try {
      const serialized = result.content[0].text;
      const sizeResult = ContentSizer.measure(serialized);

      if (sizeResult.exceedsThreshold) {
        const summary = buildTemplateSummary(resultData, serialized);
        const summaryResult = {
          content: [{ type: 'text', text: JSON.stringify(summary) }]
        };
        return buildResponse(200, MCPProtocol.jsonRpcSuccess(id, summaryResult));
      }
    } catch {
      // >! Graceful fallback: if summary generation fails, return the original full response
    }
  }

  // >! Size-aware response for get_document: return summary if payload exceeds threshold,
  // >! mirroring the get_template summary above (spec 0-0-6, Requirement 6.7 / task 5.4)
  if (toolName === 'get_document') {
    try {
      const serialized = result.content[0].text;
      const sizeResult = ContentSizer.measure(serialized);

      if (sizeResult.exceedsThreshold) {
        const summary = buildDocumentSummary(resultData, serialized);
        const summaryResult = {
          content: [{ type: 'text', text: JSON.stringify(summary) }]
        };
        return buildResponse(200, MCPProtocol.jsonRpcSuccess(id, summaryResult));
      }
    } catch {
      // >! Graceful fallback: if summary generation fails, return the original full response
    }
  }

  // >! Size-aware response for get_agent_asset: return summary if payload exceeds threshold,
  // >! mirroring the get_template summary above (Requirement 9.1, task 10.3)
  if (toolName === 'get_agent_asset') {
    try {
      const serialized = result.content[0].text;
      const sizeResult = ContentSizer.measure(serialized);

      if (sizeResult.exceedsThreshold) {
        const summary = buildAgentAssetSummary(resultData, serialized);
        const summaryResult = {
          content: [{ type: 'text', text: JSON.stringify(summary) }]
        };
        return buildResponse(200, MCPProtocol.jsonRpcSuccess(id, summaryResult));
      }
    } catch {
      // >! Graceful fallback: if summary generation fails, return the original full response
    }
  }

  return buildResponse(200, MCPProtocol.jsonRpcSuccess(id, result));
}

/**
 * Build a Template_Summary from template data when the response exceeds the size threshold.
 *
 * @param {Object} templateData - The full template data object
 * @param {string} serializedContent - The JSON-serialized template content
 * @returns {Object} Template_Summary with metadata, resources, and retrieval hint
 * @private
 */
function buildTemplateSummary(templateData, serializedContent) {
  const chunks = ContentChunker.chunk(serializedContent);

  // >! Extract top-level resource logical IDs and types
  const resources = [];
  const rawContent = templateData.content || templateData.templateContent || '';
  if (typeof rawContent === 'object' && rawContent !== null) {
    const resourcesSection = rawContent.Resources || {};
    for (const [logicalId, resourceDef] of Object.entries(resourcesSection)) {
      resources.push({
        logicalId,
        type: resourceDef.Type || 'Unknown'
      });
    }
  }

  return {
    name: templateData.name || null,
    version: templateData.version || null,
    versionId: templateData.versionId || null,
    description: templateData.description || null,
    category: templateData.category || null,
    namespace: templateData.namespace || null,
    bucket: templateData.bucket || null,
    s3Path: templateData.s3Path || null,
    parameters: templateData.parameters || {},
    outputs: templateData.outputs || {},
    resources,
    contentTruncated: true,
    totalChunks: chunks.length,
    retrievalHint: `Use the get_template_chunk tool with templateName and category to retrieve the full content. Pass chunkIndex from 0 to ${chunks.length - 1} to retrieve each chunk sequentially.`
  };
}

/**
 * Build an Agent_Asset_Summary from asset data when the response exceeds the size threshold.
 *
 * Mirrors `buildTemplateSummary` above, but carries agent-asset detail
 * metadata (`name`, `type`, `namespace`, `bucket`, `s3Path`, `size`, `etag`,
 * `sha256`, `lastModified`) instead of template-specific fields, and never
 * includes the asset's `content` — that is the point of truncation.
 *
 * @param {Object} assetData - The full agent-asset detail object
 * @param {string} serializedContent - The JSON-serialized agent-asset content
 * @returns {Object} Agent_Asset_Summary with metadata and retrieval hint
 * @private
 */
function buildAgentAssetSummary(assetData, serializedContent) {
  const chunks = ContentChunker.chunk(serializedContent);

  return {
    name: assetData.name || null,
    type: assetData.type || null,
    namespace: assetData.namespace || null,
    bucket: assetData.bucket || null,
    s3Path: assetData.s3Path || null,
    size: assetData.size ?? null,
    etag: assetData.etag || null,
    sha256: assetData.sha256 || null,
    lastModified: assetData.lastModified || null,
    contentTruncated: true,
    totalChunks: chunks.length,
    retrievalHint: `Use the get_agent_asset_chunk tool with assetType and name to retrieve the full content. Pass chunkIndex from 0 to ${chunks.length - 1} to retrieve each chunk sequentially.`
  };
}

/**
 * Build a Document_Summary from `get_document` data when the response exceeds the size
 * threshold (spec 0-0-6, Requirement 6.7).
 *
 * Mirrors `buildTemplateSummary`/`buildAgentAssetSummary` above, but carries the
 * `get_document` file-level metadata (`filePath`, `githubUrl`, `repository`,
 * `repositoryType`, `namespace`) instead of template/asset-specific fields, and never
 * includes the document's `content` — that is the point of truncation.
 *
 * @param {Object} documentData - The full `get_document` success payload
 * @param {string} serializedContent - The JSON-serialized `get_document` content
 * @returns {Object} Document_Summary with metadata and retrieval hint
 * @private
 */
function buildDocumentSummary(documentData, serializedContent) {
  const chunks = ContentChunker.chunk(serializedContent);

  return {
    filePath: documentData.filePath || null,
    githubUrl: documentData.githubUrl || null,
    repository: documentData.repository || null,
    repositoryType: documentData.repositoryType || null,
    namespace: documentData.namespace || null,
    contentTruncated: true,
    totalChunks: chunks.length,
    retrievalHint: `Use the get_document_chunk tool with filePath or hash to retrieve the full content. Pass chunkIndex from 0 to ${chunks.length - 1} to retrieve each chunk sequentially.`
  };
}

module.exports = {
  handleJsonRpc,
  // Exported for testing
  extractId,
  buildResponse,
  buildTemplateSummary,
  buildAgentAssetSummary,
  buildDocumentSummary,
  TOOL_DISPATCH,
  STANDARD_HEADERS
};
