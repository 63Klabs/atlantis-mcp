# Requirements Document

## Introduction

**An account in use is kept, whatever its tier, and a tier that has lapsed ends.** Today neither holds. Only free `registered` users have their Users record renewed when they use their key, so DynamoDB TTL deletes an active `private` or `paid` record about 120 days after its last write, and the cleanup function then deletes the Cognito account ([issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5)). Separately, the Read Function compares the ISO 8601 string in `tierExpiresAt` with epoch seconds, so the check is never true and a lapsed voucher keeps its paid or private tier ([ISSUE.md](ISSUE.md)).

This feature ships in two phases. Each is deployable on its own through `dev → test → beta → main`.

1. **Phase 1: renew on use (issue #5).**
   - Use renews `ttl` for every tier whose record has no end date, by the existing rule: when fewer than 90 days remain, set `ttl` to now + 120 days.
   - The renewal can no longer recreate a record that key regeneration has deleted.
   - Code change in one Read Function file. No template change.
2. **Phase 2: lapsed tiers (this issue, the rest of issue #5, and two folded-in findings).**
   - A new `tier-common` Lambda layer holds one expiry rule for the Read Function and the Auth Function's profile.
   - When a tier has lapsed, the Read Function writes the record back as `registered`, with `tierExpiresAt` cleared and `ttl` set to now + 120 days.
   - Users with an active end date are renewed like everyone else.
   - Voucher redemption never lowers a tier or shortens an expiry.
   - A voucher of a higher tier remembers the tier it replaces, and the lapse restores it.
   - The Read Function's access to the Users table is narrowed to the items and attributes it uses.

See [ISSUE.md](ISSUE.md) for the lapsed-tier report, [issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5) for the account-lifetime report, and [PLAN.md](PLAN.md) for the analysis, the evidence, and the locked decisions. The plan is locked.

### Guiding constraints

1. **Phase 1 first, and it must not extend a lapsed tier.** Phase 1 ships before the expiry check is fixed, so it leaves records that have an end date alone (L7).
2. **One rule, one implementation.** The expiry rule exists once, in the `tier-common` layer. The Read Function, the profile, and voucher redemption all call it (L3).
3. **Fail closed on bad data, but do not destroy it.** A `tierExpiresAt` that does not parse gives the user `registered` limits, and is never overwritten by the Read Function (L2, D12).
4. **Writes on the hot path stay small, conditional, and non-blocking.** Every Read Function write to the Users table is a single conditional `UpdateItem` that the request does not wait for.
5. **No data migration.** Every stored `tierExpiresAt` is an ISO 8601 string or `null` (D1).
6. **Existing conventions.** Atlantis naming (`${Prefix}-${ProjectId}-${StageId}-*`), `>!` security comments, CommonJS `*.test.js` with Jest and fast-check in each Lambda package, the `search-common` layer pattern, the documentation and changelog steering, and the `dev → test → beta → main` branch flow.
7. **Nothing touches a deployed stage without the owner.** Scans, test-stage writes, GitHub comments, commits, and merges are done or approved by the owner.
8. **A higher tier never destroys a lower one.** A tier that a user held before a promotion is restored when the promotion ends, for as long as that tier would have lasted (U6).

### Decisions carried forward from PLAN.md

| # | Decision | Requirement |
|---|----------|-------------|
| U1 | Issue #5 is part of this spec; two phases, each deployable through every stage | All; 5, 17 |
| U2 | Renew `ttl` on use for every authenticated tier: fewer than 90 days left, set to now + 120 days | 1, 10 |
| U3 | A lapsed tier is downgraded to `registered` with `ttl` 120 days out, without the 90-day check | 9 |
| L1 (Q1) | `tierExpiresAt` is an ISO 8601 string only | 7 |
| L2 (Q2) | A value that does not parse is treated as expired and logs a warning | 7, 8, 14 |
| L3 (Q3) | The rule is shared through a new `tier-common` layer | 6 |
| L4 (Q5) | Cognito `custom:tier` is not reset on a lapse; documented as a display hint that can be stale | 16, 18 |
| L5 (Q7) | Read-only scans before merges, hand verification on `test` | 5, 17 |
| L6 (Q8) | N7 (voucher overwrite) and N11 (Read role access) fold into phase 2; N6 and N8 note only | 11, 12, 13, 18 |
| L7 (Q9) | Phase 1 renews only records with no end date | 1 |
| L8 (Q10) | Voucher redemption never lowers a tier or shortens an expiry | 11 |
| U4 | Replace the "Until #5 is fixed" sentence in the existing v0.0.7 changelog entry (exception to the changelog convention) | 4.4 |
| U6 | A higher voucher remembers the lower tier it replaces, and the lapse restores it | 8, 9, 11, 13, 19 |
| U5 | The rate-limit shared-record defect becomes its own 0.0.8 spec (`ISSUE.md` only) and a `TODO.md` item | 18.6 |
| D1 to D31 | See PLAN.md section 9 | Cited where they apply |

### Additions beyond PLAN.md

These came up while writing the requirements. Strike any you disagree with.

- **The Read Function reaches the Lambda limit of five layers (needs your attention).** It already attaches Lambda Insights, the Parameters and Secrets extension, `doc-ai-common`, and `search-common`. `tier-common` is the fifth, which is the maximum per function ([Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)). This spec still works, but the next shared module for the Read Function must go into an existing repository layer. Requirement 6.8 records this in a template comment. If you would rather not spend the last slot, the alternative is to put the tier module in `search-common` and attach that layer to the Auth Function too, at the cost of a layer whose name no longer describes its contents.
- **A conditional-write conflict on redemption returns HTTP 409** (Requirement 12.2). The plan said "a retryable error" without a status. `POST /mcp/auth/voucher/redeem` documents 200, 400, 401, and 500 in `template-openapi-spec.yml`. Requirement 12.5 adds 409, and also documents the 404 the controller already returns.
- **A voucher whose `targetTier` is not a known tier is rejected** (Requirement 11.2). Today `redeemVoucher` writes whatever `targetTier` holds, and an unknown tier then breaks the profile (N8).
- **Log lines use the repository's searchable shape.** PLAN D16 named the event `tier_lapse_downgrade`. Read Function structured events are a fixed upper-case token, one space, then compact JSON (`DISCOVERY_TOOL_CALL {...}`), so Requirement 14 uses `TIER_LAPSE_DOWNGRADE` and `TIER_EXPIRY_MALFORMED`.
- **The phase 1 scan runs before promotion starts**, not only before the merge to `main` (Requirement 5.3). `beta` and `prod` hold the permanent `private` users, and their records can expire while the change waits on `test`. Scanning first covers every stage.
- **An architecture test reads the IAM statements and layer wiring from `template.yml`** (Requirement 15.9). DynamoDB condition keys cannot be simulated offline, so this test is the only automated check of the policy shape before `test`. It follows `read-function/tests/unit/architecture/openapi-integration-targets.test.js`.
- **The 0-0-3 authentication design gets a superseded note** at the two passages this spec reverses: "do not update `tierExpiresAt`" (TTL Strategy, item 4) and Property 15 (Requirement 16.7). This follows the earlier 0.0.7 specs, which kept prior designs consistent with the code. Strike it to leave the old spec untouched.
- **The remembered lower tier (U6) came from the final review.** Asking what happens to a `paid` user who redeems a `private` voucher showed that the paid tier and its end date were overwritten, so the user ended at `registered` even with months of paid left, or a permanent paid tier. Requirement 19 fixes it. It adds two record attributes, a larger `GetItem` projection, longer IAM attribute lists, and one change to `key-regenerate.js`, which would otherwise drop the attributes. I checked the rule by simulation outside the repository (83,185 random records and vouchers, no case where a user was worse off at any later instant).
- **The profile page's success text stays as it is.** After a same-tier extension, the page says "Upgraded to paid tier until <new date>". "Upgraded" is slightly off for an extension, but the date is right, and changing the text is a static-site change, which Requirement 18.2 excludes.
- **Changelog convention (decided, U4).** The v0.0.7 Post-Deploy Smoke Verification entry says "Until #5 is fixed, a private key's account expires about 120 days after the key was set up; the developer guide gives the workarounds". `.kiro/steering/changelog-convention.md` says existing changelog text is never updated. You approved an exception on 2026-11-02: phase 1 replaces that one sentence, in the same change that fixes it (Requirement 4.4). Every other existing line stays as it is.
- **Found while checking the rate limiter: a tier change can reuse the previous tier's rate-limit record (spun off, U5).** The Sessions key is `sha256(cognitoSub + windowStart + salt)`, with no tier in it. `paid` and `private` both use a daily window, so they always share a record. `registered` (hourly) shares it with them between 00:00 and 00:59 UTC. A user who changes tier inherits the old tier's remaining count until the window ends. You asked for this to be its own spec: [`0-0-8-rate-limit-record-shared-across-tiers/ISSUE.md`](../0-0-8-rate-limit-record-shared-across-tiers/ISSUE.md), listed in `TODO.md` under 0-0-8. Requirement 18.6 keeps it out of this spec.

## Glossary

- **System**: This feature as a whole: code, layer, template, tests, and documentation in both phases.
- **Read Function**: `ReadLambdaFunction`, which serves `POST /mcp/v1`. Source: `application-infrastructure/src/lambda/read-function`.
- **Auth Resolver**: `read-function/utils/auth-resolver.js`, which looks up an API key, computes the request's tier, and writes renewals.
- **Auth Function**: `AuthLambdaFunction`. Source: `application-infrastructure/src/lambda/auth-function`.
- **Profile Service**: `auth-function/services/profile.js`, behind `GET /mcp/auth/profile`.
- **Redemption Service**: `auth-function/services/voucher-redeem.js`, behind `POST /mcp/auth/voucher/redeem`.
- **Tier-common Layer**: The new Lambda layer at `application-infrastructure/src/lambda/layers/tier-common/`, logical ID `TierCommonLayer`.
- **Users table**: `${Prefix}-${ProjectId}-${StageId}-Users`, partition key `pk`, TTL attribute `ttl`, stream to the cleanup function.
- **User record**: A Users table item whose `pk` starts with `KEY#`, holding `email`, `tier`, `cognitoSub`, `createdAt`, `tierExpiresAt`, and `ttl`.
- **Voucher record**: A Users table item whose `pk` starts with `VOUCHER#`.
- **Stored tier**: The `tier` attribute of a User record.
- **End date**: A non-null `tierExpiresAt`.
- **Expiry state**: The result of reading `tierExpiresAt` at a moment `now`:
  - `none`: null or absent;
  - `active`: a valid ISO 8601 timestamp after `now`;
  - `lapsed`: a valid ISO 8601 timestamp at or before `now`;
  - `malformed`: any other value.
- **Effective tier**: The tier used for a request: the Stored tier for `none` and `active`; for `lapsed`, the Fallback's tier when a valid Fallback exists, otherwise `registered`; and `registered` for `malformed`.
- **Tier rank**: `public` 0, `registered` 1, `paid` 2, `private` 3.
- **Renewal**: The Read Function write that sets `ttl` to now + 120 days when `ttl` is less than now + 90 days.
- **Downgrade**: The Read Function write for a `lapsed` record. It restores the Fallback when one is valid, otherwise sets `tier = registered` and `tierExpiresAt = null`. Both shapes set `ttl = now + 120 days` and remove the fallback attributes.
- **Fallback**: The lower tier a redemption remembers, held in the optional `fallbackTier` and `fallbackExpiresAt` attributes.
- **Holding**: The tier a user has at a moment, with its end date: the Stored tier for `none` and `active`, the Fallback's tier when the Stored tier has lapsed and the Fallback is valid, otherwise `registered`.
- **Owner**: The repository owner, who commits, merges, and approves any action against a deployed stage or GitHub.
- **Scan**: A read-only DynamoDB scan of a stage's Users table that projects only `pk` prefix, `tier`, `tierExpiresAt`, and `ttl`, and reports counts and dates without identifiers.

## Requirements

### Phase 1

### Requirement 1: Renewal on use for records without an end date

**User Story:** As a `private` or `paid` user with no end date, including the post-deploy verifier's service key, I want my account kept while I use my key, so that it is not deleted 120 days after it was set up.

#### Acceptance Criteria

1. WHEN an authenticated request finds a User record whose `tierExpiresAt` is null or absent and whose `ttl` is a number less than now + 90 days, THE Auth Resolver SHALL set `ttl` to now + 120 days, whatever the Stored tier.
2. WHEN `ttl` is now + 90 days or later, THE Auth Resolver SHALL NOT write.
3. WHEN the User record has no `ttl` attribute, THE Auth Resolver SHALL NOT write.
4. WHEN the User record has an End date, THE Auth Resolver SHALL NOT renew it in phase 1. Requirement 10 replaces this criterion in phase 2.
5. THE Renewal SHALL stay non-blocking. The response SHALL NOT wait for it, and a failed write SHALL NOT change the request's outcome.
6. THE Renewal SHALL write only `ttl`.
7. THE 90-day and 120-day values SHALL stay defined once, as the existing `NINETY_DAYS_SEC` and `ONE_TWENTY_DAYS_SEC` constants.
8. `refreshTtl` SHALL take `(pk, record)`; the `effectiveTier` parameter is removed (D15). `resolveAuth`'s return shape SHALL NOT change.
9. THE Renewal SHALL run only after a User record is found. THE degraded paths and the 401 path SHALL NOT write.

### Requirement 2: A renewal cannot recreate a deleted record

**User Story:** As a user who regenerated a key, I want the old key to stay revoked, so that a renewal racing the regeneration cannot bring it back.

#### Acceptance Criteria

1. THE Renewal SHALL carry a condition that the item exists (`attribute_exists(pk)`) (D14).
2. WHEN the condition fails, THE Auth Resolver SHALL treat it as a no-op, SHALL log at debug level without `pk`, email, or `cognitoSub`, and SHALL NOT log a warning.
3. WHEN the write fails for any other reason, THE Auth Resolver SHALL log a warning, as it does today.
4. THE condition SHALL carry a `>!` comment stating that `UpdateItem` creates a missing item, and that the condition stops a regenerated-away key from being recreated.

### Requirement 3: Phase 1 tests

**User Story:** As a maintainer, I want the tests to assert the new renewal rule, so that the old registered-only behavior cannot return.

#### Acceptance Criteria

1. `read-function/tests/property/ttl-refresh.property.test.js` SHALL replace "non-registered tiers do NOT trigger TTL refresh" with a property covering every tier in `registered`, `paid`, and `private`. For a record with no End date and `ttl` within 90 days, exactly one update SHALL be issued. The update SHALL set `ttl` to now + 120 days, within one second, and SHALL carry the existence condition.
2. THE tests SHALL keep asserting that a record with an End date is not renewed, that `ttl` at or beyond now + 90 days causes no write, and that a missing `ttl` causes no write.
3. A unit test SHALL show that a `ConditionalCheckFailedException` is swallowed without a warning, and that another error logs a warning. In both cases `resolveAuth` SHALL return the same result.
4. `read-function/tests/unit/utils/auth-resolver.test.js` SHALL be updated wherever it asserts that a `paid` or `private` record with no End date is not renewed.
5. THE property tests SHALL use fast-check with at least 100 runs. They exercise pure logic with mocked DynamoDB and spawn no processes.
6. `npm test` and `npm run lint` SHALL pass in the Read Function. No other package's tests SHALL change in phase 1.

### Requirement 4: Phase 1 documentation and changelog

**User Story:** As an admin or operator, I want the documentation to describe how records are kept, so that I stop relying on workarounds that are no longer needed.

#### Acceptance Criteria

1. `docs/admin-ops/user-management.md` SHALL state that use renews a record of any tier with no End date, and SHALL give the rule (fewer than 90 days left, set to 120 days ahead).
   - The `ttl` row SHALL say "renewed while the key is in use".
   - "Permanent access" for `private` with `tierExpiresAt: null` SHALL become "no tier expiry; the account is kept while the key is used at least once every 120 days".
2. `docs/admin-ops/voucher-management.md` SHALL state that, until phase 2 ships, a record with an End date is not renewed by use.
3. The 120-day known-limit text in `docs/developer/post-deploy-verification.md` (section "The 120-day limit") SHALL be replaced, along with its two workarounds and the matching bullet in `docs/admin-ops/post-deploy-verification.md`. The replacement SHALL say that each verification run renews the key, so a stage deployed at least once every 120 days keeps it.
4. `CHANGELOG.md` SHALL gain a **Fixed** entry under `[v0.0.7] (unreleased)` that links this spec and issue #5.
   - The sentence "Until [#5](…) is fixed, a private key's account expires about 120 days after the key was set up; the developer guide gives the workarounds" in the Post-Deploy Smoke Verification entry SHALL be replaced with a sentence saying that verification runs renew the key's account, so a stage deployed at least once every 120 days keeps it. This is the one exception to the changelog convention, approved by the Owner (U4).
   - All other existing changelog text SHALL NOT be edited.
5. `docs/end-user/troubleshooting/README.md` SHALL gain an entry for an API key that returns 401 after more than 120 days without use. It SHALL explain that the account was removed for inactivity and that the user must register again.
6. THE JSDoc of `refreshTtl` and the flow comment of `resolveAuth` SHALL describe the new rule.
7. THE wording SHALL say "renewed while the key is in use", not "keys never expire". `TODO.md` plans a key-lifetime review for 0.0.8.

### Requirement 5: Phase 1 verification and promotion

**User Story:** As the owner, I want proof on `test`, and a check that no real user is lost before the fix arrives, so that promotion is safe.

#### Acceptance Criteria

1. BEFORE phase 1 is committed, THE implementer SHALL run `npm test` and `npm run lint` in the Read Function and record that both pass.
2. Phase 1 SHALL be promoted by merge `dev → test → beta → main`, and the PostDeploy stage SHALL pass on each stage before the next merge.
3. BEFORE the phase 1 merge to `test`, a Scan SHALL be run on `test`, `beta`, and `prod`, with the Owner's approval. It SHALL report the number of non-registered User records with no End date, and the earliest `ttl` among them.
   - IF any such `ttl` is within 30 days, THE Owner SHALL extend that record before the merge, using the `REMOVE #ttl` stopgap in issue #5.
4. WHEN phase 1 is on `test`, THE Owner SHALL set a throwaway user's `ttl` to about 60 days ahead, send one authenticated request with that user's key, and read `ttl` back. THE expected value is about 120 days ahead.
5. Phase 1 SHALL NOT be merged to `beta` until 5.4 passes.
6. WHEN phase 1 reaches `main`, a comment SHALL be added to issue #5 stating what is fixed and what remains for phase 2. It is posted with the Owner's approval, because the repository is public.

### Phase 2

### Requirement 6: `tier-common` layer

**User Story:** As a maintainer, I want the expiry rule in one place that both functions load, so that the two checks cannot drift again.

#### Acceptance Criteria

1. THE System SHALL add `application-infrastructure/src/lambda/layers/tier-common/`, laid out like `search-common`: a `package.json` with no production dependencies, Jest and ESLint configuration, the module code under `nodejs/`, and tests.
2. THE layer module SHALL be pure: no AWS SDK, no I/O, no logging, no reading of the clock except through a `now` argument that defaults to `Date.now()`.
3. THE layer SHALL export:
   - an expiry parser that returns the Expiry state and, for a valid value, the instant in milliseconds;
   - an effective-tier function that returns the Effective tier, the Expiry state, and what to restore when a valid Fallback applies;
   - the Tier rank.
4. `template.yml` SHALL define `TierCommonLayer` as an `AWS::Serverless::LayerVersion` with these properties:
   - `LayerName: !Sub '${Prefix}-${ProjectId}-${StageId}-TierCommon'`;
   - `ContentUri: src/lambda/layers/tier-common/`;
   - runtime `nodejs24.x`;
   - both architectures;
   - `RetentionPolicy: Delete`.
5. `ReadLambdaFunction` and `AuthLambdaFunction` SHALL list `!Ref TierCommonLayer`. No other function SHALL.
6. Both functions SHALL load the module from `/opt/nodejs/<module>` by default. The path SHALL be overridable through `TIER_COMMON_LAYER_PATH`. The module SHALL load at module initialization, and a load failure SHALL fail the cold start, with no fallback copy. This is the `loadLayerModule` pattern in `read-function/models/doc-index.js`.
7. Each function's `jest.setup.js` SHALL set `TIER_COMMON_LAYER_PATH` to the local layer's `nodejs/` directory when it is unset.
8. A template comment SHALL record that the Read Function now attaches five layers, the Lambda maximum.
9. `buildspec.yml` SHALL NOT change; its existing layer loop builds and tests the new directory.
10. AFTER the `template.yml` edits, the offline SAM translator check SHALL show that the `McpV1Post` integration still targets the `live` alias.

### Requirement 7: Expiry parsing

**User Story:** As a maintainer, I want one strict definition of a valid `tierExpiresAt`, so that every function reads the same value the same way.

#### Acceptance Criteria

1. THE parser SHALL accept exactly these forms (D2):
   - `YYYY-MM-DD`;
   - `YYYY-MM-DDTHH:mm`, `YYYY-MM-DDTHH:mm:ss`, or `YYYY-MM-DDTHH:mm:ss.f` with one to three fraction digits, followed by `Z` or `±HH:mm`.
2. A date-only value SHALL mean 00:00:00 UTC on that day.
3. A value SHALL be `malformed` WHEN its fields are out of range or name no real date. Ranges: month 01 to 12; day valid for that month, including leap years; hour 00 to 23; minute and second 00 to 59; offset hours 00 to 23 and minutes 00 to 59.
4. THE parser SHALL return `none` for `null` and `undefined` (D4).
5. THE parser SHALL return `malformed` for every other value, including:
   - numbers, booleans, objects, and arrays;
   - an empty string, or a string with leading or trailing whitespace;
   - a lower-case `z`;
   - a date-time without an offset.
6. THE parser SHALL return `malformed` for any string longer than 29 characters (the longest accepted form, `YYYY-MM-DDTHH:mm:ss.fff+HH:mm`) before running any regular expression. No regular expression SHALL contain an unbounded quantifier (`*`, `+`, or `{n,}`), and each SHALL carry a `>!` comment.
7. THE parser SHALL NOT rely on `Date.parse` or `new Date(string)` to decide validity.

### Requirement 8: Effective tier in the Read Function and the profile

**User Story:** As a user whose promotion ended, I want the API and my profile page to agree on my tier, so that the limits I see are the limits I get.

#### Acceptance Criteria

1. THE effective-tier function SHALL return:
   - the Stored tier, for `none` and `active`;
   - for `lapsed` (the expiry instant is at or before `now`, D3): the Fallback's tier when the Fallback is valid (Requirement 19.4), otherwise `registered`;
   - `registered`, for `malformed` (L2).
2. THE Auth Resolver SHALL use the layer's Effective tier as the request's tier. That tier selects the rate limit and semantic-search eligibility.
3. THE Profile Service SHALL use the layer's Effective tier for the tier and rate limits it returns.
4. FOR every stored value, THE Auth Resolver and the Profile Service SHALL report the same Effective tier.
5. THE local `computeEffectiveTier` functions in `auth-resolver.js` and `profile.js` SHALL keep their names, their `TestHarness` and module exports, and their string return value, and SHALL delegate to the layer (D7).
6. THE Profile Service SHALL write nothing (D13), and SHALL keep returning the stored `tierExpiresAt` unchanged (D9).
7. A Stored tier outside the Tier rank SHALL pass through unchanged for `none` and `active` (N8 is note only).

### Requirement 9: Persisted downgrade

**User Story:** As the service owner, I want a lapsed record turned into an ordinary registered record the first time it is used, so that it gets registered limits and is kept alive like any registered account.

#### Acceptance Criteria

1. WHEN an authenticated request finds a `lapsed` User record with no valid Fallback, THE Auth Resolver SHALL issue one `UpdateItem` that sets `tier` to `registered`, `tierExpiresAt` to `null`, and `ttl` to now + 120 days, whatever the current `ttl`, and removes the fallback attributes (U3, D11). WHEN a valid Fallback exists, Requirement 19.6 applies instead.
2. THE Downgrade SHALL be conditional on three things: the item exists, its `tier` equals the value read, and its `tierExpiresAt` equals the value read.
3. THE Downgrade SHALL be non-blocking. The current request SHALL be served at the Effective tier (`registered`, or the Fallback's tier) whether or not the write succeeds.
4. WHEN the condition fails, THE Auth Resolver SHALL treat it as a no-op and log at debug level. WHEN the write fails for any other reason, it SHALL log a warning. It SHALL NOT retry within the request.
5. THE Auth Resolver SHALL NOT issue a Downgrade for `none`, `active`, or `malformed`.
6. THE Downgrade SHALL apply whatever the Stored tier, including a `registered` record with a lapsed date.
7. THE only tier values the Read Function writes SHALL be `registered` and a valid Fallback's tier (Requirement 19.9).
8. THE Downgrade SHALL replace the 0-0-3 design statement that `tierExpiresAt` is never rewritten on lapse (D5 superseded).

### Requirement 10: Renewal after phase 2

**User Story:** As a voucher user, I want my account kept while I use it during my promotion, so that a long voucher does not end with a deleted account.

#### Acceptance Criteria

1. THE Renewal rule of Requirement 1 SHALL apply to every record whose Expiry state is `none`, `active`, or `malformed`. The phase 1 exclusion of records with an End date SHALL be removed.
2. A `lapsed` record SHALL get the Downgrade, which already sets `ttl`, and no separate Renewal.
3. THE Auth Resolver SHALL issue at most one Users table write per request.
4. Requirement 2's existence condition SHALL apply to every Renewal.

### Requirement 11: Voucher redemption rule

**User Story:** As a user with a higher or longer entitlement, I want a voucher never to take it away, so that redeeming a code cannot leave me worse off.

#### Acceptance Criteria

1. THE Redemption Service SHALL compute the user's Holding with the layer before any write. A `lapsed` record without a valid Fallback, and a `malformed` record, count as `registered`.
2. WHEN the voucher's `targetTier` is not `paid` or `private`, THE Redemption Service SHALL reject the redemption with HTTP 400.
3. WHEN `targetTier` ranks above the Holding's tier, THE Redemption Service SHALL apply it:
   - `tier = targetTier`;
   - `tierExpiresAt = now + durationDays`;
   - `ttl = now + 120 days`;
   - Cognito `custom:tier` updated to `targetTier` WHEN the Stored tier changes;
   - the Holding remembered as the Fallback, or the fallback attributes removed (Requirements 19.2, 19.3).
4. WHEN `targetTier` equals the Holding's tier and the Holding has an `active` end date, THE Redemption Service SHALL extend it: `tierExpiresAt` becomes the later of the Holding's end date and now + `durationDays`, and `ttl` becomes now + 120 days. Cognito `custom:tier` SHALL be updated only WHEN the Stored tier changes (Requirement 19.10).
5. WHEN `targetTier` equals the Holding's tier and the Holding has no end date, THE Redemption Service SHALL reject the redemption with HTTP 400. The message SHALL name the user's current tier.
6. WHEN `targetTier` ranks below the Holding's tier, THE Redemption Service SHALL reject the redemption with HTTP 400. The message SHALL name the user's current tier.
7. A rejected redemption SHALL write nothing to the Users table, SHALL NOT increment the voucher's `currentUses`, and SHALL NOT update Cognito (D20).
8. THE existing checks (voucher exists, not expired, uses remaining) SHALL run first, with their current messages and statuses.
9. THE success response SHALL keep its shape, `{ tier, tierExpiresAt, message }`. `tier` and `tierExpiresAt` SHALL be the values written.
10. FOR every record and voucher, a successful redemption SHALL NOT lower the Tier rank of the Holding and SHALL NOT make its end date earlier. Requirement 19.15 states the same property over time.

### Requirement 12: Voucher redemption write safety

**User Story:** As a user, I want a redemption to apply cleanly even if my account changes at the same moment, so that two writes never leave my record half-changed.

#### Acceptance Criteria

1. THE User record write SHALL succeed only if three things still hold: the item exists, its `tier` is unchanged since it was read, and its `tierExpiresAt` is unchanged since it was read. A null or absent `tierExpiresAt` SHALL be matched as null or absent (D21). THE write SHALL set or remove the fallback attributes in the same `UpdateItem`.
2. WHEN that condition fails, THE Auth Function SHALL return HTTP 409 with a message asking the user to try again. It SHALL NOT increment `currentUses` and SHALL NOT update Cognito.
3. THE order SHALL be:
   1. validate the voucher;
   2. read the User record;
   3. apply the rule;
   4. make the conditional User record write;
   5. increment `currentUses`;
   6. update Cognito `custom:tier`, only when the Stored tier changed.
4. THE controller SHALL map the 409 error. Other mappings SHALL NOT change.
5. `template-openapi-spec.yml` SHALL document 409 for `POST /mcp/auth/voucher/redeem`, and SHALL also document the 404 the controller already returns.
6. THE profile page needs no change. It already shows `result.data.error` for any non-success response (`static/public/profile/index.html`, voucher handler), so the new 400 messages and the 409 message appear as they are sent.

### Requirement 13: Narrowed Read Function access to the Users table

**User Story:** As the service owner, I want the Read Function to reach only the user items and attributes it uses, so that a defect in it cannot change vouchers or unrelated fields.

#### Acceptance Criteria

1. `UsersTableAuthAccess` in `ReadLambdaExecutionRole` SHALL be replaced by two statements on `!GetAtt UsersTable.Arn` only, one for `dynamodb:GetItem` and one for `dynamodb:UpdateItem` (D18).
2. Both statements SHALL require `ForAllValues:StringLike` `dynamodb:LeadingKeys` equal to `KEY#*`.
3. THE `GetItem` statement SHALL require `ForAllValues:StringEquals` `dynamodb:Attributes` within `pk`, `tier`, `tierExpiresAt`, `ttl`, `cognitoSub`, `fallbackTier`, and `fallbackExpiresAt`, and `StringEqualsIfExists` `dynamodb:Select` equal to `SPECIFIC_ATTRIBUTES`.
4. THE `UpdateItem` statement SHALL require `ForAllValues:StringEquals` `dynamodb:Attributes` within `pk`, `tier`, `tierExpiresAt`, `ttl`, `fallbackTier`, and `fallbackExpiresAt`, and `StringEqualsIfExists` `dynamodb:ReturnValues` equal to `NONE`.
5. THE Auth Resolver's `GetItem` SHALL send a `ProjectionExpression` naming exactly `pk`, `tier`, `tierExpiresAt`, `ttl`, `cognitoSub`, `fallbackTier`, and `fallbackExpiresAt`.
6. THE Read Function SHALL access the Users table only through the Auth Resolver's `GetItem` and `UpdateItem`.
7. Each statement SHALL carry a `# >!` comment citing the DynamoDB fine-grained access control guide.
8. THE IAM change SHALL be the last change made in phase 2, so that a failure on `test` is attributable to it alone.
9. IF the `test` verification (Requirement 17.3) shows a failure caused by the attribute conditions, THE fallback SHALL keep the `LeadingKeys` conditions only. The Owner decides at that time, and the change is recorded in the design and the changelog.

### Requirement 14: Logging

**User Story:** As an operator, I want lapses and bad expiry values visible in the logs without user identifiers, so that I can audit downgrades and fix bad records.

#### Acceptance Criteria

1. WHEN a Downgrade write succeeds, THE Read Function SHALL log one info line: `TIER_LAPSE_DOWNGRADE {"fromTier":"<stored tier>","toTier":"<new tier>"}` (D31).
2. WHEN a request finds a `malformed` record, the Read Function or the Profile Service SHALL log one warning line: `TIER_EXPIRY_MALFORMED {"field":"<tierExpiresAt or fallbackExpiresAt>","storedTier":"<tier>","valueType":"<typeof>","value":"<first 40 characters>"}`.
3. THE lines SHALL be a fixed token, one space, then compact JSON, the shape of existing Read Function events.
4. NO line written by this feature SHALL contain a `pk`, key hash, API key, email address, or `cognitoSub` (D6).
5. Conditional-check failures SHALL be logged at debug level only.

### Requirement 15: Phase 2 tests

**User Story:** As a maintainer, I want tests that exercise the real code with the stored format, so that a format mismatch cannot pass again.

#### Acceptance Criteria

1. THE layer SHALL have fast-check property tests covering:
   - every accepted form parses to the expected instant;
   - generated invalid forms and non-string values are `malformed`;
   - an instant equal to `now` is `lapsed`;
   - `null` and `undefined` are `none`;
   - a 100,000-character input finishes in under 50 ms.
2. `auth-resolver.property.test.js`, `auth-resolver-preservation.property.test.js`, `ttl-refresh.property.test.js`, and `unit/utils/auth-resolver.test.js` SHALL use ISO 8601 strings wherever they model a stored `tierExpiresAt`. Integer epochs SHALL appear only in tests asserting that a number is `malformed`.
3. `auth-function/tests/property/effective-tier.property.test.js` SHALL test the real `computeEffectiveTier` from `services/profile.js`. The inline copy SHALL be removed.
4. IN each function, a property test SHALL feed generated stored values to that function's `computeEffectiveTier` and SHALL assert that the result equals the layer's Effective tier for the same input. Because both wrappers delegate to one layer function, this proves Requirement 8.4. A single test that loads both functions cannot run in CodeBuild, which installs each function's dependencies only on that function's turn of the build loop.
5. Downgrade tests SHALL cover:
   - the write's attributes and condition;
   - no Downgrade for `none`, `active`, or `malformed`;
   - a swallowed conditional failure;
   - a warning for any other failure;
   - at most one write per request.
6. Renewal tests SHALL cover an `active` record and a `malformed` record within 90 days of `ttl`.
7. Redemption tests SHALL cover:
   - each row of Requirement 11;
   - an unknown `targetTier`;
   - no write, no increment, and no Cognito update on rejection;
   - 409 on a conditional failure;
   - a property test of Requirement 11.10.
8. A test SHALL assert the Auth Resolver's `ProjectionExpression` (Requirement 13.5).
9. An architecture test SHALL read `template.yml` and assert three things:
   - the two Users table statements' actions, resource, and condition keys;
   - `TierCommonLayer` in the `Layers` lists of `ReadLambdaFunction` and `AuthLambdaFunction`, and in no other function's;
   - the layer's name pattern.
10. `npm test` and `npm run lint` SHALL pass in the Read Function, the Auth Function, and the layer. Property tests SHALL use at least 100 runs.
11. THE layer tests SHALL cover the Fallback: a valid Fallback is returned as the Effective tier for a `lapsed` record; a Fallback that is absent, `lapsed`, or `malformed`, has an unknown tier, ranks at or below `registered`, or ranks at or above the Stored tier is ignored; a Fallback never applies to an `active`, `none`, or `malformed` record.
12. THE tests SHALL also cover:
   - the restoring Downgrade (attributes, `REMOVE`, condition, `toTier` in the log line);
   - key regeneration copying the fallback attributes when present and writing none when absent;
   - each redemption outcome with and without a held tier above `registered`, including the restored-Holding extension;
   - the profile reporting the Fallback's tier;
   - a property test of Requirement 19.15: for generated records and vouchers, the rank of the user's tier at every sampled later instant is not lower after a successful redemption, nor after the Downgrade on the first request after the new tier lapses.

### Requirement 16: Phase 2 documentation and changelog

**User Story:** As an admin, developer, or user, I want the documentation to describe expiry, downgrade, and voucher behavior as built, so that nobody relies on the old behavior.

#### Acceptance Criteria

1. `docs/admin-ops/user-management.md` SHALL:
   - state that `tierExpiresAt` must be an ISO 8601 UTC timestamp, with an example;
   - state that any other value gives the user `registered` limits and logs `TIER_EXPIRY_MALFORMED`;
   - state that a lapsed tier is written back as `registered` on the user's first API request after it lapses;
   - state that Cognito `custom:tier` can be stale after a lapse and is only a display hint (L4);
   - describe the `fallbackTier` and `fallbackExpiresAt` attributes, and give the commands that set a tier by hand with the two `REMOVE` clauses (Requirement 19.13);
   - remove the stale sentence that the profile page reads the tier from Cognito.
2. `docs/admin-ops/voucher-management.md` SHALL document:
   - the redemption rule as a table;
   - that a rejected redemption does not use up the voucher;
   - the 409 response;
   - that an active voucher user is renewed by use;
   - that a higher-tier voucher remembers the tier it replaces and the user returns to it when the voucher ends, with the three examples from PLAN.md.
3. `ARCHITECTURE.md` SHALL:
   - add a `tier-common` layer section, next to the existing `search-common` section;
   - show the persisted Downgrade in the authentication flowchart;
   - describe the User record lifecycle: renewal, downgrade, and TTL deletion.
4. `docs/end-user/troubleshooting/README.md` SHALL gain entries for a promotion code that was not applied and for a tier that changed when a promotion ended (back to the previous tier if it still applied, otherwise to `registered`).
5. JSDoc SHALL describe the layer's exports, both `computeEffectiveTier` wrappers, `refreshTtl`, the Downgrade, and `redeemVoucher`. The text "Unix epoch seconds" SHALL no longer describe `tierExpiresAt`.
6. `CHANGELOG.md` SHALL gain entries under `[v0.0.7] (unreleased)`, each linking this spec. Existing text SHALL NOT be edited.
   - **Fixed:** lapsed tiers are downgraded, and the Read Function and the profile now agree.
   - **Changed:** the downgrade is persisted, which reverses the 0-0-3 design; voucher redemption never lowers a tier, and a higher voucher remembers the lower tier so the user returns to it when the voucher ends; redemption conflicts return 409.
   - **Added:** the `tier-common` layer.
   - **Security:** the narrowed Read Function access to the Users table.
7. `.kiro/specs/0-0-3-add-authentication/design.md` SHALL get a one-line superseded note, linking this spec, at TTL Strategy item 4 and at Property 15. The rest of that file SHALL NOT change.

### Requirement 17: Phase 2 verification and promotion

**User Story:** As the owner, I want each part of phase 2 proven on `test`, so that a broken policy or downgrade is found before `beta`.

#### Acceptance Criteria

1. BEFORE phase 2 is committed, THE implementer SHALL run and record:
   - `npm test` and `npm run lint` in the Read Function, the Auth Function, and the layer;
   - the offline SAM translator check (Requirement 6.10).
2. WHEN phase 2 is on `test`, THE Owner SHALL log in as the lapsed `paid` user, regenerate the key, and send one authenticated request. THE expected results:
   - `X-RateLimit-Limit: 100`;
   - no `X-MCP-Auth-Status: degraded` header;
   - the record reads back as `registered`, with `tierExpiresAt` null and `ttl` about 120 days ahead.
3. WHEN 17.2 is done, the Read Function's `test` log group SHALL be searched read-only, with the Owner's approval. It SHALL show one `TIER_LAPSE_DOWNGRADE` line and no `AccessDeniedException` for the Users table.
4. WHEN phase 2 is on `test`, THE Owner SHALL redeem a lower-tier voucher as a higher-tier user. THE expected result is HTTP 400, with the voucher's `currentUses` unchanged.
5. Phase 2 SHALL NOT be merged to `beta` until 17.2 to 17.4 and 17.8 pass, or until the Owner has chosen the fallback in Requirement 13.9.
6. BEFORE the phase 2 merge to `main`, a Scan SHALL be repeated on `beta` and `prod`, with the Owner's approval. It SHALL report the number of `lapsed` records.
7. WHEN phase 2 reaches `main`, issue #5 SHALL be closed with a comment, with the Owner's approval.
8. WHEN phase 2 is on `test`, THE Owner SHALL check the restore with a throwaway `paid` user: redeem a `private` voucher, read the record (`tier` `private`, `fallbackTier` `paid`), set `tierExpiresAt` to a past instant, and send one authenticated request. THE expected results: the paid tier's rate limit, no `X-MCP-Auth-Status: degraded` header, and the record back to `paid` with its original end date, no fallback attributes, and `ttl` about 120 days ahead.

### Requirement 18: Scope boundaries

**User Story:** As a maintainer, I want the limits of this change stated, so that follow-up work is not mistaken for work in this spec.

#### Acceptance Criteria

1. THE System SHALL NOT migrate stored data or change how registration, key regeneration, or admin commands write `tierExpiresAt` or `ttl`. (Admin commands gain only the `REMOVE` clauses of Requirement 19.13, in documentation.)
2. THE System SHALL NOT change `post-confirmation.js`, the cleanup function, the static site, or `services/documentation.js` (N13 is note only). THE only change to `key-regenerate.js` SHALL be carrying the fallback attributes (Requirement 19.11).
3. THE System SHALL NOT reset Cognito `custom:tier` on a lapse (L4), and the profile endpoint SHALL NOT write.
4. THE System SHALL NOT add a Lambda function, schedule, table, parameter, or alarm.
5. Phase 1 SHALL NOT change `template.yml`. Phase 2's template changes are limited to `TierCommonLayer`, the two `Layers` entries, and the Users table statements in `ReadLambdaExecutionRole`.
6. THE System SHALL NOT change rate-limiter keys or windows. The shared-record defect is tracked in `0-0-8-rate-limit-record-shared-across-tiers`.
7. THE System SHALL NOT change key lifetime beyond the Renewal rule. The 0.0.8 key-lifetime work in `TODO.md` is separate.
8. THE System SHALL NOT edit `ISSUE.md`.
9. THE implementer SHALL NOT commit, push, merge, scan a deployed table, write to a deployed table, or post on GitHub without the Owner's approval.

### Requirement 19: Remembered lower tier

**User Story:** As a `paid` user who redeems a `private` voucher, I want my paid tier back when the private tier ends, so that a promotion never leaves me with less than I had before.

#### Acceptance Criteria

1. THE User record MAY carry two optional attributes: `fallbackTier` (a string) and `fallbackExpiresAt` (an ISO 8601 string, or the DynamoDB `NULL` type for a tier with no end date). Both absent SHALL mean that nothing is remembered (D22).
2. WHEN a redemption applies a tier (Requirement 11.3) and the user's Holding ranks above `registered`, THE written record SHALL carry `fallbackTier` equal to the Holding's tier and `fallbackExpiresAt` equal to the Holding's end date, or `NULL` when the Holding has none (D23).
3. WHEN a redemption applies a tier and the user's Holding is `registered`, THE write SHALL remove `fallbackTier` and `fallbackExpiresAt` (D26).
4. A Fallback SHALL be valid only WHEN all of these hold (D24):
   - `fallbackTier` is a string that names a tier in the Tier rank;
   - that tier ranks above `registered` and below the Stored tier;
   - `fallbackExpiresAt` is null, absent, or an `active` ISO 8601 timestamp.
5. WHEN a record's `tierExpiresAt` is `lapsed` and its Fallback is valid, THE effective-tier function SHALL return the Fallback's tier, and SHALL return what to restore: the Fallback's tier, its end date (or null), and its Expiry state.
6. WHEN the Auth Resolver finds a `lapsed` record with a valid Fallback, THE Downgrade SHALL be one conditional `UpdateItem` that:
   - sets `tier` to the Fallback's tier;
   - sets `tierExpiresAt` to the Fallback's end date, or `NULL` when it has none;
   - sets `ttl` to now + 120 days;
   - removes `fallbackTier` and `fallbackExpiresAt`.

   THE condition SHALL be the one in Requirement 9.2. THE request SHALL be served at the Fallback's tier.
7. WHEN the Auth Resolver finds a `lapsed` record with no valid Fallback, THE Downgrade SHALL be the write of Requirement 9.1 and SHALL also remove `fallbackTier` and `fallbackExpiresAt` (D25).
8. WHEN a `lapsed` record has a Fallback that is present but not valid, THE effective tier SHALL be `registered`. IF the cause is a `fallbackExpiresAt` that does not parse, one `TIER_EXPIRY_MALFORMED` warning SHALL be logged with the field name `fallbackExpiresAt`.
9. THE Read Function SHALL write only these tier values: `registered`, or a Fallback's tier that ranks below the Stored tier. THE Read Function SHALL NOT write a Fallback that fails 19.4.
10. WHEN a redemption extends the Holding (Requirement 11.4) and the Holding comes from a restorable Fallback, THE written record SHALL have `tier` equal to the Holding's tier, `tierExpiresAt` equal to the later end date, and no fallback attributes (D26). WHEN the Holding comes from the Stored tier, THE fallback attributes SHALL be left unchanged.
11. KEY regeneration SHALL copy `fallbackTier` and `fallbackExpiresAt` to the new record WHEN the old record has `fallbackTier`, and SHALL write neither otherwise (D27).
12. THE Profile Service SHALL pass the record's Fallback to the effective-tier function, so that it reports the same tier as the Auth Resolver. IT SHALL NOT return the fallback attributes (D30).
13. THE admin commands in `docs/admin-ops/user-management.md` that set a tier by hand SHALL also remove `fallbackTier` and `fallbackExpiresAt` (D28).
14. A restore SHALL NOT update Cognito `custom:tier` (D29, L4).
15. FOR every record and voucher, and for every later instant, THE tier the user holds after a successful redemption SHALL rank at least as high as the tier they held before it at the same instant, assuming no other change to the record. THE same SHALL hold after the Downgrade has run on the first request after the new tier lapses.
