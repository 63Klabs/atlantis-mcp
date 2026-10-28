# Verification record: 0-0-7-api-gateway-live-alias

Runtime verification record for Requirement 9 (rollout) and Requirement 10 (rollback drill). Design reference: `design.md`, section V-C and V-D.

## Resource names

All stacks are in `us-east-2`. Prefix is `prod63k`, ProjectId is `atlantis-mcp`.

| Item | test | beta | prod |
|------|------|------|------|
| Application stack | `prod63k-atlantis-mcp-test-application` | `prod63k-atlantis-mcp-beta-application` | `prod63k-atlantis-mcp-prod-application` |
| Deploy environment | TEST | PROD | PROD |
| REST API id (`WebApi`) | `nj1sciuyka` | `i17st3itv0` | `gy3gpv7n1k` |
| `/mcp/v1` resource id | `puxoow` | `87rrrp` | `zigqku` |
| API Gateway stage name | `atlantis-mcp-test` | `atlantis-mcp-beta` | `atlantis-mcp-prod` |
| Read function (`<fn>`) | `prod63k-atlantis-mcp-test-ReadFunction` | `prod63k-atlantis-mcp-beta-ReadFunction` | `prod63k-atlantis-mcp-prod-ReadFunction` |
| Auth function | `prod63k-atlantis-mcp-test-AuthFunction` | `prod63k-atlantis-mcp-beta-AuthFunction` | `prod63k-atlantis-mcp-prod-AuthFunction` |
| `FunctionGradualDeploymentType` | `Linear10PercentEvery3Minutes` | `Linear10PercentEvery3Minutes` | `Linear10PercentEvery3Minutes` |
| `ReadLambdaErrorsAlarm` | none (TEST stage creates none) | `prod63k-atlantis-mcp-beta-application-ReadLambdaErrorsAlarm-hGuyVX2dXBhb` (state `OK`, actions enabled) | `prod63k-atlantis-mcp-prod-application-ReadLambdaErrorsAlarm-Ga8j3ygNcwK3` (state `OK`, actions enabled) |
| CodeDeploy application | `prod63k-atlantis-mcp-test-application-ServerlessDeploymentApplication-Bg8vcYe3hdp4` | `prod63k-atlantis-mcp-beta-application-ServerlessDeploymentApplication-dg4d9SK4vDBb` | `prod63k-atlantis-mcp-prod-application-ServerlessDeploymentApplication-oDfc9BrNh713` |
| CodeDeploy deployment group (Read function) | `prod63k-atlantis-mcp-test-application-ReadLambdaFunctionDeploymentGroup-sqJAsDy8pksw` | `prod63k-atlantis-mcp-beta-application-ReadLambdaFunctionDeploymentGroup-2wBcesP1itAL` | `prod63k-atlantis-mcp-prod-application-ReadLambdaFunctionDeploymentGroup-JE5ngjfZoXee` |

## Baseline (before the migration deploy)

Captured 2026-10-28 (UTC). Metric window: the 24 hours ending at capture time, one 86400 second period, statistic `Sum`, metric `AWS/Lambda` `Invocations`. An empty series is recorded as `0 (no datapoints)`.

| Stage | Date | Integration URI | Invocations: FunctionName | Resource=`<fn>` | Resource=`<fn>:live` |
|-------|------|-----------------|---------------------------|-----------------|----------------------|
| test | 2026-10-28 | `arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:458901159113:function:prod63k-atlantis-mcp-test-ReadFunction/invocations` | 22 | 22 | 0 (no datapoints) |
| beta | 2026-10-28 | `arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:458901159113:function:prod63k-atlantis-mcp-beta-ReadFunction/invocations` | 0 (no datapoints) | 0 (no datapoints) | 0 (no datapoints) |
| prod | 2026-10-28 | `arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:458901159113:function:prod63k-atlantis-mcp-prod-ReadFunction/invocations` | 224 | 224 | 0 (no datapoints) |

Reading: on every stage the integration URI ends `:function:<fn>/invocations` (unqualified, so `$LATEST`), and the `:live` series is empty. On `test` and `prod` all invocations are in the unqualified series (`Resource=<fn>` equals the function total), which confirms API callers bypass the alias today. `beta` had no traffic in the window, so its metrics prove nothing either way; the URI is the evidence there.

### Context for the migration deploy and the drill

| Item | test | beta | prod |
|------|------|------|------|
| Stack status at capture | `UPDATE_COMPLETE` | `UPDATE_COMPLETE` | `UPDATE_COMPLETE` |
| Stack last updated (UTC) | 2026-10-27 15:31 | 2026-10-08 17:14 | 2026-10-08 17:15 |
| `live` alias version at capture | 194 | 46 | 44 |
| Most recent Read deployment group deployments | `d-SH89NLK7L`, `d-3H5LGKXVK`, `d-QGD6ED4VK` | `d-TBBXN34VK`, `d-Y0VMH9G7K`, `d-983NJKC6K` | not queried |

