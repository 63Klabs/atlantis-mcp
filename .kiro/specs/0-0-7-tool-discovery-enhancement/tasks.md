# Implementation Plan: Tool Discovery Enhancement

## Overview

This plan implements the Tool Discovery Enhancement in JavaScript/Node.js across the
`read-function` Lambda, the `doc-indexer` Lambda, a new `search-common` Lambda Layer,
and agent-asset content. It follows the design's five-step **Rollout ordering** so that
no index-shape change ships ahead of its dependency:

1. **Step 1** — `search-common` layer, Read Function consumes it, `instructions`, descriptions, observability (no re-index).
2. **Step 2** — Tool Metadata Registry, `tool-catalog.js`, schema reconciliation (no re-index).
3. **Step 3** — Filters, `ghusers` fix, corpus manifest derive-from-main-index path (no re-index).
4. **Step 4** — Doc Indexer consumes the layer, per-type exclusions, three-state resolution, ranking inputs, corpus manifest item, vector metadata (**one re-index**).
5. **Step 5** — Agent-asset content, enable `skills` (no re-index).

Two ordering dependencies from the design are honored explicitly: the three-state
property resolution lands before the per-type exclusion policy that depends on it
(R9.8, design 10.4), and the shared normalization layer exists before either Lambda
consumes it (R6.3, design 1).

Tasks are rooted at `application-infrastructure/src/lambda/`. Unit tests go under each
layer's `tests/unit/<layer>/`, cross-layer tests under `tests/integration/`, and
property-based tests (fast-check) under `tests/property/`, per the existing Jest layout (R15.1).

## Tasks

- [x] 1. Create the `search-common` Lambda Layer with shared normalization (Rollout step 1)
  - [x] 1.1 Scaffold the `search-common` layer package
    - Create `layers/search-common/nodejs/package.json` with no production dependencies and `layers/search-common/jest.config.js`, following the `doc-ai-common` precedent so the existing buildspec layer loop picks it up with no buildspec change
    - _Requirements: 6.3, Guiding constraint 6 (no shared source directories)_

  - [x] 1.2 Implement `normalize.js` token derivation and policy
    - Create `layers/search-common/nodejs/normalize.js` exporting `normalizeTerm`, `normalizeText`, `STOP_WORDS`, `MIN_TOKEN_LENGTH`, and `NORMALIZER_VERSION`
    - Build the token union: term-as-written (lowercased, `[a-z0-9-]` plus underscore when `splitUnderscore`), hyphen components, and the suffix-reduced form; set `MIN_TOKEN_LENGTH = 2` and adopt the ~70-entry stop-word set on both sides
    - Implement the ordered suffix table (`ing`, `es`, `s`, `ed`) applied at most once per term
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 1.3 Write property test for normalization parity
    - **Property 1: Normalization parity** — index-side and query-side token sets are equal for any term
    - Generate hyphenated identifiers, suffixed forms, two-character tokens (`s3`, `v2`), stop words, mixed punctuation
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.7**

  - [x] 1.4 Write property test for re-index tolerance and monotonic reachability
    - **Property 2: Re-index tolerance** — token set always includes the term as written
    - **Property 3: Monotonic reachability** — no token that matched before is removed by the change
    - **Validates: Requirements 6.5, 6.6, 13.3**

  - [x] 1.5 Write unit tests for `normalize.js`
    - Each suffix-table row; hyphen splitting; the `s3`/`v2` two-character cases; `splitUnderscore` parity with current `python.js` behavior
    - _Requirements: 6.1, 6.4_

- [x] 2. Wire the Read Function to the shared layer and repair query-side normalization (Rollout step 1)
  - [x] 2.1 Attach `search-common` to the Read Function and route query tokenization through it
    - Add the layer to the Read Function in `template.yml`; load it via a `loadLayerModule`-style indirection with an env-var path override for tests
    - Replace `extractQueryKeywords()` in `read-function/models/doc-index.js` with delegation to `normalizeText`, so query-side length and stop-word policy match index side
    - Fail fast at cold start if the layer module is unavailable (no silent local fallback)
    - _Requirements: 6.2, 6.3, 6.6_

  - [x] 2.2 Write unit test for query-side normalization repair
    - Assert a keyword-path query of `s3` no longer reduces to zero keywords; assert index-time/query-time token-set match through the shared module
    - _Requirements: 6.2, 6.4, 15.4_

