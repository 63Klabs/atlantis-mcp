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

- [x] 3. Fix Auth Lambda missing COGNITO_USER_POOL_ID environment variable

  - [x] 3.1 Implement the fix
    - Add `COGNITO_USER_POOL_ID: !Ref CognitoUserPool` to `AuthLambdaFunction.Properties.Environment.Variables` in `application-infrastructure/template.yml`
    - Place it after the existing `DEPLOY_ENVIRONMENT` variable, matching the pattern used by the Read Lambda
    - This is a single-line addition — no other files or resources are modified
    - _Bug_Condition: isBugCondition(template) where 'COGNITO_USER_POOL_ID' NOT IN AuthLambdaFunction.Properties.Environment.Variables_
    - _Expected_Behavior: AuthLambdaFunction.Properties.Environment.Variables contains COGNITO_USER_POOL_ID referencing CognitoUserPool_
    - _Preservation: Auth Lambda retains USERS_TABLE, PARAM_STORE_PATH, DEPLOY_ENVIRONMENT; Read Lambda retains COGNITO_USER_POOL_ID; Auth Lambda retains CognitoPostConfirmation, KeyRegenerate, VoucherRedeem events_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Auth Lambda Has COGNITO_USER_POOL_ID
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior (Auth Lambda has COGNITO_USER_POOL_ID referencing CognitoUserPool)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Environment Variables and Resources Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation tests still pass after fix (no regressions to existing env vars, Read Lambda config, or Auth Lambda event sources)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full property test suite for the auth lambda: `npx jest --config application-infrastructure/src/jest.config.js -- application-infrastructure/src/lambda/auth/tests/property/cognito-env-var.property.test.js`
  - Run existing auth lambda unit tests to confirm no regressions: `npx jest --config application-infrastructure/src/jest.config.js -- application-infrastructure/src/lambda/auth/tests/unit/`
  - Ensure all tests pass, ask the user if questions arise.
