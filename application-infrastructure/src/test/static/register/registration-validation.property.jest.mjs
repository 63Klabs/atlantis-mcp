/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import fc from 'fast-check';

/**
 * Property-based tests for registration form validation integration.
 * Tests the browser IIFE + DOM interaction using jsdom.
 *
 * Feature: 0-0-5-registration-confirm-password-ui
 */

const HTML_PATH = resolve(
  import.meta.dirname,
  '../../../static/public/register/index.html'
);

const VALIDATOR_PATH = resolve(
  import.meta.dirname,
  '../../../lambda/auth/utils/password-validator.js'
);

// Load the CommonJS module for Property 1 equivalence testing
let cjsModule;
try {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  cjsModule = require(VALIDATOR_PATH);
} catch (e) {
  // Fallback: dynamic import won't work for CJS in all environments
  cjsModule = null;
}

// --- Test Generators ---

/** Valid password generator (satisfies all Cognito policy rules) */
const validPassword = fc.tuple(
  fc.string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), minLength: 1, maxLength: 1 }),
  fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'), minLength: 1, maxLength: 1 }),
  fc.string({ unit: fc.constantFrom(...'0123456789'), minLength: 1, maxLength: 1 }),
  fc.string({ unit: fc.constantFrom(...'^$*.[]{}()?"!@#%&/\\,><\':;|_~`=+-'), minLength: 1, maxLength: 1 }),
  fc.string({ minLength: 4, maxLength: 248 })
).map(([upper, lower, num, sym, rest]) => upper + lower + num + sym + rest);

/** Invalid password generator (violates at least one rule) */
const invalidPassword = fc.oneof(
  fc.constant(''),                           // empty
  fc.string({ minLength: 1, maxLength: 7 }),   // too short
  fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789!'), minLength: 8, maxLength: 20 }) // no uppercase
);

/** Non-empty string for confirm field */
const nonEmptyString = fc.string({ minLength: 1, maxLength: 100 });

/** Arbitrary string for password field (any input) */
const anyString = fc.string({ minLength: 0, maxLength: 100 });

// --- Page Setup Helpers ---

function loadPage() {
  let html = readFileSync(HTML_PATH, 'utf8');
  html = html.replace(/\{\{\{settings\.cognitoUserPoolId\}\}\}/g, 'us-east-1_TestPool');
  html = html.replace(/\{\{\{settings\.cognitoClientId\}\}\}/g, 'testclientid123');
  html = html.replace(/\{\{\{settings\.apiBaseUrl\}\}\}/g, 'https://api.test.com');
  html = html.replace(/\{\{\{settings\.footer\}\}\}/g, '<span id="copyright-year"></span>');
  return html;
}

function setupCognitoMock() {
  window.AmazonCognitoIdentity = {
    CognitoUserPool: jest.fn(() => ({
      signUp: jest.fn()
    })),
    CognitoUser: jest.fn(() => ({
      resendConfirmationCode: jest.fn(),
      confirmRegistration: jest.fn(),
      authenticateUser: jest.fn()
    })),
    CognitoUserAttribute: jest.fn((data) => data),
    AuthenticationDetails: jest.fn((data) => data)
  };
}

function executePageScript(html) {
  const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/g);
  if (scriptMatches) {
    for (const scriptTag of scriptMatches) {
      const code = scriptTag.replace(/<\/?script>/g, '');
      if (code.includes('amazon-cognito-identity')) continue;
      try {
        const fn = new Function(code);
        fn();
      } catch (e) {
        if (!e.message.includes('Cannot set properties of null')) {
          throw e;
        }
      }
    }
  }
}

function setupPage() {
  const html = loadPage();
  setupCognitoMock();
  document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  const cdnScript = document.querySelector('script[src*="amazon-cognito"]');
  if (cdnScript) cdnScript.remove();
  executePageScript(html);
  return html;
}

/**
 * Simulate typing into an input field by setting value and dispatching input event.
 */
