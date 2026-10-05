# Design Document

## Overview

**Tool Discovery Enhancement** makes the Atlantis MCP Server the first place an AI agent looks for platform resources, and makes `@63klabs/cache-data` reachable by the queries an agent would naturally write.

The work divides into four independent mechanisms:

1. **Announcement** — a server-level `instructions` string, authored once and served through both protocol-era carriers, that states the server's scope, its precedence over training recall, and the vocabulary needed to query it successfully.
2. **Tool legibility** — a Tool Metadata Registry that fans per-tool discovery metadata out to every surface that serves tool definitions, plus reconciliation of the two schemas a tool currently has and de-duplication of the two places descriptions are merged.
3. **Retrieval reach** — one shared normalization implementation for index-time and query-time tokenization, repository-level filters, and ranking signals that recognize repository identity.
4. **Bootstrap** — a corpus manifest on every search response, so a query that matches nothing still teaches the agent what exists.

### Baseline finding that reframes the retrieval work

The requirements assumed normalization parity was a *new* constraint introduced by R6. Reading the code shows parity is **already broken**, and that breakage is itself part of why content is hard to find:

| | Index side | Query side |
|---|---|---|
| Location | `doc-indexer/lib/extractors/{markdown,cloudformation,jsdoc,python}.js` — **four separate copies** | `read-function/models/doc-index.js` `extractQueryKeywords()` |
| Minimum token length | `MIN_KEYWORD_LENGTH = 2`, filter `length >= 2` | filter `length > 2` |
| Stop words | ~70 entries | **14 entries** |
| Separator handling | `python.js` also strips `_` and splits on `[\s_]+`; the other three do not | hyphen preserved, no `_` handling |

Two live consequences:

- **Two-character tokens are written but unreachable.** The indexer writes `search:s3`, `search:v2`, `search:ec2`, `search:id`. The query side drops every token of length 2 or less. A keyword-path query of `s3` reduces to zero keywords and returns the "Try using more specific keywords" early return — against a platform whose documentation is saturated with S3. Verified by reading both filters.
- **Stop-word asymmetry wastes reads and silently drops signal.** `how`, `what`, `when`, `can`, `will`, `your`, `into`, `more`, `about` are stop-worded at index time but retained at query time, so each one issues a DynamoDB query against a partition key that was never written.

This is masked for paid and private tiers, which route to semantic retrieval. A live `search_documentation` call for `s3` from a paid key returns results with cosine-range scores, confirming the semantic path; public and registered callers get the keyword path and hit the bug. So consolidating normalization is not merely a parity precaution for new behavior — it repairs existing behavior, and it does so for exactly the unauthenticated tier that has no fallback.

### Design goals

1. **One normalization implementation.** Five copies become one, delivered as a Lambda Layer because the Read Function and the Doc Indexer are separate deployables and shared source directories are prohibited.
2. **Additive on the wire.** Every response change is an optional field. A client ignoring all new fields sees unchanged behavior (R13).
3. **Membership-preserving.** Where retrieval ordering or scoping is restructured, a request using no new parameter returns the same set in the same order (R5.6, R6.5, R7.4).
4. **Re-index tolerant.** Search must not regress between deploying the new query side and completing the next index build (R6.6).
5. **Registry-driven.** Per-tool metadata is declared once and fanned out, following the `agent-asset-types.js` precedent (R2).
6. **No new AWS resources beyond a Layer and metric filters.** No new tools, no new tables, no new buckets.

### Requirement to design section traceability

| Requirement | Section |
|---|---|
| R1 Server instructions content | 5 |
| R2 Tool metadata registry | 2, 3 |
| R3 Schema equivalence | 4 |
| R4 Description trigger coverage | 6 |
| R5 Repository/type/namespace filters | 7 |
| R6 Normalization | 1 |
| R7 Ranking inputs | 8 |
| R8 Corpus manifest | 9 |
| R9 Per-type exclusions, three-state resolution | 10 |
| R10 Semantic parity | 11 |
| R11 Agent assets and skills | 12 |
| R12 Observability | 13 |
| R13 Backward compatibility | Backward compatibility |
| R14 Documentation | Documentation updates |
| R15 Testing | Testing Strategy |

---

## Architecture

### Current architecture (baseline)

```text
API Gateway POST /mcp/v1
  └── read-function/index.js
        ├── AuthResolver.resolveAuth  -> { tier, isAuthenticated }
        ├── RateLimiter.checkRateLimit
        └── routes/index.js  -> utils/json-rpc-router.js
              ├── initialize   -> utils/mcp-protocol.js initializeResponse()
              ├── tools/list   -> MCP_TOOLS + extendedDescriptions merge   <- merge copy 1
              └── tools/call   -> TOOL_DISPATCH -> controllers/*
                                   └── controllers/tools.js                <- merge copy 2
                                   └── controllers/documentation.js
                                         └── services/documentation.js
                                               └── models/doc-index.js  (DynamoDB)
                                               └── doc-ai-common layer  (semantic)

EventBridge schedule
  └── doc-indexer/index.js -> lib/index-builder.js
        ├── lib/github-client.js    listRepositories / getRepositoryProperties
        ├── lib/file-filter.js      isIndexable(filePath)
        ├── lib/extractors/*.js     extract() + extractKeywords()   <- 4 tokenizer copies
        └── lib/dynamo-writer.js    writeContentEntries / writeDocumentEntries /
                                    writeSearchKeywords / writeMainIndex / version pointer
```

DynamoDB key layout, unchanged by this design except for one added item type:

| Item | pk | sk |
|---|---|---|
| Version pointer | `version:pointer` | `active` |
| Main index manifest | `mainindex:{version}` | `entries` |
| Main index chunk | `mainindex:{version}` | `entries:{i}` |
| Content metadata | `content:{hash}` | `v:{version}:metadata` |
| Document body | `document:{fileHash}` | `content` |
| Search keyword | `search:{keyword}` | `v:{version}:{hash}` |
| **Corpus manifest (new)** | `corpus:{version}` | `manifest` |

### Target architecture

Additions only; nothing is removed.

```text
src/lambda/layers/
  ├── doc-ai-common/        (existing — embeddings, vector store, retrieval strategies)
  └── search-common/        (NEW — normalization, shared by read-function + doc-indexer)
        └── nodejs/
              ├── normalize.js        tokenize/normalize, stop words, length policy
              └── package.json        no production dependencies

read-function/
  ├── config/
  │     ├── server-instructions.js    (NEW — the instructions string, R1)
  │     └── tool-metadata.js          (NEW — Tool Metadata Registry, R2)
  ├── utils/tool-catalog.js           (NEW — the single description/metadata merge, R2.4)
  ├── models/doc-index.js             normalization via layer; filters; window reorder
  ├── models/corpus.js                (NEW — corpus manifest DAO, R8)
  └── services/documentation.js       filters in cache key; manifest assembly; facets

doc-indexer/
  ├── lib/extractors/*.js             delegate to the layer; local copies deleted
  ├── lib/file-filter.js              isIndexable(filePath, repositoryType)
  ├── lib/github-client.js            three-state property resolution
  └── lib/dynamo-writer.js            writeCorpusManifest (NEW)
```

The new layer follows the `doc-ai-common` precedent exactly: `ContentUri: src/lambda/layers/search-common/`, runtime extraction to `/opt/nodejs/`, loaded through a `loadLayerModule`-style indirection with an env-var path override so tests can require the real module without the Lambda runtime. The existing buildspec already iterates `src/lambda/layers/*/` and installs, tests, and audits each layer independently, so **no buildspec change is required** — a new layer directory is picked up automatically.

**Why a new layer rather than adding to `doc-ai-common`.** `doc-ai-common` is attached unconditionally today, so placement there would work mechanically. It is rejected on two grounds: the module name would misdescribe its contents, and it would couple the always-on keyword path to a layer whose stated purpose, dependency set (`@aws-sdk/client-s3vectors`), and entire reason for existing is the optional AI feature. A `search-common` layer costs one `AWS::Serverless::LayerVersion` and two `Layers` entries.

### Rollout ordering

The token-superset design (section 1.2) removes the usual deploy-order hazard: the index retains original-form tokens, and the new query side looks up original forms alongside normalized ones. So either component can ship first without breaking search.

| Step | Contents | Re-index |
|---|---|---|
| 1 | `search-common` layer; Read Function consumes it; `instructions`; descriptions; observability | No |
| 2 | Tool Metadata Registry; `tool-catalog.js`; schema reconciliation | No |
| 3 | Filters, `ghusers` fix, corpus manifest (derive-from-main-index path) | No |
| 4 | Doc Indexer consumes the layer; per-type exclusions; three-state resolution; ranking inputs; corpus manifest item; vector metadata | **One build** |
| 5 | Agent-asset content; enable `skills` | No |

Step 4 is one index version bump covering every index-shape change.

---

## Components and Interfaces

### 1. Shared normalization — `layers/search-common/nodejs/normalize.js` (R6)

#### 1.1 Interface

```javascript
/**
 * Normalize a term into the complete set of tokens under which it should be
 * indexed or looked up.
 *
 * @param {string} term - A single whitespace-delimited term.
 * @returns {Array<string>} Deduplicated tokens, lowercase. Empty when the term
 *   is a stop word or falls below the minimum length.
 */
function normalizeTerm(term) { }

/**
 * Normalize a free-text string into tokens.
 *
 * @param {string} text - Source text (a query, a title, or a body).
 * @param {Object} [options] - Options.
 * @param {boolean} [options.splitUnderscore=false] - Treat underscore as a
 *   separator, for Python source where identifiers are snake_case.
 * @returns {Array<string>} Deduplicated tokens in first-appearance order.
 */
function normalizeText(text, options) { }

module.exports = { normalizeTerm, normalizeText, STOP_WORDS, MIN_TOKEN_LENGTH, NORMALIZER_VERSION };
```

#### 1.2 Token derivation

For a term, the token set is the union of:

1. **The term as written**, lowercased and stripped of characters outside `[a-z0-9-]` (and underscore when `splitUnderscore`).
2. **Hyphen components**, when the term contains an internal hyphen: `cache-data` yields `cache` and `data`.
3. **The suffix-reduced form**, by a small deterministic suffix table rather than a general stemmer.

Both the index and the query side call the same function. The index stores the union; the query looks up the union. This is what makes the scheme re-index tolerant: because form (1) is always present on both sides, a query still matches an index built before the change, and the newly added forms simply contribute nothing until the next build. **No tokenizer version needs to be recorded against the index**, and no dual-read path is required. `NORMALIZER_VERSION` is exported for logging and for the parity test, not for query-time branching.

#### 1.3 Suffix reduction

A general stemmer is rejected: it is a production dependency, it is lossy in ways that are hard to predict for identifiers, and `AGENTS.md` directs minimizing dependencies. Instead, an explicit ordered suffix table, applied at most once per term, only when the result is at least `MIN_TOKEN_LENGTH`:

