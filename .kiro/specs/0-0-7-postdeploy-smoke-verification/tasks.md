# Implementation Plan: Post-Deploy Smoke Verification

## Overview

This plan implements post-deploy smoke verification as described in [design.md](design.md):

- one dependency-free Node script, `application-infrastructure/postdeploy-scripts/verify-deployment.js` (the Verifier)
- one bash wrapper, `application-infrastructure/postdeploy-scripts/05-verify-deployment.sh` (the Wrapper)
- a self-contained Jest package, `application-infrastructure/tests/postdeploy-verify/`
- small edits to both buildspecs and to one stale test, plus documentation

It follows the design's four phases:

1. **Phase 1:** the Verifier and its test package. No pipeline change. The Verifier can already be run locally against a deployed stage.
2. **Phase 2:** the Wrapper, the buildspec wiring, the two SSM parameters, and the stale structure assertion. The next deploy runs verification.
3. **Phase 3:** documentation and the changelog.
4. **Phase 4:** live runs on deployed stages, by hand.

Paths are relative to the repository root, and § refers to a section of [design.md](design.md). Run the new package's tests with Jest directly from its directory, with a timeout:

```bash
cd application-infrastructure/tests/postdeploy-verify
timeout 300s node --experimental-vm-modules ./node_modules/jest/bin/jest.js
```

## Tasks

- [x] 1. Scaffold the Verifier and its test package (Phase 1)

  - [x] 1.1 Create the Verifier skeleton
    - Create `application-infrastructure/postdeploy-scripts/verify-deployment.js` with a module JSDoc block (`@module verify-deployment`, with the command-line usage from §2 as examples), `'use strict'`, and the section order from §2
    - Define the constants: `REVISION_FLOOR` (`['2024-11-05', '2025-11-25', '2026-07-28']`), `SERVER_NAME` (`atlantis-mcp-server`), `USER_AGENT` (`atlantis-mcp-postdeploy-verify`), `LOG_PREFIX` (`[05-verify-deployment]`), `INVALID_TEST_KEY` (`postdeploy-verify-invalid-key`), `EXIT_CODES` (`OK: 0`, `FAILURE: 1`, `SKIP_CHECK_SKIPPED: 20`), and the defaults in §3 (origin, timeout, report path)
    - Add `main({ argv, env, fetchImpl, stdout, stderr, now, sleep, cwd })`, which dispatches the commands in §2. An unknown command writes the usage to standard error and resolves to 1. `main()` never rejects
    - Add the entry point: under `require.main === module`, call `main()` with the real process objects and set `process.exitCode`; never call `process.exit()`
    - Export `main` and the constants. Later tasks add their functions to `module.exports`
    - _Requirements: 1.5, 15.1_

  - [x] 1.2 Create the test package
    - Create `application-infrastructure/tests/postdeploy-verify/package.json` and `jest.config.js` as in §11, with exact pins: jest 30.5.2, @jest/globals 30.5.2, fast-check 4.10.2, js-yaml 4.3.1
    - Run `npm install` in that directory to create `package-lock.json`. Confirm with `git check-ignore -v` that neither the lockfile nor the package files are ignored
    - Add `helpers/load-verifier.mjs`, which loads the CommonJS Verifier with `createRequire(import.meta.url)`
    - Add `cli-tests.jest.mjs` with a first smoke test: the Verifier loads, `EXIT_CODES` and `REVISION_FLOOR` have the values above, and an unknown command resolves to 1 with the usage on standard error
    - Run the package's tests; they pass
    - _Requirements: 16.1, 16.3_

