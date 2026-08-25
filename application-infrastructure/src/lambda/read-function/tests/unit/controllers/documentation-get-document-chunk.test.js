/**
 * Unit tests for Documentation Controller - getDocumentChunk() (spec 0-0-6, task 5.4)
 *
 * Mirrors the `templates-get-chunk.test.js` mocking convention for
 * `controllers/templates.js` `getChunk()`: `Services.Documentation.getDocument`,
 * `CacheableDataAccess.getData`, `Config.getConnCacheProfile`, `SchemaValidator`, and
 * `MCPProtocol` are mocked, while `utils/content-chunker.js` is left UNMOCKED so the real
 * `ContentChunker.chunk()`/round-trip behavior is exercised end-to-end through the
 * controller.
 *
 * Coverage:
 * - uses the `document-chunks`/`doc-chunk-data` connection/cache profile
 * - chunk round-trip: concatenating every valid chunkIndex reconstructs the full
 *   `JSON.stringify(document)` payload
 * - out-of-range chunkIndex (negative and >= totalChunks) returns INVALID_CHUNK_INDEX
 * - DOCUMENT_NOT_FOUND propagates from the re-resolved `Services.Documentation.getDocument`
 *
 * Requirements: 6.7
 */

// Mock dependencies before requiring controller
jest.mock('../../../services', () => ({
  Documentation: {
    getDocument: jest.fn()
  }
}));

jest.mock('../../../utils/schema-validator', () => ({
  validate: jest.fn()
}));

jest.mock('../../../utils/mcp-protocol', () => ({
  successResponse: jest.fn((tool, data) => ({ success: true, tool, data })),
  errorResponse: jest.fn((code, details, tool) => ({ success: false, code, details, tool }))
}));

jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    ApiRequest: {
      success: jest.fn(({ body }) => ({ statusCode: 200, body: JSON.stringify(body) })),
      error: jest.fn(({ body }) => ({ statusCode: 400, body: JSON.stringify(body) }))
    }
  }
}));

jest.mock('../../../config', () => ({
  Config: {
    getConnCacheProfile: jest.fn(),
    settings: jest.fn()
  }
}));

const DocumentationController = require('../../../controllers/documentation');
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
// >! Real ContentChunker (unmocked) so chunk boundaries/round-trip are the real thing.
const ContentChunker = require('../../../utils/content-chunker');
const { cache: { CacheableDataAccess }, tools } = require('@63klabs/cache-data');
const { Config } = require('../../../config');

const CONTENT_PATH = '63klabs/cache-data/README.md/installation';
const DOCUMENT_PATH = '63klabs/cache-data/README.md';
const GITHUB_URL = 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md';

/**
 * Build a `get_document`-shaped success payload of a given approximate size, using
 * repeated lines so the small `CHUNK_SIZE` below forces multiple chunks.
 *
 * @param {number} lineCount - Number of content lines to generate.
 * @returns {Object} A `get_document` success payload.
 */
const makeDocument = (lineCount) => ({
  filePath: DOCUMENT_PATH,
  githubUrl: GITHUB_URL,
  repository: 'cache-data',
  repositoryType: 'package',
  namespace: null,
  content: Array.from({ length: lineCount }, (_, i) => `line ${i} of the source file body`).join('\n')
});

