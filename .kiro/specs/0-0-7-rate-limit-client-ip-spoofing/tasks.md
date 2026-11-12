# Implementation Plan: Clients can choose their public rate-limit bucket

## Overview

This plan implements the changes described in [design.md](design.md) so that a keyless client's rate-limit bucket depends only on information the client cannot write. It follows the design's implementation order in three phases:

1. **Phase 1: Part A, build.** `WebApi` becomes Regional and `CACHE_DATA_TRUSTED_PROXY_HOPS` becomes `0` in one change. The address module, the call sites, the tests, the dependency, the documentation, and the changelog. Test-first.
2. **Phase 2: Part A, rollout.** Gates G1 to G6 on `test`, `beta`, and `main`; the registry switch; the release. These tasks need a pipeline deploy, requests to the stages, and in one case a host with IPv6. The owner performs them, or asks an agent to run the requests of tasks 11 and 12 on the Test stage.
3. **Phase 3: Part B, hardening.** The origin secret, the flag, the guard, the verifier sub-check, and the metric filter. **Not started.** It waits for the three preconditions in [requirements.md](requirements.md) and does not gate the release.

Paths are relative to the repository root. `INFRA` means `application-infrastructure`, `RF` means `INFRA/src/lambda/read-function`, `AF` means `INFRA/src/lambda/auth-function`, and `VT` means `INFRA/tests/postdeploy-verify`.

Run tests with a timeout, from the directory shown, calling Jest directly. If `node_modules` is missing, run `npm ci --include=dev` there first. Check for stray test processes before and after a run (`ps aux | grep -E "(jest)" | grep -v grep`) and do not run a test that executes `npm test` or `npm run` (`.kiro/steering/test-execution-monitoring.md`).

```bash
cd application-infrastructure/src/lambda/read-function
timeout 300s npx jest tests/unit/architecture tests/unit/utils tests/property
timeout 900s npx jest && npm run lint
cd application-infrastructure/src/lambda/auth-function
timeout 300s npx jest && npm run lint
```

`npm run lint` fails with indentation errors on the unchanged tree (thousands in each Lambda package). Take a count before the change and compare after; do not expect zero.

Do not commit unless the owner asks. Do not edit `ISSUE.md`, the other spec folders' `tasks.md` or `requirements.md`, the skipped integration suites (`tests/unit/lambda/rate-limiting.test.js`, `tests/integration/rate-limiting-integration.test.js`), a CloudFront distribution, or an upstream Atlantis template. Do not create or edit GitHub issues, advisories, or comments. Do not send traffic to `beta` or `prod`, and ask before sending any to `test`.

## Tasks

- [x] 1. Baseline (Phase 1)
  - [x] 1.1 Record test and lint baselines on the unchanged tree
    - Run both suites and `npm run lint` in `RF` and `AF`. Keep the pass, skip, and failure counts and the lint error counts in the working notes. The known seed-dependent failure in `RF/tests/unit/utils/naming-validation-property.test.js` (S3 pattern 3, resource name `an`) may appear; rerun it and note that it is unrelated
    - _Requirements: 10.8, 14.1_
  - [x] 1.2 Record the baseline offline SAM translation
    - Follow Design, V-C against the **unchanged** `INFRA/template.yml` with `INFRA/template-openapi-spec.yml` inline: a throwaway virtualenv under `/tmp`, a script in `/tmp` that stubs every `CodeUri` and `ContentUri`, translates, and writes the resource list and the Lambda permissions to a file under `/tmp`. Keep the script for task 6.3. Expected: 59 resources and 8 Lambda permissions (measured 2026-11-09)
    - _Requirements: 5.4, 14.2_
  - [x] 1.3 Record the dependency baseline
    - In a scratch copy of each function directory, confirm that `npm ci --omit=dev` **fails** with `EALLOWGIT` (the current `package.json` has the git URL and no `.npmrc`; the lockfile pins `f746cde…`) and that the same command with `--allow-git=root` succeeds. Keep the output
    - _Requirements: 4.2, 4.3_

