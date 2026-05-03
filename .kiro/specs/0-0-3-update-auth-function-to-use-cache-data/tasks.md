# Implementation Plan: Update Auth Function to Use Cache-Data

## Overview

This plan migrates the auth Lambda function from its ad-hoc routing and response handling to the `@63klabs/cache-data` MVC architecture. The implementation proceeds in phases: infrastructure/config first, then models/DAOs, services, controllers, route dispatcher, handler refactor, JWT validator migration, PostConfirmation updates, cleanup of old files, tests, and finally CHANGELOG. Each task builds on the previous, ensuring no orphaned code.

All code is JavaScript (Node.js). Tests use Jest with fast-check for property-based tests.

## Tasks

- [x] 1. Add cache-data dependency and create config module
  - [x] 1.1 Add `@63klabs/cache-data` as a production dependency in `application-infrastructure/src/lambda/auth/package.json` (^1.3.11 or later, matching the read Lambda)
    - Run `npm install` in the auth Lambda directory to generate the updated `package-lock.json`
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Create `config/settings.js` with environment variable parsing
    - Parse `USERS_TABLE`, `SESSIONS_TABLE`, `PARAM_STORE_PATH` from `process.env`
    - Define `CachedSsmParameter` instances for `Mcp_CognitoUserPoolId` (via `app-stack/` path), `Mcp_ApiKeyHashSalt`, and `Mcp_SessionHashSalt`
    - Move rate limit configuration from `utils/rate-limit-config.js` into `settings.rateLimits` (public, registered, paid, private tiers with `limitPerWindow` and `windowInMinutes`)
    - Export the settings object
    - _Requirements: 2.4, 10.1, 10.2_

  - [x] 1.3 Create `config/validations.js` with ClientRequest parameter validation rules
    - Define `ALLOWED_REFERRERS` as `['*']`
    - Set `EXCLUDE_PARAMS_WITH_NO_VALIDATION_MATCH` to `false`
    - Export referrers and parameters object (pathParameters, queryStringParameters, bodyParameters)
    - _Requirements: 2.5_

  - [x] 1.4 Create `config/connections.js` with DynamoDB table connection definitions
    - Define connections for `dynamodb-users` (using `USERS_TABLE`) and `dynamodb-sessions` (using `SESSIONS_TABLE`)
    - Each connection has empty cache arrays since auth Lambda doesn't use `CacheableDataAccess`
    - _Requirements: 2.6_

  - [x] 1.5 Create `config/responses.js` with response format settings
    - Set `errorExpirationInSeconds: 0` and `routeExpirationInSeconds: 0` (auth responses should not be cached)
    - Set `externalRequestHeadroomInMs: 8000`
    - _Requirements: 2.7_

  - [x] 1.6 Create `config/index.js` with Config class extending AppConfig
    - Implement `static init()` that calls `AppConfig.init({ settings, validations, connections, responses, debug: true })` — NO `Cache.init()`
    - Implement `static async prime()` that calls `CachedParameterSecrets.prime()`
    - Use `Timer` to measure init duration
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.7 Write unit test `tests/unit/config.test.js`
    - Verify `Config.init()` calls `AppConfig.init()` with correct arguments
    - Verify `Config.prime()` calls `CachedParameterSecrets.prime()`
    - Verify `Cache.init()` is NOT called
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.8 Write property test for settings environment variable round-trip
    - **Property 1: Settings environment variable round-trip**
    - **Validates: Requirements 2.4**
    - Create `tests/property/settings-parsing.property.test.js`
    - For any set of valid rate limit values, table names, and PARAM_STORE_PATH values, verify the settings object contains the exact same values

- [x] 2. Checkpoint - Ensure config module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement DynamoDB Model/DAO layer
  - [x] 3.1 Create `models/user.js` with User DAO
    - Extract user-related functions from `utils/dynamo-client.js`: `getUserByKeyHash`, `putUserRecord`, `deleteUserRecord`, `queryByEmail`, `updateUserTier`, `getSessionRecord`
    - Use table names from `Config.settings()` instead of direct `process.env` access
    - Use `DebugAndLog` for error logging instead of `console.error`
    - Include `TestHarness` class for testing private internals
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

  - [x] 3.2 Create `models/voucher.js` with Voucher DAO
    - Extract voucher-related functions from `utils/dynamo-client.js`: `getVoucher`, `incrementVoucherUses`
    - Use table names from `Config.settings()` instead of direct `process.env` access
    - Use `DebugAndLog` for error logging instead of `console.error`
    - Include `TestHarness` class
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

  - [x] 3.3 Write unit tests for User DAO (`tests/unit/user-dao.test.js`)
    - Test each DynamoDB operation with mocked DocumentClient
    - Verify table names come from `Config.settings()`
    - _Requirements: 8.2_

  - [x] 3.4 Write unit tests for Voucher DAO (`tests/unit/voucher-dao.test.js`)
    - Test `getVoucher` and `incrementVoucherUses` with mocked DocumentClient
    - _Requirements: 8.3_

  - [x] 3.5 Write property test for User DAO put/get round-trip
    - **Property 3: User DAO put/get round-trip**
    - **Validates: Requirements 8.2**
    - Create `tests/property/user-dao-roundtrip.property.test.js`
    - For any valid user record, storing via `putUserRecord()` and retrieving via `getUserByKeyHash()` returns a record with all fields equal to the original

