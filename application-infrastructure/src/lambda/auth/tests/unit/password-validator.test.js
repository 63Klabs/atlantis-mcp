// Feature: 0-0-5-password-reentry-confirmation, Unit tests for password-validator
// Tests validateMatch, validatePolicy, validateForm, isReadyForSubmission, and getFirstErrorField
'use strict';

const {
	validateMatch,
	validatePolicy,
	validateForm,
	isReadyForSubmission,
	getFirstErrorField,
	getAriaAttributes,
	getAriaLiveRegion,
	FIELD_IDS,
	TestHarness
} = require('../../utils/password-validator');

const { ERROR_MESSAGES } = TestHarness.getInternals();

// ============================================================
// validateMatch
// ============================================================

describe('validateMatch', () => {
	it('should return valid when both passwords are identical', () => {
		const result = validateMatch('Secret1!', 'Secret1!');
		expect(result).toEqual({ isValid: true, error: null });
	});

	it('should return PASSWORDS_DO_NOT_MATCH when passwords differ', () => {
		const result = validateMatch('Secret1!', 'secret1!');
		expect(result).toEqual({ isValid: false, error: 'PASSWORDS_DO_NOT_MATCH' });
	});

	it('should return MISSING_PASSWORD when password is null', () => {
		const result = validateMatch(null, 'Secret1!');
		expect(result).toEqual({ isValid: false, error: 'MISSING_PASSWORD' });
	});

	it('should return MISSING_PASSWORD when password is undefined', () => {
		const result = validateMatch(undefined, 'Secret1!');
		expect(result).toEqual({ isValid: false, error: 'MISSING_PASSWORD' });
	});

	it('should return MISSING_PASSWORD when password is empty string', () => {
		const result = validateMatch('', 'Secret1!');
		expect(result).toEqual({ isValid: false, error: 'MISSING_PASSWORD' });
	});

	it('should return MISSING_CONFIRM_PASSWORD when confirmPassword is null', () => {
		const result = validateMatch('Secret1!', null);
		expect(result).toEqual({ isValid: false, error: 'MISSING_CONFIRM_PASSWORD' });
	});

	it('should return MISSING_CONFIRM_PASSWORD when confirmPassword is undefined', () => {
		const result = validateMatch('Secret1!', undefined);
		expect(result).toEqual({ isValid: false, error: 'MISSING_CONFIRM_PASSWORD' });
	});

	it('should return MISSING_CONFIRM_PASSWORD when confirmPassword is empty string', () => {
		const result = validateMatch('Secret1!', '');
		expect(result).toEqual({ isValid: false, error: 'MISSING_CONFIRM_PASSWORD' });
	});

	it('should be case-sensitive and not trim whitespace', () => {
		expect(validateMatch(' pass ', ' pass ').isValid).toBe(true);
		expect(validateMatch(' pass', 'pass').isValid).toBe(false);
		expect(validateMatch('Pass', 'pass').isValid).toBe(false);
	});

	it('should treat non-string types as missing', () => {
		expect(validateMatch(123, 'test').error).toBe('MISSING_PASSWORD');
		expect(validateMatch('test', 123).error).toBe('MISSING_CONFIRM_PASSWORD');
	});
});

// ============================================================
// validatePolicy
// ============================================================

