# Design Document

## Overview

This design delivers three things:

1. A new unauthenticated page, `public/forgot-password/index.html`, implementing a
   three-step reset wizard over Cognito's `ForgotPassword` / `ConfirmForgotPassword`
   APIs.
2. A new authenticated `Password` section on `public/profile/index.html` using
   `CognitoUser.changePassword()`.
3. A correctness fix to the Auth Lambda's event dispatcher so Cognito trigger events
   are echoed back rather than answered with an API Gateway response shape.

It also extracts the `PasswordValidator` browser code out of `register/index.html` into
a single shared asset, because this feature adds two more consumers and the current
inline-per-page pattern would otherwise produce four copies of the password policy.

No new AWS resources, IAM permissions, Lambda routes, API Gateway paths, or buildspec
steps are introduced. The only CloudFormation change is one additive property on the
existing user pool.

## Architecture

### Request flows

```
FORGOT PASSWORD (unauthenticated)

  /forgot-password/  ──ForgotPassword───────────────▶ Cognito ──▶ email w/ code
        │                                                 (default Cognito sender)
        │  user enters code + new password
        └──ConfirmForgotPassword──────────────────────▶ Cognito
                                                          │
                                    password updated ─────┤
                                                          ▼
                                    PostConfirmation trigger fires with
                                    triggerSource = PostConfirmation_ConfirmForgotPassword
                                                          │
                                                          ▼
                                              Auth Lambda index.js
                                              ── echoes event unmodified ──▶ Cognito OK
                                                          │
                                            (Requirement 1: without this the
                                             operation can return HTTP 400
                                             after the password already changed)

CHANGE PASSWORD (authenticated)

  /profile/ ──getSession()──▶ SDK ──changePassword(old,new)──▶ Cognito
                                                                  │
                                        no trigger fires ─────────┘
                                        session stays valid
```

Both browser flows talk directly to `cognito-idp` from the page. Neither touches the
Auth Lambda, API Gateway, DynamoDB, or the user's API key. The Auth Lambda appears in
the reset flow only as the pool's PostConfirmation trigger, which is why Requirement 1
is a prerequisite rather than an enhancement.

### Static asset pipeline (unchanged)

```
src/static/public/**  ──cp -r──▶ build/final/  ──apply-settings.js──▶  ──aws s3 sync──▶ S3
                                                  (.html + .json only)      (--delete)
```

`04-consolidate-and-deploy.sh:53` copies the whole `public/` tree, so both the new page
directory and the new `public/js/` directory ship with no script change.

CloudFront invalidation is not part of this pipeline — it is handled by the CloudFront
deployment, maintained outside this repository.

## Design decisions

### D1. Share the validator as an external JS asset

**Decision:** Move the browser `PasswordValidator` IIFE from inline in
`register/index.html` (lines 115-305) to `public/js/password-validator.js`, loaded by all
three consuming pages via `<script src>`.

**Constraint that shapes this:** `apply-settings.js` resolves `{{{settings.*}}}` tokens
only in `.html` and `.json` files — `findFiles(targetDir, ['.html', '.json'])`. A `.js`
asset therefore cannot contain settings tokens. This is not a problem for the validator,
which is entirely self-contained and token-free, but it does mean the per-page Cognito
configuration (`cognitoUserPoolId`, `cognitoClientId`, `apiBaseUrl`, `footer`) must stay
inline in each page's HTML. That matches the existing pattern.

**Alternatives considered:**

- *Inline the validator on all three pages.* Zero disruption to existing tests, but
  produces four copies of `POLICY_RULES` (three browser, one Lambda) with only the
  register copy currently under drift test. Rejected by Requirement 4, criterion 7.
- *Build-time partial inlining.* Would require a new postdeploy step and would mean the
  source HTML no longer contains the validator, breaking the "tests read the source
  HTML" model the existing suite relies on. Rejected as disproportionate.

**Accepted cost:** the existing jsdom test harness only executes *inline* scripts, so
six of the seven static test files need their page-loading helper updated. See D3.

### D2. Cache-bust the shared asset with a settings token

**Decision:** Reference the asset as
`<script src="/js/password-validator.js?v={{{settings.assetVersion}}}"></script>` and add
`"assetVersion"` to the `default` block of `settings.json`.

**Rationale:** Inline scripts are versioned implicitly with the HTML that contains them.
An external asset is not.

