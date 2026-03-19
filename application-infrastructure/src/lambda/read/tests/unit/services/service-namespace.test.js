/**
 * Unit Tests for Service Layer Namespace Handling
 *
 * Feature: add-namespace-filter-to-list-templates
 * Tests that namespace is correctly included in conn.parameters
 * for list, get, listVersions, and checkUpdates operations.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
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
    },
    ApiRequest: {
      success: jest.fn((opts) => opts),
      error: jest.fn((opts) => opts)
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
  S3Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const Templates = require('../../../services/templates');

/**
 * Helper: set up standard mocks for each test.
 */
function setupMocks() {
  Config.getConnCacheProfile.mockReturnValue({
    conn: {
      name: 's3-templates',
      host: [],
      path: 'templates/v2',
      parameters: {},
      cache: []
    },
    cacheProfile: {
      profile: 'templates-list',
      overrideOriginHeaderExpiration: true,
      defaultExpirationInSeconds: 3600,
      expirationIsOnInterval: false,
      headersToRetain: '',
      hostId: 's3-templates',
      pathId: 'list',
      encrypt: false
    }
  });

  Config.settings.mockReturnValue({
    s3: { buckets: ['bucket1'] },
    templates: { categories: [] }
  });

  // Capture conn without calling fetchFunction
  CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
    return {
      getBody: () => ({ templates: [] }),
      body: { templates: [] }
    };
  });

  Models.S3Templates.list.mockResolvedValue({ templates: [], errors: undefined, partialData: false });
  Models.S3Templates.get.mockResolvedValue({ templateName: 't', version: 'v1.0.0/2024-01-01' });
  Models.S3Templates.listVersions.mockResolvedValue({ versions: [] });
}

describe('Service Layer Namespace Handling', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list()', () => {
    it('should include namespace in conn.parameters when provided', async () => {
      await Templates.list({ namespace: 'acme' });

      const conn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(conn.parameters.namespace).toBe('acme');
    });

    it('should set namespace to undefined in conn.parameters when omitted', async () => {
      await Templates.list({});

      const conn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(conn.parameters.namespace).toBeUndefined();
    });

    it('should produce different conn.parameters with different namespaces', async () => {
      await Templates.list({ category: 'Storage', namespace: 'acme' });
      const params1 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      jest.clearAllMocks();
      setupMocks();

      await Templates.list({ category: 'Storage', namespace: 'turbo-kiln' });
      const params2 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      expect(params1.namespace).toBe('acme');
      expect(params2.namespace).toBe('turbo-kiln');
      expect(JSON.stringify(params1)).not.toBe(JSON.stringify(params2));
    });

    it('should produce different conn.parameters with namespace vs without', async () => {
      await Templates.list({ category: 'Storage', namespace: 'acme' });
      const params1 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      jest.clearAllMocks();
      setupMocks();

      await Templates.list({ category: 'Storage' });
      const params2 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      expect(params1.namespace).toBe('acme');
      expect(params2.namespace).toBeUndefined();
      expect(JSON.stringify(params1)).not.toBe(JSON.stringify(params2));
    });
  });

  describe('get()', () => {
    it('should include namespace in conn.parameters when provided', async () => {
      await Templates.get({ category: 'Storage', templateName: 'tpl', namespace: 'atlantis' });

      const conn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(conn.parameters.namespace).toBe('atlantis');
    });

    it('should set namespace to undefined in conn.parameters when omitted', async () => {
      await Templates.get({ category: 'Storage', templateName: 'tpl' });

      const conn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(conn.parameters.namespace).toBeUndefined();
    });

    it('should produce different conn.parameters with different namespaces', async () => {
      await Templates.get({ category: 'Storage', templateName: 'tpl', namespace: 'acme' });
      const params1 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      jest.clearAllMocks();
      setupMocks();

      await Templates.get({ category: 'Storage', templateName: 'tpl', namespace: 'x1' });
      const params2 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      expect(JSON.stringify(params1)).not.toBe(JSON.stringify(params2));
    });
  });

  describe('listVersions()', () => {
    it('should include namespace in conn.parameters when provided', async () => {
      await Templates.listVersions({ category: 'Storage', templateName: 'tpl', namespace: 'turbo-kiln' });

      const conn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(conn.parameters.namespace).toBe('turbo-kiln');
    });

    it('should set namespace to undefined in conn.parameters when omitted', async () => {
      await Templates.listVersions({ category: 'Storage', templateName: 'tpl' });

      const conn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(conn.parameters.namespace).toBeUndefined();
    });

    it('should produce different conn.parameters with different namespaces', async () => {
      await Templates.listVersions({ category: 'Storage', templateName: 'tpl', namespace: 'acme' });
      const params1 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      jest.clearAllMocks();
      setupMocks();

      await Templates.listVersions({ category: 'Storage', templateName: 'tpl' });
      const params2 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      expect(JSON.stringify(params1)).not.toBe(JSON.stringify(params2));
    });
  });

  describe('checkUpdates()', () => {
    it('should pass namespace through to inner get() call', async () => {
      await Templates.checkUpdates({
        templates: [{ category: 'Storage', templateName: 'tpl', currentVersion: 'v1.0.0' }],
        namespace: 'acme'
      });

      // checkUpdates calls get() internally which calls CacheableDataAccess.getData
      expect(CacheableDataAccess.getData).toHaveBeenCalled();
      const conn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(conn.parameters.namespace).toBe('acme');
    });

    it('should pass undefined namespace when omitted', async () => {
      await Templates.checkUpdates({
        templates: [{ category: 'Storage', templateName: 'tpl', currentVersion: 'v1.0.0' }]
      });

      expect(CacheableDataAccess.getData).toHaveBeenCalled();
      const conn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(conn.parameters.namespace).toBeUndefined();
    });

    it('should produce different cache keys with different namespaces', async () => {
      await Templates.checkUpdates({
        templates: [{ category: 'Storage', templateName: 'tpl', currentVersion: 'v1.0.0' }],
        namespace: 'acme'
      });
      const params1 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      jest.clearAllMocks();
      setupMocks();

      await Templates.checkUpdates({
        templates: [{ category: 'Storage', templateName: 'tpl', currentVersion: 'v1.0.0' }],
        namespace: 'turbo-kiln'
      });
      const params2 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

      expect(JSON.stringify(params1)).not.toBe(JSON.stringify(params2));
    });
  });
});
