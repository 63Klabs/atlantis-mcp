/**
 * Configuration initialization module for Auth Lambda
 *
 * Extends AppConfig from @63klabs/cache-data to handle cold start
 * initialization of settings, validations, connections, and responses.
 *
 * Unlike the read Lambda, the auth Lambda does NOT call Cache.init()
 * because it does not use CacheableDataAccess for caching external
 * API responses. DynamoDB operations are direct reads/writes.
 *
 * Usage:
 * - Call Config.init() outside the handler for cold start optimization
 * - Await Config.promise() and Config.prime() inside the handler
 *
 * @module config
 */

'use strict';

const {
	tools: {
		DebugAndLog,
		Timer,
		CachedParameterSecrets,
		AppConfig
	}
} = require('@63klabs/cache-data');

const settings = require('./settings.js');
const validations = require('./validations.js');
const connections = require('./connections.js');
const responses = require('./responses.js');

/**
 * Configuration class for Auth Lambda.
 *
 * Extends AppConfig to provide:
 * - Config.settings() — Getter for accessing application settings
 * - Config.getConnCacheProfile() — Method for retrieving connection cache profiles
 *
 * @extends AppConfig
 * @example
 * // Outside handler (cold start)
 * const { Config } = require('./config');
 * Config.init();
 *
 * // Inside handler
 * exports.handler = async (event, context) => {
 *   await Config.promise();
 *   await Config.prime();
 *   const settings = Config.settings();
 * };
 */
class Config extends AppConfig {

	/**
	 * Initialize configuration for Lambda cold start.
	 *
	 * Calls AppConfig.init() with settings, validations, connections, and
	 * responses. Does NOT call Cache.init() since the auth Lambda does not
	 * use the caching layer.
	 *
	 * @returns {Promise<boolean>} Resolves to true when initialization completes
	 */
	static init() {
		const timerConfigInit = new Timer('timerConfigInit', true);

		try {
			AppConfig.init({ settings, validations, connections, responses, debug: true });
			// >! No Cache.init() — auth Lambda doesn't use CacheableDataAccess
		} catch (error) {
			DebugAndLog.error(`Could not initialize Config ${error.message}`, error.stack);
		} finally {
			timerConfigInit.stop();
		}

		return AppConfig.promise();
	}

	/**
	 * Prime SSM parameter caches after initialization.
	 *
	 * Pre-fetches CachedSsmParameter values (Cognito User Pool ID,
	 * API key hash salt, session hash salt) to reduce latency on
	 * the first request after cold start.
	 *
	 * @async
	 * @returns {Promise} Resolves when all priming operations complete
	 */
	static async prime() {
		return CachedParameterSecrets.prime();
	}
}

module.exports = { Config };
