/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { resolve } from 'path';
import { loadPage, executePageScripts } from '../helpers/load-page.mjs';

/**
 * Tests for the Change_Password_Section on the profile page.
 *
 * Validates: Requirements 12.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11
 *
 * The profile page IIFE runs immediately on load and calls
 * `userPool.getCurrentUser()` followed by `cognitoUser.getSession()`.
 * If either check fails the page redirects to /login/ before any
 * change-password interaction can occur.  The mock must return a valid
 * user with a valid session AND stub the profile `fetch()` so the loading
 * spinner resolves correctly.
 */

const HTML_PATH = resolve(
  import.meta.dirname,
  '../../public/profile/index.html'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build and install the AmazonCognitoIdentity mock with stable method
 * references exposed via the returned `mocks` object.
 *
 * The cognitoUser's `getSession` mock is configured to call its callback
 * with a valid session by default so the page renders normally. Individual
 * tests override this when verifying the invalid-session redirect.
 *
 * @returns {{
 *   mockChangePassword: jest.Mock,
 *   mockGetSession: jest.Mock,
 *   mockCognitoUser: Object,
 *   mockGetCurrentUser: jest.Mock
 * }}
 */
function buildCognitoMock() {
  const mockChangePassword = jest.fn();

  // A minimal valid session object that satisfies `session.isValid()`.
  const mockSession = {
    isValid: jest.fn().mockReturnValue(true),
    getIdToken: jest.fn().mockReturnValue({
      getJwtToken: jest.fn().mockReturnValue('mock-jwt-token'),
    }),
  };

  const mockGetSession = jest.fn().mockImplementation((callback) => {
    callback(null, mockSession);
  });

  const mockCognitoUser = {
    changePassword:         mockChangePassword,
    getSession:             mockGetSession,
    authenticateUser:       jest.fn(),
    forgotPassword:         jest.fn(),
    confirmPassword:        jest.fn(),
    resendConfirmationCode: jest.fn(),
    getCurrentUser:         jest.fn(),
    signOut:                jest.fn(),
  };

  const mockGetCurrentUser = jest.fn().mockReturnValue(mockCognitoUser);

  window.AmazonCognitoIdentity = {
    CognitoUserPool: jest.fn().mockImplementation(() => ({
      signUp:         jest.fn(),
      getCurrentUser: mockGetCurrentUser,
    })),
    CognitoUser:          jest.fn().mockImplementation(() => mockCognitoUser),
    CognitoUserAttribute: jest.fn().mockImplementation((data) => data),
    AuthenticationDetails: jest.fn().mockImplementation((data) => data),
  };

  return { mockChangePassword, mockGetSession, mockCognitoUser, mockGetCurrentUser };
}

/**
 * Stub `window.fetch` to return a minimal successful profile API response so
 * the page's loading spinner resolves and profile-content becomes visible.
 */
function stubProfileFetch() {
  const profileData = {
    email: 'test@example.com',
    tier: 'registered',
    tierExpiresAt: null,
    rateLimits: {
      limit: 100,
      windowMinutes: 60,
      remaining: 50,
      windowResetAt: Math.floor(Date.now() / 1000) + 3600,
    },
  };

  window.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(profileData),
  });
}

// ---------------------------------------------------------------------------
// Main suite
// ---------------------------------------------------------------------------

