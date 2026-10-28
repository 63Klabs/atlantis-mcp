# Implementation Plan: API Gateway Live Alias

## Overview

This plan implements the changes described in [design.md](design.md) so that API Gateway invokes the Read Function through its `live` alias:

- one URI change in `application-infrastructure/template-openapi-spec.yml`
- one permission removal and one comment in `application-infrastructure/template.yml`
- a Jest guard test in `read-function`
- steering, documentation, comment, and changelog updates
- a staged rollout with recorded checks, and a one-time rollback drill

It follows the design's implementation order in three phases:

1. **Phase 1:** the code and template changes, test-first, with the local translation check. Everything here can be done and verified in the repository.
2. **Phase 2:** guidance, documentation, comments, and the changelog.
3. **Phase 3:** the staged rollout and the rollback drill. These tasks need AWS access, pipeline deploys, and (for the drill) the owner's approval. They are performed by the owner or by someone with stage credentials, not by an agent working in the repository.

Paths are relative to the repository root. "Design" and "V-A" to "V-D" refer to sections of [design.md](design.md). Requirement numbers refer to [requirements.md](requirements.md).

Run the `read-function` tests from its directory with a timeout. If `node_modules` is missing, run `npm ci --include=dev` there first:

```bash
cd application-infrastructure/src/lambda/read-function
timeout 300s npx jest tests/unit/architecture/openapi-integration-targets.test.js
timeout 600s npm test
```

Do not commit unless the owner asks. Do not edit `.kiro/steering/atlantis-multi-resource-src.md` (upstream-managed) or the "Current MCP Endpoints" list in `.kiro/steering/openapi-spec-sync.md`.

## Tasks

- [x] 1. Write the guard test and see it fail (Phase 1, red)

  - [x] 1.1 Create the test file
    - Create `application-infrastructure/src/lambda/read-function/tests/unit/architecture/openapi-integration-targets.test.js` next to `no-hardcoded-revisions.test.js`, using CommonJS, `'use strict'`, and `describe`/`it` from `@jest/globals`
    - Compute the root once as `path.resolve(__dirname, '../../../../../..')` and join `template-openapi-spec.yml` and `template.yml` onto it; fail with a clear message if either file is missing
    - Add `loadTemplate(filePath)` that parses with `js-yaml` and a schema built from a list of CloudFormation tags (`Ref`, `Sub`, `If`, `GetAtt`, `Equals`, `Not`, `FindInMap`, `Join`, `Condition`, `And`, `Or`, `Select`, `Split`, `Base64`, `ImportValue`), with a scalar, sequence, and mapping type per tag that returns the data unchanged
    - Add `collectIntegrations(spec)` returning `{ path, method, uri }` for every operation with an `x-amazon-apigateway-integration` whose `uri` is an `Fn::Sub` string, and `functionReferences(uri)` using the pattern `\$\{([A-Za-z0-9]+)\.(Arn|Alias)\}`
    - Define `ALIASED_FUNCTIONS = ['ReadLambdaFunction']` and `UNALIASED_FUNCTIONS = ['AuthLambdaFunction']` as frozen arrays
    - Implement T1 to T6 from the Design table: Read `/mcp/v1` uses `${ReadLambdaFunction.Alias}` (T1) and not `.Arn` (T2); no Auth integration uses `.Alias` (T3); every integration references exactly one function from the two lists (T4); `ReadLambdaFunction` still declares a non-empty `AutoPublishAlias` in `template.yml` (T5); at least one integration exists for each function (T6)
    - Collect violations into an array and assert on a rendered message, as `no-hardcoded-revisions.test.js` does. The T1 and T2 message states that the Read function must be invoked through its alias so CodeDeploy traffic shifting and alarm rollback apply, shows the URI found, and names `.kiro/steering/openapi-spec-sync.md` (section "Integration Targets and Lambda Permissions")
    - Add JSDoc to each helper, with `@private` where it is not exported, and a file header that names this spec and the requirements
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 1.2 Run the test against the unchanged spec and confirm T1 and T2 fail
    - Run the new test file only; it must fail on T1 and T2 and pass the rest, with the rule message showing `${ReadLambdaFunction.Arn}` as the URI found
    - If anything other than T1 and T2 fails, fix the test before continuing
    - Record the failing output in the working notes for the implementation summary
    - _Requirements: 4.3, 4.5_

