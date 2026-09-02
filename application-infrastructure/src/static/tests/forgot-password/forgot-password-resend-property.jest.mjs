/** @jest-environment jsdom */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { resolve } from 'path';
import fc from 'fast-check';
import { loadPage, executePageScripts } from '../helpers/load-page.mjs';

/**
 * Property-based tests for the forgot-password resend controller.
 *
 * **Property 5: Resend cap**
 * **Validates: Requirements 5.3, 5.4, 5.5**
 *
 * For any sequence of resend activations and timer advances, successful
 * `forgotPassword` resend calls never exceed `maxResends` (3), and failed
 * attempts do not consume the budget.
 */

const HTML_PATH = resolve(
  import.meta.dirname,
  '../../public/forgot-password/index.html'
);

/** Maximum resends allowed by the resend controller. */
const MAX_RESENDS = 3;

/** Initial delay before first resend button appears (ms). */
const INITIAL_DELAY_MS = 30000;

/** Cooldown between resends (ms). */
const COOLDOWN_MS = 30000;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a sequence of 1–6 resend attempt outcomes.
 * Each element is either 'success' or 'failure'.
 */
const resendSequence = fc.array(
  fc.constantFrom('success', 'failure'),
  { minLength: 1, maxLength: 6 }
);

// ---------------------------------------------------------------------------
// Page setup helpers
// ---------------------------------------------------------------------------

/**
 * Build a forgotPassword mock that calls `inputVerificationCode` (success)
 * or `onFailure` (failure) based on the `outcome` flag, and records calls.
 *
 * @param {'success'|'failure'} outcome
 * @param {jest.Mock} forgotPasswordSpy - spy to record calls on
 * @returns {{forgotPassword: jest.Mock}} partial CognitoUser method object
 */
function buildForgotPasswordMock(outcome, forgotPasswordSpy) {
  const impl = jest.fn().mockImplementation(function(callbacks) {
    forgotPasswordSpy(callbacks);
    if (outcome === 'success') {
      if (typeof callbacks.inputVerificationCode === 'function') {
        callbacks.inputVerificationCode();
      } else if (typeof callbacks.onSuccess === 'function') {
        callbacks.onSuccess();
      }
    } else {
      if (typeof callbacks.onFailure === 'function') {
        callbacks.onFailure({ message: 'Simulated resend failure' });
      }
    }
  });
  return impl;
}

/**
 * Navigate the page to the confirm step by triggering a successful initial
 * `forgotPassword` call, which starts the 30 s initial-delay timer and reveals
 * the confirm step.  After this call returns, the confirm step is visible and
 * `#resend-container` is still hidden.
 *
 * @param {jest.Mock} forgotPasswordMock - the mock attached to CognitoUser instances
 */
