/**
 * Unit tests for Documentation.getDocument() — storage-only document retrieval
 * (spec 0-0-6, task 5.1).
 *
 * All AWS I/O is mocked: `@63klabs/cache-data` (CacheableDataAccess/DebugAndLog/ApiRequest),
 * `Config`, and `Models.DocIndex` are jest mocks, and `CacheableDataAccess.getData` invokes
 * the cache-miss fetch function directly so the resolution sequence is observable.
 *
 * Coverage:
 * - resolution by `filePath` (contentPath is hashed the same way the indexer hashed it)
 * - resolution by `hash` (supplied section hash is used directly, contentPath not required)
 * - storage hit returns the stored source file plus its file-level metadata/githubUrl
 * - strip-slug fallback resolves the document when the section metadata item is missing
 * - the caller never triggers a GitHub fetch; a storage miss surfaces DOCUMENT_NOT_FOUND
 *   carrying the derived githubUrl, and is not cached
 * - the active index version is resolved server-side, never supplied by the caller
 *
 * Requirements: 6.3, 6.4, 6.5, 6.6
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const crypto = require('crypto');

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
    getContentMetadataByHashes: jest.fn(),
    getSectionMetadata: jest.fn(),
    getDocumentByFileHash: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const Documentation = require('../../../services/documentation');

const TABLE = 'test-doc-index-table';
const ACTIVE_VERSION = '20250715T060000';
const CONTENT_PATH = '63klabs/cache-data/README.md/installation';
const DOCUMENT_PATH = '63klabs/cache-data/README.md';
const GITHUB_URL = 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md';
const FILE_CONTENT = '# Cache Data\n\n## Installation\n\nnpm install @63klabs/cache-data\n';

/**
 * Independently reproduce the indexer's content-path hash (SHA-256, first 16 hex chars) so the
 * expected DynamoDB keys are computed in the test rather than by re-invoking the code
 * under test.
 *
 * @param {string} contentPath - Content path to hash.
 * @returns {string} 16-character lowercase hex hash.
 */
const expectedHash = (contentPath) => crypto
  .createHash('sha256')
  .update(contentPath)
  .digest('hex')
  .substring(0, 16);

const SECTION_HASH = expectedHash(CONTENT_PATH);
const DOCUMENT_HASH = expectedHash(DOCUMENT_PATH);

/**
 * Build a stored `document:{fileHash}/content` item.
 *
 * @param {Object} [overrides] - Attribute overrides.
 * @returns {Object} Document item.
 */
const makeDocumentItem = (overrides = {}) => ({
  documentPath: DOCUMENT_PATH,
  content: FILE_CONTENT,
  githubUrl: GITHUB_URL,
  repository: 'cache-data',
  repositoryType: 'package',
  namespace: null,
  ...overrides
});

const createMockConnCacheProfile = () => ({
  conn: { name: 'document', host: 'internal', path: '/document', parameters: {}, cache: [] },
  cacheProfile: {
    profile: 'doc-data',
    overrideOriginHeaderExpiration: true,
    defaultExpirationInSeconds: 86400,
    expirationIsOnInterval: false,
    headersToRetain: '',
    hostId: 'document',
    pathId: 'data',
    encrypt: false
  }
});

