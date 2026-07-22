/**
 * Password Validation Module
 *
 * Provides pure functions for password match validation and Cognito
 * password policy validation. Zero runtime dependencies — uses only
 * built-in JavaScript string and regex operations.
 *
 * Consumed by frontend applications integrating with the Cognito User
 * Pool defined in this repository's CloudFormation template.
 *
 * @module utils/password-validator
 */

'use strict';

/**
 * DOM element IDs used by the password validation UI.
 *
 * @type {{password: string, confirmPassword: string, passwordDescription: string, matchStatus: string}}
 */
const FIELD_IDS = {
	password: 'password-input',
	confirmPassword: 'confirm-password-input',
	passwordDescription: 'password-requirements',
	matchStatus: 'password-match-status'
};

/**
 * Cognito User Pool password policy rules.
 *
 * @type {{MIN_LENGTH: number, MAX_LENGTH: number, UPPERCASE_PATTERN: RegExp, LOWERCASE_PATTERN: RegExp, NUMBER_PATTERN: RegExp, SYMBOL_PATTERN: RegExp}}
 */
const POLICY_RULES = {
	MIN_LENGTH: 8,
	MAX_LENGTH: 256,
	UPPERCASE_PATTERN: /[A-Z]/,
	LOWERCASE_PATTERN: /[a-z]/,
	NUMBER_PATTERN: /[0-9]/,
	SYMBOL_PATTERN: /[\^$*.\[\]{}()?"!@#%&/\\,><':;|_~`=+\-]/
};

/**
 * Error message constants mapped to violation identifiers.
 * Frontend consumers map these to localized display strings.
 *
 * @type {Object.<string, string>}
 */
const ERROR_MESSAGES = {
	REQUIRED: 'Password is required',
	MIN_LENGTH: 'Password must be at least 8 characters',
	MAX_LENGTH: 'Password must be at most 256 characters',
	UPPERCASE_REQUIRED: 'Password must contain at least one uppercase letter',
	LOWERCASE_REQUIRED: 'Password must contain at least one lowercase letter',
	NUMBER_REQUIRED: 'Password must contain at least one number',
	SYMBOL_REQUIRED: 'Password must contain at least one symbol',
	PASSWORDS_DO_NOT_MATCH: 'Passwords do not match',
	MISSING_PASSWORD: 'Password is required',
	MISSING_CONFIRM_PASSWORD: 'Please confirm your password'
};

/**
 * Perform exact, case-sensitive comparison of two password values.
 *
 * No trimming or whitespace normalization is applied. Non-string types
 * are treated as missing (same as null).
 *
 * @param {string|null|undefined} password - Primary password value
 * @param {string|null|undefined} confirmPassword - Confirmation password value
 * @returns {{isValid: boolean, error: string|null}} Match result
 * @example
 * const { validateMatch } = require('./utils/password-validator');
 *
 * validateMatch('Secret1!', 'Secret1!');
 * // { isValid: true, error: null }
 *
 * validateMatch('Secret1!', 'secret1!');
 * // { isValid: false, error: 'PASSWORDS_DO_NOT_MATCH' }
 *
 * validateMatch(null, 'Secret1!');
 * // { isValid: false, error: 'MISSING_PASSWORD' }
 */
function validateMatch(password, confirmPassword) {
	if (typeof password !== 'string' || password === '') {
		return { isValid: false, error: 'MISSING_PASSWORD' };
	}

	if (typeof confirmPassword !== 'string' || confirmPassword === '') {
		return { isValid: false, error: 'MISSING_CONFIRM_PASSWORD' };
	}

	if (password !== confirmPassword) {
		return { isValid: false, error: 'PASSWORDS_DO_NOT_MATCH' };
	}

	return { isValid: true, error: null };
}

/**
 * Validate a password against the Cognito User Pool password policy.
 *
 * Returns an array of violation identifiers for each rule the password
 * fails. An empty array indicates the password satisfies all rules.
 * Non-string types are treated as missing (same as null).
 *
 * @param {string|null|undefined} password - Password value to validate
 * @returns {string[]} Array of violation identifiers (empty if valid)
 * @example
 * const { validatePolicy } = require('./utils/password-validator');
 *
 * validatePolicy('StrongP@ss1');
 * // []
 *
 * validatePolicy('weak');
 * // ['MIN_LENGTH', 'UPPERCASE_REQUIRED', 'NUMBER_REQUIRED', 'SYMBOL_REQUIRED']
 *
 * validatePolicy(null);
 * // ['REQUIRED']
 */
function validatePolicy(password) {
	if (typeof password !== 'string' || password === '') {
		return ['REQUIRED'];
	}

	const violations = [];

	if (password.length < POLICY_RULES.MIN_LENGTH) {
		violations.push('MIN_LENGTH');
	}

	if (password.length > POLICY_RULES.MAX_LENGTH) {
		violations.push('MAX_LENGTH');
	}

	if (!POLICY_RULES.UPPERCASE_PATTERN.test(password)) {
		violations.push('UPPERCASE_REQUIRED');
	}

	if (!POLICY_RULES.LOWERCASE_PATTERN.test(password)) {
		violations.push('LOWERCASE_REQUIRED');
	}

	if (!POLICY_RULES.NUMBER_PATTERN.test(password)) {
		violations.push('NUMBER_REQUIRED');
	}

	if (!POLICY_RULES.SYMBOL_PATTERN.test(password)) {
		violations.push('SYMBOL_REQUIRED');
	}

	return violations;
}

/**
 * Perform combined real-time validation for both password fields.
 *
 * Designed to be called on every input event. Combines policy validation
 * on the password field with match validation against the confirm field.
 * Suppresses mismatch errors when the confirm field is empty (user hasn't
 * started typing). Returns a valid state when both fields are empty.
 *
 * @param {string} password - Current password field value
 * @param {string} confirmPassword - Current confirm-password field value
 * @returns {{isValid: boolean, errors: string[], fieldErrors: Object.<string, string[]>}} Validation result
 * @example
 * const { validateForm } = require('./utils/password-validator');
 *
 * validateForm('Str0ng!Pass', 'Str0ng!Pass');
 * // { isValid: true, errors: [], fieldErrors: {} }
 *
 * validateForm('weak', '');
 * // { isValid: false, errors: ['Password must be at least 8 characters', ...], fieldErrors: { password: [...] } }
 *
 * validateForm('Str0ng!Pass', 'different');
 * // { isValid: false, errors: ['Passwords do not match'], fieldErrors: { 'confirm-password': ['Passwords do not match'] } }
 */
function validateForm(password, confirmPassword) {
	// When both fields are empty strings, return valid state
	if (password === '' && confirmPassword === '') {
		return { isValid: true, errors: [], fieldErrors: {} };
	}

	const errors = [];
	const fieldErrors = {};

	// Validate password against policy rules
	const policyViolations = validatePolicy(password);
	if (policyViolations.length > 0) {
		const passwordErrors = policyViolations.map(violation => ERROR_MESSAGES[violation]);
		fieldErrors.password = passwordErrors;
		errors.push(...passwordErrors);
	}

	// Validate match only when confirmPassword is non-empty
	if (confirmPassword !== '') {
		const matchResult = validateMatch(password, confirmPassword);
		if (!matchResult.isValid && matchResult.error === 'PASSWORDS_DO_NOT_MATCH') {
			const mismatchMessage = ERROR_MESSAGES.PASSWORDS_DO_NOT_MATCH;
			if (!fieldErrors['confirm-password']) {
				fieldErrors['confirm-password'] = [];
			}
			fieldErrors['confirm-password'].push(mismatchMessage);
			errors.push(mismatchMessage);
		}
	}

	// Cap errors at 10 entries
	const cappedErrors = errors.slice(0, 10);

	return {
		isValid: cappedErrors.length === 0,
		errors: cappedErrors,
		fieldErrors
	};
}

/**
 * Determine whether the form is ready for submission.
 *
 * Returns `true` only when the password satisfies all Cognito policy
 * rules AND both password values match exactly. Any policy violation,
 * mismatch, or missing value results in `false`.
 *
 * @param {string|null|undefined} password - Password value
 * @param {string|null|undefined} confirmPassword - Confirm-password value
 * @returns {boolean} `true` when ready for submission, `false` otherwise
 * @example
 * const { isReadyForSubmission } = require('./utils/password-validator');
 *
 * if (isReadyForSubmission(password, confirmPassword)) {
 *   await Auth.signUp({ username, password });
 * }
 *
 * @example
 * isReadyForSubmission('StrongP@ss1', 'StrongP@ss1');
 * // true
 *
 * isReadyForSubmission('weak', 'weak');
 * // false (policy violations)
 *
 * isReadyForSubmission('StrongP@ss1', 'Different1!');
 * // false (mismatch)
 */
function isReadyForSubmission(password, confirmPassword) {
	if (typeof password !== 'string' || password === '') {
		return false;
	}

	if (typeof confirmPassword !== 'string' || confirmPassword === '') {
		return false;
	}

	const policyViolations = validatePolicy(password);

	if (policyViolations.length > 0) {
		return false;
	}

	return password === confirmPassword;
}

/**
 * Return the DOM element ID of the first field with a validation error.
 *
 * Password field errors take precedence over confirm-password field
 * errors. Returns `null` when no errors are present.
 *
 * @param {Object|null|undefined} validationResult - Result from `validateForm()`
 * @param {Object.<string, string[]>} [validationResult.fieldErrors] - Map of field names to error arrays
 * @returns {string|null} DOM element ID of the first error field, or `null` if no errors
 * @example
 * const { validateForm, getFirstErrorField } = require('./utils/password-validator');
 *
 * const result = validateForm('weak', 'weak');
 * const fieldId = getFirstErrorField(result);
 * // 'password-input' (password has policy errors)
 *
 * @example
 * const result = validateForm('StrongP@ss1', 'Different1!');
 * const fieldId = getFirstErrorField(result);
 * // 'confirm-password-input' (only confirm has mismatch error)
 *
 * @example
 * const result = validateForm('StrongP@ss1', 'StrongP@ss1');
 * const fieldId = getFirstErrorField(result);
 * // null (no errors)
 */
function getFirstErrorField(validationResult) {
	if (
		validationResult == null ||
		typeof validationResult !== 'object' ||
		validationResult.fieldErrors == null ||
		typeof validationResult.fieldErrors !== 'object'
	) {
		return null;
	}

	const { fieldErrors } = validationResult;

	if (
		Array.isArray(fieldErrors['password']) &&
		fieldErrors['password'].length > 0
	) {
		return FIELD_IDS.password;
	}

	if (
		Array.isArray(fieldErrors['confirm-password']) &&
		fieldErrors['confirm-password'].length > 0
	) {
		return FIELD_IDS.confirmPassword;
	}

	return null;
}

/**
 * Generate ARIA attributes for a specific field based on validation state.
 *
 * Returns an object with `ariaDescribedby`, `ariaRequired`, and `ariaInvalid`
 * attributes suitable for applying to a password or confirm-password input
 * element. Handles null, undefined, or non-object validation results
 * defensively by returning safe defaults.
 *
 * @param {Object|null|undefined} validationResult - Result from `validateForm()`
 * @param {Object.<string, string[]>} [validationResult.fieldErrors] - Map of field names to error arrays
 * @param {string} fieldName - Either `'password'` or `'confirm-password'`
 * @returns {{ariaDescribedby: string, ariaRequired: string, ariaInvalid: string}} ARIA attributes object
 * @example
 * const { validateForm, getAriaAttributes } = require('./utils/password-validator');
 *
 * const result = validateForm('weak', '');
 * const attrs = getAriaAttributes(result, 'password');
 * // { ariaDescribedby: 'password-requirements', ariaRequired: 'true', ariaInvalid: 'true' }
 *
 * @example
 * const attrs = getAriaAttributes(null, 'password');
 * // { ariaDescribedby: 'password-requirements', ariaRequired: 'true', ariaInvalid: 'false' }
 */
function getAriaAttributes(validationResult, fieldName) {
	const ariaDescribedby = fieldName === 'confirm-password'
		? FIELD_IDS.matchStatus
		: FIELD_IDS.passwordDescription;

	const ariaRequired = 'true';

	let ariaInvalid = 'false';

	if (
		validationResult != null &&
		typeof validationResult === 'object' &&
		validationResult.fieldErrors != null &&
		typeof validationResult.fieldErrors === 'object'
	) {
		const fieldErrors = validationResult.fieldErrors[fieldName];
		if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
			ariaInvalid = 'true';
		}
	}

	return { ariaDescribedby, ariaRequired, ariaInvalid };
}

