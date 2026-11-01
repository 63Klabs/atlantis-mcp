# Design Document

## Overview

This document is the design for [MCP Protocol Dual-Era Support](requirements.md). It describes how the Read Function will serve both the legacy handshake-based MCP revisions (`2024-11-05` and `2025-11-25`) and the modern stateless revision (`2026-07-28`) from the same `POST /mcp/v1` endpoint, with real per-request version negotiation and shared server-level `instructions` on both.

The design is grounded in the existing code: `utils/json-rpc-router.js`, `utils/mcp-protocol.js`, `utils/tool-catalog.js`, `routes/index.js`, `config/server-instructions.js`, and `template.yml`. The companion [`0-0-7-tool-discovery-enhancement`](../0-0-7-tool-discovery-enhancement/) spec has already landed the `instructions` content module, the Tool Metadata Registry, and the `tool-catalog.js` merge point; this spec plugs those existing pieces into a two-era protocol surface and fills in the modern-only envelope requirements.

The guiding theme is that era is a *per-request response-shaping decision*, not a session state. The Lambda holds no cross-request state in either era, so adding modern support is additive on the response side (`resultType`, `_meta`, `CacheableResult`, `server/discover`) and additive on the input side (per-request version metadata, optional header validation), with no new stateful machinery.

## Architecture

### Request lifecycle (per-request era resolution)

```
API Gateway (POST /mcp/v1 or OPTIONS preflight)
    │
    ├─ OPTIONS → API Gateway Cors stanza responds. Lambda not invoked.
    │
    └─ POST → read-function Lambda
            │
            ▼
        index.js handler
            │ (unchanged: cold start, auth, rate limit)
            ▼
        routes/index.js  (unchanged dispatch to /mcp/v1 POST)
            │
            ▼
        utils/json-rpc-router.js  handleJsonRpc()
            │
            ├─ parse body, extract id, validate envelope  (unchanged)
            │
            ├─ NEW: resolveEra(method, body._meta, headers)   ──► 'legacy' | 'modern'
            │
            ├─ NEW: validateHeadersIfModern(era, method, headers, body)
            │       (-32020 HeaderMismatch on fail)
            │
            ├─ NEW: negotiateVersion(era, body._meta, headers)
            │       returns { revision } on success,
            │       or produces -32022 UnsupportedProtocolVersionError
            │
            ▼
        switch(method)
            │
            ├─ 'initialize'       → initializeFormatter(id, era, revision)
            ├─ 'server/discover'  → discoverFormatter(id, era, revision)      ◄ NEW method
            ├─ 'tools/list'       → toolsListFormatter(id, era, revision, catalog)
            ├─ 'tools/call'       → handleToolsCall → wrapToolResult(era)
            └─ default            → -32601 Method not found
            │
            ▼
        buildResponse(statusCode, envelope)  (unchanged shape)
            │
            ▼
        routes/index.js copies headers onto Response  (strip list resolved)
            │
            ▼
        response.finalize()  (unchanged)
```

Everything new (ovaled above) lives inside `utils/`. The handler, routes dispatch, rate limiter, auth resolver, and `response.finalize()` path are not touched by this spec.

### Modules — what moves where

| Module | Role in this spec |
|---|---|
| `config/server-instructions.js` | **Already exists.** Single source of the `instructions` string. Unchanged. Both era carriers read `buildInstructions()`. |
| `config/release-version.js` | **New.** Build-time-generated file carrying the deployed release version string, read by server-identity carriers in both eras. |
| `utils/mcp-protocol.js` | Reworked. `getCapabilities()` and `negotiateProtocol()` cease to be dead code and become the shared capability source and shared negotiation source. New formatters: `discoverResult()`, era-branched `toolsListResult()`, era-branched `initializeResult()`. New error-code constants (-32020, -32022). |
| `utils/mcp-era.js` | **New.** The era discriminator (`resolveEra()`), header-validator (`validateHeadersForModern()`), and version-negotiation entry (`negotiateVersion()`). Kept in its own module so the router stays a thin switch. |
| `utils/json-rpc-router.js` | Threaded with the era resolver and formatter calls. `STANDARD_HEADERS` loses the three CORS entries. Dead-code annotation added for `Content-Type` and `Access-Control-Allow-Origin`. |
| `utils/tool-catalog.js` | **Already exists.** Reads the negotiated revision via its `options.protocolVersion` parameter (which is already there). This spec populates `REVISIONS_SUPPORTING_TITLE_ANNOTATIONS` with `['2025-11-25', '2026-07-28']`. |
| `routes/index.js` | Strip-list reconciled with the resolved `STANDARD_HEADERS`. |
| `template.yml` | CORS `AllowHeaders` extended by `MCP-Protocol-Version, Mcp-Method, Mcp-Name`. No other change. |

### Advertised revisions and gating

| Revision | Advertised in `supportedVersions`? | Trigger method | Full implementation gate |
|---|---|---|---|
| `2024-11-05` | Yes, from Phase 1 | `initialize` | Already fully implemented at the time of this spec. |
| `2025-11-25` | Yes, from Phase 3 (last handshake revision; the user-chosen primary legacy target) | `initialize` | Added only after the Phase 2 audit confirms the server emits every field this revision requires. |
| `2026-07-28` | Yes, from Phase 4 | `_meta['io.modelcontextprotocol/protocolVersion']` or `MCP-Protocol-Version` header | Added only after `server/discover`, `resultType`, `CacheableResult`, `_meta` server identity, header validation, and the new error codes are all live and tested. |

Both legacy revisions are advertised rather than only the newer one, so a legacy client pinned to `2024-11-05` keeps its path. The MCP negotiation rule — server picks the highest mutually-supported revision — means an uplevel-capable legacy client naturally lands on `2025-11-25` once the audit is done.

## Components and Interfaces

### 1. Shared `instructions` source — `config/server-instructions.js`

**Already in place.** Exports `buildInstructions(options)`. Both era carriers call it with no arguments in the Phase 1–3 window; the discovery spec's Phase 5 work will pass `{ repositories }`.

The contract this spec adds: `buildInstructions()` is the **only** place `instructions` is composed. Neither `initializeResponse()`, `discoverResult()`, nor any new helper may construct the string inline. A test asserts that both the legacy and modern carriers return the exact same `instructions` string character-for-character.

### 2. Release version — `config/release-version.js` (new)

**Problem.** `mcp-protocol.js` currently reads `const { version: SERVER_VERSION } = require('../package.json')`. The read-function's `package.json` has `0.0.2`; the deployed release is `v0.0.7`. The two can drift silently because they are maintained by different people in different places. Requirement 2 forbids this.

**Design.**

Introduce one build-time-generated file:

