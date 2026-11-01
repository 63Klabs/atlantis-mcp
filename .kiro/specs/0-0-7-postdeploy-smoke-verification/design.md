# Design Document

## Overview

This is the design for [post-deploy smoke verification](requirements.md). After each deployment, the post-deploy CodeBuild stage runs a new wrapper, `05-verify-deployment.sh`. The wrapper gathers its inputs and hands them to a new dependency-free Node script, `verify-deployment.js`. The script sends about 25 read-only requests to the stage that was just deployed and evaluates 45 sub-checks. It prints one line per sub-check, writes a JSON report, and prints one `VERIFY_REPORT` line. It exits non-zero when a core check fails or gets no answer.

The design is grounded in the existing code and stage:

- the post-deploy buildspec and scripts 01 to 04, with their conventions and the `env.sh` hand-off
- `settings-loader.js`, `write_release_version.py`, and `generate-put-ssm.py`
- the Read Function's protocol surface: `utils/mcp-protocol.js`, `utils/mcp-era.js`, `utils/json-rpc-router.js`, `utils/auth-resolver.js`, and `utils/rate-limiter.js`
- the CORS stanza in `template.yml`
- the upstream pipeline's PostDeploy project and service role

These facts shaped it:

| Fact | Consequence |
|------|-------------|
| The upstream PostDeploy project sets `NODE_ENV=production`, and this repository cannot add variables to it. Its role already allows `ssm:GetParameter` on `${PARAM_STORE_HIERARCHY}*` | Test dependencies install with `--include=dev`. The skip switch comes from SSM and the buildspec. No IAM change |
| `WebApi` is edge-optimized, so even the raw `execute-api` URL passes through API Gateway's managed CloudFront, which can re-case header names. On `beta` and `prod`, an upstream distribution also serves the custom domain, and its `/mcp/*` behavior forwards every viewer header except `Host` (checked 2026-10-21) | P4.4 proves the deployed path accepts unusual header case; the function's own case-insensitive matching stays covered by its unit tests. X2 is expected to pass on `beta` and `prod` |
| On Node 24, the built-in `fetch` sends `Origin` and `Access-Control-Request-*` on `OPTIONS` and keeps header-name case as written. With `redirect: 'manual'` it returns a 3xx response unchanged, and `AbortSignal.timeout()` rejects with a `TimeoutError` (checked locally) | No HTTP library is needed. Redirects can be refused, and timeouts recognized by name |
| The Read Function answers an unknown key with `401` before the rate limiter, returns a failed tool as JSON-RPC `-32603` with HTTP 200, and answers `429` with `Retry-After` (seconds) and `X-RateLimit-Reset` (epoch seconds) | S1 costs nothing against the budget. T1 checks `error`, not the status. The inconclusive message can compute a reset time |
| API keys have the form `atl_` followed by 32 hex characters | Property tests generate realistic keys. The made-up S1 key avoids the `atl_` prefix so secret scanners do not flag it |

The guiding split is **the Wrapper gathers, the Verifier decides**. Bash does what it is good at in this stage: AWS CLI reads, sourcing `env.sh`, and running the version script. Every decision and every output lives in the Verifier as exported functions, with `fetch`, the clock, `sleep`, and the output streams injected, so Jest covers all of it without a network or a shell. The decisions are the skip switch, the key classification, input validity, each sub-check, and the run outcome. The outputs are the sub-check lines, the report, and the report line.

### Design goals

- A green stage always means the core was verified. A red one names the sub-checks that failed or got no answer.
- Bounded: about 25 sequential requests, at most one retry each, and no waiting after HTTP `429`.
- The key cannot leak: it travels only through the environment, is never logged, and is redacted from every output as a second line of defense.
- Stable sub-check IDs, so past runs can be compared in CloudWatch Logs Insights.
- Nothing outside this repository changes.

### Requirement traceability

