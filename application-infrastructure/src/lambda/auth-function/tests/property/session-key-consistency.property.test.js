// Feature: user-profile-enhancement, Property 2: Session key hash consistency
'use strict';

const fc = require('fast-check');
const crypto = require('crypto');
const { computeSessionKey } = require('../../utils/window-calculator');

/* ------------------------------------------------------------------ */
/*  Inline reference implementation of the Read Lambda's              */
/*  hashClientIdentifier algorithm.                                   */
/*  This validates that computeSessionKey produces the same result.   */
/* ------------------------------------------------------------------ */

/**
 * Reference implementation of the Read Lambda's hashClientIdentifier.
 *
 * Computes SHA-256 hex digest of `cognitoSub + windowStartMinutes + salt`.
 *
 * @param {string} cognitoSub - Cognito user sub claim
 * @param {number} windowStartMinutes - Window start in minutes since epoch
 * @param {string} salt - Session hash salt
 * @returns {string} 64-character hex SHA-256 hash
 */
function hashClientIdentifier(cognitoSub, windowStartMinutes, salt) {
	return crypto
		.createHash('sha256')
		.update(cognitoSub + windowStartMinutes + salt)
		.digest('hex');
}

/* ------------------------------------------------------------------ */
/*  Property 2: Session key hash consistency                          */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 4.2
 */
describe('Property 2: Session key hash consistency', () => {

	it('computeSessionKey matches hashClientIdentifier for any inputs', () => {
		fc.assert(
			fc.property(
				fc.string(),
				fc.integer(),
				fc.string(),
				(cognitoSub, windowStartMinutes, salt) => {
					const sessionKey = computeSessionKey(cognitoSub, windowStartMinutes, salt);
					const referenceHash = hashClientIdentifier(cognitoSub, windowStartMinutes, salt);
					expect(sessionKey).toBe(referenceHash);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('result is always a 64-character lowercase hex string', () => {
		fc.assert(
			fc.property(
				fc.string(),
				fc.integer(),
				fc.string(),
				(cognitoSub, windowStartMinutes, salt) => {
					const sessionKey = computeSessionKey(cognitoSub, windowStartMinutes, salt);
					expect(sessionKey).toHaveLength(64);
					expect(sessionKey).toMatch(/^[0-9a-f]{64}$/);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('same inputs always produce the same hash (determinism)', () => {
		fc.assert(
			fc.property(
				fc.string(),
				fc.integer(),
				fc.string(),
				(cognitoSub, windowStartMinutes, salt) => {
					const hash1 = computeSessionKey(cognitoSub, windowStartMinutes, salt);
					const hash2 = computeSessionKey(cognitoSub, windowStartMinutes, salt);
					expect(hash1).toBe(hash2);
				}
			),
			{ numRuns: 100 }
		);
	});
});
