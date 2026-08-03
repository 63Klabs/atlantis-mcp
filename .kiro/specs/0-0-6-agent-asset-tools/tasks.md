# Implementation Plan

## Overview

This plan converts the Agent Assets MCP Tools design into an incremental, test-driven build for
the `read-function` Lambda (`application-infrastructure/src/lambda/read-function/`). It is
implemented in JavaScript/Node.js, following the existing MVC layering and the
`@63klabs/cache-data` conventions already used by the template and starter tools.

Work proceeds bottom-up so no step depends on code built later: registry → shared S3 helper →
DAO → service → controller → caching config → single-point wiring → integration. Each step ends
by integrating into the layer above it; the four generated wiring hooks make the tools
discoverable and callable end-to-end. Property-based tests (fast-check, mocked S3, ≥100 runs)
implement the design's correctness properties P1–P14 (P15 is deferrable with Requirement 9), and
example/edge unit tests plus cross-layer integration tests round out coverage. All tests are Jest
`*.test.js` / `*.property.test.js` files under the read-function's existing `tests/` layout, mock
S3 (no live AWS), and restore mocks in `afterEach`.

Sub-tasks postfixed with `*` are optional test tasks that may be skipped for a faster MVP but are
required before the change is considered complete (Requirement 11.5). The large-asset slice
(Task 10) is deferrable so the core tools can ship first.

## Tasks

- [x] 1. Registry — `config/agent-asset-types.js`
  - [x] 1.1 Implement the `AGENT_ASSET_TYPES` registry and fail-fast `validateRegistry()`
    - Create `config/agent-asset-types.js` with `AGENT_ASSET_TYPES`: `steering` (`.md`), `hooks` (`.kiro.hook`, `.json`), `agents-md` (folder `agents_md`, `.md`) enabled, and `skills` (`.md`) with `enabled: false`; each entry declares non-empty `name`, `toolToken`, `folder`, `extensions`, `description`
    - Implement `validateRegistry()` to enforce the five required non-empty fields and uniqueness of `name`/`toolToken`/`folder`, throwing an `Error` that names the offending entry; invoke it once at module load so a malformed registry exposes no tools
    - _Requirements: 5.1, 5.5, 5.7_
  - [x] 1.2 Implement the lookup and generator helpers
    - Add `getEnabledTypes`, `getEnabledTypeNames`, `getTypeByName`, `resolveEnabledType` (returns entry only for an enabled type; `null` for unknown/disabled)
    - Add `generateToolDefinitions`, `generateSchemas`, `generateExtendedDescriptions`, `getToolDispatch(controller)` for the always-on tools `list_agent_assets` (optional `assetType` enum), `get_agent_asset` (required `assetType` enum + required `name`), and `list_agent_asset_types` (no params); inject the `assetType` enum from `getEnabledTypeNames()` and reuse the template parameter shapes (`name` `^[^/\\]+$` 1–255, `namespace`, `s3Buckets`) with `additionalProperties: false`
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.5, 7.1, 7.2, 7.8_
  - [x] 1.3 Write unit tests for the shipped registry and generated artifacts
    - Assert the shipped registry satisfies the required shape (5.1); `skills` is disabled and absent from the generated `assetType` enum while the fixed tools still exist (5.5); a synthetic enabled entry adds exactly one accepted `assetType` value and creates no new tool (5.4)
    - File: `tests/unit/config/agent-asset-types.test.js`
    - _Requirements: 5.1, 5.4, 5.5_
  - [x] 1.4 Write property test for registry validation
    - **Property 13: Registry validation**
    - **Validates: Requirements 5.7**
    - fast-check, ≥100 runs; generate entries missing a required field or duplicating `name`/`toolToken`/`folder` and assert `validateRegistry()` throws identifying the offending entry and exposes no tools; tag `Feature: agent-asset-tools, Property 13`
    - File: `tests/unit/config/agent-asset-types-validation.property.test.js`
    - _Requirements: 5.7_
  - [x] 1.5 Write property test for fixed-tool and `assetType`-enum generation
    - **Property 12: Registry-driven fixed tools and assetType enum**
    - **Validates: Requirements 5.2, 5.4, 5.5, 6.1, 6.5**
    - fast-check, ≥100 runs; assert generation always yields the fixed tool set (each with schema, non-empty description, dispatch entry), the `assetType` enum equals exactly the enabled names, and enabling one entry adds exactly one accepted value with no new tool; tag `Feature: agent-asset-tools, Property 12`
    - File: `tests/unit/config/agent-asset-types-generation.property.test.js`
    - _Requirements: 5.2, 5.4, 5.5, 6.1, 6.5_

