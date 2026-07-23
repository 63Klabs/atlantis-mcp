/**
 * Unit tests for the AI retrieval-strategy wiring in the Documentation service (task 8.4).
 *
 * These exercise the REAL doc-ai-common `retrieval-strategy` module (loaded from the local
 * layer via DOC_AI_LAYER_PATH) wired to MOCKED leaf providers (EmbeddingProvider,
 * createVectorStore, AssistProvider) so no AWS SDK is touched. Models.DocIndex and
 * @63klabs/cache-data are mocked. The service's own `buildResults` runs for real so the
 * score -> relevanceScore mapping and envelope parity are covered.
 *
 * Coverage:
 * - disabled -> keyword only (no embed/vector calls), envelope identical
 * - enabled + below minTier -> keyword (no embed/vector calls)
 * - enabled + eligible tier + semantic -> semantic (embed + vector query, score mapping)
 * - enabled + semantic-assisted -> assisted re-rank selected
 * - semantic failure -> keyword fallback, still a valid envelope
 * - cache-key discriminator (docAiMode) differs by enabled/mode/store/tier
 */

const path = require('path');

// >! Point the service's loadLayerModule at the local layer nodejs/ dir so the REAL
// >! retrieval-strategy module is used. The leaf providers are mocked below (by the same
// >! resolved path), so no Bedrock or vector-store SDK is ever loaded.
process.env.DOC_AI_LAYER_PATH = path.resolve(__dirname, '../../../../layers/doc-ai-common/nodejs');

// Shared mock fns so the memoized provider/store instances delegate to per-test behavior.
const mockEmbed = jest.fn();
const mockVectorQuery = jest.fn();
const mockRerank = jest.fn();

// Mock the leaf layer providers (avoid Bedrock / vector SDKs); keep retrieval-strategy real.
jest.mock('../../../../layers/doc-ai-common/nodejs/embedding-provider', () => ({
  EmbeddingProvider: class {
    constructor(config = {}) {
      this.model = config.model;
      this.dimensions = config.dimensions;
    }
    embed(text) { return mockEmbed(text); }
  }
}));

jest.mock('../../../../layers/doc-ai-common/nodejs/vector-store', () => ({
  createVectorStore: (config) => ({
    config,
    query: (embedding, options) => mockVectorQuery(embedding, options)
  })
}));

jest.mock('../../../../layers/doc-ai-common/nodejs/assist-provider', () => ({
  AssistProvider: class {
    constructor(config = {}) { this.config = config; }
    rerank(params) { return mockRerank(params); }
  }
}));

// Mock cache-data (CacheableDataAccess, DebugAndLog, ApiRequest).
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
      success: jest.fn(({ body }) => ({ getBody: (parse) => (parse ? body : JSON.stringify(body)), statusCode: 200 }))
    }
  }
}));

// Mock Config and Models.
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
 * Build a full settings object with a documentation.ai block, overridable per test.
 *
 * @param {Object} [aiOverrides] - Overrides merged into documentation.ai.
 * @returns {Object} Settings object.
 */
function makeSettings(aiOverrides = {}) {
  return {
    github: { userOrgs: ['63klabs'] },
    docIndexTable: 'test-doc-index-table',
    documentation: {
      ai: {
        enabled: false,
        minTier: 'paid',
        retrievalMode: 'semantic',
        vectorStore: 'dynamodb',
        embedding: { model: 'amazon.titan-embed-text-v2:0', dimensions: 4, maxInputTokens: 8000 },
        assist: { model: 'amazon.nova-micro-v1:0', maxCandidates: 25 },
        topK: 10,
        candidateMultiplier: 3,
        s3Vectors: { bucket: '', index: '' },
        ...aiOverrides
      }
    }
  };
}

/**
 * Fresh connection + cache profile per call so each search gets its own conn.parameters.
 *
 * @returns {{conn: Object, cacheProfile: Object}} Mock connection and cache profile.
 */
function createMockConnCacheProfile() {
  return {
    conn: { name: 'documentation-index', host: [], path: '/docs', parameters: {}, cache: [] },
    cacheProfile: { profile: 'doc-index', hostId: 'documentation-index', pathId: 'doc-index' }
  };
}

