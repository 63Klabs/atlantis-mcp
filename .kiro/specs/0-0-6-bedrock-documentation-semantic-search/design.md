# Design — Bedrock-Assisted Documentation Semantic Search

## Overview

This design adds semantic retrieval to the `search_documentation` MCP tool while
preserving the existing keyword path and response contract. Two configuration axes
select behavior: retrieval mode (`keyword` | `semantic` | `semantic-assisted`, with a
future `rag`) and vector store (`dynamodb` | `s3-vectors`, with a future `opensearch`).
The feature defaults OFF and is gated to paid/private tiers.

Shared abstractions live in a new Lambda Layer (`doc-ai-common`) consumed by both the
`read-function` (query path) and `doc-indexer` (index path). All AWS resources are
incorporated into the existing application stack behind an `EnableDocAi` CloudFormation
Condition. Bedrock is accessed via `bedrock:InvokeModel` (no standing infrastructure).

## Architecture

```mermaid
flowchart TD
    subgraph Read[read-function]
        H[handler resolves authInfo.tier] --> RT[Routes.process authInfo]
        RT --> JR[json-rpc-router handleToolsCall\nprops.authInfo]
        JR --> DC[Documentation controller]
        DC --> DS[Documentation service]
        DS --> SF{RetrievalStrategy factory\nconfig + tier}
        SF -->|below minTier or disabled or keyword| KW[Keyword strategy\nDocIndex.queryIndex]
        SF -->|semantic| SEM[Semantic strategy]
        SF -->|semantic-assisted| ASST[Semantic + LLM assist]
        SEM --> EP[EmbeddingProvider embed query - cached]
        ASST --> EP
        EP --> VS[(VectorStore.query)]
        ASST --> LLM[[Bedrock small model:\nexpand/re-rank only]]
    end
    subgraph Indexer[doc-indexer scheduled]
        EX[extract entries] --> CH{embedding input hash\nchanged vs prior version?}
        CH -->|no| RU[reuse prior embedding]
        CH -->|yes| EMB[EmbeddingProvider embed]
        RU --> UP[(VectorStore.upsert)]
        EMB --> UP
    end
    subgraph Layer[doc-ai-common Lambda Layer]
        EP
        VSF[VectorStore factory:\nDynamoDbVectorStore | S3VectorStore]
    end
    VS --- VSF
    UP --- VSF
    EP <--> BR[[Bedrock InvokeModel - embeddings]]
    EMB <--> BR
```

## Configuration

Added to `read-function/config/settings.js` and mirrored for the indexer:

```javascript
documentation: {
  ai: {
    enabled: parseBool('DOC_AI_ENABLED', false),
    minTier: process.env.DOC_AI_MIN_TIER || 'paid',            // public|registered|paid|private
    retrievalMode: process.env.DOC_AI_RETRIEVAL_MODE || 'semantic', // keyword|semantic|semantic-assisted
    vectorStore: process.env.DOC_AI_VECTOR_STORE || 's3-vectors',   // dynamodb|s3-vectors
    embedding: {
      model: process.env.DOC_AI_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0',
      dimensions: parseInt(process.env.DOC_AI_EMBEDDING_DIMENSIONS || '1024', 10),
      maxInputTokens: parseInt(process.env.DOC_AI_EMBEDDING_MAX_INPUT_TOKENS || '8000', 10)
    },
    assist: {
      model: process.env.DOC_AI_ASSIST_MODEL || 'amazon.nova-micro-v1:0',
      maxCandidates: parseInt(process.env.DOC_AI_ASSIST_MAX_CANDIDATES || '25', 10)
    },
    topK: parseInt(process.env.DOC_AI_TOP_K || '10', 10),
    candidateMultiplier: parseInt(process.env.DOC_AI_CANDIDATE_MULTIPLIER || '3', 10),
    s3Vectors: {
      bucket: process.env.DOC_AI_S3_VECTOR_BUCKET || '',
      index: process.env.DOC_AI_S3_VECTOR_INDEX || ''
    }
  }
}
```

`enabled` defaults false so existing behavior is byte-for-byte unchanged until enabled.
Invalid values log a warning and fall back to the documented default (never throw).

