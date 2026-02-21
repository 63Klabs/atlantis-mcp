
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

const settings = require("./settings.json");
const validations = require("./validations.js");
const connections = require("./connections.js");

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

				ClientRequest.init( { validations } );
				Response.init( { settings } );
				_ConfigSuperClass._connections = new Connections(connections);

				// Cache settings
				Cache.init({
					secureDataKey: new CachedSSMParameter(process.env.PARAM_STORE_PATH+'CacheData_SecureDataKey', {refreshAfter: 43200}), // 12 hours
				});

				DebugAndLog.debug("Cache: ", Cache.info());
				
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