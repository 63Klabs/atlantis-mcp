/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { resolve } from 'path';
import { loadPage, executePageScripts } from '../helpers/load-page.mjs';

/**
 * Tests for the Resend_Controller on the forgot-password page.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 12.6
 *
 * The resend controller is identical in shape to the register page's resend
 * controller (resendState: maxResends=3, cooldownMs=30000, initialDelayMs=30000)
 * but calls `CognitoUser.forgotPassword()` rather than `resendConfirmationCode()`.
 *
 * All timing assertions use Jest fake timers; no real delays are introduced.
 */

const HTML_PATH = resolve(
  import.meta.dirname,
  '../../public/forgot-password/index.html'
);

describe('Forgot-Password Page - Resend Controller', () => {
  /** @type {string} */
  let html;

  /**
   * Stable mock references so tests can control callback behaviour
   * across multiple CognitoUser instantiations.
   */
  let mocks;

  beforeEach(() => {
    jest.useFakeTimers();

    // Build Cognito mock with stable references.
    // forgotPassword is used by both the request step AND the resend button,
    // so we capture it as a single mockFn that tests override per scenario.
    const mockForgotPassword = jest.fn();
    const mockResendConfirmationCode = jest.fn();
    const mockConfirmPassword = jest.fn();
    const mockCognitoUser = {
      forgotPassword: mockForgotPassword,
      resendConfirmationCode: mockResendConfirmationCode,
      confirmPassword: mockConfirmPassword,
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

    mocks = { mockForgotPassword, mockCognitoUser };

    html = loadPage(HTML_PATH);
    document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
    executePageScripts(html, HTML_PATH);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // ---------------------------------------------------------------------------
  // Helper: advance the page to the Confirm_Step so the resend timer is running.
  //
  // It submits the request form with a valid email and triggers the
  // `inputVerificationCode` callback synchronously, which is the normal path
  // Cognito takes after dispatching the code email.
  // ---------------------------------------------------------------------------

  /**
   * Submit the request-step form with a test email and fire the
   * `inputVerificationCode` callback immediately so the confirm step is shown
   * and the initial 30-second resend timer is running.
   *
   * @param {string} [email='test@example.com'] - Email to use.
   */
  function advanceToConfirmStep(email = 'test@example.com') {
    // Configure forgotPassword to call inputVerificationCode immediately
    mocks.mockForgotPassword.mockImplementation((callbacks) => {
      callbacks.inputVerificationCode();
    });

    const emailInput = document.getElementById('email');
    emailInput.value = email;

    const form = document.getElementById('reset-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // The confirm step is now visible and the initial delay timer has started.
    // Reset forgotPassword mock so subsequent calls (resend) can be controlled
    // independently by each test.
    mocks.mockForgotPassword.mockReset();
  }

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state before confirm step', () => {
    it('should have resend container hidden initially', () => {
      const resendContainer = document.getElementById('resend-container');
      expect(resendContainer).not.toBeNull();
      expect(resendContainer.classList.contains('hidden')).toBe(true);
    });

    it('should have resend button with the correct aria-label', () => {
      const resendBtn = document.getElementById('resend-btn');
      expect(resendBtn).not.toBeNull();
      expect(resendBtn.getAttribute('aria-label')).toBe('Resend reset code to your email');
    });
  });

  // ---------------------------------------------------------------------------
  // Requirement 5.1: 30-second initial delay before resend container appears
  // ---------------------------------------------------------------------------

  describe('Initial delay (Requirement 5.1)', () => {
    it('should keep resend container hidden immediately after confirm step is shown', () => {
      advanceToConfirmStep();

      const resendContainer = document.getElementById('resend-container');
      expect(resendContainer.classList.contains('hidden')).toBe(true);
    });

    it('should still hide resend container at 29 seconds', () => {
      advanceToConfirmStep();

      jest.advanceTimersByTime(29000);

      const resendContainer = document.getElementById('resend-container');
      expect(resendContainer.classList.contains('hidden')).toBe(true);
    });

    it('should reveal resend container after 30 seconds (Requirement 5.1)', () => {
      advanceToConfirmStep();

      jest.advanceTimersByTime(30000);

      const resendContainer = document.getElementById('resend-container');
      expect(resendContainer.classList.contains('hidden')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Helper: advance past the initial delay so the resend button is visible.
  // ---------------------------------------------------------------------------

  /**
   * Advance the page to the confirm step and then past the 30-second initial
   * delay so the resend container and button are visible and enabled.
   *
   * @param {string} [email='test@example.com'] - Email to use.
   */
  function setupConfirmStepWithResendVisible(email = 'test@example.com') {
    advanceToConfirmStep(email);
    jest.advanceTimersByTime(30000);
  }

  // ---------------------------------------------------------------------------
  // Requirement 5.6: Button is disabled while the resend request is in flight
  // ---------------------------------------------------------------------------

  describe('Button disabled during flight (Requirement 5.6)', () => {
    it('should disable the resend button immediately on click', () => {
      setupConfirmStepWithResendVisible();

      // Hang the forgotPassword call — don't fire any callback yet
      mocks.mockForgotPassword.mockImplementation(() => {
        // pending, no callback
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      expect(resendBtn.disabled).toBe(true);
      expect(mocks.mockForgotPassword).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Requirement 5.3: Cooldown after a successful resend
  // ---------------------------------------------------------------------------

  describe('Cooldown after success (Requirement 5.3)', () => {
    it('should hide resend container immediately after a successful resend', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode();
      });

      const resendBtn = document.getElementById('resend-btn');
      const resendContainer = document.getElementById('resend-container');
      resendBtn.click();

      expect(resendContainer.classList.contains('hidden')).toBe(true);
    });

    it('should keep resend container hidden for 29 seconds after a successful resend', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode();
      });

      const resendBtn = document.getElementById('resend-btn');
      const resendContainer = document.getElementById('resend-container');
      resendBtn.click();

      jest.advanceTimersByTime(29000);
      expect(resendContainer.classList.contains('hidden')).toBe(true);
    });

    it('should reveal resend container again after the 30-second cooldown', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode();
      });

      const resendBtn = document.getElementById('resend-btn');
      const resendContainer = document.getElementById('resend-container');
      resendBtn.click();

      jest.advanceTimersByTime(30000);
      expect(resendContainer.classList.contains('hidden')).toBe(false);
    });

    it('should re-enable the resend button after the 30-second cooldown', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode();
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      jest.advanceTimersByTime(30000);
      expect(resendBtn.disabled).toBe(false);
    });

    it('should show a confirmation message after a successful resend', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode();
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus.textContent).toContain('new reset code has been sent');
      expect(resendStatus.classList.contains('visible')).toBe(true);
    });

    it('should show a confirmation message when onSuccess is called instead of inputVerificationCode', () => {
      // Some Cognito SDK versions call onSuccess instead
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.onSuccess();
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus.textContent).toContain('new reset code has been sent');
    });
  });

  // ---------------------------------------------------------------------------
  // Requirement 5.4: 3-attempt cap
  // ---------------------------------------------------------------------------

  describe('3-attempt cap (Requirement 5.4)', () => {
    it('should permanently disable the button after 3 successful resends', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode();
      });

      const resendBtn = document.getElementById('resend-btn');

      // First resend
      resendBtn.click();
      jest.advanceTimersByTime(30000); // cooldown

      // Second resend
      resendBtn.click();
      jest.advanceTimersByTime(30000); // cooldown

      // Third resend — hits the cap
      resendBtn.click();

      expect(resendBtn.disabled).toBe(true);
    });

    it('should display a max-attempts message after 3 successful resends', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode();
      });

      const resendBtn = document.getElementById('resend-btn');

      resendBtn.click();
      jest.advanceTimersByTime(30000);
      resendBtn.click();
      jest.advanceTimersByTime(30000);
      resendBtn.click();

      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus.textContent).toContain('Maximum resend attempts reached');
    });

    it('should not re-enable button even after cooldown time passes after reaching the cap', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode();
      });

      const resendBtn = document.getElementById('resend-btn');

      resendBtn.click();
      jest.advanceTimersByTime(30000);
      resendBtn.click();
      jest.advanceTimersByTime(30000);
      resendBtn.click();

      // Well past any cooldown
      jest.advanceTimersByTime(60000);

      expect(resendBtn.disabled).toBe(true);
    });

    it('should count only successful resends towards the cap', () => {
      // Requirement 5.5 / 5.4 interaction: failed attempts don't consume the budget
      setupConfirmStepWithResendVisible();

      const resendBtn = document.getElementById('resend-btn');

      // First attempt: fails
      mocks.mockForgotPassword.mockImplementationOnce((callbacks) => {
        callbacks.onFailure({ message: 'Network error' });
      });
      resendBtn.click();
      expect(resendBtn.disabled).toBe(false); // re-enabled immediately on failure

      // Second attempt: succeeds (count = 1)
      mocks.mockForgotPassword.mockImplementationOnce((callbacks) => {
        callbacks.inputVerificationCode();
      });
      resendBtn.click();
      jest.advanceTimersByTime(30000); // cooldown

      // Third attempt: succeeds (count = 2)
      mocks.mockForgotPassword.mockImplementationOnce((callbacks) => {
        callbacks.inputVerificationCode();
      });
      resendBtn.click();
      jest.advanceTimersByTime(30000); // cooldown

      // Fourth attempt: succeeds (count = 3 → permanently disabled)
      mocks.mockForgotPassword.mockImplementationOnce((callbacks) => {
        callbacks.inputVerificationCode();
      });
      resendBtn.click();

      expect(resendBtn.disabled).toBe(true);
      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus.textContent).toContain('Maximum resend attempts reached');
    });
  });

  // ---------------------------------------------------------------------------
  // Requirement 5.5: Failure path
  // ---------------------------------------------------------------------------

  describe('Failure path (Requirement 5.5)', () => {
    it('should show an error message on resend failure', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.onFailure({ message: 'Too many requests' });
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus.textContent).toBe('Too many requests');
      expect(resendStatus.classList.contains('alert-error')).toBe(true);
    });

    it('should re-enable the button after a failed resend', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.onFailure({ message: 'Network error' });
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      expect(resendBtn.disabled).toBe(false);
    });

    it('should NOT increment the attempt count after a failed resend', () => {
      setupConfirmStepWithResendVisible();

      const resendBtn = document.getElementById('resend-btn');

      // Three failing attempts — none should increment the count
      for (let i = 0; i < 3; i++) {
        mocks.mockForgotPassword.mockImplementationOnce((callbacks) => {
          callbacks.onFailure({ message: 'Error' });
        });
        resendBtn.click();
      }

      // Button should still be enabled (cap not reached)
      expect(resendBtn.disabled).toBe(false);

      // Now do a successful resend and confirm the button is only hidden for cooldown,
      // not permanently disabled (success count was 0, cap is 3)
      mocks.mockForgotPassword.mockImplementationOnce((callbacks) => {
        callbacks.inputVerificationCode();
      });
      resendBtn.click();

      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus.textContent).toContain('new reset code has been sent');
    });

    it('should show a generic error when failure provides no message', () => {
      setupConfirmStepWithResendVisible();

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.onFailure({}); // no message property
      });

      const resendBtn = document.getElementById('resend-btn');
      resendBtn.click();

      const resendStatus = document.getElementById('resend-status');
      expect(resendStatus.textContent.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Requirement 5.7: No double timer — pending timer is cleared before a new one
  // ---------------------------------------------------------------------------

  describe('Timer hygiene (Requirement 5.7)', () => {
    it('should not accumulate multiple timers when resend is triggered quickly', () => {
      // Verify that after a successful resend, a new call to advanceToConfirmStep
      // (which would re-start the initial delay timer) clears the old one.
      // We test this by confirming the container appears exactly once at 30s,
      // not earlier due to a stale timer from the confirm-step transition.
      advanceToConfirmStep();

      // The initial delay timer starts when the confirm step appears.
      // We do a successful resend which hides the container and schedules a
      // 30s cooldown timer.
      jest.advanceTimersByTime(30000); // initial delay fires → container visible

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode(); // success → count=1, hides container, starts cooldown
      });

      const resendBtn = document.getElementById('resend-btn');
      const resendContainer = document.getElementById('resend-container');
      resendBtn.click();

      expect(resendContainer.classList.contains('hidden')).toBe(true);

      // Advance 15 seconds — still in cooldown, should still be hidden
      jest.advanceTimersByTime(15000);
      expect(resendContainer.classList.contains('hidden')).toBe(true);

      // Advance another 15 seconds — cooldown expires at 30s
      jest.advanceTimersByTime(15000);
      expect(resendContainer.classList.contains('hidden')).toBe(false);
    });

    it('should clear any pending timer before the cooldown schedules a new one', () => {
      // Simulate: confirm step shown → initial timer T1 starts.
      // Before T1 fires (< 30s), a successful resend happens. The resend handler
      // should cancel T1 and start cooldown timer T2. The container must not
      // become visible at T1's original expiry (30s from confirm-step) but only
      // at T2's expiry (30s from resend success).
      advanceToConfirmStep();

      // Advance only 15 seconds — T1 has NOT fired yet
      jest.advanceTimersByTime(15000);

      // Reveal the resend container manually (as if the initial delay had fired),
      // so we can test that clicking resend hides it again
      const resendContainer = document.getElementById('resend-container');
      resendContainer.classList.remove('hidden');
      const resendBtn = document.getElementById('resend-btn');

      mocks.mockForgotPassword.mockImplementation((callbacks) => {
        callbacks.inputVerificationCode(); // triggers cooldown timer
      });

      resendBtn.click();

      // Container should be hidden immediately after success
      expect(resendContainer.classList.contains('hidden')).toBe(true);

      // Advance 15 more seconds — this would be t=30 from confirm step, where T1
      // would have fired if not cleared. Container should still be hidden because
      // the cooldown timer T2 started only 15s ago.
      jest.advanceTimersByTime(15000);
      expect(resendContainer.classList.contains('hidden')).toBe(true);

      // Advance 15 more seconds — T2 fires at 30s from resend success
      jest.advanceTimersByTime(15000);
      expect(resendContainer.classList.contains('hidden')).toBe(false);
    });
  });
});