- [x] 2. Move the integration to the alias (Phase 1, green)

  - [x] 2.1 Change the `/mcp/v1` integration URI
    - In `application-infrastructure/template-openapi-spec.yml`, change `${ReadLambdaFunction.Arn}` to `${ReadLambdaFunction.Alias}` in the `/mcp/v1` `post` integration, and add the three `# >!` comment lines between `uri:` and `Fn::Sub:` as shown in Design, Components 1
    - Leave the three Auth integrations on `${AuthLambdaFunction.Arn}`
    - Confirm with `git diff` that this is the only functional change in the file, and that no path, method, schema, or CORS line moved
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 2.2 Run the guard test and the whole `read-function` suite
    - The new test passes; run `npm test` in `read-function` and confirm the whole suite passes
    - _Requirements: 4.9_

  - [x] 2.3 Confirm the test can fail
    - Temporarily set the URI back to `${ReadLambdaFunction.Arn}`, run the new test, confirm T1 and T2 fail again, then restore the alias URI
    - Confirm with `git diff` that the file ends in the intended state and that nothing else changed
    - _Requirements: 4.3_

- [x] 3. Remove the redundant permission (Phase 1)

  - [x] 3.1 Edit `template.yml`
    - In the "Lambda permissions allowing API Gateway to Execute Read Lambda" block, delete `ReadLambdaPermissionLive` entirely (including its `IsProduction` condition)
    - Add the `# >!` comment block above `ReadLambdaPermission` and the "unused since the integration moved to the alias, remove in v0.0.8" comment, exactly as in Design, Components 2
    - Leave the properties of `ReadLambdaPermission`, the SAM event (`McpV1Post`), `AuthLambdaPermission`, and every other resource unchanged
    - Confirm that nothing else in the repository refers to `ReadLambdaPermissionLive` apart from specs and the changelog history: search the repository (excluding `node_modules` and `.kiro/specs`) and handle any hit
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 5.5_

  - [x] 3.2 Add the `TODO.md` entry
    - Under `## Future`, add as the first list item: `- [ ] Remove `ReadLambdaPermission` (unqualified grant) from `template.yml` - unused since 0-0-7-api-gateway-live-alias, kept one release for revert safety (v0.0.8)`
    - _Requirements: 3.4_

  - [x] 3.3 Run the other tests that read `template.yml`
    - Run `application-infrastructure/tests/postdeploy-verify` (its fake server reads the `Cors` stanza from `template.yml`) with Jest directly from that directory and a timeout, and the `auth-function` suite (its tests parse `template.yml`)
    - Both pass; if either fails, the edit disturbed something outside the permission block, so undo and redo it
    - _Requirements: 3.5, 3.6_

- [x] 4. Run the local translation check (Phase 1, V-A)

  - [x] 4.1 Translate the real templates for PROD and TEST
    - In a temporary directory outside the repository, create a virtual environment and install `aws-sam-translator` 1.115.0 and `pyyaml`
    - Follow V-A exactly: parse both files, expand the OpenAPI Spec into `WebApi`'s `DefinitionBody`, drop the dashboard include, replace `CodeUri` and `ContentUri` with `s3://bucket/key`, take parameter defaults, and translate for `DeployEnvironment` `PROD` and `TEST`
    - Confirm: the `/mcp/v1` URI contains `${ReadLambdaFunctionAliaslive}`; the Auth URIs still contain `${AuthLambdaFunction.Arn}`; `ReadLambdaFunctionMcpV1PostPermission<Stage>` targets `Ref ReadLambdaFunctionAliaslive` in both environments; `ReadLambdaPermissionLive` is absent and `ReadLambdaPermission` is present; a walk over `Ref`, `Fn::GetAtt`, `Fn::Sub`, and `DependsOn` finds no cycle
    - Delete the temporary directory, including the virtual environment and scripts. Nothing is committed
    - Write the outcome into the working notes for the implementation summary
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 5. Checkpoint: repository code and template changes
  - Run the new test, the whole `read-function` suite, `postdeploy-verify`, and the `auth-function` suite; all pass
  - Confirm `git status` shows only: the new test, `template-openapi-spec.yml`, `template.yml`, and `TODO.md`
  - Ask the owner if there are questions before Phase 2

