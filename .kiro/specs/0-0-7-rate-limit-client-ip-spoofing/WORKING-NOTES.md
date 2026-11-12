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

## Task 14.1 result (2026-11-12): names bound against cache-data `main`

**Pin.** Both `package.json` files now pin `git+https://github.com/63Klabs/cache-data.git#d9cc35da22c024bb433a8774bf2a7ba13df09811` (was `#386c2f97bac518c59785251c973f7034bb4510b2`). `git ls-remote` showed `main` at that commit, so the head had not moved. The package is version 1.4.1 (npm `latest` is 1.4.0). The owner sets `package.json` back to the npm release after cache-data is released (TODO.md registry-switch line, task 13.1).

**Lockfile diff** (`git diff -U0`, both functions, identical): the root dependency spec line, the `resolved` line, and one added `integrity` line (`sha512-Zg0RJQc+…`). Nothing else changed. The `integrity` line is new compared with the previous pin: it is the only change beyond the two lines named in the request. No new peer or transitive dependencies (the peers are still the three `@aws-lambda-powertools/*` packages). Scratch copies under `/tmp` (`package.json`, `package-lock.json`, `.npmrc`, no `--allow-git`): `npm ci --omit=dev` then `npm install --omit=dev` passed in both, and the lockfile was byte-identical afterwards. The copies are deleted.

**Bound names** (source: `IngressVerifier.class.js`, `IngressSecretReaders.classes.js`, `ClientRequest.class.js`, cache-data docs `features/tools/README.md` "Ingress verification", `cloudfront-notes` O9):

| Provisional name | Real name / contract |
|---|---|
| `CACHE_DATA_ORIGIN_SECRET_NAME` | `CACHE_DATA_INGRESS_SECRET_NAME`: secret **name or ARN**, trimmed. Allowed characters `a-zA-Z0-9_.+=@:/-`, at most 2048, and `__proto__`/prototype names refused. Unset or blank = check off (`direct`). Invalid = `unverified` / `bad-configuration` plus one error log |
| (none) | `CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS`: default 3600, whole number 60 to 86400, else default plus one warning |
| `isOriginVerified()` | `clientRequest.isIngressVerified()`: `true` only for ingress `cloudfront`. **`false` for `direct`**, so the guard must apply only when the variable is set |
| (none) | `static ClientRequest.prime()`: resolves `true` when off or current value loaded, `false` otherwise, never rejects. `CachedParameterSecrets.prime()` also loads the readers (registered when `ClientRequest` is first loaded). Our `Config.prime()` already calls it in both functions |
| `client.ingress` | `getProps().client.ingress` = `direct` / `cloudfront` / `unverified`, set once in the constructor. `client.sourceIp` = `identity.sourceIp` as given, or `null` |
| unverified-request log token | `DebugAndLog.log(JSON.stringify({ reason }), "INGRESS_UNVERIFIED")`, printed `[INGRESS_UNVERIFIED] {"reason":"mismatch"}`. `log` is written at every log level. Verified by running it. Reasons: `missing-header`, `mismatch`, `secret-not-primed`, `secret-unavailable`, `secret-unusable`, `bad-configuration` |
| header | `X-Atlantis-Origin-Secret`, read from the lowercased header map; absent, empty, or non-string = `missing-header` |
| IAM | `secretsmanager:GetSecretValue` on the secret (cache-data docs use `…:secret:<name>-*`; `!Ref OriginSecret` is the full ARN and is tighter). `kms:Decrypt` only for a customer-managed key. The SDK path needs `@aws-sdk/client-secrets-manager` (in the Lambda runtime) |

Run on the pinned code with `CACHE_DATA_INGRESS_SECRET_NAME` set and nothing primed: ingress `unverified`, `sourceIp` kept, `isIngressVerified()` false, one error line and `[INGRESS_UNVERIFIED] {"reason":"secret-not-primed"}`. With the variable unset: `direct`, `isIngressVerified()` false.

**Secret form: a plain generated string.** The network template `v0.2.0` (header `X-Atlantis-Origin-Secret`, `HeaderValue: {{resolve:secretsmanager:${Prefix}-${ProjectId}-${StageId}-OriginSecret}}`, no JSON key, no version) puts the entire `SecretString` in the header. cache-data compares the header with the entire `SecretString` (SHA-256 digests, `timingSafeEqual`, no trimming, no JSON parsing). So design B1's `SecretStringTemplate: '{}'` + `GenerateStringKey: secret` would have made the header the JSON text `{"secret":"…"}`; both sides would still agree, but the header would carry quotes and braces, which the template's own docs never exercise. B1 is now `GenerateSecretString: { PasswordLength: 48, ExcludePunctuation: true }`, the example in the template's `api-ingress-standard.md`. 48 alphanumeric characters are about 285 bits (Requirement 5.6 asks 256). cache-data's only rule on the value is: not empty, not whitespace, not `BLANK` in any case (`secret-unusable`). Spike S4 ran the JSON-key form (`:SecretString:secret`), so the plain form was not run in a spike; task 14.6 should confirm on `test` that the header equals the generated string (a request through the distribution verifies).

**Rotation (AWSCURRENT / AWSPREVIOUS).** cache-data runs two readers per secret, `AWSCURRENT` and `AWSPREVIOUS`, and accepts a header equal to either (both compared on every request). A secret never rotated has no `AWSPREVIOUS` (`ResourceNotFoundException` or non-2xx from the extension) and is treated as "no previous version", not an error. Warm containers refresh after R = `CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS` (3600), plus up to 300 s with the extension layer. A mismatch starts one background reload per 60 s. cache-data sequence: (1) put the new secret value, (2) wait R + 300 s (65 min at the default), (3) update the network stack with a changed `ApiOriginSecretRevision`, (4) wait for `Deployed`, (5) detach `AWSPREVIOUS` to retire the old value.

**Inconsistencies between the template docs and cache-data** (reported, nothing edited in either repository):
1. `api-ingress-standard.md` "Rotating the secret" step 1 says change the application to accept both values. With cache-data nothing needs changing: it accepts current and previous automatically, as long as the rotation is done with `put-secret-value`.
2. The template sequence (put new value, then update the stack with a new `ApiOriginSecretRevision`) has no wait between them. With cache-data a wait of R + 300 s is needed so warm containers hold the new value. Without it requests are rejected with `mismatch` until the background reload catches up (minutes).
3. Template step 5 "Remove the old value from the application" corresponds to cache-data step 5 (detach `AWSPREVIOUS`). The template does not name it.
4. The template's example passes the secret ARN in `ORIGIN_SECRET_ID` and grants `Resource: !Ref OriginSecret`. cache-data's docs use the name with a `-*` suffix pattern. Both work: cache-data accepts name or ARN. Our design uses the ARN.
5. The template doc's "Reject when the secret is missing" and "Count rejections" are covered by cache-data (fails closed with `unverified`; the `INGRESS_UNVERIFIED` line). Not an inconsistency.

**Edits made** (design.md, requirements.md; tasks.md untouched):
- design.md: pinned hash in Section 8 and in the "Hash pinning" open point; the layer table (`isOriginVerified()` -> `isIngressVerified()`); Part B intro (provisional note -> bound names); B1 secret (JSON template/key and 64 -> plain string, 48) and its explanatory paragraph (plain-string reasoning, `CACHE_DATA_ORIGIN_SECRET_NAME` -> `CACHE_DATA_INGRESS_SECRET_NAME: !Ref OriginSecret`, ARN accepted, refresh variable unset, no `kms:Decrypt`); B2 guard (`isOriginVerified()` -> `isIngressVerified()`, provisional comment removed, `originProtectionIsOn` reads `CACHE_DATA_INGRESS_SECRET_NAME`, why the condition is needed) plus a new paragraph on priming and the fail-closed behaviour; B4 filter pattern -> `'"INGRESS_UNVERIFIED"'` with the line shape and reasons; "Provisional names" open point -> "Names bound".
- requirements.md: precondition 1 and the note below it; D6 row; glossary "Origin secret" and "Verified-origin check"; 5.6 (plain string); 5.8 (variable name, ARN); 6.3 (`isIngressVerified()`, true only for `cloudfront`); 9.1 (`INGRESS_UNVERIFIED`).

**Tests with the new commit** (run directly with `NODE_ENV=test npx jest --silent`, no stray jest processes before or after): Read 2304 passed / 115 skipped / 6 suites skipped (191 passed of 197); Auth 511 passed (43 suites). Both as expected for the Part A end state.

**Open for later tasks.** Requirement 6.8 and the guard test plan (14.3) should include the `secret-not-primed` / `secret-unavailable` cases as `401`. The metric filter (14.2) counts the Read Function's log group only. Task 14.6 should confirm the plain-string header on `test`.

