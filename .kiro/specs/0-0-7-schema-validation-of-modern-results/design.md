# Design Document

## Overview

This design does three things.

- **Fixes the errors.** The `-32022` and `-32020` errors follow the published MCP schema and transport rules.
- **Tests every response.** Each response the Read Function emits is validated against pinned copies of the three published schemas, once as published and once with undeclared property names rejected.
- **Keeps the copies current.** A refresh script, two skills, a hook, and a GitHub release gate keep the pinned copies up to date, and the two-pass release path is written down.

[requirements.md](requirements.md) says what must be true. [PLAN.md](PLAN.md) holds the evidence and the decisions. This document says what changes in each file, how it is verified, and in what order.

**Two further protocol fixes.** Q10 and Q11 were found while writing this design and answered A. Section 20 covers errors without a known request `id` (Requirement 24). Section 21 covers notifications (Requirement 25). Both are part of the first phase.

### Design principles

1. **Fix, then guard.** The server and verifier changes (sections 1 to 4) land before the conformance tests, so no test is added red.
2. **The schema is the oracle.** Every expectation in the new tests comes from a vendored schema file, not from server code. The verifier and fake server keep restating values from the specification, as the cacheScope spec established.
3. **Pinned bytes, derived strictness.** The vendored files are byte-exact copies; the strict overlay is computed from them in memory on every run, so a refresh never has to re-apply edits.
4. **Wiring mistakes must fail loudly.** Helpers throw on unknown names, negative controls prove each check can fail, and guards tie the files to their recorded hashes and to the advertised revisions.
5. **Release time checks; `dev` changes.** Updates are applied on `dev` and promoted through every stage. Nothing that runs at GitHub release time changes code.
6. **No infrastructure change.** No template, IAM, buildspec, or CodePipeline edit.

### What is not designed here

- Live schema validation inside the verifier.
- New sub-check IDs.
- Changes to the HTTP status of errors other than `-32022` and `-32020`.
- Advertising a new revision.
- Buildspec steps for Python tests or `npm audit`, Dependabot changes, and pruning tests. Those belong to `0-0-8-prune-tests-and-ensure-automation` (Requirement 23).

## Architecture

### Where each check's expectations come from

```mermaid
flowchart LR
    UP[modelcontextprotocol/modelcontextprotocol<br/>schema/&lt;rev&gt;/schema.json] -- refresh_mcp_schemas.py --write --commit --> VS[tests/mcp-schemas/&lt;rev&gt;/schema.json<br/>+ PROVENANCE.md sha256]
    VS --> H1[read-function/tests/helpers<br/>mcp-schema-validator.js]
    VS --> H2[postdeploy-verify/helpers<br/>mcp-schema-validator.mjs]
    H1 --> CT[mcp-protocol-schema-conformance.test.js<br/>Build stage]
    H2 --> FT[fake-mcp-server-schema-conformance.jest.mjs<br/>PostDeploy pre_build]
    RF[Read Function router<br/>real output] --> CT
    FK[fake-mcp-server.mjs] --> FT
    SPEC[Specification text] -. restated by hand .-> VER[verify-deployment.js]
    SPEC -. restated by hand .-> FK
    VER -- PostDeploy --> DEP[Deployed stage]
```

The vendored files feed only the two test packages. The verifier stays dependency-free and keeps its hand-restated values, and the fake-server conformance test checks those values against the schema.

### Gates on the release path

```mermaid
sequenceDiagram
    participant Dev as dev
    participant P as test / beta / main pipelines
    participant Hook as Kiro hook
    participant PR as prepare-release skill
    participant GH as GitHub release
    participant RG as release-gate.yml
    Note over Dev,P: Verify pass: feature work through every stage
    Dev->>Hook: CHANGELOG header dated (uncommitted)
    Hook->>PR: next prompt: "run prepare-release"
    PR->>Dev: apply npm, Python, layer, schema updates; run tests; check allow-list
    Note over Dev,P: Prepare pass: commit allowed files, promote through every stage
    P->>GH: push main to github remote, publish vX.Y.Z
    GH->>RG: release: published
    RG-->>GH: semantic drift → return release to draft
```

### Rollout order

1. Protocol fixes with their tests, verifier, fake server, and docs (sections 1 to 4, 20, 21, 17, 18), on `dev`.
2. Vendored schemas, helpers, conformance tests, dependencies (sections 5 to 10).
3. Scripts, skills, hook, workflow, and release docs (sections 11 to 16).
4. One promotion to `test`: Build runs the conformance tests, PostDeploy runs the tightened verifier. Then connect a client to `test`, then promote.

The workflow takes effect only once it reaches GitHub `main`, with the v0.0.7 release.

## Components and edits

`RF` means `application-infrastructure/src/lambda/read-function`. `PV` means `application-infrastructure/tests/postdeploy-verify`. `BS` means `application-infrastructure/build-scripts`. Re-find every cited line by its text when editing.

### 1. Router error fix (Requirement 1)

File: `RF/utils/json-rpc-router.js`. Two return statements change here; sections 20 and 21 add the id and notification changes.

Add one constant near `STANDARD_HEADERS`:

```javascript
/**
 * HTTP status for the protocol errors whose schema definitions state one.
 *
 * >! The MCP 2026-07-28 schema says UnsupportedProtocolVersionError (-32022) and
 * >! HeaderMismatchError (-32020) MUST be sent with "400 Bad Request" over HTTP,
 * >! and the 2025-06-18 and 2025-11-25 transports say the same for an unsupported
 * >! MCP-Protocol-Version. Every other JSON-RPC error keeps HTTP 200.
 *
 * @constant {number}
 */
const PROTOCOL_ERROR_HTTP_STATUS = 400;
```

The header-mismatch branch (step 4) uses it:

```javascript
      if (headerErr) {
        return buildResponse(PROTOCOL_ERROR_HTTP_STATUS, MCPProtocol.jsonRpcError(
          id, headerErr.code, headerErr.message, headerErr.data
        ));
      }
```

The unsupported-revision branch uses it and the schema's key names:

```javascript
      if (!decision.accepted) {
        return buildResponse(PROTOCOL_ERROR_HTTP_STATUS, MCPProtocol.jsonRpcError(
          id,
          MCPProtocol.JSON_RPC_ERRORS.UNSUPPORTED_PROTOCOL_VERSION,
          'Unsupported protocol version',
          {
            // >! Key names from UnsupportedProtocolVersionError (2026-07-28 schema):
            // >! "requested" is what the client declared, "supported" what it may retry with
            requested: declaredRevision,
            supported: decision.supportedVersions
          }
        ));
      }
```

`routes/index.js:46-48` already copies the status into the cache-data `Response`, and cache-data adds `Cache-Control: max-age=300` to a 4xx. That header is harmless here: `/mcp/v1` is POST only, and CloudFront's `/mcp/*` behavior uses `Managed-CachingDisabled` (PLAN Section 3). `mcp-era.js` and `negotiateProtocol()` are unchanged. The JSDoc of `handleJsonRpc` gains a line listing the two 400 cases.

### 2. Read Function tests for the fix (Requirement 2)

| File | Change |
|------|--------|
| `tests/integration/mcp-protocol-unsupported-version.test.js` | `send()` gains an `expectedStatus` argument (default 200). The `-32022` cases pass 400 and assert `error.data.requested`, `error.data.supported`, and `not.toHaveProperty('declaredRevision')` / `('supportedVersions')` on `error.data`. New cases: `initialize` with an unlisted header revision gets 400 and the new keys; `server/discover` with an unlisted declared revision gets 200 and no `error` |
| `tests/integration/mcp-protocol-header-validation.test.js` | The `-32020` cases expect status 400; the accepted-request cases keep 200 |
| `tests/unit/utils/mcp-era.test.js`, `json-rpc-router*.test.js` | Any assertion of status 200 or of the old keys on a `-32022`/`-32020` answer changes. Found with `grep -n -E "32020\|32022\|HEADER_MISMATCH\|UNSUPPORTED_PROTOCOL_VERSION"` plus the status assertions near each hit |

