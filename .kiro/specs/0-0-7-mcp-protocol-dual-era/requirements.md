# Requirements Document

## Introduction

**MCP Protocol Dual-Era Support.** This feature makes the Atlantis MCP Server speak both the legacy handshake-based MCP revisions (`2025-11-25` and earlier) and the modern stateless revision (`2026-07-28`) from the same endpoint, with real per-request version negotiation and shared server-level `instructions` on both. See [PLAN.md](PLAN.md) for the full analysis, including the inventory in section 3 and the sequencing in section 7.

Dual-era is required rather than optional. The target clients — Kiro, Claude Code, ChatGPT, and Cursor — are not all on the same revision: modern-capable clients are in the field (Anthropic has brought `2026-07-28` to Claude), and at the same time Cursor has been reported to fail against modern-only `2026-07-28` servers because its legacy `initialize` is rejected. A legacy client has no fall-forward mechanism, so a server that speaks only modern is unreachable from a legacy client without any usable error signal. The MCP specification names the dual-era pattern directly and endorses serving both eras from one endpoint.

This spec also unblocks the companion spec [`0-0-7-tool-discovery-enhancement`](../0-0-7-tool-discovery-enhancement/PLAN.md), which depends on this one for `instructions` delivery (its WS1) and for the `Tool.title` / `Tool.annotations` wire fields (its WS2). The *content* of `instructions` and the Tool Metadata Registry remain owned by the discovery spec; this spec owns the *carriers*, the *negotiation*, and the *response envelope*.

### Guiding constraints

1. **No new session state.** The server is a Lambda behind API Gateway serving a single `POST /mcp/v1`. Every mechanism `2026-07-28` removed — session IDs, SSE streams, resumability, server-initiated requests — is already absent by construction, and this work SHALL NOT reintroduce any of them.
2. **Backward compatibility on the legacy wire.** A legacy client that worked before this release SHALL continue to work after it, with no new required headers, no new required request fields, and no removed response fields.
3. **Partial implementation is worse than no implementation.** A revision SHALL NOT appear in `supportedVersions` until every modern-required field (`resultType`, `CacheableResult`, header validation, `_meta` identity) is implemented, because a legacy client cannot fall forward from a half-implemented advertisement.
4. **Single source of truth.** Supported versions, server identity, capabilities, and `instructions` SHALL each have exactly one definition in the codebase, with every protocol surface reading from that definition.
5. **Era is a per-request concern.** Because the server holds no session state, selecting an era SHALL be purely a response-shaping decision made from the current request's method and metadata, not from any accumulated state.
6. **Dependency on companion spec.** The *content* of the `instructions` string and the *registry* for `Tool.title` / `Tool.annotations` are owned by [`0-0-7-tool-discovery-enhancement`](../0-0-7-tool-discovery-enhancement). This spec owns delivery, negotiation, and envelope shaping only.

### Decisions carried forward from PLAN.md

| # | Decision |
|---|---|
| 1 | Dual-era is required, not optional — modern-only breaks named clients, legacy-only forfeits the current revision |
| 2 | `getCapabilities()` and `negotiateProtocol()` are wired up as the shared source for both eras rather than deleted |
| 3 | `instructions` has two carriers (`InitializeResult.instructions` legacy, `DiscoverResult.instructions` modern) and one source module |
| 4 | `resultType` is branched by resolved era — emitted on modern, omitted on legacy — rather than always emitted |
| 5 | `Mcp-Method` / `Mcp-Name` header validation applies only on the modern branch; legacy clients MUST NOT be required to send them |
| 6 | The browser's CORS preflight is answered by API Gateway, not the Lambda, so the `AllowHeaders` list for modern request headers lives in `template.yml`. Lambda `response.addHeader()` remains the correct path for any server-set response header, and `Response.finalize()` respects application-set headers except `Access-Control-Allow-Origin`, which it overwrites unconditionally |
| 7 | `Mcp-Param-*` / `x-mcp-header` support is not in scope — no current tool needs it |
| 8 | Error codes -32020 (`HeaderMismatch`), -32021 (`MissingRequiredClientCapability`), -32022 (`UnsupportedProtocolVersion`) drop cleanly into `JSON_RPC_ERRORS` with no renumbering of existing codes |