Beta deployment group: config `CodeDeployDefault.LambdaLinear10PercentEvery3Minutes`, alarm list contains the beta `ReadLambdaErrorsAlarm`, auto rollback enabled for `DEPLOYMENT_FAILURE`, `DEPLOYMENT_STOP_ON_ALARM`, and `DEPLOYMENT_STOP_ON_REQUEST`.

Raw `execute-api` URLs (for drill polling and check 2 traffic; the API Gateway stage name is part of the path):

- beta: `https://i17st3itv0.execute-api.us-east-2.amazonaws.com/atlantis-mcp-beta/mcp/v1`
- test: `https://nj1sciuyka.execute-api.us-east-2.amazonaws.com/atlantis-mcp-test/mcp/v1`
- prod: `https://gy3gpv7n1k.execute-api.us-east-2.amazonaws.com/atlantis-mcp-prod/mcp/v1`

The raw URLs are built from the REST API id, region, and stage name above and have not been called. Confirm with one `server/discover` request before the drill.

## Migration deploy results

| Stage | Date | Checks 1-7 | Notes |
|-------|------|------------|-------|
| test | 2026-10-28 | 1-7 PASS | Pipeline execution `502a1c96-0f3d-486d-911d-b4bba69ae793` (Source, Build, Deploy, PostDeploy all Succeeded). Details in "Test stage results" below. |
| beta | 2026-10-28 | 1-7 PASS | Merge commit `6bee209` (test into beta). Pipeline `prod63k-atlantis-mcp-beta-Pipeline` (Source, Build, Deploy, PostDeploy all Succeeded). CodeDeploy `d-TLW2MU68L`, Linear10PercentEvery3Minutes, 27 minutes. This merge also brought the other 0.0.7 work (dual-era protocol, tool discovery, post-deploy verification) to beta. Details in "Beta stage results" below. |
| prod | | | |

### Test stage results (2026-10-28, UTC)

Stack update ran 13:44:14 to 13:45:25. Checks were run at about 13:48 to 13:55.

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Integration URI | PASS | `get-integration` on `nj1sciuyka` / `puxoow` / POST returns `arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:458901159113:function:prod63k-atlantis-mcp-test-ReadFunction:live/invocations`. Baseline ended `:function:<fn>/invocations`. |
| 2 | Alias carries traffic | PASS | Before sending anything, the `Resource=<fn>:live` series already held 22 invocations at 13:46 (the PostDeploy verification run, 13:46:16 to 13:46:19). I then sent 6 `server/discover` POSTs to the raw URL (all HTTP 200, no 429). The `:live` series gained 6 at 13:48 (22 at 13:46, 6 at 13:48; 28 total). The `Resource=<fn>` (unqualified) series returned no datapoints for the 40 minutes before the check, so it did not grow. The `FunctionName`-only total matched the `:live` series exactly (22 and 6). Baseline was 22 unqualified, 0 `:live`. |
| 3 | Log stream naming | PASS | Newest stream is `2026/10/28/[195]3c6003fba1254b6c85465edce8c060df`. All earlier streams (2026/10/27 and before) are `2026/10/DD/[$LATEST]<id>`. Pattern: `YYYY/MM/DD/[<version>]<32 hex characters>`, with no separator after the bracket. The bracketed version equals the `live` alias version (195). |
| 4 | CodeDeploy for the alias | PASS | A CodeDeploy deployment ran for this deploy: `d-TOPV9Z58L`, status `Succeeded`, creator `user` (CloudFormation), created 13:44:52, completed 13:44:53, overview 1 succeeded / 0 failed. Config `CodeDeployDefault.LambdaAllAtOnce` (the expected TEST behavior, even though the stack parameter `FunctionGradualDeploymentType` is `Linear10PercentEvery3Minutes`). The group is the one noted in the baseline (`...ReadLambdaFunctionDeploymentGroup-sqJAsDy8pksw`), with auto rollback enabled for `DEPLOYMENT_FAILURE`, `DEPLOYMENT_STOP_ON_ALARM`, `DEPLOYMENT_STOP_ON_REQUEST` and alarm configuration disabled (no alarm on TEST). Previous deployments: `d-SH89NLK7L`, `d-3H5LGKXVK`, `d-QGD6ED4VK`, `d-44VG5XDUK`. |
| 5 | Update ordering and permissions | PASS | `ReadLambdaFunctionAliaslive` `UPDATE_COMPLETE` 13:45:14.150, then `WebApi` (`AWS::ApiGateway::RestApi`) `UPDATE_IN_PROGRESS` 13:45:15.121, `UPDATE_COMPLETE` 13:45:18.083, then new `WebApiDeployment0bd3202d63` created 13:45:20, `WebApiStage` updated 13:45:22.560, old deployment `WebApiDeployment520fdb5d90` deleted in cleanup. The alias had `UPDATE_IN_PROGRESS` from 13:44:51. No stack events at all for `ReadLambdaPermissionLive`, and the stack has no such resource (it is PROD-conditioned). No permission resource had any event in this update: `ReadLambdaFunctionMcpV1PostPermissionStage` (last updated 2026-03-22) was not touched, and its policy statement on the Lambda already targets `function:<fn>:live` with source `arn:aws:execute-api:us-east-2:458901159113:nj1sciuyka/*/POST/mcp/v1`. `ReadLambdaPermission` (unqualified function) still exists and is unchanged. |
| 6 | Stack status | PASS | `UPDATE_COMPLETE`, last updated 2026-10-28T13:44:14Z. |
| 7 | PostDeploy V1 | PASS | PostDeploy build `prod63k-atlantis-mcp-test-PostDeploy:e9509201-07f4-4e7b-90a5-7eafe4507fb1` `SUCCEEDED` (13:45:48 to 13:46:19). `05-verify-deployment.sh`: expected version 0.0.7, public tier (no key configured), no custom domain. `Core: 36 passed, 0 failed, 0 skipped. Advisory: 2 passed, 0 warned, 7 skipped.` `Outcome: passed`. V1.1 and V1.2 PASS. The 7 skipped advisory checks are S2.1 to S2.3 (no stored key, placeholder `BLANK`) and X2.1 to X2.4 (no custom domain on this stage). |

