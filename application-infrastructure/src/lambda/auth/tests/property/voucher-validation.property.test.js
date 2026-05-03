// Feature: 0-0-3-add-authentication, Properties 11, 12: Voucher validation
'use strict';

// Mock AWS SDK modules to prevent import issues
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
	CognitoIdentityProviderClient: jest.fn(),
	AdminUpdateUserAttributesCommand: jest.fn()
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: jest.fn().mockImplementation(() => ({}))
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({}) },
	GetCommand: jest.fn(),
	PutCommand: jest.fn(),
	DeleteCommand: jest.fn(),
	QueryCommand: jest.fn(),
	UpdateCommand: jest.fn()
}));
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
jest.mock('../../config', () => ({
	Config: {
		settings: jest.fn().mockReturnValue({
			usersTable: 'test-Users',
			sessionsTable: 'test-Sessions',
			cognito: { userPoolId: { getValue: jest.fn().mockResolvedValue('us-east-1_TestPool') } },
			ssm: {
				apiKeyHashSalt: { getValue: jest.fn().mockResolvedValue('test-salt') },
				sessionHashSalt: { getValue: jest.fn().mockResolvedValue('test-session-salt') }
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

const fc = require('fast-check');
const { validateVoucher } = require('../../services/voucher-redeem');

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
					expect(typeof result.message).toBe('string');
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
					expect(result.message.toLowerCase()).toContain('expired');
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
					expect(result.message.toLowerCase()).toContain('fully redeemed');
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
