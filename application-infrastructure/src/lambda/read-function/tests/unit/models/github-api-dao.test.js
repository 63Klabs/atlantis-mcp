/**
 * Unit Tests for GitHub API DAO
 *
 * Tests all functions in the GitHub API Data Access Object including:
 * - listRepositories() with multi-user/org support
 * - getRepository()
 * - getCustomProperty()
 * - getReadme()
 * - getReleases()
 * - Rate limit handling
 */

const GitHubAPI = require('../../../models/github-api');
const { Config } = require('../../../config');

// Mock Config
jest.mock('../../../config', () => ({
  Config: {
    settings: jest.fn(() => ({
      githubToken: 'test-token-123',
      githubUsers: ['63klabs', 'test-org']
    }))
  }
}));

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

// Mock fetch
global.fetch = jest.fn();

describe('GitHub API DAO', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Note: jest.clearAllMocks() also resets global.fetch mock
  });

  describe('11.5.10 - listRepositories()', () => {
    it('should list repositories from organization', async () => {
      // Mock org repos API call
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          {
            id: 1,
            name: 'repo1',
            full_name: '63klabs/repo1',
            description: 'Test repo 1',
            private: false,
            html_url: 'https://github.com/63klabs/repo1',
            clone_url: 'https://github.com/63klabs/repo1.git',
            ssh_url: 'git@github.com:63klabs/repo1.git',
            default_branch: 'main',
            language: 'JavaScript',
            stargazers_count: 10,
            forks_count: 5,
            watchers_count: 8,
            open_issues_count: 2,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-15T00:00:00Z',
            pushed_at: '2024-01-15T00:00:00Z'
          }
        ]
      });

      // Mock custom property API call
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          {
            property_name: 'atlantis_repository-type',
            value: 'templates'
          }
        ]
      });

      const connection = {
        host: '63klabs',
        path: '/repos',
        parameters: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].name).toBe('repo1');
      expect(result.repositories[0].atlantis_repository_type).toBe('templates');
      expect(result.partialData).toBe(false);
    });

    it('should list repositories from user if not an org', async () => {
      // Mock org repos API call (404)
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Map()
      });

      // Mock user repos API call
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          {
            id: 1,
            name: 'user-repo',
            full_name: 'testuser/user-repo',
            description: 'User repo',
            private: false,
            html_url: 'https://github.com/testuser/user-repo',
            clone_url: 'https://github.com/testuser/user-repo.git',
            ssh_url: 'git@github.com:testuser/user-repo.git',
            default_branch: 'main',
            language: 'Python',
            stargazers_count: 5,
            forks_count: 2,
            watchers_count: 4,
            open_issues_count: 1,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-15T00:00:00Z',
            pushed_at: '2024-01-15T00:00:00Z'
          }
        ]
      });

      // Mock custom property API call
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          {
            property_name: 'atlantis_repository-type',
            value: 'app-starter'
          }
        ]
      });

      const connection = {
        host: 'testuser',
        path: '/repos',
        parameters: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].name).toBe('user-repo');
    });

    it('should filter repositories by custom property', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          { id: 1, name: 'repo1', full_name: '63klabs/repo1', description: 'Repo 1', private: false, html_url: 'https://github.com/63klabs/repo1', clone_url: 'https://github.com/63klabs/repo1.git', ssh_url: 'git@github.com:63klabs/repo1.git', default_branch: 'main', language: 'JavaScript', stargazers_count: 10, forks_count: 5, watchers_count: 8, open_issues_count: 2, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-15T00:00:00Z', pushed_at: '2024-01-15T00:00:00Z' },
          { id: 2, name: 'repo2', full_name: '63klabs/repo2', description: 'Repo 2', private: false, html_url: 'https://github.com/63klabs/repo2', clone_url: 'https://github.com/63klabs/repo2.git', ssh_url: 'git@github.com:63klabs/repo2.git', default_branch: 'main', language: 'Python', stargazers_count: 5, forks_count: 2, watchers_count: 4, open_issues_count: 1, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-15T00:00:00Z', pushed_at: '2024-01-15T00:00:00Z' }
        ]
      });

      // Mock custom property for repo1 (templates)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          { property_name: 'atlantis_repository-type', value: 'templates' }
        ]
      });

      // Mock custom property for repo2 (app-starter)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          { property_name: 'atlantis_repository-type', value: 'app-starter' }
        ]
      });

      const connection = {
        host: '63klabs',
        path: '/repos',
        parameters: { repositoryType: 'templates' }
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].name).toBe('repo1');
      expect(result.repositories[0].atlantis_repository_type).toBe('templates');
    });

    it('should skip repositories without custom property', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          { id: 1, name: 'repo1', full_name: '63klabs/repo1', description: 'Repo 1', private: false, html_url: 'https://github.com/63klabs/repo1', clone_url: 'https://github.com/63klabs/repo1.git', ssh_url: 'git@github.com:63klabs/repo1.git', default_branch: 'main', language: 'JavaScript', stargazers_count: 10, forks_count: 5, watchers_count: 8, open_issues_count: 2, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-15T00:00:00Z', pushed_at: '2024-01-15T00:00:00Z' }
        ]
      });

      // Mock custom property not found (404)
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Map()
      });

      const connection = {
        host: '63klabs',
        path: '/repos',
        parameters: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.repositories).toHaveLength(0);
    });

    it('should support brown-out when user/org fails', async () => {
      // Mock first user/org fails
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      // Mock second user/org succeeds
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          { id: 2, name: 'repo2', full_name: 'test-org/repo2', description: 'Repo 2', private: false, html_url: 'https://github.com/test-org/repo2', clone_url: 'https://github.com/test-org/repo2.git', ssh_url: 'git@github.com:test-org/repo2.git', default_branch: 'main', language: 'TypeScript', stargazers_count: 15, forks_count: 3, watchers_count: 10, open_issues_count: 1, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-15T00:00:00Z', pushed_at: '2024-01-15T00:00:00Z' }
        ]
      });

      // Mock custom property check for second org's repo
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          { property_name: 'atlantis_repository-type', value: 'templates' }
        ]
      });

      const connection = {
        host: ['63klabs', 'test-org'],
        path: '/repos',
        parameters: {}
      };

      const result = await GitHubAPI.listRepositories(connection, {});

      expect(result.partialData).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].source).toBe('63klabs');
    });
  });

  describe('11.5.11 - getRepository()', () => {
    it('should get specific repository', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          id: 1,
          name: 'test-repo',
          full_name: '63klabs/test-repo',
          description: 'Test repository',
          private: false,
          html_url: 'https://github.com/63klabs/test-repo',
          clone_url: 'https://github.com/63klabs/test-repo.git',
          ssh_url: 'git@github.com:63klabs/test-repo.git',
          default_branch: 'main',
          language: 'JavaScript',
          stargazers_count: 10,
          forks_count: 5,
          watchers_count: 8,
          open_issues_count: 2,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
          pushed_at: '2024-01-15T00:00:00Z'
        })
      });

      // Mock custom property
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          { property_name: 'atlantis_repository-type', value: 'templates' }
        ]
      });

      const connection = {
        host: '63klabs',
        path: '/repos/63klabs/test-repo',
        parameters: { repositoryName: 'test-repo' }
      };

      const result = await GitHubAPI.getRepository(connection, {});

      expect(result).not.toBeNull();
      expect(result.name).toBe('test-repo');
      expect(result.atlantis_repository_type).toBe('templates');
    });

    it('should return null if repository not found', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Map()
      });

      const connection = {
        host: '63klabs',
        path: '/repos/63klabs/nonexistent',
        parameters: { repositoryName: 'nonexistent' }
      };

      const result = await GitHubAPI.getRepository(connection, {});

      expect(result).toBeNull();
    });

    it('should throw error if repositoryName not provided', async () => {
      const connection = {
        host: '63klabs',
        path: '/repos',
        parameters: {}
      };

      await expect(GitHubAPI.getRepository(connection, {})).rejects.toThrow('repositoryName parameter is required');
    });
  });

  describe('11.5.12 - getCustomProperty()', () => {
    it('should get custom property value', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          {
            property_name: 'atlantis_repository-type',
            value: 'templates'
          },
          {
            property_name: 'other_property',
            value: 'other_value'
          }
        ]
      });

      const result = await GitHubAPI.getCustomProperty('63klabs', 'test-repo', 'test-token');

      expect(result).toBe('templates');
    });

    it('should return null if custom property not set', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Map()
      });

      const result = await GitHubAPI.getCustomProperty('63klabs', 'test-repo', 'test-token');

      expect(result).toBeNull();
    });

    it('should return null if atlantis_repository-type not in properties', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          {
            property_name: 'other_property',
            value: 'other_value'
          }
        ]
      });

      const result = await GitHubAPI.getCustomProperty('63klabs', 'test-repo', 'test-token');

      expect(result).toBeNull();
    });
  });

  describe('11.5.13 - getReadme()', () => {
    it('should get README content', async () => {
      const readmeContent = Buffer.from('# Test README\n\nThis is a test.').toString('base64');

      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          name: 'README.md',
          path: 'README.md',
          content: readmeContent,
          size: 100,
          html_url: 'https://github.com/63klabs/test-repo/blob/main/README.md',
          download_url: 'https://raw.githubusercontent.com/63klabs/test-repo/main/README.md'
        })
      });

      const result = await GitHubAPI.getReadme('63klabs', 'test-repo', 'test-token');

      expect(result.name).toBe('README.md');
      expect(result.content).toBe('# Test README\n\nThis is a test.');
      expect(result.url).toBe('https://github.com/63klabs/test-repo/blob/main/README.md');
    });

    it('should throw error if README not found', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Map(),
        statusText: 'Not Found'
      });

      await expect(GitHubAPI.getReadme('63klabs', 'test-repo', 'test-token')).rejects.toThrow('GitHub API error: 404 Not Found');
    });
  });

  describe('11.5.14 - getReleases()', () => {
    it('should get repository releases', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => [
          {
            id: 1,
            tag_name: 'v1.0.0',
            name: 'Version 1.0.0',
            body: 'Release notes',
            draft: false,
            prerelease: false,
            created_at: '2024-01-01T00:00:00Z',
            published_at: '2024-01-01T00:00:00Z',
            html_url: 'https://github.com/63klabs/test-repo/releases/tag/v1.0.0',
            author: {
              login: 'testuser',
              avatar_url: 'https://avatars.githubusercontent.com/u/123',
              html_url: 'https://github.com/testuser'
            }
          }
        ]
      });

      const result = await GitHubAPI.getReleases('63klabs', 'test-repo', 'test-token');

      expect(result).toHaveLength(1);
      expect(result[0].tagName).toBe('v1.0.0');
      expect(result[0].name).toBe('Version 1.0.0');
      expect(result[0].author.login).toBe('testuser');
    });

    it('should return empty array if no releases', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => []
      });

      const result = await GitHubAPI.getReleases('63klabs', 'test-repo', 'test-token');

      expect(result).toHaveLength(0);
    });
  });

  describe('11.5.15 - Rate limit handling', () => {
    it('should throw error when rate limit exceeded', async () => {
      const headers = new Map();
      headers.set('X-RateLimit-Remaining', '0');
      headers.set('X-RateLimit-Reset', '1704067200'); // 2024-01-01 00:00:00 UTC

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers,
        statusText: 'Forbidden'
      });

      await expect(GitHubAPI.getCustomProperty('63klabs', 'test-repo', 'test-token')).rejects.toThrow('GitHub API rate limit exceeded');
    });

    it('should include reset time in rate limit error', async () => {
      const headers = new Map();
      headers.set('X-RateLimit-Remaining', '0');
      headers.set('X-RateLimit-Reset', '1704067200');

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers,
        statusText: 'Forbidden'
      });

      try {
        await GitHubAPI.getReadme('63klabs', 'test-repo', 'test-token');
      } catch (error) {
        expect(error.message).toContain('Resets at');
        expect(error.message).toContain('2024-01-01');
      }
    });
  });

  describe('getRepositoryStats()', () => {
    it('should get repository statistics', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({
          id: 1,
          name: 'test-repo',
          full_name: '63klabs/test-repo',
          description: 'Test repository',
          private: false,
          html_url: 'https://github.com/63klabs/test-repo',
          clone_url: 'https://github.com/63klabs/test-repo.git',
          ssh_url: 'git@github.com:63klabs/test-repo.git',
          default_branch: 'main',
          language: 'JavaScript',
          stargazers_count: 10,
          forks_count: 5,
          watchers_count: 8,
          open_issues_count: 2,
          size: 1024,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
          pushed_at: '2024-01-15T00:00:00Z'
        })
      });

      const result = await GitHubAPI.getRepositoryStats('63klabs', 'test-repo', 'test-token');

      expect(result.stars).toBe(10);
      expect(result.forks).toBe(5);
      expect(result.watchers).toBe(8);
      expect(result.openIssues).toBe(2);
      expect(result.language).toBe('JavaScript');
    });
  });
});