describe('validatePolicy', () => {
	it('should return empty array for a password satisfying all rules', () => {
		expect(validatePolicy('StrongP@ss1')).toEqual([]);
	});

	it('should return REQUIRED for null password', () => {
		expect(validatePolicy(null)).toEqual(['REQUIRED']);
	});

	it('should return REQUIRED for undefined password', () => {
		expect(validatePolicy(undefined)).toEqual(['REQUIRED']);
	});

	it('should return REQUIRED for empty string', () => {
		expect(validatePolicy('')).toEqual(['REQUIRED']);
	});

	it('should return MIN_LENGTH when password is too short', () => {
		const violations = validatePolicy('Aa1!');
		expect(violations).toContain('MIN_LENGTH');
	});

	it('should return MAX_LENGTH when password exceeds 256 characters', () => {
		const longPassword = 'Aa1!' + 'x'.repeat(253);
		expect(longPassword.length).toBe(257);
		const violations = validatePolicy(longPassword);
		expect(violations).toContain('MAX_LENGTH');
	});

	it('should return UPPERCASE_REQUIRED when no uppercase letter', () => {
		const violations = validatePolicy('lowercase1!');
		expect(violations).toContain('UPPERCASE_REQUIRED');
		expect(violations).not.toContain('LOWERCASE_REQUIRED');
	});

	it('should return LOWERCASE_REQUIRED when no lowercase letter', () => {
		const violations = validatePolicy('UPPERCASE1!');
		expect(violations).toContain('LOWERCASE_REQUIRED');
		expect(violations).not.toContain('UPPERCASE_REQUIRED');
	});

	it('should return NUMBER_REQUIRED when no digit', () => {
		const violations = validatePolicy('NoDigits!A');
		expect(violations).toContain('NUMBER_REQUIRED');
	});

	it('should return SYMBOL_REQUIRED when no symbol', () => {
		const violations = validatePolicy('NoSymbol1A');
		expect(violations).toContain('SYMBOL_REQUIRED');
	});

	it('should return multiple violations for multiple failures', () => {
		const violations = validatePolicy('short');
		expect(violations).toContain('MIN_LENGTH');
		expect(violations).toContain('UPPERCASE_REQUIRED');
		expect(violations).toContain('NUMBER_REQUIRED');
		expect(violations).toContain('SYMBOL_REQUIRED');
	});
});

// ============================================================
// validateForm
// ============================================================

describe('validateForm', () => {
	it('should return valid state when both fields are empty', () => {
		const result = validateForm('', '');
		expect(result).toEqual({ isValid: true, errors: [], fieldErrors: {} });
	});

	it('should suppress mismatch error when confirm field is empty', () => {
		const result = validateForm('StrongP@ss1', '');
		expect(result.fieldErrors).not.toHaveProperty('confirm-password');
		expect(result.errors).not.toContain(ERROR_MESSAGES.PASSWORDS_DO_NOT_MATCH);
	});

	it('should report mismatch when confirm field is non-empty and differs', () => {
		const result = validateForm('StrongP@ss1', 'Different1!');
		expect(result.fieldErrors['confirm-password']).toContain(ERROR_MESSAGES.PASSWORDS_DO_NOT_MATCH);
		expect(result.errors).toContain(ERROR_MESSAGES.PASSWORDS_DO_NOT_MATCH);
		expect(result.isValid).toBe(false);
	});

	it('should not report mismatch when passwords match', () => {
		const result = validateForm('StrongP@ss1', 'StrongP@ss1');
		expect(result.isValid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.fieldErrors).toEqual({});
	});

	it('should report policy violations in fieldErrors.password', () => {
		const result = validateForm('weak', '');
		expect(result.fieldErrors.password).toBeDefined();
		expect(result.fieldErrors.password.length).toBeGreaterThan(0);
		expect(result.isValid).toBe(false);
	});

	it('should return correct result structure', () => {
		const result = validateForm('test', 'other');
		expect(typeof result.isValid).toBe('boolean');
		expect(Array.isArray(result.errors)).toBe(true);
		expect(typeof result.fieldErrors).toBe('object');
		expect(result.fieldErrors).not.toBeNull();
	});

	it('should have isValid equal to errors.length === 0', () => {
		const validResult = validateForm('StrongP@ss1', 'StrongP@ss1');
		expect(validResult.isValid).toBe(true);
		expect(validResult.errors.length).toBe(0);

		const invalidResult = validateForm('weak', 'weak');
		expect(invalidResult.isValid).toBe(false);
		expect(invalidResult.errors.length).toBeGreaterThan(0);
	});

	it('should cap errors at 10 entries', () => {
		// A very weak password with many violations plus mismatch
		const result = validateForm('', 'x');
		expect(result.errors.length).toBeLessThanOrEqual(10);
	});
});

// ============================================================
// isReadyForSubmission
// ============================================================

