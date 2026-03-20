/**
 * Unit Tests for S3 App Starters DAO
 *
 * Tests all functions in the S3 App Starters Data Access Object including:
 * - parseSidecarMetadata() with categorized structures and camelCase output
 * - list() and get() with categorized fallback objects
 * - Helper functions (buildStarterZipKey, buildStarterMetadataKey, extractAppNameFromKey, deduplicateStarters)
 * - list() multi-bucket and brown-out behavior
 *
 * NOTE: This DAO uses AWS.s3.client from @63klabs/cache-data package,
 * so we mock that instead of S3Client directly.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */

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

const S3Starters = require('../../../models/s3-starters');

/** Reusable empty categorized structure for assertions */
const EMPTY_CATEGORIZED = { buildDeploy: [], applicationStack: [], postDeploy: [] };

describe('S3 App Starters DAO', () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 7.1 - parseSidecarMetadata() unit tests
  // Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
  // =========================================================================
  describe('parseSidecarMetadata()', () => {
    it('should parse valid categorized JSON with all fields', () => {
      const input = JSON.stringify({
        name: 'test-starter',
        displayName: 'Test Starter App',
        description: 'A test starter',
        languages: { buildDeploy: ['Python'], applicationStack: ['Node.js'], postDeploy: ['Bash'] },
        frameworks: { buildDeploy: [], applicationStack: ['Express'], postDeploy: [] },
        features: { buildDeploy: ['SAM CLI'], applicationStack: ['REST API', 'Auth'], postDeploy: ['CloudFront'] },
        topics: ['serverless', 'aws'],
        dependencies: ['express'],
        devDependencies: ['jest'],
        hasCacheData: true,
        deploymentPlatform: 'atlantis',
        prerequisites: ['Node.js 20+'],
        author: '63Klabs',
        license: 'MIT',
        repository: 'https://github.com/63klabs/test-starter',
        repositoryType: 'app-starter',
        version: 'v1.0.0 (2024-06-15)',
        lastUpdated: '2024-06-15'
      });

      const result = S3Starters.parseSidecarMetadata(input);

      expect(result.name).toBe('test-starter');
      expect(result.displayName).toBe('Test Starter App');
      expect(result.description).toBe('A test starter');
      expect(result.languages).toEqual({ buildDeploy: ['Python'], applicationStack: ['Node.js'], postDeploy: ['Bash'] });
      expect(result.frameworks).toEqual({ buildDeploy: [], applicationStack: ['Express'], postDeploy: [] });
      expect(result.features).toEqual({ buildDeploy: ['SAM CLI'], applicationStack: ['REST API', 'Auth'], postDeploy: ['CloudFront'] });
      expect(result.topics).toEqual(['serverless', 'aws']);
      expect(result.dependencies).toEqual(['express']);
      expect(result.devDependencies).toEqual(['jest']);
      expect(result.hasCacheData).toBe(true);
      expect(result.deploymentPlatform).toBe('atlantis');
      expect(result.prerequisites).toEqual(['Node.js 20+']);
      expect(result.author).toBe('63Klabs');
      expect(result.license).toBe('MIT');
      expect(result.repository).toBe('https://github.com/63klabs/test-starter');
      expect(result.repositoryType).toBe('app-starter');
      expect(result.version).toBe('v1.0.0 (2024-06-15)');
      expect(result.lastUpdated).toBe('2024-06-15');
    });

    it('should return default object with empty categorized structures on invalid JSON', () => {
      const result = S3Starters.parseSidecarMetadata('invalid json {{{');

      expect(result.name).toBe('');
      expect(result.displayName).toBe('');
      expect(result.description).toBe('');
      expect(result.languages).toEqual(EMPTY_CATEGORIZED);
      expect(result.frameworks).toEqual(EMPTY_CATEGORIZED);
      expect(result.features).toEqual(EMPTY_CATEGORIZED);
      expect(result.topics).toEqual([]);
      expect(result.devDependencies).toEqual([]);
      expect(result.hasCacheData).toBe(false);
      expect(result.deploymentPlatform).toBe('atlantis');
      expect(result.repositoryType).toBe('app-starter');
      // Verify all keys are camelCase (no underscores)
      for (const key of Object.keys(result)) {
        expect(key).not.toContain('_');
      }
    });

    it('should default missing fields to categorized structures for minimal JSON', () => {
      const input = JSON.stringify({ name: 'minimal-starter' });
      const result = S3Starters.parseSidecarMetadata(input);

      expect(result.name).toBe('minimal-starter');
      expect(result.displayName).toBe('');
      expect(result.languages).toEqual(EMPTY_CATEGORIZED);
      expect(result.frameworks).toEqual(EMPTY_CATEGORIZED);
      expect(result.features).toEqual(EMPTY_CATEGORIZED);
      expect(result.topics).toEqual([]);
      expect(result.hasCacheData).toBe(false);
      expect(result.deploymentPlatform).toBe('atlantis');
      expect(result.repositoryType).toBe('app-starter');
    });

    it('should preserve displayName field', () => {
      const input = JSON.stringify({
        name: 'my-app',
        displayName: 'My Awesome Application'
      });
      const result = S3Starters.parseSidecarMetadata(input);
      expect(result.displayName).toBe('My Awesome Application');
    });

    it('should normalize snake_case input to camelCase output', () => {
      const input = JSON.stringify({
        name: 'snake-test',
        deployment_platform: 'custom-platform',
        repository_type: 'template',
        last_updated: '2024-03-01',
        dev_dependencies: ['mocha', 'chai'],
        has_cache_data: true,
        github_url: 'https://github.com/test/repo'
      });

      const result = S3Starters.parseSidecarMetadata(input);

      expect(result.deploymentPlatform).toBe('custom-platform');
      expect(result.repositoryType).toBe('template');
      expect(result.lastUpdated).toBe('2024-03-01');
      expect(result.devDependencies).toEqual(['mocha', 'chai']);
      expect(result.hasCacheData).toBe(true);
      expect(result.repository).toBe('https://github.com/test/repo');
      // No snake_case keys in output
      expect(result).not.toHaveProperty('deployment_platform');
      expect(result).not.toHaveProperty('repository_type');
      expect(result).not.toHaveProperty('last_updated');
      expect(result).not.toHaveProperty('dev_dependencies');
      expect(result).not.toHaveProperty('has_cache_data');
      expect(result).not.toHaveProperty('github_url');
    });

    it('should accept camelCase input and output camelCase', () => {
      const input = JSON.stringify({
        name: 'camel-test',
        deploymentPlatform: 'atlantis',
        repositoryType: 'app-starter',
        lastUpdated: '2024-06-01',
        devDependencies: ['jest'],
        hasCacheData: false,
        repository: 'https://github.com/test/camel'
      });

      const result = S3Starters.parseSidecarMetadata(input);

      expect(result.deploymentPlatform).toBe('atlantis');
      expect(result.repositoryType).toBe('app-starter');
      expect(result.lastUpdated).toBe('2024-06-01');
      expect(result.devDependencies).toEqual(['jest']);
      expect(result.hasCacheData).toBe(false);
      expect(result.repository).toBe('https://github.com/test/camel');
    });

    it('should give camelCase priority when both snake_case and camelCase are present', () => {
      const input = JSON.stringify({
        name: 'priority-test',
        deployment_platform: 'snake-value',
        deploymentPlatform: 'camel-value',
        repository_type: 'snake-type',
        repositoryType: 'camel-type',
        last_updated: '2024-01-01',
        lastUpdated: '2024-12-31',
        dev_dependencies: ['snake-dep'],
        devDependencies: ['camel-dep'],
        has_cache_data: false,
        hasCacheData: true,
        github_url: 'https://snake.example.com',
        repository: 'https://camel.example.com'
      });

      const result = S3Starters.parseSidecarMetadata(input);

      expect(result.deploymentPlatform).toBe('camel-value');
      expect(result.repositoryType).toBe('camel-type');
      expect(result.lastUpdated).toBe('2024-12-31');
      expect(result.devDependencies).toEqual(['camel-dep']);
      expect(result.hasCacheData).toBe(true);
      expect(result.repository).toBe('https://camel.example.com');
    });
  });

  // =========================================================================
  // 7.2 - list() and get() with new categorized format
  // Requirements: 9.1, 9.4
  // =========================================================================
  describe('list() and get() with categorized format', () => {
    it('list() fallback object uses categorized structure and camelCase when no sidecar metadata', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      mockS3Send.mockResolvedValueOnce({
        Contents: [{
          Key: 'atlantis/app-starters/v2/no-meta-app.zip',
          LastModified: new Date('2024-01-01'),
          Size: 512000
        }]
      });
      // No sidecar metadata
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = { host: 'test-bucket', path: 'app-starters/v2', parameters: {} };
      const result = await S3Starters.list(connection);

      expect(result.starters).toHaveLength(1);
      const starter = result.starters[0];
      expect(starter.name).toBe('no-meta-app');
      expect(starter.displayName).toBe('');
      expect(starter.hasSidecarMetadata).toBe(false);
      // Categorized structures
      expect(starter.languages).toEqual(EMPTY_CATEGORIZED);
      expect(starter.frameworks).toEqual(EMPTY_CATEGORIZED);
      expect(starter.features).toEqual(EMPTY_CATEGORIZED);
      // camelCase keys
      expect(starter).toHaveProperty('devDependencies');
      expect(starter).toHaveProperty('hasCacheData');
      expect(starter).toHaveProperty('deploymentPlatform');
      expect(starter).toHaveProperty('repositoryType');
      expect(starter).toHaveProperty('lastUpdated');
      // No snake_case keys
      expect(starter).not.toHaveProperty('dev_dependencies');
      expect(starter).not.toHaveProperty('has_cache_data');
      expect(starter).not.toHaveProperty('deployment_platform');
      expect(starter).not.toHaveProperty('repository_type');
      expect(starter).not.toHaveProperty('last_updated');
    });

    it('get() fallback object uses categorized structure and camelCase when no sidecar metadata', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      // ZIP exists
      mockS3Send.mockResolvedValueOnce({
        ContentLength: 1024000,
        LastModified: new Date('2024-01-01')
      });
      // No sidecar metadata
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: { starterName: 'no-meta-app' }
      };
      const result = await S3Starters.get(connection);

      expect(result).not.toBeNull();
      expect(result.name).toBe('no-meta-app');
      expect(result.displayName).toBe('');
      expect(result.hasSidecarMetadata).toBe(false);
      expect(result.languages).toEqual(EMPTY_CATEGORIZED);
      expect(result.frameworks).toEqual(EMPTY_CATEGORIZED);
      expect(result.features).toEqual(EMPTY_CATEGORIZED);
      expect(result).toHaveProperty('devDependencies');
      expect(result).toHaveProperty('deploymentPlatform');
      expect(result).toHaveProperty('repositoryType');
      expect(result).toHaveProperty('lastUpdated');
    });

    it('list() with sidecar metadata flows categorized structure through', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      mockS3Send.mockResolvedValueOnce({
        Contents: [{
          Key: 'atlantis/app-starters/v2/full-app.zip',
          LastModified: new Date('2024-06-01'),
          Size: 2048000
        }]
      });
      const sidecar = JSON.stringify({
        name: 'full-app',
        displayName: 'Full Application',
        languages: { buildDeploy: ['Python'], applicationStack: ['Node.js'], postDeploy: [] },
        frameworks: { buildDeploy: [], applicationStack: ['Express', 'React'], postDeploy: [] },
        features: { buildDeploy: ['SAM'], applicationStack: ['REST API'], postDeploy: ['Invalidation'] },
        deploymentPlatform: 'atlantis',
        hasCacheData: true
      });
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: async () => sidecar }
      });

      const connection = { host: 'test-bucket', path: 'app-starters/v2', parameters: {} };
      const result = await S3Starters.list(connection);

      expect(result.starters).toHaveLength(1);
      const starter = result.starters[0];
      expect(starter.name).toBe('full-app');
      expect(starter.displayName).toBe('Full Application');
      expect(starter.languages).toEqual({ buildDeploy: ['Python'], applicationStack: ['Node.js'], postDeploy: [] });
      expect(starter.frameworks).toEqual({ buildDeploy: [], applicationStack: ['Express', 'React'], postDeploy: [] });
      expect(starter.features).toEqual({ buildDeploy: ['SAM'], applicationStack: ['REST API'], postDeploy: ['Invalidation'] });
      expect(starter.hasCacheData).toBe(true);
      expect(starter.hasSidecarMetadata).toBe(true);
    });

    it('get() with sidecar metadata flows categorized structure through', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      mockS3Send.mockResolvedValueOnce({
        ContentLength: 2048000,
        LastModified: new Date('2024-06-01')
      });
      const sidecar = JSON.stringify({
        name: 'full-app',
        displayName: 'Full Application',
        languages: { buildDeploy: ['Python'], applicationStack: ['Node.js'], postDeploy: [] },
        frameworks: { buildDeploy: [], applicationStack: ['Express'], postDeploy: [] },
        features: { buildDeploy: [], applicationStack: ['REST API'], postDeploy: [] },
        deploymentPlatform: 'atlantis',
        repositoryType: 'app-starter',
        hasCacheData: true
      });
      mockS3Send.mockResolvedValueOnce({
        Body: { transformToString: async () => sidecar }
      });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: { starterName: 'full-app' }
      };
      const result = await S3Starters.get(connection);

      expect(result).not.toBeNull();
      expect(result.name).toBe('full-app');
      expect(result.displayName).toBe('Full Application');
      expect(result.languages).toEqual({ buildDeploy: ['Python'], applicationStack: ['Node.js'], postDeploy: [] });
      expect(result.frameworks).toEqual({ buildDeploy: [], applicationStack: ['Express'], postDeploy: [] });
      expect(result.features).toEqual({ buildDeploy: [], applicationStack: ['REST API'], postDeploy: [] });
      expect(result.hasCacheData).toBe(true);
      expect(result.hasSidecarMetadata).toBe(true);
    });

    it('get() returns null if starterName not provided', async () => {
      const connection = { host: 'test-bucket', path: 'app-starters/v2', parameters: {} };
      const result = await S3Starters.get(connection);
      expect(result).toBeNull();
    });

    it('get() returns null if starter not found in any bucket', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'app-starters/v2',
        parameters: { starterName: 'nonexistent' }
      };
      const result = await S3Starters.get(connection);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // 7.3 - Helper function unit tests
  // Requirements: 9.6
  // =========================================================================
  describe('Helper Functions', () => {
    it('buildStarterZipKey constructs correct S3 key', () => {
      expect(S3Starters.buildStarterZipKey('atlantis', 'app-starters/v2', 'node-express-api'))
        .toBe('atlantis/app-starters/v2/node-express-api.zip');
    });

    it('buildStarterZipKey handles different namespaces and paths', () => {
      expect(S3Starters.buildStarterZipKey('custom-ns', 'starters/v3', 'my-app'))
        .toBe('custom-ns/starters/v3/my-app.zip');
    });

    it('buildStarterMetadataKey constructs correct S3 key', () => {
      expect(S3Starters.buildStarterMetadataKey('atlantis', 'app-starters/v2', 'node-express-api'))
        .toBe('atlantis/app-starters/v2/node-express-api.json');
    });

    it('extractAppNameFromKey extracts name from ZIP key', () => {
      expect(S3Starters.extractAppNameFromKey('atlantis/app-starters/v2/node-express-api.zip'))
        .toBe('node-express-api');
    });

    it('extractAppNameFromKey handles deeply nested keys', () => {
      expect(S3Starters.extractAppNameFromKey('a/b/c/d/my-app.zip'))
        .toBe('my-app');
    });

    it('deduplicateStarters removes duplicates keeping first occurrence', () => {
      const starters = [
        { name: 'starter1', bucket: 'bucket1' },
        { name: 'starter1', bucket: 'bucket2' },
        { name: 'starter2', bucket: 'bucket1' }
      ];
      const result = S3Starters.deduplicateStarters(starters);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'starter1', bucket: 'bucket1' });
      expect(result[1]).toEqual({ name: 'starter2', bucket: 'bucket1' });
    });

    it('deduplicateStarters returns empty array for empty input', () => {
      expect(S3Starters.deduplicateStarters([])).toEqual([]);
    });

    it('deduplicateStarters preserves order for unique starters', () => {
      const starters = [
        { name: 'c-app', bucket: 'b1' },
        { name: 'a-app', bucket: 'b1' },
        { name: 'b-app', bucket: 'b1' }
      ];
      const result = S3Starters.deduplicateStarters(starters);
      expect(result.map(s => s.name)).toEqual(['c-app', 'a-app', 'b-app']);
    });

    it('normalizeCategorized returns default for undefined', () => {
      expect(S3Starters.normalizeCategorized(undefined)).toEqual(EMPTY_CATEGORIZED);
    });

    it('normalizeCategorized returns default for arrays (legacy format)', () => {
      expect(S3Starters.normalizeCategorized(['Node.js', 'Python'])).toEqual(EMPTY_CATEGORIZED);
    });

    it('normalizeCategorized preserves valid categorized object', () => {
      const input = { buildDeploy: ['Python'], applicationStack: ['Node.js'], postDeploy: ['Bash'] };
      expect(S3Starters.normalizeCategorized(input)).toEqual(input);
    });

    it('normalizeCategorized defaults invalid sub-keys to empty arrays', () => {
      const input = { buildDeploy: 'not-array', applicationStack: null, postDeploy: 42 };
      expect(S3Starters.normalizeCategorized(input)).toEqual(EMPTY_CATEGORIZED);
    });
  });

  // =========================================================================
  // 7.4 - list() multi-bucket and brown-out behavior
  // Requirements: 9.1
  // =========================================================================
  describe('list() multi-bucket and brown-out behavior', () => {
    it('should deduplicate starters across multiple buckets (first occurrence wins)', async () => {
      const sidecar = JSON.stringify({
        name: 'shared-app',
        languages: { buildDeploy: [], applicationStack: ['Node.js'], postDeploy: [] }
      });

      // Bucket 1: namespace discovery
      mockS3Send.mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: 'atlantis/' }] });
      // Bucket 1: listing
      mockS3Send.mockResolvedValueOnce({
        Contents: [{ Key: 'atlantis/app-starters/v2/shared-app.zip', LastModified: new Date('2024-01-01'), Size: 1000 }]
      });
      // Bucket 1: sidecar
      mockS3Send.mockResolvedValueOnce({ Body: { transformToString: async () => sidecar } });

      // Bucket 2: namespace discovery
      mockS3Send.mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: 'atlantis/' }] });
      // Bucket 2: listing
      mockS3Send.mockResolvedValueOnce({
        Contents: [{ Key: 'atlantis/app-starters/v2/shared-app.zip', LastModified: new Date('2024-06-01'), Size: 2000 }]
      });
      // Bucket 2: sidecar
      mockS3Send.mockResolvedValueOnce({ Body: { transformToString: async () => sidecar } });

      const connection = { host: ['bucket1', 'bucket2'], path: 'app-starters/v2', parameters: {} };
      const result = await S3Starters.list(connection);

      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].bucket).toBe('bucket1');
    });

    it('should continue listing from remaining buckets when one bucket fails (brown-out)', async () => {
      // Bucket 1: fails entirely
      mockS3Send.mockRejectedValueOnce(new Error('Access Denied'));

      // Bucket 2: namespace discovery
      mockS3Send.mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: 'atlantis/' }] });
      // Bucket 2: listing
      mockS3Send.mockResolvedValueOnce({
        Contents: [{ Key: 'atlantis/app-starters/v2/surviving-app.zip', LastModified: new Date(), Size: 1024 }]
      });
      // Bucket 2: sidecar
      const sidecar = JSON.stringify({
        name: 'surviving-app',
        languages: { buildDeploy: [], applicationStack: ['Node.js'], postDeploy: [] }
      });
      mockS3Send.mockResolvedValueOnce({ Body: { transformToString: async () => sidecar } });

      const connection = { host: ['bucket1', 'bucket2'], path: 'app-starters/v2', parameters: {} };
      const result = await S3Starters.list(connection);

      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].name).toBe('surviving-app');
      expect(result.starters[0].bucket).toBe('bucket2');
    });

    it('should handle single string host as array', async () => {
      mockS3Send.mockResolvedValueOnce({ CommonPrefixes: [{ Prefix: 'ns/' }] });
      mockS3Send.mockResolvedValueOnce({ Contents: [] });

      const connection = { host: 'single-bucket', path: 'app-starters/v2', parameters: {} };
      const result = await S3Starters.list(connection);

      expect(result.starters).toEqual([]);
      expect(result.partialData).toBe(false);
    });

    it('should return empty starters when bucket has no namespaces', async () => {
      mockS3Send.mockResolvedValueOnce({ CommonPrefixes: [] });

      const connection = { host: 'empty-bucket', path: 'app-starters/v2', parameters: {} };
      const result = await S3Starters.list(connection);

      expect(result.starters).toEqual([]);
    });

    it('should collect starters from multiple namespaces in same bucket', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'ns1/' }, { Prefix: 'ns2/' }]
      });
      // ns1 listing
      mockS3Send.mockResolvedValueOnce({
        Contents: [{ Key: 'ns1/app-starters/v2/app-a.zip', LastModified: new Date(), Size: 100 }]
      });
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' }); // no sidecar for app-a
      // ns2 listing
      mockS3Send.mockResolvedValueOnce({
        Contents: [{ Key: 'ns2/app-starters/v2/app-b.zip', LastModified: new Date(), Size: 200 }]
      });
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' }); // no sidecar for app-b

      const connection = { host: 'multi-ns-bucket', path: 'app-starters/v2', parameters: {} };
      const result = await S3Starters.list(connection);

      expect(result.starters).toHaveLength(2);
      expect(result.starters[0].name).toBe('app-a');
      expect(result.starters[0].namespace).toBe('ns1');
      expect(result.starters[1].name).toBe('app-b');
      expect(result.starters[1].namespace).toBe('ns2');
    });
  });
});
