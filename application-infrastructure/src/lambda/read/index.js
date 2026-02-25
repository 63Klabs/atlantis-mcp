/**
 * Lambda handler for Atlantis MCP Server Read-Only Operations
 * 
 * This Lambda function handles all read-only MCP protocol operations including:
 * - Template discovery and retrieval
 * - Starter code discovery
 * - Documentation search
 * - Naming convention validation
 * - Template update checking
 * 
 * The handler performs cold start initialization via Config.init() and delegates
 * request routing to the Routes module.
 * 
 * @module lambda/read
 */

const Config = require('./config');
const Routes = require('./routes');

/**
 * Lambda handler for MCP server read-only requests
 * 
 * This function is invoked by API Gateway for all incoming MCP requests.
 * On cold start, it initializes configuration (cache, secrets, logging).
 * For all requests, it delegates to the routing layer and returns an
 * API Gateway-compatible response.
 * 
 * @async
 * @param {Object} event - API Gateway event object
 * @param {Object} event.body - Request body (JSON string)
 * @param {Object} event.headers - Request headers
 * @param {Object} event.queryStringParameters - Query parameters
 * @param {Object} event.requestContext - Request context with requestId, IP, etc.
 * @param {Object} context - Lambda context object
 * @param {string} context.requestId - Lambda request ID
 * @param {string} context.functionName - Lambda function name
 * @param {number} context.getRemainingTimeInMillis - Function to get remaining execution time
 * @returns {Promise<Object>} API Gateway response object
 * @returns {number} returns.statusCode - HTTP status code
 * @returns {Object} returns.headers - Response headers
 * @returns {string} returns.body - Response body (JSON string)
 * 
 * @example
 * // API Gateway invokes handler with event
 * const response = await handler(event, context);
 * // Returns: { statusCode: 200, headers: {...}, body: '{"result": ...}' }
 * 
 * @throws {Error} If critical initialization fails (cache, configuration)
 */
exports.handler = async (event, context) => {
  try {
    // >! Initialize configuration during cold start
    // >! Config.init() is idempotent - safe to call on every invocation
    // >! First call initializes cache, secrets, and logging
    // >! Subsequent calls return immediately
    await Config.init();

    // >! Delegate request processing to routing layer
    // >! Routes.process() handles tool routing and controller invocation
    const response = await Routes.process(event, context);

    // >! Convert Response object to API Gateway format
    // >! Returns { statusCode, headers, body }
    return response.toAPIGateway();

  } catch (error) {
    // >! Handle top-level errors that escape routing layer
    // >! These are typically initialization failures or unexpected errors
    
    // Log full error details for debugging
    console.error('Lambda handler error:', {
      error: error.message,
      stack: error.stack,
      requestId: context.requestId,
      event: {
        path: event.path,
        httpMethod: event.httpMethod,
        headers: event.headers
      }
    });

    // >! Return sanitized error response to client
    // >! Don't expose internal implementation details
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': context.requestId
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'An unexpected error occurred while processing your request',
        requestId: context.requestId
      })
    };
  }
};
