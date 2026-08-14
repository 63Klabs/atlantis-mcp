# Documentation Index & Search — Efficiency / Cost Recommendations

> Status: **Exploratory only.** No code changes were made. This document evaluates the
> current documentation indexer, its DynamoDB storage, and the search endpoint against the
> sample response in `sample-results.json`, and proposes options relevant to all three
> `DocAiRetrievalMode` values: **keyword**, **semantic**, and **semantic-assisted**.

## Scope of the sample response

`sample-results.json` is a `search_documentation` response for the query
`"S3ModuleLocation bucket for us-east-1"`. It returned 10 of `totalResults: 30`, each item
shaped `{ title, excerpt, filePath, githubUrl, type, subType, relevanceScore, repository,
repositoryType, namespace }`. Two observations drive the analysis below:

- **Every `excerpt` is truncated mid-sentence** (e.g. ends in `| Type | Strin`, `Regional bu`).
- **Every `githubUrl` is `null`** and `repositoryType`/`namespace` are `null` — so the
  caller has no direct link to the full document and only an indirect `filePath`.

---

## 1. How the system works today (as-built)

### 1.1 Indexer (`doc-indexer` Lambda)

Files: `doc-indexer/lib/index-builder.js`, `.../extractors/markdown.js`, `.../dynamo-writer.js`.

- Scheduled build: list org repos → download archive → run per-extension extractors →
  dedupe by hash → write to DynamoDB → flip `version:pointer/active`.
- **Chunking**: markdown is split **one entry per heading (H1–H6)**. `contentPath =
  {org}/{repo}/{filePath}/{slug}`; `hash = SHA-256(contentPath)` truncated to 16 hex chars.
- **Excerpt**: `section.body.substring(0, 200)` — a hard character cut, `MAX_EXCERPT_LENGTH
  = 200`, no word/sentence boundary. This is the source of the mid-sentence truncation.
- **Keywords**: heading + body tokenized, stop-words removed, deduped.
- **relevanceScore is precomputed at index time**, per `(keyword, entry)`:
  `titleMatch +10`, `excerptMatch +5`, `keywordMatch +3`, then `× typeWeight`
  (`documentation 1.0`, `template-pattern 0.9`, `code-example 0.8`), rounded. `exactPhrase
  (+20)` is **defined but never used**.

### 1.2 Storage (single DynamoDB table `…-DocIndex`)

`PAY_PER_REQUEST`, `pk`/`sk` only, **no GSI**, TTL on `ttl` (~7 days). Item shapes:

| pk | sk | Holds | Read by search? |
|----|----|-------|-----------------|
| `content:{hash}` | `v:{version}:metadata` | title, excerpt, path, type, subType, repository, owner, keywords | **Yes** (keyword + semantic enrichment) |
| `content:{hash}` | `v:{version}:content` | **full section body** | **No — never read by search** |
| `search:{keyword}` | `v:{version}:{hash}` | relevanceScore, typeWeight | Yes (keyword mode) |
| `mainindex:{version}` | `entries` / `entries:{i}` | chunked path→hash map | No (search path) |
| `version:pointer` | `active` | active version + embedding model/dims | Yes (every search) |
| `vector:{hash}` | `v:{version}` | base64 Float32 embedding + metadata | Yes (semantic, dynamodb backend) |
| `vectormanifest:{version}` | `meta` / `hashes:{i}` | per-version vector hash list | Yes (semantic, dynamodb backend) |

Notable: the **full document body is stored per version but never read by the search path**,
and **`githubUrl` is never stored** — the read path maps `content.githubUrl || null`, so it
is always `null` (matching the sample).

### 1.3 Search endpoint (`read-function`)

Files: `read-function/services/documentation.js` (`search`), `read-function/models/doc-index.js`
(`queryIndex`, `getContentMetadataByHashes`), vector layer under
`src/lambda/layers/doc-ai-common/nodejs/`.

Everything is wrapped in `CacheableDataAccess.getData()` keyed by query/type/subType/limit/host
plus a `docAiMode` discriminator, so a **cache hit skips all DynamoDB reads**. On a cache miss:

- **keyword** (`ai.enabled=false`, or tier below `DocAiMinTier`, or any semantic error →
  fallback): `1` version-pointer Get + `K` keyword Queries (one per query keyword) + up to
  `3 × limit` **serial** metadata `GetItem`s. Default `limit=10`, ~3 keywords ≈ **~34 reads**.
  The `3×limit` serial metadata fan-out dominates.
- **semantic** (`DocAiVectorStore=s3-vectors` default, or `dynamodb`): embed the query via
  Bedrock (`amazon.titan-embed-text-v2:0`, 1024-dim) → vector store `query()` → enrich topK
  hits via `getContentMetadataByHashes` (**serial** `GetItem` per hit). With the **dynamodb**
  backend, cold containers load the **entire version's vector set** (`#readManifest` = 1 +
  `totalChunks` Gets, then `BatchGet` all vectors in 100-key chunks) and compute cosine
  **in-Lambda over every vector**; warm containers reuse a module-level cache (0 reads).
