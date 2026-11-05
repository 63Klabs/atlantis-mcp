/**
 * Unit tests for Voucher Redemption Service
 *
 * Tests the business logic in services/voucher-redeem.js including:
 * - Voucher validation (exists, not expired, uses remaining)
 * - Tier update and Cognito update
 * - Unlimited uses voucher (maxUses = 0)
 * - User not found error handling
 *
 * @module tests/unit/voucher-redeem-service
 */

'use strict';

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
const mockUpdateUserTier = jest.fn();
jest.mock('../../models/user', () => ({
	queryByEmail: mockQueryByEmail,
	updateUserTier: mockUpdateUserTier
}));

// Mock ../../models/voucher
const mockGetVoucher = jest.fn();
const mockIncrementVoucherUses = jest.fn();
jest.mock('../../models/voucher', () => ({
	getVoucher: mockGetVoucher,
	incrementVoucherUses: mockIncrementVoucherUses
}));

// Mock ../../services/cognito
const mockUpdateUserAttributes = jest.fn();
jest.mock('../../services/cognito', () => ({
	updateUserAttributes: mockUpdateUserAttributes
}));

const { redeemVoucher, validateVoucher, TestHarness } = require('../../services/voucher-redeem');
const TierCommon = require('../../utils/tier-common');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build a valid voucher record with optional overrides.
 *
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} Voucher record
 */
