# Requirements Document

## Introduction

**Tool Discovery Enhancement.** This feature makes the Atlantis MCP Server the first place an AI agent looks for resources when working in an Atlantis-scaffolded repository, and makes `@63klabs/cache-data` reliably discoverable despite its name not containing "atlantis".

It addresses three independent failures identified in [PLAN.md](PLAN.md): the server never announces its own scope or precedence to an agent; `AGENTS.md` directives are client-side conventions the server has no leverage over and cannot even surface through search; and `cache-data` is structurally unreachable by the queries an agent would naturally write, with no mechanism by which an agent could learn the package exists.

The work spans the Read Function (tool manifest, descriptions, search service, documentation DAO), the Doc Indexer (tokenization, file filtering, repository classification), a shared Lambda Layer (tokenizer parity), and agent-asset content. It adds no new AWS infrastructure beyond configuration.

### Guiding constraints

1. **Additive response shapes.** Every change to a tool response adds optional fields. An existing client that ignores new fields SHALL observe unchanged behavior.
2. **Protocol dependency.** `instructions` delivery and the `Tool.title` / `Tool.annotations` fields are owned by [`0-0-7-mcp-protocol-dual-era`](../0-0-7-mcp-protocol-dual-era/PLAN.md). This spec owns the *content* of `instructions` and the *registry* that supplies `title`/`annotations`; it does not own the wire mechanics.
3. **One re-index.** Changes requiring an index rebuild (tokenization, ranking inputs, file exclusions, vector metadata) are batched into a single index version bump.
4. **Tooling visibility stays public.** No tier-based filtering of `tools/list` is introduced; tier gating remains inside individual tools.
5. **Membership preservation.** Where this spec reorders or rescopes existing retrieval logic, result membership for requests that use no new parameter SHALL be unchanged.
6. **No shared source directories.** Code used by both the Read Function and the Doc Indexer SHALL be delivered as a Lambda Layer, per the multi-resource source organization steering.

### Decisions carried forward from PLAN.md

| # | Decision |
|---|---|
| 1 | Bootstrap discovery is a corpus manifest on every search response, plus a one-line corpus summary in `instructions` — not a new `list_repositories` tool |
| 2 | `tools/list` stays fully public; no tier filtering |
| 3 | File exclusions become per-`repositoryType`; a genuinely absent type excludes nothing |
| 4 | The `skills` agent-asset type is enabled, and a generic Atlantis platform skill is authored |
| 5 | `getCapabilities()` / `negotiateProtocol()` are wired up rather than deleted — owned by the protocol spec |
| 6 | Code search over raw repository source is out of scope |
| 7 | Repository-property resolution distinguishes *absent* from *fetch-failed*; fetch-failed carries forward the prior resolved type |
| 8 | Skill assets are published as flat `{skill-name}.md` with a documented mapping convention |
| 9 | The corpus manifest budget is 4 KB, configurable, degraded manifest-first |
| 10 | `63Klabs/cache-data` carries `atlantis_repository-type: package` (confirmed) |
| 11 | Protocol-revision work is split into `0-0-7-mcp-protocol-dual-era` |

## Glossary

- **System**: The Tool Discovery Enhancement feature as a whole — collectively the Read Function, the Doc Indexer, the Shared Layer, and the agent-asset content. Where an acceptance criterion names a specific component, that component is the responsible one.
- **Read Function**: The `read-function` Lambda that serves the MCP protocol surface and all tool calls.
- **Doc Indexer**: The `doc-indexer` Lambda that crawls repositories and writes the documentation index.
- **Shared Layer**: A Lambda Layer consumed by both the Read Function and the Doc Indexer, following the precedent of `doc-ai-common`.
- **Tool Metadata Registry**: The single configuration module that declares per-tool discovery metadata and fans it out to the tool manifest, the schema validator, and the served descriptions.
- **Published schema**: The `inputSchema` a tool advertises through `tools/list` and `list_tools`.
- **Enforced schema**: The schema the Read Function actually validates a `tools/call` against.
- **Corpus manifest**: An index-wide listing of indexed repositories returned on every `search_documentation` response, independent of what the query matched. Distinct from `availableFilters`.
- **`availableFilters`**: Existing facet block computed over the *matched* result set only.
- **Bootstrap problem**: An agent cannot discover a repository or package whose name it does not already know, because every existing discovery path requires a query that already matches it.
- **Normalization**: The transformation applied to a term to produce its index and lookup token(s) — case folding, hyphenated-identifier splitting, and suffix reduction.
- **Section**: One extracted unit of a source file (a heading span, function, or parameter) — the granularity of a search result.
- **Index version**: The timestamped identifier of a completed index build, pointed to by the active version pointer.
- **Repository type**: The value of the `atlantis_repository-type` GitHub custom property, one of `documentation`, `app-starter`, `templates`, `management`, `package`, `mcp`.
- **Absent**: The repository-property resolution state meaning the custom property is genuinely unset on the repository.
- **Fetch-failed**: The repository-property resolution state meaning the custom-properties call errored, 404'd, or timed out, so the true value is unknown.

