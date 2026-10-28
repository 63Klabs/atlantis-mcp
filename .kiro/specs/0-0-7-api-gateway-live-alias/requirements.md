# Requirements Document

## Introduction

**API Gateway invokes the Read function through its `live` alias.** In `beta` and `prod`, CodeDeploy shifts the Read Function's `live` alias gradually, but the `/mcp/v1` integration targets the unqualified function ARN, which runs `$LATEST`. API callers therefore get new code the moment CloudFormation updates the function, and the gradual shift and its alarm-driven rollback protect nobody. This feature changes the `/mcp/v1` integration to target the alias, removes the Lambda permission that is made redundant by that change, adds a test that keeps the integration pointed at the alias, and documents the new behavior, including the window in which two versions serve traffic at once.

See [ISSUE.md](ISSUE.md) for the problem report and [PLAN.md](PLAN.md) for the analysis, the evidence, the locked decisions, and the verification plan. Every planning question is answered and the plan is locked.

### Guiding constraints

1. **Smallest change that fixes the target.** One integration URI changes. `DeploymentPreference`, `FunctionGradualDeploymentType`, `ReadLambdaErrorsAlarm`, and the timestamp mechanism stay as they are.
2. **Inside this repository.** No upstream Atlantis template, pipeline stack, or IAM role changes, and no edits to upstream-managed steering such as `atlantis-multi-resource-src.md`.
3. **Least privilege.** The change must not add a permission, and it removes the one that is strictly redundant.
4. **Prove it before it carries production traffic.** The alias path is verified on `test`, then `beta`, then `prod`, in that order.
5. **Existing conventions.** Atlantis naming, the repo's changelog convention, `>!` security-comment notation where it applies, and Jest tests in the nearest existing location.
6. **No surprises on live stages.** The rollback drill touches a live stage and only runs with explicit approval.

### Decisions carried forward from PLAN.md

| # | Decision | Requirement |
|---|----------|-------------|
| 1 | The alias URI applies to every stage, with one definition | 1 |
| 2 | Remove `ReadLambdaPermissionLive` now; keep `ReadLambdaPermission` for one release and remove it in v0.0.8 | 3 |
| 3 | A Jest guard test in `read-function/tests/unit/architecture/`, run by the main buildspec | 4 |
| 4 | One rollback drill on `beta`, using `aws cloudwatch set-alarm-state`, run only with approval and not on the migration deploy | 9 |
| 5 | Version-scoped rollback alarms are a separate issue | 10 |
| 6 | Fix the stale `AppFunction` comment here; report the starter pattern and permission convention upstream | 8, 10 |
| 7 | Leave the upstream-managed steering file untouched; record the permission deviation in repo-local files | 5 |

### Additions beyond PLAN.md

Small refinements made while writing these requirements. Strike any you disagree with.

- The guard test's failure messages name the reason (the alias is what CodeDeploy shifts) and point to the steering file, so the next author knows what to do (Requirement 4.5).
- The `TODO.md` follow-up for removing `ReadLambdaPermission` names v0.0.8 and this spec, so it can be found later (Requirement 3.4).
- The CHANGELOG entries link to this spec using the format of the existing v0.0.7 entries (Requirement 7.2).
- The documentation updates state that the 30 minute shift length is the default and is controlled by `FunctionGradualDeploymentType` (Requirement 6.2).

## Glossary

