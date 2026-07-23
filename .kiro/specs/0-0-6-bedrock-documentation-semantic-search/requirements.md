# Requirements — Bedrock-Assisted Documentation Semantic Search

## Introduction

The `search_documentation` MCP tool currently performs keyword matching against a
DynamoDB-backed index built by the Doc Indexer Lambda. Keyword search misses
semantically related content when a caller's phrasing differs from the indexed
text. This feature adds Bedrock-powered semantic retrieval that returns more
relevant results to the calling AI agent. It augments retrieval only — it never
composes answers, so it does not supplant the calling agent's reasoning.

The enhancement is gated to paid and private tiers, defaults OFF, and is selectable
through configuration so 63Klabs and self-hosters can choose their retrieval mode
and vector store and compare cost. All resources are incorporated into the existing
application stack behind a CloudFormation Condition.

Tier ordering used throughout: `public` < `registered` < `paid` < `private`.

## Requirements

### Requirement 1: Configuration-driven feature flags

**User Story:** As an operator, I want to enable the AI enhancement and select the
retrieval mode and vector store through configuration, so that I can experiment and
self-hosters can choose their own setup without code changes.

#### Acceptance Criteria
1. WHEN the application loads settings THEN the system SHALL read `DOC_AI_ENABLED`,
   `DOC_AI_MIN_TIER`, `DOC_AI_RETRIEVAL_MODE`, `DOC_AI_VECTOR_STORE`,
   `DOC_AI_EMBEDDING_MODEL`, `DOC_AI_EMBEDDING_DIMENSIONS`, `DOC_AI_ASSIST_MODEL`,
   and `DOC_AI_TOP_K` into a `documentation.ai` settings block.
2. WHEN `DOC_AI_ENABLED` is unset THEN the system SHALL default to disabled and
   behave exactly as the current keyword-only implementation.
3. WHEN `DOC_AI_RETRIEVAL_MODE` is set to an unrecognized value THEN the system
   SHALL log a warning and fall back to `keyword`.
4. WHEN `DOC_AI_VECTOR_STORE` is set to an unrecognized value THEN the system SHALL
   log a warning and fall back to the documented default (`s3-vectors`).
5. WHERE a value is invalid or out of range THEN the system SHALL use the documented
   default rather than throwing during settings load.

### Requirement 2: Semantic vector retrieval

**User Story:** As an AI agent calling the MCP, I want documentation results ranked
by semantic similarity to my query, so that I get relevant results even when wording
differs from the docs.

#### Acceptance Criteria
1. WHEN retrieval mode is `semantic` and a search is performed THEN the system SHALL
   embed the query with the configured Bedrock embedding model and return the
   nearest vectors from the active index version.
2. WHEN semantic results are returned THEN each result SHALL use the same shape as
   keyword results (title, excerpt, filePath, githubUrl, type, subType,
   relevanceScore, repository, repositoryType, namespace, context).
3. WHEN `type` or `subType` filters are supplied THEN the system SHALL apply them to
   semantic results equivalently to keyword results.
4. WHEN the query embedding or vector query fails THEN the system SHALL fall back to
   keyword search, log the error, and still return a valid response.
5. IF no active index version exists THEN the system SHALL return an empty result set
   with helpful suggestions (matching current behavior).

### Requirement 3: Tier-based transparent gating

**User Story:** As the service owner, I want semantic search available only to paid
and private tiers through the existing tool, so that lower tiers are unaffected and
callers do not need a different tool.

#### Acceptance Criteria
1. WHEN a request's effective tier is greater than or equal to `DOC_AI_MIN_TIER` AND
   the feature is enabled AND the mode is not `keyword` THEN the system SHALL use the
   configured semantic strategy.
2. WHEN a request's effective tier is below `DOC_AI_MIN_TIER` THEN the system SHALL
   use keyword search and return results in the same shape.
3. WHEN the feature is disabled THEN the system SHALL use keyword search for all tiers.
4. WHEN gating decisions are made THEN the tool name (`search_documentation`) and its
   response contract SHALL remain unchanged for all callers.
5. WHERE tier is unavailable due to degraded auth THEN the system SHALL treat the
   request as its resolved tier (public when degraded) and use keyword search.

### Requirement 4: Selectable vector store

**User Story:** As an operator, I want to switch the vector store between DynamoDB and
S3 Vectors via configuration, so that I can compare cost and performance.

#### Acceptance Criteria
1. WHEN `DOC_AI_VECTOR_STORE` is `dynamodb` THEN the system SHALL store and query
   vectors using the existing DocIndex DynamoDB table.