- [x] 3. Author server instructions content served from a single source (Rollout step 1)
  - [x] 3.1 Implement `config/server-instructions.js`
    - Create `read-function/config/server-instructions.js` exporting `buildInstructions(options)` and `MAX_INSTRUCTION_WORDS`
    - Compose scope sentence naming the platform and `@63klabs/cache-data`; precedence directive; vocabulary (scoped/unscoped `cache-data`, six repositoryType values, five template categories); one corpus sentence sourced from the manifest; no per-tool routing table; hold to 250 words with corpus-size degradation
    - Source `serverInfo.version` from the Lambda `package.json` version, replacing the hardcoded `'0.0.1'`
    - Have both protocol-era carriers read this one module
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 11.8_

  - [x] 3.2 Write property test for instructions bounds
    - **Property 12: Instructions bounds** — non-empty, within word cap, contains platform name and `cache-data`, for any corpus size including empty
    - **Validates: Requirements 1.1, 1.2, 1.5, 1.7**

  - [x] 3.3 Write unit tests for `server-instructions.js`
    - Word cap, required substrings, corpus-sentence degradation, empty-corpus case
    - _Requirements: 1.5, 1.7, 15.2_

- [x] 4. Add discovery observability (Rollout step 1)
  - [x] 4.1 Emit structured discovery log events
    - In `read-function/services/documentation.js` and the tool-call path, emit `discovery_search` (`tokenCount`, `filtersApplied[]`, `resultCount`, `strategy`, `emptyResult`, `manifestTier`, `manifestSource`), `discovery_tool_call` (`toolName`, `firstInSession` per-container), and `discovery_manifest_degraded` (`fromTier`, `toTier`, `reason`) via `DebugAndLog`
    - Never log query text with caller identity, credentials, or PII
    - _Requirements: 12.1, 12.2, 12.3, 12.5_

  - [x] 4.2 Add zero-result CloudWatch metric filter
    - Add metric filters under a `Discovery` namespace in `template.yml` for the `search_documentation` zero-result count, following the existing `DocAi` pattern; this deployment establishes the R12.6 baseline
    - _Requirements: 12.4, 12.6_

  - [x] 4.3 Write unit tests for discovery logging
    - Assert emitted fields and that no query text is logged with identity
    - _Requirements: 12.1, 12.5_

- [x] 5. Checkpoint - Rollout step 1 complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Build the Tool Metadata Registry and single catalog helper (Rollout step 2)
  - [x] 6.1 Implement `config/tool-metadata.js`
    - Create the registry keyed by tool name with title, annotations (`readOnlyHint: true`, `openWorldHint: false` for every tool), category, keywords, relatedTools, whenToUse, whenNotToUse, and at least one structured example per tool
    - Add `validateRegistry` (fail-fast at load), `generateAnnotations`, `generateTitles`, and `getDiscoveryBlock`, following the `agent-asset-types.js` pattern
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 6.2 Implement `utils/tool-catalog.js` as the single merge
    - Create `buildToolCatalog(options)` overlaying the manifest with extended descriptions and registry metadata, filtered to fields legal on the negotiated revision; return deterministically ordered definitions; do not emit tier filtering
    - Compose `category`/`keywords`/`relatedTools`/`whenToUse`/`whenNotToUse`/`examples` into description text (not wire fields); omit `title`/`annotations` when the revision disallows them
    - _Requirements: 2.3, 2.4, 2.6, 2.7, 2.8_

  - [x] 6.3 Route both call sites through the catalog helper
    - Make the `tools/list` branch in `utils/json-rpc-router.js` and `controllers/tools.js` call `buildToolCatalog()` and nothing else, eliminating the two independent merges; leave the `MCP_TOOLS` raw export in `utils/mcp-protocol.js` untouched
    - _Requirements: 2.4, 2.7_

  - [x] 6.4 Write property test for registry completeness
    - **Property 10: Registry completeness** — every manifest tool has a metadata entry and an extended description; every metadata key names a real tool; violations fail at load
    - **Validates: Requirements 2.1, 2.3, 4.4**

  - [x] 6.5 Write property test for catalog single-sourcing
    - **Property 11: Catalog single-sourcing** — for any negotiated revision, `tools/list` and `list_tools` return identical tool arrays
    - **Validates: Requirements 2.4, 2.6, 2.7**

