# Requirements Document

## Introduction

This feature adds self-service password management to the static site's Cognito-backed
authentication pages:

1. **Forgot password** (unauthenticated) — a new page at `/forgot-password/` that lets a
   user who cannot sign in request an emailed reset code and set a new password, using
   the Cognito `ForgotPassword` and `ConfirmForgotPassword` APIs via the
   `amazon-cognito-identity-js` browser SDK already loaded on the auth pages.
2. **Change password** (authenticated) — a new section on `/profile/` that lets a
   signed-in user change their password by supplying their current password, using
   `CognitoUser.changePassword()`. This path requires no email delivery.

Both paths reuse the `window.PasswordValidator` logic and the resend-cooldown pattern
already established by `public/register/index.html`. Because that validator is currently
inlined in a single page and this feature adds two more consumers, Requirement 4 also
covers consolidating it into one shared browser copy.

The feature also corrects a pre-existing defect in the Auth Lambda's event dispatcher
(Requirement 1) that would otherwise cause password resets to fail *after* the password
has already been changed. This fix is a prerequisite, not an enhancement.

### Decisions carried forward from QUESTIONS.md

| Ref | Decision |
|-----|----------|
| A1 | Implement both forgot-password and authenticated change-password |
| A2 | A password reset does **not** rotate the user's API key; the success screen states this and links to `/profile/` |
| A3 | Entry points: login page footer, plus the failed-login error message. Change-password is its own section on `/profile/` |
| B1 | Keep Cognito's default email sender; include a spam-folder advisory. SES is a separate future concern |
| B2 | Declare `AccountRecoverySetting` explicitly on the user pool |
| B3 | Use stock Cognito reset email wording; no `VerificationMessageTemplate`, no `CustomMessage` trigger |
| C1 | Investigated — see finding below. Fixed as a prerequisite within this spec |
| C2 | Unconfirmed users are routed to the existing verify flow, mirroring the login page |
| C3 | Neutral existence-agnostic copy approved |
| C4 | Reuse the register page's resend values: 30s initial delay, 30s cooldown, max 3 resends |

### C1 investigation finding

AWS documentation confirms the concern was real:

- The [post confirmation trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-confirmation.html)
  is invoked "after a user successfully confirms their registration **or password
  reset**," and `clientMetadata` is documented as passable via `ConfirmForgotPassword`.
  The trigger therefore fires with `triggerSource === 'PostConfirmation_ConfirmForgotPassword'`.
- [`ConfirmForgotPassword`](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_ConfirmForgotPassword.html)
  lists both `InvalidLambdaResponseException` and `UnexpectedLambdaException` as HTTP 400
  errors it can return to the caller. A malformed trigger response is therefore
  client-visible on this specific operation.
- The trigger contract states "no additional return information is expected in the
  response," but the current handler returns an API-Gateway-shaped object
  (`{statusCode, headers, body}`) rather than the event, because a Cognito event has no
  `httpMethod`/`path` and falls through to the "Unrecognized event type" branch at
  `auth-function/index.js:82-87`.

Because the password is already changed by the time the trigger runs, the failure mode
is the worst available ordering: the password changes, the browser sees a 400, the user
retries with a now-consumed code and gets `CodeMismatchException`.

Whether Cognito rejects this *particular* malformed response or tolerates it cannot be
determined without a deployed test. The fix is correct regardless of which way that
resolves, so this spec does not depend on the answer.

Content in this section was rephrased from AWS documentation for compliance with
licensing restrictions.

## Glossary

