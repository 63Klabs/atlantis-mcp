'use strict';

/**
 * Unit tests for the doc-indexer index-time embedding phase (spec 0-0-6, tasks 5.1/5.2),
 * exercising the functions exported from lib/index-builder.js:
 *   - runEmbeddingPhase: incremental reuse, embed-on-change, skip-empty, per-entry
 *     failure tolerance, single batched upsert, and the `upserted` gate.
 *   - loadPriorEmbeddings: hash-keyed prior map from the vector store (empty on any gap).
 *   - build(): the version-metadata gate (records embedding model/dims only when the
 *     feature is enabled AND vectors were actually upserted) and the disabled no-op.
 *
 * The runEmbeddingPhase / loadPriorEmbeddings tests inject their own EmbeddingProvider,
 * VectorStore, and prior map, so the doc-ai-common layer is never required.
 *
 * The build() tests mock the heavy collaborators (DynamoDB writer, GitHub client, archive
 * processor, markdown extractor, file filter) so the orchestration can be driven with zero
 * or one synthetic entry without touching AWS or the network. These module mocks are
 * hoisted file-wide but are unused by the runEmbeddingPhase / loadPriorEmbeddings tests.
 *
 * Requirements: 6.1 (embed new/changed), 6.2 (reuse unchanged), 6.3 (disabled no-op),
 * 6.4 (record embedding model/dimensions in version metadata; single batched write).
 */

// --- Module mocks for the build() orchestration (hoisted above requires) ------------

jest.mock('../../lib/dynamo-writer', () => {
  // A stable send() so build() can read the version:pointer/active item.
  const send = jest.fn().mockResolvedValue({});
  return {
    writeContentEntries: jest.fn().mockResolvedValue(undefined),
    writeDocumentEntries: jest.fn().mockResolvedValue(undefined),
    writeSearchKeywords: jest.fn().mockResolvedValue(undefined),
    writeMainIndex: jest.fn().mockResolvedValue(undefined),
    updateVersionPointer: jest.fn().mockResolvedValue(undefined),
    setTtlOnPreviousVersion: jest.fn().mockResolvedValue(undefined),
    getDocClient: jest.fn(() => ({ send })),
    // Numeric helpers build() imports at load time.
    computeTtl: jest.fn(() => 1000000),
    SEVEN_DAYS_SECONDS: 604800
  };
});

jest.mock('../../lib/github-client', () => ({
  // Default: no repositories -> zero entries. Overridden per-test where a repo is needed.
  listRepositories: jest.fn().mockResolvedValue([]),
  getLatestRelease: jest.fn().mockResolvedValue(null),
  downloadArchive: jest.fn().mockResolvedValue(Buffer.from('zip')),
  // Repository classification is best-effort; default to null so build() proceeds.
  getRepositoryProperties: jest.fn().mockResolvedValue({ repositoryType: null, namespace: null }),
  buildGithubUrl: jest.fn(() => null)
}));

jest.mock('../../lib/archive-processor', () => ({
  extractArchive: jest.fn(() => [])
}));

jest.mock('../../lib/file-filter', () => ({
  // Treat every file as indexable so the extractor mock decides what is produced.
  isIndexable: jest.fn(() => true)
}));

jest.mock('../../lib/extractors/markdown', () => ({
  extract: jest.fn(() => [])
}));

const {
  runEmbeddingPhase,
  loadPriorEmbeddings,
  build
} = require('../../lib/index-builder');
const { buildEmbeddingInput, computeEmbeddingInputHash } = require('../../lib/embedding-input');

// Handles to the mocked modules for assertions and per-test overrides.
const dynamoWriter = require('../../lib/dynamo-writer');
const githubClient = require('../../lib/github-client');
const archiveProcessor = require('../../lib/archive-processor');
const markdownExtractor = require('../../lib/extractors/markdown');

/**
 * A representative `documentation.ai` settings block (enabled) for runEmbeddingPhase.
 */
const DOC_AI = {
  enabled: true,
  embedding: { model: 'amazon.titan-embed-text-v2:0', dimensions: 1024, maxInputTokens: 8000 },
  s3Vectors: { bucket: 'b', index: 'i' }
};

/**
 * Build a deduplicated content entry with the fields the embedding phase reads.
 *
 * @param {Object} [overrides] - Field overrides (hash, title, excerpt, content, ...).
 * @returns {Object} A content entry.
 */
function makeEntry(overrides = {}) {
  return {
    hash: 'hash-x',
    title: 'Title',
    excerpt: 'Excerpt',
    content: 'Content',
    type: 'documentation',
    subType: 'guide',
    repository: 'cache-data',
    owner: '63klabs',
    ...overrides
  };
}

afterEach(() => {
  // Reset call history between tests (mock implementations from the factories are kept).
  jest.clearAllMocks();
});

