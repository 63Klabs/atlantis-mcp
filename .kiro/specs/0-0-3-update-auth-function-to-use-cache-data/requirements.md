# Requirements Document

## Introduction

The auth Lambda function currently implements custom routing, request handling, CORS headers, SSM caching, and response formatting. As the number of endpoints grows, this approach becomes unmanageable and inconsistent with the read Lambda, which already uses the `@63klabs/cache-data` MVC pattern.

This refactoring migrates the auth Lambda's API Gateway path to the cache-data MVC architecture while preserving the Cognito PostConfirmation trigger path as-is. The endpoint behavior remains functionally unchanged, but all API Gateway paths gain the `/mcp` prefix (e.g., `/auth/profile` becomes `/mcp/auth/profile`). The refactoring consolidates duplicated SSM caching, replaces manual CORS with `Response.finalize()`, replaces `console.log` with `DebugAndLog`, and reorganizes code into the standard config/routes/controllers/services/models/utils directory structure.

## Glossary

- **Auth_Lambda**: The Lambda function at `application-infrastructure/src/lambda/auth/` that handles both Cognito PostConfirmation triggers and API Gateway proxy events for authentication endpoints.
- **Read_Lambda**: The existing Lambda function at `application-infrastructure/src/lambda/read/` that demonstrates the target cache-data MVC pattern.
- **Cache_Data_Package**: The `@63klabs/cache-data` npm package providing AppConfig, ClientRequest, Response, DebugAndLog, Timer, CachedSsmParameter, CachedParameterSecrets, Cache, and CacheableDataAccess classes.
- **Config**: The configuration class extending AppConfig from cache-data, responsible for cold start initialization, settings, validations, connections, and responses.
- **ClientRequest**: The cache-data class that parses and validates API Gateway events into a structured request object with `getProps()`.
- **Response**: The cache-data class that manages HTTP response construction, CORS headers, cache-control, and logging via `finalize()`.
- **DebugAndLog**: The cache-data logging class that integrates with CloudWatch and respects `CACHE_DATA_LOG_LEVEL`.
- **Timer**: The cache-data class for measuring operation performance.
- **CachedSsmParameter**: The cache-data class for retrieving and caching SSM Parameter Store values with configurable refresh intervals.
- **Route_Dispatcher**: The module in `routes/index.js` that reads `clientRequest.getProps()` and delegates to the appropriate controller.
- **Controller**: A module in `controllers/` that orchestrates business logic by calling services and populating the response.
- **Service**: A module in `services/` that contains business logic and calls models/DAOs. Services do not know about HTTP requests or responses.
- **Model_DAO**: A module in `models/` that handles data access operations (DynamoDB reads/writes, Cognito SDK calls).
- **PostConfirmation_Handler**: The Cognito PostConfirmation_ConfirmSignUp trigger handler that validates domains, assigns tiers, generates API keys, and creates user records. This handler does NOT use the cache-data MVC pattern.
- **JWT_Validator**: The utility at `utils/jwt-validator.js` that validates Cognito JWTs by verifying signatures against the JWKS endpoint.
- **MVC_Pattern**: The Model-View-Controller architecture defined by the cache-data steering document, consisting of handler → config → clientRequest/response → routes → controllers → services → models.
- **Effective_Tier**: The computed tier for a user, accounting for `tierExpiresAt` expiration. If the tier has expired, the Effective_Tier falls back to `registered`.

## Requirements

### Requirement 1: Add cache-data Dependency

**User Story:** As a developer, I want the auth Lambda to depend on `@63klabs/cache-data`, so that the function can use the MVC framework classes.

#### Acceptance Criteria

1. THE Auth_Lambda package.json SHALL include `@63klabs/cache-data` as a production dependency with a version compatible with the Read_Lambda (^1.3.11 or later).
2. WHEN `npm install` is run in the auth Lambda directory, THE Cache_Data_Package SHALL be installed and available for import.

### Requirement 2: Implement Config Module

**User Story:** As a developer, I want the auth Lambda to have a Config class extending AppConfig, so that cold start initialization, settings, validations, connections, and responses follow the cache-data pattern.

#### Acceptance Criteria

