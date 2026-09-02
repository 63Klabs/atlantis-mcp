# Implementation Plan: Password Reset and Change Password

## Overview

Add a self-service forgot-password page and an authenticated change-password section to
the static site, both backed by the existing Cognito user pool via the
`amazon-cognito-identity-js` browser SDK.

Work proceeds in four phases, ordered by dependency and risk:

1. **Prerequisite fix** — correct the Auth Lambda's trigger-source dispatch, which would
   otherwise make a successful reset report failure.
2. **Shared validator extraction** — move `PasswordValidator` to one shared asset and
   consolidate the jsdom test harness. This is the highest-risk step because it touches
   six currently-passing test files.
3. **Feature pages** — forgot-password page, login entry points, profile section, pool
   configuration.
4. **Tests and documentation**.

No new AWS resources, IAM permissions, API routes, or buildspec steps.

## Tasks

- [x] 1. Fix Auth Lambda trigger-source dispatch (prerequisite)
  - [x] 1.1 Branch on trigger-source presence in `auth-function/index.js`
    - Replace the `event.triggerSource === 'PostConfirmation_ConfirmSignUp'` check at line 52 with an outer `typeof event.triggerSource === 'string'` guard
    - Inside the guard, keep the existing `PostConfirmation_ConfirmSignUp` delegation to `handlers/post-confirmation.js`, including the `console.error` log and the re-throw that rejects the confirmation
    - For any other trigger source, log the source value with `console.log` and `return event` unmodified, by reference
    - Place the guard before `Config.promise()` / `Config.prime()` so no cache-data initialization runs on trigger events
    - Use `console.*` not `DebugAndLog`, matching the existing sign-up trigger path which runs before config is primed
    - Add `// >!` security comments explaining that an API Gateway shaped response causes `InvalidLambdaResponseException` on `ConfirmForgotPassword`
    - Leave the API Gateway path and the trailing 400 `Unrecognized event type` branch unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.2 Create unit tests for the dispatcher in `tests/unit/handler-event-dispatch.test.js`
    - Follow the `.test.js` CommonJS convention used throughout `auth-function/tests/`
    - Mock `handlers/post-confirmation` and `routes/index`
    - Assert `PostConfirmation_ConfirmSignUp` delegates to the handler
    - Assert a handler rejection propagates rather than being swallowed
    - Assert `PostConfirmation_ConfirmForgotPassword` returns the same object reference and the handler mock records zero calls
    - Assert an unknown `triggerSource` returns the event and logs the source value
    - Assert an API Gateway event (`httpMethod` + `path`, no `triggerSource`) still reaches `Routes.process`
    - Assert an event with neither still yields a 400 proxy response
    - Restore mocks in `afterEach`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 12.1, 12.8, 12.9_

  - [x] 1.3 Write property test: trigger echo identity (Property 2)
    - **Property 2: Trigger echo identity**
    - **Validates: Requirements 1.2, 1.3, 1.4**
    - Create `tests/property/trigger-source-dispatch.property.test.js`
    - For any generated `triggerSource` string other than `PostConfirmation_ConfirmSignUp`, and any event body, the dispatcher returns the identical object reference and invokes the Post_Confirmation_Handler zero times
    - Also assert branch exclusivity (Property 3): no event produces both a handler call and a proxy response
    - Use `fast-check` with the 100-run default; this test spawns no child processes
    - _Requirements: 1.2, 1.3, 1.4, 1.6, 1.7_