// ------------------------------------------------------------------------------------
// runEmbeddingPhase
// ------------------------------------------------------------------------------------

describe('runEmbeddingPhase', () => {
  test('reuses an unchanged prior embedding without calling the provider (Req 6.2)', async () => {
    const entry = makeEntry({ hash: 'reuse-1' });
    const priorVector = [0.9, 0.8, 0.7];
    // Seed the prior map with a record whose hash/model/dims match this entry.
    const expectedHash = computeEmbeddingInputHash(buildEmbeddingInput(entry));
    const priorEmbeddings = new Map([[
      entry.hash,
      {
        embeddingInputHash: expectedHash,
        model: DOC_AI.embedding.model,
        dims: DOC_AI.embedding.dimensions,
        vector: priorVector
      }
    ]]);

    const embed = jest.fn();
    const upsertVectors = jest.fn().mockResolvedValue(undefined);

    const summary = await runEmbeddingPhase({
      tableName: 't', version: 'v2', previousVersion: 'v1', entries: [entry], docAi: DOC_AI,
      embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings
    });

    expect(embed).not.toHaveBeenCalled();
    expect(summary.reused).toBe(1);
    expect(summary.embedded).toBe(0);
    expect(summary.upserted).toBe(true);

    expect(upsertVectors).toHaveBeenCalledTimes(1);
    const [version, records] = upsertVectors.mock.calls[0];
    expect(version).toBe('v2');
    expect(records).toHaveLength(1);
    // The reused vector (not a fresh embedding) is what gets written.
    expect(records[0].vector).toBe(priorVector);
    expect(records[0].hash).toBe(entry.hash);
    expect(records[0].metadata).toEqual({
      type: 'documentation', subType: 'guide', repository: 'cache-data', owner: '63klabs',
      embeddingInputHash: expectedHash, model: DOC_AI.embedding.model, dims: DOC_AI.embedding.dimensions
    });
  });

  test('embeds a new entry (no prior) via the provider (Req 6.1)', async () => {
    const entry = makeEntry({ hash: 'new-1' });
    const input = buildEmbeddingInput(entry);
    const vector = [0.1, 0.2, 0.3];
    const embed = jest.fn().mockResolvedValue(vector);
    const upsertVectors = jest.fn().mockResolvedValue(undefined);

    const summary = await runEmbeddingPhase({
      tableName: 't', version: 'v2', previousVersion: null, entries: [entry], docAi: DOC_AI,
      embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
    });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(input);
    expect(summary.embedded).toBe(1);
    expect(summary.reused).toBe(0);

    const [, records] = upsertVectors.mock.calls[0];
    expect(records[0].vector).toBe(vector);
  });

  test('re-embeds when a prior exists but its hash does not match (Req 6.1)', async () => {
    const entry = makeEntry({ hash: 'changed-1' });
    const embed = jest.fn().mockResolvedValue([0.4, 0.5]);
    const upsertVectors = jest.fn().mockResolvedValue(undefined);
    // Prior exists for this hash but with a stale embeddingInputHash -> must re-embed.
    const priorEmbeddings = new Map([[
      entry.hash,
      { embeddingInputHash: 'stale-hash', model: DOC_AI.embedding.model, dims: DOC_AI.embedding.dimensions, vector: [9, 9] }
    ]]);

    const summary = await runEmbeddingPhase({
      tableName: 't', version: 'v2', previousVersion: 'v1', entries: [entry], docAi: DOC_AI,
      embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings
    });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(summary.embedded).toBe(1);
    expect(summary.reused).toBe(0);
  });

  test('skips an entry with no embeddable text and never calls the provider', async () => {
    const emptyEntry = makeEntry({ hash: 'empty-1', title: '', excerpt: '', content: '' });
    const embed = jest.fn().mockResolvedValue([1]);
    const upsertVectors = jest.fn().mockResolvedValue(undefined);

    const summary = await runEmbeddingPhase({
      tableName: 't', version: 'v2', previousVersion: null, entries: [emptyEntry], docAi: DOC_AI,
      embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
    });

    expect(embed).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(summary.total).toBe(1);
    // No records produced -> the single upsert is called with an empty array, not upserted.
    expect(upsertVectors).toHaveBeenCalledTimes(1);
    expect(upsertVectors.mock.calls[0][1]).toEqual([]);
    expect(summary.upserted).toBe(false);
  });

  test('per-entry embedding failure is skipped; other entries still embed and upsert (no throw)', async () => {
    const badEntry = makeEntry({ hash: 'bad-1', title: 'Bad' });
    const goodEntry = makeEntry({ hash: 'ok-1', title: 'Good' });
    const goodVector = [0.5, 0.6];
    const failure = new Error('bedrock invocation failed');
    failure.code = 'INVOCATION_FAILED';

    const embed = jest.fn().mockImplementation(async (text) => {
      if (text.includes('Bad')) {
        throw failure;
      }
      return goodVector;
    });
    const upsertVectors = jest.fn().mockResolvedValue(undefined);

    let summary;
    await expect((async () => {
      summary = await runEmbeddingPhase({
        tableName: 't', version: 'v2', previousVersion: null, entries: [badEntry, goodEntry], docAi: DOC_AI,
        embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
      });
    })()).resolves.toBeUndefined();

    expect(summary.skipped).toBe(1);
    expect(summary.embedded).toBe(1);
    expect(summary.upserted).toBe(true);

    expect(upsertVectors).toHaveBeenCalledTimes(1);
    const [, records] = upsertVectors.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(records[0].hash).toBe(goodEntry.hash);
  });

  test('writes all produced vectors in a single batched upsert with correct metadata (Req 6.4)', async () => {
    const entries = [
      makeEntry({ hash: 'a', title: 'A' }),
      makeEntry({ hash: 'b', title: 'B' }),
      makeEntry({ hash: 'c', title: 'C' })
    ];
    const embed = jest.fn().mockResolvedValue([0.1, 0.2]);
    const upsertVectors = jest.fn().mockResolvedValue(undefined);

    await runEmbeddingPhase({
      tableName: 't', version: 'v9', previousVersion: null, entries, docAi: DOC_AI,
      embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
    });

    // Single hand-off of the whole array (the store batches internally).
    expect(upsertVectors).toHaveBeenCalledTimes(1);
    const [version, records] = upsertVectors.mock.calls[0];
    expect(version).toBe('v9');
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.metadata).toEqual({
        type: 'documentation', subType: 'guide', repository: 'cache-data', owner: '63klabs',
        embeddingInputHash: expect.any(String),
        model: DOC_AI.embedding.model,
        dims: DOC_AI.embedding.dimensions
      });
    }
  });

  test('upserted is false and no error propagates when the store upsert rejects', async () => {
    const entry = makeEntry({ hash: 'x' });
    const embed = jest.fn().mockResolvedValue([0.1]);
    const upsertVectors = jest.fn().mockRejectedValue(new Error('store unavailable'));

    const summary = await runEmbeddingPhase({
      tableName: 't', version: 'v2', previousVersion: null, entries: [entry], docAi: DOC_AI,
      embeddingProvider: { embed }, vectorStore: { upsertVectors }, priorEmbeddings: new Map()
    });

    expect(summary.embedded).toBe(1);
    expect(summary.upserted).toBe(false);
  });
});