describe('Documentation.getDocument() — storage-only retrieval', () => {

  beforeEach(() => {
    jest.clearAllMocks();

    Config.settings.mockReturnValue({
      github: { userOrgs: ['63klabs'] },
      docIndexTable: TABLE,
      documentation: {
        ai: { enabled: false, minTier: 'paid', retrievalMode: 'semantic' }
      }
    });
    Config.getConnCacheProfile.mockImplementation(() => createMockConnCacheProfile());
    Models.DocIndex.getActiveVersion.mockResolvedValue(ACTIVE_VERSION);

    // Cache miss on every call so the resolution sequence is exercised.
    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn, conn) => fetchFn(conn, {}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('input validation', () => {
    it('should throw when neither filePath nor hash is supplied', async () => {
      await expect(Documentation.getDocument({})).rejects.toThrow('requires either filePath or hash');
      expect(CacheableDataAccess.getData).not.toHaveBeenCalled();
    });

    it('should throw for blank filePath and hash values', async () => {
      await expect(Documentation.getDocument({ filePath: '   ', hash: '' }))
        .rejects.toThrow('requires either filePath or hash');
      expect(Models.DocIndex.getDocumentByFileHash).not.toHaveBeenCalled();
    });
  });

  describe('resolution by filePath (Req 6.4)', () => {
    it('should hash the contentPath, read that section metadata, then read the document', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({
        documentHash: DOCUMENT_HASH,
        githubUrl: GITHUB_URL
      });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(makeDocumentItem());

      const result = await Documentation.getDocument({ filePath: CONTENT_PATH });

      // Section hash is derived from the contentPath exactly as the indexer derived it.
      expect(Models.DocIndex.getSectionMetadata).toHaveBeenCalledWith(TABLE, ACTIVE_VERSION, SECTION_HASH);
      // The documentHash pointer from metadata is used for the document read.
      expect(Models.DocIndex.getDocumentByFileHash).toHaveBeenCalledTimes(1);
      expect(Models.DocIndex.getDocumentByFileHash).toHaveBeenCalledWith(TABLE, DOCUMENT_HASH);

      expect(result.content).toBe(FILE_CONTENT);
      expect(result.filePath).toBe(DOCUMENT_PATH);
    });

    it('should resolve the active index version server-side rather than from the caller', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({ documentHash: DOCUMENT_HASH, githubUrl: null });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(makeDocumentItem());

      await Documentation.getDocument({ filePath: CONTENT_PATH });

      expect(Models.DocIndex.getActiveVersion).toHaveBeenCalledWith(TABLE);
      // The document key itself is version-less.
      expect(Models.DocIndex.getDocumentByFileHash).toHaveBeenCalledWith(TABLE, DOCUMENT_HASH);
    });
  });

  describe('resolution by hash (Req 6.4)', () => {
    it('should use a supplied section hash directly, with no contentPath', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({
        documentHash: DOCUMENT_HASH,
        githubUrl: GITHUB_URL
      });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(makeDocumentItem());

      const result = await Documentation.getDocument({ hash: SECTION_HASH });

      expect(Models.DocIndex.getSectionMetadata).toHaveBeenCalledWith(TABLE, ACTIVE_VERSION, SECTION_HASH);
      expect(Models.DocIndex.getDocumentByFileHash).toHaveBeenCalledWith(TABLE, DOCUMENT_HASH);
      expect(result.content).toBe(FILE_CONTENT);
    });

    it('should fall back to treating the supplied hash as a document hash', async () => {
      // No section metadata (e.g. the caller passed a document-level hash), so the only
      // remaining candidate is the supplied hash itself.
      Models.DocIndex.getSectionMetadata.mockResolvedValue(null);
      Models.DocIndex.getDocumentByFileHash.mockImplementation(
        async (table, fileHash) => (fileHash === DOCUMENT_HASH ? makeDocumentItem() : null)
      );

      const result = await Documentation.getDocument({ hash: DOCUMENT_HASH });

      expect(Models.DocIndex.getDocumentByFileHash).toHaveBeenCalledWith(TABLE, DOCUMENT_HASH);
      expect(result.content).toBe(FILE_CONTENT);
    });
  });

  describe('storage hit payload (Req 6.5, 6.9)', () => {
    it('should return the stored source file with its file-level metadata', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({
        documentHash: DOCUMENT_HASH,
        githubUrl: GITHUB_URL
      });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(makeDocumentItem({
        namespace: 'atlantis'
      }));

      const result = await Documentation.getDocument({ filePath: CONTENT_PATH });

      expect(result).toEqual({
        filePath: DOCUMENT_PATH,
        githubUrl: GITHUB_URL,
        repository: 'cache-data',
        repositoryType: 'package',
        namespace: 'atlantis',
        content: FILE_CONTENT
      });
    });

    it('should use the document item githubUrl when the section metadata has none', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({ documentHash: DOCUMENT_HASH, githubUrl: null });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(makeDocumentItem());

      const result = await Documentation.getDocument({ filePath: CONTENT_PATH });

      expect(result.githubUrl).toBe(GITHUB_URL);
    });

    it('should normalize absent file-level attributes to null', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({ documentHash: DOCUMENT_HASH, githubUrl: null });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue({
        documentPath: DOCUMENT_PATH,
        content: FILE_CONTENT
      });

      const result = await Documentation.getDocument({ filePath: CONTENT_PATH });

      expect(result.githubUrl).toBeNull();
      expect(result.repository).toBeNull();
      expect(result.repositoryType).toBeNull();
      expect(result.namespace).toBeNull();
    });

    it('should work with the AI feature disabled and read no vector/AI source (Req 6.6)', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({ documentHash: DOCUMENT_HASH, githubUrl: GITHUB_URL });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(makeDocumentItem());

      const result = await Documentation.getDocument({ filePath: CONTENT_PATH, authInfo: { tier: 'public' } });

      expect(result.content).toBe(FILE_CONTENT);
      // Retrieval touches only the documentation index — no search/metadata enrichment path.
      expect(Models.DocIndex.queryIndex).not.toHaveBeenCalled();
      expect(Models.DocIndex.getContentMetadataByHashes).not.toHaveBeenCalled();
    });
  });

  describe('strip-slug fallback', () => {
    it('should resolve the document by stripping the trailing slug when section metadata is missing', async () => {
      // Section metadata absent (indexed before documentHash was written, or expired).
      Models.DocIndex.getSectionMetadata.mockResolvedValue(null);
      Models.DocIndex.getDocumentByFileHash.mockImplementation(
        async (table, fileHash) => (fileHash === DOCUMENT_HASH ? makeDocumentItem() : null)
      );

      const result = await Documentation.getDocument({ filePath: CONTENT_PATH });

      // First (and only) candidate is hash(contentPath minus the trailing /{slug}).
      expect(Models.DocIndex.getDocumentByFileHash).toHaveBeenNthCalledWith(1, TABLE, DOCUMENT_HASH);
      expect(result.content).toBe(FILE_CONTENT);
      expect(result.filePath).toBe(DOCUMENT_PATH);
    });

    it('should try the strip-slug hash when the metadata documentHash is null', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({ documentHash: null, githubUrl: GITHUB_URL });
      Models.DocIndex.getDocumentByFileHash.mockImplementation(
        async (table, fileHash) => (fileHash === DOCUMENT_HASH ? makeDocumentItem() : null)
      );

      const result = await Documentation.getDocument({ filePath: CONTENT_PATH });

      expect(Models.DocIndex.getDocumentByFileHash).toHaveBeenCalledWith(TABLE, DOCUMENT_HASH);
      expect(result.githubUrl).toBe(GITHUB_URL);
    });

    it('should resolve when the caller supplies a document path with no slug to strip', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue(null);
      Models.DocIndex.getDocumentByFileHash.mockImplementation(
        async (table, fileHash) => (fileHash === DOCUMENT_HASH ? makeDocumentItem() : null)
      );

      const result = await Documentation.getDocument({ filePath: DOCUMENT_PATH });

      expect(Models.DocIndex.getDocumentByFileHash).toHaveBeenCalledWith(TABLE, DOCUMENT_HASH);
      expect(result.content).toBe(FILE_CONTENT);
    });

    it('should still resolve from the version-less document key when there is no active version', async () => {
      // No active version pointer: the section metadata read is skipped entirely, but the
      // version-less document key can still be derived from the contentPath.
      Models.DocIndex.getActiveVersion.mockResolvedValue(null);
      Models.DocIndex.getDocumentByFileHash.mockImplementation(
        async (table, fileHash) => (fileHash === DOCUMENT_HASH ? makeDocumentItem() : null)
      );

      const result = await Documentation.getDocument({ filePath: CONTENT_PATH });

      expect(Models.DocIndex.getSectionMetadata).not.toHaveBeenCalled();
      expect(result.content).toBe(FILE_CONTENT);
    });
  });

  describe('storage miss (Req 6.5, 6.8)', () => {
    it('should throw DOCUMENT_NOT_FOUND carrying the derived githubUrl, never fetching GitHub', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({ documentHash: DOCUMENT_HASH, githubUrl: GITHUB_URL });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(null);

      await expect(Documentation.getDocument({ filePath: CONTENT_PATH })).rejects.toMatchObject({
        code: 'DOCUMENT_NOT_FOUND',
        filePath: CONTENT_PATH,
        hash: null,
        githubUrl: GITHUB_URL
      });
    });

    it('should report a null githubUrl when none can be derived', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue(null);
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(null);

      await expect(Documentation.getDocument({ hash: SECTION_HASH })).rejects.toMatchObject({
        code: 'DOCUMENT_NOT_FOUND',
        filePath: null,
        hash: SECTION_HASH,
        githubUrl: null
      });
    });

    it('should exhaust the candidate hashes before declaring a miss', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({ documentHash: 'aaaaaaaaaaaaaaaa', githubUrl: null });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(null);

      await expect(Documentation.getDocument({ filePath: CONTENT_PATH })).rejects.toMatchObject({
        code: 'DOCUMENT_NOT_FOUND'
      });

      const triedHashes = Models.DocIndex.getDocumentByFileHash.mock.calls.map(([, fileHash]) => fileHash);
      expect(triedHashes).toEqual(['aaaaaaaaaaaaaaaa', DOCUMENT_HASH, SECTION_HASH]);
    });
  });

  describe('caching', () => {
    it('should retrieve through the document/doc-data cache profile keyed on filePath and hash', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({ documentHash: DOCUMENT_HASH, githubUrl: GITHUB_URL });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(makeDocumentItem());

      await Documentation.getDocument({ filePath: CONTENT_PATH });

      expect(Config.getConnCacheProfile).toHaveBeenCalledWith('document', 'doc-data');
      expect(CacheableDataAccess.getData).toHaveBeenCalledTimes(1);

      const [, , conn] = CacheableDataAccess.getData.mock.calls[0];
      expect(conn.parameters.filePath).toBe(CONTENT_PATH);
      expect(conn.parameters.hash).toBeUndefined();
    });

    it('should serve a cached document without re-reading storage', async () => {
      const cachedBody = {
        filePath: DOCUMENT_PATH,
        githubUrl: GITHUB_URL,
        repository: 'cache-data',
        repositoryType: 'package',
        namespace: null,
        content: FILE_CONTENT
      };
      CacheableDataAccess.getData.mockResolvedValue({ getBody: () => cachedBody });

      const result = await Documentation.getDocument({ filePath: CONTENT_PATH });

      expect(result).toEqual(cachedBody);
      expect(Models.DocIndex.getDocumentByFileHash).not.toHaveBeenCalled();
      expect(Models.DocIndex.getSectionMetadata).not.toHaveBeenCalled();
    });

    it('should throw (not return) on a miss so the miss is not cached', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue(null);
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(null);

      // The fetch function rejects, so CacheableDataAccess has no successful body to store.
      const { ApiRequest } = require('@63klabs/cache-data').tools;
      await expect(Documentation.getDocument({ filePath: CONTENT_PATH })).rejects.toThrow('Document not found in storage');
      expect(ApiRequest.success).not.toHaveBeenCalled();
    });
  });
});