| Suffix | Reduction | Example |
|---|---|---|
| `ing` | drop, restoring a dropped `e` where the stem would otherwise end in a consonant cluster | `caching` to `cache` |
| `es` | drop | `caches` to `cache` |
| `s` | drop, unless preceded by `s` | `templates` to `template` |
| `ed` | drop, restoring `e` as above | `cached` to `cache` |

The table is data, unit-tested term by term, and extended by adding rows. It deliberately handles only the cases that matter for this corpus's vocabulary.

#### 1.4 Reconciling the existing divergence

The layer becomes the single policy for both the minimum token length and the stop-word set. Two behavior changes follow directly, both intended:

- **`MIN_TOKEN_LENGTH = 2`** on both sides, adopting the index side's existing value. This makes the already-written `search:s3`, `search:v2`, and `search:ec2` partitions reachable for the first time.
- **One stop-word set** on both sides, adopting the index side's roughly 70-entry list. Query terms that were previously looked up against never-written partitions stop issuing those reads.

Both changes strictly add reachable matches or remove wasted reads. Neither removes a match that previously succeeded, because a token that matched before was present on both sides and remains so.

The four extractor copies of `extractKeywords` are deleted and replaced by delegation to the layer, with `python.js` passing `splitUnderscore: true` to preserve its current behavior.

### 2. Tool Metadata Registry — `config/tool-metadata.js` (R2)

Mirrors the `agent-asset-types.js` pattern: a declarative table plus generator functions and a load-time validator.

```javascript
const TOOL_METADATA = {
  search_documentation: {
    title: 'Search Atlantis Documentation',
    category: 'documentation',
    annotations: { readOnlyHint: true, openWorldHint: false },
    keywords: ['caching', 'cache', 'ttl', 'dynamodb cache', 's3 cache',
               'lambda cache', 'cache-data', 'CacheableDataAccess',
               'how do I', 'tutorial', 'guide', 'pattern'],
    relatedTools: ['get_document', 'get_document_chunk'],
    whenToUse: 'The user asks how to do something on the Atlantis platform, or asks about @63klabs/cache-data.',
    whenNotToUse: 'You already have a filePath or hash from a previous result — call get_document instead.',
    examples: [
      { description: 'Find cache-data setup guidance',
        arguments: { query: 'cache-data installation' } },
      { description: 'Narrow to one repository',
        arguments: { query: 'ttl', repository: 'cache-data' } }
    ]
  }
  // ... one entry per tool
};

module.exports = {
  TOOL_METADATA,
  validateRegistry,          // load-time, fails fast
  generateAnnotations,       // name -> annotations, for the wire
  generateTitles,            // name -> title, for the wire
  getDiscoveryBlock          // name -> { category, keywords, relatedTools, whenToUse, whenNotToUse, examples }
};
```

`validateRegistry()` runs at module load and throws when a tool in the manifest has no entry, when an entry names a tool that does not exist, or when a required field is missing — the same fail-fast posture as `AGENT_ASSET_TYPES`. This is strictly stronger than the current `validateDescriptions()`, which only warns, and it satisfies R4.4 for metadata as well as descriptions.

`openWorldHint` is `false` for every tool: all read from the server's own S3 and DynamoDB, none reach an open-ended external system at call time.

### 3. Single catalog helper — `utils/tool-catalog.js` (R2.4, R2.7)

```javascript
/**
 * Build the served tool list: the manifest overlaid with extended descriptions
 * and registry metadata, filtered to the fields legal on the negotiated revision.
 *
 * @param {Object} [options] - Options.
 * @param {string} [options.protocolVersion] - Negotiated revision. Fields not
 *   legal on it are omitted rather than emitted invalidly.
 * @returns {Array<ToolDefinition>} Deterministically ordered tool definitions.
 */
function buildToolCatalog(options) { }
```

Both the `tools/list` branch in `json-rpc-router.js` and `controllers/tools.js` call this and nothing else, eliminating the two independent merges. Ordering is the manifest's own array order, which is already stable, satisfying R2.7 and the newer revision's deterministic-ordering guidance.

Field legality by revision (R2.6): `title` and `annotations` are omitted unless the negotiated revision permits them. The `category`, `keywords`, `relatedTools`, `whenToUse`, `whenNotToUse`, and `examples` fields are **not** emitted as wire fields on any revision — they are composed into the description text, so they work on every revision and never risk schema rejection. This is why R2 is not blocked end to end on the protocol spec.

**`MCP_TOOLS` reference identity.** `utils/mcp-protocol.js` exports `MCP_TOOLS` as a direct reference to `settings.tools.availableToolsList`, and `tests/unit/utils/tools-mcp-protocol.property.test.js` asserts that identity. `buildToolCatalog()` returns a derived array, so the raw export and its test are left untouched; the catalog is a separate, additive function. No existing contract is relaxed.

### 4. Schema reconciliation — `utils/schema-validator.js` (R3)

The published schema in `settings.js` and the enforced schema in `schema-validator.js` are two hand-maintained objects. Rather than deriving one from the other by rewriting every tool definition, the design makes the **enforced** schema authoritative and publishes it:

1. `schema-validator.js` continues to own `baseSchemas` as the single authoritative definition.
2. `settings.tools.availableToolsList` entries drop their inline `inputSchema` and reference the validator's schema by tool name, assembled by `buildToolCatalog()`.
3. A property test asserts, for every tool, that the published and enforced schemas are the identical object, so divergence becomes impossible rather than merely detected.

