# Requirements Document

## Introduction

This document defines the requirements for adding tiered authentication to the Atlantis MCP Server. The system currently supports only public (unauthenticated) access with IP-based rate limiting. This feature introduces four access tiers — public, registered, paid, and private — using Amazon Cognito for user management, static API keys for MCP client authentication, and a DynamoDB Users table for key-to-user lookups. The existing `POST /mcp/v1` endpoint remains unchanged; authentication is opt-in via an API key header.

Phase 1 covers the core authentication infrastructure, user registration, API key lifecycle, tier-aware rate limiting, voucher code redemption, and static site pages. Phase 2 covers scheduled cleanup, payment integration, admin dashboard, usage analytics, and API key scoping.

## Glossary

- **MCP_Server**: The Atlantis MCP Server application — the Read Lambda, API Gateway, and supporting infrastructure that serves MCP tool requests
- **Read_Lambda**: The existing Lambda function that handles all `POST /mcp/v1` requests, performs rate limiting, and routes to MCP tool controllers
- **Auth_Lambda**: A new Lambda function that handles server-side authentication operations including API key regeneration, voucher redemption, and the Cognito Post-Confirmation trigger
- **User_Pool**: The Amazon Cognito User Pool that manages user registration, email verification, login, and password policies
- **Users_Table**: A new DynamoDB table (`Prefix-ProjectId-StageId-Users`) storing user records keyed by HMAC-SHA256 hashed API keys, with a GSI on email
- **Sessions_Table**: The existing DynamoDB table used for per-client rate limit counters with TTL-based cleanup
- **API_Key**: A static key in the format `atl_` + 32 hex characters, used by MCP clients to authenticate requests via the `Authorization` or `X-API-Key` header
- **Effective_Tier**: The tier computed at request time by the Read_Lambda, accounting for tier expiration — if `tierExpiresAt` has passed, the Effective_Tier is `registered` regardless of the stored tier
- **Tier**: One of four access levels: `public` (unauthenticated, IP-based), `registered` (free authenticated), `paid` (paid authenticated), `private` (domain-based or admin-assigned)
- **Rate_Limiter**: The module within the Read_Lambda that enforces per-client request limits using DynamoDB atomic counters and an in-memory LRU cache
- **Static_Site**: The post-deploy generated documentation site hosted on S3, which includes registration, login, profile, and rate limits pages
- **Voucher_Record**: A DynamoDB item with pk `VOUCHER#<code>` that defines a promotion code's target tier, duration, max uses, and expiration
- **Hash_Salt**: The `Mcp_ApiKeyHashSalt` SSM parameter used as the HMAC key for API key hashing
- **Allowed_Domains**: The `Mcp_AllowedPrivateDomains` SSM parameter containing a comma-separated list of email domains eligible for automatic private tier promotion
- **Blocked_Domains**: The `Mcp_BlockedEmailDomains` SSM parameter containing a comma-separated list of email domains hard-blocked from registration
- **Allowed_Email_Domains**: The `Mcp_AllowedEmailDomains` SSM parameter containing a comma-separated list of email domains permitted for self-registration. When set to `BLANK`, all domains (except blocked) are allowed. When set to a list, only those domains can self-register
- **Blocked_Countries**: The `Mcp_BlockedCountries` SSM parameter containing a comma-separated list of ISO 3166-1 alpha-2 country codes blocked from self-registration. Does not affect public tier access or admin-added users
- **Allowed_Countries**: The `Mcp_AllowedCountries` SSM parameter containing a comma-separated list of ISO 3166-1 alpha-2 country codes permitted for self-registration. When set to `BLANK`, all countries (except blocked) are allowed to register. Does not affect public tier access or admin-added users

---

## Requirements

### PHASE 1

---

### Requirement 1: Cognito User Pool Provisioning

**User Story:** As an administrator, I want a Cognito User Pool provisioned per stage, so that user data is isolated between test, beta, and production environments.

#### Acceptance Criteria

1. THE CloudFormation template SHALL define an `AWS::Cognito::UserPool` resource named following the `Prefix-ProjectId-StageId` pattern
2. THE User_Pool SHALL require email as the username attribute
3. THE User_Pool SHALL enforce email verification before a user account is considered confirmed
4. THE User_Pool SHALL define custom attributes `custom:tier` (string) and `custom:api_key` (string, stores hash only)
5. THE User_Pool SHALL enforce a minimum password length of 8 characters requiring uppercase, lowercase, number, and special character
6. THE CloudFormation template SHALL define an `AWS::Cognito::UserPoolClient` resource for the Static_Site JavaScript SDK with no client secret
7. IF the User_Pool or User_Pool_Client fails to create, THEN THE CloudFormation stack SHALL roll back without leaving orphaned resources

