/**
 * Bug Condition Exploration Test — IP Resolution Priority
 *
 * Property 1: X-Forwarded-For Takes Priority Over sourceIp
 *
 * Spec: 0-0-1-fix-rate-limiter-client-ip-resolution
 * Requirements: 1.1, 2.1, 2.2, 2.3
 *
 * CRITICAL: This test encodes the EXPECTED behavior. On unfixed code it
 * MUST FAIL — failure confirms the bug exists. After the fix is applied
 * the same test MUST PASS, confirming the fix is correct.
 *
 * DO NOT modify the test or the production code to make it pass before
 * the fix is implemented.
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
const { checkRateLimit, TestHarness } = require('../../../utils/rate-limiter');
const {
  hashClientIdentifier,
  nextIntervalInMinutes,
  convertFromMinutesToMilli,
  cache
} = TestHarness.getInternals();

/* ------------------------------------------------------------------ */
/*  Shared helpers and setup                                          */
/* ------------------------------------------------------------------ */

/** Standard limits used across all tests in this file. */
const LIMITS = { public: { limitPerWindow: 50, windowInMinutes: 60 } };

/** Salt value returned by the mocked SSM parameter. */
const TEST_SALT = 'bug-exploration-salt';

/**
 * Build a minimal API Gateway event with both sourceIp and
 * X-Forwarded-For set to the supplied values.
 *
 * @param {string} sourceIp - CloudFront edge IP
 * @param {string} xForwardedFor - X-Forwarded-For header value
 * @returns {Object} API Gateway event stub
 */
function buildEvent(sourceIp, xForwardedFor) {
  return {
    requestContext: { identity: { sourceIp } },
    headers: { 'X-Forwarded-For': xForwardedFor }
  };
}

/**
 * Compute the expected DynamoDB partition key for a given rawId using
 * the current window boundaries.
 *
 * @param {string} rawId - The client identifier that SHOULD be used
 * @returns {string} SHA-256 hex hash
 */
function expectedPk(rawId) {
  const windowInMinutes = LIMITS.public.windowInMinutes;
  const resetTimeMinutes = nextIntervalInMinutes(windowInMinutes);
  const windowStartMinutes = resetTimeMinutes - windowInMinutes;
  return hashClientIdentifier(rawId, windowStartMinutes, TEST_SALT);
}

/* ------------------------------------------------------------------ */
/*  Property 1 (Bug Condition): X-Forwarded-For Takes Priority        */
/*  Validates: Requirements 1.1, 2.1, 2.2, 2.3                       */
/* ------------------------------------------------------------------ */