describe('Documentation Controller - getDocumentChunk()', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // >! Default mock for Config.getConnCacheProfile — mirrors the document-chunks entry
    Config.getConnCacheProfile.mockReturnValue({
      conn: { host: 'internal', path: '/document-chunks', parameters: {} },
      cacheProfile: { hostId: 'document-chunks', pathId: 'data' }
    });

    // >! CacheableDataAccess.getData simulates a cache miss and invokes the fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
      const result = await fetchFn(conn, opts);
      return {
        getBody: (parse) => (parse ? JSON.parse(result.body) : result.body)
      };
    });
  });

  test('uses the document-chunks/doc-chunk-data connection and cache profile', async () => {
    SchemaValidator.validate.mockReturnValue({ valid: true });
    Services.Documentation.getDocument.mockResolvedValue(makeDocument(1));

    await DocumentationController.getDocumentChunk({
      bodyParameters: { input: { filePath: CONTENT_PATH, chunkIndex: 0 } }
    });

    expect(Config.getConnCacheProfile).toHaveBeenCalledWith('document-chunks', 'doc-chunk-data');
    expect(CacheableDataAccess.getData).toHaveBeenCalled();
  });

  describe('chunk round-trip (Requirement 6.7)', () => {
    test('concatenating every valid chunkIndex reconstructs the full serialized document', async () => {
      SchemaValidator.validate.mockReturnValue({ valid: true });
      // >! Large enough to exceed the default 40000-byte chunk size and force multiple chunks
      const document = makeDocument(2000);
      Services.Documentation.getDocument.mockResolvedValue(document);

      const serialized = JSON.stringify(document);
      // >! Ground truth from the REAL chunker, not a synthetic stand-in
      const expectedChunks = ContentChunker.chunk(serialized);
      const totalChunks = expectedChunks.length;
      expect(totalChunks).toBeGreaterThan(1);

      const collected = [];
      for (let i = 0; i < totalChunks; i++) {
        const result = await DocumentationController.getDocumentChunk({
          bodyParameters: { input: { filePath: CONTENT_PATH, chunkIndex: i } }
        });

        expect(result.success).toBe(true);
        expect(result.data.totalChunks).toBe(totalChunks);
        expect(result.data.chunkIndex).toBe(i);
        expect(result.data.filePath).toBe(DOCUMENT_PATH);
        collected.push(result.data.content);
      }

      // >! Round-trip guarantee: the serialized `get_document` payload is a single JSON
      // >! line (its real newlines are escaped to the two literal characters `\n` by
      // >! JSON.stringify), so ContentChunker.chunk falls back to its byte-boundary split
      // >! path for this one oversized "line" and direct concatenation (not '\n'-joining)
      // >! reconstructs it, per the documented byte-boundary round-trip guarantee in
      // >! utils/content-chunker.js.
      expect(collected.join('')).toBe(serialized);
    });

    test('retrieves the first chunk successfully for a small document', async () => {
      SchemaValidator.validate.mockReturnValue({ valid: true });
      const document = makeDocument(1);
      Services.Documentation.getDocument.mockResolvedValue(document);

      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { hash: 'ea6f1a2b3c4d5e6f', chunkIndex: 0 } }
      });

      expect(result.success).toBe(true);
      expect(result.data.chunkIndex).toBe(0);
      expect(result.data.totalChunks).toBe(1);
      expect(result.data.content).toBe(JSON.stringify(document));
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('get_document_chunk', result.data);
    });
  });

  describe('out-of-range chunkIndex (Requirement 6.7)', () => {
    test('returns INVALID_CHUNK_INDEX for a negative chunkIndex', async () => {
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Documentation.getDocument.mockResolvedValue(makeDocument(50));

      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { filePath: CONTENT_PATH, chunkIndex: -1 } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_CHUNK_INDEX',
        expect.objectContaining({
          message: expect.stringContaining('-1'),
          validRange: expect.objectContaining({ min: 0 })
        }),
        'get_document_chunk'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    });

    test('returns INVALID_CHUNK_INDEX for chunkIndex >= totalChunks', async () => {
      SchemaValidator.validate.mockReturnValue({ valid: true });
      const document = makeDocument(50);
      Services.Documentation.getDocument.mockResolvedValue(document);

      const totalChunks = ContentChunker.chunk(JSON.stringify(document)).length;

      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { filePath: CONTENT_PATH, chunkIndex: totalChunks } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_CHUNK_INDEX',
        expect.objectContaining({
          message: `chunkIndex ${totalChunks} is out of range. Valid range: 0-${totalChunks - 1}`,
          validRange: { min: 0, max: totalChunks - 1 }
        }),
        'get_document_chunk'
      );
    });
  });

  describe('error handling', () => {
    test('returns INVALID_INPUT for schema validation failure', async () => {
      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'chunkIndex', message: 'Required field missing' }]
      });

      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { filePath: CONTENT_PATH } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({ message: 'Input validation failed' }),
        'get_document_chunk'
      );
      expect(Services.Documentation.getDocument).not.toHaveBeenCalled();
    });

    test('propagates DOCUMENT_NOT_FOUND when the re-resolved document is missing', async () => {
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const notFoundError = new Error('Document not found in storage: ' + CONTENT_PATH);
      notFoundError.code = 'DOCUMENT_NOT_FOUND';
      notFoundError.filePath = CONTENT_PATH;
      notFoundError.hash = null;
      notFoundError.githubUrl = GITHUB_URL;
      Services.Documentation.getDocument.mockRejectedValue(notFoundError);

      // >! CacheableDataAccess propagates thrown errors from the fetch function
      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
        return fetchFn(conn, opts);
      });

      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { filePath: CONTENT_PATH, chunkIndex: 0 } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'DOCUMENT_NOT_FOUND',
        expect.objectContaining({ githubUrl: GITHUB_URL, filePath: CONTENT_PATH }),
        'get_document_chunk'
      );
    });

    test('returns INTERNAL_ERROR when the service throws a generic error', async () => {
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Documentation.getDocument.mockRejectedValue(new Error('DynamoDB timeout'));

      CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
        return fetchFn(conn, opts);
      });

      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { filePath: CONTENT_PATH, chunkIndex: 0 } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({ message: 'Failed to retrieve document chunk', error: 'DynamoDB timeout' }),
        'get_document_chunk'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });
  });
});