Edge caching is already handled: CloudFront invalidation runs as part of the CloudFront
deployment, which is maintained outside this repository, so the edge picks up a new
validator on deploy. The query string addresses the layer invalidation does not reach —
**browser** caches on returning visitors' machines, which hold the previously served
`/js/password-validator.js` until its `max-age` expires regardless of what the edge does.
Without it, a returning user could pair fresh HTML with a stale validator and see
outdated policy hints.

This is defense in depth rather than the primary mechanism. The consequence of skipping
it is mild and self-correcting, since Cognito enforces the real policy server-side either
way.

The token works because it sits in an `.html` file, which `apply-settings.js` does
process. `assetVersion` must be present in `settings.json` — unresolved tokens are left
verbatim by design, which would put literal braces in the query string.

**Maintenance note:** `assetVersion` must be bumped when the shared asset changes. This
is a documented step, not an automated one.

### D3. Consolidate the jsdom page-loading helper

**Decision:** Add `tests/helpers/load-page.mjs` exporting `loadPage`, `setupCognitoMock`,
and `executePageScripts`, and migrate the existing static test files to it.

`executePageScripts` gains one new capability over the current copies: it resolves
`<script src="/js/...">` tags to disk (stripping any `?v=` query), reads them, and
executes them in document order before the inline scripts. External `https://` scripts
(the Cognito CDN) continue to be skipped.

**Why this is unavoidable:** the three existing helper implementations
(`registration-form.jest.mjs:31-45`, `registration-validation.property.jest.mjs:61-105`,
and the variant in `accessibility-tests.jest.mjs:38-67`) all match
`/<script>([\s\S]*?)<\/script>/g`, which matches inline scripts only. After D1,
`window.PasswordValidator` would be undefined in jsdom. That breaks any test that submits
the register form, because the submit handler calls
`window.PasswordValidator.isReadyForSubmission` (`register/index.html:490`).

**Files affected:** `registration-form.jest.mjs`, `registration-validation.property.jest.mjs`,
`register-reregistration-tests.jest.mjs`, `register-resend-tests.jest.mjs`,
`register-query-param-tests.jest.mjs`, `accessibility-tests.jest.mjs`.
`login-unverified-tests.jest.mjs` does not load the register page and may be migrated for
consistency or left alone.

**Secondary benefit:** this removes six near-duplicate copies of the same three helper
functions, which is a net reduction in test-suite surface area.

**Note on path conventions:** the register tests resolve paths from
`import.meta.dirname`; `accessibility-tests.jest.mjs` resolves from `process.cwd()`. The
helper will accept an absolute path and leave resolution to the caller, so neither
convention has to change.

### D4. Detect Cognito triggers by `triggerSource`, not by trigger name

**Decision:** Branch on the *presence* of `event.triggerSource`, handle
`PostConfirmation_ConfirmSignUp` specifically, and echo every other trigger source back
unmodified.

**Rationale:** SAM registers the PostConfirmation trigger pool-wide
(`template.yml:1107-1111`); it cannot be scoped to one trigger source. Enumerating known
sources would leave the same latent bug for any trigger source added later. Testing for
the presence of `triggerSource` makes the Cognito branch closed by construction: no
Cognito event can ever reach the API Gateway branch.

**Logging:** the trigger branch uses `console.*`, not `DebugAndLog`, matching the
existing `PostConfirmation_ConfirmSignUp` path. That path deliberately runs before
`Config.promise()` / `Config.prime()`, so cache-data logging configuration is not
guaranteed to be initialized there.

### D5. Element ID reuse over validator parameterization

**Decision:** The reset page's confirm step and the profile page's password section both
use the element IDs the validator's `FIELD_IDS` map already hardcodes — `password-input`,
`confirm-password-input`, `password-requirements`, `password-match-status`.

**Rationale:** `getFirstErrorField()` and `getAriaAttributes()` return those literal IDs.
Using different IDs would mean the returned values do not resolve on the page, so the
focus-management and ARIA criteria could not be satisfied without changing the validator.
Requirement 4, criterion 9 permits parameterizing the validator as a fallback; it is not
needed, because no consuming page has a second password pair that would collide.

Verified: `profile/index.html` currently defines no element with any of those four IDs.

### D6. Password section placement on the profile page

**Decision:** Insert the new section as the **last** `profile-section`, after
`Upgrade to Paid Tier` (which ends at `profile/index.html:105`) and before the logout
block (lines 107-110).

