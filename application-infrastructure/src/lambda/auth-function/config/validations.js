/**
 * ClientRequest parameter validation rules for Auth Lambda
 *
 * Defines referrer allowlists and parameter validation functions
 * for use with ClientRequest.init() or AppConfig.init({validations}).
 *
 * The OpenAPI specification in template-openapi-spec.yml is the primary
 * validation layer. Lambda-side validation here is secondary.
 *
 * @module config/validations
 */

'use strict';

/**
 * Allowed referrers for CORS and access control.
 * '*' allows all referrers.
 *
 * @constant
 * @type {Array<string>}
 */
const ALLOWED_REFERRERS = ['*'];

/**
 * Whether to exclude parameters that have no matching validation rule.
 * Set to false when relying on API Gateway OpenAPI as primary validation.
 *
 * @constant
 * @type {boolean}
 */
const EXCLUDE_PARAMS_WITH_NO_VALIDATION_MATCH = false;

module.exports = {
	referrers: ALLOWED_REFERRERS,
	parameters: {
		excludeParamsWithNoValidationMatch: EXCLUDE_PARAMS_WITH_NO_VALIDATION_MATCH,
		pathParameters: {},
		queryStringParameters: {},
		bodyParameters: {},
	},
};
