# Verification record

## Phase 1 red run (task 1.4)

Command, from `application-infrastructure/src/lambda/read-function`, against the unchanged server:

```bash
timeout 300s npx jest <the 10 test files changed in tasks 1.1 to 1.3> --coverage=false
```

Result: 10 suites failed, 40 tests failed, 127 passed, 167 total (1.2 s). Every failure is an assertion mismatch of the expected kind. No syntax, import, or setup errors. No stray jest processes before or after.

| Suite | Failing tests | Reason |
|-------|---------------|--------|
| `integration/mcp-protocol-unsupported-version` | 17 (all `-32022` cases: header, `_meta`, top-level `_meta`, header-wins, malformed values, four header-name casings, no-leak, `initialize` guard rail) | `Expected: 400, Received: 200` in `send()`. The key-name assertions (`requested`, `supported`) are not reached yet. |
| `integration/mcp-protocol-header-validation` | 4 (`Mcp-Method` and `Mcp-Name` mismatch, two case-insensitive cases) | `-32020` status: `Expected: 400, Received: 200` |
| `integration/mcp-protocol-discover-no-auth` | 1 (invalid `id` type) | Server answers with a result: `Cannot read properties of undefined (reading 'code')` |
| `integration/mcp-protocol-compliance` | 1 (`-32700` for non-JSON) | `not.toHaveProperty('id')`, received `null` |
| `unit/utils/json-rpc-router` | 12 | See below |
| `unit/utils/mcp-protocol-jsonrpc` | 1 (`jsonRpcError` works with null id) | `not.toHaveProperty('id')`, received `null` |
| `unit/utils/auth-resolver` | 1 (401 for unknown key) | `not.toHaveProperty('id')`, received `null` |
| `property/error-codes.property` | 1 (`-32700` for non-JSON bodies) | `not.toHaveProperty('id')`, received `null` |
| `property/json-rpc-envelope.property` | 1 (error half) | `not.toHaveProperty('id')`, received `null` |
| `unit/routes/routes-mcp-v1` | 1 (202 with empty body, Req 25.5) | `SyntaxError: Unexpected end of JSON input` from `JSON.parse('')` in `routes/index.js` |

`json-rpc-router` failures:

- Parse error with empty/null body, invalid JSON, and "a parse error carries no id" (3): `not.toHaveProperty('id')`, received `null`.
- Invalid `id` of `null`, `{}`, `true`, `1.5`, and on `server/discover` (5): server answers with a result, so `body.error` is undefined.
- `notifications/initialized` and an unknown notification method (2): `Expected: 202, Received: 200` (server answers `-32601`).
- Notification with unlisted revision (1): `Expected: 400, Received: 200`.
- Modern notification with `Mcp-Method` mismatch (1): `Expected: 400, Received: 200`.

Passing as expected on the unchanged server: accepted requests keep 200, numeric and string ids are echoed, `server/discover` with an unlisted revision returns 200 with no `error`, and formatter-level success tests.

## Phase 1 green run (task 2.4)

Run from `application-infrastructure/src/lambda/read-function` with the fixed server. No stray jest processes before or after any run.

### Changed files (tasks 1.1 to 1.3)

`timeout 300s npx jest <the 10 files> --coverage=false`: 10 suites passed, 167 tests passed (1.1 s). On the red run, 40 of the same 167 tests failed.

### Whole suite

| Run | Suites | Tests | Time |
|-----|--------|-------|------|
| First (before stale-test fixes) | 3 failed, 178 passed, 6 skipped | 4 failed, 2119 passed, 115 skipped, 2238 total | 24.2 s |
| Second (after stale-test fixes) | 181 passed, 6 skipped, 187 total | 2123 passed, 115 skipped, 2238 total | 23.9 s |

The skipped suites are the ones that need AWS or GitHub access. They were skipped before the change as well.

Stale tests found by the first run and fixed (tests only):

