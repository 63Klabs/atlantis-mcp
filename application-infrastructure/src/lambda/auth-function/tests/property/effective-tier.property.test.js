// Feature: user-profile-enhancement, Property 1: Effective tier expiration
// Feature: 0-0-7-lapsed-tier-downgrade (profile delegates to the tier-common layer)
'use strict';

const fc = require('fast-check');

// Mock @63klabs/cache-data (profile.js requires DebugAndLog)
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

// profile.js requires config, the user DAO, and the window calculator at load.
// computeEffectiveTier does not use them, so they are replaced to keep the load pure.
jest.mock('../../config', () => ({ Config: { settings: jest.fn() } }));
jest.mock('../../models/user', () => ({}));
jest.mock('../../utils/window-calculator', () => ({}));

const { computeEffectiveTier } = require('../../services/profile');
const TierCommon = require('../../utils/tier-common');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

const tierArb = fc.constantFrom('registered', 'paid', 'private');

const pastDateArb = fc
	.date({ min: new Date('2020-01-01'), max: new Date(Date.now() - 86400000) })
	.map(d => d.toISOString());

const futureDateArb = fc
	.date({ min: new Date(Date.now() + 86400000), max: new Date('2030-12-31') })
	.map(d => d.toISOString());

/* ------------------------------------------------------------------ */
/*  Property 1: Effective tier expiration                             */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 3.2
 */
describe('Property 1: Effective tier expiration', () => {

	it('expired tierExpiresAt (past) always returns registered', () => {
		fc.assert(
			fc.property(
				tierArb,
				pastDateArb,
				(tier, tierExpiresAt) => {
					const result = computeEffectiveTier(tier, tierExpiresAt);
					expect(result).toBe('registered');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('future tierExpiresAt returns stored tier unchanged', () => {
		fc.assert(
			fc.property(
				tierArb,
				futureDateArb,
				(tier, tierExpiresAt) => {
					const result = computeEffectiveTier(tier, tierExpiresAt);
					expect(result).toBe(tier);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('null tierExpiresAt returns stored tier unchanged', () => {
		fc.assert(
			fc.property(
				tierArb,
				(tier) => {
					const result = computeEffectiveTier(tier, null);
					expect(result).toBe(tier);
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Delegation to the tier-common layer                               */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 15.4, 8.3
 */
describe('Profile computeEffectiveTier delegates to tier-common', () => {
	const anyTierArb = fc.constantFrom('registered', 'paid', 'private', 'public', 'unknown-tier');
	const malformedArb = fc.oneof(
		fc.constantFrom('', ' 2099-12-31', '2099-12-31T00:00:00z', '2099-02-30', 'not-a-date'),
		fc.string({ maxLength: 40 }),
		fc.integer(),
		fc.boolean(),
		fc.constant({}),
		fc.constant([])
	);
	const expiresAtArb = fc.oneof(
		pastDateArb,
		futureDateArb,
		malformedArb,
		fc.constant(null),
		fc.constant(undefined)
	);
	const fallbackArb = fc.oneof(
		fc.constant(undefined),
		fc.constant(null),
		fc.record({
			tier: anyTierArb,
			tierExpiresAt: fc.oneof(pastDateArb, futureDateArb, malformedArb, fc.constant(null), fc.constant(undefined))
		})
	);

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('equals TierCommon.computeEffectiveTier(...).tier, with and without a Fallback', () => {
		fc.assert(
			fc.property(
				anyTierArb,
				expiresAtArb,
				fallbackArb,
				(tier, tierExpiresAt, fallback) => {
					const expected = TierCommon.computeEffectiveTier(tier, tierExpiresAt, undefined, fallback).tier;
					expect(computeEffectiveTier(tier, tierExpiresAt, fallback)).toBe(expected);
					const expectedNoFallback = TierCommon.computeEffectiveTier(tier, tierExpiresAt).tier;
					expect(computeEffectiveTier(tier, tierExpiresAt)).toBe(expectedNoFallback);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('non-string end dates give registered', () => {
		fc.assert(
			fc.property(
				tierArb,
				fc.oneof(fc.integer(), fc.boolean(), fc.constant({})),
				(tier, tierExpiresAt) => {
					expect(computeEffectiveTier(tier, tierExpiresAt)).toBe('registered');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('a lapsed record with a valid Fallback reports the Fallback tier', () => {
		fc.assert(
			fc.property(
				pastDateArb,
				fc.oneof(futureDateArb, fc.constant(null)),
				(lapsedAt, fallbackExpiresAt) => {
					const fallback = { tier: 'paid', tierExpiresAt: fallbackExpiresAt };
					expect(computeEffectiveTier('private', lapsedAt, fallback)).toBe('paid');
				}
			),
			{ numRuns: 100 }
		);
	});
});
