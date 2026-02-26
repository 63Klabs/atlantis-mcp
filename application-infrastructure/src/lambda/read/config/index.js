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
// const validations = require("./validations.js");
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
 * Extends tools._ConfigSuperClass
 * Used to create a custom Config interface
 */
class Config extends _ConfigSuperClass {

	/**
	 * This is custom initialization code for the application. Depending 
	 * upon needs, the _init functions from the super class may be used
	 * as needed. Init is async, and a promise is stored, allowing the 
	 * lambda function to wait until the promise is finished.
	 */
	static async init() {
		
		_ConfigSuperClass._promise = new Promise(async (resolve, reject) => {

			const timerConfigInit = new Timer("timerConfigInit", true);
				
			try {

				ClientRequest.init( /*{ validations }*/ );
				Response.init( { settings } );
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