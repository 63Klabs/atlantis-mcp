/* 
A VIEW filters, transforms, and maps data from the SERVICE to a response 
	
The VIEW is the only place that should format data for the client. 
The SERVICE should return data in the format it is stored.
The VIEW should never call the DATABASE or make API calls. 
It should only transform the data from the SERVICE.

The CONTROLLER calls the SERVICE and passes the data returned by the SERVICE to the VIEW:
controller.js
	return view(await service());

*/

const { 
	tools: {
		Timer
	}
} = require("@63klabs/cache-data");

const utils = require('../utils');

const logIdentifier = "Example View";

/** 
 * Generic filter to exclude null values
 * @param {object} data 
 * @returns {boolean} exclude 
 */
const filter = (dataItem = null) => {
	let include = true;
	if (dataItem == null) return false;
	return include;
}

/**
 * Generic transformer
 * @param {object} data 
 * @returns {object} data
 */
const transform = (data) => {

	// take data and create an 8 character hash
	// since we only expect a list of <20 games this is okay for an example
	// using sha256, create a hash and retain the last 8 characters
	const hashId = utils.hash.takeLast(data, 8);

	const returnData = {
		id: `G-${hashId}`,
		display_name: data
	};

	return returnData;
}

/**
 * Generic view
 * @param {object} resultsFromSvc
 * @returns {{count: number, items: Array<{id: number, display: string}>}} data
 */
exports.view = (resultsFromSvc) => {
	const viewTimer = new Timer(`Timer: ${logIdentifier}`, true);

	// if data then data else empty array
	const dataArray = Array.isArray(resultsFromSvc?.gamechoices) ? resultsFromSvc?.gamechoices : [];

	// The filter and transform functions can be customized or replaced as needed
	// They can also be combined so that the filter and transform are done in one pass 
	// which is more efficient especially for large datasets, 
	// But for clarity we will keep them separate here.

	// filter the data
	const filteredArray = dataArray.filter((item) => filter(item));

	// transform the data
	const transformedArray = filteredArray.map((item) => transform(item));

	// put new Array back in data
	const finalView = { count: transformedArray.length, items: transformedArray};

	viewTimer.stop();

	return finalView;	

}

/* ====================================================================================================
    Non-Generic
    ====================================================================================================*/

// add new views here