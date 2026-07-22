/**
 * Unit tests for User DAO (models/user.js)
 *
 * Verifies each DynamoDB operation with mocked DocumentClient
 * and confirms table names come from Config.settings().
 *
 * **Validates: Requirements 8.2**
 *
 * @module tests/unit/user-dao
 */

'use strict';

const mockSend = jest.fn();
const mockDebugAndLogError = jest.fn();

// >! Mock @aws-sdk/client-dynamodb with base command classes that lib-dynamodb wraps
jest.mock('@aws-sdk/client-dynamodb', () => {
	class BaseCommand {
		constructor(input) { this.input = input; }
	}
	return {
		DynamoDBClient: jest.fn().mockImplementation(() => ({})),
		GetItemCommand: BaseCommand,
		PutItemCommand: BaseCommand,
		DeleteItemCommand: BaseCommand,
		QueryCommand: BaseCommand,
		UpdateItemCommand: BaseCommand,
	};
});

// Mock @aws-sdk/lib-dynamodb
jest.mock('@aws-sdk/lib-dynamodb', () => {
	class MockCommand {
		constructor(input) { this.input = input; }
	}
	return {
		DynamoDBDocumentClient: {
			from: jest.fn().mockReturnValue({ send: mockSend }),
		},
		GetCommand: MockCommand,
		PutCommand: MockCommand,
		DeleteCommand: MockCommand,
		QueryCommand: MockCommand,
		UpdateCommand: MockCommand,
	};
});

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			error: mockDebugAndLogError,
			debug: jest.fn(),
			log: jest.fn(),
			info: jest.fn(),
			warn: jest.fn(),
		},
		AppConfig: class MockAppConfig {
			static init = jest.fn();
			static promise = jest.fn().mockResolvedValue(true);
			static settings = jest.fn().mockReturnValue({
				usersTable: 'test-users-table',
				sessionsTable: 'test-sessions-table',
			});
			static getConnCacheProfile = jest.fn();
		},
		Timer: jest.fn().mockImplementation(() => ({
			stop: jest.fn(),
			isRunning: jest.fn().mockReturnValue(false),
		})),
		CachedParameterSecrets: {
			prime: jest.fn().mockResolvedValue(true),
		},
		CachedSsmParameter: jest.fn().mockImplementation((path, options) => ({
			path,
			options,
			getValue: jest.fn().mockResolvedValue('mock-value'),
		})),
	},
}));

const {
	getUserByKeyHash,
	putUserRecord,
	deleteUserRecord,
	queryByEmail,
	updateUserTier,
	getSessionRecord,
} = require('../../models/user');

