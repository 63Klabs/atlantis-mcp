# Implementation Plan: API Response Headers Return NaN

## Overview

Rewrite the rate limiter (`utils/rate-limiter.js`) to fix NaN headers and add distributed rate limiting backed by DynamoDB with an in-memory LRU cache, interval-aligned windows, and salted SHA-256 client identifier hashing. The implementation follows a bottom-up approach: pure utility functions first, then cache, then DynamoDB operations, then wiring, then handler/infra changes.

## Tasks

- [x] 1. Implement pure utility functions and RateLimitCache class
  - [x] 1.1 Create conversion helpers and window calculator in `utils/rate-limiter.js`
    - Implement `convertFromMinutesToMilli(minutes)` and `convertFromMilliToMinutes(milliSeconds)` (rounds up to nearest minute)
    - Implement `nextIntervalInMinutes(intervalInMinutes, offsetInMinutes = 0)` pure function that computes the next window reset time aligned to clock boundaries in `Etc/UTC`
    - These are private functions exposed via `TestHarness.getInternals()`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 1.2 Write unit tests for window calculator
    - Create `tests/unit/utils/window-calculator.test.js`
    - Test specific window sizes: 5, 60, 120, 240, 1440 minutes
    - Verify reset times at :00, :05, :10 etc. for 5-minute windows
    - Verify reset at top of hour for 60-minute windows
    - Verify reset at midnight for 1440-minute windows
    - Verify result is always strictly in the future
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 12.2_

  - [x] 1.3 Write property test for window calculator (Property 3)
    - Create `tests/unit/utils/window-calculator-property.test.js`
    - **Property 3: Window calculator produces future-aligned reset times**
    - For any timestamp and valid `windowInMinutes`, verify result is (a) strictly greater than current time in minutes and (b) evenly divisible by `windowInMinutes` from midnight `Etc/UTC`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 4.1, 4.5, 4.6**

  - [x] 1.4 Implement `RateLimitCache` class in `utils/rate-limiter.js`
    - LRU Map-based in-memory cache with `get(key)`, `set(key, value, expiresAt)`, `clear()`, `cleanup()`, `info()` methods
    - `get` returns `{cache: 0|-1|1, data: object|null}` (0=miss, -1=expired, 1=hit)
    - LRU eviction when cache reaches `maxEntries`
    - `cleanup()` removes all expired entries
    - Private class exposed via `TestHarness.getInternals()`
    - _Requirements: 5.1, 5.4, 5.5_

  - [x] 1.5 Write unit tests for RateLimitCache
    - Create `tests/unit/utils/rate-limit-cache.test.js`
    - Test get/set, LRU eviction, expiration, cleanup, info
    - _Requirements: 5.4, 5.5, 12.3_

  - [x] 1.6 Write property test for RateLimitCache (Property 5)
    - Create `tests/unit/utils/rate-limit-cache-property.test.js`
    - **Property 5: LRU cache never exceeds maximum capacity and contains no expired entries after cleanup**
    - For any sequence of `set` operations, cache size never exceeds `maxEntries`; after `cleanup()`, zero expired entries remain
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 5.4, 5.5**

- [x] 2. Implement client identifier hashing
  - [x] 2.1 Implement `hashClientIdentifier(rawId, windowStartMinutes, salt)` in `utils/rate-limiter.js`
    - Use Node.js built-in `crypto` module for SHA-256
    - Hash composite key: `rawId + windowStartMinutes + salt`
    - Private function exposed via `TestHarness.getInternals()`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.2 Write unit tests for client identifier hashing
    - Add tests in `tests/unit/utils/rate-limiter.test.js`
    - Verify SHA-256 output format (64 hex chars)
    - Verify determinism (same inputs → same hash)
    - Verify different windows produce different hashes for same client
    - Verify public tier uses sourceIp, authenticated tier uses userId
    - _Requirements: 3.3, 3.5, 12.6_

  - [x] 2.3 Write property test for client identifier hashing (Property 2)
    - Add to `tests/unit/utils/rate-limiter-property.test.js`
    - **Property 2: Client identifier hash determinism and cross-window uniqueness**
    - For any raw ID, salt, and window start: same inputs produce same hash (determinism); different `windowStart` values produce different hashes (cross-window uniqueness)
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 3.3, 3.5**