- **System**: This feature as a whole: the template changes, the guard test, the steering and documentation updates, the changelog entries, and the rollout verification.
- **Read Function**: The Lambda function `ReadLambdaFunction` (`${Prefix}-${ProjectId}-${StageId}-ReadFunction`), which serves `POST /mcp/v1`.
- **Auth Function**: The Lambda function `AuthLambdaFunction`. It has no alias and no gradual deployment.
- **Live alias**: The Lambda alias `live` that SAM creates for the Read Function through `AutoPublishAlias: live`. CloudFormation refers to it as `ReadLambdaFunctionAliaslive`, and SAM exposes it to templates as `${ReadLambdaFunction.Alias}`.
- **Unqualified ARN**: The Read Function's ARN without a version or alias qualifier, `${ReadLambdaFunction.Arn}`. Invoking it runs `$LATEST`.
- **Integration URI**: The `x-amazon-apigateway-integration.uri` value of an operation in `application-infrastructure/template-openapi-spec.yml`.
- **OpenAPI Spec**: `application-infrastructure/template-openapi-spec.yml`, included into `WebApi` by `Fn::Transform: AWS::Include` in `template.yml`.
- **Template**: `application-infrastructure/template.yml`.
- **SAM event permission**: The `AWS::Lambda::Permission` that SAM generates from the Read Function's `McpV1Post` `Api` event. It targets the Live alias and is scoped to `POST /mcp/v1`.
- **Hand-written permissions**: `ReadLambdaPermission` (unqualified, every stage) and `ReadLambdaPermissionLive` (Live alias, PROD only) in the Template. Both are scoped to `${WebApi}/*`.
- **Guard test**: The Jest test described in Requirement 4.
- **PROD stage**: A stage deployed with `DeployEnvironment` `PROD`, currently `beta` and `prod`.
- **Shift**: The CodeDeploy traffic shift of the Live alias to a new version, 30 minutes by default (`Linear10PercentEvery3Minutes`).
- **Migration deploy**: The first deploy of a stage that contains this change. The `RestApi` is expected to be updated after the alias finishes its shift, so the migration deploy does not itself shift API callers gradually.
- **Local translation check**: Running `aws-sam-translator` 1.115.0 on the Template with the OpenAPI Spec expanded in place, for `DeployEnvironment` `PROD` and `TEST`, and inspecting the result.
- **Baseline checks**: The read-only checks described in Requirement 9.1, run before the migration deploy.
- **Rollback drill**: The one-time exercise in Requirement 9.

## Requirements

### Requirement 1: Integration target

**User Story:** As an operator, I want API Gateway to invoke the Read Function through its Live alias in every stage, so that CodeDeploy's gradual shift and alarm-driven rollback apply to the traffic API callers actually send.

#### Acceptance Criteria

1. THE OpenAPI Spec SHALL define the `POST /mcp/v1` Integration URI as `arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${ReadLambdaFunction.Alias}/invocations`, written as `Fn::Sub`, and SHALL NOT reference `${ReadLambdaFunction.Arn}` anywhere.
2. THE OpenAPI Spec SHALL carry a short comment beside that URI stating that the Read Function is invoked through the alias so that CodeDeploy traffic shifting applies.
3. THE Integration URI SHALL be the same for every stage; THE System SHALL NOT add conditions, stage variables, or `Fn::If` to select the target.
4. THE three Auth Function Integration URIs (`/mcp/auth/key/regenerate`, `/mcp/auth/profile`, `/mcp/auth/voucher/redeem`) SHALL remain `${AuthLambdaFunction.Arn}`.
5. THE System SHALL NOT change `AutoPublishAlias`, `AutoPublishCodeSha256`, `VersionDescription`, `DeploymentPreference`, `FunctionGradualDeploymentType`, `ReadLambdaErrorsAlarm`, the API paths, methods, request and response schemas, or the CORS configuration.
6. THE System SHALL NOT introduce a new AWS resource, IAM statement, parameter, condition, or output.

### Requirement 2: Template validity

**User Story:** As a maintainer, I want evidence that the changed templates still translate and that the alias reference introduces no dependency cycle, so that the first deploy does not fail on the template.

#### Acceptance Criteria

1. WHEN the change is complete, THE implementer SHALL run the Local translation check for `DeployEnvironment` `PROD` and `TEST` and confirm that the `/mcp/v1` integration URI in the translated `RestApi` resolves to `${ReadLambdaFunctionAliaslive}`.
2. THE Local translation check SHALL confirm that the SAM event permission still targets the Live alias for both environments.
3. THE Local translation check SHALL confirm that a walk of `Ref`, `Fn::GetAtt`, `Fn::Sub`, and `DependsOn` over the translated resources finds no cycle.
4. THE Local translation check SHALL confirm that the translated Auth Function integrations are unchanged.
5. THE implementer SHALL record the outcome of the Local translation check in the implementation summary. The check's scripts are throwaway and SHALL NOT be committed.

