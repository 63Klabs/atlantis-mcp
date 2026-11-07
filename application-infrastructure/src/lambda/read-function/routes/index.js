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
 * Make a response carry no body and forbid caching it.
 *
 * A notification is answered with 202 and no body (MCP Streamable HTTP, 2025-11-25).
 *
 * >! cache-data's Response.set() ignores a falsy body, so setBody(null) leaves the generic 200
 * >! template's {"message":"Success"} in place. The only way to send no body is to clear the
 * >! field, and a test with the real Response (tests/unit/routes/routes-notification-response.test.js)
 * >! fails if cache-data renames it.
 * >! Cache-Control and Expires are set here because finalize() adds max-age=<routeExpirationInSeconds>
 * >! to any status below 400 unless the application set them.
 *
 * @param {Response} response - Response instance to change
 * @returns {void}
 * @example
 * respondWithoutBody(response);
 * // response.finalize().body === null
 */
const respondWithoutBody = (response) => {
  response._body = null;
  response.addHeader('Cache-Control', 'no-store');
  response.addHeader('Expires', '0');
};

/**
 * Process incoming request and route to JSON-RPC Router.
 *
 * Only POST requests to `mcp/v1` are accepted. All other paths and
 * methods receive an error response. Populates the shared Response
 * instance instead of returning a value.
 *
 * A router result with an empty body (a notification's 202) leaves the response
 * with no body and `Cache-Control: no-store`.
 *
 * @param {ClientRequest} clientRequest - Parsed request instance from @63klabs/cache-data
 * @param {Response} response - Response instance to populate
 * @param {Object} [authInfo] - Resolved auth context from AuthResolver. Optional;
 *   threaded to the JSON-RPC router so tier-aware tools can gate behavior. Shape:
 *   `{ tier, identity, isAuthenticated, degraded?, ... }`. Callers may omit it.
 * @returns {Promise<void>}
 * @example
 * await Routes.process(clientRequest, response, authInfo);
 * // response is now populated; caller calls response.finalize()
 */
const process = async (clientRequest, response, authInfo) => {
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
    // >! Thread authInfo (optional) so the router can expose the caller's tier to
    // >! tier-aware tools. Backward compatible: undefined authInfo is handled downstream.
    const jsonRpcResponse = await JsonRpcRouter.handleJsonRpc(clientRequest, authInfo);

    response.setStatusCode(jsonRpcResponse.statusCode);
    if (jsonRpcResponse.body === '') {
      // >! A notification's 202 has no body; JSON.parse('') would throw, and setBody(null) is ignored
      respondWithoutBody(response);
    } else {
      response.setBody(JSON.parse(jsonRpcResponse.body));
    }
    if (jsonRpcResponse.headers) {
      // >! Headers managed by cache-data Response.finalize():
      // >! - content-type: finalize() sets from body when unset
      // >! - access-control-allow-origin: finalize() overwrites unconditionally
      // >! Note: access-control-allow-methods and access-control-allow-headers were removed
      // >! from STANDARD_HEADERS - they are API-Gateway-owned (declared in template.yml Cors
      // >! config) and answered on the OPTIONS preflight by API Gateway without Lambda involvement.
      const CACHE_DATA_MANAGED_HEADERS = new Set([
        'content-type',
        'access-control-allow-origin'
      ]);
      for (const [name, value] of Object.entries(jsonRpcResponse.headers)) {
        if (!CACHE_DATA_MANAGED_HEADERS.has(name.toLowerCase())) {
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