## Glossary

- **System**: The MCP Protocol Dual-Era Support feature as a whole — the json-rpc router, the mcp-protocol module, the server-instructions config, the CloudFormation API Gateway configuration, and the tests that assert their consistency.
- **Read Function**: The `read-function` Lambda that serves the MCP protocol surface and all tool calls.
- **Era**: One of two families of MCP protocol revisions distinguished by how the client opens contact. See *legacy era* and *modern era*.
- **Legacy era**: Revisions `2025-11-25` and earlier. A client establishes contact via an `initialize` request; version and capabilities are negotiated once at the start of a session.
- **Modern era**: Revisions `2026-07-28` and later. The `initialize` handshake is removed; a client conveys version, identity, and capabilities as per-request metadata on every request.
- **Dual-era**: A server that supports both the legacy and modern eras concurrently on the same endpoint, selecting response shape per-request.
- **Era discriminator**: The per-request logic that decides, from the inbound method and metadata, whether to shape the response as legacy or modern.
- **Protocol revision**: A dated identifier such as `2024-11-05`, `2025-11-25`, or `2026-07-28` that names a specific version of the MCP specification.
- **Supported versions**: The set of protocol revisions this server advertises as fully implemented. A revision is *fully implemented* when every field the specification requires at that revision is produced and every field the specification requires from the client is validated.
- **Legacy branch**: The code path that shapes a response for a legacy-era client.
- **Modern branch**: The code path that shapes a response for a modern-era client.
- **Modern-required field**: A response or envelope field whose presence the modern specification mandates — currently `resultType`, `ttlMs` and `cacheScope` on `tools/list`, and server-identity `_meta`.
- **`instructions` string**: The server-level guidance string that both `InitializeResult` (legacy) and `DiscoverResult` (modern) carry.
- **Server identity**: The `name` and `version` the server reports — in legacy `InitializeResult.serverInfo`, in modern result-level `_meta` under `io.modelcontextprotocol/serverInfo`.
- **`server/discover`**: The modern-era method a client calls in lieu of `initialize` to retrieve `supportedVersions`, `capabilities`, and `instructions`.
- **Protocol-version metadata**: The modern mechanism by which a client declares the revision it is speaking — the request `_meta['io.modelcontextprotocol/protocolVersion']` field or the `MCP-Protocol-Version` HTTP header.
- **Header mismatch**: A request state in which an `Mcp-Method` or `Mcp-Name` HTTP header disagrees with the JSON-RPC body — rejected with error code -32020.
- **Unsupported protocol version**: A request state in which the client's declared protocol-version metadata names a revision not in the server's `supportedVersions` — rejected with error code -32022.
- **`CacheableResult`**: The modern `tools/list` result envelope that carries, in addition to the tool array, the `ttlMs` and `cacheScope` cache-shape hints the specification makes required at `2026-07-28`.
- **Shared capability source**: The single function (reworked from the existing `getCapabilities()`) that assembles capabilities, identity, and `instructions` for whichever carrier needs them.
- **Shared negotiation source**: The single function (reworked from the existing `negotiateProtocol()`) that decides whether a declared revision is supported and, if not, drives the `UnsupportedProtocolVersionError` response.
- **Formatter**: A function in `mcp-protocol.js` that produces a response envelope for one method, into which era-branching logic is centralized.

## Requirements

### Requirement 1: Shared `instructions` source

**User Story:** As a maintainer, I want the `instructions` string to live in one module and be served by every protocol surface that needs it, so that the string cannot drift between legacy and modern responses.

#### Acceptance Criteria

