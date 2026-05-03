// Feature: user-profile-enhancement, Property 4: Profile response completeness
'use strict';

const fc = require('fast-check');

/* ------------------------------------------------------------------ */
/*  Mock Setup                                                        */
/*  All external dependencies are mocked before requiring the service */
/* ------------------------------------------------------------------ */

// >! Mock DynamoDB SDK to prevent real AWS calls
jest.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: jest.fn().mockImplementation(() => ({}))
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({
		send: jest.fn()
	}) },
	GetCommand: jest.fn(),
	PutCommand: jest.fn(),
	DeleteCommand: jest.fn(),
	QueryCommand: jest.fn(),
	UpdateCommand: jest.fn()
}));

// >! Mock cache-data to prevent real AWS calls
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
			log: jest.fn(),
			info: jest.fn()
		},
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn().mockResolvedValue('test-value')
		}))
	}
}));

// >! Mock Config to provide controlled settings
const mockSessionHashSaltGetValue = jest.fn().mockResolvedValue('test-session-salt');
jest.mock('../../config', () => ({
	Config: {
		settings: jest.fn().mockReturnValue({
			usersTable: 'test-Users',
			sessionsTable: 'test-Sessions',
			cognito: { userPoolId: { getValue: jest.fn().mockResolvedValue('us-east-1_TestPool') } },
			ssm: {
				apiKeyHashSalt: { getValue: jest.fn().mockResolvedValue('test-salt') },
				sessionHashSalt: { getValue: mockSessionHashSaltGetValue }
			},
			rateLimits: {
				public: { limitPerWindow: 50, windowInMinutes: 60 },
				registered: { limitPerWindow: 100, windowInMinutes: 60 },
				paid: { limitPerWindow: 3000, windowInMinutes: 1440 },
				private: { limitPerWindow: 6000, windowInMinutes: 1440 }
			}
		}),
		promise: jest.fn().mockResolvedValue(undefined),
		prime: jest.fn().mockResolvedValue(undefined)
	}
}));

// >! Mock User DAO — controls user record and session record responses
const mockQueryByEmail = jest.fn();
const mockGetSessionRecord = jest.fn();
jest.mock('../../models/user', () => ({
	queryByEmail: mockQueryByEmail,
	getSessionRecord: mockGetSessionRecord,
	getUserByKeyHash: jest.fn(),
	putUserRecord: jest.fn(),
	deleteUserRecord: jest.fn(),
	updateUserTier: jest.fn()
}));

const { getProfile, computeEffectiveTier } = require('../../services/profile');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/** Generate a tier value from the valid set */
const tierArb = fc.constantFrom('registered', 'paid', 'private');

/** Generate a future ISO 8601 date string or null for tierExpiresAt */
const tierExpiresAtArb = fc.oneof(
	fc.constant(null),
	fc.date({ min: new Date(Date.now() + 86400000), max: new Date('2030-12-31') })
		.map(d => d.toISOString())
);

/** Generate a valid email address */
const emailArb = fc.emailAddress();

/** Generate a valid ISO 8601 createdAt date string */
const createdAtArb = fc
	.date({ min: new Date('2020-01-01'), max: new Date() })
	.map(d => d.toISOString());

/** Generate a Cognito sub (UUID-like string) */
const cognitoSubArb = fc.uuid();

/**
 * Generate a user record with all required fields.
 * Uses future tierExpiresAt so the stored tier is the effective tier.
 */
const userRecordArb = fc.record({
	email: emailArb,
	tier: tierArb,
	tierExpiresAt: tierExpiresAtArb,
	createdAt: createdAtArb,
	cognitoSub: cognitoSubArb,
	pk: fc.string().map(s => `KEY#${s}`)
});

/**
 * Generate a session state: either an existing session record with
 * remaining/limit values, or null (no session record).
 */
const sessionStateArb = fc.oneof(
	fc.constant(null),
	fc.record({
		remaining: fc.integer({ min: 0, max: 10000 }),
		limit: fc.integer({ min: 1, max: 10000 }),
		pk: fc.string(),
		ttl: fc.integer({ min: 0 })
	})
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Configure mocks for a single property test iteration.
 *
 * @param {Object} userRecord - Generated user record
 * @param {Object|null} sessionState - Generated session state or null
 */
function configureMocks(userRecord, sessionState) {
	mockQueryByEmail.mockReset();
	mockGetSessionRecord.mockReset();

	mockQueryByEmail.mockResolvedValue([userRecord]);
	mockGetSessionRecord.mockResolvedValue(sessionState);
}

/* ------------------------------------------------------------------ */
/*  Property 4: Profile response completeness                        */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 5.1
 */
describe('Property 4: Profile response completeness', () => {

	it('profile response contains all required fields with correct types for any valid user and session state', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				sessionStateArb,
				async (userRecord, sessionState) => {
					configureMocks(userRecord, sessionState);

					const body = await getProfile(userRecord.email, userRecord.cognitoSub);

					// >! Verify all required top-level fields exist with correct types
					expect(typeof body.email).toBe('string');
					expect(typeof body.tier).toBe('string');
					expect(body.tierExpiresAt === null || typeof body.tierExpiresAt === 'string').toBe(true);
					expect(typeof body.createdAt).toBe('string');

					// >! Verify rateLimits object exists with all required fields
					expect(body.rateLimits).toBeDefined();
					expect(typeof body.rateLimits).toBe('object');
					expect(typeof body.rateLimits.limit).toBe('number');
					expect(typeof body.rateLimits.remaining).toBe('number');
					expect(typeof body.rateLimits.windowResetAt).toBe('number');
					expect(typeof body.rateLimits.windowMinutes).toBe('number');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('email in response matches the user record email', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				sessionStateArb,
				async (userRecord, sessionState) => {
					configureMocks(userRecord, sessionState);

					const body = await getProfile(userRecord.email, userRecord.cognitoSub);

					expect(body.email).toBe(userRecord.email);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('remaining equals full tier limit when no session record exists', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				async (userRecord) => {
					configureMocks(userRecord, null);

					const body = await getProfile(userRecord.email, userRecord.cognitoSub);

					// >! remaining should equal the tier's limitPerWindow
					expect(body.rateLimits.remaining).toBe(body.rateLimits.limit);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('remaining equals session record remaining when session exists', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				fc.record({
					remaining: fc.integer({ min: 0, max: 10000 }),
					limit: fc.integer({ min: 1, max: 10000 }),
					pk: fc.string(),
					ttl: fc.integer({ min: 0 })
				}),
				async (userRecord, sessionRecord) => {
					configureMocks(userRecord, sessionRecord);

					const body = await getProfile(userRecord.email, userRecord.cognitoSub);

					// >! remaining should match the session record's remaining value
					expect(body.rateLimits.remaining).toBe(sessionRecord.remaining);
				}
			),
			{ numRuns: 100 }
		);
	});
});
