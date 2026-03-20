# Fix Rate Limiter Client IP Resolution - Bugfix Design

## Overview

The `checkRateLimit` function in `rate-limiter.js` extracts the client IP in the wrong priority order. Behind CloudFront, `event.requestContext.identity.sourceIp` contains the CloudFront edge node IP, not the real client IP. The `X-Forwarded-For` header contains the actual client IP as its first entry. The current code checks `sourceIp` first, so rate limiting is applied per edge location rather than per client. The fix flips the priority so `X-Forwarded-For` is checked first, falling back to `sourceIp` only when the header is absent.

## Glossary

- **Bug_Condition (C)**: A request where `X-Forwarded-For` header is present but `sourceIp` is also present — the current code uses `sourceIp` (CloudFront edge IP) instead of the real client IP from `X-Forwarded-For`
- **Property (P)**: When `X-Forwarded-For` is present, the first IP from that header is used as the client identifier for rate limiting
- **Preservation**: All non-IP-extraction behavior must remain unchanged — hashing, DynamoDB operations, cache logic, rate limit enforcement, 429 responses, and fallback to `'unknown'`
- **checkRateLimit**: The async function in `utils/rate-limiter.js` that performs per-client rate limiting using interval-aligned windows and distributed state via DynamoDB
- **rawId**: The extracted client identifier string before SHA-256 hashing — either an IP address or `'auth-user'` or `'unknown'`
- **sourceIp**: `event.requestContext.identity.sourceIp` — behind CloudFront, this is the edge node IP, not the real client
- **X-Forwarded-For**: HTTP header containing comma-separated IP addresses; the first entry is the original client IP

## Bug Details

### Bug Condition

The bug manifests when a request arrives through CloudFront (or any proxy) that sets the `X-Forwarded-For` header. The `checkRateLimit` function prioritizes `event.requestContext.identity.sourceIp` over `X-Forwarded-For`, causing it to use the CloudFront edge node IP as the client identifier instead of the real client IP.

**Formal Specification:**
```
FUNCTION isBugCondition(event)
  INPUT: event of type APIGatewayEvent
  OUTPUT: boolean

  LET sourceIp = event.requestContext?.identity?.sourceIp
  LET xForwardedFor = event.headers?.['X-Forwarded-For']

  RETURN sourceIp IS NOT NULL
         AND xForwardedFor IS NOT NULL
         AND sourceIp != firstIpFrom(xForwardedFor)
END FUNCTION
```

When the bug condition holds, the current code uses `sourceIp` (the edge IP) instead of the first IP from `X-Forwarded-For` (the real client IP).

### Examples

- **Example 1**: Client `203.0.113.50` sends request through CloudFront edge `54.230.1.1`. `sourceIp` = `54.230.1.1`, `X-Forwarded-For` = `203.0.113.50, 54.230.1.1`. Current: rate-limits on `54.230.1.1`. Expected: rate-limits on `203.0.113.50`.
- **Example 2**: Two different clients (`203.0.113.50` and `198.51.100.25`) both routed through edge `54.230.1.1`. Current: both share the same rate limit bucket. Expected: each has an independent rate limit bucket.
- **Example 3**: Client `203.0.113.50` hits edge `54.230.1.1` then edge `54.230.2.2`. Current: tracked as two separate clients. Expected: tracked as the same client.
- **Edge case**: Request with `X-Forwarded-For` but no `sourceIp`. Current: falls through to `X-Forwarded-For` (works correctly by accident). Expected: same behavior.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- When neither `X-Forwarded-For` nor `sourceIp` is present, the fallback to `'unknown'` must continue to work
- For authenticated users (non-public tier), the `'auth-user'` identifier must continue to be used
- When `X-Forwarded-For` contains multiple comma-separated IPs, only the first IP must be extracted
- The SHA-256 hashing of the client identifier with salt from SSM must continue to work identically
- Rate limit enforcement (DynamoDB counters, in-memory cache, window alignment) must remain unchanged
- The 429 response format with `Retry-After` and rate limit headers must remain unchanged
- The fail-closed behavior when hash salt is unavailable must remain unchanged

**Scope:**
All inputs where `X-Forwarded-For` is absent should be completely unaffected by this fix. This includes:
- Direct API Gateway requests without CloudFront (only `sourceIp` available)
- Requests with no client identification at all (fallback to `'unknown'`)
- Authenticated tier requests (future `'auth-user'` path)

## Hypothesized Root Cause

Based on the code at lines 390-393 of `rate-limiter.js`, the root cause is clear:

1. **Incorrect Priority in OR-chain**: The current code uses:
   ```javascript
   const rawId = isPublic
     ? (event.requestContext?.identity?.sourceIp ||
        event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
        'unknown')
     : 'auth-user';
   ```
   The `||` operator short-circuits: since `sourceIp` is always present in API Gateway events (even behind CloudFront), the `X-Forwarded-For` branch is never reached.

