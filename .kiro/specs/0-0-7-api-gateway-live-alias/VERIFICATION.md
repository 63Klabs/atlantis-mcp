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
| test | | | |
| beta | | | |
| prod | | | |

## Open runtime items settled

| Item | Result |
|------|--------|
| AWS::Include expansion order | |
| CodeDeploy deployment group on test | Prior to the migration deploy, `test` already has a deployment group and past CodeDeploy deployments (see context table). Settle the "new observation" after the migration deploy by reading check 4. |
| Alias-then-RestApi ordering on the migration deploy | |
| Lambda log stream naming | |

## Rollback drill (beta)

| Date | Method | Result (passed / inconclusive / failed) | Notes |
|------|--------|------------------------------------------|-------|
| | | | |