Tier comparison uses a fixed order map: `{ public:0, registered:1, paid:2, private:3 }`.

## Components and Interfaces

All three abstractions ship in the `doc-ai-common` Lambda Layer.

### EmbeddingProvider
```javascript
// >! Wraps Bedrock InvokeModel for embeddings; no shell, no hardcoded creds.
class EmbeddingProvider {
  constructor({ model, dimensions, maxInputTokens, client }) {}
  // Returns Float32Array-compatible number[] of length `dimensions`.
  async embed(text) {}
  // Optional batch helper for the indexer.
  async embedBatch(texts) {}
}
```
- Titan Text Embeddings V2 request: `{ inputText, dimensions, normalize: true }`.
- Truncates input to `maxInputTokens` (approx by character budget) before calling.
- On error, throws a typed error so callers can fall back.

### VectorStore (interface + factory)
```javascript
// upsert: write vectors for a version; query: nearest neighbors; deleteVersion: cleanup
class VectorStore {
  async upsertVectors(version, items) {}            // items: {hash, vector, metadata}
  async query(embedding, { version, filters, topK }) {} // -> [{hash, score, metadata}]
  async deleteVersion(version) {}
}
function createVectorStore(config) { /* dynamodb | s3-vectors */ }
```

**DynamoDbVectorStore** (reuses the DocIndex table):
- Item: `pk = vector:{hash}`, `sk = v:{version}`, attributes `{ vector (base64 Float32),
  dims, model, embeddingInputHash, type, subType, repository, owner, ttl }`.
- Enumeration item: `pk = vectormanifest:{version}`, `sk = meta` with `{ count, model,
  dimensions }` and chunked hash lists (mirrors the existing chunked main-index pattern).
- `query`: load active-version vectors (filtered by metadata where possible), decode,
  compute cosine similarity in-Lambda, return top K. Loaded set cached in-memory keyed by
  version for warm reuse.
- TTL mirrors the existing 7-day previous-version cleanup.

**S3VectorStore**:
- Vector bucket + index created via CloudFormation if supported; otherwise a custom
  resource / post-deploy step (resolved in Task 4 spike).
- `upsertVectors` -> PutVectors with metadata `{ version, type, subType, repository }`.
- `query` -> QueryVectors with metadata filter `version = active` plus type/subType, topK.

### RetrievalStrategy (interface + factory)
```javascript
class RetrievalStrategy { async search({ query, type, subType, limit }) {} }
// KeywordRetrieval wraps existing Models.DocIndex.queryIndex (unchanged behavior)
// SemanticRetrieval: embed query (cached) -> VectorStore.query -> load metadata -> map to result shape
// SemanticAssistedRetrieval: SemanticRetrieval + LLM expand/re-rank of top candidates only
function selectStrategy({ config, tier }) { /* returns the right instance */ }
```

Selection logic: `enabled && tierRank(tier) >= tierRank(minTier) && mode !== 'keyword'`
→ semantic (or semantic-assisted); otherwise keyword. Any semantic-path error →
fall back to keyword and log.

### Tier threading (read-function change)
`authInfo` is resolved in `index.js` but not passed downstream today. Change the chain:
- `Routes.process(clientRequest, response, authInfo)`
- `JsonRpcRouter.handleJsonRpc(clientRequest, authInfo)`
- `handleToolsCall(id, params, clientRequest, authInfo)` → set `props.authInfo = { tier }`
- `Controllers.Documentation.search(props)` reads `props.authInfo.tier` and passes it to
  the service, which calls `selectStrategy`.

Only the documentation tool needs the tier today; other controllers ignore `props.authInfo`.

## Data Models

Semantic result mapping preserves the existing contract from `Models.DocIndex.queryIndex`:
`{ title, excerpt, filePath, githubUrl, type, subType, relevanceScore, repository,
repositoryType, namespace, codeExamples?, context? }`. For semantic hits, `relevanceScore`
is the cosine similarity (scaled) and content metadata is fetched from the existing
`content:{hash}` items so both paths share the same enrichment.

## Indexer Changes

- After extraction, compute `embeddingInput = title + "\n" + excerpt + "\n" + content`
  (truncated) and an `embeddingInputHash`.
