# Requirements Document

## Introduction

The API response headers `X-RateLimit-Reset` and `X-RateLimit-Remaining` currently return `NaN` due to bugs in `rate-limiter.js`. This feature fixes those bugs by rearchitecting the rate limiter to use distributed storage backed by DynamoDB with an in-memory cache for fast-path optimization. Rate limit windows align to clock boundaries (on the mark of the minute, hour, or day) using interval-aligned calculations. Client identifiers are hashed with salted SHA-256 for privacy.

## Glossary

- **Rate_Limiter**: The utility module (`utils/rate-limiter.js`) responsible for tracking and enforcing per-client request limits across Lambda instances
- **In_Memory_Cache**: A per-Lambda-instance Map-based cache that stores the last known rate limit state for fast-path lookups without awaiting DynamoDB
- **Sessions_Table**: The application-specific DynamoDB table (logical name `DynamoDbSessions`) that stores distributed rate limit state, keyed by hashed client identifier
- **Client_Identifier**: A SHA-256 hash of the composite key (raw client identifier + window start timestamp + salt) used as the partition key in the Sessions_Table. The composite key prevents cross-window correlation and makes reversal infeasible even if the salt is compromised
- **Rate_Limit_Window**: A fixed time interval (in minutes) during which a client may make up to `limitPerWindow` requests, aligned to clock boundaries in `Etc/UTC`
- **Window_Calculator**: The pure function `nextIntervalInMinutes` that computes the next window reset time aligned to clock boundaries
- **Handler**: The Lambda entry point (`index.js`) that invokes the Rate_Limiter before processing requests and merges rate limit headers into responses
- **Config**: The application configuration module (`config/index.js`) extending AppConfig from `@63klabs/cache-data`, responsible for initialization, priming, and providing settings and connection profiles
- **Hash_Salt**: A secret value stored in SSM Parameter Store at `${PARAM_STORE_PATH}Mcp_SessionHashSalt` used to salt client identifier hashes
- **Settings**: The configuration module (`config/settings.js`) that provides `rateLimits` configuration for each access tier (public, registered, paid, private)

## Requirements

### Requirement 1: Fix Argument Passing in checkRateLimit

**User Story:** As a developer, I want `checkRateLimit` to pass the correct arguments to `getRateLimitData`, so that rate limit headers return valid numeric values instead of `NaN`.

#### Acceptance Criteria

1. WHEN `checkRateLimit` is invoked with an event and rate limit configuration, THE Rate_Limiter SHALL pass the client identifier string, the `limitPerWindow` number, and the `windowInMinutes` number as separate arguments to the rate limit data lookup function
2. WHEN rate limit headers are constructed, THE Rate_Limiter SHALL reference the `limitPerWindow` variable for the `X-RateLimit-Limit` header value
3. WHEN `incrementRequestCount` is invoked, THE Rate_Limiter SHALL use the same client identifier string that was used to store the rate limit entry

### Requirement 2: DynamoDB Sessions Table

**User Story:** As a developer, I want a DynamoDB table provisioned in the application CloudFormation template, so that rate limit state can be stored and shared across Lambda instances.

#### Acceptance Criteria

1. THE Sessions_Table SHALL be defined in the application CloudFormation template with the logical name `DynamoDbSessions`
2. THE Sessions_Table SHALL use a simple partition key named `pk` of type String
3. THE Sessions_Table SHALL have a TTL attribute named `ttl` for automatic cleanup of expired entries
4. THE Sessions_Table SHALL follow the naming convention `<Prefix>-<ProjectId>-<StageId>-sessions`
5. THE CloudFormation template SHALL pass the Sessions_Table name to the Lambda function as the environment variable `MCP_DYNAMODB_SESSIONS_TABLE`
6. THE CloudFormation template SHALL grant the Lambda function IAM permissions limited to `dynamodb:GetItem`, `dynamodb:PutItem`, and `dynamodb:UpdateItem` scoped to the Sessions_Table resource ARN

### Requirement 3: Client Identifier Hashing

**User Story:** As a developer, I want client identifiers hashed with a salted SHA-256 algorithm, so that raw IP addresses and user IDs are not stored in the Sessions_Table.

#### Acceptance Criteria

