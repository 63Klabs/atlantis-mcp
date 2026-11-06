# Verification: Lapsed tier downgrade and account lifetime

Evidence recorded while executing [tasks.md](tasks.md). No identifiers or secrets are recorded here.

## Phase 1, red

Task 1.3. The changed test files were run against the unchanged `utils/auth-resolver.js`, from `application-infrastructure/src/lambda/read-function`:

```bash
timeout 300s npx jest tests/property/ttl-refresh.property.test.js tests/unit/utils/auth-resolver.test.js --coverage=false
```

No jest processes were running before or after the run.

Result: 2 suites failed, 5 tests failed, 17 passed, 22 total (0.7 s). All five failures are expected.

### `tests/unit/utils/auth-resolver.test.js` (3 failures)

| Test | Failure | Why it is expected |
|------|---------|--------------------|
| `resolveAuth()` › paid record with no end date › should call dynamo.update once with the existence condition when ttl < 90 days from now | `AWS.dynamo.update` expected 1 call, received 0 | Today only `registered` records are renewed |
| `resolveAuth()` › private record with no end date › should call dynamo.update once with the existence condition when ttl < 90 days from now | `AWS.dynamo.update` expected 1 call, received 0 | Same |
| `resolveAuth()` › TTL refresh write outcome › should not warn when update rejects with ConditionalCheckFailedException | `DebugAndLog.warn` expected 0 calls, received 1: `Auth resolver: TTL refresh failed (non-blocking)` | Today every update failure is logged as a warning, including a conditional failure |

### `tests/property/ttl-refresh.property.test.js` (2 failures)

| Test | Failure | Why it is expected |
|------|---------|--------------------|
| Property 15 › every tier with no end date and ttl within 90 days is renewed | Failed on the first run; shrunk counterexample tier `registered`, `tierExpiresAt` null. `AWS.dynamo.update` expected 1 call, received 0 | New test for the target behavior. The old `refreshTtl(pk, record, effectiveTier)` takes the tier as a third argument, and the test passes two, so the effective tier is `undefined` and nothing is renewed. After task 2.1 the signature is `(pk, record)` and the test goes green |
| Property 15 › ttl < now + 90 days triggers update to now + 120 days | Failed on the first run; `AWS.dynamo.update` expected 1 call, received 0 | Kept test, unchanged in intent. It fails only because it calls `refreshTtl(pk, record)` without the third argument the old function requires. Expected to go green after task 2.1 |

### Notes

- The `ConditionExpression` and `ExpressionAttributeNames` assertions in the property test come after the failing call-count assertion, so they were not exercised in this run. They run once renewal works. The unit tests' condition assertions are likewise behind the call-count assertion (line 330 precedes lines 332-333).
- The rest of the two files passed (17 tests), including the 90-day boundary properties, the "no `ttl` attribute causes no write" property, the records-with-an-end-date-are-not-renewed property, and the other-error warning case.
- `auth-resolver.js` was not changed.

## Phase 1, green

Task 2.2. Run from `application-infrastructure/src/lambda/read-function` after task 2.1 changed `utils/auth-resolver.js`. `node_modules` was already present, so `npm ci` was not run. No jest processes were running before or after any run.

### Changed files

```bash
timeout 300s npx jest tests/property/ttl-refresh.property.test.js tests/unit/utils/auth-resolver.test.js
```

Result: 2 suites passed, 22 tests passed, 0 failed (0.6 s). Phase 1, red recorded 5 failures and 17 passes for the same 22 tests; all five now pass.

### Whole suite

```bash
timeout 900s npx jest
```

| Measure | Count |
|---------|-------|
| Test suites | 184 passed, 6 skipped, 190 total |
| Tests | 2207 passed, 115 skipped, 2322 total |
| Snapshots | 1 passed |
| Failures | 0 |
| Run time | 22.9 s reported by jest (23 s wall clock, limit 900 s) |

The 6 skipped suites (115 skipped tests) are the ones that need AWS or GitHub access. No suite failed.

### Other callers of the old signature

```bash
grep -rn "refreshTtl(" application-infrastructure/src/lambda/read-function --include=*.js --exclude-dir=node_modules
```

Seven matches, all with two arguments `(pk, record)`: the definition and its one call site in `utils/auth-resolver.js`, a JSDoc example in the same file, and five calls in `tests/property/ttl-refresh.property.test.js`. No three-argument call remains, so nothing needed fixing.

### Lint

```bash
npm run lint
```

`npm run lint` exits non-zero: 6671 errors and 2 warnings in 114 of 250 files. This is the state of the repository, not a result of this change. `eslint.config.js` requires 2-space indentation, and most of the codebase uses tabs. Of the 6671 errors, 5993 are `indent`.

Comparison with the committed (HEAD) versions of the three changed files, linted from temporary copies that were then removed (no stash or checkout was used):

| File | Errors at HEAD | Errors now | Rules now |
|------|----------------|------------|-----------|
| `tests/property/ttl-refresh.property.test.js` | 176 | 204 | `indent` only |
| `tests/unit/utils/auth-resolver.test.js` | 201 | 307 | `indent` only |
| `utils/auth-resolver.js` | 3 `eqeqeq` (lines 114, 171, 179 at HEAD) | 2 `eqeqeq` (lines 114, 189) | `eqeqeq` only |

- The test files were written with tabs, matching the rest of each file and the surrounding test suite. The extra `indent` errors come from the added lines. No other rule is triggered.
- `auth-resolver.js` has one fewer `!=` comparison than at HEAD (the `ttl != null` check was removed with the old signature). The two that remain were already there and are outside this spec's scope.
- No new rule category was introduced by this change.

### Notes

- The working tree changes outside `.kiro/` are limited to `utils/auth-resolver.js` and the two test files. Nothing was committed.

## Phase 1 checkpoint

Task 4. Run from `application-infrastructure/src/lambda/read-function`. No jest or mocha processes were running before or after the runs. Nothing was committed.

### Suite

```bash
timeout 900s npx jest
```

| Measure | Count |
|---------|-------|
| Test suites | 184 passed, 6 skipped, 190 total |
| Tests | 2207 passed, 115 skipped, 2322 total |
| Snapshots | 1 passed |
| Failures | 0 |
| Run time | 23.1 s reported by jest (limit 900 s) |

These counts are identical to Phase 1, green. The skipped suites are the ones that need AWS or GitHub access.

### Lint

```bash
npm run lint
```

Exit code 1: 6671 errors and 2 warnings, the same totals as in Phase 1, green. The failure is the existing tabs-versus-2-space `indent` state of the repository. For the three changed files, the per-file counts and rules match Phase 1, green exactly:

| File | Errors | Rules |
|------|--------|-------|
| `tests/property/ttl-refresh.property.test.js` | 204 | `indent` only |
| `tests/unit/utils/auth-resolver.test.js` | 307 | `indent` only |
| `utils/auth-resolver.js` | 2 | `eqeqeq` only (pre-existing) |

No new rule category was introduced.

### Scope

`git status --short` and `git diff --stat` show only these changes:

- Code: `application-infrastructure/src/lambda/read-function/utils/auth-resolver.js`.
- Tests: `tests/property/ttl-refresh.property.test.js` and `tests/unit/utils/auth-resolver.test.js` (both under the read function).
- Documentation (task 3): `docs/admin-ops/user-management.md`, `docs/admin-ops/voucher-management.md`, `docs/admin-ops/post-deploy-verification.md`, `docs/developer/post-deploy-verification.md`, `docs/end-user/troubleshooting/README.md`.
- `CHANGELOG.md`.
- Spec directory `.kiro/specs/0-0-7-lapsed-tier-downgrade/`: modified `PLAN.md`, `design.md`, `requirements.md`, `tasks.md`; untracked `VERIFICATION.md` and `tasks.meta.json`.