- [x] 2. Checkpoint - Verify the prerequisite fix in isolation
  - Run the auth-function suite and confirm all pre-existing tests still pass alongside the new ones.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Extract the shared password validator asset
  - [x] 3.1 Create `public/js/password-validator.js`
    - Move the IIFE from `register/index.html` lines 115-305 verbatim
    - Keep `FIELD_IDS`, `POLICY_RULES`, `ERROR_MESSAGES`, `validateMatch`, and `validatePolicy` private in the closure
    - Keep exactly five functions on `window.PasswordValidator`
    - Update the docblock to state that the file is shared by the register, forgot-password, and profile pages and must stay behaviorally identical to `src/lambda/auth-function/utils/password-validator.js`
    - Introduce no settings tokens: `apply-settings.js` processes only `.html` and `.json`, so a `.js` asset cannot carry them
    - _Requirements: 4.1, 4.2, 4.7, 4.12_

  - [x] 3.2 Add `assetVersion` to `settings.json`
    - Add `"assetVersion": "0-0-6"` to the `default` block only
    - Leave the `prod` and `beta` blocks unchanged so all stages resolve the same value
    - _Requirements: 4.7_

  - [x] 3.3 Reference the shared asset from `register/index.html`
    - Remove the inline validator IIFE block (lines 115-305)
    - Add `<script src="/js/password-validator.js?v={{{settings.assetVersion}}}"></script>` in its place, after the Cognito CDN script and before the main app IIFE
    - Change nothing else on the page; all element IDs and behavior stay identical
    - _Requirements: 4.1, 4.7_

- [x] 4. Consolidate the jsdom test harness
  - [x] 4.1 Create `tests/helpers/load-page.mjs`
    - Export `loadPage(htmlPath, overrides)` performing the `{{{settings.*}}}` substitutions the existing copies do, with `assetVersion` added
    - Export `setupCognitoMock(extraMethods)` returning the mock so tests can assert on it, covering `forgotPassword`, `confirmPassword`, `changePassword`, `getCurrentUser`, and `getSession` in addition to the currently mocked methods
    - Export `executePageScripts(html)` which resolves `<script src="/js/...">` to disk relative to `public/`, strips any `?v=` query, and executes those files in document order *before* the inline scripts
    - Continue skipping `https://` CDN scripts
    - Accept absolute paths so callers keep their own resolution style (`import.meta.dirname` vs `process.cwd()`)
    - Note: the file is under `tests/` but `testMatch` requires `.jest.mjs`, so it is not collected as a suite
    - _Requirements: 12.1_

  - [x] 4.2 Migrate existing static test files to the shared helper
    - Update `tests/register/registration-form.jest.mjs`, `tests/register/registration-validation.property.jest.mjs`, `tests/register-reregistration-tests.jest.mjs`, `tests/register-resend-tests.jest.mjs`, `tests/register-query-param-tests.jest.mjs`, and `tests/accessibility-tests.jest.mjs`
    - Replace each file's local `loadPage` / `setupCognitoMock` / `executePageScript` copy with imports from the helper
    - Change no assertions — only page loading changes
    - In `registration-form.jest.mjs`, update `getIifeScriptContent` so the no-CommonJS-artifacts assertions read the shared asset file instead of scanning inline HTML, otherwise they pass vacuously against an empty string
    - Optionally migrate `tests/login-unverified-tests.jest.mjs` for consistency; it does not load the register page so it is not required
    - _Requirements: 4.7, 12.12_

  - [x] 4.3 Confirm drift detection still holds
    - Verify `registration-validation.property.jest.mjs` Property 1 now exercises the shared asset and still passes at 100 runs against `src/lambda/auth-function/utils/password-validator.js`
    - Add no new drift test; this existing property test is the mechanism
    - _Requirements: 4.11, 12.11_

