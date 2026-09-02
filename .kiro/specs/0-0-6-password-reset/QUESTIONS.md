# Password Reset — Open Questions

Questions to resolve before writing `requirements.md`. Answer inline under each
**Answer:** line. Recommendations are provided but not assumed.

## Context

Investigation of the current state found:

- Login (`src/static/public/login/index.html`), register, and profile pages all use
  `amazon-cognito-identity-js@6` from CDN with the SRP flow. No Amplify, no hosted UI.
- The user pool client (`template.yml:1025-1034`) is `GenerateSecret: false` with
  `ExplicitAuthFlows: [ALLOW_USER_SRP_AUTH, ALLOW_REFRESH_TOKEN_AUTH]` and
  `PreventUserExistenceErrors: ENABLED`.
- `ForgotPassword` / `ConfirmForgotPassword` are unauthenticated Cognito APIs and are
  **not** gated by `ExplicitAuthFlows`, so the browser SDK can call them with no
  template, IAM, or Lambda changes.
- `AutoVerifiedAttributes: [email]` means the pool defaults to `verified_email`
  recovery even though no `AccountRecoverySetting` is declared.
- `postdeploy-scripts/04-consolidate-and-deploy.sh:53` copies all of `public/`, so a
  new page needs no build script changes.
- No forgot-password page, route, or copy exists anywhere in the repo today.

**Baseline scope** (assumed unless a question below changes it): one new page at
`public/forgot-password/index.html`, a link from the login page footer, a jsdom Jest
suite, and doc updates to `ARCHITECTURE.md`, `docs/end-user/troubleshooting/README.md`,
and `CHANGELOG.md`.

---

## Group A — Product scope

### A1. Reset only, or also authenticated change-password?

The original request said "password reset option to the user profile login," which is
ambiguous between two flows:

- **Forgot password** (unauthenticated): email → emailed code → new password. Requires
  email delivery.
- **Change password** (authenticated, from `/profile/`): current password + new
  password via `cognitoUser.changePassword()`. No email involved, so it is immune to
  the deliverability concern in B1.

Both can reuse the existing `window.PasswordValidator` block from the register page.

- [ ] Forgot password only
- [ ] Change password only
- [ ] Both

**Recommendation:** Both. Change-password is marginally more work than the reset flow
alone and sidesteps email delivery entirely, so it gives users a working path even if
reset emails are unreliable.

**Answer:** Both

### A2. Should a password reset rotate the user's API key?

Nothing in the reset path currently touches the `api_key` custom attribute or the
DynamoDB user record. If a reset is being performed because an account was
compromised, leaving the API key valid is arguably wrong.

Rotating it would require a server-mediated step and new IAM — the Auth Lambda role
has only `cognito-idp:AdminUpdateUserAttributes` today (`template.yml:1204-1208`).

- [ ] No rotation; tell the user their key is unchanged and link to `/profile/`
- [ ] No rotation, no mention
- [ ] Rotate automatically as part of the reset
- [ ] Offer rotation as an optional step on the success screen

**Recommendation:** No rotation, but state it explicitly on the success screen and link
to the existing regenerate action on `/profile/`. Automatic rotation turns a
self-service page into a privileged operation and widens the IAM surface.

**Answer:** No rotation; tell the user their key is unchanged and link to `/profile/`

### A3. Where should the entry points be?

The login page `.form-footer` (`login/index.html:41-44`) currently has only "Register"
and a rate-limits link. Candidate entry points:

- [ ] Login page footer only
- [ ] Login page footer + a link on the profile page
- [ ] Login page footer + surfaced in the "Incorrect email or password" error
- [ ] Other (describe)

**Recommendation:** Login footer, plus surfacing it in the failed-login error message —
that is the moment the user actually needs it. If A1 includes change-password, that
gets its own section on `/profile/` rather than a link.

**Answer:**
Login footer, plus surfacing it in the failed-login error message —
that is the moment the user actually needs it. If A1 includes change-password, that
gets its own section on `/profile/` rather than a link.

---

## Group B — Infrastructure

### B1. Email deliverability: stay on the Cognito default sender, or move to SES?

There is no `EmailConfiguration` on the pool, so it uses Cognito's default sender:
roughly 50 emails/day account-wide, from `no-reply@verificationemail.com`. The register
page already ships a "check your spam or junk folder" advisory
(`register/index.html:63`), which suggests this is a known friction point.

Password reset shares that same daily quota with signup verification. Unlike signup,
a failed reset email leaves an existing user locked out.

- [ ] Accept the default sender for now; ship reset as-is with a spam advisory
- [ ] Move to SES as a prerequisite of this spec
- [ ] Move to SES as a follow-up spec; ship reset on the default sender first
- [ ] Other (describe)

