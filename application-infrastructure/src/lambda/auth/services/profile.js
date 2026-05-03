/**
 * Profile Service for Auth Lambda
 *
 * Contains business logic for the GET /mcp/auth/profile endpoint.
 * Looks up the user record, computes the effective tier (accounting
 * for tier expiration), retrieves rate limit and session data, and
 * returns a consolidated profile data object.
 *
 * This service does NOT know about HTTP requests or responses —
 * it only contains business logic.
 *
 * @module services/profile
 */

'use strict';

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const UserDao = require('../models/user');
const { computeWindowBoundaries, computeSessionKey } = require('../utils/window-calculator');

/**
 * Compute the effective tier for a user, accounting for tier expiration.
 *
 * If `tierExpiresAt` is a non-null string and the date is in the past,
 * the effective tier falls back to `'registered'` regardless of the
 * stored tier value. This matches the Read Lambda's behavior.
 *
 * @param {string} tier - Stored tier value (e.g. 'registered', 'paid', 'private')
 * @param {string|null} tierExpiresAt - ISO 8601 expiration timestamp or null
 * @returns {string} Effective tier value
 * @example
 * computeEffectiveTier('paid', '2020-01-01T00:00:00.000Z'); // 'registered' (expired)
 * computeEffectiveTier('paid', '2099-12-31T00:00:00.000Z'); // 'paid' (future)
 * computeEffectiveTier('paid', null);                        // 'paid' (no expiration)
 */
function computeEffectiveTier(tier, tierExpiresAt) {
	if (tierExpiresAt && new Date(tierExpiresAt) < new Date()) {
		return 'registered';
	}
	return tier;
}

/**
 * Retrieve a consolidated profile for the given user.
 *
 * Workflow:
 * 1. Look up user record by email via GSI
 * 2. Compute effective tier (handle tierExpiresAt expiration)
 * 3. Get rate limit config for the effective tier
 * 4. Retrieve session hash salt from CachedSsmParameter
 * 5. Compute window boundaries and session partition key
 * 6. Query Sessions Table for current window record
 * 7. Return consolidated profile data object
 *
 * @async
 * @param {string} email - User email address (from JWT payload)
 * @param {string} cognitoSub - Cognito user sub identifier (from JWT payload)
 * @returns {Promise<Object>} Consolidated profile data
 * @returns {string} return.email - User email address
 * @returns {string} return.tier - Effective tier value
 * @returns {string|null} return.tierExpiresAt - ISO 8601 expiration or null
 * @returns {string} return.createdAt - ISO 8601 creation timestamp
 * @returns {Object} return.rateLimits - Rate limit information
 * @returns {number} return.rateLimits.limit - Maximum requests per window
 * @returns {number} return.rateLimits.remaining - Remaining requests in current window
 * @returns {number} return.rateLimits.windowResetAt - Window reset time in epoch seconds
 * @returns {number} return.rateLimits.windowMinutes - Window duration in minutes
 * @throws {Object} Throws `{ statusCode: 404, message: 'User not found' }` when no user record exists
 * @throws {Error} Throws on DynamoDB or SSM errors
 * @example
 * const profile = await getProfile('user@example.com', 'abc-123-def');
 * // profile: { email: 'user@example.com', tier: 'registered', ... }
 */
async function getProfile(email, cognitoSub) {
	// >! Look up user record by email using GSI
	const existingRecords = await UserDao.queryByEmail(email);

	if (!existingRecords || existingRecords.length === 0) {
		const error = new Error('User not found');
		error.statusCode = 404;
		throw error;
	}

	// >! Use the first matching record (one key per user)
	const userRecord = existingRecords[0];

	// >! Compute effective tier accounting for expiration
	const effectiveTier = computeEffectiveTier(userRecord.tier, userRecord.tierExpiresAt);

	// >! Get rate limit config for the effective tier from settings
	const rateLimits = Config.settings().rateLimits;
	const tierConfig = rateLimits[effectiveTier];

	// >! Retrieve session hash salt from CachedSsmParameter
	const sessionSalt = await Config.settings().ssm.sessionHashSalt.getValue();

	// >! Compute window boundaries using the same algorithm as the Read Lambda
	const { windowStartMinutes, resetTimeMinutes } = computeWindowBoundaries(tierConfig.windowInMinutes);

	// >! Compute session partition key using the same algorithm as the Read Lambda
	const sessionPk = computeSessionKey(cognitoSub, windowStartMinutes, sessionSalt);

	// >! Query Sessions Table for current window record
	const sessionRecord = await UserDao.getSessionRecord(sessionPk);

	// >! Compute remaining requests
	let remaining;
	if (sessionRecord) {
		remaining = sessionRecord.remaining;
	} else {
		// >! No session record means user hasn't made requests in this window
		remaining = tierConfig.limitPerWindow;
	}

	const windowResetAt = resetTimeMinutes * 60;

	// >! Return consolidated profile data object
	return {
		email: userRecord.email,
		tier: effectiveTier,
		tierExpiresAt: userRecord.tierExpiresAt || null,
		createdAt: userRecord.createdAt,
		rateLimits: {
			limit: tierConfig.limitPerWindow,
			remaining,
			windowResetAt,
			windowMinutes: tierConfig.windowInMinutes
		}
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
	 * @returns {{computeEffectiveTier: Function, getProfile: Function}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../services/profile');
	 * const { computeEffectiveTier } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			computeEffectiveTier,
			getProfile
		};
	}
}

module.exports = {
	getProfile,
	computeEffectiveTier,
	TestHarness
};
