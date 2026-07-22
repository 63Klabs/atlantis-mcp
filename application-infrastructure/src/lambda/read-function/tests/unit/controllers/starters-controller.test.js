/**
 * Unit tests for Starters Controller
 *
 * Tests all Starters controller functions:
 * - list() - List all available starter code repositories
 * - get() - Retrieve specific starter with detailed metadata
 *
 * Tests include:
 * - Input validation (JSON Schema)
 * - Service orchestration
 * - MCP response formatting
 * - Error handling (STARTER_NOT_FOUND, INVALID_INPUT, INTERNAL_ERROR)
 */

// Mock dependencies before requiring controller
jest.mock('../../../services', () => ({
  Starters: {
    list: jest.fn(),
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

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    }
  }
}));

const StartersController = require('../../../controllers/starters');
const Services = require('../../../services');
const SchemaValidator = require('../../../utils/schema-validator');
const MCPProtocol = require('../../../utils/mcp-protocol');
const { tools } = require('@63klabs/cache-data');

describe('Starters Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list()', () => {
    test('should list starters successfully with valid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            s3Buckets: ['63klabs'],
            namespace: '63klabs'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockStarters = {
        starters: [
          {
            name: 'atlantis-starter-02',
            description: 'Serverless application starter',
            languages: ['Node.js'],
            frameworks: ['Express'],
            hasCacheData: true
          },
          {
            name: 'python-lambda-starter',
            description: 'Python Lambda starter',
            languages: ['Python'],
            frameworks: ['Flask'],
            hasCacheData: false
          }
        ]
      };

      Services.Starters.list.mockResolvedValue(mockStarters);

      // Act
      const result = await StartersController.list(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_starters', props.bodyParameters.input);
      expect(Services.Starters.list).toHaveBeenCalledWith({
        s3Buckets: ['63klabs'],
        namespace: '63klabs'
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('list_starters', mockStarters);
      expect(result.success).toBe(true);
    });

    test('should handle empty input', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Starters.list.mockResolvedValue({ starters: [] });

      // Act
      const result = await StartersController.list(props);

      // Assert
      expect(Services.Starters.list).toHaveBeenCalledWith({
        s3Buckets: undefined,
        namespace: undefined
      });
      expect(result.success).toBe(true);
    });

    test('should handle missing body', async () => {
      // Arrange
      const props = {};
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Starters.list.mockResolvedValue({ starters: [] });

      // Act
      const result = await StartersController.list(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('list_starters', {});
      expect(result.success).toBe(true);
    });

    test('should return error for invalid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            s3Buckets: 'not-an-array' // Should be array
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 's3Buckets', message: 'Must be an array' }]
      });

      // Act
      const result = await StartersController.list(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed',
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 's3Buckets' })
          ])
        }),
        'list_starters'
      );
      expect(Services.Starters.list).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle service errors', async () => {
      // Arrange
      const props = { bodyParameters: { input: {} } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('S3 connection failed');
      Services.Starters.list.mockRejectedValue(serviceError);

      // Act
      const result = await StartersController.list(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to list starters',
          error: 'S3 connection failed'
        }),
        'list_starters'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle partial data with errors', async () => {
      // Arrange
      const props = { bodyParameters: { input: { s3Buckets: ['63klabs'] } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });

      Services.Starters.list.mockResolvedValue({
        starters: [{ name: 'starter1' }],
        partialData: true,
        errors: [
          { source: '63klabs', error: 'Access denied to namespace' }
        ]
      });

      // Act
      const result = await StartersController.list(props);

      // Assert
      expect(result.success).toBe(true);
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'list_starters response',
        expect.objectContaining({
          starterCount: 1,
          partialData: true,
          errorCount: 1
        })
      );
    });

    test('should log request and response details', async () => {
      // Arrange
      const props = { bodyParameters: { input: { s3Buckets: ['63klabs'], namespace: '63klabs' } } };
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Starters.list.mockResolvedValue({
        starters: [{ name: 'starter1' }],
        partialData: false
      });

      // Act
      await StartersController.list(props);

      // Assert
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'list_starters request',
        expect.objectContaining({ namespace: '63klabs', s3BucketsCount: 1 })
      );
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'list_starters response',
        expect.objectContaining({ starterCount: 1 })
      );
    });
  });

  describe('get()', () => {
    test('should get starter successfully with valid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            starterName: 'atlantis-starter-02',
            s3Buckets: ['63klabs'],
            namespace: '63klabs'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const mockStarter = {
        name: 'atlantis-starter-02',
        description: 'Serverless application starter with cache-data integration',
        languages: ['Node.js'],
        frameworks: ['Express'],
        features: ['Lambda', 'API Gateway', 'DynamoDB', 'S3'],
        prerequisites: ['Node.js 20+', 'AWS CLI'],
        author: '63Klabs',
        license: 'MIT',
        hasS3Package: true,
        hasSidecarMetadata: true,
        source: 's3',
        hasCacheData: true
      };

      Services.Starters.get.mockResolvedValue(mockStarter);

      // Act
      const result = await StartersController.get(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('get_starter_info', props.bodyParameters.input);
      expect(Services.Starters.get).toHaveBeenCalledWith({
        starterName: 'atlantis-starter-02',
        s3Buckets: ['63klabs'],
        namespace: '63klabs'
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('get_starter_info', mockStarter);
      expect(result.success).toBe(true);
    });

    test('should return error for invalid input', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            // Missing required starterName
            s3Buckets: ['63klabs']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'starterName', message: 'Required field missing' }]
      });

      // Act
      const result = await StartersController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed'
        }),
        'get_starter_info'
      );
      expect(Services.Starters.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle STARTER_NOT_FOUND error with available starters', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            starterName: 'non-existent-starter',
            s3Buckets: ['63klabs']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const notFoundError = new Error('Starter not found');
      notFoundError.code = 'STARTER_NOT_FOUND';
      notFoundError.availableStarters = ['atlantis-starter-02', 'python-lambda-starter'];

      Services.Starters.get.mockRejectedValue(notFoundError);

      // Act
      const result = await StartersController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'STARTER_NOT_FOUND',
        expect.objectContaining({
          message: 'Starter not found',
          availableStarters: ['atlantis-starter-02', 'python-lambda-starter']
        }),
        'get_starter_info'
      );
      expect(tools.DebugAndLog.warn).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle STARTER_NOT_FOUND error without available starters', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            starterName: 'non-existent-starter',
            s3Buckets: ['63klabs']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const notFoundError = new Error('Starter not found');
      notFoundError.code = 'STARTER_NOT_FOUND';

      Services.Starters.get.mockRejectedValue(notFoundError);

      // Act
      const result = await StartersController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'STARTER_NOT_FOUND',
        expect.objectContaining({
          availableStarters: []
        }),
        'get_starter_info'
      );
    });

    test('should handle generic service errors', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            starterName: 'atlantis-starter-02',
            s3Buckets: ['63klabs']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });

      const serviceError = new Error('S3 access denied');
      Services.Starters.get.mockRejectedValue(serviceError);

      // Act
      const result = await StartersController.get(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to retrieve starter',
          error: 'S3 access denied'
        }),
        'get_starter_info'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle missing s3Buckets parameter', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            starterName: 'atlantis-starter-02'
            // s3Buckets is optional
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Starters.get.mockResolvedValue({ name: 'atlantis-starter-02' });

      // Act
      await StartersController.get(props);

      // Assert
      expect(Services.Starters.get).toHaveBeenCalledWith({
        starterName: 'atlantis-starter-02',
        s3Buckets: undefined,
        namespace: undefined
      });
    });

    test('should log request and response details', async () => {
      // Arrange
      const props = {
        bodyParameters: {
          input: {
            starterName: 'atlantis-starter-02',
            s3Buckets: ['63klabs'],
            namespace: '63klabs'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Starters.get.mockResolvedValue({
        name: 'atlantis-starter-02',
        hasS3Package: true,
        hasSidecarMetadata: true,
        source: 's3'
      });

      // Act
      await StartersController.get(props);

      // Assert
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'get_starter_info request',
        expect.objectContaining({
          starterName: 'atlantis-starter-02',
          namespace: '63klabs',
          s3BucketsCount: 1
        })
      );
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'get_starter_info response',
        expect.objectContaining({
          starterName: 'atlantis-starter-02',
          hasS3Package: true,
          hasSidecarMetadata: true,
          source: 's3'
        })
      );
    });
  });
});