### Requirement 3: Lambda permissions

**User Story:** As a security reviewer, I want the redundant and unusable invoke permissions removed on a schedule, so that the Read Function does not keep broad grants nothing needs.

#### Acceptance Criteria

1. THE Template SHALL NOT define `ReadLambdaPermissionLive`.
2. THE Template SHALL keep `ReadLambdaPermission` unchanged in its properties.
3. THE Template SHALL carry a comment above `ReadLambdaPermission` saying that nothing invokes the unqualified ARN after this change, that the grant is kept for one release so that the integration URI can be reverted safely, and that it is scheduled for removal in v0.0.8.
4. `TODO.md` SHALL gain an unchecked entry under the Future heading to remove `ReadLambdaPermission` in v0.0.8, naming `0-0-7-api-gateway-live-alias`.
5. THE System SHALL NOT remove the SAM event permission or change the Read Function's `McpV1Post` event.
6. THE System SHALL NOT change `AuthLambdaPermission` or any other function's permissions.

### Requirement 4: Regression guard test

**User Story:** As a maintainer, I want the build to fail if the `/mcp/v1` integration is ever pointed back at the unqualified ARN, so that the gradual deployment cannot silently stop applying to API callers.

#### Acceptance Criteria

1. THE System SHALL add a Jest test at `application-infrastructure/src/lambda/read-function/tests/unit/architecture/openapi-integration-targets.test.js`, picked up by the existing `testMatch` of `read-function`.
2. THE Guard test SHALL parse the OpenAPI Spec with the `js-yaml` dependency that `read-function` already declares, locating the file with `path.resolve(__dirname, ...)`, and SHALL add no new dependency.
3. THE Guard test SHALL fail IF the `POST /mcp/v1` Integration URI does not contain `${ReadLambdaFunction.Alias}` or contains `${ReadLambdaFunction.Arn}`.
4. THE Guard test SHALL fail IF any Auth Function Integration URI contains `.Alias`, because the Auth Function has no alias and the reference would not translate.
5. WHEN the Guard test fails on the Read Function integration, THE failure message SHALL say that the Read Function must be invoked through its alias so that CodeDeploy traffic shifting applies, and SHALL name `.kiro/steering/openapi-spec-sync.md`.
6. THE Guard test SHALL confirm that the Template still declares `AutoPublishAlias` on `ReadLambdaFunction`, reading it with a schema that tolerates CloudFormation short-form tags, as the `auth-function` tests do.
7. THE Guard test SHALL only read files, SHALL run without network or AWS access, and SHALL complete well within the Jest default timeout.
8. THE Guard test SHALL follow the conventions of the neighbouring tests in `tests/unit/architecture/`: CommonJS, `'use strict'`, and `describe`/`it` naming that describes the behavior.
9. WHEN `npm test` runs in `application-infrastructure/src/lambda/read-function`, THE whole suite, including the Guard test, SHALL pass.

### Requirement 5: Steering and the permission deviation

**User Story:** As a developer or AI assistant adding an endpoint, I want the repo's guidance to show the alias form and to say why this repo does not hand-write the permission pair, so that the mistake is not repeated.

#### Acceptance Criteria

1. THE file `.kiro/steering/openapi-spec-sync.md` SHALL use `${ReadLambdaFunction.Alias}` in its integration URI examples and in the "Lambda Function Reference" list, with a sentence explaining that the Read Function is invoked through its alias so CodeDeploy traffic shifting applies.
2. THE file `.kiro/steering/openapi-spec-sync.md` SHALL gain a short section on integration targets and permissions stating that an integration that targets the alias is covered by the permission SAM generates from the function's `Api` event, that a hand-written `Permission` and `PermissionLive` pair is therefore not added for it, and that this repository deliberately departs from the permission-pair guidance in `atlantis-multi-resource-src.md` for the Read Function.
3. THE System SHALL NOT edit `.kiro/steering/atlantis-multi-resource-src.md`, because it is an upstream-managed Atlantis agent asset.
4. THE System SHALL NOT edit the "Current MCP Endpoints" list in `.kiro/steering/openapi-spec-sync.md`.
5. THE deviation SHALL also be recorded in the Template comment from Requirement 3.3 and on the developer page from Requirement 6.1.