| Requirement | Design sections |
|-------------|-----------------|
| 1. Placement and conventions | [Architecture](#architecture), [1. Wrapper](#1-wrapper-05-verify-deploymentsh), [2. Verifier command line](#2-verifier-command-line), [10. Buildspec changes](#10-buildspec-changes) |
| 2. Targets | [1. Wrapper](#1-wrapper-05-verify-deploymentsh) step 4, [7. Check catalog](#7-check-catalog) |
| 3. Expected release version | [1. Wrapper](#1-wrapper-05-verify-deploymentsh) step 3, [2. Verifier command line](#2-verifier-command-line) |
| 4 to 9. The checks | [6. Check engine](#6-check-engine), [7. Check catalog](#7-check-catalog) |
| 10. Outcomes, severity, and exit codes | [6. Check engine](#6-check-engine), [8. Outcome](#8-outcome) |
| 11. Verification key | [1. Wrapper](#1-wrapper-05-verify-deploymentsh) step 5, [4.2 Key classification](#42-key-classification) |
| 12. Skip switch | [1. Wrapper](#1-wrapper-05-verify-deploymentsh) step 1, [4.1 Skip switch](#41-skip-switch), [10. Buildspec changes](#10-buildspec-changes) |
| 13. Request behavior and budget | [5. HTTP client](#5-http-client), [7. Check catalog](#7-check-catalog) |
| 14. Reporting | [9. Output and reporting](#9-output-and-reporting) |
| 15. Local use | [2. Verifier command line](#2-verifier-command-line), [3. Environment interface](#3-environment-interface), [4.3 Input validation](#43-input-validation) |
| 16. Testing | [11. Test package](#11-test-package), [Testing strategy](#testing-strategy) |
| 17. Documentation | [Documentation plan](#documentation-plan) |

## Architecture

### Where it runs

```text
CodePipeline   Source ─► Build ─► Deploy ─► PostDeploy ─► ApproveToPromote ─► Promote
                                               │            (the last two only when PromoteTargetStageId is set)
                                               ▼
               PostDeploy CodeBuild project (upstream), running buildspec-postdeploy.yml
               env        VERIFY_SKIP: "false"                                          (new)
               install    Node (nodejs: latest), Pandoc
               pre_build  src/static: install, tests, audit
                          tests/postdeploy-verify: npm ci --include=dev, tests           (new)
               build      01 export API spec ─► 02 API docs ─► 03 Markdown docs ─► 04 publish to S3
                          ─► 05-verify-deployment.sh                                     (new)
```

A failure anywhere stops the build. Script 05 runs only after the docs are published (Q2), so a red stage still has current docs. When promotion is enabled, a red PostDeploy stage keeps the build from being promoted.

### One run, end to end

```text
05-verify-deployment.sh (Wrapper)                        verify-deployment.js (Verifier)

1  read the skip parameter from SSM
   VERIFY_SKIP_SSM_STATUS, VERIFY_SKIP_SSM_VALUE ──────► skip-check
                                                           on:  WARN, skipped report and VERIFY_REPORT line, exit 20
   exit 0 ◄───────────────────────────────────────────── (the Wrapper turns 20 into 0)
                                                           off: INFO, exit 0
2  check PREFIX ... PARAM_STORE_HIERARCHY, source env.sh
3  python3 write_release_version.py
   release-version <file> ─────────────────────────────► prints the expected version
4  build the raw URL
   edge-url <settings.json> <stageId> ─────────────────► prints the edge URL, or nothing
   log both targets and the expected version
5  read the key parameter from SSM
6  exec, every input in the environment ───────────────► run
                                                           validate inputs, classify the key
                                                           P1, S1, S2, P2 ... X2, one request at a time
                                                           sub-check lines, summary, report, VERIFY_REPORT line
                                                           exit 0 (passed) or 1
```

### Responsibilities

| Concern | Wrapper | Verifier |
|---------|---------|----------|
| Reading the two SSM parameters | Yes, with the AWS CLI | No |
| Deciding the skip switch | No; passes the raw values | Yes, `decideSkip()` |
| Required pipeline variables and `env.sh` | Checks them and collects problems | Reports them as outcome `error` |
| Expected version | Runs `write_release_version.py` | Reads and validates the generated file (`release-version`) |
| Edge target | Asks for it | Resolves it with `settings-loader.js` (`edge-url`) |
| The key | Reads it and passes it in the environment | Classifies it, validates it with S2, and uses it |
| Requests, sub-checks, outcome, report | No | Yes |

### Files

| File | Change |
|------|--------|
| `application-infrastructure/postdeploy-scripts/05-verify-deployment.sh` | New |
| `application-infrastructure/postdeploy-scripts/verify-deployment.js` | New |
| `application-infrastructure/tests/postdeploy-verify/` | New Jest package |
| `application-infrastructure/buildspec-postdeploy.yml` | Header comment, `env: variables`, a `pre_build` test step, and script 05 in `build` |
| `application-infrastructure/buildspec.yml` | Two `generate-put-ssm.py` calls |
| `application-infrastructure/tests/postdeploy/unit/buildspec-structure.test.js` | Expects five scripts |
| Documentation | See [Documentation plan](#documentation-plan) |

## Components and Interfaces

### 1. Wrapper (`05-verify-deployment.sh`)

The Wrapper follows scripts 01 to 04: `set -euo pipefail`, a `[05-verify-deployment]` prefix with `INFO`, `WARN`, and `ERROR`, `ERROR` lines on standard error, and paths relative to the repository root. It never exits early on a configuration problem. It collects problems in `config_error` and hands them to the Verifier, so every run that reaches the Verifier still produces a report (Requirement 14.3).

1. **Skip switch first** (Requirements 12.3, 12.7). Read `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifySkip`, or record `hierarchy-unset`, then run `skip-check`. Exit 0 when it returns 20; exit with its code when it returns anything else non-zero.
2. **Required inputs** (Requirements 1.3, 1.4). Check `PREFIX`, `PROJECT_ID`, `STAGE_ID`, `AWS_REGION`, and `PARAM_STORE_HIERARCHY`, then source `build/staging/api-spec/env.sh` and check `REST_API_ID` and `API_STAGE_NAME`.
3. **Expected version** (Requirement 3). Run `write_release_version.py`, keeping its standard error for the error message and discarding its progress output, then `release-version` on the generated file.
4. **Targets** (Requirements 2.1, 2.2, 2.5, 3.4). Build the raw URL, ask `edge-url` for the edge URL, and log both targets and the expected version.
5. **Key** (Requirement 11.2). When there is no configuration error, read `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifyApiKey`.
6. **Run** (Requirements 11.2, 14.3). `exec` the Verifier's `run` command with every input in its environment, so its exit code becomes the script's.

Sketch (the final script may differ in wording, not in behavior):

```bash
#!/bin/bash
set -euo pipefail

# >! Logging prefix for consistent build log identification
LOG_PREFIX="[05-verify-deployment]"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${SCRIPT_DIR}/verify-deployment.js"
ENV_FILE="build/staging/api-spec/env.sh"
RELEASE_VERSION_SCRIPT="application-infrastructure/build-scripts/write_release_version.py"
RELEASE_VERSION_FILE="application-infrastructure/src/lambda/read-function/config/release-version.js"
SETTINGS_FILE="application-infrastructure/src/static/settings.json"
SKIP_PARAM_SUFFIX="Mcp_PostDeployTestVerifySkip"
KEY_PARAM_SUFFIX="Mcp_PostDeployTestVerifyApiKey"
# Must match EXIT_CODES.SKIP_CHECK_SKIPPED in verify-deployment.js (a test checks this)
SKIP_CHECK_SKIPPED=20

log_info() { echo "${LOG_PREFIX} INFO: $*"; }

# Read one SSM SecureString into ssm_value, and the read result into ssm_status:
# "ok", the AWS error code (for example ParameterNotFound), or "error".
# >! Never prints the value. Standard error goes to a temporary file so a CLI
# >! warning cannot end up inside the value; only the AWS error code is kept.
read_ssm_parameter() {
  local name="$1" err_file
  err_file="$(mktemp)"
  if ssm_value="$(aws ssm get-parameter --name "${name}" --with-decryption \
      --query 'Parameter.Value' --output text 2>"${err_file}")"; then
    ssm_status="ok"
  else
    ssm_value=""
    ssm_status="$(sed -n 's/.*An error occurred (\([A-Za-z0-9]*\)).*/\1/p' "${err_file}")"
    ssm_status="${ssm_status%%$'\n'*}"
    ssm_status="${ssm_status:-error}"
  fi
  rm -f "${err_file}"
}

# 1. Skip switch, before any other input is gathered (Requirement 12.3)
skip_status="hierarchy-unset"
skip_value=""
if [[ -n "${PARAM_STORE_HIERARCHY:-}" ]]; then
  read_ssm_parameter "${PARAM_STORE_HIERARCHY}${SKIP_PARAM_SUFFIX}"
  skip_status="${ssm_status}"
  skip_value="${ssm_value}"
fi
skip_rc=0
VERIFY_SKIP_SSM_STATUS="${skip_status}" VERIFY_SKIP_SSM_VALUE="${skip_value}" \
  node "${VERIFIER}" skip-check || skip_rc=$?
if [[ "${skip_rc}" -eq "${SKIP_CHECK_SKIPPED}" ]]; then
  exit 0
elif [[ "${skip_rc}" -ne 0 ]]; then
  exit "${skip_rc}"
fi

# 2. Required inputs; problems are collected, not fatal, so the Verifier reports them
config_error=""
add_config_error() { config_error="${config_error:+${config_error}; }$1"; }
for var_name in PREFIX PROJECT_ID STAGE_ID AWS_REGION PARAM_STORE_HIERARCHY; do
  [[ -n "${!var_name:-}" ]] || add_config_error "${var_name} is not set"
done
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
fi
if [[ -z "${REST_API_ID:-}" || -z "${API_STAGE_NAME:-}" ]]; then
  add_config_error "${ENV_FILE} is missing or does not set REST_API_ID and API_STAGE_NAME"
fi

# 3. Expected version, from the same script the main build runs
expected_version=""
if py_err="$(python3 "${RELEASE_VERSION_SCRIPT}" 2>&1 >/dev/null)"; then
  expected_version="$(node "${VERIFIER}" release-version "${RELEASE_VERSION_FILE}")" \
    || add_config_error "no release version in ${RELEASE_VERSION_FILE}"
else
  add_config_error "write_release_version.py failed: ${py_err}"
fi

# 4. Targets
raw_url=""
if [[ -n "${REST_API_ID:-}" && -n "${API_STAGE_NAME:-}" && -n "${AWS_REGION:-}" ]]; then
  raw_url="https://${REST_API_ID}.execute-api.${AWS_REGION}.amazonaws.com/${API_STAGE_NAME}/mcp/v1"
fi
edge_url=""
if [[ -n "${STAGE_ID:-}" ]]; then
  edge_url="$(node "${VERIFIER}" edge-url "${SETTINGS_FILE}" "${STAGE_ID}")" \
    || add_config_error "could not read the custom domain from ${SETTINGS_FILE}"
fi
log_info "Raw target: ${raw_url:-unknown}"
log_info "Edge target: ${edge_url:-none (no custom domain for this stage)}"
log_info "Expected release version: ${expected_version:-unknown}"

# 5. Verification key
key_value=""
key_status="none"
if [[ -z "${config_error}" ]]; then
  read_ssm_parameter "${PARAM_STORE_HIERARCHY}${KEY_PARAM_SUFFIX}"
  key_status="${ssm_status}"
  key_value="${ssm_value}"
fi

# 6. Run. >! The key reaches the Verifier only through its environment, never as an argument
MCP_URL="${raw_url}" MCP_EDGE_URL="${edge_url}" EXPECTED_VERSION="${expected_version}" \
  MCP_API_KEY="${key_value}" MCP_KEY_STATUS="${key_status}" \
  VERIFY_SKIP_SSM_STATUS="${skip_status}" VERIFY_SKIP_SSM_VALUE="${skip_value}" \
  VERIFY_CONFIG_ERROR="${config_error}" \
  exec node "${VERIFIER}" run
```

Notes:

- No `set -x`, and no line echoes `key_value` or `ssm_value` (Requirement 11.6). The key is in a shell variable and in the environment of the process `exec` starts, and nowhere else. Other users on a host can read a process's arguments, but not its environment.
- `exec` ends the script, so an `EXIT` trap would not run. That is why each temporary file is removed right after its read.
- The AWS CLI reports failures as `An error occurred (<Code>) when calling the GetParameter operation: ...`. Only `<Code>` is kept, so nothing else from the message reaches the log.

### 2. Verifier command line

`verify-deployment.js` is one CommonJS file that needs no npm packages. Besides the Node.js standard library and the global `fetch`, it requires only its sibling `settings-loader.js`, for `edge-url`, because Requirement 2.2 names that module. Like `apply-settings.js` and `docs-nav-helpers.js`, it exports its functions directly and runs `main()` only under `require.main === module` (Requirement 1.5).

| Command | Caller | What it does | Exit codes |
|---------|--------|--------------|------------|
| none | Developers (Requirement 15.1) | Decides the skip switch from `VERIFY_SKIP`, then does what `run` does, also logging what the Wrapper would log: the targets and the expected version | 0 passed or skipped; 1 failed, inconclusive, or error |
| `skip-check` | Wrapper, step 1 | Decides and logs the skip switch. When it is on, writes the skipped report and prints the report line | 0 continue; 20 skipped; 1 error |
| `run` | Wrapper, step 6 | Validates inputs, runs the checks, reports | 0 passed; 1 otherwise |
| `release-version <file>` | Wrapper, step 3 | Prints `releaseVersion` from the generated module | 0; 1 when the file is missing or the value is not `x.y.z` |
| `edge-url <settings.json> <stageId>` | Wrapper, step 4 | Prints `https://<domain>/mcp/v1`, or an empty line when the merged settings have no `domain` | 0; 1 when the file cannot be read or parsed, or the domain is not a host name |

- An unknown command prints the usage to standard error and exits 1.
- `run` also works out the skip decision, without logging it, to record it in the report. If the switch is on (the Wrapper should already have stopped), `run` takes the skipped path and exits 0.
- `main()` never throws and resolves to the exit code. The entry point sets `process.exitCode` instead of calling `process.exit()`, so buffered output reaches the log.

The file is organized in this order: constants, input decisions (section 4), HTTP client (section 5), check engine (section 6), check catalog (section 7), outcome (section 8), output and report (section 9), command line. It exports:

```js
module.exports = {
  main,
  decideSkip, parseSkipValue, classifyKey, readInputs, validateConfig,
  createHttpClient, runChecks, computeOutcome,
  buildReport, formatReportLine, formatSubCheckLine, redact,
  SUB_CHECKS, CHECK_ORDER, REVISION_FLOOR, EXIT_CODES
};
```

Every exported function has JSDoc with `@param`, `@returns`, and `@example`, and security-relevant lines carry `// >!` comments.

### 3. Environment interface

| Variable | Set by in the pipeline | Default | Read by | Purpose |
|----------|------------------------|---------|---------|---------|
| `PREFIX`, `PROJECT_ID`, `STAGE_ID` | Pipeline | none | Wrapper, Verifier | Required by the Wrapper; the pipeline name in the retry hint; the report |
| `AWS_REGION` | Pipeline | none | Wrapper | The raw URL |
| `PARAM_STORE_HIERARCHY` | Pipeline | none | Wrapper, Verifier | Parameter names; the Verifier uses it only in messages |
| `VERIFY_SKIP` | `buildspec-postdeploy.yml` `env` | `false` | Verifier | Backup skip switch (Requirement 12.2) |
| `VERIFY_SKIP_SSM_STATUS` | Wrapper | unset, meaning SSM was not consulted | Verifier | Result of reading the skip parameter |
| `VERIFY_SKIP_SSM_VALUE` | Wrapper | empty | Verifier | Its value |
| `MCP_URL` | Wrapper | none (required) | Verifier | Raw target |
| `MCP_EDGE_URL` | Wrapper | empty, which skips X2 | Verifier | Edge target |
| `EXPECTED_VERSION` | Wrapper | none (required) | Verifier | V1 and X2.2 |
| `MCP_API_KEY` | Wrapper, from SSM | empty | Verifier | The key |
| `MCP_KEY_STATUS` | Wrapper: `ok`, an AWS error code, or `error` | `none` | Verifier | Result of reading the key parameter |
| `MCP_ORIGIN` | none | `https://example.com` | Verifier | `Origin` of the preflights |
| `VERIFY_REQUEST_TIMEOUT_MS` | none | `30000` | Verifier | Per-attempt timeout |
| `VERIFY_REPORT_PATH` | none | `build/verify/report.json` | Verifier | Report file, relative to the working directory |
| `VERIFY_CONFIG_ERROR` | Wrapper | empty | Verifier | Configuration problems the Wrapper found |

The names shared with the setup block in `TODO-MANUAL-VERIFY.md` (`MCP_URL`, `MCP_API_KEY`, `EXPECTED_VERSION`, `MCP_ORIGIN`) mean the same there (Requirement 15.2). The `VERIFY_SKIP_SSM_*` and `VERIFY_CONFIG_ERROR` variables exist only between the Wrapper and the Verifier.

### 4. Input decisions

All three are pure functions with no I/O.

#### 4.1 Skip switch

`decideSkip({ ssmStatus, ssmValue, verifySkip, parameterName })` returns `{ isOn, source, value, messages }` (Requirements 12.3 to 12.5).

| `VERIFY_SKIP_SSM_STATUS` | Value that decides | Message |
|--------------------------|--------------------|---------|
| `ok` | `VERIFY_SKIP_SSM_VALUE` | `INFO`: source is the SSM parameter |
| `ParameterNotFound` | `VERIFY_SKIP` | `INFO`: the parameter does not exist, so `VERIFY_SKIP` decides |
| `hierarchy-unset`, any other AWS code, `error` | `VERIFY_SKIP` | `WARN`: the parameter could not be read (with the status), so `VERIFY_SKIP` decides |
| unset (a local run) | `VERIFY_SKIP` | `INFO`: source is `VERIFY_SKIP` |

`parseSkipValue(raw)` trims and lowercases the value. `true` is on and `false` is off. An unset or empty `VERIFY_SKIP` means its default, `false`, with no warning. Any other value is off, with a `WARN` naming the source and the first 32 characters of the value (Requirement 12.4). The decision is logged once per run: by `skip-check` in the pipeline, and by the default command in a local run.

When the switch is on, the `WARN` says how to turn it off again. For the SSM source, that is the command below with the real parameter name filled in. For `VERIFY_SKIP`, it is to set the variable back to `"false"`.

```bash
aws ssm put-parameter --name "<PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifySkip" \
  --type SecureString --value false --overwrite
```

#### 4.2 Key classification

`classifyKey({ status, value, parameterName })` returns `{ classification, key, level, message }`. `key` is set only for `present`, and `message` never contains the value (Requirements 11.3 to 11.5, 15.3).

| `MCP_KEY_STATUS` | `MCP_API_KEY` | Classification | Level | Message, also the S2 skip reason |
|------------------|---------------|----------------|-------|----------------------------------|
| `ok` | `BLANK` (trimmed, any case) or empty | `placeholder` | `INFO` | no key configured: placeholder BLANK |
| `ok` | anything else | `present` | `INFO` | key configured; S2 checks it |
| `ParameterNotFound` | ignored | `not-found` | `INFO` | no key configured: parameter not found |
| `AccessDeniedException` | ignored | `access-denied` | `WARN` | key not readable: access denied on `<parameter>` |
| any other value | ignored | `error` | `WARN` | key not readable: `<status>` |
| unset or `none` | set | `present` | `INFO` | key configured; S2 checks it |
| unset or `none` | empty | `none` | `INFO` | no key given |

#### 4.3 Input validation

`validateConfig(inputs, { cwd })` returns a list of problems. Any problem ends the run with outcome `error` before a request is sent (Requirements 13.7, 14.4, 15.4).

| Input | Rule |
|-------|------|
| `VERIFY_CONFIG_ERROR` | Empty. Otherwise its text is the problem |
| `MCP_URL` | Present, parses with `new URL()`, and is `https:`, or `http:` for `localhost` or `127.0.0.1` |
| `MCP_EDGE_URL` | Empty, or the same rule as `MCP_URL` |
| `EXPECTED_VERSION` | Matches `^\d+\.\d+\.\d+$` |
| `VERIFY_REQUEST_TIMEOUT_MS` | Unset, or matches `^[1-9]\d*$` |
| `MCP_ORIGIN` | Unset, or an `http:` or `https:` URL, of which only the origin is used |
| `VERIFY_REPORT_PATH` | Resolved against `cwd`, does not fall inside `<cwd>/build/final/` |

### 5. HTTP client

`createHttpClient({ fetchImpl, timeoutMs, sleep, now })` returns `{ send(spec), stats }`. It sends one request at a time (Requirement 13.1).

Each request is built the same way:

- The headers form a plain object, so their case goes on the wire as written (Requirement 6.5). In order: `User-Agent: atlantis-mcp-postdeploy-verify` on every request, `Content-Type: application/json` on every POST, the spec's own headers, and `X-API-Key` when the spec carries a key (Requirement 13.5).
- A POST body is the spec's JSON-RPC object with a run-unique `id` (`verify-1`, `verify-2`, and so on), serialized with `JSON.stringify`.
- Every attempt has `redirect: 'manual'` and its own `AbortSignal.timeout(timeoutMs)` (Requirements 13.2, 13.6).
- `X-Forwarded-For` and cookies are never sent. `Authorization` is sent only by S2's second request. Sending `X-Forwarded-For` would pick a fresh public rate-limit bucket on every run, the weakness that spec [`0-0-7-rate-limit-client-ip-spoofing`](../0-0-7-rate-limit-client-ip-spoofing/ISSUE.md) fixes.

Retries (Requirement 13.3):

| First attempt | Second attempt |
|---------------|----------------|
| Network error, or timeout | Yes, after `sleep(1000)` |
| HTTP 502, 503, or 504 | Yes, after `sleep(1000)` |
| Anything else, including 3xx, 401, 403, 404, 429, and 500 | No |

The client returns an `Exchange` (see [Data models](#data-models)). A timeout is recognized by the error name `TimeoutError`. Other failures are recorded by the `cause` code when there is one (for example `ENOTFOUND` or `ECONNREFUSED`), otherwise as `network`. The client never logs. It counts POSTs, preflights, and retries in `stats`, for the report.

### 6. Check engine

`runChecks(ctx)` walks `CHECK_ORDER` and runs each check's function. A check builds its request specs, sends them through `ctx.send()`, and records each of its sub-checks with `ctx.record()`. That call prints the line immediately, so a slow run shows its progress, and stores the result.

The context:

```js
const ctx = {
  config,                  // validated inputs
  send,                    // wraps http.send(); see "Not attempted" below
  output,                  // prefixed logger and raw line writer, both redacting
  results: [],             // SubCheckResult[], in the order recorded
  baseline: null,          // { supportedVersions, instructions, rateLimitLimit } from P1
  baselineState: 'pending',// 'ok' | 'rate-limited' | 'failed'
  rawTargetDown: false,    // Requirement 4.6
  key: null,               // the classified key, when present
  effectiveKey: null,      // the key, once S2 accepts it
  rateLimit: null          // { retryAfterSeconds, resetAt } from the last 429
};
```

**Gate.** Before a sub-check evaluates an exchange, `gateExchange(exchange, expectation)` turns transport and envelope problems into an outcome. The first rule that matches wins:

| Exchange | Outcome and reason |
|----------|--------------------|
| Not attempted | FAIL "not attempted: raw target did not answer P1" (Requirement 4.6) |
| No response | FAIL "no response (`<timeout or code>`) after 2 attempts" |
| HTTP 429 | SKIP "no answer: rate limited (HTTP 429)" (Requirement 10.4); records the reset time |
| HTTP 3xx | FAIL "redirect (HTTP `<status>`) to `<host>` was not followed" (Requirement 13.6) |
| Any other status than expected (200, or 401 for S1) | FAIL "HTTP `<status>`, expected `<expected>`; body: `<excerpt>`" |
| JSON-RPC request whose body is not JSON, has no `jsonrpc: "2.0"`, or answers another `id` | FAIL "not a JSON-RPC 2.0 response to `<id>`; body: `<excerpt>`" |

**Dependencies.** The catalog lists the exchanges each sub-check evaluates. The first exchange that fails its gate decides the sub-check's outcome. Each exchange has an owner, the first sub-check listed for it. The owner's reason includes the body excerpt. Every other sub-check of that exchange says "no usable response; see `<owner ID>`". There are two exceptions: a `429` and a "not attempted" exchange give every sub-check that depends on them exactly the reason the requirements name.

**Baseline.** P2.7, P3.3, S2.3, and P5.9 compare against P1. When P1 got HTTP 429, they are SKIP with "no baseline: P1 had no answer", and every other sub-check still runs (Requirement 10.6). When P1 answered but a baseline field is missing or has the wrong type, they FAIL with "no baseline: P1 returned no valid `<field>`". P1 has already failed in that case.

**Not attempted.** After P1's exchange, `rawTargetDown` is set when P1 got no response, or HTTP 500 or higher, after its retry. From then on, `ctx.send()` returns a not-attempted exchange for every raw-target request without calling `fetch`. The X2 requests go to the edge target and still run (Requirement 4.6).

**Key handling.** S2 runs only when the key classification is `present`. After S2.1 and S2.3 are recorded, `effectiveKey` is set when S2.1 passed and S2.3 did not fail (Requirement 9.4). Every POST after S2 carries `effectiveKey`. Preflights and S1 never carry the key (Requirement 13.8).

**Placement of V1.** V1.1 is recorded right after P1's sub-checks, so a stale deploy shows near the top of the log. V1.2 is recorded right after P2's.

**Revisions beyond the floor.** The extra revisions are the ones in P1's `supportedVersions` that are not in `REVISION_FLOOR`, in the server's order. P5 sends one `tools/list` for each, and P5.9 evaluates them together. With no extras, P5.9 passes with the note "none advertised".

### 7. Check catalog

The checks run in this order: P1 (then V1.1), S1, S2, P2 (then V1.2), P3, P4, P5, P6, T1, X1, X2. `SUB_CHECKS` holds every sub-check's ID, check, severity, and title. A test fixes the list of IDs, so changing or reusing one is a deliberate edit (Requirement 10.2).

#### Requests

Where the table says "header", the revision is sent as `MCP-Protocol-Version: <revision>`. Where it says `params._meta`, it is sent as `params._meta["io.modelcontextprotocol/protocolVersion"]`. The HTTP client adds the `id`.

| Request | Target and method | Revision | Other headers | JSON-RPC method and params | Key |
|---------|-------------------|----------|---------------|----------------------------|-----|
| P1 | raw POST | none | none | `server/discover` | never |
| S1 | raw POST | none | `X-API-Key: postdeploy-verify-invalid-key` | `initialize`, no params | made-up value |
| S2a | raw POST | none | none | `initialize`, no params | `X-API-Key` |
| S2b | raw POST | none | `Authorization: Bearer <key>` | `initialize`, no params | Bearer |
| P2a to P2d | raw POST | `params.protocolVersion`: `2025-11-25`, `2024-11-05`, `2025-06-18`, `2099-01-01` | none | `initialize` with `capabilities: {}` and `clientInfo` | effective |
| P2e | raw POST | none | none | `initialize`, no params | effective |
| P3a | raw POST | header `2099-01-01` | none | `tools/list` | effective |
| P3b | raw POST | `params._meta` `2099-01-01` | none | `tools/list` | effective |
| P4a | raw POST | header `2026-07-28` | `Mcp-Method: tools/call` | `tools/list` | effective |
| P4b | raw POST | header `2026-07-28` | `Mcp-Method: tools/call`, `Mcp-Name: list_categories` | `tools/call`, `list_tools`, `{}` | effective |
| P4c | raw POST | header `2026-07-28` | `Mcp-Method: tools/call`, `Mcp-Name: list_tools` | `tools/call`, `list_tools`, `{}` | effective |
| P4d | raw POST | `mcp-protocol-version: 2026-07-28` | `MCP-METHOD: tools/call` | `tools/list` | effective |
| P4e | raw POST | none | `Mcp-Method: tools/call`, `Mcp-Name: something_else` | `tools/list` | effective |
| P5a | raw POST | header `2026-07-28` | none | `tools/list` | effective |
| P5b | raw POST | `params._meta` `2026-07-28` | none | `tools/list` | effective |
| P5c | raw POST | header `2025-11-25` | none | `tools/list` | effective |
| P5d | raw POST | header `2024-11-05` | none | `tools/list` | effective |
| P5e | raw POST | none | none | `tools/list` | effective |
| P5x | raw POST | header, one per extra revision | none | `tools/list` | effective |
| P6a | raw POST | header `2026-07-28` | none | `tools/call`, `list_tools`, `{}` | effective |
| P6b | raw POST | header `2025-11-25` | none | `tools/call`, `list_tools`, `{}` | effective |
| T1 | raw POST | header `2026-07-28` | none | `tools/call`, `list_templates`, `{}` | effective |
| X1 | raw OPTIONS | none | `Origin: <MCP_ORIGIN>`, `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: MCP-Protocol-Version,Mcp-Method,Mcp-Name,Content-Type` | none | never |
| X2a | edge OPTIONS | none | as X1 | none | never |
| X2b | edge POST | none | none | `server/discover` | effective |
| X2c | edge POST | header `2026-07-28` | `Mcp-Method: tools/call` | `tools/list` | effective |
| X2d | edge POST | header `2026-07-28` | `Mcp-Method: tools/call`, `Mcp-Name: list_categories` | `tools/call`, `list_tools`, `{}` | effective |

`clientInfo` is `{ "name": "atlantis-mcp-postdeploy-verify", "version": "<expected version>" }`, as a real legacy client would send. P2e sends no params on purpose, to check the default offer.

Counted requests, not counting retries (Requirement 13.4):

| Run | Against the client IP | Against the key's tier |
|-----|-----------------------|------------------------|
| No key, no edge target (`test`) | 21: P1, P2a to P2e, P3a and P3b, P4a to P4e, P5a to P5e, P6a and P6b, T1 | 0 |
| No key, edge target (`beta`, `prod`) | 24: the 21 above, plus X2b to X2d | 0 |
| Key accepted, no edge target | 1: P1 | 22: S2a and S2b, plus the other 20 |
| Key accepted, edge target | 1: P1 | 25 |

S1 is rejected before the rate limiter, and API Gateway answers the preflights. Each extra revision adds one request, against whichever budget the run is using.

#### Sub-checks

Severity: C is core, A is advisory. "No `error`" means the JSON-RPC response has no `error` member and has a `result` object.

| ID | Sev | Title | Evaluates | Passes when |
|----|-----|-------|-----------|-------------|
| P1.1 | C | server/discover answers without a key | P1 | The gate passes and there is no `error` |
| P1.2 | C | server/discover uses the modern envelope | P1 | `resultType` is `complete`, `ttlMs` is a non-negative integer, `cacheScope` is `public` or `private`, and there is no top-level `protocolVersion` or `serverInfo` |
| P1.3 | C | server name is atlantis-mcp-server | P1 | `_meta["io.modelcontextprotocol/serverInfo"].name` is `atlantis-mcp-server` |
| P1.4 | C | instructions is a non-empty string | P1 | |
| P1.5 | C | supportedVersions contains the revision floor | P1 | An array of strings containing `2024-11-05`, `2025-11-25`, and `2026-07-28` |
| V1.1 | C | server/discover reports the expected version | P1 | `_meta["io.modelcontextprotocol/serverInfo"].version` equals the expected version |
| S1.1 | A | an invalid API key is rejected with HTTP 401 | S1 | HTTP 401. A `200` reason also names `X-MCP-Auth-Status: degraded` when that header is present |
| S2.1 | A | the stored key is accepted in X-API-Key | S2a | HTTP 200, no `error`, no `X-MCP-Auth-Status: degraded` |
| S2.2 | A | the stored key is accepted as a Bearer token | S2b | The same |
| S2.3 | A | the stored key gets a higher rate limit than the public tier | S2a, baseline | Its `X-RateLimit-Limit` is greater than P1's |
| P2.1 | C | initialize echoes 2025-11-25 | P2a | No `error`; `protocolVersion` is `2025-11-25` |
| P2.2 | C | initialize echoes 2024-11-05 | P2b | `2024-11-05` |
| P2.3 | C | initialize offers 2024-11-05 for 2025-06-18 | P2c | `2024-11-05` |
| P2.4 | C | initialize offers 2025-11-25 for 2099-01-01 | P2d | `2025-11-25` |
| P2.5 | C | initialize without params offers 2025-11-25 | P2e | `2025-11-25` |
| P2.6 | C | the legacy initialize result has exactly four keys | P2a | Keys are exactly `capabilities`, `instructions`, `protocolVersion`, `serverInfo`; `serverInfo.name` is `atlantis-mcp-server` |
| P2.7 | C | initialize instructions match server/discover | P2a to P2e, baseline | Every `instructions` is byte-identical to P1's |
| V1.2 | C | initialize reports the expected version | P2a | `serverInfo.version` equals the expected version |
| P3.1 | C | -32022 for an unlisted revision in the header | P3a | HTTP 200; `error.code` is `-32022`; `error.data.declaredRevision` is `2099-01-01` |
| P3.2 | C | -32022 for an unlisted revision in params._meta | P3b | The same |
| P3.3 | C | -32022 lists the advertised supportedVersions | P3a, P3b, baseline | `error.data.supportedVersions` equals P1's, in the same order, in both responses |
| P4.1 | C | -32020 for a mismatched Mcp-Method | P4a | `error.code` is `-32020`; `error.data.headerValue` is `tools/call` |
| P4.2 | C | -32020 for a mismatched Mcp-Name | P4b | `-32020`; `headerValue` is `list_categories` |
| P4.3 | C | matching Mcp-Method and Mcp-Name are accepted | P4c | No `error`; `resultType` is `complete` |
| P4.4 | C | Mcp-* header names are matched without regard to case | P4d | `-32020` |
| P4.5 | C | a legacy request ignores mismatched Mcp-* headers | P4e | No `error`; a non-empty `tools` array |
| P5.1 | C | tools/list for 2026-07-28 (header) is a modern cacheable result | P5a | No `error`; `resultType` is `complete`; `ttlMs` is a non-negative integer; `cacheScope` is `public` or `private`; the `_meta` server name is `atlantis-mcp-server`; a non-empty `tools` array |
| P5.2 | C | tools/list for 2026-07-28 (params._meta) is a modern cacheable result | P5b | The same |
| P5.3 | C | tools/list for 2025-11-25 carries only tools | P5c | No `error`; a non-empty `tools` array; none of `ttlMs`, `cacheScope`, `resultType`, `_meta` |
| P5.4 | C | tools/list for 2024-11-05 carries only tools | P5d | The same |
| P5.5 | C | tools/list without a revision carries only tools | P5e | The same |
| P5.6 | C | every tool has a title and read-only annotations on 2025-11-25 and later | P5a, P5b, P5c | Every tool has `title` and `annotations`, with `readOnlyHint` `true` and `openWorldHint` `false` |
| P5.7 | C | no tool has a title or annotations on 2024-11-05 or without a revision | P5d, P5e | No tool has `title` or `annotations` |
| P5.8 | C | every revision lists the same tools in the same order | P5a to P5e | The arrays of tool names are equal |
| P5.9 | C | revisions beyond the floor are accepted | P5x, baseline | Each has no `error` and a non-empty `tools` array. Notes "none advertised" when there are none |
| P6.1 | C | modern tools/call carries resultType and _meta | P6a | No `error`; `resultType` is `complete`; `_meta` has `io.modelcontextprotocol/serverInfo` |
| P6.2 | C | legacy tools/call carries neither resultType nor _meta | P6b | No `error`; a non-empty `content` array; no `resultType`, no `_meta` |
| T1.1 | A | list_templates returns template data | T1 | No `error`; `content[0].type` is `text`, and its text parses as JSON to a value other than `null` |
| X1.1 | C | preflight answers HTTP 200 for the origin | X1 | HTTP 200; `Access-Control-Allow-Origin` is `*` or `MCP_ORIGIN` |
| X1.2 | C | preflight allows MCP-Protocol-Version, Mcp-Method, and Mcp-Name | X1 | All three in `Access-Control-Allow-Headers`, compared without regard to case |
| X1.3 | C | preflight allows POST | X1 | `POST` in `Access-Control-Allow-Methods` |
| X2.1 | A | edge preflight allows the origin, the MCP headers, and POST | X2a | The X1.1 to X1.3 conditions |
| X2.2 | A | edge server/discover reports the expected version | X2b | No `error`; the reported version equals the expected version |
| X2.3 | A | edge returns -32020 for a mismatched Mcp-Method | X2c | `-32020` |
| X2.4 | A | edge returns -32020 for a mismatched Mcp-Name | X2d | `-32020` |

That is 36 core and 9 advisory sub-checks. Without an edge target, X2.1 to X2.4 are SKIP "no custom domain for this stage" (Requirement 2.3). Without a key, S2.1 to S2.3 are SKIP with the key classification (Requirement 9.5). When X2.3 or X2.4 gets a normal result instead of `-32020`, the reason adds "the edge may not be forwarding the MCP-Protocol-Version or Mcp-* headers" (Requirement 9.7).

A failing assertion names the field, the expected value, and the actual value, each JSON-encoded and cut to 80 characters. Examples:

```text
result.protocolVersion is "2025-11-25", expected "2024-11-05"
result.supportedVersions is missing "2026-07-28"
tool "list_tools" has no annotations
result has unexpected key "resultType"
```

### 8. Outcome

`computeOutcome({ skipped, problems, results })` applies the first rule that matches (Requirement 10.5):

| Rule | Outcome | Exit code |
|------|---------|-----------|
| The skip switch is on | `skipped` | 0 |
| An input problem, or an internal error | `error` | 1 |
| A core sub-check is FAIL | `failed` | 1 |
| A core sub-check is SKIP, which happens only after HTTP 429 or a missing baseline | `inconclusive` | 1 |
| Otherwise | `passed`, with warnings and skips listed | 0 |

Advisory sub-checks never change the outcome. `failed` adds an `ERROR` line listing the failed core IDs. `error` adds an `ERROR` line with the problem. `inconclusive` adds these `WARN` lines (Requirement 10.7):

```text
[05-verify-deployment] WARN: Rate limited (HTTP 429). The limit resets at 2026-10-22T06:00:00Z (in 1830 s)
[05-verify-deployment] WARN: Nothing retries automatically. After that time, retry the PostDeploy stage in the CodePipeline console, or run:
[05-verify-deployment] WARN:   aws codepipeline retry-stage-execution --pipeline-name "acme-atlantis-mcp-beta-Pipeline" --stage-name PostDeploy --retry-mode FAILED_ACTIONS --pipeline-execution-id "<execution-id>"
[05-verify-deployment] WARN: Find <execution-id> with:
[05-verify-deployment] WARN:   aws codepipeline get-pipeline-state --name "acme-atlantis-mcp-beta-Pipeline" --query "stageStates[?stageName=='PostDeploy'].latestExecution.pipelineExecutionId" --output text
```

The reset time comes from the last 429's `Retry-After`, added to the current time. Without that header it comes from `X-RateLimit-Reset`, and without both it says "unknown". The pipeline name is `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-Pipeline`, or `<pipeline-name>` when those variables are not set, as in a local run.

### 9. Output and reporting

#### Lines

| Line | Format | Stream |
|------|--------|--------|
| Log | `[05-verify-deployment] <LEVEL>: <message>` | `INFO` and `WARN` to standard output, `ERROR` to standard error |
| Sub-check | `<LABEL>  <ID>  <title>`, followed by ` (<reason>)` for FAIL, WARN, and SKIP, or ` (<note>)` for a PASS with a note. The label is padded to 4 characters and the ID to 5 | Standard output |
| Report line | `VERIFY_REPORT <compact JSON>` | Standard output |

A run on `beta` with no key stored, where the edge drops a header:

```text
[05-verify-deployment] INFO: Skip switch: off (SSM parameter /atlantis-mcp/PROD/acme-atlantis-mcp-beta/Mcp_PostDeployTestVerifySkip is "false")
[05-verify-deployment] INFO: Raw target: https://abc123.execute-api.us-east-1.amazonaws.com/atlantis-mcp-beta/mcp/v1
[05-verify-deployment] INFO: Edge target: https://mcp-beta.atlantis.63klabs.net/mcp/v1
[05-verify-deployment] INFO: Expected release version: 0.0.7
[05-verify-deployment] INFO: Verification key: no key configured: placeholder BLANK. Running at the public tier
PASS  P1.1   server/discover answers without a key
PASS  P1.2   server/discover uses the modern envelope
PASS  V1.1   server/discover reports the expected version
PASS  S1.1   an invalid API key is rejected with HTTP 401
SKIP  S2.1   the stored key is accepted in X-API-Key (no key configured: placeholder BLANK)
PASS  P5.9   revisions beyond the floor are accepted (none advertised)
WARN  X2.4   edge returns -32020 for a mismatched Mcp-Name (result instead of error -32020; the edge may not be forwarding the MCP-Protocol-Version or Mcp-* headers)
[05-verify-deployment] INFO: Core: 36 passed, 0 failed, 0 skipped. Advisory: 5 passed, 1 warned, 3 skipped
[05-verify-deployment] INFO: Outcome: passed
[05-verify-deployment] INFO: Report: build/verify/report.json
VERIFY_REPORT {"tool":"atlantis-mcp-postdeploy-verify","schemaVersion":1,"outcome":"passed","exitCode":0,"expectedVersion":"0.0.7",...}
```

(Most sub-check lines are left out above.)

#### Report

The report is one JSON object. The report line carries the same object, compact. The key order keeps `outcome` ahead of `checks`, so a Logs Insights `parse` on the first `"outcome"` finds the run's outcome (Requirement 14.5).

| Field | Content |
|-------|---------|
| `tool`, `schemaVersion` | `atlantis-mcp-postdeploy-verify`, `1` |
| `outcome`, `exitCode` | The run outcome and its exit code |
| `expectedVersion` | The release version that should be live |
| `failedCore`, `skippedCore`, `warnings` | IDs of failed core, skipped core, and failed advisory sub-checks |
| `stage` | `{ prefix, projectId, stageId }`, each `null` when unset |
| `startedAt`, `finishedAt`, `durationMs` | ISO 8601 times and the duration |
| `targets` | `{ raw, edge }`; `edge` is `null` when there is none |
| `reportedVersions` | `{ discover, initialize, edge }`; `null` where nothing was reported |
| `supportedVersions` | P1's list, or `null` |
| `key` | `{ classification, used }`. Never the key |
| `skip` | `{ on, source, value }` |
| `counts` | `{ core: { passed, failed, skipped }, advisory: { passed, warned, skipped } }` |
| `requests` | `{ posts, preflights, retries }` |
| `rateLimit` | `{ retryAfterSeconds, resetAt }` after a 429, otherwise `null` |
| `error` | `{ message }` for outcome `error`, otherwise `null` |
| `checks` | One entry per sub-check, in the order recorded: `{ id, check, title, severity, outcome, label, reason, note, durationMs }`. `durationMs` is the time spent on the requests the sub-check evaluated, 0 when it only compared earlier answers |

A skipped run's report has outcome `skipped`, its `skip` field, and empty `checks`. A run with an input problem has outcome `error`, its `error` field, and empty `checks`.

#### Writing and redaction

- The report is written as indented JSON to `VERIFY_REPORT_PATH`, creating the directory first. If writing fails, the Verifier logs a `WARN` and goes on, since the report line in the build log is the record that persists. The outcome does not change (Requirement 14.4).
- Exactly one report line is printed per run that reaches the Verifier: by `skip-check` when the switch is on, otherwise by `run` or by the default command (Requirement 14.6).
- `redact(text, secrets)` replaces every occurrence of each secret of 8 or more characters with `[REDACTED]`. The secret is the stored key, whether or not S2 accepted it. The output layer redacts every line it writes, and the report writer redacts the serialized JSON (Requirements 11.6, 14.8).
- A body excerpt is redacted first, then its whitespace collapsed, then cut to 300 characters with `...` added. Redacting before cutting means a cut cannot leave a fragment of the key behind (Requirement 14.7).
- Request headers are never formatted into any message. Reasons describe response fields only.

### 10. Buildspec changes

#### Post-deploy buildspec

```yaml
version: 0.2

# POST-DEPLOYMENT BUILDSPEC
# Orchestrates static site generation and deployment verification after the
# application CloudFormation stack deploys. Executes scripts in sequence to export
# the API spec, generate HTML docs, sync them to S3, and verify the deployed stage.
#
# Required environment variables (provided by the pipeline):
#   PREFIX, PROJECT_ID, STAGE_ID - CloudFormation stack and pipeline name derivation
#   S3_STATIC_HOST_BUCKET        - Target S3 bucket for static hosting
#   PARAM_STORE_HIERARCHY        - SSM path of the verification key and skip switch (05)
#   AWS_REGION                   - Region of the stack, used to build the raw API URL (05)

env:
  variables:
    # >! Backup skip switch for 05-verify-deployment.sh, used only when the SSM parameter
    # >! ${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifySkip is missing or unreadable.
    # >! "true" skips deployment verification. Keep it "false".
    VERIFY_SKIP: "false"
```

In `pre_build`, after the static site's commands:

```yaml
      # Post-deploy verifier: install its pinned test dependencies and run its tests
      # before any post-deploy script runs (NODE_ENV=production requires --include=dev)
      - echo "--- Testing Post-Deploy Verifier ---"
      - cd "$CODEBUILD_SRC_DIR/application-infrastructure/tests/postdeploy-verify"
      - npm ci --include=dev
      - NODE_ENV=test npm test
      - cd "$CODEBUILD_SRC_DIR"
```

No `npm audit` here: nothing from this package is deployed, and the static site's audit gate already skips development dependencies.

At the end of `build`:

```yaml
      - echo "Post-deployment static generation complete"

      # >! Verify the deployed stage last. A core failure fails the build and blocks promotion
      - echo "Running 05-verify-deployment.sh..."
      - bash -e application-infrastructure/postdeploy-scripts/05-verify-deployment.sh
```

#### Main buildspec

Next to the existing `GitHubToken` call (Requirements 11.1, 12.1):

```yaml
      # Save a spot for GitHub Token
      - python3 ./build-scripts/generate-put-ssm.py ${PARAM_STORE_HIERARCHY}GitHubToken
      # Post-deploy verification: save a spot for its API key (BLANK = run without a key)
      - python3 ./build-scripts/generate-put-ssm.py ${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifyApiKey
      # Post-deploy verification: skip switch, so verification runs by default
      - python3 ./build-scripts/generate-put-ssm.py ${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifySkip --value false
```

#### Stale structure test

In `tests/postdeploy/unit/buildspec-structure.test.js`, `expect(scriptCommands.length).toBe(4)` becomes `toBe(5)`, and the order block gains `expect(scriptCommands[4]).toContain('05-verify-deployment.sh')`. Nothing else in `tests/postdeploy` changes (Requirement 16.7). The suite still runs nowhere until [`0-0-7-revive-postdeploy-tests`](../0-0-7-revive-postdeploy-tests/ISSUE.md) lands.

### 11. Test package

```text
application-infrastructure/tests/postdeploy-verify/
├── package.json
├── package-lock.json                       committed, so npm ci works
├── jest.config.js
├── helpers/
│   ├── load-verifier.mjs                   loads the CommonJS Verifier with createRequire
│   ├── fake-mcp-server.mjs                 model of a deployed stage; returns real Response objects
│   └── run-verifier.mjs                    calls main() with captured streams, a temporary report path, an instant sleep
├── cli-tests.jest.mjs
├── inputs-tests.jest.mjs
├── http-client-tests.jest.mjs
├── fake-mcp-server-tests.jest.mjs
├── checks-tests.jest.mjs
├── outcome-and-report-tests.jest.mjs
├── budget-tests.jest.mjs
├── buildspec-and-wrapper-tests.jest.mjs
├── input-decisions-property-tests.jest.mjs
├── retry-property-tests.jest.mjs
├── outcome-property-tests.jest.mjs
└── secret-redaction-property-tests.jest.mjs
```

```json
{
  "name": "atlantis-mcp-postdeploy-verify-tests",
  "version": "0.0.1",
  "private": true,
  "description": "Tests for the post-deploy verifier, postdeploy-scripts/verify-deployment.js",
  "type": "module",
  "scripts": {
    "test": "node --experimental-vm-modules ./node_modules/jest/bin/jest.js"
  },
  "devDependencies": {
    "@jest/globals": "30.5.2",
    "fast-check": "4.10.2",
    "jest": "30.5.2",
    "js-yaml": "4.3.1"
  }
}
```

```js
// jest.config.js
export default {
  testEnvironment: 'node',
  testMatch: ['**/*.jest.mjs'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {}
};
```

The versions are the latest published releases at design time (2026-10), pinned exactly (Requirement 16.1). The exception is js-yaml: 5.x is a new major, so the package stays on 4.3.1, the version the repository already resolves. The setup mirrors the static site's package: ES modules, Jest run with `--experimental-vm-modules`, and no transform.

**The fake server.** `createFakeMcpServer(options)` returns `{ fetch, calls }`. It models the documented behavior of a deployed stage:

- era resolution from the header, `params._meta`, or a top-level `_meta`
- `-32022`, except on `server/discover`
- `-32020` on modern requests only
- the legacy counter-offer rule
- `title` and `annotations` by revision
- the modern envelopes
- `401` for an unknown key, and rate-limit headers per tier
- the preflight answer from the `template.yml` CORS stanza

Options change one behavior at a time: a stale version, a missing revision, an edge that drops headers, a `429` on chosen requests, a `5xx` or a timeout on P1, a redirect, a server that echoes request headers into its response bodies, and so on. `calls` records each request's URL, method, headers, and body, for the budget, header, and key-placement assertions.

**Running the Verifier.** `runVerifier({ env, server })` calls `main()` with the fake `fetch`, captured standard output and standard error, `sleep` that resolves at once, a fixed clock, and a report path under `fs.mkdtempSync()`, and removes that directory afterwards. Each test file replaces `globalThis.fetch` with a function that throws, so an accidental real request fails loudly.

## Data Models

```js
/**
 * @typedef {Object} RequestSpec
 * @property {string} key           Request name from the catalog, for example 'P2c'
 * @property {'raw'|'edge'} target
 * @property {'POST'|'OPTIONS'} method
 * @property {Object<string, string>} headers   Sent as written; case preserved
 * @property {Object} [body]        JSON-RPC request without `id`; the client adds it
 * @property {string|null} [apiKey] Sent as X-API-Key when set
 */

/**
 * @typedef {Object} Exchange
 * @property {'response'|'no-response'|'not-attempted'} kind
 * @property {string|null} jsonRpcId  The `id` the client sent; null for a preflight
 * @property {number} [status]
 * @property {Object<string, string>} [headers]  Response headers, lower-case names
 * @property {string} [bodyText]
 * @property {*} [json]             Parsed body; undefined when it is not JSON
 * @property {string} [error]       'timeout', a network error code, or 'network'
 * @property {number} attempts      1 or 2
 * @property {number} durationMs
 */

/**
 * @typedef {Object} SubCheckResult
 * @property {string} id            For example 'P2.3'
 * @property {string} check         For example 'P2'
 * @property {string} title
 * @property {'core'|'advisory'} severity
 * @property {'pass'|'fail'|'skip'} outcome
 * @property {'PASS'|'FAIL'|'WARN'|'SKIP'} label   WARN for an advisory fail
 * @property {string|null} reason   Set for fail and skip
 * @property {string|null} note     Optional, pass only, for example 'none advertised'
 * @property {number} durationMs
 */

/**
 * @typedef {Object} SkipDecision
 * @property {boolean} isOn
 * @property {'ssm-parameter'|'verify-skip'} source
 * @property {string} value         Trimmed, first 32 characters
 * @property {Array<{level: 'INFO'|'WARN', message: string}>} messages
 */

/**
 * @typedef {Object} KeyInfo
 * @property {'present'|'placeholder'|'not-found'|'access-denied'|'error'|'none'} classification
 * @property {string|null} key      Only when present. Never logged or reported
 * @property {'INFO'|'WARN'} level
 * @property {string} message       Never contains the key
 */
```

Report example, shortened to two of its 45 checks:

```json
{
  "tool": "atlantis-mcp-postdeploy-verify",
  "schemaVersion": 1,
  "outcome": "passed",
  "exitCode": 0,
  "expectedVersion": "0.0.7",
  "failedCore": [],
  "skippedCore": [],
  "warnings": ["X2.4"],
  "stage": { "prefix": "acme", "projectId": "atlantis-mcp", "stageId": "beta" },
  "startedAt": "2026-10-22T05:10:00.000Z",
  "finishedAt": "2026-10-22T05:10:07.512Z",
  "durationMs": 7512,
  "targets": {
    "raw": "https://abc123.execute-api.us-east-1.amazonaws.com/atlantis-mcp-beta/mcp/v1",
    "edge": "https://mcp-beta.atlantis.63klabs.net/mcp/v1"
  },
  "reportedVersions": { "discover": "0.0.7", "initialize": "0.0.7", "edge": "0.0.7" },
  "supportedVersions": ["2024-11-05", "2025-11-25", "2026-07-28"],
  "key": { "classification": "placeholder", "used": false },
  "skip": { "on": false, "source": "ssm-parameter", "value": "false" },
  "counts": {
    "core": { "passed": 36, "failed": 0, "skipped": 0 },
    "advisory": { "passed": 5, "warned": 1, "skipped": 3 }
  },
  "requests": { "posts": 25, "preflights": 2, "retries": 0 },
  "rateLimit": null,
  "error": null,
  "checks": [
    {
      "id": "P1.1", "check": "P1", "title": "server/discover answers without a key",
      "severity": "core", "outcome": "pass", "label": "PASS", "reason": null, "note": null, "durationMs": 412
    },
    {
      "id": "X2.4", "check": "X2", "title": "edge returns -32020 for a mismatched Mcp-Name",
      "severity": "advisory", "outcome": "fail", "label": "WARN",
      "reason": "result instead of error -32020; the edge may not be forwarding the MCP-Protocol-Version or Mcp-* headers",
      "note": null, "durationMs": 188
    }
  ]
}
```

## Correctness Properties

Each property is a fast-check test with the default 100 runs. None spawns a process, so the default is affordable.

### Property 1: Only `true` turns the skip switch on

*For any* string read from the skip parameter or from `VERIFY_SKIP`, `decideSkip()` reports the switch as on if and only if the decisive value, trimmed and lowercased, equals `true`, and any value other than `true`, `false`, or empty produces a `WARN`.

**Validates: Requirements 12.4, 16.5**

### Property 2: The key never reaches any output

*For any* key, either of the real form `atl_` plus 32 hex characters or a random string of 20 to 64 characters from `[A-Za-z0-9_-]`, and *for any* fake-server scenario, no standard output, no standard error, no report file, and no report line contains the key. The scenarios include a healthy stage, a rejected key, a `429` everywhere, and a server that echoes request headers into its response bodies.

**Validates: Requirements 11.6, 14.7, 14.8, 16.5**

### Property 3: Outcome precedence

*For any* list of sub-check results with random severities and outcomes, and any combination of the skipped, problem, and internal-error flags, `computeOutcome()` returns the first matching rule of [8. Outcome](#8-outcome). Changing the outcome of any advisory result never changes the run outcome.

**Validates: Requirements 10.3, 10.5**

### Property 4: Bounded retries

*For any* first and second transport result, drawn from network errors, timeouts, and HTTP statuses 200 to 599, the client makes at most two attempts. It makes a second attempt only when the first was a network error, a timeout, or HTTP 502, 503, or 504, and never after HTTP 429 or any other 4xx.

**Validates: Requirements 10.8, 13.3**

### Property 5: Key classification is total and does not disclose

*For any* `MCP_KEY_STATUS` and `MCP_API_KEY`, `classifyKey()` returns exactly one of the six classifications. It returns `present` only for a non-empty value that is not the placeholder, and its message never contains the value.

**Validates: Requirements 11.3, 11.4, 15.3**

## Error Handling

| Condition | Detected by | Behavior | Run outcome |
|-----------|-------------|----------|-------------|
| Skip switch on | `skip-check` | `WARN` with the source and how to turn it off; skipped report and line; no requests | `skipped`, exit 0 |
| Skip parameter unreadable, or `PARAM_STORE_HIERARCHY` unset | Wrapper and `skip-check` | `WARN`; `VERIFY_SKIP` decides | Unchanged |
| A pipeline variable missing, or `env.sh` missing or incomplete | Wrapper | Collected and passed to the Verifier | `error`, exit 1 |
| `write_release_version.py` fails, or the file has no `x.y.z` version | Wrapper | Collected, with the script's error text | `error`, exit 1 |
| `settings.json` unreadable, or its domain not a host name | Wrapper, through `edge-url` | Collected. Script 04 parses the same file first, so this should not happen in the pipeline | `error`, exit 1 |
| Key parameter not found, unreadable, or `BLANK` | Wrapper and Verifier | `INFO` or `WARN` (section 4.2); S2 SKIP; the run continues without a key | Unchanged |
| An invalid URL, version, timeout, origin, or report path | Verifier | `ERROR` naming the input; no requests | `error`, exit 1 |
| P1 gets no response, or a `5xx`, after its retry | Engine | The remaining raw-target sub-checks FAIL "not attempted"; X2 still runs | `failed`, exit 1 |
| A `429` on a core sub-check | Engine | SKIP; inconclusive guidance logged | `inconclusive`, exit 1, unless something failed |
| A `429` on P1 | Engine | Baseline sub-checks SKIP "no baseline" | `inconclusive`, exit 1 |
| A `429` on an advisory sub-check | Engine | SKIP | Unchanged |
| Network error, timeout, 502, 503, or 504 | Client | One retry after 1 second | Decided by the second attempt |
| Redirect | Client and gate | Not followed; FAIL with the target host | Per severity |
| A body that is not JSON, or the wrong JSON-RPC envelope | Gate | FAIL with an excerpt of at most 300 characters | Per severity |
| Report file not writable | Verifier | `WARN`; the report line is still printed | Unchanged |
| An unexpected exception | Verifier | `ERROR` without headers or the key; an `error` report if possible | `error`, exit 1 |
| `node` missing, or the Verifier cannot load | Wrapper | Non-zero exit from `skip-check` | The build fails |

A healthy run takes a few seconds, plus a cold start for the first request. The worst plausible case is a raw target that never answers on `beta` or `prod`: about 61 seconds for P1 (two 30-second attempts and the pause), then up to about 61 seconds for each of the four X2 requests, so about five minutes.

## Security Considerations

- **Secrets.** The key travels from SSM to the Wrapper's variable, and from there to the Verifier's environment, never on a command line. The Wrapper never enables tracing and never prints the key. The Verifier never formats request headers into output and redacts the key from every line, the report, and the report line. A body excerpt is redacted before it is cut. Tests prove this against a server that echoes the key back.
- **Where the key goes.** It goes only to the raw target and the edge target. Both come from the deployed stack and the committed `settings.json`, must be `https:` (Requirement 13.7), and redirects are not followed. Preflights and S1 never carry it.
- **Rate-limit identity.** The Verifier never sends `X-Forwarded-For`, so it cannot pick its own rate-limit bucket, the weakness tracked in [`0-0-7-rate-limit-client-ip-spoofing`](../0-0-7-rate-limit-client-ip-spoofing/ISSUE.md).
- **Least privilege.** No IAM change. The post-deploy role already allows `ssm:GetParameter` on `${PARAM_STORE_HIERARCHY}*`, and both parameters are `SecureString`s encrypted with the AWS-managed `aws/ssm` key, which `generate-put-ssm.py` uses by default.
- **Untrusted input.** SSM values, environment variables, and every response are treated as untrusted. Inputs are checked against allowlists (section 4.3), the skip value is logged at most 32 characters long, and response values are JSON-encoded and cut before they appear in a reason.
- **Commands.** The Wrapper quotes every expansion and uses no `eval`. The Verifier starts no processes. In tests, `bash -n` runs through `execFileSync` with a timeout and no shell.
- **Published output.** The report path cannot fall inside `build/final/`, which script 04 syncs to the public bucket.

## Testing Strategy

The tests use Jest `*.jest.mjs` files in the new package. Property tests are named `*-property-tests.jest.mjs`. No test makes a network or AWS call, runs `npm test`, or runs the Wrapper (Requirement 16.3).

| File | Covers |
|------|--------|
| `cli-tests.jest.mjs` | The command table in section 2: dispatch, exit codes, usage on an unknown command, the default command logging the targets and the expected version, and `run` taking the skipped path when the switch is on |
| `inputs-tests.jest.mjs` | Every row of the skip table and the key table; each input rule in section 4.3, including the `https:` rule and the `build/final/` guard; `release-version` and `edge-url` against temporary files |
| `http-client-tests.jest.mjs` | Headers sent as written, including case; the `User-Agent`; no key on preflights; the key only as `X-API-Key` and only when given; never `X-Forwarded-For`; a timeout signal on every attempt; the retry table; redirect refusal; error classification |
| `fake-mcp-server-tests.jest.mjs` | The fake server answers each method and revision with the response shapes documented in `supported-protocol-revisions.md` and `cors-and-response-headers.md`, so the check tests rest on a model that agrees with the documentation |
| `checks-tests.jest.mjs` | For each sub-check, a healthy server passes it, and at least one fake-server change fails it with the documented reason; the owner and "see" reasons; "not attempted" after a P1 timeout and after a P1 `502`, with X2 still running; a P1 `429` and the "no baseline" skips; S2 falling back to no key on a `401`, on the degraded header, and on a limit that is not higher; X2 skipped without an edge target; extra revisions |
| `outcome-and-report-tests.jest.mjs` | Every outcome with its exit code; the inconclusive guidance text with and without `Retry-After`; the summary; the report fields; the report line is one line whose JSON equals the file; skipped and error reports; a report write failure leaves the outcome alone; the stable list of sub-check IDs |
| `budget-tests.jest.mjs` | With a healthy server, the counted requests are 21 and 24 without a key, and 1 against the IP plus 22 or 25 with a key; one more per extra revision |
| `buildspec-and-wrapper-tests.jest.mjs` | Both buildspecs, parsed with js-yaml (Requirement 16.6). In the Wrapper: `set -euo pipefail`, the log prefix, no tracing, both parameter names, the skip exit code equal to `EXIT_CODES.SKIP_CHECK_SKIPPED`, the key variable used only in its assignments and the `exec` environment, and a clean `bash -n` |
| `input-decisions-property-tests.jest.mjs` | Properties 1 and 5 |
| `retry-property-tests.jest.mjs` | Property 4 |
| `outcome-property-tests.jest.mjs` | Property 3 |
| `secret-redaction-property-tests.jest.mjs` | Property 2 |

Isolation: every test uses its own fake server and a temporary report directory that is removed afterwards. No test changes `process.env` or files in the repository. `sleep` resolves at once and the clock is fixed, so nothing waits.

The Read Function's existing suite must still pass, at the current baseline of 2091 passed, 115 skipped, and 0 failed (Requirement 16.8). This work does not touch the Read Function.

### Live verification (Requirement 16.9)

| Run | How | Expected |
|-----|-----|----------|
| `test` without a key | Deploy to `test`, with the key parameter still `BLANK` | `passed`; S2 SKIP "placeholder BLANK"; X2 SKIP "no custom domain"; the `VERIFY_REPORT` line found with the Logs Insights query |
| `test` with a key | Store a private-tier key for `test`, then retry the PostDeploy stage | S2.1 to S2.3 PASS, which proves the role can decrypt the parameter; `key.used` is `true` |
| `beta` with the edge subset | Deploy to `beta` | X2.1 to X2.4 PASS, which shows CloudFront forwards the three headers on `beta` |
| Skip switch | Set the `test` skip parameter to `true`, retry the stage, then set it back to `false` | `skipped`, the `WARN`, no requests in the Read Function log; the next run verifies again |

## Documentation Plan

| Document | Change |
|----------|--------|
| `docs/developer/post-deploy-verification.md` (new) | What the Verifier checks and what stays manual. Running it locally, with the variables and exit codes. Getting a key for each stage: register on the stage's site (`/register/`, the key is shown once; regenerate on `/profile/`), then have an admin promote the account to the private tier as in [user management](../../../docs/admin-ops/user-management.md). Storing it in the parameter, in the console or with `read -rs` and `aws ssm put-parameter`, so it is neither echoed nor kept in shell history. The 120-day limit until [issue #5](https://github.com/63Klabs/atlantis-mcp/issues/5) is fixed, and both workarounds: an admin removes `ttl` (`update-item ... REMOVE #ttl`, which a later regeneration sets again), or the key is regenerated and the parameter updated before 120 days pass. What a lapsed key does: S2 warns, and the run continues without a key. Changing or adding a check: stable IDs, never reused; core only for behavior this repository controls and that is deterministic; update the fake server, the budget test, the ID list, the admin table, and the manual checklist mapping (Requirements 17.1, 17.2) |
| `docs/admin-ops/post-deploy-verification.md` (new) | Each check and its severity. Reading the sub-check lines, the summary, and the outcomes, with their exit codes. Finding runs with the Logs Insights query below. Turning the skip switch on and off for one stage. What a failed or inconclusive run blocks, promotion where the pipeline promotes, and the pipeline failure notification. Retrying the stage from the console or the CLI after the window resets, including how to find the execution ID. The request budget. What the traffic looks like: each run adds three `list_tools` and one `list_templates` `DISCOVERY_TOOL_CALL` line, and the first can show `firstInSession: true` after a cold start; requests carry `User-Agent: atlantis-mcp-postdeploy-verify`, which shows in the Read Function's DEBUG event logs on non-production stages; the API Gateway access logs record the CodeBuild address, not the user agent. Known limits: no edge check on `test`; no client verification; verification runs only when the PostDeploy stage is enabled (Requirement 17.3) |
| `docs/admin-ops/cloudwatch-insights-queries.json` | New entry "Post-Deploy Verification Runs" on `/aws/codebuild/${Prefix}-${ProjectId}-${StageId}-PostDeploy` (Requirement 17.4) |
| `ARCHITECTURE.md` | A `05-verify-deployment.sh` box after `04-consolidate-and-deploy.sh` in the "Post-Deploy Pipeline" diagram, and a note on the `pre_build` test packages (Requirement 17.5) |
| `DEPLOYMENT.md` | In "Post Deployment Documentation Generation and CloudFront": the stage also verifies each deployment, needs no setup, and can use a private-tier key for a higher limit. Links to both new pages (Requirement 17.6) |
| `docs/developer/README.md`, `docs/admin-ops/README.md` | A link to each new page (Requirement 17.7) |
| `.kiro/specs/0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md` | A section near the top mapping manual items to sub-checks, and an "Automated by post-deploy verification" note on each section it covers (Requirement 17.8) |
| `CHANGELOG.md` | The entry below, appended to `### Added` under `v0.0.7 (unreleased)` (Requirement 17.9) |

No end-user page changes: verification adds no behavior clients can see.

The Logs Insights query:

```text
fields @timestamp, @message
| filter @message like /VERIFY_REPORT /
| parse @message /"outcome":"(?<outcome>[a-z]+)","exitCode":(?<exitCode>\d+),"expectedVersion":"(?<expectedVersion>[^"]+)"/
| parse @message /"failedCore":\[(?<failedCore>[^\]]*)\]/
| sort @timestamp desc
| limit 50
```

Manual checklist mapping:

| Manual items | Automated by | Stays manual |
|--------------|--------------|--------------|
| Smoke test | P1.1 | |
| A1, A2 | X1.1 to X1.3; X2.1 at the edge | A3 |
| B1 | P2.1, P2.6, V1.2 | |
| B2 | P2.2 | |
| B3 | P2.3 to P2.5 | |
| C1, C3 | P1.1 to P1.5, V1.1 | C4 |
| C2 | P2.7 | |
| D1, D3 | P3.1, P3.3 | |
| D2 | P3.2 | |
| E1 to E5 | P4.1 to P4.5 | |
| F1, F2 | P5.1, P5.2 | |
| F3 | P5.3 to P5.5 | |
| F4 | P6.1, P6.2 | |
| G1, G3 | P5.6 | |
| G2 | P5.7 | |
| G4 | P5.8 | |
| H1, H2 | S2.1, S2.2 | H4 |
| H3 | S1.1 | |
| I1 | T1.1, modern request only | I1's legacy request, I2, I3 |
| K1 | V1.1, V1.2 | K2, K3 (V1 makes them unnecessary) |
| | | J (real clients), L (repository state) |

Draft `CHANGELOG.md` entry, in the style of the existing v0.0.7 entries:

```markdown
- **Post-Deploy Smoke Verification** [Spec: 0-0-7-postdeploy-smoke-verification](../.kiro/specs/0-0-7-postdeploy-smoke-verification/) — Every deployment now verifies itself. A new last post-deploy script, `05-verify-deployment.sh`, sends about 25 read-only requests to the stage that was just deployed, and fails the build, which blocks promotion, when the live server is not the release that was built or no longer speaks both MCP protocol eras
  - Core checks fail the build: `server/discover`, the deployed release version, legacy `initialize` negotiation, the `-32022` and `-32020` errors, the `tools/list` and `tools/call` envelopes per revision, and the CORS preflight. Advisory checks only warn: `list_templates`, the `401` for an invalid key, the stored verification key, and, on stages with a custom domain, the same headers through CloudFront
  - A run that gets HTTP `429` on a core check is `inconclusive` and fails the build. The log gives the reset time and the command to retry the stage. Nothing waits or retries inside CodeBuild
  - Results go to the PostDeploy build log, a JSON report, and one `VERIFY_REPORT` line per run, searchable with CloudWatch Logs Insights
  - Two new SSM parameters, created by the build: `Mcp_PostDeployTestVerifyApiKey` (`BLANK` until a private-tier key is stored; verification runs without it) and `Mcp_PostDeployTestVerifySkip` (`false`; set it to `true` to skip verification on one stage). Until [#5](https://github.com/63Klabs/atlantis-mcp/issues/5) is fixed, a private key's account expires about 120 days after the key was set up; the developer guide gives the workarounds
  - Runs locally against any stage with `node application-infrastructure/postdeploy-scripts/verify-deployment.js`
  - New documentation: [post-deploy verification for developers](docs/developer/post-deploy-verification.md) and [for operators](docs/admin-ops/post-deploy-verification.md)
```

## Implementation Sequencing

| Phase | Delivers | Requirements | Done when |
|-------|----------|--------------|-----------|
| 1 | `verify-deployment.js` and the test package, except the buildspec and Wrapper tests | 1.5, 1.6, 4 to 10, 11.3 to 11.7, 12.4 to 12.7, 13 to 15, 16.1, 16.3 to 16.5, 16.8 | The package's tests pass, and a local run against a deployed stage passes |
| 2 | `05-verify-deployment.sh`, both buildspec changes, the stale assertion, and the buildspec and Wrapper tests | 1.1 to 1.4, 1.7 to 1.9, 2, 3, 11.1, 11.2, 12.1 to 12.3, 16.2, 16.6, 16.7 | A `test` deploy passes with S2 skipped |
| 3 | Documentation | 17 | Every new link resolves |
| 4 | The live runs | 16.9 | All four runs behave as listed |

## Design Decisions

Choices made in this design that the requirements leave open. Strike any you disagree with.

| # | Decision | Reason |
|---|----------|--------|
| 1 | The Wrapper calls the Verifier twice: `skip-check`, which returns exit code 20 for "skipped", then `run` | The skip decision must come before any other input is gathered, yet live in the Verifier. Node's own exit codes stop at 14 and the shell uses 126 and 127, so 20 cannot be mistaken for either |
| 2 | Two small helper commands, `release-version` and `edge-url`, instead of `node -e` snippets | Paths and the stage are passed as arguments, never pasted into code, and the logic gets tested |
| 3 | 45 stable sub-checks, with the assertions that need P1's baseline in sub-checks of their own (P2.7, P3.3, S2.3, P5.9) | A `429` on P1 then skips only those, as Requirement 10.6 asks, and every other assertion still reports |
| 4 | One owner per request carries the full failure reason; the other sub-checks of that request say "see `<owner>`" | One failed request does not print its body excerpt six times |
| 5 | A one-second pause before the single retry | Gives a transient `502` or a cold start a moment, at a cost of one second per retried request |
| 6 | The key is redacted from every output as a second safeguard, and an excerpt is redacted before it is cut | Proves Requirement 11.6 even against a server that echoes the key back |
| 7 | Every JSON-RPC response is also checked for `jsonrpc: "2.0"` and the request's `id` | Catches a proxy error page or a mixed-up response at no extra cost |
| 8 | The four `initialize` requests that declare a revision send `capabilities` and `clientInfo`, like a real legacy client; P2e sends no params | Matches what clients send, while keeping one request that checks the default |
| 9 | S1's made-up key is `postdeploy-verify-invalid-key`, without the `atl_` prefix | It can never be a real key, and secret scanners will not flag it in the source |
| 10 | A report file that cannot be written is a `WARN`, not an `error` | The report line in the build log is the record that persists; the file is lost when the container ends |
| 11 | A PASS line can carry a short note, used for P5.9 "none advertised" | P5.9 is core, so it must PASS, not SKIP, when there is nothing to check |
| 12 | The report adds `failedCore`, `skippedCore`, and `warnings` lists, and keeps `outcome` ahead of `checks` | Lets one Logs Insights `parse` show what failed in each run |
| 13 | Test dependencies pinned to jest 30.5.2, @jest/globals 30.5.2, fast-check 4.10.2, and js-yaml 4.3.1 | Latest releases, except js-yaml, whose 5.x is a new major that the repository does not use yet |
| 14 | No `npm audit` step for the test package | Nothing from it is deployed. The existing audit gate already skips development dependencies |
| 15 | Static checks of the Wrapper text, plus `bash -n`, instead of running it | Catches convention and syntax mistakes before a deploy without running the script, which Requirement 16.3 rules out |

## Risks

| Risk | Mitigation |
|------|------------|
| CodeBuild's `nodejs: latest` is older than Node 24 and `fetch` behaves differently | The Verifier uses only features present since Node 18. The install phase already prints the Node version, and phase 4 runs on the real image |
| CodeBuild shares outbound addresses, so the public tier is already used up when P1 runs | The run is `inconclusive` and says when to retry. With a key, every request but P1 stays off the IP budget |
| The fake server drifts from the real one | It follows the documented behavior in `supported-protocol-revisions.md`. The first live runs show any drift, which is fixed in the model or reported as a server bug |
| The private key lapses after about 120 days (issue #5) | S2 warns and the run continues without the key. The developer page explains both workarounds |
| The skip switch is left on | Every skipped run logs a `WARN` and reports `skipped`. Phase 4 includes such a run |
| API Gateway's edge re-cases header names, so P4.4 never sends the function a lower-case name | P4.4 is described as proving the deployed path. The Read Function's unit tests cover its own matching |
| Related specs change the ground | [`0-0-7-rate-limit-client-ip-spoofing`](../0-0-7-rate-limit-client-ip-spoofing/ISSUE.md) changes the public identity but not the Verifier, which sends no `X-Forwarded-For`. [`0-0-7-api-gateway-live-alias`](../0-0-7-api-gateway-live-alias/ISSUE.md) would route traffic through the alias, but CloudFormation still finishes the shift before post-deploy, so one version check still holds. [`0-0-7-revive-postdeploy-tests`](../0-0-7-revive-postdeploy-tests/ISSUE.md) edits the same structure test and plans convention checks for script 05 |

## Related documentation

- [Requirements](requirements.md) and [PLAN.md](PLAN.md)
- [Manual verification checklist](../0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md)
- [Dual-era design](../0-0-7-mcp-protocol-dual-era/design.md) - the protocol behavior the core checks verify
- [Supported protocol revisions](../../../docs/end-user/supported-protocol-revisions.md)
- [CORS and response headers](../../../docs/admin-ops/cors-and-response-headers.md)
- [User management](../../../docs/admin-ops/user-management.md)
- [Issue #5: private and paid user records expire after 120 days even when active](https://github.com/63Klabs/atlantis-mcp/issues/5)
- [Post-deploy buildspec](../../../application-infrastructure/buildspec-postdeploy.yml) and [main buildspec](../../../application-infrastructure/buildspec.yml)
- [SSM parameter script](../../../application-infrastructure/build-scripts/generate-put-ssm.py), [release version script](../../../application-infrastructure/build-scripts/write_release_version.py), and [settings loader](../../../application-infrastructure/postdeploy-scripts/settings-loader.js)