- [x] 7. Reconcile published and enforced schemas (Rollout step 2)
  - [x] 7.1 Make the enforced schema authoritative and publish it
    - Keep `baseSchemas` in `utils/schema-validator.js` as the single authoritative definition; drop inline `inputSchema` from `settings.tools.availableToolsList` entries and reference the validator schema by tool name via `buildToolCatalog()`
    - Disclose the previously-unpublished constraints: `minLength`/`maxLength`, the name pattern forbidding path separators, `additionalProperties: false`, and the `list_templates` `namespace` property
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 7.2 Write property test for schema identity
    - **Property 9: Schema identity** — for every tool the published and enforced schema are the same object
    - **Validates: Requirements 3.1, 3.2, 3.4**

- [x] 8. Rewrite tool descriptions for trigger coverage (Rollout step 2)
  - [x] 8.1 Restructure extended descriptions in `config/tool-descriptions.js`
    - Apply the fixed shape (trigger sentence, returns, params with concrete identifiers, failure mode, related-tool pointer) to each description; widen `search_documentation` to name companion packages including `cache-data`; fix the `stadards` typo in `list_starters`
    - Add the missing-extended-description warning to `validateDescriptions()`; compose `getDiscoveryBlock()` content into the rendered description
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 8.2 Write unit tests for description coverage
    - Assert each description opens with a trigger, names required identifiers, states a failure mode; assert the init-time warning fires for a manifest tool with no description
    - _Requirements: 4.1, 4.4, 4.6_

- [x] 9. Update existing contract tests affected by steps 1-2 (R15.9)
  - [x] 9.1 Verify and update `tools-mcp-protocol.property.test.js` and `initialize` shape tests
    - Confirm the `MCP_TOOLS` reference-identity assertion still passes; update expectations only where `settings.js` drops inline `inputSchema`; update the `initialize` response-shape test for the sourced server version
    - _Requirements: 15.9, 1.8, 3.3_

- [x] 10. Checkpoint - Rollout step 2 complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement the corpus manifest DAO and transitional derivation (Rollout step 3)
  - [x] 11.1 Implement `models/corpus.js`
    - Create the corpus manifest DAO: single `GetItem` on `corpus:{version}` / `manifest` at the active version, cached under a new `corpus` / `corpus-manifest` connection profile; version-keyed so a new build yields a new key with no invalidation
    - Implement the transitional main-index-chunk derivation fallback (step 3 ships before the indexer item exists), recording the chosen source for logging; omit `indexedRepositories` with a warning if derivation fails
    - _Requirements: 8.1, 8.3, 8.5, 8.6_

  - [x] 11.2 Write unit tests for `corpus.js`
    - Item path, derivation fallback, each degradation tier, version-keyed cache behavior
    - _Requirements: 8.5, 8.6, 8.8_

