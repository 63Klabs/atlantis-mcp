/**
 * Auth Lambda Entry Point (cache-data MVC pattern)
 *
 * Thin handler that detects the event type and branches:
 * - Cognito PostConfirmation_ConfirmSignUp → delegates directly to
 *   handlers/post-confirmation.js without cache-data classes
 * - API Gateway proxy → Config.promise/prime, ClientRequest/Response,
 *   Routes.process, response.finalize()
 * - Unrecognized event → 400 error via response.finalize()
 *
 * Config.init() is called outside the handler for cold start optimization.
 * A Timer tracks cold start duration and logs it once via DebugAndLog.
 *
 * @module lambda/auth
 */

'use strict';

const { tools: { DebugAndLog, ClientRequest, Response, Timer } } = require('@63klabs/cache-data');
const { Config } = require('./config');
const Routes = require('./routes');
const postConfirmationHandler = require('./handlers/post-confirmation');

// >! Cold start: init outside handler, runs once per container
const coldStartInitTimer = new Timer('coldStartTimer', true);
Config.init();

/**
 * Lambda handler for Auth operations.
 *
 * Detects the event type and delegates to the appropriate handler:
 * - Cognito PostConfirmation_ConfirmSignUp → post-confirmation handler
 * - API Gateway proxy (httpMethod + path) → cache-data MVC pattern
 * - Unrecognized events → 400 error response
 *
 * @async
 * @param {Object} event - Lambda event (Cognito trigger or API Gateway proxy)
 * @param {Object} context - Lambda context
 * @returns {Promise<Object>} Cognito event (for triggers) or API Gateway proxy response
 * @throws {Error} Re-throws Cognito trigger errors to reject confirmation
 * @example
 * // Cognito trigger invocation
 * const result = await handler(cognitoEvent, context);
 *
 * @example
 * // API Gateway invocation
 * const result = await handler(apiGatewayEvent, context);
 * // Returns finalized response with CORS headers
 */
async function handler(event, context) {
	// >! Cognito PostConfirmation trigger — no cache-data classes
	if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
		try {
			return await postConfirmationHandler.handler(event);
		} catch (error) {
			console.error('Post-Confirmation trigger error:', error);
			// >! Re-throw to reject the Cognito confirmation
			throw error;
		}
	}

	// >! API Gateway path — full MVC pattern
	let clientRequest = null;
	let response = null;

	try {
		await Config.promise();
		await Config.prime();
		if (coldStartInitTimer.isRunning()) {
			DebugAndLog.log(coldStartInitTimer.stop(), 'COLDSTART');
		}

		// >! Detect API Gateway event by presence of httpMethod and path
		if (event.httpMethod && event.path) {
			clientRequest = new ClientRequest(event, context);
			response = new Response(clientRequest);

			await Routes.process(clientRequest, response);
			return response.finalize();
		}

		// >! Unrecognized event type — return 400
		DebugAndLog.warn('Unrecognized event type', JSON.stringify(event));
		response = new Response(new ClientRequest(event, context));
		response.setStatusCode(400);
		response.setBody({ error: 'Unrecognized event type' });
		return response.finalize();
	} catch (error) {
		DebugAndLog.error(`Unhandled error: ${error.message}`, error.stack);

		if (!response) {
			// >! Error occurred before Response creation — create standalone
			try {
				response = new Response(new ClientRequest(event, context));
			} catch (innerError) {
				// >! If ClientRequest also fails, create minimal response
				return {
					statusCode: 500,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						error: 'Internal server error',
						requestId: (event.requestContext && event.requestContext.requestId) || (context && context.awsRequestId) || 'unknown'
					})
				};
			}
		}

		response.setStatusCode(500);
		response.setBody({
			error: 'Internal server error',
			requestId: (event.requestContext && event.requestContext.requestId) || (context && context.awsRequestId) || 'unknown'
		});
		return response.finalize();
	}
}

module.exports = { handler };
