// Feature: 0-0-5-password-reentry-confirmation, Property 2: Policy violation correspondence
'use strict';

const fc = require('fast-check');
const { validatePolicy, validateForm, POLICY_RULES, TestHarness } = require('../../utils/password-validator');

const { ERROR_MESSAGES } = TestHarness.getInternals();

/* ------------------------------------------------------------------ */
/*  Arbitraries                                                       */
/* ------------------------------------------------------------------ */

const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 256 });

// Generate passwords of specific lengths for boundary testing
const shortPasswordArb = fc.string({ minLength: 1, maxLength: 7 });
const validLengthPasswordArb = fc.string({ minLength: 8, maxLength: 256 });
const longPasswordArb = fc.string({ minLength: 257, maxLength: 300 });

/* ------------------------------------------------------------------ */
/*  Property 2: Policy violation correspondence                       */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.9
 *
 * For any non-null, non-empty password string, the set of violation
 * identifiers returned by validatePolicy(password) contains exactly
 * one entry per policy rule that the password fails, and is empty
 * when all rules pass. Specifically:
 * - 'MIN_LENGTH' ∈ violations ⟺ password.length < 8
 * - 'MAX_LENGTH' ∈ violations ⟺ password.length > 256
 * - 'UPPERCASE_REQUIRED' ∈ violations ⟺ no character matches /[A-Z]/
 * - 'LOWERCASE_REQUIRED' ∈ violations ⟺ no character matches /[a-z]/
 * - 'NUMBER_REQUIRED' ∈ violations ⟺ no character matches /[0-9]/
 * - 'SYMBOL_REQUIRED' ∈ violations ⟺ no character matches the symbol pattern
 */
