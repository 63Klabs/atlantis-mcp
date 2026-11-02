# Validate modern MCP results against the published schema

> **Status**: Locked 2026-11-01. Q6 was revised the same day so the protocol fixes are part of this spec and are done first. Q10 and Q11 were raised while writing design.md and answered A
> **Issue**: [ISSUE.md](ISSUE.md)
> **Reviewed against**: `dev` at `3658616` on 2026-11-01 (the issue was written against `65bf343`), and the upstream MCP schema files at upstream commit `d0e246ea3c69`

## 1. Summary

No test in this repository checks a server response against the JSON Schema that MCP clients validate with. The cacheScope defect passed every check because the server, its tests, the post-deploy verifier, and the verifier's fake server were all written from one reading of the specification.

The cacheScope fix has since landed and tightened the hand-written checks, so two of the issue's four "how it happens" points are now out of date (Section 2). The class of problem remains: every check is still a hand-typed expectation, and the one integration test that looks like a conformance test imports its allowed values from the server's own code.

What this spec builds:

- **Conformance tests.** Pinned copies of the three published schemas (`2024-11-05`, `2025-11-25`, `2026-07-28`) are vendored. Every response shape the server emits, on all three revisions, is validated with `ajv` 8 in the `read-function` Jest suite, and the post-deploy fake server's output is validated against the same files. Each check runs twice: against the published schema, and against a strict overlay that rejects property names the schema does not declare, so a misspelled optional field fails.
- **Keeping the schemas current.** A report-first refresh script, an `update-mcp-schemas` skill, a `prepare-release` skill started by a Kiro hook when the top `CHANGELOG.md` version gets its release date, and a GitHub Actions workflow that returns a published GitHub release to draft when a vendored schema is out of date.
- **Release path documentation.** A developer page describing the two-pass release: verify on every stage, then prepare on `dev` with only `CHANGELOG.md`, package, layer, and schema updates, and promote again before the GitHub release.
- **First, server fixes.** Running the published schemas against the server found defects of the same class as cacheScope. This spec fixes the server, the verifier, the fake server, their tests, and the docs before it adds the conformance tests that would otherwise fail (Q6, Q10, Q11, Section 6.0).
  - The `-32022` error carries `declaredRevision`/`supportedVersions` where the schema requires `requested`/`supported`.
  - `-32022` and `-32020` are returned with HTTP 200 where the specification requires 400. The post-deploy verifier asserts the wrong values.
  - Errors for an unknown request id carry `id: null`, which no schema accepts.
  - Notifications get an error instead of HTTP 202.
- **No template, IAM, or CodePipeline change.** The only Lambda change is the error fix in the Read function's router.

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Each layer asserts a hand-written expectation of `cacheScope: "server"` (integration test L80, verifier L2819, fake L691) | Partially confirmed, now stale | All three were corrected by the cacheScope spec. The integration test now asserts `CACHE_SCOPES` membership (`tests/integration/mcp-protocol-modern-required-fields.test.js:82-83`), the verifier uses `cacheHintsProblem` with `ALLOWED_CACHE_SCOPES` (`verify-deployment.js:60`, `:2832`), and the fake emits `CACHE_SCOPE = 'public'` (`fake-mcp-server.mjs:58`). The class point stands: the integration test imports `CACHE_SCOPES` from the code under test (`:21`), and the verifier and fake restate a pair typed by hand |
| 2 | The 2026-07-28 schema is machine-readable JSON Schema 2020-12 with 155 definitions; `ListToolsResult` and `DiscoverResult` required sets; `cacheScope` enum | Confirmed | Fetched 2026-11-01: `$schema` is `https://json-schema.org/draft/2020-12/schema`, 155 `$defs`, `DiscoverResult.required` = `cacheScope, capabilities, resultType, supportedVersions, ttlMs`, `ListToolsResult.required` = `cacheScope, resultType, tools, ttlMs`, enum `private, public` |
| 3 | Nothing in the repository consumes the schema | Confirmed | No `*schema*.json` file exists outside `node_modules`. The only `ajv` anywhere is 6.15.0, a transitive dependency of `eslint` |
| 4 | `ajv` 6 does not support draft 2020-12 | Confirmed by test | Loading the 2026-07-28 schema into `ajv` 6.15.0 fails: `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"` |
| 5 | The verifier is a shape check by design (Requirement 7.9) | Confirmed | `requirements.md:171`. Its only `require()` calls are `fs`, `path`, and `./settings-loader` (`verify-deployment.js:42-44`). P6.1 checks only `resultType` and `_meta` on a modern `tools/call` (`:3140`) |
| 6 | `server/discover` omitted `ttlMs` and `cacheScope` | Confirmed historically, now fixed | `discoverResult` spreads `modernCacheHints()` (`utils/mcp-protocol.js:443-453`) |
| 7 | The schema file may change because the path is on `main` | Confirmed, with evidence | The `2026-07-28` tag file is byte-identical to `main` today, but `main`'s file was edited twice on release day, and the `2025-11-25` file on `main` differs from its tag after three later commits (latest 2026-07-27). A pin must be a commit |
| 8 | A versioned package that bundles the schema may exist | Not confirmed | `@modelcontextprotocol/sdk` 1.32.2, `@modelcontextprotocol/server` 2.4.0, and `@modelcontextprotocol/core` 2.4.0 contain no `schema*.json` |
| 9 | The schema validates the JSON-RPC envelope as well as the result | Confirmed, with two caveats | (a) `CallToolResultResponse.result` is `anyOf [InputRequiredResult, CallToolResult]`, and `InputRequiredResult` requires only `resultType`, so the wrapper accepts a `tools/call` result with no `content`. (b) The modern error codes have their own definitions (`UnsupportedProtocolVersionError`, `HeaderMismatchError`) outside the `JSONRPCErrorResponse` union |
| 10 | Legacy revisions have their own schemas | Confirmed | `2025-11-25` is 2020-12 (174 KB); `2024-11-05` is draft-07 (88 KB, `definitions`) |
| 11 | Fetching at test time conflicts with the "no network in tests" convention | Confirmed | `.kiro/steering/test-execution-monitoring.md` ("Network Pollution") |
| 12 | Kiro, or the v2 SDKs, validate against this exact file | Unverifiable by reading | Not material: the schema is the published contract either way |

