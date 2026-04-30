// Feature: user-profile-enhancement, Property 1: Effective tier expiration
'use strict';

const fc = require('fast-check');

/* ------------------------------------------------------------------ */
/*  Inline implementation of computeEffectiveTier                     */
/*  This validates the correctness property independent of the        */
/*  handler implementation (which will be created in Task 2.2).       */
/* ------------------------------------------------------------------ */

/**
 * Compute the effective tier for a user, accounting for tier expiration.
 *
 * If tierExpiresAt is set and in the past, the effective tier is 'registered'.
 * Otherwise, the effective tier is the stored tier value.
 *
 * @param {string} tier - Stored tier value ('registered', 'paid', or 'private')
 * @param {string|null} tierExpiresAt - ISO 8601 expiration timestamp or null
 * @returns {string} The effective tier
 */
function computeEffectiveTier(tier, tierExpiresAt) {
	if (tierExpiresAt !== null && new Date(tierExpiresAt) < new Date()) {
		return 'registered';
	}
	return tier;
}

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