`live` alias version: 194 before the deploy (baseline), 195 after (`ReadLambdaFunctionVersion20261028T1`, created 13:44:50).

Unexpected: nothing failed. Two observations: the PostDeploy run reached the function through the alias before any manual request (the 22 invocations at 13:46), and the alias update, API update, and CodeDeploy deployment were about 20 seconds apart on TEST because AllAtOnce completes immediately.

### Beta stage results (2026-10-28, UTC)

Stack update ran 14:15:41 to 14:43:56 (28 minutes 15 seconds), because the alias update stayed `UPDATE_IN_PROGRESS` for the whole gradual shift. Checks were run at about 14:51 to 15:07. The merge also delivered the other 0.0.7 work to beta, so the stack update included new layers and function code beyond this spec.

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Integration URI | PASS | `get-integration` on `i17st3itv0` / `87rrrp` / POST returns `arn:aws:apigateway:us-east-2:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-2:458901159113:function:prod63k-atlantis-mcp-beta-ReadFunction:live/invocations`. Baseline ended `:function:<fn>/invocations`. |
| 2 | Alias carries traffic | PASS | Whole window: the `Resource=<fn>:live` series holds 25 invocations at 14:46 UTC (the PostDeploy verification run, 14:46:01 to 14:46:04) and the `FunctionName`-only series holds the same 25, so nothing else reached the function between 14:00 and 14:46. At 15:01:47 I sent 6 `server/discover` POSTs to the raw URL (all HTTP 200, no 429); the `:live` series gained 6 at 15:01 UTC (25 at 14:46, 6 at 15:01; 31 total). The unqualified `Resource=<fn>` series returned no datapoints from 14:00 UTC to 15:06, so it did not grow after the deploy. Baseline for beta was no datapoints on all series. No API traffic of any kind arrived during the 27 minute shift. |
| 3 | Log stream naming | PASS | Newest streams are `2026/10/28/[47]02639d9680684eaaa10bef683581e9ba` and `2026/10/28/[47]f95085fd9c2848149089a8f58131d15f`. All earlier streams (2026/10/21 and before) are `[$LATEST]<id>`. Pattern matches test: `YYYY/MM/DD/[<version>]<32 hex>`. The bracketed version (47) equals the `live` alias version. |
| 4 | CodeDeploy for the alias | PASS | `d-TLW2MU68L`: status `Succeeded`, config `CodeDeployDefault.LambdaLinear10PercentEvery3Minutes`, creator `user` (CloudFormation), deployment style `BLUE_GREEN` / `WITH_TRAFFIC_CONTROL`, created 14:16:28, completed 14:43:32 (27 minutes 4 seconds, the gradual shift), overview 1 succeeded / 0 failed / 0 skipped, no error information, no rollback. One Lambda target `prod63k-atlantis-mcp-beta-ReadFunction:live`, status `Succeeded`, `currentVersion` 46, `targetVersion` 47, `targetVersionWeight` 1.0. Lifecycle events: `BeforeAllowTraffic` 14:16:28.864 to 14:16:28.988, `AllowTraffic` 14:16:28.994 to 14:43:31.861 (the shift itself), `AfterAllowTraffic` 14:43:32.067 to 14:43:32.174, all `Succeeded`. Deployment group alarm configuration: enabled, `ignorePollAlarmFailure` false, one alarm `prod63k-atlantis-mcp-beta-application-ReadLambdaErrorsAlarm-hGuyVX2dXBhb`. Auto rollback enabled for `DEPLOYMENT_FAILURE`, `DEPLOYMENT_STOP_ON_ALARM`, `DEPLOYMENT_STOP_ON_REQUEST`. |
| 5 | Update ordering and permissions | PASS | See the ordering table below. The `RestApi` update waited for the alias update to complete, which means it waited for the whole gradual shift. `ReadLambdaPermissionLive` was deleted in the stack cleanup phase, after the `RestApi`, deployment, and stage updates. |
| 6 | Stack status | PASS | `UPDATE_COMPLETE`, last updated 2026-10-28T14:15:41Z (finished 14:43:56). |
| 7 | PostDeploy V1 | PASS | PostDeploy build `prod63k-atlantis-mcp-beta-PostDeploy:a891bae6-1fd0-4827-bddb-d237c09dc4eb` `SUCCEEDED` (14:44:24 to 14:46:04). `05-verify-deployment.sh`: skip switch `false`, expected version 0.0.7, public tier (no key configured, placeholder `BLANK`), custom domain present (edge target `https://mcp-beta.atlantis.63klabs.net/mcp/v1`). `Core: 36 passed, 0 failed, 0 skipped. Advisory: 6 passed, 0 warned, 3 skipped.` `Outcome: passed`. V1.1 and V1.2 PASS. The 3 skipped advisory checks are S2.1 to S2.3 (no stored key). Unlike test, the edge checks X2.1 to X2.4 ran and passed because beta has a custom domain. |

