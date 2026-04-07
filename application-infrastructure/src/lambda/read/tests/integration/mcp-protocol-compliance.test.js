/**
 * MCP Protocol Compliance Tests
 *
 * Tests that the Atlantis MCP Server complies with the Model Context Protocol v1.0 specification.
 * These tests verify protocol negotiation, capability discovery, tool listing, tool invocation,
 * error responses, and JSON Schema validation.
 */

// Mock @63klabs/cache-data to provide ClientRequest and Response
jest.mock('@63klabs/cache-data', () => {
  const actual = jest.requireActual('@63klabs/cache-data');
  return {
    ...actual,
    tools: {
      ...actual.tools,
      ClientRequest: jest.fn().mockImplementation((event) => ({
        getProps: () => ({
          path: event.path || event.requestContext?.resourcePath || '',
          method: event.httpMethod || '',
          pathArray: (event.path || '').split('/').filter(Boolean)
        })
      })),
      Response: jest.fn().mockImplementation((arg) => {
        let statusCode = arg?.statusCode || 200;
        let body = null;
        const headers = {};
        return {
          setStatusCode: jest.fn().mockImplementation((code) => { statusCode = code; }),
          setBody: jest.fn().mockImplementation((b) => { body = b; }),
          addHeader: jest.fn().mockImplementation((name, value) => { headers[name] = value; }),
          finalize: jest.fn().mockImplementation(() => ({
            statusCode,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: typeof body === 'string' ? body : JSON.stringify(body)
          }))
        };
      }),
      Timer: jest.fn().mockImplementation(() => ({
        isRunning: jest.fn().mockReturnValue(false),
        stop: jest.fn().mockReturnValue('timer stopped')
      }))
    }
  };
});

// Mock Config module before importing handler
jest.mock('../../config', () => ({
  Config: {
    init: jest.fn().mockResolvedValue(undefined),
    promise: jest.fn().mockResolvedValue(undefined),
    prime: jest.fn().mockResolvedValue(undefined),
    settings: jest.fn().mockReturnValue({
      s3: { buckets: ['test-bucket'] },
      github: { 
        userOrgs: ['test-org'],
        token: { getValue: jest.fn().mockResolvedValue('test-token') }
      },
      cache: { dynamoDbTable: 'test-table', s3Bucket: 'test-cache-bucket' },
      aws: { region: 'us-east-1' },
      logging: { level: 'INFO' },
      rateLimits: {
        public: { limit: 100, window: 3600 }
      }
    }),
    getConnCacheProfile: jest.fn(),
    isInitialized: jest.fn().mockReturnValue(true)
  }
}));

// Mock RateLimiter to always allow requests
jest.mock('../../utils/rate-limiter', () => ({
  checkRateLimit: jest.fn().mockReturnValue({
    allowed: true,
    headers: {
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '99',
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600)
    }
  }),
  createRateLimitResponse: jest.fn()
}));

// Mock controllers to avoid real AWS service calls during integration tests
jest.mock('../../controllers', () => ({
  Templates: {
    list: jest.fn().mockResolvedValue({ success: true, data: [{ name: 'template-1' }] }),
    get: jest.fn().mockResolvedValue({ success: true, data: { name: 'template-1' } }),
    listVersions: jest.fn().mockResolvedValue({ success: true, data: ['v1.0.0'] }),
    listCategories: jest.fn().mockResolvedValue({ success: true, data: { categories: ['storage', 'compute'] } })
  },
  Starters: {
    list: jest.fn().mockResolvedValue({ success: true, data: [{ name: 'starter-1' }] }),
    get: jest.fn().mockResolvedValue({ success: true, data: { name: 'starter-1' } })
  },
  Documentation: {
    search: jest.fn().mockResolvedValue({ success: true, data: [{ title: 'Doc 1' }] })
  },
  Validation: {
    validate: jest.fn().mockResolvedValue({ success: true, data: { valid: true } })
  },
  Updates: {
    check: jest.fn().mockResolvedValue({ success: true, data: { hasUpdate: false } })
  },
  Tools: {
    list: jest.fn().mockResolvedValue({ success: true, data: [] })
  }
}));

const { handler } = require('../../index');
const { createMockContext, createMCPToolRequest, createMockEvent } = require('./test-helpers');


/**
 * JSON-RPC 2.0 MCP Protocol Compliance Tests
 *
 * Tests that the /mcp/v1 endpoint correctly handles JSON-RPC 2.0 requests
 * including initialize, tools/list, tools/call, and error handling.
 *
 * Validates: Requirements 9.1, 9.2, 9.3
 */

/**
 * Create an API Gateway event for JSON-RPC 2.0 requests to /mcp/v1.
 *
 * @param {Object|string} body - Request body (object will be JSON-stringified)
 * @returns {Object} Mock API Gateway event
 */
function createJsonRpcEvent(body) {
  return {
    httpMethod: 'POST',
    path: '/mcp/v1',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    requestContext: { requestId: 'test-request-id' }
  };
}

describe('JSON-RPC 2.0 MCP Protocol Compliance', () => {
  const context = createMockContext();

  describe('initialize method', () => {
    it('should return serverInfo, capabilities, and protocolVersion', async () => {
      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(1);
      expect(body.result).toBeDefined();
      expect(body.result.serverInfo).toBeDefined();
      expect(body.result.serverInfo.name).toBe('atlantis-mcp-server');
      expect(body.result.capabilities).toBeDefined();
      expect(body.result.protocolVersion).toBeDefined();
    });
  });

  describe('tools/list method', () => {
    it('should return tools array with name, description, and inputSchema', async () => {
      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 2
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(2);
      expect(body.result).toBeDefined();
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.length).toBeGreaterThan(0);

      for (const tool of body.result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      }
    });
  });

  describe('tools/call method', () => {
    it('should dispatch to controller and return result', async () => {
      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'list_categories' },
        id: 3
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(3);
      expect(body.result).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should return -32700 Parse error for non-JSON body', async () => {
      const event = createJsonRpcEvent('this is not json{{{');

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBeNull();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32700);
    });

    it('should return -32600 Invalid Request for missing jsonrpc field', async () => {
      const event = createJsonRpcEvent({ method: 'initialize', id: 10 });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32600);
    });

    it('should return -32601 Method not found for unknown method', async () => {
      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 11
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(11);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32601);
    });

    it('should return -32602 Invalid params for tools/call with missing params.name', async () => {
      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: {} },
        id: 12
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(12);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32602);
    });
  });

  describe('Response structure', () => {
    it('should include jsonrpc: "2.0" and matching id on success responses', async () => {
      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 'match-me'
      });

      const response = await handler(event, context);
      const body = JSON.parse(response.body);

      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('match-me');
      expect(body.result).toBeDefined();
      expect(body.error).toBeUndefined();
    });

    it('should include jsonrpc: "2.0" and matching id on error responses', async () => {
      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'nonexistent',
        id: 'err-id'
      });

      const response = await handler(event, context);
      const body = JSON.parse(response.body);

      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('err-id');
      expect(body.error).toBeDefined();
      expect(body.result).toBeUndefined();
    });

    it('should return Content-Type application/json on all responses', async () => {
      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 'ct-1'
      });

      const response = await handler(event, context);

      expect(response.headers).toBeDefined();
      expect(response.headers['Content-Type']).toBe('application/json');
    });
  });
});
