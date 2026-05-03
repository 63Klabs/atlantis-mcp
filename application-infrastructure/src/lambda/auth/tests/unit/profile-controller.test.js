/**
 * Unit tests for Profile Controller
 *
 * Tests the controller layer in controllers/profile.js including:
 * - Success flow (200 with profile data)
 * - 401 (invalid/missing JWT)
 * - 404 (user not found)
 * - 500 (unhandled error)
 *
 * @module tests/unit/profile-controller
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

// Mock Profile Service
const mockGetProfile = jest.fn();
jest.mock('../../services/profile', () => ({
	getProfile: mockGetProfile
}));

const ProfileController = require('../../controllers/profile');

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
 * Create mock props for a GET /mcp/auth/profile request.
 *
 * @returns {Object} Mock props object
 */
function createMockProps() {
	return {
		method: 'GET',
		path: 'mcp/auth/profile',
		headers: {
			Authorization: 'Bearer test-jwt-token'
		}
	};
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('ProfileController', () => {

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('get', () => {

		it('should return 200 with profile data on success', async () => {
			const profileData = {
				email: 'test@example.com',
				tier: 'registered',
				tierExpiresAt: null,
				createdAt: '2025-01-15T10:30:00.000Z',
				rateLimits: {
					limit: 100,
					remaining: 85,
					windowResetAt: 1737000000,
					windowMinutes: 60
				}
			};

			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});
			mockGetProfile.mockResolvedValue(profileData);

			const props = createMockProps();
			const response = createMockResponse();

			await ProfileController.get(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(200);
			expect(response.setBody).toHaveBeenCalledWith(profileData);
			expect(mockValidateJwt).toHaveBeenCalledWith(props, 'us-east-1_TestPool');
			expect(mockGetProfile).toHaveBeenCalledWith('test@example.com', 'test-sub-123');
		});

		it('should return 401 when JWT validation fails', async () => {
			const jwtError = { statusCode: 401, message: 'Missing or invalid Authorization header' };
			mockValidateJwt.mockRejectedValue(jwtError);

			const props = createMockProps();
			const response = createMockResponse();

			await ProfileController.get(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(401);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Unauthorized' });
			expect(mockGetProfile).not.toHaveBeenCalled();
		});

		it('should return 404 when user not found', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'unknown@example.com',
				sub: 'test-sub-456'
			});

			const notFoundError = new Error('User not found');
			notFoundError.statusCode = 404;
			mockGetProfile.mockRejectedValue(notFoundError);

			const props = createMockProps();
			const response = createMockResponse();

			await ProfileController.get(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(404);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'User not found' });
		});

		it('should return 500 on unhandled error', async () => {
			mockValidateJwt.mockResolvedValue({
				email: 'test@example.com',
				sub: 'test-sub-123'
			});
			mockGetProfile.mockRejectedValue(new Error('DynamoDB connection error'));

			const props = createMockProps();
			const response = createMockResponse();

			await ProfileController.get(props, response);

			expect(response.setStatusCode).toHaveBeenCalledWith(500);
			expect(response.setBody).toHaveBeenCalledWith({ error: 'Internal server error' });

			const { DebugAndLog } = require('@63klabs/cache-data').tools;
			expect(DebugAndLog.error).toHaveBeenCalled();
		});
	});
});
