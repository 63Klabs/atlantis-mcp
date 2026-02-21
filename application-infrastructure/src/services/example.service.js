
/*
SERVICE to call the endpoint

It does this one of three ways:
	1. Directly (endpoint.get, static data, or other data source)
	2. Through a DAO (Data Access Object wraps an endpoint.get or other data source)
	3. Through a CacheableDataAccess object (which uses a DAO or endpoint internally)

The CONTROLLER calls the SERVICE and passes the data returned by the SERVICE to the VIEW:
controller.js
	return view(await service());

endpoint.get vs Dao.get() (Data Access Object) vs CacheableDataAccess.getData()
	- endpoint.get() - Simple GET request with no caching
	- ExampleDao.get() - Simple GET request with DAO wrapper for advanced API access logic
	- CacheableDataAccess.getData() - GET request with caching (Must pass a getter function such as endpoint.get or a DAO that it can use in case of MISS)

hardcoding vs Config.getConn() vs Config.getConnCacheProfile()
	- hardcoding - Directly define the connection object properties in the call
	- Config.getConn() - Use a central configuration to define the connection object properties
	- Config.getConnCacheProfile() - Use a central configuration to define the connection object properties and cache profile

You can have multiple services in this script.
	For example, user.service.js may have methods for:
		user.fetch(), user.create(), user.update(), user.delete()

*/

const { // uncomment cache{ ... } to use caching
	// cache: { 
	// 	CacheableDataAccess 
	// },
	tools: {
		DebugAndLog,
		Timer
	},
	endpoint // simple connections without using DAO
} = require("@63klabs/cache-data");

/* Instead of hardcoding the connection object properties used by endpoint.get you can use a central configuration */
// const { Config } = require("../config");

/* Instead of endpoint.get you can wrap it in a DAO to perform advanced API access logic */
// const { ExampleDao } = require("../models");

/* The identifier to use in logs for tracking this service */
const logIdentifier = "Example Service FETCH";

/** 
 * @function fetch
 * @description Service method to fetch data from the endpoint
 * @param {Object} query - The query parameters and options to use in the logic of the fetch method or DAO, and/or pass to the endpoint
 * @returns {Promise<Object>} - The data from the endpoint
*/
exports.fetch = async (query) => {

	return new Promise(async (resolve) => {

		let data = null;
		const timer = new Timer(logIdentifier, true);
		DebugAndLog.debug(`${logIdentifier}: Query Received`, query);

		try {

			/*
			-- EXAMPLE 1: ------------------------------------------------------
			Simple GET request using endpoint.get() with complete URI (no caching)
			*/

			const response = await endpoint.get({ 
				uri: "https://api.chadkluck.net/games" 
			});

			data = response.body;

			/* 
			-- EXAMPLE 2: ------------------------------------------------------
		    Simple GET request with connection from config using endpoint.get() (no caching) 
			*/

			// const conn = Config.getConn('myConnection');
			// const response = await endpoint.get(conn);
			
			// data = response.body;

			/* 
			-- EXAMPLE 3: ------------------------------------------------------
			GET request using connection from config using endpoint.get() with caching
			*/

			// const { conn, cacheProfile } = Config.getConnCacheProfile('games', 'default');

			// /* We could add query parameters directly to conn or save them to be passed to DAO for handling */
			// conn.parameters = {
			// 	code: query?.code,
			// };

			// /* Send request through CacheableDataAccess to utilize caching */
			// const cacheObj = await CacheableDataAccess.getData(
			// 	cacheProfile, 
			// 	endpoint.get, // NOTE: do not use () we are passing the function, not executing it! CacheableDataAccess will execute on MISS
			// 	conn, 
			// 	null
			// );

			// data = cacheObj.getBody(true); // data is returned in a wrapper from CacheableDataAccess

			/* 
			-- EXAMPLE 4: ------------------------------------------------------
			GET request using connection from config using CacheableDataAccess with 
			caching and ExampleDAO for advanced api handling 
			*/
			
			// const { conn, cacheProfile } = Config.getConnCacheProfile('games', 'default');

			// /* Send request through CacheableDataAccess to utilize caching */
			// const cacheObj = await CacheableDataAccess.getData(
			// 	cacheProfile, 
			// 	ExampleDao.get, // use endpoint.get if not using a DAO - NOTE: do not use () we are passing the function, not executing it!
			// 	conn,
			// 	query // set to null if you are not passing any extra data to the DAO
			// );

			// data = cacheObj.getBody(true);

		} catch (error) {
			DebugAndLog.error(`${logIdentifier}: Error: ${error.message}`, error.stack);
			// we could return an Error object in the data, but for now we will just log it and leave data as null
		} finally {
			timer.stop();
			resolve(data);
		}


	});

};
