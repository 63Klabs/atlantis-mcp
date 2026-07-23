'use strict';

/**
 * ============================================================================
 * GATED INTEGRATION SMOKE TEST — Bedrock Documentation Semantic Search (Task 8.3)
 * ============================================================================
 *
 * PURPOSE
 *   A minimal, real end-to-end check that the semantic-search runtime path works
 *   against LIVE AWS: it embeds text with the real Titan model via
 *   {@link EmbeddingProvider} (Bedrock InvokeModel) and upserts/queries a real
 *   S3 Vectors index via the `s3-vectors` {@link VectorStore}. This deliberately
 *   exercises `@aws-sdk/client-s3vectors` — the one client bundled as a PRODUCTION
 *   dependency of this layer (see the note in package.json / vector-store-s3.js) —
 *   so it validates that the deployed layer actually bundles it (Task 8.3 risk).
 *
 * WHY IT IS NOT IN THE DEFAULT / CI RUN (double-gated)
 *   1. Location: it lives in `smoke/` (NOT under `tests/**`) and is named
 *      `*.jest.js` (NOT `*.test.js`), so the layer's jest `testMatch`
 *      (`**\/tests/**\/*.test.js`) never discovers it. `npm test` / `npx jest`
 *      will not run it.
 *   2. Env gate: even when explicitly targeted, the suite self-skips unless
 *      `DOC_AI_SMOKE_TEST === '1'` AND the required operator env vars are set. No
 *      AWS call is made when skipped (the describe block does not execute).
 *
 * It never runs the full test suite or spawns child processes (complies with the
 * test-execution-monitoring steering); it calls the layer APIs directly and uses
 * bounded per-test timeouts.
 *
 * ----------------------------------------------------------------------------
 * HOW TO RUN
 * ----------------------------------------------------------------------------
 *   1. Deploy a TEST stack with the feature enabled so the vector bucket + index
 *      exist and IAM is in place:
 *        EnableDocAi=true, DOC_AI_ENABLED=true, DOC_AI_VECTOR_STORE=s3-vectors
 *      (deploy via the pipeline / samconfig per DEPLOYMENT.md — NOT from here).
 *   2. Confirm S3 Vectors is available in the deployment region (limited regional
 *      availability). If not, this smoke test cannot run; use DynamoDB instead.
 *   3. Set the operator env vars (values from the deployed stack outputs):
 *        export DOC_AI_SMOKE_TEST=1
 *        export AWS_REGION=us-east-1                 # or AWS_DEFAULT_REGION
 *        export DOC_AI_S3_VECTOR_BUCKET=<vector-bucket-name>
 *        export DOC_AI_S3_VECTOR_INDEX=<vector-index-name>
 *        # Optional (defaults shown). DIMENSIONS MUST equal the index dimension:
 *        export DOC_AI_EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
 *        export DOC_AI_EMBEDDING_DIMENSIONS=1024
 *      Ensure AWS credentials for the test account are available to the SDK
 *      (e.g. an assumed test role), with bedrock:InvokeModel on the embedding
 *      model and s3vectors access to the index.
 *   4. Run the single gated command from the layer directory
 *      (application-infrastructure/src/lambda/layers/doc-ai-common):
 *
 *        DOC_AI_SMOKE_TEST=1 npx jest --runInBand --testMatch "**\/smoke/**\/*.jest.js"
 *
 *      (Add VERBOSE_TESTS=1 to unmute logs.) The test seeds an EPHEMERAL index
 *      version `smoke-test-<timestamp>` and deletes it in afterAll, so it does not
 *      disturb real index versions.
 *
 * ALTERNATIVE (option b): instead of the layer-level check below, a real
 *   `search_documentation` MCP invocation against the deployed read-function with a
 *   paid/private-tier API key also validates the full result-shape mapping
 *   (title/excerpt/filePath/...). That requires the API endpoint + key and is
 *   outside this layer package, so it is documented here but not implemented.
 */

const crypto = require('crypto');
const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');

const { EmbeddingProvider } = require('../nodejs/embedding-provider');
const { createVectorStore } = require('../nodejs/vector-store');

// --- Gating -----------------------------------------------------------------

/** True only when the operator has explicitly opted in. */
const SMOKE_ENABLED = process.env.DOC_AI_SMOKE_TEST === '1';

/** Region can come from either standard SDK env var. */
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '';
const BUCKET = process.env.DOC_AI_S3_VECTOR_BUCKET || '';
const INDEX = process.env.DOC_AI_S3_VECTOR_INDEX || '';

/** Human-readable list of any missing required env, used in the skip reason. */
const MISSING_ENV = [
  ['AWS_REGION (or AWS_DEFAULT_REGION)', REGION],
  ['DOC_AI_S3_VECTOR_BUCKET', BUCKET],
  ['DOC_AI_S3_VECTOR_INDEX', INDEX]
].filter(([, value]) => value.trim().length === 0).map(([name]) => name);

/** Run only when opted in AND fully configured; otherwise self-skip. */
const SHOULD_RUN = SMOKE_ENABLED && MISSING_ENV.length === 0;

/** Reason surfaced in the (skipped) suite title so operators see WHY it skipped. */
const SKIP_REASON = !SMOKE_ENABLED
  ? 'set DOC_AI_SMOKE_TEST=1 (and operator env) to run'
  : `missing env: ${MISSING_ENV.join(', ')}`;

const MODEL = process.env.DOC_AI_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
const DIMENSIONS = parseInt(process.env.DOC_AI_EMBEDDING_DIMENSIONS || '1024', 10);
const MAX_INPUT_TOKENS = parseInt(process.env.DOC_AI_EMBEDDING_MAX_INPUT_TOKENS || '8000', 10);