// ------------------------------------------------------------------------------------
// loadPriorEmbeddings
// ------------------------------------------------------------------------------------

describe('loadPriorEmbeddings', () => {
  test('builds a hash-keyed map from the store records', async () => {
    const getVersionVectors = jest.fn().mockResolvedValue([
      { hash: 'h1', vector: [1, 2], metadata: { embeddingInputHash: 'eh1', model: 'm', dims: 4 } },
      { hash: 'h2', vector: [3, 4], metadata: { embeddingInputHash: 'eh2', model: 'm', dims: 4 } }
    ]);

    const map = await loadPriorEmbeddings({ getVersionVectors }, 'v1');

    expect(getVersionVectors).toHaveBeenCalledWith('v1');
    expect(map.size).toBe(2);
    expect(map.get('h1')).toEqual({ embeddingInputHash: 'eh1', model: 'm', dims: 4, vector: [1, 2] });
    expect(map.get('h2')).toEqual({ embeddingInputHash: 'eh2', model: 'm', dims: 4, vector: [3, 4] });
  });

  test('skips records without a hash and tolerates missing metadata', async () => {
    const getVersionVectors = jest.fn().mockResolvedValue([
      { vector: [1] },                                   // no hash -> skipped
      { hash: '', vector: [2] },                         // empty hash -> skipped
      { hash: 'h3', vector: [5, 6] }                     // no metadata -> undefined fields
    ]);

    const map = await loadPriorEmbeddings({ getVersionVectors }, 'v1');

    expect(map.size).toBe(1);
    expect(map.get('h3')).toEqual({
      embeddingInputHash: undefined, model: undefined, dims: undefined, vector: [5, 6]
    });
  });

  test('returns an empty map when previousVersion is falsy (getVersionVectors not called)', async () => {
    const getVersionVectors = jest.fn();
    const map = await loadPriorEmbeddings({ getVersionVectors }, null);
    expect(map.size).toBe(0);
    expect(getVersionVectors).not.toHaveBeenCalled();
  });

  test('returns an empty map when the store lacks getVersionVectors', async () => {
    const map = await loadPriorEmbeddings({}, 'v1');
    expect(map.size).toBe(0);
  });

  test('returns an empty map (no throw) when getVersionVectors rejects', async () => {
    const getVersionVectors = jest.fn().mockRejectedValue(new Error('enumeration failed'));
    const map = await loadPriorEmbeddings({ getVersionVectors }, 'v1');
    expect(map.size).toBe(0);
  });
});

