/**
 * Property test for route dispatcher correctness
 *
 * **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
 *
 * Property 2: Route dispatcher correctness
 * For any request path and HTTP method combination, the route dispatcher SHALL:
 * - Delegate to the Profile Controller if and only if the path ends with
 *   `mcp/auth/profile` and the method is `GET`
 * - Delegate to the Key Regenerate Controller if and only if the path ends with
 *   `mcp/auth/key/regenerate` and the method is `POST`
 * - Delegate to the Voucher Redeem Controller if and only if the path ends with
 *   `mcp/auth/voucher/redeem` and the method is `POST`
 * - Set the response status to 404 with `{ "error": "Not found" }` for all
 *   other path/method combinations
 *
 * This holds regardless of any prefix prepended to the path.
 *
 * @module tests/property/route-dispatcher-correctness
 */

'use strict';

const fc = require('fast-check');

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

const mockProfileGet = jest.fn();
const mockKeyRegeneratePost = jest.fn();
const mockVoucherRedeemPost = jest.fn();

jest.mock('../../controllers/profile', () => ({
	get: mockProfileGet
}));

jest.mock('../../controllers/key-regenerate', () => ({
	post: mockKeyRegeneratePost
}));

jest.mock('../../controllers/voucher-redeem', () => ({
	post: mockVoucherRedeemPost
}));

jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			warn: jest.fn(),
			error: jest.fn(),
			debug: jest.fn(),
			log: jest.fn(),
			info: jest.fn(),
		}
	}
}));

const Routes = require('../../routes/index');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Create a mock clientRequest with the given method and path.
 *
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @returns {Object} Mock clientRequest with getProps()
 */
function createClientRequest(method, path) {
	return {
		getProps: () => ({
			method,
			path,
			pathArray: path.split('/').filter(Boolean),
		})
	};
}

/**
 * Create a mock response object that tracks setStatusCode and setBody calls.
 *
 * @returns {Object} Mock response
 */
function createResponse() {
	const state = { statusCode: null, body: null };
	return {
		setStatusCode: jest.fn((code) => { state.statusCode = code; }),
		setBody: jest.fn((body) => { state.body = body; }),
		getStatusCode: () => state.statusCode,
		getBody: () => state.body,
	};
}

/**
 * Arbitrary for a URL-safe path prefix (may be empty).
 * Generates strings like "", "/stage", "/api/v1", "/a/b/c".
 */
const arbPathPrefix = fc.array(
	fc.stringMatching(/^[a-zA-Z0-9_-]{1,10}$/),
	{ minLength: 0, maxLength: 4 }
).map(segments => segments.length > 0 ? '/' + segments.join('/') : '');

/* ------------------------------------------------------------------ */
/*  Route definitions for property verification                       */
/* ------------------------------------------------------------------ */

const ROUTE_DEFINITIONS = [
	{ suffix: 'mcp/auth/profile', method: 'GET', controller: 'profile' },
	{ suffix: 'mcp/auth/key/regenerate', method: 'POST', controller: 'keyRegenerate' },
	{ suffix: 'mcp/auth/voucher/redeem', method: 'POST', controller: 'voucherRedeem' },
];

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Feature: update-auth-function-to-use-cache-data', () => {

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('Property 2: Route dispatcher correctness — matching routes with any prefix', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbPathPrefix,
				fc.constantFrom(...ROUTE_DEFINITIONS),
				async (prefix, routeDef) => {
					jest.clearAllMocks();

					const path = prefix + '/' + routeDef.suffix;
					const clientRequest = createClientRequest(routeDef.method, path);
					const response = createResponse();

					await Routes.process(clientRequest, response);

					// The correct controller should have been called exactly once
					if (routeDef.controller === 'profile') {
						expect(mockProfileGet).toHaveBeenCalledTimes(1);
						expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
						expect(mockVoucherRedeemPost).not.toHaveBeenCalled();
					} else if (routeDef.controller === 'keyRegenerate') {
						expect(mockKeyRegeneratePost).toHaveBeenCalledTimes(1);
						expect(mockProfileGet).not.toHaveBeenCalled();
						expect(mockVoucherRedeemPost).not.toHaveBeenCalled();
					} else if (routeDef.controller === 'voucherRedeem') {
						expect(mockVoucherRedeemPost).toHaveBeenCalledTimes(1);
						expect(mockProfileGet).not.toHaveBeenCalled();
						expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
					}

					// 404 should NOT have been set
					expect(response.setStatusCode).not.toHaveBeenCalledWith(404);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('Property 2: Route dispatcher correctness — wrong method returns 404', async () => {
		// Build arbitraries that guarantee the method does NOT match the route
		// and does not accidentally match a different route with the same suffix
		const arbWrongMethodRoute = fc.constantFrom(...ROUTE_DEFINITIONS).chain(routeDef => {
			// Only use methods that won't match ANY route with this suffix
			const wrongMethods = ['PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'];
			return fc.constantFrom(...wrongMethods).map(method => ({ routeDef, method }));
		});

		await fc.assert(
			fc.asyncProperty(
				arbPathPrefix,
				arbWrongMethodRoute,
				async (prefix, { routeDef, method }) => {
					jest.clearAllMocks();

					const path = prefix + '/' + routeDef.suffix;
					const clientRequest = createClientRequest(method, path);
					const response = createResponse();

					await Routes.process(clientRequest, response);

					// No controller should have been called
					expect(mockProfileGet).not.toHaveBeenCalled();
					expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
					expect(mockVoucherRedeemPost).not.toHaveBeenCalled();

					// 404 should have been set
					expect(response.setStatusCode).toHaveBeenCalledWith(404);
					expect(response.setBody).toHaveBeenCalledWith({ error: 'Not found' });
				}
			),
			{ numRuns: 100 }
		);
	});

	it('Property 2: Route dispatcher correctness — non-matching paths return 404', async () => {
		// Generate paths that do NOT end with any known route suffix
		const arbNonMatchingPath = fc.stringMatching(/^\/[a-zA-Z0-9/_-]{1,40}$/).filter(path => {
			return !path.endsWith('mcp/auth/profile')
				&& !path.endsWith('mcp/auth/key/regenerate')
				&& !path.endsWith('mcp/auth/voucher/redeem');
		});

		const arbMethod = fc.constantFrom(
			'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'
		);

		await fc.assert(
			fc.asyncProperty(
				arbNonMatchingPath,
				arbMethod,
				async (path, method) => {
					jest.clearAllMocks();

					const clientRequest = createClientRequest(method, path);
					const response = createResponse();

					await Routes.process(clientRequest, response);

					// No controller should have been called
					expect(mockProfileGet).not.toHaveBeenCalled();
					expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
					expect(mockVoucherRedeemPost).not.toHaveBeenCalled();

					// 404 should have been set
					expect(response.setStatusCode).toHaveBeenCalledWith(404);
					expect(response.setBody).toHaveBeenCalledWith({ error: 'Not found' });
				}
			),
			{ numRuns: 100 }
		);
	});
});