### 2.1 Runtime verification, and when it happens

| What | How | When | Touches live infrastructure |
|------|-----|------|-----------------------------|
| The Jest-level checks catch real violations | Negative controls in the suite (Section 6.1, step 6) | Implementation, every Build | No |
| `ajv` 8 does not disturb `eslint` | `npm run lint` and `npx jest` in `read-function` after the install | Implementation | No |
| The hook fires only on the `(unreleased)` to date transition | Run the detection script against temporary copies of `CHANGELOG.md` in each state, and once in a scratch git repository | Implementation | No |
| The deployed `-32022` and `-32020` answers carry HTTP 400 and the specification's `data` keys | Automatic: the tightened P3 and P4 sub-checks in the PostDeploy stage of each pipeline, on `test` first | Every deploy after the fix | Yes, read-only, by the pipeline |
| A legacy client still connects after the status change | Connect Kiro (or another client) to `test` once PostDeploy passes, as the cacheScope spec did | After the fix reaches `test` | Yes, test stage |
| The release gate fails on a semantic drift and returns the release to draft | One throwaway pre-release on GitHub from a test tag whose vendored file has been edited; confirm the run fails and the release becomes a draft; delete the tag and release | Implementation, with your go-ahead at that time (public repository) | Yes, GitHub only |

### 2.2 Findings beyond the issue

| # | Finding | Evidence |
|---|---------|----------|
| F1 | The `-32022` error's `data` does not match the schema. The server sends `declaredRevision` and `supportedVersions`; `UnsupportedProtocolVersionError` requires `requested` and `supported` | `json-rpc-router.js:269-279`. Fails `UnsupportedProtocolVersionError`, passes the generic `JSONRPCErrorResponse` |
| F2 | `-32022` and `-32020` are returned with HTTP 200. The definitions' descriptions require `400 Bad Request`, as do the `2025-06-18` and `2025-11-25` transport pages for an invalid or unsupported `MCP-Protocol-Version` header | `json-rpc-router.js:255`, `:269` |
| F3 | The verifier and docs encode F1 and F2: P3.1 and P3.2 assert HTTP 200 and `error.data.declaredRevision`; P3.3 asserts `error.data.supportedVersions` | `verify-deployment.js:2617-2643`; `docs/end-user/supported-protocol-revisions.md:146-151`; the v0.0.7 `CHANGELOG.md` bullet |
| F4 | `-32022` is unreleased on GitHub (new in v0.0.7) but deployed on CodeCommit `test`, `beta`, and `prod` | Added in `ab0d61d` (2026-10-09); GitHub `main` is at v0.0.6 |
| F6 | Error responses whose request `id` cannot be determined carry `id: null` (parse error, and an invalid request with a missing or invalid `id`). All three schemas reject this: `RequestId` is `string` or `integer`. `2025-11-25` and `2026-07-28` make `id` optional on `JSONRPCErrorResponse` (`id?: RequestId` in `schema.ts`). The `2025-11-25` transport page says an error that cannot be tied to a request "has no `id`". `2024-11-05` requires `id`, so it has no conformant form for these errors. JSON-RPC 2.0 itself says `null`. The two specifications disagree (Q10) | `json-rpc-router.js:215-241` (`jsonRpcError(null, ...)`); probe with `ajv` on 2026-11-01: `/id must be string,integer` on all three. Pinned by `tests/unit/utils/mcp-protocol-jsonrpc.test.js:58,126,204,289` and `json-rpc-router.test.js:249,261` |
| F7 | Notifications get a JSON-RPC error instead of HTTP 202. A message with no `id` (for example `notifications/initialized`, which legacy clients send after `initialize`) falls to the router's `default` case and gets `-32601` with `id: null` and HTTP 200. The `2025-11-25` transport says an accepted notification MUST get `202 Accepted` with no body. Connections still work today, so clients tolerate it. It does not block the conformance tests, which cover requests only (Q11) | `json-rpc-router.js:308-314`; no `notification` handling in the router or `routes/index.js`; transports page, `2025-11-25`, "Sending Messages to the Server" item 4 |
| F5 | The first pass of this plan probed the catalog with `buildToolCatalog({ revision })`; the option is `protocolVersion`, so `title` and `annotations` were not checked. Re-run correctly: all three revisions pass both the published schema and the strict overlay | Re-run in `/tmp` on 2026-11-01 |

## 3. Current state

- **Formatters.** `initializeResult`, `toolsListResult`, `toolsCallResult`, `discoverResult` in `utils/mcp-protocol.js`; the router calls them at `utils/json-rpc-router.js:291-301` and `:455-500`. Header errors come from `validateHeadersForModern` in `utils/mcp-era.js:196-224`. Every response the router builds uses HTTP 200 today (F2).
- **How a status reaches the client.** `buildResponse(statusCode, body)` (`json-rpc-router.js:139-145`) returns the status, and `routes/index.js:46-48` copies it into the cache-data `Response` unchanged. The `/mcp/v1` integration is `aws_proxy`, and `template-openapi-spec.yml:36` already declares a `400` response for it, so API Gateway passes a 400 through without template changes. `routes/index.js:78` already returns 400 for a wrong path or method.
- **Headers on a 4xx.** cache-data's `Response.finalize()` adds `Cache-Control: max-age=300` and an `Expires` header to any status of 400 or more, using `errorExpirationInSeconds` from `config/responses.js`. A 200 already gets `max-age=3600`. Neither matters for caching here: `/mcp/v1` is POST only, and CloudFront does not cache POST responses.
- **Edge error pages.** Checked read-only on the deployed distributions on 2026-11-01: `test` `E1QW1MVA4X3BSV`, `beta` `E17NYIDF8EMVG8`, and `prod` `E3RAOR5OWPIYP4`. The upstream network template (`template-network-route53-cloudfront-s3-apigw` v0.1.0) matches.
  - **Error rewrites.** Each distribution's `CustomErrorResponses` lists only 403 and 404 (rewritten to `/index.html` with 200), so a 400 is not rewritten.
  - **The `/mcp/*` behavior** uses `Managed-CachingDisabled` (TTL 0/0/0) and `Managed-AllViewerExceptHostHeader`. It caches only GET and HEAD and has no CloudFront function or Lambda@Edge association, so nothing changes a 400 on POST.
  - **Not observed end to end yet.** No 400 can be provoked through the edge today: the API has no request validator, and the Lambda's own 400 (`routes/index.js:78`) is unreachable behind API Gateway's route table. X2 runs only on stages with a custom domain, so the first live proof is X2.3 and X2.4 on `beta`.
  - **Note only.** The 403 rewrite also applies under `/mcp/*`. API Gateway's 403 for an undefined route reaches a client as `index.html` with 200. That behavior predates this spec and is unchanged by it.
