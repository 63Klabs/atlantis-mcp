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

const { tools: {DebugAndLog, Response, Timer} } = require("@63klabs/cache-data");

const { Config } = require("./config");
const Routes = require('./routes');
const RateLimiter = require('./utils/rate-limiter');

// >! Log a cold start and time it using Timer - stop Timer in finally
const coldStartInitTimer = new Timer("coldStartTimer", true);

// >! Initialize Config - done outside of handler so it is only done on cold start
Config.init(); // >! we will await completion in the handler

/**
 * Lambda handler for MCP server read-only requests
 *
 * This function is invoked by API Gateway for all incoming MCP requests.
 * On cold start, it initializes configuration (cache, secrets, logging).
 * For all requests, it checks rate limits before processing.
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
  const startTime = Date.now();
  const requestId = context.requestId;
  const ip = event.requestContext?.identity?.sourceIp || 'unknown';

  try {

    // >! Ensure Cold Start init is done and primed (all async complete) before continuing.
    // >! If this is a cold start, we may need to wait
    // >! If this is not a cold start then all promises will have already been resolved previously and we will move on
		await Config.promise(); // >! makes sure general config init is complete
		await Config.prime(); // >! makes sure all prime tasks (tasks that need to be completed AFTER init but BEFORE handler) are completed
		// >! If the cold start init timer is running, stop it and log. This won't run again until next cold start
		if (coldStartInitTimer.isRunning()) { DebugAndLog.log(coldStartInitTimer.stop(),"COLDSTART"); }
    // >! Now that we have verified that all cold start tasks have completed we can continue handling the request

    // >! Check rate limit before processing request
    // >! Rate limit is per IP address, resets every hour
    // >! Returns 429 if limit exceeded with Retry-After header
    const rateLimit = parseInt(process.env.PUBLIC_RATE_LIMIT || '100', 10);
    const rateLimitCheck = RateLimiter.checkRateLimit(event, rateLimit);

    if (!rateLimitCheck.allowed) {
      // >! Return 429 Too Many Requests with rate limit headers
      // >! Include Retry-After header indicating when to retry
      return RateLimiter.createRateLimitResponse(
        rateLimitCheck.headers,
        rateLimitCheck.retryAfter
      );
    }

    // >! Delegate request processing to routing layer
    // >! Routes.process() handles tool routing and controller invocation
    const response = await Routes.process(event, context);

    // >! Calculate execution time for logging and metrics
    const executionTime = Date.now() - startTime;

    // >! Log successful request with execution time
    const ErrorHandler = require('./utils/error-handler');
    const props = response.getProps ? response.getProps() : {};
    ErrorHandler.logRequest({
      tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
      method: event.httpMethod,
      path: event.path,
      ip,
      requestId,
      executionTime,
      statusCode: props.statusCode || 200,
      cacheHit: props.cacheHit || false
    });

    // >! Emit latency metric
    ErrorHandler.emitLatencyMetric({
      tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
      latency: executionTime,
      cacheHit: props.cacheHit || false
    });

    // >! Convert Response object to API Gateway format
    // >! Add rate limit headers to all successful responses
    const apiGatewayResponse = response.toAPIGateway();
    apiGatewayResponse.headers = {
      ...apiGatewayResponse.headers,
      ...rateLimitCheck.headers,
      'X-MCP-Version': '1.0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    };

    return apiGatewayResponse;

  } catch (error) {
    // >! Handle top-level errors that escape routing layer
    // >! These are typically initialization failures or unexpected errors
    const ErrorHandler = require('./utils/error-handler');
    const executionTime = Date.now() - startTime;

    // >! Log all errors with stack traces and request context
    ErrorHandler.logError(error, {
      requestId,
      ip,
      tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
      parameters: event.body ? JSON.parse(event.body) : event.queryStringParameters
    });

    // >! Emit error metric
    ErrorHandler.emitErrorMetric({
      tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
      errorCode: error.code || 'INTERNAL_ERROR',
      statusCode: ErrorHandler.getStatusCode(error)
    });

    // >! Emit latency metric even for errors
    ErrorHandler.emitLatencyMetric({
      tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
      latency: executionTime,
      cacheHit: false
    });

    // >! Return sanitized error response to client
    // >! Don't expose internal implementation details
    // >! Include request IDs in error responses
    return {
      statusCode: ErrorHandler.getStatusCode(error),
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        'X-MCP-Version': '1.0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
      },
      body: JSON.stringify(ErrorHandler.toUserResponse(error, requestId))
    };
  }
};
