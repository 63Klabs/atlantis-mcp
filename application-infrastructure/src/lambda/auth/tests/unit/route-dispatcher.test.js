// Feature: 0-0-3-user-profile-enhancement, Unit tests for route dispatcher GET support
'use strict';

// Mock handler modules before requiring the route dispatcher
const mockProfileHandler = jest.fn();
const mockKeyRegenerateHandler = jest.fn();
const mockVoucherRedeemHandler = jest.fn();

jest.mock('../../handlers/profile', () => ({
	handler: mockProfileHandler
}));

jest.mock('../../handlers/key-regenerate', () => ({
	handler: mockKeyRegenerateHandler
}));

jest.mock('../../handlers/voucher-redeem', () => ({
	handler: mockVoucherRedeemHandler
}));

const { route, TestHarness } = require('../../routes/index');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build an API Gateway proxy event for route dispatcher testing.
 *
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - Request path (e.g. '/auth/profile')
 * @param {Object} [overrides] - Optional overrides for headers and body
 * @returns {Object} API Gateway proxy event
 */
function createEvent(method, path, overrides = {}) {
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

describe('Route Dispatcher', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('GET routes', () => {
		it('should route GET /auth/profile to the profile handler', async () => {
			const expectedResponse = {
				statusCode: 200,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'test@example.com', tier: 'registered' })
			};
			mockProfileHandler.mockResolvedValue(expectedResponse);

			const event = createEvent('GET', '/auth/profile');
			const result = await route(event);

			expect(mockProfileHandler).toHaveBeenCalledTimes(1);
			expect(mockProfileHandler).toHaveBeenCalledWith(event);
			expect(result).toEqual(expectedResponse);
		});

		it('should return 404 for GET /auth/unknown', async () => {
			const event = createEvent('GET', '/auth/unknown');
			const result = await route(event);

			expect(result.statusCode).toBe(404);
			const body = JSON.parse(result.body);
			expect(body.error).toMatch(/not found/i);

			// Verify no handlers were called
			expect(mockProfileHandler).not.toHaveBeenCalled();
			expect(mockKeyRegenerateHandler).not.toHaveBeenCalled();
			expect(mockVoucherRedeemHandler).not.toHaveBeenCalled();
		});

		it('should expose GET_ROUTES via TestHarness', () => {
			const { GET_ROUTES } = TestHarness.getInternals();

			expect(GET_ROUTES).toBeDefined();
			expect(GET_ROUTES['/auth/profile']).toBeDefined();
			expect(GET_ROUTES['/auth/profile'].handler).toBe(mockProfileHandler);
		});
	});

	describe('POST routes do not match GET paths', () => {
		it('should return 404 for POST /auth/profile (not a POST route)', async () => {
			const event = createEvent('POST', '/auth/profile');
			const result = await route(event);

			expect(result.statusCode).toBe(404);
			const body = JSON.parse(result.body);
			expect(body.error).toMatch(/not found/i);

			// Verify profile handler was NOT called
			expect(mockProfileHandler).not.toHaveBeenCalled();
		});
	});

	describe('Path normalization', () => {
		it('should handle case-insensitive paths for GET routes', async () => {
			const expectedResponse = {
				statusCode: 200,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'test@example.com' })
			};
			mockProfileHandler.mockResolvedValue(expectedResponse);

			const event = createEvent('GET', '/Auth/Profile');
			const result = await route(event);

			expect(mockProfileHandler).toHaveBeenCalledTimes(1);
			expect(result.statusCode).toBe(200);
		});

		it('should handle trailing slash for GET routes', async () => {
			const expectedResponse = {
				statusCode: 200,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'test@example.com' })
			};
			mockProfileHandler.mockResolvedValue(expectedResponse);

			const event = createEvent('GET', '/auth/profile/');
			const result = await route(event);

			expect(mockProfileHandler).toHaveBeenCalledTimes(1);
			expect(result.statusCode).toBe(200);
		});
	});
});
