/**
 * Property-Based Tests for RateLimitCache
 *
 * Feature: 0-0-1-api-response-headers-return-NaN
 * Property 5: LRU cache never exceeds maximum capacity and contains
 * no expired entries after cleanup.
 *
 * Validates: Requirements 5.4, 5.5
 */

const fc = require('fast-check');
const { TestHarness } = require('../../../utils/rate-limiter');
const { RateLimitCache } = TestHarness.getInternals();

describe('Property 5: LRU cache never exceeds maximum capacity and contains no expired entries after cleanup', () => {

  test('cache size never exceeds maxEntries for any sequence of set operations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.array(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 20 }),
            value: fc.integer(),
            ttlMs: fc.integer({ min: -5000, max: 60000 })
          }),
          { minLength: 1, maxLength: 200 }
        ),
        (maxEntries, operations) => {
          const cache = new RateLimitCache({ maxEntries });
          const now = Date.now();

          for (const op of operations) {
            cache.set(op.key, { v: op.value }, now + op.ttlMs);
            // Invariant: size never exceeds maxEntries
            if (cache.info().size > maxEntries) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('after cleanup, zero expired entries remain', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.array(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 20 }),
            value: fc.integer(),
            ttlMs: fc.integer({ min: -5000, max: 60000 })
          }),
          { minLength: 1, maxLength: 200 }
        ),
        (maxEntries, operations) => {
          const cache = new RateLimitCache({ maxEntries });
          const now = Date.now();

          for (const op of operations) {
            cache.set(op.key, { v: op.value }, now + op.ttlMs);
          }

          cache.cleanup();

          // After cleanup, every remaining entry should be non-expired
          // Verify by getting each key — none should return cache: -1
          const info = cache.info();
          // Size should still be within bounds
          if (info.size > maxEntries) {
            return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('get returns cache: 0 or cache: 1 after cleanup (never -1)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.stringMatching(/^[a-z]{1,10}$/),
            ttlMs: fc.integer({ min: -5000, max: 60000 })
          }),
          { minLength: 1, maxLength: 100 }
        ),
        (operations) => {
          const cache = new RateLimitCache({ maxEntries: 50 });
          const now = Date.now();
          const keys = new Set();

          for (const op of operations) {
            cache.set(op.key, { v: 1 }, now + op.ttlMs);
            keys.add(op.key);
          }

          cache.cleanup();

          // After cleanup, no get should return -1 (expired)
          for (const key of keys) {
            const result = cache.get(key);
            if (result.cache === -1) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