- [x] 2. Write the failing tests (Phase 1, red)
  - [x] 2.1 Add the address module tests
    - Create `RF/tests/unit/utils/client-address.test.js` with one `it` per row of the table in Design, Components 2 (26 cases: IPv4; mapped IPv6 in three spellings; IPv6 in several spellings of one /64; a different /64; `::1`, `::`, `2001:db8::`; and the invalid inputs `not-an-ip`, `''`, `' '`, `null`, `undefined`, `42`, `{}`, `[]`, a port suffix, bracketed IPv6, a zone id, `1.2.3`, `256.1.1.1`, a comma list). Create `RF/tests/property/client-address.property.test.js` with the four properties of Requirement 2.8 (`numRuns` 1000 or less; no child processes). The module does not exist yet, so they fail on import
    - _Requirements: 2.2 to 2.6, 2.8, 10.7_
  - [x] 2.2 Add the spoofing property test
    - Create `RF/tests/property/client-identity-spoofing.property.test.js` as in Design, Components 7. Set `CACHE_DATA_TRUSTED_PROXY_HOPS` to `'0'` in `beforeAll` and restore the original in `afterAll`. Use the **real** `ClientRequest` from `@63klabs/cache-data` and the generators described there. Assert the three properties (headers have no effect; different `sourceIp` give different keys; the same `sourceIp` gives one key)
    - _Requirements: 1.5, 10.1, 10.6_
  - [x] 2.3 Add the architecture and source-scan tests
    - Create `RF/tests/unit/architecture/endpoint-and-client-address.test.js` and `RF/tests/unit/architecture/no-forwarding-header-parsing.test.js` as in Design, Components 6. CommonJS, `'use strict'`, `js-yaml` with a CloudFormation tag schema (copy the helper from `openapi-integration-targets.test.js`), `>!` comments, JSDoc on each helper, read files only
    - _Requirements: 1.2, 5.1, 5.2, 10.7_
  - [x] 2.4 Add the rate-limiter and resolver cases to the existing suites
    - In `RF/tests/unit/utils/rate-limiter.test.js` add: `authInfo.identity` of `null` gives `allowed: false` with the rate-limit headers and `Retry-After`, and writes no counter (no `createInDynamo` or `decrementInDynamo` call). In `RF/tests/unit/utils/auth-resolver.test.js` add: `resolveAuth(event)` with no second argument returns `identity: null` on the no-key path and on each of the three degraded paths. Do not yet change the other cases in these files (task 5)
    - _Requirements: 3.2, 10.4_
  - [x] 2.5 Run the new tests against the unchanged code and confirm they fail for the right reason
    - Run only the files from 2.1 to 2.4. Expected: 2.1 fails on the missing module; 2.2 fails because `resolveAuth` ignores a second argument and returns the first forwarded entry; `endpoint-and-client-address` fails because `WebApi` has no endpoint configuration and the count is unset; `no-forwarding-header-parsing` fails naming `auth-resolver.js` and `rate-limiter.js`; the two new cases of 2.4 fail
    - If anything unrelated fails, fix the test before continuing. Keep the failing output in the working notes
    - _Requirements: 10.1, 10.4_

- [x] 3. The address module (Phase 1, green)
  - [x] 3.1 Create the module
    - Create `RF/utils/client-address.js`: `toBucketKey` and the private `expandIpv6`, as in Design, Components 2, with JSDoc (`@param`, `@returns`, `@example`), `>!` comments on the zone-id refusal, the mapped-address rule, and the /64 rule, and a `TestHarness` with `getInternals()` returning `expandIpv6` and the length limit. Export `toBucketKey` and `TestHarness`. No dependency beyond Node's `net`
    - _Requirements: 2.1 to 2.7_
  - [x] 3.2 Run the tests of task 2.1
    - Expected: all pass. If a case from the table fails, fix the module, not the table; the table was verified against a prototype on 2026-11-09
    - _Requirements: 2.8_

