# SPEC Questions and Recommendations

This document contains clarifying questions and recommendations that should be reviewed and confirmed before proceeding to the design phase. This is a major refactoring effort and careful consideration is needed.

---

## Clarifying Questions

### Q1: PostConfirmation Handler — Shared Utilities vs Full Independence

The PostConfirmation handler currently has its own copy of `getCachedSsmParam` and directly imports from `utils/dynamo-client.js` and `utils/api-key.js`. After refactoring, the DynamoDB operations will move to `models/`.

**Question:** Should the PostConfirmation handler:
- **(A)** Import from the new `models/` layer (sharing the DAO with the MVC path), or
- **(B)** Keep its own inline DynamoDB calls to remain fully independent of the MVC stack?

**Recommendation:** Option A — share the DAO layer. The PostConfirmation handler already imports from `utils/dynamo-client.js`, so moving those functions to `models/user.js` and importing from there is a minimal change. It avoids duplicating DynamoDB logic. The DAO layer has no dependency on cache-data request/response classes, so it's safe to share.

---

### Q2: PostConfirmation Handler Location

Currently the PostConfirmation handler lives in `handlers/post-confirmation.js`. After refactoring, the `handlers/` directory will no longer contain API Gateway handlers (those move to `controllers/`).

**Question:** Should the PostConfirmation handler:
- **(A)** Stay in `handlers/post-confirmation.js` (the directory now only contains this one file), or
- **(B)** Move to `triggers/post-confirmation.js` to clearly distinguish it from the MVC pattern, or
- **(C)** Move to a different location?

**Recommendation:** Option A — keep it in `handlers/`. The name `handlers` clearly communicates "Lambda event handlers that aren't HTTP controllers." If more Cognito triggers are added later, they'd go here too. Renaming to `triggers/` is also fine but adds unnecessary churn.

---

### Q3: Cache.init() — Is It Needed for Auth?

The read Lambda initializes `Cache.init()` with a `CacheData_SecureDataKey` because it uses `CacheableDataAccess` for caching S3/GitHub API responses. The auth Lambda doesn't cache external API responses — it only reads/writes DynamoDB directly and calls Cognito SDK.

**Question:** Does the auth Lambda need `Cache.init()` and `CacheableDataAccess`, or should Config only initialize `AppConfig.init()` (for ClientRequest, Response, DebugAndLog, etc.) without the caching layer?

**Recommendation:** Skip `Cache.init()` and `CacheableDataAccess` for now. The auth Lambda's DynamoDB operations are direct reads/writes (user lookups, voucher lookups) that don't benefit from the cache-data caching layer. Only initialize `AppConfig.init()` for the request/response/logging framework. This simplifies the Config class and avoids requiring the `CacheData_SecureDataKey` SSM parameter. If caching is needed later, it can be added.

---

### Q4: JWT Validator — SSM Cache Migration Scope

The JWT validator currently has its own SSM cache for the Cognito User Pool ID (`cachedUserPoolId`). It also checks `process.env.COGNITO_USER_POOL_ID` first (used by the read Lambda).

**Question:** Should the JWT validator:
- **(A)** Switch to using a CachedSsmParameter instance from `config/settings.js` (passed in or imported), or
- **(B)** Keep its own SSM caching since it's a standalone utility that might be shared across Lambdas?

**Recommendation:** Option A — migrate to CachedSsmParameter. The JWT validator is only used by the auth Lambda's API Gateway path. Using CachedSsmParameter from settings consolidates all SSM access into one pattern and eliminates the custom cache. The validator can accept the User Pool ID as a parameter rather than fetching it internally, making it more testable.

---

### Q5: Rate Limit Config — Environment Variables vs Settings

The `rate-limit-config.js` utility reads rate limit environment variables directly from `process.env`. In the MVC pattern, environment variables are typically parsed in `config/settings.js`.

**Question:** Should rate limit configuration:
- **(A)** Move to `config/settings.js` (like the read Lambda does), or
- **(B)** Stay in `utils/rate-limit-config.js` as a standalone utility?

**Recommendation:** Option A — move to `config/settings.js`. This is consistent with the read Lambda where `settings.rateLimits` contains all rate limit configuration. The `getRateLimitConfig()` function can be replaced by `Config.settings().rateLimits`. This eliminates the separate utility and centralizes environment variable parsing.

---

### Q6: Cognito User Pool ID SSM Path

The auth handlers currently use `app-stack/Mcp_CognitoUserPoolId` as the SSM parameter name (appended to `PARAM_STORE_PATH`). The JWT validator uses the same path. This `app-stack/` prefix is unusual compared to other parameters like `Mcp_ApiKeyHashSalt`.

**Question:** Is the `app-stack/` prefix in the SSM path intentional and required, or is it an artifact that should be normalized?

**Recommendation:** Keep the `app-stack/` prefix as-is. It likely reflects the CloudFormation stack that created the parameter. Changing SSM paths would require updating the parameter in AWS, which is outside the scope of this refactoring.

---

### Q7: OpenAPI Spec Updates

The steering document requires updating `template-openapi-spec.yml` when modifying API endpoints. The path prefix is changing from `/auth/*` to `/mcp/auth/*`.

**Question:** Should the OpenAPI spec update be included in this refactoring scope, or handled as a separate task?

**Recommendation:** Include it in scope. The path change from `/auth/*` to `/mcp/auth/*` is a breaking change at the API Gateway level that must be reflected in the OpenAPI spec. The spec update should be a task in the implementation plan.

