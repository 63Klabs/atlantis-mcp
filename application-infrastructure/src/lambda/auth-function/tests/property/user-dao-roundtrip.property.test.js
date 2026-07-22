/**
 * Property test for User DAO put/get round-trip
 *
 * **Validates: Requirements 8.2**
 *
 * Property 3: User DAO put/get round-trip
 * For any valid user record (with a pk matching KEY#<hash> format, a valid
 * email, a tier from {registered, paid, private}, a cognitoSub string, an
 * ISO 8601 createdAt, a numeric ttl, and a nullable tierExpiresAt), storing
 * the record via putUserRecord() and then retrieving it via getUserByKeyHash()
 * returns a record with all fields equal to the original.
 *
 * @module tests/property/user-dao-roundtrip
 */

'use strict';

const fc = require('fast-check');

// In-memory store to simulate DynamoDB
let inMemoryStore = {};
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

// Mock @aws-sdk/lib-dynamodb with in-memory store behavior
jest.mock('@aws-sdk/lib-dynamodb', () => {
	class MockGetCommand {
		constructor(input) { this.input = input; this._type = 'GetCommand'; }
	}
	class MockPutCommand {
		constructor(input) { this.input = input; this._type = 'PutCommand'; }
	}
	class MockDeleteCommand {
		constructor(input) { this.input = input; this._type = 'DeleteCommand'; }
	}
	class MockQueryCommand {
		constructor(input) { this.input = input; this._type = 'QueryCommand'; }
	}
	class MockUpdateCommand {
		constructor(input) { this.input = input; this._type = 'UpdateCommand'; }
	}
	return {
		DynamoDBDocumentClient: {
			from: jest.fn().mockReturnValue({ send: mockSend }),
		},
		GetCommand: MockGetCommand,
		PutCommand: MockPutCommand,
		DeleteCommand: MockDeleteCommand,
		QueryCommand: MockQueryCommand,
		UpdateCommand: MockUpdateCommand,
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

const { getUserByKeyHash, putUserRecord } = require('../../models/user');

describe('Feature: update-auth-function-to-use-cache-data', () => {

	beforeEach(() => {
		inMemoryStore = {};
		mockSend.mockReset();

		// >! Simulate DynamoDB behavior with in-memory store
		mockSend.mockImplementation((command) => {
			if (command._type === 'PutCommand') {
				const item = command.input.Item;
				inMemoryStore[item.pk] = { ...item };
				return Promise.resolve({});
			}
			if (command._type === 'GetCommand') {
				const pk = command.input.Key.pk;
				const item = inMemoryStore[pk] || undefined;
				return Promise.resolve({ Item: item });
			}
			return Promise.resolve({});
		});
	});

	it('Property 3: User DAO put/get round-trip', () => {
		fc.assert(
			fc.asyncProperty(
				// Generate a hex hash string (simulating HMAC-SHA256 output)
				fc.hexaString({ minLength: 8, maxLength: 64 }),
				// Generate a valid email
				fc.emailAddress(),
				// Generate a tier from the valid set
				fc.constantFrom('registered', 'paid', 'private'),
				// Generate a cognitoSub (UUID-like string)
				fc.uuid(),
				// Generate a createdAt ISO 8601 timestamp
				fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
					.map(d => d.toISOString()),
				// Generate a numeric ttl (Unix epoch seconds)
				fc.integer({ min: 1700000000, max: 2000000000 }),
				// Generate a nullable tierExpiresAt
				fc.option(
					fc.date({ min: new Date('2024-01-01'), max: new Date('2030-12-31') })
						.map(d => d.toISOString()),
					{ nil: null }
				),
				async (hash, email, tier, cognitoSub, createdAt, ttl, tierExpiresAt) => {
					// Build the user record
					const record = {
						pk: `KEY#${hash}`,
						email,
						tier,
						cognitoSub,
						createdAt,
						ttl,
						tierExpiresAt,
					};

					// Store via putUserRecord
					await putUserRecord(record);

					// Retrieve via getUserByKeyHash
					const retrieved = await getUserByKeyHash(hash);

					// Verify all fields match
					expect(retrieved).not.toBeNull();
					expect(retrieved.pk).toBe(record.pk);
					expect(retrieved.email).toBe(record.email);
					expect(retrieved.tier).toBe(record.tier);
					expect(retrieved.cognitoSub).toBe(record.cognitoSub);
					expect(retrieved.createdAt).toBe(record.createdAt);
					expect(retrieved.ttl).toBe(record.ttl);
					expect(retrieved.tierExpiresAt).toBe(record.tierExpiresAt);
				}
			),
			{ numRuns: 100 }
		);
	});
});
