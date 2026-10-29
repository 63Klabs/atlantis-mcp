# Report to the Atlantis project: starter pattern bypasses gradual deployment, and the permission-pair convention is redundant

Spun off from [0-0-7-api-gateway-live-alias PLAN.md](../0-0-7-api-gateway-live-alias/PLAN.md) (Decisions 6 and 7). This repository does not change upstream templates, starters, or upstream-managed steering. The task here is to write and send the report; the fix belongs to the Atlantis starter and steering owners.

## Summary

Two patterns published by the Atlantis project led this repository to an API that bypassed its own gradual deployment, with no error to show it:

1. The API Gateway integration in the starter is built from the function's unqualified ARN, so API traffic runs `$LATEST` while CodeDeploy shifts an alias nothing calls.
2. The steering convention of a `Permission` plus a `PermissionLive` pair per function is not needed once the integration targets the alias, because SAM generates the alias permission from the function's `Api` event.

## Finding 1: the starter builds the integration from the unqualified ARN

- Starter: `atlantis-starter-02-apigw-lambda-cache-data-nodejs` (v0.0.47 when this repository was reviewed on 2026-10-21; re-check against the current version before sending). Its OpenAPI integration URI uses `${WebService.Arn}`, while the same template sets `AutoPublishAlias` and a `DeploymentPreference`, and carries a `ConfigWebServiceLambdaPermissionLive` with the comment "Only needed in production for gradual deployments".
- Effect observed here: all three deployed stages invoked `$LATEST`. The `live` alias served zero invocations over 14 days on `test`, `beta`, and `prod` ([VERIFICATION.md](../0-0-7-api-gateway-live-alias/VERIFICATION.md), "Baseline"). No error or warning appears anywhere; the stack just never protects API callers.
- Fix verified here: `${ReadLambdaFunction.Alias}` in the OpenAPI spec. SAM's translator resolves it to `${ReadLambdaFunctionAliaslive}`, and CloudFormation expands `AWS::Include` before the SAM transform, so it works in an included OpenAPI file. The change reached `UPDATE_COMPLETE` on `test`, `beta`, and `prod` on 2026-10-28.
- Suggested starter change: reference `${<Function>.Alias}` in the OpenAPI spec when `AutoPublishAlias` is set, and add a test that fails if a function with an alias is referenced through `.Arn` (this repository's `openapi-integration-targets.test.js` is an example).

## Finding 2: the permission-pair convention

- Steering: `atlantis-multi-resource-src.md` ("CloudFormation Template Adjustments" and the per-function list) asks for `Config<ResourceName>LambdaPermission` and `Config<ResourceName>LambdaPermissionLive`, "one for PROD (Live) and one for DEV/TEST".
- Observed: for an API-triggered function with `AutoPublishAlias`, SAM generates a permission for the alias from the `Api` event, scoped to the event's method and path (here `ReadLambdaFunctionMcpV1PostPermissionStage`, source `.../POST/mcp/v1`). It was present in every stage before the change and covered the alias in the beta and prod migration deploys with no gap. `ReadLambdaPermissionLive` was deleted in the cleanup phase after the integration switched, and nothing broke ([VERIFICATION.md](../0-0-7-api-gateway-live-alias/VERIFICATION.md), "Permission findings").
- Suggested steering change: drop `PermissionLive` for API-triggered functions that use `AutoPublishAlias`, or explain the cases where it is still needed. Also note that a wildcard permission scoped to `${WebApi}/*` is broader than SAM's per-route one.
- This repository records its deviation in `.kiro/steering/openapi-spec-sync.md` and keeps the unqualified `ReadLambdaPermission` for one release (removal tracked for v0.0.8).

## Finding 3: operational notes from the rollout (for the pipeline and deployment docs)

1. **Migration deploy ordering.** CloudFormation updates the alias first and waits for the whole CodeDeploy shift before it updates the REST API. On PROD stages the stack update and the pipeline Deploy stage took about 28 minutes. During that first deploy the API still called the unqualified ARN. Observed on `beta` and `prod`.
2. **Rolled-back deploys cannot be retried.** After CodeDeploy stopped a deploy on an alarm, the stack ended `UPDATE_ROLLBACK_COMPLETE` and the pipeline's Deploy stage failed. Retrying the failed stage returned `ChangeSet [pipeline-changeset] does not exist (ChangeSetNotFound)`. Starting a new pipeline execution worked.
3. **Candidate version is deleted on rollback.** The stack rollback deleted the candidate Lambda version, so the next successful deploy's version number skips it.

## Expected outcome

The Atlantis starter owners review the findings, change the starter and steering if they agree, and this repository can then drop its local deviation note from `openapi-spec-sync.md`.

## To do in this repository

1. Check the current starter version and file paths against the claims in Finding 1 and 2; adjust the wording.
2. Send the report to the Atlantis project (GitHub: 63Klabs). This file is the draft.
3. Keep the deviation in `openapi-spec-sync.md` until upstream responds.
