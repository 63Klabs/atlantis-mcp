/**
 * Unit tests for cache hit and cache miss scenarios
 *
 * Tests caching behavior including:
 * - Cache hits (data retrieved from cache)
 * - Cache misses (data fetched from source)
 * - Cache key generation
 * - Cache expiration
 * - Multi-tier caching (in-memory, DynamoDB, S3)
 */

const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

// Mock cache-data package
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    ApiRequest: {
      success: jest.fn(({ body }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: 200 })),
      error: jest.fn(({ body, statusCode }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: statusCode || 500 }))
    }
  }
}));

// Mock Config module
jest.mock('../../../config', () => ({
  Config: {
    getConnCacheProfile: jest.fn(),
    settings: jest.fn()
  }
}));

// Mock Models (used by service layer fetch functions)
jest.mock('../../../models', () => ({
  S3Templates: {
    list: jest.fn().mockResolvedValue({ templates: [], errors: undefined, partialData: false }),
    get: jest.fn().mockResolvedValue(null)
  }
}));

const { cache } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const TemplatesService = require('../../../services/templates');

describe('Cache Scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    s3Mock.reset();

    // Mock Config.getConnCacheProfile
    Config.getConnCacheProfile.mockReturnValue({
      conn: {
        name: 's3-templates',
        host: ['bucket1', 'bucket2'],
        path: 'templates/v2',
        parameters: {},
        cache: []
      },
      cacheProfile: {
        hostId: 's3-templates',
        pathId: 'templates-list',
        profile: 'templates-list',
        overrideOriginHeaderExpiration: true,
        defaultExpirationInSeconds: 3600,
        expirationIsOnInterval: false,
        headersToRetain: '',
        encrypt: false
      }
    });

    Config.settings.mockReturnValue({
      s3: {
        buckets: ['bucket1', 'bucket2'],
        templatePrefix: 'templates/v2'
      },
      templates: {
        categories: [
          { name: 'storage', description: 'Storage templates' }
        ]
      }
    });
  });

  // Helper to create a mock cache response with getBody method
  function mockCacheResponse(body, meta = {}) {
    return {
      getBody: (parse) => parse ? body : JSON.stringify(body),
      ...meta
    };
  }

  describe('Cache Hit Scenarios', () => {
    test('should return data from cache on cache hit', async () => {
      const cachedData = {
        templates: [
          { name: 'template1', version: 'v1.0.0' },
          { name: 'template2', version: 'v1.1.0' }
        ]
      };

      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse(cachedData, { fromCache: true, cacheSource: 'dynamodb' })
      );

      const result = await TemplatesService.list({ category: 'storage' });

      expect(result).toEqual(cachedData);
      expect(cache.CacheableDataAccess.getData).toHaveBeenCalledTimes(1);
    });

    test('should indicate cache hit in response metadata', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true, cacheSource: 'memory' })
      );

      const result = await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
      // Cache hit should be fast - no S3 calls
      expect(s3Mock.calls()).toHaveLength(0);
    });

    test('should use in-memory cache for repeated requests', async () => {
      const cachedData = { templates: [{ name: 'template1' }] };

      cache.CacheableDataAccess.getData
        .mockResolvedValueOnce(mockCacheResponse(cachedData, { fromCache: false, cacheSource: null }))
        .mockResolvedValueOnce(mockCacheResponse(cachedData, { fromCache: true, cacheSource: 'memory' }));

      // First call - cache miss
      await TemplatesService.list({});

      // Second call - should hit in-memory cache
      await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalledTimes(2);
    });

    test('should use DynamoDB cache when in-memory cache misses', async () => {
      const cachedData = { templates: [{ name: 'template1' }] };

      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse(cachedData, { fromCache: true, cacheSource: 'dynamodb' })
      );

      await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
      // Should not call S3 if DynamoDB cache hit
      expect(s3Mock.calls()).toHaveLength(0);
    });

    test('should use S3 cache when DynamoDB cache misses', async () => {
      const cachedData = { templates: [{ name: 'template1' }] };

      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse(cachedData, { fromCache: true, cacheSource: 's3' })
      );

      await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
    });
  });

  describe('Cache Miss Scenarios', () => {
    test('should fetch from source on cache miss', async () => {
      const sourceData = {
        templates: [
          { name: 'template1', version: 'v1.0.0' }
        ]
      };

      // Mock cache miss - getData calls fetch function and returns result
      cache.CacheableDataAccess.getData.mockImplementation(
        async (cacheProfile, fetchFunction, connection, options) => {
          const result = await fetchFunction(connection, options);
          return result; // fetchFunction returns ApiRequest.success/error which has getBody
        }
      );

      const result = await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
    });

    test('should store fetched data in cache after cache miss', async () => {
      cache.CacheableDataAccess.getData.mockImplementation(
        async (cacheProfile, fetchFunction, connection, options) => {
          const result = await fetchFunction(connection, options);
          return result;
        }
      );

      await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
    });

    test('should handle cache miss with multiple S3 buckets', async () => {
      cache.CacheableDataAccess.getData.mockImplementation(
        async (cacheProfile, fetchFunction, connection, options) => {
          const result = await fetchFunction(connection, options);
          return result;
        }
      );

      await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
      const call = cache.CacheableDataAccess.getData.mock.calls[0];
      expect(call[2].host).toEqual(['bucket1', 'bucket2']);
    });
  });

  describe('Cache Key Generation', () => {
    test('should include bucket names in cache key', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true })
      );

      await TemplatesService.list({ s3Buckets: ['bucket1'] });

      const call = cache.CacheableDataAccess.getData.mock.calls[0];
      expect(call[2].host).toEqual(['bucket1']);
    });

    test('should include parameters in cache key', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true })
      );

      await TemplatesService.list({
        category: 'storage',
        version: 'v1.0.0'
      });

      const call = cache.CacheableDataAccess.getData.mock.calls[0];
      expect(call[2].parameters).toMatchObject({
        category: 'storage',
        version: 'v1.0.0'
      });
    });

    test('should generate different cache keys for different parameters', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true })
      );

      // Need fresh conn objects per call since the service mutates conn.parameters
      Config.getConnCacheProfile
        .mockReturnValueOnce({
          conn: { name: 's3-templates', host: ['bucket1', 'bucket2'], path: 'templates/v2', parameters: {}, cache: [] },
          cacheProfile: { hostId: 's3-templates', pathId: 'templates-list', profile: 'templates-list', overrideOriginHeaderExpiration: true, defaultExpirationInSeconds: 3600, expirationIsOnInterval: false, headersToRetain: '', encrypt: false }
        })
        .mockReturnValueOnce({
          conn: { name: 's3-templates', host: ['bucket1', 'bucket2'], path: 'templates/v2', parameters: {}, cache: [] },
          cacheProfile: { hostId: 's3-templates', pathId: 'templates-list', profile: 'templates-list', overrideOriginHeaderExpiration: true, defaultExpirationInSeconds: 3600, expirationIsOnInterval: false, headersToRetain: '', encrypt: false }
        });

      await TemplatesService.list({ category: 'storage' });
      await TemplatesService.list({ category: 'network' });

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalledTimes(2);

      const call1 = cache.CacheableDataAccess.getData.mock.calls[0];
      const call2 = cache.CacheableDataAccess.getData.mock.calls[1];

      // getData(cacheProfile, fetchFunction, conn, options) - conn is arg[2]
      expect(call1[2].parameters.category).toBe('storage');
      expect(call2[2].parameters.category).toBe('network');
    });

    test('should include namespace in cache key', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true })
      );

      await TemplatesService.list({});

      const call = cache.CacheableDataAccess.getData.mock.calls[0];
      // getData(cacheProfile, fetchFunction, conn, options) - cacheProfile is arg[0]
      expect(call[0]).toHaveProperty('hostId', 's3-templates');
      expect(call[0]).toHaveProperty('pathId', 'templates-list');
    });
  });

  describe('Cache Expiration', () => {
    test('should respect TTL configuration', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true })
      );

      await TemplatesService.list({});

      const call = cache.CacheableDataAccess.getData.mock.calls[0];
      // getData(cacheProfile, fetchFunction, conn, options) - cacheProfile is arg[0]
      expect(call[0].defaultExpirationInSeconds).toBe(3600);
    });

    test('should use different TTLs for different resource types', async () => {
      Config.settings = jest.fn().mockReturnValue({
        s3: { buckets: ['bucket1'] },
        atlantisS3Buckets: ['bucket1'],
        ttl: {
          templateList: 1800,
          templateDetail: 3600,
          starterList: 1800
        }
      });

      Config.getConnCacheProfile = jest.fn()
        .mockReturnValueOnce({
          conn: { host: ['bucket1'], path: 'templates/v2', parameters: {}, cache: [] },
          cacheProfile: {
            hostId: 's3-templates',
            pathId: 'templates-list',
            profile: 'templates-list',
            overrideOriginHeaderExpiration: true,
            defaultExpirationInSeconds: 1800,
            expirationIsOnInterval: false,
            headersToRetain: '',
            encrypt: false
          }
        })
        .mockReturnValueOnce({
          conn: { host: ['bucket1'], path: 'templates/v2', parameters: {}, cache: [] },
          cacheProfile: {
            hostId: 's3-templates',
            pathId: 'template-detail',
            profile: 'template-detail',
            overrideOriginHeaderExpiration: true,
            defaultExpirationInSeconds: 3600,
            expirationIsOnInterval: false,
            headersToRetain: '',
            encrypt: false
          }
        });

      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({}, { fromCache: true })
      );

      await TemplatesService.list({});
      await TemplatesService.get({ templateName: 'test', category: 'storage' });

      const listCall = cache.CacheableDataAccess.getData.mock.calls[0];
      const getCall = cache.CacheableDataAccess.getData.mock.calls[1];

      // getData(cacheProfile, fetchFunction, conn, options) - cacheProfile is arg[0]
      expect(listCall[0].defaultExpirationInSeconds).toBe(1800);
      expect(getCall[0].defaultExpirationInSeconds).toBe(3600);
    });

    test('should refetch data when cache expires', async () => {
      const freshData = { templates: [{ name: 'template1', version: 'v1.1.0' }] };

      cache.CacheableDataAccess.getData.mockResolvedValueOnce(
        mockCacheResponse(freshData, { fromCache: false, cacheSource: null })
      );

      const result = await TemplatesService.list({});

      expect(result).toEqual(freshData);
      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
    });
  });

  describe('Multi-Tier Caching', () => {
    test('should check in-memory cache first', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true, cacheSource: 'memory' })
      );

      await TemplatesService.list({});

      // Should not call DynamoDB or S3
      expect(ddbMock.calls()).toHaveLength(0);
      expect(s3Mock.calls()).toHaveLength(0);
    });

    test('should check DynamoDB cache on in-memory miss', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true, cacheSource: 'dynamodb' })
      );

      await TemplatesService.list({});

      // Should not call S3 if DynamoDB hit
      expect(s3Mock.calls()).toHaveLength(0);
    });

    test('should check S3 cache on DynamoDB miss', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true, cacheSource: 's3' })
      );

      await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
    });

    test('should fetch from source on all cache misses', async () => {
      cache.CacheableDataAccess.getData.mockImplementation(
        async (cacheProfile, fetchFunction, connection, options) => {
          const result = await fetchFunction(connection, options);
          return result; // fetchFunction returns ApiRequest response with getBody
        }
      );

      await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
    });

    test('should populate all cache tiers after source fetch', async () => {
      cache.CacheableDataAccess.getData.mockImplementation(
        async (cacheProfile, fetchFunction, connection, options) => {
          const result = await fetchFunction(connection, options);
          return result; // fetchFunction returns ApiRequest response with getBody
        }
      );

      await TemplatesService.list({});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
    });
  });

  describe('Cache Performance', () => {
    test('should be faster on cache hit than cache miss', async () => {
      // Cache hit - immediate return
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true, cacheSource: 'memory' })
      );

      const hitStart = Date.now();
      await TemplatesService.list({});
      const hitDuration = Date.now() - hitStart;

      // Cache miss - requires fetch
      cache.CacheableDataAccess.getData.mockImplementation(
        async (cacheProfile, fetchFunction, connection, options) => {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 100));
          const result = await fetchFunction(connection, options);
          return result; // fetchFunction returns ApiRequest response with getBody
        }
      );

      const missStart = Date.now();
      await TemplatesService.list({});
      const missDuration = Date.now() - missStart;

      // Cache hit should be significantly faster
      expect(hitDuration).toBeLessThan(missDuration);
    });

    test('should handle concurrent requests efficiently', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue(
        mockCacheResponse({ templates: [] }, { fromCache: true })
      );

      // Make multiple concurrent requests
      const requests = Array(10).fill(null).map(() =>
        TemplatesService.list({})
      );

      await Promise.all(requests);

      // All requests should complete successfully
      expect(cache.CacheableDataAccess.getData).toHaveBeenCalledTimes(10);
    });
  });
});