1. THE Read Function SHALL define the `instructions` string in exactly one module — a shared `config/server-instructions.js` — and both the legacy `InitializeResult.instructions` carrier and the modern `DiscoverResult.instructions` carrier SHALL read from that module.
2. WHEN the `instructions` module is edited as the only source change THEN both carriers SHALL serve the updated string, with no further edit to any router, controller, or formatter.
3. THE *content* of the `instructions` string SHALL be authored by the companion spec [`0-0-7-tool-discovery-enhancement`](../0-0-7-tool-discovery-enhancement) under its Requirement 1, and this spec SHALL NOT duplicate or constrain that content beyond requiring it to be a non-empty string.
4. THE Read Function SHALL be able to deliver a non-empty `instructions` string on the legacy `initialize` branch before `server/discover` is implemented, so that Phase 1 of the plan is independently valuable.

### Requirement 2: Accurate server identity

**User Story:** As an operator diagnosing a client incompatibility, I want the server version reported by the server to match the deployed version, so that I can correlate client logs with releases without decoding build metadata by hand.

#### Acceptance Criteria

1. THE Read Function SHALL report a server version that is the actual version of the deployed release, and SHALL NOT report a hardcoded placeholder such as `0.0.1`.
2. THE server identity (name and version) SHALL have exactly one definition in the codebase, and every protocol surface that reports identity SHALL read from that definition.
3. WHERE the resolved era is legacy, THE Read Function SHALL report server identity in `InitializeResult.serverInfo`.
4. WHERE the resolved era is modern, THE Read Function SHALL report server identity in the result-level `_meta` object under the key `io.modelcontextprotocol/serverInfo`.
5. THE identity reported on the legacy branch and the identity reported on the modern branch SHALL be derived from the same definition, so that they cannot diverge.

### Requirement 3: Shared capability and negotiation source

**User Story:** As a maintainer, I want capabilities, identity, supported versions, and `instructions` assembled by one function used by every carrier, so that adding a protocol surface or a revision is a config change rather than a parallel rewrite.

#### Acceptance Criteria

1. THE Read Function SHALL expose a shared capability source that returns capabilities, server identity, supported versions, and `instructions`, and both the legacy `initialize` formatter and the modern `server/discover` formatter SHALL obtain their payloads from this source.
2. THE Read Function SHALL expose a shared negotiation source that, given a declared protocol revision, decides whether the server supports it and SHALL return a structured decision rather than a prose message.
3. THE `supportedVersions` list reported by the shared capability source SHALL be the single source of truth, and no other code path SHALL hardcode a protocol revision string.
4. WHEN the shared capability source returns `supportedVersions` THEN the list SHALL contain only revisions whose modern-required fields are fully implemented at the time of the response.
5. WHERE the shared capability source and the shared negotiation source exist today as unused scaffolding, THE Read Function SHALL rework them in place rather than introduce parallel implementations, so that no dead definitions remain after this work.

### Requirement 4: Era discrimination

**User Story:** As a client developer, I want the server to shape its response for the era I speak based on how I opened contact, so that I do not need to send any additional signal beyond what my era's specification requires.

#### Acceptance Criteria

1. WHEN an inbound request's method is `initialize` THEN THE Read Function SHALL resolve the request's era as legacy and SHALL shape the response as an `InitializeResult` at a supported legacy revision.
2. WHEN an inbound request carries protocol-version metadata — either `_meta['io.modelcontextprotocol/protocolVersion']` in the body or the `MCP-Protocol-Version` HTTP header — naming a supported modern revision THEN THE Read Function SHALL resolve the request's era as modern and SHALL shape the response accordingly.
3. WHEN an inbound request's method is `server/discover` THEN THE Read Function SHALL answer it regardless of carried metadata, since `server/discover` is the modern probe and must be reachable before era is fully negotiated.
4. WHEN an inbound request carries protocol-version metadata naming a revision not in `supportedVersions` THEN THE Read Function SHALL reject the request with error code -32022 (`UnsupportedProtocolVersion`) and SHALL enumerate the `supportedVersions` list in the error data.
5. WHEN an inbound request carries no protocol-version metadata and is not an `initialize` or `server/discover` request THEN THE Read Function SHALL resolve the request's era by a documented default rule, chosen during design, and SHALL apply that rule consistently.
6. THE era discriminator SHALL hold no state across requests, consistent with the server's stateless architecture.
7. WHERE an inbound request is header-only (such as a `MCP-Protocol-Version` header on a request whose body does not carry `_meta`), THE Read Function SHALL treat the header as authoritative for era resolution.

