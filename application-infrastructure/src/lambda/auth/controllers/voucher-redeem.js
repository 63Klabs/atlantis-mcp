/**
 * Voucher Redeem Controller for Auth Lambda
 *
 * Handles POST /mcp/auth/voucher/redeem requests. Validates the Cognito JWT,
 * parses the voucher code from the request body, delegates to
 * VoucherRedeemService for business logic, and populates the response
 * object with the redemption result or appropriate error.
 *
 * This controller receives `props` (from `clientRequest.getProps()`)
 * and a `response` object from the route dispatcher.
 *
 * @module controllers/voucher-redeem
 */

'use strict';

const { tools: { DebugAndLog, Timer } } = require('@63klabs/cache-data');
const { validateJwt } = require('../utils/jwt-validator');
const VoucherRedeemService = require('../services/voucher-redeem');
const { Config } = require('../config');

/**
 * Voucher Redeem Controller class.
 *
 * Orchestrates the voucher redemption flow: JWT validation → body parsing → service call → response.
 *
 * @example
 * // Called by route dispatcher
 * const VoucherRedeemController = require('../controllers/voucher-redeem');
 * await VoucherRedeemController.post(props, response);
 */
class VoucherRedeemController {

	/**
	 * Handle POST /mcp/auth/voucher/redeem request.
	 *
	 * Validates the JWT from the Authorization header, parses the
	 * voucher code from `props.body`, calls
	 * VoucherRedeemService.redeemVoucher() with the code, email, and
	 * sub from the JWT payload, and sets the response status and body.
	 *
	 * @async
	 * @param {Object} props - Parsed request properties from clientRequest.getProps()
	 * @param {string|Object} [props.body] - Request body (may be JSON string or parsed object)
	 * @param {Object} response - Response object with setStatusCode() and setBody() methods
	 * @returns {Promise<void>}
	 * @example
	 * await VoucherRedeemController.post(props, response);
	 * // On success: response status 200, body = { tier, tierExpiresAt, message }
	 * // On 401: response status 401, body = { error: 'Unauthorized' }
	 * // On 400: response status 400, body = { error: '...' }
	 * // On 404: response status 404, body = { error: 'User not found' }
	 * // On 500: response status 500, body = { error: 'Internal server error' }
	 */
	static async post(props, response) {
		const timer = new Timer('VoucherRedeemController.post', true);
		try {
			// >! Validate JWT — throws { statusCode: 401 } on failure
			const userPoolId = await Config.settings().cognito.userPoolId.getValue();
			const jwtPayload = await validateJwt(props, userPoolId);

			// >! Parse voucher code from request body
			let voucherCode;
			try {
				const body = typeof props.body === 'string'
					? JSON.parse(props.body || '{}')
					: (props.body || {});
				voucherCode = body.code;
			} catch (parseError) {
				response.setStatusCode(400);
				response.setBody({ error: 'Voucher code is required' });
				return;
			}

			if (!voucherCode) {
				response.setStatusCode(400);
				response.setBody({ error: 'Voucher code is required' });
				return;
			}

			// >! Delegate to service layer for business logic
			const result = await VoucherRedeemService.redeemVoucher(
				voucherCode,
				jwtPayload.email,
				jwtPayload.sub
			);

			response.setStatusCode(200);
			response.setBody(result);
		} catch (error) {
			if (error.statusCode === 401) {
				response.setStatusCode(401);
				response.setBody({ error: 'Unauthorized' });
			} else if (error.statusCode === 400) {
				response.setStatusCode(400);
				response.setBody({ error: error.message });
			} else if (error.statusCode === 404) {
				response.setStatusCode(404);
				response.setBody({ error: 'User not found' });
			} else {
				// >! Log full error for debugging but return sanitized error to client
				DebugAndLog.error(`VoucherRedeemController.post error: ${error.message}`, error.stack);
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
	 * @returns {{VoucherRedeemController: typeof VoucherRedeemController}} Object containing internal classes
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../controllers/voucher-redeem');
	 * const { VoucherRedeemController } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			VoucherRedeemController
		};
	}
}

module.exports = VoucherRedeemController;
module.exports.TestHarness = TestHarness;
