# Implementation Plan: Add Authentication (Phase 1)

## Overview

This plan implements tiered authentication for the Atlantis MCP Server. Tasks are ordered to build infrastructure first (CloudFormation, SSM), then core auth utilities, then the Auth Lambda, then Read Lambda integration, then static site pages, and finally admin documentation. Each task builds on previous steps with no orphaned code.

The implementation language is JavaScript (CommonJS/Node.js), matching the existing codebase.

## Tasks

- [ ] 1. CloudFormation infrastructure and SSM parameters
  - [x] 1.1 Add Cognito User Pool and User Pool Client resources to `template.yml`
    - Define `CognitoUserPool` (AWS::Cognito::UserPool) with email username, auto-verified email, custom attributes `custom:tier` and `custom:api_key`, password policy (8 chars, upper/lower/number/symbol)
    - Define `CognitoUserPoolClient` (AWS::Cognito::UserPoolClient) with no secret, SRP auth, ENABLED PreventUserExistenceErrors
    - Follow naming: `!Sub '${Prefix}-${ProjectId}-${StageId}-UserPool'` and `!Sub '${Prefix}-${ProjectId}-${StageId}-WebClient'`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.2 Add DynamoDB Users Table resource to `template.yml`
    - Define `UsersTable` (AWS::DynamoDB::Table) with `pk` (S) partition key, PAY_PER_REQUEST billing, email GSI (`email-index`), TTL on `ttl` attribute
    - Add DeletionPolicy: `!If [IsProduction, Retain, Delete]` and UpdateReplacePolicy: Retain
    - Follow naming: `!Sub '${Prefix}-${ProjectId}-${StageId}-Users'`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.3 Add Auth Lambda function, IAM role, log group, and API Gateway events to `template.yml`
    - Define `AuthLambdaFunction` (AWS::Serverless::Function) with `CodeUri: src/lambda/auth/`, `Handler: index.handler`, `Runtime: nodejs24.x`, Timeout 10, MemorySize 512
    - Define `AuthLambdaExecutionRole` with least-privilege: DynamoDB CRUD on Users Table + GSI, SSM GetParameter for auth params, Cognito AdminUpdateUserAttributes, CloudWatch Logs
    - Define CloudWatch Log Group with environment-based retention (shorter for TEST, longer for PROD)
    - Add API Gateway events: `POST /auth/key/regenerate` and `POST /auth/voucher/redeem` on existing `WebApi`
    - Configure a SAM `Cognito` event on `AuthLambdaFunction` with `Trigger: PostConfirmation` and `UserPool: !Ref CognitoUserPool` (avoids circular dependency vs LambdaConfig on UserPool)
    - Add Lambda invoke permission for Cognito (SAM handles this automatically via the Cognito event)
    - Environment variables: `USERS_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT` (Cognito User Pool ID retrieved from event payload or SSM at runtime)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 1.4 Update Read Lambda IAM role and environment variables in `template.yml`
    - Add `dynamodb:GetItem` and `dynamodb:UpdateItem` on Users Table ARN to `ReadLambdaExecutionRole`
    - Add environment variables `MCP_DYNAMODB_USERS_TABLE: !Ref UsersTable` and `COGNITO_USER_POOL_ID: !Ref CognitoUserPool` to Read Lambda
    - SSM GetParameter for `Mcp_ApiKeyHashSalt` already covered by existing wildcard
    - _Requirements: 16.1, 16.2_

  - [x] 1.5 Add SSM parameter creation commands to `buildspec.yml` pre_build phase
    - Add 6 `generate-put-ssm.py` calls: `Mcp_ApiKeyHashSalt` (--generate 256), `Mcp_AllowedPrivateDomains` (--value "BLANK"), `Mcp_BlockedEmailDomains` (--value "BLANK"), `Mcp_AllowedEmailDomains` (--value "BLANK"), `Mcp_BlockedCountries` (--value "BLANK"), `Mcp_AllowedCountries` (--value "BLANK")
    - Place after existing SSM parameter commands
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 2. Checkpoint — Validate CloudFormation template
  - Run `aws cloudformation validate-template` against the updated template. Ensure all tests pass, ask the user if questions arise.