### Requirement 5: `server/discover` method

**User Story:** As a modern-era client, I want to call `server/discover` and receive the server's supported versions, capabilities, and instructions in one response, so that I can begin issuing tool calls without a handshake.

#### Acceptance Criteria

1. THE Read Function SHALL implement the `server/discover` JSON-RPC method, routed through the same switch as every other method.
2. THE `server/discover` result SHALL carry `supportedVersions`, `capabilities`, and `instructions`, and SHALL carry server identity in the result-level `_meta` as specified by Requirement 2.
3. THE `server/discover` method SHALL be answerable without the client having previously called any other method, consistent with the modern era's removal of the `initialize` handshake.
4. THE `supportedVersions`, `capabilities`, and `instructions` returned by `server/discover` SHALL be identical in content to the fields of the same name returned on the legacy `InitializeResult`, differing only in envelope shape as the two eras' specifications require.
5. THE `server/discover` method SHALL be callable by an unauthenticated client, consistent with the public read-only posture of the server.

### Requirement 6: New error codes

**User Story:** As a client developer, I want machine-readable, specification-aligned error codes for the two new rejection conditions, so that my client can diagnose and recover without parsing prose.

#### Acceptance Criteria

1. THE Read Function SHALL define error code -32020 as `HeaderMismatchError` for use when an `Mcp-Method` or `Mcp-Name` HTTP header disagrees with the body.
2. THE Read Function SHALL define error code -32022 as `UnsupportedProtocolVersionError` for use when a modern-era request names an unsupported revision; the error's `data` payload SHALL include the list of `supportedVersions`.
3. THE Read Function SHALL add the new error codes alongside the existing `JSON_RPC_ERRORS` entries without renumbering `PARSE_ERROR`, `INVALID_REQUEST`, `METHOD_NOT_FOUND`, `INVALID_PARAMS`, or `INTERNAL_ERROR`.
4. WHERE a request condition today raises `INTERNAL_ERROR` but corresponds to one of the new error semantics, THE Read Function SHALL raise the new code instead, so that no new condition is reported under a generic error.
5. THE System SHALL reserve the right to add -32021 (`MissingRequiredClientCapability`) when a future requirement needs it, but SHALL NOT emit it from any code path introduced in this spec, since no capability is currently required of callers.

### Requirement 7: Modern-era required fields

**User Story:** As a modern-era client, I want every response to carry the fields the `2026-07-28` specification requires, so that I can parse responses without reaching for compatibility fallbacks.

#### Acceptance Criteria

1. WHERE the resolved era is modern, THE Read Function SHALL set `resultType: 'complete'` on every successful JSON-RPC result.
2. WHERE the resolved era is legacy, THE Read Function SHALL NOT include `resultType` on any JSON-RPC result.
3. WHERE the resolved era is modern and the method is `tools/list`, THE Read Function SHALL return a `CacheableResult` envelope carrying `ttlMs` and `cacheScope` in addition to the tool array, and both values SHALL come from a documented configuration source rather than a per-call literal.
4. WHERE the resolved era is legacy and the method is `tools/list`, THE Read Function SHALL return the response in the current legacy shape without `ttlMs` or `cacheScope`.
5. WHERE the resolved era is modern, THE Read Function SHALL include server identity in result-level `_meta` as specified by Requirement 2, on every result shape where the specification permits `_meta`.
6. THE era-branching logic for `resultType`, `ttlMs`/`cacheScope`, and `_meta` SHALL be centralized in the formatters in `mcp-protocol.js`, and no controller SHALL construct a response envelope directly.
7. THE tools array returned by `tools/list` SHALL be deterministically ordered under both eras, so that identical inputs produce identically ordered results.

### Requirement 8: Modern-only header validation

**User Story:** As a security-conscious operator, I want header-asserted method and tool names cross-checked against the body on the modern branch, so that a mismatched proxy or injected header is rejected rather than silently honored.

