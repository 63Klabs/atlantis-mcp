/**
 * DynamoDB Client Utility for Auth Lambda
 *
 * Provides functions for reading and writing user and voucher records
 * in the Users table. Uses AWS SDK v3 DynamoDB DocumentClient.
 *
 * @module utils/dynamo-client
 */

'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.USERS_TABLE;

/**
 * Retrieve a user record by API key hash.
 *
 * @param {string} hash - HMAC-SHA256 hash of the API key
 * @returns {Promise<Object|null>} User record or null if not found
 * @example
 * const user = await getUserByKeyHash('3f2a...');
 * // user: { pk: 'KEY#3f2a...', email: 'user@example.com', tier: 'registered', ... }
 */
async function getUserByKeyHash(hash) {
	const result = await docClient.send(new GetCommand({
		TableName: TABLE_NAME,
		Key: { pk: `KEY#${hash}` }
	}));
	return result.Item || null;
}

/**
 * Store a user record in the Users table.
 *
 * @param {Object} record - Complete user record including pk
 * @returns {Promise<void>}
 * @example
 * await putUserRecord({
 *   pk: 'KEY#3f2a...',
 *   email: 'user@example.com',
 *   tier: 'registered',
 *   cognitoSub: 'abc-123',
 *   createdAt: new Date().toISOString(),
 *   ttl: Math.floor(Date.now() / 1000) + (120 * 24 * 60 * 60)
 * });
 */
async function putUserRecord(record) {
	await docClient.send(new PutCommand({
		TableName: TABLE_NAME,
		Item: record
	}));
}

/**
 * Delete a user record from the Users table.
 *
 * @param {string} pk - Partition key (e.g. `KEY#<hash>`)
 * @returns {Promise<void>}
 * @example
 * await deleteUserRecord('KEY#3f2a...');
 */
async function deleteUserRecord(pk) {
	await docClient.send(new DeleteCommand({
		TableName: TABLE_NAME,
		Key: { pk }
	}));
}

/**
 * Query user records by email using the email GSI.
 *
 * @param {string} email - User email address
 * @returns {Promise<Array<Object>>} Array of matching user records
 * @example
 * const users = await queryByEmail('user@example.com');
 * // users: [{ pk: 'KEY#3f2a...', email: 'user@example.com', ... }]
 */
async function queryByEmail(email) {
	const result = await docClient.send(new QueryCommand({
		TableName: TABLE_NAME,
		IndexName: 'email-index',
		KeyConditionExpression: 'email = :email',
		ExpressionAttributeValues: { ':email': email }
	}));
	return result.Items || [];
}

/**
 * Retrieve a voucher record by code.
 *
 * @param {string} code - Voucher code
 * @returns {Promise<Object|null>} Voucher record or null if not found
 * @example
 * const voucher = await getVoucher('SUMMER2025');
 * // voucher: { pk: 'VOUCHER#SUMMER2025', targetTier: 'paid', ... }
 */
async function getVoucher(code) {
	const result = await docClient.send(new GetCommand({
		TableName: TABLE_NAME,
		Key: { pk: `VOUCHER#${code}` }
	}));
	return result.Item || null;
}

/**
 * Atomically increment the currentUses counter on a voucher record.
 *
 * @param {string} code - Voucher code
 * @returns {Promise<Object>} Updated voucher attributes
 * @example
 * const updated = await incrementVoucherUses('SUMMER2025');
 * // updated: { currentUses: 5, ... }
 */
async function incrementVoucherUses(code) {
	const result = await docClient.send(new UpdateCommand({
		TableName: TABLE_NAME,
		Key: { pk: `VOUCHER#${code}` },
		UpdateExpression: 'SET currentUses = currentUses + :inc',
		ExpressionAttributeValues: { ':inc': 1 },
		ReturnValues: 'ALL_NEW'
	}));
	return result.Attributes;
}

/**
 * Update a user's tier, tierExpiresAt, and ttl fields.
 *
 * @param {string} pk - Partition key (e.g. `KEY#<hash>`)
 * @param {string} tier - New tier value
 * @param {string|null} tierExpiresAt - ISO 8601 expiration or null
 * @param {number} ttl - DynamoDB TTL in Unix epoch seconds
 * @returns {Promise<Object>} Updated user attributes
 * @example
 * const updated = await updateUserTier('KEY#3f2a...', 'paid', '2025-12-31T00:00:00Z', 1735689600);
 */
async function updateUserTier(pk, tier, tierExpiresAt, ttl) {
	const result = await docClient.send(new UpdateCommand({
		TableName: TABLE_NAME,
		Key: { pk },
		UpdateExpression: 'SET tier = :tier, tierExpiresAt = :exp, #ttl = :ttl',
		ExpressionAttributeNames: { '#ttl': 'ttl' },
		ExpressionAttributeValues: {
			':tier': tier,
			':exp': tierExpiresAt,
			':ttl': ttl
		},
		ReturnValues: 'ALL_NEW'
	}));
	return result.Attributes;
}

/**
 * Retrieve a session record from the Sessions Table.
 *
 * Uses a separate table name parameter rather than the module-level USERS_TABLE,
 * since session records are stored in the Sessions Table (from SESSIONS_TABLE env var).
 *
 * @param {string} tableName - Sessions table name (from process.env.SESSIONS_TABLE)
 * @param {string} pk - Session partition key (SHA-256 hash of cognitoSub + windowStart + sessionSalt)
 * @returns {Promise<Object|null>} Session record or null if not found
 * @example
 * const session = await getSessionRecord(process.env.SESSIONS_TABLE, 'a1b2c3d4...');
 * // session: { pk: 'a1b2c3d4...', remaining: 42, limit: 100, ttl: 1735689900 }
 */
async function getSessionRecord(tableName, pk) {
	const result = await docClient.send(new GetCommand({
		TableName: tableName,
		Key: { pk }
	}));
	return result.Item || null;
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
	 * @returns {{docClient: DynamoDBDocumentClient}} Object containing internal clients
	 * @private
	 */
	static getInternals() {
		return {
			docClient
		};
	}
}

module.exports = {
	getUserByKeyHash,
	putUserRecord,
	deleteUserRecord,
	queryByEmail,
	getVoucher,
	incrementVoucherUses,
	updateUserTier,
	getSessionRecord,
	TestHarness
};