- [x] 6. Update the repo-local steering (Phase 2)

  - [x] 6.1 Update `.kiro/steering/openapi-spec-sync.md`
    - Apply Edits A, B, and C from Design, Components 4: the alias form in the "When Adding a New API Endpoint" snippet and the "Path Definition" example, and the new "Lambda Function Reference" list that names the alias for the Read function and the unqualified ARN for the Auth function
    - Add the new section "Integration Targets and Lambda Permissions" after "Lambda Function Reference" and before "MCP Protocol Schemas", with the note about the departure from `atlantis-multi-resource-src.md` and the pointer to the guard test
    - Do not edit `.kiro/steering/atlantis-multi-resource-src.md` or the "Current MCP Endpoints" list; confirm with `git status` that only `openapi-spec-sync.md` changed under `.kiro/steering/`
    - Check that every link and path in the new text resolves
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7. Write the documentation (Phase 2)

  - [x] 7.1 Create the developer page
    - Create `docs/developer/gradual-deployment.md` following the eight-part outline in Design, Components 5.1, and add one line for it under "Guides" in `docs/developer/README.md` in the existing format
    - State the N and N+1 compatibility rule, name the shared cache table and bucket, the Users, Sessions, and DocIndex tables, and the tool and protocol responses; state that cache keys are not versioned and what to do about it; state that every pipeline build publishes a version; record the permission deviation and the removal of `ReadLambdaPermission` in v0.0.8; describe the guard test
    - Do not mention test harnesses. Use realistic, copyable examples with the language on every code fence. Follow `.kiro/steering/documentation-standards-markdown.md`
    - _Requirements: 5.5, 6.1, 6.2, 6.6, 6.7_

  - [x] 7.2 Update the admin-ops deployment README
    - In `docs/admin-ops/deployment/README.md`, add the "How a PROD deploy reaches callers" subsection after the "Deployment Flow" block, with the content list in Design, Components 5.2
    - Leave the log-stream-naming sentence marked for confirmation; it is finalised in task 15 once task 12 has observed the real naming. Put the confirmation marker in the working notes, not in the published text
    - Say that the Auth Function and the other functions deploy at once
    - _Requirements: 6.3, 6.5_

  - [x] 7.3 Document `FunctionGradualDeploymentType`
    - In `docs/admin-ops/deployment/cloudformation-parameters.md`, add the "Deployment Parameters" section after "Rate Limiting Parameters", with the parameter entry in Design, Components 5.3, in the format of the neighbouring entries. Take the allowed values directly from the `AllowedValues` list in `template.yml`, and add the heading to the "Parameter Categories" list near the top of the page
    - Confirm the claim in the entry matches `template.yml` (the default value, and that the template selects `AllAtOnce` for any `DeployEnvironment` other than `PROD` regardless of the parameter)
    - _Requirements: 6.3_

  - [x] 7.4 Update `ARCHITECTURE.md`
    - Append the sentence from Design, Components 5.4 after the existing "Production environments use CodeDeploy gradual deployment..." sentence in "Environment Strategy". Change nothing else in the file
    - _Requirements: 6.4, 6.5_

  - [x] 7.5 Check the documentation
    - Check that every relative link added in this task resolves to an existing file, and that every command shown matches the commands in Design, V-C
    - Run any documentation validation that exists in `read-function` (it ran in task 5; run it again) and confirm no new failure
    - _Requirements: 6.7_

