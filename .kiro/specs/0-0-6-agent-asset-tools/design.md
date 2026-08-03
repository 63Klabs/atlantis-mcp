# Design Document

## Overview

**Agent Assets MCP Tools** adds a read-only, registry-driven family of MCP tools to the
Atlantis MCP Server's `read-function` Lambda. The tools let AI assistants discover and
retrieve example Kiro "agent assets" — steering documents, hooks, and `AGENTS.md` files
today, with `skills` and future types addable through a single registry entry.

The feature exposes a fixed, consolidated set of tools rather than a tool pair per type:

- **`list_agent_assets`** — lists assets, taking an **optional** `assetType` parameter (plus
  optional `namespace` and `s3Buckets`). When `assetType` is omitted, it lists across all
  enabled types. This mirrors `list_templates`, whose `category` parameter is optional.
- **`get_agent_asset`** — retrieves one asset, taking a **required** `assetType` and a
  **required** `name` (plus optional `namespace` and `s3Buckets`).
- **`list_agent_asset_types`** — returns the enabled asset types with per-type asset counts.
- **`get_agent_asset_chunk`** (deferrable, Requirement 9) — retrieves one chunk of a large
  asset by `assetType`, `name`, and `chunkIndex`.

The `assetType` parameter mirrors the `category` parameter of `list_templates`/`get_template`:
its accepted values are exactly the enabled registry types. Adding or enabling a registry
entry extends that enumeration — it does not create a new tool.

Assets are sourced from the same S3 buckets and namespaces already used for CloudFormation
templates and application starters, under a fixed prefix:
`{bucket}/{namespace}/utilities/v2/agent_assets/{type}/{filename}`. Each tool returns
content-identity metadata (`size`, `etag`, and — for `get_agent_asset` — `sha256`) so a
calling agent can compare its local files against the remote copies and pull updates without
any server-side compare operation.

The feature slots directly into the existing `read-function` MVC layers and reuses every
established mechanism rather than inventing new ones:

- **Router** (`utils/json-rpc-router.js`) — dispatches `tools/call` by tool name via the
  `TOOL_DISPATCH` map and formats MCP results; `tools/list` is served from
  `settings.tools.availableToolsList`.
- **Controller** (`controllers/agent-assets.js`, new) — validates input with
  `utils/schema-validator.js`, calls the service, and formats responses with
  `utils/mcp-protocol.js`, mirroring `controllers/templates.js` and `controllers/starters.js`.
- **Service** (`services/agent-assets.js`, new) — resolves the bucket set, sets the
  connection/cache profile from `config/connections.js`, and wraps the DAO call in
  `CacheableDataAccess.getData(...)`, mirroring `services/templates.js` and
  `services/starters.js`.
- **DAO** (`models/s3-agent-assets.js`, new) — lists and reads objects from S3 with
  brown-out support and content-identity metadata, mirroring `models/s3-templates.js` and
  `models/s3-starters.js`.
- **Registry** (`config/agent-asset-types.js`, new) — the single `AGENT_ASSET_TYPES`
  definition that generates the **fixed** tool definitions, input schemas, extended
  descriptions, and dispatch entries, injecting the `assetType` enum (the enabled type names)
  into the two generic tools and resolving each type to its S3 folder and extensions.

Consistent with `AGENTS.md`, this feature adds **no new AWS infrastructure or IAM** to the
stack template. It reuses the configured S3 buckets (`ATLANTIS_S3_BUCKETS`, default
`63klabs`), the existing outbound access, and admin-managed permissions. Publishing assets
to S3 is owned by the source repository (`63Klabs/atlantis-with-kiro-ai`) and is out of
scope here.

### Design Goals

1. **DRY and expandable** — one registry entry adds a new accepted `assetType` value to the
   existing `list_agent_assets`/`get_agent_asset` tools (no new tools) with no edits to the
   generic controller, service, or DAO (Requirement 5).
2. **Faithful to existing patterns** — reuse the connection/cache-profile,
   `CacheableDataAccess`, `SchemaValidator`, `MCPProtocol`, `ContentChunker`, and
   `ContentSizer` conventions already used by templates and starters.
3. **Non-invasive** — extract the shared S3 helpers into a common module for the new DAO
   **without modifying** the existing template and starter DAOs (Requirement 5.6).
4. **Secure by default** — validated names, prefix-scoped key construction, untrusted-content
   handling, built-in crypto for SHA-256, and no secret logging (Requirement 7).

## Architecture

### Layer Placement

The feature adds one module per existing layer plus a registry and a shared S3 helper. No
layer is restructured; each new module follows the interface and error conventions of its
sibling modules.

```
read-function/
├── config/
│   ├── agent-asset-types.js     # NEW: AGENT_ASSET_TYPES registry + generators
│   ├── connections.js           # EDIT: add 's3-agent-assets' (+ 'agent-asset-chunks')
│   ├── settings.js              # EDIT: merge generated tool defs into availableToolsList
│   └── tool-descriptions.js     # EDIT: merge generated extended descriptions
├── controllers/
│   ├── agent-assets.js          # NEW: generic list/get/listTypes/getChunk wrappers
│   └── index.js                 # EDIT: export AgentAssets
├── services/
│   ├── agent-assets.js          # NEW: generic list/get/listTypes/getChunk (cached)
│   └── index.js                 # EDIT: export AgentAssets
├── models/
│   ├── s3-agent-assets.js       # NEW: generic list/get DAO
│   ├── s3-common.js             # NEW: shared checkBucketAccess + getIndexedNamespaces
│   └── index.js                 # EDIT: export S3AgentAssets (and S3Common)
└── utils/
    ├── json-rpc-router.js       # EDIT: merge generated dispatch; get_agent_asset size-aware summary
    └── schema-validator.js      # EDIT: merge generated schemas (fixed tools + assetType enum)
```

### Request Flow

Every agent-asset tool call flows through the same layers as existing tools. Because the tool
set is fixed, the router maps `list_agent_assets` and `get_agent_asset` directly to the two
generic controller functions. The controller resolves the asset **type** from the validated
`assetType` **input parameter** (not from the tool name): for `get_agent_asset`, `assetType`
is required; for `list_agent_assets` it is optional, and when it is omitted the controller
lists across all enabled types.

