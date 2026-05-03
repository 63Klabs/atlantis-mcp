# Auth Profile 401 After Login Bugfix Design

## Overview

After login, all three authenticated Auth Lambda endpoints (`/mcp/auth/profile`, `/mcp/auth/key/regenerate`, `/mcp/auth/voucher/redeem`) return 401 Unauthorized despite receiving a valid `Authorization: Bearer <JWT>` header. The root cause is a mismatch between the header key used by `clientRequest.getProps()` (`headerParameters`) and the key read by `validateJwt()` (`headers`). The fix is a targeted change to `validateJwt()` in `utils/jwt-validator.js` to check both `props.headers` and `props.headerParameters` when extracting the Authorization header, maintaining backward compatibility with the read Lambda path that passes raw API Gateway events.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — when `validateJwt()` receives a `props` object from `clientRequest.getProps()` where the Authorization header is stored under `headerParameters` instead of `headers`
- **Property (P)**: The desired behavior — `validateJwt()` extracts and validates the JWT regardless of whether the Authorization header is in `props.headers` or `props.headerParameters`
- **Preservation**: Existing behavior that must remain unchanged — requests via `props.headers` (read Lambda path), missing header detection, expired/malformed token rejection, and all downstream validation (signature, issuer, token_use)
- **`validateJwt(props, userPoolId)`**: The function in `utils/jwt-validator.js` that extracts the Bearer token from request headers, fetches JWKS, and verifies the JWT signature, expiration, issuer, and token_use claims
- **`clientRequest.getProps()`**: Method from `@63klabs/cache-data` `ClientRequest` class that returns parsed request properties with headers under the `headerParameters` key (not `headers`), and converts header keys to camelCase lowercase
- **`extractBearerToken(authHeader)`**: Private function in `jwt-validator.js` that extracts the token string from a `Bearer <token>` header value

## Bug Details

### Bug Condition

The bug manifests when any of the three Auth Lambda controllers (`profile.js`, `key-regenerate.js`, `voucher-redeem.js`) pass `props` from `clientRequest.getProps()` to `validateJwt()`. The `getProps()` method stores headers under `headerParameters` with camelCase keys, but `validateJwt()` reads from `props.headers` which is `undefined` on the `getProps()` return object.

**Formal Specification:**
```
FUNCTION isBugCondition(props)
  INPUT: props of type Object (from clientRequest.getProps())
  OUTPUT: boolean

  RETURN props.headerParameters IS NOT undefined
         AND (props.headerParameters.authorization IS NOT undefined
              OR props.headerParameters.Authorization IS NOT undefined)
         AND props.headers IS undefined
END FUNCTION
```

### Examples

- **Profile endpoint**: User sends `GET /mcp/auth/profile` with `Authorization: Bearer eyJ...` → `getProps()` returns `{ headerParameters: { authorization: 'Bearer eyJ...' }, ... }` → `validateJwt()` reads `props.headers?.Authorization` which is `undefined` → throws `{ statusCode: 401, message: 'Missing or invalid Authorization header' }` → controller returns `{ error: 'Unauthorized' }`
- **Key regenerate endpoint**: User sends `POST /mcp/auth/key/regenerate` with `Authorization: Bearer eyJ...` → same `headerParameters` vs `headers` mismatch → 401 Unauthorized
- **Voucher redeem endpoint**: User sends `POST /mcp/auth/voucher/redeem` with `Authorization: Bearer eyJ...` → same mismatch → 401 Unauthorized
- **Read Lambda (not affected)**: Read Lambda passes raw API Gateway `event` directly to `validateJwt()` where `event.headers.Authorization` exists → works correctly because the raw event uses `headers`, not `headerParameters`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Requests via the read Lambda path where `validateJwt()` receives raw API Gateway events with `props.headers.Authorization` or `props.headers.authorization` must continue to work exactly as before
- Requests without any Authorization header (in either `headers` or `headerParameters`) must continue to return `{ statusCode: 401, message: 'Missing or invalid Authorization header' }`
- Requests with expired JWTs must continue to return `{ statusCode: 401, message: 'Token expired' }`
- Requests with wrong issuer must continue to return `{ statusCode: 401, message: 'Invalid token issuer' }`
- Requests with invalid `token_use` must continue to return `{ statusCode: 401, message: 'Invalid token use' }`
- Requests with malformed tokens must continue to return `{ statusCode: 401, message: 'Malformed token' }`
- Requests with non-Bearer Authorization values must continue to return `{ statusCode: 401, message: 'Missing or invalid Authorization header' }`
- JWKS caching behavior must remain unchanged
- User Pool ID resolution (parameter vs env var fallback) must remain unchanged

