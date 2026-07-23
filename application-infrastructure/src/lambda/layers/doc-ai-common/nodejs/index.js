'use strict';

/**
 * doc-ai-common Lambda Layer — shared code root.
 *
 * Runtime layout: everything under this `nodejs/` directory is extracted to
 * `/opt/nodejs/` in the Lambda execution environment. The read-function (query
 * path) and doc-indexer (index path) both attach this layer, so the shared
 * abstractions for Bedrock-assisted documentation semantic search live here
 * exactly once instead of being duplicated per function.
 *
 * Intended require path for consuming functions (added in later tasks):
 *   const { EmbeddingProvider } = require('/opt/nodejs/embedding-provider');
 *   const { createVectorStore } = require('/opt/nodejs/vector-store');
 *   const { selectStrategy } = require('/opt/nodejs/retrieval-strategy');
 * The absolute `/opt/nodejs/<module>` path resolves regardless of NODE_PATH.
 * This aggregator (`/opt/nodejs` -> index.js) may also re-export those modules
 * once they exist, but individual modules should be required directly.
 *
 * Dependencies: this layer bundles exactly ONE production npm dependency,
 * @aws-sdk/client-s3vectors, because that client is too new to be guaranteed in the
 * nodejs24.x runtime and the buildspec packages layers with `--omit=dev` (so a
 * devDependency would be dropped from the deployed layer and crash the s3-vectors path).
 * All other AWS SDK v3 clients (Bedrock Runtime, DynamoDB, S3) ARE provided by the
 * Lambda runtime and must not be packaged (see AGENTS.md); they and the testing packages
 * in package.json stay as devDependencies used only by the layer's own Jest tests.
 *
 * Populated by later tasks in spec 0-0-6-bedrock-documentation-semantic-search:
 *   - Task 2.2: EmbeddingProvider  (nodejs/embedding-provider.js) — DONE
 *   - Task 3.1: VectorStore interface + createVectorStore factory
 *              (nodejs/vector-store.js) — DONE
 *   - Task 3.2: DynamoDbVectorStore (nodejs/vector-store-dynamodb.js) — DONE
 *   - Task 6.2: RetrievalStrategy interface + Keyword/Semantic strategies
 *              (nodejs/retrieval-strategy.js) — DONE
 *   - Task 6.3: selectStrategy factory + FallbackRetrieval wrapper
 *              (nodejs/retrieval-strategy.js) — DONE
 *   - Task 7.1: AssistProvider (nodejs/assist-provider.js) + SemanticAssistedRetrieval
 *              (nodejs/retrieval-strategy.js) — DONE
 *
 * This aggregator re-exports each module as it lands. Consuming functions may still
 * require individual modules directly (e.g. `require('/opt/nodejs/embedding-provider')`).
 */

const { EmbeddingProvider, EmbeddingError, EmbeddingInvalidInputError } = require('./embedding-provider');
const { VectorStore, VectorStoreError, createVectorStore } = require('./vector-store');
const {
  RetrievalStrategy,
  KeywordRetrieval,
  SemanticRetrieval,
  SemanticAssistedRetrieval,
  FallbackRetrieval,
  RetrievalError,
  selectStrategy
} = require('./retrieval-strategy');
const { AssistProvider, AssistError } = require('./assist-provider');

module.exports = {
  EmbeddingProvider,
  EmbeddingError,
  EmbeddingInvalidInputError,
  VectorStore,
  VectorStoreError,
  createVectorStore,
  RetrievalStrategy,
  KeywordRetrieval,
  SemanticRetrieval,
  SemanticAssistedRetrieval,
  FallbackRetrieval,
  RetrievalError,
  selectStrategy,
  AssistProvider,
  AssistError
};