- [x] 2. Input decisions (Phase 1)

  - [x] 2.1 Implement the skip switch decision (§4.1)
    - `parseSkipValue(raw)`: trim and lowercase; `true` is on; `false`, unset, or empty is off; any other value is off with a warning that carries the first 32 characters
    - `decideSkip({ ssmStatus, ssmValue, verifySkip, parameterName })`, following the §4.1 table, returning `{ isOn, source, value, messages }`. When the switch is on, the messages include how to turn it off for the deciding source (the `put-parameter` command with the parameter name, or setting `VERIFY_SKIP` back to `"false"`)
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 2.2 Implement key classification (§4.2)
    - `classifyKey({ status, value, parameterName })`, following the §4.2 table. `key` is set only for `present`, and the message never contains the value
    - _Requirements: 11.3, 11.4, 11.5, 11.7, 15.3_

  - [x] 2.3 Implement input reading and validation (§3, §4.3)
    - `readInputs(env)` maps the variables in §3 to an inputs object, with the defaults applied
    - `validateConfig(inputs, { cwd })` returns every problem in §4.3: a non-empty `VERIFY_CONFIG_ERROR`; the `https:` rule for `MCP_URL` and a non-empty `MCP_EDGE_URL`, with the `localhost` and `127.0.0.1` exception; the `EXPECTED_VERSION` format; a positive-integer timeout; `MCP_ORIGIN`; and the `build/final/` guard, built with `path.resolve` and `path.relative`
    - _Requirements: 13.7, 14.4, 15.2, 15.4_

  - [x] 2.4 Implement the `release-version` and `edge-url` commands (§2)
    - `release-version <file>`: require the resolved path and print `releaseVersion`. Exit 1 with an `ERROR` line when the file is missing or the value is not `x.y.z`
    - `edge-url <settings.json> <stageId>`: read and parse the file, apply `loadSettings()` from the sibling `settings-loader.js`, and print `https://<domain>/mcp/v1`, or an empty line when there is no `domain`. Exit 1 when the file cannot be read or parsed, or the domain fails a host-name allowlist pattern
    - _Requirements: 2.2, 3.1, 3.3_

  - [x] 2.5 Write unit tests for the input decisions
    - Create `inputs-tests.jest.mjs`: every row of the §4.1 and §4.2 tables, each rule in §4.3, and both helper commands against files in a temporary directory, removed in `afterEach`
    - Run the file; all tests pass
    - _Requirements: 11.3, 11.5, 12.3, 12.4, 13.7, 14.4, 15.2, 15.3, 15.4, 16.4_

  - [x] 2.6 Write property tests for the input decisions
    - Create `input-decisions-property-tests.jest.mjs`, with fast-check's default 100 runs
    - **Property 1: Only `true` turns the skip switch on.** For any string, the switch is on if and only if the deciding value, trimmed and lowercased, equals `true`, and any value other than `true`, `false`, or empty produces a warning
    - **Property 5: Key classification is total and does not disclose.** For any status and value, exactly one classification; `present` only for a non-empty value that is not the placeholder; the message never contains the value
    - **Validates: Requirements 11.3, 11.4, 12.4, 15.3, 16.5**

- [x] 3. HTTP client (Phase 1)

  - [x] 3.1 Implement `createHttpClient({ fetchImpl, timeoutMs, sleep, now })` (§5)
    - Build the headers as a plain object, in the §5 order: `User-Agent`, `Content-Type: application/json` on POSTs, the spec's headers as written, then `X-API-Key` when the spec carries a key. Never send `X-Forwarded-For` or cookies
    - Add a run-unique JSON-RPC `id` (`verify-1`, `verify-2`, and so on) to each POST body, and return it as the exchange's `jsonRpcId`
    - Give each attempt `redirect: 'manual'` and its own `AbortSignal.timeout(timeoutMs)`. Retry once, after `sleep(1000)`, on a network error, a timeout, or HTTP 502, 503, or 504, and never otherwise
    - Return an `Exchange` (see Data Models): lower-case response header names, the body text, and the parsed JSON when it parses. Classify failures as `timeout`, the `cause` code, or `network`. Count POSTs, preflights, and retries in `stats`. The client never logs
    - _Requirements: 6.5, 13.1, 13.2, 13.3, 13.5, 13.6, 13.8_

  - [x] 3.2 Write unit tests for the HTTP client
    - Create `http-client-tests.jest.mjs` with a small inline fake `fetch`. Cover: headers sent as written, case included; the `User-Agent`; no key and no `Authorization` on preflights; the key only as `X-API-Key` and only when given; never `X-Forwarded-For`; a signal on every attempt; each row of the retry table; a redirect returned without a second request; error classification, with a timeout simulated by a `TimeoutError` `DOMException` and a network failure by a `TypeError` with a `cause` code
    - Run the file; all tests pass
    - _Requirements: 6.5, 13.2, 13.3, 13.5, 13.6, 13.8, 16.4_

  - [x] 3.3 Write the property test for bounded retries
    - Create `retry-property-tests.jest.mjs`
    - **Property 4: Bounded retries.** For any first and second transport result (a network error, a timeout, or HTTP 200 to 599), at most two attempts. A second attempt only after a network error, a timeout, or HTTP 502, 503, or 504, and never after HTTP 429 or another 4xx
    - **Validates: Requirements 10.8, 13.3**

