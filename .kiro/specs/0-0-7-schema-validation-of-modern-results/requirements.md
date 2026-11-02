# Requirements Document

## Introduction

**Every response the server emits is checked against the published MCP schemas, and the schemas stay current.** Nothing in this repository checks a response against the JSON Schema that MCP clients validate with. The server, its tests, the post-deploy verifier, and the verifier's fake server were all written from one reading of the specification, so the `cacheScope: "server"` defect passed every check and was found by a client.

This feature does four things, in order:

1. **Fixes defects of the same class that the schemas expose.**
   - The `-32022` error carries `declaredRevision`/`supportedVersions` where the schema requires `requested`/`supported`.
   - Both `-32022` and `-32020` are returned with HTTP 200 where the specification requires 400.
   - Errors for a request whose `id` cannot be read carry `id: null`, which no schema accepts.
   - Notifications get an error where the transport requires HTTP 202.
2. **Adds conformance tests.** Pinned copies of the published schemas are vendored. The real output of the Read Function is validated against them in the Build stage, and the fake server's output in the PostDeploy stage. Each check runs against the published schema and against a strict overlay that rejects undeclared property names.
3. **Keeps the vendored schemas current.**
   - A report-first refresh script and an `update-mcp-schemas` skill.
   - A `prepare-release` skill, started by a Kiro hook when a `CHANGELOG.md` version gets its release date.
   - A GitHub Actions workflow that returns a published release to draft when a vendored schema has drifted.
4. **Documents the two-pass release path.**

See [ISSUE.md](ISSUE.md) for the problem report and [PLAN.md](PLAN.md) for the analysis, the evidence, and the locked decisions. Every planning question is answered and the plan is locked.

### Guiding constraints

1. **Fix first, then guard.** The protocol fixes (Requirements 1 to 4, 24, and 25) land before the conformance tests, so every test passes when it is added. Requirements 24 and 25 are numbered last only because they were decided after the others.
2. **The guard must not trust the server's own reading.** Allowed values come from the vendored published schemas, never from Read Function code. The verifier and its fake server import nothing from Lambda code.
3. **Pinned and reproducible.** The vendored schemas are byte-exact copies from one upstream commit, with recorded sha256 values. Tests read no network.
4. **No infrastructure change.** No `template.yml`, `template-openapi-spec.yml`, parameter, IAM, KMS, buildspec, or CodePipeline change. The only Lambda change is the error fix in the Read Function router.
5. **No production dependency.** New packages are development dependencies only. The verifier stays dependency-free CommonJS.
6. **Existing conventions.** Atlantis naming, `>!` security-comment notation, the documentation and changelog steering, CommonJS `*.test.js` in Lambda packages, ESM `*.jest.mjs` in `tests/postdeploy-verify`, and Python standard library scripts with `unittest` tests in `build-scripts/`.
7. **The release path is two passes.** The release date is edited only on `dev`, and the prepare pass carries only `CHANGELOG.md`, package, layer, and vendored-schema updates through every stage.

### Decisions carried forward from PLAN.md

| # | Decision | Requirement |
|---|----------|-------------|
| Q1 | Validate every shape the server emits on `2024-11-05`, `2025-11-25`, and `2026-07-28` | 9 |
| Q2 | Read Function tests validate real output in Build; Verifier tests validate the fake in PostDeploy; the Verifier stays dependency-free | 9, 11 |
| Q3 | Guard test, documented refresh, and a report-first refresh script | 10, 13 |
| Q4 | Dead tests and audit gaps go to `.kiro/specs/0-0-8-prune-tests-and-ensure-automation/` | 23 |
| Q5 | Docs and an `update-mcp-schemas` skill; a GitHub workflow that fails the release; a local trigger that runs the four update skills | 14 to 17 |
| Q6 | The `-32022`/`-32020` fix is part of this spec and is done first, with the specification's key names only | 1 to 4 |
| Q7 | A failed release gate returns the release to draft | 17 |
| Q8 | A `UserPromptSubmit` command hook runs a read-only detection script | 15 |
| Q9 | `prepare-release` applies updates on `dev` and commits nothing; the prepare pass carries only `CHANGELOG.md`, package, and layer updates | 16, 18 |
| Q10 | Leave `id` out of an error whose request id is unknown; reject an invalid `id` with `-32600` (D23); the 401 body too (D24) | 24 |
| Q11 | Notifications get HTTP 202 with no body | 25 |
| U1 | A strict overlay rejects undeclared property names, alongside the published-schema check | 7, 9 |
| U2 | Document the two-pass release path | 18 |
| D1 to D22 | See PLAN.md Section 6.6 | Cited where they apply |

### Additions beyond PLAN.md

These are small refinements made while writing the requirements. Strike any you disagree with.

- **Changelog convention conflict (needs your attention).** PLAN step 0.6 corrects the existing v0.0.7 `-32022` text in place, following the cacheScope spec's Q5. `.kiro/steering/changelog-convention.md` says existing changelog text is never updated. Requirement 21.1 limits the in-place edit to the words that state the old field names. To follow the convention strictly, strike 21.1 and keep only the Fixed entry.
- **The edge checks X2.3 and X2.4 also expect HTTP 400** (Requirement 3.4). The plan's first pass listed only P4. PLAN.md is corrected.
- **A 400 passes through CloudFront unchanged, by configuration.** On 2026-11-01, the deployed `test`, `beta`, and `prod` distributions were checked read-only.
  - Their custom error responses cover only 403 and 404.
  - The `/mcp/*` behavior uses `Managed-CachingDisabled`, caches only GET and HEAD, and has no edge functions.
  - No 400 can be provoked through the edge before the fix ships, so Requirement 22.4 uses X2.3 and X2.4 on `beta` as the first live proof.