- [x] 8. Correct the stale comments (Phase 2)

  - [x] 8.1 Edit the comments only
    - In `application-infrastructure/buildspec.yml` (line 168 area), replace the comment above the `update_template_timestamp.py` call as in Design, Components 7; leave the command unchanged
    - In `application-infrastructure/build-scripts/update_template_timestamp.py`, edit only the header comment as described in Design, Components 7; keep the author line and all code unchanged
    - Confirm with `git diff` that every changed line in both files is a comment line
    - Run `python3 -m py_compile` on the script, then run it against a temporary copy of `template.yml` and confirm it prints the same two lines as before and rewrites only `AutoPublishCodeSha256` and `VersionDescription` in the copy; delete the copy
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 9. Add the changelog entries (Phase 2)

  - [x] 9.1 Append the entries
    - In `CHANGELOG.md` under `## [v0.0.7] (unreleased)`, append the **Changed** bullet after the "Router response headers" bullet and the **Fixed** bullet after the "Server version reported to clients" bullet, as written in Design, Components 6
    - Confirm with `git diff` that only added lines appear, none of the existing text changed, and that both entries link to this spec and to the new developer page with working relative paths
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 10. Checkpoint: repository changes complete
  - Run the new test, the whole `read-function` suite, `postdeploy-verify`, and the `auth-function` suite; all pass
  - Confirm `git status` lists exactly: the new test; `template-openapi-spec.yml`; `template.yml`; `TODO.md`; `.kiro/steering/openapi-spec-sync.md`; `docs/developer/gradual-deployment.md` and `docs/developer/README.md`; `docs/admin-ops/deployment/README.md` and `cloudformation-parameters.md`; `ARCHITECTURE.md`; `application-infrastructure/buildspec.yml`; `application-infrastructure/build-scripts/update_template_timestamp.py`; `CHANGELOG.md`; and this spec directory
  - Write the implementation summary: the red and green test runs, the local translation outcome, and the list of files
  - Ask the owner whether to commit, and hand over for the Phase 3 rollout. Do not commit unless asked

- [x] 11. Record the baseline (Phase 3, read-only, before any deploy)

  - [x] 11.1 Capture the baseline for `test`, `beta`, and `prod`
    - Create `.kiro/specs/0-0-7-api-gateway-live-alias/VERIFICATION.md` from the skeleton in Design, V-C
    - For each stage, with that stage's credentials, run the `get-integration` command and the three `get-metric-statistics` calls from Design, V-C, and record the integration URI and the `Invocations` sums for the `FunctionName`, `Resource=<fn>`, and `Resource=<fn>:live` series
    - All commands are read-only. Expected: each stage's URI ends `:function:<fn>/invocations`, and the alias series is zero
    - _Requirements: 9.1, 9.4_