- [x] 12. Add repository/type/namespace filters and `ghusers` fix to documentation search (Rollout step 3)
  - [x] 12.1 Declare the new filter schema and plumb it through the service
    - Add optional `repository`, `repositoryType` (enum over `validRepositoryTypes`), and `namespace` to the authoritative schema in `schema-validator.js`
    - Apply filters in `models/doc-index.js` via push-down on carried values plus authoritative post-fetch filter on content metadata; return empty-but-successful on no match
    - Honor `ghusers` as an `owner` filter on the keyword path (not removed), preserving the empty-intersection error
    - _Requirements: 5.1, 5.2, 5.3, 5.7_

  - [x] 12.2 Add the new filters to the search cache key
    - Add `repository`, `repositoryType`, `namespace`, and the resolved `ghusers` set to the `documentation-index` / `doc-index` cache-key inputs
    - _Requirements: 5.4, 13.4_

  - [x] 12.3 Add the `repository` facet to `availableFilters`
    - Extend `buildAvailableFilters()` with a `repository` facet over the matched set, kept distinct from the index-wide manifest
    - _Requirements: 5.5_

  - [x] 12.4 Write property test for filter soundness
    - **Property 4: Filter soundness** — every returned result satisfies every supplied filter, keyword and semantic paths
    - **Validates: Requirements 5.1, 5.3, 10.2, 10.3**

  - [x] 12.5 Write unit tests for filters and cache key
    - Each filter narrows correctly; push-down retains unknown values; each filter participates in the cache key
    - _Requirements: 5.1, 5.2, 5.4_

- [x] 13. Assemble the corpus manifest into the search response with budget degradation (Rollout step 3)
  - [x] 13.1 Emit `indexedRepositories` on every response with the degradation ladder
    - In `services/documentation.js`, attach `indexedRepositories` (distinct from `availableFilters`) to every `search_documentation` response including empty ones
    - Implement the `full`/`compact`/`count` ladder against `MCP_CORPUS_MANIFEST_MAX_BYTES` (default 4096 via `parseIntSetting`); report the emitted tier in the block
    - Enforce assembly order: build results, select manifest tier, measure results+manifest via `ContentSizer`, degrade manifest before truncating results, omit manifest before truncating results
    - _Requirements: 8.2, 8.4, 8.7, 8.8, 8.9, 8.10_

  - [x] 13.2 Write property test for manifest presence
    - **Property 6: Manifest presence** — every query, including one matching nothing, returns `indexedRepositories`
    - **Validates: Requirements 8.1, 8.2, 10.4**

  - [x] 13.3 Write property test for manifest never truncating results
    - **Property 7: Manifest never truncates results** — response fits with manifest degraded or omits the manifest; never truncates results while a degradable manifest is present
    - **Validates: Requirements 8.7, 8.8, 8.9, 13.5**

- [x] 14. Checkpoint - Rollout step 3 complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement three-state repository property resolution in the Doc Indexer (Rollout step 4, ordered before per-type exclusions per R9.8)
  - [x] 15.1 Return three-state resolution from `getRepositoryProperties()`
    - In `doc-indexer/lib/github-client.js`, return `{ repositoryType, namespace, resolution }` with `resolution` one of `resolved` | `absent` | `fetch-failed`, distinguishing property-not-in-array from request-threw while preserving the never-throws/never-fails-a-build contract
    - _Requirements: 9.1, 9.2, 9.8_

  - [x] 15.2 Write unit tests for the three resolution states
    - Assert `resolved`, `absent`, and `fetch-failed` are distinguished, including absent-vs-fetch-failed
    - _Requirements: 9.1, 9.2_

- [x] 16. Implement per-repository-type file exclusions with carry-forward (Rollout step 4)
  - [x] 16.1 Make `isIndexable` type-aware and apply the policy matrix
    - Change `isIndexable(filePath)` to `isIndexable(filePath, repositoryType)` in `doc-indexer/lib/file-filter.js`; `processRepository` passes the resolved type
    - Apply the matrix: `package` = global minus `CHANGELOG.md`; other known types = global; `absent` = no exclusions; `AGENTS.md` excluded for every type
    - _Requirements: 9.3, 9.4, 9.5_

  - [x] 16.2 Implement fetch-failed carry-forward
    - On `fetch-failed`, read the previous version's corpus manifest item and reuse that repository's recorded classification; apply global default exclusions when no prior resolution exists (precedent: `loadPriorEmbeddings`)
    - _Requirements: 9.6, 9.7_

  - [x] 16.3 Write property test for classification determinism
    - **Property 8: Classification determinism** — two builds over identical content with identical successful resolutions index an identical file set, including a transient fetch-failure carry-forward
    - **Validates: Requirements 9.1, 9.6, 9.7**

  - [x] 16.4 Write unit tests for the exclusion policy matrix
    - All four classifications in section 10.2; carry-forward on fetch-failed; global default when no prior resolution
    - _Requirements: 9.4, 9.5, 9.6_

