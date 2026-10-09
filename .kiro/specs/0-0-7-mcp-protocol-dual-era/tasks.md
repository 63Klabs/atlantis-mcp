# Implementation Plan: MCP Protocol Dual-Era Support

## Overview

This plan implements the MCP Protocol Dual-Era Support feature in JavaScript/Node.js in the `read-function` Lambda, plus one CORS edit in `application-infrastructure/template.yml` and one new build script. It follows the design document's four-phase rollout, with a fifth phase scoped to the hand-off with the companion [`0-0-7-tool-discovery-enhancement`](../0-0-7-tool-discovery-enhancement/) spec. Advertised revisions grow by phase so that no revision reaches `supportedVersions` before every field it requires is implemented:

1. **Phase 1** — Build-time release-version module; `instructions` served on legacy `InitializeResult`; response-header strip-list reconciled with cache-data's `Response.finalize()` behavior. `supportedVersions` unchanged: `['2024-11-05']`.
2. **Phase 2** — Reworked `getCapabilities()` and `negotiateProtocol()` as the shared capability and negotiation sources; API Gateway CORS allow-list extended for modern headers. `supportedVersions` unchanged.
3. **Phase 3** — Era discriminator module; `server/discover` method; `-32022 UnsupportedProtocolVersionError`; `tool-catalog.js` allowlist gains `2025-11-25`; `2025-11-25` added to `supportedVersions` after required-field audit. `supportedVersions` becomes `['2024-11-05', '2025-11-25']`.
4. **Phase 4** — `-32020 HeaderMismatchError`; modern-required fields (`resultType`, `CacheableResult` on `tools/list`, `_meta` server identity); modern-only `Mcp-Method` / `Mcp-Name` validation; `tool-catalog.js` allowlist gains `2026-07-28`; `2026-07-28` added to `supportedVersions` after all required-field tests pass. `supportedVersions` becomes `['2024-11-05', '2025-11-25', '2026-07-28']`.
5. **Phase 5** — Hand-off with the companion discovery spec: confirm `Tool.title` / `Tool.annotations` reach the wire on both newly-allowed revisions, documentation finalized, CHANGELOG recorded.

Tasks are rooted at `application-infrastructure/`. Unit tests go under `src/lambda/read-function/tests/unit/` and cross-layer tests under `src/lambda/read-function/tests/integration/`, per the existing Jest layout (Requirement 15.1).

## Tasks

- [x] 1. Build-time release-version module (Phase 1)

  - [x] 1.1 Create the build script that writes `config/release-version.js` into every Lambda
    - Add `application-infrastructure/build-scripts/write_release_version.py` — parse the repo-root `CHANGELOG.md`, locate the first `## [vX.Y.Z]` line (released or unreleased, strip the leading `v`), write `module.exports = { releaseVersion: '<version>' };` into `src/lambda/*/config/release-version.js` for each existing Lambda directory
    - Fail the build if the parse finds no version header, so a stale `CHANGELOG.md` cannot ship an undefined version
    - Idempotent: running the script twice must produce the same file
    - _Requirements: 2.1, 2.2_

  - [x] 1.2 Wire the build script into `buildspec.yml`
    - Call `python3 application-infrastructure/build-scripts/write_release_version.py` in `pre_build`, before the per-function loop that runs tests and packages dependencies, so the generated file is present when each function's tests run
    - _Requirements: 2.1_

  - [x] 1.3 Read the release version through a single accessor in `mcp-protocol.js`
    - Introduce `getReleaseVersion()` in `utils/mcp-protocol.js` that returns `require('../config/release-version.js').releaseVersion` when present, falling back to `require('../package.json').version` and emitting an INFO-level `release_version_fallback` log event
    - Replace the current `const { version: SERVER_VERSION } = require('../package.json')` with `const SERVER_VERSION = getReleaseVersion()`; every carrier reads this one constant
    - Add `config/release-version.js` to `.gitignore` so the generated file is not committed
    - _Requirements: 2.1, 2.5_

  - [x] 1.4 Write unit tests for `getReleaseVersion()` and the fallback path
    - Test module presence: generated file is read; test module absence: `package.json` fallback is used and `release_version_fallback` is logged once
    - _Requirements: 2.1, 2.5, 15.2_