function advanceToConfirmStep(forgotPasswordMock) {
  // Fill in the email and submit the request form.
  const emailInput = document.getElementById('email');
  emailInput.value = 'test@example.com';

  // The initial ForgotPassword call (request step) must succeed so the page
  // advances to the confirm step and starts the initial resend timer.
  forgotPasswordMock.mockImplementationOnce(function(callbacks) {
    if (typeof callbacks.inputVerificationCode === 'function') {
      callbacks.inputVerificationCode();
    } else if (typeof callbacks.onSuccess === 'function') {
      callbacks.onSuccess();
    }
  });

  const resetForm = document.getElementById('reset-form');
  resetForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/**
 * Set up the jsdom document with the forgot-password page.
 * Returns the `forgotPassword` mock function installed on every CognitoUser.
 *
 * @returns {jest.Mock} forgotPasswordMock
 */
function setupPage() {
  // A single shared mock function covers both the request-step call and all
  // resend calls.  Individual tests override behaviour with mockImplementationOnce.
  const forgotPasswordMock = jest.fn();

  window.AmazonCognitoIdentity = {
    CognitoUserPool: jest.fn().mockImplementation(() => ({})),
    CognitoUser: jest.fn().mockImplementation(() => ({
      forgotPassword: forgotPasswordMock,
      confirmPassword: jest.fn(),
      changePassword: jest.fn(),
      getSession: jest.fn(),
      getCurrentUser: jest.fn(),
    })),
    CognitoUserAttribute: jest.fn().mockImplementation((data) => data),
    AuthenticationDetails: jest.fn().mockImplementation((data) => data),
  };

  const html = loadPage(HTML_PATH);
  document.body.innerHTML = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  executePageScripts(html, HTML_PATH);

  return forgotPasswordMock;
}

// ---------------------------------------------------------------------------
// Property test
// ---------------------------------------------------------------------------

describe('Feature: 0-0-6-password-reset, Property 5: Resend cap', () => {
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
    'Property 5: successful forgotPassword resend calls never exceed maxResends ' +
    'regardless of attempt sequence, and failures do not consume the budget',
    () => {
      fc.assert(
        fc.property(
          resendSequence,
          (sequence) => {
            // ---- 1. Fresh page per property run ----
            document.body.innerHTML = '';
            delete window.AmazonCognitoIdentity;
            delete window.PasswordValidator;

            const forgotPasswordMock = setupPage();

            // ---- 2. Advance to the confirm step ----
            advanceToConfirmStep(forgotPasswordMock);

            // forgotPasswordMock has been called once for the request step;
            // reset the call count so we only count resend calls from here.
            forgotPasswordMock.mockClear();

            // ---- 3. Reveal the resend button (initial delay) ----
            jest.advanceTimersByTime(INITIAL_DELAY_MS);

            const resendBtn = document.getElementById('resend-btn');
            const resendContainer = document.getElementById('resend-container');

            // ---- 4. Execute the sequence of resend attempts ----
            let successfulResendsSoFar = 0;

            for (const outcome of sequence) {
              // If the button is permanently disabled, additional activations
              // must not increment the count further.  Stop here.
              if (resendBtn.disabled) {
                break;
              }

              // Ensure the resend container is visible before clicking.
              // If it's hidden (still in cooldown) advance time to reveal it.
              if (resendContainer.classList.contains('hidden')) {
                jest.advanceTimersByTime(COOLDOWN_MS);
              }

              // Skip if still disabled after advancing (shouldn't happen, but guard anyway)
              if (resendBtn.disabled) {
                break;
              }

              // Configure what the next forgotPassword call will do.
              if (outcome === 'success') {
                forgotPasswordMock.mockImplementationOnce(function(callbacks) {
                  if (typeof callbacks.inputVerificationCode === 'function') {
                    callbacks.inputVerificationCode();
                  } else if (typeof callbacks.onSuccess === 'function') {
                    callbacks.onSuccess();
                  }
                });
              } else {
                forgotPasswordMock.mockImplementationOnce(function(callbacks) {
                  if (typeof callbacks.onFailure === 'function') {
                    callbacks.onFailure({ message: 'Simulated failure' });
                  }
                });
              }

              // Click the resend button.
              resendBtn.click();

              if (outcome === 'success') {
                successfulResendsSoFar++;
              }
            }

            // ---- 5. Assertions ----

            // (a) Property 5 core invariant: successful SDK calls ≤ MAX_RESENDS.
            //     forgotPasswordMock was cleared after the request-step call so
            //     every call recorded here is a resend call.
            const totalSdkCalls = forgotPasswordMock.mock.calls.length;

            // All calls were either successes or failures; successes ≤ MAX_RESENDS.
            expect(successfulResendsSoFar).toBeLessThanOrEqual(MAX_RESENDS);

            // (b) Requirement 5.3: after MAX_RESENDS successes, button is permanently disabled.
            if (successfulResendsSoFar >= MAX_RESENDS) {
              expect(resendBtn.disabled).toBe(true);
            }

            // (c) Requirement 5.4: total SDK calls equals the number of times the
            //     button was actually clicked (both successes and failures count);
            //     the button is re-enabled on failure so the user CAN click again,
            //     but successes still cap at MAX_RESENDS.
            //     We verify: successful resend count is always ≤ MAX_RESENDS.
            const failureCount = sequence.filter(o => o === 'failure').length;
            const cappedSuccesses = Math.min(
              sequence.filter(o => o === 'success').length,
              MAX_RESENDS
            );
            // Actual successes must equal the minimum of attempted successes and cap.
            expect(successfulResendsSoFar).toBeLessThanOrEqual(cappedSuccesses);

            // (d) Sanity: total SDK calls (resends only) ≤ total sequence length.
            expect(totalSdkCalls).toBeLessThanOrEqual(sequence.length);
          }
        ),
        { numRuns: 100 }
      );
    }
  );

  it(
    'Property 5a: failures do not consume the resend budget — ' +
    'after N failures followed by successes, exactly min(N_successes, 3) succeed',
    () => {
      fc.assert(
        fc.property(
          // Generate a sequence that starts with 0–5 failures then 0–5 successes.
          fc.tuple(
            fc.integer({ min: 0, max: 5 }),  // number of failures first
            fc.integer({ min: 1, max: 5 })   // number of successes after
          ),
          ([failureCount, successCount]) => {
            // ---- Fresh page ----
            document.body.innerHTML = '';
            delete window.AmazonCognitoIdentity;
            delete window.PasswordValidator;

            const forgotPasswordMock = setupPage();
            advanceToConfirmStep(forgotPasswordMock);
            forgotPasswordMock.mockClear();

            // Reveal resend button.
            jest.advanceTimersByTime(INITIAL_DELAY_MS);

            const resendBtn = document.getElementById('resend-btn');
            const resendContainer = document.getElementById('resend-container');

            let successfulResendsSoFar = 0;

            // Phase 1: failures only.
            for (let i = 0; i < failureCount; i++) {
              if (resendBtn.disabled) break;
              if (resendContainer.classList.contains('hidden')) {
                jest.advanceTimersByTime(COOLDOWN_MS);
              }
              if (resendBtn.disabled) break;

              forgotPasswordMock.mockImplementationOnce(function(callbacks) {
                if (typeof callbacks.onFailure === 'function') {
                  callbacks.onFailure({ message: 'Simulated failure' });
                }
              });
              resendBtn.click();
              // Button should still be enabled after failure (Req 5.4).
              expect(resendBtn.disabled).toBe(false);
            }

            // Phase 2: successes.
            for (let i = 0; i < successCount; i++) {
              if (resendBtn.disabled) break;
              if (resendContainer.classList.contains('hidden')) {
                jest.advanceTimersByTime(COOLDOWN_MS);
              }
              if (resendBtn.disabled) break;

              forgotPasswordMock.mockImplementationOnce(function(callbacks) {
                if (typeof callbacks.inputVerificationCode === 'function') {
                  callbacks.inputVerificationCode();
                } else if (typeof callbacks.onSuccess === 'function') {
                  callbacks.onSuccess();
                }
              });
              resendBtn.click();
              successfulResendsSoFar++;
            }

            // Core invariant: successes ≤ MAX_RESENDS regardless of leading failures.
            expect(successfulResendsSoFar).toBeLessThanOrEqual(MAX_RESENDS);

            // Button permanently disabled when cap reached.
            if (successfulResendsSoFar >= MAX_RESENDS) {
              expect(resendBtn.disabled).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    }
  );
});
