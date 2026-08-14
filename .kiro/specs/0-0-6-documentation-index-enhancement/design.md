# Design Document

Documentation Index Enhancement

## Overview

This design implements the eleven requirements in `requirements.md`. The work touches the
`doc-indexer` Lambda (how documents are chunked, scored, and written), the `read-function`
Lambda (the MCP `search_documentation` tool, a new `get_document` / `get_document_chunk` tool
pair, and the vector-store layer), and the supporting infrastructure/docs.

The guiding theme is **do less read amplification and store more useful metadata, without
breaking the existing response contract**. Every externally visible change is additive:
existing result fields keep their names and meanings, and the keyword path stays behaviorally
identical except for the additive improvements (populated `githubUrl`/`repositoryType`/
`namespace`, boundary-aware excerpts, `availableFilters`, and exact-phrase ranking).

Two structural decisions anchor the design:

1. **Content is stored per source file, keyed by a version-less file hash.** The current
   per-section body item (`content:{hash} / v:{version}:content`) is never read by any code
   path and is duplicated per index version. It is replaced by a single per-file `document:{fileHash}`
   item that holds the raw source file. This is simultaneously the storage reduction of
   Requirement 2 and the retrieval target of `get_document` (Requirement 6).

2. **The MCP server never fetches from GitHub.** `get_document` is a storage-only lookup. On a
   storage miss the server returns the file-level GitHub URL to the client and lets the client
   fetch, keeping shared GitHub rate limits safe (Requirement 6 rationale).

### Requirement → design section traceability

| Requirement | Primary design section(s) |
|-------------|---------------------------|
| R1 Batched metadata retrieval | 4.2 Batched reads |
| R2 Content keyed by hash only | 3.2 Document item; 4.1 Indexer writes |
| R3 Boundary-aware excerpts | 4.1.3 Excerpt builder |
| R4 Populate `githubUrl` | 4.1.4 Repo ref & URL; 3.1 Metadata item |
| R5 Populate `repositoryType`/`namespace` | 4.1.5 Repo classification; 3.1 |
| R6 `get_document` tool | 5 `get_document` design |
| R7 S3 Vectors only | 6 Vector-store consolidation |
| R8 Filter discoverability & push-down | 4.3 Facets, push-down, suggestions |
| R9 Exact-phrase ranking | 4.4 Query-time phrase boost |
| R10 Backward compatibility | 7 Backward compatibility |
| R11 Docs & tests | Testing Strategy (§9); 10 Documentation |

---

## Architecture

