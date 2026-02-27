/**
 * Unit Tests: Starters Service - CloudFront Integration Detection
 *
 * Tests that the starters service correctly detects and reports CloudFront integration
 * from sidecar metadata for S3 starters and defaults to false for GitHub starters.
 *
 * @module tests/unit/services/starters-cloudfront-integration
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

// Mock dependencies before importing service
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
    }
  }
}));

jest.mock('../../../config', () => ({
  Config: {
    settings: jest.fn(() => ({
      github: {
        userOrgs: ['63klabs', 'testorg']
      },
      s3: {
        buckets: ['test-bucket-1', 'test-bucket-2'],
        starterPrefix: 'app-starters/v2'
      }
    })),
    getConnCacheProfile: jest.fn(() => ({
      conn: {
        host: [],
        path: '/repos',
        parameters: {}
      },
      cacheProfile: {
        hostId: 'github-api',
        pathId: 'starters-list',
        profile: 'default'
      }
    }))
  }
}));

jest.mock('../../../models', () => ({
  S3Starters: {
    list: jest.fn()
  },
  GitHubAPI: {
    listRepositories: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const Models = require('../../../models');
const Starters = require('../../../services/starters');

describe('Starters Service - CloudFront Integration Detection', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('S3 Starters with CloudFront Integration', () => {
    it('should detect CloudFront integration from sidecar metadata', async () => {
      // Mock S3 starters with CloudFront integration
      Models.S3Starters.list.mockResolvedValue({
        starters: [
          {
            name: 'cloudfront-starter',
            description: 'Starter with CloudFront',
            cloudFrontIntegration: true,
            cacheDataIntegration: false
          }
        ],
        errors: []
      });

      // Mock GitHub starters (empty)
      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: []
      });

      // Mock CacheableDataAccess to call fetchFunction directly
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        const result = await fetchFunction(conn, opts);
        return { body: result };
      });

      const result = await Starters.list({});

      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].hasCloudFrontIntegration).toBe(true);
      expect(result.starters[0].hasCacheDataIntegration).toBe(false);
      expect(result.starters[0].source).toBe('s3');
    });

    it('should default to false when cloudFrontIntegration is not in sidecar metadata', async () => {
      // Mock S3 starters without CloudFront integration field
      Models.S3Starters.list.mockResolvedValue({
        starters: [
          {
            name: 'basic-starter',
            description: 'Basic starter without CloudFront',
            cacheDataIntegration: false
            // cloudFrontIntegration field is missing
          }
        ],
        errors: []
      });

      // Mock GitHub starters (empty)
      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: []
      });

      // Mock CacheableDataAccess to call fetchFunction directly
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        const result = await fetchFunction(conn, opts);
        return { body: result };
      });

      const result = await Starters.list({});

      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].hasCloudFrontIntegration).toBe(false);
      expect(result.starters[0].source).toBe('s3');
    });

    it('should handle starters with both cache-data and CloudFront integration', async () => {
      // Mock S3 starters with both integrations
      Models.S3Starters.list.mockResolvedValue({
        starters: [
          {
            name: 'full-featured-starter',
            description: 'Starter with both integrations',
            cloudFrontIntegration: true,
            cacheDataIntegration: true
          }
        ],
        errors: []
      });

      // Mock GitHub starters (empty)
      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: []
      });

      // Mock CacheableDataAccess to call fetchFunction directly
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        const result = await fetchFunction(conn, opts);
        return { body: result };
      });

      const result = await Starters.list({});

      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].hasCloudFrontIntegration).toBe(true);
      expect(result.starters[0].hasCacheDataIntegration).toBe(true);
      expect(result.starters[0].source).toBe('s3');
    });
  });

  describe('GitHub Starters without Sidecar Metadata', () => {
    it('should default to false for GitHub starters without sidecar metadata', async () => {
      // Mock S3 starters (empty)
      Models.S3Starters.list.mockResolvedValue({
        starters: [],
        errors: []
      });

      // Mock GitHub starters
      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [
          {
            name: 'github-starter',
            description: 'GitHub starter',
            language: 'JavaScript',
            url: 'https://github.com/63klabs/github-starter',
            cloneUrl: 'https://github.com/63klabs/github-starter.git',
            sshUrl: 'git@github.com:63klabs/github-starter.git',
            defaultBranch: 'main',
            stargazersCount: 10,
            forksCount: 2,
            updatedAt: '2024-01-01T00:00:00Z',
            createdAt: '2023-01-01T00:00:00Z',
            atlantis_repository_type: 'app-starter',
            userOrg: '63klabs'
          }
        ],
        errors: []
      });

      // Mock CacheableDataAccess to call fetchFunction directly
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        const result = await fetchFunction(conn, opts);
        return { body: result };
      });

      const result = await Starters.list({});

      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].hasCloudFrontIntegration).toBe(false);
      expect(result.starters[0].hasCacheDataIntegration).toBe(false);
      expect(result.starters[0].source).toBe('github');
      expect(result.starters[0].hasSidecarMetadata).toBe(false);
    });
  });

  describe('Mixed Sources', () => {
    it('should correctly detect CloudFront integration across S3 and GitHub sources', async () => {
      // Mock S3 starters with CloudFront integration
      Models.S3Starters.list.mockResolvedValue({
        starters: [
          {
            name: 's3-cloudfront-starter',
            description: 'S3 starter with CloudFront',
            cloudFrontIntegration: true,
            cacheDataIntegration: false
          },
          {
            name: 's3-basic-starter',
            description: 'S3 basic starter',
            cloudFrontIntegration: false,
            cacheDataIntegration: false
          }
        ],
        errors: []
      });

      // Mock GitHub starters
      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [
          {
            name: 'github-starter',
            description: 'GitHub starter',
            language: 'JavaScript',
            url: 'https://github.com/63klabs/github-starter',
            cloneUrl: 'https://github.com/63klabs/github-starter.git',
            sshUrl: 'git@github.com:63klabs/github-starter.git',
            defaultBranch: 'main',
            stargazersCount: 5,
            forksCount: 1,
            updatedAt: '2024-01-01T00:00:00Z',
            createdAt: '2023-01-01T00:00:00Z',
            atlantis_repository_type: 'app-starter',
            userOrg: '63klabs'
          }
        ],
        errors: []
      });

      // Mock CacheableDataAccess to call fetchFunction directly
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        const result = await fetchFunction(conn, opts);
        return { body: result };
      });

      const result = await Starters.list({});

      expect(result.starters).toHaveLength(3);

      // S3 starter with CloudFront
      const s3CloudFrontStarter = result.starters.find(s => s.name === 's3-cloudfront-starter');
      expect(s3CloudFrontStarter.hasCloudFrontIntegration).toBe(true);
      expect(s3CloudFrontStarter.source).toBe('s3');

      // S3 starter without CloudFront
      const s3BasicStarter = result.starters.find(s => s.name === 's3-basic-starter');
      expect(s3BasicStarter.hasCloudFrontIntegration).toBe(false);
      expect(s3BasicStarter.source).toBe('s3');

      // GitHub starter (defaults to false)
      const githubStarter = result.starters.find(s => s.name === 'github-starter');
      expect(githubStarter.hasCloudFrontIntegration).toBe(false);
      expect(githubStarter.source).toBe('github');
    });
  });

  describe('Deduplication with CloudFront Integration', () => {
    it('should preserve CloudFront integration flag when S3 takes precedence over GitHub', async () => {
      // Mock S3 starters with CloudFront integration
      Models.S3Starters.list.mockResolvedValue({
        starters: [
          {
            name: 'duplicate-starter',
            description: 'S3 version with CloudFront',
            cloudFrontIntegration: true,
            cacheDataIntegration: true
          }
        ],
        errors: []
      });

      // Mock GitHub starters with same name (should be deduplicated)
      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [
          {
            name: 'duplicate-starter',
            description: 'GitHub version',
            language: 'JavaScript',
            url: 'https://github.com/63klabs/duplicate-starter',
            cloneUrl: 'https://github.com/63klabs/duplicate-starter.git',
            sshUrl: 'git@github.com:63klabs/duplicate-starter.git',
            defaultBranch: 'main',
            stargazersCount: 5,
            forksCount: 1,
            updatedAt: '2024-01-01T00:00:00Z',
            createdAt: '2023-01-01T00:00:00Z',
            atlantis_repository_type: 'app-starter',
            userOrg: '63klabs'
          }
        ],
        errors: []
      });

      // Mock CacheableDataAccess to call fetchFunction directly
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
        const result = await fetchFunction(conn, opts);
        return { body: result };
      });

      const result = await Starters.list({});

      // Should only have one starter (S3 takes precedence)
      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].name).toBe('duplicate-starter');
      expect(result.starters[0].hasCloudFrontIntegration).toBe(true);
      expect(result.starters[0].hasCacheDataIntegration).toBe(true);
      expect(result.starters[0].source).toBe('s3');
    });
  });
});
