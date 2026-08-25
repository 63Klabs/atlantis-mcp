/**
 * Unit tests for the `get_document` response contract (spec 0-0-6, task 5.3).
 *
 * These tests exercise the REAL controller, the REAL documentation service, the REAL
 * SchemaValidator, the REAL MCPProtocol formatter, and the REAL JSON-RPC router, so the
 * assertions describe the payload an MCP client actually receives rather than a mock's
 * shape. Only the boundaries are mocked, and every AWS/network boundary is mocked:
 * `@63klabs/cache-data` (CacheableDataAccess/DebugAndLog/ApiRequest), `Config`, and
 * `Models.DocIndex`. `CacheableDataAccess.getData` invokes the cache-miss fetch function
 * directly so the storage resolution path is the one under test.
 *
 * Coverage:
 * - a storage hit returns `filePath`, `githubUrl`, `repository`, `repositoryType`,
 *   `namespace`, and `content` (Requirement 6.9)
 * - a storage miss returns a JSON-RPC error identifying the requested `filePath`/`hash`
 *   and carrying `githubUrl` in the error `data` (Requirement 6.8)
 * - a storage miss with no derivable URL still identifies the request and reports
 *   `githubUrl` as an explicit `null` rather than omitting the field (Requirement 6.8)
 * - no HTTP/GitHub request is made on any path, hit or miss (Requirement 6.8 rationale)
 *
 * Requirements: 6.8, 6.9
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

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
      error: jest.fn(),
      isProduction: jest.fn(() => false)
    },
    // >! config/settings.js constructs one of these at module load for the GitHub token.
    // >! Stubbed so no SSM call is ever made; the token is not read on these paths.
    CachedSsmParameter: class {
      constructor(name) {
        this.name = name;
      }
      async getValue() {
        return 'test-token';
      }
    },
    ApiRequest: {
      // >! `send` is the cache-data HTTP client. It is asserted never-called below: a
      // >! storage miss must be delegated to the client, never fetched by the server.
      send: jest.fn(),
      success: jest.fn(({ body }) => ({
        getBody: (parse) => (parse ? body : JSON.stringify(body)),
        statusCode: 200
      }))
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

// >! Load only the real documentation service behind the services index so requiring the
// >! controller does not pull in unrelated services (and their AWS clients).
jest.mock('../../../services', () => ({
  Documentation: require('../../../services/documentation')
}));

// >! The router builds its dispatch table from the controllers index. Only the
// >! documentation controller is real here; the rest are inert stubs.
jest.mock('../../../controllers', () => ({
  Templates: { list: jest.fn(), get: jest.fn(), getChunk: jest.fn(), listVersions: jest.fn(), listCategories: jest.fn() },
  Starters: { list: jest.fn(), get: jest.fn() },
  Documentation: require('../../../controllers/documentation'),
  Validation: { validate: jest.fn() },
  Updates: { check: jest.fn() },
  Tools: { list: jest.fn() },
  AgentAssets: { list: jest.fn(), get: jest.fn(), listTypes: jest.fn(), getChunk: jest.fn() }
}));

const { cache: { CacheableDataAccess }, tools: { ApiRequest } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const DocumentationController = require('../../../controllers/documentation');
const { handleJsonRpc } = require('../../../utils/json-rpc-router');

const TABLE = 'test-doc-index-table';
const ACTIVE_VERSION = '20250715T060000';
const CONTENT_PATH = '63klabs/cache-data/README.md/installation';
const DOCUMENT_PATH = '63klabs/cache-data/README.md';
const GITHUB_URL = 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md';
const FILE_CONTENT = '# Cache Data\n\n## Installation\n\nnpm install @63klabs/cache-data\n';

/** Fields the success payload must carry (Requirement 6.9, design §5.4). */
const SUCCESS_FIELDS = ['filePath', 'githubUrl', 'repository', 'repositoryType', 'namespace', 'content'];

/**
 * Independently reproduce the indexer's content-path hash (SHA-256, first 16 hex chars) so
 * expected keys are computed here rather than by re-invoking the code under test.
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
  namespace: 'atlantis',
  ...overrides
});

/**
 * Build the connection/cache-profile pair the service expects for `document`/`doc-data`.
 *
 * @returns {{conn: Object, cacheProfile: Object}} Connection and cache profile.
 */
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

/**
 * Wrap a JSON-RPC body in the minimal clientRequest the router needs.
 *
 * @param {Object} body - JSON-RPC request body.
 * @returns {Object} Mock clientRequest.
 */
const makeClientRequest = (body) => {
  const event = { body: JSON.stringify(body) };
  return {
    getEvent: () => event,
    getProps: () => ({ path: 'mcp/v1', method: 'POST' }),
    addQueryLog: jest.fn()
  };
};