- [x] 5. Checkpoint - Verify the extraction caused no regression
  - Run the full static-site suite. Every previously passing register and accessibility test must still pass with no assertion changes. A failure here is harness-local, not feature-related.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Build the forgot-password page markup
  - [x] 6.1 Create `public/forgot-password/index.html` structure
    - Follow `register/index.html`: `.container`, breadcrumb nav, `<header>`, sibling step containers toggled by the `hidden` class, `{{{settings.footer}}}` in the footer
    - `#request-step` visible: `#reset-error`, `#reset-form` with `#email` (`type=email`, `autocomplete=email`, `aria-required=true`, `aria-describedby=reset-error`), `#reset-btn`, and a `.form-footer` linking to `/login/` and `/register/`
    - `#confirm-step` hidden: `#confirm-error`, `#confirm-info`, `#spam-advisory`, `#confirm-form` with `#verification-code` (`autocomplete=one-time-code`, `inputmode=numeric`, `pattern=[0-9]*`), `#password-input`, `#password-requirements`, `#confirm-password-input`, `#password-match-status`, `#validation-announcements`, `#confirm-btn`, plus `#resend-container` hidden containing `#resend-btn` and `#resend-status`
    - `#success-step` hidden, contents added in task 9
    - Use the validator's required element IDs exactly: `password-input`, `confirm-password-input`, `password-requirements`, `password-match-status`
    - Use `aria-label="Resend reset code to your email"` on `#resend-btn`, distinct from the register page's label
    - Use only existing CSS classes; add no CSS
    - Script order: `copyright-year` stamp, Cognito CDN, shared validator with `?v={{{settings.assetVersion}}}`, then the page IIFE
    - _Requirements: 2.1, 3.1, 4.8, 11.1, 11.2, 11.3, 11.4, 11.7_

- [x] 7. Implement the forgot-password request step
  - [x] 7.1 Wire `#request-step` to `ForgotPassword`
    - Read `USER_POOL_ID` and `CLIENT_ID` from `{{{settings.cognitoUserPoolId}}}` / `{{{settings.cognitoClientId}}}`; do not add `apiBaseUrl`, which this page does not use
    - On submit, reject an empty email with a validation message and no SDK call
    - Call `CognitoUser.forgotPassword()` and disable `#reset-btn` with progress text while in flight
    - On the `inputVerificationCode` callback, hide `#request-step`, show `#confirm-step`, move focus to `#verification-code`, and show the neutral `#confirm-info` copy plus `#spam-advisory`
    - Retain the submitted email in closure state for the confirm step and resend; do not persist it to storage
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 11.6_

  - [x] 7.2 Map request-step errors
    - `InvalidParameterException`: treat as unconfirmed, call `resendConfirmationCode()`, show an informational message, then redirect to `/register/?verify=<encodeURIComponent(email)>`, mirroring `login/index.html:107-143`
    - If that `resendConfirmationCode()` call fails, re-enable the request controls and advise retrying or contacting support
    - `LimitExceededException` / `TooManyRequestsException`: advise waiting, re-enable
    - Any other code: show `err.message` if present, else a generic failure, re-enable
    - Assign all error text with `textContent`; never interpolate `err.message` into markup
    - Emit no message that distinguishes an existing from a non-existent account
    - _Requirements: 6.1, 6.2, 6.7, 6.8, 6.9_