- [x] 3. Auth Lambda core utilities
  - [x] 3.1 Create `src/lambda/auth/package.json` and directory structure
    - Create `src/lambda/auth/` with subdirectories: `handlers/`, `utils/`, `routes/`
    - Define `package.json` with name, version, main: `index.js`, no external dependencies (uses Node.js built-in `crypto` and AWS SDK v3 available in Lambda runtime)
    - _Requirements: 7.1_

  - [x] 3.2 Implement API key utility module (`src/lambda/auth/utils/api-key.js`)
    - `generateApiKey()`: returns `'atl_' + crypto.randomBytes(16).toString('hex')`
    - `hashApiKey(rawKey, salt)`: returns `crypto.createHmac('sha256', salt).update(rawKey).digest('hex')`
    - Export via `module.exports`, include TestHarness for private internals
    - Uses Node.js built-in `crypto` only — no external dependencies
    - _Requirements: 4.1, 4.2, 4.7, 4.8_

  - [x] 3.3 Write property tests for API key module
    - **Property 1: API key generation format** — For any invocation, key matches `/^atl_[0-9a-f]{32}$/`
    - **Property 2: HMAC-SHA256 hash determinism** — Same key + salt → same hash; different keys → different hashes
    - **Property 3: Raw API key is never persisted** — Hash output ≠ raw key input
    - File: `src/lambda/auth/tests/property/api-key.property.test.js`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 4.1, 4.2, 4.7, 4.8, 8.1**

  - [x] 3.4 Implement DynamoDB client utility (`src/lambda/auth/utils/dynamo-client.js`)
    - Functions: `getUserByKeyHash(hash)`, `putUserRecord(record)`, `deleteUserRecord(pk)`, `queryByEmail(email)`, `getVoucher(code)`, `incrementVoucherUses(code)`, `updateUserTier(pk, tier, tierExpiresAt, ttl)`
    - Use AWS SDK v3 DynamoDB DocumentClient
    - Table name from `process.env.USERS_TABLE`
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 3.5 Implement JWT validator utility (`src/lambda/auth/utils/jwt-validator.js`)
    - Validate Cognito JWT from `Authorization: Bearer <jwt>` header
    - Fetch and cache JWKS from Cognito endpoint (`https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`)
    - Verify token signature, expiration, issuer, and token_use
    - Return decoded token payload or throw 401 error
    - _Requirements: 7.2, 7.3, 8.7_

  - [x] 3.6 Write unit tests for JWT validator
    - Test valid token verification, expired token rejection, malformed token rejection, missing Authorization header
    - Mock JWKS endpoint responses
    - File: `src/lambda/auth/tests/unit/jwt-validator.test.js`
    - _Requirements: 7.2, 7.3, 8.7_