- If a prior-version `vector:{hash}` exists with the same `embeddingInputHash`, `model`,
  and `dims`, copy it to the new version (no Bedrock call). Otherwise embed and write.
- Record `{ embeddingModel, embeddingDimensions }` in the version metadata.
- Entire embedding phase is skipped when `documentation.ai.enabled` is false.

## Error Handling

- Embedding/vector-store/LLM failures never fail the request: log via `DebugAndLog`,
  fall back to keyword, and set a response header/flag noting degraded semantic mode.
- Settings validation warns and defaults rather than throwing.
- Indexer embedding failures for a single entry are logged and skipped (partial index
  is better than none), consistent with existing brown-out behavior.

## Security

- `bedrock:InvokeModel` scoped to the specific model ARNs only (embedding + assist);
  no wildcards. S3 Vectors permissions scoped to the specific bucket.
- No credentials in code; model IDs and store names come from env/SSM as appropriate.
- LLM-assist input (docs + query) is treated as untrusted; the assist prompt constrains
  the model to reordering/expansion and rejects instruction-like content in results.
- Security rationale comments use `// >!`; shell-free (no exec); inputs validated.

## Cost Controls

- Index-time embeddings are incremental (reuse by `embeddingInputHash`).
- Query embeddings cached (normalized query + model + dims); semantic results cached via
  the existing `documentation-index` connection profiles.
- Usage logging (strategy, store, token counts) enables A/B cost comparison; optional
  CloudWatch metric filters surface Bedrock token usage per store/mode.
- All resources gated behind `EnableDocAi`; nothing is created or billed when disabled.

## Stack Decision

Incorporate into the existing application stack behind an `EnableDocAi` Condition
(mirrors the existing PROD-only conditional resources). Rationale: Bedrock is IAM-only;
the vector store extends the existing DocIndex/doc-indexer/read-function trio; a separate
stack would add cross-stack imports and split a cohesive feature. Revisit a nested stack
only if the vector footprint grows materially.

### S3 Vectors Infrastructure (Task 4.1 Spike Resolution)

**Spike question:** can CloudFormation natively provision an S3 Vectors vector bucket
and index, or is a custom resource / post-deploy step required?

**Finding:** AWS documents S3 Vectors creation only via the console, AWS CLI, REST API,
and SDKs — there is no CloudFormation resource-type reference page for S3 Vectors. The
identifiers `AWS::S3Vectors::VectorBucket` and `AWS::S3Vectors::Index` appear only as
CloudTrail data-event resource types (logging metadata), which does not confirm
CloudFormation provisioning support. Native CloudFormation provisioning is therefore
not reliably available for this spec.

**Decision:** provision the vector bucket + index via a **Lambda-backed CloudFormation
custom resource**, gated behind the existing `EnableDocAiIsTrue` Condition. This keeps
provisioning inside the application stack and the feature toggle; per AGENTS.md, since it
uses the AWS SDK, the custom resource MUST also handle a clean teardown (which it does by
design via the DELETE lifecycle). Alternatives considered:

- **Native CloudFormation resource** — not available → rejected.
- **Post-deploy CLI step in `buildspec.yml`** — works, but splits provisioning out of the
  stack, complicates teardown, and breaks the cohesive single-stack + GitOps model in
  AGENTS.md → acceptable fallback, not preferred.
- **Lambda-backed custom resource (chosen)** — full create/update/delete lifecycle; reads
  `DocAiEmbeddingDimensions` and a fixed distance metric to create the index correctly.

**Immutability:** a vector index is immutable after creation — its name, dimension,
distance metric, and non-filterable metadata keys cannot change. The custom resource MUST
treat any change to dimensions/metric/name as a replacement: create a new index, return a
new physical resource id so CloudFormation replaces it, and delete the old index on
cleanup. Changing `DocAiEmbeddingDimensions` after enablement forces index replacement and
a full re-index by the doc-indexer.

