# Implementation Plan: Schema validation of modern results

## Overview

This plan implements [design.md](design.md). The work has three parts:

- **Protocol fixes.** `-32022` keys and HTTP 400 for `-32022`/`-32020`, errors without a known `id`, and notifications.
- **Schema conformance.** Vendored schemas, validator helpers with a strict overlay, conformance tests for the server and the fake server, and a refresh script.
- **Release tooling.** A detection script and hook, the `update-mcp-schemas` and `prepare-release` skills, the GitHub release gate, and the release-process page.

The work runs in six phases, in the design's implementation order:

1. **Phase 1:** protocol fixes in the Read Function, test-first.
2. **Phase 2:** the verifier and its fake server, verifier first.
3. **Phase 3:** schema conformance: dependencies, the refresh script, the vendored schemas, the helpers, the tests.
4. **Phase 4:** release tooling.
5. **Phase 5:** documentation, spec history, changelog, and a final sweep.
6. **Phase 6:** rollout. These tasks need a pipeline deploy, a person with Kiro, and GitHub access. The owner performs them, not an agent working in the repository.

Paths are relative to the repository root:

- `RF` means `application-infrastructure/src/lambda/read-function`.
- `PV` means `application-infrastructure/tests/postdeploy-verify`.
- `BS` means `application-infrastructure/build-scripts`.

"Design N" means section N of [design.md](design.md), and "V-A" to "V-E" its verification sections. Requirement numbers refer to [requirements.md](requirements.md). Requirements 24 and 25 belong to Phase 1, although they are numbered last.

Run tests from the directory shown, with a timeout, calling Jest directly. If `node_modules` is missing, run `npm ci --include=dev` there first. Check for stray test processes before and after each run with `ps aux | grep -E "jest" | grep -v grep`. If the count grows, run `pkill -f "jest"` and stop.

```bash
cd application-infrastructure/src/lambda/read-function
timeout 300s npx jest <files>
timeout 900s npx jest

cd application-infrastructure/tests/postdeploy-verify
timeout 600s npm test

cd application-infrastructure/build-scripts
timeout 120s python3 -m unittest <modules>
```

**Do not:**

- commit, push, tag, or create a GitHub release unless the owner asks;
- edit `ISSUE.md`, the Smoke spec's `tasks.md`, or the Dual-era spec's `tasks.md` or `requirements.md`;
- edit `template.yml`, `template-openapi-spec.yml`, either buildspec, or `.github/dependabot.yml`.

Line numbers were read on 2026-11-01 at `dev` `3658616`; find each edit by its text.

## Tasks