```javascript
// config/release-version.js  (generated — do not edit by hand)
module.exports = { releaseVersion: '0.0.7' };
```

The value is generated by a new helper in `application-infrastructure/build-scripts/`, invoked in `buildspec.yml`'s `pre_build` phase per Lambda directory. It reads the first `## [vX.Y.Z]` line in the repo-root `CHANGELOG.md` (same source the spec-naming convention uses) and writes the module above into every Lambda's `config/`.

A dev-time fallback: if `config/release-version.js` is absent (e.g., running tests directly against a fresh checkout), `mcp-protocol.js` falls back to `require('../package.json').version` and logs an INFO-level `release_version_fallback` event. This keeps unit tests green without the build step and makes any production fallback detectable in logs.

```javascript
// in mcp-protocol.js
function getReleaseVersion() {
  try {
    return require('../config/release-version.js').releaseVersion;
  } catch {
    const { version } = require('../package.json');
    DebugAndLog.info(`release_version_fallback ${JSON.stringify({ version })}`);
    return version;
  }
}
const SERVER_VERSION = getReleaseVersion();
```

**Single-source consequence.** Every carrier reads `SERVER_VERSION` from this one `getReleaseVersion()` call. No other file references `0.0.x` as a literal. The existing `initializeResponse` already reads the module-level `SERVER_VERSION` constant, so the only code change here is in that constant's initializer. Requirement 2.5 ("legacy and modern derived from the same definition") is satisfied by construction.

**Build-script responsibility.** Added to `build-scripts/write_release_version.py` (new, Python to match sibling scripts). Behavior: parse the repo-root `CHANGELOG.md`, find the first `## [vX.Y.Z]` line (released or unreleased), strip the leading `v`, write `release-version.js` into each `src/lambda/*/config/` directory. Idempotent: safe to run repeatedly. Fails the build if the parse finds no version header. Added to the per-function loop in `buildspec.yml` (same pattern the existing `generate-put-ssm.py` call uses).

### 3. Shared capability source — reworked `getCapabilities()`

The current `getCapabilities()` returns a legacy-flavored envelope with `protocol: 'mcp'`, `vendor: '63Klabs'`, `description`, and `tools`. None of those keys appears on the wire for either era. It is dead code called only by tests.

**New shape:**

```javascript
/**
 * The shared capability source. Returns capabilities, server identity,
 * supported versions, and instructions in one call. Format is era-neutral;
 * the formatters shape it into era-appropriate envelopes.
 *
 * @param {Object} [options]
 * @param {Array<{name: string, repositoryType?: string}>} [options.repositories]
 * @returns {{
 *   supportedVersions: string[],
 *   capabilities: Object,
 *   serverInfo: {name: string, version: string},
 *   instructions: string
 * }}
 */
function getCapabilities(options) {
  return {
    supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
    capabilities: MCP_CAPABILITIES_WIRE,
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    instructions: buildInstructions(options)
  };
}
```

Where:

```javascript
const SERVER_NAME = 'atlantis-mcp-server';

// Single source of truth. The order here is irrelevant to clients, but
// is kept sorted ascending so a diff is obvious at review time.
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  '2024-11-05',
  '2025-11-25',  // added Phase 3, after Requirement 11 audit
  '2026-07-28'   // added Phase 4, after Requirement 12 gate
]);

// On-wire capability object. Matches the schema both eras use.
// `tools.listChanged: false` because this server is stateless and
// cannot push notifications. `resources`, `prompts`, `sampling` are
// absent (not false-flagged), consistent with the modern schema.
const MCP_CAPABILITIES_WIRE = Object.freeze({
  tools: { listChanged: false }
});
```

Note the three constants (`SUPPORTED_PROTOCOL_VERSIONS`, `MCP_CAPABILITIES_WIRE`, `SERVER_NAME`) are each defined exactly once at the top of `mcp-protocol.js`. A unit test enforces that neither `json-rpc-router.js`, `routes/index.js`, `controllers/`, nor `services/` contains a hardcoded protocol-revision string by grepping those directories for `/\b202\d-\d\d-\d\d\b/` and failing on any match outside `mcp-protocol.js` and its test file.

**Phased population of `SUPPORTED_PROTOCOL_VERSIONS`.**

| Phase | Array contents | Rationale |
|---|---|---|
| 1 | `['2024-11-05']` | Status quo; `instructions` added to the carrier but version set unchanged. |
| 3 | `['2024-11-05', '2025-11-25']` | After Requirement 11 field audit. |
| 4 | `['2024-11-05', '2025-11-25', '2026-07-28']` | After all modern-required fields pass tests. |

A deployed revision that fails any of its required-field tests must not reach `SUPPORTED_PROTOCOL_VERSIONS` — Requirement 3.4. We enforce this by colocating the required-fields tests with the version addition in the same PR.

**Legacy `getCapabilities()` callers.** The dead test at `tests/unit/utils/mcp-protocol.test.js` describing the old shape, and the property test in `tools-mcp-protocol.property.test.js` that asserts `getCapabilities().tools === settings.tools.availableToolsList`, both need updating. The latter test's intent — assert the reference identity of the tool manifest — is preserved by moving it to assert `MCP_TOOLS === settings.tools.availableToolsList` on the existing `MCP_TOOLS` export, which is independent of `getCapabilities()`.

### 4. Shared negotiation source — reworked `negotiateProtocol()`

The current `negotiateProtocol()` returns a prose `message` and uses MCP protocol version string `'1.0'`, which is not a real revision. It is dead code.

**New shape:**

```javascript
/**
 * Decide whether a declared protocol revision is supported, and return
 * a structured decision rather than a prose message.
 *
 * @param {string|undefined} declaredRevision
 * @returns {{ supported: true, revision: string }
 *           | { supported: false, declaredRevision: string|null, supportedVersions: string[] }}
 */
function negotiateProtocol(declaredRevision) {
  if (!declaredRevision) {
    return { supported: false, declaredRevision: null, supportedVersions: SUPPORTED_PROTOCOL_VERSIONS };
  }
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(declaredRevision)) {
    return { supported: true, revision: declaredRevision };
  }
  return { supported: false, declaredRevision, supportedVersions: SUPPORTED_PROTOCOL_VERSIONS };
}
```

Caller (in `utils/mcp-era.js`) turns an unsupported result into `UnsupportedProtocolVersionError` with the full `supportedVersions` list in `data`.

### 5. Era discriminator — `utils/mcp-era.js` (new)

Kept in its own module so the router stays a thin switch and the discrimination logic can be unit-tested in isolation.