- **semantic-assisted**: semantic retrieval of `candidateMultiplier × topK` candidates + a
  Bedrock "assist" LLM (`amazon.nova-micro-v1:0`) re-rank/expansion, then metadata enrichment.
  Adds one LLM inference per uncached query on top of the semantic reads.

---

## 2. Is it efficient? Cost hot-spots

**Short answer: functionally fine, but read-amplified and storage-heavy in ways that don't
buy the search path anything.**

1. **Serial metadata `GetItem` fan-out (all three modes).** Both `queryIndex` (up to
   `3×limit`) and `getContentMetadataByHashes` (per hit) issue **one `GetItem` at a time in a
   `for` loop**. This is the single biggest, cheapest-to-fix inefficiency: latency scales
   linearly with result count and each round-trip is billed and awaited separately.

2. **Full content body is stored but never read by search.** `content:{hash}/v:{version}:content`
   duplicates the entire corpus **per version**, and with 7-day TTL overlap you pay for
   ≥2 generations of full-text storage that the search path never touches. It only has value
   if something *retrieves the full document* (see §4) — which nothing currently does.

3. **DynamoDB semantic backend loads the whole corpus per cold container.** In-Lambda cosine
   over every vector is O(N) memory + compute on cold start. Fine at small N; scales poorly and
   is the reason `s3-vectors` is the default. Worth documenting the N ceiling for the
   `dynamodb` backend so operators know when to switch.

4. **No GSI + `PAY_PER_REQUEST`.** Every read is a pk-scoped Get/Query. The inverted-index
   design is inherently read-amplifying (fan-out per keyword, then per result). PAY_PER_REQUEST
   is the right call for spiky MCP traffic; the amplification is the concern, not the billing mode.

5. **Redundant excerpt truncation.** Excerpt is cut to 200 chars at index time and cut to 200
   **again** at read time — harmless but signals the two layers aren't coordinated.

---

## 3. Recommendations (relevant to keyword, semantic, semantic-assisted)

Ordered roughly by value/effort. All are proposals for discussion, not decisions.

### R1 — Replace serial `GetItem` loops with `BatchGetItem` (helps all three modes)
`queryIndex`'s metadata fetch and `getContentMetadataByHashes` both loop serial Gets. Batching
into `BatchGetItem` (100 keys/request) collapses ~30 round-trips into 1 and cuts tail latency
for **every** mode's enrichment step (keyword result fetch and semantic hit enrichment share
this path). Lowest risk, highest immediate payoff. Preserve current ordering by re-sorting the
batch result by score after fetch.

### R2 — Stop writing the full-content item unless it has a reader (storage cost)
Either (a) drop `content:{hash}/v:{version}:content` entirely and reconstruct full text on
demand from GitHub/S3, or (b) keep it **only** if you add a "fetch full document" capability
(§4). Today it is pure write + storage cost with zero read benefit. If kept, consider writing
it **once per content hash** (not per version) since the body rarely changes between versions —
the deterministic hash already keys on `contentPath`.

### R3 — Improve excerpt quality at index time (improves perceived result quality in all modes)
The mid-sentence cut in the sample is a UX problem, not a cost one, but it's cheap to fix in the
extractor (one place, `markdown.js`):
- Trim to the last sentence/word boundary at or before 200 chars, or expand to the next boundary
  with a small hard cap (e.g. 240).
- Prefer starting the excerpt at the first paragraph, skipping tables/markup so results like the
  `| Type | Strin` fragment become readable prose.
- Optionally store a slightly longer stored excerpt and let the read layer trim per-mode.

  This benefits keyword and semantic identically because both return the **same** stored
  excerpt via metadata.

### R4 — Populate `githubUrl` (and `repositoryType`) at index time (all modes)
The result contract advertises `githubUrl` "URL to full document" but it is always `null`. The
indexer knows `owner`, `repo`, `filePath`, the release/branch ref, and the heading slug — enough
to construct a stable `https://github.com/{owner}/{repo}/blob/{ref}/{filePath}#{slug}` and store
it on the metadata item. This makes §4 (full-document retrieval) trivial and is mode-agnostic
since both paths read the same metadata item.

### R5 — Reduce the keyword metadata over-fetch (keyword mode)
`fetchLimit = min(ranked.length, limit*3)` fetches 3× metadata then filters by type/subType. If
`type`/`subType` filters are common, consider encoding type/subType into the `search:` item (it
already carries `typeWeight`) so filtering happens **before** the metadata fetch, shrinking the
`3×limit` fan-out. Pairs well with R1.

### R6 — Document / bound the DynamoDB vector backend (semantic + semantic-assisted)
`s3-vectors` is the default and scales; the `dynamodb` backend loads the whole corpus into Lambda
memory per cold container. Recommend: document a corpus-size ceiling for the `dynamodb` backend,
and/or emit a metric (vector count loaded) so operators can see when to move to `s3-vectors`.

