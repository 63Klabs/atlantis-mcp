/**
 * Backward-compatibility snapshot for the `search_documentation` response contract
 * (spec 0-0-6, task 9.1).
 *
 * Requirement 10 ("Backward compatibility") requires that no existing
 * `search_documentation` result/envelope field is ever removed or renamed, and that every
 * field this spec adds (`githubUrl`/`repositoryType`/`namespace` now populated,
 * `availableFilters`) is additive/optional. `documentation-facets.test.js` covers the
 * `availableFilters`/`suggestions` behavior in detail; this file adds the piece that was
 * missing — an explicit, snapshot-locked inventory of every envelope and per-result field so
 * a future change that silently drops or renames one fails a test immediately.
 *
 * All AWS I/O is mocked: `@63klabs/cache-data` (CacheableDataAccess/DebugAndLog/ApiRequest),
 * `Config`, and `Models.DocIndex` are jest mocks, and `CacheableDataAccess.getData` is wired
 * to invoke the cache-miss fetch function directly so the assembled envelope is observable.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 11.5
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

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
      success: jest.fn(({ body }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: 200 }))
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
  DocIndex: {
    queryIndex: jest.fn(),
    getActiveVersion: jest.fn(),
    getContentMetadataByHashes: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const Documentation = require('../../../services/documentation');

/**
 * The complete `search_documentation` envelope field set that existed before this spec
 * (Requirement 10.1). None of these may be removed or renamed by any future change.
 *
 * @constant {Array<string>}
 */
const PRE_EXISTING_ENVELOPE_FIELDS = ['results', 'totalResults', 'query', 'suggestions', 'errors', 'partialData'];

/**
 * The complete per-result field set that existed before this spec (Requirement 10.1),
 * including the fields that were always present in shape but only became populated
 * (non-null) by this spec's indexer changes (`githubUrl`, `repositoryType`, `namespace`).
 *
 * @constant {Array<string>}
 */
const PRE_EXISTING_RESULT_FIELDS = [
  'title', 'excerpt', 'filePath', 'githubUrl', 'type', 'subType',
  'relevanceScore', 'repository', 'repositoryType', 'namespace'
];

/**
 * Envelope/result fields this spec adds. Additive and optional (Requirement 10.2): their
 * absence must never remove a pre-existing field, and their presence must never replace one.
 *
 * @constant {Array<string>}
 */
const NEW_ADDITIVE_ENVELOPE_FIELDS = ['availableFilters'];

const createMockConnCacheProfile = () => ({
  conn: { name: 'doc-index', host: [], path: '/docs', parameters: {}, cache: [] },
  cacheProfile: {
    profile: 'search',
    overrideOriginHeaderExpiration: true,
    defaultExpirationInSeconds: 3600,
    expirationIsOnInterval: false,
    headersToRetain: '',
    hostId: 'doc-index',
    pathId: 'search',
    encrypt: false
  }
});

/**
 * A fully-populated result object in `queryIndex` shape (every pre-existing field set to a
 * realistic, non-null value) so the snapshot exercises the entire field set at once rather
 * than relying on per-field defaults to mask an accidental removal.
 *
 * @returns {Object} Search result object with every pre-existing field populated.
 */
const makeFullyPopulatedResult = () => ({
  title: 'Cache-Data Installation',
  excerpt: 'Install the package with npm install @63klabs/cache-data and configure...',
  filePath: '63klabs/cache-data/README.md/installation',
  githubUrl: 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md',
  type: 'documentation',
  subType: 'guide',
  relevanceScore: 42,
  repository: 'cache-data',
  repositoryType: 'package',
  namespace: null
});

