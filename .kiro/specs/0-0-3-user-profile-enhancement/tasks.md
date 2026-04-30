# Implementation Plan: User Profile Enhancement

## Overview

Add a `GET /auth/profile` endpoint to the Auth Lambda that returns consolidated profile data (email, tier, tier expiration, rate limit remaining, window reset time) in a single API call. Update the route dispatcher and index handler to support GET requests, extend the DynamoDB client for Sessions Table reads, update CloudFormation for permissions and configuration, and update the profile page to call the new endpoint.

## Tasks

- [x] 1. Add rate limit config and session key utilities
  - [x] 1.1 Create `utils/rate-limit-config.js` with `getRateLimitConfig()` function
    - Read rate limit configuration from environment variables (`MCP_PUBLIC_RATE_LIMIT`, `MCP_PUBLIC_RATE_TIME_RANGE_MINUTES`, etc.)
    - Return `{ public: { limitPerWindow, windowInMinutes }, registered: {...}, paid: {...}, private: {...} }` matching the Read Lambda's `settings.js` structure
    - Validate that config exists for all tiers; throw if missing
    - Include `TestHarness` class exposing internals for testing
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 1.2 Create `utils/window-calculator.js` with window computation functions
    - Implement `computeWindowBoundaries(windowInMinutes)` — compute `windowStartMinutes` and `resetTimeMinutes` using interval-aligned logic from midnight UTC (same algorithm as Read Lambda's rate limiter)
    - Implement `computeSessionKey(cognitoSub, windowStartMinutes, salt)` — SHA-256 hash of `cognitoSub + windowStartMinutes + salt`
    - Include `TestHarness` class exposing internals for testing
    - _Requirements: 4.2, 4.3_

  - [x] 1.3 Write property test for effective tier expiration (Property 1)
    - **Property 1: Effective tier expiration**
    - Create `tests/property/effective-tier.property.test.js`
    - For any user record with tier in `{registered, paid, private}` and a `tierExpiresAt` timestamp: if past → returns `'registered'`; if future or null → returns stored tier unchanged
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 3.2**

  - [x] 1.4 Write property test for session key hash consistency (Property 2)
    - **Property 2: Session key hash consistency**
    - Create `tests/property/session-key-consistency.property.test.js`
    - For any `cognitoSub` string, `windowStartMinutes` integer, and `salt` string, `computeSessionKey` produces the same SHA-256 hex digest as the Read Lambda's `hashClientIdentifier`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 4.2**

  - [x] 1.5 Write property test for window reset time computation (Property 3)
    - **Property 3: Window reset time computation**
    - Create `tests/property/window-reset.property.test.js`
    - For any `windowInMinutes` in `{60, 1440}` and any `windowStartMinutes` integer, the computed `windowResetAt` equals `(windowStartMinutes + windowInMinutes) * 60`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 4.3**

- [x] 2. Extend DynamoDB client and implement profile handler
  - [x] 2.1 Add `getSessionRecord(tableName, pk)` to `utils/dynamo-client.js`
    - Add a new function that performs a `GetItem` on the Sessions Table using a separate table name parameter (from `SESSIONS_TABLE` env var)
    - Returns the session record or `null` if not found
    - Export the new function alongside existing exports
    - _Requirements: 4.1, 6.1, 6.3_

  - [x] 2.2 Create `handlers/profile.js` with the profile handler
    - Validate JWT using `validateJwt(event)`, extract `sub` and `email`
    - Query Users Table by email using `queryByEmail(email)`
    - Compute effective tier using `computeEffectiveTier(tier, tierExpiresAt)` — if `tierExpiresAt` is set and in the past, return `'registered'`; otherwise return stored tier
    - Get rate limit config for the effective tier via `getRateLimitConfig()`
    - Retrieve `Mcp_SessionHashSalt` from SSM using the cached SSM pattern (same as `key-regenerate.js` and `voucher-redeem.js`)
    - Compute session partition key using `computeSessionKey` and `computeWindowBoundaries`
    - Query Sessions Table using `getSessionRecord`
    - If no session record exists, return full tier limit as remaining
    - Assemble and return the JSON response with all required fields: `email`, `tier`, `tierExpiresAt`, `createdAt`, `rateLimits.limit`, `rateLimits.remaining`, `rateLimits.windowResetAt`, `rateLimits.windowMinutes`
    - Return 401 for invalid JWT, 404 for user not found, 500 for internal errors
    - Log errors with `console.error` but return sanitized error messages
    - Include `TestHarness` class exposing `computeEffectiveTier`, `getRateLimitConfig` (if local), `getCachedSsmParam`, and `ssmCache`
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3_

  - [x] 2.3 Write property test for profile response completeness (Property 4)
    - **Property 4: Profile response completeness**
    - Create `tests/property/profile-response.property.test.js`
    - For any valid user record (with email, tier, tierExpiresAt, createdAt) and any rate limit session state (existing record or no record), the profile response contains all required fields: `email` (string), `tier` (string), `tierExpiresAt` (string or null), `createdAt` (string), `rateLimits.limit` (number), `rateLimits.remaining` (number), `rateLimits.windowResetAt` (number), `rateLimits.windowMinutes` (number)
    - Mock DynamoDB, SSM, and JWT validation; test the response assembly logic
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 5.1**

  - [x] 2.4 Write unit tests for profile handler
    - Create `tests/unit/profile.test.js`
    - Test happy path: valid JWT → user found → session found → 200 with complete response
    - Test 401: missing/invalid JWT returns `{"error": "Unauthorized"}`
    - Test 404: no user record returns `{"error": "User not found"}`
    - Test 500: DynamoDB/SSM errors return `{"error": "Internal server error"}`
    - Test no session record: returns full tier limit as remaining
    - Test effective tier computation: expired `tierExpiresAt` returns `registered`
    - Test rate limit config validation: missing config returns 500
    - Mock `validateJwt`, `queryByEmail`, `getSessionRecord`, SSM client
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 4.1, 4.3, 4.4, 5.1, 5.3, 7.3_

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update route dispatcher and index handler for GET support
  - [x] 4.1 Update `routes/index.js` to support GET routes
    - Add `GET_ROUTES` map with `/auth/profile` pointing to `profileHandler.handler`
    - Update the `route()` function to check `GET_ROUTES` when `method === 'GET'`
    - Update `TestHarness.getInternals()` to expose `GET_ROUTES`
    - _Requirements: 1.3_

  - [x] 4.2 Update `index.js` CORS headers to include GET method
    - Change `Access-Control-Allow-Methods` from `'POST, OPTIONS'` to `'GET, POST, OPTIONS'`
    - No other changes needed — `withCorsHeaders` already wraps all API Gateway responses
    - _Requirements: 1.2, 11.1, 11.2, 11.3_

  - [x] 4.3 Write unit tests for route dispatcher GET support
    - Create or extend `tests/unit/route-dispatcher.test.js`
    - Test `GET /auth/profile` routes to profile handler
    - Test `GET /auth/unknown` returns 404
    - Test `POST /auth/profile` returns 404 (not a POST route)
    - _Requirements: 1.3_

  - [x] 4.4 Write unit tests for CORS headers
    - Create or extend `tests/unit/cors-headers.test.js`
    - Test `Access-Control-Allow-Methods` includes `GET`
    - Test CORS headers are applied to GET responses
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 5. Update CloudFormation template
  - [x] 5.1 Add `GET /auth/profile` API Gateway event to `AuthLambdaFunction`
    - Add a new `Api` event with `Path: /auth/profile` and `Method: get` on the same `WebApi` as existing POST endpoints
    - _Requirements: 1.1_

  - [x] 5.2 Add environment variables to `AuthLambdaFunction`
    - Add `SESSIONS_TABLE` referencing the Sessions Table resource
    - Add rate limit environment variables: `MCP_PUBLIC_RATE_LIMIT`, `MCP_PUBLIC_RATE_TIME_RANGE_MINUTES`, `MCP_REGISTERED_RATE_LIMIT`, `MCP_REGISTERED_RATE_TIME_RANGE_MINUTES`, `MCP_PAID_RATE_LIMIT`, `MCP_PAID_RATE_TIME_RANGE_MINUTES`, `MCP_PRIVATE_RATE_LIMIT`, `MCP_PRIVATE_RATE_TIME_RANGE_MINUTES`
    - _Requirements: 6.3, 7.1, 7.2_

  - [x] 5.3 Add IAM permissions for Sessions Table read access
    - Add `dynamodb:GetItem` permission on `DynamoDbSessions.Arn` to `AuthLambdaExecutionRole`
    - Ensure `ssm:GetParameter` covers `Mcp_SessionHashSalt` (verify existing SSM wildcard)
    - Do NOT add write permissions on Sessions Table
    - _Requirements: 6.1, 6.2, 6.4_

  - [x] 5.4 Update `template-openapi-spec.yml` with the new GET endpoint
    - Add `GET /auth/profile` path with request/response schemas
    - Include Authorization header parameter
    - Document 200, 401, 404, and 500 response codes
    - _Requirements: 1.1_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update profile page to call the new endpoint
  - [x] 7.1 Update profile page HTML to call `GET /auth/profile`
    - Replace current Cognito-attribute-based data loading with a single `GET /auth/profile` request using the Cognito JWT in the `Authorization: Bearer <jwt>` header
    - Add a loading indicator while the request is in progress
    - On 401 response, redirect to `/login/`
    - On other errors, display an error message and fall back to Cognito JWT claims where available
    - _Requirements: 10.1, 10.3, 10.4, 10.5_

  - [x] 7.2 Add UI elements for new profile data
    - Display email in a prominent position at the top of the profile section (read-only text)
    - Display remaining requests with total (e.g., "42 of 100 remaining")
    - Display window reset time formatted as human-readable local date/time
    - Populate all fields from the single Profile Endpoint response
    - _Requirements: 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 10.2_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples, edge cases, and integration wiring
- All tests use Jest with `fast-check` for property-based tests, following the existing auth lambda test patterns
- Test files follow existing naming: `tests/property/*.property.test.js` and `tests/unit/*.test.js`
- The profile handler reuses existing patterns from `key-regenerate.js` and `voucher-redeem.js` (SSM caching, JWT validation, error handling)