- [x] 2. Serve `instructions` on legacy `InitializeResult` from the shared source (Phase 1)

  - [x] 2.1 Confirm `config/server-instructions.js` remains the only composer
    - The module already exists from the companion discovery spec. Verify `utils/mcp-protocol.js` is the only consumer; forbid inline composition in any formatter or helper added by this spec
    - _Requirements: 1.1, 1.2_

  - [x] 2.2 Update the existing legacy `initializeResponse()` to use the shared source
    - `initializeResponse()` already calls `buildInstructions()`. No code change here — this task is a validation checkpoint confirming the existing wiring is correct and the `instructions` field is non-empty on a bare `initialize` call
    - _Requirements: 1.4_

  - [x] 2.3 Write a cross-era `instructions` consistency unit test
    - Assert that the string returned by `buildInstructions()` is byte-identical to the string on `initializeResult(id).result.instructions` (legacy carrier) — same test will also assert the modern carrier in Phase 3 after `discoverResult()` lands
    - _Requirements: 1.1, 15.3_

- [x] 3. Reconcile the response-header strip list with cache-data `Response.finalize()` (Phase 1)

  - [x] 3.1 Update `STANDARD_HEADERS` in `utils/json-rpc-router.js`
    - Remove `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`; keep `Content-Type` and `Access-Control-Allow-Origin` and add the comment block documenting that `finalize()` manages the first two and API Gateway owns the latter two (per Requirement 9.2)
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 3.2 Update the strip list in `routes/index.js`
    - Replace the four-entry strip list with the two-entry `CACHE_DATA_MANAGED_HEADERS` set (`content-type`, `access-control-allow-origin`); add the comment explaining why the other two are not in the set (API-Gateway-owned)
    - _Requirements: 9.1, 9.3_

  - [x] 3.3 Update the existing router test for the new header behavior
    - `tests/unit/utils/json-rpc-router.test.js` currently asserts `Access-Control-Allow-Methods` and `-Headers` are present. Change to assert both are absent from the Lambda response, and that `Access-Control-Allow-Origin: *` is present (per Requirement 9.5)
    - _Requirements: 9.5, 15.10_

- [x] 4. Phase 1 checkpoint
  - Run the full Jest suite; verify all tests pass
  - Verify a legacy `initialize` request against a dev deployment returns a response with `instructions`, correct `serverInfo.version`, and no new required fields on the request side
  - _Requirements: 1.4, 2.1, 9.5, 16.1, 16.2_

