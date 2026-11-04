# Lapsed voucher tiers and account lifetime for non-registered tiers

> **Status**: Locked, 2026-11-02 (amended 2026-11-02 for U6, the remembered lower tier)
> **Issue**: [ISSUE.md](ISSUE.md) (lapsed tiers) and [GitHub issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5) (account lifetime), now planned together
> **Reviewed against**: `dev` at `71251f0` on 2026-11-02 (the issue was checked against `7acaf7d`; the files it cites are unchanged since, see row 14 of section 2)

## 1. Summary

Two defects share one function, `refreshTtl` / `computeEffectiveTier` in the Read function's `auth-resolver.js`, and one cause: the code and the stored data disagree about what a non-registered user is.

- **Issue #5.** Only free `registered` users have their Users record renewed when they use their key. A `private` or `paid` user's record is deleted by DynamoDB TTL about 120 days after its last write, and the cleanup function then deletes the Cognito account, however often the key is used. This includes the private-tier key the post-deploy verifier uses.
- **This issue.** `computeEffectiveTier` compares the ISO 8601 string in `tierExpiresAt` with epoch seconds, so the comparison is always false and a lapsed voucher keeps its paid or private tier. The profile page uses a different check that works, so the profile and the API disagree.

You asked for one plan with two phases, each deployable on its own through `dev → test → beta → main`:

| Phase | What changes | Template change | Fixes |
|-------|--------------|-----------------|-------|
| **1** | On use, renew `ttl` for every authenticated record **that has no end date** (`tierExpiresAt` null or absent) by the existing rule (fewer than 90 days left, set to now + 120 days). Add an `attribute_exists(pk)` guard to the update | None | Issue #5 for users without an end date (permanent `private`, admin `paid`, `registered`) |
| **2** | Read `tierExpiresAt` correctly through a shared `tier-common` layer. When a tier has lapsed, persist the downgrade: `tier = registered`, `tierExpiresAt = null`, `ttl = now + 120 days` (no 90-day check). From then on the user is an ordinary registered user. Renew finite-expiry users while their tier is active. Voucher redemption never lowers a tier or shortens an expiry, and a higher voucher remembers the lower tier it replaces so that the lapse restores it (N7, L8, U6). Narrow the Read role's Users table access (N11) | One layer, two `Layers` entries, one narrowed IAM statement | The lapsed-tier issue; issue #5 for voucher and temporary users; N7; N11 |

Phase 1 skips records that have an end date (Q9 = A). Renewing a user whose voucher has lapsed would keep them on paid limits indefinitely, which issue #5 warns about, and phase 1 ships before the expiry check is fixed. Voucher and temporary users therefore keep today's behavior until phase 2.

## 2. Assessment of the issues

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Writers store `tierExpiresAt` as an ISO 8601 string (or `null`) | Confirmed | `auth-function/services/voucher-redeem.js:99` (`toISOString()`), `:103` passes it to `UserDao.updateUserTier`; `models/user.js:163-172` writes it; `handlers/post-confirmation.js:160-162` writes `null`; `services/key-regenerate.js:80` copies the stored value; admin command in `docs/admin-ops/user-management.md` uses `"2026-12-31T00:00:00Z"` |
| 2 | Design, docs, and OpenAPI all specify the string | Confirmed | `0-0-3-add-authentication/design.md:511` and `:477`; `user-management.md:39`; `template-openapi-spec.yml` (both `tierExpiresAt` schemas are `type: string`) |
| 3 | The Read function compares against epoch seconds | Confirmed | `read-function/utils/auth-resolver.js:113-114`; JSDoc says "Unix epoch seconds"; `resolveAuth` uses the result at `:323` |
| 4 | Reproduction table (ISO past stays `paid`, epoch past gives `registered`, `private` stays, ISO future stays) | Confirmed | Real function through `TestHarness.getInternals()`: ISO past `paid`→`paid`, epoch-seconds past→`registered`, `private` ISO past→`private`, ISO future→`paid` |
| 5 | The profile check handles ISO strings, so the profile shows `registered` while the API enforces `paid` | Confirmed | `auth-function/services/profile.js:37-41`. `auth-function` has no `node_modules`, so I evaluated a verbatim copy of its three lines: ISO past→`registered`, ISO future→`paid` |
| 6 | The profile check would invert for epoch seconds | Confirmed | Same copy: epoch-seconds in the future→`registered` (`new Date(<seconds>)` is January 1970) |
| 7 | No test crosses the formats | Confirmed, worse | Read tests use integers only (`auth-resolver.property.test.js:119-168`, `auth-resolver-preservation.property.test.js:96-140`, `ttl-refresh.property.test.js:235-258`, `unit/utils/auth-resolver.test.js:199-220`). `auth-function/tests/property/effective-tier.property.test.js:7-26` tests an **inline copy**, not `services/profile.js` |
| 8 | A lapsed `paid` user keeps 3,000 requests/day and semantic search | Partially confirmed | Code path confirmed: the tier from `resolveAuth` feeds `rate-limiter.js:387` and `services/documentation.js:183` (`DocAiMinTier`). Deployed `EnableDocAi` / `DocAiMinTier` per stage not checked by me |
| 9 | Only `ttl` ends a lapsed user's access, and that deletes the account | Confirmed | `auth-resolver.js:164-173`; sibling plan [`0-0-7-postdeploy-smoke-verification/PLAN.md`](../0-0-7-postdeploy-smoke-verification/PLAN.md) finding 5 |
| 10 | A voucher of 120 days or longer never lapses | Confirmed | `voucher-redeem.js:100` sets `ttl = now + 120 days`; nothing renews it; the record is deleted first |
| 11 | Redemption sets Cognito `custom:tier`, nothing resets it, nothing reads it | Partially confirmed | Set at `voucher-redeem.js:108-110`, never reset. The profile page **does** read it as an error fallback: `static/public/profile/index.html:350` and `:366`. `user-management.md:133` says the profile page reads tier from Cognito, which is no longer true on the success path |
| 12 | The docs promise the downgrade | Confirmed | `user-management.md:143,146`; `ARCHITECTURE.md:495-498`; `0-0-3-add-authentication/requirements.md:110` (R5.3); design property 5 |
| 13 | Deployed state: one lapsed `paid` record on `test`, none on `beta`/`prod` | Unverifiable by reading | I scanned nothing. See Q7 |
| 14 | The code has not moved since the issue was checked | Confirmed | `git diff 7acaf7d HEAD` on `auth-resolver.js` is one unrelated hunk (`id: null` removed from the 401 body). `profile.js` and `voucher-redeem.js` are unchanged |
| 15 | **#5**: use renews `ttl` only for free `registered` users | Confirmed | `auth-resolver.js:164-173` returns early when the effective tier is not `registered` and again when `tierExpiresAt != null`. `ttl-refresh.property.test.js:205` and `:235` assert both |
| 16 | **#5**: every write sets `ttl` to now + 120 days | Confirmed | `post-confirmation.js:252`, `key-regenerate.js:67`, `voucher-redeem.js:100`, admin commands (`user-management.md:66,98`) |
| 17 | **#5**: TTL deletion triggers the cleanup function, which deletes the Cognito user | Confirmed | `template.yml:1010-1014` (Users table stream, `OLD_IMAGE`); `cleanup-function/index.js:140-150` (`isUserRecord` accepts `KEY#` records), which calls `AdminDeleteUser` for the record's `cognitoSub` |
| 18 | **#5**: a voucher longer than 120 days loses the account before its term ends | Confirmed | Same arithmetic as row 10 (`voucher-management.md` documents a 365-day example) |
| 19 | **#5**: the admin docs say `ttl` is "120 days from last activity" and `private` with `null` is "permanent" | Confirmed | `user-management.md:40` and `:144` (line numbers differ by one from the issue's v0.0.6 numbers) |
| 20 | **#5** comment: key lifetime may be reviewed later (OAuth, short-lived keys, expiry messaging) | Noted | Comment of 2026-10-27. Your decision here (renew on use) matches the current behavior for registered users and does not block the later review |