- [x] 4. Implement Cognito service layer
  - [x] 4.1 Create `services/cognito.js` with Cognito SDK operations
    - Encapsulate `CognitoIdentityProviderClient` and `AdminUpdateUserAttributesCommand`
    - Provide `updateUserAttributes(cognitoSub, attributes)` method
    - Retrieve User Pool ID from `Config.settings().cognito.userPoolId` (CachedSsmParameter)
    - Use `DebugAndLog` for error logging
    - Include `TestHarness` class
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 4.2 Write unit test `tests/unit/cognito-service.test.js`
    - Test `updateUserAttributes` with mocked Cognito client
    - Verify User Pool ID is retrieved from CachedSsmParameter
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 5. Implement service layer
  - [x] 5.1 Create `services/profile.js` with Profile business logic
    - Look up user by email via `UserDao.queryByEmail()`
    - Compute effective tier (handle `tierExpiresAt` expiration)
    - Get rate limit config from `Config.settings().rateLimits`
    - Retrieve session hash salt from `Config.settings().ssm.sessionHashSalt`
    - Compute window boundaries and session key using `utils/window-calculator.js`
    - Query Sessions Table for current window record
    - Return consolidated profile data object
    - _Requirements: 5.2_

  - [x] 5.2 Create `services/key-regenerate.js` with Key Regeneration business logic
    - Look up user by email via `UserDao.queryByEmail()`
    - Generate new API key via `utils/api-key.js`
    - Compute HMAC-SHA256 hash
    - Delete old key record, create new key record preserving user fields
    - Update Cognito `custom:api_key` via `CognitoService.updateUserAttributes()`
    - Retrieve hash salt from `Config.settings().ssm.apiKeyHashSalt`
    - Return `{ apiKey: rawKey, message: '...' }`
    - _Requirements: 6.2_

  - [x] 5.3 Create `services/voucher-redeem.js` with Voucher Redemption business logic
    - Look up voucher via `VoucherDao.getVoucher()`
    - Validate voucher (exists, not expired, uses remaining)
    - Look up user by email via `UserDao.queryByEmail()`
    - Update user tier via `UserDao.updateUserTier()`
    - Increment voucher uses via `VoucherDao.incrementVoucherUses()`
    - Update Cognito `custom:tier` via `CognitoService.updateUserAttributes()`
    - Return `{ tier, tierExpiresAt, message: '...' }`
    - _Requirements: 7.2_

  - [x] 5.4 Write unit tests for services
    - Create `tests/unit/profile-service.test.js` — test effective tier computation, session record present/absent, rate limit config lookup
    - Create `tests/unit/key-regenerate-service.test.js` — test delete old + create new record, Cognito update
    - Create `tests/unit/voucher-redeem-service.test.js` — test voucher validation, tier update, Cognito update
    - _Requirements: 5.2, 6.2, 7.2_