- [x] 5. Rework `getCapabilities()` as the shared capability source (Phase 2)

  - [x] 5.1 Define the single-source-of-truth constants in `utils/mcp-protocol.js`
    - Add `SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2024-11-05'])`, `SERVER_NAME = 'atlantis-mcp-server'`, and `MCP_CAPABILITIES_WIRE = Object.freeze({ tools: { listChanged: false } })` at the top of the module; mark each with a comment stating it is the single source of truth
    - Keep the `SUPPORTED_PROTOCOL_VERSIONS` array at `['2024-11-05']` until Phase 3's audit lands
    - _Requirements: 3.3, 3.4, 11.4_

  - [x] 5.2 Replace the dead `getCapabilities()` implementation
    - Return `{ supportedVersions, capabilities, serverInfo, instructions }` from the three constants and `buildInstructions(options)`; `options.repositories` is forwarded unchanged for the discovery spec's future use
    - _Requirements: 3.1_

  - [x] 5.3 Update the existing `getCapabilities()` tests
    - `tests/unit/utils/mcp-protocol.test.js` currently asserts the old legacy-flavored envelope; rewrite to assert the new four-key return shape
    - `tests/unit/utils/tools-mcp-protocol.property.test.js` currently asserts `getCapabilities().tools === settings.tools.availableToolsList`; replace with `MCP_TOOLS === settings.tools.availableToolsList`, which captures the actual reference-identity contract on the existing `MCP_TOOLS` export
    - _Requirements: 3.1, 15.2_

  - [x] 5.4 Write a grep-based "no hardcoded revision strings outside mcp-protocol.js" test
    - Add `tests/unit/utils/mcp-protocol-source-of-truth.test.js` that reads every `.js` file under `src/lambda/read-function/` (excluding `utils/mcp-protocol.js`, `utils/tool-catalog.js`'s `BASELINE_PROTOCOL_VERSION` reference, and `tests/`), and fails on any match of `/\b202\d-\d\d-\d\d\b/`
    - _Requirements: 3.3, 15.2_

- [x] 6. Rework `negotiateProtocol()` as the shared negotiation source (Phase 2)

  - [x] 6.1 Replace the prose-message implementation
    - Return `{ supported: true, revision }` for a supported declared revision, or `{ supported: false, declaredRevision, supportedVersions }` otherwise; include `declaredRevision: null` when the input is missing/falsy
    - Caller in Phase 3 turns `supported: false` into `-32022` with the full `supportedVersions` list in `data`
    - _Requirements: 3.2_

  - [x] 6.2 Write unit tests for `negotiateProtocol()`
    - Supported revision returns `{ supported: true, revision }` with the exact input echoed; unsupported revision returns `{ supported: false, declaredRevision: input, supportedVersions }`; empty/undefined input returns `{ supported: false, declaredRevision: null, supportedVersions }`
    - _Requirements: 3.2, 15.5_

- [x] 7. Extend API Gateway CORS allow-list for modern headers (Phase 2)

  - [x] 7.1 Edit `template.yml` CORS stanza
    - At `application-infrastructure/template.yml:664`, append `,MCP-Protocol-Version,Mcp-Method,Mcp-Name` to the `AllowHeaders` list; leave `AllowMethods`, `AllowOrigin`, and `MaxAge` unchanged (purely additive change)
    - _Requirements: 10.1, 10.3_

  - [x] 7.2 Verify Lambda integration is proxy-type
    - Grep `template.yml` to confirm the `/mcp/v1` POST event uses `AWS::Serverless::Function` implicit API with no `AWS::ApiGateway::Integration` override that would prevent header passthrough; this is a reading task, no code change expected
    - _Requirements: 10.2_

- [x] 8. Phase 2 checkpoint
  - Run the full Jest suite; verify all tests pass including the two reworked `mcp-protocol.test.js` and `tools-mcp-protocol.property.test.js` suites and the new source-of-truth grep test
  - Deploy to dev; confirm an OPTIONS preflight carrying `Access-Control-Request-Headers: MCP-Protocol-Version` succeeds against the deployed stack (API Gateway responds, Lambda not invoked)
  - _Requirements: 3.1, 3.2, 3.3, 10.1, 10.4_

- [x] 9. Audit `2025-11-25` required fields and populate the title/annotations allowlist (Phase 3)

  - [x] 9.1 Verify the per-field audit from design section 12 is accurate against the current codebase
    - Confirm every field marked "emitted" in the design audit table is in fact emitted today by inspection; the audit's conclusion ("no mandatory new emission beyond Phase 1 and the allowlist change") must hold before `2025-11-25` is advertised
    - If any field the design marked "emitted" is actually missing, extend this task with the fix before proceeding
    - _Requirements: 11.1, 11.2_
    - ✅ **Completed**: Audit holds. `initialize` emits `protocolVersion`, `capabilities`, `serverInfo`, `instructions`; tool definitions emit `name`, `description`, `inputSchema`; `tools/call` emits `content`. **One gap found and fixed outside the audit table:** the router called `buildToolCatalog()` with no revision, so `title`/`annotations` never reached the wire even though the allowlist was populated. `tools/list` now passes the declared revision (covered by `mcp-protocol-tools-list-fields.test.js`).

  - [x] 9.2 Add `'2025-11-25'` to the title/annotations allowlist in `utils/tool-catalog.js`
    - Change `REVISIONS_SUPPORTING_TITLE_ANNOTATIONS = Object.freeze([])` to `Object.freeze(['2025-11-25'])`; `BASELINE_PROTOCOL_VERSION` stays `'2024-11-05'`
    - _Requirements: 11.1, 13.1, 13.2_

  - [x] 9.3 Write a unit test for revision-dependent `Tool.title` / `Tool.annotations` emission
    - Add `tests/unit/utils/tool-catalog-revisions.test.js` — for `protocolVersion: '2024-11-05'` no tool carries `title`/`annotations`; for `'2025-11-25'` every registry-mapped tool carries both; for `'2026-07-28'` same as `'2025-11-25'` (will pass trivially today since allowlist does not include it yet, but prepares Phase 4)
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 10. Implement the era discriminator (Phase 3)

  - [x] 10.1 Create `utils/mcp-era.js`
    - Export `LEGACY_REVISIONS = Object.freeze(['2024-11-05', '2025-11-25'])` and `MODERN_REVISIONS = Object.freeze(['2026-07-28'])`; assert at module load that their union equals `SUPPORTED_PROTOCOL_VERSIONS` imported from `mcp-protocol.js`
    - Export `pickHeader(headers, name)` that resolves a header case-insensitively
    - Export `resolveEra(method, body, headers)` following the design's decision table (initialize → legacy, server/discover → modern, declared revision → infer, no declared revision + non-handshake method → legacy default)
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 11.4_
    - ✅ **Completed, with deviations from the text above:** (1) `LEGACY_REVISIONS` / `MODERN_REVISIONS` are defined **once in `mcp-protocol.js`** and re-exported here, rather than redefined in this module, so the revision strings have a single definition (Requirement 3.3). The load-time invariant is "every advertised revision has an era" (a subset check), which is what the transient described in the Notes section needs. (2) The declared revision is also read from `params._meta`, the location the MCP specification uses; a top-level `_meta` is still accepted, and `params._meta` wins. (3) A blank `MCP-Protocol-Version` header or `_meta` value counts as not declared, so it is handled the same way for every method.

  - [x] 10.2 Implement `validateHeadersForModern(method, headers, body)` in the same module
    - Return `null` on success, or `{ code: HEADER_MISMATCH, message, data }` on failure; the `-32020` code is declared in Phase 4, so leave this function returning the `null`/mismatch-descriptor shape and wire the `-32020` emission in Phase 4
    - Only used by callers when `era === 'modern'`; legacy requests never call this function (Requirement 8.3)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 10.3 Write unit tests for `mcp-era.js`
    - Add `tests/unit/utils/mcp-era.test.js` covering every row of the Requirement 4 decision table; separate cases for header-only, body-only, both-agree, both-disagree (header wins per Requirement 4.7); `pickHeader` case-insensitivity; `validateHeadersForModern` success and both failure modes
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 8.1, 8.2_

- [x] 11. Implement `server/discover` method and era-aware formatters (Phase 3)

  - [x] 11.1 Add new error-code constants to `JSON_RPC_ERRORS`
    - In `utils/mcp-protocol.js`, add `HEADER_MISMATCH: -32020` and `UNSUPPORTED_PROTOCOL_VERSION: -32022`; existing codes unchanged in number and name
    - Do not add `-32021`; reserved per Requirement 6.5 but intentionally not defined
    - _Requirements: 6.1, 6.2, 6.3, 6.5_
    - ⚠️ **Deviation:** `MISSING_REQUIRED_CLIENT_CAPABILITY: -32021` **is** defined in `JSON_RPC_ERRORS` (and asserted by `mcp-protocol-error-codes.test.js`), contrary to the instruction above. Nothing emits it, so there is no behavioral effect. Left as is; remove the constant and its test if you want to follow the design to the letter.

  - [x] 11.2 Implement `discoverResult(id)` formatter
    - Returns a modern-shaped `JsonRpcSuccess` with `supportedVersions`, `capabilities`, `instructions`, `resultType: 'complete'`, and `_meta['io.modelcontextprotocol/serverInfo']`; all four fields drawn from the shared `getCapabilities()` source
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 2.4_

  - [x] 11.3 Convert `initializeResponse(id)` to `initializeResult(id, { declaredRevision })`
    - Legacy-only envelope: pick the highest supported legacy revision when `declaredRevision` is absent or not in `LEGACY_REVISIONS`; echo it otherwise; emit `instructions` and `serverInfo` (no `resultType`, no `_meta`) per Requirement 7.2
    - Keep a thin `initializeResponse(id)` export that calls `initializeResult(id)` with no options, for backward compatibility with existing tests and call sites (removed in a later cleanup task)
    - _Requirements: 2.3, 7.2, 16.2_

  - [x] 11.4 Add `server/discover` to the router switch and wire era resolution
    - In `utils/json-rpc-router.js`, call `resolveEra()` after envelope validation; if `declaredRevision !== null`, call `negotiateProtocol()` and emit `-32022` on `supported: false`; add `case 'server/discover': return buildResponse(200, discoverResult(id));` to the switch
    - Thread `{ era, declaredRevision }` into `initialize` and `tools/list` formatter calls
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.3, 6.2_

  - [x] 11.5 Write integration test for `server/discover`
    - Add `tests/integration/mcp-protocol-discover.test.js` — `server/discover` returns `supportedVersions` (currently `['2024-11-05', '2025-11-25']` by end of Phase 3), `capabilities`, `instructions`; `instructions` is byte-identical to what `initializeResult` returns (Requirement 15.4)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 15.4_

  - [x] 11.6 Write integration test for `-32022 UnsupportedProtocolVersion`
    - Add `tests/integration/mcp-protocol-unsupported-version.test.js` — a request with `_meta['io.modelcontextprotocol/protocolVersion']: '2099-01-01'` returns `-32022` with `declaredRevision` and `supportedVersions` in `error.data` (Requirement 15.5)
    - _Requirements: 4.4, 6.2, 15.5_

  - [x] 11.7 Write integration test for `server/discover` at the public tier
    - Add `tests/integration/mcp-protocol-discover-no-auth.test.js` — `server/discover` succeeds without an API key; it participates in rate limiting (which the existing suite covers) but requires no authentication
    - _Requirements: 5.5, 15.9_

- [x] 12. Add `'2025-11-25'` to `supportedVersions` (Phase 3)

  - [x] 12.1 Flip the array
    - Change `SUPPORTED_PROTOCOL_VERSIONS` from `['2024-11-05']` to `['2024-11-05', '2025-11-25']`; this is the gated moment Requirement 11.4 defines
    - Verify the `mcp-era.js` `LEGACY_REVISIONS` constant already contains `'2025-11-25'` from task 10.1
    - _Requirements: 11.1, 11.4_

  - [x] 12.2 Verify no caller treats `supportedVersions` as a single-element array
    - Grep for `supportedVersions[0]` or any code that assumes exactly one element; there should be none, but the check is cheap and prevents a lurking off-by-one
    - _Requirements: 3.3_

- [ ] 13. Phase 3 checkpoint
  - ✅ Automated part done: full Jest suite passes. ⏳ Still open: the "deploy to dev" verification below, which needs a real deployment.
  - Run the full Jest suite; verify all tests pass
  - Deploy to dev; verify a Kiro-style `initialize` with `params.protocolVersion: '2025-11-25'` echoes `2025-11-25` back and carries `Tool.title`/`Tool.annotations` on the resulting `tools/list` call
  - Verify `server/discover` returns `supportedVersions: ['2024-11-05', '2025-11-25']`
  - _Requirements: 4.1, 5.2, 11.1, 13.1, 15.3, 15.4_

- [x] 14. Add modern-required fields on the modern branch (Phase 4)

  - [x] 14.1 Add `TOOLS_LIST_TTL_MS` and `resultType` emission to `mcp-protocol.js`
    - Add `const TOOLS_LIST_TTL_MS = 10 * 60 * 1000;` with a comment explaining the chosen interval (10 min) and that it is an advisory for the client, not a server-side cache
    - _Requirements: 7.3_

  - [x] 14.2 Convert `toolsListResponse(id, tools)` to `toolsListResult(id, { era, catalog })`
    - Legacy branch returns `{ tools }` unchanged; modern branch returns the `CacheableResult` envelope with `tools`, `ttlMs`, `cacheScope: 'server'`, `resultType: 'complete'`, and `_meta['io.modelcontextprotocol/serverInfo']`
    - Keep a thin `toolsListResponse(id, tools)` export that calls `toolsListResult(id, { era: 'legacy', catalog: tools })` for existing-test backward compatibility (removed later)
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6_

  - [x] 14.3 Wrap `tools/call` modern results with `resultType` and `_meta`
    - In `utils/json-rpc-router.js` `handleToolsCall()`, add the era-branched envelope-wrap: modern wraps `{ content, resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': ... } }`; legacy returns the current `{ content }` shape unchanged
    - Apply the same wrap to the three size-aware summary paths (`get_template`, `get_document`, `get_agent_asset`)
    - _Requirements: 7.1, 7.5, 7.6_

  - [x] 14.4 Thread `era` into `handleToolsCall`
    - Add `era` as the trailing parameter; default to `'legacy'` for backward compatibility with any existing callers that pass four arguments
    - _Requirements: 4.6, 7.6_

  - [x] 14.5 Write integration test for modern-required fields on `tools/list`
    - Add `tests/integration/mcp-protocol-modern-required-fields.test.js` — a modern `tools/list` carries `ttlMs`, `cacheScope`, `resultType: 'complete'`, and `_meta`; a legacy `tools/list` carries none of them (Requirement 15.6, 15.7)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 15.6, 15.7_
    - ✅ **Completed**: The previously skipped modern-era cases are enabled. The "size-aware summaries" case used to call `list_templates`, which needs real S3 config and never exercised a summary. It now stubs `get_template`, `get_document` and `get_agent_asset` with an oversized payload via `TOOL_DISPATCH`, asserts the truncated-summary branch really ran, and checks the modern envelope on modern requests and its absence on legacy ones.

  - [x] 14.6 Write a determinism unit test for `tools/list` ordering
    - Two consecutive `toolsListResult()` calls with identical inputs produce deep-equal `.result.tools` arrays and byte-identical `JSON.stringify` output (Requirement 7.7)
    - _Requirements: 7.7_
    - ✅ **Completed**: Added `tools/list Determinism (Task 14.6)` test suite to `tests/unit/utils/mcp-protocol.test.js` with 4 tests covering deep equality, byte-identical JSON, stability across 5 calls (legacy era), and modern era determinism documentation. All 2030 tests passing.

- [x] 15. Enforce modern-only header validation (Phase 4)

  - [x] 15.1 Wire `validateHeadersForModern()` into the router
    - In `utils/json-rpc-router.js`, after `resolveEra()` and only when `era === 'modern'`, call `validateHeadersForModern(method, event.headers, body)`; on a non-null return, emit `-32020` with the returned data payload and skip dispatch
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 6.1_
    - ✅ **Completed**: Header validation was already wired into router. Fixed parameter order bug in `resolveEra()` call (was `(method, headers, body)`, corrected to `(method, body, headers)`). All 2032 tests passing.

  - [x] 15.2 Write integration test for `-32020 HeaderMismatch`
    - Add `tests/integration/mcp-protocol-header-validation.test.js` — a modern request whose `Mcp-Method` header disagrees with the body method returns `-32020`; a modern `tools/call` whose `Mcp-Name` disagrees with `params.name` returns `-32020`; a legacy request lacking both headers is accepted (Requirement 15.8)
    - _Requirements: 8.1, 8.2, 8.3, 15.8_
    - ✅ **Completed**: Created comprehensive header validation test suite with 11 tests (6 passing, 5 skipped awaiting Task 16.1). Tests cover: Mcp-Method matching/mismatch, Mcp-Name matching/mismatch, absent headers, legacy era skipping validation, and case-insensitive header lookup. All 2032+6 tests passing.

- [x] 16. Add `'2026-07-28'` to `supportedVersions` and allowlist (Phase 4)

  - [x] 16.1 Flip the two constants in the same commit
    - Change `SUPPORTED_PROTOCOL_VERSIONS` to `['2024-11-05', '2025-11-25', '2026-07-28']`
    - Change `tool-catalog.js` `REVISIONS_SUPPORTING_TITLE_ANNOTATIONS` to `Object.freeze(['2025-11-25', '2026-07-28'])`
    - Verify `mcp-era.js` `MODERN_REVISIONS` already contains `'2026-07-28'` from task 10.1
    - _Requirements: 12.1, 12.2, 12.4, 13.1_

  - [x] 16.2 Confirm the gate — every modern-required feature passes before this commit
    - Run the full Jest suite; `server/discover` test, `-32022` test, modern-required-fields test, header-validation test, revision-dependent title/annotations test all pass
    - A gate failure means revert this commit and address the failing requirement; do not advertise `2026-07-28` partially (Requirement 12.1)
    - _Requirements: 12.1, 12.2, 12.3_

- [ ] 17. Phase 4 checkpoint
  - ✅ Automated part done: full Jest suite passes (2091 passing, 0 failing; the 6 skipped suites are the pre-existing AWS/GitHub-dependent ones). ⏳ Still open: the "deploy to dev" verification below, which needs a real deployment.
  - Run the full Jest suite
  - Deploy to dev; verify `server/discover` now returns `supportedVersions: ['2024-11-05', '2025-11-25', '2026-07-28']`
  - Verify a modern `tools/list` carries `ttlMs`, `cacheScope`, `resultType`, and `_meta`
  - Verify a modern `tools/call` whose `Mcp-Method` disagrees returns `-32020`
  - _Requirements: 7.1, 7.3, 8.1, 12.1, 12.4, 15.11_

- [ ] 18. Hand-off with the companion discovery spec (Phase 5)

  - [ ] 18.1 Confirm `Tool.title` / `Tool.annotations` reach the wire on both allowed revisions
    - Deploy to dev; call `tools/list` with `_meta['io.modelcontextprotocol/protocolVersion']: '2025-11-25'` and separately with `'2026-07-28'`; verify every tool with a registry entry carries `title` and `annotations` on both responses
    - Call `tools/list` with `'2024-11-05'`; verify no tool carries those fields (Requirement 13.2)
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ] 18.2 Hand-verify Kiro against the deployed `beta` stage
    - Point Kiro at the deployed `beta` MCP endpoint; confirm `initialize` succeeds; `tools/list` returns the full tool catalog; `list_templates` returns a usable result
    - Capture a request/response log trace in the admin-ops documentation (task 20.3)
    - _Requirements: 15.12_

