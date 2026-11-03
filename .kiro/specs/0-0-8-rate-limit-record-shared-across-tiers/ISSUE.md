# A tier change can reuse the previous tier's rate-limit record

Found while writing [0-0-7-lapsed-tier-downgrade/requirements.md](../0-0-7-lapsed-tier-downgrade/requirements.md) ("Additions beyond PLAN.md"), which makes lapsed tiers downgrade and so adds a new kind of tier change. Checked against `dev` at `71251f0` on 2026-11-02 by running the Read function's real key functions locally. Nothing was read from a deployed stage.

## Summary

The Read function counts an authenticated user's requests in a Sessions table record whose key is `sha256(cognitoSub + windowStartMinutes + salt)`. The key has no tier in it. Two tiers that compute the same window start therefore share one record.

- `paid` and `private` both use a 1,440-minute (daily) window, so they always share a record.
- `registered` uses a 60-minute window. Between 00:00 and 00:59 UTC the hour start equals the day start, so `registered` shares the record with `paid` and `private` for that hour.

When a user's tier changes, the next request finds the old tier's record and keeps decrementing its `remaining` count, until the window ends. The new tier's limit applies only from the next window. The profile page computes the same key, so it shows the same inherited count.

## How it happens

1. **The key.** `hashClientIdentifier(rawId, windowStartMinutes, salt)` in [`read-function/utils/rate-limiter.js`](../../../application-infrastructure/src/lambda/read-function/utils/rate-limiter.js) (L247-L252) hashes `${rawId}${windowStartMinutes}${salt}`. `checkRateLimit` calls it with the user's `cognitoSub` and the window start for the request's tier (L401-L402, L432).
2. **The window start.** `nextIntervalInMinutes(windowInMinutes)` (L64-L77) rounds the current time up to a multiple of the window length from the Unix epoch, so every window is aligned to UTC. The window start is that boundary minus the window length.
3. **The windows.** `config/settings.js` sets `registered` to 60 minutes, and `paid` and `private` to 1,440 minutes (L691-L730). The Read function's environment does not override them. The Auth function's environment sets the same values explicitly (`template.yml` L1130-L1137).
4. **The record.** `createInDynamo` (L330-L341) stores `remaining = limit − 1` and `limit` when a window's first request arrives. Later requests decrement `remaining` and never compare the stored `limit` with the current tier's limit.
5. **The in-memory cache.** A cache hit is accepted when `cached.data.windowStart === windowStartMinutes` (L444). The tier stored in the entry is not compared.
6. **The profile.** `computeSessionKey` in [`auth-function/utils/window-calculator.js`](../../../application-infrastructure/src/lambda/auth-function/utils/window-calculator.js) (L121-L127) reproduces the same hash "exactly", so the profile reads the same record.

### Reproduced

The real `nextIntervalInMinutes` and `hashClientIdentifier`, loaded through `TestHarness.getInternals()`, with a placeholder `cognitoSub` and salt (first 12 hex characters shown):

| UTC time | `registered` (60) | `paid` (1440) | `private` (1440) | registered = paid | paid = private |
|----------|-------------------|---------------|------------------|-------------------|----------------|
| 00:30 | `5211f1940ec3` | `5211f1940ec3` | `5211f1940ec3` | yes | yes |
| 01:30 | `3d45eba0be30` | `5211f1940ec3` | `5211f1940ec3` | no | yes |
| 14:00 | `be072c2e19d1` | `5211f1940ec3` | `5211f1940ec3` | no | yes |

## Impact

Tier changes come from voucher redemption, the admin commands in `docs/admin-ops/user-management.md`, and, once [0-0-7-lapsed-tier-downgrade](../0-0-7-lapsed-tier-downgrade/requirements.md) phase 2 ships, a lapsed tier being written back as `registered`.

| Change | When | Effect until the window ends |
|--------|------|------------------------------|
| `paid` → `private` (voucher) | Any time | The user keeps the paid record's remaining count, at most 2,999, instead of starting at 6,000. **Under-grants** for the rest of the UTC day |
| `private` → `paid` (admin) | Any time | The user keeps up to 5,999 instead of 3,000. **Over-grants** for the rest of the UTC day |
| `registered` → `paid` or `private` (voucher) | 00:00 to 00:59 UTC | The new daily window starts from that hour's registered count, at most 99. **Under-grants** for the whole UTC day |
| `paid` or `private` → `registered` (lapse or admin) | 00:00 to 00:59 UTC | The user keeps the daily remaining count, possibly thousands, instead of 100. **Over-grants** until 01:00 |

