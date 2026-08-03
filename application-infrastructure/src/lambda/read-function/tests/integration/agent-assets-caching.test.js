/**
 * Integration tests: Agent Assets pass-through caching
 *
 * Confirms the `s3-agent-assets` connection's two cache profiles
 * (`assets-list` and `asset-detail`) are exercised through
 * `CacheableDataAccess.getData` for `AgentAssets.list()` and
 * `AgentAssets.get()`:
 * - A cache HIT (the mocked `CacheableDataAccess.getData` returns cached
 *   data without invoking the passed `fetchFunction`) never reaches the DAO
 *   (`Models.S3AgentAssets.list`/`.get`).
 * - A cache MISS (the mocked `CacheableDataAccess.getData` invokes the
 *   passed `fetchFunction`) invokes the DAO exactly once and returns its
 *   result.
 *
 * Mirrors the mocking approach in
 * `tests/unit/services/starters-cache-data-integration.test.js`: mock
 * `@63klabs/cache-data`'s `cache.CacheableDataAccess.getData` and
 * `tools.ApiRequest.success`/`.error` directly, rather than mocking the
 * underlying S3/DynamoDB clients.
 *
 * @module tests/integration/agent-assets-caching
 * Validates: Requirements 8.1, 8.2, 8.3
 */

// Mock dependencies before importing the service
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
      success: jest.fn(({ body }) => ({ getBody: (parse) => (parse ? body : JSON.stringify(body)), statusCode: 200 })),
      error: jest.fn(({ body, statusCode }) => ({ getBody: (parse) => (parse ? body : JSON.stringify(body)), statusCode: statusCode || 500 }))
    }
  }
}));

jest.mock('../../config', () => ({
  Config: {
    settings: jest.fn(() => ({
      s3: {
        buckets: ['test-bucket-1', 'test-bucket-2'],
        agentAssetPrefix: 'utilities/v2/agent_assets'
      }
    })),
    // >! Return a fresh conn/cacheProfile literal per call so each test's
    // >! mutations (e.g. the service appending to cacheProfile.pathId) never
    // >! leak into other tests or other calls
    getConnCacheProfile: jest.fn((connectionName, profileName) => ({
      conn: {
        host: [],
        path: 'utilities/v2/agent_assets',
        parameters: {}
      },
      cacheProfile: {
        hostId: connectionName,
        pathId: profileName === 'assets-list' ? 'list' : 'detail',
        profile: profileName
      }
    }))
  }
}));

