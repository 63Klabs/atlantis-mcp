const { 
	tools: {
		DebugAndLog,
		ClientRequest,
		Response
	} 
} = require("@63klabs/cache-data");

const Controllers = require("../controllers");

/**
 * Process the request
 * 
 * @param {object} event The event passed to the lambda function
 * @param {object} context The context passed to the lambda function
 * @returns {Promise<Response>} The response to the request as a Response class object
 */
const process = async function(event, context) {

	DebugAndLog.debug("Received event", event);

	/*
	 * Process the request information, get a response ready
	 */
	const REQ = new ClientRequest(event, context);
	const RESP = new Response(REQ);

	try {
		

		if (REQ.isValid()) {
			/*
			Logic for routing to appropriate controller goes here
			Try to keep it to just the method, path, and path variables (or a common query string parameter)
			Handle further routing in the controller
			
			Use if, switch/case, or a combination against method, path, and querystring routers.
			*/

			const props = REQ.getProps();

			REQ.addPathLog(); // we can do this here because we are using simple routing

			// Use any number of evaluations for routing, but keep it simple and organized
			if (props.method !== "GET") {
				return RESP.reset({statusCode: 405}); // we only allow GET (for now)
			}

			const route = `${props.method}:${props.resource}`
			DebugAndLog.debug(`Routing to: ${route}`);

			switch (route) {
				case "GET:api/example":
					RESP.setBody( await Controllers.ExampleCtrl.get(props));
					break;
				case"GET:api/example/{id}":
					RESP.setBody( await Controllers.ExampleCtrl.get(props));
					break;
				default:
					RESP.reset({statusCode: 404});
					break;
			}

		} else {
			RESP.reset({statusCode: 400});
		}

	} catch (error) {
		DebugAndLog.error(`Fatal error: ${error.message}`, error.stack);
		RESP.reset({statusCode: 500});
	}

	DebugAndLog.debug("Response from Routes: ", RESP.toObject());

	return RESP;

};

module.exports = {
	process
};