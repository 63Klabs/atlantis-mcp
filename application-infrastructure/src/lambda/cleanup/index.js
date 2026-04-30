/**
 * Cognito Orphan Cleanup Lambda
 *
 * Processes DynamoDB Streams events from the Users table to detect
 * TTL-triggered deletions and remove the corresponding orphaned
 * Cognito user accounts. Only TTL deletions (identified by
 * `userIdentity.principalId === 'dynamodb.amazonaws.com'`) on user
 * records (pk starting with `KEY#`) trigger Cognito cleanup.
 *
 * Uses partial batch failure reporting so that individual record
 * failures do not block processing of other records in the batch.
 *
 * @module lambda/cleanup
 */

'use strict';

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { CognitoIdentityProviderClient, AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

const ssmClient = new SSMClient({});
const cognitoClient = new CognitoIdentityProviderClient({});

/* ------------------------------------------------------------------ */
/*  SSM Parameter Cache                                               */
/* ------------------------------------------------------------------ */

/** @type {string|null} Cached User Pool ID from SSM */
let cachedUserPoolId = null;

/**
 * Reset the cached User Pool ID. Used in tests to clear module-level state.
 *
 * @private
 * @example
 * // In tests only — DO NOT use in production
 * const { TestHarness } = require('./index');
 * const { resetCache } = TestHarness.getInternals();
 * resetCache();
 */
function resetCache() {
	cachedUserPoolId = null;
}

/**
 * Retrieve the Cognito User Pool ID from SSM Parameter Store with
 * module-level caching for the lifetime of the Lambda execution environment.
 *
 * @async
 * @returns {Promise<string>} Cognito User Pool ID
 * @throws {Error} If SSM GetParameter fails
 * @example
 * const userPoolId = await getCachedUserPoolId();
 * // Returns e.g. 'us-east-1_AbCdEfGhI'
 */
async function getCachedUserPoolId() {
	if (cachedUserPoolId) {
		return cachedUserPoolId;
	}

	const paramName = process.env.PARAM_STORE_PATH + 'app-stack/Mcp_CognitoUserPoolId';
	const result = await ssmClient.send(new GetParameterCommand({
		Name: paramName,
		WithDecryption: false
	}));

	cachedUserPoolId = result.Parameter.Value;
	return cachedUserPoolId;
}

/* ------------------------------------------------------------------ */
/*  Record Filtering                                                  */
/* ------------------------------------------------------------------ */

/**
 * Determine whether a DynamoDB Streams record represents a TTL-triggered deletion.
 *
 * A record qualifies as a TTL deletion when:
 * - `eventName` equals `REMOVE`
 * - `userIdentity.principalId` equals `dynamodb.amazonaws.com`
 *
 * @param {Object} record - DynamoDB Streams record
 * @param {string} record.eventName - Stream event type (INSERT, MODIFY, REMOVE)
 * @param {Object} [record.userIdentity] - Identity that triggered the event
 * @param {string} [record.userIdentity.principalId] - Principal that performed the action
 * @returns {boolean} True if the record is a TTL-triggered deletion
 * @example
 * const record = { eventName: 'REMOVE', userIdentity: { principalId: 'dynamodb.amazonaws.com' } };
 * isTtlDeletion(record); // true
 *
 * @example
 * const record = { eventName: 'REMOVE', userIdentity: { principalId: 'arn:aws:iam::123:role/MyRole' } };
 * isTtlDeletion(record); // false (application deletion)
 */
function isTtlDeletion(record) {
	const isRemove = record.eventName === 'REMOVE';
	const isTtlPrincipal = record.userIdentity?.principalId === 'dynamodb.amazonaws.com';
	const result = isRemove && isTtlPrincipal;

	if (result) {
		console.info('TTL deletion detected', { eventName: record.eventName, principalId: record.userIdentity?.principalId });
	} else {
		console.info('Record skipped (not TTL deletion)', { eventName: record.eventName, principalId: record.userIdentity?.principalId });
	}

	return result;
}

/**
 * Determine whether a DynamoDB Streams record represents a user record
 * eligible for Cognito cleanup.
 *
 * A record qualifies as a user record when:
 * - OldImage `pk.S` starts with `KEY#`
 * - OldImage `cognitoSub.S` is present and non-empty
 *
 * @param {Object} record - DynamoDB Streams record
 * @param {Object} [record.dynamodb] - DynamoDB-specific event data
 * @param {Object} [record.dynamodb.OldImage] - Item state before deletion (marshalled format)
 * @returns {boolean} True if the record is a user record with a valid cognitoSub
 * @example
 * const record = {
 *   dynamodb: {
 *     OldImage: {
 *       pk: { S: 'KEY#abc123' },
 *       cognitoSub: { S: 'sub-456-def' }
 *     }
 *   }
 * };
 * isUserRecord(record); // true
 *
 * @example
 * const record = {
 *   dynamodb: {
 *     OldImage: { pk: { S: 'VOUCHER#xyz' } }
 *   }
 * };
 * isUserRecord(record); // false (non-user record)
 */
function isUserRecord(record) {
	const pk = record.dynamodb?.OldImage?.pk?.S;
	const cognitoSub = record.dynamodb?.OldImage?.cognitoSub?.S;

	if (!pk || !pk.startsWith('KEY#')) {
		console.debug('Skipped non-user record', { pk: pk || '(missing)' });
		return false;
	}

	if (!cognitoSub) {
		console.warn('User record missing cognitoSub', { pk });
		return false;
	}

	return true;
}

/* ------------------------------------------------------------------ */
/*  Cognito Deletion                                                  */
/* ------------------------------------------------------------------ */

/**
 * Delete an orphaned Cognito user account.
 *
 * Calls `AdminDeleteUser` on the specified User Pool. If the user has
 * already been deleted (`UserNotFoundException`), the operation is treated
 * as a success. Other errors are logged and reported as failures.
 *
 * @async
 * @param {string} cognitoSub - Cognito user sub (used as Username)
 * @param {string} userPoolId - Cognito User Pool ID
 * @returns {Promise<{success: boolean}>} Result indicating success or failure
 * @example
 * const result = await deleteOrphanedUser('abc-123-def-456', 'us-east-1_AbCdEfGhI');
 * // result.success === true (user deleted or already gone)
 */
async function deleteOrphanedUser(cognitoSub, userPoolId) {
	try {
		await cognitoClient.send(new AdminDeleteUserCommand({
			UserPoolId: userPoolId,
			Username: cognitoSub
		}));

		console.info('Cognito user deleted successfully', { cognitoSub });
		return { success: true };
	} catch (error) {
		if (error.name === 'UserNotFoundException') {
			console.warn('Cognito user already deleted (UserNotFoundException)', { cognitoSub });
			return { success: true };
		}

		console.error('Failed to delete Cognito user', {
			cognitoSub,
			errorName: error.name,
			errorMessage: error.message
		});
		return { success: false };
	}
}

/* ------------------------------------------------------------------ */
/*  Main Handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Lambda handler for DynamoDB Streams events on the Users table.
 *
 * Iterates over stream records, filters for TTL-triggered deletions on
 * user records, and calls `AdminDeleteUser` for each qualifying record.
 * Returns partial batch failure reporting so that only failed records
 * are retried by the event source mapping.
 *
 * Edge cases handled:
 * - Missing or empty `event.Records` — returns empty batchItemFailures
 * - Malformed records — skipped without adding to failures
 * - SSM failure — all records reported as failed for retry
 *
 * @async
 * @param {Object} event - DynamoDB Streams event
 * @param {Array<Object>} [event.Records] - Array of stream records
 * @returns {Promise<{batchItemFailures: Array<{itemIdentifier: string}>}>} Partial batch failure response
 * @example
 * const event = {
 *   Records: [{
 *     eventName: 'REMOVE',
 *     userIdentity: { principalId: 'dynamodb.amazonaws.com' },
 *     dynamodb: {
 *       OldImage: { pk: { S: 'KEY#hash123' }, cognitoSub: { S: 'sub-abc' } },
 *       SequenceNumber: '111222333'
 *     }
 *   }]
 * };
 * const result = await handler(event);
 * // result = { batchItemFailures: [] } (all succeeded)
 */
async function handler(event) {
	const batchItemFailures = [];
	const records = event?.Records;

	if (!records || !Array.isArray(records) || records.length === 0) {
		console.info('No records to process', { hasRecords: !!records, isArray: Array.isArray(records) });
		return { batchItemFailures };
	}

	// >! Retrieve User Pool ID from SSM before processing records
	// >! If SSM fails, report ALL records as failed so they are retried
	let userPoolId;
	try {
		userPoolId = await getCachedUserPoolId();
	} catch (error) {
		console.error('Failed to retrieve User Pool ID from SSM', {
			errorName: error.name,
			errorMessage: error.message
		});

		for (const record of records) {
			const sequenceNumber = record.dynamodb?.SequenceNumber;
			if (sequenceNumber) {
				batchItemFailures.push({ itemIdentifier: sequenceNumber });
			}
		}

		return { batchItemFailures };
	}

	for (const record of records) {
		try {
			// >! Guard against undefined/null records in the array
			if (!record || typeof record !== 'object') {
				continue;
			}

			if (!isTtlDeletion(record)) {
				continue;
			}

			if (!isUserRecord(record)) {
				continue;
			}

			const cognitoSub = record.dynamodb.OldImage.cognitoSub.S;
			const result = await deleteOrphanedUser(cognitoSub, userPoolId);

			if (!result.success) {
				const sequenceNumber = record.dynamodb?.SequenceNumber;
				if (sequenceNumber) {
					batchItemFailures.push({ itemIdentifier: sequenceNumber });
				}
			}
		} catch (error) {
			// >! Catch unexpected errors to prevent unhandled exceptions
			console.error('Unexpected error processing record', {
				errorName: error.name,
				errorMessage: error.message,
				sequenceNumber: record?.dynamodb?.SequenceNumber
			});

			const sequenceNumber = record?.dynamodb?.SequenceNumber;
			if (sequenceNumber) {
				batchItemFailures.push({ itemIdentifier: sequenceNumber });
			}
		}
	}

	return { batchItemFailures };
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
	 * @returns {{isTtlDeletion: Function, isUserRecord: Function, getCachedUserPoolId: Function, deleteOrphanedUser: Function, resetCache: Function}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('./index');
	 * const { isTtlDeletion, isUserRecord, getCachedUserPoolId, deleteOrphanedUser, resetCache } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			isTtlDeletion,
			isUserRecord,
			getCachedUserPoolId,
			deleteOrphanedUser,
			resetCache
		};
	}
}

module.exports = { handler, TestHarness };
