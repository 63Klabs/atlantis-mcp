/**
 * Property 6: Voucher redeem response structure
 *
 * Validates: Requirements 17.3
 *
 * For any valid voucher (not expired, uses remaining, with a targetTier
 * and durationDays) and valid user record, the voucher redemption
 * response SHALL always contain exactly the fields { tier, tierExpiresAt,
 * message } where tier equals the voucher's targetTier and tierExpiresAt
 * is a valid ISO 8601 timestamp in the future.
 *
 * Tests the service layer directly (not through controllers).
 *
 * @module tests/property/voucher-redeem-response
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

// Mock ../../models/user
const mockQueryByEmail = jest.fn();
const mockUpdateUserTier = jest.fn().mockResolvedValue();
jest.mock('../../models/user', () => ({
	queryByEmail: mockQueryByEmail,
	updateUserTier: mockUpdateUserTier
}));

// Mock ../../models/voucher
const mockGetVoucher = jest.fn();
const mockIncrementVoucherUses = jest.fn().mockResolvedValue();
jest.mock('../../models/voucher', () => ({
	getVoucher: mockGetVoucher,
	incrementVoucherUses: mockIncrementVoucherUses
}));

// Mock ../../services/cognito
const mockUpdateUserAttributes = jest.fn().mockResolvedValue();
jest.mock('../../services/cognito', () => ({
	updateUserAttributes: mockUpdateUserAttributes
}));

const { redeemVoucher } = require('../../services/voucher-redeem');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/** Generate a target tier from the valid set */
const targetTierArb = fc.constantFrom('registered', 'paid', 'private');

/** Generate a valid email address */
const emailArb = fc.emailAddress();

/** Generate a Cognito sub (UUID-like string) */
const cognitoSubArb = fc.uuid();

/** Generate a voucher code (alphanumeric string) */
const voucherCodeArb = fc.stringOf(
	fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
	{ minLength: 4, maxLength: 20 }
);

/** Generate durationDays (positive integer, 1-365) */
const durationDaysArb = fc.integer({ min: 1, max: 365 });

/**
 * Generate a valid voucher record (not expired, uses remaining).
 * expiresAt is always in the future, currentUses < maxUses.
 */
const validVoucherArb = fc.record({
	targetTier: targetTierArb,
	durationDays: durationDaysArb,
	expiresAt: fc.date({ min: new Date(Date.now() + 86400000), max: new Date('2030-12-31') })
		.map(d => d.toISOString()),
	maxUses: fc.integer({ min: 1, max: 1000 }),
	currentUses: fc.constant(0)
});

/** Generate a user record with all required fields */
const userRecordArb = fc.record({
	email: emailArb,
	tier: fc.constantFrom('registered', 'paid', 'private'),
	tierExpiresAt: fc.oneof(fc.constant(null), fc.constant(undefined)),
	cognitoSub: cognitoSubArb,
	pk: fc.hexaString({ minLength: 8, maxLength: 16 }).map(s => `KEY#${s}`)
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Configure mocks for a single property test iteration.
 *
 * @param {Object} voucher - Generated voucher record
 * @param {Object} userRecord - Generated user record
 */
function configureMocks(voucher, userRecord) {
	mockGetVoucher.mockReset();
	mockQueryByEmail.mockReset();
	mockUpdateUserTier.mockReset();
	mockIncrementVoucherUses.mockReset();
	mockUpdateUserAttributes.mockReset();

	mockGetVoucher.mockResolvedValue(voucher);
	mockQueryByEmail.mockResolvedValue([userRecord]);
	mockUpdateUserTier.mockResolvedValue();
	mockIncrementVoucherUses.mockResolvedValue();
	mockUpdateUserAttributes.mockResolvedValue();
}

/* ------------------------------------------------------------------ */
/*  Property 6: Voucher redeem response structure                     */
/* ------------------------------------------------------------------ */

/**
 * **Validates: Requirements 17.3**
 */
describe('Property 6: Voucher redeem response structure', () => {

	it('response contains correct tier, future tierExpiresAt, and message for any valid voucher and user', () => {
		return fc.assert(
			fc.asyncProperty(
				voucherCodeArb,
				validVoucherArb,
				userRecordArb,
				async (code, voucher, userRecord) => {
					configureMocks(voucher, userRecord);

					const result = await redeemVoucher(code, userRecord.email, userRecord.cognitoSub);

					// >! Verify response has exactly the expected fields
					expect(result).toHaveProperty('tier');
					expect(result).toHaveProperty('tierExpiresAt');
					expect(result).toHaveProperty('message');

					// >! Verify tier equals the voucher's targetTier
					expect(result.tier).toBe(voucher.targetTier);

					// >! Verify tierExpiresAt is a valid ISO 8601 timestamp in the future
					expect(typeof result.tierExpiresAt).toBe('string');
					const expiresDate = new Date(result.tierExpiresAt);
					expect(expiresDate.getTime()).not.toBeNaN();
					expect(expiresDate.getTime()).toBeGreaterThan(Date.now());

					// >! Verify message is a non-empty string
					expect(typeof result.message).toBe('string');
					expect(result.message.length).toBeGreaterThan(0);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('tierExpiresAt is approximately durationDays in the future', () => {
		return fc.assert(
			fc.asyncProperty(
				voucherCodeArb,
				validVoucherArb,
				userRecordArb,
				async (code, voucher, userRecord) => {
					configureMocks(voucher, userRecord);

					const beforeCall = Date.now();
					const result = await redeemVoucher(code, userRecord.email, userRecord.cognitoSub);
					const afterCall = Date.now();

					const expiresMs = new Date(result.tierExpiresAt).getTime();
					const expectedMinMs = beforeCall + voucher.durationDays * 24 * 60 * 60 * 1000;
					const expectedMaxMs = afterCall + voucher.durationDays * 24 * 60 * 60 * 1000;

					// >! tierExpiresAt should be within the expected range
					expect(expiresMs).toBeGreaterThanOrEqual(expectedMinMs);
					expect(expiresMs).toBeLessThanOrEqual(expectedMaxMs);
				}
			),
			{ numRuns: 100 }
		);
	});
});
