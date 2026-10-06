/**
 * Unit tests for the `indexedRepositories` corpus-manifest degradation ladder in the
 * Documentation service (spec 0-0-7-tool-discovery-enhancement, task 13.1).
 *
 * Coverage:
 * - `indexedRepositories` is present on every response (populated and zero-result) when the
 *   manifest is available, and absent when the manifest source is `'unavailable'` (R8.1, R8.2)
 * - the field is named distinctly from `availableFilters` (R8.4)
 * - the `full` tier shape and fields (R8.3)
 * - degradation to `compact` when `full` exceeds `MCP_CORPUS_MANIFEST_MAX_BYTES` (R8.8)
 * - degradation to `count` when `compact` also exceeds the budget (R8.8)
 * - the manifest never causes `results` to be truncated/reduced (R8.9)
 * - `discovery_manifest_degraded` is logged only when an actual degradation occurs
 * - `manifestTier`/`manifestSource` on the `discovery_search` log event reflect the real
 *   resolved values (R12.1)
 *
 * All AWS I/O is mocked, following the `documentation-facets.test.js` convention:
 * `CacheableDataAccess.getData` invokes the real cache-miss fetch function directly so the
 * assembled envelope (including the post-cache `indexedRepositories` attachment) is observable.
 *
 * Requirements: 8.1, 8.2, 8.4, 8.7, 8.8, 8.9
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
      info: jest.fn(),
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
    queryIndex: jest.fn()
  },
  Corpus: {
    getCorpusManifest: jest.fn(),
    MANIFEST_SOURCE: { INDEXER: 'indexer', DERIVED: 'derived', UNAVAILABLE: 'unavailable' }
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const Documentation = require('../../../services/documentation');

/**
 * Pull every `DISCOVERY_SEARCH ...` / `DISCOVERY_MANIFEST_DEGRADED ...` line emitted via
 * `DebugAndLog.info` out of the mock's call history.
 *
 * @param {string} prefix - Event prefix, e.g. `'DISCOVERY_SEARCH'` or `'DISCOVERY_MANIFEST_DEGRADED'`.
 * @returns {Array<Object>} Parsed JSON payloads for matching log lines.
 */
function logPayloadsFor(prefix) {
  return DebugAndLog.info.mock.calls
    .map(([line]) => line)
    .filter((line) => typeof line === 'string' && line.startsWith(`${prefix} `))
    .map((line) => {
      const withoutPrefix = line.slice(`${prefix} `.length);
      const jsonPortion = withoutPrefix.endsWith(' DISCOVERY_SEARCH_EMPTY')
        ? withoutPrefix.slice(0, -' DISCOVERY_SEARCH_EMPTY'.length)
        : withoutPrefix;
      return JSON.parse(jsonPortion);
    });
}

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

/** A single full-shape corpus manifest repository entry. */
const makeRepo = (overrides = {}) => ({
  name: 'cache-data',
  owner: '63klabs',
  repositoryType: 'package',
  resolution: 'resolved',
  namespace: null,
  sections: 42,
  ref: 'v2.0.0',
  ...overrides
});