**Rationale:** Everything above it — account, tier, API key, promotion code, upgrade — is
either the reason users visit or an action they take regularly. Changing a password is
infrequent, so it belongs below the routine content rather than displacing it. Logout
stays last, as it is not a `profile-section` and reads as the page's terminal action.

## Data Models

This feature persists nothing. No DynamoDB item shape changes, no Cognito user attribute
is written, and the user's `custom:api_key` and `custom:tier` attributes are untouched by
both flows. The models below are in-memory contracts only.

### Cognito trigger event (dispatcher input)

The dispatcher branches on one field. The rest of the event is passed through untouched.

```javascript
{
  triggerSource: 'PostConfirmation_ConfirmSignUp'          // handled
              | 'PostConfirmation_ConfirmForgotPassword'   // echoed
              | <any other Cognito trigger source>,        // echoed
  userPoolId: string,
  userName: string,
  request:  { userAttributes: Object.<string,string>, clientMetadata?: Object },
  response: {}
}
```

### Dispatcher return contract

| Input shape | Return value |
|---|---|
| `triggerSource === 'PostConfirmation_ConfirmSignUp'` | whatever the Post_Confirmation_Handler returns, or throws |
| `triggerSource` present, any other value | the received event object, by reference, unmodified |
| `httpMethod` and `path` present, no `triggerSource` | finalized API Gateway proxy response from `Routes.process` |
| neither | finalized 400 API Gateway proxy response |

Returning the event *by reference* rather than a copy is intentional: Cognito expects the
event echoed, and constructing a new object risks dropping fields added by future Cognito
versions.

### Validator result object

Produced by `validateForm(password, confirmPassword)` and consumed by the other four
exported functions. Shape is unchanged by this feature; reproduced here because three
pages now depend on it.

```javascript
{
  isValid: boolean,              // true only when errors is empty
  errors: Array.<string>,        // flat list of human-readable messages
  fieldErrors: {
    'password'?: Array.<string>,
    'confirm-password'?: Array.<string>
  }
}
```

`getFirstErrorField(result)` returns one of the literal element IDs
`'password-input'`, `'confirm-password-input'`, or `null`. This is the coupling that
drives design decision D5.

### Resend state

Per-page in-memory object, values identical to `register/index.html:320-326`.

```javascript
{
  count: number,           // successful resends so far
  maxResends: 3,
  cooldownMs: 30000,
  initialDelayMs: 30000,
  timerId: number | null   // pending setTimeout handle, cleared before reuse
}
```

### Reset page transient state

```javascript
{
  submittedEmail: string   // retained from Request_Step for Confirm_Step and resend (Req 2.9)
}
```

Held in the page IIFE closure only. Not written to `localStorage` or `sessionStorage`, so
a reload discards it and returns the user to the Request_Step.

### Settings keys consumed

| Key | Pages | Source |
|---|---|---|
| `cognitoUserPoolId` | forgot-password (new), register, login, profile | CLI flag from stack lookup |
| `cognitoClientId` | forgot-password (new), register, login, profile | CLI flag from stack lookup |
| `footer` | forgot-password (new), all pages | `settings.json` default |
| `assetVersion` | forgot-password, register, profile | `settings.json` default (**new key**) |

`apiBaseUrl` is deliberately *not* consumed by the forgot-password page: neither Cognito
operation goes through API Gateway, matching the login page, which also omits it.

## Components and Interfaces

### 1. Auth Lambda event dispatcher

**File:** `src/lambda/auth-function/index.js` (modified)

Replace the single-source check at line 52 with a trigger-source branch placed before all
cache-data initialization. Indentation is tabs, matching the file.

```javascript
async function handler(event, context) {
	// >! Cognito user pool trigger events are identified by triggerSource and have no
	// >! httpMethod/path. They MUST be echoed back unmodified — returning an API Gateway
	// >! shaped response causes Cognito to raise InvalidLambdaResponseException on
	// >! operations such as ConfirmForgotPassword, after the password has already changed.
	if (typeof event.triggerSource === 'string') {
		if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
			try {
				return await postConfirmationHandler.handler(event);
			} catch (error) {
				console.error('Post-Confirmation trigger error:', error);
				// >! Re-throw to reject the Cognito confirmation
				throw error;
			}
		}

		// >! Any other trigger source (e.g. PostConfirmation_ConfirmForgotPassword) is not
		// >! handled by this function. Echo the event so Cognito completes the operation.
		console.log(`Unhandled Cognito trigger source: ${event.triggerSource}`);
		return event;
	}

	// ... existing API Gateway path, unchanged
}
```