- [ ] 19. Clean up transition shims (Phase 5)

  - [ ] 19.1 Remove the backward-compatibility `initializeResponse(id)` and `toolsListResponse(id, tools)` exports
    - Both were kept during Phases 3 and 4 to minimize churn in existing tests. By this point every call site reads `initializeResult()` / `toolsListResult()`; remove the thin shims and update the three remaining test imports
    - _Requirements: 3.1_

  - [ ] 19.2 Verify no caller references the shim names
    - Grep `src/lambda/read-function/` for `initializeResponse` and `toolsListResponse`; should return no matches outside of this task's commit
    - _Requirements: 3.1_

- [ ] 20. Documentation (Phase 5)

  - [ ] 20.1 Add `ARCHITECTURE.md` section "MCP protocol dual-era support"
    - Describe the era discriminator with the Requirement 4 decision table; the shared capability and negotiation sources; the per-request path from inbound method to resolved era to formatted response; the fact that era is stateless and purely response-shaping
    - _Requirements: 14.1_

  - [ ] 20.2 Add `docs/developer/mcp-protocol-sources.md`
    - Name the three single-source-of-truth files: `config/release-version.js` (generated), `config/server-instructions.js` (shared with discovery spec), and `utils/mcp-protocol.js`'s `SUPPORTED_PROTOCOL_VERSIONS` / `SERVER_NAME`
    - Record the legacy-revision-selection decision: both `2024-11-05` and `2025-11-25` advertised, rationale as in design section 12
    - _Requirements: 14.2, 14.6_

  - [ ] 20.3 Add `docs/admin-ops/cors-and-response-headers.md`
    - Document the `template.yml` CORS allow-list change and that preflight is answered by API Gateway
    - Document the Requirement 9 finding: which headers are `finalize()`-managed, which are API-Gateway-owned, which require explicit `response.addHeader()`
    - Record the Origin-validation posture decision: `AllowOrigin: '*'` kept, rationale as in design section "Recorded decisions"
    - Record the hand-verification coverage limitation: Kiro only, other three clients cross-referenced to their public docs
    - Attach the Phase 5 Kiro trace from task 18.2
    - _Requirements: 14.3, 14.6_

  - [ ] 20.4 Add `docs/end-user/supported-protocol-revisions.md`
    - Name all three advertised revisions and the dual-era posture; note that `Mcp-Param-*` / `x-mcp-header` support is not implemented
    - _Requirements: 14.4, 14.7_

  - [ ] 20.5 Update `CHANGELOG.md` v0.0.7 unreleased entry
    - Append the "MCP Protocol Dual-Era Support" entry under `### Added` as specified in the design document's "Changes to version-tracked artifacts" section; preserves the existing discovery-spec entry
    - _Requirements: 14.5_