- [x] 4. Output, outcome, and report primitives (Phase 1)

  - [x] 4.1 Implement redaction and the output layer (§9)
    - `redact(text, secrets)`: replace each secret of 8 or more characters with `[REDACTED]`
    - An output object with `info`, `warn`, and `error`, which add the `[05-verify-deployment] <LEVEL>:` prefix and send `ERROR` to standard error, and `line`, which writes a raw line to standard output. Every method redacts before writing
    - `formatSubCheckLine(result)`: the label padded to 4 characters, the ID padded to 5, the title, then ` (<reason>)` or ` (<note>)`
    - A body-excerpt helper that redacts first, collapses whitespace, then cuts to 300 characters and appends `...`. A value formatter that JSON-encodes and cuts to 80 characters
    - _Requirements: 11.6, 14.1, 14.2, 14.7, 14.8_

  - [x] 4.2 Implement `computeOutcome()` and its messages (§8)
    - Precedence: `skipped`, `error`, `failed`, `inconclusive` (any core SKIP), `passed`. Advisory results never change the outcome
    - The messages: an `ERROR` line listing the failed core IDs; an `ERROR` line with the input problem; and the inconclusive `WARN` lines from §8, with the reset time (from `Retry-After`, then `X-RateLimit-Reset`, else "unknown"), the retry command with `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-Pipeline` or `<pipeline-name>`, and the execution-ID lookup
    - _Requirements: 10.1, 10.3, 10.5, 10.7, 10.8_

  - [x] 4.3 Implement the report (§9)
    - `buildReport(...)`, with the §9 fields in the documented key order: `tool`, `schemaVersion`, `outcome`, `exitCode`, and `expectedVersion` first, `checks` last
    - `formatReportLine(report)`: `VERIFY_REPORT`, one space, and the compact JSON on one line
    - `writeReport(path, report)`: create the directory and write the indented, redacted JSON. When writing fails, log a `WARN` and continue
    - _Requirements: 14.4, 14.5, 14.6, 14.8_

  - [x] 4.4 Write the property test for outcome precedence
    - Create `outcome-property-tests.jest.mjs`
    - **Property 3: Outcome precedence.** For any list of results and any combination of the skipped, problem, and internal-error flags, `computeOutcome()` returns the first matching rule of §8, and changing any advisory result's outcome never changes the run outcome
    - **Validates: Requirements 10.3, 10.5**

- [x] 5. Test fixtures (Phase 1; independent of tasks 2 to 4)

  - [x] 5.1 Build the fake MCP server
    - Create `helpers/fake-mcp-server.mjs` exporting `createFakeMcpServer(options)`, which returns `{ fetch, calls }` and answers with real `Response` objects
    - Model the documented behavior in `docs/end-user/supported-protocol-revisions.md` and `docs/admin-ops/cors-and-response-headers.md`: era resolution from the header, `params._meta`, or a top-level `_meta`; `-32022` except on `server/discover`; `-32020` on modern requests only; the legacy counter-offer rule; `title` and `annotations` by revision; the modern envelopes on `server/discover`, `tools/list`, and `tools/call`; `401` with `-32001` for an unknown key; `X-RateLimit-*` headers per tier (public 50, registered 100, private 6000); the preflight answer from the `template.yml` CORS stanza; separate raw and edge hosts
    - Add options that each change one behavior: the reported version; `supportedVersions`, including an extra revision; an edge that drops the MCP headers; HTTP 429 on chosen requests, with `Retry-After` and `X-RateLimit-Reset`; a `5xx`, a timeout, or a network error on chosen requests; a redirect; the degraded auth header; a tool without a title; a failing `list_templates`; and a server that echoes request headers into its response bodies
    - _Requirements: 16.3, 16.4_

  - [x] 5.2 Write the fake server's self-test
    - Create `fake-mcp-server-tests.jest.mjs`: the model answers each method and revision with the documented response shapes, and each option changes only the behavior it names
    - Run the file; all tests pass
    - _Requirements: 16.4_

  - [x] 5.3 Build the run helper
    - Create `helpers/run-verifier.mjs` exporting `runVerifier({ command, env, server, cwd })`. It calls `main()` with the fake `fetch`, captured standard output and standard error, a `sleep` that resolves at once, a fixed clock, and `VERIFY_REPORT_PATH` under `fs.mkdtempSync()`. It returns `{ exitCode, stdout, stderr, report, reportLine, calls }` and removes the temporary directory
    - Export `guardRealFetch()`, which replaces `globalThis.fetch` with a function that throws for the duration of a test file and restores it afterwards
    - _Requirements: 16.3_

