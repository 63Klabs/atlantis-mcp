'use strict';

/**
 * Unit tests for S3VectorStore (doc-ai-common Lambda Layer).
 *
 * Purpose: Verify the S3 Vectors-backed vector store against its contract: constructor
 * validation and client injection; the PutVectors write mapping (version-scoped keys,
 * pruned metadata, chunking); query distance→score mapping, filter translation,
 * nearest-first order preservation, bounded nextToken pagination, and the empty case;
 * version cleanup via ListVectors + DeleteVectors (client-side prefix filter, chunking);
 * typed error paths; the pure helpers; and factory integration.
 *
 * Mocking approach (hermetic, no AWS): a configurable FAKE S3VectorsClient
 * (`{ send: jest.fn(...) }`) is injected per-instance via `config.client` (the store's
 * documented precedence seam over the module singleton). The fake dispatches on
 * `command.constructor.name` (PutVectorsCommand | QueryVectorsCommand | ListVectorsCommand
 * | DeleteVectorsCommand) and returns caller-supplied responses, recording every command
 * so its `.input` (the true AWS SDK command shape — the command classes are real
 * devDependencies) can be asserted. The module singleton is reset with
 * `setS3VectorsClient(null)` and all mocks restored in `afterEach` so no state leaks.
 *
 * Validates: Requirements 4.2 (put/query mapping + metadata translation), 4.3 (metadata
 * filter translation by version/type/subType), 4.4 (cosine ranking via distance→score,
 * top-K), and 4.5 (factory returns the store behind the shared interface).
 */

const {
  S3VectorStore,
  buildS3Filter,
  makeVectorKey,
  parseHashFromKey,
  distanceToScore,
  chunk,
  getS3VectorsClient,
  setS3VectorsClient,
  KEY_SEPARATOR,
  FILTERABLE_FILTER_KEYS,
  PUT_VECTORS_CHUNK_SIZE,
  DELETE_VECTORS_CHUNK_SIZE,
  DEFAULT_TOP_K
} = require('../../nodejs/vector-store-s3');

// The interface/factory live in vector-store.js; the factory lazily loads the concrete
// S3VectorStore (same class imported above) — used for the factory integration test.
const { VectorStore, VectorStoreError, createVectorStore } = require('../../nodejs/vector-store');

const BUCKET = 'doc-ai-test-vectors';
const INDEX = 'doc-ai-test-index';

// The internal QueryVectors pagination safety cap (MAX_QUERY_PAGES) is not exported; the
// implementation documents it as 20. Referenced only by the "bounded loop" test below.
const MAX_QUERY_PAGES = 20;

/**
 * Default responses per command name, used when a test does not supply a handler.
 * @type {Object.<string, Object>}
 */
const DEFAULT_RESPONSES = {
  PutVectorsCommand: {},
  QueryVectorsCommand: { vectors: [] },
  ListVectorsCommand: { vectors: [] },
  DeleteVectorsCommand: {}
};

/**
 * Build a configurable fake S3VectorsClient. Each `handlers[commandName]` may be a
 * function `(command) => response` (for stateful/paginated behavior) or a plain response
 * object; when absent, a sensible default response is returned. Every command sent is
 * recorded so its real `.input` can be inspected.
 *
 * @param {Object.<string, (Function|Object)>} [handlers] - Per-command response handlers.
 * @returns {{client: {send: jest.Mock}, send: jest.Mock, commands: Array<Object>}} The fake client plus inspection helpers.
 */
function createFakeClient(handlers = {}) {
  const commands = [];

  const send = jest.fn(async (command) => {
    const name = command.constructor.name;
    commands.push(command);

    const handler = handlers[name];
    let result;
    if (typeof handler === 'function') {
      result = await handler(command);
    } else if (handler !== undefined) {
      result = handler;
    } else {
      result = DEFAULT_RESPONSES[name];
    }

    if (result === undefined) {
      throw new Error(`Unexpected command in fake S3 Vectors client: ${name}`);
    }
    return result;
  });

  return { client: { send }, send, commands };
}

/**
 * Construct a store wired to a fresh fake client.
 *
 * @param {Object.<string, (Function|Object)>} [handlers] - Per-command response handlers for the fake.
 * @param {Object} [configOverrides] - Extra config merged into the store config (e.g. `{ dimensions }`).
 * @returns {{store: S3VectorStore, fake: ReturnType<typeof createFakeClient>}} The store and its fake.
 */