```javascript
/**
 * Resolve the per-request era from the inbound method and declared protocol version.
 *
 * Per Requirement 4:
 *  - method === 'initialize'        → legacy
 *  - method === 'server/discover'   → modern (probe method; always answerable)
 *  - declared revision is supported-modern → modern
 *  - declared revision is supported-legacy → legacy
 *  - no declared revision + method is any other → default rule below
 *  - declared revision not in supportedVersions → caller raises -32022
 *
 * Default rule (Requirement 4.5): absent declared revision defaults to **legacy**.
 * Rationale: a legacy client that worked before this release sent `initialize`
 * once at session start and omitted `_meta.protocolVersion` on subsequent requests.
 * Those subsequent requests MUST continue to work (Requirement 16). A modern client
 * that cares about the modern wire shape has an explicit mechanism to say so
 * (`_meta` or header). Silence is therefore read as "I'm the old-shaped client."
 *
 * @param {string} method
 * @param {Object} body
 * @param {Object<string, string>} headers
 * @returns {{ era: 'legacy'|'modern', declaredRevision: string|null }}
 */
function resolveEra(method, body, headers) {
  // Header is authoritative when present (Requirement 4.7).
  const headerVersion = pickHeader(headers, 'mcp-protocol-version');
  const bodyVersion = body?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? null;
  const declaredRevision = headerVersion ?? bodyVersion ?? null;

  // server/discover is always modern-shaped (Requirement 4.3 and 5.3).
  if (method === 'server/discover') {
    return { era: 'modern', declaredRevision };
  }

  // initialize is legacy by construction (Requirement 4.1).
  if (method === 'initialize') {
    return { era: 'legacy', declaredRevision };
  }

  if (declaredRevision) {
    // Era inferred from which bucket the revision falls into. If the revision
    // is unsupported entirely, the caller will raise -32022 regardless of era.
    if (MODERN_REVISIONS.includes(declaredRevision)) {
      return { era: 'modern', declaredRevision };
    }
    if (LEGACY_REVISIONS.includes(declaredRevision)) {
      return { era: 'legacy', declaredRevision };
    }
    // Unsupported revision. Shape as modern so the caller returns a modern
    // -32022 (richer error data). The caller detects this via negotiateProtocol().
    return { era: 'modern', declaredRevision };
  }

  // No declared revision + non-handshake method → default legacy.
  return { era: 'legacy', declaredRevision: null };
}
```

Where `LEGACY_REVISIONS` and `MODERN_REVISIONS` are derived once from `SUPPORTED_PROTOCOL_VERSIONS`:

```javascript
const LEGACY_REVISIONS = Object.freeze(['2024-11-05', '2025-11-25']);
const MODERN_REVISIONS = Object.freeze(['2026-07-28']);
// Invariant (asserted at module load): the union equals SUPPORTED_PROTOCOL_VERSIONS.
```

These are the only three revision strings in the codebase. The partitioning (which revision is legacy vs modern) is specification-defined and not a configuration surface.

**`pickHeader()` helper.** HTTP header names are case-insensitive, API Gateway lower-cases the keys in `event.headers`, and some proxies capitalize. The helper normalizes:

```javascript
function pickHeader(headers, name) {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}
```

**Modern-only header validation.**

```javascript
/**
 * Modern-era header validation (Requirement 8). Returns null on success,
 * or a {code, message, data} payload the caller wraps into -32020.
 */
function validateHeadersForModern(method, headers, body) {
  const mcpMethod = pickHeader(headers, 'mcp-method');
  if (mcpMethod && mcpMethod !== method) {
    return {
      code: JSON_RPC_ERRORS.HEADER_MISMATCH,
      message: 'Header mismatch',
      data: { detail: 'Mcp-Method header disagrees with body method',
              headerValue: mcpMethod, bodyValue: method }
    };
  }
  const mcpName = pickHeader(headers, 'mcp-name');
  if (mcpName && method === 'tools/call') {
    const bodyName = body?.params?.name ?? null;
    if (mcpName !== bodyName) {
      return {
        code: JSON_RPC_ERRORS.HEADER_MISMATCH,
        message: 'Header mismatch',
        data: { detail: 'Mcp-Name header disagrees with params.name',
                headerValue: mcpName, bodyValue: bodyName }
      };
    }
  }
  return null;
}
```

Called only when `era === 'modern'`. Legacy requests skip this function entirely (Requirement 8.3).

### 6. Error codes — new entries in `JSON_RPC_ERRORS`

```javascript
const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Added by this spec.
  HEADER_MISMATCH: -32020,                   // Requirement 6.1, 8
  UNSUPPORTED_PROTOCOL_VERSION: -32022       // Requirement 6.2, 4.4
  // -32021 MISSING_REQUIRED_CLIENT_CAPABILITY is reserved per Requirement 6.5
  // but intentionally not defined here, so an unused constant does not
  // tempt a future contributor into emitting it before the capability
  // model that would warrant it exists.
};
```

Error-code name convention follows the existing uppercase-with-underscores pattern. The pre-existing codes keep their numbers and names unchanged (Requirement 6.3).

**`UNSUPPORTED_PROTOCOL_VERSION` data payload** (Requirement 15.5):

```javascript
{
  code: -32022,
  message: 'Unsupported protocol version',
  data: {
    declaredRevision: '2099-01-01',    // what the client sent
    supportedVersions: ['2024-11-05', '2025-11-25', '2026-07-28']
  }
}
```

The error is raised whether the request's era is nominally legacy or modern — a legacy client that puts an unknown revision in `initialize.params.protocolVersion` gets the same error data, because `negotiateProtocol()` is called from both branches with the respective version source.

### 7. Formatters — era-branched envelopes in `mcp-protocol.js`

The existing `initializeResponse(id)` becomes `initializeResult(id, { declaredRevision })` and keeps emitting a legacy envelope. The new `discoverResult(id)` emits the modern envelope. `toolsListResponse(id, tools)` becomes `toolsListResult(id, { era, tools })`. A controller never constructs an envelope directly (Requirement 7.6).

**`initializeResult(id, { declaredRevision })`** — legacy only:

```javascript
function initializeResult(id, { declaredRevision } = {}) {
  const caps = getCapabilities();
  // Legacy handshake echoes the client's revision back when supported.
  // Pick highest supported legacy revision as default when client omits one
  // (some older clients did — not ours, but the spec permits it).
  const revision = declaredRevision && LEGACY_REVISIONS.includes(declaredRevision)
    ? declaredRevision
    : LEGACY_REVISIONS[LEGACY_REVISIONS.length - 1]; // highest supported legacy
  return jsonRpcSuccess(id, {
    protocolVersion: revision,
    capabilities: caps.capabilities,
    serverInfo: caps.serverInfo,
    instructions: caps.instructions
  });
}
```

Note: no `resultType`. No `_meta`. These are the Requirement 7.2 and Requirement 16.3 guarantees.