- [ ] 1. Write the protocol-fix tests and see them fail (Phase 1, red)
  - [ ] 1.1 `-32022` and `-32020` tests
    - In `RF/tests/integration/mcp-protocol-unsupported-version.test.js`, give `send()` an `expectedStatus` argument (default 200). Make the `-32022` cases expect 400, `error.data.requested`, and `error.data.supported`, and no `declaredRevision` or `supportedVersions`.
    - Add two cases: `initialize` with an unlisted `MCP-Protocol-Version` gets 400 and the new keys; `server/discover` with an unlisted declared revision gets 200 and no `error`.
    - In `RF/tests/integration/mcp-protocol-header-validation.test.js`, make the `-32020` cases expect 400 and keep 200 for accepted requests.
    - Find other pins with `grep -rn -E "32020|32022|HEADER_MISMATCH|UNSUPPORTED_PROTOCOL_VERSION" RF/tests` and update any status-200 or old-key assertion on these two errors. Do not change tests that read `supportedVersions` from a `server/discover` result.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ] 1.2 Unknown-`id` tests
    - Change the error-side `id` assertions to `expect(<response>).not.toHaveProperty('id')`:
      - `mcp-protocol-jsonrpc.test.js` (L58, L126, L204, L289)
      - `json-rpc-router.test.js` (L249, L261)
      - `mcp-protocol-compliance.test.js` (L251)
      - `error-codes.property.test.js` (L108)
      - the error half of `json-rpc-envelope.property.test.js` (L142)
    - Leave the formatter-level success tests (`json-rpc-envelope.property.test.js` L136, `mcp-protocol-discover.test.js` L136) unchanged.
    - In `mcp-protocol-discover-no-auth.test.js` (L162), make `id: { bad: true }` expect `-32600` with no `id`.
    - In `json-rpc-router.test.js`, add cases: an `id` of `null`, `{}`, `true`, or `1.5` gets `-32600` with no `id` and HTTP 200; `7` and `"abc"` are echoed; `-32700` has no `id`.
    - Add a unit test that the 401 body from `utils/auth-resolver.js` for an unknown key has no `id`, in the file that already covers that path. Find it with `grep -rln "Invalid API key" RF/tests`.
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.6, 24.7, 24.8_
  - [ ] 1.3 Notification tests
    - In `json-rpc-router.test.js`, add four cases:
      - `notifications/initialized` with no `id` member: status 202, `body === ''`.
      - An unknown notification method: 202.
      - A notification with `MCP-Protocol-Version: 2099-01-01`: 400, `-32022`, no `id`.
      - A modern notification whose `Mcp-Method` disagrees: 400, `-32020`, no `id`.
    - In `RF/tests/unit/routes/routes-mcp-v1.test.js`, add a case where the mocked router returns `{ statusCode: 202, headers: {}, body: '' }`. Assert `setStatusCode(202)` and `setBody(null)`, and that nothing throws.
    - _Requirements: 25.1, 25.2, 25.3, 25.5, 25.6_
  - [ ] 1.4 Run the changed files against the unchanged server and confirm they fail
    - Run only the files changed in 1.1 to 1.3.
    - Expected: the new-key and status assertions fail, the no-`id` assertions fail (the server sends `id: null`), the invalid-`id` cases fail (the server answers with a result), and the notification cases fail (the server answers `-32601`). Nothing else fails.
    - If anything unrelated fails, fix the test before continuing. Record the failing output in the working notes.
    - _Requirements: 2.1, 24.6, 25.6_

- [ ] 2. Fix the server (Phase 1, green)
  - [ ] 2.1 Fix `-32022` and `-32020`
    - In `RF/utils/json-rpc-router.js`, add `PROTOCOL_ERROR_HTTP_STATUS = 400` near `STANDARD_HEADERS`, with the JSDoc and `>!` comment from Design 1.
    - Use it in the header-mismatch return (step 4) and the unsupported-revision return. Change the `-32022` data to `{ requested: declaredRevision, supported: decision.supportedVersions }`, with the `>!` comment citing `UnsupportedProtocolVersionError`.
    - Update the `handleJsonRpc` JSDoc to list the two 400 cases.
    - Leave `utils/mcp-era.js` and `negotiateProtocol()` unchanged.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_
  - [ ] 2.2 Omit an unknown `id` and reject an invalid one
    - In `RF/utils/mcp-protocol.js`, change `jsonRpcError` as in Design 20: add `id` only when it is neither `null` nor `undefined`, with the `>!` comment citing `id?: RequestId`. Update its JSDoc and the parse-error example.
    - In `json-rpc-router.js`, change `extractId` to accept `typeof rawId === 'string' || Number.isInteger(rawId)`.
    - In step 2, compute `hasId` (the body is a non-null object with an own `id` member). After the envelope check in step 3, return `-32600` with `data.details` `'The "id" must be a string or an integer'` when `hasId` is true and the id is `null`.
    - In `RF/utils/auth-resolver.js`, remove `id: null` from the 401 body.
    - Leave `jsonRpcSuccess` unchanged.
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5_
  - [ ] 2.3 Accept notifications
    - In `json-rpc-router.js`, add step 4b after the era, header, and revision checks: `if (!hasId) return { statusCode: 202, headers: { ...STANDARD_HEADERS }, body: '' };`, with the `>!` comment from Design 21.
    - In `RF/routes/index.js`, set the body with `jsonRpcResponse.body === '' ? null : JSON.parse(jsonRpcResponse.body)`, with the `>!` comment.
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5_
  - [ ] 2.4 Run the changed files, then the whole suite, then the red-green checks
    - Run the files from 1.1 to 1.3, then `timeout 900s npx jest` and `npm run lint` in `RF`. All pass, apart from suites that are skipped today because they need AWS or GitHub access.
    - Search for other assertions that assumed the old behavior: `grep -rn -E "toBeNull\(\)|notifications/" RF/tests`. Fix any hit that asserts `id: null` on an error, or `-32601` for a notification.
    - Do Design V-B 1 and 2 by hand and revert each. First restore the old `-32022` keys and see the integration test name `requested`. Then set `PROTOCOL_ERROR_HTTP_STATUS` to 200 and see the status assertions fail.
    - _Requirements: 2.1, 2.2, 24.6, 25.6, 22.1_