function makeStore(handlers = {}, configOverrides = {}) {
  const fake = createFakeClient(handlers);
  const store = new S3VectorStore({
    s3Vectors: { bucket: BUCKET, index: INDEX },
    client: fake.client,
    ...configOverrides
  });
  return { store, fake };
}

/**
 * Filter a fake's recorded commands to those of a given type.
 *
 * @param {ReturnType<typeof createFakeClient>} fake - The fake client.
 * @param {string} name - The command constructor name to keep.
 * @returns {Array<Object>} Matching commands, in send order.
 */
function commandsOfType(fake, name) {
  return fake.commands.filter((command) => command.constructor.name === name);
}

/**
 * Build a stateful QueryVectors/ListVectors handler that returns successive pages.
 *
 * @param {Array<Object>} pages - Responses to return on successive sends (last repeats as `{ vectors: [] }`).
 * @returns {function(): Object} A handler for {@link createFakeClient}.
 */
function pagedHandler(pages) {
  let index = 0;
  return () => {
    const page = pages[index] || { vectors: [] };
    index++;
    return page;
  };
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

afterEach(() => {
  // The module-singleton client is module-level; reset it (and all mocks) so no state
  // leaks between tests.
  setS3VectorsClient(null);
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('buildS3Filter — metadata filter translation (Req 4.3)', () => {
  it('returns a bare version equality filter when no filters are supplied', () => {
    expect(buildS3Filter('v3')).toEqual({ version: { $eq: 'v3' } });
  });

  it('ANDs the version with a single filterable type filter', () => {
    expect(buildS3Filter('v3', { type: 'guide' })).toEqual({
      $and: [
        { version: { $eq: 'v3' } },
        { type: { $eq: 'guide' } }
      ]
    });
  });

  it('ANDs the version with both type and subType filters', () => {
    expect(buildS3Filter('v3', { type: 'guide', subType: 'howto' })).toEqual({
      $and: [
        { version: { $eq: 'v3' } },
        { type: { $eq: 'guide' } },
        { subType: { $eq: 'howto' } }
      ]
    });
  });

  it('drops undefined/null filter values (falling back to a bare version filter)', () => {
    expect(buildS3Filter('v3', { type: undefined, subType: null })).toEqual({
      version: { $eq: 'v3' }
    });
  });

  it('drops non-filterable keys such as repository, owner, and arbitrary keys', () => {
    expect(buildS3Filter('v3', { repository: 'core', owner: '63klabs', anything: 'x' })).toEqual({
      version: { $eq: 'v3' }
    });
  });

  it('keeps filterable keys while dropping non-filterable ones in the same call', () => {
    expect(buildS3Filter('v3', { type: 'guide', repository: 'core' })).toEqual({
      $and: [
        { version: { $eq: 'v3' } },
        { type: { $eq: 'guide' } }
      ]
    });
  });

  it('emits conditions in a deterministic allowlist order regardless of input key order', () => {
    // Input lists subType before type, but output must follow FILTERABLE_FILTER_KEYS order.
    const filter = buildS3Filter('v3', { subType: 'howto', type: 'guide' });
    expect(filter.$and.map((condition) => Object.keys(condition)[0])).toEqual([
      'version',
      'type',
      'subType'
    ]);
  });

  it('exposes the filterable key allowlist as [type, subType]', () => {
    expect(FILTERABLE_FILTER_KEYS).toEqual(['type', 'subType']);
  });
});

describe('helper units — makeVectorKey / parseHashFromKey / distanceToScore / chunk', () => {
  it('makeVectorKey joins version and hash with the KEY_SEPARATOR', () => {
    expect(makeVectorKey('v3', 'abc123')).toBe('v3#abc123');
    expect(makeVectorKey('v3', '')).toBe(`v3${KEY_SEPARATOR}`);
    expect(KEY_SEPARATOR).toBe('#');
  });

  it('parseHashFromKey strips the version prefix when the version is provided', () => {
    expect(parseHashFromKey('v3#abc123', 'v3')).toBe('abc123');
  });

  it('parseHashFromKey falls back to the first separator when no version is provided', () => {
    expect(parseHashFromKey('v3#abc123')).toBe('abc123');
  });

  it('parseHashFromKey keeps later separators intact when stripping the version prefix', () => {
    expect(parseHashFromKey('v3#a#b', 'v3')).toBe('a#b');
  });

  it('parseHashFromKey returns the key unchanged when there is no separator', () => {
    expect(parseHashFromKey('noseparator', 'v3')).toBe('noseparator');
    expect(parseHashFromKey('noseparator')).toBe('noseparator');
  });

  it('parseHashFromKey returns an empty string for a non-string key', () => {
    expect(parseHashFromKey(12345, 'v3')).toBe('');
    expect(parseHashFromKey(undefined, 'v3')).toBe('');
  });

  it('distanceToScore converts cosine distance to similarity (1 - distance)', () => {
    expect(distanceToScore(0)).toBe(1);
    expect(distanceToScore(1)).toBe(0);
    expect(distanceToScore(0.2)).toBeCloseTo(0.8, 10);
    expect(distanceToScore(2)).toBe(-1);
  });

  it('distanceToScore returns 0 (least similar) for non-finite or non-numeric distances', () => {
    expect(distanceToScore(NaN)).toBe(0);
    expect(distanceToScore(Infinity)).toBe(0);
    expect(distanceToScore('nope')).toBe(0);
    expect(distanceToScore(undefined)).toBe(0);
  });

  it('chunk splits arrays into fixed-size groups (and returns [] for empty input)', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('S3VectorStore constructor (Req 4.2 config validation)', () => {
  it('constructs with a bucket + index and reads optional dimensions', () => {
    const store = new S3VectorStore({
      s3Vectors: { bucket: BUCKET, index: INDEX },
      dimensions: 4
    });
    expect(store).toBeInstanceOf(S3VectorStore);
    expect(store).toBeInstanceOf(VectorStore);
    expect(store.bucket).toBe(BUCKET);
    expect(store.index).toBe(INDEX);
    expect(store.dimensions).toBe(4);
  });

  it('leaves dimensions undefined when not a positive integer', () => {
    const store = new S3VectorStore({ s3Vectors: { bucket: BUCKET, index: INDEX }, dimensions: 0 });
    expect(store.dimensions).toBeUndefined();
  });

  it.each([
    ['s3Vectors.bucket missing', { s3Vectors: { index: INDEX } }],
    ['s3Vectors.index missing', { s3Vectors: { bucket: BUCKET } }],
    ['s3Vectors missing entirely', {}],
    ['config undefined', undefined],
    ['bucket is a blank string', { s3Vectors: { bucket: '   ', index: INDEX } }],
    ['index is a blank string', { s3Vectors: { bucket: BUCKET, index: '   ' } }]
  ])('throws VectorStoreError INVALID_CONFIG when %s', (_label, config) => {
    let error;
    try {
      // eslint-disable-next-line no-new
      new S3VectorStore(config);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(VectorStoreError);
    expect(error.code).toBe('INVALID_CONFIG');
  });

  it('prefers the per-instance injected client over the module singleton', async () => {
    const singleton = createFakeClient();
    const injected = createFakeClient();
    setS3VectorsClient(singleton.client);

    const store = new S3VectorStore({
      s3Vectors: { bucket: BUCKET, index: INDEX },
      client: injected.client
    });

    await store.query([0.1, 0.2], { version: 'v1' });

    expect(injected.send).toHaveBeenCalled();
    expect(singleton.send).not.toHaveBeenCalled();
  });

  it('getS3VectorsClient returns a singleton (same instance across calls) with no injection', () => {
    setS3VectorsClient(null);
    const a = getS3VectorsClient();
    const b = getS3VectorsClient();
    expect(a).toBe(b);
  });
});

describe('upsertVectors — PutVectors mapping and chunking (Req 4.2)', () => {
  it('maps an item to a version-scoped key, float32 data, and pruned metadata', async () => {
    const { store, fake } = makeStore({}, { dimensions: 4 });

    await store.upsertVectors('v3', [
      {
        hash: 'abc',
        vector: [0.1, 0.2, 0.3, 0.4],
        metadata: {
          type: 'guide',
          subType: 'howto',
          repository: 'core',
          embeddingInputHash: 'h1',
          // model/dims ARE persisted so the doc-indexer can reuse unchanged embeddings
          // across versions for the S3 store (Req 6.2), matching DynamoDB. `owner` is
          // absent → dropped.
          model: 'amazon.titan-embed-text-v2:0',
          dims: 4
        }
      }
    ]);

    const puts = commandsOfType(fake, 'PutVectorsCommand');
    expect(puts).toHaveLength(1);
    expect(puts[0].input.vectorBucketName).toBe(BUCKET);
    expect(puts[0].input.indexName).toBe(INDEX);
    expect(puts[0].input.vectors).toHaveLength(1);

    const record = puts[0].input.vectors[0];
    expect(record.key).toBe('v3#abc');
    expect(record.data).toEqual({ float32: [0.1, 0.2, 0.3, 0.4] });
    expect(record.metadata).toEqual({
      version: 'v3',
      hash: 'abc',
      type: 'guide',
      subType: 'howto',
      repository: 'core',
      embeddingInputHash: 'h1',
      model: 'amazon.titan-embed-text-v2:0',
      dims: 4
    });
    // Absent fields are still pruned from stored metadata.
    expect(record.metadata).not.toHaveProperty('owner');
  });

  it('prunes undefined/null metadata values, keeping only meaningful fields', async () => {
    const { store, fake } = makeStore();

    await store.upsertVectors('v3', [
      { hash: 'onlytype', vector: [0.1, 0.2], metadata: { type: 'guide', subType: undefined, owner: null } }
    ]);

    const record = commandsOfType(fake, 'PutVectorsCommand')[0].input.vectors[0];
    expect(record.metadata).toEqual({ version: 'v3', hash: 'onlytype', type: 'guide' });
    // model/dims are omitted when not provided (undefined) — same pruning as other fields.
    expect(record.metadata).not.toHaveProperty('model');
    expect(record.metadata).not.toHaveProperty('dims');
  });

  it('chunks more than PUT_VECTORS_CHUNK_SIZE items into multiple PutVectors sends of <= 100', async () => {
    const { store, fake } = makeStore();

    const items = [];
    for (let i = 0; i < 250; i++) {
      items.push({ hash: `h${i}`, vector: [0.1, 0.2, 0.3, 0.4], metadata: { type: 'guide' } });
    }

    await store.upsertVectors('v3', items);

    const puts = commandsOfType(fake, 'PutVectorsCommand');
    expect(puts).toHaveLength(3);
    expect(puts.map((command) => command.input.vectors.length)).toEqual([100, 100, 50]);
    for (const command of puts) {
      expect(command.input.vectors.length).toBeLessThanOrEqual(PUT_VECTORS_CHUNK_SIZE);
    }
    // All 250 unique keys were written across the chunks.
    const allKeys = puts.flatMap((command) => command.input.vectors.map((vector) => vector.key));
    expect(new Set(allKeys).size).toBe(250);
  });

  it('is a no-op for empty items (no PutVectors send)', async () => {
    const { store, fake } = makeStore();

    await store.upsertVectors('v3', []);

    expect(fake.send).not.toHaveBeenCalled();
  });
});

describe('query — mapping, distance→score, and command shape (Req 4.4)', () => {
  it('maps returned vectors to { hash, score, metadata } preserving S3 order', async () => {
    const { store } = makeStore({
      QueryVectorsCommand: {
        vectors: [
          { key: 'v3#a', distance: 0.1, metadata: { hash: 'a', type: 'guide' } },
          { key: 'v3#b', distance: 0.5, metadata: { hash: 'b' } }
        ]
      }
    });

    const results = await store.query([0.1, 0.2, 0.3, 0.4], { version: 'v3', topK: 10 });

    expect(results).toEqual([
      { hash: 'a', score: 0.9, metadata: { hash: 'a', type: 'guide' } },
      { hash: 'b', score: 0.5, metadata: { hash: 'b' } }
    ]);
  });

  it('falls back to parsing the key for hash when metadata.hash is absent', async () => {
    const { store } = makeStore({
      QueryVectorsCommand: {
        vectors: [
          { key: 'v3#fromkey', distance: 0.2, metadata: { type: 'ref' } }, // no metadata.hash
          { key: 'v3#nometa', distance: 0.4 } // no metadata object at all
        ]
      }
    });

    const results = await store.query([0.1, 0.2], { version: 'v3', topK: 10 });

    expect(results[0]).toEqual({ hash: 'fromkey', score: 0.8, metadata: { type: 'ref' } });
    expect(results[1]).toEqual({ hash: 'nometa', score: expect.closeTo(0.6, 10), metadata: {} });
  });

  it('sends a QueryVectorsCommand with float32 query, topK, returnDistance/Metadata, and the built filter', async () => {
    const { store, fake } = makeStore({ QueryVectorsCommand: { vectors: [] } });

    await store.query([0.1, 0.2, 0.3, 0.4], { version: 'v3', filters: { type: 'guide' }, topK: 5 });

    const query = commandsOfType(fake, 'QueryVectorsCommand')[0];
    expect(query.input.vectorBucketName).toBe(BUCKET);
    expect(query.input.indexName).toBe(INDEX);
    expect(query.input.queryVector).toEqual({ float32: [0.1, 0.2, 0.3, 0.4] });
    expect(query.input.topK).toBe(5);
    expect(query.input.returnDistance).toBe(true);
    expect(query.input.returnMetadata).toBe(true);
    expect(query.input.filter).toEqual(buildS3Filter('v3', { type: 'guide' }));
    expect(query.input.filter).toEqual({
      $and: [
        { version: { $eq: 'v3' } },
        { type: { $eq: 'guide' } }
      ]
    });
  });

  it('defaults topK to DEFAULT_TOP_K when it is omitted or invalid', async () => {
    const { store, fake } = makeStore({ QueryVectorsCommand: { vectors: [] } });

    await store.query([0.1, 0.2], { version: 'v3' });
    await store.query([0.1, 0.2], { version: 'v3', topK: 0 });

    const queries = commandsOfType(fake, 'QueryVectorsCommand');
    expect(queries[0].input.topK).toBe(DEFAULT_TOP_K);
    expect(queries[1].input.topK).toBe(DEFAULT_TOP_K);
    expect(DEFAULT_TOP_K).toBe(10);
  });
});

describe('query — filter translation from options (Req 4.3)', () => {
  it('translates type + subType filters into an ANDed filter on the command input', async () => {
    const { store, fake } = makeStore({ QueryVectorsCommand: { vectors: [] } });

    await store.query([0.1, 0.2], {
      version: 'v3',
      filters: { type: 'guide', subType: 'howto' },
      topK: 10
    });

    const query = commandsOfType(fake, 'QueryVectorsCommand')[0];
    expect(query.input.filter).toEqual({
      $and: [
        { version: { $eq: 'v3' } },
        { type: { $eq: 'guide' } },
        { subType: { $eq: 'howto' } }
      ]
    });
  });

  it('applies only the version filter when non-filterable filters are supplied', async () => {
    const { store, fake } = makeStore({ QueryVectorsCommand: { vectors: [] } });

    await store.query([0.1, 0.2], {
      version: 'v3',
      filters: { repository: 'core', owner: '63klabs' },
      topK: 10
    });

    const query = commandsOfType(fake, 'QueryVectorsCommand')[0];
    expect(query.input.filter).toEqual({ version: { $eq: 'v3' } });
  });
});

describe('query — bounded nextToken pagination (Req 4.4)', () => {
  it('accumulates results across pages and stops when the token is exhausted', async () => {
    const { store, fake } = makeStore({
      QueryVectorsCommand: pagedHandler([
        { vectors: [{ key: 'v3#a', distance: 0.1, metadata: { hash: 'a' } }], nextToken: 't2' },
        { vectors: [{ key: 'v3#b', distance: 0.2, metadata: { hash: 'b' } }] } // no nextToken → stop
      ])
    });

    const results = await store.query([0.1, 0.2], { version: 'v3', topK: 10 });

    expect(commandsOfType(fake, 'QueryVectorsCommand')).toHaveLength(2);
    expect(results.map((result) => result.hash)).toEqual(['a', 'b']);
    // The second page's request carried the token returned by the first page.
    expect(commandsOfType(fake, 'QueryVectorsCommand')[1].input.nextToken).toBe('t2');
  });

  it('stops paging (and slices) once topK results are collected even if a token remains', async () => {
    const { store, fake } = makeStore({
      QueryVectorsCommand: pagedHandler([
        {
          vectors: [
            { key: 'v3#a', distance: 0.1, metadata: { hash: 'a' } },
            { key: 'v3#b', distance: 0.2, metadata: { hash: 'b' } }
          ],
          nextToken: 'more' // token present, but topK is already satisfied
        }
      ])
    });

    const results = await store.query([0.1, 0.2], { version: 'v3', topK: 2 });

    expect(commandsOfType(fake, 'QueryVectorsCommand')).toHaveLength(1);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.hash)).toEqual(['a', 'b']);
  });

  it('is bounded by the internal page cap when a token never exhausts (no infinite loop)', async () => {
    // Always return a token with zero results so the only stop condition is the page cap.
    const { store, fake } = makeStore({
      QueryVectorsCommand: () => ({ vectors: [], nextToken: 'always' })
    });

    const results = await store.query([0.1, 0.2], { version: 'v3', topK: 10 });

    expect(results).toEqual([]);
    expect(fake.send).toHaveBeenCalledTimes(MAX_QUERY_PAGES);
  });
});

describe('query — empty results', () => {
  it('returns [] when QueryVectors reports no matching vectors', async () => {
    const { store } = makeStore({ QueryVectorsCommand: { vectors: [] } });

    const results = await store.query([0.1, 0.2], { version: 'v3', topK: 10 });

    expect(results).toEqual([]);
  });

  it('returns [] when the response has no vectors field at all', async () => {
    const { store } = makeStore({ QueryVectorsCommand: {} });

    const results = await store.query([0.1, 0.2], { version: 'v3', topK: 10 });

    expect(results).toEqual([]);
  });
});

describe('deleteVersion — ListVectors + DeleteVectors cleanup (Req 4.2)', () => {
  it('deletes only the target version keys, leaving other versions untouched', async () => {
    const { store, fake } = makeStore({
      ListVectorsCommand: {
        vectors: [
          { key: 'v3#a' },
          { key: 'v3#b' },
          { key: 'v2#c' }, // different version → must NOT be deleted
          { key: 'v3#d' }
        ]
      }
    });

    await store.deleteVersion('v3');

    const deletes = commandsOfType(fake, 'DeleteVectorsCommand');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].input.vectorBucketName).toBe(BUCKET);
    expect(deletes[0].input.indexName).toBe(INDEX);
    expect(deletes[0].input.keys).toEqual(['v3#a', 'v3#b', 'v3#d']);
    expect(deletes[0].input.keys).not.toContain('v2#c');
  });

  it('chunks deletions at DELETE_VECTORS_CHUNK_SIZE across many matching keys', async () => {
    const vectors = [];
    for (let i = 0; i < 250; i++) {
      vectors.push({ key: `v3#k${i}` });
    }
    const { store, fake } = makeStore({ ListVectorsCommand: { vectors } });

    await store.deleteVersion('v3');

    const deletes = commandsOfType(fake, 'DeleteVectorsCommand');
    expect(deletes).toHaveLength(3);
    expect(deletes.map((command) => command.input.keys.length)).toEqual([100, 100, 50]);
    for (const command of deletes) {
      expect(command.input.keys.length).toBeLessThanOrEqual(DELETE_VECTORS_CHUNK_SIZE);
    }
  });

  it('does not call DeleteVectors when no keys match the version prefix', async () => {
    const { store, fake } = makeStore({
      ListVectorsCommand: { vectors: [{ key: 'v2#a' }, { key: 'other' }] }
    });

    await store.deleteVersion('v3');

    expect(commandsOfType(fake, 'DeleteVectorsCommand')).toHaveLength(0);
  });
});

describe('error paths (Req 4.2, 4.4)', () => {
  it('query throws INVALID_QUERY for an empty or non-array embedding (before any send)', async () => {
    const { store, fake } = makeStore();

    const emptyError = await captureError(store.query([], { version: 'v3' }));
    expect(emptyError).toBeInstanceOf(VectorStoreError);
    expect(emptyError.code).toBe('INVALID_QUERY');

    const nonArrayError = await captureError(store.query('not-an-array', { version: 'v3' }));
    expect(nonArrayError.code).toBe('INVALID_QUERY');

    expect(fake.send).not.toHaveBeenCalled();
  });

  it('query throws INVALID_ARGUMENT when the version is missing (before any send)', async () => {
    const { store, fake } = makeStore();

    const missingVersion = await captureError(store.query([0.1, 0.2], {}));
    expect(missingVersion).toBeInstanceOf(VectorStoreError);
    expect(missingVersion.code).toBe('INVALID_ARGUMENT');

    const noOptions = await captureError(store.query([0.1, 0.2]));
    expect(noOptions.code).toBe('INVALID_ARGUMENT');

    expect(fake.send).not.toHaveBeenCalled();
  });

  it('query wraps a rejecting client as QUERY_FAILED and preserves the cause', async () => {
    const original = new Error('s3 vectors unavailable');
    const store = new S3VectorStore({
      s3Vectors: { bucket: BUCKET, index: INDEX },
      client: { send: jest.fn().mockRejectedValue(original) }
    });

    const error = await captureError(store.query([0.1, 0.2], { version: 'v3', topK: 5 }));

    expect(error).toBeInstanceOf(VectorStoreError);
    expect(error.code).toBe('QUERY_FAILED');
    expect(error.cause).toBe(original);
  });

  it('upsertVectors wraps a rejecting client as UPSERT_FAILED and preserves the cause', async () => {
    const original = new Error('put throttled');
    const store = new S3VectorStore({
      s3Vectors: { bucket: BUCKET, index: INDEX },
      client: { send: jest.fn().mockRejectedValue(original) }
    });

    const error = await captureError(
      store.upsertVectors('v3', [{ hash: 'a', vector: [0.1, 0.2], metadata: {} }])
    );

    expect(error).toBeInstanceOf(VectorStoreError);
    expect(error.code).toBe('UPSERT_FAILED');
    expect(error.cause).toBe(original);
  });

  it('deleteVersion wraps a rejecting client as DELETE_FAILED and preserves the cause', async () => {
    const original = new Error('list failed');
    const store = new S3VectorStore({
      s3Vectors: { bucket: BUCKET, index: INDEX },
      client: { send: jest.fn().mockRejectedValue(original) }
    });

    const error = await captureError(store.deleteVersion('v3'));

    expect(error).toBeInstanceOf(VectorStoreError);
    expect(error.code).toBe('DELETE_FAILED');
    expect(error.cause).toBe(original);
  });

  it('upsertVectors surfaces validation errors (INVALID_ARGUMENT / INVALID_VECTOR) before any send', async () => {
    const { store, fake } = makeStore();

    const badVersion = await captureError(store.upsertVectors('', [{ hash: 'a', vector: [0.1] }]));
    expect(badVersion.code).toBe('INVALID_ARGUMENT');

    const notArray = await captureError(store.upsertVectors('v3', 'nope'));
    expect(notArray.code).toBe('INVALID_ARGUMENT');

    const nonObjectItem = await captureError(store.upsertVectors('v3', [null]));
    expect(nonObjectItem.code).toBe('INVALID_ARGUMENT');

    const emptyHash = await captureError(store.upsertVectors('v3', [{ hash: '', vector: [0.1] }]));
    expect(emptyHash.code).toBe('INVALID_ARGUMENT');

    const emptyVector = await captureError(store.upsertVectors('v3', [{ hash: 'a', vector: [] }]));
    expect(emptyVector.code).toBe('INVALID_VECTOR');

    const nonFiniteVector = await captureError(store.upsertVectors('v3', [{ hash: 'a', vector: [0.1, NaN] }]));
    expect(nonFiniteVector.code).toBe('INVALID_VECTOR');

    // None of the invalid calls reached S3 Vectors.
    expect(fake.send).not.toHaveBeenCalled();
  });
});

describe('createVectorStore factory integration (Req 4.5 extension point)', () => {
  it('returns an S3VectorStore instance for vectorStore: "s3-vectors"', () => {
    const store = createVectorStore({
      vectorStore: 's3-vectors',
      dimensions: 4,
      s3Vectors: { bucket: BUCKET, index: INDEX }
    });

    expect(store).toBeInstanceOf(S3VectorStore);
    expect(store).toBeInstanceOf(VectorStore);
    expect(store.bucket).toBe(BUCKET);
    expect(store.index).toBe(INDEX);
    expect(store.dimensions).toBe(4);
  });
});
