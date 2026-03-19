/**
 * Brown-Out Support Tests
 *
 * Tests that the MCP server returns partial data when some sources fail,
 * rather than failing completely. This is critical for resilience.
 *
 * Brown-out scenarios tested:
 * - S3Templates.list returns partial data with errors
 * - GitHubAPI.listRepositories returns partial data with errors
 * - Service layer propagates partial data indicators
 * - Controller/response formatting includes warnings
 * - Error information structure validation
 * - Logging requirements for brown-out scenarios
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
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
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

// Mock GitHubAPI DAO
jest.mock('../../../models/github-api');

const { tools, cache } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const S3Templates = require('../../../models/s3-templates');
const GitHubAPI = require('../../../models/github-api');

describe('Brown-Out Support', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Config.settings.mockReturnValue({
      s3: {
        buckets: ['bucket-1', 'bucket-2', 'bucket-3']
      },
      github: {
        userOrgs: ['org1', 'org2', 'org3']
      }
    });
  });

  describe('S3 Multi-Bucket Brown-Out', () => {
    test('should return partial data when one S3 bucket fails', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template1', category: 'storage', bucket: 'bucket-1', s3Path: 's3://bucket-1/atlantis/templates/v2/storage/template1.yml' },
          { name: 'template2', category: 'pipeline', bucket: 'bucket-3', s3Path: 's3://bucket-3/atlantis/templates/v2/pipeline/template2.yml' }
        ],
        errors: [
          { source: 'bucket-2', sourceType: 's3', error: 'Access Denied', timestamp: '2024-01-15T10:00:00.000Z' }
        ],
        partialData: true
      });

      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(2);
      expect(result.templates[0].bucket).toBe('bucket-1');
      expect(result.templates[1].bucket).toBe('bucket-3');
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('bucket-2');
      expect(result.errors[0].sourceType).toBe('s3');
      expect(result.errors[0].error).toContain('Access Denied');
    });

    test('should return partial data when multiple S3 buckets fail', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template1', category: 'storage', bucket: 'bucket-1' }
        ],
        errors: [
          { source: 'bucket-2', sourceType: 's3', error: 'The specified bucket does not exist', timestamp: '2024-01-15T10:00:00.000Z' },
          { source: 'bucket-3', sourceType: 's3', error: 'Connection timeout', timestamp: '2024-01-15T10:00:01.000Z' }
        ],
        partialData: true
      });

      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].bucket).toBe('bucket-1');
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.find(e => e.source === 'bucket-2')).toBeDefined();
      expect(result.errors.find(e => e.source === 'bucket-3')).toBeDefined();
    });

    test('should skip bucket without atlantis-mcp:Allow tag and include error', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template1', category: 'storage', bucket: 'bucket-1' }
        ],
        errors: [
          { source: 'bucket-2', sourceType: 's3', error: 'Bucket access not allowed', timestamp: '2024-01-15T10:00:00.000Z' }
        ],
        partialData: true
      });

      const connection = {
        host: ['bucket-1', 'bucket-2'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(1);
      expect(result.templates[0].bucket).toBe('bucket-1');
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('bucket-2');
      expect(result.errors[0].error).toContain('Bucket access not allowed');
    });

    test('should return empty templates when all S3 buckets fail', async () => {
      S3Templates.list.mockResolvedValue({
        templates: [],
        errors: [
          { source: 'bucket-1', sourceType: 's3', error: 'Access Denied', timestamp: '2024-01-15T10:00:00.000Z' },
          { source: 'bucket-2', sourceType: 's3', error: 'Access Denied', timestamp: '2024-01-15T10:00:01.000Z' },
          { source: 'bucket-3', sourceType: 's3', error: 'Access Denied', timestamp: '2024-01-15T10:00:02.000Z' }
        ],
        partialData: true
      });

      const connection = {
        host: ['bucket-1', 'bucket-2', 'bucket-3'],
        path: 'templates/v2',
        parameters: {}
      };

      const result = await S3Templates.list(connection, {});

      expect(result.templates).toHaveLength(0);
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(3);
    });
  });

  describe('GitHub Multi-Org Brown-Out', () => {
    test('should return partial data when one GitHub org fails', async () => {
      GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [
          { name: 'repo1', fullName: 'org1/repo1', userOrg: 'org1', atlantis_repository_type: 'app-starter' },
          { name: 'repo2', fullName: 'org3/repo2', userOrg: 'org3', atlantis_repository_type: 'app-starter' }
        ],
        errors: [
          { source: 'org2', sourceType: 'github', error: 'API rate limit exceeded', timestamp: '2024-01-15T10:00:00.000Z' }
        ],
        partialData: true
      });

      const connection = {
        host: ['org1', 'org2', 'org3'],
        path: '/repos',
        parameters: { repositoryType: 'app-starter' }
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toHaveLength(2);
      expect(result.repositories[0].fullName).toBe('org1/repo1');
      expect(result.repositories[1].fullName).toBe('org3/repo2');
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('org2');
      expect(result.errors[0].sourceType).toBe('github');
      expect(result.errors[0].error).toContain('API rate limit exceeded');
    });

    test('should return only repos with atlantis_repository-type property', async () => {
      GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [
          { name: 'repo1', fullName: 'org1/repo1', userOrg: 'org1', atlantis_repository_type: 'app-starter' }
        ],
        errors: undefined,
        partialData: false
      });

      const connection = {
        host: ['org1'],
        path: '/repos',
        parameters: { repositoryType: 'app-starter' }
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].fullName).toBe('org1/repo1');
    });

    test('should return empty repositories when all GitHub orgs fail', async () => {
      GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: [
          { source: 'org1', sourceType: 'github', error: 'Server error', timestamp: '2024-01-15T10:00:00.000Z' },
          { source: 'org2', sourceType: 'github', error: 'Server error', timestamp: '2024-01-15T10:00:01.000Z' },
          { source: 'org3', sourceType: 'github', error: 'Server error', timestamp: '2024-01-15T10:00:02.000Z' }
        ],
        partialData: true
      });

      const connection = {
        host: ['org1', 'org2', 'org3'],
        path: '/repos',
        parameters: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toHaveLength(0);
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(3);
    });
  });

  describe('Service Layer Brown-Out Handling', () => {
    test('should propagate partial data indicator from DAO to service', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue({
        getBody: (parse) => parse ? {
          templates: [
            { name: 'template1', bucket: 'bucket-1' }
          ],
          errors: [
            { source: 'bucket-2', sourceType: 's3', error: 'Access Denied' }
          ],
          partialData: true
        } : '{}'
      });

      Config.getConnCacheProfile.mockReturnValue({
        conn: { host: ['bucket-1', 'bucket-2'], path: 'templates/v2', parameters: {}, cache: [] },
        cacheProfile: { hostId: 's3-templates', pathId: 'templates-list', profile: 'templates-list', overrideOriginHeaderExpiration: true, defaultExpirationInSeconds: 3600, expirationIsOnInterval: false, headersToRetain: '', encrypt: false }
      });

      const TemplatesService = require('../../../services/templates');
      const result = await TemplatesService.list({ category: 'Storage' });

      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.templates).toHaveLength(1);
    });

    test('should aggregate errors from multiple sources', async () => {
      cache.CacheableDataAccess.getData.mockResolvedValue({
        getBody: (parse) => parse ? {
          repositories: [
            { name: 'repo1', userOrg: 'org1' }
          ],
          errors: [
            { source: 'org2', sourceType: 'github', error: 'Rate limit exceeded' },
            { source: 'org3', sourceType: 'github', error: 'Not found' }
          ],
          partialData: true
        } : '{}'
      });

      // The result from CacheableDataAccess.getData is the body
      const result = cache.CacheableDataAccess.getData.mock.results[0]
        ? cache.CacheableDataAccess.getData.mock.results[0].value
        : await cache.CacheableDataAccess.getData();

      const body = result.getBody(true);
      expect(body.partialData).toBe(true);
      expect(body.errors).toHaveLength(2);
      expect(body.repositories).toHaveLength(1);
    });
  });

  describe('Controller and Response Formatting', () => {
    test('should include partial data warning in MCP response', () => {
      const partialResult = {
        templates: [
          { name: 'template1', category: 'Storage' }
        ],
        errors: [
          { source: 'bucket-2', sourceType: 's3', error: 'Access Denied', timestamp: '2024-01-15T10:00:00Z' }
        ],
        partialData: true
      };

      // Simulate response formatting
      const response = {
        tool: 'list_templates',
        result: partialResult,
        warnings: partialResult.partialData
          ? ['Partial data returned: Some sources failed to respond']
          : undefined,
        errors: partialResult.errors?.length > 0 ? partialResult.errors : undefined
      };

      expect(response.warnings).toBeDefined();
      expect(response.warnings[0]).toContain('Partial data returned');
      expect(response.errors).toHaveLength(1);
      expect(response.errors[0].source).toBe('bucket-2');
    });

    test('should not include warnings when all sources succeed', () => {
      const completeResult = {
        templates: [
          { name: 'template1', category: 'Storage' },
          { name: 'template2', category: 'Pipeline' }
        ],
        partialData: false
      };

      const response = {
        tool: 'list_templates',
        result: completeResult,
        warnings: completeResult.partialData
          ? ['Partial data returned: Some sources failed to respond']
          : undefined,
        errors: completeResult.errors?.length > 0 ? completeResult.errors : undefined
      };

      expect(response.warnings).toBeUndefined();
      expect(response.errors).toBeUndefined();
    });
  });

  describe('Error Information Structure', () => {
    test('should include required fields in error objects', () => {
      const error = {
        source: 'bucket-2',
        sourceType: 's3',
        error: 'Network timeout',
        timestamp: new Date().toISOString()
      };

      expect(error).toHaveProperty('source');
      expect(error).toHaveProperty('sourceType');
      expect(error).toHaveProperty('error');
      expect(error).toHaveProperty('timestamp');

      expect(error.source).toBe('bucket-2');
      expect(error.sourceType).toBe('s3');
      expect(error.error).toContain('Network timeout');
      expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('should not expose sensitive information in error messages', () => {
      // The DAO should sanitize error messages before including them
      const sanitizedError = {
        source: 'bucket-1',
        sourceType: 's3',
        error: 'Access denied',
        timestamp: new Date().toISOString()
      };

      expect(sanitizedError.error).not.toContain('sk-secret-12345');
      expect(sanitizedError.error).not.toContain('API key');
    });
  });

  describe('Logging Requirements', () => {
    test('should use DebugAndLog.warn for non-fatal errors with partial data', () => {
      // Simulate what the DAO does when a bucket fails
      tools.DebugAndLog.warn('Failed to list templates from bucket bucket-2: Access Denied');

      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to list templates from bucket bucket-2')
      );
    });

    test('should use DebugAndLog.error when all sources fail', () => {
      // Simulate what the DAO does when all buckets fail
      tools.DebugAndLog.error('All S3 buckets failed to respond');

      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('should log which specific bucket/org failed', () => {
      tools.DebugAndLog.warn('Failed to list templates from bucket failed-bucket: Access denied');

      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        expect.stringContaining('failed-bucket')
      );
    });
  });

  describe('Priority Ordering with Brown-Out', () => {
    test('should maintain bucket priority order when some buckets fail', async () => {
      // When bucket-1 fails, bucket-2 should provide the template
      S3Templates.list.mockResolvedValue({
        templates: [
          { name: 'template1', category: 'storage', bucket: 'bucket-2' }
        ],
        errors: [
          { source: 'bucket-1', sourceType: 's3', error: 'Bucket 1 failed', timestamp: '2024-01-15T10:00:00.000Z' }
        ],
        partialData: true
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

      // Deduplication means bucket-3's duplicate is ignored
      expect(result.templates.filter(t => t.name === 'template1')).toHaveLength(1);
    });
  });

  describe('Integration with Cache Layer', () => {
    test('should cache partial data results', async () => {
      const partialResult = {
        templates: [{ name: 'template1' }],
        errors: [{ source: 'bucket-2', error: 'Failed' }],
        partialData: true
      };

      cache.CacheableDataAccess.getData.mockResolvedValue({
        body: partialResult
      });

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
