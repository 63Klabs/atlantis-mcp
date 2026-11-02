# API Gateway invokes the Read function's $LATEST instead of the live alias

> **Status**: Locked 2026-10-27
> **Issue**: [ISSUE.md](ISSUE.md)
> **Reviewed against**: `dev` at `f6db48c` on 2026-10-27 (the issue was checked at `7acaf7d`; `template.yml` and `template-openapi-spec.yml` are unchanged between the two, only `buildspec.yml` moved)

## 1. Summary

In `beta` and `prod`, CodeDeploy shifts the Read function's `live` alias over about 30 minutes, but API Gateway calls the unqualified function ARN, which runs `$LATEST`. API callers get new code the moment CloudFormation updates the function, so the gradual shift and its alarm-driven rollback protect nobody. I confirmed the cause by reading the templates and by running the SAM translator on the real templates.

The fix is a one-line change in `template-openapi-spec.yml`: build the `/mcp/v1` integration URI from `${ReadLambdaFunction.Alias}` instead of `${ReadLambdaFunction.Arn}`. Translation works for both `PROD` and `TEST`, produces no dependency cycle, and SAM's own event permission already allows API Gateway to invoke the alias in every stage. The rest of the work is cleanup and guardrails: narrow the now-redundant Lambda permissions, update the steering example that would reproduce the mistake, document the new "two versions at once" window, and prove the alias path on `test` before `beta` and `prod`.