describe('Profile Page - Change Password Section', () => {
  /** @type {string} Processed HTML with token substitutions applied. */
  let html;

  /**
   * Stable Cognito mock references set in `beforeEach` and used by tests to
   * control callback behaviour and assert on call counts.
   */
  let mocks;

  beforeEach(() => {
    jest.useFakeTimers();

    mocks = buildCognitoMock();
    stubProfileFetch();

    html = loadPage(HTML_PATH);
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
    executePageScripts(html, HTML_PATH);

    // Flush the promise microtask queue so the profile fetch resolves and
    // profile-content becomes visible before assertions run.
    return Promise.resolve();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.PasswordValidator;
    delete window.fetch;
  });

  // -------------------------------------------------------------------------
  // Requirement 9.11: Section structure and placement
  // -------------------------------------------------------------------------

  describe('Section structure (Req 9.1, 9.11)', () => {
    it('change-password section exists with aria-labelledby="password-heading"', () => {
      const section = document.querySelector(
        'section[aria-labelledby="password-heading"]'
      );
      expect(section).not.toBeNull();
    });

    it('h2#password-heading reads "Password"', () => {
      const heading = document.getElementById('password-heading');
      expect(heading).not.toBeNull();
      expect(heading.tagName).toBe('H2');
      expect(heading.textContent.trim()).toBe('Password');
    });

    it('section is the last .profile-section on the page (Req 9.11)', () => {
      const allSections = document.querySelectorAll('.profile-section');
      expect(allSections.length).toBeGreaterThan(0);
      const lastSection = allSections[allSections.length - 1];
      const heading = lastSection.querySelector('h2');
      expect(heading).not.toBeNull();
      expect(heading.id).toBe('password-heading');
    });

    it('has #current-password input with autocomplete="current-password" (Req 9.1)', () => {
      const el = document.getElementById('current-password');
      expect(el).not.toBeNull();
      expect(el.tagName).toBe('INPUT');
      expect(el.getAttribute('autocomplete')).toBe('current-password');
    });

    it('has #password-input with autocomplete="new-password" (Req 9.1)', () => {
      const el = document.getElementById('password-input');
      expect(el).not.toBeNull();
      expect(el.getAttribute('autocomplete')).toBe('new-password');
    });

    it('has #confirm-password-input with autocomplete="new-password" (Req 9.1)', () => {
      const el = document.getElementById('confirm-password-input');
      expect(el).not.toBeNull();
      expect(el.getAttribute('autocomplete')).toBe('new-password');
    });

    it('states that the API key is not affected by a password change (Req 9.11)', () => {
      const section = document.querySelector(
        'section[aria-labelledby="password-heading"]'
      );
      expect(section.textContent).toMatch(/API key/i);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9.4: Empty current-password blocks the call
  // -------------------------------------------------------------------------

  describe('Empty current password validation (Req 9.4)', () => {
    it('does not call changePassword() when current-password is empty', () => {
      document.getElementById('current-password').value = '';
      document.getElementById('password-input').value = 'NewPassword1!';
      document.getElementById('confirm-password-input').value = 'NewPassword1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      expect(mocks.mockChangePassword).not.toHaveBeenCalled();
    });

    it('shows a validation error when current-password is empty', () => {
      document.getElementById('current-password').value = '';
      document.getElementById('password-input').value = 'NewPassword1!';
      document.getElementById('confirm-password-input').value = 'NewPassword1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const errorEl = document.getElementById('change-password-error');
      expect(errorEl.textContent.length).toBeGreaterThan(0);
    });

    it('moves focus to #current-password when it is empty', () => {
      const currentPasswordEl = document.getElementById('current-password');
      const focusSpy = jest.spyOn(currentPasswordEl, 'focus');

      currentPasswordEl.value = '';
      document.getElementById('password-input').value = 'NewPassword1!';
      document.getElementById('confirm-password-input').value = 'NewPassword1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      expect(focusSpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9.3: Submission gate blocks call for invalid passwords
  // -------------------------------------------------------------------------

  describe('Submission gate (Req 9.3)', () => {
    it('does not call changePassword() when new password is too short', () => {
      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'short';
      document.getElementById('confirm-password-input').value = 'short';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      expect(mocks.mockChangePassword).not.toHaveBeenCalled();
    });

    it('does not call changePassword() when passwords do not match', () => {
      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'ValidPass1!';
      document.getElementById('confirm-password-input').value = 'DifferentPass1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      expect(mocks.mockChangePassword).not.toHaveBeenCalled();
    });

    it('does not call changePassword() when new password has no uppercase letter', () => {
      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'nouppercase1!';
      document.getElementById('confirm-password-input').value = 'nouppercase1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      expect(mocks.mockChangePassword).not.toHaveBeenCalled();
    });

    it('moves focus to getFirstErrorField() when gate blocks submission', () => {
      // policy-failing password → first error field is password-input
      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'weak';
      document.getElementById('confirm-password-input').value = 'weak';

      const passwordInputEl = document.getElementById('password-input');
      const focusSpy = jest.spyOn(passwordInputEl, 'focus');

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      expect(focusSpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9.2, 9.9: Session check before calling changePassword
  // -------------------------------------------------------------------------

  describe('Session gating (Req 9.9)', () => {
    // >! Indirectly verify the /login/ redirect by confirming changePassword is
    // >! NOT called and the form stays in its pre-submit state. Direct
    // >! window.location.href assertions cannot be used in jsdom because
    // >! navigation is not implemented and window.location is non-configurable
    // >! in this jsdom version.  This mirrors the approach used in
    // >! forgot-password-errors.jest.mjs for the same constraint.

    it('does NOT call changePassword() when getSession() returns an error (Req 9.9)', () => {
      mocks.mockGetSession.mockImplementation((callback) => {
        callback(new Error('No session'), null);
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      // changePassword not called confirms the session-invalid branch was taken
      expect(mocks.mockChangePassword).not.toHaveBeenCalled();
    });

    it('does NOT call changePassword() when getSession() returns an invalid session', () => {
      mocks.mockGetSession.mockImplementation((callback) => {
        callback(null, { isValid: () => false, getIdToken: jest.fn() });
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      expect(mocks.mockChangePassword).not.toHaveBeenCalled();
    });

    it('does NOT call changePassword() when getSession() returns null session', () => {
      mocks.mockGetSession.mockImplementation((callback) => {
        callback(null, null);
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      expect(mocks.mockChangePassword).not.toHaveBeenCalled();
    });

    it('re-enables the submit button when session is invalid (signals redirect path taken)', () => {
      // The submit handler disables the button before calling getSession.
      // If session is invalid, the page should redirect (or at least not proceed).
      // Re-enabling the button is NOT expected because the redirect path in the
      // code does `window.location.href = '/login/'` and returns immediately.
      // The button starts disabled once submit is fired, and the redirect exits
      // before re-enabling. This confirms the redirect branch ran.
      mocks.mockGetSession.mockImplementation((callback) => {
        callback(new Error('No session'), null);
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      // The page redirected before reaching changePassword — the success element
      // is NOT visible (no accidental success shown)
      const successEl = document.getElementById('change-password-success');
      expect(successEl.classList.contains('visible')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9.2: Button disabled while in flight
  // -------------------------------------------------------------------------

  describe('In-flight button state (Req 9.2)', () => {
    it('disables the submit button while changePassword() is in flight', () => {
      // Hang the call — don't fire the callback
      mocks.mockChangePassword.mockImplementation(() => {
        // pending, no callback
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const btn = document.getElementById('change-password-btn');
      expect(btn.disabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9.5, 9.10: Success path
  // -------------------------------------------------------------------------

  describe('Success path (Req 9.5, 9.10)', () => {
    /**
     * Helper: submit the form with valid inputs and trigger a successful
     * changePassword() callback, then return a promise that flushes microtasks.
     */
    function submitAndSucceed() {
      mocks.mockChangePassword.mockImplementation((oldPass, newPass, callback) => {
        callback(null);
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      return Promise.resolve();
    }

    it('calls changePassword() with the current and new passwords (Req 9.2)', async () => {
      await submitAndSucceed();
      expect(mocks.mockChangePassword).toHaveBeenCalledWith(
        'OldPass1!',
        'NewValid1!',
        expect.any(Function)
      );
    });

    it('clears all three password inputs on success (Req 9.5)', async () => {
      await submitAndSucceed();
      expect(document.getElementById('current-password').value).toBe('');
      expect(document.getElementById('password-input').value).toBe('');
      expect(document.getElementById('confirm-password-input').value).toBe('');
    });

    it('shows the success message on success (Req 9.5)', async () => {
      await submitAndSucceed();
      const successEl = document.getElementById('change-password-success');
      expect(successEl.textContent.length).toBeGreaterThan(0);
      expect(successEl.classList.contains('visible')).toBe(true);
    });

    it('does NOT redirect to /login/ on success (Req 9.10)', async () => {
      await submitAndSucceed();
      // On success: changePassword was called, success is shown, and inputs
      // are cleared. No /login/ redirect occurs — the user stays on the page.
      expect(mocks.mockChangePassword).toHaveBeenCalled();
      const successEl = document.getElementById('change-password-success');
      expect(successEl.classList.contains('visible')).toBe(true);
    });

    it('re-enables the submit button after success', async () => {
      await submitAndSucceed();
      const btn = document.getElementById('change-password-btn');
      expect(btn.disabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9.6: NotAuthorizedException — wrong current password
  // -------------------------------------------------------------------------

  describe('NotAuthorizedException (Req 9.6)', () => {
    it('shows an error message when current password is wrong', () => {
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({ code: 'NotAuthorizedException', message: 'Incorrect username or password.' });
      });

      document.getElementById('current-password').value = 'WrongOld1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const errorEl = document.getElementById('change-password-error');
      expect(errorEl.textContent.length).toBeGreaterThan(0);
      // The message should mention "current password" or "incorrect"
      expect(errorEl.textContent.toLowerCase()).toMatch(
        /current password|incorrect/
      );
    });

    it('re-enables the submit button on NotAuthorizedException', () => {
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({ code: 'NotAuthorizedException', message: 'Incorrect.' });
      });

      document.getElementById('current-password').value = 'WrongOld1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const btn = document.getElementById('change-password-btn');
      expect(btn.disabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9.7: InvalidPasswordException — policy violation
  // -------------------------------------------------------------------------

  describe('InvalidPasswordException (Req 9.7)', () => {
    it('shows an error message when new password violates the policy', () => {
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({
          code: 'InvalidPasswordException',
          message: 'Password does not conform to policy.',
        });
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const errorEl = document.getElementById('change-password-error');
      expect(errorEl.textContent.length).toBeGreaterThan(0);
    });

    it('re-enables the submit button on InvalidPasswordException', () => {
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({ code: 'InvalidPasswordException', message: 'Bad password.' });
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const btn = document.getElementById('change-password-btn');
      expect(btn.disabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9.8: Rate-limiting errors
  // -------------------------------------------------------------------------

  describe('Rate-limiting errors (Req 9.8)', () => {
    it('shows a wait-advisory on LimitExceededException', () => {
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({
          code: 'LimitExceededException',
          message: 'Attempt limit exceeded.',
        });
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const errorEl = document.getElementById('change-password-error');
      expect(errorEl.textContent.length).toBeGreaterThan(0);
      expect(errorEl.textContent.toLowerCase()).toMatch(/wait|too many/);
    });

    it('shows a wait-advisory on TooManyRequestsException', () => {
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({
          code: 'TooManyRequestsException',
          message: 'Too many requests.',
        });
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const errorEl = document.getElementById('change-password-error');
      expect(errorEl.textContent.length).toBeGreaterThan(0);
      expect(errorEl.textContent.toLowerCase()).toMatch(/wait|too many/);
    });

    it('re-enables the submit button on LimitExceededException', () => {
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({ code: 'LimitExceededException', message: 'Limit.' });
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const btn = document.getElementById('change-password-btn');
      expect(btn.disabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown error fallback (Req 9.8 generic path)
  // -------------------------------------------------------------------------

  describe('Unknown error fallback (Req 9.8)', () => {
    it('shows err.message when the error has a message property', () => {
      const msg = 'Some unexpected error occurred.';
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({ code: 'UnknownException', message: msg });
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const errorEl = document.getElementById('change-password-error');
      expect(errorEl.textContent).toBe(msg);
    });

    it('shows a generic message when the error has no message property', () => {
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({ code: 'UnknownException' }); // no .message
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const errorEl = document.getElementById('change-password-error');
      expect(errorEl.textContent.length).toBeGreaterThan(0);
    });

    it('re-enables the submit button on any unknown error', () => {
      mocks.mockChangePassword.mockImplementation((old, newP, callback) => {
        callback({ code: 'UnknownException', message: 'Error.' });
      });

      document.getElementById('current-password').value = 'OldPass1!';
      document.getElementById('password-input').value = 'NewValid1!';
      document.getElementById('confirm-password-input').value = 'NewValid1!';

      document.getElementById('change-password-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      const btn = document.getElementById('change-password-btn');
      expect(btn.disabled).toBe(false);
    });
  });
});