**Scope:**
All inputs that do NOT involve the `headerParameters` lookup path should be completely unaffected by this fix. This includes:
- Raw API Gateway events passed directly (read Lambda path)
- All JWT validation logic after token extraction (signature, expiration, issuer, token_use)
- JWKS fetching and caching
- User Pool ID resolution

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is confirmed:

1. **Header Key Mismatch**: The `@63klabs/cache-data` `ClientRequest.getProps()` method stores processed headers under the key `headerParameters`, not `headers`. The `validateJwt()` function on line 246 of `jwt-validator.js` reads `props.headers?.Authorization || props.headers?.authorization`, which returns `undefined` because `props.headers` does not exist on the `getProps()` return object.

2. **CamelCase Conversion**: The `ClientRequest` class also converts header keys to camelCase lowercase during processing. So `Authorization` becomes `authorization`. The current code already handles this for `props.headers` (checking both `Authorization` and `authorization`), but the same handling is needed for `props.headerParameters`.

3. **Test Blind Spot**: Existing unit tests for `jwt-validator.test.js` construct `props` objects with `{ headers: { Authorization: '...' } }` directly, which matches the read Lambda path but does not exercise the auth Lambda path where `getProps()` produces `{ headerParameters: { authorization: '...' } }`.

4. **All Three Controllers Affected**: All three controllers (`profile.js`, `key-regenerate.js`, `voucher-redeem.js`) follow the same pattern — they receive `props` from the route dispatcher (which gets it from `clientRequest.getProps()`) and pass it directly to `validateJwt(props, userPoolId)`.

## Correctness Properties

Property 1: Bug Condition - Header Source Equivalence

_For any_ valid JWT and any of the four header placement variants (`props.headers.Authorization`, `props.headers.authorization`, `props.headerParameters.Authorization`, `props.headerParameters.authorization`), the fixed `validateJwt()` function SHALL extract the same Bearer token and produce the same validated payload, returning the decoded JWT claims.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Missing Header Detection

_For any_ `props` object where neither `props.headers` nor `props.headerParameters` contains an Authorization header (or both are undefined/empty), the fixed `validateJwt()` function SHALL throw `{ statusCode: 401, message: 'Missing or invalid Authorization header' }`, preserving the existing missing-header rejection behavior.

**Validates: Requirements 3.1, 3.3**

Property 3: Preservation - JWT Validation Pipeline Unchanged

_For any_ input where the Authorization header IS successfully extracted (from either `headers` or `headerParameters`), the fixed `validateJwt()` function SHALL apply the same validation pipeline as the original — signature verification, expiration check, issuer check, and token_use check — producing identical results for identical tokens.

**Validates: Requirements 3.2, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `application-infrastructure/src/lambda/auth/utils/jwt-validator.js`

**Function**: `validateJwt(props, userPoolId)`

**Specific Changes**:

1. **Update Authorization Header Extraction**: Modify the line that reads the Authorization header to also check `props.headerParameters` as a fallback when `props.headers` does not contain the header. The lookup order should be:
   - `props.headers?.Authorization`
   - `props.headers?.authorization`
   - `props.headerParameters?.Authorization`
   - `props.headerParameters?.authorization`

   This ensures backward compatibility with the read Lambda path (which uses `props.headers`) while also supporting the auth Lambda path (which uses `props.headerParameters`).

2. **Update JSDoc**: Update the `@param` documentation for `props` to document that the function accepts both `props.headers` and `props.headerParameters` as sources for the Authorization header.

3. **No Changes to Controllers**: The controllers (`profile.js`, `key-regenerate.js`, `voucher-redeem.js`) do not need modification. They correctly pass `props` from `getProps()` to `validateJwt()` — the fix is entirely in how `validateJwt()` reads the headers.