- **Reset_Page**: The new unauthenticated page at `public/forgot-password/index.html`
- **Request_Step**: The first step of the Reset_Page, collecting an email address and calling `ForgotPassword`
- **Confirm_Step**: The second step of the Reset_Page, collecting the emailed code plus a new password and calling `ConfirmForgotPassword`
- **Success_Step**: The third step of the Reset_Page, confirming the password change and advising on API key state
- **Change_Password_Section**: The new authenticated section on `public/profile/index.html` that calls `CognitoUser.changePassword()`
- **Password_Validator**: The existing `window.PasswordValidator` IIFE currently inlined in `public/register/index.html` (lines 115-305), exposing `validateForm`, `isReadyForSubmission`, `getFirstErrorField`, `getAriaAttributes`, and `getAriaLiveRegion`. It is a hand-transformed browser copy of the canonical CommonJS module at `src/lambda/auth-function/utils/password-validator.js`
- **Password_Policy**: The Cognito user pool policy at `template.yml:1018-1023` — minimum 8 characters, requiring at least one uppercase letter, lowercase letter, number, and symbol. The 256-character maximum originates in the Password_Validator, not the template
- **Resend_Controller**: The cooldown and attempt-limit state machine governing the resend-code button, modeled on `register/index.html:320-326`
- **Auth_Lambda_Dispatcher**: The event-type branching logic in `src/lambda/auth-function/index.js`
- **Trigger_Source**: The `event.triggerSource` string Cognito sets on user pool Lambda trigger invocations
- **Post_Confirmation_Handler**: `src/lambda/auth-function/handlers/post-confirmation.js`, which creates the user's DynamoDB record and issues their initial API key
- **Neutral_Response**: UI copy that does not reveal whether an account exists for a given email address, required because the app client sets `PreventUserExistenceErrors: ENABLED`
- **Spam_Advisory**: A visible note telling the user to check their spam or junk folder, matching the existing advisory at `register/index.html:62`
- **Settings_Token**: A `{{{settings.*}}}` placeholder replaced at deploy time by `postdeploy-scripts/apply-settings.js`

## Requirements

### Requirement 1: Auth Lambda trigger-source dispatch correctness (prerequisite)

**User Story:** As a user resetting my password, I want the reset to report success when it
succeeds, so that I am not told it failed after my password has already been changed.

#### Acceptance Criteria

1. WHEN the Auth_Lambda_Dispatcher receives an event whose Trigger_Source is `PostConfirmation_ConfirmSignUp`, THE Auth_Lambda_Dispatcher SHALL delegate to the Post_Confirmation_Handler and preserve the existing behavior of re-throwing handler errors to reject the confirmation
2. WHEN the Auth_Lambda_Dispatcher receives an event whose Trigger_Source is `PostConfirmation_ConfirmForgotPassword`, THE Auth_Lambda_Dispatcher SHALL return the received event object unmodified
3. WHEN the Auth_Lambda_Dispatcher receives an event whose Trigger_Source is `PostConfirmation_ConfirmForgotPassword`, THE Auth_Lambda_Dispatcher SHALL NOT invoke the Post_Confirmation_Handler, SHALL NOT write to the Users table, and SHALL NOT call `cognito-idp:AdminUpdateUserAttributes`
4. WHEN the Auth_Lambda_Dispatcher receives an event that has a Trigger_Source property and no `httpMethod` property, THE Auth_Lambda_Dispatcher SHALL return the received event object unmodified rather than constructing an API Gateway proxy response
5. WHEN the Auth_Lambda_Dispatcher returns an event unmodified because its Trigger_Source is unhandled, THE Auth_Lambda_Dispatcher SHALL emit a log entry recording the Trigger_Source value
6. THE Auth_Lambda_Dispatcher SHALL continue to route events that have both `httpMethod` and `path` properties through the existing cache-data request/response path
7. THE Auth_Lambda_Dispatcher SHALL continue to return a 400 API Gateway proxy response for events that have neither a Trigger_Source property nor both `httpMethod` and `path` properties

### Requirement 2: Requesting a reset code

**User Story:** As a user who cannot remember my password, I want to request a reset code
by entering my email address, so that I can regain access to my account.

#### Acceptance Criteria

1. THE Reset_Page SHALL present a Request_Step containing an email input with `type="email"` and `autocomplete="email"`, and a submit control
2. THE Reset_Page SHALL read the user pool identifier and client identifier from the `{{{settings.cognitoUserPoolId}}}` and `{{{settings.cognitoClientId}}}` Settings_Tokens
3. WHEN the user submits the Request_Step with a non-empty email value, THE Reset_Page SHALL call `CognitoUser.forgotPassword()` for that email
4. WHEN the user submits the Request_Step with an empty email value, THE Reset_Page SHALL display a validation message and SHALL NOT call `forgotPassword()`
5. WHILE the `forgotPassword()` call is in flight, THE Reset_Page SHALL disable the submit control and indicate that the request is in progress
6. WHEN `forgotPassword()` invokes its `inputVerificationCode` callback, THE Reset_Page SHALL hide the Request_Step, display the Confirm_Step, and move focus to the code input
7. WHEN the Confirm_Step becomes visible, THE Reset_Page SHALL display a Neutral_Response stating that a reset code has been sent if an account exists for the address
8. WHEN the Confirm_Step becomes visible, THE Reset_Page SHALL display the Spam_Advisory
9. THE Reset_Page SHALL retain the submitted email address for use by the Confirm_Step and the Resend_Controller without requiring the user to re-enter it