/**
 * Generate content for the ARIA live region announcement.
 *
 * Returns an object with `ariaLive` (always `"polite"`) and `content`
 * (concatenated text of all current error messages, or empty string).
 * Handles null, undefined, or non-object validation results defensively
 * by returning an empty content string.
 *
 * @param {Object|null|undefined} validationResult - Result from `validateForm()`
 * @param {string[]} [validationResult.errors] - Array of error message strings
 * @returns {{ariaLive: string, content: string}} ARIA live region configuration
 * @example
 * const { validateForm, getAriaLiveRegion } = require('./utils/password-validator');
 *
 * const result = validateForm('weak', '');
 * const liveRegion = getAriaLiveRegion(result);
 * // { ariaLive: 'polite', content: 'Password must be at least 8 characters...' }
 *
 * @example
 * const liveRegion = getAriaLiveRegion(null);
 * // { ariaLive: 'polite', content: '' }
 */
function getAriaLiveRegion(validationResult) {
	const ariaLive = 'polite';
	let content = '';

	if (
		validationResult != null &&
		typeof validationResult === 'object' &&
		Array.isArray(validationResult.errors)
	) {
		content = validationResult.errors.join(' ');
	}

	return { ariaLive, content };
}

/* ------------------------------------------------------------------ */
/*  TestHarness (for testing private internals)                       */
/* ------------------------------------------------------------------ */

/**
 * Test harness for accessing internal constants for testing purposes.
 * WARNING: This class is for testing only and should NEVER be used in production code.
 *
 * @private
 */
class TestHarness {
	/**
	 * Get access to internal constants for testing purposes.
	 * WARNING: This method is for testing only and should never be used in production.
	 *
	 * @returns {{ERROR_MESSAGES: Object.<string, string>}} Object containing internal constants
	 * @private
	 * @example
	 * // In tests only — DO NOT use in production
	 * const { TestHarness } = require('../utils/password-validator');
	 * const { ERROR_MESSAGES } = TestHarness.getInternals();
	 */
	static getInternals() {
		return {
			ERROR_MESSAGES
		};
	}
}

module.exports = {
	validateMatch,
	validatePolicy,
	validateForm,
	getAriaAttributes,
	getAriaLiveRegion,
	isReadyForSubmission,
	getFirstErrorField,
	FIELD_IDS,
	POLICY_RULES,
	TestHarness
};