Update ordering (stack events, UTC):

| Time | Resource | Event |
|------|----------|-------|
| 14:15:41.756 | stack | `UPDATE_IN_PROGRESS` |
| 14:16:24.037 | `ReadLambdaFunction` | `UPDATE_COMPLETE` (new code on `$LATEST`) |
| 14:16:26.266 | `ReadLambdaFunctionVersion20261028T1` | `CREATE_COMPLETE` (version 47) |
| 14:16:27.218 | `ReadLambdaFunctionAliaslive` | `UPDATE_IN_PROGRESS`; at 14:16:28 reason `CodeDeploy deployment started: d-TLW2MU68L` |
| 14:43:45.169 | `ReadLambdaFunctionAliaslive` | `UPDATE_COMPLETE` (13 seconds after CodeDeploy completed at 14:43:32) |
| 14:43:46.077 | `WebApi` (`RestApi`) | `UPDATE_IN_PROGRESS` (0.91 seconds after the alias completed) |
| 14:43:48.510 | `WebApi` | `UPDATE_COMPLETE` |
| 14:43:50.403 | `WebApiDeploymentab1ed20b71` | `CREATE_COMPLETE` |
| 14:43:52.994 | `WebApiStage` | `UPDATE_COMPLETE` (the stage now serves the alias integration) |
| 14:43:54.263 | stack | `UPDATE_COMPLETE_CLEANUP_IN_PROGRESS` |
| 14:43:55.212 | `ReadLambdaPermissionLive` | `DELETE_IN_PROGRESS` |
| 14:43:56.069 | old `WebApiDeployment7f0c9f62f5` | `DELETE_COMPLETE` (cleanup) |
| 14:43:56.148 | `ReadLambdaPermissionLive` | `DELETE_COMPLETE` |
| 14:43:56.639 | stack | `UPDATE_COMPLETE` |

Permission findings:

- The integration switched to the alias (14:43:46 to 14:43:52) before `ReadLambdaPermissionLive` was deleted (14:43:55 to 14:43:56). There was no window where the integration targeted the alias without an alias invoke permission: `ReadLambdaFunctionMcpV1PostPermissionStage` (generated by SAM for the `McpV1Post` event) was not touched by this update and already allowed the invoke on `:live`.
- `aws lambda get-policy` on `<fn>:live` now holds one statement, `...ReadLambdaFunctionMcpV1PostPermissionStage-qQCAJqtzFY8z`: `lambda:InvokeFunction` on `arn:aws:lambda:us-east-2:458901159113:function:prod63k-atlantis-mcp-beta-ReadFunction:live`, condition `ArnLike AWS:SourceArn` `arn:aws:execute-api:us-east-2:458901159113:i17st3itv0/*/POST/mcp/v1`. That is the source ARN the task named.
- `aws lambda get-policy` on the unqualified function holds one statement, `...ReadLambdaPermission-SVVhoifvvO40`: `lambda:InvokeFunction` on the unqualified function, source `arn:aws:execute-api:us-east-2:458901159113:i17st3itv0/*`. It was never deleted, so the old integration kept its permission until the `RestApi` update replaced it, and it remains for the scheduled v0.0.8 removal.
- The `ReadLambdaPermissionLive` deletion is therefore harmless: `:live` invocation is covered by the SAM-generated permission, and the live checks above (PostDeploy run and my 6 requests, after the deletion) all returned HTTP 200 and showed up under `Resource=<fn>:live`.

