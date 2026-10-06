/**
 * Unit Tests for Documentation Service Discovery Logging
 *
 * Tests the `discovery_search` structured log event emitted by
 * `services/documentation.js` `search()` (spec 0-0-7-tool-discovery-enhancement, task 4.1).
 *
 * `logDiscoverySearch` itself is a private, unexported helper, so these tests drive it
 * indirectly through `Documentation.search()` and assert on the `DebugAndLog.info` call it
 * makes, following the existing `documentation-service.test.js` mocking convention
 * (`CacheableDataAccess.getData` invokes the real `fetchFunction` so the real keyword path,
 * including the log emission after it, runs).
 *
 * Validates: Requirements 12.1, 12.5
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
      info: jest.fn(),
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
  DocIndex: {
    queryIndex: jest.fn()
  },
  Corpus: {
    getCorpusManifest: jest.fn(),
    MANIFEST_SOURCE: { INDEXER: 'indexer', DERIVED: 'derived', UNAVAILABLE: 'unavailable' }
  }
}));

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const Documentation = require('../../../services/documentation');

/**
 * Pull every `DISCOVERY_SEARCH ...` line emitted via `DebugAndLog.info` out of the mock's
 * call history. Returns the parsed JSON payload plus the raw log line so both the structured
 * fields and the literal `DISCOVERY_SEARCH_EMPTY` substring contract can be asserted.
 *
 * @returns {Array<{line: string, payload: Object}>}
 */
function discoverySearchLogLines() {
  return DebugAndLog.info.mock.calls
    .map(([line]) => line)
    .filter((line) => typeof line === 'string' && line.startsWith('DISCOVERY_SEARCH '))
    .map((line) => {
      // >! The line is `DISCOVERY_SEARCH {json}` optionally followed by ` DISCOVERY_SEARCH_EMPTY`.
      // >! Strip the event prefix and optional empty-token suffix to isolate the JSON payload.
      const withoutPrefix = line.slice('DISCOVERY_SEARCH '.length);
      const jsonPortion = withoutPrefix.endsWith(' DISCOVERY_SEARCH_EMPTY')
        ? withoutPrefix.slice(0, -' DISCOVERY_SEARCH_EMPTY'.length)
        : withoutPrefix;
      return { line, payload: JSON.parse(jsonPortion) };
    });
}