- [x] 6. Check engine and catalog (Phase 1)

  - [x] 6.1 Implement the check engine (§6)
    - The context in §6. `ctx.send()`, which returns a not-attempted exchange for raw-target specs once `rawTargetDown` is set, without calling `fetch`
    - `gateExchange()`, following the §6 gate table. The dependency rules: the owner's reason with the body excerpt; "no usable response; see `<owner ID>`" for the others; the exact reasons for HTTP 429 and for "not attempted"
    - The baseline states, with the "no baseline: P1 had no answer" SKIP and the "no baseline: P1 returned no valid `<field>`" FAIL
    - `ctx.record()`, which prints the sub-check line at once and stores the result, and `runChecks(ctx)`, which walks `CHECK_ORDER`
    - _Requirements: 4.6, 10.2, 10.4, 10.6, 14.1_

  - [x] 6.2 Define the check catalog (§7)
    - `SUB_CHECKS` with all 45 IDs and their check, severity, and title, exactly as in the §7 sub-check table, and `CHECK_ORDER`
    - Request builders for every row of the §7 request table, including `clientInfo` on P2a to P2d and the header names of P4d written exactly as listed
    - _Requirements: 1.6, 4.1, 5.1, 6.1, 6.3, 6.5, 7.1, 7.6, 7.7, 8.1, 9.1, 9.2, 9.3, 9.6, 10.1, 10.2, 13.1_

  - [x] 6.3 Implement P1, V1.1, S1, and S2
    - P1.1 to P1.5, and the baseline from P1's answer. Set `rawTargetDown` when P1 got no response, or HTTP 500 or higher, after its retry. Record V1.1 right after P1's sub-checks
    - S1.1, expecting HTTP 401; on a `200`, the reason also names `X-MCP-Auth-Status: degraded` when present
    - S2.1 to S2.3, SKIP with the key classification when it is not `present`. Set `effectiveKey` when S2.1 passed and S2.3 did not fail
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 9.2, 9.3, 9.4, 9.5, 11.4_

  - [x] 6.4 Implement P2 with V1.2, P3, and P4
    - P2.1 to P2.7, then V1.2; P3.1 to P3.3; P4.1 to P4.5
    - _Requirements: 4.4, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 6.5 Implement P5, P6, and T1
    - P5.1 to P5.8; the extra revisions from the baseline, and P5.9 with the note "none advertised" when there are none; P6.1 and P6.2; T1.1
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 9.1_

  - [x] 6.6 Implement X1 and X2
    - X1.1 to X1.3 on the raw target. X2.1 to X2.4 on the edge target, all SKIP "no custom domain for this stage" when there is none, with the forwarding hint when X2.3 or X2.4 gets a normal result instead of `-32020`
    - _Requirements: 2.3, 2.4, 8.1, 8.2, 9.6, 9.7_

