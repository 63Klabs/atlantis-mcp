// Feature: 0-0-5-password-reentry-confirmation, Property 9: Focus management priority
'use strict';

const fc = require('fast-check');
const {
	validateMatch,
	validatePolicy,
	validateForm,
	isReadyForSubmission,
	getFirstErrorField,
	getAriaAttributes,
	getAriaLiveRegion,
	FIELD_IDS
} = require('../../utils/password-validator');

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

const passwordArb = fc.string({ minLength: 0, maxLength: 64 });
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 64 });
const fieldNameArb = fc.constantFrom('password', 'confirm-password');

// Generator for a valid password that passes all policy rules
const validPasswordArb = fc.string({ minLength: 0, maxLength: 56 }).map(
	(filler) => 'Aa1!' + filler.slice(0, 56)
).filter(p => p.length >= 8 && p.length <= 64);

/* ------------------------------------------------------------------ */
/*  Property 9: Focus management priority                             */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 *
 * For any validation result, getFirstErrorField(result) returns the
 * password field ID if fieldErrors['password'] is non-empty, else
 * returns the confirm-password field ID if fieldErrors['confirm-password']
 * is non-empty, else returns null.
 */
describe('Property 9: Focus management priority', () => {

	it('returns password field ID when fieldErrors.password is non-empty', () => {
		fc.assert(
			fc.property(
				passwordArb,
				passwordArb,
				(password, confirmPassword) => {
					const result = validateForm(password, confirmPassword);

					// Only test cases where password has errors
					if (
						result.fieldErrors['password'] &&
						result.fieldErrors['password'].length > 0
					) {
						const focusField = getFirstErrorField(result);
						expect(focusField).toBe(FIELD_IDS.password);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('returns confirm-password field ID when only confirm-password has errors', () => {
		fc.assert(
			fc.property(
				validPasswordArb,
				nonEmptyStringArb,
				(password, confirmPassword) => {
					// Ensure passwords don't match to trigger confirm error
					fc.pre(password !== confirmPassword);

					const result = validateForm(password, confirmPassword);

					// Verify password has no errors but confirm does
					const hasPasswordErrors = result.fieldErrors['password'] &&
						result.fieldErrors['password'].length > 0;
					const hasConfirmErrors = result.fieldErrors['confirm-password'] &&
						result.fieldErrors['confirm-password'].length > 0;

					if (!hasPasswordErrors && hasConfirmErrors) {
						const focusField = getFirstErrorField(result);
						expect(focusField).toBe(FIELD_IDS.confirmPassword);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('returns null when no field has errors', () => {
		fc.assert(
			fc.property(
				validPasswordArb,
				(password) => {
					// Use same password for both fields to ensure no errors
					const result = validateForm(password, password);

					const hasPasswordErrors = result.fieldErrors['password'] &&
						result.fieldErrors['password'].length > 0;
					const hasConfirmErrors = result.fieldErrors['confirm-password'] &&
						result.fieldErrors['confirm-password'].length > 0;

					if (!hasPasswordErrors && !hasConfirmErrors) {
						const focusField = getFirstErrorField(result);
						expect(focusField).toBeNull();
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('password errors always take priority over confirm-password errors', () => {
		fc.assert(
			fc.property(
				passwordArb,
				nonEmptyStringArb,
				(password, confirmPassword) => {
					// Ensure passwords differ to potentially trigger both error types
					fc.pre(password !== confirmPassword);
					fc.pre(password !== '');

					const result = validateForm(password, confirmPassword);

					const hasPasswordErrors = result.fieldErrors['password'] &&
						result.fieldErrors['password'].length > 0;
					const hasConfirmErrors = result.fieldErrors['confirm-password'] &&
						result.fieldErrors['confirm-password'].length > 0;

					// When both fields have errors, password takes priority
					if (hasPasswordErrors && hasConfirmErrors) {
						const focusField = getFirstErrorField(result);
						expect(focusField).toBe(FIELD_IDS.password);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('complete priority logic: password > confirm > null for any validation result', () => {
		fc.assert(
			fc.property(
				passwordArb,
				passwordArb,
				(password, confirmPassword) => {
					const result = validateForm(password, confirmPassword);
					const focusField = getFirstErrorField(result);

					const hasPasswordErrors = Array.isArray(result.fieldErrors['password']) &&
						result.fieldErrors['password'].length > 0;
					const hasConfirmErrors = Array.isArray(result.fieldErrors['confirm-password']) &&
						result.fieldErrors['confirm-password'].length > 0;

					if (hasPasswordErrors) {
						expect(focusField).toBe(FIELD_IDS.password);
					} else if (hasConfirmErrors) {
						expect(focusField).toBe(FIELD_IDS.confirmPassword);
					} else {
						expect(focusField).toBeNull();
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Property 10: Determinism and statelessness                        */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 *
 * For any sequence of inputs, calling any validation function with the
 * same arguments always produces the same result regardless of prior
 * calls, call count, or call timing. Formally: for any inputs (a, b),
 * validateForm(a, b) called at time T1 after N prior calls produces
 * the same result as validateForm(a, b) called at time T2 after M
 * prior calls.
 */
describe('Property 10: Determinism and statelessness', () => {

	it('validateMatch returns identical results for same inputs regardless of prior calls', () => {
		fc.assert(
			fc.property(
				passwordArb,
				passwordArb,
				nonEmptyStringArb,
				nonEmptyStringArb,
				(a, b, noise1, noise2) => {
					// Call with different inputs first to check for state leakage
					validateMatch(noise1, noise2);
					validateMatch(noise2, noise1);
					const result1 = validateMatch(a, b);

					// Call with more different inputs
					validateMatch(noise2, noise1);
					validateMatch(noise1, noise2);
					const result2 = validateMatch(a, b);

					expect(result1).toEqual(result2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('validatePolicy returns identical results for same input regardless of prior calls', () => {
		fc.assert(
			fc.property(
				passwordArb,
				nonEmptyStringArb,
				nonEmptyStringArb,
				(password, noise1, noise2) => {
					// Call with different inputs first
					validatePolicy(noise1);
					validatePolicy(noise2);
					const result1 = validatePolicy(password);

					// Call with more different inputs
					validatePolicy(noise2);
					validatePolicy(noise1);
					const result2 = validatePolicy(password);

					expect(result1).toEqual(result2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('validateForm returns identical results for same inputs regardless of prior calls', () => {
		fc.assert(
			fc.property(
				passwordArb,
				passwordArb,
				nonEmptyStringArb,
				nonEmptyStringArb,
				(password, confirm, noise1, noise2) => {
					// Call with different inputs first to check for state leakage
					validateForm(noise1, noise2);
					validateForm(noise2, noise1);
					const result1 = validateForm(password, confirm);

					// Call with more different inputs in between
					validateForm(noise2, noise1);
					validateForm(noise1, noise2);
					const result2 = validateForm(password, confirm);

					expect(result1).toEqual(result2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('isReadyForSubmission returns identical results for same inputs regardless of prior calls', () => {
		fc.assert(
			fc.property(
				passwordArb,
				passwordArb,
				nonEmptyStringArb,
				nonEmptyStringArb,
				(password, confirm, noise1, noise2) => {
					// Call with different inputs first
					isReadyForSubmission(noise1, noise2);
					isReadyForSubmission(noise2, noise1);
					const result1 = isReadyForSubmission(password, confirm);

					// Call with more different inputs in between
					isReadyForSubmission(noise2, noise1);
					isReadyForSubmission(noise1, noise2);
					const result2 = isReadyForSubmission(password, confirm);

					expect(result1).toBe(result2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('getFirstErrorField returns identical results for same input regardless of prior calls', () => {
		fc.assert(
			fc.property(
				passwordArb,
				passwordArb,
				nonEmptyStringArb,
				nonEmptyStringArb,
				(password, confirm, noise1, noise2) => {
					// Generate validation results with noise inputs
					const noiseResult1 = validateForm(noise1, noise2);
					const noiseResult2 = validateForm(noise2, noise1);

					// Call getFirstErrorField with noise results
					getFirstErrorField(noiseResult1);
					getFirstErrorField(noiseResult2);

					// Now call with our target input
					const targetResult = validateForm(password, confirm);
					const result1 = getFirstErrorField(targetResult);

					// Call with noise again
					getFirstErrorField(noiseResult2);
					getFirstErrorField(noiseResult1);

					// Call again with same target input
					const result2 = getFirstErrorField(targetResult);

					expect(result1).toBe(result2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('getAriaAttributes returns identical results for same inputs regardless of prior calls', () => {
		fc.assert(
			fc.property(
				passwordArb,
				passwordArb,
				fieldNameArb,
				nonEmptyStringArb,
				nonEmptyStringArb,
				(password, confirm, fieldName, noise1, noise2) => {
					// Generate validation results
					const noiseResult = validateForm(noise1, noise2);
					const targetResult = validateForm(password, confirm);

					// Call with noise first
					getAriaAttributes(noiseResult, 'password');
					getAriaAttributes(noiseResult, 'confirm-password');
					const result1 = getAriaAttributes(targetResult, fieldName);

					// Call with noise again
					getAriaAttributes(noiseResult, 'confirm-password');
					getAriaAttributes(noiseResult, 'password');
					const result2 = getAriaAttributes(targetResult, fieldName);

					expect(result1).toEqual(result2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('getAriaLiveRegion returns identical results for same input regardless of prior calls', () => {
		fc.assert(
			fc.property(
				passwordArb,
				passwordArb,
				nonEmptyStringArb,
				nonEmptyStringArb,
				(password, confirm, noise1, noise2) => {
					// Generate validation results
					const noiseResult = validateForm(noise1, noise2);
					const targetResult = validateForm(password, confirm);

					// Call with noise first
					getAriaLiveRegion(noiseResult);
					const result1 = getAriaLiveRegion(targetResult);

					// Call with noise again
					getAriaLiveRegion(noiseResult);
					const result2 = getAriaLiveRegion(targetResult);

					expect(result1).toEqual(result2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('multiple consecutive calls with same args produce identical results (no call-count dependency)', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				nonEmptyStringArb,
				fc.integer({ min: 3, max: 10 }),
				(password, confirm, callCount) => {
					const results = [];
					for (let i = 0; i < callCount; i++) {
						results.push(validateForm(password, confirm));
					}

					// All results must be identical
					for (let i = 1; i < results.length; i++) {
						expect(results[i]).toEqual(results[0]);
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});
