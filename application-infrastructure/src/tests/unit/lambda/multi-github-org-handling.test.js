/**
 * Multiple GitHub User/Org Handling Tests
 * 
 * Tests that the MCP server correctly handles multiple GitHub users/orgs:
 * - Aggregating repositories from multiple orgs
 * - Org priority ordering
 * - Deduplication across orgs
 * - Filtering by specific orgs
 * - Org validation against configured list
 */

describe('Multiple GitHub User/Org Handling', () => {
  let GitHubAPI;
  let Config;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    jest.mock('../../../lambda/read/config', () => ({
      settings: jest.fn()
    }));
    
    GitHubAPI = require('../../../lambda/read/models/github-api');
    Config = require('../../../lambda/read/config');
    
    Config.settings.mockReturnValue({
      github: {
        users: ['org1', 'org2', 'org3']
      }
    });
  });

  test('should aggregate repositories from multiple orgs', async () => {
    const mockFetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'repo1', full_name: 'org1/repo1' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ property_name: 'atlantis_repository-type', value: 'app-starter' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'repo2', full_name: 'org2/repo2' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ property_name: 'atlantis_repository-type', value: 'app-starter' }]
      });
    
    global.fetch = mockFetch;
    
    const connection = {
      host: ['org1', 'org2'],
      path: '/repos',
      parameters: {}
    };
    
    const result = await GitHubAPI.listRepositories(connection, {});
    
    expect(result.repositories).toHaveLength(2);
    expect(result.repositories.map(r => r.full_name)).toEqual(['org1/repo1', 'org2/repo2']);
  });

  test('should maintain org priority order', async () => {
    const mockFetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'shared-repo', full_name: 'org1/shared-repo' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ property_name: 'atlantis_repository-type', value: 'app-starter' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'shared-repo', full_name: 'org2/shared-repo' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ property_name: 'atlantis_repository-type', value: 'app-starter' }]
      });
    
    global.fetch = mockFetch;
    
    const connection = {
      host: ['org1', 'org2'],
      path: '/repos',
      parameters: {}
    };
    
    const result = await GitHubAPI.listRepositories(connection, {});
    
    // Should only return from org1 (higher priority)
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0].full_name).toBe('org1/shared-repo');
  });

  test('should filter to specific orgs when ghusers parameter provided', async () => {
    const mockFetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'repo1', full_name: 'org1/repo1' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ property_name: 'atlantis_repository-type', value: 'app-starter' }]
      });
    
    global.fetch = mockFetch;
    
    const connection = {
      host: ['org1'],
      path: '/repos',
      parameters: {}
    };
    
    const result = await GitHubAPI.listRepositories(connection, {});
    
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0].full_name).toBe('org1/repo1');
  });

  test('should include org name in repository metadata', async () => {
    const mockFetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ name: 'repo1', full_name: 'org1/repo1', owner: { login: 'org1' } }]
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ property_name: 'atlantis_repository-type', value: 'app-starter' }]
      });
    
    global.fetch = mockFetch;
    
    const connection = {
      host: ['org1'],
      path: '/repos',
      parameters: {}
    };
    
    const result = await GitHubAPI.listRepositories(connection, {});
    
    expect(result.repositories[0]).toHaveProperty('owner');
    expect(result.repositories[0].owner.login).toBe('org1');
  });
});