- [x] 4. Remove the first-entry rule (Phase 1, green)
  - [x] 4.1 Change the auth resolver
    - In `RF/utils/auth-resolver.js`: delete `extractSourceIp` (JSDoc and function, lines 125 to 144), its `TestHarness` entry (line 487), and its mention in the `@returns` at line 472. Change `resolveAuth(event)` to `resolveAuth(event, clientAddress)`, compute `publicIdentity = toBucketKey(clientAddress)` first, and use it in the four public results (lines 352, 367, 378, 413). Require `./client-address`. Update the JSDoc and the examples
    - _Requirements: 1.1 to 1.4, 1.6_
  - [x] 4.2 Change the rate limiter
    - In `RF/utils/rate-limiter.js`: replace the `rawId` fallback (lines 394 to 399) with `authInfo && authInfo.identity ? authInfo.identity : null`; extract the existing fail-closed return (lines 413 to 428) into a private helper `failClosed(limitPerWindow, resetTimeMs, resetTimeSec)`; call it first for a null identity (log `Rate limiter: no usable client identity — failing closed`, no address) and then for the missing salt. Update the JSDoc of `checkRateLimit` (event no longer read for identity). Leave `hashClientIdentifier` and the table code untouched
    - _Requirements: 1.2, 3.1 to 3.5_
  - [x] 4.3 Change the handler
    - In `RF/index.js`, line 133: `AuthResolver.resolveAuth(event, clientRequest.getClientIp())` with the `>!` comment from the design. Do not change the `checkRateLimit` call at line 143
    - _Requirements: 1.1, 1.7_
  - [x] 4.4 Confirm the Auth function needs no change
    - Search `AF` for the first-entry rule and for any read of a forwarding header (`grep -rn -i -E "x-forwarded|cloudfront-viewer-address|sourceIp" AF --include=*.js --exclude-dir=node_modules --exclude-dir=tests`). Expected: none (the Cognito handler reads `CloudFront-Viewer-Country` from client metadata, which is a different field). Record the result. The Auth function's only change in Part A is the count in the template (task 6)
    - _Requirements: 1.2, 15.4_

- [x] 5. Update the existing tests (Phase 1)
  - [x] 5.1 Delete the two v0.0.1 property suites
    - Delete `RF/tests/unit/utils/rate-limiter-ip-resolution-bug.property.test.js` and `RF/tests/unit/utils/rate-limiter-ip-resolution-preservation.property.test.js`. Their invariants live in task 2.2. Confirm no other test imports them
    - _Requirements: 10.1_
  - [x] 5.2 Update the resolver tests
    - `RF/tests/unit/utils/auth-resolver.test.js`: the five tests that assert a public identity (lines 90, 175, and the three others in the file; use `grep -n "result.identity"`) call `resolveAuth(event, event.requestContext.identity.sourceIp)`; remove the `TestHarness` case that names `extractSourceIp`; correct the descriptions and comments that say "first entry". `RF/tests/property/auth-resolver-preservation.property.test.js` (line 65) and `RF/tests/property/auth-resolver.property.test.js` (lines 250, 316, 336): pass the generated address as the second argument; the identity assertions use `toBucketKey(address)`
    - _Requirements: 10.2_
  - [x] 5.3 Update the rate-limiter tests
    - `RF/tests/unit/utils/rate-limiter.test.js` (10 two-argument calls) and `RF/tests/unit/utils/rate-limiter-property.test.js` (4, at lines 342, 449, 540, 619): add a local helper `publicAuth(sourceIp)` returning `{ tier: 'public', identity: toBucketKey(sourceIp), isAuthenticated: false }` and pass it as the third argument. `RF/tests/property/tier-rate-limiting.property.test.js` already passes `authInfo`; correct any comment that names the first entry. Do not edit `RF/tests/unit/lambda/rate-limiting.test.js`
    - _Requirements: 10.2_
  - [x] 5.4 Update the handler test and the helper
    - `RF/tests/unit/lambda/read-handler.test.js`: add `getClientIp: jest.fn().mockReturnValue('192.168.1.1')` to the `ClientRequest` mock instance and assert `resolveAuth` is called with `(event, '192.168.1.1')`. `RF/tests/integration/test-helpers.js` (line 57): keep `sourceIp` in the request context and set `X-Forwarded-For` to a different address, so a test that reads the header picks the wrong bucket. Do not revive the skipped suites
    - _Requirements: 10.2, 10.3_
  - [x] 5.5 Run the Read suite
    - Run the whole suite in `RF`; expected: every case from task 2 now passes except the two architecture tests that need the template (task 6.2), and nothing else regresses. Compare skipped and failure counts with task 1.1
    - _Requirements: 10.8_

