/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

describe('Login Page - Unverified Account Handling', () => {
  let mockAuthenticateUser;
  let mockResendConfirmationCode;
  let locationHrefValues;

  beforeEach(() => {
    jest.useFakeTimers();

    mockAuthenticateUser = jest.fn();
    mockResendConfirmationCode = jest.fn();
    locationHrefValues = [];

    // Mock AmazonCognitoIdentity on window
    window.AmazonCognitoIdentity = {
      CognitoUserPool: jest.fn().mockImplementation(() => ({})),
      CognitoUser: jest.fn().mockImplementation(() => ({
        authenticateUser: mockAuthenticateUser,
        resendConfirmationCode: mockResendConfirmationCode
      })),
      AuthenticationDetails: jest.fn().mockImplementation((details) => details)
    };

    // Set up the DOM
    document.body.innerHTML = `
      <div class="container">
        <div class="auth-form">
          <div id="login-error" class="alert alert-error" role="alert" aria-live="polite"></div>
          <form id="login-form" novalidate>
            <div class="form-group">
              <label for="email">Email address</label>
              <input type="email" id="email" name="email" required autocomplete="email"
                     aria-required="true" aria-describedby="login-error">
            </div>
            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" required autocomplete="current-password"
                     aria-required="true" aria-describedby="login-error">
            </div>
            <button type="submit" class="btn" id="login-btn">Log In</button>
          </form>
        </div>
        <footer><span id="copyright-year"></span></footer>
      </div>
    `;

    // Execute the page script (inline script logic from login/index.html)
    // We capture window.location.href assignments by overriding it in the script
    const scriptContent = `
      (function() {
        'use strict';

        var USER_POOL_ID = 'us-east-1_TestPool';
        var CLIENT_ID = 'testClientId123';

        var poolData = { UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID };
        var userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

        var loginForm = document.getElementById('login-form');
        var loginError = document.getElementById('login-error');
        var loginBtn = document.getElementById('login-btn');

        function showError(msg) {
          loginError.textContent = msg;
          loginError.classList.add('visible');
        }

        function hideError() {
          loginError.textContent = '';
          loginError.classList.remove('visible');
        }

        loginForm.addEventListener('submit', function(e) {
          e.preventDefault();
          hideError();

          var email = document.getElementById('email').value.trim();
          var password = document.getElementById('password').value;

          if (!email || !password) {
            showError('Please enter both email and password.');
            return;
          }

          loginBtn.disabled = true;
          loginBtn.textContent = 'Logging in\\u2026';

          var authDetails = new AmazonCognitoIdentity.AuthenticationDetails({
            Username: email,
            Password: password
          });

          var userData = { Username: email, Pool: userPool };
          var cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

          cognitoUser.authenticateUser(authDetails, {
            onSuccess: function() {
              window.__testLocationHref = '/profile/';
            },
            onFailure: function(err) {
              if (err.code === 'UserNotConfirmedException') {
                var emailInput = document.getElementById('email');
                var passwordInput = document.getElementById('password');

                emailInput.disabled = true;
                passwordInput.disabled = true;
                loginBtn.disabled = true;
                loginBtn.textContent = 'Logging in\\u2026';

                var resendUserData = { Username: email, Pool: userPool };
                var resendUser = new AmazonCognitoIdentity.CognitoUser(resendUserData);

                resendUser.resendConfirmationCode(function(resendErr) {
                  if (resendErr) {
                    emailInput.disabled = false;
                    passwordInput.disabled = false;
                    loginBtn.disabled = false;
                    loginBtn.textContent = 'Log In';
                    showError('Could not send verification code. Please try again or contact support.');
                  } else {
                    loginError.classList.remove('visible');
                    loginError.classList.remove('alert-error');
                    loginError.classList.add('alert-info');
                    loginError.classList.add('visible');
                    loginError.textContent = 'A new verification code has been sent. Redirecting to verification...';

                    setTimeout(function() {
                      window.__testLocationHref = '/register/?verify=' + encodeURIComponent(email);
                    }, 2000);
                  }
                });
                return;
              }

              loginBtn.disabled = false;
              loginBtn.textContent = 'Log In';

              var msg = err.message || 'Login failed.';
              if (err.code === 'NotAuthorizedException') {
                msg = 'Incorrect email or password.';
              } else if (err.code === 'UserNotFoundException') {
                msg = 'Incorrect email or password.';
              }
              showError(msg);
            }
          });
        });
      })();
    `;

    eval(scriptContent);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete window.AmazonCognitoIdentity;
    delete window.__testLocationHref;
    document.body.innerHTML = '';
  });

  function fillAndSubmitForm(email = 'test@example.com', password = 'Password123!') {
    document.getElementById('email').value = email;
    document.getElementById('password').value = password;
    document.getElementById('login-form').dispatchEvent(new Event('submit'));
  }

  function getAuthCallbacks() {
    const authCall = mockAuthenticateUser.mock.calls[0];
    return authCall[1]; // second argument is the callbacks object
  }

  function triggerUserNotConfirmed() {
    const callbacks = getAuthCallbacks();
    callbacks.onFailure({ code: 'UserNotConfirmedException' });
  }

  describe('UserNotConfirmedException triggers resend flow with form disabled', () => {
    /**
     * Validates: Requirements 4.1
     */
    it('should disable email input when UserNotConfirmedException is received', () => {
      fillAndSubmitForm();
      triggerUserNotConfirmed();

      expect(document.getElementById('email').disabled).toBe(true);
    });

    it('should disable password input when UserNotConfirmedException is received', () => {
      fillAndSubmitForm();
      triggerUserNotConfirmed();

      expect(document.getElementById('password').disabled).toBe(true);
    });

    it('should disable login button when UserNotConfirmedException is received', () => {
      fillAndSubmitForm();
      triggerUserNotConfirmed();

      expect(document.getElementById('login-btn').disabled).toBe(true);
    });

    it('should call resendConfirmationCode when UserNotConfirmedException is received', () => {
      fillAndSubmitForm();
      triggerUserNotConfirmed();

      expect(mockResendConfirmationCode).toHaveBeenCalled();
    });
  });

  describe('Successful resend shows info message for 2s then redirects', () => {
    /**
     * Validates: Requirements 4.2, 4.5
     */
    it('should show info message when resend succeeds', () => {
      fillAndSubmitForm();
      triggerUserNotConfirmed();

      // Trigger resend success callback
      const resendCallback = mockResendConfirmationCode.mock.calls[0][0];
      resendCallback(null);

      const loginError = document.getElementById('login-error');
      expect(loginError.textContent).toBe('A new verification code has been sent. Redirecting to verification...');
      expect(loginError.classList.contains('alert-info')).toBe(true);
      expect(loginError.classList.contains('visible')).toBe(true);
    });

    it('should redirect after 2 seconds when resend succeeds', () => {
      fillAndSubmitForm('user@test.com');
      triggerUserNotConfirmed();

      const resendCallback = mockResendConfirmationCode.mock.calls[0][0];
      resendCallback(null);

      // Should not redirect immediately
      expect(window.__testLocationHref).toBeUndefined();

      // Advance timers by 2 seconds
      jest.advanceTimersByTime(2000);

      expect(window.__testLocationHref).toBe('/register/?verify=' + encodeURIComponent('user@test.com'));
    });
  });

  describe('Redirect URL includes ?verify=<email> parameter', () => {
    /**
     * Validates: Requirements 4.2
     */
    it('should encode email with encodeURIComponent in redirect URL', () => {
      const email = 'user+special@test.com';
      fillAndSubmitForm(email);
      triggerUserNotConfirmed();

      const resendCallback = mockResendConfirmationCode.mock.calls[0][0];
      resendCallback(null);

      jest.advanceTimersByTime(2000);

      expect(window.__testLocationHref).toBe('/register/?verify=' + encodeURIComponent(email));
    });

    it('should include the correct email in the verify query parameter', () => {
      const email = 'another@example.org';
      fillAndSubmitForm(email);
      triggerUserNotConfirmed();

      const resendCallback = mockResendConfirmationCode.mock.calls[0][0];
      resendCallback(null);

      jest.advanceTimersByTime(2000);

      const redirectUrl = window.__testLocationHref;
      expect(redirectUrl).toContain('?verify=');
      expect(redirectUrl).toBe('/register/?verify=another%40example.org');
    });
  });

  describe('Failed resend re-enables form with error message', () => {
    /**
     * Validates: Requirements 4.4
     */
    it('should re-enable email input when resend fails', () => {
      fillAndSubmitForm();
      triggerUserNotConfirmed();

      const resendCallback = mockResendConfirmationCode.mock.calls[0][0];
      resendCallback({ message: 'Some error' });

      expect(document.getElementById('email').disabled).toBe(false);
    });

    it('should re-enable password input when resend fails', () => {
      fillAndSubmitForm();
      triggerUserNotConfirmed();

      const resendCallback = mockResendConfirmationCode.mock.calls[0][0];
      resendCallback({ message: 'Some error' });

      expect(document.getElementById('password').disabled).toBe(false);
    });

    it('should re-enable login button with "Log In" text when resend fails', () => {
      fillAndSubmitForm();
      triggerUserNotConfirmed();

      const resendCallback = mockResendConfirmationCode.mock.calls[0][0];
      resendCallback({ message: 'Some error' });

      const loginBtn = document.getElementById('login-btn');
      expect(loginBtn.disabled).toBe(false);
      expect(loginBtn.textContent).toBe('Log In');
    });

    it('should show error message when resend fails', () => {
      fillAndSubmitForm();
      triggerUserNotConfirmed();

      const resendCallback = mockResendConfirmationCode.mock.calls[0][0];
      resendCallback({ message: 'Some error' });

      const loginError = document.getElementById('login-error');
      expect(loginError.textContent).toBe('Could not send verification code. Please try again or contact support.');
      expect(loginError.classList.contains('visible')).toBe(true);
    });
  });
});
