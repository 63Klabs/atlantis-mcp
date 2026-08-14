# Follow-up Questions — Documentation Index Enhancement

> Purpose: Your answers in `RECOMMENDATIONS.md` resolved the first round. These are the
> **new design decisions** those answers opened up. Please pick an option (or edit) under each
> **Answer:** line. Once these are settled I'll write `requirements.md`.
>
> Every recommendation R1–R8 plus the `get_document` tool is being pursued; these questions are
> about *how*, not *whether*.

---

## Q1 — `get_document` tool: what does it return?

You want to explore returning a full document via a `get_document` tool (RECOMMENDATIONS Q2 / §4).
Indexing chunks docs **one entry per heading**, so "full document" is ambiguous.

**Q1a. Granularity — what is a "document"?**
- **Option A:** The single heading **section** the search result points to (the chunk that was indexed).
- **Option B:** The **entire source file** (all headings of that `.md`/file reconstructed in order).
- **Option C:** Both — default to the file, allow a `section`-only flag.

**Recommendation:** **B (entire file)**. The excerpt already covers the section; the value of a
"get full document" call is the surrounding context an AI agent can't get from one chunk.

**Answer:**

**Q1b. Source of truth — where does the content come from?**
- **Option A:** Return the **stored DynamoDB content** (assembled from the indexed body item(s)).
- **Option B:** **Fetch live from GitHub** using the `githubUrl` (raw file) at request time.
- **Option C:** Prefer stored; fall back to GitHub on miss.

**Recommendation:** **C**. Stored content is fast, cache-friendly, and works even if the repo/ref
moves; GitHub fallback covers gaps (e.g. a file type we stored only a partial body for). Note:
Option B/C means the read-function needs GitHub token access (it may not have it today).

**Answer:**

**Q1c. Lookup key the caller passes**
- **Option A:** `filePath` (the `contentPath` returned by search, e.g. `63Klabs/repo/README.md/slug`).
- **Option B:** `hash`.
- **Option C:** Accept either `filePath` or `hash`.

**Recommendation:** **A** (what search already returns to the agent), with **C** as a low-cost
superset. If B (file-level) in Q1a, we'd resolve the file portion of the path.

**Answer:** Use recommendation

**Q1d. Delivery — new MCP tool + endpoint**
Confirm this becomes a new MCP tool `get_document` with `POST /mcp/get_document` on the read-function
(new route/controller/service), added to `template.yml`, `template-openapi-spec.yml`, and the tool list.
- **Recommendation:** Yes.

**Answer:** Yes, new tool, but if you recheck the current implementation, tools don't have their own endpoint. It does need to be documented for the agent to use.

**Q1e. Auth tier**
Should `get_document` be available to the same tier as keyword search (effectively public/registered),
or gated higher?
- **Recommendation:** Same access as keyword `search_documentation` (no extra gating) — it only
  returns already-public documentation.

**Answer:** Use recommendation

---

## Q2 — Vector store: consolidate on S3 Vectors only? (your RECOMMENDATIONS Q5)

You asked whether S3 Vectors should be the only option. Findings (AWS, Dec 2025 GA):
- S3 Vectors is GA: up to ~2B vectors/index, sub-second cold / ~100 ms warm query latency, native
  metadata filtering, ~90% lower vector-storage cost than traditional vector DBs.
- Rate ceiling: hundreds of query requests/sec/index (429 on exceed) — far above MCP search volume.
- The **DynamoDB** backend's weakness is structural: it loads the **whole corpus into Lambda memory**
  and computes cosine in-process (O(N) per cold container). Fine for a tiny corpus, worse as docs grow.

**Options:**
- **Option A:** **S3 Vectors only.** Remove the `dynamodb` vector backend and the `DocAiVectorStore`
  parameter (or fix it to `s3-vectors`). Cuts maintainer cognitive load and dead code paths.
- **Option B:** **Keep both**, make `s3-vectors` the clear default, and add a metric (vectors loaded /
  cosine time) so a maintainer knows when the `dynamodb` path is being outgrown.
- **Option C:** Keep both as-is (no change).

**Recommendation:** **Option A.** For a documentation corpus S3 Vectors dominates on cost, scale, and
simplicity, and it's already the default. Removing the DynamoDB backend deletes a whole load-whole-corpus
code path and one config axis. (If you foresee air-gapped/DynamoDB-only deployments, choose B instead.)

**Answer:** Use option A and remove the DocAiVectorStore parameter. Ensure all documentation is updated.

---

## Q3 — Nudging the agent to use `type` / `subType` filters (your RECOMMENDATIONS Q3)

You have no usage data and want to *encourage* the agent to use filters. Two complementary levers:

**Q3a. Return available facets in the search response.**
Add an `availableFilters` (facets) block to the `search_documentation` response listing the `type` and
`subType` values present in the result set (with counts), so the agent can see what to filter by and
issue a refined follow-up call.
- **Recommendation:** Yes — this is the strongest nudge and matches how agents self-correct.

**Answer:** Go with recommendation

**Q3b. Strengthen the tool description / schema.**
Enumerate the allowed `type`/`subType` values in the tool's input schema and add a short "refine with
type/subType when results are broad" hint to the tool description.
- **Recommendation:** Yes — cheap, and enum values in the schema make the agent far more likely to use them.

