/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const HTML_PATH = resolve(
  import.meta.dirname,
  '../../static/public/register/index.html'
);

/**
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * Tests for re-registration handling when a user attempts to register
 * with an email that already exists in Cognito (unverified account).
 */
describe('Registration Page - Re-registration of Unverified Accounts', () => {
  let mockSignUp;
  let mockResendConfirmationCode;
  let mockCognitoUserConstructor;

  beforeEach(() => {
    jest.useFakeTimers();

    mockResendConfirmationCode = jest.fn();
    mockSignUp = jest.fn();

    mockCognitoUserConstructor = jest.fn();

    // Mock AmazonCognitoIdentity on window
    window.AmazonCognitoIdentity = {
      CognitoUserPool: jest.fn().mockImplementation(() => ({
        signUp: mockSignUp
      })),
      CognitoUser: jest.fn().mockImplementation((userData) => {
        mockCognitoUserConstructor(userData);
        return {
          resendConfirmationCode: mockResendConfirmationCode
        };
      }),
      CognitoUserAttribute: jest.fn().mockImplementation((data) => data)
    };

    // Load the HTML
    const html = readFileSync(HTML_PATH, 'utf8');

    // Replace template tokens so the script doesn't break
    const processedHtml = html
      .replace(/\{\{\{settings\.cognitoUserPoolId\}\}\}/g, 'us-east-1_TestPool')
      .replace(/\{\{\{settings\.cognitoClientId\}\}\}/g, 'testClientId123')
      .replace(/\{\{\{settings\.apiBaseUrl\}\}\}/g, 'https://api.test.com')
      .replace(/\{\{\{settings\.footer\}\}\}/g, '<span id="copyright-year"></span>');

    document.documentElement.innerHTML = processedHtml;

    // Add copyright-year element if missing (referenced by first script block)
    if (!document.getElementById('copyright-year')) {
      const span = document.createElement('span');
      span.id = 'copyright-year';
      document.body.appendChild(span);
    }

    // Execute the inline scripts
    const scripts = document.querySelectorAll('script:not([src])');
    scripts.forEach((script) => {
      const fn = new Function(script.textContent);
      fn();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete window.AmazonCognitoIdentity;
  });

  describe('Requirement 3.1: UsernameExistsException triggers resend flow', () => {
    it('should disable submit button and show loading state when UsernameExistsException occurs', () => {
      // Arrange: signUp calls back with UsernameExistsException
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });

      // resendConfirmationCode does not call back yet (pending)
      mockResendConfirmationCode.mockImplementation(() => {});

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const registerBtn = document.getElementById('register-btn');
      const form = document.getElementById('register-form');

      emailInput.value = 'test@example.com';
      passwordInput.value = 'Password1!';

      // Act
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      // Assert: button stays disabled with "Verifying…" text
      expect(registerBtn.disabled).toBe(true);
      expect(registerBtn.textContent).toBe('Verifying…');
      expect(mockResendConfirmationCode).toHaveBeenCalled();
    });

    it('should call resendConfirmationCode with the submitted email', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation(() => {});

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');

      emailInput.value = 'user@domain.com';
      passwordInput.value = 'SecurePass1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      // Verify CognitoUser was constructed with the correct email
      expect(mockCognitoUserConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ Username: 'user@domain.com' })
      );
    });
  });

  describe('Requirement 3.2: Successful resend transitions to verify step', () => {
    it('should hide register step and show verify step on successful resend', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');

      emailInput.value = 'test@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      const registerStep = document.getElementById('register-step');
      const verifyStep = document.getElementById('verify-step');

      expect(registerStep.classList.contains('hidden')).toBe(true);
      expect(verifyStep.classList.contains('hidden')).toBe(false);
    });

    it('should focus the verification code input after successful resend', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');
      const codeInput = document.getElementById('verification-code');

      // Spy on focus
      const focusSpy = jest.spyOn(codeInput, 'focus');

      emailInput.value = 'test@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe('Requirement 3.3: Already-verified error shows account exists message', () => {
    it('should show "account exists" message when resend fails with InvalidParameterException', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ code: 'InvalidParameterException', message: 'Cannot resend' }, null);
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');

      emailInput.value = 'verified@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      const registerError = document.getElementById('register-error');
      expect(registerError.textContent).toBe('An account with this email already exists. Please log in.');
    });

    it('should show "account exists" message when error message contains "confirmed"', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ code: 'SomeError', message: 'User is already confirmed' }, null);
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');

      emailInput.value = 'confirmed@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      const registerError = document.getElementById('register-error');
      expect(registerError.textContent).toBe('An account with this email already exists. Please log in.');
    });

    it('should show "account exists" message when error message contains "verified"', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ code: 'SomeError', message: 'Account already verified' }, null);
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');

      emailInput.value = 'verified2@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      const registerError = document.getElementById('register-error');
      expect(registerError.textContent).toBe('An account with this email already exists. Please log in.');
    });

    it('should re-enable submit button with "Register" text on already-verified error', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ code: 'InvalidParameterException', message: 'Cannot resend' }, null);
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');
      const registerBtn = document.getElementById('register-btn');

      emailInput.value = 'verified@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(registerBtn.disabled).toBe(false);
      expect(registerBtn.textContent).toBe('Register');
    });
  });

  describe('Requirement 3.4: Other errors re-enable submit button with error message', () => {
    it('should show error message and re-enable button on LimitExceededException', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ code: 'LimitExceededException', message: 'Too many attempts' }, null);
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');
      const registerBtn = document.getElementById('register-btn');
      const registerError = document.getElementById('register-error');

      emailInput.value = 'limited@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(registerError.textContent).toBe('Could not send verification code. Please try again.');
      expect(registerBtn.disabled).toBe(false);
      expect(registerBtn.textContent).toBe('Register');
    });

    it('should show error message and re-enable button on network error', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ code: 'NetworkError', message: 'Network failure' }, null);
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');
      const registerBtn = document.getElementById('register-btn');
      const registerError = document.getElementById('register-error');

      emailInput.value = 'network@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(registerError.textContent).toBe('Could not send verification code. Please try again.');
      expect(registerBtn.disabled).toBe(false);
      expect(registerBtn.textContent).toBe('Register');
    });

    it('should show error message and re-enable button on unexpected error', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ code: 'InternalErrorException', message: 'Something went wrong' }, null);
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');
      const registerBtn = document.getElementById('register-btn');
      const registerError = document.getElementById('register-error');

      emailInput.value = 'error@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      expect(registerError.textContent).toBe('Could not send verification code. Please try again.');
      expect(registerBtn.disabled).toBe(false);
      expect(registerBtn.textContent).toBe('Register');
    });
  });

  describe('Requirement 3.5: Email is preserved for verification step', () => {
    it('should use the submitted email for the verification step after successful resend', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');
      const form = document.getElementById('register-form');

      emailInput.value = 'stored@example.com';
      passwordInput.value = 'Password1!';

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      // Verify the verify step is shown (email stored internally for confirmation)
      const verifyStep = document.getElementById('verify-step');
      expect(verifyStep.classList.contains('hidden')).toBe(false);

      // The CognitoUser was constructed with the correct email for resend
      expect(mockCognitoUserConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ Username: 'stored@example.com' })
      );
    });
  });
});