- [x] 7. Commands and end-to-end tests (Phase 1)

  - [x] 7.1 Wire the commands in `main()` (§2)
    - `skip-check`: decide and log the skip switch. When it is on, write the skipped report, print the report line, and resolve to `EXIT_CODES.SKIP_CHECK_SKIPPED`
    - `run`: work out the skip decision without logging it, and take the skipped path when it is on. Read and validate the inputs; on any problem, write an `error` report and resolve to 1 before any request. Classify and log the key, run the checks, compute the outcome, print the summary and messages, write the report, and print the report line
    - The default command: the same as `run`, but it decides and logs the skip switch from `VERIFY_SKIP`, and logs the targets and the expected version
    - Catch any unexpected error: log an `ERROR` without request headers or the key, write an `error` report if possible, and resolve to 1
    - _Requirements: 10.5, 10.9, 11.5, 12.5, 12.6, 14.2, 14.3, 14.6, 15.1_

  - [x] 7.2 Write the check tests
    - Create `checks-tests.jest.mjs`, using `runVerifier` and the fake server
    - A healthy stage passes all 45 sub-checks, with and without an edge target, and with and without a key
    - For every sub-check, at least one fake-server option fails it with the documented reason
    - Also cover: the owner and "see" reasons; "not attempted" after a P1 timeout and after a P1 `502`, with X2 still running; a P1 `429`, with the "no baseline" skips and every other sub-check still reporting; S2 falling back to no key after a `401`, the degraded header, and a limit that is not higher; X2 skipped without an edge target; an extra revision
    - Run the file; all tests pass
    - _Requirements: 4.6, 9.4, 9.5, 9.7, 10.4, 10.6, 16.4_

  - [x] 7.3 Write the outcome and report tests
    - Create `outcome-and-report-tests.jest.mjs`
    - Outcomes: each outcome with its exit code, including `skip-check` resolving to 20; the inconclusive messages with and without `Retry-After`; the summary counts
    - Report: the fields and their key order; the report line is a single line whose JSON equals the file; the skipped and error reports; a report write failure leaves the outcome unchanged; exactly one report line per run
    - Formatting: `formatSubCheckLine()` and `redact()` cases, including an excerpt that is redacted before it is cut
    - Stability: a fixed list of the 45 sub-check IDs, so changing or reusing an ID fails a test
    - Run the file; all tests pass
    - _Requirements: 10.2, 10.5, 10.7, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 16.4_

  - [x] 7.4 Write the budget tests
    - Create `budget-tests.jest.mjs`. On a healthy stage, the counted requests (POSTs other than S1) are 21 without an edge target and 24 with one. With an accepted key, exactly one POST goes without `X-API-Key` (P1), and 22 or 25 go with it. Each extra revision adds one. The fake server never sees two requests in flight at once
    - Run the file; all tests pass
    - _Requirements: 13.1, 13.4, 16.4_

  - [x] 7.5 Write the secret-redaction property test
    - Create `secret-redaction-property-tests.jest.mjs`
    - **Property 2: The key never reaches any output.** For any key of the real form (`atl_` plus 32 hex characters) or a random string of 20 to 64 characters from `[A-Za-z0-9_-]`, and for each scenario (a healthy stage, a rejected key, HTTP 429 everywhere, and a server that echoes request headers), no standard output, standard error, report file, or report line contains the key
    - **Validates: Requirements 11.6, 14.7, 14.8, 16.5**

  - [x] 7.6 Extend the command tests
    - In `cli-tests.jest.mjs`, cover the §2 command table: dispatch, each command's exit codes, the default command logging the targets and the expected version, and `run` taking the skipped path when the switch is on
    - Run the file; all tests pass
    - _Requirements: 12.6, 15.1, 16.4_

- [x] 8. Phase 1 checkpoint
  - Run the package's tests. All pass, and no test makes a real network request
  - Run the Read Function suite (`timeout 600s npx jest --silent` in `application-infrastructure/src/lambda/read-function`) and confirm the baseline is unchanged: 2091 passed, 115 skipped, 0 failed
  - Optional, needs network access: run the default command locally against a deployed stage that runs v0.0.7, for example `test`, with `MCP_URL` and `EXPECTED_VERSION` set. Treat any FAIL as either a server regression or a gap in the fake server, and fix the model or report the bug
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 15.1, 16.8_