- [x] 6. The template (Phase 1, green)
  - [x] 6.1 Add the endpoint type and the count
    - In `INFRA/template.yml`: `EndpointConfiguration: { Type: REGIONAL }` on `WebApi` (line 656) with the `>!` comment from the design; `CACHE_DATA_TRUSTED_PROXY_HOPS: '0'` with its `>!` comment in the Read function's `Environment.Variables` (beside line 888) and the Auth function's (beside line 1157). Change nothing else in the file
    - _Requirements: 5.1, 5.3, 5.5_
  - [x] 6.2 Run the architecture tests
    - Run the two tests of task 2.3; expected: pass. Then temporarily set the count to `'2'` in a copy of the template (not the real file) and confirm `endpoint-and-client-address` fails, and remove `EndpointConfiguration` in a copy and confirm it fails; do not commit those copies
    - _Requirements: 5.2_
  - [x] 6.3 Run the offline translation of the changed file
    - Rerun the script from task 1.2 on the changed `template.yml`. Expected (measured 2026-11-09 on the same change): 59 resources before and after; none added, removed, or replaced; 8 Lambda permissions identical; the OpenAPI body identical; `WebApi` gains `EndpointConfiguration: { Types: [REGIONAL] }` and `Parameters: { endpointConfigurationTypes: REGIONAL }`; `ReadLambdaFunction` and `AuthLambdaFunction` gain the count. Keep the output. Delete the virtualenv and the script afterwards
    - _Requirements: 5.4, 14.2_

- [x] 7. The dependency (Phase 1)
  - [x] 7.1 Pin the commit and add `.npmrc`
    - In `RF/package.json` and `AF/package.json` change the cache-data dependency from `#main` to `#f746cdeea10e9e14e7782cd70f00db81ff9a55cb` (or a newer commit the owner chooses). Run `npm install --include=dev --allow-git=root` in each directory so the lockfile is rewritten consistently. Create `RF/.npmrc` and `AF/.npmrc` containing `allow-git=root` with the `>!` comment from the design. Confirm the `.gitignore` does not exclude `.npmrc`
    - _Requirements: 4.1, 4.2_
  - [x] 7.2 Run the scratch installs
    - Follow Design, Components 8 for each directory in a copy under `/tmp`, **without** passing `--allow-git` (the `.npmrc` must be enough): `npm ci --omit=dev`, then `npm install --omit=dev`. Expected: both succeed and the lockfile still records the pinned commit. Keep the output
    - _Requirements: 4.3_
  - [x] 7.3 Run both suites
    - Run the whole suite in `RF` and `AF`. Expected: the counts of task 1.1, with the new tests added, and nothing else changed
    - _Requirements: 4.7, 10.8_
  - [x] 7.4 Add the release check to TODO.md
    - Append one unchecked line to the v0.0.7 release checklist in `TODO.md`, in its existing format: switch both `package.json` files to `^1.4.1`, delete both `.npmrc` files, regenerate the lockfiles, rerun both suites. `TODO.md` has uncommitted changes of the owner; append only, and do not reformat
    - _Requirements: 4.4, 4.5_

