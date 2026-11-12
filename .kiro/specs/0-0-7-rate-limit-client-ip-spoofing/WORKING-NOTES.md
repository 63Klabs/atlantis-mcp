# Working notes

## Task 1.1 baselines

Recorded on the unchanged tree (Node v24.15.0, npm 12.2.0). `node_modules` was already present in both packages, so no `npm ci` was run. Jest was called directly (`CI=true timeout 900s npx jest --silent`). No stray jest processes before or after. Requirements 10.8, 14.1.

### Jest

| Package | Suites | Tests |
| --- | --- | --- |
| RF (`read-function`) | 188 passed, 6 skipped, 0 failed (194 total) | 2269 passed, 115 skipped, 0 failed (2384 total); 1 snapshot passed |
| AF (`auth-function`) | 43 passed, 0 skipped, 0 failed (43 total) | 511 passed, 0 skipped, 0 failed (511 total) |

- The seed-dependent `RF/tests/unit/utils/naming-validation-property.test.js` (S3 pattern 3, resource name `an`) did not fail in this run (PASS). If it fails later with that counterexample, it is unrelated to this change.

### Lint (`npm run lint`, exit 1 in both packages)

| Package | Problems | Errors | Warnings | Top rules |
| --- | --- | --- | --- | --- |
| RF | 7318 | 7316 | 2 | indent 6640, no-trailing-spaces 399, no-unused-vars 94, brace-style 60, curly 52 |
| AF | 8697 | 8697 | 0 | indent 8594, brace-style 66, no-unused-vars 21, prefer-const 5, eqeqeq 5 |

Later tasks compare against these numbers (lint: equal or lower; Jest: these counts plus the new tests, no new failures or skips).

## Task 1.2 baseline offline SAM translation

Recorded on the unchanged `application-infrastructure/template.yml` (git shows no change to it), with `template-openapi-spec.yml` inlined as the `WebApi` body. Requirements 5.4, 14.2. No AWS call was made.

| Measure | Expected (design, 2026-11-09) | Actual |
| --- | --- | --- |
| Resources after translation | 59 | 59 |
| `AWS::Lambda::Permission` resources | 8 | 8 |

The numbers match. A second run produced identical output.

The 8 permissions: `AuthLambdaFunctionCognitoPermission`, `AuthLambdaFunctionGetProfilePermissionStage`, `AuthLambdaFunctionKeyRegeneratePermissionStage`, `AuthLambdaFunctionVoucherRedeemPermissionStage`, `AuthLambdaPermission`, `DocIndexerSchedulePermission`, `ReadLambdaFunctionMcpV1PostPermissionStage` (the Read function alias permission), `ReadLambdaPermission`.

`WebApi` has no endpoint configuration in the baseline. Task 6.3 expects it on the changed template.

### Tooling

- Tool: `aws-sam-translator` 1.116.0 with PyYAML 6.0.3, in a throwaway virtualenv: `/tmp/samtx-venv` (kept until task 6.3, then delete it).
- Script: `/tmp/sam-offline-translate.py` (keep for task 6.3). It parses the template with the translator's YAML parser, inlines `template-openapi-spec.yml` as `WebApi.DefinitionBody`, merges `template-dashboard.yml` into `Resources` (the second `AWS::Include`, which adds `Dashboard`), replaces every `CodeUri` and `ContentUri` (8 of them: 3 layers, 5 functions) with `s3://stub-bucket/stub.zip`, and translates with a local stub in place of the IAM managed-policy loader. It has no other local-path properties to stub.
- Options: `--template PATH` (default: the repository `template.yml`), `--out-dir DIR` (default `/tmp`), `--label NAME` (default `samtx-baseline`). Task 6.3 uses a different `--label` so the baseline files stay intact.

### Command

```bash
/tmp/samtx-venv/bin/python /tmp/sam-offline-translate.py --label samtx-baseline
```

Expected output: `resources=59 lambda_permissions=8`.

For task 6.3, on the changed template:

```bash
/tmp/samtx-venv/bin/python /tmp/sam-offline-translate.py --label samtx-changed
diff /tmp/samtx-baseline-resources.txt /tmp/samtx-changed-resources.txt
diff /tmp/samtx-baseline-permissions.json /tmp/samtx-changed-permissions.json
diff /tmp/samtx-baseline-translated.json /tmp/samtx-changed-translated.json
```

The first line of each `-resources.txt` is the template path, so that line differs only if a different file is used.

### Baseline files (keep)

| File | Content |
| --- | --- |
| `/tmp/samtx-baseline-resources.txt` | Counts, logical id and type of all 59 resources, the 8 permission ids, and the preparation log |
| `/tmp/samtx-baseline-permissions.json` | The 8 `AWS::Lambda::Permission` resources with full properties |
| `/tmp/samtx-baseline-translated.json` | The whole translated template (for per-resource property comparison) |
| `/tmp/samtx-baseline.md5` | MD5 sums of the three files above |

## Task 1.3 dependency baseline
Recorded on the unchanged tree (Node v24.15.0, npm 12.2.0). Requirements 4.2, 4.3. Nothing was run in the repository; only `package.json` and `package-lock.json` were copied (neither function directory has an `.npmrc`). The `npm install` check belongs to task 7.2.
### Environment check (nothing masks the default)
- `npm config get allow-git` printed `none` (the npm 12 default); `npm config ls -l` shows `allow-git = "none"`.
- `env | grep -i npm_config` printed nothing (no `NPM_CONFIG_ALLOW_GIT` or other `NPM_CONFIG_*`).
- `~/.npmrc` exists and holds only a registry `_authToken` line (value not recorded here). It sets no `allow-git`.
### Scratch directories (each a fresh copy of the two files)
| Package | (a) default | (b) `--allow-git=root` |
| --- | --- | --- |
| RF (`read-function`) | `/tmp/dep-baseline-rf` | `/tmp/dep-baseline-rf-git` |
| AF (`auth-function`) | `/tmp/dep-baseline-af` | `/tmp/dep-baseline-af-git` |
### (a) `timeout 300s npm ci --omit=dev` — fails as expected
| Package | Exit | Key lines |
| --- | --- | --- |
| RF | 1 | `npm error code EALLOWGIT` / `Fetching packages of type "git" have been disabled` / `Refusing to fetch "@63klabs/cache-data@git+https://github.com/63Klabs/cache-data.git#f746cdeea10e9e14e7782cd70f00db81ff9a55cb"` |
| AF | 1 | same three lines |
### (b) `timeout 300s npm ci --omit=dev --allow-git=root` — succeeds
| Package | Exit | Key lines |
| --- | --- | --- |
| RF | 0 | `added 20 packages, and audited 21 packages in 1s`; `found 0 vulnerabilities` |
| AF | 0 | `added 18 packages, and audited 19 packages in 1s`; `found 0 vulnerabilities` |
Lockfile entry after the install, identical in both packages (`npm ci` did not rewrite either lockfile; `cmp` against the repository copies reports identical):
```
"node_modules/@63klabs/cache-data": {
  "version": "1.4.1",
  "resolved": "git+https://github.com/63Klabs/cache-data.git#f746cdeea10e9e14e7782cd70f00db81ff9a55cb",
```
`node_modules/@63klabs/cache-data` was installed in both. Observed behavior matches the expectation; no deviation. The `package.json` in both packages still has `git+https://github.com/63Klabs/cache-data.git#main` (line 21), which task 7.1 changes to the pinned commit.
### Cleanup
The four `/tmp/dep-baseline-*` directories are kept for reference; delete them after task 7.2. No stray npm or jest processes. `git status` shows no change under `application-infrastructure`.

## Task 2.5 red-phase results

Run on the unchanged application code, from `RF` (`application-infrastructure/src/lambda/read-function`): `CI=true timeout 300s npx jest <the seven files> --coverage=false`. Result: 7 suites failed, 10 tests failed, 83 passed (93 total), 1.7 s. No stray jest processes before or after. Requirements 10.1, 10.4. Every failure has the expected reason; no test needed a fix.

