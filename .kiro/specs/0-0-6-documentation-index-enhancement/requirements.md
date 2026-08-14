# Requirements Document

Documentation Index Enhancement

## Introduction

This feature improves the efficiency, cost, and usefulness of the Atlantis MCP documentation
search and indexing pipeline. It is driven by the analysis in `RECOMMENDATIONS.md` and the
decisions recorded in `QUESTIONS.md` (all answers incorporated below).

The work spans two Lambda functions and supporting infrastructure/docs:

- **`doc-indexer`** — how documentation is chunked, scored, and written to the DynamoDB
  `…-DocIndex` table.
- **`read-function`** — the MCP `search_documentation` tool and a new `get_document` tool,
  dispatched via JSON-RPC 2.0 over the single `POST /mcp/v1` endpoint.
- **Infrastructure & docs** — `template.yml`, `template-openapi-spec.yml`, the MCP tool
  registry/descriptions, and the ARCHITECTURE / DEPLOYMENT / CHANGELOG / `docs/` tree.

All three `DocAiRetrievalMode` values remain supported: **keyword**, **semantic**,
**semantic-assisted**. The `DocAiVectorStore` axis is being removed in favor of S3 Vectors only.

### Guiding constraints

- **Additive, backward-compatible contract.** No existing result field is removed or renamed.
  When the AI feature is disabled or the caller is below `DocAiMinTier`, the keyword path's
  existing behavior is preserved except for the additive improvements defined here (populated
  `githubUrl`/`repositoryType`/`namespace`, boundary-aware excerpts, new optional
  `availableFilters`, and phrase-aware ranking).
- **Feature gating unchanged.** `EnableDocAi` still gates all semantic/Bedrock/vector code paths.
- **`get_document` is retrieval-by-id**, independent of retrieval mode and of `EnableDocAi`.

## Glossary

- **contentPath** — `{org}/{repo}/{filePath}/{slug}`, returned to callers as `filePath`.
- **hash** — deterministic SHA-256(contentPath) truncated to 16 hex chars; the content key.
- **section** — one heading (H1–H6) chunk produced by an extractor.
- **facets / availableFilters** — the distinct `type`/`subType` values (with counts) present
  in a search result set, returned to help an agent refine a follow-up query.

---

## Requirements

### Requirement 1: Batched metadata retrieval in search (R1)

**User Story:** As an operator, I want documentation search to fetch result metadata in batched
DynamoDB requests, so that search latency and per-request read cost scale sub-linearly with the
number of results across all retrieval modes.

#### Acceptance Criteria

1. WHEN `queryIndex` resolves its ranked set of content hashes THEN the system SHALL retrieve
   their metadata items using `BatchGetItem` requests (chunked at the 100-key DynamoDB limit)
   rather than one serial `GetItem` per hash.
2. WHEN the semantic or semantic-assisted path enriches ranked vector hits THEN the system SHALL
   retrieve content metadata via the same batched mechanism (`getContentMetadataByHashes`).
3. WHEN a `BatchGetItem` response returns `UnprocessedKeys` THEN the system SHALL retry only the
   unprocessed keys with a bounded number of attempts and SHALL NOT loop unbounded.
4. WHEN batched results are assembled THEN the system SHALL preserve the pre-fetch ranking order
   (re-sort by relevance/score after fetch) so result ordering is unchanged from today.
5. IF a subset of metadata items is missing (e.g. superseded/partial index) THEN the system SHALL
   omit only those hits and SHALL NOT fail the request.

---

### Requirement 2: Content stored keyed by hash only (R2/R2b)

**User Story:** As a maintainer, I want document bodies stored once per content hash instead of
duplicated per index version, so that storage cost is reduced and stale content is cleaned up
automatically.

#### Acceptance Criteria

1. WHEN the indexer writes a content body THEN the system SHALL key it by content hash without
   embedding the index version in the key (e.g. a single `content:{hash}` body item), so the body
   is not duplicated across versions.
2. WHEN a build runs THEN the system SHALL (re)write every currently-indexed hash's content item
   with a refreshed 7-day TTL.
