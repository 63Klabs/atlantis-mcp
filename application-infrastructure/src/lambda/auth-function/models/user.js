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
 * Update a user's tier, tierExpiresAt, and ttl fields, with an optional optimistic-concurrency
 * check and an optional change to the remembered lower tier (the Fallback).
 *
 * The write always requires the item to exist (`attribute_exists(#pk)`), so it can never
 * recreate a record that was deleted. When `options.expected` is given, it also requires
 * `tier` and `tierExpiresAt` to be what the caller read:
 *
 * | Read value | Condition part |
 * |------------|----------------|
 * | always | `attribute_exists(#pk)` |
 * | `tier` is a string | `#tier = :expectedTier` |
 * | `tier` is not a string | `attribute_not_exists(#tier)` |
 * | `tierExpiresAt` is `null` or `undefined` | `(attribute_not_exists(#exp) OR attribute_type(#exp, :nullType))` |
 * | `tierExpiresAt` is a string or a number | `#exp = :expectedExpiry` |
 * | `tierExpiresAt` is any other type | `attribute_exists(#exp)` |
 *
 * `options.fallback` has three shapes: `undefined` (or absent) leaves `fallbackTier` and
 * `fallbackExpiresAt` untouched, `null` removes both, and `{ tier, tierExpiresAt }` sets both
 * (a `tierExpiresAt` of `null` is stored as the DynamoDB `NULL` type).
 *
 * A failed condition is an expected outcome: it is logged at debug level only and the
 * `ConditionalCheckFailedException` is rethrown for the caller to map. Any other error is logged
 * with `DebugAndLog.error` and rethrown.
 *
 * @param {string} pk - Partition key (e.g. `KEY#<hash>`)
 * @param {string} tier - New tier value
 * @param {string|null} tierExpiresAt - ISO 8601 expiration or null
 * @param {number} ttl - DynamoDB TTL in Unix epoch seconds
 * @param {Object} [options={}] - Optional write controls
 * @param {{tier: *, tierExpiresAt: *}} [options.expected] - The `tier` and `tierExpiresAt` as read; when present the write succeeds only if they are unchanged
 * @param {({tier: string, tierExpiresAt: (string|null)}|null)} [options.fallback] - `undefined`: leave untouched; `null`: remove; object: set
 * @returns {Promise<Object>} Updated user attributes
 * @throws {Error} `ConditionalCheckFailedException` when the condition fails; any other DynamoDB error
 * @example
 * // A private voucher over a paid user: write the new tier only if the record is as read,
 * // and remember the paid tier and its end date.
 * const updated = await updateUserTier('KEY#3f2a...', 'private', '2026-12-01T00:00:00.000Z', 1735689600, {
 *   expected: { tier: 'paid', tierExpiresAt: '2027-08-29T00:00:00.000Z' },
 *   fallback: { tier: 'paid', tierExpiresAt: '2027-08-29T00:00:00.000Z' }
 * });
 *
 * @example
 * // Unconditional on the values (but the record must exist), fallback untouched
 * await updateUserTier('KEY#3f2a...', 'paid', '2025-12-31T00:00:00Z', 1735689600);
 */
async function updateUserTier(pk, tier, tierExpiresAt, ttl, options = {}) {
	const { expected, fallback } = options || {};
	// >! Every attribute name and value is an alias; record values are only ever sent as
	// >! ExpressionAttributeValues, never interpolated into an expression string.
	const names = { '#pk': 'pk', '#tier': 'tier', '#exp': 'tierExpiresAt', '#ttl': 'ttl' };
	const values = { ':newTier': tier, ':newExpiry': tierExpiresAt, ':newTtl': ttl };
	const conditions = ['attribute_exists(#pk)'];
	if (expected) {
		// >! The write applies only if tier and tierExpiresAt are still what was read
		if (typeof expected.tier === 'string') {
			conditions.push('#tier = :expectedTier');
			values[':expectedTier'] = expected.tier;
		} else {
			conditions.push('attribute_not_exists(#tier)');
		}
		const readExpiry = expected.tierExpiresAt;
		if (readExpiry === null || readExpiry === undefined) {
			conditions.push('(attribute_not_exists(#exp) OR attribute_type(#exp, :nullType))');
			values[':nullType'] = 'NULL';
		} else if (typeof readExpiry === 'string' || typeof readExpiry === 'number') {
			conditions.push('#exp = :expectedExpiry');
			values[':expectedExpiry'] = readExpiry;
		} else {
			conditions.push('attribute_exists(#exp)');
		}
	}
	let updateExpression = 'SET #tier = :newTier, #exp = :newExpiry, #ttl = :newTtl';
	if (fallback === null) {
		names['#fbTier'] = 'fallbackTier';
		names['#fbExp'] = 'fallbackExpiresAt';
		updateExpression += ' REMOVE #fbTier, #fbExp';
	} else if (fallback !== undefined) {
		names['#fbTier'] = 'fallbackTier';
		names['#fbExp'] = 'fallbackExpiresAt';
		values[':fbTier'] = fallback.tier;
		values[':fbExpiry'] = fallback.tierExpiresAt ?? null;
		updateExpression += ', #fbTier = :fbTier, #fbExp = :fbExpiry';
	}
	try {
		const result = await getDocClient().send(new UpdateCommand({
			TableName: Config.settings().usersTable,
			Key: { pk },
			UpdateExpression: updateExpression,
			ConditionExpression: conditions.join(' AND '),
			ExpressionAttributeNames: names,
			ExpressionAttributeValues: values,
			ReturnValues: 'ALL_NEW'
		}));
		return result.Attributes;
	} catch (error) {
		if (error && error.name === 'ConditionalCheckFailedException') {
			// >! Expected outcome of a concurrent change: debug level only, no error line
			DebugAndLog.debug('updateUserTier condition not met');
			throw error;
		}
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
