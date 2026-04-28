// Feature: 0-0-3-add-authentication, Unit tests for voucher redemption handler
'use strict';

// Mock @aws-sdk/client-cognito-identity-provider
const mockCognitoSend = jest.fn();
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
	return {
		CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
		AdminUpdateUserAttributesCommand: jest.fn().mockImplementation((params) => params)
	};
});

// Mock ../utils/dynamo-client
const mockQueryByEmail = jest.fn();
const mockGetVoucher = jest.fn();
const mockIncrementVoucherUses = jest.fn();
const mockUpdateUserTier = jest.fn();
jest.mock('../../utils/dynamo-client', () => ({
	queryByEmail: mockQueryByEmail,
	getVoucher: mockGetVoucher,
	incrementVoucherUses: mockIncrementVoucherUses,
	updateUserTier: mockUpdateUserTier
}));

// Mock ../utils/jwt-validator
const mockValidateJwt = jest.fn();
jest.mock('../../utils/jwt-validator', () => ({
	validateJwt: mockValidateJwt
}));

const { handler } = require('../../handlers/voucher-redeem');
const { AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build an API Gateway proxy event for voucher redemption.
 *
 * @param {string} code - Voucher code to redeem
 * @param {Object} overrides - Optional overrides for headers
 * @returns {Object} API Gateway proxy event
 */
function createEvent(code, overrides = {}) {
	return {
		httpMethod: 'POST',
		path: '/auth/voucher/redeem',
		headers: {
			Authorization: 'Bearer valid-jwt-token',
			...overrides.headers
		},
		body: JSON.stringify({ code })
	};
}

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

describe('Voucher Redemption Handler', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = {
			...originalEnv,
			COGNITO_USER_POOL_ID: 'us-east-1_TestPool'
		};
		jest.clearAllMocks();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('should redeem valid voucher for authenticated user', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockGetVoucher.mockResolvedValue(createVoucher());
		mockQueryByEmail.mockResolvedValue([{
			pk: 'KEY#oldhash',
			email: 'test@example.com',
			tier: 'registered',
			cognitoSub: 'test-sub-123'
		}]);
		mockUpdateUserTier.mockResolvedValue({});
		mockIncrementVoucherUses.mockResolvedValue({});
		mockCognitoSend.mockResolvedValue({});

		const event = createEvent('SUMMER2025');
		const result = await handler(event);

		expect(result.statusCode).toBe(200);
		const body = JSON.parse(result.body);
		expect(body.tier).toBe('paid');
		expect(body.tierExpiresAt).toBeDefined();
		expect(body.message).toMatch(/redeemed/i);

		// Verify updateUserTier called with correct params
		expect(mockUpdateUserTier).toHaveBeenCalledTimes(1);
		const [pk, tier, tierExpiresAt, ttl] = mockUpdateUserTier.mock.calls[0];
		expect(pk).toBe('KEY#oldhash');
		expect(tier).toBe('paid');
		expect(tierExpiresAt).toBeDefined();
		expect(typeof ttl).toBe('number');

		// Verify tierExpiresAt is approximately now + 30 days
		const expiresMs = new Date(tierExpiresAt).getTime();
		const expectedMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
		expect(expiresMs).toBeGreaterThan(expectedMs - 5000);
		expect(expiresMs).toBeLessThan(expectedMs + 5000);

		// Verify incrementVoucherUses called
		expect(mockIncrementVoucherUses).toHaveBeenCalledWith('SUMMER2025');

		// Verify Cognito updated with new tier
		expect(mockCognitoSend).toHaveBeenCalledTimes(1);
		expect(AdminUpdateUserAttributesCommand).toHaveBeenCalledWith({
			UserPoolId: 'us-east-1_TestPool',
			Username: 'test-sub-123',
			UserAttributes: [
				{ Name: 'custom:tier', Value: 'paid' }
			]
		});
	});

	it('should return 400 when voucher not found', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockGetVoucher.mockResolvedValue(null);

		const event = createEvent('INVALID_CODE');
		const result = await handler(event);

		expect(result.statusCode).toBe(400);
		const body = JSON.parse(result.body);
		expect(body.error).toMatch(/invalid voucher code/i);

		// Verify no further calls made
		expect(mockQueryByEmail).not.toHaveBeenCalled();
		expect(mockUpdateUserTier).not.toHaveBeenCalled();
		expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	it('should return 400 when voucher has expired', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockGetVoucher.mockResolvedValue(createVoucher({
			expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
		}));

		const event = createEvent('EXPIRED_CODE');
		const result = await handler(event);

		expect(result.statusCode).toBe(400);
		const body = JSON.parse(result.body);
		expect(body.error).toMatch(/expired/i);

		expect(mockUpdateUserTier).not.toHaveBeenCalled();
		expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
	});

	it('should return 400 when voucher is fully redeemed', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
		mockGetVoucher.mockResolvedValue(createVoucher({
			maxUses: 100,
			currentUses: 100
		}));

		const event = createEvent('FULL_CODE');
		const result = await handler(event);

		expect(result.statusCode).toBe(400);
		const body = JSON.parse(result.body);
		expect(body.error).toMatch(/fully redeemed/i);

		expect(mockUpdateUserTier).not.toHaveBeenCalled();
		expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
	});

	it('should allow unlimited uses voucher (maxUses = 0)', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });
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
		mockUpdateUserTier.mockResolvedValue({});
		mockIncrementVoucherUses.mockResolvedValue({});
		mockCognitoSend.mockResolvedValue({});

		const event = createEvent('UNLIMITED_CODE');
		const result = await handler(event);

		expect(result.statusCode).toBe(200);
		const body = JSON.parse(result.body);
		expect(body.tier).toBe('paid');
	});

	it('should return 401 when JWT is invalid', async () => {
		mockValidateJwt.mockRejectedValue({ statusCode: 401, message: 'Unauthorized' });

		const event = createEvent('SUMMER2025');
		const result = await handler(event);

		expect(result.statusCode).toBe(401);
		const body = JSON.parse(result.body);
		expect(body.error).toMatch(/unauthorized/i);

		// Verify no DynamoDB or Cognito calls made
		expect(mockGetVoucher).not.toHaveBeenCalled();
		expect(mockQueryByEmail).not.toHaveBeenCalled();
		expect(mockUpdateUserTier).not.toHaveBeenCalled();
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});

	it('should return 400 when voucher code is missing from body', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'test@example.com', sub: 'test-sub-123' });

		const event = {
			httpMethod: 'POST',
			path: '/auth/voucher/redeem',
			headers: { Authorization: 'Bearer valid-jwt-token' },
			body: '{}'
		};
		const result = await handler(event);

		expect(result.statusCode).toBe(400);
		const body = JSON.parse(result.body);
		expect(body.error).toMatch(/voucher code is required/i);
	});

	it('should return 404 when user not found by email', async () => {
		mockValidateJwt.mockResolvedValue({ email: 'unknown@example.com', sub: 'test-sub-456' });
		mockGetVoucher.mockResolvedValue(createVoucher());
		mockQueryByEmail.mockResolvedValue([]);

		const event = createEvent('SUMMER2025');
		const result = await handler(event);

		expect(result.statusCode).toBe(404);
		const body = JSON.parse(result.body);
		expect(body.error).toMatch(/not found/i);

		expect(mockUpdateUserTier).not.toHaveBeenCalled();
		expect(mockIncrementVoucherUses).not.toHaveBeenCalled();
		expect(mockCognitoSend).not.toHaveBeenCalled();
	});
});