**Recommendation:** Treat SES as a separate follow-up spec and ship reset on the default
sender with the spam advisory. But note this is the single largest risk to the feature
actually working in production, and it is a bigger change than the feature itself.

**Answer:** Accept the default sender for now; ship reset as-is with a spam advisory

### B2. Add an explicit `AccountRecoverySetting` to the user pool?

Recovery currently works by default inference from `AutoVerifiedAttributes: [email]`.
Declaring it explicitly (`verified_email`, priority 1) is a one-resource template change
that makes the behavior intentional rather than implicit.

- [ ] Yes, add it explicitly
- [ ] No, rely on the default
- [ ] Defer

**Recommendation:** Add it. It is nearly free, it documents intent in the template, and
it protects against a future change to `AutoVerifiedAttributes` silently altering
recovery behavior.

**Answer:** Add it. It is nearly free, it documents intent in the template, and
it protects against a future change to `AutoVerifiedAttributes` silently altering
recovery behavior.

### B3. Custom reset email wording?

There is no `VerificationMessageTemplate` and no `CustomMessage` Lambda trigger, so
reset emails would use stock Cognito wording.

- [ ] Stock wording is fine
- [ ] Add a `VerificationMessageTemplate` for reset messages
- [ ] Add a `CustomMessage` Lambda trigger for full control
- [ ] Defer

**Recommendation:** Stock wording for now. A `CustomMessage` trigger adds a new Lambda
entry point and interacts with the trigger-dispatch issue in C1; not worth it in the
same spec.

**Answer:** Stock wording

---

## Group C — Implementation details

### C1. The `PostConfirmation_ConfirmForgotPassword` dispatch gap

`auth-function/index.js:52` dispatches on exactly one trigger source:

```javascript
if (event.triggerSource === 'PostConfirmation_ConfirmSignUp') {
```

Cognito fires the **same** PostConfirmation trigger with
`triggerSource === 'PostConfirmation_ConfirmForgotPassword'` after a successful reset
confirmation. The trigger is registered pool-wide via SAM `Events`
(`template.yml:1107-1111`) and cannot be scoped to a single source.

That event has no `httpMethod`/`path`, so it falls through to the API Gateway branch and
lands in the "Unrecognized event type" path, returning a 400-shaped proxy response
instead of echoing the event back to Cognito.

**Not yet verified at runtime:** whether Cognito surfaces this as an
`InvalidLambdaResponseException` to the browser or ignores it. The password is already
changed by the time PostConfirmation runs, so the likely symptom is a confusing error
*after* a successful reset. This needs confirming either way.

- [ ] Fix as part of this spec
- [ ] Fix now as a separate small spec/bugfix, before this one
- [ ] Investigate first, then decide

**Recommendation:** Fix it first as a standalone change with a unit test. It is a
two-line early return, it is a real bug independent of this feature, and having it
already fixed removes a confound from testing the reset flow.

**Answer:** Investigate first, then decide

### C2. Unconfirmed-user edge case

An unconfirmed user calling `ForgotPassword` gets `InvalidParameterException` ("no
registered/verified email"), which is not self-explanatory. Users who registered but
never clicked through verification will hit this.

The login page already special-cases `UserNotConfirmedException` by resending a
confirmation code and redirecting to `/register/?verify=<email>`
(`login/index.html:108-142`).

- [ ] Map `InvalidParameterException` to the same resend + redirect behavior
- [ ] Show a plain message telling them to complete registration, no redirect
- [ ] Leave the raw Cognito message
- [ ] Other (describe)

**Recommendation:** Mirror the existing login-page behavior. It is a pattern already in
the codebase and already covered by `tests/login-unverified-tests.jest.mjs`, so it is
consistent and testable.

**Answer:** Mirror the existing login-page behavior. It is a pattern already in
the codebase and already covered by `tests/login-unverified-tests.jest.mjs`, so it is
consistent and testable.

### C3. Copy for non-existent accounts

With `PreventUserExistenceErrors: ENABLED`, `ForgotPassword` returns success even for an
unknown email — no `UserNotFoundException` is raised. The UI copy has to be written for
that, not for an error path that never fires.

Proposed step-2 copy: *"If an account exists for that address, we've sent a reset code.
Enter it below."*

- [ ] Approved
- [ ] Revise (provide wording)

**Answer:** Approved

### C4. Resend cooldown parameters

The register page's `resendState` (`register/index.html:317-323`) uses a 30s initial
delay, 30s cooldown, and max 3 resends.

- [ ] Reuse the same values
- [ ] Different values (specify)

**Recommendation:** Reuse. Consistency across the two code-entry flows, and the logic can
be lifted directly.

**Answer:** Reuse the same values

---

## Notes / anything else

**Answer:**
