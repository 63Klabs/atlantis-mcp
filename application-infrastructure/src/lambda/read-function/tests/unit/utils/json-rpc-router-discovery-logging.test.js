/**
 * Unit Tests for JSON-RPC Router Discovery Logging
 *
 * Tests the `discovery_tool_call` structured log event emitted from the shared
 * `handleToolsCall` dispatch point in `utils/json-rpc-router.js`
 * (spec 0-0-7-tool-discovery-enhancement, task 4.1).
 *
 * Validates: Requirements 12.2, 12.3, 12.5
 */

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
    search: jest.fn(),
    getDocument: jest.fn(),
    getDocumentChunk: jest.fn()
  },
  Validation: {
    validate: jest.fn()
  },
  Updates: {
    check: jest.fn()
  },
  Tools: {
    list: jest.fn()
  },
  AgentAssets: {
    list: jest.fn(),
    get: jest.fn(),
    listTypes: jest.fn()
  }
}));

const {
  handleJsonRpc,
  resetDiscoveryToolCallState
} = require('../../../utils/json-rpc-router');
const Controllers = require('../../../controllers');
// >! Use the REAL @63klabs/cache-data module (as the existing json-rpc-router.test.js does)
// >! and spy on DebugAndLog.info, rather than jest.mock()'ing the whole package — the
// >! package is also required transitively by config/settings.js (via mcp-protocol.js),
// >! which needs its real CachedSsmParameter/etc. exports to construct the settings module.
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Helper: build a mock clientRequest wrapping a `tools/call` JSON-RPC request.
 */
function makeToolsCallRequest(toolName, args = {}, id = 'call-1') {
  const event = {
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      id,
      params: { name: toolName, arguments: args }
    })
  };
  return {
    getEvent: () => event,
    getProps: () => ({ path: 'mcp/v1', method: 'POST' }),
    addQueryLog: jest.fn()
  };
}

/**
 * Pull every `DISCOVERY_TOOL_CALL ...` line emitted via `DebugAndLog.info` out of the mock's
 * call history, parsed as JSON.
 *
 * @returns {Array<{line: string, payload: Object}>}
 */
function discoveryToolCallLogLines() {
  return DebugAndLog.info.mock.calls
    .map(([line]) => line)
    .filter((line) => typeof line === 'string' && line.startsWith('DISCOVERY_TOOL_CALL '))
    .map((line) => ({ line, payload: JSON.parse(line.slice('DISCOVERY_TOOL_CALL '.length)) }));
}

describe('JSON-RPC Router — discovery_tool_call logging', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(DebugAndLog, 'info').mockImplementation(() => {});
    resetDiscoveryToolCallState();

    Controllers.Templates.list.mockResolvedValue({ success: true, data: [] });
    Controllers.Documentation.search.mockResolvedValue({ success: true, data: { results: [] } });
    Controllers.Tools.list.mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs DISCOVERY_TOOL_CALL with the invoked toolName', async () => {
    const req = makeToolsCallRequest('list_templates', { category: 'storage' });
    await handleJsonRpc(req);

    const lines = discoveryToolCallLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].payload.toolName).toBe('list_templates');
    expect(typeof lines[0].payload.firstInSession).toBe('boolean');
  });

  it('sets firstInSession true on the first call after resetDiscoveryToolCallState, then false on subsequent calls', async () => {
    const req1 = makeToolsCallRequest('list_templates', {}, 'call-1');
    await handleJsonRpc(req1);

    const req2 = makeToolsCallRequest('search_documentation', { query: 'cache-data' }, 'call-2');
    await handleJsonRpc(req2);

    const req3 = makeToolsCallRequest('list_tools', {}, 'call-3');
    await handleJsonRpc(req3);

    const lines = discoveryToolCallLogLines();
    expect(lines).toHaveLength(3);
    expect(lines[0].payload).toEqual({ toolName: 'list_templates', firstInSession: true });
    expect(lines[1].payload).toEqual({ toolName: 'search_documentation', firstInSession: false });
    expect(lines[2].payload).toEqual({ toolName: 'list_tools', firstInSession: false });
  });

  it('resetDiscoveryToolCallState allows a fresh "first call" to be observed again (simulated new container)', async () => {
    await handleJsonRpc(makeToolsCallRequest('list_templates', {}, 'call-1'));
    await handleJsonRpc(makeToolsCallRequest('list_tools', {}, 'call-2'));

    resetDiscoveryToolCallState();

    await handleJsonRpc(makeToolsCallRequest('search_documentation', { query: 'x' }, 'call-3'));

    const lines = discoveryToolCallLogLines();
    expect(lines).toHaveLength(3);
    expect(lines[0].payload.firstInSession).toBe(true);
    expect(lines[1].payload.firstInSession).toBe(false);
    expect(lines[2].payload.firstInSession).toBe(true);
  });

  it('does not log any caller identity/PII, even when authInfo carries an identity (Requirement 12.5)', async () => {
    const req = makeToolsCallRequest('search_documentation', { query: 'cache-data' });
    const authInfo = {
      tier: 'paid',
      isAuthenticated: true,
      identity: 'user-98765',
      sub: 'cognito-sub-xyz',
      email: 'someone@example.com',
      apiKey: 'secret-api-key-value'
    };

    await handleJsonRpc(req, authInfo);

    const lines = discoveryToolCallLogLines();
    expect(lines).toHaveLength(1);

    const { line, payload } = lines[0];
    expect(Object.keys(payload).sort()).toEqual(['firstInSession', 'toolName'].sort());

    for (const identityValue of [authInfo.identity, authInfo.sub, authInfo.email, authInfo.apiKey]) {
      expect(line).not.toContain(identityValue);
    }
  });

  it('is emitted exactly once per tools/call dispatch regardless of which tool is invoked', async () => {
    await handleJsonRpc(makeToolsCallRequest('list_tools', {}, 'call-1'));

    const lines = discoveryToolCallLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].payload.toolName).toBe('list_tools');
  });

  it('does not log DISCOVERY_TOOL_CALL for non tools/call methods (e.g. initialize, tools/list)', async () => {
    await handleJsonRpc({
      getEvent: () => ({ body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 'init-1' }) }),
      getProps: () => ({ path: 'mcp/v1', method: 'POST' }),
      addQueryLog: jest.fn()
    });
    await handleJsonRpc({
      getEvent: () => ({ body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 'list-1' }) }),
      getProps: () => ({ path: 'mcp/v1', method: 'POST' }),
      addQueryLog: jest.fn()
    });

    expect(discoveryToolCallLogLines()).toHaveLength(0);
  });
});
