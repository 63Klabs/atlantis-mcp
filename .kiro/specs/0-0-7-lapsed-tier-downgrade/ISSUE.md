# Lapsed voucher tiers are never downgraded

Raised as finding 6 in the [post-deploy smoke verification plan](../0-0-7-postdeploy-smoke-verification/PLAN.md#8-findings-outside-this-spec), and recorded under "Related" in [issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5). Checked against `dev` at `7acaf7d` on 2026-10-21, by running the Read function's tier check locally and counting records in the deployed Users tables ([Deployed state](#deployed-state)).

## Summary

When a voucher, or an admin promotion with an end date, lapses, the user should drop back to `registered`. The Read function never does that. Everything that writes `tierExpiresAt` stores an ISO 8601 string, as the design specifies, but the Read function's `computeEffectiveTier` compares the value with Unix epoch seconds. JavaScript turns the string into `NaN` for that comparison, so it is never true and the stored tier wins. A lapsed `paid` user keeps paid rate limits and semantic search until the record's `ttl` deletes the account (finding 5), while the profile page, which runs a different check, shows them as `registered`. The `test` stage has one such record today.

## How it happens

1. **Writers store ISO 8601 strings.**
   - Voucher redemption: [`voucher-redeem.js`](../../../application-infrastructure/src/lambda/auth-function/services/voucher-redeem.js) L99 computes `new Date(now + durationDays).toISOString()`, and L103 passes it to `UserDao.updateUserTier` ([`models/user.js`](../../../application-infrastructure/src/lambda/auth-function/models/user.js) L163-L172), which writes it to `tierExpiresAt`.
   - The admin command "Promote to paid tier with expiration" in [`user-management.md`](../../../docs/admin-ops/user-management.md) L68-L81 sets `":exp":{"S":"2026-12-31T00:00:00Z"}`.
   - Key regeneration copies the existing value (`key-regenerate.js` L80). Registration writes `null` (`post-confirmation.js` L160-L162).
2. **The design and the docs agree on the string.** [`0-0-3-add-authentication/design.md`](../0-0-3-add-authentication/design.md) L511 ("String (ISO 8601) or null"), `user-management.md` L39, and both `tierExpiresAt` schemas in [`template-openapi-spec.yml`](../../../application-infrastructure/template-openapi-spec.yml) (L302-L304, L339-L342).
3. **The Read function expects a number.** [`computeEffectiveTier`](../../../application-infrastructure/src/lambda/read-function/utils/auth-resolver.js) (`auth-resolver.js` L113-L118) runs `tierExpiresAt != null && tierExpiresAt <= Math.floor(Date.now() / 1000)`, and its JSDoc (L104) documents "Unix epoch seconds". `resolveAuth` uses the result as the request's tier (L324), which selects the rate limit and semantic-search eligibility.
4. **No test crosses the formats.** The Read function's tests pass only integers (`auth-resolver.property.test.js`, `auth-resolver-preservation.property.test.js`, and `tests/unit/utils/auth-resolver.test.js`). The auth function's tests pass only ISO strings.

### Reproduced

The real `computeEffectiveTier`, loaded from `auth-resolver.js` through `TestHarness.getInternals()`:

| Stored tier | `tierExpiresAt` | Result |
|-------------|-----------------|--------|
| `paid` | ISO 8601 string, 30 days ago | `paid` |
| `paid` | Epoch seconds, 30 days ago | `registered` |
| `private` | ISO 8601 string, 30 days ago | `private` |
| `paid` | ISO 8601 string, 30 days ahead | `paid` |

Comparing a string with a number converts the string with `Number()`. For an ISO 8601 date that gives `NaN`, and every comparison with `NaN` is false.

### The profile disagrees

The auth function has its own `computeEffectiveTier` ([`services/profile.js`](../../../application-infrastructure/src/lambda/auth-function/services/profile.js) L37-L41), whose JSDoc (L27) says it "matches the Read Lambda's behavior". It runs `new Date(tierExpiresAt) < new Date()`, which handles the ISO strings correctly. So after a voucher lapses, `/profile/` shows `registered` and the registered limit of 100 per hour, while the API still enforces the paid limit and sends `X-RateLimit-Limit: 3000`.

The two checks fail in opposite directions. `new Date()` reads a number as milliseconds, so the profile check would place any epoch-seconds expiry in January 1970 and always report it as expired. Switching the stored format to numbers would move the bug to the profile rather than fix it.

## Impact

- **Lapsed paid users keep paid access:** 3,000 requests per day instead of 100 per hour. With `EnableDocAi=true` and `DocAiMinTier=paid` on all three deployed stages, they also keep Bedrock-backed semantic search, which costs money per request.
- **Temporary private tiers do the same** (6,000 per day). `user-management.md` L144 offers private "for temporary access" with a date.
- **Only `ttl` ends it today.** The record's `ttl`, 120 days after redemption or the last record write, deletes the record and the Cognito account (finding 5). A user goes from `paid` straight to no account, never through `registered`. A voucher of 120 days or longer never lapses at all, because the account is deleted first.
- **Fixing finding 5 alone makes this worse.** If use renews `ttl` for paid users, a lapsed voucher keeps paid limits for as long as the key is used. This fix has to land first or in the same release.
- **Cognito keeps the voucher tier.** Redemption also sets `custom:tier` (`voucher-redeem.js` L108-L110), and nothing resets it on lapse. Nothing in this repository reads it today.
- **The docs promise the downgrade:** `user-management.md` L143 and L146, the `ARCHITECTURE.md` auth flowchart (L487-L489), and [Requirement 5.3](../0-0-3-add-authentication/requirements.md) of the authentication spec.

## Deployed state

Counts from a scan of each stage's Users table on 2026-10-21. The scan projected only `tier` and `tierExpiresAt`, plus target tier, duration, and use count for voucher records; no keys or identifiers were read.

| Stage | User records | Lapsed tier still stored | Vouchers |
|-------|--------------|--------------------------|----------|
| `test` | 3: `registered`, `private` with no end date, `paid` with a string `tierExpiresAt` in the past | 1 (`paid`) | 1: `paid`, 30 days, redeemed |
| `beta` | 1: `private` with no end date | 0 | 0 |
| `prod` | 3: two `private` with no end date, one `registered` | 0 | 0 |

No production user is affected today. Every stored `tierExpiresAt` is a string or null, so a fix that reads strings needs no data migration.

## Expected behavior

As the design states: once `tierExpiresAt` has passed, the Read function treats the user as `registered` for rate limiting and tier gating, without rewriting the stored record. The Read function and the profile report the same effective tier for every stored value.

## Possible fix

1. **Read the stored format.** Parse `tierExpiresAt` as an ISO 8601 string in the Read function, which matches every writer, the design, the OpenAPI schema, and all deployed data.
2. **Decide what an unparseable value means.** Accepting epoch seconds as well costs little. For anything else, treating it as expired fails closed; treating it as no expiry fails open, which is what happens today.
3. **One rule in both functions.** Code shared between functions has to be a Lambda layer (the repository already has two). Otherwise, keep two copies driven by one shared set of test cases.
4. **Tests and JSDoc.** Property tests in both functions with ISO 8601 inputs (past, future, unparseable), and corrected JSDoc on both `computeEffectiveTier` functions.

## Open points for planning

- Accept only ISO 8601, or epoch seconds too.
- Fail open or closed on a value that does not parse.
- A shared layer, or two copies with shared test cases.
- Whether to reset Cognito `custom:tier` when a lapse is detected. The design says not to rewrite `tierExpiresAt`; it says nothing about `custom:tier`.
- Whether this ships in the same release as the fix for [issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5).

## How to re-check

```bash
# From application-infrastructure/src/lambda/read-function, with dev dependencies installed
node -e '
const { TestHarness } = require("./utils/auth-resolver");
const { computeEffectiveTier } = TestHarness.getInternals();
const past = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
console.log(computeEffectiveTier("paid", past)); // today: paid, expected: registered
'
```

The lapsed `paid` record on `test` confirms a deployed fix end to end: a request with that user's key returns `X-RateLimit-Limit: 3000` today and should return `100` afterwards.

## Related documentation

- [Post-deploy smoke verification plan](../0-0-7-postdeploy-smoke-verification/PLAN.md), findings 5 and 6
- [Issue #5: private and paid user records expire after 120 days even when active](https://github.com/63Klabs/atlantis-mcp/issues/5)
- [Authentication design](../0-0-3-add-authentication/design.md), "TTL Strategy"
- [User management](../../../docs/admin-ops/user-management.md) and [voucher management](../../../docs/admin-ops/voucher-management.md)
