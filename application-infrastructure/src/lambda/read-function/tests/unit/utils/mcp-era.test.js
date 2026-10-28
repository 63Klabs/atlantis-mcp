/**
 * Unit tests for MCP era discrimination utilities
 * 
 * Tests the era discriminator logic that determines whether a request
 * is targeting legacy or modern MCP protocol revisions, and validates
 * headers accordingly.
 * 
 * Coverage:
 * - Era resolution based on method, body, and headers
 * - Header picking with case-insensitivity
 * - Modern header validation
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.1, 8.2, 8.3, 8.4, 8.5
 */

const { describe, it, expect } = require('@jest/globals');
const {
    LEGACY_REVISIONS,
    MODERN_REVISIONS,
    pickHeader,
    resolveEra,
    validateHeadersForModern
} = require('../../../utils/mcp-era.js');

describe('mcp-era constants', () => {
    it('should define LEGACY_REVISIONS', () => {
        expect(LEGACY_REVISIONS).toEqual(['2024-11-05', '2025-11-25']);
        expect(Object.isFrozen(LEGACY_REVISIONS)).toBe(true);
    });

    it('should define MODERN_REVISIONS', () => {
        expect(MODERN_REVISIONS).toEqual(['2026-07-28']);
        expect(Object.isFrozen(MODERN_REVISIONS)).toBe(true);
    });
});

describe('pickHeader', () => {
    it('should return value when header exists with exact case', () => {
        const headers = { 'Mcp-Protocol-Version': '2024-11-05' };
        expect(pickHeader(headers, 'Mcp-Protocol-Version')).toBe('2024-11-05');
    });

    it('should return value when header exists with different case', () => {
        const headers = { 'mcp-protocol-version': '2024-11-05' };
        expect(pickHeader(headers, 'Mcp-Protocol-Version')).toBe('2024-11-05');
    });

    it('should return value when header exists with uppercase', () => {
        const headers = { 'MCP-PROTOCOL-VERSION': '2024-11-05' };
        expect(pickHeader(headers, 'Mcp-Protocol-Version')).toBe('2024-11-05');
    });

    it('should return null when header does not exist', () => {
        const headers = { 'Content-Type': 'application/json' };
        expect(pickHeader(headers, 'Mcp-Protocol-Version')).toBeNull();
    });

    it('should return null when headers object is empty', () => {
        const headers = {};
        expect(pickHeader(headers, 'Mcp-Protocol-Version')).toBeNull();
    });

    it('should return null when headers is null', () => {
        expect(pickHeader(null, 'Mcp-Protocol-Version')).toBeNull();
    });

    it('should return null when headers is undefined', () => {
        expect(pickHeader(undefined, 'Mcp-Protocol-Version')).toBeNull();
    });

    it('should handle multiple headers with different names', () => {
        const headers = {
            'content-type': 'application/json',
            'MCP-PROTOCOL-VERSION': '2025-11-25',
            'authorization': 'Bearer token'
        };
        expect(pickHeader(headers, 'Mcp-Protocol-Version')).toBe('2025-11-25');
        expect(pickHeader(headers, 'Content-Type')).toBe('application/json');
        expect(pickHeader(headers, 'Authorization')).toBe('Bearer token');
    });
});