Behavioral consequences:

- `PostConfirmation_ConfirmForgotPassword` returns the event; the Post_Confirmation_Handler
  is never reached, so no Users-table write and no `AdminUpdateUserAttributes` call occur
  on a password reset. This matters: that handler creates the user record and issues the
  initial API key, so invoking it on a reset would overwrite existing account state.
- The `Unrecognized event type` 400 branch is preserved for events that are neither
  Cognito triggers nor API Gateway proxy requests.
- No IAM change. No environment variable change.

### 2. Shared password validator asset

**File:** `public/js/password-validator.js` (new)

Content is the existing IIFE from `register/index.html` lines 115-305, moved verbatim.
`POLICY_RULES`, `ERROR_MESSAGES`, `FIELD_IDS`, and the five exported functions are
unchanged. The leading docblock is updated to note that the file is shared by the
register, forgot-password, and profile pages and that it must stay behaviorally identical
to `src/lambda/auth-function/utils/password-validator.js`.

No settings tokens, no DOM access at load time, no dependency on the Cognito SDK. It
assigns `window.PasswordValidator` and nothing else.

### 3. Forgot password page

**File:** `public/forgot-password/index.html` (new)

Structural pattern follows `register/index.html`: sibling step containers toggled by the
`hidden` class, all inside `.container`, with a breadcrumb nav and the
`{{{settings.footer}}}` token. All CSS classes used already exist in `public/css/index.css`
(`auth-form`, `form-group`, `btn`, `btn-secondary`, `alert`, `alert-error`, `alert-info`,
`alert-success`, `field-error`, `field-success`, `hidden`, `visually-hidden`,
`form-footer`, `breadcrumb-nav`). No CSS changes required.

```
#request-step   (visible)
  #reset-error            .alert .alert-error   role=alert      aria-live=polite
  #reset-form
    #email                type=email  autocomplete=email  aria-required=true
                          aria-describedby=reset-error
    #reset-btn            submit
  .form-footer            links to /login/ and /register/

#confirm-step   (hidden)
  #confirm-error          .alert .alert-error   role=alert      aria-live=polite
  #confirm-info           .alert .alert-info    role=status     (neutral copy, Req 6.9)
  #spam-advisory          .alert .alert-info    role=note       aria-live=polite
  #confirm-form
    #verification-code    type=text  autocomplete=one-time-code  inputmode=numeric
                          pattern=[0-9]*  aria-describedby=confirm-error
    #password-input       type=password  autocomplete=new-password
                          aria-describedby=password-requirements
    #password-requirements
    #confirm-password-input  type=password  autocomplete=new-password
                          aria-describedby=password-match-status
    #password-match-status
    #validation-announcements  .visually-hidden  aria-live=polite  aria-atomic=true
    #confirm-btn          submit
  #resend-container       (hidden)
    #resend-btn           aria-label="Resend reset code to your email"
    #resend-status        role=status  aria-live=polite

#success-step   (hidden)
  .alert .alert-success   role=status
  API key advisory + link to /profile/          (Req 7.2, 7.3)
  link to /login/                               (Req 7.4)
```

Script order in the page, matching the register page's convention:

1. inline `copyright-year` stamp
2. Cognito SDK from CDN
3. `<script src="/js/password-validator.js?v={{{settings.assetVersion}}}"></script>`
4. inline IIFE with `USER_POOL_ID` / `CLIENT_ID` tokens and all page logic

The inline IIFE holds `submittedEmail` (retained per Requirement 2.9) and a `resendState`
object copied from `register/index.html:320-326` with identical values.

### 4. Login page entry points

**File:** `public/login/index.html` (modified)

- Add a "Forgot your password?" link to `/forgot-password/` inside `.form-footer`
  (lines 40-43).
- In the `onFailure` branch, the generic incorrect-credentials message for
  `NotAuthorizedException` and `UserNotFoundException` (lines 149-154) becomes a message
  plus a link. Because `#login-error` is populated with `textContent` today, this requires
  switching that specific case to build a text node plus an anchor element, or setting
  `innerHTML` from a page-controlled constant string. **The message string must remain
  constructed from literals, never from `err.message`,** so no server-supplied text can
  reach `innerHTML`.