```mermaid
flowchart TD
    Client[AI Assistant / MCP Client] -->|POST /mcp/v1 tools/call| Router[json-rpc-router.handleJsonRpc]
    Router -->|Object.hasOwn TOOL_DISPATCH| Dispatch{Tool name in dispatch?}
    Dispatch -->|no| MNF[JSON-RPC -32601 Method not found]
    Dispatch -->|list_agent_assets| CtrlList[AgentAssets.list props]
    Dispatch -->|get_agent_asset| CtrlGet[AgentAssets.get props]
    CtrlList -->|SchemaValidator.validate list_agent_assets| VList{assetType provided?}
    CtrlGet -->|SchemaValidator.validate get_agent_asset + name regex| ResolveGet[require + resolve enabled assetType]
    VList -->|yes| ResolveList[resolve enabled assetType]
    VList -->|no| AllTypes[all enabled types from getEnabledTypes]
    ResolveList --> Reg[(AGENT_ASSET_TYPES registry)]
    ResolveGet --> Reg
    AllTypes --> Reg
    ResolveList --> SvcList["Services.AgentAssets.list (one type)"]
    AllTypes --> SvcList2["Services.AgentAssets.list (all enabled types)"]
    ResolveGet --> SvcGet[Services.AgentAssets.get assetType + name]
    SvcList -->|getConnCacheProfile s3-agent-assets/assets-list| Cache[(CacheableDataAccess)]
    SvcList2 --> Cache
    SvcGet -->|getConnCacheProfile s3-agent-assets/asset-detail| Cache
    Cache -->|cache miss| DAO[models/s3-agent-assets]
    DAO -->|checkBucketAccess / getIndexedNamespaces| Common[models/s3-common]
    DAO -->|per enabled type: ListObjectsV2 / GetObject| S3[(S3 buckets + namespaces)]
    DAO -->|list item / detail + sha256| Cache
    Cache --> CtrlList
    Cache --> CtrlGet
    CtrlList -->|MCPProtocol.successResponse| Router
    CtrlGet -->|MCPProtocol.successResponse| Router
    Router -->|jsonRpcSuccess MCP content| Client
```

### Registry-Driven Tool Generation

The registry is the single source of truth. Generator functions produce a **fixed** set of
tool artifacts — `list_agent_assets`, `get_agent_asset`, `list_agent_asset_types`, and the
deferrable `get_agent_asset_chunk` — and inject the `assetType` enumeration (the enabled type
names, from `getEnabledTypeNames()`) into the two generic tools' definitions and schemas.
Adding a type (or enabling `skills`) is a one-entry change that extends that enumeration; no
new tool is created, and the generic glue below picks up the new accepted value automatically,
satisfying Requirements 5.2 and 5.4.

```mermaid
flowchart LR
    Reg[("AGENT_ASSET_TYPES<br/>name, toolToken, folder,<br/>extensions, description, enabled")]
    Reg -->|getEnabledTypeNames| Enum["assetType enum<br/>(enabled type names)"]
    Enum -->|generateToolDefinitions| Settings[settings.tools.availableToolsList]
    Enum -->|generateSchemas| Schema[schema-validator.schemas]
    Reg -->|generateExtendedDescriptions| Desc[tool-descriptions.extendedDescriptions]
    Reg -->|getToolDispatch AgentAssets| Router[json-rpc-router.TOOL_DISPATCH]
    Settings -->|single source| ToolsList[tools/list + list_tools]
    Settings --> MCP[mcp-protocol.MCP_TOOLS]
    Router --> Call[tools/call dispatch]
    Schema --> Validate[input validation incl. assetType enum]

    subgraph Fixed tool set - always generated
      T1[list_agent_assets - optional assetType]
      T2[get_agent_asset - required assetType + name]
      T3[list_agent_asset_types]
      T4[get_agent_asset_chunk - deferrable]
    end
```

Because `tools/list` (router) and `list_tools` (controller) both read
`settings.tools.availableToolsList`, and `MCPProtocol.MCP_TOOLS` aliases the same array,
injecting the fixed tool definitions at that one point makes the tools discoverable
everywhere. Disabled entries (e.g. `skills`) are excluded only from the `assetType`
enumeration — the tools themselves always exist. This yields two distinct failure modes: a
`tools/call` naming a tool that is not in the dispatch map falls through to the router's
`Method not found` path (Requirement 6.4), while a `tools/call` to one of the existing tools
that supplies a disabled or unknown `assetType` (e.g. `skills`) is rejected by schema
validation with an `INVALID_INPUT` error before any S3 read (Requirements 5.5, 6.5, 7.8).

### Registry Validation and Initialization

`config/agent-asset-types.js` validates the registry when the module loads (during config
initialization). Each entry must declare all five required non-empty fields — `name`,
`toolToken`, `folder`, `extensions` (a non-empty array), and `description` — and no two
entries may share the same `name`, `toolToken`, or `folder`. If validation fails, the module
throws an `Error` that names the offending entry, failing initialization so that **no**
agent-asset tools are exposed (Requirement 5.7). Because the read-function's Jest suite
exercises the registry (Requirement 11), a malformed registry is caught in CI before it can
reach production.

## Components and Interfaces

### 1. Registry — `config/agent-asset-types.js`

The registry declares the asset types and exposes pure generator/lookup helpers. It has no
dependency on `settings.js`, `schema-validator.js`, or the router, so the wiring points can
depend on it without a cycle.

```javascript
/**
 * @typedef {Object} AgentAssetType
 * @property {string} name         - Canonical type identifier and the `assetType` enum value (e.g. 'steering')
 * @property {string} toolToken    - Stable canonical token; retained for registry validation/uniqueness (Requirement 5.1) but NOT used to build tool names — the fixed tools take `assetType` = `name`
 * @property {string} folder       - S3 subfolder under the agent_assets prefix
 * @property {string[]} extensions - Allowed file extensions (e.g. ['.md'])
 * @property {string} description  - Short human-readable description
 * @property {boolean} [enabled]   - Defaults to true; false excludes the type from the `assetType` enum
 */

const AGENT_ASSET_TYPES = [
  { name: 'steering',  toolToken: 'steering',  folder: 'steering',  extensions: ['.md'],          description: '...' },
  { name: 'hooks',     toolToken: 'hooks',     folder: 'hooks',     extensions: ['.kiro.hook', '.json'], description: '...' },
  { name: 'agents-md', toolToken: 'agents_md', folder: 'agents_md', extensions: ['.md'],          description: '...' },
  { name: 'skills',    toolToken: 'skills',    folder: 'skills',    extensions: ['.md'],          description: '...', enabled: false }
];
```

Exported interface:

| Function | Returns | Purpose |
|----------|---------|---------|
| `getEnabledTypes()` | `AgentAssetType[]` | Entries where `enabled !== false`, in registry order |
| `getEnabledTypeNames()` | `string[]` | The enabled type `name`s — the `assetType` enum injected into definitions and schemas |
| `getTypeByName(name)` | `AgentAssetType \| null` | Lookup by canonical name (the `assetType` value) |
| `resolveEnabledType(assetType)` | `AgentAssetType \| null` | Returns the entry only when `assetType` names an **enabled** type; `null` for unknown or disabled — used by the controller/service to re-check validity |
| `generateToolDefinitions()` | `ToolDefinition[]` | The **fixed** tool set (`list_agent_assets`, `get_agent_asset`, `list_agent_asset_types`, and deferrable `get_agent_asset_chunk`), with the `assetType` enum injected from `getEnabledTypeNames()` |
| `generateSchemas()` | `Object.<string, Object>` | JSON schemas for the fixed tool names: `list_agent_assets` (optional `assetType` enum), `get_agent_asset` (required `assetType` enum + required `name`), `get_agent_asset_chunk` (required `assetType` + `name` + `chunkIndex`), and the parameter-less `list_agent_asset_types` |
| `generateExtendedDescriptions()` | `Object.<string, string>` | Markdown description per fixed tool name |
| `getToolDispatch(controller)` | `Object.<string, Function>` | Maps the fixed tool names to controller wrappers (`list_agent_assets`→`list`, `get_agent_asset`→`get`, `list_agent_asset_types`→`listTypes`, `get_agent_asset_chunk`→`getChunk`) |
| `validateRegistry()` | `void` (throws) | Enforces required fields + uniqueness (Requirement 5.7) |