- [x] 9. Wrapper and pipeline wiring (Phase 2)

  - [x] 9.1 Create `05-verify-deployment.sh` (§1)
    - Implement the six steps of the §1 sketch: the skip switch first, through `skip-check`, exiting 0 on 20; collected configuration problems; the version script, keeping only its standard error; `release-version` and `edge-url`; the `INFO` lines for the targets and the expected version; the key read only when there is no problem; and `exec node ... run` with every input in its environment
    - `read_ssm_parameter` keeps only the AWS error code, removes its temporary file right after the read, and never prints the value. No `set -x`. `SKIP_CHECK_SKIPPED=20` carries the comment that ties it to `EXIT_CODES`
    - Give the file mode 100755 like scripts 01 to 04 (`git update-index --chmod=+x` once it is added)
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.5, 3.1, 3.2, 3.3, 3.4, 11.2, 11.6, 12.3, 12.7, 14.3_

  - [x] 9.2 Update `buildspec-postdeploy.yml` (§10)
    - Update the header comment for `PARAM_STORE_HIERARCHY` and `AWS_REGION`. Add `env: variables: VERIFY_SKIP: "false"` with its `# >!` comments. Add the `pre_build` test step after the static site's commands, and script 05 at the end of `build`, after the "static generation complete" echo
    - _Requirements: 1.1, 1.7, 12.2, 16.2_

  - [x] 9.3 Update `buildspec.yml` (§10)
    - Add the two `generate-put-ssm.py` calls right after the `GitHubToken` call: the key with no value, and the skip switch with `--value false`
    - _Requirements: 11.1, 12.1_

  - [x] 9.4 Update the stale structure assertion
    - In `application-infrastructure/tests/postdeploy/unit/buildspec-structure.test.js`, change `toBe(4)` to `toBe(5)` and add `expect(scriptCommands[4]).toContain('05-verify-deployment.sh')`. Change nothing else in `tests/postdeploy`
    - Optional: run the file once with the borrowed-dependency command in [`0-0-7-revive-postdeploy-tests/ISSUE.md`](../0-0-7-revive-postdeploy-tests/ISSUE.md), limited to this file
    - _Requirements: 16.7_

  - [x] 9.5 Write the buildspec and Wrapper tests
    - Create `buildspec-and-wrapper-tests.jest.mjs`
    - Parse both buildspecs with js-yaml and check §10: script 05 is the last script in `build`, run with `bash -e`; `VERIFY_SKIP` is the string `"false"`; `pre_build` installs this package with `npm ci --include=dev` and runs its tests after the static site; the main buildspec creates the key parameter with no value and the skip parameter with `--value false`
    - Check the Wrapper's text: `set -euo pipefail`, the log prefix, no `set -x` or `xtrace`, both parameter names, `SKIP_CHECK_SKIPPED` equal to `EXIT_CODES.SKIP_CHECK_SKIPPED`, and `key_value` used only in its assignments and in the `exec` environment
    - Run `bash -n` on the Wrapper through `execFileSync`, with a 10-second timeout
    - Run the file; all tests pass
    - _Requirements: 1.1, 1.2, 11.1, 11.6, 12.1, 12.2, 16.2, 16.3, 16.6_

- [x] 10. Phase 2 checkpoint
  - Run the package's tests and the Read Function suite, as in task 8
  - Confirm with `git diff` that no upstream template, pipeline file, or IAM policy changed
  - The first deploy with this phase is live run 13.1
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 1.8, 1.9, 16.8_

