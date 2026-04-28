/**
 * API Key Generation and Hashing Utility
 *
 * Provides functions for generating static API keys and computing
 * HMAC-SHA256 hashes for secure storage. Uses Node.js built-in
 * `crypto` module only — no external dependencies.
 *
 * @module utils/api-key
 */

'use strict';

const crypto = require('crypto');

/**
 * Generate a new API key in the format `atl_` + 32 random hex characters.
 *
 * The `atl_` prefix enables secret scanning tools to identify leaked keys.
 * The 16 random bytes (128-bit entropy) provide sufficient uniqueness.
 *
 * @returns {string} API key matching `/^atl_[0-9a-f]{32}$/`
 * @example
 * const { generateApiKey } = require('./utils/api-key');
 * const key = generateApiKey();
 * // key: 'atl_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
 */
function generateApiKey() {
	// >! 16 random bytes = 128-bit entropy, hex-encoded to 32 chars
	return 'atl_' + crypto.randomBytes(16).toString('hex');
}

/**
 * Compute the HMAC-SHA256 hash of an API key using the provided salt.
 *
 * The hash is deterministic: same key + same salt always produces the
 * same 64-character hex digest. The raw key is never stored — only
 * this hash is persisted in DynamoDB and Cognito.
 *
 * @param {string} rawKey - The raw API key to hash
 * @param {string} salt - The HMAC key from `Mcp_ApiKeyHashSalt` SSM parameter
 * @returns {string} 64-character lowercase hex HMAC-SHA256 digest
 * @example
 * const { hashApiKey } = require('./utils/api-key');
 * const hash = hashApiKey('atl_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', 'my-salt');
 * // hash: '3f2a...' (64 hex chars)
 */
function hashApiKey(rawKey, salt) {
	// >! HMAC-SHA256 with SSM salt prevents rainbow table attacks
	return crypto.createHmac('sha256', salt).update(rawKey).digest('hex');
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
	 * @returns {{generateApiKey: Function, hashApiKey: Function}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../utils/api-key');
	 * const { generateApiKey, hashApiKey } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			generateApiKey,
			hashApiKey
		};
	}
}

module.exports = {
	generateApiKey,
	hashApiKey,
	TestHarness
};
