/**
 * Unit Tests for Starters Service
 *
 * Tests the Starters service layer including:
 * - list() with S3-only caching via s3-app-starters connection
 * - get() with S3-only caching via s3-app-starters connection
 * - S3 bucket validation against configured buckets
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
    },
    ApiRequest: {
      success: jest.fn(({ body }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: 200 })),
      error: jest.fn(({ body, statusCode }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: statusCode || 500 }))
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
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const Starters = require('../../../services/starters');

describe('Starters Service', () => {
  // Helper function to create properly structured mock connection and cache profile
  const createMockConnCacheProfile = (connectionName = 's3-app-starters', profileName = 'starters-list') => {
    return {
      conn: {
        name: connectionName,
        host: [],
        path: 'app-starters/v2',
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
        pathId: profileName,
        encrypt: false
      }
    };
  };

  beforeEach(() => {
    // Clear all mocks
    CacheableDataAccess.getData.mockClear();
    Models.S3Starters.list.mockClear();
    Models.S3Starters.get.mockClear();
    Config.getConnCacheProfile.mockClear();
    Config.settings.mockClear();

    // Default mock implementations
    Config.settings.mockReturnValue({
      s3: {
        buckets: ['63klabs', 'bucket2'],
        starterPrefix: 'app-starters/v2'
      }
    });

    // Mock CacheableDataAccess.getData to call fetchFunction directly
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      return await fetchFunction(conn, opts);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list() with S3-only caching', () => {
    it('should list all starters using s3-app-starters connection', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      const mockStarters = [
        { name: 'starter1', hasSidecarMetadata: true },
        { name: 'starter2', hasSidecarMetadata: true }
      ];

      Models.S3Starters.list.mockResolvedValue({
        starters: mockStarters,
        errors: undefined
      });

      // Act
      const result = await Starters.list({});

      // Assert
      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-app-starters', 'starters-list');
      expect(Models.S3Starters.list).toHaveBeenCalled();
      expect(result.starters).toHaveLength(2);
      expect(mockConnCache.conn.host).toEqual(['63klabs', 'bucket2']);
    });

    it('should filter to specific S3 buckets when s3Buckets provided', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [],
        errors: undefined
      });

      // Act
      await Starters.list({ s3Buckets: ['63klabs'] });

      // Assert
      expect(mockConnCache.conn.host).toEqual(['63klabs']);
    });

    it('should validate S3 buckets against configured buckets', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [],
        errors: undefined
      });

      // Act
      await Starters.list({ s3Buckets: ['63klabs', 'invalid-bucket'] });

      // Assert - invalid bucket should be filtered out
      expect(mockConnCache.conn.host).toEqual(['63klabs']);
    });

    it('should throw error if no valid S3 buckets specified', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      // Act & Assert
      await expect(Starters.list({ s3Buckets: ['invalid-bucket'] }))
        .rejects.toThrow('No valid S3 buckets specified');
    });

    it('should set namespace in connection parameters', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [],
        errors: undefined
      });

      // Act
      await Starters.list({ namespace: 'my-namespace' });

      // Assert
      expect(mockConnCache.conn.parameters).toEqual({ namespace: 'my-namespace' });
    });

    it('should handle errors from S3 source', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.list.mockResolvedValue({
        starters: [{ name: 'starter1' }],
        errors: [{ source: '63klabs', error: 'Access denied' }],
        partialData: true
      });

      // Act
      const result = await Starters.list({});

      // Assert
      expect(result.starters).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should throw error if connection profile not available', async () => {
      // Arrange
      Config.getConnCacheProfile.mockReturnValue({
        conn: null,
        cacheProfile: null
      });

      // Act & Assert
      await expect(Starters.list({}))
        .rejects.toThrow('Failed to get connection and/or cache profile');
    });
  });

  describe('get() with S3-only caching', () => {
    it('should get specific starter using s3-app-starters connection', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-app-starters', 'starter-detail');
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      const mockStarter = {
        name: 'atlantis-starter-02',
        description: 'Starter description',
        languages: ['JavaScript'],
        hasS3Package: true,
        hasSidecarMetadata: true
      };

      Models.S3Starters.get.mockResolvedValue(mockStarter);

      // Act
      const result = await Starters.get({ starterName: 'atlantis-starter-02' });

      // Assert
      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-app-starters', 'starter-detail');
      expect(Models.S3Starters.get).toHaveBeenCalled();
      expect(result.name).toBe('atlantis-starter-02');
      expect(mockConnCache.cacheProfile.pathId).toBe('starter-detail:atlantis-starter-02');
    });

    it('should require starterName', async () => {
      // Act & Assert
      await expect(Starters.get({}))
        .rejects.toThrow('starterName is required');
    });

    it('should filter by specific S3 buckets', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-app-starters', 'starter-detail');
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.get.mockResolvedValue({ name: 'starter1' });

      // Act
      await Starters.get({
        starterName: 'starter1',
        s3Buckets: ['63klabs']
      });

      // Assert
      expect(mockConnCache.conn.host).toEqual(['63klabs']);
    });

    it('should set starterName and namespace in connection parameters', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-app-starters', 'starter-detail');
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      Models.S3Starters.get.mockResolvedValue({ name: 'starter1' });

      // Act
      await Starters.get({ starterName: 'starter1', namespace: 'my-ns' });

      // Assert
      expect(mockConnCache.conn.parameters).toEqual({
        starterName: 'starter1',
        namespace: 'my-ns'
      });
    });

    it('should throw STARTER_NOT_FOUND with available starters when not found', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-app-starters', 'starter-detail');
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      // First call to get() returns null
      Models.S3Starters.get.mockResolvedValue(null);

      // list() call for available starters
      Models.S3Starters.list.mockResolvedValue({
        starters: [
          { name: 'starter1' },
          { name: 'starter2' }
        ],
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
      const mockConnCache = createMockConnCacheProfile('s3-app-starters', 'starter-detail');
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      // First call to get() returns null
      Models.S3Starters.get.mockResolvedValue(null);

      // list() call fails
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
  });
});