- [x] 11. Documentation (Phase 3)

  - [x] 11.1 Write `docs/developer/post-deploy-verification.md`
    - Follow the developer row of the §Documentation Plan table: what the Verifier checks and what stays manual; running it locally, with the variables and exit codes; getting a key for each stage (register on the stage's site at `/register/`, where the key is shown once, or regenerate it at `/profile/`, then have an admin promote the account to the private tier as in `docs/admin-ops/user-management.md`); storing it in the parameter, in the console or with `read -rs` and `aws ssm put-parameter --type SecureString --overwrite`, so it is neither echoed nor kept in shell history; and changing or adding a check
    - State the 120-day limit until [issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5) is fixed, link the issue, and give both workarounds: an admin removes `ttl` (`update-item ... REMOVE #ttl`, which a later key regeneration sets again), or the key is regenerated and the parameter updated before 120 days pass. Say that a lapsed key makes S2 warn and the run continue without a key
    - _Requirements: 11.7, 17.1, 17.2_

  - [x] 11.2 Write `docs/admin-ops/post-deploy-verification.md`
    - Follow the admin-ops row of the §Documentation Plan table: each check and its severity; reading the sub-check lines, the summary, and the outcomes with their exit codes; the Logs Insights query; turning the skip switch on and off for one stage; what a failed or inconclusive run blocks, and the pipeline failure notification; retrying the stage from the console or the CLI after the window resets, including the execution-ID lookup; the request budget; how verification traffic appears in the logs; and the known limits
    - _Requirements: 17.3_

  - [x] 11.3 Add the query to `docs/admin-ops/cloudwatch-insights-queries.json`
    - Add a "Post-Deploy Verification Runs" entry, in the same shape as the existing entries (`name`, `description`, `logGroups`, `query`), on `/aws/codebuild/${Prefix}-${ProjectId}-${StageId}-PostDeploy`, with the query from §Documentation Plan. Confirm the file still parses as JSON
    - _Requirements: 17.4_

  - [x] 11.4 Update `ARCHITECTURE.md`
    - In "Post-Deploy Pipeline", add a `05-verify-deployment.sh` box after `04-consolidate-and-deploy.sh` and a note on the two `pre_build` test packages. Give the diagram's code fence the `text` language while editing it
    - _Requirements: 17.5_

  - [x] 11.5 Update `DEPLOYMENT.md`
    - In "Post Deployment Documentation Generation and CloudFront", add that the stage also verifies each deployment, needs no setup, and can use a private-tier key for a higher limit, with links to both new pages
    - _Requirements: 17.6_

  - [x] 11.6 Update the documentation indexes
    - Add a link to the new page in `docs/developer/README.md` and in `docs/admin-ops/README.md`
    - _Requirements: 17.7_

  - [x] 11.7 Update `TODO-MANUAL-VERIFY.md`
    - In `.kiro/specs/0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md`, add a section near the top with the §Documentation Plan mapping of manual items to sub-checks, and an "Automated by post-deploy verification" note on each section it covers
    - _Requirements: 17.8_

  - [x] 11.8 Add the `CHANGELOG.md` entry
    - Append the §Documentation Plan draft to `### Added` under `## [v0.0.7] (unreleased)`. Confirm with `git diff` that the change only adds lines
    - _Requirements: 17.9_

- [x] 12. Phase 3 checkpoint
  - Check every new and changed Markdown file: relative links and anchors resolve, every code fence has a language, there is one H1, and no heading level is skipped
  - Confirm `docs/admin-ops/cloudwatch-insights-queries.json` parses
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9_

- [ ] 13. Live verification (Phase 4; needs deployments and a person)

  - [~] 13.1 Run on `test` without a key
    - Deploy to `test` with the key parameter still `BLANK`
    - Expected: the PostDeploy log shows the verifier tests in `pre_build`, then outcome `passed`, S2 SKIP "no key configured: placeholder BLANK", X2 SKIP "no custom domain for this stage", and one `VERIFY_REPORT` line that the Logs Insights query finds in `/aws/codebuild/<Prefix>-<ProjectId>-test-PostDeploy`
    - _Requirements: 1.9, 16.9_

  - [~] 13.2 Run on `test` with a key
    - Register an account on the `test` site, have it promoted to the private tier, and store its key in `test`'s `Mcp_PostDeployTestVerifyApiKey` parameter, as the developer page describes. Retry the PostDeploy stage
    - Expected: S2.1 to S2.3 PASS, which also proves the post-deploy role can decrypt the parameter; the report's `key.used` is `true`
    - Never paste the key into this file, a ticket, or a log search
    - _Requirements: 11.2, 16.9_

  - [~] 13.3 Run on `beta` with the edge subset
    - Promote the change to `beta` through the normal branch flow
    - Expected: X2.1 to X2.4 PASS, which shows CloudFront forwards the three MCP headers on `beta`
    - _Requirements: 9.6, 16.9_

  - [~] 13.4 Run with the skip switch on
    - Set `test`'s `Mcp_PostDeployTestVerifySkip` parameter to `true` and retry the PostDeploy stage, then set it back to `false`
    - Expected: outcome `skipped`, the `WARN`, and no verification requests in the Read Function log. The next run verifies again
    - _Requirements: 12.6, 16.9_

- [~] 14. Final verification
  - The package's tests and the Read Function suite pass
  - Live runs 13.1 to 13.4 behaved as expected
  - No file contains a real key: search the working tree for `atl_[0-9a-f]{32}` outside test fixtures that generate keys
  - Review `git status` and leave the commit to the user
  - _Requirements: 16.8, 16.9_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "5.2", "5.3"] },
    { "id": 3, "tasks": ["2.3"] },
    { "id": 4, "tasks": ["2.4"] },
    { "id": 5, "tasks": ["2.5", "2.6", "3.1"] },
    { "id": 6, "tasks": ["3.2", "3.3", "4.1"] },
    { "id": 7, "tasks": ["4.2"] },
    { "id": 8, "tasks": ["4.3", "4.4"] },
    { "id": 9, "tasks": ["6.1"] },
    { "id": 10, "tasks": ["6.2"] },
    { "id": 11, "tasks": ["6.3"] },
    { "id": 12, "tasks": ["6.4"] },
    { "id": 13, "tasks": ["6.5"] },
    { "id": 14, "tasks": ["6.6"] },
    { "id": 15, "tasks": ["7.1"] },
    { "id": 16, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6"] },
    { "id": 17, "tasks": ["8"] },
    { "id": 18, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 19, "tasks": ["9.5"] },
    { "id": 20, "tasks": ["10"] },
    { "id": 21, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8"] },
    { "id": 22, "tasks": ["12"] },
    { "id": 23, "tasks": ["13.1"] },
    { "id": 24, "tasks": ["13.2", "13.3"] },
    { "id": 25, "tasks": ["13.4"] },
    { "id": 26, "tasks": ["14"] }
  ]
}
```

Every implementation sub-task in Phase 1 edits the one Verifier file, so those run one per wave. Tasks in the same wave touch different files. Checkpoints 8, 10, and 12 gate the next phase.

```text
Phase 1
  1 (skeleton, test package) ──► 2 (input decisions) ──► 3 (HTTP client) ──► 4 (output, outcome, report)
                                                                                   │
  5 (fake server, run helper) ─────────────────────────────────────────────────────┤
                                                                                   ▼
                                     6 (engine, catalog, checks) ──► 7 (commands, end-to-end tests) ──► 8

