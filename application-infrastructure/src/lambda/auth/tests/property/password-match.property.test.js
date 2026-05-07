// Feature: 0-0-5-password-reentry-confirmation, Property 1: Exact match comparison
'use strict';

const fc = require('fast-check');
const { validateMatch } = require('../../utils/password-validator');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 256 });

/* ------------------------------------------------------------------ */
/*  Property 1: Exact match comparison                                */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 1.1, 1.2, 1.3
 *
 * For any two strings a and b, validateMatch(a, b).isValid is true
 * if and only if a === b (strict equality with no trimming or
 * normalization), and when a !== b, the error is
 * 'PASSWORDS_DO_NOT_MATCH'.
 */
describe('Property 1: Exact match comparison', () => {

	it('identical non-empty strings always produce isValid: true', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				(password) => {
					const result = validateMatch(password, password);
					expect(result.isValid).toBe(true);
					expect(result.error).toBeNull();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('different non-empty strings always produce isValid: false with PASSWORDS_DO_NOT_MATCH', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				nonEmptyStringArb,
				(a, b) => {
					fc.pre(a !== b);
					const result = validateMatch(a, b);
					expect(result.isValid).toBe(false);
					expect(result.error).toBe('PASSWORDS_DO_NOT_MATCH');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('isValid is true if and only if a === b (biconditional)', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				nonEmptyStringArb,
				(a, b) => {
					const result = validateMatch(a, b);
					expect(result.isValid).toBe(a === b);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('no trimming or normalization is applied (leading/trailing whitespace matters)', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				(base) => {
					const withLeadingSpace = ' ' + base;
					const withTrailingSpace = base + ' ';

					// base vs padded versions should not match
					if (base !== withLeadingSpace) {
						const result1 = validateMatch(base, withLeadingSpace);
						expect(result1.isValid).toBe(false);
						expect(result1.error).toBe('PASSWORDS_DO_NOT_MATCH');
					}

					if (base !== withTrailingSpace) {
						const result2 = validateMatch(base, withTrailingSpace);
						expect(result2.isValid).toBe(false);
						expect(result2.error).toBe('PASSWORDS_DO_NOT_MATCH');
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});
