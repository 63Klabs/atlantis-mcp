/**
 * Password Validator — Shared browser-compatible IIFE
 * Exposes window.PasswordValidator with five public functions.
 *
 * Shared by the register, forgot-password, and profile pages.
 * Loaded via <script src="/js/password-validator.js?v=..."> in each consuming page.
 *
 * IMPORTANT: This file must stay behaviorally identical to
 * src/lambda/auth-function/utils/password-validator.js (CommonJS module).
 * The registration-validation.property.jest.mjs Property 1 test enforces this
 * at 100 generated input pairs on every build.
 *
 * No {{{settings.*}}} tokens: apply-settings.js processes only .html and .json,
 * so this .js asset cannot carry settings tokens. Per-page Cognito configuration
 * (cognitoUserPoolId, cognitoClientId, etc.) stays inline in each page's HTML.
 *
 * When this file changes, bump "assetVersion" in settings.json to invalidate
 * browser caches on returning visitors.
 */
(function() {
  'use strict';

  var FIELD_IDS = {
    password: 'password-input',
    confirmPassword: 'confirm-password-input',
    passwordDescription: 'password-requirements',
    matchStatus: 'password-match-status'
  };

  var POLICY_RULES = {
    MIN_LENGTH: 8,
    MAX_LENGTH: 256,
    UPPERCASE_PATTERN: /[A-Z]/,
    LOWERCASE_PATTERN: /[a-z]/,
    NUMBER_PATTERN: /[0-9]/,
    SYMBOL_PATTERN: /[\^$*.\[\]{}()?"!@#%&/\\,><':;|_~`=+\-]/
  };

  var ERROR_MESSAGES = {
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

  function validatePolicy(password) {
    if (typeof password !== 'string' || password === '') {
      return ['REQUIRED'];
    }
    var violations = [];
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

  function validateForm(password, confirmPassword) {
    if (password === '' && confirmPassword === '') {
      return { isValid: true, errors: [], fieldErrors: {} };
    }
    var errors = [];
    var fieldErrors = {};
    var policyViolations = validatePolicy(password);
    if (policyViolations.length > 0) {
      var passwordErrors = policyViolations.map(function(violation) {
        return ERROR_MESSAGES[violation];
      });
      fieldErrors.password = passwordErrors;
      errors.push.apply(errors, passwordErrors);
    }
    if (confirmPassword !== '') {
      var matchResult = validateMatch(password, confirmPassword);
      if (!matchResult.isValid && matchResult.error === 'PASSWORDS_DO_NOT_MATCH') {
        var mismatchMessage = ERROR_MESSAGES.PASSWORDS_DO_NOT_MATCH;
        if (!fieldErrors['confirm-password']) {
          fieldErrors['confirm-password'] = [];
        }
        fieldErrors['confirm-password'].push(mismatchMessage);
        errors.push(mismatchMessage);
      }
    }
    var cappedErrors = errors.slice(0, 10);
    return {
      isValid: cappedErrors.length === 0,
      errors: cappedErrors,
      fieldErrors: fieldErrors
    };
  }

  function isReadyForSubmission(password, confirmPassword) {
    if (typeof password !== 'string' || password === '') {
      return false;
    }
    if (typeof confirmPassword !== 'string' || confirmPassword === '') {
      return false;
    }
    var policyViolations = validatePolicy(password);
    if (policyViolations.length > 0) {
      return false;
    }
    return password === confirmPassword;
  }

  function getFirstErrorField(validationResult) {
    if (
      validationResult == null ||
      typeof validationResult !== 'object' ||
      validationResult.fieldErrors == null ||
      typeof validationResult.fieldErrors !== 'object'
    ) {
      return null;
    }
    var fieldErrors = validationResult.fieldErrors;
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

  function getAriaAttributes(validationResult, fieldName) {
    var ariaDescribedby = fieldName === 'confirm-password'
      ? FIELD_IDS.matchStatus
      : FIELD_IDS.passwordDescription;
    var ariaRequired = 'true';
    var ariaInvalid = 'false';
    if (
      validationResult != null &&
      typeof validationResult === 'object' &&
      validationResult.fieldErrors != null &&
      typeof validationResult.fieldErrors === 'object'
    ) {
      var errors = validationResult.fieldErrors[fieldName];
      if (Array.isArray(errors) && errors.length > 0) {
        ariaInvalid = 'true';
      }
    }
    return { ariaDescribedby: ariaDescribedby, ariaRequired: ariaRequired, ariaInvalid: ariaInvalid };
  }

  function getAriaLiveRegion(validationResult) {
    var ariaLive = 'polite';
    var content = '';
    if (
      validationResult != null &&
      typeof validationResult === 'object' &&
      Array.isArray(validationResult.errors)
    ) {
      content = validationResult.errors.join(' ');
    }
    return { ariaLive: ariaLive, content: content };
  }

  window.PasswordValidator = {
    validateForm: validateForm,
    isReadyForSubmission: isReadyForSubmission,
    getFirstErrorField: getFirstErrorField,
    getAriaAttributes: getAriaAttributes,
    getAriaLiveRegion: getAriaLiveRegion
  };
})();