describe('isReadyForSubmission', () => {
	it('should return true when all policy rules pass and passwords match', () => {
		expect(isReadyForSubmission('StrongP@ss1', 'StrongP@ss1')).toBe(true);
	});

	it('should return false when password has policy violations', () => {
		expect(isReadyForSubmission('weak', 'weak')).toBe(false);
	});

	it('should return false when passwords do not match', () => {
		expect(isReadyForSubmission('StrongP@ss1', 'Different1!')).toBe(false);
	});

	it('should return false when password is empty', () => {
		expect(isReadyForSubmission('', '')).toBe(false);
	});

	it('should return false when password is null', () => {
		expect(isReadyForSubmission(null, 'StrongP@ss1')).toBe(false);
	});

	it('should return false when password is undefined', () => {
		expect(isReadyForSubmission(undefined, 'StrongP@ss1')).toBe(false);
	});

	it('should return false when confirmPassword is null', () => {
		expect(isReadyForSubmission('StrongP@ss1', null)).toBe(false);
	});

	it('should return false when confirmPassword is undefined', () => {
		expect(isReadyForSubmission('StrongP@ss1', undefined)).toBe(false);
	});

	it('should return false when confirmPassword is empty', () => {
		expect(isReadyForSubmission('StrongP@ss1', '')).toBe(false);
	});

	it('should return false for non-string types', () => {
		expect(isReadyForSubmission(123, 123)).toBe(false);
		expect(isReadyForSubmission('StrongP@ss1', 123)).toBe(false);
	});
});

// ============================================================
// getFirstErrorField
// ============================================================

describe('getFirstErrorField', () => {
	it('should return password field ID when password has errors', () => {
		const result = validateForm('weak', '');
		const fieldId = getFirstErrorField(result);
		expect(fieldId).toBe(FIELD_IDS.password);
	});

	it('should return confirm-password field ID when only confirm has errors', () => {
		const result = validateForm('StrongP@ss1', 'Different1!');
		const fieldId = getFirstErrorField(result);
		expect(fieldId).toBe(FIELD_IDS.confirmPassword);
	});

	it('should return null when no errors exist', () => {
		const result = validateForm('StrongP@ss1', 'StrongP@ss1');
		const fieldId = getFirstErrorField(result);
		expect(fieldId).toBeNull();
	});

	it('should return null when both fields are empty (valid state)', () => {
		const result = validateForm('', '');
		const fieldId = getFirstErrorField(result);
		expect(fieldId).toBeNull();
	});

	it('should prioritize password field over confirm-password field', () => {
		// Both fields have errors: password has policy violations, confirm has mismatch
		const result = validateForm('weak', 'other');
		const fieldId = getFirstErrorField(result);
		expect(fieldId).toBe(FIELD_IDS.password);
	});

	it('should return null for null input', () => {
		expect(getFirstErrorField(null)).toBeNull();
	});

	it('should return null for undefined input', () => {
		expect(getFirstErrorField(undefined)).toBeNull();
	});

	it('should return null for non-object input', () => {
		expect(getFirstErrorField('string')).toBeNull();
		expect(getFirstErrorField(42)).toBeNull();
	});

	it('should return null when fieldErrors is missing', () => {
		expect(getFirstErrorField({ isValid: true, errors: [] })).toBeNull();
	});
});

// ============================================================
// getAriaAttributes
// ============================================================

