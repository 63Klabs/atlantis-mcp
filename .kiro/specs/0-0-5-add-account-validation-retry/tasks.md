# Implementation Plan: Add Account Validation Retry

## Overview

This plan implements a frontend-only feature that enhances the account registration and email verification flow. Changes are limited to two static HTML pages (`register/index.html` and `login/index.html`) using vanilla JavaScript with the existing Cognito SDK loaded via CDN. Tests use Jest with jsdom environment.

## Tasks

- [x] 1. Add spam folder advisory and resend button HTML to registration page
  - [x] 1.1 Add spam advisory element and resend container markup to the verify-step section
    - Add `#spam-advisory` div with `role="note"` and `aria-live="polite"` inside `#verify-step`
    - Add `#resend-container` with resend button (`aria-label="Resend verification code to your email"`) and `#resend-status` div
    - Use existing `.alert`, `.alert-info`, `.btn`, `.btn-secondary` CSS classes
    - Resend container starts hidden
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.7, 5.1, 5.2_

- [x] 2. Implement resend verification code logic on registration page
  - [x] 2.1 Implement resend state manager and 30-second initial delay timer
    - Add `resendState` object (`count`, `maxResends: 3`, `cooldownMs: 30000`, `initialDelayMs: 30000`, `timerId`)
    - Start 30-second timer when verify step becomes visible to show the resend button
    - _Requirements: 2.1_

  - [x] 2.2 Implement resend button click handler with cooldown and max attempts
    - Call `cognitoUser.resendConfirmationCode()` on click
    - Disable button during pending request
    - On success: show confirmation message (visible 10+ seconds), hide button for 30-second cooldown, increment counter
    - On error: show error message in `#resend-status`, re-enable button
    - After 3 successful resends: permanently disable button, show max attempts message
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 5.1_

- [x] 3. Implement re-registration handling for unverified accounts
  - [x] 3.1 Handle UsernameExistsException in registration form submit
    - On `UsernameExistsException`: disable submit button, show loading indicator, call `resendConfirmationCode()`
    - On resend success: store email, transition to verify step, focus verification code input
    - On already-verified error (heuristic check): show "account exists, please log in" message
    - On other errors (`LimitExceededException`, network failure): show error, re-enable submit button
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Implement login page handling for unverified accounts
  - [x] 4.1 Handle UserNotConfirmedException in login form submit
    - On `UserNotConfirmedException`: disable form controls, call `resendConfirmationCode()`
    - On resend success: show info message for 2 seconds, redirect to `/register/?verify=<email>`
    - On resend error: re-enable form controls, show error with instructions
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

- [x] 5. Implement query parameter handling on registration page
  - [x] 5.1 Handle `?verify=<email>` query parameter on page load
    - Parse `URLSearchParams` for `verify` param on page load
    - If present: set `registeredEmail`, hide register step, show verify step
    - Move focus to verification code input within 500ms (with 2-second fallback to first focusable element)
    - If param is empty or missing: show normal registration form
    - _Requirements: 4.3, 5.3, 5.6_

- [x] 6. Ensure accessibility compliance for all new elements
  - [x] 6.1 Add aria-live, aria-describedby, and focus management attributes
    - Ensure all dynamic messages use `aria-live="polite"`
    - Associate inline error messages with form fields using `aria-describedby`
    - Ensure tab order follows visual layout (top-to-bottom, left-to-right)
    - Verify resend button is focusable via Tab, activatable via Enter and Space
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 7. Checkpoint - Verify implementation manually
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Write unit tests for registration page features
  - [x] 8.1 Write tests for spam advisory display and resend button behavior
    - Test advisory is visible with correct `role="note"` and `aria-live="polite"` when verify step shows
    - Test button hidden initially, appears after 30s delay (use fake timers)
    - Test button calls `resendConfirmationCode`, disables during request
    - Test success message persists 10+ seconds, button hidden 30s after success
    - Test error re-enables button, max 3 resends disables permanently
    - File: `test/static/register-resend-tests.jest.mjs`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 8.2 Write tests for re-registration of unverified accounts
    - Test `UsernameExistsException` triggers resend flow with loading state
    - Test successful resend transitions to verify step with focus on code input
    - Test already-verified error shows "account exists" message
    - Test other errors re-enable submit button with error message
    - File: `test/static/register-reregistration-tests.jest.mjs`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 8.3 Write tests for query parameter handling
    - Test `?verify=email@example.com` shows verify step with email pre-populated
    - Test focus moves to verification code input within 500ms
    - Test missing/empty verify param shows normal registration form
    - Test fallback focus when input not rendered within 2s
    - File: `test/static/register-query-param-tests.jest.mjs`
    - _Requirements: 4.3, 5.3, 5.6_

- [x] 9. Write unit tests for login page features
  - [x] 9.1 Write tests for login with unverified account handling
    - Test `UserNotConfirmedException` triggers resend flow with form disabled
    - Test successful resend shows info message for 2s then redirects
    - Test redirect URL includes `?verify=<email>` parameter
    - Test failed resend re-enables form with error message
    - File: `test/static/login-unverified-tests.jest.mjs`
    - _Requirements: 4.1, 4.2, 4.4, 4.5_

- [x] 10. Write accessibility tests
  - [x] 10.1 Write tests for accessibility compliance
    - Test all dynamic messages have `aria-live="polite"`
    - Test resend button has descriptive `aria-label`
    - Test focus management on redirect (within 500ms)
    - Test tab order follows visual layout
    - Test error messages associated via `aria-describedby`
    - File: `test/static/accessibility-tests.jest.mjs`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 11. Update Jest configuration for static page tests
  - [x] 11.1 Add test match pattern for static page tests in jest.config.js
    - Add `'**/test/static/**/*.jest.mjs'` to `testMatch` array
    - Ensure jsdom environment is configured for these test files (via docblock or config override)
    - _Requirements: All (testing infrastructure)_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- No property-based tests are included because the feature consists entirely of DOM manipulation, event handlers, timer-based UI transitions, and SDK callbacks with no pure functions or data transformations where random input generation would add value beyond example-based tests
- Tests use Jest with jsdom environment, mocking `AmazonCognitoIdentity` SDK, `window.location`, `URLSearchParams`, and fake timers
- All implementation is vanilla JavaScript within inline `<script>` blocks (no build step)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "11.1"] },
    { "id": 1, "tasks": ["2.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.1"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["8.1", "8.2", "8.3", "9.1", "10.1"] }
  ]
}
```