Other state at the end of the checks:

- `live` alias: version 47, `RoutingConfig` null (no weighted routing left over). Version 46 before the deploy (baseline).
- `ReadLambdaErrorsAlarm` (beta): `OK`, actions enabled; its last state change was 2026-03-16, so the deploy did not move it.
- Fresh `server/discover` (6 requests, all HTTP 200): `resultType` `complete`, `supportedVersions` `2024-11-05`, `2025-11-25`, `2026-07-28`, `_meta["io.modelcontextprotocol/serverInfo"]` name `atlantis-mcp-server`, version `0.0.7`.

Unexpected: nothing failed. Three observations. First, the alias update held the stack in `UPDATE_IN_PROGRESS` for 27 minutes, so the stack and pipeline Deploy stage took that long. Second, there was no API traffic at all during the shift, so nothing was exposed either way. Third, because the integration switched only after the shift completed, API callers did not get gradual protection for this one migration deploy (see the next section); they get it from the next deploy onward.

## Open runtime items settled

| Item | Result |
|------|--------|
| AWS::Include expansion order | Settled on `test`. The deploy reached `UPDATE_COMPLETE` with both includes in the template (`template-openapi-spec.yml` in `WebApi.DefinitionBody`, and the top-level `Fn::Transform` for `template-dashboard.yml`). The OpenAPI include expanded correctly: the live integration URI carries the alias form (check 1) and the Lambda policy reflects it. The dashboard include caused no failure. Not separately proven: the dashboard resources themselves, which TEST does not create. |
| CodeDeploy deployment group on test | Settled. `test` has a CodeDeploy application and Read deployment group (`...ReadLambdaFunctionDeploymentGroup-sqJAsDy8pksw`) with config `CodeDeployDefault.LambdaAllAtOnce`, and this deploy ran deployment `d-TOPV9Z58L` (`Succeeded`). The group existed before the migration deploy (see context table); it is not new on `test`. |
| Alias-then-RestApi ordering on the migration deploy | Settled on `test` and `beta`. On `test` the alias update completed at 13:45:14.150 and the `RestApi` update started 0.97 seconds later (AllAtOnce, so no shift to wait for). On `beta`, under Linear10PercentEvery3Minutes, the alias update began 14:16:27, stayed `UPDATE_IN_PROGRESS` while CodeDeploy `d-TLW2MU68L` shifted traffic (14:16:28 to 14:43:32), completed 14:43:45.169, and the `RestApi` update started 14:43:46.077. CloudFormation waits for the whole gradual shift before updating the `RestApi`, because the alias resource does not complete until CodeDeploy finishes. Consequence for the migration deploy: during the shift the integration still targeted the unqualified ARN (`$LATEST`, already running the new code from 14:16:24), so API callers were not gradual-protected for this one deploy; the integration moved to the alias only when it already pointed 100% at the new version, so the switch itself exposed no mix of versions. On every later deploy the API already calls the alias, so the shift protects callers and the `ReadLambdaErrorsAlarm` rollback applies. Cost: the stack update and the pipeline Deploy stage take about 28 minutes on PROD stages. The plan's reading (alias before `RestApi`) held; the design's "better, not worse" branch (RestApi updating before the shift finishes) did not occur. |
| `ReadLambdaPermissionLive` removal on a PROD stage | Settled on `beta`. Deleted in cleanup (14:43:55 to 14:43:56), after the `RestApi`, deployment, and stage updates, so no window existed where the integration pointed at the alias without an invoke permission. `<fn>:live` is covered by `ReadLambdaFunctionMcpV1PostPermissionStage` (source `i17st3itv0/*/POST/mcp/v1`), which was not touched. The unqualified `ReadLambdaPermission` stayed throughout. Not run on `prod` yet. |
| Lambda log stream naming | Settled. Streams written through the alias are named `YYYY/MM/DD/[<version>]<32 hex>`, where `<version>` is the published version the alias points to (195 here). Streams from before the migration deploy are `[$LATEST]`. The admin-ops README sentence can state that new streams carry the alias version in brackets instead of `[$LATEST]`. |

## Rollback drill (beta)

