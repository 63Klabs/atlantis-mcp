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
