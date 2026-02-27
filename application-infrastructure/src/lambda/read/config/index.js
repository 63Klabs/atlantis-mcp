/**
 * Configuration initialization module for Atlantis MCP Server Read Lambda
 *
 * This module handles async initialization of:
 * - Cache-data Cache.init() with DynamoDB and S3
 * - Documentation index building (async, non-blocking)
 *
 * The Config.init() function should be called once during Lambda cold start
 * before processing any requests.
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
		CachedSSMParameter,
		_ConfigSuperClass,
		ClientRequest,
		Response,
		Connections
	} 
} = require("@63klabs/cache-data");

const settings = require("./settings.js");
const validations = require("./validations.js");
const connections = require("./connections.js");


/**
 * Build documentation index asynchronously (non-blocking)
 *
 * This function starts the documentation index building process in the background.
 * It does not block Lambda initialization - the Lambda can start processing
 * requests while the index builds.
 *
 * The documentation index includes:
 * - Template repository documentation
 * - Cache-data package documentation
 * - App starter code patterns (on-demand)
 *
 * @private
 */
function buildDocumentationIndexAsync() {
  // >! Start async index building without blocking
  // >! Use setImmediate to defer execution until after init() completes
  setImmediate(async () => {
    try {
      DebugAndLog.info('Starting documentation index build (async)');

      // TODO: Implement documentation index building in models/doc-index.js
      // For now, just log that we would build the index
      DebugAndLog.debug('Documentation index building deferred to models/doc-index.js implementation');

      // When implemented, this will:
      // 1. Index template repo documentation
      // 2. Index cache-data package documentation
      // 3. Index CloudFormation template patterns
      // 4. Store indexed data in cache for fast search

    } catch (error) {
      // >! Non-fatal error - log warning but don't fail Lambda
      DebugAndLog.warn('Documentation index build failed', {
        error: error.message
      });
    }
  });
}

/**
 * Configuration class for Atlantis MCP Server Read Lambda.
 * 
 * Extends _ConfigSuperClass from @63klabs/cache-data to provide:
 * - Config.settings() - Getter for accessing application settings
 * - Config.getConnCacheProfile() - Method for retrieving connection cache profiles
 * - Config.init() - Async initialization (documented below)
 * - Config.prime() - Cache priming after initialization
 * 
 * Note: Config.settings() and Config.getConnCacheProfile() are inherited from
 * _ConfigSuperClass and do not need separate documentation in this module.
 * 
 * @extends _ConfigSuperClass
 */
class Config extends _ConfigSuperClass {

	/**
	 * Initialize configuration for Lambda cold start.
	 * 
	 * This method performs async initialization that should be called once during
	 * Lambda cold start before processing any requests. It initializes:
	 * - ClientRequest validation framework
	 * - Response formatting utilities
	 * - Connections configuration for S3, GitHub API, and documentation index
	 * - Cache system with secure data key from SSM Parameter Store
	 * - Documentation index building (async, non-blocking)
	 * 
	 * The initialization is stored as a promise that can be awaited in the Lambda
	 * handler to ensure all setup is complete before processing requests.
	 * 
	 * Cold Start Behavior:
	 * - First invocation: Performs full initialization (typically 200-500ms)
	 * - Subsequent invocations: Promise already resolved, returns immediately
	 * - Documentation index builds asynchronously without blocking Lambda startup
	 * 
	 * @async
	 * @returns {Promise<boolean>} Resolves to true when initialization completes
	 * @throws {Error} If cache initialization fails or SSM parameter retrieval fails
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
	static async init() {
		
		_ConfigSuperClass._promise = new Promise(async (resolve, reject) => {

			const timerConfigInit = new Timer("timerConfigInit", true);
				
			try {

				ClientRequest.init( { validations } );
				Response.init( { settings: settings.clientRequestInit } );
				_ConfigSuperClass._connections = new Connections(connections);

				// Cache settings
				Cache.init({
					secureDataKey: new CachedSSMParameter(process.env.PARAM_STORE_PATH+'CacheData_SecureDataKey', {refreshAfter: 43200}), // 12 hours
				});

				DebugAndLog.debug("Cache: ", Cache.info());
				DebugAndLog.debug("Settings: ", settings);
				DebugAndLog.debug("Connections: ", _ConfigSuperClass._connections.info());

				// >! Documentation index building is async and non-blocking
				// >! Lambda can start processing requests while index builds in background
				buildDocumentationIndexAsync();

				
				resolve(true);
			} catch (error) {
				DebugAndLog.error(`Could not initialize Config ${error.message}`, error.stack);
				reject(false);
			} finally {
				timerConfigInit.stop();
			};
			
		});

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
		return Promise.all([
			CacheableDataAccess.prime(),
			CachedParameterSecrets.prime()
		]);
	};
};

module.exports = {
	Config
};