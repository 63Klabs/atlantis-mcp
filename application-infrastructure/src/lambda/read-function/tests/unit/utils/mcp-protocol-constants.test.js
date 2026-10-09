/**
 * Unit tests for MCP Protocol Constants
 * 
 * Tests that the single-source-of-truth constants for MCP protocol revisions
 * are correctly defined and exported from mcp-protocol.js.
 * 
 * Requirements: 3.1, 3.2
 */

const {
  LEGACY_REVISION,
  MODERN_REVISION,
  ALLOWED_REVISIONS
} = require('../../../utils/mcp-protocol');

describe('MCP Protocol Constants', () => {
  describe('LEGACY_REVISION', () => {
    it('should be defined as the oldest supported revision', () => {
      expect(LEGACY_REVISION).toBe('2024-11-05');
    });

    it('should be a string', () => {
      expect(typeof LEGACY_REVISION).toBe('string');
    });

    it('should match the date format YYYY-MM-DD', () => {
      expect(LEGACY_REVISION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('MODERN_REVISION', () => {
    it('should be defined as the newest supported revision', () => {
      expect(MODERN_REVISION).toBe('2025-11-25');
    });

    it('should be a string', () => {
      expect(typeof MODERN_REVISION).toBe('string');
    });

    it('should match the date format YYYY-MM-DD', () => {
      expect(MODERN_REVISION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should be newer than LEGACY_REVISION', () => {
      expect(new Date(MODERN_REVISION).getTime())
        .toBeGreaterThan(new Date(LEGACY_REVISION).getTime());
    });
  });

  describe('ALLOWED_REVISIONS', () => {
    it('should be an array containing both revisions', () => {
      expect(Array.isArray(ALLOWED_REVISIONS)).toBe(true);
      expect(ALLOWED_REVISIONS).toHaveLength(2);
    });

    it('should contain LEGACY_REVISION as first element', () => {
      expect(ALLOWED_REVISIONS[0]).toBe(LEGACY_REVISION);
    });

    it('should contain MODERN_REVISION as second element', () => {
      expect(ALLOWED_REVISIONS[1]).toBe(MODERN_REVISION);
    });

    it('should be ordered from oldest to newest', () => {
      const timestamps = ALLOWED_REVISIONS.map(rev => new Date(rev).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThan(timestamps[i - 1]);
      }
    });

    it('should be frozen (immutable)', () => {
      expect(Object.isFrozen(ALLOWED_REVISIONS)).toBe(true);
    });

    it('should not allow modifications', () => {
      expect(() => {
        ALLOWED_REVISIONS.push('2026-01-01');
      }).toThrow();
    });

    it('should contain only valid date strings', () => {
      ALLOWED_REVISIONS.forEach(revision => {
        expect(revision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(new Date(revision).toString()).not.toBe('Invalid Date');
      });
    });
  });

  describe('Single Source of Truth', () => {
    it('should export all three constants', () => {
      expect(LEGACY_REVISION).toBeDefined();
      expect(MODERN_REVISION).toBeDefined();
      expect(ALLOWED_REVISIONS).toBeDefined();
    });

    it('ALLOWED_REVISIONS elements should reference the constant values', () => {
      expect(ALLOWED_REVISIONS).toContain(LEGACY_REVISION);
      expect(ALLOWED_REVISIONS).toContain(MODERN_REVISION);
    });

    it('should have exactly two allowed revisions', () => {
      expect(ALLOWED_REVISIONS.length).toBe(2);
    });
  });
});
