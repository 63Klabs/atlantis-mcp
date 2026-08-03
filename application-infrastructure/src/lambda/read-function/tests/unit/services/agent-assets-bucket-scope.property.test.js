/**
 * Property-Based Test: Bucket Scoping and Invalid-Filter Rejection
 *
 * Feature: agent-asset-tools
 * Property 6: Bucket scoping and invalid-filter rejection
 *
 * For any request, every S3 read targets only buckets present in
 * `settings.s3.buckets`; when an `s3Buckets` filter lists only configured
 * buckets the search is restricted to exactly that subset; and when the
 * filter names any unconfigured bucket the request is rejected with a
 * validation error identifying the invalid bucket(s) and performs no S3
 * read.
 *
 * **Validates: Requirements 4.1, 4.5, 4.6**
 *
 * This exercises `services/agent-assets.js`'s private `resolveBucketsStrict`
 * helper indirectly through the public `list()` and `get()` functions (it is
 * not exported, so there is nothing to import directly). `config/index.js`
 * (`Config`) and `models/index.js` (`Models.S3AgentAssets`) are mocked;
 * `config/agent-asset-types.js` (the registry) is a separate, un-mocked
 * module so `get()` can resolve the real, enabled `steering` asset type.
 */

const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Mocks — set up BEFORE requiring the modules under test
// ---------------------------------------------------------------------------

jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    ApiRequest: {
      success: jest.fn((opts) => opts),
      error: jest.fn((opts) => opts)
    }
  }
}));

jest.mock('../../../config', () => ({
  Config: {
    getConnCacheProfile: jest.fn(),
    settings: jest.fn()
  }
}));