Nothing in the issue's deployed-state tables could be re-checked from this workspace (no AWS CLI or credentials), so those stay as the issue's own observations.

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | `/mcp/v1` integration targets the unqualified function ARN | Confirmed | `application-infrastructure/template-openapi-spec.yml:52` uses `${ReadLambdaFunction.Arn}`. `git diff 7acaf7d HEAD` shows no change to this file |
| 2 | Read function has `AutoPublishAlias: live` and a PROD-only gradual `DeploymentPreference` with alarm rollback | Confirmed | `template.yml:789-801`; default `Linear10PercentEvery3Minutes` at `template.yml:205-220`; `IsProduction` and `CreateAlarms` at `template.yml:583,592` |
| 3 | Every build forces a new version so the alias always moves | Confirmed, line numbers drifted | `buildspec.yml:168-169` runs `update_template_timestamp.py` unconditionally in the `build` phase (issue cited L160-161; the postdeploy-verification work added 8 lines above it). Applies to pipeline builds only; a local `sam deploy` skips it |
| 4 | SAM leaves the hand-written URI untouched (aws-sam-translator 1.115.0) | Confirmed, reproduced | I ran 1.115.0 on a mirror template and on the real `template.yml` with both `AWS::Include` files expanded by hand. `PROD` and `TEST` both keep `${ReadLambdaFunction.Arn}` |
| 5 | Three permissions apply: `ReadLambdaPermission` (unqualified, all stages), `ReadLambdaPermissionLive` (alias, PROD), SAM's `McpV1Post` permission (alias, all stages) | Confirmed, with a precision | `template.yml:1966-1981`. The two hand-written permissions use `SourceArn .../${WebApi}/*` (every method, path, and stage). SAM's permission is scoped to `POST /mcp/v1`. Lambda docs say a permission on an alias does not cover unqualified invocation, so only `ReadLambdaPermission` serves the integration as written ([Lambda aliases, resource policies](https://docs.aws.amazon.com/lambda/latest/dg/using-aliases.html)) |
| 6 | The pattern comes from Atlantis starter 02 and from `openapi-spec-sync.md` | Steering confirmed, starter not re-checked | `.kiro/steering/openapi-spec-sync.md:61,111,118-119` prescribe `${ReadLambdaFunction.Arn}`. I did not re-read starter 02 v0.0.47; it is upstream and this repo does not change it |
| 7 | Deployed `test`/`beta`/`prod` call `$LATEST`; alias has 0 invocations in 14 days; no errors recorded | Unverifiable by reading | Needs AWS access. Re-check with the issue's `get-integration` command and the CloudWatch `Resource` dimension query (see section 6, verification) |
| 8 | A rollback "probably still reaches API callers" today | Unverifiable, moot | Depends on CloudFormation and CodeDeploy behavior that nobody has observed. The fix makes the question irrelevant, but section 6 includes a rollback drill so it gets observed once |
| 9 | `ReadLambdaErrorsAlarm` uses only the `FunctionName` dimension, so it aggregates all versions and aliases | Confirmed | `template.yml:2115-2131`. AWS documents `FunctionName` as the aggregate for all versions and aliases, `Resource` for one version or alias, and `ExecutedVersion` for comparing the two targets of a weighted alias ([viewing metrics](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-view.html)) |
| 10 | `AWS::Include` is expanded before the SAM transform, so an alias reference in the included file works | Partially confirmed | Works when I expand the include by hand. I did not exercise CloudFormation's own expansion order. Needs a `test` deploy (or a change set) to settle |
| 11 | `${ReadLambdaFunction.Alias}` in `Fn::Sub` becomes `${ReadLambdaFunctionAliaslive}` | Confirmed, reproduced | Real templates, `PROD` and `TEST`. `Ref` on `AWS::Lambda::Alias` returns the alias ARN ([AWS::Lambda::Alias](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-alias.html)) |
| 12 | SAM's event permission already covers the alias in every stage | Confirmed | Translation emits `ReadLambdaFunctionMcpV1PostPermission<Stage>` with `FunctionName: Ref ReadLambdaFunctionAliaslive` for both environments. The issue's deployed `test` policy shows the same |
| 13 | Docs promise gradual deploys in PROD | Confirmed, line numbers drifted | `ARCHITECTURE.md:830-833` (issue said L824), `docs/admin-ops/deployment/README.md:65-67`, `docs/admin-ops/deployment/cloudformation-parameters.md:86-88`. Also `AGENTS.md:177` and the parameter descriptions at `template.yml:194,207` |
| 14 | The Auth function has no alias and is consistent | Confirmed | Only `ReadLambdaFunction` has `AutoPublishAlias` or `DeploymentPreference` (`template.yml:789-795`; no match for Auth, Cleanup, or DocIndexer) |
| 15 | Once API traffic follows the alias, the timestamp script matters to callers | Confirmed | See row 3. The comment on `buildspec.yml:168` still refers to `AppFunction`, a name that no longer exists |
| 16 | Post-deploy verification is unaffected | Confirmed | CloudFormation blocks until the CodeDeploy shift finishes, so the PostDeploy stage sees one version. V1 in `05-verify-deployment.sh` becomes a real check of the alias path instead of `$LATEST` |

New observation, not in the issue: the local translator (1.115.0) creates the CodeDeploy deployment group and the alias `UpdatePolicy` in every stage and picks `AllAtOnce` through an `Fn::If` on the deployment type. `Enabled: !If [IsProduction, ...]` does not gate their creation. So in `test` the alias is also moved by a CodeDeploy deployment, only instantly. The CloudFormation service applies its own SAM version and feature toggles, so this needs a runtime look (`aws deploy list-deployments` on `test`). It does not change the plan.

## 3. Current state

- **Request path.** CloudFront (custom domain stages) to `WebApi` (REST, `EDGE`) to the integration in `template-openapi-spec.yml`, which `template.yml:668-673` pulls in with `AWS::Include`. The Read function path is `/mcp/v1`. The three Auth paths (`/mcp/auth/key/regenerate`, `/mcp/auth/profile`, `/mcp/auth/voucher/redeem`) use `${AuthLambdaFunction.Arn}` and stay that way.
- **Deployment path.** `AutoPublishAlias: live` plus `DeploymentPreference` make SAM create a version, an alias with `UpdatePolicy: CodeDeployLambdaAliasUpdate`, and a CodeDeploy deployment group (`DeployRole` is a pipeline-provided role). The alias move blocks the stack update until CodeDeploy finishes.
- **Why it is this way.** `AutoPublishAlias: live` has been in `template.yml` since the seeding commit `234cdb4` (2026-02-21). The two hand-written Read permissions, including `ReadLambdaPermissionLive`, arrived together in `5ec1235` (2026-02-24, "kiro: tasks 1-7 completed"). The `${ReadLambdaFunction.Arn}` URI first appears in the OpenAPI file in `4531b49` (2026-02-25, "updated Open API Spec"). No commit message records a decision to call `$LATEST`; it reads as the starter's pattern (and the steering example) being copied. The existence of an alias permission added three days earlier suggests the alias was meant to be the target.
- **SAM does not help.** With an explicit `DefinitionBody`, SAM does not inject or rewrite integrations. I confirmed both halves: it leaves an existing URI alone (row 4), and when the spec omits the integration it adds none (the `/mcp/v1` POST came back with no `x-amazon-apigateway-integration`). The URI has to be written by hand.
- **Observability today.** Alarms, dashboard widgets, and the Insights queries all key on `FunctionName` or the log group, so they keep working when traffic moves to the alias. Nothing in `application-infrastructure` queries by alias.

## 4. Review

### 4.1 Security

- **Trust boundaries.** Unchanged. The integration stays `aws_proxy`; authentication, rate limiting, and input validation live in the function. No new input path.
- **Least privilege improves.** `ReadLambdaPermission` and `ReadLambdaPermissionLive` both grant `apigateway.amazonaws.com` invoke rights for `${WebApi}/*`, meaning any method on any path of the API. The only Read-function integration is `POST /mcp/v1`, which SAM's permission already covers. Removing the two broad grants (`ReadLambdaPermissionLive` now, `ReadLambdaPermission` next release) matches the "tight, resource-scoped permissions" rule in `AGENTS.md` section 3.3. Today the unqualified grant is dead authority that would let a future route reach `$LATEST` by accident.
- **Security fixes now roll out more slowly.** This is the one cost on the security side. Today a security fix reaches API callers immediately. After the change, up to 100% of traffic stays on the old, vulnerable code for about 30 minutes in `beta` and `prod` (`Linear10PercentEvery3Minutes`), and a rollback lands callers on that older code. `FunctionGradualDeploymentType` already accepts `AllAtOnce`, so operators can choose speed for an urgent fix. The plan should document that override. This matters for 0.0.7 itself, which also carries `0-0-7-rate-limit-client-ip-spoofing` and `0-0-7-lapsed-tier-downgrade`.
- **Fail-open or fail-closed.** If the alias reference were wrong, CloudFormation would fail the update or API Gateway would return 5xx for the integration. Neither exposes data. Failure is closed.
- **Data exposure.** No change to logs or responses. The `serverInfo.version` value can differ between responses during a shift; that is a stable, non-sensitive release number.
- **Disclosure.** This is an operational gap, not an exploitable weakness. The issue and plan are fine to keep in the public spec directory.

### 4.2 Software engineering

- **Correctness.** The change is a single string. The rest of the correctness work is confirming CloudFormation behaves as the local translator does (row 10).
- **New concurrency constraint.** For roughly 30 minutes per PROD deploy, versions N and N+1 serve API traffic at once. Anything shared across versions has to tolerate both:
  - the `@63klabs/cache-data` DynamoDB table and S3 bucket (`CACHE_DATA_DYNAMO_DB_TABLE`, `CACHE_DATA_S3_BUCKET`, `template.yml` Read function environment), where one version can read entries the other wrote;
  - `UsersTable`, `DynamoDbSessions`, and `DocIndexTable` item shapes;
  - tool responses and the dual-era protocol surface (`tools/list`, `serverInfo.version`).
  Cache keys are not tied to the release. Every `CacheableDataAccess.getData` call in `read-function/services` and `controllers` derives its key from the connection, cache profile, and request data (see the comment at `services/documentation.js:918-923`, which says the hash covers the whole `connection` object), and I found no version or schema component in any of them. So a payload shape change under an unchanged key is visible to both versions. Today the exposure is one-directional (the new version reads the old version's entries). After the change it is two-directional for the length of a shift, and again after a rollback. This becomes a standing rule for release authors and belongs in `docs/developer`: change the key inputs when you change a cached payload's shape.
- **Fit with existing patterns, and one conflict.** `.kiro/steering/atlantis-multi-resource-src.md` (the CloudFormation table at line 233 and the "Each function requires its own" list at line 240) tells authors to give every API-triggered function two hand-written permissions, `...Permission` for DEV/TEST and `...PermissionLive` for PROD. Removing either one departs from that convention. SAM's generated `POST /mcp/v1` permission on the alias is what makes the pair redundant here. I checked through the 63Klabs Atlantis MCP server: this file is a published Atlantis agent asset (`atlantis/utilities/v2/agent_assets/steering/atlantis-multi-resource-src.md`, last modified 2026-10-08), so the local copy is upstream-managed and a local edit can drift or be overwritten on the next sync (Decision 7: leave it untouched). `openapi-spec-sync.md` is not in that list; it is repo-local.
- **Alternatives for producing the URI.** Considered and rejected in section 6.
- **Tests.** No test encodes the integration URI, the alias, or the Read permissions (searched the test directories under `application-infrastructure` for `template-openapi-spec`, `ReadLambdaPermission`, `x-amazon-apigateway-integration`, and `AutoPublishAlias`; no hits). So nothing breaks, and nothing guards against regression. The main buildspec only runs tests under `src/lambda/*/`; the packages under `application-infrastructure/tests/` are not gated by any buildspec (the open `0-0-7-revive-postdeploy-tests` issue). There is precedent for a gated test that reads the infrastructure template from inside a function package: `src/lambda/auth-function/tests/unit/xray-template-config.test.js` and `tests/property/cognito-env-var.property.test.js` load `template.yml` with `path.resolve(__dirname, '../../../../../template.yml')` and `js-yaml`. `read-function` already lists `js-yaml` as a dependency (`package.json:23`). That makes a function-package test the gated option (Decision 3).
- **Documentation to update.** `ARCHITECTURE.md`, `docs/admin-ops/deployment/README.md`, `docs/admin-ops/deployment/cloudformation-parameters.md`, `docs/developer` (compatibility rule), `.kiro/steering/openapi-spec-sync.md`, and `CHANGELOG.md`.

### 4.3 Cloud engineering

- **Where it lands.** API layer only. Compute, data, and async paths are untouched.
- **IaC impact.** `template-openapi-spec.yml` changes, which changes the generated API Gateway deployment, so SAM creates a new `AWS::ApiGateway::Deployment` once. After that the URI text is constant, so later deploys do not redeploy the API. The integration ARN changes from `:function:<name>/invocations` to `:function:<name>:live/invocations`. The `RestApi` gains an implicit dependency on the alias; my dependency walk (`Ref`, `Fn::GetAtt`, `Fn::Sub`, `DependsOn`) found no cycle in the translated 58-resource template. I used my own walk, not `cfn-lint`.
- **First deploy ordering (to verify).** Because the `RestApi` now depends on the alias, I expect CloudFormation to finish the alias update, including the whole CodeDeploy shift, before it updates the `RestApi`. If so, the first PROD deploy after the change still sends new code to API callers immediately (the old `$LATEST` behavior), and the API flips to the alias at the end. Every later deploy is gradual. That is safe, but it means the alias path is first used on traffic at 100% in `prod`, so it must be proven on `test` and `beta` first. This ordering is my reading of CloudFormation, not something I observed.
- **Stages.** `test` already goes through CodeDeploy `AllAtOnce`, so routing its API through the alias changes timing by seconds at most. Applying one URI to every stage also means `test` exercises the exact production path.
- **Alarm quality.** `ReadLambdaErrorsAlarm` is `Errors` Sum greater than 1 over a 900 second period, on the function aggregate (`template.yml:2115-2131`). During a shift, errors from the old and new version are mixed, and the 15 minute window is coarse next to 3 minute steps. The AWS SAM guide pairs gradual deployments with an alias-scoped alarm and a latest-version alarm ([gradual deployments](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/automating-updates-to-serverless-apps.html)). Rollback quality can improve, but that is a separate change (Decision 5).
- **Cost and quotas.** No new billable resources. Alias invocation costs the same as unqualified invocation. CodeDeploy for Lambda has no charge.
- **Observability after the change.** Lambda log streams carry the version number or `$LATEST` in their name. After the fix I expect new streams to show version numbers only, which gives a cheap second check next to the CloudWatch `Resource` dimension. I did not verify the stream naming here.
- **Rollout and rollback.** Normal pipeline order `dev` then `test` then `beta` then `main`. Rollback of this change is a git revert of the one line, redeployed through the pipeline. If `ReadLambdaPermission` is removed in the same release, a revert recreates it in the same update that flips the URI, which can leave a short window of invocation errors. That is the reason the issue suggests keeping it for one release (Decision 2).
- **Runbook.** The existing PostDeploy verification blocks promotion on a red V1, which now protects the alias path as well.

## 5. Gaps and observations

- The issue defers four decisions (stage scope, permissions, rollback exercise, alarms), locked as Decisions 1, 2, 4, and 5.
- The permission-pair convention that this change departs from lives in an upstream-managed steering file (Decision 7). The upstream convention and starter 02 probably carry the same `$LATEST` flaw, which is why the upstream report in Decision 6 matters.
- Line references in the issue have drifted in `buildspec.yml` and `ARCHITECTURE.md`. Section 2 has the current ones.
- `buildspec.yml:168` and the header of `update_template_timestamp.py` describe an alias bug and mention `AppFunction`, which was renamed in the multi-resource move. The mechanism still matters (row 15), so the comment is worth correcting (Decision 6).
- `AGENTS.md:177` says PROD has gradual deployments. That becomes true for API callers on the Read function after the fix. The Auth function and others still deploy at once, which is the status quo.
- No existing test or document describes the "two versions at once" window or tells operators how to turn gradual rollout off for an urgent patch.
- Rollback has never been observed on this stack (no `Errors` in 14 days per the issue).


## 6. Proposed approach

**Core change**

1. In `application-infrastructure/template-openapi-spec.yml`, change the `/mcp/v1` integration URI to `...functions/${ReadLambdaFunction.Alias}/invocations`, with a short comment saying the Read function must be invoked through the alias so CodeDeploy traffic shifting applies. Leave the three Auth integrations on `${AuthLambdaFunction.Arn}` (the Auth function has no alias). One URI for every stage (Decision 1).
2. Leave `DeploymentPreference`, `FunctionGradualDeploymentType`, `ReadLambdaErrorsAlarm`, and the timestamp mechanism unchanged (Decision 5 keeps alarm work out of scope).

**Permissions (Decision 2)**

3. In `template.yml`, remove `ReadLambdaPermissionLive`; it is strictly redundant with SAM's `POST /mcp/v1` permission on the alias. Keep `ReadLambdaPermission` (the unqualified grant) for one release as the revert safety net, with a comment above it saying why it exists and when it goes. Add an entry to `TODO.md` under Future to remove it in v0.0.8. Record the deviation from the permission-pair convention as Decision 7 describes (item 9).

**Regression guard (Decision 3)**

4. Add a Jest test at `application-infrastructure/src/lambda/read-function/tests/unit/architecture/openapi-integration-targets.test.js` (next to `no-hardcoded-revisions.test.js`; matched by the existing `testMatch`). It loads `template-openapi-spec.yml` with the existing `js-yaml` dependency (the file uses long-form `Fn::Sub` and no short tags) via a path built with `path.resolve(__dirname, ...)`, as `auth-function/tests/unit/xray-template-config.test.js` does. It fails if any `/mcp/v1` integration URI references `${ReadLambdaFunction.Arn}` or does not reference `${ReadLambdaFunction.Alias}`, and fails if an Auth integration uses `.Alias`, which would break translation. The test also confirms `template.yml` still declares `AutoPublishAlias` on `ReadLambdaFunction`, since the `.Alias` reference depends on it. New tests follow the nearest convention in this package (`*.test.js`, CommonJS, `>!` security-style comments where relevant). No new dependency.

**Conventions, docs, and housekeeping**

5. Update `.kiro/steering/openapi-spec-sync.md` (L61, L111, L118-119) so the examples and "Lambda Function Reference" list use `${ReadLambdaFunction.Alias}` with the reason. Its "Current MCP Endpoints" list is already stale (it names nine `/mcp/<tool>` paths the template no longer has); leave that alone.
6. Docs:
   - `docs/developer`: the N and N+1 compatibility rule for a PROD shift, covering the unversioned cache keys (section 4.2), table item shapes, and the dual-era protocol surface; the rule to change cache-key inputs when a cached payload's shape changes; and that the timestamp script is what makes every pipeline build publish a version.
   - `docs/admin-ops/deployment/README.md`, `cloudformation-parameters.md`, and `ARCHITECTURE.md` (lines 830-833): API traffic follows the alias; a PROD shift takes about 30 minutes by default; how to see which version served requests (CloudWatch `Resource` dimension, log stream names after verification); `FunctionGradualDeploymentType=AllAtOnce` is the override for an urgent fix; the two-versions-at-once window.
7. Fix the stale `AppFunction` comment at `application-infrastructure/buildspec.yml:168` and the matching header text in `build-scripts/update_template_timestamp.py` (Decision 6). Comment-only, no behavior change.
8. `CHANGELOG.md` under `v0.0.7 (unreleased)`: a **Fixed** entry for the integration target, a **Changed** entry for the PROD behavior change and the concurrent-versions window, and a **Changed** note that `ReadLambdaPermissionLive` is removed and `ReadLambdaPermission` is scheduled for removal in v0.0.8. Follow `.kiro/steering/changelog-convention.md`; do not edit existing text.

**Recording the permission deviation (Decision 7)**

9. Leave `.kiro/steering/atlantis-multi-resource-src.md` untouched, because it is an upstream-managed Atlantis agent asset. Record that this repository deliberately departs from its permission-pair guidance for the Read function in three places: a section in the repo-local `.kiro/steering/openapi-spec-sync.md` (an integration that targets the alias is covered by the permission SAM generates from the function's `Api` event, so do not add a hand-written `Permission`/`PermissionLive` pair for it, and why), a comment beside `ReadLambdaPermission` in `template.yml`, and the `docs/developer` page from item 6. The upstream report from Decision 6 also covers the permission convention.

**Verification**

Local, done and repeatable: translate the real templates with `aws-sam-translator` 1.115.0 and check the URI, permissions, deployment group, and dependency graph for `PROD` and `TEST`. Re-run it after the edit as the implementation check, together with `npm test` in `read-function`.

Runtime, in order. Each item below also closes one "needs runtime verification" row from section 2:

| Stage | Check | Closes |
|-------|-------|--------|
| Before any deploy | Run the issue's `aws apigateway get-integration` command and the CloudWatch `Resource` dimension query on `test`, `beta`, and `prod` to record the baseline | Row 7 |
| `test` | After the pipeline deploys: integration URI ends `:function:<name>:live/invocations`; `Invocations` with `Resource` = `<name>:live` is non-zero and the unqualified series stops; new log streams carry version numbers, not `$LATEST`; `aws deploy list-deployments` shows how the stage's alias moved; CloudFormation events show whether the `RestApi` updated after the alias; PostDeploy V1 is green | Rows 7, 10, new observation, first-deploy ordering, log stream naming |
| `beta` | Same checks, then the rollback drill below | Rows 8 and the ordering check again |
| `prod` | Same checks after `beta` is clean; no drill | Row 7 |

Rollback drill (Decision 4, `beta` only, run once, with your go-ahead at that time):

- Timing: not on the migration deploy. The first `beta` deploy after this change flips the `RestApi` to the alias after the shift ends (section 4.3), so the drill runs on the next ordinary `beta` deploy, while the alias is the API target.
- Method: during that deploy's shift, call `aws cloudwatch set-alarm-state` to put `ReadLambdaErrorsAlarm` into `ALARM`, while polling `serverInfo.version` through the API.
- Pass: CodeDeploy stops and rolls back, the alias returns to the previous version, polled responses return to the previous version, and the stack ends in `UPDATE_ROLLBACK_COMPLETE`.
- Side effects to accept up front: the alarm's SNS topic emails `AlarmNotificationEmail`, so tell that recipient first; the manually set state reverts at the alarm's next evaluation, so the call may need repeating; that build fails and does not promote, so `beta` needs another normal deploy afterward, and the drill should not overlap a pending `prod` promotion; `cloudwatch:SetAlarmState` rights are needed by whoever runs it.
- If CodeDeploy does not react to a manually set state, the drill is inconclusive, not a failed rollback. Fall back to a deliberately failing build with synthetic traffic only if you decide it is worth it.

**Alternatives considered**

| Alternative | Why not |
|-------------|---------|
| Drop the integration from the spec and let SAM generate it from `McpV1Post` | Tested: with an explicit `DefinitionBody`, SAM adds nothing. Also removes the visible integration the repo's steering expects on every path |
| Alias only in PROD (`Fn::If` in the included spec, or a stage variable) | Adds conditional logic inside an included OpenAPI body for no gain, and leaves `test` unable to prove the production path (Decision 1) |
| Remove `AutoPublishAlias` and `DeploymentPreference` and accept `$LATEST` | Gives up the platform's PROD gradual-deployment guardrail (`AGENTS.md` section 4.1) |
| Pin the integration to a specific version number | Needs a template change per deploy and fights the alias mechanism |
| Add a PreTraffic or PostTraffic hook now | Larger change, separate benefit, see section 7 |
| Guard test as a new package under `application-infrastructure/tests/` or as a post-deploy check | Not gated by a buildspec today, or reopens the smoke-verification spec (Decision 3) |

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| Update `openapi-spec-sync.md` examples to the alias form | Include | Otherwise the next endpoint repeats the mistake | S | Low |
| Remove `ReadLambdaPermissionLive` now, `ReadLambdaPermission` in v0.0.8 | Include (Decision 2) | Least privilege, removes dead authority | S | Low |
| Record the permission-pair deviation in `openapi-spec-sync.md`, `template.yml`, and `docs/developer` | Include (Decision 7) | Keeps convention and template honest | S | Low |
| Docs, developer compatibility rule, and CHANGELOG | Include | The change alters PROD behavior and adds a constraint on release authors | S | Low |
| Guard test in `read-function/tests/unit/architecture/` | Include (Decision 3) | No guard exists today | S | Low |
| Rollback drill on `beta` | Include (Decision 4, run with go-ahead) | Rollback has never been observed | M | Low to medium |
| Fix stale `AppFunction` comment at `buildspec.yml:168` and in `update_template_timestamp.py` | Include (Decision 6) | Describes the mechanism this fix makes more important | S | None |
| Version-scoped alarms (`Resource` alias dimension, `ExecutedVersion`) for rollback | Spin off (Decision 5), separate issue | Better rollback signal, separate from the target fix; new alarms cost money | M | Low |
| Report the `${WebService.Arn}` starter pattern and the permission-pair convention upstream | Spin off (Decision 6), outside this repo | This repo does not change upstream templates or upstream-managed steering | S | None |
| Pre or post-traffic hooks for CodeDeploy | Note only | Extra validation before shifting, larger design | L | Medium |
| Alias-based widgets on the dashboard | Note only | Dashboard works on `FunctionName` today | S | Low |
| `ReadLambdaErrorsAlarm` counts thrown Lambda errors only | Note only | I did not check whether the function returns JSON-RPC errors without throwing, which would hide them from rollback | S to investigate | Low |
| Gating the `application-infrastructure/tests/` packages in a buildspec | Note only | Owned by `0-0-7-revive-postdeploy-tests`; no longer on this plan's critical path since Decision 3 uses a gated location | M | Low |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| CloudFormation expands `AWS::Include` or resolves `.Alias` differently from the local translator | Local translation of the real templates passed; the pipeline reaches `test` first and V1 plus the `get-integration` check confirm it before `beta` |
| First PROD deploy after the change is not gradual, and the alias path first carries 100% of `prod` traffic | Prove it on `test` and `beta` first; V1 gates promotion |
| Two versions serve at once for about 30 minutes, sharing unversioned cache keys and table data | Developer rule and docs (section 6, item 6); reviewers check cached payload shape changes in every release |
| Security fixes reach callers more slowly | Document `FunctionGradualDeploymentType=AllAtOnce` as the urgent-patch override |
| Reverting the URI while `ReadLambdaPermission` is gone could cause a brief invocation-error window | Keep `ReadLambdaPermission` for one release (Decision 2) |
| `ReadLambdaErrorsAlarm` is coarse, so a bad version might not trigger rollback quickly | Rollback drill (Decision 4); version-scoped alarms spun off (Decision 5) |
| Developers or AI tools add a new endpoint, or a new permission pair, from the old examples | `openapi-spec-sync.md` update plus the guard test; the permission convention is recorded per Decision 7 |
| Test location couples a function package to infrastructure files | Existing precedent in `auth-function`; the test only reads, by path |
| A deploy that skips the timestamp script leaves API callers on the old version | The script runs unconditionally in the pipeline build; documented in the developer guide. Local `sam deploy` is development only |
| The rollback drill emails the alarm recipient, fails a `beta` build, and may be inconclusive | Warn the recipient first, schedule it away from a pending `prod` promotion, treat an unreacted state change as inconclusive |
| The local copy of the upstream steering file drifts from upstream | Decision 7: the upstream-managed file is not edited |

## 9. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Q1, option A: the alias URI applies to all stages, one definition | One definition; `test` already moves its alias through CodeDeploy `AllAtOnce`, and `test` becomes the proving ground for the production path |
| 2 | Q2, option A: remove `ReadLambdaPermissionLive` now; keep `ReadLambdaPermission` for one release and remove it in v0.0.8 (tracked in `TODO.md`) | The alias grant is strictly redundant with SAM's narrower `POST /mcp/v1` grant; the unqualified grant only matters if the URI is reverted. The deviation is recorded per Decision 7 |
| 3 | Q3, option A: a gated Jest guard test in `read-function/tests/unit/architecture/` | Gated by the main buildspec today, no new dependency, and `auth-function` already reads the template the same way |
| 4 | Q4, option B: one rollback drill on `beta` using `aws cloudwatch set-alarm-state`, run only with your go-ahead, after the migration deploy | Observes rollback without shipping broken code; `beta` is a PROD environment with alarms and almost no traffic |
| 5 | Q5, option A: version-scoped rollback alarms are spun off as a separate issue | The alias fix works without it, and the drill will show whether the current alarm is good enough |
| 6 | Q6, option A: fix the stale `AppFunction` comment here; report the starter pattern (and permission convention) upstream as a spin-off outside this repo | The comment concerns the same publish-a-version mechanism; the upstream items cannot be changed here |
| 7 | Q7, option A: leave the upstream-managed `atlantis-multi-resource-src.md` untouched; record the deviation in repo-local `openapi-spec-sync.md`, a comment in `template.yml`, and `docs/developer`; include it in the upstream report | No sync conflict, and AI tools see the rule because `openapi-spec-sync.md` loads when `template.yml` is edited |

Spin-off dispositions: Decision 5 (alarms) is a separate issue in this repo. Decision 6 (upstream report, which also covers the permission convention from Decision 7) is a note for the Atlantis starter and steering owners. I have not created either. I can hand them to an issue-creation skill if you have one; none is in my available skills list.

## 10. Open questions and recommendations

No open questions. Q1 to Q7 are answered; see Decisions 1 to 7 in section 9.