1. THE Auth_Lambda SHALL have a `config/index.js` module exporting a Config class that extends AppConfig from the Cache_Data_Package.
2. THE Config class SHALL implement a static `init()` method that calls `AppConfig.init()` with settings, validations, connections, and responses, and initializes `Cache.init()` with a CachedSsmParameter for the secure data key.
3. THE Config class SHALL implement a static `prime()` method that calls `CacheableDataAccess.prime()` and `CachedParameterSecrets.prime()`.
4. THE Auth_Lambda SHALL have a `config/settings.js` module that parses environment variables for SSM parameter paths, DynamoDB table names, Cognito configuration, and rate limit configuration.
5. THE Auth_Lambda SHALL have a `config/validations.js` module that defines ClientRequest parameter validation rules for the auth endpoints.
6. THE Auth_Lambda SHALL have a `config/connections.js` module that defines connection and cache profile definitions for DynamoDB and Cognito resources.
7. THE Auth_Lambda SHALL have a `config/responses.js` module that configures response format settings.

### Requirement 3: Refactor Handler Entry Point

**User Story:** As a developer, I want the auth Lambda handler to follow the thin handler pattern, so that cold start initialization, request parsing, and response finalization use cache-data classes.

#### Acceptance Criteria

1. THE Auth_Lambda `index.js` SHALL call `Config.init()` outside the handler function for cold start optimization.
2. THE Auth_Lambda handler SHALL await `Config.promise()` and `Config.prime()` inside the handler function before processing requests.
3. WHEN the event is a Cognito PostConfirmation_ConfirmSignUp trigger, THE Auth_Lambda handler SHALL delegate directly to the PostConfirmation_Handler without using cache-data request/response classes.
4. WHEN the event is an API Gateway proxy event, THE Auth_Lambda handler SHALL create a ClientRequest and Response, delegate to the Route_Dispatcher, and call `response.finalize()` exactly once.
5. IF an unhandled error occurs during API Gateway event processing, THEN THE Auth_Lambda handler SHALL log the error using DebugAndLog, set the response status to 500 with a sanitized error body, and call `response.finalize()`.
6. THE Auth_Lambda handler SHALL use a Timer to measure cold start duration and log it via DebugAndLog on the first invocation only.

### Requirement 4: Implement Route Dispatcher with /mcp Prefix

**User Story:** As a developer, I want the auth Lambda to use a cache-data-style route dispatcher that handles the `/mcp/auth/*` path prefix, so that routing is consistent with the read Lambda and supports the CloudFront path structure.

#### Acceptance Criteria

1. THE Route_Dispatcher SHALL read `clientRequest.getProps()` to obtain the HTTP method, path, and pathArray.
2. WHEN the request path matches `mcp/auth/profile` and the method is GET, THE Route_Dispatcher SHALL delegate to the Profile Controller.
3. WHEN the request path matches `mcp/auth/key/regenerate` and the method is POST, THE Route_Dispatcher SHALL delegate to the Key Regenerate Controller.
4. WHEN the request path matches `mcp/auth/voucher/redeem` and the method is POST, THE Route_Dispatcher SHALL delegate to the Voucher Redeem Controller.
5. WHEN the request path does not match any defined route, THE Route_Dispatcher SHALL set the response status to 404 with an error body of `{ "error": "Not found" }`.
6. THE Route_Dispatcher SHALL use lazy-loading for controller imports to avoid pulling in service dependencies at module-load time.

### Requirement 5: Implement Profile Controller and Service

**User Story:** As a developer, I want the profile endpoint logic separated into a controller and service layer, so that business logic is decoupled from HTTP request/response handling.

#### Acceptance Criteria

1. THE Profile Controller SHALL receive parsed request properties and a Response object, validate the JWT, call the Profile Service, and populate the response.
2. THE Profile Service SHALL look up the user record by email, compute the Effective_Tier, retrieve rate limit configuration, compute window boundaries and session key, query the Sessions Table for the current window record, and return a consolidated profile data object.
3. WHEN the JWT is invalid or missing, THE Profile Controller SHALL set the response status to 401 with an error body of `{ "error": "Unauthorized" }`.
4. WHEN the user record is not found, THE Profile Controller SHALL set the response status to 404 with an error body of `{ "error": "User not found" }`.
5. THE Profile Controller SHALL use a Timer to measure the profile retrieval operation and log the duration via DebugAndLog.
6. IF an error occurs during profile retrieval, THEN THE Profile Controller SHALL log the error using DebugAndLog and set the response status to 500 with a sanitized error body.

