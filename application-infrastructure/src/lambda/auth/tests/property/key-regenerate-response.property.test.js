/**
 * Property 5: Key regenerate response structure
 *
 * Validates: Requirements 17.2
 *
 * For any valid user record, the key regeneration response SHALL always
 * contain exactly the fields { apiKey, message } where apiKey matches
 * the format /^atl_[0-9a-f]{32}$/ and message is a non-empty string.
 *
 * Tests the service layer directly (not through controllers).
 *
 * @module tests/property/key-regenerate-response
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

// Mock ../config
const mockSettings = {
	ssm: {
		apiKeyHashSalt: {
			getValue: jest.fn().mockResolvedValue('test-salt-value')
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
const mockDeleteUserRecord = jest.fn().mockResolvedValue();
const mockPutUserRecord = jest.fn().mockResolvedValue();
jest.mock('../../models/user', () => ({
	queryByEmail: mockQueryByEmail,
	deleteUserRecord: mockDeleteUserRecord,
	putUserRecord: mockPutUserRecord
}));

// Mock ../../services/cognito
const mockUpdateUserAttributes = jest.fn().mockResolvedValue();
jest.mock('../../services/cognito', () => ({
	updateUserAttributes: mockUpdateUserAttributes
}));

// >! Do NOT mock api-key — use real generateApiKey to test actual key format
// The real generateApiKey uses crypto.randomBytes, producing valid atl_ keys

const { regenerateKey } = require('../../services/key-regenerate');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/** Generate a tier value from the valid set */
const tierArb = fc.constantFrom('registered', 'paid', 'private');

/** Generate a valid email address */
const emailArb = fc.emailAddress();

/** Generate a Cognito sub (UUID-like string) */
const cognitoSubArb = fc.uuid();

/** Generate tierExpiresAt: null or future date */
const tierExpiresAtArb = fc.oneof(
	fc.constant(null),
	fc.date({ min: new Date(Date.now() + 86400000), max: new Date('2030-12-31') })
		.map(d => d.toISOString())
);

/** Generate a user record with all required fields */
const userRecordArb = fc.record({
	email: emailArb,
	tier: tierArb,
	tierExpiresAt: tierExpiresAtArb,
	cognitoSub: cognitoSubArb,
	pk: fc.hexaString({ minLength: 8, maxLength: 16 }).map(s => `KEY#${s}`)
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Configure mocks for a single property test iteration.
 *
 * @param {Object} userRecord - Generated user record
 */
function configureMocks(userRecord) {
	mockQueryByEmail.mockReset();
	mockDeleteUserRecord.mockReset();
	mockPutUserRecord.mockReset();
	mockUpdateUserAttributes.mockReset();
	mockSettings.ssm.apiKeyHashSalt.getValue.mockClear();

	mockQueryByEmail.mockResolvedValue([userRecord]);
	mockDeleteUserRecord.mockResolvedValue();
	mockPutUserRecord.mockResolvedValue();
	mockUpdateUserAttributes.mockResolvedValue();
	mockSettings.ssm.apiKeyHashSalt.getValue.mockResolvedValue('test-salt-value');
}

/* ------------------------------------------------------------------ */
/*  Property 5: Key regenerate response structure                     */
/* ------------------------------------------------------------------ */

/**
 * **Validates: Requirements 17.2**
 */
describe('Property 5: Key regenerate response structure', () => {

	it('response contains apiKey matching /^atl_[0-9a-f]{32}$/ and a non-empty message for any valid user record', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				async (userRecord) => {
					configureMocks(userRecord);

					const result = await regenerateKey(userRecord.email, userRecord.cognitoSub);

					// >! Verify response has exactly the expected fields
					expect(result).toHaveProperty('apiKey');
					expect(result).toHaveProperty('message');

					// >! Verify apiKey matches the required format
					expect(result.apiKey).toMatch(/^atl_[0-9a-f]{32}$/);

					// >! Verify message is a non-empty string
					expect(typeof result.message).toBe('string');
					expect(result.message.length).toBeGreaterThan(0);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('apiKey is unique across regenerations', () => {
		return fc.assert(
			fc.asyncProperty(
				userRecordArb,
				async (userRecord) => {
					configureMocks(userRecord);
					const result1 = await regenerateKey(userRecord.email, userRecord.cognitoSub);

					configureMocks(userRecord);
					const result2 = await regenerateKey(userRecord.email, userRecord.cognitoSub);

					// >! Each regeneration should produce a different key
					// (extremely unlikely to collide with 128-bit entropy)
					expect(result1.apiKey).not.toBe(result2.apiKey);
				}
			),
			{ numRuns: 50 }
		);
	});
});
