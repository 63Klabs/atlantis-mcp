/**
 * Property-Based Tests for Service Layer Namespace Handling
 *
 * Feature: add-namespace-filter-to-list-templates
 * Validates correctness properties for namespace inclusion in
 * connection parameters across all four service operations.
 */

const fc = require('fast-check');

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
 * Arbitrary that generates valid namespace strings matching ^[a-z0-9][a-z0-9-]*$
 * with maxLength 63.
 */
const validNamespaceArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 1, maxLength: 62 }
).map(s => {
  const first = s.charAt(0) === '-' ? 'a' : s.charAt(0);
  return first + s.slice(1);
}).filter(s => /^[a-z0-9][a-z0-9-]*$/.test(s) && s.length <= 63);

/**
 * Helper: clear call history on all mocks without resetting implementations.
 */
function clearMockCalls() {
  CacheableDataAccess.getData.mockClear();
  Config.getConnCacheProfile.mockClear();
  Config.settings.mockClear();
  Models.S3Templates.list.mockClear();
  Models.S3Templates.get.mockClear();
  Models.S3Templates.listVersions.mockClear();
}

/**
 * Helper: set up standard mock implementations.
 */
function setupMocks() {
  Config.getConnCacheProfile.mockImplementation(() => ({
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
  }));

  Config.settings.mockReturnValue({
    s3: { buckets: ['bucket1'] },
    templates: { categories: [] }
  });

  CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
    return {
      getBody: () => ({ templates: [], templateName: 'tpl', version: 'v1.0.0/2024-01-01' }),
      body: { templates: [] }
    };
  });

  Models.S3Templates.list.mockResolvedValue({ templates: [], errors: undefined, partialData: false });
  Models.S3Templates.get.mockResolvedValue({ templateName: 't', version: 'v1.0.0/2024-01-01' });
  Models.S3Templates.listVersions.mockResolvedValue({ versions: [] });
}

/* ------------------------------------------------------------------ */
/*  Property 4: Service includes namespace in connection parameters   */
/*  Validates: Requirements 3.1, 3.2, 3.3, 3.4                       */
/* ------------------------------------------------------------------ */

describe('Feature: add-namespace-filter-to-list-templates, Property 4: Service includes namespace in connection parameters', () => {

  beforeEach(() => {
    clearMockCalls();
    setupMocks();
  });

  test('list() includes namespace in conn.parameters', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          clearMockCalls();

          await Templates.list({ namespace });

          expect(CacheableDataAccess.getData).toHaveBeenCalledTimes(1);
          const conn = CacheableDataAccess.getData.mock.calls[0][2];
          expect(conn.parameters.namespace).toBe(namespace);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('get() includes namespace in conn.parameters', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          clearMockCalls();

          await Templates.get({ category: 'Storage', templateName: 'tpl', namespace });

          expect(CacheableDataAccess.getData).toHaveBeenCalledTimes(1);
          const conn = CacheableDataAccess.getData.mock.calls[0][2];
          expect(conn.parameters.namespace).toBe(namespace);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('listVersions() includes namespace in conn.parameters', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          clearMockCalls();

          await Templates.listVersions({ category: 'Storage', templateName: 'tpl', namespace });

          expect(CacheableDataAccess.getData).toHaveBeenCalledTimes(1);
          const conn = CacheableDataAccess.getData.mock.calls[0][2];
          expect(conn.parameters.namespace).toBe(namespace);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('checkUpdates() passes namespace through to inner get() call', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          clearMockCalls();

          await Templates.checkUpdates({
            templates: [{ category: 'Storage', templateName: 'tpl', currentVersion: 'v1.0.0' }],
            namespace
          });

          // checkUpdates calls get() internally, which calls CacheableDataAccess.getData
          expect(CacheableDataAccess.getData).toHaveBeenCalled();
          const conn = CacheableDataAccess.getData.mock.calls[0][2];
          expect(conn.parameters.namespace).toBe(namespace);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property 5: Different namespace values produce different cache     */
/*  keys                                                               */
/*  Validates: Requirements 3.5, 3.6                                   */
/* ------------------------------------------------------------------ */

describe('Feature: add-namespace-filter-to-list-templates, Property 5: Different namespace values produce different cache keys', () => {

  beforeEach(() => {
    clearMockCalls();
    setupMocks();
  });

  /**
   * Arbitrary that generates pairs of distinct namespace values,
   * including undefined as a possible value.
   */
  const distinctNamespacePairArb = fc.tuple(
    fc.option(validNamespaceArb, { nil: undefined }),
    fc.option(validNamespaceArb, { nil: undefined })
  ).filter(([a, b]) => a !== b);

  test('list() produces different conn.parameters for different namespaces', () => {
    return fc.assert(
      fc.asyncProperty(
        distinctNamespacePairArb,
        async ([ns1, ns2]) => {
          clearMockCalls();
          await Templates.list({ category: 'Storage', namespace: ns1 });
          const params1 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

          clearMockCalls();
          await Templates.list({ category: 'Storage', namespace: ns2 });
          const params2 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

          expect(JSON.stringify(params1)).not.toBe(JSON.stringify(params2));
        }
      ),
      { numRuns: 100 }
    );
  });

  test('get() produces different conn.parameters for different namespaces', () => {
    return fc.assert(
      fc.asyncProperty(
        distinctNamespacePairArb,
        async ([ns1, ns2]) => {
          clearMockCalls();
          await Templates.get({ category: 'Storage', templateName: 'tpl', namespace: ns1 });
          const params1 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

          clearMockCalls();
          await Templates.get({ category: 'Storage', templateName: 'tpl', namespace: ns2 });
          const params2 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

          expect(JSON.stringify(params1)).not.toBe(JSON.stringify(params2));
        }
      ),
      { numRuns: 100 }
    );
  });

  test('listVersions() produces different conn.parameters for different namespaces', () => {
    return fc.assert(
      fc.asyncProperty(
        distinctNamespacePairArb,
        async ([ns1, ns2]) => {
          clearMockCalls();
          await Templates.listVersions({ category: 'Storage', templateName: 'tpl', namespace: ns1 });
          const params1 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

          clearMockCalls();
          await Templates.listVersions({ category: 'Storage', templateName: 'tpl', namespace: ns2 });
          const params2 = { ...CacheableDataAccess.getData.mock.calls[0][2].parameters };

          expect(JSON.stringify(params1)).not.toBe(JSON.stringify(params2));
        }
      ),
      { numRuns: 100 }
    );
  });
});