4. **No Changes to `@63klabs/cache-data`**: The `ClientRequest.getProps()` behavior is correct by design. The fix adapts `validateJwt()` to work with the `getProps()` output structure.

5. **No Changes to Routes**: The route dispatcher correctly passes `props` from `clientRequest.getProps()` to controllers. No routing changes needed.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm the root cause analysis by showing that `validateJwt()` fails when given `headerParameters` instead of `headers`.

**Test Plan**: Write tests that construct `props` objects matching the `getProps()` output structure (with `headerParameters` containing a valid JWT) and call `validateJwt()`. Run these tests on the UNFIXED code to observe 401 failures.

**Test Cases**:
1. **headerParameters with authorization (camelCase)**: Construct `{ headerParameters: { authorization: 'Bearer <valid-jwt>' } }` and call `validateJwt()` — will throw 401 on unfixed code
2. **headerParameters with Authorization (PascalCase)**: Construct `{ headerParameters: { Authorization: 'Bearer <valid-jwt>' } }` and call `validateJwt()` — will throw 401 on unfixed code
3. **Full getProps() structure**: Construct a complete `getProps()` return object with `method`, `path`, `pathArray`, `headerParameters`, `queryStringParameters` and call `validateJwt()` — will throw 401 on unfixed code

**Expected Counterexamples**:
- `validateJwt()` throws `{ statusCode: 401, message: 'Missing or invalid Authorization header' }` for all `headerParameters` inputs
- Root cause confirmed: `props.headers` is `undefined` when `props.headerParameters` contains the Authorization header

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL props WHERE isBugCondition(props) DO
  result := validateJwt_fixed(props, userPoolId)
  ASSERT result.sub IS NOT undefined
  ASSERT result.email IS NOT undefined
  ASSERT result.token_use IN ['id', 'access']
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL props WHERE NOT isBugCondition(props) DO
  ASSERT validateJwt_original(props) = validateJwt_fixed(props)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (different header placements, different token states, missing headers)
- It catches edge cases that manual unit tests might miss (e.g., both `headers` and `headerParameters` present with different values)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for `props.headers` inputs (which work correctly), then write property-based tests capturing that behavior and verifying it is preserved after the fix.

**Test Cases**:
1. **headers.Authorization Preservation**: Verify that `props.headers.Authorization` with valid JWTs continues to return decoded payload after fix
2. **headers.authorization Preservation**: Verify that `props.headers.authorization` (lowercase) continues to work after fix
3. **Missing Header Preservation**: Verify that `props` with no Authorization header in either location continues to throw 401
4. **Malformed Token Preservation**: Verify that non-Bearer values and malformed tokens continue to throw 401
5. **Expired Token Preservation**: Verify that expired tokens continue to throw 401 regardless of header source

### Unit Tests

- Test `validateJwt()` with `props.headerParameters.authorization` (camelCase, the real `getProps()` structure)
- Test `validateJwt()` with `props.headerParameters.Authorization` (PascalCase, for robustness)
- Test `validateJwt()` with `props.headers.Authorization` (existing read Lambda path — regression test)
- Test `validateJwt()` with `props.headers.authorization` (existing lowercase path — regression test)
- Test `validateJwt()` with both `headers` and `headerParameters` present (precedence test — `headers` should take priority for backward compatibility)
- Test `validateJwt()` with neither `headers` nor `headerParameters` (should throw 401)
- Test `validateJwt()` with empty `headerParameters` object (should throw 401)

### Property-Based Tests

- Generate random valid JWTs and random header placement (`headers.Authorization`, `headers.authorization`, `headerParameters.Authorization`, `headerParameters.authorization`) and verify `validateJwt()` returns the same decoded payload for all placements (Property 1)
- Generate random `props` objects with no Authorization header in any location and verify `validateJwt()` throws 401 (Property 2)
- Generate random valid/invalid JWTs via `props.headers` (the original working path) and verify the fixed code produces identical results to the original behavior (Property 3)

### Integration Tests

- Test the full request flow through the route dispatcher with a mock `clientRequest.getProps()` returning `headerParameters` structure, verifying the profile controller returns 200 with profile data
- Test the full request flow for key-regenerate with `headerParameters` structure
- Test the full request flow for voucher-redeem with `headerParameters` structure
- Test that the PostConfirmation trigger path remains unaffected
