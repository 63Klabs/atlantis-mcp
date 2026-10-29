/**
 * Integration Tests for Modern-Era Required Fields
 *
 * Task 14.5: Verify that modern-era responses include required envelope fields
 * (`ttlMs`, `cacheScope`, `resultType`, `_meta`) while legacy responses do not.
 *
 * Modern protocol (2026-07-28+) requires:
 * - tools/list: ttlMs, cacheScope, resultType, _meta
 * - tools/call: resultType, _meta
 *
 * Legacy protocol should not include these fields.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 15.6, 15.7
 *
 * @module tests/integration/mcp-protocol-modern-required-fields
 */

const { describe, it, expect } = require('@jest/globals');
const { handleJsonRpc, TOOL_DISPATCH } = require('../../utils/json-rpc-router');
const { DEFAULT_SIZE_THRESHOLD } = require('../../utils/content-sizer');
const { CACHE_SCOPES, TOOLS_LIST_CACHE_SCOPE } = require('../../utils/mcp-protocol');

/**
 * Create a mock ClientRequest for testing.
 * Mimics the interface expected by handleJsonRpc without requiring full Lambda context.
 */
function createMockClientRequest(event) {
  return {
    getEvent: () => event,
    getProps: () => {
      const rawPath = event.path || event.requestContext?.resourcePath || '';
      const path = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
      return {
        path,
        method: event.httpMethod || 'POST',
        pathArray: rawPath.split('/').filter(Boolean),
        headers: event.headers || {},
        body: event.body
      };
    },
    addQueryLog: jest.fn()
  };
}