function typeInto(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

// --- Property Tests ---

describe('Feature: 0-0-5-registration-confirm-password-ui, Property 1: IIFE–CommonJS Equivalence', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * For any pair (password, confirmPassword), all 5 functions on
   * window.PasswordValidator produce identical results to the CommonJS module.
   */

  beforeEach(() => {
    jest.useFakeTimers();
    setupPage();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  it('Property 1: IIFE produces identical results to CommonJS module for all 5 functions', () => {
    expect(cjsModule).not.toBeNull();
    const iife = window.PasswordValidator;

    fc.assert(
      fc.property(
        anyString,
        anyString,
        (password, confirmPassword) => {
          // validateForm
          const iifeValidateForm = iife.validateForm(password, confirmPassword);
          const cjsValidateForm = cjsModule.validateForm(password, confirmPassword);
          expect(iifeValidateForm).toEqual(cjsValidateForm);

          // isReadyForSubmission
          const iifeReady = iife.isReadyForSubmission(password, confirmPassword);
          const cjsReady = cjsModule.isReadyForSubmission(password, confirmPassword);
          expect(iifeReady).toEqual(cjsReady);

          // getFirstErrorField
          const iifeFirstError = iife.getFirstErrorField(iifeValidateForm);
          const cjsFirstError = cjsModule.getFirstErrorField(cjsValidateForm);
          expect(iifeFirstError).toEqual(cjsFirstError);

          // getAriaAttributes (test both field names)
          const iifeAriaPassword = iife.getAriaAttributes(iifeValidateForm, 'password');
          const cjsAriaPassword = cjsModule.getAriaAttributes(cjsValidateForm, 'password');
          expect(iifeAriaPassword).toEqual(cjsAriaPassword);

          const iifeAriaConfirm = iife.getAriaAttributes(iifeValidateForm, 'confirm-password');
          const cjsAriaConfirm = cjsModule.getAriaAttributes(cjsValidateForm, 'confirm-password');
          expect(iifeAriaConfirm).toEqual(cjsAriaConfirm);

          // getAriaLiveRegion
          const iifeLiveRegion = iife.getAriaLiveRegion(iifeValidateForm);
          const cjsLiveRegion = cjsModule.getAriaLiveRegion(cjsValidateForm);
          expect(iifeLiveRegion).toEqual(cjsLiveRegion);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: 0-0-5-registration-confirm-password-ui, Property 2: Password Input Updates Requirements and Live Region', () => {
  /**
   * **Validates: Requirements 4.1, 4.5**
   *
   * For any string typed into the password field, password-requirements text
   * equals joined policy violations and validation-announcements equals
   * getAriaLiveRegion() content.
   */

  beforeEach(() => {
    jest.useFakeTimers();
    setupPage();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  it('Property 2: password-requirements and validation-announcements update correctly on password input', () => {
    const passwordInput = document.getElementById('password-input');
    const passwordRequirements = document.getElementById('password-requirements');
    const validationAnnouncements = document.getElementById('validation-announcements');

    fc.assert(
      fc.property(
        anyString,
        (password) => {
          typeInto(passwordInput, password);

          const confirmPassword = document.getElementById('confirm-password-input').value;
          const result = window.PasswordValidator.validateForm(password, confirmPassword);
          const liveRegion = window.PasswordValidator.getAriaLiveRegion(result);

          // password-requirements should show policy violations
          const policyErrors = result.fieldErrors.password;
          if (policyErrors && policyErrors.length > 0) {
            expect(passwordRequirements.textContent).toBe(policyErrors.join('\n'));
          } else {
            expect(passwordRequirements.textContent).toBe('');
          }

          // validation-announcements should equal getAriaLiveRegion content
          expect(validationAnnouncements.textContent).toBe(liveRegion.content);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: 0-0-5-registration-confirm-password-ui, Property 3: Confirm Input Updates Match Status and Live Region', () => {
  /**
   * **Validates: Requirements 4.2, 4.6**
   *
   * For any pair where confirmPassword is non-empty, password-match-status text
   * equals match-status message and validation-announcements equals live region content.
   */

  beforeEach(() => {
    jest.useFakeTimers();
    setupPage();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  it('Property 3: password-match-status and validation-announcements update correctly on confirm input', () => {
    const passwordInput = document.getElementById('password-input');
    const confirmPasswordInput = document.getElementById('confirm-password-input');
    const passwordMatchStatus = document.getElementById('password-match-status');
    const validationAnnouncements = document.getElementById('validation-announcements');

    fc.assert(
      fc.property(
        anyString,
        nonEmptyString,
        (password, confirmPassword) => {
          // Set password first, then type into confirm
          typeInto(passwordInput, password);
          typeInto(confirmPasswordInput, confirmPassword);

          const result = window.PasswordValidator.validateForm(password, confirmPassword);
          const liveRegion = window.PasswordValidator.getAriaLiveRegion(result);

          // Determine expected match status text
          const confirmErrors = result.fieldErrors['confirm-password'];
          const policyErrors = result.fieldErrors.password;
          const hasPolicyErrors = policyErrors && policyErrors.length > 0;

          if (confirmErrors && confirmErrors.length > 0) {
            // Mismatch
            expect(passwordMatchStatus.textContent).toBe(confirmErrors.join('\n'));
          } else if (!hasPolicyErrors) {
            // Match and no policy errors
            expect(passwordMatchStatus.textContent).toBe('Passwords match');
          } else {
            // Match but policy errors exist — suppress success message
            expect(passwordMatchStatus.textContent).toBe('');
          }

          // validation-announcements should equal getAriaLiveRegion content
          expect(validationAnnouncements.textContent).toBe(liveRegion.content);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: 0-0-5-registration-confirm-password-ui, Property 4: Password Field aria-invalid Reflects Policy', () => {
  /**
   * **Validates: Requirements 4.3, 4.4**
   *
   * aria-invalid on #password-input is "true" when policy errors exist, "false" otherwise.
   */

  beforeEach(() => {
    jest.useFakeTimers();
    setupPage();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  it('Property 4: aria-invalid on password-input reflects policy validation state', () => {
    const passwordInput = document.getElementById('password-input');

    fc.assert(
      fc.property(
        anyString,
        (password) => {
          typeInto(passwordInput, password);

          const confirmPassword = document.getElementById('confirm-password-input').value;
          const result = window.PasswordValidator.validateForm(password, confirmPassword);
          const policyErrors = result.fieldErrors.password;
          const hasPolicyErrors = policyErrors && policyErrors.length > 0;

          const expectedAriaInvalid = hasPolicyErrors ? 'true' : 'false';
          expect(passwordInput.getAttribute('aria-invalid')).toBe(expectedAriaInvalid);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: 0-0-5-registration-confirm-password-ui, Property 5: Confirm Field State Reflects Match Validation', () => {
  /**
   * **Validates: Requirements 5.1, 5.3, 5.4**
   *
   * When confirm empty: aria-invalid="false" and match status empty.
   * When non-empty mismatch: aria-invalid="true" and "Passwords do not match".
   * When match + valid: aria-invalid="false" and "Passwords match".
   */

  beforeEach(() => {
    jest.useFakeTimers();
    setupPage();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  it('Property 5a: When confirm is empty, aria-invalid is "false" and match status is empty', () => {
    const passwordInput = document.getElementById('password-input');
    const confirmPasswordInput = document.getElementById('confirm-password-input');
    const passwordMatchStatus = document.getElementById('password-match-status');

    fc.assert(
      fc.property(
        anyString,
        (password) => {
          typeInto(passwordInput, password);
          typeInto(confirmPasswordInput, '');

          expect(confirmPasswordInput.getAttribute('aria-invalid')).toBe('false');
          expect(passwordMatchStatus.textContent).toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 5b: When non-empty mismatch, aria-invalid is "true" and shows "Passwords do not match"', () => {
    const passwordInput = document.getElementById('password-input');
    const confirmPasswordInput = document.getElementById('confirm-password-input');
    const passwordMatchStatus = document.getElementById('password-match-status');

    fc.assert(
      fc.property(
        nonEmptyString,
        nonEmptyString.filter(s => s.length > 0),
        (password, confirmPassword) => {
          // Ensure they don't match
          fc.pre(password !== confirmPassword);

          typeInto(passwordInput, password);
          typeInto(confirmPasswordInput, confirmPassword);

          expect(confirmPasswordInput.getAttribute('aria-invalid')).toBe('true');
          expect(passwordMatchStatus.textContent).toBe('Passwords do not match');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 5c: When passwords match and password is valid, aria-invalid is "false" and shows "Passwords match"', () => {
    const passwordInput = document.getElementById('password-input');
    const confirmPasswordInput = document.getElementById('confirm-password-input');
    const passwordMatchStatus = document.getElementById('password-match-status');

    fc.assert(
      fc.property(
        validPassword,
        (password) => {
          typeInto(passwordInput, password);
          typeInto(confirmPasswordInput, password);

          expect(confirmPasswordInput.getAttribute('aria-invalid')).toBe('false');
          expect(passwordMatchStatus.textContent).toBe('Passwords match');
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: 0-0-5-registration-confirm-password-ui, Property 6: Password Change Re-evaluates Confirm Status', () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * When password changes and confirm is non-empty, match status and aria-invalid
   * update to reflect new match state.
   */

  beforeEach(() => {
    jest.useFakeTimers();
    setupPage();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  it('Property 6: Changing password re-evaluates confirm field match status', () => {
    const passwordInput = document.getElementById('password-input');
    const confirmPasswordInput = document.getElementById('confirm-password-input');
    const passwordMatchStatus = document.getElementById('password-match-status');

    fc.assert(
      fc.property(
        anyString,
        nonEmptyString,
        anyString,
        (initialPassword, confirmPassword, newPassword) => {
          // Set initial state: type confirm first
          typeInto(passwordInput, initialPassword);
          typeInto(confirmPasswordInput, confirmPassword);

          // Now change the password
          typeInto(passwordInput, newPassword);

          // Verify the confirm field state reflects the new match state
          const result = window.PasswordValidator.validateForm(newPassword, confirmPassword);
          const confirmErrors = result.fieldErrors['confirm-password'];
          const policyErrors = result.fieldErrors.password;
          const hasPolicyErrors = policyErrors && policyErrors.length > 0;

          if (confirmErrors && confirmErrors.length > 0) {
            expect(confirmPasswordInput.getAttribute('aria-invalid')).toBe('true');
            expect(passwordMatchStatus.textContent).toBe(confirmErrors.join('\n'));
          } else if (!hasPolicyErrors) {
            expect(confirmPasswordInput.getAttribute('aria-invalid')).toBe('false');
            expect(passwordMatchStatus.textContent).toBe('Passwords match');
          } else {
            expect(confirmPasswordInput.getAttribute('aria-invalid')).toBe('false');
            expect(passwordMatchStatus.textContent).toBe('');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: 0-0-5-registration-confirm-password-ui, Property 7: Invalid Submission Blocked with Focus Management', () => {
  /**
   * **Validates: Requirements 6.1, 6.2, 6.3**
   *
   * For any pair where isReadyForSubmission returns false, form submit does not
   * call signUp, errors are displayed, and focus moves to first error field.
   */

  let signUpMock;

  beforeEach(() => {
    jest.useFakeTimers();
    setupPage();
    // Get reference to the signUp mock
    signUpMock = window.AmazonCognitoIdentity.CognitoUserPool.mock.results[0]?.value?.signUp;
    if (!signUpMock) {
      // Re-create the mock if needed
      const poolInstance = new window.AmazonCognitoIdentity.CognitoUserPool({});
      signUpMock = poolInstance.signUp;
    }
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  it('Property 7: Invalid submission does not call signUp and focuses first error field', () => {
    const passwordInput = document.getElementById('password-input');
    const confirmPasswordInput = document.getElementById('confirm-password-input');
    const emailInput = document.getElementById('email');
    const form = document.getElementById('register-form');
    const registerError = document.getElementById('register-error');

    fc.assert(
      fc.property(
        nonEmptyString,
        anyString,
        (password, confirmPassword) => {
          // Ensure the pair is NOT ready for submission
          fc.pre(!window.PasswordValidator.isReadyForSubmission(password, confirmPassword));

          // Reset state
          emailInput.value = 'test@example.com';
          typeInto(passwordInput, password);
          typeInto(confirmPasswordInput, confirmPassword);

          // Clear any previous signUp call tracking
          const signUpCallsBefore = window.AmazonCognitoIdentity.CognitoUserPool.mock.results
            .filter(r => r?.value?.signUp)
            .reduce((count, r) => count + r.value.signUp.mock.calls.length, 0);

          // Submit the form
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

          // signUp should NOT have been called (check no new calls)
          const signUpCallsAfter = window.AmazonCognitoIdentity.CognitoUserPool.mock.results
            .filter(r => r?.value?.signUp)
            .reduce((count, r) => count + r.value.signUp.mock.calls.length, 0);
          expect(signUpCallsAfter).toBe(signUpCallsBefore);

          // Validate error display and focus management
          const result = window.PasswordValidator.validateForm(password, confirmPassword);
          const firstErrorField = window.PasswordValidator.getFirstErrorField(result);

          if (result.errors.length > 0) {
            // When validateForm returns errors, they should be displayed
            expect(registerError.textContent.length).toBeGreaterThan(0);
          }

          // Focus should be on the first error field (if one exists)
          if (firstErrorField) {
            expect(document.activeElement.id).toBe(firstErrorField);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: 0-0-5-registration-confirm-password-ui, Property 8: Valid Submission Proceeds with Password Value', () => {
  /**
   * **Validates: Requirements 6.5, 8.2**
   *
   * For any valid matching password pair, signUp is called with #password-input value.
   */

  beforeEach(() => {
    jest.useFakeTimers();
    setupPage();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  it('Property 8: Valid submission calls signUp with the password-input value', () => {
    const passwordInput = document.getElementById('password-input');
    const confirmPasswordInput = document.getElementById('confirm-password-input');
    const emailInput = document.getElementById('email');
    const form = document.getElementById('register-form');

    fc.assert(
      fc.property(
        validPassword,
        (password) => {
          // Set up valid state
          emailInput.value = 'test@example.com';
          typeInto(passwordInput, password);
          typeInto(confirmPasswordInput, password);

          // Get the signUp mock from the pool instance
          // The page script creates a userPool, so we need to track the mock
          const poolInstance = window.AmazonCognitoIdentity.CognitoUserPool.mock.results[0]?.value;
          if (!poolInstance) return; // Skip if pool wasn't created

          const signUpMock = poolInstance.signUp;
          const callsBefore = signUpMock.mock.calls.length;

          // Submit the form
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

          // signUp should have been called
          const callsAfter = signUpMock.mock.calls.length;
          expect(callsAfter).toBe(callsBefore + 1);

          // The second argument to signUp should be the password value
          const lastCall = signUpMock.mock.calls[callsAfter - 1];
          expect(lastCall[1]).toBe(password);
        }
      ),
      { numRuns: 100 }
    );
  });
});