#### Acceptance Criteria

1. WHERE the resolved era is modern, IF the request carries an `Mcp-Method` HTTP header THEN THE Read Function SHALL verify that it equals the JSON-RPC `method` field, and otherwise SHALL reject the request with error code -32020 (`HeaderMismatch`).
2. WHERE the resolved era is modern, IF the request carries an `Mcp-Name` HTTP header AND the method is `tools/call` THEN THE Read Function SHALL verify that `Mcp-Name` equals the `name` field in the body's `params`, and otherwise SHALL reject the request with error code -32020 (`HeaderMismatch`).
3. WHERE the resolved era is legacy, THE Read Function SHALL NOT require `Mcp-Method` or `Mcp-Name`, and SHALL NOT reject a request for lacking them, since legacy clients do not send them.
4. WHERE the resolved era is modern and neither `Mcp-Method` nor `Mcp-Name` is present on the request, THE Read Function SHALL proceed as though the body is authoritative, since the modern specification permits but does not require these headers.
5. THE `Mcp-Param-*` and `x-mcp-header` families of client-sent headers SHALL NOT be read by the Read Function in this spec, and no tool SHALL depend on them.

### Requirement 9: Correct header handling between router, routes, and cache-data

**User Story:** As a maintainer touching the router during this work, I want response headers to actually reach the wire through a single, correctly-documented path, so that the next contributor does not have to reverse-engineer what gets stripped where.

The current flow is: `json-rpc-router.js` attaches `STANDARD_HEADERS` to its internal response object; `routes/index.js` then copies those headers onto the cache-data `Response` via `response.addHeader()`, **stripping four by name** (`content-type`, `access-control-allow-origin`, `access-control-allow-methods`, `access-control-allow-headers`) on the stated grounds that `Response.finalize()` manages them. Inspection of cache-data `Response.finalize()` shows this is true for the first two and false for the latter two: `finalize()` sets `Content-Type` from the body when unset, sets `Access-Control-Allow-Origin` unconditionally, and does nothing with `Allow-Methods` or `Allow-Headers`. So the router's `Allow-Methods` and `Allow-Headers` values are declared, stripped by `routes/index.js`, and never re-emitted — their current value on the wire comes from the OPTIONS preflight that API Gateway answers from its own `Cors` config, not from any Lambda path.

#### Acceptance Criteria

1. THE Read Function SHALL use `response.addHeader()` as the single supported path for setting a server-defined response header, and SHALL rely on cache-data's documented contract that application-set `Content-Type`, `Expires`, and `Cache-Control` headers are preserved by `Response.finalize()`.
2. THE Read Function SHALL document, in a comment on `json-rpc-router.js`'s `STANDARD_HEADERS` constant or in the technical documentation introduced by Requirement 14, that: `Content-Type` and `Access-Control-Allow-Origin` are managed by `Response.finalize()`; `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers` are declared in API Gateway's `Cors` config in `template.yml` and are answered on the CORS preflight by API Gateway without Lambda involvement; and `Response.finalize()` overwrites `Access-Control-Allow-Origin` unconditionally regardless of application-set values.
3. THE Read Function SHALL resolve the misalignment in `routes/index.js:52-56` by one of the following, chosen during design: (a) remove `access-control-allow-methods` and `access-control-allow-headers` from the strip list and from `STANDARD_HEADERS`, since API Gateway owns them, OR (b) remove them from the strip list and keep them in `STANDARD_HEADERS` so the Lambda response reflects the CORS policy as a defense-in-depth annotation. In either resolution, no header SHALL be declared in `STANDARD_HEADERS`, stripped by `routes/index.js`, and never emitted by `finalize()`.
4. WHERE this spec introduces a new server-set response header — for example, a header announcing the resolved protocol revision — THE Read Function SHALL emit it via `response.addHeader()` after the router returns, and SHALL NOT add it to the `STANDARD_HEADERS` strip list.
5. THE System SHALL update the existing router test that asserts `response.headers['Access-Control-Allow-Origin']`, `['Access-Control-Allow-Methods']`, and `['Access-Control-Allow-Headers']` are present on the response, so that the test reflects the chosen resolution from Acceptance Criterion 3 rather than the dropped-on-the-floor status quo.
6. WHERE a modern client expects a header to be observable on the HTTP response body (as distinct from a header the browser needs permission to send on the request), THE Read Function SHALL emit it through `response.addHeader()` and SHALL verify by test that it survives `Response.finalize()`.