This design spans two Lambdas — the `doc-indexer` (write path) and the `read-function` (MCP
server / read path) — over a shared single-table DynamoDB `…-DocIndex` store and an S3 Vectors
index. The subsections below describe the current baseline and the target data flow. The DynamoDB
item shapes are detailed in [Data Models](#data-models); the per-Lambda component changes are in
[Components and Interfaces](#components-and-interfaces).

### 1. Current architecture (baseline)

```
doc-indexer (scheduled)                     read-function (MCP server, POST /mcp/v1)
  listRepositories                            JSON-RPC dispatch (json-rpc-router.js)
  download archive (release tag|branch)         tools/list  -> availableToolsList
  extract sections (1 per heading)              tools/call  -> TOOL_DISPATCH[tool]
  dedupe by hash                                   search_documentation
  write DynamoDB DocIndex table                       queryIndex (keyword)  |  vector query (semantic)
    content:{hash}/v:{ver}:metadata                   serial GetItem enrichment (N+1)
    content:{hash}/v:{ver}:content  (never read)      get_template / get_template_chunk (chunking)
    search:{keyword}/v:{ver}:{hash}
    mainindex / version:pointer / vector:*
```

Key baseline facts that shape the design (from source inspection):

- `models/doc-index.js` `queryIndex()` issues one `QueryCommand` per query keyword, then a
  **serial `GetItem` loop** (`limit*3` metadata reads); `getContentMetadataByHashes()` also
  loops serial `GetItem`s.
- `services/documentation.js` `buildResults()` produces the shared result shape for both keyword
  and semantic paths; `githubUrl`/`repositoryType`/`namespace` are read from metadata but the
  indexer never writes them, so they are always `null`.
- `extractors/markdown.js` builds `excerpt = body.substring(0, 200)` (hard cut) and hardcodes
  `type='documentation'`, `subType='guide'`.
- `index-builder.js` defines `SCORE_WEIGHTS.exactPhrase = 20` but `computeRelevanceScore()`
  never uses it.
- `layers/doc-ai-common/nodejs/vector-store.js` `createVectorStore()` dispatches a
  `STORE_REGISTRY` allowlist of `dynamodb` and `s3-vectors`; the `dynamodb` backend loads the
  whole corpus into Lambda memory and computes cosine in-process.
- `json-rpc-router.js` `handleToolsCall()` measures serialized results with `ContentSizer` and,
  for `get_template`/`get_agent_asset`, returns a truncated summary (`contentTruncated`,
  `totalChunks`, `retrievalHint`) when over `MCP_CONTENT_SIZE_THRESHOLD`; the full content is
  retrieved via a `*_chunk` tool backed by `ContentChunker`.

---

### 2. High-level data flow (target)

```
doc-indexer                                         read-function
  listRepositories(+customProperties, ref)            search_documentation
    -> repositoryType, namespace, ref                    queryIndex:
  extract sections (boundary-aware excerpt)                 QueryCommand per keyword (unchanged)
    -> excerpt, documentHash                                push-down type/subType on search entries
  build githubUrl (owner/repo/ref/filePath)                 BatchGetItem metadata (chunked 100)
  write DynamoDB DocIndex table                             exact-phrase boost (keyword) + re-sort
    content:{hash}/v:{ver}:metadata                         availableFilters + suggestions
      + githubUrl, repositoryType, namespace,            (semantic path: S3 Vectors only)
        documentHash                                        buildResults -> BatchGetItem enrichment
    document:{fileHash}/content   (raw file, no ver)     get_document / get_document_chunk
    search:{keyword}/v:{ver}:{hash} + type,subType          resolve -> document:{fileHash}
    mainindex / version:pointer                             storage hit -> content (+ chunking)
    (vector:* only via S3 Vectors)                          storage miss -> JSON-RPC error + githubUrl
```

---

## Data Models

Data-model changes to the single-table DynamoDB `…-DocIndex` store. The table keeps its
single-table `pk`/`sk` design, `PAY_PER_REQUEST`, and TTL on `ttl`.

### 3.1 Content metadata item (extended, additive)

`pk = content:{hash}`, `sk = v:{version}:metadata`

| Attribute | Status | Notes |
|-----------|--------|-------|
| `version`, `path`, `type`, `subType`, `title`, `excerpt`, `repository`, `owner`, `keywords`, `lastIndexed`, `ttl` | unchanged | as today |
| `githubUrl` | **new** | file-level `https://github.com/{owner}/{repo}/blob/{ref}/{filePath}` or `null` (R4) |
| `repositoryType` | **new** | `atlantis_repository-type` custom property or `null` (R5) |
| `namespace` | **new** | repo namespace or `null` (R5) |
| `documentHash` | **new** | `fileHash` pointer to the owning `document:{fileHash}` item (R6 resolution) |

`excerpt` remains a single stored field consumed identically by both retrieval paths (R3.4); its
generation changes (§4.1.3) but its storage location does not.

### 3.2 Document item (replaces the per-section content body item)

**Removed:** `pk = content:{hash}`, `sk = v:{version}:content` (per-section body, per-version,
never read).

**Added:** `pk = document:{fileHash}`, `sk = content` (version-less)

| Attribute | Notes |
|-----------|-------|
| `documentPath` | `{org}/{repo}/{filePath}` (file-level, no heading slug) |
| `content` | the **raw source file** text (full fidelity — code fences, front matter, pre-heading content) |
| `githubUrl` | file-level URL (same construction as metadata) or `null` |
| `repositoryType`, `namespace`, `repository`, `owner` | carried for `get_document` responses |
| `ttl` | refreshed to 7 days on every build (R2.2) |

Where `fileHash = hashContentPath({org}/{repo}/{filePath})` using the existing `lib/hasher.js`
(SHA-256 truncated to 16 hex). Because the key is derived from the file path only (not content)
and is version-less:

- Each build **upserts** the same `document:{fileHash}` with the latest content and a fresh TTL
  (R2.1, R2.2, R2.4).
- A file removed/renamed between builds stops being upserted and **expires via TTL** (R2.3) — no
  orphan-diff pass (R2, Q6).
- One item per file (not per section) is a net **storage reduction** versus today's per-section,
  per-version bodies.

> This is the pragmatic reading of Requirement 2: "content keyed by a version-less hash, written
> once, TTL self-healing." Keying by *file* hash (rather than *section* hash) is what makes
> `get_document`'s "entire source file" contract (R6.3) exact and lossless, and further shrinks
> storage. The per-section body item had no reader and is dropped rather than migrated.

### 3.3 Search keyword item (extended, additive)

`pk = search:{keyword}`, `sk = v:{version}:{hash}`

| Attribute | Status | Notes |
|-----------|--------|-------|
| `version`, `hash`, `relevanceScore`, `typeWeight`, `ttl` | unchanged | as today |
| `type`, `subType` | **new** | enables filter push-down before metadata fetch (R8.2) |

### 3.4 Items unchanged

`mainindex:{version}`, `version:pointer/active`, and the S3 Vectors index are unchanged in shape.
The DynamoDB `vector:{hash}` / `vectormanifest:{version}` items are no longer written (§6).

---

## Components and Interfaces

The change set touches a well-scoped set of components across the two Lambdas, the shared layer,
and infrastructure. This table is the index; each component's detailed interface changes are in the
numbered sections that follow (§4–§8).

| Component | File(s) | Interface / responsibility (change) |
|-----------|---------|-------------------------------------|
| Indexer writers | `doc-indexer/lib/dynamo-writer.js`, `lib/index-builder.js` | New `writeDocumentEntries(entries, version)`; extended metadata/search writes (§4.1) |
| Excerpt builder | `doc-indexer/lib/extractors/markdown.js` | `buildExcerpt(body)` boundary-aware excerpt (§4.1.3) |
| GitHub client | `doc-indexer/lib/github-client.js` | Ref capture, `buildGithubUrl({owner,repo,ref,filePath})`, `getRepositoryProperties(owner,repo,token)` (§4.1.4–4.1.5) |
| Search reads | `read-function/models/doc-index.js` | `batchGetMetadata(tableName,version,hashes)`, filter push-down, exact-phrase boost (§4.2–4.4) |
| Result assembly | `read-function/services/documentation.js` | `availableFilters` facets, `suggestions` nudge, batched enrichment (§4.2–4.3) |
| Document tools | `read-function/controllers/documentation.js`, `utils/json-rpc-router.js`, `config/settings.js` | `get_document` / `get_document_chunk` registration, dispatch, resolution (§5) |
| Vector store | `layers/doc-ai-common/nodejs/vector-store.js` | S3-Vectors-only factory (§6) |
| MCP tool metadata | `config/settings.js` (`availableToolsList`, `extendedDescriptions`) | Schema/description updates (§8) |

## 4. doc-indexer changes

### 4.1 Writes (`lib/dynamo-writer.js`, `lib/index-builder.js`)

#### 4.1.1 Document item writer
Add `writeDocumentEntries(entries, version)` that groups entries by `documentPath`, and writes one
`document:{fileHash}/content` item per file with the raw file text. The raw file text is captured
during extraction (the extractor already receives the full file `content`); `index-builder.js`
retains the full file body alongside the per-section entries so it can be written once per file.
De-duplicate by `fileHash` so a file with N headings writes one document item.

#### 4.1.2 Metadata writer
`writeContentEntries()` adds `githubUrl`, `repositoryType`, `namespace`, and `documentHash` to the
metadata item. `writeSearchKeywords()` adds `type` and `subType` to each search entry.

#### 4.1.3 Boundary-aware excerpt (R3) — `lib/extractors/markdown.js`
Replace `section.body.substring(0, MAX_EXCERPT_LENGTH)` with a `buildExcerpt(body)` helper:

1. **Prefer prose.** Scan the section body for the first line that is descriptive prose — skip
   leading markdown table rows (`/^\s*\|/`), table dividers (`/^\s*\|?\s*:?-{2,}/`), fenced code
   blocks (```` ``` ````), heading lines, and blank lines. Use the first prose paragraph as the
   excerpt source when one exists; otherwise fall back to the raw body (R3.2).
2. **Boundary trim.** Trim the chosen source to at most `MAX_EXCERPT_LENGTH` (200) characters at a
   sentence boundary if one exists at/near the limit, else at the last whitespace boundary at or
   before the limit — never mid-word (R3.1, R3.3). A small hard cap (e.g. 240) prevents runaway
   sentences.
3. The result is stored once on the metadata item (R3.4).

The read path's existing `(excerpt || '').substring(0, 200)` guard is changed to a boundary-safe
guard (or removed) so it cannot reintroduce a mid-word cut on an already-bounded excerpt (R3.5).

#### 4.1.4 Repository ref and `githubUrl` (R4) — `lib/index-builder.js`, `lib/github-client.js`
`processRepository()` already decides between a release archive and the default-branch archive.
Capture the **ref actually used**:

- release archive → `ref = release.tagName`
- default-branch archive → `ref = repo.defaultBranch`

Thread `ref` into the per-entry data so `buildGithubUrl({ owner, repo, ref, filePath })` can
produce `https://github.com/{owner}/{repo}/blob/{ref}/{filePath}` (file-level only; anchors out of
scope — R4.4). `filePath` here is the repo-relative file path (the `document:{fileHash}` component),
not the section contentPath. If `owner`, `repo`, `ref`, or `filePath` is unavailable, store `null`
and continue the build (R4.5). `getLatestRelease()` already returns the tag; expose `tagName` on
its result if not already present.

#### 4.1.5 Repository classification (R5) — `lib/github-client.js`
`listRepositories()` currently maps only `{ name, defaultBranch, owner }`. Add a
`getRepositoryProperties(owner, repo, token)` call to the GitHub custom-properties API
(`GET /repos/{owner}/{repo}/properties/values`) and read the `atlantis_repository-type` property
(the property name already lives in settings as `github.repositoryTypeProperty`). Map it to
`repositoryType`, and derive `namespace` from the available repo/property data. Both are stored on
the metadata and document items; when a property is absent, store `null` and continue (R5.4).
`repositoryType` values are expected within the recognized set (documentation, app-starter,
templates, package, mcp) but unrecognized/absent values are tolerated as `null` rather than
failing (R5.5). Custom-property fetches are best-effort and failure-tolerant (they must never fail
a build).

#### 4.1.6 `documentHash` on entries
`processRepository()` computes `entry.hash = hashContentPath(contentPath)` today. Add
`entry.documentHash = hashContentPath(documentPath)` where `documentPath = {org}/{repo}/{filePath}`
(the contentPath with the trailing `/{slug}` removed). This is written on the metadata item for
`get_document` resolution.

### 4.2 Batched reads in search (R1) — `read-function/models/doc-index.js`

Introduce a shared `batchGetMetadata(tableName, version, hashes)` helper:

- Build `content:{hash} / v:{version}:metadata` keys, chunk into groups of **100** (DynamoDB
  `BatchGetItem` limit), issue the batches (in parallel across chunks).
- On a response containing `UnprocessedKeys`, retry **only** the unprocessed keys with bounded
  attempts (e.g. up to 3) and exponential backoff; never loop unbounded (R1.3).
- Missing items are simply absent from the result map; callers omit those hits rather than failing
  the request (R1.5).

Refactor both enrichment paths to use it:

- `queryIndex()` — after ranking hashes and applying push-down filters (§4.3), fetch the top slice
  via `batchGetMetadata`, then **re-sort by score** to preserve pre-fetch ordering (R1.4).
- `getContentMetadataByHashes()` (used by `services/documentation.js` `buildResults()` for the
  semantic/assisted paths) — replace the serial loop with `batchGetMetadata` (R1.2), preserving
  the vector-rank order on return.

The per-keyword `QueryCommand` fan-out is unchanged (it is the inverted-index lookup, not the
amplification target).

### 4.3 Filter discoverability and push-down (R8) — `models/doc-index.js`, `services/documentation.js`

- **Push-down (R8.2):** `queryIndex()` filters the ranked hash set by `type`/`subType` using the
  new attributes on the `search:{keyword}` entries **before** the metadata `BatchGetItem`, so the
  metadata fetch reads fewer items. The resulting set is identical to today's post-fetch filtering;
  only the point at which filtering happens moves (R8.5).
- **Facets (R8.1):** After results are assembled, compute `availableFilters` = distinct `type` and
  `subType` values present in the matched set with counts, e.g.
  `{ "type": [{ "value": "documentation", "count": 22 }, …], "subType": [ … ] }`. Add it to the
  search envelope as an additive, optional field (R8.5, R10.2). Facets reflect the matched set
  (pre-limit) so the agent sees what it can narrow to.
- **Suggestions nudge (R8.4):** When `totalResults` exceeds a threshold, populate the existing
  `suggestions` array with a "narrow by `type`/`subType`" hint (today `suggestions` is used only
  for zero-result cases; this extends it without changing its type).
- **Schema/description (R8.3):** The `search_documentation` input schema enumerates the allowed
  `type` and `subType` values, and the tool description gains a short "refine with `type`/`subType`
  when results are broad" hint (§8).

> **Enum reconciliation (design note).** The stored `type` values are `documentation`,
> `template-pattern`, `code-example` and `subType` values include `guide`, `parameter`, etc.,
> whereas the current tool input `type` enum (`guide|tutorial|reference|troubleshooting|template
> pattern|code example`) does not match the stored values, so a `type` filter can silently exclude
> everything. The schema enum is corrected to the values actually stored/returned. This is
> backward-compatible: previously-passable values matched nothing, so no working client relies on
> them.

### 4.4 Query-time exact-phrase boost (R9) — `read-function` scoring

Exact-phrase matching depends on the query phrase, so it can only run at query time. In
**keyword mode only**, after `batchGetMetadata` enrichment, add a scoring pass over the already-
fetched top candidates:

- Normalize the full query phrase the same way keywords are normalized.
- If a candidate's `title` or `excerpt` contains the full phrase (case-insensitive), add an
  `EXACT_PHRASE_BOOST` to its `relevanceScore` (R9.1, R9.2).
- Re-sort by final `relevanceScore` descending before slicing to `limit` (R9.4).

`EXACT_PHRASE_BOOST` is defined in the read-function with the value `20` (matching the indexer's
`SCORE_WEIGHTS.exactPhrase`), so the previously-dead weight now has an actual effect (R9.3). The
indexer's unused `SCORE_WEIGHTS.exactPhrase` is removed (dead-code cleanup) since the boost is
inherently query-time. Semantic and semantic-assisted ranking (cosine/assist) are untouched
(R9.5).

---

## 5. `get_document` and `get_document_chunk` (R6)

### 5.1 Registration and dispatch

- Add `get_document` and `get_document_chunk` to `config/settings.js`
  `settings.tools.availableToolsList` (with descriptions and JSON input schemas) so they appear in
  both `tools/list` and the `list_tools` tool (R6.1).
- Add both to `TOOL_DISPATCH` in `utils/json-rpc-router.js`, mapped to a new
  `Controllers.Documentation.getDocument` / `getDocumentChunk` (R6.2). No new API Gateway path is
  added — dispatch is via the existing `POST /mcp/v1` JSON-RPC endpoint (R6.2), so
  `template-openapi-spec.yml` needs no new path (only a review — R11.6).
- Add JSON schemas to the `SchemaValidator` used by the documentation controller.

### 5.2 Input schema

```jsonc
// get_document
{
  "type": "object",
  "properties": {
    "filePath": { "type": "string", "description": "contentPath from a search result (…/{slug})" },
    "hash":     { "type": "string", "pattern": "^[0-9a-f]{16}$" }
  },
  "oneOf": [{ "required": ["filePath"] }, { "required": ["hash"] }]
}
// get_document_chunk
{
  "type": "object",
  "properties": {
    "filePath":   { "type": "string" },
    "hash":       { "type": "string", "pattern": "^[0-9a-f]{16}$" },
    "chunkIndex": { "type": "integer", "minimum": 0 }
  },
  "required": ["chunkIndex"]
}
```

Input is validated before any storage read; `hash` is constrained to 16 hex chars and `filePath`
is treated as an opaque lookup key (no shell/file-system use) per secure-coding practices.

### 5.3 Resolution algorithm (storage-only)

`get_document` accepts either a `filePath` (a section-level contentPath) or a section `hash`
(R6.4). Resolution (all reads against DynamoDB; **no GitHub fetch** — R6 rationale):

1. Read `version:pointer/active` for the active version (server-resolved; the caller never
   supplies a version — R2.4, R6).
2. Determine the section hash: `hash` input is used directly; a `filePath` input is hashed via
   `hashContentPath(filePath)`.
3. `GetItem content:{hash} / v:{version}:metadata`. This yields `documentHash` and `githubUrl`.
   - If the section metadata is missing, attempt a fallback: derive the document path by stripping
     the trailing `/{slug}` from `filePath` (when provided) and compute
     `fileHash = hashContentPath(documentPath)`.
4. `GetItem document:{fileHash} / content`.
   - **Hit:** return the document (§5.4), including `githubUrl` (R6.9).
   - **Miss:** return a JSON-RPC error carrying the `githubUrl` (from step 3 metadata when
     available) so the client can fetch directly; if no URL can be derived, the error still
     identifies the requested `filePath`/`hash` (R6.8).

`get_document` reads only DynamoDB and does not touch Bedrock or the vector store, so it functions
regardless of `EnableDocAi` or `DocAiRetrievalMode`, at the same public access level as keyword
`search_documentation` (R6.6). It is wrapped in `CacheableDataAccess.getData()` with a new
`document`/`doc-data` connection profile (mirroring the `template-chunks` pattern) for cache reuse.

### 5.4 Response shape and size-aware chunking (R6.7)

Success payload (before size handling):

```json
{
  "filePath": "63Klabs/atlantis-sam-templates/docs/.../README.md",
  "githubUrl": "https://github.com/63Klabs/atlantis-sam-templates/blob/<ref>/docs/.../README.md",
  "repository": "atlantis-sam-templates",
  "repositoryType": "documentation",
  "namespace": null,
  "content": "<raw file text>"
}
```

Size handling reuses the established `get_template` mechanism in `json-rpc-router.js`
`handleToolsCall()`:

- Extend the size-aware branch (currently keyed to `get_template`/`get_agent_asset`) to also
  handle `get_document`. When the serialized result exceeds `MCP_CONTENT_SIZE_THRESHOLD`, return a
  `buildDocumentSummary(...)` object with `{ filePath, githubUrl, repository, repositoryType,
  namespace, contentTruncated: true, totalChunks, retrievalHint }`, where
  `totalChunks = ContentChunker.chunk(serialized).length` and the hint instructs the caller to use
  `get_document_chunk` with `chunkIndex 0..totalChunks-1`.
- `get_document_chunk` mirrors `controllers/templates.js` `getChunk()`: it re-resolves the document,
  `JSON.stringify`s it, `ContentChunker.chunk`s it, validates `chunkIndex` (out-of-range →
  `INVALID_CHUNK_INDEX`), and returns `{ chunkIndex, totalChunks, filePath, content: chunks[idx] }`.
  It uses a `document-chunks`/`doc-chunk-data` cache profile.

### 5.5 Error model

| Condition | Result |
|-----------|--------|
| Invalid input (neither `filePath` nor `hash`, or malformed `hash`) | JSON-RPC `INVALID_PARAMS` |
| Document not in storage, URL derivable | JSON-RPC error identifying `filePath`/`hash` **with** `githubUrl` in error data (R6.8) |
| Document not in storage, no URL derivable | JSON-RPC error identifying `filePath`/`hash`, `githubUrl` null (R6.8) |
| `get_document_chunk` `chunkIndex` out of range | `INVALID_CHUNK_INDEX` (as `get_template_chunk`) |

The error uses the existing MCP/JSON-RPC error formatting in `utils/mcp-protocol.js`, with the
`githubUrl` placed in the error `data` object.

---

## 6. Vector-store consolidation on S3 Vectors (R7)

### 6.1 Code
- `layers/doc-ai-common/nodejs/vector-store.js`: reduce `STORE_REGISTRY` to `s3-vectors` only;
  `createVectorStore(config)` always returns `S3VectorStore`. Remove the `dynamodb` registry entry
  and stop lazy-requiring `vector-store-dynamodb.js`.
- Delete `vector-store-dynamodb.js` (removing the whole-corpus-into-Lambda cosine path — R7.3),
  and remove its `getVersionVectors()` usage from the indexer's embedding-reuse phase, replacing it
  with the S3 Vectors equivalent (`S3VectorStore.getVersionVectors()` already exists).
- Remove `vectorStore` from `documentation.ai` settings in both `read-function/config/settings.js`
  and `doc-indexer/lib/settings.js`, and stop reading `DOC_AI_VECTOR_STORE`.
- The semantic/assisted strategies and their keyword fallback are otherwise unchanged; embedding
  model, dimensions, and `topK` behavior are preserved (R7.4), and the existing keyword fallback on
  disabled/below-tier/error is retained (R7.6).

### 6.2 Infrastructure (`template.yml`)
- Remove the `DocAiVectorStore` parameter, its metadata group entry, and the `DOC_AI_VECTOR_STORE`
  environment variable from **both** the read-function and doc-indexer function definitions (R7.2).
- The S3 Vectors bucket/index resources, conditions, and IAM (already gated by `EnableDocAiIsTrue`)
  are unchanged.

### 6.3 Docs (R7.5) — covered in §10.

---

## 7. Backward compatibility (R10)

- **No field removed or renamed** in `search_documentation` result objects or the envelope
  (`title`, `excerpt`, `filePath`, `githubUrl`, `type`, `subType`, `relevanceScore`, `repository`,
  `repositoryType`, `namespace`, `totalResults`, `query`, `suggestions`, `partialData`). New
  additions (`availableFilters`, now-populated `githubUrl`/`repositoryType`/`namespace`) are
  additive/optional (R10.1, R10.2).
- **Keyword path parity.** When `EnableDocAi=false` or the caller is below `DocAiMinTier`, behavior
  is as today except for the additive improvements in R3, R4, R5, R8, R9 (R10.3). Filter push-down
  returns the same result set as today's post-fetch filtering (R8.5); exact-phrase boosting changes
  only ordering, never membership.
- **Cache isolation.** The existing `docAiMode` cache discriminator continues to isolate
  keyword/semantic/per-tier results. Because `DocAiVectorStore` is removed, the discriminator drops
  the `vectorStore` segment (from `${retrievalMode}|${vectorStore}|${tier}` to
  `${retrievalMode}|${tier}`). This is internal to the cache key and invisible to clients; stale
  keyed entries expire on the normal TTL.
- **Existing tools unchanged** except the additive `search_documentation` description/schema
  updates and the two new `get_document*` tools (R10.4).

### Rollout ordering
Indexer changes must run at least one build before `search`/`get_document` can return the new
stored fields; until then `githubUrl`/`repositoryType`/`namespace` remain `null` and `get_document`
returns storage-miss errors (with `null` URL) for not-yet-reindexed files. All read-side code
treats missing new attributes as `null`/absent, so the two Lambdas can deploy in either order
without breakage. The vector-store consolidation is independent and gated by `EnableDocAi`.

---

## 8. MCP tool metadata changes

- `search_documentation`: description gains the refine-with-filters hint; input schema `type`
  enum corrected to stored values and a `subType` enum added; both marked optional (R8.3, §4.3).
- `get_document`: new entry — description explains it returns the full source file from storage and
  that, on a storage miss, the response/error contains the GitHub URL for the client to fetch.
- `get_document_chunk`: new entry — describes incremental retrieval of a large document, mirroring
  `get_template_chunk`.

All three live in `settings.tools.availableToolsList`; `extendedDescriptions` (merged in
`tools/list`) is updated to match.

---

## Correctness Properties

These are the invariants the implementation must preserve; each is exercised by the tests in
[Testing Strategy](#testing-strategy).

- **Idempotent document upserts.** Re-running a build over unchanged file content produces the same
  `document:{fileHash}/content` item (same key, refreshed TTL); a file with N headings yields
  exactly one document item (R2.1, R2.4).
- **TTL self-healing.** A file no longer present in a build is never re-upserted and expires via its
  7-day TTL, with no orphan-diff pass (R2.3).
- **Order preservation under batching.** `batchGetMetadata()` may return items out of order and may
  omit missing keys, but callers re-sort by relevance score / vector rank, so the final ordering is
  identical to the pre-fetch ranking (R1.4).
- **Push-down membership equality.** Applying `type`/`subType` filtering before the metadata fetch
  yields exactly the same result set as today's post-fetch filtering — only the point at which
  filtering happens moves (R8.5).
- **Phrase boost affects order, not membership.** Exact-phrase boosting re-ranks already-selected
  keyword candidates; it never adds or removes results and never touches the semantic path
  (R9.4, R9.5).
- **Additive contract.** No `search_documentation` field is removed or renamed; new fields are
  optional and default to `null`/absent, so existing clients and either Lambda deploy order remain
  unbroken (R10.1, R10.2).
- **Lossless document round-trip.** For a large document, concatenating `get_document_chunk` outputs
  `0..totalChunks-1` reconstructs exactly the `JSON.stringify` of the full `get_document` payload
  (R6.7).
- **Storage-only resolution.** `get_document` reads only DynamoDB (no GitHub, Bedrock, or vector
  store) and behaves identically regardless of `EnableDocAi`/`DocAiRetrievalMode` (R6.6).

## Error Handling

Errors are handled so that a single failure degrades gracefully rather than failing an entire build
or request.

**doc-indexer (write path) — fail-soft enrichment**
- Missing `owner`/`repo`/`ref`/`filePath` → `githubUrl` stored as `null`; the build continues
  (R4.5).
- GitHub custom-property fetch failure or absent `atlantis_repository-type` → `repositoryType`/
  `namespace` stored as `null`; best-effort, never fails a build, and never logs the token
  (R5.4, R5.5).
- Extraction with no prose paragraph → `buildExcerpt` falls back to the raw body under the same
  boundary cap (R3.2).

**read-function (read path)**
- `batchGetMetadata` `UnprocessedKeys` → retry only the unprocessed keys with bounded attempts
  (≤3) and exponential backoff; never loop unbounded (R1.3).
- Metadata item missing for a ranked hash → that hit is omitted from results rather than failing the
  request (R1.5).
- Semantic retrieval error / below tier / `EnableDocAi=false` → the existing keyword fallback is
  retained (R7.6).

**`get_document` / `get_document_chunk` error model**

| Condition | Result |
|-----------|--------|
| Invalid input (neither `filePath` nor `hash`, or malformed `hash`) | JSON-RPC `INVALID_PARAMS` |
| Document not in storage, URL derivable | JSON-RPC error identifying `filePath`/`hash` **with** `githubUrl` in error `data` (R6.8) |
| Document not in storage, no URL derivable | JSON-RPC error identifying `filePath`/`hash`, `githubUrl` `null` (R6.8) |
| `get_document_chunk` `chunkIndex` out of range | `INVALID_CHUNK_INDEX` (as `get_template_chunk`) |

Errors use the existing MCP/JSON-RPC formatting in `utils/mcp-protocol.js`, with any `githubUrl`
placed in the error `data` object (§5.5). On a storage miss the client is expected to fetch the
returned URL itself, keeping shared GitHub rate limits safe.

## Testing Strategy

All new/changed behavior is covered by Jest tests (`*.jest.mjs`), run per-function. Tests never
invoke `npm test` recursively and mock AWS SDK calls (DynamoDB, GitHub, Bedrock/S3 Vectors) rather
than hitting live services.

**doc-indexer**
- `buildExcerpt`: prose-preference over leading tables/code, boundary trim, no mid-word/mid-table
  ending, hard-cap behavior (R3).
- `buildGithubUrl`: release-tag vs default-branch ref selection; `null` on missing inputs (R4).
- Repository classification: `atlantis_repository-type` mapped to `repositoryType`; namespace
  capture; `null`/failure tolerance (R5).
- Writers: `document:{fileHash}/content` written once per file (dedupe), version-less key, TTL
  refresh; metadata carries `githubUrl`/`repositoryType`/`namespace`/`documentHash`; search entries
  carry `type`/`subType` (R2, R4, R5, R8).

**read-function**
- `batchGetMetadata`: 100-key chunking; `UnprocessedKeys` bounded retry; missing items omitted;
  order preserved after re-sort (R1).
- Filter push-down: same membership as post-fetch filtering; fewer metadata reads when filtered
  (R8.2, R8.5).
- `availableFilters` facet counts; `suggestions` nudge on large `totalResults` (R8.1, R8.4).
- Exact-phrase boost: title/excerpt phrase match adds boost and re-orders; membership unchanged;
  semantic path unaffected (R9).
- `get_document`: resolution by `filePath` and by `hash`; storage hit returns full file +
  `githubUrl`; storage miss returns JSON-RPC error with `githubUrl` (and `null` when underivable);
  works with `EnableDocAi` on/off; large document → summary + `get_document_chunk` round-trips
  reassemble the original (R6).
- Vector store: factory returns S3 Vectors unconditionally; `dynamodb` selection path gone;
  semantic retrieval still functions and still falls back to keyword on error (R7).

**Backward compatibility**
- Snapshot of the keyword-mode envelope proving no field removed/renamed and new fields additive
  (R10).

The full suite must pass before deployment (R11.5), within the test-execution guardrails (bounded
iterations, timeouts, mocked I/O).

---

## 10. Documentation updates (R11)

- **ARCHITECTURE.md** — data-model section updated for hash-keyed `document:{fileHash}` content,
  the new metadata fields (`githubUrl`/`repositoryType`/`namespace`/`documentHash`), the search-entry
  `type`/`subType`, batched reads, and S3-Vectors-only retrieval (R11.1, R11.3).
- **DEPLOYMENT.md** — remove `DocAiVectorStore` from the parameter reference; state S3 Vectors is
  the only backend; confirm `DocAiRetrievalMode` default (R11.1).
- **`docs/`** — developer/end-user docs for the new `get_document`/`get_document_chunk` tools
  (purpose, inputs, outputs, storage-miss URL behavior) and the enriched search fields/facets
  (R11.2).
- **CHANGELOG.md** — add entries under the existing `v0.0.6 (unreleased)` section (Added:
  `get_document`/`get_document_chunk`, `githubUrl`/`repositoryType`/`namespace`, `availableFilters`,
  exact-phrase ranking, boundary-aware excerpts; Changed: batched reads, hash-keyed content;
  Removed: `DocAiVectorStore` parameter and DynamoDB vector backend), referencing
  `[Spec: 0-0-6-documentation-index-enhancement]` (R11.4).
- **`template-openapi-spec.yml`** — reviewed to confirm the single `POST /mcp/v1` path still
  describes all MCP operations; no new path added (R11.6).

---

## 11. Security considerations

- **No new GitHub fetching from the server.** `get_document` is storage-only; the client performs
  any GitHub fetch, so the shared server cannot exhaust GitHub rate limits or leak a server token
  to that traffic (R6 rationale).
- **Input validation.** `get_document*` inputs are schema-validated before any read; `hash` is
  constrained to `^[0-9a-f]{16}$` and `filePath` is used only as a DynamoDB key component / hash
  input, never in shell or filesystem operations.
- **Least privilege / IAM.** No new IAM is required for `get_document` (it reads the existing
  DocIndex table). Removing the DynamoDB vector backend removes a read path but not permissions
  (the table grant is unchanged); the S3 Vectors data-plane grant (gated by `EnableDocAiIsTrue`)
  is unchanged.
- **GitHub custom-property reads** in the indexer use the existing SSM-sourced token and are
  best-effort; failures degrade to `null` classification and never fail a build or log the token.
- **No secrets in results.** `githubUrl` is a public blob URL; no credentials are embedded.

---

## 12. Open/least-risk items

- **`namespace` source.** The precise origin of `namespace` (a dedicated custom property vs. a
  derived value) is confirmed at implementation time against what the GitHub custom-properties API
  returns; if unavailable it is stored as `null` (R5.4) — no behavior depends on it being present.
- **Excerpt tuning constants** (hard cap, prose-detection heuristics) are internal and adjustable
  without contract impact.
