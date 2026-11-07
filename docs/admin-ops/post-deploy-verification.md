# Post-deploy verification

After every deployment, the PostDeploy stage verifies the stage that was just deployed. The last script of the stage, `05-verify-deployment.sh`, sends about 25 read-only requests to the live endpoint and checks the answers. It proves that the running server is the release that was built, that it still speaks both MCP protocol eras, and that CORS and header handling work through API Gateway.

This page is for the people who operate the pipeline. It covers what is checked, how to read a run, how to find past runs, how to switch verification off for one stage, what a red stage blocks, and how to retry it. For how the Verifier is built, how to run it from a workstation, and how to add or change a check, see the [developer guide](../developer/post-deploy-verification.md).

Verification needs no setup beyond enabling the PostDeploy stage. The main build creates the two SSM parameters it uses, and later builds never overwrite a value you have stored:

| Parameter | Created with | Purpose |
|-----------|--------------|---------|
| `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifyApiKey` | `BLANK` (SecureString) | An optional private-tier API key. While it is `BLANK`, or missing, the run uses the public tier and the key checks are skipped |
| `${PARAM_STORE_HIERARCHY}Mcp_PostDeployTestVerifySkip` | `false` | The skip switch. `true` turns verification off for the stage |

## Checks and severity

Every check is made of sub-checks with stable IDs such as `P2.3`. An ID is never reused for a different assertion, so runs can be compared over time.

A **core** check fails the build when it fails or gets no answer. An **advisory** check only prints `WARN` and never changes the outcome.

| Check | Severity | Sub-checks | What it proves |
|-------|----------|------------|----------------|
| P1 discovery | Core | P1.1 to P1.5 | `server/discover` answers without a key, uses the modern response envelope, names `atlantis-mcp-server`, has non-empty `instructions`, has the `ttlMs` (a non-negative integer) and `cacheScope` (`public` or `private`) that the schema requires on a discover result, and lists at least the revisions `2024-11-05`, `2025-11-25`, and `2026-07-28` |
| V1 version | Core | V1.1, V1.2 | The live server reports the release version that was just built, both from `server/discover` and from the legacy `initialize` result. A mismatch means stale code is still running |
| P2 legacy `initialize` | Core | P2.1 to P2.7 | The legacy handshake negotiates the right revision for `2025-11-25`, `2024-11-05`, an in-between revision, an unknown revision, and no parameters; the result has exactly the expected four keys; the `instructions` match `server/discover` |
| P3 unsupported revision | Core | P3.1 to P3.3 | An unlisted revision, sent in the `MCP-Protocol-Version` header or in `params._meta`, gets HTTP 400 and error `-32022`. `error.data.requested` is the revision that was sent (P3.1, P3.2), and `error.data.supported` is the same list, in the same order, as the `supportedVersions` of `server/discover` (P3.3) |
| P4 header mismatch | Core | P4.1 to P4.5 | `Mcp-Method` and `Mcp-Name` headers that disagree with the body get HTTP 400 and error `-32020` (P4.1, P4.2, P4.4). Matching headers are accepted with HTTP 200 (P4.3), header names are matched without regard to case (P4.4), and a legacy request ignores the headers and gets HTTP 200 (P4.5) |
| P5 `tools/list` | Core | P5.1 to P5.9 | Each revision gets the fields it should have and none it should not (`ttlMs`, `cacheScope`, `resultType`, `_meta`, tool `title` and `annotations`), a modern `cacheScope` is `public` or `private`, every revision lists the same tools in the same order, and any extra advertised revision is accepted |
| P6 `tools/call` | Core | P6.1, P6.2 | The `list_tools` call returns the modern envelope for `2026-07-28` and the legacy shape for `2025-11-25` |
| M1 method | Core | M1.1 | A `GET` that asks for `text/event-stream`, sent with no key, gets HTTP 405, `Allow: POST`, a JSON content type, and a JSON body with a `message`. This is the request Kiro sends after it connects. An answer of HTTP 200 with HTML means the site's landing page is answering for the API |
| X1 CORS preflight | Core | X1.1 to X1.3 | The `OPTIONS` preflight on the API Gateway endpoint answers 200 and allows the origin, `POST`, and the `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` headers |
| T1 backend | Advisory | T1.1 | `list_templates` returns template data, so the S3 backend works |
| S1 invalid key | Advisory | S1.1 | A made-up API key is rejected with HTTP 401 |
| S2 stored key | Advisory | S2.1 to S2.3 | The stored key works in `X-API-Key` and as a Bearer token, and gets a higher rate limit than the public tier. Skipped when no key is stored |
| X2 edge | Advisory | X2.1 to X2.5 | The same preflight, version, `-32020`, and `GET` behavior through the stage's custom domain (CloudFront). The two `-32020` sub-checks (X2.3, X2.4) expect HTTP 400 with `-32020`. X2.5 expects the same `405` as M1.1, which shows the edge does not turn it into the landing page. Skipped when the stage has no custom domain |

