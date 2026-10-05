# MCP Protocol Dual-Era Support

Planning document for v0.0.7. Scope: serve both the legacy handshake-based MCP revisions (`2025-11-25` and earlier) and the modern stateless revision (`2026-07-28`) from the same endpoint, and deliver server-level `instructions` on both.

Split out of [`0-0-7-tool-discovery-enhancement`](../0-0-7-tool-discovery-enhancement/PLAN.md), which depends on this spec for `instructions` delivery (its WS1) and for the `Tool.title` / `Tool.annotations` fields (its WS2).

---

## 1. Why dual-era, and why not modern-only

The server currently advertises `protocolVersion: '2024-11-05'` with a hardcoded constant and no negotiation. The current specification revision is `2026-07-28`, which removed the `initialize` handshake entirely.

**Dual-era is required, not optional.** The target clients are Kiro, Claude Code, ChatGPT, and Cursor, and they are not all on the same era:

- Anthropic has publicly announced bringing the `2026-07-28` stateless revision to Claude ([claude.com](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude)), so modern-capable clients are in the field.
- Cursor users have reported being unable to connect to modern-only `2026-07-28` Streamable HTTP servers because the legacy `initialize` handshake is rejected ([Cursor forum](https://forum.cursor.com/t/mcp-client-cannot-connect-to-modern-only-2026-07-28-streamable-http-servers-legacy-initialize-rejected/172536/1)).

So modern-only would break at least one named client, and legacy-only forfeits the current revision and the `title`/`annotations`/`outputSchema` surface. The specification anticipates exactly this and names the pattern: [a dual-era server may serve both eras concurrently on the same endpoint or process](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning). Critically, a legacy client has **no fall-forward mechanism** — if the server speaks only modern, the client's only diagnostic is whatever error comes back from `initialize`.

**Terminology** (the specification's own): *legacy* = establishes a session via `initialize` (`2025-11-25` and earlier). *Modern* = conveys version, identity, and capabilities as per-request metadata (`2026-07-28` and later). *Dual-era* = supports both.

---

## 2. Why this server is unusually cheap to migrate

The headline of `2026-07-28` is removing protocol-level sessions, the `initialize`/`notifications/initialized` handshake, the `Mcp-Session-Id` header, the standalone HTTP GET/SSE stream, stream resumability, and server-initiated requests ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). That is a punishing migration for a stateful server.

This server is a Lambda behind API Gateway serving a single `POST /mcp/v1`. Every removed mechanism is already absent by construction:

| Removed or changed in 2026-07-28 | State in this server |
|---|---|
| Protocol-level sessions, `Mcp-Session-Id` | Never implemented |
| `initialize` / `notifications/initialized` handshake | Implemented, becomes the legacy branch |
| Standalone HTTP GET endpoint, SSE streams, resumability | Never implemented |
| Server-initiated requests (roots, sampling, elicitation) | Never implemented; `MCP_CAPABILITIES` declares `resources`, `prompts`, `sampling` all false |
| `ping`, `logging/setLevel`, `notifications/roots/list_changed` | Never implemented |
| Multi Round-Trip Requests / `input_required` | Not needed — every tool is read-only and single round trip |
| Tasks moved to an extension | Never implemented |

What remains is additive: a new method, some required result fields, header validation, and real version negotiation. The statelessness that costs most servers a rewrite costs this one nothing.

---

## 3. Work inventory

| # | Item | Location | Size |
|---|---|---|---|
| 1 | `server/discover` method returning `supportedVersions`, `capabilities`, `instructions` | `json-rpc-router.js` switch + `mcp-protocol.js` | S |
| 2 | Real version negotiation; read version from `_meta` / `MCP-Protocol-Version` | `json-rpc-router.js` | M |
| 3 | `UnsupportedProtocolVersionError` (-32022) listing supported versions | `mcp-protocol.js` `JSON_RPC_ERRORS` | S |
| 4 | `HeaderMismatchError` (-32020): validate `Mcp-Method`/`Mcp-Name` against the body | `json-rpc-router.js` | S |
| 5 | `resultType: 'complete'` on modern results | `mcp-protocol.js` formatters | S |
| 6 | `ttlMs` + `cacheScope` on `tools/list` (now a required `CacheableResult`) | `toolsListResponse` | S |
| 7 | Server identity in result `_meta` (`io.modelcontextprotocol/serverInfo`) | `mcp-protocol.js` formatters | S |
| 8 | `instructions` from a shared `config/server-instructions.js`, served on both `initialize` and `server/discover` | `mcp-protocol.js` + new config | S |
| 9 | Add modern headers to API Gateway CORS allow-list | `template.yml` | S |
| 10 | Fix `serverInfo.version` (hardcoded `'0.0.1'`) | `mcp-protocol.js` | S |
| 11 | Wire up `getCapabilities()` / `negotiateProtocol()` as the shared source for both eras | `mcp-protocol.js` | S |
| 12 | Deterministic `tools/list` ordering | already stable | Free |
| 13 | `Tool.title` / `Tool.annotations` on modern responses | consumed by the discovery spec's WS2 | S |

Estimated at roughly 1.3x the cost of modern-only, and well under the cost of a genuine stateless migration.

---

## 4. Specific findings

### 4.1 CORS is a CloudFormation concern, not a code concern

`template.yml` (~L662-666) sets the allow-list at the API Gateway:

```yaml
Cors: # MCP server accepts POST requests from any origin
  AllowMethods: "'POST,OPTIONS'"
  AllowHeaders: "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
  AllowOrigin: "'*'"
```

Modern clients must send `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`; none are allowed today. Adding them is a one-line template change. Two things to confirm during design rather than assume:

1. That the Lambda integration is proxy-type so the headers actually reach the handler (`clientRequest.getProps()` reads headers, which suggests yes, but verify against `template-openapi-spec.yml`).
2. Whether `Mcp-Param-*` / `x-mcp-header` support is wanted. It is not needed for any current tool, and omitting it is the smaller surface.

### 4.2 The router's CORS constant is already dead code

`json-rpc-router.js` defines `STANDARD_HEADERS` including `Access-Control-Allow-Origin`, `-Methods`, and `-Headers`, but `routes/index.js` explicitly skips those three plus `content-type` when copying router headers onto the cache-data `Response`. And `@63klabs/cache-data` contains no `Access-Control` handling at all — verified by grep across the installed package. So those four entries in `STANDARD_HEADERS` are never emitted; CORS comes entirely from API Gateway.

This is harmless today but actively misleading for this work, because the obvious-looking place to add the new headers is the one place that has no effect. Remove the dead entries or comment them as API-Gateway-owned.

### 4.3 Error code allocation has no collision

`2026-07-28` reserves -32020 to -32099 for the specification and grandfathers existing implementation use of -32000 to -32019. Current `JSON_RPC_ERRORS` holds only `PARSE_ERROR: -32700`, `INVALID_REQUEST: -32600`, `METHOD_NOT_FOUND: -32601`, `INVALID_PARAMS: -32602`, `INTERNAL_ERROR: -32603`. The three new spec codes — `HeaderMismatch` -32020, `MissingRequiredClientCapability` -32021, `UnsupportedProtocolVersion` -32022 — drop in cleanly. No renumbering, no client-visible change to existing errors.

### 4.4 `getCapabilities()` and `negotiateProtocol()` stop being dead code

Both exist in `mcp-protocol.js`, are exercised only by tests, and are wired to no JSON-RPC method. Dual-era gives both a real purpose, which resolves the earlier question of whether to delete them:

- `server/discover` needs exactly what `getCapabilities()` assembles: capabilities, identity, and now `instructions`. Legacy `initialize` needs the same three. One function, two callers — which is precisely the reuse justification for keeping it.
- `negotiateProtocol()` becomes the backing for `supportedVersions` and for deciding whether to return `UnsupportedProtocolVersionError`.

Both need reworking rather than straight adoption: `getCapabilities()` currently returns a legacy-flavored envelope with `protocol: 'mcp'` and `vendor: '63Klabs'` that matches neither era's result shape, and `negotiateProtocol()` returns a prose `message` rather than a structured error.

### 4.5 `instructions` has two carriers and one source

Legacy: `InitializeResult.instructions`. Modern: `DiscoverResult.instructions` on `server/discover`. Same string both ways, from `config/server-instructions.js`.

Worth honoring in the content: the modern schema's own guidance is that this field should carry what helps the model use the server effectively and should **not** duplicate information already present in tool descriptions. The discovery spec's WS1 reflects this by excluding a tool-routing table from `instructions`.

### 4.6 `resultType` must not leak into legacy responses

Modern requires `resultType` on every result, and specifies that clients receiving a result from an earlier-revision server must treat an absent field as `complete`. The clean implementation is to branch in the response formatters on the resolved era rather than always emitting it. Legacy clients would most likely tolerate the extra field, but "most likely tolerate" is not a contract, and the branch is cheap.

### 4.7 Origin validation

The modern transport binding requires servers to validate the `Origin` header to prevent DNS rebinding, responding 403 when present and invalid. Current configuration is `AllowOrigin: '*'`, and `validations.js` sets `referrers: ['*']`. Worth a deliberate decision during design: this is a public read-only server, so permissive origin is defensible, but it should be a recorded choice rather than a default.

---

## 5. Era discrimination

The specification states the era is a property of the server, not the request, and that a dual-era server selects behavior from how the client opens. For this server:

- `method === 'initialize'` → legacy branch, respond with `InitializeResult` at a legacy revision the server supports.
- Request carries `_meta['io.modelcontextprotocol/protocolVersion']` (or the `MCP-Protocol-Version` header) naming a supported modern revision → modern branch, stateless.
- Modern-shaped request naming an unsupported version → `UnsupportedProtocolVersionError` listing `supportedVersions`.
- `method === 'server/discover'` → always answerable; it is the modern probe and must be implemented.

Because the server holds no session state in either branch, "selecting an era" is purely per-request response shaping. There is no session to scope the decision to, which removes the main source of dual-era bugs in stateful servers.

---

## 6. Risks and constraints

| Risk | Mitigation |
|---|---|
| Version constants drift across `initializeResponse`, `getCapabilities`, and `server/discover` | Single source of truth for supported versions and identity; assert consistency in a test |
| Advertising a revision the server does not fully implement | Only list a version in `supportedVersions` once its required fields (`resultType`, `CacheableResult`, header validation) are all implemented. Partial support is worse than no support, since a legacy client cannot fall forward |
| `resultType` / `_meta` additions touch every response path | Centralize in the `mcp-protocol.js` formatters; no controller should construct an envelope directly |
| Header validation rejects well-behaved legacy clients | Validate `Mcp-Method`/`Mcp-Name` only on the modern branch. Legacy clients do not send them and must not be required to |
| CORS change is in CloudFormation, so it ships on a deploy rather than a code path | Sequence the template change before or with the code that needs it; it is backward compatible on its own |
| Existing tests assert the exact `initialize` response shape and `MCP_TOOLS` reference identity | Expect to update `tests/unit/utils/` specs deliberately; treat changes there as part of the work, not incidental breakage |
| Spec revisions keep moving | Negotiation, once real, makes adding a revision a config change rather than a rewrite. That is the durable win here |

---

## 7. Sequencing

| Phase | Contents |
|---|---|
| 1 | Shared `config/server-instructions.js`; `instructions` on legacy `initialize`; fix `serverInfo.version`; remove or annotate the dead CORS constant. **Ships the discovery spec's WS1 on the current wire format with no protocol change.** |
| 2 | Rework `getCapabilities()` / `negotiateProtocol()` into a single source for capabilities, identity, and supported versions. Add `template.yml` CORS headers. |
| 3 | `server/discover`, per-request version resolution, `UnsupportedProtocolVersionError`, era branch in the formatters. |
| 4 | Modern-only required fields: `resultType`, `ttlMs`/`cacheScope` on `tools/list`, `_meta` server identity, `Mcp-Method`/`Mcp-Name` validation. Add `2026-07-28` to `supportedVersions` only once this phase is complete. |
| 5 | `Tool.title` / `Tool.annotations` on modern responses — hands off to the discovery spec's WS2. |

Phase 1 is independently valuable and unblocks the discovery work immediately. Phases 3-4 must ship together before `2026-07-28` is advertised.

---

## 8. Success criteria

1. A legacy client sending `initialize` receives a valid `InitializeResult` with a non-empty `instructions` string.
2. A modern client calling `server/discover` receives `supportedVersions`, `capabilities`, and the same `instructions` string.
3. A request naming an unsupported version receives `UnsupportedProtocolVersionError` (-32022) enumerating supported versions, not a generic internal error.
4. Every modern result carries `resultType: 'complete'`; no legacy result carries it.
5. `tools/list` on the modern branch carries `ttlMs` and `cacheScope`.
6. A modern request whose `Mcp-Method` header disagrees with the body method is rejected with -32020.
7. `supportedVersions` contains only revisions whose required fields are fully implemented.
8. Kiro, Claude Code, ChatGPT, and Cursor each connect successfully and list tools — verified by hand, since no amount of unit testing substitutes for a real client handshake.
9. Supported-version and identity constants have exactly one definition, asserted by a test.

---

## 9. Open questions

1. **Which legacy revision to advertise.** Currently `2024-11-05`. Moving the legacy branch to `2025-11-25` (the last handshake revision) gains `title` and `annotations` for legacy clients too, but requires auditing what else changed between those revisions. Stay on `2024-11-05`, or move up?
2. **`Mcp-Param-*` / `x-mcp-header` support** — skip entirely for now? No current tool needs it.
3. **Origin validation posture** — keep `AllowOrigin: '*'` as a recorded decision for a public read-only server, or tighten?
4. **Client verification matrix** — can you provide access to all four target clients for criterion 8, or should the spec scope hand-verification to a subset?

---

## Related documentation

- [Tool discovery enhancement](../0-0-7-tool-discovery-enhancement/PLAN.md) — depends on this spec
- [MCP specification — versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [MCP specification — 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP specification — tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [SEP-2575: stateless MCP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2575-stateless-mcp.md)
- [SEP-2243: HTTP header standardization](https://modelcontextprotocol.io/seps/2243-http-standardization)

> Content from the MCP specification and linked announcements was rephrased for compliance with licensing restrictions.