### Requirement 6: Implement Key Regenerate Controller and Service

**User Story:** As a developer, I want the key regeneration endpoint logic separated into a controller and service layer, so that business logic is decoupled from HTTP request/response handling.

#### Acceptance Criteria

1. THE Key Regenerate Controller SHALL receive parsed request properties and a Response object, validate the JWT, call the Key Regenerate Service, and populate the response.
2. THE Key Regenerate Service SHALL look up the existing user record by email, generate a new API key, compute the HMAC-SHA256 hash, delete the old key record, create a new key record preserving user fields, update Cognito custom:api_key, and return the new raw key.
3. WHEN the JWT is invalid or missing, THE Key Regenerate Controller SHALL set the response status to 401 with an error body of `{ "error": "Unauthorized" }`.
4. WHEN the user record is not found, THE Key Regenerate Controller SHALL set the response status to 404 with an error body of `{ "error": "User not found" }`.
5. THE Key Regenerate Controller SHALL use a Timer to measure the key regeneration operation and log the duration via DebugAndLog.
6. IF an error occurs during key regeneration, THEN THE Key Regenerate Controller SHALL log the error using DebugAndLog and set the response status to 500 with a sanitized error body.

### Requirement 7: Implement Voucher Redeem Controller and Service

**User Story:** As a developer, I want the voucher redemption endpoint logic separated into a controller and service layer, so that business logic is decoupled from HTTP request/response handling.

#### Acceptance Criteria

1. THE Voucher Redeem Controller SHALL receive parsed request properties and a Response object, validate the JWT, parse the voucher code from the request body, call the Voucher Redeem Service, and populate the response.
2. THE Voucher Redeem Service SHALL look up the voucher record by code, validate the voucher (exists, not expired, uses remaining), look up the user by email, update the user tier and tierExpiresAt, atomically increment the voucher currentUses counter, update Cognito custom:tier, and return the new tier and expiration.
3. WHEN the JWT is invalid or missing, THE Voucher Redeem Controller SHALL set the response status to 401 with an error body of `{ "error": "Unauthorized" }`.
4. WHEN the voucher code is missing from the request body, THE Voucher Redeem Controller SHALL set the response status to 400 with an error body of `{ "error": "Voucher code is required" }`.
5. WHEN the voucher is invalid, expired, or fully redeemed, THE Voucher Redeem Controller SHALL set the response status to 400 with the appropriate error message from the voucher validation.
6. WHEN the user record is not found, THE Voucher Redeem Controller SHALL set the response status to 404 with an error body of `{ "error": "User not found" }`.
7. THE Voucher Redeem Controller SHALL use a Timer to measure the voucher redemption operation and log the duration via DebugAndLog.
8. IF an error occurs during voucher redemption, THEN THE Voucher Redeem Controller SHALL log the error using DebugAndLog and set the response status to 500 with a sanitized error body.

### Requirement 8: Implement DynamoDB Model/DAO Layer

**User Story:** As a developer, I want DynamoDB operations extracted into a proper model/DAO layer, so that data access is centralized and follows the MVC pattern.

#### Acceptance Criteria

1. THE Auth_Lambda SHALL have a `models/` directory containing DAO modules for user and voucher data access.
2. THE User DAO SHALL provide methods for: getUserByKeyHash, putUserRecord, deleteUserRecord, queryByEmail, updateUserTier, and getSessionRecord.
3. THE Voucher DAO SHALL provide methods for: getVoucher and incrementVoucherUses.
4. THE DAO modules SHALL use the DynamoDB table names from `Config.settings()` rather than directly reading `process.env`.
5. THE DAO modules SHALL use DebugAndLog for error logging instead of `console.error`.

### Requirement 9: Implement Cognito Service Layer

**User Story:** As a developer, I want Cognito SDK calls extracted into a service layer, so that Cognito operations are centralized and reusable across controllers.

#### Acceptance Criteria

