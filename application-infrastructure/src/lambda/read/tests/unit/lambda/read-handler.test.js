/**
 * Unit tests for Read Lambda handler
 *
 * Tests the main Lambda handler function including:
 * - Cold start initialization
 * - ClientRequest and Response creation
 * - Rate limiting
 * - Request routing with new signature
 * - Error handling with ClientRequest-linked Response
 * - Response format
 */

// Mock ClientRequest instance
const mockClientRequestInstance = {
  getProps: jest.fn().mockReturnValue({ path: '/mcp/v1', method: 'POST' })
};

// Mock Response instance for happy path
const mockResponseInstance = {
  addHeader: jest.fn().mockReturnThis(),
  setBody: jest.fn().mockReturnThis(),
  setStatusCode: jest.fn().mockReturnThis(),
  finalize: jest.fn().mockReturnValue({
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '99',
      'X-RateLimit-Reset': '3600',
      'X-MCP-Version': '1.0'
    },
    body: JSON.stringify({ result: 'success' })
  })
};

// Track ClientRequest and Response constructor calls
const mockClientRequestConstructor = jest.fn().mockReturnValue(mockClientRequestInstance);
const mockResponseConstructor = jest.fn().mockReturnValue(mockResponseInstance);

jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    },
    ClientRequest: mockClientRequestConstructor,
    Response: mockResponseConstructor,
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

    mockContext = {
      requestId: 'test-request-id',
      awsRequestId: 'test-aws-request-id',
      functionName: 'test-function',
      getRemainingTimeInMillis: () => 30000
    };

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

    // Routes.process is now void
    Routes.process.mockResolvedValue(undefined);

    // Reset Response finalize to default happy-path return
    mockResponseInstance.finalize.mockReturnValue({
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '99',
        'X-RateLimit-Reset': '3600',
        'X-MCP-Version': '1.0'
      },
      body: JSON.stringify({ result: 'success' })
    });
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

      // When Config fails, response is null so a standalone Response is created
      const standaloneResponse = {
        addHeader: jest.fn().mockReturnThis(),
        setBody: jest.fn().mockReturnThis(),
        setStatusCode: jest.fn().mockReturnThis(),
        finalize: jest.fn().mockReturnValue({
          statusCode: 500,
          headers: {},
          body: JSON.stringify({ message: 'Error initializing request - 1701-D' })
        })
      };
      mockResponseConstructor.mockReturnValueOnce(standaloneResponse);

      const response = await handler(mockEvent, mockContext);
      expect(response.statusCode).toBe(500);
    });

    test('should continue processing after successful initialization', async () => {
      await handler(mockEvent, mockContext);
      expect(Routes.process).toHaveBeenCalled();
    });
  });

  describe('ClientRequest and Response Creation', () => {
    test('should create ClientRequest with event and context', async () => {
      await handler(mockEvent, mockContext);
      expect(mockClientRequestConstructor).toHaveBeenCalledWith(mockEvent, mockContext);
    });

    test('should create Response with the ClientRequest instance', async () => {
      await handler(mockEvent, mockContext);
      expect(mockResponseConstructor).toHaveBeenCalledWith(mockClientRequestInstance);
    });
  });

  describe('Rate Limiting', () => {
    test('should check rate limit before processing request', async () => {
      await handler(mockEvent, mockContext);
      expect(RateLimiter.checkRateLimit).toHaveBeenCalledWith(
        mockEvent,
        expect.objectContaining({ public: expect.any(Object) })
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
        body: JSON.stringify({ error: 'Rate limit exceeded', retryAfter: 3600 })
      });

      const response = await handler(mockEvent, mockContext);
      expect(response.statusCode).toBe(429);
      expect(Routes.process).not.toHaveBeenCalled();
    });

    test('should add rate limit headers via response.addHeader()', async () => {
      await handler(mockEvent, mockContext);
      expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
      expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '99');
      expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('X-RateLimit-Reset', '3600');
    });

    test('should add X-MCP-Version header via response.addHeader()', async () => {
      await handler(mockEvent, mockContext);
      expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('X-MCP-Version', '1.0');
    });
  });

  describe('Request Processing', () => {
    test('should delegate to Routes.process() with new signature', async () => {
      await handler(mockEvent, mockContext);
      expect(Routes.process).toHaveBeenCalledWith(
        mockClientRequestInstance,
        mockResponseInstance,
        mockEvent,
        mockContext
      );
    });

    test('should call response.finalize() and return its value', async () => {
      const response = await handler(mockEvent, mockContext);
      expect(mockResponseInstance.finalize).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(200);
    });

    test('should not manually add CORS headers', async () => {
      await handler(mockEvent, mockContext);
      // CORS headers should NOT be added manually — Response.finalize() handles them
      const addHeaderCalls = mockResponseInstance.addHeader.mock.calls.map(c => c[0]);
      expect(addHeaderCalls).not.toContain('Access-Control-Allow-Origin');
      expect(addHeaderCalls).not.toContain('Access-Control-Allow-Methods');
      expect(addHeaderCalls).not.toContain('Access-Control-Allow-Headers');
    });
  });

  describe('Error Handling', () => {
    test('should catch and handle routing errors', async () => {
      Routes.process.mockRejectedValue(new Error('Routing failed'));
      // Error path creates standalone Response since the existing one triggers setStatusCode
      mockResponseInstance.setStatusCode.mockReturnThis();
      mockResponseInstance.finalize.mockReturnValue({
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Error initializing request - 1701-D', requestId: 'test-request-id' })
      });

      const response = await handler(mockEvent, mockContext);
      expect(response.statusCode).toBe(500);
    });

    test('should log errors via DebugAndLog.error', async () => {
      Routes.process.mockRejectedValue(new Error('Routing failed'));
      await handler(mockEvent, mockContext);
      expect(tools.DebugAndLog.error).toHaveBeenCalled();
    });

    test('should reuse existing response when available (calls setStatusCode(500))', async () => {
      Routes.process.mockRejectedValue(new Error('Routing failed'));
      mockResponseInstance.finalize.mockReturnValue({
        statusCode: 500,
        headers: { 'X-Request-Id': 'test-request-id', 'X-MCP-Version': '1.0' },
        body: JSON.stringify({ message: 'Error initializing request - 1701-D', requestId: 'test-request-id' })
      });

      await handler(mockEvent, mockContext);

      // Response was already created before Routes.process threw, so setStatusCode is called
      expect(mockResponseInstance.setStatusCode).toHaveBeenCalledWith(500);
    });

    test('should create standalone Response when response is null (Config failure)', async () => {
      Config.promise.mockRejectedValue(new Error('Config failed'));

      // The error happens before ClientRequest/Response creation, so a new Response is created
      const standaloneResponse = {
        addHeader: jest.fn().mockReturnThis(),
        setBody: jest.fn().mockReturnThis(),
        setStatusCode: jest.fn().mockReturnThis(),
        finalize: jest.fn().mockReturnValue({
          statusCode: 500,
          headers: { 'X-Request-Id': 'test-request-id' },
          body: JSON.stringify({ message: 'Error initializing request - 1701-D', requestId: 'test-request-id' })
        })
      };
      mockResponseConstructor.mockReturnValueOnce(standaloneResponse);

      const response = await handler(mockEvent, mockContext);

      expect(response.statusCode).toBe(500);
      // Standalone Response is created with {statusCode: 500}
      expect(mockResponseConstructor).toHaveBeenCalledWith({ statusCode: 500 });
    });

    test('should add X-Request-Id and X-MCP-Version headers in catch block', async () => {
      Routes.process.mockRejectedValue(new Error('Internal error'));
      mockResponseInstance.finalize.mockReturnValue({
        statusCode: 500,
        headers: { 'X-Request-Id': 'test-request-id', 'X-MCP-Version': '1.0' },
        body: JSON.stringify({ message: 'Error initializing request - 1701-D', requestId: 'test-request-id' })
      });

      await handler(mockEvent, mockContext);

      expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('X-Request-Id', 'test-request-id');
      expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('X-MCP-Version', '1.0');
    });

    test('should not manually add CORS headers in catch block', async () => {
      Routes.process.mockRejectedValue(new Error('Internal error'));
      mockResponseInstance.finalize.mockReturnValue({
        statusCode: 500,
        headers: {},
        body: '{}'
      });

      await handler(mockEvent, mockContext);

      // Collect only the addHeader calls from the catch block (after the error)
      // The catch block should NOT add CORS headers manually
      const allCalls = mockResponseInstance.addHeader.mock.calls.map(c => c[0]);
      // Filter to only catch-block calls: X-Request-Id and X-MCP-Version are catch-block specific
      // CORS headers should not appear at all
      expect(allCalls).not.toContain('Access-Control-Allow-Origin');
      expect(allCalls).not.toContain('Access-Control-Allow-Methods');
      expect(allCalls).not.toContain('Access-Control-Allow-Headers');
      expect(allCalls).not.toContain('Content-Type');
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

    test('should include MCP header in response via addHeader', async () => {
      await handler(mockEvent, mockContext);
      expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('X-MCP-Version', '1.0');
    });

    test('should include rate limit headers via addHeader', async () => {
      await handler(mockEvent, mockContext);
      expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '100');
      expect(mockResponseInstance.addHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '99');
    });
  });
});