jest.mock('../../../models', () => ({
  S3AgentAssets: {
    list: jest.fn(),
    get: jest.fn()
  }
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const AgentAssets = require('../../../services/agent-assets');

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const SUFFIX_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const randomSuffixArb = fc.string({ unit: fc.constantFrom(...SUFFIX_CHARS), minLength: 3, maxLength: 15 });

/**
 * Bucket-like names used to build the CONFIGURED bucket list. The `cfg-`
 * prefix guarantees these can never collide with the `inv-`-prefixed names
 * below, so an "invalid" filter entry is disjoint from the configured list
 * by construction — no post-hoc filtering or rejection sampling required.
 */
const configuredBucketNameArb = randomSuffixArb.map((s) => `cfg-${s}`);

/** Bucket-like names guaranteed to NEVER be present in the configured bucket list. */
const invalidBucketNameArb = randomSuffixArb.map((s) => `inv-${s}`);

/** 1-5 unique configured bucket names, in configured priority order. */
const configuredBucketsArb = fc.uniqueArray(configuredBucketNameArb, { minLength: 1, maxLength: 5 });

/**
 * A configured bucket list paired with a non-empty SUBSET filter of that
 * same list (therefore always valid; order is preserved from the
 * configured list, matching `resolveBucketsStrict`'s pass-through of a
 * valid filter).
 */
const configuredWithValidFilterArb = configuredBucketsArb.chain((configuredBuckets) =>
  fc.subarray(configuredBuckets, { minLength: 1 }).map((filterSubset) => ({
    configuredBuckets,
    filterSubset
  }))
);

/**
 * A configured bucket list paired with a filter that mixes zero or more
 * VALID (configured) bucket names with one to three INVALID (unconfigured)
 * bucket names — i.e. either "mix of valid + invalid" or "all invalid".
 */
const configuredWithInvalidFilterArb = configuredBucketsArb.chain((configuredBuckets) =>
  fc.tuple(
    fc.subarray(configuredBuckets),
    fc.uniqueArray(invalidBucketNameArb, { minLength: 1, maxLength: 3 })
  ).map(([validPart, invalidBucketNames]) => ({
    configuredBuckets,
    filterWithInvalid: [...validPart, ...invalidBucketNames],
    invalidBucketNames
  }))
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure `Config.settings()`, `Config.getConnCacheProfile()`,
 * `CacheableDataAccess.getData()` (pass-through to the fetch function), and
 * the `Models.S3AgentAssets` DAO mocks for a given configured bucket list.
 *
 * Re-invoked at the start of every property iteration since each iteration
 * generates its own `configuredBuckets`.
 *
 * @param {string[]} configuredBuckets - The bucket list `Config.settings().s3.buckets` should return
 */
function setupMocks(configuredBuckets) {
  Config.settings.mockReturnValue({
    s3: { buckets: configuredBuckets }
  });

  Config.getConnCacheProfile.mockImplementation((connectionName, profileName) => ({
    conn: {
      name: connectionName,
      host: [],
      path: 'utilities/v2/agent_assets',
      parameters: {},
      cache: []
    },
    cacheProfile: {
      profile: profileName,
      overrideOriginHeaderExpiration: true,
      defaultExpirationInSeconds: 3600,
      expirationIsOnInterval: false,
      headersToRetain: '',
      hostId: connectionName,
      pathId: profileName === 'assets-list' ? 'list' : 'detail',
      encrypt: false
    }
  }));

  // >! Bypass the real cache and invoke the fetch function directly so the
  // >! mocked Models.S3AgentAssets methods are exercised on every call
  CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
    const result = await fetchFunction(conn, opts || {});
    return {
      getBody: () => result?.body ?? null
    };
  });

  Models.S3AgentAssets.list.mockResolvedValue({
    assets: [],
    errors: undefined,
    partialData: false
  });

  Models.S3AgentAssets.get.mockResolvedValue({
    name: 'x.md',
    type: 'steering',
    namespace: 'atlantis',
    bucket: configuredBuckets[0],
    s3Path: `s3://${configuredBuckets[0]}/atlantis/utilities/v2/agent_assets/steering/x.md`,
    size: 5,
    etag: '"mock-etag"',
    sha256: 'a'.repeat(64),
    lastModified: new Date('2024-01-01T00:00:00.000Z'),
    content: 'hello'
  });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Feature: agent-asset-tools, Property 6: Bucket scoping and invalid-filter rejection', () => {

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Property test A (Req 4.1): no unconfigured bucket ever reaches the DAO
  // -------------------------------------------------------------------------
  test('Property test A: no unconfigured bucket ever reaches the DAO (Requirement 4.1)', () => {
    return fc.assert(
      fc.asyncProperty(
        configuredWithValidFilterArb,
        async ({ configuredBuckets, filterSubset }) => {
          jest.clearAllMocks();
          setupMocks(configuredBuckets);

          await AgentAssets.list({ s3Buckets: filterSubset });

          expect(Models.S3AgentAssets.list).toHaveBeenCalledTimes(1);
          const connection = Models.S3AgentAssets.list.mock.calls[0][0];

          // >! Every bucket the DAO was called with must be in BOTH the
          // >! configured list and the requested filter - never anything
          // >! outside either set.
          for (const bucket of connection.host) {
            expect(configuredBuckets).toContain(bucket);
            expect(filterSubset).toContain(bucket);
          }
          expect(connection.host).toEqual(filterSubset);
        }
      ),
      { numRuns: 100 }
    );
  });

  // -------------------------------------------------------------------------
  // Property test B (Req 4.5): valid filter restricts search to exactly the
  // named buckets, for both list() and get()
  // -------------------------------------------------------------------------
  test('Property test B: valid filter restricts search to exactly the named buckets (Requirement 4.5)', () => {
    return fc.assert(
      fc.asyncProperty(
        configuredWithValidFilterArb,
        async ({ configuredBuckets, filterSubset }) => {
          jest.clearAllMocks();
          setupMocks(configuredBuckets);

          await AgentAssets.list({ s3Buckets: filterSubset });
          expect(Models.S3AgentAssets.list).toHaveBeenCalledTimes(1);
          const listConnection = Models.S3AgentAssets.list.mock.calls[0][0];
          expect(listConnection.host).toEqual(filterSubset);

          await AgentAssets.get({ assetType: 'steering', name: 'x.md', s3Buckets: filterSubset });
          expect(Models.S3AgentAssets.get).toHaveBeenCalledTimes(1);
          const getConnection = Models.S3AgentAssets.get.mock.calls[0][0];
          expect(getConnection.host).toEqual(filterSubset);
        }
      ),
      { numRuns: 100 }
    );
  });

  // -------------------------------------------------------------------------
  // Property test C (Req 4.6): invalid filter is rejected with no S3 read,
  // for both list() and get()
  // -------------------------------------------------------------------------
  test('Property test C: invalid filter is rejected with no S3 read (Requirement 4.6)', () => {
    return fc.assert(
      fc.asyncProperty(
        configuredWithInvalidFilterArb,
        async ({ configuredBuckets, filterWithInvalid, invalidBucketNames }) => {
          jest.clearAllMocks();
          setupMocks(configuredBuckets);

          let listError;
          try {
            await AgentAssets.list({ s3Buckets: filterWithInvalid });
          } catch (e) {
            listError = e;
          }

          expect(listError).toBeDefined();
          expect(listError.code).toBe('INVALID_INPUT');
          for (const invalidName of invalidBucketNames) {
            expect(listError.invalidBuckets).toContain(invalidName);
          }
          expect(Models.S3AgentAssets.list).not.toHaveBeenCalled();

          let getError;
          try {
            await AgentAssets.get({ assetType: 'steering', name: 'x.md', s3Buckets: filterWithInvalid });
          } catch (e) {
            getError = e;
          }

          expect(getError).toBeDefined();
          expect(getError.code).toBe('INVALID_INPUT');
          for (const invalidName of invalidBucketNames) {
            expect(getError.invalidBuckets).toContain(invalidName);
          }
          expect(Models.S3AgentAssets.get).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
