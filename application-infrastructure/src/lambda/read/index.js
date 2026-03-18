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
 * Uncaught errors are handled within try/catch/finally to provide logs and
 * error messages back to the client.
 *
 * @module lambda/read
 */

// >! Web service and cache framework package
const { tools: {DebugAndLog, Response, Timer} } = require("@63klabs/cache-data");

// >! Application Modules
const { Config } = require("./config");
const Routes = require('./routes');
const RateLimiter = require('./utils/rate-limiter');

// >! Log a cold start and time it using Timer - stop Timer in finally block
const coldStartInitTimer = new Timer("coldStartTimer", true);

// >! Initialize Config - done outside of handler so it is only done on cold start
Config.init(); // >! we will await completion in the handler

/**
 * Lambda handler for MCP server read-only requests.
 *
 * This function is invoked by API Gateway for all incoming MCP requests.
 * It performs the following operations in order:
 * 
 * 1. Cold Start Initialization:
 *    - Waits for Config.promise() to ensure Config.init() completed
 *    - Calls Config.prime() to pre-populate caches
 *    - Logs cold start timing (only on first invocation)
 * 
 * 2. Rate Limiting:
 *    - Checks rate limits using Config.settings().rateLimits
 *    - Returns 429 Too Many Requests if limit exceeded
 *    - Adds rate limit headers to all responses
 * 
 * 3. Request Processing:
 *    - Delegates to Routes.process() for tool routing
 *    - Adds standard MCP and CORS headers
 *    - Logs request metrics and execution time
 * 
 * 4. Error Handling:
 *    - Catches and logs all errors with context
 *    - Returns sanitized error responses to clients
 *    - Emits CloudWatch metrics for monitoring
 * 
 * Config Usage:
 * - Config.promise(): Waits for async initialization to complete
 * - Config.prime(): Pre-loads caches for optimal performance
 * - Config.settings(): Accesses application settings (rate limits, S3 buckets, etc.)
 * - Config.getConnCacheProfile(): Retrieves cache profiles for data sources
 * 
 * Rate Limiter Integration:
 * The handler integrates with the rate limiter using Config.settings().rateLimits
 * to enforce request limits per IP address. Rate limit configuration includes:
 * - public: 100 requests/hour (unauthenticated)
 * - registered: 500 requests/hour (authenticated free tier)
 * - paid: 2500 requests/hour (authenticated paid tier)
 * - private: 1000 requests/hour (internal/admin)
 * 
 * Cold Start Behavior:
 * - First invocation: Config.init() runs, typically 200-500ms
 * - Subsequent invocations: Config already initialized, returns immediately
 * - Documentation index builds asynchronously without blocking
 *
 * @async
 * @param {Object} event - API Gateway event object
 * @param {Object} event.body - Request body (JSON string)
 * @param {Object} event.headers - Request headers
 * @param {Object} event.queryStringParameters - Query parameters
 * @param {Object} event.requestContext - Request context with requestId, IP, etc.
 * @param {Object} event.requestContext.identity - Identity information
 * @param {string} event.requestContext.identity.sourceIp - Client IP address
 * @param {Object} context - Lambda context object
 * @param {string} context.requestId - Lambda request ID
 * @param {string} context.functionName - Lambda function name
 * @param {number} context.getRemainingTimeInMillis - Function to get remaining execution time
 * @returns {Promise<Object>} API Gateway response object
 * @returns {number} returns.statusCode - HTTP status code (200, 429, 500, etc.)
 * @returns {Object} returns.headers - Response headers including rate limit headers
 * @returns {string} returns.body - Response body (JSON string)
 *
 * @example
 * // Lambda handler invocation (cold start)
 * const event = {
 *   body: JSON.stringify({ tool: 'list_templates' }),
 *   headers: { 'Content-Type': 'application/json' },
 *   requestContext: {
 *     requestId: 'abc-123',
 *     identity: { sourceIp: '192.168.1.1' }
 *   }
 * };
 * 
 * const response = await handler(event, context);
 * // First invocation: Config.init() runs, cold start logged
 * // Returns: {
 * //   statusCode: 200,
 * //   headers: {
 * //     'X-RateLimit-Limit': '100',
 * //     'X-RateLimit-Remaining': '99',
 * //     'X-RateLimit-Reset': '1234567890',
 * //     'X-MCP-Version': '1.0',
 * //     ...
 * //   },
 * //   body: '{"templates": [...]}'
 * // }
 * 
 * @example
 * // Subsequent invocation (warm start)
 * const response = await handler(event, context);
 * // Config already initialized, no cold start delay
 * // Rate limit headers updated with remaining count
 * 
 * @example
 * // Rate limit exceeded
 * // After 100 requests from same IP
 * const response = await handler(event, context);
 * // Returns: {
 * //   statusCode: 429,
 * //   headers: {
 * //     'X-RateLimit-Limit': '100',
 * //     'X-RateLimit-Remaining': '0',
 * //     'Retry-After': '3600',
 * //     ...
 * //   },
 * //   body: '{"error": "Too Many Requests", "retryAfter": 3600}'
 * // }
 *
 * @throws {Error} If critical initialization fails (cache, configuration, SSM)
 */