- **The hook has a 5-second timeout**, and the detection script gives up and prints nothing if `git` takes longer than 2 seconds (Requirement 15.6).
- **`prepare-release` and `update-mcp-schemas` are added after the uncommitted skill renames in `.kiro/skills/` are committed** (Requirement 16.9), so the new folders and the `README.md` edit do not collide with that work.
- **The release gate withdraws a release only for real drift** (Requirement 17.3, 17.4, added while writing design.md). If a unit test fails, or upstream cannot be reached, the run goes red but the release stays published. Without this, a GitHub outage would withdraw a good release.
- **An invalid request `id` is rejected** (Requirement 24.3, PLAN D23). This follows from Q10 and Q11. A message with no `id` member is a notification. A message whose `id` is not a string or an integer violates "Requests MUST include a string or integer ID" (`2025-11-25`, `2026-07-28`), and gets `-32600` instead of a result with `id: null`.
- **The 401 invalid-key body also leaves out `id`** (Requirement 24.4, PLAN D24). The Verifier's S1 checks only the status.
- **The Python unit tests run with `python3 -m unittest`**, which is how `test_write_release_version.py` runs today (16 tests pass).

## Glossary

- **System**: This feature as a whole: the error fix, the tests, the vendored schemas, the scripts, the skills, the hook, the workflow, the documentation, and the changelog entries.
- **Read Function**: The Lambda function `ReadLambdaFunction`, which serves `POST /mcp/v1`. Source: `application-infrastructure/src/lambda/read-function`.
- **Router**: `utils/json-rpc-router.js` in the Read Function.
- **Protocol Module**: `utils/mcp-protocol.js` in the Read Function.
- **Revisions**: The three protocol revisions the server advertises: `2024-11-05` and `2025-11-25` (legacy era) and `2026-07-28` (modern era).
- **Published schema**: The JSON Schema file `schema/<revision>/schema.json` in `modelcontextprotocol/modelcontextprotocol` on GitHub. `2025-11-25` and `2026-07-28` are draft 2020-12; `2024-11-05` is draft-07.
- **Vendored schemas**: The pinned copies at `application-infrastructure/tests/mcp-schemas/<revision>/schema.json`.
- **Provenance file**: `application-infrastructure/tests/mcp-schemas/PROVENANCE.md`.
- **Pinned commit**: The upstream commit SHA all three vendored schemas were copied from.
- **Validator helper**: The test helper that loads a vendored schema and validates a value against one of its definitions. One exists in each test package.
- **Strict overlay**: An in-memory copy of a vendored schema, built by the validator helper, that rejects property names the schema does not declare.
- **Open list**: The single exported constant that names the properties and definitions the strict overlay leaves open.
- **Semantic change**: A difference between a vendored schema and an upstream file that remains after removing string-valued `description` and `$comment` annotations.
- **Text-only change**: A difference that disappears when those annotations are removed.
- **Verifier**: `application-infrastructure/postdeploy-scripts/verify-deployment.js`, run by `05-verify-deployment.sh` in the PostDeploy build.
- **Fake server**: `application-infrastructure/tests/postdeploy-verify/helpers/fake-mcp-server.mjs`.
- **Verifier tests**: The Jest package at `application-infrastructure/tests/postdeploy-verify`.
- **Sub-check**: A Verifier assertion with a stable ID such as `P3.1`. The catalog holds 45: 36 core and 9 advisory.
- **Refresh script**: `application-infrastructure/build-scripts/refresh_mcp_schemas.py`.
- **Detection script**: `application-infrastructure/build-scripts/detect_release_transition.py`.
- **Release transition**: The state in which the first `## [vX.Y.Z]` header of the working-tree `CHANGELOG.md` carries a `(YYYY-MM-DD)` date, while the header for the same version at `HEAD` carries `(unreleased)`.
- **Update skills**: `audit-update-npm-packages`, `audit-update-python-packages`, `update-lambda-layers`, and `update-mcp-schemas` (D15).
- **Verify pass**: Feature work promoted `dev → test → beta → main` until every stage's checks pass.
- **Prepare pass**: The release-date edit made on `dev`, with only allowed updates, promoted through every stage again.
- **Prepare-pass allow-list**: The files a prepare pass may change (D20, Requirement 16.4).
- **Release gate**: `.github/workflows/release-gate.yml`.
- **Smoke spec**: `.kiro/specs/0-0-7-postdeploy-smoke-verification`.
- **Dual-era spec**: `.kiro/specs/0-0-7-mcp-protocol-dual-era`.

## Requirements

### Requirement 1: Specification-conformant `-32022` and `-32020` errors

**User Story:** As the user of a client that follows the published schema, I want protocol errors in the shape and status the specification defines, so that my client can read the supported revisions and retry.

#### Acceptance Criteria

1. WHEN the Router rejects a request with `-32022`, THE error's `data` SHALL be exactly `{ requested, supported }`. `requested` is the revision the request declared, and `supported` is the advertised `SUPPORTED_PROTOCOL_VERSIONS` list, in order.
2. THE `-32022` error SHALL NOT carry `declaredRevision` or `supportedVersions`.
3. WHEN the Router returns `-32022`, THE HTTP status SHALL be 400, in both eras and whether the revision was declared in the `MCP-Protocol-Version` header or in `_meta`.
4. WHEN the Router returns `-32020`, THE HTTP status SHALL be 400. THE error's `code`, `message`, and `data` (`detail`, `headerValue`, `bodyValue`) SHALL be unchanged.
5. THE status for every other JSON-RPC error and for every result SHALL be unchanged.
6. `server/discover` SHALL remain answerable for an unlisted declared revision, with HTTP 200.
7. THE code that builds the `-32022` error SHALL carry a `>!` comment citing `UnsupportedProtocolVersionError` in the `2026-07-28` schema. THE code that sets the 400 status SHALL carry a comment citing the definitions' HTTP rule.
8. `utils/mcp-era.js` SHALL keep building the `-32020` error object. THE Router SHALL own the status.
9. `negotiateProtocol()` and its return shape SHALL NOT change; only the error the Router builds from it changes.
10. THE behavior that decides when `-32022` and `-32020` are returned (which methods, which eras, case-insensitive header names, blank declarations) SHALL NOT change.

### Requirement 2: Read Function tests for the error fix

