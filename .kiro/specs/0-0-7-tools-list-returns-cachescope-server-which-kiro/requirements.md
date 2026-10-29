# Requirements Document

## Introduction

**The modern `tools/list` and `server/discover` results carry a valid `cacheScope`.** The modern-era (`2026-07-28`) `tools/list` result currently carries `cacheScope: "server"`. The specification allows only `"public"` or `"private"`, so clients that validate results against the published schema, Kiro among them, reject the result and fail to connect. The modern `server/discover` result also omits `ttlMs` and `cacheScope`, which the schema requires. This feature makes both results emit `cacheScope: "public"` and `ttlMs` from one definition each, tightens the post-deploy verifier so that a wrong value fails the pipeline, and corrects every test, document, script, and spec that states or asserts `"server"`.

See [ISSUE.md](ISSUE.md) for the problem report (GitHub [#7](https://github.com/63Klabs/atlantis-mcp/issues/7)) and [PLAN.md](PLAN.md) for the analysis, the evidence, and the locked decisions. Every planning question is answered and the plan is locked.

### Guiding constraints

1. **Smallest change that is correct.** Two result formatters and their constants change. Legacy results, `tools/call`, and the tool catalog do not.
2. **One definition per value.** The scope and its allowed set live in `utils/mcp-protocol.js` beside the TTL, and no formatter carries a literal.
3. **Not operator-configurable.** The scope is a protocol invariant tied to the catalog's content. It is a code constant, not an environment variable, a parameter, or a setting.
4. **The guard must not trust the server's own reading.** The post-deploy verifier and its fake server restate the allowed values from the published specification and import nothing from Lambda code.
5. **No infrastructure change.** No `template.yml`, parameter, IAM, KMS, or pipeline change. The verifier is a script inside the existing PostDeploy build.
6. **Existing conventions.** Atlantis naming, `>!` security-comment notation where it applies, `.kiro/steering/changelog-convention.md`, the documentation standards, and Jest tests in the nearest existing location.
7. **Prove it in order.** The fix reaches `test` first, and Kiro is pointed at `test` before the change is promoted.

### Decisions carried forward from PLAN.md

| # | Decision | Requirement |
|---|----------|-------------|
| Q1 | `tools/list` emits `cacheScope: "public"` | 1, 2 |
| Q2 | `server/discover` also gets `ttlMs` (600000) and `cacheScope` (`"public"`) | 3 |
| Q3 | Module constants in `utils/mcp-protocol.js`, not operator-configurable | 1 |
| Q4 | Fix the dual-era `design.md` and `TODO-MANUAL-VERIFY.md`; leave its `tasks.md` and `requirements.md` as history | 10 |
| Q5 | Correct the existing CHANGELOG Added bullet in place and add a Fixed entry | 12 |
| Q6, Q8 | Tighten the implemented verifier in place, with no new sub-check IDs; update its fake server, tests, spec text, and docs | 7, 8, 9 |
| Q7 | After-deploy checks only; no probe of the deployed stage now | 13 |
| Q9 | Schema validation is a separate issue: `.kiro/specs/0-0-7-schema-validation-of-modern-results/ISSUE.md` | 14 |
| D1 to D8 | Legacy results, `tools/call`, and `prompts/*`/`resources/*` are untouched; `ttlMs` stays 600000; tests go in the existing Jest locations; no infrastructure change; the verifier asserts enum membership, never the exact value; the verifier and fake import no Lambda code | 4, 5, 7, 8, 14 |

### Additions beyond PLAN.md

Small refinements made while writing these requirements. Strike any you disagree with.

- **CHANGELOG convention conflict (needs your attention).** Q5 chose to correct the existing Added bullet in place, but `.kiro/steering/changelog-convention.md` says existing changelog text is never updated. Requirement 12.1 follows your decision and limits the in-place edit to the one wrong value. To follow the convention strictly instead, strike 12.1 and keep only the Fixed entry.
- **The verifier change is recorded as new CHANGELOG text, not as an edit to the Post-Deploy Smoke Verification bullet.** Q8 asked for one line in that bullet. The same convention applies, and a sub-bullet in the new Fixed entry records the change without editing existing text (Requirement 12.3).
- **`docs/developer/gradual-deployment.md` line 97 also states `cacheScope: "server"`.** The plan's first pass missed it; it is included in Requirement 11.3.
- **The manual `TODO-MANUAL-VERIFY.md` line is at 369, not 318** as the plan first cited. PLAN.md is corrected.
- **A one-line dated correction note is added to the dual-era `design.md` beside the corrected text** (Requirement 10.3), so a reader of its history knows why the value changed.
- **The manual script's section C (`server/discover`) gains `ttlMs` and `cacheScope` checks** (Requirement 10.5), because the manual cross-check should cover the field this change adds.

## Glossary

- **System**: This feature as a whole: the formatter changes, the tests, the verifier changes, the document and spec corrections, the changelog entries, and the rollout verification.
- **Read Function**: The Lambda function `ReadLambdaFunction`, which serves `POST /mcp/v1`. Its source is `application-infrastructure/src/lambda/read-function`.
- **Protocol Module**: `utils/mcp-protocol.js` in the Read Function.
- **Modern era**: Requests answered in the `2026-07-28` shape, as resolved by `utils/mcp-era.js`. `server/discover` is always answered in the modern shape.
- **Legacy era**: Requests that declare `2024-11-05` or `2025-11-25`, or no revision.
- **Cache hints**: The `ttlMs` and `cacheScope` fields of a cacheable result.
- **Allowed scopes**: The two values the specification permits for `cacheScope`: `"public"` and `"private"`.
- **Published schema**: The MCP `2026-07-28` JSON Schema at `https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.json`, and the [caching page](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching).
- **Verifier**: `application-infrastructure/postdeploy-scripts/verify-deployment.js`, run by `05-verify-deployment.sh` in the PostDeploy build.
- **Fake server**: `application-infrastructure/tests/postdeploy-verify/helpers/fake-mcp-server.mjs`, the independent model of the server that the verifier's tests run against.
- **Verifier tests**: The Jest package at `application-infrastructure/tests/postdeploy-verify`.
- **Smoke spec**: `.kiro/specs/0-0-7-postdeploy-smoke-verification`.
- **Dual-era spec**: `.kiro/specs/0-0-7-mcp-protocol-dual-era`.
- **Sub-check**: A verifier assertion with a stable ID such as `P1.2`. The catalog holds 45 sub-checks: 36 core and 9 advisory.

## Requirements

### Requirement 1: Single definition of the cache scope

**User Story:** As a maintainer, I want the cache scope and the set of valid scopes defined once, so that a wrong value cannot be reintroduced by a literal in a formatter.

#### Acceptance Criteria

1. THE Protocol Module SHALL define and export a frozen `CACHE_SCOPES` array whose members are exactly `"public"` and `"private"`.
2. THE Protocol Module SHALL define and export `TOOLS_LIST_CACHE_SCOPE` with the value `"public"`, beside `TOOLS_LIST_TTL_MS`.
3. THE documentation comment on `TOOLS_LIST_CACHE_SCOPE` SHALL state the invariant that makes `"public"` correct: the tool catalog is identical for every caller and every tier; and SHALL state that if that stops being true, the value must become `"private"` or the catalog must be filtered per caller.
4. THE comment SHALL link to the [caching page](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) and SHALL use `>!` security-comment notation for the shared-cache warning.
5. THE scope SHALL NOT be read from an environment variable, a CloudFormation parameter, `config/settings.js`, or any other operator-settable source.
6. THE executable code of the Read Function SHALL NOT contain a `cacheScope` property assigned a string literal. THE only places a scope value is written are the definitions of `CACHE_SCOPES` and `TOOLS_LIST_CACHE_SCOPE`. JSDoc and comments MAY show the value in examples.

### Requirement 2: Modern `tools/list` emits a valid scope

**User Story:** As a user of a client that validates results against the published schema, I want `tools/list` to be accepted, so that my client connects.

#### Acceptance Criteria

1. WHEN the era is modern, THE `toolsListResult` formatter SHALL set `cacheScope` to `TOOLS_LIST_CACHE_SCOPE`, which is `"public"`.
2. THE formatter SHALL keep `ttlMs` equal to `TOOLS_LIST_TTL_MS` (600000), `resultType` equal to `"complete"`, and the `_meta` server identity unchanged.
3. THE JSDoc of `toolsListResult`, including its two mentions of `'server'`, SHALL describe the new value and no longer say that tools are server-scoped.
4. THE `tools/list` result SHALL still carry exactly the members it carries today, apart from the changed `cacheScope` value.

### Requirement 3: `server/discover` carries cache hints

**User Story:** As a client author, I want `server/discover` to satisfy its required fields, so that a client that validates the discover result is not rejected at its first call.

#### Acceptance Criteria

1. THE `discoverResult` formatter SHALL add `ttlMs` equal to `TOOLS_LIST_TTL_MS` and `cacheScope` equal to `TOOLS_LIST_CACHE_SCOPE` to its result, so that the result carries `supportedVersions`, `capabilities`, `instructions`, `resultType`, `_meta`, `ttlMs`, and `cacheScope`.
2. THE `discoverResult` formatter SHALL NOT carry its own TTL or scope literal. THE implementation SHALL read the same two definitions as `toolsListResult`, so that one change moves both.
3. THE JSDoc and example of `discoverResult` SHALL show the added fields.
4. THE discover result's content (supported versions, capabilities, and `instructions`) is identical for every caller and changes only on deploy; THE comment beside the added fields SHALL say so, as the reason `"public"` and the shared TTL apply.
5. THE `server/discover` result SHALL remain answerable without authentication and SHALL remain modern-shaped in every era.

### Requirement 4: Results that must not change

**User Story:** As an existing client's user, I want legacy behavior untouched, so that nothing that works today breaks.

#### Acceptance Criteria

1. THE legacy-era `tools/list` result SHALL continue to carry only `tools`, and SHALL carry none of `ttlMs`, `cacheScope`, `resultType`, or `_meta`.
2. THE `initialize` result SHALL NOT change.
3. THE `tools/call` result SHALL NOT gain cache hints, because the schema defines none for it.
4. THE System SHALL NOT add `prompts/list`, `resources/list`, or any other method, and `getCapabilities()` SHALL continue to advertise only `tools: { listChanged: false }`.
5. THE tool catalog SHALL NOT change, and `buildToolCatalog` SHALL NOT gain a tier or authentication parameter.

### Requirement 5: Read Function tests

**User Story:** As a maintainer, I want tests that fail on a wrong or invalid scope instead of pinning the wrong one, so that this cannot reach a client again unnoticed.

#### Acceptance Criteria

1. THE assertion in `tests/integration/mcp-protocol-modern-required-fields.test.js` that expects `cacheScope` to be `'server'` SHALL be replaced by assertions that the value is a member of `CACHE_SCOPES` and equals `TOOLS_LIST_CACHE_SCOPE`.
2. THE test `tests/unit/utils/mcp-protocol-discover.test.js` that pins the discover result to five keys SHALL be updated to the seven keys of Requirement 3.1, and SHALL assert that `ttlMs` is a non-negative integer equal to `TOOLS_LIST_TTL_MS` and that `cacheScope` is a member of `CACHE_SCOPES` and equals `TOOLS_LIST_CACHE_SCOPE`.
3. THE test suite SHALL include a unit test that `CACHE_SCOPES` is frozen and has exactly the two members `"public"` and `"private"`, in either order.
4. THE test suite SHALL include a test that a modern `server/discover` request routed through the JSON-RPC router returns the cache hints.
5. THE test suite SHALL keep, or add, assertions that a legacy-era `tools/list` carries neither `ttlMs` nor `cacheScope`, for the `2025-11-25`, `2024-11-05`, and no-revision cases.
6. THE new and changed tests SHALL be Jest `*.test.js` files in the existing `tests/unit` and `tests/integration` locations of `read-function`, SHALL follow the neighbouring files' conventions, SHALL read no network or AWS resource, and SHALL NOT spawn the test suite.
7. THE test suite SHALL include an architecture test, beside `no-hardcoded-revisions.test.js`, that fails WHEN a non-test source file of the Read Function assigns a string literal to a `cacheScope` property in executable code (Requirement 1.6).
8. WHEN `npx jest` runs in `application-infrastructure/src/lambda/read-function`, THE whole suite SHALL pass, apart from the suites that are skipped today because they need AWS or GitHub access.

### Requirement 6: Cross-reference in the tool catalog

**User Story:** As a developer who later adds per-tier filtering, I want the constraint on the scope to be visible where I make that change, so that a stale `"public"` is not left behind.

#### Acceptance Criteria

1. THE comment in `utils/tool-catalog.js` that states no tier or authentication filtering is applied SHALL gain a sentence saying that `TOOLS_LIST_CACHE_SCOPE` in the Protocol Module is `"public"` because of that, and naming the constant.
2. THE comment SHALL use `>!` security-comment notation.
3. THE change SHALL be comment-only; THE behavior of `buildToolCatalog` SHALL NOT change.

### Requirement 7: Post-deploy verifier

**User Story:** As an operator, I want a deployment that serves an invalid cache scope to fail the pipeline, so that a client does not find out first.

#### Acceptance Criteria

1. THE Verifier SHALL define its allowed scopes as a frozen `public`/`private` pair inside `verify-deployment.js`, with a comment citing the published schema, and SHALL NOT import them from Lambda code or share them with the Fake server.
2. P5.1 and P5.2 SHALL fail WHEN the modern `tools/list` result's `cacheScope` is not `"public"` or `"private"`, with a reason of the form `result.cacheScope is "server", expected "public" or "private"`, using the verifier's existing value formatting and secret redaction.
3. P1.2 SHALL additionally fail WHEN the `server/discover` result's `ttlMs` is not a non-negative integer, or its `cacheScope` is not `"public"` or `"private"`, with reasons in the form of Requirement 7.2 and `result.ttlMs is undefined, expected a non-negative integer`.
4. THE Verifier SHALL assert enum membership and integer shape only. It SHALL NOT assert that `cacheScope` is `"public"`, and SHALL NOT assert the `ttlMs` duration, consistent with Requirement 7.9 of the Smoke spec.
5. THE sub-check catalog SHALL stay at 45 sub-checks, 36 core and 9 advisory. THE System SHALL NOT add, rename, renumber, or reuse a sub-check ID, and SHALL NOT change the report format, the `VERIFY_REPORT` line, or the number of requests the Verifier sends.
6. THE legacy-era sub-checks P5.3 to P5.5 SHALL continue to require that `ttlMs` and `cacheScope` are absent.
7. THE JSDoc of `judgeModernToolsList`, the P5 check function, and the P1 check function SHALL describe the new conditions; the text "non-empty string `cacheScope`" SHALL no longer appear in `verify-deployment.js`.
8. THE Verifier SHALL remain dependency-free CommonJS.

### Requirement 8: Fake server and Verifier tests

**User Story:** As a maintainer, I want the Verifier's tests to prove it catches the defect, and the fake server to model a conformant server, so that the guard is itself guarded.

#### Acceptance Criteria

1. THE Fake server SHALL emit `cacheScope: "public"` on the modern `tools/list`, and SHALL add `ttlMs` (the same value it uses for `tools/list`) and `cacheScope: "public"` to its `server/discover` answer.
2. THE Fake server SHALL define its values itself, from the published schema, and SHALL import nothing from the Read Function.
3. THE Fake server's own tests (`fake-mcp-server-tests.jest.mjs`) SHALL no longer pin `'server'`, and SHALL assert the discover cache hints.
4. THE Verifier tests (`checks-tests.jest.mjs`) SHALL include failure cases for: a modern `tools/list` with `cacheScope` of `"server"` (P5.1) and (P5.2); a `server/discover` with `cacheScope` of `"server"` (P1.2); and a `server/discover` with `ttlMs` missing (P1.2). THE existing P5.2 empty-`cacheScope` case SHALL be updated to the new reason text.
5. EACH failure case SHALL assert the documented reason text and that only the intended sub-check fails.
6. THE tests SHALL keep `EXPECTED_SUB_CHECK_IDS` at the same 45 IDs, and SHALL pass without change to the budget tests.
7. THE new and changed tests SHALL be Jest `*.jest.mjs` files, SHALL call the Jest binary directly, and SHALL NOT run `npm test` or `npm run` from inside a test.
8. WHEN `npm test` runs in `application-infrastructure/tests/postdeploy-verify`, THE whole package SHALL pass.

### Requirement 9: Smoke spec text

**User Story:** As a reader of the Smoke spec, I want it to describe the behavior its Verifier has, so that the spec and the code do not disagree.

#### Acceptance Criteria

1. THE Smoke spec's `requirements.md` SHALL change Requirement 7.2 from "a non-empty string `cacheScope`" to a `cacheScope` equal to `public` or `private`, and SHALL change Requirement 4.2 so that P1 also requires a non-negative integer `ttlMs` and a `cacheScope` equal to `public` or `private`.
2. THE Smoke spec's `design.md` SHALL change the P1.2, P5.1, and P5.2 rows of its sub-check table to match, and SHALL change any other sentence that describes `cacheScope` as a non-empty string.
3. THE Smoke spec's `tasks.md` SHALL NOT be edited, because it records what was done.
4. THE Smoke spec's task 13 (live verification) SHALL NOT be marked or changed by this feature.

### Requirement 10: Dual-era spec history

**User Story:** As a maintainer reading the dual-era spec, I want its design and its runnable script to be correct, so that neither misleads or fails after the fix.

#### Acceptance Criteria

1. THE Dual-era spec's `design.md` SHALL replace `cacheScope: 'server'` with the allowed values at lines 436 and 716 (the `CacheableResult` shape becomes `'public' | 'private'`), and at line 874.
2. THE sentence at line 457 SHALL be rewritten to say that `'public'` means the response is identical for every client, which is true for this stateless, authentication-independent tool manifest, and SHALL link to the caching page.
3. THE `design.md` SHALL gain a one-line note beside the corrected text, dated 2026-10-29, saying that the value was corrected from `'server'` and naming this spec.
4. THE `design.md` description of the `server/discover` result SHALL include `ttlMs` and `cacheScope`.
5. THE Dual-era spec's `TODO-MANUAL-VERIFY.md` SHALL replace the F1 check at line 369 with `check "cacheScope is public" '.result.cacheScope == "public"'`, and SHALL add checks to section C that the discover result's `ttlMs` is 600000 and `cacheScope` is `"public"`.
6. THE Dual-era spec's `tasks.md` and `requirements.md` SHALL NOT be edited.

### Requirement 11: Documentation

**User Story:** As an end user, developer, or operator, I want the documentation to state the real value and where it comes from, so that no page tells me `"server"`.

#### Acceptance Criteria

1. `ARCHITECTURE.md` SHALL add `ttlMs` and `cacheScope` to the modern `server/discover` column of its legacy-versus-modern table, and its explanatory paragraph SHALL say that the cache hints apply to `tools/list` and `server/discover`, that the scope is `public` because the results are identical for every caller, and that the Lambda does not cache `tools/list` itself.
2. `docs/end-user/supported-protocol-revisions.md` SHALL replace the statement that the list is the same for every client (`"server"`) with `"public"`, SHALL say that `server/discover` carries the same two fields, and SHALL keep the statement that legacy responses never include them.
3. `docs/developer/gradual-deployment.md` SHALL replace `cacheScope: "server"` in its `tools/list` bullet with `cacheScope: "public"`.
4. `docs/developer/mcp-protocol-sources.md` SHALL add a row to its table of single sources for the cache scope and its allowed set (`TOOLS_LIST_CACHE_SCOPE`, `CACHE_SCOPES`), and SHALL rename the "Modern `tools/list` cache hint" row to cover `server/discover` as well.
5. `docs/admin-ops/post-deploy-verification.md` and `docs/developer/post-deploy-verification.md` SHALL describe P1 as also checking `server/discover`'s cache hints and P5 as requiring `cacheScope` to be `public` or `private`, and SHALL keep the sub-check ranges and counts unchanged.
6. THE documentation SHALL follow `.kiro/steering/documentation-standards-markdown.md`: relative links, a language on every code fence, and no skipped heading level.
7. THE documentation SHALL NOT describe the scope as operator-configurable.

### Requirement 12: Changelog

**User Story:** As a release manager, I want the release notes to describe the value that ships and record the fix, so that no note documents an invalid value.

#### Acceptance Criteria

1. THE existing Added bullet of `CHANGELOG.md` under `[v0.0.7] (unreleased)` that states `cacheScope: "server"` SHALL be corrected in place by changing only that value to `"public"`. This is the one edit to existing changelog text, made by decision Q5; see "Additions beyond PLAN.md".
2. THE System SHALL add an entry under **Fixed** in `[v0.0.7] (unreleased)`, linked as `[Spec: 0-0-7-tools-list-returns-cachescope-server-which-kiro](../.kiro/specs/0-0-7-tools-list-returns-cachescope-server-which-kiro/)` and to GitHub [#7](https://github.com/63Klabs/atlantis-mcp/issues/7). IT SHALL state that the modern `tools/list` returned `cacheScope: "server"`, which the specification does not allow and which made Kiro reject the result and fail to connect; that it now returns `"public"`; and that `server/discover` now also carries the required `ttlMs` and `cacheScope`.
3. THE Fixed entry SHALL carry a sub-bullet saying that the post-deploy verifier now requires `cacheScope` to be `public` or `private` on `tools/list` and `server/discover` and `ttlMs` on `server/discover`, so a wrong value fails the PostDeploy stage. THE System SHALL NOT edit the Post-Deploy Smoke Verification bullet.
4. THE entry SHALL name the single definition (`TOOLS_LIST_CACHE_SCOPE`) and say that the value is a code constant, not a setting.
5. THE entries SHALL follow `.kiro/steering/changelog-convention.md` and the formatting of the neighbouring v0.0.7 entries, and THE System SHALL change no other existing text and no released version's section.

### Requirement 13: Verification and rollout

**User Story:** As an operator, I want the change proven on `test` before it is promoted, so that the first client to see it is not the reporter.

#### Acceptance Criteria

1. BEFORE the change is committed, THE implementer SHALL run the Read Function suite and the Verifier tests (Requirements 5.8 and 8.8) and record that both pass.
2. THE change SHALL reach `test` through the normal branch flow (`dev` then `test`), with the server fix and the tightened Verifier in the same commit.
3. WHEN the change is deployed to `test`, THE PostDeploy stage SHALL pass, which shows that the deployed server satisfies the tightened P1 and P5 checks. THE implementer SHALL record the outcome.
4. WHEN the PostDeploy stage on `test` passes, THE implementer SHALL point Kiro at the `test` stage, confirm that the tools load, and capture the Kiro MCP log if they do not. THE passing Verifier SHALL NOT be taken as evidence that Kiro accepts the result.
5. THE implementer MAY run the corrected F1 block of the manual script (Requirement 10.5) against `test` as a cross-check; it is not required.
6. THE System SHALL NOT probe the deployed `mcp.atlantis.63klabs.net` stage before the fix is deployed, and SHALL NOT send traffic to any deployed stage other than through the pipeline and the checks in this requirement.
7. THE change SHALL NOT be promoted to `beta` until Requirements 13.3 and 13.4 are met.
8. IF the PostDeploy stage fails on the new checks because a stage still runs the previous build, THEN the failure reason SHALL be sufficient to tell that the observed value is the old one, and the stage SHALL be retried after the new build is deployed.
9. THE rollout SHALL leave the Smoke spec's open live runs (task 13) unaffected; WHEN they are run, THE expected outcomes of 13.1 SHALL be unchanged.

### Requirement 14: Scope boundaries

**User Story:** As a maintainer, I want the boundaries of this change stated, so that follow-up work is not mistaken for work in this spec.

#### Acceptance Criteria

1. THE System SHALL NOT change `template.yml`, `template-openapi-spec.yml`, any CloudFormation parameter, any IAM policy, the buildspecs, or the pipeline.
2. THE System SHALL NOT add a dependency to the Read Function, the Verifier, or the Verifier tests.
3. THE System SHALL NOT validate results against a copy of the published schema. That work is the separate issue at `.kiro/specs/0-0-7-schema-validation-of-modern-results/ISSUE.md`, which holds no PLAN.md, requirements, or tasks.
4. THE System SHALL NOT add a `P1.6` sub-check or change the Verifier's request budget.
5. THE System SHALL NOT make the cache scope or TTL operator-configurable, and SHALL NOT change the TTL value.
6. THE System SHALL NOT edit the Smoke spec's `tasks.md`, the Dual-era spec's `tasks.md` or `requirements.md`, or the issue text in `ISSUE.md`.
7. THE System SHALL NOT commit; the owner reviews `git status` and commits.