describe('Documentation Service — discovery_search logging', () => {
  const createMockConnCacheProfile = () => ({
    conn: {
      name: 'documentation-index',
      host: [],
      path: '/docs',
      parameters: {},
      cache: []
    },
    cacheProfile: {
      profile: 'doc-index',
      overrideOriginHeaderExpiration: true,
      defaultExpirationInSeconds: 3600,
      expirationIsOnInterval: false,
      headersToRetain: '',
      hostId: 'documentation-index',
      pathId: 'doc-index',
      encrypt: false
    }
  });

  beforeEach(() => {
    CacheableDataAccess.getData.mockClear();
    Config.settings.mockClear();
    Config.getConnCacheProfile.mockClear();
    Models.DocIndex.queryIndex.mockClear();
    Models.Corpus.getCorpusManifest.mockClear();
    DebugAndLog.info.mockClear();

    Config.settings.mockReturnValue({
      github: {
        userOrgs: ['63klabs', 'myorg', 'testorg']
      },
      docIndexTable: 'test-doc-index-table',
      documentation: {
        ai: {
          enabled: false,
          minTier: 'paid',
          retrievalMode: 'semantic'
        },
        corpusManifestMaxBytes: 4096
      }
    });

    // spec 0-0-7-tool-discovery-enhancement, task 13.1: this file is scoped to the
    // `discovery_search` log event itself; the corpus manifest is unavailable by default so
    // `manifestTier`/`manifestSource` resolve to `null`/`'unavailable'` (the real values
    // task 13.1 now populates, replacing the task-4.1-era `null`/`null` placeholders).
    Models.Corpus.getCorpusManifest.mockResolvedValue({
      repositories: null,
      source: 'unavailable',
      version: null
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs tokenCount, filtersApplied, resultCount, strategy, emptyResult, manifestTier, and manifestSource', async () => {
    const mockConnCache = createMockConnCacheProfile();
    Config.getConnCacheProfile.mockReturnValue(mockConnCache);

    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [
        { title: 'Result 1', type: 'documentation', subType: 'guide' },
        { title: 'Result 2', type: 'documentation', subType: 'guide' }
      ],
      totalResults: 2,
      suggestions: []
    });

    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn) => fetchFn(mockConnCache.conn, {}));

    await Documentation.search({ query: 'cache-data rotate key', type: 'documentation' });

    const logLines = discoverySearchLogLines();
    expect(logLines).toHaveLength(1);

    const { payload } = logLines[0];
    expect(payload).toEqual({
      tokenCount: 3,
      filtersApplied: ['type'],
      resultCount: 2,
      strategy: 'keyword',
      emptyResult: false,
      manifestTier: null,
      manifestSource: 'unavailable'
    });

    // >! Field-type assertions per task 4.3
    expect(typeof payload.tokenCount).toBe('number');
    expect(Array.isArray(payload.filtersApplied)).toBe(true);
    expect(typeof payload.resultCount).toBe('number');
    expect(typeof payload.strategy).toBe('string');
    expect(typeof payload.emptyResult).toBe('boolean');
  });

  it('appends the DISCOVERY_SEARCH_EMPTY token when the result set is empty', async () => {
    const mockConnCache = createMockConnCacheProfile();
    Config.getConnCacheProfile.mockReturnValue(mockConnCache);

    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [],
      totalResults: 0,
      suggestions: ['Did you mean: cache-data?']
    });

    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn) => fetchFn(mockConnCache.conn, {}));

    await Documentation.search({ query: 'totally-unmatched-query' });

    const logLines = discoverySearchLogLines();
    expect(logLines).toHaveLength(1);

    const { line, payload } = logLines[0];
    expect(payload.emptyResult).toBe(true);
    expect(payload.resultCount).toBe(0);
    expect(line).toContain('DISCOVERY_SEARCH_EMPTY');
  });

  it('does NOT append the DISCOVERY_SEARCH_EMPTY token when the result set is non-empty', async () => {
    const mockConnCache = createMockConnCacheProfile();
    Config.getConnCacheProfile.mockReturnValue(mockConnCache);

    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [{ title: 'Result 1', type: 'documentation' }],
      totalResults: 1,
      suggestions: []
    });

    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn) => fetchFn(mockConnCache.conn, {}));

    await Documentation.search({ query: 'cache-data' });

    const logLines = discoverySearchLogLines();
    expect(logLines).toHaveLength(1);
    expect(logLines[0].line).not.toContain('DISCOVERY_SEARCH_EMPTY');
    expect(logLines[0].payload.emptyResult).toBe(false);
  });

  it('never logs the query text itself, only a numeric tokenCount (Requirement 12.5)', async () => {
    const mockConnCache = createMockConnCacheProfile();
    Config.getConnCacheProfile.mockReturnValue(mockConnCache);

    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [],
      totalResults: 0,
      suggestions: []
    });

    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn) => fetchFn(mockConnCache.conn, {}));

    const secretQuery = 'super-secret-sentinel-query-string-xyz';
    await Documentation.search({ query: secretQuery });

    const logLines = discoverySearchLogLines();
    expect(logLines).toHaveLength(1);

    // >! The raw query text must never appear in the logged line, nor anywhere else logged
    // >! via DebugAndLog.info during this call — only the token COUNT is reported.
    expect(logLines[0].line).not.toContain(secretQuery);
    expect(typeof logLines[0].payload.tokenCount).toBe('number');
    expect(logLines[0].payload).not.toHaveProperty('query');

    for (const [line] of DebugAndLog.info.mock.calls) {
      if (typeof line === 'string') {
        expect(line).not.toContain(secretQuery);
      }
    }
  });

  it('never logs caller identity/tier alongside the discovery_search event, even when authInfo carries an identity (Requirement 12.5)', async () => {
    const mockConnCache = createMockConnCacheProfile();
    Config.getConnCacheProfile.mockReturnValue(mockConnCache);

    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [{ title: 'Result 1', type: 'documentation' }],
      totalResults: 1,
      suggestions: []
    });

    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn) => fetchFn(mockConnCache.conn, {}));

    const authInfo = {
      tier: 'paid',
      isAuthenticated: true,
      identity: 'user-12345',
      sub: 'cognito-sub-abc',
      email: 'someone@example.com',
      apiKey: 'secret-api-key-value'
    };

    await Documentation.search({ query: 'cache-data', authInfo });

    const logLines = discoverySearchLogLines();
    expect(logLines).toHaveLength(1);

    const { line, payload } = logLines[0];
    // >! Only the known, non-identifying field set is present.
    expect(Object.keys(payload).sort()).toEqual(
      ['emptyResult', 'filtersApplied', 'manifestSource', 'manifestTier', 'resultCount', 'strategy', 'tokenCount'].sort()
    );

    for (const identityValue of [authInfo.identity, authInfo.sub, authInfo.email, authInfo.apiKey]) {
      expect(line).not.toContain(identityValue);
    }
  });

  it('reports filtersApplied for each supplied filter (type, subType, ghusers)', async () => {
    const mockConnCache = createMockConnCacheProfile();
    Config.getConnCacheProfile.mockReturnValue(mockConnCache);

    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [],
      totalResults: 0,
      suggestions: []
    });

    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn) => fetchFn(mockConnCache.conn, {}));

    await Documentation.search({
      query: 'cache-data',
      type: 'documentation',
      subType: 'guide',
      ghusers: ['63klabs']
    });

    const logLines = discoverySearchLogLines();
    expect(logLines).toHaveLength(1);
    expect(logLines[0].payload.filtersApplied.sort()).toEqual(['ghusers', 'subType', 'type']);
  });

  // spec 0-0-7-tool-discovery-enhancement, task 12.1 (Requirement 5.1)
  it('reports filtersApplied for repository, repositoryType, and namespace', async () => {
    const mockConnCache = createMockConnCacheProfile();
    Config.getConnCacheProfile.mockReturnValue(mockConnCache);

    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [],
      totalResults: 0,
      suggestions: []
    });

    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn) => fetchFn(mockConnCache.conn, {}));

    await Documentation.search({
      query: 'cache-data',
      repository: 'cache-data',
      repositoryType: 'package',
      namespace: 'v2'
    });

    const logLines = discoverySearchLogLines();
    expect(logLines).toHaveLength(1);
    expect(logLines[0].payload.filtersApplied.sort()).toEqual(['namespace', 'repository', 'repositoryType']);
  });
});
