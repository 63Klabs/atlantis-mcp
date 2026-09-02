/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { resolve } from 'path';
import { loadPage, executePageScripts } from '../helpers/load-page.mjs';

/**
 * Unit tests for the forgot-password page — structure, ARIA attributes, step
 * transitions, SDK invocation, success-step content, and focus management.
 *
 * Validates: Requirements 12.2, 12.3, 2.6, 2.7, 2.8, 7.1, 7.2, 7.3, 7.4, 7.5, 11.6
 */

const HTML_PATH = resolve(
  import.meta.dirname,
  '../../public/forgot-password/index.html'
);

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

/**
 * Build a stable Cognito mock whose method references are accessible for
 * per-test configuration and assertion.
 *
 * @returns {{ mockForgotPassword: jest.Mock, mockConfirmPassword: jest.Mock, mockResendConfirmationCode: jest.Mock }}
 */
function buildMocks() {
  const mockForgotPassword = jest.fn();
  const mockConfirmPassword = jest.fn();
  const mockResendConfirmationCode = jest.fn();

  const mockCognitoUser = {
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

  return { mockForgotPassword, mockConfirmPassword, mockResendConfirmationCode };
}

// ---------------------------------------------------------------------------
// Suite: HTML Structure (Requirement 12.2)
// ---------------------------------------------------------------------------

describe('Forgot-Password Page - HTML Structure', () => {
  let html;

  beforeEach(() => {
    jest.useFakeTimers();
    buildMocks();
    html = loadPage(HTML_PATH);
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

  // --- Step containers ---

  it('should have #request-step visible initially', () => {
    const el = document.getElementById('request-step');
    expect(el).not.toBeNull();
    expect(el.classList.contains('hidden')).toBe(false);
  });

  it('should have #confirm-step hidden initially', () => {
    const el = document.getElementById('confirm-step');
    expect(el).not.toBeNull();
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('should have #success-step hidden initially', () => {
    const el = document.getElementById('success-step');
    expect(el).not.toBeNull();
    expect(el.classList.contains('hidden')).toBe(true);
  });

  // --- Request-step required elements ---

  it('should have #reset-form element', () => {
    expect(document.getElementById('reset-form')).not.toBeNull();
  });

  it('should have #email input of type email', () => {
    const el = document.getElementById('email');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('INPUT');
    expect(el.type).toBe('email');
  });

  it('should have #reset-btn button', () => {
    const el = document.getElementById('reset-btn');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('BUTTON');
  });

  it('should have #reset-error alert element', () => {
    const el = document.getElementById('reset-error');
    expect(el).not.toBeNull();
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  // --- Confirm-step required elements ---

  it('should have #confirm-form element', () => {
    expect(document.getElementById('confirm-form')).not.toBeNull();
  });

  it('should have #verification-code input', () => {
    const el = document.getElementById('verification-code');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('INPUT');
  });

  it('should have #password-input element', () => {
    const el = document.getElementById('password-input');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('INPUT');
    expect(el.type).toBe('password');
  });

  it('should have #confirm-password-input element', () => {
    const el = document.getElementById('confirm-password-input');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('INPUT');
    expect(el.type).toBe('password');
  });

  it('should have #password-requirements element', () => {
    expect(document.getElementById('password-requirements')).not.toBeNull();
  });

  it('should have #password-match-status element', () => {
    expect(document.getElementById('password-match-status')).not.toBeNull();
  });

  it('should have #validation-announcements element', () => {
    expect(document.getElementById('validation-announcements')).not.toBeNull();
  });

  it('should have #confirm-btn button', () => {
    const el = document.getElementById('confirm-btn');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('BUTTON');
  });

  it('should have #confirm-error alert element', () => {
    const el = document.getElementById('confirm-error');
    expect(el).not.toBeNull();
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('should have #confirm-info element', () => {
    expect(document.getElementById('confirm-info')).not.toBeNull();
  });

  it('should have #spam-advisory element', () => {
    expect(document.getElementById('spam-advisory')).not.toBeNull();
  });

  it('should have #resend-container hidden initially', () => {
    const el = document.getElementById('resend-container');
    expect(el).not.toBeNull();
    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('should have #resend-btn with correct aria-label', () => {
    const el = document.getElementById('resend-btn');
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-label')).toBe('Resend reset code to your email');
  });

  // --- Success-step required elements ---

  it('should have #success-step element', () => {
    expect(document.getElementById('success-step')).not.toBeNull();
  });

  // --- ARIA attributes (Requirement 11.x) ---

  it('should have #email with aria-required="true"', () => {
    const el = document.getElementById('email');
    expect(el.getAttribute('aria-required')).toBe('true');
  });

  it('should have #email with aria-describedby pointing to reset-error', () => {
    const el = document.getElementById('email');
    expect(el.getAttribute('aria-describedby')).toContain('reset-error');
  });

  it('should have #verification-code with autocomplete="one-time-code"', () => {
    const el = document.getElementById('verification-code');
    expect(el.getAttribute('autocomplete')).toBe('one-time-code');
  });

  it('should have #validation-announcements with aria-live="polite"', () => {
    const el = document.getElementById('validation-announcements');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('should have #validation-announcements with aria-atomic="true"', () => {
    const el = document.getElementById('validation-announcements');
    expect(el.getAttribute('aria-atomic')).toBe('true');
  });

  it('should have #resend-status with role="status"', () => {
    const el = document.getElementById('resend-status');
    expect(el).not.toBeNull();
    expect(el.getAttribute('role')).toBe('status');
  });

  it('should have window.PasswordValidator loaded', () => {
    expect(window.PasswordValidator).toBeDefined();
    expect(typeof window.PasswordValidator.validateForm).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Suite: Request Step — forgotPassword() and step transition (Req 12.2, 2.6)
// ---------------------------------------------------------------------------

describe('Forgot-Password Page - Request Step', () => {
  let mocks;

  beforeEach(() => {
    jest.useFakeTimers();
    mocks = buildMocks();

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

  it('should call forgotPassword() when a valid email is submitted', () => {
    // Hang the call — do not fire any callback — to isolate the assertion
    mocks.mockForgotPassword.mockImplementation(() => {});

    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(mocks.mockForgotPassword).toHaveBeenCalledTimes(1);
  });

  it('should disable #reset-btn with "Sending…" text while the request is in flight', () => {
    mocks.mockForgotPassword.mockImplementation(() => {}); // no callback

    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const btn = document.getElementById('reset-btn');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/sending/i);
  });

  it('should NOT call forgotPassword() when email is empty', () => {
    document.getElementById('email').value = '';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(mocks.mockForgotPassword).not.toHaveBeenCalled();
  });

  it('should show a validation error when email is empty', () => {
    document.getElementById('email').value = '';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const resetError = document.getElementById('reset-error');
    expect(resetError.textContent.length).toBeGreaterThan(0);
    expect(resetError.classList.contains('visible')).toBe(true);
  });

  // --- Transition to confirm step via inputVerificationCode (Req 2.6) ---

  it('should hide #request-step when inputVerificationCode fires', () => {
    mocks.mockForgotPassword.mockImplementation((callbacks) => {
      callbacks.inputVerificationCode();
    });

    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(document.getElementById('request-step').classList.contains('hidden')).toBe(true);
  });

  it('should show #confirm-step when inputVerificationCode fires', () => {
    mocks.mockForgotPassword.mockImplementation((callbacks) => {
      callbacks.inputVerificationCode();
    });

    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(document.getElementById('confirm-step').classList.contains('hidden')).toBe(false);
  });

  it('should hide #request-step when onSuccess fires (alt SDK path)', () => {
    mocks.mockForgotPassword.mockImplementation((callbacks) => {
      callbacks.onSuccess();
    });

    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(document.getElementById('request-step').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('confirm-step').classList.contains('hidden')).toBe(false);
  });

  // --- Focus management (Requirement 11.6) ---

  it('should move focus to #verification-code after advancing to confirm step', () => {
    const codeInput = document.getElementById('verification-code');
    const focusSpy = jest.spyOn(codeInput, 'focus');

    mocks.mockForgotPassword.mockImplementation((callbacks) => {
      callbacks.inputVerificationCode();
    });

    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(focusSpy).toHaveBeenCalled();
  });

  // --- Neutral copy and spam advisory (Req 2.7, 2.8) ---

  it('should show neutral copy in #confirm-info (no "account exists" language)', () => {
    mocks.mockForgotPassword.mockImplementation((callbacks) => {
      callbacks.inputVerificationCode();
    });

    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const info = document.getElementById('confirm-info');
    const text = info.textContent.toLowerCase();
    expect(info.classList.contains('visible')).toBe(true);
    // Must not positively assert that an account was found or does not exist
    expect(text).not.toContain('account found');
    expect(text).not.toContain('no account');
    expect(text).not.toContain('not registered');
    expect(text).not.toContain('does not exist');
    // Must use neutral language about the code being sent (conditional phrasing is fine)
    expect(text).toContain('reset code');
  });

  it('should display #spam-advisory after advancing to confirm step (Req 2.8)', () => {
    mocks.mockForgotPassword.mockImplementation((callbacks) => {
      callbacks.inputVerificationCode();
    });

    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const advisory = document.getElementById('spam-advisory');
    expect(advisory.classList.contains('visible')).toBe(true);
    expect(advisory.textContent.toLowerCase()).toContain('spam');
  });

  it('should re-enable #reset-btn after inputVerificationCode fires', () => {
    mocks.mockForgotPassword.mockImplementation((callbacks) => {
      callbacks.inputVerificationCode();
    });

    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const btn = document.getElementById('reset-btn');
    expect(btn.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite: Confirm Step — confirmPassword() and step transition (Req 12.3)
// ---------------------------------------------------------------------------

describe('Forgot-Password Page - Confirm Step', () => {
  let mocks;

  /**
   * Helper that advances the page to the confirm step by submitting the request
   * form and firing the `inputVerificationCode` callback synchronously.
   *
   * @param {string} [email='test@example.com']
   */
  function advanceToConfirmStep(email = 'test@example.com') {
    mocks.mockForgotPassword.mockImplementationOnce((callbacks) => {
      callbacks.inputVerificationCode();
    });

    document.getElementById('email').value = email;
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Reset forgotPassword so subsequent calls (resend) are independent
    mocks.mockForgotPassword.mockReset();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mocks = buildMocks();

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

  it('should call confirmPassword() with correct code and password on valid submission', () => {
    advanceToConfirmStep();

    mocks.mockConfirmPassword.mockImplementation((code, password, callbacks) => {
      // Hang — just capture arguments
    });

    document.getElementById('verification-code').value = '123456';
    document.getElementById('password-input').value = 'NewPass1!';
    document.getElementById('confirm-password-input').value = 'NewPass1!';

    document.getElementById('confirm-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(mocks.mockConfirmPassword).toHaveBeenCalledTimes(1);
    const [code, password] = mocks.mockConfirmPassword.mock.calls[0];
    expect(code).toBe('123456');
    expect(password).toBe('NewPass1!');
  });

  it('should disable #confirm-btn with "Resetting…" text while in flight', () => {
    advanceToConfirmStep();

    mocks.mockConfirmPassword.mockImplementation(() => {}); // no callback

    document.getElementById('verification-code').value = '654321';
    document.getElementById('password-input').value = 'NewPass1!';
    document.getElementById('confirm-password-input').value = 'NewPass1!';

    document.getElementById('confirm-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const btn = document.getElementById('confirm-btn');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/resetting/i);
  });

  it('should NOT call confirmPassword() when verification code is empty', () => {
    advanceToConfirmStep();

    document.getElementById('verification-code').value = '';
    document.getElementById('password-input').value = 'NewPass1!';
    document.getElementById('confirm-password-input').value = 'NewPass1!';

    document.getElementById('confirm-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(mocks.mockConfirmPassword).not.toHaveBeenCalled();
  });

  it('should show a validation error when verification code is empty', () => {
    advanceToConfirmStep();

    document.getElementById('verification-code').value = '';
    document.getElementById('password-input').value = 'NewPass1!';
    document.getElementById('confirm-password-input').value = 'NewPass1!';

    document.getElementById('confirm-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const err = document.getElementById('confirm-error');
    expect(err.textContent.length).toBeGreaterThan(0);
    expect(err.classList.contains('visible')).toBe(true);
  });

  it('should NOT call confirmPassword() when passwords do not pass the validator gate', () => {
    advanceToConfirmStep();

    // Invalid password — too short, no special chars
    document.getElementById('verification-code').value = '111111';
    document.getElementById('password-input').value = 'short';
    document.getElementById('confirm-password-input').value = 'short';

    document.getElementById('confirm-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(mocks.mockConfirmPassword).not.toHaveBeenCalled();
  });

  it('should transition to #success-step when confirmPassword() onSuccess fires', () => {
    advanceToConfirmStep();

    mocks.mockConfirmPassword.mockImplementation((code, password, callbacks) => {
      callbacks.onSuccess();
    });

    document.getElementById('verification-code').value = '999999';
    document.getElementById('password-input').value = 'NewPass1!';
    document.getElementById('confirm-password-input').value = 'NewPass1!';

    document.getElementById('confirm-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(document.getElementById('confirm-step').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('success-step').classList.contains('hidden')).toBe(false);
  });

  it('should re-enable #confirm-btn on confirmPassword() onFailure', () => {
    advanceToConfirmStep();

    mocks.mockConfirmPassword.mockImplementation((code, password, callbacks) => {
      callbacks.onFailure({ code: 'CodeMismatchException', message: 'Invalid code' });
    });

    document.getElementById('verification-code').value = '000000';
    document.getElementById('password-input').value = 'NewPass1!';
    document.getElementById('confirm-password-input').value = 'NewPass1!';

    document.getElementById('confirm-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const btn = document.getElementById('confirm-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('Reset');
  });
});

// ---------------------------------------------------------------------------
// Suite: Success Step Content (Req 7.1, 7.2, 7.3, 7.4, 7.5)
// ---------------------------------------------------------------------------

describe('Forgot-Password Page - Success Step', () => {
  let mocks;

  /**
   * Helper that advances through both the request and confirm steps to show
   * the success step.
   */
  function advanceToSuccessStep() {
    // Step 1 → Step 2
    mocks.mockForgotPassword.mockImplementationOnce((callbacks) => {
      callbacks.inputVerificationCode();
    });
    document.getElementById('email').value = 'user@example.com';
    document.getElementById('reset-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    mocks.mockForgotPassword.mockReset();

    // Step 2 → Step 3
    mocks.mockConfirmPassword.mockImplementationOnce((code, password, callbacks) => {
      callbacks.onSuccess();
    });
    document.getElementById('verification-code').value = '123456';
    document.getElementById('password-input').value = 'NewPass1!';
    document.getElementById('confirm-password-input').value = 'NewPass1!';

    document.getElementById('confirm-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  beforeEach(() => {
    jest.useFakeTimers();
    mocks = buildMocks();

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

  it('should have #success-step visible after successful reset (Req 7.1)', () => {
    advanceToSuccessStep();
    expect(document.getElementById('success-step').classList.contains('hidden')).toBe(false);
  });

  it('should have #confirm-step hidden after successful reset', () => {
    advanceToSuccessStep();
    expect(document.getElementById('confirm-step').classList.contains('hidden')).toBe(true);
  });

  it('should include an advisory that the API key was NOT changed (Req 7.2)', () => {
    advanceToSuccessStep();
    const text = document.getElementById('success-step').textContent.toLowerCase();
    expect(text).toContain('api key');
  });

  it('should include a link to /profile/ for API key regeneration (Req 7.3)', () => {
    advanceToSuccessStep();
    const links = document.getElementById('success-step').querySelectorAll('a[href="/profile/"]');
    expect(links.length).toBeGreaterThan(0);
  });

  it('should include a link to /login/ for signing in with the new password (Req 7.4)', () => {
    advanceToSuccessStep();
    const links = document.getElementById('success-step').querySelectorAll('a[href="/login/"]');
    expect(links.length).toBeGreaterThan(0);
  });

  it('should NOT automatically authenticate the user after success (Req 7.5)', () => {
    // The page must not call authenticateUser or getSession after success
    const cognitoConstructorCalls = window.AmazonCognitoIdentity.CognitoUser.mock.calls.length;
    advanceToSuccessStep();

    // Collect all CognitoUser instances created after the page was set up
    const instances = window.AmazonCognitoIdentity.CognitoUser.mock.results;
    for (const result of instances) {
      const instance = result.value;
      if (instance && typeof instance.authenticateUser === 'function') {
        // authenticateUser must never have been called
        expect(instance.authenticateUser).not.toHaveBeenCalled();
      }
    }
  });

  it('should contain a success or confirmation message (Req 7.1)', () => {
    advanceToSuccessStep();
    const successEl = document.getElementById('success-step');
    const text = successEl.textContent.toLowerCase();
    // Some confirmation of the action succeeding
    expect(
      text.includes('reset') || text.includes('success') || text.includes('changed')
    ).toBe(true);
  });
});
