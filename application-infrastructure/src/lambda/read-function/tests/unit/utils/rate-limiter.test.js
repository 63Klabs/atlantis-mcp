/**
 * Unit Tests for Rate Limiter
 *
 * Tests client identifier hashing, DynamoDB operations, and checkRateLimit.
 * Tests are added incrementally as tasks are completed.
 *
 * Feature: 0-0-1-api-response-headers-return-NaN
 */

jest.mock('../../../config/settings', () => ({
  sessionHashSalt: { getValue: jest.fn() },
  dynamoDbSessionsTable: 'test-sessions-table',
  rateLimits: {
    public: { limitPerWindow: 50, windowInMinutes: 60 }
  }
}));

const { tools: { AWS, DebugAndLog } } = require('@63klabs/cache-data');
const settings = require('../../../config/settings');
const { checkRateLimit, TestHarness } = require('../../../utils/rate-limiter');
const { hashClientIdentifier, fetchFromDynamo, decrementInDynamo, createInDynamo, cache } = TestHarness.getInternals();

describe('hashClientIdentifier', () => {

  const salt = 'test-secret-salt-value';

  test('produces a 64-character hex string (SHA-256)', () => {
    const hash = hashClientIdentifier('192.168.1.1', 29340, salt);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic — same inputs produce same hash', () => {
    const hash1 = hashClientIdentifier('192.168.1.1', 29340, salt);
    const hash2 = hashClientIdentifier('192.168.1.1', 29340, salt);
    expect(hash1).toBe(hash2);
  });

  test('different windows produce different hashes for same client', () => {
    const hash1 = hashClientIdentifier('192.168.1.1', 29340, salt);
    const hash2 = hashClientIdentifier('192.168.1.1', 29345, salt);
    expect(hash1).not.toBe(hash2);
  });

  test('different clients produce different hashes in same window', () => {
    const hash1 = hashClientIdentifier('192.168.1.1', 29340, salt);
    const hash2 = hashClientIdentifier('192.168.1.2', 29340, salt);
    expect(hash1).not.toBe(hash2);
  });

  test('different salts produce different hashes', () => {
    const hash1 = hashClientIdentifier('192.168.1.1', 29340, 'salt-a');
    const hash2 = hashClientIdentifier('192.168.1.1', 29340, 'salt-b');
    expect(hash1).not.toBe(hash2);
  });

  test('works with sourceIp for public tier', () => {
    const hash = hashClientIdentifier('10.0.0.1', 29340, salt);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('works with userId for authenticated tier', () => {
    const hash = hashClientIdentifier('user-abc-123', 29340, salt);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});


/* ------------------------------------------------------------------ */
/*  DynamoDB Operations Tests                                         */
/*  Requirements: 6.1, 6.2, 6.3, 8.1, 8.2, 12.4, 12.5               */
/* ------------------------------------------------------------------ */

describe('DynamoDB operations', () => {

  const mockGet = jest.fn();
  const mockUpdate = jest.fn();
  const mockPut = jest.fn();

  beforeEach(() => {
    // Spy on the dynamo getter to return our mock object
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

  // ---- fetchFromDynamo ----

  describe('fetchFromDynamo', () => {

    test('returns item when found', async () => {
      const item = { pk: 'abc123', remaining: 42, limit: 50, ttl: 1700000000 };
      mockGet.mockResolvedValueOnce({ Item: item });

      const result = await fetchFromDynamo('abc123');

      expect(result).toEqual(item);
      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { pk: 'abc123' }
        })
      );
    });

    test('returns null when item not found', async () => {
      mockGet.mockResolvedValueOnce({});

      const result = await fetchFromDynamo('nonexistent-pk');

      expect(result).toBeNull();
    });

    test('propagates DynamoDB errors', async () => {
      const dbError = new Error('DynamoDB service unavailable');
      dbError.name = 'ServiceUnavailableException';
      mockGet.mockRejectedValueOnce(dbError);

      await expect(fetchFromDynamo('abc123')).rejects.toThrow('DynamoDB service unavailable');
    });
  });

  // ---- decrementInDynamo ----

  describe('decrementInDynamo', () => {

    test('returns updated remaining count on success', async () => {
      mockUpdate.mockResolvedValueOnce({
        Attributes: { pk: 'abc123', remaining: 9, limit: 50 }
      });

      const result = await decrementInDynamo('abc123', 1700000000, 50);

      expect(result).toEqual({ remaining: 9, allowed: true });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { pk: 'abc123' },
          UpdateExpression: 'SET remaining = remaining - :dec',
          ConditionExpression: 'remaining > :zero',
          ExpressionAttributeValues: { ':dec': 1, ':zero': 0 },
          ReturnValues: 'ALL_NEW'
        })
      );
    });

    test('returns rate-limited state on ConditionalCheckFailedException', async () => {
      const conditionalError = new Error('The conditional request failed');
      conditionalError.name = 'ConditionalCheckFailedException';
      mockUpdate.mockRejectedValueOnce(conditionalError);

      const result = await decrementInDynamo('abc123', 1700000000, 50);

      expect(result).toEqual({ remaining: 0, allowed: false });
    });

    test('propagates other DynamoDB errors', async () => {
      const dbError = new Error('Throughput exceeded');
      dbError.name = 'ProvisionedThroughputExceededException';
      mockUpdate.mockRejectedValueOnce(dbError);

      await expect(decrementInDynamo('abc123', 1700000000, 50)).rejects.toThrow('Throughput exceeded');
    });

    test('uses correct update expression and condition expression', async () => {
      mockUpdate.mockResolvedValueOnce({
        Attributes: { pk: 'pk-val', remaining: 24, limit: 100 }
      });

      await decrementInDynamo('pk-val', 1700005000, 100);

      const callArgs = mockUpdate.mock.calls[0][0];
      expect(callArgs.UpdateExpression).toBe('SET remaining = remaining - :dec');
      expect(callArgs.ConditionExpression).toBe('remaining > :zero');
      expect(callArgs.ExpressionAttributeValues[':dec']).toBe(1);
      expect(callArgs.ExpressionAttributeValues[':zero']).toBe(0);
    });
  });

  // ---- createInDynamo ----

  describe('createInDynamo', () => {

    test('creates entry with correct attributes', async () => {
      mockPut.mockResolvedValueOnce({});

      await createInDynamo('new-pk', 50, 1700000000);

      expect(mockPut).toHaveBeenCalledWith(
        expect.objectContaining({
          Item: expect.objectContaining({
            pk: 'new-pk',
            remaining: 49,
            limit: 50,
            ttl: 1700000000
          })
        })
      );
    });

    test('returns remaining = limitPerWindow - 1 and allowed = true', async () => {
      mockPut.mockResolvedValueOnce({});

      const result = await createInDynamo('new-pk', 100, 1700000000);

      expect(result).toEqual({ remaining: 99, allowed: true });
    });

    test('PutItem parameters include pk, remaining, limit, and ttl', async () => {
      mockPut.mockResolvedValueOnce({});

      await createInDynamo('pk-check', 3000, 1700099999);

      const lastCall = mockPut.mock.calls[mockPut.mock.calls.length - 1][0];
      expect(lastCall.Item).toHaveProperty('pk', 'pk-check');
      expect(lastCall.Item).toHaveProperty('remaining', 2999);
      expect(lastCall.Item).toHaveProperty('limit', 3000);
      expect(lastCall.Item).toHaveProperty('ttl', 1700099999);
    });
  });
});