- [x] 17. Implement ranking inputs on the keyword path (Rollout step 4)
  - [x] 17.1 Add repository-name, path, and repository-type ranking signals
    - In `doc-indexer/lib/index-builder.js` `computeRelevanceScore`, add `repositoryNameMatch` and `pathMatch` contributions and a `REPOSITORY_TYPE_WEIGHTS` multiplier (package/documentation highest; templates/app-starter neutral; mcp/management slightly below; absent/fetch-failed neutral)
    - _Requirements: 7.1, 7.2_

  - [x] 17.2 Reorder the candidate window to apply filters before the slice
    - In `models/doc-index.js`, change the pipeline to rank, push-down filter, slice window, batchGet, post-filter, phrase boost, sort, slice(limit); use `limit * 3` with no filter and a larger multiple when a filter is active; keep the semantic path ranked by cosine similarity only
    - _Requirements: 7.3, 7.4, 7.5_

  - [x] 17.3 Write property test for unfiltered membership invariance
    - **Property 5: Unfiltered membership invariance** — a query supplying no new filter returns an identical set and order to pre-change behavior
    - **Validates: Requirements 5.6, 7.3, 7.4, 13.3**

  - [x] 17.4 Write unit tests for ranking signals and window reorder
    - New signals contribute as specified; window reorder preserves unfiltered membership
    - _Requirements: 7.1, 7.2, 7.4_

- [x] 18. Replace the four extractor tokenizer copies and write the corpus manifest item (Rollout step 4)
  - [x] 18.1 Delegate the Doc Indexer extractors to the shared layer
    - Attach `search-common` to the Doc Indexer in `template.yml`; delete the four `extractKeywords` copies in `doc-indexer/lib/extractors/{markdown,cloudformation,jsdoc,python}.js` and delegate to the layer, with `python.js` passing `splitUnderscore: true`
    - _Requirements: 6.1, 6.3_

  - [x] 18.2 Write the corpus manifest item during the build
    - Add `writeCorpusManifest` to `doc-indexer/lib/dynamo-writer.js` writing `corpus:{version}` / `manifest` with per-repository `name`, `owner`, `repositoryType`, `resolution`, `namespace`, `sections`, `ref`, and the 7-day TTL
    - _Requirements: 8.3, 8.5_

  - [x] 18.3 Write unit test for extractor delegation parity
    - Assert each extractor's tokens now come from the shared layer and match prior behavior (including `python.js` underscore handling)
    - _Requirements: 6.1, 6.3_

- [x] 19. Add semantic-path parity for the new filters (Rollout step 4)
  - [x] 19.1 Persist new vector metadata and apply filters on the semantic path
    - Write `repositoryType` and `namespace` into vector-store metadata during the re-index; apply store-expressible equality filters plus result-mapping-stage filtering
    - When the vector store lacks the new fields, fall back to the keyword path rather than returning results that contradict the filter, reusing the existing degrade logging; keep the response shape identical across strategies
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 20. Checkpoint - Rollout step 4 (single re-index) complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Author agent-asset content and enable the skills type (Rollout step 5)
  - [x] 21.1 Author canonical `AGENTS.md` content for the `agents-md` asset type
    - Author the canonical content for publication through the already-enabled `agents-md` type, reusing the precedence wording verbatim; no registry or DAO change
    - _Requirements: 11.1, 11.8_

  - [x] 21.2 Author the generic `atlantis-platform-resources` skill
    - Author `.kiro/skills/atlantis-platform-resources/SKILL.md` covering scope, precedence, tool routing, `cache-data` query vocabulary, and naming/IAM/deployment guardrails; `name` equals folder name; description within the length limit; precedence wording verbatim
    - _Requirements: 11.2, 11.4, 11.8_

  - [x] 21.3 Convert manual-inclusion procedural steering into `automate-*` skills
    - Convert each manual-inclusion procedural steering doc into a skill preserving its procedure, recording the source `sha256` in `metadata`; leave persistent-convention steering as steering
    - _Requirements: 11.3, 11.4, 11.5_

  - [x] 21.4 Document the flat-asset mapping and enable `skills` after content exists
    - Set the `skills` registry entry `enabled: true` and document the `skills/{skill-name}.md` to `{skill-name}/SKILL.md` convention in its description; order the flag flip after content is published so the type is never advertised empty
    - _Requirements: 11.6, 11.7, 11.9_

  - [x] 21.5 Write property test for skill format conformance
    - **Property 13: Skill format conformance** — each authored skill has a `SKILL.md` whose `name` equals the folder name, with `name` and `description` within their length limits
    - **Validates: Requirements 11.4, 11.5**

