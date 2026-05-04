# Key Hashing for Auth Bugfix Design

## Overview

GitHub security code scanning has flagged 4 instances of HMAC-SHA256 usage for API key hashing across 2 production modules and 1 test file. While HMAC-SHA256 with a salt is not trivially breakable for high-entropy 32-character API keys, it does not satisfy automated security scanners that expect a key-stretching algorithm. The fix replaces all `crypto.createHmac('sha256', salt)` calls with `crypto.scryptSync()` — a Node.js built-in password hashing function that provides configurable cost parameters for brute-force resistance. The fix also consolidates the inline hashing in `auth-resolver.js` into a shared utility import, eliminating code duplication.

## Glossary

- **Bug_Condition (C)**: Any code path that uses `crypto.createHmac('sha256', salt)` to hash an API key — this triggers GitHub security scanning alerts
- **Property (P)**: The hashing function uses `crypto.scryptSync()` with appropriate cost parameters, producing a deterministic hex-encoded hash suitable for DynamoDB `KEY#<hash>` lookups
- **Preservation**: All existing authentication behaviors (public tier fallback, 401 for invalid keys, graceful degradation, key generation format, tier computation, TTL refresh) must remain unchanged
- **hashApiKey(rawKey, salt)**: The shared utility function in `auth/utils/api-key.js` that hashes a raw API key with a salt for storage and lookup
- **resolveAuth(event)**: The function in `read/utils/auth-resolver.js` that extracts an API key from request headers, hashes it, and performs a DynamoDB lookup to resolve authentication
- **scryptSync(password, salt, keyLength, options)**: Node.js built-in key derivation function that produces a slow, deterministic hash with configurable cost parameters (N, r, p)
- **N (cost)**: The CPU/memory cost parameter for scrypt — higher values increase computation time exponentially (must be a power of 2)
- **r (blockSize)**: The block size parameter for scrypt — increases memory usage linearly
- **p (parallelization)**: The parallelization parameter for scrypt — increases computation time linearly

## Bug Details

### Bug Condition

The bug manifests when any code path hashes an API key using `crypto.createHmac('sha256', salt)`. GitHub security code scanning identifies this as an insufficient password hashing algorithm (CWE-916) because HMAC-SHA256 is a fast hash with no work factor, making brute-force attacks more feasible than with a proper key-stretching algorithm. The scanning has flagged 4 specific locations across 3 files.

**Formal Specification:**
```
FUNCTION isBugCondition(codeLocation)
  INPUT: codeLocation of type { file: string, line: number, expression: string }
  OUTPUT: boolean

  RETURN codeLocation.expression MATCHES /crypto\.createHmac\(['"]sha256['"]/
         AND codeLocation.file IN [
           'auth/utils/api-key.js',
           'read/utils/auth-resolver.js',
           'read/tests/property/auth-resolver.property.test.js'
         ]
END FUNCTION
```

### Examples

- **api-key.js line 49**: `crypto.createHmac('sha256', salt).update(rawKey).digest('hex')` — GitHub alert #5. Expected: use `crypto.scryptSync(rawKey, salt, 32).toString('hex')` instead
- **auth-resolver.js line 285**: `crypto.createHmac('sha256', salt).update(rawKey).digest('hex')` — GitHub alert #8. Expected: import and call `hashApiKey(rawKey, salt)` from a shared utility
- **auth-resolver.property.test.js line 100-101**: `crypto.createHmac('sha256', salt).update(fromBearer).digest('hex')` and `crypto.createHmac('sha256', salt).update(fromApiKey).digest('hex')` — GitHub alerts #6 and #7. Expected: use `hashApiKey()` or `crypto.scryptSync()` directly
- **Edge case**: A key like `atl_0000000000000000000000000000000` (low entropy) should still produce a slow hash with scrypt, unlike HMAC-SHA256 which would compute in microseconds

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Requests with no API key header must continue to return public-tier result with `isAuthenticated: false` and the client's source IP as identity
- Requests with a valid API key that exists in the Users table must continue to return an authenticated result with the correct effective tier and `cognitoSub` as identity
- Requests with an API key that does not match any record must continue to return HTTP 401 with a JSON-RPC error response (`code: -32001`)
- SSM Parameter Store unavailability must continue to degrade gracefully to public tier with `degraded: true`
- DynamoDB unavailability must continue to degrade gracefully to public tier with `degraded: true`
- Post-confirmation trigger must continue to generate an API key, hash it, store the hash in DynamoDB as `KEY#<hash>`, and update Cognito `custom:api_key`
- Key regeneration must continue to generate a new key, hash it, delete the old key record, create a new key record with `KEY#<hash>`, and update Cognito
- `generateApiKey()` must continue to return a key in the format `atl_` followed by 32 random hex characters
- Expired `tierExpiresAt` must continue to compute the effective tier as `registered`
- Free registered user TTL refresh within 90 days of expiration must continue to refresh to now + 120 days