1. WHEN a public-tier request is received, THE Rate_Limiter SHALL use the source IP address as the raw client identifier
2. WHEN an authenticated-tier request is received, THE Rate_Limiter SHALL use the user ID as the raw client identifier
3. WHEN computing the Client_Identifier, THE Rate_Limiter SHALL hash the composite key `rawIdentifier + windowStartInMinutes + salt` using SHA-256, where `windowStartInMinutes` is the current window's start timestamp in minutes and `salt` is the Hash_Salt retrieved from SSM Parameter Store at `${PARAM_STORE_PATH}Mcp_SessionHashSalt`
4. THE Rate_Limiter SHALL use the Node.js built-in `crypto` module for SHA-256 hashing
5. THE composite key approach SHALL ensure that the same client produces different partition keys in different Rate_Limit_Windows, preventing cross-window correlation of client identifiers

### Requirement 4: Interval-Aligned Rate Limit Windows

**User Story:** As a developer, I want rate limit windows to reset on clock boundaries, so that window resets are predictable and consistent across all clients.

#### Acceptance Criteria

1. THE Window_Calculator SHALL compute the next reset time by rounding up the current `Etc/UTC` timestamp to the nearest multiple of the configured `windowInMinutes`
2. WHEN `windowInMinutes` is 5, THE Window_Calculator SHALL produce reset times at :00, :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55 of each hour
3. WHEN `windowInMinutes` is 60, THE Window_Calculator SHALL produce reset times at the top of each hour
4. WHEN `windowInMinutes` is 1440, THE Window_Calculator SHALL produce a reset time at midnight `Etc/UTC`
5. FOR ALL valid `windowInMinutes` values, THE Window_Calculator SHALL produce a next reset time that is strictly in the future relative to the current timestamp
6. FOR ALL valid `windowInMinutes` values, THE Window_Calculator SHALL produce a next reset time that is aligned to a multiple of `windowInMinutes` from midnight `Etc/UTC`

### Requirement 5: In-Memory Cache for Fast-Path Rate Limit Checks

**User Story:** As a developer, I want an in-memory cache that provides the last known rate limit state, so that the Lambda function can respond quickly without blocking on DynamoDB reads.

#### Acceptance Criteria

1. WHEN a request arrives and the Client_Identifier exists in the In_Memory_Cache with a valid (non-expired) entry, THE Rate_Limiter SHALL use the cached rate limit state to determine the response headers and whether the request is allowed
2. WHEN a request arrives and the Client_Identifier exists in the In_Memory_Cache with a valid entry, THE Rate_Limiter SHALL trigger a background DynamoDB fetch to refresh the cached state
3. WHEN a request arrives and the Client_Identifier does not exist in the In_Memory_Cache or the cached entry has expired, THE Rate_Limiter SHALL await a DynamoDB fetch to retrieve or create the rate limit entry before responding
4. THE In_Memory_Cache SHALL use LRU eviction when the cache reaches maximum capacity
5. THE Rate_Limiter SHALL periodically remove expired entries from the In_Memory_Cache

### Requirement 6: DynamoDB Distributed Rate Limit Enforcement

**User Story:** As a developer, I want DynamoDB to serve as the authoritative source of truth for rate limit counts, so that rate limiting is accurate across concurrent Lambda instances.

#### Acceptance Criteria

1. WHEN a request is allowed, THE Rate_Limiter SHALL decrement the remaining count in the Sessions_Table using a DynamoDB atomic update expression
2. THE Rate_Limiter SHALL use a DynamoDB condition expression to verify `remaining > 0` before decrementing, preventing the count from going below zero
3. WHEN a new Rate_Limit_Window begins and no entry exists in the Sessions_Table for the current window, THE Rate_Limiter SHALL create a new entry with `remaining` set to `limitPerWindow` and `ttl` set to the window expiration time in Unix seconds
4. THE Handler SHALL await the DynamoDB update promise before returning the response to the client

### Requirement 7: Window Transition Handling

**User Story:** As a developer, I want the rate limiter to handle window transitions optimistically, so that clients receive fresh rate limit state immediately at window boundaries without blocking on DynamoDB.

#### Acceptance Criteria

