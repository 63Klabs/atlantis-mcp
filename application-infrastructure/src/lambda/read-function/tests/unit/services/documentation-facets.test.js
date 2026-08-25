/**
 * Unit tests for the search_documentation `availableFilters` facets and the large-result
 * `suggestions` nudge in the Documentation service (spec 0-0-6, task 3.2).
 *
 * All AWS I/O is mocked: `@63klabs/cache-data` (CacheableDataAccess/DebugAndLog/ApiRequest),
 * `Config`, and `Models.DocIndex` are jest mocks, and `CacheableDataAccess.getData` is wired
 * to invoke the cache-miss fetch function directly so the assembled envelope is observable.
 *
 * Coverage:
 * - facet counts per distinct `type`/`subType` value, ordered by count then value
 * - facets omit empty/absent type/subType values and the block is absent when there is
 *   nothing to report (additive/optional field)
 * - the "narrow by type/subType" suggestion appears only at/above the threshold and never
 *   replaces suggestions produced by the retrieval path
 * - no pre-existing envelope field is removed or renamed
 *
 * Requirements: 8.1, 8.4, 8.5
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

/** Threshold at which the service appends the narrowing nudge (services/documentation.js). */
const NARROW_SUGGESTION_THRESHOLD = 25;

/**
 * Build a result object in `queryIndex` shape with only the fields these tests care about.
 *
 * @param {string} type - Result `type` value.
 * @param {string} subType - Result `subType` value.
 * @param {number} [index=0] - Used to make titles/paths unique.
 * @returns {Object} Search result object.
 */
const makeResult = (type, subType, index = 0) => ({
  title: `Result ${index}`,
  excerpt: 'excerpt',
  filePath: `docs/file-${index}.md`,
  githubUrl: null,
  type,
  subType,
  relevanceScore: 100 - index,
  repository: null,
  repositoryType: null,
  namespace: null
});

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

