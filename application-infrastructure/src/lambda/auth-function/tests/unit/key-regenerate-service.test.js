/**
 * Unit tests for Key Regeneration Service
 *
 * Tests the business logic in services/key-regenerate.js including:
 * - Delete old record + create new record flow
 * - Cognito custom:api_key update
 * - Preserved user fields on regeneration
 * - User not found error handling
 *
 * @module tests/unit/key-regenerate-service
 */

'use strict';

const FIXED_RAW_KEY = 'atl_abcdef1234567890abcdef1234567890';
const FIXED_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const FIXED_SALT = 'test-salt-value';

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			error: jest.fn(),
			warn: jest.fn(),
			log: jest.fn(),
			info: jest.fn(),
			debug: jest.fn()
		}
	}
}));

// Mock ../config
const mockSettings = {
	ssm: {
		apiKeyHashSalt: {
			getValue: jest.fn().mockResolvedValue(FIXED_SALT)
		}
	}
};

jest.mock('../../config', () => ({
	Config: {
		settings: jest.fn(() => mockSettings)
	}
}));

// Mock ../../models/user
const mockQueryByEmail = jest.fn();
const mockDeleteUserRecord = jest.fn();
const mockPutUserRecord = jest.fn();
jest.mock('../../models/user', () => ({
	queryByEmail: mockQueryByEmail,
	deleteUserRecord: mockDeleteUserRecord,
	putUserRecord: mockPutUserRecord
}));

// Mock ../../services/cognito
const mockUpdateUserAttributes = jest.fn();
jest.mock('../../services/cognito', () => ({
	updateUserAttributes: mockUpdateUserAttributes
}));

// Mock ../../utils/api-key
jest.mock('../../utils/api-key', () => ({
	generateApiKey: jest.fn(() => FIXED_RAW_KEY),
	hashApiKey: jest.fn(() => FIXED_HASH)
}));

const { regenerateKey } = require('../../services/key-regenerate');

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Key Regeneration Service', () => {

	beforeEach(() => {
		jest.clearAllMocks();
		mockDeleteUserRecord.mockResolvedValue();
		mockPutUserRecord.mockResolvedValue();
		mockUpdateUserAttributes.mockResolvedValue();
	});

	it('should regenerate key for existing user', async () => {
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null
		}]);

		const result = await regenerateKey('test@example.com', 'test-sub-123');

		expect(result.apiKey).toBe(FIXED_RAW_KEY);
		expect(result.message).toBe('API key regenerated successfully');
	});

	it('should delete old key record before creating new one', async () => {
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null
		}]);

		await regenerateKey('test@example.com', 'test-sub-123');

		// Verify old record deleted
		expect(mockDeleteUserRecord).toHaveBeenCalledWith('KEY#oldhash');

		// Verify delete was called before put
		const deleteOrder = mockDeleteUserRecord.mock.invocationCallOrder[0];
		const putOrder = mockPutUserRecord.mock.invocationCallOrder[0];
		expect(deleteOrder).toBeLessThan(putOrder);
	});

	it('should create new key record with preserved user fields', async () => {
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'test@example.com',
			tier: 'paid',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: '2025-12-31T00:00:00Z'
		}]);

		await regenerateKey('test@example.com', 'test-sub-123');

		expect(mockPutUserRecord).toHaveBeenCalledTimes(1);
		const record = mockPutUserRecord.mock.calls[0][0];
		expect(record.pk).toBe(`KEY#${FIXED_HASH}`);
		expect(record.email).toBe('test@example.com');
		expect(record.tier).toBe('paid');
		expect(record.cognitoSub).toBe('test-sub-123');
		expect(record.tierExpiresAt).toBe('2025-12-31T00:00:00Z');
		expect(record.createdAt).toBeDefined();
		expect(typeof record.ttl).toBe('number');
	});

	it('should set tierExpiresAt to null when original record has no expiration', async () => {
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: undefined
		}]);

		await regenerateKey('test@example.com', 'test-sub-123');

		const record = mockPutUserRecord.mock.calls[0][0];
		expect(record.tierExpiresAt).toBeNull();
	});

	it('should update Cognito custom:api_key with new hash', async () => {
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null
		}]);

		await regenerateKey('test@example.com', 'test-sub-123');

		expect(mockUpdateUserAttributes).toHaveBeenCalledWith(
			'test-sub-123',
			[{ Name: 'custom:api_key', Value: FIXED_HASH }]
		);
	});

	it('should throw 404 when user not found', async () => {
		mockQueryByEmail.mockResolvedValue([]);

		await expect(regenerateKey('unknown@example.com', 'test-sub-456'))
			.rejects.toMatchObject({
				statusCode: 404,
				message: 'User not found'
			});

		// Verify no delete, put, or Cognito calls made
		expect(mockDeleteUserRecord).not.toHaveBeenCalled();
		expect(mockPutUserRecord).not.toHaveBeenCalled();
		expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
	});

	it('should throw 404 when queryByEmail returns null', async () => {
		mockQueryByEmail.mockResolvedValue(null);

		await expect(regenerateKey('unknown@example.com', 'test-sub-456'))
			.rejects.toMatchObject({
				statusCode: 404,
				message: 'User not found'
			});
	});

	it('should retrieve hash salt from Config settings', async () => {
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null
		}]);

		await regenerateKey('test@example.com', 'test-sub-123');

		expect(mockSettings.ssm.apiKeyHashSalt.getValue).toHaveBeenCalled();
	});

	it('should propagate DynamoDB errors', async () => {
		mockQueryByEmail.mockRejectedValue(new Error('DynamoDB connection error'));

		await expect(regenerateKey('test@example.com', 'test-sub-123'))
			.rejects.toThrow('DynamoDB connection error');
	});

	it('should propagate Cognito errors', async () => {
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123',
			tierExpiresAt: null
		}]);
		mockUpdateUserAttributes.mockRejectedValue(new Error('Cognito service error'));

		await expect(regenerateKey('test@example.com', 'test-sub-123'))
			.rejects.toThrow('Cognito service error');
	});
});