---

### Requirement 2: DynamoDB Users Table

**User Story:** As a developer, I want a dedicated Users table for API key lookups, so that the Read_Lambda can resolve API keys to user tiers without calling Cognito.

#### Acceptance Criteria

1. THE CloudFormation template SHALL define a DynamoDB table named `Prefix-ProjectId-StageId-Users`
2. THE Users_Table SHALL use `pk` (string) as the partition key
3. THE Users_Table SHALL store user records with pk format `KEY#<hmac_sha256_hash>` containing fields: `email`, `tier`, `cognitoSub`, `createdAt`, and `tierExpiresAt`
4. THE Users_Table SHALL store voucher records with pk format `VOUCHER#<code>` containing fields: `targetTier`, `durationDays`, `maxUses`, `currentUses`, `expiresAt`, and `createdBy`
5. THE Users_Table SHALL have a Global Secondary Index on the `email` attribute for profile lookups
6. THE Users_Table SHALL use PAY_PER_REQUEST billing mode

---

### Requirement 3: SSM Parameter Creation

**User Story:** As an administrator, I want SSM parameters created automatically during build, so that the application has the configuration it needs without manual setup.

#### Acceptance Criteria

1. WHEN the pre_build phase runs, THE build script SHALL create an SSM parameter `Mcp_ApiKeyHashSalt` with an auto-generated 256-bit hex value if the parameter does not already exist
2. WHEN the pre_build phase runs, THE build script SHALL create an SSM parameter `Mcp_AllowedPrivateDomains` with value `BLANK` if the parameter does not already exist
3. WHEN the pre_build phase runs, THE build script SHALL create an SSM parameter `Mcp_BlockedEmailDomains` with value `BLANK` if the parameter does not already exist
4. WHEN the pre_build phase runs, THE build script SHALL create an SSM parameter `Mcp_AllowedEmailDomains` with value `BLANK` if the parameter does not already exist
5. WHEN the pre_build phase runs, THE build script SHALL create an SSM parameter `Mcp_BlockedCountries` with value `BLANK` if the parameter does not already exist
6. WHEN the pre_build phase runs, THE build script SHALL create an SSM parameter `Mcp_AllowedCountries` with value `BLANK` if the parameter does not already exist
7. THE build script SHALL use the existing `generate-put-ssm.py` script and SHALL NOT overwrite parameters that already exist

---

### Requirement 4: API Key Generation

**User Story:** As a registered user, I want an API key generated automatically after email verification, so that I can configure my MCP client immediately.

#### Acceptance Criteria

1. WHEN a user completes email verification, THE Auth_Lambda (Cognito Post-Confirmation trigger) SHALL generate an API key in the format `atl_` + 32 random hex characters
2. THE Auth_Lambda SHALL compute the HMAC-SHA256 hash of the API key using the `Mcp_ApiKeyHashSalt` from SSM as the HMAC key
3. THE Auth_Lambda SHALL store a record in the Users_Table with pk `KEY#<hmac_sha256_hash>`, the user's email, tier `registered`, cognitoSub, and createdAt timestamp
4. THE Auth_Lambda SHALL update the Cognito user attribute `custom:api_key` with the HMAC-SHA256 hash (not the raw key)
5. THE Auth_Lambda SHALL update the Cognito user attribute `custom:tier` to `registered`
6. THE Auth_Lambda SHALL return the raw API key to the calling context so the Static_Site can display it to the user exactly once
7. THE MCP_Server SHALL NOT store the raw API key in any persistent storage
8. FOR ALL valid API keys, hashing with HMAC-SHA256 using the same salt SHALL produce the same hash (deterministic round-trip property)

---

### Requirement 5: API Key Validation and Tier Resolution

**User Story:** As the MCP Server, I want to validate API keys and resolve user tiers on each request, so that authenticated users receive their correct rate limits.

#### Acceptance Criteria

