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
const Controllers = require('../controllers');

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
 * Map of MCP tool names to their controller handler functions.
 *
 * Each entry maps a tool `name` (as defined in config/settings.js)
 * to the controller function that processes that tool's requests.
 *
 * @constant {Object.<string, Function>}
 */
const TOOL_DISPATCH = {
  list_templates: Controllers.Templates.list,
  get_template: Controllers.Templates.get,
  list_template_versions: Controllers.Templates.listVersions,
  list_categories: Controllers.Templates.listCategories,
  list_starters: Controllers.Starters.list,
  get_starter_info: Controllers.Starters.get,
  search_documentation: Controllers.Documentation.search,
  validate_naming: Controllers.Validation.validate,
  check_template_updates: Controllers.Updates.check,
  list_tools: Controllers.Tools.list
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
 * @param {Object} event - API Gateway event object
 * @param {string|Object} event.body - Request body (string or pre-parsed object)
 * @param {Object} context - Lambda context object
 * @returns {Promise<Object>} API Gateway response with statusCode, headers, body
 *
 * @example
 * const response = await handleJsonRpc({
 *   body: JSON.stringify({
 *     jsonrpc: '2.0',
 *     method: 'initialize',
 *     id: 'req-1'
 *   })
 * }, context);
 */
async function handleJsonRpc(event, context) {
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

    // --- Step 4: Dispatch by method -------------------------------------------
    switch (method) {
      case 'initialize':
        return buildResponse(200, MCPProtocol.initializeResponse(id));

      case 'tools/list':
        return buildResponse(200, MCPProtocol.toolsListResponse(id, MCPProtocol.MCP_TOOLS));

      case 'tools/call':
        return await handleToolsCall(id, params, event, context);

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
 * @param {Object} event - API Gateway event (passed to controller)
 * @param {Object} context - Lambda context (passed to controller)
 * @returns {Promise<Object>} API Gateway response
 */
async function handleToolsCall(id, params, event, context) {
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

  // >! Look up the controller handler for this tool
  const handler = TOOL_DISPATCH[toolName];
  if (!handler) {
    return buildResponse(200, MCPProtocol.jsonRpcError(
      id,
      MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      'Method not found',
      { details: `Unknown tool: ${toolName}` }
    ));
  }

  // >! Build props object matching the controller interface
  // Controllers expect props.bodyParameters.input
  const props = {
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

  return buildResponse(200, MCPProtocol.jsonRpcSuccess(id, result));
}

module.exports = {
  handleJsonRpc,
  // Exported for testing
  extractId,
  buildResponse,
  TOOL_DISPATCH,
  STANDARD_HEADERS
};