describe('Documentation service availableFilters and suggestions nudge', () => {

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

  describe('availableFilters facet counts (Req 8.1)', () => {
    it('should count each distinct type and subType value in the matched set', async () => {
      const results = [
        makeResult('documentation', 'guide', 0),
        makeResult('documentation', 'guide', 1),
        makeResult('documentation', 'parameter', 2),
        makeResult('code-example', 'function', 3)
      ];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: results.length, query: 'lambda', suggestions: []
      });

      const result = await Documentation.search({ query: 'lambda' });

      expect(result.availableFilters).toEqual({
        type: [
          { value: 'documentation', count: 3 },
          { value: 'code-example', count: 1 }
        ],
        subType: [
          { value: 'guide', count: 2 },
          { value: 'function', count: 1 },
          { value: 'parameter', count: 1 }
        ]
      });
    });

    it('should order facet values by count descending then value ascending', async () => {
      const results = [
        makeResult('code-example', 'function', 0),
        makeResult('template-pattern', 'parameter', 1),
        makeResult('documentation', 'guide', 2),
        makeResult('documentation', 'guide', 3)
      ];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: results.length, query: 'q', suggestions: []
      });

      const result = await Documentation.search({ query: 'q' });

      // documentation (2) first; the two single-count values tie and sort alphabetically.
      expect(result.availableFilters.type.map(f => f.value)).toEqual([
        'documentation', 'code-example', 'template-pattern'
      ]);
      expect(result.availableFilters.type.map(f => f.count)).toEqual([2, 1, 1]);
    });

    it('should ignore empty or absent type/subType values', async () => {
      const results = [
        makeResult('documentation', 'guide', 0),
        // Partially indexed entries: queryIndex emits '' when the attribute is absent.
        { title: 'No type', excerpt: 'e', filePath: 'p', type: '', subType: '' },
        { title: 'Undefined', excerpt: 'e', filePath: 'p' }
      ];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: results.length, query: 'q', suggestions: []
      });

      const result = await Documentation.search({ query: 'q' });

      expect(result.availableFilters).toEqual({
        type: [{ value: 'documentation', count: 1 }],
        subType: [{ value: 'guide', count: 1 }]
      });
    });

    it('should omit a facet field that has no values while keeping the other', async () => {
      const results = [
        { title: 'Typed only', excerpt: 'e', filePath: 'p', type: 'documentation', subType: '' }
      ];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: 1, query: 'q', suggestions: []
      });

      const result = await Documentation.search({ query: 'q' });

      expect(result.availableFilters).toEqual({ type: [{ value: 'documentation', count: 1 }] });
      expect(result.availableFilters.subType).toBeUndefined();
    });
  });

  describe('availableFilters is additive and optional (Req 8.5)', () => {
    it('should omit availableFilters entirely for a zero-result search', async () => {
      Models.DocIndex.queryIndex.mockResolvedValue({
        results: [], totalResults: 0, query: 'nothing', suggestions: ['Try fewer keywords']
      });

      const result = await Documentation.search({ query: 'nothing' });

      expect(result.availableFilters).toBeUndefined();
      // The zero-result envelope is otherwise unchanged.
      expect(result.results).toEqual([]);
      expect(result.totalResults).toBe(0);
      expect(result.suggestions).toEqual(['Try fewer keywords']);
    });

    it('should not remove or rename any pre-existing envelope field', async () => {
      const results = [makeResult('documentation', 'guide', 0)];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: 1, query: 'q', suggestions: []
      });

      const result = await Documentation.search({ query: 'q' });

      expect(Object.keys(result)).toEqual(
        expect.arrayContaining(['results', 'totalResults', 'query', 'suggestions', 'errors', 'partialData'])
      );
      expect(result.results).toEqual(results);
      expect(result.query).toBe('q');
      expect(result.partialData).toBe(false);
      expect(result.errors).toBeUndefined();
    });

    it('should survive JSON serialization as an absent (not null) field when empty', async () => {
      Models.DocIndex.queryIndex.mockResolvedValue({
        results: [], totalResults: 0, query: 'q', suggestions: []
      });

      const result = await Documentation.search({ query: 'q' });

      expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('availableFilters');
    });
  });

  describe('large-result suggestions nudge (Req 8.4)', () => {
    it('should append a narrow-by-type/subType hint when totalResults reaches the threshold', async () => {
      const results = [makeResult('documentation', 'guide', 0)];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: NARROW_SUGGESTION_THRESHOLD, query: 'aws', suggestions: []
      });

      const result = await Documentation.search({ query: 'aws' });

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toMatch(/narrow/i);
      expect(result.suggestions[0]).toContain('type');
      expect(result.suggestions[0]).toContain('subType');
      expect(result.suggestions[0]).toContain(String(NARROW_SUGGESTION_THRESHOLD));
    });

    it('should not append the hint below the threshold', async () => {
      const results = [makeResult('documentation', 'guide', 0)];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: NARROW_SUGGESTION_THRESHOLD - 1, query: 'aws', suggestions: []
      });

      const result = await Documentation.search({ query: 'aws' });

      expect(result.suggestions).toEqual([]);
    });

    it('should preserve retrieval-path suggestions and append the hint after them', async () => {
      const results = [makeResult('documentation', 'guide', 0)];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results,
        totalResults: 250,
        query: 'aws',
        suggestions: ['Try using fewer or more general keywords']
      });

      const result = await Documentation.search({ query: 'aws' });

      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0]).toBe('Try using fewer or more general keywords');
      expect(result.suggestions[1]).toMatch(/narrow/i);
    });

    it('should keep suggestions an array of strings (type unchanged)', async () => {
      const results = [makeResult('documentation', 'guide', 0)];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: 500, query: 'aws', suggestions: []
      });

      const result = await Documentation.search({ query: 'aws' });

      expect(Array.isArray(result.suggestions)).toBe(true);
      for (const suggestion of result.suggestions) {
        expect(typeof suggestion).toBe('string');
      }
    });
  });
});
