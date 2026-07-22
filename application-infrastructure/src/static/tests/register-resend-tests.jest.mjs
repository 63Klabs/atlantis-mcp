/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Tests for spam advisory display and resend button behavior on the registration page.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
 */

const HTML_PATH = resolve(
  import.meta.dirname,
  '../public/register/index.html'
);

function loadPage() {
  let html = readFileSync(HTML_PATH, 'utf8');
  // Replace template tokens with test values
  html = html.replace(/\{\{\{settings\.cognitoUserPoolId\}\}\}/g, 'us-east-1_TestPool');
  html = html.replace(/\{\{\{settings\.cognitoClientId\}\}\}/g, 'testclientid123');
  html = html.replace(/\{\{\{settings\.apiBaseUrl\}\}\}/g, 'https://api.test.com');
  html = html.replace(/\{\{\{settings\.footer\}\}\}/g, '<span id="copyright-year"></span>');
  return html;
}

function setupCognitoMock() {
  const mockResendConfirmationCode = jest.fn();
  const mockConfirmRegistration = jest.fn();
  const mockAuthenticateUser = jest.fn();

  const mockCognitoUser = {
    resendConfirmationCode: mockResendConfirmationCode,
    confirmRegistration: mockConfirmRegistration,
    authenticateUser: mockAuthenticateUser
  };

  const mockSignUp = jest.fn();

  window.AmazonCognitoIdentity = {
    CognitoUserPool: jest.fn().mockImplementation(() => ({
      signUp: mockSignUp
    })),
    CognitoUser: jest.fn().mockImplementation(() => mockCognitoUser),
    CognitoUserAttribute: jest.fn().mockImplementation((data) => data),
    AuthenticationDetails: jest.fn().mockImplementation((data) => data)
  };

  return { mockResendConfirmationCode, mockSignUp, mockCognitoUser };
}

function executePageScript(html) {
  // Extract and execute the inline scripts
  const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/g);
  if (scriptMatches) {
    for (const scriptTag of scriptMatches) {
      const code = scriptTag.replace(/<\/?script>/g, '');
      // Skip the CDN script tag reference
      if (code.includes('amazon-cognito-identity')) continue;
      try {
        // eslint-disable-next-line no-eval
        const fn = new Function(code);
        fn();
      } catch (e) {
        // The copyright-year script may fail if element doesn't exist yet, that's fine
        if (!e.message.includes('Cannot set properties of null')) {
          throw e;
        }
      }
    }
  }
}