- **Headers disagree with each other.** `X-RateLimit-Limit` comes from the new tier, and `X-RateLimit-Remaining` from the inherited record. A client can see `Remaining` above `Limit`, for example `Limit: 100`, `Remaining: 2950`.
- **The user who just paid is the one most affected.** A voucher redeemed in the first hour of the UTC day can leave a user who just upgraded with fewer than 100 requests for the day.
- **No security exposure beyond rate limiting.** The over-grant is bounded by the old tier's own limit, and the identity is still the user's `cognitoSub`.

## Deployed state

Not checked. The windows come from code defaults (Read function) and explicit environment values (Auth function). To confirm the deployed values without changing anything, use the `release` profile and `us-east-2`:

```bash
# Read function: expect no MCP_*_RATE_* variables (code defaults apply)
aws lambda get-function-configuration \
  --function-name prod63k-atlantis-mcp-test-ReadFunction \
  --profile release --region us-east-2 \
  --query 'Environment.Variables' --output json

# Auth function: expect the 60 / 60 / 1440 / 1440 values from template.yml
aws lambda get-function-configuration \
  --function-name prod63k-atlantis-mcp-test-AuthFunction \
  --profile release --region us-east-2 \
  --query 'Environment.Variables' --output json
```

Repeat with `beta` and `prod`. The windows are configured in two places (code defaults and the Auth function's environment). If they ever differ, the profile and the API compute different keys. `TODO.md` already has a 0.0.8 item to consolidate the rate-limit configuration.

## Expected behavior

A tier change starts a fresh window for the new tier on the next request. Each tier's count is independent, the new tier's full limit is available, and `X-RateLimit-Remaining` never exceeds `X-RateLimit-Limit`.

## Possible fix

1. **Put the tier in the key.** Hash `${rawId}${tier}${windowStartMinutes}${salt}` in both `hashClientIdentifier` and `computeSessionKey`, changed in the same release.
   - Deploying it gives every user one fresh window, because every key changes. Public-tier keys can keep their current form if only authenticated keys gain the tier.
2. **Compare the cache entry's tier** as well as its window start, so a warm container does not serve the old tier's count.
3. **One implementation for both functions.** The two key functions are copies kept equal by a comment. After 0-0-7 the Read function attaches five layers, the Lambda maximum, so a shared version would go into the existing `tier-common` layer rather than a new one.
4. **Tests.** A property test that two different tiers never produce the same key for the same user and time, and a parity test between the Read function's and the Auth function's key functions.

## Open points for planning

- Tier in the key, or the window length and limit in the key.
- Whether the one-time reset at deployment is acceptable, or whether the change should deploy near 00:00 UTC.
- Whether public keys change too.
- Whether the key function moves into `tier-common`.
- Whether `X-RateLimit-Remaining` should also be capped at the limit, as a guard.

## How to re-check

```bash
# From application-infrastructure/src/lambda/read-function, with dev dependencies installed
PARAM_STORE_PATH=/x/ AWS_REGION=us-east-2 node -e '
const { TestHarness } = require("./utils/rate-limiter");
const { nextIntervalInMinutes: next, hashClientIdentifier: h } = TestHarness.getInternals();
const key = (win) => h("example-sub", next(win) - win, "example-salt");
const real = Date.now;
Date.now = () => Date.parse("2026-11-02T14:00:00Z");
console.log("paid==private:", key(1440) === key(1440)); // today: true for any time of day
Date.now = () => Date.parse("2026-11-02T00:30:00Z");
console.log("registered==paid at 00:30:", key(60) === key(1440)); // today: true
Date.now = real;
'
```

After a fix that puts the tier in the key, both lines print `false` when the call passes different tiers.

## Related documentation

- [0-0-7-lapsed-tier-downgrade requirements](../0-0-7-lapsed-tier-downgrade/requirements.md), where this was found
- [Rate limits page](../../../application-infrastructure/src/static/public/docs/rate-limits/index.html)
- [User management](../../../docs/admin-ops/user-management.md) and [voucher management](../../../docs/admin-ops/voucher-management.md)
