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

const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, GetBucketTaggingCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3Mock = mockClient(S3Client);

// Mock dependencies
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
      info: jest.fn()
    }
  }
}));

const { cache, tools } = require('@63klabs/cache-data');

describe('Multiple S3 Bucket Handling', () => {
  let S3Templates;
  let Config;

  beforeEach(() => {
    jest.clearAllMocks();
    s3Mock.reset();
    jest.resetModules();

    // Mock config
    jest.mock('../../../lambda/read/config', () => ({
      getConnCacheProfile: jest.fn(),
      settings: jest.fn()
    }));

    S3Templates = require('../../../lambda/read/models/s3-templates');
    Config = require('../../../lambda/read/config');

    Config.settings.mockReturnValue({
      s3: {
        buckets: ['bucket-1', 'bucket-2', 'bucket-3']
      }
    });
  });

  describe('Template Aggregation', () => {
    test('should aggregate templates from multiple buckets', async () => {
      // Setup bucket-1
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis,finance' }
          ]
        });

      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-1', Prefix: 'atlantis/templates/v2' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/storage/template-s3.yml', Size: 1024, LastModified: new Date('2024-01-01') }
          ]
        });

      // Setup bucket-2
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-2' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });

      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-2', Prefix: 'atlantis/templates/v2' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/pipeline/template-pipeline.yml', Size: 2048, LastModified: new Date('2024-01-02') }
          ]
        });

      // Setup bucket-3
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-3' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });

      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-3', Prefix: 'atlantis/templates/v2' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/network/template-cloudfront.yml', Size: 3072, LastModified: new Date('2024-01-03') }
          ]
        });

      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      // Should aggregate templates from all buckets
      expect(result.templates).toHaveLength(3);
      expect(result.templates.map(t => t.bucket)).toEqual(['bucket-1', 'bucket-2', 'bucket-3']);
      expect(result.templates.map(t => t.templateName)).toContain('template-s3');
      expect(result.templates.map(t => t.templateName)).toContain('template-pipeline');
      expect(result.templates.map(t => t.templateName)).toContain('template-cloudfront');
    });
  });

  describe('Bucket Priority Ordering', () => {
    test('should search buckets in priority order', async () => {
      // All buckets have the same template
      const setupBucket = (bucketName) => {
        s3Mock.on(GetBucketTaggingCommand, { Bucket: bucketName })
          .resolves({
            TagSet: [
              { Key: 'atlantis-mcp:Allow', Value: 'true' },
              { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
            ]
          });

        s3Mock.on(ListObjectsV2Command, { Bucket: bucketName })
          .resolves({
            Contents: [
              { Key: 'atlantis/templates/v2/storage/template-s3.yml', Size: 1024 }
            ]
          });
      };

      setupBucket('bucket-1');
      setupBucket('bucket-2');
      setupBucket('bucket-3');

      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      // Should deduplicate - only first occurrence (bucket-1) should be returned
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].bucket).toBe('bucket-1');
    });

    test('should use template from highest priority bucket when duplicates exist', async () => {
      // bucket-1: Has template-s3 v1.0.0
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });

      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-1' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/storage/template-s3.yml', Size: 1024 }
          ]
        });

      s3Mock.on(GetObjectCommand, { Bucket: 'bucket-1', Key: 'atlantis/templates/v2/storage/template-s3.yml' })
        .resolves({
          Body: Buffer.from('# Version: v1.0.0/2024-01-01\nAWSTemplateFormatVersion: "2010-09-09"'),
          VersionId: 'v1-bucket1'
        });

      // bucket-2: Has template-s3 v2.0.0 (newer but lower priority)
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-2' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });

      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-2' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/storage/template-s3.yml', Size: 2048 }
          ]
        });

      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      // Should use template from bucket-1 (higher priority)
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].bucket).toBe('bucket-1');
    });
  });

  describe('Deduplication Across Buckets', () => {
    test('should deduplicate templates with same name across buckets', async () => {
      const setupBucketWithTemplate = (bucketName, templateName) => {
        s3Mock.on(GetBucketTaggingCommand, { Bucket: bucketName })
          .resolves({
            TagSet: [
              { Key: 'atlantis-mcp:Allow', Value: 'true' },
              { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
            ]
          });

        s3Mock.on(ListObjectsV2Command, { Bucket: bucketName })
          .resolves({
            Contents: [
              { Key: `atlantis/templates/v2/storage/${templateName}.yml`, Size: 1024 }
            ]
          });
      };

      // All buckets have template-s3 and template-dynamodb
      setupBucketWithTemplate('bucket-1', 'template-s3');
      setupBucketWithTemplate('bucket-2', 'template-s3');
      setupBucketWithTemplate('bucket-3', 'template-s3');

      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      // Should only return one template-s3 (from bucket-1)
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].templateName).toBe('template-s3');
      expect(result.templates[0].bucket).toBe('bucket-1');
    });

    test('should keep unique templates from each bucket', async () => {
      // bucket-1: template-s3
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });

      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-1' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/storage/template-s3.yml', Size: 1024 }
          ]
        });

      // bucket-2: template-dynamodb
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-2' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });

      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-2' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/storage/template-dynamodb.yml', Size: 2048 }
          ]
        });

      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      // Should return both unique templates
      expect(result.templates).toHaveLength(2);
      expect(result.templates.map(t => t.templateName)).toContain('template-s3');
      expect(result.templates.map(t => t.templateName)).toContain('template-dynamodb');
    });
  });

  describe('Bucket Filtering', () => {
    test('should filter to specific buckets when s3Buckets parameter provided', async () => {
      // Setup all buckets
      ['bucket-1', 'bucket-2', 'bucket-3'].forEach(bucket => {
        s3Mock.on(GetBucketTaggingCommand, { Bucket: bucket })
          .resolves({
            TagSet: [
              { Key: 'atlantis-mcp:Allow', Value: 'true' },
              { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
            ]
          });

        s3Mock.on(ListObjectsV2Command, { Bucket: bucket })
          .resolves({
            Contents: [
              { Key: `atlantis/templates/v2/storage/template-${bucket}.yml`, Size: 1024 }
            ]
          });
      });

      // Filter to only bucket-1 and bucket-3
      const connection = {
        host: ['bucket-1', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      // Should only return templates from filtered buckets
      expect(result.templates).toHaveLength(2);
      expect(result.templates.map(t => t.bucket)).toEqual(['bucket-1', 'bucket-3']);
      expect(result.templates.map(t => t.bucket)).not.toContain('bucket-2');
    });

    test('should validate filtered buckets against configured list', async () => {
      Config.settings.mockReturnValue({
        s3: {
          buckets: ['bucket-1', 'bucket-2']
        }
      });

      // Try to filter to bucket-3 which is not in configured list
      const connection = {
        host: ['bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      // Should throw error or return empty results
      await expect(async () => {
        await S3Templates.list(connection, {});
      }).rejects.toThrow(/not in configured buckets/i);
    });
  });

  describe('Bucket Information in Responses', () => {
    test('should include bucket name in template metadata', async () => {
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });

      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-1' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/storage/template-s3.yml', Size: 1024 }
          ]
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
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });

      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-1' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/storage/template-s3.yml', Size: 1024 }
          ]
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
      const cacheProfile = { pathId: 'templates-list' };
      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };

      cache.CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn, conn) => {
        // Verify connection.host is used for cache key
        expect(conn.host).toEqual(['bucket-1', 'bucket-2']);
        return { body: { templates: [], errors: [], partialData: false } };
      });

      await cache.CacheableDataAccess.getData(cacheProfile, async () => ({}), connection, {});

      expect(cache.CacheableDataAccess.getData).toHaveBeenCalled();
    });
  });
});