### Requirement 3: Confirming the code and setting a new password

**User Story:** As a user who received a reset code, I want to enter the code along with a
new password, so that I can complete the reset in a single step.

#### Acceptance Criteria

1. THE Confirm_Step SHALL present a verification code input with `autocomplete="one-time-code"`, `inputmode="numeric"`, a new-password input with `autocomplete="new-password"`, and a confirm-new-password input with `autocomplete="new-password"`
2. WHEN the user submits the Confirm_Step, THE Reset_Page SHALL call `CognitoUser.confirmPassword()` with the entered code and new password
3. WHEN `confirmPassword()` succeeds, THE Reset_Page SHALL hide the Confirm_Step and display the Success_Step
4. IF the new password and confirm-new-password values do not satisfy the Password_Validator submission gate, THEN THE Reset_Page SHALL display the validation errors, move focus to the first field with an error, and SHALL NOT call `confirmPassword()`
5. IF the verification code input is empty, THEN THE Reset_Page SHALL display a validation message and SHALL NOT call `confirmPassword()`
6. WHILE the `confirmPassword()` call is in flight, THE Confirm_Step SHALL disable its submit control and indicate that the request is in progress
7. WHEN `confirmPassword()` returns an error, THE Confirm_Step SHALL re-enable its submit control so the user can retry

### Requirement 4: New-password policy validation

**User Story:** As a user setting a new password, I want to see the password requirements
and whether my entries match as I type, so that I am not rejected after submitting.

#### Acceptance Criteria

1. THE Reset_Page SHALL include the Password_Validator and SHALL NOT reimplement Password_Policy rules independently
2. THE Change_Password_Section SHALL include the Password_Validator and SHALL NOT reimplement Password_Policy rules independently
3. WHEN the user types in the new-password or confirm-new-password input, THE Reset_Page SHALL update the displayed policy violations and match status without requiring form submission
4. WHEN the confirm-new-password input is empty, THE Reset_Page SHALL NOT display a mismatch error
5. WHEN the new-password and confirm-new-password values match and the new password satisfies all Password_Policy rules, THE Reset_Page SHALL display a match confirmation
6. THE Reset_Page SHALL announce current validation state through an ARIA live region using the Password_Validator's live-region output

##### Validator reuse constraints

The Password_Validator currently exists as two independent copies with byte-identical
`POLICY_RULES`: the canonical CommonJS module at
`src/lambda/auth-function/utils/password-validator.js` and the browser IIFE inlined in
`register/index.html`. The multi-src layout rule forbids a source directory shared
between the Lambda and the static site, so the Lambda copy cannot be imported by the
browser. Within the static site there is currently no shared JavaScript directory — only
`public/css/` is shared, and every page inlines its own script.

This feature adds two more browser consumers, which would produce four copies if the
inlining pattern is simply repeated.

7. THE static site SHALL contain exactly one browser copy of the Password_Validator shared by all pages that need it, rather than one inlined copy per page. The mechanism for sharing is a design decision
8. WHEN the Password_Validator is consumed by the Reset_Page or the Change_Password_Section, THE consuming page SHALL use the element IDs the validator's `FIELD_IDS` map already specifies — `password-input`, `confirm-password-input`, `password-requirements`, and `password-match-status` — so that `getFirstErrorField()` and `getAriaAttributes()` return IDs that resolve on that page
9. IF a consuming page cannot use those element IDs, THEN THE Password_Validator SHALL be extended to accept a field-ID mapping, and THE existing register page behavior SHALL remain unchanged
10. THE Change_Password_Section's current-password input SHALL be validated for non-emptiness only and SHALL NOT be passed to the Password_Validator, which has no concept of a current-password field
11. THE existing IIFE-to-CommonJS equivalence property test at `tests/register/registration-validation.property.jest.mjs` (Property 1) SHALL continue to assert that the browser copy of the Password_Validator produces results identical to `src/lambda/auth-function/utils/password-validator.js`, so that drift between the two copies fails the build
12. THE Password_Validator's `POLICY_RULES` SHALL remain consistent with the Password_Policy declared in `template.yml`, with the exception of `MAX_LENGTH`, which is a validator-only constraint with no template equivalent