describe('Documentation Service — AI retrieval-strategy wiring (task 8.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Rebuild memoized components per test so config changes (store/mode) are picked up.
    Documentation.TestHarness.resetDocAiComponents();

    Config.settings.mockReturnValue(makeSettings());
    Config.getConnCacheProfile.mockImplementation(() => createMockConnCacheProfile());

    // Default: getData invokes the cache-miss fetch function with the connection.
    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn, conn) => fetchFn(conn, {}));
  });

  it('disabled: uses keyword search only (no embed/vector calls) and returns the keyword envelope', async () => {
    Config.settings.mockReturnValue(makeSettings({ enabled: false }));
    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [{ title: 'Kw', excerpt: 'kw', filePath: 'p', type: 'documentation', subType: 'guide', relevanceScore: 5 }],
      totalResults: 1,
      query: 'cache-data',
      suggestions: []
    });

    const result = await Documentation.search({ query: 'cache-data', authInfo: { tier: 'private' } });

    expect(Models.DocIndex.queryIndex).toHaveBeenCalledWith({
      query: 'cache-data', type: undefined, subType: undefined, limit: 10
    });
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockVectorQuery).not.toHaveBeenCalled();
    expect(Models.DocIndex.getActiveVersion).not.toHaveBeenCalled();
    expect(result).toEqual({
      results: [{ title: 'Kw', excerpt: 'kw', filePath: 'p', type: 'documentation', subType: 'guide', relevanceScore: 5 }],
      totalResults: 1,
      query: 'cache-data',
      suggestions: [],
      errors: undefined,
      partialData: false
    });
  });

  it('enabled but caller below minTier: uses keyword (no embed/vector calls)', async () => {
    Config.settings.mockReturnValue(makeSettings({ enabled: true, minTier: 'paid', retrievalMode: 'semantic' }));
    Models.DocIndex.getActiveVersion.mockResolvedValue('v3');
    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [{ title: 'Kw' }], totalResults: 1, query: 'q', suggestions: []
    });

    const result = await Documentation.search({ query: 'q', authInfo: { tier: 'registered' } });

    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockVectorQuery).not.toHaveBeenCalled();
    expect(Models.DocIndex.queryIndex).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([{ title: 'Kw' }]);
    expect(result.errors).toBeUndefined();
    expect(result.partialData).toBe(false);
  });

  it('enabled + eligible tier + semantic: uses semantic retrieval and maps hit.score -> relevanceScore', async () => {
    Config.settings.mockReturnValue(makeSettings({ enabled: true, minTier: 'paid', retrievalMode: 'semantic', vectorStore: 'dynamodb' }));
    Models.DocIndex.getActiveVersion.mockResolvedValue('v3');
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
    mockVectorQuery.mockResolvedValue([
      { hash: 'h1', score: 0.91, metadata: { type: 'documentation' } },
      { hash: 'h2', score: 0.82, metadata: { type: 'documentation' } }
    ]);
    Models.DocIndex.getContentMetadataByHashes.mockResolvedValue({
      h1: { title: 'T1', excerpt: 'E1', path: 'repo/one.md', type: 'documentation', subType: 'guide', repository: 'repo', repositoryType: 'documentation' },
      h2: { title: 'T2', excerpt: 'E2', path: 'repo/two.md', type: 'documentation', subType: 'reference', repository: 'repo', repositoryType: 'documentation' }
    });

    const result = await Documentation.search({ query: '  rotate the key  ', type: 'documentation', authInfo: { tier: 'private' } });

    // Semantic path invoked; keyword query not used.
    expect(mockEmbed).toHaveBeenCalledWith('rotate the key');
    expect(mockVectorQuery).toHaveBeenCalledTimes(1);
    const [embeddingArg, queryOpts] = mockVectorQuery.mock.calls[0];
    expect(embeddingArg).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(queryOpts).toEqual({ version: 'v3', filters: { type: 'documentation' }, topK: 10 });
    expect(Models.DocIndex.queryIndex).not.toHaveBeenCalled();

    // buildResults maps hit.score -> relevanceScore, in ranked order, in keyword result shape.
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      title: 'T1', excerpt: 'E1', filePath: 'repo/one.md', githubUrl: null,
      type: 'documentation', subType: 'guide', relevanceScore: 0.91,
      repository: 'repo', repositoryType: 'documentation', namespace: null,
      codeExamples: undefined, context: undefined
    });
    expect(result.results[1].relevanceScore).toBe(0.82);
    expect(result.totalResults).toBe(2);
    expect(result.query).toBe('rotate the key');
    expect(result.errors).toBeUndefined();
    expect(result.partialData).toBe(false);

    // Content metadata fetched for the ranked hit hashes at the active version.
    expect(Models.DocIndex.getContentMetadataByHashes).toHaveBeenCalledWith('test-doc-index-table', 'v3', ['h1', 'h2']);
  });

  it('enabled + semantic-assisted: re-ranks the semantic candidates via the assist provider', async () => {
    Config.settings.mockReturnValue(makeSettings({ enabled: true, minTier: 'paid', retrievalMode: 'semantic-assisted', vectorStore: 's3-vectors' }));
    Models.DocIndex.getActiveVersion.mockResolvedValue('v3');
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
    mockVectorQuery.mockResolvedValue([
      { hash: 'h1', score: 0.91, metadata: {} },
      { hash: 'h2', score: 0.82, metadata: {} },
      { hash: 'h3', score: 0.70, metadata: {} }
    ]);
    Models.DocIndex.getContentMetadataByHashes.mockResolvedValue({
      h1: { title: 'One', excerpt: 'first', path: 'repo/one.md', type: 'documentation' },
      h2: { title: 'Two', excerpt: 'second', path: 'repo/two.md', type: 'documentation' },
      h3: { title: 'Three', excerpt: 'third', path: 'repo/three.md', type: 'documentation' }
    });
    // Assist promotes candidate index 2 (h3) to the top.
    mockRerank.mockResolvedValue({ order: [2, 0, 1], usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 } });

    const result = await Documentation.search({ query: 'rotate key', type: 'documentation', authInfo: { tier: 'paid' } });

    expect(mockRerank).toHaveBeenCalledTimes(1);
    // Candidate fetch uses topK * candidateMultiplier (10*3=30) capped by maxCandidates (25).
    expect(mockVectorQuery.mock.calls[0][1]).toEqual({ version: 'v3', filters: { type: 'documentation' }, topK: 25 });
    // Re-ranked order h3, h1, h2 from assist order [2, 0, 1].
    expect(result.results.map((r) => r.filePath)).toEqual(['repo/three.md', 'repo/one.md', 'repo/two.md']);
    // relevanceScore is preserved from the original semantic hits (no synthesized content).
    expect(result.results[0].relevanceScore).toBe(0.70);
    expect(result.totalResults).toBe(3);
    expect(result.errors).toBeUndefined();
    expect(result.partialData).toBe(false);
  });

  it('semantic failure: falls back to keyword and still returns a valid envelope', async () => {
    Config.settings.mockReturnValue(makeSettings({ enabled: true, minTier: 'paid', retrievalMode: 'semantic', vectorStore: 'dynamodb' }));
    Models.DocIndex.getActiveVersion.mockResolvedValue('v3');
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
    mockVectorQuery.mockRejectedValue(new Error('vector store unavailable'));
    Models.DocIndex.queryIndex.mockResolvedValue({
      results: [{ title: 'Fallback' }], totalResults: 1, query: 'q', suggestions: ['kw']
    });

    const result = await Documentation.search({ query: 'q', authInfo: { tier: 'private' } });

    // Semantic attempted (embed + vector query) then fell back to keyword.
    expect(mockVectorQuery).toHaveBeenCalledTimes(1);
    expect(Models.DocIndex.queryIndex).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      results: [{ title: 'Fallback' }],
      totalResults: 1,
      query: 'q',
      suggestions: ['kw'],
      errors: undefined,
      partialData: false
    });
  });

  it('cache-key discriminator (docAiMode) differs by enabled/mode/store/tier', async () => {
    // Bypass the fetch function; we only inspect conn.parameters passed to getData.
    CacheableDataAccess.getData.mockImplementation(async () => ({
      getBody: () => ({ results: [], totalResults: 0, query: '', suggestions: [] })
    }));

    const lastMode = () => {
      const calls = CacheableDataAccess.getData.mock.calls;
      return calls[calls.length - 1][2].parameters.docAiMode;
    };

    Config.settings.mockReturnValue(makeSettings({ enabled: false }));
    await Documentation.search({ query: 'q', authInfo: { tier: 'private' } });
    const disabled = lastMode();

    Config.settings.mockReturnValue(makeSettings({ enabled: true, retrievalMode: 'semantic', vectorStore: 'dynamodb' }));
    await Documentation.search({ query: 'q', authInfo: { tier: 'private' } });
    const semanticPrivate = lastMode();

    await Documentation.search({ query: 'q', authInfo: { tier: 'paid' } });
    const semanticPaid = lastMode();

    Config.settings.mockReturnValue(makeSettings({ enabled: true, retrievalMode: 'semantic-assisted', vectorStore: 's3-vectors' }));
    await Documentation.search({ query: 'q', authInfo: { tier: 'private' } });
    const assistedPrivate = lastMode();

    expect(disabled).toBe('keyword');
    expect(semanticPrivate).toBe('semantic|dynamodb|private');
    expect(semanticPaid).toBe('semantic|dynamodb|paid');
    expect(assistedPrivate).toBe('semantic-assisted|s3-vectors|private');

    // All discriminators are distinct, so these result sets never collide in the cache.
    const all = [disabled, semanticPrivate, semanticPaid, assistedPrivate];
    expect(new Set(all).size).toBe(all.length);
  });
});
