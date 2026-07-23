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
