/**
 * Unit Tests for Starters Service
 *
 * Tests the Starters service layer including:
 * - list() with caching
 * - get() with caching
 * - Service-level GitHub user/org filtering
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
      warn: jest.fn(),
      error: jest.fn()
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
  S3Starters: {
    list: jest.fn(),
    get: jest.fn()
  },
  GitHubAPI: {
    listRepositories: jest.fn(),
    getRepository: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const Starters = require('../../../services/starters');

describe('Starters Service', () => {
  // Helper function to create properly structured mock connection and cache profile
  const createMockConnCacheProfile = (connectionName = 'github-api', profileName = 'starters-list') => {
    return {
      conn: {
        name: connectionName,
        host: [],
        path: '/repos',
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
        pathId: profileName, // Use full profile name as pathId
        encrypt: false
      }
    };
  };

  beforeEach(() => {
    // Clear all mocks
    CacheableDataAccess.getData.mockClear();
    Models.S3Starters.list.mockClear();
    Models.S3Starters.get.mockClear();
    Models.GitHubAPI.listRepositories.mockClear();
    Models.GitHubAPI.getRepository.mockClear();
    Config.getConnCacheProfile.mockClear();
    Config.settings.mockClear();

    // Default mock implementations
    Config.settings.mockReturnValue({
      s3: {
        buckets: ['bucket1', 'bucket2'],
        starterPrefix: 'app-starters/v2'
      },
      github: {
        userOrgs: ['63klabs', 'myorg', 'testorg']
      }
    });

    // Mock CacheableDataAccess.getData to call fetchFunction directly
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      const result = await fetchFunction(conn, opts);
      return { body: result };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list() with caching', () => {
    it('should list all starters using cache-data', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      const mockStarters = [
        { name: 'starter1', source: 's3' },
        { name: 'starter2', source: 'github' }
      ];

      Models.S3Starters.list.mockResolvedValue({
        starters: mockStarters.filter(s => s.source === 's3'),
        errors: undefined
      });

      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: mockStarters.filter(s => s.source === 'github').map(s => ({
          name: s.name,
          atlantis_repository_type: 'app-starter'
        })),
        errors: undefined
      });

      // Act
      const result = await Starters.list({});

      // Assert
      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('github-api', 'starters-list');
      expect(Models.S3Starters.list).toHaveBeenCalled();
      expect(Models.GitHubAPI.listRepositories).toHaveBeenCalled();
      expect(result.starters).toHaveLength(2);
      expect(mockConnCache.conn.host).toEqual(['63klabs', 'myorg', 'testorg']);
    });

    it('should filter starters by specific GitHub users/orgs', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [],
        errors: undefined
      });

      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: undefined
      });

      // Act
      await Starters.list({ ghusers: ['63klabs', 'myorg'] });

      // Assert
      expect(mockConnCache.conn.host).toEqual(['63klabs', 'myorg']);
    });

    it('should validate GitHub users/orgs filter against configured users/orgs', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [],
        errors: undefined
      });

      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: undefined
      });

      // Act
      await Starters.list({ ghusers: ['63klabs', 'invalid-org'] });

      // Assert - invalid org should be filtered out
      expect(mockConnCache.conn.host).toEqual(['63klabs']);
    });

    it('should throw error if no valid GitHub users/orgs specified', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      // Act & Assert
      await expect(Starters.list({ ghusers: ['invalid-org'] }))
        .rejects.toThrow('No valid GitHub users/orgs specified');
    });

    it('should set repository type filter to app-starter', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [],
        errors: undefined
      });

      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: undefined
      });

      // Act
      await Starters.list({});

      // Assert
      expect(mockConnCache.conn.parameters).toEqual({ repositoryType: 'app-starter' });
    });

    it('should aggregate starters from S3 and GitHub', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [
          { name: 's3-starter', source: 's3' }
        ],
        errors: undefined
      });

      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [
          {
            name: 'github-starter',
            description: 'GitHub starter',
            language: 'JavaScript',
            url: 'https://github.com/63klabs/github-starter',
            atlantis_repository_type: 'app-starter'
          }
        ],
        errors: undefined
      });

      // Act
      const result = await Starters.list({});

      // Assert
      expect(Models.S3Starters.list).toHaveBeenCalled();
      expect(Models.GitHubAPI.listRepositories).toHaveBeenCalled();
      expect(result.starters).toHaveLength(2);
      expect(result.starters[0].name).toBe('s3-starter');
      expect(result.starters[1].name).toBe('github-starter');
    });

    it('should deduplicate starters (S3 takes precedence)', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [
          { name: 'duplicate-starter', source: 's3', hasSidecarMetadata: true }
        ],
        errors: undefined
      });

      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [
          {
            name: 'duplicate-starter',
            description: 'GitHub version',
            language: 'JavaScript',
            url: 'https://github.com/63klabs/duplicate-starter',
            atlantis_repository_type: 'app-starter'
          }
        ],
        errors: undefined
      });

      // Act
      const result = await Starters.list({});

      // Assert
      expect(result.starters).toHaveLength(1);
      expect(result.starters[0].source).toBe('s3'); // S3 takes precedence
      expect(result.starters[0].hasSidecarMetadata).toBe(true);
    });

    it('should handle errors from S3 and GitHub sources', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [{ name: 'starter1' }],
        errors: [{ source: 'bucket1', error: 'Access denied' }]
      });

      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [{ name: 'starter2', atlantis_repository_type: 'app-starter' }],
        errors: [{ source: '63klabs', error: 'Rate limited' }]
      });

      // Act
      const result = await Starters.list({});

      // Assert
      expect(result.starters).toHaveLength(2);
      expect(result.errors).toHaveLength(2);
      expect(result.partialData).toBe(true);
    });

    it('should throw error if connection profile not available', async () => {
      // Arrange
      Config.getConnCacheProfile.mockReturnValue({
        conn: null,
        cacheProfile: null
      });

      // Act & Assert
      await expect(Starters.list({}))
        .rejects.toThrow('Failed to get connection and cache profile');
    });
  });

  describe('get() with caching', () => {
    it('should get specific starter using cache-data', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('github-api', 'starter-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      const mockStarter = {
        name: 'atlantis-starter-02',
        description: 'Starter description',
        language: 'JavaScript',
        hasS3Package: true,
        hasSidecarMetadata: true
      };

      Models.S3Starters.get.mockResolvedValue(mockStarter);
      Models.GitHubAPI.getRepository.mockResolvedValue({
        name: 'atlantis-starter-02',
        stargazersCount: 10
      });

      // Act
      const result = await Starters.get({ starterName: 'atlantis-starter-02' });

      // Assert
      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('github-api', 'starter-detail');
      expect(Models.S3Starters.get).toHaveBeenCalled();
      expect(result.name).toBe('atlantis-starter-02');
      // The service updates pathId to include the starter name
      expect(mockConnCache.cacheProfile.pathId).toBe('starter-detail:atlantis-starter-02');
    });

    it('should require starterName', async () => {
      // Act & Assert
      await expect(Starters.get({}))
        .rejects.toThrow('starterName is required');
    });

    it('should filter by specific GitHub users/orgs', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('github-api', 'starter-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.get.mockResolvedValue({ name: 'starter1' });
      Models.GitHubAPI.getRepository.mockResolvedValue({ name: 'starter1' });

      // Act
      await Starters.get({
        starterName: 'starter1',
        ghusers: ['63klabs']
      });

      // Assert
      expect(mockConnCache.conn.host).toEqual(['63klabs']);
    });

    it('should prefer S3 sidecar metadata when available', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('github-api', 'starter-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.get.mockResolvedValue({
        name: 'starter1',
        description: 'S3 metadata',
        language: 'JavaScript',
        framework: 'Express',
        cacheDataIntegration: true,
        cloudFrontIntegration: false,
        s3ZipPath: 's3://bucket/starter1.zip'
      });

      Models.GitHubAPI.getRepository.mockResolvedValue({
        name: 'starter1',
        description: 'GitHub metadata',
        stargazersCount: 10,
        forksCount: 5,
        url: 'https://github.com/63klabs/starter1'
      });

      // Act
      const result = await Starters.get({ starterName: 'starter1' });

      // Assert
      expect(Models.S3Starters.get).toHaveBeenCalled();
      expect(Models.GitHubAPI.getRepository).toHaveBeenCalled();
      expect(result.description).toBe('S3 metadata'); // S3 takes precedence
      expect(result.hasS3Package).toBe(true);
      expect(result.hasSidecarMetadata).toBe(true);
      expect(result.hasCacheDataIntegration).toBe(true);
      expect(result.stats.stars).toBe(10); // GitHub stats included
    });

    it('should skip starters without sidecar metadata', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('github-api', 'starter-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.get.mockResolvedValue(null); // No S3 metadata

      Models.GitHubAPI.getRepository.mockResolvedValue({
        name: 'starter1',
        description: 'GitHub only',
        url: 'https://github.com/63klabs/starter1'
      });

      // Mock list() to return available starters for error message
      Models.S3Starters.list.mockResolvedValue({
        starters: [
          { name: 'starter1' },
          { name: 'starter2' }
        ],
        errors: undefined
      });

      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: undefined
      });

      // Act & Assert
      try {
        await Starters.get({ starterName: 'starter1' });
        fail('Should have thrown error');
      } catch (error) {
        expect(error.code).toBe('STARTER_NOT_FOUND');
      }
    });

    it('should throw STARTER_NOT_FOUND with available starters', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('github-api', 'starter-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      // First call to get() returns null
      Models.S3Starters.get.mockResolvedValue(null);
      Models.GitHubAPI.getRepository.mockResolvedValue(null);

      // Second call to list() returns available starters
      Models.S3Starters.list.mockResolvedValue({
        starters: [
          { name: 'starter1' },
          { name: 'starter2' }
        ],
        errors: undefined
      });

      Models.GitHubAPI.listRepositories.mockResolvedValue({
        repositories: [],
        errors: undefined
      });

      // Act
      try {
        await Starters.get({ starterName: 'nonexistent' });
        fail('Should have thrown error');
      } catch (error) {
        // Assert
        expect(error.code).toBe('STARTER_NOT_FOUND');
        expect(error.message).toContain('nonexistent');
        expect(error.message).toContain('starter1');
        expect(error.message).toContain('starter2');
        expect(error.availableStarters).toEqual(['starter1', 'starter2']);
      }
    });

    it('should handle errors when getting available starters list', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('github-api', 'starter-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      // First call to get() returns null
      Models.S3Starters.get.mockResolvedValue(null);
      Models.GitHubAPI.getRepository.mockResolvedValue(null);

      // Second call to list() fails
      Models.S3Starters.list.mockRejectedValue(new Error('Failed to list'));

      // Act
      try {
        await Starters.get({ starterName: 'nonexistent' });
        fail('Should have thrown error');
      } catch (error) {
        // Assert
        expect(error.code).toBe('STARTER_NOT_FOUND');
        expect(error.availableStarters).toEqual([]);
      }
    });

    it('should set repository type filter to app-starter', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('github-api', 'starter-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.get.mockResolvedValue({ name: 'starter1' });
      Models.GitHubAPI.getRepository.mockResolvedValue({ name: 'starter1' });

      // Act
      await Starters.get({ starterName: 'starter1' });

      // Assert
      expect(mockConnCache.conn.parameters).toEqual({
        starterName: 'starter1',
        repositoryType: 'app-starter'
      });
    });
  });
});