Where the enforced schema is stricter than what was published, publishing it is a disclosure of an existing constraint, not a new restriction — a call that would now be visibly invalid was already being rejected. The known deltas to disclose: `minLength` and `maxLength` bounds, the name pattern that forbids path separators, `additionalProperties: false`, and the `namespace` property that `list_templates` enforces but does not advertise.

Direction of authority is chosen deliberately: making the *published* schema authoritative would loosen enforcement, which is a security regression.

### 5. Server instructions — `config/server-instructions.js` (R1)

```javascript
/**
 * The server-level instructions string, served identically on both protocol
 * eras. Single source of truth; the protocol layer reads it, never composes it.
 *
 * @param {Object} [options] - Options.
 * @param {Array<{name: string}>} [options.repositories] - Indexed repositories
 *   for the one-line corpus summary (R1.5). Omitted or empty yields a string
 *   with no corpus sentence rather than an empty or malformed one.
 * @returns {string} The instructions string.
 */
function buildInstructions(options) { }

module.exports = { buildInstructions, MAX_INSTRUCTION_WORDS };
```

Content outline, held to 250 words (R1.7):

- Scope sentence naming the Atlantis platform **and `@63klabs/cache-data`** explicitly (R1.2).
- Precedence directive: query this server before web search or training recall for template, naming, pipeline, starter, and `cache-data` questions (R1.3).
- Vocabulary: `@63klabs/cache-data` and `cache-data`, the six `repositoryType` values, the five template categories (R1.4).
- One corpus sentence naming the indexed repositories, sourced from the corpus manifest (section 9) so it cannot drift from reality (R1.5).

No per-tool routing table (R1.6) — the newer revision's own guidance is that this field should not restate tool descriptions, and routing guidance lives in sections 2 and 6 instead.

The corpus sentence degrades with corpus size: above a repository-count threshold it names the highest-value repositories and states the total rather than enumerating all of them, so the word cap is never breached by corpus growth.

`serverInfo.version` (R1.8) is sourced from the Lambda's `package.json` version rather than the hardcoded `'0.0.1'`.

### 6. Description rewrite — `config/tool-descriptions.js` (R4)

Each extended description is restructured to a fixed shape, so coverage is checkable rather than a matter of taste:

```text
<Trigger sentence: "Call this when ...">
<What it returns>
<Required vs optional parameters, with the concrete identifiers in play>
<At least one failure mode and what to do about it>
<Related tool pointer>
```

The opening of `search_documentation` is widened from "Search Atlantis documentation" to name the companion packages including `cache-data` (R4.3), which is the sentence most responsible for an agent concluding a caching question is out of scope. The `stadards` typo in `list_starters` is corrected (R4.5). `validateDescriptions()` gains the missing-description check (R4.4), and the `getDiscoveryBlock()` content from section 2 is composed into the rendered description so keywords and when-to-use guidance reach the agent on every protocol revision.

### 7. Search filters — `models/doc-index.js`, `services/documentation.js` (R5)

#### 7.1 Schema and plumbing

`search_documentation` gains optional `repository`, `repositoryType`, and `namespace` properties, declared in `schema-validator.js` (now authoritative per section 4). `repositoryType` is an enum over `settings.github.validRepositoryTypes`.

#### 7.2 `ghusers` — honored, not removed

R5.3 offered a choice. **R13.2 forecloses it:** removing a published parameter is a breaking change. `ghusers` is therefore honored, implemented as an `owner` filter on the keyword path alongside the new `repository` filter. The existing validation against `settings.github.userOrgs` is unchanged, including the error when the intersection is empty.

#### 7.3 Filter application

The metadata needed is already persisted on content items (`repository`, `repositoryType`, `namespace`, `owner`), so filtering needs no index change. Filters apply at two points, mirroring the established `type`/`subType` treatment:

- **Push-down** on search-keyword entries where the value is carried, discarding candidates whose known value contradicts the filter.
- **Authoritative post-fetch filter** on content metadata, which settles candidates whose pushed-down value is absent.

`repository`, `repositoryType`, and `namespace` are **not** added to the `search:{keyword}` item — that would inflate every keyword item by several fields across millions of rows for a marginal read saving. They are applied at the post-fetch stage only, with the candidate window widened per section 8.3 to compensate.

#### 7.4 Cache key

All four filters join the cache-key parameters on the `documentation-index` / `doc-index` profile (R5.4). The existing key already carries `query`, `type`, `subType`, `limit`, and the `docAiMode` discriminator; `repository`, `repositoryType`, `namespace`, and the resolved `ghusers` set are added. Without this a result set computed under one filter would be served for another.

#### 7.5 Facets

`buildAvailableFilters()` gains a `repository` facet over the matched set (R5.5), alongside the existing `type` and `subType`. It remains computed over matched results only — the index-wide listing is a separate field (section 9), and the two are deliberately named differently.

### 8. Ranking inputs — `doc-indexer/lib/index-builder.js`, `models/doc-index.js` (R7)

#### 8.1 Index-time signals

`computeRelevanceScore(keyword, entry)` gains two contributions alongside the existing title, excerpt, and keyword matches:

| Signal | Weight | Rationale |
|---|---|---|
| `repositoryNameMatch` | between excerpt and keyword weight | A match on the repository name is strong evidence of topical ownership — the `cache-data` case exactly |
| `pathMatch` | lowest | A match in the file path is weak but real evidence |

#### 8.2 Repository-type weighting

A `REPOSITORY_TYPE_WEIGHTS` multiplier is applied alongside the existing `TYPE_WEIGHTS`:

| Repository type | Weight |
|---|---|
| `package`, `documentation` | highest |
| `templates`, `app-starter` | neutral |
| `mcp`, `management` | slightly below neutral |
| absent or fetch-failed | neutral |

Unclassified repositories take the neutral weight, so a repository without the custom property set is never penalized for an operational omission. This is what makes the observation that `atlantis-mcp` is unclassified harmless rather than a silent demotion.

#### 8.3 Candidate window reorder

Current order drops candidates before they are evaluated:

```text
rank by score -> slice(limit * 3) -> push-down filter -> batchGet -> post-filter -> phrase boost -> sort -> slice(limit)
```

Target order:

```text
rank by score -> push-down filter -> slice(window) -> batchGet -> post-filter -> phrase boost -> sort -> slice(limit)
```

where `window` is `limit * 3` with no filter, and a larger multiple when any filter is active, since post-fetch filtering will discard part of the window.

**Membership preservation proof (R7.4, R5.6).** With no filter requested, the push-down is the identity function and the window multiplier is unchanged, so `slice(limit * 3)` is applied to the same ranked array at the same position in the pipeline. Every subsequent stage is unchanged. The returned set and its order are therefore identical to current behavior. Both the existing push-down and the existing phrase boost already document membership-preservation contracts; this change preserves them.

#### 8.4 Semantic path untouched

The semantic and semantic-assisted paths remain ranked by cosine similarity (R7.5). None of sections 8.1 through 8.3 applies to them, matching the existing treatment of the phrase boost as keyword-path-only.

### 9. Corpus manifest — `models/corpus.js`, `lib/dynamo-writer.js` (R8)

#### 9.1 Source of truth

The indexer writes one item per build:

```text
pk = corpus:{version}
sk = manifest
repositories = [ { name, owner, repositoryType, resolution, namespace, sections, ref } ]
```

Read-side cost is a single `GetItem` against the active version, cached under a new `corpus` / `corpus-manifest` connection profile. Because the item is keyed by version, a new index build produces a new key and the previous cache entry is unreachable rather than stale (R8.6) — no invalidation step is needed.

#### 9.2 Transitional derivation

R8 ships in rollout step 3, before the indexer change in step 4. Until the item exists, `models/corpus.js` derives the manifest by reading the main-index chunks and aggregating by repository, then caches the result on the same profile. Behavior is identical; only cost differs. The fallback is retained after step 4 as the graceful path for a partially written index, and the chosen path is recorded in the structured log (section 13).

This also resolves a second need cheaply: the manifest item carries each repository's resolved classification, so it doubles as the carry-forward source for section 10.3.

#### 9.3 Response field and budget

The field is named `indexedRepositories`, deliberately distinct from `availableFilters` (R8.4). It is present on every `search_documentation` response including empty ones (R8.1, R8.2).

Budget `MCP_CORPUS_MANIFEST_MAX_BYTES`, default 4096, parsed through the existing `parseIntSetting` helper. Measured values behind the default: 13 public repositories in the org, roughly 115 bytes per full entry, roughly 1.6 KB total today, against a 50,000-byte response threshold.

Degradation ladder (R8.8):

| Tier | Shape | Approx. per entry |
|---|---|---|
| `full` | name, owner, repositoryType, namespace, sections, ref | 115 B |
| `compact` | name, repositoryType | 35 B |
| `count` | `{ repositoryCount, omitted: true }` | fixed |

The emitted tier is reported in the block itself, so a consumer can tell a compact listing from a full one rather than inferring it from absent fields.

#### 9.4 Interaction with the response size threshold

R8.9 is the binding rule. Assembly order in the service:

1. Build the result payload.
2. Select the manifest tier that fits `MCP_CORPUS_MANIFEST_MAX_BYTES`.
3. Measure results plus manifest against the response threshold via `ContentSizer`.
4. While over threshold, degrade the manifest one tier; if `count` still does not fit, omit the manifest entirely.
5. Only then allow the existing truncation path to act on results.

The manifest can therefore never be the cause of a caller's requested results being truncated.

### 10. Repository classification and per-type exclusions (R9)

#### 10.1 Three-state resolution

`getRepositoryProperties()` keeps its never-throws, never-fails-a-build contract and becomes more informative (R9.2):

```javascript
/**
 * @returns {{repositoryType: (string|null), namespace: (string|null),
 *            resolution: ('resolved'|'absent'|'fetch-failed')}}
 */
```

- `resolved` — the property was present and valid.
- `absent` — the call succeeded and the property is genuinely unset.
- `fetch-failed` — error, 404, or timeout; the true value is unknown.

The distinction is available because the existing implementation already separates "request succeeded, property not in the array" from "request threw" — the two paths simply both return `null` today.

#### 10.2 Exclusion policy

`isIndexable(filePath)` becomes `isIndexable(filePath, repositoryType)`; `processRepository` passes the type it already resolves.

| Classification | Policy |
|---|---|
| `package` | Global exclusions minus `CHANGELOG.md` — version and migration questions depend on it |
| `documentation`, `templates`, `app-starter`, `mcp`, `management` | Global exclusions |
| `absent` | **No exclusions** (decision 3, R9.5) |
| `fetch-failed` | Carry-forward (section 10.3) |

`AGENTS.md` stays excluded for every type: it is served through the `agents-md` agent-asset channel, and indexing it would put the same guidance on two surfaces with different freshness.

#### 10.3 Carry-forward

On `fetch-failed`, the indexer reads the previous version's corpus manifest item (section 9.1) and reuses that repository's recorded classification. With no previous resolution, the global default exclusions apply (R9.6). The precedent is `loadPriorEmbeddings`, which already reads the prior version for reuse, and the lookup is a single `GetItem`.

