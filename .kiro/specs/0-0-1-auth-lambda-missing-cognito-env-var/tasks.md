# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Auth Lambda Missing COGNITO_USER_POOL_ID
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists in the CloudFormation template
  - **Scoped PBT Approach**: Parse `application-infrastructure/template.yml` as YAML using `js-yaml` and scope the property to the `AuthLambdaFunction` resource
  - Create test file at `application-infrastructure/src/lambda/auth/tests/property/cognito-env-var.property.test.js`
  - Install `js-yaml` as a devDependency in `application-infrastructure/src/lambda/auth/` for YAML parsing
  - Use `fast-check` with `fc.constant()` to load and parse the template once per property assertion
  - Test that `AuthLambdaFunction.Properties.Environment.Variables` contains `COGNITO_USER_POOL_ID`
  - Test that the value of `COGNITO_USER_POOL_ID` references `CognitoUserPool` (the YAML-parsed `!Ref` intrinsic)
  - Verify the Read Lambda already has `COGNITO_USER_POOL_ID` configured (confirms the asymmetry)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists: `AuthLambdaFunction` env vars do not contain `COGNITO_USER_POOL_ID`)
  - Document counterexamples found (e.g., "AuthLambdaFunction.Properties.Environment.Variables has USERS_TABLE, PARAM_STORE_PATH, DEPLOY_ENVIRONMENT but NOT COGNITO_USER_POOL_ID")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Environment Variables and Resources Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Add preservation properties to the same test file `application-infrastructure/src/lambda/auth/tests/property/cognito-env-var.property.test.js`
  - Observe on UNFIXED code: Auth Lambda has `USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT` in its environment variables
  - Observe on UNFIXED code: Read Lambda has `COGNITO_USER_POOL_ID` referencing `CognitoUserPool`
  - Observe on UNFIXED code: Auth Lambda has `CognitoPostConfirmation`, `KeyRegenerate`, and `VoucherRedeem` events configured
  - Write property-based test: for the parsed template, assert Auth Lambda retains all three existing env vars (`USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`)
  - Write property-based test: for the parsed template, assert Read Lambda retains `COGNITO_USER_POOL_ID` referencing `CognitoUserPool`
  - Write property-based test: for the parsed template, assert Auth Lambda retains all three event sources (`CognitoPostConfirmation`, `KeyRegenerate`, `VoucherRedeem`)
  - Verify tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Update property tests for SSM-based approach
  - **REVISED APPROACH**: The original env var approach (`!Ref CognitoUserPool`) creates a circular dependency. The fix uses SSM Parameter Store instead.
  - Update `application-infrastructure/src/lambda/auth/tests/property/cognito-env-var.property.test.js`
  - Replace Property 1 bug condition tests: instead of checking for `COGNITO_USER_POOL_ID` in Auth Lambda env vars, verify that Auth Lambda does NOT have `COGNITO_USER_POOL_ID` in its env vars (this prevents the circular dependency)
  - Add new property test: verify `CognitoUserPoolIdParameter` SSM resource exists in the template and stores `!Ref CognitoUserPool`
  - Add new property test: verify Auth Lambda has `PARAM_STORE_PATH` env var (needed for SSM retrieval at runtime)
  - Keep existing preservation tests unchanged (Auth Lambda env vars, Read Lambda env vars, Auth Lambda events)
  - Run all property tests and verify they pass
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Implement SSM-based User Pool ID retrieval in jwt-validator.js
  - Modify `application-infrastructure/src/lambda/auth/utils/jwt-validator.js`
  - Add SSM client import (`@aws-sdk/client-ssm` — already a devDependency)
  - Add module-level SSM cache for the User Pool ID (5-minute TTL, matching `key-regenerate.js` pattern)
  - Modify `validateJwt()`: check `process.env.COGNITO_USER_POOL_ID` first; if undefined, retrieve from SSM at `{PARAM_STORE_PATH}app-stack/Mcp_CognitoUserPoolId`
  - Make `validateJwt()` remain async (it already is)
  - Export the SSM retrieval function via TestHarness for testing
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 5. Update key-regenerate.js to use SSM for User Pool ID
  - Modify `application-infrastructure/src/lambda/auth/handlers/key-regenerate.js`
  - Replace `const userPoolId = process.env.COGNITO_USER_POOL_ID` with `const userPoolId = await getCachedSsmParam('app-stack/Mcp_CognitoUserPoolId')`
  - The `getCachedSsmParam` function already exists in this file and handles caching
  - _Requirements: 2.4_

- [x] 6. Update voucher-redeem.js to use SSM for User Pool ID
  - Modify `application-infrastructure/src/lambda/auth/handlers/voucher-redeem.js`
  - Add SSM client import and `getCachedSsmParam` function (same pattern as `key-regenerate.js`)
  - Replace `const userPoolId = process.env.COGNITO_USER_POOL_ID` with `const userPoolId = await getCachedSsmParam('app-stack/Mcp_CognitoUserPoolId')`
  - _Requirements: 2.5_

- [x] 7. Update unit tests for the SSM-based approach
  - Update `application-infrastructure/src/lambda/auth/tests/unit/jwt-validator.test.js` to test SSM fallback behavior
  - Update `application-infrastructure/src/lambda/auth/tests/unit/key-regenerate.test.js` to mock SSM for User Pool ID retrieval
  - Update `application-infrastructure/src/lambda/auth/tests/unit/voucher-redeem.test.js` to mock SSM for User Pool ID retrieval
  - Ensure tests cover: SSM retrieval when env var is undefined, env var takes precedence when set, SSM caching works
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 8. Checkpoint - Ensure all tests pass
  - Run the full property test suite: `npx jest --config application-infrastructure/src/jest.config.js -- application-infrastructure/src/lambda/auth/tests/property/cognito-env-var.property.test.js`
  - Run all auth lambda unit tests: `npx jest --config application-infrastructure/src/jest.config.js -- application-infrastructure/src/lambda/auth/tests/unit/`
  - Run all auth lambda property tests: `npx jest --config application-infrastructure/src/jest.config.js -- application-infrastructure/src/lambda/auth/tests/property/`
  - Ensure all tests pass, ask the user if questions arise.
