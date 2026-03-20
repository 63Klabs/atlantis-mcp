# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - X-Forwarded-For Takes Priority Over sourceIp
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: For this deterministic bug, scope the property to concrete failing cases where both `sourceIp` and `X-Forwarded-For` are present with different IPs
  - **Test file**: `application-infrastructure/src/lambda/read/tests/unit/utils/rate-limiter-ip-resolution-bug.property.test.js`
  - **Test setup**: Use `TestHarness.getInternals()` to access `hashClientIdentifier` for verifying which IP was used as `rawId`
  - **Test setup**: Mock `AWS.dynamo` (get/put/update) and `settings.sessionHashSalt.getValue()` to isolate IP extraction logic
  - **Bug Condition from design**: `isBugCondition(event)` = `sourceIp IS NOT NULL AND xForwardedFor IS NOT NULL AND sourceIp != firstIpFrom(xForwardedFor)`
  - **Test case 1**: Event with `sourceIp: '54.230.1.1'` and `X-Forwarded-For: '203.0.113.50'` — assert the hash key is computed from `'203.0.113.50'`, not `'54.230.1.1'`
  - **Test case 2**: Event with `X-Forwarded-For: '203.0.113.50, 54.230.1.1'` (multi-IP) — assert hash key is computed from `'203.0.113.50'`
  - **Test case 3**: Two events with same `sourceIp` but different `X-Forwarded-For` — assert different hash keys (different clients should get independent buckets)
  - **Test case 4**: Two events with different `sourceIp` but same `X-Forwarded-For` — assert same hash keys (same client across edges should share bucket)
  - **Property-based**: Use fast-check to generate random IP pairs for `sourceIp` and `X-Forwarded-For`, assert hash key always derives from `X-Forwarded-For` first IP
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the bug exists)
  - Document counterexamples found (e.g., "hash key computed from sourceIp '54.230.1.1' instead of X-Forwarded-For IP '203.0.113.50'")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-X-Forwarded-For Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - **Test file**: `application-infrastructure/src/lambda/read/tests/unit/utils/rate-limiter-ip-resolution-preservation.property.test.js`
  - **Test setup**: Use `TestHarness.getInternals()` to access `hashClientIdentifier` for verifying `rawId` derivation
  - **Test setup**: Mock `AWS.dynamo` (get/put/update) and `settings.sessionHashSalt.getValue()` to isolate IP extraction logic
  - **Non-bug condition from design**: `NOT isBugCondition(event)` = events where `X-Forwarded-For` is absent or empty
  - **Observe on UNFIXED code first**:
    - Observe: Event with only `sourceIp: '192.168.1.1'` (no `X-Forwarded-For`) → rawId = `'192.168.1.1'`
    - Observe: Event with neither `sourceIp` nor `X-Forwarded-For` → rawId = `'unknown'`
    - Observe: Event with empty `X-Forwarded-For: ''` and `sourceIp: '10.0.0.1'` → rawId = `'10.0.0.1'`
    - Observe: Event with whitespace-only `X-Forwarded-For: '  '` and `sourceIp: '10.0.0.1'` → rawId = `'10.0.0.1'` (trim produces empty string, falsy)
  - **Property-based test 1**: For all generated `sourceIp` values (with no `X-Forwarded-For`), rawId equals `sourceIp` — uses fast-check IP address generator
  - **Property-based test 2**: For events with neither header, rawId equals `'unknown'`
  - **Property-based test 3**: `hashClientIdentifier(rawId, windowStart, salt)` produces consistent SHA-256 hashes for same inputs
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix rate limiter client IP resolution

  - [x] 3.1 Implement the fix
    - Swap the OR-chain priority in `checkRateLimit` function at lines 390-393 of `application-infrastructure/src/lambda/read/utils/rate-limiter.js`
    - Change from: `event.requestContext?.identity?.sourceIp || event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() || 'unknown'`
    - Change to: `event.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() || event.requestContext?.identity?.sourceIp || 'unknown'`
    - This is a single-line change — no other functions, files, or logic need modification
    - _Bug_Condition: isBugCondition(event) where sourceIp IS NOT NULL AND xForwardedFor IS NOT NULL AND sourceIp != firstIpFrom(xForwardedFor)_
    - _Expected_Behavior: When X-Forwarded-For is present, use first IP from that header as rawId; fall back to sourceIp only when X-Forwarded-For is absent_
    - _Preservation: All non-IP-extraction behavior unchanged — hashing, DynamoDB ops, cache logic, rate limit enforcement, 429 responses, fallback to 'unknown'_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - X-Forwarded-For Takes Priority Over sourceIp
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (rawId derived from X-Forwarded-For first IP)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1: `application-infrastructure/src/lambda/read/tests/unit/utils/rate-limiter-ip-resolution-bug.property.test.js`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-X-Forwarded-For Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2: `application-infrastructure/src/lambda/read/tests/unit/utils/rate-limiter-ip-resolution-preservation.property.test.js`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation tests still pass after fix (no regressions in sourceIp-only, unknown fallback, or hash consistency behavior)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run both test files together to confirm all properties hold:
    - `rate-limiter-ip-resolution-bug.property.test.js` — PASSES (bug is fixed)
    - `rate-limiter-ip-resolution-preservation.property.test.js` — PASSES (no regressions)
  - Run existing rate limiter tests to confirm no breakage: `rate-limiter.test.js`, `rate-limiter-property.test.js`, `rate-limit-cache.test.js`, `rate-limit-cache-property.test.js`
  - Ensure all tests pass, ask the user if questions arise.
