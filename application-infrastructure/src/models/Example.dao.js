const { tools: {DebugAndLog, APIRequest} } = require("@63klabs/cache-data");

const { ApiExampleDao } = require("./ApiExample.dao");

const get = async (connection, query) => {
	return (new ExampleDao(connection, query).get());
};

class ExampleDao extends ApiExampleDao {
	constructor(connection, query) {

		super(connection);
		this.query = query;

		this._setRequest(connection);
	}

	/**
	 * Initiate the request to the API.
	 * This will go back and forth between this and super class.
	 * 1. this.get() will call super.get()
	 * 2. super.get() will call this._call()
	 * 3. this._call() will call super._call()
	 * 4. super._call() will return the response
	 * This is due to the fact that we may have to modify the request before sending it, or make additional requests.
	 * @returns {object} Response
	 */
	async get() {
		let response = null;
		
		try {
			response = await super.get();
		} catch (error) {
			DebugAndLog.error(`Error in ExampleDao get: Error: ${error.message}`, error.stack);
			response = APIRequest.responseFormat(false, 500, "Request failed");
		} finally {
			return response;
		}
		
	}

	async _call() {

		var response = null;

		try {

			response = await super._call(); // we are good to send the request on

		} catch (error) {
			// something went wrong
			DebugAndLog.error(`Error in ExampleDao call: Error: ${error.message}`, error.stack);
			response = APIRequest.responseFormat(false, 500, "Request failed");
		} finally {
			return response;
		}

	};

	_setRequest() {

		DebugAndLog.debug(`Request: ${JSON.stringify(this.request)}`);

		this.request.note += " (example)";
		this.request.origNote = this.request.note;
	};

};

module.exports = {
	get
};