Phase 2
  8 ──► 9 (Wrapper, buildspecs, stale assertion, buildspec and Wrapper tests) ──► 10

Phase 3
  10 ──► 11 (documentation) ──► 12

Phase 4
  12 ──► 13 (live runs) ──► 14 (final verification)
```

## Notes

### Testing posture

- New tests are Jest `*.jest.mjs` files in `tests/postdeploy-verify`, and property tests are named `*-property-tests.jest.mjs`. No test runs `npm test`, runs the Wrapper, or makes a network or AWS call: every file that sends requests uses the fake server and `guardRealFetch()`.
- The only child process a test starts is `bash -n` on the Wrapper, through `execFileSync`, with a timeout.
- `sleep` resolves at once and the clock is fixed, so no test waits.
- Every exported function gets JSDoc with `@param`, `@returns`, and `@example`, and security-relevant lines carry `// >!` (JavaScript) or `# >!` (bash and YAML) comments.

### Deployment-dependent work

The optional local run in task 8 and all of task 13 need deployed stages, and task 13.2 also needs a person to register an account and store its key. Everything else runs locally.

### Secrets

Never commit a real API key, and never paste one into this file, a test, or a log search. Tests generate keys, and the redaction property test proves they never reach any output.

### Related specs

- [`0-0-7-revive-postdeploy-tests`](../0-0-7-revive-postdeploy-tests/ISSUE.md) edits the same `buildspec-structure.test.js` and plans convention checks for script 05. Task 9.4 changes only the script count and order.
- [`0-0-7-rate-limit-client-ip-spoofing`](../0-0-7-rate-limit-client-ip-spoofing/ISSUE.md) changes the public rate-limit identity. The Verifier never sends `X-Forwarded-For`, so neither its budget nor its results depend on that fix.
- [`0-0-7-api-gateway-live-alias`](../0-0-7-api-gateway-live-alias/ISSUE.md) may move API traffic to the `live` alias. CloudFormation still finishes the traffic shift before post-deploy starts, so a single version check (V1) still holds.
