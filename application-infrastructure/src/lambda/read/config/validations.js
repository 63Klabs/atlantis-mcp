const referrers = [];

/**
 * The exported alias must match the parameter name in the request coming in.
 * The Request object will automatically validate the parameter based on the function name and exclude any request parameter that does not have a check.
 * You can define and re-use simple checks such as isString for multiple parameters if that is all you need.
 */
module.exports = {
	referrers,
	parameters: {
		// pathParameters: {},
		// queryParameters: {},
		// headerParameters: {},
		// cookieParameters: {},
		// bodyParameters: {},	
	}
};
