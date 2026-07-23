'use strict';

/**
 * Unit tests for DynamoDbVectorStore (doc-ai-common Lambda Layer).
 *
 * Purpose: Verify the DynamoDB-backed vector store against its contract: constructor
 * validation and client injection; the on-item vector/manifest write shapes; query
 * top-K ordering (descending cosine), metadata filtering, and the empty/no-manifest
 * case; warm-cache reuse and invalidation; version deletion; the base64 Float32 codec;
 * typed error paths; and factory integration.
 *
 * Mocking approach (hermetic, no AWS): a stateful FAKE DynamoDBDocumentClient
 * (`{ send: jest.fn(...) }`) is injected per-instance via `config.client` (the store's
 * documented test seam, which takes precedence over the module singleton). The fake
 * dispatches on `command.constructor.name` (GetCommand | BatchGetCommand |
 * BatchWriteCommand) over an in-memory `Map` of items keyed by `pk#sk`, so writes and
 * reads round-trip through the same store the real code would use. AWS SDK command
 * classes are the real ones (devDependencies), so we exercise the true command shapes.
 *
 * Stored vector items are built with the REAL `encodeVector` so query decoding is
 * exercised end-to-end. The module-level warm cache is cleared in `afterEach` (and the
 * module singleton reset) so no state leaks between tests.
 *
 * Validates: Requirements 4.1 (DynamoDB store read/write + Float32 items), 4.3
 * (metadata filtering by version/type/subType), and 4.4 (cosine ranking, top-K).
 */

const {
  DynamoDbVectorStore,
  cosineSimilarity,
  encodeVector,
  decodeVector,
  getDocClient,
  setDocClient,
  clearVectorCache,
  computeTtl,
  chunk,
  deduplicateItems,
  BATCH_LIMIT,
  MANIFEST_HASH_CHUNK_SIZE
} = require('../../nodejs/vector-store-dynamodb');

// The interface/factory live in vector-store.js; the factory lazily loads the concrete
// DynamoDbVectorStore (same class imported above) — used for the factory integration test.
const { VectorStore, VectorStoreError, createVectorStore } = require('../../nodejs/vector-store');

const TABLE_NAME = 'doc-index-test-table';

/**
 * Build a stateful fake DynamoDBDocumentClient backed by an in-memory Map. It handles
 * the three commands the store issues (GetCommand, BatchGetCommand, BatchWriteCommand)
 * so writes and reads round-trip through the same in-memory store.
 *
 * @returns {{
 *   client: {send: jest.Mock},
 *   items: Map<string, Object>,
 *   counts: {GetCommand: number, BatchGetCommand: number, BatchWriteCommand: number},
 *   readCount: function(): number,
 *   resetCounts: function(): void
 * }} The fake client plus inspection helpers.
 */
function createFakeDocClient() {
  const items = new Map();
  const counts = { GetCommand: 0, BatchGetCommand: 0, BatchWriteCommand: 0 };

  const send = jest.fn(async (command) => {
    const name = command.constructor.name;
    counts[name] = (counts[name] || 0) + 1;
    const input = command.input;

    if (name === 'GetCommand') {
      const { pk, sk } = input.Key;
      const item = items.get(`${pk}#${sk}`);
      return item ? { Item: { ...item } } : {};
    }

    if (name === 'BatchGetCommand') {
      const tableName = Object.keys(input.RequestItems)[0];
      const keys = input.RequestItems[tableName].Keys;
      const responses = [];
      for (const key of keys) {
        const item = items.get(`${key.pk}#${key.sk}`);
        if (item) {
          responses.push({ ...item });
        }
      }
      return { Responses: { [tableName]: responses }, UnprocessedKeys: {} };
    }

    if (name === 'BatchWriteCommand') {
      const tableName = Object.keys(input.RequestItems)[0];
      const requests = input.RequestItems[tableName];
      for (const request of requests) {
        if (request.PutRequest) {
          const item = request.PutRequest.Item;
          items.set(`${item.pk}#${item.sk}`, item);
        } else if (request.DeleteRequest) {
          const { pk, sk } = request.DeleteRequest.Key;
          items.delete(`${pk}#${sk}`);
        }
      }
      return { UnprocessedItems: {} };
    }

    throw new Error(`Unexpected command in fake client: ${name}`);
  });

  return {
    client: { send },
    items,
    counts,
    readCount: () => counts.GetCommand + counts.BatchGetCommand,
    resetCounts: () => {
      counts.GetCommand = 0;
      counts.BatchGetCommand = 0;
      counts.BatchWriteCommand = 0;
    }
  };
}

