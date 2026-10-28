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
| | | | |