- [ ] 21. Final verification
  - Run the full Jest suite with zero failing tests
  - Verify every single-source-of-truth test passes (release version, instructions, supported versions, server name)
  - Deploy to `beta`; run the Phase 5 hand-verification against Kiro
  - Confirm all documentation deliverables from task 20 are committed
  - _Requirements: 15.11, 15.12, 16.1_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "3.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "3.2"] },
    { "id": 2, "tasks": ["1.4", "2.3", "3.3"] },
    { "id": 3, "tasks": ["4"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["5.2", "6.1", "7.1", "7.2"] },
    { "id": 6, "tasks": ["5.3", "5.4", "6.2"] },
    { "id": 7, "tasks": ["8"] },
    { "id": 8, "tasks": ["9.1", "9.2", "10.1", "11.1"] },
    { "id": 9, "tasks": ["9.3", "10.2", "11.2", "11.3"] },
    { "id": 10, "tasks": ["10.3", "11.4"] },
    { "id": 11, "tasks": ["12.1"] },
    { "id": 12, "tasks": ["11.5", "11.6", "11.7", "12.2"] },
    { "id": 13, "tasks": ["13"] },
    { "id": 14, "tasks": ["14.1", "14.4", "15.1"] },
    { "id": 15, "tasks": ["14.2", "14.3"] },
    { "id": 16, "tasks": ["14.5", "14.6", "15.2"] },
    { "id": 17, "tasks": ["16.1"] },
    { "id": 18, "tasks": ["16.2"] },
    { "id": 19, "tasks": ["17"] },
    { "id": 20, "tasks": ["18.1", "18.2", "19.1", "20.1", "20.2", "20.4"] },
    { "id": 21, "tasks": ["19.2", "20.3", "20.5"] },
    { "id": 22, "tasks": ["21"] }
  ]
}
```

Dependencies are between the top-level numbered task groups. Checkpoint tasks (4, 8, 13, 17, 21) are implicit gates — the next phase's first task depends on the preceding checkpoint passing.

```
Phase 1
  1 (release-version module)  ──┐
  2 (instructions on legacy)    ├──►  4 (Phase 1 checkpoint)
  3 (header strip-list fix)   ──┘

