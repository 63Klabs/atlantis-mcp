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

const { redeemVoucher, validateVoucher } = require('../../services/voucher-redeem');

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