### Requirement 5: Resending a reset code

**User Story:** As a user whose reset code never arrived, I want to request another one,
so that a lost email does not permanently block me.

#### Acceptance Criteria

1. THE Resend_Controller SHALL keep the resend control hidden for 30 seconds after the Confirm_Step first becomes visible, then reveal it
2. WHEN the user activates the resend control, THE Reset_Page SHALL call `CognitoUser.forgotPassword()` again for the retained email address
3. WHEN a resend succeeds, THE Resend_Controller SHALL increment its attempt count, display a confirmation message, and hide the resend control for a 30 second cooldown before revealing it again
4. WHEN the resend attempt count reaches 3, THE Resend_Controller SHALL disable the resend control and display a message advising the user to check their email or try again later
5. WHEN a resend fails, THE Resend_Controller SHALL display an error message and re-enable the resend control without incrementing the attempt count
6. WHILE a resend call is in flight, THE Resend_Controller SHALL disable the resend control
7. THE Resend_Controller SHALL clear any pending cooldown timer before starting a new one

### Requirement 6: Error handling and edge cases

**User Story:** As a user who hits an error during reset, I want a message that tells me
what to do next, so that I am not stuck reading a raw API error.

#### Acceptance Criteria

1. WHEN `forgotPassword()` returns `InvalidParameterException`, THE Reset_Page SHALL treat the account as unconfirmed, call `resendConfirmationCode()` for that email, display an informational message, and redirect to `/register/?verify=<encoded-email>`, mirroring the behavior at `login/index.html:107-143`
2. IF the `resendConfirmationCode()` call in the unconfirmed-account path fails, THEN THE Reset_Page SHALL re-enable the Request_Step controls and display a message advising the user to try again or contact support
3. WHEN `confirmPassword()` returns `CodeMismatchException`, THE Confirm_Step SHALL display a message indicating the code is incorrect and SHALL keep the user on the Confirm_Step
4. WHEN `confirmPassword()` returns `ExpiredCodeException`, THE Confirm_Step SHALL display a message indicating the code has expired and SHALL direct the user to request a new code
5. WHEN `confirmPassword()` returns `InvalidPasswordException`, THE Confirm_Step SHALL display a message describing the Password_Policy requirements
6. WHEN `confirmPassword()` returns `LimitExceededException`, `TooManyRequestsException`, or `TooManyFailedAttemptsException`, THE Confirm_Step SHALL display a message advising the user to wait before trying again
7. WHEN `forgotPassword()` returns `LimitExceededException` or `TooManyRequestsException`, THE Request_Step SHALL display a message advising the user to wait before trying again
8. WHEN either call returns an error code not enumerated in this requirement, THE Reset_Page SHALL display the error's message property if present, or a generic failure message if absent
9. THE Reset_Page SHALL NOT display any message that distinguishes an existing account from a non-existent account on the Request_Step or Confirm_Step

### Requirement 7: Reset success state

**User Story:** As a user who just reset my password, I want to know what changed and what
did not, so that I understand whether my API key is still valid.

#### Acceptance Criteria

1. THE Success_Step SHALL display a confirmation that the password has been changed
2. THE Success_Step SHALL state that the user's API key was not changed by the password reset
3. THE Success_Step SHALL include a link to `/profile/` described as the place to regenerate the API key
4. THE Success_Step SHALL include a link to `/login/` so the user can sign in with the new password
5. THE Reset_Page SHALL NOT automatically authenticate the user following a successful reset

### Requirement 8: Login page entry points

**User Story:** As a user who just failed to sign in, I want a password reset link at the
point of failure, so that I do not have to hunt for it.