## Task 14.2 result (2026-11-12): template secret, flag, environment, permission, metric filter
**Changes in `application-infrastructure/template.yml`** (+94 lines, nothing removed): parameter `ApiIsBehindCloudFront` (String, default `'false'`, AllowedValues `['true','false']`, description states the three-step rollout and the `ApiOriginProtection` / network `v0.2.0` requirement) in the Metadata "Application Parameters" group after `ApiGatewayLoggingEnabled`; condition `ApiIsBehindCloudFrontIsTrue`; resource `OriginSecret` (no Condition, `Name: !Sub '${Prefix}-${ProjectId}-${StageId}-OriginSecret'`, `GenerateSecretString: { PasswordLength: 48, ExcludePunctuation: true }`, no template/key, no Outputs or Export); `CACHE_DATA_INGRESS_SECRET_NAME: !If [ApiIsBehindCloudFrontIsTrue, !Ref OriginSecret, !Ref 'AWS::NoValue']` on `ReadLambdaFunction` and `AuthLambdaFunction` (`>!` comment: setting the variable turns the check on, `isIngressVerified()` is false for `direct`, so it is set only with the flag; `..._REFRESH_SECONDS` left unset); inline `!If` statement `OriginSecretRead` (`secretsmanager:GetSecretValue`, `Resource: !Ref OriginSecret`) appended to the single inline policy of `ReadLambdaExecutionRole` and `AuthLambdaExecutionRole`; `IngressUnverifiedMetricFilter` (`Condition: ApiIsBehindCloudFrontIsTrue`, `LogGroupName: !Ref ReadLambdaLogGroup`, pattern `'"INGRESS_UNVERIFIED"'`, namespace `${Prefix}-${ProjectId}/Ingress`, `UnverifiedRequestCount`, value `'1'`, default `0`; no alarm) after the Discovery filter. Both roles use inline `Policies` (not managed policies), so the statements are inline with the file's `!If`/`AWS::NoValue` pattern.
**Docs.** `docs/admin-ops/deployment/cloudformation-parameters.md`: new "Origin Protection Parameters" section (before "Deployment Parameters") for `ApiIsBehindCloudFront` with the rollout order, the effect, the secret name, the `v0.2.0` requirement, the metric, and the rollback; category list renumbered.
**Tests.** New `read-function/tests/unit/architecture/origin-secret-template.test.js` (17 cases S1-S5, P1-P3, V1-V3, I1-I3, M1-M3, own tag-preserving CFN schema so `!If`/`!Ref` stay visible). Red before the template change: 12 failed, 5 passed (S3, S4, V3, I3, M3 pass vacuously on an unchanged template: they assert absence). Green after: 17 passed; whole `tests/unit/architecture` directory 10 suites, 72 tests passed. No stray jest processes before or after. ESLint on the new file clean after `--fix` (curly).
  - Test fix made while going green: S4 first failed because the parameter description names the secret (`Prefix-ProjectId-StageId-OriginSecret`). A name in prose is fine, a Ref/GetAtt/Sub reference or `resolve:secretsmanager` is not, so S4/S5 now match references only (`"OriginSecret"`, `"OriginSecret.`, `${OriginSecret}`).
**Offline SAM translation** (throwaway venv, aws-sam-translator 1.116.0, CodeUri/ContentUri stubbed, OpenAPI body and the Resources-level dashboard `AWS::Include` inlined; baseline = copy of `template.yml` saved before the change). The translator keeps `Fn::If` and resource `Condition` unresolved, so its raw output is identical for both flag values; the comparison below evaluates the one condition as CloudFormation would.
| | Baseline | Flag `false` | Flag `true` |
|---|---|---|---|
| Resources | 59 | 60 | 61 |
| Added | | `OriginSecret` | `OriginSecret`, `IngressUnverifiedMetricFilter` |
| Removed | | none | none |
| Lambda permissions | 8 | 8, ids and bodies identical | 8, ids and bodies identical |
| Other resource changes | | none | env `CACHE_DATA_INGRESS_SECRET_NAME: {Ref: OriginSecret}` on both functions; last statement `{Sid: OriginSecretRead, Action: secretsmanager:GetSecretValue, Effect: Allow, Resource: {Ref: OriginSecret}}` in both roles |
| Template-level | | Parameter `ApiIsBehindCloudFront`, Condition `ApiIsBehindCloudFrontIsTrue` | same |
The venv and script under `/tmp/t142` were deleted.
**Requirements not satisfied as written / decisions.**
1. Requirement 5.10 says that with the flag `false` the change set "SHALL create the secret and change the two functions' roles". With the conditional inline statements the roles do not change at all with the flag `false` (the statement is dropped by `AWS::NoValue`). This is stricter (least privilege, one fewer change) and matches the task's expected result. Requirement 5.10 should read "create the secret and change nothing else". Not edited.
2. `DeletionPolicy` / `UpdateReplacePolicy`: Requirement 5.6 says "deleted with the stack", so none is set (CloudFormation default Delete). A secret deleted by a stack deletion is scheduled for deletion with a 30-day recovery window by default in Secrets Manager; recreating a stack with the same name inside that window can fail with "already scheduled for deletion". Noted for operators, not handled in the template.
3. Tags: Requirement 5.6 asks for the stack's standard tags. The template sets no per-resource `Tags` on its other resources of this kind (log groups, metric filters); stack-level tags from the pipeline's `template-configuration.json` propagate to the secret on their own. No `Tags` property added.
4. Requirement 9 and design B4 name the Read function's log group only, so no Auth-function filter was added. The Auth function's `INGRESS_UNVERIFIED` lines are not counted.
5. The `ApiIsBehindCloudFront` description repeats the rollout order (Requirement 5.7 asks for it); it is long for a parameter description (about 700 characters; the CloudFormation limit is 4000).
**Open for later tasks.** 14.3 guard tests need `secret-not-primed` / `secret-unavailable` as `401` cases (already noted). 14.5 docs: the admin-ops page `ingress-and-client-address.md` and `DEPLOYMENT.md` still need the Part B secret/flag text; the changelog entries are 14.5. Task 14.6 confirms the plain-string header on `test`.

