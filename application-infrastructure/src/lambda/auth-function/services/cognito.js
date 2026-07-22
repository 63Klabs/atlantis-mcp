/**
 * Cognito Service for Auth Lambda
 *
 * Encapsulates CognitoIdentityProviderClient operations for updating
 * user attributes (custom:api_key, custom:tier). Retrieves the User
 * Pool ID from CachedSsmParameter via Config.settings().
 *
 * Used by KeyRegenerateService and VoucherRedeemService to update
 * Cognito user attributes after DynamoDB changes.
 *
 * @module services/cognito
 */

'use strict';

const { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { Config } = require('../config');

const cognitoClient = new CognitoIdentityProviderClient({});

/**
 * Update user attributes in Cognito User Pool.
 *
 * Retrieves the User Pool ID from CachedSsmParameter via
 * `Config.settings().cognito.userPoolId.getValue()` and sends
 * an AdminUpdateUserAttributesCommand to Cognito.
 *
 * @async
 * @param {string} cognitoSub - Cognito user sub identifier (Username)
 * @param {Array<{Name: string, Value: string}>} attributes - Array of attribute objects to update
 * @returns {Promise<void>}
 * @throws {Error} If Cognito SDK call fails or User Pool ID retrieval fails
 * @example
 * // Update custom:api_key attribute
 * await updateUserAttributes('abc-123-def', [
 *   { Name: 'custom:api_key', Value: 'new-key-hash' }
 * ]);
 *
 * @example
 * // Update custom:tier attribute
 * await updateUserAttributes('abc-123-def', [
 *   { Name: 'custom:tier', Value: 'paid' }
 * ]);
 */
async function updateUserAttributes(cognitoSub, attributes) {
	try {
		// >! Retrieve User Pool ID from CachedSsmParameter (SSM-backed, auto-refreshing)
		const userPoolId = await Config.settings().cognito.userPoolId.getValue();

		await cognitoClient.send(new AdminUpdateUserAttributesCommand({
			UserPoolId: userPoolId,
			Username: cognitoSub,
			UserAttributes: attributes
		}));
	} catch (error) {
		DebugAndLog.error(`updateUserAttributes error: ${error.message}`, error.stack);
		throw error;
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
	 * Get access to internal functions and clients for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{cognitoClient: CognitoIdentityProviderClient}} Object containing internal clients
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../services/cognito');
	 * const { cognitoClient } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			cognitoClient
		};
	}
}

module.exports = {
	updateUserAttributes,
	TestHarness
};
