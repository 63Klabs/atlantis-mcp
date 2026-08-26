# Investigation Summary: `semantic-assisted` retrieval silently returns keyword results

## Status

**Root cause narrowed to one specific code path. Not yet fixed.** Evidence below points at
`SemanticRetrieval.retrieve()` (or the vector query/content-lookup it calls) returning
zero results for every tested query, which `SemanticAssistedRetrieval` and `FallbackRetrieval`
both treat as a *normal, successful* outcome rather than a failure — so nothing is logged and
the keyword path silently takes over.

## Configuration confirmed correct

Verified directly against the deployed `prod63k-atlantis-mcp-test-ReadFunction` Lambda:

- `DOC_AI_ENABLED=true`, `DOC_AI_RETRIEVAL_MODE=semantic-assisted`, `DOC_AI_MIN_TIER=paid`
- Deployed function code matches repo (`selectStrategy`/`getDocAiComponents` present, correct
  line numbers)
- Deployed `DocAiCommonLayer` content matches repo (`SemanticAssistedRetrieval`, `DOC_AI_USAGE`
  both present, non-zero grep counts)
- `version:pointer/active` in DynamoDB (`prod63k-atlantis-mcp-test-DocIndex`) shows
  `embeddingEnabled: true`, `embeddingModel: amazon.titan-embed-text-v2:0`,
  `embeddingDimensions: 1024`, version `20260826T005649`
- Doc-indexer logs confirm `embedding_phase_complete` with `upserted: true` for that version
  (`total: 5123, reused: 2272, embedded: 2851, skipped: 0`)
- A temporary diagnostic log (`DIAG: pre-selectStrategy snapshot`) added directly before the
  `selectStrategy()` call in `services/documentation.js` confirms, for the exact failing
  request, every input `selectStrategy` needs to select the assisted path is correct:

  ```
  enabled: true, enabledType: 'boolean', retrievalMode: 'semantic-assisted',
  minTier: 'paid', callerTier: 'private', version: '20260826T005649',
  hasSemantic: true, semanticHasRetrieve: true,
  hasSemanticAssisted: true, semanticAssistedHasRetrieve: true
  ```

  `callerRank(private)=3 >= minRank(paid)=2`, `mode='semantic-assisted'` — `selectStrategy`
  must select `semanticAssisted` here. This rules out every configuration/wiring
  explanation investigated in the prior chat thread (tier gating, stale layer, stale function
  code, settings property-name mismatch, log-level suppression).

## Evidence this specific request took the semantic-assisted path — and it produced keyword-shaped output anyway

Request `56854f9e-e3ec-4be9-872c-96d49cf78a19` (full trace in `CW-LOGS.md`, full response body
in `DOC-SEARCH-RESULT.json`):

1. `DIAG: pre-selectStrategy snapshot` confirms the assisted branch is selected (above).
2. Immediately after that line, the very next log entries are the cache-write sequence
   (`Putting record to DynamoDb`, `Cache Updated`) and `search_documentation response`. There
   is **no** intervening log line of any kind between the DIAG snapshot and the cache write —
   not `DOC_AI_USAGE`, not `SemanticAssistedRetrieval: <=1 candidate...`, not
   `RetrievalStrategy "semantic-assisted"... failed`, not `doc_ai_bedrock_model_unavailable`.
3. The elapsed time between the DIAG line (`17.166Z`) and the cache write (`17.484Z`) is
   **~318ms** — plausible for a keyword-only DynamoDB path, tight but not impossible for an
   embed+query+lookup round trip.
4. The response body (`DOC-SEARCH-RESULT.json`) has `totalResults: 30` and every
   `relevanceScore` is a small integer (49, 39, 39, 36, 34, 31, 31, 31, 31, 31). Semantic
   results carry a cosine-similarity `relevanceScore` in `[0, 1]` (per
   `SemanticRetrieval.retrieve()`'s own doc comment: `relevanceScore` = the hit's raw cosine
   `score`). Integer scores in the 30s/40s match the **keyword** scorer exactly
   (`titleMatch: 10`, `excerptMatch: 5`, `keywordMatch: 3`, weighted by `typeWeight`, plus a
   possible +20 exact-phrase boost) — not a semantic or assisted result set.

