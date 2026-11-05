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
const TierCommon = require('../../utils/tier-common');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/** Generate a target tier a voucher may grant (spec 0-0-7-lapsed-tier-downgrade: paid or private only) */
const targetTierArb = fc.constantFrom('paid', 'private');

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

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_MS = Date.now();

/** Generate a day offset of at least 2 days, so the clock moving during a run cannot change a state */
const dayOffsetArb = fc.integer({ min: 2, max: 400 });

/**
 * Generate a realistic stored tierExpiresAt: null, absent, a future ISO timestamp,
 * a past ISO timestamp, or a value that does not parse.
 */
const tierExpiresAtArb = fc.oneof(
	fc.constant(null),
	fc.constant(undefined),
	dayOffsetArb.map(days => new Date(BASE_MS + days * DAY_MS).toISOString()),
	dayOffsetArb.map(days => new Date(BASE_MS - days * DAY_MS).toISOString()),
	fc.constantFrom('not-a-date', '2026-13-45', '', 1767225600)
);

/** Generate a realistic user record with all required fields (no remembered tier) */
const userRecordArb = fc.record({
	email: emailArb,
	tier: fc.constantFrom('registered', 'paid', 'private'),
	tierExpiresAt: tierExpiresAtArb,
	cognitoSub: cognitoSubArb,
	pk: fc.hexaString({ minLength: 8, maxLength: 16 }).map(s => `KEY#${s}`)
});

/**
 * Model the redemption rule independently of the implementation.
 *
 * @param {Object} userRecord - Generated user record (no fallback attributes)
 * @param {Object} voucher - Generated voucher
 * @returns {'apply'|'extend'|'reject'} Expected outcome
 */
function expectedOutcome(userRecord, voucher) {
	const current = TierCommon.resolveRecordTier(userRecord);
	const holdingTier = (current.state === 'none' || current.state === 'active') ? current.tier : 'registered';
	const holdingRank = TierCommon.TIER_RANK[holdingTier];
	const targetRank = TierCommon.TIER_RANK[voucher.targetTier];
	if (targetRank > holdingRank) {
		return 'apply';
	}
	if (targetRank === holdingRank && current.state === 'active') {
		return 'extend';
	}
	return 'reject';
}

/** Offsets (days) of the instants sampled after a redemption */
const SAMPLE_OFFSET_DAYS = [0, 1, 7, 30, 31, 90, 119, 121, 200, 365, 366, 800];

/**
 * Apply what redeemVoucher wrote through updateUserTier to a record, in memory.
 *
 * @param {Object} userRecord - Record as read
 * @param {Array} writeArgs - Arguments updateUserTier was called with
 * @returns {Object} Record as stored after the write
 */
function applyWrite(userRecord, writeArgs) {
	const [, tier, tierExpiresAt, , options] = writeArgs;
	const written = { ...userRecord, tier, tierExpiresAt };
	const fallback = options && options.fallback;
	if (fallback === null) {
		delete written.fallbackTier;
		delete written.fallbackExpiresAt;
	} else if (fallback) {
		written.fallbackTier = fallback.tier;
		written.fallbackExpiresAt = fallback.tierExpiresAt;
	}
	return written;
}

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
					// >! Only redemptions the rule accepts have a response of this shape; rejections are covered below
					fc.pre(expectedOutcome(userRecord, voucher) !== 'reject');
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
					// >! Only an apply sets the end date to now + durationDays; an extend keeps a later existing date
					fc.pre(expectedOutcome(userRecord, voucher) === 'apply');
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

/* ------------------------------------------------------------------ */
/*  Redemption rule (spec 0-0-7-lapsed-tier-downgrade)                */
/* ------------------------------------------------------------------ */

/**
 * **Validates: Requirements 11.2 to 11.7, 12.2, 19.2, 19.3, 19.10**
 */
describe('Property: voucher redemption rule over realistic user records', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('a redemption is rejected exactly when it would lower the tier or the end date, and a rejection writes nothing', () => {
		return fc.assert(
			fc.asyncProperty(
				voucherCodeArb,
				validVoucherArb,
				userRecordArb,
				async (code, voucher, userRecord) => {
					configureMocks(voucher, userRecord);
					const outcome = expectedOutcome(userRecord, voucher);
					let error = null;
					let result = null;
					try {
						result = await redeemVoucher(code, userRecord.email, userRecord.cognitoSub);
					} catch (caught) {
						error = caught;
					}
					if (outcome === 'reject') {
						expect(error).not.toBeNull();
						expect(error.statusCode).toBe(400);
						expect(mockUpdateUserTier).not.toHaveBeenCalled();
						expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
						expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
					} else {
						expect(error).toBeNull();
						expect(result.tier).toBe(voucher.targetTier);
						expect(mockUpdateUserTier).toHaveBeenCalledTimes(1);
						const options = mockUpdateUserTier.mock.calls[0][4];
						// >! The write is conditional on what was read
						expect(options.expected.tier).toBe(userRecord.tier);
						expect(options.expected.tierExpiresAt).toEqual(userRecord.tierExpiresAt);
						// >! Cognito follows the stored tier only when it changes
						if (userRecord.tier === voucher.targetTier) {
							expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
						} else {
							expect(mockUpdateUserAttributes).toHaveBeenCalledTimes(1);
						}
						if (outcome === 'extend') {
							expect(options.fallback).toBeUndefined();
							expect(new Date(result.tierExpiresAt).getTime())
								.toBeGreaterThanOrEqual(new Date(userRecord.tierExpiresAt).getTime());
						}
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('Requirement 11.10 / 19.15: what is written never lowers the rank held at any sampled later instant', () => {
		return fc.assert(
			fc.asyncProperty(
				voucherCodeArb,
				validVoucherArb,
				userRecordArb,
				async (code, voucher, userRecord) => {
					configureMocks(voucher, userRecord);
					try {
						await redeemVoucher(code, userRecord.email, userRecord.cognitoSub);
					} catch {
						// >! A rejection writes nothing, so the record is unchanged and the property holds trivially
						expect(mockUpdateUserTier).not.toHaveBeenCalled();
						return;
					}
					const written = applyWrite(userRecord, mockUpdateUserTier.mock.calls[0]);
					for (const offsetDays of SAMPLE_OFFSET_DAYS) {
						const atMs = Date.now() + offsetDays * DAY_MS;
						const before = TierCommon.resolveRecordTier(userRecord, atMs).tier;
						const after = TierCommon.resolveRecordTier(written, atMs).tier;
						expect(TierCommon.TIER_RANK[after]).toBeGreaterThanOrEqual(TierCommon.TIER_RANK[before]);
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});