| Date | Method | Result (passed / inconclusive / failed) | Notes |
|------|--------|------------------------------------------|-------|
| 2026-10-28 | Forced `set-alarm-state ALARM` on the beta `ReadLambdaErrorsAlarm` during an ordinary docs-only beta deploy (pipeline execution `9b521fb7-d9b7-48a5-b874-80c5e324f7fa`, merge `9c9955a`) while CodeDeploy `d-1ZWJ9R78L` (`Linear10PercentEvery3Minutes`) was shifting the `live` alias from 47 to 48. One try. | passed | CodeDeploy stopped the deployment with `ALARM_ACTIVE` 3.5 s after the alarm entered `ALARM` and started its own rollback deployment `d-MGNE7E88L`, which succeeded in 1.5 s. The alias stayed on 47 with no routing config. The stack ended `UPDATE_ROLLBACK_COMPLETE` 31 s after rollback began (15:39:51 UTC). Caveats: the alarm state was set by hand, not by a real error; 20% of traffic was on 48 at the stop; the only API request in the window was served by 48 before the alarm, and no request was made after the rollback, so the return of API responses to 47 is shown by alias state, not by traffic. Restore: new pipeline execution 0be921d5, complete 16:42 UTC. |

### Drill details

All times UTC, 2026-10-28, from read-only queries made after the drill (CodeDeploy, CloudFormation stack events, CloudWatch alarm history and metrics, CloudWatch Logs, Lambda, CodePipeline).

**Timeline**

| Time | Event | Source |
|------|-------|--------|
| 15:33:01.7 | Stack update started (`User Initiated`) | Stack events |
| 15:33:32 | `ReadLambdaFunctionVersion20261028T1` created (Lambda version 48) | Stack events |
| 15:33:33.7 | `ReadLambdaFunctionAliaslive` `UPDATE_IN_PROGRESS`; CodeDeploy `d-1ZWJ9R78L` started 15:33:34.5 (`CodeDeployDefault.LambdaLinear10PercentEvery3Minutes`) | Stack events, CodeDeploy |
| 15:33:35 | Lifecycle `BeforeAllowTraffic` succeeded, `AllowTraffic` began (10% to 48) | CodeDeploy target |
| 15:39:07.9 | The orchestrator's `server/discover` request ran as **Version: 48** (cold start, new log stream `[48]8591985253904f949a1258de1f67b94c`, response `200`) | Lambda log |
| 15:39:11.99 | Alarm `OK` to `ALARM` (history timestamp of the manual `set-alarm-state`) | Alarm history |
| 15:39:12.04 | Alarm action executed: SNS publish to the `ReadLambdaErrorAlarmNotification` topic succeeded | Alarm history |
| 15:39:15.5 | `d-1ZWJ9R78L` complete: status `Stopped`, `ALARM_ACTIVE`; `AllowTraffic` `Failed`, `AfterAllowTraffic` `Skipped`; overview Failed 1 | CodeDeploy |
| 15:39:16.0 to 15:39:17.5 | CodeDeploy rollback deployment `d-MGNE7E88L` (`LambdaAllAtOnce`, creator `codeDeployRollback`), `Succeeded`; its three lifecycle events all `Succeeded` | CodeDeploy |
| 15:39:20.2 | Alias resource: `CodeDeploy rollback deployment started: d-MGNE7E88L` | Stack events |
| 15:39:20.4 | Alias `UPDATE_FAILED`: `d-1ZWJ9R78L failed. One or more alarms have been activated ... Activated alarms: <...ReadLambdaErrorsAlarm-hGuyVX2dXBhb>` | Stack events |
| 15:39:20.7 | Stack `UPDATE_ROLLBACK_IN_PROGRESS`: `The following resource(s) failed to update: [ReadLambdaFunctionAliaslive].` | Stack events |
| 15:39:46.6 to 15:39:47.5 | Alias `UPDATE_IN_PROGRESS` then `UPDATE_COMPLETE` (rollback of the alias resource) | Stack events |
| 15:39:49.9 to 15:39:50.9 | `ReadLambdaFunctionVersion20261028T1` and the two new layer versions `DELETE_COMPLETE` | Stack events |
| 15:39:51.2 | Stack `UPDATE_ROLLBACK_COMPLETE` | Stack events |
| 15:39:59.7 | Alarm `ALARM` to `OK` (next evaluation, Errors 0 against threshold 1) | Alarm history |

**Evidence**