describe('resolveEra', () => {
    describe('initialize method (Requirement 4.1)', () => {
        it('should resolve to legacy for initialize with no version', () => {
            const result = resolveEra('initialize', {}, {});
            expect(result.era).toBe('legacy');
            expect(result.declaredRevision).toBeNull();
        });

        it('should resolve to legacy for initialize with legacy header', () => {
            const result = resolveEra('initialize', {}, { 'Mcp-Protocol-Version': '2024-11-05' });
            expect(result.era).toBe('legacy');
            expect(result.declaredRevision).toBe('2024-11-05');
        });

        it('should resolve to legacy for initialize with modern header', () => {
            const result = resolveEra('initialize', {}, { 'Mcp-Protocol-Version': '2026-07-28' });
            expect(result.era).toBe('legacy');
            expect(result.declaredRevision).toBe('2026-07-28');
        });
    });

    describe('server/discover method (Requirement 4.3)', () => {
        it('should resolve to modern for server/discover with no version', () => {
            const result = resolveEra('server/discover', {}, {});
            expect(result.era).toBe('modern');
            expect(result.declaredRevision).toBeNull();
        });

        it('should resolve to modern for server/discover with legacy header', () => {
            const result = resolveEra('server/discover', {}, { 'Mcp-Protocol-Version': '2024-11-05' });
            expect(result.era).toBe('modern');
            expect(result.declaredRevision).toBe('2024-11-05');
        });

        it('should resolve to modern for server/discover with modern header', () => {
            const result = resolveEra('server/discover', {}, { 'Mcp-Protocol-Version': '2026-07-28' });
            expect(result.era).toBe('modern');
            expect(result.declaredRevision).toBe('2026-07-28');
        });
    });

    describe('other methods with declared revisions', () => {
        it('should resolve to legacy when header is 2024-11-05', () => {
            const result = resolveEra('tools/list', {}, { 'Mcp-Protocol-Version': '2024-11-05' });
            expect(result.era).toBe('legacy');
            expect(result.declaredRevision).toBe('2024-11-05');
        });

        it('should resolve to legacy when header is 2025-11-25', () => {
            const result = resolveEra('tools/list', {}, { 'Mcp-Protocol-Version': '2025-11-25' });
            expect(result.era).toBe('legacy');
            expect(result.declaredRevision).toBe('2025-11-25');
        });

        it('should resolve to modern when header is 2026-07-28', () => {
            const result = resolveEra('tools/list', {}, { 'Mcp-Protocol-Version': '2026-07-28' });
            expect(result.era).toBe('modern');
            expect(result.declaredRevision).toBe('2026-07-28');
        });

        it('should resolve to modern when header is unsupported revision', () => {
            const result = resolveEra('tools/list', {}, { 'Mcp-Protocol-Version': '2099-01-01' });
            expect(result.era).toBe('modern');
            expect(result.declaredRevision).toBe('2099-01-01');
        });

        it('should resolve to legacy when body _meta is 2024-11-05', () => {
            const body = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2024-11-05' } };
            const result = resolveEra('tools/list', body, {});
            expect(result.era).toBe('legacy');
            expect(result.declaredRevision).toBe('2024-11-05');
        });

        it('should resolve to modern when body _meta is 2026-07-28', () => {
            const body = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } };
            const result = resolveEra('tools/list', body, {});
            expect(result.era).toBe('modern');
            expect(result.declaredRevision).toBe('2026-07-28');
        });
    });

    describe('header precedence (Requirement 4.7)', () => {
        it('should prefer header over body _meta', () => {
            const body = { _meta: { 'io.modelcontextprotocol/protocolVersion': '2024-11-05' } };
            const headers = { 'Mcp-Protocol-Version': '2026-07-28' };
            const result = resolveEra('tools/list', body, headers);
            expect(result.era).toBe('modern');
            expect(result.declaredRevision).toBe('2026-07-28');
        });
    });

    describe('default rule (Requirement 4.5)', () => {
        it('should resolve to legacy when no version declared', () => {
            const result = resolveEra('tools/list', {}, {});
            expect(result.era).toBe('legacy');
            expect(result.declaredRevision).toBeNull();
        });

        it('should resolve to legacy for any other method with no version', () => {
            const result = resolveEra('tools/call', {}, {});
            expect(result.era).toBe('legacy');
            expect(result.declaredRevision).toBeNull();
        });
    });

    describe('case-insensitive header handling', () => {
        it('should handle lowercase header', () => {
            const result = resolveEra('tools/list', {}, { 'mcp-protocol-version': '2026-07-28' });
            expect(result.era).toBe('modern');
            expect(result.declaredRevision).toBe('2026-07-28');
        });

        it('should handle uppercase header', () => {
            const result = resolveEra('tools/list', {}, { 'MCP-PROTOCOL-VERSION': '2026-07-28' });
            expect(result.era).toBe('modern');
            expect(result.declaredRevision).toBe('2026-07-28');
        });
    });
});

describe('validateHeadersForModern', () => {
    describe('success cases', () => {
        it('should return null when Mcp-Method matches method', () => {
            const result = validateHeadersForModern('tools/list', { 'Mcp-Method': 'tools/list' }, {});
            expect(result).toBeNull();
        });

        it('should return null when Mcp-Name matches body name', () => {
            const body = { method: 'tools/call', params: { name: 'getTool' } };
            const result = validateHeadersForModern('tools/call', { 'Mcp-Name': 'getTool' }, body);
            expect(result).toBeNull();
        });

        it('should return null when no Mcp headers present', () => {
            const result = validateHeadersForModern('tools/list', {}, {});
            expect(result).toBeNull();
        });

        it('should handle case-insensitive header names', () => {
            const result = validateHeadersForModern('tools/list', { 'mcp-method': 'tools/list' }, {});
            expect(result).toBeNull();
        });
    });

    describe('error cases', () => {
        it('should return error when Mcp-Method disagrees with method', () => {
            const result = validateHeadersForModern('tools/list', { 'Mcp-Method': 'tools/call' }, {});
            expect(result).not.toBeNull();
            expect(result.message).toBe('Header mismatch');
            expect(result.data.detail).toContain('Mcp-Method header disagrees');
        });

        it('should return error when Mcp-Name disagrees with body name', () => {
            const body = { method: 'tools/call', params: { name: 'getTool' } };
            const result = validateHeadersForModern('tools/call', { 'Mcp-Name': 'wrongTool' }, body);
            expect(result).not.toBeNull();
            expect(result.message).toBe('Header mismatch');
            expect(result.data.detail).toContain('Mcp-Name header disagrees');
        });
    });
});