1. WHEN a request to `POST /mcp/v1` includes an `Authorization: Bearer <key>` or `X-API-Key: <key>` header, THE Read_Lambda SHALL compute the HMAC-SHA256 hash of the provided key using the Hash_Salt
2. THE Read_Lambda SHALL look up the hashed key in the Users_Table using pk `KEY#<hmac_sha256_hash>`
3. WHEN the key hash matches a record in the Users_Table, THE Read_Lambda SHALL compute the Effective_Tier: if `tierExpiresAt` is set and has passed, the Effective_Tier SHALL be `registered`; otherwise the Effective_Tier SHALL be the stored `tier` value
4. IF the key hash does not match any record in the Users_Table, THEN THE Read_Lambda SHALL reject the request with HTTP 401 and a JSON-RPC error response
5. WHEN no API key header is present, THE Read_Lambda SHALL treat the request as `public` tier with IP-based rate limiting (preserving current behavior)
6. THE Read_Lambda SHALL use the user's cognitoSub (not IP address) as the rate limit identity for authenticated requests

---

### Requirement 6: Tier-Aware Rate Limiting

**User Story:** As the MCP Server, I want to apply tier-specific rate limits, so that each tier receives the correct request allowance.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL apply rate limits from `settings.rateLimits` based on the Effective_Tier: public (50/hr), registered (100/hr), paid (3000/day), private (6000/day)
2. WHEN the Effective_Tier is `public`, THE Rate_Limiter SHALL use the client IP address as the rate limit identity (current behavior)
3. WHEN the Effective_Tier is `registered`, `paid`, or `private`, THE Rate_Limiter SHALL use the user's cognitoSub as the rate limit identity
4. THE Rate_Limiter SHALL use the tier-specific `windowInMinutes` value for computing window boundaries
5. WHEN a rate limit is exceeded, THE Rate_Limiter SHALL return HTTP 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers
6. THE Rate_Limiter SHALL include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on all successful responses

---

### Requirement 7: Auth Lambda and API Gateway Endpoints

**User Story:** As a developer, I want an Auth Lambda with API Gateway endpoints, so that server-side authentication operations are handled securely.

#### Acceptance Criteria

1. THE CloudFormation template SHALL define an Auth_Lambda function with an IAM role following least-privilege principles
2. THE Auth_Lambda SHALL handle `POST /auth/key/regenerate` requiring a valid Cognito JWT in the Authorization header
3. THE Auth_Lambda SHALL handle `POST /auth/voucher/redeem` requiring a valid Cognito JWT in the Authorization header
4. THE Auth_Lambda SHALL be configured as a Cognito Post-Confirmation trigger on the User_Pool
5. THE Auth_Lambda endpoints SHALL be defined on the same API Gateway (`WebApi`) as the existing `POST /mcp/v1` endpoint
6. THE CloudFormation template SHALL define a CloudWatch Log Group for the Auth_Lambda with retention based on the deployment environment (shorter for TEST, longer for PROD)
7. THE Auth_Lambda IAM role SHALL have permissions for: DynamoDB read/write on Users_Table, SSM GetParameter for Hash_Salt and domain parameters, and Cognito AdminUpdateUserAttributes

---

### Requirement 8: API Key Regeneration

**User Story:** As a registered user, I want to regenerate my API key from the profile page, so that I can invalidate a compromised key.

#### Acceptance Criteria

1. WHEN a user sends `POST /auth/key/regenerate` with a valid Cognito JWT, THE Auth_Lambda SHALL generate a new API key in the format `atl_` + 32 random hex characters
2. THE Auth_Lambda SHALL delete the old key record from the Users_Table (old pk `KEY#<old_hash>`)
3. THE Auth_Lambda SHALL create a new record in the Users_Table with pk `KEY#<new_hash>` preserving the user's existing tier, email, cognitoSub, and tierExpiresAt
4. THE Auth_Lambda SHALL update the Cognito `custom:api_key` attribute with the new hash
5. THE Auth_Lambda SHALL return the new raw API key in the response body so the Static_Site can display it once
6. WHEN the old key is used after regeneration, THE Read_Lambda SHALL reject the request with HTTP 401
7. IF the JWT is invalid or expired, THEN THE Auth_Lambda SHALL return HTTP 401

---

### Requirement 9: Voucher Code Redemption

**User Story:** As a registered user, I want to redeem a voucher code to upgrade my tier, so that I can access higher rate limits.

#### Acceptance Criteria