- [x] 4. Auth Lambda handlers
  - [x] 4.1 Implement Post-Confirmation handler (`src/lambda/auth/handlers/post-confirmation.js`)
    - Extract email from Cognito trigger event
    - Check `Mcp_BlockedEmailDomains` — reject if domain is blocked
    - Check `Mcp_AllowedEmailDomains` — reject if not BLANK and domain not in list
    - Check `Mcp_BlockedCountries` and `Mcp_AllowedCountries` from `CloudFront-Viewer-Country` header — reject if blocked/not allowed; allow if header absent
    - Check `Mcp_AllowedPrivateDomains` — set tier to `private` (tierExpiresAt=null) if domain matches, else `registered`
    - Generate API key, hash it, store in Users Table (pk=`KEY#<hash>`, email, tier, cognitoSub, createdAt, ttl=now+120d)
    - Update Cognito `custom:api_key` (hash) and `custom:tier` via AdminUpdateUserAttributes
    - Return raw key in response context for display
    - Use CachedSsmParameter pattern for SSM parameters
    - _Requirements: 4.1–4.8, 10.1–10.6, 19.1–19.7_

  - [x] 4.2 Write property tests for domain assignment and country restrictions
    - **Property 13: Domain-based tier assignment and registration gating** — Blocked domains → reject; allowed domains filter; private domain match → private tier; else → registered
    - **Property 16: Country-based registration restrictions** — Blocked countries → reject; allowed countries filter; absent header → allow
    - File: `src/lambda/auth/tests/property/domain-assignment.property.test.js`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 10.2, 10.4, 10.5, 19.1–19.7**

  - [x] 4.3 Write unit tests for Post-Confirmation handler
    - Test happy path (registered tier), private domain auto-promotion, blocked domain rejection, allowed email domain filtering, country blocking, country allowing, absent country header
    - Mock DynamoDB, SSM, Cognito SDK calls
    - File: `src/lambda/auth/tests/unit/post-confirmation.test.js`
    - _Requirements: 4.1–4.8, 10.1–10.6, 19.1–19.7_

  - [x] 4.4 Implement key regeneration handler (`src/lambda/auth/handlers/key-regenerate.js`)
    - Validate JWT from Authorization header
    - Look up existing user record by email (GSI query)
    - Generate new API key, hash it
    - Delete old key record, create new key record preserving email, tier, cognitoSub, tierExpiresAt
    - Update Cognito `custom:api_key` with new hash
    - Return new raw key in response
    - _Requirements: 8.1–8.7_

  - [x] 4.5 Write property test for key regeneration
    - **Property 10: Key regeneration preserves user fields** — New record preserves email, tier, cognitoSub, tierExpiresAt; only pk and createdAt differ
    - File: `src/lambda/read/tests/property/key-regeneration.property.test.js`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 8.3**

  - [x] 4.6 Write unit tests for key regeneration handler
    - Test happy path, invalid JWT rejection, user not found
    - Mock DynamoDB, SSM, Cognito SDK calls
    - File: `src/lambda/auth/tests/unit/key-regenerate.test.js`
    - _Requirements: 8.1–8.7_

  - [x] 4.7 Implement voucher redemption handler (`src/lambda/auth/handlers/voucher-redeem.js`)
    - Validate JWT from Authorization header
    - Look up voucher record at `VOUCHER#<code>`
    - Validate: exists, not expired, uses remaining (maxUses=0 means unlimited)
    - Update user tier to voucher's `targetTier`, set `tierExpiresAt` to now + durationDays, update ttl to now+120d
    - Atomically increment voucher `currentUses`
    - Update Cognito `custom:tier`
    - Return new tier and expiration in response
    - _Requirements: 9.1–9.8_

  - [x] 4.8 Write property tests for voucher validation
    - **Property 11: Invalid voucher rejection** — Expired voucher → 400; fully redeemed → 400; non-existent → 400
    - **Property 12: Valid voucher tier update** — Valid voucher → user tier updated to targetTier, tierExpiresAt = now + durationDays
    - File: `src/lambda/auth/tests/property/voucher-validation.property.test.js`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5**

  - [x] 4.9 Write unit tests for voucher redemption handler
    - Test happy path, voucher not found, expired voucher, fully redeemed voucher, unlimited uses voucher
    - Mock DynamoDB, SSM, Cognito SDK calls
    - File: `src/lambda/auth/tests/unit/voucher-redeem.test.js`
    - _Requirements: 9.1–9.8_

- [x] 5. Auth Lambda entry point and routing
  - [x] 5.1 Implement Auth Lambda entry point (`src/lambda/auth/index.js`)
    - Detect event type: Cognito trigger (`event.triggerSource === 'PostConfirmation_ConfirmSignUp'`) vs API Gateway proxy (`event.httpMethod && event.path`)
    - Route Cognito triggers to `handlers/post-confirmation.js`
    - Route API Gateway events to `routes/index.js`
    - Error handling: log full errors, return sanitized responses
    - _Requirements: 7.1, 7.4_

  - [x] 5.2 Implement Auth Lambda route dispatcher (`src/lambda/auth/routes/index.js`)
    - Route `POST /auth/key/regenerate` to `handlers/key-regenerate.js`
    - Route `POST /auth/voucher/redeem` to `handlers/voucher-redeem.js`
    - Return 404 for unknown paths
    - _Requirements: 7.2, 7.3_

- [x] 6. Checkpoint — Auth Lambda tests pass
  - Ensure all Auth Lambda tests pass, ask the user if questions arise.