/* ------------------------------------------------------------------ */
/*  checkRateLimit Tests                                              */
/*  Requirements: 1.1, 1.2, 9.1, 9.2, 9.3, 12.1                     */
/* ------------------------------------------------------------------ */

describe('checkRateLimit', () => {

  const mockGet = jest.fn();
  const mockUpdate = jest.fn();
  const mockPut = jest.fn();

  const mockEvent = {
    requestContext: {
      identity: { sourceIp: '192.168.1.100' }
    },
    headers: {}
  };

  const mockLimits = {
    public: { limitPerWindow: 50, windowInMinutes: 60 }
  };

  beforeEach(() => {
    cache.clear();
    jest.restoreAllMocks();

    mockGet.mockReset();
    mockUpdate.mockReset();
    mockPut.mockReset();

    jest.spyOn(AWS, 'dynamo', 'get').mockReturnValue({
      client: {},
      get: mockGet,
      put: mockPut,
      update: mockUpdate,
      delete: jest.fn(),
      scan: jest.fn(),
      sdk: {}
    });

    jest.spyOn(DebugAndLog, 'error').mockImplementation(() => {});
    jest.spyOn(DebugAndLog, 'warn').mockImplementation(() => {});

    // Default: salt is available
    settings.sessionHashSalt.getValue.mockResolvedValue('test-salt-value');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---- Headers are NOT NaN (the original bug fix) ----

  test('headers are valid numbers, never NaN (Requirement 1.1, 1.2)', async () => {
    mockGet.mockResolvedValueOnce({});
    mockPut.mockResolvedValueOnce({});

    const result = await checkRateLimit(mockEvent, mockLimits);

    expect(Number(result.headers['X-RateLimit-Limit'])).not.toBeNaN();
    expect(Number(result.headers['X-RateLimit-Remaining'])).not.toBeNaN();
    expect(Number(result.headers['X-RateLimit-Reset'])).not.toBeNaN();
  });

  // ---- X-RateLimit-Limit equals limitPerWindow ----

  test('X-RateLimit-Limit equals limitPerWindow (Requirement 9.1)', async () => {
    mockGet.mockResolvedValueOnce({});
    mockPut.mockResolvedValueOnce({});

    const result = await checkRateLimit(mockEvent, mockLimits);

    expect(result.headers['X-RateLimit-Limit']).toBe('50');
  });

  // ---- X-RateLimit-Remaining is non-negative integer ----

  test('X-RateLimit-Remaining is a non-negative integer (Requirement 9.2)', async () => {
    mockGet.mockResolvedValueOnce({});
    mockPut.mockResolvedValueOnce({});

    const result = await checkRateLimit(mockEvent, mockLimits);

    const remaining = Number(result.headers['X-RateLimit-Remaining']);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(remaining)).toBe(true);
  });

  // ---- X-RateLimit-Reset is valid future Unix timestamp ----

  test('X-RateLimit-Reset is a valid future Unix timestamp (Requirement 9.3)', async () => {
    mockGet.mockResolvedValueOnce({});
    mockPut.mockResolvedValueOnce({});

    const result = await checkRateLimit(mockEvent, mockLimits);

    const resetSec = Number(result.headers['X-RateLimit-Reset']);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(resetSec).toBeGreaterThan(nowSec);
  });

  // ---- Cache hit returns cached state without awaiting DynamoDB ----

  test('cache hit returns cached state without awaiting DynamoDB (Requirement 5.1)', async () => {
    // First call to populate cache via DynamoDB path
    mockGet.mockResolvedValueOnce({});
    mockPut.mockResolvedValueOnce({});
    await checkRateLimit(mockEvent, mockLimits);

    // Reset DynamoDB mocks to track second call
    mockGet.mockReset();
    mockPut.mockReset();
    // decrementInDynamo is called in background on cache hit — mock it
    mockUpdate.mockResolvedValue({
      Attributes: { pk: 'x', remaining: 47, limit: 50 }
    });

    const result = await checkRateLimit(mockEvent, mockLimits);

    // Should return valid result from cache
    expect(result.allowed).toBe(true);
    expect(Number(result.headers['X-RateLimit-Remaining'])).toBeGreaterThanOrEqual(0);
    // fetchFromDynamo (mockGet) should NOT have been called on cache hit
    expect(mockGet).not.toHaveBeenCalled();
  });

  // ---- Window transition returns fresh state with full remaining ----

  test('window transition returns fresh state (Requirement 7.1)', async () => {
    const { convertFromMinutesToMilli, nextIntervalInMinutes } = TestHarness.getInternals();

    // Pre-populate cache with an entry from a past window
    const salt = 'test-salt-value';
    const pastWindowStart = 0; // epoch — definitely a past window
    const pk = hashClientIdentifier('192.168.1.100', pastWindowStart, salt);

    cache.set(pk, {
      remaining: 10,
      limit: 50,
      resetTimeMinutes: 1, // past
      tier: 'public',
      windowStart: pastWindowStart
    }, Date.now() + 60000); // not expired in cache terms

    // DynamoDB will be called because window mismatch
    mockGet.mockResolvedValueOnce({});
    mockPut.mockResolvedValueOnce({});

    const result = await checkRateLimit(mockEvent, mockLimits);

    // Should get fresh state, not the stale remaining=10
    expect(result.allowed).toBe(true);
    // remaining should be limitPerWindow - 1 (49) from createInDynamo
    expect(result.headers['X-RateLimit-Remaining']).toBe('49');
  });

  // ---- DynamoDB fallback on error ----

  test('falls back to in-memory on DynamoDB error (Requirement 8.1)', async () => {
    const dbError = new Error('Service unavailable');
    dbError.name = 'ServiceUnavailableException';
    mockGet.mockRejectedValueOnce(dbError);

    const result = await checkRateLimit(mockEvent, mockLimits);

    // Should still return a valid response, not throw
    expect(result.allowed).toBe(true);
    expect(Number(result.headers['X-RateLimit-Limit'])).not.toBeNaN();
    expect(Number(result.headers['X-RateLimit-Remaining'])).toBeGreaterThanOrEqual(0);
    expect(Number(result.headers['X-RateLimit-Reset'])).toBeGreaterThan(0);
    expect(DebugAndLog.warn).toHaveBeenCalled();
  });

  // ---- Hash salt unavailable fails closed ----

  test('fails closed when hash salt is unavailable (Requirement 11.3)', async () => {
    settings.sessionHashSalt.getValue.mockResolvedValue(null);

    const result = await checkRateLimit(mockEvent, mockLimits);

    expect(result.allowed).toBe(false);
    expect(result.headers['X-RateLimit-Limit']).toBe('50');
    expect(result.headers['X-RateLimit-Remaining']).toBe('0');
    expect(result.headers['Retry-After']).toBeDefined();
    expect(Number(result.headers['Retry-After'])).toBeGreaterThan(0);
    expect(DebugAndLog.error).toHaveBeenCalled();
  });

  test('fails closed when hash salt retrieval throws (Requirement 11.3)', async () => {
    settings.sessionHashSalt.getValue.mockRejectedValue(new Error('SSM timeout'));

    const result = await checkRateLimit(mockEvent, mockLimits);

    expect(result.allowed).toBe(false);
    expect(result.headers['Retry-After']).toBeDefined();
    expect(DebugAndLog.error).toHaveBeenCalled();
  });
});
