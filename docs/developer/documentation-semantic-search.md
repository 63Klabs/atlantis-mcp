# Documentation Semantic Search — Developer Guide

How the Bedrock-assisted retrieval layer for `search_documentation` is built, and how to extend it. For the high-level component view see the [architecture overview](../../ARCHITECTURE.md#documentation-semantic-search-bedrock-assisted); for operator enablement (parameters, model access, regions) see the [deployment guide](../../DEPLOYMENT.md#enabling-documentation-semantic-search).

The feature defaults OFF. When disabled, the keyword path is byte-for-byte unchanged, the layer is never loaded, and no Bedrock or vector clients are constructed.

## Where the code lives

| Location | Purpose |
|----------|---------|
| `application-infrastructure/src/lambda/layers/doc-ai-common/nodejs/` | Shared layer modules (providers, stores, strategies). Extracted to `/opt/nodejs/` at runtime. |
| `application-infrastructure/src/lambda/read-function/services/documentation.js` | Query-path wiring: `loadLayerModule`, `getDocAiComponents`, `buildResults`, and strategy selection. |
| `application-infrastructure/src/lambda/read-function/config/settings.js` | `documentation.ai` settings block and defensive parsers. |
| `application-infrastructure/src/lambda/doc-indexer/lib/settings.js` | `loadDocAiSettings()` — mirrors the read-function settings for the index path. |
| `application-infrastructure/src/lambda/doc-indexer/lib/index-builder.js` | Index-path embedding generation (incremental reuse + upsert). |
| `application-infrastructure/template.yml` | `DocAi*` parameters, the `DocAiCommonLayer`, the `Custom::S3VectorIndex` provisioner, the data-plane IAM policies, and the usage metric filters. |

Consuming functions do not declare the layer as an npm dependency; modules are loaded from the layer mount path via a small helper:

```javascript
// read-function/services/documentation.js
const base = process.env.DOC_AI_LAYER_PATH || '/opt/nodejs';
const { selectStrategy } = require(`${base}/retrieval-strategy`);
```

Tests set `DOC_AI_LAYER_PATH` to the local layer `nodejs/` directory so the real modules load without the runtime layer present.

## Module contracts

All modules live in the `doc-ai-common` layer and expose typed errors (`EmbeddingError`, `VectorStoreError`, `RetrievalError`, `AssistError`) with stable `code` fields so callers can catch and fall back.

### EmbeddingProvider (`embedding-provider.js`)

Wraps Bedrock `InvokeModel` for Amazon Titan Text Embeddings V2. The Bedrock client is created lazily on first `embed()` (or injected for tests); the region comes from `AWS_REGION` via the SDK default provider chain.

```javascript
const provider = new EmbeddingProvider({ model, dimensions, maxInputTokens /*, client */ });
const vector = await provider.embed(text);   // number[] of length `dimensions`
// provider.embedBatch(texts) is available for the indexer
```

### VectorStore + createVectorStore (`vector-store.js`)

`createVectorStore(config)` is the single extension point. It validates config and dispatches through a fixed internal allowlist (`STORE_REGISTRY`) — `config.vectorStore` is never interpolated into a `require()` path. Concrete store modules are required lazily, so merely requiring this module costs nothing.

```javascript
const store = createVectorStore({
  vectorStore: 's3-vectors',              // or 'dynamodb'
  dimensions: 1024,
  dynamodb: { tableName: process.env.DOC_INDEX_TABLE },
  s3Vectors: { bucket, index }
});
```

Every concrete store implements the same contract:

- `upsertVectors(version, items)` — `items` is `{ hash, vector, metadata }[]`; `metadata` carries at least `{ type, subType, repository, ... }` for query-time filtering.
- `query(embedding, { version, filters, topK })` — returns `{ hash, score, metadata }[]` ordered by **descending cosine similarity**, applying `filters` (e.g. `{ type, subType }`).
- `deleteVersion(version)` — cleans up a superseded version.

### RetrievalStrategy family + selectStrategy (`retrieval-strategy.js`)

Every strategy exposes `async retrieve(options)` and returns the standard `{ results, totalResults, query, suggestions }` shape.

- `KeywordRetrieval({ keywordSearchFn })` — wraps the existing `DocIndex.queryIndex` path unchanged.
- `SemanticRetrieval({ embeddingProvider, vectorStore, buildResults, topK })` — embeds the query (caching by normalized query + model + dimensions), queries the store, and maps hits to results via the injected `buildResults`.
- `SemanticAssistedRetrieval({ semantic, assist, candidateMultiplier, maxCandidates, topK, storeType, logger })` — runs semantic retrieval, then re-ranks the top candidates with the assist model. On assist error it degrades to plain semantic and logs a usage/degrade line.
- `FallbackRetrieval({ primary, fallback, logger, strategyName })` — wraps a semantic primary so any error degrades to the keyword fallback.

`selectStrategy({ config, tier, strategies, logger })` chooses the semantic path only when `config.enabled === true` **and** `config.retrievalMode !== 'keyword'` **and** `tierRank(tier) >= tierRank(config.minTier)`. An unknown/missing tier ranks as `public` and an unknown/missing `minTier` ranks as `paid` (both fail-secure). It never constructs providers — the concrete strategy instances are injected via `strategies`, keeping the layer decoupled and independently testable.

### AssistProvider (`assist-provider.js`)

Wraps Bedrock `InvokeModel` for Amazon Nova Micro. It is **re-rank only**: `rerank({ query, candidates, topK })` returns `{ order, usage }` where `order` is a `number[]` of candidate indices. The model runs at `temperature: 0` (deterministic), its output is parsed strictly into integer indices, and prose is rejected — so the assist model can only reorder existing results, never inject synthesized content.

## Dependency-injection seams

The read-function service owns construction; the layer owns behavior.

- `getDocAiComponents(ai)` builds `EmbeddingProvider`, the `VectorStore`, `SemanticRetrieval`, `AssistProvider`, and `SemanticAssistedRetrieval` once per warm container (memoized at module scope) so the query-embedding cache stays warm and clients are not re-created per request. It stays `null` on the disabled path.
- `buildResults(hits, { version })` is injected into `SemanticRetrieval`. It enriches ranked hits with the same content metadata the keyword path uses (`Models.DocIndex.getContentMetadataByHashes`, keyed by `content:{hash}`) and maps each hit's cosine `score` onto `relevanceScore`, so semantic and keyword results are identical in shape. Hits whose metadata is missing are dropped (a partial index cannot fail the request).
- `DebugAndLog` from `@63klabs/cache-data` is injected as the `logger` — the layer never imports `DebugAndLog` itself, so it stays dependency-light and testable with a no-op logger.

## Adding a new vector store backend

The factory is the single extension point (Requirement 4.5) — callers never change. To add, for example, an `opensearch` backend:

1. Implement `class OpenSearchVectorStore extends VectorStore` in a new `nodejs/vector-store-opensearch.js`, overriding `upsertVectors`, `query`, and `deleteVersion`. `query` MUST return `{ hash, score, metadata }[]` ordered by descending similarity and honor `{ version, filters, topK }`.
2. Register it in `STORE_REGISTRY` in `nodejs/vector-store.js`:

   ```javascript
   const STORE_REGISTRY = {
     dynamodb:     { module: './vector-store-dynamodb', exportName: 'DynamoDbVectorStore' },
     's3-vectors': { module: './vector-store-s3',       exportName: 'S3VectorStore' },
     opensearch:   { module: './vector-store-opensearch', exportName: 'OpenSearchVectorStore' }
   };
   ```

3. Add the new id to the allowed values in both settings modules (`DOC_AI_VECTOR_STORES` in `read-function/config/settings.js` and `doc-indexer/lib/settings.js`) and to the `DocAiVectorStore` `AllowedValues` in `template.yml`.
4. Add any required infrastructure and least-privilege IAM to `template.yml`, gated by the `EnableDocAiIsTrue` condition.

Keep AWS SDK clients out of module top-level: require the backend's SDK client inside the concrete store (lazily) so the disabled path stays zero-cost. Only `@aws-sdk/client-s3vectors` is bundled as a production dependency of the layer; all other clients are provided by the Lambda runtime.

## Adding a new retrieval mode or provider

New strategies implement `retrieve(options)` and are injected into `selectStrategy` via `strategies`. Adding a **new mode** value additionally requires updating the `DOC_AI_RETRIEVAL_MODES` enum in both settings modules, the `DocAiRetrievalMode` `AllowedValues` in `template.yml`, and the mode dispatch in `selectStrategy`. The retrieval-mode and vector-store axes are independent — a mode change requires no code change to swap between `semantic` and `semantic-assisted` once both strategies are injected.

## Running the tests

All commands run from the relevant function/layer directory under `application-infrastructure/src/lambda/`.

```bash
# Layer unit + property tests (AWS SDK mocked with aws-sdk-client-mock; fast-check for
# cosine/ranking invariants). testMatch is **/tests/**/*.test.js.
cd application-infrastructure/src/lambda/layers/doc-ai-common
npm test

# Read-function tests, including the AI wiring test that loads the REAL layer modules via
# DOC_AI_LAYER_PATH with mocked leaf providers (no AWS SDK touched).
cd application-infrastructure/src/lambda/read-function
npm test

# Doc-indexer tests (settings loader + incremental embedding path).
cd application-infrastructure/src/lambda/doc-indexer
npm test
```

Unit tests mock the AWS SDK and never make real calls. Restore mocks in `afterEach`. See the [testing guide](testing.md) for conventions.

## Gated integration smoke test

A real end-to-end check (`layers/doc-ai-common/smoke/doc-ai-smoke.jest.js`) embeds text with the real Titan model and upserts/queries a real S3 Vectors index. It is **double-gated** so it never runs in CI:

1. **Location/name:** it lives in `smoke/` and is named `*.jest.js`, so the layer's `testMatch` (`**/tests/**/*.test.js`) never discovers it.
2. **Env gate:** even when explicitly targeted, it self-skips unless `DOC_AI_SMOKE_TEST=1` and the required operator env vars are set — no AWS call is made when skipped.

Run it against a deployed TEST stack (with the vector bucket/index and IAM in place) from the layer directory:

```bash
DOC_AI_SMOKE_TEST=1 npx jest --runInBand --testMatch "**/smoke/**/*.jest.js"
```

See the [deployment guide](../../DEPLOYMENT.md#gated-integration-smoke-test) for the full env-var list and prerequisites.

## Security notes

- The layer bundles only `@aws-sdk/client-s3vectors` as a production dependency (too new to be guaranteed in the runtime); every other AWS SDK v3 client is provided by the Lambda runtime and must not be bundled.
- Query and document text — and the assist model's output — are treated as untrusted. The assist response is parsed strictly into integer indices; prose is rejected and never echoed into results, so prompt-injection can at most affect ordering, not what content is returned.
- Runtime IAM is condition-gated and least-privilege: `bedrock:InvokeModel` is scoped to specific model ARNs and `s3vectors` actions to the single resolved index ARN. See the [deployment guide](../../DEPLOYMENT.md#iam) for the inference-profile caveat.

## Related documentation

- [Architecture: Documentation Semantic Search](../../ARCHITECTURE.md#documentation-semantic-search-bedrock-assisted)
- [Deployment: Enabling Documentation Semantic Search](../../DEPLOYMENT.md#enabling-documentation-semantic-search)
- [Documentation Indexer (admin/ops)](../admin-ops/documentation-indexer.md)
- [Testing guide](testing.md)
