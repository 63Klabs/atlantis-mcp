/**
 * Unit tests for Documentation Controller - lookup key validation
 *
 * Tests the exactly-one-of constraint for `filePath`/`hash` in `getDocument()` and
 * `getDocumentChunk()`. The MCP protocol does not support `oneOf` at the schema root
 * level (see spec 0-0-6-fix-mcp-schema-oneof), so the controller enforces this
 * constraint programmatically via `validateLookupKey()`.
 *
 * Coverage:
 * - getDocument with filePath only → calls service (success path)
 * - getDocument with hash only → calls service (success path)
 * - getDocument with neither → INVALID_INPUT "Exactly one of filePath or hash is required"
 * - getDocument with both → INVALID_INPUT "Cannot specify both filePath and hash"
 * - getDocumentChunk with filePath + chunkIndex → calls service (success path)
 * - getDocumentChunk with hash + chunkIndex → calls service (success path)
 * - getDocumentChunk with neither filePath nor hash → INVALID_INPUT
 * - getDocumentChunk with both filePath and hash → INVALID_INPUT
 *
 * Requirements: 6.6, 6.7 (schema compliance aspect)
 */

// Mock dependencies before requiring controller
jest.mock('../../../services', () => ({
  Documentation: {
    getDocument: jest.fn(),
    search: jest.fn()
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
const { cache: { CacheableDataAccess }, tools } = require('@63klabs/cache-data');
const { Config } = require('../../../config');

const FILE_PATH = '63klabs/cache-data/README.md/installation';
const HASH = 'ea6f1a2b3c4d5e6f';
const GITHUB_URL = 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md';

/**
 * Minimal `get_document` success payload returned by the mocked service.
 */
const MOCK_DOCUMENT = {
  filePath: '63klabs/cache-data/README.md',
  githubUrl: GITHUB_URL,
  repository: 'cache-data',
  repositoryType: 'package',
  namespace: null,
  content: '# Cache Data\n\n## Installation\n'
};

describe('Documentation Controller - lookup key validation', () => {

  beforeEach(() => {
    jest.clearAllMocks();

    // >! Schema validation always passes unless a test overrides it
    SchemaValidator.validate.mockReturnValue({ valid: true });

    // >! Default service mock for getDocument success path
    Services.Documentation.getDocument.mockResolvedValue(MOCK_DOCUMENT);

    // >! Default connection/cache profile for getDocumentChunk
    Config.getConnCacheProfile.mockReturnValue({
      conn: { host: 'internal', path: '/document-chunks', parameters: {} },
      cacheProfile: { hostId: 'document-chunks', pathId: 'data' }
    });

    // >! CacheableDataAccess.getData simulates a cache miss: invoke the fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
      const result = await fetchFn(conn, opts);
      return {
        getBody: (parse) => (parse ? JSON.parse(result.body) : result.body)
      };
    });
  });

  // ---------------------------------------------------------------------------
  // getDocument
  // ---------------------------------------------------------------------------

  describe('getDocument() - lookup key validation', () => {

    test('filePath only → calls service and returns success', async () => {
      const result = await DocumentationController.getDocument({
        bodyParameters: { input: { filePath: FILE_PATH } }
      });

      expect(Services.Documentation.getDocument).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: FILE_PATH, hash: undefined })
      );
      expect(MCPProtocol.errorResponse).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('hash only → calls service and returns success', async () => {
      const result = await DocumentationController.getDocument({
        bodyParameters: { input: { hash: HASH } }
      });

      expect(Services.Documentation.getDocument).toHaveBeenCalledWith(
        expect.objectContaining({ hash: HASH, filePath: undefined })
      );
      expect(MCPProtocol.errorResponse).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('neither filePath nor hash → returns INVALID_INPUT with correct message', async () => {
      const result = await DocumentationController.getDocument({
        bodyParameters: { input: {} }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Exactly one of filePath or hash is required',
          errors: expect.arrayContaining(['Exactly one of filePath or hash is required'])
        }),
        'get_document'
      );
      expect(Services.Documentation.getDocument).not.toHaveBeenCalled();
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    });

    test('both filePath and hash → returns INVALID_INPUT with correct message', async () => {
      const result = await DocumentationController.getDocument({
        bodyParameters: { input: { filePath: FILE_PATH, hash: HASH } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Cannot specify both filePath and hash - provide exactly one',
          errors: expect.arrayContaining(['Cannot specify both filePath and hash - provide exactly one'])
        }),
        'get_document'
      );
      expect(Services.Documentation.getDocument).not.toHaveBeenCalled();
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    });

    test('empty string filePath with no hash → treated as missing and returns INVALID_INPUT', async () => {
      const result = await DocumentationController.getDocument({
        bodyParameters: { input: { filePath: '' } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Exactly one of filePath or hash is required'
        }),
        'get_document'
      );
      expect(Services.Documentation.getDocument).not.toHaveBeenCalled();
    });

    test('empty string hash with no filePath → treated as missing and returns INVALID_INPUT', async () => {
      const result = await DocumentationController.getDocument({
        bodyParameters: { input: { hash: '' } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Exactly one of filePath or hash is required'
        }),
        'get_document'
      );
      expect(Services.Documentation.getDocument).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getDocumentChunk
  // ---------------------------------------------------------------------------

  describe('getDocumentChunk() - lookup key validation', () => {

    test('filePath + chunkIndex → calls service and returns success', async () => {
      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { filePath: FILE_PATH, chunkIndex: 0 } }
      });

      expect(Services.Documentation.getDocument).toHaveBeenCalled();
      expect(MCPProtocol.errorResponse).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('hash + chunkIndex → calls service and returns success', async () => {
      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { hash: HASH, chunkIndex: 0 } }
      });

      expect(Services.Documentation.getDocument).toHaveBeenCalled();
      expect(MCPProtocol.errorResponse).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    test('neither filePath nor hash → returns INVALID_INPUT with correct message', async () => {
      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { chunkIndex: 0 } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Exactly one of filePath or hash is required',
          errors: expect.arrayContaining(['Exactly one of filePath or hash is required'])
        }),
        'get_document_chunk'
      );
      expect(Services.Documentation.getDocument).not.toHaveBeenCalled();
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    });

    test('both filePath and hash → returns INVALID_INPUT with correct message', async () => {
      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { filePath: FILE_PATH, hash: HASH, chunkIndex: 0 } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Cannot specify both filePath and hash - provide exactly one',
          errors: expect.arrayContaining(['Cannot specify both filePath and hash - provide exactly one'])
        }),
        'get_document_chunk'
      );
      expect(Services.Documentation.getDocument).not.toHaveBeenCalled();
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    });

    test('empty string filePath with no hash → treated as missing and returns INVALID_INPUT', async () => {
      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { filePath: '', chunkIndex: 0 } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Exactly one of filePath or hash is required'
        }),
        'get_document_chunk'
      );
      expect(Services.Documentation.getDocument).not.toHaveBeenCalled();
    });

    test('empty string hash with no filePath → treated as missing and returns INVALID_INPUT', async () => {
      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { hash: '', chunkIndex: 0 } }
      });

      expect(result.success).toBe(false);
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Exactly one of filePath or hash is required'
        }),
        'get_document_chunk'
      );
      expect(Services.Documentation.getDocument).not.toHaveBeenCalled();
    });

    test('lookup key validation runs before connection profile lookup', async () => {
      const result = await DocumentationController.getDocumentChunk({
        bodyParameters: { input: { chunkIndex: 0 } }
      });

      expect(result.success).toBe(false);
      // >! Connection lookup must not be attempted when lookup key is invalid
      expect(Config.getConnCacheProfile).not.toHaveBeenCalled();
      expect(CacheableDataAccess.getData).not.toHaveBeenCalled();
    });
  });
});
