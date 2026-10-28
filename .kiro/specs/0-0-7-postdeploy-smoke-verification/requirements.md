# Requirements Document

## Introduction

**Post-deploy smoke verification.** After every deployment, the post-deploy stage runs a new script, `05-verify-deployment.sh`, that sends a fixed set of read-only requests to the stage that was just deployed and checks the answers. It proves that the live server is the release that was built, that it still speaks both MCP protocol eras, and that its CORS and header handling work through API Gateway. Deterministic protocol checks fail the build, which stops promotion when the pipeline promotes. Checks that depend on backends, the edge, or a stored key only warn.

It automates the deterministic parts of the dual-era [manual verification checklist](../0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md): sections B to G, and parts of A, H, and I. Real-client checks, CloudWatch-based checks, and repository state stay manual. See [PLAN.md](PLAN.md) for the analysis, the check table (section 3), the design sketch (section 5), and the answered questions. Every planning question is answered.

### Guiding constraints

1. **Read-only.** Every request is a read-only MCP method or a CORS preflight. Nothing creates, changes, or deletes data, and nothing calls Amazon Bedrock.
2. **Inside this repository.** No upstream Atlantis template, pipeline stack, IAM role, or IAM policy changes. The System uses only permissions the upstream post-deploy role already grants.
3. **Deterministic core, advisory edges.** Only checks whose answers depend on this repository's code and template can fail the build. Checks that depend on backends, CloudFront, or the stored key warn.
4. **Never silently green.** A run that could not verify the core does not pass, and every skipped run says so in the log.
5. **Secrets stay out of output.** The key never appears in command-line arguments, logs, the report, or the report line, and request headers are never logged.
6. **Existing conventions.** The Wrapper follows post-deploy scripts 01 to 04, the Verifier follows the dependency-free CommonJS helpers next to them, and new tests are Jest.
7. **Small footprint.** A keyless run fits twice into the public tier's 50 requests per hour. A keyed run uses one request of the client IP's budget.

### Decisions carried forward from PLAN.md

