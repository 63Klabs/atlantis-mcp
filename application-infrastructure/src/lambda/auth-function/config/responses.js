/**
 * Response format settings for Auth Lambda
 *
 * Auth responses should not be cached, so expiration values are set to 0.
 * The externalRequestHeadroomInMs provides buffer time for external calls.
 *
 * @module config/responses
 */

'use strict';

/**
 * Response configuration for the Auth Lambda.
 *
 * @type {Object}
 */
const responses = {
	settings: {
		errorExpirationInSeconds: 0,
		routeExpirationInSeconds: 0,
		externalRequestHeadroomInMs: 8000,
	},
	jsonResponses: {},
	htmlResponses: {},
	xmlResponses: {},
	rssResponses: {},
	textResponses: {},
};

module.exports = responses;
