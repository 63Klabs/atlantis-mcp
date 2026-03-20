/**
 * Preservation Property Test — Non-X-Forwarded-For Behavior Unchanged
 *
 * Property 2: Preservation — events where X-Forwarded-For is absent or
 * empty MUST continue to behave identically after the fix is applied.
 *
 * Spec: 0-0-1-fix-rate-limiter-client-ip-resolution
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * IMPORTANT: These tests are written using observation-first methodology.
 * They are run on UNFIXED code first to confirm baseline behavior, then
 * re-run after the fix to confirm no regressions.
 *
 * EXPECTED OUTCOME: Tests PASS on both unfixed and fixed code.
 */

jest.mock('../../../config/settings', () => ({
  sessionHashSalt: { getValue: jest.fn() },
  dynamoDbSessionsTable: 'test-sessions-table',
  rateLimits: {
    public: { limitPerWindow: 50, windowInMinutes: 60 }
  }
}));

const crypto = require('crypto');
const fc = require('fast-check');
const { tools: { AWS, DebugAndLog } } = require('@63klabs/cache-data');
const settings = require('../../../config/settings');
const { checkRateLimit, TestHarness } = require('../../../utils/rate-limiter');
const {
  hashClientIdentifier,
  nextIntervalInMinutes,
  cache
} = TestHarness.getInternals();

/* ------------------------------------------------------------------ */
/*  Shared helpers and setup                                          */
/* ------------------------------------------------------------------ */

/** Standard limits used across all tests in this file. */
const LIMITS = { public: { limitPerWindow: 50, windowInMinutes: 60 } };

/** Salt value returned by the mocked SSM parameter. */
const TEST_SALT = 'preservation-test-salt';

/**
 * Build a minimal API Gateway event with only sourceIp (no X-Forwarded-For).
 *
 * @param {string} sourceIp - The source IP address
 * @returns {Object} API Gateway event stub
 */
function buildSourceIpOnlyEvent(sourceIp) {
  return {
    requestContext: { identity: { sourceIp } },
    headers: {}
  };
}

/**
 * Build an event with neither sourceIp nor X-Forwarded-For.
 *
 * @returns {Object} API Gateway event stub
 */
function buildNoIpEvent() {
  return {
    requestContext: { identity: {} },
    headers: {}
  };
}

/**
 * Build an event with an empty or whitespace-only X-Forwarded-For and a sourceIp.
 *
 * @param {string} sourceIp - The source IP address
 * @param {string} xForwardedFor - Empty or whitespace-only string
 * @returns {Object} API Gateway event stub
 */
function buildEmptyXffEvent(sourceIp, xForwardedFor) {
  return {
    requestContext: { identity: { sourceIp } },
    headers: { 'X-Forwarded-For': xForwardedFor }
  };
}

/**
 * Compute the expected DynamoDB partition key for a given rawId.
 *
 * @param {string} rawId - The client identifier
 * @returns {string} SHA-256 hex hash
 */
function expectedPk(rawId) {
  const windowInMinutes = LIMITS.public.windowInMinutes;
  const resetTimeMinutes = nextIntervalInMinutes(windowInMinutes);
  const windowStartMinutes = resetTimeMinutes - windowInMinutes;
  return hashClientIdentifier(rawId, windowStartMinutes, TEST_SALT);
}

/**
 * fast-check arbitrary that generates a valid IPv4 address string.
 */
