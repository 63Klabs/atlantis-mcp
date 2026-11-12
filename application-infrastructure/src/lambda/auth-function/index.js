/**
 * Auth Lambda Entry Point (cache-data MVC pattern)
 *
 * Thin handler that detects the event type and branches:
 * - Cognito trigger (triggerSource present) → handled before any cache-data
 *   initialization; PostConfirmation_ConfirmSignUp delegates to
 *   handlers/post-confirmation.js; any other trigger source is echoed back
 *   unmodified so Cognito can complete the operation (e.g. ConfirmForgotPassword)
 * - API Gateway proxy → Config.promise/prime, ClientRequest/Response,
 *   origin-protection guard (401 when CACHE_DATA_INGRESS_SECRET_NAME is set and the
 *   request is not verified; never applied to Cognito triggers), Routes.process,
 *   response.finalize()
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
const IngressGuard = require('./utils/ingress-guard');

// >! Load the tier-common layer at module scope. Controllers are lazy-loaded, so without
// >! this a missing layer would surface on the first profile or voucher request. A missing
// >! layer fails the cold start here, with no fallback copy (Requirement 6.6).
require('./utils/tier-common');

// >! Cold start: init outside handler, runs once per container
const coldStartInitTimer = new Timer('coldStartTimer', true);
Config.init();

/**
 * Lambda handler for Auth operations.
 *
 * Detects the event type and delegates to the appropriate handler:
 * - Cognito PostConfirmation_ConfirmSignUp → post-confirmation handler
 * - Any other Cognito trigger → echoed back unmodified
 * - API Gateway proxy (httpMethod + path) → cache-data MVC pattern
 * - Unrecognized events → 400 error response
 *
 * @async
 * @param {Object} event - Lambda event (Cognito trigger or API Gateway proxy)
 * @param {Object} context - Lambda context
 * @returns {Promise<Object>} Cognito event (for triggers) or API Gateway proxy response
 * @throws {Error} Re-throws Cognito trigger errors to reject confirmation
 * @example
 * // Cognito PostConfirmation_ConfirmSignUp trigger
 * const result = await handler(cognitoEvent, context);
 *
 * @example
 * // Cognito PostConfirmation_ConfirmForgotPassword trigger — echoed back
 * const result = await handler({ triggerSource: 'PostConfirmation_ConfirmForgotPassword', ... }, context);
 *
 * @example
 * // API Gateway invocation
 * const result = await handler(apiGatewayEvent, context);
 * // Returns finalized response with CORS headers
 */
async function handler(event, context) {
	// >! Cognito user pool trigger events are identified by triggerSource and have no
	// >! httpMethod/path. They MUST be echoed back unmodified — returning an API Gateway
	// >! shaped response causes Cognito to raise InvalidLambdaResponseException on
	// >! operations such as ConfirmForgotPassword, after the password has already changed.
	if (typeof event.triggerSource === 'string') {
		if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
			try {
				return await postConfirmationHandler.handler(event);
			} catch (error) {
				console.error('Post-Confirmation trigger error:', error);
				// >! Re-throw to reject the Cognito confirmation
				throw error;
			}
		}

		// >! Any other trigger source (e.g. PostConfirmation_ConfirmForgotPassword) is not
		// >! handled by this function. Echo the event so Cognito completes the operation.
		console.log(`Unhandled Cognito trigger source: ${event.triggerSource}`);
		return event;
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

			// >! Origin protection (Part B). Rejections are 401, never 403 or 404: the Atlantis
			// >! distribution rewrites those two to the landing page with HTTP 200, so a
			// >! misconfiguration would look like a working site.
			// >! The guard runs first so a request that is not from the distribution reaches no
			// >! controller, reads no Users record, and changes no state.
			// >! The application does not read the origin-secret header or compare the secret
			// >! itself: there is one implementation, in cache-data (isIngressVerified). The guard
			// >! applies only when CACHE_DATA_INGRESS_SECRET_NAME is set; an unreadable secret is
			// >! unverified. It sits inside this API Gateway branch only: Cognito trigger events
			// >! returned above carry no CloudFront header and must never be refused here.
			if (IngressGuard.shouldRefuse(clientRequest)) {
				return IngressGuard.buildRefusal(response);
			}

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