## Requirements

### Requirement 1: Server-level instructions content

**User Story:** As an AI agent, I want the server to tell me its scope and precedence at session start, so that I consult it before falling back to training recall or web search.

#### Acceptance Criteria

1. THE Read Function SHALL define the `instructions` string in exactly one module, and both protocol-era carriers SHALL read from that module, so the string cannot diverge between eras.
2. THE `instructions` string SHALL name the Atlantis platform and SHALL explicitly name `@63klabs/cache-data` as in-scope, so that an agent does not conclude a caching question is out of scope.
3. THE `instructions` string SHALL state a precedence directive instructing the reader to query this server before web search or training recall for Atlantis template, naming, pipeline, starter, and `cache-data` questions.
4. THE `instructions` string SHALL include the vocabulary an agent needs to form a successful query — the `cache-data` package name in both its scoped and unscoped forms, the repository-type values, and the template categories.
5. THE `instructions` string SHALL include a one-line summary of the indexed corpus naming the indexed repositories.
6. THE `instructions` string SHALL NOT contain a per-tool routing table or otherwise duplicate content already carried in tool descriptions.
7. THE `instructions` string SHALL be at most 250 words, so that it does not crowd the consuming client's system-prompt budget.
8. WHERE the `instructions` string is served, THE Read Function SHALL report an accurate server version rather than a hardcoded placeholder.

### Requirement 2: Structured tool metadata registry

**User Story:** As a maintainer, I want per-tool discovery metadata declared in one place, so that adding or changing it cannot leave the manifest, validator, and descriptions inconsistent.

#### Acceptance Criteria

1. THE Tool Metadata Registry SHALL be a single module keyed by tool name, and SHALL declare for each tool a display title, behavioral annotations, a category, trigger keywords, related tools, when-to-use and when-not-to-use guidance, and at least one structured usage example.
2. THE Tool Metadata Registry SHALL expose generator functions that fan its content out to the tool manifest, the schema validator, and the served descriptions, following the established registry pattern already used for agent-asset types.
3. WHEN a tool's metadata is added or changed in the Registry as the only source edit THEN that change SHALL be reflected in every surface that serves tool metadata, with no edits to the router, controller, or validator.
4. THE Read Function SHALL merge extended descriptions into the tool manifest in exactly one shared helper, and both the `tools/list` protocol path and the `list_tools` tool path SHALL call that helper rather than implementing the merge independently.
5. THE Read Function SHALL annotate every tool as read-only, since no tool in this server mutates state.
6. WHERE the negotiated protocol revision does not permit a given metadata field on the wire, THE Read Function SHALL omit that field from the response rather than emitting an invalid tool definition, and the remaining registry-sourced metadata SHALL still be served.
7. THE Read Function SHALL return tool definitions in a deterministic order, so that identical inputs produce identically ordered results and client-side caching is possible.
8. THE Read Function SHALL NOT filter the tool list by caller tier; every tool SHALL be visible to every caller including unauthenticated callers.

### Requirement 3: Published and enforced schema equivalence

**User Story:** As an AI agent, I want the schema I am shown to be the schema I am validated against, so that a call I believe is well-formed is not rejected.

#### Acceptance Criteria