describe('Property 2: Policy violation correspondence', () => {

	it('MIN_LENGTH is in violations iff password.length < 8', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				(password) => {
					const violations = validatePolicy(password);
					const hasMinLength = violations.includes('MIN_LENGTH');
					const isTooShort = password.length < POLICY_RULES.MIN_LENGTH;
					expect(hasMinLength).toBe(isTooShort);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('MAX_LENGTH is in violations iff password.length > 256', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 300 }),
				(password) => {
					const violations = validatePolicy(password);
					const hasMaxLength = violations.includes('MAX_LENGTH');
					const isTooLong = password.length > POLICY_RULES.MAX_LENGTH;
					expect(hasMaxLength).toBe(isTooLong);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('UPPERCASE_REQUIRED is in violations iff no character matches /[A-Z]/', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				(password) => {
					const violations = validatePolicy(password);
					const hasUppercaseViolation = violations.includes('UPPERCASE_REQUIRED');
					const lacksUppercase = !POLICY_RULES.UPPERCASE_PATTERN.test(password);
					expect(hasUppercaseViolation).toBe(lacksUppercase);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('LOWERCASE_REQUIRED is in violations iff no character matches /[a-z]/', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				(password) => {
					const violations = validatePolicy(password);
					const hasLowercaseViolation = violations.includes('LOWERCASE_REQUIRED');
					const lacksLowercase = !POLICY_RULES.LOWERCASE_PATTERN.test(password);
					expect(hasLowercaseViolation).toBe(lacksLowercase);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('NUMBER_REQUIRED is in violations iff no character matches /[0-9]/', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				(password) => {
					const violations = validatePolicy(password);
					const hasNumberViolation = violations.includes('NUMBER_REQUIRED');
					const lacksNumber = !POLICY_RULES.NUMBER_PATTERN.test(password);
					expect(hasNumberViolation).toBe(lacksNumber);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('SYMBOL_REQUIRED is in violations iff no character matches the symbol pattern', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				(password) => {
					const violations = validatePolicy(password);
					const hasSymbolViolation = violations.includes('SYMBOL_REQUIRED');
					const lacksSymbol = !POLICY_RULES.SYMBOL_PATTERN.test(password);
					expect(hasSymbolViolation).toBe(lacksSymbol);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('violations contain no duplicates (exactly one entry per failed rule)', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				(password) => {
					const violations = validatePolicy(password);
					const uniqueViolations = new Set(violations);
					expect(uniqueViolations.size).toBe(violations.length);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('violations only contain known policy rule identifiers', () => {
		const knownViolations = [
			'MIN_LENGTH',
			'MAX_LENGTH',
			'UPPERCASE_REQUIRED',
			'LOWERCASE_REQUIRED',
			'NUMBER_REQUIRED',
			'SYMBOL_REQUIRED'
		];

		fc.assert(
			fc.property(
				nonEmptyStringArb,
				(password) => {
					const violations = validatePolicy(password);
					for (const v of violations) {
						expect(knownViolations).toContain(v);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('violations is empty when all rules pass', () => {
		// Generate passwords that satisfy all rules
		const validPasswordArb = fc.tuple(
			fc.string({ minLength: 0, maxLength: 248 })
		).map(([filler]) => {
			// Ensure all character classes are present
			return 'Aa1!' + filler.slice(0, 248);
		}).filter(p => p.length >= 8 && p.length <= 256);

		fc.assert(
			fc.property(
				validPasswordArb,
				(password) => {
					const violations = validatePolicy(password);
					// Verify our generator produces valid passwords
					const hasUpper = POLICY_RULES.UPPERCASE_PATTERN.test(password);
					const hasLower = POLICY_RULES.LOWERCASE_PATTERN.test(password);
					const hasNumber = POLICY_RULES.NUMBER_PATTERN.test(password);
					const hasSymbol = POLICY_RULES.SYMBOL_PATTERN.test(password);

					if (hasUpper && hasLower && hasNumber && hasSymbol &&
						password.length >= 8 && password.length <= 256) {
						expect(violations).toEqual([]);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('complete biconditional: each violation present iff corresponding rule fails', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 300 }),
				(password) => {
					const violations = validatePolicy(password);

					// Each rule's biconditional
					expect(violations.includes('MIN_LENGTH')).toBe(password.length < 8);
					expect(violations.includes('MAX_LENGTH')).toBe(password.length > 256);
					expect(violations.includes('UPPERCASE_REQUIRED')).toBe(!POLICY_RULES.UPPERCASE_PATTERN.test(password));
					expect(violations.includes('LOWERCASE_REQUIRED')).toBe(!POLICY_RULES.LOWERCASE_PATTERN.test(password));
					expect(violations.includes('NUMBER_REQUIRED')).toBe(!POLICY_RULES.NUMBER_PATTERN.test(password));
					expect(violations.includes('SYMBOL_REQUIRED')).toBe(!POLICY_RULES.SYMBOL_PATTERN.test(password));

					// No extra violations beyond the six rules
					const expectedCount = [
						password.length < 8,
						password.length > 256,
						!POLICY_RULES.UPPERCASE_PATTERN.test(password),
						!POLICY_RULES.LOWERCASE_PATTERN.test(password),
						!POLICY_RULES.NUMBER_PATTERN.test(password),
						!POLICY_RULES.SYMBOL_PATTERN.test(password)
					].filter(Boolean).length;

					expect(violations.length).toBe(expectedCount);
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: 0-0-5-password-reentry-confirmation, Property 3: Real-time mismatch suppression

/* ------------------------------------------------------------------ */
/*  Property 3: Real-time mismatch suppression for empty confirm      */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 3.2
 *
 * For any password string value, when validateForm(password, '') is
 * called, the returned fieldErrors object does not contain a mismatch
 * error for the 'confirm-password' key.
 */
describe('Property 3: Real-time mismatch suppression for empty confirm', () => {

	it('validateForm(password, \'\') never contains mismatch error for confirm-password field', () => {
		const nonEmptyPasswordArb = fc.string({ minLength: 1, maxLength: 300 });

		fc.assert(
			fc.property(
				nonEmptyPasswordArb,
				(password) => {
					const result = validateForm(password, '');

					// The fieldErrors object should not have a 'confirm-password' key at all,
					// or if it does, it should not contain the mismatch error message
					const confirmErrors = result.fieldErrors['confirm-password'];
					if (confirmErrors) {
						expect(confirmErrors).not.toContain(ERROR_MESSAGES.PASSWORDS_DO_NOT_MATCH);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('validateForm(password, \'\') does not include confirm-password key in fieldErrors', () => {
		const nonEmptyPasswordArb = fc.string({ minLength: 1, maxLength: 300 });

		fc.assert(
			fc.property(
				nonEmptyPasswordArb,
				(password) => {
					const result = validateForm(password, '');

					// Stronger assertion: confirm-password key should not exist at all
					expect(result.fieldErrors).not.toHaveProperty('confirm-password');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('when both fields are empty, no mismatch error is reported', () => {
		const result = validateForm('', '');

		expect(result.isValid).toBe(true);
		expect(result.fieldErrors).not.toHaveProperty('confirm-password');
		expect(result.errors).not.toContain(ERROR_MESSAGES.PASSWORDS_DO_NOT_MATCH);
	});
});


// Feature: 0-0-5-password-reentry-confirmation, Property 4: Real-time mismatch detection

/* ------------------------------------------------------------------ */
/*  Property 4: Real-time mismatch detection for non-empty confirm    */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 3.3
 *
 * For any two non-empty strings password and confirmPassword where
 * password !== confirmPassword, validateForm(password, confirmPassword)
 * .fieldErrors['confirm-password'] contains a mismatch error.
 */
describe('Property 4: Real-time mismatch detection for non-empty confirm', () => {

	it('non-empty mismatched passwords always produce a mismatch error in fieldErrors[confirm-password]', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				nonEmptyStringArb,
				(password, confirmPassword) => {
					fc.pre(password !== confirmPassword);

					const result = validateForm(password, confirmPassword);
					const confirmErrors = result.fieldErrors['confirm-password'];

					expect(confirmErrors).toBeDefined();
					expect(Array.isArray(confirmErrors)).toBe(true);
					expect(confirmErrors.length).toBeGreaterThan(0);
					expect(confirmErrors).toContain(ERROR_MESSAGES.PASSWORDS_DO_NOT_MATCH);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('mismatch error is specifically PASSWORDS_DO_NOT_MATCH message', () => {
		fc.assert(
			fc.property(
				nonEmptyStringArb,
				fc.string({ minLength: 1, maxLength: 10 }),
				(password, suffix) => {
					// Guarantee difference by appending a suffix
					const confirmPassword = password + suffix;
					fc.pre(password !== confirmPassword);

					const result = validateForm(password, confirmPassword);
					const confirmErrors = result.fieldErrors['confirm-password'];

					expect(confirmErrors).toContain('Passwords do not match');
				}
			),
			{ numRuns: 100 }
		);
	});
});


// Feature: 0-0-5-password-reentry-confirmation, Property 5: Result structure invariant

/* ------------------------------------------------------------------ */
/*  Arbitraries for Property 5                                        */
/* ------------------------------------------------------------------ */

const arbitraryString = fc.string({ minLength: 0, maxLength: 300 });

/* ------------------------------------------------------------------ */
/*  Property 5: Result structure invariant                            */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 3.4
 *
 * For any inputs to validateForm(password, confirmPassword), the
 * returned object always has: isValid as a boolean equal to
 * errors.length === 0, errors as an array with at most 10 entries,
 * and fieldErrors as a plain object mapping strings to string arrays.
 */
describe('Property 5: Result structure invariant', () => {

	it('isValid is always a boolean equal to (errors.length === 0)', () => {
		fc.assert(
			fc.property(
				arbitraryString,
				arbitraryString,
				(password, confirmPassword) => {
					const result = validateForm(password, confirmPassword);
					expect(typeof result.isValid).toBe('boolean');
					expect(result.isValid).toBe(result.errors.length === 0);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('errors is always an array with at most 10 entries', () => {
		fc.assert(
			fc.property(
				arbitraryString,
				arbitraryString,
				(password, confirmPassword) => {
					const result = validateForm(password, confirmPassword);
					expect(Array.isArray(result.errors)).toBe(true);
					expect(result.errors.length).toBeLessThanOrEqual(10);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('fieldErrors is always a plain object mapping strings to string arrays', () => {
		fc.assert(
			fc.property(
				arbitraryString,
				arbitraryString,
				(password, confirmPassword) => {
					const result = validateForm(password, confirmPassword);

					// fieldErrors must be a plain object
					expect(typeof result.fieldErrors).toBe('object');
					expect(result.fieldErrors).not.toBeNull();
					expect(Array.isArray(result.fieldErrors)).toBe(false);
					expect(Object.getPrototypeOf(result.fieldErrors)).toBe(Object.prototype);

					// Each value must be an array of strings
					for (const key of Object.keys(result.fieldErrors)) {
						expect(typeof key).toBe('string');
						const value = result.fieldErrors[key];
						expect(Array.isArray(value)).toBe(true);
						for (const item of value) {
							expect(typeof item).toBe('string');
						}
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});