### Requirement 10: CORS allow-list for modern headers

**User Story:** As a browser-hosted modern-era client, I want my requested headers to pass the API Gateway CORS preflight, so that my `MCP-Protocol-Version` and `Mcp-Method` headers reach the Lambda.

#### Acceptance Criteria

1. THE API Gateway configuration in `template.yml` SHALL extend the CORS `AllowHeaders` list to include `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`.
2. THE Read Function SHALL verify, as part of the Phase 2 work, that the Lambda integration is of a proxy type such that the new headers reach the handler through `clientRequest.getProps()`.
3. THE `AllowMethods`, `AllowOrigin`, and other existing CORS entries SHALL be preserved unchanged, so that the CORS change is purely additive.
4. THE CloudFormation template change SHALL be sequenced before or with the code that depends on it, so that a deployment in which the code change ships without the template change cannot occur.
5. WHERE the API Gateway allow-list change is backward compatible on its own, THE System SHALL permit it to ship as a standalone deploy.

### Requirement 11: Legacy revision selection

**User Story:** As the author of this spec, I need the legacy revision we advertise to be a deliberate choice, so that the server does not continue to advertise `2024-11-05` by default when a later legacy revision would unlock richer tool metadata.

#### Acceptance Criteria

1. THE System SHALL select, during the design phase, exactly one legacy revision to advertise, between the current `2024-11-05` and the last handshake revision `2025-11-25`.
2. WHERE the chosen revision is `2025-11-25`, THE Read Function SHALL audit every field required by that revision and SHALL implement any that are not already implemented before `2025-11-25` is advertised.
3. WHERE the chosen revision is `2024-11-05`, THE Read Function SHALL continue to serve `Tool.title` and `Tool.annotations` on the modern branch only, since those fields are not required of the chosen legacy revision.
4. THE chosen legacy revision SHALL appear in `supportedVersions` only after Requirement 3's full-implementation condition is met for it.
5. THE decision between `2024-11-05` and `2025-11-25` SHALL be recorded in the design document together with the rationale.

### Requirement 12: Advertising `2026-07-28`

**User Story:** As the author of this spec, I want `2026-07-28` advertised in `supportedVersions` only after every modern-required field is implemented, so that we never ship a half-implemented revision that leaves a legacy client without a fall-forward path.

#### Acceptance Criteria

1. THE Read Function SHALL NOT include `2026-07-28` in `supportedVersions` until every modern-required field defined by Requirement 7, every error code defined by Requirement 6, every header validation defined by Requirement 8, and the `server/discover` method defined by Requirement 5 are implemented.
2. THE System SHALL gate the addition of `2026-07-28` to `supportedVersions` behind a passing test suite that verifies every modern-required field is produced on the modern branch.
3. WHERE a build state exists in which `server/discover` is implemented but Requirement 7 is not fully complete, THE Read Function SHALL still answer `server/discover` for the Phase 3 handoff, but SHALL NOT list `2026-07-28` in the response's `supportedVersions`.
4. THE Phase 3 and Phase 4 work defined in the plan SHALL ship together before `2026-07-28` is advertised.

### Requirement 13: Phase 5 wire support for `Tool.title` and `Tool.annotations`

**User Story:** As the owner of the companion discovery spec, I want the modern branch to carry `Tool.title` and `Tool.annotations` on `tools/list` once the Tool Metadata Registry is ready, so that my work has a wire path to deliver its content.

#### Acceptance Criteria