1. FOR every tool, THE published schema and the enforced schema SHALL be equivalent, such that any input accepted by one is accepted by the other and any input rejected by one is rejected by the other.
2. THE System SHALL derive the published and enforced schemas from a single definition, or SHALL assert their equivalence in an automated test that fails when they diverge.
3. WHERE a constraint is enforced but was not previously published — including minimum lengths, character patterns, additional-property restrictions, and parameters accepted by the validator but absent from the manifest — THE published schema SHALL be corrected to disclose it.
4. THE equivalence guarantee SHALL hold for registry-generated tools as well as literally declared tools.

### Requirement 4: Tool description trigger coverage

**User Story:** As an AI agent, I want each tool's description to tell me when to call it in the words I would use, so that I select the right tool without trial and error.

#### Acceptance Criteria

1. EACH served tool description SHALL open with the condition under which the tool should be called, before describing the mechanism by which it works.
2. EACH served tool description SHALL name the concrete identifiers an agent is likely to have in context for that tool's domain, including template filenames, `cache-data`, `CacheableDataAccess`, `samconfig`, `buildspec.yml`, and the `Prefix-ProjectId-StageId` naming form where relevant.
3. THE `search_documentation` description SHALL state that the indexed corpus includes the Atlantis platform's companion packages, naming `cache-data`, so that an agent does not treat a caching question as out of scope.
4. THE Read Function SHALL warn at initialization when a tool in the manifest has no extended description, in addition to the existing warning for an extended description with no matching tool.
5. THE System SHALL correct existing typographical errors in served tool descriptions.
6. EACH served tool description SHALL state at least one failure mode or error condition for that tool, so that an agent can handle failure without a retry loop.

### Requirement 5: Repository, type, and namespace filters on documentation search

**User Story:** As an AI agent, I want to narrow a documentation search to a specific repository, so that I can read `cache-data` documentation without competing results from other repositories.

#### Acceptance Criteria

1. THE `search_documentation` tool SHALL accept optional `repository`, `repositoryType`, and `namespace` filters, and WHEN any is supplied THE Read Function SHALL return only sections whose corresponding stored metadata matches.
2. WHEN a supplied filter value matches no indexed section THEN THE Read Function SHALL return a successful response with an empty result set and SHALL NOT return an error.
3. THE Read Function SHALL honor the existing `ghusers` filter on the keyword retrieval path, so that a narrowing request that is accepted and validated also takes effect; alternatively, IF `ghusers` is not honored THEN it SHALL be removed from the published schema rather than accepted and ignored.
4. THE Read Function SHALL include every new filter in the search cache key, so that a cached result set produced under one filter combination is never served for a different combination.
5. THE `availableFilters` facet block SHALL report `repository` values with counts over the matched result set, in addition to the existing `type` and `subType` facets.
6. WHEN no new filter is supplied THEN the returned result membership and ordering SHALL be identical to the behavior before this requirement was implemented.
7. WHERE a filter is applied, THE Read Function SHALL apply it such that the candidate set evaluated is not reduced below the requested result limit by the filter being applied after candidate selection.

### Requirement 6: Hyphenated-identifier and morphological normalization

**User Story:** As an AI agent, I want a query for "caching" to reach documentation about `cache-data`, so that I find the right material without already knowing the package name.

#### Acceptance Criteria

1. THE Doc Indexer SHALL store, for each indexed term, both the term as written and its normalized forms, including the component parts of a hyphenated identifier.
2. THE Read Function SHALL look up both the query term as written and its normalized forms, and SHALL aggregate relevance across all forms that match.
3. THE Read Function and the Doc Indexer SHALL obtain normalization from one implementation delivered as a Shared Layer, so that index-time and query-time normalization cannot diverge.
4. WHEN a query term is a single word that is a suffixed form of an indexed term THEN THE Read Function SHALL match the indexed term, so that "caching" reaches content written as "cache".
5. WHEN a query names a hyphenated identifier in full THEN THE Read Function SHALL continue to match that identifier at least as strongly as before this requirement was implemented.
6. WHILE the active index version predates this normalization change, THE Read Function SHALL continue to return results for queries that matched before the change, so that search does not regress between deployment and the completion of the next index build.
7. THE System SHALL verify normalization parity with an automated test asserting that a representative set of query terms and indexed terms produce matching token sets through the single shared implementation.