**User Story:** As a maintainer, I want the Read Function's tests to assert the specification's error shape and status, so that the old shape cannot return.

#### Acceptance Criteria

1. `tests/integration/mcp-protocol-unsupported-version.test.js` SHALL assert `error.data.requested`, `error.data.supported`, and HTTP 400, and SHALL assert that `declaredRevision` and `supportedVersions` are absent from `error.data`.
2. THE tests that assert the status of a `-32020` response, including `tests/integration/mcp-protocol-header-validation.test.js`, SHALL expect 400. Assertions of 200 for accepted requests in the same files SHALL stay.
3. ANY other Read Function test that pins HTTP 200 or the old key names for `-32022` or `-32020` SHALL be updated. Tests that read `supportedVersions` from a `server/discover` result SHALL NOT change.
4. THE test suite SHALL include a test that a `-32022` answer for an `initialize` request with an unlisted header revision has HTTP 400 and the new keys.
5. THE test suite SHALL include a test that `server/discover` with an unlisted declared revision returns HTTP 200 and no error.

### Requirement 3: Verifier checks for the error fix

**User Story:** As an operator, I want the post-deploy stage to fail when a deployed server returns the old error shape or status, so that the pipeline, not a client, finds it.

#### Acceptance Criteria

1. P3.1 and P3.2 SHALL pass only WHEN the response has HTTP 400, `error.code` `-32022`, and `error.data.requested` equal to `2099-01-01`.
2. P3.3 SHALL compare `error.data.supported` of both responses with P1's `supportedVersions`, in the same order.
3. P4.1, P4.2, and P4.4 SHALL pass only WHEN the response has HTTP 400 and the `-32020` conditions they check today. P4.3 and P4.5 SHALL keep expecting HTTP 200.
4. X2.3 and X2.4 SHALL expect HTTP 400 with `-32020`.
5. THE expected status SHALL be set per exchange through the existing `gateExchange` expectation, so that a wrong status fails with the existing `HTTP <n>, expected 400` reason form.
6. THE failure reasons for a missing or wrong `requested` or `supported` SHALL name the field and the observed value, using the Verifier's existing value formatting and secret redaction.
7. THE key names and the 400 rule SHALL be restated in the Verifier, with a comment citing the published schema. They SHALL NOT be imported from Lambda code.
8. THE catalog SHALL stay at 45 sub-checks, 36 core and 9 advisory. THE System SHALL NOT add, rename, renumber, or reuse a sub-check ID, and SHALL NOT change the report format, the `VERIFY_REPORT` line, or the number of requests.
9. THE JSDoc of `checkP3`, `checkP4`, and the X2 check SHALL describe the new conditions; the text `error.data.declaredRevision` SHALL no longer appear in `verify-deployment.js`.

### Requirement 4: Fake server and Verifier tests for the error fix

**User Story:** As a maintainer, I want the fake server to model a conformant server and the Verifier tests to prove the Verifier catches the old shape, so that the guard is itself guarded.

#### Acceptance Criteria

1. THE Fake server SHALL return `-32022` with `data: { requested, supported }` and HTTP 400, and `-32020` with HTTP 400, on both the raw and edge targets.
2. THE Fake server SHALL define these values itself and SHALL import nothing from the Read Function.
3. `fake-mcp-server-tests.jest.mjs` SHALL assert the new keys and status, and SHALL no longer pin `declaredRevision`, `supportedVersions`, or 200 for these errors.
4. `checks-tests.jest.mjs` SHALL include failure cases for: a `-32022` answer with HTTP 200 (P3.1); a `-32022` answer that carries `declaredRevision` instead of `requested` (P3.1); a `-32022` answer whose `supported` is in another order (P3.3, replacing the current `supportedVersions` case); a `-32020` answer with HTTP 200 (P4.1); and an edge `-32020` answer with HTTP 200 (X2.3).
5. EACH failure case SHALL assert the reason text and that only the intended sub-check fails.
6. `EXPECTED_SUB_CHECK_IDS` SHALL stay at the same 45 IDs.

### Requirement 5: Vendored schemas and provenance

**User Story:** As a maintainer, I want byte-exact, pinned copies of the published schemas in the repository, so that tests are reproducible and offline, and a change to them is deliberate.

#### Acceptance Criteria

1. THE System SHALL add `application-infrastructure/tests/mcp-schemas/<revision>/schema.json` for `2024-11-05`, `2025-11-25`, and `2026-07-28`. All three SHALL be byte-identical to the upstream files at one Pinned commit (D1, D2, D4).
2. THE Provenance file SHALL record:
   - the source repository and path template;
   - the full 40-character Pinned commit SHA;
   - the retrieval date;
   - the sha256 of each vendored file;
   - the upstream license notice, including its MIT-to-Apache-2.0 transition statement, and attribution.
3. THE vendored files SHALL NOT be edited by hand. Only the Refresh script's write mode changes them.
4. THE directory SHALL be outside `application-infrastructure/src/` and SHALL NOT be packaged into any Lambda function or layer.
5. THE Provenance file SHALL state that the files are test data used to check this server's responses and are never deployed.

### Requirement 6: Validator helpers

**User Story:** As a test author, I want one call to validate a value against a named schema definition, so that each test states what it checks and a mistake in wiring cannot pass silently.

#### Acceptance Criteria

1. THE System SHALL add `read-function/tests/helpers/mcp-schema-validator.js` (CommonJS) and `tests/postdeploy-verify/helpers/mcp-schema-validator.mjs` (ESM), each reading the one Vendored-schemas directory (D12).
2. EACH helper SHALL export `validate(revision, definitionName, value)` and `validateStrict(revision, definitionName, value)`. Each returns `{ valid, errors }`, where each error gives the instance path and the message.
3. EACH helper SHALL use `ajv` 8 with `Ajv2020` for draft 2020-12 schemas and the draft-07 `Ajv` for `2024-11-05`. It SHALL set `allErrors: true` and `allowUnionTypes: true`, add `ajv-formats`, and keep `ajv` strict mode on (D3).
4. EACH helper SHALL throw WHEN the revision has no vendored schema or the definition name does not exist in it (D6).
5. EACH helper SHALL compile each schema and overlay at most once per module and reuse the compiled validators.
6. EACH helper SHALL read only local files and SHALL make no network request.
7. EACH helper SHALL locate definitions under `$defs` for 2020-12 schemas and under `definitions` for draft-07 schemas.