In total there are 37 core and 10 advisory sub-checks.

Requests go to the raw API Gateway endpoint (`https://<restApiId>.execute-api.<region>.amazonaws.com/<apiStage>/mcp/v1`). The X2 sub-checks go to the stage's custom domain, `https://<domain>/mcp/v1`, and only exist on stages whose `settings.json` entry has a `domain` (`beta` and `prod` today). Requests are sent one at a time, in the order P1, S1, S2, P2, P3, P4, P5, P6, M1, T1, X1, X2.

Advisory checks are advisory because their answers depend on something other than this repository's code. A T1 warning points to a backend, an X2 warning to the edge, and an S1 or S2 warning to the key or the authentication path.

## Reading a run

Open the PostDeploy build log for the stage, in the CodeBuild project or in the CodePipeline console. Verification output starts after `Running 05-verify-deployment.sh...`, near the end of the log.

### Log lines

Lines from the script are prefixed `[05-verify-deployment]` and carry a level. `INFO` and `WARN` go to standard output, and `ERROR` to standard error.

```text
[05-verify-deployment] INFO: Skip switch decided by SSM parameter <PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifySkip: false
[05-verify-deployment] INFO: Raw target: https://abc123.execute-api.us-east-1.amazonaws.com/<apiStage>/mcp/v1
[05-verify-deployment] INFO: Edge target: https://mcp-beta.atlantis.63klabs.net/mcp/v1
[05-verify-deployment] INFO: Expected release version: 0.0.7
[05-verify-deployment] INFO: Verification key: no key configured: placeholder BLANK. Running at the public tier
PASS  P1.1   server/discover answers without a key
SKIP  S2.1   the stored key is accepted in X-API-Key (no key configured: placeholder BLANK)
WARN  X2.4   edge returns -32020 for a mismatched Mcp-Name (HTTP 200, expected 400; the edge may not be forwarding the MCP-Protocol-Version or Mcp-* headers; body: ...)
[05-verify-deployment] INFO: Core: 37 passed, 0 failed, 0 skipped. Advisory: 6 passed, 1 warned, 3 skipped
[05-verify-deployment] INFO: Outcome: passed
[05-verify-deployment] INFO: Report: build/verify/report.json
VERIFY_REPORT {"tool":"atlantis-mcp-postdeploy-verify","schemaVersion":1,"outcome":"passed","exitCode":0,...}
```

Most sub-check lines are left out above. The ones shown illustrate each label.

### Sub-check lines

There is one line per sub-check: a label, the ID, and the title. FAIL, WARN, and SKIP lines end with the reason in parentheses. A PASS line can carry a short note, for example P5.9 passes with "none advertised" when the server lists no revision beyond the three it must have.

