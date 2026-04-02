/**
 * Unit tests for Templates Controller - getChunk()
 *
 * Tests the getChunk controller function which retrieves a specific chunk
 * of a large template's content.
 *
 * Tests include:
 * - Valid chunk retrieval (first chunk, last chunk)
 * - Invalid chunkIndex (negative, out of range)
 * - Template not found (service returns null, service throws TEMPLATE_NOT_FOUND)
 * - Schema validation failure (missing required params)
 * - Internal error (service throws generic error)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

// Mock dependencies before requiring controller
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

describe('Templates Controller - getChunk()', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // >! Default mock for Config.getConnCacheProfile
    Config.getConnCacheProfile.mockReturnValue({
      conn: { host: '', path: '/chunks', parameters: {} },
      cacheProfile: { hostId: 'template-chunks', pathId: 'data' }
    });

    // >! Default mock for Config.settings
    Config.settings.mockReturnValue({
      s3: { buckets: ['63klabs'] }
    });
  });

  test('should retrieve first chunk (index 0) successfully', async () => {
    // Arrange
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

    const mockTemplate = {
      name: 'template-storage-s3-artifacts',
      version: 'v1.3.5/2024-01-15',
      category: 'storage',
      content: 'AWSTemplateFormatVersion...'
    };

    // >! Mock CacheableDataAccess.getData to simulate cache miss and call fetch function
    Services.Templates.get.mockResolvedValue(mockTemplate);
    ContentChunker.chunk.mockReturnValue(['chunk-0-content', 'chunk-1-content', 'chunk-2-content']);

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
      const result = await fetchFn(conn, opts);
      return {
        getBody: (parse) => parse ? JSON.parse(result.body) : result.body
      };
    });

    // Act
    const result = await TemplatesController.getChunk(props);

    // Assert
    expect(SchemaValidator.validate).toHaveBeenCalledWith('get_template_chunk', props.bodyParameters.input);
    expect(CacheableDataAccess.getData).toHaveBeenCalled();
    expect(MCPProtocol.successResponse).toHaveBeenCalledWith('get_template_chunk', {
      chunkIndex: 0,
      totalChunks: 3,
      templateName: 'template-storage-s3-artifacts',
      category: 'storage',
      content: 'chunk-0-content'
    });
    expect(result.success).toBe(true);
  });

  test('should retrieve last chunk successfully', async () => {
    // Arrange
    const props = {
      bodyParameters: {
        input: {
          templateName: 'template-storage-s3-artifacts',
          category: 'storage',
          chunkIndex: 2
        }
      }
    };

    SchemaValidator.validate.mockReturnValue({ valid: true });

    const mockTemplate = { name: 'template-storage-s3-artifacts', category: 'storage' };
    Services.Templates.get.mockResolvedValue(mockTemplate);
    ContentChunker.chunk.mockReturnValue(['chunk-0', 'chunk-1', 'chunk-2']);

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
      const result = await fetchFn(conn, opts);
      return {
        getBody: (parse) => parse ? JSON.parse(result.body) : result.body
      };
    });

    // Act
    const result = await TemplatesController.getChunk(props);

    // Assert
    expect(MCPProtocol.successResponse).toHaveBeenCalledWith('get_template_chunk', {
      chunkIndex: 2,
      totalChunks: 3,
      templateName: 'template-storage-s3-artifacts',
      category: 'storage',
      content: 'chunk-2'
    });
    expect(result.success).toBe(true);
  });

  test('should return INVALID_CHUNK_INDEX error for negative chunkIndex', async () => {
    // Arrange
    const props = {
      bodyParameters: {
        input: {
          templateName: 'template-storage-s3-artifacts',
          category: 'storage',
          chunkIndex: -1
        }
      }
    };

    SchemaValidator.validate.mockReturnValue({ valid: true });

    const mockTemplate = { name: 'template-storage-s3-artifacts', category: 'storage' };
    Services.Templates.get.mockResolvedValue(mockTemplate);
    ContentChunker.chunk.mockReturnValue(['chunk-0', 'chunk-1']);

    // >! Mock CacheableDataAccess.getData to call fetch function which returns ApiRequest.error
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
      const result = await fetchFn(conn, opts);
      return {
        getBody: (parse) => parse ? JSON.parse(result.body) : result.body
      };
    });

    // Act
    const result = await TemplatesController.getChunk(props);

    // Assert
    expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
      'INVALID_CHUNK_INDEX',
      expect.objectContaining({
        message: expect.stringContaining('-1'),
        validRange: { min: 0, max: 1 }
      }),
      'get_template_chunk'
    );
    expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  test('should return INVALID_CHUNK_INDEX error for chunkIndex >= totalChunks', async () => {
    // Arrange
    const props = {
      bodyParameters: {
        input: {
          templateName: 'template-storage-s3-artifacts',
          category: 'storage',
          chunkIndex: 3
        }
      }
    };

    SchemaValidator.validate.mockReturnValue({ valid: true });

    const mockTemplate = { name: 'template-storage-s3-artifacts', category: 'storage' };
    Services.Templates.get.mockResolvedValue(mockTemplate);
    ContentChunker.chunk.mockReturnValue(['chunk-0', 'chunk-1', 'chunk-2']);

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
      const result = await fetchFn(conn, opts);
      return {
        getBody: (parse) => parse ? JSON.parse(result.body) : result.body
      };
    });

    // Act
    const result = await TemplatesController.getChunk(props);

    // Assert
    expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
      'INVALID_CHUNK_INDEX',
      expect.objectContaining({
        message: 'chunkIndex 3 is out of range. Valid range: 0-2',
        validRange: { min: 0, max: 2 }
      }),
      'get_template_chunk'
    );
    expect(result.success).toBe(false);
  });

  test('should return TEMPLATE_NOT_FOUND when service returns null', async () => {
    // Arrange
    const props = {
      bodyParameters: {
        input: {
          templateName: 'non-existent-template',
          category: 'storage',
          chunkIndex: 0
        }
      }
    };

    SchemaValidator.validate.mockReturnValue({ valid: true });
    Services.Templates.get.mockResolvedValue(null);

    // >! When fetch function throws, CacheableDataAccess propagates the error
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
      return await fetchFn(conn, opts);
    });

    // Act
    const result = await TemplatesController.getChunk(props);

    // Assert
    expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
      'TEMPLATE_NOT_FOUND',
      expect.objectContaining({
        message: 'Template not found: storage/non-existent-template',
        availableTemplates: []
      }),
      'get_template_chunk'
    );
    expect(ContentChunker.chunk).not.toHaveBeenCalled();
    expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  test('should return TEMPLATE_NOT_FOUND when service throws with code TEMPLATE_NOT_FOUND', async () => {
    // Arrange
    const props = {
      bodyParameters: {
        input: {
          templateName: 'non-existent-template',
          category: 'storage',
          chunkIndex: 0
        }
      }
    };

    SchemaValidator.validate.mockReturnValue({ valid: true });

    const notFoundError = new Error('Template not found in storage');
    notFoundError.code = 'TEMPLATE_NOT_FOUND';
    notFoundError.availableTemplates = ['template-a', 'template-b'];
    Services.Templates.get.mockRejectedValue(notFoundError);

    // >! CacheableDataAccess propagates thrown errors from fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
      return await fetchFn(conn, opts);
    });

    // Act
    const result = await TemplatesController.getChunk(props);

    // Assert
    expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
      'TEMPLATE_NOT_FOUND',
      expect.objectContaining({
        message: 'Template not found in storage',
        availableTemplates: ['template-a', 'template-b']
      }),
      'get_template_chunk'
    );
    expect(tools.DebugAndLog.warn).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  test('should return INVALID_INPUT for schema validation failure', async () => {
    // Arrange
    const props = {
      bodyParameters: {
        input: {
          // Missing required templateName, category, chunkIndex
        }
      }
    };

    SchemaValidator.validate.mockReturnValue({
      valid: false,
      errors: [
        { field: 'templateName', message: 'Required field missing' },
        { field: 'category', message: 'Required field missing' },
        { field: 'chunkIndex', message: 'Required field missing' }
      ]
    });

    // Act
    const result = await TemplatesController.getChunk(props);

    // Assert
    expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
      'INVALID_INPUT',
      expect.objectContaining({
        message: 'Input validation failed',
        errors: expect.arrayContaining([
          expect.objectContaining({ field: 'templateName' })
        ])
      }),
      'get_template_chunk'
    );
    expect(Services.Templates.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  test('should return INTERNAL_ERROR when service throws generic error', async () => {
    // Arrange
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

    const serviceError = new Error('S3 connection timeout');
    Services.Templates.get.mockRejectedValue(serviceError);

    // >! CacheableDataAccess propagates thrown errors from fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFn, conn, opts) => {
      return await fetchFn(conn, opts);
    });

    // Act
    const result = await TemplatesController.getChunk(props);

    // Assert
    expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
      'INTERNAL_ERROR',
      expect.objectContaining({
        message: 'Failed to retrieve template chunk',
        error: 'S3 connection timeout'
      }),
      'get_template_chunk'
    );
    expect(tools.DebugAndLog.error).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });
});
