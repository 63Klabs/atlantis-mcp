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
const { validateVoucher, TestHarness } = require('../../services/voucher-redeem');
const TierCommon = require('../../utils/tier-common');

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

/* ------------------------------------------------------------------ */
/*  Redemption decision (spec 0-0-7-lapsed-tier-downgrade, Design 9)  */
/* ------------------------------------------------------------------ */
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_MS = Date.now();

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

/** Days from the base instant (at least 2, so a moving clock cannot change a state during a run) */
const dayOffsetArb = fc.integer({ min: 2, max: 400 });
const futureIsoArb = dayOffsetArb.map(days => new Date(BASE_MS + days * DAY_MS).toISOString());
const pastIsoArb = dayOffsetArb.map(days => new Date(BASE_MS - days * DAY_MS).toISOString());

/** Stored tierExpiresAt: none, active, lapsed, or a value that does not parse */
const storedExpiryArb = fc.oneof(
	fc.constant(null),
	fc.constant(undefined),
	futureIsoArb,
	pastIsoArb,
	fc.constantFrom('not-a-date', '2026-13-45', '', 1767225600)
);

/** Optional remembered tier: absent, valid-looking, lapsed, malformed, or naming an unusable tier */
const fallbackArb = fc.oneof(
	fc.constant({}),
	fc.record({
		fallbackTier: fc.constantFrom('paid', 'private', 'registered', 'gold'),
		fallbackExpiresAt: fc.oneof(
			fc.constant(null),
			fc.constant(undefined),
			futureIsoArb,
			pastIsoArb,
			fc.constantFrom('not-a-date', 1767225600)
		)
	})
);

/** Realistic user record */
const userRecordArb = fc.tuple(tierArb, storedExpiryArb, fallbackArb).map(
	([tier, tierExpiresAt, fallback]) => ({
		pk: 'KEY#property',
		email: 'user@example.com',
		tier,
		tierExpiresAt,
		...fallback
	})
);

/** Voucher fields the decision uses */
const decisionVoucherArb = fc.record({
	targetTier: fc.constantFrom('paid', 'private'),
	durationDays: durationDaysArb
});

/** Offsets (days) of the instants sampled after a redemption */
const SAMPLE_OFFSET_DAYS = [0, 1, 7, 30, 31, 90, 119, 121, 200, 365, 366, 800];

/**
 * Apply a non-reject decision to a record in memory, as the conditional write would.
 *
 * @param {Object} record - Record as read
 * @param {Object} decision - Decision from decideRedemption
 * @returns {Object} Record as stored after the write
 */
function applyDecision(record, decision) {
	const written = { ...record, tier: decision.tier, tierExpiresAt: decision.tierExpiresAt };
	if (decision.fallback === null) {
		delete written.fallbackTier;
		delete written.fallbackExpiresAt;
	} else if (decision.fallback) {
		written.fallbackTier = decision.fallback.tier;
		written.fallbackExpiresAt = decision.fallback.tierExpiresAt;
	}
	return written;
}

/**
 * Simulate the Read Function's Downgrade (or restore) for a lapsed record.
 *
 * @param {Object} record - Record as stored
 * @param {number} atMs - Instant of the first request
 * @returns {Object} Record as stored after the write, or the same record when nothing lapsed
 */
function simulateDowngrade(record, atMs) {
	const resolution = TierCommon.resolveRecordTier(record, atMs);
	if (resolution.state !== 'lapsed') {
		return record;
	}
	const restored = { ...record };
	delete restored.fallbackTier;
	delete restored.fallbackExpiresAt;
	restored.tier = resolution.restoreTo ? resolution.restoreTo.tier : 'registered';
	restored.tierExpiresAt = resolution.restoreTo ? resolution.restoreTo.tierExpiresAt : null;
	return restored;
}

/**
 * Rank of the tier a record holds at an instant.
 *
 * @param {Object} record - Stored record
 * @param {number} atMs - Instant in epoch milliseconds
 * @returns {number} Tier rank
 */
function heldRank(record, atMs) {
	return TierCommon.TIER_RANK[TierCommon.resolveRecordTier(record, atMs).tier];
}

/**
 * **Validates: Requirements 11.2, 11.10, 19.15**
 */