**Distance metric:** create the index with the cosine metric so S3 Vectors returns
similarity-ordered results natively, matching this design's cosine ranking. The
`CreateIndex` API `distanceMetric` field is a lowercase enum whose allowed values are
`cosine` and `euclidean` (verified against the AWS S3 Vectors CLI/API reference in task
4.3); use `cosine`. (The `CosineSimilarity`/`CosineDistance`/`DotProduct`/`L2`/`L2Squared`
names are the conceptual query-time distance algorithms, not the create-index enum.)

**IAM scoping:** least-privilege `s3vectors` policies scope to the vector index ARN:

```text
arn:aws:s3vectors:{region}:{account-id}:bucket/{bucket-name}/index/{index-name}
```

**Region prerequisite:** S3 Vectors has limited regional availability. Operators MUST
confirm it is available in the deployment region; if not, set `DOC_AI_VECTOR_STORE=dynamodb`.

**Task 4.3 will implement:**

- A custom-resource Lambda using the S3 Vectors SDK: `CreateVectorBucket` + `CreateIndex`
  on CREATE, `DeleteIndex` + `DeleteVectorBucket` on DELETE, with replacement on a
  dimension/metric change.
- An `AWS::CloudFormation::CustomResource` (`Custom::S3VectorIndex`) gated by
  `EnableDocAiIsTrue`, with the vector bucket named per the AGENTS.md S3 patterns
  (`Prefix-ProjectId-StageId-*`).
- Least-privilege IAM for the custom-resource role: `s3vectors` actions scoped to the
  bucket/index ARN above.
- Wiring the created bucket/index names to the read-function and doc-indexer env via the
  `DocAiS3VectorBucket` / `DocAiS3VectorIndex` parameters (added in Task 1.3).

**References:**
[S3 Vectors overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors.html),
[Creating a vector index](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-create-index.html).

## Cross-Region Bedrock Access (Requirement 10)

The initial design constructs both Bedrock Runtime clients with no `region` override, so
they always target the Lambda's own deployment region. If an operator deploys the MCP
stack in a region where the embedding model (Titan v2) or the assist model (Nova Micro)
is unavailable, the feature silently degrades to keyword search with no clear signal
why. This section adds an explicit cross-region capability with two distinct mechanisms,
because the two model types differ:

- **Embedding model (Titan v2):** embedding models are explicitly excluded from Bedrock
  cross-region inference profiles (confirmed against AWS docs), so they cannot use
  server-side routing. Titan v2 therefore needs a hard, deploy-time **client-side region
  pin**.
- **Assist model (Nova Micro):** the assist model *can* use a cross-region inference
  profile. Cross-region inference profiles are invoked from the *source* (deployment)
  region's endpoint and AWS handles destination routing internally, so **no client-side
  region override** is needed — only IAM scoped to the profile ARN plus the underlying
  regions it may route to.

`amazon.nova-micro-v1:0` stays the default for `DocAiAssistModel`. The cross-region
mechanism is built and available but not defaulted on, since there is no verified real
profile ID to ship as a default.

### Configuration deltas

- Add `documentation.ai.embedding.region` to `read-function/config/settings.js` and
  `doc-indexer/lib/settings.js`, sourced from `DOC_AI_EMBEDDING_REGION` (default `''`).
  Parsing is defensive string pass-through — empty string is valid and means "use the
  deployment region"; it never throws. CloudFormation parameter `AllowedPattern` is the
  real input gate.
- No new settings field is needed for the assist side. `DocAiAssistProfileRegions` is
  IAM-only and never reaches the Lambda runtime as an env var; the SDK does not need it
  because routing is server-side.

### EmbeddingProvider deltas (`doc-ai-common/nodejs/embedding-provider.js`)

- Constructor accepts a `region` option. `#getClient()` becomes
  `new BedrockRuntimeClient(this.region ? { region: this.region } : {})`, so an
  empty/unset value behaves exactly as today.
- In the `embed()` catch block, inspect the underlying SDK error's `name`
  (`ResourceNotFoundException` / `ValidationException` / `AccessDeniedException`) and set
  `code: 'MODEL_NOT_AVAILABLE'` instead of `'INVOCATION_FAILED'` when matched, still
  wrapping the original error as `cause`.
- Wire `documentation.ai.embedding.region` into both construction sites:
  `documentation.js` `getDocAiComponents` and `index-builder.js` `runEmbeddingPhase`.

