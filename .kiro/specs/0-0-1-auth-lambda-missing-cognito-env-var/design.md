# Auth Lambda Missing COGNITO_USER_POOL_ID Bugfix Design

## Overview

The Auth Lambda function is missing the `COGNITO_USER_POOL_ID` environment variable in its CloudFormation definition (`application-infrastructure/template.yml`). This causes every authenticated endpoint (`/auth/key/regenerate`, `/auth/voucher/redeem`) to fail with a 401 "Authentication not configured" error because `jwt-validator.js` checks `process.env.COGNITO_USER_POOL_ID` before attempting JWT verification. The Read Lambda already has this variable configured correctly. The fix is a single-line addition to the Auth Lambda's `Environment.Variables` block in the SAM template — no application code changes are required.

## Glossary

- **Bug_Condition (C)**: The Auth Lambda's CloudFormation definition is missing `COGNITO_USER_POOL_ID` in its `Environment.Variables`, causing `process.env.COGNITO_USER_POOL_ID` to be `undefined` at runtime
- **Property (P)**: The Auth Lambda's environment variables SHALL include `COGNITO_USER_POOL_ID` referencing `CognitoUserPool`, enabling `validateJwt()` to construct the JWKS URL and verify tokens
- **Preservation**: The Read Lambda's existing `COGNITO_USER_POOL_ID` configuration, the Auth Lambda's existing environment variables (`USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`), and the Cognito PostConfirmation trigger must remain unchanged
- **validateJwt**: The function in `src/lambda/auth/utils/jwt-validator.js` that reads `process.env.COGNITO_USER_POOL_ID` to construct the Cognito JWKS endpoint URL and verify JWT signatures
- **AuthLambdaFunction**: The SAM `AWS::Serverless::Function` resource (line ~821 in `template.yml`) that handles key regeneration, voucher redemption, and the Cognito PostConfirmation trigger

## Bug Details

### Bug Condition

The bug manifests when any API Gateway request reaches the Auth Lambda's authenticated endpoints (`/auth/key/regenerate` or `/auth/voucher/redeem`). The `validateJwt` function immediately throws `{ statusCode: 401, message: 'Authentication not configured' }` because `process.env.COGNITO_USER_POOL_ID` is `undefined` — the variable was never added to the Auth Lambda's CloudFormation environment block.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type CloudFormationTemplate
  OUTPUT: boolean

  LET authLambdaEnvVars = input.Resources.AuthLambdaFunction.Properties.Environment.Variables
  RETURN 'COGNITO_USER_POOL_ID' NOT IN authLambdaEnvVars
END FUNCTION
```

### Examples

- **Key Regeneration**: User sends `POST /auth/key/regenerate` with valid JWT → Auth Lambda calls `validateJwt(event)` → `process.env.COGNITO_USER_POOL_ID` is `undefined` → throws `{ statusCode: 401, message: 'Authentication not configured' }` → user receives 401 instead of a new API key
- **Voucher Redemption**: User sends `POST /auth/voucher/redeem` with valid JWT and voucher code → same failure path → user receives 401 instead of tier upgrade
- **PostConfirmation (not affected)**: Cognito fires PostConfirmation trigger → `post-confirmation.js` reads `event.userPoolId` from the Cognito event payload (not from `process.env`) → works correctly regardless of the missing env var
- **Read Lambda (not affected)**: Read Lambda already has `COGNITO_USER_POOL_ID: !Ref CognitoUserPool` at line ~653 in `template.yml` → JWT validation works correctly for read endpoints

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The Read Lambda's environment variables must remain exactly as they are, including `COGNITO_USER_POOL_ID: !Ref CognitoUserPool`
- The Auth Lambda's existing environment variables (`USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`) must remain unchanged
- The Cognito PostConfirmation trigger configuration on the Auth Lambda must remain unchanged
- Unauthenticated requests (missing/malformed Authorization header) must continue to return 401 with "Missing or invalid Authorization header"
- Requests with expired or invalid JWTs must continue to return 401 with the appropriate error message
- Mouse/API Gateway routing for `/auth/key/regenerate` and `/auth/voucher/redeem` must remain unchanged

**Scope:**
The fix adds exactly one line to the Auth Lambda's `Environment.Variables` block. No other resources, parameters, outputs, or code files are modified. All inputs that do NOT involve the Auth Lambda's environment variable configuration should be completely unaffected.

## Hypothesized Root Cause

Based on the bug description and template analysis, the root cause is clear:

1. **Missing Environment Variable in CloudFormation**: The `AuthLambdaFunction` resource in `template.yml` (line ~836-838) defines three environment variables (`USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`) but omits `COGNITO_USER_POOL_ID`. The Read Lambda (line ~653) correctly includes `COGNITO_USER_POOL_ID: !Ref CognitoUserPool`. This was likely an oversight when the Auth Lambda was added — the developer included the env vars needed for DynamoDB and SSM access but missed the one needed for JWT validation.

2. **Unit Tests Mask the Issue**: All existing unit tests for `key-regenerate.js`, `voucher-redeem.js`, and `jwt-validator.js` set `process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool'` in their `beforeEach` blocks. This means the tests pass locally even though the variable would be `undefined` at runtime in the deployed Lambda.

## Correctness Properties

Property 1: Bug Condition - Auth Lambda Has COGNITO_USER_POOL_ID Environment Variable

_For any_ CloudFormation template where the AuthLambdaFunction resource exists, the Auth Lambda's `Environment.Variables` block SHALL include a `COGNITO_USER_POOL_ID` entry that references the `CognitoUserPool` resource, ensuring `validateJwt()` can construct the JWKS URL at runtime.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Existing Environment Variables and Resources Unchanged

