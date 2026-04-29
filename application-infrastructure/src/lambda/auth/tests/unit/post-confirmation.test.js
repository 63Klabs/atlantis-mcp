// Feature: 0-0-3-add-authentication, Unit tests for Post-Confirmation handler
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
const mockPutUserRecord = jest.fn();
jest.mock('../../utils/dynamo-client', () => ({
	putUserRecord: mockPutUserRecord
}));

// Mock ../utils/api-key
jest.mock('../../utils/api-key', () => ({
	generateApiKey: jest.fn(() => FIXED_RAW_KEY),
	hashApiKey: jest.fn(() => FIXED_HASH)
}));

const { handler, TestHarness } = require('../../handlers/post-confirmation');
const { AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a Cognito Post-Confirmation event.
 *
 * @param {Object} overrides - Optional overrides for userAttributes and clientMetadata
 * @returns {Object} Cognito trigger event
 */
function createEvent(overrides = {}) {
	return {
		userPoolId: 'us-east-1_TestPool',
		userName: 'test@example.com',
		triggerSource: 'PostConfirmation_ConfirmSignUp',
		request: {
			userAttributes: {
				email: 'test@example.com',
				sub: 'test-sub-123',
				...overrides.userAttributes
			},
			clientMetadata: overrides.clientMetadata || {}
		},
		response: {}
	};
}

/**
 * Configure mockSsmSend to return values for the 6 SSM parameters.
 *
 * @param {Object} paramOverrides - Map of param name suffix to value
 */
function setupSsmMock(paramOverrides = {}) {
	const defaults = {
		Mcp_BlockedEmailDomains: 'BLANK',
		Mcp_AllowedEmailDomains: 'BLANK',
		Mcp_BlockedCountries: 'BLANK',
		Mcp_AllowedCountries: 'BLANK',
		Mcp_AllowedPrivateDomains: 'BLANK',
		Mcp_ApiKeyHashSalt: FIXED_SALT
	};

	const params = { ...defaults, ...paramOverrides };

	mockSsmSend.mockImplementation((cmd) => {
		const name = cmd.Name;
		for (const [suffix, value] of Object.entries(params)) {
			if (name.endsWith(suffix)) {
				return Promise.resolve({ Parameter: { Value: value } });
			}
		}
		return Promise.reject(new Error(`Unexpected SSM param: ${name}`));
	});
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Post-Confirmation Handler', () => {
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

	it('should register user with registered tier when all SSM params are BLANK', async () => {
		setupSsmMock();
		mockPutUserRecord.mockResolvedValue();
		mockCognitoSend.mockResolvedValue({});

		const event = createEvent();
		const result = await handler(event);

		// Verify DynamoDB record created
		expect(mockPutUserRecord).toHaveBeenCalledTimes(1);
		const record = mockPutUserRecord.mock.calls[0][0];
		expect(record.pk).toBe(`KEY#${FIXED_HASH}`);
		expect(record.email).toBe('test@example.com');
		expect(record.tier).toBe('registered');
		expect(record.cognitoSub).toBe('test-sub-123');
		expect(record.createdAt).toBeDefined();
		expect(record.ttl).toBeDefined();

		// Verify Cognito updated
		expect(mockCognitoSend).toHaveBeenCalledTimes(1);

		// Verify event returned without custom response properties
		expect(result.response).toBeDefined();
		expect(result.response).not.toHaveProperty('rawApiKey');
	});

	it('should auto-promote to private tier when domain is in AllowedPrivateDomains', async () => {
		setupSsmMock({ Mcp_AllowedPrivateDomains: 'example.com' });
		mockPutUserRecord.mockResolvedValue();
		mockCognitoSend.mockResolvedValue({});

		const event = createEvent();
		const result = await handler(event);

		const record = mockPutUserRecord.mock.calls[0][0];
		expect(record.tier).toBe('private');
	});

	it('should reject registration when email domain is in BlockedEmailDomains', async () => {
		setupSsmMock({ Mcp_BlockedEmailDomains: 'blocked.com' });

		const event = createEvent({
			userAttributes: { email: 'user@blocked.com', sub: 'sub-blocked' }
		});

		await expect(handler(event)).rejects.toThrow(/blocked/i);
		expect(mockPutUserRecord).not.toHaveBeenCalled();
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	it('should reject registration when email domain is not in AllowedEmailDomains', async () => {
		setupSsmMock({ Mcp_AllowedEmailDomains: 'allowed.com' });

		const event = createEvent({
			userAttributes: { email: 'user@other.com', sub: 'sub-other' }
		});

		await expect(handler(event)).rejects.toThrow(/not permitted/i);
		expect(mockPutUserRecord).not.toHaveBeenCalled();
	});

	it('should allow registration when email domain is in AllowedEmailDomains', async () => {
		setupSsmMock({ Mcp_AllowedEmailDomains: 'example.com' });
		mockPutUserRecord.mockResolvedValue();
		mockCognitoSend.mockResolvedValue({});

		const event = createEvent();
		const result = await handler(event);

		expect(mockPutUserRecord).toHaveBeenCalledTimes(1);
	});

	it('should reject registration when country is in BlockedCountries', async () => {
		setupSsmMock({ Mcp_BlockedCountries: 'CN' });

		const event = createEvent({
			clientMetadata: { 'CloudFront-Viewer-Country': 'CN' }
		});

		await expect(handler(event)).rejects.toThrow(/country.*not allowed/i);
		expect(mockPutUserRecord).not.toHaveBeenCalled();
	});

	it('should reject registration when country is not in AllowedCountries', async () => {
		setupSsmMock({ Mcp_AllowedCountries: 'US,GB' });

		const event = createEvent({
			clientMetadata: { 'CloudFront-Viewer-Country': 'DE' }
		});

		await expect(handler(event)).rejects.toThrow(/country.*not permitted/i);
		expect(mockPutUserRecord).not.toHaveBeenCalled();
	});

	it('should allow registration when country header is absent even with BlockedCountries set', async () => {
		setupSsmMock({ Mcp_BlockedCountries: 'CN' });
		mockPutUserRecord.mockResolvedValue();
		mockCognitoSend.mockResolvedValue({});

		// No clientMetadata at all
		const event = createEvent();
		delete event.request.clientMetadata;

		const result = await handler(event);

		expect(mockPutUserRecord).toHaveBeenCalledTimes(1);
	});

	it('should create DynamoDB record with correct format', async () => {
		setupSsmMock();
		mockPutUserRecord.mockResolvedValue();
		mockCognitoSend.mockResolvedValue({});

		const event = createEvent();
		await handler(event);

		const record = mockPutUserRecord.mock.calls[0][0];

		// pk starts with KEY# followed by the hash
		expect(record.pk).toMatch(/^KEY#[0-9a-f]{64}$/);
		expect(record.email).toBe('test@example.com');
		expect(record.tier).toBe('registered');
		expect(record.cognitoSub).toBe('test-sub-123');
		expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(typeof record.ttl).toBe('number');

		// TTL should be approximately 120 days from now
		const nowEpoch = Math.floor(Date.now() / 1000);
		const expectedTtl = nowEpoch + (120 * 24 * 60 * 60);
		expect(record.ttl).toBeGreaterThan(expectedTtl - 10);
		expect(record.ttl).toBeLessThan(expectedTtl + 10);
	});

	it('should call AdminUpdateUserAttributes with correct params', async () => {
		setupSsmMock();
		mockPutUserRecord.mockResolvedValue();
		mockCognitoSend.mockResolvedValue({});

		const event = createEvent();
		await handler(event);

		expect(AdminUpdateUserAttributesCommand).toHaveBeenCalledWith({
			UserPoolId: 'us-east-1_TestPool',
			Username: 'test-sub-123',
			UserAttributes: [
				{ Name: 'custom:api_key', Value: FIXED_HASH },
				{ Name: 'custom:tier', Value: 'registered' }
			]
		});
	});

	it('should not add custom properties to event.response (Cognito rejects unknown fields)', async () => {
		setupSsmMock();
		mockPutUserRecord.mockResolvedValue();
		mockCognitoSend.mockResolvedValue({});

		const event = createEvent();
		const result = await handler(event);

		// Cognito throws InvalidLambdaResponseException for unknown response fields
		expect(result.response).not.toHaveProperty('rawApiKey');
		// The returned object should be the original event
		expect(result.triggerSource).toBe('PostConfirmation_ConfirmSignUp');
		expect(result.userPoolId).toBe('us-east-1_TestPool');
	});
});