describe('Property 1 (Bug Condition): X-Forwarded-For takes priority over sourceIp', () => {

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
  /*  Test case 1: Single-IP X-Forwarded-For                        */
  /* -------------------------------------------------------------- */

  test('hash key derives from X-Forwarded-For, not sourceIp (single IP)', async () => {
    const event = buildEvent('54.230.1.1', '203.0.113.50');
    await checkRateLimit(event, LIMITS);

    const expectedFromXff = expectedPk('203.0.113.50');
    const wrongFromSourceIp = expectedPk('54.230.1.1');

    // createInDynamo calls put({ TableName, Item: { pk, ... } })
    expect(mockPut).toHaveBeenCalled();
    const actualPk = mockPut.mock.calls[0][0].Item.pk;

    expect(actualPk).toBe(expectedFromXff);
    expect(actualPk).not.toBe(wrongFromSourceIp);
  });

  /* -------------------------------------------------------------- */
  /*  Test case 2: Multi-IP X-Forwarded-For                         */
  /* -------------------------------------------------------------- */

  test('hash key derives from first IP in multi-IP X-Forwarded-For', async () => {
    const event = buildEvent('54.230.1.1', '203.0.113.50, 54.230.1.1');
    await checkRateLimit(event, LIMITS);

    const expectedFromXff = expectedPk('203.0.113.50');

    expect(mockPut).toHaveBeenCalled();
    const actualPk = mockPut.mock.calls[0][0].Item.pk;

    expect(actualPk).toBe(expectedFromXff);
  });

  /* -------------------------------------------------------------- */
  /*  Test case 3: Same sourceIp, different X-Forwarded-For         */
  /*  Different clients behind the same edge → independent buckets  */
  /* -------------------------------------------------------------- */

  test('different X-Forwarded-For IPs produce different hash keys (independent buckets)', async () => {
    // Client A
    cache.clear();
    mockGet.mockReset();
    mockPut.mockReset();
    mockGet.mockResolvedValue({});
    mockPut.mockResolvedValue({});

    const eventA = buildEvent('54.230.1.1', '203.0.113.50');
    await checkRateLimit(eventA, LIMITS);
    const pkA = mockPut.mock.calls[0][0].Item.pk;

    // Client B — same edge, different real client
    cache.clear();
    mockGet.mockReset();
    mockPut.mockReset();
    mockGet.mockResolvedValue({});
    mockPut.mockResolvedValue({});

    const eventB = buildEvent('54.230.1.1', '198.51.100.25');
    await checkRateLimit(eventB, LIMITS);
    const pkB = mockPut.mock.calls[0][0].Item.pk;

    expect(pkA).not.toBe(pkB);
  });

  /* -------------------------------------------------------------- */
  /*  Test case 4: Different sourceIp, same X-Forwarded-For         */
  /*  Same client across edges → shared bucket                      */
  /* -------------------------------------------------------------- */

  test('same X-Forwarded-For IP produces same hash key regardless of sourceIp (shared bucket)', async () => {
    // Edge 1
    cache.clear();
    mockGet.mockReset();
    mockPut.mockReset();
    mockGet.mockResolvedValue({});
    mockPut.mockResolvedValue({});

    const eventEdge1 = buildEvent('54.230.1.1', '203.0.113.50');
    await checkRateLimit(eventEdge1, LIMITS);
    const pkEdge1 = mockPut.mock.calls[0][0].Item.pk;

    // Edge 2 — different edge, same real client
    cache.clear();
    mockGet.mockReset();
    mockPut.mockReset();
    mockGet.mockResolvedValue({});
    mockPut.mockResolvedValue({});

    const eventEdge2 = buildEvent('54.230.2.2', '203.0.113.50');
    await checkRateLimit(eventEdge2, LIMITS);
    const pkEdge2 = mockPut.mock.calls[0][0].Item.pk;

    expect(pkEdge1).toBe(pkEdge2);
  });

  /* -------------------------------------------------------------- */
  /*  Property-based: random IP pairs always derive from XFF        */
  /* -------------------------------------------------------------- */

  test('for any random IP pair, hash key always derives from X-Forwarded-For first IP', async () => {
    /**
     * fast-check arbitrary that generates a valid IPv4 address string.
     */
    const ipArb = fc.tuple(
      fc.integer({ min: 1, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 254 })
    ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

    await fc.assert(
      fc.asyncProperty(
        ipArb,
        ipArb.filter((ip, idx) => true), // second independent IP
        async (sourceIp, xffIp) => {
          // Skip when IPs happen to be identical — bug condition requires they differ
          if (sourceIp === xffIp) return;

          cache.clear();
          mockGet.mockReset();
          mockPut.mockReset();
          mockGet.mockResolvedValue({});
          mockPut.mockResolvedValue({});

          const event = buildEvent(sourceIp, xffIp);
          await checkRateLimit(event, LIMITS);

          const expectedFromXff = expectedPk(xffIp);

          expect(mockPut).toHaveBeenCalled();
          const actualPk = mockPut.mock.calls[0][0].Item.pk;

          expect(actualPk).toBe(expectedFromXff);
        }
      ),
      { numRuns: 100 }
    );
  });
});
