/**
 * Unit Tests for JSON-RPC Router
 *
 * Tests the handleJsonRpc function and supporting utilities in
 * utils/json-rpc-router.js. Covers method dispatch (initialize,
 * tools/list, tools/call), error handling for invalid requests,
 * and response structure validation.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

const {
  handleJsonRpc,
  extractId,
  buildResponse,
  TOOL_DISPATCH,
  STANDARD_HEADERS
} = require('../../../utils/json-rpc-router');

// Mock all controllers to avoid real service calls
jest.mock('../../../controllers', () => ({
  Templates: {
    list: jest.fn(),
    get: jest.fn(),
    listVersions: jest.fn(),
    listCategories: jest.fn()
  },
  Starters: {
    list: jest.fn(),
    get: jest.fn()
  },
  Documentation: {
    search: jest.fn()
  },
  Validation: {
    validate: jest.fn()
  },
  Updates: {
    check: jest.fn()
  },
  Tools: {
    list: jest.fn()
  }
}));

const Controllers = require('../../../controllers');

/**
 * Helper: build a valid JSON-RPC 2.0 event body
 */
function makeEvent(body) {
  if (body === null || body === undefined) {
    return { body: null };
  }
  if (typeof body === 'string') {
    return { body };
  }
  return { body: JSON.stringify(body) };
}

/**
 * Helper: parse the response body JSON
 */
function parseBody(response) {
  return JSON.parse(response.body);
}