- **Time to stop:** 3.5 s from the alarm's `ALARM` entry (15:39:11.99) to the deployment's complete time (15:39:15.5). About 9 s from the orchestrator's recorded call (about 15:39:06) to the stop, a difference that includes the gap between the call and the history timestamp.
- **Time in rollback:** `UPDATE_ROLLBACK_IN_PROGRESS` 15:39:20.7 to `UPDATE_ROLLBACK_COMPLETE` 15:39:51.2, about 30.5 s. From the alarm to a complete stack rollback, about 39 s.
- **Traffic at the stop:** `targetVersionWeight` 0.2 (`currentVersion` 47, `targetVersion` 48), the second step of the linear schedule. The stop came about 20 s before the third step (30%) would have started.
- **Alias after the drill:** `FunctionVersion` 47, no `RoutingConfig`, read at 16:03:32 UTC (before any restore update had reached the alias; the stack had no new events after 15:39:51). The rollback deployment `d-MGNE7E88L` reports `currentVersion` 47, `targetVersion` 48, `targetVersionWeight` 1.0. That field pair is how CodeDeploy describes a rollback target and was not used as evidence of where the alias ended.
- **Version 48:** it existed (log stream `Version: 48`, CloudWatch `ExecutedVersion=48`) and was deleted by the stack rollback at 15:39:50.9. `list-versions-by-function` now ends at 47 (published 2026-10-28T14:16:17 UTC), so version 48 is gone. This is the rolled-back-stack behaviour the plan expected.
- **Which versions answered:** streams active in the window: one, `[48]8591985253904f949a1258de1f67b94c` (first event 15:39:07, last 15:39:08). It holds a single invocation, the orchestrator's `server/discover` poll. The `live` alias metric `Invocations` with `ExecutedVersion=48` is 1 in the 15:39 minute; `ExecutedVersion=47` has no datapoints between 15:30 and 16:02. The newest `[47]` stream's last event is 15:01:49, before the shift. So the one request in the window landed on the candidate, and there is no request after the rollback. Both versions report `serverInfo.version` 0.0.7, so the response body could not tell them apart; the stream prefix did.
- **Alarm:** history shows exactly three items in the window: StateUpdate `OK` to `ALARM` (15:39:11.99), Action `Successfully executed action ...ReadLambdaErrorAlarmNotification` (15:39:12.04), StateUpdate `ALARM` to `OK` (15:39:59.7). Alarm settings: `Errors`, dimension `FunctionName` only (not version-scoped), period 900 s, 1 evaluation period, threshold 1.0, actions enabled.
- **Pipeline:** execution `9b521fb7-d9b7-48a5-b874-80c5e324f7fa` `GenerateChangeSet` Succeeded, `ExecuteChangeSet` Failed at 15:40:23 UTC (the first attempt, started 15:32:57), so the Deploy stage Failed. The PostDeploy stage did not run for this execution (its latest execution is the older `f5821087-bd39-447e-ba13-ed1a0e58ddce`).

**Judgement (Requirement 10.4, design V-D): passed.** CodeDeploy stopped the deployment on the alarm and rolled back (`d-MGNE7E88L` `Succeeded`), the alias is on the previous version 47 with no routing config, and the stack ended `UPDATE_ROLLBACK_COMPLETE`. Caveats, stated plainly:

- The alarm was forced by hand with `set-alarm-state`, once, so the drill proves the CodeDeploy-to-CloudFormation rollback path wired to this alarm, not that real function errors would trip the alarm. The alarm is function-level (not scoped to a version), as the design recorded.
- Traffic reached 20% on version 48 before the stop, and the one request in the window ran on 48. That request was made before the alarm, so it shows the shift was live, not that the rollback worked.
- No API request was made after the rollback, so "responses return to the previous version" rests on the alias state (47, no routing config) and the succeeded rollback deployment, not on a post-rollback request. One `server/discover` request now would produce a `[47]` stream (new or existing) if a direct confirmation is wanted before the restore finishes; it would need the alias to still be on 47.
- The restore deploy that runs after this will also create a new CodeDeploy deployment and a new stack update; none of its events are part of this record.

### Restore

Beta was restored to the current release on 2026-10-28 (UTC) with a new pipeline execution from the same source. Times are UTC; the facts in the first block come from the operator's run notes, the table from read-only queries made afterwards (CodeDeploy, CloudFormation, CodePipeline, CodeBuild and CloudWatch Logs, Lambda, CloudWatch alarms).

**What happened**

| Time | Event |
|------|-------|
| 16:02:21 | First attempt: retry of the Deploy stage of execution `9b521fb7`. Failed at 16:02:25 with `ChangeSet [pipeline-changeset] does not exist (ChangeSetNotFound)`. The failed execution's change set had already been consumed by the rolled-back deploy. |
| 16:06:07 | One post-rollback `server/discover` request: HTTP 200, served by log stream `2026/10/28/[47]8e754c437a38448f8d73a9e4a0b7c67d` (alias on 47, no routing config). This is the direct confirmation that API responses returned to the previous version after the rollback, which the drill row could only show by alias state. |
| 16:06:30 | Second attempt: new execution `0be921d5-d5aa-4090-92d4-fc88d608731e` (`aws codepipeline start-pipeline-execution`, trigger `StartPipelineExecution`, source revision `9c9955af1024b17e6b0aa64c69b15d548c22ba2b`). |

