/**
 * Unit tests for revision-dependent Tool.title / Tool.annotations emission
 * 
 * Per Requirement 13.1-13.4, Tool.title and Tool.annotations are emitted only
 * on protocol revisions that support them (2025-11-25 and 2026-07-28), and
 * omitted entirely on revisions that do not support them (2024-11-05).
 * 
 * These tests verify the allowlist-driven emission behavior across all three
 * advertised revisions.
 * 
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { buildToolCatalog } from '../../../utils/tool-catalog.js';

describe('tool-catalog revision-dependent title/annotations', () => {
  let toolsWithRegistry;
  let toolsWithoutRegistry;

  beforeAll(async () => {
    // Import the tool metadata registry to determine which tools have registry entries
    const { hasRegistryEntry } = await import('../../../config/tool-metadata.js');
    const settings = await import('../../../config/settings.js');
    
    const manifest = settings.default.tools.availableToolsList;
    toolsWithRegistry = manifest.filter(tool => hasRegistryEntry(tool.name));
    toolsWithoutRegistry = manifest.filter(tool => !hasRegistryEntry(tool.name));
  });

  describe('2024-11-05 (baseline legacy revision)', () => {
    it('should NOT emit title or annotations on any tool', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      
      expect(catalog.length).toBeGreaterThan(0);
      
      for (const tool of catalog) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        
        // Title and annotations MUST NOT be present on 2024-11-05
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      }
    });

    it('should emit all required fields for 2024-11-05', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      
      for (const tool of catalog) {
        // Required fields on 2024-11-05
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      }
    });
  });

  describe('2025-11-25 (last handshake legacy revision)', () => {
    it('should emit title on tools with registry entries', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      for (const tool of catalog) {
        const hasRegistry = toolsWithRegistry.some(t => t.name === tool.name);
        
        if (hasRegistry) {
          // Tools with registry entries MUST have title
          expect(tool).toHaveProperty('title');
          expect(typeof tool.title).toBe('string');
          expect(tool.title.length).toBeGreaterThan(0);
        }
      }
    });

    it('should emit annotations on tools with registry entries', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      for (const tool of catalog) {
        const hasRegistry = toolsWithRegistry.some(t => t.name === tool.name);
        
        if (hasRegistry) {
          // Tools with registry entries MUST have annotations
          expect(tool).toHaveProperty('annotations');
          expect(typeof tool.annotations).toBe('object');
        }
      }
    });

    it('should emit all required fields for 2025-11-25', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      for (const tool of catalog) {
        // Required fields on 2025-11-25 (same as 2024-11-05)
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      }
    });
  });

  describe('2026-07-28 (modern revision)', () => {
    it('should emit title on tools with registry entries (when allowlist includes 2026-07-28)', () => {
      // This test will pass trivially today since 2026-07-28 is not yet in
      // the allowlist (added in Phase 4, task 16.1), but prepares for that addition
      const catalog = buildToolCatalog({ protocolVersion: '2026-07-28' });
      
      const { REVISIONS_SUPPORTING_TITLE_ANNOTATIONS } = require('../../../utils/tool-catalog.js');
      const supports2026 = REVISIONS_SUPPORTING_TITLE_ANNOTATIONS.includes('2026-07-28');
      
      for (const tool of catalog) {
        const hasRegistry = toolsWithRegistry.some(t => t.name === tool.name);
        
        if (supports2026 && hasRegistry) {
          expect(tool).toHaveProperty('title');
          expect(typeof tool.title).toBe('string');
          expect(tool.title.length).toBeGreaterThan(0);
        } else if (!supports2026) {
          // Before Phase 4, 2026-07-28 is not in allowlist, so no title/annotations
          expect(tool).not.toHaveProperty('title');
          expect(tool).not.toHaveProperty('annotations');
        }
      }
    });

    it('should emit annotations on tools with registry entries (when allowlist includes 2026-07-28)', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2026-07-28' });
      
      const { REVISIONS_SUPPORTING_TITLE_ANNOTATIONS } = require('../../../utils/tool-catalog.js');
      const supports2026 = REVISIONS_SUPPORTING_TITLE_ANNOTATIONS.includes('2026-07-28');
      
      for (const tool of catalog) {
        const hasRegistry = toolsWithRegistry.some(t => t.name === tool.name);
        
        if (supports2026 && hasRegistry) {
          expect(tool).toHaveProperty('annotations');
          expect(typeof tool.annotations).toBe('object');
        } else if (!supports2026) {
          expect(tool).not.toHaveProperty('annotations');
        }
      }
    });

    it('should emit all required fields for 2026-07-28', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2026-07-28' });
      
      for (const tool of catalog) {
        // Required fields on 2026-07-28 (same as earlier revisions)
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      }
    });
  });

  describe('Undefined or null protocol version', () => {
    it('should NOT emit title or annotations when protocol version is undefined', () => {
      const catalog = buildToolCatalog({ protocolVersion: undefined });
      
      for (const tool of catalog) {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      }
    });

    it('should NOT emit title or annotations when protocol version is null', () => {
      const catalog = buildToolCatalog({ protocolVersion: null });
      
      for (const tool of catalog) {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      }
    });

    it('should NOT emit title or annotations when options object is omitted', () => {
      const catalog = buildToolCatalog();
      
      for (const tool of catalog) {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      }
    });
  });

  describe('Unsupported protocol version', () => {
    it('should NOT emit title or annotations for unsupported revision 2099-01-01', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2099-01-01' });
      
      for (const tool of catalog) {
        // Unsupported revisions default to not supporting title/annotations
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      }
    });
  });

  describe('Consistency across revisions', () => {
    it('should return the same tool names regardless of revision', () => {
      const catalog2024 = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const catalog2025 = buildToolCatalog({ protocolVersion: '2025-11-25' });
      const catalog2026 = buildToolCatalog({ protocolVersion: '2026-07-28' });
      
      const names2024 = catalog2024.map(t => t.name).sort();
      const names2025 = catalog2025.map(t => t.name).sort();
      const names2026 = catalog2026.map(t => t.name).sort();
      
      // All revisions must expose the exact same set of tool names
      expect(names2024).toEqual(names2025);
      expect(names2025).toEqual(names2026);
    });

    it('should return tools in the same order regardless of revision', () => {
      const catalog2024 = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const catalog2025 = buildToolCatalog({ protocolVersion: '2025-11-25' });
      const catalog2026 = buildToolCatalog({ protocolVersion: '2026-07-28' });
      
      const names2024 = catalog2024.map(t => t.name);
      const names2025 = catalog2025.map(t => t.name);
      const names2026 = catalog2026.map(t => t.name);
      
      // Order must be identical across all revisions
      expect(names2024).toEqual(names2025);
      expect(names2025).toEqual(names2026);
    });

    it('should have identical descriptions regardless of title/annotations presence', () => {
      const catalog2024 = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const catalog2025 = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      for (const tool2024 of catalog2024) {
        const tool2025 = catalog2025.find(t => t.name === tool2024.name);
        expect(tool2025).toBeDefined();
        
        // Description must be identical (including composed discovery blocks)
        expect(tool2025.description).toBe(tool2024.description);
      }
    });
  });
});