/**
 * Seed a version's vectors AND manifest directly into a fake client's Map, matching the
 * exact item shapes the store writes (vector items built with the real `encodeVector`,
 * manifest hash chunks, and a meta item recording `totalChunks`). This lets query tests
 * exercise the real GetCommand/BatchGetCommand/decode path independently of upsert.
 *
 * @param {{items: Map<string, Object>}} fake - The fake client (from {@link createFakeDocClient}).
 * @param {string} version - Index version to seed.
 * @param {Array<{hash: string, vector: number[], metadata?: Object}>} specs - Vectors to seed.
 * @param {Object} [options] - Seeding options.
 * @param {number} [options.dims] - Explicit dims to store (defaults to each vector's length).
 * @param {number} [options.ttl=9999999999] - TTL to stamp on seeded items.
 * @returns {void}
 */
function seedVersion(fake, version, specs, { dims, ttl = 9999999999 } = {}) {
  const hashes = specs.map((spec) => spec.hash);

  for (const spec of specs) {
    const metadata = spec.metadata || {};
    const item = {
      pk: `vector:${spec.hash}`,
      sk: `v:${version}`,
      version,
      vector: encodeVector(spec.vector),
      dims: dims || spec.vector.length,
      model: metadata.model,
      embeddingInputHash: metadata.embeddingInputHash,
      type: metadata.type,
      subType: metadata.subType,
      repository: metadata.repository,
      owner: metadata.owner,
      ttl
    };
    fake.items.set(`${item.pk}#${item.sk}`, item);
  }

  const hashChunks = chunk(hashes, MANIFEST_HASH_CHUNK_SIZE);
  hashChunks.forEach((hashList, index) => {
    const chunkItem = {
      pk: `vectormanifest:${version}`,
      sk: `hashes:${index}`,
      version,
      hashes: hashList,
      chunkIndex: index,
      ttl
    };
    fake.items.set(`${chunkItem.pk}#${chunkItem.sk}`, chunkItem);
  });

  const metaItem = {
    pk: `vectormanifest:${version}`,
    sk: 'meta',
    version,
    count: hashes.length,
    model: (specs[0] && specs[0].metadata && specs[0].metadata.model) || undefined,
    dimensions: dims || (specs[0] ? specs[0].vector.length : undefined),
    totalChunks: hashChunks.length,
    ttl
  };
  fake.items.set(`${metaItem.pk}#${metaItem.sk}`, metaItem);
}

/**
 * Construct a store wired to a fresh fake client.
 *
 * @param {Object} [overrides] - Extra config to merge (e.g. `{ dimensions }`).
 * @returns {{store: DynamoDbVectorStore, fake: ReturnType<typeof createFakeDocClient>}} The store and its fake.
 */
function makeStore(overrides = {}) {
  const fake = createFakeDocClient();
  const store = new DynamoDbVectorStore({
    dynamodb: { tableName: TABLE_NAME },
    client: fake.client,
    ...overrides
  });
  return { store, fake };
}

/**
 * Await a promise expected to reject and return the thrown error for assertions.
 *
 * @param {Promise<*>} promise - The promise expected to reject.
 * @returns {Promise<Error>} The rejection reason.
 */
async function captureError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject, but it resolved');
}

/**
 * Collect all `PutRequest` items across every BatchWriteCommand the fake received.
 *
 * @param {jest.Mock} send - The fake client's send mock.
 * @returns {Array<Object>} All put items (in send order).
 */
function collectPutItems(send) {
  const puts = [];
  for (const call of send.mock.calls) {
    const command = call[0];
    if (command.constructor.name !== 'BatchWriteCommand') {
      continue;
    }
    const tableName = Object.keys(command.input.RequestItems)[0];
    for (const request of command.input.RequestItems[tableName]) {
      if (request.PutRequest) {
        puts.push(request.PutRequest.Item);
      }
    }
  }
  return puts;
}

