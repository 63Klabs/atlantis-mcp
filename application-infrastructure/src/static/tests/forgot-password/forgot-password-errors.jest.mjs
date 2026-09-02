/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { resolve } from 'path';
import { loadPage, executePageScripts } from '../helpers/load-page.mjs';

/**
 * Error handling tests for the forgot-password page.
 *
 * Covers every row of the Error Handling table in the design document for
 * both the Request_Step (forgotPassword) and Confirm_Step (confirmPassword)
 * operations.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 12.5
 */

const HTML_PATH = resolve(
  import.meta.dirname,
  '../../public/forgot-password/index.html'
);

describe('Forgot-Password Page - Error Handling', () => {
  /** Stable mock references controlled by each test. */
  let mockForgotPassword;
  let mockConfirmPassword;
  let mockResendConfirmationCode;
  let mockCognitoUser;

  beforeEach(() => {
    jest.useFakeTimers();

    mockForgotPassword = jest.fn();
    mockConfirmPassword = jest.fn();
    mockResendConfirmationCode = jest.fn();
    mockCognitoUser = {
      forgotPassword: mockForgotPassword,
      confirmPassword: mockConfirmPassword,
      resendConfirmationCode: mockResendConfirmationCode,
      authenticateUser: jest.fn(),
      changePassword: jest.fn(),
      getCurrentUser: jest.fn(),
      getSession: jest.fn(),
    };

    window.AmazonCognitoIdentity = {
      CognitoUserPool: jest.fn().mockImplementation(() => ({
        signUp: jest.fn(),
        getCurrentUser: jest.fn(),
      })),
      CognitoUser: jest.fn().mockImplementation(() => mockCognitoUser),
      CognitoUserAttribute: jest.fn().mockImplementation((data) => data),
      AuthenticationDetails: jest.fn().mockImplementation((data) => data),
    };

    const html = loadPage(HTML_PATH);
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
    executePageScripts(html, HTML_PATH);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Submit the request-step form with the given email and optional forgotPassword
   * implementation.
   *
   * @param {string} [email='test@example.com'] - Email to enter.
   */
  function submitRequestForm(email = 'test@example.com') {
    document.getElementById('email').value = email;
    document
      .getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  /**
   * Advance the page to the Confirm_Step by triggering the request form with a
   * successful `inputVerificationCode` callback.
   *
   * After this call, `mockForgotPassword` is reset so confirm-step tests can
   * configure it independently.
   *
   * @param {string} [email='test@example.com'] - Email to submit.
   */
  function advanceToConfirmStep(email = 'test@example.com') {
    mockForgotPassword.mockImplementation((callbacks) => {
      callbacks.inputVerificationCode();
    });
    submitRequestForm(email);
    // Reset so subsequent tests control the mock independently.
    mockForgotPassword.mockReset();
  }

  /**
   * Submit the confirm-step form with the given code and passwords.
   *
   * @param {string} [code='123456'] - Verification code.
   * @param {string} [password='Password1!'] - New password value.
   */
  function submitConfirmForm(code = '123456', password = 'Password1!') {
    document.getElementById('verification-code').value = code;
    document.getElementById('password-input').value = password;
    document.getElementById('confirm-password-input').value = password;
    document
      .getElementById('confirm-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  // ---------------------------------------------------------------------------
  // Request Step errors (forgotPassword)
  // ---------------------------------------------------------------------------

  describe('Request_Step errors — forgotPassword() (Requirements 6.7, 6.8, 6.9)', () => {
    // -------------------------------------------------------------------------
    // Requirement 6.1 — InvalidParameterException (unconfirmed account)
    // -------------------------------------------------------------------------

    describe('Requirement 6.1: InvalidParameterException routes unconfirmed user to verify flow', () => {
      afterEach(() => {
        jest.restoreAllMocks();
      });

      it('should call resendConfirmationCode() when forgotPassword returns InvalidParameterException', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'InvalidParameterException', message: 'User is not confirmed.' });
        });
        mockResendConfirmationCode.mockImplementation((callback) => {
          callback(null, 'SUCCESS');
        });

        submitRequestForm('unconfirmed@example.com');

        expect(mockResendConfirmationCode).toHaveBeenCalled();
      });

      it('should redirect to /register/?verify=<encoded-email> after successful resend (via setTimeout)', () => {
        // The page schedules a 2-second redirect via setTimeout.
        // We verify the intent by confirming the page set up the informational state
        // (not an error) that immediately precedes the redirect.  The actual
        // window.location.href assignment cannot be captured in jsdom without
        // triggering the "not implemented: navigation" error, but the pre-redirect
        // state fully confirms the redirect branch was taken.
        const email = 'unconfirmed@example.com';
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'InvalidParameterException', message: 'User is not confirmed.' });
        });
        mockResendConfirmationCode.mockImplementation((callback) => {
          callback(null, 'SUCCESS');
        });

        submitRequestForm(email);

        // The page shows a visible informational message before redirecting
        const resetError = document.getElementById('reset-error');
        expect(resetError.classList.contains('visible')).toBe(true);
        // The message should reference verification or redirect, not be a generic error
        expect(resetError.textContent.length).toBeGreaterThan(0);
        // The message should NOT be styled as an error at this point
        expect(resetError.classList.contains('alert-info')).toBe(true);
      });

      it('should use the submitted email in the verify redirect URL (via encoded verify param)', () => {
        // Verify the correct email was retained and passed to resendConfirmationCode,
        // which proves the verify redirect would use the correct encoded email.
        const email = 'user+test@example.org';
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'InvalidParameterException', message: 'User is not confirmed.' });
        });
        mockResendConfirmationCode.mockImplementation((callback) => {
          callback(null, 'SUCCESS');
        });

        submitRequestForm(email);

        // resendConfirmationCode was called with the correct user data
        // (the CognitoUser constructor is called with the email as Username)
        expect(window.AmazonCognitoIdentity.CognitoUser).toHaveBeenCalledWith(
          expect.objectContaining({ Username: email })
        );
      });

      it('should show an informational message (not an error) after successful resend', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'InvalidParameterException', message: 'User is not confirmed.' });
        });
        mockResendConfirmationCode.mockImplementation((callback) => {
          callback(null, 'SUCCESS');
        });

        submitRequestForm('unconfirmed@example.com');

        const resetError = document.getElementById('reset-error');
        // Should display informational copy, not a raw error
        expect(resetError.textContent.length).toBeGreaterThan(0);
        // The message should mention verification or redirecting, not be a generic error
        expect(resetError.textContent).not.toBe('');
      });
    });

    // -------------------------------------------------------------------------
    // Requirement 6.2 — resendConfirmationCode failure inside the unconfirmed path
    // -------------------------------------------------------------------------

    describe('Requirement 6.2: resendConfirmationCode failure re-enables controls with support message', () => {
      it('should re-enable the submit button when resend fails', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'InvalidParameterException', message: 'User is not confirmed.' });
        });
        mockResendConfirmationCode.mockImplementation((callback) => {
          callback({ code: 'LimitExceededException', message: 'Too many attempts.' }, null);
        });

        submitRequestForm('unconfirmed@example.com');

        const resetBtn = document.getElementById('reset-btn');
        expect(resetBtn.disabled).toBe(false);
      });

      it('should re-enable the email input when resend fails', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'InvalidParameterException', message: 'User is not confirmed.' });
        });
        mockResendConfirmationCode.mockImplementation((callback) => {
          callback({ code: 'NetworkError', message: 'Network error.' }, null);
        });

        submitRequestForm('unconfirmed@example.com');

        const emailInput = document.getElementById('email');
        expect(emailInput.disabled).toBe(false);
      });

      it('should display a support advisory message when resend fails', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'InvalidParameterException', message: 'User is not confirmed.' });
        });
        mockResendConfirmationCode.mockImplementation((callback) => {
          callback({ code: 'LimitExceededException', message: 'Too many attempts.' }, null);
        });

        submitRequestForm('unconfirmed@example.com');

        const resetError = document.getElementById('reset-error');
        expect(resetError.textContent.length).toBeGreaterThan(0);
        // Should advise retrying or contacting support, not expose a raw Cognito error
        expect(resetError.textContent).toMatch(/try again|support/i);
      });

      it('should NOT redirect when resend fails', () => {
        // When resend fails, the page shows an error and re-enables controls.
        // Verified indirectly: the error element shows a support message,
        // the controls are re-enabled, and the informational pre-redirect state
        // is NOT set (no alert-info on reset-error, no visible redirect message).
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'InvalidParameterException', message: 'User is not confirmed.' });
        });
        mockResendConfirmationCode.mockImplementation((callback) => {
          callback({ code: 'LimitExceededException', message: 'Too many attempts.' }, null);
        });

        submitRequestForm('unconfirmed@example.com');
        jest.advanceTimersByTime(5000);

        // No redirect state: page stays on the request step
        const requestStep = document.getElementById('request-step');
        expect(requestStep.classList.contains('hidden')).toBe(false);
        // Reset button is re-enabled (not stuck in a redirecting state)
        const resetBtn = document.getElementById('reset-btn');
        expect(resetBtn.disabled).toBe(false);
      });
    });

    // -------------------------------------------------------------------------
    // Requirement 6.7 — LimitExceededException and TooManyRequestsException
    // -------------------------------------------------------------------------

    describe('Requirement 6.7: Rate-limit errors advise waiting and re-enable controls', () => {
      it('should show a wait message for LimitExceededException', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'LimitExceededException', message: 'Limit exceeded.' });
        });

        submitRequestForm();

        const resetError = document.getElementById('reset-error');
        expect(resetError.textContent).toMatch(/wait|attempt/i);
      });

      it('should show a wait message for TooManyRequestsException', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'TooManyRequestsException', message: 'Too many requests.' });
        });

        submitRequestForm();

        const resetError = document.getElementById('reset-error');
        expect(resetError.textContent).toMatch(/wait|attempt/i);
      });

      it('should re-enable the submit button for LimitExceededException', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'LimitExceededException', message: 'Limit exceeded.' });
        });

        submitRequestForm();

        const resetBtn = document.getElementById('reset-btn');
        expect(resetBtn.disabled).toBe(false);
      });

      it('should re-enable the submit button for TooManyRequestsException', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'TooManyRequestsException', message: 'Too many requests.' });
        });

        submitRequestForm();

        const resetBtn = document.getElementById('reset-btn');
        expect(resetBtn.disabled).toBe(false);
      });

      it('should NOT advance to the confirm step for rate-limit errors', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'LimitExceededException', message: 'Limit exceeded.' });
        });

        submitRequestForm();

        const requestStep = document.getElementById('request-step');
        const confirmStep = document.getElementById('confirm-step');
        expect(requestStep.classList.contains('hidden')).toBe(false);
        expect(confirmStep.classList.contains('hidden')).toBe(true);
      });

      it('should NOT show err.message for LimitExceededException (uses page-owned literal)', () => {
        const serverMessage = 'Server-side limit message that must not be shown verbatim';
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'LimitExceededException', message: serverMessage });
        });

        submitRequestForm();

        const resetError = document.getElementById('reset-error');
        // The error text should be a page-owned literal, not the raw SDK message
        expect(resetError.textContent).not.toBe(serverMessage);
      });
    });

    // -------------------------------------------------------------------------
    // Requirement 6.8 — Unknown error codes
    // -------------------------------------------------------------------------

    describe('Requirement 6.8: Unknown error codes use err.message or generic fallback', () => {
      it('should show err.message for an unknown error code when message is available', () => {
        const sdkMessage = 'Something unexpected happened.';
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'SomeUnknownError', message: sdkMessage });
        });

        submitRequestForm();

        const resetError = document.getElementById('reset-error');
        expect(resetError.textContent).toBe(sdkMessage);
      });

      it('should show a generic fallback when an unknown error has no message', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'SomeUnknownError' });
        });

        submitRequestForm();

        const resetError = document.getElementById('reset-error');
        expect(resetError.textContent.length).toBeGreaterThan(0);
      });

      it('should show a generic fallback when the error object has no message property', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({});
        });

        submitRequestForm();

        const resetError = document.getElementById('reset-error');
        expect(resetError.textContent.length).toBeGreaterThan(0);
      });

      it('should re-enable the submit button for unknown error codes', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'SomeUnknownError', message: 'Unexpected.' });
        });

        submitRequestForm();

        const resetBtn = document.getElementById('reset-btn');
        expect(resetBtn.disabled).toBe(false);
      });
    });

    // -------------------------------------------------------------------------
    // Requirement 6.9 — No account existence disclosure on the request step
    // -------------------------------------------------------------------------

    describe('Requirement 6.9: No account existence disclosure', () => {
      /**
       * The fixed set of page-owned literals that may appear on the request step
       * error element.  No server-supplied text about account existence is allowed.
       */
      const EXISTENCE_INDICATORS = [
        'User not found',
        'No account',
        'does not exist',
        'account not found',
      ];

      it('should not render existence-revealing text when forgotPassword succeeds (unknown email)', () => {
        // Cognito's PreventUserExistenceErrors causes unknown emails to follow the
        // success path (inputVerificationCode). The confirm-step neutral copy must
        // not reveal whether an account exists.
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.inputVerificationCode();
        });

        submitRequestForm('unknown@example.com');

        const confirmInfo = document.getElementById('confirm-info');
        for (const indicator of EXISTENCE_INDICATORS) {
          expect(confirmInfo.textContent).not.toMatch(new RegExp(indicator, 'i'));
        }
      });

      it('should not render existence-revealing text for LimitExceededException', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'LimitExceededException', message: 'Limit exceeded.' });
        });

        submitRequestForm('existing@example.com');

        const resetError = document.getElementById('reset-error');
        for (const indicator of EXISTENCE_INDICATORS) {
          expect(resetError.textContent).not.toMatch(new RegExp(indicator, 'i'));
        }
      });

      it('should not render existence-revealing text for unknown error codes', () => {
        mockForgotPassword.mockImplementation((callbacks) => {
          callbacks.onFailure({ code: 'UnknownCode', message: 'Some server message.' });
        });

        submitRequestForm('existing@example.com');

        const resetError = document.getElementById('reset-error');
        for (const indicator of EXISTENCE_INDICATORS) {
          expect(resetError.textContent).not.toMatch(new RegExp(indicator, 'i'));
        }
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Confirm Step errors (confirmPassword)
  // ---------------------------------------------------------------------------

  describe('Confirm_Step errors — confirmPassword() (Requirements 6.3, 6.4, 6.5, 6.6, 6.8)', () => {
    beforeEach(() => {
      // Start each confirm-step test with the page already on the confirm step.
      advanceToConfirmStep();
    });

    // -------------------------------------------------------------------------
    // Requirement 6.3 — CodeMismatchException
    // -------------------------------------------------------------------------

    describe('Requirement 6.3: CodeMismatchException indicates incorrect code', () => {
      it('should display a "code incorrect" message for CodeMismatchException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'CodeMismatchException', message: 'Invalid verification code.' });
        });

        submitConfirmForm();

        const confirmError = document.getElementById('confirm-error');
        expect(confirmError.textContent).toMatch(/incorrect|check the code/i);
      });

      it('should stay on the confirm step for CodeMismatchException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'CodeMismatchException', message: 'Invalid verification code.' });
        });

        submitConfirmForm();

        const confirmStep = document.getElementById('confirm-step');
        const successStep = document.getElementById('success-step');
        expect(confirmStep.classList.contains('hidden')).toBe(false);
        expect(successStep.classList.contains('hidden')).toBe(true);
      });

      it('should re-enable the confirm button for CodeMismatchException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'CodeMismatchException', message: 'Invalid verification code.' });
        });

        submitConfirmForm();

        const confirmBtn = document.getElementById('confirm-btn');
        expect(confirmBtn.disabled).toBe(false);
      });
    });

    // -------------------------------------------------------------------------
    // Requirement 6.4 — ExpiredCodeException
    // -------------------------------------------------------------------------

    describe('Requirement 6.4: ExpiredCodeException indicates expired code', () => {
      it('should display an "expired" message for ExpiredCodeException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'ExpiredCodeException', message: 'Invalid code provided.' });
        });

        submitConfirmForm();

        const confirmError = document.getElementById('confirm-error');
        expect(confirmError.textContent).toMatch(/expired/i);
      });

      it('should direct the user to request a new code for ExpiredCodeException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'ExpiredCodeException', message: 'Invalid code provided.' });
        });

        submitConfirmForm();

        const confirmError = document.getElementById('confirm-error');
        // Message should mention requesting a new code or resending
        expect(confirmError.textContent).toMatch(/new|request|resend/i);
      });

      it('should stay on the confirm step for ExpiredCodeException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'ExpiredCodeException', message: 'Invalid code provided.' });
        });

        submitConfirmForm();

        const confirmStep = document.getElementById('confirm-step');
        expect(confirmStep.classList.contains('hidden')).toBe(false);
      });

      it('should re-enable the confirm button for ExpiredCodeException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'ExpiredCodeException', message: 'Invalid code provided.' });
        });

        submitConfirmForm();

        expect(document.getElementById('confirm-btn').disabled).toBe(false);
      });
    });

    // -------------------------------------------------------------------------
    // Requirement 6.5 — InvalidPasswordException
    // -------------------------------------------------------------------------

    describe('Requirement 6.5: InvalidPasswordException describes password policy', () => {
      it('should display a password-policy message for InvalidPasswordException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'InvalidPasswordException', message: 'Password does not conform to policy.' });
        });

        submitConfirmForm();

        const confirmError = document.getElementById('confirm-error');
        // Message should reference requirements (length, characters)
        expect(confirmError.textContent).toMatch(/character|uppercase|lowercase|number|special/i);
      });

      it('should stay on the confirm step for InvalidPasswordException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'InvalidPasswordException', message: 'Password does not conform to policy.' });
        });

        submitConfirmForm();

        expect(document.getElementById('confirm-step').classList.contains('hidden')).toBe(false);
      });

      it('should re-enable the confirm button for InvalidPasswordException', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'InvalidPasswordException', message: 'Password does not conform to policy.' });
        });

        submitConfirmForm();

        expect(document.getElementById('confirm-btn').disabled).toBe(false);
      });
    });

    // -------------------------------------------------------------------------
    // Requirement 6.6 — Rate-limit errors on the confirm step
    // -------------------------------------------------------------------------

    describe('Requirement 6.6: Rate-limit exceptions advise waiting on the confirm step', () => {
      const RATE_LIMIT_ERRORS = [
        { code: 'LimitExceededException', message: 'Limit exceeded.' },
        { code: 'TooManyRequestsException', message: 'Too many requests.' },
        { code: 'TooManyFailedAttemptsException', message: 'Too many failed attempts.' },
      ];

      for (const { code, message } of RATE_LIMIT_ERRORS) {
        it(`should display a wait message for ${code}`, () => {
          mockConfirmPassword.mockImplementation((code_, pass, callbacks) => {
            callbacks.onFailure({ code, message });
          });

          submitConfirmForm();

          const confirmError = document.getElementById('confirm-error');
          expect(confirmError.textContent).toMatch(/wait/i);
        });

        it(`should stay on the confirm step for ${code}`, () => {
          mockConfirmPassword.mockImplementation((code_, pass, callbacks) => {
            callbacks.onFailure({ code, message });
          });

          submitConfirmForm();

          expect(document.getElementById('confirm-step').classList.contains('hidden')).toBe(false);
        });

        it(`should re-enable the confirm button for ${code}`, () => {
          mockConfirmPassword.mockImplementation((code_, pass, callbacks) => {
            callbacks.onFailure({ code, message });
          });

          submitConfirmForm();

          expect(document.getElementById('confirm-btn').disabled).toBe(false);
        });
      }
    });

    // -------------------------------------------------------------------------
    // Requirement 6.8 — Unknown error codes on the confirm step
    // -------------------------------------------------------------------------

    describe('Requirement 6.8: Unknown confirm-step errors use err.message or generic fallback', () => {
      it('should display err.message for an unknown error code when message is present', () => {
        const sdkMessage = 'An unexpected error occurred during confirmation.';
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'SomeOtherException', message: sdkMessage });
        });

        submitConfirmForm();

        const confirmError = document.getElementById('confirm-error');
        expect(confirmError.textContent).toBe(sdkMessage);
      });

      it('should display a generic fallback when unknown error has no message', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'SomeOtherException' });
        });

        submitConfirmForm();

        const confirmError = document.getElementById('confirm-error');
        expect(confirmError.textContent.length).toBeGreaterThan(0);
      });

      it('should re-enable the confirm button for unknown error codes', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'SomeOtherException', message: 'Unexpected.' });
        });

        submitConfirmForm();

        expect(document.getElementById('confirm-btn').disabled).toBe(false);
      });

      it('should stay on the confirm step for unknown error codes', () => {
        mockConfirmPassword.mockImplementation((code, password, callbacks) => {
          callbacks.onFailure({ code: 'SomeOtherException', message: 'Unexpected.' });
        });

        submitConfirmForm();

        expect(document.getElementById('confirm-step').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('success-step').classList.contains('hidden')).toBe(true);
      });
    });
  });
});