`validateRegistry()` runs once at module load. Generated input schemas reuse the exact
parameter shapes already used by the template tools: `assetType` uses
`{ type: 'string', enum: getEnabledTypeNames() }` (mirroring the `category` enum of
`list_templates`/`get_template`) — optional on `list_agent_assets` and required on
`get_agent_asset` (Requirements 5.2, 6.5, 7.1, 7.8); the `name` parameter uses
`{ type: 'string', minLength: 1, maxLength: 255, pattern: '^[^/\\\\]+$' }` (Requirement 7.1),
`namespace` uses `{ type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$', maxLength: 63 }`, and
`s3Buckets` uses `{ type: 'array', items: { type: 'string', minLength: 3, maxLength: 63 }, minItems: 1 }`,
all with `additionalProperties: false` (Requirement 7.2). Because the `assetType` enum is
computed from `getEnabledTypeNames()`, disabled types (e.g. `skills`) are absent from the enum
and rejected by validation (Requirement 5.5).

### 2. Shared S3 Helper — `models/s3-common.js`

Requirement 5.6 asks for the shared helpers to live in a common module consumed by the new
DAO, **without modifying** the existing template and starter DAOs. Both existing DAOs today
declare their own private `checkBucketAccess(bucketName)` and `getIndexedNamespaces(bucketName)`
(verified in `models/s3-templates.js` and `models/s3-starters.js`). This module provides
behavior-equivalent implementations for the agent-asset DAO and leaves the existing DAOs
untouched, so their current unit tests continue to pass.

```javascript
/**
 * Check whether a bucket permits agent-asset access.
 * Behavior-equivalent to the existing template/starter DAO helper.
 * @param {string} bucketName
 * @returns {Promise<boolean>}
 */
async function checkBucketAccess(bucketName) { /* ... */ }

/**
 * Discover indexed namespaces (root-level prefixes) for a bucket.
 * Uses ListObjectsV2Command with Delimiter '/' and maps CommonPrefixes,
 * matching the existing DAO helper.
 * @param {string} bucketName
 * @returns {Promise<string[]>}
 */
async function getIndexedNamespaces(bucketName) { /* ... */ }

module.exports = { checkBucketAccess, getIndexedNamespaces };
```

`s3-common.js` uses `AWS.s3.client` from `@63klabs/cache-data` and logs failures via
`utils/error-handler.js` `logS3Error(...)`, consistent with `s3-templates.js`.

> Note: This introduces a small, intentional duplication with the private helpers in the two
> existing DAOs. The requirement explicitly prioritizes not modifying those DAOs (to keep
> their tests green) over eliminating the duplication. A future refactor may migrate the
> template and starter DAOs onto `s3-common.js`, but that is out of scope here.

### 3. Data Access Object — `models/s3-agent-assets.js`

Generic DAO providing `list(connection, options)` and `get(connection, options)` that derive
all type-specific behavior (`folder`, `extensions`) from the registry entry (Requirement 5.3).
`list` accepts the **set** of types to search through `connection.parameters.assetTypes` — a
single-entry set for a one-type listing, or all enabled entries (in registry order) for an
all-types listing — so the DAO iterates each type's folder and produces one fully ordered,
deduplicated result. `get` takes the single resolved `assetType`. Signatures and the
brown-out/return shape mirror `models/s3-templates.js`.

```javascript
/**
 * List assets across one or more types over configured buckets/namespaces (brown-out).
 * connection.host       : string[]  (bucket set, priority order)
 * connection.path       : string    (basePath, e.g. 'utilities/v2/agent_assets')
 * connection.parameters : { assetTypes: AgentAssetType[], namespace?: string }
 *                          (one entry for a single-type list; all enabled entries in
 *                           registry order for an all-types list)
 * @returns {Promise<{ assets: Object[], errors?: Object[], partialData: boolean }>}
 */
async function list(connection, options = {}) { /* ... */ }

/**
 * Get one asset by name; first occurrence in bucket-then-namespace order.
 * connection.parameters : { assetType, name, namespace? }
 * @returns {Promise<Object|null>}  // null when not found in any read source
 */
async function get(connection, options = {}) { /* ... */ }
```

DAO behavior details:

- **Prefix + direct-children listing** — for each type in `assetTypes` (registry order),
  builds prefix `{namespace}/{basePath}/{folder}/` and calls `ListObjectsV2Command` with
  `Delimiter: '/'` so only objects directly under the prefix are returned; nested-subfolder
  objects appear as `CommonPrefixes` and are ignored (Requirement 1.1). The placeholder key
  equal to the prefix itself is excluded.
- **Extension filter** — keeps only objects whose filename ends with one of that type's
  configured `extensions`; excludes all others (Requirement 1.5).
- **Deterministic order** — iterates types in registry order, then buckets in
  `connection.host` order, then namespaces in indexed-priority order, and sorts each type's
  matched filenames ascending before appending, so identical inputs yield identical output —
  including the all-types listing, whose results are grouped in registry-type order
  (Requirements 1.1, 1.6).
- **Deduplication** — keeps the first occurrence of each **`(type, name)`** pair (registry-type,
  then bucket, then namespace priority) and discards later duplicates, while treating the same
  `name` under different types as distinct (Requirement 1.4), mirroring
  `deduplicateStarters`/`deduplicateTemplates`.
- **Content identity** — for `get`, fetches the object with `GetObjectCommand`, reads the
  exact bytes via `Body.transformToByteArray()`, computes `sha256` with the Node built-in
  `crypto` module (`crypto.createHash('sha256').update(buffer).digest('hex')`, lowercase hex),
  sets `size` from the byte length / `ContentLength`, `etag` from the S3 `ETag`, and
  `content` from the UTF-8 decoding of those exact bytes (Requirements 2.1–2.3, 3.2, 3.4).
- **Brown-out** — a bucket lacking access is skipped with a warning and an `errors` entry
  (Requirement 4.2); a bucket/namespace read failure is logged via `logS3Error`, recorded in
  `errors`, and sets `partialData: true` while other sources continue (Requirement 4.8).

Exported for testing: `list`, `get`, `deduplicateAssets`, `filterByExtension`,
`buildAssetKey`, `computeSha256`, `parseAssetMetadata`.

### 4. Service — `services/agent-assets.js`

Generic business logic with pass-through caching, mirroring `services/templates.js`.

```javascript
async function list(options)     // { assetType?, s3Buckets?, namespace? } — assetType omitted = all enabled types
async function get(options)      // { assetType, name, s3Buckets?, namespace? } -> throws ASSET_NOT_FOUND
async function listTypes()       // enabled types + per-type asset counts (Requirement 6.3)
async function getChunk(options) // deferrable (Requirement 9)
```

Service behavior details:

- **Connection/cache profile** — `list` uses
  `Config.getConnCacheProfile('s3-agent-assets', 'assets-list')`; `get` uses
  `('s3-agent-assets', 'asset-detail')`. Fails fast if the profile is missing, exactly like
  the templates service.
- **Type resolution** — `get` requires `assetType` and resolves it via
  `AgentAssetTypes.resolveEnabledType(assetType)`; an unknown or disabled value throws an
  `INVALID_INPUT` error naming the valid `assetType` values, before any S3 read (Requirements
  7.8, 5.5). `list` resolves the search set the same way: a supplied `assetType` is validated
  and yields a single-entry set, while an omitted `assetType` yields all `getEnabledTypes()`
  in registry order (Requirement 1.1). The resolved set is passed to the DAO as
  `conn.parameters.assetTypes`.
- **Bucket resolution + strict validation** — defaults to `Config.settings().s3.buckets`
  when no `s3Buckets` filter is given (Requirement 4.1). When a filter is provided, it is
  checked against the configured list; if **any** requested bucket is not configured, the
  service throws a validation error naming the invalid bucket(s) and performs no S3 read
  (Requirement 4.6). (This is stricter than the templates service, which silently filters,
  and is required by AC 4.6.)
- **Cache keys** — sets `conn.host = bucketsToSearch` and, for `get`,
  `conn.parameters = { assetType, name, namespace }`. For `list`, the parameters carry the
  requested `assetType` or an explicit all-types marker (e.g. `assetType: '*all*'`) when it is
  omitted, so a single-type list and an all-types list cache under distinct keys. The list
  cache key is therefore asset type (or the all-types marker) + bucket set + namespace, and
  the get cache key is asset type + asset name + bucket set + namespace. `CacheableDataAccess`
  keys the entry on the bucket set + parameters, so requests differing in any component cache
  separately and identical requests are served from cache without new S3 calls (Requirements
  8.2, 8.3). `get` appends the asset identity to `cacheProfile.pathId` for log clarity,
  mirroring the templates service.
- **Fetch wrapper** — the cache-miss `fetchFunction` calls `Models.S3AgentAssets.list/get`,
  passing the resolved type set via `conn.parameters.assetTypes` (one entry or all enabled
  entries) for `list` and `{ assetType, name }` for `get`, and wraps the result with
  `ApiRequest.success({body})` / `ApiRequest.error({body})` depending on the presence of
  `errors`, identical to the templates/starters services.
- **Not-found** — when the DAO returns `null` for `get`, the service builds the available
  names by calling `list({ assetType, s3Buckets, namespace })` for that single type, attaches
  them to an error with `code = 'ASSET_NOT_FOUND'` and `availableAssets = [...]`, and throws it
  (Requirement 2.4). Available names come from the successfully read sources; an empty list is
  returned when none are available.
- **listTypes** — iterates `getEnabledTypes()`, calls `list` per type (cache-backed), and
  returns `[{ name, folder, description, assetCount }]` (where `name` is the `assetType`
  value), mirroring the templates `listCategories` count pattern (Requirement 6.3).

### 5. Controller — `controllers/agent-assets.js`

Generic MCP request handlers, mirroring the per-tool methods in `controllers/templates.js`.
Each method uses a fixed tool name (`list_agent_assets`, `get_agent_asset`,
`list_agent_asset_types`, `get_agent_asset_chunk`) and resolves the asset **type** from the
validated `assetType` input parameter, not from the tool name.

```javascript
async function list(props)      // validate list_agent_assets -> Services.AgentAssets.list({ assetType? })
async function get(props)       // validate get_agent_asset (incl. name regex) -> Services.AgentAssets.get({ assetType, name })
async function listTypes(props) // validate list_agent_asset_types -> Services.AgentAssets.listTypes
async function getChunk(props)  // deferrable (Requirement 9), mirrors Templates.getChunk
```

Controller behavior details:

- Validates input via `SchemaValidator.validate('<fixed tool name>', input)` and returns
  `MCPProtocol.errorResponse('INVALID_INPUT', { message, errors }, toolName)` on failure. The
  schema enforces the `assetType` enum (enabled types only), the `name` regex, and rejection of
  unknown properties before any S3 read (Requirements 7.1, 7.2, 7.7, 7.8).
- Reads `assetType` from the validated input. For `get` it is required; for `list` it is
  optional (omitted = all enabled types). As defense in depth beyond the schema enum, the
  controller re-checks the type via `AgentAssetTypes.resolveEnabledType(assetType)`; an unknown
  or disabled `assetType` yields an `INVALID_INPUT` error whose message names the valid
  `assetType` values (Requirement 7.8).
- On success returns `MCPProtocol.successResponse(toolName, result)`.
- Catches `ASSET_NOT_FOUND` (returns `MCPProtocol.errorResponse('ASSET_NOT_FOUND', { message, availableAssets }, toolName)`)
  and the strict-bucket / invalid-`assetType` validation errors (returns `INVALID_INPUT`); any
  other error becomes `INTERNAL_ERROR`. This mirrors the `TEMPLATE_NOT_FOUND`/`STARTER_NOT_FOUND`
  handling in the existing controllers.

### 6. Tool Generation and Dispatch Wiring

Four existing modules gain a single generic hook that consumes the registry:

1. **`config/settings.js`** — `availableToolsList` becomes
   `[ ...existingTools, ...AgentAssetTypes.generateToolDefinitions() ]`, adding the fixed
   agent-asset tools. Because `MCPProtocol.MCP_TOOLS` and the `Tools.list` controller both
   read this array, the fixed tools appear in `tools/list` and `list_tools` with their
   descriptions and input schemas — the two generic tools carrying the `assetType` enum
   (Requirement 6.1).
2. **`utils/schema-validator.js`** — `schemas` becomes
   `{ ...existingSchemas, ...AgentAssetTypes.generateSchemas() }`, adding validation for the
   fixed tool names, including the `assetType` enum on `list_agent_assets` (optional) and
   `get_agent_asset` (required) (Requirements 7.1, 7.2, 7.7, 7.8).
3. **`config/tool-descriptions.js`** — `extendedDescriptions` merges
   `AgentAssetTypes.generateExtendedDescriptions()` for the fixed tool names; the router and
   `Tools.list` already swap in extended descriptions at response time.
4. **`utils/json-rpc-router.js`** — `TOOL_DISPATCH` becomes
   `{ ...existingDispatch, ...AgentAssetTypes.getToolDispatch(Controllers.AgentAssets) }`,
   mapping the fixed tool names: `list_agent_assets` → `Controllers.AgentAssets.list`,
   `get_agent_asset` → `Controllers.AgentAssets.get`, `list_agent_asset_types` →
   `Controllers.AgentAssets.listTypes`, and (deferrable) `get_agent_asset_chunk` →
   `Controllers.AgentAssets.getChunk`. A `tools/call` naming a tool absent from this map hits
   the existing `Object.hasOwn(TOOL_DISPATCH, toolName)` guard and returns `-32601`; a
   `tools/call` to one of these tools with a disabled/unknown `assetType` is instead rejected
   by schema validation as `INVALID_INPUT` before any S3 read (Requirements 6.2, 6.4, 5.5, 7.8).

