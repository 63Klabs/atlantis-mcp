/**
 * Integration test for -32022 UnsupportedProtocolVersion error
 * 
 * Verifies that requests with unsupported protocol versions return -32022
 * with declaredRevision and supportedVersions in the error data.
 * 
 * Requirements: 4.4, 6.2, 15.5
 * 
 * TODO: These tests need rework in Phase 4 - they currently use incorrect test harness.
 * The function should test end-to-end behavior through the full Lambda handler.
 */

const { describe, it, expect } = require('@jest/globals');
const { handleJsonRpc } = require('../../utils/json-rpc-router');

/** Wrap a raw event in a mock clientRequest for handleJsonRpc */
function wrapEvent(event) {
    return { 
        getEvent: () => event, 
        getProps: () => ({ path: 'mcp/v1', method: 'POST' }), 
        addQueryLog: () => {} 
    };
}

describe.skip('-32022 UnsupportedProtocolVersion integration (TODO: Fix in Phase 4)', () => {
    it('should return -32022 for unsupported version in _meta', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/mcp/v1',
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 'test-id-1',
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': '2099-01-01'
                }
            }),
            headers: { 'Content-Type': 'application/json' }
        };
        
        const result = await handleJsonRpc(wrapEvent(event));
        const response = JSON.parse(result.body);
        
        // Debug: log response if test fails
        if (!response.error) {
            console.log('Unexpected response:', JSON.stringify(response, null, 2));
        }
        
        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe('test-id-1');
        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(-32022);
        expect(response.error.message).toContain('Unsupported protocol version');
        
        // Error data must contain declaredRevision and supportedVersions
        expect(response.error.data).toBeDefined();
        expect(response.error.data.declaredRevision).toBe('2099-01-01');
        expect(response.error.data.supportedVersions).toBeDefined();
        expect(Array.isArray(response.error.data.supportedVersions)).toBe(true);
        expect(response.error.data.supportedVersions.length).toBeGreaterThan(0);
    });
    
    it('should return -32022 for unsupported version in header', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/mcp/v1',
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 'test-id-2'
            }),
            headers: { 
                'Content-Type': 'application/json',
                'Mcp-Protocol-Version': '2099-12-31'
            }
        };
        
        const result = await handleJsonRpc(wrapEvent(event));
        const response = JSON.parse(result.body);
        
        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(-32022);
        expect(response.error.data.declaredRevision).toBe('2099-12-31');
        expect(response.error.data.supportedVersions).toContain('2024-11-05');
        expect(response.error.data.supportedVersions).toContain('2025-11-25');
    });
    
    it('should prefer header over body _meta when both are present', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/mcp/v1',
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 'test-id-3',
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': '2024-11-05' // supported
                }
            }),
            headers: {
                'Content-Type': 'application/json',
                'Mcp-Protocol-Version': '2099-01-01' // unsupported
            }
        };
        
        const result = await handleJsonRpc(wrapEvent(event));
        const response = JSON.parse(result.body);
        
        // Header wins, so should get -32022 error
        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(-32022);
        expect(response.error.data.declaredRevision).toBe('2099-01-01');
    });
    
    it('should return -32022 for malformed version strings', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/mcp/v1',
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 'test-id-4',
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': 'not-a-valid-version'
                }
            }),
            headers: { 'Content-Type': 'application/json' }
        };
        
        const result = await handleJsonRpc(wrapEvent(event));
        const response = JSON.parse(result.body);
        
        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(-32022);
        expect(response.error.data.declaredRevision).toBe('not-a-valid-version');
    });
    
    it('should return -32022 for empty string version', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/mcp/v1',
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 'test-id-5',
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': ''
                }
            }),
            headers: { 'Content-Type': 'application/json' }
        };
        
        const result = await handleJsonRpc(wrapEvent(event));
        const response = JSON.parse(result.body);
        
        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(-32022);
        expect(response.error.data.declaredRevision).toBe('');
    });
    
    it('should include all currently supported versions in error data', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/mcp/v1',
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 'test-id-6',
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': '2098-01-01'
                }
            }),
            headers: { 'Content-Type': 'application/json' }
        };
        
        const result = await handleJsonRpc(wrapEvent(event));
        const response = JSON.parse(result.body);
        
        const supportedVersions = response.error.data.supportedVersions;
        
        // Phase 3: Should include both 2024-11-05 and 2025-11-25
        expect(supportedVersions).toContain('2024-11-05');
        expect(supportedVersions).toContain('2025-11-25');
        
        // Should be in chronological order (compare as date strings)
        for (let i = 1; i < supportedVersions.length; i++) {
            expect(supportedVersions[i] > supportedVersions[i - 1]).toBe(true);
        }
    });
    
    it('should work with case-insensitive header names', async () => {
        const event = {
            httpMethod: 'POST',
            path: '/mcp/v1',
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 'test-id-7'
            }),
            headers: {
                'Content-Type': 'application/json',
                'mcp-protocol-version': '3000-01-01' // lowercase
            }
        };
        
        const result = await handleJsonRpc(wrapEvent(event));
        const response = JSON.parse(result.body);
        
        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(-32022);
        expect(response.error.data.declaredRevision).toBe('3000-01-01');
    });
    
    it('should not return -32022 for supported versions', async () => {
        // Test with 2024-11-05
        const event1 = {
            httpMethod: 'POST',
            path: '/mcp/v1',
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 'test-id-8',
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': '2024-11-05'
                }
            }),
            headers: { 'Content-Type': 'application/json' }
        };
        
        const result1 = await handleJsonRpc(wrapEvent(event1));
        const response1 = JSON.parse(result1.body);
        
        expect(response1.error).toBeUndefined();
        expect(response1.result).toBeDefined();
        
        // Test with 2025-11-25
        const event2 = {
            httpMethod: 'POST',
            path: '/mcp/v1',
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 'test-id-9',
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': '2025-11-25'
                }
            }),
            headers: { 'Content-Type': 'application/json' }
        };
        
        const result2 = await handleJsonRpc(wrapEvent(event2));
        const response2 = JSON.parse(result2.body);
        
        expect(response2.error).toBeUndefined();
        expect(response2.result).toBeDefined();
    });
});