- [x] 6. Checkpoint - Ensure models and services tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement controllers
  - [x] 7.1 Create `controllers/profile.js` with ProfileController
    - Receive `props` and `response` from route dispatcher
    - Validate JWT using `validateJwt()` (pass User Pool ID from `Config.settings().cognito.userPoolId`)
    - Call `ProfileService.getProfile()` with email and sub from JWT payload
    - Set response status to 200 and body to profile data on success
    - Handle 401 (bad JWT), 404 (user not found), 500 (unhandled error)
    - Use `Timer` for performance measurement, `DebugAndLog` for logging
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 11.1, 11.2_

  - [x] 7.2 Create `controllers/key-regenerate.js` with KeyRegenerateController
    - Receive `props` and `response` from route dispatcher
    - Validate JWT, call `KeyRegenerateService`, populate response
    - Handle 401, 404, 500 error cases
    - Use `Timer` and `DebugAndLog`
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 11.1, 11.2_

  - [x] 7.3 Create `controllers/voucher-redeem.js` with VoucherRedeemController
    - Receive `props` and `response` from route dispatcher
    - Validate JWT, parse voucher code from request body, call `VoucherRedeemService`
    - Handle 401, 400 (missing code, invalid/expired/redeemed voucher), 404, 500
    - Use `Timer` and `DebugAndLog`
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 11.1, 11.2_

  - [x] 7.4 Write unit tests for controllers
    - Create `tests/unit/profile-controller.test.js` — test success flow, 401, 404, 500
    - Create `tests/unit/key-regenerate-controller.test.js` — test success flow, 401, 404, 500
    - Create `tests/unit/voucher-redeem-controller.test.js` — test success flow, 401, 400 (missing code, invalid voucher), 404, 500
    - _Requirements: 5.1, 6.1, 7.1_

  - [x] 7.5 Write property test for profile response structure completeness
    - **Property 4: Profile response structure completeness**
    - **Validates: Requirements 5.2, 17.1**
    - Create `tests/property/profile-response-structure.property.test.js`
    - For any valid user record and session state, verify the profile response contains all required fields with correct values

  - [x] 7.6 Write property test for key regenerate response structure
    - **Property 5: Key regenerate response structure**
    - **Validates: Requirements 17.2**
    - Create `tests/property/key-regenerate-response.property.test.js`
    - For any valid user record, verify the response contains `apiKey` matching `/^atl_[0-9a-f]{32}$/` and a non-empty `message`

  - [x] 7.7 Write property test for voucher redeem response structure
    - **Property 6: Voucher redeem response structure**
    - **Validates: Requirements 17.3**
    - Create `tests/property/voucher-redeem-response.property.test.js`
    - For any valid voucher and user record, verify the response contains correct `tier`, future `tierExpiresAt`, and `message`

- [x] 8. Implement route dispatcher
  - [x] 8.1 Replace `routes/index.js` with cache-data-style route dispatcher
    - Read `clientRequest.getProps()` to obtain HTTP method and path
    - Use `path.endsWith()` matching for CloudFront compatibility:
      - `GET` + path ends with `mcp/auth/profile` → lazy-load and call ProfileController
      - `POST` + path ends with `mcp/auth/key/regenerate` → lazy-load and call KeyRegenerateController
      - `POST` + path ends with `mcp/auth/voucher/redeem` → lazy-load and call VoucherRedeemController
      - No match → set response status 404 with `{ "error": "Not found" }`
    - Use lazy-loading for controller imports
    - Use `DebugAndLog` for logging
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 8.2 Write unit test `tests/unit/route-dispatcher.test.js`
    - Test each route match with various path prefixes
    - Test 404 for unknown paths and wrong methods
    - Test lazy loading of controllers
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 8.3 Write property test for route dispatcher correctness
    - **Property 2: Route dispatcher correctness**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
    - Create `tests/property/route-dispatcher-correctness.property.test.js`
    - For any path prefix and method combination, verify correct controller is called or 404 is returned

- [x] 9. Checkpoint - Ensure controllers and route dispatcher tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Refactor handler entry point and migrate JWT validator
  - [x] 10.1 Refactor `index.js` to thin handler pattern
    - Import `DebugAndLog`, `ClientRequest`, `Response`, `Timer` from `@63klabs/cache-data`
    - Import `Config` from `./config` and `Routes` from `./routes`
    - Import `postConfirmationHandler` from `./handlers/post-confirmation`
    - Call `Config.init()` outside the handler for cold start optimization
    - Create `coldStartInitTimer` outside the handler
    - Inside handler: detect event type
      - If `event.triggerSource === 'PostConfirmation_ConfirmSignUp'` → delegate to PostConfirmation handler, re-throw errors
      - If API Gateway event → `await Config.promise()`, `await Config.prime()`, log cold start, create `ClientRequest`/`Response`, call `Routes.process()`, call `response.finalize()`
      - Unrecognized event → set response status 400 with error body, call `response.finalize()`
    - Error handler: log via `DebugAndLog.error()`, set 500 with `{ error: 'Internal server error', requestId }`, call `response.finalize()`
    - Remove `withCorsHeaders()` function and `CORS_HEADERS` constant
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 12.1, 12.2, 12.3_

  - [x] 10.2 Migrate JWT validator to accept User Pool ID as parameter
    - Modify `utils/jwt-validator.js` to accept User Pool ID as a parameter in `validateJwt()`
    - Preserve `process.env.COGNITO_USER_POOL_ID` fallback for the read Lambda's usage
    - Remove the custom `getCachedSsmParam()`, `cachedUserPoolId`, `userPoolIdCacheTime`, and `USER_POOL_ID_CACHE_TTL` from the module
    - Update `TestHarness.getInternals()` to remove the deleted SSM cache internals
    - Controllers pass the User Pool ID from `Config.settings().cognito.userPoolId.getValue()`
    - _Requirements: 13.1, 13.2, 13.3, 10.3_

  - [x] 10.3 Update unit test `tests/unit/jwt-validator.test.js`
    - Update tests to reflect the new parameter-based User Pool ID approach
    - Remove tests for the deleted custom SSM cache
    - _Requirements: 13.1, 13.3_

