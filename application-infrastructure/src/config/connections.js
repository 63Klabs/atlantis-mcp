const { tools: {DebugAndLog} } = require("@63klabs/cache-data");

/** 
 * Connections can be broken down by the type of data and their cache life.
 * There may be multiple connections for the same host, but with different paths.
 * Typically, each endpoint path will have its own connection, but if they are similar
 * enough, they can share a connection.
 * For example, if they all return data that is cached for 8 hours, then they can
 * share a connection and be separated out in the DAO layer.
*/
const connections = [
	{
		name: "games",
		host: "api.chadkluck.net",
		path: "/games",
		cache: [
			{
				profile: "default",
				overrideOriginHeaderExpiration: true,
				defaultExpirationInSeconds: (DebugAndLog.isProduction() ? (24 * 60 * 60) : (5 * 60)),// , // 5 minutes for non-prod
				expirationIsOnInterval: true,
				headersToRetain: "",
				hostId: "chadkluck", // log entry label - only used for logging
				pathId: "games", // log entry label - only used for logging
				encrypt: true, // encrypt the data in the cache
			}
		]        
	}
]

module.exports = connections;