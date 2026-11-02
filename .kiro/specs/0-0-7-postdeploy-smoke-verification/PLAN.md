# Post-deploy smoke verification

Planning document for v0.0.7. Scope: automate, as a post-deploy step, the parts of [`TODO-MANUAL-VERIFY.md`](../0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md) that a script can decide on its own, so that each deployment proves itself without a human running curl commands.

Status: **all questions answered** (rounds 1 to 3). The plan is locked, and the requirements are in [`requirements.md`](requirements.md).

What changed in round 3:

- Q17: the verifier uses a **private-tier** key. The developer page documents the current limit (the key's account is deleted about 120 days after the key was set up or last regenerated), links the GitHub issue, and gives both workarounds (section 4.4).
- Finding 5 is filed as [63Klabs/atlantis-mcp#5](https://github.com/63Klabs/atlantis-mcp/issues/5). Writing it up turned up a related defect, now finding 6: a voucher's `tierExpiresAt` is stored as a string and compared with a number, so a lapsed voucher tier is never downgraded. It is in the same issue because it changes how finding 5 should be fixed.

What changed in round 2:

- Q12 to Q15 are applied. X1 is a core check. A run where a core check gets `429` fails the build. The report also goes to the build log as one `VERIFY_REPORT` line. The skip switch is an SSM parameter, with an explicit buildspec variable as the backup.
- Q16: I checked the key lifetime as you asked. Your expectation holds for **free registered** keys, but not for **private** keys, and the cleanup function deletes the Cognito account when a record expires. Details are in [Replies to your round 2 notes](#replies-to-your-round-2-notes) and finding 5. The key decision moved to Q17.

---

## 1. Why, and what this does not replace

The dual-era spec ships with a 54-box manual checklist. Most of it is deterministic: send a request, compare the response to an expectation. A human running those after every deploy will skip them eventually. The post-deploy CodeBuild stage already runs after every successful stack deploy, already knows the stack, the REST API ID, and the stage name, and already has Node. That makes it the natural home.

What a script **cannot** do, and what stays manual:

| Stays manual | Why |
|--------------|-----|
| Kiro, Claude Code, ChatGPT, Cursor connecting and listing tools | A real client handshake is the point. No script substitutes |
| Reading which `MCP-Protocol-Version` header Kiro sends (J8, J9) | Needs a real client, and `beta`/`prod` log at INFO so the headers are not logged |
| Repository state: commit, review what is uncommitted (L) | Not a property of a deployment |
| CloudWatch-based checks (A3, K2, K3) | See "Decided in this plan" in section 3 |

The automated script is a **smoke test**: it answers "is the thing that just deployed the thing we meant to deploy, and does it still speak both protocol eras?" It is not a conformance suite and not a load test.

---

## 2. What the post-deploy stage looks like today

### This repository

| Fact | Evidence |
|------|----------|
| Four bash scripts run in order, each under `bash -e`, each with `set -euo pipefail` and a `[NN-name]` log prefix with `INFO`/`WARN`/`ERROR` levels | `buildspec-postdeploy.yml`, `postdeploy-scripts/0*.sh` |
| Scripts hand values to each other through `build/staging/api-spec/env.sh`, which script 01 writes and script 04 sources. It exports `REST_API_ID` and `API_STAGE_NAME` | `01-export-api-spec.sh`, `04-consolidate-and-deploy.sh` |
| Script 01 derives the stack name `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application` and reads the REST API ID and the `ApiPathBase` parameter from CloudFormation | `01-export-api-spec.sh` |
| Script 04 syncs `build/final/` to the static hosting bucket with `--delete` | `04-consolidate-and-deploy.sh` |
| Node helpers called from bash (`apply-settings.js`, `resolve-and-render-spec.js`, `settings-loader.js`) are plain CommonJS with no dependencies | `postdeploy-scripts/*.js` |
| `settings.json` has custom domains for `beta` (`mcp-beta.atlantis.63klabs.net`) and `prod` (`mcp.atlantis.63klabs.net`). `test` has none. `settings-loader.js` merges `default` with the stage | `src/static/settings.json`, `settings-loader.js` |
| The raw API URL form already used elsewhere is `https://<restApiId>.execute-api.<region>.amazonaws.com/<apiStageName>` | `apply-settings.js` |
| The static site's Jest tests (`*.jest.mjs`) run in this buildspec's `pre_build` with `npm install --include=dev` | `buildspec-postdeploy.yml`, `src/static/tests/` |
| `buildspec-structure.test.js` asserts there are **exactly four** scripts in order | `tests/postdeploy/unit/buildspec-structure.test.js` |
| `generate-put-ssm.py` creates a `SecureString` with no KMS key ID, stores the literal `BLANK` when given no value, and **never overwrites** an existing parameter | `build-scripts/generate-put-ssm.py` |
| An invalid API key gets `401` before the rate limiter runs, so it is not counted | `src/lambda/read-function/index.js` |

### Upstream pipeline

Read through the 63Klabs Atlantis MCP server: `template-pipeline-github.yml` v2.0.5 (2026-08-15), which `docs/admin-ops/deployment/README.md` names, and the modules it includes. Your deployed pipeline may be on a different version.

| Fact | Source |
|------|--------|
| The stages end Deploy → PostDeploy → ApproveToPromote → Promote. The last two exist only when `PromoteTargetStageId` is set | `template-pipeline-github.yml` |
| The pipeline is named `${Prefix}-${ProjectId}-${StageId}-Pipeline` | `template-pipeline-github.yml` outputs |
| The PostDeploy action takes the same execution's `SourceArtifact`, so it builds the commit that was deployed. It declares an output artifact, `PostDeployArtifact`, that no later stage reads | `template-pipeline-github.yml` |
| Image `aws/codebuild/amazonlinux-x86_64-standard:5.0` on `BUILD_GENERAL1_SMALL`, the same image as the Build stage. No build timeout is set | `postdeploy-project.yml` |
| Environment includes `AWS_REGION`, `PREFIX`, `PROJECT_ID`, `STAGE_ID`, `DEPLOY_ENVIRONMENT`, `S3_STATIC_HOST_BUCKET`, `PARAM_STORE_HIERARCHY` (`${ParameterStoreHierarchy}${DeployEnvironment}/${Prefix}-${ProjectId}-${StageId}/`), and **`NODE_ENV=production`**. Nothing in this repository can add a variable to the project | `postdeploy-project.yml` |
| The role allows `ssm:GetParameter`, `GetParameters`, `GetParametersByPath`, and `PutParameter` on `${PARAM_STORE_HIERARCHY}*`, read access to the application stack and to API Gateway, and nothing for SNS or CloudWatch metrics. It writes logs to `/aws/codebuild/${Prefix}-${ProjectId}-${StageId}-PostDeploy` | `postdeploy-service-role.yml` |

### Finding: `tests/postdeploy` is not a gate today

Nothing references `tests/postdeploy` in any buildspec. Its `package.json` points at `../../src/node_modules/.bin/jest`, which no longer exists after the multi-resource move. Running it with another Jest binary, the property suites fail to load (`fast-check` missing) and `buildspec-structure.test.js` fails to load (`js-yaml` missing). I did not triage the unit suites beyond that. Per Q7, this work leaves it alone apart from one stale assertion.

---

## 3. Checks for the first version

Each row maps to the manual checklist. IDs here (P, V, X, T, S) belong to this plan only; the "Manual item" column cites `TODO-MANUAL-VERIFY.md`, whose IDs overlap in letters but not in meaning.

| ID | Checks | Manual item | Severity | Counted requests |
|----|--------|-------------|----------|------------------|
| P1 | `server/discover` answers **without a key**; modern envelope; server name; `supportedVersions` includes the floor `2024-11-05`, `2025-11-25`, `2026-07-28` | C1, C3 | Core | 1, always against the IP |
| V1 | The version P1 reports equals the release version | K1 | Core | 0 (uses P1) |
| P2 | `initialize` echoes `2025-11-25` and `2024-11-05`; counter-offers `2025-06-18` with `2024-11-05`, `2099-01-01` with `2025-11-25`, and no revision with `2025-11-25`; legacy shape has exactly four keys; `instructions` byte-identical to P1's | B1 to B3, C2 | Core | 5 |
| P3 | `-32022` via header and via `params._meta`, with `declaredRevision` and `supportedVersions` | D1, D2 | Core | 2 |
| P4 | `-32020` for `Mcp-Method` and `Mcp-Name` mismatches; matching headers accepted; header names case-insensitive; a legacy request ignores mismatched headers | E1 to E5 | Core | 5 |
| P5 | `tools/list` on `2026-07-28` (header and `params._meta`), `2025-11-25`, `2024-11-05`, and no revision: modern fields only on modern; `title` and `annotations` only on `2025-11-25` and later; all tools read-only; same tools in the same order. Any advertised revision beyond the floor is accepted and returns tools | F1 to F3, G1 to G4 | Core | 5, plus 1 per extra revision |
| P6 | `tools/call list_tools` on legacy and modern: `resultType` and `_meta` only on modern | F4 | Core | 2 |
| X1 | Raw-URL CORS preflight allows `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, and `POST` | A1, A2 | Core | 0 (API Gateway answers it) |
| X2 | Custom domain, when the stage has one: preflight; `server/discover` reports the expected version; `-32020` for a mismatched `Mcp-Method`; `-32020` for a mismatched `Mcp-Name` | new | Advisory | 3 |
| T1 | `list_templates` returns data (S3 and GitHub behind it) | I1 | Advisory | 1 |
| S1 | An invalid key returns HTTP `401` | H3 | Advisory | 0 (rejected before the limiter) |
| S2 | The stored key works via `X-API-Key` and `Authorization: Bearer`, without `X-MCP-Auth-Status: degraded`, and gets a higher `X-RateLimit-Limit` than P1's keyless response | H1, H2 | Advisory | 2, against the key's tier |

The two `-32020` requests at the edge are deliberate. A mismatch is only reported if `MCP-Protocol-Version` also reached the Lambda, because otherwise the request is treated as legacy and is not validated. Together they prove all three headers pass through CloudFront.

### Request budget

No polling, so these are the whole run.

| Run | Counted against the client IP (public tier, 50 per hour) | Counted against the key's tier |
|-----|----------------------------------------------------------|--------------------------------|
| No key, `test` (no custom domain) | 21 | 0 |
| No key, `beta` or `prod` | 24 | 0 |
| Valid key, `test` | 1 | 22 |
| Valid key, `beta` or `prod` | 1 | 25 |

Two keyless `beta` runs from one address in the same hour use 48 of 50; a third exceeds it. With a valid key, only P1 touches the IP budget. Preflights and S1 are not counted.

### Decided in this plan

These follow from evidence or from your answers, so I did not ask. Say so if you disagree.

| Item | Decision | Reason |
|------|----------|--------|
| K2, K3 (`release_version_fallback` log absent; the build log shows `write_release_version.py` ran) | Drop | If the build did not generate `release-version.js`, the server reports the Lambda `package.json` version (`0.0.2`), which fails V1. No CloudWatch permission needed |
| A3 (preflight does not invoke the Lambda) | Keep manual | Needs CloudWatch metrics and a quiet window. Low value |
| I2, I3 (`validate_naming`, `search_documentation`, large-template summary) | Not automated | `search_documentation` can call Bedrock on paid or private tiers, which costs money on every deploy. Covered by unit tests |
| Per-check outcomes | PASS, FAIL, or SKIP with a reason. An advisory FAIL prints as `WARN` | Lets a missing key be visible without being a failure |
| HTTP `429` on a core check | That check is SKIP "no answer", the run is `inconclusive`, and the build fails (Q13). Nothing waits or retries inside CodeBuild; the log gives the reset time and the retry command | A green stage that verified nothing must not let a build be promoted |
| Version wait | None. One check that `server/discover` reports the expected version | Q5 |
| Key value `BLANK`, not found, or access denied | Treated as "no key". S2 is `SKIP` with that reason | `generate-put-ssm.py` stores `BLANK` |
| Key checked before use | S2 runs before any other request uses the key. If the key is rejected, degraded, or not given a higher limit than the public tier, the core checks run without it and S2 warns | An expired or regenerated key must not turn core checks red |
| Secrets | The key goes to Node in an environment variable, never in arguments. No `set -x`. Request headers are never logged. A failure logs expected against actual for the asserted field and at most 300 characters of body | Secure coding rules |
| Retries and timeouts | One retry on a network error or `502`/`503`/`504`; none on `429` or other `4xx`. 30 seconds per request, just over API Gateway's default 29-second integration limit | Bounded, cheap |
| Unreachable endpoint | If P1 cannot reach the raw URL after the retry, the remaining raw-URL checks report FAIL "not attempted" | Keeps a dead endpoint from costing 25 timeouts |
| Revisions beyond the floor | Each must be accepted (no `-32022`) and return a non-empty tool list. Era-specific expectations apply to the floor only | The legacy era is closed: no handshake revision can follow `2025-11-25`, so the legacy expectations are stable |
| Skip switch values | `true` (any case) skips. `false` runs. Any other value runs and logs a `WARN` naming the value. An SSM parameter that exists but cannot be read falls back to the buildspec variable, with a `WARN` | A typo must never silently disable verification |
| Configuration errors | A missing variable, missing `env.sh`, or no expected version exits 1, like scripts 01 to 04 | Existing convention |
| Report location | `build/verify/report.json` | Outside `build/final/`, which script 04 syncs to the public bucket |
| Test package | `application-infrastructure/tests/postdeploy-verify/`, Jest pinned to an exact version, `*.jest.mjs` files, installed with `npm ci --include=dev` | Workspace rule and the static site's convention. `NODE_ENV=production` would otherwise skip dev dependencies |
| `buildspec-structure.test.js` | Update its "exactly four scripts" expectation to five; it still does not run | Keeps it truthful for whoever revives the suite. The new package checks the buildspec in a test that does run |
| Stages | Runs wherever the post-deploy stage runs | Read-only, about 25 requests |

---

## 4. Constraints and risks that shape the design

### 4.1 Public rate limit: 50 requests per hour per IP

The public tier is identified by client IP. A keyless run makes 21 to 24 counted requests (section 3). That fits one or two runs an hour from the same address, not three. A valid key moves everything except P1 onto the key's tier (registered is 100 per hour, private 6,000 per day). I did not check whether CodeBuild in your account runs inside a VPC with a fixed NAT address; if it does, the address is yours alone, but a retried build still reuses the same hourly window.

### 4.2 Traffic shifting (resolved: Q5)

You confirmed that CloudFormation blocks until the CodeDeploy traffic shift completes, so post-deploy never starts mid-shift. The polling wait is dropped and V1 is a single check.

Separately, finding 4 in section 8: API Gateway calls the function's `$LATEST` rather than the `live` alias that CodeDeploy shifts. Either way, one check is enough here.

### 4.3 Which URL to test (resolved: Q3 D)

The full suite runs against the raw `execute-api` URL, which exists in every stage and isolates the Lambda deploy from the network stack's CloudFront distribution and DNS. The API is edge-optimized, so the raw URL still passes through API Gateway's own CloudFront distribution. The edge subset (X2) runs against `https://<domain>/mcp/v1` when `settings.json` defines a domain for the stage (`beta`, `prod`).

**Checked on 2026-10-21.** Every stage, `test` included, has a network stack distribution in front of `/mcp/*`. All three use the `Managed-AllViewerExceptHostHeader` origin request policy, which forwards every viewer header except `Host`, and all three allow every method, `OPTIONS` and `POST` included. The `test` distribution has only its `*.cloudfront.net` domain, and `settings.json` gives `test` no domain, so X2 skips `test`.

Sent by hand through the `test` distribution, X2's preflight and both `-32020` requests passed. The preflight allowed `Mcp-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, and `POST`, and the mismatched `Mcp-Method` and `Mcp-Name` each came back as `-32020` naming the sent value. So all three headers survive both CloudFront hops. `beta` and `prod` were not probed: they use the same policy, but their branches (`beta`, `main`) are at `071e07a`, before the dual-era commits, so `-32020` does not exist there yet. X2's first run after promotion is still the check.

### 4.4 Credentials (resolved: Q4 B and Q17)

- **Parameter:** `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifyApiKey`, a `SecureString`.
- **Creation:** the main build runs `generate-put-ssm.py` with no value, next to the existing `GitHubToken` call. It stores `BLANK` and never overwrites, so a key you store survives later builds.
- **Reading:** `05` uses `aws ssm get-parameter --with-decryption`. **No IAM change is needed.** The upstream post-deploy role already allows `ssm:GetParameter` on `${PARAM_STORE_HIERARCHY}*`, and that is exactly the `PARAM_STORE_HIERARCHY` value the post-deploy project receives. The parameter is encrypted with the AWS-managed `aws/ssm` key because the script passes no key ID, and SSM decrypts that for account principals allowed to call `GetParameter`. I have not run it in your account; phase 4 confirms it.
- **One key per stage.** Each stage has its own Users table and Cognito user pool.
- **Tier: private** (Q17), 6,000 requests per day. Use does not renew a private user's record today, so the key's account is deleted about 120 days after it was promoted or the key was last regenerated ([issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5)).
- **Keeping it valid:** the developer page explains how to get the key, store it, and keep it valid until the issue is fixed: an admin removes `ttl` from the key's record, or someone regenerates the key and updates the parameter before the 120 days are up. Once the issue is fixed, regular verification runs keep the key alive and the page can drop the workaround.
- **When it lapses anyway:** S2 warns and the run continues on the public tier, so a lapsed key never fails the build.

### 4.5 Tooling (resolved: Q6 B)

A thin bash wrapper does the AWS work and calls a dependency-free Node helper, matching `apply-settings.js` and the other helpers. Node's built-in `fetch` sends the requests, and tests replace it with a fake.

### 4.6 Tests (resolved: Q7 B)

A new self-contained Jest package, `application-infrastructure/tests/postdeploy-verify/`, installed and run in the post-deploy `pre_build` next to the static site's tests. The post-deploy project sets `NODE_ENV=production`, so the install must pass `--include=dev`. A failing verifier test blocks docs publishing for that deploy, the same way a failing static-site test does today.

### 4.7 What failure means

Post-deploy runs after the stack deploys, so failing it rolls nothing back. It is not only visibility, though. In the upstream pipeline the PostDeploy stage comes **before** ApproveToPromote and Promote. When promotion is enabled (`PromoteTargetStageId` set), a failed post-deploy build stops the execution and the build is not promoted. A failed execution also triggers the upstream pipeline-failed notification to `AlarmNotificationEmail`.

Nothing retries automatically. A person can retry the failed stage from the CodePipeline console or the CLI, or the next deploy runs verification again. Retrying re-runs the whole PostDeploy build, including the docs regeneration and the S3 sync, which is harmless.

Advisory warnings do neither: they appear only in the log and the report. Whether your pipelines enable promotion is set in your SAM configuration repository, which I cannot see.

### 4.8 Ordering (resolved: Q2 A)

`05` runs last, after the docs are synced. If an earlier script fails, `05` does not run; the build is already red, so nothing is hidden.

### 4.9 Expected version (resolved: Q9 A)

`05` runs `write_release_version.py`, which resolves its paths from its own location, then reads `src/lambda/read-function/config/release-version.js`. The image is the one the main build already uses to run the same script. The PostDeploy action takes the same execution's `SourceArtifact`, so it reads the version of the commit that was deployed.

### 4.10 Side effects of running against a live stage

Every request is read-only. `tools/call` still writes `DISCOVERY_TOOL_CALL` log lines, and the first call in each warm container is logged as `firstInSession: true`, so deploy-time runs add a small, regular amount of noise to those discovery metrics. A keyed run also counts as activity for the key's user, although for a private key that renews nothing until issue #5 is fixed. Worth recording in the docs; not worth avoiding.

### 4.11 The first request after a deploy

Cold starts. The 30-second timeout and one retry cover them, and P1 is a cheap call.

---

## 5. Design

### Files

| File | Change |
|------|--------|
| `application-infrastructure/postdeploy-scripts/05-verify-deployment.sh` | New. Thin bash wrapper |
| `application-infrastructure/postdeploy-scripts/verify-deployment.js` | New. Dependency-free CommonJS with every check and a CLI entry point |
| `application-infrastructure/tests/postdeploy-verify/` | New Jest package for the verifier |
| `application-infrastructure/buildspec-postdeploy.yml` | Declares `VERIFY_SKIP: "false"` under `env: variables`. `pre_build` installs and runs the verifier tests. `build` runs `05` last, under `bash -e` |
| `application-infrastructure/buildspec.yml` | Creates two parameters with `generate-put-ssm.py`, next to the existing calls: the key (stored as `BLANK`) and the skip switch (`--value false`) |
| `application-infrastructure/tests/postdeploy/unit/buildspec-structure.test.js` | Expects five scripts |

### Flow

`05-verify-deployment.sh`:

1. Read the skip switch values (see below) and hand them to `verify-deployment.js`, which decides. If it is on, the Verifier logs a prominent `WARN`, writes a report with outcome `skipped`, and the run exits 0. (`requirements.md` puts every decision and every report write in the Verifier, so they can be unit tested.)
2. Check `PREFIX`, `PROJECT_ID`, `STAGE_ID`, `AWS_REGION`, and `PARAM_STORE_HIERARCHY`, then source `build/staging/api-spec/env.sh` for `REST_API_ID` and `API_STAGE_NAME`.
3. Run `write_release_version.py` and read the expected version from the generated file.
4. Build the raw URL `https://${REST_API_ID}.execute-api.${AWS_REGION}.amazonaws.com/${API_STAGE_NAME}/mcp/v1`. Look up the stage's domain with `settings-loader.js`; if there is one, the edge URL is `https://<domain>/mcp/v1`.
5. Read the key from SSM and pass the value and the read result to the Verifier, which classifies it: present, `BLANK`, not found, access denied, or another error. Never print it.
6. Run `verify-deployment.js` with those values in environment variables and exit with its code.

`verify-deployment.js`:

1. P1 without a key, then V1 and the revision floor from the same response.
2. S1 with a made-up key.
3. S2 with the stored key, if there is one. If it works, use it for the steps that follow; if not, warn and continue without it.
4. P2 to P6, including any advertised revisions beyond the floor.
5. T1, then X1.
6. X2, if there is an edge URL.
7. Print the summary, write the report, print the `VERIFY_REPORT` line, and return the exit code.

### Skip switch

| Source | Used when | Value that skips |
|--------|-----------|------------------|
| SSM parameter `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifySkip`, created by the main build as `false` | It exists and can be read | `true` |
| `VERIFY_SKIP` in `buildspec-postdeploy.yml`, set explicitly to `"false"` | The SSM parameter is missing or unreadable | `true` |

Every run logs which source decided and its value. Each pipeline (`test`, `beta`, `prod`) has its own SSM value, so this setting lives outside the commit; you accepted that trade-off as the normal use of parameters. To skip verification on one stage and turn it back on afterwards:

```bash
aws ssm put-parameter --name "${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifySkip" \
  --type SecureString --value true --overwrite
# ...retry the stage, then:
aws ssm put-parameter --name "${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifySkip" \
  --type SecureString --value false --overwrite
```

### Severity and exit codes

| Severity | Checks | On failure |
|----------|--------|------------|
| Core | P1 to P6, V1, X1 | Build fails |
| Advisory | T1, X2, S1, S2 | `WARN` line, build passes |

| Run condition | Exit code | Report outcome |
|---------------|-----------|----------------|
| Skip switch on | 0 | `skipped` |
| Configuration error | 1 | `error` |
| Any core check failed | 1 | `failed` |
| A core check got `429` and none failed | 1 | `inconclusive` |
| Otherwise | 0 | `passed`, with warnings and skips listed |

An `inconclusive` run logs when the public window resets (from `Retry-After`) and how to retry:

```bash
aws codepipeline retry-stage-execution \
  --pipeline-name "${PREFIX}-${PROJECT_ID}-${STAGE_ID}-Pipeline" \
  --stage-name PostDeploy --retry-mode FAILED_ACTIONS \
  --pipeline-execution-id "<execution-id>"
```

### Reporting

```text
[05-verify-deployment] INFO: Skip switch: false (SSM parameter)
[05-verify-deployment] INFO: Raw target: https://abc123.execute-api.us-east-1.amazonaws.com/beta/mcp/v1
[05-verify-deployment] INFO: Edge target: https://mcp-beta.atlantis.63klabs.net/mcp/v1
[05-verify-deployment] INFO: Expected release version: 0.0.7
[05-verify-deployment] INFO: Verification key: not configured (placeholder BLANK)
PASS  P1.1  server/discover answers without a key
PASS  V1.1  reported version is 0.0.7
SKIP  S2.1  X-API-Key accepted (no key configured: placeholder BLANK)
WARN  X2.4  edge: -32020 for mismatched Mcp-Name (got a tool result; header not forwarded?)
[05-verify-deployment] INFO: Core: 35 passed. Advisory: 5 passed, 1 warning, 2 skipped
[05-verify-deployment] INFO: Report: build/verify/report.json
VERIFY_REPORT {"outcome":"passed","expectedVersion":"0.0.7","checks":[...]}
```

The report holds each check's ID, title, severity, outcome, reason, and duration, plus the run's targets, versions, key status (never the key), skip source, timestamps, and overall outcome. The file is lost when the build container ends; the `VERIFY_REPORT` line is kept in the PostDeploy log group and can be searched with CloudWatch Logs Insights (Q14). It follows the repository's `DISCOVERY_TOOL_CALL` and `DOC_AI_USAGE` convention: a fixed token, one space, then compact JSON.

### Configuration

The names match the setup block in `TODO-MANUAL-VERIFY.md`, so a developer who set those up can run the verifier with no extra setup.

| Variable | Set by | Default | Purpose |
|----------|--------|---------|---------|
| `MCP_URL` | `05`, or you when running locally | none (required) | Raw endpoint |
| `MCP_EDGE_URL` | `05`, from `settings.json` | empty, which skips X2 | Edge endpoint |
| `EXPECTED_VERSION` | `05`, from `write_release_version.py` | none (required) | Release version for V1 |
| `MCP_API_KEY` | `05`, from SSM | empty | Verification key |
| `MCP_KEY_STATUS` | `05` | `none` | Why there is no key, for the S2 skip reason |
| `MCP_ORIGIN` | | `https://example.com` | Origin for the preflights |
| `VERIFY_REQUEST_TIMEOUT_MS` | | `30000` | Per-request timeout |
| `VERIFY_REPORT_PATH` | | `build/verify/report.json` | Report file |
| `VERIFY_SKIP` | `buildspec-postdeploy.yml` (`"false"`), or you locally | `false` | Backup skip switch, used when the SSM parameter is missing |

### Running it locally

This replaces sections B to G of the manual checklist, plus parts of A, H, and I.

```bash
export MCP_URL="https://mcp-beta.atlantis.63klabs.net/mcp/v1"
export EXPECTED_VERSION="0.0.7"
node application-infrastructure/postdeploy-scripts/verify-deployment.js
```

---

## 6. Phasing

| Phase | Contents | Done when |
|-------|----------|-----------|
| 1 | `verify-deployment.js` and the `tests/postdeploy-verify` package, using a fake `fetch`. No pipeline change | Tests pass; a local run against a deployed stack passes |
| 2 | `05-verify-deployment.sh`; post-deploy buildspec wiring, including `VERIFY_SKIP`; both placeholder parameters in the main build; the stale structure assertion | A `test` deploy passes with S2 skipped |
| 3 | Documentation: a developer page (getting a private-tier verification key per stage, storing it, keeping it valid until issue #5 is fixed; running locally); an admin-ops page (what it checks, reading results and the `VERIFY_REPORT` line, the skip switch, what a failure blocks, how to retry); the post-deploy diagram in `ARCHITECTURE.md`; `TODO-MANUAL-VERIFY.md` marks the automated items; `CHANGELOG.md` | Docs pass the link check |
| 4 | First live runs, by hand: `test` without a key, `test` with a key, `beta` with the edge subset, one run with the skip switch on | SSM decryption works, CloudFront forwarding is known, and `VERIFY_REPORT` is searchable |

---

## 7. Risks

| Risk | Mitigation |
|------|-----------|
| A false core failure blocks promotion | Core checks are deterministic protocol and template checks only. Backend, edge, and auth are advisory. Skip switch for known issues |
| Rate limiting fails the build (Q13) | Rare: a keyless run uses at most 24 of 50 requests an hour, and a key moves all but one off the IP. The log gives the reset time and the retry command |
| An expired or regenerated key turns checks red | S2 runs first; a rejected key falls back to the public tier and warns. The private key's 120-day limit (issue #5) and its workarounds are on the developer page |
| The skip switch is left on | Every skipped run logs a prominent `WARN` and reports `skipped`. Phase 4 includes a run with it on |
| Advisory warnings go unnoticed | They appear only in the log and the report; the post-deploy role cannot publish to SNS. Accepted for the first version |
| Credentials leak into build logs | See "Secrets" in section 3 |
| A check passes on the raw URL while clients are broken at the edge | X2 |
| Hardcoded expectations go stale after a legitimate change | Live `supportedVersions` plus a fixed floor; assert shapes, not contents |
| New tests do not gate anything | They run in `pre_build`, which fails the build |

---

## 8. Findings outside this spec

Raised here so they are not lost. None are proposed for this work.

1. **`tests/postdeploy` does not run** (section 2). Reviving it is its own task and may surface failures that predate this spec.
2. **Client-supplied `X-Forwarded-For` appears to set the public rate-limit identity.** `extractSourceIp` in `auth-resolver.js` takes the first value of the request's `X-Forwarded-For` header before falling back to `requestContext.identity.sourceIp`. A client that sends its own header could choose its own rate-limit bucket. I read the code only; API Gateway or CloudFront may rewrite the header.
3. **Verification is coupled to documentation publishing.** The stage needs `PostDeployStageEnabled` and a static host bucket. A deployment that turns the stage off gets no verification.
4. **API Gateway invokes `$LATEST`, not the `live` alias.** The `/mcp/v1` integration in `template-openapi-spec.yml` targets `${ReadLambdaFunction.Arn}`, the unqualified ARN. The `live` alias that CodeDeploy shifts in `PROD` has invoke permissions (`ReadLambdaPermissionLive`, and the permission SAM generates from the `McpV1Post` event), but nothing calls it. Production traffic moves to new code as soon as CloudFormation updates the function, and the gradual shift acts on an alias that receives no API traffic. The alarm rollback still covers API callers: `ReadLambdaErrorsAlarm` uses only the `FunctionName` dimension, which counts every version, `$LATEST` included, and the stack rollback that follows a failed shift should restore the old code to `$LATEST`. So a bad release reaches every API caller at once, instead of 10% first, until the rollback finishes. It does not change this plan: the verifier checks what API callers actually run. Confirmed on the deployed `test`, `beta`, and `prod` stacks on 2026-10-21, where the alias served no invocations in 14 days; a rollback has not been observed. Details are in [0-0-7-api-gateway-live-alias](../0-0-7-api-gateway-live-alias/ISSUE.md). To re-check a stack:

   ```bash
   api_id="<REST_API_ID>"
   resource_id=$(aws apigateway get-resources --rest-api-id "$api_id" \
     --query "items[?path=='/mcp/v1'].id" --output text)
   aws apigateway get-integration --rest-api-id "$api_id" --resource-id "$resource_id" \
     --http-method POST --query uri --output text
   ```

   A URI ending in `:function:<name>/invocations` is unqualified; one ending in `:function:<name>:live/invocations` targets the alias.

5. **Active private and paid users lose their accounts about 120 days after their last record write.** Verified in code:
   - Every write sets `ttl` to 120 days ahead: registration (`post-confirmation.js`), key regeneration (`key-regenerate.js`), voucher redemption (`voucher-redeem.js`), and the admin promotion commands in `user-management.md`.
   - Use renews `ttl` only for free `registered` users. `refreshTtl` in `auth-resolver.js` returns early for every other tier and for downgraded paid users, and `ttl-refresh.property.test.js` asserts that ("non-registered tiers do NOT trigger TTL refresh").
   - When DynamoDB TTL deletes the record, `cleanup-function` (triggered by the Users table stream) deletes the matching Cognito user with `AdminDeleteUser`. The user's key returns `401` and their login is gone.
   - The original design (`0-0-3-add-authentication/design.md`, "TTL Strategy") states the goal as cleaning up **inactive** accounts. It renews paid records when "a subscription hook updates `tierExpiresAt`"; the only such write in the code is voucher redemption, which happens once. Nothing renews private records. So the code follows the design's steps but misses its goal, and `user-management.md`'s "Promote to private tier with no expiration" is misleading as a result.
   - Filed as [63Klabs/atlantis-mcp#5](https://github.com/63Klabs/atlantis-mcp/issues/5), with permalinks to `main` (v0.0.6, where every cited file matches this branch except `template.yml`, whose lines are cited as they are on `main`).

6. **Lapsed voucher tiers are never downgraded.** Voucher redemption (`voucher-redeem.js`, `models/user.js`) and the admin promotion commands store `tierExpiresAt` as an ISO 8601 string, but `computeEffectiveTier` in `auth-resolver.js` compares it with Unix epoch seconds. The string becomes `NaN` in that comparison, so the check is never true. Through `TestHarness`, `computeEffectiveTier('paid', <ISO date 30 days ago>)` returns `paid`, while the same date in epoch seconds returns `registered`. The property tests pass only numbers. Today the 120-day `ttl` caps how long a lapsed voucher keeps its higher limits, so fixing finding 5 without this one would let a lapsed voucher keep paid limits indefinitely. Recorded in issue #5 under "Related".

---

## 9. Out of scope

- Real MCP client verification (Kiro, Claude Code, ChatGPT, Cursor)
- Load or soak testing
- Continuous monitoring after deploy (CloudWatch Synthetics would be the tool, and it is a different spec)
- Automatic rollback on a failed verification, or automatic retries of the stage
- Any change to the upstream pipeline templates or to IAM from this repository
- Notifications for advisory warnings
- Fixing findings 2 and 4, fixing findings 5 and 6 (issue #5), or reviving `tests/postdeploy`
- Bedrock-backed or backend-heavy tool calls

---

## Answered questions (rounds 1 to 3)

Your answers, verbatim, and what each one decides in this plan.

### Round 1

| Q | Topic | Your answer | What it decides |
|---|-------|-------------|-----------------|
| Q1 | Failure severity | C | Core checks fail the build; advisory checks warn (section 5) |
| Q2 | Placement | A | Runs last, as script `05`, after docs are published |
| Q3 | URL | D | Full suite on the raw `execute-api` URL; edge subset on the custom domain for `beta` and `prod` |
| Q4 | Credentials | B - `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifyApiKey` and set it during the first build stage (buildspec.yml) using the ssm scripts and leave it as the default BLANK. Add documentation to the developer documentation to obtain a private tier key and set it. | The main build creates the parameter with `generate-put-ssm.py`; `BLANK` means no key; no IAM change needed; developer page in phase 3. The tier is revisited in Q17 |
| Q5 | Traffic shift | CloudFormation already blocks during deployments | No polling; V1 is a single check |
| Q6 | Language | B | Bash wrapper plus a dependency-free Node helper |
| Q7 | Tests | B | New Jest package `tests/postdeploy-verify`, run in post-deploy `pre_build` |
| Q8 | Revisions | B | Live `supportedVersions` plus a fixed floor of three |
| Q9 | Expected version | A | `05` runs `write_release_version.py` and reads the generated file |
| Q10 | Reporting | B, with the skip variable | Log lines, exit code, and a JSON report |
| Q11 | Scope | B | P1 to P6, V1, X1, T1, S1, S2, plus X2 from Q3 |

### Round 2

| Q | Topic | Your answer | What it decides |
|---|-------|-------------|-----------------|
| Q12 | X1 severity | A | X1 is a core check |
| Q13 | No answer from a core check | B - however, what do you mean by retry the stage? We won't keep CodeBuild running. A fail has no retry unless the user manually restarts the stage in the console (or cli). If you mean something different let me know. | A core `429` makes the run `inconclusive` and fails the build. Retrying is manual (see below) |
| Q14 | Report kept where | B | File plus one `VERIFY_REPORT` log line in the PostDeploy log group |
| Q15 | Skip switch | B with C as a back-up if SSM Param does not exist. Like the other SSM Parameters, use the scripts in the Build stage and set default to `false`. Test, Beta, and Prod pipelines will have their own setting which kind of breaks the idea of the commit code being the configuration source of truth, but Paramers should be used this way. We will want to explictily set the variable in the buildspec | SSM parameter created by the main build as `false`; `VERIFY_SKIP: "false"` declared explicitly in `buildspec-postdeploy.yml` as the backup (section 5) |
| Q16 | Key lifetime | Let's double check this. It is my understanding that only **Unused** keys and accounts expire. So as long as deploys continue to happen within the 120 days then it should remain active. However if a deploy does not occur, yes it will expire. Please verify by looking at the user key clean up function (i think that is where it is). | Verified below. The decision moved to Q17 |

### Replies to your round 2 notes

**Q13, "retry the stage".** You read it right: nothing keeps CodeBuild running and nothing retries on its own. I meant a person retrying the failed PostDeploy stage, from the CodePipeline console or with `aws codepipeline retry-stage-execution`, once the rate-limit window has reset. Or the next deploy runs verification again. The `inconclusive` log message prints the reset time and the command (section 5).

**Q16, "only unused keys and accounts expire".** That is true for **free registered** keys and not for **private** ones:

- A registered key is renewed by use. Once fewer than 90 days remain, each authenticated request pushes `ttl` back to 120 days ahead. A key used at least once every 120 days never expires, which matches what you described.
- A private key is not renewed by use. `refreshTtl` skips every tier except free `registered`, and a property test asserts it. A private key expires about 120 days after it was created, promoted, or regenerated, however often it is used.
- The cleanup function you mentioned (`cleanup-function/index.js`) does not renew anything. It runs after DynamoDB TTL deletes a Users record and deletes the matching Cognito user. So an expired verification account has to be registered again, not just given a new key.

Full evidence is in finding 5. It affects real private and paid users too, not just the verifier.

### Round 3

Q17 offered A (private key, an admin removes `ttl`), B (private key, regenerated by hand before 120 days), C (free registered key, renewed by use), and D (fix the renewal in this spec). The recommendation was C.

| Q | Topic | Your answer | What it decides |
|---|-------|-------------|-----------------|
| Q17 | Which key the verifier uses | use a private tier key, and open an issue on the github.com/63klabs/atlantis-mcp repository using the gh cli available in this environment (user is already logged in). | A private-tier key per stage. The answer does not pick between A and B, so the developer page documents both as workarounds, with the 120-day limit and a link to the issue (section 4.4). Finding 5 is filed as [63Klabs/atlantis-mcp#5](https://github.com/63Klabs/atlantis-mcp/issues/5), together with finding 6; neither is fixed in this spec |

---

## Related documentation

- [Manual verification checklist](../0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md) - the source of the checks above
- [Dual-era spec plan](../0-0-7-mcp-protocol-dual-era/PLAN.md)
- [Supported protocol revisions](../../../docs/end-user/supported-protocol-revisions.md) - expected response shapes
- [CORS and response headers](../../../docs/admin-ops/cors-and-response-headers.md) - header ownership
- [User management](../../../docs/admin-ops/user-management.md) - tier promotion and the `ttl` attribute
- [Authentication design, TTL strategy](../0-0-3-add-authentication/design.md) - the original intent behind finding 5
- [Issue #5: private and paid user records expire after 120 days even when active](https://github.com/63Klabs/atlantis-mcp/issues/5) - findings 5 and 6
- [Post-deploy buildspec](../../../application-infrastructure/buildspec-postdeploy.yml)
- [SSM parameter script](../../../application-infrastructure/build-scripts/generate-put-ssm.py)
- Upstream (read through the 63Klabs Atlantis MCP server): `atlantis/templates/v2/pipeline/template-pipeline-github.yml` v2.0.5, and the modules `pipeline/postdeploy-project.yml` and `pipeline/postdeploy-service-role.yml`
- [AWS: UpdatePolicy attribute (CodeDeployLambdaAliasUpdate)](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-updatepolicy.html)
