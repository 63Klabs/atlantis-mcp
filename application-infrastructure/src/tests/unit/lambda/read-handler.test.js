/**
 * Unit tests for Read Lambda handler
 *
 * Tests the main Lambda handler function including:
 * - Cold start initialization
 * - Rate limiting
 * - Request routing
 * - Error handling
 * - Logging and metrics
 */

const { mockClient } = require('aws-sdk-client-mock');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

// Mock AWS SDK clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const ssmMock = mockClient(SSMClient);

// Mock dependencies
jest.mock('../../../lambda/read/config');
jest.mock('../../../lambda/read/routes');
jest.mock('../../../lambda/read/utils/rate-limiter');
jest.mock('../../../lambda/read/utils/error-handler');

const Config = require('../../../lambda/read/config');
const Routes = require('../../../lambda/read/routes');
const RateLimiter = require('../../../lambda/read/utils/rate-limiter');
const ErrorHandler = require('../../../lambda/read/utils/error-handler');

// Import handler after mocks are set up
const { handler } = require('../../../lambda/read/index');

describe('Read Lambda Handler', () => {
  let mockEvent;
  let mockContext;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    ddbMock.reset();
    s3Mock.reset();
    ssmMock.reset();

    // Set up default environment variables
    process.env.PUBLIC_RATE_LIMIT = '100';
    process.env.ATLANTIS_S3_BUCKETS = 'bucket1,bucket2';
    process.env.ATLANTIS_GITHUB_USER_ORGS = 'org1,org2';

    // Create mock event
    mockEvent = {
      httpMethod: 'POST',
      path: '/mcp',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tool: 'list_templates',
        input: {}
      }),
      queryStringParameters: null,
      requestContext: {
        requestId: 'test-request-id',
        identity: {
          sourceIp: '192.168.1.1'
        }
      }
    };

    // Create mock context
    mockContext = {
      requestId: 'test-request-id',
      functionName: 'test-function',
      getRemainingTimeInMillis: () => 30000
    };

    // Set up default mock implementations
    Config.init.mockResolvedValue(undefined);

    RateLimiter.checkRateLimit.mockReturnValue({
      allowed: true,
      headers: {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '99',
        'X-RateLimit-Reset': '3600'
      }
    });

    const mockResponse = {
      toAPIGateway: jest.fn().mockReturnValue({
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: 'success' })
      }),
      getProps: jest.fn().mockReturnValue({
        statusCode: 200,
        cacheHit: false
      })
    };
    Routes.process.mockResolvedValue(mockResponse);

    ErrorHandler.logRequest.mockImplementation(() => {});
    ErrorHandler.emitLatencyMetric.mockImplementation(() => {});
    ErrorHandler.logError.mockImplementation(() => {});
    ErrorHandler.emitErrorMetric.mockImplementation(() => {});
    ErrorHandler.getStatusCode.mockReturnValue(500);
    ErrorHandler.toUserResponse.mockReturnValue({
      error: 'Internal server error',
      requestId: 'test-request-id'
    });
  });

  afterEach(() => {
    delete process.env.PUBLIC_RATE_LIMIT;
    delete process.env.ATLANTIS_S3_BUCKETS;
    delete process.env.ATLANTIS_GITHUB_USER_ORGS;
  });

  describe('Cold Start Initialization', () => {
    test('should call Config.init() on first invocation', async () => {
      await handler(mockEvent, mockContext);

      expect(Config.init).toHaveBeenCalledTimes(1);
    });

    test('should handle Config.init() failure', async () => {
      const initError = new Error('Failed to initialize cache');
      Config.init.mockRejectedValue(initError);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(500);
      expect(ErrorHandler.logError).toHaveBeenCalledWith(
        initError,
        expect.objectContaining({
          requestId: 'test-request-id',
          ip: '192.168.1.1'
        })
      );
    });

    test('should continue processing after successful initialization', async () => {
      await handler(mockEvent, mockContext);

      expect(Routes.process).toHaveBeenCalledWith(mockEvent, mockContext);
    });
  });

  describe('Rate Limiting', () => {
    test('should check rate limit before processing request', async () => {
      await handler(mockEvent, mockContext);

      expect(RateLimiter.checkRateLimit).toHaveBeenCalledWith(mockEvent, 100);
    });

    test('should use PUBLIC_RATE_LIMIT environment variable', async () => {
      process.env.PUBLIC_RATE_LIMIT = '50';

      await handler(mockEvent, mockContext);

      expect(RateLimiter.checkRateLimit).toHaveBeenCalledWith(mockEvent, 50);
    });

    test('should default to 100 if PUBLIC_RATE_LIMIT not set', async () => {
      delete process.env.PUBLIC_RATE_LIMIT;

      await handler(mockEvent, mockContext);

      expect(RateLimiter.checkRateLimit).toHaveBeenCalledWith(mockEvent, 100);
    });

    test('should return 429 when rate limit exceeded', async () => {
      RateLimiter.checkRateLimit.mockReturnValue({
        allowed: false,
        headers: {
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': '3600'
        },
        retryAfter: 3600
      });

      RateLimiter.createRateLimitResponse.mockReturnValue({
        statusCode: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '3600',
          'X-RateLimit-Limit': '100',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': '3600'
        },
        body: JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter: 3600
        })
      });

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(429);
      expect(response.headers).toHaveProperty('Retry-After', '3600');
      expect(Routes.process).not.toHaveBeenCalled();
    });

    test('should include rate limit headers in successful response', async () => {
      const response = await handler(mockEvent, mockContext);

      expect(response.headers).toHaveProperty('X-RateLimit-Limit', '100');
      expect(response.headers).toHaveProperty('X-RateLimit-Remaining', '99');
      expect(response.headers).toHaveProperty('X-RateLimit-Reset', '3600');
    });
  });

  describe('Request Processing', () => {
    test('should delegate to Routes.process()', async () => {
      await handler(mockEvent, mockContext);

      expect(Routes.process).toHaveBeenCalledWith(mockEvent, mockContext);
    });

    test('should return response from Routes.process()', async () => {
      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(JSON.stringify({ result: 'success' }));
    });

    test('should handle GET requests with query parameters', async () => {
      mockEvent.httpMethod = 'GET';
      mockEvent.body = null;
      mockEvent.queryStringParameters = {
        tool: 'list_templates'
      };

      await handler(mockEvent, mockContext);

      expect(Routes.process).toHaveBeenCalledWith(mockEvent, mockContext);
    });
  });

  describe('Logging and Metrics', () => {
    test('should log successful request with execution time', async () => {
      await handler(mockEvent, mockContext);

      expect(ErrorHandler.logRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'list_templates',
          method: 'POST',
          path: '/mcp',
          ip: '192.168.1.1',
          requestId: 'test-request-id',
          statusCode: 200,
          cacheHit: false
        })
      );
    });

    test('should emit latency metric for successful request', async () => {
      await handler(mockEvent, mockContext);

      expect(ErrorHandler.emitLatencyMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'list_templates',
          cacheHit: false
        })
      );
    });

    test('should include cache hit status in metrics', async () => {
      const mockResponse = {
        toAPIGateway: jest.fn().mockReturnValue({
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result: 'success' })
        }),
        getProps: jest.fn().mockReturnValue({
          statusCode: 200,
          cacheHit: true
        })
      };
      Routes.process.mockResolvedValue(mockResponse);

      await handler(mockEvent, mockContext);

      expect(ErrorHandler.logRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheHit: true
        })
      );
    });
  });

  describe('Error Handling', () => {
    test('should catch and handle routing errors', async () => {
      const routingError = new Error('Routing failed');
      Routes.process.mockRejectedValue(routingError);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(500);
      expect(ErrorHandler.logError).toHaveBeenCalledWith(
        routingError,
        expect.objectContaining({
          requestId: 'test-request-id',
          ip: '192.168.1.1',
          tool: 'list_templates'
        })
      );
    });

    test('should emit error metric on failure', async () => {
      const routingError = new Error('Routing failed');
      routingError.code = 'ROUTING_ERROR';
      Routes.process.mockRejectedValue(routingError);
      ErrorHandler.getStatusCode.mockReturnValue(500);

      await handler(mockEvent, mockContext);

      expect(ErrorHandler.emitErrorMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'list_templates',
          errorCode: 'ROUTING_ERROR',
          statusCode: 500
        })
      );
    });

    test('should emit latency metric even on error', async () => {
      Routes.process.mockRejectedValue(new Error('Routing failed'));

      await handler(mockEvent, mockContext);

      expect(ErrorHandler.emitLatencyMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'list_templates',
          cacheHit: false
        })
      );
    });

    test('should return sanitized error response', async () => {
      Routes.process.mockRejectedValue(new Error('Internal error with sensitive data'));

      const response = await handler(mockEvent, mockContext);

      expect(response.body).toBe(JSON.stringify({
        error: 'Internal server error',
        requestId: 'test-request-id'
      }));
      expect(response.headers).toHaveProperty('X-Request-Id', 'test-request-id');
    });

    test('should handle missing sourceIp gracefully', async () => {
      mockEvent.requestContext.identity.sourceIp = undefined;

      await handler(mockEvent, mockContext);

      expect(ErrorHandler.logRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          ip: 'unknown'
        })
      );
    });

    test('should handle malformed JSON in request body', async () => {
      mockEvent.body = 'invalid json';

      await handler(mockEvent, mockContext);

      // Should still attempt to process, error will be caught
      expect(ErrorHandler.logError).toHaveBeenCalled();
    });
  });

  describe('Response Format', () => {
    test('should return API Gateway compatible response', async () => {
      const response = await handler(mockEvent, mockContext);

      expect(response).toHaveProperty('statusCode');
      expect(response).toHaveProperty('headers');
      expect(response).toHaveProperty('body');
      expect(typeof response.body).toBe('string');
    });

    test('should include Content-Type header', async () => {
      const response = await handler(mockEvent, mockContext);

      expect(response.headers).toHaveProperty('Content-Type', 'application/json');
    });

    test('should merge rate limit headers with response headers', async () => {
      const response = await handler(mockEvent, mockContext);

      expect(response.headers).toHaveProperty('Content-Type');
      expect(response.headers).toHaveProperty('X-RateLimit-Limit');
      expect(response.headers).toHaveProperty('X-RateLimit-Remaining');
    });
  });
});
