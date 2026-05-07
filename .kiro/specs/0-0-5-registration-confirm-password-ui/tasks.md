# Implementation Plan: Registration Confirm Password UI

## Overview

Add a confirm-password field to the registration form with real-time validation feedback, submission gating, and WCAG 2.1 AA accessibility. The implementation inlines the existing `password-validator.js` module as a browser-compatible IIFE and wires up event handlers for real-time feedback and form submission gating.

## Tasks

- [x] 1. Add CSS utility classes for validation feedback
  - [x] 1.1 Add `.visually-hidden`, `.field-error`, and `.field-success` classes to `index.css`
    - Append `.visually-hidden` class (position absolute, 1px dimensions, overflow hidden) for ARIA live region
    - Append `.field-error` class for validation error message styling
    - Append `.field-success` class for "Passwords match" success message styling
    - _Requirements: 7.2_

- [x] 2. Update HTML structure and add confirm-password field
  - [x] 2.1 Rename password field ID and add new DOM elements to `register/index.html`
    - Change password input `id` from `password` to `password-input`
    - Update `autocomplete="new-password"` and `aria-required="true"` on password field
    - Replace `<small id="password-hint">` with `<div id="password-requirements"></div>` for policy feedback
    - Add `aria-describedby="password-requirements"` to password field
    - Add confirm-password label, input (`id="confirm-password-input"`, `type="password"`, `autocomplete="new-password"`, `aria-required="true"`, `aria-describedby="password-match-status"`)
    - Add `<div id="password-match-status"></div>` for match feedback
    - Add `<div id="validation-announcements" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>` for screen reader announcements
    - Ensure source order: email → password-input → confirm-password-input → register-btn (no positive tabindex)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 7.1, 7.2, 7.3, 7.4, 7.6_

- [x] 3. Inline the password-validator as a browser-compatible IIFE
  - [x] 3.1 Add inline IIFE script block exposing `window.PasswordValidator`
    - Place a new `<script>` block after the Cognito CDN script and before the main app script
    - Wrap the validator's pure functions (`validateForm`, `isReadyForSubmission`, `getFirstErrorField`, `getAriaAttributes`, `getAriaLiveRegion`) and their supporting constants/helpers in an IIFE
    - Strip `module.exports`, `require`, and `TestHarness` — keep `FIELD_IDS`, `POLICY_RULES`, `ERROR_MESSAGES`, `validateMatch`, `validatePolicy` private in the closure
    - Attach exactly five functions to `window.PasswordValidator`
    - Ensure no CommonJS, ESM, or Node.js globals remain
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Implement real-time validation event handlers
  - [x] 4.1 Add input event listeners and UI update logic in the main app script
    - Attach `input` event listener to `#password-input`
    - Attach `input` event listener to `#confirm-password-input`
    - On each input event, call `window.PasswordValidator.validateForm(password, confirmPassword)`
    - Update `#password-requirements` text content with policy violation messages from `fieldErrors.password`
    - Update `#password-match-status` text content with match status (suppress when confirm is empty)
    - Update `aria-invalid` on `#password-input` based on `fieldErrors.password`
    - Update `aria-invalid` on `#confirm-password-input` based on `fieldErrors['confirm-password']` and empty-suppression
    - Update `#validation-announcements` content using `getAriaLiveRegion()`
    - Apply `.field-error` or `.field-success` classes to status elements as appropriate
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 5. Implement submission gating with focus management
  - [x] 5.1 Add validation gate to the form submit handler
    - Before calling `userPool.signUp()`, call `isReadyForSubmission(password, confirmPassword)`
    - If `false`: call `validateForm()`, display errors in `#register-error`, call `getFirstErrorField()` and focus the returned element ID
    - If `getFirstErrorField()` returns `null`, do not change focus
    - If `true`: proceed with existing Cognito signUp flow using `#password-input` value
    - Update all existing references from `document.getElementById('password')` to `document.getElementById('password-input')`
    - Ensure the verify step's `authenticateUser` call uses `#password-input` value
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.2, 8.3, 8.4_