1. WHEN a user sends `POST /auth/voucher/redeem` with a valid Cognito JWT and a voucher code, THE Auth_Lambda SHALL look up the voucher record at pk `VOUCHER#<code>` in the Users_Table
2. IF the voucher record does not exist, THEN THE Auth_Lambda SHALL return HTTP 400 with an error message
3. IF the voucher's `expiresAt` has passed, THEN THE Auth_Lambda SHALL return HTTP 400 indicating the voucher has expired
4. IF the voucher's `currentUses` equals `maxUses` (and maxUses is greater than 0), THEN THE Auth_Lambda SHALL return HTTP 400 indicating the voucher has been fully redeemed
5. WHEN the voucher is valid, THE Auth_Lambda SHALL update the user's tier to the voucher's `targetTier` and set `tierExpiresAt` to the current time plus `durationDays`
6. THE Auth_Lambda SHALL atomically increment the voucher's `currentUses` counter
7. THE Auth_Lambda SHALL update the Cognito `custom:tier` attribute to match the new tier
8. THE Auth_Lambda SHALL return the new tier and expiration date in the response body

---

### Requirement 10: Private Tier Domain-Based Auto-Promotion

**User Story:** As an administrator, I want users with matching email domains to be automatically promoted to private tier on registration, so that internal users get full access without manual intervention.

#### Acceptance Criteria

1. WHEN a user completes email verification, THE Auth_Lambda SHALL retrieve the `Mcp_AllowedEmailDomains`, `Mcp_AllowedPrivateDomains`, and `Mcp_BlockedEmailDomains` SSM parameters
2. IF the user's email domain appears in the Blocked_Domains list, THEN THE Auth_Lambda SHALL reject the registration and the user account SHALL NOT be created
3. IF the Allowed_Email_Domains value is NOT `BLANK` AND the user's email domain does NOT appear in the Allowed_Email_Domains list, THEN THE Auth_Lambda SHALL reject the registration and the user account SHALL NOT be created
4. IF the Allowed_Domains value is `BLANK`, THEN THE Auth_Lambda SHALL NOT auto-promote any user to private tier
5. IF the user's email domain appears in the Allowed_Domains list and does NOT appear in the Blocked_Domains list, THEN THE Auth_Lambda SHALL set the user's tier to `private` with `tierExpiresAt` set to `null`
6. IF the user's email domain does not appear in the Allowed_Domains list, THEN THE Auth_Lambda SHALL set the user's tier to `registered`

---

### Requirement 11: Registration Page

**User Story:** As a new user, I want to register on the static site with my email and password, so that I can receive an API key for MCP client configuration.

#### Acceptance Criteria

1. THE Static_Site SHALL include a `/register/` page with email and password input fields
2. THE registration page SHALL use the Cognito JavaScript SDK to call the User_Pool signup API directly from the browser
3. WHEN the user submits valid credentials, THE registration page SHALL display a message instructing the user to verify their email
4. WHEN email verification is complete, THE registration page SHALL display the generated API key with instructions to store it in a password manager
5. THE registration page SHALL display the API key exactly once and SHALL NOT provide a way to retrieve it later
6. IF registration fails due to an existing email, THEN THE registration page SHALL display an appropriate error message
7. IF registration fails due to a blocked email domain, THEN THE registration page SHALL display an appropriate error message
8. IF registration fails because the email domain is not in the allowed domains list, THEN THE registration page SHALL display an appropriate error message

---

### Requirement 12: Login Page

**User Story:** As a registered user, I want to log in on the static site, so that I can access my profile page.

#### Acceptance Criteria

1. THE Static_Site SHALL include a `/login/` page with email and password input fields
2. THE login page SHALL use the Cognito JavaScript SDK to authenticate the user directly from the browser
3. WHEN login succeeds, THE login page SHALL redirect the user to the `/profile/` page
4. IF login fails due to incorrect credentials, THEN THE login page SHALL display an appropriate error message
5. IF the user's email is not verified, THEN THE login page SHALL prompt the user to verify their email first

---

### Requirement 13: Profile Page

**User Story:** As a registered user, I want a profile page to view my tier information and manage my API key, so that I can monitor my access and rotate keys when needed.

#### Acceptance Criteria

1. THE Static_Site SHALL include a `/profile/` page accessible only to authenticated users
2. IF the user is not authenticated, THEN THE profile page SHALL redirect to the `/login/` page
3. THE profile page SHALL display the user's current tier, rate limits for that tier, and tier expiration date (if applicable)
4. THE profile page SHALL include a "Regenerate API Key" button that calls `POST /auth/key/regenerate` and displays the new key once
5. THE profile page SHALL include an "Enter Promotion Code" input field and submit button that calls `POST /auth/voucher/redeem`
6. WHEN a voucher is successfully redeemed, THE profile page SHALL display the new tier and expiration date
7. THE profile page SHALL display an external payment link placeholder for paid tier management (real link in a future phase)
8. THE profile page SHALL NOT display the current API key (it is not stored retrievably)
9. THE profile page SHALL NOT include a downgrade button

