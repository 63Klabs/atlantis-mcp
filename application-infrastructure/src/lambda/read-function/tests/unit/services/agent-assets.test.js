/**
 * Unit Tests for Agent Assets Service
 *
 * Tests the AgentAssets service layer (services/agent-assets.js), mirroring the
 * mocking pattern established by tests/unit/services/templates-service.test.js
 * and templates-error-handling.test.js:
 * - Mocks `@63klabs/cache-data` (CacheableDataAccess, DebugAndLog, ApiRequest)
 * - Mocks `../../../config` (Config) and `../../../models` (Models.S3AgentAssets)
 * - Uses the REAL `../../../config/agent-asset-types` registry module (it has
 *   no AWS dependency), so assetType resolution and the enabled-type
 *   enumeration reflect the actual shipped registry rather than a stub
 *
 * Covers:
 * - All-types `list` aggregates enabled types in registry order (Requirement 1.1)
 * - `ASSET_NOT_FOUND` includes available names, and the empty-names case (Requirement 2.4)
 * - `listTypes` per-type asset counts (Requirement 6.3)
 * - An `s3Buckets` filter naming an unconfigured bucket is rejected with no S3 read (Requirement 4.6)
 * - An unknown/disabled `assetType` is rejected before any S3 read (Requirement 7.8)
 */

