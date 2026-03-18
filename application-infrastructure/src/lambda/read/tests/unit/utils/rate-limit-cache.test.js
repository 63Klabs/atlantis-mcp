/**
 * Unit Tests for RateLimitCache
 *
 * Tests the LRU in-memory cache for rate limit state including
 * get/set, LRU eviction, expiration, cleanup, and info.
 *
 * Feature: 0-0-1-api-response-headers-return-NaN
 * Requirements: 5.4, 5.5, 12.3
 */

const { TestHarness } = require('../../../utils/rate-limiter');
const { RateLimitCache } = TestHarness.getInternals();

describe('RateLimitCache', () => {
  let cache;

  beforeEach(() => {
    cache = new RateLimitCache({ maxEntries: 3 });
  });

  describe('constructor', () => {
    test('uses explicit maxEntries when provided', () => {
      const c = new RateLimitCache({ maxEntries: 50 });
      expect(c.info().maxEntries).toBe(50);
    });

    test('uses defaultMaxEntries when no memory info available', () => {
      const originalMem = process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      const c = new RateLimitCache({});
      expect(c.info().maxEntries).toBe(1000);
      if (originalMem !== undefined) {
        process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = originalMem;
      }
    });

    test('calculates maxEntries from Lambda memory when available', () => {
      const originalMem = process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = '1024';
      const c = new RateLimitCache({});
      // 1024MB / 1024 * 5000 = 5000
      expect(c.info().maxEntries).toBe(5000);
      expect(c.info().memoryMB).toBe(1024);
      if (originalMem !== undefined) {
        process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = originalMem;
      } else {
        delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      }
    });

    test('enforces minimum maxEntries of 1', () => {
      const c = new RateLimitCache({ maxEntries: 0 });
      expect(c.info().maxEntries).toBe(1);
    });
  });

  describe('get', () => {
    test('returns cache: 0 for missing key', () => {
      const result = cache.get('nonexistent');
      expect(result).toEqual({ cache: 0, data: null });
    });

    test('returns cache: 1 for valid entry', () => {
      cache.set('key1', { remaining: 10 }, Date.now() + 60000);
      const result = cache.get('key1');
      expect(result.cache).toBe(1);
      expect(result.data).toEqual({ remaining: 10 });
    });

    test('returns cache: -1 for expired entry and removes it', () => {
      cache.set('key1', { remaining: 5 }, Date.now() - 1000);
      const result = cache.get('key1');
      expect(result.cache).toBe(-1);
      expect(result.data).toEqual({ remaining: 5 });
      // Entry should be removed
      expect(cache.get('key1').cache).toBe(0);
    });
  });

  describe('set', () => {
    test('stores and retrieves a value', () => {
      cache.set('key1', { remaining: 10 }, Date.now() + 60000);
      expect(cache.get('key1').data).toEqual({ remaining: 10 });
    });

    test('overwrites existing key', () => {
      cache.set('key1', { remaining: 10 }, Date.now() + 60000);
      cache.set('key1', { remaining: 5 }, Date.now() + 60000);
      expect(cache.get('key1').data).toEqual({ remaining: 5 });
      expect(cache.info().size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    test('evicts oldest entry when at capacity', () => {
      cache.set('a', { v: 1 }, Date.now() + 60000);
      cache.set('b', { v: 2 }, Date.now() + 60000);
      cache.set('c', { v: 3 }, Date.now() + 60000);
      // Cache is full (3 entries, maxEntries=3)
      cache.set('d', { v: 4 }, Date.now() + 60000);
      // 'a' should be evicted
      expect(cache.get('a').cache).toBe(0);
      expect(cache.get('d').data).toEqual({ v: 4 });
      expect(cache.info().size).toBe(3);
    });

    test('accessing an entry moves it to most-recently-used', () => {
      cache.set('a', { v: 1 }, Date.now() + 60000);
      cache.set('b', { v: 2 }, Date.now() + 60000);
      cache.set('c', { v: 3 }, Date.now() + 60000);
      // Access 'a' to make it most recently used
      cache.get('a');
      // Add new entry — 'b' should be evicted (oldest after 'a' was accessed)
      cache.set('d', { v: 4 }, Date.now() + 60000);
      expect(cache.get('b').cache).toBe(0);
      expect(cache.get('a').cache).toBe(1);
    });

    test('never exceeds maxEntries', () => {
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, { v: i }, Date.now() + 60000);
      }
      expect(cache.info().size).toBeLessThanOrEqual(3);
    });
  });

  describe('cleanup', () => {
    test('removes all expired entries', () => {
      cache.set('expired1', { v: 1 }, Date.now() - 1000);
      cache.set('expired2', { v: 2 }, Date.now() - 500);
      cache.set('valid', { v: 3 }, Date.now() + 60000);
      cache.cleanup();
      expect(cache.info().size).toBe(1);
      expect(cache.get('valid').cache).toBe(1);
    });

    test('does nothing when no entries are expired', () => {
      cache.set('a', { v: 1 }, Date.now() + 60000);
      cache.set('b', { v: 2 }, Date.now() + 60000);
      cache.cleanup();
      expect(cache.info().size).toBe(2);
    });

    test('handles empty cache', () => {
      cache.cleanup();
      expect(cache.info().size).toBe(0);
    });
  });

  describe('clear', () => {
    test('removes all entries', () => {
      cache.set('a', { v: 1 }, Date.now() + 60000);
      cache.set('b', { v: 2 }, Date.now() + 60000);
      cache.clear();
      expect(cache.info().size).toBe(0);
    });
  });

  describe('info', () => {
    test('returns correct size and maxEntries', () => {
      cache.set('a', { v: 1 }, Date.now() + 60000);
      const info = cache.info();
      expect(info.size).toBe(1);
      expect(info.maxEntries).toBe(3);
    });

    test('memoryMB is null when explicit maxEntries provided', () => {
      expect(cache.info().memoryMB).toBeNull();
    });
  });
});
