// Feature: user-profile-enhancement, Property 4: Profile response completeness
'use strict';

const fc = require('fast-check');

/* ------------------------------------------------------------------ */
/*  Mock Setup                                                        */
/*  All external dependencies are mocked before requiring the handler */
/* ------------------------------------------------------------------ */

// >! Mock JWT validator — returns controlled payload for each test run
jest.mock('../../utils/jwt-validator', () => ({
	validateJwt: jest.fn()
}));

// >! Mock DynamoDB client — controls user record and session record responses
jest.mock('../../utils/dynamo-client', () => ({
	queryByEmail: jest.fn(),
	getSessionRecord: jest.fn()
}));

// >! Mock SSM client — prevents real AWS calls
jest.mock('@aws-sdk/client-ssm', () => ({
	SSMClient: jest.fn().mockImplementation(() => ({
		send: jest.fn().mockResolvedValue({
			Parameter: { Value: 'test-session-salt' }
		})
	})),
	GetParameterCommand: jest.fn()
}));

const { validateJwt } = require('../../utils/jwt-validator');
const { queryByEmail, getSessionRecord } = require('../../utils/dynamo-client');
const { handler } = require('../../handlers/profile');

/* ------------------------------------------------------------------ */
/*  Environment Variables                                             */
/* ------------------------------------------------------------------ */

const RATE_LIMIT_ENV = {
	MCP_PUBLIC_RATE_LIMIT: '50',
	MCP_PUBLIC_RATE_TIME_RANGE_MINUTES: '60',
	MCP_REGISTERED_RATE_LIMIT: '100',
	MCP_REGISTERED_RATE_TIME_RANGE_MINUTES: '60',
	MCP_PAID_RATE_LIMIT: '3000',
	MCP_PAID_RATE_TIME_RANGE_MINUTES: '1440',
	MCP_PRIVATE_RATE_LIMIT: '6000',
	MCP_PRIVATE_RATE_TIME_RANGE_MINUTES: '1440',
	SESSIONS_TABLE: 'test-sessions-table',
	PARAM_STORE_PATH: '/test/path/'
};

let savedEnv;

beforeEach(() => {
	savedEnv = { ...process.env };
	Object.assign(process.env, RATE_LIMIT_ENV);
	jest.clearAllMocks();
});

afterEach(() => {
	process.env = savedEnv;
});

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
	validateJwt.mockReset();
	queryByEmail.mockReset();
	getSessionRecord.mockReset();

	validateJwt.mockResolvedValue({
		sub: userRecord.cognitoSub,
		email: userRecord.email
	});
	queryByEmail.mockResolvedValue([userRecord]);
	getSessionRecord.mockResolvedValue(sessionState);
}

/**
 * Build a minimal API Gateway proxy event for GET /auth/profile.
 *
 * @returns {Object} API Gateway proxy event
 */
function buildEvent() {
	return {
		httpMethod: 'GET',
		path: '/auth/profile',
		headers: {
			Authorization: 'Bearer test-jwt-token'
		}
	};
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

					const response = await handler(buildEvent());

					// >! Verify HTTP 200 success
					expect(response.statusCode).toBe(200);
					expect(response.headers).toBeDefined();
					expect(response.body).toBeDefined();

					const body = JSON.parse(response.body);

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

					const response = await handler(buildEvent());
					const body = JSON.parse(response.body);

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

					const response = await handler(buildEvent());
					const body = JSON.parse(response.body);

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

					const response = await handler(buildEvent());
					const body = JSON.parse(response.body);

					// >! remaining should match the session record's remaining value
					expect(body.rateLimits.remaining).toBe(sessionRecord.remaining);
				}
			),
			{ numRuns: 100 }
		);
	});
});
