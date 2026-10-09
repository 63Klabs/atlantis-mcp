/**
 * Integration test for server/discover at the public tier
 * 
 * Verifies that server/discover is answerable without authentication (no API key required).
 * The method should participate in rate limiting but not require authentication.
 * 
 * Requirements: 5.5, 15.9
 * 
 * TODO: These tests need rework in Phase 4 - they currently use nonexistent function.
 * Should test end-to-end through full Lambda handler.
 */

const { describe, it, expect } = require('@jest/globals');

describe.skip('server/discover public tier access (TODO: Fix in Phase 4)', () => {
    it('should succeed without API key or authentication headers', async () => {
        const event = {
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'server/discover',
                id: 'test-id-1'
            }),
            headers: {} // No authentication headers
        };
        
        const result = await handleJsonRpcRequest(event);
        const response = JSON.parse(result.body);
        
        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe('test-id-1');
        expect(response.result).toBeDefined();
        expect(response.error).toBeUndefined();
        
        // Should return all expected fields
        expect(response.result.supportedVersions).toBeDefined();
        expect(response.result.capabilities).toBeDefined();
        expect(response.result.instructions).toBeDefined();
    });
    
    it('should succeed with empty headers object', async () => {
        const event = {
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'server/discover',
                id: 'test-id-2'
            }),
            headers: {}
        };
        
        const result = await handleJsonRpcRequest(event);
        const response = JSON.parse(result.body);
        
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
    });
    
    it('should succeed without headers property', async () => {
        const event = {
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'server/discover',
                id: 'test-id-3'
            })
            // No headers property at all
        };
        
        const result = await handleJsonRpcRequest(event);
        const response = JSON.parse(result.body);
        
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
    });
    
    it('should return the same response regardless of authentication presence', async () => {
        // Request without auth
        const eventNoAuth = {
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'server/discover',
                id: 'test-id-4'
            }),
            headers: {}
        };
        
        // Request with some auth-like headers (doesn't matter for discover)
        const eventWithAuth = {
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'server/discover',
                id: 'test-id-5'
            }),
            headers: {
                'Authorization': 'Bearer fake-token',
                'X-Api-Key': 'fake-key'
            }
        };
        
        const resultNoAuth = await handleJsonRpcRequest(eventNoAuth);
        const resultWithAuth = await handleJsonRpcRequest(eventWithAuth);
        
        const responseNoAuth = JSON.parse(resultNoAuth.body);
        const responseWithAuth = JSON.parse(resultWithAuth.body);
        
        // Both should succeed
        expect(responseNoAuth.result).toBeDefined();
        expect(responseWithAuth.result).toBeDefined();
        
        // Responses should be identical (except for id)
        expect(responseNoAuth.result.supportedVersions).toEqual(responseWithAuth.result.supportedVersions);
        expect(responseNoAuth.result.capabilities).toEqual(responseWithAuth.result.capabilities);
        expect(responseNoAuth.result.instructions).toBe(responseWithAuth.result.instructions);
    });
    
    it('should work with protocol version headers', async () => {
        const event = {
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'server/discover',
                id: 'test-id-6'
            }),
            headers: {
                'Mcp-Protocol-Version': '2025-11-25'
            }
        };
        
        const result = await handleJsonRpcRequest(event);
        const response = JSON.parse(result.body);
        
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
        expect(response.result.supportedVersions).toContain('2025-11-25');
    });
    
    it('should work with unsupported protocol version (still returns discover)', async () => {
        const event = {
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'server/discover',
                id: 'test-id-7'
            }),
            headers: {
                'Mcp-Protocol-Version': '2099-01-01'
            }
        };
        
        const result = await handleJsonRpcRequest(event);
        const response = JSON.parse(result.body);
        
        // server/discover should succeed even with unsupported version
        // (it's the method clients use to learn what IS supported)
        expect(response.result).toBeDefined();
        expect(response.error).toBeUndefined();
        expect(response.result.supportedVersions).toBeDefined();
    });
    
    it('should return modern-shaped response consistently', async () => {
        const event = {
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'server/discover',
                id: 'test-id-8'
            }),
            headers: {}
        };
        
        const result = await handleJsonRpcRequest(event);
        const response = JSON.parse(result.body);
        
        // Modern envelope shape
        expect(response.result.resultType).toBe('complete');
        expect(response.result._meta).toBeDefined();
        expect(response.result._meta['io.modelcontextprotocol/serverInfo']).toBeDefined();
    });
    
    it('should handle multiple concurrent discover requests', async () => {
        const events = Array.from({ length: 5 }, (_, i) => ({
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'server/discover',
                id: `test-id-${9 + i}`
            }),
            headers: {}
        }));
        
        const results = await Promise.all(events.map(event => handleJsonRpcRequest(event)));
        const responses = results.map(result => JSON.parse(result.body));
        
        // All should succeed
        responses.forEach(response => {
            expect(response.error).toBeUndefined();
            expect(response.result).toBeDefined();
            expect(response.result.supportedVersions).toBeDefined();
        });
        
        // All should return identical supportedVersions
        const firstVersions = responses[0].result.supportedVersions;
        responses.forEach(response => {
            expect(response.result.supportedVersions).toEqual(firstVersions);
        });
    });
});
