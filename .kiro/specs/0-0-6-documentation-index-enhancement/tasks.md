# Implementation Plan

Documentation Index Enhancement

## Overview

Tasks are ordered so the two Lambdas can deploy in either order (all read-side code treats new
attributes as `null`/absent). Each task lists the requirements it satisfies. All tests are Jest
(`*.jest.mjs`), mock AWS/GitHub/Bedrock I/O, and must never invoke `npm test` recursively.

---

## Tasks

### 1. doc-indexer: storage schema and indexing changes

- [x] 1.1 Add `documentHash` and `documentPath` to extracted entries
  - In `doc-indexer/lib/index-builder.js` `processRepository()`, compute
    `documentPath = {org}/{repo}/{filePath}` (contentPath without the trailing `/{slug}`) and
    `entry.documentHash = hashContentPath(documentPath)` via `lib/hasher.js`.
  - Retain the full raw file body per file so it can be written once (task 1.5).
  - _Requirements: 2.1, 6.3, 6.4_

- [x] 1.2 Boundary-aware excerpt builder
  - In `doc-indexer/lib/extractors/markdown.js`, replace the `body.substring(0, 200)` cut with a
    `buildExcerpt(body)` helper: prefer the first prose paragraph (skip leading table rows/dividers,
    fenced code blocks, headings, blanks), then trim to `MAX_EXCERPT_LENGTH` at a sentence or word
    boundary with a small hard cap; never end mid-word/mid-table.
  - Add unit tests for prose preference, boundary trimming, and hard-cap behavior.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 1.3 Capture the archive ref and build `githubUrl`
  - In `lib/index-builder.js` `processRepository()`, record the ref actually used: release tag when
    the release archive was downloaded, else `repo.defaultBranch`. Expose `tagName` from
    `lib/github-client.js` `getLatestRelease()` if not already present.
  - Add `buildGithubUrl({ owner, repo, ref, filePath })` →
    `https://github.com/{owner}/{repo}/blob/{ref}/{filePath}` (file-level only); return `null` when
    any component is missing.
  - Add unit tests for release-tag vs default-branch selection and the `null` fallback.
  - _Requirements: 4.1, 4.2, 4.4, 4.5_

- [x] 1.4 Capture `repositoryType` and `namespace`
  - In `lib/github-client.js`, add `getRepositoryProperties(owner, repo, token)` calling the GitHub
    custom-properties API (`GET /repos/{owner}/{repo}/properties/values`); read
    `atlantis_repository-type` (name from `settings.github.repositoryTypeProperty`) into
    `repositoryType` and derive `namespace`. Best-effort and failure-tolerant (never fail a build,
    never log the token).
  - Thread `repositoryType`/`namespace` onto entries; store `null` when absent.
  - Add unit tests for property mapping, absent-property `null`, and fetch-failure tolerance.
  - _Requirements: 5.1, 5.2, 5.4, 5.5_

- [ ] 1.5 Write the per-file `document:{fileHash}` item
  - In `doc-indexer/lib/dynamo-writer.js`, add `writeDocumentEntries(entries, version)` that groups
    entries by `fileHash`, writes one `pk=document:{fileHash}, sk=content` item (raw file text,
    `documentPath`, `githubUrl`, `repositoryType`, `namespace`, `repository`, `owner`, refreshed
    7-day `ttl`), de-duplicated per file.
  - Remove the per-section `content:{hash}/v:{version}:content` write.
  - Call `writeDocumentEntries` from `build()`.
  - Add unit tests: one item per file (dedupe), version-less key, TTL refresh, per-section body no
    longer written.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.3_

- [ ] 1.6 Extend metadata and search-entry writes
  - `writeContentEntries()`: add `githubUrl`, `repositoryType`, `namespace`, `documentHash` to the
    `content:{hash}/v:{version}:metadata` item.
  - `writeSearchKeywords()`: add `type` and `subType` to each `search:{keyword}/v:{version}:{hash}`
    entry.
  - Add unit tests asserting the new attributes are persisted.
  - _Requirements: 4.1, 5.1, 5.2, 6.4, 8.2_

- [x] 1.7 Remove the dead `exactPhrase` index-time weight
  - In `lib/index-builder.js`, remove `SCORE_WEIGHTS.exactPhrase` (the boost becomes query-time in
    the read-function, task 4.1).
  - _Requirements: 9.3_

### 2. read-function: batched metadata retrieval (R1)

