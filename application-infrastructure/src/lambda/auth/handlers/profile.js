/**
 * Profile Handler
 *
 * Handles GET /auth/profile requests. Validates the Cognito JWT,
 * looks up the user record by email, computes the effective tier
 * (accounting for tier expiration), retrieves rate limit window
 * statistics from the Sessions Table, and returns a consolidated
 * profile response.
 *
 * @module handlers/profile
 */

'use strict';

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { validateJwt } = require('../utils/jwt-validator');
const { queryByEmail, getSessionRecord } = require('../utils/dynamo-client');
const { getRateLimitConfig } = require('../utils/rate-limit-config');
const { computeWindowBoundaries, computeSessionKey } = require('../utils/window-calculator');

const ssmClient = new SSMClient({});

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
 * const salt = await getCachedSsmParam('Mcp_SessionHashSalt');
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
/*  Effective Tier Computation                                        */
/* ------------------------------------------------------------------ */

/**
 * Compute the effective tier for a user, accounting for tier expiration.
 *
 * If `tierExpiresAt` is set and in the past, the effective tier is
 * `'registered'` regardless of the stored tier value. This matches
 * the Read Lambda's behavior.
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

/* ------------------------------------------------------------------ */
/*  Main Handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Handle GET /auth/profile requests.
 *
 * Workflow:
 * 1. Validate JWT from Authorization header
 * 2. Look up user record by email (GSI query)
 * 3. Compute effective tier (handle tierExpiresAt expiration)
 * 4. Get rate limit config for the effective tier
 * 5. Retrieve Mcp_SessionHashSalt from SSM (cached)
 * 6. Compute session partition key and window boundaries
 * 7. Query Sessions Table for current window record
 * 8. Assemble and return consolidated profile response
 *
 * @async
 * @param {Object} event - API Gateway proxy event
 * @param {string} event.httpMethod - HTTP method (GET)
 * @param {string} event.path - Request path (/auth/profile)
 * @param {Object} event.headers - Request headers including Authorization
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} API Gateway proxy response
 * @example
 * // API Gateway invokes this handler for GET /auth/profile
 * const response = await handler(event);
 * // response: { statusCode: 200, headers: {...}, body: '{"email":"...","tier":"...","rateLimits":{...}}' }
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

		// >! Look up user record by email using GSI
		const existingRecords = await queryByEmail(email);

		if (!existingRecords || existingRecords.length === 0) {
			return {
				statusCode: 404,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ error: 'User not found' })
			};
		}

		// >! Use the first matching record (one key per user)
		const userRecord = existingRecords[0];

		// >! Compute effective tier accounting for expiration
		const effectiveTier = computeEffectiveTier(userRecord.tier, userRecord.tierExpiresAt);

		// >! Get rate limit config for the effective tier
		const rateLimitConfig = getRateLimitConfig();
		const tierConfig = rateLimitConfig[effectiveTier];

		// >! Retrieve session salt from SSM (cached)
		const sessionSalt = await getCachedSsmParam('Mcp_SessionHashSalt');

		// >! Compute window boundaries using the same algorithm as the Read Lambda
		const { windowStartMinutes, resetTimeMinutes } = computeWindowBoundaries(tierConfig.windowInMinutes);

		// >! Compute session partition key using the same algorithm as the Read Lambda
		const sessionPk = computeSessionKey(cognitoSub, windowStartMinutes, sessionSalt);

		// >! Query Sessions Table for current window record
		const sessionsTable = process.env.SESSIONS_TABLE;
		const sessionRecord = await getSessionRecord(sessionsTable, sessionPk);

		// >! Compute remaining requests and window reset time
		let remaining;
		if (sessionRecord) {
			remaining = sessionRecord.remaining;
		} else {
			// >! No session record means user hasn't made requests in this window
			remaining = tierConfig.limitPerWindow;
		}

		const windowResetAt = resetTimeMinutes * 60;

		// >! Assemble and return the consolidated profile response
		return {
			statusCode: 200,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
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
			})
		};
	} catch (error) {
		// >! Log full error for debugging but return sanitized error to client
		console.error('Profile retrieval error:', error);
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
	 * @returns {{computeEffectiveTier: Function, getCachedSsmParam: Function, ssmCache: Object, SSM_CACHE_TTL: number}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../handlers/profile');
	 * const { computeEffectiveTier, getCachedSsmParam } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			computeEffectiveTier,
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
