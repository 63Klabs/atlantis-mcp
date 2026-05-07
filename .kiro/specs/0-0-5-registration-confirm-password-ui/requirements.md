# Requirements Document

## Introduction

Add a confirm-password (re-entry) field to the registration form so users must enter their password twice before submitting. The feature integrates the existing `password-validator` module into the static registration page, providing real-time validation feedback, accessible error messaging, and submission gating to prevent mismatched passwords from reaching the Cognito signUp API.

## Glossary

- **Registration_Form**: The HTML form at `application-infrastructure/src/static/public/register/index.html` that collects email and password for Cognito user sign-up
- **Password_Field**: The primary password input where users enter their chosen password (element ID: `password-input`)
- **Confirm_Password_Field**: The secondary password input where users re-enter their password for verification (element ID: `confirm-password-input`)
- **Validator**: The client-side password validation logic derived from the `password-validator.js` module, inlined into the registration page
- **Validation_Status_Region**: A visually hidden ARIA live region that announces validation errors to assistive technologies (element ID: `validation-announcements`)
- **Password_Requirements_Element**: The element displaying password policy feedback below the password field (element ID: `password-requirements`)
- **Match_Status_Element**: The element displaying match/mismatch feedback below the confirm-password field (element ID: `password-match-status`)
- **Submission_Gate**: The logic that prevents form submission when `isReadyForSubmission()` returns `false`

## Requirements

### Requirement 1: Add confirm-password field to registration form

**User Story:** As a user registering for an account, I want to enter my password twice, so that I can verify I typed it correctly before submitting.

#### Acceptance Criteria

1. WHEN the Registration_Form is rendered, THE Registration_Form SHALL display the Confirm_Password_Field immediately after the Password_Field in DOM order
2. THE Confirm_Password_Field SHALL have the element ID `confirm-password-input`, type `password`, autocomplete attribute `new-password`, and `aria-required` set to `true`
3. THE Confirm_Password_Field SHALL have a visible label with text "Confirm password" associated via the `for` attribute matching the element ID `confirm-password-input`
4. WHEN the Registration_Form is rendered, THE Registration_Form SHALL display the Match_Status_Element with element ID `password-match-status` immediately after the Confirm_Password_Field in DOM order
5. THE Confirm_Password_Field SHALL have `aria-describedby` pointing to the element ID `password-match-status`

### Requirement 2: Reconcile password field element IDs with validator expectations

**User Story:** As a developer, I want the DOM element IDs to match the validator module's `FIELD_IDS` constants, so that focus management and ARIA attribute generation work correctly.

#### Acceptance Criteria

1. THE Registration_Form SHALL use element ID `password-input` for the Password_Field
2. THE Registration_Form SHALL use element ID `confirm-password-input` for the Confirm_Password_Field
3. THE Registration_Form SHALL use element ID `password-requirements` for the Password_Requirements_Element
4. THE Registration_Form SHALL use element ID `password-match-status` for the Match_Status_Element
5. THE Registration_Form SHALL use element ID `validation-announcements` for the Validation_Status_Region
6. WHEN the Password_Field ID changes from `password` to `password-input`, THE Registration_Form SHALL update all references to the old ID in JavaScript and `aria-describedby` attributes

### Requirement 3: Inline the validator module for client-side use

**User Story:** As a developer, I want the password-validator functions available in the browser, so that real-time validation works without a build step or additional HTTP request.

#### Acceptance Criteria

1. THE Validator SHALL provide a browser-compatible inline script variant that exposes the functions `validateForm`, `isReadyForSubmission`, `getFirstErrorField`, `getAriaAttributes`, and `getAriaLiveRegion` on the `window.PasswordValidator` namespace object
2. THE Validator inline script variant SHALL contain no CommonJS statements (`require`, `module.exports`, `exports`), no Node.js-specific globals (`process`, `Buffer`, `__dirname`, `__filename`), and no ES module syntax (`import`, `export`)
3. THE Validator inline script variant SHALL produce identical return values to the CommonJS module for the same inputs across all five exposed functions
4. WHEN the inline script variant executes in a browser environment, THE Validator SHALL attach exactly five functions (`validateForm`, `isReadyForSubmission`, `getFirstErrorField`, `getAriaAttributes`, `getAriaLiveRegion`) to `window.PasswordValidator` without adding any other properties to the global `window` object

### Requirement 4: Real-time password policy validation feedback

**User Story:** As a user, I want to see which password rules I have satisfied as I type, so that I can correct my password before submitting.

#### Acceptance Criteria