Adding a registry entry (or enabling `skills`) changes only the generated `assetType` enum — a
new accepted value on the existing tools. No new tool is created and the generic controller,
service, and DAO are never edited (Requirement 5.4).

### 7. `list_agent_asset_types` and `get_agent_asset_chunk`

- **`list_agent_asset_types`** (always generated) — no required parameters; returns the
  enabled types with per-type asset counts via `Services.AgentAssets.listTypes()`
  (Requirement 6.3).
- **`get_agent_asset_chunk`** (deferrable, Requirement 9) — mirrors `Templates.getChunk`:
  takes `assetType`, `name`, and `chunkIndex`, fetches the full asset, serializes it, chunks
  with `ContentChunker.chunk`, and returns the requested zero-based `chunkIndex` with
  `totalChunks`. An out-of-range index returns `INVALID_CHUNK_INDEX` with the valid range. This
  tool and the size-aware `get_agent_asset` summary can be delivered after the core tools;
  current assets fit well under the threshold.

## Data Models

### Asset List Item (returned by `list_agent_assets`)

Each element of the `assets` array (Requirements 1.2, 3.1). The `type` field is always present
and, in an all-types listing, distinguishes assets that share the same `name` across different
types (deduplication is on the `(type, name)` pair, per Requirement 1.4):

```javascript
{
  name: "product-guidelines.md",                 // filename, no path separators
  type: "steering",                              // registry canonical name (the assetType value)
  namespace: "atlantis",                         // namespace of the retained source
  bucket: "63klabs",                             // bucket of the retained source
  s3Path: "s3://63klabs/atlantis/utilities/v2/agent_assets/steering/product-guidelines.md",
  size: 4096,                                     // object size in bytes
  etag: "\"9b2cf...\"",                          // S3 ETag (non-empty)
  lastModified: "2026-05-01T12:00:00.000Z"        // S3 LastModified
}
```

### Asset Detail (returned by `get_agent_asset`)

Superset of the list item, adding `content` and `sha256` (Requirements 2.1, 2.2, 3.2):

```javascript
{
  name: "product-guidelines.md",
  type: "steering",
  namespace: "atlantis",
  bucket: "63klabs",
  s3Path: "s3://63klabs/atlantis/utilities/v2/agent_assets/steering/product-guidelines.md",
  size: 4096,
  etag: "\"9b2cf...\"",
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",  // lowercase hex over exact bytes
  lastModified: "2026-05-01T12:00:00.000Z",
  content: "# Product Guidelines\n..."           // verbatim UTF-8 of the exact object bytes
}
```

### S3 Key Layout

```
{bucket}/{namespace}/utilities/v2/agent_assets/{folder}/{filename}
```

- `basePath` (`settings.s3.agentAssetPrefix`) = `utilities/v2/agent_assets`.
- `{folder}` comes from the registry entry (`steering`, `hooks`, `agents_md`, `skills`).
- The key is always built by appending the validated `name` to the fixed
  `{namespace}/{basePath}/{folder}/` prefix, so the resulting key can never escape the prefix
  (Requirements 4.7, 7.3).

### `list_agent_asset_types` Result

```javascript
{
  types: [
    // `name` is the value to pass as `assetType` to list_agent_assets / get_agent_asset
    { name: "steering",  folder: "steering",  description: "...", assetCount: 7 },
    { name: "hooks",     folder: "hooks",     description: "...", assetCount: 3 },
    { name: "agents-md", folder: "agents_md", description: "...", assetCount: 1 }
  ]
}
```

### Response Envelope: `partialData` and `errors`

`list_agent_assets` responses carry the same brown-out envelope as templates/starters (Requirement 4.8):

```javascript
{
  assets: [ /* ... */ ],
  errors: [ { source: "bucketB/nsX", sourceType: "s3", error: "AccessDenied", timestamp: "..." } ], // present only on failure
  partialData: true   // true when any source failed
}
```

### Error Shapes

