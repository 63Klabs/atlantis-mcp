'use strict';

/**
 * Unit tests for lib/embedding-input.js (doc-indexer index-time embedding helpers).
 *
 * These are the pure helpers that back the incremental-embedding decision (spec 0-0-6,
 * tasks 5.1/5.2). They have no I/O and no AWS dependency, so they are tested directly:
 *   - buildEmbeddingInput: composes the text embedded for a content entry.
 *   - computeEmbeddingInputHash: deterministic full SHA-256 reuse key.
 *   - shouldReuseEmbedding: decides whether a prior-version embedding may be reused.
 *
 * Requirements: 6.1 (embed new/changed), 6.2 (reuse unchanged by hash/model/dims),
 * 6.4 (embedding metadata that the vector records carry).
 */

const {
  buildEmbeddingInput,
  computeEmbeddingInputHash,
  shouldReuseEmbedding
} = require('../../lib/embedding-input');

// Known SHA-256 of the empty string — used to assert the non-string / empty collapse.
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('buildEmbeddingInput', () => {
  test('joins title, excerpt, and content with newlines when all present', () => {
    const input = buildEmbeddingInput({ title: 'Cache keys', excerpt: 'How keys work', content: 'Details...' });
    expect(input).toBe('Cache keys\nHow keys work\nDetails...');
  });

  test('omits a missing excerpt (title + content only, no stray blank line)', () => {
    const input = buildEmbeddingInput({ title: 'Title', content: 'Body' });
    expect(input).toBe('Title\nBody');
  });

  test('returns only the title when it is the sole field', () => {
    expect(buildEmbeddingInput({ title: 'Only a title' })).toBe('Only a title');
  });

  test('returns empty string for an empty object (caller skips embedding)', () => {
    expect(buildEmbeddingInput({})).toBe('');
  });

  test('ignores non-string excerpt/content fields', () => {
    // excerpt (number) and content (null) are dropped; only the string title remains.
    expect(buildEmbeddingInput({ title: 'T', excerpt: 123, content: null })).toBe('T');
  });

  test('ignores a non-string title but keeps the string excerpt/content', () => {
    expect(buildEmbeddingInput({ title: 42, excerpt: 'E', content: 'C' })).toBe('E\nC');
  });

  test('filters out empty-string fields', () => {
    expect(buildEmbeddingInput({ title: '', excerpt: 'E', content: '' })).toBe('E');
  });

  test('returns empty string defensively for null/undefined/non-object input', () => {
    expect(buildEmbeddingInput(null)).toBe('');
    expect(buildEmbeddingInput(undefined)).toBe('');
    expect(buildEmbeddingInput('not-an-object')).toBe('');
  });
});

describe('computeEmbeddingInputHash', () => {
  test('returns a 64-character lowercase hex digest', () => {
    const hash = computeEmbeddingInputHash('some embedding input');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic — identical input yields identical hash', () => {
    const input = 'Cache keys\nHow keys work\nDetails...';
    expect(computeEmbeddingInputHash(input)).toBe(computeEmbeddingInputHash(input));
  });

  test('different input yields a different hash', () => {
    expect(computeEmbeddingInputHash('input A')).not.toBe(computeEmbeddingInputHash('input B'));
  });

  test('non-string input collapses to the hash of the empty string', () => {
    expect(computeEmbeddingInputHash('')).toBe(EMPTY_SHA256);
    expect(computeEmbeddingInputHash(undefined)).toBe(EMPTY_SHA256);
    expect(computeEmbeddingInputHash(null)).toBe(EMPTY_SHA256);
    expect(computeEmbeddingInputHash(1234)).toBe(EMPTY_SHA256);
    expect(computeEmbeddingInputHash({})).toBe(EMPTY_SHA256);
  });
});

describe('shouldReuseEmbedding', () => {
  const MODEL = 'amazon.titan-embed-text-v2:0';
  const DIMS = 1024;
  const expected = { embeddingInputHash: 'h1', model: MODEL, dimensions: DIMS };
  const priorMatch = { embeddingInputHash: 'h1', model: MODEL, dims: DIMS, vector: [0.1, 0.2] };

  test('returns true when hash, model, and dims all match', () => {
    expect(shouldReuseEmbedding(priorMatch, expected)).toBe(true);
  });

  test('returns false when the embedding input hash differs', () => {
    expect(shouldReuseEmbedding({ ...priorMatch, embeddingInputHash: 'h2' }, expected)).toBe(false);
  });

  test('returns false when the model differs', () => {
    expect(shouldReuseEmbedding({ ...priorMatch, model: 'other-model' }, expected)).toBe(false);
  });

  test('returns false when the dimensions differ', () => {
    expect(shouldReuseEmbedding({ ...priorMatch, dims: 512 }, expected)).toBe(false);
  });

  test('returns false for a null or undefined prior record', () => {
    expect(shouldReuseEmbedding(null, expected)).toBe(false);
    expect(shouldReuseEmbedding(undefined, expected)).toBe(false);
  });

  test('returns false when the expected model is missing', () => {
    expect(shouldReuseEmbedding(priorMatch, { embeddingInputHash: 'h1', dimensions: DIMS })).toBe(false);
  });

  test('returns false when the expected dimensions are missing', () => {
    expect(shouldReuseEmbedding(priorMatch, { embeddingInputHash: 'h1', model: MODEL })).toBe(false);
  });

  test('returns false when the expected hash is missing', () => {
    expect(shouldReuseEmbedding(priorMatch, { model: MODEL, dimensions: DIMS })).toBe(false);
  });

  test('returns false when expected dimensions is non-integer (string or float)', () => {
    expect(shouldReuseEmbedding(priorMatch, { ...expected, dimensions: '1024' })).toBe(false);
    expect(shouldReuseEmbedding(priorMatch, { ...expected, dimensions: 1024.5 })).toBe(false);
  });

  test('returns false when the prior record lacks dims or model', () => {
    expect(shouldReuseEmbedding({ embeddingInputHash: 'h1', model: MODEL }, expected)).toBe(false);
    expect(shouldReuseEmbedding({ embeddingInputHash: 'h1', dims: DIMS }, expected)).toBe(false);
  });
});