// ------------------------------------------------------------------------------------
// build() — version-metadata gating and disabled no-op
// ------------------------------------------------------------------------------------

describe('build - embedding version-metadata gating', () => {
  test('disabled: skips embedding work and writes the pointer with no embedding metadata (Req 6.3)', async () => {
    const embed = jest.fn();
    const upsertVectors = jest.fn();

    await build({
      orgsEnv: 'org',
      tableName: 't',
      tokenProvider: async () => 'tok',
      docAiSettings: { enabled: false },
      embeddingProvider: { embed },
      vectorStore: { upsertVectors }
    });

    // No embedding work at all when disabled.
    expect(embed).not.toHaveBeenCalled();
    expect(upsertVectors).not.toHaveBeenCalled();

    // Pointer written with exactly 3 args (no 4th embeddingMeta).
    expect(dynamoWriter.updateVersionPointer).toHaveBeenCalledTimes(1);
    expect(dynamoWriter.updateVersionPointer.mock.calls[0]).toHaveLength(3);
    expect(dynamoWriter.updateVersionPointer.mock.calls[0][0]).toBe('t');
  });

  test('enabled but nothing upserted (zero entries): pointer written with no embedding metadata', async () => {
    const embed = jest.fn();
    const upsertVectors = jest.fn().mockResolvedValue(undefined);
    const getVersionVectors = jest.fn().mockResolvedValue([]);

    await build({
      orgsEnv: 'org',
      tableName: 't',
      tokenProvider: async () => 'tok',
      docAiSettings: {
        enabled: true,
        embedding: { model: 'm', dimensions: 4, maxInputTokens: 100 },
        s3Vectors: { bucket: '', index: '' }
      },
      embeddingProvider: { embed },
      vectorStore: { upsertVectors, getVersionVectors }
    });

    // Phase ran (enabled) but there were no entries to embed.
    expect(embed).not.toHaveBeenCalled();
    expect(upsertVectors).toHaveBeenCalledTimes(1);
    expect(upsertVectors.mock.calls[0][1]).toEqual([]);

    // Nothing upserted -> pointer written with 3 args (no embeddingMeta).
    expect(dynamoWriter.updateVersionPointer).toHaveBeenCalledTimes(1);
    expect(dynamoWriter.updateVersionPointer.mock.calls[0]).toHaveLength(3);
  });

  test('enabled + vectors upserted: pointer records embedding model/dimensions (Req 6.4)', async () => {
    // Drive exactly one content entry through the (mocked) repo pipeline.
    githubClient.listRepositories.mockResolvedValueOnce([{ name: 'repo', defaultBranch: 'main', owner: 'org' }]);
    githubClient.getLatestRelease.mockResolvedValueOnce(null);
    githubClient.downloadArchive.mockResolvedValueOnce(Buffer.from('zip'));
    archiveProcessor.extractArchive.mockReturnValueOnce([{ path: 'README.md', content: '# Title' }]);
    markdownExtractor.extract.mockReturnValueOnce([{
      contentPath: 'org/repo/README.md/intro',
      title: 'Title',
      excerpt: 'Excerpt',
      content: 'Content',
      type: 'documentation',
      subType: 'guide',
      keywords: ['intro']
    }]);

    const vector = [0.1, 0.2, 0.3, 0.4];
    const embed = jest.fn().mockResolvedValue(vector);
    const upsertVectors = jest.fn().mockResolvedValue(undefined);

    await build({
      orgsEnv: 'org',
      tableName: 't',
      tokenProvider: async () => 'tok',
      docAiSettings: {
        enabled: true,
        embedding: { model: 'm', dimensions: 4, maxInputTokens: 100 },
        s3Vectors: { bucket: '', index: '' }
      },
      embeddingProvider: { embed },
      vectorStore: { upsertVectors },
      priorEmbeddings: new Map()
    });

    // The one entry was embedded and upserted.
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith('Title\nExcerpt\nContent');
    expect(upsertVectors).toHaveBeenCalledTimes(1);

    // Pointer written with a 4th arg carrying the embedding model/dimensions.
    expect(dynamoWriter.updateVersionPointer).toHaveBeenCalledTimes(1);
    const call = dynamoWriter.updateVersionPointer.mock.calls[0];
    expect(call).toHaveLength(4);
    expect(call[3]).toEqual({ model: 'm', dimensions: 4 });
  });
});
