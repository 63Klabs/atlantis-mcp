/**
 * Auth Lambda Entry Point
 *
 * Routes incoming events to the appropriate handler based on event type:
 * - Cognito Post-Confirmation triggers → handlers/post-confirmation.js
 * - API Gateway proxy events → routes/index.js
 *
 * Error handling logs full details for debugging but returns sanitized
 * responses to clients. Cognito trigger errors are re-thrown to reject
 * the confirmation. API Gateway errors return structured HTTP responses.
 *
 * @module lambda/auth
 */

'use strict';

const postConfirmationHandler = require('./handlers/post-confirmation');
const routeDispatcher = require('./routes/index');

/**
 * Determine whether the event is a Cognito Post-Confirmation trigger.
 *
 * @param {Object} event - Lambda event
 * @returns {boolean} True if event is a Cognito PostConfirmation_ConfirmSignUp trigger
 */
function isCognitoPostConfirmation(event) {
	return event.triggerSource === 'PostConfirmation_ConfirmSignUp';
}

/**
 * Determine whether the event is an API Gateway proxy request.
 *
 * @param {Object} event - Lambda event
 * @returns {boolean} True if event is an API Gateway proxy event
 */
function isApiGatewayEvent(event) {
	return !!(event.httpMethod && event.path);
}

/**
 * Lambda handler for Auth operations.
 *
 * Detects the event type and delegates to the appropriate handler:
 * - Cognito PostConfirmation_ConfirmSignUp → post-confirmation handler
 * - API Gateway proxy (httpMethod + path) → route dispatcher
 * - Unrecognized events → error response
 *
 * @async
 * @param {Object} event - Lambda event (Cognito trigger or API Gateway proxy)
 * @param {Object} context - Lambda context
 * @returns {Promise<Object>} Cognito event (for triggers) or API Gateway proxy response
 * @throws {Error} Re-throws Cognito trigger errors to reject confirmation
 * @example
 * // Cognito trigger invocation
 * const result = await handler(cognitoEvent, context);
 * // Returns modified Cognito event with response.rawApiKey
 *
 * @example
 * // API Gateway invocation
 * const result = await handler(apiGatewayEvent, context);
 * // Returns { statusCode: 200, headers: {...}, body: '...' }
 */
async function handler(event, context) {
	// >! Cognito Post-Confirmation trigger
	if (isCognitoPostConfirmation(event)) {
		try {
			return await postConfirmationHandler.handler(event);
		} catch (error) {
			// >! Log full error for debugging
			console.error('Post-Confirmation trigger error:', error);
			// >! Re-throw to reject the Cognito confirmation
			throw error;
		}
	}

	// >! API Gateway proxy event
	if (isApiGatewayEvent(event)) {
		try {
			return await routeDispatcher.route(event);
		} catch (error) {
			// >! Log full error for debugging but return sanitized response to client
			console.error('API Gateway handler error:', error);
			return {
				statusCode: 500,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ error: 'Internal server error' })
			};
		}
	}

	// >! Unrecognized event type
	console.error('Unrecognized event type:', JSON.stringify(event));
	return {
		statusCode: 400,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ error: 'Unrecognized event type' })
	};
}

module.exports = { handler };
