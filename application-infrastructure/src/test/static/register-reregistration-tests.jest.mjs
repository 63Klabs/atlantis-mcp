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
 * with an email that already exists in Cognito.
 *
 * Flow: UsernameExistsException → authenticateUser to check account state
 *   - UserNotConfirmedException → resendConfirmationCode → verify step
 *   - onSuccess or NotAuthorizedException → "account exists, please log in"
 */
describe('Registration Page - Re-registration of Unverified Accounts', () => {
  let mockSignUp;
  let mockResendConfirmationCode;
  let mockAuthenticateUser;
  let mockCognitoUserConstructor;

  beforeEach(() => {
    jest.useFakeTimers();

    mockResendConfirmationCode = jest.fn();
    mockAuthenticateUser = jest.fn();
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
          resendConfirmationCode: mockResendConfirmationCode,
          authenticateUser: mockAuthenticateUser
        };
      }),
      CognitoUserAttribute: jest.fn().mockImplementation((data) => data),
      AuthenticationDetails: jest.fn().mockImplementation((data) => data)
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

    // Add copyright-year element if missing
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

  function submitRegistrationForm(email = 'test@example.com', password = 'Password1!') {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const form = document.getElementById('register-form');

    emailInput.value = email;
    passwordInput.value = password;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  function getAuthCallbacks() {
    const call = mockAuthenticateUser.mock.calls[0];
    return call[1]; // second argument is the callbacks object
  }

  describe('Requirement 3.1: UsernameExistsException triggers authentication check', () => {
    it('should disable submit button and show loading state when UsernameExistsException occurs', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      // authenticateUser does not call back yet (pending)
      mockAuthenticateUser.mockImplementation(() => {});

      submitRegistrationForm();

      const registerBtn = document.getElementById('register-btn');
      expect(registerBtn.disabled).toBe(true);
      expect(registerBtn.textContent).toBe('Verifying…');
    });

    it('should call authenticateUser to check account state', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation(() => {});

      submitRegistrationForm('user@domain.com', 'SecurePass1!');

      expect(mockAuthenticateUser).toHaveBeenCalled();
      expect(mockCognitoUserConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ Username: 'user@domain.com' })
      );
    });
  });

  describe('Requirement 3.2: Unverified account transitions to verify step', () => {
    it('should call resendConfirmationCode when authenticateUser returns UserNotConfirmedException', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onFailure({ code: 'UserNotConfirmedException' });
      });
      mockResendConfirmationCode.mockImplementation(() => {});

      submitRegistrationForm();

      expect(mockResendConfirmationCode).toHaveBeenCalled();
    });

    it('should hide register step and show verify step on successful resend', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onFailure({ code: 'UserNotConfirmedException' });
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      submitRegistrationForm();

      const registerStep = document.getElementById('register-step');
      const verifyStep = document.getElementById('verify-step');

      expect(registerStep.classList.contains('hidden')).toBe(true);
      expect(verifyStep.classList.contains('hidden')).toBe(false);
    });

    it('should focus the verification code input after successful resend', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onFailure({ code: 'UserNotConfirmedException' });
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      const codeInput = document.getElementById('verification-code');
      const focusSpy = jest.spyOn(codeInput, 'focus');

      submitRegistrationForm();

      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe('Requirement 3.3: Confirmed account shows "account exists" message', () => {
    it('should show "account exists" message when authenticateUser succeeds (correct password)', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onSuccess({});
      });

      submitRegistrationForm('verified@example.com');

      const registerError = document.getElementById('register-error');
      expect(registerError.textContent).toBe('An account with this email already exists. Please log in.');
    });

    it('should show "account exists" message when authenticateUser returns NotAuthorizedException (wrong password)', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onFailure({ code: 'NotAuthorizedException', message: 'Incorrect username or password.' });
      });

      submitRegistrationForm('verified@example.com');

      const registerError = document.getElementById('register-error');
      expect(registerError.textContent).toBe('An account with this email already exists. Please log in.');
    });

    it('should re-enable submit button with "Register" text on confirmed account', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onFailure({ code: 'NotAuthorizedException', message: 'Incorrect username or password.' });
      });

      submitRegistrationForm('verified@example.com');

      const registerBtn = document.getElementById('register-btn');
      expect(registerBtn.disabled).toBe(false);
      expect(registerBtn.textContent).toBe('Register');
    });

    it('should not call resendConfirmationCode when account is confirmed', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onFailure({ code: 'NotAuthorizedException', message: 'Incorrect username or password.' });
      });

      submitRegistrationForm();

      expect(mockResendConfirmationCode).not.toHaveBeenCalled();
    });
  });

  describe('Requirement 3.4: Resend errors re-enable submit button with error message', () => {
    it('should show error message and re-enable button when resend fails', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onFailure({ code: 'UserNotConfirmedException' });
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ code: 'LimitExceededException', message: 'Too many attempts' }, null);
      });

      submitRegistrationForm('limited@example.com');

      const registerError = document.getElementById('register-error');
      const registerBtn = document.getElementById('register-btn');

      expect(registerError.textContent).toBe('Could not send verification code. Please try again.');
      expect(registerBtn.disabled).toBe(false);
      expect(registerBtn.textContent).toBe('Register');
    });

    it('should show error message and re-enable button on network error during resend', () => {
      mockSignUp.mockImplementation((email, password, attrs, validation, callback) => {
        callback({ code: 'UsernameExistsException', message: 'User already exists' }, null);
      });
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onFailure({ code: 'UserNotConfirmedException' });
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback({ code: 'NetworkError', message: 'Network failure' }, null);
      });

      submitRegistrationForm('network@example.com');

      const registerError = document.getElementById('register-error');
      const registerBtn = document.getElementById('register-btn');

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
      mockAuthenticateUser.mockImplementation((authDetails, callbacks) => {
        callbacks.onFailure({ code: 'UserNotConfirmedException' });
      });
      mockResendConfirmationCode.mockImplementation((callback) => {
        callback(null, 'SUCCESS');
      });

      submitRegistrationForm('stored@example.com');

      // Verify the verify step is shown
      const verifyStep = document.getElementById('verify-step');
      expect(verifyStep.classList.contains('hidden')).toBe(false);

      // The CognitoUser was constructed with the correct email
      expect(mockCognitoUserConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ Username: 'stored@example.com' })
      );
    });
  });
});