This yields R9.7: two builds over identical content with identical successful resolutions index an identical file set, because a transient failure resolves to the same carried-forward type rather than to "exclude nothing".

#### 10.4 Ordering

Section 10.1 lands before section 10.2 (R9.8). Shipping the per-type policy against a two-state resolution is precisely the nondeterminism the requirement exists to prevent.

### 11. Semantic parity (R10)

Vector metadata gains `repositoryType` and `namespace` (R10.1), written during the step-4 re-index. Store-level filters are expressible only for equality on a single value, so the strategy applies what the store can express and the rest in the result-mapping stage, which already drops hits whose content metadata is missing.

Until the vector store carries the new fields (R10.3), a request combining a semantic strategy with a new filter falls back to the keyword path rather than returning results that contradict the filter. This reuses the existing keyword-fallback mechanism and its degrade logging — returning unfiltered results from a filtered request would be a correctness bug, where falling back is merely a performance and quality regression.

The response shape is identical across strategies (R10.4), including `indexedRepositories` and `availableFilters`, because both are assembled in the service after the strategy returns.

### 12. Agent assets and skills (R11)

No code change to the agent-asset registry, controller, service, or DAO. The work is content plus one registry flag.

| Deliverable | Form |
|---|---|
| Canonical `AGENTS.md` | Content authored here, published to the `agents-md` type (already enabled, currently empty) |
| `atlantis-platform-resources` skill | Authored; the generic discovery skill |
| Three `automate-*` skills | Converted from manual-inclusion steering, procedures preserved, source `sha256` recorded in `metadata` |
| `skills` registry entry | `enabled: true`, description documents the flat-asset mapping convention (R11.6) |

The flat-asset convention (decision 8): S3 object `skills/{skill-name}.md` maps to local `.kiro/skills/{skill-name}/SKILL.md`, with the object's filename stem equal to the `name` frontmatter equal to the destination folder name. The registry `description` is the only place a consuming agent encounters this, hence R11.6.

`enabled: true` is gated on assets existing (R11.7). Since publishing is owned by the source repository's pipeline, the flag flip is the last step and is explicitly ordered after content is published — otherwise `skills` joins `hooks` and `agents-md` as an advertised-but-empty type.

Precedence wording is authored once and reused verbatim across the `instructions` string, the `AGENTS.md` asset, and the platform skill (R11.8).

### 13. Observability (R12)

Structured single-line JSON events through `DebugAndLog`, matching the existing `doc_ai_*` event convention:

| Event | Fields |
|---|---|
| `discovery_search` | `tokenCount`, `filtersApplied[]`, `resultCount`, `strategy`, `emptyResult`, `manifestTier`, `manifestSource` |
| `discovery_tool_call` | `toolName`, `firstInSession` |
| `discovery_manifest_degraded` | `fromTier`, `toTier`, `reason` |

No query text is logged alongside caller identity, and no credential or PII is logged (R12.5) — `tokenCount` is a count, not the terms.

`firstInSession` (R12.3) is derivable without session state: the stateless protocol has no session, so the field marks the first tool call observed in a Lambda container invocation and is treated as a sampled signal rather than an exact count. This is an honest limitation of a stateless server and is documented as such rather than papered over with a synthetic session id.

`template.yml` gains metric filters under a `Discovery` namespace for the zero-result count (R12.4), following the existing `DocAi` metric-filter pattern. The baseline (R12.6) is recorded by deploying step 1 and letting the metric accumulate before step 3 ships.

---

## Data Models

### `indexedRepositories` (new response field)

```json
{
  "tier": "full",
  "repositoryCount": 13,
  "repositories": [
    {
      "name": "cache-data",
      "owner": "63Klabs",
      "repositoryType": "package",
      "namespace": null,
      "sections": 412,
      "ref": "v1.3.17"
    }
  ]
}
```

Compact tier omits `owner`, `namespace`, `sections`, and `ref`. Count tier omits `repositories` and sets `omitted: true`.

### Corpus manifest item (new DynamoDB item)

```json
{
  "pk": "corpus:20260715T060000",
  "sk": "manifest",
  "version": "20260715T060000",
  "repositories": [
    {
      "name": "cache-data",
      "owner": "63Klabs",
      "repositoryType": "package",
      "resolution": "resolved",
      "namespace": null,
      "sections": 412,
      "ref": "v1.3.17"
    }
  ],
  "expires": 1760000000
}
```

Carries the same 7-day TTL as other index items. `resolution` is persisted specifically to serve the section 10.3 carry-forward.

### Search keyword item (unchanged)

Deliberately not extended. Filtering on `repository`, `repositoryType`, and `namespace` happens post-fetch (section 7.3).

### Content metadata item (unchanged)

Already carries every field the new filters need.

---

## Caching

| Concern | Connection / profile | Key inputs |
|---|---|---|
| Search results | `documentation-index` / `doc-index` | existing, plus `repository`, `repositoryType`, `namespace`, resolved `ghusers` |
| Corpus manifest | `corpus` / `corpus-manifest` (new) | active index version |
| Document bodies | `document` / `doc-data` | unchanged |

The corpus manifest profile takes a long TTL in production, since the item is immutable for the life of an index version and a new version yields a new key.

---

## Backward compatibility (R13)

