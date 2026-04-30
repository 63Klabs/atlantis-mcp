// Feature: 0-0-3-user-profile-enhancement, Unit tests for CORS headers
// Requirements: 11.1, 11.2, 11.3
'use strict';

// Mock handler modules before requiring the index handler
const mockRouteDispatcher = jest.fn();
const mockPostConfirmationHandler = jest.fn();

jest.mock('../../routes/index', () => ({
	route: mockRouteDispatcher
}));

jest.mock('../../handlers/post-confirmation', () => ({
	handler: mockPostConfirmationHandler
}));

const { handler } = require('../../index');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build an API Gateway proxy event for CORS header testing.
 *
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - Request path (e.g. '/auth/profile')
 * @param {Object} [overrides] - Optional overrides for headers and body
 * @returns {Object} API Gateway proxy event
 */
function createApiGatewayEvent(method, path, overrides = {}) {
	return {
		httpMethod: method,
		path: path,
		headers: {
			Authorization: 'Bearer valid-jwt-token',
			...overrides.headers
		},
		body: overrides.body || null
	};
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('CORS Headers', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('Access-Control-Allow-Methods includes GET (Requirement 11.2)', () => {
		it('should include GET in Access-Control-Allow-Methods on GET responses', async () => {
			mockRouteDispatcher.mockResolvedValue({
				statusCode: 200,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'test@example.com', tier: 'registered' })
			});

			const event = createApiGatewayEvent('GET', '/auth/profile');
			const result = await handler(event, {});

			expect(result.headers['Access-Control-Allow-Methods']).toBeDefined();
			expect(result.headers['Access-Control-Allow-Methods']).toContain('GET');
		});

		it('should include POST and OPTIONS alongside GET in Allow-Methods', async () => {
			mockRouteDispatcher.mockResolvedValue({
				statusCode: 200,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'test@example.com' })
			});

			const event = createApiGatewayEvent('GET', '/auth/profile');
			const result = await handler(event, {});

			const allowMethods = result.headers['Access-Control-Allow-Methods'];
			expect(allowMethods).toContain('GET');
			expect(allowMethods).toContain('POST');
			expect(allowMethods).toContain('OPTIONS');
		});
	});

	describe('CORS headers applied to GET responses (Requirements 11.1, 11.3)', () => {
		it('should apply Access-Control-Allow-Origin to GET responses', async () => {
			mockRouteDispatcher.mockResolvedValue({
				statusCode: 200,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'test@example.com', tier: 'registered' })
			});

			const event = createApiGatewayEvent('GET', '/auth/profile');
			const result = await handler(event, {});

			expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
		});

		it('should apply Access-Control-Allow-Headers to GET responses', async () => {
			mockRouteDispatcher.mockResolvedValue({
				statusCode: 200,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'test@example.com' })
			});

			const event = createApiGatewayEvent('GET', '/auth/profile');
			const result = await handler(event, {});

			expect(result.headers['Access-Control-Allow-Headers']).toBeDefined();
			expect(result.headers['Access-Control-Allow-Headers']).toContain('Authorization');
		});

		it('should apply CORS headers to GET error responses (500)', async () => {
			mockRouteDispatcher.mockRejectedValue(new Error('Internal failure'));

			const event = createApiGatewayEvent('GET', '/auth/profile');
			const result = await handler(event, {});

			expect(result.statusCode).toBe(500);
			expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
			expect(result.headers['Access-Control-Allow-Methods']).toContain('GET');
			expect(result.headers['Access-Control-Allow-Headers']).toBeDefined();
		});

		it('should preserve handler-specific headers alongside CORS headers', async () => {
			mockRouteDispatcher.mockResolvedValue({
				statusCode: 200,
				headers: {
					'Content-Type': 'application/json',
					'X-Custom-Header': 'custom-value'
				},
				body: JSON.stringify({ email: 'test@example.com' })
			});

			const event = createApiGatewayEvent('GET', '/auth/profile');
			const result = await handler(event, {});

			// CORS headers present
			expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
			expect(result.headers['Access-Control-Allow-Methods']).toContain('GET');

			// Handler-specific headers preserved
			expect(result.headers['Content-Type']).toBe('application/json');
			expect(result.headers['X-Custom-Header']).toBe('custom-value');
		});

		it('should apply same CORS headers to GET and POST responses', async () => {
			const mockResponse = {
				statusCode: 200,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ success: true })
			};
			mockRouteDispatcher.mockResolvedValue(mockResponse);

			const getEvent = createApiGatewayEvent('GET', '/auth/profile');
			const getResult = await handler(getEvent, {});

			mockRouteDispatcher.mockResolvedValue({ ...mockResponse });

			const postEvent = createApiGatewayEvent('POST', '/auth/key/regenerate');
			const postResult = await handler(postEvent, {});

			expect(getResult.headers['Access-Control-Allow-Origin'])
				.toBe(postResult.headers['Access-Control-Allow-Origin']);
			expect(getResult.headers['Access-Control-Allow-Methods'])
				.toBe(postResult.headers['Access-Control-Allow-Methods']);
			expect(getResult.headers['Access-Control-Allow-Headers'])
				.toBe(postResult.headers['Access-Control-Allow-Headers']);
		});
	});
});
