The plan is approved. Here's the complete plan as the hand-off artifact.

---

# Implementation Plan — Bedrock-Assisted Documentation Semantic Search

## Problem Statement
`search_documentation` currently does pure keyword matching against a DynamoDB index, which misses semantically related content when the caller's wording differs from the indexed text. Add Bedrock-powered semantic retrieval that returns more relevant results to the calling AI agent without composing answers, gated to paid/private tiers, kept low cost, and switchable via configuration for both 63Klabs and self-hosters.

## Requirements
- Start with semantic vector retrieval; feature-flag a move to semantic + light LLM assist (query expansion / re-ranking) with no code change. RAG synthesis is a future flag value only.
- Feature-flag the vector store (DynamoDB vs S3 Vectors) to compare cost; OpenSearch is a future flag value.
- Transparently upgrade the existing `search_documentation` tool: paid/private get semantic, others get keyword, same tool name and response shape.
- Never return synthesized prose; keep the current result shape.
- Low cost, ~$0 at rest, with a way to compare cost between strategies.

## Key Design Decisions
- Two config-selected axes, defaulting OFF (behavior unchanged until enabled): `DOC_AI_RETRIEVAL_MODE` (`keyword`|`semantic`|`semantic-assisted`|future `rag`) and `DOC_AI_VECTOR_STORE` (`s3-vectors`|`dynamodb`|future `opensearch`). Plus `DOC_AI_ENABLED`, `DOC_AI_MIN_TIER` (default `paid`), `DOC_AI_EMBEDDING_MODEL` (Titan Text Embeddings V2, 1024 dims), `DOC_AI_ASSIST_MODEL`, and topK/candidate limits. All exposed as CloudFormation parameters and env vars.
- Transparent tier gating: semantic when `enabled && tier >= minTier && mode != keyword`, else keyword fallback; identical output contract.
- Shared abstractions (`EmbeddingProvider`, `VectorStore` + factory, `RetrievalStrategy` + factory) live in a new `src/lambda/layers/doc-ai-common/` Lambda Layer used by `read-function` and `doc-indexer`.
- Cost controls: incremental index-time embeddings (reuse content hash; unchanged content not re-embedded), cached query embeddings and semantic results, usage logging (tokens/strategy/store) for A/B comparison.
- Stack: incorporate into the existing application stack behind an `EnableDocAi` CloudFormation Condition (mirrors the existing PROD-only conditional resources). Bedrock is IAM-only; the vector store extends the existing DocIndex/doc-indexer/read-function trio. Extract to a nested stack later only if the footprint grows.

## Task Breakdown
- **Task 1: Configuration and feature-flag foundation.** Add the `documentation.ai` settings block (env-var driven) to both functions, plus CloudFormation parameters and the `EnableDocAi` Condition, defaulting OFF/keyword. Tests: settings parsing and unchanged keyword path. Demo: settings resolve from env vars; keyword search behaves identically with the flag off.
- **Task 2: `doc-ai-common` Lambda Layer + EmbeddingProvider.** Create the layer and a Bedrock embeddings wrapper (Titan v2) with truncation, dimension config, error handling; wire into both functions. Tests: mocked Bedrock (request shape, dimensions, truncation, fallback). Demo: unit test returns a vector of configured dimension (mocked).
- **Task 3: VectorStore interface + DynamoDB implementation.** Define the interface and `DynamoDbVectorStore` (compact vector storage, in-Lambda cosine, metadata filters) with a config-driven factory. Tests: mocked DynamoDB, cosine property test, top-K ordering, filters. Demo: seeded vectors return ranked nearest neighbors.
- **Task 4: S3 Vectors implementation (+ infra spike).** Implement `S3VectorStore` and Condition-gated bucket/index creation; spike CloudFormation support with custom-resource/post-deploy fallback. Tests: mocked S3 Vectors client (mapping, filters, errors). Demo: flip to `s3-vectors` and run the same query path.
- **Task 5: Indexer embedding generation (incremental).** Embed each content entry and upsert to the configured store, reusing unchanged hashes, recording model/dimensions in version metadata; no-op when disabled. Tests: mocked embedding/store (incremental reuse, disabled no-op, metadata). Demo: new content embedded, unchanged reused, no-op when disabled.
- **Task 6: Retrieval strategies + tier threading (first end-to-end).** Thread `authInfo.tier` through Routes → json-rpc-router → controller → service; implement `keyword` and `semantic` strategies with tier-based selection and fallback; cache query embeddings/results. Tests: tier gating, disabled fallback, result-shape parity, cache hits. Demo: same call returns semantic for a paid key, keyword for public.
- **Task 7: Semantic-assisted mode behind the flag.** Implement `SemanticAssistedRetrieval` (small LLM for expansion/re-ranking of top candidates only, never prose) with usage/cost logging and graceful fallback. Tests: mocked LLM (deterministic reorder/expansion, no synthesized text, fallback). Demo: flip to `semantic-assisted`, show reordered results + cost logs, flip back with no code change.
- **Task 8: IAM, CloudFormation wiring, end-to-end enablement.** Add scoped `bedrock:InvokeModel` (specific model ARNs) and S3 Vectors permissions to both roles, Condition-gated; wire env vars; add cost/usage CloudWatch logging; verify on a test stack. Tests: template validation; gated integration smoke. Demo: deploy with AI + `s3-vectors`, run a real paid-key search, switch to `dynamodb`, compare cost logs.
- **Task 9: Documentation and changelog.** Update ARCHITECTURE.md, DEPLOYMENT.md (new params, Bedrock enablement, region prerequisites), end-user/developer docs, and CHANGELOG.md under v0.0.6 (unreleased); create the spec at `.kiro/specs/0-0-6-bedrock-documentation-semantic-search/`. Tests: doc link validity; changelog unreleased-only. Demo: a maintainer can enable and switch strategies from the docs alone.

## Confirmed Defaults
Titan Text Embeddings V2 @ 1024 dims (configurable); shared code in a `doc-ai-common` Lambda Layer; feature defaults OFF with `minTier=paid`.