- The existing `UserNotConfirmedException` behavior (lines 107-143) is untouched.
- Both exception codes continue to map to the same message, preserving the
  `PreventUserExistenceErrors` posture.

### 5. Profile page password section

**File:** `public/profile/index.html` (modified)

New section inserted after the `Upgrade to Paid Tier` section (ends line 105) and before
the logout block (line 107), making it the last `profile-section` on the page. Follows the
existing `profile-section` + `aria-labelledby` pattern:

```
<section class="profile-section" aria-labelledby="password-heading">
  #password-heading            h2 "Password"
  #change-password-error       .alert .alert-error    role=alert   aria-live=polite
  #change-password-success     .alert .alert-success  role=alert   aria-live=polite
  #change-password-form
    #current-password          type=password  autocomplete=current-password
    #password-input            type=password  autocomplete=new-password
    #password-requirements
    #confirm-password-input    type=password  autocomplete=new-password
    #password-match-status
    #validation-announcements  .visually-hidden  aria-live=polite  aria-atomic=true
    #change-password-btn       submit
  note: API key is not affected by a password change   (Req 9.11)
</section>
```

The page's existing IIFE gains the submit handler. It reuses the page's existing
`cognitoUser` reference and `getJwt`-style session pattern:

- On submit, validate `#current-password` non-empty and run the validator submission gate
  before calling `changePassword()`.
- `changePassword()` operates on the current session. If the session is absent or invalid
  the SDK errors; the handler redirects to `/login/`, consistent with the page's existing
  gating at lines 276-286.
- On success, clear all three inputs, show `#change-password-success`, and stay on the
  page. No sign-out, no redirect.

The shared validator asset is added to this page's script list, before the existing inline
IIFE.

### 6. CloudFormation

**File:** `application-infrastructure/template.yml` (modified)

One additive property on `CognitoUserPool`, placed alongside the existing
`AutoVerifiedAttributes`:

```yaml
      AccountRecoverySetting:
        RecoveryMechanisms:
          - Name: verified_email
            Priority: 1
```

This is a no-op against current effective behavior — it declares what the pool already
infers from `AutoVerifiedAttributes: [email]` — so it does not force a replacement or
change existing users. `EmailConfiguration`, `VerificationMessageTemplate`, and
`LambdaConfig.CustomMessage` are deliberately not added (decisions B1, B3).
`CognitoUserPoolClient` is untouched: `ExplicitAuthFlows` and
`PreventUserExistenceErrors` stay as they are, because `ForgotPassword` and
`ConfirmForgotPassword` are unauthenticated operations not gated by auth flows.

No `template-openapi-spec.yml` change: this feature adds no API Gateway paths.

### 7. Settings

**File:** `src/static/settings.json` (modified)

Add to the `default` block:

```json
"assetVersion": "0-0-6"
```

Stage blocks are unchanged. `settings-loader.js` merges `default` with the stage block, so
all stages resolve the same value.

## Error Handling

Cognito error codes to UI behavior. Every message is a page-owned literal; `err.message`
is used only in the fallback case.

| Operation | Error code | Step behavior | Message intent |
|---|---|---|---|
| `forgotPassword` | `InvalidParameterException` | resend confirmation code, redirect to `/register/?verify=` | account not verified, continuing registration |
| `forgotPassword` | `LimitExceededException`, `TooManyRequestsException` | stay on Request_Step, re-enable | wait before retrying |
| `forgotPassword` | other | stay on Request_Step, re-enable | `err.message` or generic |
| `forgotPassword` | *(unknown email)* | proceeds to Confirm_Step normally | neutral copy; no error path fires |
| `confirmPassword` | `CodeMismatchException` | stay on Confirm_Step | code is incorrect |
| `confirmPassword` | `ExpiredCodeException` | stay on Confirm_Step | code expired, request a new one |
| `confirmPassword` | `InvalidPasswordException` | stay on Confirm_Step | restate policy requirements |
| `confirmPassword` | `LimitExceededException`, `TooManyRequestsException`, `TooManyFailedAttemptsException` | stay on Confirm_Step | wait before retrying |
| `confirmPassword` | other | stay on Confirm_Step | `err.message` or generic |
| `changePassword` | `NotAuthorizedException` | stay, re-enable | current password incorrect |
| `changePassword` | `InvalidPasswordException` | stay, re-enable | restate policy requirements |
| `changePassword` | `LimitExceededException`, `TooManyRequestsException` | stay, re-enable | wait before retrying |
| `changePassword` | other | stay, re-enable | `err.message` or generic |