**Scope:**
All inputs and code paths that do NOT involve API key hashing should be completely unaffected by this fix. This includes:
- Header extraction logic (`extractApiKey`)
- Tier computation logic (`computeEffectiveTier`)
- TTL refresh logic (`refreshTtl`)
- Source IP extraction logic (`extractSourceIp`)
- API key generation logic (`generateApiKey`)
- DynamoDB record structure and query patterns
- Cognito attribute updates
- Error response formatting

## Hypothesized Root Cause

Based on the bug description, the root cause is straightforward:

1. **Insufficient Hashing Algorithm**: The original implementation chose HMAC-SHA256 for API key hashing. While HMAC-SHA256 with a salt is cryptographically sound for message authentication, it is a fast hash (millions of operations per second) with no configurable work factor. Security scanners classify this as CWE-916 (Use of Password Hash With Insufficient Computational Effort) because it does not provide the brute-force resistance expected of credential storage.

2. **Code Duplication**: The hashing logic was duplicated inline in `auth-resolver.js` rather than importing the shared `hashApiKey()` utility from `auth/utils/api-key.js`. This means the fix must be applied in two production locations instead of one, and the duplication itself is a maintenance risk.

3. **Test Code Using Production Patterns**: The property test for header extraction consistency (`auth-resolver.property.test.js`, Property 4) directly uses `crypto.createHmac('sha256', salt)` to verify hash consistency, which also triggers the security scanner.

4. **Pre-production Timing**: The auth feature was added in v0.0.3 (released 2026-05-03), making this very recent. No migration of existing hashed keys in DynamoDB is needed — all existing keys can be re-hashed during the next user interaction, or since this is pre-production, the small number of test users can simply regenerate their keys.

## Correctness Properties

Property 1: Bug Condition - Scrypt Replaces HMAC-SHA256

_For any_ `(rawKey, salt)` pair where `hashApiKey(rawKey, salt)` is called, the fixed function SHALL use `crypto.scryptSync()` to produce the hash, and the output SHALL differ from what `crypto.createHmac('sha256', salt).update(rawKey).digest('hex')` would produce for the same inputs.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Hash Determinism and Format

_For any_ `(rawKey, salt)` pair, the fixed `hashApiKey(rawKey, salt)` SHALL produce the same deterministic output on every invocation, and the output SHALL be a 64-character lowercase hex string compatible with the `KEY#<hash>` DynamoDB partition key format.

**Validates: Requirements 2.5, 2.6, 3.6, 3.7**

Property 3: Preservation - Authentication Flow Unchanged

_For any_ API Gateway event, the fixed `resolveAuth(event)` SHALL produce the same authentication outcome (public tier, authenticated result, or 401 error) as the original function, differing only in the internal hash value used for DynamoDB lookup.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `application-infrastructure/src/lambda/auth/utils/api-key.js`

**Function**: `hashApiKey(rawKey, salt)`