describe('User DAO (models/user.js)', () => {

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('getUserByKeyHash()', () => {

		it('should retrieve a user record by hash and return the Item', async () => {
			const mockUser = { pk: 'KEY#abc123', email: 'user@example.com', tier: 'registered' };
			mockSend.mockResolvedValueOnce({ Item: mockUser });

			const result = await getUserByKeyHash('abc123');

			expect(result).toEqual(mockUser);
			expect(mockSend).toHaveBeenCalledTimes(1);

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
			expect(command.input.Key).toEqual({ pk: 'KEY#abc123' });
		});

		it('should return null when user is not found', async () => {
			mockSend.mockResolvedValueOnce({});

			const result = await getUserByKeyHash('nonexistent');

			expect(result).toBeNull();
		});

		it('should log error and re-throw on DynamoDB failure', async () => {
			const error = new Error('DynamoDB error');
			mockSend.mockRejectedValueOnce(error);

			await expect(getUserByKeyHash('abc123')).rejects.toThrow('DynamoDB error');
			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('getUserByKeyHash error'),
				expect.any(String)
			);
		});
	});

	describe('putUserRecord()', () => {

		it('should store a user record in the Users table', async () => {
			mockSend.mockResolvedValueOnce({});
			const record = { pk: 'KEY#abc123', email: 'user@example.com', tier: 'registered' };

			await putUserRecord(record);

			expect(mockSend).toHaveBeenCalledTimes(1);
			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
			expect(command.input.Item).toEqual(record);
		});

		it('should log error and re-throw on DynamoDB failure', async () => {
			const error = new Error('Put failed');
			mockSend.mockRejectedValueOnce(error);

			await expect(putUserRecord({ pk: 'KEY#abc' })).rejects.toThrow('Put failed');
			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('putUserRecord error'),
				expect.any(String)
			);
		});
	});

	describe('deleteUserRecord()', () => {

		it('should delete a user record by pk', async () => {
			mockSend.mockResolvedValueOnce({});

			await deleteUserRecord('KEY#abc123');

			expect(mockSend).toHaveBeenCalledTimes(1);
			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
			expect(command.input.Key).toEqual({ pk: 'KEY#abc123' });
		});

		it('should log error and re-throw on DynamoDB failure', async () => {
			const error = new Error('Delete failed');
			mockSend.mockRejectedValueOnce(error);

			await expect(deleteUserRecord('KEY#abc')).rejects.toThrow('Delete failed');
			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('deleteUserRecord error'),
				expect.any(String)
			);
		});
	});

	describe('queryByEmail()', () => {

		it('should query user records by email using the email-index GSI', async () => {
			const mockUsers = [
				{ pk: 'KEY#abc123', email: 'user@example.com', tier: 'registered' },
			];
			mockSend.mockResolvedValueOnce({ Items: mockUsers });

			const result = await queryByEmail('user@example.com');

			expect(result).toEqual(mockUsers);
			expect(mockSend).toHaveBeenCalledTimes(1);

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
			expect(command.input.IndexName).toBe('email-index');
			expect(command.input.KeyConditionExpression).toBe('email = :email');
			expect(command.input.ExpressionAttributeValues).toEqual({ ':email': 'user@example.com' });
		});

		it('should return empty array when no users match', async () => {
			mockSend.mockResolvedValueOnce({});

			const result = await queryByEmail('nobody@example.com');

			expect(result).toEqual([]);
		});

		it('should log error and re-throw on DynamoDB failure', async () => {
			const error = new Error('Query failed');
			mockSend.mockRejectedValueOnce(error);

			await expect(queryByEmail('user@example.com')).rejects.toThrow('Query failed');
			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('queryByEmail error'),
				expect.any(String)
			);
		});
	});

	describe('updateUserTier()', () => {

		it('should update tier, tierExpiresAt, and ttl fields', async () => {
			const mockAttributes = { pk: 'KEY#abc', tier: 'paid', tierExpiresAt: '2025-12-31T00:00:00Z', ttl: 1735689600 };
			mockSend.mockResolvedValueOnce({ Attributes: mockAttributes });

			const result = await updateUserTier('KEY#abc', 'paid', '2025-12-31T00:00:00Z', 1735689600);

			expect(result).toEqual(mockAttributes);
			expect(mockSend).toHaveBeenCalledTimes(1);

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
			expect(command.input.Key).toEqual({ pk: 'KEY#abc' });
			expect(command.input.UpdateExpression).toBe('SET tier = :tier, tierExpiresAt = :exp, #ttl = :ttl');
			expect(command.input.ExpressionAttributeNames).toEqual({ '#ttl': 'ttl' });
			expect(command.input.ExpressionAttributeValues).toEqual({
				':tier': 'paid',
				':exp': '2025-12-31T00:00:00Z',
				':ttl': 1735689600,
			});
			expect(command.input.ReturnValues).toBe('ALL_NEW');
		});

		it('should log error and re-throw on DynamoDB failure', async () => {
			const error = new Error('Update failed');
			mockSend.mockRejectedValueOnce(error);

			await expect(updateUserTier('KEY#abc', 'paid', null, 123)).rejects.toThrow('Update failed');
			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('updateUserTier error'),
				expect.any(String)
			);
		});
	});

	describe('getSessionRecord()', () => {

		it('should retrieve a session record from the Sessions table', async () => {
			const mockSession = { pk: 'session-hash-123', remaining: 42, limit: 100, ttl: 1735689900 };
			mockSend.mockResolvedValueOnce({ Item: mockSession });

			const result = await getSessionRecord('session-hash-123');

			expect(result).toEqual(mockSession);
			expect(mockSend).toHaveBeenCalledTimes(1);

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-sessions-table');
			expect(command.input.Key).toEqual({ pk: 'session-hash-123' });
		});

		it('should return null when session is not found', async () => {
			mockSend.mockResolvedValueOnce({});

			const result = await getSessionRecord('nonexistent');

			expect(result).toBeNull();
		});

		it('should log error and re-throw on DynamoDB failure', async () => {
			const error = new Error('Session get failed');
			mockSend.mockRejectedValueOnce(error);

			await expect(getSessionRecord('session-hash')).rejects.toThrow('Session get failed');
			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('getSessionRecord error'),
				expect.any(String)
			);
		});
	});

	describe('Table name from Config.settings()', () => {

		it('should use usersTable from Config.settings() for user operations', async () => {
			mockSend.mockResolvedValueOnce({ Item: { pk: 'KEY#test' } });

			await getUserByKeyHash('test');

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
		});

		it('should use sessionsTable from Config.settings() for session operations', async () => {
			mockSend.mockResolvedValueOnce({ Item: { pk: 'session-test' } });

			await getSessionRecord('session-test');

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-sessions-table');
		});
	});
});
