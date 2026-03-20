/**
 * Unit Tests for S3 App Starters DAO
 *
 * Tests all functions in the S3 App Starters Data Access Object including:
 * - list() function with multi-bucket support
 * - get() function
 * - Helper functions for sidecar metadata
 * 
 * NOTE: This DAO uses AWS.s3.client from @63klabs/cache-data package,
 * so we mock that instead of S3Client directly.
 */

// Mock @63klabs/cache-data AWS.s3.client
const mockS3Send = jest.fn();
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    AWS: {
      s3: {
        client: {
          send: mockS3Send
        }
      }
    }
  }
}));

// Now import the module (it will use the mocked AWS.s3.client)
const S3Starters = require('../../../models/s3-starters');

describe('S3 App Starters DAO', () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  describe('11.5.8 - list() function', () => {
    it('should list starters with sidecar metadata', async () => {
      // Mock namespace discovery
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [
          { Prefix: 'atlantis/' }
        ]
      });

      // Mock starter listing
      mockS3Send.mockResolvedValueOnce({
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
        languages: ['Node.js'],
        frameworks: ['Express'],
        features: ['REST API', 'Authentication'],
        prerequisites: ['Node.js 20+'],
        author: '63Klabs',
        license: 'MIT',
        repository: 'https://github.com/63klabs/node-express-api',
        hasCacheData: true,
        deployment_platform: 'atlantis'
      });

      mockS3Send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => metadata1
        }
      });

      // Mock sidecar metadata for python-flask-api
      const metadata2 = JSON.stringify({
        name: 'python-flask-api',
        description: 'Python Flask API starter',
        languages: ['Python'],
        frameworks: ['Flask'],
        features: ['REST API'],
        prerequisites: ['Python 3.11+'],
        author: '63Klabs',
        license: 'MIT',
        repository: 'https://github.com/63klabs/python-flask-api'
      });

      mockS3Send.mockResolvedValueOnce({
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
      expect(result.starters[0].languages).toEqual(['Node.js']);
      expect(result.starters[0].frameworks).toEqual(['Express']);
      expect(result.starters[0].hasSidecarMetadata).toBe(true);
      expect(result.starters[1].name).toBe('python-flask-api');
      expect(result.starters[1].languages).toEqual(['Python']);
      expect(result.starters[1].frameworks).toEqual(['Flask']);
      expect(result.partialData).toBe(false);
    });

    it('should include starters without sidecar metadata with minimal metadata', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'atlantis/app-starters/v2/node-express-api.zip',
            LastModified: new Date(),
            Size: 1024000
          }
        ]
      });

      // No sidecar metadata file
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: {}
      };

      const result = await S3Starters.list(connection, {});

      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].name).toBe('node-express-api');
      expect(result.starters[0].hasSidecarMetadata).toBe(false);
      expect(result.starters[0].languages).toEqual([]);
      expect(result.starters[0].frameworks).toEqual([]);
      expect(result.partialData).toBe(false);
    });

    it('should deduplicate starters across multiple buckets', async () => {
      // Mock namespace discovery for bucket1
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // Mock starter listing for bucket1
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'atlantis/app-starters/v2/node-express-api.zip',
            LastModified: new Date('2024-01-01'),
            Size: 1024000
          }
        ]
      });

      const metadata = JSON.stringify({
        name: 'node-express-api',
        description: 'Node.js Express API starter',
        languages: ['Node.js']
      });

      // Mock sidecar metadata for bucket1
      mockS3Send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => metadata
        }
      });

      // Mock namespace discovery for bucket2
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // Mock starter listing for bucket2
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'atlantis/app-starters/v2/node-express-api.zip',
            LastModified: new Date('2024-01-02'),
            Size: 2048000
          }
        ]
      });

      // Mock sidecar metadata for bucket2
      mockS3Send.mockResolvedValueOnce({
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
      mockS3Send.mockRejectedValueOnce(new Error('Access Denied'));

      // Mock namespace discovery for bucket2 (succeeds)
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // Mock starter listing for bucket2
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'atlantis/app-starters/v2/node-express-api.zip',
            LastModified: new Date(),
            Size: 1024000
          }
        ]
      });

      const brownOutMetadata = JSON.stringify({
        name: 'node-express-api',
        description: 'Node.js Express API starter',
        languages: ['Node.js']
      });

      // Mock sidecar metadata for bucket2
      mockS3Send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => brownOutMetadata
        }
      });

      const connection = {
        host: ['bucket1', 'bucket2'],
        path: 'app-starters/v2',
        parameters: {}
      };

      const result = await S3Starters.list(connection, {});

      // The current implementation doesn't add errors when namespace discovery fails
      // It just skips that bucket and continues with others
      expect(result.starters).toHaveLength(1);
      expect(result.partialData).toBe(false); // No errors tracked for namespace discovery failures
      expect(result.errors).toBeUndefined(); // Errors array is undefined when no errors
    });
  });

  describe('11.5.9 - get() function', () => {
    it('should get specific starter with metadata', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // Mock ZIP file exists
      mockS3Send.mockResolvedValueOnce({
        ContentLength: 1024000,
        LastModified: new Date('2024-01-01')
      });

      // Mock sidecar metadata
      const metadata = JSON.stringify({
        name: 'node-express-api',
        description: 'Node.js Express API starter',
        languages: ['Node.js'],
        frameworks: ['Express'],
        features: ['REST API', 'Authentication'],
        prerequisites: ['Node.js 20+'],
        author: '63Klabs',
        license: 'MIT',
        repository: 'https://github.com/63klabs/node-express-api',
        hasCacheData: true
      });

      mockS3Send.mockResolvedValueOnce({
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
      expect(result.languages).toEqual(['Node.js']);
      expect(result.frameworks).toEqual(['Express']);
      expect(result.hasCacheData).toBe(true);
      expect(result.hasSidecarMetadata).toBe(true);
      expect(result.zipSize).toBe(1024000);
    });

    it('should return null if starter not found', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

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

    it('should return minimal metadata for starter without sidecar JSON', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });

      // ZIP exists
      mockS3Send.mockResolvedValueOnce({
        ContentLength: 1024000,
        LastModified: new Date()
      });

      // No sidecar metadata
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

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
      expect(result.hasSidecarMetadata).toBe(false);
      expect(result.languages).toEqual([]);
      expect(result.frameworks).toEqual([]);
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
    it('parseSidecarMetadata should parse valid JSON with plural fields', () => {
      const metadata = JSON.stringify({
        name: 'test-starter',
        description: 'Test description',
        languages: ['Node.js', 'TypeScript'],
        frameworks: ['Express'],
        topics: ['serverless', 'aws'],
        dependencies: ['express'],
        devDependencies: ['jest'],
        hasCacheData: true,
        deployment_platform: 'atlantis',
        features: ['Feature 1', 'Feature 2'],
        prerequisites: ['Node.js 20+'],
        author: 'Test Author',
        license: 'MIT',
        repository: 'https://github.com/test/repo'
      });

      const result = S3Starters.parseSidecarMetadata(metadata);

      expect(result.name).toBe('test-starter');
      expect(result.languages).toEqual(['Node.js', 'TypeScript']);
      expect(result.frameworks).toEqual(['Express']);
      expect(result.topics).toEqual(['serverless', 'aws']);
      expect(result.devDependencies).toEqual(['jest']);
      expect(result.hasCacheData).toBe(true);
      expect(result.deployment_platform).toBe('atlantis');
      expect(result.repository).toBe('https://github.com/test/repo');
      expect(result.features).toHaveLength(2);
    });

    it('parseSidecarMetadata should fall back to singular language/framework fields', () => {
      const metadata = JSON.stringify({
        name: 'test-starter',
        description: 'Test description',
        language: 'Python',
        framework: 'Flask'
      });

      const result = S3Starters.parseSidecarMetadata(metadata);

      expect(result.languages).toEqual(['Python']);
      expect(result.frameworks).toEqual(['Flask']);
    });

    it('parseSidecarMetadata should handle invalid JSON', () => {
      const result = S3Starters.parseSidecarMetadata('invalid json {{{');

      expect(result.name).toBe('');
      expect(result.description).toBe('');
      expect(result.languages).toEqual([]);
      expect(result.frameworks).toEqual([]);
      expect(result.features).toEqual([]);
    });

    it('parseSidecarMetadata should default missing fields', () => {
      const metadata = JSON.stringify({
        name: 'minimal-starter'
      });

      const result = S3Starters.parseSidecarMetadata(metadata);

      expect(result.name).toBe('minimal-starter');
      expect(result.languages).toEqual([]);
      expect(result.frameworks).toEqual([]);
      expect(result.topics).toEqual([]);
      expect(result.devDependencies).toEqual([]);
      expect(result.hasCacheData).toBe(false);
      expect(result.deployment_platform).toBe('atlantis');
      expect(result.repository).toBe('');
      expect(result.repository_type).toBe('app-starter');
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