- [x] 2. Shared S3 helper — `models/s3-common.js`
  - [x] 2.1 Implement the extracted `checkBucketAccess` and `getIndexedNamespaces`
    - Create `models/s3-common.js` with implementations behavior-equivalent to the private helpers in `models/s3-templates.js`/`models/s3-starters.js`, using `AWS.s3.client` from `@63klabs/cache-data` and logging failures via `utils/error-handler.js` `logS3Error(...)`; do NOT modify the existing template/starter DAOs
    - _Requirements: 5.6, 4.2, 4.4_
  - [x] 2.2 Register `S3Common` in the `models/index.js` barrel
    - Export the new module so downstream layers consume it from the barrel
    - _Requirements: 5.6_
  - [x] 2.3 Write unit tests for `s3-common` behavior equivalence
    - Assert `checkBucketAccess` and `getIndexedNamespaces` behave equivalently to the existing DAO helpers; mock the S3 getter (`jest.spyOn(tools.default.AWS, 's3', 'get')`) and restore in `afterEach`
    - File: `tests/unit/models/s3-common.test.js`
    - _Requirements: 5.6_
  - [x] 2.4 Confirm the existing DAO suites remain green after extraction
    - Run only the existing `s3-templates` and `s3-starters` model test files (scoped, no recursive full-suite run) to confirm the extraction left those DAOs unchanged
    - _Requirements: 5.6, 11.5_

