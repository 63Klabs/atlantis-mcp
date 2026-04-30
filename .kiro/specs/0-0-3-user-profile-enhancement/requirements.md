# Requirements Document

## Introduction

This document defines the requirements for enhancing the user profile page of the Atlantis MCP Server. The current profile page displays tier information, rate limit configuration for the user's tier, and tier expiration date, but it does not display the user's email address, remaining requests in the current rate limit window, or when the window resets. Currently, the profile page relies on client-side Cognito data and has no server-side endpoint for consolidated profile information.

This feature introduces a new `GET /auth/profile` endpoint on the Auth Lambda that returns all profile data in a single API call — user email (server-confirmed from the Users Table), current tier, tier expiration, and real-time rate limit window statistics (remaining requests, window reset time) from the Sessions Table. The profile page is updated to call this endpoint and display the additional information.

## Glossary

- **Auth_Lambda**: The existing Lambda function that handles server-side authentication operations including API key regeneration, voucher redemption, and the Cognito Post-Confirmation trigger. This feature adds a new `GET /auth/profile` endpoint to the Auth_Lambda
- **Profile_Page**: The `/profile/` page on the Static_Site, accessible only to authenticated users, which displays tier information and provides key regeneration and voucher redemption features
- **Profile_Endpoint**: The new `GET /auth/profile` API Gateway endpoint on the Auth_Lambda that returns consolidated profile data for the authenticated user
- **Users_Table**: The existing DynamoDB table (`Prefix-ProjectId-StageId-Users`) storing user records keyed by HMAC-SHA256 hashed API keys, with a GSI on email
- **Sessions_Table**: The existing DynamoDB table used for per-client rate limit counters with TTL-based cleanup. Stores `remaining` requests and `limit` for the current window, keyed by a SHA-256 hash of `clientId + windowStart + salt`
- **Rate_Limit_Window**: The time period during which a user's request count is tracked. Window size varies by tier: 60 minutes for public and registered tiers, 1440 minutes (24 hours) for paid and private tiers
- **Window_Reset_Time**: The Unix timestamp (in seconds) at which the current Rate_Limit_Window expires and the request counter resets
- **Remaining_Requests**: The number of requests the authenticated user can still make within the current Rate_Limit_Window before receiving HTTP 429
- **Effective_Tier**: The tier computed at request time by the Read_Lambda, accounting for tier expiration — if `tierExpiresAt` has passed, the Effective_Tier is `registered` regardless of the stored tier
- **Static_Site**: The post-deploy generated documentation site hosted on S3, which includes registration, login, profile, and rate limits pages
- **Hash_Salt**: The `Mcp_ApiKeyHashSalt` SSM parameter used as the HMAC key for API key hashing
- **Session_Salt**: The `Mcp_SessionHashSalt` SSM parameter used for computing Sessions_Table partition keys
- **Cognito_JWT**: The JSON Web Token issued by the Cognito User Pool after user authentication, containing claims such as `sub`, `email`, and `custom:tier`

---

## Requirements

### Requirement 1: Profile Endpoint — API Gateway Configuration

**User Story:** As a developer, I want a `GET /auth/profile` endpoint defined in the CloudFormation template, so that the profile page can fetch consolidated user data from a single API call.

#### Acceptance Criteria

1. THE CloudFormation template SHALL define a `GET /auth/profile` API Gateway event on the Auth_Lambda, on the same WebApi as the existing `POST /auth/key/regenerate` and `POST /auth/voucher/redeem` endpoints
2. THE `GET /auth/profile` endpoint SHALL support CORS preflight requests by including the `GET` method in the `Access-Control-Allow-Methods` response header
3. THE Auth_Lambda route dispatcher SHALL route `GET /auth/profile` requests to a dedicated profile handler module

---

### Requirement 2: Profile Endpoint — JWT Authentication

**User Story:** As the Auth Lambda, I want to validate the Cognito JWT on profile requests, so that only authenticated users can retrieve their profile data.