`PasswordHistoryPolicyViolationException` is documented by Cognito for both
`ConfirmForgotPassword` and password changes but cannot occur here: no password-history
policy is configured on the pool. It falls through to the generic handler.

The unconfirmed-account case is worth stating plainly: with
`PreventUserExistenceErrors: ENABLED`, an unknown email produces a *success* path, while
a known-but-unconfirmed email produces `InvalidParameterException`. The reset page
therefore reveals nothing about unknown addresses while still routing genuinely
unconfirmed users somewhere useful.

## Correctness Properties

Invariants the implementation must uphold. Marked properties are candidates for
`fast-check` property tests, consistent with the existing property suites; the rest are
enumerated unit cases.

### Property 1: Validator equivalence (property, exists today)

**Validates: Requirements 4.1, 4.2, 4.11, 4.12**

For any pair of strings
`(password, confirmPassword)`, all five functions on `window.PasswordValidator` return
results deeply equal to the CommonJS module at
`src/lambda/auth-function/utils/password-validator.js`. Already asserted at 100 runs by
`registration-validation.property.jest.mjs` Property 1; after D1 it covers the shared
asset and therefore all three pages.

### Property 2: Trigger echo identity (property)

**Validates: Requirements 1.2, 1.3, 1.4**

For any event object with a `triggerSource`
that is not `PostConfirmation_ConfirmSignUp`, the dispatcher returns the identical object
reference and the Post_Confirmation_Handler is invoked zero times.

### Property 3: Dispatcher branch exclusivity (property)

**Validates: Requirements 1.1, 1.4, 1.6, 1.7**

For any event, exactly one of four
outcomes occurs: handler delegation, event echo, `Routes.process`, or a 400 response. No
event reaches two branches, and no Cognito trigger event ever produces an API Gateway
response shape.

### Property 4: Existence non-disclosure

**Validates: Requirements 2.7, 6.9, 8.4**

For any email submitted to the Request_Step, the text
rendered to the user is drawn from a fixed set of page-owned literals that does not vary
with whether an account exists. The only branch that varies is
`InvalidParameterException`, which fires for a known-but-unconfirmed account — and it
routes into the pre-existing registration verify flow rather than stating existence.

### Property 5: Resend cap (property)

**Validates: Requirements 5.3, 5.4, 5.5**

For any sequence of resend activations and timer
advances, the number of successful `forgotPassword` resend calls never exceeds
`maxResends` (3). Failed attempts do not consume the budget.

### Property 6: Submission gate (property)

**Validates: Requirements 3.4, 4.3, 9.3**

For any pair `(password, confirmPassword)` where
`isReadyForSubmission` returns false, submitting the Confirm_Step calls
`confirmPassword` zero times, and focus lands on `getFirstErrorField(result)`. The same
holds for the Change_Password_Section and `changePassword`.

### Property 7: Step monotonicity

**Validates: Requirements 2.6, 3.3, 7.5**

The reset page's step index is non-decreasing:
`request → confirm → success`. No error path returns the user to an earlier step. The only
backward transition is a full page reload, which resets to `request` with empty state.

### Property 8: No account state mutation on reset

**Validates: Requirements 1.3, 7.2, 9.11**

A completed reset performs zero writes to the
Users table and zero `AdminUpdateUserAttributes` calls, so `custom:api_key` and
`custom:tier` are byte-identical before and after. This is what Property 2 protects.

### Property 9: Timer hygiene

**Validates: Requirements 5.7**

At most one pending resend timer exists per page at any time; a
new timer is only scheduled after the previous handle is cleared.

## State machines

### Reset page steps

```
request ──forgotPassword success──▶ confirm ──confirmPassword success──▶ success
   │                                   │
   │                                   ├── code/password error ──▶ stays in confirm
   │                                   └── resend ──▶ stays in confirm
   └── InvalidParameterException ──▶ redirect /register/?verify=
```

Steps are one-way. There is no path back from `confirm` to `request`; a user who
mistyped their email uses the browser back button or reloads.

### Resend controller

Values are identical to `register/index.html:320-326`.

