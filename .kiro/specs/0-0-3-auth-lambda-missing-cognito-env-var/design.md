# Auth Lambda Missing COGNITO_USER_POOL_ID Bugfix Design

## Overview

The Auth Lambda function cannot obtain the Cognito User Pool ID at runtime. Adding `COGNITO_USER_POOL_ID: !Ref CognitoUserPool` as an environment variable creates a CloudFormation circular dependency because the Auth Lambda and CognitoUserPool already reference each other through the PostConfirmation trigger. The fix is to retrieve the User Pool ID from SSM Parameter Store at runtime. An SSM parameter (`CognitoUserPoolIdParameter`) already stores this value at `{PARAM_STORE_PATH}app-stack/Mcp_CognitoUserPoolId`. The `jwt-validator.js` module needs an SSM fallback when `process.env.COGNITO_USER_POOL_ID` is not set, and `key-regenerate.js` and `voucher-redeem.js` need to retrieve the User Pool ID from SSM instead of `process.env`.

## Glossary

- **Bug_Condition (C)**: The Auth Lambda has no mechanism to obtain the Cognito User Pool ID at runtime — `process.env.COGNITO_USER_POOL_ID` is undefined and no SSM fallback exists in `jwt-validator.js`, `key-regenerate.js`, or `voucher-redeem.js`
- **Circular Dependency**: Adding `!Ref CognitoUserPool` to the Auth Lambda's environment creates a cycle: AuthLambdaFunction → CognitoUserPool (via env var) → AuthLambdaFunction (via PostConfirmation trigger)
- **Property (P)**: The Auth Lambda SHALL retrieve the Cognito User Pool ID from SSM Parameter Store when `process.env.COGNITO_USER_POOL_ID` is not set, enabling `validateJwt()` to construct the JWKS URL and verify tokens
- **Preservation**: The Read Lambda's existing `COGNITO_USER_POOL_ID` environment variable, the Auth Lambda's existing environment variables, the Cognito PostConfirmation trigger, and the CloudFormation template's dependency graph must remain unchanged
- **validateJwt**: The function in `src/lambda/auth/utils/jwt-validator.js` that needs the Cognito User Pool ID to construct the JWKS endpoint URL and verify JWT signatures
- **CognitoUserPoolIdParameter**: The SSM parameter resource in `template.yml` that stores the Cognito User Pool ID at `{PARAM_STORE_PATH}app-stack/Mcp_CognitoUserPoolId`
- **AuthLambdaFunction**: The SAM `AWS::Serverless::Function` resource that handles key regeneration, voucher redemption, and the Cognito PostConfirmation trigger

## Bug Details

### Bug Condition

The bug manifests when any API Gateway request reaches the Auth Lambda's authenticated endpoints (`/auth/key/regenerate` or `/auth/voucher/redeem`). The `validateJwt` function immediately throws `{ statusCode: 401, message: 'Authentication not configured' }` because `process.env.COGNITO_USER_POOL_ID` is `undefined`. The environment variable cannot be added via `!Ref CognitoUserPool` because this creates a circular dependency with the PostConfirmation trigger.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type AuthLambdaRuntime
  OUTPUT: boolean

  LET envPoolId = input.processEnv.COGNITO_USER_POOL_ID
  LET hasSsmFallback = input.jwtValidator.hasSsmRetrieval
  RETURN envPoolId IS UNDEFINED AND hasSsmFallback IS FALSE
END FUNCTION
```

### Why `!Ref CognitoUserPool` Cannot Be Used

The Auth Lambda has a `CognitoPostConfirmation` event that creates a dependency: `CognitoUserPool → AuthLambdaFunction`. Adding `COGNITO_USER_POOL_ID: !Ref CognitoUserPool` to the Auth Lambda's environment creates the reverse dependency: `AuthLambdaFunction → CognitoUserPool`. This forms a cycle that CloudFormation cannot resolve.

The Read Lambda does not have this problem because it has no Cognito trigger event — it only references the pool one way (via the env var).

### Examples

- **Key Regeneration**: User sends `POST /auth/key/regenerate` with valid JWT → Auth Lambda calls `validateJwt(event)` → `process.env.COGNITO_USER_POOL_ID` is `undefined`, no SSM fallback → throws `{ statusCode: 401, message: 'Authentication not configured' }` → user receives 401 instead of a new API key
- **Voucher Redemption**: User sends `POST /auth/voucher/redeem` with valid JWT and voucher code → same failure path → user receives 401 instead of tier upgrade
- **PostConfirmation (not affected)**: Cognito fires PostConfirmation trigger → `post-confirmation.js` reads `event.userPoolId` from the Cognito event payload (not from `process.env`) → works correctly
- **Read Lambda (not affected)**: Read Lambda has `COGNITO_USER_POOL_ID: !Ref CognitoUserPool` in its environment (no circular dependency) → JWT validation works correctly

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The Read Lambda's environment variables must remain exactly as they are, including `COGNITO_USER_POOL_ID: !Ref CognitoUserPool`
- The Auth Lambda's existing environment variables (`USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`) must remain unchanged
- The Auth Lambda's CloudFormation definition must NOT add `!Ref CognitoUserPool` (would create circular dependency)
- The Cognito PostConfirmation trigger configuration on the Auth Lambda must remain unchanged
- Unauthenticated requests must continue to return 401 with "Missing or invalid Authorization header"
- Requests with expired or invalid JWTs must continue to return 401 with the appropriate error message
- API Gateway routing for `/auth/key/regenerate` and `/auth/voucher/redeem` must remain unchanged

**Scope:**
The fix modifies three source files (`jwt-validator.js`, `key-regenerate.js`, `voucher-redeem.js`) to retrieve the Cognito User Pool ID from SSM Parameter Store at runtime. No CloudFormation template changes are required — the SSM parameter already exists.

## Hypothesized Root Cause

1. **No Runtime Access to User Pool ID**: The Auth Lambda cannot use `!Ref CognitoUserPool` as an environment variable due to the circular dependency with the PostConfirmation trigger. The SSM parameter `CognitoUserPoolIdParameter` already stores the value, but no code retrieves it.

2. **Unit Tests Mask the Issue**: All existing unit tests set `process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool'` in their `beforeEach` blocks, so tests pass locally even though the variable is `undefined` at runtime.