### Requirement 7: Strict overlay

**User Story:** As a maintainer, I want a misspelled or undeclared property name in a response to fail a test, so that a field a client would ignore or misread is caught.

#### Acceptance Criteria

1. `validateStrict` SHALL validate against a Strict overlay built in memory from the vendored file. THE vendored file on disk SHALL NOT change (D13).
2. THE overlay SHALL close every object schema that declares `properties` and sets neither `additionalProperties` nor `unevaluatedProperties`. It SHALL use `unevaluatedProperties: false` in draft 2020-12 schemas and `additionalProperties: false` in the draft-07 schema.
3. THE overlay SHALL leave open:
   - the subtrees under properties named `inputSchema`, `outputSchema`, `structuredContent`, `experimental`, and `extensions`;
   - the definitions `Result` and `JSONObject`;
   - every object that already sets `additionalProperties` or `unevaluatedProperties`.
4. THE overlay SHALL NOT close a member of an `allOf`, or a definition referenced from an `allOf` member. It SHALL close the schema that holds the `allOf`, and add `type: "object"` there when it is absent.
5. THE overlay builder SHALL throw WHEN a draft-07 schema contains `allOf`, rather than closing it.
6. THE Open list SHALL be one exported constant in each helper. Adding an entry is the only way to admit an extension property.
7. `_meta` objects SHALL be closed (D14).
8. THE overlay SHALL only add keywords. Every value that passes `validateStrict` SHALL also pass `validate`.

### Requirement 8: Definitions used for each response

**User Story:** As a test author, I want each response checked against the definition that constrains it most, so that loose wrapper types do not hide a violation.

#### Acceptance Criteria