describe('Registration Page - Spam Advisory and Resend Button', () => {
  let html;
  let mocks;

  beforeEach(() => {
    jest.useFakeTimers();
    html = loadPage();
    mocks = setupCognitoMock();
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
    // Remove the CDN script tag to avoid loading issues
    const cdnScript = document.querySelector('script[src*="amazon-cognito"]');
    if (cdnScript) cdnScript.remove();
    executePageScript(html);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('Spam Advisory Display (Requirements 1.1, 1.2, 1.3, 1.4)', () => {
    it('should have spam advisory with role="note" attribute', () => {
      const advisory = document.getElementById('spam-advisory');
      expect(advisory).not.toBeNull();
      expect(advisory.getAttribute('role')).toBe('note');
    });

    it('should have spam advisory with aria-live="polite" attribute', () => {
      const advisory = document.getElementById('spam-advisory');
      expect(advisory).not.toBeNull();
      expect(advisory.getAttribute('aria-live')).toBe('polite');
    });

    it('should display spam advisory when verify step is visible', () => {
      // Simulate showing verify step (as happens after registration)
      const registerStep = document.getElementById('register-step');
      const verifyStep = document.getElementById('verify-step');
      registerStep.classList.add('hidden');
      verifyStep.classList.remove('hidden');

      const advisory = document.getElementById('spam-advisory');
      expect(advisory.classList.contains('visible')).toBe(true);
      expect(advisory.textContent).toContain('spam');
    });

    it('should render advisory in the same rendering cycle as verify step content', () => {
      // Advisory is part of the static HTML within verify-step, not dynamically loaded
      const verifyStep = document.getElementById('verify-step');
      const advisory = document.getElementById('spam-advisory');
      expect(verifyStep.contains(advisory)).toBe(true);
    });

    it('should continue displaying advisory while verify step is visible', () => {
      const verifyStep = document.getElementById('verify-step');
      verifyStep.classList.remove('hidden');

      const advisory = document.getElementById('spam-advisory');
      expect(advisory.classList.contains('visible')).toBe(true);

      // Advance time - advisory should still be visible
      jest.advanceTimersByTime(60000);
      expect(advisory.classList.contains('visible')).toBe(true);
    });
  });

  describe('Resend Button Initial State and Delay (Requirements 2.1, 2.7)', () => {
    it('should have resend container hidden initially', () => {
      const resendContainer = document.getElementById('resend-container');
      expect(resendContainer.classList.contains('hidden')).toBe(true);
    });

    it('should show resend container after 30 seconds when verify step is shown via registration', () => {
      // Trigger registration to show verify step and start timer
      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password-input');
      const confirmPasswordInput = document.getElementById('confirm-password-input');
      emailInput.value = 'test@example.com';
      passwordInput.value = 'Password1!';
      confirmPasswordInput.value = 'Password1!';

      // Mock successful signUp
      mocks.mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback(null, { user: {} });
      });

      const form = document.getElementById('register-form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      // Verify resend container is still hidden
      const resendContainer = document.getElementById('resend-container');
      expect(resendContainer.classList.contains('hidden')).toBe(true);

      // Advance 29 seconds - still hidden
      jest.advanceTimersByTime(29000);
      expect(resendContainer.classList.contains('hidden')).toBe(true);

      // Advance to 30 seconds - should be visible
      jest.advanceTimersByTime(1000);
      expect(resendContainer.classList.contains('hidden')).toBe(false);
    });

    it('should have resend button with proper aria-label', () => {
      const resendBtn = document.getElementById('resend-btn');
      expect(resendBtn).not.toBeNull();
      expect(resendBtn.getAttribute('aria-label')).toBe('Resend verification code to your email');
    });
  });

  describe('Resend Button Click Behavior (Requirements 2.2, 2.3, 2.4, 2.5)', () => {
    function setupVerifyStepWithResendVisible() {
      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password-input');
      emailInput.value = 'test@example.com';
      passwordInput.value = 'Password1!';

      mocks.mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback(null, { user: {} });
      });

      const form = document.getElementById('register-form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      // Advance 30 seconds to show resend button
      jest.advanceTimersByTime(30000);
    }

    it('should disable button and call resendConfirmationCode when clicked', () => {
      setupVerifyStepWithResendVisible();

      // Mock resend to not call callback immediately (simulating pending request)
      mocks.mockResendConfirmationCode.mockImplementation(() => {
        // Don't call callback - simulates pending state
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      expect(resendBtn.disabled).toBe(true);
      expect(mocks.mockResendConfirmationCode).toHaveBeenCalled();
    });

    it('should show success message on successful resend', () => {
      setupVerifyStepWithResendVisible();

      mocks.mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus.textContent).toContain('new verification code has been sent');
      expect(resendStatus.classList.contains('visible')).toBe(true);
    });

    it('should hide resend container for 30 seconds after successful resend (cooldown)', () => {
      setupVerifyStepWithResendVisible();

      mocks.mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      const resendBtn = document.getElementById('resend-btn');
      const resendContainer = document.getElementById('resend-container');
      resendBtn.click();

      // Container should be hidden during cooldown
      expect(resendContainer.classList.contains('hidden')).toBe(true);

      // After 29 seconds, still hidden
      jest.advanceTimersByTime(29000);
      expect(resendContainer.classList.contains('hidden')).toBe(true);

      // After 30 seconds, visible again
      jest.advanceTimersByTime(1000);
      expect(resendContainer.classList.contains('hidden')).toBe(false);
    });

    it('should keep success message visible for at least 10 seconds', () => {
      setupVerifyStepWithResendVisible();

      mocks.mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      const resendStatus = document.getElementById('resend-status');

      // After 10 seconds, message should still be visible
      jest.advanceTimersByTime(10000);
      expect(resendStatus.textContent).toContain('new verification code has been sent');
      expect(resendStatus.classList.contains('visible')).toBe(true);
    });

    it('should show error message and re-enable button on failure', () => {
      setupVerifyStepWithResendVisible();

      mocks.mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ message: 'Too many attempts' }, null);
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus.textContent).toBe('Too many attempts');
      expect(resendStatus.classList.contains('alert-error')).toBe(true);
      expect(resendBtn.disabled).toBe(false);
    });
  });

  describe('Max Resend Attempts (Requirements 2.6, 2.8)', () => {
    function setupVerifyStepWithResendVisible() {
      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password-input');
      emailInput.value = 'test@example.com';
      passwordInput.value = 'Password1!';

      mocks.mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback(null, { user: {} });
      });

      const form = document.getElementById('register-form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      // Advance 30 seconds to show resend button
      jest.advanceTimersByTime(30000);
    }

    it('should permanently disable button after 3 successful resends', () => {
      setupVerifyStepWithResendVisible();

      mocks.mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      const resendBtn = document.getElementById('resend-btn');
      const resendStatus = document.getElementById('resend-status');

      // First resend
      resendBtn.click();
      // Wait for cooldown
      jest.advanceTimersByTime(30000);

      // Second resend
      resendBtn.click();
      // Wait for cooldown
      jest.advanceTimersByTime(30000);

      // Third resend - should permanently disable
      resendBtn.click();

      expect(resendBtn.disabled).toBe(true);
      expect(resendStatus.textContent).toContain('Maximum resend attempts reached');
    });

    it('should not re-enable button after max attempts even after cooldown', () => {
      setupVerifyStepWithResendVisible();

      mocks.mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      const resendBtn = document.getElementById('resend-btn');

      // Perform 3 successful resends
      resendBtn.click();
      jest.advanceTimersByTime(30000);
      resendBtn.click();
      jest.advanceTimersByTime(30000);
      resendBtn.click();

      // Advance well past any cooldown
      jest.advanceTimersByTime(60000);

      expect(resendBtn.disabled).toBe(true);
    });
  });
});