- **Alarms.** No alarm or metric filter counts API Gateway 4xx responses. The Read function alarms watch Lambda `Errors` and `Duration` (`template.yml:2120-2207`), and a 400 is a successful invocation.
- **Verifier status gate.** `gateExchange(exchange, expectation)` (`verify-deployment.js:1071-1100`) takes an expected status per exchange, defaulting to 200. P3 and P4 can expect 400 without new sub-check IDs.
- **Where the old error shape is asserted.**
  - `read-function`: `tests/integration/mcp-protocol-unsupported-version.test.js` (L63-L131).
  - `postdeploy-verify`: `fake-mcp-server-tests.jest.mjs` (L336-L345, L703) and `checks-tests.jest.mjs` (L583). The fake server builds the old keys at `fake-mcp-server.mjs:665-668`.
  - Docs: `docs/end-user/supported-protocol-revisions.md:146-151` and `ARCHITECTURE.md`.
  - Spec history: the dual-era and smoke-verification `design.md` and `requirements.md`, and the dual-era `TODO-MANUAL-VERIFY.md`.
  - Tests that use `supportedVersions` on `server/discover` results are correct and unaffected.
- **Catalog.** `buildToolCatalog({ protocolVersion })` in `utils/tool-catalog.js` loads under plain `node` (17 tools) and adds `title` and `annotations` only for `2025-11-25` and `2026-07-28`. The router needs Jest (the Lambda layer path), so integration tests go through Jest.
- **Existing conformance-style tests.** `tests/integration/mcp-protocol-modern-required-fields.test.js`, `mcp-protocol-compliance.test.js`, `mcp-protocol-tools-list-fields.test.js`, and `tests/unit/utils/mcp-protocol-*.test.js` assert presence and values by hand.
- **Verifier package.** `application-infrastructure/tests/postdeploy-verify`: ESM Jest, exact-pinned dev dependencies, runs the dependency-free verifier against `helpers/fake-mcp-server.mjs`. `buildspec-postdeploy.yml` runs its tests before the post-deploy scripts.
- **Where tests run.** `read-function` tests in the pipeline Build stage, before deployment (`buildspec.yml:79-85`); verifier-package tests in PostDeploy.
- **Test layout.** `read-function`'s `jest.config.js` matches only `**/tests/**/*.test.js`. The `no-hardcoded-revisions` architecture test skips paths containing `/tests/` (`:44`).
- **Release path** (from your Q9 answer and `DEPLOYMENT.md:6-9`, `:86`). All code changes are made on `dev` and promoted by merge, `dev → test → beta → main`, each push starting that branch's CodePipeline. A release takes two passes. In the **verify pass**, the feature work goes through every stage until all checks pass. In the **prepare pass**, the `CHANGELOG.md` version is dated on `dev`, then that change goes through every stage again with nothing but package and layer updates. CodeCommit `main` is then pushed to the `github` remote, and a GitHub release is created by hand against `main` (`v0.0.6` on 2026-09-03; the dating commit was `8be3dd7`). After the release, a new `(unreleased)` header starts the next cycle (`changelog-convention.md`). No document in the repository describes the two passes today.
- **GitHub side.** Actions is enabled; the only workflows are GitHub-managed (Dependabot Updates, CodeQL). `main` is unprotected and has no rulesets. The weekly Dependabot npm run fails because its directory has no `package.json` (0-0-8 spec).
- **Precedent in `@63klabs/cache-data`.** `npm-publish.yml` runs on `release: types: [published]`, runs tests, then stages the npm publish. Its workflows use `permissions: contents: read`, `timeout-minutes`, and pass inputs through `env`.
- **Skills and hooks.** `.kiro/skills/` holds `atlantis-platform-resources`, `audit-update-npm-packages`, `audit-update-python-packages`, and `update-lambda-layers`. Its `README.md` calls the folder a staging area for published agent assets. The renames from `automate-*` are uncommitted in the working tree. No `.kiro/hooks/` exists.

## 4. Review

### 4.1 Security

- **Trust boundary.** Vendored schemas are third-party content read only by tests and the refresh script; never deployed.
- **Supply chain.** `ajv` 8.20.0 and `ajv-formats` 3.0.1 (four small transitive packages) run in CodeBuild. Lockfiles committed, exact pins in `postdeploy-verify`, no production change.
- **Integrity.** sha256 per vendored file in `PROVENANCE.md`, checked by a test.
- **GitHub workflow.** Default token `contents: read`. Only the revert job gets `contents: write`, and it runs only when the check job fails. Third-party actions are pinned by commit SHA. The tag reaches shell commands through `env`, never `${{ }}` interpolation in `run:`. `GITHUB_TOKEN` is read from the environment and never logged. `release` events require write access to raise.
- **Kiro hook.** Read-only (reads `CHANGELOG.md`, runs `git show HEAD:CHANGELOG.md` and `git rev-parse --abbrev-ref HEAD` through `subprocess.run` with `shell=False`), short timeout, prints only fixed text, never file content.
- **`prepare-release`.** It applies updates on `dev` only, commits nothing, and checks the changed-file set against an allow-list before it reports, so a release-prep pass cannot carry unrelated code changes (D20).
- **Licensing.** Upstream attribution and license text kept in `PROVENANCE.md`; you confirm it is sufficient.
- **Disclosure.** F1 and F2 are conformance defects, not vulnerabilities.
- **Error fix.** The `-32022` body echoes the client's declared revision in `data.requested`, as it does today under `declaredRevision`. It is still a JSON string inside a JSON body, so there is no new injection surface. The change does not touch authentication: `-32022` and `-32020` are decided before tool dispatch, exactly as now.

### 4.2 Software engineering