#### Acceptance Criteria

1. WHEN a request to `GET /auth/profile` includes a valid Cognito_JWT in the `Authorization: Bearer <jwt>` header, THE Profile_Endpoint SHALL extract the `sub` (cognitoSub) and `email` claims from the validated token
2. IF the `Authorization` header is missing or the Cognito_JWT is invalid or expired, THEN THE Profile_Endpoint SHALL return HTTP 401 with a JSON error response `{"error": "Unauthorized"}`

---

### Requirement 3: Profile Endpoint — User Record Lookup

**User Story:** As the Auth Lambda, I want to look up the user record from the Users Table, so that I can return server-confirmed profile data including email, tier, and tier expiration.

#### Acceptance Criteria

1. WHEN the Cognito_JWT is valid, THE Profile_Endpoint SHALL query the Users_Table using the email-index GSI with the email from the JWT payload
2. WHEN a matching user record is found, THE Profile_Endpoint SHALL compute the Effective_Tier: if `tierExpiresAt` is set and has passed, the Effective_Tier SHALL be `registered`; if `tierExpiresAt` is null or in the future, the Effective_Tier SHALL be the stored `tier` value
3. IF no user record is found for the email, THEN THE Profile_Endpoint SHALL return HTTP 404 with a JSON error response `{"error": "User not found"}`

---

### Requirement 4: Profile Endpoint — Rate Limit Window Statistics

**User Story:** As a registered user, I want to see how many requests I have remaining and when my rate limit window resets, so that I can plan my MCP client usage accordingly.

#### Acceptance Criteria

1. WHEN the user record is found, THE Profile_Endpoint SHALL query the Sessions_Table to retrieve the current rate limit window record for the authenticated user's cognitoSub identity
2. THE Profile_Endpoint SHALL compute the Sessions_Table partition key using the same algorithm as the Read_Lambda rate limiter: SHA-256 hash of `cognitoSub + windowStart + sessionSalt`, where `windowStart` is the start of the current window based on the tier's `windowInMinutes` configuration
3. WHEN a matching session record exists, THE Profile_Endpoint SHALL return the `remaining` requests count and compute the Window_Reset_Time as `windowStart + windowInMinutes * 60` (Unix epoch seconds)
4. WHEN no session record exists for the current window (user has not made any MCP requests in this window), THE Profile_Endpoint SHALL return the full `limit` for the tier as the remaining count and compute the Window_Reset_Time based on the current window start
5. THE Profile_Endpoint SHALL retrieve the Session_Salt from SSM Parameter Store (with caching) to compute the session partition key

---

### Requirement 5: Profile Endpoint — Response Format

**User Story:** As a frontend developer, I want a well-structured JSON response from the profile endpoint, so that I can populate all profile page fields from a single API call.

#### Acceptance Criteria

1. WHEN the profile request succeeds, THE Profile_Endpoint SHALL return HTTP 200 with a JSON response body containing the following fields: `email` (string), `tier` (string, the Effective_Tier), `tierExpiresAt` (string ISO 8601 or null), `createdAt` (string ISO 8601), `rateLimits.limit` (number, max requests per window for the tier), `rateLimits.remaining` (number), `rateLimits.windowResetAt` (number, Unix epoch seconds), `rateLimits.windowMinutes` (number, window duration in minutes)
2. THE Profile_Endpoint SHALL return the response within the Auth_Lambda's existing 10-second timeout under normal operating conditions
3. IF an internal error occurs during profile data retrieval, THEN THE Profile_Endpoint SHALL log the full error for debugging and return HTTP 500 with a JSON error response `{"error": "Internal server error"}`

---

### Requirement 6: Auth Lambda — Sessions Table Read Permission

**User Story:** As a developer, I want the Auth Lambda to have read access to the Sessions Table, so that the profile endpoint can retrieve rate limit window statistics.

