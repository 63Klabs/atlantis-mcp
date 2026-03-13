/*
	Functions to validate request parameters

	The OpenAPI specification defined in template-openapi-spec.yml should be 
	the first and primary form of validation as it helps document your API
	and is exportable from API Gateway as a valuable resource.

	However, there may be cases where you want to validate parameters
	within the Lambda function itself. This file is an example of how to
	do that. The exported object contains the validation functions for
	each parameter type.

	Each validator function should accept one parameter (the value to validate)
	and return a boolean (true if valid, false if invalid).

	When adding new parameters, it is strongly recommended you add a definition
	to the template-openapi-spec.yml file as well as here. (For path parameters,
	you will also need to add to the Lambda Events in template.yml)

	For implementation examples see:
	https://github.com/63Klabs/cache-data/blob/main/docs/00-example-implementation/example-validations-enhanced.js
*/

/* ============================================================================
	Global Settings
	---------------------------------------------------------------------------
	Set the Referrer lists and whether or not parameters not defined here
	are still allowed through.
============================================================================ */

/**
 * For Access and CORS, what domains listed in the 'Referers' header should
 * be allowed access. Can be all '*' or specific domains. Domain matching is
 * from right to left, so example.com would allow sub.example.com.
 * @returns {Array<string>}
 * @example
 * ALLOWED_REFERRERS = ['*']; // allow all referrers
 * ALLOWED_REFERRERS = ['myapp.com', 'example.com']; // allow specific referrers (and subdomains)
 */
const ALLOWED_REFERRERS = ['*'];

/**
 * Set to false when relying on API Gateway OpenAPI and validation within Lambda is only secondary.
 * Set to true only when ALL validation occurs on Lambda side.
 * @returns {boolean}
 */
const EXCLUDE_PARAMS_WITH_NO_VALIDATION_MATCH = false;

/* ============================================================================
	Validator functions
	---------------------------------------------------------------------------
	Add any function that assists in this scripts internal validation here
	These are not exported, they are used by the validators.
	It is highly recommended to write complex validations as separate functions
	and to reference them in the export.
============================================================================ */

/**
 * Ensure value is a string of numbers
 * @param {string} value - The value to validate
 * @returns {boolean} - True if the value is a string of numbers, false otherwise
 */
const isStringOfNumbers = (value) => {
	// using regex, check if all the characters are digits
	return /^\d+$/.test(value);
};

/**
 * Ensure value is one of the valid tools
 * @param {string} value - The value to validate
 * @returns {boolean} - True if the value is a valid tool, false otherwise
 */
const isValidTool = (value) => {
	const validTools = ['list_templates', 'get_template', 'list_starters', 'get_starter_info', 'search_documentation', 'validate_naming', 'check_template_updates', 'list_template_versions', 'list_categories'];
	return validTools.includes(value);
};


/* ============================================================================
	Exported validators for use in ClientRequest.init
============================================================================ */

/**
 * Import and pass this object to ClientRequest.init(validations) or AppConfig.init({validations})
 * 
 * The exported alias must match the parameter name in the request coming in.
 * The Request object will automatically validate the parameter based on the function name or path.
 * You can define and re-use simple checks such as isString for multiple parameters if that is all you need.
 *
 * Validation Priority Order (highest to lowest):
 * 1. Method-and-route match (BY_ROUTE with "METHOD:route")
 * 2. Route-only match (BY_ROUTE with "route")
 * 3. Method-only match (BY_METHOD with "METHOD")
 * 4. Global parameter name
 * 
 * @example
 * const validations = require('./validations');
 * ClientRequest.init(validations);
 * @example
 * const validations = require('./validations');
 * AppConfig.init({validations});
 */
module.exports = {
	referrers: ALLOWED_REFERRERS,
	excludeParamsWithNoValidationMatch: EXCLUDE_PARAMS_WITH_NO_VALIDATION_MATCH,
	parameters: {
		pathParameters: {
			tool: isValidTool,
		},
		queryStringParameters: {
			id: isStringOfNumbers,
			// BY_ROUTE: [{route: "GET:api/example?plyrs", validate: playersQueryParameter}]
		},
		// headerParameters: {},
		// cookieParameters: {},
		// bodyParameters: {},	
	}
};