describe('getAriaAttributes', () => {
	describe('ariaRequired', () => {
		it('should always return ariaRequired as "true" for password field', () => {
			const result = validateForm('weak', '');
			const attrs = getAriaAttributes(result, 'password');
			expect(attrs.ariaRequired).toBe('true');
		});

		it('should always return ariaRequired as "true" for confirm-password field', () => {
			const result = validateForm('StrongP@ss1', 'different');
			const attrs = getAriaAttributes(result, 'confirm-password');
			expect(attrs.ariaRequired).toBe('true');
		});

		it('should return ariaRequired as "true" when validation result is null', () => {
			const attrs = getAriaAttributes(null, 'password');
			expect(attrs.ariaRequired).toBe('true');
		});

		it('should return ariaRequired as "true" when no errors exist', () => {
			const result = validateForm('StrongP@ss1', 'StrongP@ss1');
			const attrs = getAriaAttributes(result, 'password');
			expect(attrs.ariaRequired).toBe('true');
		});
	});

	describe('ariaInvalid', () => {
		it('should return ariaInvalid "true" when password field has errors', () => {
			const result = validateForm('weak', '');
			const attrs = getAriaAttributes(result, 'password');
			expect(attrs.ariaInvalid).toBe('true');
		});

		it('should return ariaInvalid "true" when confirm-password field has errors', () => {
			const result = validateForm('StrongP@ss1', 'Different1!');
			const attrs = getAriaAttributes(result, 'confirm-password');
			expect(attrs.ariaInvalid).toBe('true');
		});

		it('should return ariaInvalid "false" when password field has no errors', () => {
			const result = validateForm('StrongP@ss1', 'StrongP@ss1');
			const attrs = getAriaAttributes(result, 'password');
			expect(attrs.ariaInvalid).toBe('false');
		});

		it('should return ariaInvalid "false" when confirm-password field has no errors', () => {
			const result = validateForm('StrongP@ss1', 'StrongP@ss1');
			const attrs = getAriaAttributes(result, 'confirm-password');
			expect(attrs.ariaInvalid).toBe('false');
		});

		it('should return ariaInvalid "false" when validation result is null', () => {
			const attrs = getAriaAttributes(null, 'password');
			expect(attrs.ariaInvalid).toBe('false');
		});

		it('should return ariaInvalid "false" when validation result is undefined', () => {
			const attrs = getAriaAttributes(undefined, 'password');
			expect(attrs.ariaInvalid).toBe('false');
		});
	});

	describe('ariaDescribedby', () => {
		it('should reference password-requirements for password field', () => {
			const result = validateForm('StrongP@ss1', 'StrongP@ss1');
			const attrs = getAriaAttributes(result, 'password');
			expect(attrs.ariaDescribedby).toBe(FIELD_IDS.passwordDescription);
		});

		it('should reference password-match-status for confirm-password field', () => {
			const result = validateForm('StrongP@ss1', 'StrongP@ss1');
			const attrs = getAriaAttributes(result, 'confirm-password');
			expect(attrs.ariaDescribedby).toBe(FIELD_IDS.matchStatus);
		});

		it('should reference password-requirements for password field even with null result', () => {
			const attrs = getAriaAttributes(null, 'password');
			expect(attrs.ariaDescribedby).toBe('password-requirements');
		});

		it('should reference password-match-status for confirm-password field even with null result', () => {
			const attrs = getAriaAttributes(null, 'confirm-password');
			expect(attrs.ariaDescribedby).toBe('password-match-status');
		});
	});

	describe('defensive behavior', () => {
		it('should return safe defaults for null input', () => {
			const attrs = getAriaAttributes(null, 'password');
			expect(attrs).toEqual({
				ariaDescribedby: 'password-requirements',
				ariaRequired: 'true',
				ariaInvalid: 'false'
			});
		});

		it('should return safe defaults for undefined input', () => {
			const attrs = getAriaAttributes(undefined, 'confirm-password');
			expect(attrs).toEqual({
				ariaDescribedby: 'password-match-status',
				ariaRequired: 'true',
				ariaInvalid: 'false'
			});
		});

		it('should return safe defaults for non-object input (number)', () => {
			const attrs = getAriaAttributes(42, 'password');
			expect(attrs).toEqual({
				ariaDescribedby: 'password-requirements',
				ariaRequired: 'true',
				ariaInvalid: 'false'
			});
		});

		it('should return safe defaults for non-object input (string)', () => {
			const attrs = getAriaAttributes('invalid', 'password');
			expect(attrs).toEqual({
				ariaDescribedby: 'password-requirements',
				ariaRequired: 'true',
				ariaInvalid: 'false'
			});
		});

		it('should return safe defaults when fieldErrors is null', () => {
			const attrs = getAriaAttributes({ fieldErrors: null }, 'password');
			expect(attrs).toEqual({
				ariaDescribedby: 'password-requirements',
				ariaRequired: 'true',
				ariaInvalid: 'false'
			});
		});

		it('should return safe defaults when fieldErrors is not an object', () => {
			const attrs = getAriaAttributes({ fieldErrors: 'bad' }, 'password');
			expect(attrs).toEqual({
				ariaDescribedby: 'password-requirements',
				ariaRequired: 'true',
				ariaInvalid: 'false'
			});
		});
	});
});

