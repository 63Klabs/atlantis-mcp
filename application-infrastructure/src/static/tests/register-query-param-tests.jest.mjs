/** @jest-environment jsdom */
/**
 * @jest-environment-options {"url": "http://localhost/register/"}
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

/**
 * Tests for query parameter handling on the registration page.
 * Validates Requirements: 4.3, 5.3, 5.6
 *
 * Tests verify that:
 * - ?verify=email@example.com shows verify step with email pre-populated
 * - Focus moves to verification code input within 500ms
 * - Missing/empty verify param shows normal registration form
 * - Fallback focus when input not rendered within 2s
 */

describe('Registration Page - Query Parameter Handling', () => {

  beforeEach(() => {
    jest.useFakeTimers();

    // Mock AmazonCognitoIdentity on window
    window.AmazonCognitoIdentity = {
      CognitoUserPool: jest.fn(() => ({
        signUp: jest.fn(),
        getCurrentUser: jest.fn()
      })),
      CognitoUser: jest.fn(() => ({
        resendConfirmationCode: jest.fn(),
        confirmRegistration: jest.fn(),
        authenticateUser: jest.fn()
      })),
      CognitoUserAttribute: jest.fn((data) => data),
      AuthenticationDetails: jest.fn((data) => data)
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
    delete window.AmazonCognitoIdentity;
    delete window.__testRegisteredEmail;
  });

  function setupPageDom() {
    document.body.innerHTML = `
      <div class="container">
        <div id="register-step" class="auth-form">
          <div id="register-error" class="alert alert-error" role="alert" aria-live="polite"></div>
          <form id="register-form" novalidate>
            <div class="form-group">
              <label for="email">Email address</label>
              <input type="email" id="email" name="email" required>
            </div>
            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" required>
            </div>
            <button type="submit" class="btn" id="register-btn">Register</button>
          </form>
        </div>
        <div id="verify-step" class="auth-form hidden">
          <div id="verify-error" class="alert alert-error" role="alert" aria-live="polite"></div>
          <div id="verify-info" class="alert alert-info visible" role="status"></div>
          <div id="spam-advisory" class="alert alert-info visible" role="note" aria-live="polite">
            If you don't see the verification email in your inbox, please check your spam or junk folder.
          </div>
          <form id="verify-form" novalidate>
            <div class="form-group">
              <label for="verification-code">Verification code</label>
              <input type="text" id="verification-code" name="code" required inputmode="numeric">
            </div>
            <button type="submit" class="btn" id="verify-btn">Verify Email</button>
          </form>
          <div id="resend-container" class="hidden">
            <button type="button" id="resend-btn" class="btn btn-secondary"
                    aria-label="Resend verification code to your email">Resend Code</button>
            <div id="resend-status" class="alert" role="status" aria-live="polite"></div>
          </div>
        </div>
        <div id="apikey-step" class="auth-form hidden"></div>
        <footer><span id="copyright-year"></span></footer>
      </div>
    `;
  }

  function executePageScript(searchString) {
    // Execute the inline script logic that handles query params
    // We pass the search string directly to URLSearchParams to avoid
    // needing to mock window.location
    const script = `
      (function() {
        'use strict';

        var USER_POOL_ID = 'us-east-1_TestPool';
        var CLIENT_ID = 'testClientId123';

        var poolData = { UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID };
        var userPool = new window.AmazonCognitoIdentity.CognitoUserPool(poolData);

        var registeredEmail = '';

        var resendState = {
          count: 0,
          maxResends: 3,
          cooldownMs: 30000,
          initialDelayMs: 30000,
          timerId: null
        };

        var registerStep = document.getElementById('register-step');
        var verifyStep = document.getElementById('verify-step');
        var resendContainer = document.getElementById('resend-container');

        function startResendTimer() {
          if (resendState.timerId) {
            clearTimeout(resendState.timerId);
          }
          resendState.timerId = setTimeout(function() {
            resendContainer.classList.remove('hidden');
            resendState.timerId = null;
          }, resendState.initialDelayMs);
        }

        // Handle ?verify=<email> query parameter on page load
        var params = new URLSearchParams('${searchString}');
        var verifyEmail = params.get('verify');
        if (verifyEmail) {
          registeredEmail = verifyEmail;
          registerStep.classList.add('hidden');
          verifyStep.classList.remove('hidden');
          startResendTimer();

          // Focus verification code input within 500ms, with 2-second fallback
          var focusAttemptTimer = setTimeout(function() {
            var codeInput = document.getElementById('verification-code');
            if (codeInput) {
              codeInput.focus();
            }
          }, 500);

          var focusFallbackTimer = setTimeout(function() {
            var codeInput = document.getElementById('verification-code');
            if (document.activeElement !== codeInput) {
              var firstFocusable = document.querySelector(
                'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
              );
              if (firstFocusable) {
                firstFocusable.focus();
              }
            }
          }, 2000);
        }

        // Expose registeredEmail for test verification
        window.__testRegisteredEmail = registeredEmail;
      })();
    `;

    // jsdom doesn't execute script elements, so we use Function constructor
    const fn = new Function(script);
    fn();
  }

  describe('When URL has ?verify=email@example.com', () => {
    it('should hide register-step and show verify-step', () => {
      setupPageDom();
      executePageScript('?verify=test@example.com');

      const registerStep = document.getElementById('register-step');
      const verifyStep = document.getElementById('verify-step');

      expect(registerStep.classList.contains('hidden')).toBe(true);
      expect(verifyStep.classList.contains('hidden')).toBe(false);
    });

    it('should set registeredEmail to the email from query param', () => {
      setupPageDom();
      executePageScript('?verify=user@domain.com');

      expect(window.__testRegisteredEmail).toBe('user@domain.com');
    });

    it('should focus verification-code input within 500ms', () => {
      setupPageDom();
      executePageScript('?verify=test@example.com');

      const codeInput = document.getElementById('verification-code');

      // Before 500ms, focus should not yet be on the input
      jest.advanceTimersByTime(499);
      expect(document.activeElement).not.toBe(codeInput);

      // At 500ms, focus should move to the verification code input
      jest.advanceTimersByTime(1);
      expect(document.activeElement).toBe(codeInput);
    });
  });

  describe('When URL has no verify param or empty ?verify=', () => {
    it('should show normal registration form when verify param is missing', () => {
      setupPageDom();
      executePageScript('');

      const registerStep = document.getElementById('register-step');
      const verifyStep = document.getElementById('verify-step');

      expect(registerStep.classList.contains('hidden')).toBe(false);
      expect(verifyStep.classList.contains('hidden')).toBe(true);
    });

    it('should show normal registration form when verify param is empty', () => {
      setupPageDom();
      executePageScript('?verify=');

      const registerStep = document.getElementById('register-step');
      const verifyStep = document.getElementById('verify-step');

      // Empty string is falsy, so normal form should show
      expect(registerStep.classList.contains('hidden')).toBe(false);
      expect(verifyStep.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Fallback focus when input not rendered within 2s', () => {
    it('should focus first focusable element if verification-code is removed before focus', () => {
      setupPageDom();

      // Remove the verification-code input before executing the script
      // to simulate it not being rendered
      const codeInput = document.getElementById('verification-code');
      codeInput.parentNode.removeChild(codeInput);

      executePageScript('?verify=test@example.com');

      // Advance past the 500ms focus attempt (will fail since input is gone)
      jest.advanceTimersByTime(500);

      // Advance to 2000ms for fallback
      jest.advanceTimersByTime(1500);

      // The fallback should focus the first focusable element on the page
      const firstFocusable = document.querySelector(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      expect(document.activeElement).toBe(firstFocusable);
    });

    it('should not override focus if verification-code already has focus at 2s', () => {
      setupPageDom();
      executePageScript('?verify=test@example.com');

      // Advance past 500ms - input gets focused
      jest.advanceTimersByTime(500);

      const codeInput = document.getElementById('verification-code');
      expect(document.activeElement).toBe(codeInput);

      // Advance to 2000ms - fallback should NOT override existing focus
      jest.advanceTimersByTime(1500);
      expect(document.activeElement).toBe(codeInput);
    });
  });
});
