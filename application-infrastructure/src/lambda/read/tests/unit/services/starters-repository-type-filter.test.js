/**
 * Unit tests for Starters Service - Repository Type Filtering
 *
 * Validates: Requirements 4.1, 4.2
 *
 * Tests that the starters service correctly filters GitHub repositories
 * by atlantis_repository-type custom property, ensuring only app-starter
 * repositories are included in the results.
 */

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
        userOrgs: ['63klabs', 'test-org']
      },
      s3: {
        buckets: ['test-bucket'],
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

describe('Starters Service - Repository Type Filtering', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should pass repositoryType parameter to GitHub API DAO', async () => {
    // Mock S3 starters (empty)
    Models.S3Starters.list.mockResolvedValue({
      starters: [],
      errors: undefined,
      partialData: false
    });

    // Mock GitHub repositories with app-starter type
    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: [
        {
          name: 'test-app-starter',
          description: 'Test app starter',
          atlantis_repository_type: 'app-starter',
          userOrg: '63klabs'
        }
      ],
      errors: undefined,
      partialData: false
    });

    // Mock CacheableDataAccess to call fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      const result = await fetchFunction(conn, {});
      return { body: result };
    });

    // Call list
    await Starters.list({});

    // Verify GitHubAPI.listRepositories was called with repositoryType parameter
    expect(Models.GitHubAPI.listRepositories).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: { repositoryType: 'app-starter' }
      }),
      expect.any(Object)
    );
  });

  it('should only include repositories with atlantis_repository-type: app-starter', async () => {
    // Mock S3 starters (empty)
    Models.S3Starters.list.mockResolvedValue({
      starters: [],
      errors: undefined,
      partialData: false
    });

    // Mock GitHub repositories - only app-starter should be included
    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: [
        {
          name: 'valid-app-starter',
          description: 'Valid app starter',
          atlantis_repository_type: 'app-starter',
          userOrg: '63klabs',
          url: 'https://github.com/63klabs/valid-app-starter',
          cloneUrl: 'https://github.com/63klabs/valid-app-starter.git',
          sshUrl: 'git@github.com:63klabs/valid-app-starter.git',
          defaultBranch: 'main',
          stargazersCount: 10,
          forksCount: 2,
          updatedAt: '2024-01-15T10:00:00Z',
          createdAt: '2024-01-01T10:00:00Z'
        }
      ],
      errors: undefined,
      partialData: false
    });

    // Mock CacheableDataAccess to call fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      const result = await fetchFunction(conn, {});
      return { body: result };
    });

    // Call list
    const result = await Starters.list({});

    // Verify only app-starter repositories are included
    expect(result.starters).toHaveLength(1);
    expect(result.starters[0].name).toBe('valid-app-starter');
    expect(result.starters[0].repositoryType).toBe('app-starter');
    expect(result.starters[0].source).toBe('github');
  });

  it('should exclude repositories without atlantis_repository-type property', async () => {
    // Mock S3 starters (empty)
    Models.S3Starters.list.mockResolvedValue({
      starters: [],
      errors: undefined,
      partialData: false
    });

    // Mock GitHub API to return empty (repositories without custom property are filtered by DAO)
    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: [],
      errors: undefined,
      partialData: false
    });

    // Mock CacheableDataAccess to call fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      const result = await fetchFunction(conn, {});
      return { body: result };
    });

    // Call list
    const result = await Starters.list({});

    // Verify no starters are returned
    expect(result.starters).toHaveLength(0);
  });

  it('should exclude repositories with different atlantis_repository-type values', async () => {
    // Mock S3 starters (empty)
    Models.S3Starters.list.mockResolvedValue({
      starters: [],
      errors: undefined,
      partialData: false
    });

    // Mock GitHub API to return empty (repositories with wrong type are filtered by DAO)
    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: [],
      errors: undefined,
      partialData: false
    });

    // Mock CacheableDataAccess to call fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      const result = await fetchFunction(conn, {});
      return { body: result };
    });

    // Call list
    const result = await Starters.list({});

    // Verify no starters are returned
    expect(result.starters).toHaveLength(0);
  });

  it('should combine S3 and GitHub starters with correct filtering', async () => {
    // Mock S3 starters
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        {
          name: 's3-app-starter',
          description: 'S3 app starter',
          s3Bucket: 'test-bucket',
          s3Key: 'app-starters/v2/s3-app-starter.zip'
        }
      ],
      errors: undefined,
      partialData: false
    });

    // Mock GitHub repositories with app-starter type
    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: [
        {
          name: 'github-app-starter',
          description: 'GitHub app starter',
          atlantis_repository_type: 'app-starter',
          userOrg: '63klabs',
          url: 'https://github.com/63klabs/github-app-starter',
          cloneUrl: 'https://github.com/63klabs/github-app-starter.git',
          sshUrl: 'git@github.com:63klabs/github-app-starter.git',
          defaultBranch: 'main',
          stargazersCount: 5,
          forksCount: 1,
          updatedAt: '2024-01-15T10:00:00Z',
          createdAt: '2024-01-01T10:00:00Z'
        }
      ],
      errors: undefined,
      partialData: false
    });

    // Mock CacheableDataAccess to call fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      const result = await fetchFunction(conn, {});
      return { body: result };
    });

    // Call list
    const result = await Starters.list({});

    // Verify both S3 and GitHub starters are included
    expect(result.starters).toHaveLength(2);

    const s3Starter = result.starters.find(s => s.source === 's3');
    const githubStarter = result.starters.find(s => s.source === 'github');

    expect(s3Starter).toBeDefined();
    expect(s3Starter.name).toBe('s3-app-starter');
    expect(s3Starter.hasS3Package).toBe(true);

    expect(githubStarter).toBeDefined();
    expect(githubStarter.name).toBe('github-app-starter');
    expect(githubStarter.repositoryType).toBe('app-starter');
    expect(githubStarter.hasS3Package).toBe(false);
  });

  it('should set connection parameters correctly for cache key', async () => {
    // Mock S3 starters (empty)
    Models.S3Starters.list.mockResolvedValue({
      starters: [],
      errors: undefined,
      partialData: false
    });

    // Mock GitHub repositories
    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: [],
      errors: undefined,
      partialData: false
    });

    // Mock CacheableDataAccess to capture connection
    let capturedConnection;
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      capturedConnection = conn;
      const result = await fetchFunction(conn, {});
      return { body: result };
    });

    // Call list
    await Starters.list({});

    // Verify connection parameters include repositoryType
    expect(capturedConnection.parameters).toEqual({
      repositoryType: 'app-starter'
    });
  });
});