| File | Result | Reason |
| --- | --- | --- |
| `tests/unit/utils/client-address.test.js` | suite fails to run (0 tests) | `Cannot find module '../../../utils/client-address'` |
| `tests/property/client-address.property.test.js` | suite fails to run (0 tests) | `Cannot find module '../../utils/client-address'` |
| `tests/property/client-identity-spoofing.property.test.js` | suite fails to run (0 tests) | `Cannot find module '../../utils/client-address'` (assertion-level reason below) |
| `tests/unit/architecture/endpoint-and-client-address.test.js` | 3 failed (E1, E2, E3) | E1: `WebApi` has no `EndpointConfiguration.Type`. E2 and E3: `CACHE_DATA_TRUSTED_PROXY_HOPS` is not set in `ReadLambdaFunction` or `AuthLambdaFunction` |
| `tests/unit/architecture/no-forwarding-header-parsing.test.js` | 1 failed (S2) | Violations name `utils/auth-resolver.js` lines 140 (`x-forwarded-for`) and 141 (`identity.sourceIp`), and `utils/rate-limiter.js` lines 396 and 397 (same two) |
| `tests/unit/utils/rate-limiter.test.js` | 2 failed (the two new `authInfo.identity of null` cases), all pre-existing cases pass | Identity `null` gives `allowed: true`, and a counter is written (`put` called once with a hashed key) |
| `tests/unit/utils/auth-resolver.test.js` | 4 failed (the four new `resolveAuth() without a client address` cases), all pre-existing cases pass | `result.identity` is `"203.0.113.9"`, not `null`, on the no-key path and on the salt-unavailable, salt-empty, and Users-table-read-failure paths |

### Assertion-level reason for 2.2

Because the suite stops at the import, a scratch copy was made (`tests/property/zz-scratch-spoofing.property.test.js`) with only the `client-address` import replaced by an inline stub `toBucketKey`. It was run once and then deleted (`git status` shows no scratch file). All three properties failed, with real `ClientRequest` and `CACHE_DATA_TRUSTED_PROXY_HOPS=0`:

- Property 1: counterexample `["0.0.0.0", {"X-Forwarded-For": "1:0:0:0:0:0:0:0"}]`; expected `"0.0.0.0"`, received `"1:0:0:0:0:0:0:0"`. The identity is the first forwarded entry.
- Property 3: counterexample `["0.0.0.0", {}, {"X-Forwarded-For": "!"}]`; expected `"!"`, received `"0.0.0.0"`. The same source address gives two identities when the header differs.
- Property 2: counterexample `[["1:0:0:0:0:0:0:0", "1:0:0:1:0:0:0:0"], {}, {}]`; expected the stub key `"1:0:0:0"`, received the raw address `"1:0:0:0:0:0:0:0"`. The unchanged `resolveAuth` returns the raw address and ignores its second argument and any bucket key.

## Task 5.5 Read suite result

Run from `RF`: `NODE_ENV=test timeout 900s npx jest --silent` (direct, not npm test). No stray jest processes before or after. Log: `/tmp/rf-jest-5-5.log`. cache-data pinned at 386c2f9. Requirement 10.8.

| Measure | Baseline (1.1) | Now |
| --- | --- | --- |
| Suites | 188 passed, 6 skipped, 0 failed (194) | 190 passed, 6 skipped, 1 failed (197) |
| Tests | 2269 passed, 115 skipped, 0 failed (2384) | 2301 passed, 115 skipped, 3 failed (2419) |

- Skipped counts are unchanged (6 suites, 115 tests). Passed grew by 3 suites and 32 tests (the new client-address tests).
- The only failures are the three expected architecture tests in `tests/unit/architecture/endpoint-and-client-address.test.js` that need the template change (task 6.1): E1 (`WebApi` has no `EndpointConfiguration.Type` REGIONAL), E2 (`ReadLambdaFunction` does not set `CACHE_DATA_TRUSTED_PROXY_HOPS` to 0), E3 (`AuthLambdaFunction` same).
- No other regression. `naming-validation-property.test.js` passed (the seed-dependent case did not appear).
## Task 6.3 translation result
Requirements 5.4, 14.2. No AWS call was made. The virtualenv, script, and baseline files from task 1.2 were no longer in `/tmp`, so they were recreated per Design V-C (`aws-sam-translator` 1.116.0, PyYAML 6.0.3, throwaway virtualenv; same inlining of `template-openapi-spec.yml` and `template-dashboard.yml`, same stubbing of the 8 `CodeUri`/`ContentUri` values, same local stub for the managed-policy loader). The baseline was translated from `git show HEAD:application-infrastructure/template.yml` (the unchanged committed file); the changed run used the working-tree `template.yml`, which was only read. Both runs printed `resources=59 lambda_permissions=8`, matching the task 1.2 numbers.
### Diff of changed against baseline (all three outputs: resource list, permissions, whole translated template)
| Measure | Result |
| --- | --- |
| Resources before and after | 59 and 59 |
| Added, removed, or type-changed resources | none |
| Resources whose properties differ | 3: `WebApi`, `ReadLambdaFunction`, `AuthLambdaFunction` |
| `AWS::Lambda::Permission` (8) | identical (permissions diff empty) |
| Other top-level sections (Parameters, Conditions, Mappings, Outputs, Metadata, Description) | identical |
| OpenAPI body of the REST API | identical |
The complete textual difference of the translated template is these four additions and nothing else:
- `WebApi` (translated `AWS::ApiGateway::RestApi`): `EndpointConfiguration: { Types: [REGIONAL] }` and `Parameters: { endpointConfigurationTypes: REGIONAL }`. The baseline has neither.
- `ReadLambdaFunction` environment: `CACHE_DATA_TRUSTED_PROXY_HOPS: "0"`.
- `AuthLambdaFunction` environment: `CACHE_DATA_TRUSTED_PROXY_HOPS: "0"`.
This matches the expectation of the task (measured 2026-11-09) exactly; no deviation. The virtualenv, the script, and all `/tmp/samtx-*` and `/tmp/sam-offline-translate.py` artifacts were deleted afterwards.
## Task 7.2 scratch installs
Requirement 4.3. Run on 2026-11-11 with node v24.15.0 and npm 12.2.0, in copies under `/tmp` (`package.json`, `package-lock.json`, `.npmrc` only; no `node_modules`). `--allow-git` was not passed. `npm config get allow-git` was `none` (no user or environment override; `~/.npmrc` holds only a registry token line). The real directories were only read. All `/tmp/t72-*` copies were deleted afterwards.
| Directory | `npm ci --omit=dev` | Lockfile `resolved` after `ci` | `npm install --omit=dev` | Lockfile before/after `install` | `npm audit --omit=dev --audit-level=high` |
| --- | --- | --- | --- | --- | --- |
| read-function | exit 0, `added 20 packages`, 0 vulnerabilities | `git+https://github.com/63Klabs/cache-data.git#386c2f97bac518c59785251c973f7034bb4510b2` | exit 0, `up to date, audited 21 packages` | `diff` identical | exit 0, `found 0 vulnerabilities` |
| auth-function | exit 0, `added 18 packages`, 0 vulnerabilities | same pinned hash `386c2f97...` | exit 0, `up to date, audited 19 packages` | `diff` identical | exit 0, `found 0 vulnerabilities` |
- `@63klabs/cache-data` was installed in `node_modules` in both copies. The audit output does not name `@63klabs/cache-data`; the git-sourced package causes no audit trouble. `npm audit fix --force` was not run.
- Control (read-function copy with the `.npmrc` left out): `npm ci --omit=dev` exit 1, `npm error code EALLOWGIT`, `Fetching packages of type "git" have been disabled`, `Refusing to fetch "@63klabs/cache-data@git+https://github.com/63Klabs/cache-data.git#386c2f97bac518c59785251c973f7034bb4510b2"`. So the `.npmrc` alone is what allows the install.
- Note: the pinned commit is `386c2f97bac518c59785251c973f7034bb4510b2` (as in both `package.json` files), not the `f746cdee...` hash that task 7.1 and design.md Components 8 use as their example.

## Task 7.3 results

Run directly, one after the other: `NODE_ENV=test timeout 900s npx jest --silent` in `RF`, then in `AF`. No stray jest processes before or after either run. Logs: `/tmp/rf-jest-7-3.log`, `/tmp/af-jest-7-3.log`. Both exit 0. Requirements 4.7, 10.8.

