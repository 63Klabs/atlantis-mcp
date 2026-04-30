/**
 * Auth Lambda Route Dispatcher
 *
 * Routes API Gateway proxy events to the appropriate handler based on
 * HTTP method and path:
 * - GET  /auth/profile        → handlers/profile.js
 * - POST /auth/key/regenerate → handlers/key-regenerate.js
 * - POST /auth/voucher/redeem → handlers/voucher-redeem.js
 * - All other paths → 404 Not Found
 *
 * @module routes
 */

'use strict';

const keyRegenerateHandler = require('../handlers/key-regenerate');
const voucherRedeemHandler = require('../handlers/voucher-redeem');
const profileHandler = require('../handlers/profile');

/**
 * Route map for GET method endpoints.
 * Keys are normalized paths (lowercase, no trailing slash).
 *
 * @type {Object.<string, {handler: Function}>}
 */
const GET_ROUTES = {
	'/auth/profile': { handler: profileHandler.handler }
};

/**
 * Route map for POST method endpoints.
 * Keys are normalized paths (lowercase, no trailing slash).
 *
 * @type {Object.<string, {handler: Function}>}
 */
const POST_ROUTES = {
	'/auth/key/regenerate': { handler: keyRegenerateHandler.handler },
	'/auth/voucher/redeem': { handler: voucherRedeemHandler.handler }
};

/**
 * Normalize a request path for consistent route matching.
 * Converts to lowercase and strips trailing slash (except root).
 *
 * @param {string} path - Raw request path
 * @returns {string} Normalized path
 * @example
 * normalizePath('/Auth/Key/Regenerate/'); // '/auth/key/regenerate'
 * normalizePath('/auth/voucher/redeem');  // '/auth/voucher/redeem'
 */
function normalizePath(path) {
	let normalized = path.toLowerCase();
	if (normalized.length > 1 && normalized.endsWith('/')) {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
}

/**
 * Route an API Gateway proxy event to the matching handler.
 *
 * Supports GET and POST requests. Returns 404 for unknown paths
 * or unsupported methods.
 *
 * @async
 * @param {Object} event - API Gateway proxy event
 * @param {string} event.httpMethod - HTTP method (e.g. 'GET', 'POST')
 * @param {string} event.path - Request path (e.g. '/auth/profile')
 * @param {Object} event.headers - Request headers
 * @param {string} [event.body] - Request body (JSON string)
 * @returns {Promise<{statusCode: number, headers: Object, body: string}>} API Gateway proxy response
 * @example
 * // Route a profile request
 * const response = await route({
 *   httpMethod: 'GET',
 *   path: '/auth/profile',
 *   headers: { Authorization: 'Bearer <jwt>' }
 * });
 * // response: { statusCode: 200, headers: {...}, body: '{"email":"...","tier":"..."}' }
 *
 * @example
 * // Route a key regeneration request
 * const response = await route({
 *   httpMethod: 'POST',
 *   path: '/auth/key/regenerate',
 *   headers: { Authorization: 'Bearer <jwt>' }
 * });
 * // response: { statusCode: 200, headers: {...}, body: '{"apiKey":"atl_..."}' }
 *
 * @example
 * // Unknown path returns 404
 * const response = await route({
 *   httpMethod: 'POST',
 *   path: '/auth/unknown'
 * });
 * // response: { statusCode: 404, headers: {...}, body: '{"error":"Not found"}' }
 */
async function route(event) {
	const method = (event.httpMethod || '').toUpperCase();
	const path = normalizePath(event.path || '');

	// >! Route GET requests to GET_ROUTES
	if (method === 'GET') {
		const matched = GET_ROUTES[path];
		if (matched) {
			return matched.handler(event);
		}
	}

	// >! Route POST requests to POST_ROUTES
	if (method === 'POST') {
		const matched = POST_ROUTES[path];
		if (matched) {
			return matched.handler(event);
		}
	}

	// >! Return 404 for unknown paths
	return {
		statusCode: 404,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ error: 'Not found' })
	};
}

/* ------------------------------------------------------------------ */
/*  TestHarness (for testing private internals)                       */
/* ------------------------------------------------------------------ */

/**
 * Test harness for accessing internal functions for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
	/**
	 * Get access to internal functions for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{normalizePath: Function, GET_ROUTES: Object, POST_ROUTES: Object}} Object containing internal functions
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../routes/index');
	 * const { normalizePath, GET_ROUTES } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			normalizePath,
			GET_ROUTES,
			POST_ROUTES
		};
	}
}

module.exports = {
	route,
	TestHarness
};