- [x] 2.1 Add a shared `batchGetMetadata` helper
  - In `read-function/models/doc-index.js`, add `batchGetMetadata(tableName, version, hashes)` that
    builds `content:{hash}/v:{version}:metadata` keys, chunks at 100, issues batches in parallel,
    retries only `UnprocessedKeys` with bounded attempts + backoff, and returns a hash→item map
    (missing hashes simply absent).
  - Add unit tests: 100-key chunking, `UnprocessedKeys` bounded retry, missing-item omission.
  - _Requirements: 1.1, 1.3, 1.5_

- [ ] 2.2 Use batched reads in both enrichment paths
  - Refactor `queryIndex()` to fetch the ranked/filtered top slice via `batchGetMetadata`, then
    re-sort by score to preserve pre-fetch ordering.
  - Refactor `getContentMetadataByHashes()` (used by `services/documentation.js` `buildResults()`)
    to use `batchGetMetadata`, preserving vector-rank order.
  - Add/adjust tests asserting identical ordering to the pre-change behavior.
  - _Requirements: 1.1, 1.2, 1.4, 1.5_

### 3. read-function: filter discoverability, push-down, facets (R8)

- [ ] 3.1 Filter push-down before metadata fetch
  - In `queryIndex()`, apply `type`/`subType` filtering on the ranked hash set using the new
    `type`/`subType` attributes on `search:{keyword}` entries **before** the `batchGetMetadata`
    call.
  - Add tests proving the returned membership equals today's post-fetch filtering while reading
    fewer metadata items when filtered.
  - _Requirements: 8.2, 8.5_

- [ ] 3.2 `availableFilters` facets and `suggestions` nudge
  - In `services/documentation.js`, after assembling results, compute `availableFilters` (distinct
    `type`/`subType` with counts over the matched set) and add it to the envelope (additive/optional).
  - When `totalResults` exceeds a threshold, populate the existing `suggestions` array with a
    "narrow by type/subType" hint.
  - Add tests for facet counts and the large-result suggestion.
  - _Requirements: 8.1, 8.4, 8.5_

- [ ] 3.3 Update `search_documentation` schema and description
  - Correct the input `type` enum to the stored values (`documentation`, `template-pattern`,
    `code-example`), add a `subType` enum, mark both optional, and add a "refine with type/subType
    when results are broad" hint to the tool description in `config/settings.js`
    `availableToolsList` (and `extendedDescriptions`).
  - Update the `SchemaValidator` schema for `search_documentation`.
  - Add tests confirming valid/invalid filter values and unchanged behavior when no filter is given.
  - _Requirements: 8.3, 10.1, 10.4_

### 4. read-function: query-time exact-phrase boost (R9)

- [ ] 4.1 Apply the exact-phrase boost in keyword mode
  - Define `EXACT_PHRASE_BOOST = 20` in the read-function scoring logic. After `batchGetMetadata`
    enrichment (keyword mode only), add the boost to candidates whose `title` or `excerpt` contains
    the normalized full query phrase, then re-sort by final `relevanceScore` descending.
  - Ensure semantic/assisted ranking is untouched.
  - Add tests: boost changes ordering (not membership); semantic path unaffected.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

### 5. read-function: `get_document` and `get_document_chunk` (R6)

- [ ] 5.1 Model + service resolution (storage-only)
  - In `models/doc-index.js`, add `getDocumentByFileHash(tableName, fileHash)` (GetItem
    `document:{fileHash}/content`) and a metadata lookup that returns `documentHash`/`githubUrl`.
  - In `services/documentation.js`, add `getDocument({ filePath, hash, authInfo })`: resolve active
    version, derive section `hash` (from `hash` or `hashContentPath(filePath)`), read section
    metadata for `documentHash`/`githubUrl` (with strip-slug fallback), then read the document item.
    No GitHub fetch. Wrap in `CacheableDataAccess` with a new `document`/`doc-data` connection.
  - Add tests: resolution by `filePath` and by `hash`; storage hit; strip-slug fallback.
  - _Requirements: 6.3, 6.4, 6.5, 6.6_

- [ ] 5.2 Controller + tool registration
  - Add `Controllers.Documentation.getDocument` and `getDocumentChunk`.
  - Register `get_document` and `get_document_chunk` in `TOOL_DISPATCH` (`utils/json-rpc-router.js`),
    in `availableToolsList`/`extendedDescriptions`, and add their `SchemaValidator` schemas
    (`get_document`: `oneOf` filePath|hash, hash `^[0-9a-f]{16}$`; `get_document_chunk`: + required
    `chunkIndex`).
  - Add tests: tools appear in `tools/list`/`list_tools`; input validation rejects malformed hash /
    missing keys.
  - _Requirements: 6.1, 6.2, 6.6_