2. **CloudFront Behavior**: When CloudFront forwards requests to API Gateway, it sets `sourceIp` to the CloudFront edge IP and adds the real client IP to `X-Forwarded-For`. The code was written assuming `sourceIp` would be the real client IP, which is only true for direct API Gateway access without CloudFront.

There is no ambiguity — the fix is simply swapping the priority order in the OR-chain.

## Correctness Properties

Property 1: Bug Condition - X-Forwarded-For Takes Priority Over sourceIp

_For any_ API Gateway event where the `X-Forwarded-For` header is present and contains at least one valid IP address, the fixed `checkRateLimit` function SHALL use the first IP from `X-Forwarded-For` as the client identifier (`rawId`), regardless of whether `sourceIp` is also present.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-X-Forwarded-For Behavior Unchanged

_For any_ API Gateway event where the `X-Forwarded-For` header is absent or empty, the fixed `checkRateLimit` function SHALL produce the same `rawId` as the original function — using `sourceIp` if available, or `'unknown'` if neither is present — preserving all existing fallback behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `application-infrastructure/src/lambda/read/utils/rate-limiter.js`

**Function**: `checkRateLimit`

**Specific Changes**:
1. **Swap IP extraction priority** (lines 390-393): Change the OR-chain so `X-Forwarded-For` is checked before `sourceIp`:
   ```javascript
   const rawId = isPublic
     ? (event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
        event.requestContext?.identity?.sourceIp ||
        'unknown')
     : 'auth-user';
   ```

That is the only change required. No other functions, files, or logic need modification.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that `sourceIp` is indeed used when `X-Forwarded-For` is also present.

**Test Plan**: Write unit tests that call `checkRateLimit` with events containing both `sourceIp` and `X-Forwarded-For` with different IPs. Use the `TestHarness` to access `hashClientIdentifier` and verify which IP was used to generate the hash. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Both Headers Present**: Event with `sourceIp: '54.230.1.1'` and `X-Forwarded-For: '203.0.113.50'` — assert rawId is based on `203.0.113.50` (will fail on unfixed code)
2. **Multi-IP X-Forwarded-For**: Event with `X-Forwarded-For: '203.0.113.50, 54.230.1.1'` — assert rawId is based on `203.0.113.50` (will fail on unfixed code)
3. **Different Clients Same Edge**: Two events with same `sourceIp` but different `X-Forwarded-For` — assert different hash keys (will fail on unfixed code)
4. **Same Client Different Edges**: Two events with different `sourceIp` but same `X-Forwarded-For` — assert same hash keys (will fail on unfixed code)

**Expected Counterexamples**:
- The hash key is computed from `sourceIp` instead of the `X-Forwarded-For` IP
- Possible cause: OR-chain short-circuits at `sourceIp` before reaching `X-Forwarded-For`

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL event WHERE isBugCondition(event) DO
  result := checkRateLimit_fixed(event, limits)
  rawId := extractedRawId(event)
  ASSERT rawId == event.headers['X-Forwarded-For'].split(',')[0].trim()
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL event WHERE NOT isBugCondition(event) DO
  ASSERT checkRateLimit_original(event, limits).rawId == checkRateLimit_fixed(event, limits).rawId
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many event configurations automatically across the input domain
- It catches edge cases like empty strings, whitespace-only headers, and missing nested properties
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for events without `X-Forwarded-For`, then write property-based tests capturing that behavior.

**Test Cases**:
1. **sourceIp Only Preservation**: Events with `sourceIp` but no `X-Forwarded-For` — verify rawId is still `sourceIp` after fix
2. **Unknown Fallback Preservation**: Events with neither header — verify rawId is still `'unknown'` after fix
3. **Hash Consistency Preservation**: Verify `hashClientIdentifier` produces identical SHA-256 hashes for same inputs after fix
4. **Rate Limit Headers Preservation**: Verify response headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are still correctly computed

### Unit Tests

- Test IP extraction with only `X-Forwarded-For` present
- Test IP extraction with only `sourceIp` present
- Test IP extraction with both headers present (fix verification)
- Test IP extraction with neither header (fallback to `'unknown'`)
- Test IP extraction with multi-IP `X-Forwarded-For`
- Test IP extraction with empty/whitespace `X-Forwarded-For`

### Property-Based Tests

- Generate random IP addresses for `sourceIp` and `X-Forwarded-For` and verify the correct one is selected based on priority
- Generate random event configurations (with/without headers) and verify preservation of fallback behavior
- Generate random multi-IP `X-Forwarded-For` values and verify only the first IP is extracted

### Integration Tests

- Test full `checkRateLimit` flow with mocked DynamoDB and SSM, verifying correct hash key generation with `X-Forwarded-For` priority
- Test that two requests with same `X-Forwarded-For` but different `sourceIp` share the same rate limit bucket
- Test that two requests with different `X-Forwarded-For` but same `sourceIp` have independent rate limit buckets