### AssistProvider deltas (`doc-ai-common/nodejs/assist-provider.js`)

- No client construction change — the assist path relies on server-side cross-region
  routing when a profile ID is configured, so there is no region override.
- Apply the same `MODEL_NOT_AVAILABLE` error classification to `#invoke()`'s catch block
  as `EmbeddingProvider`.

### Config-error logging (index-builder.js, retrieval-strategy.js, documentation.js)

Wherever an `EmbeddingError` / `AssistError` / wrapped `RetrievalError` is caught for the
routine WARN-level degrade, additionally check `error.code === 'MODEL_NOT_AVAILABLE'`
(or `error.cause?.code`) and emit one extra ERROR-level line
(`doc_ai_bedrock_model_unavailable`) carrying the model id and the region that was
targeted (the deployment region, or `DocAiEmbeddingRegion` when set). This never changes
the fallback behavior — it only makes a misconfigured region/model loud and searchable
instead of blending into ordinary degrade noise. This applies to `index-builder.js`'s
per-entry embedding catch and to `retrieval-strategy.js`'s `SemanticRetrieval` /
`FallbackRetrieval` / `SemanticAssistedRetrieval` degrade paths.

### CloudFormation deltas (`template.yml`)

- New parameters: `DocAiEmbeddingRegion` (String, default `""`, description recommends
  `us-east-1` as a common fallback, `AllowedPattern` matching AWS region codes or empty)
  and `DocAiAssistProfileRegions` (CommaDelimitedList, default `""`).
- New Conditions `HasDocAiEmbeddingRegionOverride` (mirrors the existing
  `HasDocAiS3VectorBucketOverride` pattern) and `HasDocAiAssistProfileRegions`.
- `DOC_AI_EMBEDDING_REGION` env var added to both `ReadLambdaFunction` and
  `DocIndexerFunction`, using the override Condition (empty string when not set).
- Embedding `bedrock:InvokeModel` `Resource` ARN in both `ReadDocAiPolicy` and
  `DocIndexerDocAiPolicy` switches its region segment from `${AWS::Region}` to
  `!If [HasDocAiEmbeddingRegionOverride, !Ref DocAiEmbeddingRegion, !Ref 'AWS::Region']`.
- Assist `bedrock:InvokeModel` `Resource` in `ReadDocAiPolicy` (only the read role
  invokes the assist model): when `DocAiAssistProfileRegions` is empty, unchanged single
  foundation-model ARN; when non-empty, expand to the inference-profile ARN plus one
  foundation-model ARN per listed region. The exact CloudFormation mechanism is deferred
  to the spike below.
- Metadata `ParameterGroups` gains both new parameters under "Documentation AI (Semantic
  Search) Settings".

### Assist Cross-Region IAM (Task 14 Spike Resolution)

**Spike question:** what is the correct CloudFormation mechanism to build the assist
`bedrock:InvokeModel` `Resource` scoping so that, when `DocAiAssistProfileRegions` is
non-empty, the grant covers the inference-profile ARN plus the assist foundation model in
each listed region, and when it is empty (default) the grant stays unchanged from today's
single foundation-model ARN?

**Decisive finding:** `Fn::ForEach` (the `AWS::LanguageExtensions` transform) **cannot**
build list elements inside a single IAM statement's `Resource` array. `Fn::ForEach` emits
**keyed map** entries (each `OutputKey` must contain the loop identifier to stay unique)
that merge into a map section — `Resources`, `Outputs`, or a resource's `Properties`. An
IAM statement's `Resource:` is an unkeyed YAML list, and `Fn::ForEach` has no mode that
appends bare list elements. The only way to involve `Fn::ForEach` is to replicate whole
keyed resources (e.g. one `AWS::IAM::Policy` per region), which would require adding the
template-wide `AWS::LanguageExtensions` transform and carries its documented
awkward-interaction risk with the SAM transform. That is the rejected fallback
(Mechanism B).

