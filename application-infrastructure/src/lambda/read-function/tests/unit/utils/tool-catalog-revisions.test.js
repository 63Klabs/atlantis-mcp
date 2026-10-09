/**
 * Unit tests for revision-dependent Tool.title and Tool.annotations emission
 * 
 * Per the MCP protocol dual-era spec (Phase 3, task 9.3), Tool.title and
 * Tool.annotations are:
 * - NOT emitted on revision 2024-11-05 (baseline, no support)
 * - Emitted on revision 2025-11-25 (last legacy, added in Phase 3)
 * - Emitted on revision 2026-07-28 (modern, added in Phase 4)
 * 
 * This test validates the revision-dependent emission behavior by calling
 * buildToolCatalog() with different protocolVersion values and asserting
 * the presence/absence of title and annotations fields.
 * 
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */

const { describe, it, expect, beforeAll } = require('@jest/globals');
const { buildToolCatalog, REVISIONS_SUPPORTING_TITLE_ANNOTATIONS } = require('../../../utils/tool-catalog');
const settings = require('../../../config/settings');

describe('Tool Catalog - Revision-Dependent Title/Annotations', () => {
  
  let toolsWithRegistryEntry;
  let toolsWithoutRegistryEntry;
  
  beforeAll(() => {
    // Identify tools that have registry entries (will have title/annotations when allowed)
    // and tools that don't (will not have title/annotations even when allowed)
    const { generateTitles, generateAnnotations } = require('../../../config/tool-metadata');
    
    toolsWithRegistryEntry = settings.tools.availableToolsList.filter(tool => {
      return generateTitles(tool.name) !== undefined;
    });
    
    toolsWithoutRegistryEntry = settings.tools.availableToolsList.filter(tool => {
      return generateTitles(tool.name) === undefined;
    });
  });
  
  describe('Revision 2024-11-05 (baseline - no title/annotations support)', () => {
    
    it('should NOT include title field on any tool', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      
      // Verify REVISIONS_SUPPORTING_TITLE_ANNOTATIONS does not include this revision
      expect(REVISIONS_SUPPORTING_TITLE_ANNOTATIONS).not.toContain('2024-11-05');
      
      // Verify no tool carries title
      catalog.forEach(tool => {
        expect(tool).not.toHaveProperty('title');
      });
      
      // Verify we tested a non-empty catalog
      expect(catalog.length).toBeGreaterThan(0);
    });
    
    it('should NOT include annotations field on any tool', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      
      // Verify no tool carries annotations
      catalog.forEach(tool => {
        expect(tool).not.toHaveProperty('annotations');
      });
    });
    
    it('should include all required fields (name, description, inputSchema)', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      
      catalog.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });
  
  describe('Revision 2025-11-25 (legacy with title/annotations support)', () => {
    
    it('should include title field on tools with registry entries', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      // Verify REVISIONS_SUPPORTING_TITLE_ANNOTATIONS includes this revision
      expect(REVISIONS_SUPPORTING_TITLE_ANNOTATIONS).toContain('2025-11-25');
      
      // Find tools with registry entries in the catalog
      const catalogToolsWithRegistry = catalog.filter(tool => 
        toolsWithRegistryEntry.some(t => t.name === tool.name)
      );
      
      // Verify every tool with a registry entry carries title
      catalogToolsWithRegistry.forEach(tool => {
        expect(tool).toHaveProperty('title');
        expect(typeof tool.title).toBe('string');
        expect(tool.title.length).toBeGreaterThan(0);
      });
      
      // Verify we tested at least one tool
      expect(catalogToolsWithRegistry.length).toBeGreaterThan(0);
    });
    
    it('should include annotations field on tools with registry entries', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      // Find tools with registry entries in the catalog
      const catalogToolsWithRegistry = catalog.filter(tool => 
        toolsWithRegistryEntry.some(t => t.name === tool.name)
      );
      
      // Verify every tool with a registry entry carries annotations
      catalogToolsWithRegistry.forEach(tool => {
        expect(tool).toHaveProperty('annotations');
        expect(typeof tool.annotations).toBe('object');
        expect(tool.annotations).not.toBeNull();
      });
    });
    
    it('should NOT include title/annotations on tools without registry entries', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      // Find tools without registry entries in the catalog
      const catalogToolsWithoutRegistry = catalog.filter(tool => 
        toolsWithoutRegistryEntry.some(t => t.name === tool.name)
      );
      
      // Verify tools without registry entries don't carry title/annotations
      // (generateTitles/generateAnnotations return undefined for these)
      catalogToolsWithoutRegistry.forEach(tool => {
        if (!toolsWithRegistryEntry.some(t => t.name === tool.name)) {
          // Only check if the tool truly has no registry entry
          expect(tool).not.toHaveProperty('title');
          expect(tool).not.toHaveProperty('annotations');
        }
      });
    });
    
    it('should still include all required fields', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      catalog.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      });
    });
  });
  
  describe('Revision 2026-07-28 (modern with title/annotations support)', () => {
    
    it('should include title field on tools with registry entries (same as 2025-11-25)', () => {
      // This test will pass trivially today since 2026-07-28 is not yet in the allowlist,
      // but prepares Phase 4 when it will be added
      const catalog = buildToolCatalog({ protocolVersion: '2026-07-28' });
      
      // After Phase 4, REVISIONS_SUPPORTING_TITLE_ANNOTATIONS will include this revision
      const supportsTitle = REVISIONS_SUPPORTING_TITLE_ANNOTATIONS.includes('2026-07-28');
      
      if (supportsTitle) {
        // Find tools with registry entries in the catalog
        const catalogToolsWithRegistry = catalog.filter(tool => 
          toolsWithRegistryEntry.some(t => t.name === tool.name)
        );
        
        // Verify every tool with a registry entry carries title
        catalogToolsWithRegistry.forEach(tool => {
          expect(tool).toHaveProperty('title');
          expect(typeof tool.title).toBe('string');
        });
      } else {
        // Before Phase 4, no tool should carry title on this revision
        catalog.forEach(tool => {
          expect(tool).not.toHaveProperty('title');
        });
      }
    });
    
    it('should include annotations field on tools with registry entries (same as 2025-11-25)', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2026-07-28' });
      
      const supportsAnnotations = REVISIONS_SUPPORTING_TITLE_ANNOTATIONS.includes('2026-07-28');
      
      if (supportsAnnotations) {
        // Find tools with registry entries in the catalog
        const catalogToolsWithRegistry = catalog.filter(tool => 
          toolsWithRegistryEntry.some(t => t.name === tool.name)
        );
        
        // Verify every tool with a registry entry carries annotations
        catalogToolsWithRegistry.forEach(tool => {
          expect(tool).toHaveProperty('annotations');
          expect(typeof tool.annotations).toBe('object');
        });
      } else {
        // Before Phase 4, no tool should carry annotations on this revision
        catalog.forEach(tool => {
          expect(tool).not.toHaveProperty('annotations');
        });
      }
    });
  });
  
  describe('Unknown/unsupported revision', () => {
    
    it('should NOT include title/annotations on unsupported revision', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2099-01-01' });
      
      // Unknown revision should not support title/annotations
      catalog.forEach(tool => {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      });
    });
    
    it('should NOT include title/annotations when protocolVersion is undefined', () => {
      const catalog = buildToolCatalog({});
      
      // No protocolVersion should not support title/annotations
      catalog.forEach(tool => {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      });
    });
    
    it('should NOT include title/annotations when protocolVersion is null', () => {
      const catalog = buildToolCatalog({ protocolVersion: null });
      
      // Null protocolVersion should not support title/annotations
      catalog.forEach(tool => {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      });
    });
  });
  
  describe('Determinism across revisions', () => {
    
    it('should return same tool order for different revisions', () => {
      const catalog2024 = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const catalog2025 = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      // Same number of tools
      expect(catalog2024.length).toBe(catalog2025.length);
      
      // Same tool order (names in same sequence)
      catalog2024.forEach((tool, index) => {
        expect(tool.name).toBe(catalog2025[index].name);
      });
    });
    
    it('should return identical tool list (minus title/annotations) for all revisions', () => {
      const catalog2024 = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const catalog2025 = buildToolCatalog({ protocolVersion: '2025-11-25' });
      
      // Each tool in catalog2024 should match the corresponding tool in catalog2025
      // except for the presence/absence of title/annotations
      catalog2024.forEach((tool, index) => {
        const tool2025 = catalog2025[index];
        
        expect(tool.name).toBe(tool2025.name);
        expect(tool.description).toBe(tool2025.description);
        expect(tool.inputSchema).toEqual(tool2025.inputSchema);
      });
    });
  });
  
  describe('REVISIONS_SUPPORTING_TITLE_ANNOTATIONS constant', () => {
    
    it('should be an array', () => {
      expect(Array.isArray(REVISIONS_SUPPORTING_TITLE_ANNOTATIONS)).toBe(true);
    });
    
    it('should be frozen (immutable)', () => {
      expect(Object.isFrozen(REVISIONS_SUPPORTING_TITLE_ANNOTATIONS)).toBe(true);
    });
    
    it('should contain only valid revision strings', () => {
      REVISIONS_SUPPORTING_TITLE_ANNOTATIONS.forEach(revision => {
        expect(typeof revision).toBe('string');
        expect(revision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });
    
    it('should include 2025-11-25 after Phase 3', () => {
      // This test documents Phase 3 expectation
      expect(REVISIONS_SUPPORTING_TITLE_ANNOTATIONS).toContain('2025-11-25');
    });
  });
});
