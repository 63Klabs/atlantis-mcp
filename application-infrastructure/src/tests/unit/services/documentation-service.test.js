/**
 * Unit Tests for Documentation Service
 * 
 * Tests the Documentation service layer including:
 * - search() with caching
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

jest.mock('../../../lambda/read/config', () => ({
  getConnCacheProfile: jest.fn(),
  settings: jest.fn()
}));

jest.mock('../../../lambda/read/models', () => ({
  DocIndex: {
    search: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const Config = require('../../../lambda/read/config');
const Models = require('../../../lambda/read/models');
const Documentation = require('../../../lambda/read/services/documentation');

describe('Documentation Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    Config.settings.mockReturnValue({
      github: {
        userOrgs: ['63klabs', 'myorg', 'testorg']
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('search() with caching', () => {
    it('should search documentation using cache-data', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      const mockResults = {
        results: [
          {
            title: 'Getting Started',
            excerpt: 'Introduction to cache-data',
            type: 'documentation',
            subType: 'guide'
          }
        ],
        totalResults: 1,
        query: 'cache-data',
        suggestions: [],
        errors: undefined,
        partialData: false
      };

      CacheableDataAccess.getData.mockResolvedValue({
        body: mockResults
      });

      // Act
      const result = await Documentation.search({ query: 'cache-data' });

      // Assert
      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('doc-index', 'search');
      expect(CacheableDataAccess.getData).toHaveBeenCalled();
      expect(result).toEqual(mockResults);
      expect(mockConn.host).toEqual(['63klabs', 'myorg', 'testorg']);
    });

    it('should require query parameter', async () => {
      // Act & Assert
      await expect(Documentation.search({}))
        .rejects.toThrow('query is required');
      
      await expect(Documentation.search({ query: '' }))
        .rejects.toThrow('query is required');
      
      await expect(Documentation.search({ query: '   ' }))
        .rejects.toThrow('query is required');
    });

    it('should filter by type', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          results: [],
          totalResults: 0,
          query: 'Lambda',
          suggestions: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Documentation.search({
        query: 'Lambda',
        type: 'code-example'
      });

      // Assert
      expect(mockConn.parameters).toEqual({
        query: 'Lambda',
        type: 'code-example',
        subType: undefined,
        limit: 10
      });
    });

    it('should filter by subType', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          results: [],
          totalResults: 0,
          query: 'getting started',
          suggestions: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Documentation.search({
        query: 'getting started',
        type: 'documentation',
        subType: 'tutorial'
      });

      // Assert
      expect(mockConn.parameters).toEqual({
        query: 'getting started',
        type: 'documentation',
        subType: 'tutorial',
        limit: 10
      });
    });

    it('should support custom limit', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          results: [],
          totalResults: 0,
          query: 'test',
          suggestions: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Documentation.search({
        query: 'test',
        limit: 25
      });

      // Assert
      expect(mockConn.parameters.limit).toBe(25);
    });

    it('should default limit to 10', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          results: [],
          totalResults: 0,
          query: 'test',
          suggestions: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Documentation.search({ query: 'test' });

      // Assert
      expect(mockConn.parameters.limit).toBe(10);
    });

    it('should filter by specific GitHub users/orgs', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          results: [],
          totalResults: 0,
          query: 'test',
          suggestions: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Documentation.search({
        query: 'test',
        ghusers: ['63klabs', 'myorg']
      });

      // Assert
      expect(mockConn.host).toEqual(['63klabs', 'myorg']);
    });

    it('should validate GitHub users/orgs filter against configured users/orgs', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          results: [],
          totalResults: 0,
          query: 'test',
          suggestions: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Documentation.search({
        query: 'test',
        ghusers: ['63klabs', 'invalid-org']
      });

      // Assert - invalid org should be filtered out
      expect(mockConn.host).toEqual(['63klabs']);
    });

    it('should throw error if no valid GitHub users/orgs specified', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      // Act & Assert
      await expect(Documentation.search({
        query: 'test',
        ghusers: ['invalid-org']
      })).rejects.toThrow('No valid GitHub users/orgs specified');
    });

    it('should trim query before searching', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          results: [],
          totalResults: 0,
          query: 'test query',
          suggestions: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Documentation.search({ query: '  test query  ' });

      // Assert
      expect(mockConn.parameters.query).toBe('test query');
    });

    it('should call DocIndex.search() in fetch function', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      const mockSearchResults = {
        results: [{ title: 'Result 1' }],
        totalResults: 1,
        suggestions: ['suggestion1']
      };

      Models.DocIndex.search.mockResolvedValue(mockSearchResults);

      CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn) => {
        const result = await fetchFn(mockConn, {});
        return { body: result };
      });

      // Act
      const result = await Documentation.search({ query: 'test' });

      // Assert
      expect(Models.DocIndex.search).toHaveBeenCalledWith({
        query: 'test',
        type: undefined,
        subType: undefined,
        limit: 10
      });
      expect(result.results).toEqual(mockSearchResults.results);
      expect(result.suggestions).toEqual(mockSearchResults.suggestions);
    });

    it('should return suggestions when no results found', async () => {
      // Arrange
      const mockConn = { host: [], parameters: {} };
      const mockCacheProfile = { pathId: 'search' };
      
      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          results: [],
          totalResults: 0,
          query: 'nonexistent',
          suggestions: ['Did you mean: cache-data?', 'Try: Lambda function'],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      const result = await Documentation.search({ query: 'nonexistent' });

      // Assert
      expect(result.results).toHaveLength(0);
      expect(result.suggestions).toHaveLength(2);
    });

    it('should throw error if connection profile not available', async () => {
      // Arrange
      Config.getConnCacheProfile.mockReturnValue({
        conn: null,
        cacheProfile: null
      });

      // Act & Assert
      await expect(Documentation.search({ query: 'test' }))
        .rejects.toThrow('Failed to get connection and cache profile');
    });
  });
});