- [x] 22. Add cross-layer integration tests (R15.1)
  - [x] 22.1 Write integration tests for catalog, manifest, filters, and degradation
    - `tools/list` and `list_tools` return byte-identical tool arrays; a no-match `search_documentation` still returns `indexedRepositories`; a filtered call returns only matching repositories and a `repository` facet; an oversized result set with a large corpus degrades the manifest rather than truncating results
    - _Requirements: 15.3, 15.5, 15.6, 2.4_

- [x] 23. Update documentation and changelog (R14)
  - [x] 23.1 Update end-user, admin-ops, developer docs, ARCHITECTURE.md, and CHANGELOG.md
    - End-user: new filters, `indexedRepositories` with a discover-then-filter example, `cache-data` query guidance, and the no-code-search statement
    - Admin-ops: `MCP_CORPUS_MANIFEST_MAX_BYTES`, per-type exclusion matrix, three-state classification behavior, and the `atlantis_repository-type` prerequisite
    - Developer + `ARCHITECTURE.md`: registry fan-out, the single `tool-catalog.js` merge, and the `search-common` layer; `CHANGELOG.md` entry under `v0.0.7 (unreleased)` referencing this spec
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [x] 24. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise. Deployed verification of PLAN section 6 success criteria (R15.11) is performed outside this coding plan after the step-4 re-index.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Task groups 1-24 follow the design's five-step Rollout ordering; checkpoints 5, 10, 14, 20, and 24 mark the step boundaries.
- Three-state resolution (task 15) precedes per-type exclusions (task 16) per R9.8; the `search-common` layer (task 1) precedes both Lambdas consuming it (tasks 2 and 18) per R6.3.
- Each task references the specific requirement sub-criteria it implements; property-based tests are placed next to the implementation they guard and annotate both the property number and the requirements clause.
- Property 1 (normalization parity) is the highest-value regression guard and must be able to fail.
- Deployed verification (R15.11) is intentionally not a coding task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.1", "3.1", "4.2"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3", "4.1"] },
    { "id": 4, "tasks": ["4.3", "6.1", "7.1"] },
    { "id": 5, "tasks": ["6.2", "7.2"] },
    { "id": 6, "tasks": ["6.3", "6.4", "6.5", "8.1"] },
    { "id": 7, "tasks": ["8.2", "9.1"] },
    { "id": 8, "tasks": ["11.1", "15.1"] },
    { "id": 9, "tasks": ["11.2", "12.1", "15.2", "16.1"] },
    { "id": 10, "tasks": ["12.2", "12.3", "16.2", "17.1"] },
    { "id": 11, "tasks": ["12.4", "12.5", "13.1", "16.3", "16.4", "17.2"] },
    { "id": 12, "tasks": ["13.2", "13.3", "17.3", "17.4", "18.1", "18.2"] },
    { "id": 13, "tasks": ["18.3", "19.1", "21.1", "21.2", "21.3"] },
    { "id": 14, "tasks": ["21.4"] },
    { "id": 15, "tasks": ["21.5", "22.1", "23.1"] }
  ]
}
```
