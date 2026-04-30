// Feature: 0-0-3-user-profile-enhancement, Unit tests for profile handler
'use strict';

// Mock @aws-sdk/client-ssm
const mockSsmSend = jest.fn();
jest.mock('@aws-sdk/client-ssm', () => {
	return {
		SSMClient: jest.fn().mockImplementation(() => ({ send: mockSsmSend })),
		GetParameterCommand: jest.fn().mockImplementation((params) => params)
	};
});

// Mock ../../utils/dynamo-client
const mockQueryByEmail = jest.fn();
const mockGetSessionRecord = jest.fn();
jest.mock('../../utils/dynamo-client', () => ({
	queryByEmail: mockQueryByEmail,
	getSessionRecord: mockGetSessionRecord
}));

// Mock ../../utils/jwt-validator
const mockValidateJwt = jest.fn();
jest.mock('../../utils/jwt-validator', () => ({
	validateJwt: mockValidateJwt
}));

const { handler, TestHarness } = require('../../handlers/profile');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build an API Gateway proxy event for profile retrieval.
 *
 * @param {Object} overrides - Optional overrides for headers
 * @returns {Object} API Gateway proxy event
 */
function createEvent(overrides = {}) {
	return {
		httpMethod: 'GET',
		path: '/auth/profile',
		headers: {
			Authorization: 'Bearer valid-jwt-token',
			...overrides.headers
		},
		body: null
	};
}

/**
 * Configure mockSsmSend to return the session hash salt.
 */
function setupSsmMock() {
	mockSsmSend.mockImplementation((cmd) => {
		if (cmd.Name && cmd.Name.endsWith('Mcp_SessionHashSalt')) {
			return Promise.resolve({ Parameter: { Value: 'test-session-salt' } });
		}
		return Promise.reject(new Error(`Unexpected SSM param: ${cmd.Name}`));
	});
}

/**
 * Set up all rate limit environment variables for testing.
 */