/**
 * Collect all `DeleteRequest` keys across every BatchWriteCommand the fake received.
 *
 * @param {jest.Mock} send - The fake client's send mock.
 * @returns {Array<{pk: string, sk: string}>} All delete keys (in send order).
 */
function collectDeleteKeys(send) {
  const deletes = [];
  for (const call of send.mock.calls) {
    const command = call[0];
    if (command.constructor.name !== 'BatchWriteCommand') {
      continue;
    }
    const tableName = Object.keys(command.input.RequestItems)[0];
    for (const request of command.input.RequestItems[tableName]) {
      if (request.DeleteRequest) {
        deletes.push(request.DeleteRequest.Key);
      }
    }
  }
  return deletes;
}

afterEach(() => {
  // The warm cache and module-singleton client are module-level; reset both so state
  // never leaks between tests.
  clearVectorCache();
  setDocClient(null);
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('DynamoDbVectorStore constructor', () => {
  it('constructs with a table name and reads optional dimensions', () => {
    const store = new DynamoDbVectorStore({
      dynamodb: { tableName: TABLE_NAME },
      dimensions: 4
    });
    expect(store).toBeInstanceOf(DynamoDbVectorStore);
    expect(store).toBeInstanceOf(VectorStore);
    expect(store.tableName).toBe(TABLE_NAME);
    expect(store.dimensions).toBe(4);
  });

  it('leaves dimensions undefined when not a positive integer', () => {
    const store = new DynamoDbVectorStore({ dynamodb: { tableName: TABLE_NAME }, dimensions: 0 });
    expect(store.dimensions).toBeUndefined();
  });

  it.each([
    ['config.dynamodb.tableName missing', { dynamodb: {} }],
    ['config.dynamodb missing', {}],
    ['config undefined', undefined],
    ['tableName is an empty string', { dynamodb: { tableName: '   ' } }]
  ])('throws VectorStoreError INVALID_CONFIG when %s', (_label, config) => {
    let error;
    try {
      // eslint-disable-next-line no-new
      new DynamoDbVectorStore(config);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(VectorStoreError);
    expect(error.code).toBe('INVALID_CONFIG');
  });

  it('prefers the per-instance injected client over the module singleton', async () => {
    const singleton = createFakeDocClient();
    const injected = createFakeDocClient();
    setDocClient(singleton.client);

    const store = new DynamoDbVectorStore({
      dynamodb: { tableName: TABLE_NAME },
      client: injected.client
    });
    seedVersion(injected, 'v1', [{ hash: 'a', vector: [1, 0] }]);

    await store.query([1, 0], { version: 'v1' });

    expect(injected.client.send).toHaveBeenCalled();
    expect(singleton.client.send).not.toHaveBeenCalled();
  });
});

describe('upsertVectors — write shapes (Req 4.1)', () => {
  it('writes vector items with the expected pk/sk/attrs (base64 vector, ttl, dims, metadata)', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    const before = Math.floor(Date.now() / 1000);

    await store.upsertVectors('v3', [
      {
        hash: 'abc',
        vector: [0.1, 0.2],
        metadata: {
          type: 'guide',
          subType: 'howto',
          repository: 'core',
          owner: '63klabs',
          embeddingInputHash: 'h1',
          model: 'amazon.titan-embed-text-v2:0'
        }
      }
    ]);

    const puts = collectPutItems(fake.client.send);
    const vectorItem = puts.find((item) => item.pk === 'vector:abc');

    expect(vectorItem).toBeDefined();
    expect(vectorItem.sk).toBe('v:v3');
    expect(vectorItem.version).toBe('v3');
    expect(typeof vectorItem.vector).toBe('string');
    expect(vectorItem.dims).toBe(2);
    expect(vectorItem.type).toBe('guide');
    expect(vectorItem.subType).toBe('howto');
    expect(vectorItem.repository).toBe('core');
    expect(vectorItem.owner).toBe('63klabs');
    expect(vectorItem.embeddingInputHash).toBe('h1');
    expect(vectorItem.model).toBe('amazon.titan-embed-text-v2:0');
    expect(typeof vectorItem.ttl).toBe('number');
    expect(vectorItem.ttl).toBeGreaterThanOrEqual(before);

    // The stored vector decodes back to the input (Float32 precision).
    const decoded = decodeVector(vectorItem.vector, vectorItem.dims);
    expect(decoded[0]).toBeCloseTo(0.1, 5);
    expect(decoded[1]).toBeCloseTo(0.2, 5);
  });

  it('writes a manifest meta item with correct count, totalChunks, dimensions, and model', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });

    await store.upsertVectors('v3', [
      { hash: 'a', vector: [0.1, 0.2], metadata: { model: 'amazon.titan-embed-text-v2:0' } },
      { hash: 'b', vector: [0.3, 0.4], metadata: { model: 'amazon.titan-embed-text-v2:0' } }
    ]);

    const puts = collectPutItems(fake.client.send);
    const meta = puts.find((item) => item.pk === 'vectormanifest:v3' && item.sk === 'meta');
    const hashChunk = puts.find((item) => item.pk === 'vectormanifest:v3' && item.sk === 'hashes:0');

    expect(meta).toBeDefined();
    expect(meta.count).toBe(2);
    expect(meta.totalChunks).toBe(1);
    expect(meta.dimensions).toBe(2);
    expect(meta.model).toBe('amazon.titan-embed-text-v2:0');

    expect(hashChunk).toBeDefined();
    expect(hashChunk.hashes).toEqual(['a', 'b']);
    expect(hashChunk.chunkIndex).toBe(0);
  });

  it('deduplicates repeated hashes: one vector item per key and manifest count reflects unique hashes', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });

    await store.upsertVectors('v3', [
      { hash: 'a', vector: [0.1, 0.2] },
      { hash: 'b', vector: [0.3, 0.4] },
      { hash: 'a', vector: [0.9, 0.9] } // duplicate hash -> same pk/sk
    ]);

    // In the resulting store, only the two distinct vector keys exist.
    const storedVectorKeys = [...fake.items.keys()].filter((key) => key.startsWith('vector:'));
    expect(storedVectorKeys).toHaveLength(2);

    const meta = fake.items.get('vectormanifest:v3#meta');
    expect(meta.count).toBe(2);
    expect(fake.items.get('vectormanifest:v3#hashes:0').hashes).toEqual(['a', 'b']);
  });

  it('rounds-trips through upsert then query (write/read shapes agree)', async () => {
    const { store } = makeStore({ dimensions: 2 });

    await store.upsertVectors('v3', [
      { hash: 'a', vector: [1, 0], metadata: { type: 'guide' } },
      { hash: 'b', vector: [0, 1], metadata: { type: 'guide' } }
    ]);
    clearVectorCache();

    const results = await store.query([1, 0], { version: 'v3', topK: 2 });

    expect(results.map((r) => r.hash)).toEqual(['a', 'b']);
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[1].score).toBeCloseTo(0, 5);
  });
});