- [x] 3. Checkpoint - Verify utility functions and cache
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add config and settings for hash salt and sessions table
  - [x] 4.1 Add `sessionHashSalt` and `dynamoDbSessionsTable` to `config/settings.js`
    - Add `sessionHashSalt` as a `CachedSsmParameter` instance at `${PARAM_STORE_PATH}Mcp_SessionHashSalt`
    - Add `dynamoDbSessionsTable` reading from `process.env.MCP_DYNAMODB_SESSIONS_TABLE`
    - _Requirements: 10.1, 10.2, 11.1, 11.2_

  - [x] 4.2 Update `config/index.js` to initialize the hash salt parameter
    - Ensure `CachedSsmParameter` for `Mcp_SessionHashSalt` is initialized during `Config.init()`
    - The salt must be available via `Config.settings().sessionHashSalt`
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 4.3 Write property test for settings environment variable overrides (Property 10)
    - Add to `tests/unit/utils/rate-limiter-property.test.js`
    - **Property 10: Environment variable overrides take effect in settings**
    - For any valid numeric string set as rate limit env vars, `settings.rateLimits` reflects the parsed integer
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 10.3**

- [x] 5. Implement DynamoDB operations in rate-limiter
  - [x] 5.1 Implement `fetchFromDynamo(pk)`, `decrementInDynamo(pk, ttl, limitPerWindow)`, and `createInDynamo(pk, limitPerWindow, ttl)` in `utils/rate-limiter.js`
    - `fetchFromDynamo`: DynamoDB `GetItem` wrapper using `@aws-sdk/lib-dynamodb`
    - `decrementInDynamo`: Atomic `UpdateItem` with `SET remaining = remaining - :dec` and condition `remaining > 0`; on `ConditionalCheckFailedException` return rate-limited state
    - `createInDynamo`: `PutItem` for new window entry with `remaining`, `limit`, `tier`, `ttl`
    - All functions read table name from `Config.settings().dynamoDbSessionsTable`
    - Private functions exposed via `TestHarness.getInternals()`
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 5.2 Write unit tests for DynamoDB operations
    - Add tests in `tests/unit/utils/rate-limiter.test.js`
    - Mock DynamoDB client calls using `aws-sdk-client-mock`
    - Verify update expression and condition expression for atomic decrement
    - Verify `ConditionalCheckFailedException` handling returns rate-limited state
    - Verify `PutItem` creates correct entry with TTL
    - Verify fallback to in-memory on DynamoDB errors
    - _Requirements: 6.1, 6.2, 6.3, 8.1, 8.2, 12.4, 12.5_

  - [x] 5.3 Write property test for DynamoDB condition prevents negative remaining (Property 6)
    - Add to `tests/unit/utils/rate-limiter-property.test.js`
    - **Property 6: DynamoDB condition prevents remaining from going below zero**
    - For any entry where `remaining` equals 0, the atomic update with condition `remaining > 0` fails and rate limiter returns `allowed: false` with `Retry-After`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 6.2**

  - [x] 5.4 Write property test for DynamoDB failure fallback (Property 8)
    - Add to `tests/unit/utils/rate-limiter-property.test.js`
    - **Property 8: DynamoDB failure falls back to in-memory rate limiting**
    - For any DynamoDB error, rate limiter returns valid `{allowed, headers, retryAfter}` using in-memory state without throwing
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 8.1, 8.3**