- [x] 8. Implement the forgot-password confirm step
  - [x] 8.1 Wire real-time validation on the new-password fields
    - Attach `input` listeners to `#password-input` and `#confirm-password-input`
    - Call `window.PasswordValidator.validateForm()` and render policy violations into `#password-requirements` and match status into `#password-match-status`, applying `.field-error` / `.field-success`
    - Suppress the mismatch message while `#confirm-password-input` is empty
    - Show the match confirmation only when the values match and the password passes all policy rules
    - Maintain `aria-invalid` on both fields and write `getAriaLiveRegion()` content into `#validation-announcements`
    - Reuse the register page's `updateValidationUI` logic rather than writing new validation behavior
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 11.5_

  - [x] 8.2 Wire `#confirm-step` to `ConfirmForgotPassword`
    - Reject an empty `#verification-code` with a validation message and no SDK call
    - Gate on `isReadyForSubmission()`; on failure show the errors, focus `getFirstErrorField()`, and do not call `confirmPassword()`
    - Call `CognitoUser.confirmPassword(code, newPassword, callbacks)` with the retained email
    - Disable `#confirm-btn` with progress text while in flight and re-enable on error
    - On success, hide `#confirm-step` and show `#success-step`
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 8.3 Map confirm-step errors
    - `CodeMismatchException`: code incorrect, stay on step
    - `ExpiredCodeException`: code expired, direct the user to request a new one
    - `InvalidPasswordException`: restate the policy requirements
    - `LimitExceededException` / `TooManyRequestsException` / `TooManyFailedAttemptsException`: advise waiting
    - Any other code: `err.message` if present, else generic
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.8_

  - [x] 8.4 Implement the resend controller
    - Copy `resendState` from `register/index.html:320-326` with identical values: `maxResends: 3`, `cooldownMs: 30000`, `initialDelayMs: 30000`
    - Keep `#resend-container` hidden for 30s after `#confirm-step` first appears, then reveal it
    - On activation, disable the button and call `forgotPassword()` again for the retained email
    - On success, increment the count, show a confirmation, hide for a 30s cooldown, then reveal and re-enable
    - At 3 successful resends, disable permanently with a max-attempts message
    - On failure, show an error and re-enable without incrementing
    - Clear any pending timer handle before scheduling a new one
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 9. Implement the forgot-password success step
  - [x] 9.1 Populate `#success-step`
    - Confirm the password was changed
    - State that the user's API key was **not** changed by the reset
    - Link to `/profile/`, described as where to regenerate the API key
    - Link to `/login/` to sign in with the new password
    - Do not authenticate the user automatically
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 10. Add login page entry points
  - [x] 10.1 Update `public/login/index.html`
    - Add a "Forgot your password?" link to `/forgot-password/` inside `.form-footer` (lines 40-43)
    - Include the same link in the incorrect-credentials error for `NotAuthorizedException` and `UserNotFoundException` (lines 149-154)
    - Build that message from page-owned literal strings only; never place `err.message` into markup. Prefer appending a text node plus an anchor element over `innerHTML`
    - Keep both exception codes mapped to the same generic message
    - Leave the `UserNotConfirmedException` resend-and-redirect behavior (lines 107-143) untouched
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 11. Add the profile change-password section
  - [x] 11.1 Add markup to `public/profile/index.html`
    - Insert a new `profile-section` after `Upgrade to Paid Tier` (ends line 105) and before the logout block (line 107), making it the last section on the page
    - Use `aria-labelledby="password-heading"` with an `<h2 id="password-heading">Password</h2>`
    - Include `#change-password-error`, `#change-password-success`, and `#change-password-form` with `#current-password` (`autocomplete=current-password`), `#password-input`, `#password-requirements`, `#confirm-password-input`, `#password-match-status`, `#validation-announcements`, and `#change-password-btn`
    - Add a note that the API key is not affected by a password change
    - Add the shared validator `<script src>` before the existing inline IIFE
    - _Requirements: 9.1, 9.11, 11.8_

  - [x] 11.2 Wire the change-password handler
    - Reuse the page's existing `cognitoUser` reference and real-time validation logic from task 8.1
    - Reject an empty `#current-password` with a validation message and no SDK call
    - Gate on `isReadyForSubmission()`; on failure show errors, focus `getFirstErrorField()`, and do not call `changePassword()`
    - Validate `#current-password` for non-emptiness only; never pass it to the validator, which has no current-password concept
    - Call `CognitoUser.changePassword(current, next, callback)`
    - On success, clear all three inputs, show `#change-password-success`, keep the user signed in, and do not redirect
    - On absent or invalid session, redirect to `/login/`, consistent with lines 276-286
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.9, 9.10, 4.10_

  - [x] 11.3 Map change-password errors
    - `NotAuthorizedException`: current password incorrect
    - `InvalidPasswordException`: restate the policy requirements
    - `LimitExceededException` / `TooManyRequestsException`: advise waiting
    - Any other code: `err.message` if present, else generic
    - Re-enable the submit control on every error path
    - _Requirements: 9.6, 9.7, 9.8_