describe('query — top-K ordering (Req 4.4)', () => {
  const querySpecs = [
    { hash: 'exact', vector: [1, 0], metadata: { type: 'guide' } },   // cos 1.0
    { hash: 'close', vector: [0.9, 0.1], metadata: { type: 'guide' } }, // cos ~0.994
    { hash: 'mid', vector: [1, 1], metadata: { type: 'guide' } },     // cos ~0.707
    { hash: 'far', vector: [0, 1], metadata: { type: 'guide' } },     // cos 0
    { hash: 'opposite', vector: [-1, 0], metadata: { type: 'guide' } } // cos -1
  ];

  it('returns results ordered by descending cosine similarity', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', querySpecs);

    const results = await store.query([1, 0], { version: 'v1', topK: 5 });

    expect(results.map((r) => r.hash)).toEqual(['exact', 'close', 'mid', 'far', 'opposite']);
    // Scores are strictly non-increasing.
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[results.length - 1].score).toBeCloseTo(-1, 5);
  });

  it('slices to topK, returning the highest-scoring results only', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', querySpecs);

    const results = await store.query([1, 0], { version: 'v1', topK: 2 });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.hash)).toEqual(['exact', 'close']);
  });

  it('scores match cosineSimilarity of the decoded stored vectors', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', querySpecs);

    const results = await store.query([1, 0], { version: 'v1', topK: 5 });
    const midResult = results.find((r) => r.hash === 'mid');

    expect(midResult.score).toBeCloseTo(cosineSimilarity([1, 0], [1, 1]), 6);
  });

  it('returns metadata alongside each hit', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', [{ hash: 'a', vector: [1, 0], metadata: { type: 'guide', subType: 'howto' } }]);

    const [hit] = await store.query([1, 0], { version: 'v1', topK: 1 });

    expect(hit.metadata.type).toBe('guide');
    expect(hit.metadata.subType).toBe('howto');
  });
});

