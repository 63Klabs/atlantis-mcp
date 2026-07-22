/**
 * Unit tests for Templates Controller - getChunk() caching integration
 *
 * Tests the caching integration aspects of the getChunk controller:
 * - Cache hit path: CacheableDataAccess.getData returns pre-cached result
 * - CacheableDataAccess.getData called with correct arguments
 * - TEMPLATE_NOT_FOUND error propagation through catch block
 * - INVALID_CHUNK_INDEX detection from cached body
 * - Schema validation rejection before cache lookup
 * - Default bucket resolution when s3Buckets not provided
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

jest.mock('../../../services', () => ({
  Templates: {
    get: jest.fn()
  }
}));

jest.mock('../../../utils/schema-validator', () => ({
  validate: jest.fn()
}));

jest.mock('../../../utils/mcp-protocol', () => ({
  successResponse: jest.fn((tool, data) => ({ success: true, tool, data })),
  errorResponse: jest.fn((code, details, tool) => ({ success: false, code, details, tool }))
}));

jest.mock('../../../utils/content-chunker', () => ({
  chunk: jest.fn()
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

const TemplatesController = require('../../../controllers/templates');
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
const ContentChunker = require('../../../utils/content-chunker');
const { cache: { CacheableDataAccess }, tools } = require('@63klabs/cache-data');
const { Config } = require('../../../config');

describe('Templates Controller - getChunk() caching integration', () => {
  let mockConn;
  let mockCacheProfile;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConn = { host: '', path: '/chunks', parameters: {} };
    mockCacheProfile = { hostId: 'template-chunks', pathId: 'data' };

    Config.getConnCacheProfile.mockReturnValue({
      conn: mockConn,
      cacheProfile: mockCacheProfile
    });

    Config.settings.mockReturnValue({
      s3: { buckets: ['63klabs'] }
    });
  });

  describe('Cache hit path', () => {
    test('should extract body via cacheObj.getBody(true) and format MCP response on cache hit', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage',
            chunkIndex: 1
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const cachedBody = {
        chunkIndex: 1,
        totalChunks: 4,
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        content: 'cached-chunk-content'
      };

      // >! Simulate a cache hit: getData returns directly without calling fetch function
      const mockGetBody = jest.fn((parse) => parse ? cachedBody : JSON.stringify(cachedBody));
      CacheableDataAccess.getData.mockResolvedValue({ getBody: mockGetBody });

      const result = await TemplatesController.getChunk(props);

      // Verify getBody was called with true to parse the body
      expect(mockGetBody).toHaveBeenCalledWith(true);

      // Verify Services.Templates.get was NOT called (cache hit)
      expect(Services.Templates.get).not.toHaveBeenCalled();
      expect(ContentChunker.chunk).not.toHaveBeenCalled();

      // Verify MCP response formatting
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('get_template_chunk', cachedBody);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(cachedBody);
    });
  });

  describe('CacheableDataAccess.getData called with correct arguments', () => {
    test('should pass cacheProfile, fetchFunction, conn, and empty opts to getData', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: 'my-template',
            category: 'compute',
            chunkIndex: 0,
            version: 'v1.0.0',
            versionId: 'abc123',
            s3Buckets: ['bucket-a', 'bucket-b'],
            namespace: 'custom-ns'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const cachedBody = {
        chunkIndex: 0,
        totalChunks: 1,
        templateName: 'my-template',
        category: 'compute',
        content: 'chunk-data'
      };
      CacheableDataAccess.getData.mockResolvedValue({
        getBody: jest.fn(() => cachedBody)
      });

      await TemplatesController.getChunk(props);

      // Verify getData was called with correct arguments
      expect(CacheableDataAccess.getData).toHaveBeenCalledTimes(1);
      const [passedProfile, passedFetchFn, passedConn, passedOpts] = CacheableDataAccess.getData.mock.calls[0];

      expect(passedProfile).toBe(mockCacheProfile);
      expect(typeof passedFetchFn).toBe('function');
      expect(passedConn).toBe(mockConn);
      expect(passedOpts).toEqual({});

      // Verify conn.parameters were set correctly
      expect(passedConn.parameters).toEqual({
        templateName: 'my-template',
        category: 'compute',
        chunkIndex: 0,
        version: 'v1.0.0',
        versionId: 'abc123',
        s3Buckets: ['bucket-a', 'bucket-b'],
        namespace: 'custom-ns'
      });

      // Verify conn.host was set to provided s3Buckets
      expect(passedConn.host).toEqual(['bucket-a', 'bucket-b']);
    });
  });

  describe('TEMPLATE_NOT_FOUND error propagation', () => {
    test('should handle TEMPLATE_NOT_FOUND thrown by CacheableDataAccess.getData', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: 'missing-template',
            category: 'network',
            chunkIndex: 0
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      // >! CacheableDataAccess propagates thrown errors from fetch function
      const notFoundError = new Error('Template not found: network/missing-template');
      notFoundError.code = 'TEMPLATE_NOT_FOUND';
      notFoundError.availableTemplates = ['template-a'];
      CacheableDataAccess.getData.mockRejectedValue(notFoundError);

      const result = await TemplatesController.getChunk(props);

      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'TEMPLATE_NOT_FOUND',
        expect.objectContaining({
          message: 'Template not found: network/missing-template',
          availableTemplates: ['template-a']
        }),
        'get_template_chunk'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  describe('INVALID_CHUNK_INDEX from cached body', () => {
    test('should detect INVALID_CHUNK_INDEX code in cached body and return MCP error', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage',
            chunkIndex: 99
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      // >! Simulate cached error body with INVALID_CHUNK_INDEX
      const errorBody = {
        code: 'INVALID_CHUNK_INDEX',
        message: 'chunkIndex 99 is out of range. Valid range: 0-2',
        validRange: { min: 0, max: 2 }
      };
      CacheableDataAccess.getData.mockResolvedValue({
        getBody: jest.fn(() => errorBody)
      });

      const result = await TemplatesController.getChunk(props);

      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_CHUNK_INDEX',
        expect.objectContaining({
          message: 'chunkIndex 99 is out of range. Valid range: 0-2',
          validRange: { min: 0, max: 2 }
        }),
        'get_template_chunk'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  describe('Schema validation rejection before cache lookup', () => {
    test('should reject invalid input before calling CacheableDataAccess.getData', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: '',
            chunkIndex: -5
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [
          { field: 'category', message: 'Required field missing' }
        ]
      });

      const result = await TemplatesController.getChunk(props);

      // Verify cache was never consulted
      expect(CacheableDataAccess.getData).not.toHaveBeenCalled();
      expect(Config.getConnCacheProfile).not.toHaveBeenCalled();

      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed',
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'category' })
          ])
        }),
        'get_template_chunk'
      );
      expect(result.success).toBe(false);
    });
  });

  describe('Default bucket resolution', () => {
    test('should set conn.host to Config.settings().s3.buckets when s3Buckets not provided', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage',
            chunkIndex: 0
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      Config.settings.mockReturnValue({
        s3: { buckets: ['default-bucket-1', 'default-bucket-2'] }
      });

      const cachedBody = {
        chunkIndex: 0,
        totalChunks: 1,
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        content: 'content'
      };
      CacheableDataAccess.getData.mockResolvedValue({
        getBody: jest.fn(() => cachedBody)
      });

      await TemplatesController.getChunk(props);

      // Verify conn.host was set to default buckets from settings
      const passedConn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(passedConn.host).toEqual(['default-bucket-1', 'default-bucket-2']);
    });

    test('should use provided s3Buckets instead of defaults when supplied', async () => {
      const props = {
        bodyParameters: {
          input: {
            templateName: 'template-storage-s3-artifacts',
            category: 'storage',
            chunkIndex: 0,
            s3Buckets: ['custom-bucket']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const cachedBody = {
        chunkIndex: 0,
        totalChunks: 1,
        templateName: 'template-storage-s3-artifacts',
        category: 'storage',
        content: 'content'
      };
      CacheableDataAccess.getData.mockResolvedValue({
        getBody: jest.fn(() => cachedBody)
      });

      await TemplatesController.getChunk(props);

      const passedConn = CacheableDataAccess.getData.mock.calls[0][2];
      expect(passedConn.host).toEqual(['custom-bucket']);
    });
  });
});