#### Acceptance Criteria

1. THE Auth_Lambda IAM role SHALL include `dynamodb:GetItem` permission on the Sessions_Table resource ARN
2. THE Auth_Lambda IAM role SHALL include `ssm:GetParameter` permission for the `Mcp_SessionHashSalt` parameter (if not already covered by the existing SSM wildcard)
3. THE Auth_Lambda SHALL receive the Sessions_Table name as an environment variable `SESSIONS_TABLE`
4. THE Auth_Lambda IAM role SHALL NOT include write permissions on the Sessions_Table

---

### Requirement 7: Auth Lambda — Rate Limit Configuration Access

**User Story:** As the Auth Lambda, I want access to the rate limit configuration, so that the profile endpoint can determine the correct window size and limit for the user's tier.

#### Acceptance Criteria

1. THE Profile_Endpoint SHALL read rate limit configuration from the same `settings.json` source used by the Read_Lambda, or receive equivalent configuration through environment variables or an SSM parameter
2. THE rate limit configuration SHALL include `limitPerWindow` and `windowInMinutes` for each tier: public, registered, paid, and private
3. WHEN the rate limit configuration is unavailable, THE Profile_Endpoint SHALL return HTTP 500 rather than returning incorrect or default values

---

### Requirement 8: Profile Page — Display User Email

**User Story:** As a registered user, I want to see my email address on the profile page, so that I can confirm which account I am logged into.

#### Acceptance Criteria

1. THE Profile_Page SHALL display the user's email address in a prominent position at the top of the profile section
2. THE Profile_Page SHALL use the email returned by the Profile_Endpoint response (server-confirmed) for display
3. THE Profile_Page SHALL display the email as read-only text (not an editable field)

---

### Requirement 9: Profile Page — Display Remaining Requests

**User Story:** As a registered user, I want to see how many requests I have remaining in my current rate limit window, so that I know how much capacity I have left.

#### Acceptance Criteria

1. THE Profile_Page SHALL display the number of remaining requests from the Profile_Endpoint response in the rate limits section
2. THE Profile_Page SHALL display the total limit for the user's tier alongside the remaining count (e.g., "42 of 100 remaining")
3. THE Profile_Page SHALL display the window reset time from the Profile_Endpoint response, formatted as a human-readable local date and time

---

### Requirement 10: Profile Page — Single API Call for Profile Data

**User Story:** As a frontend developer, I want the profile page to populate all data from a single API call, so that the page loads efficiently and the user experience is consistent.

#### Acceptance Criteria

1. WHEN the Profile_Page loads, THE Profile_Page SHALL make a single `GET /auth/profile` request with the Cognito_JWT in the Authorization header to retrieve all profile data
2. THE Profile_Page SHALL populate the email, tier, tier expiration, rate limit remaining, rate limit total, and window reset time from the single Profile_Endpoint response
3. WHILE the Profile_Endpoint request is in progress, THE Profile_Page SHALL display a loading indicator
4. IF the Profile_Endpoint returns HTTP 401, THEN THE Profile_Page SHALL redirect the user to the `/login/` page
5. IF the Profile_Endpoint returns an error other than 401, THEN THE Profile_Page SHALL display an appropriate error message and fall back to displaying Cognito JWT claims (email, tier) where available

---

### Requirement 11: Auth Lambda — CORS Headers for GET Endpoint

**User Story:** As a frontend developer, I want the profile endpoint to return proper CORS headers, so that the static site can call the endpoint from the browser.

#### Acceptance Criteria

1. THE Auth_Lambda SHALL include CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`) on all `GET /auth/profile` responses, matching the existing CORS pattern used by POST endpoints
2. THE `Access-Control-Allow-Methods` header SHALL include `GET` in addition to the existing `POST` and `OPTIONS` methods
3. THE Auth_Lambda index handler SHALL apply CORS headers to GET responses using the same `withCorsHeaders` utility used for POST responses
