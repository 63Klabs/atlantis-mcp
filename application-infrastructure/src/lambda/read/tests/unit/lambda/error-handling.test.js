/**
 * Unit tests for error handling utilities
 *
 * Tests the ErrorHandler module including:
 * - Error creation with createError
 * - Error categorization with getStatusCode
 * - User-friendly error responses with toUserResponse
 * - Error logging with logError
 * - Specialized logging (S3, GitHub)
 * - Error metrics emission
 */

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

const { tools } = require('@63klabs/cache-data');
const ErrorHandler = require('../../../utils/error-handler');

describe('Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createError', () => {
    test('should create standardized error with all fields', () => {
      const error = ErrorHandler.createError({
        code: ErrorHandler.ErrorCode.TEMPLATE_NOT_FOUND,
        message: 'Template not found',
        category: ErrorHandler.ErrorCategory.NOT_FOUND,
        statusCode: 404,
        requestId: 'req-123'
      });

      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('TEMPLATE_NOT_FOUND');
      expect(error.message).toBe('Template not found');
      expect(error.category).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.requestId).toBe('req-123');
      expect(error.timestamp).toBeDefined();
    });
  });

  describe('getStatusCode', () => {
    test('should return statusCode from error if present', () => {
      const error = ErrorHandler.createError({
        code: 'TEST',
        message: 'test',
        category: ErrorHandler.ErrorCategory.NOT_FOUND,
        statusCode: 404
      });
      expect(ErrorHandler.getStatusCode(error)).toBe(404);
    });

    test('should return 400 for CLIENT_ERROR category', () => {
      const error = ErrorHandler.createError({
        code: 'INVALID_INPUT',
        message: 'Invalid',
        category: ErrorHandler.ErrorCategory.CLIENT_ERROR,
        statusCode: undefined
      });
      delete error.statusCode;
      expect(ErrorHandler.getStatusCode(error)).toBe(400);
    });

    test('should return 400 for VALIDATION_ERROR category', () => {
      const error = ErrorHandler.createError({
        code: 'VALIDATION',
        message: 'Validation failed',
        category: ErrorHandler.ErrorCategory.VALIDATION_ERROR,
        statusCode: undefined
      });
      delete error.statusCode;
      expect(ErrorHandler.getStatusCode(error)).toBe(400);
    });

    test('should return 404 for NOT_FOUND category', () => {
      const error = ErrorHandler.createError({
        code: 'NOT_FOUND',
        message: 'Not found',
        category: ErrorHandler.ErrorCategory.NOT_FOUND,
        statusCode: undefined
      });
      delete error.statusCode;
      expect(ErrorHandler.getStatusCode(error)).toBe(404);
    });

    test('should return 429 for RATE_LIMIT category', () => {
      const error = ErrorHandler.createError({
        code: 'RATE_LIMIT',
        message: 'Rate limit',
        category: ErrorHandler.ErrorCategory.RATE_LIMIT,
        statusCode: undefined
      });
      delete error.statusCode;
      expect(ErrorHandler.getStatusCode(error)).toBe(429);
    });

    test('should return 500 for SERVER_ERROR category', () => {
      const error = ErrorHandler.createError({
        code: 'SERVER',
        message: 'Server error',
        category: ErrorHandler.ErrorCategory.SERVER_ERROR,
        statusCode: undefined
      });
      delete error.statusCode;
      expect(ErrorHandler.getStatusCode(error)).toBe(500);
    });

    test('should return 500 for null or undefined errors', () => {
      expect(ErrorHandler.getStatusCode(null)).toBe(500);
      expect(ErrorHandler.getStatusCode(undefined)).toBe(500);
    });

    test('should return 500 for errors without statusCode or category', () => {
      const error = new Error('Generic error');
      expect(ErrorHandler.getStatusCode(error)).toBe(500);
    });

    test('should return 500 for non-Error objects', () => {
      expect(ErrorHandler.getStatusCode({ message: 'Not an Error' })).toBe(500);
    });
  });

  describe('toUserResponse', () => {
    test('should return error code and message', () => {
      const error = ErrorHandler.createError({
        code: ErrorHandler.ErrorCode.TEMPLATE_NOT_FOUND,
        message: 'Template not found',
        category: ErrorHandler.ErrorCategory.NOT_FOUND,
        statusCode: 404
      });

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.error).toBe('TEMPLATE_NOT_FOUND');
      expect(response.message).toBe('Template not found');
      expect(response.requestId).toBe('req-123');
      expect(response.timestamp).toBeDefined();
    });

    test('should include availableTemplates for TEMPLATE_NOT_FOUND', () => {
      const error = ErrorHandler.createError({
        code: ErrorHandler.ErrorCode.TEMPLATE_NOT_FOUND,
        message: 'Template not found',
        category: ErrorHandler.ErrorCategory.NOT_FOUND,
        statusCode: 404
      });
      error.availableTemplates = ['template1', 'template2'];

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.availableTemplates).toEqual(['template1', 'template2']);
    });

    test('should include availableTools for UNKNOWN_TOOL', () => {
      const error = ErrorHandler.createError({
        code: ErrorHandler.ErrorCode.UNKNOWN_TOOL,
        message: 'Unknown tool',
        category: ErrorHandler.ErrorCategory.NOT_FOUND,
        statusCode: 404
      });
      error.availableTools = ['list_templates', 'get_template'];

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.availableTools).toEqual(['list_templates', 'get_template']);
    });

    test('should include retryAfter for RATE_LIMIT_EXCEEDED', () => {
      const error = ErrorHandler.createError({
        code: ErrorHandler.ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Rate limit exceeded',
        category: ErrorHandler.ErrorCategory.RATE_LIMIT,
        statusCode: 429
      });
      error.retryAfter = 3600;

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.retryAfter).toBe(3600);
    });

    test('should default to INTERNAL_ERROR for errors without code', () => {
      const error = new Error('Something went wrong');

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.error).toBe('INTERNAL_ERROR');
      expect(response.requestId).toBe('req-123');
    });
  });

  describe('logError', () => {
    test('should use warn for CLIENT_ERROR category', () => {
      const error = ErrorHandler.createError({
        code: 'INVALID_INPUT',
        message: 'Invalid input',
        category: ErrorHandler.ErrorCategory.CLIENT_ERROR,
        statusCode: 400
      });

      ErrorHandler.logError(error, { requestId: 'req-123' });

      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        'Client error',
        expect.objectContaining({ error: 'Invalid input' })
      );
    });

    test('should use warn for EXTERNAL_SERVICE category', () => {
      const error = ErrorHandler.createError({
        code: 'S3_ERROR',
        message: 'S3 failed',
        category: ErrorHandler.ErrorCategory.EXTERNAL_SERVICE,
        statusCode: 500
      });

      ErrorHandler.logError(error, {});

      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        'External service error',
        expect.any(Object)
      );
    });

    test('should use info for RATE_LIMIT category', () => {
      const error = ErrorHandler.createError({
        code: 'RATE_LIMIT',
        message: 'Rate limit exceeded',
        category: ErrorHandler.ErrorCategory.RATE_LIMIT,
        statusCode: 429
      });

      ErrorHandler.logError(error, {});

      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'Rate limit exceeded',
        expect.any(Object)
      );
    });

    test('should use error for SERVER_ERROR category', () => {
      const error = ErrorHandler.createError({
        code: 'INTERNAL',
        message: 'Server error',
        category: ErrorHandler.ErrorCategory.SERVER_ERROR,
        statusCode: 500
      });

      ErrorHandler.logError(error, { requestId: 'req-123' });

      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        'Server error',
        expect.objectContaining({ requestId: 'req-123' })
      );
    });

    test('should include context in log', () => {
      const error = ErrorHandler.createError({
        code: 'TEST',
        message: 'Test error',
        category: ErrorHandler.ErrorCategory.SERVER_ERROR,
        statusCode: 500
      });

      ErrorHandler.logError(error, {
        requestId: 'req-123',
        ip: '192.168.1.1',
        tool: 'list_templates'
      });

      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          requestId: 'req-123',
          ip: '192.168.1.1',
          tool: 'list_templates'
        })
      );
    });
  });

  describe('logS3Error', () => {
    test('should log S3 errors with bucket and key details', () => {
      ErrorHandler.logS3Error({
        operation: 'GetObject',
        bucket: 'test-bucket',
        key: 'templates/v2/storage/template.yml',
        error: new Error('Access Denied'),
        requestId: 'req-123'
      });

      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        'S3 operation failed',
        expect.objectContaining({
          bucket: 'test-bucket',
          key: 'templates/v2/storage/template.yml',
          operation: 'GetObject'
        })
      );
    });
  });

  describe('logGitHubError', () => {
    test('should log GitHub errors with repository and endpoint details', () => {
      ErrorHandler.logGitHubError({
        operation: 'listRepositories',
        repository: 'org/repo',
        userOrg: 'org',
        endpoint: '/repos/org/repo',
        error: new Error('API rate limit exceeded'),
        requestId: 'req-123'
      });

      expect(tools.DebugAndLog.warn).toHaveBeenCalledWith(
        'GitHub API operation failed',
        expect.objectContaining({
          repository: 'org/repo',
          endpoint: '/repos/org/repo'
        })
      );
    });
  });

  describe('logRequest', () => {
    test('should log request with all details', () => {
      ErrorHandler.logRequest({
        tool: 'list_templates',
        method: 'POST',
        path: '/mcp',
        ip: '192.168.1.1',
        requestId: 'req-123',
        executionTime: 150,
        statusCode: 200,
        cacheHit: false
      });

      expect(tools.DebugAndLog.info).toHaveBeenCalledWith(
        'Request processed',
        expect.objectContaining({
          tool: 'list_templates',
          statusCode: 200,
          cacheHit: false
        })
      );
    });
  });

  describe('emitErrorMetric', () => {
    test('should emit error metric with tool and error code', () => {
      ErrorHandler.emitErrorMetric({
        tool: 'list_templates',
        errorCode: 'TEST_ERROR',
        statusCode: 500
      });

      expect(tools.DebugAndLog.debug).toHaveBeenCalledWith(
        'Error metric',
        expect.objectContaining({
          tool: 'list_templates',
          errorCode: 'TEST_ERROR',
          statusCode: 500
        })
      );
    });
  });

  describe('emitLatencyMetric', () => {
    test('should emit latency metric', () => {
      ErrorHandler.emitLatencyMetric({
        tool: 'get_template',
        latency: 250,
        cacheHit: true
      });

      expect(tools.DebugAndLog.debug).toHaveBeenCalledWith(
        'Latency metric',
        expect.objectContaining({
          tool: 'get_template',
          cacheHit: true
        })
      );
    });
  });

  describe('ErrorCategory and ErrorCode constants', () => {
    test('should export ErrorCategory constants', () => {
      expect(ErrorHandler.ErrorCategory.CLIENT_ERROR).toBe('CLIENT_ERROR');
      expect(ErrorHandler.ErrorCategory.SERVER_ERROR).toBe('SERVER_ERROR');
      expect(ErrorHandler.ErrorCategory.NOT_FOUND).toBe('NOT_FOUND');
      expect(ErrorHandler.ErrorCategory.RATE_LIMIT).toBe('RATE_LIMIT');
    });

    test('should export ErrorCode constants', () => {
      expect(ErrorHandler.ErrorCode.INVALID_INPUT).toBe('INVALID_INPUT');
      expect(ErrorHandler.ErrorCode.TEMPLATE_NOT_FOUND).toBe('TEMPLATE_NOT_FOUND');
      expect(ErrorHandler.ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    });
  });

  describe('Edge Cases', () => {
    test('should handle errors without message', () => {
      const error = new Error();
      const response = ErrorHandler.toUserResponse(error, 'req-123');
      expect(response.requestId).toBe('req-123');
    });

    test('should handle circular reference in error context', () => {
      const error = ErrorHandler.createError({
        code: 'TEST',
        message: 'Test',
        category: ErrorHandler.ErrorCategory.SERVER_ERROR,
        statusCode: 500
      });
      const context = { requestId: 'req-123' };
      context.circular = context;

      expect(() => {
        ErrorHandler.logError(error, context);
      }).not.toThrow();
    });
  });
});