- [ ] 5.3 Success response + `githubUrl`, and storage-miss error
  - Success payload includes `filePath`, `githubUrl`, `repository`, `repositoryType`, `namespace`,
    `content`.
  - On storage miss, return a JSON-RPC error identifying `filePath`/`hash` with `githubUrl` in the
    error `data` (or `null` when underivable); never fetch from GitHub.
  - Add tests: success carries `githubUrl`; miss returns error + `githubUrl`; miss with no derivable
    URL returns error + `null`.
  - _Requirements: 6.8, 6.9_

- [ ] 5.4 Size-aware chunking (`get_document_chunk`)
  - Extend the size-aware branch in `json-rpc-router.js` `handleToolsCall()` to handle
    `get_document`: over-threshold results return `buildDocumentSummary(...)` (`contentTruncated`,
    `totalChunks`, `retrievalHint`).
  - Implement `getDocumentChunk` mirroring `controllers/templates.js` `getChunk()`
    (`ContentChunker`, `INVALID_CHUNK_INDEX` on out-of-range), using a `document-chunks` cache
    profile in `config/connections.js`.
  - Add tests: large document → summary; chunk round-trip reassembles the original; out-of-range
    index error.
  - _Requirements: 6.7_

### 6. Vector-store consolidation on S3 Vectors (R7)

- [x] 6.1 Collapse the vector-store factory to S3 Vectors
  - In `layers/doc-ai-common/nodejs/vector-store.js`, reduce `STORE_REGISTRY` to `s3-vectors` and
    make `createVectorStore()` always return `S3VectorStore`.
  - Delete `vector-store-dynamodb.js`; repoint the indexer embedding-reuse phase to
    `S3VectorStore.getVersionVectors()`.
  - Add/adjust tests: factory returns S3 Vectors; no dynamodb path remains; semantic retrieval and
    keyword fallback still work.
  - _Requirements: 7.1, 7.3, 7.4, 7.6_

- [ ] 6.2 Remove `DocAiVectorStore` from settings and cache key
  - Remove `vectorStore` from `documentation.ai` in `read-function/config/settings.js` and
    `doc-indexer/lib/settings.js`; stop reading `DOC_AI_VECTOR_STORE`.
  - Drop the `vectorStore` segment from the `docAiMode` cache discriminator in
    `services/documentation.js`.
  - Add tests confirming the discriminator still isolates keyword/semantic/per-tier.
  - _Requirements: 7.2, 10.3_

### 7. Infrastructure (R7, R11)

- [ ] 7.1 Remove `DocAiVectorStore` from `template.yml`
  - Remove the `DocAiVectorStore` parameter, its metadata group entry, and the
    `DOC_AI_VECTOR_STORE` environment variable from both the read-function and doc-indexer function
    definitions. Leave S3 Vectors resources/conditions/IAM (gated by `EnableDocAiIsTrue`) intact.
  - _Requirements: 7.2_

- [x] 7.2 Review `template-openapi-spec.yml`
  - Confirm the single `POST /mcp/v1` path still describes all MCP operations; add no new path for
    `get_document*` (JSON-RPC methods).
  - _Requirements: 6.2, 11.6_

### 8. Documentation and changelog (R11)

- [ ] 8.1 Update ARCHITECTURE.md and DEPLOYMENT.md
  - ARCHITECTURE.md: hash-keyed `document:{fileHash}` content, new metadata/search-entry fields,
    batched reads, S3-Vectors-only retrieval.
  - DEPLOYMENT.md: remove `DocAiVectorStore`; state S3 Vectors is the only backend; confirm
    `DocAiRetrievalMode` default.
  - _Requirements: 7.5, 11.1, 11.3_

- [ ] 8.2 Update `docs/` for the new tools and search fields
  - Document `get_document`/`get_document_chunk` (purpose, inputs, outputs, storage-miss URL
    behavior) and the enriched search fields/facets.
  - _Requirements: 11.2_

- [ ] 8.3 Update CHANGELOG.md
  - Under `v0.0.6 (unreleased)`, add Added/Changed/Removed entries referencing
    `[Spec: 0-0-6-documentation-index-enhancement]` (see design §10).
  - _Requirements: 11.4_

### 9. Final verification