1. THE Auth_Lambda SHALL have a `services/cognito.js` module (or equivalent) that encapsulates CognitoIdentityProviderClient operations.
2. THE Cognito Service SHALL provide a method to update user attributes (custom:api_key, custom:tier) given a user pool ID, Cognito sub, and attribute values.
3. THE Cognito Service SHALL retrieve the User Pool ID using CachedSsmParameter from the Cache_Data_Package instead of a custom SSM cache.
4. THE Cognito Service SHALL use DebugAndLog for error logging instead of `console.error`.

### Requirement 10: Consolidate SSM Caching with CachedSsmParameter

**User Story:** As a developer, I want all SSM parameter retrieval consolidated using CachedSsmParameter from cache-data, so that the duplicated custom SSM caching code in each handler is eliminated.

#### Acceptance Criteria

1. THE Auth_Lambda SHALL use CachedSsmParameter instances from the Cache_Data_Package for all SSM parameter retrieval in the API Gateway path.
2. THE Auth_Lambda SHALL define CachedSsmParameter instances in `config/settings.js` for: Mcp_CognitoUserPoolId (via app-stack/ path), Mcp_ApiKeyHashSalt, Mcp_SessionHashSalt, Mcp_BlockedEmailDomains, Mcp_AllowedEmailDomains, Mcp_BlockedCountries, Mcp_AllowedCountries, and Mcp_AllowedPrivateDomains.
3. THE custom `getCachedSsmParam` functions and `ssmCache` objects in the handler modules SHALL be removed from the API Gateway code path.
4. THE PostConfirmation_Handler SHALL retain its own SSM caching mechanism since it does not use the cache-data pattern.

### Requirement 11: Replace console.log with DebugAndLog

**User Story:** As a developer, I want all logging in the API Gateway code path to use DebugAndLog, so that logging is consistent with the read Lambda and integrates with CloudWatch log levels.

#### Acceptance Criteria

1. THE Auth_Lambda API Gateway code path SHALL use `DebugAndLog.error()` for error logging instead of `console.error()`.
2. THE Auth_Lambda API Gateway code path SHALL use `DebugAndLog.debug()` for debug logging instead of `console.log()`.
3. THE Auth_Lambda API Gateway code path SHALL use `DebugAndLog.info()` for informational logging.
4. THE Auth_Lambda API Gateway code path SHALL use `DebugAndLog.warn()` for warning conditions.
5. THE PostConfirmation_Handler MAY continue using `console.error` and `console.log` since it does not use the cache-data pattern.

### Requirement 12: Replace Manual CORS with Response.finalize()

**User Story:** As a developer, I want CORS headers managed by `Response.finalize()` instead of manual CORS header injection, so that CORS handling is consistent with the read Lambda.

#### Acceptance Criteria

1. THE Auth_Lambda API Gateway code path SHALL NOT manually set CORS headers (Access-Control-Allow-Origin, Access-Control-Allow-Methods, Access-Control-Allow-Headers).
2. THE Auth_Lambda API Gateway code path SHALL rely on `response.finalize()` to set CORS headers based on referrer validation configured in `config/validations.js`.
3. THE `withCorsHeaders()` function in the current `index.js` SHALL be removed.

### Requirement 13: Preserve JWT Validator Utility

**User Story:** As a developer, I want the JWT validator utility preserved in the utils directory, so that the auth-specific JWT validation logic remains available to controllers.

#### Acceptance Criteria

1. THE Auth_Lambda SHALL retain `utils/jwt-validator.js` with its current JWT validation logic (JWKS fetching, signature verification, expiration check, issuer check, token_use check).
2. THE JWT_Validator SHALL continue to use its own JWKS caching mechanism (separate from CachedSsmParameter) since JWKS is fetched from a Cognito HTTP endpoint, not SSM.
3. THE JWT_Validator SHALL use CachedSsmParameter for retrieving the Cognito User Pool ID instead of its custom SSM cache, when called from the API Gateway code path.

### Requirement 14: Preserve Utility Modules

**User Story:** As a developer, I want the pure utility modules (api-key, window-calculator, rate-limit-config) preserved in the utils directory, so that their tested logic remains available.

#### Acceptance Criteria

1. THE Auth_Lambda SHALL retain `utils/api-key.js` with its `generateApiKey()` and `hashApiKey()` functions unchanged.
2. THE Auth_Lambda SHALL retain `utils/window-calculator.js` with its `computeWindowBoundaries()` and `computeSessionKey()` functions unchanged.
3. THE Auth_Lambda SHALL retain `utils/rate-limit-config.js` with its `getRateLimitConfig()` function unchanged.
4. THE utility modules SHALL continue to export TestHarness classes for testing private internals.

