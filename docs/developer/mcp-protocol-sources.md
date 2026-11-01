# MCP protocol sources of truth

> For developers who add or change the protocol surface of the Read Lambda: which revisions it serves, what identity it reports, and what `instructions` it carries.

The Read Lambda serves legacy (`initialize`) and modern (`server/discover`) MCP clients from one endpoint. Each value that both eras report has exactly **one definition**. Edit the definition, never a call site. See [ARCHITECTURE.md](../../ARCHITECTURE.md#mcp-protocol-dual-era-support) for the request path and the era decision table.

## Where each value lives

| Value | Edit this | Do not edit |
|-------|-----------|-------------|
| Which revisions are legacy or modern | `LEGACY_REVISIONS`, `MODERN_REVISIONS` in `utils/mcp-protocol.js` | `utils/mcp-era.js` (re-exports them) |
| Which revisions are advertised | `SUPPORTED_PROTOCOL_VERSIONS` in `utils/mcp-protocol.js` | Any formatter or the router |
| Server name | `SERVER_NAME` in `utils/mcp-protocol.js` | Any formatter |
| Server version | `CHANGELOG.md` (see below) | `package.json`, `config/release-version.js` |
| `instructions` text | `config/server-instructions.js` | `utils/mcp-protocol.js` |
| Capabilities object | `MCP_CAPABILITIES_WIRE` in `utils/mcp-protocol.js` | Any formatter |
| Modern cache hint on `tools/list` and `server/discover` | `TOOLS_LIST_TTL_MS`, `TOOLS_LIST_CACHE_SCOPE`, and the allowed set `CACHE_SCOPES` in `utils/mcp-protocol.js` | The formatters |
| Revisions that may carry `Tool.title` and `Tool.annotations` | `REVISIONS_SUPPORTING_TITLE_ANNOTATIONS` in `utils/tool-catalog.js` | Controllers |

`getCapabilities()` assembles the supported versions, capabilities, server identity, and `instructions`. `initializeResult()` and `discoverResult()` both call it.

Four tests enforce the single definitions, so a duplicate fails CI:

- `tests/unit/architecture/no-hardcoded-revisions.test.js` fails if a revision string appears outside `utils/mcp-protocol.js`, `utils/mcp-era.js`, or `utils/tool-catalog.js`.
- `tests/unit/architecture/instructions-composition.test.js` fails if `instructions` is composed anywhere except `buildInstructions()`.
- `tests/unit/utils/mcp-protocol-constants.test.js` fails if the advertised set, the era lists, or the values reported by each surface drift apart.
- `tests/unit/architecture/no-hardcoded-cache-scope.test.js` fails if executable code assigns a string literal to `cacheScope`.

The post-deploy verifier and its fake server restate the allowed scopes from the specification on purpose and do not import `CACHE_SCOPES`. If the server misreads the specification, a guard that shared its definition would pass the same mistake. See [post-deploy verification](post-deploy-verification.md).

## Server version

The reported version is the first `## [vX.Y.Z]` header in the repository's `CHANGELOG.md`, released or unreleased. `application-infrastructure/build-scripts/write_release_version.py` runs in the `pre_build` phase of `buildspec.yml` and writes `config/release-version.js` into every Lambda directory:

```javascript
// config/release-version.js (generated, git-ignored, do not edit)
module.exports = { releaseVersion: '0.0.7' };
```

If the file is missing, `utils/mcp-protocol.js` falls back to `package.json` and logs a `release_version_fallback` event at INFO level. That is expected on a fresh checkout. It would indicate a build problem if it appeared in a deployed environment, so search CloudWatch for the event after a deploy.

To run the script locally:

```bash
python3 application-infrastructure/build-scripts/write_release_version.py
```

## Add or change a revision

### Recognize a new revision

1. Add it to `LEGACY_REVISIONS` or `MODERN_REVISIONS` in `utils/mcp-protocol.js`, oldest first. The era is defined by the specification: a revision that still opens with `initialize` is legacy.
2. Do **not** add it to `SUPPORTED_PROTOCOL_VERSIONS` yet. A recognized but unadvertised revision is routed to its era, and a client that declares it receives `-32022` listing what is actually supported.

### Advertise it

Add it to `SUPPORTED_PROTOCOL_VERSIONS` in the **same change** that implements every field it requires and the tests that prove it. The rule exists because a legacy client cannot fall forward: if the server advertises a revision it only partly implements, the client has no recovery.

Then, in the same change:

1. Add the revision to `REVISIONS_SUPPORTING_TITLE_ANNOTATIONS` in `utils/tool-catalog.js` if it carries `Tool.title` and `Tool.annotations`.
2. Update the advertised-set assertion in `tests/unit/utils/mcp-protocol-constants.test.js` and the `CURRENT_SUPPORTED_REVISIONS` list in `tests/unit/utils/mcp-protocol-negotiate.test.js`. They are deliberate literals so an accidental change to the advertisement fails a test.
3. Update [supported protocol revisions](../end-user/supported-protocol-revisions.md).

## Behavior that is easy to get wrong

- **An unlisted `initialize` `params.protocolVersion` is never rejected.** It gets a counter-offer: the highest legacy revision not newer than the one requested, or the highest legacy revision if the request is newer than all of them (including a modern one). Rejecting would break a legacy client on a revision this server does not list.
- **A declared header or `_meta` revision can return `-32022`, on any method except `server/discover`.** That includes `initialize`: an `initialize` that carries an unlisted `MCP-Protocol-Version` header or `_meta` value is rejected, and the error data reports what the client sent. Only the handshake's own `params.protocolVersion` is exempt.
- **A blank declaration is no declaration.** An empty `MCP-Protocol-Version` header or `_meta` value is treated as absent for every method. A value with trailing whitespace is not blank, so it is a declaration of an unsupported revision.
- **`server/discover` is always answered,** including when the client declares an unlisted revision, because it is how a client learns which revisions it may use.
- **`params._meta` is preferred.** The specification places request metadata in `params._meta`. A top-level `_meta` is also read for compatibility, and `params._meta` wins when both are present.
- **Header validation is modern-only.** `Mcp-Method` and `Mcp-Name` are checked against the body only when the resolved era is modern. A legacy request is never rejected for lacking or mismatching them.

## Recorded decisions

### Both `2024-11-05` and `2025-11-25` are advertised

The legacy branch advertises both handshake revisions. A client that supports `2025-11-25` negotiates up to it and receives `Tool.title` and `Tool.annotations`. A client pinned to `2024-11-05` keeps working unchanged. Advertising the newer revision needed an audit of the fields it requires (the audit found nothing missing beyond `Tool.title` and `Tool.annotations`), and costs nothing once that is done.

### `Mcp-Param-*` and `x-mcp-header` are not implemented

No current tool needs them. The server does not read those headers and no tool depends on them.