## Why this produces total silence instead of an error or a warning

Tracing the code paths in `application-infrastructure/src/lambda/layers/doc-ai-common/nodejs/retrieval-strategy.js`:

- `SemanticAssistedRetrieval.retrieve()` calls `this.#semantic.retrieve(...)` to get
  candidates. If that call resolves with **0 or 1** results, it takes this branch with no
  warning:
  ```js
  if (candidateResults.length <= 1) {
    this.#logger.debug('SemanticAssistedRetrieval: <=1 candidate; ...');
    return SemanticAssistedRetrieval.#sliceEnvelope(candidateEnvelope, candidateResults, effectiveTopK, query);
  }
  ```
  That `debug()` line is the ONE log line that should have appeared and did not — but it is
  logged via the SAME `DebugAndLog` instance that emitted every other DEBUG line in this
  trace (`Searching documentation (cache miss)` etc. all appear), so log-level suppression
  cannot explain its absence. Its absence needs to be reconciled with point 2 below.
- `FallbackRetrieval.retrieve()` (constructed by `selectStrategy`, wraps
  `semanticAssisted` with `keyword` as the fallback) only logs/degrades when the **primary
  throws**. If `SemanticAssistedRetrieval.retrieve()` resolves successfully — even with an
  empty/near-empty result envelope — `FallbackRetrieval` has no reason to intervene, log
  nothing, and the resolved (empty-ish) envelope is returned as-is up through
  `services/documentation.js`.
- Neither of the above explains why the **actual returned data has keyword-shaped integer
  scores and 30 results** rather than an empty/near-empty semantic envelope. This is the
  central unresolved contradiction: the evidence in point 2 (silence) suggests "semantic
  path ran and returned ≤1 candidate," while the evidence in point 4 (score shape, 30
  results) suggests "keyword path ran instead." These cannot both be literally true of the
  same code as currently read, which means either:
  - (a) something in the request lifecycle re-enters `keywordSearchFn()` independent of
    `selectStrategy`'s chosen strategy object (e.g. a caching/memoization layer serving a
    stale result, or the strategy object's `.retrieve` silently delegating to keyword
    internally in a way not yet traced), or
  - (b) the missing DEBUG line is a false negative in log collection/search (e.g. CloudWatch
    Logs Insights query timing/ingestion lag, or the line landing in a different log stream
    not captured by the by-RequestId filter), or
  - (c) an uninvestigated code path in `SemanticAssistedRetrieval`/`SemanticRetrieval`
    between the semantic call and result shaping is producing keyword-shaped output.

## Files in this spec directory

- `CW-LOGS.md` — full unfiltered CloudWatch trace for request
  `56854f9e-e3ec-4be9-872c-96d49cf78a19` (includes the `DIAG` line and the full request/response
  cycle, `github template pipeline` query, tier `private`).
- `DOC-SEARCH-RESULT.json` — the raw JSON-RPC response body returned to the client for the
  same request. `totalResults: 30`, integer `relevanceScore` values, `availableFilters`
  present (confirming this spec's other 0-0-6 changes — facets, `type`/`subType` — are working
  correctly; only the semantic-assisted retrieval selection/execution is suspect).

## Temporary diagnostic still in the codebase

`application-infrastructure/src/lambda/read-function/services/documentation.js` currently has
a temporary `DebugAndLog.info('DIAG: pre-selectStrategy snapshot', {...})` call inserted
immediately before the `selectStrategy(...)` invocation inside `search()`'s cache-miss
`fetchFunction`. It is marked `// >! TEMPORARY DIAGNOSTIC` in a comment. **Do not remove it
yet** — the next investigation step needs a similar (or expanded) diagnostic. Full jest suite
for `read-function` passes with this diagnostic in place (58/58 in the `services/documentation`
suite; not yet re-run against the full suite after this change).