1. WHERE the resolved era is modern, THE Read Function SHALL carry a tool's `title` and `annotations` fields on the `tools/list` response, drawn from whatever structure the companion discovery spec publishes.
2. WHERE the resolved era is legacy and the chosen legacy revision does not require `title` or `annotations`, THE Read Function SHALL omit those fields from the response rather than emit a definition the chosen legacy revision does not accept.
3. THE content of `title` and `annotations` SHALL be owned by the companion discovery spec; this spec SHALL own only the wire-level inclusion decision.
4. WHEN the companion spec's registry declares no `title` or `annotations` for a tool THEN THE Read Function SHALL omit those fields for that tool rather than emit an empty value.

### Requirement 14: Documentation

**User Story:** As an operator, maintainer, and future contributor, I want the dual-era behavior documented, so that a reader can tell from the docs alone which era will be selected for a given request and why.

#### Acceptance Criteria

1. THE `ARCHITECTURE.md` SHALL describe the era discriminator, the shared capability source, the shared negotiation source, and the per-request path from inbound method to resolved era to formatted response.
2. THE developer documentation SHALL document the single source of truth for `supportedVersions`, server identity, and `instructions`, and SHALL direct contributors to edit those sources rather than any protocol-surface call site.
3. THE admin-ops documentation SHALL document the CORS allow-list change in `template.yml`, SHALL document that the CORS preflight response is owned by API Gateway (not Lambda), and SHALL document the finding from Requirement 9 about which header categories are managed by `Response.finalize()`, which are owned by API Gateway, and which require explicit `response.addHeader()` in Lambda code.
4. THE end-user documentation SHALL document that the server speaks both the legacy and modern eras of MCP concurrently and name the revisions in `supportedVersions`, so that a client developer can match capabilities without reading the source.
5. THE `CHANGELOG.md` SHALL record this feature under the unreleased version, and SHALL note the addition of `server/discover`, the new error codes, and the modern-required fields.
6. THE documentation SHALL state the recorded decision on legacy revision selection from Requirement 11 and the recorded decision on origin validation posture from the open question in PLAN section 9.
7. THE documentation SHALL state that `Mcp-Param-*` / `x-mcp-header` support is not implemented in this release.

### Requirement 15: Testing and verification

**User Story:** As a maintainer, I want this covered by tests in the existing framework, so that CI/CD catches a divergence between what the server advertises and what it actually does.

#### Acceptance Criteria

1. THE new tests SHALL follow the existing Jest layout for the Read Function, with per-layer unit tests under `tests/unit/` and cross-layer tests under `tests/integration/`.
2. THE new tests SHALL assert that `supportedVersions`, server identity, and `instructions` each have exactly one definition in the codebase, and SHALL fail when any of them is duplicated or when the legacy and modern surfaces return divergent values.
3. THE new tests SHALL assert that a legacy `initialize` request produces a valid `InitializeResult` with a non-empty `instructions` string.
4. THE new tests SHALL assert that a modern `server/discover` request produces `supportedVersions`, `capabilities`, and the same `instructions` string as `initialize`.
5. THE new tests SHALL assert that a request naming a protocol revision not in `supportedVersions` is rejected with error code -32022, and that the error data enumerates `supportedVersions`.
6. THE new tests SHALL assert that every modern result carries `resultType: 'complete'` and that no legacy result carries `resultType`.
7. THE new tests SHALL assert that a modern `tools/list` response carries `ttlMs` and `cacheScope` and that a legacy `tools/list` response does not.
8. THE new tests SHALL assert that a modern request whose `Mcp-Method` header disagrees with the body is rejected with error code -32020, and that a legacy request lacking `Mcp-Method` is accepted.
9. THE new tests SHALL assert that `server/discover` is answerable by an unauthenticated client and before any other method has been called.
10. WHERE an existing test asserts a legacy-era contract this feature preserves — such as the exact `InitializeResult` shape — THE System SHALL update the existing test deliberately as part of this work, treating a change as a signal to review rather than an incident.
11. THE new and existing Jest test suites SHALL complete with zero failing tests before the change is considered complete.
12. THE System SHALL verify the hand-tested client criterion of PLAN section 8 — Kiro, Claude Code, ChatGPT, and Cursor each connecting successfully and listing tools — against a deployed environment, since no amount of unit testing substitutes for a real client handshake.

