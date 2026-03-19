/**
 * Unit tests for Read Lambda handler
 *
 * Tests the main Lambda handler function including:
 * - Cold start initialization
 * - Rate limiting
 * - Request routing
 * - Error handling
 * - Response format
 */

// Mock @63klabs/cache-data before any imports
const mockResponseInstance = {
  addHeader: jest.fn().mockReturnThis(),
  setBody: jest.fn().mockReturnThis(),
  finalize: jest.fn().mockReturnValue({
    statusCode: 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Error initializing request - 1701-D' })
  })
};

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    Response: jest.fn().mockImplementation(() => mockResponseInstance),
    Timer: jest.fn().mockImplementation(() => ({
      isRunning: jest.fn().mockReturnValue(false),
      stop: jest.fn().mockReturnValue('timer stopped')
    }))
  }
}));

// Mock Config
jest.mock('../../../config', () => ({
  Config: {
    init: jest.fn(),
    promise: jest.fn().mockResolvedValue(undefined),
    prime: jest.fn().mockResolvedValue(undefined),
    settings: jest.fn(),
    getConnCacheProfile: jest.fn()
  }
}));

jest.mock('../../../routes');
jest.mock('../../../utils/rate-limiter', () => ({
  checkRateLimit: jest.fn(),
  createRateLimitResponse: jest.fn()
}));
jest.mock('../../../utils/error-handler');

const { Config } = require('../../../config');
const Routes = require('../../../routes');
const RateLimiter = require('../../../utils/rate-limiter');
const { tools } = require('@63klabs/cache-data');

// Import handler after mocks are set up
const { handler } = require('../../../index');

describe('Read Lambda Handler', () => {
  let mockEvent;
  let mockContext;

  beforeEach(() => {
    jest.clearAllMocks();

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
    Config.promise.mockResolvedValue(undefined);
    Config.prime.mockResolvedValue(undefined);
    Config.settings.mockReturnValue({
      rateLimits: {
        public: { limit: 100, window: 3600 }
      }
    });

    // Default rate limit check - allowed
    RateLimiter.checkRateLimit.mockResolvedValue({
      allowed: true,
      headers: {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '99',
        'X-RateLimit-Reset': '3600'
      }
    });

    // Default Routes.process mock - returns a Response-like object
    const mockRouteResponse = {
      finalize: jest.fn().mockReturnValue({
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: 'success' })
      }),
      getProps: jest.fn().mockReturnValue({
        statusCode: 200,
        cacheHit: false
      })
    };
    Routes.process.mockResolvedValue(mockRouteResponse);
  });

  describe('Cold Start Initialization', () => {
    test('should await Config.promise() on invocation', async () => {
      await handler(mockEvent, mockContext);

      expect(Config.promise).toHaveBeenCalledTimes(1);
    });

    test('should await Config.prime() on invocation', async () => {
      await handler(mockEvent, mockContext);

      expect(Config.prime).toHaveBeenCalledTimes(1);
    });

    test('should handle Config.promise() failure', async () => {
      Config.promise.mockRejectedValue(new Error('Failed to initialize'));

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(500);
    });

    test('should continue processing after successful initialization', async () => {
      await handler(mockEvent, mockContext);

      expect(Routes.process).toHaveBeenCalledWith(mockEvent, mockContext);
    });
  });

  describe('Rate Limiting', () => {
    test('should check rate limit before processing request', async () => {
      await handler(mockEvent, mockContext);

      expect(RateLimiter.checkRateLimit).toHaveBeenCalledWith(
        mockEvent,
        expect.objectContaining({
          public: expect.any(Object)
        })
      );
    });

    test('should return 429 when rate limit exceeded', async () => {
      RateLimiter.checkRateLimit.mockResolvedValue({
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
    });

    test('should handle GET requests', async () => {
      mockEvent.httpMethod = 'GET';
      mockEvent.body = null;
      mockEvent.queryStringParameters = {
        tool: 'list_templates'
      };

      await handler(mockEvent, mockContext);

      expect(Routes.process).toHaveBeenCalledWith(mockEvent, mockContext);
    });
  });

  describe('Error Handling', () => {
    test('should catch and handle routing errors', async () => {
      Routes.process.mockRejectedValue(new Error('Routing failed'));

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(500);
    });

    test('should log errors via DebugAndLog.error', async () => {
      Routes.process.mockRejectedValue(new Error('Routing failed'));

      await handler(mockEvent, mockContext);

      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('should include request ID in error response headers', async () => {
      // Create a fresh mock Response for the error path
      const mockErrorResponse = {
        addHeader: jest.fn().mockReturnThis(),
        setBody: jest.fn().mockReturnThis(),
        finalize: jest.fn().mockReturnValue({
          statusCode: 500,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Id': 'test-request-id',
            'X-MCP-Version': '1.0'
          },
          body: JSON.stringify({ message: 'Error initializing request - 1701-D', requestId: 'test-request-id' })
        })
      };
      tools.Response.mockImplementation(() => mockErrorResponse);

      Routes.process.mockRejectedValue(new Error('Internal error'));

      const response = await handler(mockEvent, mockContext);

      expect(response.headers).toHaveProperty('X-Request-Id', 'test-request-id');
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

    test('should include MCP and CORS headers in response', async () => {
      const response = await handler(mockEvent, mockContext);

      expect(response.headers).toHaveProperty('X-MCP-Version', '1.0');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
    });

    test('should merge rate limit headers with response headers', async () => {
      const response = await handler(mockEvent, mockContext);

      expect(response.headers).toHaveProperty('Content-Type');
      expect(response.headers).toHaveProperty('X-RateLimit-Limit');
      expect(response.headers).toHaveProperty('X-RateLimit-Remaining');
    });
  });
});
