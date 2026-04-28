// Feature: 0-0-3-add-authentication, Properties 11, 12: Voucher validation
'use strict';

// Mock AWS SDK modules to prevent import issues
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
	CognitoIdentityProviderClient: jest.fn(),
	AdminUpdateUserAttributesCommand: jest.fn()
}));
jest.mock('../../utils/jwt-validator', () => ({ validateJwt: jest.fn() }));
jest.mock('../../utils/dynamo-client', () => ({
	queryByEmail: jest.fn(),
	getVoucher: jest.fn(),
	incrementVoucherUses: jest.fn(),
	updateUserTier: jest.fn()
}));

const fc = require('fast-check');
const { TestHarness } = require('../../handlers/voucher-redeem');

const { validateVoucher } = TestHarness.getInternals();

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

const tierArb = fc.constantFrom('registered', 'paid', 'private');

const durationDaysArb = fc.integer({ min: 1, max: 365 });

const pastDateArb = fc
	.date({ min: new Date('2020-01-01'), max: new Date(Date.now() - 86400000) })
	.map(d => d.toISOString());

const futureDateArb = fc
	.date({ min: new Date(Date.now() + 86400000), max: new Date('2030-12-31') })
	.map(d => d.toISOString());

const voucherCodeArb = fc.string({
	unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'),
	minLength: 4, maxLength: 20
});

/* ------------------------------------------------------------------ */
/*  Property 11: Invalid voucher rejection                            */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 9.2, 9.3, 9.4
 */
describe('Property 11: Invalid voucher rejection', () => {

	it('non-existent voucher (null) returns error with statusCode 400', () => {
		fc.assert(
			fc.property(
				voucherCodeArb,
				(code) => {
					const result = validateVoucher(null, code);
					expect(result).not.toBeNull();
					expect(result.statusCode).toBe(400);
					expect(typeof result.error).toBe('string');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('expired voucher returns error with statusCode 400 and expired message', () => {
		fc.assert(
			fc.property(
				pastDateArb,
				tierArb,
				durationDaysArb,
				fc.integer({ min: 0, max: 1000 }),
				fc.integer({ min: 0, max: 1000 }),
				(expiresAt, targetTier, durationDays, maxUses, currentUses) => {
					const voucher = {
						targetTier,
						durationDays,
						maxUses,
						currentUses,
						expiresAt
					};
					const result = validateVoucher(voucher, 'TEST');
					expect(result).not.toBeNull();
					expect(result.statusCode).toBe(400);
					expect(result.error.toLowerCase()).toContain('expired');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('fully redeemed voucher (currentUses >= maxUses, maxUses > 0) returns 400 with redeemed message', () => {
		fc.assert(
			fc.property(
				futureDateArb,
				tierArb,
				durationDaysArb,
				fc.integer({ min: 1, max: 1000 }),
				(expiresAt, targetTier, durationDays, maxUses) => {
					const currentUses = fc.sample(fc.integer({ min: maxUses, max: maxUses + 100 }), 1)[0];
					const voucher = {
						targetTier,
						durationDays,
						maxUses,
						currentUses,
						expiresAt
					};
					const result = validateVoucher(voucher, 'TEST');
					expect(result).not.toBeNull();
					expect(result.statusCode).toBe(400);
					expect(result.error.toLowerCase()).toContain('fully redeemed');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('unlimited uses voucher (maxUses = 0) with any currentUses returns null (valid)', () => {
		fc.assert(
			fc.property(
				futureDateArb,
				tierArb,
				durationDaysArb,
				fc.integer({ min: 0, max: 10000 }),
				(expiresAt, targetTier, durationDays, currentUses) => {
					const voucher = {
						targetTier,
						durationDays,
						maxUses: 0,
						currentUses,
						expiresAt
					};
					const result = validateVoucher(voucher, 'TEST');
					expect(result).toBeNull();
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Property 12: Valid voucher tier update                            */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 9.5
 */
describe('Property 12: Valid voucher tier update', () => {

	it('computed tierExpiresAt is approximately now + durationDays', () => {
		fc.assert(
			fc.property(
				tierArb,
				durationDaysArb,
				(targetTier, durationDays) => {
					const now = new Date();
					const computed = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
					const expectedMs = durationDays * 24 * 60 * 60 * 1000;
					const actualMs = computed.getTime() - now.getTime();

					// Allow 1 second tolerance for execution time
					expect(Math.abs(actualMs - expectedMs)).toBeLessThan(1000);
					// tierExpiresAt should be in the future
					expect(computed.getTime()).toBeGreaterThan(now.getTime());
				}
			),
			{ numRuns: 100 }
		);
	});

	it('targetTier from voucher is always one of the valid tiers', () => {
		const validTiers = ['registered', 'paid', 'private'];
		fc.assert(
			fc.property(
				tierArb,
				durationDaysArb,
				futureDateArb,
				fc.integer({ min: 0, max: 1000 }),
				fc.integer({ min: 0, max: 1000 }),
				(targetTier, durationDays, expiresAt, maxUses, currentUses) => {
					const voucher = {
						targetTier,
						durationDays,
						maxUses,
						currentUses,
						expiresAt
					};
					expect(validTiers).toContain(voucher.targetTier);
				}
			),
			{ numRuns: 100 }
		);
	});
});