describe('Documentation service indexedRepositories corpus manifest (task 13.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Config.settings.mockReturnValue({
      github: { userOrgs: ['63klabs'] },
      docIndexTable: 'test-doc-index-table',
      documentation: {
        ai: { enabled: false, minTier: 'paid', retrievalMode: 'semantic' },
        corpusManifestMaxBytes: 4096
      }
    });
    Config.getConnCacheProfile.mockImplementation(() => createMockConnCacheProfile());
    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn, conn) => fetchFn(conn, {}));
    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [], totalResults: 0, query: 'q', suggestions: []
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('presence and naming (R8.1, R8.2, R8.4)', () => {
    it('attaches indexedRepositories on a populated result set', async () => {
      Models.DocIndex.queryIndex.mockResolvedValue({
        results: [{ title: 'T', type: 'documentation', subType: 'guide' }],
        totalResults: 1,
        query: 'cache-data',
        suggestions: []
      });
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [makeRepo()], source: 'indexer', version: 'v1'
      });

      const result = await Documentation.search({ query: 'cache-data' });

      expect(result.indexedRepositories).toBeDefined();
      expect(result.indexedRepositories.tier).toBe('full');
    });

    it('still attaches indexedRepositories when the query matches nothing', async () => {
      Models.DocIndex.queryIndex.mockResolvedValue({
        results: [], totalResults: 0, query: 'nothing', suggestions: ['Try fewer keywords']
      });
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [makeRepo()], source: 'derived', version: 'v1'
      });

      const result = await Documentation.search({ query: 'nothing' });

      expect(result.indexedRepositories).toBeDefined();
      expect(result.totalResults).toBe(0);
    });

    it('is named distinctly from availableFilters and both can be present together', async () => {
      Models.DocIndex.queryIndex.mockResolvedValue({
        results: [{ title: 'T', type: 'documentation', subType: 'guide' }],
        totalResults: 1,
        query: 'cache-data',
        suggestions: []
      });
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [makeRepo()], source: 'indexer', version: 'v1'
      });

      const result = await Documentation.search({ query: 'cache-data' });

      expect(result.indexedRepositories).toBeDefined();
      expect(result.availableFilters).toBeDefined();
      expect(result.indexedRepositories).not.toEqual(result.availableFilters);
    });

    it('omits indexedRepositories entirely when the manifest source is unavailable', async () => {
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: null, source: 'unavailable', version: null
      });

      const result = await Documentation.search({ query: 'q' });

      expect(result.indexedRepositories).toBeUndefined();
      expect('indexedRepositories' in result).toBe(false);
    });
  });

  describe('full tier shape (R8.3)', () => {
    it('carries name, owner, repositoryType, namespace, sections, and ref per repository', async () => {
      const repo = makeRepo({ name: 'cache-data', owner: '63klabs', repositoryType: 'package', namespace: 'v2', sections: 10, ref: 'main' });
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [repo], source: 'indexer', version: 'v1'
      });

      const result = await Documentation.search({ query: 'q' });

      expect(result.indexedRepositories.tier).toBe('full');
      expect(result.indexedRepositories.repositories).toEqual([
        { name: 'cache-data', owner: '63klabs', repositoryType: 'package', namespace: 'v2', sections: 10, ref: 'main' }
      ]);
    });
  });

  describe('degradation ladder (R8.8)', () => {
    it('degrades to compact when the full tier exceeds MCP_CORPUS_MANIFEST_MAX_BYTES', async () => {
      // >! A tiny budget forces the `full` tier (which carries 6 fields/entry) over budget
      // >! while `compact` (2 fields/entry) still fits for a single small repository.
      Config.settings.mockReturnValue({
        github: { userOrgs: ['63klabs'] },
        docIndexTable: 'test-doc-index-table',
        documentation: {
          ai: { enabled: false, minTier: 'paid', retrievalMode: 'semantic' },
          corpusManifestMaxBytes: 90
        }
      });
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [makeRepo({ name: 'cache-data', owner: '63klabs', ref: 'v2.0.0', sections: 42 })],
        source: 'indexer',
        version: 'v1'
      });

      const result = await Documentation.search({ query: 'q' });

      expect(result.indexedRepositories.tier).toBe('compact');
      expect(result.indexedRepositories.repositories).toEqual([
        { name: 'cache-data', repositoryType: 'package' }
      ]);
    });

    it('degrades to count when even the compact tier exceeds the budget', async () => {
      // >! A budget that fits neither the two-repository `full` nor `compact` block (both
      // >! exceed it) but does fit the fixed-size `count` block, forcing the ladder all the
      // >! way down.
      Config.settings.mockReturnValue({
        github: { userOrgs: ['63klabs'] },
        docIndexTable: 'test-doc-index-table',
        documentation: {
          ai: { enabled: false, minTier: 'paid', retrievalMode: 'semantic' },
          corpusManifestMaxBytes: 60
        }
      });
      const repos = [makeRepo({ name: 'cache-data' }), makeRepo({ name: 'other-repo' })];
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: repos, source: 'indexer', version: 'v1'
      });

      const result = await Documentation.search({ query: 'q' });

      expect(result.indexedRepositories.tier).toBe('count');
      expect(result.indexedRepositories.repositoryCount).toBe(2);
      expect(result.indexedRepositories.omitted).toBe(true);
      expect(result.indexedRepositories.repositories).toBeUndefined();
    });
  });

  describe('never truncates results (R8.9)', () => {
    it('leaves results and totalResults untouched when the manifest is attached', async () => {
      const results = Array.from({ length: 5 }, (_, i) => ({ title: `T${i}`, type: 'documentation', subType: 'guide' }));
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: 5, query: 'q', suggestions: []
      });
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [makeRepo()], source: 'indexer', version: 'v1'
      });

      const result = await Documentation.search({ query: 'q' });

      expect(result.results).toEqual(results);
      expect(result.totalResults).toBe(5);
      expect(result.indexedRepositories).toBeDefined();
    });

    it('leaves results untouched even when the manifest degrades all the way to count', async () => {
      Config.settings.mockReturnValue({
        github: { userOrgs: ['63klabs'] },
        docIndexTable: 'test-doc-index-table',
        documentation: {
          ai: { enabled: false, minTier: 'paid', retrievalMode: 'semantic' },
          corpusManifestMaxBytes: 60
        }
      });
      const results = [{ title: 'T', type: 'documentation', subType: 'guide' }];
      Models.DocIndex.queryIndex.mockResolvedValue({
        results, totalResults: 1, query: 'q', suggestions: []
      });
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [makeRepo(), makeRepo({ name: 'other' })], source: 'indexer', version: 'v1'
      });

      const result = await Documentation.search({ query: 'q' });

      expect(result.results).toEqual(results);
      expect(result.totalResults).toBe(1);
      expect(result.indexedRepositories.tier).toBe('count');
    });
  });

  describe('discovery_manifest_degraded logging', () => {
    it('does NOT log a degradation when the full tier fits within budget', async () => {
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [makeRepo()], source: 'indexer', version: 'v1'
      });

      await Documentation.search({ query: 'q' });

      expect(logPayloadsFor('DISCOVERY_MANIFEST_DEGRADED')).toHaveLength(0);
    });

    it('logs fromTier/toTier/reason when the manifest degrades to compact', async () => {
      Config.settings.mockReturnValue({
        github: { userOrgs: ['63klabs'] },
        docIndexTable: 'test-doc-index-table',
        documentation: {
          ai: { enabled: false, minTier: 'paid', retrievalMode: 'semantic' },
          corpusManifestMaxBytes: 90
        }
      });
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [makeRepo({ name: 'cache-data', owner: '63klabs', ref: 'v2.0.0', sections: 42 })],
        source: 'indexer',
        version: 'v1'
      });

      await Documentation.search({ query: 'q' });

      const degraded = logPayloadsFor('DISCOVERY_MANIFEST_DEGRADED');
      expect(degraded).toHaveLength(1);
      expect(degraded[0].fromTier).toBe('full');
      expect(degraded[0].toTier).toBe('compact');
      expect(typeof degraded[0].reason).toBe('string');
    });
  });

  describe('discovery_search manifestTier/manifestSource fields (R12.1)', () => {
    it('reports the resolved tier and source on the discovery_search log event', async () => {
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: [makeRepo()], source: 'derived', version: 'v1'
      });

      await Documentation.search({ query: 'q' });

      const searchLogs = logPayloadsFor('DISCOVERY_SEARCH');
      expect(searchLogs).toHaveLength(1);
      expect(searchLogs[0].manifestTier).toBe('full');
      expect(searchLogs[0].manifestSource).toBe('derived');
    });

    it('reports a null manifestTier and unavailable source when the manifest cannot be built', async () => {
      Models.Corpus.getCorpusManifest.mockResolvedValue({
        repositories: null, source: 'unavailable', version: null
      });

      await Documentation.search({ query: 'q' });

      const searchLogs = logPayloadsFor('DISCOVERY_SEARCH');
      expect(searchLogs).toHaveLength(1);
      expect(searchLogs[0].manifestTier).toBeNull();
      expect(searchLogs[0].manifestSource).toBe('unavailable');
    });
  });
});
