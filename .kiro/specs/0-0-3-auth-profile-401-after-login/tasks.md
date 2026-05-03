# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - headerParameters Authorization Header Not Extracted
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate `validateJwt()` fails when Authorization header is in `props.headerParameters` instead of `props.headers`
  - **Scoped PBT Approach**: Scope the property to the concrete failing case — `props` with `headerParameters.authorization` containing a valid Bearer JWT and no `headers` property
  - Test file: `application-infrastructure/src/lambda/auth/tests/property/jwt-header-source.property.test.js`
  - Generate a valid signed JWT using the same RSA key pair pattern from `jwt-validator.test.js` (crypto.generateKeyPairSync, base64url encoding, RS256 signing)
  - Mock `https.get` to return test JWKS (same pattern as existing unit tests)
  - Use fast-check to generate arbitrary email strings and sub strings for JWT payload claims
  - For each generated JWT, construct `props = { headerParameters: { authorization: 'Bearer <jwt>' } }` (matching `clientRequest.getProps()` output structure)
  - Assert that `validateJwt(props, TEST_USER_POOL_ID)` resolves with a payload containing the generated `email` and `sub` (from Bug Condition `isBugCondition` and Expected Behavior in design)
  - Also test PascalCase variant: `props = { headerParameters: { Authorization: 'Bearer <jwt>' } }`
  - Run test on UNFIXED code with `npx jest --no-coverage application-infrastructure/src/lambda/auth/tests/property/jwt-header-source.property.test.js` from `application-infrastructure/src/`
  - **EXPECTED OUTCOME**: Test FAILS with `{ statusCode: 401, message: 'Missing or invalid Authorization header' }` — this confirms the bug exists because `validateJwt()` only checks `props.headers` and ignores `props.headerParameters`
  - Document counterexamples found to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing headers Path and Rejection Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on UNFIXED code first, then write property tests capturing that behavior
  - Test file: `application-infrastructure/src/lambda/auth/tests/property/jwt-header-source.property.test.js` (same file as task 1, separate describe block)
  - **Observation phase** (run on unfixed code to confirm baseline):
    - Observe: `validateJwt({ headers: { Authorization: 'Bearer <valid-jwt>' } }, poolId)` returns decoded payload ✓
    - Observe: `validateJwt({ headers: { authorization: 'Bearer <valid-jwt>' } }, poolId)` returns decoded payload ✓
    - Observe: `validateJwt({ headers: {} }, poolId)` throws `{ statusCode: 401, message: 'Missing or invalid Authorization header' }` ✓
    - Observe: `validateJwt({}, poolId)` throws `{ statusCode: 401 }` ✓
    - Observe: expired JWT via `props.headers` throws `{ statusCode: 401, message: 'Token expired' }` ✓
    - Observe: wrong issuer JWT via `props.headers` throws `{ statusCode: 401, message: 'Invalid token issuer' }` ✓
  - **Property 2a — headers.Authorization path preserved**: Use fast-check to generate arbitrary email/sub strings, create valid JWTs, pass via `{ headers: { Authorization: 'Bearer <jwt>' } }`, assert payload contains correct email and sub (from Preservation Requirements in design)
  - **Property 2b — Missing header detection preserved**: Use fast-check to generate `props` objects with no Authorization header in `headers` (empty object, undefined, missing key), assert `validateJwt()` throws `{ statusCode: 401, message: 'Missing or invalid Authorization header' }` (from Preservation Requirements in design)
  - **Property 2c — JWT validation pipeline preserved**: Use fast-check to generate expired timestamps, assert expired JWTs via `props.headers` throw `{ statusCode: 401, message: 'Token expired' }` (from Preservation Requirements in design)
  - Run tests on UNFIXED code with `npx jest --no-coverage application-infrastructure/src/lambda/auth/tests/property/jwt-header-source.property.test.js`
  - **EXPECTED OUTCOME**: All preservation tests PASS on unfixed code (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for Auth Lambda 401 after login — headerParameters not checked by validateJwt()

  - [x] 3.1 Implement the fix in jwt-validator.js
    - File: `application-infrastructure/src/lambda/auth/utils/jwt-validator.js`
    - Update the Authorization header extraction line in `validateJwt()` to check both `props.headers` and `props.headerParameters`
    - Current code: `const authHeader = props.headers?.Authorization || props.headers?.authorization;`
    - New lookup order (headers takes priority for backward compatibility):
      1. `props.headers?.Authorization`
      2. `props.headers?.authorization`
      3. `props.headerParameters?.Authorization`
      4. `props.headerParameters?.authorization`
    - Update JSDoc for `validateJwt()` `@param props` to document both `props.headers` and `props.headerParameters` as sources for the Authorization header
    - Update JSDoc `@example` to show the auth Lambda path with `headerParameters`
    - No changes to controllers, routes, config, or `@63klabs/cache-data` package
    - _Bug_Condition: isBugCondition(props) where props.headerParameters contains authorization AND props.headers is undefined_
    - _Expected_Behavior: validateJwt() extracts Bearer token from headerParameters when headers is absent, validates JWT, returns decoded payload_
    - _Preservation: All existing props.headers paths, missing header detection, expired/malformed/wrong-issuer rejection, JWKS caching, User Pool ID resolution remain unchanged_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - headerParameters Authorization Header Extracted Successfully
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (valid JWT in headerParameters should resolve with decoded payload)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run: `npx jest --no-coverage application-infrastructure/src/lambda/auth/tests/property/jwt-header-source.property.test.js` from `application-infrastructure/src/`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — validateJwt now reads headerParameters)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing headers Path and Rejection Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run: `npx jest --no-coverage application-infrastructure/src/lambda/auth/tests/property/jwt-header-source.property.test.js` from `application-infrastructure/src/`
    - **EXPECTED OUTCOME**: All preservation tests PASS (confirms no regressions — existing headers path, missing header detection, and JWT validation pipeline unchanged)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.4 Add unit tests for headerParameters path in existing test file
    - File: `application-infrastructure/src/lambda/auth/tests/unit/jwt-validator.test.js`
    - Add a new `describe('with Authorization in headerParameters')` block
    - Test cases:
      - `headerParameters.authorization` (camelCase) with valid JWT returns decoded payload
      - `headerParameters.Authorization` (PascalCase) with valid JWT returns decoded payload
      - Both `headers` and `headerParameters` present — `headers` takes priority
      - `headerParameters` present but empty (no authorization key) — throws 401
      - `headerParameters` with non-Bearer value — throws 401
      - `headerParameters` with expired JWT — throws 401 (Token expired)
      - `headerParameters` with wrong issuer JWT — throws 401 (Invalid token issuer)
    - Use the same RSA key pair, JWKS mock, and `createTestJwt()` helper already in the test file
    - Run: `npx jest --no-coverage application-infrastructure/src/lambda/auth/tests/unit/jwt-validator.test.js` from `application-infrastructure/src/`
    - **EXPECTED OUTCOME**: All new and existing unit tests PASS
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

  - [x] 3.5 Update CHANGELOG.md
    - Add entry under `## [v0.0.3] (unreleased)` in the `### Fixed` category
    - Entry: `- **Auth Lambda: jwt-validator.js** - Fixed 401 Unauthorized on all auth endpoints after login [Spec: 0-0-3-auth-profile-401-after-login](../.kiro/specs/0-0-3-auth-profile-401-after-login/)`
    - Sub-bullet: `- validateJwt() now checks both props.headers and props.headerParameters for the Authorization header, resolving mismatch with clientRequest.getProps() output structure`
    - Do NOT modify any existing changelog text
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 4. Checkpoint — Ensure all tests pass
  - Run full auth Lambda test suite: `npx jest --no-coverage` from `application-infrastructure/src/`
  - Verify all unit tests pass (including new headerParameters tests in jwt-validator.test.js)
  - Verify all property tests pass (including new jwt-header-source.property.test.js)
  - Verify all existing property tests still pass (no regressions in other test files)
  - If any test fails, investigate and fix before marking complete
  - Ask the user if questions arise
