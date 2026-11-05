/**
 * Property-Based Tests: Read Function effective tier delegates to tier-common
 *
 * Feature: 0-0-7-lapsed-tier-downgrade (Design 11)
 *
 * The `computeEffectiveTier` in utils/auth-resolver.js must return exactly the
 * `.tier` computed by the tier-common layer (loaded through utils/tier-common),
 * for every stored tier, end date value, and optional Fallback. The layer is the
 * only place the end date is parsed.
 *
 * Validates: Requirements 15.4, 8.1, 8.2
 */
'use strict';

const fc = require('fast-check');

// Mock the @63klabs/cache-data module BEFORE requiring auth-resolver
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), log: jest.fn(), info: jest.fn() },
		AWS: {
			dynamo: {
				get: jest.fn(),
				update: jest.fn()
			}
		},
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn()
		}))
	}
}));

const { TestHarness } = require('../../utils/auth-resolver');
const TierCommon = require('../../utils/tier-common');
const { computeEffectiveTier } = TestHarness.getInternals();

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

/** Stored tiers, including values the layer does not rank. */
const storedTierArb = fc.constantFrom('registered', 'paid', 'private', 'public', 'unknown-tier');

const pastIsoArb = fc
	.date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date(Date.now() - 60 * 1000) })
	.map(d => d.toISOString());

const futureIsoArb = fc
	.date({ min: new Date(Date.now() + 60 * 60 * 1000), max: new Date('2035-12-31T00:00:00.000Z') })
	.map(d => d.toISOString());

/** Date-only and offset forms the layer accepts. */
const otherValidFormArb = fc.constantFrom(
	'2020-01-01',
	'2099-12-31',
	'2020-06-15T10:30Z',
	'2099-06-15T10:30:00+05:30',
	'2020-06-15T10:30:00.5-08:00'
);

const malformedArb = fc.oneof(
	fc.constantFrom('', ' 2099-12-31', '2099-12-31T00:00:00z', '2099-02-30', 'not-a-date', '2099-12-31T24:00Z'),
	fc.string({ maxLength: 40 }),
	fc.integer(),
	fc.boolean(),
	fc.constant({}),
	fc.constant([])
);

/** Values for the end date: ISO past, ISO future, other valid forms, malformed, null, undefined. */
const expiresAtArb = fc.oneof(
	pastIsoArb,
	futureIsoArb,
	otherValidFormArb,
	malformedArb,
	fc.constant(null),
	fc.constant(undefined)
);

/** Optional Fallback: absent, or a `{ tier, tierExpiresAt }` of varying validity. */
const fallbackArb = fc.oneof(
	fc.constant(undefined),
	fc.constant(null),
	fc.record({
		tier: fc.constantFrom('registered', 'paid', 'private', 'public', 'unknown-tier'),
		tierExpiresAt: fc.oneof(pastIsoArb, futureIsoArb, malformedArb, fc.constant(null), fc.constant(undefined))
	})
);

/* ------------------------------------------------------------------ */
/*  Properties                                                        */
/* ------------------------------------------------------------------ */

describe('Read Function computeEffectiveTier delegates to tier-common (Requirement 15.4)', () => {

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('equals TierCommon.computeEffectiveTier(...).tier for any stored tier and end date', () => {
		fc.assert(
			fc.property(
				storedTierArb,
				expiresAtArb,
				(storedTier, tierExpiresAt) => {
					const expected = TierCommon.computeEffectiveTier(storedTier, tierExpiresAt).tier;
					expect(computeEffectiveTier(storedTier, tierExpiresAt)).toBe(expected);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('equals TierCommon.computeEffectiveTier(...).tier when a Fallback argument is given', () => {
		fc.assert(
			fc.property(
				storedTierArb,
				expiresAtArb,
				fallbackArb,
				(storedTier, tierExpiresAt, fallback) => {
					const expected = TierCommon.computeEffectiveTier(storedTier, tierExpiresAt, undefined, fallback).tier;
					expect(computeEffectiveTier(storedTier, tierExpiresAt, fallback)).toBe(expected);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('a lapsed paid record with a valid Fallback is served at the Fallback tier', () => {
		fc.assert(
			fc.property(
				pastIsoArb,
				fc.oneof(futureIsoArb, fc.constant(null)),
				(lapsedAt, fallbackExpiresAt) => {
					const paidFallback = { tier: 'paid', tierExpiresAt: fallbackExpiresAt };
					expect(computeEffectiveTier('private', lapsedAt, paidFallback)).toBe('paid');
				}
			),
			{ numRuns: 100 }
		);
	});
});
