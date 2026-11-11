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