## Recommended next steps

1. **Add a diagnostic immediately after `strategy.retrieve()` resolves**, logging
   `strategy.constructor.name`, `searchResult.results.length`, and the first result's
   `relevanceScore`/keys, so we can see — for a single request — both which strategy object
   was actually invoked AND the shape of what it returned, closing the gap between the DIAG
   snapshot (which only proves what was *selected*, not what was *returned*).
2. **Add a diagnostic inside `SemanticRetrieval.retrieve()`** (or temporarily patch the layer
   with one) logging the embedding call outcome, `filters`, `hits.length` from
   `vectorStore.query(...)`, and `built.length` from `buildResults(...)` — this pinpoints
   whether the vector query itself is returning 0 hits (e.g. a metadata/filter mismatch
   against the S3 Vectors index, or a version-scoped key mismatch — recall vectors are keyed
   `${version}#${hash}` and filtered by `version` per `vector-store-s3.js`) versus content
   lookup dropping every hit (e.g. `getContentMetadataByHashes` finding no metadata for the
   returned hashes). **Double check, this may have been done**
3. **Directly query S3 Vectors for this active version** to rule out a version-key mismatch:
   ```bash
   aws s3vectors query-vectors \
     --vector-bucket-name prod63k-atlantis-mcp-test-docvec \
     --index-name prod63k-atlantis-mcp-test-docidx \
     --query-vector '{"float32": [... an embedding for "github template pipeline" ...]}' \
     --top-k 5 --profile YOUR_PROFILE
   ```
   or more simply, use `list-vectors`/`get-vectors` to confirm vectors are actually keyed with
   the `20260826T005649#` prefix expected by `SemanticRetrieval`'s version filter, not a
   different/previous version's prefix.
4. **Re-confirm the missing `<=1 candidate` DEBUG line is a true negative**, not a log
   collection artifact: re-run the same query, wait 2-3 minutes for full log ingestion, and
   re-pull the FULL (not filtered) trace for the new RequestId, scanning manually rather than
   via a `like` filter (a `like` filter is exact-substring but ingestion lag or multi-line
   message truncation in the CloudWatch console table view could still hide a line — the raw
   `filter-log-events` CLI output is more reliable than the Logs Insights table render used so
   far).
5. Once the true resolved envelope for the semantic-assisted call is visible (step 1/2), the
   fix is almost certainly one of:
   - a bug in how `topK`/`filters`/`version` are passed into `vectorStore.query()`,
   - a mismatch between the metadata filter keys built by `buildSemanticFilters({ type,
     ghusers })` and what's actually stored as filterable metadata on each vector
     (`vector-store-s3.js` — check `FILTERABLE_FILTER_KEYS`), or
   - `getContentMetadataByHashes` failing to resolve the returned hashes to metadata (silently
     dropping every hit), in `services/documentation.js`'s injected `buildResults`.
6. Once root-caused, remove the temporary `DIAG: pre-selectStrategy snapshot` log added to
   `services/documentation.js` as part of this investigation before closing out the fix.

## Update: Bedrock Model Invocations metric narrows the failure point further

Checked CloudWatch → Bedrock → Model invocations for the account/region during test activity.
Only `amazon.titan-embed-text-v2:0` shows invocations; `amazon.nova-micro-v1:0` (the assist
model, used only by `semantic-assisted` mode) shows **zero** invocations across the same
period, including individual ad-hoc test calls.

**Caveat:** the specific embedding invocation inspected had `inputText: "github template
connect"`, which does not match the `"github template pipeline"` query traced in `CW-LOGS.md`
/ `DOC-SEARCH-RESULT.json` (request `56854f9e-e3ec-4be9-872c-96d49cf78a19`). This confirms
Bedrock embedding calls are succeeding for *some* `search_documentation` request, but it has
not yet been cross-referenced against a specific application log trace showing which of the
downstream outcomes (short-circuit debug line, `DOC_AI_USAGE`, or fallback warning) occurred
for that exact call.

### What this confirms