#### Acceptance Criteria

1. THE login page `.form-footer` (`login/index.html:40-43`) SHALL include a link to `/forgot-password/`
2. WHEN the login page displays an incorrect-credentials error resulting from `NotAuthorizedException` or `UserNotFoundException`, THE login page SHALL include a link to `/forgot-password/` within or adjacent to that error message
3. THE login page SHALL preserve its existing `UserNotConfirmedException` behavior of resending a confirmation code and redirecting to `/register/?verify=<encoded-email>`
4. THE login page SHALL preserve its existing behavior of mapping both `NotAuthorizedException` and `UserNotFoundException` to the same generic incorrect-credentials message

### Requirement 9: Authenticated change password

**User Story:** As a signed-in user, I want to change my password from my profile page, so
that I can rotate it without relying on email delivery.

#### Acceptance Criteria

1. THE Change_Password_Section SHALL present a current-password input with `autocomplete="current-password"`, a new-password input, and a confirm-new-password input, both with `autocomplete="new-password"`
2. WHEN the user submits the Change_Password_Section, THE profile page SHALL call `CognitoUser.changePassword()` with the current and new password values
3. IF the new password and confirm-new-password values do not satisfy the Password_Validator submission gate, THEN THE Change_Password_Section SHALL display the validation errors, move focus to the first field with an error, and SHALL NOT call `changePassword()`
4. IF the current-password input is empty, THEN THE Change_Password_Section SHALL display a validation message and SHALL NOT call `changePassword()`
5. WHEN `changePassword()` succeeds, THE Change_Password_Section SHALL display a success message and clear all three password inputs
6. WHEN `changePassword()` returns `NotAuthorizedException`, THE Change_Password_Section SHALL display a message indicating the current password is incorrect
7. WHEN `changePassword()` returns `InvalidPasswordException`, THE Change_Password_Section SHALL display a message describing the Password_Policy requirements
8. WHEN `changePassword()` returns `LimitExceededException` or `TooManyRequestsException`, THE Change_Password_Section SHALL display a message advising the user to wait before trying again
9. IF the user's session is absent or invalid when the Change_Password_Section is submitted, THEN THE profile page SHALL redirect to `/login/`, consistent with the existing session gating at `profile/index.html:276-286`
10. WHEN `changePassword()` succeeds, THE profile page SHALL keep the user signed in and SHALL NOT redirect away from `/profile/`
11. THE Change_Password_Section SHALL state that the user's API key is not affected by a password change

### Requirement 10: User pool account recovery configuration

**User Story:** As a maintainer, I want account recovery declared explicitly in the
template, so that a future change to verified attributes cannot silently alter recovery
behavior.

#### Acceptance Criteria

1. THE `CognitoUserPool` resource SHALL declare an `AccountRecoverySetting` property specifying `verified_email` as a recovery mechanism with priority 1
2. THE `CognitoUserPool` resource SHALL NOT declare `EmailConfiguration`, preserving the default Cognito email sender
3. THE `CognitoUserPool` resource SHALL NOT declare `VerificationMessageTemplate` or a `CustomMessage` Lambda trigger
4. THE `CognitoUserPoolClient` resource SHALL retain `PreventUserExistenceErrors: ENABLED`
5. THE `CognitoUserPoolClient` resource SHALL retain its existing `ExplicitAuthFlows` values without addition
6. THE Auth Lambda execution role SHALL NOT gain additional `cognito-idp` permissions as a result of this feature

### Requirement 11: Accessibility

**User Story:** As a user relying on assistive technology, I want the reset and change
password flows to be operable and announced correctly, so that I can complete them
independently.

#### Acceptance Criteria

1. THE Reset_Page SHALL associate every input with a visible `<label>` referencing the input's `id`
2. THE Reset_Page SHALL mark required inputs with `aria-required="true"`
3. THE Reset_Page SHALL expose error containers with `role="alert"` and `aria-live="polite"`
4. THE Reset_Page SHALL expose informational and status containers with `role="status"` or `role="note"` as appropriate
5. WHEN a field has a validation error, THE Reset_Page SHALL set `aria-invalid="true"` on that field, and SHALL set it to `"false"` when the error clears
6. WHEN the Reset_Page transitions between steps, THE Reset_Page SHALL move keyboard focus into the newly displayed step
7. THE Reset_Page SHALL include a breadcrumb navigation region consistent with the existing auth pages
8. THE Change_Password_Section SHALL satisfy criteria 1 through 5 of this requirement