### Requirement 7: Relevance ranking inputs

**User Story:** As an AI agent, I want authoritative repositories to outrank incidental mentions, so that the first result for a `cache-data` question comes from `cache-data`.

#### Acceptance Criteria

1. THE System SHALL contribute a relevance signal from a match in the repository name and from a match in the file path, in addition to the existing title, excerpt, and keyword signals.
2. THE System SHALL weight sections by repository type, such that a section from a `package` or `documentation` repository is not outranked by an incidental lower-value section from an unrelated repository at equal textual relevance.
3. THE Read Function SHALL select the candidate window after applying filters and after applying the exact-phrase boost, or SHALL widen the candidate window while a filter is active, so that a result that would satisfy the request is not discarded before it is evaluated.
4. WHEN no filter is supplied and no new ranking signal applies to any candidate THEN the returned ordering SHALL be identical to the behavior before this requirement was implemented.
5. THE semantic and semantic-assisted retrieval paths SHALL remain ranked by vector similarity, and the keyword-path ranking changes SHALL NOT be applied to them.

### Requirement 8: Indexed-repository corpus manifest

**User Story:** As an AI agent that has never heard of `cache-data`, I want every search response to tell me what repositories exist, so that a query returning nothing still teaches me what I could have asked for.

#### Acceptance Criteria

1. THE Read Function SHALL include a corpus manifest on every `search_documentation` response, naming the indexed repositories, independent of what the query matched.
2. WHEN a `search_documentation` request matches no sections THEN the response SHALL still include the corpus manifest, so that the bootstrap problem is addressed on exactly the queries that fail.
3. EACH full corpus manifest entry SHALL carry the repository name, owner, repository type, namespace, indexed section count, and the indexed ref or tag.
4. THE corpus manifest SHALL be named distinctly from `availableFilters`, and the two SHALL be separately identifiable in the response.
5. THE Read Function SHALL derive the corpus manifest from the index at the active index version, and SHALL cache it independently of any individual query so that it is computed once per index version rather than once per query.
6. WHEN the active index version changes THEN THE Read Function SHALL serve a corpus manifest reflecting the new version rather than a stale cached one.
7. THE corpus manifest SHALL be subject to a configurable byte budget defaulting to 4 KB.
8. WHEN the full corpus manifest would exceed its byte budget THEN THE Read Function SHALL degrade it to a compact form carrying repository name and repository type only; and WHEN the compact form would also exceed the budget THEN THE Read Function SHALL degrade it to a repository count with an indication that the listing was omitted.
9. THE Read Function SHALL measure the corpus manifest together with the result payload against the response size threshold, and SHALL degrade the corpus manifest before truncating results, so that the manifest can never be the cause of a caller's requested results being truncated.
10. THE corpus manifest SHALL be an additive response field, and a client that ignores it SHALL observe otherwise unchanged response behavior.

### Requirement 9: Per-repository-type file exclusions and three-state property resolution

**User Story:** As an AI agent asking a version or migration question about a package, I want that package's changelog to be searchable, without the index silently changing shape when an unrelated API has a bad day.

#### Acceptance Criteria

1. THE Doc Indexer SHALL resolve each repository's classification into exactly three distinguishable states — a known repository type, *absent*, and *fetch-failed* — rather than collapsing the latter two into a single empty value.
2. THE repository-property resolution SHALL continue to never throw and never fail an index build, preserving its current fault-tolerance contract while reporting the additional state.
3. THE Doc Indexer SHALL apply file-exclusion rules per repository type, replacing the single global exclusion set.
4. WHERE a repository resolves to a known repository type, THE Doc Indexer SHALL apply that type's exclusion policy; and FOR a `package` repository THE policy SHALL permit indexing the changelog, since version and migration questions depend on it.
5. WHERE a repository resolves to *absent*, THE Doc Indexer SHALL exclude no files for that repository.
6. WHERE a repository resolves to *fetch-failed*, THE Doc Indexer SHALL carry forward the repository type resolved in the previous index version; and IF no previous resolution exists THEN it SHALL apply the global default exclusion policy.
7. WHEN two consecutive index builds see the same repository content and the same successfully resolved properties THEN the set of indexed files for that repository SHALL be identical, so that the index is deterministic with respect to transient upstream failures.
8. THE System SHALL implement the three-state resolution before the per-type exclusion policy depends on it.

