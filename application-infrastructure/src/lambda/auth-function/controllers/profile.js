/**
 * Profile Controller for Auth Lambda
 *
 * Handles GET /mcp/auth/profile requests. Validates the Cognito JWT,
 * delegates to ProfileService for business logic, and populates the
 * response object with the profile data or appropriate error.
 *
 * This controller receives `props` (from `clientRequest.getProps()`)
 * and a `response` object from the route dispatcher.
 *
 * @module controllers/profile
 */

'use strict';

const { tools: { DebugAndLog, Timer } } = require('@63klabs/cache-data');
const { validateJwt } = require('../utils/jwt-validator');
const ProfileService = require('../services/profile');
const { Config } = require('../config');

/**
 * Profile Controller class.
 *
 * Orchestrates the profile retrieval flow: JWT validation → service call → response.
 *
 * @example
 * // Called by route dispatcher
 * const ProfileController = require('../controllers/profile');
 * await ProfileController.get(props, response);
 */
class ProfileController {

	/**
	 * Handle GET /mcp/auth/profile request.
	 *
	 * Validates the JWT from the Authorization header, calls
	 * ProfileService.getProfile() with the email and sub from the
	 * JWT payload, and sets the response status and body.
	 *
	 * @async
	 * @param {Object} props - Parsed request properties from clientRequest.getProps()
	 * @param {Object} response - Response object with setStatusCode() and setBody() methods
	 * @returns {Promise<void>}
	 * @example
	 * await ProfileController.get(props, response);
	 * // On success: response status 200, body = profile data
	 * // On 401: response status 401, body = { error: 'Unauthorized' }
	 * // On 404: response status 404, body = { error: 'User not found' }
	 * // On 500: response status 500, body = { error: 'Internal server error' }
	 */
	static async get(props, response) {
		const timer = new Timer('ProfileController.get', true);
		try {
			// >! Validate JWT — throws { statusCode: 401 } on failure
			const userPoolId = await Config.settings().cognito.userPoolId.getValue();
			const jwtPayload = await validateJwt(props, userPoolId);

			// >! Delegate to service layer for business logic
			const profileData = await ProfileService.getProfile(
				jwtPayload.email,
				jwtPayload.sub
			);

			response.setStatusCode(200);
			response.setBody(profileData);
		} catch (error) {
			if (error.statusCode === 401) {
				response.setStatusCode(401);
				response.setBody({ error: 'Unauthorized' });
			} else if (error.statusCode === 404) {
				response.setStatusCode(404);
				response.setBody({ error: 'User not found' });
			} else {
				// >! Log full error for debugging but return sanitized error to client
				DebugAndLog.error(`ProfileController.get error: ${error.message}`, error.stack);
				response.setStatusCode(500);
				response.setBody({ error: 'Internal server error' });
			}
		} finally {
			timer.stop();
		}
	}
}

/* ------------------------------------------------------------------ */
/*  TestHarness (for testing private internals)                       */
/* ------------------------------------------------------------------ */

/**
 * Test harness for accessing internal functions for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
	/**
	 * Get access to internal classes for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{ProfileController: typeof ProfileController}} Object containing internal classes
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../controllers/profile');
	 * const { ProfileController } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			ProfileController
		};
	}
}

module.exports = ProfileController;
module.exports.TestHarness = TestHarness;
