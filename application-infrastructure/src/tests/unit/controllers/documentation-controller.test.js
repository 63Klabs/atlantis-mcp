/**
 * Unit tests for Documentation Controller
 * 
 * Tests Documentation controller search() function:
 * - Search Atlantis documentation, tutorials, and code patterns
 * 
 * Tests include:
 * - Input validation (JSON Schema)
 * - Service orchestration
 * - MCP response formatting
 * - Error handling (INVALID_INPUT, INTERNAL_ERROR)
 * - Suggestions when no results found
 */

// Mock dependencies before requiring controller
jest.mock('../../../lambda/read/services', () => ({
  Documentation: {
    search: jest.fn()
  }
}));

jest.mock('../../../lambda/read/utils/schema-validator', () => ({
  validate: jest.fn()
}));

jest.mock('../../../lambda/read/utils/mcp-protocol', () => ({
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

const DocumentationController = require('../../../lambda/read/controllers/documentation');
const Services = require('../../../lambda/read/services');
const SchemaValidator = require('../../../lambda/read/utils/schema-validator');
const MCPProtocol = require('../../../lambda/read/utils/mcp-protocol');
const { tools } = require('@63klabs/cache-data');

describe('Documentation Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('search()', () => {
    test('should search documentation successfully with valid input', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            query: 'S3 bucket configuration',
            type: 'template pattern',
            ghusers: ['63klabs']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      
      const mockResults = {
        results: [
          {
            title: 'S3 Bucket Configuration Guide',
            excerpt: 'Learn how to configure S3 buckets...',
            filePath: 'docs/storage/s3-configuration.md',
            githubUrl: 'https://github.com/63klabs/docs/blob/main/storage/s3-configuration.md',
            resultType: 'documentation',
            relevanceScore: 0.95
          },
          {
            title: 'template-storage-s3-artifacts.yml',
            excerpt: 'Parameters:\n  BucketName:\n    Type: String...',
            filePath: 'templates/v2/storage/template-storage-s3-artifacts.yml',
            githubUrl: 'https://github.com/63klabs/templates/blob/main/templates/v2/storage/template-storage-s3-artifacts.yml',
            resultType: 'template pattern',
            relevanceScore: 0.88,
            lineNumbers: { start: 10, end: 25 }
          }
        ]
      };
      
      Services.Documentation.search.mockResolvedValue(mockResults);

      // Act
      const result = await DocumentationController.search(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('search_documentation', props.body.input);
      expect(Services.Documentation.search).toHaveBeenCalledWith({
        query: 'S3 bucket configuration',
        type: 'template pattern',
        ghusers: ['63klabs']
      });
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('search_documentation', mockResults);
      expect(result.success).toBe(true);
    });

    test('should handle search with minimal input', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            query: 'Lambda function'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Documentation.search.mockResolvedValue({ results: [] });

      // Act
      const result = await DocumentationController.search(props);

      // Assert
      expect(Services.Documentation.search).toHaveBeenCalledWith({
        query: 'Lambda function',
        type: undefined,
        ghusers: undefined
      });
      expect(result.success).toBe(true);
    });

    test('should handle missing body', async () => {
      // Arrange
      const props = {};
      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Documentation.search.mockResolvedValue({ results: [] });

      // Act
      const result = await DocumentationController.search(props);

      // Assert
      expect(SchemaValidator.validate).toHaveBeenCalledWith('search_documentation', {});
      expect(result.success).toBe(true);
    });

    test('should return error for invalid input', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            // Missing required query
            type: 'documentation'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({
        valid: false,
        errors: [{ field: 'query', message: 'Required field missing' }]
      });

      // Act
      const result = await DocumentationController.search(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INVALID_INPUT',
        expect.objectContaining({
          message: 'Input validation failed',
          errors: expect.arrayContaining([
            expect.objectContaining({ field: 'query' })
          ])
        }),
        'search_documentation'
      );
      expect(Services.Documentation.search).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle service errors', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            query: 'test query'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      
      const serviceError = new Error('GitHub API rate limit exceeded');
      Services.Documentation.search.mockRejectedValue(serviceError);

      // Act
      const result = await DocumentationController.search(props);

      // Assert
      expect(MCPProtocol.errorResponse).toHaveBeenCalledWith(
        'INTERNAL_ERROR',
        expect.objectContaining({
          message: 'Failed to search documentation',
          error: 'GitHub API rate limit exceeded'
        }),
        'search_documentation'
      );
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });

    test('should handle no results with suggestions', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            query: 'nonexistent topic'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      
      const mockResults = {
        results: [],
        suggestions: [
          'Try searching for "S3 bucket"',
          'Try searching for "Lambda function"',
          'Try searching for "DynamoDB table"'
        ]
      };
      
      Services.Documentation.search.mockResolvedValue(mockResults);

      // Act
      const result = await DocumentationController.search(props);

      // Assert
      expect(MCPProtocol.successResponse).toHaveBeenCalledWith('search_documentation', mockResults);
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'search_documentation no results, providing suggestions',
        expect.objectContaining({ suggestionCount: 3 })
      );
      expect(result.success).toBe(true);
    });

    test('should handle partial data with errors', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            query: 'test query',
            ghusers: ['63klabs', 'failedorg']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      
      Services.Documentation.search.mockResolvedValue({
        results: [{ title: 'Result 1' }],
        partialData: true,
        errors: [
          { source: 'failedorg', error: 'Organization not found' }
        ]
      });

      // Act
      const result = await DocumentationController.search(props);

      // Assert
      expect(result.success).toBe(true);
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'search_documentation response',
        expect.objectContaining({
          resultCount: 1,
          partialData: true,
          errorCount: 1
        })
      );
    });

    test('should pass all filter parameters to service', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            query: 'CloudFormation',
            type: 'code example',
            ghusers: ['63klabs', 'myorg']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Documentation.search.mockResolvedValue({ results: [] });

      // Act
      await DocumentationController.search(props);

      // Assert
      expect(Services.Documentation.search).toHaveBeenCalledWith({
        query: 'CloudFormation',
        type: 'code example',
        ghusers: ['63klabs', 'myorg']
      });
    });

    test('should log request and response details', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            query: 'test query',
            type: 'documentation',
            ghusers: ['63klabs']
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Documentation.search.mockResolvedValue({
        results: [{ title: 'Result 1' }, { title: 'Result 2' }],
        suggestions: [],
        partialData: false
      });

      // Act
      await DocumentationController.search(props);

      // Assert
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'search_documentation request',
        expect.objectContaining({
          query: 'test query',
          type: 'documentation',
          ghusersCount: 1
        })
      );
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'search_documentation response',
        expect.objectContaining({
          resultCount: 2,
          hasSuggestions: false,
          partialData: false
        })
      );
    });

    test('should handle type parameter defaulting to "all"', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            query: 'test query'
            // type not provided
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      Services.Documentation.search.mockResolvedValue({ results: [] });

      // Act
      await DocumentationController.search(props);

      // Assert
      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'search_documentation request',
        expect.objectContaining({
          type: 'all'
        })
      );
    });

    test('should handle results with code snippets', async () => {
      // Arrange
      const props = {
        body: {
          input: {
            query: 'cache-data usage'
          }
        }
      };

      SchemaValidator.validate.mockReturnValue({ valid: true });
      
      const mockResults = {
        results: [
          {
            title: 'Cache Data Integration Example',
            excerpt: 'const { Cache } = require("@63klabs/cache-data");',
            filePath: 'src/lambda/read/index.js',
            githubUrl: 'https://github.com/63klabs/starter/blob/main/src/lambda/read/index.js',
            resultType: 'code example',
            relevanceScore: 0.92,
            lineNumbers: { start: 5, end: 15 },
            codeSnippet: 'const { Cache } = require("@63klabs/cache-data");\nawait Cache.init({...});'
          }
        ]
      };
      
      Services.Documentation.search.mockResolvedValue(mockResults);

      // Act
      const result = await DocumentationController.search(props);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.results[0].codeSnippet).toBeDefined();
      expect(result.data.results[0].lineNumbers).toBeDefined();
    });
  });
});