1. WHEN the user types in the Password_Field, THE Validator SHALL call `validateForm()` on each `input` event and update the Password_Requirements_Element with current policy violation messages
2. WHEN the user types in the Confirm_Password_Field, THE Validator SHALL call `validateForm()` on each `input` event and update the Match_Status_Element with the current match-status message
3. WHILE the Password_Field has one or more policy violations as determined by `validateForm()`, THE Validator SHALL set the Password_Field's `aria-invalid` attribute to `"true"`
4. WHILE the Password_Field satisfies all policy rules as determined by `validateForm()`, THE Validator SHALL set the Password_Field's `aria-invalid` attribute to `"false"`
5. WHEN the Password_Field value changes, THE Validator SHALL update the Validation_Status_Region content using `getAriaLiveRegion()` so that the region with `aria-live` set to `"polite"` announces the current validation errors to screen readers
6. WHEN the Confirm_Password_Field value changes, THE Validator SHALL update the Validation_Status_Region content using `getAriaLiveRegion()` so that the region with `aria-live` set to `"polite"` announces the current match-status to screen readers

### Requirement 5: Real-time match validation with suppression

**User Story:** As a user, I want to see whether my passwords match after I start typing in the confirm field, so that I know immediately if I made a typo.

#### Acceptance Criteria

1. WHILE the Confirm_Password_Field is empty, THE Validator SHALL suppress mismatch error messages by clearing the Match_Status_Element text content and setting `aria-invalid` to `"false"` on the Confirm_Password_Field
2. WHEN the user types in the Confirm_Password_Field, THE Validator SHALL call `validateForm()` on each `input` event and display the resulting match or mismatch status in the Match_Status_Element according to criteria 3 and 4
3. WHILE the Confirm_Password_Field is non-empty and passwords do not match, THE Confirm_Password_Field SHALL have `aria-invalid` set to `"true"` and the Match_Status_Element SHALL display "Passwords do not match"
4. WHILE both passwords match and the Password_Field passes policy validation, THE Confirm_Password_Field SHALL have `aria-invalid` set to `"false"` and the Match_Status_Element SHALL display "Passwords match"
5. WHEN the Password_Field value changes via an `input` event, THE Validator SHALL re-evaluate match status against the current Confirm_Password_Field value and update the Match_Status_Element and `aria-invalid` attribute according to criteria 1, 3, and 4

### Requirement 6: Form submission gating

**User Story:** As a system operator, I want the form to prevent submission when passwords are invalid or mismatched, so that invalid signUp requests are never sent to Cognito.

#### Acceptance Criteria

1. WHEN the user submits the Registration_Form, THE Submission_Gate SHALL call `isReadyForSubmission(password, confirmPassword)` using the current field values before invoking `userPool.signUp()`
2. IF `isReadyForSubmission()` returns `false`, THEN THE Registration_Form SHALL prevent the signUp call and display the errors from the `validateForm(password, confirmPassword)` result
3. IF `isReadyForSubmission()` returns `false`, THEN THE Registration_Form SHALL call `getFirstErrorField(validationResult)` with the result of `validateForm()` and set focus to the DOM element matching the returned element ID
4. IF `getFirstErrorField(validationResult)` returns `null`, THEN THE Registration_Form SHALL not change focus
5. WHEN `isReadyForSubmission(password, confirmPassword)` returns `true`, THE Registration_Form SHALL proceed with the Cognito signUp flow using the Password_Field value

### Requirement 7: WCAG 2.1 AA accessibility compliance

**User Story:** As a user relying on assistive technology, I want the password confirmation experience to be fully accessible, so that I can register independently.

#### Acceptance Criteria

1. THE Validation_Status_Region SHALL have `aria-live` set to `"polite"` and `aria-atomic` set to `"true"`
2. THE Validation_Status_Region SHALL be visually hidden using a CSS class that keeps it accessible to screen readers (position absolute, 1px dimensions, overflow hidden)
3. THE Password_Field SHALL have `aria-describedby` pointing to the Password_Requirements_Element (element ID `password-requirements`)
4. THE Confirm_Password_Field SHALL have `aria-describedby` pointing to the Match_Status_Element (element ID `password-match-status`)
5. WHEN the validation result contains one or more errors for a given field, THE Validator SHALL set `aria-invalid` to `"true"` for that field; WHEN the validation result contains no errors for a given field, THE Validator SHALL set `aria-invalid` to `"false"` for that field
6. THE Registration_Form SHALL maintain a logical tab order: email → password → confirm password → submit button, achieved through source order in the HTML document without positive `tabindex` values

### Requirement 8: Preserve existing form behavior

**User Story:** As a user, I want the email verification and API key display steps to continue working unchanged, so that the full registration flow remains intact.

#### Acceptance Criteria

1. WHEN the signUp call succeeds, THE Registration_Form SHALL transition to the verify-step by adding class `hidden` to the register-step element and removing class `hidden` from the verify-step element
2. THE Registration_Form SHALL pass the Password_Field value (not the Confirm_Password_Field value) to `userPool.signUp()` and to subsequent `authenticateUser()` calls in the verification step
3. THE Registration_Form SHALL preserve the existing `UsernameExistsException` handling that attempts authentication to determine account confirmation status
4. THE Registration_Form SHALL preserve the existing resend verification code logic including the 30-second cooldown timer and 3-attempt maximum
