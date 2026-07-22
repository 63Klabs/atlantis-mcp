/**
 * Unit tests for Key Regenerate Controller
 *
 * Tests the controller layer in controllers/key-regenerate.js including:
 * - Success flow (200 with apiKey and message)
 * - 401 (invalid/missing JWT)
 * - 404 (user not found)
 * - 500 (unhandled error)
 *
 * @module tests/unit/key-regenerate-controller
 */

'use strict';

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			error: jest.fn(),
			warn: jest.fn(),
			log: jest.fn(),
			info: jest.fn(),
			debug: jest.fn()
		},
		Timer: jest.fn().mockImplementation(() => ({
			stop: jest.fn(),
			isRunning: jest.fn(() => false)
		})),
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn().mockResolvedValue('us-east-1_TestPool')
		})),
		CachedParameterSecrets: { prime: jest.fn().mockResolvedValue(undefined) },
		AppConfig: class {
			static init() {}
			static promise() { return Promise.resolve(true); }
			static settings() { return {}; }
		}
	}
}));

// Mock Config module
const mockGetValue = jest.fn().mockResolvedValue('us-east-1_TestPool');
jest.mock('../../config', () => ({
	Config: {
		init: jest.fn(),
		promise: jest.fn().mockResolvedValue(true),
		prime: jest.fn().mockResolvedValue(undefined),
		settings: jest.fn().mockReturnValue({
			cognito: {
				userPoolId: {
					getValue: mockGetValue
				}
			}
		})
	}
}));

// Mock JWT validator
const mockValidateJwt = jest.fn();
jest.mock('../../utils/jwt-validator', () => ({
	validateJwt: mockValidateJwt
}));

// Mock Key Regenerate Service
const mockRegenerateKey = jest.fn();
jest.mock('../../services/key-regenerate', () => ({
	regenerateKey: mockRegenerateKey
}));

const KeyRegenerateController = require('../../controllers/key-regenerate');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Create a mock response object with setStatusCode and setBody methods.
 *
 * @returns {Object} Mock response with jest.fn() methods
 */
function createMockResponse() {
	return {
		setStatusCode: jest.fn(),
		setBody: jest.fn()
	};
}

/**
 * Create mock props for a POST /mcp/auth/key/regenerate request.
 *
 * @returns {Object} Mock props object
 */
function createMockProps() {
	return {
		method: 'POST',
		path: 'mcp/auth/key/regenerate',
		headers: {
			Authorization: 'Bearer test-jwt-token'
		}
	};
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('KeyRegenerateController', () => {

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('post', () => {

		it('should return 200 with apiKey and message on success', async () => {
			const serviceResult = {
				apiKey: 'atl_abcdef1234567890abcdef1234567890',
				message: 'API key regenerated successfully'
			};

			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});
			mockRegenerateKey.mockResolvedValue(serviceResult);

			const props = createMockProps();
			const response = createMockResponse();

			await KeyRegenerateController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(200);
			expect(response.setBody).toHaveBeenCalledWith(serviceResult);
			expect(mockValidateJwt).toHaveBeenCalledWith(props, 'us-east-1_TestPool');
			expect(mockRegenerateKey).toHaveBeenCalledWith('test@example.com', 'test-sub-123');
		});

		it('should return 401 when JWT validation fails', async () => {
			const jwtError = { statusCode: 401, message: 'Missing or invalid Authorization header' };
			mockValidateJwt.mockRejectedValue(jwtError);

			const props = createMockProps();
			const response = createMockResponse();

			await KeyRegenerateController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(401);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Unauthorized' });
			expect(mockRegenerateKey).not.toHaveBeenCalled();
		});

		it('should return 404 when user not found', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'unknown@example.com',
				sub: 'test-sub-456'
			});

			const notFoundError = new Error('User not found');
			notFoundError.statusCode = 404;
			mockRegenerateKey.mockRejectedValue(notFoundError);

			const props = createMockProps();
			const response = createMockResponse();

			await KeyRegenerateController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(404);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'User not found' });
		});

		it('should return 500 on unhandled error', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});
			mockRegenerateKey.mockRejectedValue(new Error('DynamoDB connection error'));

			const props = createMockProps();
			const response = createMockResponse();

			await KeyRegenerateController.post(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(500);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Internal server error' });

			const { DebugAndLog } = require('@63klabs/cache-data').tools;
			expect(DebugAndLog.error).toHaveBeenCalled();
		});
	});
});