describe('query — metadata filtering (Req 4.3)', () => {
  const filterSpecs = [
    { hash: 'g-howto', vector: [1, 0], metadata: { type: 'guide', subType: 'howto' } },
    { hash: 'g-ref', vector: [0.9, 0.1], metadata: { type: 'guide', subType: 'reference' } },
    { hash: 'a-howto', vector: [0.8, 0.2], metadata: { type: 'api', subType: 'howto' } }
  ];

  it('applies a single filter, returning only matching vectors', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', filterSpecs);

    const results = await store.query([1, 0], { version: 'v1', filters: { type: 'guide' }, topK: 10 });

    expect(results.map((r) => r.hash).sort()).toEqual(['g-howto', 'g-ref']);
  });

  it('ANDs multiple filters together', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', filterSpecs);

    const results = await store.query([1, 0], {
      version: 'v1',
      filters: { type: 'guide', subType: 'howto' },
      topK: 10
    });

    expect(results.map((r) => r.hash)).toEqual(['g-howto']);
  });

  it('returns all vectors when filters are absent or empty', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', filterSpecs);

    const noFilters = await store.query([1, 0], { version: 'v1', topK: 10 });
    const emptyFilters = await store.query([1, 0], { version: 'v1', filters: {}, topK: 10 });

    expect(noFilters).toHaveLength(3);
    expect(emptyFilters).toHaveLength(3);
  });

  it('ignores undefined/null filter values (treats them as no filter)', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', filterSpecs);

    const results = await store.query([1, 0], {
      version: 'v1',
      filters: { type: 'guide', subType: undefined },
      topK: 10
    });

    expect(results.map((r) => r.hash).sort()).toEqual(['g-howto', 'g-ref']);
  });

  it('returns an empty array when a filter matches nothing', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', filterSpecs);

    const results = await store.query([1, 0], { version: 'v1', filters: { type: 'nonexistent' }, topK: 10 });

    expect(results).toEqual([]);
  });
});

describe('query — empty / no-manifest', () => {
  it('resolves to [] when the version manifest does not exist', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', [{ hash: 'a', vector: [1, 0] }]);

    const results = await store.query([1, 0], { version: 'does-not-exist', topK: 10 });

    expect(results).toEqual([]);
  });
});

describe('query — warm cache reuse and invalidation (Req 7 warm reuse)', () => {
  it('reads DynamoDB on the first query and serves the second from the warm cache', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', [
      { hash: 'a', vector: [1, 0] },
      { hash: 'b', vector: [0, 1] }
    ]);
    clearVectorCache();
    fake.resetCounts();

    const first = await store.query([1, 0], { version: 'v1', topK: 2 });
    const readsAfterFirst = fake.readCount();
    expect(readsAfterFirst).toBeGreaterThan(0);

    const second = await store.query([1, 0], { version: 'v1', topK: 2 });

    // No additional DynamoDB reads on the second query for the same version.
    expect(fake.readCount()).toBe(readsAfterFirst);
    expect(second).toEqual(first);
  });

  it('drops the warm cache after upsertVectors so the next query re-reads', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', [{ hash: 'a', vector: [1, 0] }]);
    clearVectorCache();

    await store.query([1, 0], { version: 'v1', topK: 1 }); // warms cache
    await store.upsertVectors('v1', [{ hash: 'a', vector: [1, 0] }]); // drops cache for v1
    fake.resetCounts();

    await store.query([1, 0], { version: 'v1', topK: 1 });

    expect(fake.readCount()).toBeGreaterThan(0);
  });

  it('drops the warm cache after deleteVersion so the next query re-reads', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', [{ hash: 'a', vector: [1, 0] }]);
    clearVectorCache();

    await store.query([1, 0], { version: 'v1', topK: 1 }); // warms cache
    await store.deleteVersion('v1'); // drops cache + removes items
    fake.resetCounts();

    const results = await store.query([1, 0], { version: 'v1', topK: 1 });

    expect(fake.readCount()).toBeGreaterThan(0); // re-read attempted
    expect(results).toEqual([]); // and the version is now gone
  });
});