## Correctness Properties

Property 1: Bug Condition Fix - Auth Lambda Can Obtain User Pool ID via SSM

_For any_ Auth Lambda invocation where `process.env.COGNITO_USER_POOL_ID` is undefined, `validateJwt()` SHALL retrieve the Cognito User Pool ID from SSM Parameter Store at `{PARAM_STORE_PATH}app-stack/Mcp_CognitoUserPoolId`, cache it, and use it to construct the JWKS URL for JWT verification.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Handlers Use SSM for User Pool ID

_For any_ Auth Lambda API endpoint handler (`key-regenerate.js`, `voucher-redeem.js`) that needs the User Pool ID for Cognito `AdminUpdateUserAttributesCommand`, the handler SHALL retrieve it from SSM Parameter Store rather than `process.env.COGNITO_USER_POOL_ID`.

**Validates: Requirements 2.4, 2.5**

Property 3: Preservation - Template and Existing Behavior Unchanged

_For any_ deployment, the Auth Lambda SHALL NOT have `COGNITO_USER_POOL_ID` in its CloudFormation environment variables (avoiding circular dependency), the Read Lambda SHALL retain its existing `COGNITO_USER_POOL_ID` env var, and all existing Auth Lambda environment variables and event sources SHALL remain unchanged.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

**File 1**: `application-infrastructure/src/lambda/auth/utils/jwt-validator.js`

- Add SSM retrieval with caching for the Cognito User Pool ID
- Modify `validateJwt()` to check `process.env.COGNITO_USER_POOL_ID` first, then fall back to SSM
- The SSM parameter path is `{PARAM_STORE_PATH}app-stack/Mcp_CognitoUserPoolId`
- Cache the SSM value for 5 minutes (matching the pattern in `key-regenerate.js`)

**File 2**: `application-infrastructure/src/lambda/auth/handlers/key-regenerate.js`

- Replace `const userPoolId = process.env.COGNITO_USER_POOL_ID` with SSM retrieval using the existing `getCachedSsmParam` function
- Use `getCachedSsmParam('app-stack/Mcp_CognitoUserPoolId')` to get the User Pool ID

**File 3**: `application-infrastructure/src/lambda/auth/handlers/voucher-redeem.js`

- Replace `const userPoolId = process.env.COGNITO_USER_POOL_ID` with SSM retrieval
- Add SSM client and caching (similar to `key-regenerate.js`) or extract shared SSM utility

**No template.yml changes** — the `CognitoUserPoolIdParameter` SSM resource already exists and stores the correct value.

## Testing Strategy

### Validation Approach

The testing strategy verifies that:
1. `jwt-validator.js` retrieves the User Pool ID from SSM when the env var is not set
2. `key-regenerate.js` and `voucher-redeem.js` retrieve the User Pool ID from SSM
3. The CloudFormation template does NOT have `COGNITO_USER_POOL_ID` in the Auth Lambda's environment (no circular dependency)
4. All existing behavior is preserved

### Property-Based Tests

- Parse the CloudFormation template and verify `AuthLambdaFunction` does NOT have `COGNITO_USER_POOL_ID` in its environment variables (prevents circular dependency)
- Parse the template and verify `ReadLambdaFunction` retains `COGNITO_USER_POOL_ID: !Ref CognitoUserPool`
- Verify Auth Lambda retains existing env vars and event sources

### Unit Tests

- Test `validateJwt()` retrieves User Pool ID from SSM when `process.env.COGNITO_USER_POOL_ID` is undefined
- Test `validateJwt()` still uses `process.env.COGNITO_USER_POOL_ID` when it is set (Read Lambda path)
- Test `key-regenerate.js` handler retrieves User Pool ID from SSM
- Test `voucher-redeem.js` handler retrieves User Pool ID from SSM
- Verify SSM caching works correctly (second call uses cached value)
