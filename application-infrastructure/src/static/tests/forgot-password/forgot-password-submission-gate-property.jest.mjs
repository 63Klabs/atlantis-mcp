/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { resolve } from 'path';
import fc from 'fast-check';
import { loadPage, executePageScripts } from '../helpers/load-page.mjs';

/**
 * Property-based test for the forgot-password confirm-step submission gate.
 *
 * **Property 6: Submission gate**
 * **Validates: Requirements 3.4, 4.3, 12.4**
 *
 * For any pair (password, confirmPassword) where isReadyForSubmission() returns
 * false, submitting the confirm step calls confirmPassword() zero times and focus
 * lands on getFirstErrorField(result).
 *
 * All timing uses Jest fake timers. No child processes. 100 runs.
 */

const HTML_PATH = resolve(
  import.meta.dirname,
  '../../public/forgot-password/index.html'
);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a non-empty verification code string (numeric-ish, as the form field
 * accepts). The exact content does not matter for the gate test — only that it is
 * non-empty so the code validation passes and the validator gate is what blocks
 * the submission.
 */
const nonEmptyCode = fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0);

/**
 * Generates any string for the password field.
 */
const anyString = fc.string({ minLength: 0, maxLength: 100 });

/**
 * Generates any string for the confirm-password field.
 */
const anyConfirmString = fc.string({ minLength: 0, maxLength: 100 });

// ---------------------------------------------------------------------------
// Page setup helpers
// ---------------------------------------------------------------------------

/**
 * Install the Cognito mock, load the forgot-password page, and execute its
 * scripts in the current jsdom document.
 *
 * Returns the `confirmPassword` mock so tests can assert on call counts.
 *
 * @returns {jest.Mock} confirmPasswordMock
 */
function setupPage() {
  const confirmPasswordMock = jest.fn();

  window.AmazonCognitoIdentity = {
    CognitoUserPool: jest.fn().mockImplementation(() => ({
      signUp: jest.fn(),
      getCurrentUser: jest.fn(),
    })),
    CognitoUser: jest.fn().mockImplementation(() => ({
      forgotPassword:         jest.fn(),
      confirmPassword:        confirmPasswordMock,
      resendConfirmationCode: jest.fn(),
      changePassword:         jest.fn(),
      authenticateUser:       jest.fn(),
      getCurrentUser:         jest.fn(),
      getSession:             jest.fn(),
    })),
    CognitoUserAttribute: jest.fn().mockImplementation((data) => data),
    AuthenticationDetails: jest.fn().mockImplementation((data) => data),
  };

  const html = loadPage(HTML_PATH);
  document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  executePageScripts(html, HTML_PATH);

  return confirmPasswordMock;
}

/**
 * Submit the request-step form to advance the page to the confirm step.
 * Uses `inputVerificationCode` callback (the normal SDK path) so the confirm
 * step becomes visible and the initial resend timer starts.
 *
 * The forgotPassword mock on the page's CognitoUser instance is configured to
 * fire the callback immediately.  After this call the confirm step is visible.
 *
 * @param {string} [email='gate-test@example.com']
 */
function advanceToConfirmStep(email = 'gate-test@example.com') {
  // Replace forgotPassword on every CognitoUser with one that fires success.
  const forgotPasswordImpl = jest.fn().mockImplementation(function(callbacks) {
    if (typeof callbacks.inputVerificationCode === 'function') {
      callbacks.inputVerificationCode();
    } else if (typeof callbacks.onSuccess === 'function') {
      callbacks.onSuccess();
    }
  });

  // Re-wire forgotPassword on all future CognitoUser instances (the page has
  // already set up its pool so we patch the constructor return value).
  window.AmazonCognitoIdentity.CognitoUser.mockImplementation(() => ({
    forgotPassword:         forgotPasswordImpl,
    confirmPassword:        jest.fn(), // will be replaced after advance
    resendConfirmationCode: jest.fn(),
    changePassword:         jest.fn(),
    authenticateUser:       jest.fn(),
    getCurrentUser:         jest.fn(),
    getSession:             jest.fn(),
  }));

  const emailInput = document.getElementById('email');
  emailInput.value = email;

  const resetForm = document.getElementById('reset-form');
  resetForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/**
 * Install a fresh confirmPassword mock on every CognitoUser instantiated from
 * this point on, and return the new mock.  Call this after advanceToConfirmStep
 * so the confirm-step's CognitoUser construction picks it up.
 *
 * @returns {jest.Mock} confirmPasswordMock
 */
function installFreshConfirmMock() {
  const confirmPasswordMock = jest.fn();

  window.AmazonCognitoIdentity.CognitoUser.mockImplementation(() => ({
    forgotPassword:         jest.fn(),
    confirmPassword:        confirmPasswordMock,
    resendConfirmationCode: jest.fn(),
    changePassword:         jest.fn(),
    authenticateUser:       jest.fn(),
    getCurrentUser:         jest.fn(),
    getSession:             jest.fn(),
  }));

  return confirmPasswordMock;
}

/**
 * Simulate typing into an input field by setting the value and dispatching an
 * `input` event so the page IIFE's real-time validation listeners fire.
 *
 * @param {HTMLInputElement} element
 * @param {string} value
 */
function typeInto(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe('Feature: 0-0-6-password-reset, Property 6: Submission gate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  it(
    'Property 6: For any (password, confirmPassword) where isReadyForSubmission() ' +
    'is false, submitting the confirm step calls confirmPassword() zero times ' +
    'and focus lands on getFirstErrorField(result)',
    () => {
      fc.assert(
        fc.property(
          nonEmptyCode,
          anyString,
          anyConfirmString,
          (code, password, confirmPassword) => {
            // ---- 1. Fresh page per property run ----
            document.body.innerHTML = '';
            delete window.AmazonCognitoIdentity;
            delete window.PasswordValidator;

            setupPage();

            // Pre-condition: this property only applies when the validator
            // blocks submission.  Check AFTER setupPage() so window.PasswordValidator
            // is available from the shared asset executed by executePageScripts().
            fc.pre(!window.PasswordValidator.isReadyForSubmission(password, confirmPassword));

            // ---- 2. Advance to the confirm step ----
            advanceToConfirmStep();

            // Install a fresh confirmPassword mock that the confirm step will use
            // when it creates its own CognitoUser from the retained submittedEmail.
            const confirmPasswordMock = installFreshConfirmMock();

            // ---- 3. Fill in the confirm-step fields ----
            const codeInput     = document.getElementById('verification-code');
            const passwordInput = document.getElementById('password-input');
            const confirmInput  = document.getElementById('confirm-password-input');

            codeInput.value = code;           // non-empty, passes the empty-code check
            typeInto(passwordInput, password);
            typeInto(confirmInput, confirmPassword);

            // ---- 4. Submit the confirm form ----
            const confirmForm = document.getElementById('confirm-form');
            confirmForm.dispatchEvent(
              new Event('submit', { bubbles: true, cancelable: true })
            );

            // ---- 5. Assert: confirmPassword() was NOT called ----
            expect(confirmPasswordMock).toHaveBeenCalledTimes(0);

            // ---- 6. Assert: focus is on getFirstErrorField(result) ----
            const result = window.PasswordValidator.validateForm(password, confirmPassword);
            const firstErrorField = window.PasswordValidator.getFirstErrorField(result);

            if (firstErrorField !== null) {
              expect(document.activeElement.id).toBe(firstErrorField);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