- [x] 8. Documentation and changelog (Phase 1)
  - [x] 8.1 Correct the stale documentation
    - `docs/admin-ops/deployment/cloudformation-parameters.md` (line 201 and the `PublicRateLimit` section): the Read function enforces the limit; the real setting is `MCP_PUBLIC_RATE_LIMIT`, default 50 (`RF/config/settings.js:690`). `docs/admin-ops/deployment/README.md` (line 237): default 50. `README.md` (lines 104 to 111): "hpur" to "hour". Open `INFRA/src/static/public/docs/rate-limits/index.html` line 64 and change it only if it would mislead
    - _Requirements: 12.1, 12.6_
  - [x] 8.2 Write the new pages
    - Create `docs/admin-ops/ingress-and-client-address.md` and `docs/developer/client-address.md` as described in Design, Components 9. Include the measured `sourceIp` table and the statement that AWS describes the Regional behavior in support material rather than the API Gateway documentation. No secret, no real address, no identifiers, no reproduction steps. Follow `.kiro/steering/documentation-standards-markdown.md`
    - _Requirements: 12.2, 12.3, 12.7_
  - [x] 8.3 Update `ARCHITECTURE.md` and `DEPLOYMENT.md`
    - A short section on the Regional endpoint and the identity rule in `ARCHITECTURE.md`; the git dependency and `.npmrc` until the registry switch in `DEPLOYMENT.md`
    - _Requirements: 12.5_
  - [x] 8.4 Write the changelog entries
    - Add the `Security` and `Changed` entries of Design, Components 9 under `[v0.0.7] (unreleased)`, linked to this spec, in the formatting of the neighbouring entries. Leave the affected range marked "to be confirmed". Change no other existing text. Do not call for an advisory
    - _Requirements: 13.2, 13.3, 13.4, 13.6_
  - [x] 8.5 Check the links and fences
    - Open each new or changed page and confirm relative links resolve, every code fence names a language, and no heading level is skipped
    - _Requirements: 12.7_

- [x] 9. Verify the whole change before it is committed (Phase 1)
  - [x] 9.1 Run everything
    - Run both suites and `npm run lint` in `RF` and `AF`; compare the lint counts with task 1.1 (equal or lower). Run `cd INFRA/src/static && timeout 300s npm test` (the static site must be unaffected). Check for stray test processes
    - _Requirements: 10.8, 14.1_
  - [x] 9.2 Review the diff
    - `git status` and `git diff --stat`. Expected files: `RF/utils/client-address.js` (new), `RF/utils/auth-resolver.js`, `RF/utils/rate-limiter.js`, `RF/index.js`, `INFRA/template.yml`, both `package.json` and `package-lock.json`, both `.npmrc`, the tests of tasks 2 and 5, the documents of task 8, `TODO.md`, `CHANGELOG.md`. Nothing in `AF` apart from the dependency files. Nothing in `VT`. If anything else changed, find out why
    - _Requirements: 15.1 to 15.8_
  - [x] 9.3 Hand over for the owner to commit
    - Summarize the results of tasks 1 to 9 with the counts. Do not commit. The owner commits to `dev`, then merges to `test`
    - _Requirements: 15.8_

- [x] 10. Checkpoint before the rollout
  - Ensure all tests pass and ask the owner for approval to deploy Part A to `test` through the pipeline.

- [x] 11. Deploy Part A to `test` and run the gates (Phase 2)
  - [x] 11.1 Start the change probe
    - Before the pipeline reaches the Deploy stage, start the G4 loop of Design, V-D against both Test URLs and keep it running until PostDeploy passes. Lengthen the sleep if the 429s begin early
    - _Requirements: 11.3_
  - [x] 11.2 Confirm the pipeline
    - After the deploy, confirm the PostDeploy stage passes with 47 sub-checks (Part A does not change the verifier). Record the result. Stop the loop and record whether any `5xx` appeared
    - _Requirements: 11.3, 14.3_
  - [x] 11.3 G1 and G2: `sourceIp` is the caller
    - Run the requests and the log search of Design, V-D (G1 and G2). Compare each event's `requestContext.identity.sourceIp` with the caller's address and record only `equal` or `different` for the CloudFront domain and for the raw URL. Delete the temporary files
    - _Requirements: 11.1_
  - [x] 11.4 G3: the rate-limit probe
    - Run the probe of Design, V-D (G3). Record the six `X-RateLimit-Remaining` values. Pass: they fall on every request
    - _Requirements: 11.2_
  - [x] 11.5 G5: IPv6
    - From a host with an IPv6 address, run the requests of Design, V-D (G5) and record the outcome. If no such host is available, ask the owner whether to accept the gap and record the answer
    - _Requirements: 11.4_
  - [x] 11.6 Check Kiro against the Test stage
    - Point Kiro at the Test stage's CloudFront domain and confirm that the tools load. If they do not, capture the Kiro MCP log
    - _Requirements: 11.8_
  - [x] 11.7 Decide
    - If G1, G2, and G3 pass, record the results and ask the owner for approval to promote to `beta`. If any fails, stop: record the observed role of `sourceIp`, do not edit the plans, and ask the owner whether to fall back (D16)
    - _Requirements: 11.6, 14.3_

