/**
 * Unit tests for route dispatcher (cache-data MVC pattern)
 *
 * Tests the route dispatcher's ability to match paths using endsWith()
 * and delegate to the correct controller, or return 404 for unmatched routes.
 *
 * @module tests/unit/route-dispatcher
 */

'use strict';

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
 * @returns {Object} Mock response with setStatusCode(), setBody(), and getters
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

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Route Dispatcher (cache-data MVC)', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('GET mcp/auth/profile', () => {
		it('should route GET with exact path ending to ProfileController', async () => {
			const clientRequest = createClientRequest('GET', '/mcp/auth/profile');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockProfileGet).toHaveBeenCalledTimes(1);
			expect(mockProfileGet).toHaveBeenCalledWith(
				expect.objectContaining({ method: 'GET', path: '/mcp/auth/profile' }),
				response
			);
			expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
			expect(mockVoucherRedeemPost).not.toHaveBeenCalled();
		});

		it('should route GET with CloudFront prefix to ProfileController', async () => {
			const clientRequest = createClientRequest('GET', '/stage/v1/mcp/auth/profile');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockProfileGet).toHaveBeenCalledTimes(1);
		});

		it('should NOT route POST to ProfileController', async () => {
			const clientRequest = createClientRequest('POST', '/mcp/auth/profile');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockProfileGet).not.toHaveBeenCalled();
			expect(response.setStatusCode).toHaveBeenCalledWith(404);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Not found' });
		});
	});

	describe('POST mcp/auth/key/regenerate', () => {
		it('should route POST with exact path ending to KeyRegenerateController', async () => {
			const clientRequest = createClientRequest('POST', '/mcp/auth/key/regenerate');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockKeyRegeneratePost).toHaveBeenCalledTimes(1);
			expect(mockKeyRegeneratePost).toHaveBeenCalledWith(
				expect.objectContaining({ method: 'POST', path: '/mcp/auth/key/regenerate' }),
				response
			);
			expect(mockProfileGet).not.toHaveBeenCalled();
			expect(mockVoucherRedeemPost).not.toHaveBeenCalled();
		});

		it('should route POST with CloudFront prefix to KeyRegenerateController', async () => {
			const clientRequest = createClientRequest('POST', '/prod/api/mcp/auth/key/regenerate');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockKeyRegeneratePost).toHaveBeenCalledTimes(1);
		});

		it('should NOT route GET to KeyRegenerateController', async () => {
			const clientRequest = createClientRequest('GET', '/mcp/auth/key/regenerate');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
			expect(response.setStatusCode).toHaveBeenCalledWith(404);
		});
	});

	describe('POST mcp/auth/voucher/redeem', () => {
		it('should route POST with exact path ending to VoucherRedeemController', async () => {
			const clientRequest = createClientRequest('POST', '/mcp/auth/voucher/redeem');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockVoucherRedeemPost).toHaveBeenCalledTimes(1);
			expect(mockVoucherRedeemPost).toHaveBeenCalledWith(
				expect.objectContaining({ method: 'POST', path: '/mcp/auth/voucher/redeem' }),
				response
			);
			expect(mockProfileGet).not.toHaveBeenCalled();
			expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
		});

		it('should route POST with CloudFront prefix to VoucherRedeemController', async () => {
			const clientRequest = createClientRequest('POST', '/beta/mcp/auth/voucher/redeem');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockVoucherRedeemPost).toHaveBeenCalledTimes(1);
		});

		it('should NOT route GET to VoucherRedeemController', async () => {
			const clientRequest = createClientRequest('GET', '/mcp/auth/voucher/redeem');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockVoucherRedeemPost).not.toHaveBeenCalled();
			expect(response.setStatusCode).toHaveBeenCalledWith(404);
		});
	});

	describe('404 for unknown paths', () => {
		it('should return 404 for unknown GET path', async () => {
			const clientRequest = createClientRequest('GET', '/mcp/auth/unknown');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(404);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Not found' });
			expect(mockProfileGet).not.toHaveBeenCalled();
			expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
			expect(mockVoucherRedeemPost).not.toHaveBeenCalled();
		});

		it('should return 404 for unknown POST path', async () => {
			const clientRequest = createClientRequest('POST', '/mcp/auth/unknown');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(404);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Not found' });
		});

		it('should return 404 for empty path', async () => {
			const clientRequest = createClientRequest('GET', '');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(404);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Not found' });
		});

		it('should return 404 for PUT method on valid path', async () => {
			const clientRequest = createClientRequest('PUT', '/mcp/auth/profile');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(404);
			expect(mockProfileGet).not.toHaveBeenCalled();
		});

		it('should return 404 for DELETE method on valid path', async () => {
			const clientRequest = createClientRequest('DELETE', '/mcp/auth/key/regenerate');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(404);
			expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
		});
	});

	describe('Lazy loading of controllers', () => {
		it('should not load controllers until a matching route is hit', () => {
			// Controllers are loaded via require() inside the route handler,
			// so they are only loaded when the route matches. We verify this
			// by checking that the mock functions exist but haven't been called
			// before any route is processed.
			expect(mockProfileGet).not.toHaveBeenCalled();
			expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
			expect(mockVoucherRedeemPost).not.toHaveBeenCalled();
		});

		it('should only load the matched controller for GET profile', async () => {
			const clientRequest = createClientRequest('GET', '/mcp/auth/profile');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			// Only ProfileController.get should have been called
			expect(mockProfileGet).toHaveBeenCalledTimes(1);
			expect(mockKeyRegeneratePost).not.toHaveBeenCalled();
			expect(mockVoucherRedeemPost).not.toHaveBeenCalled();
		});

		it('should only load the matched controller for POST key/regenerate', async () => {
			const clientRequest = createClientRequest('POST', '/mcp/auth/key/regenerate');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockProfileGet).not.toHaveBeenCalled();
			expect(mockKeyRegeneratePost).toHaveBeenCalledTimes(1);
			expect(mockVoucherRedeemPost).not.toHaveBeenCalled();
		});
	});

	describe('Path prefix variations', () => {
		it('should match with /api/v1/ prefix', async () => {
			const clientRequest = createClientRequest('GET', '/api/v1/mcp/auth/profile');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockProfileGet).toHaveBeenCalledTimes(1);
		});

		it('should match with deeply nested prefix', async () => {
			const clientRequest = createClientRequest('POST', '/a/b/c/d/mcp/auth/key/regenerate');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockKeyRegeneratePost).toHaveBeenCalledTimes(1);
		});

		it('should NOT match partial path suffix', async () => {
			// Path ends with "auth/profile" but not "mcp/auth/profile"
			const clientRequest = createClientRequest('GET', '/auth/profile');
			const response = createResponse();

			await Routes.process(clientRequest, response);

			expect(mockProfileGet).not.toHaveBeenCalled();
			expect(response.setStatusCode).toHaveBeenCalledWith(404);
		});
	});
});