| # | Decision | From |
|---|----------|------|
| 1 | Core checks (P1 to P6, V1, X1) fail the build; advisory checks (T1, X2, S1, S2) warn | Q1 C, Q12 A |
| 2 | `05-verify-deployment.sh` runs last, after the docs are published | Q2 A |
| 3 | The full suite runs against the raw `execute-api` URL; an edge subset runs against the stage's custom domain when it has one | Q3 D |
| 4 | The key is a private-tier key per stage, stored in `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifyApiKey`, which the main build creates as `BLANK`. No IAM change | Q4 B, Q17 |
| 5 | No polling: CloudFormation finishes the traffic shift before post-deploy starts, so the version is checked once | Q5 |
| 6 | A thin bash wrapper plus a dependency-free Node verifier that uses the built-in `fetch` | Q6 B |
| 7 | A new Jest package, `tests/postdeploy-verify`, run in the post-deploy `pre_build` phase | Q7 B |
| 8 | Live `supportedVersions` must contain a fixed floor; revisions beyond it only need to be accepted | Q8 B |
| 9 | The expected version comes from `write_release_version.py`, not from a second changelog parser | Q9 A |
| 10 | Results go to log lines, the exit code, a JSON report, and one `VERIFY_REPORT` log line | Q10 B, Q14 B |
| 11 | HTTP `429` on a core check makes the run `inconclusive`, which fails the build. Retrying is manual | Q13 B |
| 12 | Skip switch: an SSM parameter created as `false`, with `VERIFY_SKIP: "false"` declared in the post-deploy buildspec as the backup | Q15 |
| 13 | Use does not renew private keys today ([#5](https://github.com/63Klabs/atlantis-mcp/issues/5)). The limit and its workarounds are documented, not fixed here | Q16, Q17 |

### Additions beyond PLAN.md

Small refinements made while writing these requirements. Strike any you disagree with.

- V1 also checks the legacy `serverInfo.version` from P2, at no extra request, matching manual item K1 "on both eras" (Requirement 4.4).
- The "not attempted" rule also applies when P1 gets an HTTP `5xx` after its retry, so a hung function cannot stretch a run to many minutes (Requirement 4.6).
- When P1 gets no answer because of HTTP `429`, sub-checks that need its baseline are SKIP rather than FAIL, and the rest still run (Requirement 10.6).
- Requests are sent one at a time, identify themselves with a `User-Agent`, never follow redirects, and go only to `https:` targets (or `http:` on the local machine), so the key cannot be sent anywhere unexpected (Requirements 13.1, 13.5 to 13.7).
- The Verifier refuses a report path inside `build/final/`, which is published (Requirement 14.4).
- Property-based tests cover skip-value parsing and key redaction (Requirement 16.5).
- `DEPLOYMENT.md`, the Logs Insights query catalog, and the post-deploy buildspec's header comment are updated (Requirements 1.7, 17.4, 17.6).

## Glossary

- **System**: The post-deploy smoke verification feature as a whole: the Wrapper, the Verifier, their tests, the buildspec changes, the two SSM parameters, and the documentation.
- **Wrapper**: `application-infrastructure/postdeploy-scripts/05-verify-deployment.sh`. It gathers inputs from the build environment, SSM, and the repository, then runs the Verifier.
- **Verifier**: `application-infrastructure/postdeploy-scripts/verify-deployment.js`. It makes every decision, sends every request, and writes every result.
- **Post-deploy buildspec**: `application-infrastructure/buildspec-postdeploy.yml`, run by the upstream pipeline's PostDeploy stage after the stack deploys.
- **Main buildspec**: `application-infrastructure/buildspec.yml`, run by the pipeline's Build stage.
- **Read Function**: The Lambda function that serves `POST /mcp/v1`.
- **Raw target**: The deployed stage's API Gateway endpoint, `https://<restApiId>.execute-api.<region>.amazonaws.com/<apiStageName>/mcp/v1`.
- **Edge target**: `https://<domain>/mcp/v1`, where `<domain>` is the stage's custom domain in `settings.json` (`beta` and `prod` today).
- **Expected version**: The release version that `write_release_version.py` writes to the Read Function's `config/release-version.js`.
- **Revision floor**: `2024-11-05`, `2025-11-25`, and `2026-07-28`. Live `supportedVersions` must contain all three.
- **Extra revision**: A revision in P1's `supportedVersions` that is not in the revision floor.
- **Baseline**: The values from P1 that later checks compare against: `supportedVersions`, `instructions`, and the `X-RateLimit-Limit` header.
- **Check**: A named group of assertions (P1 to P6, V1, X1, X2, T1, S1, S2). Each check is made of sub-checks with their own IDs.
- **Core check**: A check whose failure fails the build: P1 to P6, V1, and X1.
- **Advisory check**: A check whose failure prints `WARN` and does not fail the build: T1, X2, S1, and S2.
- **Sub-check outcome**: PASS, FAIL, or SKIP. An advisory FAIL is printed with the label `WARN`.
- **Run outcome**: `passed`, `failed`, `inconclusive`, `skipped`, or `error`.
- **Counted request**: A POST that reaches the Read Function's rate limiter. A POST rejected with HTTP `401` for an invalid key is not counted, and neither is a preflight, which API Gateway answers.
- **Verification key**: The API key stored in `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifyApiKey`.
- **Key classification**: `present`, `placeholder` (the value `BLANK`), `not-found`, `access-denied`, `error` (any other read failure), or `none` (no key and no read result, as in a local run).
- **Skip switch**: The SSM parameter `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifySkip`, with the `VERIFY_SKIP` environment variable as its backup.
- **Report**: The JSON file the Verifier writes, `build/verify/report.json` by default.
- **Report line**: The single `VERIFY_REPORT {json}` log line the Verifier prints per run.

## Requirements

### Requirement 1: Placement and conventions

**User Story:** As an operator, I want every deployment to verify itself in the post-deploy stage, built the same way as the existing post-deploy scripts, so that a broken deploy is caught without anyone running the manual checklist.

#### Acceptance Criteria

1. THE post-deploy buildspec SHALL run `bash -e application-infrastructure/postdeploy-scripts/05-verify-deployment.sh` as the last script of its `build` phase, after `04-consolidate-and-deploy.sh`.
2. THE Wrapper SHALL start with `set -euo pipefail`, run from the repository root like scripts 01 to 04, prefix every line it writes with `[05-verify-deployment]` and a level of `INFO`, `WARN`, or `ERROR`, and write `ERROR` lines to standard error.
3. THE Wrapper SHALL obtain `REST_API_ID` and `API_STAGE_NAME` by sourcing `build/staging/api-spec/env.sh`, which `01-export-api-spec.sh` writes, and SHALL NOT query CloudFormation or API Gateway for them again.
4. IF, after the skip switch is decided (Requirement 12.3), `PREFIX`, `PROJECT_ID`, `STAGE_ID`, `AWS_REGION`, or `PARAM_STORE_HIERARCHY` is not set, or `env.sh` is missing or does not set `REST_API_ID` and `API_STAGE_NAME`, THEN the run SHALL end with outcome `error` and exit code 1, naming what is missing.
5. THE Verifier SHALL be a CommonJS module that uses only the Node.js standard library and the global `fetch`, runs only when invoked as the main module, and exports its checks and decision logic as functions.
6. THE System SHALL send only `server/discover`, `initialize`, `tools/list`, `tools/call` for `list_tools` and `list_templates`, and CORS preflights, and SHALL call no other method or tool.
7. THE post-deploy buildspec's header comment SHALL list `PARAM_STORE_HIERARCHY` and `AWS_REGION` among the variables its scripts use, replacing the note that `PARAM_STORE_HIERARCHY` is not used.
8. THE System SHALL NOT modify upstream Atlantis templates, the pipeline stack, or any IAM role or policy, and SHALL need no permission beyond those the upstream post-deploy service role grants today.
9. THE System SHALL run on every stage where the post-deploy stage runs, and the only stage-dependent behavior SHALL be whether an edge target exists.

### Requirement 2: Targets

**User Story:** As an operator, I want the full suite to test the API Gateway endpoint directly and a subset to test the custom domain, so that a failure points at either the Lambda deploy or the edge.

#### Acceptance Criteria

1. THE Wrapper SHALL build the raw target as `https://${REST_API_ID}.execute-api.${AWS_REGION}.amazonaws.com/${API_STAGE_NAME}/mcp/v1` and pass it to the Verifier as `MCP_URL`.
2. THE Wrapper SHALL resolve the stage's settings by applying `settings-loader.js` to `application-infrastructure/src/static/settings.json` with `STAGE_ID`, and WHERE the resolved settings have a non-empty `domain`, SHALL pass `https://<domain>/mcp/v1` to the Verifier as `MCP_EDGE_URL`.
3. WHERE `MCP_EDGE_URL` is empty, THE Verifier SHALL report every X2 sub-check as SKIP with the reason "no custom domain for this stage".
4. THE Verifier SHALL send P1 to P6, X1, T1, S1, and S2 to the raw target only, and X2 to the edge target only.
5. THE Wrapper SHALL log the raw target, and the edge target or its absence, at `INFO` before it runs the Verifier.

### Requirement 3: Expected release version

**User Story:** As an operator, I want verification to know which release should be live without a second copy of the version logic, so that a deploy that left stale code running is caught.

#### Acceptance Criteria

1. THE Wrapper SHALL run `application-infrastructure/build-scripts/write_release_version.py`, read `releaseVersion` from the generated `application-infrastructure/src/lambda/read-function/config/release-version.js`, and pass it to the Verifier as `EXPECTED_VERSION`.
2. THE System SHALL NOT parse `CHANGELOG.md` itself.
3. IF `write_release_version.py` exits with a non-zero status, or the generated file yields no version, THEN the run SHALL end with outcome `error` and exit code 1.
4. THE Wrapper SHALL log the expected version at `INFO`.

### Requirement 4: Core checks P1 and V1, discovery and version

**User Story:** As an operator, I want the first request to prove that the endpoint answers, speaks the modern era, and runs the release that was just built, so that every later check has a known baseline.

#### Acceptance Criteria

1. THE Verifier SHALL send P1, a `server/discover` request with no API key and no declared revision, to the raw target as the first request of the run.
2. P1 SHALL pass only WHEN the response has HTTP status 200 and a JSON-RPC result with no `error`, `resultType` equal to `complete`, `_meta["io.modelcontextprotocol/serverInfo"].name` equal to `atlantis-mcp-server`, no top-level `protocolVersion` or `serverInfo`, a non-empty `instructions` string, and a `supportedVersions` array that contains every revision in the revision floor.
3. THE Verifier SHALL keep P1's `supportedVersions`, `instructions`, and `X-RateLimit-Limit` header as the baseline for later checks.
4. V1 SHALL pass only WHEN P1's `_meta["io.modelcontextprotocol/serverInfo"].version` and the `serverInfo.version` of P2's `initialize` response for `2025-11-25` both equal the expected version. V1 SHALL send no requests of its own.
5. IF V1 fails, THEN its reason SHALL give the expected version and each reported version.
6. IF P1 gets no HTTP response, or an HTTP `5xx` status, after its retry, THEN THE Verifier SHALL report every remaining sub-check against the raw target as FAIL with the reason "not attempted: raw target did not answer P1", SHALL send those sub-checks no requests, and SHALL still run X2 when an edge target exists.

### Requirement 5: Core check P2, legacy `initialize`

**User Story:** As an operator with legacy clients in the field, I want the handshake checked on every deploy, so that a change that breaks `initialize` never reaches promotion.

#### Acceptance Criteria

1. THE Verifier SHALL send five `initialize` requests to the raw target, four with `params.protocolVersion` set to `2025-11-25`, `2024-11-05`, `2025-06-18`, and `2099-01-01`, and one with no `params`.
2. P2 SHALL pass only WHEN every response has no `error` and `result.protocolVersion` is, in the same order, `2025-11-25`, `2024-11-05`, `2024-11-05`, `2025-11-25`, and `2025-11-25`.
3. P2 SHALL require the result for `2025-11-25` to have exactly the keys `capabilities`, `instructions`, `protocolVersion`, and `serverInfo`, with `serverInfo.name` equal to `atlantis-mcp-server`.
4. P2 SHALL require the `instructions` of every response to be byte-identical to P1's `instructions`.

### Requirement 6: Core checks P3 and P4, protocol errors

**User Story:** As a client developer, I want the deployed server's protocol errors checked through API Gateway, so that the `-32022` and `-32020` behavior clients rely on is proven on the live stage, including that the `Mcp-*` headers reach the function.

#### Acceptance Criteria

1. THE Verifier SHALL send P3 as two `tools/list` requests to the raw target: one with the header `MCP-Protocol-Version: 2099-01-01`, and one with `params._meta["io.modelcontextprotocol/protocolVersion"]` set to `2099-01-01` and no header.
2. P3 SHALL pass only WHEN both responses have HTTP status 200 and `error.code` `-32022`, with `error.data.declaredRevision` equal to `2099-01-01` and `error.data.supportedVersions` equal to P1's `supportedVersions`.
3. THE Verifier SHALL send P4 as five requests to the raw target:
   1. `MCP-Protocol-Version: 2026-07-28` and `Mcp-Method: tools/call` on a `tools/list` body, expecting `-32020` with `error.data.headerValue` equal to `tools/call`
   2. `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/call`, and `Mcp-Name: list_categories` on a `tools/call` body for `list_tools`, expecting `-32020` with `error.data.headerValue` equal to `list_categories`
   3. the second request with `Mcp-Name: list_tools` instead, expecting no `error` and `resultType` equal to `complete`
   4. the first request with its header names written as `mcp-protocol-version` and `MCP-METHOD`, expecting `-32020`
   5. `Mcp-Method: tools/call` and `Mcp-Name: something_else` on a `tools/list` body with no revision declared, expecting no `error` and a non-empty `tools` array
4. P4 SHALL pass only WHEN every request gets its expected answer.
5. THE Verifier SHALL send header names exactly as written in criterion 3, without changing their case.

### Requirement 7: Core checks P5 and P6, tool listing and tool calls

**User Story:** As a client developer, I want the tool catalog and the response envelope checked per revision on the live stage, so that each era gets exactly the fields it expects.

#### Acceptance Criteria

1. THE Verifier SHALL send P5 as five `tools/list` requests to the raw target, declaring in turn: `2026-07-28` in the `MCP-Protocol-Version` header; `2026-07-28` in `params._meta` with no header; `2025-11-25` in the header; `2024-11-05` in the header; and no revision.
2. P5 SHALL require both `2026-07-28` responses to have no `error`, `resultType` equal to `complete`, a non-negative integer `ttlMs`, a non-empty string `cacheScope`, `_meta["io.modelcontextprotocol/serverInfo"].name` equal to `atlantis-mcp-server`, and a non-empty `tools` array.
3. P5 SHALL require the `2025-11-25`, `2024-11-05`, and no-revision responses to have no `error`, a non-empty `tools` array, and none of `ttlMs`, `cacheScope`, `resultType`, or `_meta` in the result.
4. P5 SHALL require every tool in the `2026-07-28` and `2025-11-25` responses to have `title` and `annotations`, with `annotations.readOnlyHint` equal to `true` and `annotations.openWorldHint` equal to `false`, and SHALL require no tool in the `2024-11-05` and no-revision responses to have `title` or `annotations`.
5. P5 SHALL require all five responses to list the same tool names in the same order.
6. WHERE P1's `supportedVersions` include extra revisions, THE Verifier SHALL send one more `tools/list` per extra revision, declaring it in the header, and P5 SHALL require each to be accepted (no `-32022`) with a non-empty `tools` array, with no era-specific expectations.
7. THE Verifier SHALL send P6 as two `tools/call` requests for `list_tools` with empty `arguments`, one declaring `2026-07-28` in the header and one declaring `2025-11-25`.
8. P6 SHALL require the `2026-07-28` result to have no `error`, `resultType` equal to `complete`, and a `_meta` containing `io.modelcontextprotocol/serverInfo`, and the `2025-11-25` result to have no `error`, a non-empty `content` array, and neither `resultType` nor `_meta`.
9. P5 and P6 SHALL assert the presence, type, and shape of fields, and SHALL NOT assert configured values such as the `ttlMs` duration or the number of tools.

### Requirement 8: Core check X1, CORS preflight

**User Story:** As the developer of a browser-hosted client, I want the preflight checked on every deploy, so that a template change that drops a header from the allow-list is caught before promotion.

#### Acceptance Criteria

1. THE Verifier SHALL send X1 as an `OPTIONS` request to the raw target with `Origin` set to `MCP_ORIGIN`, `Access-Control-Request-Method: POST`, and `Access-Control-Request-Headers: MCP-Protocol-Version,Mcp-Method,Mcp-Name,Content-Type`.
2. X1 SHALL pass only WHEN the response has HTTP status 200, `Access-Control-Allow-Headers` contains `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` compared without regard to case, `Access-Control-Allow-Methods` contains `POST`, and `Access-Control-Allow-Origin` is `*` or equals `MCP_ORIGIN`.

### Requirement 9: Advisory checks T1, X2, S1, and S2

**User Story:** As an operator, I want backend, edge, and key problems reported on every deploy without blocking it, so that I hear about them while a protocol regression still stops the pipeline.

#### Acceptance Criteria

1. THE Verifier SHALL send T1 as a `tools/call` request for `list_templates` with empty `arguments` to the raw target, declaring `2026-07-28` in the header. T1 SHALL pass only WHEN the response has no `error` and its first `content` item has type `text` with text that parses as JSON to a value other than `null`.
2. THE Verifier SHALL send S1 as an `initialize` request to the raw target with a fixed, made-up value in `X-API-Key`. S1 SHALL pass only WHEN the response has HTTP status `401`.
3. WHERE the key classification is `present`, THE Verifier SHALL send S2 as two `initialize` requests to the raw target, before any other request carries the key: the first with the key in `X-API-Key`, the second with `Authorization: Bearer <key>`. Each SHALL pass only WHEN the response has HTTP status 200, no `error`, and no `X-MCP-Auth-Status: degraded` header. A further S2 sub-check SHALL pass only WHEN the first response's `X-RateLimit-Limit` is greater than P1's.
4. WHEN the first S2 request passes and the limit sub-check does not fail, THE Verifier SHALL send the key in `X-API-Key` on every later POST. Otherwise, THE Verifier SHALL run the remaining checks without a key, and S2's reason SHALL say so.
5. WHERE the key classification is not `present`, THE Verifier SHALL report S2 as SKIP with the classification as the reason, for example "no key configured: placeholder BLANK".
6. WHERE an edge target exists, THE Verifier SHALL run X2 against it as four sub-checks: a preflight with the same headers and pass conditions as X1; a `server/discover` whose reported version equals the expected version; a `tools/list` with `MCP-Protocol-Version: 2026-07-28` and `Mcp-Method: tools/call`, expecting `-32020`; and a `tools/call` for `list_tools` with `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/call`, and `Mcp-Name: list_categories`, expecting `-32020`.
7. IF an X2 mismatch request gets a normal result instead of `-32020`, THEN its reason SHALL say that the edge may not be forwarding the `MCP-Protocol-Version` or `Mcp-*` headers.

### Requirement 10: Outcomes, severity, and exit codes

**User Story:** As an operator, I want each run outcome to mean one thing, so that a green post-deploy stage always means the core was verified and a red one says why.

#### Acceptance Criteria

1. THE Verifier SHALL treat P1 to P6, V1, and X1 as core checks and T1, X2, S1, and S2 as advisory checks.
2. THE Verifier SHALL record each sub-check under a stable ID of the form `<check>.<n>`, for example `P2.3`, SHALL NOT reuse an ID for a different assertion, SHALL give each sub-check exactly one outcome of PASS, FAIL, or SKIP, and SHALL give every FAIL and SKIP a reason.
3. THE Verifier SHALL print an advisory FAIL with the label `WARN`, and an advisory FAIL or SKIP SHALL NOT change the run outcome.
4. IF a sub-check's request gets HTTP `429`, THEN that sub-check SHALL be SKIP with the reason "no answer: rate limited (HTTP 429)".
5. THE run outcome and exit code SHALL be the first that applies: `skipped` with exit code 0 when the skip switch is on; `error` with exit code 1 after a configuration error or an internal error; `failed` with exit code 1 when any core sub-check failed; `inconclusive` with exit code 1 when any core sub-check is SKIP, which happens only for HTTP `429` (criterion 4) or a missing baseline (criterion 6); otherwise `passed` with exit code 0, listing any warnings and skips.
6. IF P1 gets HTTP `429`, THEN sub-checks that compare against the baseline SHALL be SKIP with the reason "no baseline: P1 had no answer", and every other sub-check SHALL still run.
7. WHEN the run outcome is `inconclusive`, THE Verifier SHALL log at `WARN` when the rate-limit window resets, taken from the `Retry-After` header of the last `429` response or, if it has none, from `X-RateLimit-Reset`; the retry command `aws codepipeline retry-stage-execution --pipeline-name "${PREFIX}-${PROJECT_ID}-${STAGE_ID}-Pipeline" --stage-name PostDeploy --retry-mode FAILED_ACTIONS --pipeline-execution-id "<execution-id>"` with the pipeline name filled in; and how to look up the execution ID.
8. THE System SHALL NOT wait, sleep, or retry after HTTP `429`, and SHALL NOT retry the stage automatically.
9. IF the Verifier hits an unexpected internal error, THEN it SHALL log an `ERROR` that contains neither request headers nor the key, write the report with outcome `error` if it can, and exit with code 1.

### Requirement 11: Verification key

**User Story:** As an operator, I want the Verifier to use a stored key when one is configured and to run without it otherwise, so that verification does not depend on the public rate limit and a missing or lapsed key never blocks a deploy.

#### Acceptance Criteria

1. THE main buildspec SHALL create `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifyApiKey` by running `generate-put-ssm.py` with no value, next to the existing `GitHubToken` call, so that the parameter starts as a `SecureString` holding `BLANK` and later builds never overwrite a stored key.
2. THE Wrapper SHALL read the parameter with `aws ssm get-parameter --with-decryption`, using the post-deploy role's existing permissions, and SHALL pass its value to the Verifier only in the `MCP_API_KEY` environment variable, never as a command-line argument.
3. THE Wrapper SHALL pass the result of the read in `MCP_KEY_STATUS`, and THE Verifier SHALL classify the key as `present`, `placeholder`, `not-found`, `access-denied`, `error`, or `none`.
4. WHEN the key classification is not `present`, THE Verifier SHALL run without a key and report S2 as SKIP, as in Requirement 9.5.
5. WHEN the key classification is `access-denied` or `error`, THE System SHALL log a `WARN`, since a stored key may be unreachable. `placeholder` and `not-found` SHALL be logged at `INFO`.
6. THE System SHALL NOT write the key, or any request header, to the build log, the report, or the report line, and the Wrapper SHALL NOT enable shell tracing (`set -x`).
7. THE System SHALL accept a key of any authenticated tier. The documented setup SHALL be one private-tier key per stage, each from that stage's own user pool.

### Requirement 12: Skip switch

**User Story:** As an operator facing a known issue, I want to turn verification off for one stage without a commit and be reminded on every run that it is off, so that a skip is deliberate and never forgotten.

#### Acceptance Criteria

1. THE main buildspec SHALL create `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifySkip` by running `generate-put-ssm.py` with `--value false`, so that each stage starts with verification on and later builds never overwrite an operator's setting.
2. THE post-deploy buildspec SHALL declare `VERIFY_SKIP: "false"` explicitly under `env: variables`.
3. THE System SHALL decide the skip switch before it gathers any other input or sends any request. WHEN the Wrapper reads the SSM parameter, the parameter's value SHALL decide. WHEN the parameter does not exist, or the Verifier runs without the Wrapper, `VERIFY_SKIP` SHALL decide. IF the read fails for any other reason, including an unset `PARAM_STORE_HIERARCHY`, THEN `VERIFY_SKIP` SHALL decide and a `WARN` SHALL be logged.
4. THE System SHALL treat a value equal to `true`, after trimming whitespace and ignoring case, as on; a value equal to `false`, compared the same way, as off; and any other value as off, with a `WARN` naming the source and the first 32 characters of the value.
5. THE System SHALL log at `INFO`, on every run, which source decided and the resolved value.
6. WHEN the skip switch is on, THE System SHALL log a `WARN` that deployment verification was skipped, naming the source and how to turn it back on, SHALL produce the report and the report line with outcome `skipped`, and SHALL exit with code 0 without sending any request.
7. THE skip decision SHALL be made by the Verifier. The Wrapper SHALL only gather the raw values.

### Requirement 13: Request behavior and budget

**User Story:** As an operator, I want verification to be quick, bounded, and careful with the key, so that it never slows a deploy noticeably, exhausts a rate limit, or sends the key somewhere unexpected.

#### Acceptance Criteria

1. THE Verifier SHALL send requests one at a time, in the order P1, S1, S2, P2, P3, P4, P5, P6, T1, X1, X2.
2. THE Verifier SHALL abort any request that has not completed within `VERIFY_REQUEST_TIMEOUT_MS` milliseconds.
3. IF a request fails with a network error or a timeout, or gets HTTP `502`, `503`, or `504`, THEN THE Verifier SHALL retry it once. THE Verifier SHALL NOT retry any other response, including `429` and other `4xx` statuses.
4. Not counting retries, THE Verifier SHALL send at most 21 counted requests to a stage without an edge target and 24 to a stage with one, plus one per extra revision. WHEN S2 accepts the key, only P1 SHALL count against the client IP.
5. THE Verifier SHALL send `Content-Type: application/json` and a JSON-RPC 2.0 body with a unique `id` on every POST, and `User-Agent: atlantis-mcp-postdeploy-verify` on every request.
6. THE Verifier SHALL NOT follow redirects. IF a response is a redirect, THEN the sub-check SHALL fail with the status and the redirect target's host in the reason.
7. IF `MCP_URL` or a non-empty `MCP_EDGE_URL` is not an `https:` URL, other than an `http:` URL for `localhost` or `127.0.0.1`, THEN the run SHALL end with outcome `error` before any request is sent.
8. THE Verifier SHALL send preflights without an API key or an `Authorization` header.

### Requirement 14: Reporting

**User Story:** As an operator reading a build log or searching past runs, I want every run summarized the same way, so that I can see at a glance what failed and query results across deploys.

#### Acceptance Criteria

1. THE Verifier SHALL print one line per sub-check with its label (PASS, FAIL, WARN, or SKIP), its ID, and its title, followed by the reason for FAIL, WARN, and SKIP.
2. THE Verifier SHALL print a summary with the number of core sub-checks passed, failed, and skipped, the number of advisory sub-checks passed, warned, and skipped, and the run outcome. Lines other than sub-check lines and the report line SHALL use the `[05-verify-deployment]` prefix and a level.
3. THE Verifier SHALL be the only component that writes the report and the report line. The Wrapper SHALL pass any configuration error it detects to the Verifier, so that the run still produces both.
4. THE Verifier SHALL write the report as JSON to `VERIFY_REPORT_PATH`, creating its directory if needed. IF that path resolves inside `build/final/`, THEN the run SHALL end with outcome `error`, because that directory is published.
5. THE report SHALL hold: the run outcome and exit code; start and end times in ISO 8601 and the duration; the targets; the expected version and each reported version; P1's `supportedVersions`; the key classification, never the key; the skip switch's source and value; `PREFIX`, `PROJECT_ID`, and `STAGE_ID` when set; the counts; and, for each sub-check, its ID, title, severity, outcome, reason, and duration in milliseconds.
6. THE Verifier SHALL print, once for every run that reaches it, a line made of `VERIFY_REPORT`, one space, and the report as compact single-line JSON, following the `DISCOVERY_TOOL_CALL` and `DOC_AI_USAGE` convention, so that runs can be found with CloudWatch Logs Insights in `/aws/codebuild/${Prefix}-${ProjectId}-${StageId}-PostDeploy`.
7. WHEN a sub-check fails, its reason SHALL name the asserted field with the expected and actual values, and SHALL include at most 300 characters of the response body.
8. THE log, the report, and the report line SHALL NOT contain the key, any request header, or more than 300 characters of any one response body.

### Requirement 15: Local use

**User Story:** As a developer, I want to run the same checks from my machine against any deployed stage, so that I can verify a stage without a pipeline run or the manual checklist.

#### Acceptance Criteria

1. THE Verifier SHALL run with `node application-infrastructure/postdeploy-scripts/verify-deployment.js` when only `MCP_URL` and `EXPECTED_VERSION` are set, on the Node.js version in the project's `.nvmrc` files, with no flags and no installed packages.
2. THE Verifier SHALL read these environment variables, whose names match the setup block in `TODO-MANUAL-VERIFY.md` where the two overlap: `MCP_URL` (required), `MCP_EDGE_URL` (empty skips X2), `EXPECTED_VERSION` (required), `MCP_API_KEY` (empty runs without a key), `MCP_KEY_STATUS` (default `none`), `MCP_ORIGIN` (default `https://example.com`), `VERIFY_REQUEST_TIMEOUT_MS` (default `30000`), `VERIFY_REPORT_PATH` (default `build/verify/report.json`, relative to the working directory), and `VERIFY_SKIP` (default `false`).
3. WHEN `MCP_API_KEY` is set and `MCP_KEY_STATUS` is not, THE Verifier SHALL classify the key as `present`.
4. IF `MCP_URL` is missing or is not a URL, `EXPECTED_VERSION` is missing or not of the form `<major>.<minor>.<patch>`, or `VERIFY_REQUEST_TIMEOUT_MS` is not a positive integer, THEN the run SHALL end with outcome `error`, naming the variable, before any request is sent.

### Requirement 16: Testing

**User Story:** As a maintainer, I want the Verifier's logic covered by tests that run before it does, so that a broken Verifier fails the build early instead of passing or failing deploys wrongly.

#### Acceptance Criteria

1. THE System SHALL add a self-contained Jest package at `application-infrastructure/tests/postdeploy-verify/` with its own `package.json` and a committed `package-lock.json`, with Jest and every other development dependency pinned to an exact version, and with test files named `*.jest.mjs`.
2. THE post-deploy buildspec's `pre_build` phase SHALL install the package with `npm ci --include=dev` and run its tests after the static site's tests, so that a failing test fails the build before any post-deploy script runs.
3. THE tests SHALL make no network or AWS calls, SHALL replace `fetch` with a fake, and SHALL NOT invoke `npm test` or run the Wrapper.
4. THE tests SHALL cover at least: the pass and fail conditions of every check against canned responses; every key classification; skip precedence and value parsing; every run outcome with its exit code; HTTP `429` on core checks, on advisory checks, and on P1; the retry rules; the "not attempted" path; S2 falling back to no key; the number of counted requests for a stage with and without an edge target, each with and without a key; redirect refusal; the URL scheme rule; and the report path rule.
5. THE tests SHALL include property-based tests with fast-check showing that only a value equal to `true` after trimming and ignoring case turns the skip switch on, and that for any key value the key never appears in the log output, the report, or the report line.
6. THE tests SHALL check that the post-deploy buildspec runs `05-verify-deployment.sh` last in `build` with `bash -e`, declares `VERIFY_SKIP: "false"` under `env: variables`, and installs and runs this package in `pre_build`, and that the main buildspec creates both parameters with `generate-put-ssm.py`, the key with no value and the skip switch with `--value false`.
7. THE `tests/postdeploy/unit/buildspec-structure.test.js` file SHALL expect five scripts, the fifth being `05-verify-deployment.sh`. No other change SHALL be made to `tests/postdeploy`.
8. THE new suite and the Read Function's existing Jest suite SHALL pass with zero failures.
9. THE System SHALL be verified by hand on deployed stages: `test` without a key, `test` with a key, `beta` with the edge subset, and one run with the skip switch on, as in PLAN section 6, phase 4.

### Requirement 17: Documentation

**User Story:** As a developer setting up a stage, and as an operator reading a failed run, I want the verification documented where each of us looks, so that neither of us has to read the script to act.

#### Acceptance Criteria

1. THE System SHALL add `docs/developer/post-deploy-verification.md`, covering: what the Verifier checks and what stays manual; running it locally; getting a key for each stage and having it promoted to the private tier; storing it in the stage's parameter without echoing it or leaving it in shell history; and adding or changing a check.
2. THE developer page SHALL state that, until [issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5) is fixed, a private key's account is deleted about 120 days after the key was promoted or last regenerated, however often verification uses it. It SHALL link the issue and give both workarounds: an admin removes `ttl` from the key's record, which a later key regeneration sets again; or someone regenerates the key and updates the parameter before 120 days pass. It SHALL say that a lapsed key makes S2 warn and the run continue without a key.
3. THE System SHALL add `docs/admin-ops/post-deploy-verification.md`, covering: each check and its severity; reading the sub-check lines, the summary, and the run outcome; finding report lines with a Logs Insights query; turning the skip switch on and off for one stage; what a failed or inconclusive run blocks (promotion, where the pipeline promotes) and the pipeline failure notification; retrying the stage from the console or the CLI once the rate-limit window resets; the request budget; and how verification traffic appears in the Read Function's discovery logs.
4. THE `docs/admin-ops/cloudwatch-insights-queries.json` catalog SHALL gain a query for `VERIFY_REPORT` lines in the PostDeploy log group.
5. THE `ARCHITECTURE.md` post-deploy diagram SHALL show `05-verify-deployment.sh` after `04-consolidate-and-deploy.sh`.
6. THE `DEPLOYMENT.md` post-deploy section SHALL say that the stage also verifies the deployment, and SHALL link both new pages.
7. THE `docs/developer/README.md` and `docs/admin-ops/README.md` indexes SHALL link the new pages.
8. THE dual-era `TODO-MANUAL-VERIFY.md` SHALL mark the items the Verifier automates and say which items stay manual.
9. THE `CHANGELOG.md` SHALL gain an entry under `Added` in `v0.0.7 (unreleased)` that links this spec and mentions the private-key limit with a link to issue #5, without changing any existing text.

---

## Out of scope

- Fixing issue #5 (findings 5 and 6 in PLAN section 8), finding 2 (`X-Forwarded-For` and the rate-limit identity), or finding 4 (API Gateway invoking `$LATEST` instead of the `live` alias).
- Separating verification from documentation publishing (finding 3).
- Reviving `tests/postdeploy`, beyond the one stale assertion in Requirement 16.7.
- Real MCP client verification, CloudWatch-based checks (A3, K2, K3), and repository state. These stay manual.
- Bedrock-backed or backend-heavy tool calls (I2, I3).
- Load, soak, or conformance testing, and monitoring between deploys.
- Waiting for traffic shifting, automatic retries of the stage, and automatic rollback.
- Notifications for advisory warnings.
- Any change to upstream Atlantis templates, the pipeline stack, or IAM.

## Related documentation

- [PLAN.md](PLAN.md) - the planning document these requirements are derived from
- [Manual verification checklist](../0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md) - the source of the checks
- [Dual-era requirements](../0-0-7-mcp-protocol-dual-era/requirements.md) - the behavior the core checks verify
- [Issue #5: private and paid user records expire after 120 days even when active](https://github.com/63Klabs/atlantis-mcp/issues/5)
- [Supported protocol revisions](../../../docs/end-user/supported-protocol-revisions.md)
- [CORS and response headers](../../../docs/admin-ops/cors-and-response-headers.md)
- [User management](../../../docs/admin-ops/user-management.md) - promoting a user to the private tier
- [Post-deploy buildspec](../../../application-infrastructure/buildspec-postdeploy.yml)
- [Main buildspec](../../../application-infrastructure/buildspec.yml)
- [SSM parameter script](../../../application-infrastructure/build-scripts/generate-put-ssm.py)
- [Release version script](../../../application-infrastructure/build-scripts/write_release_version.py)
- [Settings loader](../../../application-infrastructure/postdeploy-scripts/settings-loader.js)