No other modified or untracked file exists. `TODO.md` is not modified. `template.yml`, every `package.json`, and every lockfile are unchanged.

The commit is left to the owner.

## Manual renewal checks

### test

records: 4
non-registered without end date: 2
earliest ttl: 2027-02-25T14:06:06Z (113 days)
records with an end date in the past: 1

No records within 30 days

### beta

records: 1
non-registered without end date: 1
earliest ttl: 2027-02-25T17:19:37Z (113 days)
records with an end date in the past: 0

No records within 30 days

### prod

records: 4
non-registered without end date: 3
earliest ttl: 2027-01-28T14:08:07Z (85 days)
records with an end date in the past: 0

No records within 30 days

### User check

PostDeploy result on test, beta, and prod is a success.
Set user ttl to 60 days from now (11/4/2026) and perform a request - Done
Verify ttl change: Before 58 days out, after 120 days out

Before:
```json
{
    "Items": [
        {
            "pk": {
                "S": "<KEY>"
            },
            "cognitoSub": {
                "S": "<ID>"
            },
            "ttl": {
                "N": "1798828918"
            },
            "email": {
                "S": "<EMAIL>"
            },
            "tier": {
                "S": "registered"
            },
            "createdAt": {
                "S": "2026-11-04T18:26:13.172Z"
            },
            "tierExpiresAt": {
                "NULL": true
            }
        }
    ],
    "Count": 1,
    "ScannedCount": 1,
    "ConsumedCapacity": null
}
```

This result shows a ttl 58 days from now

After:

```json
{
    "Items": [
        {
            "tierExpiresAt": {
                "NULL": true
            },
            "ttl": {
                "N": "1804185970"
            },
            "pk": {
                "S": "<KEY>"
            },
            "cognitoSub": {
                "S": "<ID>"
            },
            "createdAt": {
                "S": "2026-11-04T18:26:13.172Z"
            },
            "tier": {
                "S": "registered"
            },
            "email": {
                "S": "<EMAIL>"
            }
        }
    ],
    "Count": 1,
    "ScannedCount": 1,
    "ConsumedCapacity": null
}
```

This result shows a ttl of 120 days from now

## Phase 2, layer wiring

Task 7.3 (Requirement 6.6). Run with the task 7.1 and 7.2 changes in the working tree and nothing else changed. Jest was called directly with timeouts. No stray `jest` processes before or after any run.

### Whole suites

| Function | Command | Result | Time |
|----------|---------|--------|------|
| `AF` (`auth-function`) | `timeout 600s npx jest` | 41 suites passed, 415 tests passed | about 22 s |
| `RF` (`read-function`) | `timeout 900s npx jest` | 184 suites passed, 6 skipped; 2207 tests passed, 115 skipped | about 25 s |

`node_modules` already existed in `AF` and `RF`, so `npm ci --include=dev` was not needed. The counts match task 7.1. Both suites pass with the loaders resolving the local layer through `TIER_COMMON_LAYER_PATH` from each `jest.setup.js`.

### Lint

`npm run lint` fails in both functions. The failures are the existing `indent` errors (tabs against the 2-space config), and they exist at `HEAD`.

| Function | `npm run lint` total |
|----------|----------------------|
| `AF` | 7360 errors |
| `RF` | 6676 errors, 2 warnings |

Because whole-function lint cannot pass, I linted each changed or new file and compared with a temporary copy of its `HEAD` version (`git show HEAD:<path>`, written next to the file, linted, then deleted; no `git stash`, `checkout`, or `reset`). Counts by rule:

| File | `HEAD` | Working tree |
|------|--------|--------------|
| `AF/index.js` | `indent` 66, `no-console` 2, `no-unused-vars` 1 | identical |
| `AF/jest.setup.js` | `indent` 6 | `indent` 7 |
| `AF/utils/tier-common.js` (new) | none | `indent` 4 |
| `RF/jest.setup.js` | `indent` 7 | `indent` 8 |
| `RF/utils/tier-common.js` (new) | none | `indent` 4 |

No new rule category appears. The only added findings are `indent`, the category that applies to every tab-indented file in both functions: one more line in each `jest.setup.js`, and four in each new loader. The new loaders follow the repository's tab style, as the sibling files do.

### Negative test (`RF` only)

A throwaway test, `tests/unit/tmp-tier-common-missing.test.js`, set `process.env.TIER_COMMON_LAYER_PATH = '/nonexistent'` inside the test, called `jest.resetModules()`, and required `../../utils/tier-common` inside `jest.isolateModules`. It then restored the variable. Run with `timeout 120s npx jest tests/unit/tmp-tier-common-missing.test.js --coverage=false`.

