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

## Update: REQ4 test — exact query/embedding match confirmed, but the new `SemanticRetrieval` diagnostic is absent from the trace

Request `2c6ad0a5-70be-4a06-8967-4d86dd78974c` (query `"atlantis regional s3 buckets
location"`, tier `private`, full trace in `REQ4-CW-LOGS.md`; response in
`REQ4-API-RESPONSE.md`; Bedrock invocation detail in `REQ4-MODEL-LOGS.md`).

### New fact: this is the first time the Bedrock call and the application request are provably the same event

Unlike the two earlier Bedrock invocation checks (which had `inputText` values that did not
match the query in the traced request, so they could only be treated as "Bedrock works in
general"), this time:
- `REQ4-MODEL-LOGS.md` `inputText`: `"atlantis regional s3 buckets location"` — **exact match**
  to the traced request's query.
- Model invocation timestamp: `August 26, 2026, 14:16 UTC-05:00` = `19:16 UTC` — matches the
  traced request's timing (`19:16:26.437Z` DIAG snapshot, `19:16:26.7xx` response) to the
  minute.

**This conclusively proves, for the first time, that `EmbeddingProvider.embed()` was invoked
with the real user query for this exact `search_documentation` call.** Since the only caller of
`EmbeddingProvider.embed()` in this codebase is `SemanticRetrieval.#embedQuery()` (private,
called only from inside `SemanticRetrieval.retrieve()`'s try block), this proves execution
reached inside `SemanticRetrieval.retrieve()`, past the point where our newest diagnostic log
(`DIAG: SemanticRetrieval.retrieve start`, logged at INFO immediately before `#embedQuery` is
even called) should have fired.

### The contradiction: the new diagnostic line never appears

`REQ4-CW-LOGS.md` contains `DIAG: pre-selectStrategy snapshot` (the OLDER diagnostic, in
`services/documentation.js`) but **none** of the newer `DIAG: SemanticRetrieval.*` lines added
in the last code change to `retrieval-strategy.js` — not the `retrieve start` line, not
`embedding obtained`, not `filters built`, not `vectorStore.query resolved`, not
`buildResults resolved`, and not the WARN `retrieve caught an error` line. Given the embedding
call is now proven to have happened for this exact request, at least the first ("retrieve
start") and second ("embedding obtained") of these lines should be unconditionally present —
they sit directly in the code path the embedding call took.

The response (`REQ4-API-RESPONSE.md`) is, again, keyword-shaped: `relevanceScore` values are
small integers (32, 26×9), and — notably — the `type`/`subType` breakdown in `availableFilters`
(`template-pattern`/`parameter` ×7, `documentation`/`guide` ×3) matches the keyword scorer's
type-weighted integer scoring exactly, not a cosine-similarity ranking.

### Leading hypothesis: the newest diagnostic patch was not actually deployed for this test

The simplest explanation, and the one to rule out FIRST before considering anything more
exotic: **this REQ4 test likely ran against a Lambda/layer deployment that predates the
`SemanticRetrieval` diagnostic patch** (the patch that added `#logger`/the `DIAG:
SemanticRetrieval.*` lines to `retrieval-strategy.js` and wired `logger: DebugAndLog` into its
constructor call in `services/documentation.js`). The user's own framing ("logs for a query
that includes the latest DIAG message") is consistent with them treating `DIAG:
pre-selectStrategy snapshot` as "the latest," since that was the most recently *discussed*
diagnostic in earlier turns — but the `SemanticRetrieval` diagnostic was added in the turn
immediately before this one and its deployment status was never explicitly confirmed.

This also fits the observed timing: the traced request was a **warm invocation** (the `REPORT`
line has no `Init Duration` field at all), meaning it reused an existing execution
environment. If that environment was warmed before the newest layer patch was deployed, it may
be running against an in-memory `docAiComponents` singleton (`services/documentation.js`
memoizes `getDocAiComponents(ai)` at module scope — constructed once per warm container and
reused for the container's remaining lifetime) that was built from the pre-patch layer code.

### Secondary observation worth flagging (not yet implicated, needs no action unless the primary hypothesis is ruled out)

`template.yml`'s `ReadLambdaFunction` has `AutoPublishCodeSha256: "20260224T000000"` — a
hardcoded literal string, not a value that changes per deployment. This SAM property controls
whether a new Lambda **version** is published and the `live` **alias** repointed; a static value
across deployments can mean the `live` alias stops tracking new code even though `$LATEST`
updates normally. However, `template-openapi-spec.yml`'s API Gateway integration invokes
`${ReadLambdaFunction.Arn}` (the unqualified ARN, i.e. `$LATEST`), not `${ReadLambdaFunction.Alias}`,
so this mechanism likely does not affect the TEST stage's request path. Flagged for later
hygiene (the hardcoded value should probably be a real per-build token, e.g. a git SHA or build
timestamp actually substituted at build time) but not the leading suspect for this specific
symptom.

## Recommended next step (do this before anything else)

1. **Confirm whether the `retrieval-strategy.js` diagnostic patch (added in the immediately
   preceding step, before REQ4 testing began) has actually been deployed to this stack.** Use
   the same verification technique already validated earlier in this investigation:
   ```bash
   aws lambda get-function-configuration \
     --function-name prod63k-atlantis-mcp-test-ReadFunction \
     --query 'Layers[].Arn' --profile YOUR_PROFILE

   aws lambda get-layer-version-by-arn \
     --arn "<the DocAiCommon layer ARN:version from above>" \
     --query 'Content.Location' --profile YOUR_PROFILE

   curl -o /tmp/doc-ai-layer-check.zip "<signed URL>"
   unzip -p /tmp/doc-ai-layer-check.zip nodejs/retrieval-strategy.js | grep -c "DIAG: SemanticRetrieval.retrieve start"
   ```
   A `0` confirms the deploy has not gone out yet — deploy it, then re-run one test and re-pull
   the trace. A non-zero count means the patch IS live, and the missing log lines are a genuine
   new finding requiring further investigation (at that point, check the Lambda's actual cold
   vs. warm status more carefully across several back-to-back test calls, and consider whether
   `getDocAiComponents()`'s module-level memoization is holding onto a stale in-memory instance
   across a deploy in a way that needs its own fix — e.g. adding a cache-busting mechanism tied
   to a deploy identifier).
2. If the patch was confirmed not-yet-deployed, redeploy, then re-run the SAME query
   (`"atlantis regional s3 buckets location"` — reusing it lets the new Bedrock invocation
   check act as a second independent confirmation that this exact request is being traced) and
   pull the full unfiltered log again. Expect one of the outcomes enumerated in the "What to do
   with this diagnostic" section above (start-only-then-stops / hitsLength 0 / resultsLength 0
   / the caught-error WARN line) — whichever appears will identify the fault boundary directly.

## Update: Layer confirmed patched (`grep -c` returned 1) — ruling in a sharper hypothesis

The DocAiCommon layer download check returned `1` for
`"DIAG: SemanticRetrieval.retrieve start"` in `nodejs/retrieval-strategy.js`. **The layer
deployment is current; the leading "stale layer" hypothesis from the previous update is
ruled out.**

However, the diagnostic patch touched TWO files, and only the layer half has now been
verified:

1. `application-infrastructure/src/lambda/layers/doc-ai-common/nodejs/retrieval-strategy.js`
   (the layer) — **confirmed deployed** (this check).
2. `application-infrastructure/src/lambda/read-function/services/documentation.js` (the
   function's OWN code package, deployed separately from the layer in SAM/CloudFormation) —
   **not yet independently verified.** This file is what passes `logger: DebugAndLog` into
   the `SemanticRetrieval` constructor inside `getDocAiComponents()`.

### Why this specific gap would produce exactly the observed silence

`SemanticRetrieval`'s constructor signature is
`constructor({ embeddingProvider, vectorStore, buildResults, cache, maxCacheSize, topK, logger } = {})`,
and it always sets `this.#logger = normalizeLogger(logger)`. `normalizeLogger(undefined)`
returns an object where `warn`/`error`/`debug`/`info` are ALL no-ops (`NOOP = () => {}`) when
no logger is supplied.

If the deployed `services/documentation.js` predates the change that added `logger:
DebugAndLog` to the `SemanticRetrieval` constructor call, then:
- `SemanticRetrieval` is constructed with `logger` = `undefined`.
- `this.#logger` becomes the fully-silent no-op object.
- Every `this.#logger.info(...)`/`this.#logger.warn(...)` call inside `retrieve()` — literally
  ALL of the new `DIAG: SemanticRetrieval.*` lines, on both the success path and the catch
  block — executes and returns immediately without producing any output.
- Meanwhile `this.#embeddingProvider.embed(query)` (the Bedrock call) is completely
  independent of the logger and works exactly as it did before this diagnostic was ever
  added — which is precisely why the Bedrock invocation for the exact query/timestamp was
  proven to have happened in the previous update, while every new log line stayed silent.

This hypothesis is now the leading explanation and fits ALL observed evidence without
contradiction (unlike the retired "stale layer" theory, which the grep check just
disproved).

## Recommended next step

**Verify the function's own deployed code package** the same way the layer was just checked,
substituting `get-function` (function code) for `get-layer-version-by-arn` (layer code):

```bash
# 1. Get the function code package download URL
aws lambda get-function \
  --function-name prod63k-atlantis-mcp-test-ReadFunction \
  --query 'Code.Location' \
  --output text \
  --profile YOUR_PROFILE

# 2. Download and check for the logger wiring added in the same patch
curl -o /tmp/read-function-code-check.zip "PASTE_THE_SIGNED_URL_HERE"
unzip -p /tmp/read-function-code-check.zip services/documentation.js | grep -c "logger: DebugAndLog"

# cleanup
rm -f /tmp/read-function-code-check.zip
```

**Reading the result — CONFIRMED BASELINE:** running
`grep -c "logger: DebugAndLog" application-infrastructure/src/lambda/read-function/services/documentation.js`
against the current repo returns **3** (one for the `SemanticRetrieval` constructor added by
this diagnostic patch, plus two pre-existing occurrences for `SemanticAssistedRetrieval` and
`selectStrategy`'s own call). **3 is the target count** for a fully up-to-date deployment.

- If the deployed function code's count comes back **less than 3**, that CONFIRMS this
  hypothesis — the `SemanticRetrieval` constructor call is missing `logger: DebugAndLog` in
  the deployed package, so `SemanticRetrieval` silently uses a no-op logger, and a redeploy of
  the ReadFunction (not just the layer) is needed.
- If the deployed count is also **3**, this hypothesis is ruled out too, and the investigation
  needs to fall back to the warm-container/memoization angle noted in the previous update, or
  add more granular diagnostics (e.g. logging `typeof this.#logger.info` and confirming
  `this.#logger` is not the no-op object directly inside the constructor).
- If the counts match, this hypothesis is also ruled out, and the investigation needs to
  fall back to the warm-container/memoization angle noted in the previous update, or add
  even more granular diagnostics (e.g. logging `typeof this.#logger.info` and
  `this.#logger === DebugAndLog` directly inside the constructor) to catch a subtler wiring
  issue.

Once confirmed, redeploy the ReadFunction (this is a normal code deploy through the existing
`test` branch pipeline, not a manual layer operation), re-run the exact same query
(`"atlantis regional s3 buckets location"` — reusing it makes it easy to cross-check against
`REQ4-MODEL-LOGS.md`'s Bedrock invocation again if needed), and pull a fresh unfiltered trace.

## Update: Function code ALSO confirmed current (3/3) — both stale-deployment hypotheses ruled out

`unzip -p ... services/documentation.js | grep -c "logger: DebugAndLog"` against the deployed
ReadFunction code returned **3**, matching the repo baseline exactly. Combined with the
layer's confirmed `1` from the previous check, **both files touched by the diagnostic patch
are now verified current on the deployed stack.**

This rules out "stale layer" and "stale function code" as explanations for REQ4's missing
`DIAG: SemanticRetrieval.*` lines.

### Reframing: "current" was only verified as of NOW, not as of the REQ4 test time

These two checks confirm what is deployed **at the moment the check was run** — they say
nothing about whether that same code was already live at `2026-08-26T19:16:26Z`, when the
REQ4 request (`2c6ad0a5-70be-4a06-8967-4d86dd78974c`) actually executed. If the diagnostic
patch's deploy pipeline finished sometime AFTER that timestamp, REQ4's trace would have been
produced by the pre-patch code even though the code is now (post-deploy) fully current — this
would fully explain the missing lines without any remaining code defect.

**This is now the leading, and most easily falsifiable, hypothesis.**

## Recommended next step (two parts — do both)

### Part A — Confirm deploy timing (quick, retrospective)

```bash
# Function's own last-modified timestamp
aws lambda get-function-configuration \
  --function-name prod63k-atlantis-mcp-test-ReadFunction \
  --query 'LastModified' \
  --profile YOUR_PROFILE

# Layer version's creation timestamp (use the same DocAiCommon ARN:version from the earlier check)
aws lambda get-layer-version-by-arn \
  --arn "PASTE_THE_DOCAICOMMON_ARN_HERE" \
  --query 'CreatedDate' \
  --profile YOUR_PROFILE
```

Compare both results against the REQ4 request time, **`2026-08-26T19:16:26Z`** (from
`REQ4-CW-LOGS.md`'s `requestTimeEpoch: 1787771786319` / the `EVENT RECEIVED` line). If either
timestamp is AFTER `19:16:26Z`, that confirms REQ4 ran against pre-patch code — mystery
solved, no code defect, just a timing artifact of when the test was run relative to the
deploy.

### Part B — Re-run the test now (this is the real fix regardless of Part A's answer)

Since both the layer and function code are confirmed current **as of right now**, the most
direct way forward is simply to re-run the exact same query
(`"atlantis regional s3 buckets location"`, tier `private`) again immediately, and pull a
fresh unfiltered CloudWatch trace for the new RequestId. Do this even if Part A is
inconclusive or you don't have easy access to the timestamps — it is the fastest way to get
an authoritative answer:

- If the new trace NOW shows the `DIAG: SemanticRetrieval.*` lines (start → embedding
  obtained → filters built → vectorStore.query resolved → buildResults resolved, or the WARN
  catch line) — this confirms REQ4 was simply a timing artifact (deploy hadn't finished yet),
  and whichever line the trace stops at will finally reveal the true fault boundary within
  `SemanticRetrieval.retrieve()`, resolving this investigation.
- If the new trace STILL shows zero `DIAG: SemanticRetrieval.*` output despite both code
  artifacts being independently confirmed current — that is a much more serious and unusual
  finding (would imply something outside normal request/deploy semantics, e.g. a request
  routed to a stale execution environment API Gateway/Lambda hasn't recycled, or an
  unaccounted-for code path). At that point, escalate to adding an even more defensive
  diagnostic: log `this.#logger === DebugAndLog` and `typeof this.#logger.info` directly
  inside `SemanticRetrieval`'s constructor (not just inside `retrieve()`), so construction
  itself is traced independently of whether `retrieve()` is ever reached.

## Update: Deploy timestamps rule out timing-staleness entirely — both artifacts predate REQ4 by ~15 hours

```
ReadFunction LastModified:  2026-08-26T04:02:14.000+0000
DocAiCommon:12 CreatedDate: 2026-08-26T04:02:02.448+0000
REQ4 request time:          2026-08-26T19:16:26.318Z  (from EVENT RECEIVED / requestTimeEpoch)
```

Both the function code and the layer were deployed at ~04:02 UTC, roughly **15 hours before**
the REQ4 request executed. This rules out "deploy hadn't finished yet" entirely — the patched
code was unambiguously live and had been for hours by the time REQ4 ran. Every
deployment-staleness hypothesis pursued so far (stale layer, stale function code, timing race
with an in-flight deploy) is now exhausted and ruled out.

### New hypothesis: the traced RequestId may not be the request that actually called Bedrock

Re-examining the "exact match" reasoning from two updates ago: the match between
`REQ4-MODEL-LOGS.md` and the traced request (`2c6ad0a5-70be-4a06-8967-4d86dd78974c`) was
established by **query text + timestamp to the minute**, not by any Lambda-level correlation
(no `X-Amzn-Trace-Id`/RequestId is present in the Bedrock invocation record). Every
investigation step since then has implicitly treated that match as ironclad and asked "why is
`SemanticRetrieval` silent for THIS request." But if a second, untraced invocation fired the
identical query text (`"atlantis regional s3 buckets location"`) within the same 60-second
window — e.g. a double-click send in Postman, a client-side timeout retry, or simply the user
re-running the same saved request twice in quick succession — its Bedrock call would be
indistinguishable from request `2c6ad0a5`'s in the evidence gathered so far, while its OWN
`DIAG: SemanticRetrieval.*` lines would be sitting under a completely different, not-yet-
examined RequestId/log stream that this investigation has never looked at.

This would fully resolve the contradiction without requiring any code defect: request
`2c6ad0a5` genuinely never reached `SemanticRetrieval.retrieve()` (hence zero DIAG output,
consistent with every other trace pulled so far), while a sibling request nobody has looked at
yet is the one that actually embedded the query and — if it got further — should carry its own
complete `DIAG: SemanticRetrieval.*` trace, including whichever line reveals the true fault
boundary.

## Recommended next step

**Search the ReadFunction log group broadly for the time window, WITHOUT filtering by the
`2c6ad0a5` RequestId**, to find every RequestId active around `19:16:2x` and specifically
locate which one (if any) carries the `DIAG: SemanticRetrieval` lines:

```
fields @timestamp, @requestId, @message
| filter @message like /DIAG: SemanticRetrieval|atlantis regional s3 buckets location/
| sort @timestamp asc
```

Run this as a CloudWatch Logs Insights query (or `aws logs filter-log-events` with
`--filter-pattern` on the same phrase) against
`/aws/lambda/prod63k-atlantis-mcp-test-ReadFunction`, time range spanning at least
`19:16:00Z`–`19:17:00Z`.

- **If a DIFFERENT RequestId shows up** carrying `search_documentation request | { query:
  'atlantis regional s3 buckets location', ... }` and/or any `DIAG: SemanticRetrieval.*`
  lines — this confirms the new hypothesis. Pull that RequestId's FULL unfiltered trace next;
  whichever `DIAG:` line it stops at (or the WARN catch line) finally identifies the real
  fault boundary, resolving this investigation.
- **If NO other RequestId shows up** with that query text or those DIAG lines anywhere in the
  window — the "second untraced request" hypothesis is ruled out too, and request `2c6ad0a5`
  really is the only candidate. In that case the investigation needs to return to verifying
  `SemanticRetrieval` construction itself (not just `retrieve()`): add a diagnostic directly
  inside the constructor (e.g. `this.#logger.info('DIAG: SemanticRetrieval constructed', {
  hasInfo: typeof this.#logger.info })` at the very end of the constructor body) so
  construction is traced independently of whether `.retrieve()` is ever invoked on that
  instance — this would catch a scenario where `getDocAiComponents()`'s memoized
  `docAiComponents` singleton holds a DIFFERENT `SemanticRetrieval` instance than the one
  whose logger was verified, or where an exception between construction and `retrieve()` is
  being swallowed somewhere not yet instrumented (e.g. inside `selectStrategy`'s
  `FallbackRetrieval` wrapper itself, before `primary.retrieve()` is even called).

## BREAKTHROUGH: Root cause of the silence identified — `normalizeLogger()` uses `typeof logger === 'object'`, but `DebugAndLog` is a class (`typeof === 'function'`)

Per the user's direction: assume no deployment/timing issue and no duplicate-request
confusion (single-user test server, confirmed no other traffic in the window) — focus
purely on the code for a missing `await` or a fire-and-forget logging call. That review
found the actual bug, and it is NOT a missing await. It is a `typeof` type-check bug in the
shared logger-normalization helper.

### The bug

`application-infrastructure/src/lambda/layers/doc-ai-common/nodejs/retrieval-strategy.js`:

```js
function normalizeLogger(logger) {
  const src = (logger && typeof logger === 'object') ? logger : {};
  return {
    warn: typeof src.warn === 'function' ? src.warn.bind(src) : NOOP,
    error: typeof src.error === 'function' ? src.error.bind(src) : NOOP,
    debug: typeof src.debug === 'function' ? src.debug.bind(src) : NOOP,
    info: typeof src.info === 'function' ? src.info.bind(src) : NOOP
  };
}
```

`DebugAndLog` (from `@63klabs/cache-data`, `require('@63klabs/cache-data').tools.DebugAndLog`)
is a **class exposing only `static` methods** — it is used as a namespace, never
instantiated. In JavaScript, `typeof` on a class reference (or any function/class, since
classes ARE functions under the hood) is `'function'`, **not** `'object'`:

```js
class DebugAndLog { static async info(message, obj) {} static async warn(message, obj) {} }
typeof DebugAndLog        // 'function'
typeof DebugAndLog === 'object'   // false
```

Reproduced and confirmed directly with `node -e`:
```
typeof DebugAndLog (class ref): function
typeof DebugAndLog === object?  false
info is NOOP (silenced)?        true
warn is NOOP (silenced)?        true
```

Because `typeof logger === 'object'` is `false` for `DebugAndLog`, `normalizeLogger()`'s
guard falls through to `src = {}`, and EVERY returned method (`info`, `warn`, `debug`,
`error`) resolves to the module-level `NOOP = () => {}` — silently, with no error, no
warning, nothing.

### Why this fully explains the silence (but not yet the keyword-shaped output)

`normalizeLogger(logger)` is called identically in the constructors of THREE classes, all of
which receive `logger: DebugAndLog` from `services/documentation.js`:

- `SemanticRetrieval` (the diagnostic patch's `this.#logger` — every `DIAG:
  SemanticRetrieval.*` line silenced)
- `SemanticAssistedRetrieval` (`this.#logger.debug('<=1 candidate...')`,
  `this.#logger.warn('assist re-rank failed...')`, and the `DOC_AI_USAGE` success line via
  `#logUsage` → `this.#logger.info(...)` — ALL silenced)
- `FallbackRetrieval` (constructed by `selectStrategy`; `this.#logger.warn('RetrievalStrategy
  "..." failed... falling back to keyword search...')` — ALSO silenced)

This means **every log line this entire investigation has been searching for, across every
prior update in this document, has been unconditionally silenced since the semantic-assisted
feature was first implemented** — independent of deploy state, log level, warm/cold starts,
or request identity. This resolves the central contradiction that drove every earlier
(now-superseded) hypothesis in this document: it was never a deployment, timing, or
duplicate-request issue. The logging itself was broken from day one for this exact call
pattern (a class-as-namespace logger), and every previous "why is there no log line" question
in this investigation has the same one-line answer.

### What this does NOT yet explain

The `typeof` bug fully accounts for the SILENCE. It does not, by itself, explain why
`DOC-SEARCH-RESULT.json`/`REQ4-API-RESPONSE.md` return keyword-shaped integer relevance
scores and `totalResults: 30` rather than semantic/assisted output. Two non-exclusive
possibilities remain open:

1. **The retrieval logic actually IS working correctly as semantic-assisted**, and the
   `relevanceScore`/`totalResults` shape assumptions used throughout this document need
   re-examination. Re-read `SemanticAssistedRetrieval.#sliceEnvelope`/`#applyOrder` and
   `SemanticRetrieval.retrieve()`'s returned `relevanceScore` mapping (`hit.score` — cosine
   similarity, expected `[0,1]`) against the ACTUAL numbers in `REQ4-API-RESPONSE.md` (32,
   26×9) once more, now that logging can be trusted after the fix below. It is possible the
   silence itself (rather than a retrieval defect) caused the earlier per-line reasoning
   about "which line proves keyword vs. semantic" to rely too heavily on absence-of-evidence.
2. **A genuine second defect exists in the retrieval path** (vector query returning 0 hits,
   content-lookup dropping every hit, or a `FallbackRetrieval`-caught error silently
   degrading to keyword) that was ALWAYS there, but has been undiagnosable until now because
   every log line that would have proven it was silenced by this same bug.

Both are resolved the same way: fix the logger bug, redeploy, re-run the test, and read the
now-actually-working log lines.

## THE FIX

In `application-infrastructure/src/lambda/layers/doc-ai-common/nodejs/retrieval-strategy.js`,
`normalizeLogger()`'s guard must accept BOTH plain objects and functions/classes (since a
valid logger may legitimately be either — cache-data's `DebugAndLog` is a class/namespace,
while a test mock or plain `{ info, warn, ... }` object is a plain object):

```js
// Before (bug):
const src = (logger && typeof logger === 'object') ? logger : {};

// After (fix):
const src = (logger && (typeof logger === 'object' || typeof logger === 'function')) ? logger : {};
```

This one-line change is the entire fix for the silence. It requires no change to any of the
three call sites (`SemanticRetrieval`, `SemanticAssistedRetrieval`, `FallbackRetrieval` all
already pass `logger: DebugAndLog` correctly) — the defect is isolated entirely to
`normalizeLogger()`'s type guard.

## Recommended next steps

1. Apply the one-line fix to `normalizeLogger()` in `retrieval-strategy.js` (the
   `doc-ai-common` layer).
2. Run the full `doc-ai-common` layer Jest suite to confirm no regression (207 tests as of
   the last full run in this investigation) — a few existing tests may currently assert
   NOOP/silent behavior when a class-like logger is passed and could need updating to assert
   the methods now actually fire; check `retrieval-strategy.test.js`,
   `retrieval-strategy-model-unavailable.test.js`, and `semantic-assisted-retrieval.test.js`
   specifically for any test that constructs a logger stub and checks call counts.
3. Redeploy the layer (function code in `services/documentation.js` needs no change — it was
   already passing `logger: DebugAndLog` correctly).
4. Re-run the SAME test query (`"atlantis regional s3 buckets location"`, tier `private`) and
   pull a fresh unfiltered trace. Now that logging can be trusted, this will show — for the
   FIRST time in this investigation — the actual step-by-step outcome inside
   `SemanticRetrieval`/`SemanticAssistedRetrieval`/`FallbackRetrieval`:
   - `DOC_AI_USAGE {"strategy":"semantic-assisted",...}` → the assisted path is genuinely
     working; re-examine the relevanceScore-shape assumption per point 1 above.
   - `SemanticAssistedRetrieval: <=1 candidate...` (debug) → confirms zero/one hits from the
     vector store for this query; investigate `S3VectorStore.query()`/filters/version-key
     next.
   - `RetrievalStrategy "semantic-assisted" (store=s3-vectors) assist re-rank failed...`
     (warn) → the semantic candidates were found but the ASSIST model call itself failed;
     the `code`/`message` in this now-visible line will name the actual Bedrock/Nova error.
   - `RetrievalStrategy "semantic-assisted" failed... falling back to keyword search...`
     (warn) → the semantic step itself (embedding or vector query or content lookup) threw;
     this is what has actually been happening whenever results are keyword-shaped, and the
     `code`/`message` will finally reveal the true underlying error.
5. Once the true underlying error/behavior is visible and addressed, remove the temporary
   `DIAG: pre-selectStrategy snapshot` (`services/documentation.js`) and `DIAG:
   SemanticRetrieval.*` (`retrieval-strategy.js`) diagnostics added during this investigation,
   but KEEP the `normalizeLogger()` fix and the `logger` parameter/wiring added to
   `SemanticRetrieval` — these are legitimate, permanent improvements: `SemanticRetrieval`
   previously had no logging seam at all, and the `normalizeLogger()` fix corrects a
   real bug that was silently disabling logging for `SemanticAssistedRetrieval` and
   `FallbackRetrieval` from their original implementation, not just for this diagnostic.
