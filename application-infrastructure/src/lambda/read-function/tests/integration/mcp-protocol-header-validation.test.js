/**
 * Integration Tests for MCP Protocol Header Validation
 *
 * Tests that modern-era requests validate Mcp-Method and Mcp-Name headers
 * against body fields, and return -32020 HeaderMismatch on disagreement.
 * Legacy requests skip header validation entirely.
 *
 * Requirements: 8.1, 8.2, 8.3, 15.8
 */

const { handleJsonRpc } = require('../../utils/json-rpc-router');

/**
 * Create a mock ClientRequest for testing.
 * Mimics the interface expected by handleJsonRpc without requiring full Lambda context.
 * 
 * @param {Object} event - API Gateway event object
 * @returns {Object} Mock ClientRequest
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
    addQueryLog: () => {}
  };
}

describe('MCP Protocol Header Validation (Task 15.2)', () => {
  describe('Modern era Mcp-Method header validation', () => {
    it('should accept modern request when Mcp-Method matches body method', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'header-match-1',
          method: 'tools/list',
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28'
          }
        }),
        headers: {
          'Mcp-Method': 'tools/list',
          'Content-Type': 'application/json'
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      // Should succeed (not return error)
      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('header-match-1');
      expect(body.result).toBeDefined();
      expect(body.error).toBeUndefined();
    });

    it('should return -32020 when Mcp-Method disagrees with body method', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'header-mismatch-method',
          method: 'tools/list',
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28'
          }
        }),
        headers: {
          'Mcp-Method': 'tools/call',  // Disagrees with body
          'Content-Type': 'application/json'
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('header-mismatch-method');
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32020);
      expect(body.error.message).toBe('Header mismatch');
      expect(body.error.data).toBeDefined();
      expect(body.error.data.detail).toContain('Mcp-Method header disagrees with body method');
      expect(body.error.data.headerValue).toBe('tools/call');
      expect(body.error.data.bodyValue).toBe('tools/list');
      expect(body.result).toBeUndefined();
    });

    it('should accept modern request when Mcp-Method header is absent', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'no-header-1',
          method: 'tools/list',
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28'
          }
        }),
        headers: {
          'Content-Type': 'application/json'
          // No Mcp-Method header
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      // Should succeed - headers are optional
      expect(response.statusCode).toBe(200);
      expect(body.error).toBeUndefined();
      expect(body.result).toBeDefined();
    });
  });

  describe('Modern era Mcp-Name header validation for tools/call', () => {
    it('should accept tools/call when Mcp-Name matches params.name', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'name-match-1',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28'
          }
        }),
        headers: {
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'list_tools',
          'Content-Type': 'application/json'
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      // Should succeed
      expect(response.statusCode).toBe(200);
      expect(body.error).toBeUndefined();
      expect(body.result).toBeDefined();
    });

    it('should return -32020 when Mcp-Name disagrees with params.name', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'name-mismatch-1',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28'
          }
        }),
        headers: {
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'get_template',  // Disagrees with params.name
          'Content-Type': 'application/json'
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('name-mismatch-1');
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32020);
      expect(body.error.message).toBe('Header mismatch');
      expect(body.error.data).toBeDefined();
      expect(body.error.data.detail).toContain('Mcp-Name header disagrees with params.name');
      expect(body.error.data.headerValue).toBe('get_template');
      expect(body.error.data.bodyValue).toBe('list_tools');
      expect(body.result).toBeUndefined();
    });

    it('should accept tools/call when Mcp-Name header is absent', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'no-name-header-1',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28'
          }
        }),
        headers: {
          'Mcp-Method': 'tools/call',
          'Content-Type': 'application/json'
          // No Mcp-Name header
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      // Should succeed - headers are optional
      expect(response.statusCode).toBe(200);
      expect(body.error).toBeUndefined();
      expect(body.result).toBeDefined();
    });
  });

  describe('Legacy era skips header validation', () => {
    it('should accept legacy request lacking both Mcp-Method and Mcp-Name headers', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'legacy-no-headers-1',
          method: 'tools/list'
          // No _meta field - defaults to legacy era
        }),
        headers: {
          'Content-Type': 'application/json'
          // No Mcp-Method or Mcp-Name headers
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      // Should succeed
      expect(response.statusCode).toBe(200);
      expect(body.error).toBeUndefined();
      expect(body.result).toBeDefined();
    });

    it('should accept legacy request even with mismatched Mcp-Method header', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'legacy-bad-header-1',
          method: 'tools/list',
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2025-11-25'  // Legacy revision
          }
        }),
        headers: {
          'Mcp-Method': 'tools/call',  // Mismatched, but should be ignored for legacy
          'Content-Type': 'application/json'
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      // Should succeed - legacy era skips header validation
      expect(response.statusCode).toBe(200);
      expect(body.error).toBeUndefined();
      expect(body.result).toBeDefined();
    });

    it('should accept legacy tools/call even with mismatched Mcp-Name header', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'legacy-bad-name-1',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2024-11-05'  // Legacy revision
          }
        }),
        headers: {
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'get_template',  // Mismatched, but should be ignored for legacy
          'Content-Type': 'application/json'
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      // Should succeed - legacy era skips header validation
      expect(response.statusCode).toBe(200);
      expect(body.error).toBeUndefined();
      expect(body.result).toBeDefined();
    });
  });

  describe('Header lookup is case-insensitive', () => {
    it('should validate MCP-Method (capitalized) header', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'case-test-1',
          method: 'tools/list',
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28'
          }
        }),
        headers: {
          'MCP-Method': 'tools/call',  // Wrong case, but should match
          'Content-Type': 'application/json'
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      // Should return -32020 - case-insensitive match detected mismatch
      expect(response.statusCode).toBe(200);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32020);
    });

    it('should validate mcp-name (lowercase) header', async () => {
      const event = {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'case-test-2',
          method: 'tools/call',
          params: {
            name: 'list_tools',
            arguments: {}
          },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28'
          }
        }),
        headers: {
          'Mcp-Method': 'tools/call',
          'mcp-name': 'get_template',  // Wrong case, but should match
          'Content-Type': 'application/json'
        }
      };
      
      const clientRequest = createMockClientRequest(event);
      const response = await handleJsonRpc(clientRequest, null);
      const body = JSON.parse(response.body);

      // Should return -32020 - case-insensitive match detected mismatch
      expect(response.statusCode).toBe(200);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32020);
    });
  });
});