jest.mock('../../models', () => ({
  S3AgentAssets: {
    list: jest.fn(),
    get: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../config');
const Models = require('../../models');
const AgentAssets = require('../../services/agent-assets');

describe('Agent Assets - pass-through caching integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('assets-list profile (AgentAssets.list)', () => {
    it('cache HIT returns the cached result without calling the DAO fetch', async () => {
      const cachedResult = {
        assets: [
          { name: 'cached-guidelines.md', type: 'steering', namespace: 'atlantis', bucket: '63klabs', s3Path: 's3://63klabs/atlantis/utilities/v2/agent_assets/steering/cached-guidelines.md', size: 10, etag: '"abc"', lastModified: '2026-01-01T00:00:00.000Z' }
        ],
        errors: undefined,
        partialData: false
      };

      // >! Simulate a cache HIT: getData resolves WITHOUT invoking fetchFunction
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        return { getBody: (parse) => (parse ? cachedResult : JSON.stringify(cachedResult)) };
      });

      const result = await AgentAssets.list({ assetType: 'steering' });

      expect(result).toEqual(cachedResult);
      expect(Models.S3AgentAssets.list).not.toHaveBeenCalled();

      expect(CacheableDataAccess.getData).toHaveBeenCalledTimes(1);
      const [cacheProfileArg] = CacheableDataAccess.getData.mock.calls[0];
      expect(cacheProfileArg.profile).toBe('assets-list');
      expect(cacheProfileArg.pathId).toBe('list');

      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-agent-assets', 'assets-list');
    });

    it('cache MISS invokes the DAO fetch exactly once and returns its result', async () => {
      const daoResult = {
        assets: [
          { name: 'fresh-guidelines.md', type: 'steering', namespace: 'atlantis', bucket: '63klabs', s3Path: 's3://63klabs/atlantis/utilities/v2/agent_assets/steering/fresh-guidelines.md', size: 20, etag: '"def"', lastModified: '2026-02-01T00:00:00.000Z' }
        ],
        errors: undefined,
        partialData: false
      };

      Models.S3AgentAssets.list.mockResolvedValue(daoResult);

      // >! Simulate a cache MISS: getData invokes the real fetchFunction
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        return await fetchFunction(conn, opts);
      });

      const result = await AgentAssets.list({ assetType: 'steering' });

      expect(Models.S3AgentAssets.list).toHaveBeenCalledTimes(1);
      expect(result).toEqual(daoResult);
    });
  });

  describe('asset-detail profile (AgentAssets.get)', () => {
    it('cache HIT returns the cached asset without calling the DAO fetch', async () => {
      const cachedAsset = {
        name: 'cached.md',
        type: 'steering',
        namespace: 'atlantis',
        bucket: '63klabs',
        s3Path: 's3://63klabs/atlantis/utilities/v2/agent_assets/steering/cached.md',
        size: 5,
        etag: '"aaa"',
        sha256: 'a'.repeat(64),
        lastModified: '2026-01-01T00:00:00.000Z',
        content: 'cached content'
      };

      // >! Simulate a cache HIT: getData resolves WITHOUT invoking fetchFunction
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        return { getBody: (parse) => (parse ? cachedAsset : JSON.stringify(cachedAsset)) };
      });

      const result = await AgentAssets.get({ assetType: 'steering', name: 'x.md' });

      expect(result).toEqual(cachedAsset);
      expect(Models.S3AgentAssets.get).not.toHaveBeenCalled();

      expect(CacheableDataAccess.getData).toHaveBeenCalledTimes(1);
      const [cacheProfileArg] = CacheableDataAccess.getData.mock.calls[0];
      expect(cacheProfileArg.profile).toBe('asset-detail');
      // >! The service appends the asset identity to pathId for log clarity
      expect(cacheProfileArg.pathId).toBe('detail:steering/x.md');

      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-agent-assets', 'asset-detail');
    });

    it('cache MISS invokes the DAO fetch exactly once and returns its result', async () => {
      const daoAsset = {
        name: 'x.md',
        type: 'steering',
        namespace: 'atlantis',
        bucket: '63klabs',
        s3Path: 's3://63klabs/atlantis/utilities/v2/agent_assets/steering/x.md',
        size: 7,
        etag: '"bbb"',
        sha256: 'b'.repeat(64),
        lastModified: '2026-02-01T00:00:00.000Z',
        content: 'fresh content'
      };

      Models.S3AgentAssets.get.mockResolvedValue(daoAsset);

      // >! Simulate a cache MISS: getData invokes the real fetchFunction
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        return await fetchFunction(conn, opts);
      });

      const result = await AgentAssets.get({ assetType: 'steering', name: 'x.md' });

      expect(Models.S3AgentAssets.get).toHaveBeenCalledTimes(1);
      expect(result).toEqual(daoAsset);
    });
  });

  describe('two distinct cache profiles (Requirement 8.1/8.2 contract)', () => {
    it('list() and get() resolve to distinct cacheProfile pathId/profile values', async () => {
      // >! Cache MISS for both, just to exercise the full path
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        return await fetchFunction(conn, opts);
      });
      Models.S3AgentAssets.list.mockResolvedValue({ assets: [], errors: undefined, partialData: false });
      Models.S3AgentAssets.get.mockResolvedValue({
        name: 'y.md',
        type: 'steering',
        namespace: 'atlantis',
        bucket: '63klabs',
        s3Path: 's3://63klabs/atlantis/utilities/v2/agent_assets/steering/y.md',
        size: 1,
        etag: '"ccc"',
        sha256: 'c'.repeat(64),
        lastModified: '2026-03-01T00:00:00.000Z',
        content: 'y'
      });

      await AgentAssets.list({ assetType: 'steering' });
      await AgentAssets.get({ assetType: 'steering', name: 'y.md' });

      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-agent-assets', 'assets-list');
      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-agent-assets', 'asset-detail');

      const calls = Config.getConnCacheProfile.mock.calls;
      const listCall = calls.find((args) => args[1] === 'assets-list');
      const getCall = calls.find((args) => args[1] === 'asset-detail');

      expect(listCall).toBeDefined();
      expect(getCall).toBeDefined();
      expect(listCall[1]).not.toBe(getCall[1]);

      // >! The two profiles must resolve to distinct cacheProfile identities
      // >! (assets-list vs asset-detail), confirming Requirement 8.1's "two
      // >! cache profiles" contract
      const listCacheProfileArg = CacheableDataAccess.getData.mock.calls[0][0];
      const getCacheProfileArg = CacheableDataAccess.getData.mock.calls[1][0];
      expect(listCacheProfileArg.profile).toBe('assets-list');
      expect(getCacheProfileArg.profile).toBe('asset-detail');
      expect(listCacheProfileArg.profile).not.toBe(getCacheProfileArg.profile);
    });
  });
});