- [x] 12. Promote through `beta` and `main` (Phase 2)
  - [x] 12.1 `beta`
    - After the pipeline deploys `beta` (the owner merges), run G3 and the G4 loop against `beta`'s custom domain and its raw URL. Ask before sending traffic. G1 and G2 only if the owner raises `beta`'s log level for the check and restores it. Record the results
    - _Requirements: 11.5, 11.9_
  - [x] 12.2 `main`
    - After the pipeline deploys `main`, run G3 and the G4 loop against the production domain. Note whether CloudFormation updated the REST API after the Read function's gradual shift, and the length of the window in which the new function ran behind the still edge-optimized API. Record both
    - _Requirements: 11.5, 11.7_

- [ ] 13. Release (Phase 2)
  - [ ] 13.1 The registry switch
    - When cache-data 1.4.1 is on npm: switch both `package.json` files to `^1.4.1`, delete both `.npmrc` files, regenerate the lockfiles, rerun both suites and the scratch installs (without `--allow-git`). Tick the `TODO.md` line
    - _Requirements: 4.4_
  - [x] 13.2 Confirm the changelog
    - Confirm the affected range against the release tags and fill it in. Confirm no other text changed
    - _Requirements: 13.3, 13.6_
  - [ ] 13.3 Release
    - v0.0.7 is released only when Part A is verified on `test` and `beta`, task 13.1 is done, and task 13.2 is done. The owner dates the changelog and creates the release
    - _Requirements: 14.5_

- [ ] 14. Part B: hardening (Phase 3, not started)
  - Do not start until all three preconditions in [requirements.md](requirements.md) exist: the verified-origin check in cache-data 1.4.1; the network template version with `ApiOriginProtection`; and the PostDeploy role's permission to read the secret. Then follow Design, Part B, test-first:
  - [x] 14.1 Bind the provisional names against cache-data `main`
    - Confirm `CACHE_DATA_ORIGIN_SECRET_NAME`, `isOriginVerified()`, `client.ingress`, and the unverified-request log token; update the design and requirements if they differ
    - _Requirements: 6.3_
  - [x] 14.2 Template: secret, flag, environment, permission, metric filter
    - Design B1 and B4. Run the offline translation again; expected: one added resource (the secret), the role statements, the environment, and the metric filter
    - _Requirements: 5.6 to 5.11, 9.1, 14.7_
  - [x] 14.3 The guard in the Read and Auth functions
    - Design B2, with the tests of Requirement 10.5 first (red), including the Cognito trigger cases in `AF`
    - _Requirements: 6.1 to 6.10, 10.5_
  - [x] 14.4 Verifier, fake server, and their tests
    - Design B3 and Requirement 8: `O1.1`, the 48/38/10 counts, the fake server's guard and faults, the pinned ID list, the budget tests, the redaction test. Run `cd VT && timeout 600s npm test`
    - _Requirements: 7.1 to 7.9, 8.1 to 8.8_
  - [x] 14.5 Documentation and changelog for Part B
    - The Part B items of Requirements 12 and 13, including the in-place correction of the sub-check counts (13.1) if the owner agrees
    - _Requirements: 12.2, 12.4, 13.1, 13.5_
  - [-] 14.6 Roll out per stage
    - Design B5 and Requirement 14.9 on `test`, then `beta`, then `main`; record spikes S1, S4 (deploy-role permission), and S7's `401`
    - _Requirements: 14.7 to 14.9_