function createVoucher(overrides = {}) {
	return {
		pk: 'VOUCHER#SUMMER2025',
		targetTier: 'paid',
		durationDays: 30,
		maxUses: 100,
		currentUses: 5,
		expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
		createdBy: 'admin@example.com',
		...overrides
	};
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Voucher Redemption Service', () => {

	beforeEach(() => {
		jest.clearAllMocks();
		mockUpdateUserTier.mockResolvedValue({});
		mockIncrementVoucherUses.mockResolvedValue({});
		mockUpdateUserAttributes.mockResolvedValue();
	});

	/* -------------------------------------------------------------- */
	/*  validateVoucher                                               */
	/* -------------------------------------------------------------- */

	describe('validateVoucher', () => {
		it('should return null for valid voucher', () => {
			const voucher = createVoucher();
			expect(validateVoucher(voucher, 'SUMMER2025')).toBeNull();
		});

		it('should return error for null voucher', () => {
			const result = validateVoucher(null, 'INVALID');
			expect(result).toEqual({
				statusCode: 400,
				message: 'Invalid voucher code'
			});
		});

		it('should return error for expired voucher', () => {
			const voucher = createVoucher({
				expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
			});
			const result = validateVoucher(voucher, 'EXPIRED');
			expect(result).toEqual({
				statusCode: 400,
				message: 'Voucher has expired'
			});
		});

		it('should return error for fully redeemed voucher', () => {
			const voucher = createVoucher({
				maxUses: 100,
				currentUses: 100
			});
			const result = validateVoucher(voucher, 'FULL');
			expect(result).toEqual({
				statusCode: 400,
				message: 'Voucher has been fully redeemed'
			});
		});

		it('should return null for unlimited uses voucher (maxUses = 0)', () => {
			const voucher = createVoucher({
				maxUses: 0,
				currentUses: 999
			});
			expect(validateVoucher(voucher, 'UNLIMITED')).toBeNull();
		});
	});

	/* -------------------------------------------------------------- */
	/*  redeemVoucher                                                 */
	/* -------------------------------------------------------------- */

	describe('redeemVoucher', () => {
		it('should redeem valid voucher for authenticated user', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher());
			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#oldhash',
				email: 'test@example.com',
				tier: 'registered',
				cognitoSub: 'test-sub-123'
			}]);

			const result = await redeemVoucher('SUMMER2025', 'test@example.com', 'test-sub-123');

			expect(result.tier).toBe('paid');
			expect(result.tierExpiresAt).toBeDefined();
			expect(result.message).toBe('Voucher redeemed successfully');

			// Verify tierExpiresAt is approximately now + 30 days
			const expiresMs = new Date(result.tierExpiresAt).getTime();
			const expectedMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
			expect(expiresMs).toBeGreaterThan(expectedMs - 5000);
			expect(expiresMs).toBeLessThan(expectedMs + 5000);
		});

		it('should update user tier in DynamoDB', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher());
			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#oldhash',
				email: 'test@example.com',
				tier: 'registered',
				cognitoSub: 'test-sub-123'
			}]);

			await redeemVoucher('SUMMER2025', 'test@example.com', 'test-sub-123');

			expect(mockUpdateUserTier).toHaveBeenCalledTimes(1);
			const [pk, tier, tierExpiresAt, ttl] = mockUpdateUserTier.mock.calls[0];
			expect(pk).toBe('KEY#oldhash');
			expect(tier).toBe('paid');
			expect(tierExpiresAt).toBeDefined();
			expect(typeof ttl).toBe('number');
		});

		it('should increment voucher uses', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher());
			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#oldhash',
				email: 'test@example.com',
				tier: 'registered',
				cognitoSub: 'test-sub-123'
			}]);

			await redeemVoucher('SUMMER2025', 'test@example.com', 'test-sub-123');

			expect(mockIncrementVoucherUses).toHaveBeenCalledWith('SUMMER2025');
		});

		it('should update Cognito custom:tier', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher());
			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#oldhash',
				email: 'test@example.com',
				tier: 'registered',
				cognitoSub: 'test-sub-123'
			}]);

			await redeemVoucher('SUMMER2025', 'test@example.com', 'test-sub-123');

			expect(mockUpdateUserAttributes).toHaveBeenCalledWith(
				'test-sub-123',
				[{ Name: 'custom:tier', Value: 'paid' }]
			);
		});

		it('should throw 400 when voucher not found', async () => {
			mockGetVoucher.mockResolvedValue(null);

			await expect(redeemVoucher('INVALID', 'test@example.com', 'test-sub-123'))
				.rejects.toMatchObject({
					statusCode: 400,
					message: 'Invalid voucher code'
				});

			// Verify no further calls made
			expect(mockQueryByEmail).not.toHaveBeenCalled();
			expect(mockUpdateUserTier).not.toHaveBeenCalled();
			expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
			expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
		});

		it('should throw 400 when voucher has expired', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher({
				expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
			}));

			await expect(redeemVoucher('EXPIRED', 'test@example.com', 'test-sub-123'))
				.rejects.toMatchObject({
					statusCode: 400,
					message: 'Voucher has expired'
				});

			expect(mockUpdateUserTier).not.toHaveBeenCalled();
			expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
		});

		it('should throw 400 when voucher is fully redeemed', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher({
				maxUses: 100,
				currentUses: 100
			}));

			await expect(redeemVoucher('FULL', 'test@example.com', 'test-sub-123'))
				.rejects.toMatchObject({
					statusCode: 400,
					message: 'Voucher has been fully redeemed'
				});

			expect(mockUpdateUserTier).not.toHaveBeenCalled();
			expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
		});

		it('should allow unlimited uses voucher (maxUses = 0)', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher({
				maxUses: 0,
				currentUses: 999
			}));
			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#somehash',
				email: 'test@example.com',
				tier: 'registered',
				cognitoSub: 'test-sub-123'
			}]);

			const result = await redeemVoucher('UNLIMITED', 'test@example.com', 'test-sub-123');

			expect(result.tier).toBe('paid');
			expect(mockUpdateUserTier).toHaveBeenCalled();
			expect(mockIncrementVoucherUses).toHaveBeenCalled();
		});

		it('should throw 404 when user not found', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher());
			mockQueryByEmail.mockResolvedValue([]);

			await expect(redeemVoucher('SUMMER2025', 'unknown@example.com', 'test-sub-456'))
				.rejects.toMatchObject({
					statusCode: 404,
					message: 'User not found'
				});

			expect(mockUpdateUserTier).not.toHaveBeenCalled();
			expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
			expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
		});

		it('should propagate DynamoDB errors from queryByEmail', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher());
			mockQueryByEmail.mockRejectedValue(new Error('DynamoDB connection error'));

			await expect(redeemVoucher('SUMMER2025', 'test@example.com', 'test-sub-123'))
				.rejects.toThrow('DynamoDB connection error');
		});

		it('should propagate Cognito errors', async () => {
			mockGetVoucher.mockResolvedValue(createVoucher());
			mockQueryByEmail.mockResolvedValue([{
				pk: 'KEY#oldhash',
				email: 'test@example.com',
				tier: 'registered',
				cognitoSub: 'test-sub-123'
			}]);
			mockUpdateUserAttributes.mockRejectedValue(new Error('Cognito service error'));

			await expect(redeemVoucher('SUMMER2025', 'test@example.com', 'test-sub-123'))
				.rejects.toThrow('Cognito service error');
		});
	});
});
/* ------------------------------------------------------------------ */
/*  Redemption rule (spec 0-0-7-lapsed-tier-downgrade, Design 9)      */
/* ------------------------------------------------------------------ */
const DAY_MS = 24 * 60 * 60 * 1000;
const CONFLICT_MESSAGE = 'Your account changed while the voucher was being applied. Please try again.';
/** Fixed instant for the pure decision table (2026-11-02T12:00:00.000Z). */
const FIXED_NOW_MS = new Date('2026-11-02T12:00:00.000Z').getTime();
/**
 * Build an ISO 8601 timestamp offset from a base instant.
 *
 * @param {number} days - Days from the base (negative for the past)
 * @param {number} [baseMs=Date.now()] - Base instant in epoch milliseconds
 * @returns {string} ISO 8601 timestamp
 */
