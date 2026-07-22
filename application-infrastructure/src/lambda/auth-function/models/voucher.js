/**
 * Voucher Data Access Object (DAO) for Auth Lambda
 *
 * Provides DynamoDB operations for voucher records in the Users table.
 * Extracted from utils/dynamo-client.js as part of the cache-data MVC migration.
 *
 * Table names are retrieved from Config.settings() rather than
 * direct process.env access, following the cache-data pattern.
 *
 * @module models/voucher
 */

'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { Config } = require('../config');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

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
	try {
		const result = await docClient.send(new GetCommand({
			TableName: Config.settings().usersTable,
			Key: { pk: `VOUCHER#${code}` }
		}));
		return result.Item || null;
	} catch (error) {
		DebugAndLog.error(`getVoucher error: ${error.message}`, error.stack);
		throw error;
	}
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
	try {
		const result = await docClient.send(new UpdateCommand({
			TableName: Config.settings().usersTable,
			Key: { pk: `VOUCHER#${code}` },
			UpdateExpression: 'SET currentUses = currentUses + :inc',
			ExpressionAttributeValues: { ':inc': 1 },
			ReturnValues: 'ALL_NEW'
		}));
		return result.Attributes;
	} catch (error) {
		DebugAndLog.error(`incrementVoucherUses error: ${error.message}`, error.stack);
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
			docClient
		};
	}
}

module.exports = {
	getVoucher,
	incrementVoucherUses,
	TestHarness
};
