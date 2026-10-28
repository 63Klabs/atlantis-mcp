/**
 * Unit Tests for JSON-RPC 2.0 Formatters in mcp-protocol.js
 *
 * Tests the JSON-RPC 2.0 response formatting functions:
 * - jsonRpcSuccess(id, result)
 * - jsonRpcError(id, code, message, data?)
 * - initializeResult(id) — legacy envelope
 * - toolsListResult(id, { era: 'legacy', catalog }) — legacy envelope
 *
 * Validates: Requirements 9.1, 9.2
 */

const {
  jsonRpcSuccess,
  jsonRpcError,
  initializeResult,
  toolsListResult
} = require('../../../utils/mcp-protocol');

/**
 * Build a legacy-era tools/list response.
 *
 * @param {string|number|null} id - Request id
 * @param {Array<Object>} tools - Tool definitions
 * @returns {Object} JSON-RPC 2.0 tools/list response
 */
const legacyToolsList = (id, tools) => toolsListResult(id, { era: 'legacy', catalog: tools });

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
// initializeResult (envelope shape)
// ---------------------------------------------------------------
describe('initializeResult (legacy envelope shape)', () => {
  it('returns JSON-RPC 2.0 envelope with correct id', () => {
    const response = initializeResult('init-1');

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('init-1');
  });

  it('contains serverInfo with name and version sourced from config/release-version.js', () => {
    const response = initializeResult('init-2');
    // Version comes from config/release-version.js (generated at build time)
    const { releaseVersion } = require('../../../config/release-version.js');

    expect(response.result.serverInfo).toEqual({
      name: 'atlantis-mcp-server',
      version: releaseVersion
    });
  });

  it('contains capabilities with tools listing', () => {
    const response = initializeResult('init-3');

    expect(response.result.capabilities).toEqual({
      tools: { listChanged: false }
    });
  });

  it('contains protocolVersion (defaults to highest supported legacy revision)', () => {
    const response = initializeResult('init-4');

    // When no declaredRevision is provided, returns highest supported legacy revision
    // Phase 3: LEGACY_REVISIONS = ['2024-11-05', '2025-11-25']
    expect(response.result.protocolVersion).toBe('2025-11-25');
  });

  it('result has exactly four keys: protocolVersion, capabilities, serverInfo, instructions', () => {
    const response = initializeResult('init-5');

    expect(Object.keys(response.result).sort()).toEqual([
      'capabilities',
      'instructions',
      'protocolVersion',
      'serverInfo'
    ]);
  });

  it('contains no legacy keys at top level', () => {
    const response = initializeResult('init-6');

    for (const key of LEGACY_KEYS) {
      expect(response).not.toHaveProperty(key);
    }
  });

  it('works with null id', () => {
    const response = initializeResult(null);

    expect(response.id).toBeNull();
    expect(response.result.serverInfo.name).toBe('atlantis-mcp-server');
  });
});

// ---------------------------------------------------------------
// initializeResult (new Phase 3 formatter with declaredRevision support)
// ---------------------------------------------------------------
describe('initializeResult', () => {
  it('returns JSON-RPC 2.0 envelope with correct id', () => {
    const response = initializeResult('init-result-1');

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('init-result-1');
  });

  it('defaults to highest supported legacy revision when no declaredRevision provided', () => {
    const response = initializeResult('init-result-2');

    // Phase 3: LEGACY_REVISIONS = ['2024-11-05', '2025-11-25']
    // Should return highest: '2025-11-25'
    expect(response.result.protocolVersion).toBe('2025-11-25');
  });

  it('echoes back supported declaredRevision when provided', () => {
    const response = initializeResult('init-result-3', { declaredRevision: '2024-11-05' });

    expect(response.result.protocolVersion).toBe('2024-11-05');
  });

  it('echoes back highest supported legacy revision when provided', () => {
    const response = initializeResult('init-result-4', { declaredRevision: '2025-11-25' });

    expect(response.result.protocolVersion).toBe('2025-11-25');
  });

  it('defaults to highest legacy revision when unsupported declaredRevision provided', () => {
    const response = initializeResult('init-result-5', { declaredRevision: '2099-01-01' });

    // Unsupported revision should fall back to highest legacy revision
    expect(response.result.protocolVersion).toBe('2025-11-25');
  });

  it('contains serverInfo from shared source', () => {
    const response = initializeResult('init-result-6');

    expect(response.result.serverInfo).toHaveProperty('name');
    expect(response.result.serverInfo).toHaveProperty('version');
    expect(response.result.serverInfo.name).toBe('atlantis-mcp-server');
  });

  it('contains capabilities from shared source', () => {
    const response = initializeResult('init-result-7');

    expect(response.result.capabilities).toEqual({
      tools: { listChanged: false }
    });
  });

  it('contains instructions from shared source', () => {
    const response = initializeResult('init-result-8');

    expect(response.result.instructions).toBeDefined();
    expect(typeof response.result.instructions).toBe('string');
    expect(response.result.instructions.length).toBeGreaterThan(0);
  });

  it('result has exactly four keys (legacy envelope, no resultType, no _meta)', () => {
    const response = initializeResult('init-result-9');

    expect(Object.keys(response.result).sort()).toEqual([
      'capabilities',
      'instructions',
      'protocolVersion',
      'serverInfo'
    ]);

    // Requirement 7.2: Legacy envelope does NOT contain resultType or _meta
    expect(response.result).not.toHaveProperty('resultType');
    expect(response.result).not.toHaveProperty('_meta');
  });

  it('works with null id', () => {
    const response = initializeResult(null, { declaredRevision: '2024-11-05' });

    expect(response.id).toBeNull();
    expect(response.result.protocolVersion).toBe('2024-11-05');
  });
});

// ---------------------------------------------------------------
// toolsListResult (legacy era)
// ---------------------------------------------------------------
describe('toolsListResult (legacy era envelope)', () => {
  const sampleTools = [
    { name: 'list_templates', description: 'List templates', inputSchema: { type: 'object' } },
    { name: 'get_template', description: 'Get a template', inputSchema: { type: 'object' } }
  ];

  it('returns JSON-RPC 2.0 envelope with correct id', () => {
    const response = legacyToolsList('list-1', sampleTools);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe('list-1');
  });

  it('wraps tools array inside result.tools', () => {
    const response = legacyToolsList('list-2', sampleTools);

    expect(response.result).toEqual({ tools: sampleTools });
    expect(Array.isArray(response.result.tools)).toBe(true);
    expect(response.result.tools).toHaveLength(2);
  });

  it('handles empty tools array', () => {
    const response = legacyToolsList('list-3', []);

    expect(response.result.tools).toEqual([]);
  });

  it('preserves tool structure', () => {
    const response = legacyToolsList('list-4', sampleTools);

    for (const tool of response.result.tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
    }
  });

  it('contains no legacy keys at top level', () => {
    const response = legacyToolsList('list-5', sampleTools);

    for (const key of LEGACY_KEYS) {
      expect(response).not.toHaveProperty(key);
    }
  });

  it('works with number id', () => {
    const response = legacyToolsList(99, sampleTools);

    expect(response.id).toBe(99);
  });
});
