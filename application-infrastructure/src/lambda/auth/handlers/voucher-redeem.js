/**
 * Voucher Redemption Handler
 *
 * Handles POST /auth/voucher/redeem requests. Validates the Cognito JWT,
 * looks up the voucher record by code, validates expiration and usage limits,
 * updates the user's tier and tierExpiresAt, atomically increments the
 * voucher's currentUses counter, and updates Cognito custom:tier.
 *
 * @module handlers/voucher-redeem
 */

'use strict';

const { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { validateJwt } = require('../utils/jwt-validator');
const { queryByEmail, getVoucher, incrementVoucherUses, updateUserTier } = require('../utils/dynamo-client');

const cognitoClient = new CognitoIdentityProviderClient({});

/* ------------------------------------------------------------------ */
/*  Voucher Validation Helpers                                        */
/* ------------------------------------------------------------------ */

/**
 * Validate that a voucher exists, is not expired, and has uses remaining.
 *
 * @param {Object|null} voucher - Voucher record from DynamoDB or null
 * @param {string} code - Voucher code (for error messages)
 * @returns {{statusCode: number, error: string}|null} Error response or null if valid
 * @example
 * const error = validateVoucher(voucher, 'SUMMER2025');
 * if (error) return { statusCode: error.statusCode, headers, body: JSON.stringify({ error: error.error }) };
 */
function validateVoucher(voucher, code) {
	if (!voucher) {
		return { statusCode: 400, error: 'Invalid voucher code' };
	}

	// >! Check if voucher has expired
	const now = new Date();
	if (new Date(voucher.expiresAt) < now) {
		return { statusCode: 400, error: 'Voucher has expired' };
	}

	// >! Check if voucher has been fully redeemed (maxUses=0 means unlimited)
	if (voucher.maxUses > 0 && voucher.currentUses >= voucher.maxUses) {
		return { statusCode: 400, error: 'Voucher has been fully redeemed' };
	}

	return null;
}

/* ------------------------------------------------------------------ */
/*  Main Handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Handle POST /auth/voucher/redeem requests.
 *
 * Workflow:
 * 1. Validate JWT from Authorization header
 * 2. Parse voucher code from request body
 * 3. Look up voucher record at VOUCHER#<code>
 * 4. Validate: exists, not expired, uses remaining
 * 5. Look up user by email (from JWT payload) using GSI
 * 6. Update user tier to voucher's targetTier, set tierExpiresAt, update ttl
 * 7. Atomically increment voucher currentUses
 * 8. Update Cognito custom:tier
 * 9. Return new tier and expiration in response
 *
 * @async
 * @param {Object} event - API Gateway proxy event
 * @param {string} event.httpMethod - HTTP method (POST)
 * @param {string} event.path - Request path (/auth/voucher/redeem)
 * @param {Object} event.headers - Request headers including Authorization
 * @param {string} event.body - JSON body with voucher code
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} API Gateway proxy response
 * @example
 * // API Gateway invokes this handler for POST /auth/voucher/redeem
 * const response = await handler(event);
 * // response: { statusCode: 200, headers: {...}, body: '{"tier":"paid","tierExpiresAt":"...","message":"..."}' }
 */
async function handler(event) {
	try {
		// >! Validate JWT — throws { statusCode: 401 } on failure
		let payload;
		try {
			payload = await validateJwt(event);
		} catch (err) {
			return {
				statusCode: 401,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ error: 'Unauthorized' })
			};
		}

		// >! Parse voucher code from request body
		let voucherCode;
		try {
			const body = JSON.parse(event.body || '{}');
			voucherCode = body.code;
		} catch (err) {
			return {
				statusCode: 400,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ error: 'Voucher code is required' })
			};
		}

		if (!voucherCode) {
			return {
				statusCode: 400,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ error: 'Voucher code is required' })
			};
		}

		// >! Look up voucher record by code
		const voucher = await getVoucher(voucherCode);

		// >! Validate voucher: exists, not expired, uses remaining
		const voucherError = validateVoucher(voucher, voucherCode);
		if (voucherError) {
			return {
				statusCode: voucherError.statusCode,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ error: voucherError.error })
			};
		}

		const email = payload.email;
		const cognitoSub = payload.sub;
		const userPoolId = process.env.COGNITO_USER_POOL_ID;

		// >! Look up user record by email using GSI
		const existingRecords = await queryByEmail(email);

		if (!existingRecords || existingRecords.length === 0) {
			return {
				statusCode: 404,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ error: 'User not found' })
			};
		}

		const userRecord = existingRecords[0];

		// >! Compute tier expiration and TTL
		const now = new Date();
		const tierExpiresAt = new Date(now.getTime() + voucher.durationDays * 24 * 60 * 60 * 1000).toISOString();
		const ttl = Math.floor(now.getTime() / 1000) + (120 * 24 * 60 * 60);

		// >! Update user tier, tierExpiresAt, and ttl in DynamoDB
		await updateUserTier(userRecord.pk, voucher.targetTier, tierExpiresAt, ttl);

		// >! Atomically increment voucher currentUses counter
		await incrementVoucherUses(voucherCode);

		// >! Update Cognito custom:tier attribute to match new tier
		await cognitoClient.send(new AdminUpdateUserAttributesCommand({
			UserPoolId: userPoolId,
			Username: cognitoSub,
			UserAttributes: [
				{ Name: 'custom:tier', Value: voucher.targetTier }
			]
		}));

		// >! Return new tier and expiration in response
		return {
			statusCode: 200,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				tier: voucher.targetTier,
				tierExpiresAt,
				message: 'Voucher redeemed successfully'
			})
		};
	} catch (error) {
		// >! Log full error for debugging but return sanitized error to client
		console.error('Voucher redemption error:', error);
		return {
			statusCode: 500,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: 'Internal server error' })
		};
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
	 * Get access to internal functions for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{validateVoucher: Function}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../handlers/voucher-redeem');
	 * const { validateVoucher } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			validateVoucher
		};
	}
}

module.exports = {
	handler,
	TestHarness
};
