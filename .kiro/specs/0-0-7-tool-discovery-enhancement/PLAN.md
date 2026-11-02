# Tool Discovery Enhancement

Planning document for v0.0.7. Scope: make the 63Klabs Atlantis MCP server the first place an agent looks for resources in an Atlantis-scaffolded repository, and make `@63klabs/cache-data` reliably discoverable even though its name does not contain "atlantis".

All open questions from the first draft are now resolved; see [section 7](#7-resolved-decisions). Protocol-revision work has been split into its own spec, [`0-0-7-mcp-protocol-dual-era`](../0-0-7-mcp-protocol-dual-era/PLAN.md), which this spec depends on for WS1 and WS2.

---

## 1. Problem statement

Three distinct discovery failures, with different root causes:

1. **The server never tells the agent it exists or when to use it.** Tool selection today depends entirely on an agent reading 17 tool descriptions and inferring relevance. There is no server-level instruction, no tool grouping, no trigger vocabulary, and no "start here" signal.
2. **AGENTS.md directives are not reliably actionable.** `AGENTS.md` is a client-side convention. Whether a directive in it gets picked up depends on the client reading the file into context — the MCP server has no part in it. Worse, `AGENTS.md` is explicitly excluded from the documentation index, so the server cannot even surface its own guidance through search.
3. **`cache-data` is structurally hard to find.** It is indexed only incidentally (as a public `63Klabs` repo), its name tokenizes to a single hyphenated token that common queries never match, there is no repository-level filter, and nothing in the ranking recognizes it as a first-class Atlantis component.

---

## 2. Current state

Verified against the code; file references are the insertion points for each workstream.

### 2.1 Tool definition and discovery

| Concern | Location | State |
|---------|----------|-------|
| Tool manifest (name, description, inputSchema) | `read-function/config/settings.js` (`settings.tools.availableToolsList`, ~L213-538) | 13 literal tools + 4 generated |
| Generated agent-asset tools | `read-function/config/agent-asset-types.js` (registry + `generateToolDefinitions`) | `steering`, `hooks`, `agents-md` enabled; `skills` disabled |
| Extended descriptions (what is actually served) | `read-function/config/tool-descriptions.js` | Markdown map, overlays the short description at response time |
| Enforced input schemas | `read-function/utils/schema-validator.js` (`baseSchemas`) | **Parallel, stricter copy** of the published `inputSchema` |
| `tools/list` + `initialize` + `tools/call` | `read-function/utils/json-rpc-router.js` | Description merge duplicated here and in `controllers/tools.js` |
| `initialize` response | `read-function/utils/mcp-protocol.js` (`initializeResponse`) | `protocolVersion: '2024-11-05'`, `serverInfo.version` hardcoded `'0.0.1'`, **no `instructions`** |
| `list_tools` controller | `read-function/controllers/tools.js` | Returns `{ name, description, inputSchema }` only |

What does **not** exist anywhere: tool `title`, `annotations`, `icons`, `outputSchema`, keywords, synonyms, aliases, categories, related-tool links, usage examples as structured data, or tier-based filtering of `tools/list`. The only in-band "what next" guidance is the prose `retrievalHint` on the three truncation summaries (`buildTemplateSummary`, `buildDocumentSummary`, `buildAgentAssetSummary`).

### 2.2 Documentation search

- Repository set is **discovery-based, not list-based**: `AtlantisGitHubUserOrgs` (`template.yml` ~L319, default `63Klabs`) → every public repo in the org is crawled (`doc-indexer/lib/github-client.js` `listRepositories`). No per-repo allow-list, no per-repo configuration.
- Classification comes from GitHub custom properties `atlantis_repository-type` and `atlantis_namespace` (`github-client.js` `getRepositoryProperties`), best-effort, `null` on any failure. Valid types are enumerated in `settings.js` `github.validRepositoryTypes`: `documentation`, `app-starter`, `templates`, `management`, `package`, `mcp`. **Confirmed: `63Klabs/cache-data` is `package`.**
- `repositoryType` and `namespace` are carried onto every result **but are not filterable and do not affect ranking** on either the keyword or semantic path.
- Keyword tokenization (`read-function/models/doc-index.js` `extractQueryKeywords`): lowercase, strip non-alphanumeric except hyphen, drop tokens ≤ 2 chars and 13 stop words. **No stemming, no synonyms, no fuzzy matching.** Lookup is exact equality against `pk = search:{token}`.
- Index-time weights (`doc-indexer/lib/index-builder.js`): `titleMatch: 10`, `excerptMatch: 5`, `keywordMatch: 3`, multiplied by `TYPE_WEIGHTS` (`documentation: 1.0`, `template-pattern: 0.9`, `code-example: 0.8`). Query-time `EXACT_PHRASE_BOOST: 20`. No path, repository-name, or repository-type boosting.
- `ghusers` is accepted by the `search_documentation` schema and validated in `services/documentation.js`, but **never passed to the keyword query** — it only varies the cache key. On the semantic path it maps to a store filter only when exactly one org is requested.
- Candidate window: `ranked.slice(0, limit * 3)` happens **before** filtering and before the phrase boost (`doc-index.js`), so a lower-ranked repo can be dropped before it is ever considered.
- `file-filter.js` excludes `AGENTS.md`, `CHANGELOG.md`, `SECURITY.md`, `LICENSE.md`, `CONTRIBUTING.md` from indexing. YAML is indexed only when it matches `template*.yml`.
- There is **no code search**. `.js`/`.jsx`/`.py` are indexed as extracted `code-example` doc sections (lowest type weight), not raw bodies. **Out of scope for this release.**

### 2.3 Why `cache-data` gets missed — concrete mechanics

| Query an agent would plausibly write | Why it misses |
|---|---|
| `cache` | `cache-data` is one token; `cache` is a different partition key |
| `caching in lambda` | `in` is dropped (≤ 2 chars); no stemming, so `caching` never matches a doc that says "cache" |
| `atlantis caching` | No server-side "atlantis" bias exists, but the tool description says "Search **Atlantis** documentation", biasing the agent's own query wording toward a token that cache-data docs may not contain |
| `cache-data installation` | Works — exact phrase boost fires. Requires the agent to already know the package name |
| anything broad | `limit * 3` pre-filter slice can drop cache-data before filtering |

The compounding problem: an agent that does not already know the string `cache-data` has no way to learn it. Nothing enumerates the indexed repositories or packages.

### 2.4 Agent-asset inventory (measured, not assumed)

Queried live against the production server:

| Type | Enabled | Asset count |
|---|---|---|
| `steering` | yes | 6 |
| `hooks` | yes | **0** |
| `agents-md` | yes | **0** |
| `skills` | no | n/a |

Two types are advertised in the `assetType` enum and return empty lists. This matters for WS5: the plumbing to publish a canonical `AGENTS.md` already exists and is already advertised — it simply has no content behind it. Advertising an empty type is a discovery anti-signal, since an agent that checks `agents-md` once and gets nothing has no reason to check again.

The six steering assets are:

| Asset | Size | Shape |
|---|---|---|
| `atlantis-multi-resource-src.md` | 12.6 KB | Persistent convention — correctly steering |
| `atlantis-python-dependency-management.md` | 4.0 KB | Persistent convention — correctly steering |
| `atlantis-webapi-node-cache-data.md` | 18.6 KB | Persistent convention — correctly steering |
| `automate-audit-update-npm-packages.md` | 5.4 KB | `inclusion: manual` procedure — **skill candidate** |
| `automate-audit-update-python-packages.md` | 9.5 KB | `inclusion: manual` procedure — **skill candidate** |
| `automate-update-lambda-layers.md` | 2.0 KB | `inclusion: manual` procedure — **skill candidate** |

---

## 3. Proposed workstreams

Ordered by leverage per unit of effort.

### WS1 — Server-level `instructions` (highest leverage)

The MCP specification carries an optional `instructions` string whose documented purpose is to improve the model's understanding of the server, explicitly suitable for inclusion in a system prompt. This is delivered unconditionally at session start, before any tool call, and is the only mechanism that reaches the agent without it first deciding to look.

**Two carriers, one string.** In the legacy (handshake) era it is `InitializeResult.instructions`; in the modern (stateless) era it is `DiscoverResult.instructions` on `server/discover`. Both are served from a single `config/server-instructions.js`. The delivery mechanics belong to [`0-0-7-mcp-protocol-dual-era`](../0-0-7-mcp-protocol-dual-era/PLAN.md); the *content* belongs here.

Content, kept tight (target 150-250 words — this competes for system-prompt budget):

- One sentence on what the server authoritatively owns: Atlantis CloudFormation templates, app starters, naming conventions, agent assets, and the documentation for the Atlantis platform **and its companion packages, including `@63klabs/cache-data`**.
- An explicit precedence directive: for Atlantis template, naming, pipeline, starter, and `cache-data` questions, query this server before web search or training recall.
- The package-name vocabulary an agent needs: `@63klabs/cache-data` / `cache-data`, the `repositoryType` values, the template categories.
- A one-line summary of the indexed corpus, naming the repositories (decision 1b).

**Deliberately excluded:** a question-shape → tool decision table. The modern schema's own guidance is that `instructions` should help the model use the server effectively and should *not* duplicate what is already in tool descriptions. Routing guidance belongs in the WS2 metadata and WS3 descriptions, not here.

Also fix `serverInfo.version`, currently hardcoded `'0.0.1'`.

### WS2 — Structured tool metadata layer

Introduce `read-function/config/tool-metadata.js` as a single registry keyed by tool name, following the established `agent-asset-types.js` fan-out pattern (`generate*` functions consumed by settings, validator, descriptions, and dispatch). Fields per tool:

- `title` — human-readable display name (MCP `Tool.title`)
- `annotations` — `readOnlyHint: true` for every tool here (all are reads), `openWorldHint` as appropriate
- `category` — `templates` | `starters` | `documentation` | `agent-assets` | `conventions` | `meta`
- `keywords` — trigger vocabulary for agent-side matching, including the terms an agent would actually use ("caching", "ttl", "dynamodb cache", "s3 cache", "lambda cache" → documentation tools)
- `relatedTools` — explicit next-step graph, replacing prose cross-references
- `whenToUse` / `whenNotToUse` — one line each
- `examples` — structured `{ description, arguments }` pairs

`title` and `annotations` are only wire-legal on newer protocol revisions, so those two fields depend on the dual-era spec landing. `category`, `keywords`, `relatedTools`, `whenToUse`, and `examples` are server-internal and can be folded into the description text on any revision, so this workstream is not blocked end to end.

Two follow-on cleanups this forces, both worth doing:

1. **De-duplicate the description merge.** It exists twice (`json-rpc-router.js` `tools/list` case and `controllers/tools.js`). Extract one helper (`utils/tool-catalog.js`) that both call. Any discovery metadata added in only one place is a latent inconsistency.
2. **Reconcile the two schemas.** `settings.js` publishes one `inputSchema`; `schema-validator.js` enforces a stricter one (extra `minLength`, `pattern`, `additionalProperties: false`, and a `namespace` property `list_templates` does not advertise). An agent cannot see the constraints it will be validated against. Either derive the published schema from the enforced one, or assert equivalence in a test.

### WS3 — Description rewrite for trigger coverage

Rewrite the extended descriptions in `tool-descriptions.js` with retrieval, not prose quality, as the objective:

- Front-load the trigger condition, not the mechanism ("Call this when the user asks about…").
- Name the concrete nouns an agent will have in context: template names, `cache-data`, `CacheableDataAccess`, `samconfig`, `buildspec.yml`, `template-pipeline.yml`, `Prefix-ProjectId-StageId`.
- `search_documentation` currently says "Search Atlantis documentation" — widen to name the companion packages explicitly, so the agent does not conclude a `cache-data` question is out of scope.
- Fix the `stadards` typo in the `list_starters` description (`settings.js` ~L308).
- Add a `validateDescriptions()` check for tools *missing* an extended description (today it only warns on extra keys).

### WS4 — `cache-data` discoverability

The substantive work. Sub-items are independently shippable.

**4a. Repository and type filters on `search_documentation`.** Add optional `repository`, `repositoryType`, and `namespace` filters. The metadata is already stored on every result; it is simply not queryable. Requires extending the facet builder in `services/documentation.js` and the push-down/post-filter in `doc-index.js`.

**4b. Fix `ghusers` on the keyword path.** It is advertised and validated but silently ignored (`services/documentation.js` → `Models.DocIndex.queryIndex` call omits it). Honoring it requires the repository metadata to be filterable, so this folds into 4a.

**4c. Hyphenated-identifier and morphological tokenization.** At index time, emit *both* the hyphenated token and its parts for hyphenated identifiers (`cache-data` → `cache-data`, `cache`, `data`), and apply light suffix normalization (`caching` → `cache`, `templates` → `template`) symmetrically at index and query time. This is the single change that makes `cache`, `caching`, and `caching in lambda` reach cache-data docs. Must be applied on both sides or it silently breaks existing matches.

**4d. Ranking adjustments.**
- Boost matches in the repository name and file path, not just title/excerpt.
- Add a `repositoryType` weight so `package` and `documentation` repos are not outranked by incidental `code-example` sections from unrelated repos. `cache-data` is confirmed `package`, so this weight has a real value to key on.
- Move the `limit * 3` slice to **after** filtering and the phrase boost, or widen the candidate window when a filter is active. The current order can drop a correct result before it is evaluated.

**4e. Corpus manifest on every search response** (decision 1a, replaces the `list_repositories` tool from the first draft). Emit the full indexed-repository list — `name`, `owner`, `repositoryType`, `namespace`, indexed section count, indexed ref/tag — as a block on *every* `search_documentation` response, independent of what matched.

The distinction from `availableFilters` is the whole point. `availableFilters` is computed over the matched set, so it can only report `cache-data` on a query that already found `cache-data` — useless for the bootstrap problem. The corpus manifest is computed over the index, so a query that returns nothing still teaches the agent what exists and what it could have filtered to. Design notes:

- Derive from the main index at the active version, cache aggressively (there is already an unused `TTL_NAMESPACE_LIST` setting to model this on); it changes only on an index build.
- Name it distinctly from `availableFilters` so the two are not confused. Suggested: `indexedRepositories`.
- Pair with the one-line summary in `instructions` (decision 1b) so the agent often knows before it even queries.

**Byte budget (decision 9).** Sized against measured values rather than assumed ones:

| Measurement | Value | Source |
|---|---|---|
| Response size threshold | 50,000 bytes | `utils/content-sizer.js` `DEFAULT_SIZE_THRESHOLD`, overridable via `MCP_CONTENT_SIZE_THRESHOLD` |
| Public repos in `63Klabs` | 13 | GitHub org API, `public_repos` |
| Typical 10-result search response | ~4.9 KB | Live `search_documentation` call |
| Full manifest entry | ~115 bytes | `{name, owner, repositoryType, namespace, sections, ref}` |
| Full manifest today | **~1.6 KB** | 13 entries plus wrapper |

So at the present corpus the full manifest costs about 3% of the size threshold and about a third of a typical response. Affordable without degradation.

Budget: **4 KB**, configurable as `MCP_CORPUS_MANIFEST_MAX_BYTES` mirroring the existing threshold setting. That leaves roughly 2.5x headroom over today's footprint — the cap will not bind for a long time — while staying under 10% of the response threshold.

Degradation ladder when the budget is exceeded:

1. **Full** — `name`, `owner`, `repositoryType`, `namespace`, section count, indexed ref. Used up to 4 KB.
2. **Compact** — `name` and `repositoryType` only, at roughly 35 bytes per entry. That absorbs several hundred repositories within the same 4 KB, so this tier is effectively the terminal one.
3. **Count only** — a repository count plus a note that the list was omitted. Should never be reached in practice; include it so the response shape is total.

**The binding rule, more important than the number:** measure the manifest and the results *together* against the 50 KB threshold, and degrade the manifest **first**. The manifest must never be the thing that pushes a response into truncation, because truncating results the caller explicitly asked for in order to carry a corpus listing they did not ask for is a bad trade at any size.

**4f. Per-`repositoryType` file-exclusion rules** (decision 3). Replace the global `EXCLUDED_FILES` set in `file-filter.js` with a per-`repositoryType` policy. `isIndexable(filePath)` becomes `isIndexable(filePath, repositoryType)`, and `processRepository` passes the type it already resolved. For a `package` repo such as `cache-data`, `CHANGELOG.md` is high-value (version and migration questions). **When `repositoryType` is `null`, no files are excluded.**

**Absent vs fetch-failed (decision 7).** `getRepositoryProperties` currently collapses two very different situations into the same `null`: the property is genuinely unset, and the GitHub custom-properties call failed. It is documented as never failing a build, so the failure path is silent. Left as-is, "null excludes nothing" means a transient API failure silently widens a repo's indexed file set for that build — `LICENSE.md`, `CONTRIBUTING.md`, `SECURITY.md` all become indexable — and the next build silently narrows it again. Index churn driven by an unrelated API's availability reads as nondeterminism.

The two cases must therefore be distinguished:

| Resolution | Meaning | Exclusion policy |
|---|---|---|
| A known type (`package`, `templates`, …) | Property set | That type's policy |
| Absent | Property genuinely unset | **Exclude nothing** (decision 3) |
| Fetch failed | API error, 404, timeout | Carry forward the previous index version's resolved type; if there is none, fall back to the global default exclusions |

Implementation notes: `getRepositoryProperties` needs a third state in its return value rather than a bare `null` — its current contract of "never throws, returns null" is correct and should be preserved, just made more informative. Carry-forward has precedent: the indexer already reads the prior index version to reuse embeddings (`loadPriorEmbeddings`), and the resolved type is already persisted on every entry, so the lookup exists.

> **Observed today:** `atlantis-mcp` — this very repository — returns `repositoryType: null` in live search results, as does `namespace` for *every* result across all repositories. So the absent branch is not hypothetical; it is the current state for at least one repo. Two consequences worth acting on independently of this spec: (a) set `atlantis_repository-type` on all 13 org repos so that `null` means "genuinely unknown" rather than "nobody got round to it"; (b) the `namespace` filter proposed in 4a currently has nothing to filter on, so either populate `atlantis_namespace` or drop `namespace` from the filter set and keep it as a passthrough display field.

**4g. Semantic path parity.** Vector metadata (`vector-store-s3.js`) stores `type`, `subType`, `repository`, `owner` but **not** `repositoryType` or `namespace`, and only `type` and single-owner are expressible as store filters. Adding the new filters to the semantic path requires a re-index. Sequence 4a/4c/4d before this so one re-index covers everything.

### WS5 — Agent assets: AGENTS.md efficacy and skills

Answering the original question directly: **no, AGENTS.md directives are not good enough on their own.** They are only effective if the client reads the file into context; the MCP server has no leverage over that. Compounding it, the `agents-md` asset type is enabled but empty (section 2.4), so the one channel the server *does* control is currently serving nothing.

1. Treat `instructions` (WS1) as the server-side equivalent of AGENTS.md — the only channel the server controls that reaches the model pre-emptively.
2. Publish a canonical Atlantis `AGENTS.md` through the existing, already-enabled `agents-md` type. No code change required, only content.
3. **Enable the `skills` asset type** (decision 4) and publish skills. See WS5a for the blocker.
4. Make `instructions`, the `agents-md` asset, and the platform skill state the same precedence rule in the same words, so a client that reads any combination of them does not get conflicting guidance.

#### WS5a — Blocker: the skill asset format does not match the skill file format

The `skills` registry entry in `agent-asset-types.js` declares `folder: 'skills'`, `extensions: ['.md']`, and the DAO builds flat keys of the form `{namespace}/{basePath}/skills/{name}`. A Kiro skill, however, is **always a folder containing a file named exactly `SKILL.md`**, with `name` frontmatter that must equal the folder name, and optional `scripts/`, `references/`, and `assets/` subfolders. A flat `.md` is not a loadable skill.

Nesting the S3 keys does not work either: `list_agent_assets` lists with `Delimiter: '/'`, and the `name` schema is `^[^/\\]+$`, so `my-skill/SKILL.md` would neither list nor be retrievable.

**Resolution: option (i), flat file plus a documented mapping convention** (decision 8).

```text
S3:    {namespace}/utilities/v2/agent_assets/skills/{skill-name}.md
Local: .kiro/skills/{skill-name}/SKILL.md
```

The object's filename stem must equal the `name` frontmatter value, which must equal the destination folder name. A consumer writes asset `<stem>.md` to `.kiro/skills/<stem>/SKILL.md`. Requires no infrastructure change, and registry-level validation can assert the stem/frontmatter agreement at load time the same way `validateRegistry()` already fails fast on malformed entries. The convention must be stated in the `skills` registry `description`, because that is the only place a consuming agent will see it.

Rejected for now, recorded for when a skill needs bundled `scripts/`, `references/`, or `assets/`:

- **(ii) Archive.** Serve `{skill-name}.zip`. Requires a new registry extension, and the agent-asset path currently assumes text throughout — `get_agent_asset` returns `content` as a string and hashes it as text, and the chunker operates on strings.
- **(iii) Multi-file asset support.** Relax the `name` pattern (`^[^/\\]+$`) and the `Delimiter: '/'` listing to allow one level of nesting. Largest change; touches validation, listing, and chunking.

Consequence to accept deliberately: option (i) caps published skills at single-file. The four skills authored for this release are all single-file, so nothing is blocked today, but a skill that wants a reference bundle will force option (ii).

Skills authored in this repository under `.kiro/skills/` for the maintainer to copy into the skill/steering repo:

| Skill | Origin | Rationale |
|---|---|---|
| `atlantis-platform-resources` | new | The generic discovery skill — applies to any repo scaffolded from an Atlantis starter |
| `automate-audit-update-npm-packages` | converted from steering | Procedure, not persistent context |
| `automate-audit-update-python-packages` | converted from steering | Procedure, not persistent context |
| `automate-update-lambda-layers` | converted from steering | Procedure, not persistent context |

**Why the three `automate-*` documents are the right conversion candidates**, and the other three steering documents are not: all three are `inclusion: manual`, which in Kiro means they *never* auto-load — the user has to remember to invoke them by name. They are also procedural (numbered steps, a defined end state, a report) rather than persistent project context, and they already carry a `description` written in activation-trigger language. Converting them to skills changes activation from "user remembers" to "agent matches the request," which is a straight capability gain with no loss: a skill is still explicitly invocable as `/skill-name`. By contrast `atlantis-multi-resource-src.md`, `atlantis-python-dependency-management.md`, and `atlantis-webapi-node-cache-data.md` are conventions that should apply continuously while writing code, which is what steering is for. Leave them.

> Note on the conversion: the closest steering analogue to a skill is `inclusion: auto`, not `manual`. If any of the three should keep requiring deliberate invocation, leaving it as `manual` steering is the correct choice and it should not be converted.

### WS6 — Observability for discovery

Without this there is no way to tell whether any of the above worked.

- Log (no PII) per `search_documentation` call: query token count, filters applied, result count, retrieval strategy, and whether the result set was empty.
- Log tool-selection frequency from `tools/call` (the tool name is already added to the query log).
- A zero-result counter and a CloudWatch metric filter, so "queries that found nothing" is a trackable number rather than an anecdote.
- Record which tool is called first in a session — the practical measure of whether `instructions` is being honored.

---

## 4. Risks and constraints

| Risk | Mitigation |
|---|---|
| `MCP_TOOLS` is a direct reference to `settings.tools.availableToolsList`, and tests assert reference identity | Any derived/filtered manifest breaks those tests. Decide deliberately whether to relax the contract, and update `tests/unit/utils/tools-mcp-protocol.property.test.js` as part of the change, not as a surprise |
| Tokenization changes (4c) are index-time and query-time coupled | Deploy both halves together; a mismatch silently degrades existing matches rather than erroring. Keep a test that asserts a known query/document pair still matches |
| Re-index cost and window | 4c, 4d, 4f, and 4g all require a rebuild. Batch them into one index version bump |
| Per-type exclusions make indexed content depend on a best-effort GitHub API | Resolved by decision 7: three-state resolution with carry-forward on fetch failure. Implement the three states *before* the per-type policy, or the index becomes nondeterministic between builds |
| `instructions` consumes client system-prompt budget | Hard word cap, reviewed as prose, not generated. The corpus summary (1b) must degrade gracefully as the corpus grows |
| Corpus manifest on every response adds payload to every search | 4 KB cap with a three-tier degradation ladder (decision 9). Measured together with results against the 50 KB response threshold, manifest degraded first |
| Published vs enforced schema divergence grows | Reconcile in WS2 before adding more schema surface in WS4 |
| Enabling `skills` with no content, or with content in the wrong shape | WS5a must land before the registry flag flips. An advertised-but-empty type is an anti-signal — see `hooks` and `agents-md` today |
| `tools/list` stays fully public (decision 2) | No tier plumbing needed, and it aligns with the modern revision's `cacheScope: 'public'` for list results, since the response is identical for every caller |

---

## 5. Sequencing

| Phase | Contents | Rationale |
|---|---|---|
| 1 | WS1 content, WS3 (descriptions), WS6 (observability) | No re-index, no schema change. Ships the largest discovery gain and the instrumentation to measure everything after it. WS1 delivery rides on the dual-era spec's phase 1 |
| 2 | WS2 (metadata layer + merge de-dup + schema reconciliation) | Structural; unblocks clean addition of new tools and the `title`/`annotations` fields |
| 3 | WS4a/4b/4e (filters, `ghusers` fix, corpus manifest) | Read-path only; no re-index |
| 4 | WS4c/4d/4f/4g (tokenization, ranking, per-type exclusions, semantic parity) | One batched re-index. Resolve the 4f null-type question first |
| 5 | WS5 + WS5a (skill asset format, enable `skills`, publish AGENTS.md and skills) | Content plus a small registry change; depends on phase 1 wording for consistency |

Phases 1-2 alone are a defensible v0.0.7. Phases 3-5 may warrant their own spec directories if they grow.

---

## 6. Success criteria

Measurable, not aspirational:

1. A session receives a non-empty `instructions` string naming both Atlantis and `cache-data`, on whichever protocol era the client speaks.
2. `search_documentation` with query `caching` returns at least one `63Klabs/cache-data` result in the top 10.
3. `search_documentation` with query `caching in lambda` returns at least one `cache-data` result (today: zero).
4. `search_documentation` accepts `repository: 'cache-data'` and returns only cache-data sections.
5. A `search_documentation` response that matches **nothing** still reports `cache-data` in its `indexedRepositories` manifest — the bootstrap case.
6. `availableFilters` reports `repository` facets over the matched set, and is visibly distinct from `indexedRepositories`.
7. The zero-result rate for `search_documentation` is instrumented and has a baseline recorded before phase 3.
8. Published `inputSchema` and enforced schema are equivalent for every tool, asserted by a test.
9. `list_agent_asset_types` reports a non-zero count for every enabled type, including `skills` and `agents-md`.

---

## 7. Resolved decisions

| # | Question | Decision |
|---|---|---|
| 1 | Bootstrap discovery: `list_repositories` tool or facet? | Corpus manifest on every search response (WS4e), plus a one-line corpus summary in `instructions` |
| 2 | Tier-filter `tools/list`? | No — stays fully public; tier gating remains inside tools only |
| 3 | Per-`repositoryType` file exclusions? | Yes. A genuinely absent `repositoryType` excludes nothing — refined by decision 7 |
| 4 | Enable the `skills` asset type? | Yes, and author a generic Atlantis platform skill. Format settled by decision 8 |
| 5 | Dead `getCapabilities()` / `negotiateProtocol()` | Wire up — dual-era gives both a real reuse purpose. Moved to the protocol spec |
| 6 | Code search | Out of scope |
| 7 | `null` repositoryType (4f) | Distinguish *absent* from *fetch-failed*. Absent excludes nothing; fetch-failed carries forward the prior resolved type, falling back to global defaults |
| 8 | Skill asset format (WS5a) | Option (i) — flat `{skill-name}.md` plus a documented mapping convention |
| 9 | Corpus manifest budget (4e) | 4 KB, configurable; degrade manifest-first so it never triggers response truncation |
| 10 | `cache-data` `atlantis_repository-type` | Confirmed `package` |
| 11 | Protocol revision strategy | Dual-era, split into [`0-0-7-mcp-protocol-dual-era`](../0-0-7-mcp-protocol-dual-era/PLAN.md) |

All planning questions for this spec are resolved. Two housekeeping items fall outside it, noted under 4f: setting `atlantis_repository-type` on all 13 org repositories, and deciding whether `atlantis_namespace` gets populated or `namespace` is dropped from the 4a filter set.

---

## Related documentation

- [MCP protocol dual-era support](../0-0-7-mcp-protocol-dual-era/PLAN.md) — WS1 and WS2 depend on this
- [Prior tool-description work](../0-0-1-tool-descriptions/SPEC.md)
- [Agent asset tools](../0-0-6-agent-asset-tools/)
- [Documentation index enhancement](../0-0-6-documentation-index-enhancement/)
- [Bedrock semantic search](../0-0-6-bedrock-documentation-semantic-search/)
- [MCP specification — tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Kiro skills documentation](https://kiro.dev/docs/skills)
- [Agent Skills specification](https://agentskills.io/specification)

> Content from the MCP specification and Kiro documentation was rephrased for compliance with licensing restrictions.