| Guarantee | How |
|---|---|
| Additive fields only | `indexedRepositories` and the `repository` facet are new optional fields; the existing envelope is untouched |
| No removals | No tool, parameter, or response field is removed. `ghusers` is honored rather than dropped, which is what forces section 7.2 |
| Equivalent responses for old-shaped requests | Section 8.3 membership proof; filters default to absent |
| Cache entries cannot cross filter shapes | Section 7.4 adds every filter to the key, so a pre-change entry cannot be read as satisfying a new filter |
| Truncation contract preserved | Section 9.4 degrades the manifest before results; chunk tools unchanged |
| Published schema strictening | Discloses constraints already enforced; no previously accepted call becomes invalid |

---

## Correctness Properties

Stated as properties because they hold across inputs and are the natural targets for property-based tests.

### Property 1: Normalization parity

*For any* term, the token set produced index-side equals the token set produced query-side, because both call one implementation. Asserted over generated terms including hyphenated identifiers, suffixed forms, two-character tokens, and stop words.

**Validates: Requirements 6.1, 6.2, 6.3, 6.7**

### Property 2: Re-index tolerance

*For any* term, the token set includes the term as written. Therefore any query that matched an index built before this change still matches it.

**Validates: Requirements 6.5, 6.6, 13.3**

### Property 3: Monotonic reachability

*For any* token that matched before the normalization change, the change does not remove that match. A previously matching token was present on both sides under the old policy and remains present under the new one.

**Validates: Requirements 6.4, 6.6, 13.3**

### Property 4: Filter soundness

*For any* combination of `repository`, `repositoryType`, `namespace`, and `ghusers`, every returned result satisfies every supplied filter, on both the keyword and the semantic path.

**Validates: Requirements 5.1, 5.3, 10.2, 10.3**

### Property 5: Unfiltered membership invariance

*For any* query supplying no new filter, the returned result set and its order are identical to pre-change behavior.

**Validates: Requirements 5.6, 7.3, 7.4, 13.3**

### Property 6: Manifest presence

*For any* query, including one matching nothing, the response contains `indexedRepositories`.

**Validates: Requirements 8.1, 8.2, 10.4**

### Property 7: Manifest never truncates results

*For any* combination of result payload and corpus size, the response either fits the size threshold with the manifest degraded, or omits the manifest entirely — and never truncates results while a manifest is present at a tier that could still be degraded.

**Validates: Requirements 8.7, 8.8, 8.9, 13.5**

### Property 8: Classification determinism

*For any* two builds over identical content with identical successful property resolutions, the indexed file set per repository is identical — including when one build saw a transient fetch failure and carried forward.

**Validates: Requirements 9.1, 9.6, 9.7**

### Property 9: Schema identity

*For any* tool, the published schema and the enforced schema are the same object.

**Validates: Requirements 3.1, 3.2, 3.4**

### Property 10: Registry completeness

*For any* tool in the manifest there is a metadata entry and an extended description, and *for any* metadata key there is a tool of that name. Violations fail at module load.

**Validates: Requirements 2.1, 2.3, 4.4**

### Property 11: Catalog single-sourcing

*For any* negotiated revision, the tool list served by `tools/list` and by `list_tools` is identical, because both come from `buildToolCatalog()`.

**Validates: Requirements 2.4, 2.6, 2.7**

### Property 12: Instructions bounds

*For any* corpus size including empty, the instructions string is non-empty, within the word cap, and contains both the platform name and `cache-data`.

**Validates: Requirements 1.1, 1.2, 1.5, 1.7**

### Property 13: Skill format conformance

*For any* authored skill, the folder contains `SKILL.md`, its `name` equals the folder name, and `name` and `description` are within their length limits.

**Validates: Requirements 11.4, 11.5**

---
## Error Handling

| Condition | Behavior |
|---|---|
| Layer module unavailable at require time | Fail fast at cold start. Normalization is not optional — silently falling back to a local copy would reintroduce the divergence this design removes |
| Corpus manifest item missing | Fall back to main-index derivation (section 9.2); log the source. Not an error |
| Corpus manifest derivation fails | Omit `indexedRepositories`, log a warning, serve results normally. The manifest is an aid, never a precondition |
| Filter value matches nothing | Successful response, empty results, manifest present (R5.2) |
| `ghusers` intersection empty | Existing error preserved |
| `getRepositoryProperties` fails | `resolution: 'fetch-failed'`, carry-forward; never fails the build |
| Previous corpus manifest unreadable during carry-forward | Global default exclusions; log a warning |
| Registry or description incomplete | Throw at load (Property 10). An inconsistent catalog is worse than a failed deploy, which the pipeline catches |
| Vector metadata missing new fields with a filter requested | Keyword fallback with degrade logging (section 11) |

---

## Testing Strategy

Jest, per the existing per-resource layout: unit tests under `tests/unit/<layer>/`, cross-layer under `tests/integration/`. The new layer carries its own `package.json`, `jest.config.js`, and tests, and the buildspec's existing layer loop runs them.

### Property-based tests (fast-check)

Properties 1 through 13 above. Per the test-execution steering, none of these spawn child processes, so they run at default iteration counts.

Property 1 is the highest-value test in this spec: it is the regression guard that prevents normalization divergence from recurring, and it must be able to fail. It generates terms across hyphenated identifiers, suffix-table cases, two-character tokens, stop words, and mixed punctuation, asserting index-side and query-side token-set equality.

### Unit tests

