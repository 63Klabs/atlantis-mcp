/**
 * Property-Based Tests for Rate Limiter
 *
 * Feature: 0-0-1-api-response-headers-return-NaN
 * Tests are added incrementally as tasks are completed.
 */

jest.mock('../../../config/settings', () => ({
  sessionHashSalt: { getValue: jest.fn() },
  dynamoDbSessionsTable: 'test-sessions-table',
  rateLimits: {
    public: { limitPerWindow: 50, windowInMinutes: 60 }
  }
}));

const fc = require('fast-check');
const { tools: { AWS, DebugAndLog } } = require('@63klabs/cache-data');
const settings = require('../../../config/settings');
const { checkRateLimit, createRateLimitResponse, TestHarness } = require('../../../utils/rate-limiter');
const { hashClientIdentifier, decrementInDynamo, fetchFromDynamo, createInDynamo, nextIntervalInMinutes, convertFromMinutesToMilli, cache } = TestHarness.getInternals();

describe('Property 2: Client identifier hash determinism and cross-window uniqueness', () => {

  test('same inputs always produce the same hash (determinism)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 100000000 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (rawId, windowStart, salt) => {
          const hash1 = hashClientIdentifier(rawId, windowStart, salt);
          const hash2 = hashClientIdentifier(rawId, windowStart, salt);
          return hash1 === hash2;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('different windowStart values produce different hashes (cross-window uniqueness)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 50000000 }),
        fc.integer({ min: 1, max: 50000000 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (rawId, windowStart1, offset, salt) => {
          const windowStart2 = windowStart1 + offset;
          const hash1 = hashClientIdentifier(rawId, windowStart1, salt);
          const hash2 = hashClientIdentifier(rawId, windowStart2, salt);
          return hash1 !== hash2;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('output is always a 64-character hex string', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }),
        fc.integer({ min: 0, max: 100000000 }),
        fc.string({ minLength: 0, maxLength: 100 }),
        (rawId, windowStart, salt) => {
          const hash = hashClientIdentifier(rawId, windowStart, salt);
          return /^[0-9a-f]{64}$/.test(hash);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/* ------------------------------------------------------------------ */
/*  Property 6: DynamoDB condition prevents remaining going below zero */
/*  Validates: Requirements 6.2                                       */
/* ------------------------------------------------------------------ */

describe('Property 6: DynamoDB condition prevents remaining from going below zero', () => {

  const mockUpdate = jest.fn();

  beforeEach(() => {
    jest.spyOn(AWS, 'dynamo', 'get').mockReturnValue({
      client: {},
      get: jest.fn(),
      put: jest.fn(),
      update: mockUpdate,
      delete: jest.fn(),
      scan: jest.fn(),
      sdk: {}
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('when remaining is 0, atomic update fails and returns allowed: false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.integer({ min: 1, max: 2000000000 }),
        fc.integer({ min: 1, max: 10000 }),
        async (pk, ttl, limitPerWindow) => {
          // Simulate ConditionalCheckFailedException (remaining was 0)
          const conditionalError = new Error('The conditional request failed');
          conditionalError.name = 'ConditionalCheckFailedException';
          mockUpdate.mockRejectedValueOnce(conditionalError);

          const result = await decrementInDynamo(pk, ttl, limitPerWindow);

          // Must return rate-limited state
          expect(result.remaining).toBe(0);
          expect(result.allowed).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('when remaining is positive, atomic update succeeds and returns allowed: true', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.integer({ min: 1, max: 2000000000 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 9999 }),
        async (pk, ttl, limitPerWindow, remaining) => {
          mockUpdate.mockResolvedValueOnce({
            Attributes: { pk, remaining: remaining - 1, limit: limitPerWindow }
          });

          const result = await decrementInDynamo(pk, ttl, limitPerWindow);

          expect(result.allowed).toBe(true);
          expect(typeof result.remaining).toBe('number');
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property 8: DynamoDB failure falls back to in-memory rate limiting */
/*  Validates: Requirements 8.1, 8.3                                  */
/* ------------------------------------------------------------------ */

describe('Property 8: DynamoDB failure falls back without throwing', () => {

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('fetchFromDynamo propagates errors (caller handles fallback)', async () => {
    const errorNames = [
      'ServiceUnavailableException',
      'ProvisionedThroughputExceededException',
      'InternalServerError',
      'RequestLimitExceeded',
      'NetworkingError'
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.constantFrom(...errorNames),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (pk, errorName, errorMessage) => {
          const dbError = new Error(errorMessage);
          dbError.name = errorName;

          const mockGet = jest.fn().mockRejectedValueOnce(dbError);
          jest.spyOn(AWS, 'dynamo', 'get').mockReturnValue({
            client: {},
            get: mockGet,
            put: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            scan: jest.fn(),
            sdk: {}
          });

          // fetchFromDynamo propagates the error — the caller (checkRateLimit)
          // is responsible for catching and falling back to in-memory
          await expect(fetchFromDynamo(pk)).rejects.toThrow();

          jest.restoreAllMocks();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('decrementInDynamo propagates non-conditional errors (caller handles fallback)', async () => {
    const errorNames = [
      'ServiceUnavailableException',
      'ProvisionedThroughputExceededException',
      'InternalServerError',
      'RequestLimitExceeded',
      'NetworkingError'
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.integer({ min: 1, max: 2000000000 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.constantFrom(...errorNames),
        async (pk, ttl, limitPerWindow, errorName) => {
          const dbError = new Error('DynamoDB failure');
          dbError.name = errorName;

          const mockUpdate = jest.fn().mockRejectedValueOnce(dbError);
          jest.spyOn(AWS, 'dynamo', 'get').mockReturnValue({
            client: {},
            get: jest.fn(),
            put: jest.fn(),
            update: mockUpdate,
            delete: jest.fn(),
            scan: jest.fn(),
            sdk: {}
          });

          // Non-conditional errors propagate — caller handles fallback
          await expect(decrementInDynamo(pk, ttl, limitPerWindow)).rejects.toThrow();

          jest.restoreAllMocks();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('createInDynamo propagates errors (caller handles fallback)', async () => {
    const errorNames = [
      'ServiceUnavailableException',
      'ProvisionedThroughputExceededException',
      'InternalServerError',
      'RequestLimitExceeded',
      'NetworkingError'
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 2000000000 }),
        fc.constantFrom(...errorNames),
        async (pk, limitPerWindow, ttl, errorName) => {
          const dbError = new Error('DynamoDB failure');
          dbError.name = errorName;

          const mockPut = jest.fn().mockRejectedValueOnce(dbError);
          jest.spyOn(AWS, 'dynamo', 'get').mockReturnValue({
            client: {},
            get: jest.fn(),
            put: mockPut,
            update: jest.fn(),
            delete: jest.fn(),
            scan: jest.fn(),
            sdk: {}
          });

          await expect(createInDynamo(pk, limitPerWindow, ttl)).rejects.toThrow();

          jest.restoreAllMocks();
        }
      ),
      { numRuns: 100 }
    );
  });
});


/* ------------------------------------------------------------------ */
/*  Property 1: Rate limit headers contain valid numeric values       */
/*  matching configuration                                            */
/*  Validates: Requirements 1.1, 1.2, 9.1, 9.2, 9.3                  */
/* ------------------------------------------------------------------ */

describe('Property 1: Rate limit headers contain valid numeric values matching configuration', () => {

  const mockGet = jest.fn();
  const mockUpdate = jest.fn();
  const mockPut = jest.fn();

  beforeEach(() => {
    cache.clear();
    jest.restoreAllMocks();
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockPut.mockReset();

    settings.sessionHashSalt.getValue.mockResolvedValue('test-salt-value');

    jest.spyOn(DebugAndLog, 'error').mockImplementation(() => {});
    jest.spyOn(DebugAndLog, 'warn').mockImplementation(() => {});

    jest.spyOn(AWS, 'dynamo', 'get').mockReturnValue({
      client: {},
      get: mockGet,
      put: mockPut,
      update: mockUpdate,
      delete: jest.fn(),
      scan: jest.fn(),
      sdk: {}
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('for any valid config and event, headers are valid numbers, Limit equals limitPerWindow, Remaining >= 0, Reset > now', async () => {
    const validWindows = [5, 15, 30, 60, 120, 240, 1440];

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.constantFrom(...validWindows),
        fc.string({ minLength: 1, maxLength: 39 }),
        async (limitPerWindow, windowInMinutes, sourceIp) => {
          cache.clear();
          mockGet.mockReset();
          mockPut.mockReset();

          // DynamoDB: no existing item, create new
          mockGet.mockResolvedValueOnce({});
          mockPut.mockResolvedValueOnce({});

          const event = {
            requestContext: { identity: { sourceIp } },
            headers: {}
          };
          const limits = {
            public: { limitPerWindow, windowInMinutes }
          };

          const result = await checkRateLimit(event, limits);
          const nowSec = Math.floor(Date.now() / 1000);

          // All headers are valid numbers, never NaN
          expect(Number(result.headers['X-RateLimit-Limit'])).not.toBeNaN();
          expect(Number(result.headers['X-RateLimit-Remaining'])).not.toBeNaN();
          expect(Number(result.headers['X-RateLimit-Reset'])).not.toBeNaN();

          // X-RateLimit-Limit equals limitPerWindow
          expect(result.headers['X-RateLimit-Limit']).toBe(String(limitPerWindow));

          // X-RateLimit-Remaining is non-negative
          expect(Number(result.headers['X-RateLimit-Remaining'])).toBeGreaterThanOrEqual(0);

          // X-RateLimit-Reset is a future timestamp
          expect(Number(result.headers['X-RateLimit-Reset'])).toBeGreaterThan(nowSec);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property 4: Cache hit returns last-known state within current     */
/*  window                                                            */
/*  Validates: Requirements 5.1                                       */
/* ------------------------------------------------------------------ */

describe('Property 4: Cache hit returns last-known state within current window', () => {

  const mockGet = jest.fn();
  const mockUpdate = jest.fn();
  const mockPut = jest.fn();

  beforeEach(() => {
    cache.clear();
    jest.restoreAllMocks();
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockPut.mockReset();

    settings.sessionHashSalt.getValue.mockResolvedValue('test-salt-value');

    jest.spyOn(DebugAndLog, 'error').mockImplementation(() => {});
    jest.spyOn(DebugAndLog, 'warn').mockImplementation(() => {});

    jest.spyOn(AWS, 'dynamo', 'get').mockReturnValue({
      client: {},
      get: mockGet,
      put: mockPut,
      update: mockUpdate,
      delete: jest.fn(),
      scan: jest.fn(),
      sdk: {}
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('for any non-expired cache entry in current window, checkRateLimit returns without calling DynamoDB get', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10000 }),
        fc.string({ minLength: 1, maxLength: 39 }),
        async (limitPerWindow, sourceIp) => {
          cache.clear();
          mockGet.mockReset();
          mockUpdate.mockReset();
          mockPut.mockReset();

          const windowInMinutes = 60;
          const salt = 'test-salt-value';

          // Compute current window boundaries (same logic as checkRateLimit)
          const resetTimeMinutes = nextIntervalInMinutes(windowInMinutes);
          const windowStartMinutes = resetTimeMinutes - windowInMinutes;
          const resetTimeMs = convertFromMinutesToMilli(resetTimeMinutes);

          // Hash the client identifier with the current window
          const pk = hashClientIdentifier(sourceIp, windowStartMinutes, salt);

          // Pre-populate cache with a valid entry for the CURRENT window
          const cachedRemaining = Math.max(1, limitPerWindow - 1);
          cache.set(pk, {
            remaining: cachedRemaining,
            limit: limitPerWindow,
            resetTimeMinutes,
            tier: 'public',
            windowStart: windowStartMinutes
          }, resetTimeMs);

          // Mock update for background sync (cache hit triggers background decrement)
          mockUpdate.mockResolvedValue({
            Attributes: { pk, remaining: cachedRemaining - 1, limit: limitPerWindow }
          });

          const event = {
            requestContext: { identity: { sourceIp } },
            headers: {}
          };
          const limits = {
            public: { limitPerWindow, windowInMinutes }
          };

          const result = await checkRateLimit(event, limits);

          // mockGet (fetchFromDynamo) should NOT have been called — cache hit path
          expect(mockGet).not.toHaveBeenCalled();

          // Should return valid result
          expect(result.allowed).toBe(true);
          expect(Number(result.headers['X-RateLimit-Remaining'])).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property 7: Window transition returns fresh state with full       */
/*  remaining count                                                   */
/*  Validates: Requirements 7.1                                       */
/* ------------------------------------------------------------------ */

describe('Property 7: Window transition returns fresh state with full remaining count', () => {

  const mockGet = jest.fn();
  const mockUpdate = jest.fn();
  const mockPut = jest.fn();

  beforeEach(() => {
    cache.clear();
    jest.restoreAllMocks();
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockPut.mockReset();

    settings.sessionHashSalt.getValue.mockResolvedValue('test-salt-value');

    jest.spyOn(DebugAndLog, 'error').mockImplementation(() => {});
    jest.spyOn(DebugAndLog, 'warn').mockImplementation(() => {});

    jest.spyOn(AWS, 'dynamo', 'get').mockReturnValue({
      client: {},
      get: mockGet,
      put: mockPut,
      update: mockUpdate,
      delete: jest.fn(),
      scan: jest.fn(),
      sdk: {}
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('for any cache entry from a previous window (windowStart=0), checkRateLimit returns remaining = limitPerWindow - 1', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10000 }),
        fc.string({ minLength: 1, maxLength: 39 }),
        async (limitPerWindow, sourceIp) => {
          cache.clear();
          mockGet.mockReset();
          mockPut.mockReset();

          const windowInMinutes = 60;
          const salt = 'test-salt-value';

          // Pre-populate cache with an entry from a PAST window (windowStart=0)
          const pastWindowStart = 0;
          const pastPk = hashClientIdentifier(sourceIp, pastWindowStart, salt);

          cache.set(pastPk, {
            remaining: 5,
            limit: limitPerWindow,
            resetTimeMinutes: 1,
            tier: 'public',
            windowStart: pastWindowStart
          }, Date.now() + 60000); // not expired in cache terms

          // DynamoDB will be called because window mismatch (cache miss for current window key)
          mockGet.mockResolvedValueOnce({}); // no item for new window
          mockPut.mockResolvedValueOnce({}); // createInDynamo succeeds

          const event = {
            requestContext: { identity: { sourceIp } },
            headers: {}
          };
          const limits = {
            public: { limitPerWindow, windowInMinutes }
          };

          const result = await checkRateLimit(event, limits);

          // Should get fresh state: remaining = limitPerWindow - 1 (from createInDynamo)
          expect(result.allowed).toBe(true);
          expect(result.headers['X-RateLimit-Remaining']).toBe(String(limitPerWindow - 1));
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property 9: Rate limit exceeded returns 429 with Retry-After      */
/*  Validates: Requirements 9.4, 9.5                                  */
/* ------------------------------------------------------------------ */

describe('Property 9: Rate limit exceeded returns 429 with Retry-After', () => {

  const mockGet = jest.fn();
  const mockUpdate = jest.fn();
  const mockPut = jest.fn();

  beforeEach(() => {
    cache.clear();
    jest.restoreAllMocks();
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockPut.mockReset();

    settings.sessionHashSalt.getValue.mockResolvedValue('test-salt-value');

    jest.spyOn(DebugAndLog, 'error').mockImplementation(() => {});
    jest.spyOn(DebugAndLog, 'warn').mockImplementation(() => {});

    jest.spyOn(AWS, 'dynamo', 'get').mockReturnValue({
      client: {},
      get: mockGet,
      put: mockPut,
      update: mockUpdate,
      delete: jest.fn(),
      scan: jest.fn(),
      sdk: {}
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('for any exhausted client, checkRateLimit returns allowed: false and createRateLimitResponse produces 429 with positive Retry-After', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10000 }),
        fc.constantFrom(5, 15, 30, 60, 120, 240, 1440),
        fc.string({ minLength: 1, maxLength: 39 }),
        async (limitPerWindow, windowInMinutes, sourceIp) => {
          cache.clear();
          mockGet.mockReset();
          mockUpdate.mockReset();

          // DynamoDB: existing item with remaining=1
          mockGet.mockResolvedValueOnce({
            Item: { pk: 'some-pk', remaining: 1, limit: limitPerWindow, ttl: 9999999999 }
          });

          // decrementInDynamo: ConditionalCheckFailedException (remaining hit 0)
          const conditionalError = new Error('The conditional request failed');
          conditionalError.name = 'ConditionalCheckFailedException';
          mockUpdate.mockRejectedValueOnce(conditionalError);

          const event = {
            requestContext: { identity: { sourceIp } },
            headers: {}
          };
          const limits = {
            public: { limitPerWindow, windowInMinutes }
          };

          const result = await checkRateLimit(event, limits);

          // checkRateLimit should return allowed: false
          expect(result.allowed).toBe(false);
          expect(result.headers['Retry-After']).toBeDefined();
          expect(Number(result.headers['Retry-After'])).toBeGreaterThan(0);

          // createRateLimitResponse should produce 429
          const response = createRateLimitResponse(result.headers, result.retryAfter);
          expect(response.statusCode).toBe(429);
          expect(response.headers['Retry-After']).toBeDefined();
          expect(Number(response.headers['Retry-After'])).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