// Mock @63klabs/cache-data at module level, mirroring templates-service.test.js
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    ApiRequest: {
      success: jest.fn(({ body }) => ({ getBody: (parse) => (parse ? body : JSON.stringify(body)), statusCode: 200 })),
      error: jest.fn(({ body, statusCode }) => ({ getBody: (parse) => (parse ? body : JSON.stringify(body)), statusCode: statusCode || 500 }))
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

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

// Reset modules to ensure mocks are applied
jest.resetModules();

// Import mocked modules - these will use the mocks defined above
const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');

// Import the REAL registry module (no AWS dependency, intentionally NOT
// mocked) so assetType resolution and the enabled-type enumeration reflect
// the actual shipped registry rather than a stub.
const AgentAssetTypes = require('../../../config/agent-asset-types');

// Import service LAST to ensure it gets the mocked dependencies
const AgentAssets = require('../../../services/agent-assets');

describe('AgentAssets Service', () => {
  beforeEach(() => {
    Models.S3AgentAssets.list.mockReset();
    Models.S3AgentAssets.get.mockReset();
    Config.getConnCacheProfile.mockReset();
    Config.settings.mockReset();
    CacheableDataAccess.getData.mockReset();

    // >! Return a FRESH conn/cacheProfile object on every call so that get()'s
    // >! internal call to this module's own list() (for the ASSET_NOT_FOUND
    // >! available-names lookup) never mutates the conn/cacheProfile object
    // >! that the outer get() call already used.
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

    Config.settings.mockReturnValue({
      s3: {
        buckets: ['63klabs', 'bucket-a', 'bucket-b']
      }
    });

    // Bypass the cache and call fetchFunction directly, mirroring
    // templates-service.test.js / templates-error-handling.test.js, so
    // test-specific mocks on Models.S3AgentAssets.* are exercised.
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      return await fetchFunction(conn, opts);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list() - all-types aggregation in registry order (Requirement 1.1)', () => {
    it('aggregates all enabled types, in registry order, when assetType is omitted', async () => {
      Models.S3AgentAssets.list.mockResolvedValue({
        assets: [],
        errors: undefined,
        partialData: false
      });

      await AgentAssets.list({});

      expect(Models.S3AgentAssets.list).toHaveBeenCalledTimes(1);
      const [connection] = Models.S3AgentAssets.list.mock.calls[0];
      const requestedTypeNames = connection.parameters.assetTypes.map((type) => type.name);

      // Matches the real registry's enabled-type order (Requirement 1.1)
      expect(requestedTypeNames).toEqual(AgentAssetTypes.getEnabledTypeNames());
      expect(requestedTypeNames).toEqual(['steering', 'hooks', 'agents-md']);
    });
  });

  describe('get() - ASSET_NOT_FOUND available names (Requirement 2.4)', () => {
    it('throws ASSET_NOT_FOUND with the available asset names for that type', async () => {
      Models.S3AgentAssets.get.mockResolvedValue(null);
      Models.S3AgentAssets.list.mockResolvedValue({
        assets: [{ name: 'a.md' }, { name: 'b.md' }],
        errors: undefined,
        partialData: false
      });

      await expect(AgentAssets.get({ assetType: 'steering', name: 'missing.md' }))
        .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });

      try {
        await AgentAssets.get({ assetType: 'steering', name: 'missing.md' });
        throw new Error('Expected AgentAssets.get to throw ASSET_NOT_FOUND');
      } catch (error) {
        expect(error.code).toBe('ASSET_NOT_FOUND');
        expect(error.availableAssets).toEqual(['a.md', 'b.md']);
        expect(error.message).toContain('steering/missing.md');
      }
    });

    it('returns an empty availableAssets array when no assets of that type are available', async () => {
      Models.S3AgentAssets.get.mockResolvedValue(null);
      Models.S3AgentAssets.list.mockResolvedValue({ assets: [] });

      try {
        await AgentAssets.get({ assetType: 'hooks', name: 'missing.kiro.hook' });
        throw new Error('Expected AgentAssets.get to throw ASSET_NOT_FOUND');
      } catch (error) {
        expect(error.code).toBe('ASSET_NOT_FOUND');
        expect(error.availableAssets).toEqual([]);
      }
    });
  });

  describe('listTypes() - per-type asset counts (Requirement 6.3)', () => {
    it('returns one entry per enabled type with the correct name, folder, description, and assetCount', async () => {
      const enabledTypes = AgentAssetTypes.getEnabledTypes();
      const countsByTypeName = {};
      enabledTypes.forEach((type, index) => {
        countsByTypeName[type.name] = index + 1; // distinct, non-zero counts per type
      });

      Models.S3AgentAssets.list.mockImplementation(async (connection) => {
        const requestedType = connection.parameters.assetTypes[0];
        const count = countsByTypeName[requestedType.name] || 0;
        return {
          assets: Array.from({ length: count }, (_, i) => ({ name: `${requestedType.name}-${i}.md` })),
          errors: undefined,
          partialData: false
        };
      });

      const result = await AgentAssets.listTypes();

      expect(result).toHaveLength(enabledTypes.length);
      enabledTypes.forEach((type, index) => {
        expect(result[index]).toEqual({
          name: type.name,
          folder: type.folder,
          description: type.description,
          assetCount: countsByTypeName[type.name]
        });
      });
    });
  });

  describe('list() - invalid s3Buckets filter rejected before any S3 read (Requirement 4.6)', () => {
    it('rejects an s3Buckets filter naming an unconfigured bucket and never reads S3', async () => {
      Config.settings.mockReturnValue({ s3: { buckets: ['bucket-a', 'bucket-b'] } });

      await expect(AgentAssets.list({ s3Buckets: ['bucket-a', 'not-configured'] }))
        .rejects.toMatchObject({ code: 'INVALID_INPUT' });

      expect(Models.S3AgentAssets.list).not.toHaveBeenCalled();

      try {
        await AgentAssets.list({ s3Buckets: ['bucket-a', 'not-configured'] });
        throw new Error('Expected AgentAssets.list to throw INVALID_INPUT');
      } catch (error) {
        expect(error.message).toContain('not-configured');
        expect(error.invalidBuckets).toEqual(['not-configured']);
      }

      expect(Models.S3AgentAssets.list).not.toHaveBeenCalled();
    });
  });

  describe('Unknown/disabled assetType rejected before any S3 read (Requirement 7.8)', () => {
    it('rejects list() when assetType names a disabled type (skills)', async () => {
      await expect(AgentAssets.list({ assetType: 'skills' }))
        .rejects.toMatchObject({ code: 'INVALID_INPUT' });

      expect(Models.S3AgentAssets.list).not.toHaveBeenCalled();
    });

    it('rejects get() when assetType is unknown', async () => {
      await expect(AgentAssets.get({ assetType: 'bogus', name: 'x.md' }))
        .rejects.toMatchObject({ code: 'INVALID_INPUT' });

      expect(Models.S3AgentAssets.get).not.toHaveBeenCalled();
    });
  });
});
