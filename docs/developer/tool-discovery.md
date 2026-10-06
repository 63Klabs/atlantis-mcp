# Tool Discovery Enhancement — Developer Guide

How per-tool discovery metadata is declared and merged, and how index-time and query-time
tokenization stay in sync between the Read Lambda and the Doc Indexer. For the high-level
component view see the [architecture overview](../../ARCHITECTURE.md#tool-discovery-enhancement).

## Overview

Three mechanisms work together so an AI agent can find the right tool and the right
documentation without already knowing the exact term to use:

1. **Tool Metadata Registry** (`config/tool-metadata.js`) — one module declaring per-tool
   discovery metadata, fanned out to every surface that serves tool definitions.
2. **`utils/tool-catalog.js`** — the single place the tool manifest, extended descriptions,
   and registry metadata are merged into the served tool list.
3. **`search-common` Lambda Layer** — one normalization implementation shared by the Read
   Lambda (query-time) and the Doc Indexer (index-time), so the two sides can never diverge.

## Tool Metadata Registry

`config/tool-metadata.js` is the single source of truth for per-tool discovery metadata,
following the same registry pattern as `config/agent-asset-types.js`. It is keyed by tool
name:

```javascript
const TOOL_METADATA = {
  search_documentation: {
    title: 'Search Atlantis Documentation',
    annotations: { readOnlyHint: true, openWorldHint: false },
    category: 'documentation',
    keywords: ['caching', 'cache', 'ttl', 'cache-data', 'CacheableDataAccess', 'tutorial'],
    relatedTools: ['get_document', 'get_document_chunk'],
    whenToUse: 'The user asks how to do something on the Atlantis platform, or asks about @63klabs/cache-data.',
    whenNotToUse: 'You already have a filePath or hash from a previous result — call get_document instead.',
    examples: [
      { description: 'Narrow to one repository', arguments: { query: 'ttl', repository: 'cache-data' } }
    ]
  }
  // ... one entry per tool
};
```

Each entry declares a display `title`, behavioral `annotations`, a `category`, trigger
`keywords`, `relatedTools`, `whenToUse`/`whenNotToUse` guidance, and at least one structured
usage `example`. Every tool is annotated `readOnlyHint: true` and `openWorldHint: false`:
no tool in this server mutates state, and every tool reaches only this server's own S3/
DynamoDB storage at call time, never an open-ended external system.

`validateRegistry()` runs once at module load and throws when a tool in the manifest has no
registry entry, when an entry names a tool that does not exist, or when a required field is
missing — the same fail-fast posture `agent-asset-types.js`'s `validateRegistry()` already
uses, so a malformed registry fails Lambda cold start rather than serving an inconsistent
catalog.

### Fan-out

The registry exposes generator functions consumed exclusively through `tool-catalog.js`
(below) — nothing calls these directly from the router or controller:

| Function | Returns | Consumed by |
|----------|---------|-------------|
| `generateAnnotations(name)` | `annotations` for one tool, or `undefined` | `tool-catalog.js` |
| `generateTitles(name)` | `title` for one tool, or `undefined` | `tool-catalog.js` |
| `getDiscoveryBlock(name)` | `{ category, keywords, relatedTools, whenToUse, whenNotToUse, examples }`, or `undefined` | `tool-catalog.js` |

Changing a tool's metadata in the registry — adding a keyword, correcting a `whenToUse`
sentence — requires editing only `tool-metadata.js`. No edit to the router, controller, or
schema validator is needed for that change to reach every surface that serves tool
metadata.

## `utils/tool-catalog.js` — the single merge

Before this feature, the tool manifest's extended descriptions were merged into the served
tool list independently in two places: the `tools/list` branch of `utils/json-rpc-router.js`
and `controllers/tools.js`. `buildToolCatalog()` in `utils/tool-catalog.js` is now the
**only** place that merge happens; both call sites call it and nothing else:

```javascript
const { buildToolCatalog } = require('../utils/tool-catalog');

const tools = buildToolCatalog({ protocolVersion });
```

`buildToolCatalog(options)`:

- Starts from `settings.tools.availableToolsList` (the manifest) and returns a **new**
  derived array — it never mutates the manifest or any tool definition object.
- For each tool, the description is the extended description from
  `config/tool-descriptions.js` when present, falling back to the manifest's own
  description. The registry's discovery block (`category`/`keywords`/`relatedTools`/
  `whenToUse`/`whenNotToUse`/`examples`) is composed into that description's **text** —
  never emitted as separate wire/JSON fields, so it reaches the agent on every protocol
  revision without risking schema rejection on an older one.