| Package | Suites | Tests |
| --- | --- | --- |
| RF (`read-function`) | 191 passed, 6 skipped, 0 failed (197 total) | 2304 passed, 115 skipped, 0 failed (2419 total); 1 snapshot passed |
| AF (`auth-function`) | 43 passed, 0 skipped, 0 failed (43 total) | 511 passed, 0 skipped, 0 failed (511 total) |

- RF: skipped counts match the 1.1 baseline (6 suites, 115 tests). Passed grew from the 1.1 baseline (188 suites, 2269 tests) by 3 suites and 35 tests (the new tests). The 3 architecture tests that failed in 5.5 (E1, E2, E3) now pass because of the template change (6.1).
- AF: identical to the 1.1 baseline (511 passed, 43 suites).
- No failures. The seed-dependent `naming-validation-property.test.js` did not fail, so no rerun was needed.

## Task 9.1 results

Run on 2026-11-11 (node v24.15.0, npm 12.2.0). Jest was called directly, never `npm test`. No stray jest processes before or after. Logs: `/tmp/{rf,af,static,pdv}-jest-9-1.log`, `/tmp/{rf,af}-lint-9-1.log`. Requirements 10.8, 14.1.

### Jest

| Package | Suites | Tests |
| --- | --- | --- |
| RF (`read-function`), `NODE_ENV=test npx jest --silent` | 191 passed, 6 skipped, 0 failed (197) | 2304 passed, 115 skipped, 0 failed (2419); 1 snapshot passed |
| AF (`auth-function`), same | 43 passed, 0 skipped, 0 failed (43) | 511 passed, 0 skipped, 0 failed (511) |
| `src/static` | 13 passed, 0 failed (13) | 268 passed, 0 failed (268) |
| `tests/postdeploy-verify` (node_modules present) | 14 passed, 0 failed (14) | 869 passed, 0 failed (869) |

- RF and AF match the 7.3 results exactly; skipped counts equal the 1.1 baseline (6 suites, 115 tests). The static site is unaffected.
- The static and postdeploy-verify packages are ESM and need `node --experimental-vm-modules ./node_modules/jest/bin/jest.js` (their `npm test` script). A plain `npx jest` fails every suite with 0 tests; that is a command mistake, not a regression.
- The RF lint fixes below were made after the full RF run. Only the three touched test/source files could be affected; they were re-run (4 suites, 36 tests, all passed, including `client-address.test.js`, the property tests, and the E1-E3 architecture test).

### Lint (`npm run lint`, exit 1 in both, as on the baseline)

| Package | Baseline (1.1) | First run today | After fixes |
| --- | --- | --- | --- |
| RF | 7318 problems (7316 errors, 2 warnings) | 7501 (7499 errors, 2 warnings) | 7487 (7485 errors, 2 warnings) |
| AF | 8697 (8697 errors) | 8697 (8697 errors) | 8697 (unchanged, no AF source file touched) |

RF rule counts, baseline to after fixes: `indent` 6640 to 6814 (+174), `no-trailing-spaces` 399 to 399, `no-unused-vars` 94 to 90, `brace-style` 60 to 60, `curly` 52 to 51. All other rules are at or below baseline.