_For any_ CloudFormation template after the fix is applied, the Auth Lambda SHALL retain all its original environment variables (`USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`) and the Read Lambda SHALL retain its existing `COGNITO_USER_POOL_ID` configuration, preserving all existing functionality for both Lambda functions.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `application-infrastructure/template.yml`

**Resource**: `AuthLambdaFunction`

**Specific Changes**:
1. **Add COGNITO_USER_POOL_ID to Auth Lambda Environment Variables**: Add `COGNITO_USER_POOL_ID: !Ref CognitoUserPool` to the `AuthLambdaFunction.Properties.Environment.Variables` block, matching the pattern already used by the Read Lambda.

**Before** (lines ~836-838):
```yaml
      Environment:
        Variables:
          USERS_TABLE: !Ref UsersTable
          PARAM_STORE_PATH: !Ref ParameterStoreHierarchy
          DEPLOY_ENVIRONMENT: !Ref DeployEnvironment
```

**After**:
```yaml
      Environment:
        Variables:
          USERS_TABLE: !Ref UsersTable
          PARAM_STORE_PATH: !Ref ParameterStoreHierarchy
          DEPLOY_ENVIRONMENT: !Ref DeployEnvironment
          COGNITO_USER_POOL_ID: !Ref CognitoUserPool
```

No other files require changes. The Lambda source code (`jwt-validator.js`, `key-regenerate.js`, `voucher-redeem.js`) already reads `process.env.COGNITO_USER_POOL_ID` correctly — it just needs the value to be present at runtime.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior. Since this is an infrastructure-only bug (CloudFormation template), the tests parse the YAML template to verify environment variable configuration.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write a property-based test that parses `application-infrastructure/template.yml` as YAML and checks whether `AuthLambdaFunction.Properties.Environment.Variables` contains `COGNITO_USER_POOL_ID`. Run this test on the UNFIXED template to observe the failure.

**Test Cases**:
1. **Missing Env Var Test**: Parse template YAML, check that `AuthLambdaFunction` environment variables do NOT include `COGNITO_USER_POOL_ID` (will fail on unfixed code — confirming the bug)
2. **Read Lambda Reference Test**: Parse template YAML, verify that `ReadLambdaFunction` environment variables DO include `COGNITO_USER_POOL_ID` (will pass — confirming the asymmetry)

**Expected Counterexamples**:
- `AuthLambdaFunction.Properties.Environment.Variables` does not contain `COGNITO_USER_POOL_ID`
- Possible cause: oversight when adding the Auth Lambda resource to the template

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL template WHERE isBugCondition(template) DO
  template_fixed := applyFix(template)
  ASSERT 'COGNITO_USER_POOL_ID' IN template_fixed.Resources.AuthLambdaFunction.Properties.Environment.Variables
  ASSERT template_fixed.Resources.AuthLambdaFunction.Properties.Environment.Variables.COGNITO_USER_POOL_ID == '!Ref CognitoUserPool'
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL template WHERE NOT isBugCondition(template) DO
  ASSERT template.Resources.AuthLambdaFunction.Properties.Environment.Variables.USERS_TABLE IS PRESENT
  ASSERT template.Resources.AuthLambdaFunction.Properties.Environment.Variables.PARAM_STORE_PATH IS PRESENT
  ASSERT template.Resources.AuthLambdaFunction.Properties.Environment.Variables.DEPLOY_ENVIRONMENT IS PRESENT
  ASSERT template.Resources.ReadLambdaFunction.Properties.Environment.Variables.COGNITO_USER_POOL_ID IS PRESENT
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It can generate variations of the template structure to verify robustness
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that existing configuration is unchanged

**Test Plan**: Parse the UNFIXED template to observe existing env vars for both Lambda functions, then write property-based tests that verify these env vars are preserved after the fix.

**Test Cases**:
1. **Auth Lambda Existing Env Vars Preservation**: Verify `USERS_TABLE`, `PARAM_STORE_PATH`, and `DEPLOY_ENVIRONMENT` remain in the Auth Lambda's environment after the fix
2. **Read Lambda Env Vars Preservation**: Verify the Read Lambda's `COGNITO_USER_POOL_ID` and other env vars remain unchanged after the fix
3. **Auth Lambda Event Configuration Preservation**: Verify the CognitoPostConfirmation trigger, KeyRegenerate API event, and VoucherRedeem API event remain configured

### Unit Tests

- Parse template YAML and verify `AuthLambdaFunction` has `COGNITO_USER_POOL_ID` in its environment variables
- Verify the value references `CognitoUserPool` (using `!Ref`)
- Verify existing env vars (`USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`) are still present
- Verify `ReadLambdaFunction` env vars are unchanged

### Property-Based Tests

- Generate random subsets of expected environment variable names and verify all required env vars are present in the template for both Lambda functions
- Parse the template and verify that every Lambda function that imports `jwt-validator.js` (Auth and Read) has `COGNITO_USER_POOL_ID` configured
- Verify that the Auth Lambda's event sources (CognitoPostConfirmation, KeyRegenerate, VoucherRedeem) are preserved across template modifications

### Integration Tests

- Deploy the fixed template to a test environment and verify that `POST /auth/key/regenerate` with a valid JWT returns 200 (not 401)
- Deploy the fixed template and verify that `POST /auth/voucher/redeem` with a valid JWT and voucher code returns 200
- Verify that the Cognito PostConfirmation trigger still fires and provisions users correctly after the fix
