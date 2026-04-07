/**
 * Property-Based Tests for ClientRequest/Response Refactoring
 *
 * Validates correctness properties from the design document:
 * - Property 1: JSON-RPC Router result transfer preserves statusCode, body, and headers
 * - Property 2: Error responses always have statusCode 500 with message and requestId
 * - Property 3: Final response includes all custom headers (rate-limit and MCP)
 *
 * Tag: Feature: use-client-request-and-response-classes
 */

const fc = require('fast-check');

// --- Mocks ---
const mockClientRequestInstance = {
  getProps: jest.fn().mockReturnValue({ path: 'mcp/v1', method: 'POST', pathArray: ['mcp', 'v1'] })
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
    ClientRequest: jest.fn().mockImplementation(() => mockClientRequestInstance),
    Response: jest.fn().mockImplementation((arg) => {
      let mockSc = arg?.statusCode || 200;
      let mockBd = null;
      const mockHd = {};
      return {
        setStatusCode: jest.fn((code) => { mockSc = code; }),
        setBody: jest.fn((b) => { mockBd = b; }),
        addHeader: jest.fn((name, value) => { mockHd[name] = value; }),
        finalize: jest.fn(() => ({
          statusCode: mockSc,
          headers: { 'Content-Type': 'application/json', ...mockHd },
          body: typeof mockBd === 'string' ? mockBd : JSON.stringify(mockBd)
        }))
      };
    }),
    Timer: jest.fn().mockImplementation(() => ({
      isRunning: jest.fn().mockReturnValue(false),
      stop: jest.fn().mockReturnValue('timer stopped')
    }))
  }
}));

jest.mock('../../config', () => ({
  Config: {
    init: jest.fn(),
    promise: jest.fn().mockResolvedValue(undefined),
    prime: jest.fn().mockResolvedValue(undefined),
    settings: jest.fn().mockReturnValue({
      rateLimits: { public: { limit: 100, window: 3600 } }
    })
  }
}));

const mockHandleJsonRpc = jest.fn();
jest.mock('../../utils/json-rpc-router', () => ({
  handleJsonRpc: mockHandleJsonRpc,
  buildResponse: jest.fn()
}));

jest.mock('../../utils/mcp-protocol', () => ({
  jsonRpcError: jest.fn().mockReturnValue({ jsonrpc: '2.0', error: { code: -32601 }, id: null }),
  JSON_RPC_ERRORS: { METHOD_NOT_FOUND: -32601 }
}));

const mockCheckRateLimit = jest.fn();
jest.mock('../../utils/rate-limiter', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: jest.fn()
}));

jest.mock('../../utils/error-handler');

// Explicitly mock Routes with a jest.fn so we can use mockReset/mockResolvedValue
jest.mock('../../routes', () => ({
  process: jest.fn().mockResolvedValue(undefined)
}));

const Routes = require('../../routes');
const { Config } = require('../../config');
const { handler } = require('../../index');

const MANAGED_HEADERS = [
  'content-type',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers'
];