function isoFromNow(days, baseMs = Date.now()) {
	return new Date(baseMs + days * DAY_MS).toISOString();
}
/**
 * Get `decideRedemption` from the TestHarness.
 *
 * The typeof check makes a missing function fail with a clear assertion instead of a TypeError.
 *
 * @returns {Function} The decideRedemption function
 */
function getDecideRedemption() {
	const internals = TestHarness.getInternals();
	expect(typeof internals.decideRedemption).toBe('function');
	return internals.decideRedemption;
}
/**
 * Build a user record with optional overrides.
 *
 * @param {Object} overrides - Optional field overrides
 * @returns {Object} User record
 */
function createUser(overrides = {}) {
	return {
		pk: 'KEY#userhash',
		email: 'test@example.com',
		tier: 'registered',
		tierExpiresAt: null,
		cognitoSub: 'test-sub-123',
		...overrides
	};
}
/**
 * Create the error DynamoDB raises when a condition expression fails.
 *
 * @returns {Error} Error named ConditionalCheckFailedException
 */
function createConditionalFailure() {
	const error = new Error('The conditional request failed');
	error.name = 'ConditionalCheckFailedException';
	return error;
}
describe('Voucher redemption rule', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});
	/* -------------------------------------------------------------- */
	/*  decideRedemption: one case per row of the Design 9 table       */
	/* -------------------------------------------------------------- */
	describe('decideRedemption', () => {
		const voucherEndIso = isoFromNow(30, FIXED_NOW_MS);
		/**
		 * Build a validated voucher for the decision function.
		 *
		 * @param {string} targetTier - Tier the voucher grants
		 * @returns {{targetTier: string, durationDays: number}} Voucher
		 */
		function voucherFor(targetTier) {
			return { targetTier, durationDays: 30 };
		}
		it.each([
			['registered'],
			['public'],
			['admin'],
			['constructor'],
			[undefined],
			[null]
		])('row 1: rejects an unknown or non-promotable targetTier (%p) with the unknown-code message', (targetTier) => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(createUser({ tier: 'registered' }), voucherFor(targetTier), FIXED_NOW_MS);
			expect(decision).toEqual({ outcome: 'reject', message: 'Invalid voucher code' });
		});
		it('row 2: applies a higher tier to a registered user and removes the fallback', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(createUser({ tier: 'registered' }), voucherFor('paid'), FIXED_NOW_MS);
			expect(decision).toEqual({
				outcome: 'apply',
				tier: 'paid',
				tierExpiresAt: voucherEndIso,
				fallback: null
			});
		});
		it('row 2: applies private over a dated paid tier and remembers the paid tier with its end date', () => {
			const decideRedemption = getDecideRedemption();
			const paidEnd = isoFromNow(200, FIXED_NOW_MS);
			const decision = decideRedemption(
				createUser({ tier: 'paid', tierExpiresAt: paidEnd }),
				voucherFor('private'),
				FIXED_NOW_MS
			);
			expect(decision).toEqual({
				outcome: 'apply',
				tier: 'private',
				tierExpiresAt: voucherEndIso,
				fallback: { tier: 'paid', tierExpiresAt: paidEnd }
			});
		});
		it('row 2: applies private over a permanent paid tier and remembers it with a null end date', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(
				createUser({ tier: 'paid', tierExpiresAt: null }),
				voucherFor('private'),
				FIXED_NOW_MS
			);
			expect(decision.outcome).toBe('apply');
			expect(decision.tier).toBe('private');
			expect(decision.fallback).toEqual({ tier: 'paid', tierExpiresAt: null });
		});
		it('row 3: rejects a lower tier and names the current tier', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(
				createUser({ tier: 'private', tierExpiresAt: isoFromNow(100, FIXED_NOW_MS) }),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision).toEqual({
				outcome: 'reject',
				message: 'Voucher not applied: your account already has the private tier.'
			});
		});
		it('row 4: rejects the same tier with no end date and names the current tier', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(
				createUser({ tier: 'paid', tierExpiresAt: null }),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision).toEqual({
				outcome: 'reject',
				message: 'Voucher not applied: your account already has the paid tier with no end date.'
			});
		});
		it('row 5: extends the same tier to the later end date (voucher end later)', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(
				createUser({ tier: 'paid', tierExpiresAt: isoFromNow(5, FIXED_NOW_MS) }),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision.outcome).toBe('extend');
			expect(decision.tier).toBe('paid');
			expect(decision.tierExpiresAt).toBe(voucherEndIso);
			// >! A held stored tier leaves the fallback attributes untouched
			expect(decision.fallback).toBeUndefined();
		});
		it('row 5: extends the same tier but keeps the existing end date when it is later', () => {
			const decideRedemption = getDecideRedemption();
			const heldEnd = isoFromNow(90, FIXED_NOW_MS);
			const decision = decideRedemption(
				createUser({ tier: 'paid', tierExpiresAt: heldEnd }),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision.outcome).toBe('extend');
			expect(new Date(decision.tierExpiresAt).getTime()).toBe(new Date(heldEnd).getTime());
		});
		it('a lapsed user without a fallback is a registered holding: the voucher applies and the fallback is removed', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(
				createUser({ tier: 'paid', tierExpiresAt: isoFromNow(-3, FIXED_NOW_MS) }),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision).toEqual({
				outcome: 'apply',
				tier: 'paid',
				tierExpiresAt: voucherEndIso,
				fallback: null
			});
		});
		it('a malformed user is a registered holding: the voucher applies and the bad value is replaced', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(
				createUser({ tier: 'private', tierExpiresAt: 'not-a-date', fallbackTier: 'paid', fallbackExpiresAt: null }),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision.outcome).toBe('apply');
			expect(decision.tier).toBe('paid');
			expect(decision.tierExpiresAt).toBe(voucherEndIso);
			// >! The stale fallback of a malformed record is removed, not carried
			expect(decision.fallback).toBeNull();
		});
		it('an unknown stored tier ranks as registered: the voucher applies with no fallback', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(
				createUser({ tier: 'gold', tierExpiresAt: null }),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision.outcome).toBe('apply');
			expect(decision.tier).toBe('paid');
			expect(decision.fallback).toBeNull();
		});
		it('a lapsed private record with a valid dated paid fallback: a private voucher replaces it and remembers the fallback', () => {
			const decideRedemption = getDecideRedemption();
			const fallbackEnd = isoFromNow(40, FIXED_NOW_MS);
			const decision = decideRedemption(
				createUser({
					tier: 'private',
					tierExpiresAt: isoFromNow(-2, FIXED_NOW_MS),
					fallbackTier: 'paid',
					fallbackExpiresAt: fallbackEnd
				}),
				voucherFor('private'),
				FIXED_NOW_MS
			);
			expect(decision).toEqual({
				outcome: 'apply',
				tier: 'private',
				tierExpiresAt: voucherEndIso,
				fallback: { tier: 'paid', tierExpiresAt: fallbackEnd }
			});
		});
		it('a lapsed private record with a valid dated paid fallback: a paid voucher extends it and removes the fallback', () => {
			const decideRedemption = getDecideRedemption();
			const fallbackEnd = isoFromNow(40, FIXED_NOW_MS);
			const decision = decideRedemption(
				createUser({
					tier: 'private',
					tierExpiresAt: isoFromNow(-2, FIXED_NOW_MS),
					fallbackTier: 'paid',
					fallbackExpiresAt: fallbackEnd
				}),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision.outcome).toBe('extend');
			expect(decision.tier).toBe('paid');
			// >! Later of the fallback end (+40 days) and the voucher end (+30 days)
			expect(new Date(decision.tierExpiresAt).getTime()).toBe(new Date(fallbackEnd).getTime());
			expect(decision.fallback).toBeNull();
		});
		it('a lapsed private record with a permanent paid fallback: a paid voucher is rejected (no end date)', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(
				createUser({
					tier: 'private',
					tierExpiresAt: isoFromNow(-2, FIXED_NOW_MS),
					fallbackTier: 'paid',
					fallbackExpiresAt: null
				}),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision).toEqual({
				outcome: 'reject',
				message: 'Voucher not applied: your account already has the paid tier with no end date.'
			});
		});
		it('a lapsed private record whose fallback has itself lapsed counts as registered', () => {
			const decideRedemption = getDecideRedemption();
			const decision = decideRedemption(
				createUser({
					tier: 'private',
					tierExpiresAt: isoFromNow(-20, FIXED_NOW_MS),
					fallbackTier: 'paid',
					fallbackExpiresAt: isoFromNow(-5, FIXED_NOW_MS)
				}),
				voucherFor('paid'),
				FIXED_NOW_MS
			);
			expect(decision.outcome).toBe('apply');
			expect(decision.fallback).toBeNull();
		});
		it('no promotable tier outranks private, so a record never holds a fallback that is itself a fallback', () => {
			const rank = TierCommon.TIER_RANK;
			const top = Math.max(...Object.values(rank));
			for (const tier of ['paid', 'private']) {
				expect(rank[tier]).toBeLessThanOrEqual(rank.private);
			}
			expect(rank.private).toBe(top);
		});
	});
	/* -------------------------------------------------------------- */
	/*  redeemVoucher: side effects                                    */
	/* -------------------------------------------------------------- */
	describe('redeemVoucher side effects', () => {
		beforeEach(() => {
			jest.clearAllMocks();
			mockGetVoucher.mockReset();
			mockQueryByEmail.mockReset();
			mockUpdateUserTier.mockReset();
			mockIncrementVoucherUses.mockReset();
			mockUpdateUserAttributes.mockReset();
			mockUpdateUserTier.mockResolvedValue({});
			mockIncrementVoucherUses.mockResolvedValue({});
			mockUpdateUserAttributes.mockResolvedValue();
		});
		/**
		 * Run a redemption for the given voucher and user.
		 *
		 * @param {Object} voucher - Voucher record
		 * @param {Object} user - User record
		 * @returns {Promise<Object>} Redemption result
		 */
		async function redeem(voucher, user) {
			mockGetVoucher.mockResolvedValue(voucher);
			mockQueryByEmail.mockResolvedValue([user]);
			return redeemVoucher('SUMMER2025', user.email, user.cognitoSub);
		}
		describe('rejections change nothing', () => {
			const rejections = [
				['an unknown targetTier', createVoucher({ targetTier: 'platinum' }), createUser()],
				['a registered targetTier', createVoucher({ targetTier: 'registered' }), createUser()],
				['a lower tier', createVoucher({ targetTier: 'paid' }), createUser({ tier: 'private', tierExpiresAt: isoFromNow(100) })],
				['a lower tier with no end date', createVoucher({ targetTier: 'paid' }), createUser({ tier: 'private', tierExpiresAt: null })],
				['the same tier with no end date', createVoucher({ targetTier: 'paid' }), createUser({ tier: 'paid', tierExpiresAt: null })],
				['the same tier with no end date (attribute absent)', createVoucher({ targetTier: 'private' }), (() => {
					const user = createUser({ tier: 'private' });
					delete user.tierExpiresAt;
					return user;
				})()]
			];
			it.each(rejections)('%s: 400, no updateUserTier, no incrementVoucherUses, no Cognito call', async (_name, voucher, user) => {
				await expect(redeem(voucher, user)).rejects.toMatchObject({ statusCode: 400 });
				expect(mockUpdateUserTier).not.toHaveBeenCalled();
				expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
				expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
			});
			it('rejects an unknown targetTier with the same message as an unknown code', async () => {
				await expect(redeem(createVoucher({ targetTier: 'platinum' }), createUser()))
					.rejects.toMatchObject({ statusCode: 400, message: 'Invalid voucher code' });
			});
			it('a rejection for a lower tier names the current tier', async () => {
				await expect(redeem(
					createVoucher({ targetTier: 'paid' }),
					createUser({ tier: 'private', tierExpiresAt: isoFromNow(100) })
				)).rejects.toMatchObject({
					statusCode: 400,
					message: 'Voucher not applied: your account already has the private tier.'
				});
			});
			it('a rejection for the same tier with no end date names the current tier', async () => {
				await expect(redeem(
					createVoucher({ targetTier: 'paid' }),
					createUser({ tier: 'paid', tierExpiresAt: null })
				)).rejects.toMatchObject({
					statusCode: 400,
					message: 'Voucher not applied: your account already has the paid tier with no end date.'
				});
			});
		});
		describe('the held tier is remembered as the fallback', () => {
			it('a dated paid tier is remembered with its end date', async () => {
				const paidEnd = isoFromNow(200);
				const user = createUser({ tier: 'paid', tierExpiresAt: paidEnd });
				const result = await redeem(createVoucher({ targetTier: 'private' }), user);
				expect(result.tier).toBe('private');
				expect(mockUpdateUserTier).toHaveBeenCalledTimes(1);
				const [pk, tier, tierExpiresAt, ttl, options] = mockUpdateUserTier.mock.calls[0];
				expect(pk).toBe('KEY#userhash');
				expect(tier).toBe('private');
				expect(tierExpiresAt).toBe(result.tierExpiresAt);
				expect(typeof ttl).toBe('number');
				expect(options.fallback).toEqual({ tier: 'paid', tierExpiresAt: paidEnd });
				expect(mockUpdateUserAttributes).toHaveBeenCalledWith('test-sub-123', [{ Name: 'custom:tier', Value: 'private' }]);
			});
			it('a permanent paid tier is remembered with a NULL end date', async () => {
				const user = createUser({ tier: 'paid', tierExpiresAt: null });
				await redeem(createVoucher({ targetTier: 'private' }), user);
				const options = mockUpdateUserTier.mock.calls[0][4];
				expect(options.fallback).toEqual({ tier: 'paid', tierExpiresAt: null });
				// >! null (the DynamoDB NULL type), not undefined and not a missing key
				expect(options.fallback.tierExpiresAt).toBeNull();
			});
			it('a registered user has the fallback removed', async () => {
				const user = createUser({ tier: 'registered', tierExpiresAt: null, fallbackTier: 'paid', fallbackExpiresAt: null });
				await redeem(createVoucher({ targetTier: 'paid' }), user);
				const options = mockUpdateUserTier.mock.calls[0][4];
				expect(options.fallback).toBeNull();
			});
			it('a lapsed private record with a valid paid fallback: a private voucher replaces it and remembers the fallback tier and end date', async () => {
				const fallbackEnd = isoFromNow(40);
				const user = createUser({
					tier: 'private',
					tierExpiresAt: isoFromNow(-2),
					fallbackTier: 'paid',
					fallbackExpiresAt: fallbackEnd
				});
				const result = await redeem(createVoucher({ targetTier: 'private' }), user);
				expect(result.tier).toBe('private');
				const options = mockUpdateUserTier.mock.calls[0][4];
				expect(options.fallback).toEqual({ tier: 'paid', tierExpiresAt: fallbackEnd });
				// >! The stored tier is private before and after: Cognito is not touched
				expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
			});
			it('a lapsed private record with a valid paid fallback: a paid voucher extends it, rewrites the record as paid, and removes the fallback', async () => {
				const fallbackEnd = isoFromNow(40);
				const user = createUser({
					tier: 'private',
					tierExpiresAt: isoFromNow(-2),
					fallbackTier: 'paid',
					fallbackExpiresAt: fallbackEnd
				});
				const result = await redeem(createVoucher({ targetTier: 'paid', durationDays: 30 }), user);
				expect(result.tier).toBe('paid');
				// >! Later of the fallback end (+40 days) and the voucher end (+30 days)
				expect(new Date(result.tierExpiresAt).getTime()).toBe(new Date(fallbackEnd).getTime());
				const [, tier, tierExpiresAt, , options] = mockUpdateUserTier.mock.calls[0];
				expect(tier).toBe('paid');
				expect(tierExpiresAt).toBe(result.tierExpiresAt);
				expect(options.fallback).toBeNull();
				// >! The stored tier changes (private to paid), so Cognito custom:tier follows it
				expect(mockUpdateUserAttributes).toHaveBeenCalledWith('test-sub-123', [{ Name: 'custom:tier', Value: 'paid' }]);
			});
		});
		describe('updateUserTier options', () => {
			it('passes the expected tier and tierExpiresAt as read', async () => {
				const heldEnd = isoFromNow(10);
				const user = createUser({ tier: 'paid', tierExpiresAt: heldEnd });
				await redeem(createVoucher({ targetTier: 'private' }), user);
				const options = mockUpdateUserTier.mock.calls[0][4];
				expect(options.expected).toEqual({ tier: 'paid', tierExpiresAt: heldEnd });
			});
			it('passes a null expected tierExpiresAt for a record with no end date', async () => {
				const user = createUser({ tier: 'registered', tierExpiresAt: null });
				await redeem(createVoucher({ targetTier: 'paid' }), user);
				const options = mockUpdateUserTier.mock.calls[0][4];
				expect(options.expected.tier).toBe('registered');
				expect(options.expected.tierExpiresAt === null || options.expected.tierExpiresAt === undefined).toBe(true);
			});
			it('passes the stored (not the effective) values for a lapsed record', async () => {
				const lapsedEnd = isoFromNow(-3);
				const user = createUser({ tier: 'paid', tierExpiresAt: lapsedEnd });
				await redeem(createVoucher({ targetTier: 'paid' }), user);
				const options = mockUpdateUserTier.mock.calls[0][4];
				expect(options.expected).toEqual({ tier: 'paid', tierExpiresAt: lapsedEnd });
				expect(options.fallback).toBeNull();
			});
			it('sets ttl to about now + 120 days', async () => {
				await redeem(createVoucher({ targetTier: 'paid' }), createUser());
				const ttl = mockUpdateUserTier.mock.calls[0][3];
				const expected = Math.floor(Date.now() / 1000) + 120 * 24 * 60 * 60;
				expect(Math.abs(ttl - expected)).toBeLessThan(5);
			});
		});
		describe('extend', () => {
			it('extending the stored tier leaves the fallback untouched and makes no Cognito call', async () => {
				const user = createUser({ tier: 'paid', tierExpiresAt: isoFromNow(5) });
				const result = await redeem(createVoucher({ targetTier: 'paid', durationDays: 30 }), user);
				expect(result.tier).toBe('paid');
				expect(mockUpdateUserTier).toHaveBeenCalledTimes(1);
				const options = mockUpdateUserTier.mock.calls[0][4];
				expect(options.fallback).toBeUndefined();
				expect(mockIncrementVoucherUses).toHaveBeenCalledWith('SUMMER2025');
				expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
			});
			it('extend never makes the end date earlier', async () => {
				const heldEnd = isoFromNow(200);
				const user = createUser({ tier: 'private', tierExpiresAt: heldEnd });
				const result = await redeem(createVoucher({ targetTier: 'private', durationDays: 10 }), user);
				expect(new Date(result.tierExpiresAt).getTime()).toBe(new Date(heldEnd).getTime());
				expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
			});
		});
		describe('Cognito is updated only when the stored tier changes', () => {
			it('an apply that keeps the stored tier (lapsed paid, paid voucher) makes no Cognito call', async () => {
				const user = createUser({ tier: 'paid', tierExpiresAt: isoFromNow(-3) });
				const result = await redeem(createVoucher({ targetTier: 'paid' }), user);
				expect(result.tier).toBe('paid');
				expect(mockUpdateUserTier).toHaveBeenCalledTimes(1);
				expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
			});
			it('an apply that changes the stored tier updates Cognito once', async () => {
				await redeem(createVoucher({ targetTier: 'private' }), createUser({ tier: 'paid', tierExpiresAt: null }));
				expect(mockUpdateUserAttributes).toHaveBeenCalledTimes(1);
				expect(mockUpdateUserAttributes).toHaveBeenCalledWith('test-sub-123', [{ Name: 'custom:tier', Value: 'private' }]);
			});
		});
		describe('conditional write failure', () => {
			it('maps ConditionalCheckFailedException to statusCode 409 with no increment and no Cognito call', async () => {
				mockUpdateUserTier.mockRejectedValue(createConditionalFailure());
				await expect(redeem(createVoucher({ targetTier: 'paid' }), createUser()))
					.rejects.toMatchObject({ statusCode: 409, message: CONFLICT_MESSAGE });
				expect(mockUpdateUserTier).toHaveBeenCalledTimes(1);
				expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
				expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
			});
			it('does not map other updateUserTier errors to 409', async () => {
				mockUpdateUserTier.mockRejectedValue(new Error('ProvisionedThroughputExceededException'));
				const failure = await redeem(createVoucher({ targetTier: 'paid' }), createUser()).catch((error) => error);
				expect(failure).toBeInstanceOf(Error);
				expect(failure.statusCode).not.toBe(409);
				expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
				expect(mockUpdateUserAttributes).not.toHaveBeenCalled();
			});
		});
		describe('order of operations', () => {
			it('writes the user record, then increments uses, then updates Cognito', async () => {
				await redeem(createVoucher({ targetTier: 'paid' }), createUser());
				const writeOrder = mockUpdateUserTier.mock.invocationCallOrder[0];
				const incrementOrder = mockIncrementVoucherUses.mock.invocationCallOrder[0];
				const cognitoOrder = mockUpdateUserAttributes.mock.invocationCallOrder[0];
				expect(writeOrder).toBeLessThan(incrementOrder);
				expect(incrementOrder).toBeLessThan(cognitoOrder);
			});
			it('returns the values written, with the unchanged response shape', async () => {
				const result = await redeem(createVoucher({ targetTier: 'private' }), createUser({ tier: 'paid', tierExpiresAt: null }));
				const [, tier, tierExpiresAt] = mockUpdateUserTier.mock.calls[0];
				expect(Object.keys(result).sort()).toEqual(['message', 'tier', 'tierExpiresAt']);
				expect(result.tier).toBe(tier);
				expect(result.tierExpiresAt).toBe(tierExpiresAt);
				expect(result.message).toBe('Voucher redeemed successfully');
			});
		});
	});
});
