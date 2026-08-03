/**
 * Agent Assets MCP Router/Protocol Integration Tests
 *
 * Exercises the real Lambda `handler` end-to-end through the JSON-RPC MCP
 * flow (`tools/list` and `tools/call`) for the agent-asset tools
 * (`list_agent_assets`, `get_agent_asset`, `list_agent_asset_types`).
 * Mirrors the mocking setup and helper patterns established in
 * `mcp-protocol-compliance.test.js`.
 *
 * Validates: Requirements 6.1, 6.4, 7.8
 */

// Mock @63klabs/cache-data to provide ClientRequest and Response
jest.mock('@63klabs/cache-data', () => {
  const actual = jest.requireActual('@63klabs/cache-data');
  return {
    ...actual,
    tools: {
      ...actual.tools,
      ClientRequest: jest.fn().mockImplementation((event) => ({
        getEvent: () => event,
        getProps: () => {
          const rawPath = event.path || event.requestContext?.resourcePath || '';
          const path = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
          return {
            path,
            method: event.httpMethod || '',
            pathArray: rawPath.split('/').filter(Boolean)
          };
        },
        addQueryLog: jest.fn()
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
      })),
      CachedSsmParameter: jest.fn().mockImplementation(() => ({
        getValue: jest.fn().mockResolvedValue('mock-salt-value')
      })),
      AWS: {
        ...(actual.tools?.AWS || {}),
        dynamo: {
          get: jest.fn().mockResolvedValue({}),
          put: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({})
        }
      }
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

// Mock AuthResolver to always return public tier
jest.mock('../../utils/auth-resolver', () => ({
  resolveAuth: jest.fn().mockResolvedValue({
    tier: 'public',
    identity: '127.0.0.1',
    isAuthenticated: false,
    userId: null,
    degraded: false
  })
}));

// Mock controllers to avoid real AWS/S3 calls during integration tests.
// NOTE: `config/settings.js`, `utils/schema-validator.js`, and
// `config/agent-asset-types.js` are NOT mocked, so `tools/list` and the
// generated `assetType` enum below reflect the REAL shipped registry
// (three enabled types, `skills` disabled).
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
  },
  AgentAssets: {
    list: jest.fn().mockResolvedValue({ success: true, data: { assets: [] } }),
    get: jest.fn().mockResolvedValue({ success: true, data: {} }),
    listTypes: jest.fn().mockResolvedValue({ success: true, data: { types: [] } })
  }
}));

const { handler } = require('../../index');
const { Controllers } = { Controllers: require('../../controllers') };
const { createMockContext } = require('./test-helpers');

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