- [ ] 3. Phase 1 checkpoint
  - Confirm `git diff` touches only `utils/json-rpc-router.js`, `utils/mcp-protocol.js`, `utils/auth-resolver.js`, `routes/index.js`, and tests in `RF`.
  - Confirm no production `package.json` or lockfile changed.
  - Ensure all tests pass, and ask the user if questions arise.

- [ ] 4. Tighten the verifier (Phase 2, red against the current fake)
  - [ ] 4.1 Change P3, P4, and X2
    - In `application-infrastructure/postdeploy-scripts/verify-deployment.js`, add `PROTOCOL_ERROR_STATUS = 400` beside the other restated protocol values, with the `>!` comment from Design 3.
    - Request P3a, P3b, P4a, P4b, P4d, X2c, and X2d with `{ status: PROTOCOL_ERROR_STATUS }` as the `ctx.request` expectation. Keep the default for P4c and P4e.
    - In `judgeUnlisted`, read `requested`. In P3.3, read `supported`. Update their failure reasons as in Design 3.
    - Import nothing. Do not change `SUB_CHECK_ROWS` IDs, the request count, or the report format.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  - [ ] 4.2 Update the verifier's comments
    - Update the JSDoc of `checkP3`, `checkP4`, and `checkX2`, and the P3/P4/X2 sub-check descriptions (not their IDs).
    - `grep -n "declaredRevision" application-infrastructure/postdeploy-scripts/verify-deployment.js` returns nothing.
    - _Requirements: 3.9_
  - [ ] 4.3 Run the verifier tests against the unchanged fake
    - Run `timeout 600s npm test` in `PV`. Expected: the healthy-run tests fail on P3.1 to P3.3, P4.1, P4.2, P4.4, X2.3, and X2.4, with `HTTP 200, expected 400`. Nothing else fails.
    - This is the red half of Design V-B 5. Record the output.
    - _Requirements: 3.5_

- [ ] 5. Update the fake server and its tests (Phase 2, green)
  - [ ] 5.1 Make the fake conformant
    - In `PV/helpers/fake-mcp-server.mjs`, add `PROTOCOL_ERROR_STATUS = 400`, with a comment citing the schema.
    - Change `answer(rpc)` to `answer(rpc, status = 200)`, and pass the status to `respond`.
    - Return 400 from the three `-32020` branches and the `-32022` branch. Change the `-32022` data to `{ requested, supported }`.
    - Remove `id: null` from the 401 body and from the `-32700` answer.
    - Add the `rpcStatus` option (Design 4). It is called with the same context as `mutate`, and an integer it returns replaces the status. Document it in the factory's JSDoc.
    - Import nothing from the Read Function.
    - _Requirements: 4.1, 4.2, 24.4_
  - [ ] 5.2 Update the fake's tests and add the failure rows
    - In `fake-mcp-server-tests.jest.mjs`, assert 400 with `requested` and `supported` for `-32022`, and 400 for `-32020` on the raw and edge targets. Remove the `declaredRevision`/`supportedVersions` pins (L336-L345, L703). Change the `-32700` test (L449) to expect no `id`.
    - In `checks-tests.jest.mjs`:
      - Map a new `statusOverrides` row field onto `rpcStatus`, the same way `mutations` is mapped onto `mutate`.
      - Rename the "supportedVersions in another order" row to `supported`.
      - Add the rows from Design 4: P3.1 with status 200, P3.1 with `declaredRevision` in place of `requested`, P4.1 with status 200, and X2.3 with status 200. Each row asserts its reason and that only its sub-check fails.
    - _Requirements: 4.3, 4.4, 4.5_
  - [ ] 5.3 Run the verifier tests
    - Run `timeout 600s npm test` in `PV`. All suites pass, including `outcome-and-report-tests.jest.mjs` (the 45 pinned IDs) and the budget tests, both unedited.
    - _Requirements: 4.6, 3.8_