### Requirement 10: Semantic retrieval parity for new filters

**User Story:** As a paid-tier agent using semantic search, I want the same repository filters to work, so that retrieval behavior does not depend on which strategy happens to be selected.

#### Acceptance Criteria

1. THE System SHALL persist repository type and namespace in the vector store metadata, so that the semantic path can filter on the same fields as the keyword path.
2. WHEN a `repository`, `repositoryType`, or `namespace` filter is supplied and a semantic strategy is selected THEN THE Read Function SHALL apply that filter to the semantic result set.
3. WHILE the vector store has not yet been rebuilt with the additional metadata, THE Read Function SHALL apply the new filters without returning results that contradict them, degrading to the keyword path if the filter cannot be satisfied on the semantic path.
4. THE `search_documentation` response shape SHALL be identical whichever retrieval strategy produced it, including the corpus manifest and the facet block.

### Requirement 11: Agent assets — canonical AGENTS.md and skills

**User Story:** As an AI agent working in a scaffolded repository, I want to fetch authoritative platform guidance from the server, so that I am not dependent on whether a local file happened to be read into context.

#### Acceptance Criteria

1. THE System SHALL author canonical `AGENTS.md` content for publication through the existing, already-enabled `agents-md` asset type, requiring no change to the agent-asset registry or data-access layers.
2. THE System SHALL author a generic platform skill applicable to any repository scaffolded from an Atlantis starter, covering the server's scope, precedence, tool routing, query vocabulary for `cache-data`, and the platform's naming, IAM, and deployment guardrails.
3. THE System SHALL convert each manual-inclusion procedural steering document into a skill, preserving its procedure, and SHALL leave persistent-convention steering documents as steering.
4. EACH authored skill SHALL satisfy the skill file format: a folder containing a `SKILL.md` whose name field equals the folder name and whose description is within the published length limit.
5. EACH converted skill SHALL record the content identity of the steering asset it was derived from, so that later divergence from the published source is detectable.
6. THE `skills` registry entry SHALL document the flat-asset-to-folder mapping convention in its description, since that description is the only place a consuming agent will encounter it.
7. THE System SHALL NOT enable the `skills` asset type until at least one skill asset is published for it, so that the type is never advertised while empty.
8. THE precedence directive SHALL be stated consistently across the `instructions` string, the canonical `AGENTS.md` asset, and the platform skill, so that a client reading any combination of them receives no conflicting guidance.
9. WHERE an asset type is enabled, THE System SHALL be able to report a non-zero asset count for it.

### Requirement 12: Discovery observability

**User Story:** As a maintainer, I want to measure whether discovery improved, so that the next change is informed by data rather than anecdote.

#### Acceptance Criteria

1. THE Read Function SHALL log, for each `search_documentation` call, the query token count, which filters were applied, the result count, the retrieval strategy used, and whether the result set was empty.
2. THE Read Function SHALL log the invoked tool name for each tool call, such that tool-selection frequency is derivable from logs.
3. THE Read Function SHALL log which tool is invoked first within a session, as the practical measure of whether the `instructions` string is influencing agent behavior.
4. THE System SHALL expose a zero-result count for `search_documentation` as a CloudWatch metric, so that queries finding nothing are trackable over time.
5. THE System SHALL NOT log query text together with caller identity, nor log any authentication credential or personally identifying information.
6. THE System SHALL record a zero-result baseline before the filter and ranking changes are deployed, so that their effect is measurable.

### Requirement 13: Backward compatibility

**User Story:** As an operator with existing clients in the field, I want this release to be non-breaking, so that I can deploy without coordinating client updates.

#### Acceptance Criteria

1. EVERY new field added to a tool response SHALL be optional and additive, and a client that ignores all new fields SHALL observe unchanged behavior.
2. THE System SHALL NOT remove or rename any existing tool, tool parameter, or response field.
3. WHEN a request supplies only parameters that existed before this release THEN the response SHALL be semantically equivalent to the pre-release response, allowing for additive fields.
4. WHERE cache keys change shape, THE System SHALL ensure a cache entry written before the change cannot be served as though it satisfied a new filter.
5. THE System SHALL preserve the existing truncation and chunk-retrieval contract for oversized responses.