- Outcome: the require threw. The error was `ModuleNotFoundError` (Jest's resolver error, code `MODULE_NOT_FOUND`), with a "Cannot find module" message for the missing `effective-tier` path. The test passed (1 of 1).
- The loader has no fallback, so a missing layer fails at load time. This is the behaviour Requirement 6.6 asks for.
- The test file was deleted straight after the run. `git status --short` shows no `tmp-tier-common-missing` file, and the working tree has only the task 7.1 and 7.2 changes.

## Phase 2, effective tier delegation

Task 8.2. `RF/utils/auth-resolver.js` and `AF/services/profile.js` now take the effective tier from the `tier-common` layer. Direct Jest runs with timeouts; no stray Jest processes before or after.

### Task 8.1 files, red to green

The files were failing before the change (task 8.1, written test-first). After it:

| Function | Files | Suites | Tests |
|----------|-------|--------|-------|
| `RF` | `auth-resolver.property`, `auth-resolver-preservation.property`, `unit/utils/auth-resolver`, `effective-tier-delegation.property` | 4 passed | 34 passed |
| `AF` | `effective-tier.property`, `unit/profile-service` | 2 passed | 21 passed |

No test file was changed in this task.

### Whole suites

- `RF`: 185 suites passed, 6 skipped (191 total); 2212 tests passed, 115 skipped; about 24 s. This is the baseline 184 passed plus the new delegation file.
- `AF`: 41 suites passed; 420 tests passed; about 22 s.

### Lint

`npm run lint` still fails at `HEAD` with `indent` errors, so I compared each changed file with a temporary copy of its `HEAD` version (linted, then deleted; no `git stash`, `checkout`, or `reset`). Counts by rule:

| File | `HEAD` | Working tree |
|------|--------|--------------|
| `RF/utils/auth-resolver.js` | `eqeqeq` 2 | `eqeqeq` 1 |
| `AF/services/profile.js` | `indent` 58, `no-unused-vars` 1 | `indent` 64 |

No new rule category appears. `RF` loses one `eqeqeq` finding and `AF` loses the `no-unused-vars` finding (the removed inline logic). The extra `AF` `indent` findings come from the added lines, which use the file's existing tab style.

### Behaviour notes

- `TIER_EXPIRY_MALFORMED` is logged with `DebugAndLog.warn` through `malformedExpiryLogFields` (field, tier cut to 20 characters, value type, value cut to 40 characters). It carries no pk, `cognitoSub`, email, or raw key. One line per request: the end date is checked first, then the fallback end date.
- `refreshTtl(pk, record)` is unchanged, including its early return for a record with an end date. Task 9 adds `maintainUserRecord`, the Downgrade, and the `GetItem` projection.
- `getProfile` returns neither `fallbackTier` nor `fallbackExpiresAt`. Nothing else in it changed.

## Phase 2, Downgrade and renewal (task 9.2)

### Red to green for the task 9.1 files

Before the change, the two files had 32 failing tests (task 9.1). After it:

| Function | Files | Suites | Tests |
|----------|-------|--------|-------|
| `RF` | `unit/utils/auth-resolver`, `property/ttl-refresh.property` | 2 passed | 61 passed |

### Whole suite

- `RF`: 185 suites passed, 6 skipped (191 total); 2251 tests passed, 115 skipped; about 23 s. No stray `jest` processes before or after.
- Baseline before the change was 185 suites and 2212 tests passed, plus the new 9.1 tests.

### What changed in `RF/utils/auth-resolver.js`

- Added `downgradeLapsedTier` and `maintainUserRecord` as in Design 7. A `lapsed` record gets one conditional `AWS.dynamo.update` (tier, end date, `ttl` of now + 120 days with no 90-day check, `REMOVE` of both fallback attributes). Any other record goes to `refreshTtl`. One write per request.
- `resolveAuth` calls `maintainUserRecord(pk, record, resolution)`.
- `refreshTtl` lost its phase 1 `tierExpiresAt != null` guard and comment. Its JSDoc and the file and `resolveAuth` flow comments were updated.
- The `AWS.dynamo.get` call carries the Design 8 `ProjectionExpression` and `ExpressionAttributeNames`.
- Both new functions are in `TestHarness.getInternals()`.
- `TIER_LAPSE_DOWNGRADE` is logged at info after the update resolves, with `fromTier` and `toTier` only. Failures go through `onUserWriteError('tier downgrade')`. Neither update sets `ReturnValues`.

### Other tests

No test file was changed in this task. The Property 5 and preservation tests never send a lapsed record through `resolveAuth` (Property 5 sets `update` to resolve; the preservation test calls `resolveAuth` only on the no-key path). The only `AWS.dynamo.get` argument assertion is in the 9.1 unit test, which already expects the projection.

### Lint

`npm run lint` in `RF` still fails at `HEAD` on `indent` (7318 problems across the directory, none from this file). I compared `utils/auth-resolver.js` with a temporary copy of its `HEAD` version (linted, then deleted; no `git stash`, `checkout`, or `reset`):

| File | `HEAD` | Working tree |
|------|--------|--------------|
| `RF/utils/auth-resolver.js` | `eqeqeq` 2 | no findings |

No new rule category appears. The remaining `eqeqeq` findings went away with the removed `!= null` guard.

## Phase 2, voucher redemption rule (task 10.2)

### Red to green for the task 10.1 files
Run from `AF` with `timeout 600s npx jest <files> --coverage=false`.
| Files | Before the change | After the change |
|-------|-------------------|------------------|
| `tests/unit/voucher-redeem-service.test.js`, `tests/unit/user-dao.test.js`, `tests/unit/voucher-redeem-controller.test.js`, `tests/property/voucher-redeem-response.property.test.js`, `tests/property/voucher-validation.property.test.js` | 65 failed, 59 passed | 124 passed |

### Whole suite
- `AF`: 41 suites passed, 491 tests passed (baseline 420 plus the 10.1 tests); about 20 s. No stray `jest` processes before or after.

### What changed
- `AF/services/voucher-redeem.js`: added `PROMOTABLE_TIERS`, `DAY_MS`, and `decideRedemption` (Design 9 table, the layer's `resolveRecordTier` as the only reader of `tierExpiresAt`). `redeemVoucher` follows the seven steps: decide, conditional write with `expected` and `fallback`, `incrementVoucherUses` only after the write, Cognito only when the stored tier changed. A `ConditionalCheckFailedException` becomes an error with `statusCode` 409. `decideRedemption` is in `TestHarness.getInternals()`. Module and function JSDoc and the workflow list were updated.
- `AF/models/user.js`: `updateUserTier(pk, tier, tierExpiresAt, ttl, options = {})` with the condition table, the three `fallback` shapes, aliased names and values only, and only the placeholders a request uses. A conditional failure is logged at debug level and rethrown; other errors keep `DebugAndLog.error`.
- `AF/controllers/voucher-redeem.js`: 409 branch (not logged as an error) and the JSDoc list.

### Test change
One file changed, `AF/tests/property/voucher-redeem-response.property.test.js`. The two `Property 6` tests (response shape, and end date about `durationDays` ahead) assumed that every generated voucher and user combination succeeds. The 10.1 author widened the user generator to realistic records, so some combinations are legitimately rejected under Design 9 (for example a `private` user and a `paid` voucher) and both tests failed with the rejection message. Each now skips cases the rule rejects with `fc.pre`: the first on any non-reject outcome, the second on `apply` only, because an `extend` keeps a later existing end date. The assertions themselves are unchanged. The rejection and the extend cases are covered by the 10.1 rule properties in the same file.

### Lint
`npm run lint` in `AF` still fails at `HEAD` on `indent` (tabs against the 2-space config). I compared each changed file with a temporary copy of its `HEAD` version (linted, then deleted; no `git stash`, `checkout`, or `reset`):
| File | `HEAD` | Working tree |
|------|--------|--------------|
| `AF/services/voucher-redeem.js` | `indent` 58, `no-unused-vars` 2 | `indent` 144, `no-unused-vars` 2 |
| `AF/models/user.js` | `indent` 91 | `indent` 130 |
| `AF/controllers/voucher-redeem.js` | `indent` 60, `no-unused-vars` 1 | `indent` 64, `no-unused-vars` 1 |
| `AF/tests/property/voucher-redeem-response.property.test.js` | `indent` 87 | `indent` 195 |
No new rule category appears. The `indent` counts rise because the added code is tab-indented like the rest of each file; the `no-unused-vars` findings are the ones already at `HEAD`.

## Phase 2, key regeneration carries the fallback (task 10.4)
### Red to green
Run from `AF` with `timeout 300s npx jest tests/unit/key-regenerate-service.test.js tests/property/key-regenerate-response.property.test.js`.
| Case | Before the change | After the change |
|------|-------------------|------------------|
| Unit: old record has `fallbackTier: 'paid'` and an end date | failed: `fallbackTier` was `undefined` on the new record | passed |
| Unit: old record has `fallbackTier: 'paid'` and `fallbackExpiresAt: null` | failed: `fallbackTier` was `undefined` on the new record | passed |
| Unit: old record has no `fallbackTier` | passed (neither attribute present) | passed |
| Property: fallback attributes equal the old record's, or both absent; response keys are `apiKey` and `message` | failed after 1 run (shrunk to `fallbackTier: 'registered'`, `fallbackExpiresAt: null`): new record lacked the attributes | passed (100 runs) |
Both files: 3 failed and 13 passed before, 16 passed after.
### Whole suite
- `AF`: 41 suites passed, 495 tests passed (baseline 491 plus the 3 unit cases and 1 property); about 21 s. No stray `jest` processes before or after.
### What changed
- `AF/services/key-regenerate.js`: the new record is built into `newRecord`; `fallbackTier` and `fallbackExpiresAt` (`?? null`) are copied only when the old record's `fallbackTier` is neither `undefined` nor `null`, with the `>!` comment from Design 9b; `putUserRecord(newRecord)`. The guard is written `!== undefined && !== null` instead of Design 9b's `!= null` (same behavior) so the file gets no new `eqeqeq` finding. The delete, `tierExpiresAt`, `ttl`, Cognito sync, and response are unchanged.
- Tests: three cases in `AF/tests/unit/key-regenerate-service.test.js`; the generated old record in `AF/tests/property/key-regenerate-response.property.test.js` carries an optional fallback, with one new property.
### Lint
`npm run lint` in `AF` still fails at `HEAD` on `indent`. I compared each changed file with a temporary copy of its `HEAD` version (linted, then deleted; no `git stash`, `checkout`, or `reset`):
| File | `HEAD` | Working tree |
|------|--------|--------------|
| `AF/services/key-regenerate.js` | `indent` 46, `no-unused-vars` 1 | `indent` 53, `no-unused-vars` 1 |
| `AF/tests/unit/key-regenerate-service.test.js` | `indent` 150 | `indent` 193 |
| `AF/tests/property/key-regenerate-response.property.test.js` | `indent` 76 | `indent` 106 |
No new rule category appears. The `indent` counts rise because the added code is tab-indented like the rest of each file.

## Phase 2 code checkpoint (task 11)

Run from each package directory with `timeout <n>s npx jest` (Jest called directly, no npm test script). No stray `jest` processes before or after any run.

### Suites

| Package | Suites | Tests | Run time (Jest) |
|---------|--------|-------|-----------------|
| `RF` | 185 passed, 6 skipped (191 total) | 2251 passed, 115 skipped (2366 total), 1 snapshot passed | **23.161 s** |
| `AF` | 41 passed | 495 passed | 20.793 s |
| `TC` | 2 passed | 169 passed | 0.303 s |

All three match the counts expected from the earlier tasks. No failures.

### Lint

| Package | `npm run lint` | Result |
|---------|----------------|--------|
| `TC` | exit 0, no findings | passes outright |
| `RF` | 7318 problems: 7316 errors, 2 warnings (252 files with output) | fails at `HEAD` too (tab indentation against the 2-space config) |
| `AF` | 8596 problems: 8596 errors, 0 warnings (68 files with output) | fails at `HEAD` too |

Rule breakdown, `RF`: `indent` 6638, `no-trailing-spaces` 399, `no-unused-vars` 94, `brace-style` 62, `curly` 52, `quotes` 44, `no-multiple-empty-lines` 16, `prefer-const` 5, `eol-last` 2, `semi` 2, `import/no-dynamic-require` 2, `null` (parse/other) 2.
Rule breakdown, `AF`: `indent` 8492, `brace-style` 66, `no-unused-vars` 21, `eqeqeq` 6, `prefer-const` 5, `no-multiple-empty-lines` 4, `no-console` 2.

Per-file comparison: every changed or new `.js` file in `RF` and `AF` was linted, and each modified file was also linted against a temporary copy of its `HEAD` version (`git show HEAD:<path>` to `<name>.headtmp.js` next to the file, linted with the package's eslint, deleted; no `git stash`, `checkout`, or `reset`). No temporary file remains.

| File | `HEAD` total | Now | New rule category |
|------|-------------|-----|-------------------|
| `AF/controllers/voucher-redeem.js` | 61 | 65 | none |
| `AF/index.js` | 69 | 69 | none |
| `AF/jest.setup.js` | 6 | 7 | none |
| `AF/models/user.js` | 91 | 130 | none |
| `AF/services/key-regenerate.js` | 47 | 54 | none |
| `AF/services/profile.js` | 59 | 64 | none (`no-unused-vars` 1 to 0) |
| `AF/services/voucher-redeem.js` | 60 | 146 | none |
| `AF/tests/property/effective-tier.property.test.js` | 46 | 119 | none |
| `AF/tests/property/key-regenerate-response.property.test.js` | 76 | 106 | none |
| `AF/tests/property/voucher-redeem-response.property.test.js` | 87 | 195 | none |
| `AF/tests/property/voucher-validation.property.test.js` | 174 | 304 | none |
| `AF/tests/unit/key-regenerate-service.test.js` | 150 | 193 | none |
| `AF/tests/unit/profile-service.test.js` | 182 | 235 | none |
| `AF/tests/unit/user-dao.test.js` | 231 | 400 | none |
| `AF/tests/unit/voucher-redeem-controller.test.js` | 255 | 275 | none |
| `AF/tests/unit/voucher-redeem-service.test.js` | 222 | 690 | none (fixed) |
| `RF/jest.setup.js` | 7 | 8 | none |
| `RF/tests/property/auth-resolver-preservation.property.test.js` | 88 | 110 | none |
| `RF/tests/property/auth-resolver.property.test.js` | 197 | 224 | none |
| `RF/tests/property/ttl-refresh.property.test.js` | 204 | 288 | none |
| `RF/tests/unit/utils/auth-resolver.test.js` | 307 | 734 | none (fixed) |
| `RF/utils/auth-resolver.js` | 2 (`eqeqeq`) | 0 | none (improved) |
| `AF/utils/tier-common.js` (new) | n/a | 4 `indent` | n/a |
| `RF/utils/tier-common.js` (new) | n/a | 4 `indent` | n/a |
| `RF/tests/property/effective-tier-delegation.property.test.js` (new) | n/a | 82 `indent` | n/a |

The rise in `indent` counts is the added code being tab-indented like the rest of each file.

The checkpoint first found two lines that introduced a rule category their `HEAD` version did not have. Both were fixed without changing what the tests assert:

1. `AF/tests/unit/voucher-redeem-service.test.js` line 753: `eqeqeq`. `options.expected.tierExpiresAt == null` is now `options.expected.tierExpiresAt === null || options.expected.tierExpiresAt === undefined`, the same "null or undefined" check.
2. `RF/tests/unit/utils/auth-resolver.test.js` line 775: `brace-style`. The one-line `new Promise((resolve) => { resolveUpdate = resolve; })` is now split over three lines in the file's tab style, with the same logic.

Re-lint with each package's eslint (rule counts per file):

| File | Before the fix | After the fix |
|------|----------------|---------------|
| `AF/tests/unit/voucher-redeem-service.test.js` | `indent` 690, `eqeqeq` 1 | `indent` 690 |
| `RF/tests/unit/utils/auth-resolver.test.js` | `indent` 732, `brace-style` 2 | `indent` 734 |

The `eqeqeq` and `brace-style` findings are gone and no other category appears. The `RF` file's `indent` count rises by 2 because the reformatted block adds two tab-indented lines, and its total stays at 734. No jest processes were running before or after the re-runs.

Re-run directly with Jest (`cd <function dir> && timeout 600s npx jest <file> --coverage=false`):

| File | Result |
|------|--------|
| `AF/tests/unit/voucher-redeem-service.test.js` | 1 suite passed, 63 tests passed |
| `RF/tests/unit/utils/auth-resolver.test.js` | 1 suite passed, 53 tests passed |

Only these two files were re-run. No test was added or removed, so the whole-suite counts in the Suites table above are unchanged. Task 11's lint criterion is met: no changed or new file introduces a rule category its `HEAD` version lacked.

### Template scope

`git diff -- application-infrastructure/template.yml` shows 31 added lines and no removed or changed lines. They are the `TierCommonLayer` resource (task 7.2) and the `!Ref TierCommonLayer` entries in the Read Function and Auth Function `Layers` lists. No IAM statement is changed; the narrowed statements remain for the last code task.

### Changed code files (outside `.kiro/` and `docs/`)

Modified:
- `AF`: `controllers/voucher-redeem.js`, `index.js`, `jest.setup.js`, `models/user.js`, `services/key-regenerate.js`, `services/profile.js`, `services/voucher-redeem.js`; tests `property/effective-tier`, `property/key-regenerate-response`, `property/voucher-redeem-response`, `property/voucher-validation`, `unit/key-regenerate-service`, `unit/profile-service`, `unit/user-dao`, `unit/voucher-redeem-controller`, `unit/voucher-redeem-service`
- `RF`: `jest.setup.js`, `utils/auth-resolver.js`; tests `property/auth-resolver-preservation`, `property/auth-resolver`, `property/ttl-refresh`, `unit/utils/auth-resolver`
- `application-infrastructure/template.yml` (layer lines only)
- `application-infrastructure/template-openapi-spec.yml` (12 added lines: `404` and `409` responses on the voucher endpoint)

Untracked (new):
- `AF/utils/tier-common.js`
- `RF/utils/tier-common.js`
- `RF/tests/property/effective-tier-delegation.property.test.js`
- `application-infrastructure/src/lambda/layers/tier-common/` (the layer and its two test suites)

## Phase 2, Users table access test, red (task 12.1)

New file: `RF/tests/unit/architecture/users-table-access.test.js` (9 tests). It parses `T` offline with `js-yaml` from `RF/node_modules`, using the CloudFormation-tag schema copied from `openapi-integration-targets.test.js`. One change: tagged values are wrapped as `{ '!Tag': data }`, so `!GetAtt UsersTable.Arn` and `!Ref TierCommonLayer` are distinguishable from plain strings. `T` is not edited in this task.

Run: `cd RF && timeout 300s npx jest tests/unit/architecture/users-table-access.test.js --coverage=false`. No jest processes were running before or after. Result: 1 suite failed, 4 tests failed, 5 passed. `npx eslint` on the file reports nothing.

Passing (the layer wiring from task 7.2, plus two guards that the current statement already satisfies):

| Test | Checks |
|------|--------|
| L1 | `TierCommonLayer` is `AWS::Serverless::LayerVersion` named `${Prefix}-${ProjectId}-${StageId}-TierCommon`, `ContentUri` `src/lambda/layers/tier-common/`, runtime `nodejs24.x`, architectures `arm64` and `x86_64`, `RetentionPolicy: Delete` |
| L2 | The only string values anywhere in `T` that mention `TierCommonLayer` are the `!Ref` entries in `ReadLambdaFunction` and `AuthLambdaFunction` `Layers` |
| L3 | `ReadLambdaFunction` lists five layers |
| P5 | The Users table statements grant no `PutItem`, `DeleteItem`, `Scan`, `Query`, `BatchGetItem`, `BatchWriteItem`, wildcard action, or `Resource: '*'`. Passes today because `UsersTableAuthAccess` has only `GetItem` and `UpdateItem` on `UsersTable.Arn`. It stays as a guard for task 12.2 |
| P6 | No statement other than the two Users table ones grants a DynamoDB action on `Resource: '*'` |

Failing, each for the expected reason (no parse or syntax error; the template loads and the role and policy are found):

| Test | Reason |
|------|--------|
| P1 | `UsersTableAuthAccess` is still in the role's statements |
| P2 | The statements naming `UsersTable` are `["UsersTableAuthAccess"]`, expected `["UsersTableAuthRead", "UsersTableAuthUpdate"]` |
| P3 | `Statement UsersTableAuthRead is missing from ReadLambdaExecutionRole` (the message lists the Sids found) |
| P4 | `Statement UsersTableAuthUpdate is missing from ReadLambdaExecutionRole` |

P3 and P4, once the statements exist, check: only the keys `Sid`, `Effect`, `Action`, `Resource`, `Condition`; one action; `Resource` exactly `[!GetAtt UsersTable.Arn]`; condition operators exactly `ForAllValues:StringLike`, `ForAllValues:StringEquals`, `StringEqualsIfExists`; `dynamodb:LeadingKeys` `["KEY#*"]`; the attribute lists of Design 10 (seven for read, six for update, compared as sets); `dynamodb:Select` `SPECIFIC_ATTRIBUTES` and `dynamodb:ReturnValues` `NONE`.

Not asserted: use of AWS managed policies for this access. Design 11 does not list it for this file.
## Phase 2, Users table IAM statements (task 12.2)
Edited only `T` (`application-infrastructure/template.yml`), `ReadLambdaExecutionRole`: `UsersTableAuthAccess` is replaced by `UsersTableAuthRead` (`dynamodb:GetItem`) and `UsersTableAuthUpdate` (`dynamodb:UpdateItem`), copied from Design 10 with the `# >!` comments. Both statements use `Resource: [!GetAtt UsersTable.Arn]` and the conditions `ForAllValues:StringLike` `dynamodb:LeadingKeys: ["KEY#*"]`, `ForAllValues:StringEquals` `dynamodb:Attributes` (read: `pk`, `tier`, `tierExpiresAt`, `ttl`, `cognitoSub`, `fallbackTier`, `fallbackExpiresAt`; update: `pk`, `tier`, `tierExpiresAt`, `ttl`, `fallbackTier`, `fallbackExpiresAt`), and `StringEqualsIfExists` (`dynamodb:Select: SPECIFIC_ATTRIBUTES` for read, `dynamodb:ReturnValues: NONE` for update). No test change was needed; the test and Design 10 agree. Nothing was deployed and no AWS call was made.
No jest processes were running before or after any run.
| Step | Command | Result |
|------|---------|--------|
| Red (before the edit) | `cd RF && timeout 300s npx jest tests/unit/architecture --coverage=false` | 1 suite failed, 4 tests failed (P1 to P4), 36 passed of 40 |
| Green (after the edit) | same | 6 suites passed, 40 of 40 tests passed (`users-table-access.test.js` 9 of 9) |
| Whole `RF` suite | `cd RF && timeout 900s npx jest` | 186 suites passed, 6 skipped (192); 2260 tests passed, 115 skipped (2375); 1 snapshot passed; 23.0 s test time (23.5 s wall) |
| Lint | `cd RF && npm run lint` | 7318 problems (7316 errors, 2 warnings), identical to the task 11 checkpoint. The new test file adds none, and `users-table-access.test.js` does not appear in the output |
`git diff -- application-infrastructure/template.yml`: apart from the 31 layer lines from task 7.2 (hunks at new lines 774, 852, and 1136: 23, 5, and 3 lines), the only change is the replaced statement. It removes `- Sid: UsersTableAuthAccess` and `- dynamodb:UpdateItem` from the first statement, and adds the two commented statements with their conditions. No other statement, resource, parameter, or the OpenAPI spec was touched.
Open point carried forward (Design "Open points"): `GetItem` has no `Select` parameter, and the `IfExists` form should let it pass. If the `test` stage shows a denial, drop the `dynamodb:Select` block first, then fall back to the `LeadingKeys`-only conditions (Requirement 13.9, Owner decision).

## Phase 2, offline template check (task 12.3)

Requirement 6.10. V-B, using the offline translator procedure from the earlier spec (`0-0-7-api-gateway-live-alias`, V-A and task 4.1). The working tree held the task 7.2 layer lines and the task 12.2 IAM statements. No AWS call was made and no credentials were provided. Nothing was deployed.

### Method

- Throwaway virtual environment in `/tmp/sam-translate-12-3`, with `aws-sam-translator` 1.115.0 and `pyyaml` 6.0.3 (the only packages installed, from PyPI).
- Parsed `template.yml` and `template-openapi-spec.yml` with the translator's `yaml_parse`. Put the OpenAPI Spec into `Resources.WebApi.Properties.DefinitionBody` and dropped the dashboard include. Replaced every `CodeUri` and `ContentUri` string with `s3://bucket/key`. Took parameter defaults (a placeholder value for a parameter without a default). Set `DeployEnvironment` to `PROD`, then `TEST`.
- Offline mode: the managed policy loader was given an empty policy map, so the translator never called IAM.
- Translated the real `template.yml` for both stages (58 translated resources each). The template was not edited.

### Results

All checks passed for `PROD` and for `TEST`.

| # | Confirmation | PROD | TEST |
|---|--------------|------|------|
| 1 | `TierCommonLayer` translates to one `AWS::Lambda::LayerVersion` (`TierCommonLayercada58b57c`). It is in the `Layers` of exactly `ReadLambdaFunction` and `AuthLambdaFunction`, and of no other function (the other three functions are `CleanupFunction`, `DocIndexerFunction`, `S3VectorsProvisionerFunction`). No non-function resource references it. The Read function has five layers; the Auth function has three | pass | pass |
| 2 | `ReadLambdaFunctionMcpV1PostPermissionStage` has `FunctionName` `Ref ReadLambdaFunctionAliaslive`. The `/mcp/v1` integration URI contains `${ReadLambdaFunctionAliaslive}`. The `aws_proxy` integrations under `/mcp/auth/*` still use `${AuthLambdaFunction.Arn}` | pass | pass |
| 3 | `UsersTableAuthRead` and `UsersTableAuthUpdate` in the translated `ReadLambdaExecutionRole` are equal to the source statements (compared as whole statements: `Sid`, `Effect`, `Action`, `Resource`, `Condition`). `UsersTableAuthAccess` is absent from the source role, the translated role, and the whole translated template | pass | pass |
| 4 | A depth-first walk over `Ref`, `Fn::GetAtt`, `Fn::Sub` (including its variable map), and `DependsOn` across the 58 translated resources found no cycle | pass | pass |

Known limitation (as in the earlier spec): the local translator does not apply CloudFormation's server-side SAM version or feature toggles, and it does not run CloudFormation's own `AWS::Include` expansion. The `test` deploy covers both.

### Cleanup

The `/tmp/sam-translate-12-3` directory (virtual environment, check script, and debug script) was removed with `rm -rf` and then confirmed absent. No output files were written. The only repository file changed by this task is this one.

## JSDoc sweep (task 13.4)

Requirement 16.5. Comment-only edits; no code changed.

### Functions checked (signature, parameter names and types, return shape, thrown errors, at least one `@example`, `tierExpiresAt` described as an ISO 8601 string or null)

- Layer `effective-tier.js`: `parseTierExpiry`, `tierRank`, `computeEffectiveTier`, `fallbackFromRecord`, `resolveRecordTier`, `malformedExpiryLogFields`, plus the module header and the `TIER_RANK` and `EXPIRY_STATE` constants. No change needed.
- `read-function/utils/tier-common.js` and `auth-function/utils/tier-common.js` (`loadTierCommon`). No change needed.
- `read-function/utils/auth-resolver.js`: `computeEffectiveTier` wrapper, `refreshTtl`, `downgradeLapsedTier`, `maintainUserRecord`, `onUserWriteError`, `resolveAuth` and the module header. No change needed (the flow comment already describes the Downgrade and renewal of any tier).
- `auth-function/services/profile.js`: `computeEffectiveTier` wrapper, `getProfile`.
- `auth-function/services/voucher-redeem.js`: `decideRedemption`, `redeemVoucher`, `validateVoucher`. No change needed (both `decideRedemption` examples were checked against the code).
- `auth-function/models/user.js`: `updateUserTier` (`expected` and `fallback` options, condition table, rethrow behavior). No change needed.
- `auth-function/services/key-regenerate.js`: `regenerateKey`.
- `auth-function/controllers/voucher-redeem.js`: `VoucherRedeemController.post` (lists 200, 400, 401, 404, 409, 500). No change needed.

### Edits

| File | Edit |
|------|------|
| `auth-function/services/profile.js` | Workflow step 2 now names `TierCommon.resolveRecordTier`, the remembered lower tier, and says the profile only reads (the Read function writes the lapsed tier back). `return.tierExpiresAt` now reads "Stored end date as an ISO 8601 string, or null". `@throws` corrected from `{Object}` to `{Error}` with `statusCode` 404, matching the code. |
| `auth-function/services/key-regenerate.js` | Workflow step 5 and the matching in-code comment now mention `tierExpiresAt` as an ISO 8601 string or null and the carried `fallbackTier` / `fallbackExpiresAt`. `@throws` corrected from `{Object}` to `{Error}` with `statusCode` 404. |

### Grep: `grep -rn "Unix epoch seconds" application-infrastructure/src --include=*.js --exclude-dir=node_modules`

- Before and after (identical): 6 hits, none describing `tierExpiresAt`. All are `ttl` (`read-function/utils/auth-resolver.js` L182, `auth-function/handlers/post-confirmation.js` L250, `services/key-regenerate.js` L66, `models/user.js` L180) or test files (`window-reset.property.test.js` for the window reset time, `user-dao-roundtrip.property.test.js` for `ttl`). Left alone as instructed.
- A wider search of non-test source for `tierExpiresAt`, "epoch", "Unix time", and "treated as registered" found no JSDoc or comment that describes a tier end date in epoch seconds, or says a lapsed tier is only treated as registered without the write-back. The static profile page (`static/public/profile/index.html`) already says "ISO 8601 expiration or null".

### Checks

- `node --check` on both edited files (`services/profile.js`, `services/key-regenerate.js`): pass.
- No jest processes before or after the runs.
- Read function (`npx jest --coverage=false`): 186 suites passed, 6 skipped; 2260 tests passed, 115 skipped.
- Auth function: 41 suites, 495 tests passed.
- `tier-common` layer: 2 suites, 169 tests passed.
- All counts match the expected values.

## Final sweep (task 14.1)

Requirements 15.10, 17.1, 18.1 to 18.9. Nothing was fixed, committed, or deployed. No `npm ci` was run. Before and after the runs there were no jest processes. No temporary `HEAD` copy remains.

### Suites (Jest called directly, with timeouts)

| Package | Command | Suites | Tests |
|---------|---------|--------|-------|
| `RF` | `timeout 900s npx jest` | 186 passed, 6 skipped (192) | 2260 passed, 115 skipped (2375), 1 snapshot passed |
| `AF` | `timeout 900s npx jest` | 41 passed | 495 passed |
| `TC` | `timeout 300s npx jest` | 2 passed | 169 passed |

All three match the expected counts. All pass.

### Lint

| Package | `npm run lint` (`eslint .`) | Task 11 record | Result |
|---------|-----------------------------|----------------|--------|
| `TC` | exit 0, no findings (only a Node `MODULE_TYPELESS_PACKAGE_JSON` notice about `eslint.config.js`) | exit 0 | passes outright |
| `RF` | 7318 problems: 7316 errors, 2 warnings | 7318 (7316 errors, 2 warnings) | identical total; fails at `HEAD` too (tabs against the 2-space config) |
| `AF` | 8595 problems: 8595 errors, 0 warnings | 8596 errors | 1 lower, explained below; fails at `HEAD` too |

Rule breakdown now. `RF`: `indent` 6640, `no-trailing-spaces` 399, `no-unused-vars` 94, `brace-style` 60, `curly` 52, `quotes` 44, `no-multiple-empty-lines` 16, `prefer-const` 5, `eol-last` 2, `semi` 2, `import/no-dynamic-require` 2, `null` 2. `AF`: `indent` 8492, `brace-style` 66, `no-unused-vars` 21, `eqeqeq` 5, `prefer-const` 5, `no-multiple-empty-lines` 4, `no-console` 2.

Differences from task 11's recorded numbers, and why:

- `AF` 8596 to 8595 (`eqeqeq` 6 to 5): the task 11 totals were measured before the checkpoint fix to `AF/tests/unit/voucher-redeem-service.test.js` (line 753, `== null` rewritten as `=== null || === undefined`). The task 11 table still says that file had `eqeqeq` 1 before the fix and `indent` 690 after. The record of 8596 therefore included that one finding. Task 13.4 changed only comments in `services/profile.js` and `services/key-regenerate.js`; it did not change the count.
- `RF` total unchanged at 7318. Task 12.1 added `tests/unit/architecture/users-table-access.test.js` in 2-space style with no findings. The same task 11 fix in `RF/tests/unit/utils/auth-resolver.test.js` (`brace-style` split over three lines) moved the breakdown by `brace-style` 62 to 60 and `indent` 6638 to 6640, with the total unchanged.

Per-file comparison with `HEAD` (temporary `git show HEAD:<path>` copy next to the file, linted with the package's eslint, deleted; no `git stash`, `checkout`, or `reset`). Rule counts, `HEAD` then now:

| File | `HEAD` | Now |
|------|--------|-----|
| `AF/controllers/voucher-redeem.js` | indent 60, no-unused-vars 1 | indent 64, no-unused-vars 1 |
| `AF/index.js` | indent 66, no-console 2, no-unused-vars 1 | same |
| `AF/jest.setup.js` | indent 6 | indent 7 |
| `AF/models/user.js` | indent 91 | indent 130 |
| `AF/services/key-regenerate.js` | indent 46, no-unused-vars 1 | indent 53, no-unused-vars 1 |
| `AF/services/profile.js` | indent 58, no-unused-vars 1 (`DebugAndLog` unused) | indent 64 |
| `AF/services/voucher-redeem.js` | indent 58, no-unused-vars 2 | indent 144, no-unused-vars 2 |
| `AF/tests/property/effective-tier.property.test.js` | indent 46 | indent 119 |
| `AF/tests/property/key-regenerate-response.property.test.js` | indent 76 | indent 106 |
| `AF/tests/property/voucher-redeem-response.property.test.js` | indent 87 | indent 195 |
| `AF/tests/property/voucher-validation.property.test.js` | indent 174 | indent 304 |
| `AF/tests/unit/key-regenerate-service.test.js` | indent 150 | indent 193 |
| `AF/tests/unit/profile-service.test.js` | indent 181, no-unused-vars 1 | indent 234, no-unused-vars 1 |
| `AF/tests/unit/user-dao.test.js` | indent 227, brace-style 4 | indent 396, brace-style 4 |
| `AF/tests/unit/voucher-redeem-controller.test.js` | indent 251, brace-style 4 | indent 271, brace-style 4 |
| `AF/tests/unit/voucher-redeem-service.test.js` | indent 222 | indent 690 |
| `RF/jest.setup.js` | indent 7 | indent 8 |
| `RF/utils/auth-resolver.js` | eqeqeq 2 | none |
| `RF/tests/property/auth-resolver-preservation.property.test.js` | indent 88 | indent 110 |
| `RF/tests/property/auth-resolver.property.test.js` | indent 196, no-unused-vars 1 | indent 223, no-unused-vars 1 |
| `RF/tests/property/ttl-refresh.property.test.js` | indent 204 | indent 288 |
| `RF/tests/unit/utils/auth-resolver.test.js` | indent 307 | indent 734 |
| New: `AF/utils/tier-common.js`, `RF/utils/tier-common.js` | n/a | indent 4 each |
| New: `RF/tests/property/effective-tier-delegation.property.test.js` | n/a | indent 82 |
| New: `RF/tests/unit/architecture/users-table-access.test.js` | n/a | none |
| New: `TC` files | n/a | none (the `TC` run exits 0) |

No changed or new file has a rule category its `HEAD` version lacked. `indent` rises only where tab-indented code was added to files that already use tabs. The two `eqeqeq` findings in `RF/utils/auth-resolver.js` and the unused `DebugAndLog` in `AF/services/profile.js` are gone.

### Leftover searches

Searched the working tree excluding `node_modules`, `.git`, and `.kiro/specs`.

| Search | Result |
|--------|--------|
| `tierExpiresAt <=` | no hit |
| `new Date(tierExpiresAt)` | no hit |
| `new Date(userRecord.tierExpiresAt)` | 1 hit, a test: `AF/tests/property/voucher-redeem-response.property.test.js:319` (this spec's task 10.1 property). The record is generated by the test as an ISO string, and the line only compares the `extend` result against it in an assertion. It is not production code. |
| Related: `new Date(tierExpiresAt) < new Date()` | 1 hit, a test oracle: `AF/tests/property/profile-response-structure.property.test.js:169`. The file is unmodified by this spec and passes (the generator produces ISO strings or null). Not production code. |
| "until the lapsed-tier fix ships", "once the lapsed-tier fix ships", "not renewed by use yet" (code, docs, `.kiro` outside `specs`) | 1 hit, `CHANGELOG.md:95`, "Records with a tier end date (voucher users) are renewed once the lapsed-tier fix ships", in the phase 1 **Fixed** entry. Expected, and not edited. No other hit. |
| `fallbackTier` | Only in: the layer (`TC/nodejs/effective-tier.js`, `TC/tests/unit/effective-tier.test.js`), `RF/utils/auth-resolver.js`, `AF/services/profile.js`, `AF/services/voucher-redeem.js`, `AF/models/user.js`, `AF/services/key-regenerate.js`, their tests (`AF/tests/property/{key-regenerate-response,voucher-redeem-response,voucher-validation}`, `AF/tests/unit/{key-regenerate-service,profile-service,user-dao,voucher-redeem-service}`, `RF/tests/property/ttl-refresh`, `RF/tests/unit/utils/auth-resolver`, `RF/tests/unit/architecture/users-table-access`), `application-infrastructure/template.yml`, `docs/admin-ops/user-management.md`, `docs/admin-ops/voucher-management.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, and this spec's files. Nothing outside that list. |

### Git checks

- `git diff -- application-infrastructure/template.yml`: 72 insertions, 1 deletion, in six hunks. `TierCommonLayer` resource (+23, new lines 774-796). `ReadLambdaFunction.Layers` entry with the five-layer comment (+5). `AuthLambdaFunction.Layers` entry (+3). The `UsersTableAuthAccess` statement replaced by `UsersTableAuthRead` and `UsersTableAuthUpdate` (+41 net of the one removed `Sid` line, in three hunks at new lines 1987, 1993, 2020). Nothing else.
- `git diff -- application-infrastructure/template-openapi-spec.yml`: 12 insertions, 0 deletions, one hunk: the `'404'` and `'409'` responses of `POST /mcp/auth/voucher/redeem`.
- `AF/services/key-regenerate.js`: JSDoc and comment updates (workflow step 5, `@throws` type), `const newRecord = {...}`, the conditional fallback copy with its `>!` comment, and `putUserRecord(newRecord)`. No other change (task 10.4 plus the task 13.4 comments).
- New `package.json` and lockfile: only `TC/package.json` and `TC/package-lock.json` (`git status -uall`). `TC/node_modules` is ignored (`.gitignore:17`).
- `AF/package-lock.json`, `RF/package-lock.json`, and both functions' `package.json`: no modification in `git status` or `git diff --stat`. This is what I checked for "unchanged by `npm ci`". I did not run `npm ci` over the existing `node_modules`.
- `CHANGELOG.md`: 23 insertions, 0 deletions. `.kiro/specs/0-0-3-add-authentication/design.md`: 5 insertions, the two superseded notes only.
- `TODO.md`: not modified (it does not appear in `git status`).

### `git status --short` mapped to the plan

| File | Task |
|------|------|
| `AF/controllers/voucher-redeem.js` | 10.2 |
| `AF/index.js` | 7.1 |
| `AF/jest.setup.js` | 7.1 |
| `AF/models/user.js` | 10.2 |
| `AF/services/key-regenerate.js` | 10.4, 13.4 |
| `AF/services/profile.js` | 8.2, 13.4 |
| `AF/services/voucher-redeem.js` | 10.2 |
| `AF/tests/property/effective-tier.property.test.js` | 8.1 |
| `AF/tests/property/key-regenerate-response.property.test.js` | 10.4 |
| `AF/tests/property/voucher-redeem-response.property.test.js`, `voucher-validation.property.test.js` | 10.1 (the first also adjusted at the task 11 checkpoint) |
| `AF/tests/unit/key-regenerate-service.test.js` | 10.4 |
| `AF/tests/unit/profile-service.test.js` | 8.1 |
| `AF/tests/unit/user-dao.test.js`, `voucher-redeem-controller.test.js`, `voucher-redeem-service.test.js` | 10.1 (the last also fixed at the task 11 checkpoint) |
| `RF/jest.setup.js` | 7.1 |
| `RF/utils/auth-resolver.js` | 2.1, 8.2, 9.2 |
| `RF/tests/property/ttl-refresh.property.test.js` | 1.1, 9.1 |
| `RF/tests/property/auth-resolver.property.test.js`, `auth-resolver-preservation.property.test.js` | 8.1 |
| `RF/tests/unit/utils/auth-resolver.test.js` | 1.2, 8.1, 9.1 (also fixed at the task 11 checkpoint) |
| `application-infrastructure/template.yml` | 7.2, 12.2 |
| `application-infrastructure/template-openapi-spec.yml` | 10.3 |
| `docs/admin-ops/user-management.md`, `docs/admin-ops/voucher-management.md` | 3.1, 13.1 |
| `docs/end-user/troubleshooting/README.md` | 3.3, 13.3 |
| `ARCHITECTURE.md` | 13.2 |
| `CHANGELOG.md` | 3.4, 13.6 |
| `.kiro/specs/0-0-3-add-authentication/design.md` | 13.5 |
| `.kiro/specs/0-0-7-lapsed-tier-downgrade/{VERIFICATION.md,tasks.md,tasks.meta.json}` | spec bookkeeping |
| New: `AF/utils/tier-common.js`, `RF/utils/tier-common.js` | 7.1 |
| New: `RF/tests/property/effective-tier-delegation.property.test.js` | 8.1 |
| New: `RF/tests/unit/architecture/users-table-access.test.js` | 12.1 |
| New: `application-infrastructure/src/lambda/layers/tier-common/` (`.nvmrc`, `eslint.config.js`, `jest.config.js`, `jest.setup.js`, `package.json`, `package-lock.json`, `nodejs/effective-tier.js`, two test files) | 6.1 to 6.3 |

Every changed or new file maps to tasks 1 to 13. Nothing is unexplained. `docs/developer/post-deploy-verification.md` and `docs/admin-ops/post-deploy-verification.md` (task 3.2) do not appear as modified in `git status` because the phase 1 edits (task 3.2, "Key lifetime" section) are already committed (`6b0018b implemented phase 1 of 0.0.7-lapsed tier downgrade`). Phase 2 did not touch them.

### Items to report (not changed)

1. The two test-file `new Date(...tierExpiresAt)` hits above. Neither is production code.
2. The `AF` lint total (8595) is one below task 11's record (8596), explained above.
3. The four `indent` findings in each `tier-common.js` loader are the same tab-against-2-space mismatch as the rest of both functions.
4. `CHANGELOG.md:95` keeps the phase 1 wording "once the lapsed-tier fix ships", as instructed.

## Phase 2, 15.1 manual test (Downgrade on test)

Build and PostDeploy result for the phase 2 deploy to `test`: not recorded by the owner.

Before

```json
{
    "Item": {
        "tier": {
            "S": "paid"
        },
        "tierExpiresAt": {
            "S": "2026-11-02T23:29:18Z"
        },
        "ttl": {
            "N": "1804287842"
        }
    }
}
```

```bash
curl -si -X POST "$ENDPOINT/mcp/v1"   -H 'Content-Type: application/json'   -H "Authorization: Bearer $API_KEY"   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'   | grep -iE '^HTTP|^x-ratelimit-limit|^x-mcp-auth-status'
```

Result:

```
HTTP/2 200 
x-ratelimit-limit: 100
```

`x-mcp-auth-status` did not appear.

```json
{
    "Item": {
        "tier": {
            "S": "registered"
        },
        "tierExpiresAt": {
            "NULL": true
        },
        "ttl": {
            "N": "1804289791"
        }
    }
}
```

after: 119 days ahead; changed by 1949 s

Cloudwatch logs:

```
2026-11-05T23:36:31.348Z        a660f12b-5050-422e-8ed1-ce169be6eb2e    INFO    [INFO] TIER_LAPSE_DOWNGRADE {"fromTier":"paid","toTier":"registered"}

AccessDeniedException count: 0
```

15.1: pass

## Phase 2, 15.2 manual test (voucher rule and restore on test)

Tried applying voucher to a private tier in profile:

```
Voucher not applied: your account already has the private tier.
```
HTTP STATUS 400
{"error":"Voucher not applied: your account already has the private tier."}

Voucher was not used:

```
{
    "Item": {
        "currentUses": {
            "N": "0"
        },
        "maxUses": {
            "N": "1"
        },
        "targetTier": {
            "S": "paid"
        }
    }
}
```

Voucher for paid to private:

on the first run (about 04:40Z on 2026-11-06) the voucher applied with no fallback. That attempt used the iso_in_days-generated PAID_END. The od check showed the function's output is clean. The cause is not found, and the repeat that worked used a hand-typed date.

before

```
{
    "Item": {
        "tier": {
            "S": "paid"
        },
        "tierExpiresAt": {
            "S": "2027-01-05T04:57:57Z"
        },
        "ttl": {
            "N": "1804308040"
        }
    }
}
```

After:
```
{
    "Item": {
        "fallbackExpiresAt": {
            "S": "2027-01-05T04:57:57Z"
        },
        "fallbackTier": {
            "S": "paid"
        },
        "tier": {
            "S": "private"
        },
        "tierExpiresAt": {
            "S": "2026-11-07T05:00:31.537Z"
        },
        "ttl": {
            "N": "1804309231"
        }
    }
}
```

fallback end date MATCHES

Forced lapse (tierExpiresAt set to a past date, then one authenticated request):

HTTP/2 200 
x-ratelimit-limit: 3000
x-mcp-auth-status didn't appear

dynamo db query
{
    "Item": {
        "tier": {
            "S": "paid"
        },
        "tierExpiresAt": {
            "S": "2027-01-05T04:57:57Z"
        },
        "ttl": {
            "N": "1804311021"
        }
    }
}

Log

2026-11-06T05:09:02.074Z        2a217aa3-50df-4f07-8583-aa8794e137d4    INFO    [INFO] TIER_LAPSE_DOWNGRADE {"fromTier":"private","toTier":"paid"}

AccessDeniedException count: 0

I re-ran the 15.2B steps, hand entering the PAID_END.
Logs show:
2026-11-06T05:09:02.074Z        2a217aa3-50df-4f07-8583-aa8794e137d4    INFO    [INFO] TIER_LAPSE_DOWNGRADE {"fromTier":"private","toTier":"paid"}
        2026-11-06T05:30:21.771Z        f57dbfdb-d669-4466-80f1-b8f5d3d404b4    INFO    [INFO] TIER_LAPSE_DOWNGRADE {"fromTier":"private","toTier":"paid"}

From both runs.

Result:

- Voucher rule checked: redeeming a voucher over a private tier returned 400 with the message "Voucher not applied: your account already has the private tier.", and the voucher was not used up (`currentUses` stayed 0).
- Remembered tier written on redemption: `fallbackTier` and a `fallbackExpiresAt` that matches the previous end date.
- Restore on lapse: the request after the forced lapse was served the paid limit (`x-ratelimit-limit: 3000`), the end date was restored, both fallback attributes were removed, and `TIER_LAPSE_DOWNGRADE` was logged with `fromTier` private and `toTier` paid. The `AccessDeniedException` count was 0.
- The restore cycle ran twice. The log lines are at 05:09:02Z and 05:30:21Z, and the final record belongs to the second run.
- Cleanup done (vouchers deleted, accounts reset to their prior state), which the owner confirmed in chat.

Pass, with one open item: on the very first run (about 04:40Z on 2026-11-06) the redemption wrote no fallback attributes. That attempt used the iso_in_days-generated PAID_END; a byte check (od -c) showed the function's output was clean. The two later cycles used a hand-typed PAID_END and wrote the fallback correctly. The cause was not found and the generated-value cycle was not repeated. The owner accepted this open item on 2026-11-06 and chose to continue.

## Final verification

Run scan count on Beta and Prod:

beta: lapsed = 0
prod: lapsed = 0
