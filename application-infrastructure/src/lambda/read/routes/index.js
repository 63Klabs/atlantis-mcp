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
 * methods receive an error response. Populates the shared Response
 * instance instead of returning a value.
 *
 * @param {ClientRequest} clientRequest - Parsed request instance from @63klabs/cache-data
 * @param {Response} response - Response instance to populate
 * @param {Object} event - Raw API Gateway event (for JSON-RPC Router)
 * @param {Object} context - Raw Lambda context (for JSON-RPC Router)
 * @returns {Promise<void>}
 * @example
 * await Routes.process(clientRequest, response, event, context);
 * // response is now populated; caller calls response.finalize()
 */
const process = async (clientRequest, response, event, context) => {
  const props = clientRequest.getProps();
  const path = props.path || '';
  const method = (props.method || '').toUpperCase();

  // >! Lazy-load to avoid pulling in Controllers (and their service
  // >! dependencies) at module-load time, which would break tests that
  // >! mock @63klabs/cache-data without the `cache` export.
  const JsonRpcRouter = require('../utils/json-rpc-router');
  const MCPProtocol = require('../utils/mcp-protocol');

  if (path.endsWith('mcp/v1') && method === 'POST') {
    // >! Delegate POST to JSON-RPC Router for full MCP protocol handling
    DebugAndLog.info('Routing mcp/v1 POST to JSON-RPC Router');
    const jsonRpcResponse = await JsonRpcRouter.handleJsonRpc(event, context);

    response.setStatusCode(jsonRpcResponse.statusCode);
    response.setBody(JSON.parse(jsonRpcResponse.body));
    if (jsonRpcResponse.headers) {
      for (const [name, value] of Object.entries(jsonRpcResponse.headers)) {
        // >! Skip headers that Response.finalize() manages automatically
        if (!['content-type', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'].includes(name.toLowerCase())) {
          response.addHeader(name, value);
        }
      }
    }
    return;
  }

  // >! Any other request returns a JSON-RPC error
  DebugAndLog.warn('Invalid request path or method', { path, method });
  const errorBody = MCPProtocol.jsonRpcError(
    null,
    MCPProtocol.JSON_RPC_ERRORS.METHOD_NOT_FOUND,
    'Not found',
    { details: `Only POST mcp/v1 is supported. Received ${method} ${path}` }
  );
  response.setStatusCode(400);
  response.setBody(errorBody);
};

module.exports = { process };