**`discoverResult(id)`** — modern only, no echo field (there is no handshake):

```javascript
function discoverResult(id) {
  const caps = getCapabilities();
  return jsonRpcSuccess(id, {
    supportedVersions: caps.supportedVersions,
    capabilities: caps.capabilities,
    instructions: caps.instructions,
    ttlMs: TOOLS_LIST_TTL_MS,
    cacheScope: TOOLS_LIST_CACHE_SCOPE,
    resultType: 'complete',                              // Requirement 7.1
    _meta: {
      'io.modelcontextprotocol/serverInfo': caps.serverInfo  // Requirement 2.4
    }
  });
}
```

**`toolsListResult(id, { era, catalog, revision })`** — branches on era:

```javascript
function toolsListResult(id, { era, catalog, revision }) {
  if (era === 'legacy') {
    return jsonRpcSuccess(id, { tools: catalog });       // Requirement 7.4
  }
  // Modern: CacheableResult envelope (Requirement 7.3).
  return jsonRpcSuccess(id, {
    tools: catalog,
    ttlMs: TOOLS_LIST_TTL_MS,
    cacheScope: TOOLS_LIST_CACHE_SCOPE,                  // Requirement 7.3 ('public')
    resultType: 'complete',                              // Requirement 7.1
    _meta: {
      'io.modelcontextprotocol/serverInfo': {
        name: SERVER_NAME, version: SERVER_VERSION
      }
    }
  });
}
```

`TOOLS_LIST_TTL_MS` is a module-level constant in `mcp-protocol.js`:

```javascript
// Tools list cache hint for modern clients. 10 minutes.
// The server itself does not cache the tools/list response; this value
// is strictly an advisory for the client. See docs/admin-ops for the
// rationale behind the chosen interval.
const TOOLS_LIST_TTL_MS = 10 * 60 * 1000;
```

`cacheScope: 'public'` means the response may be served from a shared cache across callers, which is true for this stateless, authentication-independent tool manifest ([caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching)). (The optional discovery-spec filters do not vary tools/list output; they vary `search_documentation` output.)

> **Correction, 2026-10-29**: this design first specified `'server'`, which the specification does not allow. See [0-0-7-tools-list-returns-cachescope-server-which-kiro](../0-0-7-tools-list-returns-cachescope-server-which-kiro/).

Both TTL and scope come from the file-level constants `TOOLS_LIST_TTL_MS` and `TOOLS_LIST_CACHE_SCOPE` — the "documented configuration source" of Requirement 7.3 is this module.

**Modern `tools/call` result wrapping.** The existing `handleToolsCall` builds a `{ content: [...] }` result. Modern-era extension:

```javascript
// In handleToolsCall, after building the result object, before buildResponse:
const envelope = era === 'modern'
  ? {
      content: result.content,
      resultType: 'complete',
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: SERVER_NAME, version: SERVER_VERSION } }
    }
  : result;  // legacy: unchanged shape
return buildResponse(200, MCPProtocol.jsonRpcSuccess(id, envelope));
```

The size-aware summary paths (`get_template`, `get_document`, `get_agent_asset`) are wrapped the same way.

**Deterministic ordering of `tools/list`** (Requirement 7.7). `settings.tools.availableToolsList` is already a stable array; `tool-catalog.js` uses `.map()` without reordering. A unit test asserts: for a fixed input, two consecutive `toolsListResult()` calls return deep-equal `.result.tools` arrays, and `JSON.stringify` of both is identical.

### 8. Routing — `utils/json-rpc-router.js` changes

The current switch stays almost as-is. Changes:

1. After parsing the body and extracting `id`, call `resolveEra(method, body, event.headers)` and `validateHeadersForModern(method, event.headers, body)` (only when `era === 'modern'`). On header mismatch, return `-32020` and skip dispatch.
2. Call `negotiateProtocol(declaredRevision)` **only when `declaredRevision !== null`**. (A legacy client sending `initialize` without a `_meta.protocolVersion` is fine; one that *does* declare an unknown revision gets `-32022`.)
3. Add a `case 'server/discover'` arm. It always answers; no auth; no filtering. Documentation covers this in Requirement 5.5.
4. Pass `{ era, revision }` into formatters.
5. Thread `era` into `handleToolsCall` so it can envelope-wrap the result.

Resulting switch body (pseudo):

```javascript
const { era, declaredRevision } = resolveEra(method, body, event.headers);

if (era === 'modern') {
  const headerErr = validateHeadersForModern(method, event.headers, body);
  if (headerErr) {
    return buildResponse(200, jsonRpcError(id, headerErr.code, headerErr.message, headerErr.data));
  }
}

if (declaredRevision !== null) {
  const decision = negotiateProtocol(declaredRevision);
  if (!decision.supported) {
    return buildResponse(200, jsonRpcError(
      id,
      JSON_RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION,
      'Unsupported protocol version',
      { declaredRevision: decision.declaredRevision, supportedVersions: decision.supportedVersions }
    ));
  }
}

switch (method) {
  case 'initialize':
    return buildResponse(200, initializeResult(id, { declaredRevision }));
  case 'server/discover':
    return buildResponse(200, discoverResult(id));
  case 'tools/list': {
    const catalog = buildToolCatalog({ protocolVersion: declaredRevision });
    return buildResponse(200, toolsListResult(id, { era, catalog }));
  }
  case 'tools/call':
    return await handleToolsCall(id, params, clientRequest, authInfo, era);
  default:
    return buildResponse(200, jsonRpcError(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, 'Method not found', { method }));
}
```

### 9. `tool-catalog.js` — populate the title/annotations allowlist

The existing scaffolding reads a `protocolVersion` option and consults `REVISIONS_SUPPORTING_TITLE_ANNOTATIONS`, which is currently empty. This spec populates it:

```javascript
const REVISIONS_SUPPORTING_TITLE_ANNOTATIONS = Object.freeze([
  '2025-11-25',  // legacy, last handshake revision
  '2026-07-28'   // modern
]);
```

`BASELINE_PROTOCOL_VERSION` (currently `'2024-11-05'`) stays as-is — it is the revision on which the companion spec deliberately chose to NOT emit `title`/`annotations`, matching Requirement 13.2's "legacy that does not require those fields omits them" clause.

Phase 3 adds `'2025-11-25'`; Phase 4 adds `'2026-07-28'`. A unit test asserts that for a `tools/list` call declared as `2024-11-05`, no tool definition carries a `title` or `annotations` property; for `2025-11-25` or `2026-07-28`, every tool with a registry entry carries both.

### 10. Response headers — reconciling router, routes, and `Response.finalize()`

