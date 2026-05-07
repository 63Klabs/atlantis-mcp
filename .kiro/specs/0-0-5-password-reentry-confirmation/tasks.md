# Implementation Plan: Password Re-entry Confirmation Module

## Overview

Implement a standalone, zero-dependency JavaScript validation module at `application-infrastructure/src/lambda/auth/utils/password-validator.js` that provides pure functions for password match validation, Cognito policy validation, real-time form validation, ARIA accessibility attributes, submission gating, and focus management. All functions are pure, stateless, and CommonJS-exported. Tests use Jest + fast-check following existing patterns in `lambda/auth/tests/`.

## Tasks

- [x] 1. Implement core validation functions
  - [x] 1.1 Create password-validator.js with constants, validateMatch, and validatePolicy
    - Create file at `application-infrastructure/src/lambda/auth/utils/password-validator.js`
    - Define `FIELD_IDS` and `POLICY_RULES` constants
    - Implement `validateMatch(password, confirmPassword)` with exact case-sensitive comparison
    - Implement `validatePolicy(password)` checking all Cognito policy rules (min/max length, uppercase, lowercase, number, symbol)
    - Export constants and functions via `module.exports`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 1.2 Implement validateForm for real-time validation feedback
    - Implement `validateForm(password, confirmPassword)` combining policy and match validation
    - Return structured `{isValid, errors, fieldErrors}` result object
    - Suppress mismatch error when confirmPassword is empty string
    - Return valid state when both fields are empty strings
    - Cap errors array at 10 entries
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 1.3 Implement isReadyForSubmission and getFirstErrorField
    - Implement `isReadyForSubmission(password, confirmPassword)` as single boolean gate
    - Implement `getFirstErrorField(validationResult)` returning first error field ID or null
    - Password field errors take priority over confirm-password errors
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 2. Implement accessibility functions and TestHarness
  - [x] 2.1 Implement getAriaAttributes and getAriaLiveRegion
    - Implement `getAriaAttributes(validationResult, fieldName)` returning `{ariaDescribedby, ariaRequired, ariaInvalid}`
    - Implement `getAriaLiveRegion(validationResult)` returning `{ariaLive, content}`
    - Handle null/undefined/non-object input with safe defaults
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 2.2 Add TestHarness class and finalize module exports
    - Add `TestHarness` class with `static getInternals()` exposing `ERROR_MESSAGES` and any internal helpers
    - Finalize `module.exports` with all 6 functions, `FIELD_IDS`, `POLICY_RULES`, and `TestHarness`
    - Add JSDoc documentation to all exported functions following project standards
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 3. Checkpoint - Core implementation verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Unit tests for password-validator
  - [x] 4.1 Write unit tests for validateMatch and validatePolicy
    - Create `application-infrastructure/src/lambda/auth/tests/unit/password-validator.test.js`
    - Test identical passwords return valid
    - Test differing passwords return mismatch error
    - Test null/undefined/empty inputs return appropriate errors
    - Test case-sensitivity (no trimming or normalization)
    - Test each policy rule individually (min length, max length, uppercase, lowercase, number, symbol)
    - Test password satisfying all rules returns empty violations
    - Test empty/null/undefined password returns REQUIRED violation
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 4.2 Write unit tests for validateForm, isReadyForSubmission, and getFirstErrorField
    - Test real-time validation with empty confirm field (no mismatch)
    - Test real-time validation with non-empty mismatched confirm field
    - Test both fields empty returns valid
    - Test result structure (isValid, errors, fieldErrors)
    - Test isReadyForSubmission returns true only when all rules pass and passwords match
    - Test isReadyForSubmission returns false for policy failures, mismatches, empty/null values
    - Test getFirstErrorField returns password field ID when password has errors
    - Test getFirstErrorField returns confirm field ID when only confirm has errors
    - Test getFirstErrorField returns null when no errors
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 4.3 Write unit tests for getAriaAttributes and getAriaLiveRegion
    - Test ariaRequired is always "true"
    - Test ariaInvalid is "true" when field has errors, "false" otherwise
    - Test ariaDescribedby references correct element IDs per field
    - Test getAriaLiveRegion returns "polite" and concatenated error text
    - Test defensive behavior with null/undefined/non-object input
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 5. Property-based tests for password-validator
  - [x] 5.1 Write property test for Property 1: Exact match comparison
    - Create `application-infrastructure/src/lambda/auth/tests/property/password-match.property.test.js`
    - **Property 1: Exact match comparison**
    - For any two strings a and b, validateMatch(a, b).isValid is true iff a === b
    - When a !== b, error is 'PASSWORDS_DO_NOT_MATCH'
    - **Validates: Requirements 1.1, 1.2, 1.3**

  - [x] 5.2 Write property test for Property 2: Policy violation correspondence
    - Create `application-infrastructure/src/lambda/auth/tests/property/password-policy.property.test.js`
    - **Property 2: Policy violation correspondence**
    - For any non-empty password, violations contain exactly one entry per failed rule
    - MIN_LENGTH ∈ violations ⟺ password.length < 8, etc.
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.9**

  - [x] 5.3 Write property test for Property 3: Real-time mismatch suppression
    - Add to `password-policy.property.test.js` or create separate file
    - **Property 3: Real-time mismatch suppression for empty confirm**
    - For any password, validateForm(password, '') does not contain mismatch error for confirm field
    - **Validates: Requirements 3.2**

  - [x] 5.4 Write property test for Property 4: Real-time mismatch detection
    - **Property 4: Real-time mismatch detection for non-empty confirm**
    - For any two non-empty strings where password !== confirmPassword, fieldErrors['confirm-password'] contains mismatch
    - **Validates: Requirements 3.3**

  - [x] 5.5 Write property test for Property 5: Result structure invariant
    - **Property 5: Result structure invariant**
    - For any inputs, validateForm returns isValid === (errors.length === 0), errors.length <= 10, fieldErrors is plain object
    - **Validates: Requirements 3.4**

  - [x] 5.6 Write property test for Property 6: ARIA attributes completeness
    - Create `application-infrastructure/src/lambda/auth/tests/property/password-aria.property.test.js`
    - **Property 6: ARIA attributes completeness and correctness**
    - For any validation result and field name, ariaRequired is "true", ariaDescribedby is non-empty, ariaInvalid is "true" iff field has errors
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [x] 5.7 Write property test for Property 7: Live region content accuracy
    - **Property 7: Live region content accuracy**
    - For any validation result, content contains all failing rule texts concatenated, empty when no failures
    - **Validates: Requirements 4.5**

  - [x] 5.8 Write property test for Property 8: Submission gate correctness
    - Create `application-infrastructure/src/lambda/auth/tests/property/password-submission.property.test.js`
    - **Property 8: Submission gate correctness**
    - isReadyForSubmission returns true iff validatePolicy returns empty AND password === confirmPassword AND neither is null/undefined/empty
    - **Validates: Requirements 5.2, 5.3, 5.4**

  - [x] 5.9 Write property test for Property 9: Focus management priority
    - **Property 9: Focus management priority**
    - getFirstErrorField returns password field ID if password has errors, else confirm field ID if confirm has errors, else null
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

  - [x] 5.10 Write property test for Property 10: Determinism and statelessness
    - **Property 10: Determinism and statelessness**
    - For any inputs, calling any function with same args always produces same result regardless of prior calls
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

- [x] 6. Checkpoint - All tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Integration documentation and changelog
  - [x] 7.1 Create README for password-validator module
    - Create `application-infrastructure/src/lambda/auth/utils/PASSWORD-VALIDATOR-README.md`
    - Document all exported functions with signatures, parameter types, return types
    - Include code example for AWS Amplify Auth.signUp() integration
    - Include code example for AWS SDK CognitoIdentityProviderClient.signUp() integration
    - Document expected HTML structure for WCAG 2.1 AA compliance with element IDs and ARIA relationships
    - Document validation failure return value structure
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 7.2 Update CHANGELOG.md
    - Add entry under current unreleased version for password re-entry confirmation module
    - Document new module location and exported functions
    - Reference spec 0-0-5-password-reentry-confirmation

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Test files follow existing project patterns: `*.test.js` for unit, `*.property.test.js` for property tests
- The module is pure JavaScript with zero dependencies, using CommonJS (`module.exports`)
- Jest config at `application-infrastructure/src/jest.config.js` already matches `**/lambda/auth/tests/**/*.test.js`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 6, "tasks": ["5.6", "5.7", "5.8", "5.9", "5.10"] },
    { "id": 7, "tasks": ["7.1", "7.2"] }
  ]
}
```