### Requirement 6: Documentation

**User Story:** As an operator or a release author, I want the documentation to describe what API traffic follows, how long a shift takes, how to override it, and what must stay compatible while two versions serve traffic.

#### Acceptance Criteria

1. THE documentation under `docs/developer` SHALL state that, for the length of a PROD stage's Shift, versions N and N+1 both serve API traffic, and SHALL state the compatibility rule that follows: shared data must tolerate both versions. It SHALL name the shared cache table and bucket, the Users, Sessions, and DocIndex tables, and the tool and protocol responses.
2. THE same developer documentation SHALL state that cache keys derived by `CacheableDataAccess` do not include the release version, and that a change to the shape of a cached payload therefore needs a change to the key inputs. It SHALL also state that the build's timestamp step (`update_template_timestamp.py`) is what makes every pipeline build publish a new version, so that API callers move to new code on every pipeline deploy.
3. THE documentation under `docs/admin-ops/deployment` (the deployment README and `cloudformation-parameters.md`) SHALL state that API traffic follows the Live alias, that a PROD Shift defaults to about 30 minutes through `FunctionGradualDeploymentType`, that setting the parameter to `AllAtOnce` is the override for an urgent fix, and how to see which version served requests: the CloudWatch `Resource` dimension of `<function-name>:live` and the version number in Lambda log stream names (once the log stream naming is confirmed under Requirement 9.2).
4. THE `ARCHITECTURE.md` environment-strategy text SHALL say that the gradual deployment applies to the Read Function's API traffic through the alias, and SHALL replace nothing else.
5. THE documentation SHALL NOT promise gradual deployment for the Auth Function.
6. THE System SHALL record the permission deviation on the developer page, as Requirement 5.5 requires.
7. ALL code or command examples in the documentation SHALL follow the repository's documentation standards, and SHALL include the language in code fences.

### Requirement 7: Changelog

**User Story:** As a release manager, I want the changelog to show the fix and the behavior change, so that operators know what changed in PROD deploys.

#### Acceptance Criteria

1. THE file `CHANGELOG.md` SHALL gain entries only under `[v0.0.7] (unreleased)`, and SHALL NOT change any existing text.
2. THE System SHALL add a **Fixed** entry stating that the `/mcp/v1` integration now invokes the Read Function's Live alias instead of `$LATEST`, so that PROD stages' gradual deployment and alarm rollback apply to API traffic, linked as `[Spec: 0-0-7-api-gateway-live-alias](../.kiro/specs/0-0-7-api-gateway-live-alias/)`.
3. THE System SHALL add a **Changed** entry stating that PROD deploys now reach API callers gradually, that two versions serve API traffic during a Shift, that `FunctionGradualDeploymentType=AllAtOnce` is the override for an urgent fix, that `ReadLambdaPermissionLive` is removed, and that `ReadLambdaPermission` is scheduled for removal in v0.0.8.
4. THE entries SHALL follow `.kiro/steering/changelog-convention.md` and the formatting of the neighbouring v0.0.7 entries.

### Requirement 8: Housekeeping

**User Story:** As a maintainer, I want the comments that describe the version-publishing mechanism to be accurate, because API callers now depend on it.

#### Acceptance Criteria

1. THE comment in `application-infrastructure/buildspec.yml` above the `update_template_timestamp.py` call SHALL refer to `ReadLambdaFunction` and `AutoPublishCodeSha256` instead of `AppFunction`, and SHALL say that API callers follow the alias.
2. THE header comment of `application-infrastructure/build-scripts/update_template_timestamp.py` SHALL be corrected in the same way.
3. THE changes in this requirement SHALL be comment-only; the buildspec's commands and the script's behavior SHALL NOT change.

