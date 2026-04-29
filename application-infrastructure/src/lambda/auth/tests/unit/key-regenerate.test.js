// Feature: 0-0-3-add-authentication, Unit tests for key regeneration handler
'use strict';

const FIXED_RAW_KEY = 'atl_abcdef1234567890abcdef1234567890';
const FIXED_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const FIXED_SALT = 'test-salt-value';

// Mock @aws-sdk/client-ssm
const mockSsmSend = jest.fn();
jest.mock('@aws-sdk/client-ssm', () => {
	return {
		SSMClient: jest.fn().mockImplementation(() => ({ send: mockSsmSend })),
		GetParameterCommand: jest.fn().mockImplementation((params) => params)
	};
});

// Mock @aws-sdk/client-cognito-identity-provider
const mockCognitoSend = jest.fn();
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
	return {
		CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
		AdminUpdateUserAttributesCommand: jest.fn().mockImplementation((params) => params)
	};
});

// Mock ../utils/dynamo-client
const mockQueryByEmail = jest.fn();
const mockDeleteUserRecord = jest.fn();
const mockPutUserRecord = jest.fn();
jest.mock('../../utils/dynamo-client', () => ({
	queryByEmail: mockQueryByEmail,
	deleteUserRecord: mockDeleteUserRecord,
	putUserRecord: mockPutUserRecord
}));

// Mock ../utils/api-key
jest.mock('../../utils/api-key', () => ({
	generateApiKey: jest.fn(() => FIXED_RAW_KEY),
	hashApiKey: jest.fn(() => FIXED_HASH)
}));

// Mock ../utils/jwt-validator
const mockValidateJwt = jest.fn();
jest.mock('../../utils/jwt-validator', () => ({
	validateJwt: mockValidateJwt
}));

const { handler, TestHarness } = require('../../handlers/key-regenerate');
const { AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');


/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build an API Gateway proxy event for key regeneration.
 *
 * @param {Object} overrides - Optional overrides for headers and body
 * @returns {Object} API Gateway proxy event
 */
function createEvent(overrides = {}) {
	return {
		httpMethod: 'POST',
		path: '/auth/key/regenerate',
		headers: {
			Authorization: 'Bearer valid-jwt-token',
			...overrides.headers
		},
		body: overrides.body || null
	};
}

/**
 * Configure mockSsmSend to return the hash salt and User Pool ID.
 */
function setupSsmMock() {
	mockSsmSend.mockImplementation((cmd) => {
		if (cmd.Name && cmd.Name.endsWith('Mcp_ApiKeyHashSalt')) {
			return Promise.resolve({ Parameter: { Value: FIXED_SALT } });
		}
		if (cmd.Name && cmd.Name.endsWith('Mcp_CognitoUserPoolId')) {
			return Promise.resolve({ Parameter: { Value: 'us-east-1_TestPool' } });
		}
		return Promise.reject(new Error(`Unexpected SSM param: ${cmd.Name}`));
	});
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Key Regeneration Handler', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			PARAM_STORE_PATH: '/test/path/',
			USERS_TABLE: 'test-Users'
		};

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

	it('should regenerate key for valid JWT and existing user', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null
		}]);
		mockDeleteUserRecord.mockResolvedValue();
		mockPutUserRecord.mockResolvedValue();
		mockCognitoSend.mockResolvedValue({});
		setupSsmMock();

		const event = createEvent();
		const result = await handler(event);

		// Verify old record deleted
		expect(mockDeleteUserRecord).toHaveBeenCalledWith('KEY#oldhash');

		// Verify new record created with preserved fields
		expect(mockPutUserRecord).toHaveBeenCalledTimes(1);
		const record = mockPutUserRecord.mock.calls[0][0];
		expect(record.pk).toBe(`KEY#${FIXED_HASH}`);
		expect(record.email).toBe('test@example.com');
		expect(record.tier).toBe('registered');
		expect(record.cognitoSub).toBe('test-sub-123');
		expect(record.tierExpiresAt).toBeNull();
		expect(record.createdAt).toBeDefined();
		expect(record.ttl).toBeDefined();

		// Verify Cognito updated with new hash
		expect(mockCognitoSend).toHaveBeenCalledTimes(1);
		expect(AdminUpdateUserAttributesCommand).toHaveBeenCalledWith({
			UserPoolId: 'us-east-1_TestPool',
			Username: 'test-sub-123',
			UserAttributes: [
				{ Name: 'custom:api_key', Value: FIXED_HASH }
			]
		});

		// Verify response
		expect(result.statusCode).toBe(200);
		const body = JSON.parse(result.body);
		expect(body.apiKey).toBe(FIXED_RAW_KEY);
		expect(body.message).toMatch(/regenerated/i);
	});

	it('should return 401 when JWT is invalid', async () => {
		mockValidateJwt.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' });

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(401);
		const body = JSON.parse(result.body);
		expect(body.error).toMatch(/unauthorized/i);

		// Verify no DynamoDB or Cognito calls made
		expect(mockQueryByEmail).not.toHaveBeenCalled();
		expect(mockDeleteUserRecord).not.toHaveBeenCalled();
		expect(mockPutUserRecord).not.toHaveBeenCalled();
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	it('should return 404 when user not found by email', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'unknown@example.com', sub: 'test-sub-456' });
		mockQueryByEmail.mockResolvedValue([]);

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(404);
		const body = JSON.parse(result.body);
		expect(body.error).toMatch(/not found/i);

		// Verify no delete or put calls
		expect(mockDeleteUserRecord).not.toHaveBeenCalled();
		expect(mockPutUserRecord).not.toHaveBeenCalled();
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	it('should preserve tier and tierExpiresAt on regeneration', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'paid@example.com', sub: 'paid-sub-789' });
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'paid@example.com',
			tier: 'paid',
			cognitoSub: 'paid-sub-789',
			tierExpiresAt: '2025-12-31T00:00:00Z'
		}]);
		mockDeleteUserRecord.mockResolvedValue();
		mockPutUserRecord.mockResolvedValue();
		mockCognitoSend.mockResolvedValue({});
		setupSsmMock();

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(200);

		const record = mockPutUserRecord.mock.calls[0][0];
		expect(record.tier).toBe('paid');
		expect(record.tierExpiresAt).toBe('2025-12-31T00:00:00Z');
	});

	it('should return 500 and log error when queryByEmail throws', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockQueryByEmail.mockRejectedValue(new Error('DynamoDB connection error'));

		const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		const event = createEvent();
		const result = await handler(event);

		expect(result.statusCode).toBe(500);
		const body = JSON.parse(result.body);
		expect(body.error).toMatch(/internal server error/i);

		// Verify error was logged
		expect(consoleSpy).toHaveBeenCalled();
		expect(consoleSpy.mock.calls[0][1].message).toBe('DynamoDB connection error');

		consoleSpy.mockRestore();
	});
});