```
state: { count: 0, maxResends: 3, cooldownMs: 30000, initialDelayMs: 30000, timerId: null }

confirm step shown ──▶ hidden, 30s timer ──▶ visible/enabled
click ──▶ disabled, in flight
  success, count+1 < 3 ──▶ hidden, 30s cooldown ──▶ visible/enabled
  success, count+1 >= 3 ──▶ disabled permanently, max-attempts message
  failure ──▶ visible/enabled, error message, count unchanged
```

Any pending timer is cleared before a new one starts. Cognito independently throttles
forgot-password code requests per user per hour, at a threshold above 3, so the client cap
is reached first under normal use.

## Element ID inventory

IDs shared across pages, and why:

| ID | Pages | Reason |
|---|---|---|
| `password-input` | register, forgot-password, profile | required by validator `FIELD_IDS` |
| `confirm-password-input` | register, forgot-password, profile | required by validator `FIELD_IDS` |
| `password-requirements` | register, forgot-password, profile | required by validator `FIELD_IDS` |
| `password-match-status` | register, forgot-password, profile | required by validator `FIELD_IDS` |
| `validation-announcements` | register, forgot-password, profile | live region convention |
| `verification-code` | register, forgot-password | code-entry convention |
| `spam-advisory` | register, forgot-password | advisory convention |
| `resend-container`, `resend-btn`, `resend-status` | register, forgot-password | resend convention |

IDs intentionally *not* shared: `#email` exists on register, login, and forgot-password,
but each page has only one, so there is no collision. `#resend-btn` has a different
`aria-label` per page ("Resend verification code…" vs "Resend reset code…"), so the
accessibility test's label assertion must be scoped per page rather than asserted
globally.

## Testing strategy

### New test files

| File | Covers |
|---|---|
| `tests/helpers/load-page.mjs` | shared harness (not a test file; excluded by `testMatch` `**/tests/**/*.jest.mjs`) |
| `tests/forgot-password/forgot-password-form.jest.mjs` | structure, ARIA, step transitions, `forgotPassword`/`confirmPassword` invocation, success step content |
| `tests/forgot-password/forgot-password-errors.jest.mjs` | every row of the error-mapping table for both operations, including the unconfirmed redirect |
| `tests/forgot-password/forgot-password-resend.jest.mjs` | resend initial delay, cooldown, 3-attempt cap, failure path, timer cleanup (fake timers) |
| `tests/profile/change-password.jest.mjs` | change-password success and each error mapping, session-invalid redirect, input clearing, stays on page |
| `auth-function/tests/unit/handler-event-dispatch.test.js` | dispatcher branches per Requirement 1 |

`tests/helpers/` sits under `tests/`, but `testMatch` requires the `.jest.mjs` suffix, so a
`.mjs` helper is not collected as a suite.

### Modified test files

`registration-form.jest.mjs`, `registration-validation.property.jest.mjs`,
`register-reregistration-tests.jest.mjs`, `register-resend-tests.jest.mjs`,
`register-query-param-tests.jest.mjs`, `accessibility-tests.jest.mjs` — migrated to the
shared helper per D3. Their assertions do not change; only page loading does. This is the
regression gate for D1: if the shared asset fails to load, these fail.

`accessibility-tests.jest.mjs` additionally gains `FORGOT_HTML_PATH` and applies its
existing aria-live, aria-describedby, and tab-order assertions to the new page.

### Drift detection

Already present. `registration-validation.property.jest.mjs` Property 1 asserts that all
five browser functions produce results identical to the CommonJS module at
`src/lambda/auth-function/utils/password-validator.js` across 100 generated input pairs.
After D1 this test exercises the shared asset, so it covers all three consuming pages at
once. No new drift test is needed — Requirement 4, criterion 11 is satisfied by keeping
this test passing.

### Dispatcher test cases

Against `src/lambda/auth-function/index.js`, with `handlers/post-confirmation` mocked:

1. `triggerSource: 'PostConfirmation_ConfirmSignUp'` delegates to the handler.
2. Handler rejection re-throws rather than being swallowed.
3. `triggerSource: 'PostConfirmation_ConfirmForgotPassword'` returns the same object
   reference, and the handler mock records zero calls.
4. An unknown `triggerSource` returns the event and logs the source value.
5. An API Gateway event (`httpMethod` + `path`, no `triggerSource`) still routes through
   `Routes.process`.
6. An event with neither still yields a 400 proxy response.

