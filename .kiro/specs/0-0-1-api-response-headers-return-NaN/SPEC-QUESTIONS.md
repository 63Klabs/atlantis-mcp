# SPEC Questions & Recommendations

After reviewing the spec, the existing `rate-limiter.js`, `settings.js`, `connections.js`, `index.js` (handler), and the `@63klabs/cache-data` package usage, here are my clarifying questions and recommendations.

---

## Bugs Identified

Before we get to questions, here's what's causing the NaN headers right now:

1. `checkRateLimit()` passes a `client` object `{user, limitPerWindow, windowInMinutes}` to `getRateLimitData()`, but `getRateLimitData()` expects three separate arguments `(user, limit, windowInMinutes)`. So `limit` and `windowInMinutes` are `undefined`, producing `NaN`.
2. The headers reference an undefined variable `limit` instead of `limitPerWindow` on the line: `'X-RateLimit-Limit': String(limit)`.
3. `incrementRequestCount()` receives `client.user` but the rate limit data was keyed by the full `client` object (since `getRateLimitData` received the object as the first arg), so the increment never finds the entry.

These are straightforward fixes, but since the spec calls for a full rearchitecture with DynamoDB backing, we'll fix them as part of the new implementation.

---

## Questions

### Q1: DynamoDB Table Provisioning

The spec mentions a `*-sessions` DynamoDB table with logical name `DynamoDbSessions`. Should this table:

- **(A)** Be added to the application's CloudFormation template (`application-infrastructure/template.yml`) as an application-specific resource?
- **(B)** Be provisioned in a separate shared stack (managed by the platform team)?

**Recommendation:** (A) — Since this is session/rate-limit data specific to this application instance, it fits as an application-level resource per the AGENTS.md guidelines. The table name would follow `<Prefix>-<ProjectId>-<StageId>-sessions`.

**Answer** (A)
---

### Q2: DynamoDB Table Schema

Based on the spec, the table needs to store rate limit state keyed by hashed client identifier. Proposed schema:

| Attribute | Type | Role |
|-----------|------|------|
| `pk` | String | Partition key — hashed client identifier (e.g., SHA-256 of IP or user ID) |
| `windowStart` | Number | Sort key — window start timestamp in minutes (enables querying current window) |
| `remaining` | Number | Requests remaining in current window |
| `limit` | Number | Max requests for this window |
| `tier` | String | Access tier (public, registered, paid, private) |
| `ttl` | Number | DynamoDB TTL — Unix timestamp in seconds for automatic cleanup |

**Questions:**
- **(A)** Is a composite key (`pk` + `windowStart`) acceptable, or do you prefer a simple primary key with just the hashed identifier?
- **(B)** Should we store additional session fields now (e.g., `sessionToken`, `metadata`), or just the rate limit fields with the understanding that the table schema can be extended later?
- **(C)** For the hash algorithm, is SHA-256 acceptable for the client identifier hash?

**Recommendation:** (A) simple primary key with just `pk` (hashed identifier) since there's only one active window per client at a time. Store only rate limit fields now and extend later. SHA-256 is a good choice.

**Answer** Go with your recommendation. A with extending later. Use SHA-256

---

### Q3: In-Memory Cache Behavior on Window Transitions

The spec says windows reset on the mark (e.g., 4:00, 4:05, 4:10 for a 5-minute window). When a request arrives and the in-memory cache has data from the previous window:

- **(A)** Should the in-memory cache entry be immediately invalidated and a fresh DynamoDB fetch be awaited (blocking)?
- **(B)** Should the in-memory cache return a "new window" state (full remaining count) optimistically, then sync with DynamoDB in the background?

**Recommendation:** (B) — Since the window boundary is deterministic (we can calculate it), we can detect that the cached entry is from a previous window and immediately return a fresh state without waiting for DynamoDB. The background DynamoDB write will create/update the new window entry.

**Answer** (B)

---

### Q4: Concurrency and Race Conditions

Multiple Lambda instances will be running concurrently. For the DynamoDB decrement:

- **(A)** Use DynamoDB atomic counter (`ADD remaining -1` with a condition expression) to ensure accurate counts across instances?
- **(B)** Accept that the in-memory cache provides approximate counts per-instance, and DynamoDB provides the authoritative count?

**Recommendation:** (A) — Use `UpdateExpression: 'SET remaining = remaining - :dec'` with a condition `remaining > 0`. This gives accurate distributed rate limiting. The in-memory cache serves as a fast-path optimization, but DynamoDB is the source of truth.

**Answer**: A

---

### Q5: Client Identifier Hashing

The spec says the identifier should be a hashed value. For public tier (IP-based):

- **(A)** Hash the raw IP address directly?
- **(B)** Hash IP + some salt (e.g., from an environment variable or SSM parameter)?

**Recommendation:** (B) — A salted hash prevents rainbow table lookups if the DynamoDB table data is ever exposed. The salt can be stored in SSM Parameter Store alongside the existing `CacheData_SecureDataKey`.

**Answer** The Client Identifier can be either an IP (public) or User Identifier (auth). It can be hashed with salt. Use the same SSM Parameter script with `Mcp_SessionHashSalt` as the parameter name. (Be sure to also use the same param store path env variable convention)

---

### Q6: Rate Limit Response When DynamoDB Is Unavailable

If DynamoDB is unreachable (network issue, throttling, etc.):

- **(A)** Fall back to in-memory-only rate limiting (current behavior, per-instance)?
- **(B)** Allow the request through with a warning log (fail-open)?
- **(C)** Reject the request with a 503 (fail-closed)?

**Recommendation:** (A) — Fall back to in-memory rate limiting. This maintains some protection while not blocking legitimate users during a DynamoDB outage. Log a warning for monitoring.

**Answer** A

---

### Q7: Scope of This Spec

The spec mentions "session tokens or other relevant session information which may be used in the future." For this implementation:

- **(A)** Only implement rate limiting functionality now, with the table schema designed to accommodate future session data?
- **(B)** Implement a basic session management framework alongside rate limiting?

**Recommendation:** (A) — Keep scope focused on fixing the NaN bug and implementing proper distributed rate limiting. Design the table to be extensible but don't build session management yet.

**Answer** A

---

### Q8: CloudFormation Template

Should the DynamoDB table and related resources (IAM permissions for the Lambda to access it) be added to:

- **(A)** The existing application template that deploys the Lambda?
- **(B)** A new separate CloudFormation template?

**Recommendation:** (A) — Add to the existing application template since the Lambda needs direct access and the table is application-specific. This keeps the deployment atomic.

**Answer** A

---

### Q9: Environment Variable for Table Name

Following the existing pattern (e.g., `PARAM_STORE_PATH`), the DynamoDB table name should be passed to the Lambda as an environment variable. Proposed name:

- `DYNAMODB_SESSIONS_TABLE` 

Is this acceptable, or do you prefer a different naming convention?

**Answer** Use `MCP_DYNAMODB_SESSIONS_TABLE`

---

### Q10: Testing Strategy

Given the test migration from Mocha to Jest:

- **(A)** Write all new tests in Jest (`.jest.mjs`) per the steering rules?
- **(B)** Should property-based tests cover the interval calculation logic (the `nextIntervalInMinutes` function)?

**Recommendation:** Both (A) and (B). The interval calculation is a pure function that's perfect for property-based testing with fast-check. We should verify properties like "next interval is always in the future" and "next interval aligns to the window boundary."

**Answer** I think the migration is complete. (A) Write all new tests in jest