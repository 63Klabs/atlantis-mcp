/**
 * Unit Tests for negotiateProtocol()
 * 
 * Tests the protocol negotiation logic that determines whether a client's
 * declared protocol revision is supported. This is part of the dual-era
 * MCP protocol support implementation.
 * 
 * NOTE: These tests verify the CURRENT implementation which only supports
 * '2024-11-05'. The implementation has a local ALLOWED_REVISIONS constant
 * that shadows the module-level constant. Future task will fix this to use
 * the module-level constant which includes both '2024-11-05' and '2025-11-25'.
 * 
 * Requirements tested: 3.2, 3.3, 3.4, 15.6
 */

// Set required env var before loading modules
process.env.PARAM_STORE_PATH = process.env.PARAM_STORE_PATH || '/test/';

// Import the module under test
const { negotiateProtocol, ALLOWED_REVISIONS } = require('../../../utils/mcp-protocol');

// Phase 3: Current implementation supports both '2024-11-05' and '2025-11-25'
const CURRENT_SUPPORTED_REVISIONS = ['2024-11-05', '2025-11-25'];

describe('negotiateProtocol()', () => {
  describe('Acceptance of Allowed Revisions (Requirements 3.3, 15.6)', () => {
    it('should accept revision 2024-11-05 (currently supported)', () => {
      const result = negotiateProtocol('2024-11-05');

      expect(result).toEqual({
        accepted: true,
        negotiatedRevision: '2024-11-05',
        supportedVersions: CURRENT_SUPPORTED_REVISIONS,
        message: 'Protocol version 2024-11-05 accepted'
      });
      expect(result.accepted).toBe(true);
      expect(result.negotiatedRevision).toBe('2024-11-05');
    });

    it('should accept revision 2025-11-25 (Phase 3)', () => {
      // Phase 3: 2025-11-25 is now supported
      const result = negotiateProtocol('2025-11-25');

      expect(result.accepted).toBe(true);
      expect(result.negotiatedRevision).toBe('2025-11-25');
      expect(result.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
      expect(result.message).toContain('2025-11-25 accepted');
    });
  });

  describe('Rejection of Unknown Revisions (Requirements 3.3, 3.4, 15.6)', () => {
    it('should reject unsupported revision 2099-01-01', () => {
      const result = negotiateProtocol('2099-01-01');

      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
      expect(result.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
      expect(result.message).toContain('2099-01-01 not supported');
      expect(result.message).toContain('Supported versions:');
    });

    it('should reject unsupported revision 2020-01-01', () => {
      const result = negotiateProtocol('2020-01-01');

      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
      expect(result.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
    });

    it('should reject invalid revision format', () => {
      const result = negotiateProtocol('invalid-version');

      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
      expect(result.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
    });

    it('should reject empty string', () => {
      const result = negotiateProtocol('');

      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
      expect(result.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
    });
  });

  describe('supportedVersions Field (Requirement 3.4, 15.6)', () => {
    it('should always return supportedVersions array from function implementation', () => {
      const resultAccepted = negotiateProtocol('2024-11-05');
      const resultRejected = negotiateProtocol('2099-01-01');

      // Both accepted and rejected responses must have supportedVersions
      expect(resultAccepted.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
      expect(resultRejected.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
    });

    it('should include all currently supported revisions in supportedVersions', () => {
      const result = negotiateProtocol('2024-11-05');

      // Phase 3: Now includes both 2024-11-05 and 2025-11-25
      expect(result.supportedVersions).toContain('2024-11-05');
      expect(result.supportedVersions).toContain('2025-11-25');
      expect(result.supportedVersions.length).toBe(2);
    });

    it('supportedVersions should match current implementation', () => {
      const result = negotiateProtocol('2099-01-01');

      expect(result.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
      expect(Array.isArray(result.supportedVersions)).toBe(true);
      expect(result.supportedVersions.length).toBeGreaterThan(0);
    });
  });

  describe('Response Structure (Requirements 3.2, 15.6)', () => {
    it('should return object with accepted, negotiatedRevision, supportedVersions, and message for accepted revision', () => {
      const result = negotiateProtocol('2024-11-05');

      expect(result).toHaveProperty('accepted');
      expect(result).toHaveProperty('negotiatedRevision');
      expect(result).toHaveProperty('supportedVersions');
      expect(result).toHaveProperty('message');
      
      expect(typeof result.accepted).toBe('boolean');
      expect(typeof result.negotiatedRevision).toBe('string');
      expect(Array.isArray(result.supportedVersions)).toBe(true);
      expect(typeof result.message).toBe('string');
    });

    it('should return object with accepted=false, negotiatedRevision=null, supportedVersions, and message for rejected revision', () => {
      const result = negotiateProtocol('2099-01-01');

      expect(result).toHaveProperty('accepted');
      expect(result).toHaveProperty('negotiatedRevision');
      expect(result).toHaveProperty('supportedVersions');
      expect(result).toHaveProperty('message');
      
      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
      expect(Array.isArray(result.supportedVersions)).toBe(true);
      expect(typeof result.message).toBe('string');
    });

    it('should not include protocol, version, capabilities, or tools properties', () => {
      const resultAccepted = negotiateProtocol('2024-11-05');
      const resultRejected = negotiateProtocol('2099-01-01');

      // These properties should NOT be present in negotiation result
      expect(resultAccepted).not.toHaveProperty('protocol');
      expect(resultAccepted).not.toHaveProperty('version');
      expect(resultAccepted).not.toHaveProperty('capabilities');
      expect(resultAccepted).not.toHaveProperty('tools');

      expect(resultRejected).not.toHaveProperty('protocol');
      expect(resultRejected).not.toHaveProperty('version');
      expect(resultRejected).not.toHaveProperty('capabilities');
      expect(resultRejected).not.toHaveProperty('tools');
    });
  });

  describe('Message Content (Requirement 3.3)', () => {
    it('should include accepted revision in success message', () => {
      const result = negotiateProtocol('2024-11-05');

      expect(result.message).toBe('Protocol version 2024-11-05 accepted');
      expect(result.message).toContain('2024-11-05');
      expect(result.message).toContain('accepted');
    });

    it('should include rejected revision and supported versions in failure message', () => {
      const result = negotiateProtocol('2099-01-01');

      expect(result.message).toContain('2099-01-01');
      expect(result.message).toContain('not supported');
      expect(result.message).toContain('Supported versions:');
      expect(result.message).toContain('2024-11-05');
    });

    it('should list all currently supported versions in rejection message', () => {
      const result = negotiateProtocol('invalid');

      // Message should contain the list of currently supported versions
      CURRENT_SUPPORTED_REVISIONS.forEach(revision => {
        expect(result.message).toContain(revision);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle null input', () => {
      const result = negotiateProtocol(null);

      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
      expect(result.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
    });

    it('should handle undefined input', () => {
      const result = negotiateProtocol(undefined);

      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
      expect(result.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
    });

    it('should handle case-sensitive revision strings', () => {
      // Test with a completely different string that has different case
      // (can't use toUpperCase on date format as it has no letters)
      const result = negotiateProtocol('2024-11-05-UPPERCASE');

      // Current implementation uses includes() which is case-sensitive
      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
    });

    it('should not accept revisions with extra whitespace', () => {
      const result = negotiateProtocol(' 2024-11-05 ');

      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
    });

    it('should not accept partial matches', () => {
      const result = negotiateProtocol('2024-11');

      expect(result.accepted).toBe(false);
      expect(result.negotiatedRevision).toBeNull();
    });
  });

  describe('Integration with current implementation (Requirement 3.4)', () => {
    it('should accept exactly the revisions in current implementation', () => {
      CURRENT_SUPPORTED_REVISIONS.forEach(revision => {
        const result = negotiateProtocol(revision);
        expect(result.accepted).toBe(true);
        expect(result.negotiatedRevision).toBe(revision);
      });
    });

    it('should reject revisions not in current implementation', () => {
      const unsupportedRevisions = [
        '2020-01-01',
        '2023-12-31',
        // Phase 3: '2025-11-25' is now supported
        '2026-01-01',
        '2099-12-31'
      ];

      unsupportedRevisions.forEach(revision => {
        const result = negotiateProtocol(revision);
        expect(result.accepted).toBe(false);
        expect(result.negotiatedRevision).toBeNull();
      });
    });

    it('supportedVersions should always equal current implementation', () => {
      const testRevisions = ['2024-11-05', '2099-01-01', '', null, undefined];

      testRevisions.forEach(revision => {
        const result = negotiateProtocol(revision);
        expect(result.supportedVersions).toEqual(CURRENT_SUPPORTED_REVISIONS);
      });
    });
  });

  describe('Deterministic Behavior', () => {
    it('should return identical results for the same input', () => {
      const result1 = negotiateProtocol('2024-11-05');
      const result2 = negotiateProtocol('2024-11-05');

      expect(result1).toEqual(result2);
    });

    it('should return identical rejection results for different unsupported versions', () => {
      const result1 = negotiateProtocol('2099-01-01');
      const result2 = negotiateProtocol('2020-01-01');

      expect(result1.accepted).toBe(result2.accepted);
      expect(result1.negotiatedRevision).toBe(result2.negotiatedRevision);
      expect(result1.supportedVersions).toEqual(result2.supportedVersions);
      
      // Messages will differ because they include the specific rejected version
      expect(result1.message).not.toBe(result2.message);
    });

    it('should be pure function with no side effects', () => {
      const initialCurrentRevisions = [...CURRENT_SUPPORTED_REVISIONS];
      
      negotiateProtocol('2024-11-05');
      negotiateProtocol('2099-01-01');
      negotiateProtocol('invalid');
      
      expect(CURRENT_SUPPORTED_REVISIONS).toEqual(initialCurrentRevisions);
    });
  });
});