**Specific Changes**:
1. **Replace HMAC-SHA256 with scryptSync**: Change the function body from `crypto.createHmac('sha256', salt).update(rawKey).digest('hex')` to `crypto.scryptSync(rawKey, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')`
2. **Update JSDoc**: Update the function documentation to reflect scrypt usage, parameters, and the new performance characteristics
3. **Update module-level JSDoc**: Update the module description from "HMAC-SHA256 hashes" to "scrypt hashes"

**Scrypt Parameter Selection**:
- **N = 16384 (2^14)**: Provides meaningful brute-force resistance while keeping single-hash computation within ~50-100ms on Lambda. N=16384 is the commonly recommended minimum for interactive logins.
- **r = 8**: Standard block size, provides good memory-hardness
- **p = 1**: Single-threaded — Lambda functions are single-core, so parallelization provides no benefit
- **keyLength = 32**: Produces 32 bytes = 64 hex characters, matching the current HMAC-SHA256 output length exactly. This preserves compatibility with the `KEY#<hash>` format.

---

**File**: `application-infrastructure/src/lambda/read/utils/auth-resolver.js`

**Function**: `resolveAuth(event)` (inline hashing at ~line 285)

**Specific Changes**:
1. **Replace inline HMAC-SHA256 with scryptSync call**: Replace `crypto.createHmac('sha256', salt).update(rawKey).digest('hex')` with `crypto.scryptSync(rawKey, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')`. Since the auth and read lambdas are separate packages with separate `node_modules`, importing from the auth lambda is not feasible. Instead, replicate the same scryptSync call inline (matching the pattern already established in the codebase where this was an inline HMAC call).
2. **Update JSDoc**: Update function and module documentation to reflect scrypt usage
3. **Remove unused crypto.createHmac references**: Clean up any HMAC-specific comments

---

**File**: `application-infrastructure/src/lambda/read/tests/property/auth-resolver.property.test.js`

**Function**: Property 4 test — "same key from either header produces the same HMAC-SHA256 hash"

**Specific Changes**:
1. **Replace crypto.createHmac with crypto.scryptSync**: In the second `it` block of Property 4, replace `crypto.createHmac('sha256', salt).update(fromBearer).digest('hex')` and `crypto.createHmac('sha256', salt).update(fromApiKey).digest('hex')` with `crypto.scryptSync(fromBearer, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')` and the equivalent for `fromApiKey`
2. **Update test description**: Change "same HMAC-SHA256 hash" to "same scrypt hash"
3. **Update test file header comments**: Remove HMAC-SHA256 references

---

**File**: `application-infrastructure/src/lambda/auth/tests/property/api-key.property.test.js`

**Function**: Property 2 — "HMAC-SHA256 hash determinism"

**Specific Changes**:
1. **Update describe block name**: Change "Property 2: HMAC-SHA256 hash determinism" to "Property 2: scrypt hash determinism"
2. **Update hash length assertion**: The hash output will remain 64 hex characters (32 bytes), so the existing assertions (`toHaveLength(64)`, `toMatch(/^[0-9a-f]{64}$/)`) remain valid
3. **No logic changes needed**: The tests call `hashApiKey()` which will automatically use the new implementation

### Code Sharing Strategy Decision

The auth lambda and read lambda are **separate packages** with independent `node_modules` directories. The current pattern in the codebase is that `auth-resolver.js` has an inline copy of the hashing logic. The simplest and most consistent approach is to maintain this pattern:

- **auth/utils/api-key.js**: Contains the canonical `hashApiKey()` with scryptSync
- **read/utils/auth-resolver.js**: Contains an inline scryptSync call with identical parameters

This avoids introducing cross-lambda imports, shared utility packages, or architectural changes beyond the scope of this bugfix. A comment in `auth-resolver.js` should reference `api-key.js` as the canonical implementation to keep them in sync.

### Migration Strategy Decision

Since the auth feature was added in v0.0.3 (released 2026-05-03) and this is v0.0.4 (unreleased), this is pre-production. **No migration is needed.** Existing hashed keys in DynamoDB will no longer match because scrypt produces different output than HMAC-SHA256 for the same inputs. The small number of test users can regenerate their API keys. A note in the changelog will document this breaking change for the pre-production audience.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that the current code uses HMAC-SHA256 and that the security scanner alerts are valid.