describe('deleteVersion', () => {
  it('batch-deletes the vector items plus the manifest meta and hash chunks', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });
    seedVersion(fake, 'v1', [
      { hash: 'a', vector: [1, 0] },
      { hash: 'b', vector: [0, 1] }
    ]);

    await store.deleteVersion('v1');

    const deletedKeys = collectDeleteKeys(fake.client.send).map((key) => `${key.pk}#${key.sk}`);
    expect(deletedKeys).toEqual(expect.arrayContaining([
      'vector:a#v:v1',
      'vector:b#v:v1',
      'vectormanifest:v1#meta',
      'vectormanifest:v1#hashes:0'
    ]));

    // The items are actually gone from the backing store.
    expect(fake.items.has('vector:a#v:v1')).toBe(false);
    expect(fake.items.has('vectormanifest:v1#meta')).toBe(false);
  });

  it('is a no-op (no BatchWrite) when the version has no manifest', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });

    await store.deleteVersion('missing');

    expect(fake.counts.BatchWriteCommand).toBe(0);
  });
});

describe('encodeVector / decodeVector — codec units', () => {
  it('round-trips representative small vectors within Float32 precision', () => {
    const vectors = [
      [0.1, -0.2, 0.33, -0.44],
      [0.5, -0.5, 1, -1, 0],
      [0.123456, -0.654321]
    ];
    for (const v of vectors) {
      const decoded = decodeVector(encodeVector(v), v.length);
      expect(decoded).toHaveLength(v.length);
      for (let i = 0; i < v.length; i++) {
        expect(decoded[i]).toBeCloseTo(v[i], 5);
      }
    }
  });

  it('bounds decoding by dims (a smaller dims returns exactly that many floats)', () => {
    const v = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const encoded = encodeVector(v);

    const two = decodeVector(encoded, 2);
    expect(two).toHaveLength(2);
    expect(two[0]).toBeCloseTo(0.1, 5);
    expect(two[1]).toBeCloseTo(0.2, 5);
  });

  it('bounds decoding by the available byte length when dims exceeds it', () => {
    const v = [0.1, 0.2, 0.3, 0.4];
    const decoded = decodeVector(encodeVector(v), 100);
    expect(decoded).toHaveLength(4);
  });

  it('encodeVector throws INVALID_VECTOR for a non-array or empty vector', () => {
    expect(() => encodeVector([])).toThrow(VectorStoreError);
    expect(() => encodeVector('nope')).toThrow(VectorStoreError);
    try {
      encodeVector([]);
    } catch (error) {
      expect(error.code).toBe('INVALID_VECTOR');
    }
  });

  it('encodeVector throws INVALID_VECTOR for non-finite elements', () => {
    try {
      encodeVector([0.1, NaN, 0.3]);
    } catch (error) {
      expect(error).toBeInstanceOf(VectorStoreError);
      expect(error.code).toBe('INVALID_VECTOR');
    }
  });

  it('decodeVector throws INVALID_VECTOR when input is not a string', () => {
    try {
      decodeVector(12345, 4);
    } catch (error) {
      expect(error).toBeInstanceOf(VectorStoreError);
      expect(error.code).toBe('INVALID_VECTOR');
    }
  });
});

