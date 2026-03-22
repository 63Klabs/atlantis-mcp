/**
 * Request routing for MCP server read-only operations
 *
 * This module handles routing of incoming API Gateway requests to the
 * JSON-RPC 2.0 Router at the `/mcp/v1` endpoint. All MCP operations
 * are dispatched via POST to `/mcp/v1` using the JSON-RPC 2.0 protocol.
 *
 * @module routes
 */

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Process incoming request and route to JSON-RPC Router.
 *
 * Only POST requests to `/mcp/v1` are accepted. All other paths and
 * methods receive an error response.
 *
 * @param {Object} event - API Gateway event
 * @param {Object} context - Lambda context
 * @returns {Promise<Object>} Response object with finalize() method
 * @example
 * const response = await Routes.process(event, context);
 * return response.finalize();
 */
const process = async (event, context) => {
  const rawPath = event.path || event.requestContext?.resourcePath || '';
  const httpMethod = (event.httpMethod || '').toUpperCase();

  // >! Lazy-load to avoid pulling in Controllers (and their service
  // >! dependencies) at module-load time, which would break tests that
  // >! mock @63klabs/cache-data without the `cache` export.
  const JsonRpcRouter = require('../utils/json-rpc-router');
  const MCPProtocol = require('../utils/mcp-protocol');

  if (rawPath.endsWith('/mcp/v1') && httpMethod === 'POST') {
    // >! Delegate POST to JSON-RPC Router for full MCP protocol handling
    DebugAndLog.info('Routing /mcp/v1 POST to JSON-RPC Router');
    const jsonRpcResponse = await JsonRpcRouter.handleJsonRpc(event, context);
    return { finalize: () => jsonRpcResponse };
  }

  // >! Any other request returns a JSON-RPC error
  DebugAndLog.warn('Invalid request path or method', { path: rawPath, method: httpMethod });
  const errorBody = MCPProtocol.jsonRpcError(
    null,
    MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND,
    'Not found',
    { details: `Only POST /mcp/v1 is supported. Received ${httpMethod} ${rawPath}` }
  );
  const errorResponse = JsonRpcRouter.buildResponse(400, errorBody);
  return { finalize: () => errorResponse };
};

module.exports = { process };