- [ ] 6. Phase 2 checkpoint
  - Confirm `verify-deployment.js` requires nothing new, and that `EXPECTED_SUB_CHECK_IDS` and the budget tests are unchanged in `git diff`.
  - Confirm neither the verifier nor the fake server gained notification handling; Requirement 25 needs no change in either.
  - _Requirements: 25.8_
  - Ensure all tests pass, and ask the user if questions arise.

- [ ] 7. Add the validator dependencies (Phase 3)
  - [ ] 7.1 Install and check
    - In `RF`, save `npm ls --omit=dev` output to `/tmp`. Then run `npm install --save-dev ajv@^8.20.0 ajv-formats@^3.0.1`. Run `npm ls --omit=dev` again and confirm the output is identical. Then run `npm run lint`.
    - In `PV`, run `npm install --save-dev --save-exact ajv@8.20.0 ajv-formats@3.0.1`.
    - Keep both lockfiles.
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [ ] 8. Write the refresh script and vendor the schemas (Phase 3)
  - [ ] 8.1 Write the refresh script's test first
    - Create `BS/test_refresh_mcp_schemas.py` (`unittest`, standard library only), with the fake `fetch` and the temporary `--schema-dir` from Design 11.
    - Cover:
      - unchanged, text-only change, semantic change, and new revision (ignoring `draft`);
      - an unreachable upstream, and a rate-limit answer;
      - each exit code (0, 1, 2, 3);
      - the token sent to API requests and not to raw downloads, and never printed;
      - write mode replacing the files and rewriting `PROVENANCE.md`;
      - an invalid `--commit` or `--ref` exiting 2 before any fetch.
    - Run it and see it fail (no module yet).
    - _Requirements: 13.8_
  - [ ] 8.2 Write `BS/refresh_mcp_schemas.py`
    - Implement Design 11: the constants and patterns, report mode with `strip_annotations()`, the exit codes, write mode with atomic replacement and the provenance template from Design 5, `--summary-file`, the `GITHUB_TOKEN` handling, and request timeouts. No shell.
    - Run the test until it passes.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_
  - [ ] 8.3 Vendor the schemas
    - Create the empty directories `application-infrastructure/tests/mcp-schemas/2024-11-05`, `2025-11-25`, and `2026-07-28`.
    - Run report mode once to read upstream `main`'s SHA. Then run `--write --commit <that SHA>`.
    - Confirm `PROVENANCE.md` holds the 40-character SHA, today's date, three sha256 rows, and the upstream license text. Do not edit the files by hand.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ] 8.4 Check the script against real upstream data
    - Run report mode with no arguments. Expected: `unchanged` for all three, exit 0.
    - Run with `--ref 2025-11-25`. Expected: `semantic change` for `2025-11-25`, exit 1 (the tag predates upstream's `NumberSchema` fix).
    - Record both outputs in the working notes.
    - _Requirements: 13.2, 13.3, 22.1_

- [ ] 9. Build the validator helpers and their negative controls (Phase 3)
  - [ ] 9.1 Write the helper unit tests first
    - Create `RF/tests/unit/helpers/mcp-schema-validator.test.js`, with the cases from Design 8:
      - the four published-schema negative controls;
      - the nine strict-only negative controls, plus a `title` on a `2024-11-05` Tool;
      - the `inputSchema` positive control;
      - unknown definition and unknown revision throw;
      - `buildStrictOverlay` throws on a synthetic draft-07 `allOf`.
    - Build each case from real formatter output (`toolsListResult`, `discoverResult`, `toolsCallResult`, `jsonRpcError`) with a `JSON.parse(JSON.stringify())` copy.
    - Run it and see it fail (no helper yet).
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [ ] 9.2 Write the CommonJS helper
    - Create `RF/tests/helpers/mcp-schema-validator.js` per Design 6:
      - `validate` and `validateStrict`;
      - `buildStrictOverlay`, with the composition rules, `type: "object"` on closed `allOf` parents, and the draft-07 guard;
      - the exported `OPEN_PROPERTIES` and `OPEN_DEFINITIONS`;
      - per-module caching;
      - throwing on unknown names;
      - error objects with `path`, `message`, and `property`.
    - Use JSDoc on every function.
    - Confirm the file sits under `tests/`, so Jest does not treat it as a test (it does not match `*.test.js`).
    - Run 9.1 until it passes.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_
  - [ ] 9.3 Add the vendored-schema guards
    - Create `RF/tests/unit/architecture/vendored-mcp-schemas.test.js`, per Design 8:
      - each sha256 row in `PROVENANCE.md` matches its file;
      - every vendored directory is listed, and every listed revision has a file;
      - the commit is 40 lowercase hexadecimal characters;
      - every `SUPPORTED_PROTOCOL_VERSIONS` entry has a vendored schema.
    - _Requirements: 10.6, 10.7_

- [ ] 10. Write the Read Function conformance test (Phase 3)
  - [ ] 10.1 Create the test
    - Create `RF/tests/integration/mcp-protocol-schema-conformance.test.js`. Use the `makeClientRequest` pattern from `mcp-protocol-unsupported-version.test.js`, and declare revisions with the `MCP-Protocol-Version` header.
    - Implement the result matrix from Design 7: `initialize` (legacy), `tools/list`, `tools/call` `list_tools`, and `server/discover`, for each revision and for no revision. Check the envelope by hand where no wrapper definition exists.
    - Implement the error table from Design 7, including:
      - `-32603` through an `addQueryLog` that throws;
      - the no-`id` errors, validated against `NO_ID_ERROR_REVISIONS`, with the `2024-11-05` exception comment from Design 20.
    - Add the notifications paragraph: `notifications/initialized` gets 202 and an empty body on `2024-11-05`, `2025-11-25`, and with no revision.
    - Run `validate` and `validateStrict` on every body. Failure messages name the case, revision, definition, and check.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 25.7_
  - [ ] 10.2 Run it, then the red-green checks
    - Run the conformance test, the helper tests, and the guards; all pass.
    - Do Design V-B 3 and 4 by hand and revert each. First add `nextcursor: null` to the modern `tools/list` result and see only `validateStrict` fail, naming it. Then change one byte in a vendored file and see the sha256 test fail, naming the revision.
    - _Requirements: 10.1, 10.2, 10.6_

- [ ] 11. Validate the fake server against the schemas (Phase 3)
  - [ ] 11.1 Write the ESM helper and the test
    - Create `PV/helpers/mcp-schema-validator.mjs`, with the same logic as the CommonJS helper. Resolve `SCHEMA_DIR` from `import.meta.url` to `application-infrastructure/tests/mcp-schemas`.
    - Create `PV/fake-mcp-server-schema-conformance.jest.mjs`. Start the fake as `fake-mcp-server-tests.jest.mjs` does, send each request kind the fake models (Design 9), and run both checks. Assert 400 for `-32020` and `-32022`.
    - _Requirements: 11.1, 11.2, 11.3, 6.1_
  - [ ] 11.2 Run the package
    - Run `timeout 600s npm test` in `PV`; all pass.
    - _Requirements: 11.1_

- [ ] 12. Phase 3 checkpoint
  - Record the Read Function suite's time on this tree with `/usr/bin/time -p timeout 900s npx jest`. Record the time before the change from a clean checkout of `3658616` (or `git stash`, if the owner prefers).
  - Confirm `npm ls --omit=dev` is unchanged in every Lambda package and layer.
  - Ensure all tests pass, and ask the user if questions arise.
  - _Requirements: 22.2, 23.2_

- [ ] 13. Add release-transition detection and the hook (Phase 4)
  - [ ] 13.1 Write the detection test first
    - Create `BS/test_detect_release_transition.py`. Test `decide()` for every header-state and branch combination.
    - Test `main()` against a temporary git repository (`git init`, a commit with an `unreleased` header, then a dated header in the working tree), on `dev` and on another branch.
    - Test the silent failure cases from Requirement 15.5: no repository, no `CHANGELOG.md`, `HEAD` without the file, a git timeout.
    - _Requirements: 15.9_
  - [ ] 13.2 Write `BS/detect_release_transition.py`
    - Implement Design 13: `HEADER_PATTERN`, the two fixed messages, a pure `decide()`, and `main()` using `subprocess.run([...], shell=False, timeout=2, check=False)`.
    - It always exits 0 and never prints file or git content.
    - Run the test until it passes.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_
  - [ ] 13.3 Create the hook
    - Use Kiro's hook tool (not a hand-written file): id `detect-release-transition`, trigger `UserPromptSubmit`, command action `python3 application-infrastructure/build-scripts/detect_release_transition.py`, timeout 5 seconds.
    - Confirm `.kiro/hooks/detect-release-transition.json` exists.
    - _Requirements: 15.8_
  - [ ] 13.4 Check the hook with the owner present
    - With the owner's agreement, date the top `CHANGELOG.md` header on `dev` without other changes. Send one prompt and confirm the prepare message appears. Then restore the header exactly.
    - This touches `CHANGELOG.md` only briefly. Confirm `git diff CHANGELOG.md` is empty afterwards.
    - _Requirements: 15.3, 22.1_

- [ ] 14. Add the skills (Phase 4)
  - [ ] 14.1 Check the precondition
    - Run `git status --short .kiro/skills`. If the `automate-*` renames are still uncommitted, stop and ask the owner to commit them first.
    - _Requirements: 16.9_
  - [ ] 14.2 `update-mcp-schemas`
    - Create `.kiro/skills/update-mcp-schemas/SKILL.md` with the frontmatter and steps from Design 12. It reports, writes on change, tests, reports the result, never commits, and never advertises a revision.
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [ ] 14.3 `prepare-release`
    - Create `.kiro/skills/prepare-release/SKILL.md` with the frontmatter and steps from Design 14:
      - preconditions on `dev`;
      - the four update skills in order;
      - every test suite;
      - the allow-list check, including the `template.yml` `Mappings`-only rule;
      - the stop conditions;
      - the hand-off linking `docs/developer/release-process.md`.
    - It never commits.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_
  - [ ] 14.4 List both skills in the README
    - In `.kiro/skills/README.md`, add a "Project-specific skills (not published)" table with both skills and one line each.
    - _Requirements: 14.5, 16.8_

- [ ] 15. Add the GitHub release gate (Phase 4)
  - [ ] 15.1 Write the workflow
    - Create `.github/workflows/release-gate.yml` per Design 15:
      - the header comment;
      - `release: types: [published]`;
      - workflow `contents: read`;
      - job `schema-drift`, with the unit tests, the refresh run, and the `drift` output;
      - job `withdraw-release`, with `if: failure() && needs.schema-drift.outputs.drift == 'true'` and job-level `contents: write`;
      - the step summary.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.6, 17.7_
  - [ ] 15.2 Pin the actions and check the file
    - Resolve the latest release tag of `actions/checkout` and `actions/setup-python` to commit SHAs with `gh api repos/actions/<name>/commits/<tag> --jq .sha`. Pin both, with the tag in a comment.
    - Confirm no `${{ }}` expression sits inside a `run:` script.
    - Run `actionlint` on the file if it is installed. If it is not, say so in the working notes.
    - _Requirements: 17.5, 22.7_

- [ ] 16. Phase 4 checkpoint
  - Run `timeout 120s python3 -m unittest test_write_release_version test_refresh_mcp_schemas test_detect_release_transition` in `BS`; all pass.
  - Ensure all tests pass, and ask the user if questions arise.

- [ ] 17. Write the release-process page (Phase 5)
  - [ ] 17.1 Create `docs/developer/release-process.md`
    - Follow the outline and the gates table in Design 16: the verify pass, the prepare pass with the allow-list table, publishing on GitHub and what to do on a withdrawn release, starting the next cycle, and what each gate stops.
    - _Requirements: 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_
  - [ ] 17.2 Link it
    - Add links from `docs/developer/README.md`, from `DEPLOYMENT.md` after its merge section, and from `CONTRIBUTING.md`.
    - _Requirements: 18.1_

- [ ] 18. Update the protocol and verification documentation (Phase 5)
  - [ ] 18.1 End-user page and `ARCHITECTURE.md`
    - Apply the Design 17 edits:
      - the `-32022` example;
      - the HTTP 400 sentence;
      - the notification sentence (Design 21);
      - the `ARCHITECTURE.md` bullet, diagram notes, and notification line.
    - _Requirements: 19.1, 19.2, 25.9_
  - [ ] 18.2 Verification pages
    - Update the P3, P4, and X2 rows in `docs/admin-ops/post-deploy-verification.md` and `docs/developer/post-deploy-verification.md`. Keep 45, 36, and 9.
    - _Requirements: 19.3_
  - [ ] 18.3 `docs/developer/mcp-protocol-sources.md`
    - Add the "Published schemas and conformance tests" section from Design 17.
    - Add three bullets to "Behavior that is easy to get wrong": `-32022` and `-32020` use 400; an absent `id` is a notification (202); an invalid `id` is `-32600` with no `id`.
    - _Requirements: 19.4, 19.5_
  - [ ] 18.4 Check the Markdown
    - For every Markdown file changed in tasks 17 and 18, check that:
      - relative links and anchors resolve;
      - every code fence has a language;
      - there is one H1, and no heading level is skipped.
    - _Requirements: 18.7, 19.6_

- [ ] 19. Update the earlier specs (Phase 5)
  - [ ] 19.1 Smoke spec
    - In `.kiro/specs/0-0-7-postdeploy-smoke-verification/requirements.md`, update Requirements 6.2, 6.3, and 9.6.
    - In its `design.md`, update the P3.1 to P3.3, P4.1, P4.2, P4.4, X2.3, and X2.4 rows, as in Design 18.
    - Do not edit its `tasks.md`.
    - _Requirements: 20.1, 20.2, 20.5_
  - [ ] 19.2 Dual-era spec
    - In `.kiro/specs/0-0-7-mcp-protocol-dual-era/design.md`, describe `requested`/`supported` and HTTP 400, and add the dated note.
    - In its `TODO-MANUAL-VERIFY.md`, update D1, D2, and D3, and add status checks to E1, E2, and E4.
    - Do not edit its `tasks.md` or `requirements.md`.
    - _Requirements: 20.3, 20.4, 20.5_

- [ ] 20. Update the changelog (Phase 5)
  - [ ] 20.1 Edit `CHANGELOG.md`
    - Under `[v0.0.7] (unreleased)`, in the dual-era Added bullet, change only the `error.data` wording, as in Design 19.
    - Add the Fixed entry and the Added entry from Design 19, at the end of their lists.
    - Change nothing else, including no released section. Follow `.kiro/steering/changelog-convention.md`.
    - _Requirements: 21.1, 21.2, 21.3, 21.4_

- [ ] 21. Final sweep before rollout (Phase 5)
  - [ ] 21.1 Run everything and search for leftovers
    - Run the Read Function suite and lint, the verifier package, and the three Python test modules. Record that all pass.
    - Search the working tree (excluding `node_modules` and `.git`) for `declaredRevision` and for `supportedVersions` used as `-32022` data. The only hits left should be this spec's own documents, the dual-era `tasks.md` and `requirements.md`, and the Smoke spec's `tasks.md`.
    - Run `git status`. Confirm:
      - no change to `template.yml`, `template-openapi-spec.yml`, a buildspec, or `.github/dependabot.yml`;
      - the only `package.json` and lockfile changes are the dev dependencies from task 7;
      - the new files are the ones this plan lists.
    - Leave the commit to the owner.
    - _Requirements: 22.1, 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7, 23.8_

- [ ] 22. Roll out to `test` and verify (Phase 6, owner)
  - [ ] 22.1 Deploy and read the PostDeploy result
    - After the owner commits and the change reaches `test`, let the pipeline run.
    - Build runs the conformance tests. PostDeploy runs the verifier tests in `pre_build`, then the verifier.
    - Record the outcome and the `VERIFY_REPORT` line in `VERIFICATION.md` in this spec directory: `passed`, with P3, P4, and P5 green and X2 skipped.
    - If the stage still runs the previous build, deploy the new build and retry PostDeploy. Do not loosen a check.
    - _Requirements: 22.3, 22.4_
  - [ ] 22.2 Connect Kiro to `test`
    - Confirm that the tools load. This also exercises `notifications/initialized` (202) with a real client.
    - If they do not load, capture the client log and stop.
    - Record the result in `VERIFICATION.md`.
    - _Requirements: 22.5_

- [ ] 23. Promote (Phase 6, owner)
  - [ ] 23.1 Promote through `beta` to `main`
    - Only after 22.1 and 22.2 are met: promote through `beta` and `main`, confirming each stage's PostDeploy.
    - On `beta`, record X2.3 and X2.4 in `VERIFICATION.md`. Passing confirms that a 400 crosses the stage's CloudFront distribution unchanged.
    - _Requirements: 22.4, 22.8_

- [ ] 24. Check the release gate once (Phase 6, owner, with go-ahead)
  - [ ] 24.1 Run the throwaway pre-release check
    - After v0.0.7 reaches GitHub `main`, so the workflow is on the default branch, follow Design V-E 2:
      1. Push a test branch whose vendored `2026-07-28/schema.json` has one `required` entry removed.
      2. Publish pre-release `v0.0.0-gate-check` against it.
      3. Confirm `schema-drift` fails with `drift=true` and `withdraw-release` returns the release to draft, with the summary shown.
      4. Delete the release, the tag, and the branch.
    - Record the result in `VERIFICATION.md`.
    - Only with the owner's go-ahead at that time, because the repository is public.
    - _Requirements: 22.6_

- [ ] 25. Final checkpoint
  - Mark `schema-validation-of-modern-results` complete in `TODO.md` under `## 0-0-7` (`- [x]`) once tasks 22 and 23 are done. Task 24 may follow the release.
  - Confirm `VERIFICATION.md` has the PostDeploy outcome, the Kiro result for `test`, and the `beta` X2 results.
  - Remind the owner of two things:
    - The v0.0.7 release is the first one to use the new release path. Date the version on `dev`, let the hook prompt for `prepare-release`, and follow `docs/developer/release-process.md`.
    - Dead tests, Python tests in CodeBuild, `npm audit` for test packages, and the Dependabot directory are in `.kiro/specs/0-0-8-prune-tests-and-ensure-automation/`.
  - Ask the owner if there are questions.
