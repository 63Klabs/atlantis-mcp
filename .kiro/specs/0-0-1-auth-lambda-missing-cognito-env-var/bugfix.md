# Bugfix Requirements Document

## Introduction

After Cognito registration and email confirmation, all authenticated API requests routed through the Auth Lambda function fail with a 401 "Authentication not configured" error. The root cause is a missing `COGNITO_USER_POOL_ID` environment variable in the Auth Lambda's CloudFormation definition (`application-infrastructure/template.yml`). The `jwt-validator.js` utility requires this variable to construct the JWKS endpoint URL for JWT signature verification. Without it, `validateJwt()` throws immediately, blocking every authenticated endpoint on the Auth Lambda (key regeneration, voucher redemption, and any future authenticated routes). The Read Lambda already has this variable configured correctly.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an authenticated user sends a POST request to `/auth/key/regenerate` with a valid Cognito JWT THEN the Auth Lambda returns a 401 error with the message "Authentication not configured" because `process.env.COGNITO_USER_POOL_ID` is undefined

1.2 WHEN an authenticated user sends a POST request to `/auth/voucher/redeem` with a valid Cognito JWT THEN the Auth Lambda returns a 401 error with the message "Authentication not configured" because `process.env.COGNITO_USER_POOL_ID` is undefined

1.3 WHEN any handler in the Auth Lambda calls `validateJwt(event)` at runtime THEN the function throws `{ statusCode: 401, message: 'Authentication not configured' }` before reaching the JWKS fetch because the User Pool ID is not available in the environment

### Expected Behavior (Correct)

2.1 WHEN an authenticated user sends a POST request to `/auth/key/regenerate` with a valid Cognito JWT THEN the Auth Lambda SHALL validate the JWT against the Cognito JWKS endpoint and proceed with key regeneration, returning a 200 response with the new API key

2.2 WHEN an authenticated user sends a POST request to `/auth/voucher/redeem` with a valid Cognito JWT THEN the Auth Lambda SHALL validate the JWT against the Cognito JWKS endpoint and proceed with voucher redemption, returning a 200 response with the updated tier

2.3 WHEN any handler in the Auth Lambda calls `validateJwt(event)` at runtime THEN the function SHALL read `COGNITO_USER_POOL_ID` from the environment, construct the JWKS URL `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`, and verify the JWT signature against the fetched keys

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a Cognito PostConfirmation_ConfirmSignUp trigger fires THEN the Auth Lambda SHALL CONTINUE TO receive the User Pool ID from the Cognito event payload and successfully provision the user record and API key without relying on the environment variable

3.2 WHEN an unauthenticated request (missing or malformed Authorization header) is sent to `/auth/key/regenerate` or `/auth/voucher/redeem` THEN the Auth Lambda SHALL CONTINUE TO return a 401 error with "Missing or invalid Authorization header"

3.3 WHEN a request with an expired or invalid JWT is sent to any authenticated Auth Lambda endpoint THEN the Auth Lambda SHALL CONTINUE TO return a 401 error with the appropriate message (e.g., "Token expired", "Invalid token signature")

3.4 WHEN the Read Lambda receives authenticated requests THEN it SHALL CONTINUE TO have access to `COGNITO_USER_POOL_ID` in its environment and validate JWTs successfully, with no changes to its configuration

3.5 WHEN the Auth Lambda's existing environment variables (`USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`) are used by handlers THEN they SHALL CONTINUE TO resolve correctly with no changes to their values