| Label | Meaning |
|-------|---------|
| `PASS` | The assertion held |
| `FAIL` | A core sub-check failed. The reason names the field, the expected value, and the actual value, or says what went wrong with the request |
| `WARN` | An advisory sub-check failed. The build is not affected |
| `SKIP` | The sub-check got no answer or had nothing to check. The reason says why, for example "no custom domain for this stage" or "no key configured: placeholder BLANK" |

Some reasons you may meet:

| Reason | What it means |
|--------|---------------|
| `no response (...) after 2 attempts` | The request timed out or the connection failed twice. The text in parentheses is `timeout` or the error code |
| `HTTP <status>, expected <expected>; body: ...` | The endpoint answered with another status. Only a short excerpt of the body is shown |
| `HTTP 200, expected 400; <hint>; body: ...` | A P3 or P4 request, or an X2.3 or X2.4 request, that must fail with `-32022` or `-32020` got HTTP 200. For P4 and X2 the hint is added when the body is a normal result, and is described in the last two rows of this table. A `-32022` or `-32020` error that arrives with HTTP 200 has no hint and means the server is not returning the status the MCP specification requires |
| `redirect (HTTP <status>) to <host> was not followed` | Redirects are never followed, so the key cannot be sent to another host |
| `not attempted: raw target did not answer P1` | P1 got no answer or an HTTP 5xx after its retry, so no more requests went to the raw endpoint. The X2 sub-checks still run |
| `no answer: rate limited (HTTP 429)` | The request got HTTP 429. The sub-check is SKIP, and on a core check that makes the run inconclusive |
| `no baseline: P1 had no answer` | A comparison against P1 could not be made because P1 was rate limited |
| `the MCP-Protocol-Version or Mcp-* headers may not be reaching the function` | A P4 request (P4.1, P4.2, or P4.4) got HTTP 200 and a normal result instead of HTTP 400 and `-32020`. The mismatched headers were probably not delivered to the Read Function. Because the raw API Gateway endpoint is the target, check the API Gateway integration and the request that was sent |
| `the edge may not be forwarding the MCP-Protocol-Version or Mcp-* headers` | An X2 request (X2.3 or X2.4) got HTTP 200 and a normal result instead of HTTP 400 and `-32020`. Check the CloudFront behavior for `/mcp/*`. If P4 passed on the raw endpoint, the edge is the likely cause |
| `HTTP 200, expected 405; the target is answering with the site's landing page (an API 403 or 404 rewritten to /index.html)` | The `GET` of M1.1 (`the target`) or X2.5 (`the edge`) got HTTP 200 with an HTML content type. An API response with status 403 or 404 reached CloudFront, which rewrote it. See [CloudFront turns 403 and 404 into the landing page](./cors-and-response-headers.md#cloudfront-turns-403-and-404-into-the-landing-page). If the status is `403` with `Missing Authentication Token` and the body is JSON, the stage is still running a build that predates the `405` change |

### Summary and outcome

After the last sub-check, the script prints the counts (`Core: ... Advisory: ...`), the outcome, and the path of the JSON report. It then prints one `VERIFY_REPORT` line, which is the machine-readable record of the run.

The outcome is the first rule below that applies. The exit code of the script is the exit code of the build step, and a non-zero exit fails the PostDeploy stage.

| Outcome | When | Exit code | What the log adds |
|---------|------|-----------|-------------------|
| `skipped` | The skip switch is on | 0 | A `WARN` that verification was skipped (see [Skipping verification](#skipping-verification)) |
| `error` | An input problem or an unexpected internal error: a missing pipeline variable, a missing `env.sh`, a failed `write_release_version.py`, an invalid URL | 1 | One `ERROR` line per problem. No request is sent for an input problem |
| `failed` | Any core sub-check failed | 1 | `ERROR: Core sub-checks failed: <IDs>` |
| `inconclusive` | No core sub-check failed, but at least one was skipped. This happens only after HTTP 429 or when the baseline from P1 is missing | 1 | Five `WARN` lines with the reset time and the retry commands (see [Retrying the stage](#retrying-the-stage)) |
| `passed` | Everything else, with any warnings and skips listed | 0 | Nothing |

A green stage therefore always means the core was verified. A stage with outcome `passed` can still contain `WARN` and `SKIP` lines, so read them after changes to the edge or the key.

If the verifier's own tests fail, the build stops earlier, in `pre_build`, before any post-deploy script runs. That failure is a code problem and is unrelated to the deployed stage.

## Finding runs with Logs Insights

Every run that reaches the Verifier prints exactly one `VERIFY_REPORT` line, so past runs can be searched across deployments. The log group is the PostDeploy CodeBuild project's:

```text
/aws/codebuild/${Prefix}-${ProjectId}-${StageId}-PostDeploy
```

The query is saved in [cloudwatch-insights-queries.json](./cloudwatch-insights-queries.json) under the name "Post-Deploy Verification Runs". It lists the latest 50 runs with their outcome, exit code, expected version, and the IDs of failed core sub-checks:

```text
fields @timestamp, @message
| filter @message like /VERIFY_REPORT /
| parse @message /"outcome":"(?<outcome>[a-z]+)","exitCode":(?<exitCode>\d+),"expectedVersion":"(?<expectedVersion>[^"]+)"/
| parse @message /"failedCore":\[(?<failedCore>[^\]]*)\]/
| sort @timestamp desc
| limit 50
```

Notes on the results:

- Runs with outcome `skipped` or `error` can have an `expectedVersion` of `null`. They still match the `filter`, but the first `parse` finds nothing, so the `outcome` column is empty for them. Read the `@message` column for those lines.
- The report line also carries `skippedCore`, `warnings`, the targets, the versions the server reported, the request counts, and one entry per sub-check. It never contains the API key or any request header.
- The same report is written to `build/verify/report.json` inside the build container. It is not saved as a build artifact, so the log line is the record that persists.

## Skipping verification

Use the skip switch for a known issue that would otherwise block a stage, for example while a backend is being repaired. It applies to one stage at a time, because each stage has its own `${PARAM_STORE_HIERARCHY}`. No commit is needed.

### Turn it on

```bash
aws ssm put-parameter --name "<PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifySkip" \
  --type SecureString --value true --overwrite
```

The next PostDeploy run, or a retry of the stage, prints these lines and exits 0 without sending a request:

```text
[05-verify-deployment] INFO: Skip switch decided by SSM parameter <PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifySkip: true
[05-verify-deployment] WARN: Deployment verification was skipped by SSM parameter <PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifySkip; to turn it back on, run: aws ssm put-parameter --name "<PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifySkip" --type SecureString --value false --overwrite
```

A skipped run still prints a `VERIFY_REPORT` line with outcome `skipped`. Only the verification step is skipped. The other post-deploy scripts, and the verifier's own tests in `pre_build`, run as usual.

### Turn it off

Set the parameter back to `false`, as in the command the `WARN` line prints:

```bash
aws ssm put-parameter --name "<PARAM_STORE_HIERARCHY>Mcp_PostDeployTestVerifySkip" \
  --type SecureString --value false --overwrite
```

The next run verifies again. The build log shows the full parameter name on the `Skip switch decided by` line, if you need to look it up.

### How the switch is decided

The SSM parameter decides whenever it can be read. The `VERIFY_SKIP` variable in `buildspec-postdeploy.yml` is a backup, and it is `"false"` in the repository.

| Situation | Deciding value | Log |
|-----------|----------------|-----|
| Parameter read | The parameter's value | `INFO` |
| Parameter does not exist | `VERIFY_SKIP` | `INFO`: the parameter does not exist, so `VERIFY_SKIP` decides |
| Parameter could not be read (for example access denied), or `PARAM_STORE_HIERARCHY` is not set | `VERIFY_SKIP` | `WARN` with the AWS error code |

A value is on only when it is `true` after trimming whitespace and ignoring case. `false` and an empty value are off. Any other value, such as `yes`, is treated as off, with a `WARN` that shows the first 32 characters of the value. Verification therefore fails open to "verify".

Every run logs which source decided and the value it resolved, so a forgotten `true` shows up in every build log until it is turned off.

## What a failed or inconclusive run blocks

A run with outcome `failed`, `inconclusive`, or `error` exits 1, which fails the PostDeploy stage and stops the pipeline at that point.

- **Promotion.** When the pipeline promotes (`PromoteTargetStageId` is set), the stages after PostDeploy do not start, so the build is not promoted to the next stage until the PostDeploy stage succeeds. The same applies to the approval step before promotion, where the pipeline has one.
- **The deployment itself.** Verification runs after the stack has deployed, so a red stage does not roll back anything. The new release is live while the stage is red.
- **Documentation.** The documentation site is published by script 04, before verification runs. A red stage still has current documentation.
- **Notification.** The stage fails like any other failed stage, so whatever failure notification the pipeline stack is configured with applies. This repository does not add one, and the pipeline stack is maintained outside it.

## Retrying the stage

Nothing in the build waits or retries after HTTP 429, and nothing retries the stage automatically. For an `inconclusive` run, wait until the rate-limit window resets, then retry the stage. The log tells you when:

```text
[05-verify-deployment] WARN: Rate limited (HTTP 429). The limit resets at 2026-10-22T06:00:00Z (in 1830 s)
[05-verify-deployment] WARN: Nothing retries automatically. After that time, retry the PostDeploy stage in the CodePipeline console, or run:
[05-verify-deployment] WARN:   aws codepipeline retry-stage-execution --pipeline-name "acme-atlantis-mcp-beta-Pipeline" --stage-name PostDeploy --retry-mode FAILED_ACTIONS --pipeline-execution-id "<execution-id>"
[05-verify-deployment] WARN: Find <execution-id> with:
[05-verify-deployment] WARN:   aws codepipeline get-pipeline-state --name "acme-atlantis-mcp-beta-Pipeline" --query "stageStates[?stageName=='PostDeploy'].latestExecution.pipelineExecutionId" --output text
```

The reset time is taken from the `Retry-After` header of the last 429 response added to the current time. When that header is missing, it comes from `X-RateLimit-Reset`. When both are missing, the first line says the reset time is unknown. The pipeline name is `${PREFIX}-${PROJECT_ID}-${STAGE_ID}-Pipeline`.

### From the console

1. Open the pipeline in the CodePipeline console.
2. Find the failed PostDeploy stage and choose **Retry stage**.
3. Choose **Retry failed actions**.

### From the CLI

1. Look up the execution ID of the stage:

   ```bash
   aws codepipeline get-pipeline-state --name "<PREFIX>-<PROJECT_ID>-<STAGE_ID>-Pipeline" \
     --query "stageStates[?stageName=='PostDeploy'].latestExecution.pipelineExecutionId" --output text
   ```

   The execution ID is also listed in the console, in the pipeline's execution history.

2. Retry the failed actions of that execution:

   ```bash
   aws codepipeline retry-stage-execution --pipeline-name "<PREFIX>-<PROJECT_ID>-<STAGE_ID>-Pipeline" \
     --stage-name PostDeploy --retry-mode FAILED_ACTIONS --pipeline-execution-id "<execution-id>"
   ```

A stage can be retried only while it is in the failed state. A retry runs the whole post-deploy build again, including verification, so it spends the request budget again. Retry after the reset time, not before, or the run will be rate limited again.

For a `failed` run, fix the cause first. Redeploying through the pipeline (a new commit) also runs verification again.

## Request budget

Verification is designed to stay small. These counts are for POST requests that reach the Read Function's rate limiter, not counting retries. The invalid-key request (S1) is rejected before the rate limiter, and API Gateway answers the preflights.

| Run | Counted against the client IP | Counted against the key's tier |
|-----|-------------------------------|--------------------------------|
| No key, no edge target (`test`) | 21 | 0 |
| No key, edge target (`beta`, `prod`) | 24 | 0 |
| Key accepted, no edge target | 1 (P1) | 22 |
| Key accepted, edge target | 1 (P1) | 25 |

- A keyless run uses less than half of the public tier's 50 requests per hour, so two keyless runs fit in one window. A third run in the same window is rate limited, which makes it `inconclusive`. This is the usual reason to store a key.
- The client IP is the address of the CodeBuild host making the requests, so other traffic from that address can use the same budget.
- A request that fails with a network error, a timeout, or HTTP 502, 503, or 504 is retried once after one second. Any other response, including 429 and other 4xx statuses, is not retried.
- Each extra revision that the server advertises beyond the three it must have adds one `tools/list` request, against whichever budget the run is using.
- The `GET` probes of M1.1 and X2.5 are answered by an API Gateway mock, not by the Read Function. They are counted in neither `requests.posts` nor `requests.preflights` of the report, and they count against neither budget.
- Every request has a timeout of 30 seconds by default.

## How verification traffic appears in the logs

- **Read Function.** Each run adds three `list_tools` and one `list_templates` `DISCOVERY_TOOL_CALL` line (`DISCOVERY_TOOL_CALL {"toolName":"list_tools","firstInSession":false}`). The first call after a cold start can show `firstInSession: true`, so verification can inflate that figure if you use the log to study how clients start sessions.
- **User agent.** Every request carries `User-Agent: atlantis-mcp-postdeploy-verify`. The Read Function logs the full incoming event at DEBUG level, which non-production stages enable, so the user agent shows there.
- **API Gateway access logs.** These record the address of the CodeBuild host and not the user agent, so an access-log line cannot be tied to verification by its user agent. Use the address and the time of the build instead.
- **Read-only.** The server receives only `server/discover`, `initialize`, `tools/list`, `tools/call` for `list_tools` and `list_templates`, and CORS preflights. The `GET` probes never reach the Read Function. Nothing creates, changes, or deletes data, and nothing calls Amazon Bedrock.
- **Secrets.** The key travels only in the process environment and in the `X-API-Key` and `Authorization` request headers. It is never written to the build log, the report, or the report line, and request headers are never logged.

## Known limits

- **No edge check on `test`.** The X2 sub-checks run only where the stage has a custom domain. On `test`, a problem in CloudFront cannot be seen by this stage because there is no edge.
- **No client verification.** Verification checks the protocol from a script. It does not prove that a real MCP client connects, and it cannot see CloudWatch alarms or repository state. Those checks stay manual.
- **Runs only when the PostDeploy stage is enabled.** Stages deployed with `PostDeployStageEnabled` set to false are not verified.
- **Advisory checks do not block.** A broken backend (T1), a lapsed key (S2), or an edge that drops the MCP headers (X2) produces only a `WARN`. Read the warnings after a deploy that touched those areas.
- **The key is renewed by each verification run.** A stage with no deployment for 120 days loses the key's account; register it again and store the new key. S2 then warns, and the run continues without the key at the public tier. The [developer guide](../developer/post-deploy-verification.md#key-lifetime) explains how to get and store a key.
- **Rate limits can make a run inconclusive.** An `inconclusive` run fails the build until it is retried, as described in [Retrying the stage](#retrying-the-stage).
- **A key that cannot be read is a warning.** If the key parameter cannot be read (for example, access denied), the run logs a `WARN` and goes on without a key.

## Related documentation

- [Developer guide: post-deploy verification](../developer/post-deploy-verification.md)
- [Example CloudWatch Insights queries](./cloudwatch-insights-queries.json)
- [User management](./user-management.md), for promoting an account to the private tier
- [Deployment guide](../../DEPLOYMENT.md)
- [Architecture: post-deploy pipeline](../../ARCHITECTURE.md)