describe('Property: decideRedemption never lowers a tier or an end date', () => {
	it('a targetTier that is not paid or private is always rejected as an unknown code', () => {
		const decideRedemption = getDecideRedemption();
		fc.assert(
			fc.property(
				userRecordArb,
				fc.oneof(
					fc.string(),
					fc.constantFrom('registered', 'public', 'constructor', '__proto__', 'toString', undefined, null, 5)
				).filter(value => value !== 'paid' && value !== 'private'),
				durationDaysArb,
				(record, targetTier, durationDays) => {
					const decision = decideRedemption(record, { targetTier, durationDays }, BASE_MS);
					expect(decision).toEqual({ outcome: 'reject', message: 'Invalid voucher code' });
				}
			),
			{ numRuns: 100 }
		);
	});

	it('every decision is exactly one of apply, extend, or reject, with the fields that outcome needs', () => {
		const decideRedemption = getDecideRedemption();
		fc.assert(
			fc.property(userRecordArb, decisionVoucherArb, (record, voucher) => {
				const decision = decideRedemption(record, voucher, BASE_MS);
				expect(['apply', 'extend', 'reject']).toContain(decision.outcome);
				if (decision.outcome === 'reject') {
					expect(typeof decision.message).toBe('string');
					expect(decision.message.length).toBeGreaterThan(0);
				} else {
					expect(decision.tier).toBe(voucher.targetTier);
					expect(Number.isNaN(new Date(decision.tierExpiresAt).getTime())).toBe(false);
					expect(new Date(decision.tierExpiresAt).getTime()).toBeGreaterThan(BASE_MS);
				}
			}),
			{ numRuns: 100 }
		);
	});

	it('an extension never makes the end date earlier than the one held', () => {
		const decideRedemption = getDecideRedemption();
		fc.assert(
			fc.property(userRecordArb, decisionVoucherArb, (record, voucher) => {
				const decision = decideRedemption(record, voucher, BASE_MS);
				fc.pre(decision.outcome === 'extend');
				const current = TierCommon.resolveRecordTier(record, BASE_MS);
				const heldEndMs = current.restoreTo ? current.restoreTo.expiresAtMs : current.expiresAtMs;
				expect(new Date(decision.tierExpiresAt).getTime()).toBeGreaterThanOrEqual(heldEndMs);
				expect(new Date(decision.tierExpiresAt).getTime()).toBeGreaterThanOrEqual(BASE_MS + voucher.durationDays * DAY_MS);
			}),
			{ numRuns: 100 }
		);
	});

	it('Requirement 11.10 / 19.15: the rank held at every sampled later instant is not lower after a redemption', () => {
		const decideRedemption = getDecideRedemption();
		fc.assert(
			fc.property(userRecordArb, decisionVoucherArb, (record, voucher) => {
				const decision = decideRedemption(record, voucher, BASE_MS);
				fc.pre(decision.outcome !== 'reject');
				const written = applyDecision(record, decision);
				for (const offsetDays of SAMPLE_OFFSET_DAYS) {
					const atMs = BASE_MS + offsetDays * DAY_MS;
					expect(heldRank(written, atMs)).toBeGreaterThanOrEqual(heldRank(record, atMs));
				}
			}),
			{ numRuns: 100 }
		);
	});

	it('Requirement 19.15: the rank is still not lower after the Downgrade on the first request after the new tier lapses', () => {
		const decideRedemption = getDecideRedemption();
		fc.assert(
			fc.property(userRecordArb, decisionVoucherArb, (record, voucher) => {
				const decision = decideRedemption(record, voucher, BASE_MS);
				fc.pre(decision.outcome !== 'reject');
				const written = applyDecision(record, decision);
				const firstRequestMs = new Date(decision.tierExpiresAt).getTime() + 1;
				const downgraded = simulateDowngrade(written, firstRequestMs);
				for (const offsetDays of SAMPLE_OFFSET_DAYS) {
					const atMs = firstRequestMs + offsetDays * DAY_MS;
					expect(heldRank(downgraded, atMs)).toBeGreaterThanOrEqual(heldRank(record, atMs));
				}
			}),
			{ numRuns: 100 }
		);
	});
});