### Not in the issues

| # | Finding | Evidence |
|---|---------|----------|
| N1 | The two checks disagree on an empty string: Read treats `""` as expired, the profile treats it as no expiry | Local evaluation |
| N2 | An epoch value in milliseconds never expires in the Read function and is always expired in the profile | Local evaluation |
| N3 | An unparseable string (`"not-a-date"`) fails **open** in both functions | Local evaluation |
| N4 | The boundary differs: Read uses `<=`, the profile uses `<` | `auth-resolver.js:114`, `profile.js:38` |
| N5 | After a lapse is detected correctly, `refreshTtl` would still skip the user (`tierExpiresAt` non-null), so an active account is deleted at its original `ttl`. Resolved by U3 | `auth-resolver.js:170-173` |
| N6 | The profile returns the stored (past) `tierExpiresAt` for a lapsed user, and the page prints "Tier expires <past date>" next to "Registered". Phase 2 clears it on the user's first request after a lapse; it stays visible only between the lapse and that request | `profile.js:122`, `profile/index.html:240-246` |
| N7 | `redeemVoucher` overwrites the stored tier without comparing it. A permanent `private` user who redeems a `paid` voucher becomes `paid` with an expiry and, after phase 2, ends at `registered` | `voucher-redeem.js:98-103` |
| N8 | An unknown stored `tier` makes the profile throw (`rateLimits[effectiveTier]` is `undefined`, then `.windowInMinutes`) | `profile.js:93-100` |
| N9 | `user-management.md:133` ("the static site profile page reads from Cognito") is stale | `profile/index.html:340-342` |
| N10 | **The existing TTL refresh can create a stub record.** `UpdateItem` creates the item when it does not exist, and the update has no condition. Key regeneration deletes the old record and then writes a new one (`key-regenerate.js:70-82`, two separate calls). A refresh that lands between the two, or after, writes `{ pk, ttl }` for the old key. A request with the old key then finds a record (`tier` and `cognitoSub` undefined), is treated as authenticated at the public limits, and the revoked key keeps working until that stub's `ttl` passes. The window is narrow today (registered users only, at most once per ~30 days) and widens when every tier is renewed | `auth-resolver.js:183-191` (no `ConditionExpression`), `key-regenerate.js:70-82` |
| N11 | The Read function's role may `GetItem` and `UpdateItem` on the whole Users table with no attribute or key condition. It can already change any user's `tier`. Phase 2 makes that capability intentional, so the policy is worth narrowing | `template.yml:1956-1962` |
| N13 | `strategyLabelFor` ranks tiers with `{ public, authenticated, paid, private }`. The tier name used everywhere else is `registered`, so a `registered` caller ranks 0 (same as public), and `DOC_AI_MIN_TIER=registered` (an allowed value in `settings.js:155-159`) silently falls back to `paid`. No effect at the default `paid`; this plan does not touch it. Noted so the shared rank table in the new layer is not mistaken for the same bug | `services/documentation.js:181-183` |
| N12 | The renewal write is fire-and-forget (the promise is not awaited in `index.js`), so Lambda can freeze before it completes. The write is idempotent and is retried on the next request while fewer than 90 days remain, so a lost write only delays renewal | `auth-resolver.js:183-193`, `index.js:133` |
| N14 | **A higher voucher replaced the lower tier outright** (found in the final review). A `paid` user, including a permanent admin-granted `paid`, who redeems a `private` voucher ends at `registered` when the private tier lapses, because the paid tier and its end date were overwritten. Requirement 11.10 as first written checked only the rank at redemption and the same-tier end date, so it passed while this happened. Resolved by U6 | `voucher-redeem.js:98-103` |
| N15 | Key regeneration copies `email`, `tier`, `cognitoSub`, and `tierExpiresAt` by name into a new record, so any other attribute is dropped. The fallback attributes of U6 would be lost the first time a user regenerates a key. Resolved by D27 | `key-regenerate.js:70-82` |

## 3. Current state

```text
voucher / admin / registration ──writes──▶ Users table: { tier, tierExpiresAt: ISO string | null, ttl: epoch s }
                                                   │                                    │
                                                   │                       DynamoDB TTL deletes the record
                                                   │                                    ▼
                         ┌─────────────────────────┴──────────┐        stream (OLD_IMAGE) ▶ cleanup-function
                         ▼                                    ▼                           ▶ AdminDeleteUser (Cognito)
        Read function (API traffic)               Auth function (/auth/profile)
        computeEffectiveTier: epoch SECONDS       computeEffectiveTier: new Date(x) < new Date()
        refreshTtl: registered users only         read-only
              │                                          │
              ▼                                          ▼
   rate limit, X-RateLimit-Limit, DocAiMinTier     tier + limits shown on /profile/
```