- **Validator behaviors.** `Ajv2020` for 2020-12, draft-07 `Ajv` for `2024-11-05`; `ajv-formats` and `allowUnionTypes: true` required; strict mode stays on. `getSchema` returns `undefined` for an unknown name, so the helpers throw. Compile cost about 0.1 s and 9 MB per file for all three schemas.
- **Real output today.** Every result shape passes both checks on all three revisions; `-32020` passes `HeaderMismatchError`; `-32022` fails `UnsupportedProtocolVersionError` until Section 6.0 is done.
- **Why the overlay is needed.** Almost no object definition sets `additionalProperties`, so every object accepts unknown keys.
- **Overlay rules, tested.**
  - **Close:** every object definition that declares `properties`. 2020-12 schemas get `unevaluatedProperties: false`; the draft-07 schema gets `additionalProperties: false`.
  - **Leave open:** `inputSchema`, `outputSchema`, `structuredContent`, `experimental`, `extensions`, and the `Result` and `JSONObject` definitions.
  - **`allOf`:** leave `allOf` members, and definitions referenced from them, open. Close their parent instead, and give it `type: "object"`.
  - **Draft-07:** throw on `allOf`, because draft-07 has no `unevaluatedProperties`.
  - **Results:** all real output passes. Nine misspellings fail with the property named, and extra JSON Schema keywords inside `inputSchema` still pass.
- **Fit.** CommonJS `*.test.js` in `read-function`, ESM `*.jest.mjs` in `postdeploy-verify`, Python standard library in `build-scripts/`.
- **Hooks.** A skill cannot detect a file change by itself. Kiro forwards a command hook's output to the agent only for `SessionStart`, `UserPromptSubmit`, and `PreToolUse`, hence the `UserPromptSubmit` command hook (Q8).
- **Error fix scope.**
  - **The change:** `data` becomes `{ requested, supported }` for every `-32022`, and the router returns HTTP 400 for every `-32022` and `-32020`.
  - **Scope of the status rule:** the 400 rule is stated for these definitions, and for an unsupported `MCP-Protocol-Version` on the legacy transports. So it applies on both eras for `-32022`, and on the modern era for `-32020` (the only era that sends it).
  - **Unchanged:** other JSON-RPC errors keep HTTP 200, because no definition in the three schemas states a status for them. `-32021` is defined but not emitted.
  - **No dual keys:** the old names are dropped. The error has never been in a GitHub release, and this repository's docs are its only published contract.
- **Schema refresh inside the prepare pass.** A refreshed schema can make the conformance tests fail. Fixing that needs server code, which the prepare pass does not allow. In that case the prepare pass stops and the fix goes through a normal verify pass (D21).

### 4.3 Cloud engineering

- **Topology.** No `template.yml`, IAM, KMS, parameter, or CodePipeline change in this spec. `update-lambda-layers` may change `template.yml` `Mappings` during a prepare pass; that is its existing behavior, and the pass promotes it through every stage.
- **Error fix across hops.** The Read function sets the status, API Gateway's `aws_proxy` integration passes it through (a `400` is already declared in the OpenAPI spec), and neither CloudFront hop caches POST. No alarm counts 4xx.
- **Gradual deployment.** On `beta` and `prod`, two versions answer during the CodeDeploy shift: the old one returns 200 with `declaredRevision`, the new one 400 with `requested`. PostDeploy runs after the shift finishes, so it checks only the new version. A client that hits `-32022` during the shift gets either shape. Both are well-formed JSON-RPC errors, and only the new one carries `supported`.
- **Verifier timing.** Running the tightened verifier locally against a stage still on the old build fails P3 and P4 by design, as with cacheScope. Pipeline runs verify the deployed commit.
- **What each gate stops.**
  - **Build stage:** the conformance tests block a deploy on any stage.
  - **The hook and `prepare-release`:** run on `dev` before the prepare pass is promoted.
  - **GitHub release gate:** runs after CodeCommit `prod` already serves the code. It can withdraw the public release but cannot undo a deployment. It catches upstream drift between preparation and release, and releases prepared without the hook.
- **Build cost.** About 0.2 s and 9 MB per test file with both checks. Measure suite time before and after.
- **GitHub Actions cost.** One short job per published release.
- **Rollback.** Revert the commit; deleting the workflow file from `main` disables the gate.

## 5. Gaps and observations

- **`tools/call` content.** The JSON inside `text` content blocks is not described by the schema and stays covered by existing tests only.
- **HTTP status is prose.** The 400 requirement (F2) is in definition descriptions and transport pages, so its assertion is hand-written, citing the definition.
- **New upstream revisions.** The guard requires a vendored schema only for advertised revisions; the refresh script and release gate warn on new upstream revisions (D17).
- **Python tests in CodeBuild.** The release workflow runs the refresh script's and detection script's unit tests on GitHub. No CodeBuild stage runs Python tests yet (0-0-8 spec).
- **Contradiction inside the issue:** none.

## 6. Proposed approach

Section 6.0 is done first, so that the conformance tests in 6.1 pass when they land.

### 6.0 Fix the `-32022` and `-32020` errors (Q6 = A)

0.1. **Server.**
   - `json-rpc-router.js` (`:269-279`) sends `-32022` with `data: { requested: declaredRevision, supported: decision.supportedVersions }` and HTTP 400.
   - The `-32020` return in the router (`:255`) uses HTTP 400. `mcp-era.js` keeps building the `-32020` error object; the router owns the status.
   - The `>!` comment beside the `-32022` branch cites `UnsupportedProtocolVersionError`.