describe('JSON-RPC Router', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------
  // initialize method — Validates: Requirements 2.1, 2.2
  // ---------------------------------------------------------------
  describe('initialize method', () => {
    test('returns correct serverInfo, capabilities, and protocolVersion', async () => {
      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 'init-1'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('init-1');
      expect(body.result.serverInfo).toEqual({
        name: 'atlantis-mcp-server',
        version: '0.0.1'
      });
      expect(body.result.capabilities).toEqual({
        tools: { listChanged: false }
      });
      expect(body.result.protocolVersion).toBe('2024-11-05');
    });
  });

  // ---------------------------------------------------------------
  // tools/list method — Validates: Requirements 2.1, 2.3
  // ---------------------------------------------------------------
  describe('tools/list method', () => {
    test('returns all defined tools as an array', async () => {
      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 'list-1'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('list-1');
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.length).toBeGreaterThan(0);

      // Each tool should have name, description, and inputSchema
      for (const tool of body.result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      }
    });
  });

  // ---------------------------------------------------------------
  // tools/call dispatch — Validates: Requirements 2.1, 2.4
  // ---------------------------------------------------------------
  describe('tools/call method', () => {
    test('dispatches to the correct controller for a known tool', async () => {
      Controllers.Templates.list.mockResolvedValue({
        success: true,
        data: [{ name: 'template-1' }]
      });

      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'call-1',
        params: {
          name: 'list_templates',
          arguments: { category: 'storage' }
        }
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('call-1');
      expect(body.result).toHaveProperty('content');
      expect(Array.isArray(body.result.content)).toBe(true);
      expect(body.result.content[0].type).toBe('text');

      // Verify the controller was called with correct props
      expect(Controllers.Templates.list).toHaveBeenCalledTimes(1);
      const callProps = Controllers.Templates.list.mock.calls[0][0];
      expect(callProps.bodyParameters.tool).toBe('list_templates');
      expect(callProps.bodyParameters.input).toEqual({ category: 'storage' });
    });

    test('returns error when controller reports failure', async () => {
      Controllers.Documentation.search.mockResolvedValue({
        success: false,
        error: {
          code: 'SEARCH_FAILED',
          details: { message: 'Index unavailable' }
        }
      });

      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'call-err',
        params: {
          name: 'search_documentation',
          arguments: { query: 'test' }
        }
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('call-err');
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32603);
    });

    test('returns Method not found for unknown tool name', async () => {
      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'call-unknown',
        params: {
          name: 'nonexistent_tool',
          arguments: {}
        }
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('call-unknown');
      expect(body.error.code).toBe(-32601);
    });
  });

  // ---------------------------------------------------------------
  // Parse error (-32700) — Validates: Requirements 2.5, 2.6
  // ---------------------------------------------------------------
  describe('Parse error (-32700)', () => {
    test('empty/null body returns Parse error', async () => {
      const event = { body: null };

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBeNull();
      expect(body.error.code).toBe(-32700);
      expect(body.error.message).toBe('Parse error');
    });

    test('invalid JSON string returns Parse error', async () => {
      const event = { body: '{not valid json' };

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBeNull();
      expect(body.error.code).toBe(-32700);
    });

    test('undefined body returns Parse error', async () => {
      const event = { body: undefined };

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.error.code).toBe(-32700);
    });
  });

  // ---------------------------------------------------------------
  // Invalid Request (-32600) — Validates: Requirements 2.7
  // ---------------------------------------------------------------
  describe('Invalid Request (-32600)', () => {
    test('jsonrpc: "1.0" returns Invalid Request', async () => {
      const event = makeEvent({
        jsonrpc: '1.0',
        method: 'initialize',
        id: 'bad-ver'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('bad-ver');
      expect(body.error.code).toBe(-32600);
      expect(body.error.message).toBe('Invalid Request');
    });

    test('missing method field returns Invalid Request', async () => {
      const event = makeEvent({
        jsonrpc: '2.0',
        id: 'no-method'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.error.code).toBe(-32600);
      expect(body.id).toBe('no-method');
    });

    test('missing jsonrpc field returns Invalid Request', async () => {
      const event = makeEvent({
        method: 'initialize',
        id: 'no-jsonrpc'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.error.code).toBe(-32600);
    });
  });

  // ---------------------------------------------------------------
  // Invalid params (-32602) — Validates: Requirements 2.4
  // ---------------------------------------------------------------
  describe('Invalid params (-32602)', () => {
    test('tools/call with missing params.name returns Invalid params', async () => {
      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'no-name',
        params: { arguments: {} }
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('no-name');
      expect(body.error.code).toBe(-32602);
      expect(body.error.message).toBe('Invalid params');
    });

    test('tools/call with no params at all returns Invalid params', async () => {
      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 'no-params'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.error.code).toBe(-32602);
    });
  });

  // ---------------------------------------------------------------
  // Method not found (-32601) — Validates: Requirements 2.5
  // ---------------------------------------------------------------
  describe('Method not found (-32601)', () => {
    test('unrecognized method returns Method not found', async () => {
      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 'unknown-1'
      });

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('unknown-1');
      expect(body.error.code).toBe(-32601);
      expect(body.error.message).toBe('Method not found');
    });
  });

  // ---------------------------------------------------------------
  // Prototype chain tool name rejection — Validates: Requirements 2.1, 2.2, 2.3
  // ---------------------------------------------------------------
  describe('Prototype chain tool name rejection', () => {
    const protoNames = [
      'hasOwnProperty',
      'constructor',
      '__proto__',
      'toString',
      'valueOf'
    ];

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test.each(protoNames)(
      'params.name = "%s" returns -32601 Method not found',
      async (name) => {
        const event = makeEvent({
          jsonrpc: '2.0',
          method: 'tools/call',
          id: `proto-${name}`,
          params: {
            name,
            arguments: {}
          }
        });

        const response = await handleJsonRpc(event, {});
        const body = parseBody(response);

        expect(body.jsonrpc).toBe('2.0');
        expect(body.id).toBe(`proto-${name}`);
        expect(body.error.code).toBe(-32601);
        expect(body.error.message).toBe('Method not found');

        // Verify no controller mock was invoked
        expect(Controllers.Templates.list).toHaveBeenCalledTimes(0);
        expect(Controllers.Templates.get).toHaveBeenCalledTimes(0);
        expect(Controllers.Templates.listVersions).toHaveBeenCalledTimes(0);
        expect(Controllers.Templates.listCategories).toHaveBeenCalledTimes(0);
        expect(Controllers.Starters.list).toHaveBeenCalledTimes(0);
        expect(Controllers.Starters.get).toHaveBeenCalledTimes(0);
        expect(Controllers.Documentation.search).toHaveBeenCalledTimes(0);
        expect(Controllers.Validation.validate).toHaveBeenCalledTimes(0);
        expect(Controllers.Updates.check).toHaveBeenCalledTimes(0);
        expect(Controllers.Tools.list).toHaveBeenCalledTimes(0);
      }
    );
  });

  // ---------------------------------------------------------------
  // Response headers — Validates: Requirements 4.1, 4.2
  // ---------------------------------------------------------------
  describe('Response headers', () => {
    test('Content-Type is application/json on all responses', async () => {
      // Success case
      const successEvent = makeEvent({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 'hdr-1'
      });
      const successResp = await handleJsonRpc(successEvent, {});
      expect(successResp.headers['Content-Type']).toBe('application/json');

      // Error case
      const errorEvent = { body: null };
      const errorResp = await handleJsonRpc(errorEvent, {});
      expect(errorResp.headers['Content-Type']).toBe('application/json');
    });

    test('CORS headers are present on responses', async () => {
      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 'cors-1'
      });

      const response = await handleJsonRpc(event, {});

      expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(response.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    });

    test('X-MCP-Version header is present', async () => {
      const event = makeEvent({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 'mcp-ver'
      });

      const response = await handleJsonRpc(event, {});
      expect(response.headers['X-MCP-Version']).toBe('1.0');
    });
  });

  // ---------------------------------------------------------------
  // extractId utility
  // ---------------------------------------------------------------
  describe('extractId', () => {
    test('returns string id as-is', () => {
      expect(extractId('req-1')).toBe('req-1');
    });

    test('returns number id as-is', () => {
      expect(extractId(42)).toBe(42);
    });

    test('returns null for object id', () => {
      expect(extractId({ key: 'val' })).toBeNull();
    });

    test('returns null for array id', () => {
      expect(extractId([1, 2])).toBeNull();
    });

    test('returns null for boolean id', () => {
      expect(extractId(true)).toBeNull();
    });

    test('returns null for undefined id', () => {
      expect(extractId(undefined)).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // buildResponse utility
  // ---------------------------------------------------------------
  describe('buildResponse', () => {
    test('returns correct statusCode, headers, and stringified body', () => {
      const result = buildResponse(200, { test: true });

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(result.body)).toEqual({ test: true });
    });
  });

  // ---------------------------------------------------------------
  // TOOL_DISPATCH and STANDARD_HEADERS exports
  // ---------------------------------------------------------------
  describe('Exports', () => {
    test('TOOL_DISPATCH contains expected tool names', () => {
      const expectedTools = [
        'list_templates', 'get_template', 'list_template_versions',
        'list_categories', 'list_starters', 'get_starter_info',
        'search_documentation', 'validate_naming',
        'check_template_updates', 'list_tools'
      ];

      for (const toolName of expectedTools) {
        expect(TOOL_DISPATCH).toHaveProperty(toolName);
        expect(typeof TOOL_DISPATCH[toolName]).toBe('function');
      }
    });

    test('STANDARD_HEADERS includes required headers', () => {
      expect(STANDARD_HEADERS['Content-Type']).toBe('application/json');
      expect(STANDARD_HEADERS['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  // ---------------------------------------------------------------
  // Pre-parsed body (object, not string) — edge case
  // ---------------------------------------------------------------
  describe('Pre-parsed body', () => {
    test('handles pre-parsed object body correctly', async () => {
      const event = {
        body: {
          jsonrpc: '2.0',
          method: 'initialize',
          id: 'pre-parsed'
        }
      };

      const response = await handleJsonRpc(event, {});
      const body = parseBody(response);

      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('pre-parsed');
      expect(body.result.serverInfo.name).toBe('atlantis-mcp-server');
    });
  });
});
