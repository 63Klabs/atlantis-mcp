/**
 * Unit tests for MCP Protocol Constants
 *
 * Tests that the single-source-of-truth constants for MCP protocol revisions
 * are correctly defined and exported from mcp-protocol.js, and that every
 * surface that reports supported versions reads from the same definition.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 12.1, 15.2
 */

const {
  LEGACY_REVISIONS,
  MODERN_REVISIONS,
  SUPPORTED_PROTOCOL_VERSIONS,
  ALLOWED_REVISIONS,
  SERVER_NAME,
  TOOLS_LIST_TTL_MS,
  CACHE_SCOPES,
  TOOLS_LIST_CACHE_SCOPE,
  getCapabilities,
  negotiateProtocol,
  discoverResult,
  toolsListResult
} = require('../../../utils/mcp-protocol');
const era = require('../../../utils/mcp-era');

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

describe('MCP Protocol Constants', () => {
  describe('LEGACY_REVISIONS', () => {
    it('lists the handshake-era revisions, oldest first', () => {
      expect(LEGACY_REVISIONS).toEqual(['2024-11-05', '2025-11-25']);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(LEGACY_REVISIONS)).toBe(true);
    });
  });

  describe('MODERN_REVISIONS', () => {
    it('lists the stateless-era revisions', () => {
      expect(MODERN_REVISIONS).toEqual(['2026-07-28']);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(MODERN_REVISIONS)).toBe(true);
    });

    it('contains only revisions newer than every legacy revision', () => {
      const newestLegacy = LEGACY_REVISIONS[LEGACY_REVISIONS.length - 1];
      MODERN_REVISIONS.forEach((revision) => {
        expect(revision > newestLegacy).toBe(true);
      });
    });
  });

  describe('SUPPORTED_PROTOCOL_VERSIONS', () => {
    it('is the advertised set once every required field is implemented (gate: Requirement 12.1)', () => {
      // >! This is the single line to change when a revision is added to the advertisement.
      expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual(['2024-11-05', '2025-11-25', '2026-07-28']);
    });

    it('is ordered oldest to newest with valid date strings', () => {
      SUPPORTED_PROTOCOL_VERSIONS.forEach((revision) => {
        expect(revision).toMatch(DATE_FORMAT);
        expect(new Date(revision).toString()).not.toBe('Invalid Date');
      });
      for (let i = 1; i < SUPPORTED_PROTOCOL_VERSIONS.length; i++) {
        expect(SUPPORTED_PROTOCOL_VERSIONS[i] > SUPPORTED_PROTOCOL_VERSIONS[i - 1]).toBe(true);
      }
    });

    it('is frozen and cannot be modified', () => {
      expect(Object.isFrozen(SUPPORTED_PROTOCOL_VERSIONS)).toBe(true);
      expect(() => SUPPORTED_PROTOCOL_VERSIONS.push('2099-01-01')).toThrow();
    });

    it('only advertises revisions that belong to an era', () => {
      const known = new Set([...LEGACY_REVISIONS, ...MODERN_REVISIONS]);
      SUPPORTED_PROTOCOL_VERSIONS.forEach((revision) => {
        expect(known.has(revision)).toBe(true);
      });
    });

    it('has no revision in both eras', () => {
      LEGACY_REVISIONS.forEach((revision) => {
        expect(MODERN_REVISIONS).not.toContain(revision);
      });
    });

    it('ALLOWED_REVISIONS is the same object (alias for existing call sites)', () => {
      expect(ALLOWED_REVISIONS).toBe(SUPPORTED_PROTOCOL_VERSIONS);
    });
  });

  describe('Single source of truth (Requirements 3.3, 15.2)', () => {
    it('mcp-era re-exports the same era arrays rather than defining its own', () => {
      expect(era.LEGACY_REVISIONS).toBe(LEGACY_REVISIONS);
      expect(era.MODERN_REVISIONS).toBe(MODERN_REVISIONS);
    });

    it('getCapabilities() reports the shared list', () => {
      expect(getCapabilities().supportedVersions).toBe(SUPPORTED_PROTOCOL_VERSIONS);
    });

    it('server/discover reports the shared list', () => {
      expect(discoverResult('x').result.supportedVersions).toEqual([...SUPPORTED_PROTOCOL_VERSIONS]);
    });

    it('negotiateProtocol() accepts exactly the shared list and reports it on rejection', () => {
      SUPPORTED_PROTOCOL_VERSIONS.forEach((revision) => {
        expect(negotiateProtocol(revision).accepted).toBe(true);
      });
      const rejected = negotiateProtocol('2099-01-01');
      expect(rejected.accepted).toBe(false);
      expect(rejected.supportedVersions).toBe(SUPPORTED_PROTOCOL_VERSIONS);
    });

    it('server name has one definition shared by getCapabilities()', () => {
      expect(getCapabilities().serverInfo.name).toBe(SERVER_NAME);
    });
  });

  describe('CACHE_SCOPES and TOOLS_LIST_CACHE_SCOPE (Requirements 5.2, 5.3)', () => {
    it('CACHE_SCOPES is frozen', () => {
      expect(Object.isFrozen(CACHE_SCOPES)).toBe(true);
    });

    it('CACHE_SCOPES has exactly the two scopes the specification allows', () => {
      expect([...CACHE_SCOPES].sort()).toEqual(['private', 'public']);
    });

    it('TOOLS_LIST_CACHE_SCOPE is a member of CACHE_SCOPES', () => {
      expect(CACHE_SCOPES).toContain(TOOLS_LIST_CACHE_SCOPE);
    });

    it('modern toolsListResult reports the constants as its cache hints', () => {
      const { result } = toolsListResult('x', { era: 'modern', catalog: [] });
      expect(result.cacheScope).toBe(TOOLS_LIST_CACHE_SCOPE);
      expect(result.ttlMs).toBe(TOOLS_LIST_TTL_MS);
    });

    it('server/discover reports the same cache hints as the modern tools/list', () => {
      const { result } = discoverResult('x');
      expect(result.cacheScope).toBe(TOOLS_LIST_CACHE_SCOPE);
      expect(result.ttlMs).toBe(TOOLS_LIST_TTL_MS);
    });
  });
});