### R7 — Consider a query-embedding cache (semantic + semantic-assisted)
Every uncached query embeds via Bedrock before the vector query. The result cache already
short-circuits repeat queries, but a small keyed cache of `query → embedding` (or lengthening the
result cache TTL for popular queries) avoids paying Bedrock for near-identical queries. Only
matters if embedding cost/latency shows up in practice — verify before building.

### R8 — Use the unused `exactPhrase` weight, or remove it (keyword ranking quality)
`SCORE_WEIGHTS.exactPhrase = 20` is dead. Either wire multi-word exact-phrase matching into
`computeRelevanceScore` (would have helped rank the `"S3 Artifacts Bucket Only"` example, which
literally contains `S3ModuleLocation: 63klabs-atlas-us-east-1`) or delete it to avoid implying a
behavior that doesn't exist.

---

## 4. Is the full document retrievable for further analysis?

**Today: only indirectly, and no code does it.**
- Results expose `filePath` = `contentPath` (`{org}/{repo}/{filePath}/{slug}`).
- `hash = SHA-256(contentPath)` truncated to 16 hex is deterministic, so the full body **could**
  be fetched with `GetItem(pk=content:{hash}, sk=v:{version}:content)` — but that requires the
  caller to know the active version and re-hash the path, and **no endpoint offers it**.
- `githubUrl` would be the natural "get the full doc" affordance but is always `null` (R4).

**Recommendation:** if "retrieve full document for further analysis" is a desired capability
(it seems implied by storing the body and by the MCP use case), expose it explicitly — e.g. a
`get_documentation` tool/endpoint that takes `filePath` (or `hash`), resolves the active version,
and returns the stored `content` item (or fetches from GitHub via R4's URL). That would finally
give the stored content body a reader (resolving R2's tension) and give AI clients the deep-dive
path the excerpt can't provide. This is mode-independent — it's a retrieval-by-id path, not a
search path.

---

## 5. Is the excerpt optimal information?

**Not currently.** For an AI consumer the excerpt is the primary signal when `githubUrl` is null,
yet:
- It is a blind 200-char cut that frequently ends mid-word/mid-table (see every sample item).
- It often starts inside markdown table syntax (`| Attribute | Setting | …`) rather than the
  descriptive prose, so the most useful sentence is truncated or absent.
- It is identical across keyword and semantic modes (shared metadata), so improving it once (R3)
  improves every mode.

Better excerpt = better ranking transparency **and** better input if the excerpt is ever fed to
the semantic-assisted LLM re-ranker. Consider (a) boundary-aware trimming, (b) preferring the
first prose paragraph, and (c) storing a `descriptionSnippet` distinct from a raw `bodyExcerpt`.

---

## 6. Open questions (need confirmation before acting)

1. **Default retrieval mode mismatch?** `template.yml` sets `DocAiRetrievalMode` default to
   `semantic-assisted`. Does `DEPLOYMENT.md` (and other docs) agree, or do they say `semantic`?
   Worth reconciling so operators know the real default. *(Flagged from context gathering; verify
   against the current `DEPLOYMENT.md`.)*
   **Answer:** This was temporary for testing, I put it back to the normal default now.
2. Is retrieving the **full document** an actual product goal, or is the excerpt intended to be
   the terminal result? The answer decides R2 vs R4 vs §4.
   **Answer:** We should explore returning a full document via a get_document tool
3. Are `type`/`subType` filters used often enough to justify R5's index-side denormalization?
   **Answer:** I do not have any data on this or whether there is enough information for the Agent to provide the type/SubType filter to the MCP during search. I would like the Agent to use the MCP to it's advantage so any nudge we can give to ensure it's use would be great.
4. Is there a real Bedrock **cost/latency** pain point today (R7), or is the result cache already
   absorbing repeat queries?
   **Answer:** Bedrock cost is not currently a concern
5. Expected **corpus size** trajectory — this decides whether the `dynamodb` vector backend needs
   a hard cap/warning (R6) or whether `s3-vectors` is simply the standing recommendation.
   **Answer:** Would S3 vectors be a good only option? Is there a cost savings before moving from one to the next? We could cut maintainer cognitive load and reduce options if S3 seems like the better choice. Othewise, if it makes sense to have both then provide a metric to help maintainer decide when to move
6. Is per-version duplication of the full-content body ever needed for point-in-time/version diff
   use cases, or can content be keyed by hash only (R2b)? **Answer** point-in-time is not needed, it was there in case of errors during refresh as a fallback. content can be keyed by hash only.

---

## 7. Suggested sequencing (if pursued later)

1. **R1** (batch reads) + **R3** (excerpt quality) — low risk, immediate latency + UX win, all modes.
2. **R4** (store `githubUrl`) — unlocks §4 cheaply.
3. **§4** (explicit full-document retrieval) + **R2** (rationalize content-body storage) together.
4. **R5 / R8** (keyword ranking + filter push-down) — ranking quality.
5. **R6 / R7** (semantic backend bounds + embedding cache) — only if metrics justify.

All items are additive and can be gated so keyword-mode behavior stays byte-for-byte unless a
change is explicitly intended.