Case 3 is the regression test for the defect; case 1, 2, 5, and 6 guard against the fix
breaking existing paths.

### Constraints

Per the test-execution steering: no test invokes `npm test` or any npm script. All timing
tests use Jest fake timers rather than real delays. Every suite restores mocks and clears
timers in `afterEach`, matching the existing `jest.useRealTimers()` /
`jest.restoreAllMocks()` teardown in the current files.

## Security considerations

- **No new IAM.** Neither flow calls an AWS API from the server side. `ForgotPassword`,
  `ConfirmForgotPassword`, and `changePassword` are called from the browser against the
  public app client, which has no secret. The Auth Lambda role is unchanged.
- **No user-existence disclosure.** The Request_Step's copy and error handling are
  existence-agnostic, and the login page keeps mapping `NotAuthorizedException` and
  `UserNotFoundException` to one message.
- **No secrets in the new asset.** `public/js/password-validator.js` contains only policy
  constants and pure functions. Pool and client IDs stay in page HTML, as they already do,
  and both are non-secret by design for a public SRP client.
- **No injection surface from error text.** The one place this design introduces
  `innerHTML` — the login page's failed-login message with an embedded link — uses only
  page-owned literal strings. `err.message` is never interpolated into markup anywhere;
  it is assigned via `textContent` in the fallback error paths.
- **Password values are never logged** and never leave the page except in the SDK call.
  The Auth Lambda still never handles passwords.
- **Unchanged blast radius on reset.** A reset does not rotate the API key, alter the
  user's tier, or write to DynamoDB. Requirement 1's fix specifically prevents the reset
  path from reaching code that would write account state.

## Deployment

Ordinary pipeline; no manual steps.

1. Template change deploys with the application stack. `AccountRecoverySetting` is
   additive and declares existing effective behavior, so no user impact and no resource
   replacement.
2. Postdeploy stage runs the static-site Jest suite, then the doc scripts, then
   `04-consolidate-and-deploy.sh`. New page and new `public/js/` directory are picked up
   by the existing `cp -r` and shipped by the existing `aws s3 sync --delete`.

**Ordering within the change:** the dispatcher fix (Requirement 1) should be implemented
and merged first, or at minimum land in the same deployment as the reset page. Shipping
the page without the fix exposes the failure mode the fix exists to prevent.

**Rollback:** reverting removes the page and the link. Cognito holds no feature state, so
there is nothing to unwind. Users who already reset a password keep the new password.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Test-harness migration (D3) breaks currently-passing register tests | Medium | Migrate and run the suite before adding new pages; the assertions are unchanged so any failure is harness-local |
| Stale cached copy of the shared validator | Low | Edge caches are cleared by the CloudFront deployment's invalidation; the `assetVersion` query string (D2) covers browser caches. Worst case is briefly outdated client-side policy hints, with Cognito still enforcing server-side |
| Reset email not delivered (default sender, ~50/day account-wide, shared with signup verification) | **High** | Out of scope by decision B1. Spam advisory and resend are the only in-scope mitigations. Change-password gives signed-in users an email-free path. This remains the largest threat to the feature working in production |
| `assetVersion` not bumped when the validator changes | Low | Documented step; the drift property test still catches behavioral divergence at build time |
| Forgetting to bump `assetVersion` in `settings.json` before first deploy leaves a literal token in the URL | Low | The setting is added in the same change as the `<script src>` reference |

## Requirements traceability

| Requirement | Design coverage |
|---|---|
| 1 — dispatcher correctness | D4; Components and Interfaces 1; dispatcher test cases 1-6 |
| 2 — requesting a reset code | Component 3 `#request-step`; error mapping |
| 3 — confirming code and new password | Component 3 `#confirm-step` |
| 4 (1-6) — policy validation UX | Component 2; Component 3 script order |
| 4 (7-12) — validator reuse constraints | D1, D2, D5; Component 2; Component 7; drift detection |
| 5 — resend | Component 3; resend state machine |
| 6 — error handling and edge cases | Error Handling table |
| 7 — reset success state | Component 3 `#success-step` |
| 8 — login entry points | Component 4 |
| 9 — authenticated change password | D6; Component 5 |
| 10 — pool recovery configuration | Component 6 |
| 11 — accessibility | Component 3 and 5 ID/ARIA tables; accessibility test extension |
| 12 — test coverage | Testing strategy |
| 13 — documentation | Not a code component; see tasks |