/** Generous timeout: each test makes several real Bedrock + S3 Vectors calls. */
const NETWORK_TIMEOUT_MS = 120000;

/**
 * Stable short content hash for a seed document, so we can seed a known key and
 * later assert which document ranked first.
 *
 * @param {string} text - The document text.
 * @returns {string} A 16-char hex hash.
 */
function shortHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// Three clearly-distinct topics. The query paraphrases SEED_DOCS[0] WITHOUT reusing
// its keywords, so ranking it first exercises SEMANTIC similarity (not keyword match).
const SEED_DOCS = [
  {
    text: 'How to rotate the cache secure data key that is stored in SSM Parameter Store.',
    metadata: { type: 'guide', subType: 'howto', repository: 'cache-data', owner: '63klabs' }
  },
  {
    text: 'Configuring a CloudFront distribution: cache behaviors, TTLs, and origins.',
    metadata: { type: 'guide', subType: 'reference', repository: 'atlantis', owner: '63klabs' }
  },
  {
    text: 'DynamoDB single-table design using composite partition and sort keys.',
    metadata: { type: 'reference', subType: 'data-modeling', repository: 'atlantis', owner: '63klabs' }
  }
];

// Paraphrase of SEED_DOCS[0]: "secure data key" -> "encryption secret", "cache" -> "caching layer".
const QUERY_TEXT = 'steps to change the encryption secret used by the caching layer';

// Ephemeral version so the smoke run never collides with real index versions.
const SMOKE_VERSION = `smoke-test-${Date.now()}`;

const describeSmoke = SHOULD_RUN ? describe : describe.skip;

describeSmoke(
  `DOC AI gated integration smoke test [s3-vectors]${SHOULD_RUN ? '' : ` — SKIPPED (${SKIP_REASON})`}`,
  () => {
    /** @type {EmbeddingProvider} */
    let provider;
    /** @type {import('../nodejs/vector-store').VectorStore} */
    let store;
    /** Seed docs enriched with their hash + embedding, populated in beforeAll. */
    const seeded = [];

    beforeAll(async () => {
      provider = new EmbeddingProvider({ model: MODEL, dimensions: DIMENSIONS, maxInputTokens: MAX_INPUT_TOKENS });
      store = createVectorStore({
        vectorStore: 's3-vectors',
        dimensions: DIMENSIONS,
        s3Vectors: { bucket: BUCKET, index: INDEX }
      });

      // Embed all seed docs with the REAL model, then upsert into the ephemeral version.
      const items = [];
      for (const doc of SEED_DOCS) {
        const hash = shortHash(doc.text);
        const vector = await provider.embed(doc.text);
        seeded.push({ hash, text: doc.text });
        items.push({
          hash,
          vector,
          metadata: { ...doc.metadata, embeddingInputHash: hash, model: MODEL, dims: DIMENSIONS }
        });
      }
      await store.upsertVectors(SMOKE_VERSION, items);
    }, NETWORK_TIMEOUT_MS);

    afterAll(async () => {
      // Best-effort cleanup of the ephemeral version so the index is left as found.
      if (store) {
        await store.deleteVersion(SMOKE_VERSION);
      }
    }, NETWORK_TIMEOUT_MS);

    it('EmbeddingProvider.embed returns a normalized vector of the configured dimension', async () => {
      const vector = await provider.embed(QUERY_TEXT);
      expect(Array.isArray(vector)).toBe(true);
      expect(vector).toHaveLength(DIMENSIONS);
      expect(vector.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true);
    }, NETWORK_TIMEOUT_MS);

    it('semantic query returns ranked results with cross-store shape parity', async () => {
      const queryVector = await provider.embed(QUERY_TEXT);
      const results = await store.query(queryVector, { version: SMOKE_VERSION, topK: SEED_DOCS.length });

      // A semantic result set is returned.
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // Shape parity: every hit matches the VectorStore contract { hash, score, metadata }
      // (the SAME shape DynamoDbVectorStore returns), with enrichment metadata carried
      // through so a RetrievalStrategy maps it to the keyword result shape identically.
      for (const hit of results) {
        expect(typeof hit.hash).toBe('string');
        expect(hit.hash.length).toBeGreaterThan(0);
        expect(typeof hit.score).toBe('number');
        expect(Number.isFinite(hit.score)).toBe(true);
        expect(hit.metadata && typeof hit.metadata).toBe('object');
        expect(typeof hit.metadata.type).toBe('string');
        expect(typeof hit.metadata.subType).toBe('string');
      }

      // Results are ordered by DESCENDING similarity.
      const scores = results.map((r) => r.score);
      const sortedDesc = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(sortedDesc);

      // Semantic correctness: the paraphrased query ranks the secure-data-key guide first.
      expect(results[0].hash).toBe(seeded[0].hash);
    }, NETWORK_TIMEOUT_MS);

    it('metadata filters narrow semantic results equivalently to keyword filters', async () => {
      const queryVector = await provider.embed(QUERY_TEXT);
      const filtered = await store.query(queryVector, {
        version: SMOKE_VERSION,
        filters: { type: 'reference' },
        topK: SEED_DOCS.length
      });

      // Only the 'reference' doc (SEED_DOCS[2]) should match the type filter.
      expect(filtered.length).toBeGreaterThan(0);
      for (const hit of filtered) {
        expect(hit.metadata.type).toBe('reference');
      }
    }, NETWORK_TIMEOUT_MS);
  }
);