// ============================================================
// getAriaLiveRegion
// ============================================================

describe('getAriaLiveRegion', () => {
	describe('ariaLive attribute', () => {
		it('should always return ariaLive as "polite"', () => {
			const result = validateForm('weak', '');
			const liveRegion = getAriaLiveRegion(result);
			expect(liveRegion.ariaLive).toBe('polite');
		});

		it('should return ariaLive as "polite" when no errors', () => {
			const result = validateForm('StrongP@ss1', 'StrongP@ss1');
			const liveRegion = getAriaLiveRegion(result);
			expect(liveRegion.ariaLive).toBe('polite');
		});

		it('should return ariaLive as "polite" for null input', () => {
			const liveRegion = getAriaLiveRegion(null);
			expect(liveRegion.ariaLive).toBe('polite');
		});
	});

	describe('content with concatenated error text', () => {
		it('should return concatenated error messages separated by spaces', () => {
			const result = validateForm('weak', '');
			const liveRegion = getAriaLiveRegion(result);
			// 'weak' fails: MIN_LENGTH, UPPERCASE_REQUIRED, NUMBER_REQUIRED, SYMBOL_REQUIRED
			expect(liveRegion.content).toContain('Password must be at least 8 characters');
			expect(liveRegion.content).toContain('Password must contain at least one uppercase letter');
			expect(liveRegion.content).toContain('Password must contain at least one number');
			expect(liveRegion.content).toContain('Password must contain at least one symbol');
		});

		it('should return empty string when no errors exist', () => {
			const result = validateForm('StrongP@ss1', 'StrongP@ss1');
			const liveRegion = getAriaLiveRegion(result);
			expect(liveRegion.content).toBe('');
		});

		it('should include mismatch error when passwords differ', () => {
			const result = validateForm('StrongP@ss1', 'Different1!');
			const liveRegion = getAriaLiveRegion(result);
			expect(liveRegion.content).toContain('Passwords do not match');
		});

		it('should join errors with space separator', () => {
			const mockResult = { errors: ['Error one', 'Error two'] };
			const liveRegion = getAriaLiveRegion(mockResult);
			expect(liveRegion.content).toBe('Error one Error two');
		});
	});

	describe('defensive behavior', () => {
		it('should return empty content for null input', () => {
			const liveRegion = getAriaLiveRegion(null);
			expect(liveRegion).toEqual({ ariaLive: 'polite', content: '' });
		});

		it('should return empty content for undefined input', () => {
			const liveRegion = getAriaLiveRegion(undefined);
			expect(liveRegion).toEqual({ ariaLive: 'polite', content: '' });
		});

		it('should return empty content for non-object input (number)', () => {
			const liveRegion = getAriaLiveRegion(123);
			expect(liveRegion).toEqual({ ariaLive: 'polite', content: '' });
		});

		it('should return empty content for non-object input (string)', () => {
			const liveRegion = getAriaLiveRegion('invalid');
			expect(liveRegion).toEqual({ ariaLive: 'polite', content: '' });
		});

		it('should return empty content when errors property is missing', () => {
			const liveRegion = getAriaLiveRegion({ fieldErrors: {} });
			expect(liveRegion).toEqual({ ariaLive: 'polite', content: '' });
		});

		it('should return empty content when errors is not an array', () => {
			const liveRegion = getAriaLiveRegion({ errors: 'not-an-array' });
			expect(liveRegion).toEqual({ ariaLive: 'polite', content: '' });
		});

		it('should return empty content when errors is an empty array', () => {
			const liveRegion = getAriaLiveRegion({ errors: [] });
			expect(liveRegion).toEqual({ ariaLive: 'polite', content: '' });
		});
	});
});