Per Requirement 9.3, we **choose Option (a)**: remove `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` from both `STANDARD_HEADERS` and the `routes/index.js` strip list, on the grounds that API Gateway owns CORS. Rationale: option (b) ships three headers for CloudWatch readers to misread as the live CORS policy when the real policy is in `template.yml`. One owner per concern wins.

`routes/index.js` current strip list:

```javascript
if (!['content-type', 'access-control-allow-origin',
      'access-control-allow-methods', 'access-control-allow-headers'].includes(name.toLowerCase())) {
  response.addHeader(name, value);
}
```

Becomes:

```javascript
// Response.finalize() manages Content-Type and Access-Control-Allow-Origin
// (the latter unconditionally overwrites any application-set value).
// Access-Control-Allow-Methods and Access-Control-Allow-Headers are owned
// by API Gateway's Cors stanza in template.yml and are answered on the
// CORS preflight without Lambda involvement.
const CACHE_DATA_MANAGED_HEADERS = new Set([
  'content-type',
  'access-control-allow-origin'
]);
for (const [name, value] of Object.entries(jsonRpcResponse.headers)) {
  if (!CACHE_DATA_MANAGED_HEADERS.has(name.toLowerCase())) {
    response.addHeader(name, value);
  }
}
```

Corresponding change in `STANDARD_HEADERS`:

```javascript
const STANDARD_HEADERS = {
  'Content-Type': 'application/json',    // overwritten by finalize(); kept for symmetry and dev-time clarity
  'X-MCP-Version': '1.0',
  'Access-Control-Allow-Origin': '*'     // overwritten unconditionally by finalize()
  // Access-Control-Allow-Methods and -Headers removed — owned by API Gateway
};
```

A comment above `STANDARD_HEADERS` records the finding from Requirement 9.2:

```javascript
// `Content-Type` is set by Response.finalize() from the body when unset;
// `Access-Control-Allow-Origin` is overwritten by Response.finalize()
// unconditionally regardless of any application-set value. The two entries
// here are preserved for dev-time grep clarity but have no runtime effect.
// `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` are
// declared in the API Gateway Cors stanza in template.yml and answered on
// the CORS preflight by API Gateway without the Lambda being invoked.
```

**Existing router test update** (Requirement 9.5). The current test (`tests/unit/utils/json-rpc-router.test.js`) asserts `Access-Control-Allow-Origin`, `-Methods`, and `-Headers` on the response. Under the chosen resolution, only `Access-Control-Allow-Origin` remains in `STANDARD_HEADERS`. The test is updated to assert that the three API-Gateway-managed headers are **not** on the Lambda-constructed response, with a comment explaining they are expected on the production response via API Gateway's own Cors stanza. The test gains a new assertion for the chosen defense-in-depth posture: that `Access-Control-Allow-Origin: *` is present on the Lambda response (which `finalize()` enforces anyway).

**No new server-set response header is introduced by this spec.** Had we chosen to emit an `MCP-Protocol-Version` response header announcing the resolved revision (which the modern spec permits but does not require), it would have gone through `response.addHeader()` after the router returned (Requirement 9.4). We are not emitting it because (a) the response body carries the revision via `_meta` on modern and `protocolVersion` on legacy, and (b) adding an unused response-header surface is a maintenance tax with no observed benefit.

### 11. CORS allow-list — `template.yml` change

One edit at `application-infrastructure/template.yml:664`:

```yaml
# Before:
AllowHeaders: "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"

# After:
AllowHeaders: "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,MCP-Protocol-Version,Mcp-Method,Mcp-Name'"
```

`AllowMethods`, `AllowOrigin`, and `MaxAge` are untouched. The Lambda integration type (`AWS::Serverless::Function` with implicit API event) is already proxy-mode, so the new headers reach the handler through `event.headers` (and `clientRequest.getProps().headers`) with no further wiring. A deployment-time check: a Phase 4 test issues a request with `MCP-Protocol-Version: 2026-07-28` against the deployed stack and asserts that the response is `-32022`-free (confirming the header reached the handler) rather than `-32022` due to a missing-header-therefore-missing-version miscount.

**Deploy sequencing** (Requirement 10.4). The CORS change ships in the Phase 2 commit, which is backward compatible on its own (the extra headers are allowed but no code reads them yet). Phase 4 — the code that depends on the headers — is a later deploy. There is no reorder failure mode because Phase 2 lands first.

### 12. Legacy revision selection — advertise both, prefer `2025-11-25`

Per the resolved open question #1 and the user's "both" preference: `supportedVersions` carries `['2024-11-05', '2025-11-25', '2026-07-28']` from Phase 4 onward.

**Requirement 11.2 audit — fields between `2024-11-05` and `2025-11-25`:**

| Field | 2024-11-05 | 2025-11-25 | Server state today | Action |
|---|---|---|---|---|
| `InitializeResult.protocolVersion` | required | required | emitted | none |
| `InitializeResult.capabilities` | required | required | emitted | none |
| `InitializeResult.serverInfo` | required | required | emitted (version to be corrected per Requirement 2) | none beyond Requirement 2 |
| `InitializeResult.instructions` | optional | optional | emitted (new in Phase 1) | none |
| `Tool.name` | required | required | emitted | none |
| `Tool.description` | required | required | emitted | none |
| `Tool.inputSchema` | required | required | emitted | none |
| `Tool.title` | n/a | optional | not emitted on 2024-11-05, emitted on 2025-11-25+ via `tool-catalog.js` allowlist | add `2025-11-25` to allowlist (Phase 3) |
| `Tool.annotations` | n/a | optional | same as `title` | same |
| `Tool.outputSchema` | n/a | optional | not emitted; no tool defines one today | explicitly out of scope — companion discovery spec will add it if needed |
| `CallToolResult.content` | required | required | emitted | none |
| `CallToolResult.structuredContent` | n/a | optional | not emitted | explicitly out of scope |
| `CallToolResult.isError` | n/a | optional | not emitted; errors use JSON-RPC `error` | consistent with both revisions — do not emit |

The audit yields no mandatory new emission on the legacy branch beyond what Phase 1 and the `tool-catalog.js` allowlist change already produce. Adding `2025-11-25` to `supportedVersions` in Phase 3 is therefore a clean, test-gated step.

### 13. Modern revision gating

`2026-07-28` is added to `SUPPORTED_PROTOCOL_VERSIONS` **only in the same PR** that:

- Implements `discoverResult()` and the `server/discover` route (Requirement 5).
- Branches `tools/list` into the `CacheableResult` envelope (Requirement 7.3).
- Emits `resultType: 'complete'` on every modern result (Requirement 7.1).
- Emits `_meta['io.modelcontextprotocol/serverInfo']` on modern results (Requirement 7.5).
- Validates `Mcp-Method` / `Mcp-Name` on the modern branch (Requirement 8).
- Defines and emits `HEADER_MISMATCH` and `UNSUPPORTED_PROTOCOL_VERSION` (Requirement 6).