---

### Q8: API Gateway Resource Configuration

Changing paths from `/auth/*` to `/mcp/auth/*` requires changes to the API Gateway resource configuration in the CloudFormation template.

**Question:** Is the API Gateway already configured to pass `/mcp/auth/*` paths to the auth Lambda, or does the CloudFormation template need updating?

**Recommendation:** This needs to be verified. If the API Gateway is behind CloudFront and CloudFront strips the `/mcp` prefix before forwarding, the Lambda may already receive `/auth/*` paths. If the Lambda receives the full `/mcp/auth/*` path, the route dispatcher needs to handle that. The SPEC.md mentions that "the API Gateway is behind CloudFront the path that comes in is different than if it came in direct through API Gateway" — this is exactly what ClientRequest from cache-data handles, since it normalizes paths regardless of whether they come through CloudFront or direct API Gateway.

---

### Q9: Error Response Body Consistency

The current handlers return slightly different error response structures. For example, some return `{ error: "message" }` while the read Lambda's error pattern uses `{ message: "message", requestId: "..." }`.

**Question:** Should error responses:
- **(A)** Match the current auth Lambda format (`{ error: "message" }`), or
- **(B)** Match the read Lambda format (`{ message: "message", requestId: "..." }`)?

**Recommendation:** Option A — keep the current auth Lambda format for endpoint-specific errors (401, 400, 404). These are part of the API contract that consumers depend on. For unexpected 500 errors in the handler catch block, use the read Lambda pattern with requestId for debugging. This preserves backward compatibility while improving debuggability for server errors.

---

### Q10: Test Framework

The existing auth Lambda tests use Jest (based on `jest` in devDependencies and the test file naming). The workspace steering documents mention a migration from Mocha to Jest.

**Question:** Should new tests for the refactored modules be written in Jest, and should they follow the `*.test.js` naming convention already used in the auth Lambda's test directory?

**Recommendation:** Yes, use Jest. The existing tests already use Jest. Follow the existing naming convention in the auth Lambda's test directory (`tests/unit/*.test.js` and `tests/property/*.property.test.js`).

---

## Recommendations

### R1: Phased Implementation Approach

**Recommendation:** Implement this refactoring in phases rather than a single big-bang change:

1. **Phase 1 — Infrastructure**: Add cache-data dependency, create config/ directory with all config modules, create the thin handler with dual-path detection.
2. **Phase 2 — Profile Endpoint**: Migrate the profile handler to controller/service/model pattern. Verify with tests.
3. **Phase 3 — Key Regenerate Endpoint**: Migrate the key-regenerate handler. Verify with tests.
4. **Phase 4 — Voucher Redeem Endpoint**: Migrate the voucher-redeem handler. Verify with tests.
5. **Phase 5 — Cleanup**: Remove old handler files, update all tests, verify full test suite passes.

This reduces risk by allowing each endpoint to be verified independently.

### R2: Keep PostConfirmation Handler Changes Minimal

**Recommendation:** The PostConfirmation handler works correctly and has good test coverage. Changes to it should be limited to updating import paths if the DAO layer moves. Do not refactor it to use cache-data classes — it's a Cognito trigger, not an HTTP endpoint.

### R3: Preserve TestHarness Pattern

**Recommendation:** All new modules (controllers, services, models) should include TestHarness classes following the existing pattern in the codebase. This enables testing of private internals without exposing them in the public API.

### R4: Verify ClientRequest Path Handling

**Recommendation:** Before implementing the route dispatcher, verify how `clientRequest.getProps().path` and `clientRequest.getProps().pathArray` handle the `/mcp/auth/*` paths. The read Lambda's route dispatcher checks `path.endsWith('mcp/v1')`, which suggests the path may or may not include a leading slash depending on the event source. Test with both CloudFront-proxied and direct API Gateway events.

### R5: Consider Connection Definitions for DynamoDB Tables

**Recommendation:** Even though the auth Lambda doesn't use `CacheableDataAccess` for caching, defining DynamoDB table connections in `config/connections.js` provides a centralized place to manage table references. This follows the pattern where connections define data sources even if they're accessed directly rather than through the cache layer.

---

## Status

| Item | Status | Resolution |
|------|--------|------------|
| Q1: PostConfirmation shared utilities | ⏳ Awaiting confirmation | — |
| Q2: PostConfirmation handler location | ⏳ Awaiting confirmation | — |
| Q3: Cache.init() needed? | ⏳ Awaiting confirmation | — |
| Q4: JWT validator SSM migration | ⏳ Awaiting confirmation | — |
| Q5: Rate limit config location | ⏳ Awaiting confirmation | — |
| Q6: Cognito User Pool ID SSM path | ⏳ Awaiting confirmation | — |
| Q7: OpenAPI spec updates | ⏳ Awaiting confirmation | — |
| Q8: API Gateway resource config | ⏳ Awaiting confirmation | — |
| Q9: Error response body format | ⏳ Awaiting confirmation | — |
| Q10: Test framework | ⏳ Awaiting confirmation | — |
| R1: Phased implementation | ⏳ Awaiting confirmation | — |
| R2: Minimal PostConfirmation changes | ⏳ Awaiting confirmation | — |
| R3: Preserve TestHarness pattern | ⏳ Awaiting confirmation | — |
| R4: Verify ClientRequest path handling | ⏳ Awaiting confirmation | — |
| R5: Connection definitions for DynamoDB | ⏳ Awaiting confirmation | — |
