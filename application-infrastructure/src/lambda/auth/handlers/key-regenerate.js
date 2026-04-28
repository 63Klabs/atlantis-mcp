/**
 * API Key Regeneration Handler
 *
 * Handles POST /auth/key/regenerate requests. Validates the Cognito JWT,
 * looks up the existing user record by email, generates a new API key,
 * deletes the old key record, creates a new key record preserving user
 * fields, updates Cognito custom:api_key, and returns the new raw key.
 *
 * @module handlers/key-regenerate
 */

'use strict';

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { validateJwt } = require('../utils/jwt-validator');
const { generateApiKey, hashApiKey } = require('../utils/api-key');
const { queryByEmail, deleteUserRecord, putUserRecord } = require('../utils/dynamo-client');

const ssmClient = new SSMClient({});
const cognitoClient = new CognitoIdentityProviderClient({});

/* ------------------------------------------------------------------ */
/*  SSM Parameter Cache                                               */
/* ------------------------------------------------------------------ */

/** @type {Object.<string, {value: string, time: number}>} */
const ssmCache = {};

/** SSM cache TTL in milliseconds (5 minutes) */
const SSM_CACHE_TTL = 5 * 60 * 1000;

/**
 * Retrieve an SSM parameter with module-level caching.
 *
 * @param {string} paramName - Parameter name (appended to PARAM_STORE_PATH)
 * @returns {Promise<string>} Parameter value
 * @example
 * const salt = await getCachedSsmParam('Mcp_ApiKeyHashSalt');
 */
async function getCachedSsmParam(paramName) {
	const now = Date.now();
	const cached = ssmCache[paramName];
	if (cached && (now - cached.time) < SSM_CACHE_TTL) {
		return cached.value;
	}

	const fullPath = process.env.PARAM_STORE_PATH + paramName;
	const result = await ssmClient.send(new GetParameterCommand({
		Name: fullPath,
		WithDecryption: true
	}));

	const value = result.Parameter.Value;
	ssmCache[paramName] = { value, time: now };
	return value;
}

/* ------------------------------------------------------------------ */
/*  Main Handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Handle POST /auth/key/regenerate requests.
 *
 * Workflow:
 * 1. Validate JWT from Authorization header
 * 2. Look up existing user record by email (GSI query)
 * 3. Generate new API key, compute HMAC-SHA256 hash
 * 4. Delete old key record from Users table
 * 5. Create new key record preserving email, tier, cognitoSub, tierExpiresAt
 * 6. Update Cognito custom:api_key with new hash
 * 7. Return new raw key in response
 *
 * @async
 * @param {Object} event - API Gateway proxy event
 * @param {string} event.httpMethod - HTTP method (POST)
 * @param {string} event.path - Request path (/auth/key/regenerate)
 * @param {Object} event.headers - Request headers including Authorization
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} API Gateway proxy response
 * @example
 * // API Gateway invokes this handler for POST /auth/key/regenerate
 * const response = await handler(event);
 * // response: { statusCode: 200, headers: {...}, body: '{"apiKey":"atl_...","message":"..."}' }
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

		const email = payload.email;
		const cognitoSub = payload.sub;
		const userPoolId = process.env.COGNITO_USER_POOL_ID;

		// >! Look up existing user record by email using GSI
		const existingRecords = await queryByEmail(email);

		if (!existingRecords || existingRecords.length === 0) {
			return {
				statusCode: 404,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ error: 'User not found' })
			};
		}

		// >! Use the first matching record (one key per user)
		const existingRecord = existingRecords[0];

		// >! Retrieve hash salt from SSM (cached)
		const salt = await getCachedSsmParam('Mcp_ApiKeyHashSalt');

		// >! Generate new API key and compute HMAC-SHA256 hash
		const rawKey = generateApiKey();
		const newKeyHash = hashApiKey(rawKey, salt);

		// >! Compute TTL: 120 days from now in Unix epoch seconds
		const now = new Date();
		const ttl = Math.floor(now.getTime() / 1000) + (120 * 24 * 60 * 60);

		// >! Delete old key record
		await deleteUserRecord(existingRecord.pk);

		// >! Create new key record preserving email, tier, cognitoSub, tierExpiresAt
		await putUserRecord({
			pk: `KEY#${newKeyHash}`,
			email: existingRecord.email,
			tier: existingRecord.tier,
			cognitoSub: existingRecord.cognitoSub,
			createdAt: now.toISOString(),
			ttl,
			tierExpiresAt: existingRecord.tierExpiresAt || null
		});

		// >! Update Cognito custom:api_key with new hash
		await cognitoClient.send(new AdminUpdateUserAttributesCommand({
			UserPoolId: userPoolId,
			Username: cognitoSub,
			UserAttributes: [
				{ Name: 'custom:api_key', Value: newKeyHash }
			]
		}));

		// >! Return new raw key in response (shown to user once)
		return {
			statusCode: 200,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				apiKey: rawKey,
				message: 'API key regenerated successfully'
			})
		};
	} catch (error) {
		// >! Log full error for debugging but return sanitized error to client
		console.error('Key regeneration error:', error);
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
	 * @returns {{getCachedSsmParam: Function, ssmCache: Object, SSM_CACHE_TTL: number}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../handlers/key-regenerate');
	 * const { getCachedSsmParam } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			getCachedSsmParam,
			ssmCache,
			SSM_CACHE_TTL
		};
	}
}

module.exports = {
	handler,
	TestHarness
};