- `normalize.js`: each suffix-table row; hyphen splitting; the two-character cases such as `s3` and `v2` that are currently unreachable; `splitUnderscore` parity with current `python.js` behavior.
- `doc-index.js`: each filter narrows correctly; push-down retains unknown values; window reorder preserves unfiltered membership; new ranking signals.
- `corpus.js`: item path, derivation fallback, each degradation tier, version-keyed cache behavior.
- `file-filter.js`: the policy matrix in section 10.2, all four classifications.
- `github-client.js`: the three resolution states, including distinguishing absent from fetch-failed.
- `tool-catalog.js`: identical output for both call sites; revision-gated field omission; deterministic order.
- `schema-validator.js`: published and enforced identity for all tools.
- `server-instructions.js`: word cap, required substrings, corpus-sentence degradation, empty-corpus case.

### Integration tests

- `tools/list` and `list_tools` return byte-identical tool arrays.
- A `search_documentation` call matching nothing still returns `indexedRepositories`.
- A filtered call returns only matching repositories and reports a `repository` facet.
- An oversized result set with a large corpus degrades the manifest rather than truncating results.

### Existing tests to update (R15.9)

`tests/unit/utils/tools-mcp-protocol.property.test.js` asserts `MCP_TOOLS` reference identity. Section 3 deliberately leaves that export alone, so the test should pass unchanged — this is verified rather than assumed, and if `settings.js` drops inline `inputSchema` per section 4 the test's expectations are updated in the same change.

### Deployed verification (R15.11)

The PLAN success criteria depend on a built index and cannot be proven by unit tests. After the step-4 re-index, verify against a deployed stage: `caching` and `caching in lambda` each return a `cache-data` result; `repository: 'cache-data'` returns only cache-data sections; a nonsense query still returns the manifest; and — the regression that matters most for unauthenticated users — a keyword-path query of `s3` returns results.

---

## Documentation updates (R14)

| Document | Change |
|---|---|
| `docs/end-user` tools reference | New filters; `indexedRepositories` with a discover-then-filter example; `cache-data` query guidance; a statement that code search over raw repository source is not provided (R14.7) |
| `docs/admin-ops` | `MCP_CORPUS_MANIFEST_MAX_BYTES`; per-type exclusion matrix; three-state classification behavior; the prerequisite of setting `atlantis_repository-type` on every repository |
| `docs/developer` | Tool Metadata Registry fan-out; `tool-catalog.js` as the single merge; the `search-common` layer and why normalization is shared |
| `ARCHITECTURE.md` | New layer; corpus manifest item; filter and ranking flow |
| `CHANGELOG.md` | Entry under `v0.0.7 (unreleased)` referencing this spec |
| `.kiro/skills/README.md` | Already documents the mapping convention; update when the registry flag flips |

---

## Security

- **Untrusted content.** Indexed documentation, agent assets, and the corpus manifest are data, never evaluated. The manifest is assembled from stored index fields, not from request input.
- **No new input reaching a sink.** The new filters are compared against stored metadata and used as DynamoDB key components and in-memory predicates — never as file paths, shell arguments, or dynamic property lookups. Enum-constrained where the value set is closed (`repositoryType`), length- and pattern-constrained otherwise.
- **Schema strictening is a security improvement.** Section 4 publishes constraints already enforced; enforcement is never loosened to match a laxer published schema.
- **No new IAM.** Reads use the existing DynamoDB and S3 grants. The new layer bundles no production dependencies and holds no credentials.
- **Logging.** Section 13 logs counts and enum values, never query text with identity, never credentials.
- **Registry load-time validation** fails the deploy rather than serving a partially valid catalog.

---

## Open or least-risk items

1. **Suffix-table scope.** Four rows cover this corpus's vocabulary. Adding rows is data-only, so starting small is low-risk; the opposite error — over-reducing an identifier into a collision — is the real hazard. Mitigated by applying reduction at most once and keeping the table explicit.
2. **Repository-type weight magnitudes.** Chosen relative to the existing `TYPE_WEIGHTS`. The ordering matters more than the exact values, and tuning requires a built index, so expect one adjustment after deployed verification.
3. **`firstInSession` fidelity.** A stateless server cannot observe sessions; the signal is per-container and sampled. Accepted rather than synthesizing a session identifier.
4. **Two-character token volume.** Making `MIN_TOKEN_LENGTH = 2` reachable on the query side increases matches for short tokens. Monitor result quality for queries like `id` or `to` — the shared stop-word set already removes the common English cases, but this is the one change whose quality effect is hard to predict from code alone.

---

## Requirements Traceability

| Requirement | Design sections | Properties |
|---|---|---|
| R1 Instructions content | 5 | 12 |
| R2 Metadata registry | 2, 3 | 10, 11 |
| R3 Schema equivalence | 4 | 9 |
| R4 Description coverage | 6, 2 | 10 |
| R5 Filters | 7 | 4, 5 |
| R6 Normalization | 1 | 1, 2, 3 |
| R7 Ranking | 8 | 5 |
| R8 Corpus manifest | 9 | 6, 7 |
| R9 Exclusions and resolution | 10 | 8 |
| R10 Semantic parity | 11 | 4 |
| R11 Agent assets and skills | 12 | 13 |
| R12 Observability | 13 | — |
| R13 Backward compatibility | Backward compatibility, 7.2, 8.3 | 2, 3, 5 |
| R14 Documentation | Documentation updates | — |
| R15 Testing | Testing Strategy | 1-13 |

---

## Related documents

- [PLAN.md](PLAN.md) — planning context and resolved decisions
- [requirements.md](requirements.md) — the requirements this design satisfies
- [MCP protocol dual-era support](../0-0-7-mcp-protocol-dual-era/PLAN.md) — owns `instructions` delivery and wire-field legality
