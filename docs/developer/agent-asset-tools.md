# Agent Asset Tools — Developer Guide

How the registry-driven `list_agent_assets` / `get_agent_asset` / `list_agent_asset_types` / `get_agent_asset_chunk` tools are built, and how to add a new asset type. For the high-level component view see the [architecture overview](../../ARCHITECTURE.md#agent-asset-tools-registry-driven).

## Overview

Agent Asset Tools let AI assistants discover and retrieve example Kiro "agent assets" — steering documents, hooks, and `AGENTS.md` files today, with `skills` shipped disabled and future types addable later — from the Read Lambda. Assets are sourced from the same S3 buckets and namespace layout already used for CloudFormation templates and application starters, under a fixed prefix: `{bucket}/{namespace}/utilities/v2/agent_assets/{folder}/{filename}`.

Instead of one tool pair per asset type, the feature exposes a **fixed** set of generic tools that take the asset type as an `assetType` parameter:

- `list_agent_assets` — lists assets; `assetType` is optional (omitted = every enabled type).
- `get_agent_asset` — retrieves one asset's full content; `assetType` and `name` are both required.
- `list_agent_asset_types` — returns the enabled types with per-type asset counts.
- `get_agent_asset_chunk` — retrieves one chunk of a large asset by `assetType`, `name`, and `chunkIndex` (parity with `get_template_chunk`).

Each tool returns content-identity metadata (`size`, `etag`, and — for `get_agent_asset` — `sha256`) so a calling agent can compare its local files against the remote copies without any server-side compare operation.

## Registry

`config/agent-asset-types.js` is the single source of truth. It exports the `AGENT_ASSET_TYPES` array and a set of pure lookup/generator functions consumed by the controller, service, and the four wiring points described below.

### `AgentAssetType` shape

Every entry declares five required, non-empty fields:

| Field | Type | Purpose |
|-------|------|---------|
| `name` | `string` | Canonical type identifier and the `assetType` enum value (e.g. `'steering'`) |
| `toolToken` | `string` | Stable canonical token, retained for registry validation/uniqueness (not used to build tool names — the fixed tools all take `assetType` as a parameter) |
| `folder` | `string` | S3 subfolder under the `utilities/v2/agent_assets` prefix |
| `extensions` | `string[]` | Allowed file extensions, including the leading dot (e.g. `['.md']`, `['.kiro.hook', '.json']`) |
| `description` | `string` | Short human-readable description used in generated tool text |

An optional `enabled` field (default `true`) excludes a type from the generated `assetType` enum when set to `false`. The shipped registry has four entries: `steering`, `hooks`, and `agents-md` (enabled), and `skills` (fully configured but `enabled: false`).

### `validateRegistry()`

Runs once at module load. It enforces that every entry declares all five required fields with non-empty values (`extensions` must be a non-empty array of non-empty strings) and that no two entries share the same `name`, `toolToken`, or `folder`. On failure it throws an `Error` naming the offending entry, which fails Lambda cold-start initialization — so a malformed registry exposes **no** agent-asset tools rather than exposing a broken one.

### Generator and lookup functions

| Function | Returns | Purpose |
|----------|---------|---------|
| `getEnabledTypes()` | `AgentAssetType[]` | Entries where `enabled !== false`, in registry order |
| `getEnabledTypeNames()` | `string[]` | The enabled types' `name`s — the exact `assetType` enum injected into tool definitions and schemas |
| `getTypeByName(name)` | `AgentAssetType \| null` | Lookup by canonical name, regardless of enabled/disabled |
| `resolveEnabledType(assetType)` | `AgentAssetType \| null` | Returns the entry only when `assetType` names a currently **enabled** type; `null` for unknown or disabled — used by the controller and service as defense-in-depth beyond the schema `enum` check |
| `generateToolDefinitions()` | `ToolDefinition[]` | The fixed tool set (`{name, description, inputSchema}`), with the `assetType` enum injected from `getEnabledTypeNames()` |
| `generateSchemas()` | `Object.<string, Object>` | JSON Schema per fixed tool name, in the shape consumed by `utils/schema-validator.js` |
| `generateExtendedDescriptions()` | `Object.<string, string>` | Markdown description per fixed tool name, in the shape consumed by `config/tool-descriptions.js` |
| `getToolDispatch(controller)` | `Object.<string, Function>` | Maps each fixed tool name to a method on the supplied controller object (`list_agent_assets`→`list`, `get_agent_asset`→`get`, `list_agent_asset_types`→`listTypes`, `get_agent_asset_chunk`→`getChunk`) |

`generateToolDefinitions()`, `generateSchemas()`, and `generateExtendedDescriptions()` all derive their output from one internal `buildFixedToolSpecs()` helper, so the three stay consistent with each other by construction — there is no risk of a tool's description and its schema drifting apart.

## Adding a new asset type

Adding a new type — or enabling the shipped-but-disabled `skills` type — is a one-entry registry change. No other file needs to change.

1. Add a new entry to the `AGENT_ASSET_TYPES` array in `config/agent-asset-types.js` with `name`, `toolToken`, `folder`, `extensions`, and `description` (optionally with `enabled: false` to ship it disabled initially, the same way `skills` ships today).
2. That's it for code. `validateRegistry()` runs at module load (Lambda cold start) and will fail fast if the entry is malformed — missing a required field, or duplicating another entry's `name`, `toolToken`, or `folder`.
3. Once enabled, the new `name` automatically becomes an accepted `assetType` value everywhere the registry is consumed: the `assetType` enum on `list_agent_assets`/`get_agent_asset` in `tools/list`, the schemas in `utils/schema-validator.js`, the extended descriptions in `config/tool-descriptions.js`, and dispatch through the existing generic controller/service/DAO. No edits to `controllers/agent-assets.js`, `services/agent-assets.js`, or `models/s3-agent-assets.js` are needed — they all resolve type-specific behavior (`folder`, `extensions`) solely from the registry entry at request time.
4. Populate the corresponding S3 prefix, `{namespace}/utilities/v2/agent_assets/{folder}/`, with files matching the declared `extensions`. Publishing assets to S3 is owned by the source repository's pipeline and is out of scope for this Lambda.
5. To enable the shipped `skills` entry instead of adding a new type, remove its `enabled: false` field (or set it to `enabled: true`) — no other change is required.

## Layering

The four layers below mirror the existing `templates`/`starters` MVC pattern; each is **generic** — it derives all type-specific behavior from the registry entry passed to it rather than branching on the asset type by name.

**Controller** (`controllers/agent-assets.js`) validates input against the schema generated for the fixed tool name (`SchemaValidator.validate('<tool name>', input)`), then, as defense-in-depth beyond the schema's `assetType` enum, re-checks the supplied `assetType` via `AgentAssetTypes.resolveEnabledType()` before calling the service — so an unknown or disabled value (e.g. `skills`) is rejected with `INVALID_INPUT` before any S3 read. It formats successful and error results with `utils/mcp-protocol.js`, mapping `ASSET_NOT_FOUND` and the strict-bucket/invalid-`assetType` service errors to their MCP error codes.

**Service** (`services/agent-assets.js`) owns caching and stricter-than-templates input rejection: an `s3Buckets` filter naming any bucket outside `Config.settings().s3.buckets` throws before any S3 read (rather than being silently filtered, as the templates/starters services do), and `assetType` is re-validated against the enabled-type registry. It resolves the connection and cache profile via `Config.getConnCacheProfile('s3-agent-assets', 'assets-list' | 'asset-detail')` (or `('agent-asset-chunks', 'chunk-data')` for `getChunk`) and wraps the DAO call in `CacheableDataAccess.getData(...)`, so cache-key composition (asset type or an all-types marker, asset name, bucket set, namespace) lives here.

**DAO** (`models/s3-agent-assets.js`) does the S3 I/O: `list()` iterates the resolved type(s) in registry order, then buckets in configured priority order, then indexed namespaces, listing direct children of `{namespace}/utilities/v2/agent_assets/{folder}/` via `ListObjectsV2Command` with `Delimiter: '/'`, filtering by the type's `extensions`, and deduplicating on the `(type, name)` pair. `get()` reads the first matching object via `GetObjectCommand` (latest version only) and computes `sha256` over the exact bytes with the Node built-in `crypto` module. Both brown-out gracefully — an inaccessible bucket or a failed read is skipped, logged, and recorded in the response's `errors` array with `partialData: true`, while the remaining sources continue. The shared `checkBucketAccess`/`getIndexedNamespaces` helpers live in `models/s3-common.js` rather than being redeclared here, and are also usable by (though not currently used by) the existing template/starter DAOs.

## Related documentation

- [Architecture: Agent Asset Tools](../../ARCHITECTURE.md#agent-asset-tools-registry-driven)
- [Testing guide](testing.md)