Tests that read `supportedVersions` from a `server/discover` result do not change.

### 3. Post-deploy verifier (Requirement 3)

File: `application-infrastructure/postdeploy-scripts/verify-deployment.js`.

Add, beside the other restated protocol values:

```javascript
/**
 * HTTP status the specification requires for -32022 and -32020.
 *
 * >! Restated from the MCP 2026-07-28 schema (UnsupportedProtocolVersionError,
 * >! HeaderMismatchError) on purpose; the verifier must not read Lambda code.
 */
const PROTOCOL_ERROR_STATUS = 400;
```

- **P3.** `ctx.request(buildRequest('P3a'), { status: PROTOCOL_ERROR_STATUS })`, and the same for P3b. In `judgeUnlisted`, `errorDataMember(..., 'requested')` replaces `'declaredRevision'`, with the reason `error.data.requested is <v>, expected "2099-01-01"`. P3.3 reads `'supported'`, with the reason `<label> response: error.data.supported is <v>, expected <list> (server/discover's list)`.
- **P4.** P4a, P4b, and P4d are requested with `{ status: PROTOCOL_ERROR_STATUS }`; P4c and P4e keep the default 200.
- **X2.** X2c and X2d are requested with `{ status: PROTOCOL_ERROR_STATUS }`.
- **Status failures.** A status mismatch fails through `gateExchange` with the existing reason `HTTP 200, expected 400; body: …`, so no new reason format is added.
- **JSDoc.** The JSDoc of `checkP3`, `checkP4`, and `checkX2`, and the `SUB_CHECK_ROWS` titles, are unchanged in ID and count. Only the descriptions change.

The `statusHint` of the P4 and X2 expectations stays as it is: a 200 result instead of an error still means the headers may not be reaching the function.

### 4. Fake server and verifier tests (Requirement 4)

File: `PV/helpers/fake-mcp-server.mjs`.

- Add `const PROTOCOL_ERROR_STATUS = 400;`, with a comment citing the schema.
- `answer(rpc)` becomes `answer(rpc, status = 200)` and returns `{ body: rpc, status, rpcMethod, toolName }`. The caller at the `respond(call, 200, headers, rpcBody)` line passes `routed.status`.
- The three `-32020` branches and the `-32022` branch pass `PROTOCOL_ERROR_STATUS`.
- The `-32022` branch's data becomes `{ requested: declaredRevision, supported: [...supportedVersions] }`.

Test changes:

| File | Change |
|------|--------|
| `PV/fake-mcp-server-tests.jest.mjs` | The `-32022` tests assert status 400, `requested`, and `supported`; the `-32020` tests assert 400; the edge cases the same. Remove the `declaredRevision`/`supportedVersions` pins (L336-L345, L703) |
| `PV/checks-tests.jest.mjs` | Rename the "lists supportedVersions in another order" case to `supported`. Add rows: P3.1 with status 200 (reason `^HTTP 200, expected 400`); P3.1 with `declaredRevision` in place of `requested` (reason `^error\.data\.requested is undefined, expected "2099-01-01"$`); P4.1 with status 200; X2.3 with status 200. Each row asserts that only its sub-check fails |

The fake has no per-request status override today. Its options include `mutate`, which replaces the body only, and fault options for 3xx, 429, and 5xx. Add `options.rpcStatus`:

- **Shape:** a function `(context) => number | undefined`, called with the same context as `mutate`.
- **Effect:** a returned integer replaces the status passed to `respond` for that JSON-RPC answer. Without the option, the healthy path is unchanged.
- **Test helper:** `checks-tests.jest.mjs` gets a `statusOverrides: [[REQ.P3a, 200]]` row field, mapped onto `rpcStatus` the same way the `mutations` field is mapped onto `mutate`.

### 5. Vendored schemas and provenance (Requirement 5)

Layout:

```text
application-infrastructure/tests/mcp-schemas/
├── PROVENANCE.md
├── 2024-11-05/schema.json
├── 2025-11-25/schema.json
└── 2026-07-28/schema.json
```

The files are created by the refresh script's write mode (section 11), not copied by hand, so the first run also exercises that path. The pinned commit is upstream `main`'s SHA at implementation time. The plan reviewed `d0e246ea3c69`; use the full 40-character SHA the script resolves.

`PROVENANCE.md`, generated and rewritten by the script:

````markdown
# Vendored MCP schemas

Test data. These files are byte-exact copies of the published MCP JSON Schemas, used
only by the conformance tests to check this server's responses. They are never deployed.
Do not edit them by hand; run `python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py --write --commit <sha>`.

| Field | Value |
|-------|-------|
| Source | https://github.com/modelcontextprotocol/modelcontextprotocol |
| Path | `schema/<revision>/schema.json` |
| Commit | `<40-hex sha>` |
| Retrieved | `YYYY-MM-DD` |

| Revision | sha256 |
|----------|--------|
| 2024-11-05 | `<64-hex>` |
| 2025-11-25 | `<64-hex>` |
| 2026-07-28 | `<64-hex>` |

## License and attribution

<upstream LICENSE text at the pinned commit, quoted verbatim, including its
MIT-to-Apache-2.0 transition statement>
````

The sha256 table rows have the fixed form `| <rev> | \`<hex>\` |`, so the integrity test can parse them with one regular expression.

### 6. Validator helpers and strict overlay (Requirements 6, 7)

Files: `RF/tests/helpers/mcp-schema-validator.js` (CommonJS) and `PV/helpers/mcp-schema-validator.mjs` (ESM). They have the same logic, about 150 lines each. They are duplicated on purpose, because the packages are self-contained (D12).

```javascript
/**
 * Validate values against the vendored MCP schemas (test helper).
 *
 * validate()       — against the published schema.
 * validateStrict() — against an in-memory overlay that also rejects property
 *                    names the schema does not declare.
 */
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const AjvDraft07 = require('ajv');
const addFormats = require('ajv-formats');

const SCHEMA_DIR = path.resolve(__dirname, '../../../../../tests/mcp-schemas');

/** Properties whose subtrees stay open: arbitrary JSON Schema, arbitrary JSON, declared extension points. */
const OPEN_PROPERTIES = Object.freeze(['inputSchema', 'outputSchema', 'structuredContent', 'experimental', 'extensions']);
/** Definitions that stay open: the specification's own catch-alls. */
const OPEN_DEFINITIONS = Object.freeze(['Result', 'JSONObject']);
/** Keywords whose values are data, not subschemas, and are never walked. */
const DATA_KEYWORDS = Object.freeze(['const', 'enum', 'default', 'examples']);

const cache = new Map(); // `${revision}:${strict}` -> Ajv instance

function loadSchema(revision) { /* read SCHEMA_DIR/<revision>/schema.json; throw if absent */ }
function draftOf(schema) { /* '2020-12' when $schema contains 2020-12, 'draft-07' when draft-07, else throw */ }

function buildStrictOverlay(schema) {
  const draft = draftOf(schema);
  const defsKey = draft === '2020-12' ? '$defs' : 'definitions';
  const closeKeyword = draft === '2020-12' ? 'unevaluatedProperties' : 'additionalProperties';
  const copy = structuredClone(schema);
  const allOfTargets = new Set();          // definition names referenced from an allOf member
  walk(copy, (node) => {
    if (Array.isArray(node.allOf)) {
      if (draft === 'draft-07') throw new Error('allOf in a draft-07 schema cannot be closed safely');
      for (const member of node.allOf) {
        if (typeof member.$ref === 'string') allOfTargets.add(member.$ref.split('/').pop());
      }
    }
  });
  for (const [name, def] of Object.entries(copy[defsKey])) {
    if (OPEN_DEFINITIONS.includes(name) || allOfTargets.has(name)) continue;
    close(def, closeKeyword, false);
  }
  return copy;
}

function close(node, keyword, isAllOfMember) {
  if (Array.isArray(node)) { node.forEach((n) => close(n, keyword, false)); return; }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (DATA_KEYWORDS.includes(key)) continue;
    if (key === 'properties') {
      for (const [prop, sub] of Object.entries(value)) {
        if (!OPEN_PROPERTIES.includes(prop)) close(sub, keyword, false);
      }
    } else if (key === 'allOf') {
      value.forEach((member) => close(member, keyword, true));
    } else {
      close(value, keyword, false);
    }
  }
  const alreadySet = 'additionalProperties' in node || 'unevaluatedProperties' in node;
  if (isAllOfMember || alreadySet) return;
  if (node.properties) node[keyword] = false;
  if (Array.isArray(node.allOf)) {
    node[keyword] = false;
    if (node.type === undefined) node.type = 'object';
  }
}

function getValidator(revision, definitionName, strict) { /* compile once per revision+strict; throw if definition missing */ }

function validate(revision, definitionName, value) { /* -> { valid, errors: [{ path, message, property }] } */ }
function validateStrict(revision, definitionName, value) { /* same, against the overlay */ }

module.exports = { validate, validateStrict, buildStrictOverlay, OPEN_PROPERTIES, OPEN_DEFINITIONS, SCHEMA_DIR };
```