function setupRateLimitEnvVars() {
	process.env.MCP_PUBLIC_RATE_LIMIT = '50';
	process.env.MCP_PUBLIC_RATE_TIME_RANGE_MINUTES = '60';
	process.env.MCP_REGISTERED_RATE_LIMIT = '100';
	process.env.MCP_REGISTERED_RATE_TIME_RANGE_MINUTES = '60';
	process.env.MCP_PAID_RATE_LIMIT = '3000';
	process.env.MCP_PAID_RATE_TIME_RANGE_MINUTES = '1440';
	process.env.MCP_PRIVATE_RATE_LIMIT = '6000';
	process.env.MCP_PRIVATE_RATE_TIME_RANGE_MINUTES = '1440';
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Profile Handler', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			PARAM_STORE_PATH: '/test/path/',
			SESSIONS_TABLE: 'test-Sessions',
			USERS_TABLE: 'test-Users'
		};
		setupRateLimitEnvVars();

		// >! Clear SSM cache between tests to avoid stale parameter values
		const { ssmCache } = TestHarness.getInternals();
		for (const key of Object.keys(ssmCache)) {
			delete ssmCache[key];
		}

		jest.clearAllMocks();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('should return 200 with complete profile for valid JWT, user found, and session found', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#somehash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null,
			createdAt: '2025-01-15T10:30:00.000Z'
		}]);
		mockGetSessionRecord.mockResolvedValue({
			pk: 'sessionhash',
			remaining: 42,
			limit: 100
		});
		setupSsmMock();

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(200);
		expect(result.headers['Content-Type']).toBe('application/json');

		const body = JSON.parse(result.body);
		expect(body.email).toBe('test@example.com');
		expect(body.tier).toBe('registered');
		expect(body.tierExpiresAt).toBeNull();
		expect(body.createdAt).toBe('2025-01-15T10:30:00.000Z');
		expect(body.rateLimits).toBeDefined();
		expect(body.rateLimits.limit).toBe(100);
		expect(body.rateLimits.remaining).toBe(42);
		expect(typeof body.rateLimits.windowResetAt).toBe('number');
		expect(body.rateLimits.windowMinutes).toBe(60);
	});

	it('should return 401 when JWT is invalid', async () => {
		mockValidateJwt.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' });

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(401);
		const body = JSON.parse(result.body);
		expect(body.error).toBe('Unauthorized');

		// Verify no DynamoDB or SSM calls made
		expect(mockQueryByEmail).not.toHaveBeenCalled();
		expect(mockGetSessionRecord).not.toHaveBeenCalled();
		expect(mockSsmSend).not.toHaveBeenCalled();
	});

	it('should return 401 when Authorization header is missing', async () => {
		mockValidateJwt.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' });

		const event = createEvent({ headers: { Authorization: undefined } });
		const result = await handler(event);

		expect(result.statusCode).toBe(401);
		const body = JSON.parse(result.body);
		expect(body.error).toBe('Unauthorized');
	});

	it('should return 404 when no user record found for email', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'unknown@example.com', sub: 'test-sub-456' });
		mockQueryByEmail.mockResolvedValue([]);

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(404);
		const body = JSON.parse(result.body);
		expect(body.error).toBe('User not found');

		// Verify no session or SSM calls made
		expect(mockGetSessionRecord).not.toHaveBeenCalled();
		expect(mockSsmSend).not.toHaveBeenCalled();
	});

	it('should return 500 when queryByEmail throws a DynamoDB error', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockQueryByEmail.mockRejectedValue(new Error('DynamoDB connection error'));

		const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(500);
		const body = JSON.parse(result.body);
		expect(body.error).toBe('Internal server error');

		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('should return 500 when SSM parameter retrieval fails', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#somehash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null,
			createdAt: '2025-01-15T10:30:00.000Z'
		}]);
		mockSsmSend.mockRejectedValue(new Error('SSM parameter not found'));

		const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(500);
		const body = JSON.parse(result.body);
		expect(body.error).toBe('Internal server error');

		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('should return full tier limit as remaining when no session record exists', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#somehash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null,
			createdAt: '2025-01-15T10:30:00.000Z'
		}]);
		mockGetSessionRecord.mockResolvedValue(null);
		setupSsmMock();

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(200);
		const body = JSON.parse(result.body);
		expect(body.rateLimits.remaining).toBe(100);
		expect(body.rateLimits.limit).toBe(100);
	});

	it('should compute effective tier as registered when tierExpiresAt is in the past', async () => {
		const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

		mockValidateJwt.mockResolvedValue({ email: 'expired@example.com', sub: 'expired-sub-789' });
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#somehash',
			email: 'expired@example.com',
			tier: 'paid',
			cognitoSub: 'expired-sub-789',
			tierExpiresAt: pastDate,
			createdAt: '2025-01-15T10:30:00.000Z'
		}]);
		mockGetSessionRecord.mockResolvedValue(null);
		setupSsmMock();

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(200);
		const body = JSON.parse(result.body);

		// Effective tier should be 'registered' because tierExpiresAt is in the past
		expect(body.tier).toBe('registered');
		// Rate limits should match registered tier config
		expect(body.rateLimits.limit).toBe(100);
		expect(body.rateLimits.windowMinutes).toBe(60);
		// tierExpiresAt should still be returned as-is from the user record
		expect(body.tierExpiresAt).toBe(pastDate);
	});

	it('should return 500 when rate limit config is missing', async () => {
		// Remove rate limit env vars to trigger config validation failure
		delete process.env.MCP_REGISTERED_RATE_LIMIT;
		delete process.env.MCP_REGISTERED_RATE_TIME_RANGE_MINUTES;

		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#somehash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null,
			createdAt: '2025-01-15T10:30:00.000Z'
		}]);

		const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(500);
		const body = JSON.parse(result.body);
		expect(body.error).toBe('Internal server error');

		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});