- Bedrock IAM permissions, network path, and the `EmbeddingProvider.embed()` call all work:
  the returned embedding is a well-formed 1024-dim normalized float vector (matches
  `DOC_AI_EMBEDDING_DIMENSIONS=1024` and Titan V2's `normalize: true` request shape).
- Execution reaches deep inside `SemanticRetrieval.retrieve()` — past `selectStrategy`,
  `getDocAiComponents`, and the tier/mode gate (all previously confirmed correct via the
  `DIAG` snapshot) — as far as `this.#embedQuery(query)` inside the strategy's own try block.

### What this narrows

Since the assist model is NEVER invoked, whatever happens next in `SemanticRetrieval.retrieve()`
— after `#embedQuery` succeeds, i.e. `buildSemanticFilters(...)`, `this.#vectorStore.query(...)`,
or the injected `this.#buildResults(...)` (content-metadata lookup) — either:

- (a) resolves with ≤1 candidate (triggering `SemanticAssistedRetrieval`'s no-op-rerank
  short-circuit and its DEBUG log), or
- (b) throws, which `SemanticRetrieval` wraps as a `RetrievalError` and re-throws (it never
  degrades itself — see its class doc comment), which `FallbackRetrieval` then catches,
  WARN-logs, and degrades to keyword.

**(b) is the better fit for the actual observed response data** (`DOC-SEARCH-RESULT.json`:
`totalResults: 30`, small-integer `relevanceScore` values 49/39/39/36/34/31×5 — exactly the
keyword scorer's shape, not a cosine float in `[0,1]`). The previously-unexplained absence of
ANY distinguishing log line for request `56854f9e` (neither the short-circuit debug line nor
the fallback warning) remains the key open contradiction — but the search space for where that
missing log line should be emitted has shrunk from "anywhere in the whole retrieval stack" to
specifically: `S3VectorStore.query()`, the injected `buildResults` (content-hash → metadata
lookup via `Models.DocIndex.getContentMetadataByHashes`/`batchGetMetadata`), or
`FallbackRetrieval`'s catch block itself failing to log for some reason.

### Immediate next action (supersedes/sharpens step 2 above)

Re-run a `search_documentation` test call, immediately note its exact timestamp, then in the
SAME narrow time window check BOTH:

1. CloudWatch → Bedrock → Model invocations, filtered to that ~1-minute window — confirm
   whether `amazon.titan-embed-text-v2:0` fires (expected) and whether ANY `s3vectors:*` API
   activity is visible via CloudTrail for that window (Model invocations metrics won't show
   S3 Vectors calls — CloudTrail event history filtered by `EventSource: s3vectors.amazonaws.com`
   and the request timeframe is the right tool here).
2. The full unfiltered ReadFunction log trace for that request's RequestId (via
   `filter-log-events` CLI, not the Logs Insights table view, to rule out a log-rendering/
   ingestion-lag false negative per step 4 in the original recommendations above).

If CloudTrail shows a `QueryVectors` call failing (e.g. `AccessDenied`, `ResourceNotFoundException`
if the index/bucket name resolved differently than expected, or a dimension mismatch error),
that is very likely the root cause, and would also explain why the assist model is never
reached — `SemanticRetrieval` throws before `SemanticAssistedRetrieval` ever gets multiple
candidates to re-rank.

## Update: CloudTrail returned no `s3vectors.amazonaws.com` events — expected, not conclusive

For request `0cb4b7ba-d9bb-48af-aca9-396f0b08608e` (query `"github pipeline template
parameters"`, full trace in `CW-LOGS-2.md`), the same silent pattern repeats: the `DIAG:
pre-selectStrategy snapshot` line fires at `03:34:54.847Z` with all inputs correct
(`enabled: true`, `retrievalMode: 'semantic-assisted'`, `callerTier: 'private'`,
`hasSemantic/hasSemanticAssisted: true`), and the very next relevant log line is the cache
write at `03:34:55.098Z` — a ~251ms gap with zero intervening log output. Total request
duration was only 373ms.

A CloudTrail Event History lookup filtered to `Event source = s3vectors.amazonaws.com` for
this window returned **zero results**.

**This does NOT prove `QueryVectors` was never called.** CloudTrail Event History (the
console "Event history" view / `lookup-events` API) only captures **management events** by
default. Data-plane API calls — which is what `S3VectorsClient`'s `QueryVectors`,
`PutVectors`, `GetVectors`, `ListVectors`, `DeleteVectors` all are, analogous to S3 object-level
`GetObject`/`PutObject` — are **not** logged there unless a CloudTrail **trail** has been
explicitly configured with **data event logging enabled** for the S3 Vectors resource type.
Absent that specific trail configuration, an empty Event History result is the expected
outcome regardless of whether the call succeeded, failed, or was never made — it is not
evidence either way for this investigation.

**Do not rely on CloudTrail Event History for this any further** unless a data-event trail is
confirmed configured (check CloudTrail console → Trails → any trail → Data events, looking
for an S3-compatible/S3 Vectors data event selector). Setting one up now would only start
capturing events going forward, so it would not retroactively explain the requests already
tested.

### Revised assessment given the ~251ms gap

251ms is short. Looking back at the one confirmed-successful embedding call (Bedrock Model
Invocations detail, `MODEL-LOGS.md`), a single Titan V2 `InvokeModel` round trip alone appears
consistent with roughly 100-250ms based on comparable timings elsewhere in these traces. A
251ms gap therefore does NOT comfortably fit "embed query (~150-250ms) + QueryVectors (S3
Vectors network round trip) + DynamoDB BatchGetItem content lookup" all in sequence. This
raises the alternative possibility, not yet ruled out, that for THIS request the embedding
call itself was skipped or short-circuited before reaching Bedrock at all (e.g. the
query-embedding cache in `SemanticRetrieval` returning a hit from an earlier identical/
normalized query — see `normalizeQuery()`/`#embedQuery()`/`#cache` in `retrieval-strategy.js`
— though the query text differs across requests tested so far, making a cache hit unlikely
unless normalization is collapsing more aggressively than expected), or that something is
failing even earlier than the embedding call in a way not yet logged.