- [x] 12. Declare account recovery in CloudFormation
  - [x] 12.1 Add `AccountRecoverySetting` to `CognitoUserPool` in `template.yml`
    - Add `RecoveryMechanisms` with `Name: verified_email` and `Priority: 1`, alongside the existing `AutoVerifiedAttributes`
    - Add no `EmailConfiguration`, `VerificationMessageTemplate`, or `LambdaConfig.CustomMessage`
    - Leave `CognitoUserPoolClient` untouched, including `ExplicitAuthFlows` and `PreventUserExistenceErrors`
    - Add no `cognito-idp` permissions to `AuthLambdaExecutionRole`
    - Make no `template-openapi-spec.yml` change; this feature adds no API Gateway paths
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [-] 13. Checkpoint - Manual verification of both flows
  - Confirm the reset wizard advances correctly, the resend cooldown behaves, and the change-password section works while signed in.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Write forgot-password page tests
  - [x] 14.1 Create `tests/forgot-password/forgot-password-form.jest.mjs`
    - Use the shared helper from task 4.1
    - Assert required element IDs, ARIA attributes, and that `#confirm-step` and `#success-step` start hidden
    - Assert the request step calls `forgotPassword()`, transitions to the confirm step, and displays the neutral copy and spam advisory
    - Assert the confirm step calls `confirmPassword()` and transitions to the success step
    - Assert success-step content: API key advisory, `/profile/` link, `/login/` link, and that no authentication occurs
    - Assert focus moves into each newly displayed step
    - _Requirements: 12.2, 12.3, 2.6, 2.7, 2.8, 7.1, 7.2, 7.3, 7.4, 7.5, 11.6_

  - [x] 14.2 Create `tests/forgot-password/forgot-password-errors.jest.mjs`
    - Cover every row of the design's Error Handling table for both operations
    - Include the `InvalidParameterException` unconfirmed path: `resendConfirmationCode()` is called and the redirect target is `/register/?verify=<encoded-email>`
    - Include the failure-of-resend sub-path from Requirement 6.2
    - Assert no rendered message distinguishes an existing from a non-existent account
    - _Requirements: 12.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x] 14.3 Create `tests/forgot-password/forgot-password-resend.jest.mjs`
    - Use Jest fake timers; introduce no real delays
    - Cover the 30s initial delay, the 30s cooldown, the 3-attempt cap, and the failure path leaving the count unchanged
    - Assert pending timers are cleared before new ones are scheduled
    - _Requirements: 12.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 14.4 Write property test: submission gate (Property 6)
    - **Property 6: Submission gate**
    - **Validates: Requirements 3.4, 4.3, 9.3**
    - Add to `tests/forgot-password/forgot-password-form.jest.mjs` or a sibling property file
    - For any pair `(password, confirmPassword)` where `isReadyForSubmission()` is false, submitting the confirm step calls `confirmPassword()` zero times and focus lands on `getFirstErrorField(result)`
    - Use `fast-check` at 100 runs, following `registration-validation.property.jest.mjs`
    - _Requirements: 3.4, 4.3, 12.4_

  - [x] 14.5 Write property test: resend cap (Property 5)
    - **Property 5: Resend cap**
    - **Validates: Requirements 5.3, 5.4, 5.5**
    - For any sequence of resend activations and timer advances, successful `forgotPassword` resend calls never exceed 3, and failed attempts do not consume the budget
    - _Requirements: 5.3, 5.4, 5.5, 12.6_

- [x] 15. Write profile change-password tests
  - [x] 15.1 Create `tests/profile/change-password.jest.mjs`
    - Assert the success path clears all three inputs, shows the success message, and does not redirect
    - Assert each error mapping from Requirement 9
    - Assert the submission gate blocks `changePassword()` for invalid or mismatched input
    - Assert an empty current password blocks the call
    - Assert an absent or invalid session redirects to `/login/`
    - Assert the section is the last `profile-section` on the page
    - _Requirements: 12.7, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11_

- [x] 16. Extend the accessibility test suite
  - [x] 16.1 Add the forgot-password page to `tests/accessibility-tests.jest.mjs`
    - Add a `FORGOT_HTML_PATH` constant matching the file's existing `process.cwd()` resolution style
    - Apply the existing aria-live, aria-describedby, and tab-order assertions to the new page
    - Scope the `#resend-btn` `aria-label` assertion per page, since the reset page uses "Resend reset code to your email" while register uses "Resend verification code to your email"
    - _Requirements: 12.10, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_