- `tests/property/jsonrpc-roundtrip.property.test.js` (2 tests) and `tests/property/catalog-single-sourcing.property.test.js` (1 test): the id generators included `null`, which now gets `-32600`. `null` is removed from the generators, and the unit tests in `json-rpc-router.test.js` already cover a `null` id.
- `tests/unit/architecture/no-hardcoded-revisions.test.js` (1 test): the scan matched revision strings in the `>!` comments added to `utils/json-rpc-router.js` (they cite which schema revision defines each behavior). The scan now skips comment-only lines, so a revision string in code is still a violation. The alternative is to reword the comments to drop the revision strings. The owner can choose that instead.

Search for other old-behavior assertions (`grep -rn -E "toBeNull\(\)|notifications/" tests`): no other hit asserts `id: null` on an error or `-32601` for a notification. The remaining `toBeNull` hits on `id` are formatter-level success tests (`jsonRpcSuccess`, `initializeResult`, `discoverResult`), which Design 20 leaves unchanged. The `id: null` values in `routes-mcp-v1.test.js` and `client-request-response.property.test.js` are mock return values.

### Lint

`npm run lint` (`eslint .`) fails: 6540 problems (6538 errors, 2 warnings). The failure is not new. The same command on the tree before the change (`git stash`, restored afterward) reported 6538 problems (6536 errors, 2 warnings), almost all `indent` (tabs) and `no-trailing-spaces`. Per-file counts for every changed file, before and after, are equal except `tests/unit/utils/auth-resolver.test.js` (+2 `indent` errors from the two lines added in task 1.2, which follow that file's existing tab indentation). `routes/index.js`, `utils/json-rpc-router.js`, and `utils/mcp-protocol.js` have 0 errors. `utils/auth-resolver.js` has 3 `eqeqeq` errors that existed before the change.

### Red-green checks (Design V-B 1 and 2)

The production file was copied to `/tmp/json-rpc-router.js.fixed` first. After each check it was restored from that copy. `diff` against the copy is empty, the md5 matches (`84117f91...`), and `git diff utils/json-rpc-router.js` is identical to the diff taken before the checks.

| Check | Edit | Result |
|-------|------|--------|
| V-B 1 | `-32022` data keys back to `declaredRevision` / `supportedVersions` | `mcp-protocol-unsupported-version.test.js`: 10 failed, 19 passed. The failures read `body.error.data.requested` (`Expected: "2099-01-01"`, `Received: undefined`) and the "not `declaredRevision`" assertion. |
| V-B 2 | `PROTOCOL_ERROR_HTTP_STATUS = 200` | `mcp-protocol-unsupported-version`, `mcp-protocol-header-validation`, and `json-rpc-router` tests: 23 failed, 61 passed, all `Expected: 400, Received: 200`. |

## Phase 2 red run (task 4.3)

`timeout 600s npm test` in `application-infrastructure/tests/postdeploy-verify`, against the unchanged fake (`helpers/fake-mcp-server.mjs`, which still answers protocol errors with HTTP 200). No jest processes were running before or after. No files were edited.

| Suites | Tests |
|--------|-------|
| 4 failed, 8 passed, 12 total | 69 failed, 673 passed, 742 total |

Failing suites: `checks-tests`, `outcome-and-report-tests`, `cli-tests`, `budget-tests`. The other eight pass, including `fake-mcp-server-tests`, `http-client-tests`, `inputs-tests`, `buildspec-and-wrapper-tests`, and the property suites.

Sub-checks the verifier reported as failed across all runs: P3.1, P3.2, P3.3, P4.1, P4.2, P4.4 (core, `FAIL`) and X2.3, X2.4 (advisory, `WARN`). Every reason reads `HTTP 200, expected 400`; all 39 "expected" messages in the log are `expected 400`. No other sub-check ID failed, and no other status mismatch appeared.

The 69 failing tests are knock-on failures of those eight sub-checks, in four groups:
- **Healthy-run tests** (`healthy stage`, `run`, `default command`, `local run`, `S2 and the key`, `Summary counts`, `Report`, `Run outcomes` passed cases, `X2 without an edge target`, `dispatch`, `unexpected errors`): the run is now `failed` and exits 1 where the test expects `passed` and 0. This includes the `ok` result the tests read from a healthy fake.
- **Budget tests** (4 in `budget-tests`): fail at the first assertion, `exitCode` 1 instead of 0, before the counted-POST count is checked.
- **"Every sub-check can fail with its documented reason"** rows for sub-checks outside the eight (S1.1, S2.1 to S2.3, T1.1, X2.1, X2.2): the advisory rows expect exit 0 and `failedCore` empty, but the run also fails P3/P4 on the old fake. The P3.1, P3.2, P3.3, P4.1, P4.2, P4.4, X2.3, and X2.4 rows fail for the same reason (their healthy baseline no longer holds).
- **Rate-limit and raw-target-down tests** (`inconclusive`, `rate limited`, `raw target down`, `owner and "see" reasons`): `outcome` is `failed` rather than `inconclusive`, because P3/P4 fail on 200 before or alongside the case under test.

Nothing unrelated to the verifier now expecting 400 failed. Green half: task 5.

## Phase 2 green run (task 5.3)

`timeout 600s npm test` in `application-infrastructure/tests/postdeploy-verify`, against the conformant fake (`helpers/fake-mcp-server.mjs` from task 5.1, with the tests from task 5.2). Exit code 0. No jest processes were running before or after. No code was changed for this run.

| Suites | Tests |
|--------|-------|
| 12 passed, 12 total | 751 passed, 751 total |

This is the green half of Design V-B 5. The red run (task 4.3) had 4 failed suites and 69 failed tests out of 742. The 9 additional tests come from the new failure rows and tests added in task 5.2.

`outcome-and-report-tests.jest.mjs` (the 45 pinned IDs) and `budget-tests.jest.mjs` both pass and are unedited. `git diff --stat` for both files is empty. The only changed files in the package are `checks-tests.jest.mjs`, `fake-mcp-server-tests.jest.mjs`, and `helpers/fake-mcp-server.mjs`.

## Refresh script against real upstream (task 8.4)
Report mode only, run from the repo root against the live upstream (`modelcontextprotocol/modelcontextprotocol`). `--write` was never used. `GITHUB_TOKEN` was not set or printed. The three vendored `schema.json` files and `PROVENANCE.md` were not touched: the sha256 values of the files match the `PROVENANCE.md` table, `PROVENANCE.md` itself has the same sha256 (`3da2f32f...`) before and after, and the file mtimes are unchanged from task 8.3. `tests/mcp-schemas/` is still untracked in git, so `git diff --stat` has nothing to show for it; the sha256 comparison is the evidence.

### 1. No arguments (`--ref main`)
Command: `python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py`
```text
refresh_mcp_schemas: upstream main = d0e246ea3c69eafaa2806bc4cd28025703ba2c2b (vendored commit d0e246ea3c69eafaa2806bc4cd28025703ba2c2b)
2024-11-05  unchanged
2025-11-25  unchanged
2026-07-28  unchanged
2025-03-26  new upstream revision (not vendored)
2025-06-18  new upstream revision (not vendored)
warning: upstream has revision 2025-03-26, which is not vendored; create its empty directory and run write mode to add it
warning: upstream has revision 2025-06-18, which is not vendored; create its empty directory and run write mode to add it
result: 2 new upstream revisions (exit 0)
```
Exit code: 0.

As expected, all three vendored revisions are `unchanged` and upstream `main` has not moved past `d0e246ea3c69eafaa2806bc4cd28025703ba2c2b` (confirmed with `git ls-remote`). The two extra lines are the script's normal "new upstream revision" notice for `2025-03-26` and `2025-06-18`. They are deliberately not vendored (the server serves `2024-11-05`, `2025-11-25`, and `2026-07-28`), the result stays exit 0, and no action is needed.

### 2. `--ref 2025-11-25` (outcome differs from the plan)
Command: `python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py --ref 2025-11-25`
```text
upstream unavailable: HTTP 404 for schema 2026-07-28
```
Exit code: 3.

The plan expected `semantic change` for `2025-11-25` with exit 1. The script does not get that far. Report mode downloads every vendored revision from the one resolved commit, and the `2025-11-25` tag (`38c84e9f93ad191d9eb26d92b945d17bd0efcaf3`) predates the `2026-07-28` schema, so `schema/2026-07-28/schema.json` returns 404 at that commit. The script treats any 404 as "upstream unavailable" and exits 3 before it compares anything. No partial report is printed, which matches the "compute everything first" design. This is a limit of using an old tag with a script that checks all vendored revisions at once. It is not a network failure or rate limit.

Independent check (read-only `curl` of the raw file at the tag, saved to `/tmp` and deleted afterwards): `schema/2025-11-25/schema.json` at tag `2025-11-25` has sha256 `1ffe4c55...` and differs from the vendored copy (`268a5f82...`). The differences are the `NumberSchema` fix the plan describes: three `"type": "integer"` lines at 2110, 2116 and 2119 that are `"number"` in the vendored copy, and one at line 3351 that is `["integer", "null"]` in the vendored copy. These are type changes, so `classify_change` would report `semantic change` for `2025-11-25` if it could be reached. `schema/2026-07-28/schema.json` at that tag returns HTTP 404.

Other `--ref` forms the allow-list accepts (`main`, 40-hex SHA, `YYYY-MM-DD`, `YYYY-MM-DD-RC`):

| `--ref` | Resolved commit | Outcome | Exit |
|---------|-----------------|---------|------|
| `2026-07-28` | `5f5440bb26a62e2cf3440b92da5a667efa03b267` | `unchanged` for all three vendored revisions, plus the same two "new upstream revision" notices as `main` | 0 |
| `2026-07-28-RC` | `9d700ed62dcf86cb77475c9b81930611a9182f46` | `upstream unavailable: HTTP 404 for schema 2026-07-28` | 3 |
| `2025-11-25-RC` | `b7d269cf527c2b26e8093e914ed9025be75f9e94` | `upstream unavailable: HTTP 404 for schema 2025-11-25` | 3 |

So no allowed `--ref` makes the script print `semantic change` for `2025-11-25` against real upstream data. Only a ref old enough to carry the unfixed `2025-11-25` schema would, and every such ref lacks the `2026-07-28` schema, which makes the script exit 3. The `semantic change` / exit 1 path is exercised by the unit tests in `test_refresh_mcp_schemas.py` instead.

The `2026-07-28` tag matching the vendored files byte for byte, together with `main` being unchanged, shows the vendored `2025-11-25` file was taken from a post-fix commit and the fix reached upstream after the `2025-11-25` tag.

## Schema conformance red-green checks (task 10.2)

Done by hand from `application-infrastructure/src/lambda/read-function`, then reverted. Nothing was committed. No stray jest processes before or after any run.

**Baseline.** `timeout 300s npx jest tests/integration/mcp-protocol-schema-conformance.test.js tests/unit/helpers/mcp-schema-validator.test.js tests/unit/architecture/vendored-mcp-schemas.test.js --coverage=false`: 3 suites passed, 76 tests passed.

**V-B 3, strict overlay.**
- Backed up `utils/mcp-protocol.js` to `/tmp/mcp-protocol.js.bak` (sha256 `17d27f35...e64dc5cd`).
- Added `nextcursor: null` to the modern branch of `toolsListResult`.
- Result: exactly one conformance test failed, `result matrix › tools/list › 2026-07-28`. The failure message contains only the `(strict)` check: `2026-07-28 ListToolsResultResponse (strict) failed: /result must NOT have unevaluated properties [nextcursor]`. There is no `published` entry, so the published check still passed. The legacy and no-revision `tools/list` cases and the other 41 tests stayed green.
- Restored from the backup. `diff` was empty and the sha256 matched the backup. `nextcursor` no longer appears in the file. Re-run: 42 of 42 passed.

**V-B 4, integrity.**
- Backed up `application-infrastructure/tests/mcp-schemas/2026-07-28/schema.json` to `/tmp/schema-2026-07-28.json.bak`. The file is untracked in git, so the backup was the only way to restore it.
- Inserted one space at the end of the `description` string on line 5 (still valid JSON, checked with `json.load`).
- Result: only `Integrity › should match the recorded sha256 for every listed revision` failed. The message reads `Revision 2026-07-28: sha256 mismatch (recorded ef70b61f..., actual b223f4a7...)`. The self-check test and the other tests in the file passed.
- Restored from the backup. `cmp` and `diff` were empty. `sha256sum` is `ef70b61f99b6d2e5e3b46863822eab08dff6a45bedc7a08914e0e5b133f40203`, equal to the value recorded in `PROVENANCE.md`. Re-run of all three suites: 76 of 76 passed.

**Restoration confirmed.** Final sha256 of `utils/mcp-protocol.js` equals the backup, and `git diff --stat` for it is the same 25 insertions and 7 deletions as before the check (earlier uncommitted work from this spec, not from this task). The vendored `2026-07-28/schema.json` matches `PROVENANCE.md`.

## Phase 3 checkpoint (task 12)

Run on dev `fc2b227` plus the uncommitted work of this spec. No stray jest processes before or after any run. No `git stash` or reset was used.

### Read Function suite time

| Tree | Command | Result | Wall time (`real`) | Jest `Time` |
|------|---------|--------|--------------------|-------------|
| This tree (after the change) | `/usr/bin/time -p timeout 900s npx jest` in `RF` | 184 suites passed, 6 skipped; 2199 tests passed, 115 skipped | 24.35 s | 23.6 s |
| Baseline, `git worktree` of `3658616` (before the change) | same, after `npm ci --include=dev` | 181 suites passed, 6 skipped; 2107 tests passed, 115 skipped | 24.73 s | 24.1 s |

**Delta:** -0.4 s wall time (about -1.5%), which is within run-to-run noise. The new tree adds 3 suites and 92 tests (the conformance test, the helper tests, and the vendored-schema guards) at no measurable cost. Requirements 22.2 and 23.2 are met.

**Baseline note.** The first baseline run had 3 failing suites (`json-rpc-router.test.js`, `mcp-protocol-jsonrpc.test.js`, `mcp-protocol-release-version.test.js`, 7 tests). The cause was `config/release-version.js`, a gitignored file that the build generates and that a fresh worktree does not contain. I generated it in the worktree with `python3 application-infrastructure/build-scripts/write_release_version.py`, as `buildspec.yml` does, and re-ran. The table above is the second run. The first run took 25.93 s, so it does not change the comparison. The worktree was removed with `git worktree remove --force /tmp/rf-baseline` and `git worktree list` shows only the main tree.

### Production dependencies unchanged

`git diff --stat` over every `package.json` and `package-lock.json` under `application-infrastructure/src/lambda/`:

| Package | Changed |
|---------|---------|
| `auth-function` | no |
| `cleanup-function` | no |
| `doc-indexer` | no |
| `s3-vectors-provisioner` | no |
| `layers/doc-ai-common` | no |
| `layers/search-common` | no |
| `read-function` | yes: `package.json` (+2 lines) and `package-lock.json` |

- The `read-function` `package.json` diff adds only `ajv` (`^8.20.0`) and `ajv-formats` (`^3.0.1`), both in `devDependencies`. `dependencies{}` is untouched, and neither name is in `dependencies`.
- Lockfile comparison against `HEAD`: the root `dependencies` objects are equal, and the set of non-dev packages (23 entries) is identical in name and version. `npm ls --omit=dev` in `RF` is unchanged in content.
- `application-infrastructure/tests/postdeploy-verify` also changed `package.json` and its lockfile (task 7.1, exact-pinned dev dependencies). It is a test package, not a Lambda package.

### Other suites

| Suite | Command | Result |
|-------|---------|--------|
| `PV` | `timeout 600s npm test` | 13 suites, 825 tests passed (1.9 s), including `fake-mcp-server-schema-conformance.jest.mjs` |
| `BS` | `timeout 120s python3 -m unittest test_write_release_version test_refresh_mcp_schemas` | 57 tests, OK |

All Phase 3 checks pass. No questions for the owner.

## Release-transition hook check (task 13.4)

- The owner ran this check on the `dev` branch. They dated the top `CHANGELOG.md` header, then started a fresh Kiro session. The `Detect release-date edit` hook fired and the prepare-release message appeared.
- Header restored exactly from the backup: `sha256sum CHANGELOG.md` is `314fd4e22e1cc464881c04e24d32b792ed667630e3d2411c24575ea244237ef3`, the first version header reads `## [v0.0.7] (unreleased)`, and `git status --short CHANGELOG.md` and `git diff CHANGELOG.md` are both empty.
- After the restore, `python3 application-infrastructure/build-scripts/detect_release_transition.py` printed nothing and exited 0.
- The hook is active from the next session start, because hooks are read at session start.

## Final sweep before rollout (task 21.1)

Run on dev with the uncommitted work of this spec. One command at a time; no jest processes before or after any run. Nothing was committed.

### Suites

| Suite | Command | Result |
|-------|---------|--------|
| Read Function | `timeout 900s npx jest` in `RF` | 184 suites passed, 6 skipped (need AWS or GitHub access); 2199 tests passed, 115 skipped; 23.1 s (24.0 s wall). Same counts as the Phase 3 checkpoint. |
| Verifier package | `timeout 600s npm test` in `application-infrastructure/tests/postdeploy-verify` | 13 suites, 825 tests passed |
| Python | `python3 -m unittest test_write_release_version test_refresh_mcp_schemas test_detect_release_transition` in `build-scripts` | 127 tests, OK |
| Kiro skills | `timeout 300s npm test` in `application-infrastructure/tests/kiro-skills` | 1 suite, 5 tests passed |

### Lint

`npm run lint` in `RF` still fails with 6540 problems (6538 errors, 2 warnings). This equals the count recorded in "Phase 1 green run" (the 2 `indent` errors from task 1.2), so nothing has grown since. The new files this spec added to `RF` have no lint output: `npx eslint tests/helpers tests/unit/helpers tests/unit/architecture/vendored-mcp-schemas.test.js tests/integration/mcp-protocol-schema-conformance.test.js` exits 0.

### Leftover search

`declaredRevision` hits outside this spec's own documents (`.kiro/specs/0-0-7-schema-validation-of-modern-results/`), all expected:

- `resolveEra()` return field and its callers: `utils/mcp-era.js`, `utils/json-rpc-router.js` (reads it, and sends it as `requested`), the fake server's copy of `resolveEra`, `tests/unit/utils/mcp-era.test.js`, and `ARCHITECTURE.md` L414 and L418.
- `initializeResult(id, { declaredRevision })` option name in `utils/mcp-protocol.js` and its tests (`mcp-protocol-jsonrpc.test.js`, `mcp-schema-validator.test.js` L78). This is the requested revision for the legacy handshake, not `-32022` data.
- Negative assertions that the old keys are absent: `mcp-protocol-unsupported-version.test.js`, `mcp-schema-validator.test.js` L240-244, `fake-mcp-server-tests.jest.mjs` L338-339, and the `checks-tests.jest.mjs` failure row (L612-615) that deliberately sends the old key.
- Dual-era spec: `tasks.md` and `requirements.md` (not editable), `tasks-complete.md`, `tasks.meta.json`, and `design.md` L207-283 (the `negotiateProtocol()` and `resolveEra()` return shapes, which match the code), plus the dated "Corrected 2026-11-01" notes in `design.md` and `TODO-MANUAL-VERIFY.md`.
- Smoke spec: `tasks.md` (not editable) and the dated "Updated 2026-11-02" notes in `design.md` and `requirements.md`.
- `CHANGELOG.md` L71, the new Fixed entry that describes the old behavior.

`verify-deployment.js` has no `declaredRevision` hit, as task 4.2 requires.

`supportedVersions` is used as `-32022` data nowhere in code, tests, or current docs. Remaining hits are the `server/discover` result field (`mcp-protocol.js`, `verify-deployment.js`, the fake server, the verifier report field, `ARCHITECTURE.md`, `docs/end-user/supported-protocol-revisions.md`, the verification pages), the internal `negotiateProtocol()` return field (`decision.supportedVersions` is the value the router sends as `supported`), negative assertions, history notes, and the specs' own text.

Hits that were not on the expected list:

| Hit | Disposition |
|-----|-------------|
| `.kiro/specs/0-0-7-mcp-protocol-dual-era/design.md` L885: the draft `CHANGELOG.md` entry in "Changes to version-tracked artifacts" still said `-32022` has "`supportedVersions` enumerated in the error data" | Fixed. It now says `requested` and `supported` in the error data, HTTP 400, corrected by this spec. The released `CHANGELOG.md` already had the right wording. |
| `.kiro/specs/0-0-7-postdeploy-smoke-verification/PLAN.md` L82: the P3 row reads "with `declaredRevision` and `supportedVersions`" | Not edited. It is the Smoke spec's original planning record, outside the files Requirement 20 lists, and the Smoke `requirements.md` and `design.md` carry the dated update. The owner can add a one-line note if wanted. |
| Dual-era `PLAN.md` L125 and `requirements.md` L104, L128, L244 ("error data enumerates `supportedVersions`") | Not edited. `requirements.md` is off limits; `PLAN.md` is the dual-era planning record. Both are covered by the dated notes in the dual-era `design.md`. |

### Working tree

- **Files that must not change:** `git status` shows no change to `template.yml`, `template-openapi-spec.yml`, `buildspec.yml`, `buildspec-postdeploy.yml`, or `.github/dependabot.yml`. `ISSUE.md`, the Smoke `tasks.md`, and the Dual-era `tasks.md` and `requirements.md` are also unmodified.
- **`package.json` and lockfiles:** only four are modified, `RF` and `application-infrastructure/tests/postdeploy-verify` (`package.json` and `package-lock.json` each). `git diff` on both `package.json` files adds only `ajv` and `ajv-formats` to `devDependencies` (`^8.20.0` and `^3.0.1` in `RF`; exact `8.20.0` and `3.0.1` in the verifier package). No Lambda function or layer package changed, and the `RF` lockfile still has 23 non-dev packages.
- **Skills precondition (task 14.1):** `.kiro/skills` shows only `README.md` modified and the two new skills.

### Untracked files (21) by task

| File | Task |
|------|------|
| `RF/tests/integration/mcp-protocol-schema-conformance.test.js` | 10.1 |
| `RF/tests/helpers/mcp-schema-validator.js` | 9.2 |
| `RF/tests/unit/helpers/mcp-schema-validator.test.js` | 9.1 |
| `RF/tests/unit/architecture/vendored-mcp-schemas.test.js` | 9.3 |
| `application-infrastructure/tests/mcp-schemas/{2024-11-05,2025-11-25,2026-07-28}/schema.json` (3) | 8.3 |
| `application-infrastructure/tests/mcp-schemas/PROVENANCE.md` | 8.3 (written by the refresh script) |
| `application-infrastructure/tests/postdeploy-verify/helpers/mcp-schema-validator.mjs` | 11.1 |
| `application-infrastructure/tests/postdeploy-verify/fake-mcp-server-schema-conformance.jest.mjs` | 11.1 |
| `application-infrastructure/build-scripts/refresh_mcp_schemas.py` | 8.2 |
| `application-infrastructure/build-scripts/test_refresh_mcp_schemas.py` | 8.1 |
| `application-infrastructure/build-scripts/detect_release_transition.py` | 13.2 |
| `application-infrastructure/build-scripts/test_detect_release_transition.py` | 13.1 |
| `.kiro/hooks/detect-release-transition.json` (new directory `.kiro/hooks/`) | 13.3 |
| `.kiro/skills/update-mcp-schemas/SKILL.md` | 14.2 |
| `.kiro/skills/prepare-release/SKILL.md` | 14.3 |
| `.github/workflows/release-gate.yml` | 15.1, 15.2 |
| `docs/developer/release-process.md` | 17.1 |
| `.kiro/specs/0-0-7-schema-validation-of-modern-results/VERIFICATION.md` | this record (tasks 1.4, 2.4, 4.3, 5.3, 8.4, 10.2, 12, 13.4, 21.1) |
| `.kiro/specs/0-0-7-schema-validation-of-modern-results/tasks.meta.json` | Kiro task-tracking metadata for `tasks.md`; not a plan deliverable. The owner can commit or drop it. |

`config/release-version.js` is gitignored and does not appear. The 40 modified tracked files map to tasks 1 to 7 (server, verifier, fake server, tests, dev dependencies), 14.4 (`.kiro/skills/README.md`), 17.2 (`DEPLOYMENT.md`, `CONTRIBUTING.md`, `docs/developer/README.md`), 18 (`ARCHITECTURE.md`, the three docs pages, `mcp-protocol-sources.md`), 19 (Smoke and Dual-era specs), 20 (`CHANGELOG.md`), and the task checkboxes in this spec's `tasks.md`.

All checks pass. The commit is left to the owner.

## Release gate check (task 24.1)

- Date: 2026-11-02 (run time per GitHub log, UTC)
- Repo: `63Klabs/atlantis-mcp`, default branch `main`, commit used: `0cc8eedbd0d582fed3ff0d5fbce4d17d302328d1`. `release-gate.yml` was present on `main`.
- Edit (throwaway branch `release-gate-check`, one line removed): in `application-infrastructure/tests/mcp-schemas/2026-07-28/schema.json`, definition `BlobResourceContents`, `required` array: removed `"blob"` (left `["uri"]`). Diff: 1 deletion. Commit `a3c1146` "test: gate check, do not merge".
- Local sanity check (run from the worktree, report mode against upstream main): exit code 1. Output: `2024-11-05  unchanged`, `2025-11-25  unchanged`, `2026-07-28  semantic change`, plus `new upstream revision (not vendored)` for 2025-03-26 and 2025-06-18; `result: semantic change in 1 vendored revision (exit 1)`.
- Pre-release `v0.0.0-gatecheck` created with `--target release-gate-check`.
- Run: id 41538883283, https://github.com/63Klabs/atlantis-mcp/actions/runs/41538883283 (event `release`, run conclusion `failure`, as expected).
  - Job `schema-drift`: failure. Steps: checkout success, Python setup success, "Unit tests for the release scripts" success, "Compare vendored schemas with upstream main" failure (exit 1).
  - Job `withdraw-release`: success; step "Return the release to draft" success.
- Drift output: `drift=true` (inferred: the refresh step exited 1, which the step maps to `drift=true`, and `withdraw-release` ran and succeeded). The step log showed the same per-revision output as the local run, ending `result: semantic change in 1 vendored revision (exit 1)`.
- Release final state: `isDraft=true`, `isPrerelease=true`, `tagName=v0.0.0-gatecheck`.
- Step summary text: not retrieved separately. The refresh step writes it to `$GITHUB_STEP_SUMMARY`, and the log carried the same revision lines (`2026-07-28  semantic change`).
- Cleanup: release and tag deleted (`--cleanup-tag`), remote branch deleted, worktree removed, local branch deleted. `git ls-remote github` shows no `release-gate-check` or `gatecheck` ref, `gh release list` shows no gate release, `git worktree list` shows only the main tree. Main working tree `git status` was unchanged (only the pre-existing `tasks.md` and `tasks.meta.json` modifications).
- Outcome: passed. Drift fails the job and the release is returned to draft.

## Rollout results (tasks 22, 23)

These results were reported by the owner, who performed the deploys. No log excerpts were available to the recorder.

- `test` stage: PostDeploy passed. P3, P4, and P5 were green. X2 was skipped (no custom domain on `test`).
- Kiro connected to `test`: tools load.
- `beta` stage: X2.1, X2.2, X2.3, and X2.4 all PASS.
  - X2.1: the edge preflight allows the origin, the MCP headers, and POST.
  - X2.2: edge `server/discover` reports the expected version.
  - X2.3: the edge returns `-32020` for a mismatched `Mcp-Method`.
  - X2.4: the edge returns `-32020` for a mismatched `Mcp-Name`.
  - This shows a 400 passes through `beta`'s CloudFront unchanged.