### Next action (supersedes the CloudTrail step)

Abandon CloudTrail Event History as an investigation avenue for this issue. Instead:

1. **Instrument `SemanticRetrieval.retrieve()` directly** (temporary diagnostic patch to the
   `doc-ai-common` layer, mirroring the approach already used in `services/documentation.js`):
   add a log line immediately before `this.#embedQuery(query)`, immediately after it succeeds
   (logging embedding length + whether it was a cache hit/miss via `getCacheStats()`),
   immediately before `this.#vectorStore.query(...)`, and immediately after it resolves
   (logging `hits.length`). Wrap in a way that logs on the catch path too, capturing
   `error.code`/`error.message`/`error.cause` — since `SemanticRetrieval` re-throws as a typed
   `RetrievalError`, the cause of a `QueryVectors` failure should be recoverable via
   `error.cause`.
2. Alternatively/additionally, enable **Bedrock model invocation logging** (Bedrock console →
   Settings → Model invocation logging → deliver to CloudWatch Logs) if not already fully
   configured for every model — this gives ground-truth on every InvokeModel call (success or
   error) without relying on application-level try/catch logging.
3. Re-run one test request after step 1 is deployed, and pull the full trace the same way as
   before. This should finally surface the fault boundary (embedding vs. vector query vs.
   content lookup vs. something being silently short-circuited) directly, since it is
   independent of the CloudTrail data-event gap and independent of any log-level filtering
   already ruled out.

## Update: Diagnostic added inside `SemanticRetrieval.retrieve()` (not yet deployed)

Two files modified (uncommitted, on branch `test`):

