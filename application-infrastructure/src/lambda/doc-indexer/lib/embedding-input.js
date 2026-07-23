'use strict';

/**
 * embedding-input — pure helpers for the doc-indexer's index-time embedding phase
 * (spec 0-0-6, task 5.1). These functions have no I/O and no AWS dependency: they
 * compose the text that is embedded for a content entry, hash that text, and decide
 * whether a prior-version embedding can be reused instead of re-calling Bedrock.
 *
 * Keeping them pure (and separate from `index-builder.js`) makes the incremental-reuse
 * decision trivially unit-testable (task 5.3) and reusable by both the index-time path
 * here and any future tooling, without pulling in the layer or the vector store.
 *
 * This module uses 2-space indentation to match the sibling `lib/settings.js`; the
 * orchestrator (`lib/index-builder.js`) uses tabs. Each file is internally consistent.
 *
 * @module lib/embedding-input
 */

const crypto = require('crypto');

/**
 * Compose the text embedded for a content entry.
 *
 * Composition (per design "Indexer Changes"): `title` + "\n" + `excerpt` + "\n" +
 * `content`. Only fields that are present, string-typed, and non-empty are included,
 * so an entry missing (for example) an excerpt yields `title` + "\n" + `content`
 * rather than a stray blank line. When none of the three fields is a usable string,
 * the result is the empty string, and the caller skips embedding that entry.
 *
 * This function deliberately does NOT truncate. The {@link EmbeddingProvider} truncates
 * to the configured `maxInputTokens` immediately before calling Bedrock, so truncation
 * lives in exactly one place. The full (untruncated) input is what
 * {@link computeEmbeddingInputHash} hashes — see that function for why hashing the full
 * input keeps embedding reuse safe (never reuses a stale embedding).
 *
 * @param {{title?: string, excerpt?: string, content?: string}} entry - Content entry.
 * @returns {string} The composed embedding input (possibly empty).
 * @example
 * buildEmbeddingInput({ title: 'Cache keys', excerpt: 'How keys work', content: 'Details...' });
 * // 'Cache keys\nHow keys work\nDetails...'
 * @example
 * buildEmbeddingInput({ title: 'Only a title' });
 * // 'Only a title'
 * @example
 * buildEmbeddingInput({});
 * // '' (caller skips embedding)
 */
function buildEmbeddingInput(entry) {
  const source = (entry && typeof entry === 'object') ? entry : {};
  return [source.title, source.excerpt, source.content]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join('\n');
}

/**
 * Compute a stable, deterministic hash of the embedding input, used as the reuse key
 * (Requirement 6.2): if an entry's embedding input is unchanged from the previous index
 * version (and the model and dimensions also match) the indexer reuses the prior
 * embedding instead of re-calling Bedrock.
 *
 * Hash choice — this returns the FULL 64-character SHA-256 hex digest (256 bits), NOT
 * the 16-character truncation used by `hasher.js#hashContentPath`. The rationale: the
 * content-path hash keys items WITHIN a single index build (thousands of entries, where
 * a collision merely overwrites one entry), whereas this hash gates CROSS-VERSION
 * embedding reuse across the ENTIRE corpus over time. A collision here could cause a
 * stale/wrong embedding to be silently reused, so the full 256-bit digest is used to
 * make that risk negligible; the few extra bytes stored per vector are immaterial.
 *
 * The full (untruncated) embedding input is hashed even though the provider truncates
 * before embedding. This is intentional and conservative: identical hash + model + dims
 * implies identical input, hence identical truncation and identical embedding, so reuse
 * is always safe. The only downside is that a change confined to the truncated-away tail
 * produces a different hash and triggers an unnecessary (but harmless) re-embed — never
 * a stale reuse.
 *
 * @param {string} embeddingInput - The composed embedding input (from {@link buildEmbeddingInput}).
 * @returns {string} A 64-character lowercase hex SHA-256 digest.
 * @example
 * computeEmbeddingInputHash('Cache keys\nHow keys work\nDetails...');
 * // e.g. '9f2c...' (64 hex chars)
 */
function computeEmbeddingInputHash(embeddingInput) {
  // >! Treat input defensively; a non-string collapses to '' rather than throwing.
  const input = (typeof embeddingInput === 'string') ? embeddingInput : '';
  return crypto
    .createHash('sha256')
    .update(input, 'utf8')
    .digest('hex');
}

/**
 * Decide whether a prior-version embedding record can be reused for the current entry.
 *
 * Reuse is permitted (returns `true`) only when a prior record exists AND all three of
 * its identity fields match the current expectation (Requirement 6.2):
 *   - `priorRecord.embeddingInputHash === embeddingInputHash` (same content input)
 *   - `priorRecord.model === model` (same embedding model)
 *   - `priorRecord.dims === dimensions` (same output dimensionality)
 *
 * Missing/undefined fields on either side yield `false` (conservative re-embed): if any
 * comparison value is absent we cannot prove the prior embedding is equivalent, so the
 * safe choice is to re-embed rather than risk reusing a stale/mismatched vector. (Note:
 * both the DynamoDB and S3 Vectors stores persist `model`/`dims` per vector, so reuse is
 * effective for either backend; a prior record that lacks them — e.g. from an older index
 * built before this was stored — simply falls back to a re-embed.)
 *
 * @param {?{embeddingInputHash?: string, model?: string, dims?: number, vector?: number[]}} priorRecord -
 *   The prior-version embedding record (from the vector store), or a falsy value when none exists.
 * @param {{embeddingInputHash: string, model: string, dimensions: number}} expected - Current identity to match.
 * @returns {boolean} `true` when the prior embedding may be reused, otherwise `false`.
 * @example
 * shouldReuseEmbedding(
 *   { embeddingInputHash: 'h1', model: 'amazon.titan-embed-text-v2:0', dims: 1024, vector: [] },
 *   { embeddingInputHash: 'h1', model: 'amazon.titan-embed-text-v2:0', dimensions: 1024 }
 * ); // true
 * @example
 * shouldReuseEmbedding(null, { embeddingInputHash: 'h1', model: 'm', dimensions: 1024 }); // false
 */
function shouldReuseEmbedding(priorRecord, expected) {
  if (!priorRecord || typeof priorRecord !== 'object') {
    return false;
  }
  const { embeddingInputHash, model, dimensions } = (expected && typeof expected === 'object')
    ? expected
    : {};
  // >! Require all three comparison inputs to be present so `undefined === undefined`
  // >! cannot produce a false "match" against a prior record that also lacks the field.
  if (typeof embeddingInputHash !== 'string' || embeddingInputHash.length === 0) {
    return false;
  }
  if (typeof model !== 'string' || model.length === 0) {
    return false;
  }
  if (!Number.isInteger(dimensions)) {
    return false;
  }
  return (
    priorRecord.embeddingInputHash === embeddingInputHash &&
    priorRecord.model === model &&
    priorRecord.dims === dimensions
  );
}

module.exports = {
  buildEmbeddingInput,
  computeEmbeddingInputHash,
  shouldReuseEmbedding
};