- [x] 7. Read Lambda auth integration
  - [x] 7.1 Implement auth resolver module (`src/lambda/read/utils/auth-resolver.js`)
    - `resolveAuth(event)` function: extract API key from `Authorization: Bearer <key>` or `X-API-Key: <key>` header
    - No key → return `{ tier: 'public', identity: sourceIp, isAuthenticated: false, degraded: false }`
    - Key present → HMAC-SHA256 hash using `Mcp_ApiKeyHashSalt` (CachedSsmParameter) → DynamoDB GetItem on Users Table
    - Hash salt or Users table unavailable → fall back to public with `degraded: true`, log error
    - Key not found in Users table → return 401 error response (NOT degradation)
    - Compute effectiveTier: if `tierExpiresAt` is set and past → `registered`; else stored tier
    - If free registered user and `ttl < now + 90 days` → background UpdateItem to set `ttl = now + 120 days`
    - Return `{ tier, identity: cognitoSub, isAuthenticated: true, userId, degraded: false }`
    - Include TestHarness for testing private internals
    - _Requirements: 5.1–5.6, 16.1, 16.2, 18.1–18.4, R19 UPDATE (TTL refresh)_

  - [x] 7.2 Write property tests for auth resolver
    - **Property 4: Header extraction consistency** — Same key in `Authorization: Bearer` or `X-API-Key` → same hash
    - **Property 5: Effective tier computation** — tierExpiresAt null → stored tier; future → stored tier; past → registered
    - **Property 6: Invalid key rejection** — Key hash not in Users table → 401
    - **Property 7: Authenticated identity uses cognitoSub** — Authenticated → cognitoSub as identity; unauthenticated → IP as identity
    - File: `src/lambda/read/tests/property/auth-resolver.property.test.js`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 5.1, 5.3, 5.4, 5.6, 6.2, 6.3**

  - [x] 7.3 Write property tests for TTL refresh and user record format
    - **Property 14: User record format invariant** — pk starts with `KEY#` + 64 hex chars; non-null email, tier, cognitoSub, createdAt, ttl
    - **Property 15: TTL refresh for free registered users** — ttl < 90 days from now → update to now+120d; ttl ≥ 90 days → no update
    - File: `src/lambda/read/tests/property/ttl-refresh.property.test.js`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 2.3, R19 UPDATE**

  - [x] 7.4 Write unit tests for auth resolver
    - Test: no key (public), valid key (authenticated), invalid key (401), degraded mode (SSM failure), degraded mode (DynamoDB failure), expired tier, TTL refresh trigger, TTL no-refresh
    - Mock DynamoDB, SSM calls
    - File: `src/lambda/read/tests/unit/utils/auth-resolver.test.js`
    - _Requirements: 5.1–5.6, 18.1–18.4_

  - [x] 7.5 Modify rate limiter to accept auth info (`src/lambda/read/utils/rate-limiter.js`)
    - Change `checkRateLimit(event, limits)` signature to `checkRateLimit(event, limits, authInfo)`
    - Use `authInfo.tier` to select rate limit config (public/registered/paid/private)
    - Use `authInfo.identity` as the rate limit key (IP for public, cognitoSub for authenticated)
    - Default to public behavior when `authInfo` is undefined (backward compatibility)
    - _Requirements: 6.1–6.6, 18.1–18.4_

  - [x] 7.6 Write property tests for tier-aware rate limiting
    - **Property 8: Tier-to-rate-limit configuration mapping** — Each tier selects correct limitPerWindow and windowInMinutes from settings
    - **Property 9: Rate limit headers presence** — All responses include X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset; 429 responses include Retry-After
    - File: `src/lambda/read/tests/property/tier-rate-limiting.property.test.js`
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 6.1, 6.4, 6.5, 6.6**

  - [x] 7.7 Integrate auth resolver into Read Lambda handler (`src/lambda/read/index.js`)
    - Import AuthResolver module
    - Call `resolveAuth(event)` before rate limit check
    - If auth returns 401 error, return immediately with JSON-RPC error response
    - Pass `authInfo` to `checkRateLimit(event, limits, authInfo)`
    - Add `X-MCP-Auth-Status: degraded` header when `authInfo.degraded === true`
    - _Requirements: 5.1–5.6, 6.1–6.6, 18.1–18.4_

