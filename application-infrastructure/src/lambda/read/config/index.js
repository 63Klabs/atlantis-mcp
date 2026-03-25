/**
 * Configuration initialization module for Atlantis MCP Server Read Lambda
 *
 * This module handles async initialization of:
 * - AppConfig.init() (Response, ClientRequest, Connections, Settings)
 * - Cache-data Cache.init()
 *
 * The Config.init() function should be called once during Lambda cold start
 * before processing any requests. (Place it outside the handler)
 * 
 * Within the handler be sure to await Config.promise() and Config.prime()
 *
 * @module config
 */

const { 
	cache: {
		Cache,
		CacheableDataAccess
	},
	tools: {
		DebugAndLog,
		Timer,
		CachedParameterSecrets,
		CachedSsmParameter,
		AppConfig
	} 
} = require("@63klabs/cache-data");

const settings = require("./settings.js");
const validations = require("./validations.js");
const connections = require("./connections.js");
const responses = require("./responses.js");

/**
 * Configuration class for Atlantis MCP Server Read Lambda.
 * 
 * Extends tools.AppConfig from @63klabs/cache-data to provide:
 * - Config.settings() - Getter for accessing application settings
 * - Config.getConnCacheProfile() - Method for retrieving connection cache profiles
 * 
 * Note: Config.settings() and Config.getConnCacheProfile() are inherited from
 * AppConfig and do not need separate documentation in this module.
 * 
 * @extends AppConfig
 */
class Config extends AppConfig {

	/**
	 * Initialize configuration for Lambda cold start.
	 * 
	 * This method performs async initialization that should be called once during
	 * Lambda cold start before processing any requests. 
	 * Using AppConfig.init(), it initializes:
	 * - ClientRequest validation framework
	 * - Response formatting utilities
	 * - Connections configuration for S3, GitHub API, and documentation index
	 * Using Cache.init() it initializes:
	 * - Cache system with secure data key from SSM Parameter Store
	 * 
	 * The initialization is stored as a promise that can be awaited in the Lambda
	 * handler to ensure all setup is complete before processing requests.
	 * 
	 * Cold Start Behavior:
	 * - First invocation: Performs full initialization (typically 200-500ms)
	 * - Subsequent invocations: Promise already resolved, returns immediately
	 * 
	 * @returns {Promise<boolean>} Resolves to true when initialization completes
	 * @example
	 * // In Lambda handler (outside handler function for cold start optimization)
	 * const { Config } = require('./config');
	 * Config.init(); // Start initialization
	 * 
	 * // In handler function
	 * exports.handler = async (event, context) => {
	 *   await Config.promise(); // Wait for init to complete
	 *   await Config.prime();   // Prime caches
	 *   
	 *   // Now safe to use Config.settings() and Config.getConnCacheProfile()
	 *   const settings = Config.settings();
	 *   const profile = Config.getConnCacheProfile('s3-templates', 'templates-list');
	 * };
	 */
	static init() {
		
		const timerConfigInit = new Timer("timerConfigInit", true);
			
		try {

			AppConfig.init( { settings, validations, connections, responses, debug: true } );

			// Cache settings
			Cache.init({
				secureDataKey: new CachedSsmParameter(process.env.PARAM_STORE_PATH+'CacheData_SecureDataKey', {refreshAfter: 43200}), // 12 hours
			});

			DebugAndLog.debug("Cache: ", Cache.info());

		} catch (error) {
			DebugAndLog.error(`Could not initialize Config ${error.message}`, error.stack);
		} finally {
			timerConfigInit.stop();
		};

		return AppConfig.promise();
			
	};

	/**
	 * Prime caches after initialization.
	 * 
	 * This method should be called after Config.init() completes to pre-populate
	 * caches with frequently accessed data. Priming reduces latency for the first
	 * requests by loading data into cache during cold start.
	 * 
	 * Primes:
	 * - CacheableDataAccess: Pre-loads cache metadata and connection profiles
	 * - CachedParameterSecrets: Pre-fetches SSM parameters and secrets
	 * 
	 * Note: Documentation index is now maintained by the Indexer Lambda and
	 * stored in DynamoDB. The Read Lambda queries it on demand via DocIndex.queryIndex().
	 * 
	 * @async
	 * @returns {Promise<Array>} Resolves when all priming operations complete
	 * @example
	 * // In Lambda handler
	 * exports.handler = async (event, context) => {
	 *   await Config.promise(); // Wait for init
	 *   await Config.prime();   // Prime caches
	 *   
	 *   // Process request with primed caches
	 *   const response = await processRequest(event);
	 *   return response;
	 * };
	 */
	static async prime() {
		const primeArray = [
			CacheableDataAccess.prime(),
			CachedParameterSecrets.prime()
		];

		// >! Priming needs to complete before moving on
		const promise = await Promise.all(primeArray);

		return promise;
	};
};


module.exports = {
	Config
};