describe('error paths', () => {
  it('query throws INVALID_QUERY when the embedding is not a non-empty array', async () => {
    const { store } = makeStore({ dimensions: 2 });

    const emptyError = await captureError(store.query([], { version: 'v1' }));
    expect(emptyError).toBeInstanceOf(VectorStoreError);
    expect(emptyError.code).toBe('INVALID_QUERY');

    const nonArrayError = await captureError(store.query('not-an-array', { version: 'v1' }));
    expect(nonArrayError.code).toBe('INVALID_QUERY');
  });

  it('query throws INVALID_ARGUMENT when the version is missing', async () => {
    const { store } = makeStore({ dimensions: 2 });

    const error = await captureError(store.query([0.1, 0.2], {}));

    expect(error).toBeInstanceOf(VectorStoreError);
    expect(error.code).toBe('INVALID_ARGUMENT');
  });

  it('query wraps a rejecting client as QUERY_FAILED and preserves the cause', async () => {
    const original = new Error('dynamo unavailable');
    const store = new DynamoDbVectorStore({
      dynamodb: { tableName: TABLE_NAME },
      client: { send: jest.fn().mockRejectedValue(original) }
    });

    const error = await captureError(store.query([0.1, 0.2], { version: 'v1', topK: 5 }));

    expect(error).toBeInstanceOf(VectorStoreError);
    expect(error.code).toBe('QUERY_FAILED');
    expect(error.cause).toBe(original);
  });

  it('upsertVectors wraps a rejecting client as UPSERT_FAILED and preserves the cause', async () => {
    const original = new Error('write throttled');
    const store = new DynamoDbVectorStore({
      dynamodb: { tableName: TABLE_NAME },
      client: { send: jest.fn().mockRejectedValue(original) }
    });

    const error = await captureError(
      store.upsertVectors('v1', [{ hash: 'a', vector: [0.1, 0.2], metadata: {} }])
    );

    expect(error).toBeInstanceOf(VectorStoreError);
    expect(error.code).toBe('UPSERT_FAILED');
    expect(error.cause).toBe(original);
  });

  it('upsertVectors surfaces validation errors (INVALID_ARGUMENT / INVALID_VECTOR) before any AWS call', async () => {
    const { store, fake } = makeStore({ dimensions: 2 });

    const badVersion = await captureError(store.upsertVectors('', [{ hash: 'a', vector: [0.1] }]));
    expect(badVersion.code).toBe('INVALID_ARGUMENT');

    const notArray = await captureError(store.upsertVectors('v1', 'nope'));
    expect(notArray.code).toBe('INVALID_ARGUMENT');

    const emptyHash = await captureError(store.upsertVectors('v1', [{ hash: '', vector: [0.1] }]));
    expect(emptyHash.code).toBe('INVALID_ARGUMENT');

    const emptyVector = await captureError(store.upsertVectors('v1', [{ hash: 'a', vector: [] }]));
    expect(emptyVector.code).toBe('INVALID_VECTOR');

    // None of the invalid calls reached DynamoDB.
    expect(fake.client.send).not.toHaveBeenCalled();
  });
});

describe('createVectorStore factory integration (Req 4.5 extension point)', () => {
  it('returns a DynamoDbVectorStore instance for vectorStore: "dynamodb"', () => {
    const store = createVectorStore({
      vectorStore: 'dynamodb',
      dimensions: 4,
      dynamodb: { tableName: TABLE_NAME }
    });

    expect(store).toBeInstanceOf(DynamoDbVectorStore);
    expect(store).toBeInstanceOf(VectorStore);
    expect(store.tableName).toBe(TABLE_NAME);
    expect(store.dimensions).toBe(4);
  });
});

describe('exported helpers (sanity)', () => {
  it('computeTtl returns a future unix timestamp (~7 days ahead)', () => {
    const now = Math.floor(Date.now() / 1000);
    const ttl = computeTtl();
    expect(ttl).toBeGreaterThan(now);
    // 7 days == 604800 seconds; allow a small execution delta.
    expect(ttl - now).toBeGreaterThanOrEqual(604800 - 5);
    expect(ttl - now).toBeLessThanOrEqual(604800 + 5);
  });

  it('chunk splits arrays into fixed-size groups', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it('deduplicateItems keeps the last item per pk/sk key', () => {
    const deduped = deduplicateItems([
      { pk: 'a', sk: '1', n: 1 },
      { pk: 'a', sk: '1', n: 2 },
      { pk: 'b', sk: '1', n: 3 }
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((item) => item.pk === 'a').n).toBe(2);
  });

  it('exposes BATCH_LIMIT as 25 (DynamoDB BatchWrite cap)', () => {
    expect(BATCH_LIMIT).toBe(25);
  });

  it('getDocClient returns a singleton (same instance across calls) when no injection', () => {
    setDocClient(null);
    const a = getDocClient();
    const b = getDocClient();
    expect(a).toBe(b);
  });
});
