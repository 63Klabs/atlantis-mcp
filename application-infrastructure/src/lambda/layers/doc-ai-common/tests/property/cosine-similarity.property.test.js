'use strict';

/**
 * Property-based tests for the pure ranking math of DynamoDbVectorStore
 * (doc-ai-common Lambda Layer): `cosineSimilarity` and the `encodeVector` /
 * `decodeVector` Float32 codec.
 *
 * Purpose: Verify the universal invariants that make semantic ranking correct
 * across ALL inputs (not just hand-picked examples): cosine is bounded, symmetric,
 * self-similar, scale-invariant, and well-defined (0) for degenerate inputs; and the
 * base64 Float32 codec round-trips exactly and is bounded by `dims`.
 *
 * Why property tests: ranking correctness (Requirement 4.4) is a claim over the whole
 * input space. fast-check generates hundreds of vectors — including awkward mixes of
 * magnitudes and near-degenerate cases — that a fixed example set would miss.
 *
 * Setup/teardown: These are PURE, in-memory functions — no AWS SDK, no DynamoDB, no
 * child processes, no mocks. `numRuns: 100` is safe here (the loop-prevention guidance
 * about limiting iterations applies only to tests that spawn child processes).
 *
 * Generators are constrained to finite, non-NaN 32-bit floats in a bounded range with
 * modest lengths so the invariants are tested on the real embedding input space without
 * NaN/Infinity-driven flakiness.
 *
 * Validates: Requirements 4.4 (cosine-similarity ranking) and 4.1 (the DynamoDB store's
 * on-item Float32 vector representation that ranking decodes).
 */

const fc = require('fast-check');

const {
  cosineSimilarity,
  encodeVector,
  decodeVector
} = require('../../nodejs/vector-store-dynamodb');

/**
 * Number of generated cases per property. These are pure in-memory checks (no child
 * processes), so the default coverage-oriented 100 runs is appropriate.
 * @constant {number}
 */
const NUM_RUNS = 100;

/**
 * A single finite, non-NaN 32-bit-float vector component in a bounded range. Bounding
 * the magnitude keeps sums-of-squares well within Float64 range so the invariants are
 * exercised without Infinity/NaN noise.
 * @type {import('fast-check').Arbitrary<number>}
 */
const component = fc.float({ min: -100, max: 100, noNaN: true });

/**
 * A non-empty vector of bounded length (1..64) of finite components.
 * @type {import('fast-check').Arbitrary<number[]>}
 */
const vector = fc.array(component, { minLength: 1, maxLength: 64 });

/**
 * A pair of vectors guaranteed to share the same length (1..64), for the
 * equal-length invariants (bounded, symmetry).
 * @type {import('fast-check').Arbitrary<[number[], number[]]>}
 */
const equalLengthPair = fc.integer({ min: 1, max: 64 }).chain((len) =>
  fc.tuple(
    fc.array(component, { minLength: len, maxLength: len }),
    fc.array(component, { minLength: len, maxLength: len })
  )
);

/**
 * Euclidean norm of a vector (used to skip near-zero vectors where cosine is
 * intentionally 0 rather than ~1).
 *
 * @param {number[]} v - The vector.
 * @returns {number} The L2 norm.
 */
function norm(v) {
  return Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
}

describe('cosineSimilarity — ranking invariants (property) [Validates: Requirements 4.4]', () => {
  it('Property: is bounded within [-1, 1] for all equal-length vectors', () => {
    fc.assert(
      fc.property(equalLengthPair, ([a, b]) => {
        const score = cosineSimilarity(a, b);
        expect(score).toBeGreaterThanOrEqual(-1);
        expect(score).toBeLessThanOrEqual(1);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('Property: is symmetric — cosineSimilarity(a, b) === cosineSimilarity(b, a)', () => {
    fc.assert(
      fc.property(equalLengthPair, ([a, b]) => {
        // The math is commutative, so equality is exact (same float operations).
        expect(cosineSimilarity(a, b)).toBe(cosineSimilarity(b, a));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('Property: self-similarity of a non-degenerate vector is ~1', () => {
    fc.assert(
      fc.property(vector, (a) => {
        // Skip (near-)zero vectors: their cosine is defined as 0, not 1.
        fc.pre(norm(a) > 1e-3);
        expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('Property: is scale-invariant — cosineSimilarity(a, k*a) is ~1 for positive k', () => {
    fc.assert(
      // fast-check requires 32-bit-float-representable bounds; Math.fround guarantees it.
      fc.property(vector, fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }), (a, k) => {
        fc.pre(norm(a) > 1e-3);
        const scaled = a.map((x) => x * k);
        // Guard against any overflow to Infinity from the scaling.
        fc.pre(scaled.every((x) => Number.isFinite(x)));
        expect(cosineSimilarity(a, scaled)).toBeCloseTo(1, 5);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('Property: a zero vector yields exactly 0 against any same-length vector', () => {
    fc.assert(
      fc.property(vector, (b) => {
        const zeros = new Array(b.length).fill(0);
        expect(cosineSimilarity(zeros, b)).toBe(0);
        expect(cosineSimilarity(b, zeros)).toBe(0);
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('Property: mismatched-length vectors yield exactly 0', () => {
    fc.assert(
      fc.property(
        fc.array(component, { minLength: 1, maxLength: 32 }),
        fc.array(component, { minLength: 1, maxLength: 32 }),
        (a, b) => {
          fc.pre(a.length !== b.length);
          expect(cosineSimilarity(a, b)).toBe(0);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});

describe('encodeVector/decodeVector — Float32 codec invariants (property) [Validates: Requirements 4.1]', () => {
  it('Property: decodeVector(encodeVector(v), v.length) round-trips at Float32 precision', () => {
    fc.assert(
      fc.property(vector, (v) => {
        const decoded = decodeVector(encodeVector(v), v.length);
        expect(decoded).toHaveLength(v.length);
        for (let i = 0; i < v.length; i++) {
          // The codec stores/loads little-endian Float32, so each element equals the
          // Float32 rounding of the input — exact, at any magnitude.
          expect(decoded[i]).toBe(Math.fround(v[i]));
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it('Property: decodeVector is bounded by dims (a smaller dims returns exactly that many floats)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 64 }).chain((len) =>
          fc.tuple(
            fc.array(component, { minLength: len, maxLength: len }),
            fc.integer({ min: 1, max: len })
          )
        ),
        ([v, dims]) => {
          const decoded = decodeVector(encodeVector(v), dims);
          expect(decoded).toHaveLength(dims);
          for (let i = 0; i < dims; i++) {
            expect(decoded[i]).toBe(Math.fround(v[i]));
          }
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });
});
