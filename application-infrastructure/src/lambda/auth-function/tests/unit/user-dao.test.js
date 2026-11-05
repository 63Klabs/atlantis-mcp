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
			// >! Aliased form: every attribute is named through ExpressionAttributeNames
			expect(command.input.UpdateExpression).toBe('SET #tier = :newTier, #exp = :newExpiry, #ttl = :newTtl');
			expect(command.input.ConditionExpression).toBe('attribute_exists(#pk)');
			expect(command.input.ExpressionAttributeNames).toEqual({
				'#pk': 'pk',
				'#tier': 'tier',
				'#exp': 'tierExpiresAt',
				'#ttl': 'ttl',
			});
			expect(command.input.ExpressionAttributeValues).toEqual({
				':newTier': 'paid',
				':newExpiry': '2025-12-31T00:00:00Z',
				':newTtl': 1735689600,
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

	describe('updateUserTier() options (spec 0-0-7-lapsed-tier-downgrade)', () => {
		const NOW_TTL = 1735689600;
		/**
		 * Collect every `#name` and `:value` placeholder used by the request's expressions.
		 *
		 * @param {Object} input - UpdateCommand input
		 * @returns {{names: Set<string>, values: Set<string>}} Placeholders referenced by the expressions
		 */
		function usedPlaceholders(input) {
			const text = `${input.UpdateExpression || ''} ${input.ConditionExpression || ''}`;
			const found = text.match(/[#:][A-Za-z_][A-Za-z0-9_]*/g) || [];
			return {
				names: new Set(found.filter((token) => token.startsWith('#'))),
				values: new Set(found.filter((token) => token.startsWith(':'))),
			};
		}
		/**
		 * Assert that the request carries no unused expression attribute name or value,
		 * and no expression refers to a placeholder that is not defined (DynamoDB rejects both).
		 *
		 * @param {Object} input - UpdateCommand input
		 * @returns {void}
		 */
		function expectNoUnusedPlaceholders(input) {
			const used = usedPlaceholders(input);
			expect(new Set(Object.keys(input.ExpressionAttributeNames || {}))).toEqual(used.names);
			expect(new Set(Object.keys(input.ExpressionAttributeValues || {}))).toEqual(used.values);
		}
		/**
		 * Run updateUserTier with the given options and return the command input that was sent.
		 *
		 * @param {Object} [options] - updateUserTier options
		 * @returns {Promise<Object>} UpdateCommand input
		 */
		async function sendUpdate(options) {
			mockSend.mockResolvedValueOnce({ Attributes: {} });
			await updateUserTier('KEY#abc', 'private', '2027-01-01T00:00:00.000Z', NOW_TTL, options);
			return mockSend.mock.calls[0][0].input;
		}
		describe('condition: one case per read value (Design 9 table)', () => {
			it('no options: only attribute_exists(#pk), with no expected values', async () => {
				const input = await sendUpdate();
				expect(input.ConditionExpression).toBe('attribute_exists(#pk)');
				expectNoUnusedPlaceholders(input);
			});
			it('tier is a string and tierExpiresAt is null: tier equality and a null-or-absent match', async () => {
				const input = await sendUpdate({ expected: { tier: 'paid', tierExpiresAt: null } });
				expect(input.ConditionExpression).toBe(
					'attribute_exists(#pk) AND #tier = :expectedTier AND (attribute_not_exists(#exp) OR attribute_type(#exp, :nullType))'
				);
				expect(input.ExpressionAttributeValues[':expectedTier']).toBe('paid');
				expect(input.ExpressionAttributeValues[':nullType']).toBe('NULL');
				expect(input.ExpressionAttributeValues).not.toHaveProperty(':expectedExpiry');
				expectNoUnusedPlaceholders(input);
			});
			it('tier is a string and tierExpiresAt is undefined: matched as null or absent', async () => {
				const input = await sendUpdate({ expected: { tier: 'paid', tierExpiresAt: undefined } });
				expect(input.ConditionExpression).toBe(
					'attribute_exists(#pk) AND #tier = :expectedTier AND (attribute_not_exists(#exp) OR attribute_type(#exp, :nullType))'
				);
				expect(input.ExpressionAttributeValues[':nullType']).toBe('NULL');
				expectNoUnusedPlaceholders(input);
			});
			it('tierExpiresAt is a string: equality on the value read', async () => {
				const input = await sendUpdate({ expected: { tier: 'paid', tierExpiresAt: '2026-12-31T00:00:00Z' } });
				expect(input.ConditionExpression).toBe(
					'attribute_exists(#pk) AND #tier = :expectedTier AND #exp = :expectedExpiry'
				);
				expect(input.ExpressionAttributeValues[':expectedExpiry']).toBe('2026-12-31T00:00:00Z');
				expect(input.ExpressionAttributeValues).not.toHaveProperty(':nullType');
				expectNoUnusedPlaceholders(input);
			});
			it('tierExpiresAt is a number: equality on the value read', async () => {
				const input = await sendUpdate({ expected: { tier: 'paid', tierExpiresAt: 1767225600 } });
				expect(input.ConditionExpression).toBe(
					'attribute_exists(#pk) AND #tier = :expectedTier AND #exp = :expectedExpiry'
				);
				expect(input.ExpressionAttributeValues[':expectedExpiry']).toBe(1767225600);
				expectNoUnusedPlaceholders(input);
			});
			it.each([
				['an object', { when: 'soon' }],
				['a boolean', true],
				['an array', ['2026-12-31']],
			])('tierExpiresAt is %s (already malformed): only requires the attribute to exist', async (_name, value) => {
				const input = await sendUpdate({ expected: { tier: 'paid', tierExpiresAt: value } });
				expect(input.ConditionExpression).toBe(
					'attribute_exists(#pk) AND #tier = :expectedTier AND attribute_exists(#exp)'
				);
				expect(input.ExpressionAttributeValues).not.toHaveProperty(':expectedExpiry');
				expect(input.ExpressionAttributeValues).not.toHaveProperty(':nullType');
				expectNoUnusedPlaceholders(input);
			});
			it('tier is not a string: requires the tier attribute to be absent', async () => {
				const input = await sendUpdate({ expected: { tier: undefined, tierExpiresAt: null } });
				expect(input.ConditionExpression).toBe(
					'attribute_exists(#pk) AND attribute_not_exists(#tier) AND (attribute_not_exists(#exp) OR attribute_type(#exp, :nullType))'
				);
				expect(input.ExpressionAttributeValues).not.toHaveProperty(':expectedTier');
				expectNoUnusedPlaceholders(input);
			});
		});
		describe('fallback: one case per shape', () => {
			it('undefined leaves the fallback attributes untouched', async () => {
				const input = await sendUpdate({ expected: { tier: 'paid', tierExpiresAt: null }, fallback: undefined });
				expect(input.UpdateExpression).toBe('SET #tier = :newTier, #exp = :newExpiry, #ttl = :newTtl');
				expect(input.ExpressionAttributeNames).not.toHaveProperty('#fbTier');
				expect(input.ExpressionAttributeNames).not.toHaveProperty('#fbExp');
				expect(input.ExpressionAttributeValues).not.toHaveProperty(':fbTier');
				expect(input.ExpressionAttributeValues).not.toHaveProperty(':fbExpiry');
				expectNoUnusedPlaceholders(input);
			});
			it('null removes both fallback attributes and sends no fallback value', async () => {
				const input = await sendUpdate({ expected: { tier: 'registered', tierExpiresAt: null }, fallback: null });
				expect(input.UpdateExpression).toBe(
					'SET #tier = :newTier, #exp = :newExpiry, #ttl = :newTtl REMOVE #fbTier, #fbExp'
				);
				expect(input.ExpressionAttributeNames['#fbTier']).toBe('fallbackTier');
				expect(input.ExpressionAttributeNames['#fbExp']).toBe('fallbackExpiresAt');
				expect(input.ExpressionAttributeValues).not.toHaveProperty(':fbTier');
				expect(input.ExpressionAttributeValues).not.toHaveProperty(':fbExpiry');
				expectNoUnusedPlaceholders(input);
			});
			it('an object sets both fallback attributes', async () => {
				const input = await sendUpdate({
					expected: { tier: 'paid', tierExpiresAt: '2026-12-31T00:00:00Z' },
					fallback: { tier: 'paid', tierExpiresAt: '2026-12-31T00:00:00Z' },
				});
				expect(input.UpdateExpression).toBe(
					'SET #tier = :newTier, #exp = :newExpiry, #ttl = :newTtl, #fbTier = :fbTier, #fbExp = :fbExpiry'
				);
				expect(input.ExpressionAttributeNames['#fbTier']).toBe('fallbackTier');
				expect(input.ExpressionAttributeNames['#fbExp']).toBe('fallbackExpiresAt');
				expect(input.ExpressionAttributeValues[':fbTier']).toBe('paid');
				expect(input.ExpressionAttributeValues[':fbExpiry']).toBe('2026-12-31T00:00:00Z');
				expectNoUnusedPlaceholders(input);
			});
			it('an object with a null end date stores the end date as null (the NULL type)', async () => {
				const input = await sendUpdate({
					expected: { tier: 'paid', tierExpiresAt: null },
					fallback: { tier: 'paid', tierExpiresAt: null },
				});
				expect(input.UpdateExpression).toContain('#fbExp = :fbExpiry');
				expect(input.ExpressionAttributeValues).toHaveProperty(':fbExpiry', null);
				expectNoUnusedPlaceholders(input);
			});
			it('a fallback without the expected option still builds a valid request', async () => {
				const input = await sendUpdate({ fallback: null });
				expect(input.ConditionExpression).toBe('attribute_exists(#pk)');
				expect(input.UpdateExpression).toContain('REMOVE #fbTier, #fbExp');
				expectNoUnusedPlaceholders(input);
			});
		});
		describe('conditional failure', () => {
			it('is rethrown without a DebugAndLog.error line, and logged at debug level', async () => {
				const { DebugAndLog } = require('@63klabs/cache-data').tools;
				const conditionalFailure = new Error('The conditional request failed');
				conditionalFailure.name = 'ConditionalCheckFailedException';
				mockSend.mockRejectedValueOnce(conditionalFailure);
				await expect(
					updateUserTier('KEY#abc', 'paid', null, NOW_TTL, { expected: { tier: 'registered', tierExpiresAt: null } })
				).rejects.toBe(conditionalFailure);
				expect(mockDebugAndLogError).not.toHaveBeenCalled();
				expect(DebugAndLog.debug).toHaveBeenCalled();
			});
			it('other errors keep the error log and are rethrown', async () => {
				const error = new Error('Throughput exceeded');
				mockSend.mockRejectedValueOnce(error);
				await expect(
					updateUserTier('KEY#abc', 'paid', null, NOW_TTL, { expected: { tier: 'registered', tierExpiresAt: null } })
				).rejects.toBe(error);
				expect(mockDebugAndLogError).toHaveBeenCalledWith(
					expect.stringContaining('updateUserTier error'),
					expect.any(String)
				);
			});
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
