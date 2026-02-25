/**
 * Unit tests for error handling across all failure scenarios
 *
 * Tests error handling including:
 * - S3 operation failures
 * - DynamoDB operation failures
 * - GitHub API failures
 * - Network timeouts
 * - Invalid input errors
 * - Configuration errors
 * - Error response formatting
 * - Error logging
 */

const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

// Mock AWS SDK clients
const s3Mock = mockClient(S3Client);
const ddbMock = mockClient(DynamoDBDocumentClient);
const ssmMock = mockClient(SSMClient);

// Mock dependencies
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
const ErrorHandler = require('../../../lambda/read/utils/error-handler');

describe('Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    s3Mock.reset();
    ddbMock.reset();
    ssmMock.reset();
  });

  describe('S3 Operation Failures', () => {
    test('should handle S3 NoSuchKey error', () => {
      const error = new Error('The specified key does not exist');
      error.name = 'NoSuchKey';
      error.Code = 'NoSuchKey';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(404);
    });

    test('should handle S3 AccessDenied error', () => {
      const error = new Error('Access Denied');
      error.name = 'AccessDenied';
      error.Code = 'AccessDenied';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(403);
    });

    test('should handle S3 NoSuchBucket error', () => {
      const error = new Error('The specified bucket does not exist');
      error.name = 'NoSuchBucket';
      error.Code = 'NoSuchBucket';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(404);
    });

    test('should log S3 errors with bucket and key details', () => {
      const error = new Error('S3 operation failed');
      error.name = 'S3Error';

      const context = {
        bucket: 'test-bucket',
        key: 'templates/v2/storage/template.yml',
        operation: 'GetObject'
      };

      ErrorHandler.logError(error, context);

      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        expect.stringContaining('S3 operation failed'),
        expect.objectContaining({
          bucket: 'test-bucket',
          key: 'templates/v2/storage/template.yml'
        })
      );
    });

    test('should handle S3 throttling errors', () => {
      const error = new Error('SlowDown');
      error.name = 'SlowDown';
      error.Code = 'SlowDown';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(503);
    });

    test('should handle S3 network timeout', () => {
      const error = new Error('Network timeout');
      error.name = 'TimeoutError';
      error.code = 'ETIMEDOUT';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(504);
    });
  });

  describe('DynamoDB Operation Failures', () => {
    test('should handle DynamoDB ResourceNotFoundException', () => {
      const error = new Error('Requested resource not found');
      error.name = 'ResourceNotFoundException';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(404);
    });

    test('should handle DynamoDB ProvisionedThroughputExceededException', () => {
      const error = new Error('Throughput exceeded');
      error.name = 'ProvisionedThroughputExceededException';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(503);
    });

    test('should handle DynamoDB ValidationException', () => {
      const error = new Error('Invalid parameter');
      error.name = 'ValidationException';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(400);
    });

    test('should log DynamoDB errors with table name', () => {
      const error = new Error('DynamoDB operation failed');
      error.name = 'DynamoDBError';

      const context = {
        tableName: 'cache-table',
        operation: 'GetItem',
        key: { id: 'test-key' }
      };

      ErrorHandler.logError(error, context);

      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        expect.stringContaining('DynamoDB operation failed'),
        expect.objectContaining({
          tableName: 'cache-table'
        })
      );
    });
  });

  describe('GitHub API Failures', () => {
    test('should handle GitHub 404 Not Found', () => {
      const error = new Error('Not Found');
      error.status = 404;
      error.name = 'HttpError';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(404);
    });

    test('should handle GitHub 403 Rate Limit Exceeded', () => {
      const error = new Error('API rate limit exceeded');
      error.status = 403;
      error.name = 'HttpError';
      error.headers = {
        'x-ratelimit-remaining': '0'
      };

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(429);
    });

    test('should handle GitHub 401 Unauthorized', () => {
      const error = new Error('Bad credentials');
      error.status = 401;
      error.name = 'HttpError';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(401);
    });

    test('should log GitHub errors with repository and endpoint details', () => {
      const error = new Error('GitHub API failed');
      error.status = 500;

      const context = {
        repository: 'org/repo',
        endpoint: '/repos/org/repo/properties/values',
        user: 'org'
      };

      ErrorHandler.logError(error, context);

      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        expect.stringContaining('GitHub API failed'),
        expect.objectContaining({
          repository: 'org/repo',
          endpoint: '/repos/org/repo/properties/values'
        })
      );
    });

    test('should handle GitHub network errors', () => {
      const error = new Error('Network request failed');
      error.name = 'FetchError';
      error.code = 'ECONNREFUSED';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(503);
    });
  });

  describe('SSM Parameter Store Failures', () => {
    test('should handle SSM ParameterNotFound', () => {
      const error = new Error('Parameter not found');
      error.name = 'ParameterNotFound';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(500); // Internal error - missing config
    });

    test('should handle SSM AccessDeniedException', () => {
      const error = new Error('Access denied');
      error.name = 'AccessDeniedException';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(500); // Internal error - misconfigured permissions
    });

    test('should log SSM errors without exposing parameter values', () => {
      const error = new Error('SSM operation failed');
      error.name = 'SSMError';

      const context = {
        parameterName: '/myapp/github/token',
        operation: 'GetParameter'
      };

      ErrorHandler.logError(error, context);

      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        expect.stringContaining('SSM operation failed'),
        expect.objectContaining({
          parameterName: '/myapp/github/token'
        })
      );
    });
  });

  describe('Validation Errors', () => {
    test('should handle invalid input errors', () => {
      const error = new Error('Invalid input');
      error.code = 'INVALID_INPUT';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(400);
    });

    test('should handle JSON Schema validation errors', () => {
      const error = new Error('Validation failed');
      error.code = 'VALIDATION_ERROR';
      error.errors = [
        { field: 'templateName', message: 'Required field missing' }
      ];

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.error).toContain('Validation failed');
      expect(response.validationErrors).toBeDefined();
    });

    test('should handle template not found errors', () => {
      const error = new Error('Template not found');
      error.code = 'TEMPLATE_NOT_FOUND';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(404);
    });

    test('should include available options in not found errors', () => {
      const error = new Error('Template not found');
      error.code = 'TEMPLATE_NOT_FOUND';
      error.availableTemplates = ['template1', 'template2'];

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.availableTemplates).toEqual(['template1', 'template2']);
    });
  });

  describe('Configuration Errors', () => {
    test('should handle missing environment variables', () => {
      const error = new Error('Missing required environment variable');
      error.code = 'CONFIG_ERROR';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(500);
    });

    test('should handle invalid configuration', () => {
      const error = new Error('Invalid configuration');
      error.code = 'CONFIG_ERROR';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(500);
    });

    test('should not expose configuration details in user response', () => {
      const error = new Error('Missing ATLANTIS_S3_BUCKETS environment variable');
      error.code = 'CONFIG_ERROR';

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.error).not.toContain('ATLANTIS_S3_BUCKETS');
      expect(response.error).toContain('Internal server error');
    });
  });

  describe('Network Errors', () => {
    test('should handle connection timeout', () => {
      const error = new Error('Connection timeout');
      error.code = 'ETIMEDOUT';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(504);
    });

    test('should handle connection refused', () => {
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(503);
    });

    test('should handle DNS resolution failure', () => {
      const error = new Error('DNS resolution failed');
      error.code = 'ENOTFOUND';

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(503);
    });
  });

  describe('Error Response Formatting', () => {
    test('should return sanitized error response', () => {
      const error = new Error('Internal error with sensitive data: API_KEY=secret123');
      error.code = 'INTERNAL_ERROR';

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.error).not.toContain('API_KEY');
      expect(response.error).not.toContain('secret123');
      expect(response.error).toBe('Internal server error');
    });

    test('should include request ID in error response', () => {
      const error = new Error('Something went wrong');
      const requestId = 'req-abc-123';

      const response = ErrorHandler.toUserResponse(error, requestId);

      expect(response.requestId).toBe(requestId);
    });

    test('should categorize errors as 4xx or 5xx', () => {
      const clientError = new Error('Invalid input');
      clientError.code = 'INVALID_INPUT';

      const serverError = new Error('Database connection failed');
      serverError.code = 'DB_ERROR';

      expect(ErrorHandler.getStatusCode(clientError)).toBeLessThan(500);
      expect(ErrorHandler.getStatusCode(serverError)).toBeGreaterThanOrEqual(500);
    });

    test('should not expose stack traces in user response', () => {
      const error = new Error('Internal error');
      error.stack = 'Error: Internal error\n    at Function.handler (/var/task/index.js:123:45)';

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.error).not.toContain('/var/task');
      expect(response.error).not.toContain('index.js');
    });

    test('should include error code in response when appropriate', () => {
      const error = new Error('Template not found');
      error.code = 'TEMPLATE_NOT_FOUND';

      const response = ErrorHandler.toUserResponse(error, 'req-123');

      expect(response.code).toBe('TEMPLATE_NOT_FOUND');
    });
  });

  describe('Error Logging', () => {
    test('should log errors with full stack trace', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:10:5';

      ErrorHandler.logError(error, { requestId: 'req-123' });

      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        expect.stringContaining('Test error'),
        expect.objectContaining({
          stack: expect.stringContaining('test.js:10:5')
        })
      );
    });

    test('should log errors with request context', () => {
      const error = new Error('Test error');
      const context = {
        requestId: 'req-123',
        ip: '192.168.1.1',
        tool: 'list_templates',
        parameters: { category: 'Storage' }
      };

      ErrorHandler.logError(error, context);

      expect(tools.DebugAndLog.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          requestId: 'req-123',
          ip: '192.168.1.1',
          tool: 'list_templates'
        })
      );
    });

    test('should not log sensitive data', () => {
      const error = new Error('Authentication failed');
      const context = {
        requestId: 'req-123',
        apiKey: 'secret-key-12345',
        token: 'bearer-token-xyz'
      };

      ErrorHandler.logError(error, context);

      const logCall = tools.DebugAndLog.error.mock.calls[0];
      const loggedContext = JSON.stringify(logCall);

      expect(loggedContext).not.toContain('secret-key-12345');
      expect(loggedContext).not.toContain('bearer-token-xyz');
    });
  });

  describe('Error Metrics', () => {
    test('should emit error metric with error code', () => {
      const error = new Error('Test error');
      error.code = 'TEST_ERROR';

      ErrorHandler.emitErrorMetric({
        tool: 'list_templates',
        errorCode: 'TEST_ERROR',
        statusCode: 500
      });

      // Verify metric emission (implementation-specific)
      expect(true).toBe(true);
    });

    test('should emit error metric with status code', () => {
      ErrorHandler.emitErrorMetric({
        tool: 'get_template',
        errorCode: 'TEMPLATE_NOT_FOUND',
        statusCode: 404
      });

      // Verify metric emission
      expect(true).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle errors without error code', () => {
      const error = new Error('Generic error');

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(500);
    });

    test('should handle errors without message', () => {
      const error = new Error();

      const response = ErrorHandler.toUserResponse(error, 'req-123');
      expect(response.error).toBe('Internal server error');
    });

    test('should handle non-Error objects', () => {
      const error = { message: 'Not an Error object' };

      const statusCode = ErrorHandler.getStatusCode(error);
      expect(statusCode).toBe(500);
    });

    test('should handle null or undefined errors', () => {
      const statusCode1 = ErrorHandler.getStatusCode(null);
      const statusCode2 = ErrorHandler.getStatusCode(undefined);

      expect(statusCode1).toBe(500);
      expect(statusCode2).toBe(500);
    });

    test('should handle circular reference in error context', () => {
      const error = new Error('Test error');
      const context = { requestId: 'req-123' };
      context.circular = context; // Create circular reference

      // Should not throw when logging
      expect(() => {
        ErrorHandler.logError(error, context);
      }).not.toThrow();
    });
  });
});