### Requirement 15: Preserve PostConfirmation Handler

**User Story:** As a developer, I want the PostConfirmation handler preserved as a standalone module outside the MVC pattern, so that the Cognito trigger path continues to work independently.

#### Acceptance Criteria

1. THE PostConfirmation_Handler SHALL remain in the `handlers/` directory (or be moved to a clearly separated location) and SHALL NOT use cache-data ClientRequest, Response, or Route_Dispatcher classes.
2. THE PostConfirmation_Handler SHALL retain its own SSM caching, domain validation, country restriction, tier assignment, API key generation, and user record creation logic.
3. WHEN the Auth_Lambda receives a Cognito PostConfirmation_ConfirmSignUp trigger, THE handler SHALL delegate directly to the PostConfirmation_Handler and return the Cognito event object.
4. THE PostConfirmation_Handler MAY share utility modules (api-key.js, dynamo-client operations) with the MVC code path through the models and utils layers.

### Requirement 16: Follow Target Directory Structure

**User Story:** As a developer, I want the auth Lambda to follow the same directory structure as the read Lambda, so that the codebase is consistent and maintainable.

#### Acceptance Criteria

1. THE Auth_Lambda SHALL organize API Gateway code into the following directory structure: `config/` (index.js, settings.js, connections.js, validations.js, responses.js), `routes/` (index.js), `controllers/`, `services/`, `models/`, `utils/`, and `tests/` (unit/, property/).
2. THE Auth_Lambda SHALL retain a `handlers/` directory (or equivalent separation) for the PostConfirmation_Handler since it is not an API Gateway endpoint.
3. THE Auth_Lambda old `handlers/` directory files for API Gateway endpoints (profile.js, key-regenerate.js, voucher-redeem.js) SHALL be replaced by the corresponding controller and service modules.

### Requirement 17: No Breaking Changes to Endpoint Behavior

**User Story:** As a developer, I want the refactored endpoints to produce the same response bodies and status codes as the current implementation, so that API consumers are not affected.

#### Acceptance Criteria

1. WHEN a valid GET request is made to `/mcp/auth/profile` with a valid JWT, THE Auth_Lambda SHALL return a 200 response with the same JSON body structure: `{ email, tier, tierExpiresAt, createdAt, rateLimits: { limit, remaining, windowResetAt, windowMinutes } }`.
2. WHEN a valid POST request is made to `/mcp/auth/key/regenerate` with a valid JWT, THE Auth_Lambda SHALL return a 200 response with the same JSON body structure: `{ apiKey, message }`.
3. WHEN a valid POST request is made to `/mcp/auth/voucher/redeem` with a valid JWT and voucher code, THE Auth_Lambda SHALL return a 200 response with the same JSON body structure: `{ tier, tierExpiresAt, message }`.
4. WHEN an invalid JWT is provided, THE Auth_Lambda SHALL return a 401 response with `{ "error": "Unauthorized" }`.
5. WHEN a user record is not found, THE Auth_Lambda SHALL return a 404 response with `{ "error": "User not found" }`.
6. WHEN an internal error occurs, THE Auth_Lambda SHALL return a 500 response with `{ "error": "Internal server error" }` or an equivalent sanitized error message.

### Requirement 18: Update Existing Tests

**User Story:** As a developer, I want the existing unit and property tests updated to match the new MVC structure, so that test coverage is maintained after the refactoring.

#### Acceptance Criteria

1. THE existing property tests (api-key, cognito-env-var, domain-assignment, effective-tier, profile-response, session-key-consistency, voucher-validation, window-reset) SHALL be updated to import from the new module locations.
2. THE existing unit tests (cors-headers, jwt-validator, key-regenerate, post-confirmation, profile, rate-limit-config, route-dispatcher, voucher-redeem, window-calculator) SHALL be updated or replaced to test the new controller, service, and model modules.
3. WHEN all tests are run, THE test suite SHALL pass with no regressions in the tested behaviors.
4. THE CORS headers unit test SHALL be removed or replaced since CORS is now handled by `Response.finalize()`.
