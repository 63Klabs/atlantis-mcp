# Bugfix Requirements Document

## Introduction

GitHub security code scanning has flagged 4 issues across 2 production modules and 1 test file where API key hashing uses HMAC-SHA256 (`crypto.createHmac('sha256', salt)`) instead of a recognized password hashing algorithm. While HMAC-SHA256 with a salt is not trivially breakable for 32-character high-entropy API keys, it does not satisfy automated security scanners that expect a proper key-stretching algorithm (bcrypt, scrypt, PBKDF2, or Argon2). The fix replaces HMAC-SHA256 with `crypto.scryptSync()` (Node.js built-in) to produce a slow, deterministic hash suitable for credential storage, resolving all 4 security scanning alerts without introducing new dependencies.

**Affected production modules:**
- `application-infrastructure/src/lambda/auth/utils/api-key.js` — `hashApiKey()` function
- `application-infrastructure/src/lambda/read/utils/auth-resolver.js` — inline HMAC-SHA256 in `resolveAuth()`

**Affected test files:**
- `application-infrastructure/src/lambda/read/tests/property/auth-resolver.property.test.js` — Property 4 test uses `crypto.createHmac('sha256', salt)` directly

**Other consumers of `hashApiKey()` (no code changes needed, only behavioral change via updated utility):**
- `application-infrastructure/src/lambda/auth/handlers/post-confirmation.js` — calls `hashApiKey(rawKey, salt)` for new user registration
- `application-infrastructure/src/lambda/auth/services/key-regenerate.js` — calls `hashApiKey(rawKey, salt)` for key regeneration

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `hashApiKey(rawKey, salt)` is called in `api-key.js` THEN the system uses `crypto.createHmac('sha256', salt).update(rawKey).digest('hex')` which is flagged by GitHub security code scanning as an insufficient password hashing algorithm (scanning alert #5)

1.2 WHEN `resolveAuth(event)` hashes an API key in `auth-resolver.js` THEN the system uses an inline `crypto.createHmac('sha256', salt).update(rawKey).digest('hex')` call which is flagged by GitHub security code scanning as an insufficient password hashing algorithm (scanning alert #8)

1.3 WHEN the property test for header extraction consistency (Property 4) in `auth-resolver.property.test.js` hashes keys for verification THEN the test uses `crypto.createHmac('sha256', salt)` directly which is flagged by GitHub security code scanning (scanning alerts #6 and #7)

1.4 WHEN the HMAC-SHA256 hash is computed for any API key THEN the system produces a fast hash (millions of hashes per second) with no work factor or cost parameter, making brute-force attacks more feasible than with a proper key-stretching algorithm

### Expected Behavior (Correct)

2.1 WHEN `hashApiKey(rawKey, salt)` is called in `api-key.js` THEN the system SHALL use `crypto.scryptSync()` (or equivalent Node.js built-in password hashing function) to produce a deterministic, slow hash that satisfies GitHub security code scanning requirements

2.2 WHEN `resolveAuth(event)` hashes an API key in `auth-resolver.js` THEN the system SHALL import and call the shared `hashApiKey()` from `api-key.js` (or an equivalent shared utility) instead of using an inline HMAC-SHA256 call, ensuring a single hashing implementation across both lambdas

2.3 WHEN the property test for header extraction consistency (Property 4) in `auth-resolver.property.test.js` verifies hash consistency THEN the test SHALL use the shared `hashApiKey()` function (or `crypto.scryptSync()` directly) instead of `crypto.createHmac('sha256', salt)`, resolving the security scanning alerts on the test file

2.4 WHEN the scrypt-based hash is computed for any API key THEN the system SHALL use a cost parameter (N), block size (r), and parallelization (p) that provide meaningful brute-force resistance while remaining performant in AWS Lambda execution (target: single hash completes within ~50–200ms on Lambda)

2.5 WHEN the scrypt-based hash is computed for a given `(rawKey, salt)` pair THEN the system SHALL produce the same deterministic output every time, so that DynamoDB lookups using `KEY#<hash>` continue to work correctly

2.6 WHEN the hash output is stored in DynamoDB THEN the system SHALL produce a hex-encoded string compatible with the existing `KEY#<hash>` partition key format

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a request arrives with no API key header THEN the system SHALL CONTINUE TO return a public-tier result with `isAuthenticated: false` and the client's source IP as identity

3.2 WHEN a request arrives with a valid API key that exists in the Users table THEN the system SHALL CONTINUE TO return an authenticated result with the correct effective tier and `cognitoSub` as identity

3.3 WHEN a request arrives with an API key that does not match any record in the Users table THEN the system SHALL CONTINUE TO return HTTP 401 with a JSON-RPC error response (`code: -32001`)

3.4 WHEN SSM Parameter Store is unavailable for retrieving the hash salt THEN the system SHALL CONTINUE TO degrade gracefully to public tier with `degraded: true` rather than returning an error

3.5 WHEN DynamoDB is unavailable for the user lookup THEN the system SHALL CONTINUE TO degrade gracefully to public tier with `degraded: true` rather than returning an error

3.6 WHEN a new user registers via the Cognito Post-Confirmation trigger THEN the system SHALL CONTINUE TO generate an API key, hash it, store the hash in DynamoDB as `KEY#<hash>`, and update Cognito `custom:api_key` with the hash

3.7 WHEN a user regenerates their API key THEN the system SHALL CONTINUE TO generate a new key, hash it, delete the old key record, create a new key record with `KEY#<hash>`, and update Cognito `custom:api_key`

3.8 WHEN `generateApiKey()` is called THEN the system SHALL CONTINUE TO return a key in the format `atl_` followed by 32 random hex characters

3.9 WHEN a user's `tierExpiresAt` is in the past THEN the system SHALL CONTINUE TO compute the effective tier as `registered`

3.10 WHEN a free registered user's TTL is within 90 days of expiration THEN the system SHALL CONTINUE TO perform a background TTL refresh to now + 120 days