exports.handler = async (event, context) => {

  let response = null;

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
    const rateLimitCheck = await RateLimiter.checkRateLimit(event, Config.settings().rateLimits);

    console.log("SETTINGS", Config.settings());
    if (!rateLimitCheck.allowed) {
      // >! Await DynamoDB update before returning to ensure state is persisted
      if (rateLimitCheck.dynamoPromise) { await rateLimitCheck.dynamoPromise; }
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

    DebugAndLog.debug("RESPONSE FROM ROUTES", response);


    // TODO: A lot of this metric and logging stuff is already handled by Response so we should clean up and ensure this isn't used by a downstream process. Or, if it is, figure out what data is needed and use already provided methods from DebugAndLog and Response

    // // >! Log successful request with execution time
    // const ErrorHandler = require('./utils/error-handler');
    // const props = response.getProps ? response.getProps() : {};
    // ErrorHandler.logRequest({
    //   tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
    //   method: event.httpMethod,
    //   path: event.path,
    //   ip,
    //   requestId,
    //   executionTime,
    //   statusCode: props.statusCode || 200,
    //   cacheHit: props.cacheHit || false
    // });

    // // >! Emit latency metric
    // ErrorHandler.emitLatencyMetric({
    //   tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
    //   latency: executionTime,
    //   cacheHit: props.cacheHit || false
    // });

    // >! Convert Response object to API Gateway format
    // >! Add rate limit headers to all successful responses
    const apiGatewayResponse = response.finalize();
    apiGatewayResponse.headers = {
      ...apiGatewayResponse.headers,
      ...rateLimitCheck.headers,
      'X-MCP-Version': '1.0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    };

    // >! Await DynamoDB update before returning to ensure state is persisted
    if (rateLimitCheck.dynamoPromise) { await rateLimitCheck.dynamoPromise; }

    return apiGatewayResponse;

  } catch (error) {
    // // >! Handle top-level errors that escape routing layer
    // // >! These are typically initialization failures or unexpected errors
    // const ErrorHandler = require('./utils/error-handler');

    // // >! Log all errors with stack traces and request context
    // ErrorHandler.logError(error, {
    //   requestId,
    //   ip,
    //   tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
    //   parameters: event.body ? JSON.parse(event.body) : event.queryStringParameters
    // });

    // // >! Emit error metric
    // ErrorHandler.emitErrorMetric({
    //   tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
    //   errorCode: error.code || 'INTERNAL_ERROR',
    //   statusCode: ErrorHandler.getStatusCode(error)
    // });

    // // >! Emit latency metric even for errors
    // ErrorHandler.emitLatencyMetric({
    //   tool: event.body ? JSON.parse(event.body).tool : event.queryStringParameters?.tool,
    //   latency: executionTime,
    //   cacheHit: false
    // });

    // Get requestId from event
    const requestId = event.requestContext?.requestId || context?.awsRequestId || 'unknown';

    // >! Return sanitized error response to client
    // >! Don't expose internal implementation details
    // >! Include request IDs in error responses
    
		/* Log the error */
		DebugAndLog.error(`Unhandled Execution Error in Handler  Error: ${error.message}`, error.stack);

		/* This failed before we even got to parsing the request so we don't have all the log info */
		response = new Response({statusCode: 500});
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Request-Id', requestId);
		response.setHeader('X-MCP-Version', '1.0');
		response.setHeader('Access-Control-Allow-Origin', '*');
		response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
		response.setBody({
			message: 'Error initializing request - 1701-D', // 1701-D just so we know it is an app and not API Gateway error
      requestId: requestId
		});
    return response.finalize();
  }
};
