# Tasks — Bedrock-Assisted Documentation Semantic Search

- [x] 1. Configuration and feature-flag foundation
  - [x] 1.1 Add the `documentation.ai` settings block to `read-function/config/settings.js`
        with `DOC_AI_*` parsing, defaults OFF/keyword, and warn-and-default validation.
  - [x] 1.2 Mirror the AI settings needed by the indexer in the doc-indexer config.
  - [x] 1.3 Add `EnableDocAi` CloudFormation Condition and `DOC_AI_*` parameters to
        `template.yml` (no resources yet); pass env vars to both functions.
  - [x] 1.4 Jest tests: parsing, defaults, invalid-value fallback; confirm keyword path
        unchanged when disabled.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. `doc-ai-common` Lambda Layer with EmbeddingProvider
  - [x] 2.1 Create `src/lambda/layers/doc-ai-common/` with its own `package.json`/`.nvmrc`
        and an `AWS::Serverless::LayerVersion` in the template; attach to both functions.
  - [x] 2.2 Implement `EmbeddingProvider` (Titan v2 request shape, dimensions, input
        truncation, typed errors, lazy Bedrock client).
  - [x] 2.3 Jest tests with mocked Bedrock client (request shape, dimensions, truncation,
        error path).
  - _Requirements: 2.1, 6.5, 8.5_

- [x] 3. VectorStore interface + DynamoDB implementation
  - [x] 3.1 Define the `VectorStore` interface and `createVectorStore` factory in the layer.
  - [x] 3.2 Implement `DynamoDbVectorStore` (vector items, version manifest, in-Lambda
        cosine, metadata filters, warm-cache of loaded vectors, TTL).
  - [x] 3.3 Jest tests: mocked DynamoDB, cosine property test (fast-check), top-K ordering,
        filter correctness.
  - _Requirements: 4.1, 4.3, 4.4_

- [x] 4. S3 Vectors implementation (+ infra spike)
  - [x] 4.1 Spike: confirm CloudFormation support for S3 Vectors bucket/index; choose
        native resource vs custom resource / post-deploy creation.
  - [x] 4.2 Implement `S3VectorStore` (put/query mapping, metadata filter translation,
        errors) behind the factory.
  - [x] 4.3 Add Condition-gated vector bucket/index infra following naming conventions.
  - [x] 4.4 Jest tests with mocked S3 Vectors client (mapping, filters, errors).
  - _Requirements: 4.2, 4.3, 4.4, 4.5, 8.3, 8.4_

- [x] 5. Indexer embedding generation (incremental)
  - [x] 5.1 Compute `embeddingInput` + `embeddingInputHash` per entry; reuse prior-version
        embedding when hash/model/dims match; otherwise embed via `EmbeddingProvider`.
  - [x] 5.2 Upsert vectors to the configured store; record embedding model/dimensions in
        version metadata; skip entirely when disabled.
  - [x] 5.3 Jest tests: incremental reuse, disabled no-op, version metadata, batch writes
        (mocked embedding + store).
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 6. Retrieval strategies + tier threading (first end-to-end)
  - [x] 6.1 Thread `authInfo` through `Routes.process` → `json-rpc-router` →
        `handleToolsCall` → `props.authInfo`; documentation controller reads tier.
  - [x] 6.2 Implement `KeywordRetrieval` (wrap existing) and `SemanticRetrieval` (embed
        query with caching → VectorStore.query → map to existing result shape).
  - [x] 6.3 Implement `selectStrategy` (enabled + tier ≥ minTier + mode) with keyword
        fallback on any semantic error.
  - [x] 6.4 Jest tests: tier gating matrix, disabled fallback, result-shape parity,
        query-embedding cache hits.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 7.2, 7.3_

- [x] 7. Semantic-assisted mode behind the flag
  - [x] 7.1 Implement `SemanticAssistedRetrieval` (LLM query expansion and/or re-rank of
        top candidates only; never synthesize prose) selected by `semantic-assisted`.
  - [x] 7.2 Add usage/cost logging (strategy, store, token counts) and graceful fallback
        to plain semantic on LLM error.
  - [x] 7.3 Jest tests: deterministic reorder/expansion, no-prose guarantee, fallback,
        mode switch requires no code change.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 7.4_

- [x] 8. IAM, CloudFormation wiring, and end-to-end enablement
  - [x] 8.1 Add Condition-gated, least-privilege `bedrock:InvokeModel` (specific model
        ARNs) to read-function and doc-indexer roles; scope S3 Vectors permissions.
  - [x] 8.2 Wire remaining env vars; add cost/usage CloudWatch logging/metric filters.
  - [x] 8.3 Validate the template; run a gated integration smoke test on a test stack.
  - [x] 8.4 Wire retrieval strategies into the read-function documentation service (selectStrategy + provider/store construction + DebugAndLog injection); keyword path unchanged when disabled/below-tier.
  - _Requirements: 7.1, 7.4, 8.1, 8.2, 8.3, 8.4_

- [x] 9. Documentation and changelog
  - [x] 9.1 Update ARCHITECTURE.md (components + diagram), DEPLOYMENT.md (parameters,
        Bedrock model enablement, region prerequisites), end-user and developer docs.
  - [x] 9.2 Add CHANGELOG.md entries under `v0.0.6 (unreleased)` referencing this spec.
  - _Requirements: 9.1, 9.2, 9.3_
