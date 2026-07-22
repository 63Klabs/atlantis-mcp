/**
 * Voucher Redemption Service for Auth Lambda
 *
 * Contains business logic for the POST /mcp/auth/voucher/redeem endpoint.
 * Validates the voucher, updates the user's tier, increments voucher uses,
 * and updates Cognito custom:tier.
 *
 * This service does NOT know about HTTP requests or responses —
 * it only contains business logic.
 *
 * @module services/voucher-redeem
 */

'use strict';

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const UserDao = require('../models/user');
const VoucherDao = require('../models/voucher');
const CognitoService = require('./cognito');

/**
 * Validate that a voucher exists, is not expired, and has uses remaining.
 *
 * @param {Object|null} voucher - Voucher record from DynamoDB or null
 * @param {string} code - Voucher code (for error messages)
 * @returns {{statusCode: number, message: string}|null} Error object or null if valid
 * @example
 * const error = validateVoucher(voucher, 'SUMMER2025');
 * if (error) throw error;
 */
function validateVoucher(voucher, code) {
	if (!voucher) {
		return { statusCode: 400, message: 'Invalid voucher code' };
	}

	// >! Check if voucher has expired
	const now = new Date();
	if (new Date(voucher.expiresAt) < now) {
		return { statusCode: 400, message: 'Voucher has expired' };
	}

	// >! Check if voucher has been fully redeemed (maxUses=0 means unlimited)
	if (voucher.maxUses > 0 && voucher.currentUses >= voucher.maxUses) {
		return { statusCode: 400, message: 'Voucher has been fully redeemed' };
	}

	return null;
}

/**
 * Redeem a voucher for the given user.
 *
 * Workflow:
 * 1. Look up voucher record by code
 * 2. Validate voucher (exists, not expired, uses remaining)
 * 3. Look up user record by email (GSI query)
 * 4. Compute tier expiration and TTL
 * 5. Update user tier, tierExpiresAt, and ttl in DynamoDB
 * 6. Atomically increment voucher currentUses counter
 * 7. Update Cognito custom:tier attribute
 * 8. Return new tier, expiration, and success message
 *
 * @async
 * @param {string} code - Voucher code to redeem
 * @param {string} email - User email address (from JWT payload)
 * @param {string} cognitoSub - Cognito user sub identifier (from JWT payload)
 * @returns {Promise<{tier: string, tierExpiresAt: string, message: string}>} Redemption result
 * @throws {Object} Throws with `statusCode` and `message` for validation errors (400, 404)
 * @throws {Error} Throws on DynamoDB or Cognito errors
 * @example
 * const result = await redeemVoucher('SUMMER2025', 'user@example.com', 'abc-123-def');
 * // result: { tier: 'paid', tierExpiresAt: '2025-07-15T...', message: 'Voucher redeemed successfully' }
 */
async function redeemVoucher(code, email, cognitoSub) {
	// >! Look up voucher record by code
	const voucher = await VoucherDao.getVoucher(code);

	// >! Validate voucher: exists, not expired, uses remaining
	const voucherError = validateVoucher(voucher, code);
	if (voucherError) {
		const error = new Error(voucherError.message);
		error.statusCode = voucherError.statusCode;
		throw error;
	}

	// >! Look up user record by email using GSI
	const existingRecords = await UserDao.queryByEmail(email);

	if (!existingRecords || existingRecords.length === 0) {
		const error = new Error('User not found');
		error.statusCode = 404;
		throw error;
	}

	const userRecord = existingRecords[0];

	// >! Compute tier expiration and TTL
	const now = new Date();
	const tierExpiresAt = new Date(now.getTime() + voucher.durationDays * 24 * 60 * 60 * 1000).toISOString();
	const ttl = Math.floor(now.getTime() / 1000) + (120 * 24 * 60 * 60);

	// >! Update user tier, tierExpiresAt, and ttl in DynamoDB
	await UserDao.updateUserTier(userRecord.pk, voucher.targetTier, tierExpiresAt, ttl);

	// >! Atomically increment voucher currentUses counter
	await VoucherDao.incrementVoucherUses(code);

	// >! Update Cognito custom:tier attribute to match new tier
	await CognitoService.updateUserAttributes(cognitoSub, [
		{ Name: 'custom:tier', Value: voucher.targetTier }
	]);

	// >! Return new tier and expiration
	return {
		tier: voucher.targetTier,
		tierExpiresAt,
		message: 'Voucher redeemed successfully'
	};
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
	 * @returns {{validateVoucher: Function, redeemVoucher: Function}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../services/voucher-redeem');
	 * const { validateVoucher, redeemVoucher } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			validateVoucher,
			redeemVoucher
		};
	}
}

module.exports = {
	redeemVoucher,
	validateVoucher,
	TestHarness
};
