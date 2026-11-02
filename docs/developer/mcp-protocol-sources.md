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

## Published schemas and conformance tests

Every response shape the server emits is checked, in the Build stage, against pinned copies of the published MCP JSON Schemas. The same schemas check the fake server that the post-deploy verifier's tests rely on. In this section `RF` means `application-infrastructure/src/lambda/read-function` and `PV` means `application-infrastructure/tests/postdeploy-verify`.

### The vendored schemas

The schemas live in `application-infrastructure/tests/mcp-schemas/<revision>/schema.json`, one directory per revision (`2024-11-05`, `2025-11-25`, `2026-07-28`). The rules:

- They are **byte-exact** copies of upstream `schema/<revision>/schema.json`. Never edit one by hand. A hand edit makes the conformance tests agree with the wrong contract.
- The upstream commit they were taken from is pinned in [`PROVENANCE.md`](../../application-infrastructure/tests/mcp-schemas/PROVENANCE.md), together with the retrieval date, one sha256 per revision, and the upstream license text.
- They are test data. They are never packaged or deployed with a Lambda function.

### The validator helpers

Two copies of the same helper exist because the Read Function and the verifier package are self-contained and share no source. Keep them in step.

| Copy | Used by |
|------|---------|
| `RF/tests/helpers/mcp-schema-validator.js` | The Read Function tests |
| `PV/helpers/mcp-schema-validator.mjs` | The verifier package tests |

Both export two checks. Each takes a revision, a definition name from that revision's schema, and a value, and returns `{ valid, errors }`. An unknown revision or definition throws, so a typo cannot pass silently.

- `validate(revision, definitionName, value)` checks the value against the schema as published.
- `validateStrict(revision, definitionName, value)` checks it against a strict overlay: the published schema plus rejection of property names the schema does not declare. This catches a misspelled optional field, which the published schemas accept because most objects are open.

The overlay is built in memory from the vendored file, which is never modified. It only adds constraints, so anything that passes `validateStrict` also passes `validate`. A few subtrees stay open on purpose because the specification leaves them open. The helper exports the two lists:

| Export | Holds | Why open |
|--------|-------|----------|
| `OPEN_PROPERTIES` | `inputSchema`, `outputSchema`, `structuredContent`, `experimental`, `extensions` | Arbitrary JSON Schema, arbitrary JSON, or declared extension points |
| `OPEN_DEFINITIONS` | `Result`, `JSONObject` | The specification's own catch-all definitions |

To admit a new extension property, add its name to `OPEN_PROPERTIES` (or the definition to `OPEN_DEFINITIONS`) in **both** helpers, and add a unit test case in `RF/tests/unit/helpers/mcp-schema-validator.test.js`. Do not weaken a check to make a response pass. If the server emits a property the schema does not declare, fix the server or admit the property deliberately.

### The tests

| Test | Checks |
|------|--------|
| `RF/tests/integration/mcp-protocol-schema-conformance.test.js` | Real router output: results for `initialize`, `tools/list`, `tools/call`, and `server/discover` on each revision and with no revision declared, the error table, and the `202` notification response. Each body is run through `validate` and `validateStrict` |
| `PV/fake-mcp-server-schema-conformance.jest.mjs` | The fake server's output for every request kind it models, against the same schemas, so the verifier tests rest on a conformant fake |
| `RF/tests/unit/helpers/mcp-schema-validator.test.js` | The helper itself, with negative controls that must fail |
| `RF/tests/unit/architecture/vendored-mcp-schemas.test.js` | Integrity and coverage: each file matches its sha256 in `PROVENANCE.md`, every vendored directory is listed and every listed revision has a file, the commit is 40 lowercase hexadecimal characters, and every entry of `SUPPORTED_PROTOCOL_VERSIONS` has a vendored schema |

Two limits to keep in mind:

- The integrity test fails when a vendored file changes by one byte, which is why a refresh must go through the script below.
- An error for a request whose `id` could not be read has no `id`. The `2024-11-05` schema requires one, so the conformance test validates those errors on `2025-11-25` and `2026-07-28` only.

A passing run shows that the responses match the published schemas. It does not prove that a given client accepts them.

### Refresh the schemas

Run the script from the repository root:

```bash
python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py
```