The Requirement 12.3 build state (`server/discover` live but required-fields gating not met) is handled by `discoverResult()` reading `SUPPORTED_PROTOCOL_VERSIONS` dynamically. If the array is `['2024-11-05', '2025-11-25']` at the time a `server/discover` lands, the response correctly reports those two and omits `2026-07-28`, keeping clients honest.

### 14. `server/discover` method

The method is dispatched like every other method — a case in the switch, not a special path. Props flow:

1. Router receives `{ jsonrpc: '2.0', method: 'server/discover', id: X, params?: ... }`. Params are not required and are ignored if present.
2. Era resolver returns `'modern'` unconditionally for this method (Requirement 5.3).
3. No header validation is required for this method (modern spec allows headerless probes).
4. `discoverResult(id)` returns the envelope defined in §7.

Auth posture (Requirement 5.5): the method is callable at the `public` tier. The `handleJsonRpc` router already runs after `AuthResolver` and `RateLimiter` in `index.js`, so `server/discover` participates in rate limiting (sensible — a public endpoint should still be rate-limited) but does not require an API key. No change to `AuthResolver` is needed.

### 15. Backward compatibility on the legacy wire

The following guarantees are structurally enforced:

| Guarantee | Enforcement |
|---|---|
| Legacy `initialize` carries every field it carried before | `initializeResult()` emits `protocolVersion`, `capabilities`, `serverInfo` (unchanged keys); adds `instructions`; `serverInfo.version` corrected to the real release version. No field removed. Unit test asserts the exact set of result keys. |
| No new required HTTP header for legacy requests | `validateHeadersForModern()` is only called when `era === 'modern'`. Legacy requests cannot be rejected for lacking `Mcp-Method` or `Mcp-Name`. |
| No new required body field for legacy requests | `resolveEra()` returns `'legacy'` for an `initialize` request regardless of `_meta`; `_meta` is read but not required. |
| No field removed from legacy responses | Legacy formatters do not strip existing keys. |
| Cache keys do not cross eras | Not a concern in this release: `tools/list` is not cached by the Lambda itself (the `ttlMs` is purely an advisory for the client), and `tools/call` cache keys are built from tool-specific input, not from the era. A test asserts that `handleToolsCall` does not reference `era` in any cache-key construction. |

Requirement 16.5 is satisfied by observation rather than by code — nothing in the Lambda caches `tools/list` or any other method-level response.

## Data Models

The only new on-wire shapes are three result envelopes. Each is defined inline in §7. For reference:

### `DiscoverResult` (modern, `server/discover`)

```typescript
interface DiscoverResult {
  supportedVersions: string[];        // e.g. ['2024-11-05', '2025-11-25', '2026-07-28']
  capabilities: { tools: { listChanged: boolean } };
  instructions: string;
  ttlMs: number;
  cacheScope: 'public' | 'private';
  resultType: 'complete';
  _meta: {
    'io.modelcontextprotocol/serverInfo': { name: string, version: string }
  };
}
```

### `InitializeResult` (legacy, `initialize`) — unchanged shape

```typescript
interface InitializeResult {
  protocolVersion: string;            // echoes negotiated revision
  capabilities: { tools: { listChanged: boolean } };
  serverInfo: { name: string, version: string };
  instructions: string;               // new in Phase 1
}
```

### `CacheableResult` (modern, `tools/list`)

```typescript
interface CacheableToolsList {
  tools: Array<Tool>;
  ttlMs: number;                      // 600000 — 10 minutes
  cacheScope: 'public' | 'private';   // this server emits 'public'
  resultType: 'complete';
  _meta: {
    'io.modelcontextprotocol/serverInfo': { name: string, version: string }
  };
}
```

Legacy `tools/list` keeps its current shape: `{ tools: Array<Tool> }` with no additional keys.

## Error Handling

### Error-code allocation (summary)

| Code | Name | When raised | Where |
|---|---|---|---|
| -32700 | PARSE_ERROR | Body is not valid JSON | existing, unchanged |
| -32600 | INVALID_REQUEST | Missing `jsonrpc` or `method` | existing, unchanged |
| -32601 | METHOD_NOT_FOUND | Unknown method; unknown `tools/call` tool name | existing, unchanged |
| -32602 | INVALID_PARAMS | Missing `params.name` on `tools/call` | existing, unchanged |
| -32603 | INTERNAL_ERROR | Catch-all unhandled error | existing, unchanged |
| **-32020** | **HEADER_MISMATCH** | `Mcp-Method` or `Mcp-Name` disagrees with body on a modern request | **new** |
| **-32022** | **UNSUPPORTED_PROTOCOL_VERSION** | Declared revision is not in `supportedVersions` | **new** |

### What the error responses look like

```json
// -32020 example (modern request, Mcp-Method header disagrees):
{
  "jsonrpc": "2.0",
  "id": "req-7",
  "error": {
    "code": -32020,
    "message": "Header mismatch",
    "data": {
      "detail": "Mcp-Method header disagrees with body method",
      "headerValue": "tools/list",
      "bodyValue": "tools/call"
    }
  }
}

// -32022 example (any era, unknown revision declared):
{
  "jsonrpc": "2.0",
  "id": "req-7",
  "error": {
    "code": -32022,
    "message": "Unsupported protocol version",
    "data": {
      "declaredRevision": "2099-01-01",
      "supportedVersions": ["2024-11-05", "2025-11-25", "2026-07-28"]
    }
  }
}
```

Both error responses carry a `200 OK` HTTP status (the existing convention — JSON-RPC errors are not HTTP errors), consistent with every other error path in the router.

### Error-condition migration (Requirement 6.4)

Audit of today's `INTERNAL_ERROR` sites in `json-rpc-router.js`:

- The catch-all at the bottom of `handleJsonRpc` keeps `INTERNAL_ERROR`. Legitimate unexpected errors.
- The controller-level error-translation inside `handleToolsCall` keeps `INTERNAL_ERROR`. Tool execution failures.

Neither path is reclassified by this spec. The new error codes are raised at explicit new sites (header validation, version negotiation) rather than refined from existing `INTERNAL_ERROR` returns. Requirement 6.4's "no new condition reported under a generic error" is satisfied vacuously — the two new conditions have their own codes from day one.

## Testing Strategy

All tests use the existing Jest layout. Per the test-execution-monitoring rules, no new test will shell out to `npm test` or spawn arbitrary child processes.

### New unit tests

Add under `tests/unit/utils/`:

| File | Covers |
|---|---|
| `mcp-era.test.js` | `resolveEra()` for every (method, header-version, body-version) combination from the Requirement 4 decision table; `pickHeader()` case-insensitivity; `validateHeadersForModern()` success and both failure modes. |
| `mcp-protocol-discover.test.js` | `discoverResult()` returns the exact expected shape; `supportedVersions`, `capabilities`, and `instructions` match what `getCapabilities()` returns and what `initializeResult()` emits (Requirement 5.4, 15.4). |
| `mcp-protocol-initialize.test.js` | Updated version of the existing `mcp-protocol-jsonrpc.test.js initializeResponse` block — asserts legacy shape unchanged (no `resultType`, no `_meta`), `instructions` present, `serverInfo.version` matches `getReleaseVersion()`. |
| `mcp-protocol-tools-list-era.test.js` | For `era === 'legacy'` the result has keys `['tools']`; for `era === 'modern'` the result has keys `['tools', 'ttlMs', 'cacheScope', 'resultType', '_meta']` and `resultType === 'complete'` (Requirement 7). |
| `mcp-protocol-source-of-truth.test.js` | Grep-based test — fails if any file under `src/lambda/read-function/` **except** `utils/mcp-protocol.js` and `tests/` contains a hardcoded `/\b202\d-\d\d-\d\d\b/` protocol-revision string (Requirement 3.3, 15.2). |
| `tool-catalog-revisions.test.js` | For `protocolVersion: '2024-11-05'`, no tool definition carries `title` or `annotations`; for `'2025-11-25'` and `'2026-07-28'`, every tool with a registry entry carries both (Requirement 13). |
| `release-version.test.js` | Confirms `getReleaseVersion()` returns the generated module's value when present and falls back to `package.json` with the INFO log event when absent. |

### New integration tests

Add under `tests/integration/`:

| File | Covers |
|---|---|
| `mcp-protocol-dual-era.test.js` | End-to-end: a legacy `initialize` request through the router returns a legacy envelope with `instructions`; a `server/discover` request returns a modern envelope; the `instructions` string is byte-identical in both (Requirement 1, 15.3, 15.4). |
| `mcp-protocol-unsupported-version.test.js` | A request with `_meta.protocolVersion: '2099-01-01'` returns `-32022` with `supportedVersions` in `data` (Requirement 15.5). |
| `mcp-protocol-modern-required-fields.test.js` | A modern `tools/list` carries `ttlMs`, `cacheScope`, `resultType`, and `_meta`; a legacy `tools/list` carries none of them (Requirement 15.6, 15.7). |
| `mcp-protocol-header-validation.test.js` | A modern request with `Mcp-Method` disagreeing with the body returns `-32020`; a legacy request without `Mcp-Method` is accepted (Requirement 15.8). |
| `mcp-protocol-discover-no-auth.test.js` | `server/discover` is answerable at the public tier (Requirement 15.9). |

### Existing-test updates

| Test | Change |
|---|---|
| `mcp-protocol.test.js` describing old `getCapabilities()` and `negotiateProtocol()` shapes | Rewritten to assert the new structured return shapes. |
| `tools-mcp-protocol.property.test.js` | The property `getCapabilities().tools === settings.tools.availableToolsList` is replaced with `MCP_TOOLS === settings.tools.availableToolsList`, which captures the actual reference-identity contract and does not depend on the retired capability shape. |
| `mcp-protocol-jsonrpc.test.js initializeResponse` block | Updated: result keys stay `['protocolVersion', 'capabilities', 'serverInfo', 'instructions']` but `serverInfo.version` assertion is relaxed to "equals `getReleaseVersion()`" rather than a literal. |
| `json-rpc-router.test.js` CORS header assertions | Replaced with the Requirement 9.5 assertions: `Access-Control-Allow-Methods` and `-Headers` are absent from the Lambda-constructed response; `Access-Control-Allow-Origin: *` is present. |

### Hand-verification against clients (Requirement 15.12)

Per the resolved open question #3: only Kiro is live-tested. The design records:

- **Kiro**: tested against the deployed `beta` stage with a logged request/response trace. Required outcome: Kiro's `initialize` succeeds; its `tools/list` returns the full tool catalog; a representative tool call (`list_templates`) returns a usable result.
- **Claude Code**: not available to this project; the design cross-references the Anthropic `2026-07-28` announcement and relies on the integration tests to confirm the modern envelope matches the published client expectation.
- **ChatGPT**: not available; cross-reference the OpenAI MCP client docs and rely on integration tests.
- **Cursor**: not available; cross-reference the Cursor forum thread cited in PLAN section 1 and rely on the legacy `initialize` integration test to prove the legacy wire is intact (which is the specific failure mode that thread reports against modern-only servers).

Admin-ops documentation records this coverage gap explicitly.

## Phase sequencing and risks

PLAN section 7's phases are preserved. Mapping phases to requirements:

| Phase | Delivers | Advertised `supportedVersions` at end of phase |
|---|---|---|
| 1 | Requirement 1 (instructions on legacy), Requirement 2 (release-version module), Requirement 9 (strip-list cleanup) | `['2024-11-05']` |
| 2 | Requirement 3 (shared capability source; shared negotiation source), Requirement 10 (CORS allow-list) | `['2024-11-05']` |
| 3 | Requirement 4 (era discriminator), Requirement 5 (`server/discover`), Requirement 6 partial (`-32022` only), Requirement 11 (add `2025-11-25` after audit) | `['2024-11-05', '2025-11-25']` |
| 4 | Requirement 6 complete (`-32020`), Requirement 7 (modern-required fields), Requirement 8 (header validation), Requirement 12 (add `2026-07-28`) | `['2024-11-05', '2025-11-25', '2026-07-28']` |
| 5 | Requirement 13 (`Tool.title` / `Tool.annotations` wire — populate `tool-catalog.js` allowlist with modern revision only, if the discovery spec needs it staggered) | unchanged |

**Risk — phase-boundary half-states.** Between Phase 3 and Phase 4, `server/discover` is live but `2026-07-28` is not yet in `supportedVersions`. A modern client calling `server/discover` during this window receives a modern-shaped response advertising only legacy revisions. Per Requirement 12.3, this is the intended behavior: a modern client learns at discovery time that it must downgrade. Acceptable.

**Risk — the "all four clients" success criterion in PLAN section 8.** Resolved by narrowing to Kiro + docs for the other three. Admin-ops documentation names this limitation.

## Documentation plan (Requirement 14)