- [x] 3. Data access object — `models/s3-agent-assets.js`
  - [x] 3.1 Implement the pure DAO helpers
    - Create `models/s3-agent-assets.js` with `buildAssetKey(namespace, basePath, folder, name)` (prefix-scoped key), `filterByExtension(filename, extensions)`, `deduplicateAssets(assets)` (first occurrence per `(type, name)` wins), `parseAssetMetadata(s3Object, bucket, namespace, type)`, and `computeSha256(buffer)` using the Node built-in `crypto` module (lowercase hex, no shell); export helpers for testing
    - _Requirements: 4.7, 7.3, 1.4, 1.5, 2.3, 3.4_
  - [x] 3.2 Implement the generic `list(connection, options)`
    - Iterate `connection.parameters.assetTypes` in registry order, then `connection.host` (bucket) order, then indexed namespaces (via `S3Common.getIndexedNamespaces`); use `ListObjectsV2Command` with `Delimiter: '/'` and keep only direct-child objects whose filename matches the type's `extensions`, excluding the prefix placeholder and `CommonPrefixes`; sort names ascending, dedup on `(type, name)`, and apply brown-out (skip inaccessible/failed sources, populate `errors`, set `partialData`); default `basePath` to `utilities/v2/agent_assets`
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 4.2, 4.3, 4.4, 4.8_
  - [x] 3.3 Implement the generic `get(connection, options)` and register the DAO
    - Return the first-occurrence asset for `(assetType, name)` in bucket-then-namespace order via `GetObjectCommand` (latest version, no `VersionId`); read exact bytes with `Body.transformToByteArray()`, set `size`/`etag`/`sha256`/`content`, and return `null` when not found in any read source; export `list`, `get`, and the pure helpers, and register `S3AgentAssets` in `models/index.js`
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 3.2, 3.4, 4.8_
  - [x] 3.4 Write DAO example/edge/error unit tests
    - With mocked S3: empty listing returns an empty list and no error (1.3); `get` issues a latest-version `GetObject` with no `VersionId` (2.5); a missing asset returns `null` (feeds `ASSET_NOT_FOUND`, 2.4); a `name` containing `/` or `\` is rejected before any S3 read (7.3); a representative brown-out example; restore mocks in `afterEach`
    - File: `tests/unit/models/s3-agent-assets-dao.test.js`
    - _Requirements: 1.3, 2.4, 2.5, 4.2_
  - [x] 3.5 Write property test for direct + extension-matching listing
    - **Property 1: Listing includes exactly the direct, extension-matching objects**
    - **Validates: Requirements 1.1, 1.5**
    - fast-check, ≥100 runs, mocked S3; tag `Feature: agent-asset-tools, Property 1`
    - File: `tests/unit/models/s3-agent-assets-direct-listing.property.test.js`
    - _Requirements: 1.1, 1.5_
  - [x] 3.6 Write property test for list-item completeness
    - **Property 2: List-item completeness**
    - **Validates: Requirements 1.2, 3.1**
    - fast-check, ≥100 runs, mocked S3; tag `Feature: agent-asset-tools, Property 2`
    - File: `tests/unit/models/s3-agent-assets-list-item.property.test.js`
    - _Requirements: 1.2, 3.1_
  - [x] 3.7 Write property test for priority-order deduplication and selection
    - **Property 3: Priority-order deduplication and selection**
    - **Validates: Requirements 1.4, 2.2**
    - fast-check, ≥100 runs, mocked S3; tag `Feature: agent-asset-tools, Property 3`
    - File: `tests/unit/models/s3-agent-assets-dedup.property.test.js`
    - _Requirements: 1.4, 2.2_
  - [x] 3.8 Write property test for deterministic ordering and namespace coverage
    - **Property 4: Deterministic ordering and full namespace coverage**
    - **Validates: Requirements 1.1, 1.6, 4.4**
    - fast-check, ≥100 runs, mocked S3; tag `Feature: agent-asset-tools, Property 4`
    - File: `tests/unit/models/s3-agent-assets-ordering.property.test.js`
    - _Requirements: 1.1, 1.6, 4.4_
  - [x] 3.9 Write property test for namespace scoping
    - **Property 5: Namespace scoping**
    - **Validates: Requirements 4.3**
    - fast-check, ≥100 runs, mocked S3; tag `Feature: agent-asset-tools, Property 5`
    - File: `tests/unit/models/s3-agent-assets-namespace-scope.property.test.js`
    - _Requirements: 4.3_
  - [x] 3.10 Write property test for prefix-scoped key construction
    - **Property 7: Prefix-scoped key construction**
    - **Validates: Requirements 4.7, 7.3**
    - fast-check, ≥100 runs; exercise `buildAssetKey` directly; tag `Feature: agent-asset-tools, Property 7`
    - File: `tests/unit/models/s3-agent-assets-key.property.test.js`
    - _Requirements: 4.7, 7.3_
  - [x] 3.11 Write property test for complete, verbatim asset detail
    - **Property 8: Complete, verbatim asset detail**
    - **Validates: Requirements 2.1, 3.2**
    - fast-check, ≥100 runs, mocked S3; tag `Feature: agent-asset-tools, Property 8`
    - File: `tests/unit/models/s3-agent-assets-detail.property.test.js`
    - _Requirements: 2.1, 3.2_
  - [x] 3.12 Write property test for SHA-256 correctness and stability
    - **Property 9: SHA-256 correctness and stability**
    - **Validates: Requirements 2.3, 3.4**
    - fast-check, ≥100 runs; compare `computeSha256` output against an independent Node `crypto` digest over the same bytes and assert stability across repeated reads; tag `Feature: agent-asset-tools, Property 9`
    - File: `tests/unit/models/s3-agent-assets-sha256.property.test.js`
    - _Requirements: 2.3, 3.4_
  - [x] 3.13 Write property test for brown-out and partial data
    - **Property 10: Brown-out and partial data**
    - **Validates: Requirements 4.2, 4.8**
    - fast-check, ≥100 runs, mocked S3; tag `Feature: agent-asset-tools, Property 10`
    - File: `tests/unit/models/s3-agent-assets-brownout.property.test.js`
    - _Requirements: 4.2, 4.8_

- [x] 4. Checkpoint — foundational registry, helper, and DAO
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Service — `services/agent-assets.js`
  - [x] 5.1 Implement the cached `list`, `get`, and `listTypes`, and register the service
    - Create `services/agent-assets.js` mirroring `services/templates.js`: `list({ assetType?, s3Buckets?, namespace? })` resolves the search set via `AgentAssetTypes.resolveEnabledType`/`getEnabledTypes` (single-type or all enabled in registry order; use an explicit all-types marker in the cache-key parameters when `assetType` is omitted), applies strict `s3Buckets` validation (throw a validation error naming any unconfigured bucket, performing no S3 read), sets `conn.host`/`conn.parameters.assetTypes`, and wraps `Models.S3AgentAssets.list` in `CacheableDataAccess.getData` via `Config.getConnCacheProfile('s3-agent-assets', 'assets-list')`
    - `get({ assetType, name, s3Buckets?, namespace? })` requires and re-validates `assetType` (unknown/disabled throws `INVALID_INPUT` naming valid types before any S3 read), uses the `asset-detail` profile with `conn.parameters = { assetType, name, namespace }`, appends the asset identity to `cacheProfile.pathId`, and on a `null` DAO result assembles `ASSET_NOT_FOUND` with `availableAssets` (empty list when none) by calling `list` for that type
    - `listTypes()` returns `[{ name, folder, description, assetCount }]` for enabled types using cache-backed per-type counts; register `AgentAssets` in `services/index.js`
    - _Requirements: 1.1, 2.4, 4.1, 4.5, 4.6, 5.5, 6.3, 7.8, 8.2, 8.3_
  - [x] 5.2 Write service unit tests
    - Mock `Models.S3AgentAssets` and `Config`: all-types `list` aggregates enabled types in registry order (1.1); `ASSET_NOT_FOUND` includes available names and the empty-names case (2.4); `listTypes` counts (6.3); an `s3Buckets` filter naming an unconfigured bucket is rejected with no S3 read (4.6); an unknown/disabled `assetType` is rejected (7.8)
    - File: `tests/unit/services/agent-assets.test.js`
    - _Requirements: 1.1, 2.4, 4.6, 6.3, 7.8_
  - [x] 5.3 Write property test for bucket scoping and invalid-filter rejection
    - **Property 6: Bucket scoping and invalid-filter rejection**
    - **Validates: Requirements 4.1, 4.5, 4.6**
    - fast-check, ≥100 runs; mock config/DAO; tag `Feature: agent-asset-tools, Property 6`
    - File: `tests/unit/services/agent-assets-bucket-scope.property.test.js`
    - _Requirements: 4.1, 4.5, 4.6_

- [x] 6. Controller — `controllers/agent-assets.js`
  - [x] 6.1 Implement the `list`, `get`, and `listTypes` handlers, and register the controller
    - Create `controllers/agent-assets.js` mirroring `controllers/templates.js`: each method validates via `SchemaValidator.validate('<fixed tool name>', input)` first and returns `MCPProtocol.errorResponse('INVALID_INPUT', { message, errors }, toolName)` on failure (no service/S3 call); read `assetType` from validated input (required for `get`, optional for `list`); re-check with `AgentAssetTypes.resolveEnabledType` and return `INVALID_INPUT` naming the valid `assetType` values for unknown/disabled input; return `MCPProtocol.successResponse` on success; map `ASSET_NOT_FOUND` and the strict-bucket/invalid-`assetType` errors to `INVALID_INPUT`/`ASSET_NOT_FOUND`, and any other error to `INTERNAL_ERROR`; register `AgentAssets` in `controllers/index.js`
    - _Requirements: 2.4, 5.5, 6.2, 7.1, 7.2, 7.7, 7.8_
  - [x] 6.2 Write controller unit tests
    - Assert validation failure → `INVALID_INPUT`; unknown/disabled `assetType` → `INVALID_INPUT` naming valid types (7.8); not-found → `ASSET_NOT_FOUND` with `availableAssets`; success envelope for both single-type and all-types `list` (assumes the schemas are wired in Task 8 — the dependency graph schedules this after 8.2)
    - File: `tests/unit/controllers/agent-assets-controller.test.js`
    - _Requirements: 2.4, 5.5, 7.8_
  - [x] 6.3 Write property test for input validation before any S3 read
    - **Property 11: Input validation before any S3 read**
    - **Validates: Requirements 7.1, 7.2, 7.7, 7.8**
    - fast-check, ≥100 runs; generate invalid inputs (missing/over-length/separator `name`, unknown property, malformed `namespace`/`s3Buckets`, unknown/disabled `assetType`) and assert a validation error identifying the rejected parameter with no S3 read; assumes schemas wired in Task 8; tag `Feature: agent-asset-tools, Property 11`
    - File: `tests/unit/controllers/agent-assets-input-validation.property.test.js`
    - _Requirements: 7.1, 7.2, 7.7, 7.8_

- [x] 7. Caching configuration — `config/settings.js` and `config/connections.js`
  - [x] 7.1 Add the agent-asset prefix to settings
    - Add `s3.agentAssetPrefix = 'utilities/v2/agent_assets'` to `config/settings.js` for use as the connection `path` and DAO `basePath`
    - _Requirements: 4.7, 7.3_
  - [x] 7.2 Add the `s3-agent-assets` connection with two cache profiles
    - In `config/connections.js`, add the `s3-agent-assets` connection (`path: settings.s3.agentAssetPrefix`, host set dynamically by the service) with an `assets-list` profile and an `asset-detail` profile, following the existing `IS_PRODUCTION`/`TTL_NON_PROD` convention: production TTLs ≥ 3600 (list 1 hour, detail 24 hours) and test TTLs = `TTL_NON_PROD` (≤ 300 and below production)
    - _Requirements: 8.1, 8.4, 8.5_
  - [x] 7.3 Write config tests for the connection and TTL bounds
    - Assert `s3-agent-assets` resolves both profiles with numeric TTLs (8.1), production TTLs ≥ 3600 (8.4), and test TTLs ≤ 300 and below their production values (8.5)
    - File: `tests/unit/config/connections.test.js`
    - _Requirements: 8.1, 8.4, 8.5_

- [x] 8. Tool generation, dispatch wiring, and integration tests
  - [x] 8.1 Merge generated tool definitions into `settings.availableToolsList`
    - Set `availableToolsList` to `[ ...existingTools, ...AgentAssetTypes.generateToolDefinitions() ]` in `config/settings.js` so the fixed tools (with the `assetType` enum) appear in `tools/list`, `list_tools`, and `MCPProtocol.MCP_TOOLS`
    - _Requirements: 6.1_
  - [x] 8.2 Merge generated schemas into the schema validator
    - Set `schemas` to `{ ...existingSchemas, ...AgentAssetTypes.generateSchemas() }` in `utils/schema-validator.js`, adding validation for the fixed tool names including the `assetType` enum (optional on `list_agent_assets`, required on `get_agent_asset`) and the `name` pattern
    - _Requirements: 6.5, 7.1, 7.2, 7.7, 7.8_
  - [x] 8.3 Merge generated extended descriptions into tool descriptions
    - Merge `AgentAssetTypes.generateExtendedDescriptions()` into `extendedDescriptions` in `config/tool-descriptions.js`
    - _Requirements: 6.1_
  - [x] 8.4 Merge the generated dispatch into the router
    - Set `TOOL_DISPATCH` to `{ ...existingDispatch, ...AgentAssetTypes.getToolDispatch(Controllers.AgentAssets) }` in `utils/json-rpc-router.js`, mapping `list_agent_assets`→`list`, `get_agent_asset`→`get`, `list_agent_asset_types`→`listTypes`; a tool absent from the map still returns `-32601` via the existing guard
    - _Requirements: 6.2, 6.4_
  - [x] 8.5 Write property test for unknown-tool dispatch
    - **Property 14: Unknown tool dispatch**
    - **Validates: Requirements 6.4**
    - fast-check, ≥100 runs; assert an unknown tool name returns JSON-RPC "method not found" identifying the name and invokes no controller; tag `Feature: agent-asset-tools, Property 14`
    - File: `tests/property/agent-asset-dispatch.property.test.js`
    - _Requirements: 6.4_
  - [x] 8.6 Write router/MCP integration tests
    - With mocked S3: `tools/list` includes `list_agent_assets`, `get_agent_asset`, and `list_agent_asset_types`, each with a description and input-schema object and the two generic tools carrying the enabled `assetType` enum (6.1, 11.4); `tools/call` to `list_agent_assets` returns the mocked assets (6.2); `tools/call` to `get_agent_asset` returns content equal to the mocked bytes with `sha256` equal to the SHA-256 of those bytes (2.1, 2.3, 6.2); an unknown tool returns `-32601` (6.4); a `tools/call` with a disabled/unknown `assetType` (e.g. `skills`) returns `INVALID_INPUT` before any S3 read (7.8, 5.5)
    - File: `tests/integration/agent-assets-integration.test.js`
    - _Requirements: 6.1, 6.2, 6.4, 5.5, 7.8, 11.4, 2.1, 2.3_
  - [x] 8.7 Write pass-through caching integration tests
    - With mocked S3: repeated identical `list_agent_assets`/`get_agent_asset` requests are served from cache without new S3 reads, and requests differing in any key component (including a single-type vs an all-types list) cache separately
    - File: `tests/integration/agent-assets-caching.test.js`
    - _Requirements: 8.2, 8.3_

- [x] 9. Checkpoint — core tools wired end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Large-asset handling (DEFERRABLE — Requirement 9)
  - Deferrable slice; the core tools above can ship first. Deliver these together to add size-aware `get_agent_asset` plus the `get_agent_asset_chunk` tool.
  - [x] 10.1 Implement `getChunk` in the service and controller
    - Add `Services.AgentAssets.getChunk` and `Controllers.AgentAssets.getChunk` mirroring `Templates.getChunk`: fetch the full asset, serialize, split with `ContentChunker.chunk`, return the requested zero-based `chunkIndex` with `totalChunks`, and return `INVALID_CHUNK_INDEX` (with `validRange { min: 0, max: totalChunks - 1 }`) for out-of-range indices
    - Files: `services/agent-assets.js`, `controllers/agent-assets.js`
    - _Requirements: 9.2, 9.3, 9.4_
  - [x] 10.2 Add the `agent-asset-chunks` cache connection
    - Add an `agent-asset-chunks` connection with a `chunk-data` profile (TTL ≤ `asset-detail`) in `config/connections.js`, mirroring the existing `template-chunks` connection
    - _Requirements: 9.2_
  - [x] 10.3 Surface the chunk tool and the size-aware `get_agent_asset` summary
    - Extend the registry generators to include `get_agent_asset_chunk` (`assetType` + `name` + `chunkIndex`) and merge its definition/schema/description/dispatch into `config/settings.js`, `utils/schema-validator.js`, `config/tool-descriptions.js`, and `utils/json-rpc-router.js` (dispatch → `getChunk`) so the tool appears in `tools/list` only where Requirement 9 is delivered; add a `toolName === 'get_agent_asset'` branch in `utils/json-rpc-router.js` that uses `ContentSizer.measure` to return `contentTruncated: true` and `totalChunks` (≥ 1) above the configured threshold, mirroring the `get_template` summary
    - Files: `config/agent-asset-types.js`, `config/settings.js`, `utils/schema-validator.js`, `config/tool-descriptions.js`, `utils/json-rpc-router.js`
    - _Requirements: 6.1, 9.1_
  - [x] 10.4 Write property test for chunk round-trip and index bounds
    - **Property 15: Chunk round-trip and index bounds (deferrable)**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
    - fast-check, ≥100 runs; assert requesting indices `0..totalChunks-1` reconstructs the full content and out-of-range indices return `INVALID_CHUNK_INDEX` with the valid range; tag `Feature: agent-asset-tools, Property 15`
    - File: `tests/unit/controllers/agent-assets-chunk.property.test.js`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 11. Documentation — Requirement 10
  - [x] 11.1 Document the tools in the end-user tools reference
    - In `docs/end-user`, document `list_agent_assets`, `get_agent_asset`, and `list_agent_asset_types` (including the `assetType` parameter and its enumeration), each tool's parameters, at least one example prompt and one use case, the `63klabs`/`atlantis` bucket-and-namespace note, the client-side compare workflow (`size`/`etag`/`sha256`), and the `ASSET_NOT_FOUND` error code and its condition
    - _Requirements: 10.1_
  - [x] 11.2 Update the Kiro integration guide `autoApprove` example
    - List the read-only tools `list_agent_assets`, `get_agent_asset`, and `list_agent_asset_types` by name in the `autoApprove` example
    - _Requirements: 10.2_
  - [x] 11.3 Update the admin-ops documentation
    - In `docs/admin-ops`, describe the `{namespace}/utilities/v2/agent_assets/{type}/` layout and note that prefix-scoped admin IAM policies must add `utilities/v2/*`
    - _Requirements: 10.3_
  - [x] 11.4 Update developer documentation and `ARCHITECTURE.md`
    - Describe the registry-driven flow from `AGENT_ASSET_TYPES` through the controller, service, and DAO in `docs/developer` and `ARCHITECTURE.md`, and provide the steps to add a new asset type as a single registry entry with no changes to the generic controller/service/DAO logic
    - _Requirements: 10.4_
  - [x] 11.5 Update `CHANGELOG.md`
    - Add a new entry under the existing `## v0.0.6 (unreleased)` → `### Added` section referencing `[Spec: 0-0-6-agent-asset-tools](../.kiro/specs/0-0-6-agent-asset-tools/)`; do not modify existing changelog text
    - _Requirements: 10.5_

- [x] 12. Final checkpoint — verification
  - Run the read-function Jest suite via its own `package.json` in single-run (non-watch) mode, scoped to the read-function; ensure all new and existing tests pass. Ask the user if questions arise.
  - _Requirements: 11.5_

## Notes

- Sub-tasks postfixed with `*` are optional test tasks (unit, property, integration) and may be skipped for a faster MVP; all tests must pass before completion per Requirement 11.5. Core implementation sub-tasks are never optional.
- Every property test uses fast-check with a minimum of 100 runs against mocked S3 or pure logic, is tagged `Feature: agent-asset-tools, Property N`, and restores mocks in `afterEach`; no test recursively runs the full suite and no test calls live AWS.
- SHA-256 is computed with the Node built-in `crypto` module (no shell); inputs are validated before any S3 read; S3 keys are built only by appending the validated `name` to the fixed prefix; no secrets are logged.
- Task 10 (large-asset handling) is deferrable — the core tools ship without it. Its tasks are self-contained and reuse the existing `ContentSizer`/`ContentChunker` and chunk-cache patterns, so they add no changes to the registry-driven core.
- Tasks 6.2, 6.3, and 8.6 exercise real schema validation and therefore assume the schema wiring in Task 8.2 is complete; the dependency graph schedules them accordingly.
- This feature adds no new AWS infrastructure or IAM to the stack template (Requirement 10.6); the shared S3 helper does not modify the existing template/starter DAOs (Requirement 5.6).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "7.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "2.4", "3.2", "7.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "3.3", "7.3", "8.1", "8.2", "8.3"] },
    { "id": 3, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "8.4"] },
    { "id": 6, "tasks": ["8.5", "8.6", "8.7"] },
    { "id": 7, "tasks": ["10.1", "10.2"] },
    { "id": 8, "tasks": ["10.3"] },
    { "id": 9, "tasks": ["10.4", "11.1", "11.2", "11.3", "11.4", "11.5"] }
  ]
}
```
