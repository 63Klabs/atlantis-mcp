# Bugfix Requirements Document

## Introduction

After Cognito registration and email confirmation, all authenticated API requests routed through the Auth Lambda function fail with a 401 "Authentication not configured" error. The Auth Lambda cannot add `COGNITO_USER_POOL_ID` as an environment variable via `!Ref CognitoUserPool` because the Auth Lambda and CognitoUserPool already reference each other through the PostConfirmation trigger, creating a CloudFormation circular dependency. The fix is to retrieve the Cognito User Pool ID from SSM Parameter Store at runtime. An SSM parameter (`CognitoUserPoolIdParameter`) already stores this value at `{PARAM_STORE_PATH}app-stack/Mcp_CognitoUserPoolId`, and the Auth Lambda already has `PARAM_STORE_PATH` in its environment. The `jwt-validator.js`, `key-regenerate.js`, and `voucher-redeem.js` modules need to be updated to retrieve the User Pool ID from SSM instead of relying on `process.env.COGNITO_USER_POOL_ID`.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an authenticated user sends a POST request to `/auth/key/regenerate` with a valid Cognito JWT THEN the Auth Lambda returns a 401 error with the message "Authentication not configured" because `process.env.COGNITO_USER_POOL_ID` is undefined and no SSM fallback exists

1.2 WHEN an authenticated user sends a POST request to `/auth/voucher/redeem` with a valid Cognito JWT THEN the Auth Lambda returns a 401 error with the message "Authentication not configured" because `process.env.COGNITO_USER_POOL_ID` is undefined and no SSM fallback exists

1.3 WHEN any handler in the Auth Lambda calls `validateJwt(event)` at runtime THEN the function throws `{ statusCode: 401, message: 'Authentication not configured' }` before reaching the JWKS fetch because the User Pool ID is not available via environment variable or SSM

1.4 WHEN `key-regenerate.js` and `voucher-redeem.js` read `process.env.COGNITO_USER_POOL_ID` for the `AdminUpdateUserAttributesCommand` THEN the value is `undefined`, causing the Cognito API call to fail

### Expected Behavior (Correct)

2.1 WHEN an authenticated user sends a POST request to `/auth/key/regenerate` with a valid Cognito JWT THEN the Auth Lambda SHALL retrieve the Cognito User Pool ID from SSM Parameter Store, validate the JWT against the Cognito JWKS endpoint, and proceed with key regeneration, returning a 200 response with the new API key

2.2 WHEN an authenticated user sends a POST request to `/auth/voucher/redeem` with a valid Cognito JWT THEN the Auth Lambda SHALL retrieve the Cognito User Pool ID from SSM Parameter Store, validate the JWT against the Cognito JWKS endpoint, and proceed with voucher redemption, returning a 200 response with the updated tier

2.3 WHEN `validateJwt(event)` is called in the Auth Lambda at runtime THEN the function SHALL retrieve the Cognito User Pool ID from SSM Parameter Store (at `{PARAM_STORE_PATH}app-stack/Mcp_CognitoUserPoolId`), cache it, construct the JWKS URL, and verify the JWT signature against the fetched keys

2.4 WHEN `key-regenerate.js` needs the User Pool ID for `AdminUpdateUserAttributesCommand` THEN it SHALL retrieve it from SSM Parameter Store using the existing `getCachedSsmParam` function

2.5 WHEN `voucher-redeem.js` needs the User Pool ID for `AdminUpdateUserAttributesCommand` THEN it SHALL retrieve it from SSM Parameter Store using a cached SSM retrieval function

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a Cognito PostConfirmation_ConfirmSignUp trigger fires THEN the Auth Lambda SHALL CONTINUE TO receive the User Pool ID from the Cognito event payload and successfully provision the user record and API key without relying on the environment variable or SSM

3.2 WHEN an unauthenticated request (missing or malformed Authorization header) is sent to `/auth/key/regenerate` or `/auth/voucher/redeem` THEN the Auth Lambda SHALL CONTINUE TO return a 401 error with "Missing or invalid Authorization header"

3.3 WHEN a request with an expired or invalid JWT is sent to any authenticated Auth Lambda endpoint THEN the Auth Lambda SHALL CONTINUE TO return a 401 error with the appropriate message (e.g., "Token expired", "Invalid token signature")

3.4 WHEN the Read Lambda receives authenticated requests THEN it SHALL CONTINUE TO have access to `COGNITO_USER_POOL_ID` in its environment and validate JWTs successfully, with no changes to its configuration or code

3.5 WHEN the Auth Lambda's existing environment variables (`USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`) are used by handlers THEN they SHALL CONTINUE TO resolve correctly with no changes to their values

3.6 WHEN the CloudFormation template is deployed THEN there SHALL be no circular dependency between AuthLambdaFunction and CognitoUserPool — the Auth Lambda SHALL NOT reference CognitoUserPool via `!Ref` in its environment variables