1. `application-infrastructure/src/lambda/layers/doc-ai-common/nodejs/retrieval-strategy.js`
   - Added an optional `logger` constructor param to `SemanticRetrieval` (new `#logger` private
     field, defaults via `normalizeLogger(logger)` to a no-op — fully backward compatible with
     every existing call site/test that does not pass one).
   - Instrumented `retrieve()` with INFO-level (PROD-visible) diagnostic lines at each stage:
     - `DIAG: SemanticRetrieval.retrieve start` — `{ version, effectiveTopK }`
     - `DIAG: SemanticRetrieval embedding obtained` — `{ embeddingLength, cacheStats }`
       (`cacheStats` from the existing `getCacheStats()` — will show `hits`/`misses`, directly
       answering the open question of whether the query-embedding cache is serving a stale hit)
     - `DIAG: SemanticRetrieval filters built` — `{ filters }` (the metadata filter object
       passed to `vectorStore.query`, from `buildSemanticFilters({ type, ghusers })`)
     - `DIAG: SemanticRetrieval vectorStore.query resolved` — `{ hitsLength, topHashes }`
     - `DIAG: SemanticRetrieval buildResults resolved` — `{ resultsLength,
       firstRelevanceScore }` (a float here confirms semantic scoring; absent/undefined
       confirms zero hits reached this point)
     - On any thrown error: `DIAG: SemanticRetrieval.retrieve caught an error` (WARN level) —
       `{ code, message, name }`, logged BEFORE the error is wrapped/re-thrown, so the original
       underlying failure (e.g. an S3 Vectors SDK error) is visible even if a wrapper upstream
       doesn't surface `error.cause`.
2. `application-infrastructure/src/lambda/read-function/services/documentation.js` — passes
   `logger: DebugAndLog` into the `SemanticRetrieval` constructor call inside
   `getDocAiComponents()`.

Verified: full `doc-ai-common` layer suite (207/207) and the `read-function`
`services/documentation` suite (58/58) both pass unchanged with these edits in place.

### What to do with this diagnostic

1. Deploy to the `test` stack (same as the earlier `DIAG: pre-selectStrategy snapshot`
   diagnostic).
2. Re-run one `search_documentation` call as a `private`-tier caller.
3. Pull the full unfiltered trace for that RequestId. Expect one of:
   - **No `DIAG: SemanticRetrieval.retrieve start` line at all** — would mean
     `strategy.retrieve()` in `services/documentation.js` is not actually invoking the
     `semanticAssisted`/`semantic` object we think it is, despite the earlier `DIAG:
     pre-selectStrategy snapshot` confirming a valid object was selected. This would be the
     most surprising outcome and point at something in `FallbackRetrieval`/`selectStrategy`'s
     returned object not being the one actually awaited.
   - **Start line present, but stops at "embedding obtained"** — the vector store query or
     content lookup is hanging/never resolving/being swallowed somewhere unexpected (unlikely
     given the ~250-370ms total request durations observed, but would need `hitsLength`
     specifically to confirm).
   - **Progresses through "vectorStore.query resolved" with `hitsLength: 0`** — confirms the
     S3 Vectors query itself is returning nothing for this version/filter combination. Next
     step would be inspecting `filters` in the diagnostic output against
     `FILTERABLE_FILTER_KEYS` in `vector-store-s3.js`, and independently listing/querying the
     S3 Vectors index directly (per step 3 in the original recommendations) to confirm vectors
     are actually keyed under `20260826T005649#...`.
   - **Progresses through "buildResults resolved" with `resultsLength: 0`** but
     `hitsLength > 0` — confirms the vector query succeeds but content-metadata lookup
     (`getContentMetadataByHashes`/`batchGetMetadata`) is failing to resolve the returned
     hashes, dropping every hit.
   - **The WARN "caught an error" line appears** — gives the exact `code`/`message`/`name` of
     the real underlying failure directly, which should immediately explain the keyword-shaped
     fallback output seen in `DOC-SEARCH-RESULT.json`.
4. Once the fault point is identified from the above, remove BOTH temporary diagnostics (this
   one and the `DIAG: pre-selectStrategy snapshot` one in `services/documentation.js`) as part
   of the fix commit, along with reverting the `logger` constructor addition if it is not
   otherwise wanted as a permanent capability of `SemanticRetrieval`.