**Result**

| Item | Result |
|------|--------|
| Pipeline execution `0be921d5` | `Succeeded`. Source 16:06:30, Build 16:06:34 to 16:11:12, `GenerateChangeSet` 16:11:13 to 16:11:47, `ExecuteChangeSet` 16:11:48 to 16:39:56, PostDeploy 16:39:56 to 16:42:00 |
| CodeDeploy `d-KHOY1798L` | `Succeeded`, creator `user` (CloudFormation), `CodeDeployDefault.LambdaLinear10PercentEvery3Minutes`, `BLUE_GREEN` / `WITH_TRAFFIC_CONTROL`, created 16:12:23, completed 16:39:27 (27 minutes 4 seconds, the full shift). Overview 1 succeeded / 0 failed / 0 skipped, no error information, no rollback. Target `prod63k-atlantis-mcp-beta-ReadFunction:live` `Succeeded`, `currentVersion` 47, `targetVersion` 49, `targetVersionWeight` 1.0. `BeforeAllowTraffic`, `AllowTraffic`, `AfterAllowTraffic` all `Succeeded`. No alarm forced it. |
| Stack `prod63k-atlantis-mcp-beta-application` | `UPDATE_COMPLETE`, last updated 2026-10-28T16:11:49Z. Update finished about 16:40. |
| `live` alias | Version 49, no `RoutingConfig`. Version 48 was deleted by the drill rollback, so the restore version was numbered 49. |
| PostDeploy build `prod63k-atlantis-mcp-beta-PostDeploy:31582b65-9a46-452c-a8d2-15a50b52a6f9` | `SUCCEEDED`, 16:39:57 to 16:41:34, source `9c9955a`. `05-verify-deployment.sh`: expected version 0.0.7. `Core: 36 passed, 0 failed, 0 skipped. Advisory: 6 passed, 3 warned, 0 skipped.` `Outcome: passed`. V1.1, V1.2, and edge X2.2 PASS. |
| `ReadLambdaErrorsAlarm` (beta) | `OK`, actions enabled. Last state change 15:39:59.7 (the drill), so the restore did not move it. |
| `server/discover` after the restore | One request at 16:45:57: HTTP 200, `resultType` `complete`, `supportedVersions` `2024-11-05`, `2025-11-25`, `2026-07-28`, `_meta["io.modelcontextprotocol/serverInfo"]` name `atlantis-mcp-server`, version `0.0.7`. |

**Observation: stored verification key.** The PostDeploy log says `Verification key: key configured; S2 checks it`, and S2.1, S2.2 and S2.3 all `WARN`: the stored key got HTTP 401 `Invalid API key` in both `X-API-Key` and Bearer form. The advisory split therefore differs from the earlier beta run (6 passed, 0 warned, 3 skipped, no key then). Advisory checks do not fail the build, so the outcome is `passed`. A key is now stored in `Mcp_PostDeployTestVerifyApiKey` (the parameter was the `BLANK` placeholder at the migration deploy check) and the server does not accept it; this is unrelated to the alias change. Likely cause (not checked): the account expiry in [#5](https://github.com/63Klabs/atlantis-mcp/issues/5), or a mistyped or rotated key.

**Judgement (Requirement 10.7): restored.** Beta is on the current release (alias 49, stack `UPDATE_COMPLETE`, PostDeploy `Outcome: passed`, alarm `OK`), reached by a full gradual shift with no rollback.

**Not verified:** that the 16:45:57 request was served by a `[49]` stream. The newest stream is `2026/10/28/[49]3b6f72c04b304960bc9710f5897c1db0`, but its `lastEventTimestamp` still read 16:41:34 (the PostDeploy run) at 16:46:35, which can lag. Version 49 is shown by the alias and by `serverInfo.version`, not by that stream. The 16:06:07 request and its `[47]` stream come from the operator's run notes, not from a re-query.

**Lesson.** After a rolled-back deploy, restore with a new pipeline execution (`aws codepipeline start-pipeline-execution`), not a stage retry. `retry-stage-execution` on the Deploy stage fails immediately with `ChangeSetNotFound`, because the change set of the failed execution had already been consumed (the retry looks for `pipeline-changeset` and it is gone). A new execution runs `GenerateChangeSet` again against a stack in `UPDATE_ROLLBACK_COMPLETE` and deploys normally. Budget about 35 minutes on a PROD stage: about 5 for Build, about 28 for the Deploy shift, about 2 for PostDeploy. Expect the next Lambda version number to skip the deleted drill version (49 here, not 48).