- [x] 12. Roll out to `test` and verify (Phase 3)

  - [x] 12.1 Deploy through the pipeline
    - Merge the repository changes to the `test` branch (the owner's normal flow) and let the pipeline deploy. Do not deploy by hand
    - Note the deploy time and the stack events for the record
    - _Requirements: 9.2_

  - [x] 12.2 Run checks 1 to 7 from Design, V-C
    - Send a few requests to the stage, then run: the integration URI check; the alias `Invocations` check and the unqualified series; the log stream naming check; the `aws deploy list-deployments` check on the stage's deployment group; the stack events ordering check; the stack status check; and read the PostDeploy build log for V1
    - Record each result in `VERIFICATION.md`, including the four open runtime items: the `AWS::Include` expansion, the CodeDeploy deployment group on `test`, the alias-then-`RestApi` ordering, and the log stream naming
    - If any check fails, stop the rollout, revert the URI line through the pipeline, and report the finding before another stage is deployed
    - _Requirements: 9.2, 9.4, 9.5_

- [x] 13. Roll out to `beta` and verify (Phase 3)

  - [x] 13.1 Deploy and check
    - Only after task 12 is clean: merge to `beta`, let the pipeline deploy, and run the same checks 1 to 7. This is the stage's migration deploy
    - Record the results in `VERIFICATION.md`, including whether the alias update finished before the `RestApi` update on a PROD stage
    - If any check fails, stop and follow the failure handling in task 12.2
    - _Requirements: 9.3, 9.4, 9.5_

- [x] 14. Roll out to `prod` and verify (Phase 3)

  - [x] 14.1 Deploy and check
    - Only after task 13 is clean: merge to `main`, let the pipeline deploy, and run the same checks 1 to 7. No drill on `prod`
    - Record the results in `VERIFICATION.md`
    - _Requirements: 9.3, 9.4, 10.2_

- [x] 15. Finalise documentation that depends on observed results (Phase 3)

  - [x] 15.1 Update the documentation from the observed results
    - Replace the log-stream-naming sentence in `docs/admin-ops/deployment/README.md` with the naming observed in task 12.2 (or remove the sentence if it was wrong)
    - If the observed ordering or CodeDeploy behavior on `test` differs from the design's reading, correct the statements that depended on it in `docs/developer/gradual-deployment.md`, the admin-ops README, and the changelog entries. Leave `PLAN.md` and `design.md` as the historical record
    - Re-run the link check from task 7.5
    - _Requirements: 6.3, 9.4_

- [x] 16. Rollback drill on `beta` (Phase 3, requires explicit approval)

  - [x] 16.1 Confirm the preconditions in writing
    - Do not start without the owner's explicit approval for the date
    - Confirm: the `AlarmNotificationEmail` recipient has been told to expect an alarm email; no `prod` promotion is pending from `beta`; the person running the drill holds `cloudwatch:SetAlarmState` and read access to CodeDeploy and CloudFormation; the drill is not the migration deploy and `beta` has already passed checks 1 to 7
    - _Requirements: 10.1, 10.2, 10.6_

  - [x] 16.2 Run the drill on the next ordinary `beta` deploy
    - After the shift starts, begin polling `server/discover` once a minute on the raw `execute-api` URL, as in Design, V-D
    - Put `ReadLambdaErrorsAlarm` into `ALARM` with `aws cloudwatch set-alarm-state` and repeat the call if the state reverts before CodeDeploy reacts, but stop when the shift ends
    - Watch the CodeDeploy deployment, the alias version, the polled versions, and the stack status
    - Judge: passed only if CodeDeploy stops and rolls back, the alias returns to the previous version, the polled responses return to the previous version, and the stack ends in `UPDATE_ROLLBACK_COMPLETE`. If CodeDeploy never reacts, record the outcome as inconclusive and do not treat it as a rollback failure
    - _Requirements: 10.3, 10.4, 10.5_

  - [x] 16.3 Restore `beta` and record the result
    - Redeploy `beta` normally so it is back on the current release, then fill in the drill rows of `VERIFICATION.md` (date, method, outcome, notes)
    - _Requirements: 10.7_

- [x] 17. Final checkpoint
  - Mark `api-gateway-live-alias` complete in `TODO.md` under `## 0-0-7` (`- [x]`) once tasks 12 to 15 are done; the drill (task 16) may follow it
  - Confirm `VERIFICATION.md` has the baseline, each stage's results, the four settled runtime items, and the drill rows (or a note that the drill is pending approval)
  - Remind the owner of the follow-ups this feature leaves: remove `ReadLambdaPermission` in v0.0.8 (tracked in `TODO.md`), and the two spin-offs that were not created (version-scoped rollback alarms as an issue in this repository, and the upstream report on the starter pattern and the permission convention)
  - Ask the owner if there are questions
