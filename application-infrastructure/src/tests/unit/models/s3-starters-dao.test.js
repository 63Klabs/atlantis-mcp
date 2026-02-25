/**
 * Unit Tests for S3 App Starters DAO
 * 
 * Tests all functions in the S3 App Starters Data Access Object including:
 * - list() function with multi-bucket support
 * - get() function
 * - Helper functions for sidecar metadata
 */

const { S3Client, GetObjectCommand, ListObjectsV2Command, GetObjectTaggingCommand } = require('@aws-sdk/client-s3');
const { mockClient } = require('aws-sdk-client-mock');
const S3Starters = require('../../../lambda/read/models/s3-starters');

// Mock S3 client
const s3Mock = mockClient(S3Client);

// Mock DebugAndLog
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  }
}));

describe('S3 App Starters DAO', () => {
  beforeEach(() => {
    s3Mock.reset();
    jest.clearAllMocks();
  });

  describe('11.5.8 - list() function', () => {
    it('should list starters with sidecar metadata', async () => {
      // Mock namespace discovery
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [
          { Prefix: 'atlantis/' }
        ]
      });

      // Mock starter listing
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Prefix: 'atlantis/app-starters/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/app-starters/v2/node-express-api.zip',
            LastModified: new Date('2024-01-01'),
            Size: 1024000
          },
          {
            Key: 'atlantis/app-starters/v2/python-flask-api.zip',
            LastModified: new Date('2024-01-02'),
            Size: 2048000
          }
        ]
      });

      // Mock sidecar metadata for node-express-api
      const metadata1 = JSON.stringify({
        name: 'node-express-api',
        description: 'Node.js Express API starter',
        language: 'Node.js',
        framework: 'Express',
        features: ['REST API', 'Authentication'],
        prerequisites: ['Node.js 20+'],
        author: '63Klabs',
        license: 'MIT',
        githubUrl: 'https://github.com/63klabs/node-express-api',
        cacheDataIntegration: true,
        cloudFrontIntegration: false
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/node-express-api.json'
      }).resolves({
        Body: {
          transformToString: async () => metadata1
        }
      });

      // Mock sidecar metadata for python-flask-api
      const metadata2 = JSON.stringify({
        name: 'python-flask-api',
        description: 'Python Flask API starter',
        language: 'Python',
        framework: 'Flask',
        features: ['REST API'],
        prerequisites: ['Python 3.11+'],
        author: '63Klabs',
        license: 'MIT',
        githubUrl: 'https://github.com/63klabs/python-flask-api'
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/python-flask-api.json'
      }).resolves({
        Body: {
          transformToString: async () => metadata2
        }
      });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {}
      };

      const result = await S3Starters.list(connection, {});

      expect(result.starters).toHaveLength(2);
      expect(result.starters[0].name).toBe('node-express-api');
      expect(result.starters[0].language).toBe('Node.js');
      expect(result.starters[0].cacheDataIntegration).toBe(true);
      expect(result.starters[1].name).toBe('python-flask-api');
      expect(result.starters[1].language).toBe('Python');
      expect(result.partialData).toBe(false);
    });

    it('should skip starters without sidecar metadata', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Prefix: 'atlantis/app-starters/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/app-starters/v2/node-express-api.zip',
            LastModified: new Date(),
            Size: 1024000
          }
        ]
      });

      // No sidecar metadata file
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/node-express-api.json'
      }).rejects({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {}
      };

      const result = await S3Starters.list(connection, {});

      expect(result.starters).toHaveLength(0);
      expect(result.partialData).toBe(false);
    });

    it('should deduplicate starters across multiple buckets', async () => {
      // Mock namespace discovery for bucket1
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket1',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // Mock namespace discovery for bucket2
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket2',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // Mock starter listing for bucket1
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket1',
        Prefix: 'atlantis/app-starters/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/app-starters/v2/node-express-api.zip',
            LastModified: new Date('2024-01-01'),
            Size: 1024000
          }
        ]
      });

      // Mock starter listing for bucket2
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket2',
        Prefix: 'atlantis/app-starters/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/app-starters/v2/node-express-api.zip',
            LastModified: new Date('2024-01-02'),
            Size: 2048000
          }
        ]
      });

      const metadata = JSON.stringify({
        name: 'node-express-api',
        description: 'Node.js Express API starter',
        language: 'Node.js'
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => metadata
        }
      });

      const connection = {
        host: ['bucket1', 'bucket2'],
        path: 'app-starters/v2',
        parameters: {}
      };

      const result = await S3Starters.list(connection, {});

      // Should deduplicate - first occurrence wins
      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].bucket).toBe('bucket1');
    });

    it('should support brown-out when bucket fails', async () => {
      // Mock namespace discovery for bucket1 (fails)
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket1',
        Delimiter: '/',
        MaxKeys: 100
      }).rejects(new Error('Access Denied'));

      // Mock namespace discovery for bucket2 (succeeds)
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket2',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'bucket2',
        Prefix: 'atlantis/app-starters/v2/'
      }).resolves({
        Contents: [
          {
            Key: 'atlantis/app-starters/v2/node-express-api.zip',
            LastModified: new Date(),
            Size: 1024000
          }
        ]
      });

      const metadata = JSON.stringify({
        name: 'node-express-api',
        description: 'Node.js Express API starter',
        language: 'Node.js'
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => metadata
        }
      });

      const connection = {
        host: ['bucket1', 'bucket2'],
        path: 'app-starters/v2',
        parameters: {}
      };

      const result = await S3Starters.list(connection, {});

      expect(result.starters).toHaveLength(1);
      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('11.5.9 - get() function', () => {
    it('should get specific starter with metadata', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // Mock ZIP file exists
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/node-express-api.zip'
      }).resolves({
        ContentLength: 1024000,
        LastModified: new Date('2024-01-01')
      });

      // Mock sidecar metadata
      const metadata = JSON.stringify({
        name: 'node-express-api',
        description: 'Node.js Express API starter',
        language: 'Node.js',
        framework: 'Express',
        features: ['REST API', 'Authentication'],
        prerequisites: ['Node.js 20+'],
        author: '63Klabs',
        license: 'MIT',
        githubUrl: 'https://github.com/63klabs/node-express-api',
        cacheDataIntegration: true
      });

      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/node-express-api.json'
      }).resolves({
        Body: {
          transformToString: async () => metadata
        }
      });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {
          starterName: 'node-express-api'
        }
      };

      const result = await S3Starters.get(connection, {});

      expect(result).not.toBeNull();
      expect(result.name).toBe('node-express-api');
      expect(result.language).toBe('Node.js');
      expect(result.framework).toBe('Express');
      expect(result.cacheDataIntegration).toBe(true);
      expect(result.zipSize).toBe(1024000);
    });

    it('should return null if starter not found', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      s3Mock.on(GetObjectCommand).rejects({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {
          starterName: 'nonexistent'
        }
      };

      const result = await S3Starters.get(connection, {});

      expect(result).toBeNull();
    });

    it('should skip starter without sidecar metadata', async () => {
      s3Mock.on(ListObjectsV2Command, {
        Bucket: 'test-bucket',
        Delimiter: '/',
        MaxKeys: 100
      }).resolves({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // ZIP exists
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/node-express-api.zip'
      }).resolves({
        ContentLength: 1024000,
        LastModified: new Date()
      });

      // No sidecar metadata
      s3Mock.on(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 'atlantis/app-starters/v2/node-express-api.json'
      }).rejects({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {
          starterName: 'node-express-api'
        }
      };

      const result = await S3Starters.get(connection, {});

      expect(result).toBeNull();
    });

    it('should return null if starterName not provided', async () => {
      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {}
      };

      const result = await S3Starters.get(connection, {});

      expect(result).toBeNull();
    });
  });

  describe('Helper Functions', () => {
    it('parseSidecarMetadata should parse valid JSON', () => {
      const metadata = JSON.stringify({
        name: 'test-starter',
        description: 'Test description',
        language: 'Node.js',
        framework: 'Express',
        features: ['Feature 1', 'Feature 2'],
        prerequisites: ['Node.js 20+'],
        author: 'Test Author',
        license: 'MIT',
        githubUrl: 'https://github.com/test/repo',
        cache_data_integration: true,
        cloudfront_integration: false
      });

      const result = S3Starters.parseSidecarMetadata(metadata);

      expect(result.name).toBe('test-starter');
      expect(result.language).toBe('Node.js');
      expect(result.features).toHaveLength(2);
      expect(result.cacheDataIntegration).toBe(true);
      expect(result.cloudFrontIntegration).toBe(false);
    });

    it('parseSidecarMetadata should handle invalid JSON', () => {
      const result = S3Starters.parseSidecarMetadata('invalid json {{{');

      expect(result.name).toBe('');
      expect(result.description).toBe('');
      expect(result.features).toEqual([]);
    });

    it('buildStarterZipKey should construct correct key', () => {
      const result = S3Starters.buildStarterZipKey('atlantis', 'app-starters/v2', 'node-express-api');
      expect(result).toBe('atlantis/app-starters/v2/node-express-api.zip');
    });

    it('buildStarterMetadataKey should construct correct key', () => {
      const result = S3Starters.buildStarterMetadataKey('atlantis', 'app-starters/v2', 'node-express-api');
      expect(result).toBe('atlantis/app-starters/v2/node-express-api.json');
    });

    it('extractAppNameFromKey should extract name from ZIP key', () => {
      const result = S3Starters.extractAppNameFromKey('atlantis/app-starters/v2/node-express-api.zip');
      expect(result).toBe('node-express-api');
    });

    it('deduplicateStarters should remove duplicates', () => {
      const starters = [
        { name: 'starter1', bucket: 'bucket1' },
        { name: 'starter1', bucket: 'bucket2' },
        { name: 'starter2', bucket: 'bucket1' }
      ];

      const result = S3Starters.deduplicateStarters(starters);

      expect(result).toHaveLength(2);
      expect(result[0].bucket).toBe('bucket1'); // First occurrence wins
    });
  });
});