/** Invoke the controller's `get_document` with the given tool input. */
const callGetDocument = (input) => DocumentationController.getDocument({
  bodyParameters: { tool: 'get_document', input }
});

describe('get_document response contract (Requirements 6.8, 6.9)', () => {

  let httpSpies;

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

    // Cache miss on every call so the storage resolution path is exercised.
    CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn, conn) => fetchFn(conn, {}));

    // >! Tripwires for the storage-only guarantee: any outbound HTTP attempt fails the test
    // >! loudly rather than silently reaching the network.
    httpSpies = [
      jest.spyOn(https, 'request').mockImplementation(() => {
        throw new Error('unexpected https.request');
      }),
      jest.spyOn(https, 'get').mockImplementation(() => {
        throw new Error('unexpected https.get');
      }),
      jest.spyOn(http, 'request').mockImplementation(() => {
        throw new Error('unexpected http.request');
      }),
      jest.spyOn(http, 'get').mockImplementation(() => {
        throw new Error('unexpected http.get');
      })
    ];
    global.fetch = jest.fn(() => {
      throw new Error('unexpected fetch');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  /** Assert nothing in the exercised path attempted an outbound request. */
  const expectNoOutboundRequests = () => {
    for (const spy of httpSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(global.fetch).not.toHaveBeenCalled();
    expect(ApiRequest.send).not.toHaveBeenCalled();
  };

  describe('storage hit (Requirement 6.9)', () => {

    beforeEach(() => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({
        documentHash: DOCUMENT_HASH,
        githubUrl: GITHUB_URL
      });
      Models.DocIndex.getDocumentByFileHash.mockImplementation(
        async (table, fileHash) => (fileHash === DOCUMENT_HASH ? makeDocumentItem() : null)
      );
    });

    it('should return a success payload carrying githubUrl alongside the content', async () => {
      const response = await callGetDocument({ filePath: CONTENT_PATH });

      expect(response.success).toBe(true);
      expect(response.tool).toBe('get_document');
      expect(response.data.githubUrl).toBe(GITHUB_URL);
      expect(response.data.content).toBe(FILE_CONTENT);
    });

    it('should return all six documented fields and nothing more', async () => {
      const response = await callGetDocument({ filePath: CONTENT_PATH });

      expect(Object.keys(response.data).sort()).toEqual([...SUCCESS_FIELDS].sort());
      expect(response.data).toEqual({
        filePath: DOCUMENT_PATH,
        githubUrl: GITHUB_URL,
        repository: 'cache-data',
        repositoryType: 'package',
        namespace: 'atlantis',
        content: FILE_CONTENT
      });
    });

    it('should carry githubUrl when the lookup key is a hash rather than a filePath', async () => {
      Models.DocIndex.getDocumentByFileHash.mockImplementation(
        async (table, fileHash) => (fileHash === DOCUMENT_HASH ? makeDocumentItem() : null)
      );

      const response = await callGetDocument({ hash: SECTION_HASH });

      expect(response.success).toBe(true);
      expect(response.data.githubUrl).toBe(GITHUB_URL);
    });

    it('should report githubUrl as null rather than omitting it when the index has no URL', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({
        documentHash: DOCUMENT_HASH,
        githubUrl: null
      });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(makeDocumentItem({ githubUrl: null }));

      const response = await callGetDocument({ filePath: CONTENT_PATH });

      expect(response.success).toBe(true);
      expect(Object.hasOwn(response.data, 'githubUrl')).toBe(true);
      expect(response.data.githubUrl).toBeNull();
    });

    it('should serve the hit without any outbound HTTP request', async () => {
      await callGetDocument({ filePath: CONTENT_PATH });

      expectNoOutboundRequests();
    });

    it('should surface the success payload through the JSON-RPC envelope', async () => {
      const response = await handleJsonRpc(makeClientRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'doc-hit-1',
        params: { name: 'get_document', arguments: { filePath: CONTENT_PATH } }
      }));

      const body = JSON.parse(response.body);
      expect(body.error).toBeUndefined();

      const payload = JSON.parse(body.result.content[0].text);
      expect(Object.keys(payload).sort()).toEqual([...SUCCESS_FIELDS].sort());
      expect(payload.githubUrl).toBe(GITHUB_URL);
    });
  });

  describe('storage miss (Requirement 6.8)', () => {

    /** Configure a miss: section metadata resolves, but no document item is stored. */
    const arrangeMiss = ({ githubUrl = GITHUB_URL } = {}) => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue({
        documentHash: DOCUMENT_HASH,
        githubUrl
      });
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(null);
    };

    it('should return a DOCUMENT_NOT_FOUND error identifying the requested filePath', async () => {
      arrangeMiss();

      const response = await callGetDocument({ filePath: CONTENT_PATH });

      expect(response.success).toBe(false);
      expect(response.tool).toBe('get_document');
      expect(response.error.code).toBe('DOCUMENT_NOT_FOUND');
      expect(response.error.details.filePath).toBe(CONTENT_PATH);
      expect(response.error.details.hash).toBeNull();
      expect(response.error.details.message).toContain(CONTENT_PATH);
    });

    it('should carry the derived githubUrl on the miss so the client can fetch it', async () => {
      arrangeMiss();

      const response = await callGetDocument({ filePath: CONTENT_PATH });

      expect(response.error.details.githubUrl).toBe(GITHUB_URL);
    });

    it('should report githubUrl as an explicit null when no URL can be derived', async () => {
      arrangeMiss({ githubUrl: null });

      const response = await callGetDocument({ filePath: CONTENT_PATH });

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('DOCUMENT_NOT_FOUND');
      expect(Object.hasOwn(response.error.details, 'githubUrl')).toBe(true);
      expect(response.error.details.githubUrl).toBeNull();
      // >! The request is still identified even with no URL to hand back (Requirement 6.8).
      expect(response.error.details.filePath).toBe(CONTENT_PATH);
    });

    it('should report a null githubUrl when the section metadata itself is absent', async () => {
      Models.DocIndex.getSectionMetadata.mockResolvedValue(null);
      Models.DocIndex.getDocumentByFileHash.mockResolvedValue(null);

      const response = await callGetDocument({ hash: SECTION_HASH });

      expect(response.error.code).toBe('DOCUMENT_NOT_FOUND');
      expect(response.error.details.hash).toBe(SECTION_HASH);
      expect(response.error.details.filePath).toBeNull();
      expect(response.error.details.githubUrl).toBeNull();
    });

    it('should never fetch from GitHub on a storage miss', async () => {
      arrangeMiss();

      const response = await callGetDocument({ filePath: CONTENT_PATH });

      expect(response.success).toBe(false);
      expectNoOutboundRequests();
    });

    it('should not report the miss as an internal error', async () => {
      arrangeMiss();

      const response = await callGetDocument({ filePath: CONTENT_PATH });

      expect(response.error.code).not.toBe('INTERNAL_ERROR');
    });

    it('should return the same miss error from get_document_chunk', async () => {
      arrangeMiss();

      const response = await DocumentationController.getDocumentChunk({
        bodyParameters: { tool: 'get_document_chunk', input: { filePath: CONTENT_PATH, chunkIndex: 0 } }
      });

      expect(response.success).toBe(false);
      expect(response.tool).toBe('get_document_chunk');
      expect(response.error.code).toBe('DOCUMENT_NOT_FOUND');
      expect(response.error.details.githubUrl).toBe(GITHUB_URL);
      expectNoOutboundRequests();
    });

    describe('JSON-RPC error envelope', () => {

      /** Dispatch get_document through the router and return the parsed JSON-RPC body. */
      const dispatchMiss = async (args) => {
        const response = await handleJsonRpc(makeClientRequest({
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 'doc-miss-1',
          params: { name: 'get_document', arguments: args }
        }));
        return JSON.parse(response.body);
      };

      it('should place githubUrl inside the JSON-RPC error data', async () => {
        arrangeMiss();

        const body = await dispatchMiss({ filePath: CONTENT_PATH });

        expect(body.error).toBeDefined();
        expect(body.error.data).toBeDefined();
        expect(body.error.data.errorCode).toBe('DOCUMENT_NOT_FOUND');
        expect(body.error.data.details.githubUrl).toBe(GITHUB_URL);
        expect(body.error.data.details.filePath).toBe(CONTENT_PATH);
      });

      it('should place a null githubUrl in the error data when none is derivable', async () => {
        arrangeMiss({ githubUrl: null });

        const body = await dispatchMiss({ filePath: CONTENT_PATH });

        expect(body.error.data.errorCode).toBe('DOCUMENT_NOT_FOUND');
        expect(Object.hasOwn(body.error.data.details, 'githubUrl')).toBe(true);
        expect(body.error.data.details.githubUrl).toBeNull();
        expect(body.error.data.details.filePath).toBe(CONTENT_PATH);
      });

      it('should not fetch from GitHub while producing the error envelope', async () => {
        arrangeMiss();

        await dispatchMiss({ filePath: CONTENT_PATH });

        expectNoOutboundRequests();
      });
    });
  });
});
