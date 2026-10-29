# tools/list returns cacheScope "server", which Kiro rejects (connection fails)

> **Status**: Locked 2026-10-29
> **Issue**: [ISSUE.md](ISSUE.md) (GitHub [#7](https://github.com/63Klabs/atlantis-mcp/issues/7))
> **Reviewed against**: `dev` at `65bf343` on 2026-10-29 (first pass at `a491bc5`), and the MCP `2026-07-28` specification

## 1. Summary

The modern-era (`2026-07-28`) `tools/list` result carries `cacheScope: "server"`. The specification allows only `"public"` or `"private"`, so any client that validates results against the published schema rejects the response and fails to connect. Kiro is one such client. The value was introduced in the dual-era spec as the project's own wording ("identical for every client") and was never checked against the schema. Tests, docs, and the manual verification script all assert `"server"`, so nothing caught it.

The fix is to emit `"public"` (the tool list is identical for every caller), and to take the value from one named constant. Reading the schema also shows the same defect class in a second place that the issue does not mention: `server/discover` must carry `ttlMs` and `cacheScope` too, and does not. The recommended change fixes both in one pass, corrects every place that documents or asserts `"server"`, and tightens the post-deploy check so a wrong value fails the pipeline instead of the user.

**Smoke verifier.** The post-deploy smoke verifier (`0-0-7-postdeploy-smoke-verification`) is no longer a plan: it is implemented (`verify-deployment.js`; `tasks.md` shows tasks 1 to 12 done, and only live verification 13.x and the final task 14 open) and its commit `f6db48c` (2026-10-27) is on `origin/test`, `origin/beta`, and `origin/main`. Its P5.1 and P5.2 accept any non-empty `cacheScope`, and P1 asserts no cache hints, so the verifier passes today on `"server"`. Fixing the gap therefore means changing verifier code, its fake server and tests, and its docs, not only spec wording (decision Q8 in Section 9).

Legacy-era responses (`2024-11-05`, `2025-11-25`, no declared revision) are unaffected.

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | Modern `tools/list` returns `cacheScope: "server"` | Confirmed | `utils/mcp-protocol.js:282` is a string literal. Running `toolsListResult(1, { era: 'modern', catalog: [] })` locally printed `{"ttlMs":600000,"cacheScope":"server","resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"atlantis-mcp-server","version":"0.0.7"}}}`, identical to the issue's result object |
| 2 | Valid values are `"public"` and `"private"` | Confirmed | [2026-07-28 schema](https://modelcontextprotocol.io/specification/2026-07-28/schema): `ListToolsResult.cacheScope: "public" \| "private"`, required. [Caching page](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) and [SEP-2549](https://modelcontextprotocol.io/seps/2549-TTL-for-list-results) say the same |
| 3 | Without the `2026-07-28` declaration `cacheScope` is absent | Confirmed | Legacy branch returns only `['tools']` (`mcp-protocol.js` `toolsListResult`, verified by running it). Pinned by `tests/integration/mcp-protocol-modern-required-fields.test.js:118-122,155-159,189-193` |
| 4 | Kiro rejects the result and the connection fails | Unverifiable by reading | The quoted client error matches the schema constraint exactly, so it is consistent. We have no Kiro log of our own. Verify after deploy (see 2.1) |
| 5 | `initialize` succeeds, then `tools/list` fails | Unverifiable by reading | The router has an `initialize` case (`utils/json-rpc-router.js`), but why a client that negotiated `2026-07-28` would also send `initialize` is not established. Not material to the fix |
| 6 | `"public"` fits when the tool list is the same for all callers, `"private"` if it varies by tier | Confirmed | Spec: "`public` is appropriate for lists of tools ... when they are identical for all users". `utils/tool-catalog.js:156-158` states no tier or auth filtering is applied or available, and `buildToolCatalog` takes no auth parameter. The router calls it without `authInfo` (`json-rpc-router.js:300`) |
| 7 | Check `resources/list` and `prompts/list` if implemented | Confirmed, not applicable | Neither is implemented. `getCapabilities()` advertises only `tools: { listChanged: false }`, and the router's `default` case answers `-32601` |
| 8 | The deployed server at `mcp.atlantis.63klabs.net` is v0.0.7 and behaves as shown | Unverifiable by reading | The local formatter output matches, so the code path is the same. Which build and stage that domain serves is not established |

### 2.1 Needs runtime verification

| What | How | Touches live infrastructure |
|------|-----|-----------------------------|
| Which stage and build serve `mcp.atlantis.63klabs.net` | Not checked (Q7 = A: after-deploy checks only). The reporter can be told to retry once the fix reaches their stage | No |
| After the fix: the deployed result shape | Automatic. The PostDeploy stage of the `test` pipeline runs the tightened verifier (P1 and P5, Q8) against the deployed commit and fails the build on a bad `cacheScope`. The corrected `TODO-MANUAL-VERIFY.md` F1 block (Q4) remains available as a cross-check | Yes, test stage (read-only, by the pipeline) |
| After the fix: Kiro connects on a `2026-07-28` session | Manual. Point Kiro at the `test` stage once PostDeploy passes, confirm tools load. Capture the Kiro MCP log if it still fails. The verifier proves the shape, not that Kiro accepts it | Yes, test stage |

## 3. Current state

- **Formatter.** `toolsListResult(id, { era, catalog })` in `utils/mcp-protocol.js` builds the modern envelope. `ttlMs` comes from the module constant `TOOLS_LIST_TTL_MS` (`:127`, 10 minutes). `cacheScope` is an inline literal (`:282`). The JSDoc repeats the value (`:241`, `:265`).
- **Discover.** `discoverResult(id)` (`:390`) returns `supportedVersions`, `capabilities`, `instructions`, `resultType`, `_meta`. It is always modern-shaped regardless of era (`mcp-era.js` `resolveEra`). It has no `ttlMs` or `cacheScope`. The 2026-07-28 schema lists both as required on `DiscoverResult`.
- **Dispatch.** `json-rpc-router.js:294-298` routes `server/discover` and `tools/list` to those two formatters. `tools/call` has no cache fields in the schema and is correctly untouched.
- **Why it is this way.** `git log -S"cacheScope: 'server'"` points at `67483b3` (phase 4 of the dual-era spec). `0-0-7-mcp-protocol-dual-era/design.md:457` defines `'server'` as "the response is identical for every client". Requirement 7.3 in that spec required `ttlMs` and `cacheScope` to come "from a documented configuration source rather than a per-call literal"; the TTL does, the scope does not. The spec's PLAN cites the 2026-07-28 tools, versioning, and changelog pages but not the caching page or schema, which is where the enum is defined.
- **Where `"server"` is encoded** (all need correcting or a decision):

| Location | Kind |
|----------|------|
| `utils/mcp-protocol.js:241,265,282` | Code and JSDoc |
| `tests/integration/mcp-protocol-modern-required-fields.test.js:80` | Test pins the wrong value |
| `tests/unit/utils/mcp-protocol-discover.test.js:85-95` | Test pins discover to exactly five keys (changes with Q2 = A) |
| `ARCHITECTURE.md:454,457` | Doc |
| `docs/end-user/supported-protocol-revisions.md:101,108` | Doc, states `"server"` to end users |
| `docs/developer/gradual-deployment.md:97` | Doc, states `cacheScope: "server"` to developers (found while writing requirements; not in the first pass) |
| `docs/developer/mcp-protocol-sources.md:17` | Doc, names the source of the cache hint (needs a scope entry) |
| `CHANGELOG.md:29` | Unreleased Added bullet states `cacheScope: "server"` |
| `0-0-7-mcp-protocol-dual-era/design.md:436,457,716,874` | Spec history |
| `0-0-7-mcp-protocol-dual-era/tasks.md:211` | Spec history (completed task) |
| `0-0-7-mcp-protocol-dual-era/TODO-MANUAL-VERIFY.md:369` | Runnable script: `check "cacheScope is server" '.result.cacheScope == "server"'` fails after the fix |
| `application-infrastructure/tests/postdeploy-verify/helpers/fake-mcp-server.mjs:691` | Fake server emits `cacheScope: 'server'`; its `server/discover` answer (`:677-684`) has no `ttlMs` or `cacheScope` |
| `application-infrastructure/tests/postdeploy-verify/fake-mcp-server-tests.jest.mjs:267,277` | Pins `toBe('server')` |

### 3.1 The post-deploy verifier as implemented

- `application-infrastructure/postdeploy-scripts/verify-deployment.js` is a dependency-free CommonJS script. `buildspec-postdeploy.yml` runs it as the last post-deploy step (`05-verify-deployment.sh`) against the stage just deployed. A core failure fails the build and blocks promotion. The PostDeploy action builds the deployed commit (memory `upstream-pipeline-postdeploy-stage-facts`), so verifier and server always come from the same commit.
- `judgeModernToolsList` (`verify-deployment.js:2808-2832`, used by P5.1 and P5.2 at `:3050-3051`) requires `ttlMs` to be a non-negative integer and `cacheScope` to be a non-empty string. `"server"` passes.
- P1 (`checkP1`, `:2160-2253`) records P1.1 to P1.5 and V1.1. P1.2 (`:2207`) checks `resultType` and the absence of `protocolVersion`/`serverInfo`. Nothing in P1 looks at `ttlMs` or `cacheScope`.
- Legacy answers are already checked for the absence of `ttlMs`, `cacheScope`, `resultType`, and `_meta` (`MODERN_ONLY_RESULT_KEYS`, `:2735`), so Q8's change touches only the modern branch.
- The catalog is `SUB_CHECK_ROWS` (`:1476-1521`): 45 sub-checks, 36 core and 9 advisory. `outcome-and-report-tests.jest.mjs:131-132` pins the 45 IDs "deliberately". `docs/admin-ops/post-deploy-verification.md:22,27` describes P1 and P5 in prose.
- The test package is `application-infrastructure/tests/postdeploy-verify` (Jest, ESM, run with `npm test` inside it, which calls the Jest binary directly). It checks the verifier against `helpers/fake-mcp-server.mjs`, a deliberately independent model of the server. The verifier and the fake must not import Lambda code, so the allowed-value set has to be restated in them from the specification, not shared with `mcp-protocol.js`.
- Requirement 7.9 of the smoke spec forbids asserting configured values such as the `ttlMs` duration. The scope is a protocol enum, not a configured value, so asserting membership in `public`/`private` is consistent with it.

## 4. Review

### 4.1 Security

- **Cache scope is a confidentiality control.** The spec warns that a `"public"` result "may be shared between callers even if the Result is coming from an authenticated endpoint", and that servers must not rely on `cacheScope` for access control. Today `"public"` is accurate: the catalog has no tier or per-caller variation (`tool-catalog.js:156-158`). The risk is future drift. If a later change filters tools by tier or personalizes descriptions, a stale `"public"` would let a shared cache serve one caller's list to another. The mitigation is to state the invariant next to the constant and to cross-reference it from `tool-catalog.js`.
- **Operator-settable scope would be a hazard.** Making the scope an environment variable would let a misconfiguration emit an invalid value (the exact failure here) or flip to `"public"` without review. Keep it a code constant (see Q3).
- **Fail mode.** A schema-validating client fails closed (refuses to connect). Nothing server-side degrades; this is an availability problem for modern clients, not a data exposure.
- **Disclosure.** Not a vulnerability. The reproduction uses a placeholder key. `.kiro/specs` is tracked and ships to GitHub `main` with a release; nothing in this directory needs redaction.
- **IAM.** No change.

### 4.2 Software engineering

- **Correctness.** `"public"` is the only value consistent with a catalog identical for all callers. Cursor-based pagination is not implemented (`tools/list` returns one page, no `nextCursor`), so the spec rule that every page share one scope is trivially met.
- **Same defect class in discover.** `DiscoverResult` requires `ttlMs` and `cacheScope`; ours omits both. The issue's client error is about `tools/list` only, so we do not know whether Kiro validates the discover result. A client that does would fail at its first step. Fixing only `tools/list` risks a second round trip with the reporter.
- **Single source.** Give the scope and the allowed set one definition in `mcp-protocol.js`, beside `TOOLS_LIST_TTL_MS`, and have both formatters read it. This follows the file's existing pattern of "single source of truth" constants (`LEGACY_REVISIONS`, `SUPPORTED_PROTOCOL_VERSIONS`).
- **Tests encode the mistake.** The integration test asserts `toBe('server')`, so it protects the bug. Replace it with an assertion that the value is a member of the allowed set and equals the configured constant. Add the same assertion for discover. A frozen two-element allowed set in code lets unit tests check conformance without network access to the spec.
- **Test framework.** The read function's tests are Jest `*.test.js` files under `tests/unit` and `tests/integration`. New tests go there, following the existing files.
- **Backward compatibility.** Legacy responses are unchanged (existing F3 and integration tests cover this). Adding two fields to `discoverResult` is additive; the schema allows extra properties (`[key: string]: unknown`). The only test that breaks is the exact-key-set test for discover.
- **Docs to update.** `ARCHITECTURE.md`, the end-user revisions page, the developer protocol-sources page, and `CHANGELOG.md`, per the AGENTS.md documentation rule.

### 4.3 Cloud engineering

- **Topology.** The change lives entirely in the Read Lambda's JSON body. API Gateway passes the body through; CloudFront and the Lambda alias are not involved. No `template.yml`, parameter, IAM, KMS, or stack-boundary change.
- **Rollout.** Normal GitOps path `dev → test → beta → main`. In-place Lambda code update, no resource replacement. A modern client that previously failed starts working on the first deploy that reaches its stage. Legacy clients see no change.
- **Observability gap.** A client-side schema rejection leaves no server-side error: the request succeeds with HTTP 200 and a well-formed JSON-RPC result, and the client then closes the connection. CloudWatch cannot see this class of failure. The only automated guard is the post-deploy verifier, which is deployed but currently blind to this value (see 3.1 and Section 5).
- **Pipeline interaction.** Because the verifier runs from the same commit as the code it checks, the fix and the tightened verifier can ship in one commit without a window where one is ahead of the other. Running the new verifier locally against a stage that is still on the old build will fail P1.2 and P5.1/P5.2 by design, and the log's retry hint is the right response. On `beta` and `prod` the PostDeploy stage starts only after the CodeDeploy shift finishes (memory `upstream-pipeline-postdeploy-stage-facts`), so it verifies the new version, not a mix.
- **Task 13 overlap.** The smoke spec's live runs 13.1 to 13.4 are still open. They will exercise the tightened verifier if the fix lands first. Expected outcomes in 13.1 (`passed`, S2 and X2 skipped) are unchanged.
- **Stage behavior.** The value does not vary by stage, so there is no test/prod drift to consider. `ttlMs` of 10 minutes is advisory and unchanged.

## 5. Gaps and observations

- **The deployed smoke check does not catch this.** `0-0-7-postdeploy-smoke-verification` asserts `cacheScope` "is a non-empty string" (`requirements.md:164`, `design.md:502`), the verifier implements exactly that (`verify-deployment.js:2819`), and `"server"` satisfies it. Its P1 (`server/discover`) has no cache-hint assertion. This corrects the first pass of this plan, which treated that spec as unstarted (0 of 61 tasks) and proposed a wording-only edit. It is implemented, so the guard must change in code, in the fake server and tests that encode `'server'`, and in the spec and docs that describe it.
- **A passing smoke run is not evidence of client compatibility.** The verifier is a shape check written from the same understanding as the server. It cannot catch a mistaken reading of the specification, which is how this defect passed. The manual Kiro connection (Section 2.1) remains the check against an independent validator. Spin-off in Section 7 would close part of this.
- **Requirement 7.3 was only half met.** The scope was a per-call literal, contrary to the requirement the same spec wrote.
- **Inference, not verified:** other modern clients that validate against the published schema (the v2 TypeScript and Python SDKs, for example) would reject the same result. The issue reports only Kiro.
- **Header versus params and cache keys.** A modern client may declare the revision in a header or in `params._meta`. The spec defines a cache key as the method plus parameters, so a header-declared revision is outside it. The `tools/list` body differs by revision (`title` and `annotations` appear only on `2025-11-25` and later). A shared cache keyed by method and params could in principle serve one shape to a client that declared a different revision by header. Low risk; noted only.
- **Contradiction inside the issue:** none. The "Actual" and "Expected" sections agree with the reproduction.
- **Unstated by the issue:** the discover result, the tests and docs that assert `"server"`, and the process gap that let it through.

## 6. Proposed approach

1. **Constants.** In `utils/mcp-protocol.js`, add a frozen `CACHE_SCOPES = ['public', 'private']` and `TOOLS_LIST_CACHE_SCOPE = 'public'`, documented with the invariant ("the catalog is identical for every caller; if that stops being true this must become `private` or tools must be filtered per caller") and a link to the caching page (Q3 = A).
2. **`tools/list`.** `toolsListResult` modern branch reads `TOOLS_LIST_CACHE_SCOPE` instead of the literal. Update the two JSDoc mentions (Q1 = A).
3. **`server/discover`.** `discoverResult` adds `ttlMs` and `cacheScope` using the same values (Q2 = A).
4. **Tests.** Replace the `toBe('server')` assertion with membership in `CACHE_SCOPES` plus equality with the constant. Add the same assertions for `server/discover`. Update the discover key-set test. Add a test that a legacy `tools/list` still carries neither field. Add a unit test that `CACHE_SCOPES` has exactly the two spec values.
5. **Cross-reference.** Add a short comment in `utils/tool-catalog.js` next to the "no tier filtering" note pointing at the constant, so a future change to either is seen in the other.
6. **Docs.** Update `ARCHITECTURE.md`, `docs/end-user/supported-protocol-revisions.md` (both tables and the explanatory bullet, including discover), `docs/developer/gradual-deployment.md` (the `tools/list` line), and `docs/developer/mcp-protocol-sources.md` (add the scope's source). Update `CHANGELOG.md` per Q5.
7. **Spec history.** Correct `design.md` and `TODO-MANUAL-VERIFY.md` in the dual-era spec per Q4.
8. **Post-deploy verifier (Q8 = A, tighten in place, no new sub-check IDs).** `judgeModernToolsList` requires `cacheScope` to be `public` or `private`; P1.2 also requires a non-negative integer `ttlMs` and a `public`/`private` `cacheScope` on `server/discover`. The allowed pair is restated inside `verify-deployment.js` from the specification, not imported from Lambda code. `helpers/fake-mcp-server.mjs` emits `public` and adds both fields to its discover answer. `checks-tests.jest.mjs` gains failure cases (`cacheScope` of `"server"` and a missing `ttlMs` on discover) and `fake-mcp-server-tests.jest.mjs` stops pinning `'server'`. The smoke spec's `requirements.md` (7.2, plus a discover requirement for P1) and `design.md` (P1.2, P5.1, P5.2 rows) are updated to match, `docs/admin-ops/post-deploy-verification.md` is updated where it describes P1 and P5, and the Post-Deploy Smoke Verification bullet in `CHANGELOG.md` gets one line noting the tightened checks. The catalog stays at 45 sub-checks (36 core, 9 advisory), so `EXPECTED_SUB_CHECK_IDS`, the report format, and the Logs Insights query do not change.
9. **Verify.** Run the read-function suite (`npx jest` in `read-function`) and the verifier package suite (`npm test` in `application-infrastructure/tests/postdeploy-verify`; it calls the Jest binary directly, so it does not recurse). After the fix reaches `test`, confirm the PostDeploy stage passes with the tightened P1 and P5, optionally run the corrected F1 block, and connect Kiro (Q7 = A, see 2.1).

Alternatives considered:

- **Emit `"private"`.** Conformant and conservative (it is the default several SDKs use), but it defeats shared-cache use for a list that is public by design. Rejected (Q1).
- **Fix only `tools/list`.** Smallest diff, but leaves a known required-field gap on the method modern clients call first. Rejected (Q2).
- **Make the scope configurable.** Rejected; see 4.1.
- **Omit `cacheScope`.** The SEP makes it required precisely because there is no safe default. Rejected.
- **Add a separate `P1.6` sub-check for the discover hints** (Q8 option B). Rejected: it changes the 45/36/9 counts, the pinned ID list, and several tests and docs for no gain in diagnosis, since the P1.2 failure line names the field and observed value.
- **Leave the verifier alone** (Q8 option D). Rejected: the guard stays blind while the fix ships.
- **Edit only the smoke spec text** (this plan's first proposal for the verifier). Superseded: the verifier is implemented, so a text-only edit would leave the pipeline unable to catch the defect and make the spec disagree with its code.

### 6.1 Decided in this plan (veto if wrong)

| # | Decision | Reason |
|---|----------|--------|
| D1 | Legacy-era `tools/list` and `initialize` are not touched | Fields are modern-only; existing tests already assert this |
| D2 | `tools/call` results get no cache fields | Not cacheable in the schema (`CallToolResult` has none) |
| D3 | No `prompts/list`, `resources/*` handling | Not implemented, not advertised |
| D4 | `ttlMs` stays 600000 for `tools/list`; discover reuses the same value | The issue does not challenge it; discover content changes only on deploy |
| D5 | New tests go in the existing Jest `*.test.js` files under `read-function/tests` | Matches the function's current layout |
| D6 | No `template.yml`, IAM, or pipeline change | Body-only change. The verifier is a script inside the existing PostDeploy build, not a pipeline change |
| D7 | The verifier asserts membership in `public`/`private`, never the exact value | Requirement 7.9 forbids asserting configured values. The enum is protocol, but the choice between its two members is the server's |
| D8 | The verifier and its fake server do not import Lambda code | The verifier is dependency-free and runs alone in CodeBuild; the fake is a deliberately independent model of the server |

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| Add `ttlMs` and `cacheScope` to `server/discover` | Include (Q2 = A) | Required by the schema; same defect class; one-function change | S | Low |
| Replace `toBe('server')` test with enum-membership checks, add discover coverage | Include | The current test protects the bug | S | Low |
| Correct docs and the manual verify script | Include | Docs state an invalid value to end users; the script would fail after the fix | S | Low |
| Tighten the implemented verifier (P1.2, P5.1, P5.2), its fake server, its tests, its spec text, and its admin-ops page | Include (Q8 = A) | Without it a wrong enum value still passes the pipeline and reaches users. Replaces the earlier "edit the unstarted spec" item | M | Low |
| Comment cross-reference between `tool-catalog.js` and the scope constant | Include | Keeps the `public` invariant visible to the next editor | S | Low |
| Validate every modern result field against a vendored copy of the published schema in unit tests, and in the verifier | Spin off (confirmed, Q9 = A) | Would have caught this and any similar drift, but is a larger piece of work (choosing a schema source, keeping it current) | M | Low |
| Header-declared revision outside the spec's cache key | Note only | Low risk, no action proposed | - | - |
| Client-side rejections are invisible in CloudWatch | Note only | Partly covered by the tightened verifier; no server signal exists to alarm on | - | - |
| Smoke spec task 13 (live runs) is still open | Note only | The fix does not change its expected outcomes; it will exercise the tightened verifier if the fix lands first | - | - |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Kiro still fails after the scope fix, for a reason not visible from the issue (for example the discover result) | Fix discover in the same change (Q2). Test against `test` with Kiro before promotion and capture its MCP log if it fails |
| `"public"` becomes wrong if tools are later filtered by tier or caller | Invariant documented on the constant and cross-referenced from `tool-catalog.js`. Scope kept out of operator configuration |
| Adding discover fields breaks a client that compares the result strictly | Schema allows additional properties; only our own key-set test changes |
| Tests keep asserting a hard-coded string and drift again | Assert against the single constant and the two-value allowed set |
| Documentation or spec history still says `"server"` | Section 3 lists every location; Q4 settles which history is rewritten |
| The tightened verifier fails a build because the server on that stage is older than the verifier (for example a local run against a stage still on the previous build) | Pipeline runs verify the deployed commit, so they match. For local runs the failure line states the observed value; retry after the stage updates |
| The verifier and fake agree with each other but not with the specification (the cause of this defect) | Allowed pair taken from the published schema, cited in a comment; Kiro connection check on `test`; schema-validation spin-off (Q9) |
| Fix reaches the stage clients use slowly through `dev → test → beta → main` | Expected path per AGENTS.md; no manual deploys. Confirm which stage serves the reporter's domain (2.1) so the reporter knows when to retry |

## 9. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| Q1 | `tools/list` emits `cacheScope: "public"` | The catalog is identical for every caller and tier (`tool-catalog.js:156-158`). Invariant documented on the constant and cross-referenced from `tool-catalog.js` |
| Q2 | `server/discover` also gets `ttlMs` (600000) and `cacheScope` (`"public"`) | Required by the 2026-07-28 `DiscoverResult` schema; same defect class; avoids a second round trip with the reporter |
| Q3 | Module constants in `utils/mcp-protocol.js` (`CACHE_SCOPES`, `TOOLS_LIST_CACHE_SCOPE`) beside `TOOLS_LIST_TTL_MS`, not operator-configurable | A protocol invariant tied to catalog content, not an operational setting |
| Q4 | Fix `design.md` and `TODO-MANUAL-VERIFY.md` in the dual-era spec; leave `tasks.md` and `requirements.md` as history | A stale design misleads and a failing script wastes time; a completed task list is history |
| Q5 | Correct the existing `CHANGELOG.md` Added bullet in place and add a Fixed entry linking this spec and GitHub #7, mentioning the discover addition | Final notes stay accurate and the fix stays visible |
| Q6 | Answered "revisit" because the smoke tasks are complete. Superseded by Q8 | The verifier is implemented, so the earlier text-only option no longer applies |
| Q7 | A: after-deploy checks only; no probe of the deployed stage now | The tightened PostDeploy verifier on `test` supplies the shape evidence automatically, the corrected F1 block stays available as a cross-check, and the Kiro connection is checked by hand. A passing verifier proves shape, not client acceptance |
| Q8 | A: tighten the verifier in place with no new sub-check IDs. P5.1 and P5.2 require `cacheScope` in `public`/`private`; P1.2 also requires `ttlMs` and `cacheScope` on `server/discover`. Update the fake server, both test files, the smoke spec's `requirements.md` and `design.md`, the admin-ops page, and one CHANGELOG line | P1.2 already means "the modern envelope", so the 45 IDs, the report format, the Logs Insights query, and the pinned ID-list tests stay stable. The failure line names the field and observed value |
| Q9 | A: spin off schema validation (modern results checked against a copy of the published schema, in unit tests and possibly the verifier) to its own issue; not part of this change | Valuable but separable; the choice of schema source and how to keep it current needs its own review. Created as `.kiro/specs/0-0-7-schema-validation-of-modern-results/ISSUE.md` (ISSUE.md only) |

## 10. Open questions and recommendations

No open questions.