## Task 14.3 result (2026-11-12): the guard in the Read and Auth functions
**Code.** New `read-function/utils/ingress-guard.js` and an identical copy `auth-function/utils/ingress-guard.js` (duplicated on purpose; no shared source between functions). Exports `isIngressGuardOn(env = process.env)` (true when `CACHE_DATA_INGRESS_SECRET_NAME` is a non-empty string after trim), `shouldRefuse(clientRequest, env)` (guard off => false and `isIngressVerified()` is never called; guard on => refuse unless `isIngressVerified() === true`; a missing method, a throw, or a non-boolean counts as unverified), `buildRefusal(response)` (`setStatusCode(401)`, `addHeader('Cache-Control','no-store')`, `setBody({ message: 'Requests must use the service endpoint.' })`, `return response.finalize()`), and the constants `INGRESS_SECRET_ENV_NAME`, `REFUSAL_STATUS_CODE`, `REFUSAL_MESSAGE`. The `>!` comments (Requirement 6.10) are in the helper (why 401, why no-store, one implementation in cache-data) and in each handler (why it runs first). The environment is read per request, not at module load. No TestHarness: the helper has no private internals.
- `read-function/index.js`: `IngressGuard.shouldRefuse(clientRequest)` right after `new Response(clientRequest)`, before `AuthResolver.resolveAuth`; header JSDoc step "2a" added.
- `auth-function/index.js`: same block inside the `event.httpMethod && event.path` branch, after `new Response(clientRequest)`, before `Routes.process`; header comment updated. The `event.triggerSource` branch is untouched and returns earlier.
**Checked against real cache-data** (pinned `d9cc35d`, installed): with the variable set and nothing primed, a real `ClientRequest` is unverified, and the refusal through a real `Response.finalize()` is `401`, `Content-Type: application/json`, `Cache-Control: no-store` (cache-data keeps an application-set value and adds no `max-age`), `Access-Control-Allow-Origin: *`, body `{"message":"Requests must use the service endpoint."}`, plus the `Expires` and `x-exec-ms` headers it always adds. Nothing from the request (header value, address) or the secret name is in the response. With the variable unset the real request reports `direct`, `isIngressVerified()` is `false`, and `shouldRefuse` is `false`.
**Tests written first (red), then green.** New files:
- `read-function/tests/unit/utils/ingress-guard.test.js` (22): `isIngressGuardOn` table (name, ARN, padded, unset, empty, blank, non-string, null env, default `process.env`), `shouldRefuse` (flag off never consults cache-data; verified; unverified; fails closed for `{}`/null/throwing/non-boolean), a fast-check property over (flag on, verified) with `numRuns: 50` (refusal iff on and not verified), `buildRefusal` (calls, 401 not 403/404, message content, only one header and no `max-age`), and the real-cache-data cases above.
- `read-function/tests/unit/lambda/read-handler-ingress-guard.test.js` (12): flag off (unset, empty, blank; `isIngressVerified` not called, request processed even when cache-data says false); on and verified (processed); on and unverified (401 + `no-store` + body; `resolveAuth`, `checkRateLimit`, `createRateLimitResponse`, `Routes.process` not called; only header is `Cache-Control`; statuses are exactly `[401]`; no header value, secret name, address, or ARN in what is written to the Response; `getProps` never called, so the application does not read the header; `Config.prime()` runs before the check); property (`numRuns: 20`) over the same two booleans through the handler. `secret-not-primed` / `secret-unavailable` / mismatch / missing header all reach the handler as `isIngressVerified() === false`, so they share the unverified cases; the real-cache-data test in the helper file shows `secret-not-primed` for real.
- `auth-function/tests/unit/ingress-guard.test.js` (22): the same helper tests (copy, path of the event changed).
- `auth-function/tests/unit/handler-ingress-guard.test.js` (26): flag off (3), on and verified (1), on and unverified for five method/path pairs (GET profile, POST key/regenerate, POST voucher/redeem, OPTIONS, unknown route), no `Routes.process`, only `no-store`, 401 never 403/404, no leak, `prime` before check, header not read; Cognito triggers with the variable set and `isIngressVerified` false: `PostConfirmation_ConfirmSignUp` delegated as today (and its rejection still propagates, not turned into a 401), six other trigger sources (`PostConfirmation_ConfirmForgotPassword`, `PreSignUp_SignUp`, `PreSignUp_AdminCreateUser`, `CustomMessage_ForgotPassword`, `TokenGeneration_Authentication`, `SomeFutureTrigger_Unlisted`) echoed by reference and unmodified with no `statusCode`, trigger events never construct `ClientRequest`/`Response` or consult `isIngressVerified`, and a property (`numRuns: 50`) over (flag, verified, random trigger source); property (`numRuns: 20`) for API Gateway events.
- **Red** (run directly, `NODE_ENV=test npx jest --silent <4 files>`): RF helper suite failed to load (`Cannot find module '../../../utils/ingress-guard'`); RF handler file 8 failed / 4 passed (the passing 4 assert absence: flag off x3 and the no-leak check, which pass vacuously before the guard exists); AF helper suite failed to load; AF handler file 12 failed / 14 passed (the 14 are flag-off, the Cognito cases, and the no-leak/other absence checks). Failures were the missing module and the guard not being called, not test errors.
- **Green** after the helpers and the two handler blocks: RF 3 files (helper, new handler, existing `read-handler.test.js`) 57 passed; AF 3 files (helper, new handler, existing `handler-event-dispatch.test.js`) 66 passed.
**Full suites** (`NODE_ENV=test timeout 900s npx jest --silent`, one after the other, no stray jest processes before or after): Read **2355 passed**, 115 skipped, 6 suites skipped (194 of 200 suites passed); expected 2321 + 34 new = 2355. Auth **559 passed**, 45 suites; expected 511 + 48 new = 559. No regressions.
**Lint.** `npx eslint` on the two helpers: clean (2-space indent like `client-address.js`; optional `catch {` to avoid an unused variable). The four new test files are tab-indented like the surrounding tests, so only `indent` errors remain (the repo's existing style); `brace-style`/`curly` fixed with `--fix --rule 'indent: off'`. `index.js` in each function reports indent/quote/trailing-space errors that were already there (Read had 28 errors before and after; none on the added lines); `no-console` and an unused variable in the Auth `index.js` are also old.
**Deviations / notes.**
1. None from the design or Requirement 6. The refusal body is the plain `{ message }` object of the design, not the JSON-RPC shape used for the invalid-key `401` in `auth-resolver`; it matches the verifier expectation in design B3 (401, JSON content type, object with a string `message`).
2. The refusal passes through `response.finalize()`, so it also carries cache-data's `Expires` (= now, from `no-store`) and `x-exec-ms`. It carries no `X-MCP-Version` or rate-limit header, because the guard runs before them. The Read function's other early return (`authInfo.errorResponse`, rate-limit 429) does not go through `finalize()`; the guard follows the design and uses `finalize()` so CORS is applied (Requirement 6.4).
3. The Read test mock for `ClientRequest` in the existing `read-handler.test.js` has no `isIngressVerified`; it needed no change because those tests run with the variable unset and the guard never calls it then. `shouldRefuse` also fails closed when the method is missing and the variable is set.
4. During the lint baseline check I ran `git stash` / `git stash pop` once in the Read function directory to count old lint errors; everything was restored (`git status` shows the same modified files, `git stash list` is empty).
5. The template, verifier, and docs were not touched (tasks 14.4 and 14.5). Not committed.
**Open for later tasks.** 14.4: the fake server's `401` body must match `{ message: 'Requests must use the service endpoint.' }` and `no-store`. 14.5: docs should say the Auth function's refused requests include `OPTIONS` that reach the Lambda (API Gateway answers the CORS preflight without a Lambda, Requirement 6.9) and that the guard's `401` has no rate-limit headers. 14.6: confirm on `test` with the real header.

### Task 14.4 result (verifier, fake server, and their tests)

**Contract between the Wrapper and the Verifier.** Two new environment variables. `MCP_ORIGIN_PROTECTION` (`true` or `false`, the stack's `ApiIsBehindCloudFront`; lower-cased on read) and `MCP_ORIGIN_SECRET` (the value of `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-OriginSecret`). Protection is on when the flag is `true`; off when it is `false` (a secret that is also present is not sent); when the flag is unset (a local run) a non-empty secret turns it on. `isOriginProtectionOn(config)` decides, and is exported.

**`verify-deployment.js`.**
- Constants `ORIGIN_SECRET_HEADER` (`X-Atlantis-Origin-Secret`), `ORIGIN_REJECTION_STATUS` (401), `ORIGIN_PROTECTION_OFF_REASON` (`origin protection is off for this stage (ApiIsBehindCloudFront is false)`), all restated in the Verifier and imported from nothing. `NEVER_SENT_HEADERS` is unchanged (`x-forwarded-for`, `cookie`): it lists headers refused whatever a spec says, and the origin header is deliberately sent to one target, so it does not belong there. Where the header is added is `ctx.send`: raw target only, never edge, unless the spec has `omitOriginSecret` (only the `O1` request).
- Catalog 47 to 48 (37/10 to 38/10): `O1.1` (core) after `M1.1`; `CHECK_ORDER` has `O1` after `M1` and before `T1`; builder `O1` (keyless `tools/list`, `apiKey: null`, `omitOriginSecret: true`); `checkO1` with `judgeOriginRejection` (HTTP 401 via the gate, `application/json`, body an object with a string `message`; the wording of `message` is not read) and `originStatusHint` (HTTP 200 with a result: `the request was served without proof of origin`; 403/404: the guard must answer 401 because the distribution rewrites those two). Skipped with the stated reason when protection is off.
- `readInputs` gains `originProtection` and `originSecret`; `validateConfig` adds two problems (a flag that is neither true nor false; flag `true` with no secret, which never falls back to sending no header). Both secrets are on the redaction list from the first line (`createRunState`) and in `createContext`.
- JSDoc counts updated (47/37 to 48/38; check order; `CatalogRequestSpec.omitOriginSecret`; module `@example` for a protected local run). No other number in the file named 47, 37, or 10. The request budget is not stated anywhere in `verify-deployment.js` or `05-verify-deployment.sh`; it lives in `budget-tests.jest.mjs` and the docs (task 14.5): counted POSTs stay 21 without an edge target and 24 with one, because `O1.1` is refused before the rate limiter. Each run sends one more POST (a 401), like `S1`.

**Deviation / addition not in the requirements (needs the owner's eye).** `computeOutcome` treated every core `skip` as `inconclusive` (exit 1). With protection off (every stage until `ApiIsBehindCloudFront` is turned on, including the current pipeline), `O1.1` is a core skip, so every PostDeploy run would have ended `inconclusive` and failed. Requirement 7.3 says skip and does not say what the outcome is. `computeOutcome` now ignores a core skip whose `reason` is exactly `ORIGIN_PROTECTION_OFF_REASON` (it is not listed in `skippedCore` and does not change the outcome); any other core skip, HTTP 429 included, still gives `inconclusive`. The report format is unchanged, but `counts.core.skipped` includes that skip (37 passed, 0 failed, 1 skipped on an unprotected stage), so on an unprotected stage `counts.core.skipped` is one more than `skippedCore.length`. Alternative if the owner prefers: make the skip advisory-like by another mechanism; I did not find one that leaves the report format alone.

**`05-verify-deployment.sh`.** New functions before step 1: `read_secret_string` (like `read_ssm_parameter`: stderr to a temp file, only the AWS error code kept, value never printed, `None` or empty counts as `empty`) and `read_origin_protection` (stack `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application`, as `01-export-api-spec.sh` derives it; `aws cloudformation describe-stacks --query` for `ApiIsBehindCloudFront`). Called after the targets step when PREFIX, PROJECT_ID, and STAGE_ID are set. Outcomes: `false`, `None`, or empty (an older stack with no such parameter) is protection off and no secret is read; `true` reads `aws secretsmanager get-secret-value --secret-id ...-OriginSecret --query 'SecretString' --output text`; any other value, or a failed `describe-stacks`, is a `config_error` (reported through `VERIFY_CONFIG_ERROR`, the run ends `error`, exit 1); a denied or empty secret is a `config_error` that names the secret, the AWS error code, `secretsmanager:GetSecretValue`, `PostDeploySvcRoleIncludeManagedPolicyArns` on the pipeline stack, and `retry the PostDeploy stage`. The flag and secret reach the Verifier only as `MCP_ORIGIN_PROTECTION="${origin_protection}" MCP_ORIGIN_SECRET="${origin_secret}"` in the existing `exec node` environment (added as its own line above `VERIFY_CONFIG_ERROR`, so the existing structural test still holds). The log shows `Origin protection: true|false` and never the secret. No new permission is needed while the flag is false (`describe-stacks` is already used by script 01). `bash -n` clean; `shellcheck` is not installed here, so it was not run. The skip switch is decided before any of this, so a skipped run reads nothing.

**Fake server (`helpers/fake-mcp-server.mjs`).** New exports `FAKE_ORIGIN_SECRET` (48 letters and digits, joined at run time), `ORIGIN_SECRET_HEADER`, `ORIGIN_GUARD_MESSAGE`. Option `originSecret` turns the guard on: a POST to the raw target without the exact value gets 401, `Cache-Control: no-store`, `application/json`, `{"message":"Requests must use the service endpoint."}`, before authentication and the rate limiter, and the recorded call gets `guarded: true`. The edge target, the preflight, and the 405 answer are not guarded. Option `originGuardFault` (only for the unprotected request; requests with the right header are served as usual): `open` (served, 200), `non-json` (401 `text/plain`), `forbidden` (403 JSON), plus two more: `no-message` (401 JSON without `message`) and `landing-page` (200 HTML, a 401 rewritten by the distribution). Nothing is imported from the Read Function. The guard's 401 is not an MCP response (no `jsonrpc`, `error`, or `id`); the schema conformance file is unchanged and still passes, and a new fake-server test pins that the body is exactly `{ message }`.

**Tests.** New `origin-protection-tests.jest.mjs` (37): catalog and order, the header on raw and not on edge (and not on the one `O1.1` request), pass, five faults each failing only `O1.1` with the documented reason, the 200-with-result wording, wording of `message` not asserted, not counted by the limiter, skip with both settings and not inconclusive, wrapper config error, flag `true` without a secret, bad flag value, a guard that rejects the Verifier's own header (other checks fail, `O1.1` passes), redaction (including a body quoting the echoed secret and a fast-check property with 20 runs), the inputs, `NEVER_SENT_HEADERS` text and behavior, dependency-free requires. New `wrapper-origin-protection-tests.jest.mjs` (16): structure of the Wrapper, and the two readers cut out and run in a child `bash` with a stub `aws` first on the PATH (`execFileSync` with an argument list; the stub logs calls; no network). Changed: `outcome-and-report-tests` (pinned `EXPECTED_SUB_CHECK_IDS` with `O1.1` after `M1.1`, 48/38/10, counts, a protected-stage summary test), `checks-tests` (`runStage` is protected by default so every healthy run passes 48 of 48; an unprotected-stage test; four `O1.1` rows in the failing-fault table; 48-way coverage; calls that must carry a key now skip the guard-refused one; the `tools/list` count 10 to 11), `budget-tests` (counted POSTs stay 21 and 24 on a protected stage, `O1.1` is not counted, an exactly-21 public limit is enough, order with `O1` between `M1` and `T1`), `inputs-tests` (two new fields), `fake-mcp-server-tests` (guard and faults, 17 tests added).

**Red / green.** Red: after the fake server and `origin-protection-tests` were written, before the Verifier changes: `origin-protection-tests` 30 failed, 7 passed (the 7 were the tests that only need the fake server or already-true behavior). Wrapper tests, run against the unchanged `05-verify-deployment.sh` from `HEAD` (swapped in and restored, `diff` clean, still mode 755): 15 failed, 1 passed. Green: `origin-protection-tests` 37 passed. First full run after the Verifier change: 17 failed in 3 suites (counts and the pinned list, as expected); fixed the tests; final whole package (`cd application-infrastructure/tests/postdeploy-verify && timeout 600s node --experimental-vm-modules ./node_modules/jest/bin/jest.js --silent`, the same command `npm test` runs): **16 suites, 952 tests passed** (before: 14 suites, 869 tests; the two new suites add 53 and the changed ones the rest). No stray jest processes before or after.

**Not done / for 14.5 and 14.6.** Docs and changelog (the developer and operator verification pages state 47/37 and the request budget; `ARCHITECTURE.md`, `DEPLOYMENT.md`, the changelog entry for 13.1) are untouched. `cloudwatch-insights-queries.json` was not changed (the report format is the same). The PostDeploy role still needs `secretsmanager:GetSecretValue` on the secret and, if `describe-stacks` was not already allowed, nothing new. The new env contract and the `inconclusive` exception above should be written into `docs/developer/post-deploy-verification.md`. Not committed.

## Task 14.5 result (documentation and changelog for Part B)

**CHANGELOG.md** (`[v0.0.7] (unreleased)`), compared against a copy saved before the edit: additive except two lines, as agreed.
- Added: `### Breaking Changes` entry "Origin protection: a request to the raw `execute-api` URL without the origin secret is refused with HTTP 401, once a stage turns it on" (after the existing Auth-function entry, no migration guide, no deprecation window); `### Added` entry "API origin protection (Part B)" (before "Schema conformance tests and release preparation") with 10 sub-bullets: secret, parameter and environment variable and permission, the guard, Auth function scope, metric filter, verifier (`O1.1`, `MCP_ORIGIN_PROTECTION`, `MCP_ORIGIN_SECRET`, the off-skip rule, unreadable secret ends `error`), requirements (network template v0.2.0 and the PostDeploy permission), rollout and rollback, rotation caveat, documentation.
- Edited in place (c): the Post-Deploy Smoke Verification sub-bullet "47 sub-checks, 37 core and 10 advisory" is now "48 sub-checks, 38 core and 10 advisory". Nothing else in that entry changed. The "about 25 read-only requests" is left as it was: from the budget tests a protected stage with no edge target sends 25 requests (21 counted POSTs, S1, O1.1, one preflight, one GET), an unprotected one 24, and the figure was already approximate (it is higher with an edge target), so it is still true.
- Edited in place (d): the existing `@63klabs/cache-data` Dependencies bullet now names the pinned commit `d9cc35d` ("still the 1.4.1 code, which also includes the ingress verification"). The `.npmrc` sub-bullet is untouched.
- Not changed: the "Two new post-deploy verifier sub-checks, M1.1 and X2.5 ... for 47 in total (37 core, 10 advisory)" line in the Fixed entry of the GET-405 spec. It describes the catalog at the time of that fix, and the owner's permission covered the Post-Deploy Smoke Verification entry only. Owner decision if it should read 48/38.
- No Security, Changed, or Fixed entry was added; the verifier outcome rule is in the Added entry.

**Docs**
- `docs/admin-ops/ingress-and-client-address.md`: the "Planned hardening" section is replaced by "Origin protection" (secret and header, what the functions do, who can read the secret, rollout order, rollback, rotating the secret with the `put-secret-value` / wait about 65 minutes / `ApiOriginSecretRevision` / remove `AWSPREVIOUS` order, the metric and its reasons, verification and the PostDeploy permission). Overview and the "edge-optimized behind your own CloudFront" wording adjusted.
- `docs/developer/client-address.md`: new "The origin guard" (the helper, why duplicated, where it runs, cache-data names, fail-closed cases, tests); dependency paragraph names `d9cc35d`.
- `docs/developer/post-deploy-verification.md`: 48/38/10, O1 row, check order, new variables, outcome rule for the off-skip, new "Origin protection (O1)" section (Wrapper decisions, what is sent, local run, tests).
- `docs/admin-ops/post-deploy-verification.md`: 48/38/10, O1 row, order, log example with `Origin protection: true`, the off-skip and outcome rule, budget notes (O1.1 not counted), secrets note, new "Origin protection" section (permission, failure table).
- `ARCHITECTURE.md`: the "planned" sentence replaced with a "Verified ingress (origin protection)" subsection. `DEPLOYMENT.md`: new "Origin protection rollout" section, pinned commit `d9cc35d`, a verification bullet for the permission.
- `docs/admin-ops/deployment/cloudformation-parameters.md` (from 14.2) read and found consistent; not edited.
- Stale counts: searched `docs`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, `README.md`, and the post-deploy scripts for 47 and 37; the only sub-check counts were in the two verification pages (fixed). `docs/admin-ops/deployment/README.md` has an unrelated `[47]` in a log-stream example.

**Checks.** A throwaway script (deleted) compared fences, language tags, H1 count, heading levels, and relative links and anchors of every touched file with `HEAD`: no new issue in any docs page or `DEPLOYMENT.md`. `ARCHITECTURE.md` still has its untagged fences from before (line numbers shifted). `CHANGELOG.md` spec links resolve from `.kiro/` not from the root, as for every existing entry.

**Not verified / for the owner**
1. "Anyone with `cloudfront:GetDistributionConfig` can read the secret" and the network template's behavior (v0.2.0, `ApiOriginProtection`, `ApiOriginSecretRevision`, header name) come from CROSS-RESOURCE-PLAN.md and the 14.1 notes, not from the network template, which is not in this repository.
2. The 30-day recovery window of a deleted secret is Secrets Manager behavior from 14.2 note 2, not checked here.
3. The `update-secret-version-stage` / `list-secret-version-ids` commands and the rotation sequence were not run.
4. `outcome-and-report-tests.jest.mjs` line 8 still has a comment that says "the fixed list of the 47 sub-check IDs" (test file, not edited here).
5. The shell wrapper was not run against AWS (no shellcheck); the "FAIL on many sub-checks with 401 after a mismatch" row in the operator guide follows from the guard design and the fake-server test, not a real stage.
Not committed.

## Task 14.6 preparation (Part B working tree check and read-only AWS checks)

Nothing was deployed and no request was sent to any stage. Base: HEAD `70d12a6` (`spec: ... part A complete`, on `dev`, `main`, `origin/dev`, `origin/main`). Part B is uncommitted. Account numbers are masked as `<ACCT>`.

### A. Working tree verification

**A1. Test suites** (run directly with the jest binary, one after another; no jest process before or after each run):

| Suite | Result | Expected | Match |
| --- | --- | --- | --- |
| Read function (`NODE_ENV=test npx jest --silent`) | 2355 passed, 115 skipped; 194 of 200 suites passed, 6 skipped | 2355 / 115 | yes |
| Auth function | 559 passed, 45 of 45 suites | 559 | yes |
| `tests/postdeploy-verify` | 952 passed, 16 of 16 suites | 16 suites / 952 | yes |
| Static site (`src/static`) | 268 passed, 13 of 13 suites | 13 / 268 | yes |

`naming-validation-property.test.js` passed in the Read run; no rerun was needed.

**A2. Lint** (`npm run lint`):

| Package | Baseline (1.1) | After 9.1 | Now | Change vs 9.1 |
| --- | --- | --- | --- | --- |
| Read function | 7318 | 7487 | 7868 (7866 errors, 2 warnings) | +381, all `indent` (6814 to 7195) |
| Auth function | 8697 | 8697 | 9129 | +432, all `indent` (8594 to 9026) |

Per-rule counts now. Read: `indent` 7195, `no-trailing-spaces` 399, `no-unused-vars` 90, `brace-style` 60, `curly` 51, `quotes` 44, `no-multiple-empty-lines` 16, `prefer-const` 5, `eol-last` 2, `semi` 2, `import/no-dynamic-require` 2, `null` 2. Auth: `indent` 9026, `brace-style` 66, `no-unused-vars` 21, `no-multiple-empty-lines` 4, `prefer-const` 5, `eqeqeq` 5, `no-console` 2. Every rule other than `indent` is equal to or below the baseline in both packages. The `indent` increase comes from the new tab-indented test files, as predicted (same cause and same owner decision as the 9.1 note: leave, or reindent; the 0-0-8 `lint-indent-and-code-style` item covers it).

Changed or new non-test files, linted one by one:
- Read `utils/ingress-guard.js`: clean (0). Auth `utils/ingress-guard.js`: clean (0).
- Read `index.js`: 28 problems at HEAD and now (`indent` 9, `no-trailing-spaces` 8, `brace-style` 6, `quotes` 5); no new problem from the guard lines.
- Auth `index.js`: 69 at HEAD (`indent` 66, `no-console` 2, `no-unused-vars` 1), 82 now. **+13 `indent` errors**: the 13 new guard lines (comment block and the `if`) in the API Gateway branch are tab-indented like the surrounding code in that file, and the rule wants 2 spaces. No other rule changed. This is the only non-test source change that adds lint errors; it follows the file's existing style.
- `INFRA/postdeploy-scripts/verify-deployment.js` and `INFRA/tests/postdeploy-verify` have no ESLint config (none in `INFRA` or the VT directory), so ESLint does not cover them. `node --check verify-deployment.js` passes.

**A3. Shell.** `bash -n postdeploy-scripts/05-verify-deployment.sh`: OK. `shellcheck` is still not installed, so the script has not been linted by it.

**A4. Secrets and addresses scan.** Scanned all 4199 added lines of the diff against HEAD (excluding lockfiles, scanned separately: 6 lines) plus the 9 untracked files. Results:
- No AWS key ids (`AKIA`/`ASIA`), JWTs, GitHub or `sk-` tokens, or private key headers.
- No 12-digit number other than `123456789012` (the AWS documentation example account) in two test fixtures (`arn:aws:secretsmanager:us-east-1:123456789012:secret:x-AbCdEf`, one in each function's `ingress-guard.test.js`).
- IPv4: `203.0.113.77` (RFC 5737 TEST-NET-3, 8 uses) and one `1.2.3.4` (a fake spoofed `X-Forwarded-For` value in a verifier test, `tests/postdeploy-verify`, not an address of anything real; replace with `198.51.100.x` if the owner wants strict RFC 5737). No IPv6.
- Secret-like literals are test placeholders only: `origin-secret-value`, `a-secret-value`, `abcdefghijkl`, `a-different-secret-the-verifier-does-not-hold`. Secret and resource names use `acme-mcp-*` or the `Prefix-ProjectId-StageId` pattern.
- Long strings are the cache-data commit hashes (`d9cc35da22c024bb433a8774bf2a7ba13df09811` new, `386c2f97...` old; public commits), the lockfile `sha512` integrity value, file paths, and Kiro execution and chat session UUIDs in `tasks.meta.json`.
- Result: clean.

**A5. `git status`** (28 modified, 9 untracked, nothing staged, nothing outside the expected set):

| Group | Files |
| --- | --- |
| Template | `application-infrastructure/template.yml` (+94) |
| Read function | `index.js` (+17); new `utils/ingress-guard.js`; new tests `tests/unit/utils/ingress-guard.test.js`, `tests/unit/lambda/read-handler-ingress-guard.test.js`, `tests/unit/architecture/origin-secret-template.test.js`; `package.json`, `package-lock.json` (cache-data pin `386c2f9` to `d9cc35d`, 1 line each plus lock entries) |
| Auth function | `index.js` (+19, -2 lines changed in the header comment); new `utils/ingress-guard.js`; new tests `tests/unit/ingress-guard.test.js`, `tests/unit/handler-ingress-guard.test.js`; `package.json`, `package-lock.json` (same pin) |
| Verifier tests | modified `budget-tests`, `checks-tests`, `fake-mcp-server-tests`, `inputs-tests`, `outcome-and-report-tests` (all `.jest.mjs`), `helpers/fake-mcp-server.mjs`; new `origin-protection-tests.jest.mjs`, `wrapper-origin-protection-tests.jest.mjs` |
| Post-deploy scripts | `05-verify-deployment.sh` (+67), `verify-deployment.js` (+243 -) |
| Docs | `docs/admin-ops/deployment/cloudformation-parameters.md`, `docs/admin-ops/ingress-and-client-address.md`, `docs/admin-ops/post-deploy-verification.md`, `docs/developer/client-address.md`, `docs/developer/post-deploy-verification.md` |
| Top-level docs | `CHANGELOG.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md` |
| Spec folder | `WORKING-NOTES.md`, `design.md`, `requirements.md`, `tasks.md`, `tasks.meta.json` |

Unexpected files: none. `TODO.md`, `.npmrc` files, other functions, and other test folders are untouched. (`tasks.meta.json` and `design.md`/`requirements.md` changes are spec bookkeeping from 14.1 to 14.5.)

### B. Read-only AWS checks (profile `release`, `us-east-2`)

**B1. Permissions.** `iam:SimulatePrincipalPolicy` is **not allowed** for the SSO role in use (`AWSReservedSSO_PowerUserAccess`, AccessDenied on all three roles), so no simulation could be run. The `iam:Get*`/`List*` reads are allowed, so the roles' policies were read (inline and attached) and evaluated by hand. None of the three roles has a permissions boundary. Organization SCPs and the KMS key policy cannot be seen from here and were not evaluated.

Roles found:
- PostDeploy CodeBuild project `prod63k-atlantis-mcp-test-PostDeploy` runs as `role/sam-apps/prod63k-Worker-atlantis-mcp-test-PostDeployServiceRole`.
- Test application CloudFormation service role (pipeline deploy): `role/sam-apps/prod63k-Worker-atlantis-mcp-test-CloudFormationSvcRole` (inline `CloudFormationRolePolicy` plus the managed `RELEASE63K-ProjectPipeline-CognitoCrud`).
- Network stack service role (all three network stacks): `role/sam-svc/PROD63K-CloudFormation-Service-Role-Network-Full-Mgmt` (managed `PROD63K-CfnSvcRole-Network-CloudFront-Mgmt` and `-Route53-Mgmt`).

Test ARN pattern: `arn:aws:secretsmanager:us-east-2:<ACCT>:secret:prod63k-atlantis-mcp-test-OriginSecret-AbCdEf`.

| Role | Action | Resource | Result (by reading the policy) |
| --- | --- | --- | --- |
| PostDeploy | `secretsmanager:GetSecretValue` | the ARN | **implicitDeny**: the 11 statements cover logs, artifacts, SSM, S3, CloudFormation read, API Gateway read; nothing for Secrets Manager. `PostDeploySvcRoleIncludeManagedPolicyArns` is empty on the test, beta, and prod pipeline stacks |
| App CloudFormation role | `CreateSecret`, `UpdateSecret`, `DeleteSecret`, `PutSecretValue`, `DescribeSecret`, `TagResource` (and `UntagResource`) | the ARN | **allowed** (statement `SecretsManagerCRUDThisDeploymentOnly`, resource `arn:aws:secretsmanager:us-east-2:<ACCT>:secret:prod63k-atlantis-mcp-test-*`, no condition) |
| App CloudFormation role | `secretsmanager:GetRandomPassword` | `*` | **allowed** (statement `SecretsManagerGetRandomPassword`) |
| App CloudFormation role | `secretsmanager:GetSecretValue` | the ARN | implicitDeny (not needed to create the secret; the function roles read it at run time) |
| Network stack role | `secretsmanager:GetSecretValue` | the ARN | **allowed** (statement `SecretsManagerOriginSecretRead`, resource `arn:aws:secretsmanager:us-east-2:<ACCT>:secret:prod63k-*-OriginSecret-??????`; the six-character suffix pattern matches `AbCdEf`) |

The Cognito deny statement in `RELEASE63K-ProjectPipeline-CognitoCrud` is limited to four `cognito-idp:` actions and does not affect Secrets Manager. KMS: the template uses no `KmsKeyId`, so the secret uses the AWS managed key `aws/secretsmanager`; no KMS permission statement was needed in the policies, but that is not verified against the key policy.

**Gap for task 14.6 (S4):** the PostDeploy role cannot read the origin secret. Before the verifier can use it on a stage whose flag is `true` (and before `05-verify-deployment.sh` can read the secret), a managed policy allowing `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:us-east-2:<ACCT>:secret:<Prefix>-atlantis-mcp-<stage>-OriginSecret-??????` must exist and be added through `PostDeploySvcRoleIncludeManagedPolicyArns` on that stage's pipeline stack (an owner action, per the Atlantis rules; no policy was created here). If it is missing, the wrapper's secret read fails and the run ends `error` (design B5). The app CloudFormation role needs nothing new. No `OriginSecret` secret exists yet in any stage (`list-secrets` by name returned nothing for test, beta, and prod).

**B2. Test network stack `prod63k-atlantis-mcp-test-network`** (status `UPDATE_COMPLETE`, last updated 2026-11-09):
- Template: **already v0.2.0**. Tag `atlantis:TemplateVersion` = `v0.2.0/2026-11-09 8de849`; tag `atlantis:TemplateFile` = `s3://63klabz/atlantis/templates/v2/network/template-network-route53-cloudfront-s3-apigw.yml`, `atlantis:TemplateFileVersion` = S3 version id `GAdxNwWyk3p9hr0tS_wxLb4EbbMc791H`. The stack's template contains `ApiOriginProtection`, `ApiOriginSecretRevision`, the condition `UseApiOriginProtection`, and the origin custom header `X-Atlantis-Origin-Secret` with value `{{resolve:secretsmanager:${Prefix}-${ProjectId}-${StageId}-OriginSecret}}`.
- Parameters: `ApiOriginProtection` = `false`, `ApiOriginSecretRevision` = (empty), `ApiGatewayId` = `nj1sciuyka`, `PathApi` = `mcp`, `DomainForApiGateway` = (empty), `ApiOriginPath` = (empty), `CustomSubdomainApiGateway`, `DomainForCloudFront`, `CustomSubdomainCloudFront` all empty (CloudFront default domain `d16wymzfzyj9xi.cloudfront.net`), `StageId` = `test`, `DeployEnvironment` = `TEST`. A template rule requires `ApiGatewayId` to be set when the flag is `true`; it is set.
- Published template: the S3 object (52847 bytes, last modified 2026-11-09, version id above) has the same MD5 (`a45abe419a070f231ed9411ea2b9b015`) as `/tmp/tpl-check/templates/v2/network/template-network-route53-cloudfront-s3-apigw.yml` (clone of the template repo at `864802a`, header `Version: v0.2.0/2026-11-09`). The deployed stack uses the current published v0.2.0.
- So on **test no template update is needed**: setting `ApiOriginProtection=true` is a parameter change only. The secret must exist first (otherwise the dynamic reference fails and the stack update rolls back).
- Beta and prod network stacks are still on **v0.1.0** (`v0.1.0/2026-09-26 eaa687`) and have no `ApiOriginProtection` or `ApiOriginSecretRevision` parameter (beta `ApiGatewayId` `i17st3itv0`, prod `gy3gpv7n1k`, `PathApi` `mcp` on both). They need a template update to v0.2.0 (flag `false`) before their flag can be set. All three stacks share the network service role above, which already has the `SecretsManagerOriginSecretRead` statement (its pattern covers `prod63k-*-OriginSecret-??????`).

### C. Findings for the owner
1. PostDeploy role has no Secrets Manager access on any stage; a managed policy and `PostDeploySvcRoleIncludeManagedPolicyArns` are needed per stage before the flag is turned on (affects the S4 spike and the first protected PostDeploy run).
2. `iam:SimulatePrincipalPolicy` is denied to the SSO role; the matrix above is by reading the policies (no SCP or KMS key policy evaluation).
3. Test network stack is already v0.2.0 with the flag off; beta and prod are v0.1.0 and need the template update first.
4. Lint: Auth `index.js` gains 13 `indent` errors from the guard lines (tabs), and the totals are above the 9.1 numbers only through `indent`. Unchanged decision: leave or reindent.
5. `shellcheck` is not installed; `1.2.3.4` in one verifier test is the only non-RFC 5737 IP in the added lines.
Not committed. No code, `tasks.md`, or AWS resource was changed.

## Task 14.6 (test stage rollout results)

Run 2026-11-12, 19:17 UTC, against the `test` stage only (nothing sent to beta or prod). AWS reads only (`--profile release --region us-east-2`), account masked as `<ACCT>`. `get-secret-value` was never called. No caller address, secret value, or any part of it is recorded here. Not committed; no code or `tasks.md` change.

### 1. State of the stack
| Item | Observed |
| --- | --- |
| `prod63k-atlantis-mcp-test-application` | `UPDATE_COMPLETE` (2026-11-12 19:09:42Z), `ApiIsBehindCloudFront` = `true` |
| `prod63k-atlantis-mcp-test-network` | `UPDATE_COMPLETE` (2026-11-12 19:00:48Z), `ApiOriginProtection` = `true`, `ApiOriginSecretRevision` = (empty) |
| `CACHE_DATA_INGRESS_SECRET_NAME`, ReadFunction, unqualified | set: `arn:aws:secretsmanager:us-east-2:<ACCT>:secret:prod63k-atlantis-mcp-test-OriginSecret-<6-char suffix>` |
| same, ReadFunction `live` alias (version 216) | set, same ARN |
| same, AuthFunction, unqualified | set, same ARN |
| AuthFunction `live` alias | none exists (`list-aliases` is empty), so there is nothing to check; only the Read function has the alias in this template |

### 2. Tags (ABAC) and where the secret could leak
- Secret `prod63k-atlantis-mcp-test-OriginSecret`: `KmsKeyId` null (AWS managed key `aws/secretsmanager`), `RotationEnabled` null, version stages: one version, `AWSCURRENT` only (no `AWSPREVIOUS`, as expected for a never-rotated secret).
- **`atlantis:ApplicationDeploymentId` = `prod63k-atlantis-mcp-test`: present.** CloudFormation stack-tag propagation to the secret worked, so the ABAC condition matches the PostDeploy role's principal tag.
- Tag keys (21): `aws:cloudformation:stack-name`, `aws:cloudformation:stack-id`, `aws:cloudformation:logical-id`, `Owner`, `atlantis:Application`, `Provisioner`, `AlarmNotificationEmail`, `Creator`, `Atlantis`, `atlantis:ApplicationDeploymentId`, `Name`, `RepositoryBranch`, `Project`, `Department`, `Repository`, `CostCenter`, `atlantis:Prefix`, `Environment`, `Stage`, `DeployedUsing`, `Application`.
- Stack outputs (names only). Application: `CloudWatchReadLambdaExecutionLogGroup`, `ParameterStore`, `ApiEndpoint`, `ReadLambdaWebConsole`, `CloudWatchApiGatewayExecutionLogGroup`, `CloudWatchApiGatewayAccessLogGroup`. Network: `S3Origin`, `CustomURLForApi`, `CloudFrontDistributionId`, `CloudFrontLoggingMode`, `ApiGatewayOrigin`, `CloudFrontDomain`, `CustomURLForStatic`. None is named for the secret, and no output was printed with its value (Requirement 6.6: the value is not an output).

### 3. Requests (6 sent of a budget of 8; all as expected)
| # | Request | Expected | Observed |
| --- | --- | --- | --- |
| a | RAW `POST tools/list`, no extra header | 401, JSON, `no-store`, message body | **401**, `content-type: application/json`, `cache-control: no-store`, body `{"message":"Requests must use the service endpoint."}`; no `X-RateLimit-*` headers |
| b | CDN `POST tools/list` | 200 and `X-RateLimit-Remaining` | **200**, `X-RateLimit-Limit: 50`, `X-RateLimit-Remaining: 49`, `cache-control: max-age=3600`, `x-cache: Miss from cloudfront`, JSON body (33562 bytes) |
| c | RAW `POST` with `X-Atlantis-Origin-Secret: not-the-secret` | 401 | **401**, same headers and body as (a) |
| d | RAW `GET` | 405, `Allow: POST` | **405**, `allow: POST`, `cache-control: no-store`, JSON body `{"message": "Method not allowed. This endpoint accepts POST only."}` (mock, guard not involved) |
| e | RAW `OPTIONS` preflight (Origin `https://example.com`, request headers `content-type,mcp-protocol-version,x-api-key`) | 2xx, as before | **200**, `access-control-allow-origin: *`, `-methods: POST,OPTIONS`, `-max-age: 86400`, `-headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Mcp-Protocol-Version,Mcp-Method,Mcp-Name` |
| f | CDN `POST server/discover`, `MCP-Protocol-Version: 2026-07-28` | 200 JSON-RPC result | **200**, `X-RateLimit-Remaining: 48`, result with `supportedVersions` `["2024-11-05","2025-11-25","2026-07-28"]`, `capabilities`, `instructions` |

Findings from the table:
- **Requirement 14.9 is shown on `test`:** the raw URL without the secret gets `401` (a) and with a wrong secret `401` (c); the CloudFront domain is served (b, f).
- **S4 gap closed: the plain-string secret form works end to end.** The distribution sends the secret through the `{{resolve:secretsmanager:...}}` dynamic reference, and cache-data (reading the secret as a plain string via the extension) accepted the header: (b) and (f) were verified and counted by the rate limiter.
- The guard `401` runs before the rate limiter. Remaining went 49 after (b) and 48 after (f), so (a), (c) did not consume allowance, as designed (Requirement 6.9).
- The preflight (e) and the `405` (d) are answered by API Gateway and are unchanged.

### 4. Logs and metric (Read function log group `/aws/lambda/prod63k-atlantis-mcp-test-ReadFunction`, last 15 minutes)
- `INGRESS_UNVERIFIED` lines in the window: 3.
  - 19:11:56Z `{"reason":"missing-header"}` (the PostDeploy O1.1 probe)
  - 19:17:26Z `{"reason":"missing-header"}` (request a)
  - 19:17:36Z `{"reason":"mismatch"}` (request c)
  - Each line is only the tag and the reason code. No header value, secret, or address appears in them. The INFO line carries the request id as its second tab field, as for every Lambda log line.
- **Finding (secret in the Lambda log): the header name appears only in DEBUG `EVENT RECEIVED` lines** (27 lines in the window: 24 from the PostDeploy run at 19:11, 3 from my requests at 19:17; the 19:17 ones are (b), (c), (f)). No other line type (`RESPONSE`, `INGRESS_UNVERIFIED`, others) contains the header name. In every one of those lines the header value is **masked** by the platform's debug logger: asterisks plus the last four characters of the value (shown as `******xxxx`), for the real secret and for the wrong test value alike. It is **not in clear**, but the last four characters of the 48-character secret are logged at DEBUG on `test`. Decision for the owner: the leak is 4 of 48 characters, only at DEBUG (the `test` log level), and the logger's masking comes from cache-data; whether to ask for full masking of `x-atlantis-origin-secret` is open. The same lines also contain the forwarded client address headers (existing behavior at DEBUG, not recorded here).
- Auth function log group: no events in the window (no request was sent to an Auth route), so nothing to report there.
- Metric `UnverifiedRequestCount`, namespace `prod63k-atlantis-mcp/Ingress` (no dimensions): Sum over the last hour = **3.0** (1.0 in the 19:08 to 19:13 bucket, 2.0 in the 19:13 to 19:18 bucket). It matches the three log lines above and is greater than zero after (a) and (c).

### 5. PostDeploy (latest `test` build, `prod63k-atlantis-mcp-test-PostDeploy:5f983209-...`)
- Status `SUCCEEDED`; 19:11:18Z to 19:11:56Z (about 38 s: PROVISIONING 3 s, INSTALL 2 s, PRE_BUILD 18 s, BUILD 12 s). The verifier itself took 3465 ms.
- `[05-verify-deployment] INFO: Core: 38 passed, 0 failed, 0 skipped. Advisory: 5 passed, 0 warned, 5 skipped`, `Outcome: passed`. 43 passed plus 5 skipped (X2.1 to X2.5, no custom domain) = **48 sub-checks, 38 core, 10 advisory**, as expected.
- `VERIFY_REPORT` line: `outcome` `passed`, `exitCode` 0, `expectedVersion` `0.0.7`, empty `failedCore`/`skippedCore`/`warnings`, stage `prod63k`/`atlantis-mcp`/`test`.
- `PASS  O1.1   a request without the origin secret header is rejected with HTTP 401 and a JSON body`.
- Secret in the build log: a case-insensitive search for `secret`, `x-atlantis`, `secretsmanager`, and `ApiIsBehindCloudFront` finds only the O1.1 title, the `secret-redaction-property-tests` suite name, and nothing else. No secret name, ARN, or value is printed by the wrapper or the verifier. (The value itself was not searched for.)

### 6. S4 spike: deploy-role permission facts
- Managed policy attached to the PostDeploy role `sam-apps/prod63k-Worker-atlantis-mcp-test-PostDeployServiceRole` (the only attached policy): `RELEASE63K-ManagedPolicyForPipeline-SecretsReadDeployment` (path `sam-apps/`, account `<ACCT>`).
- Its single statement `SecretsReadDeploymentReadSecretTagMatch` allows `secretsmanager:GetSecretValue` and `secretsmanager:DescribeSecret` on `arn:aws:secretsmanager:*:<ACCT>:secret:*` with the condition `aws:ResourceTag/atlantis:ApplicationDeploymentId` equals `${aws:PrincipalTag/atlantis:ApplicationDeploymentId}` and both tags present (`Null` = `false`). This is an ABAC policy, not a name pattern; it depends on the secret carrying the stack tag (section 2: it does) and on the role carrying the same tag.
- O1.1 passing proves the wrapper read the secret (it is the only way the verifier knew whether to run O1.1 and which header to withhold), so the policy, the tag, and the key access (`aws/secretsmanager`, no extra KMS statement needed) work together on `test`.
- Not verified here: the same on beta and prod (their network stacks are still v0.1.0, see the 14.6 preparation section), and the role's tag value (not read).

### 7. Spike S7: the `401` through the real stack
Confirmed on `test`: the raw `execute-api` URL without the secret (and with a wrong one) answers `401` with a JSON `message` and `no-store`, not `403` or `404`, so the distribution's rewrite to the landing page would not apply to it. This was the S7 open point ("the `401` seen through the real stack").

### Left for the remaining stages of 14.6
`beta` and `main` are untouched: their network stacks need the v0.2.0 template update (flag `false`) first, each stage needs the managed policy on its pipeline stack, and the rollout order (application flag `false`, network `ApiOriginProtection=true`, application flag `true`) applies per stage. The 4-character DEBUG log finding above should be decided before `beta`.

## Task 14.6 preparation for beta and prod

Read-only (`--profile release --region us-east-2`). Nothing was changed, no request was sent to any stage, `get-secret-value` was never called. Account masked as `<ACCT>`; no secret value or secret ARN suffix is recorded. `test` is the reference.

### Facts per stage

| Item | test (reference) | beta | prod |
| --- | --- | --- | --- |
| Pipeline stack last update | 2026-11-12 18:48Z | 2026-08-31 18:52Z | 2026-08-31 19:10Z |
| Pipeline `atlantis:TemplateVersion` (stack tag, and the same tag on the CloudFormation and PostDeploy roles) | `v2.0.24/2026-11-09 0e2a2a` | `v2.0.23/2026-08-15 0ab90d` | `v2.0.23/2026-08-15 0ab90d` |
| Pipeline `atlantis:TemplateFile` | `s3://63klabz/atlantis/templates/v2/pipeline/template-pipeline.yml` | same | same |
| Published pipeline template in S3 | version id equals test's (`.xsoJNaAK...`): **v2.0.24 is current** | needs update | needs update |
| `CloudFormationSvcRoleIncludeManagedPolicyArns` | `RELEASE63K-ProjectPipeline-CognitoCrud` | same | same |
| `PostDeploySvcRoleIncludeManagedPolicyArns` | `RELEASE63K-ManagedPolicyForPipeline-SecretsReadDeployment` | **empty** | **empty** |
| CloudFormation role, inline `CloudFormationRolePolicy` | 30 statements incl. `SecretsManagerCRUDThisDeploymentOnly` and `SecretsManagerGetRandomPassword` | 28 statements, **no Secrets Manager statement** | 28 statements, **no Secrets Manager statement** |
| CloudFormation role, attached | CognitoCrud | CognitoCrud (no Secrets Manager text in it) | same |
| PostDeploy role, attached | SecretsReadDeployment | **none** | **none** |
| PostDeploy role tag `atlantis:ApplicationDeploymentId` | `prod63k-atlantis-mcp-test` | `prod63k-atlantis-mcp-beta` | `prod63k-atlantis-mcp-prod` |
| Permissions boundary on both roles | none | none | none |
| Network stack last update / status | 2026-11-12 19:00Z, `UPDATE_COMPLETE` | 2026-09-27 03:02Z, `UPDATE_COMPLETE` | 2026-09-27 03:15Z, `UPDATE_COMPLETE` |
| Network `atlantis:TemplateVersion` | `v0.2.0/2026-11-09 8de849` | `v0.1.0/2026-09-26 eaa687` | `v0.1.0/2026-09-26 eaa687` |
| Network `atlantis:TemplateFile` | `s3://63klabz/atlantis/templates/v2/network/template-network-route53-cloudfront-s3-apigw.yml` | same | same |
| `ApiOriginProtection` / `ApiOriginSecretRevision` params | `true` / empty | **absent** | **absent** |
| `ApiGatewayId` / `PathApi` | `nj1sciuyka` / `mcp` | `i17st3itv0` / `mcp` | `gy3gpv7n1k` / `mcp` |
| `DomainForApiGateway` | empty | empty | empty |
| Distribution alias | none (default CloudFront domain `d16wymzfzyj9xi.cloudfront.net`) | `mcp-beta.atlantis.63klabs.net` (id `E17NYIDF8EMVG8`) | `mcp.atlantis.63klabs.net` (id `E3RAOR5OWPIYP4`) |
| Distribution API origin custom header names | `X-Atlantis-Origin-Secret` | none | none |
| Viewer certificate minimum protocol | `TLSv1` (default certificate) | `TLSv1` (custom ACM cert, SNI) | `TLSv1` (custom ACM cert, SNI) |
| `CloudFrontLoggingVersion` | `v2` | `v1` | `v1` |
| Network stack CloudFormation role | `PROD63K-CloudFormation-Service-Role-Network-Full-Mgmt` (shared by all three) | same | same |
| Network role `SecretsManagerOriginSecretRead` (`GetSecretValue` on `arn:aws:secretsmanager:us-east-2:<ACCT>:secret:prod63k-*-OriginSecret-??????`), in managed policy `PROD63K-CfnSvcRole-Network-CloudFront-Mgmt` (updated 2026-11-09 23:14Z) | present | present (same role) | present (same role) |
| Published network template in S3 | version id `GAdxNwWy...`, MD5 `a45abe41...`, header `v0.2.0/2026-11-09`: **v0.2.0 is current** | needs update | needs update |
| App stack last update | 2026-11-12 19:09Z | 2026-11-12 01:12Z | 2026-11-12 03:13Z |
| App `ApiIsBehindCloudFront` | `true` | **absent** (Part B not deployed) | **absent** |
| Read function `CACHE_DATA_INGRESS_SECRET_NAME` | set | absent | absent |
| `CACHE_DATA_TRUSTED_PROXY_HOPS` (Read and Auth) | `0` | `0` (Part A is deployed) | `0` |
| Read function alias `live` | version 216 | version 62 | version 55 |
| `OriginSecret` exists (by name listing) | yes | **no** | **no** |
| Read `LOG_LEVEL` | `DEBUG` | `INFO` | `INFO` |
| App stack tag `atlantis:ApplicationDeploymentId` | present | `prod63k-atlantis-mcp-beta` | `prod63k-atlantis-mcp-prod` |

Shared policy `RELEASE63K-ManagedPolicyForPipeline-SecretsReadDeployment` (path `sam-apps/`, one attachment today, the test PostDeploy role): one ABAC statement, `secretsmanager:GetSecretValue` and `DescribeSecret` on `arn:aws:secretsmanager:*:<ACCT>:secret:*` when the secret's `atlantis:ApplicationDeploymentId` tag equals the caller's principal tag (both tags required). It is generic, so the same policy serves beta and prod with no new policy. The sibling policies `...SecretsReadPrefix` and `...SecretsReadApplication` also exist (0 attachments).

### Hand evaluation of the CloudFormation role (beta and prod)

The inline policy has no statement with a `secretsmanager:` action, no `secretsmanager:*`, and no `*` action; the one attached managed policy (CognitoCrud) has no `secretsmanager` text. So `CreateSecret`, `UpdateSecret`, `DeleteSecret`, `PutSecretValue`, `DescribeSecret`, `TagResource`, `UntagResource` on `arn:aws:secretsmanager:us-east-2:<ACCT>:secret:prod63k-atlantis-mcp-<stage>-*` and `GetRandomPassword` on `*` are all implicit deny. An application deploy that creates the `OriginSecret` would fail (rollback) until the pipeline stack is updated to v2.0.24. Pipeline v2.0.23 to v2.0.24 has no added or removed parameters, resources, or outputs (checked on the template bodies); the change is in resource properties (the policy statements), which I did not diff line by line.

Not seen: organization SCPs, the `aws/secretsmanager` key policy, and `iam:SimulatePrincipalPolicy` (denied), so the evaluation is by reading the policies.

### Differences from the test result

1. **Network update changes the viewer minimum TLS on beta and prod.** v0.2.0 adds `ViewerMinimumTlsVersion` (default `TLSv1.2_2021`) and applies it only when the distribution has a custom domain and ACM certificate, which beta and prod have. Their distributions are on `TLSv1` today. On test it had no effect (default CloudFront certificate). Updating with defaults stops clients that cannot negotiate TLS 1.2 from connecting to `mcp-beta.atlantis.63klabs.net` and `mcp.atlantis.63klabs.net`. To keep today's behavior set `ViewerMinimumTlsVersion=TLSv1` on the update; this is an owner decision and is not an origin-protection requirement.
2. The same update marks the four `CloudFrontApi/StaticFunctionOriginRequest/Response` parameters as deprecated and ignored; all four are empty on beta and prod, so no effect. `CloudFrontLoggingVersion` stays `v1` (default `v1`), unlike test (`v2`), so logging does not change.
3. Beta and prod have custom domains. The test stage used the default CloudFront domain, so the CloudFront-side check (header through the alias, `X2.*` advisory checks) runs for the first time on a custom domain. The raw `execute-api` target is still what O1.1 probes.
4. The test finding "4 characters of the secret logged at DEBUG" does not occur on beta or prod while `LOG_LEVEL` is `INFO` (the header only appears in DEBUG `EVENT RECEIVED` lines). It would if someone raised the level.
5. PROD gradual deployment (`Linear10PercentEvery3Minutes`, about 30 min) applies to the Read function on both application deploys (flag `false`, then `true`); `test` was immediate. Two versions answer API traffic during a shift; both are compatible (flag `false` adds only a secret and the guard code, which is a no-op without `CACHE_DATA_INGRESS_SECRET_NAME`).
6. Nothing else differs: Part A (`CACHE_DATA_TRUSTED_PROXY_HOPS=0`, Regional API) is already on both.

### Order of operations per stage (beta first, then prod; each fully done and checked before the next)

| Step | Action | Needed before | beta | prod |
| --- | --- | --- | --- | --- |
| 1 | Update the pipeline stack to template v2.0.24 and set `PostDeploySvcRoleIncludeManagedPolicyArns` to the `...SecretsReadDeployment` policy (keep CognitoCrud in `CloudFormationSvcRoleIncludeManagedPolicyArns`). Both in one update | step 3 (CloudFormation role must be able to create the secret); step 5 (PostDeploy must read it) | missing | missing |
| 2 | Update the network stack to v0.2.0 with `ApiOriginProtection=false`; decide `ViewerMinimumTlsVersion` (see difference 1) | step 4 | missing | missing |
| 3 | Deploy the application with `ApiIsBehindCloudFront=false` (merge the Part B commit through `dev`, `test`, `beta`, `main`; flag is `false` by default). Creates `OriginSecret`; Read and Auth get no ingress variable and no secret permission. Confirm the secret exists (names only) and the stack tag is on it | step 4 | missing (Part B is uncommitted, not deployed) | missing |
| 4 | Set the network stack to `ApiOriginProtection=true` (dynamic reference needs the secret from step 3, otherwise the update rolls back; `ApiGatewayId` is set, so the template rule is satisfied). Wait for the distribution to be `Deployed` | step 5 | after 1 to 3 | after 1 to 3 |
| 5 | Set the application `ApiIsBehindCloudFront=true` and deploy. PostDeploy runs O1.1 with the secret | none | after 4 | after 4 |
| 6 | Check as on test: raw URL without the secret gives `401`, the alias gives `200` (one request per case), PostDeploy `Outcome: passed` with 48 sub-checks, metric `UnverifiedRequestCount` counts the raw `401`s | next stage | after 5 | after 5 |

Step 1 and step 2 are independent of each other and of the application code, so they can be done for beta and prod ahead of the code promotion. Steps 1 to 3 do not change client-visible behavior except the TLS item in step 2. Rollback is the reverse order (flag `false`, then network `ApiOriginProtection=false`).

### Status summary

| Stage | Pipeline v2.0.24 | Managed policy on PostDeploy | CFN role Secrets statements | Network v0.2.0 | Secret exists | Part B deployed | Ready for flag `true` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| beta | missing | missing | missing | missing | no | no | no |
| prod | missing | missing | missing | missing | no | no | no |

Unknown for both: SCP and key policy effects; whether a pipeline execution is in progress (not read); the line-by-line content of the v2.0.24 pipeline change beyond the Secrets Manager statements seen on test.
Not committed. No code, `tasks.md`, or AWS resource was changed.