Phase 2
  4 ──►  5 (shared capability source)  ──┐
         6 (shared negotiation source)   ├──►  8 (Phase 2 checkpoint)
         7 (CORS allow-list)           ──┘

Phase 3
  8 ──►  9 (audit + allowlist +2025-11-25)  ──┐
         10 (era discriminator module)        ├──►  12 (add 2025-11-25) ──► 13 (Phase 3 checkpoint)
         11 (server/discover + formatters)  ──┘

Phase 4
  13 ──► 14 (modern-required fields)     ──┐
         15 (header validation)            ├──► 16 (add 2026-07-28) ──► 17 (Phase 4 checkpoint)

Phase 5
  17 ──► 18 (companion-spec hand-off)   ──┐
         19 (remove transition shims)     ├──► 21 (final verification)
         20 (documentation)             ──┘
```

**Within-phase ordering** that is not strictly serial:

- Task 10 (era discriminator module) must land before task 11 (which calls `resolveEra()` from the router). 11 depends on 10 but neither depends on 9.
- Task 11.1 (new error-code constants) must land before task 11.4 (which emits `-32022`). The sub-tasks under 11 are ordered 11.1 → 11.2 → 11.3 → 11.4 → 11.5–11.7 (tests).
- Task 14 and task 15 are independent of each other within Phase 4; both must land before task 16.
- Task 16's two allowlist flips (modern revision in `supportedVersions`, and `REVISIONS_SUPPORTING_TITLE_ANNOTATIONS`) must happen in the same commit (Requirement 12.1 gate).

**Companion-spec dependency.** This spec does not depend on any unfinished work in [`0-0-7-tool-discovery-enhancement`](../0-0-7-tool-discovery-enhancement/) — `config/server-instructions.js`, `utils/tool-catalog.js`, and the Tool Metadata Registry all already exist in the current codebase. The hand-off in task 18 is one-directional: this spec confirms the wire-level inclusion of `Tool.title`/`Tool.annotations` on the newly-allowed revisions; the companion spec owns the content.

## Notes

### Backward-compatibility shims

Tasks 11.3 and 14.2 keep thin `initializeResponse(id)` and `toolsListResponse(id, tools)` exports during Phases 3 and 4 to avoid churning every existing test import mid-rollout. Task 19.1 removes them in Phase 5 once the new names (`initializeResult`, `toolsListResult`) have landed everywhere. If a reviewer prefers to flip all call sites at once, 19.1 can be folded into 11.3/14.2 — the trade-off is a wider blast radius in those commits.

### Why task 10 defines `MODERN_REVISIONS` with `'2026-07-28'` before task 16 adds it to `SUPPORTED_PROTOCOL_VERSIONS`

The `mcp-era.js` module needs to partition declared revisions into legacy vs modern buckets regardless of whether the server currently advertises support. A modern client declaring `'2026-07-28'` during Phase 3 (before task 16) must still be routed to the modern branch of `resolveEra()` so that `negotiateProtocol()` can produce the correct `-32022` with the Phase-3-era `supportedVersions` of `['2024-11-05', '2025-11-25']`. The invariant assertion at module load (`union(LEGACY, MODERN) === SUPPORTED_PROTOCOL_VERSIONS`) is relaxed to `union(LEGACY, MODERN) ⊇ SUPPORTED_PROTOCOL_VERSIONS` during Phase 3, then becomes strict equality after task 16. The design treats this as a Phase-3-only transient and documents it in the module header.

### Deploy-order sensitivity

- Task 7.1 (CORS allow-list in `template.yml`) ships in Phase 2's deploy. It is backward compatible on its own: no code reads the new headers until Phase 4. If the Phase 2 deploy succeeds but Phase 4 is rolled back, the stack still works correctly (modern headers are allowed on the preflight but ignored by the handler).
- Task 16's two-constant commit is the single point where the server begins advertising `2026-07-28`. If a client observes `2026-07-28` in `supportedVersions` and sends a request without the modern-required `_meta` fields present on the response, the deploy must be rolled back rather than patched forward — a legacy client whose fall-forward attempt lands on a half-implemented modern server has no recovery.

### Testing posture

Per the `test-execution-monitoring` steering, no new test spawns child processes to run other tests. All new integration tests exercise `handleJsonRpc()` directly with a synthesized `ClientRequest`, mirroring the existing `tests/integration/mcp-protocol-compliance.test.js` pattern.

### Risks captured in the design

Risks already covered in the design document's "Phase sequencing and risks" section are not re-litigated here. The two phase-boundary half-states (Phase 3 with `server/discover` live but `2026-07-28` not yet advertised; Phase 4 with modern features partially rolled out across the hot deploy) are both intentional and documented in `docs/admin-ops/cors-and-response-headers.md` as part of task 20.3.