/**
 * Unit Tests for Documentation Index DAO — get_document storage reads (spec 0-0-6, task 5.1)
 *
 * Covers the two lookups `get_document` resolution is built from:
 *
 * - `getDocumentByFileHash(tableName, fileHash)` reads the version-less
 *   `pk=document:{fileHash}, sk=content` item written once per source file, returns `null` for
 *   a miss, and degrades a read failure to `null` (storage-only: never a GitHub fetch).
 * - `getSectionMetadata(tableName, version, hash)` reads
 *   `pk=content:{hash}, sk=v:{version}:metadata` through the shared batched reader and returns
 *   the `documentHash`/`githubUrl` pointers, normalizing pre-task-1.6 (absent) values to `null`.
 *
 * All AWS I/O is mocked via the setDocClient() injection pattern (mirrors
 * doc-index-content-metadata.test.js). No real DynamoDB calls are made.
 *
 * Requirements: 6.3, 6.4, 6.5
 */

const DocIndex = require('../../../models/doc-index');

jest.mock('../../../config', () => ({
  Config: {
    settings: jest.fn(() => ({
      docIndexTable: 'test-doc-index-table',
      github: { userOrgs: ['63klabs'] }
    }))
  }
}));

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  }
}));

const TABLE = 'test-doc-index-table';

/**
 * Create a mock DynamoDB Document Client that resolves GetCommand/BatchGetCommand against a
 * `{pk}|{sk} -> item` fixture map.
 *
 * @param {Object.<string, Object>} items - Fixture items keyed by `{pk}|{sk}`.
 * @returns {{send: Function}} Mock client.
 */
function createMockClient(items = {}) {
  return {
    send: jest.fn(async (command) => {
      const commandName = command.constructor.name;

      if (commandName === 'GetCommand') {
        const { pk, sk } = command.input.Key;
        const item = items[`${pk}|${sk}`];
        return item ? { Item: { ...item, pk, sk } } : {};
      }

      if (commandName === 'BatchGetCommand') {
        const keys = command.input.RequestItems[TABLE].Keys;
        const resolved = keys
          .map((key) => {
            const item = items[`${key.pk}|${key.sk}`];
            return item ? { ...item, pk: key.pk, sk: key.sk } : null;
          })
          .filter((item) => item !== null);
        return { Responses: { [TABLE]: resolved } };
      }

      return {};
    })
  };
}

describe('Documentation Index DAO — getDocumentByFileHash()', () => {
  afterEach(() => {
    DocIndex.TestHarness.resetClient();
    jest.clearAllMocks();
  });

  it('should read the version-less document:{fileHash}/content key and return the item', async () => {
    const client = createMockClient({
      'document:b1c2d3e4f5a60718|content': {
        documentPath: '63klabs/cache-data/README.md',
        content: '# Cache Data\n\nInstall with npm.\n',
        githubUrl: 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md',
        repository: 'cache-data',
        repositoryType: 'package',
        namespace: null
      }
    });
    DocIndex.setDocClient(client);

    const document = await DocIndex.getDocumentByFileHash(TABLE, 'b1c2d3e4f5a60718');

    expect(document).not.toBeNull();
    expect(document.content).toBe('# Cache Data\n\nInstall with npm.\n');
    expect(document.documentPath).toBe('63klabs/cache-data/README.md');
    expect(client.send).toHaveBeenCalledTimes(1);

    // The key carries no index version — a document is readable without one (R2.4).
    const key = client.send.mock.calls[0][0].input.Key;
    expect(key).toEqual({ pk: 'document:b1c2d3e4f5a60718', sk: 'content' });
    expect(client.send.mock.calls[0][0].input.TableName).toBe(TABLE);
  });

  it('should return null when the document is not stored', async () => {
    const client = createMockClient({});
    DocIndex.setDocClient(client);

    const document = await DocIndex.getDocumentByFileHash(TABLE, 'ffffffffffffffff');

    expect(document).toBeNull();
  });

  it('should degrade a read failure to null rather than throwing', async () => {
    const client = {
      send: jest.fn(async () => {
        throw new Error('DynamoDB read failed');
      })
    };
    DocIndex.setDocClient(client);

    await expect(DocIndex.getDocumentByFileHash(TABLE, 'b1c2d3e4f5a60718')).resolves.toBeNull();
  });

  it('should return null without reading for a missing table or hash', async () => {
    const client = createMockClient({});
    DocIndex.setDocClient(client);

    await expect(DocIndex.getDocumentByFileHash(null, 'b1c2d3e4f5a60718')).resolves.toBeNull();
    await expect(DocIndex.getDocumentByFileHash(TABLE, '')).resolves.toBeNull();
    await expect(DocIndex.getDocumentByFileHash(TABLE, undefined)).resolves.toBeNull();
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe('Documentation Index DAO — getSectionMetadata()', () => {
  afterEach(() => {
    DocIndex.TestHarness.resetClient();
    jest.clearAllMocks();
  });

  it('should return the documentHash/githubUrl pointers for a stored section', async () => {
    const client = createMockClient({
      'content:ea6f1a2b3c4d5e6f|v:20250715T060000:metadata': {
        title: 'Installation',
        path: '63klabs/cache-data/README.md/installation',
        documentHash: 'b1c2d3e4f5a60718',
        githubUrl: 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md'
      }
    });
    DocIndex.setDocClient(client);

    const pointers = await DocIndex.getSectionMetadata(TABLE, '20250715T060000', 'ea6f1a2b3c4d5e6f');

    expect(pointers).toEqual({
      documentHash: 'b1c2d3e4f5a60718',
      githubUrl: 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md'
    });

    // Reuses the shared batched reader, so exactly one request against the metadata key.
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.send.mock.calls[0][0].input.RequestItems[TABLE].Keys).toEqual([
      { pk: 'content:ea6f1a2b3c4d5e6f', sk: 'v:20250715T060000:metadata' }
    ]);
  });

  it('should normalize absent pointers (indexed before task 1.6) to null', async () => {
    const client = createMockClient({
      'content:legacyhash0000ab|v:v3:metadata': {
        title: 'Legacy section',
        path: '63klabs/cache-data/README.md/legacy'
      }
    });
    DocIndex.setDocClient(client);

    const pointers = await DocIndex.getSectionMetadata(TABLE, 'v3', 'legacyhash0000ab');

    expect(pointers).toEqual({ documentHash: null, githubUrl: null });
  });

  it('should return null when the section metadata item does not exist', async () => {
    const client = createMockClient({});
    DocIndex.setDocClient(client);

    const pointers = await DocIndex.getSectionMetadata(TABLE, 'v3', 'missinghash00000');

    expect(pointers).toBeNull();
  });

  it('should return null without reading for missing table, version, or hash', async () => {
    const client = createMockClient({});
    DocIndex.setDocClient(client);

    await expect(DocIndex.getSectionMetadata(null, 'v3', 'h1')).resolves.toBeNull();
    await expect(DocIndex.getSectionMetadata(TABLE, null, 'h1')).resolves.toBeNull();
    await expect(DocIndex.getSectionMetadata(TABLE, 'v3', '')).resolves.toBeNull();
    expect(client.send).not.toHaveBeenCalled();
  });
});