- [x] 8. Checkpoint — Read Lambda tests pass
  - Ensure all existing and new Read Lambda tests pass. Verify backward compatibility: public tier behavior unchanged. Ask the user if questions arise.

- [x] 9. Static site pages
  - [x] 9.1 Create registration page (`/register/`)
    - HTML page with email + password form
    - Client-side Cognito SDK (`amazon-cognito-identity-js`) for signUp and confirmSignUp
    - After email verification, display raw API key once with instructions to store in password manager
    - Error handling: existing email, blocked domain, disallowed domain
    - Token replacement for Cognito User Pool ID and Client ID from `settings.json`
    - _Requirements: 11.1–11.8_

  - [x] 9.2 Create login page (`/login/`)
    - HTML page with email + password form
    - Client-side Cognito SDK for authenticateUser
    - On success, redirect to `/profile/`
    - Error handling: incorrect credentials, unverified email
    - _Requirements: 12.1–12.5_

  - [x] 9.3 Create profile page (`/profile/`)
    - Requires authentication (redirect to `/login/` if not)
    - Display: current tier, rate limits for tier, tier expiration date
    - "Regenerate API Key" button → `POST /auth/key/regenerate` with JWT → display new key once
    - "Enter Promotion Code" input → `POST /auth/voucher/redeem` with JWT → display new tier/expiration
    - External payment link placeholder
    - Does NOT display current API key or include downgrade button
    - _Requirements: 13.1–13.9_

  - [x] 9.4 Create rate limits documentation page (`/docs/rate-limits/`)
    - Table listing all four tiers with rate limits
    - Values injected via token replacement from `settings.json` during post-deploy
    - Single source of truth for rate limit numbers
    - _Requirements: 15.1–15.3_

  - [x] 9.5 Add "Manage Account" button to `index.html`
    - Add link/button in footer area linking to `/profile/`
    - _Requirements: 14.1, 14.2_

  - [x] 9.6 Update post-deploy scripts for auth page generation
    - Update `settings-loader.js` to include Cognito User Pool ID, Client ID, and API Gateway URL in settings
    - Update `04-consolidate-and-deploy.sh` to include new auth pages in S3 sync
    - Ensure token replacement works for Cognito config values in static pages
    - _Requirements: 11.2, 15.2_

- [x] 10. Checkpoint — Static site pages complete
  - Verify all static pages render correctly with token replacement. Ensure all tests pass, ask the user if questions arise.

- [x] 11. Admin CLI documentation
  - [x] 11.1 Create admin operations documentation (`docs/admin-ops/`)
    - Document: change user tier (DynamoDB update + Cognito AdminUpdateUserAttributes) with optional tierExpiresAt
    - Document: create voucher record (DynamoDB PutItem with VOUCHER# pk, targetTier, durationDays, maxUses, expiresAt, createdBy)
    - Include AWS CLI command examples for both operations
    - Document: query user by email via GSI
    - _Requirements: 17.1–17.4_

- [x] 12. Auth Lambda build integration
  - [x] 12.1 Update `buildspec.yml` to build and test Auth Lambda
    - Add Auth Lambda dependency installation step in pre_build (similar to Read Lambda and Indexer patterns)
    - Add Auth Lambda production build step: `cd src/lambda/auth && npm install --omit=dev && npm audit fix --force --omit=dev && npm audit --audit-level=high`
    - Ensure Auth Lambda tests are included in the test run
    - _Requirements: 7.1_

- [x] 13. Final checkpoint — Full test suite passes
  - Run all tests across Auth Lambda and Read Lambda. Verify backward compatibility for unauthenticated requests. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (16 properties across 8 test files)
- Unit tests validate specific examples and edge cases
- Phase 2 tasks (TTL cleanup Lambda, payment webhooks, payment UI, aggregate metrics, admin scripts) are deferred to a future spec
- The existing rate limiter already has a TestHarness pattern — new modules should follow the same pattern
- All new tests use Jest (`.test.js` files) per project convention
- CommonJS (`require`/`module.exports`) throughout, matching existing codebase