2. WHEN `DOC_AI_VECTOR_STORE` is `s3-vectors` THEN the system SHALL store and query
   vectors using an S3 Vectors vector bucket and index.
3. WHEN either store is queried THEN it SHALL support metadata filtering by index
   version and by result type/subType.
4. WHEN the store returns candidates THEN the system SHALL rank by cosine similarity
   and return the top K configured results.
5. WHERE a future store (`opensearch`) is added THEN it SHALL implement the same
   VectorStore interface without changes to callers.

### Requirement 5: Semantic-assisted mode (LLM) behind the flag

**User Story:** As an operator, I want an optional light LLM assist for query
expansion and re-ranking, so that I can improve relevance while comparing its cost.

#### Acceptance Criteria
1. WHEN retrieval mode is `semantic-assisted` THEN the system SHALL perform semantic
   retrieval and then use the configured small Bedrock model to expand the query
   and/or re-rank the top candidates only.
2. WHEN the assist model runs THEN the system SHALL NOT return synthesized prose or
   an answer; it SHALL return only reordered/expanded result sets in the standard shape.
3. WHEN the assist model call fails THEN the system SHALL fall back to plain semantic
   results and log the error.
4. WHEN mode is switched between `semantic` and `semantic-assisted` THEN no code
   change SHALL be required.
5. WHEN the assist model runs THEN the system SHALL log token usage for cost analysis.

### Requirement 6: Index-time embedding generation (incremental, low cost)

**User Story:** As the service owner, I want the indexer to generate embeddings only
for new or changed content, so that indexing stays low cost.

#### Acceptance Criteria
1. WHEN the Doc Indexer runs AND the feature is enabled THEN it SHALL generate an
   embedding for each indexed content entry and write it to the configured vector store.
2. WHEN an entry's embedding input is unchanged from the previous version (matching
   content hash, model, and dimensions) THEN the indexer SHALL reuse the prior
   embedding instead of calling Bedrock.
3. WHEN the feature is disabled THEN the indexer SHALL skip all embedding work and
   behave as it does today.
4. WHEN embeddings are written THEN the index version metadata SHALL record the
   embedding model and dimensions used.
5. WHEN embedding a large entry THEN the indexer SHALL truncate the input to the
   configured token budget.

### Requirement 7: Low cost and observability

**User Story:** As the service owner, I want the feature to cost near zero at rest and
to expose usage data, so that I can compare vector store and mode options on cost.

#### Acceptance Criteria
1. WHEN no requests occur THEN the feature SHALL incur no standing compute cost.
2. WHEN a query embedding is computed THEN the system SHALL cache it (keyed by
   normalized query, model, and dimensions) to avoid repeat Bedrock calls.
3. WHEN semantic results are computed THEN the system SHALL cache them via the
   existing cache-data profiles.
4. WHEN a semantic or assisted search runs THEN the system SHALL log the strategy,
   vector store, and Bedrock token usage for cost comparison.

### Requirement 8: Infrastructure, IAM, and stack incorporation

**User Story:** As a cloud engineer, I want the AI resources incorporated into the
existing stack behind a toggle with least-privilege IAM, so that deployment stays
cohesive and secure.

#### Acceptance Criteria
1. WHEN the stack is deployed with the AI Condition disabled THEN no AI resources
   (vector bucket, Bedrock permissions) SHALL be created.
2. WHEN the AI Condition is enabled THEN the read-function and doc-indexer roles SHALL
   receive `bedrock:InvokeModel` scoped to the specific configured model ARNs only.
3. WHEN S3 Vectors is used THEN IAM permissions SHALL be scoped to the specific vector
   bucket following the naming convention.
4. WHEN resources are named THEN they SHALL follow `Prefix-ProjectId-StageId-*` (and
   the S3 bucket patterns for the vector bucket).
5. WHEN shared code is needed by both functions THEN it SHALL be delivered as a Lambda
   Layer, not a shared source directory.

### Requirement 9: Documentation and changelog

**User Story:** As a maintainer, I want documentation and the changelog updated, so
that operators can enable and switch strategies and understand the feature.

#### Acceptance Criteria
1. WHEN the feature is complete THEN ARCHITECTURE.md, DEPLOYMENT.md, end-user docs, and
   developer docs SHALL be updated to describe the feature, parameters, and Bedrock
   model enablement prerequisites.
2. WHEN the changelog is updated THEN entries SHALL be added under the `v0.0.6
   (unreleased)` section only.
3. WHEN documentation is added THEN semantic search SHALL be described as a paid/private
   tier capability.