- [x] 6. Checkpoint - Ensure manual verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Write unit tests for HTML structure and IIFE namespace
  - [x] 7.1 Create unit test file `registration-form.jest.mjs`
    - Create `application-infrastructure/src/test/static/register/registration-form.jest.mjs`
    - Test element IDs exist: `password-input`, `confirm-password-input`, `password-requirements`, `password-match-status`, `validation-announcements`
    - Test ARIA attributes: `aria-live="polite"`, `aria-atomic="true"` on announcements div
    - Test `aria-describedby` on password and confirm fields
    - Test `aria-required="true"` on both password fields
    - Test tab order via DOM source order (email → password → confirm → submit)
    - Test `window.PasswordValidator` exposes exactly 5 functions
    - Test no CommonJS/ESM artifacts in IIFE
    - Test existing behavior preservation (step transitions, resend logic structure)
    - _Requirements: 1.x, 2.x, 3.x, 7.x, 8.x_

  - [x] 7.2 Write property test: IIFE–CommonJS equivalence (Property 1)
    - **Property 1: IIFE–CommonJS Equivalence**
    - **Validates: Requirements 3.3**
    - Create `application-infrastructure/src/test/static/register/registration-validation.property.jest.mjs`
    - For any pair `(password, confirmPassword)`, all 5 functions on `window.PasswordValidator` produce identical results to the CommonJS module
    - Use fast-check with 100 iterations

  - [x] 7.3 Write property test: Password input updates requirements and live region (Property 2)
    - **Property 2: Password Input Updates Requirements and Live Region**
    - **Validates: Requirements 4.1, 4.5**
    - For any string typed into password field, `password-requirements` text equals joined policy violations and `validation-announcements` equals `getAriaLiveRegion()` content

  - [x] 7.4 Write property test: Confirm input updates match status and live region (Property 3)
    - **Property 3: Confirm Input Updates Match Status and Live Region**
    - **Validates: Requirements 4.2, 4.6**
    - For any pair where confirmPassword is non-empty, `password-match-status` text equals match-status message and `validation-announcements` equals live region content

  - [x] 7.5 Write property test: Password field aria-invalid reflects policy (Property 4)
    - **Property 4: Password Field aria-invalid Reflects Policy Validation**
    - **Validates: Requirements 4.3, 4.4**
    - `aria-invalid` on `#password-input` is `"true"` when policy errors exist, `"false"` otherwise

  - [x] 7.6 Write property test: Confirm field state reflects match validation (Property 5)
    - **Property 5: Confirm Field State Reflects Match Validation**
    - **Validates: Requirements 5.1, 5.3, 5.4**
    - When confirm empty: `aria-invalid="false"` and match status empty; when non-empty mismatch: `aria-invalid="true"` and "Passwords do not match"; when match + valid: `aria-invalid="false"` and "Passwords match"

  - [x] 7.7 Write property test: Password change re-evaluates confirm status (Property 6)
    - **Property 6: Password Change Re-evaluates Confirm Status**
    - **Validates: Requirements 5.5**
    - When password changes and confirm is non-empty, match status and aria-invalid update to reflect new match state

  - [x] 7.8 Write property test: Invalid submission blocked with focus management (Property 7)
    - **Property 7: Invalid Submission Is Blocked With Focus Management**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - For any pair where `isReadyForSubmission` returns false, form submit does not call signUp, errors are displayed, and focus moves to first error field

  - [x] 7.9 Write property test: Valid submission proceeds with password value (Property 8)
    - **Property 8: Valid Submission Proceeds With Password Value**
    - **Validates: Requirements 6.5, 8.2**
    - For any valid matching password pair, signUp is called with `#password-input` value

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples, structure, and edge cases
- The implementation language is JavaScript (browser inline scripts + Jest/jsdom for tests)
- The password-validator.js source file is read-only — the IIFE is a manual transformation inlined into the HTML

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "7.9"] }
  ]
}
```