---

### Requirement 14: Manage Account Button

**User Story:** As a site visitor, I want a "Manage Account" button on the main page, so that I can easily navigate to my profile.

#### Acceptance Criteria

1. THE Static_Site SHALL include a "Manage Account" link or button in the footer area of `index.html`
2. THE "Manage Account" link SHALL navigate to the `/profile/` page

---

### Requirement 15: Central Rate Limits Documentation Page

**User Story:** As a user, I want a single page documenting all rate limits, so that I can understand the limits for each tier without searching across multiple documents.

#### Acceptance Criteria

1. THE Static_Site SHALL include a `/docs/rate-limits/` page listing rate limits for all four tiers in a table
2. THE rate limits page SHALL use token replacement from `settings.json` to display current limit values
3. THE rate limits page SHALL be the single source of truth for rate limit numbers — other documentation pages SHALL link to this page instead of listing specific numbers

---

### Requirement 16: Read Lambda IAM Updates

**User Story:** As a developer, I want the Read Lambda to have permission to read the Users table, so that it can validate API keys on each request.

#### Acceptance Criteria

1. THE Read_Lambda IAM role SHALL include `dynamodb:GetItem` permission on the Users_Table resource ARN
2. THE Read_Lambda IAM role SHALL include `ssm:GetParameter` permission for the `Mcp_ApiKeyHashSalt` parameter
3. THE Read_Lambda IAM role SHALL NOT include write permissions on the Users_Table

---

### Requirement 17: Admin CLI Operations

**User Story:** As an administrator, I want documented CLI commands for tier management and voucher creation, so that I can manage users without a UI.

#### Acceptance Criteria

1. THE documentation in `docs/admin-ops/` SHALL include a command to manually change a user's tier in the Users_Table and Cognito `custom:tier` attribute, with an optional `tierExpiresAt` parameter
2. THE documentation in `docs/admin-ops/` SHALL include a command to create a voucher record in the Users_Table with fields: code, targetTier, durationDays, maxUses (0 for unlimited), expiresAt, and createdBy
3. THE admin documentation SHALL include examples using AWS CLI commands
4. WHEN an admin sets a user to private tier, THE admin command SHALL allow setting `tierExpiresAt` to null (no expiration) or a specific date

---

### Requirement 18: Backward Compatibility

**User Story:** As an existing MCP client user, I want the current public access to remain unchanged, so that my existing configuration continues to work.

#### Acceptance Criteria

1. THE `POST /mcp/v1` endpoint path SHALL remain unchanged
2. WHEN no API key header is present, THE MCP_Server SHALL apply public tier rate limiting using IP-based identity (current behavior)
3. THE MCP_Server SHALL continue to return the same JSON-RPC 2.0 response format for all existing tool calls
4. THE existing rate limit behavior for unauthenticated requests SHALL be preserved with no changes to limits or window sizes

---

### Requirement 19: Country-Based Registration Restrictions

**User Story:** As an administrator, I want to restrict self-registration by country, so that I can limit free account creation to specific regions while leaving public access and admin-managed accounts unaffected.

#### Acceptance Criteria

1. THE Auth_Lambda (Post-Confirmation trigger) SHALL extract the country code from the `CloudFront-Viewer-Country` header passed through the Cognito trigger event context
2. IF `Mcp_BlockedCountries` is not `BLANK` AND the viewer country code appears in the Blocked_Countries list, THEN THE Auth_Lambda SHALL reject the registration and the user account SHALL NOT be created
3. IF `Mcp_AllowedCountries` is not `BLANK` AND the viewer country code does NOT appear in the Allowed_Countries list, THEN THE Auth_Lambda SHALL reject the registration and the user account SHALL NOT be created
4. IF `Mcp_AllowedCountries` is `BLANK`, THEN all countries (except those in Blocked_Countries) SHALL be allowed to register
5. IF the country code cannot be determined (header not present), THE Auth_Lambda SHALL allow the registration (do not block when country cannot be determined)
6. THE country check SHALL apply only to self-registration — it SHALL NOT affect public tier (unauthenticated) access, authenticated MCP requests, or admin-managed user accounts
7. Hard country-level blocking of all traffic (including public tier) is handled at the CloudFront distribution level, outside the scope of this application

---

### PHASE 2

---

### Requirement 19: Scheduled Tier Cleanup Lambda

**User Story:** As an administrator, I want expired tier records to be cleaned up automatically, so that the Users table reflects accurate tier assignments.

