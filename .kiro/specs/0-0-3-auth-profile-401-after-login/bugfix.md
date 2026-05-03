# Bugfix Requirements Document

## Introduction

After logging in, users receive a 401 Unauthorized response when hitting the `GET /mcp/auth/profile` endpoint through the WebApi (API Gateway). The same 401 affects all three authenticated Auth Lambda endpoints (`/mcp/auth/profile`, `/mcp/auth/key/regenerate`, `/mcp/auth/voucher/redeem`).

The root cause is a mismatch between how `clientRequest.getProps()` exposes request headers and how `validateJwt()` reads them. The `@63klabs/cache-data` `ClientRequest` class returns processed request properties via `getProps()` where headers are stored under the `headerParameters` key (not `headers`). All three Auth Lambda controllers pass this `props` object to `validateJwt()`, which looks for `props.headers.Authorization` — a property that does not exist on the `getProps()` return object. As a result, `extractBearerToken()` receives `undefined`, and the validator throws `{ statusCode: 401, message: 'Missing or invalid Authorization header' }` for every authenticated request.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user sends a valid `Authorization: Bearer <JWT>` header to `GET /mcp/auth/profile` THEN the system returns a 401 Unauthorized response with `{ error: 'Unauthorized' }` because `validateJwt()` reads `props.headers.Authorization` which is `undefined` on the `getProps()` return object

1.2 WHEN a user sends a valid `Authorization: Bearer <JWT>` header to `POST /mcp/auth/key/regenerate` THEN the system returns a 401 Unauthorized response because the same `props.headers` mismatch causes `validateJwt()` to fail

1.3 WHEN a user sends a valid `Authorization: Bearer <JWT>` header to `POST /mcp/auth/voucher/redeem` THEN the system returns a 401 Unauthorized response because the same `props.headers` mismatch causes `validateJwt()` to fail

### Expected Behavior (Correct)

2.1 WHEN a user sends a valid `Authorization: Bearer <JWT>` header to `GET /mcp/auth/profile` THEN the system SHALL extract the Bearer token from the request headers, validate the JWT, and return a 200 response with the user's profile data

2.2 WHEN a user sends a valid `Authorization: Bearer <JWT>` header to `POST /mcp/auth/key/regenerate` THEN the system SHALL extract the Bearer token from the request headers, validate the JWT, and return a 200 response with the regenerated API key

2.3 WHEN a user sends a valid `Authorization: Bearer <JWT>` header to `POST /mcp/auth/voucher/redeem` THEN the system SHALL extract the Bearer token from the request headers, validate the JWT, and return a 200 response with the voucher redemption result

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a request is sent without an `Authorization` header to any auth endpoint THEN the system SHALL CONTINUE TO return a 401 Unauthorized response

3.2 WHEN a request is sent with an invalid or expired JWT to any auth endpoint THEN the system SHALL CONTINUE TO return a 401 Unauthorized response

3.3 WHEN a request is sent with a malformed token (not `Bearer <token>` format) to any auth endpoint THEN the system SHALL CONTINUE TO return a 401 Unauthorized response

3.4 WHEN a request is sent to `GET /mcp/auth/profile` with a valid JWT but the user does not exist in the Users table THEN the system SHALL CONTINUE TO return a 404 User not found response

3.5 WHEN a Cognito PostConfirmation trigger event is received THEN the system SHALL CONTINUE TO process it through the post-confirmation handler without JWT validation

3.6 WHEN a request is sent to a non-existent route THEN the system SHALL CONTINUE TO return a 404 Not found response