Details:

- **Ajv options:** `{ allErrors: true, allowUnionTypes: true }`, with `addFormats(ajv)`. Strict mode stays at its default (on). Each revision and mode gets its own Ajv instance, so the published and strict copies never share a key.
- **Definition lookup:** `getValidator` resolves `m#/$defs/<name>` or `m#/definitions/<name>`. It throws `Unknown definition "<name>" in MCP schema <revision>` when `ajv.getSchema` returns `undefined`.
- **Error format:** each error carries `path` (`instancePath` or `/`), `message`, and `property` (from `params.unevaluatedProperty` or `params.additionalProperty`). Test failures then read like `2026-07-28 ListToolsResult (strict): /tools/0 must NOT have unevaluated properties [titel]`.
- **What is exported:** `buildStrictOverlay` is exported for the guard tests only. The helpers live under `tests/`, so nothing in a Lambda package reaches them.

`SCHEMA_DIR` in the ESM copy resolves from `import.meta.url` to the same directory.

### 7. Conformance test (Requirements 8, 9)

File: `RF/tests/integration/mcp-protocol-schema-conformance.test.js`.

The test calls `handleJsonRpc` with the existing `makeClientRequest` double pattern. A revision is declared with the `MCP-Protocol-Version` header, and the "no revision" case sends no header.

