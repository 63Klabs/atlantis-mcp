/**
 * Unit tests for Voucher DAO (models/voucher.js)
 *
 * Verifies getVoucher and incrementVoucherUses with mocked DocumentClient
 * and confirms table names come from Config.settings().
 *
 * **Validates: Requirements 8.3**
 *
 * @module tests/unit/voucher-dao
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

const { getVoucher, incrementVoucherUses } = require('../../models/voucher');

describe('Voucher DAO (models/voucher.js)', () => {

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('getVoucher()', () => {

		it('should retrieve a voucher record by code', async () => {
			const mockVoucher = {
				pk: 'VOUCHER#SUMMER2025',
				targetTier: 'paid',
				durationDays: 90,
				expiresAt: '2025-12-31T00:00:00Z',
				maxUses: 100,
				currentUses: 5,
			};
			mockSend.mockResolvedValueOnce({ Item: mockVoucher });

			const result = await getVoucher('SUMMER2025');

			expect(result).toEqual(mockVoucher);
			expect(mockSend).toHaveBeenCalledTimes(1);

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
			expect(command.input.Key).toEqual({ pk: 'VOUCHER#SUMMER2025' });
		});

		it('should return null when voucher is not found', async () => {
			mockSend.mockResolvedValueOnce({});

			const result = await getVoucher('NONEXISTENT');

			expect(result).toBeNull();
		});

		it('should use usersTable from Config.settings()', async () => {
			mockSend.mockResolvedValueOnce({ Item: null });

			await getVoucher('TEST');

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
		});

		it('should log error and re-throw on DynamoDB failure', async () => {
			const error = new Error('DynamoDB error');
			mockSend.mockRejectedValueOnce(error);

			await expect(getVoucher('SUMMER2025')).rejects.toThrow('DynamoDB error');
			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('getVoucher error'),
				expect.any(String)
			);
		});
	});

	describe('incrementVoucherUses()', () => {

		it('should atomically increment the currentUses counter', async () => {
			const mockAttributes = {
				pk: 'VOUCHER#SUMMER2025',
				targetTier: 'paid',
				currentUses: 6,
			};
			mockSend.mockResolvedValueOnce({ Attributes: mockAttributes });

			const result = await incrementVoucherUses('SUMMER2025');

			expect(result).toEqual(mockAttributes);
			expect(mockSend).toHaveBeenCalledTimes(1);

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
			expect(command.input.Key).toEqual({ pk: 'VOUCHER#SUMMER2025' });
			expect(command.input.UpdateExpression).toBe('SET currentUses = currentUses + :inc');
			expect(command.input.ExpressionAttributeValues).toEqual({ ':inc': 1 });
			expect(command.input.ReturnValues).toBe('ALL_NEW');
		});

		it('should use usersTable from Config.settings()', async () => {
			mockSend.mockResolvedValueOnce({ Attributes: {} });

			await incrementVoucherUses('TEST');

			const command = mockSend.mock.calls[0][0];
			expect(command.input.TableName).toBe('test-users-table');
		});

		it('should log error and re-throw on DynamoDB failure', async () => {
			const error = new Error('Update failed');
			mockSend.mockRejectedValueOnce(error);

			await expect(incrementVoucherUses('SUMMER2025')).rejects.toThrow('Update failed');
			expect(mockDebugAndLogError).toHaveBeenCalledWith(
				expect.stringContaining('incrementVoucherUses error'),
				expect.any(String)
			);
		});
	});
});