With no arguments it runs in report mode: it resolves upstream `main` to a commit, downloads each vendored revision at that commit, and classifies it as `unchanged`, `text-only change` (only `description` or `$comment` text differs), or `semantic change`. It writes nothing. To apply a change, pass the commit from the report's first line:

```bash
python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py --write --commit <sha>
```

Write mode replaces the schema files and rewrites `PROVENANCE.md` only after every download has succeeded.

| Exit code | Meaning |
|-----------|---------|
| `0` | No difference, or only text-only changes and new upstream revisions (warned) |
| `1` | At least one semantic change |
| `2` | Usage, input, or local file error |
| `3` | Upstream unreachable, rate limited, or unusable. Reported as `upstream unavailable`, never as drift |

The [`update-mcp-schemas` skill](../../.kiro/skills/update-mcp-schemas/SKILL.md) runs the report, applies a change, runs both test suites, and reports the result. It never commits. The `prepare-release` skill runs it as part of a release, and a GitHub workflow runs the report when a release is published. See the [release process](release-process.md) and [what the release gate does](release-process.md#what-the-release-gate-does).

### Add a new revision's schema

Vendoring a schema does not advertise the revision. Do it as a separate change from advertising it:

1. Create `application-infrastructure/tests/mcp-schemas/<revision>/`.
2. Run the refresh script in write mode so the directory is filled and `PROVENANCE.md` gets its sha256 row.
3. Add the revision to the conformance test's cases, with the definitions that revision uses.
4. Add the revision to `SUPPORTED_PROTOCOL_VERSIONS` only in the change that implements it, as described in [Advertise it](#advertise-it). The coverage test fails if an advertised revision has no vendored schema.

## Behavior that is easy to get wrong

- **An unlisted `initialize` `params.protocolVersion` is never rejected.** It gets a counter-offer: the highest legacy revision not newer than the one requested, or the highest legacy revision if the request is newer than all of them (including a modern one). Rejecting would break a legacy client on a revision this server does not list.
- **A declared header or `_meta` revision can return `-32022`, on any method except `server/discover`.** That includes `initialize`: an `initialize` that carries an unlisted `MCP-Protocol-Version` header or `_meta` value is rejected. The error data carries `requested` (what the client sent) and `supported` (the revisions the server lists), the key names the `2026-07-28` schema requires. Only the handshake's own `params.protocolVersion` is exempt.
- **`-32022` and `-32020` use HTTP status 400. Every other error uses 200.** The specification requires `400 Bad Request` for these two. All other errors are JSON-RPC errors inside a `200` response.
- **A request with no `id` is a notification.** It gets HTTP `202` with no body, whatever the method, for example `notifications/initialized`. Revision and header checks still apply first, so a notification with an unlisted declared revision gets `400` and `-32022`.
- **An invalid `id` is `-32600`, and an error whose request `id` cannot be read carries no `id` member.** A valid `id` is a string or an integer. `null`, an object, a boolean, or a float is invalid. A parse error and the `401` for an invalid key also carry no `id`. The server never sends `id: null`, which no MCP schema accepts.
- **A blank declaration is no declaration.** An empty `MCP-Protocol-Version` header or `_meta` value is treated as absent for every method. A value with trailing whitespace is not blank, so it is a declaration of an unsupported revision.
- **`server/discover` is always answered,** including when the client declares an unlisted revision, because it is how a client learns which revisions it may use.
- **`params._meta` is preferred.** The specification places request metadata in `params._meta`. A top-level `_meta` is also read for compatibility, and `params._meta` wins when both are present.
- **Header validation is modern-only.** `Mcp-Method` and `Mcp-Name` are checked against the body only when the resolved era is modern. A legacy request is never rejected for lacking or mismatching them.

## Recorded decisions

### Both `2024-11-05` and `2025-11-25` are advertised

The legacy branch advertises both handshake revisions. A client that supports `2025-11-25` negotiates up to it and receives `Tool.title` and `Tool.annotations`. A client pinned to `2024-11-05` keeps working unchanged. Advertising the newer revision needed an audit of the fields it requires (the audit found nothing missing beyond `Tool.title` and `Tool.annotations`), and costs nothing once that is done.

### `Mcp-Param-*` and `x-mcp-header` are not implemented

No current tool needs them. The server does not read those headers and no tool depends on them.
