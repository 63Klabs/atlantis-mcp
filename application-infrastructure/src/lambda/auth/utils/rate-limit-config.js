/**
 * Rate Limit Configuration Utility for Auth Lambda
 *
 * Reads rate limit configuration from environment variables and returns
 * a structured config object matching the Read Lambda's `settings.js`
 * `rateLimits` structure. Validates that all tiers have configuration.
 *
 * @module utils/rate-limit-config
 */

'use strict';

/**
 * Required rate limit tiers. Each tier must have both a limit and
 * a time range configured via environment variables.
 *
 * @constant
 * @type {Array<string>}
 */
const REQUIRED_TIERS = ['public', 'registered', 'paid', 'private'];

/**
 * Mapping of tier names to their environment variable names.
 *
 * @constant
 * @type {Object.<string, {limit: string, window: string}>}
 */
const TIER_ENV_VARS = {
	public: {
		limit: 'MCP_PUBLIC_RATE_LIMIT',
		window: 'MCP_PUBLIC_RATE_TIME_RANGE_MINUTES'
	},
	registered: {
		limit: 'MCP_REGISTERED_RATE_LIMIT',
		window: 'MCP_REGISTERED_RATE_TIME_RANGE_MINUTES'
	},
	paid: {
		limit: 'MCP_PAID_RATE_LIMIT',
		window: 'MCP_PAID_RATE_TIME_RANGE_MINUTES'
	},
	private: {
		limit: 'MCP_PRIVATE_RATE_LIMIT',
		window: 'MCP_PRIVATE_RATE_TIME_RANGE_MINUTES'
	}
};

/**
 * Read and validate rate limit configuration from environment variables.
 *
 * Returns a config object with `{ public, registered, paid, private }` keys,
 * each containing `{ limitPerWindow, windowInMinutes }` — matching the
 * Read Lambda's `settings.rateLimits` structure.
 *
 * @returns {{public: {limitPerWindow: number, windowInMinutes: number}, registered: {limitPerWindow: number, windowInMinutes: number}, paid: {limitPerWindow: number, windowInMinutes: number}, private: {limitPerWindow: number, windowInMinutes: number}}} Rate limit configuration for all tiers
 * @throws {Error} If any tier is missing its environment variables or values are invalid
 * @example
 * const { getRateLimitConfig } = require('./utils/rate-limit-config');
 * const config = getRateLimitConfig();
 * // config.registered.limitPerWindow → 100
 * // config.registered.windowInMinutes → 60
 */
function getRateLimitConfig() {
	const config = {};

	for (const tier of REQUIRED_TIERS) {
		const envVars = TIER_ENV_VARS[tier];
		const rawLimit = process.env[envVars.limit];
		const rawWindow = process.env[envVars.window];

		// >! Validate that both env vars exist for each tier
		if (rawLimit === undefined || rawLimit === '') {
			throw new Error(`Missing rate limit environment variable: ${envVars.limit}`);
		}
		if (rawWindow === undefined || rawWindow === '') {
			throw new Error(`Missing rate limit environment variable: ${envVars.window}`);
		}

		const limitPerWindow = parseInt(rawLimit, 10);
		const windowInMinutes = parseInt(rawWindow, 10);

		// >! Validate parsed values are positive integers
		if (isNaN(limitPerWindow) || limitPerWindow <= 0) {
			throw new Error(`Invalid rate limit value for ${envVars.limit}: ${rawLimit}`);
		}
		if (isNaN(windowInMinutes) || windowInMinutes <= 0) {
			throw new Error(`Invalid rate limit window for ${envVars.window}: ${rawWindow}`);
		}

		config[tier] = { limitPerWindow, windowInMinutes };
	}

	return config;
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
	 * Get access to internal functions and constants for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{getRateLimitConfig: Function, REQUIRED_TIERS: Array<string>, TIER_ENV_VARS: Object}} Object containing internal functions and constants
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../utils/rate-limit-config');
	 * const { getRateLimitConfig, REQUIRED_TIERS, TIER_ENV_VARS } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			getRateLimitConfig,
			REQUIRED_TIERS,
			TIER_ENV_VARS
		};
	}
}

module.exports = {
	getRateLimitConfig,
	TestHarness
};