- [x] 11. Update PostConfirmation handler and clean up old files
  - [x] 11.1 Update `handlers/post-confirmation.js` import paths
    - Change `require('../utils/dynamo-client')` to `require('../models/user')` for `putUserRecord`
    - Keep `require('../utils/api-key')` unchanged
    - Keep the handler's own `getCachedSsmParam()` and SSM caching mechanism unchanged
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 11.2 Remove old handler files and replaced utilities
    - Delete `handlers/profile.js` (replaced by `controllers/profile.js` + `services/profile.js`)
    - Delete `handlers/key-regenerate.js` (replaced by `controllers/key-regenerate.js` + `services/key-regenerate.js`)
    - Delete `handlers/voucher-redeem.js` (replaced by `controllers/voucher-redeem.js` + `services/voucher-redeem.js`)
    - Delete `utils/dynamo-client.js` (replaced by `models/user.js` + `models/voucher.js`)
    - Delete `utils/rate-limit-config.js` (replaced by `config/settings.js` rateLimits section)
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 11.3 Update unit test `tests/unit/post-confirmation.test.js`
    - Update import paths to reflect `models/user.js` instead of `utils/dynamo-client.js`
    - Verify existing test behavior is preserved
    - _Requirements: 18.2_

- [x] 12. Checkpoint - Ensure all tests pass after handler refactor and cleanup
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Update existing tests for new module structure
  - [x] 13.1 Update existing property tests with new import paths
    - Update `tests/property/api-key.property.test.js` — imports unchanged (utils/api-key.js preserved)
    - Update `tests/property/cognito-env-var.property.test.js` — update if it references removed modules
    - Update `tests/property/domain-assignment.property.test.js` — imports unchanged (post-confirmation preserved)
    - Update `tests/property/effective-tier.property.test.js` — update to import from `services/profile.js` or wherever `computeEffectiveTier` now lives
    - Update `tests/property/profile-response.property.test.js` — update to import from new service/controller modules
    - Update `tests/property/session-key-consistency.property.test.js` — imports unchanged (utils/window-calculator.js preserved)
    - Update `tests/property/voucher-validation.property.test.js` — update to import from new service module
    - Update `tests/property/window-reset.property.test.js` — imports unchanged (utils/window-calculator.js preserved)
    - _Requirements: 18.1_

  - [x] 13.2 Update or remove existing unit tests for replaced modules
    - Remove `tests/unit/cors-headers.test.js` (CORS now handled by `Response.finalize()`)
    - Remove `tests/unit/rate-limit-config.test.js` (rate limits now in `config/settings.js`, tested by settings property test)
    - Update `tests/unit/route-dispatcher.test.js` if not already replaced in task 8.2
    - Update `tests/unit/key-regenerate.test.js`, `tests/unit/profile.test.js`, `tests/unit/voucher-redeem.test.js` — replace with controller/service tests from tasks 7.4 and 5.4, or remove if already covered
    - Update `tests/unit/window-calculator.test.js` — imports unchanged
    - _Requirements: 18.2, 18.4_

  - [x] 13.3 Run full test suite and fix any remaining import or assertion issues
    - Run `npx jest --run` from the auth Lambda directory
    - Fix any failing tests due to import path changes or module restructuring
    - _Requirements: 18.3_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Update CHANGELOG.md
  - [x] 15.1 Add entry under the `[v0.0.3] (unreleased)` section in CHANGELOG.md
    - Add under "Changed" category:
      - **Auth Lambda: cache-data MVC Migration** [Spec: 0-0-3-update-auth-function-to-use-cache-data](../.kiro/specs/0-0-3-update-auth-function-to-use-cache-data/)
        - Refactored auth Lambda to use `@63klabs/cache-data` MVC architecture (Config, ClientRequest, Response, DebugAndLog, Timer, CachedSsmParameter)
        - Reorganized code into config/, routes/, controllers/, services/, models/ directory structure
        - Replaced manual CORS headers with `Response.finalize()`
        - Replaced `console.log`/`console.error` with `DebugAndLog` in API Gateway code path
        - Consolidated SSM caching with `CachedSsmParameter` (eliminated duplicated `getCachedSsmParam` functions)
        - Migrated JWT validator to accept User Pool ID as parameter
        - Endpoint paths now include `/mcp` prefix (e.g., `/auth/profile` → `/mcp/auth/profile`)
    - _Requirements: All_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The PostConfirmation handler retains its own SSM caching and does NOT use cache-data classes
- Config skips `Cache.init()` — only uses `AppConfig.init()`
- Route dispatcher uses `path.endsWith()` for CloudFront compatibility
- Error responses preserve current auth format for endpoint errors (401/400/404), use read Lambda format with requestId for 500s