describe('Integration: Modern-Era Required Fields (Task 14.5)', () => {
  
  describe('tools/list', () => {
    
    // Note: Tests for '2026-07-28' will pass after Task 16.1 adds it to SUPPORTED_PROTOCOL_VERSIONS
    it('should include modern-required fields when client declares 2026-07-28', async () => {
      // Modern client declares 2026-07-28 via Mcp-Protocol-Version header
      const event = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-modern-tools-list',
          method: 'tools/list',
          params: {}
        })
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('test-modern-tools-list');
      expect(body.result).toBeDefined();
      
      // >! Modern tools/list MUST include ttlMs, cacheScope, resultType, _meta
      expect(body.result.ttlMs).toBeDefined();
      expect(typeof body.result.ttlMs).toBe('number');
      expect(body.result.ttlMs).toBeGreaterThan(0);
      
      // >! cacheScope must be a value the specification allows, and must be the single defined constant
      expect(CACHE_SCOPES).toContain(body.result.cacheScope);
      expect(body.result.cacheScope).toBe(TOOLS_LIST_CACHE_SCOPE);
      expect(body.result.resultType).toBe('complete');
      
      expect(body.result._meta).toBeDefined();
      expect(body.result._meta['io.modelcontextprotocol/serverInfo']).toBeDefined();
      expect(body.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('atlantis-mcp-server');
      expect(body.result._meta['io.modelcontextprotocol/serverInfo'].version).toBeDefined();
      
      // Tools array must still be present
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.length).toBeGreaterThan(0);
    });
    
    it('should include modern-required fields when client declares 2025-11-25', async () => {
      // 2025-11-25 is the LAST LEGACY revision - should NOT have modern fields
      // This test verifies it does NOT get modern fields
      const event = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-legacy-2025',
          method: 'tools/list',
          params: {}
        })
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // >! 2025-11-25 is LEGACY era - should NOT have modern fields
      expect(body.result.ttlMs).toBeUndefined();
      expect(body.result.cacheScope).toBeUndefined();
      expect(body.result.resultType).toBeUndefined();
      expect(body.result._meta).toBeUndefined();
      
      // Tools array must still be present
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.length).toBeGreaterThan(0);
    });
    
    it('should NOT include modern-required fields when client declares 2024-11-05', async () => {
      // Legacy client declares 2024-11-05
      const event = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2024-11-05'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-legacy-tools-list',
          method: 'tools/list',
          params: {}
        })
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('test-legacy-tools-list');
      expect(body.result).toBeDefined();
      
      // >! Legacy tools/list MUST NOT include modern-required fields
      expect(body.result.ttlMs).toBeUndefined();
      expect(body.result.cacheScope).toBeUndefined();
      expect(body.result.resultType).toBeUndefined();
      expect(body.result._meta).toBeUndefined();
      
      // Tools array must still be present
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.length).toBeGreaterThan(0);
    });
    
    it('should NOT include modern-required fields when client omits Mcp-Protocol-Version', async () => {
      // No header = legacy era by default
      const event = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json'
          // No mcp-protocol-version header
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-no-header',
          method: 'tools/list',
          params: {}
        })
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // >! No header means legacy era - no modern fields
      expect(body.result.ttlMs).toBeUndefined();
      expect(body.result.cacheScope).toBeUndefined();
      expect(body.result.resultType).toBeUndefined();
      expect(body.result._meta).toBeUndefined();
      
      expect(Array.isArray(body.result.tools)).toBe(true);
    });
  });
  
  describe('tools/call', () => {
    
    // Note: Tests for '2026-07-28' will pass after Task 16.1 adds it to SUPPORTED_PROTOCOL_VERSIONS
    it('should include modern-required fields when client declares 2026-07-28', async () => {
      // Modern client with tools/call
      const event = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-modern-tools-call',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          }
        })
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('test-modern-tools-call');
      expect(body.result).toBeDefined();
      
      // >! Modern tools/call MUST include resultType and _meta
      expect(body.result.resultType).toBe('complete');
      
      expect(body.result._meta).toBeDefined();
      expect(body.result._meta['io.modelcontextprotocol/serverInfo']).toBeDefined();
      expect(body.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('atlantis-mcp-server');
      expect(body.result._meta['io.modelcontextprotocol/serverInfo'].version).toBeDefined();
      
      // Content array must still be present
      expect(Array.isArray(body.result.content)).toBe(true);
      expect(body.result.content.length).toBeGreaterThan(0);
      expect(body.result.content[0].type).toBe('text');
    });
    
    it('should NOT include modern-required fields when client declares 2025-11-25 (legacy)', async () => {
      // 2025-11-25 is the LAST LEGACY revision
      const event = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-11-25'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-legacy-2025-call',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          }
        })
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // >! 2025-11-25 is LEGACY - should NOT have modern fields
      expect(body.result.resultType).toBeUndefined();
      expect(body.result._meta).toBeUndefined();
      
      expect(Array.isArray(body.result.content)).toBe(true);
    });
    
    it('should NOT include modern-required fields when client declares 2024-11-05', async () => {
      // Legacy client with tools/call
      const event = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2024-11-05'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-legacy-tools-call',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          }
        })
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('test-legacy-tools-call');
      expect(body.result).toBeDefined();
      
      // >! Legacy tools/call MUST NOT include modern-required fields
      expect(body.result.resultType).toBeUndefined();
      expect(body.result._meta).toBeUndefined();
      
      // Content array must still be present
      expect(Array.isArray(body.result.content)).toBe(true);
      expect(body.result.content.length).toBeGreaterThan(0);
    });
    
    it('should NOT include modern-required fields when client omits Mcp-Protocol-Version', async () => {
      // No header = legacy era
      const event = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json'
          // No mcp-protocol-version header
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-no-header-call',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          }
        })
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      
      expect(response.statusCode).toBe(200);
      
      const body = JSON.parse(response.body);
      
      // >! No header means legacy era - no modern fields
      expect(body.result.resultType).toBeUndefined();
      expect(body.result._meta).toBeUndefined();
      
      expect(Array.isArray(body.result.content)).toBe(true);
    });
    
    // The three size-aware tools replace an oversized payload with a summary. The summary
    // is built on a separate code path from the normal result, so each must be wrapped too.
    // A stub handler returns a payload above the size threshold so the summary path really runs.
    describe.each(['get_template', 'get_document', 'get_agent_asset'])('size-aware summary for %s', (toolName) => {
      let originalHandler;

      beforeEach(() => {
        originalHandler = TOOL_DISPATCH[toolName];
        TOOL_DISPATCH[toolName] = async () => ({
          success: true,
          data: { name: 'oversized', content: 'x'.repeat(DEFAULT_SIZE_THRESHOLD + 1000) }
        });
      });

      afterEach(() => {
        TOOL_DISPATCH[toolName] = originalHandler;
      });

      /**
       * Call the stubbed tool through the router, declaring the given revision.
       *
       * @param {string} revision - Protocol revision to declare in the header
       * @returns {Promise<Object>} Parsed JSON-RPC response
       */
      async function callOversized(revision) {
        const event = {
          httpMethod: 'POST',
          headers: { 'content-type': 'application/json', 'mcp-protocol-version': revision },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'test-summary',
            method: 'tools/call',
            params: { name: toolName, arguments: {} }
          })
        };
        const response = await handleJsonRpc(createMockClientRequest(event), null);
        expect(response.statusCode).toBe(200);
        return JSON.parse(response.body);
      }

      it('is a truncated summary and carries the modern envelope on a modern request', async () => {
        const body = await callOversized('2026-07-28');

        expect(body.error).toBeUndefined();
        const summary = JSON.parse(body.result.content[0].text);
        // Proves the summary branch ran rather than the normal full-content path
        expect(summary.contentTruncated).toBe(true);
        expect(summary.content).toBeUndefined();

        expect(body.result.resultType).toBe('complete');
        expect(body.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('atlantis-mcp-server');
      });

      it('is a truncated summary with no modern fields on a legacy request', async () => {
        const body = await callOversized('2025-11-25');

        const summary = JSON.parse(body.result.content[0].text);
        expect(summary.contentTruncated).toBe(true);

        expect(body.result.resultType).toBeUndefined();
        expect(body.result._meta).toBeUndefined();
      });
    });
  });
  
  describe('Cross-method consistency', () => {
    
    // Note: Tests using '2026-07-28' will pass after Task 16.1 adds it to SUPPORTED_PROTOCOL_VERSIONS
    it('should use identical serverInfo across different methods', async () => {
      // Call tools/list and tools/call, verify serverInfo is identical
      const toolsListEvent = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-list',
          method: 'tools/list',
          params: {}
        })
      };
      
      const toolsCallEvent = {
        httpMethod: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-call',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          }
        })
      };
      
      const clientRequest1 = createMockClientRequest(toolsListEvent);
      const clientRequest2 = createMockClientRequest(toolsCallEvent);
      
      const response1 = await handleJsonRpc(clientRequest1, null);
      const response2 = await handleJsonRpc(clientRequest2, null);
      
      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);
      
      // >! serverInfo MUST be identical across methods (same source)
      expect(body1.result._meta['io.modelcontextprotocol/serverInfo']).toEqual(
        body2.result._meta['io.modelcontextprotocol/serverInfo']
      );
    });
  });
});