Per-file comparison (each file against `git show HEAD:<file> | npx eslint --stdin`):
- Unchanged error counts: `index.js`, `utils/auth-resolver.js`, `utils/rate-limiter.js`, `tests/unit/utils/rate-limiter*.test.js`, and the other changed tests.
- Fewer: `tests/unit/lambda/read-handler.test.js` (one `no-unused-vars` removed); two deleted `rate-limiter-ip-resolution-*.property.test.js` files (3 `no-unused-vars`, 1 `curly`).
- New errors in `indent` only (tab-indented test code, like the repo's existing tests; the rule wants 2 spaces): `tests/property/client-identity-spoofing.property.test.js` (+112, new file) and `tests/unit/utils/auth-resolver.test.js` (+62, 734 to 796). Left as is (no mass reformat), consistent with the +6640 baseline noise.
- New non-indent errors in new files (14), fixed with `npx eslint --fix` limited to those three files: `utils/client-address.js` (8 `curly`), `tests/property/client-address.property.test.js` (2 `curly`, 2 `brace-style`), `tests/unit/architecture/endpoint-and-client-address.test.js` (2 `quotes`). The fixes only add braces, move a statement, and change quote style.

Result: not strictly "equal or lower" for RF, because of 174 new `indent` errors in two test files that follow the repo's tab style. Every non-indent rule is at or below baseline; AF is equal. Needs the maintainer's call if a strict total is required (reindent the two test files, about 174 lines).

### Unexpected

Nothing failed. `naming-validation-property.test.js` passed.

## Handover (tasks 1 to 9)

Prepared for the owner. Nothing was committed, staged, or pushed. Requirement 15.8.

### Status

Part A, Phase 1 (tasks 1 to 9) is complete in the working tree. The tree is uncommitted. Tasks 10 to 13 (rollout and release) and task 14 (Part B) are not started.

### Results, with counts

| Measure | Baseline (1.1) | Now (7.3, 9.1) |
| --- | --- | --- |
| Read suite, suites | 188 passed, 6 skipped, 0 failed (194) | 191 passed, 6 skipped, 0 failed (197) |
| Read suite, tests | 2269 passed, 115 skipped, 0 failed (2384) | 2304 passed, 115 skipped, 0 failed (2419) |
| Auth suite | 43 suites, 511 tests, 0 failed | 43 suites, 511 tests, 0 failed (unchanged) |
| Static site (`src/static`) | not recorded | 13 suites, 268 tests, 0 failed |
| `tests/postdeploy-verify` | not recorded | 14 suites, 869 tests, 0 failed (package unchanged) |
| Offline SAM translation (1.2, 6.3) | 59 resources, 8 Lambda permissions | 59 resources, 8 Lambda permissions, identical permissions |

- The Read suite gained 3 suites and 35 tests (the new tests of tasks 2 and 5); skipped counts equal the baseline. The seed-dependent `naming-validation-property.test.js` did not fail in any run.
- 5.5 (before the template change) showed exactly three failures, E1 to E3 in `endpoint-and-client-address.test.js`. They passed after task 6.1.
- Offline translation (6.3): no resource added, removed, or replaced. Only `WebApi` (gains `EndpointConfiguration: { Types: [REGIONAL] }` and `Parameters: { endpointConfigurationTypes: REGIONAL }`) and the environments of `ReadLambdaFunction` and `AuthLambdaFunction` (gain `CACHE_DATA_TRUSTED_PROXY_HOPS: "0"`) differ. The OpenAPI body is identical.
- Scratch installs (7.2): `npm ci --omit=dev` and `npm install --omit=dev` pass in both function directories with only the `.npmrc` (no `--allow-git`), the lockfile does not change, and `npm audit --omit=dev --audit-level=high` finds 0 vulnerabilities. The control without the `.npmrc` fails with `EALLOWGIT`.

### Lint (task 9.1)

| Package | Baseline | Now |
| --- | --- | --- |
| Read function | 7318 problems | 7487 problems (+169) |
| Auth function | 8697 problems | 8697 problems (unchanged) |

The Read function's net +169 is `indent` +174 offset by 5 fewer problems in other rules. All of the added `indent` errors come from tab-indented tests: `tests/property/client-identity-spoofing.property.test.js` (+112) and `tests/unit/utils/auth-resolver.test.js` (+62). The repository's tests are tab-indented and the lint rule wants 2 spaces. Every non-indent rule is at or below the baseline.

**Owner decision:** leave as is (the 0-0-8 `lint-indent-and-code-style` item in `TODO.md` covers the repository-wide style), or re-indent those two files (about 174 lines).

### cache-data pin and the spec text

Both `package.json` files and both lockfiles pin `386c2f97bac518c59785251c973f7034bb4510b2`, which is newer than the `f746cde…` commit named in the spec.

Occurrences of `f746cde` in the spec folder, and what was done in this task:

| File and line | Context | Action |
| --- | --- | --- |
| `design.md:254` | Example `package.json` dependency line (Components 8) | **Changed** to the full hash `386c2f97bac518c59785251c973f7034bb4510b2` |
| `design.md:255` | "`#main` is replaced by the commit hash that the lockfile already records" | **Kept**. It describes the old lockfile baseline. It is no longer literally true, because the pinned commit is newer than the one the lockfile recorded |
| `design.md:558` | "Hash pinning" open point | **Changed**. Now states that the pinned commit is `386c2f97…` and is newer than the `f746cde…` that the lockfile first recorded |
| `CROSS-RESOURCE-PLAN.md:6` | "Reviewed against … cache-data `main` at `f746cde`" | **Kept**. Review baseline (2026-11-07 and 2026-11-09) |
| `CROSS-RESOURCE-PLAN.md:110` | "Local runs against `ClientIpResolver` on `f746cde`" | **Kept**. Measurement |
| `CROSS-RESOURCE-PLAN.md:112` | "installed … (locked at `f746cde`): Read 2268 passed …", run on 2026-11-07 | **Kept**. Measurement of the old lockfile. `CROSS-RESOURCE-PLAN.md` has no other mention of the pinned hash (lines 166, 174, 199 say "a commit" without a hash), so it was **not edited** |
| `PLAN.md:6` | "Reviewed against … `main` at `f746cde`" | **Kept**, not in scope (review baseline) |
| `tasks.md:37` and `tasks.md:110` (task 1.3 and 7.1 text) | Example hash and "the lockfile pins `f746cde…`" | **Not edited**, as instructed. The task 7.1 text still names `f746cde`, although it allows "a newer commit the owner chooses" |
| `WORKING-NOTES.md:88, 99` | Task 1.3 baseline output | **Kept**. Records the unchanged tree |

Note: `design.md` is untracked (it is new in this working tree), so `git diff --stat` does not list it.

### Items for the owner

1. **cache-data has no verified-origin check yet.** cache-data 1.4.1 on `main` has no `CACHE_DATA_ORIGIN_SECRET_NAME` and no `isOriginVerified`. Part B (tasks 14.x) therefore waits for cache-data. It does not gate the release.
2. **`TODO.md` diff.** Besides the added registry-switch line (task 7.4), the diff moves two existing lines: "Remove `ReadLambdaPermission` …" and "version-scoped-rollback-alarms …" now sit below the 0-0-8 `lint-indent-and-code-style` line, and the old positions are deleted (the blank line after them moves with them). This task did not make that move (task 7.4 appends only). It was not determined whether it comes from your own earlier uncommitted edits. Check `git diff TODO.md` before committing, and split the hunk if it is not part of this change.
3. **Pre-existing documentation issues, left alone:**
   - `docs/admin-ops/deployment/self-hosting.md:242` still shows a `PublicRateLimit` parameter that does not exist.
   - `INFRA/src/static/public/docs/rate-limits/index.html` line 21 says "rolling window", but the limiter uses fixed windows.
   - `README.md` line 111 conflicts with line 17 (BETA and registration).
4. **JSDoc example address.** The example `1.2.3.4` in `RF/utils/auth-resolver.js` could be a documentation address such as `192.0.2.1`.
5. **`routes/index.js`.** It could use cache-data's new `Response.setBodyToNull()` instead of `response._body = null`. Not changed.
6. **Rollout needs your approval and a pipeline deploy.** Tasks 10 to 13 (deploy to `test`, gates G1 to G6, `beta`, `main`, the registry switch, the release) are not started. G5 needs a host with IPv6. The commit order is `dev`, then merge to `test`.
7. **Unrelated large diffs.** `PLAN.md` (393 lines) and `CROSS-RESOURCE-PLAN.md` (328 lines) show large uncommitted diffs from the planning sessions; this task did not change `CROSS-RESOURCE-PLAN.md` or `PLAN.md`.

### Files for the owner and the suggested commit scope

No commit was made. `git status` shows 50 entries. Suggested scope for one commit on `dev` (paths relative to the repository root; `RF` is `application-infrastructure/src/lambda/read-function`, `AF` is `application-infrastructure/src/lambda/auth-function`):

Code and template
- `RF/utils/client-address.js` (new)
- `RF/utils/auth-resolver.js`
- `RF/utils/rate-limiter.js`
- `RF/index.js`
- `application-infrastructure/template.yml`

Dependency
- `RF/package.json`, `RF/package-lock.json`, `RF/.npmrc` (new)
- `AF/package.json`, `AF/package-lock.json`, `AF/.npmrc` (new)
- `.gitignore` (negation so the `.npmrc` files are tracked)

Tests (new)
- `RF/tests/unit/utils/client-address.test.js`
- `RF/tests/property/client-address.property.test.js`
- `RF/tests/property/client-identity-spoofing.property.test.js`
- `RF/tests/unit/architecture/endpoint-and-client-address.test.js`
- `RF/tests/unit/architecture/no-forwarding-header-parsing.test.js`

Tests (changed)
- `RF/tests/unit/utils/auth-resolver.test.js`, `RF/tests/unit/utils/rate-limiter.test.js`, `RF/tests/unit/utils/rate-limiter-property.test.js`
- `RF/tests/property/auth-resolver.property.test.js`, `RF/tests/property/auth-resolver-preservation.property.test.js`, `RF/tests/property/client-request-response.property.test.js`
- `RF/tests/unit/lambda/read-handler.test.js`
- `RF/tests/integration/test-helpers.js`, `RF/tests/integration/agent-assets-mcp-flow.test.js`, `RF/tests/integration/mcp-protocol-compliance.test.js`

Tests (deleted)
- `RF/tests/unit/utils/rate-limiter-ip-resolution-bug.property.test.js`
- `RF/tests/unit/utils/rate-limiter-ip-resolution-preservation.property.test.js`

Documentation
- `docs/admin-ops/ingress-and-client-address.md` (new)
- `docs/developer/client-address.md` (new)
- `docs/admin-ops/README.md`, `docs/developer/README.md`, `docs/admin-ops/deployment/README.md`, `docs/admin-ops/deployment/cloudformation-parameters.md`
- `ARCHITECTURE.md`, `DEPLOYMENT.md`, `CHANGELOG.md`, `README.md`
- `TODO.md` (see item 2 above)

Spec folder `.kiro/specs/0-0-7-rate-limit-client-ip-spoofing/`
- Untracked: `requirements.md`, `design.md`, `tasks.md`, `tasks.meta.json`, `WORKING-NOTES.md`, `SPIKES.md`, `ISSUE-DRAFTS.md`, `spikes/`
- Modified: `PLAN.md`, `CROSS-RESOURCE-PLAN.md` (planning-session changes; the owner decides whether they belong in this commit)

Expectations from task 9.2 hold: nothing under `AF` apart from the dependency files, and nothing under `application-infrastructure/tests/postdeploy-verify`.

## Task 11.1 result

The change probe was not run. The owner pushed and deployed Part A to the Test stage before this run started, so a probe loop could not be running during the deploy. No HTTP traffic was sent for this task.

G4 (no 5xx during the switch) is therefore NOT verified by a probe for the Test stage. The fallback evidence is the PostDeploy result (task 11.2) and the read-only CloudWatch metrics below.

Read-only CloudWatch evidence (profile `release`, region `us-east-2`, stack prefix `prod63k-atlantis-mcp-test`, account number not recorded). Window 2026-11-11T00:50:00Z to 01:40:00Z (pipeline execution 01:07Z to 01:15Z), period 60, statistic Sum. REST API id `nj1sciuyka` (physical id of `WebApi` in `prod63k-atlantis-mcp-test-application`).

| Metric | Dimensions | Datapoints | Max per minute | Total |
|---|---|---|---|---|
| `AWS/ApiGateway` `5XXError` | ApiName=`prod63k-atlantis-mcp-test-WebApi`, Stage=`atlantis-mcp-test` | 1 | 0 | 0 |
| `AWS/ApiGateway` `5XXError` | ApiName only | 1 | 0 | 0 |
| `AWS/ApiGateway` `Count` (context) | ApiName + Stage | 1 | 26 | 26 |
| `AWS/Lambda` `Errors` | FunctionName=`prod63k-atlantis-mcp-test-ReadFunction` | 1 | 0 | 0 |
| `AWS/Lambda` `Invocations` (context) | FunctionName | 1 | 24 | 24 |

Reading: no 5xx and no Lambda errors in the window. Limit of this evidence: each metric has a single one-minute datapoint (26 API requests, 24 invocations), which looks like the PostDeploy verification run only. There was no steady traffic across the switch, so the zero-error result shows the requests that happened to occur succeeded, and does not show a gap-free switch. G4 stays "not verified by a probe"; the metrics are supporting evidence only.

## Task 11.2 result
Read-only AWS access (profile `release`, region `us-east-2`). No HTTP request was sent to any stage. Account numbers are not recorded.
Pipeline `prod63k-atlantis-mcp-test-Pipeline`, execution `ec1f012b-d06b-4c5c-a817-9e440c36fff6` (started 2026-11-11T01:07Z): Source, Build, Deploy (GenerateChangeSet, ExecuteChangeSet) and PostDeploy all `Succeeded`. Source commit `29c35d96cdaa2f84553e259882338dfb53b19f1f`.
PostDeploy build: CodeBuild `prod63k-atlantis-mcp-test-PostDeploy:8225e7fe-aebd-498b-a9ef-8db2be6e4ccf`, `SUCCEEDED`, 2026-11-11T01:14:19Z to 01:14:52Z. Log group `/aws/codebuild/prod63k-atlantis-mcp-test-PostDeploy`, stream `8225e7fe-aebd-498b-a9ef-8db2be6e4ccf`. Every build phase succeeded. The verifier's own tests (`tests/postdeploy-verify`) ran in the same build before `05-verify-deployment.sh` and passed.
`VERIFY_REPORT` line (schemaVersion 1): `outcome: passed`, `exitCode: 0`, `failedCore: []`, `skippedCore: []`, `warnings: []`, `error: null`, `rateLimit: null`, `requests: {posts: 24, preflights: 1, retries: 0}`, `durationMs: 3496`.
| Item | Result |
|---|---|
| Sub-checks | 47 (matches the expected count; Part A does not change the verifier) |
| Core | 37 passed, 0 failed, 0 skipped |
| Advisory | 5 passed, 0 warned, 5 skipped (47 = 37 + 5 + 5) |
| Failures | none |
| Warnings | none |
| Skipped advisory | X2.1, X2.2, X2.3, X2.4, X2.5: "no custom domain for this stage". The edge target is `none`, so the checks through CloudFront do not run on the Test stage |
| Stored verification key | present and used; S2.1, S2.2 passed; S2.3 passed (limit 6000 against 50 for the public tier) |
| Release version | expected `0.0.7`; `server/discover` reported `0.0.7` (V1.1) and `initialize` reported `0.0.7` (V1.2). CHANGELOG.md top header is `[v0.0.7] (unreleased)`. They match |
| Supported revisions | `2024-11-05`, `2025-11-25`, `2026-07-28` |
Requirement 11.3 (PostDeploy passes with 47 sub-checks): met on the Test stage.
5xx: no probe loop ran (see task 11.1), so there was nothing to stop. The PostDeploy run itself saw no 5xx: all 37 core checks passed, and the CloudWatch metrics recorded under task 11.1 show 0 `5XXError` and 0 Lambda `Errors` in the window. G4 remains "not verified by a probe".
Limits of this evidence:
- The 5 skipped X2 checks mean the CloudFront path was not verified on Test. G1 to G3 and G5 (tasks 11.3 to 11.5) are separate and not covered here.
- `S2.3` shows the keyed path works, but nothing in this run exercised the keyless per-client-address bucket that Part A changes.

## Task 11.3 result (G1, G2)
Test stage only. Two keyless `POST tools/list` requests were sent, one to the CloudFront domain and one to the raw `execute-api` URL, each with its own `X-Gate-Marker` header. Nothing was sent to `beta` or `prod`. No address is recorded here. Temporary files were deleted.
| URL | HTTP status | `X-RateLimit-Remaining` | Log event found | `sourceIp` vs caller | `X-Forwarded-For` (header present, entries) |
|---|---|---|---|---|---|
| CloudFront domain | 200 | present, `49` | no | not compared (no event) | not observed |
| Raw URL | 200 | present, `48` | no | not compared (no event) | not observed |
Log search: `/aws/lambda/prod63k-atlantis-mcp-test-ReadFunction`, filter pattern `"EVENT RECEIVED" "X-Gate-Marker"`, last 10 minutes. Searched about 12 seconds after the requests and again after a further 30 seconds (the one allowed retry). Both searches returned zero events, with no AWS error.
Result: G1 and G2 are **not established**. Neither is `equal` and neither is `different`. The observed role of `sourceIp` is **missing**, because there was no event to read. This is a failure to find the evidence, not evidence of a wrong address. Stopped as instructed; no plan was edited.
Supporting observation: the two requests were served and counted (HTTP 200, remaining 49 then 48). The count dropped by one across the two URLs, so both requests were counted against one allowance. That is consistent with both URLs seeing the same client address, but it is not G1 or G2 evidence.
Possible reasons the event is absent, not yet checked: `index.js` logs the event with `DebugAndLog.debug("EVENT RECEIVED:", event)`, so the line may not be written at the Test stage's effective cache-data log level, or the header name may be logged in a different case or on separate log lines than the filter pattern assumes.

## Task 11.3 follow-up (G1, G2 completed from the existing log)
Read-only AWS access (profile `release`, region `us-east-2`) to the Test log group and Lambda/API configuration. No new request was sent to any stage and no configuration or code was changed. No address is recorded. Temporary files in `/tmp` were deleted. Account numbers are masked.
Why the first search found nothing: the event line is emitted on Test. The earlier filter `"EVENT RECEIVED" "X-Gate-Marker"` is case-sensitive, and the marker header is logged in lowercase (`x-gate-marker`) in both events. A search for `"g1-"` and one for `"EVENT RECEIVED"` over the last 30 minutes each returned exactly the two events of the earlier requests (2026-11-11T03:47:23Z).
How the event is logged: one CloudWatch event per request, text log format, tag `[DEBUG] EVENT RECEIVED: | ` followed by the event as multi-line `util.inspect` output (unquoted keys, single-quoted strings, about 65 to 111 lines), not JSON. A parser must match `sourceIp: '...'` inside `requestContext.identity`, not parse JSON. `X-Forwarded-For` is spelled `X-Forwarded-For` in both events; the marker header is lowercase; other header names keep the case the caller or CloudFront sent.
Effective log level on Test: Lambda environment variable names that matter are `LOG_LEVEL=DEBUG`, `AWS_LAMBDA_LOG_LEVEL=DEBUG`, `DEPLOY_ENVIRONMENT=TEST`, `NODE_ENV=production`, `CACHE_DATA_TRUSTED_PROXY_HOPS=0`. `CACHE_DATA_LOG_LEVEL` is not set. cache-data's `DebugAndLog` checks the names in the order `CACHE_DATA_LOG_LEVEL`, `LOG_LEVEL`, and so on, so `LOG_LEVEL=DEBUG` gives level 5 and the DEBUG line is written. The production cap to level 2 applies only to a production `DEPLOY_ENVIRONMENT`, which Test is not. Lambda `LoggingConfig` is `Text`.
API Gateway `prod63k-atlantis-mcp-test-WebApi` endpoint type: `REGIONAL`.
| URL | Marker | `sourceIp` vs caller | `X-Forwarded-For` entries | Other signs of the path |
|---|---|---|---|---|
| CloudFront domain | `g1-<epoch>-cdn` | `equal` | 2 (the caller is the first entry) | `Via` shows CloudFront; `CloudFront-*` headers present |
| Raw `execute-api` URL | `g1-<epoch>-raw` | `equal` | 1 (the caller) | no `Via`, no `CloudFront-*` headers |
The caller's address was taken from `curl -4 -s https://checkip.amazonaws.com`, as IPv4; both `sourceIp` values are IPv4. `multiValueHeaders` is present in both events and carries `X-Forwarded-For` as a single element.
Result: **G1 (CloudFront domain) passes and G2 (raw URL) passes**: `sourceIp` is the caller on both URLs, so it is the viewer's address, not an edge address. The G1/G2 failure path (observed role `edge`, `other`, or `missing`) is not triggered.
Points for the owner to read:
- The CloudFront-path event shows the request came through CloudFront (`Via`, two `X-Forwarded-For` entries) and still has the caller as `sourceIp`. This matches the changelog statement that on a Regional API the viewer's address is `sourceIp`. It was observed once per URL, over IPv4 only; G5 (IPv6) is task 11.5 and is not covered.
- Both requests were seen as the same client, which fits the earlier counter observation (49 then 48).
- G3 (a spoofed `X-Forwarded-For` does not change the bucket) and G4 are not covered here.
- The RESPONSE-line fallback and the "minimal extra step" paths of the instructions were not needed.
- `tasks.md` was not edited; marking 11.3 is left to the orchestrator.

## Task 11.4 result (G3)

Probe of Design V-D (G3), run against the Test stage only. Six keyless `tools/list` POSTs with a forged `X-Forwarded-For` (documentation-range addresses), three to the raw URL and three to the CloudFront domain, in the order shown. Nothing was sent to beta or prod. No retries. The caller's address was not looked up and is not recorded.

| # | URL | `X-Forwarded-For` sent | HTTP status | `X-RateLimit-Remaining` |
|---|-----|------------------------|-------------|-------------------------|
| 1 | raw (`execute-api`) | 192.0.2.10 | 200 | 47 |
| 2 | raw (`execute-api`) | 192.0.2.10 | 200 | 46 |
| 3 | raw (`execute-api`) | 192.0.2.11 | 200 | 45 |
| 4 | CloudFront domain | 192.0.2.20 | 200 | 44 |
| 5 | CloudFront domain | 192.0.2.20 | 200 | 43 |
| 6 | CloudFront domain | 192.0.2.21 | 200 | 42 |

- Remaining values in order: 47, 46, 45, 44, 43, 42. Status codes: 200 for all six.
- Result: **PASS**. The count fell by exactly one on every request, continuing from the 49 and 48 seen in G1/G2. The third request of each trio (a changed `X-Forwarded-For`) did not reset the count, and the count carried across the two URLs, so the forged header did not choose the bucket and both entry points resolve to the same client bucket.
- Requirement 11.2. `tasks.md` was not edited; marking 11.4 is left to the orchestrator.

## Tasks 11.5 to 11.7: owner decisions and gate summary (Test stage)

No traffic was sent for task 11.5 and none for 11.6 or 11.7. Nothing was sent to beta or prod. No address is recorded here. `tasks.md` was not edited.

### Task 11.5 (G5, IPv6): NOT verified, gap accepted by the owner

The machine has no IPv6 route, so G5 cannot be run from it. Requirement 11.4 required asking the owner. The owner answered on 2026-11-11: "Accept the G5 gap; Kiro check not needed now".

What stays unverified on the live Test stage:

- That API Gateway reports an IPv6 viewer's address as `sourceIp` on the Regional API, for both the CloudFront domain and the raw `execute-api` URL. G1 and G2 were observed over IPv4 only.
- The /64 bucket rule on the live stage. It is covered only by unit and property tests: `tests/unit/utils/client-address.test.js` and `tests/property/client-address.property.test.js` (both under `application-infrastructure/src/lambda/read-function`).

Risk if the assumption is wrong. This was checked against the code before writing it:

- `utils/client-address.js`, `toBucketKey`: returns `null` for a value that is not a string, is empty or too long, contains a zone id (`%`), or is not an address. A valid IPv6 address becomes its /64 key, and an IPv4-mapped IPv6 address becomes its IPv4 key.
- `utils/auth-resolver.js`, `resolveAuth`: with no API key, the public `identity` is `toBucketKey(clientAddress)`, so it is `null` for such a value.
- `utils/rate-limiter.js`, `checkRateLimit`: a missing or `null` `identity` returns `failClosed(...)` with `allowed: false` before the salt is read and before any counter is written.
- `index.js` (line 147 onward): `!rateLimitCheck.allowed` produces the 429 response.

So a missing or unusable `sourceIp` for IPv6 clients (keyless requests only) would refuse those clients with HTTP 429. It fails closed, not open, and it cannot let a client choose its bucket. A `sourceIp` that is odd but parseable would not be refused. It would be bucketed as an IPv4 address or by its /64, which could be a different grouping from the one intended. Requests with an API key are limited by account and are not affected.

### Task 11.6 (Kiro check): skipped by the owner

The owner skipped it with the same answer ("Kiro check not needed now"). Requirement 11.8 is not satisfied yet. Recommendation: run the Kiro check before the v0.0.7 release.

### Gate summary, Test stage

| Gate | Result | Evidence |
|---|---|---|
| PostDeploy (task 11.2) | Passed | 47 sub-checks: 37 core passed, 5 advisory passed, 5 advisory skipped (X2.1 to X2.5, no custom domain on Test), 0 failed |
| G1 (CloudFront domain) | Equal | `sourceIp` is the caller's address; the event shows the CloudFront path and two `X-Forwarded-For` entries (task 11.3 follow-up) |
| G2 (raw `execute-api` URL) | Equal | `sourceIp` is the caller's address; one `X-Forwarded-For` entry, no CloudFront headers (task 11.3 follow-up) |
| G3 (forged `X-Forwarded-For`) | Pass | `X-RateLimit-Remaining` 47, 46, 45, 44, 43, 42 over six requests, all HTTP 200, one bucket across both URLs (task 11.4) |
| G4 (no 5xx during the switch) | Not verified by a probe | CloudWatch: 0 `5XXError` and 0 Lambda `Errors` in the deploy window, but one datapoint only (task 11.1) |
| G5 (IPv6) | Gap accepted by the owner | No IPv6 host; see above |
| Kiro check (11.6) | Skipped by the owner | Requirement 11.8 open |

### Decision (task 11.7)

G1, G2 and G3 pass. The owner is asked for approval to promote to beta.

Conditions and reminders for the beta step:

- The owner merges test to beta. Ask before sending any traffic to beta.
- Beta logs at INFO, so the event line used for G1 and G2 is not readable there. On beta, run G3 and the G4 loop only.
- Start the G4 loop before the owner merges, so the PROD gradual-deployment window is observed. On Test no loop ran, which is why G4 stays unverified.
- In PROD, CloudFormation updates the REST API after the Read function's gradual shift (about 30 minutes by default). For that time the new function runs behind the still edge-optimized API, so G3 results during that window can differ from the final state. Run G3 again once the API update has finished.

Open items carried to the release: G4 not probed on Test, G5 not verified, and the Kiro check (requirement 11.8).

### Task 12.1 part 1 (beta G4 loop started)
The owner approved sending keyless `tools/list` requests to beta for G3 and the G4 loop only. Nothing was sent to prod. The loop was started before the owner merges test to beta, so the PROD gradual-deployment window is observed.
- Hosts: raw `i17st3itv0.execute-api.us-east-2.amazonaws.com`, path `/atlantis-mcp-beta/mcp/v1` (stage name from the `ApiEndpoint` output of `prod63k-atlantis-mcp-beta-application`). Custom domain `mcp-beta.atlantis.63klabs.net`, path `/mcp/v1` (the only alias of the beta distribution). The `cloudfront.net` domain is not used.
- One `tools/list` POST to each URL returned HTTP 200 with an `X-RateLimit-Remaining` header, so both are real paths.
- BEFORE state (read-only, `--profile release --region us-east-2`):
  | Item | Value |
  |---|---|
  | REST API endpoint type | EDGE |
  | Read function `CACHE_DATA_TRUSTED_PROXY_HOPS` (unqualified and `live` alias configuration) | not set |
  | Alias `live` version | 60 |
- Loop: `/tmp/g4-beta.sh`, PID in `/tmp/g4-beta.pid`, log `/tmp/g4-beta.log` (`HH:MM:SS <RAW|CDN> <http_code>`, one pair every 45 seconds). It stops itself after 3 hours or when `/tmp/g4-beta.stop` exists. 429s are expected once the 50-per-hour allowance is used and are not a failure; 5xx or `000` are.
- The loop is left running. The owner can now merge test to beta.

### Task 12.1 part 2 (beta results)
All times UTC. Read-only AWS calls (`--profile release --region us-east-2`). Nothing was sent to prod. The only beta traffic in part 2 was the six G3 requests.

**G4: not evaluated, no data.** `/tmp/g4-beta.sh`, `/tmp/g4-beta.pid` and `/tmp/g4-beta.log` no longer existed when part 2 started (`/tmp` had been re-created at boot; the host reported about 1 h 39 min of uptime). No loop process was running and nothing was found with `find / -name 'g4-beta*'`. There was nothing to stop and no log to count, so there are no per-code counts, first/last timestamps, or 5xx/000 lists, and step 3 (compare codes with the shift and API-update times) could not be done. The loop's coverage of the gradual-deployment window is therefore missing. Part 1 recorded a loop that ran; the machine restarted at some point before part 2. The AWS-side evidence for the window is below. A rerun of G4 would need a new beta deploy window (for example the `main` step, where the plan already calls for G3 and G4 again).

| Item | Value |
|---|---|
| Pipeline execution (beta, trigger: source event) | `babc5a5f-878d-4442-9a88-c5812d71d9fd`, Succeeded, 2026-11-11 03:59:48 to 04:35:29 |
| Build / PackageExport | 03:59:51 to 04:03:58 |
| Deploy / GenerateChangeSet | 04:03:58 to 04:04:38 |
| Deploy / ExecuteChangeSet | 04:04:38 to 04:32:54 |
| PostDeploy / PackageExport | 04:32:54 to 04:35:28 |
| CodeDeploy `d-8IP62D4HL` | Succeeded, no rollback, `CodeDeployDefault.LambdaLinear10PercentEvery3Minutes`; created 04:05:22.9; `BeforeAllowTraffic` 04:05:23.8 to 04:05:23.9; `AllowTraffic` (the shift) 04:05:23.9 to 04:32:26.8; `AfterAllowTraffic` 04:32:27.0 to 04:32:27.1 |
| CloudFormation `WebApi` (RestApi) | `UPDATE_IN_PROGRESS` 04:32:41.3, `UPDATE_COMPLETE` 04:32:45.2 |
| Stack `prod63k-atlantis-mcp-beta-application` | `UPDATE_IN_PROGRESS` 04:04:40.2, `UPDATE_COMPLETE` 04:32:51.0 |

Window arithmetic:
- (a) The alias `live` finished moving from version 60 to 61 at 04:32:26.8 (end of the shift; the shift started 04:05:23.9 and took 27 min 03 s).
- (b) CloudFormation updated `WebApi` from 04:32:41.3 to 04:32:45.2 (3.9 s).
- (c) The new function ran behind the still edge-optimized API from the start of the shift (04:05:23.9) to the start of the `WebApi` update (04:32:41.3): 27 min 17 s. Counted to the end of the update (04:32:45.2): 27 min 21 s. The gap between the end of the alias shift and the start of the `WebApi` update was 14.5 s. During the first part of the window only a share of traffic (10% per 3 minutes, rising) reached version 61; from 04:32:26.8 all of it did.

PostDeploy (CodeBuild `prod63k-atlantis-mcp-beta-PostDeploy:2804852c-2b47-4467-b7bb-1219f87623ff`, SUCCEEDED, 04:32:54 to 04:35:14): `VERIFY_REPORT` outcome `passed`, exit code 0, expected version `0.0.7`, reported versions `0.0.7` for discover, initialize and edge, core 37 passed / 0 failed / 0 skipped, advisory 10 passed / 0 warned / 0 skipped (47 sub-checks; the X2.x CloudFront checks ran, with edge target `https://mcp-beta.atlantis.63klabs.net/mcp/v1`), stored verification key present and used, skip flag `false`, 27 POSTs, 2 preflights, 0 retries, no rate-limit exhaustion.

Current state (read after the deploy):
| Item | Before | Now |
|---|---|---|
| REST API `prod63k-atlantis-mcp-beta-WebApi` (`i17st3itv0`) endpoint type | EDGE | REGIONAL |
| Read function `CACHE_DATA_TRUSTED_PROXY_HOPS` (unqualified / `$LATEST`, last modified 04:05:12) | not set | `0` |
| Same variable on the version `live` points to | not set | `0` (version 61) |
| Alias `live` version, routing config | 60 | 61, no weighted routing left |

G3 on beta, after the API update finished (run well after the pipeline finished, about 20 hours later by the `X-RateLimit-Reset` header's hour boundary; the host clock readings earlier in the session were inconsistent, so AWS timestamps were used for all durations). Six counted requests, `tools/list`, no API key, forged `X-Forwarded-For` values (documentation addresses 192.0.2.x):
| URL | Request | HTTP | `X-RateLimit-Remaining` |
|---|---|---|---|
| raw `execute-api` | 1 (address A) | 200 | 49 |
| raw `execute-api` | 2 (address A) | 200 | 48 |
| raw `execute-api` | 3 (address B) | 200 | 47 |
| CloudFront `mcp-beta.atlantis.63klabs.net` | 4 (address C) | 200 | 46 |
| CloudFront | 5 (address C) | 200 | 45 |
| CloudFront | 6 (address D) | 200 | 44 |

All six returned the same `X-RateLimit-Reset` (2026-11-12 02:00:00Z). The count fell by one on every request, the third request of each trio did not reset to a high number, and the single bucket was shared by both URLs. G3: pass on beta. Starting at 49 means the bucket was fresh (the earlier hourly window had expired), so there is no earlier-loop usage in it.

Open items after this step: G4 on beta has no probe data (see above); G5 and the Kiro check (requirement 11.8) are unchanged; the `main` step still needs G3 and G4 again.

### Task 12.2 part 1 (prod G4 loop started)
The owner approved (2026-11-11) sending keyless `tools/list` requests to prod for the G4 loop now and for G3 later. Nothing else was sent to prod. AWS reads were read-only (`--profile release --region us-east-2`). All times UTC. No caller address is recorded.
- Hosts: raw `gy3gpv7n1k.execute-api.us-east-2.amazonaws.com`, path `/atlantis-mcp-prod/mcp/v1` (stage name from the `ApiEndpoint` output of `prod63k-atlantis-mcp-prod-application`). Custom domain `mcp.atlantis.63klabs.net`, path `/mcp/v1` (the only alias of distribution `E3RAOR5OWPIYP4`; the `cloudfront.net` domain is not used).
- Confirmation: one `tools/list` POST to each URL returned HTTP 200. `X-RateLimit-Remaining` was 49 (raw) then 48 (CDN), so both URLs share one bucket and the loop uses 2 of the 50 hourly allowance per 45 s pair after that (429s will appear and are expected; 5xx or `000` are failures).
- State at 01:09 (before the prod deploy reached the Deploy stage):

| Item | State |
|---|---|
| REST API `prod63k-atlantis-mcp-prod-WebApi` (`gy3gpv7n1k`) endpoint type | EDGE |
| Read function `CACHE_DATA_TRUSTED_PROXY_HOPS`, unqualified (`$LATEST`, last modified 2026-11-07 04:49:50) | not set |
| Same variable on the version `live` points to | not set (version 53) |
| Alias `live` | version 53, no weighted routing |
| Application stack | `UPDATE_COMPLETE` (last updated 2026-11-07 04:49:18) |
| CodeDeploy deployment in progress | none (latest is `d-LI09P9IEL`, Succeeded, created 2026-11-07 04:50:00, `CodeDeployDefault.LambdaLinear10PercentEvery3Minutes`) |
| Pipeline `prod63k-atlantis-mcp-prod-Pipeline` current execution | `6f4a9106-d7e4-42dc-b012-c3b1cf5f5bd9`, started 2026-11-12 01:07:34 (trigger: source event), InProgress; Source Succeeded, Build (`PackageExport`) InProgress; Deploy and PostDeploy still show the previous execution `732626e6-...` (Succeeded) |

- Loop: `$HOME/atlantis-g4-prod/g4-prod.sh`, PID in `$HOME/atlantis-g4-prod/g4-prod.pid` (script PID 48953), log `$HOME/atlantis-g4-prod/g4-prod.log` (`HH:MM:SS <RAW|CDN> <http_code>`, one pair every 45 s, failures logged as `000`). Started 2026-11-12 01:09:28. It stops itself after 3 hours or when `$HOME/atlantis-g4-prod/g4-prod.stop` exists. It lives under `$HOME`, not `/tmp`, because the host reboot during the beta run cleared `/tmp`. The loop is left running; part 2 stops it and evaluates it against the shift and API-update times.

### Task 12.2 part 2 (prod results)
All times UTC, 2026-11-12. AWS reads were read-only (`--profile release --region us-east-2`). No caller address is recorded. Traffic sent to prod in part 2, besides the loop: 7 keyless `tools/list` requests (one that returned 429 and was not counted for G3, then the six G3 requests). Nothing else.

**Loop stopped.** At the start the log existed and the last line was 02:49:31 (same second as the host clock), so the loop had been running until then. `g4-prod.stop` was created at about 02:49:41; the script wrote `END 02:50:16` and exited (about 35 s). No `g4-prod` process remained.

**G4: pass (only 200 and 429; no 5xx, no `000`).** Loop `START 01:09:28`, last request 02:49:31, `END 02:50:16`. 266 requests (133 pairs, one pair every 45 s).

| URL | 200 | 429 | other (5xx / 000) | total |
|---|---|---|---|---|
| RAW (`execute-api`) | 66 | 67 | 0 | 133 |
| CDN (`mcp.atlantis.63klabs.net`) | 68 | 65 | 0 | 133 |

By period (pairs are RAW+CDN):
| Period | RAW | CDN |
|---|---|---|
| Before the shift, 01:09:28 to 01:13:04 | 5 x 200 | 5 x 200 |
| Shift, 01:13:04 to 01:40:21 (WebApi update start) | 33 x 200, 3 x 429 | 36 x 200 |
| After the WebApi update start, 01:40:21 to 02:49:31 | 28 x 200, 64 x 429 | 27 x 200, 65 x 429 |

When the 429s began: RAW 01:33:46 (during the shift; 01:33:46, 01:34:31, 01:35:17; RAW returned 200 again from 01:36:02 and to 01:42:06 while CDN also returned 200 until 01:41:20). Both URLs 429 from 01:42:51 (CDN from 01:42:06) until the top of the hour. At 02:00:16 both returned 200 again (new hourly window); 50 x 200 in the 02:00 hour (25 pairs, last 200 at 02:18:28), then 429 from 02:19:13 to the end. The hour 01 had 84 x 200 against a limit of 50 per hour, so for that hour the two URLs did not draw on one count (see the observations below); in the 02:00 hour the count was 50, one shared bucket.

**Timeline (pipeline `prod63k-atlantis-mcp-prod-Pipeline`, execution `6f4a9106-d7e4-42dc-b012-c3b1cf5f5bd9`, Succeeded, 01:07:34 to 01:42:18):**
| Item | Start | End |
|---|---|---|
| Source | 01:07:34 | 01:07:37 |
| Build / PackageExport | 01:07:37 | 01:11:44 |
| Deploy / GenerateChangeSet | 01:11:44 | 01:12:19 |
| Deploy / ExecuteChangeSet (Deploy stage action) | 01:12:20 | 01:40:44 |
| Stack `prod63k-atlantis-mcp-prod-application` | UPDATE_IN_PROGRESS 01:12:21 | UPDATE_COMPLETE 01:40:30 |
| Read function new version 54 (`$LATEST` last modified, `CACHE_DATA_TRUSTED_PROXY_HOPS=0`) | published 01:12:54 | |
| CodeDeploy `d-OD4HLHPHL`, config `CodeDeployDefault.LambdaLinear10PercentEvery3Minutes`, Succeeded, rollbackInfo null | created 01:13:03.6 | complete 01:40:08.0 |
| `BeforeAllowTraffic` | 01:13:04.4 | 01:13:04.5 |
| `AllowTraffic` (the shift, alias `live` 53 to 54) | 01:13:04.5 | 01:40:07.5 |
| `AfterAllowTraffic` | 01:40:07.7 | 01:40:07.8 |
| CloudFormation `WebApi` (RestApi) | UPDATE_IN_PROGRESS 01:40:21.7 | UPDATE_COMPLETE 01:40:25.2 |
| PostDeploy / PackageExport (CodeBuild `d8f1e4e8-cb3c-453a-94da-53787947a566`) | 01:40:45 | 01:42:17 |

- (a) The shift finished at 01:40:07.5 (27 min 03 s after it started at 01:13:04.5).
- (b) The `WebApi` update ran 01:40:21.7 to 01:40:25.2 (3.5 s). It started 14.2 s after the shift ended.
- (c) The new function (version 54, from the first 10% step) ran behind the still edge-optimized API from 01:13:04.5 to 01:40:21.7: 27 min 17 s. Only a share of traffic reached version 54 until 01:40:07.5.
- Answer: as on beta, CloudFormation updated the REST API after the shift (14.2 s after it), not before or during.

**Current state (read after the deploy):**
| Item | Before | Now |
|---|---|---|
| REST API `prod63k-atlantis-mcp-prod-WebApi` (`gy3gpv7n1k`) endpoint type | EDGE | REGIONAL |
| `CACHE_DATA_TRUSTED_PROXY_HOPS`, unqualified (`$LATEST`, last modified 01:12:54) | not set | `0` |
| Same variable on the version `live` points to (54, last modified 01:12:54) | not set (53) | `0` |
| Alias `live` | version 53 | version 54, routing config none (no weighted routing) |

**PostDeploy:** CodeBuild `prod63k-atlantis-mcp-prod-PostDeploy:d8f1e4e8-cb3c-453a-94da-53787947a566`, SUCCEEDED, 01:40:45 to 01:42:16. `VERIFY_REPORT`: outcome `passed`, exit code 0, expected version `0.0.7`, reported versions `0.0.7` for discover, initialize and edge, core 37 passed / 0 failed / 0 skipped, advisory 10 passed / 0 warned / 0 skipped (47 sub-checks, the X2.x CloudFront checks ran against `https://mcp.atlantis.63klabs.net/mcp/v1`), stored verification key present and used, skip flag `false`, 27 POSTs, 2 preflights, 0 retries, `rateLimit` null.

**Loop log against the shift and the API update (observations only):** There was no `000` or 5xx anywhere. No loop request fell inside the shift end (01:40:07.5) or the `WebApi` update (01:40:21.7 to 01:40:25.2): the nearest probes were 01:39:49 and 01:40:35, all 200. During the shift, RAW returned three 429s (01:33:46 to 01:35:17) while CDN returned 200 at the same seconds, and RAW returned 200 again from 01:36:02; both URLs were 429 only after 01:42. This matches a period when the two URLs and the two function versions did not share one count (the new version buckets by `sourceIp`, the old one by the first `X-Forwarded-For` entry); the cause was not verified further. After the API update the two URLs shared one count of 50 per hour.

**G3 on prod: pass.** The first attempt at 02:51:57 (one request, RAW) returned 429 with `X-RateLimit-Remaining` 0, `X-RateLimit-Reset` 1794452400 (03:00:00) and `Retry-After` 483, as expected after the loop used the allowance. The remaining five were not sent. One retry was made after waiting until 03:00:06 (the reset was 8 min away). Six counted requests, `tools/list`, no API key, forged `X-Forwarded-For` (documentation addresses 192.0.2.x, as in design.md):
| URL | Request | HTTP | `X-RateLimit-Remaining` |
|---|---|---|---|
| raw `execute-api` | 1 (address A) | 200 | 49 |
| raw `execute-api` | 2 (address A) | 200 | 48 |
| raw `execute-api` | 3 (address B) | 200 | 47 |
| CloudFront `mcp.atlantis.63klabs.net` | 4 (address C) | 200 | 46 |
| CloudFront | 5 (address C) | 200 | 45 |
| CloudFront | 6 (address D) | 200 | 44 |

All six returned `X-RateLimit-Reset` 1794456000 (04:00:00). The count fell by one per request, the third request of each trio did not reset to a high number, and one bucket served both URLs. Starting at 49 shows a fresh hourly window.

**Cleanup:** `$HOME/atlantis-g4-prod/` (log, script, stop file) was deleted after recording the counts above. The loop log held no lines other than 200 and 429 (plus the START and END lines).

Open items after this step (unchanged by it): G5 (IPv6, no host) and the Kiro check (requirement 11.8). G4 now has data for prod; beta G4 still has none.