### Requirement 9: Rollout verification

**User Story:** As an operator, I want each stage verified in order, so that the alias path is proven before it carries `prod` traffic and the open runtime questions in the plan are closed.

#### Acceptance Criteria

1. BEFORE the migration deploy on any stage, THE operator SHALL record the Baseline checks for `test`, `beta`, and `prod`: the `/mcp/v1` integration URI from `aws apigateway get-integration`, and the CloudWatch `AWS/Lambda` `Invocations` series for the Read Function under the `FunctionName` dimension and under the `Resource` dimension for both the unqualified name and `<function-name>:live`. All of these are read-only.
2. AFTER the migration deploy on `test`, THE operator SHALL confirm all of the following and record the results: the integration URI ends `:function:<function-name>:live/invocations`; `Invocations` under `Resource` `<function-name>:live` is greater than zero and the unqualified series has stopped growing; new Read Function log streams carry version numbers rather than `$LATEST`; `aws deploy list-deployments` shows how the stage's alias moved; the CloudFormation stack events show whether the `RestApi` updated after the alias finished; and the PostDeploy check V1 passed.
3. WHEN the `test` results satisfy Requirement 9.2, THE operator SHALL repeat the Requirement 9.2 checks on `beta`, and WHEN the `beta` results are clean, on `prod`. The operator SHALL NOT promote to the next stage while a check is unmet.
4. THE results of the checks that settle the plan's open runtime items, namely the `AWS::Include` expansion order, the stage behavior of the CodeDeploy deployment group, the first-deploy ordering of the alias and the `RestApi`, and the log stream naming, SHALL be recorded in this spec directory in a short `VERIFICATION.md`, with the Baseline checks.
5. IF a check fails, THEN THE operator SHALL stop the rollout, revert the Integration URI through the pipeline, and report the finding before another stage is deployed.

### Requirement 10: Rollback drill and scope boundaries

**User Story:** As an operator, I want the rollback path exercised once, safely, and I want the boundaries of this change stated, so that follow-up work is not mistaken for work in this spec.

#### Acceptance Criteria

1. THE Rollback drill SHALL NOT run without the owner's explicit approval at the time it is scheduled.
2. THE Rollback drill SHALL run only on `beta`, once, and not on the migration deploy. It SHALL run on the next ordinary `beta` deploy, while the alias is the API target.
3. THE Rollback drill SHALL, during that deploy's Shift, call `aws cloudwatch set-alarm-state` to put `ReadLambdaErrorsAlarm` into `ALARM` while polling `serverInfo.version` through the API, repeating the call if the alarm's state reverts before CodeDeploy reacts.
4. THE Rollback drill SHALL be judged passed only IF CodeDeploy stops and rolls back, the alias returns to the previous version, the polled responses return to the previous version, and the stack ends in `UPDATE_ROLLBACK_COMPLETE`.
5. IF CodeDeploy does not react to the manually set alarm state, THEN THE outcome SHALL be recorded as inconclusive, not as a rollback failure.
6. BEFORE the Rollback drill, THE operator SHALL tell the `AlarmNotificationEmail` recipient to expect an alarm email, SHALL confirm that no `prod` promotion is pending, and SHALL confirm who holds `cloudwatch:SetAlarmState` rights.
7. AFTER the Rollback drill, THE operator SHALL redeploy `beta` normally, and SHALL record the drill's outcome in `VERIFICATION.md`.
8. THE System SHALL NOT include any of the following, which are out of scope: version-scoped rollback alarms (a separate issue, Decision 5); CodeDeploy pre-traffic or post-traffic hooks; changes to the default Shift type; dashboard changes; changes to upstream templates, the Atlantis starter, or upstream-managed steering; gradual deployment for the Auth Function; gating the `application-infrastructure/tests/` packages in a buildspec.
9. THE System SHALL NOT create the follow-up issues for the alarm work or the upstream report; the owner decides when and where to file them.