describe('Feature: use-client-request-and-response-classes', () => {

  // ---------------------------------------------------------------
  // Property 1: JSON-RPC Router result transfer
  // ---------------------------------------------------------------
  describe('Property 1: JSON-RPC Router result transfer preserves statusCode, body, and headers', () => {
    // Use the real Routes.process for this property (not the mock)
    const RealRoutes = jest.requireActual('../../routes');

    test('For any JSON-RPC Router response, Routes transfers statusCode, body, and non-CORS headers', () => {
      return fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 599 }),
          fc.jsonValue(),
          fc.dictionary(
            fc.stringMatching(/^X-[A-Za-z0-9-]+$/),
            fc.string({ minLength: 1, maxLength: 50 })
          ),
          async (statusCode, bodyValue, customHeaders) => {
            const jsonBody = JSON.stringify(bodyValue);
            const allHeaders = { 'Content-Type': 'application/json', ...customHeaders };

            mockHandleJsonRpc.mockReset();
            mockHandleJsonRpc.mockResolvedValue({
              statusCode,
              headers: allHeaders,
              body: jsonBody
            });

            const mockResponse = {
              setStatusCode: jest.fn(),
              setBody: jest.fn(),
              addHeader: jest.fn()
            };

            const mockCr = {
              getProps: () => ({ path: 'mcp/v1', method: 'POST' })
            };

            const event = { path: '/mcp/v1', httpMethod: 'POST', body: '{}' };
            const context = { requestId: 'test' };

            await RealRoutes.process(mockCr, mockResponse, event, context);

            expect(mockResponse.setStatusCode).toHaveBeenCalledWith(statusCode);
            expect(mockResponse.setBody).toHaveBeenCalledWith(bodyValue);

            for (const [name, value] of Object.entries(customHeaders)) {
              if (!MANAGED_HEADERS.includes(name.toLowerCase())) {
                expect(mockResponse.addHeader).toHaveBeenCalledWith(name, value);
              }
            }

            const addedHeaders = mockResponse.addHeader.mock.calls.map(c => c[0].toLowerCase());
            for (const managed of MANAGED_HEADERS) {
              expect(addedHeaders).not.toContain(managed);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ---------------------------------------------------------------
  // Property 2: Error responses always have statusCode 500
  // ---------------------------------------------------------------
  describe('Property 2: Error responses always have statusCode 500 with message and requestId', () => {
    test('For any error during processing, handler returns statusCode 500 with message and requestId', () => {
      return fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          (errorMessage, requestId) => {
            // Set up mocks for this iteration
            Config.promise.mockReset();
            Config.promise.mockResolvedValue(undefined);
            Config.prime.mockReset();
            Config.prime.mockResolvedValue(undefined);
            Config.settings.mockReturnValue({
              rateLimits: { public: { limit: 100, window: 3600 } }
            });
            mockClientRequestInstance.getProps.mockReturnValue({
              path: 'mcp/v1', method: 'POST', pathArray: ['mcp', 'v1']
            });

            mockCheckRateLimit.mockReset();
            mockCheckRateLimit.mockResolvedValue({
              allowed: true,
              headers: { 'X-RateLimit-Limit': '100' }
            });

            // Make Routes.process throw
            Routes.process.mockReset();
            Routes.process.mockRejectedValue(new Error(errorMessage));

            const event = {
              httpMethod: 'POST',
              path: '/mcp/v1',
              body: '{}',
              requestContext: { requestId }
            };
            const context = { awsRequestId: requestId };

            return handler(event, context).then((response) => {
              expect(response.statusCode).toBe(500);
              const body = JSON.parse(response.body);
              expect(body).toHaveProperty('message');
              expect(body).toHaveProperty('requestId');
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    test('For errors before ClientRequest creation, handler still returns statusCode 500', () => {
      return fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          (errorMessage) => {
            Config.promise.mockReset();
            Config.promise.mockRejectedValue(new Error(errorMessage));

            const event = {
              httpMethod: 'POST',
              path: '/mcp/v1',
              body: '{}',
              requestContext: { requestId: 'test-id' }
            };
            const context = { awsRequestId: 'test-id' };

            return handler(event, context).then((response) => {
              expect(response.statusCode).toBe(500);
              const body = JSON.parse(response.body);
              expect(body).toHaveProperty('message');
              expect(body).toHaveProperty('requestId');
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ---------------------------------------------------------------
  // Property 3: Final response includes all custom headers
  // ---------------------------------------------------------------
  describe('Property 3: Final response includes all custom headers (rate-limit and MCP)', () => {
    test('For any rate-limit values, finalized response contains all rate-limit headers and X-MCP-Version', () => {
      return fc.assert(
        fc.asyncProperty(
          fc.nat({ max: 10000 }),
          fc.nat({ max: 10000 }),
          fc.nat({ max: 9999999999 }),
          async (limit, remaining, reset) => {
            // Set up mocks for this iteration
            Config.promise.mockReset();
            Config.promise.mockResolvedValue(undefined);
            Config.prime.mockReset();
            Config.prime.mockResolvedValue(undefined);
            Config.settings.mockReturnValue({
              rateLimits: { public: { limit: 100, window: 3600 } }
            });
            mockClientRequestInstance.getProps.mockReturnValue({
              path: 'mcp/v1', method: 'POST', pathArray: ['mcp', 'v1']
            });

            mockCheckRateLimit.mockReset();
            mockCheckRateLimit.mockResolvedValue({
              allowed: true,
              headers: {
                'X-RateLimit-Limit': String(limit),
                'X-RateLimit-Remaining': String(remaining),
                'X-RateLimit-Reset': String(reset)
              }
            });

            // Routes.process succeeds (void)
            Routes.process.mockReset();
            Routes.process.mockResolvedValue(undefined);

            const event = {
              httpMethod: 'POST',
              path: '/mcp/v1',
              body: '{}',
              requestContext: { requestId: 'test-id' }
            };
            const context = { awsRequestId: 'test-id' };

            return handler(event, context).then((response) => {
              expect(response.headers['X-RateLimit-Limit']).toBe(String(limit));
              expect(response.headers['X-RateLimit-Remaining']).toBe(String(remaining));
              expect(response.headers['X-RateLimit-Reset']).toBe(String(reset));
              expect(response.headers['X-MCP-Version']).toBe('1.0');
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
