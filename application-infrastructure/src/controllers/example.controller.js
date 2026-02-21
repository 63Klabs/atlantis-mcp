/*
CONTROLLER to coordinate calling the SERVICE and returning a response using the appropriate VIEW

The ROUTER routes the request to the CONTROLLER which then facilitates calling the SERVICE and 
formatting the response using a VIEW

It is up to the developer to decide how much routing the ROUTER handles, and how much 
of the deeper routing the CONTROLLER handles and how it is divided into separate methods.

Every application will be different depending on how complex it is. The more complex, the
better it is to divide into multiple controller methods:
	user.controller.get(), user.controller.updateAddress(), user.controller.getAddress(), user.controller.getProfile()

They all may get the same service method, but have different views or different controller logic.

*/

const { tools: {Timer, DebugAndLog} } = require("@63klabs/cache-data");

const { ExampleSvc } = require("../services");
const { ExampleView } = require("../views");

const logIdentifier = "Example Controller GET";

/**
 * Get function called by Router. This function will dispatch the appropriate task 
 * based on the request properties such as query string or header values.
 * @param {object} props 
 * @returns {Promise<Object>} data
 */
exports.get = async (props) => {

	let data = null;
	const timer = new Timer(logIdentifier, true);
	DebugAndLog.debug(`${logIdentifier}: Properties received`, props);

	return new Promise(async (resolve) => {

		try {
			
			let id = props?.pathParameters?.id;

			DebugAndLog.debug(`${logIdentifier}: id: ${id}`);

			const query = {
				id: id,
				calcMsToDeadline: props?.calcMsToDeadline,
				deadline: props?.deadline
			};

			data = ExampleView.view( await ExampleSvc.fetch(query) );

			DebugAndLog.debug(`${logIdentifier}: Example by Id: ${query?.id}`, data);

		} catch (error) {
			DebugAndLog.error(`${logIdentifier}: Error: ${error.message}`, error.stack);
			// we could return an Error object in the data, but for now we will just log it and leave data as null
		} finally {
			timer.stop();
			resolve (data);
		}

	});
}
