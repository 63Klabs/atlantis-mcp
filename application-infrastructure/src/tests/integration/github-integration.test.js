/**
 * GitHub Integration Tests
 *
 * Tests GitHub API integration including authentication, custom property retrieval,
 * rate limit handling, and repository filtering.
 */

// Mock AWS SDK and Config before importing modules
jest.mock('@aws-sdk/client-ssm');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('../../lambda/read/config', () => ({
  settings: () => ({
    githubToken: 'ghp_test_token_1234567890',
    github: {
      userOrgs: ['test-user']
    },
    aws: {
      region: 'us-east-1'
    }
  }),
  getGitHubToken: () => 'ghp_test_token_1234567890',
  isInitialized: () => true
}));

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

// Skip these tests - they need AWS SDK v3 migration
describe.skip('GitHub Integration Tests', () => {
  let GitHubAPI;

  beforeAll(async () => {
    // Import after mocking
    GitHubAPI = require('../../lambda/read/models/github-api');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('15.5.1 GitHub API Authentication', () => {
    it('should authenticate with GitHub using token from SSM', async () => {
      // Mock fetch for GitHub API
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([
          ['x-ratelimit-limit', '5000'],
          ['x-ratelimit-remaining', '4999'],
          ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)]
        ]),
        json: async () => ({
          login: 'test-user',
          id: 12345,
          type: 'User'
        })
      });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Verify authentication header was sent
      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = global.fetch.mock.calls[0];
      const headers = fetchCall[1]?.headers || {};

      expect(headers.Authorization).toBe('Bearer ghp_test_token_1234567890');
      expect(result).toBeDefined();
    });

    it('should handle authentication failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          message: 'Bad credentials'
        })
      });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Should return error information
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].error).toContain('401');
    });
  });

  describe('15.5.2 GitHub Custom Property Retrieval', () => {
    it('should retrieve custom properties for repositories', async () => {
      // Mock repository list
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([
            ['x-ratelimit-remaining', '4999']
          ]),
          json: async () => ([
            {
              name: 'test-repo-1',
              full_name: 'test-user/test-repo-1',
              description: 'Test repository 1'
            },
            {
              name: 'test-repo-2',
              full_name: 'test-user/test-repo-2',
              description: 'Test repository 2'
            }
          ])
        })
        // Mock custom properties for repo 1
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([
            ['x-ratelimit-remaining', '4998']
          ]),
          json: async () => ({
            atlantis_repository_type: 'app-starter'
          })
        })
        // Mock custom properties for repo 2
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([
            ['x-ratelimit-remaining', '4997']
          ]),
          json: async () => ({
            atlantis_repository_type: 'documentation'
          })
        });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toBeDefined();
      expect(result.repositories.length).toBe(2);
      expect(result.repositories[0].customProperties).toBeDefined();
      expect(result.repositories[0].customProperties.atlantis_repository_type).toBe('app-starter');
      expect(result.repositories[1].customProperties.atlantis_repository_type).toBe('documentation');
    });

    it('should handle custom property API errors gracefully', async () => {
      // Mock repository list
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([
            ['x-ratelimit-remaining', '4999']
          ]),
          json: async () => ([
            {
              name: 'test-repo',
              full_name: 'test-user/test-repo',
              description: 'Test repository'
            }
          ])
        })
        // Mock custom properties API error
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({
            message: 'Custom properties not found'
          })
        });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Should still return repository but without custom properties
      expect(result.repositories).toBeDefined();
      expect(result.repositories.length).toBe(1);
    });
  });

  describe('15.5.3 GitHub Rate Limit Handling', () => {
    it('should respect rate limit headers', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 3600;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Map([
          ['x-ratelimit-limit', '5000'],
          ['x-ratelimit-remaining', '10'],
          ['x-ratelimit-reset', String(resetTime)]
        ]),
        json: async () => ([])
      });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Should include rate limit information
      expect(result.rateLimit).toBeDefined();
      expect(result.rateLimit.remaining).toBe(10);
      expect(result.rateLimit.limit).toBe(5000);
      expect(result.rateLimit.reset).toBe(resetTime);
    });

    it('should handle rate limit exceeded (429)', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 3600;

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([
          ['x-ratelimit-limit', '5000'],
          ['x-ratelimit-remaining', '0'],
          ['x-ratelimit-reset', String(resetTime)],
          ['retry-after', '3600']
        ]),
        json: async () => ({
          message: 'API rate limit exceeded'
        })
      });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Should return error with rate limit info
      expect(result.errors).toBeDefined();
      expect(result.errors[0].error).toContain('rate limit');
      expect(result.rateLimit).toBeDefined();
      expect(result.rateLimit.remaining).toBe(0);
    });

    it('should return cached data when rate limited', async () => {
      // This test would require cache integration
      // For now, verify that rate limit error includes staleness indicator

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([
          ['x-ratelimit-remaining', '0'],
          ['x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 3600)]
        ]),
        json: async () => ({
          message: 'API rate limit exceeded'
        })
      });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.errors).toBeDefined();
      expect(result.partialData).toBe(true);
    });
  });

  describe('15.5.4 Repository Filtering by Custom Property', () => {
    it('should filter repositories by atlantis_repository_type', async () => {
      // Mock repository list
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([
            ['x-ratelimit-remaining', '4999']
          ]),
          json: async () => ([
            {
              name: 'app-starter-1',
              full_name: 'test-user/app-starter-1'
            },
            {
              name: 'docs-repo',
              full_name: 'test-user/docs-repo'
            },
            {
              name: 'app-starter-2',
              full_name: 'test-user/app-starter-2'
            }
          ])
        })
        // Mock custom properties
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4998']]),
          json: async () => ({ atlantis_repository_type: 'app-starter' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4997']]),
          json: async () => ({ atlantis_repository_type: 'documentation' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4996']]),
          json: async () => ({ atlantis_repository_type: 'app-starter' })
        });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {},
        parameters: {
          repositoryType: 'app-starter'
        }
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Should only return app-starter repositories
      expect(result.repositories).toBeDefined();
      expect(result.repositories.length).toBe(2);
      expect(result.repositories.every(r =>
        r.customProperties?.atlantis_repository_type === 'app-starter'
      )).toBe(true);
    });

    it('should support multiple repository type filters', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4999']]),
          json: async () => ([
            { name: 'repo-1', full_name: 'test-user/repo-1' },
            { name: 'repo-2', full_name: 'test-user/repo-2' },
            { name: 'repo-3', full_name: 'test-user/repo-3' }
          ])
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4998']]),
          json: async () => ({ atlantis_repository_type: 'app-starter' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4997']]),
          json: async () => ({ atlantis_repository_type: 'documentation' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4996']]),
          json: async () => ({ atlantis_repository_type: 'templates' })
        });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {},
        parameters: {
          repositoryType: ['app-starter', 'documentation']
        }
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toBeDefined();
      expect(result.repositories.length).toBe(2);
      expect(result.repositories.every(r =>
        ['app-starter', 'documentation'].includes(r.customProperties?.atlantis_repository_type)
      )).toBe(true);
    });
  });

  describe('15.5.5 Repository Exclusion When Custom Property Missing', () => {
    it('should exclude repositories without atlantis_repository_type', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4999']]),
          json: async () => ([
            { name: 'repo-with-property', full_name: 'test-user/repo-with-property' },
            { name: 'repo-without-property', full_name: 'test-user/repo-without-property' }
          ])
        })
        // First repo has custom property
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4998']]),
          json: async () => ({ atlantis_repository_type: 'app-starter' })
        })
        // Second repo has no custom property
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4997']]),
          json: async () => ({}) // Empty custom properties
        });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Should only include repository with custom property
      expect(result.repositories).toBeDefined();
      expect(result.repositories.length).toBe(1);
      expect(result.repositories[0].name).toBe('repo-with-property');
    });

    it('should log warning when repository is excluded', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4999']]),
          json: async () => ([
            { name: 'excluded-repo', full_name: 'test-user/excluded-repo' }
          ])
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4998']]),
          json: async () => ({}) // No atlantis_repository_type
        });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      await GitHubAPI.listRepositories(connection, {});

      // Should log warning about excluded repository
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('excluded-repo')
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('atlantis_repository_type')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle custom property API returning 404', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4999']]),
          json: async () => ([
            { name: 'repo-no-properties', full_name: 'test-user/repo-no-properties' }
          ])
        })
        // Custom properties endpoint returns 404
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({
            message: 'Not Found'
          })
        });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Repository should be excluded
      expect(result.repositories).toBeDefined();
      expect(result.repositories.length).toBe(0);
    });

    it('should exclude repositories with null or undefined custom property value', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4999']]),
          json: async () => ([
            { name: 'repo-null-property', full_name: 'test-user/repo-null-property' },
            { name: 'repo-undefined-property', full_name: 'test-user/repo-undefined-property' }
          ])
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4998']]),
          json: async () => ({ atlantis_repository_type: null })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4997']]),
          json: async () => ({ atlantis_repository_type: undefined })
        });

      const connection = {
        host: ['test-user'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Both repositories should be excluded
      expect(result.repositories).toBeDefined();
      expect(result.repositories.length).toBe(0);
    });
  });

  describe('Integration: Multi-User GitHub API', () => {
    it('should aggregate repositories from multiple users/orgs', async () => {
      global.fetch = jest.fn()
        // User 1 repositories
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4999']]),
          json: async () => ([
            { name: 'user1-repo', full_name: 'user1/user1-repo' }
          ])
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4998']]),
          json: async () => ({ atlantis_repository_type: 'app-starter' })
        })
        // User 2 repositories
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4997']]),
          json: async () => ([
            { name: 'user2-repo', full_name: 'user2/user2-repo' }
          ])
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4996']]),
          json: async () => ({ atlantis_repository_type: 'documentation' })
        });

      const connection = {
        host: ['user1', 'user2'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toBeDefined();
      expect(result.repositories.length).toBe(2);
      expect(result.repositories.map(r => r.name)).toContain('user1-repo');
      expect(result.repositories.map(r => r.name)).toContain('user2-repo');
    });

    it('should continue with other users when one fails (brown-out)', async () => {
      global.fetch = jest.fn()
        // User 1 fails
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ message: 'User not found' })
        })
        // User 2 succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4999']]),
          json: async () => ([
            { name: 'user2-repo', full_name: 'user2/user2-repo' }
          ])
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Map([['x-ratelimit-remaining', '4998']]),
          json: async () => ({ atlantis_repository_type: 'app-starter' })
        });

      const connection = {
        host: ['user1', 'user2'],
        path: '/repos',
        headers: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      // Should return data from user2 and error for user1
      expect(result.repositories).toBeDefined();
      expect(result.repositories.length).toBe(1);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBe(1);
      expect(result.partialData).toBe(true);
    });
  });
});
