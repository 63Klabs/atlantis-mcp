/**
 * Unit Tests for JSON-RPC 2.0 Formatters in mcp-protocol.js
 *
 * Tests the JSON-RPC 2.0 response formatting functions:
 * - jsonRpcSuccess(id, result)
 * - jsonRpcError(id, code, message, data?)
 * - initializeResponse(id)
 * - toolsListResponse(id, tools)
 *
 * Validates: Requirements 9.1, 9.2
 */

const {
  jsonRpcSuccess,
  jsonRpcError,
  initializeResponse,
  toolsListResponse
} = require('../../../utils/mcp-protocol');

/** Legacy keys that must never appear at the top level of JSON-RPC responses */
const LEGACY_KEYS = ['protocol', 'version', 'tool', 'success', 'data', 'timestamp'];

// ---------------------------------------------------------------
// jsonRpcSuccess
// ---------------------------------------------------------------
describe('jsonRpcSuccess', () => {
  it('produces correct envelope with string id', () => {
    const response = jsonRpcSuccess('req-1', { foo: 'bar' });

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { foo: 'bar' }
    });
  });

  it('produces correct envelope with number id', () => {
    const response = jsonRpcSuccess(42, [1, 2, 3]);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(42);
    expect(response.result).toEqual([1, 2, 3]);
  });

  it('produces correct envelope with null id', () => {
    const response = jsonRpcSuccess(null, 'ok');

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBeNull();
    expect(response.result).toBe('ok');
  });

  it('contains no legacy keys at top level', () => {
    const response = jsonRpcSuccess('test', { data: 'nested is fine' });

    for (const key of LEGACY_KEYS) {
      expect(response).not.toHaveProperty(key);
    }
  });

  it('has exactly three top-level keys', () => {
    const response = jsonRpcSuccess('id-1', {});
    expect(Object.keys(response).sort()).toEqual(['id', 'jsonrpc', 'result']);
  });
});

// ---------------------------------------------------------------
// jsonRpcError
// ---------------------------------------------------------------
describe('jsonRpcError', () => {
  it('produces correct error envelope without optional data', () => {
    const response = jsonRpcError('err-1', -32600, 'Invalid Request');

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'err-1',
      error: {
        code: -32600,
        message: 'Invalid Request'
      }
    });
  });

  it('produces correct error envelope with optional data', () => {
    const response = jsonRpcError('err-2', -32601, 'Method not found', { method: 'unknown/method' });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('err-2');
    expect(response.error.code).toBe(-32601);
    expect(response.error.message).toBe('Method not found');
    expect(response.error.data).toEqual({ method: 'unknown/method' });
  });

  it('omits data field when data is undefined', () => {
    const response = jsonRpcError('err-3', -32700, 'Parse error');

    expect(response.error).not.toHaveProperty('data');
  });

  it('includes data field when data is null', () => {
    const response = jsonRpcError('err-4', -32603, 'Internal error', null);

    expect(response.error).toHaveProperty('data');
    expect(response.error.data).toBeNull();
  });

  it('works with number id', () => {
    const response = jsonRpcError(7, -32602, 'Invalid params');

    expect(response.id).toBe(7);
    expect(response.jsonrpc).toBe('2.0');
  });

  it('works with null id', () => {
    const response = jsonRpcError(null, -32700, 'Parse error');

    expect(response.id).toBeNull();
    expect(response.error.code).toBe(-32700);
  });

  it('contains no legacy keys at top level', () => {
    const response = jsonRpcError('test', -32600, 'Invalid Request', { extra: true });

    for (const key of LEGACY_KEYS) {
      expect(response).not.toHaveProperty(key);
    }
  });

  it('has exactly three top-level keys', () => {
    const response = jsonRpcError('id-1', -32600, 'err');
    expect(Object.keys(response).sort()).toEqual(['error', 'id', 'jsonrpc']);
  });
});

// ---------------------------------------------------------------
// initializeResponse
// ---------------------------------------------------------------
describe('initializeResponse', () => {
  it('returns JSON-RPC 2.0 envelope with correct id', () => {
    const response = initializeResponse('init-1');

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('init-1');
  });

  it('contains serverInfo with name and version', () => {
    const response = initializeResponse('init-2');

    expect(response.result.serverInfo).toEqual({
      name: 'atlantis-mcp-server',
      version: '0.0.1'
    });
  });

  it('contains capabilities with tools listing', () => {
    const response = initializeResponse('init-3');

    expect(response.result.capabilities).toEqual({
      tools: { listChanged: false }
    });
  });

  it('contains protocolVersion', () => {
    const response = initializeResponse('init-4');

    expect(response.result.protocolVersion).toBe('2024-11-05');
  });

  it('result has exactly three keys: protocolVersion, capabilities, serverInfo', () => {
    const response = initializeResponse('init-5');

    expect(Object.keys(response.result).sort()).toEqual([
      'capabilities',
      'protocolVersion',
      'serverInfo'
    ]);
  });

  it('contains no legacy keys at top level', () => {
    const response = initializeResponse('init-6');

    for (const key of LEGACY_KEYS) {
      expect(response).not.toHaveProperty(key);
    }
  });

  it('works with null id', () => {
    const response = initializeResponse(null);

    expect(response.id).toBeNull();
    expect(response.result.serverInfo.name).toBe('atlantis-mcp-server');
  });
});

// ---------------------------------------------------------------
// toolsListResponse
// ---------------------------------------------------------------
describe('toolsListResponse', () => {
  const sampleTools = [
    { name: 'list_templates', description: 'List templates', inputSchema: { type: 'object' } },
    { name: 'get_template', description: 'Get a template', inputSchema: { type: 'object' } }
  ];

  it('returns JSON-RPC 2.0 envelope with correct id', () => {
    const response = toolsListResponse('list-1', sampleTools);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('list-1');
  });

  it('wraps tools array inside result.tools', () => {
    const response = toolsListResponse('list-2', sampleTools);

    expect(response.result).toEqual({ tools: sampleTools });
    expect(Array.isArray(response.result.tools)).toBe(true);
    expect(response.result.tools).toHaveLength(2);
  });

  it('handles empty tools array', () => {
    const response = toolsListResponse('list-3', []);

    expect(response.result.tools).toEqual([]);
  });

  it('preserves tool structure', () => {
    const response = toolsListResponse('list-4', sampleTools);

    for (const tool of response.result.tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
    }
  });

  it('contains no legacy keys at top level', () => {
    const response = toolsListResponse('list-5', sampleTools);

    for (const key of LEGACY_KEYS) {
      expect(response).not.toHaveProperty(key);
    }
  });

  it('works with number id', () => {
    const response = toolsListResponse(99, sampleTools);

    expect(response.id).toBe(99);
  });
});