Why it is this way: `0-0-3-add-authentication/design.md` ("TTL Strategy", lines 520-530) wants inactive accounts cleaned up and says paid records are renewed "when a subscription hook updates `tierExpiresAt`". No such hook exists; the only writer is voucher redemption, which happens once. It also says the Read function must not rewrite `tierExpiresAt` on lapse. Your U3 reverses that sentence on purpose (D5 is superseded). The comparison bug came from the data model saying "string" while the Read function was written against epoch seconds like `ttl`. `git log` shows the files were last touched for unrelated reasons, so no earlier deliberate decision is being undone, except the "skip downgraded paid users" guard, which neither the code nor the design explains (issue #5, "Possible fix" item 3).

Layers already in the repository: `doc-ai-common` and `search-common` under `src/lambda/layers/`, attached in `template.yml:732,757`, loaded through a `loadLayerModule` indirection with an environment-variable override for tests (`read-function/models/doc-index.js`, `jest.setup.js`). `buildspec.yml` builds and tests every directory under `layers/` automatically. The auth function attaches no repository layer today.

## 4. Review

### 4.1 Security

- **Trust boundary.** `tierExpiresAt` and `ttl` are written only by the auth function (after Cognito authentication, from admin-created vouchers) and by admins with DynamoDB write access. A caller cannot supply either. The flaws are entitlement retention (lapsed tier) and unintended account deletion (issue #5), not injection paths.
- **Phase 2 adds a privileged write on the public hot path.** The Read function will change `tier` on a user record. Controls: write only when `tierExpiresAt` parses as valid ISO 8601 **and** has passed (never on a malformed value, so bad data is not silently overwritten); a conditional update (`attribute_exists(pk)`, stored `tier` and stored `tierExpiresAt` unchanged) so a concurrent voucher redemption or key regeneration is never clobbered; the Downgrade writes `registered`, or restores a tier the Auth function recorded earlier and only when that tier ranks below the lapsed one (U6, D24), so the Read function never grants a tier the user did not already hold.
- **IAM (N11, folded into phase 2 by Q8).** No new action is needed; `UsersTableAuthAccess` (`template.yml:1956-1962`) already grants `GetItem` and `UpdateItem` on the whole table and is the only statement that covers it. The Read function touches the Users table in exactly two places: a `GetItem` (`auth-resolver.js:292`) and the `UpdateItem` (`:184`). The fix splits the statement and adds DynamoDB condition keys, per the [AWS fine-grained access control guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html):
  - `dynamodb:LeadingKeys` limited to `KEY#*` on both actions (`ForAllValues` is required; with a prefix this needs `StringLike`), so the role can no longer reach `VOUCHER#` items.
  - `dynamodb:Attributes` on `UpdateItem` limited to `pk`, `tier`, `tierExpiresAt`, `ttl`, `fallbackTier`, `fallbackExpiresAt`. The guide says the key attribute must be listed, and that the key counts attributes named anywhere in the request, including the condition expression.
  - `dynamodb:Attributes` is evaluated against the request's attribute list, and a `GetItem` with no `ProjectionExpression` has none, so applying it to `GetItem` requires the code to send `ProjectionExpression: 'pk, tier, tierExpiresAt, ttl, cognitoSub, fallbackTier, fallbackExpiresAt'` (the fields `resolveAuth` uses). Pair it with `dynamodb:Select` / `dynamodb:ReturnValues` conditions as the guide recommends so the restriction cannot be sidestepped.
  - Failure modes: a wrong `GetItem` condition turns every authenticated request into `degraded` public-tier traffic (loud, caught on `test` at once); a wrong `UpdateItem` condition makes renewal and downgrade fail with only a warning log (quiet). The `test` verification in section 6 therefore checks both. If the attribute conditions misbehave, the fallback is `LeadingKeys` alone, which still removes access to voucher records.
  - I could not evaluate the policy offline; IAM condition keys for DynamoDB are verified on `test`, not simulated.
- **Fail open versus closed (locked, Q2 = A).** A non-null value that does not parse is treated as expired for limits and tier gating, with one warning log.
- **Revoked keys (N10).** The `attribute_exists(pk)` guard closes a revocation gap in which a regenerated-away key could be revived as a stub. It belongs in phase 1 because phase 1 makes the update run for more users.
- **Logging.** The warning for a malformed value and the audit line for a downgrade carry the tier and a truncated value only; never `pk`, email, or `cognitoSub`.
- **Parser strictness.** `new Date(x)` accepts many non-ISO strings and reads offset-less date-times in the host time zone. A strict, bounded pattern (no nested quantifiers) removes that variance and any ReDoS exposure.
- **Disclosure.** The repository has a public GitHub remote, and issue #5 is already public. Neither issue has an attacker-controlled input. No embargo is needed. Keep identifiers out of `ISSUE.md`, `PLAN.md`, and logs.

### 4.2 Software engineering

- **Root cause of the first issue is duplication.** Two implementations plus an inline test copy drifted. One shared implementation (Q3 = A) removes the class of bug.
- **One rule for renewal and downgrade.** Both are the same write shape (`ttl = now + 120 days`) under different eligibility rules. Phase 1 is eligibility-only; phase 2 adds the lapse branch. Keep both in `auth-resolver.js`, split into small functions (`renewTtlIfDue`, `downgradeLapsedTier`) behind `resolveAuth`, which stays the only entry point.
- **Expired means `expiresAt <= now`** in both functions (D3).
- **Backward compatibility.** Stored data is all strings or `null`, so no migration. The profile response shape is unchanged. Rate-limit headers for lapsed users change from paid to registered values, which is the point.
- **Tests that change.** Phase 1: `ttl-refresh.property.test.js` (assertions at `:205` and `:235` change), `unit/utils/auth-resolver.test.js`. Phase 2: the four integer-epoch files (row 7) switch to ISO strings; `effective-tier.property.test.js` tests the real function; new downgrade tests (write shape, conditions, no write on malformed, no write on null or future, `ConditionalCheckFailedException` swallowed); voucher redemption tests for the Q10 rule (`voucher-redeem-service.test.js`, `voucher-redeem-response.property.test.js`, `voucher-validation.property.test.js`); a `GetItem` test that asserts the `ProjectionExpression`.
- **Documentation.** Phase 1: `user-management.md` (the `ttl` row becomes true; state what renews), `voucher-management.md` (step 4 and the long-voucher example), `docs/developer/post-deploy-verification.md:195` and `docs/admin-ops/post-deploy-verification.md:261` (remove the known-limit text and the workaround), `CHANGELOG.md` (Fixed). Phase 2: `user-management.md` (format, lapse behavior, remove stale `:133`), `ARCHITECTURE.md` (flowchart node "Downgrade to registered tier" now persists; layer), JSDoc on `computeEffectiveTier` in both functions, `CHANGELOG.md` (Fixed and a Changed entry for the persisted downgrade, since it reverses a design statement). `template-openapi-spec.yml` needs no change.

### 4.3 Cloud engineering

- **Write volume.** Phase 1: each active user is written at most once per ~30 days (a renewal sets `ttl` to 120 days; the next renewal is due when 90 remain). Phase 2 adds one write per lapse. Both are single-item `UpdateItem` calls on an existing role; negligible cost.
- **Rollout.** `beta` and `prod` deploy the Read function gradually through the `live` alias (about 30 minutes, `docs/developer/gradual-deployment.md`). Old and new versions answer side by side. Phase 1: both versions write the same attribute with the same value, so the overlap is harmless. Phase 2: during the shift, a lapsed user may be served by the old version (stored paid) or the new one (downgrade written); the write is conditional on the stored values, so repeats are no-ops. I did not trace the Sessions key derivation in `rate-limiter.js` to confirm that a tier change starts a clean rate-limit window; the design should confirm that.
- **Layer (phase 2).** Same properties as `SearchCommonLayer`, `RetentionPolicy: Delete`. A layer that fails to load fails the new version at cold start; `ReadLambdaErrorsAlarm` rolls the PROD alias back and `test` deploys first.
- **Time-sensitive data risk before phase 1 reaches `prod`.** Any `private` or `paid` record whose `ttl` passes before phase 1 is live is deleted, with its Cognito account, and cannot be restored. `prod` has two permanent `private` users and `beta` has one (issue's deployed-state table). Their `ttl` values are unknown to me. Q7 = A schedules a read-only `ttl` scan before the phase 1 merge to `main`, with the issue's `REMOVE #ttl` workaround as the stopgap (section 6, Verification).
- **Stages.** `test` deploys immediately and holds the only lapsed record, which makes it the verification stage for both phases.
- **Observability.** One warning log for a malformed value; one structured info line per persisted downgrade (`tier_lapse_downgrade`, from-tier only). No new metric or alarm.
- **Offline check.** After the phase 2 `template.yml` edit, run the repository's offline SAM translator check to confirm the `McpV1Post` integration still targets `live`.

## 5. Gaps and observations

- `ISSUE.md` covers the lapsed-tier defect only. Issue #5 is incorporated here by reference (full text read on 2026-11-02). If you want `ISSUE.md` to carry #5 as well, it needs editing outside this skill; the spec directory name is also now narrower than the scope.
- "An expiration 120 days out" in your message is read as the record's `ttl` (the same field and rule used for the other tiers), not `tierExpiresAt`. Registered users have no tier expiry. See D10.
- Phase 2 downgrades a user on first use after a lapse. A lapsed user who never makes an API request keeps the stored tier until `ttl` deletes the record. That is correct (an inactive account is cleaned up) but means the stored table can contain lapsed rows; the profile endpoint computes the effective tier and stays read-only (D13).
- The issue's "How to re-check" snippet works as written (prints `paid` today). After phase 2 it prints `registered`; it becomes the first line of the verification section in `design.md`.
- The deployed-state numbers in `ISSUE.md` are 12 days old; the pre-merge scans in section 6 refresh them.
- The final review (2026-11-02) added U6 after asking what happens to a `paid` user who redeems a `private` voucher. `requirements.md`, `design.md`, and `tasks.md` were amended together with this plan. The Downgrade now has two shapes (restore or `registered`), which changes the layer's result, the Read function's `GetItem` projection, the IAM attribute lists, and the Auth function's key regeneration.
- `TODO.md` lists two 0.0.8 items that touch the same area: "Ensure keys expire after 120 days" and "Display api key expiration date on profile page". This plan renews a record while its key is in use (U2), so a key in regular use does not expire at 120 days; only an unused one does. If the 0.0.8 item means a hard 120-day key lifetime regardless of use, it will change the renewal rule introduced here. That is a later policy change, not a conflict for 0.0.7: the 90-day / 120-day constants stay in one place (section 8), and the docs written in phase 1 should say "renewed while the key is in use" rather than "keys never expire".

## 6. Proposed approach

### Phase 1: renew `ttl` on use (issue #5)

**Scope:** `read-function/utils/auth-resolver.js` only, plus tests and docs. No template change, no layer, no new IAM.

**Behavior:**

| Authenticated record | Phase 1 renewal (Q9 = A) |
|----------------------|------------------------------|
| `ttl` more than 90 days away | no write |
| `ttl` within 90 days, `tierExpiresAt` null or absent (any tier) | set `ttl = now + 120 days` |
| `ttl` within 90 days, `tierExpiresAt` non-null | **not renewed** (Q9 = A; today's behavior until phase 2) |
| `ttl` missing | no write (the record never expires) |

**Changes:**
1. `refreshTtl(pk, record)` loses the `effectiveTier !== 'registered'` early return and its `effectiveTier` parameter (D15). The `tierExpiresAt != null` guard stays (L7) and is removed in phase 2.
2. The update adds `ConditionExpression: 'attribute_exists(pk)'` and treats `ConditionalCheckFailedException` as a debug-level no-op (D14, N10).
3. Still non-blocking, still one write, same 90 / 120 day constants.
4. Tests: change `ttl-refresh.property.test.js:205` to "every tier with `tierExpiresAt` null and `ttl` within 90 days triggers a refresh"; keep `:235` (a record with an end date is not renewed) and the 90-day boundary tests; add a condition test and a swallowed-conditional-failure test.
5. Docs and `CHANGELOG.md` as listed in 4.2, worded "renewed while the key is in use" (see section 5, `TODO.md`). Comment on issue #5 when phase 1 reaches `main`; close it after phase 2.

**Pre-merge scan and verification (Q7 = A):** see "Verification" below.

**Deployable alone:** yes. Rollback is a revert; already-extended `ttl` values are harmless.

### Phase 2: correct expiry check and persisted downgrade (this issue, plus the rest of #5)

**Behavior (one rule, both functions):**

| Stored `tierExpiresAt` | Effective tier | Writes by the Read function |
|------------------------|----------------|-----------------------------|
| `null` or absent | stored tier | renew `ttl` if due |
| Valid ISO 8601 and after now | stored tier | renew `ttl` if due |
| Valid ISO 8601 and at or before now | the remembered lower tier if it still holds (U6), otherwise `registered` | **downgrade**: `tier = registered` (or restore the remembered tier and its end date), `tierExpiresAt = null` (or the restored end date), `ttl = now + 120 days`, and remove the fallback attributes |
| Anything else non-null (number, `""`, unparseable string, boolean, object) | `registered` (fail closed) | renew `ttl` if due; **no downgrade**; one warning log |

Accepted ISO grammar (D2): `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm[:ss[.fff]]` with a mandatory `Z` or `±HH:mm`. Date-only means 00:00 UTC. An offset-less date-time is malformed.

**Persisted downgrade (U3, D11):**

```javascript
// Shape only; the exact code belongs in design.md
await AWS.dynamo.update({
  TableName: usersTableName,
  Key: { pk },
  UpdateExpression: 'SET #tier = :registered, tierExpiresAt = :none, #ttl = :newTtl',
  ConditionExpression: 'attribute_exists(pk) AND #tier = :storedTier AND tierExpiresAt = :storedExpiry',
  ExpressionAttributeNames: { '#tier': 'tier', '#ttl': 'ttl' },
  ExpressionAttributeValues: {
    ':registered': 'registered', ':none': null, ':newTtl': nowSec + ONE_TWENTY_DAYS_SEC,
    ':storedTier': record.tier, ':storedExpiry': record.tierExpiresAt
  }
});
```

- Fire-and-forget like the renewal, same non-blocking contract. The current request already uses the in-memory effective tier (`registered`).
- `tierExpiresAt = null` matches what registration writes (`post-confirmation.js:160-162`), so a downgraded record is indistinguishable from a normal registered one, and from then on the phase 1 rule renews it.
- `ttl = now + 120 days` is unconditional (no 90-day check), as you specified.
- A failed condition means the record changed under us (new voucher, key regeneration); log at debug and do nothing.
- One info line `tier_lapse_downgrade` with the from-tier (D16).

**Structure (Q3 = A):**
- New layer `src/lambda/layers/tier-common/` with `nodejs/effective-tier.js` exporting `parseTierExpiry(value)` and `computeEffectiveTier(storedTier, tierExpiresAt, nowMs = Date.now())`. Pure, no dependencies, no AWS calls. It returns the effective tier and a state (`none`, `active`, `lapsed`, `malformed`) so callers choose the write.
- Both functions load it like `search-common` (default `/opt/nodejs`, environment override for tests, fail-fast at require time). `ReadLambdaFunction` and `AuthLambdaFunction` list `TierCommonLayer` (`${Prefix}-${ProjectId}-${StageId}-TierCommon`).
- `auth-resolver.js` and `profile.js` keep their local `computeEffectiveTier` name and `TestHarness` export and delegate (D7). The profile writes nothing (D13).
- Phase 1's carve-out for finite-expiry records is removed: an active finite-expiry user is renewed like anyone else, and a lapsed one is downgraded.

**Voucher redemption never lowers a tier or shortens an expiry (N7, L6, L8):**
- The layer also exports the tier rank (`public` 0, `registered` 1, `paid` 2, `private` 3) so the auth function's `redeemVoucher` and the Read function agree on order. This is separate from the table in `services/documentation.js` (N13).
- `redeemVoucher` computes the user's **effective** tier with the shared function (a lapsed `paid` user counts as `registered`; a stored tier with a malformed expiry also counts as `registered`, so redeeming a higher voucher replaces the bad value). It then applies the rule below before it increments the voucher's use count, so a rejected redemption does not consume a use.

| Voucher `targetTier` compared with the user's effective tier | Result |
|--------------------------------------------------------------|--------|
| Higher | Apply: `tier = targetTier`, `tierExpiresAt = now + durationDays`, `ttl = now + 120 days`, update Cognito `custom:tier` when the stored tier changes. When the user holds a tier above `registered`, also remember it (`fallbackTier`, `fallbackExpiresAt`); otherwise remove any fallback attributes (U6) |
| Same, user's current expiry is a date | Extend: `tierExpiresAt = later of (current expiry, now + durationDays)`, `ttl = now + 120 days`; Cognito `custom:tier` is not changed |
| Same, user has no expiry (permanent) | Reject: HTTP 400, message names the user's current tier |
| Lower | Reject: HTTP 400, message names the user's current tier |

Rejections write nothing and do not increment `currentUses` (D20). A voucher whose `targetTier` is `registered` ranks as the same tier or lower for every user and is therefore always rejected.
- The write becomes conditional on the stored `tier` and `tierExpiresAt`, the same shape as the downgrade, so it cannot clobber a concurrent lapse-downgrade or a second redemption. A failed condition returns a retryable error.
- Cognito `custom:tier` is updated only when the stored tier actually changes.

**Remembered lower tier (U6, L9):**

The final review (2026-11-02) asked what happens when a `paid` user redeems a `private` voucher and the private tier ends. As first written, the paid tier and its end date were overwritten, so the user ended at `registered` even if the paid tier had months left, or was permanent (N14). Option B fixes it: a higher voucher remembers the tier it replaces, and the lapse restores it.

- **Record.** Two optional attributes on the User record: `fallbackTier` (string) and `fallbackExpiresAt` (ISO 8601 string, or `NULL` for a tier with no end date). Both absent means nothing is remembered (D22).
- **Capture.** When a redemption applies a tier and the user currently holds a tier ranked above `registered`, the written record carries `fallbackTier` = that tier and `fallbackExpiresAt` = its end date (or `NULL`). "Holds" means the effective tier, including a tier that is only held through a remembered fallback (D23). When the user holds nothing above `registered`, the redemption removes both attributes.
- **Effective tier and restore** (one rule, both functions):

| Main tier end date | Remembered tier | Effective tier | Downgrade writes |
|--------------------|-----------------|----------------|------------------|
| `none` or `active` | any | stored tier | none (renewal as usual) |
| `lapsed` | valid | the remembered tier | `tier` = remembered tier, `tierExpiresAt` = its end date (or `NULL`), `ttl` = now + 120 days, remove both fallback attributes |
| `lapsed` | absent, lapsed, malformed, or invalid | `registered` | `tier = registered`, `tierExpiresAt = NULL`, `ttl` = now + 120 days, remove both fallback attributes |
| `malformed` | any | `registered` | none (fail closed, warning) |

- **Valid** means: the tier is a known tier ranked above `registered` and below the lapsed tier, and the end date is `none` or `active` (D24). The "below the lapsed tier" test means the Read function can restore only a tier the user held under a higher one, never raise a tier past what the record says.
- **Examples.** Paid until 2027-08-29, then a 30-day private voucher: private for 30 days, then paid until 2027-08-29, then `registered`. Permanent paid, then a 30-day private voucher: private for 30 days, then permanent paid. Paid with 10 days left, then a 30-day private voucher: `registered` after 30 days, because the paid time ran out first.
- **Same-tier voucher on a restored tier.** If the user holds `paid` only through a remembered fallback (the private tier has lapsed but not yet been written back) and redeems a `paid` voucher, the redemption writes `tier = paid` with the later end date and removes the fallback attributes (D26).
- **Key regeneration** copies both attributes to the new record when present (D27, N15). `key-regenerate.js` therefore joins the scope.
- **Admin edits.** The admin commands in `user-management.md` gain `REMOVE fallbackTier, fallbackExpiresAt`, so a hand promotion does not carry a stale fallback (D28).
- **Profile and Cognito.** The profile computes the same result through the layer, reading the two attributes, and returns neither (D30). Cognito `custom:tier` is not changed on a restore, as for any lapse (L4, D29).
- **Verified by simulation.** I modelled the rule outside the repository and ran 83,185 random records and vouchers: after every successful redemption, and after the Downgrade on the first request after the new tier lapses, the user's tier was never lower than before the redemption at any later instant (0 violations). Requirement 11.10 and design property P8 now state that property.

**Narrowed IAM for the Read role (N11, folded in by Q8):**
- `UsersTableAuthAccess` splits into a `GetItem` statement and an `UpdateItem` statement with the condition keys in 4.1. `auth-resolver.js:292` gains a `ProjectionExpression`.
- Order of work inside the phase: layer and code first, IAM change last, so a failure on `test` is attributable to one change.
- Run the offline SAM translator check (4.3) after the `template.yml` edits.

**Tests:** layer property tests (past, future, boundary, null, malformed, grammar edges); both consumers run the same generated inputs; the four integer-epoch files move to ISO; the inline copy in the auth function is replaced by the real function; downgrade tests, voucher rule tests, and the projection test as listed in 4.2.

**Deployable alone (after phase 1):** yes. Rollback of code leaves downgraded records as `registered`, which is the intended end state; reverting the template restores the wider IAM statement.

### Verification (Q7 = A)

I run none of these without your go-ahead. Each is read-only except the steps marked as a write, which you perform.

| When | Step |
|------|------|
| Before the phase 1 merge to `main` | Read-only scan of the Users tables on `test`, `beta`, `prod`, projecting only `tier`, `tierExpiresAt`, `ttl` for `KEY#` records. If any non-registered `ttl` is within about 30 days, extend it first with the `REMOVE #ttl` stopgap from issue #5 (a write you perform) |
| Phase 1 on `test` | Set one throwaway user's `ttl` to about 60 days out (write), send one request with that user's key, re-read `ttl`; expect about 120 days out |
| Phase 2 on `test`, renewal and downgrade | Log in as the lapsed `paid` user, regenerate the key (copies `tierExpiresAt`, resets `ttl`), send one request; expect `X-RateLimit-Limit: 100`, the record now `registered`, `tierExpiresAt` null, `ttl` about 120 days out |
| Phase 2 on `test`, IAM | After the same request, search the Read function's log group for `AccessDeniedException` against the Users table (read-only); expect none. A `degraded: true` auth result means the `GetItem` condition is wrong; a renewal or downgrade that never lands with a warning log means the `UpdateItem` condition is wrong |
| Phase 2 on `test`, voucher | Redeem a lower-tier voucher as a higher-tier user; expect the Q10 outcome and the voucher's `currentUses` unchanged |
| Phase 2 on `test`, restore | With a throwaway `paid` user, redeem a `private` voucher (write), read the record (tier `private`, `fallbackTier` `paid`), set `tierExpiresAt` to a past instant (write), send one request; expect `X-RateLimit-Limit` of the paid tier, and the record back to `paid` with its original end date, the fallback attributes gone, and `ttl` about 120 days ahead. This also proves the narrowed IAM allows the `REMOVE` and the larger projection |
| Before the phase 2 merge to `main` | Repeat the lapsed-record scan |

### Order and release path

Each phase is a normal verify pass: commit on `dev`, merge `dev → test → beta → main`, each push running that stage's pipeline. `CHANGELOG.md` stays `(unreleased)` under v0.0.7 with one entry per phase; the prepare pass (dating the version) happens once, whenever you choose to release 0.0.7 (D17).

**Alternatives considered**

| Alternative | Why not chosen |
|-------------|----------------|
| Change the writers and the table to epoch seconds | Moves the bug to the profile, needs a data migration, contradicts the design, docs, OpenAPI, and admin commands |
| Fix the Read function only, leave the profile on its own check | Leaves N1 to N4 and the next drift |
| Two copies plus a byte-equality drift test | Rejected by Q3 = A (conflicts with the "layer or package" steering rule) |
| Accept epoch seconds as well as ISO | Rejected by Q1 = A |
| Persist the downgrade from the auth function's profile endpoint | Only runs when a user opens the profile page, not when they use the key, so an active API user who never opens the page would stay un-downgraded |
| A scheduled sweep that downgrades lapsed records | Adds a Lambda, schedule, and IAM for something use-triggered renewal already covers; the design chose TTL over a scheduler |
| Reject a higher voucher while the user holds a lower tier | Blocks the common upgrade (a paid user buying a private promotion), and the user must wait for the paid tier to end |
| Reject only when the lower tier is permanent | Does not help a user whose paid tier is dated; leaves months of paid lost |
| Put the layer in phase 1 | Phase 1 needs no shared code; keeping it out keeps phase 1 free of template changes |

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| `attribute_exists(pk)` on the TTL update (N10) | Include, phase 1 | Revoked keys can be revived as stub records; renewal for every tier widens the window | S | Low |
| Replace the inline copy in `effective-tier.property.test.js` with the real function | Include, phase 2 | The test keeps passing while the code drifts | S | Low |
| Correct JSDoc on both `computeEffectiveTier` functions and on `refreshTtl` | Include | Both document the wrong or an unverified contract | S | Low |
| Docs: accepted `tierExpiresAt` format, renewal rule, lapse behavior, remove the post-deploy known-limit text, remove stale `user-management.md:133` | Include | Listed in 4.2 | S | Low |
| Cognito `custom:tier` stays at the voucher tier after a lapse | Note only (Q5 = A) | Document it as a display hint that can be stale; fix `user-management.md:133` | S | Low |
| Narrow the Read role's Users table access (N11) | Include, phase 2 (Q8 = C) | Phase 2 makes the capability intentional | S | Med (silent failure on `UpdateItem`; fallback is `LeadingKeys` alone) |
| `redeemVoucher` overwrites a higher stored tier (N7) | Include, phase 2 (Q8 = C, Q10 = A) | After phase 2 the overwrite would otherwise end at `registered` | M | Med |
| Carry the fallback attributes through key regeneration (N15) | Include, phase 2 (U6) | Without it, regenerating a key silently discards the remembered tier | S | Low |
| Admin commands remove the fallback attributes when a tier is set by hand (D28) | Include, phase 2 (U6) | A stale fallback would otherwise be restored later | S | Low |
| Profile shows a past "Tier expires" date between lapse and first request (N6) | Note only (Q8 = A) | Phase 2 clears it on the user's first request after a lapse | S | Low |
| Unknown stored `tier` throws in the profile (N8) | Note only (Q8 = A) | Needs a bad record | S | Low |
| `strategyLabelFor` ranks `authenticated`, not `registered` (N13) | Note only | No effect at the default `DocAiMinTier=paid` | S | Low |
| Key regeneration is delete-then-put, not atomic (`key-regenerate.js:70-82`) | Note only | A crash between the two calls strands the user; independent of this work | M | Med |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Phase 1 renews a lapsed voucher user and keeps them on paid limits until phase 2 | Q9 = A: phase 1 skips records with an end date, so it cannot extend them. Residual: a voucher or temporary user can still lose the account at 120 days until phase 2 reaches `prod` |
| A `private` or `paid` record's `ttl` expires before phase 1 reaches `prod` | Read-only `ttl` scan of non-registered records on all stages before the phase 1 merge to `main` (L5); stopgap `REMOVE #ttl` per issue #5 |
| The narrowed IAM policy blocks `GetItem` or `UpdateItem` (N11) | IAM change is last in phase 2; `GetItem` failure is loud (`degraded` auth) and `UpdateItem` failure is checked in the `test` verification; fallback is `LeadingKeys` only; template revert restores the old statement |
| Phase 2 now carries three kinds of change (code, layer, IAM) plus the voucher rule | Ordered inside the phase (layer and code, voucher rule, IAM last); each has its own tests; `test` verification covers each row; a failed row blocks the merge to `beta` |
| The voucher rule (Q10) rejects a redemption an admin expected to work | Error text names the user's current tier; the voucher's use count is not consumed; `voucher-management.md` documents the rule |
| Phase 2 overwrites a user's tier after a concurrent voucher redemption or key regeneration | Conditional update on `attribute_exists(pk)`, stored `tier`, and stored `tierExpiresAt`; failed condition is a no-op |
| Phase 2 rewrites a record whose `tierExpiresAt` was hand-written in a bad format | No downgrade write on malformed values; fail closed for limits only; warning log; docs state the format |
| A restore returns a user to a tier they should no longer have (stale or hand-edited fallback) | The fallback is restored only if it ranks above `registered`, below the lapsed tier, and its end date is `none` or `active`; admin commands remove the attributes; a bad fallback gives `registered` and a warning |
| Key regeneration drops the fallback attributes (N15) | `key-regenerate.js` copies them when present; tested in the Auth function's key-regeneration tests |
| The renewal or downgrade write is lost when Lambda freezes | Idempotent and retried on the next request while the condition still holds (N12) |
| Fail-closed downgrades a user whose `tierExpiresAt` was hand-written in a non-ISO form | Warning log names the tier and truncated value; the only deployed non-null value is a valid string |
| A layer load failure breaks every request on the new version (phase 2) | Fail-fast at cold start as `search-common` does; PROD `ReadLambdaErrorsAlarm` rolls the alias back; `test` deploys first |
| Mixed versions during the PROD shift give a user two different limits | Accepted; about 30 minutes; only users already past expiry |
| Tests that encode integer epochs or the old early returns fail in CI | List them in `tasks.md`, migrate in the same change, run each function's suite before commit |
| A later review of key lifetime (issue #5 comment) wants shorter-lived keys | This work keeps the 120-day / 90-day constants in one place; changing the policy later is a constant and a doc change |

## 9. Locked decisions

### From your answers and messages

| # | Decision | Rationale |
|---|----------|-----------|
| L1 (Q1 = A) | `tierExpiresAt` is an ISO 8601 string only. Epoch seconds are not accepted | No writer produces a number; one format |
| L2 (Q2 = A) | A non-null value that does not parse is treated as expired (`registered`) and logs one warning | Entitlement checks deny on bad data |
| L3 (Q3 = A) | The rule is shared through a new `tier-common` Lambda layer attached to both functions | Follows the "layer or package" steering rule |
| U1 | Issue #5 is part of this spec. Two phases, each deployable through `dev → test → beta → main`: phase 1 fixes #5, phase 2 fixes the lapsed tier. Supersedes Q6 | Your message of 2026-11-02 |
| U2 | Renew `ttl` on use for every authenticated tier by the current rule: when fewer than 90 days remain, set `ttl = now + 120 days`; keep the non-blocking update | Your message; issue #5 "Possible fix" item 2 |
| U3 | When a tier with an end date lapses, downgrade the user to `registered` with a record expiration 120 days out, using the same logic as other tiers but skipping the 90-day check. Supersedes Q4 | Your message |
| L4 (Q5 = A) | Cognito `custom:tier` is left alone on a lapse. Document it as a display hint that can be stale; correct `user-management.md:133` | Nothing authoritative reads it; no new write path |
| L5 (Q7 = A) | Verification as in the table in section 6: read-only Users table scans before each merge to `main` (phase 1 scan includes `ttl`), hand verification on `test` for renewal, downgrade, IAM, and the voucher rule. I run nothing against a deployed stage without your go-ahead | Tests cannot prove the deployed wiring; a stale `ttl` on `prod` is irreversible |
| L6 (Q8) | **N7 (voucher overwrites a higher tier): fold into phase 2. N11 (narrow the Read role's Users access): fold into phase 2.** N6 and N8: note only | Your answers (N7 = C, N11 = C, N6 = A, N8 = A) |
| L7 (Q9 = A) | Phase 1 renews only records with no end date. Voucher and temporary users keep today's behavior until phase 2 | Adds no way to extend a lapsed tier before the expiry check is fixed |
| U4 | Phase 1 replaces the "Until #5 is fixed…" sentence in the existing v0.0.7 Post-Deploy Smoke Verification changelog entry; the only exception to the changelog convention in this spec | Your message of 2026-11-02, after requirements.md |
| U5 | The Sessions-record collision across tiers (found while writing requirements.md) becomes `0-0-8-rate-limit-record-shared-across-tiers/ISSUE.md` and a 0.0.8 `TODO.md` item; out of scope here | Your message of 2026-11-02 |
| L8 (Q10 = A) | Voucher redemption never lowers a tier or shortens an expiry: higher tier applies, same tier extends to the later expiry (rejected if the user already has it permanently), lower tier is rejected; rejections return HTTP 400, write nothing, and do not consume a voucher use | Easy to state and test; covers both the lower-tier and shortened-expiry cases of N7 |
| U6 | **A higher voucher remembers the lower tier it replaces; when the higher tier lapses, the user is restored to the remembered tier if it still holds, otherwise to `registered`.** Option B of the final review. Amends L8 (Q10) and D11 | Your message of 2026-11-02, after tasks.md |

### Decided in this plan (veto any row)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | The stored format stays an ISO 8601 string. No writer and no stored data changes | Matches every writer, the design, the docs, the OpenAPI schema, and all deployed data |
| D2 | Accepted grammar: `YYYY-MM-DD`, or date-time with optional seconds and fraction and a mandatory `Z` or `±HH:mm`. Date-only means 00:00 UTC. A date-time without an offset is malformed | Removes host-time-zone and V8-leniency variance; the current profile code accepts date-only and every writer emits `Z` |
| D3 | Expired means `expiresAt <= now` in both functions | The Read function's current boundary |
| D4 | `null` and `undefined` mean no expiry | Registration writes `null` |
| D5 | ~~The stored `tierExpiresAt` is never rewritten on lapse~~ **Superseded by U3**; the downgrade clears it (`null`) | `0-0-3-add-authentication/design.md:527` is reversed on purpose; the new design and `CHANGELOG.md` say so |
| D6 | Logs carry tier, value type, and a truncated value; never `pk`, email, or `cognitoSub` | `AGENTS.md` section 6 |
| D7 | Keep the existing `computeEffectiveTier` names and `TestHarness` exports in both functions | No call-site or import churn |
| D8 | New tests are Jest, property tests with fast-check, in each function's `tests/property` or `tests/unit` | `test-requirements` steering |
| D9 | The profile response keeps returning the stored `tierExpiresAt` unchanged | API contract and OpenAPI unchanged |
| D10 | "Expiration 120 days out" in U3 means the record's `ttl`, not `tierExpiresAt` | Registered users have no tier expiry; `ttl` is the field and rule used for the other tiers. Tell me if you meant otherwise |
| D11 | The persisted downgrade writes `tier = registered`, `tierExpiresAt = null`, `ttl = now + 120 days` in one conditional `UpdateItem`, only when the expiry parses and has passed, fire-and-forget | Smallest write that makes the record an ordinary registered record; protects concurrent changes |
| D12 | A malformed `tierExpiresAt` gets registered limits (L2), a warning log, no downgrade write, and the normal `ttl` renewal | Account lifetime follows use (U2) without destroying data that an admin needs to fix |
| D13 | The auth function's profile endpoint stays read-only; it computes the effective tier through the shared layer but writes nothing | Reads should not write; use of the API key, not the profile page, defines activity |
| D14 | The TTL update gets `ConditionExpression: attribute_exists(pk)` in phase 1 | Closes N10 |
| D15 | `refreshTtl(pk, record)` drops the `effectiveTier` parameter | In phase 1 eligibility no longer depends on the effective tier |
| D16 | One info-level structured log line `tier_lapse_downgrade` per persisted downgrade, carrying the from-tier only | Audit trail for a change that overwrites the previous tier |
| D17 | `CHANGELOG.md` keeps one `(unreleased)` v0.0.7 with an entry per phase; the release (prepare pass) is not tied to either phase | Release path in the project memory; `main` already carries unreleased work |
| D18 | N11 is built as: `LeadingKeys` (`KEY#*`) on both statements, `Attributes` (`pk`, `tier`, `tierExpiresAt`, `ttl`) plus `Select` / `ReturnValues` conditions on `UpdateItem`, and a `ProjectionExpression` on the Read function's `GetItem` so the attribute condition can apply. Fallback if `test` shows a failure: `LeadingKeys` only | AWS fine-grained access control guide; keeps the change reversible |
| D19 | The tier rank table (`public`, `registered`, `paid`, `private`) lives in the `tier-common` layer and is used by the voucher rule; `services/documentation.js` keeps its own table (N13) | One definition for the entitlement logic, no scope creep into search gating |
| D20 | A rejected or no-op voucher redemption does not increment `currentUses` and writes nothing | A voucher use is consumed only when it changes the account |
| D21 | The redemption write is conditional on the stored `tier` and `tierExpiresAt`; a failed condition returns a retryable error | Same protection as the downgrade against concurrent changes |

| D22 | The record gains optional `fallbackTier` (string) and `fallbackExpiresAt` (ISO 8601 string, or `NULL` for no end date). Both absent means nothing is remembered | Smallest addition; same format as `tierExpiresAt` |
| D23 | A redemption remembers the user's current holding when it ranks above `registered`. The holding is the effective tier, including a tier held only through a remembered fallback, with its end date | The remembered tier then carries over any chain of redemptions |
| D24 | A fallback is valid only if its tier is a known tier ranked above `registered` and below the lapsed tier, and its end date is `none` or `active`. Otherwise it is ignored (a malformed end date also logs a warning) | The Read function can restore only what the user held under a higher tier |
| D25 | The Downgrade restores or falls back to `registered` in one conditional `UpdateItem` that also removes both fallback attributes. The request is served at the restored tier | One write per request (P7) |
| D26 | A redemption that applies a tier over a user holding no tier above `registered` removes any fallback attributes. A same-tier redemption leaves the fallback untouched, except when the held tier is itself a restored fallback: then the record is rewritten as that tier with the later end date, and the fallback attributes are removed | The record never holds a fallback that no longer applies |
| D27 | Key regeneration copies `fallbackTier` and `fallbackExpiresAt` to the new record when present. `key-regenerate.js` is in scope for this one change | N15 |
| D28 | The admin commands in `user-management.md` remove the fallback attributes when they set a tier by hand | A stale fallback would be restored later |
| D29 | Cognito `custom:tier` is not updated by a restore (L4 still applies) | Display hint only |
| D30 | The profile computes the effective tier through the layer with the fallback and returns neither fallback attribute | API contract unchanged (D9), no writes (D13) |
| D31 | `TIER_LAPSE_DOWNGRADE` carries `toTier` as well as `fromTier` | The log shows whether a restore happened |

## 10. Open questions and recommendations

No open questions.