0.2. **Read-function tests.** `tests/integration/mcp-protocol-unsupported-version.test.js` asserts `requested`, `supported`, and status 400. The header-validation tests (`mcp-protocol-header-validation.test.js` and the `mcp-era` unit tests, where they assert status) expect 400 for `-32020`. Any other test that pins status 200 for these two codes is updated.
0.3. **Verifier.** No new sub-check IDs; the counts stay at 45 (36 core, 9 advisory).
   - P3.1 and P3.2 expect HTTP 400 (through `gateExchange`'s per-exchange status) and `error.data.requested` equal to the unlisted revision.
   - P3.3 compares `error.data.supported` with P1's `supportedVersions`.
   - P4.1, P4.2, and P4.4 expect HTTP 400. P4.3 and P4.5 stay at 200.
   - The advisory edge checks X2.3 and X2.4 (`-32020` through the custom domain) also expect HTTP 400.
   - The key names and the 400 rule are restated in the verifier from the schema, not imported.
0.4. **Fake server and its tests.** `fake-mcp-server.mjs` returns the new keys and status 400 for `-32022` and `-32020`. `fake-mcp-server-tests.jest.mjs` and `checks-tests.jest.mjs` are updated, with failure cases for the old keys and for status 200.
0.5. **Docs.**
   - `docs/end-user/supported-protocol-revisions.md`: the example, plus a note that both errors return HTTP 400.
   - `ARCHITECTURE.md`, `docs/admin-ops/post-deploy-verification.md` (P3 and P4 descriptions), and `docs/developer/mcp-protocol-sources.md`.
   - The smoke-verification spec's `requirements.md` and `design.md` (P3 and P4 rows), and the dual-era `design.md` and `TODO-MANUAL-VERIFY.md` script. The dual-era `tasks.md` and `requirements.md` stay as history, as the cacheScope spec decided.
0.6. **`CHANGELOG.md`.** The existing v0.0.7 `-32022` bullets are corrected in place, as in the cacheScope Q5 decision. A Fixed entry links this spec.
0.7. **Unknown request id (Q10 = A).**
   - `jsonRpcError` leaves out `id` when it is `null` or `undefined`.
   - A request whose `id` member is present but is not a string or an integer gets `-32600` without `id`, instead of a result with `id: null` (D23).
   - The 401 body in `utils/auth-resolver.js` and the fake server's 401 body leave out `id` too (D24).
   - Tests that expect `id` to be `null` on an error change to expect no `id`. Router-level tests that expected a result for an invalid id expect `-32600`.
   - The conformance test validates these errors against `2025-11-25` and `2026-07-28`, with `2024-11-05` as a named exception.
0.8. **Notifications (Q11 = A).**
   - A valid JSON-RPC message with no `id` member gets HTTP 202 with an empty body, after the header and revision checks. A notification with a header mismatch or an unlisted revision still gets its 400 error, without `id`.
   - `routes/index.js` passes an empty router body to the cache-data `Response` as `null` instead of calling `JSON.parse` on it.
   - Router and routes unit tests cover the case, and the conformance test asserts 202 and no body for `notifications/initialized` on the legacy revisions.
   - The verifier and fake server are unchanged; neither sends or models notifications.

### 6.1 Conformance tests

1. **Vendor pinned schemas** in `application-infrastructure/tests/mcp-schemas/<revision>/schema.json` for `2024-11-05`, `2025-11-25`, and `2026-07-28`, all from one upstream commit, with `PROVENANCE.md` (source URL, commit SHA, retrieval date, sha256 per file, upstream license note).
2. **Helpers.** `read-function/tests/helpers/mcp-schema-validator.js` (CommonJS) and `tests/postdeploy-verify/helpers/mcp-schema-validator.mjs` (ESM).
   - **Loading:** each loads the vendored file, picks the Ajv class by draft, and sets `allErrors`, `allowUnionTypes`, and `ajv-formats`. Compiled validators are cached per module.
   - **API:** `validate(revision, definitionName, value)` and `validateStrict(revision, definitionName, value)`. Both throw on an unknown definition name.
3. **Strict overlay**, built in memory from the vendored file by the rules in Section 4.2. `_meta` objects are closed (D14). The open-list is one exported constant.
4. **Definitions used:**
   - **Wrappers:** `...ResultResponse` for `tools/list` and `server/discover` where the revision defines them. Otherwise the `...Result` definition plus a hand check of the envelope.
   - **`tools/call`:** `CallToolResult` directly.
   - **Errors:** `UnsupportedProtocolVersionError` and `HeaderMismatchError` for `-32022` and `-32020` on `2026-07-28`. Otherwise `JSONRPCErrorResponse` (`2026-07-28`, `2025-11-25`) or `JSONRPCError` (`2024-11-05`).
5. **Read-function test** `tests/integration/mcp-protocol-schema-conformance.test.js`.
   - **Requests:** drives `handleJsonRpc` for each revision plus a request that declares no revision, with the real catalog.
   - **Checks:** runs `validate` and `validateStrict` on every parsed body. Covers `initialize` (legacy), `tools/list`, `tools/call`, `server/discover` (modern), and the errors `-32700`, `-32600`, `-32601`, `-32602`, `-32603`, `-32020`, `-32022`.
   - **Status:** asserts HTTP 400 for `-32020` and `-32022` (fixed in Section 6.0), citing the definitions.
6. **Negative controls**: the old `cacheScope: "server"` defect, discover without hints, `tools/call` without `content`, an unknown definition name, the old `-32022` data keys, and misspellings in a result, a Tool, ToolAnnotations, `_meta`, capabilities, serverInfo, a content block, and an error object (strict check). Each fails with the field named.
7. **Guards**: vendored sha256 equals `PROVENANCE.md`; every `SUPPORTED_PROTOCOL_VERSIONS` entry has a vendored schema; the overlay builder throws on draft-07 `allOf` (synthetic schema).
8. **Fake server**: `fake-mcp-server-schema-conformance.jest.mjs` in `postdeploy-verify` runs both checks on the fake's answers. The verifier stays dependency-free.
9. **Dependencies**: `ajv` and `ajv-formats` as dev dependencies (caret in `read-function`, exact pins in `postdeploy-verify`).

### 6.2 Keeping the schemas current

10. **Refresh script** `application-infrastructure/build-scripts/refresh_mcp_schemas.py`, Python standard library, no shell.
    - **Report mode (default).** For each vendored revision, it reports whether upstream differs at a commit (default `main`). It also lists upstream revisions that are not vendored, ignoring `draft`.
    - **Semantic versus text-only.** A *semantic* change still differs after string-valued `description` and `$comment` annotations are removed; a *text-only* change differs only in those annotations.
    - **Exit codes.** Exit 1 on a semantic change. Exit 0 with a warning on a text-only change or a new revision.
    - **Writing.** `--write --commit <40-hex sha>` rewrites the vendored files and `PROVENANCE.md` from that commit. It never edits `SUPPORTED_PROTOCOL_VERSIONS`.
    - **Inputs.** It validates the SHA and revision names against allow-lists, builds URLs from fixed templates, and uses `GITHUB_TOKEN` when present without logging it.
    - **Test.** `test_refresh_mcp_schemas.py` uses a fake fetch function and no network.
11. **`update-mcp-schemas` skill**, `.kiro/skills/update-mcp-schemas/SKILL.md`, modeled on `update-lambda-layers`.
    - It runs the script in report mode and summarizes the result.
    - If there is a semantic or text-only change, it runs `--write` against the upstream commit it reports, then runs the `read-function` and `postdeploy-verify` suites.
    - It reports what changed and whether the tests pass.
12. **Hook and detection script.** `build-scripts/detect_release_transition.py`, Python standard library, `subprocess.run` with `shell=False` and a timeout, with a unit test.
    - **Transition:** the first `## [vX.Y.Z]` header in the working-tree `CHANGELOG.md` is dated `(YYYY-MM-DD)`, while the same version's header in `git show HEAD:CHANGELOG.md` is `(unreleased)`.
    - **Output on `dev`:** a fixed instruction to run the `prepare-release` skill.
    - **Output on any other branch:** a fixed notice that the release path dates the version on `dev` (D19).
    - **Otherwise:** prints nothing and exits 0.
    - **Registration:** a `UserPromptSubmit` command hook, created with Kiro's hook tooling at `.kiro/hooks/`, runs the script.
13. **`prepare-release` skill**, `.kiro/skills/prepare-release/SKILL.md`. On `dev`, with the dated `CHANGELOG.md` uncommitted:
    1. Confirm the branch is `dev` and that the only uncommitted change is the version header in `CHANGELOG.md`. Otherwise stop and say what else is changed.
    2. Run `audit-update-npm-packages`, `audit-update-python-packages`, `update-lambda-layers`, and `update-mcp-schemas`, in that order. Each applies its updates in the working tree. Nothing is committed (Q9 = B).
    3. Run every test suite the Build stage runs, plus `postdeploy-verify` and the Python unit tests.
    4. Compare `git diff --name-only` against the prepare-pass allow-list (D20). Report any file outside it as a stop condition.
    5. If a test fails and the fix needs code outside the allow-list, stop. Say to restore `CHANGELOG.md` to `(unreleased)` and fix the problem in a normal verify pass (D21).
    6. Otherwise summarize what each skill changed. Hand the commit and the promotion through `test`, `beta`, and `main` to you, following the release-process page.
14. **GitHub release gate**, `.github/workflows/release-gate.yml`, on `release: types: [published]`.
    - **Job `schema-drift`** (`contents: read`, `timeout-minutes: 10`): check out the release tag, set up Python, run both Python unit tests, then run the refresh script in report mode against upstream `main` with `GITHUB_TOKEN`. Write the report to the step summary. Fail on a semantic change.
    - **Job `withdraw-release`** (`needs: schema-drift`, `if: failure()`, `contents: write`): run `gh release edit "$TAG" --draft=true` with the tag from `env`. Write a summary stating that `prod` already runs this code, and that the fix is `update-mcp-schemas` followed by a new prepare pass, then publishing the release again.
    - **All jobs:** actions are pinned by commit SHA, and event values reach `run:` only through `env`.

### 6.3 Release path documentation

15. **New page** `docs/developer/release-process.md`, linked from `docs/developer/README.md`, `DEPLOYMENT.md` (after the promotion section), and `CONTRIBUTING.md`. It covers:
    - **Verify pass:** feature work on `dev`, merged through `test`, `beta`, and `main`. Every stage's Build, deploy, and PostDeploy (including the smoke verifier) must pass before preparing.
    - **Prepare pass:**
      - On `dev`, change the top `CHANGELOG.md` header from `(unreleased)` to `(YYYY-MM-DD)`. The hook prompts for `prepare-release`, which can also be run by hand.
      - Review the skill's summary, then commit only the allowed files (D20).
      - Merge through `test`, `beta`, and `main` again, and confirm every stage passes. The pass contains no other code changes. If one is needed, abandon the pass, restore `(unreleased)`, and start a new verify pass.
    - **GitHub release:** push `main` to the `github` remote, then create and publish the release with tag `vX.Y.Z` against `main`. The `release-gate` workflow runs on publish. If it returns the release to draft, follow its summary.
    - **After the release:** add the next `vX.Y.Z (unreleased)` header on `dev` (`changelog-convention.md`).
    - **Gates:** a table of what each gate checks and what it can stop (Section 4.3).
16. **Other docs.**
    - `docs/developer/mcp-protocol-sources.md`: schema source and pin, overlay rules and the open-list, refresh script, and how to add a revision's schema.
    - `.kiro/skills/README.md`: lists `update-mcp-schemas` and `prepare-release` as project-specific, not for publishing (D16).
    - `CHANGELOG.md`: an Added entry in `v0.0.7 (unreleased)` linking this spec.

### 6.4 Verification

17. Run these checks:
    - `npx jest` and `npm run lint` in `read-function`, and `npm test` in `tests/postdeploy-verify`. That `npm test` calls the Jest binary directly, so it cannot recurse.
    - `python3 -m unittest` for both Python scripts, and one report-mode run of the refresh script against upstream.
    - The detection script against a scratch repository, for each header state and on two branches.
    - `actionlint` on the workflow, if available, then the throwaway pre-release run (Section 2.1, with your go-ahead).
    - Suite time before and after.

### 6.5 Alternatives considered

- **Fetch the schema at test time.** Rejected: offline runs, the network-mocking rule, upstream edits in place.
- **A package that bundles the schema.** None found.
- **`ajv` 6.** Cannot load 2020-12.
- **Wrapper or generic error definitions only.** Misses `tools/call` without `content` and F1.
- **Editing the vendored files to close objects.** Breaks the integrity check and must be redone on every refresh.
- **Hand-written key allow-lists.** The pattern that let cacheScope through.
- **`additionalProperties: false` in 2020-12 schemas.** Wrong under `allOf` (found by test).
- **A separate spec for F1 and F2** (Q6 B, first chosen, then revised), **dual key sets** (Q6 C), **defer** (Q6 D). Not chosen.
- **HTTP 400 for every JSON-RPC error.** Not chosen: no schema definition states a status for the other codes, and changing them would be a change no specification asks for.
- **Failing check only** (Q7 A), **draft-then-dispatch** (Q7 C). Not chosen.
- **`PostFileSave` agent hook** (Q8 A), **git `pre-push` hook** (Q8 C). Not chosen.
- **Report-only `prepare-release`** (Q9 A), **apply and continue** (Q9 C). Not chosen.
- **Live validation in the verifier**, **a scheduled drift job**, **a Node refresh script**, **re-running CodeBuild suites on GitHub**. Not chosen.

### 6.6 Decided in this plan (veto if wrong)

| # | Decision | Reason |
|---|----------|--------|
| D1 | Vendored, pinned copies, not fetch-at-test-time and not a package | Rows 7, 8, 11 |
| D2 | Pin to one upstream commit SHA for all three files | The `2025-11-25` tag differs from `main` |
| D3 | `ajv` 8.20.0 with `ajv-formats` 3.0.1, strict mode on with `allErrors` and `allowUnionTypes`; dev dependencies only | Handled all three schemas with field-level messages |
| D4 | One shared schema directory, `application-infrastructure/tests/mcp-schemas/` | One definition rule; outside `src/` |
| D5 | `read-function` tests are CommonJS `*.test.js`; `postdeploy-verify` tests are ESM `*.jest.mjs` | What each Jest config discovers |
| D6 | Helpers throw on an unknown definition name | `getSchema` returns `undefined` silently |
| D7 | `CallToolResult` directly; code-specific error definitions where they exist | Row 9 |
| D8 | sha256 per vendored file in `PROVENANCE.md`, checked by a test | Integrity |
| D9 | No template, IAM, or CodePipeline change. The only Lambda change is the `-32022`/`-32020` fix in the router. It also adds tests, two Python scripts, a GitHub Actions workflow, two Kiro skills, one Kiro hook, and docs | Q6 = A |
| D10 | Not validated: tool payload JSON inside `text` content blocks | The schema does not describe it |
| D11 | Python standard library scripts in `build-scripts/` with `unittest` tests | Matches `write_release_version.py` |
| D12 | Two validator helpers, one per test package, reading one schema directory | Packages are self-contained; the shared data must not drift |
| D13 | Strictness is an in-memory overlay derived from the vendored file, run in addition to the published-schema check, with one exported open-list constant | U1; keeps pinned files byte-exact |
| D14 | `_meta` objects are closed in the overlay | The server emits only `io.modelcontextprotocol/serverInfo`; closing catches a typo in that key |
| D15 | "The 4 update skills" are `audit-update-npm-packages`, `audit-update-python-packages`, `update-lambda-layers`, `update-mcp-schemas` | Reading of the Q5 answer |
| D16 | `update-mcp-schemas` and `prepare-release` are project skills, not for publishing | `.kiro/skills/` is a staging area for published assets |
| D17 | The release gate fails only on a semantic change to a vendored revision; text-only changes and new revisions are warnings | Avoids a gate people learn to ignore |
| D18 | The hook prints fixed text only, is read-only, and has a timeout | Section 4.1 |
| D19 | On a branch other than `dev`, the hook prints a notice that the release path dates the version on `dev`, and does not prompt `prepare-release` | Your Q9 answer: the date is always edited on `dev` |
| D20 | The prepare-pass allow-list: `CHANGELOG.md`; every `package.json` and `package-lock.json` (and any future `requirements*.txt`); `application-infrastructure/template.yml` limited to the layer `Mappings` that `update-lambda-layers` edits; `application-infrastructure/tests/mcp-schemas/**` | Your Q9 answer: only CHANGELOG, package, and layer updates. Vendored schemas are test data that `update-mcp-schemas` maintains, the fourth update skill in Q5 |
| D21 | If a prepare-pass update needs any change outside the allow-list (for example a test fails after a package or schema update), the pass stops; the date is restored to `(unreleased)` and the fix goes through a verify pass | Keeps the prepare pass free of code changes |
| D22 | The release-process page lives in `docs/developer/`, not `docs/admin-ops/` | Releasing is done by the maintainers who develop the application |
| D23 | A request with an `id` member that is not a string or an integer (`null`, an object, an array, a boolean, or a non-integer number) gets `-32600` without `id`, on every era | `2025-11-25` and `2026-07-28` basic pages: "Requests MUST include a string or integer ID". Today such a request gets a result with `id: null`, which no schema accepts. Follows from Q10 = A and Q11 = A: with no `id` member it is a notification; with an invalid one it is an invalid request |
| D24 | The 401 invalid-key body (`auth-resolver.js:310-318`) and the fake server's copy leave out `id` | Same reason as Q10 = A. Verifier S1 checks only the 401 status, so no sub-check changes |

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| Negative controls, throwing helper, sha256 test, advertised-revision guard, draft-07 `allOf` guard | Include | Make the check trustworthy | S | Low |
| Strict overlay | Include (U1) | Misspelled optional fields fail; real output passes today | S | Low |
| Fake-server conformance | Include (Q2) | The fake agreed with the bug last time | S | Low |
| Refresh script and `update-mcp-schemas` skill | Include (Q3, Q5) | Reports upstream drift | S-M | Low |
| Hook, detection script, `prepare-release` skill | Include (Q5, Q8, Q9) | Runs the update skills at the start of the prepare pass | S-M | Low |
| `release-gate.yml` with withdraw-to-draft | Include (Q5, Q7) | Backstop at the GitHub release | S | Low |
| `docs/developer/release-process.md` | Include (your request) | The two-pass release path is not written down anywhere | S | Low |
| Errors without `id` when the request id is unknown; invalid ids rejected (F6, D23, D24) | Include, done first (Q10 = A) | Blocks the `-32700` and `-32600` conformance cases | S | Low |
| Notifications get HTTP 202 with no body (F7) | Include, done first (Q11 = A) | A transport MUST; one router branch and one `routes/index.js` guard | S | Low |
| `-32022` data keys and HTTP 400 for `-32022`/`-32020` (F1 to F3) | Include, done first (Q6 = A) | Blocks this spec's conformance tests. API Gateway already declares 400, and CloudFront does not cache POST (Section 3) | S-M | Medium |
| Dead test file, Dependabot directory, Python tests in no buildspec | Spin off, confirmed (Q4) | [0-0-8-prune-tests-and-ensure-automation](../0-0-8-prune-tests-and-ensure-automation/ISSUE.md) | S | Low |
| Live schema validation inside the verifier | Note only | Raise if a deployment-only divergence ever occurs | M-L | Medium |
| Header-declared revision outside the spec's cache key | Note only | Noted in the cacheScope plan | - | - |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Upstream changes a published schema and the vendored copy goes stale | Commit pin with sha256; refresh script; `prepare-release`; GitHub gate |
| The overlay rejects something the specification allows through composition | Composition-aware rules tested on all real output; draft-07 `allOf` throws |
| A refresh brings a shape the overlay mishandles | The same test run validates real output against the new file and names the failing path |
| A legitimate extension field fails the strict check | One exported open-list constant, changed by review |
| A validator wiring mistake validates nothing | Throwing helpers, negative controls, defect replays |
| This spec's `-32022` and status cases cannot pass before F1 and F2 are fixed | Section 6.0 is done first, in the same spec |
| A client reads the old `declaredRevision`/`supportedVersions` keys | Never in a GitHub release; the end-user page is corrected in the same change; `server/discover` stays the documented way to learn supported revisions |
| A client treats HTTP 400 differently from 200 for these errors | That is what the specification requires; checked with a client on `test` (Section 2.1) |
| During a PROD gradual shift, `-32022` answers come in both shapes | Both are well-formed JSON-RPC errors; PostDeploy checks only after the shift ends |
| A prepare pass carries an untested or unrelated change | `prepare-release` runs on `dev` only, commits nothing, checks the allow-list; the pass is promoted through every stage again |
| A package or schema update breaks a test during the prepare pass | Stop condition (D21) |
| The hook misses a date edited and committed outside Kiro | The GitHub gate checks schemas at release; the release-process page lists `prepare-release` as a manual step too |
| The hook adds latency to every prompt | One file read and two git calls, short timeout, silent otherwise |
| A release is withdrawn while `prod` already runs that code | Expected; the workflow summary says so and names the fix |
| A write-scoped token in a public workflow is misused | Write scope only on the failure-only job, SHA-pinned actions, no untrusted interpolation |
| The refresh script hits a GitHub rate limit | `GITHUB_TOKEN` in Actions; a rate-limit response is reported as such |
| `ajv` 8 disturbs `eslint` | Run lint after install |
| Suite time or memory grows | Compile once per module; measure |
| Vendoring conflicts with the upstream license transition | Attribution and license text in `PROVENANCE.md`; you confirm |
| Schema validation gives false confidence that clients accept results | Docs say it checks the published schema only |
| The skills folder is mid-rename | New skill folders and the `README.md` edit come after the rename is committed |

## 9. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | A: validate every shape the server emits (`initialize`, `tools/list`, `tools/call`, `server/discover`, JSON-RPC errors) on `2024-11-05`, `2025-11-25`, and `2026-07-28` | Legacy revisions serve most deployed clients; small cost |
| Q2 | B: `read-function` tests validate real output in Build; `postdeploy-verify` tests validate the fake in PostDeploy; the verifier stays dependency-free | Catches violations before deploy and keeps the fake honest |
| Q3 | B: guard test, documented refresh, and a report-first refresh script | Reports drift with no new infrastructure |
| Q4 | Both spin-offs go into [0-0-8-prune-tests-and-ensure-automation](../0-0-8-prune-tests-and-ensure-automation/ISSUE.md). Your answer: "There are probably many tests that are either dead, or no longer necessary. Let's begin a list of these in specs/0-0-8-prune-tests-and-ensure-automation. ... This goes along with the fact that there might be some post-deploy tests that are not running." | The findings are instances of a wider problem |
| Q5 | C (includes A): docs and `update-mcp-schemas`; plus a GitHub workflow that fails the release, following cache-data; plus a local trigger when the top `CHANGELOG.md` version changes from `(unreleased)` to a date, running the four update skills. Your answer: "C (which includes A) but also add it to a github workflow for when an actual release is created in Github. Use @63klabs/cache-data as an example (though we don't publish the MCP code anywhere, we can fail the release). Maybe we can trigger locally before it gets to GitHub (but still have GitHub gate) by creating a skill that detects when a CHANGELOG pending release goes from (unreleased) to a (YYYY-MM-DD) triggering the 4 update skills." | A skill cannot detect the edit, so a hook starts `prepare-release` (Q8) |
| Q6 | A (revised from B): F1 to F3 are fixed in this spec, first (Section 6.0), with the specification's key names only. Your direction: "If Q6 needs to be addressed before we can move forward with this one, let's keep it in this one and address first. Otherwise we just keep spinning off new issues infinitely." | The fix blocks this spec's tests, so it belongs here; the error has never shipped in a GitHub release, so no dual keys |
| Q7 | B: on a failed gate, a failure-only job with `contents: write` returns the release to draft | The only option that actually withdraws a release |
| Q8 | B: `UserPromptSubmit` command hook running a read-only detection script that compares the working tree with `HEAD` | Prompts once per pending release; no agent turn per save |
| Q9 | B: `prepare-release` applies updates on `dev` and commits nothing; you promote them. Your answer: "Date is always edited on dev once all checks on each stage pass. Code and Infra (with *ONLY* CHANGELOG, package/layer updates) is then re-run through each stage before github main which leads to a release." | Updates go through every stage in the prepare pass; D19 to D21 and the release-process page follow from it |
| Q10 | A: leave `id` out of an error whose request id is unknown; `2024-11-05` is a named exception in the conformance test (Section 6.0, step 0.7; D23, D24) | MCP `2025-11-25` and `2026-07-28` make the error `id` optional and say such an error "has no `id`"; clients validate against the MCP schema |
| Q11 | A: notifications get HTTP 202 with no body, in this spec (Section 6.0, step 0.8) | The `2025-11-25` transport's MUST; same defect class; small |
| U1 | Mitigate open `additionalProperties`: a strict overlay that rejects undeclared property names, alongside the published-schema check (D13, D14) | Your direction in chat, 2026-11-01. Real output passes; misspellings fail with the property named |
| U2 | Document the release path: verify pass `dev` through `main`, then prepare pass `dev` through `main` with only `CHANGELOG.md`, package, and layer updates (Section 6.3) | Your direction in chat, 2026-11-01 |

## 10. Open questions and recommendations

No open questions. Q1 to Q11 and U1, U2 are recorded in Section 9.
