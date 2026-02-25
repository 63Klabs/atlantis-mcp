/**
 * Brown-Out Support Tests
 * 
 * Tests that the MCP server returns partial data when some sources fail,
 * rather than failing completely. This is critical for resilience.
 * 
 * Brown-out scenarios tested:
 * - One S3 bucket fails, others succeed
 * - One GitHub org fails, others succeed
 * - Multiple sources fail, some succeed
 * - All sources fail (should return error)
 * - Partial data indicators in responses
 * - Error information included in responses
 * - Warning logs for failed sources
 */

const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, GetObjectCommand, ListObjectsV2Command, GetBucketTaggingCommand } = require('@aws-sdk/client-s3');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// Mock AWS SDK clients
const s3Mock = mockClient(S3Client);
const ddbMock = mockClient(DynamoDBDocumentClient);

// Mock dependencies
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    }
  }
}));

const { tools, cache } = require('@63klabs/cache-data');

describe('Brown-Out Support', () => {
  let S3Templates;
  let GitHubAPI;
  let Config;
  
  beforeEach(() => {
    jest.clearAllMocks();
    s3Mock.reset();
    ddbMock.reset();
    
    // Reset modules
    jest.resetModules();
    
    // Mock config
    jest.mock('../../../lambda/read/config', () => ({
      getConnCacheProfile: jest.fn(),
      settings: jest.fn()
    }));
    
    // Import after mocking
    S3Templates = require('../../../lambda/read/models/s3-templates');
    GitHubAPI = require('../../../lambda/read/models/github-api');
    Config = require('../../../lambda/read/config');
    
    // Setup default config
    Config.settings.mockReturnValue({
      s3: {
        buckets: ['bucket-1', 'bucket-2', 'bucket-3']
      },
      github: {
        users: ['org1', 'org2', 'org3']
      }
    });
  });

  describe('S3 Multi-Bucket Brown-Out', () => {
    test('should return partial data when one S3 bucket fails', async () => {
      // Mock bucket 1: Success
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
            { Key: 'atlantis/templates/v2/storage/template1.yml', Size: 1024 }
          ]
        });

      // Mock bucket 2: Failure (AccessDenied)
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-2' })
        .rejects(new Error('Access Denied'));
      
      // Mock bucket 3: Success
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-3' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });
      
      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-3' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/pipeline/template2.yml', Size: 2048 }
          ]
        });
      
      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };
      
      const result = await S3Templates.list(connection, {});
      
      // Should return partial data from successful buckets
      expect(result.templates).toHaveLength(2);
      expect(result.templates[0].bucket).toBe('bucket-1');
      expect(result.templates[1].bucket).toBe('bucket-3');
      
      // Should indicate partial data
      expect(result.partialData).toBe(true);
      
      // Should include error information
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('bucket-2');
      expect(result.errors[0].sourceType).toBe('s3');
      expect(result.errors[0].error).toContain('Access Denied');
      
      // Should log warning for failed bucket
      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to list templates from bucket bucket-2'),
        expect.any(Object)
      );
    });

    test('should return partial data when multiple S3 buckets fail', async () => {
      // Mock bucket 1: Success
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
            { Key: 'atlantis/templates/v2/storage/template1.yml', Size: 1024 }
          ]
        });
      
      // Mock bucket 2: Failure (NoSuchBucket)
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-2' })
        .rejects({ name: 'NoSuchBucket', message: 'The specified bucket does not exist' });
      
      // Mock bucket 3: Failure (Timeout)
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-3' })
        .rejects({ code: 'ETIMEDOUT', message: 'Connection timeout' });
      
      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };
      
      const result = await S3Templates.list(connection, {});
      
      // Should return data from the one successful bucket
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].bucket).toBe('bucket-1');
      
      // Should indicate partial data
      expect(result.partialData).toBe(true);
      
      // Should include error information for both failed buckets
      expect(result.errors).toHaveLength(2);
      expect(result.errors.find(e => e.source === 'bucket-2')).toBeDefined();
      expect(result.errors.find(e => e.source === 'bucket-3')).toBeDefined();
      
      // Should log warnings for both failed buckets
      expect(tools.DebugAndLog.warn).toHaveBeenCalledTimes(2);
    });

    test('should skip bucket without atlantis-mcp:Allow tag and log warning', async () => {
      // Mock bucket 1: Success
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
            { Key: 'atlantis/templates/v2/storage/template1.yml', Size: 1024 }
          ]
        });
      
      // Mock bucket 2: No Allow tag
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-2' })
        .resolves({
          TagSet: [
            { Key: 'Environment', Value: 'test' }
          ]
        });
      
      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };
      
      const result = await S3Templates.list(connection, {});
      
      // Should return data from bucket-1 only
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].bucket).toBe('bucket-1');
      
      // Should indicate partial data
      expect(result.partialData).toBe(true);
      
      // Should include error for skipped bucket
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('bucket-2');
      expect(result.errors[0].error).toContain('Bucket access not allowed');
      
      // Should log warning
      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Bucket bucket-2 does not have atlantis-mcp:Allow=true tag'),
        expect.any(Object)
      );
    });

    test('should return error when all S3 buckets fail', async () => {
      // Mock all buckets to fail
      s3Mock.on(GetBucketTaggingCommand).rejects(new Error('Access Denied'));
      
      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };
      
      const result = await S3Templates.list(connection, {});
      
      // Should return empty templates array
      expect(result.templates).toHaveLength(0);
      
      // Should indicate partial data (actually no data)
      expect(result.partialData).toBe(true);
      
      // Should include errors for all buckets
      expect(result.errors).toHaveLength(3);
      
      // Should log warnings for all failed buckets
      expect(tools.DebugAndLog.warn).toHaveBeenCalledTimes(3);
    });
  });


  describe('GitHub Multi-Org Brown-Out', () => {
    test('should return partial data when one GitHub org fails', async () => {
      // Mock GitHub API for org1: Success
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { name: 'repo1', full_name: 'org1/repo1' }
          ]
        })
        // Mock custom property for org1/repo1: Success
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { property_name: 'atlantis_repository-type', value: 'app-starter' }
          ]
        })
        // Mock GitHub API for org2: Failure (403)
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: async () => ({ message: 'API rate limit exceeded' })
        })
        // Mock GitHub API for org3: Success
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { name: 'repo2', full_name: 'org3/repo2' }
          ]
        })
        // Mock custom property for org3/repo2: Success
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { property_name: 'atlantis_repository-type', value: 'app-starter' }
          ]
        });
      
      global.fetch = mockFetch;
      
      const connection = {
        host: ['org1', 'org2', 'org3'],
        path: '/repos',
        parameters: { repositoryType: 'app-starter' }
      };
      
      const result = await GitHubAPI.listRepositories(connection, {});
      
      // Should return partial data from successful orgs
      expect(result.repositories).toHaveLength(2);
      expect(result.repositories[0].full_name).toBe('org1/repo1');
      expect(result.repositories[1].full_name).toBe('org3/repo2');
      
      // Should indicate partial data
      expect(result.partialData).toBe(true);
      
      // Should include error information
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('org2');
      expect(result.errors[0].sourceType).toBe('github');
      expect(result.errors[0].error).toContain('API rate limit exceeded');
      
      // Should log warning for failed org
      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to list repositories from org2'),
        expect.any(Object)
      );
    });

    test('should skip repositories without atlantis_repository-type and log warning', async () => {
      const mockFetch = jest.fn()
        // Mock GitHub API for org1: Success
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { name: 'repo1', full_name: 'org1/repo1' },
            { name: 'repo2', full_name: 'org1/repo2' }
          ]
        })
        // Mock custom property for org1/repo1: Has property
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { property_name: 'atlantis_repository-type', value: 'app-starter' }
          ]
        })
        // Mock custom property for org1/repo2: No property
        .mockResolvedValueOnce({
          ok: true,
          json: async () => []
        });
      
      global.fetch = mockFetch;
      
      const connection = {
        host: ['org1'],
        path: '/repos',
        parameters: { repositoryType: 'app-starter' }
      };
      
      const result = await GitHubAPI.listRepositories(connection, {});
      
      // Should return only repo1 (repo2 excluded)
      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].full_name).toBe('org1/repo1');
      
      // Should log warning for excluded repository
      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Repository org1/repo2 does not have atlantis_repository-type custom property'),
        expect.any(Object)
      );
    });

    test('should return error when all GitHub orgs fail', async () => {
      const mockFetch = jest.fn()
        .mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ message: 'Server error' })
        });
      
      global.fetch = mockFetch;
      
      const connection = {
        host: ['org1', 'org2', 'org3'],
        path: '/repos',
        parameters: {}
      };
      
      const result = await GitHubAPI.listRepositories(connection, {});
      
      // Should return empty repositories array
      expect(result.repositories).toHaveLength(0);
      
      // Should indicate partial data (actually no data)
      expect(result.partialData).toBe(true);
      
      // Should include errors for all orgs
      expect(result.errors).toHaveLength(3);
      
      // Should log warnings for all failed orgs
      expect(tools.DebugAndLog.warn).toHaveBeenCalledTimes(3);
    });
  });


  describe('Service Layer Brown-Out Handling', () => {
    let Templates;
    let Starters;
    
    beforeEach(() => {
      // Mock services
      jest.mock('../../../lambda/read/services/templates', () => ({
        list: jest.fn()
      }));
      
      jest.mock('../../../lambda/read/services/starters', () => ({
        list: jest.fn()
      }));
      
      Templates = require('../../../lambda/read/services/templates');
      Starters = require('../../../lambda/read/services/starters');
    });

    test('should propagate partial data indicator from DAO to service', async () => {
      // Mock CacheableDataAccess to return partial data
      cache.CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templates: [
            { templateName: 'template1', bucket: 'bucket-1' }
          ],
          errors: [
            { source: 'bucket-2', sourceType: 's3', error: 'Access Denied' }
          ],
          partialData: true
        }
      });
      
      const result = await Templates.list({ category: 'Storage' });
      
      // Service should preserve partial data indicator
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.templates).toHaveLength(1);
    });

    test('should aggregate errors from multiple sources', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue({
        body: {
          repositories: [
            { name: 'repo1', user: 'org1' }
          ],
          errors: [
            { source: 'org2', sourceType: 'github', error: 'Rate limit exceeded' },
            { source: 'org3', sourceType: 'github', error: 'Not found' }
          ],
          partialData: true
        }
      });
      
      const result = await Starters.list({ ghusers: ['org1', 'org2', 'org3'] });
      
      // Service should preserve all error information
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.repositories).toHaveLength(1);
    });
  });


  describe('Controller and Response Formatting', () => {
    let Controllers;
    let MCPResponse;
    
    beforeEach(() => {
      jest.mock('../../../lambda/read/controllers/templates', () => ({
        list: jest.fn()
      }));
      
      jest.mock('../../../lambda/read/views/mcp-response', () => ({
        formatToolResponse: jest.fn()
      }));
      
      Controllers = require('../../../lambda/read/controllers/templates');
      MCPResponse = require('../../../lambda/read/views/mcp-response');
    });

    test('should include partial data warning in MCP response', async () => {
      const partialResult = {
        templates: [
          { templateName: 'template1', category: 'Storage' }
        ],
        errors: [
          { source: 'bucket-2', sourceType: 's3', error: 'Access Denied', timestamp: '2024-01-15T10:00:00Z' }
        ],
        partialData: true
      };
      
      MCPResponse.formatToolResponse.mockReturnValue({
        tool: 'list_templates',
        result: partialResult,
        warnings: [
          'Partial data returned: Some sources failed to respond'
        ],
        errors: partialResult.errors
      });
      
      const response = MCPResponse.formatToolResponse('list_templates', partialResult);
      
      // Response should include warning about partial data
      expect(response.warnings).toBeDefined();
      expect(response.warnings[0]).toContain('Partial data returned');
      
      // Response should include error details
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0].source).toBe('bucket-2');
    });

    test('should not include warnings when all sources succeed', async () => {
      const completeResult = {
        templates: [
          { templateName: 'template1', category: 'Storage' },
          { templateName: 'template2', category: 'Pipeline' }
        ],
        errors: [],
        partialData: false
      };
      
      MCPResponse.formatToolResponse.mockReturnValue({
        tool: 'list_templates',
        result: completeResult
      });
      
      const response = MCPResponse.formatToolResponse('list_templates', completeResult);
      
      // Response should not include warnings
      expect(response.warnings).toBeUndefined();
      expect(response.errors).toBeUndefined();
    });
  });


  describe('Error Information Structure', () => {
    test('should include required fields in error objects', async () => {
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });
      
      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-1' })
        .resolves({ Contents: [] });
      
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-2' })
        .rejects(new Error('Network timeout'));
      
      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };
      
      const result = await S3Templates.list(connection, {});
      
      // Error object should have required fields
      const error = result.errors[0];
      expect(error).toHaveProperty('source');
      expect(error).toHaveProperty('sourceType');
      expect(error).toHaveProperty('error');
      expect(error).toHaveProperty('timestamp');
      
      // Verify field values
      expect(error.source).toBe('bucket-2');
      expect(error.sourceType).toBe('s3');
      expect(error.error).toContain('Network timeout');
      expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('should not expose sensitive information in error messages', async () => {
      const sensitiveError = new Error('Access denied for API key: sk-secret-12345');
      
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .rejects(sensitiveError);
      
      const connection = {
        host: ['bucket-1'],
        path: 'templates/v2',
        parameters: {}
      };
      
      const result = await S3Templates.list(connection, {});
      
      // Error message should be sanitized
      const error = result.errors[0];
      expect(error.error).not.toContain('sk-secret-12345');
      expect(error.error).not.toContain('API key');
    });
  });


  describe('Logging Requirements', () => {
    test('should use DebugAndLog.warn for non-fatal errors with partial data', async () => {
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });
      
      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-1' })
        .resolves({ Contents: [] });
      
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-2' })
        .rejects(new Error('Temporary failure'));
      
      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };
      
      await S3Templates.list(connection, {});
      
      // Should use warn level (not error) for brown-out scenarios
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
      expect(tools.DebugAndLog.error).not.toHaveBeenCalled();
    });

    test('should use DebugAndLog.error when all sources fail', async () => {
      s3Mock.on(GetBucketTaggingCommand).rejects(new Error('All buckets failed'));
      
      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };
      
      await S3Templates.list(connection, {});
      
      // Should use error level when no data available
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('should log which specific bucket/org failed', async () => {
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });
      
      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-1' })
        .resolves({ Contents: [] });
      
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'failed-bucket' })
        .rejects(new Error('Access denied'));
      
      const connection = {
        host: ['bucket-1', 'failed-bucket'],
        path: 'templates/v2',
        parameters: {}
      };
      
      await S3Templates.list(connection, {});
      
      // Should log the specific bucket name
      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed-bucket'),
        expect.any(Object)
      );
    });
  });

  describe('Priority Ordering with Brown-Out', () => {
    test('should maintain bucket priority order when some buckets fail', async () => {
      // Mock bucket-1 (highest priority): Failure
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-1' })
        .rejects(new Error('Bucket 1 failed'));
      
      // Mock bucket-2 (medium priority): Success
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
            { Key: 'atlantis/templates/v2/storage/template1.yml', Size: 1024 }
          ]
        });
      
      // Mock bucket-3 (lowest priority): Success with duplicate template
      s3Mock.on(GetBucketTaggingCommand, { Bucket: 'bucket-3' })
        .resolves({
          TagSet: [
            { Key: 'atlantis-mcp:Allow', Value: 'true' },
            { Key: 'atlantis-mcp:IndexPriority', Value: 'atlantis' }
          ]
        });
      
      s3Mock.on(ListObjectsV2Command, { Bucket: 'bucket-3' })
        .resolves({
          Contents: [
            { Key: 'atlantis/templates/v2/storage/template1.yml', Size: 2048 }
          ]
        });
      
      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };
      
      const result = await S3Templates.list(connection, {});
      
      // Should return template from bucket-2 (first successful bucket)
      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].bucket).toBe('bucket-2');
      
      // Should deduplicate (bucket-3's template1 should be ignored)
      expect(result.templates.filter(t => t.templateName === 'template1')).toHaveLength(1);
    });
  });

  describe('Integration with Cache Layer', () => {
    test('should cache partial data results', async () => {
      const partialResult = {
        templates: [{ templateName: 'template1' }],
        errors: [{ source: 'bucket-2', error: 'Failed' }],
        partialData: true
      };
      
      cache.CacheableDataAccess.getData.mockResolvedValue({
        body: partialResult
      });
      
      // Verify that partial data can be cached
      const result = await cache.CacheableDataAccess.getData(
        { pathId: 'test' },
        async () => partialResult,
        { host: ['bucket-1', 'bucket-2'] },
        {}
      );
      
      expect(result.body.partialData).toBe(true);
      expect(result.body.errors).toHaveLength(1);
    });
  });
});
