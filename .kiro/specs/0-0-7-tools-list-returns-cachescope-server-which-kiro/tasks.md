# Implementation Plan: tools/list cacheScope fix

## Overview

This plan implements the changes described in [design.md](design.md) so that the modern `tools/list` and `server/discover` results carry a valid `cacheScope` and `ttlMs`:

- two constants, one private helper, and two formatter edits in `utils/mcp-protocol.js`
- Read Function tests, including a new architecture test
- a tightened post-deploy verifier, with its fake server and tests
- corrections to the smoke spec, the dual-era spec's design and manual script, the documentation, and the changelog
- a staged rollout: `test` first, with the PostDeploy result and a manual Kiro connection check

It follows the design's implementation order in four phases:

1. **Phase 1:** the server fix, test-first, in the Read Function.
2. **Phase 2:** the verifier and its fake server, test-first.
3. **Phase 3:** spec text, documentation, and the changelog.
4. **Phase 4:** the rollout. These tasks need a pipeline deploy and a person with Kiro; they are performed by the owner, not by an agent working in the repository.

Paths are relative to the repository root. `RF` means `application-infrastructure/src/lambda/read-function`. "Design" and "V-A" to "V-D" refer to sections of [design.md](design.md). Requirement numbers refer to [requirements.md](requirements.md).

Run tests with a timeout, from the directory shown, calling Jest directly. If `node_modules` is missing, run `npm ci --include=dev` there first. Check for stray test processes before and after a run (`ps aux | grep -E "jest" | grep -v grep`); if the process count grows, kill them with `pkill -f "jest"` and stop.

```bash
cd application-infrastructure/src/lambda/read-function
timeout 300s npx jest tests/unit/utils/mcp-protocol-constants.test.js
timeout 900s npx jest

cd application-infrastructure/tests/postdeploy-verify
timeout 600s npm test
```

Do not commit unless the owner asks. Do not edit the Smoke spec's `tasks.md`, the dual-era spec's `tasks.md` or `requirements.md`, the issue text in `ISSUE.md`, `template.yml`, `template-openapi-spec.yml`, or either buildspec. Line numbers in the tasks were read on 2026-10-29; find each edit by its text.

## Tasks