- [x] 6. Rewrite `checkRateLimit` to wire everything together
  - [x] 6.1 Implement async `checkRateLimit(event, limits)` in `utils/rate-limiter.js`
    - Make function async; return `{allowed, headers, retryAfter, dynamoPromise}`
    - Extract client identifier: sourceIp for public tier, userId for authenticated tier
    - Compute window start and hashed client identifier using salt from `Config.settings().sessionHashSalt`
    - Check in-memory cache: hit with valid window → use cached state + background DynamoDB sync; miss or expired → await DynamoDB fetch/create
    - On window transition: return fresh state with `remaining = limitPerWindow` optimistically
    - Build headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (all valid numbers, never NaN)
    - If rate limited: add `Retry-After` header, return `allowed: false`
    - On DynamoDB failure: fall back to in-memory-only, log warning via `DebugAndLog.warn()`
    - On hash salt unavailable: fail closed (reject requests), log error via `DebugAndLog.error()`
    - Update `createRateLimitResponse` and `getRateLimitStats` exports
    - Add `TestHarness` class exposing all private internals for testing
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 5.1, 5.2, 5.3, 6.1, 6.4, 7.1, 7.2, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 9.5, 10.2, 11.3_

  - [x] 6.2 Write unit tests for checkRateLimit
    - Add tests in `tests/unit/utils/rate-limiter.test.js`
    - Verify headers are NOT NaN (the original bug fix)
    - Verify `X-RateLimit-Limit` equals `limitPerWindow`
    - Verify `X-RateLimit-Remaining` is non-negative integer
    - Verify `X-RateLimit-Reset` is valid future Unix timestamp
    - Verify cache hit returns cached state without awaiting DynamoDB
    - Verify window transition returns fresh state with full remaining
    - Verify DynamoDB fallback on error
    - Verify hash salt unavailable fails closed
    - _Requirements: 1.1, 1.2, 9.1, 9.2, 9.3, 12.1_

  - [x] 6.3 Write property test for valid numeric headers (Property 1)
    - Add to `tests/unit/utils/rate-limiter-property.test.js`
    - **Property 1: Rate limit headers contain valid numeric values matching configuration**
    - For any valid config and event, headers are valid numbers (not NaN), `X-RateLimit-Limit` equals `limitPerWindow`, `X-RateLimit-Remaining` is non-negative, `X-RateLimit-Reset` is future timestamp
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 1.1, 1.2, 9.1, 9.2, 9.3**

  - [x] 6.4 Write property test for cache hit behavior (Property 4)
    - Add to `tests/unit/utils/rate-limiter-property.test.js`
    - **Property 4: Cache hit returns last-known state within current window**
    - For any non-expired cache entry in current window, `checkRateLimit` returns headers from cached values without awaiting DynamoDB
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 5.1**

  - [x] 6.5 Write property test for window transition (Property 7)
    - Add to `tests/unit/utils/rate-limiter-property.test.js`
    - **Property 7: Window transition returns fresh state with full remaining count**
    - For any cache entry from a previous window, `checkRateLimit` returns `remaining` equal to `limitPerWindow`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 7.1**

  - [x] 6.6 Write property test for rate limit exceeded (Property 9)
    - Add to `tests/unit/utils/rate-limiter-property.test.js`
    - **Property 9: Rate limit exceeded returns 429 with Retry-After**
    - For any exhausted client (remaining=0), `checkRateLimit` returns `allowed: false` and `createRateLimitResponse` produces 429 with positive `Retry-After`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 9.4, 9.5**

- [x] 7. Checkpoint - Verify rate limiter module
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update handler and CloudFormation template
  - [x] 8.1 Update `index.js` handler to use async checkRateLimit
    - Change `RateLimiter.checkRateLimit(event, Config.settings().rateLimits)` to `await RateLimiter.checkRateLimit(event, Config.settings().rateLimits)`
    - Await `rateLimitCheck.dynamoPromise` before returning the response to ensure DynamoDB update completes
    - _Requirements: 6.4_

  - [x] 8.2 Add DynamoDB Sessions table to `application-infrastructure/template.yml`
    - Add `DynamoDbSessions` resource: PAY_PER_REQUEST billing, partition key `pk` (String), TTL attribute `ttl`
    - Table name: `!Sub ${Prefix}-${ProjectId}-${StageId}-sessions`
    - Add `MCP_DYNAMODB_SESSIONS_TABLE` environment variable to Lambda function
    - Add IAM permissions: `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem` scoped to sessions table ARN
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 8.3 Add `fast-check` to devDependencies in `application-infrastructure/src/lambda/read/package.json`
    - Add `"fast-check": "^3.0.0"` to devDependencies for property-based tests
    - _Requirements: 12.7_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All new tests use Jest (`.test.js`) matching the existing project convention
- The `TestHarness` pattern is used to expose private internals for testing without polluting the public API
- `fast-check` is used for property-based testing
