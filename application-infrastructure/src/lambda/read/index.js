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
const { tools: {DebugAndLog, ClientRequest, Response, Timer} } = require("@63klabs/cache-data");

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
 * 2. Request Parsing:
 *    - Creates a ClientRequest from the event and context
 *    - Creates a Response linked to the ClientRequest
 * 
 * 3. Rate Limiting:
 *    - Checks rate limits using Config.settings().rateLimits
 *    - Returns 429 Too Many Requests if limit exceeded
 *    - Adds rate limit headers to the Response
 * 
 * 4. Request Processing:
 *    - Delegates to Routes.process() for tool routing
 *    - Routes populates the shared Response instance
 *    - Calls response.finalize() once to produce the API Gateway response
 * 
 * 5. Error Handling:
 *    - Catches and logs all errors with context
 *    - Reuses existing Response if available, otherwise creates standalone
 *    - Returns sanitized error responses to clients
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
 * @throws {Error} If critical initialization fails (cache, configuration, SSM)
 */
exports.handler = async (event, context) => {

  let clientRequest = null;
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

    // >! Create ClientRequest and Response from event/context
    clientRequest = new ClientRequest(event, context);
    response = new Response(clientRequest);

    // >! Check rate limit before processing request
    // >! Rate limit is per IP address, resets every hour
    // >! Returns 429 if limit exceeded with Retry-After header
    const rateLimitCheck = await RateLimiter.checkRateLimit(event, Config.settings().rateLimits);

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

    // >! Add rate-limit and MCP headers to the Response before routing
    for (const [name, value] of Object.entries(rateLimitCheck.headers)) {
      response.addHeader(name, value);
    }
    response.addHeader('X-MCP-Version', '1.0');

    // >! Delegate request processing to routing layer
    // >! Routes.process() populates the shared Response instance (void return)
    await Routes.process(clientRequest, response);

    // >! Await DynamoDB update before returning to ensure state is persisted
    if (rateLimitCheck.dynamoPromise) { await rateLimitCheck.dynamoPromise; }

    // >! Finalize and return the API Gateway response
    // >! Response.finalize() handles CORS, cache-control, execution-time, and logging
    return response.finalize();

  } catch (error) {
    const requestId = event.requestContext?.requestId || context?.awsRequestId || 'unknown';

    // >! Return sanitized error response to client
    // >! Don't expose internal implementation details
		DebugAndLog.error(`Unhandled Execution Error in Handler  Error: ${error.message}`, error.stack);

    // >! Reuse existing Response if available (linked to ClientRequest for logging)
    // >! Otherwise create standalone Response for error
    if (!response) {
      response = new Response({statusCode: 500});
    } else {
      response.setStatusCode(500);
    }
    response.addHeader('X-Request-Id', requestId);
		response.addHeader('X-MCP-Version', '1.0');
		response.setBody({
			message: 'Error initializing request - 1701-D',
      requestId: requestId
		});
    return response.finalize();
  }
};