1. WHEN a request arrives and the In_Memory_Cache contains an entry from a previous Rate_Limit_Window, THE Rate_Limiter SHALL return a fresh state with `remaining` set to `limitPerWindow` from the In_Memory_Cache
2. WHEN a window transition is detected, THE Rate_Limiter SHALL create or update the Sessions_Table entry for the new window in the background

### Requirement 8: DynamoDB Unavailability Fallback

**User Story:** As a developer, I want the rate limiter to fall back to in-memory-only rate limiting when DynamoDB is unreachable, so that legitimate requests are not blocked during outages.

#### Acceptance Criteria

1. IF a DynamoDB operation fails due to a network error or service unavailability, THEN THE Rate_Limiter SHALL fall back to in-memory-only rate limiting for the affected request
2. IF a DynamoDB operation fails, THEN THE Rate_Limiter SHALL log a warning message including the error details
3. WHILE DynamoDB is unavailable, THE Rate_Limiter SHALL continue to enforce per-instance rate limits using the In_Memory_Cache

### Requirement 9: Rate Limit Response Headers

**User Story:** As a developer, I want all API responses to include accurate rate limit headers, so that clients can monitor their usage and plan retries.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL include the `X-RateLimit-Limit` header set to the `limitPerWindow` value for the client's access tier
2. THE Rate_Limiter SHALL include the `X-RateLimit-Remaining` header set to the number of requests remaining in the current Rate_Limit_Window
3. THE Rate_Limiter SHALL include the `X-RateLimit-Reset` header set to the Unix timestamp (in seconds) of the next window reset
4. WHEN a client exceeds the rate limit, THE Rate_Limiter SHALL include the `Retry-After` header set to the number of seconds until the next window reset
5. WHEN a client exceeds the rate limit, THE Rate_Limiter SHALL return HTTP status code 429

### Requirement 10: Rate Limit Configuration from Settings

**User Story:** As a developer, I want rate limits configured per access tier in settings, so that different client types have appropriate request allowances.

#### Acceptance Criteria

1. THE Settings SHALL define `limitPerWindow` and `windowInMinutes` for each access tier: public, registered, paid, and private
2. THE Rate_Limiter SHALL read the rate limit configuration for the client's access tier from `Config.settings().rateLimits`
3. WHEN the `limitPerWindow` or `windowInMinutes` environment variables are set, THE Settings SHALL use the environment variable values instead of defaults

### Requirement 11: Hash Salt Retrieval from SSM Parameter Store

**User Story:** As a developer, I want the hash salt retrieved from SSM Parameter Store using the existing `CachedSsmParameter` pattern, so that the salt is securely managed and cached.

#### Acceptance Criteria

1. THE Config SHALL retrieve the Hash_Salt from SSM Parameter Store at the path `${PARAM_STORE_PATH}Mcp_SessionHashSalt` using a `CachedSsmParameter` instance
2. THE Config SHALL make the Hash_Salt available to the Rate_Limiter through the settings or configuration interface
3. IF the Hash_Salt cannot be retrieved from SSM Parameter Store, THEN THE Config SHALL log an error and THE Rate_Limiter SHALL fail closed (reject requests) until the salt is available

### Requirement 12: Unit Tests for Rate Limiter

**User Story:** As a developer, I want comprehensive Jest tests for the rate limiter, so that correctness is verified and regressions are prevented.

#### Acceptance Criteria

1. THE test suite SHALL verify that `checkRateLimit` returns valid numeric values for `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers
2. THE test suite SHALL verify that the Window_Calculator produces reset times aligned to clock boundaries for window sizes of 5, 60, 120, 240, and 1440 minutes
3. THE test suite SHALL verify that the In_Memory_Cache returns cached entries for known clients and triggers background DynamoDB sync
4. THE test suite SHALL verify that the DynamoDB atomic update correctly decrements the remaining count
5. THE test suite SHALL verify that the Rate_Limiter falls back to in-memory-only mode when DynamoDB operations fail
6. THE test suite SHALL verify that client identifiers are hashed with SHA-256 using the composite key (raw identifier + window start + salt) and that different windows produce different hashes for the same client
7. THE test suite SHALL be written in Jest and placed in the existing test directory structure
