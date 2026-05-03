/**
 * Property 4: Profile response structure completeness
 *
 * Validates: Requirements 5.2, 17.1
 *
 * For any valid user record (with varying tiers, tierExpiresAt values
 * including null and past/future dates, and createdAt timestamps) and
 * any session record state (present with varying remaining counts, or
 * absent), the profile response SHALL always contain exactly the fields
 * { email, tier, tierExpiresAt, createdAt, rateLimits: { limit,
 * remaining, windowResetAt, windowMinutes } } where:
 * - tier equals the effective tier (falls back to registered if
 *   tierExpiresAt is in the past)
 * - remaining equals the session record's remaining value when present,
 *   or the tier's limitPerWindow when absent
 * - limit equals the effective tier's limitPerWindow
 * - windowMinutes equals the effective tier's windowInMinutes
 *
 * Tests the service layer directly (not through controllers).
 *
 * @module tests/property/profile-response-structure
 */

'use strict';

const fc = require('fast-check');

/* ------------------------------------------------------------------ */
/*  Mock Setup                                                        */
/* ------------------------------------------------------------------ */

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

// Mock ../config with rate limit settings
const mockSettings = {
	rateLimits: {
		public: { limitPerWindow: 50, windowInMinutes: 60 },
		registered: { limitPerWindow: 100, windowInMinutes: 60 },
		paid: { limitPerWindow: 3000, windowInMinutes: 1440 },
		private: { limitPerWindow: 6000, windowInMinutes: 1440 }
	},
	ssm: {
		sessionHashSalt: {
			getValue: jest.fn().mockResolvedValue('test-session-salt')
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
const mockGetSessionRecord = jest.fn();
jest.mock('../../models/user', () => ({
	queryByEmail: mockQueryByEmail,
	getSessionRecord: mockGetSessionRecord
}));

// Mock ../../utils/window-calculator
jest.mock('../../utils/window-calculator', () => ({
	computeWindowBoundaries: jest.fn().mockReturnValue({
		windowStartMinutes: 29340,
		resetTimeMinutes: 29400
	}),
	computeSessionKey: jest.fn().mockReturnValue('session-pk-hash')
}));

const { getProfile } = require('../../services/profile');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/** Generate a tier value from the valid set */
const tierArb = fc.constantFrom('registered', 'paid', 'private');

/** Generate a future ISO 8601 date string */
const futureDateArb = fc
	.date({ min: new Date(Date.now() + 86400000), max: new Date('2030-12-31') })
	.map(d => d.toISOString());

/** Generate a past ISO 8601 date string */
const pastDateArb = fc
	.date({ min: new Date('2020-01-01'), max: new Date(Date.now() - 86400000) })
	.map(d => d.toISOString());

/** Generate tierExpiresAt: null, future, or past */
const tierExpiresAtArb = fc.oneof(
	fc.constant(null),
	futureDateArb,
	pastDateArb
);

/** Generate a valid email address */
const emailArb = fc.emailAddress();

/** Generate a valid ISO 8601 createdAt date string */
const createdAtArb = fc
	.date({ min: new Date('2020-01-01'), max: new Date() })
	.map(d => d.toISOString());

/** Generate a Cognito sub (UUID-like string) */
const cognitoSubArb = fc.uuid();

/** Generate a user record with all required fields */
const userRecordArb = fc.record({
	email: emailArb,
	tier: tierArb,
	tierExpiresAt: tierExpiresAtArb,
	createdAt: createdAtArb,
	cognitoSub: cognitoSubArb,
	pk: fc.hexaString({ minLength: 8, maxLength: 16 }).map(s => `KEY#${s}`)
});

/** Generate a session state: existing record or null */
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
	mockSettings.ssm.sessionHashSalt.getValue.mockClear();

	mockQueryByEmail.mockResolvedValue([userRecord]);
	mockGetSessionRecord.mockResolvedValue(sessionState);
	mockSettings.ssm.sessionHashSalt.getValue.mockResolvedValue('test-session-salt');
}

/**
 * Compute the expected effective tier.
 *
 * @param {string} tier - Stored tier
 * @param {string|null} tierExpiresAt - Expiration timestamp or null
 * @returns {string} Effective tier
 */
function expectedEffectiveTier(tier, tierExpiresAt) {
	if (tierExpiresAt && new Date(tierExpiresAt) < new Date()) {
		return 'registered';
	}
	return tier;
}

/* ------------------------------------------------------------------ */
/*  Property 4: Profile response structure completeness               */
/* ------------------------------------------------------------------ */

/**
 * **Validates: Requirements 5.2, 17.1**
 */
describe('Property 4: Profile response structure completeness', () => {

	it('profile response contains all required fields with correct types for any valid user and session state', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				sessionStateArb,
				async (userRecord, sessionState) => {
					configureMocks(userRecord, sessionState);

					const result = await getProfile(userRecord.email, userRecord.cognitoSub);

					// >! Verify all required top-level fields exist with correct types
					expect(typeof result.email).toBe('string');
					expect(typeof result.tier).toBe('string');
					expect(result.tierExpiresAt === null || typeof result.tierExpiresAt === 'string').toBe(true);
					expect(typeof result.createdAt).toBe('string');

					// >! Verify rateLimits object exists with all required fields
					expect(result.rateLimits).toBeDefined();
					expect(typeof result.rateLimits).toBe('object');
					expect(typeof result.rateLimits.limit).toBe('number');
					expect(typeof result.rateLimits.remaining).toBe('number');
					expect(typeof result.rateLimits.windowResetAt).toBe('number');
					expect(typeof result.rateLimits.windowMinutes).toBe('number');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('tier equals effective tier (falls back to registered if tierExpiresAt is in the past)', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				sessionStateArb,
				async (userRecord, sessionState) => {
					configureMocks(userRecord, sessionState);

					const result = await getProfile(userRecord.email, userRecord.cognitoSub);
					const expected = expectedEffectiveTier(userRecord.tier, userRecord.tierExpiresAt);

					expect(result.tier).toBe(expected);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('remaining equals session remaining when present, or tier limitPerWindow when absent', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				sessionStateArb,
				async (userRecord, sessionState) => {
					configureMocks(userRecord, sessionState);

					const result = await getProfile(userRecord.email, userRecord.cognitoSub);
					const effectiveTier = expectedEffectiveTier(userRecord.tier, userRecord.tierExpiresAt);
					const tierConfig = mockSettings.rateLimits[effectiveTier];

					if (sessionState) {
						expect(result.rateLimits.remaining).toBe(sessionState.remaining);
					} else {
						expect(result.rateLimits.remaining).toBe(tierConfig.limitPerWindow);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('limit equals effective tier limitPerWindow and windowMinutes equals effective tier windowInMinutes', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				sessionStateArb,
				async (userRecord, sessionState) => {
					configureMocks(userRecord, sessionState);

					const result = await getProfile(userRecord.email, userRecord.cognitoSub);
					const effectiveTier = expectedEffectiveTier(userRecord.tier, userRecord.tierExpiresAt);
					const tierConfig = mockSettings.rateLimits[effectiveTier];

					expect(result.rateLimits.limit).toBe(tierConfig.limitPerWindow);
					expect(result.rateLimits.windowMinutes).toBe(tierConfig.windowInMinutes);
				}
			),
			{ numRuns: 100 }
		);
	});
});