| Document | Content |
|---|---|
| `ARCHITECTURE.md` | New section "MCP protocol dual-era support" covering: the era discriminator (reproduce the decision table from Requirement 4), the shared capability and negotiation sources, the per-request path, and the fact that era is a per-request decision with no session state. |
| `docs/developer/` | New page `mcp-protocol-sources.md` naming the three single-source-of-truth files: `config/release-version.js`, `config/server-instructions.js`, and `utils/mcp-protocol.js`'s `SUPPORTED_PROTOCOL_VERSIONS` / `SERVER_NAME`. Direct contributors to edit those files, never a call site. |
| `docs/admin-ops/` | New page `cors-and-response-headers.md` covering: the CORS allow-list change in `template.yml` and that preflight is answered by API Gateway; the finding from Requirement 9 (which headers are `finalize()`-managed, which are API-Gateway-owned, which require explicit `response.addHeader()`); the recorded Origin-validation decision (`AllowOrigin: '*'` kept — public read-only server with no credentials, no browser-side state to steal, no PII returned). |
| `docs/end-user/` | New page `supported-protocol-revisions.md` naming all three revisions and the dual-era posture, so a client developer can match capabilities without reading source. |
| `CHANGELOG.md` v0.0.7 unreleased | New entry under the existing v0.0.7 header (added below in the "Changes to version-tracked artifacts" section). Record: `server/discover` added, `-32020` and `-32022` added, modern-required fields on `tools/list`, legacy `instructions` added, server version corrected. |
| Recorded decision — legacy revision selection | Documented in `docs/developer/mcp-protocol-sources.md`: both `2024-11-05` and `2025-11-25` advertised; a legacy client capable of `2025-11-25` naturally negotiates to it. Rationale: no cost to advertise both once the audit is done; keeps the pinned-to-2024-11-05 clients working. |
| Recorded decision — Origin validation posture | Documented in `docs/admin-ops/cors-and-response-headers.md`: `AllowOrigin: '*'` kept. Rationale: public read-only server; no cookies, no credentials, no browser-side state that cross-origin reads could expose; no PII in any response. |
| Recorded limitation — `Mcp-Param-*` / `x-mcp-header` | Explicitly out of scope; one line in `docs/end-user/supported-protocol-revisions.md`. |
| Recorded limitation — hand-verification coverage | Only Kiro live-tested; documented in `docs/admin-ops/cors-and-response-headers.md` with cross-references to the public docs for the other three clients. |

## Changes to version-tracked artifacts

### `CHANGELOG.md`

Append under the existing `## [v0.0.7] (unreleased)` → `### Added` section:

```markdown
- **MCP Protocol Dual-Era Support** [Spec: 0-0-7-mcp-protocol-dual-era](../.kiro/specs/0-0-7-mcp-protocol-dual-era/) — Serves both the legacy handshake-based MCP revisions (`2024-11-05`, `2025-11-25`) and the modern stateless revision (`2026-07-28`) from the same `POST /mcp/v1` endpoint, with real per-request version negotiation
  - New `server/discover` JSON-RPC method returning `supportedVersions`, `capabilities`, and `instructions` for modern clients that no longer send `initialize`
  - New error codes `-32020 HeaderMismatch` and `-32022 UnsupportedProtocolVersion` with `supportedVersions` enumerated in the error data; existing `-32700`/`-32600`/`-32601`/`-32602`/`-32603` codes unchanged
  - Modern-era `tools/list` returns a `CacheableResult` envelope carrying `ttlMs` and `cacheScope: 'public'`; legacy `tools/list` is unchanged
  - Modern-era results carry `resultType: 'complete'` and server identity under result-level `_meta.io.modelcontextprotocol/serverInfo`; legacy results carry neither
  - Modern-era requests are validated against `Mcp-Method` and `Mcp-Name` HTTP headers when present; legacy requests are not required to send them
  - Server-level `instructions` string now served on both `InitializeResult` (legacy) and `DiscoverResult` (modern), composed by `config/server-instructions.js` (shared by Requirement 1 of the tool-discovery-enhancement spec)
  - Server version in `serverInfo.version` is now the actual deployed release version (read from a new `config/release-version.js` generated at build time from the repo-root `CHANGELOG.md`), replacing the previous hardcoded value
  - CORS allow-list extended by `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` so modern browser-hosted clients pass the API Gateway preflight
  - `routes/index.js` strip list reconciled with cache-data's `Response.finalize()` behavior: `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` removed from `STANDARD_HEADERS` (API Gateway owns them); `Content-Type` and `Access-Control-Allow-Origin` remain documented as `finalize()`-managed
```

### Build scripts

- `application-infrastructure/build-scripts/write_release_version.py` (new) — reads repo-root `CHANGELOG.md`, writes `config/release-version.js` into each `src/lambda/*/config/`.
- `application-infrastructure/buildspec.yml` — call `write_release_version.py` once in `pre_build` before the per-function loop (so the generated file is present when each function's tests run).

### Lambda source files touched

Grouped by module to keep PR review tractable. Phase assignment in parentheses.

- `src/lambda/read-function/config/release-version.js` — generated (Phase 1).
- `src/lambda/read-function/utils/mcp-protocol.js` — reworked (Phases 1, 3, 4).
- `src/lambda/read-function/utils/mcp-era.js` — new (Phase 3).
- `src/lambda/read-function/utils/json-rpc-router.js` — era wiring, strip-list change, new case for `server/discover` (Phases 1, 3, 4).
- `src/lambda/read-function/utils/tool-catalog.js` — populate `REVISIONS_SUPPORTING_TITLE_ANNOTATIONS` (Phase 3, Phase 4).
- `src/lambda/read-function/routes/index.js` — strip-list change (Phase 1).
- `src/lambda/read-function/tests/` — new and updated per §Testing Strategy.
- `application-infrastructure/template.yml` — CORS allow-list extension at L664 (Phase 2).

No controllers, services, or models are touched. No change to `index.js` handler, `AuthResolver`, or `RateLimiter`.

## Recorded decisions (open-question resolution)

| Open question (from requirements.md) | Resolution | Where recorded |
|---|---|---|
| Legacy revision selection | Advertise **both** `2024-11-05` and `2025-11-25`. Negotiation naturally picks the highest supported for an uplevel-capable legacy client; pinned-to-2024-11-05 clients continue to work. | `docs/developer/mcp-protocol-sources.md` |
| Origin validation posture | Keep `AllowOrigin: '*'` and `validations.js` `referrers: ['*']`. Rationale: public read-only server, no cookies, no credentials, no browser-side state that CSRF/DNS-rebinding could abuse, no PII in any response. | `docs/admin-ops/cors-and-response-headers.md` |
| Client verification matrix | Kiro live-tested against the deployed `beta` stage; Claude Code, ChatGPT, Cursor verified against their own published client docs plus the integration test suite covering the published spec envelopes. Documented as a known coverage gap. | `docs/admin-ops/cors-and-response-headers.md` |