| Code | When | Payload |
|------|------|---------|
| `INVALID_INPUT` | Schema validation fails: missing/invalid `name`, `name` with `/`/`\`, >255 chars, unknown property, malformed `namespace`/`s3Buckets`, or an `assetType` that is unknown or names a disabled type; or an `s3Buckets` filter naming unconfigured buckets (Requirements 7.7, 7.8, 4.6) | `{ message, errors: [...] }` (for a bad `assetType`, the message names the valid types; for bad buckets, the invalid bucket names) |
| `ASSET_NOT_FOUND` | `get_agent_asset` name not found for the given `assetType` in any successfully read source (Requirement 2.4) | `{ message, availableAssets: string[] }` (empty array when none available) |
| `INVALID_CHUNK_INDEX` | `get_agent_asset_chunk` `chunkIndex < 0` or `>= totalChunks` (Requirement 9.3, deferrable) | `{ message, validRange: { min: 0, max: totalChunks - 1 } }` |
| `INTERNAL_ERROR` | Unexpected failure | `{ message }` (no internal details or stack) |

For large `get_agent_asset` responses (deferrable Requirement 9.1), the summary payload adds
`contentTruncated: true` and `totalChunks` (an integer ≥ 1), mirroring the `get_template`
summary produced in `json-rpc-router.js` (a `toolName === 'get_agent_asset'` branch alongside
the existing `get_template` one).

## Caching

Caching reuses the `CacheableDataAccess` pass-through pattern and the production-vs-test TTL
convention already established in `config/connections.js`
(`IS_PRODUCTION = DebugAndLog.isProduction()`, `TTL_NON_PROD = IS_PRODUCTION ? 3600 : 60`).

A new `s3-agent-assets` connection is added with two cache profiles (Requirement 8.1):

```javascript
{
  name: 's3-agent-assets',
  host: "",                                  // set dynamically to the bucket set in the service
  path: settings.s3.agentAssetPrefix,        // 'utilities/v2/agent_assets' — namespace prepended in DAO
  cache: [
    {
      profile: 'assets-list',
      overrideOriginHeaderExpiration: true,
      // Production: 1 hour (>= 3600, Requirement 8.4); Test: TTL_NON_PROD = 60 (<= 300, Requirement 8.5)
      defaultExpirationInSeconds: IS_PRODUCTION ? (60 * 60) : TTL_NON_PROD,
      expirationIsOnInterval: false,
      headersToRetain: '',
      hostId: 's3-agent-assets',
      pathId: 'list',
      encrypt: false
    },
    {
      profile: 'asset-detail',
      overrideOriginHeaderExpiration: true,
      // Production: 24 hours (>= 3600, Requirement 8.4); Test: TTL_NON_PROD = 60 (<= 300, Requirement 8.5)
      defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
      expirationIsOnInterval: false,
      headersToRetain: '',
      hostId: 's3-agent-assets',
      pathId: 'detail',
      encrypt: false
    }
  ]
}
```

- **Pass-through keys** — `assets-list` is keyed by asset type (or an explicit all-types
  marker when `assetType` is omitted) + bucket set + namespace; `asset-detail` is keyed by
  asset type + asset name + bucket set + namespace (Requirements 8.2, 8.3). The service supplies
  these via `conn.host` (bucket set) and `conn.parameters` (type/name/namespace), matching how
  the templates service composes cache keys.
- **TTL convention** — production TTLs follow the template profiles (list 1 hour, detail 24
  hours; both ≥ 3600, Requirement 8.4); test TTLs use `TTL_NON_PROD = 60` seconds
  (< production and ≤ 300, Requirement 8.5).
- **Chunk cache (deferrable)** — `get_agent_asset_chunk` will use a dedicated internal
  `agent-asset-chunks` / `chunk-data` connection with a TTL ≤ `asset-detail`, mirroring the
  existing `template-chunks` connection.

## Security

Security follows the repository's secure-coding steering and `AGENTS.md` least-privilege
guardrails.

- **Name validation and path-traversal rejection** — every `get_agent_asset` `name` must match
  `^[^/\\]+$` and be 1–255 characters; validation runs in `SchemaValidator` before any S3
  access, so a name containing `/` or `\` is rejected up front (Requirements 7.1, 7.7). This
  reuses the exact pattern already used by `get_template` in `schema-validator.js`.
- **Asset-type allow-listing** — `assetType` is validated against the enabled-type enum in
  `SchemaValidator` (and re-checked in the controller/service via `resolveEnabledType`) before
  any S3 access; an unknown or disabled `assetType` is rejected with `INVALID_INPUT` naming the
  valid types, and no bucket is read (Requirements 7.8, 5.5).
- **Prefix-scoped key construction** — S3 keys are built only by appending the validated
  `name` to the fixed `{namespace}/{basePath}/{folder}/` prefix; no user input can produce a
  key outside that prefix (Requirements 4.7, 7.3).
- **Bucket allow-listing** — reads occur only against buckets in
  `Config.settings().s3.buckets`; an `s3Buckets` filter naming any unconfigured bucket is
  rejected before any read (Requirements 4.1, 4.6). Buckets lacking the
  `atlantis-mcp:Allow=true` tag are skipped (brown-out) via `checkBucketAccess`
  (Requirement 4.2).
- **Untrusted content** — asset `content` is returned verbatim as text and is never executed
  or evaluated by the server (Requirement 7.4). Downstream consumers must treat it as
  untrusted, consistent with the general handling of external content.
- **Built-in crypto, no shell** — `sha256` is computed with the Node.js built-in `crypto`
  module over the exact object bytes; no shell is invoked and no third-party hashing library
  is added (Requirements 7.5, 2.3), consistent with `AGENTS.md`'s "use built-in crypto"
  guidance.
- **No secret logging** — logging uses `DebugAndLog` / `ErrorHandler.logS3Error` with bucket,
  key, and error message only; credentials, tokens, and signing keys are never logged
  (Requirement 7.6).
- **No new infrastructure or IAM** — the feature reuses existing buckets, outbound access,
  and admin-managed IAM, adding nothing to the stack template (Requirements 4, 10.6).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The following properties are derived from the acceptance-criteria prework and consolidated to
remove redundancy. Each is a universally quantified statement intended for property-based
testing with mocked S3, and each references the requirements it validates. Properties P1–P14
cover the core feature; P15 covers the deferrable large-asset handling of Requirement 9.

### Property 1: Listing includes exactly the direct, extension-matching objects

*For any* set of S3 objects under a type's prefix, `list` returns exactly those objects that
are **direct children** of `{namespace}/utilities/v2/agent_assets/{folder}/` **and** whose
filename ends with one of the type's configured `extensions`, and excludes every nested-subfolder
object, non-matching-extension object, and the prefix placeholder.

**Validates: Requirements 1.1, 1.5**

### Property 2: List-item completeness

*For any* asset returned by `list`, the item includes `name`, `type`, `namespace`, `bucket`,
`s3Path`, a numeric `size`, a non-empty `etag`, and `lastModified`, each reflecting the
retained source object.

**Validates: Requirements 1.2, 3.1**

### Property 3: Priority-order deduplication and selection

*For any* asset that appears in more than one bucket or namespace, `list` deduplicates on the
`(type, name)` pair — retaining only the first occurrence in registry-type order, then
configured-bucket order, then indexed-namespace priority order, and discarding all later
occurrences of that pair — while treating the same `name` under different types as distinct;
and `get` returns that same first-occurrence source for the requested `(assetType, name)`.

**Validates: Requirements 1.4, 2.2**

### Property 4: Deterministic ordering and full namespace coverage

*For any* source layout, `list` (when no namespace is supplied) searches all indexed namespaces
across the configured buckets and returns results ordered by registry asset-type order, then
configured-bucket order, then indexed-namespace priority, then ascending `name`, so that
identical inputs always produce identically ordered output regardless of S3 discovery order —
including the all-types listing, whose results are grouped in registry-type order.

**Validates: Requirements 1.1, 1.6, 4.4**

### Property 5: Namespace scoping

*For any* request that supplies a `namespace`, every returned asset originates from that single
namespace and no other namespace is read.

**Validates: Requirements 4.3**

### Property 6: Bucket scoping and invalid-filter rejection

*For any* request, every S3 read targets only buckets present in `settings.s3.buckets`; when an
`s3Buckets` filter lists only configured buckets the search is restricted to exactly that subset;
and when the filter names any unconfigured bucket the request is rejected with a validation error
identifying the invalid bucket(s) and performs no S3 read.

**Validates: Requirements 4.1, 4.5, 4.6**

### Property 7: Prefix-scoped key construction

*For any* validated `name`, `namespace`, and registered type, the constructed S3 key equals
`{namespace}/utilities/v2/agent_assets/{folder}/{name}` and therefore always begins with the
fixed `{namespace}/utilities/v2/agent_assets/{folder}/` prefix, referencing no location outside it.

**Validates: Requirements 4.7, 7.3**

### Property 8: Complete, verbatim asset detail

*For any* stored asset, `get` returns exactly one detail object whose `content` is byte-identical
to the object's stored bytes and which includes `name`, `type`, `namespace`, `bucket`, `s3Path`,
`size`, `etag`, `sha256`, and `lastModified`.

**Validates: Requirements 2.1, 3.2**

### Property 9: SHA-256 correctness and stability

*For any* object byte content, the returned `sha256` equals the lowercase hexadecimal SHA-256
digest of those exact bytes computed independently, and repeated reads of unchanged bytes yield
an identical `sha256`.

**Validates: Requirements 2.3, 3.4**

### Property 10: Brown-out and partial data

*For any* set of sources in which some buckets lack access or some reads fail, `list` skips the
inaccessible/failed sources, records each in the `errors` array, sets `partialData: true`, and
still returns the assets from all remaining successful sources.

**Validates: Requirements 4.2, 4.8**

### Property 11: Input validation before any S3 read

*For any* tool input that violates the schema — a missing `name`, a `name` containing `/` or `\`,
a `name` longer than 255 characters, an `assetType` that is unknown or names a disabled type, an
unknown property, or a malformed `namespace` or `s3Buckets` value — the tool returns a validation
error identifying the rejected parameter (and, for a bad `assetType`, naming the valid types) and
performs no S3 read.

**Validates: Requirements 7.1, 7.2, 7.7, 7.8**

### Property 12: Registry-driven fixed tools and assetType enum

*For any* registry, tool generation produces the fixed tool set — `list_agent_assets`,
`get_agent_asset`, `list_agent_asset_types`, and the deferrable `get_agent_asset_chunk` — each
with an input schema, a non-empty description, and a JSON-RPC dispatch entry, independent of the
registry contents; and the generated `assetType` enumeration on `list_agent_assets` and
`get_agent_asset` equals exactly the set of enabled type names, excluding every disabled or
absent entry. Adding or enabling a single entry adds exactly one accepted `assetType` value to
that enumeration, creates no new tool, and alters no other tool definition.

**Validates: Requirements 5.2, 5.4, 5.5, 6.1, 6.5**

### Property 13: Registry validation

*For any* registry entry that is missing a required field (`name`, `toolToken`, `folder`, a
non-empty `extensions`, or `description`) or that duplicates another entry's `name`, `toolToken`,
or `folder`, registry validation throws an error identifying the offending entry, and no
agent-asset tools are exposed.

**Validates: Requirements 5.7**

### Property 14: Unknown tool dispatch

*For any* tool name that is not present in the dispatch map, the router returns a JSON-RPC
"method not found" error identifying the requested name and invokes no controller wrapper. (An
unknown or disabled `assetType` supplied to one of the existing agent-asset tools is a distinct
case, handled by input validation in Property 11 rather than by method-not-found.)

**Validates: Requirements 6.4**

### Property 15: Chunk round-trip and index bounds (deferrable — Requirement 9)

*For any* asset content, requesting `get_agent_asset_chunk` for every index from `0` through
`totalChunks - 1` in order returns chunks that concatenate to reconstruct the complete content,
and any `chunkIndex` that is negative or `>= totalChunks` returns an `INVALID_CHUNK_INDEX` error
whose valid range is `0` through `totalChunks - 1`.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4**

### Criteria Covered by Non-Property Tests

The following criteria are validated by unit, integration, or configuration tests rather than
property tests (per the prework classification):

- **Example / unit**: empty listing returns success (1.3); `ASSET_NOT_FOUND` with available names
  (2.4); latest-version-only `GetObject` (2.5); shipped registry shape (5.1);
  `list_agent_asset_types` counts (6.3); `s3-common` helper behavior equivalence (5.6).
- **Integration**: `tools/call` dispatch returns MCP content for `list_agent_assets` and
  `get_agent_asset` (6.2, 11.4); an unknown/disabled `assetType` is rejected with `INVALID_INPUT`
  (7.8, 5.5); pass-through cache hit/miss behavior for list and get (8.2, 8.3); `tools/list`
  includes every fixed tool (11.4).
- **Smoke / config**: `s3-agent-assets` profiles resolve with numeric TTLs (8.1); production TTLs
  ≥ 3600 (8.4); test TTLs ≤ 300 and below production (8.5).
- **Not automatically testable (review-verified)**: absence of a server-side compare tool (3.3);
  generic-layer structure (5.3); no-exec/eval of content (7.4); built-in-crypto/no-shell (7.5);
  no-secret-logging (7.6); documentation content (10.1–10.5); no new infrastructure/IAM (10.6);
  test-layout conventions (11.1–11.3, 11.5).

## Error Handling

Error handling reuses `utils/error-handler.js` and `utils/mcp-protocol.js` and mirrors the
templates/starters controllers.

- **Input validation errors** — `SchemaValidator.validate(toolName, input)` runs first in every
  controller method. On failure the controller returns
  `MCPProtocol.errorResponse('INVALID_INPUT', { message, errors }, toolName)` and performs no
  service or S3 call. This covers missing/invalid `name`, path separators, over-length names,
  an unknown or disabled `assetType`, unknown properties, and malformed `namespace`/`s3Buckets`
  (Requirements 7.1, 7.2, 7.7, 7.8).
- **Invalid bucket filter** — when an `s3Buckets` filter names an unconfigured bucket, the service
  throws a validation error listing the invalid bucket(s); the controller maps it to
  `INVALID_INPUT` and no S3 read occurs (Requirement 4.6).
- **Asset not found** — the service throws an error with `code = 'ASSET_NOT_FOUND'` and
  `availableAssets`; the controller returns
  `MCPProtocol.errorResponse('ASSET_NOT_FOUND', { message, availableAssets }, toolName)`
  (Requirement 2.4). This mirrors `TEMPLATE_NOT_FOUND`/`STARTER_NOT_FOUND`.
- **Brown-out (bucket access / read failure)** — the DAO catches per-bucket and per-namespace
  failures, logs them via `ErrorHandler.logS3Error(...)` (bucket, key, message only — no secrets),
  records `{ source, sourceType: 's3', error, timestamp }` in `errors`, sets `partialData: true`,
  and continues with the remaining sources so a successful partial result is still returned
  (Requirements 4.2, 4.8). Cache-miss `fetchFunction` wraps a result containing `errors` with
  `ApiRequest.error({ body })` so error-bearing responses follow the same cache path as templates.
- **Path traversal** — rejected by schema validation before any key construction or S3 access
  (Requirements 7.1, 7.3); as defense in depth, keys are only ever built by appending the
  validated `name` to the fixed prefix.
- **Invalid chunk index (deferrable)** — `get_agent_asset_chunk` returns
  `INVALID_CHUNK_INDEX` with `validRange: { min: 0, max: totalChunks - 1 }` for out-of-range
  indices, cached like the template-chunk error via `ApiRequest.success` (Requirement 9.3).
- **Unexpected errors** — caught in the controller and returned as `INTERNAL_ERROR` with a
  sanitized message and no stack trace or internal detail, consistent with the existing
  controllers and the router's `-32603` catch-all.
- **Unknown tool name** — handled by the router's existing
  `Object.hasOwn(TOOL_DISPATCH, toolName)` guard, returning JSON-RPC `-32601` without invoking a
  controller (Requirement 6.4).
- **Unknown or disabled `assetType`** — rejected by `SchemaValidator` (the enum of enabled
  types) and re-checked in the controller/service, returning `INVALID_INPUT` with a message
  naming the valid `assetType` values and performing no S3 read (Requirements 7.8, 5.5). This is
  distinct from an unknown tool name: the tool exists, but the supplied `assetType` is not an
  enabled type.

## Testing Strategy

Testing follows the read-function's existing Jest layout and the repository's dual
(unit + property) approach. All new tests are Jest `*.test.js` files placed under
`tests/unit/<layer>/` for per-layer unit and property tests and `tests/integration/` for
cross-layer tests (Requirement 11.1). Property tests use **fast-check** (already used across the
repo, e.g. `tests/property/*.property.test.js` and `tests/unit/models/s3-starters-property.test.js`);
property-based testing is **not** implemented from scratch.

### Property-Based Tests

- One property-based test implements each correctness property (P1–P15).
- Each property test runs a **minimum of 100 iterations** (fast-check `numRuns: 100`), except
  where repository steering caps expensive suites — this feature's property tests operate on
  mocked S3 and pure logic, so 100 iterations is inexpensive and is the default here.
- Each property test is tagged with a comment referencing its design property, in the format:
  **Feature: agent-asset-tools, Property {number}: {property text}**.
- S3 is mocked (no live AWS): the `@63klabs/cache-data` `AWS.s3` getter is stubbed following the
  repository's getter-mocking guidance (`jest.spyOn(tools.default.AWS, 's3', 'get')`), or the DAO's
  exported pure helpers (`deduplicateAssets`, `filterByExtension`, `buildAssetKey`, `computeSha256`,
  `parseAssetMetadata`) are exercised directly for the pure-logic properties. `sha256` is verified
  against an independent Node `crypto` computation over the same generated bytes.

Property-to-location map (indicative):

| Property | Primary test location |
|----------|-----------------------|
| P1, P2, P3, P4, P5, P8, P9, P10 | `tests/unit/models/s3-agent-assets.property.test.js` |
| P6, P11 | `tests/unit/services/agent-assets.property.test.js`, `tests/unit/controllers/agent-assets.property.test.js` |
| P7 | `tests/unit/models/s3-agent-assets.property.test.js` |
| P12, P13 | `tests/unit/config/agent-asset-types.property.test.js` |
| P14 | `tests/property/agent-asset-dispatch.property.test.js` (router) |
| P15 (deferrable) | `tests/unit/controllers/agent-assets-chunk.property.test.js` |

### Unit Tests (examples, edge, and error cases)

Focused example-based unit tests, avoiding over-testing what the property tests already cover:

- **DAO** (`tests/unit/models/s3-agent-assets-dao.test.js`) — empty listing → empty list, no error
  (1.3); latest-version `GetObject` with no `VersionId` (2.5); representative brown-out example.
- **Service** (`tests/unit/services/agent-assets.test.js`) — all-types `list` aggregates across
  enabled types in registry order (1.1); `ASSET_NOT_FOUND` includes available names and the
  empty-names case (2.4); `list_agent_asset_types` counts (6.3); invalid-bucket rejection example
  (4.6); unknown/disabled `assetType` rejection (7.8).
- **Controller** (`tests/unit/controllers/agent-assets-controller.test.js`) — validation-failure →
  `INVALID_INPUT`; unknown/disabled `assetType` → `INVALID_INPUT` naming valid types (7.8);
  not-found → `ASSET_NOT_FOUND`; success envelope shape for both single-type and all-types list.
- **Registry** (`tests/unit/config/agent-asset-types.test.js`) — shipped registry satisfies the
  required shape (5.1); `skills` is disabled and is absent from the generated `assetType` enum
  while the fixed tools still exist (5.5); a synthetic added entry adds exactly one accepted
  `assetType` value and creates no new tool (5.4).
- **Shared helper** (`tests/unit/models/s3-common.test.js`) — `checkBucketAccess` and
  `getIndexedNamespaces` behave equivalently to the existing DAO helpers (5.6); existing
  `s3-templates`/`s3-starters` DAO suites remain unchanged and green (5.6, 11.5).
- **Config** (`tests/unit/config/connections.test.js` additions) — `s3-agent-assets` resolves both
  profiles with numeric TTLs (8.1); production TTLs ≥ 3600 (8.4); test TTLs ≤ 300 and below
  production (8.5).

### Integration Tests

Cross-layer tests under `tests/integration/` with mocked S3 (Requirement 11.4):

- **Router / MCP** (`tests/integration/agent-assets-integration.test.js`) — the fixed agent-asset
  tools (`list_agent_assets`, `get_agent_asset`, `list_agent_asset_types`) appear in `tools/list`,
  each with a description and input-schema object, and the two generic tools carry the `assetType`
  enum of enabled types (6.1); `tools/call` to `list_agent_assets` returns the mocked assets (6.2);
  `tools/call` to `get_agent_asset` returns content equal to the mocked bytes with `sha256` equal
  to the SHA-256 of those bytes (2.1, 2.3, 6.2); a `tools/call` to `get_agent_asset` (or
  `list_agent_assets`) with an unknown or disabled `assetType` such as `skills` returns
  `INVALID_INPUT` before any S3 read (7.8, 5.5); and a `tools/call` naming an unknown tool returns
  `-32601` (6.4).
- **Caching** (`tests/integration/agent-assets-caching.test.js`) — repeated identical
  `list_agent_assets`/`get_agent_asset` requests are served from cache without new S3 reads, and
  requests differing in any key component (including a single-type vs an all-types list) are
  cached separately (8.2, 8.3).

### Verification and CI

All new and existing Jest suites must pass with zero failures before the change is considered
complete (Requirement 11.5). The read-function suite is run per function via its own
`package.json`/`jest.config.js` under the multi-src buildspec loop, matching the repository's
CI/CD gate. Property and DAO tests use mocked S3 only — no live AWS calls — and clean up mocks in
`afterEach` per the repository's test-isolation guidance.

## Deferrable Scope (Requirement 9)

Requirement 9 (large-asset handling) may be delivered **after** the core tools; current assets fit
well under the 50,000-byte threshold. The core delivery includes the fixed tools
`list_agent_assets`, `get_agent_asset`, and `list_agent_asset_types`, the registry (with its
`assetType` enum of enabled types), the shared S3 helper, caching, and Properties P1–P14.
The deferrable slice adds:

- The size-aware `get_agent_asset` summary in `json-rpc-router.js` (a
  `toolName === 'get_agent_asset'` branch mirroring the existing `get_template` summary:
  `contentTruncated: true`, `totalChunks`, retrieval hint) using `ContentSizer.measure`.
- The `get_agent_asset_chunk` tool (mirroring `Templates.getChunk` with `ContentChunker.chunk`,
  taking `assetType`, `name`, and `chunkIndex`) and its `agent-asset-chunks` internal cache
  connection.
- Property P15 and the chunk-related unit tests.

Because the summary/chunk wiring reuses the exact `ContentSizer`/`ContentChunker` utilities and the
established chunk-cache pattern, it can be added without changing the registry-driven core.

## Requirements Traceability

| Requirement | Covered by |
|-------------|-----------|
| 1. List assets of a type | DAO `list`; Properties P1–P5; unit (1.3) |
| 2. Retrieve a single asset | DAO `get`; Properties P3, P8, P9; unit (2.4, 2.5) |
| 3. Client-side comparison support | List/detail data models; Properties P2, P8, P9; review (3.3) |
| 4. S3 sourcing (buckets + namespaces) | DAO + service; Properties P5, P6, P7, P10 |
| 5. Registry-driven DRY design | Registry + generic layers + `s3-common`; Properties P12, P13; unit (5.1, 5.6) |
| 6. MCP protocol integration | Fixed-tool dispatch + `assetType` enum generation; Properties P12, P14; integration (6.1, 6.2); unit (6.3) |
| 7. Input validation and security | SchemaValidator + Security section; Properties P7, P11; review (7.4–7.6) |
| 8. Caching | `s3-agent-assets` connection; integration (8.2, 8.3); config tests (8.1, 8.4, 8.5) |
| 9. Large-asset handling (deferrable) | Size-aware summary + `get_agent_asset_chunk`; Property P15 |
| 10. Documentation and configuration | Docs updates + CHANGELOG (review-verified) |
| 11. Testing and verification | Property, unit, and integration suites; CI gate |