- [~] 17. Checkpoint - Full suite green
  - Run the auth-function suite and the static-site suite. Confirm no test invokes an npm script, all timing tests use fake timers, and every suite restores mocks and clears timers.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Update documentation
  - [x] 18.1 Update `ARCHITECTURE.md`
    - Add `forgot-password/` and the new `js/` directory to the static site file tree
    - Note that the password validator is now a shared asset rather than inlined per page
    - _Requirements: 13.1_

  - [x] 18.2 Update `docs/end-user/troubleshooting/README.md`
    - Document resetting a forgotten password in the authentication section, including the spam-folder advisory and the unconfirmed-account case
    - Document changing a password from the profile page
    - State that a password reset does not change the user's API key
    - Describe neither SES, custom email templates, nor API key rotation, none of which are in scope
    - _Requirements: 13.2, 13.3, 13.6_

  - [x] 18.3 Update `CHANGELOG.md`
    - Add an `### Added` entry under `v0.0.6 (unreleased)` for the password reset and change password flows, referencing `[Spec: 0-0-6-password-reset](../.kiro/specs/0-0-6-password-reset/)`
    - Add a `### Fixed` entry for the Auth Lambda trigger-source dispatch defect
    - Note the `assetVersion` settings key and the shared validator asset under `### Changed`
    - Modify no existing changelog text
    - _Requirements: 13.4, 13.5_

## Notes

- Task 1 is a true prerequisite, not a convenience ordering: without the trigger-source fix, a successful `ConfirmForgotPassword` returns an API Gateway shaped response to Cognito and surfaces as `InvalidLambdaResponseException`. Verify it at checkpoint 2 before starting any UI work.
- Task 3 and 4 (validator extraction and harness consolidation) are the highest-risk steps because they touch six currently-passing test files. No assertion may change; only page loading and asset resolution change. Checkpoint 5 exists solely to prove no regression.
- `public/js/password-validator.js` must stay behaviorally identical to `src/lambda/auth-function/utils/password-validator.js`. Drift detection is the existing Property 1 in `registration-validation.property.jest.mjs` — no new drift test is added.
- `apply-settings.js` processes only `.html` and `.json`, so the shared `.js` asset cannot carry `{{{settings.*}}}` tokens. Cache busting is done by the `?v={{{settings.assetVersion}}}` query on the referencing HTML pages.
- Auth Lambda tests use `.test.js` (CommonJS); static-site tests use `.jest.mjs`. `tests/helpers/load-page.mjs` sits under `tests/` but is not collected as a suite because `testMatch` requires `.jest.mjs`.
- No test in this feature spawns a child process or invokes an npm script. Property tests run at the 100-run `fast-check` default; resend timing tests use Jest fake timers with no real delays. Every suite restores mocks and clears pending timers in `afterEach`.
- Error text is always assigned with `textContent`. `err.message` is never interpolated into markup, and no rendered message distinguishes an existing account from a non-existent one.
- Scope exclusions verified by review rather than by test: no new AWS resources, IAM permissions, API Gateway paths, `EmailConfiguration`, custom message templates, or buildspec steps. A "no other change" constraint cannot be expressed as an assertion.
- Checkpoint tasks (2, 5, 13, 17) are verification gates with no code deliverable and are therefore omitted from the dependency graph below.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "3.2", "12.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "3.3", "4.1"] },
    { "id": 2, "tasks": ["4.2", "6.1", "10.1", "11.1"] },
    { "id": 3, "tasks": ["4.3", "7.1", "8.1", "9.1", "16.1"] },
    { "id": 4, "tasks": ["7.2", "8.2", "8.4", "11.2"] },
    { "id": 5, "tasks": ["8.3", "11.3", "14.3", "14.5"] },
    { "id": 6, "tasks": ["14.1", "14.2", "14.4", "15.1"] },
    { "id": 7, "tasks": ["18.1", "18.2", "18.3"] }
  ]
}
```