- [ ] 9.1 Run per-function Jest suites and fix failures
  - Run each affected function's suite; confirm all pass with mocked I/O and bounded iterations.
  - Add a backward-compat snapshot proving no `search_documentation` field is removed/renamed and
    new fields are additive.
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 11.5_

---

## Task Dependency Graph

The two Lambdas (`doc-indexer`, `read-function`) can deploy in either order because all read-side
code treats the new attributes as `null`/absent. Within each function, the edges below capture the
"must land first" relationships.

```text
doc-indexer (section 1)
  1.1 ─┬─> 1.5   (document:{fileHash} item needs documentHash/documentPath + retained raw body)
       └─> 1.6   (metadata write needs documentHash)
  1.3 ───> 1.5   (githubUrl written onto the document item)
  1.3 ───> 1.6   (githubUrl written onto the metadata item)
  1.4 ───> 1.5   (repositoryType/namespace written onto the document item)
  1.4 ───> 1.6   (repositoryType/namespace written onto the metadata item)
  1.7 ───> 4.1   (exactPhrase weight moves from index-time to query-time)

read-function (sections 2-5)
  2.1 ─┬─> 2.2   (both enrichment paths call batchGetMetadata)
       ├─> 3.1   (filter push-down runs before batchGetMetadata)
       └─> 4.1   (exact-phrase boost applies after batchGetMetadata enrichment)
  1.6 ───> 3.1   (push-down reads type/subType on search entries)
  1.6 ───> 3.3   (schema/enum reflects stored type/subType values)
  3.1 ───> 3.2   (facets computed over the filtered/matched set)
  1.5 ───> 5.1   (get_document reads the document:{fileHash} item)
  1.6 ───> 5.1   (service resolves documentHash/githubUrl from metadata)
  5.1 ───> 5.2 ─> 5.3
  5.2 ───> 5.4   (size-aware chunking builds on registered get_document)

cross-cutting (sections 6-9)
  6.1 ───> 6.2 ─> 7.1        (settings/cache-key cleanup then template cleanup)
  all above ───> 8.1, 8.2, 8.3   (docs/changelog reflect final behavior)
  all above ───> 9.1             (final Jest verification runs last)
```

The same relationships expressed as execution waves. Every task in a wave depends only on tasks
in earlier waves, so all tasks within a wave may run in parallel.

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1.1", "1.2", "1.3", "1.4", "1.7", "2.1", "6.1", "7.2"],
      "dependsOn": []
    },
    {
      "wave": 2,
      "tasks": ["1.5", "1.6", "2.2", "4.1", "6.2"],
      "dependsOn": [1]
    },
    {
      "wave": 3,
      "tasks": ["3.1", "3.3", "5.1", "7.1"],
      "dependsOn": [1, 2]
    },
    {
      "wave": 4,
      "tasks": ["3.2", "5.2"],
      "dependsOn": [3]
    },
    {
      "wave": 5,
      "tasks": ["5.3", "5.4"],
      "dependsOn": [4]
    },
    {
      "wave": 6,
      "tasks": ["8.1", "8.2", "8.3"],
      "dependsOn": [1, 2, 3, 4, 5]
    },
    {
      "wave": 7,
      "tasks": ["9.1"],
      "dependsOn": [1, 2, 3, 4, 5, 6]
    }
  ]
}
```

Recommended execution order: complete section 1 (doc-indexer) tasks, then 2 → 3 → 4 → 5 in the
read-function, then 6 → 7 (vector-store/infra consolidation), and finish with 8 (docs) and 9
(verification). Task 1.7 must precede 4.1, and 1.5/1.6 must precede the section 5 `get_document`
work.

---

## Notes

- All tests are Jest (`*.jest.mjs`) and must mock AWS/GitHub/Bedrock I/O. Never invoke `npm test`
  recursively from within a test file; run the specific per-function suite directly (see the
  test-execution-monitoring guidance).
- Backward compatibility is required: every new `search_documentation` field is additive, and no
  existing field may be removed or renamed (verified by the snapshot test in task 9.1).
- The GitHub token must never be logged; `getRepositoryProperties` (task 1.4) is best-effort and
  must never fail a build.
- `get_document`/`get_document_chunk` are storage-only: they never fetch from GitHub. On a storage
  miss they return a JSON-RPC error carrying `githubUrl` in `data` (or `null` when underivable).
- Requirement references (`_Requirements: X.Y_`) on each task map back to `requirements.md`; design
  details are in `design.md` (see §10 for the changelog entries).