- [x] 1. Write the Read Function tests and see them fail (Phase 1, red)
  - [x] 1.1 Add the constant and discover tests
    - In `RF/tests/unit/utils/mcp-protocol-constants.test.js`, add `describe('CACHE_SCOPES and TOOLS_LIST_CACHE_SCOPE')`: `CACHE_SCOPES` is frozen and `[...CACHE_SCOPES].sort()` equals `['private', 'public']`; `TOOLS_LIST_CACHE_SCOPE` is a member; the modern `toolsListResult` and `discoverResult` report `cacheScope` and `ttlMs` equal to the constants
    - In `RF/tests/unit/utils/mcp-protocol-discover.test.js`, change "exactly five keys" to "exactly seven keys" (`_meta`, `cacheScope`, `capabilities`, `instructions`, `resultType`, `supportedVersions`, `ttlMs`), and add tests that `ttlMs` is a non-negative integer equal to `TOOLS_LIST_TTL_MS` and that `cacheScope` is in `CACHE_SCOPES` and equals `TOOLS_LIST_CACHE_SCOPE`
    - Import `CACHE_SCOPES` and `TOOLS_LIST_CACHE_SCOPE` from `utils/mcp-protocol` in the files that use them
    - _Requirements: 5.2, 5.3_
  - [x] 1.2 Update the integration and router tests
    - In `RF/tests/integration/mcp-protocol-modern-required-fields.test.js`, replace `expect(body.result.cacheScope).toBe('server')` with `expect(CACHE_SCOPES).toContain(body.result.cacheScope)` and `expect(body.result.cacheScope).toBe(TOOLS_LIST_CACHE_SCOPE)`
    - Confirm that the three legacy cases (`2025-11-25`, `2024-11-05`, no revision) already assert that `ttlMs` and `cacheScope` are absent, and leave them unchanged; add the assertion where one is missing
    - In `RF/tests/unit/utils/json-rpc-router-server-discover.test.js`, add a test that a modern `server/discover` request through `handleJsonRpc` returns `ttlMs` and a `cacheScope` in the allowed set
    - _Requirements: 5.1, 5.4, 5.5, 5.6_
  - [x] 1.3 Add the architecture test
    - Create `RF/tests/unit/architecture/no-hardcoded-cache-scope.test.js` next to `no-hardcoded-revisions.test.js`, as in Design, Components 4: CommonJS, `'use strict'`, `>!` comments, JSDoc on each helper, reads files only
    - `stripComments` replaces block comments with their line breaks so line numbers match the file; `SCOPE_LITERAL` is `/\bcacheScope['"`]?\s*:\s*['"`]/`; the walk skips `node_modules`, `tests`, and `coverage`
    - Include the detector self-check: `cacheScope: 'server'` and `"cacheScope": "public"` match; `cacheScope: TOOLS_LIST_CACHE_SCOPE`, `...modernCacheHints()`, and a commented example do not
    - _Requirements: 1.6, 5.7_
  - [x] 1.4 Run the new and changed tests against the unchanged server and confirm they fail
    - Run the five touched files only (command in Design, V-A)
    - Expected: the constants tests fail because the exports do not exist, the discover tests fail on the key set, the integration test fails on `'server'`, and the architecture test fails naming `utils/mcp-protocol.js`. The detector self-check passes
    - If anything unrelated fails, fix the test before continuing
    - Record the failing output in the working notes for the implementation summary
    - _Requirements: 5.1, 5.2, 5.7_

- [x] 2. Fix the server (Phase 1, green)
  - [x] 2.1 Add the constants and the helper
    - In `RF/utils/mcp-protocol.js`, widen the `TOOLS_LIST_TTL_MS` comment to say it also applies to `server/discover`
    - Add `CACHE_SCOPES = Object.freeze(['public', 'private'])` and `TOOLS_LIST_CACHE_SCOPE = 'public'` after it, with the JSDoc from Design, Components 1: the invariant, the link to the caching page, and the `>!` shared-cache warning. Do not read either from an environment variable or settings
    - Add the private `modernCacheHints()` above `toolsListResult`
    - Export `CACHE_SCOPES` and `TOOLS_LIST_CACHE_SCOPE` beside `TOOLS_LIST_TTL_MS`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 2.2 Use the helper in both formatters and update the JSDoc
    - `toolsListResult` modern branch: replace the `ttlMs` and `cacheScope` lines with `...modernCacheHints()`, keeping the member order (`tools`, `ttlMs`, `cacheScope`, `resultType`, `_meta`)
    - `discoverResult`: add `...modernCacheHints()` after `instructions`
    - Update the JSDoc and examples as in the Design table: the `'server'` mentions become `'public'`, and `discoverResult` lists and shows `ttlMs` and `cacheScope` and says why `"public"` applies
    - Leave the legacy branch, `initializeResult`, `toolsCallResult`, `getCapabilities`, and the router unchanged
    - _Requirements: 1.6, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4_
  - [x] 2.3 Add the tool catalog cross-reference
    - In `RF/utils/tool-catalog.js`, extend item 4 of the `buildToolCatalog` comment with the `>!` sentences from Design, Components 3. Comment only; no behavior change
    - _Requirements: 4.5, 6.1, 6.2, 6.3_
  - [x] 2.4 Run the touched tests, then the whole suite
    - Run the five touched files, then `timeout 900s npx jest` in `RF`. Every new test must now pass; the suite passes apart from the suites that are skipped today because they need AWS or GitHub access
    - Do the red-green checks of Design, V-B 1 and 2 by hand and revert each: set `TOOLS_LIST_CACHE_SCOPE` to `'server'` and see the constants, discover, and integration tests fail; put `cacheScope: 'public'` back into `toolsListResult` and see the architecture test fail naming the file
    - _Requirements: 5.8, 13.1_

- [x] 3. Phase 1 checkpoint
  - Confirm `git diff` shows no change to the legacy branch, the router, or the catalog code
  - Search `RF` (excluding `node_modules`) for `cacheScope: 'server'`; there should be none
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update the fake server (Phase 2, test-first)
  - [x] 4.1 Make the fake conformant
    - In `application-infrastructure/tests/postdeploy-verify/helpers/fake-mcp-server.mjs`, add `export const CACHE_SCOPE = 'public'` beside `TOOLS_LIST_TTL_MS`, with a comment that it is written from the published schema and not imported from the Read Function
    - Use it for the modern `tools/list` (replacing `'server'`), and add `ttlMs: TOOLS_LIST_TTL_MS` and `cacheScope: CACHE_SCOPE` to the `server/discover` answer after `instructions`
    - Import nothing from the Read Function
    - _Requirements: 8.1, 8.2_
  - [x] 4.2 Update the fake's own tests
    - In `fake-mcp-server-tests.jest.mjs`, change the two `toBe('server')` assertions to `toBe('public')`, and add `ttlMs` (`600000`) and `cacheScope` (`'public'`) assertions to the `server/discover` test. Use literals on purpose
    - _Requirements: 8.3_
  - [x] 4.3 Run the verifier tests and observe the old gap
    - Run `timeout 600s npm test` in `application-infrastructure/tests/postdeploy-verify`: everything passes, because the old verifier accepts any non-empty `cacheScope`
    - Then temporarily set `CACHE_SCOPE` to `'server'` in the fake and run again: the healthy-run tests still pass. This shows the gap the verifier change closes (Design, V-B 3). Revert the fake to `'public'`
    - _Requirements: 8.1, 13.1_

- [x] 5. Tighten the verifier (Phase 2)
  - [x] 5.1 Add the failure cases and see them fail (red)
    - In `checks-tests.jest.mjs`, add `FAILURES` rows: P1.2 with `cacheScope` of `'server'`; P1.2 with `ttlMs` deleted; P5.1 with `cacheScope` of `'server'`; P5.2 with `cacheScope` of `'server'`. Reason patterns are in Design, Components 6
    - Update the existing P5.2 empty-`cacheScope` row to `/^result\.cacheScope is "", expected "public" or "private"$/`
    - Run the package: the new rows fail against the old verifier, and nothing else does
    - _Requirements: 8.4, 8.5_
  - [x] 5.2 Implement the check (green)
    - In `application-infrastructure/postdeploy-scripts/verify-deployment.js`, add `ALLOWED_CACHE_SCOPES` beside `SERVER_NAME`, with the `>!` comment that it is restated from the schema on purpose
    - Add `cacheHintsProblem(result, secrets)` beside `judgeModernToolsList`, as in Design, Components 5
    - Replace the `ttlMs` and `cacheScope` blocks of `judgeModernToolsList` with a call to it; add the same call to P1.2 after the `resultType` check and before the handshake-key check
    - Do not import anything, and do not touch `SUB_CHECK_ROWS`, the request builders, or the report
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_
  - [x] 5.3 Update the verifier's comments
    - Update the JSDoc of `judgeModernToolsList`, `checkP1`, and `checkP5` (including the header lines that say "a non-empty string `cacheScope`") to say `cacheScope` is `public` or `private` and that P1.2 also requires `ttlMs` and `cacheScope`
    - Run `grep -n "non-empty string" application-infrastructure/postdeploy-scripts/verify-deployment.js`; only the `instructions` mentions should remain
    - _Requirements: 7.7_
  - [x] 5.4 Run the verifier tests and repeat the gap check
    - Run `timeout 600s npm test` in `application-infrastructure/tests/postdeploy-verify`; all suites pass, including `outcome-and-report-tests.jest.mjs` (the 45 pinned IDs) and the budget tests, both unedited
    - Temporarily set the fake's `CACHE_SCOPE` to `'server'`: the healthy-run tests now fail on P1.2, P5.1, and P5.2 with the documented reasons. Revert the fake to `'public'` and run once more
    - _Requirements: 7.5, 8.6, 8.7, 8.8_
  - [ ]* 5.5 Run the real verifier against the real router, locally (optional)
    - Follow Design, V-C: a temporary `RF/tests/unit/*.tmp.test.js` serves `handleJsonRpc` from `http.createServer` on `127.0.0.1` until a stop file appears, started in the background with output written under `/tmp`; run the verifier against it with `MCP_URL=http://127.0.0.1:<port>/mcp/v1` and `EXPECTED_VERSION=0.0.7`
    - Judge only P1 to P6 and V1; S1, X1, and T1 are expected to fail or skip because the stand-in has no authentication, CORS, or backends
    - Delete the temporary test and stop the server and any Jest processes when done
    - _Requirements: 13.1_

- [x] 6. Phase 2 checkpoint
  - Confirm `verify-deployment.js` still has no `require` of anything under the Read Function and no new dependency
  - Confirm `git diff` shows no change to `SUB_CHECK_ROWS`, `EXPECTED_SUB_CHECK_IDS`, the budget tests, or the buildspecs
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Correct the smoke spec text (Phase 3)
  - [x] 7.1 Edit its requirements and design
    - In `.kiro/specs/0-0-7-postdeploy-smoke-verification/requirements.md`, change Requirement 4.2 so P1 also requires a non-negative integer `ttlMs` and a `cacheScope` equal to `public` or `private`, and change Requirement 7.2 from "a non-empty string `cacheScope`" to a `cacheScope` equal to `public` or `private`
    - In its `design.md`, change the P1.2 row (add `ttlMs` and `cacheScope`) and the P5.1 row (`cacheScope` is `public` or `private`). The P5.2 row says "The same" and needs no edit
    - Search both files for `non-empty string`; only the `instructions` mentions should remain. Do not edit its `tasks.md` or mark its task 13
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 8. Correct the dual-era spec's design and manual script (Phase 3)
  - [x] 8.1 Edit `design.md`
    - In `.kiro/specs/0-0-7-mcp-protocol-dual-era/design.md`: replace `cacheScope: 'server'` in the formatter sketch with `cacheScope: TOOLS_LIST_CACHE_SCOPE   // ('public')`; rewrite the sentence that defines `'server'` and add the dated correction note linking this spec; change "this file-level constant and object literal" to name `TOOLS_LIST_TTL_MS` and `TOOLS_LIST_CACHE_SCOPE`; change the `CacheableToolsList` interface to `'public' | 'private'`; change the quoted changelog draft to `cacheScope: 'public'`
    - Add `ttlMs` and `cacheScope` to the `discoverResult` sketch and to the `DiscoverResult` interface
    - Do not edit its `tasks.md` or `requirements.md`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_
  - [x] 8.2 Edit `TODO-MANUAL-VERIFY.md`
    - Replace the F1 check with `printf '%s' "$M" | check "cacheScope is public"   '.result.cacheScope == "public"'`
    - In section C1, add after the `resultType` check: `ttlMs is 600000` (`'.result.ttlMs == 600000'`) and `cacheScope is public` (`'.result.cacheScope == "public"'`) against `$D`
    - _Requirements: 10.5_

- [x] 9. Update the documentation (Phase 3)
  - [x] 9.1 `ARCHITECTURE.md`
    - Add `ttlMs` and `cacheScope` to the `server/discover` modern column, and extend the paragraph after the table as in Design, Components 9
    - _Requirements: 11.1_
  - [x] 9.2 End-user page
    - In `docs/end-user/supported-protocol-revisions.md`, change the `ttlMs`/`cacheScope` bullet to cover `server/discover`, say the result is the same for every client (`"public"`), and keep the sentence that legacy responses never include these fields
    - _Requirements: 11.2_
  - [x] 9.3 Developer pages
    - `docs/developer/gradual-deployment.md`: `cacheScope: "server"` becomes `cacheScope: "public"`
    - `docs/developer/mcp-protocol-sources.md`: update the cache-hint row (covers `server/discover`; names `TOOLS_LIST_CACHE_SCOPE` and `CACHE_SCOPES`); change "Three tests enforce" to "Four", add the `no-hardcoded-cache-scope.test.js` bullet, and add the short paragraph that the verifier and its fake restate the allowed scopes on purpose
    - `docs/developer/post-deploy-verification.md`: update the P1 and P5 rows to say P1 also checks `server/discover`'s cache hints and P5 requires `cacheScope` to be `public` or `private`; keep the ranges and counts
    - _Requirements: 11.3, 11.4, 11.5, 11.7_
  - [x] 9.4 Admin-ops page
    - In `docs/admin-ops/post-deploy-verification.md`, make the same P1 and P5 row updates. Keep 45, 36, and 9
    - _Requirements: 11.5, 11.7_
  - [x] 9.5 Check the Markdown
    - For every Markdown file changed in tasks 7 to 9: relative links and anchors resolve, every code fence has a language, there is one H1, no heading level is skipped
    - _Requirements: 11.6_

- [x] 10. Update the changelog (Phase 3)
  - [x] 10.1 Edit `CHANGELOG.md`
    - Under `[v0.0.7] (unreleased)`, in the Added bullet for MCP Protocol Dual-Era Support, change only `` `cacheScope: "server"` `` to `` `cacheScope: "public"` ``. This is the one edit to existing text (decision Q5)
    - Add the new entry at the end of the unreleased **Fixed** list, with its four sub-bullets, exactly as in Design, Components 10
    - Do not edit the Post-Deploy Smoke Verification bullet or any released section. Follow `.kiro/steering/changelog-convention.md` and the neighbouring formatting
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 11. Final sweep before rollout
  - [x] 11.1 Run everything and search for leftovers
    - Run the Read Function suite and the verifier package (commands above) and record that both pass
    - Search the working tree, excluding `node_modules` and `.git`, for `cacheScope: "server"`, `cacheScope: 'server'`, `"server"` next to `cacheScope`, and `cacheScope is server`. The only hits left should be this spec's own documents, the dual-era `tasks.md`, and the dual-era `design.md` correction note
    - Run `git status`. Confirm no change to `template.yml`, `template-openapi-spec.yml`, a buildspec, a `package.json`, or a lockfile, and no new dependency
    - Leave the commit to the owner
    - _Requirements: 13.1, 14.1, 14.2, 14.4, 14.5, 14.6, 14.7_

- [x] 12. Roll out to `test` and verify (Phase 4, owner)
  - [x] 12.1 Deploy and read the PostDeploy result
    - After the owner commits and the change reaches the `test` branch, let the pipeline deploy. The server fix and the tightened verifier are in the same commit
    - Read the PostDeploy log: the verifier tests pass in `pre_build`, and the verifier outcome is `passed`, with P1.2, P5.1, and P5.2 passing. Record the outcome and the `VERIFY_REPORT` line in a short `VERIFICATION.md` in this spec directory
    - If the stage fails because it still runs the previous build, deploy the new build and retry the PostDeploy stage; do not loosen a check
    - _Requirements: 13.2, 13.3, 13.8_
  - [x] 12.2 Connect Kiro to `test`
    - Point Kiro at the `test` stage and confirm that the tools load. If they do not, capture the Kiro MCP log and report the finding before going further
    - Record the result in `VERIFICATION.md`. A passing verifier does not replace this step
    - _Requirements: 13.4_
  - [ ]* 12.3 Run the manual cross-check (optional)
    - Run the corrected F1 and C1 blocks of the dual-era `TODO-MANUAL-VERIFY.md` against `test` and record the result
    - _Requirements: 13.5_

- [x] 13. Promote (Phase 4, owner)
  - [x] 13.1 Promote through `beta` to `main`
    - Only after tasks 12.1 and 12.2 are met: promote through the normal flow (`test`, `beta`, `main`). Confirm each stage's PostDeploy passes. Nothing is sent to a deployed stage except by the pipeline and the checks above
    - The Smoke spec's open live runs (its task 13) are separate; when they are run, the expected outcomes of its 13.1 are unchanged
    - _Requirements: 13.6, 13.7, 13.9_

- [x] 14. Final checkpoint
  - Mark `fix: tools-list-returns-cachescope` complete in `TODO.md` under `## 0-0-7` (`- [x]`) once task 12 is done
  - Confirm `VERIFICATION.md` has the PostDeploy outcome and the Kiro result for `test`
  - Remind the owner of the follow-up this feature leaves: `0-0-7-schema-validation-of-modern-results` (ISSUE.md only; no PLAN, requirements, or tasks yet), and that the reporter on GitHub #7 can be told to retry once the fix reaches their stage
  - Ask the owner if there are questions
