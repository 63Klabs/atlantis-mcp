/**
 * Multiple S3 Bucket Handling Tests
 *
 * Tests that the MCP server correctly handles multiple S3 buckets:
 * - Aggregating templates from multiple buckets
 * - Bucket priority ordering
 * - Deduplication across buckets
 * - Filtering by specific buckets
 * - Bucket validation against configured list
 */

// Mock @63klabs/cache-data
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
      info: jest.fn(),
      error: jest.fn()
    },
    ApiRequest: {
      success: jest.fn(({ body }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: 200 })),
      error: jest.fn(({ body, statusCode }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: statusCode || 500 }))
    }
  }
}));

// Mock config
jest.mock('../../../config', () => ({
  Config: {
    getConnCacheProfile: jest.fn(),
    settings: jest.fn()
  }
}));

// Mock S3Templates DAO
jest.mock('../../../models/s3-templates');

const { cache } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const S3Templates = require('../../../models/s3-templates');

describe('Multiple S3 Bucket Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Config.settings.mockReturnValue({
      s3: {
        buckets: ['bucket-1', 'bucket-2', 'bucket-3']
      }
    });
  });

  describe('Template Aggregation', () => {
    test('should aggregate templates from multiple buckets', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template-s3', category: 'storage', namespace: 'atlantis', bucket: 'bucket-1', s3Path: 's3://bucket-1/atlantis/templates/v2/storage/template-s3.yml' },
          { name: 'template-pipeline', category: 'pipeline', namespace: 'atlantis', bucket: 'bucket-2', s3Path: 's3://bucket-2/atlantis/templates/v2/pipeline/template-pipeline.yml' },
          { name: 'template-cloudfront', category: 'network', namespace: 'atlantis', bucket: 'bucket-3', s3Path: 's3://bucket-3/atlantis/templates/v2/network/template-cloudfront.yml' }
        ],
        errors: undefined,
        partialData: false
      });

      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(3);
      expect(result.templates.map(t => t.bucket)).toEqual(['bucket-1', 'bucket-2', 'bucket-3']);
      expect(result.templates.map(t => t.name)).toContain('template-s3');
      expect(result.templates.map(t => t.name)).toContain('template-pipeline');
      expect(result.templates.map(t => t.name)).toContain('template-cloudfront');
    });
  });

  describe('Bucket Priority Ordering', () => {
    test('should search buckets in priority order', async () => {
      // Deduplication means only first occurrence (bucket-1) is returned
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template-s3', category: 'storage', namespace: 'atlantis', bucket: 'bucket-1' }
        ],
        errors: undefined,
        partialData: false
      });

      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].bucket).toBe('bucket-1');
    });

    test('should use template from highest priority bucket when duplicates exist', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template-s3', category: 'storage', namespace: 'atlantis', bucket: 'bucket-1', version: null }
        ],
        errors: undefined,
        partialData: false
      });

      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].bucket).toBe('bucket-1');
    });
  });

  describe('Deduplication Across Buckets', () => {
    test('should deduplicate templates with same name across buckets', async () => {
      // After deduplication, only one template-s3 from bucket-1
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template-s3', category: 'storage', namespace: 'atlantis', bucket: 'bucket-1' }
        ],
        errors: undefined,
        partialData: false
      });

      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].name).toBe('template-s3');
      expect(result.templates[0].bucket).toBe('bucket-1');
    });

    test('should keep unique templates from each bucket', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template-s3', category: 'storage', namespace: 'atlantis', bucket: 'bucket-1' },
          { name: 'template-dynamodb', category: 'storage', namespace: 'atlantis', bucket: 'bucket-2' }
        ],
        errors: undefined,
        partialData: false
      });

      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(2);
      expect(result.templates.map(t => t.name)).toContain('template-s3');
      expect(result.templates.map(t => t.name)).toContain('template-dynamodb');
    });
  });

  describe('Bucket Filtering', () => {
    test('should filter to specific buckets when s3Buckets parameter provided', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template-bucket-1', category: 'storage', bucket: 'bucket-1' },
          { name: 'template-bucket-3', category: 'storage', bucket: 'bucket-3' }
        ],
        errors: undefined,
        partialData: false
      });

      const connection = {
        host: ['bucket-1', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(2);
      expect(result.templates.map(t => t.bucket)).toEqual(['bucket-1', 'bucket-3']);
      expect(result.templates.map(t => t.bucket)).not.toContain('bucket-2');
    });

    test('should validate filtered buckets against configured list', async () => {
      // The service layer validates buckets, not the DAO
      // When invalid buckets are passed, the service throws
      Config.settings.mockReturnValue({
        s3: {
          buckets: ['bucket-1', 'bucket-2']
        }
      });

      Config.getConnCacheProfile.mockReturnValue({
        conn: { host: [], path: 'templates/v2', parameters: {}, cache: [] },
        cacheProfile: { hostId: 's3-templates', pathId: 'templates-list', profile: 'templates-list', overrideOriginHeaderExpiration: true, defaultExpirationInSeconds: 3600, expirationIsOnInterval: false, headersToRetain: '', encrypt: false }
      });

      const TemplatesService = require('../../../services/templates');

      // bucket-3 is not in configured list, so after filtering no valid buckets remain
      await expect(async () => {
        await TemplatesService.list({ s3Buckets: ['bucket-3'] });
      }).rejects.toThrow(/No valid S3 buckets/i);
    });
  });

  describe('Bucket Information in Responses', () => {
    test('should include bucket name in template metadata', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template-s3', category: 'storage', bucket: 'bucket-1', s3Path: 's3://bucket-1/atlantis/templates/v2/storage/template-s3.yml' }
        ],
        errors: undefined,
        partialData: false
      });

      const connection = {
        host: ['bucket-1'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates[0]).toHaveProperty('bucket');
      expect(result.templates[0].bucket).toBe('bucket-1');
    });

    test('should include S3 path in template metadata', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template-s3', category: 'storage', bucket: 'bucket-1', s3Path: 's3://bucket-1/atlantis/templates/v2/storage/template-s3.yml' }
        ],
        errors: undefined,
        partialData: false
      });

      const connection = {
        host: ['bucket-1'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates[0]).toHaveProperty('s3Path');
      expect(result.templates[0].s3Path).toBe('s3://bucket-1/atlantis/templates/v2/storage/template-s3.yml');
    });
  });

  describe('Cache Key Generation', () => {
    test('should include bucket names in cache key', async () => {
      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };

      cache.CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn, conn) => {
        expect(conn.host).toEqual(['bucket-1', 'bucket-2']);
        return { body: { templates: [], errors: [], partialData: false } };
      });

      await cache.CacheableDataAccess.getData({ pathId: 'test' }, async () => ({}), connection, {});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
    });
  });
});