describe('Agent Assets MCP tools/list and tools/call integration', () => {
  const context = createMockContext();

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('tools/list includes the fixed agent-asset tools with the assetType enum', () => {
    it('lists list_agent_assets, get_agent_asset, and list_agent_asset_types with the enabled assetType enum', async () => {
      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 'tools-list-1'
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(Array.isArray(body.result.tools)).toBe(true);

      const toolsByName = Object.fromEntries(body.result.tools.map((t) => [t.name, t]));

      for (const name of ['list_agent_assets', 'get_agent_asset', 'list_agent_asset_types']) {
        expect(toolsByName).toHaveProperty(name);
        expect(typeof toolsByName[name].description).toBe('string');
        expect(toolsByName[name].description.length).toBeGreaterThan(0);
        expect(typeof toolsByName[name].inputSchema).toBe('object');
        expect(toolsByName[name].inputSchema).not.toBeNull();
      }

      // The `skills` type is disabled by default in the shipped registry, so the
      // enum must equal exactly the three enabled types, in registry order.
      const expectedEnabledTypes = ['steering', 'hooks', 'agents-md'];
      expect(toolsByName.get_agent_asset.inputSchema.properties.assetType.enum).toEqual(expectedEnabledTypes);
      expect(toolsByName.list_agent_assets.inputSchema.properties.assetType.enum).toEqual(expectedEnabledTypes);
    });
  });

  describe('tools/call for list_agent_assets', () => {
    it('reaches the controller and returns content[0].text with the mocked data', async () => {
      const mockData = { assets: [{ name: 'a.md', type: 'steering' }] };
      Controllers.AgentAssets.list.mockResolvedValueOnce({ success: true, data: mockData });

      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'list_agent_assets', arguments: { assetType: 'steering' } },
        id: 'call-list-1'
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.result.content[0].type).toBe('text');
      expect(JSON.parse(body.result.content[0].text)).toEqual(mockData);

      expect(Controllers.AgentAssets.list).toHaveBeenCalledTimes(1);
      const props = Controllers.AgentAssets.list.mock.calls[0][0];
      expect(props.bodyParameters.input).toEqual({ assetType: 'steering' });
    });
  });

  describe('tools/call for get_agent_asset', () => {
    it('reaches the controller and returns content[0].text with the mocked data', async () => {
      const mockData = {
        name: 'product-guidelines.md',
        type: 'steering',
        content: '# Product Guidelines'
      };
      Controllers.AgentAssets.get.mockResolvedValueOnce({ success: true, data: mockData });

      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_agent_asset',
          arguments: { assetType: 'steering', name: 'product-guidelines.md' }
        },
        id: 'call-get-1'
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.result.content[0].type).toBe('text');
      expect(JSON.parse(body.result.content[0].text)).toEqual(mockData);

      expect(Controllers.AgentAssets.get).toHaveBeenCalledTimes(1);
      const props = Controllers.AgentAssets.get.mock.calls[0][0];
      expect(props.bodyParameters.input).toEqual({ assetType: 'steering', name: 'product-guidelines.md' });
    });
  });

  describe('tools/call for list_agent_asset_types', () => {
    it('reaches the controller and returns content[0].text with the mocked data', async () => {
      const mockData = {
        types: [
          { name: 'steering', folder: 'steering', description: 'Steering docs', assetCount: 3 }
        ]
      };
      Controllers.AgentAssets.listTypes.mockResolvedValueOnce({ success: true, data: mockData });

      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'list_agent_asset_types', arguments: {} },
        id: 'call-list-types-1'
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.result.content[0].type).toBe('text');
      expect(JSON.parse(body.result.content[0].text)).toEqual(mockData);

      expect(Controllers.AgentAssets.listTypes).toHaveBeenCalledTimes(1);
      const props = Controllers.AgentAssets.listTypes.mock.calls[0][0];
      expect(props.bodyParameters.input).toEqual({});
    });
  });

  describe('tools/call for the disabled skills type', () => {
    /*
     * NOTE on approach: `../../controllers` is mocked module-wide for this
     * file (matching the established sibling-test pattern), so a `tools/call`
     * reaching this test never executes the REAL `controllers/agent-assets.js`
     * validation logic or the REAL `resolveEnabledType` defense-in-depth
     * check — it only ever calls the jest.fn() mock assigned to
     * `Controllers.AgentAssets.get`/`list`.
     *
     * Re-mocking `../../controllers` mid-file (e.g. via `jest.unmock` plus a
     * dynamic `require`) to exercise the real controller here would be
     * fragile and would duplicate coverage that already exists at the unit
     * level: `tests/unit/controllers/agent-assets-controller.test.js` (task
     * 6.2) asserts the real controller rejects a disabled/unknown
     * `assetType` with `INVALID_INPUT`, and
     * `tests/unit/controllers/agent-assets-input-validation.property.test.js`
     * (task 6.3, Property 11) property-tests that same rejection across many
     * invalid inputs including disabled types.
     *
     * This integration suite's job is to prove the ROUTING/WIRING: that a
     * controller-reported `INVALID_INPUT` error (exactly the shape the real
     * controller produces via `MCPProtocol.errorResponse('INVALID_INPUT', ...)`
     * for a disabled `assetType` such as `skills`) is correctly surfaced by
     * the router as a JSON-RPC response carrying `errorCode: 'INVALID_INPUT'`
     * in the error data — without ever reaching a real S3 read. So the mock
     * here simulates exactly what the real controller returns for `skills`,
     * and the assertions target the router's handling of that result.
     */
    it('returns INVALID_INPUT before any S3 read when the controller rejects a disabled assetType', async () => {
      const validAssetTypes = ['steering', 'hooks', 'agents-md'];
      Controllers.AgentAssets.get.mockResolvedValueOnce({
        protocol: 'mcp',
        version: '1.0',
        tool: 'get_agent_asset',
        success: false,
        error: {
          code: 'INVALID_INPUT',
          details: {
            message: `Invalid assetType "skills". Valid values: ${validAssetTypes.join(', ')}`,
            errors: [`assetType must be one of: ${validAssetTypes.join(', ')}`]
          }
        },
        timestamp: new Date().toISOString()
      });

      const event = createJsonRpcEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_agent_asset',
          arguments: { assetType: 'skills', name: 'some-skill.md' }
        },
        id: 'call-skills-1'
      });

      const response = await handler(event, context);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.data.errorCode).toBe('INVALID_INPUT');
      expect(body.error.data.toolName).toBe('get_agent_asset');

      // The mocked controller was invoked, but since Controllers is mocked
      // module-wide, no real S3 read was ever reachable through this call.
      expect(Controllers.AgentAssets.get).toHaveBeenCalledTimes(1);
    });
  });
});