describe('search_documentation backward-compatibility snapshot', () => {

  beforeEach(() => {
    jest.clearAllMocks();

    Config.settings.mockReturnValue({
      github: { userOrgs: ['63klabs'] },
      docIndexTable: 'test-doc-index-table',
      documentation: {
        ai: { enabled: false, minTier: 'paid', retrievalMode: 'semantic' }
      }
    });
    Config.getConnCacheProfile.mockImplementation(() => createMockConnCacheProfile());

    // Cache miss on every call so the assembled envelope is what search() returns.
    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn, conn) => fetchFn(conn, {}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('envelope field inventory (Req 10.1, 10.2, 10.4)', () => {
    it('should retain every pre-existing envelope field on a populated result set', async () => {
      const results = [makeFullyPopulatedResult()];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: 1, query: 'cache-data', suggestions: []
      });

      const result = await Documentation.search({ query: 'cache-data' });

      for (const field of PRE_EXISTING_ENVELOPE_FIELDS) {
        expect(Object.keys(result)).toContain(field);
      }
    });

    it('should retain every pre-existing envelope field on a zero-result search', async () => {
      Models.DocIndex.queryIndex.mockResolvedValue({
        results: [], totalResults: 0, query: 'nothing', suggestions: ['Try fewer keywords']
      });

      const result = await Documentation.search({ query: 'nothing' });

      for (const field of PRE_EXISTING_ENVELOPE_FIELDS) {
        expect(Object.keys(result)).toContain(field);
      }
    });

    it('should never rename a pre-existing envelope field (exact value passthrough)', async () => {
      const results = [makeFullyPopulatedResult()];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: 1, query: 'cache-data', suggestions: ['a suggestion']
      });

      const result = await Documentation.search({ query: 'cache-data' });

      // Exact-value assertions on every pre-existing field name: a rename would surface as
      // `undefined` here even though a same-shaped renamed field exists elsewhere.
      expect(result.results).toBe(results);
      expect(result.totalResults).toBe(1);
      expect(result.query).toBe('cache-data');
      expect(result.suggestions).toEqual(['a suggestion']);
      expect(result.errors).toBeUndefined(); // pre-existing field, always present but unset
      expect(result.partialData).toBe(false);
    });

    it('should add availableFilters only additively, never displacing a pre-existing field', async () => {
      const results = [makeFullyPopulatedResult()];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: 1, query: 'cache-data', suggestions: []
      });

      const result = await Documentation.search({ query: 'cache-data' });

      for (const field of NEW_ADDITIVE_ENVELOPE_FIELDS) {
        expect(Object.keys(result)).toContain(field);
      }
      // The additive field is layered on top of the full pre-existing set, not swapped in
      // place of any of them.
      const allExpectedFields = [...PRE_EXISTING_ENVELOPE_FIELDS, ...NEW_ADDITIVE_ENVELOPE_FIELDS];
      expect(Object.keys(result).sort()).toEqual(allExpectedFields.sort());
    });
  });

  describe('per-result field inventory (Req 10.1, 10.2, 10.3)', () => {
    it('should retain every pre-existing result field with its original name and value', async () => {
      const fullResult = makeFullyPopulatedResult();
      Models.DocIndex.queryIndex.mockResolvedValue({
        results: [fullResult], totalResults: 1, query: 'cache-data', suggestions: []
      });

      const { results } = await Documentation.search({ query: 'cache-data' });

      expect(results).toHaveLength(1);
      for (const field of PRE_EXISTING_RESULT_FIELDS) {
        expect(results[0]).toHaveProperty(field, fullResult[field]);
      }
    });

    it('should keep the now-populated fields (githubUrl/repositoryType/namespace) as additive values, not replacements', async () => {
      // Requirement 10.3: below-tier/disabled behaves as today except these three fields are
      // now populated instead of null. Confirm they sit alongside the untouched fields.
      const fullResult = makeFullyPopulatedResult();
      Models.DocIndex.queryIndex.mockResolvedValue({
        results: [fullResult], totalResults: 1, query: 'cache-data', suggestions: []
      });

      const { results } = await Documentation.search({ query: 'cache-data' });

      expect(results[0].githubUrl).toBe(fullResult.githubUrl);
      expect(results[0].repositoryType).toBe(fullResult.repositoryType);
      expect(results[0].namespace).toBe(fullResult.namespace);
      // Untouched pre-existing fields are unaffected by the population of the three above.
      expect(results[0].title).toBe(fullResult.title);
      expect(results[0].relevanceScore).toBe(fullResult.relevanceScore);
    });
  });

  describe('field-set snapshot (regression guard)', () => {
    it('should match the locked-in envelope and result key sets', async () => {
      const results = [makeFullyPopulatedResult()];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: 1, query: 'cache-data', suggestions: []
      });

      const result = await Documentation.search({ query: 'cache-data' });

      // Snapshotting the sorted key lists (rather than the values, which include
      // non-deterministic-looking but stable fixture data) means the snapshot fails the
      // instant a field is added, removed, or renamed, independent of any value churn.
      expect({
        envelopeKeys: Object.keys(result).sort(),
        resultKeys: Object.keys(result.results[0]).sort()
      }).toMatchSnapshot();
    });
  });
});
