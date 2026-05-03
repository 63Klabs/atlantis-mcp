/**
 * Key Regeneration Service for Auth Lambda
 *
 * Contains business logic for the POST /mcp/auth/key/regenerate endpoint.
 * Looks up the user record, generates a new API key, deletes the old
 * key record, creates a new key record preserving user fields, and
 * updates Cognito custom:api_key.
 *
 * This service does NOT know about HTTP requests or responses —
 * it only contains business logic.
 *
 * @module services/key-regenerate
 */

'use strict';

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const UserDao = require('../models/user');
const CognitoService = require('./cognito');
const { generateApiKey, hashApiKey } = require('../utils/api-key');

/**
 * Regenerate the API key for the given user.
 *
 * Workflow:
 * 1. Look up existing user record by email (GSI query)
 * 2. Retrieve API key hash salt from CachedSsmParameter
 * 3. Generate new API key and compute HMAC-SHA256 hash
 * 4. Delete old key record from Users table
 * 5. Create new key record preserving email, tier, cognitoSub, tierExpiresAt
 * 6. Update Cognito custom:api_key with new hash
 * 7. Return new raw key and success message
 *
 * @async
 * @param {string} email - User email address (from JWT payload)
 * @param {string} cognitoSub - Cognito user sub identifier (from JWT payload)
 * @returns {Promise<{apiKey: string, message: string}>} New API key and success message
 * @throws {Object} Throws `{ statusCode: 404, message: 'User not found' }` when no user record exists
 * @throws {Error} Throws on DynamoDB, SSM, or Cognito errors
 * @example
 * const result = await regenerateKey('user@example.com', 'abc-123-def');
 * // result: { apiKey: 'atl_a1b2c3...', message: 'API key regenerated successfully' }
 */
async function regenerateKey(email, cognitoSub) {
	// >! Look up existing user record by email using GSI
	const existingRecords = await UserDao.queryByEmail(email);

	if (!existingRecords || existingRecords.length === 0) {
		const error = new Error('User not found');
		error.statusCode = 404;
		throw error;
	}

	// >! Use the first matching record (one key per user)
	const existingRecord = existingRecords[0];

	// >! Retrieve hash salt from CachedSsmParameter
	const salt = await Config.settings().ssm.apiKeyHashSalt.getValue();

	// >! Generate new API key and compute HMAC-SHA256 hash
	const rawKey = generateApiKey();
	const newKeyHash = hashApiKey(rawKey, salt);

	// >! Compute TTL: 120 days from now in Unix epoch seconds
	const now = new Date();
	const ttl = Math.floor(now.getTime() / 1000) + (120 * 24 * 60 * 60);

	// >! Delete old key record
	await UserDao.deleteUserRecord(existingRecord.pk);

	// >! Create new key record preserving email, tier, cognitoSub, tierExpiresAt
	await UserDao.putUserRecord({
		pk: `KEY#${newKeyHash}`,
		email: existingRecord.email,
		tier: existingRecord.tier,
		cognitoSub: existingRecord.cognitoSub,
		createdAt: now.toISOString(),
		ttl,
		tierExpiresAt: existingRecord.tierExpiresAt || null
	});

	// >! Update Cognito custom:api_key with new hash
	await CognitoService.updateUserAttributes(cognitoSub, [
		{ Name: 'custom:api_key', Value: newKeyHash }
	]);

	// >! Return new raw key (shown to user once)
	return {
		apiKey: rawKey,
		message: 'API key regenerated successfully'
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
	 * @returns {{regenerateKey: Function}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../services/key-regenerate');
	 * const { regenerateKey } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			regenerateKey
		};
	}
}

module.exports = {
	regenerateKey,
	TestHarness
};
