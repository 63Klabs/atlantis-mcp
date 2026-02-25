/**
 * Unit Tests for Templates Service
 *
 * Tests the Templates service layer including:
 * - list() with caching
 * - get() with caching
 * - listVersions() with caching
 * - listCategories()
 * - checkUpdates()
 * - Service-level bucket filtering
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
  S3Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const Config = require('../../../lambda/read/config');
const _Models = require('../../../lambda/read/models');
const Templates = require('../../../lambda/read/services/templates');

describe('Templates Service', () => {
  // Helper function to create properly structured mock connection and cache profile
  const createMockConnCacheProfile = (connectionName = 's3-templates', profileName = 'templates-list') => {
    return {
      conn: {
        name: connectionName,
        host: [],
        path: 'templates/v2',
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
        pathId: profileName.split('-').pop(), // Extract 'list', 'detail', etc.
        encrypt: false
      }
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    Config.settings.mockReturnValue({
      s3: {
        buckets: ['bucket1', 'bucket2', 'bucket3']
      },
      templates: {
        categories: [
          { name: 'Storage', description: 'Storage templates' },
          { name: 'Network', description: 'Network templates' },
          { name: 'Pipeline', description: 'Pipeline templates' }
        ]
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list() with caching', () => {
    it('should list all templates using cache-data', async () => {
      // Arrange
      const mockConn = {
        name: 's3-templates',
        host: [],
        path: 'templates/v2',
        parameters: {},
        cache: []
      };
      const mockCacheProfile = {
        profile: 'templates-list',
        overrideOriginHeaderExpiration: true,
        defaultExpirationInSeconds: 3600,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 's3-templates',
        pathId: 'list',
        encrypt: false
      };

      Config.getConnCacheProfile.mockReturnValue({
        conn: mockConn,
        cacheProfile: mockCacheProfile
      });

      const mockTemplates = [
        { templateName: 'template1', category: 'Storage' },
        { templateName: 'template2', category: 'Network' }
      ];

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templates: mockTemplates,
          errors: undefined,
          partialData: false
        }
      });

      // Act
      const result = await Templates.list({});

      // Assert
      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-templates', 'templates-list');
      expect(CacheableDataAccess.getData).toHaveBeenCalled();
      expect(result.templates).toEqual(mockTemplates);
      expect(mockConn.host).toEqual(['bucket1', 'bucket2', 'bucket3']);
    });

    it('should filter templates by category', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templates: [{ templateName: 'template1', category: 'Storage' }],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Templates.list({ category: 'Storage' });

      // Assert
      expect(mockConnCache.conn.parameters).toEqual({
        category: 'Storage',
        version: undefined,
        versionId: undefined
      });
    });

    it('should filter templates by version', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templates: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Templates.list({ version: 'v1.3.5/2024-01-15' });

      // Assert
      expect(mockConnCache.conn.parameters).toEqual({
        category: undefined,
        version: 'v1.3.5/2024-01-15',
        versionId: undefined
      });
    });

    it('should filter templates by versionId', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templates: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Templates.list({ versionId: 'abc123' });

      // Assert
      expect(mockConnCache.conn.parameters).toEqual({
        category: undefined,
        version: undefined,
        versionId: 'abc123'
      });
    });

    it('should filter templates by specific buckets', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templates: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Templates.list({ s3Buckets: ['bucket1', 'bucket2'] });

      // Assert
      expect(mockConnCache.conn.host).toEqual(['bucket1', 'bucket2']);
    });

    it('should validate bucket filter against configured buckets', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templates: [],
          errors: undefined,
          partialData: false
        }
      });

      // Act
      await Templates.list({ s3Buckets: ['bucket1', 'invalid-bucket'] });

      // Assert - invalid bucket should be filtered out
      expect(mockConnCache.conn.host).toEqual(['bucket1']);
    });

    it('should throw error if no valid buckets specified', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile();
      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      // Act & Assert
      await expect(Templates.list({ s3Buckets: ['invalid-bucket'] }))
        .rejects.toThrow('No valid S3 buckets specified');
    });

    it('should throw error if connection profile not available', async () => {
      // Arrange
      Config.getConnCacheProfile.mockReturnValue({
        conn: null,
        cacheProfile: null
      });

      // Act & Assert
      await expect(Templates.list({}))
        .rejects.toThrow('Failed to get connection and cache profile');
    });
  });

  describe('get() with caching', () => {
    it('should get specific template using cache-data', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      const mockTemplate = {
        templateName: 'template1',
        category: 'Storage',
        version: 'v1.3.5/2024-01-15',
        content: 'template content'
      };

      CacheableDataAccess.getData.mockResolvedValue({
        body: mockTemplate
      });

      // Act
      const result = await Templates.get({
        category: 'Storage',
        templateName: 'template1'
      });

      // Assert
      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-templates', 'template-detail');
      expect(CacheableDataAccess.getData).toHaveBeenCalled();
      expect(result).toEqual(mockTemplate);
      expect(mockConnCache.cacheProfile.pathId).toBe('template-detail:Storage/template1');
    });

    it('should require category and templateName', async () => {
      // Act & Assert
      await expect(Templates.get({}))
        .rejects.toThrow('category and templateName are required');

      await expect(Templates.get({ category: 'Storage' }))
        .rejects.toThrow('category and templateName are required');

      await expect(Templates.get({ templateName: 'template1' }))
        .rejects.toThrow('category and templateName are required');
    });

    it('should get template by version', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: { templateName: 'template1', version: 'v1.3.5/2024-01-15' }
      });

      // Act
      await Templates.get({
        category: 'Storage',
        templateName: 'template1',
        version: 'v1.3.5/2024-01-15'
      });

      // Assert
      expect(mockConnCache.conn.parameters).toEqual({
        category: 'Storage',
        templateName: 'template1',
        version: 'v1.3.5/2024-01-15',
        versionId: undefined
      });
    });

    it('should get template by versionId', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: { templateName: 'template1', versionId: 'abc123' }
      });

      // Act
      await Templates.get({
        category: 'Storage',
        templateName: 'template1',
        versionId: 'abc123'
      });

      // Assert
      expect(mockConnCache.conn.parameters).toEqual({
        category: 'Storage',
        templateName: 'template1',
        version: undefined,
        versionId: 'abc123'
      });
    });

    it('should filter by specific buckets', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: { templateName: 'template1' }
      });

      // Act
      await Templates.get({
        category: 'Storage',
        templateName: 'template1',
        s3Buckets: ['bucket1']
      });

      // Assert
      expect(mockConnCache.conn.host).toEqual(['bucket1']);
    });
  });

  describe('listVersions() with caching', () => {
    it('should list template versions using cache-data', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-versions');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      const mockVersions = {
        templateName: 'template1',
        category: 'Storage',
        versions: [
          { version: 'v1.3.5/2024-01-15', versionId: 'abc123' },
          { version: 'v1.3.4/2024-01-10', versionId: 'def456' }
        ]
      };

      CacheableDataAccess.getData.mockResolvedValue({
        body: mockVersions
      });

      // Act
      const result = await Templates.listVersions({
        category: 'Storage',
        templateName: 'template1'
      });

      // Assert
      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-templates', 'template-versions');
      expect(CacheableDataAccess.getData).toHaveBeenCalled();
      expect(result).toEqual(mockVersions);
    });

    it('should require category and templateName', async () => {
      // Act & Assert
      await expect(Templates.listVersions({}))
        .rejects.toThrow('category and templateName are required');
    });

    it('should filter by specific buckets', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-versions');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: { versions: [] }
      });

      // Act
      await Templates.listVersions({
        category: 'Storage',
        templateName: 'template1',
        s3Buckets: ['bucket1', 'bucket2']
      });

      // Assert
      expect(mockConnCache.conn.host).toEqual(['bucket1', 'bucket2']);
    });
  });

  describe('listCategories()', () => {
    it('should list all template categories with counts', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'templates-list');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      // Mock list() calls for each category
      CacheableDataAccess.getData
        .mockResolvedValueOnce({
          body: {
            templates: [{ name: 't1' }, { name: 't2' }],
            errors: undefined,
            partialData: false
          }
        })
        .mockResolvedValueOnce({
          body: {
            templates: [{ name: 't3' }],
            errors: undefined,
            partialData: false
          }
        })
        .mockResolvedValueOnce({
          body: {
            templates: [{ name: 't4' }, { name: 't5' }, { name: 't6' }],
            errors: undefined,
            partialData: false
          }
        });

      // Act
      const result = await Templates.listCategories();

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        name: 'Storage',
        description: 'Storage templates',
        templateCount: 2
      });
      expect(result[1]).toEqual({
        name: 'Network',
        description: 'Network templates',
        templateCount: 1
      });
      expect(result[2]).toEqual({
        name: 'Pipeline',
        description: 'Pipeline templates',
        templateCount: 3
      });
    });

    it('should handle errors when getting template counts', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'templates-list');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      // Mock list() to fail for one category
      CacheableDataAccess.getData
        .mockResolvedValueOnce({
          body: {
            templates: [{ name: 't1' }],
            errors: undefined,
            partialData: false
          }
        })
        .mockRejectedValueOnce(new Error('Failed to list templates'))
        .mockResolvedValueOnce({
          body: {
            templates: [{ name: 't2' }],
            errors: undefined,
            partialData: false
          }
        });

      // Act
      const result = await Templates.listCategories();

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0].templateCount).toBe(1);
      expect(result[1].templateCount).toBe(0); // Failed category
      expect(result[2].templateCount).toBe(1);
    });
  });

  describe('checkUpdates()', () => {
    it('should check for template updates', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templateName: 'template1',
          category: 'Storage',
          version: 'v1.3.5/2024-01-15',
          description: 'Updated template',
          s3Path: 's3://bucket/template1.yml',
          namespace: 'atlantis',
          bucket: 'bucket1'
        }
      });

      // Act
      const result = await Templates.checkUpdates({
        templates: [
          {
            category: 'Storage',
            templateName: 'template1',
            currentVersion: 'v1.3.4/2024-01-10'
          }
        ]
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        category: 'Storage',
        templateName: 'template1',
        currentVersion: 'v1.3.4/2024-01-10',
        latestVersion: 'v1.3.5/2024-01-15',
        updateAvailable: true,
        releaseDate: '2024-01-15',
        breakingChanges: false
      });
    });

    it('should detect breaking changes (major version change)', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templateName: 'template1',
          category: 'Storage',
          version: 'v2.0.0/2024-01-15',
          description: 'Major update',
          s3Path: 's3://bucket/template1.yml',
          namespace: 'atlantis',
          bucket: 'bucket1'
        }
      });

      // Act
      const result = await Templates.checkUpdates({
        templates: [
          {
            category: 'Storage',
            templateName: 'template1',
            currentVersion: 'v1.3.5/2024-01-10'
          }
        ]
      });

      // Assert
      expect(result[0].breakingChanges).toBe(true);
      expect(result[0].migrationGuide).toContain('migration-from-v1x-to-v2x');
    });

    it('should indicate no update when versions match', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockResolvedValue({
        body: {
          templateName: 'template1',
          category: 'Storage',
          version: 'v1.3.5/2024-01-15',
          description: 'Current version',
          s3Path: 's3://bucket/template1.yml',
          namespace: 'atlantis',
          bucket: 'bucket1'
        }
      });

      // Act
      const result = await Templates.checkUpdates({
        templates: [
          {
            category: 'Storage',
            templateName: 'template1',
            currentVersion: 'v1.3.5/2024-01-15'
          }
        ]
      });

      // Assert
      expect(result[0].updateAvailable).toBe(false);
      expect(result[0].breakingChanges).toBe(false);
    });

    it('should check multiple templates in single request', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData
        .mockResolvedValueOnce({
          body: {
            templateName: 'template1',
            version: 'v1.3.5/2024-01-15',
            s3Path: 's3://bucket/template1.yml'
          }
        })
        .mockResolvedValueOnce({
          body: {
            templateName: 'template2',
            version: 'v2.0.0/2024-01-20',
            s3Path: 's3://bucket/template2.yml'
          }
        });

      // Act
      const result = await Templates.checkUpdates({
        templates: [
          {
            category: 'Storage',
            templateName: 'template1',
            currentVersion: 'v1.3.4/2024-01-10'
          },
          {
            category: 'Pipeline',
            templateName: 'template2',
            currentVersion: 'v1.5.0/2024-01-15'
          }
        ]
      });

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].templateName).toBe('template1');
      expect(result[1].templateName).toBe('template2');
    });

    it('should require templates array', async () => {
      // Act & Assert
      await expect(Templates.checkUpdates({}))
        .rejects.toThrow('templates array is required');

      await expect(Templates.checkUpdates({ templates: [] }))
        .rejects.toThrow('templates array is required');
    });

    it('should handle errors for individual templates', async () => {
      // Arrange
      const mockConnCache = createMockConnCacheProfile('s3-templates', 'template-detail');

      Config.getConnCacheProfile.mockReturnValue(mockConnCache);

      CacheableDataAccess.getData.mockRejectedValue(new Error('Template not found'));

      // Act
      const result = await Templates.checkUpdates({
        templates: [
          {
            category: 'Storage',
            templateName: 'nonexistent',
            currentVersion: 'v1.0.0/2024-01-01'
          }
        ]
      });

      // Assert
      expect(result[0].error).toBe('Template not found');
      expect(result[0].updateAvailable).toBe(false);
    });

    it('should validate required fields for each template', async () => {
      // Act
      const result = await Templates.checkUpdates({
        templates: [
          {
            category: 'Storage',
            // Missing templateName and currentVersion
          }
        ]
      });

      // Assert
      expect(result[0].error).toContain('required');
    });
  });
});
