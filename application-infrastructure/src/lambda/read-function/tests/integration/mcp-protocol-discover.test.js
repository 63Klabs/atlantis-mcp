/**
 * Integration test for server/discover method
 * 
 * Verifies that server/discover returns the correct supportedVersions, capabilities,
 * and instructions, and that instructions are byte-identical across legacy initialize
 * and modern discover responses.
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 15.4
 */

const { describe, it, expect } = require('@jest/globals');
const { discoverResult, initializeResult, getCapabilities } = require('../../utils/mcp-protocol');
const { buildInstructions } = require('../../config/server-instructions');

describe('server/discover integration', () => {
    it('should return supportedVersions, capabilities, and instructions', () => {
        const result = discoverResult('test-id-1');
        
        expect(result.jsonrpc).toBe('2.0');
        expect(result.id).toBe('test-id-1');
        expect(result.result).toBeDefined();
        
        const { result: data } = result;
        
        // Must have supportedVersions
        expect(data.supportedVersions).toBeDefined();
        expect(Array.isArray(data.supportedVersions)).toBe(true);
        expect(data.supportedVersions.length).toBeGreaterThan(0);
        
        // Currently supports 2024-11-05 and 2025-11-25 (Phase 3)
        expect(data.supportedVersions).toContain('2024-11-05');
        expect(data.supportedVersions).toContain('2025-11-25');
        
        // Must have capabilities
        expect(data.capabilities).toBeDefined();
        expect(typeof data.capabilities).toBe('object');
        expect(data.capabilities.tools).toBeDefined();
        
        // Must have instructions
        expect(data.instructions).toBeDefined();
        expect(typeof data.instructions).toBe('string');
        expect(data.instructions.length).toBeGreaterThan(0);
        
        // Must have resultType (modern-shaped response)
        expect(data.resultType).toBe('complete');
        
        // Must have _meta with serverInfo
        expect(data._meta).toBeDefined();
        expect(data._meta['io.modelcontextprotocol/serverInfo']).toBeDefined();
        expect(data._meta['io.modelcontextprotocol/serverInfo'].name).toBeDefined();
        expect(data._meta['io.modelcontextprotocol/serverInfo'].version).toBeDefined();
    });
    
    it('should match getCapabilities() output', () => {
        const discoverResponse = discoverResult('test-id-2');
        const caps = getCapabilities();
        
        // supportedVersions should match
        expect(discoverResponse.result.supportedVersions).toEqual(caps.supportedVersions);
        
        // capabilities should match
        expect(discoverResponse.result.capabilities).toEqual(caps.capabilities);
        
        // instructions should match
        expect(discoverResponse.result.instructions).toBe(caps.instructions);
        
        // serverInfo should match
        expect(discoverResponse.result._meta['io.modelcontextprotocol/serverInfo']).toEqual(caps.serverInfo);
    });
    
    it('should have byte-identical instructions with initializeResult (Requirement 15.4)', () => {
        const discoverResponse = discoverResult('test-id-3');
        const initializeResponse = initializeResult('test-id-4');
        
        // Both should have instructions
        expect(discoverResponse.result.instructions).toBeDefined();
        expect(initializeResponse.result.instructions).toBeDefined();
        
        // Instructions must be byte-identical
        expect(discoverResponse.result.instructions).toBe(initializeResponse.result.instructions);
    });
    
    it('should have byte-identical instructions with buildInstructions()', () => {
        const discoverResponse = discoverResult('test-id-5');
        const builtInstructions = buildInstructions();
        
        // discover instructions must match the single source
        expect(discoverResponse.result.instructions).toBe(builtInstructions);
    });
    
    it('should return modern-shaped envelope with all required fields', () => {
        const result = discoverResult('test-id-6');
        
        // Modern envelope shape
        const requiredModernFields = ['supportedVersions', 'capabilities', 'instructions', 'resultType', '_meta'];
        requiredModernFields.forEach(field => {
            expect(result.result[field]).toBeDefined();
        });
        
        // Legacy fields that should NOT be present in discover
        expect(result.result.protocolVersion).toBeUndefined();
        expect(result.result.serverInfo).toBeUndefined(); // serverInfo is in _meta for modern
    });
    
    it('should have consistent serverInfo.name and serverInfo.version', () => {
        const result = discoverResult('test-id-7');
        const serverInfo = result.result._meta['io.modelcontextprotocol/serverInfo'];
        
        expect(serverInfo.name).toBe('atlantis-mcp-server');
        expect(typeof serverInfo.version).toBe('string');
        expect(serverInfo.version.length).toBeGreaterThan(0);
        
        // Version should match what's in getCapabilities
        const caps = getCapabilities();
        expect(serverInfo.version).toBe(caps.serverInfo.version);
    });
    
    it('should return the same supportedVersions on multiple calls', () => {
        const result1 = discoverResult('test-id-8');
        const result2 = discoverResult('test-id-9');
        
        expect(result1.result.supportedVersions).toEqual(result2.result.supportedVersions);
    });
    
    it('should have supportedVersions in chronological order', () => {
        const result = discoverResult('test-id-10');
        const versions = result.result.supportedVersions;
        
        // Versions should be date strings in YYYY-MM-DD format
        versions.forEach(version => {
            expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
        
        // Should be ordered chronologically (oldest first)
        // Compare as date strings in YYYY-MM-DD format (lexicographic order works for this format)
        for (let i = 1; i < versions.length; i++) {
            expect(versions[i] > versions[i - 1]).toBe(true);
        }
    });
});
