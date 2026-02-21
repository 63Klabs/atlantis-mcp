/* 
*******************************************************************************
Web Service API
*******************************************************************************

Author: YOU

-------------------------------------------------------------------------------

This utilizes an application starter template for an AWS Lambda function that 
provides an api service via API Gateway. 
Internal caching utilizes DynamoDb and S3 through the
npm package @63klabs/cache-data

Application Starter Template:
https://github.com/63klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs

-------------------------------------------------------------------------------

For other notes and info, refer to README.md

*******************************************************************************
*/

"use strict";

const { tools: {DebugAndLog, Response, Timer} } = require("@63klabs/cache-data");

const { Config } = require("./config");
const Routes = require("./routes");

/* log a cold start and keep track of init time */
const coldStartInitTimer = new Timer("coldStartTimer", true);

/* initialize the Config */
Config.init(); // we will await completion in the handler

/**
 * Lambda function handler
 * 
 * @param {object} event Lambda event - doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {object} context Lambda context - doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html 
 */
exports.handler = async (event, context) => {

	let response = null;

	try {

		/* wait for Config.promise and THEN Config.prime to be settled as we need it before continuing. */
		await Config.promise(); // makes sure general config init is complete
		await Config.prime(); // makes sure all prime tasks (tasks that need to be completed AFTER init but BEFORE handler) are completed
		/* If the cold start init timer is running, stop it and log. This won't run again until next cold start */
		if (coldStartInitTimer.isRunning()) { DebugAndLog.log(coldStartInitTimer.stop(),"COLDSTART"); }

		/* Process the request and wait for result */
		response = await Routes.process(event, context);

	} catch (error) {

		/* Log the error */
		DebugAndLog.error(`Unhandled Execution Error in Handler  Error: ${error.message}`, error.stack);

		/* This failed before we even got to parsing the request so we don't have all the log info */
		response = new Response({statusCode: 500});
		response.setBody({
			message: 'Error initializing request - 1701-D' // 1701-D just so we know it is an app and not API Gateway error
		});

	} finally {
		DebugAndLog.debug("Response from Handler: ", response);
		/* Send the result back to API Gateway */
		return response.finalize();
	}

};