**Decision (Mechanism A):** use AWS's own documented cross-Region inference IAM pattern —
a region wildcard on the model ARN clamped by the `aws:RequestedRegion` condition key —
which maps natively onto a `CommaDelimitedList` with no `Fn::ForEach` and no new
transform. `!Ref` of a `CommaDelimitedList` renders as the JSON array an IAM condition
value expects, so the whole variable-length region set drops straight into the policy.
The assist grant stays in the existing `ReadDocAiPolicy`, toggled by the existing
`HasDocAiAssistProfileRegions` condition via `Fn::If`:

- **Empty (default) branch** — one assist statement whose `Resource` is the unchanged
  single foundation-model ARN
  `arn:aws:bedrock:${AWS::Region}::foundation-model/${DocAiAssistModel}`, no condition.
  This stays byte-identical to today.
- **Non-empty branch** — two assist statements:
  - a profile statement scoped to the inference-profile ARN
    `arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/${DocAiAssistModel}`;
  - a region-clamped model statement scoped to
    `arn:aws:bedrock:*::foundation-model/${DocAiAssistModel}` with
    `Condition: StringEquals: { aws:RequestedRegion: !Ref DocAiAssistProfileRegions }`.

This preserves least privilege (still model-pinned; the wildcard region is clamped to
exactly the operator-listed regions), avoids the `[""]`-from-empty-default iteration
hazard, and is trivially validated for both the empty and populated cases.

**Verified inference-profile ARN format:** the Bedrock inference-profile ARN is
`arn:aws:bedrock:{region}:{account-id}:inference-profile/{id}` — the region **and**
account-id segments are both **populated**. This contrasts with the foundation-model ARN
`arn:aws:bedrock:{region}::foundation-model/{model}`, whose account-id field is
deliberately **empty** (the double colon) because foundation models are AWS-owned, not
account-scoped. The shape is identical across system-defined (geographic `us.`/`eu.`/
`apac.`, global `global.`) and application inference profiles; only the `{id}` differs
(the `global.` variant additionally needs a region-less/account-less FM statement gated
by `aws:RequestedRegion = unspecified`, which is out of scope unless a `global.`-prefixed
id is chosen). In CloudFormation the profile ARN maps to
`!Sub arn:aws:bedrock:${AWS::Region}:${AWS::AccountId}:inference-profile/${DocAiAssistModel}`.

**Open parameter question for Task 15:** the single `DocAiAssistModel` parameter must
carry a *foundation-model* id in the empty-default branch but a *profile* id in the
non-empty branch. Task 15 should decide whether one parameter can carry both or whether a
distinct profile-id parameter is warranted. The ARN *formats* above are pinned regardless
of that decision.

**Requirement note:** Mechanism A satisfies the security intent of Req 10.4 but not its
original literal wording (which mandated one foundation-model ARN string per region in the
`Resource` list). Req 10.4 has been updated to describe the effective least-privilege
scoping (profile ARN plus the model restricted to the listed regions via
`aws:RequestedRegion`) rather than mandating per-region ARN strings.

**References:**
[CloudFormation — `Fn::ForEach`](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-foreach.html),
[CloudFormation — `Fn::ForEach` examples in Resources](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference-foreach-example-resource.html),
[Bedrock — Geographic cross-Region inference (IAM requirements)](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html),
[Bedrock — Global cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html),
[Deadline Cloud — assistant permissions (`aws:RequestedRegion` + wildcard FM ARN)](https://docs.aws.amazon.com/deadline-cloud/latest/userguide/assistant-permissions.html),
[AWS SAM — CloudFormation language extensions support](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification-language-extensions.html).

## Testing Strategy

- Jest only, `*.jest.mjs`; mock AWS SDK (Bedrock, DynamoDB, S3 Vectors) — no real calls
  in unit tests. Use `jest.spyOn(..., 'get')` for getter-based clients where needed.
- Property tests (fast-check) for cosine similarity and ranking invariants.
- Tier gating matrix (public/registered → keyword; paid/private → semantic).
- Incremental-embedding reuse and disabled no-op for the indexer.
- Semantic-assisted: deterministic reorder/expansion, no synthesized prose, fallback.
- Backward-compat: keyword path unchanged when disabled.
- Restore mocks in `afterEach`; keep child-process-spawning tests (if any) out of the
  default suite per the test-execution-monitoring guidance.