### Requirement 16: Backward compatibility on the legacy wire

**User Story:** As an operator with legacy clients in the field, I want this release to be non-breaking on the legacy branch, so that I can deploy without coordinating client updates.

#### Acceptance Criteria

1. A legacy client that successfully called this server before this release SHALL continue to successfully call it after this release, with no change to the headers it sends, the body it sends, or the response fields it reads.
2. THE legacy `InitializeResult` SHALL continue to carry every field it carried before this release, with `instructions` added and `serverInfo.version` corrected per Requirement 2.
3. THE Read Function SHALL NOT introduce any new required HTTP header, request body field, or `_meta` field for legacy-era requests.
4. THE Read Function SHALL NOT remove any existing field from a legacy-era response, so that a client that reads a specific field continues to find it.
5. WHERE a cache key is computed for a legacy-era request, THE Read Function SHALL ensure a cache entry written before this release cannot be served as though it satisfied a modern-era request, and vice versa.

---

## Out of scope

- **Session state.** This server has never implemented protocol-level sessions, `Mcp-Session-Id`, SSE streams, resumability, or server-initiated requests, and this spec SHALL NOT introduce any of them.
- **Multi Round-Trip Requests / `input_required`.** No tool in this server is interactive; every tool is read-only and single round-trip.
- **Tasks extension.** Deferred unless and until a tool needs it.
- **`Mcp-Param-*` / `x-mcp-header` client-sent headers.** PLAN decision 2 and this spec's Requirement 8.5.
- **Content of the `instructions` string.** Owned by [`0-0-7-tool-discovery-enhancement`](../0-0-7-tool-discovery-enhancement) Requirement 1.
- **Tool Metadata Registry contents.** Owned by [`0-0-7-tool-discovery-enhancement`](../0-0-7-tool-discovery-enhancement) Requirement 2. This spec owns only the wire-level inclusion of `Tool.title` and `Tool.annotations`.
- **Changes to any other MCP method envelope beyond those required by the modern specification.** `prompts/*`, `resources/*`, `sampling/*`, `logging/setLevel`, `ping`, and `notifications/roots/list_changed` remain unimplemented and are not added by this spec.
- **Vector-store or doc-index changes.** Owned by the companion discovery spec; this spec touches only the protocol surface.

## Open questions

These are the questions the plan left open in section 9. They are to be resolved in the design document before the corresponding implementation work begins, and the resolutions SHALL be recorded under Requirement 14's documentation surfaces.

1. **Legacy revision selection.** Advertise `2024-11-05` (current) or move the legacy branch to `2025-11-25` (last handshake revision, unlocks `title` and `annotations` for legacy clients at the cost of a required-field audit)? Resolution owned by Requirement 11. **Answer:** Move legacy branch to last handshake revision
2. **Origin validation posture.** The modern transport binding directs servers to validate the `Origin` header against DNS rebinding. Current configuration is `AllowOrigin: '*'` and `validations.js` sets `referrers: ['*']`. This is defensible for a public read-only server, but it should be a recorded decision rather than a default. Resolution owned by Requirement 14.6. **Answer:** record the decision.
3. **Client verification matrix.** PLAN success criterion 8 requires Kiro, Claude Code, ChatGPT, and Cursor to each connect successfully. Can access to all four be arranged, or should the hand-verification scope be narrowed and documented? Resolution owned by Requirement 15.12. **Answer:** Only Kiro is available to be tested. All others will have to be verified against their own documentation and protocols.

---

## Related documentation

- [PLAN.md](PLAN.md) — the planning document this spec is derived from
- [Tool discovery enhancement](../0-0-7-tool-discovery-enhancement/PLAN.md) — companion spec, consumer of this work
- [MCP specification — versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [MCP specification — 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP specification — tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [SEP-2575: stateless MCP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2575-stateless-mcp.md)
- [SEP-2243: HTTP header standardization](https://modelcontextprotocol.io/seps/2243-http-standardization)

> Content from the MCP specification and linked announcements was rephrased for compliance with licensing restrictions.