### Requirement 14: Documentation

**User Story:** As a user and operator, I want the new behavior documented, so that I can adopt it and operate it.

#### Acceptance Criteria

1. THE end-user tools reference SHALL document the new `search_documentation` filters and the corpus manifest, including at least one example showing how an agent discovers a repository name from a response and then filters on it.
2. THE end-user documentation SHALL document the `cache-data` query guidance — that the corpus includes companion packages and which terms reach them.
3. THE admin-ops documentation SHALL document the corpus manifest byte budget setting and the per-repository-type exclusion policy, including the behavior on *absent* and *fetch-failed* classification.
4. THE developer documentation and `ARCHITECTURE.md` SHALL describe the Tool Metadata Registry fan-out, the single description-merge helper, and the Shared Layer that provides normalization to both Lambdas.
5. THE documentation SHALL record that setting `atlantis_repository-type` on every indexed repository is an operational prerequisite for repository-type weighting and per-type exclusions to behave as intended.
6. THE `CHANGELOG.md` SHALL record the feature under the unreleased version, referencing this spec.
7. THE documentation SHALL state that code search over raw repository source is not provided.

### Requirement 15: Testing and verification

**User Story:** As a maintainer, I want this covered by tests in the existing framework, so that it is safe to deploy through CI/CD.

#### Acceptance Criteria

1. THE new tests SHALL follow the existing Jest layout for the affected resource, with per-layer unit tests under `tests/unit/<layer>/` and cross-layer tests under `tests/integration/`.
2. THE new tests SHALL assert that the `instructions` string is non-empty, within its word limit, names both the platform and `cache-data`, and is served from a single source.
3. THE new tests SHALL assert published and enforced schema equivalence for every tool, and SHALL fail when the two diverge.
4. THE new tests SHALL assert that a query for a suffixed form of an indexed term matches, that a hyphenated identifier still matches when named in full, and that index-time and query-time normalization produce matching token sets.
5. THE new tests SHALL assert that a search matching no sections still returns the corpus manifest, and that the manifest degrades through each tier of its budget ladder rather than causing result truncation.
6. THE new tests SHALL assert that each new filter narrows results as specified, participates in the cache key, and leaves membership and ordering unchanged when not supplied.
7. THE new tests SHALL assert the three repository-property resolution states and the exclusion policy selected for each, including carry-forward on *fetch-failed* and the global default when no prior resolution exists.
8. THE new tests SHALL assert that each authored skill satisfies the skill file format and frontmatter limits.
9. WHERE an existing test asserts a contract this feature changes — including tool-manifest reference identity and the `initialize` response shape — THE System SHALL update that test as part of this work rather than leaving it to fail.
10. THE new and existing Jest test suites SHALL complete with zero failing tests before the change is considered complete.
11. THE System SHALL verify the success criteria in [PLAN.md](PLAN.md) section 6 against a deployed environment, since index-dependent retrieval behavior cannot be fully verified by unit tests.

---

## Out of scope

- **Code search over raw repository source.** Decision 6. Source files remain indexed only as extracted sections.
- **Protocol-revision mechanics.** `instructions` delivery, `server/discover`, per-request version negotiation, and the wire legality of `title`/`annotations` belong to [`0-0-7-mcp-protocol-dual-era`](../0-0-7-mcp-protocol-dual-era/PLAN.md).
- **Tier-based filtering of `tools/list`.** Decision 2.
- **Multi-file or bundled skill assets.** Decision 8 caps published skills at a single file; archive support is deferred until a skill requires bundled resources.
- **Publishing assets to S3.** Owned by the source repository's pipeline. This spec authors content and specifies the convention; it does not publish.
- **Setting GitHub custom properties on the organization's repositories.** An operational prerequisite recorded in Requirement 14, not a code change in this repository.
- **Populating `atlantis_namespace`.** Currently unset on every indexed repository; the `namespace` filter is specified here but has no data to act on until this operational decision is made separately.
- **A server-side query-embedding cache or any new AI retrieval mode.** Unchanged from the current implementation.