**Test Plan**: Write tests that call `hashApiKey()` and verify the output matches HMAC-SHA256. Run these tests on the UNFIXED code to confirm the bug condition. Then, after the fix, these same tests should FAIL (because the output will no longer match HMAC-SHA256).

**Test Cases**:
1. **HMAC Output Match Test**: Call `hashApiKey('atl_test', 'salt')` and verify the output equals `crypto.createHmac('sha256', 'salt').update('atl_test').digest('hex')` (will pass on unfixed code, fail on fixed code)
2. **Inline Hash Match Test**: Call `resolveAuth()` with a known key and verify the DynamoDB lookup key uses HMAC-SHA256 hash (will pass on unfixed code, fail on fixed code)
3. **Hash Speed Test**: Time `hashApiKey()` and verify it completes in under 1ms (will pass on unfixed code — HMAC is fast — fail on fixed code where scrypt takes ~50-100ms)

**Expected Counterexamples**:
- `hashApiKey(key, salt)` output matches `crypto.createHmac('sha256', salt).update(key).digest('hex')` — confirming the bug condition
- Hash computation completes in microseconds — confirming no work factor

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL (rawKey, salt) WHERE isBugCondition(hashApiKey) DO
  result := hashApiKey_fixed(rawKey, salt)
  hmacResult := crypto.createHmac('sha256', salt).update(rawKey).digest('hex')
  ASSERT result != hmacResult  // No longer uses HMAC-SHA256
  ASSERT result == hashApiKey_fixed(rawKey, salt)  // Deterministic
  ASSERT result MATCHES /^[0-9a-f]{64}$/  // Valid hex format
  ASSERT LENGTH(result) == 64  // Compatible with KEY# format
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL event WHERE NOT isBugCondition(event) DO
  ASSERT resolveAuth_original(event).tier == resolveAuth_fixed(event).tier
  ASSERT resolveAuth_original(event).isAuthenticated == resolveAuth_fixed(event).isAuthenticated
  ASSERT resolveAuth_original(event).identity == resolveAuth_fixed(event).identity
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-hashing code paths (no-key requests, tier computation, TTL refresh), then write property-based tests capturing that behavior.

**Test Cases**:
1. **No-Key Preservation**: Verify that requests with no API key header continue to return public tier with `isAuthenticated: false`
2. **Tier Computation Preservation**: Verify that `computeEffectiveTier()` continues to return correct tiers for all combinations of stored tier and expiration
3. **Key Format Preservation**: Verify that `generateApiKey()` continues to produce keys matching `atl_` + 32 hex chars
4. **Error Response Preservation**: Verify that invalid keys continue to produce 401 responses with JSON-RPC error format

### Unit Tests

- Test `hashApiKey()` produces deterministic output for same inputs
- Test `hashApiKey()` produces different output for different keys with same salt
- Test `hashApiKey()` produces different output for same key with different salts
- Test `hashApiKey()` output is 64-character lowercase hex string
- Test `hashApiKey()` output differs from HMAC-SHA256 output (confirms scrypt is used)
- Test `resolveAuth()` with no key returns public tier
- Test `resolveAuth()` with valid key returns authenticated result
- Test `resolveAuth()` with invalid key returns 401

### Property-Based Tests

- Generate random `(key, salt)` pairs and verify `hashApiKey()` is deterministic, produces valid hex, and differs from HMAC-SHA256
- Generate random API Gateway events with no key and verify public tier result
- Generate random tier/expiration combinations and verify `computeEffectiveTier()` correctness
- Generate random keys and verify extraction consistency from both header formats

### Integration Tests

- Test full post-confirmation flow: generate key, hash with scrypt, store in DynamoDB, verify lookup works
- Test full key regeneration flow: generate new key, hash, delete old record, create new record
- Test full auth resolution flow: extract key from header, hash with scrypt, look up in DynamoDB, return authenticated result