const ipArb = fc.tuple(
  fc.integer({ min: 1, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 1, max: 254 })
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/* ------------------------------------------------------------------ */
/*  Property 2 (Preservation): Non-X-Forwarded-For Behavior Unchanged */
/*  Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5                  */
/* ------------------------------------------------------------------ */

describe('Property 2 (Preservation): Non-X-Forwarded-For behavior unchanged', () => {

  const mockGet = jest.fn();
  const mockPut = jest.fn();
  const mockUpdate = jest.fn();

  beforeEach(() => {
    cache.clear();
    jest.restoreAllMocks();
    mockGet.mockReset();
    mockPut.mockReset();
    mockUpdate.mockReset();

    settings.sessionHashSalt.getValue.mockResolvedValue(TEST_SALT);

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

    // DynamoDB: no existing item → createInDynamo path
    mockGet.mockResolvedValue({});
    mockPut.mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /* -------------------------------------------------------------- */
  /*  Observation 1: sourceIp only (no X-Forwarded-For)             */
  /*  Requirement 3.1: sourceIp fallback preserved                  */
  /* -------------------------------------------------------------- */

  test('sourceIp-only event uses sourceIp as rawId', async () => {
    const event = buildSourceIpOnlyEvent('192.168.1.1');
    await checkRateLimit(event, LIMITS);

    const expected = expectedPk('192.168.1.1');

    expect(mockPut).toHaveBeenCalled();
    const actualPk = mockPut.mock.calls[0][0].Item.pk;
    expect(actualPk).toBe(expected);
  });

  /* -------------------------------------------------------------- */
  /*  Observation 2: Neither sourceIp nor X-Forwarded-For           */
  /*  Requirement 3.1: 'unknown' fallback preserved                 */
  /* -------------------------------------------------------------- */

  test('event with no IP headers falls back to unknown', async () => {
    const event = buildNoIpEvent();
    await checkRateLimit(event, LIMITS);

    const expected = expectedPk('unknown');

    expect(mockPut).toHaveBeenCalled();
    const actualPk = mockPut.mock.calls[0][0].Item.pk;
    expect(actualPk).toBe(expected);
  });

  /* -------------------------------------------------------------- */
  /*  Observation 3: Empty X-Forwarded-For with sourceIp            */
  /*  Empty string is falsy → falls through to sourceIp             */
  /* -------------------------------------------------------------- */

  test('empty X-Forwarded-For falls back to sourceIp', async () => {
    const event = buildEmptyXffEvent('10.0.0.1', '');
    await checkRateLimit(event, LIMITS);

    const expected = expectedPk('10.0.0.1');

    expect(mockPut).toHaveBeenCalled();
    const actualPk = mockPut.mock.calls[0][0].Item.pk;
    expect(actualPk).toBe(expected);
  });

  /* -------------------------------------------------------------- */
  /*  Observation 4: Whitespace-only X-Forwarded-For with sourceIp  */
  /*  trim() produces empty string → falsy → falls through          */
  /* -------------------------------------------------------------- */

  test('whitespace-only X-Forwarded-For falls back to sourceIp', async () => {
    const event = buildEmptyXffEvent('10.0.0.1', '  ');
    await checkRateLimit(event, LIMITS);

    const expected = expectedPk('10.0.0.1');

    expect(mockPut).toHaveBeenCalled();
    const actualPk = mockPut.mock.calls[0][0].Item.pk;
    expect(actualPk).toBe(expected);
  });

  /* -------------------------------------------------------------- */
  /*  Property-based test 1: For all sourceIp values (no XFF),      */
  /*  rawId equals sourceIp                                         */
  /*  Requirement 3.1                                               */
  /* -------------------------------------------------------------- */

  test('for any sourceIp (no X-Forwarded-For), rawId equals sourceIp', async () => {
    await fc.assert(
      fc.asyncProperty(ipArb, async (sourceIp) => {
        cache.clear();
        mockGet.mockReset();
        mockPut.mockReset();
        mockGet.mockResolvedValue({});
        mockPut.mockResolvedValue({});

        const event = buildSourceIpOnlyEvent(sourceIp);
        await checkRateLimit(event, LIMITS);

        const expected = expectedPk(sourceIp);

        expect(mockPut).toHaveBeenCalled();
        const actualPk = mockPut.mock.calls[0][0].Item.pk;
        expect(actualPk).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  /* -------------------------------------------------------------- */
  /*  Property-based test 2: For events with neither header,        */
  /*  rawId equals 'unknown'                                        */
  /*  Requirement 3.1                                               */
  /* -------------------------------------------------------------- */

  test('events with no IP information always produce unknown-based hash', async () => {
    // The 'unknown' fallback is deterministic — run multiple times to confirm
    const expectedUnknownPk = expectedPk('unknown');

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50 }), async (_iteration) => {
        cache.clear();
        mockGet.mockReset();
        mockPut.mockReset();
        mockGet.mockResolvedValue({});
        mockPut.mockResolvedValue({});

        const event = buildNoIpEvent();
        await checkRateLimit(event, LIMITS);

        expect(mockPut).toHaveBeenCalled();
        const actualPk = mockPut.mock.calls[0][0].Item.pk;
        expect(actualPk).toBe(expectedUnknownPk);
      }),
      { numRuns: 10 }
    );
  });

  /* -------------------------------------------------------------- */
  /*  Property-based test 3: hashClientIdentifier produces           */
  /*  consistent SHA-256 hashes for same inputs                     */
  /*  Requirement 3.4                                               */
  /* -------------------------------------------------------------- */

  test('hashClientIdentifier produces consistent hashes for identical inputs', () => {
    fc.assert(
      fc.property(
        ipArb,
        fc.integer({ min: 0, max: 10000 }),
        fc.string({ minLength: 8, maxLength: 64 }),
        (rawId, windowStart, salt) => {
          const hash1 = hashClientIdentifier(rawId, windowStart, salt);
          const hash2 = hashClientIdentifier(rawId, windowStart, salt);

          // Same inputs always produce same output
          expect(hash1).toBe(hash2);

          // Output is a valid 64-char hex string (SHA-256)
          expect(hash1).toMatch(/^[0-9a-f]{64}$/);

          // Verify against independent SHA-256 computation
          const expected = crypto
            .createHash('sha256')
            .update(`${rawId}${windowStart}${salt}`)
            .digest('hex');
          expect(hash1).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});
