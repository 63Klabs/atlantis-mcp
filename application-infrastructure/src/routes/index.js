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
			MCP Protocol Routing
			Extract MCP tool name from request and route to appropriate controller
			*/

			const props = REQ.getProps();

			REQ.addPathLog();

			// MCP tools are accessed via POST requests
			if (props.method !== "POST") {
				return RESP.reset({statusCode: 405}); // MCP protocol uses POST
			}

			// Extract tool name from request body
			const tool = props.body?.tool || props.queryStringParameters?.tool;
			
			if (!tool) {
				return RESP.reset({statusCode: 400, body: { error: 'Missing tool parameter' }});
			}

			DebugAndLog.debug(`Routing to MCP tool: ${tool}`);

			// Route to appropriate controller based on MCP tool name
			// Controllers will be implemented in subsequent tasks
			switch (tool) {
				// Template operations
				case "list_templates":
				case "get_template":
				case "list_template_versions":
				case "list_categories":
				// Starter operations
				case "list_starters":
				case "get_starter_info":
				// Documentation operations
				case "search_documentation":
				// Validation operations
				case "validate_naming":
				// Update operations
				case "check_template_updates":
					// Controllers not yet implemented
					RESP.reset({statusCode: 501, body: { error: 'Tool not yet implemented' }});
					break;
				default:
					RESP.reset({statusCode: 404, body: { error: 'Unknown tool' }});
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