/**
 * Configuration settings for Auth Lambda
 *
 * Parses environment variables and provides structured configuration
 * for DynamoDB table names, SSM parameter paths, Cognito configuration,
 * and rate limit configuration for all access tiers.
 *
 * @module config/settings
 */

'use strict';

const { tools: { CachedSsmParameter } } = require('@63klabs/cache-data');

/**
 * Application settings object for the Auth Lambda.
 *
 * Organized into logical sections:
 * - DynamoDB table names (usersTable, sessionsTable)
 * - SSM-backed Cognito configuration (cognito.userPoolId)
 * - SSM-backed secrets (ssm.apiKeyHashSalt, ssm.sessionHashSalt)
 * - Rate limit configuration per tier (rateLimits)
 *
 * @type {Object}
 */
const settings = {

	// DynamoDB table names
	/**
	 * DynamoDB Users table name.
	 * Read from the USERS_TABLE environment variable.
	 * @type {string}
	 */
	usersTable: process.env.USERS_TABLE || '',

	/**
	 * DynamoDB Sessions table name.
	 * Read from the SESSIONS_TABLE environment variable.
	 * @type {string}
	 */
	sessionsTable: process.env.SESSIONS_TABLE || '',

	// Cognito SSM Parameters
	/**
	 * Cognito configuration backed by SSM Parameter Store.
	 * @type {Object}
	 */
	cognito: {
		/**
		 * Cognito User Pool ID from SSM Parameter Store.
		 *
		 * Retrieved via CachedSsmParameter at the path:
		 * `{PARAM_STORE_PATH}app-stack/Mcp_CognitoUserPoolId`
		 *
		 * @type {CachedSsmParameter}
		 */
		userPoolId: new CachedSsmParameter(
			(process.env.PARAM_STORE_PATH || '') + 'app-stack/Mcp_CognitoUserPoolId',
			{ refreshAfter: 300 } // 5 minutes
		),
	},

	// SSM-backed secrets
	/**
	 * SSM-backed secret parameters.
	 * @type {Object}
	 */
	ssm: {
		/**
		 * API key hash salt from SSM Parameter Store.
		 *
		 * Used for HMAC-SHA256 hashing of API keys.
		 * Path: `{PARAM_STORE_PATH}Mcp_ApiKeyHashSalt`
		 *
		 * @type {CachedSsmParameter}
		 */
		apiKeyHashSalt: new CachedSsmParameter(
			(process.env.PARAM_STORE_PATH || '') + 'Mcp_ApiKeyHashSalt',
			{ refreshAfter: 300 } // 5 minutes
		),

		/**
		 * Session hash salt from SSM Parameter Store.
		 *
		 * Used for SHA-256 hashing of session identifiers.
		 * Path: `{PARAM_STORE_PATH}Mcp_SessionHashSalt`
		 *
		 * @type {CachedSsmParameter}
		 */
		sessionHashSalt: new CachedSsmParameter(
			(process.env.PARAM_STORE_PATH || '') + 'Mcp_SessionHashSalt',
			{ refreshAfter: 300 } // 5 minutes
		),
	},

	// Rate limit configuration (moved from utils/rate-limit-config.js)
	/**
	 * Rate limit configuration for different access tiers.
	 *
	 * Each tier defines:
	 * - limitPerWindow: Maximum requests allowed in the window
	 * - windowInMinutes: Duration of the rate limit window
	 *
	 * @type {Object}
	 */
	rateLimits: {
		/**
		 * Public rate limit (unauthenticated requests).
		 * Default: 50 requests per 60 minutes.
		 * @type {{limitPerWindow: number, windowInMinutes: number}}
		 */
		public: {
			limitPerWindow: parseInt(process.env.MCP_PUBLIC_RATE_LIMIT || '50', 10),
			windowInMinutes: parseInt(process.env.MCP_PUBLIC_RATE_TIME_RANGE_MINUTES || '60', 10),
		},
		/**
		 * Registered user rate limit.
		 * Default: 100 requests per 60 minutes.
		 * @type {{limitPerWindow: number, windowInMinutes: number}}
		 */
		registered: {
			limitPerWindow: parseInt(process.env.MCP_REGISTERED_RATE_LIMIT || '100', 10),
			windowInMinutes: parseInt(process.env.MCP_REGISTERED_RATE_TIME_RANGE_MINUTES || '60', 10),
		},
		/**
		 * Paid user rate limit.
		 * Default: 3000 requests per 1440 minutes (24 hours).
		 * @type {{limitPerWindow: number, windowInMinutes: number}}
		 */
		paid: {
			limitPerWindow: parseInt(process.env.MCP_PAID_RATE_LIMIT || '3000', 10),
			windowInMinutes: parseInt(process.env.MCP_PAID_RATE_TIME_RANGE_MINUTES || '1440', 10),
		},
		/**
		 * Private/admin rate limit.
		 * Default: 6000 requests per 1440 minutes (24 hours).
		 * @type {{limitPerWindow: number, windowInMinutes: number}}
		 */
		private: {
			limitPerWindow: parseInt(process.env.MCP_PRIVATE_RATE_LIMIT || '6000', 10),
			windowInMinutes: parseInt(process.env.MCP_PRIVATE_RATE_TIME_RANGE_MINUTES || '1440', 10),
		},
	},
};

module.exports = settings;
