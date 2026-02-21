const { tools: {DebugAndLog, APIRequest} } = require("@63klabs/cache-data");

class ApiExampleDao {

	constructor(connection) {

		this.request = {
			method: this._setRequestSetting(connection, "method", "GET"),
			uri: this._setRequestSetting(connection, "uri", ""),
			protocol: this._setRequestSetting(connection, "protocol", "https"),
			host: this._setRequestSetting(connection, "host", "api.chadkluck.net"),
			path: this._setRequestSetting(connection, "path", ""),
			body: this._setRequestSetting(connection, "body", null),
			note: this._setRequestSetting(connection, "note", "Get data from ApiSample"),
			parameters: this._setParameters(connection),
			headers: this._setHeaders(connection),
			options: this._setOptions(connection),
			cache: this._setCache(connection)
		};  
	};

	_setRequestSetting(connection, key, defaultValue) {
		if (!(key in connection)) {
			connection[key] = defaultValue;
		}

		return connection[key];        
	};
	
	/**
	 * Set any parameters standard to all ApiSample requests. If there are any
	 * parameters unique to individual endpoints then update the method unique
	 * to that class instead.
	 * @param {*} connection 
	 * @returns 
	 */
	_setParameters(connection) {
		if (!("parameters" in connection)) {
			connection.parameters = {};
		}
		
		/* we only want json from ApiSample - required param for json format */
		connection.parameters.format = "json";

		return connection.parameters;
	};

	/**
	 * Set any headers standard to all ApiSample requests. If there are any
	 * headers unique to individual endpoints then update the method unique to
	 * that class instead.
	 * @param {*} connection 
	 * @returns 
	 */
	_setHeaders(connection) {
		if (!("headers" in connection)) {
			connection.headers = null;
		} else {
			/* we only want json from ApiSample - not required, but standard to include */
			if ( !("content-type" in connection.headers) ) {
				connection.headers['content-type'] = "application/json";
			}

			/* we only want json from ApiSample - not required, but standard to include */
			if ( !("accept" in connection.headers) ) {
				connection.headers['accept'] = "application/json";
			}            
		}

		return connection.headers;
	};

	_setOptions(connection) {
		if (!("options" in connection)) {
			connection.options = null;
		}

		return connection.options;
	}

	_setCache(connection) {
		if (!("cache" in connection)) {
			connection.cache = null;
		}

		return connection.cache;
	}

	async get() {

		let response = null;

		// send the call
		try {

			response = await this._call();

			/* Try to parse. If error it is 99.999% likely it is trying to parse an error message */
			try { 

				/* Parse JSON */
				response.body = ( response.body !== "" && response.body !== null) ? JSON.parse(response.body) : null;
									
			} catch (error) {
				DebugAndLog.error(`ApiSample JSON Parse: Error: ${error.message}`, error.stack);
			}

		} catch (error) {
			DebugAndLog.error(`Error in call to ApiSample remote endpoint: Error: ${error.message}`, error.stack);
		} finally {
			return response;
		}
			
	}

	async _call() {

		let response = null;

		try {
			const apiRequest = new APIRequest(this.request);
			response = await apiRequest.send();

		} catch (error) {
			DebugAndLog.error(`Error in ApiSample call: Error: ${error.message}`, error.stack);
			response = APIRequest.responseFormat(false, 500, "Error in call()");
		} finally {
			return response;
		}

	};

};

module.exports = {
	ApiExampleDao
};