#### Acceptance Criteria

1. THE CloudFormation template SHALL define a scheduled Lambda triggered by EventBridge (daily in PROD, weekly in TEST)
2. WHEN the cleanup Lambda runs, THE Lambda SHALL scan the Users_Table for records where `tierExpiresAt` is set and has passed
3. FOR EACH expired record, THE cleanup Lambda SHALL update the `tier` field to `registered` and set `tierExpiresAt` to null
4. FOR EACH expired record, THE cleanup Lambda SHALL update the Cognito `custom:tier` attribute to `registered`

**UPDATE**: I prefer not to introduce additional functions for cleanup when we can devise a solution that uses built in DynamoDB ttl fields. If the read lambda accesses the Users Table and the tierExpiresAt has passed, treat it as a registered free user. Do not update the tierExpiresAt. When records are created, or a subscription hook updates the tierExpiresAt it should also update the ttl in DynamoDB for 120 days out. For free registered users we'll need to continually move the ttl back if the account is used. For free registered users, on initial auth check if the ttl is less than 90 days, update to 120 days out.
---

### Requirement 20: Payment Integration Hooks

**User Story:** As a developer, I want webhook endpoints for payment providers, so that paid tier promotions can be automated.

#### Acceptance Criteria

1. THE Auth_Lambda SHALL handle `POST /auth/webhook/payment` accepting webhook payloads from external payment providers (Stripe, PayPal)
2. WHEN a valid payment webhook is received, THE Auth_Lambda SHALL update the user's tier to `paid` and set `tierExpiresAt` based on the payment period
3. WHEN a subscription cancellation webhook is received, THE Auth_Lambda SHALL set `tierExpiresAt` to the end of the current billing period
4. THE Auth_Lambda SHALL verify webhook signatures to prevent spoofed requests

---

### Requirement 21: Self-Service Payment UI

**User Story:** As a registered user, I want to upgrade to paid tier through a payment form on the profile page, so that I can get higher rate limits without contacting an admin.

#### Acceptance Criteria

1. THE profile page SHALL include a payment section with links to supported payment providers
2. WHEN a payment is completed, THE profile page SHALL display the updated tier and expiration date
3. THE profile page SHALL display subscription management options for active paid users

---

### Requirement 22: Admin Dashboard

**User Story:** As an administrator, I want a dashboard to manage users and view system metrics, so that I can perform administrative tasks without CLI commands.

#### Acceptance Criteria

1. THE Static_Site SHALL include an `/admin/` page accessible only to users with private tier
2. THE admin dashboard SHALL display a list of users with their tiers, registration dates, and expiration dates
3. THE admin dashboard SHALL allow changing a user's tier and setting expiration dates
4. THE admin dashboard SHALL allow creating and managing voucher codes

**UPDATE** Remove this requirement. Admin is completely separate and private members are not admins. For now we will use CLI commands to create voucher codes, changing tiers, or setting expiration dates. Any complex commands should be put in /scripts/admin/ (root of project). Any CLI commands should be placed in the docs/admin-ops . An admin interface will be a separate stack in the future.

---

### Requirement 23: Usage Analytics Per User

**User Story:** As an administrator, I want to see per-user usage statistics, so that I can identify heavy users and optimize resource allocation.

#### Acceptance Criteria

1. THE MCP_Server SHALL record per-user request counts and tool usage in a DynamoDB table or CloudWatch metrics
2. THE admin dashboard SHALL display per-user usage statistics including total requests, requests by tool, and usage trends
3. THE analytics data SHALL be retained for a configurable period (default 90 days)

**UPDATE**: Adjust this requirement. You can provide any CLI commands or scripts (as listed in Requirement 22) for the admin to use. A CloudWatch dashboard is already included. We can add new metrics there, but they must be aggregate, not at the user level.

---

### Requirement 24: API Key Scoping

**User Story:** As an administrator, I want to restrict API keys to specific MCP tools, so that I can grant limited access to certain users.

#### Acceptance Criteria

1. THE Users_Table SHALL support an optional `allowedTools` field containing a list of permitted tool names
2. WHEN an API key has `allowedTools` set, THE Read_Lambda SHALL reject tool calls not in the allowed list with an appropriate error
3. WHEN `allowedTools` is not set or is empty, THE Read_Lambda SHALL allow access to all tools (default behavior)
4. THE admin CLI SHALL support setting `allowedTools` when creating or updating user records

**UPDATE** Remove this requirement. We are not scoping tools.