1. `tools/list` and `server/discover` responses SHALL be validated against `ListToolsResultResponse` and `DiscoverResultResponse` WHERE the revision defines them. Otherwise the result SHALL be validated against `ListToolsResult`, and the envelope (`jsonrpc` `"2.0"`, the request's `id`) SHALL be checked by hand.
2. `initialize` results on the legacy revisions SHALL be validated against `InitializeResult`, with the envelope checked by hand.
3. `tools/call` results SHALL be validated against `CallToolResult` directly. `CallToolResultResponse` SHALL NOT be used (D7).
4. On `2026-07-28`, `-32022` and `-32020` responses SHALL be validated against `UnsupportedProtocolVersionError` and `HeaderMismatchError`.
5. Other errors SHALL be validated against `JSONRPCErrorResponse` on `2026-07-28` and `2025-11-25`, and against `JSONRPCError` on `2024-11-05`.
6. A request that declares no revision SHALL be validated against the `2024-11-05` schema, the revision the server answers it under.

### Requirement 9: Read Function conformance tests

**User Story:** As a maintainer, I want the server's real output validated in the Build stage, so that a change that breaks the published contract fails before deployment.

#### Acceptance Criteria

1. THE System SHALL add `tests/integration/mcp-protocol-schema-conformance.test.js` to the Read Function. It drives `handleJsonRpc` with the real tool catalog and validates each parsed response body with both `validate` and `validateStrict`.
2. THE test SHALL cover, for each of the three Revisions and for a request that declares no revision:
   - `tools/list`;
   - `tools/call` for at least one tool whose controller can be stubbed without AWS access;
   - `initialize` on the legacy revisions;
   - `server/discover` on `2026-07-28`.
3. THE test SHALL cover the errors `-32700`, `-32600`, `-32601`, `-32602`, `-32603`, `-32020`, and `-32022`, each produced through the Router. Codes the Router does not emit, such as `-32021`, are out of scope. Errors without `id` (Requirement 24) SHALL be validated against `2025-11-25` and `2026-07-28` only. The test SHALL name `2024-11-05` as an exception for them, with a comment that its `JSONRPCError` requires an `id`, and none can exist when the request's `id` could not be read.
4. FOR `-32020` and `-32022`, THE test SHALL assert HTTP 400 and cite the definitions' HTTP rule in a comment.
5. THE `tools/list` cases SHALL use the catalog the Router builds for that revision, so that `Tool.title` and `Tool.annotations` are validated on `2025-11-25` and `2026-07-28`.
6. A failing case SHALL report which check failed (published or strict), the revision, the definition, and each error's instance path and message.
7. THE test SHALL read no network or AWS resource, and SHALL NOT spawn a test suite.

### Requirement 10: Negative controls and guards

**User Story:** As a maintainer, I want proof that the conformance checks can fail, so that a passing run means something.

#### Acceptance Criteria

1. THE Read Function suite SHALL include negative controls that fail `validate`, each with the offending path in the error:
   - a modern `tools/list` with `cacheScope: "server"`;
   - a `server/discover` result without `ttlMs` and `cacheScope`;
   - a `tools/call` result without `content`;
   - a `-32022` error carrying `declaredRevision`/`supportedVersions` instead of `requested`/`supported`.
2. THE suite SHALL include negative controls that pass `validate` and fail `validateStrict`, each naming the undeclared property: a misspelled property in a result (`nextcursor`), a Tool (`titel`), ToolAnnotations (`readOnly`), `_meta` (`io.modelcontextprotocol/serverinfo`), server capabilities (`listchanged`), serverInfo (`verison`), a text content block (`txt`), and an error object (`mesage`). A `title` on a `2024-11-05` Tool also fails, since that revision does not declare one.
3. THE suite SHALL include a positive control: extra JSON Schema keywords inside a tool's `inputSchema` pass `validateStrict`.
4. THE suite SHALL include tests that the helper throws on an unknown definition name and on an unknown revision.
5. THE suite SHALL include a test that the overlay builder throws on a synthetic draft-07 schema containing `allOf`.
6. THE suite SHALL include a test that each vendored file's sha256 equals the value in the Provenance file (D8).
7. THE suite SHALL include a test that every entry of `SUPPORTED_PROTOCOL_VERSIONS` has a vendored schema.

### Requirement 11: Fake-server conformance tests

**User Story:** As a maintainer, I want the fake server's answers validated against the same schemas, so that the model the Verifier is tested against cannot drift from the contract.

#### Acceptance Criteria

1. THE System SHALL add `fake-mcp-server-schema-conformance.jest.mjs` to the Verifier tests. It validates, with both `validate` and `validateStrict`, the Fake server's answers for every request kind the Fake server models, per Requirement 8.
2. THE test SHALL start the Fake server in-process as the existing Verifier tests do, and SHALL read no network beyond the loopback interface.
3. THE Verifier SHALL NOT gain a dependency and SHALL NOT read the vendored schemas.

### Requirement 12: Dependencies

**User Story:** As a maintainer, I want the new validator to be a development dependency only, so that nothing new is deployed.

#### Acceptance Criteria

1. THE Read Function SHALL add `ajv` and `ajv-formats` as `devDependencies` with caret ranges, at `^8.20.0` and `^3.0.1`, and SHALL commit the updated `package-lock.json`.
2. THE Verifier tests SHALL add `ajv` `8.20.0` and `ajv-formats` `3.0.1` as exact-pinned `devDependencies`, and SHALL commit the updated `package-lock.json`.
3. THE production dependency set of every Lambda function and layer SHALL be unchanged.
4. `npm run lint` in the Read Function SHALL pass after the install. `eslint` keeps its own `ajv` 6.

### Requirement 13: Refresh script

**User Story:** As a maintainer, I want one command that tells me whether the vendored schemas are out of date and can update them on request, so that keeping them current is a routine step.

#### Acceptance Criteria

1. THE System SHALL add the Refresh script, using only the Python standard library and no shell.
2. **Report mode.** By default, THE script SHALL compare each vendored schema with the upstream file at a given ref (default `main`, overridable with `--ref`). For each revision it SHALL report `unchanged`, `text-only change`, or `semantic change`. It SHALL list upstream revision directories that are not vendored, ignoring `draft` and any directory not shaped like a date.
3. **Exit codes.** THE script SHALL exit 1 WHEN any vendored revision has a Semantic change. It SHALL exit 0 with a warning line for a Text-only change or a new upstream revision, and exit 0 when nothing differs (D17). It SHALL exit 2 on a usage or input error, and exit 3 when upstream cannot be reached or answers with a rate-limit response, reported as such and never as drift.
4. **Write mode.** `--write --commit <sha>` SHALL download the three files from that commit, replace the vendored files, and rewrite the Provenance file's commit, date, and sha256 values. It SHALL NOT change any other file, and SHALL NOT change `SUPPORTED_PROTOCOL_VERSIONS`.
5. **Input validation.** THE script SHALL accept only a 40-character lowercase hexadecimal commit SHA for `--commit`, and a ref matching an allow-list pattern for `--ref`. Revision names SHALL come from the vendored directory names and the upstream listing, each matching `^\d{4}-\d{2}-\d{2}$`. URLs SHALL be built from fixed templates.
6. **Network.** THE script SHALL use `GITHUB_TOKEN` from the environment, WHEN set, for GitHub API requests, and SHALL never print it. It SHALL set a timeout on every request.
7. **Report output.** THE report SHALL be plain text, one line per revision. With `--summary-file <path>`, it SHALL also write a Markdown table for a GitHub step summary.
8. THE System SHALL add `build-scripts/test_refresh_mcp_schemas.py` (`unittest`). It replaces the fetch function with a fake and covers each report outcome, each exit code, write mode, and the rejection of an invalid SHA and ref.

### Requirement 14: `update-mcp-schemas` skill

**User Story:** As a maintainer, I want to ask Kiro to update the MCP schemas and have it run the script, apply the update, and test it, so that I do not have to remember the steps.

#### Acceptance Criteria

1. THE System SHALL add `.kiro/skills/update-mcp-schemas/SKILL.md`, with `name: update-mcp-schemas` and a `description` written as activation triggers (update, refresh, or check the vendored MCP schemas), modeled on `update-lambda-layers`.
2. THE skill SHALL run the Refresh script in report mode and summarize the result.
3. WHEN there is a Semantic or Text-only change, THE skill SHALL run write mode against the upstream commit for the ref it compared. It SHALL then run the Read Function suite and the Verifier tests, and report what changed and whether the tests pass.
4. THE skill SHALL NOT commit, and SHALL NOT change `SUPPORTED_PROTOCOL_VERSIONS`. WHEN a new upstream revision is reported, THE skill SHALL say that advertising it is a separate code change.
5. THE skill SHALL be listed in `.kiro/skills/README.md` as project-specific and not for publishing as an agent asset (D16).

### Requirement 15: Release-transition detection and hook

**User Story:** As the release maintainer, I want Kiro to notice when I date a version on `dev` and offer to run the release preparation, so that the update checks are not forgotten.

#### Acceptance Criteria

1. THE System SHALL add the Detection script and a `unittest` test for it, using only the Python standard library.
2. THE script SHALL read the working-tree `CHANGELOG.md`, `git show HEAD:CHANGELOG.md`, and the current branch name. `git` SHALL be invoked through `subprocess.run` with an argument list and `shell=False`.
3. WHEN the Release transition is present and the branch is `dev`, THE script SHALL print one fixed instruction to run the `prepare-release` skill.
4. WHEN the Release transition is present on any other branch, THE script SHALL print one fixed notice that the release path dates the version on `dev`, and SHALL NOT mention `prepare-release` (D19).
5. IN every other case, THE script SHALL print nothing. This includes: no transition; a missing or unreadable `CHANGELOG.md`; not a git repository; `HEAD` without `CHANGELOG.md`; and any error.
6. THE script SHALL exit 0 in every case. Each `git` call SHALL have a 2-second timeout.
7. THE script SHALL print only fixed text. It SHALL NOT print any content read from `CHANGELOG.md` or from `git` (D18).
8. THE System SHALL register a Kiro hook with trigger `UserPromptSubmit`, a `command` action that runs the script from the repository root, and a 5-second timeout. The hook SHALL be created with Kiro's hook tooling, which writes `.kiro/hooks/<id>.json`.
9. THE script's test SHALL cover: each header state (`unreleased` at both, dated at both, `unreleased` at `HEAD` and dated in the working tree); each branch case; and each failure case of 15.5.

### Requirement 16: `prepare-release` skill

**User Story:** As the release maintainer, I want one procedure that applies every pending package, layer, and schema update on `dev` and tells me whether the prepare pass is clean, so that the second pass carries only allowed changes.

#### Acceptance Criteria

1. THE System SHALL add `.kiro/skills/prepare-release/SKILL.md`, with `name: prepare-release` and a `description` naming its trigger: preparing a release after the `CHANGELOG.md` version is dated on `dev`.
2. THE skill SHALL first confirm that the branch is `dev` and that the only uncommitted change is the Release transition in `CHANGELOG.md`. Otherwise it SHALL stop and list what else is changed.
3. THE skill SHALL run the Update skills in this order, each applying its updates in the working tree: `audit-update-npm-packages`, `audit-update-python-packages`, `update-lambda-layers`, `update-mcp-schemas`. It SHALL NOT commit (Q9).
4. THE skill SHALL then run every test suite the Build stage runs, the Verifier tests, and the Python unit tests. It SHALL then compare `git diff --name-only` with the Prepare-pass allow-list:
   - `CHANGELOG.md`;
   - every `package.json` and `package-lock.json` (and any future `requirements*.txt`);
   - `application-infrastructure/template.yml`, limited to the layer `Mappings` that `update-lambda-layers` edits;
   - `application-infrastructure/tests/mcp-schemas/**` (D20).
5. WHEN a changed file is outside the allow-list, or `template.yml` changes outside the layer `Mappings`, THE skill SHALL report it as a stop condition.
6. WHEN a test fails, THE skill SHALL stop. It SHALL say that the prepare pass cannot carry code changes, that `CHANGELOG.md` should be restored to `(unreleased)`, and that the fix goes through a verify pass (D21).
7. OTHERWISE THE skill SHALL summarize what each Update skill changed, and hand the commit and the promotion through `test`, `beta`, and `main` to the maintainer, linking the release-process page.
8. THE skill SHALL be listed in `.kiro/skills/README.md` as project-specific and not for publishing (D16).
9. THE two new skill folders and the `README.md` edit SHALL be made after the in-progress `automate-*` skill renames are committed.

### Requirement 17: GitHub release gate

**User Story:** As the release maintainer, I want a published GitHub release withdrawn when a vendored schema is out of date, so that a release is not published against a stale contract.

#### Acceptance Criteria

1. THE System SHALL add the Release gate, triggered on `release` with `types: [published]`. It has workflow-level `permissions: contents: read`.
2. **Job `schema-drift`** SHALL have `timeout-minutes: 10` and run on a GitHub-hosted Ubuntu runner. It SHALL:
   - check out the release tag;
   - set up Python 3;
   - run `python3 -m unittest` for `test_refresh_mcp_schemas.py` and `test_detect_release_transition.py`;
   - run the Refresh script in report mode against upstream `main`, with `GITHUB_TOKEN` in the environment and `--summary-file` pointed at `$GITHUB_STEP_SUMMARY`.
3. **Failure.** THE `schema-drift` job SHALL fail WHEN a unit test fails or the Refresh script exits non-zero. THE job SHALL expose an output `drift` that is `true` only WHEN the Refresh script exited 1 (a Semantic change).
4. **Job `withdraw-release`** SHALL have `needs: schema-drift`, `if: failure() && needs.schema-drift.outputs.drift == 'true'`, job-level `permissions: contents: write`, and `timeout-minutes: 5`. A failed unit test or an unreachable upstream (exit 3) leaves the run red without withdrawing the release.
   - It SHALL run `gh release edit "$TAG" --draft=true`, with the tag passed through `env` from `github.event.release.tag_name`.
   - It SHALL write a step summary saying that the release was returned to draft, that CodeCommit `prod` already serves this code, and that the fix is `update-mcp-schemas` on `dev` followed by a new prepare pass and publishing the release again.
5. **Hardening.** EVERY third-party action SHALL be pinned to a full commit SHA, with the version in a comment. NO `${{ }}` expression SHALL be interpolated inside a `run:` script; event values reach scripts only through `env`.
6. THE workflow SHALL NOT run the CodeBuild test suites, and SHALL NOT change the tag, `main`, or any file in the repository.
7. THE workflow file SHALL carry a header comment that states what it checks, what a failure does, and that it follows the `@63klabs/cache-data` `npm-publish.yml` trigger.

### Requirement 18: Release-process documentation

**User Story:** As a maintainer cutting a release, I want the two-pass release path written down, so that every release follows it and I know what each gate stops.

#### Acceptance Criteria

1. THE System SHALL add `docs/developer/release-process.md` (D22), linked from `docs/developer/README.md`, from `DEPLOYMENT.md` after its promotion section, and from `CONTRIBUTING.md`.
2. THE page SHALL describe the Verify pass: feature work on `dev`, merged `dev → test → beta → main`. Every stage's Build, deploy, and PostDeploy, including the smoke Verifier, must pass before preparing.
3. THE page SHALL describe the Prepare pass:
   - dating the top `CHANGELOG.md` header on `dev`;
   - the hook prompt, and running `prepare-release` by hand when the hook did not fire;
   - committing only the files on the Prepare-pass allow-list;
   - promoting through every stage again;
   - the rule that any other code change abandons the pass, restores `(unreleased)`, and starts a new Verify pass.
4. THE page SHALL describe the GitHub release: pushing `main` to the `github` remote; creating and publishing release `vX.Y.Z` against `main`; the Release gate; and what to do WHEN it returns the release to draft.
5. THE page SHALL describe starting the next cycle: adding the next `vX.Y.Z (unreleased)` header on `dev`, per `.kiro/steering/changelog-convention.md`.
6. THE page SHALL include a table of the gates (Build-stage conformance tests, PostDeploy Verifier, the hook and `prepare-release`, and the Release gate). For each, the table states what it checks and what it can and cannot stop. It SHALL state that the Release gate cannot undo a deployment.
7. THE page SHALL follow `.kiro/steering/documentation-standards-markdown.md`.

### Requirement 19: Protocol and verification documentation

**User Story:** As a developer, operator, or client author, I want the documentation to describe the error shapes, the schema checks, and their maintenance accurately, so that no page states the old values.

#### Acceptance Criteria

1. `docs/end-user/supported-protocol-revisions.md` SHALL:
   - show the `-32022` example with `requested` and `supported`;
   - replace the sentence that both errors come back with HTTP 200 with a statement that `-32022` and `-32020` return HTTP 400 and every other error returns 200;
   - keep the tip about `server/discover`.
2. `ARCHITECTURE.md` SHALL describe the `-32022` `data` keys as `requested` and `supported` and state the 400 status for both errors.
3. `docs/admin-ops/post-deploy-verification.md` and `docs/developer/post-deploy-verification.md` SHALL describe P3, P4, and X2 as expecting HTTP 400 and the new keys, with sub-check ranges and counts unchanged.
4. `docs/developer/mcp-protocol-sources.md` SHALL gain a section on:
   - the vendored schemas and the Provenance file;
   - the two checks, the overlay rules, and the Open list;
   - running the Refresh script and the `update-mcp-schemas` skill;
   - adding a revision's schema when a revision is advertised;
   - the Release gate, linking the release-process page.
5. THE documentation SHALL state that the conformance tests check this server against the published schemas only, and do not prove that a given client accepts a response.
6. THE documentation SHALL follow `.kiro/steering/documentation-standards-markdown.md`.

### Requirement 20: Spec history

**User Story:** As a maintainer reading earlier specs, I want their designs and runnable scripts to match the code, so that neither misleads or fails after the fix.

#### Acceptance Criteria

1. THE Smoke spec's `requirements.md` SHALL change Requirement 6.2 to HTTP 400 with `error.data.requested` and `error.data.supported`, and SHALL state HTTP 400 for the `-32020` expectations in Requirements 6.3 and 9.6.
2. THE Smoke spec's `design.md` SHALL change the P3.1 to P3.3, P4.1, P4.2, P4.4, X2.3, and X2.4 rows to match Requirement 3.
3. THE Dual-era spec's `design.md` SHALL describe the `-32022` `data` keys as `requested` and `supported`, and the 400 status, with a one-line note dated 2026-11-01 naming this spec.
4. THE Dual-era spec's `TODO-MANUAL-VERIFY.md` SHALL:
   - change the section D checks to `requested` and `supported`;
   - change D3 to expect HTTP 400, removing the "JSON-RPC convention for this server" wording;
   - add a status check expecting 400 to the section E mismatch cases.
5. THE Smoke spec's `tasks.md` and the Dual-era spec's `tasks.md` and `requirements.md` SHALL NOT be edited.

### Requirement 21: Changelog

**User Story:** As a release manager, I want the release notes to describe what ships, so that no note documents the old error shape.

#### Acceptance Criteria

1. IN the existing v0.0.7 Added bullet that describes `-32022`, THE words that state the `data` contents SHALL be corrected in place to name `requested` and `supported`. No other existing text SHALL change. (See "Additions beyond PLAN.md".)
2. THE System SHALL add an entry under **Fixed** in `[v0.0.7] (unreleased)`, linked as `[Spec: 0-0-7-schema-validation-of-modern-results](../.kiro/specs/0-0-7-schema-validation-of-modern-results/)`. It SHALL state that:
   - `-32022` now carries `requested` and `supported`, as the published schema requires;
   - `-32022` and `-32020` now return HTTP 400, as the specification requires;
   - an error whose request id is unknown no longer carries `id: null`, and a request with an invalid `id` gets `-32600`;
   - notifications get HTTP 202 with no body instead of `-32601`;
   - the post-deploy Verifier checks the `-32022` and `-32020` changes.
3. THE System SHALL add an entry under **Added** in `[v0.0.7] (unreleased)`, linked to this spec. It SHALL cover:
   - schema conformance tests against pinned copies of the three published schemas, with a strict check for undeclared property names;
   - the refresh script and the `update-mcp-schemas` skill;
   - the `prepare-release` skill and its hook;
   - the GitHub release gate;
   - the release-process page.
4. THE entries SHALL follow `.kiro/steering/changelog-convention.md` and the formatting of the neighbouring v0.0.7 entries, and SHALL change no released version's section.

### Requirement 22: Verification and rollout

**User Story:** As an operator, I want the change proven locally and on `test` before it is promoted, so that the first client to see the new status is not a user.

#### Acceptance Criteria

1. BEFORE the change is committed, THE implementer SHALL run these and record that each passes:
   - `npx jest` and `npm run lint` in the Read Function;
   - `npm test` in the Verifier tests, which calls the Jest binary directly;
   - `python3 -m unittest` for both new Python tests and `test_write_release_version.py`;
   - one report-mode run of the Refresh script against upstream;
   - the Detection script against a scratch git repository in each header state, on `dev` and on another branch.
2. THE implementer SHALL record the Read Function suite's run time before and after the change.
3. THE change SHALL reach `test` through the normal branch flow, with the error fix, the tightened Verifier, and the conformance tests in the same promotion.
4. WHEN the change is deployed to `test`, THE PostDeploy stage SHALL pass, which shows the deployed `-32022` and `-32020` behavior. WHEN it reaches `beta`, the advisory X2.3 and X2.4 results SHALL be recorded, which shows that a 400 passes through the stage's CloudFront distribution unchanged.
5. WHEN PostDeploy on `test` passes, THE implementer SHALL connect Kiro to `test`, confirm that the tools load, and capture the client log if they do not. Because a legacy client sends `notifications/initialized` after `initialize`, this also exercises Requirement 25 with a real client.
6. THE Release gate SHALL be checked once by publishing a throwaway pre-release whose vendored file was edited, on a test tag. The implementer confirms that the run fails and the release returns to draft, then deletes the tag and release. This step needs the owner's go-ahead at that time, because the repository is public.
7. `actionlint` SHALL be run on the workflow WHERE it is available.
8. THE change SHALL NOT be promoted to `beta` until 22.4 (for `test`) and 22.5 are met.

### Requirement 23: Scope boundaries

**User Story:** As a maintainer, I want the boundaries of this change stated, so that follow-up work is not mistaken for work in this spec.

#### Acceptance Criteria

1. THE System SHALL NOT change `template.yml`, `template-openapi-spec.yml`, any CloudFormation parameter, any IAM policy, either buildspec, or the CodePipeline.
2. THE System SHALL NOT add a production dependency to any Lambda function or layer, and SHALL NOT add any dependency to the Verifier.
3. THE System SHALL NOT validate live responses inside the Verifier.
4. THE System SHALL NOT change the HTTP status of any JSON-RPC error other than `-32022` and `-32020`. Notifications (Requirement 25) are not errors.
5. THE System SHALL NOT advertise a new protocol revision.
6. THE System SHALL NOT add Python tests or `npm audit` steps to a buildspec, change `.github/dependabot.yml`, or prune tests. Those belong to `.kiro/specs/0-0-8-prune-tests-and-ensure-automation/`.
7. THE System SHALL NOT edit `ISSUE.md`, the Smoke spec's `tasks.md`, or the Dual-era spec's `tasks.md` or `requirements.md`.
8. THE System SHALL NOT commit, push, tag, or create a GitHub release, except the go-ahead step in 22.6. The owner reviews `git status` and commits.

### Requirement 24: Errors without a known request `id`

**User Story:** As the user of a client that follows the published schema, I want an error the server cannot tie to a request to have the shape the schema allows, so that my client can parse it.

#### Acceptance Criteria

1. `jsonRpcError(id, code, message, data)` in the Protocol Module SHALL leave out the `id` member WHEN `id` is `null` or `undefined`, and SHALL include it otherwise. Its JSDoc SHALL say so, and a `>!` comment SHALL cite `id?: RequestId` on `JSONRPCErrorResponse` in the `2025-11-25` and `2026-07-28` schemas.
2. THE `-32700` error for an empty or unparsable body SHALL therefore carry no `id`.
3. WHEN a request body has an `id` member whose value is not a string or an integer (`null`, an object, an array, a boolean, or a non-integer number), THE Router SHALL return `-32600` Invalid Request, with no `id`, HTTP 200, and `data.details` saying the `id` must be a string or an integer. This applies on every era and every method, `server/discover` included.
4. THE 401 invalid-key body built in `utils/auth-resolver.js` SHALL carry no `id`. THE Fake server's 401 body SHALL match.
5. `jsonRpcSuccess` SHALL NOT change. After 24.3, the Router never builds a result with a `null` id.
6. THE tests that assert a `null` `id` on an error SHALL instead assert that the `id` member is absent:
   - `tests/unit/utils/mcp-protocol-jsonrpc.test.js`;
   - `tests/unit/utils/json-rpc-router.test.js`;
   - `tests/integration/mcp-protocol-compliance.test.js`;
   - `tests/property/error-codes.property.test.js`;
   - the error half of `tests/property/json-rpc-envelope.property.test.js`;
   - the Fake server's own `-32700` test.
7. THE test in `tests/integration/mcp-protocol-discover-no-auth.test.js` that expects a result with a `null` id for an invalid id SHALL instead expect `-32600` with no `id`. Tests of `discoverResult(null)` and `jsonRpcSuccess(null, ...)` at formatter level MAY stay.
8. THE Read Function suite SHALL include Router tests for 24.3 with an `id` of `null`, an object, `true`, and `1.5`, and a test that an integer and a string `id` are still echoed.

### Requirement 25: Notifications

**User Story:** As the user of a legacy client, I want the notifications my client sends to be accepted the way the transport defines, so that the server does not answer them with an error.

#### Acceptance Criteria

1. WHEN a request body is a valid JSON-RPC 2.0 message (`jsonrpc` `"2.0"` and a string `method`) with no own `id` member, THE Router SHALL treat it as a notification.
2. AFTER the era, header, and revision checks, THE Router SHALL answer a notification with HTTP 202 and an empty body, whatever its method.
3. A notification that fails the header check SHALL still get `-32020` with HTTP 400. One that declares an unlisted revision SHALL still get `-32022` with HTTP 400. Both SHALL carry no `id` (Requirement 24).
4. A notification SHALL still be recorded in the request log through `clientRequest.addQueryLog`, as requests are today.
5. `routes/index.js` SHALL set the cache-data `Response` body to `null` WHEN the Router's body is empty, and SHALL parse it as JSON otherwise.
6. THE Read Function suite SHALL include:
   - Router tests for `notifications/initialized` (202, empty body);
   - a notification with an unknown method (202);
   - a notification with an unlisted `MCP-Protocol-Version` (400, `-32022`, no `id`);
   - a notification with a mismatched `Mcp-Method` on the modern era (400, `-32020`, no `id`);
   - a routes test for the empty-body path.
7. THE conformance test SHALL assert HTTP 202 and an empty body for `notifications/initialized` on `2024-11-05`, `2025-11-25`, and with no revision declared.
8. THE Verifier and the Fake server SHALL NOT change for this requirement. Neither sends nor models notifications, and the sub-check catalog stays at 45.
9. `ARCHITECTURE.md` and `docs/end-user/supported-protocol-revisions.md` SHALL state that notifications are accepted with HTTP 202 and no body.