**Answer:** Go with recommendation

**Q3c. Optional: a `suggestions` hint when result count is high.**
When `totalResults` is large, populate `suggestions` with a "narrow by type: …" nudge (the field already
exists and is only used for zero-result cases today).
- **Recommendation:** Yes — reuses an existing field.

**Answer:** Go with recommendation

---

## Q4 — `exactPhrase` scoring (R8)

`SCORE_WEIGHTS.exactPhrase = 20` is defined but unused. Current scores are **precomputed at index time per keyword**; exact-phrase matching depends on the *query* phrase, so it can only be applied at **query time** against fetched metadata (title/excerpt) or content.

**Options:**
- **Option A:** **Implement** a query-time exact-phrase boost: after metadata fetch, add the `exactPhrase` weight when the full query phrase appears in title/excerpt. (New query-time scoring step.)
- **Option B:** **Remove** the dead weight and keep ranking purely index-time keyword scores.

**Recommendation:** **Option A** — it directly improves cases like the sample query (the best answer,
"S3 Artifacts Bucket Only", literally contains the target string) and only runs on the already-fetched top results, so cost is negligible. Applies to keyword mode (semantic already ranks by cosine).

**Answer:** Go with recommendation

---

## Q5 — `githubUrl` / `repositoryType` / `namespace` (R4)

Search currently returns these as `null`. To populate `githubUrl` the indexer must record the repo `ref`
and build a URL.

**Q5a. URL precision:**
- **Option A:** File-level link: `https://github.com/{owner}/{repo}/blob/{ref}/{filePath}`.
- **Option B:** Deep link to the heading anchor: `…/{filePath}#{anchor}`. Caveat: GitHub's anchor
  algorithm differs slightly from our `slugifyHeading`, so anchors could occasionally miss.
- **Recommendation:** **B with A as the guaranteed fallback** — attempt the heading anchor (our slug is usually correct), and the file-level link always works even if the anchor is off.

**Answer:** Just use option A

**Q5b. Which `ref`?** The indexer already chooses a release zip when available, else the default branch.
- **Recommendation:** Use the **release tag when the archive came from a release, else the default branch**
  — matching whatever was actually indexed, so the link points at the indexed content.

**Answer:**  Go with recommendation

**Q5c. `repositoryType` / `namespace`:** The search service comments reference an `atlantis_repository-type`
GitHub custom property. Should the indexer **capture and store** `repositoryType` (documentation, app-starter,
templates, package, mcp) and `namespace` so results stop returning `null`?
- **Recommendation:** Yes — capture the repo custom property at index time and store it on the metadata item.
  (If the custom property isn't reliably set, we store what's available and leave the rest null.)

**Answer:**  Go with recommendation

---

## Q6 — Content lifecycle once content is keyed by hash only (R2/R2b)

You confirmed content can be **keyed by hash only** (drop per-version duplication; point-in-time not needed).
That removes the version from the content item's key, so we need a cleanup rule for headings that get
**removed or renamed** between builds (their old hash is no longer referenced).

**Options:**
- **Option A:** **TTL refresh on write.** Each build re-writes (upserts) every current hash with a fresh
  7-day TTL; orphaned hashes simply expire ~7 days after they stop being written. Simple, self-healing.
- **Option B:** **Explicit orphan delete.** Diff current vs previous hash set each build and delete removed ones.
- **Recommendation:** **Option A** — matches the existing TTL-based cleanup model and needs no diffing.

**Answer:** Go with recommendation

---

## Q7 — Scope & sequencing confirmation

This spec will span **both** Lambdas and infra:
- `doc-indexer`: excerpt quality (R3), store `githubUrl`/`repositoryType`/`namespace` (R4/R5), content
  keyed by hash (R2), `exactPhrase` inputs if needed (R8), vector-store change (Q2).
- `read-function`: `BatchGetItem` enrichment (R1), filter push-down (R5), facets/hints (Q3), query-time
  phrase boost (R8), the new `get_document` tool (Q1).
- Infra/docs: `template.yml`, `template-openapi-spec.yml`, tool list, and doc updates
  (ARCHITECTURE/DEPLOYMENT/CHANGELOG/docs).

**Q7a.** Confirm one combined spec (this `0-0-6-documentation-index-enhancement`) is the right container
for all of the above, rather than splitting `get_document` into its own spec.
- **Recommendation:** Keep combined — the changes share the storage schema and result contract.

**Answer:** Go with recommendation

**Q7b. R7 (query-embedding cache):** You said Bedrock cost isn't a concern. Drop R7 from this spec (revisit
only if metrics later justify), or keep a lightweight version?
- **Recommendation:** **Drop** from this spec; note it as a future option.

**Answer:** Go with recommendation

---

## Q8 — Backward compatibility guarantee

Should the keyword-only path (feature disabled / below-tier) remain **byte-for-byte identical** in its response shape, with new fields (`availableFilters`, populated `githubUrl`, etc.) added as **additive, optional** fields only?
- **Recommendation:** Yes — additive only; no removal or renaming of existing result fields, so current MCP clients keep working.

**Answer:** Go with recommendation