| Request | 2024-11-05 | 2025-11-25 | 2026-07-28 | No revision |
|---------|------------|------------|------------|-------------|
| `initialize` (`params.protocolVersion` = the column's revision; `2024-11-05` for "no revision") | `InitializeResult` | `InitializeResult` | n/a (no modern `initialize`) | `InitializeResult` (2024-11-05) |
| `tools/list` | `ListToolsResult` | `ListToolsResult` | `ListToolsResultResponse` | `ListToolsResult` (2024-11-05) |
| `tools/call` `list_tools` | `CallToolResult` | `CallToolResult` | `CallToolResult` | `CallToolResult` (2024-11-05) |
| `server/discover` | n/a | n/a | `DiscoverResultResponse` | `DiscoverResultResponse` (2026-07-28; discover is always modern) |

Notes on the matrix:

- **Envelope.** Where the result definition is used without a wrapper, the test also checks `jsonrpc === '2.0'` and that the response `id` equals the request `id`.
- **Catalog.** Because the Router builds the catalog from the declared revision, the `2025-11-25` and `2026-07-28` rows check `Tool.title` and `Tool.annotations`. This covers the F5 gap.
- **Choice of tool.** `list_tools` is the tool used because its controller (`controllers/tools.js`) reads only the catalog and needs no AWS client.

Errors, each produced through the Router:

| Code | How it is produced | Validated against | Status |
|------|--------------------|-------------------|--------|
| `-32700` (no `id`) | body `"{"` | `JSONRPCErrorResponse` on 2025-11-25 and 2026-07-28; 2024-11-05 a named exception (section 20) | 200 |
| `-32600` | `{ "jsonrpc": "1.0", "id": 1, "method": "tools/list" }` | the generic error definition of each revision | 200 |
| `-32600` (no `id`) | `{ "jsonrpc": "2.0", "id": null, "method": "tools/list" }`, and `"id": { "bad": true }` | as `-32700` | 200 |
| `-32601` | `{ "method": "no/such" }`, and `tools/call` with an unknown tool | generic, each revision | 200 |
| `-32602` | `tools/call` without `params.name` | generic, each revision | 200 |
| `-32603` | a ClientRequest double whose `addQueryLog` throws; the router's catch-all turns it into `-32603` | generic, each revision | 200 |
| `-32020` | `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method: tools/call` on a `tools/list` body | `HeaderMismatchError` (2026-07-28) | 400 |
| `-32022` | `MCP-Protocol-Version: 2099-01-01` on `tools/list` and on `initialize` | `UnsupportedProtocolVersionError` (2026-07-28) and `JSONRPCErrorResponse` (2025-11-25) | 400 |

The generic error definition is `JSONRPCErrorResponse` on `2026-07-28` and `2025-11-25`, and `JSONRPCError` on `2024-11-05`.

Notifications (section 21): `{ "jsonrpc": "2.0", "method": "notifications/initialized" }` on `2024-11-05`, `2025-11-25`, and with no revision declared. Each gets status 202 and an empty body. There is no schema definition for "no body", so the test asserts those two facts directly.

Every case runs `validate` and `validateStrict`. A failure message lists the case name, the revision, the definition, the check (`published` or `strict`), and each error line. The status assertions for `-32020` and `-32022` carry a comment citing the schema definitions' HTTP rule.

The test reads no network. It needs no `jest.mock` of cache-data, because `handleJsonRpc` is driven directly, as in `mcp-protocol-unsupported-version.test.js`.

### 8. Negative controls and guards (Requirement 10)

File: `RF/tests/unit/helpers/mcp-schema-validator.test.js`.

- **Negative controls on the published schema.** Each mutates a real formatter output (`MCPProtocol.toolsListResult(...)`, `discoverResult(...)`, `toolsCallResult(...)`) with a `JSON.parse(JSON.stringify())` copy and an edit, then expects `validate` to fail with the path named. The cases are the four listed in Requirement 10.1.
- **Negative controls on the strict overlay.** Each takes the same outputs, adds one misspelled property, and expects `validate` to pass and `validateStrict` to fail with that property named. The cases are the nine listed in Requirement 10.2.
- **Positive control.** A tool's `inputSchema` gains `additionalProperties: false` and an extra property definition with `pattern`, and still passes `validateStrict`.
- **Helper errors.** The helper throws `Unknown definition` and `No vendored MCP schema` for an unknown definition name and an unknown revision.
- **Overlay guard.** `buildStrictOverlay` throws on `{ $schema: 'http://json-schema.org/draft-07/schema#', definitions: { A: { allOf: [{}, {}] } } }`.

File: `RF/tests/unit/architecture/vendored-mcp-schemas.test.js`.

- **Integrity.** Parse `PROVENANCE.md` with `/^\| (\d{4}-\d{2}-\d{2}) \| `([0-9a-f]{64})` \|$/m` and require each listed file's sha256 to match. Also require that every vendored directory is listed, and every listed revision has a file.
- **Coverage.** Every entry of `SUPPORTED_PROTOCOL_VERSIONS` has `tests/mcp-schemas/<rev>/schema.json`.
- **Commit.** The commit field is a 40-character lowercase hexadecimal SHA.

### 9. Fake-server conformance (Requirement 11)

File: `PV/fake-mcp-server-schema-conformance.jest.mjs`. It starts the fake server the way `fake-mcp-server-tests.jest.mjs` does, sends the request kinds the fake models (the matrix rows of section 7 plus `-32020` and `-32022`), and runs `validate` and `validateStrict` per section 8's definitions. It also asserts the 400 status for `-32020` and `-32022`.

### 10. Dependencies (Requirement 12)

```bash
cd application-infrastructure/src/lambda/read-function
npm install --save-dev ajv@^8.20.0 ajv-formats@^3.0.1
npm run lint

cd ../../../tests/postdeploy-verify
npm install --save-dev --save-exact ajv@8.20.0 ajv-formats@3.0.1
```

A scratch install already showed that `eslint` keeps its nested `ajv` 6.15.0 and that the production set is unchanged (PLAN Section 2.1). `npm ls --omit=dev` before and after must print the same tree.

### 11. Refresh script (Requirement 13)

File: `BS/refresh_mcp_schemas.py`. It uses the standard library only (`argparse`, `hashlib`, `json`, `os`, `re`, `sys`, `urllib.request`, `datetime`, `pathlib`).

```text
usage: refresh_mcp_schemas.py [--ref REF] [--summary-file PATH]
       refresh_mcp_schemas.py --write --commit SHA [--summary-file PATH]
```

| Constant | Value |
|----------|-------|
| `UPSTREAM_REPO` | `modelcontextprotocol/modelcontextprotocol` |
| `API_COMMIT_URL` | `https://api.github.com/repos/{repo}/commits/{ref}` (header `Accept: application/vnd.github.sha`) |
| `API_LIST_URL` | `https://api.github.com/repos/{repo}/contents/schema?ref={sha}` |
| `RAW_FILE_URL` | `https://raw.githubusercontent.com/{repo}/{sha}/schema/{revision}/schema.json` |
| `SHA_PATTERN` | `^[0-9a-f]{40}$` |
| `REF_PATTERN` | `^(main\|[0-9a-f]{40}\|\d{4}-\d{2}-\d{2}(-RC)?)$` |
| `REVISION_PATTERN` | `^\d{4}-\d{2}-\d{2}$` |
| `TIMEOUT_SECONDS` | 20 |

**Report mode:**

1. Validate `--ref` and resolve it to a commit SHA through `API_COMMIT_URL`.
2. List the upstream `schema/` directories through `API_LIST_URL`, and keep the names that match `REVISION_PATTERN`.
3. For each vendored revision, download `RAW_FILE_URL` at the SHA and compare:
   - The same bytes are `unchanged`.
   - Otherwise, both sides are parsed and `strip_annotations()` removes every string-valued `description` and `$comment` key, recursively. A property *named* `description` has an object value and is kept. If the stripped forms are equal under `json.dumps(sort_keys=True)`, the result is a `text-only change`. Otherwise it is a `semantic change`.
4. Report upstream revisions that are not vendored as `new upstream revision (not vendored)`.

```text
refresh_mcp_schemas: upstream main = 0123abcd... (vendored commit d0e246ea...)
2024-11-05  unchanged
2025-11-25  text-only change
2026-07-28  semantic change
2027-03-01  new upstream revision (not vendored)
result: semantic change in 1 vendored revision (exit 1)
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | No difference, or only text-only changes and new revisions (each warned) |
| 1 | At least one semantic change |
| 2 | Usage or input error |
| 3 | Upstream unreachable, a non-200 answer, or a rate limit (HTTP 403 or 429 with `X-RateLimit-Remaining: 0`). Reported as `upstream unavailable: <reason>`, never as drift |

**Write mode:**

1. Validate `--commit` against `SHA_PATTERN`.
2. Download the three files and the upstream `LICENSE` at that commit, all before writing anything.
3. Write each file through a temporary file and `os.replace`.
4. Rewrite `PROVENANCE.md` from a template with the commit, today's date, the new sha256 values, and the license text.

The set of revisions to write is the set already vendored. Adding a revision is a deliberate act: create its empty directory first, so the script sees it. The script never touches `utils/mcp-protocol.js`.

**Network and input handling:**

- **Token.** When `GITHUB_TOKEN` is set, API requests send `Authorization: Bearer <token>`. Raw downloads never carry it. The token is never printed, and error messages print only the URL template, the revision, and the HTTP status.
- **No shell.** Nothing is passed to a shell. All URLs are built with `str.format` from the patterns above after validation.
- **`--summary-file`.** Also appends a Markdown table (revision, result) and the result line to the given path, which in Actions is `$GITHUB_STEP_SUMMARY`.

**Test** `BS/test_refresh_mcp_schemas.py` (`unittest`):

- **Setup.** The test injects a fake `fetch(url, headers)` that serves canned bytes per URL. It writes vendored files to a temporary directory through `--schema-dir`, a hidden test-only option with the real path as its default.
- **Cases.** Unchanged, text-only, semantic, new revision, unreachable, and rate-limited (with each exit code). Also: the token is sent to the API and not to raw downloads; write mode replaces files and rewrites the provenance; and an invalid `--commit` or `--ref` exits 2 before any fetch.

### 12. `update-mcp-schemas` skill (Requirement 14)

File: `.kiro/skills/update-mcp-schemas/SKILL.md`.

```markdown
---
name: update-mcp-schemas
description: Checks the vendored MCP JSON Schemas in application-infrastructure/tests/mcp-schemas against the upstream modelcontextprotocol repository and, when they differ, updates them and runs the conformance tests. Use when asked to update, refresh, or check the MCP schemas, the vendored schemas, or the schema pin, or when prepare-release runs it.
---
# Update the vendored MCP schemas
```

The skill body has these steps:

1. Run `python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py` and show the report.
2. Act on the exit code:
   - **0 with nothing changed:** report and stop.
   - **3:** report the upstream problem and stop.
   - **0 with a text-only change, or 1:** run `--write --commit <the SHA printed on the report's first line>`.
3. Run `npx jest` in `read-function` and `npm test` in `tests/postdeploy-verify`.
4. Report the changed files, the new pin, and the test results. On a failure, name the failing definitions and say that a server or fake-server change is needed. That change is a code change, which a prepare pass cannot carry.
5. On a new upstream revision, say that vendoring and advertising it is a separate change: create its directory, run write mode, add it to `SUPPORTED_PROTOCOL_VERSIONS`, and follow `docs/developer/mcp-protocol-sources.md`.

The skill never commits. It is listed in `.kiro/skills/README.md` under a new "Project-specific skills (not published)" table.

### 13. Detection script and hook (Requirement 15)

File: `BS/detect_release_transition.py`.

```python
HEADER_PATTERN = re.compile(r'^## \[v(\d+\.\d+\.\d+)\] \((unreleased|\d{4}-\d{2}-\d{2})\)', re.MULTILINE)
GIT_TIMEOUT_SECONDS = 2
REPO_ROOT = Path(__file__).resolve().parents[2]

PREPARE_MESSAGE = (
    "Release preparation: the top CHANGELOG.md version was just dated on dev. "
    "Run the prepare-release skill to apply package, layer, and schema updates "
    "before committing the prepare pass."
)
WRONG_BRANCH_MESSAGE = (
    "Release preparation: the top CHANGELOG.md version was dated on a branch other "
    "than dev. The release path dates the version on dev; see "
    "docs/developer/release-process.md."
)
```

The algorithm is a pure function, `decide(working_text, head_text, branch)`, that returns a message or `None`:

1. Find the first header in `working_text`. If it is missing or not dated, return `None`.
2. Find the header for the same version in `head_text`. If it is missing or not `unreleased`, return `None`.
3. Return `PREPARE_MESSAGE` on `dev`, and `WRONG_BRANCH_MESSAGE` otherwise.

`main()` reads the file and runs `git -C <REPO_ROOT> show HEAD:CHANGELOG.md` and `git -C <REPO_ROOT> rev-parse --abbrev-ref HEAD` through `subprocess.run([...], shell=False, capture_output=True, text=True, timeout=GIT_TIMEOUT_SECONDS, check=False)`. Any exception, timeout, or non-zero git exit means print nothing. It always exits 0, prints at most the one fixed message, and never prints file or git content.

Test `BS/test_detect_release_transition.py` covers `decide()` for every header-state and branch combination. It also runs `main()` against a temporary git repository (`git init`, commit an `unreleased` header, date it in the working tree), on `dev` and on another branch, and checks the failure cases of Requirement 15.5 by pointing `REPO_ROOT` at a temporary directory with no git repository.

The hook is created during implementation with Kiro's hook tool:

| Field | Value |
|-------|-------|
| id | `detect-release-transition` |
| name | Detect release-date edit |
| trigger | `UserPromptSubmit` |
| action | command: `python3 application-infrastructure/build-scripts/detect_release_transition.py` |
| timeout | 5 seconds |

### 14. `prepare-release` skill (Requirement 16)

File: `.kiro/skills/prepare-release/SKILL.md`.

```markdown
---
name: prepare-release
description: Prepares a release after the top CHANGELOG.md version has been dated on the dev branch. Applies package, Lambda layer, and MCP schema updates in the working tree, runs every test suite, and checks that only release-preparation files changed. Use when asked to prepare a release, when the release-date hook prompts for it, or after dating a CHANGELOG version.
---
# Prepare a release (prepare pass)
```

The skill body has these steps:

1. **Preconditions.** `git rev-parse --abbrev-ref HEAD` is `dev`. `git status --porcelain` shows only `CHANGELOG.md`, and `git diff -U0 CHANGELOG.md` changes only the top version header from `(unreleased)` to a date. Otherwise stop and list what else changed.
2. **Updates**, in order, each by activating the skill: `audit-update-npm-packages`, `audit-update-python-packages`, `update-lambda-layers`, `update-mcp-schemas`. Tell each to apply its updates and not to commit.
3. **Tests**, each with a timeout, per the test-execution steering:
   - for each `application-infrastructure/src/lambda/*/` and `src/lambda/layers/*/`: `npm test`;
   - `application-infrastructure/src/static`: `npm test`;
   - `application-infrastructure/tests/postdeploy-verify`: `npm test`;
   - `application-infrastructure/build-scripts`: `python3 -m unittest`.

   These are top-level commands, not tests that spawn tests.
4. **Allow-list.** Every path in `git diff --name-only` matches one of:
   - `CHANGELOG.md`;
   - `**/package.json` or `**/package-lock.json`;
   - `**/requirements*.txt`;
   - `application-infrastructure/template.yml`;
   - `application-infrastructure/tests/mcp-schemas/**`.

   For `template.yml`, every hunk from `git diff -U0` must lie within the `Mappings:` section of the new file (between the `Mappings:` line and the next top-level key).
5. **Outcome.**
   - **On a test failure or an allow-list violation:** stop. Say that the prepare pass cannot carry code changes. Restore `CHANGELOG.md` to `(unreleased)` (show the command, do not run it), and do the fix in a verify pass.
   - **Otherwise:** summarize each update skill's changes. Then hand off: review `git diff`, commit, and merge `dev → test → beta → main`, confirming each stage, per `docs/developer/release-process.md`.

The skill never commits, pushes, or tags. It is listed in the README's project-specific table.

### 15. Release gate workflow (Requirement 17)

File: `.github/workflows/release-gate.yml`. Action versions are pinned at implementation. Resolve each action's latest release tag to a commit with `gh api repos/<owner>/<action>/commits/<tag> --jq .sha`, and record the tag in a comment.

```yaml
# Release gate: checks the vendored MCP JSON Schemas (application-infrastructure/tests/mcp-schemas)
# against upstream when a GitHub release is published. A semantic change returns the release to draft.
#
# Trigger follows @63klabs/cache-data's npm-publish.yml (release: published). Nothing is published
# from here: CodeCommit main already deployed this code to prod. Withdrawing the release only takes
# the release page out of public view until the schemas are refreshed through a new prepare pass.
# See docs/developer/release-process.md.
name: Release Gate

on:
  release:
    types: [published]

permissions:
  contents: read

jobs:
  schema-drift:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    outputs:
      drift: ${{ steps.refresh.outputs.drift }}
    steps:
      - uses: actions/checkout@<sha> # <tag>
      - uses: actions/setup-python@<sha> # <tag>
        with:
          python-version: '3.12'
      - name: Unit tests for the release scripts
        working-directory: application-infrastructure/build-scripts
        run: python3 -m unittest test_refresh_mcp_schemas test_detect_release_transition
      - name: Compare vendored schemas with upstream main
        id: refresh
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          set -uo pipefail
          status=0
          python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py \
            --ref main --summary-file "$GITHUB_STEP_SUMMARY" || status=$?
          if [ "$status" -eq 1 ]; then echo "drift=true" >> "$GITHUB_OUTPUT"; else echo "drift=false" >> "$GITHUB_OUTPUT"; fi
          exit "$status"

  withdraw-release:
    needs: schema-drift
    if: failure() && needs.schema-drift.outputs.drift == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: write
    steps:
      - name: Return the release to draft
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          TAG: ${{ github.event.release.tag_name }}
        run: |
          set -euo pipefail
          gh release edit "$TAG" --draft=true
          {
            echo "### Release returned to draft"
            echo ""
            echo "A vendored MCP schema differs semantically from upstream. CodeCommit prod already serves this code;"
            echo "only the GitHub release page was withdrawn."
            echo ""
            echo "Fix: on dev, run the update-mcp-schemas skill, promote the change through test, beta, and main"
            echo "as a prepare pass, push main to GitHub, then publish the release again."
          } >> "$GITHUB_STEP_SUMMARY"
```

Notes:

- **No interpolation in `run:`.** Every `${{ }}` expression appears only in `env:`, `with:`, `outputs:`, or `if:`, never inside a `run:` script.
- **`gh`** is preinstalled on GitHub-hosted runners. `GH_REPO` saves a checkout in the second job.
- **Draft releases.** Workflows do not run when a draft is created, and `published` fires when a draft is published. Publishing again after a fix therefore re-runs the gate (GitHub "Events that trigger workflows", `release`).

### 16. Release-process page (Requirement 18)

File: `docs/developer/release-process.md`. Outline (headings and the facts each holds):

1. **`# Release process`.** One paragraph: a release takes two passes through `dev → test → beta → main`, then a GitHub release.
2. **`## Verify pass`.** Feature work on `dev`, merged up stage by stage. Every stage must pass Build, deploy, and PostDeploy (including the smoke verifier) before preparing. The page links to `DEPLOYMENT.md` for the merge commands.
3. **`## Prepare pass`.**
   1. On `dev`, change the top header `## [vX.Y.Z] (unreleased)` to `## [vX.Y.Z] (YYYY-MM-DD)` and save.
   2. On the next prompt, Kiro asks to run `prepare-release`. Run it by hand if the hook did not fire.
   3. Review its summary. Commit only the allowed files, using the allow-list table.
   4. Merge through `test`, `beta`, and `main`, confirming each stage passes.
   5. If any other code change is needed, abandon the pass: restore `(unreleased)`, fix in a verify pass, and start again.
4. **`## Publish on GitHub`.** `git push github main`, then create release `vX.Y.Z` against `main` with the CHANGELOG section as its notes, and publish. The release gate runs. If it returns the release to draft, follow its summary, then publish again.
5. **`## Start the next cycle`.** Add `## [vX.Y.Z+1] (unreleased)` on `dev`.
6. **`## What each gate stops`.** A table:

| Gate | Runs | Checks | Can stop | Cannot stop |
|------|------|--------|----------|-------------|
| Conformance tests | Build stage, every pipeline | Server responses against the vendored schemas | A deploy on any stage | Upstream drift after the schemas were vendored |
| Smoke verifier | PostDeploy, every pipeline | The deployed stage, including `-32022`/`-32020` status and keys | Promotion to the next stage | A misreading it shares with the fake server (the fake conformance test covers that) |
| Hook and `prepare-release` | `dev`, when the version is dated | Pending updates, all tests, the allow-list | A prepare pass that carries code changes | A date edited and committed outside Kiro |
| Release gate | GitHub, on publish | Vendored schemas against upstream `main` | The public release page | The deployment: `prod` already runs the code |

### 17. Protocol and verification documentation (Requirement 19)

| File | Edit |
|------|------|
| `docs/end-user/supported-protocol-revisions.md` | `-32022` example `data` becomes `{ "requested": "2099-01-01", "supported": [...] }`. The sentence "Both come back with HTTP status `200` …" becomes: "`-32022` and `-32020` come back with HTTP status `400 Bad Request`, as the specification requires; every other error from this server uses `200`, with the error in the JSON-RPC body." The `server/discover` tip is kept |
| `ARCHITECTURE.md` | The "Header or `_meta` declaration" bullet names `data.requested` and `data.supported` and the 400 status. The flow diagram's `-32020`/`-32022` lines add "(HTTP 400)" |
| `docs/admin-ops/post-deploy-verification.md`, `docs/developer/post-deploy-verification.md` | P3, P4, and X2 rows say "HTTP 400". The P3 row names `supported`. Ranges and counts are unchanged |
| `docs/developer/mcp-protocol-sources.md` | New section "Published schemas and conformance tests": the vendored directory and `PROVENANCE.md`; `validate` and `validateStrict`; overlay rules and how to extend the open list; running the refresh script and the `update-mcp-schemas` skill; steps to add a revision's schema when advertising one; the release gate, linking `release-process.md`; and the limit that a passing run does not prove a given client accepts a response. The "Behavior that is easy to get wrong" list gains "`-32022` and `-32020` use HTTP 400" |
| `docs/developer/README.md` | Link to `release-process.md` |
| `DEPLOYMENT.md` | After the merge section, one sentence and a link to `docs/developer/release-process.md` |
| `CONTRIBUTING.md` | One line linking the release-process page for maintainers |
| `.kiro/skills/README.md` | New table "Project-specific skills (not published)" with `update-mcp-schemas` and `prepare-release` |

### 18. Spec history (Requirement 20)

| File | Edit |
|------|------|
| Smoke `requirements.md` | Requirement 6.2: HTTP 400, `error.data.requested`, `error.data.supported`. Requirement 6.3 items 1, 2, 4 and Requirement 9.6: "expecting `-32020` with HTTP 400" |
| Smoke `design.md` | P3.1, P3.2: "HTTP 400; `error.code` is `-32022`; `error.data.requested` is `2099-01-01`". P3.3: `error.data.supported`. P4.1, P4.2, P4.4, X2.3, X2.4: prefix "HTTP 400;" |
| Dual-era `design.md` | Where the `-32022` data is described: `requested`/`supported`, HTTP 400, and a note "Corrected 2026-11-01 by `0-0-7-schema-validation-of-modern-results`: key names and status now follow the published schema." |
| Dual-era `TODO-MANUAL-VERIFY.md` | D1/D2 `jq` checks use `.error.data.requested` and `(.error.data.supported \| length) == 3`. D3 becomes "The error is returned with HTTP status `400`" with `Expect HTTP 400.` E1, E2, E4 gain a status check using the file's existing `curl -i` pattern |

### 19. Changelog (Requirement 21)

In the existing Added bullet of the dual-era entry, change only "with the revision the client declared and the full `supportedVersions` list in `error.data`" to "with the revision the client declared (`requested`) and the supported revisions (`supported`) in `error.data`".

New **Fixed** entry:

```markdown
- **`-32022` and `-32020` did not follow the published schema** [Spec: 0-0-7-schema-validation-of-modern-results](../.kiro/specs/0-0-7-schema-validation-of-modern-results/) - The `-32022` error carried `declaredRevision` and `supportedVersions`; the 2026-07-28 schema requires `requested` and `supported`, so a client following it could not read the revisions to retry with. Both `-32022` and `-32020` were returned with HTTP 200; the specification requires `400 Bad Request`
  - `-32022` now carries `requested` and `supported`, and both errors return HTTP 400. Every other error still returns HTTP 200
  - An error for a request whose `id` could not be read (a parse error, for example) no longer carries `id: null`, which no MCP schema accepts; it carries no `id`, as the 2025-11-25 and 2026-07-28 schemas allow. A request whose `id` is not a string or an integer now gets `-32600` instead of a result with `id: null`. The 401 invalid-key body also drops `id: null`
  - Notifications (a message with no `id`, such as `notifications/initialized`) now get HTTP 202 with no body, as the Streamable HTTP transport requires, instead of `-32601`
  - The post-deploy verifier's P3, P4, and X2 checks now require the new keys and HTTP 400. Sub-check IDs and counts are unchanged
```

New **Added** entry:

```markdown
- **Schema conformance tests and release preparation** [Spec: 0-0-7-schema-validation-of-modern-results](../.kiro/specs/0-0-7-schema-validation-of-modern-results/) - Every response shape the server emits is now checked against pinned copies of the published MCP schemas (`2024-11-05`, `2025-11-25`, `2026-07-28`), in the Build stage
  - Each check runs twice: against the published schema, and against a strict overlay that rejects property names the schema does not declare, so a misspelled optional field fails
  - The fake server used by the post-deploy verifier's tests is checked against the same schemas
  - `build-scripts/refresh_mcp_schemas.py` and the `update-mcp-schemas` skill report and apply upstream schema changes
  - The `prepare-release` skill, started by a Kiro hook when the top `CHANGELOG.md` version is dated on `dev`, applies package, layer, and schema updates and checks that the prepare pass carries nothing else
  - `.github/workflows/release-gate.yml` returns a published GitHub release to draft when a vendored schema has drifted semantically from upstream
  - New documentation: [release process](docs/developer/release-process.md), and a schema section in [MCP protocol sources of truth](docs/developer/mcp-protocol-sources.md)
```

### 20. Errors without a known request `id` (Requirement 24, Q10 = A)

**Formatter.** File `RF/utils/mcp-protocol.js`:

```javascript
function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  // >! MCP 2025-11-25 and 2026-07-28 declare JSONRPCErrorResponse.id as optional
  // >! (id?: RequestId, a string or an integer). When the request's id could not be
  // >! read, the error carries no id at all, never id: null.
  const response = { jsonrpc: '2.0' };
  if (id !== null && id !== undefined) {
    response.id = id;
  }
  response.error = error;
  return response;
}
```

`jsonRpcSuccess` is unchanged. The JSDoc example for a parse error changes to show no `id`.

**Router, invalid `id` (D23).** In `handleJsonRpc`, step 2 becomes the following. A float id passes `typeof` but fails `Number.isInteger`, which matches the schema's `integer`.

```javascript
    // --- Step 2: Extract id early ---------------------------------------------
    // >! body may be any JSON value; a non-object is rejected by the envelope check in step 3
    const hasId = body !== null && typeof body === 'object' && Object.hasOwn(body, 'id');
    id = extractId(body.id);
```

Step 3 gains a check after the envelope check:

```javascript
    // >! MCP 2025-11-25 and 2026-07-28: "Requests MUST include a string or integer ID".
    // >! A present but invalid id is an invalid request; an absent id is a notification (step 4b).
    if (hasId && id === null) {
      return buildResponse(200, MCPProtocol.jsonRpcError(
        null,
        MCPProtocol.JSON_RPC_ERRORS.INVALID_REQUEST,
        'Invalid Request',
        { details: 'The "id" must be a string or an integer' }
      ));
    }
```

`extractId` changes from `typeof rawId === 'number'` to `Number.isInteger(rawId)`.

This check runs before step 4, so a request with an invalid `id` is rejected even on `server/discover`. Under JSON-RPC that request cannot be answered with a usable id anyway.

**401 body (D24).** `RF/utils/auth-resolver.js:310-318` drops `id: null` from the object it serializes. `PV/helpers/fake-mcp-server.mjs` (the `INVALID_API_KEY` answer) does the same. Verifier S1 asserts only the 401 status, so no sub-check changes.

**Tests that change:**

| File | Change |
|------|--------|
| `tests/unit/utils/mcp-protocol-jsonrpc.test.js` (L58, L126, L204, L289) | `expect(response).not.toHaveProperty('id')` |
| `tests/unit/utils/json-rpc-router.test.js` (L249, L261) | the same |
| `tests/integration/mcp-protocol-compliance.test.js` (L251) | the same |
| `tests/property/error-codes.property.test.js` (L108) | the same |
| `tests/property/json-rpc-envelope.property.test.js` (L142) | the error half only; the success half (L136) stays |
| `tests/integration/mcp-protocol-discover-no-auth.test.js` (L162) | `id: { bad: true }` now expects `error.code` `-32600` and no `id` |
| `PV/fake-mcp-server-tests.jest.mjs` (L449) and the fake's `-32700` answer | no `id` |

`tests/unit/utils/mcp-protocol-discover.test.js:136` (`discoverResult(null)`) tests the formatter, not the router, and stays.

**New Router tests** (in `json-rpc-router.test.js`):

- An `id` of `null`, `{}`, `true`, or `1.5` gets `-32600` with no `id`.
- An `id` of `7` or `"abc"` is echoed.
- `-32700` has no `id`.

**Conformance.** The no-`id` errors are validated against `2025-11-25` and `2026-07-28` (section 7). The test names the `2024-11-05` exception in a constant with this comment:

```javascript
// >! 2024-11-05's JSONRPCError requires "id" (string or integer). An error for a request
// >! whose id could not be read has none, so no conformant 2024-11-05 form exists.
// >! The later revisions made the id optional for exactly this case.
const NO_ID_ERROR_REVISIONS = Object.freeze(['2025-11-25', '2026-07-28']);
```

### 21. Notifications (Requirement 25, Q11 = A)

**Router.** File `RF/utils/json-rpc-router.js`. After step 4 (the era, the header check, and the revision check), add:

```javascript
    // --- Step 4b: Notifications -----------------------------------------------
    // >! A JSON-RPC message with no id member is a notification. The 2025-11-25
    // >! Streamable HTTP transport: an accepted notification MUST get "202 Accepted"
    // >! with no body. Header and revision errors above still apply to it.
    if (!hasId) {
      return { statusCode: 202, headers: { ...STANDARD_HEADERS }, body: '' };
    }
```

The method is already in the request log from step 3 (`addQueryLog('m:<method>')`). Because steps 3 and 4 come first, a notification with an unlisted revision gets `-32022` (400, no `id`), and a modern notification with a mismatched `Mcp-Method` gets `-32020` (400, no `id`).

**Routes.** File `RF/routes/index.js`:

```javascript
    response.setStatusCode(jsonRpcResponse.statusCode);
    // >! A notification's 202 has no body; JSON.parse('') would throw
    response.setBody(jsonRpcResponse.body === '' ? null : JSON.parse(jsonRpcResponse.body));
```

cache-data's `finalize()` keeps a `null` body as `null`, so API Gateway returns an empty body. The `Content-Type` header from `STANDARD_HEADERS` still goes out. That is harmless with no body, and it keeps the router's header handling uniform. cache-data also adds `Cache-Control: max-age=3600` to a 202, which is harmless for a POST that CloudFront does not cache.

**Tests:**

| File | Cases |
|------|-------|
| `json-rpc-router.test.js` | `notifications/initialized`: 202, `body === ''`. Unknown notification method: 202. Notification with `MCP-Protocol-Version: 2099-01-01`: 400, `-32022`, no `id`. Modern notification with `Mcp-Method` disagreeing: 400, `-32020`, no `id` |
| `tests/unit/routes/routes-mcp-v1.test.js` | Router returns `{ statusCode: 202, body: '' }`: `response.setStatusCode(202)` and `response.setBody(null)` are called, and `JSON.parse` is not reached |
| Conformance test | Section 7, notifications paragraph |

The verifier and fake server are unchanged (Requirement 25.8).

**Docs.**

- `ARCHITECTURE.md`: the request-flow section gains "A message with no `id` is a notification: after the header and revision checks it gets HTTP 202 with no body."
- `docs/end-user/supported-protocol-revisions.md`: one sentence under the error table.
- `docs/developer/mcp-protocol-sources.md` "Behavior that is easy to get wrong": two bullets. One says an absent `id` is a notification (202). The other says an invalid `id` is `-32600` with no `id`.

## Verification design

### V-A: Test suites (Requirement 22.1)

```bash
# Check for stray test processes before starting (test-execution steering)
ps aux | grep -E "jest" | grep -v grep

# Read Function: new and changed files first, then the whole suite with timing
cd application-infrastructure/src/lambda/read-function
timeout 300s npx jest tests/unit/helpers tests/unit/architecture/vendored-mcp-schemas.test.js \
  tests/integration/mcp-protocol-schema-conformance.test.js \
  tests/integration/mcp-protocol-unsupported-version.test.js tests/integration/mcp-protocol-header-validation.test.js
/usr/bin/time -p timeout 900s npx jest
npm run lint

# Verifier package (its test script calls the Jest binary directly)
cd ../../../tests/postdeploy-verify
timeout 600s npm test

# Python
cd ../../build-scripts
timeout 120s python3 -m unittest test_write_release_version test_refresh_mcp_schemas test_detect_release_transition
```

Record the Read Function suite time before the change (on the unchanged tree) and after it (Requirement 22.2).

### V-B: Red-green checks (not committed)

Each is done once by hand and reverted.

1. **Server against the schema.** Revert the `-32022` data keys alone. The conformance test fails on `UnsupportedProtocolVersionError` with `requested` and `supported` named.
2. **Status.** Set `PROTOCOL_ERROR_HTTP_STATUS` to 200. The conformance test, the integration tests, and the fake-backed P3 and P4 rows all fail.
3. **Strict overlay.** Add `nextcursor: null` to the modern `tools/list` result in `toolsListResult`. `validate` passes and `validateStrict` fails, naming `nextcursor`.
4. **Integrity.** Change one byte in a vendored file. The sha256 test fails and names the revision.
5. **Verifier first, fake second.** Change only the verifier's P3 expectations, and run the verifier tests against the unchanged fake: P3 fails with `HTTP 200, expected 400`. Then update the fake: all pass.

### V-C: Scripts and hook

1. **Refresh script, report mode.** Run `python3 application-infrastructure/build-scripts/refresh_mcp_schemas.py`. Expected: `unchanged` for all three, exit 0, right after vendoring.
2. **Refresh script, against a known difference.** Run `--ref` with the `2025-11-25` release tag. Expected: a report for `2025-11-25` of `semantic change` (the tag predates the `NumberSchema` fix) and exit 1. This proves the semantic comparison against real upstream data.
3. **Detection script.** In a scratch repository, check that `decide()` prints the prepare message on `dev`, the wrong-branch notice on `test`, and nothing after committing.
4. **Hook.** After creating it with Kiro's hook tool, date the header in the real `CHANGELOG.md` on `dev` without saving any other change. Send one prompt and confirm the message, then restore the header. This is done with the owner present, because it edits `CHANGELOG.md` briefly.

### V-D: Deployed stages (Requirement 22.3 to 22.5)

1. **`test`.** Promote through the normal flow. Build runs the conformance tests; PostDeploy runs the tightened verifier. Record the `VERIFY_REPORT` outcome: `passed`, with P3, P4, and P5 green and X2 skipped (no custom domain on `test`).
2. **Client.** Connect Kiro to `test` and confirm that the tools load. Capture the client log if they do not.
3. **`beta`.** Record X2.3 and X2.4 (advisory). Passing shows that a 400 passes through the stage's CloudFront distribution unchanged. The configuration check in PLAN Section 3 predicts that it does.

### V-E: Release gate (Requirement 22.6, 22.7)

1. Run `actionlint .github/workflows/release-gate.yml`, where it is available.
2. With the owner's go-ahead (the repository is public):
   1. Push a branch `release-gate-check` to the `github` remote whose vendored `2026-07-28/schema.json` has one `required` entry removed. This is a semantic change, and a test-only branch.
   2. Create pre-release `v0.0.0-gate-check` targeting that branch, and publish it.
   3. Expect `schema-drift` to fail with `drift=true`, `withdraw-release` to return it to draft, and the step summary to appear.
   4. Delete the release, the tag, and the branch.

   The workflow file must already be on the repository's default branch for `release` events to run it. So this check runs after v0.0.7 reaches GitHub `main`, or on a fork.

## Error handling and rollback of the change itself

- **A stage still on the old build.** Running the tightened verifier by hand fails P3 and P4 with `HTTP 200, expected 400`, which identifies the old build. Pipeline runs verify the deployed commit.
- **Gradual shift on `beta` and `prod`.** During the shift, `-32022` answers come in both shapes. PostDeploy runs only after the shift ends.
- **Revert.** Reverting the commit restores the old error shape and status. The tests, the vendored files, and the helpers are reverted with it. No data or infrastructure is involved.
- **Upstream outage at release time.** The gate's run goes red with `upstream unavailable`, and the release stays published. Re-run the workflow later from the Actions page.
- **A false semantic change** (an upstream refactor with no effect on validation). The release is withdrawn. `update-mcp-schemas` refreshes the pin, the conformance tests prove the server still passes, and a prepare pass ships the new pin. Fail closed is acceptable here, because the cost is a delay of the release page, not of the deployment.
- **The hook misfires.** It prints only fixed text and never blocks a prompt (exit 0 always). Deleting `.kiro/hooks/detect-release-transition.json` disables it.

## Security considerations

- **Third-party data in tests only.** The vendored schemas are read only by tests and the refresh script. They are never deployed, and their integrity is pinned by sha256.
- **Least privilege in GitHub Actions.**
  - The workflow default is `contents: read`. Only `withdraw-release` holds `contents: write`, and it runs only on real drift.
  - Actions are pinned to commit SHAs.
  - No `${{ }}` expression appears inside a `run:` script, and the tag reaches the shell through `env`.
  - `release` events need write access to raise.
- **Token handling.** `GITHUB_TOKEN` goes only to `api.github.com` requests, is never printed, and error messages print templates and statuses only.
- **Hook output is fixed text.** A crafted `CHANGELOG.md` cannot inject text into the agent's context. `git` is called without a shell, with timeouts.
- **Input validation.** The refresh script allow-lists the SHA, ref, and revision names before building any URL or path, and writes files atomically.
- **Error bodies.** `requested` echoes the client's declared revision as a JSON string, as `declaredRevision` did. No new data is exposed.
- **Notifications run nothing.** A notification is answered with 202 before dispatch, so no tool or controller runs for it. It is still authenticated and rate-limited in `index.js` before routing, exactly as requests are.
- **Invalid ids are rejected earlier.** A request with an invalid `id` stops at step 3, before dispatch. Today it runs to completion and is answered with `id: null`.
- **No new IAM, KMS, parameter, or production dependency.**

## Requirement traceability

| Requirement | Design section |
|-------------|----------------|
| 1 Error fix | 1 |
| 2 Read Function tests for the fix | 2 |
| 3 Verifier | 3 |
| 4 Fake server and verifier tests | 4 |
| 5 Vendored schemas | 5 |
| 6 Validator helpers | 6 |
| 7 Strict overlay | 6 |
| 8 Definitions used | 7 |
| 9 Conformance test | 7 |
| 10 Negative controls and guards | 8 |
| 11 Fake-server conformance | 9 |
| 12 Dependencies | 10 |
| 13 Refresh script | 11 |
| 14 `update-mcp-schemas` | 12 |
| 15 Detection and hook | 13 |
| 16 `prepare-release` | 14 |
| 17 Release gate | 15 |
| 18 Release-process page | 16 |
| 19 Protocol and verification docs | 17 |
| 20 Spec history | 18 |
| 21 Changelog | 19 |
| 22 Verification and rollout | V-A to V-E |
| 23 Scope boundaries | "What is not designed here", 15 |
| 24 Errors without a known `id` | 20, 7 |
| 25 Notifications | 21, 7 |

## Implementation order

1. **Protocol fixes:** sections 1, 20, and 21 with their tests (section 2 and the tables in 20 and 21), then V-A for the Read Function and V-B 1 and 2.
2. **Verifier side:** section 3 (the verifier first), then section 4 (the fake and its tests, including the fake's no-`id` changes from section 20), in the order of V-B 5.
3. **Checkpoint:** the Read Function suite and the verifier package pass before any conformance work starts.
4. **Dependencies (section 10),** then the refresh script and its test (section 11). Run write mode once to create `tests/mcp-schemas/` and `PROVENANCE.md` (section 5). Then V-C 1 and 2.
5. **Conformance tests:** helpers (section 6), conformance test (section 7), negative controls and guards (section 8), fake-server conformance (section 9). Then V-B 3 and 4.
6. **Detection script and its test (section 13).** Create the hook with Kiro's hook tool, then V-C 3 and 4.
7. **Skills (sections 12 and 14)** and the README table, after the in-progress skill renames are committed.
8. **Workflow (section 15),** with action SHAs resolved, then `actionlint`.
9. **Documentation, spec history, and changelog** (sections 16 to 19).
10. **Full suites (V-A),** then search the tree for `declaredRevision` and `supportedVersions` on error data outside history files.
11. **Hand-off.** The owner commits. Then V-D, then V-E after v0.0.7 reaches GitHub `main`.

## Open points carried into implementation

- **Other tests that assume `id: null` or a `-32601` for a notification** may exist beyond those listed in sections 20 and 21. After the change, run `grep -rn -E "toBeNull\(\)|notifications/" tests` in the Read Function and check each hit.
- **Line numbers** were read on 2026-11-01 at `dev` `3658616`; re-find each by text.
- **The fake server's new `rpcStatus` option** (section 4) follows the existing `mutate` option. Check how `checks-tests.jest.mjs` maps its `mutations` row field, and map `statusOverrides` the same way.
- **The pinned upstream commit** is whatever `main` resolves to when write mode first runs. If it is newer than `d0e246ea3c69`, re-run the conformance tests before anything else. They define the pin's acceptability, not this document.
- **Action versions** for `actions/checkout` and `actions/setup-python` are resolved to SHAs at implementation (section 15).
