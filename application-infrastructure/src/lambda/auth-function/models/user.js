/**
 * User Data Access Object (DAO) for Auth Lambda
 *
 * Provides DynamoDB operations for user records in the Users table
 * and session records in the Sessions table. Extracted from
 * utils/dynamo-client.js as part of the cache-data MVC migration.
 *
 * Table names are retrieved from Config.settings() rather than
 * direct process.env access, following the cache-data pattern.
 *
 * @module models/user
 */

'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const { captureClient } = require('../utils/xray-capture');

/**
 * Lazily initialized DynamoDB Document Client.
 * @type {DynamoDBDocumentClient|null}
 */
let docClient = null;

/**
 * Get or create the DynamoDB Document Client singleton.
 *
 * Constructed on first use (inside an invocation) rather than at module-load time, so an
 * X-Ray segment exists when the client is created (spec 0-0-6-xray-downstream-tracing).
 *
 * @returns {DynamoDBDocumentClient} The shared document client.
 * @example
 * const result = await getDocClient().send(new GetCommand(params));
 */
function getDocClient() {
	if (!docClient) {
		// >! Wrap the RAW DynamoDBClient, then build the document client from the wrapped
		// >! instance, mirroring cache-data's AWS.classes.js. Do NOT also wrap the document
		// >! client — that risks duplicate subsegments (Requirement 3.3).
		const client = captureClient(new DynamoDBClient({}));
		docClient = DynamoDBDocumentClient.from(client);
	}
	return docClient;
}

/**
 * Override the document client (test seam).
 *
 * @param {DynamoDBDocumentClient|null} client - Client instance, or `null` to reset.
 * @returns {void}
 */
function setDocClient(client) {
	docClient = client;
}

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
	try {
		const result = await getDocClient().send(new GetCommand({
			TableName: Config.settings().usersTable,
			Key: { pk: `KEY#${hash}` }
		}));
		return result.Item || null;
	} catch (error) {
		DebugAndLog.error(`getUserByKeyHash error: ${error.message}`, error.stack);
		throw error;
	}
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
	try {
		await getDocClient().send(new PutCommand({
			TableName: Config.settings().usersTable,
			Item: record
		}));
	} catch (error) {
		DebugAndLog.error(`putUserRecord error: ${error.message}`, error.stack);
		throw error;
	}
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
	try {
		await getDocClient().send(new DeleteCommand({
			TableName: Config.settings().usersTable,
			Key: { pk }
		}));
	} catch (error) {
		DebugAndLog.error(`deleteUserRecord error: ${error.message}`, error.stack);
		throw error;
	}
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
	try {
		const result = await getDocClient().send(new QueryCommand({
			TableName: Config.settings().usersTable,
			IndexName: 'email-index',
			KeyConditionExpression: 'email = :email',
			ExpressionAttributeValues: { ':email': email }
		}));
		return result.Items || [];
	} catch (error) {
		DebugAndLog.error(`queryByEmail error: ${error.message}`, error.stack);
		throw error;
	}
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
	try {
		const result = await getDocClient().send(new UpdateCommand({
			TableName: Config.settings().usersTable,
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
	} catch (error) {
		DebugAndLog.error(`updateUserTier error: ${error.message}`, error.stack);
		throw error;
	}
}

/**
 * Retrieve a session record from the Sessions Table.
 *
 * @param {string} pk - Session partition key (SHA-256 hash of cognitoSub + windowStart + sessionSalt)
 * @returns {Promise<Object|null>} Session record or null if not found
 * @example
 * const session = await getSessionRecord('a1b2c3d4...');
 * // session: { pk: 'a1b2c3d4...', remaining: 42, limit: 100, ttl: 1735689900 }
 */
async function getSessionRecord(pk) {
	try {
		const result = await getDocClient().send(new GetCommand({
			TableName: Config.settings().sessionsTable,
			Key: { pk }
		}));
		return result.Item || null;
	} catch (error) {
		DebugAndLog.error(`getSessionRecord error: ${error.message}`, error.stack);
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
	 * @returns {{docClient: DynamoDBDocumentClient}} Object containing internal clients
	 * @private
	 */
	static getInternals() {
		return {
			docClient: getDocClient()
		};
	}
}

module.exports = {
	getUserByKeyHash,
	putUserRecord,
	deleteUserRecord,
	queryByEmail,
	updateUserTier,
	getSessionRecord,
	setDocClient,
	TestHarness
};