- Includes `title`/`annotations` only when the negotiated protocol revision is known to
  permit them (currently none are, pending the companion `0-0-7-mcp-protocol-dual-era`
  spec's legality table); otherwise it omits them rather than emitting an invalid field.
- Returns tool definitions in the manifest's own (already stable) order, so identical
  inputs always produce identically ordered output.
- Applies no tier-based filtering — every tool is visible to every caller, including
  unauthenticated ones.

### Why `MCP_TOOLS` reference identity is untouched

`utils/mcp-protocol.js` exports `MCP_TOOLS` as a direct reference to
`settings.tools.availableToolsList`, and an existing property test asserts that identity.
`buildToolCatalog()` never mutates that array or its entries and always returns a newly
allocated array — it is a separate, additive, derived view. The raw `MCP_TOOLS` export and
its reference-identity test are untouched by this feature.

## `search-common` Lambda Layer

Normalization — turning a term or a query into the token(s) it should be indexed or looked
up under — previously existed as four separate copies in the Doc Indexer's extractors
(`markdown.js`, `cloudformation.js`, `jsdoc.js`, `python.js`) plus a fifth, divergent
implementation in the Read Lambda's `extractQueryKeywords()`. The divergence was not
cosmetic: the index side's minimum token length (2) and ~70-entry stop-word list differed
from the query side's (length > 2, 14 stop words), so tokens like `s3` and `v2` were written
to the index but never reachable by a query on the keyword path.

`layers/search-common/nodejs/normalize.js` replaces all five copies with one
implementation, following the `doc-ai-common` layer's precedent exactly — same
`ContentUri`/`Layers` wiring pattern, same `loadLayerModule`-style indirection with an
env-var path override for tests, same per-layer `package.json`/`jest.config.js` picked up
automatically by the existing buildspec layer loop (no buildspec change required for a new
layer directory).

```javascript
const { normalizeTerm, normalizeText, STOP_WORDS, MIN_TOKEN_LENGTH } = require('search-common');

// Index side (doc-indexer extractors) and query side (read-function doc-index.js)
// both call this — the token set can never diverge between the two.
const tokens = normalizeText('cache-data caching tutorial');
```

The Doc Indexer's four extractors delegate to the layer instead of keeping local copies
(`python.js` passes `splitUnderscore: true` to preserve its existing underscore-splitting
behavior). The Read Lambda's `models/doc-index.js` routes query-side tokenization through
the same module. Because the token set for any term always includes the term as written,
this is re-index tolerant: a query against an index built before the layer existed still
matches, and newly derived forms (hyphen components, suffix reduction) simply contribute
nothing extra until the next index build.

### Why a separate layer rather than extending `doc-ai-common`

`doc-ai-common` is attached unconditionally today and could mechanically hold this code,
but it is purpose-built for the optional Bedrock semantic-search feature (it bundles
`@aws-sdk/client-s3vectors` and is named for that purpose). Normalization is required by the
always-on keyword path regardless of whether semantic search is enabled, so it gets its own
layer rather than coupling the baseline keyword path to an AI-feature-specific module.

## Related documentation

- [Architecture: Tool Discovery Enhancement](../../ARCHITECTURE.md#tool-discovery-enhancement)
- [Admin-ops: Documentation Indexer](../admin-ops/documentation-indexer.md) — repository
  classification, per-type exclusions, and the corpus manifest byte budget
- [End-user: search_documentation reference](../end-user/tools/README.md#search_documentation)
- [Testing guide](testing.md)