### Requirement 12: Test coverage

**User Story:** As a maintainer, I want these flows covered by the existing jsdom suite,
so that the post-deploy pipeline blocks a regression before it reaches users.

#### Acceptance Criteria

1. All new tests SHALL run under Jest and SHALL follow the naming convention already established in the directory they are added to: `*.jest.mjs` for `src/static/tests/`, and `*.test.js` for `src/lambda/auth-function/tests/`
2. THE test suite SHALL cover the Request_Step calling `forgotPassword()`, transitioning to the Confirm_Step, and displaying the Neutral_Response and Spam_Advisory
3. THE test suite SHALL cover the Confirm_Step calling `confirmPassword()` and transitioning to the Success_Step
4. THE test suite SHALL cover the Password_Validator submission gate blocking `confirmPassword()` when the new password is invalid or the two entries differ
5. THE test suite SHALL cover each error mapping enumerated in Requirement 6, including the unconfirmed-account redirect to `/register/?verify=`
6. THE test suite SHALL cover the Resend_Controller's initial delay, cooldown, attempt limit, and failure path using Jest fake timers
7. THE test suite SHALL cover the Change_Password_Section success path and each error mapping enumerated in Requirement 9
8. THE test suite SHALL cover the Auth_Lambda_Dispatcher returning an unmodified event for `PostConfirmation_ConfirmForgotPassword` and not invoking the Post_Confirmation_Handler
9. THE test suite SHALL cover the Auth_Lambda_Dispatcher's existing `PostConfirmation_ConfirmSignUp` and API Gateway paths to confirm no regression
10. THE accessibility test suite SHALL be extended with a path constant for the Reset_Page and SHALL apply its existing assertions to that page
11. THE test suite SHALL include the validator drift assertion required by Requirement 4, criterion 11
12. THE existing register page test suites SHALL continue to pass unmodified in behavior, confirming that any refactor performed to satisfy Requirement 4, criterion 7 did not regress registration
13. All new tests SHALL restore mocks and clear timers after each test and SHALL NOT invoke `npm test` or any npm script from within a test

### Requirement 13: Documentation

**User Story:** As a user or maintainer, I want the new flows documented where I would
look for them, so that I can find or support them.

#### Acceptance Criteria

1. THE `ARCHITECTURE.md` static site section SHALL list the new `forgot-password/` page in its file tree
2. THE `docs/end-user/troubleshooting/README.md` authentication section SHALL document how to reset a forgotten password, including the spam-folder advisory and the unconfirmed-account case
3. THE `docs/end-user/troubleshooting/README.md` SHALL state that a password reset does not change the user's API key
4. THE `CHANGELOG.md` `v0.0.6 (unreleased)` section SHALL gain an `### Added` entry for the password reset and change password flows, referencing this spec directory
5. THE `CHANGELOG.md` `v0.0.6 (unreleased)` section SHALL gain a `### Fixed` entry for the Auth Lambda trigger-source dispatch defect described in Requirement 1
6. Documentation SHALL NOT describe SES, custom email templates, or API key rotation on reset, none of which are in scope

## Out of scope

The following were considered and explicitly excluded:

- Moving Cognito email delivery to SES (decision B1). This remains the largest risk to
  reset reliability in production and is a candidate for a follow-up spec.
- Custom reset email wording via `VerificationMessageTemplate` or a `CustomMessage`
  Lambda trigger (decision B3).
- Rotating the user's API key as part of a reset (decision A2).
- Revoking refresh tokens on other devices after a password change. `changePassword()`
  does not trigger a global sign-out, so existing sessions elsewhere remain valid.
- Any hosted UI or managed login adoption. The pool has no `UserPoolDomain` and this
  feature does not add one.
- Server-side rate limiting of reset requests. Cognito applies its own per-user
  forgot-password throttling, and the Resend_Controller's 3-attempt cap sits below it.