3. WHEN a heading is removed or renamed between builds THEN its now-orphaned content item SHALL be
   allowed to expire via TTL (no explicit orphan-deletion diff is required).
4. WHEN content is keyed by hash only THEN retrieval by hash SHALL succeed without the caller
   supplying an index version.
5. The system SHALL NOT rely on per-version content duplication for point-in-time or version-diff
   use cases (explicitly out of scope).

---

### Requirement 3: Boundary-aware excerpts (R3)

**User Story:** As an AI agent consuming search results, I want excerpts that read as coherent
prose rather than mid-word/mid-table fragments, so that I can judge relevance without fetching the
full document.

#### Acceptance Criteria

1. WHEN the indexer produces an excerpt for a section THEN the system SHALL trim at a word or
   sentence boundary at or before the maximum length rather than performing a hard character cut.
2. WHEN a section body begins with non-prose markup (e.g. a markdown table row like
   `| Attribute | Setting |`) THEN the system SHALL prefer the first descriptive prose paragraph as
   the excerpt source where one is available.
3. WHEN an excerpt is trimmed THEN the resulting excerpt SHALL NOT end in a partial word.
4. The excerpt SHALL remain a single stored field on the metadata item consumed identically by the
   keyword and semantic paths (no per-mode divergence).
5. WHEN the read path returns an excerpt THEN it SHALL NOT re-truncate in a way that reintroduces
   mid-word cuts (the read-side length guard must respect the indexer's boundary).

---

### Requirement 4: Populate `githubUrl` (R4, Q5a/Q5b)

**User Story:** As an AI agent, I want each search result to include a working GitHub URL to the
source file, so that I can open or fetch the full document.

#### Acceptance Criteria

1. WHEN the indexer writes a content metadata item THEN the system SHALL store a file-level GitHub
   URL of the form `https://github.com/{owner}/{repo}/blob/{ref}/{filePath}`.
2. WHEN the archive for a repository came from a release THEN `{ref}` SHALL be the release tag;
   OTHERWISE `{ref}` SHALL be the repository default branch (matching what was actually indexed).
3. WHEN search returns a result THEN it SHALL return the stored `githubUrl` value (not `null`) for
   entries indexed after this change.
4. The `githubUrl` SHALL be a file-level link only; heading-anchor deep links are out of scope.
5. IF the information needed to build the URL is unavailable for an entry THEN the system SHALL
   store `null` for that entry rather than failing the build.

---

### Requirement 5: Populate `repositoryType` and `namespace` (Q5c)

**User Story:** As an AI agent, I want results to carry the repository type and namespace, so that
I can distinguish documentation from templates, starters, packages, and MCP repos.

#### Acceptance Criteria

1. WHEN the indexer processes a repository THEN the system SHALL capture its
   `atlantis_repository-type` custom property and store it as `repositoryType` on the content
   metadata item.
2. WHEN a namespace is available for a repository THEN the system SHALL store it as `namespace` on
   the metadata item.
3. WHEN search returns a result THEN it SHALL return the stored `repositoryType`/`namespace` values
   for entries indexed after this change.
4. IF the custom property or namespace is not set on a repository THEN the system SHALL store `null`
   for the unavailable field and SHALL NOT fail the build.
5. `repositoryType` values SHALL be drawn from the recognized set (documentation, app-starter,
   templates, package, mcp) when present.

---

### Requirement 6: `get_document` MCP tool (Q1)

**User Story:** As an AI agent, I want a `get_document` tool that returns the full source file for a
search result, so that I can analyze complete context beyond the excerpt.

> **Rationale (GitHub fetch policy):** The MCP server handles requests on behalf of many clients, so
> it must minimize direct GitHub traffic to avoid shared rate-limit exhaustion. `get_document` is
> therefore a **storage-only** retrieval: the server never fetches from GitHub. When storage does not
> hold the requested document, the server hands the client the file-level GitHub URL and the client
> performs the fetch itself (spreading any GitHub load across clients rather than concentrating it on
> the server).

#### Acceptance Criteria

1. WHEN an agent lists tools (`list_tools` / `tools/list`) THEN `get_document` SHALL appear in the
   catalog with a description and input schema.
2. `get_document` SHALL be dispatched as a JSON-RPC method via the existing `POST /mcp/v1` endpoint
   and SHALL NOT introduce a new API Gateway path.
3. WHEN `get_document` is called with a `filePath` (contentPath) THEN the system SHALL return the
   **entire source file** (all sections of that file reconstructed in document order), not only the
   single referenced section.
4. The tool SHALL accept either a `filePath` or a `hash` as the lookup key; when a section-level
   value is supplied, the system SHALL resolve it to the owning file.
5. WHEN the requested content is present in storage THEN the system SHALL assemble and return the
   stored content (the full source file reconstructed from the stored section body items). The
   system SHALL NOT perform live GitHub fetches to satisfy `get_document`; retrieving a document
   that is not in storage is delegated to the client (see Acceptance Criterion 8).
6. `get_document` SHALL be available at the same access level as keyword `search_documentation`
   (no additional tier gating) and SHALL function regardless of `EnableDocAi` or the active
   `DocAiRetrievalMode`.
7. WHEN a returned document exceeds the response size limit THEN the system SHALL provide chunked
   retrieval consistent with the existing `get_template` / `get_template_chunk` pattern (a summary
   plus chunk-count and a chunk accessor), rather than silently dropping content.
8. IF the document cannot be found in storage THEN the system SHALL NOT attempt to fetch it from
   GitHub, and SHALL instead return a JSON-RPC error that identifies the requested `filePath`/`hash`
   AND includes the file-level GitHub URL (when it can be derived from stored metadata) so the client
   can retrieve the document directly. IF no GitHub URL can be derived THEN the error SHALL still
   identify the requested `filePath`/`hash`.
9. WHEN `get_document` returns stored content successfully THEN the response SHALL also include the
   file-level `githubUrl` for the source file (when available), so the client always has a direct
   link alongside the content.

---

### Requirement 7: Consolidate on S3 Vectors; remove `DocAiVectorStore` (Q2)

**User Story:** As a maintainer, I want a single vector store backend (S3 Vectors), so that I have
less configuration surface, no whole-corpus in-Lambda scan path, and lower vector-storage cost.

#### Acceptance Criteria

1. The system SHALL use S3 Vectors as the sole vector store backend for semantic and
   semantic-assisted retrieval.
2. The `DocAiVectorStore` CloudFormation parameter and its `DOC_AI_VECTOR_STORE` env wiring SHALL be
   removed from `template.yml` and from both Lambdas' configuration.
3. The DynamoDB vector-store backend code path SHALL be removed or made unreachable such that no
   whole-corpus-into-Lambda cosine path remains in the retrieval flow.
4. WHEN the removal is complete THEN semantic and semantic-assisted retrieval SHALL continue to
   function against S3 Vectors with the existing embedding model/dimensions and topK behavior.
5. All documentation referencing a selectable vector store (DEPLOYMENT.md, ARCHITECTURE.md, and any
   `docs/` and parameter references) SHALL be updated to reflect S3 Vectors as the only backend.
6. WHEN semantic retrieval is unavailable (feature disabled, below tier, or an error) THEN the
   system SHALL continue to fall back to keyword search as it does today.

---

### Requirement 8: Filter discoverability and push-down (R5, Q3)

**User Story:** As an AI agent, I want the search tool to make `type`/`subType` filters discoverable
and to apply them efficiently, so that I can narrow broad result sets and the server does less work.

#### Acceptance Criteria

1. WHEN search returns results THEN the response SHALL include an additive `availableFilters` (facet)
   block listing the distinct `type` and `subType` values present in the matched set with their
   counts.
2. WHEN a `type` and/or `subType` filter is supplied THEN the system SHALL apply the filter before
   the metadata enrichment fetch (filter push-down) so the number of metadata reads is reduced,
   using type/subType information carried on the keyword/search index entries.
3. The `search_documentation` tool description and input schema SHALL enumerate the allowed `type`
   and `subType` values and SHALL include guidance to refine with `type`/`subType` when results are
   broad.
4. WHEN `totalResults` is large THEN the system SHALL populate the existing `suggestions` field with
   a "narrow by type/subType" nudge (extending its current zero-results-only usage).
5. `availableFilters` SHALL be additive and optional; its absence or presence SHALL NOT break
   existing clients, and filter push-down SHALL NOT change which results are returned versus the
   current post-fetch filtering (only when they are filtered).

---

### Requirement 9: Query-time exact-phrase ranking boost (R8, Q4)

**User Story:** As an AI agent, I want exact-phrase matches ranked higher, so that a result whose
title or excerpt literally contains my query phrase surfaces near the top.

#### Acceptance Criteria

1. WHEN keyword-mode results are scored THEN the system SHALL apply the `exactPhrase` weight as a
   query-time boost to entries whose title or excerpt contains the full query phrase.
2. The exact-phrase boost SHALL be computed after metadata retrieval over the already-fetched
   top candidates only, adding negligible additional reads.
3. The `SCORE_WEIGHTS.exactPhrase` value SHALL be used by the scoring logic (no longer dead code).
4. WHEN the exact-phrase boost changes ordering THEN results SHALL still be returned sorted by final
   relevance descending.
5. Semantic and semantic-assisted ranking (cosine/assist) SHALL be unaffected by this requirement.

---

### Requirement 10: Backward compatibility (Q8)

**User Story:** As an existing MCP client, I want the response contract to remain compatible, so that
current integrations keep working after this change.

#### Acceptance Criteria

1. The system SHALL NOT remove or rename any existing field in the `search_documentation` result
   objects or envelope.
2. New fields (populated `githubUrl`/`repositoryType`/`namespace`, `availableFilters`, and any
   `get_document` additions) SHALL be additive and optional.
3. WHEN `EnableDocAi` is `false` or the caller is below `DocAiMinTier` THEN the keyword path SHALL
   behave as today except for the additive improvements defined in Requirements 3, 4, 5, 8, and 9.
4. Existing MCP tools and their contracts SHALL remain unchanged except for the additive
   `search_documentation` description/schema updates in Requirement 8.

---

### Requirement 11: Documentation and tests kept in sync (AGENTS.md §9, Q2, Q7)

**User Story:** As a maintainer, I want documentation and tests updated alongside the code, so that
admins, developers, and end users have accurate information after this change.

#### Acceptance Criteria

1. WHEN the vector store is consolidated (Requirement 7) THEN ARCHITECTURE.md, DEPLOYMENT.md, and
   affected `docs/` and CloudFormation parameter docs SHALL be updated to remove the selectable
   vector store and reflect S3 Vectors only.
2. WHEN the `get_document` tool is added (Requirement 6) THEN the MCP tool catalog documentation and
   any relevant `docs/` (developer/end-user) SHALL document its purpose, inputs, and outputs.
3. WHEN the storage schema changes (Requirements 2, 4, 5) THEN ARCHITECTURE.md's data-model section
   SHALL be updated to describe hash-keyed content and the new stored metadata fields.
4. CHANGELOG.md SHALL record the user-facing changes under the current unreleased version.
5. New and changed behavior SHALL be covered by Jest tests (`*.jest.mjs`), and the full test suite
   SHALL pass before deployment.
6. `template-openapi-spec.yml` SHALL remain consistent with `template.yml`; since `get_document` is a
   JSON-RPC method over the existing `/mcp/v1` endpoint, no new path is added, and the spec SHALL be
   reviewed to confirm continued accuracy.

---

## Out of scope

- Query-embedding cache (RECOMMENDATIONS R7) — deferred; Bedrock cost is not a current concern.
- Heading-anchor deep links in `githubUrl` (Q5a) — file-level links only.
- Point-in-time / version-diff retrieval of content bodies (Q6).
- Retaining a DynamoDB vector backend or air-gapped vector option (Q2).
- Server-side live GitHub fetching for `get_document` (Requirement 6) — the server is storage-only
  and delegates any GitHub fetch to the client by returning the file-level URL.
