/**
 * DynamoDB table connection definitions for Auth Lambda
 *
 * Defines connection profiles for the Users and Sessions DynamoDB tables.
 * Since the auth Lambda does not use CacheableDataAccess, cache arrays
 * are empty — these serve as centralized resource references.
 *
 * @module config/connections
 */

'use strict';

/**
 * Connection definitions for DynamoDB tables used by the Auth Lambda.
 *
 * @type {Array<{name: string, host: string, path: string, cache: Array}>}
 */
const connections = [
	{
		name: 'dynamodb-users',
		host: 'dynamodb',
		path: process.env.USERS_TABLE || '',
		cache: [],
	},
	{
		name: 'dynamodb-sessions',
		host: 'dynamodb',
		path: process.env.SESSIONS_TABLE || '',
		cache: [],
	},
];

module.exports = connections;
