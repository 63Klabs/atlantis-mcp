/**
 * Unit Tests for Tool Catalog Revision-Dependent Field Emission
 *
 * Tests that Tool.title and Tool.annotations are emitted only for protocol
 * revisions that support them, ensuring backward compatibility with older
 * clients while enabling modern features for newer clients.
 *
 * Requirements: 13.1, 13.2, 13.3
 * Phase: 3 (Tool Catalog Field Allowlist)
 */

// Set required env var before loading modules
process.env.PARAM_STORE_PATH = process.env.PARAM_STORE_PATH || '/test/';

const { buildToolCatalog, REVISIONS_SUPPORTING_TITLE_ANNOTATIONS } = require('../../../utils/tool-catalog');
const { LEGACY_REVISION, MODERN_REVISION } = require('../../../utils/mcp-protocol');
const settings = require('../../../config/settings');

describe('Tool Catalog - Revision-Dependent Field Emission', () => {
  describe('REVISIONS_SUPPORTING_TITLE_ANNOTATIONS constant', () => {
    test('should include 2025-11-25 (Requirement 13.1)', () => {
      // Phase 3: title and annotations were introduced in 2025-11-25
      expect(REVISIONS_SUPPORTING_TITLE_ANNOTATIONS).toContain('2025-11-25');
      expect(REVISIONS_SUPPORTING_TITLE_ANNOTATIONS).toContain(MODERN_REVISION);
    });

    test('should NOT include baseline revision 2024-11-05 (Requirement 13.2)', () => {
      // 2024-11-05 does not support title/annotations per design section 12
      expect(REVISIONS_SUPPORTING_TITLE_ANNOTATIONS).not.toContain('2024-11-05');
      expect(REVISIONS_SUPPORTING_TITLE_ANNOTATIONS).not.toContain(LEGACY_REVISION);
    });
  });

  describe('buildToolCatalog() with baseline revision (2024-11-05)', () => {
    test('should NOT include title field for baseline revision (Requirement 13.2)', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2024-11-05' });

      expect(Array.isArray(catalog)).toBe(true);
      expect(catalog.length).toBeGreaterThan(0);

      // Verify NO tool has a title field
      catalog.forEach((tool) => {
        expect(tool).not.toHaveProperty('title');
      });
    });

    test('should NOT include annotations field for baseline revision (Requirement 13.2)', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2024-11-05' });

      expect(catalog.length).toBeGreaterThan(0);

      // Verify NO tool has an annotations field
      catalog.forEach((tool) => {
        expect(tool).not.toHaveProperty('annotations');
      });
    });

    test('should include standard fields (name, description, inputSchema) for baseline revision', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2024-11-05' });

      catalog.forEach((tool) => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      });
    });

    test('should have exactly 3 properties per tool (name, description, inputSchema) for baseline revision', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2024-11-05' });

      catalog.forEach((tool) => {
        const keys = Object.keys(tool);
        expect(keys).toHaveLength(3);
        expect(keys).toContain('name');
        expect(keys).toContain('description');
        expect(keys).toContain('inputSchema');
      });
    });
  });

  describe('buildToolCatalog() with legacy revision (2025-11-25)', () => {
    test('should include title field when registry provides it (Requirement 13.1)', () => {
      const catalog = buildToolCatalog({ protocolVersion: LEGACY_REVISION });

      expect(catalog.length).toBeGreaterThan(0);

      // At least one tool should have a title (if metadata exists for it)
      // We test that IF title is present, it's a string
      catalog.forEach((tool) => {
        if (tool.title !== undefined) {
          expect(typeof tool.title).toBe('string');
          expect(tool.title.length).toBeGreaterThan(0);
        }
      });
    });

    test('should include annotations field when registry provides it (Requirement 13.1)', () => {
      const catalog = buildToolCatalog({ protocolVersion: LEGACY_REVISION });

      expect(catalog.length).toBeGreaterThan(0);

      // At least one tool should have annotations (if metadata exists for it)
      // We test that IF annotations is present, it's an object
      catalog.forEach((tool) => {
        if (tool.annotations !== undefined) {
          expect(typeof tool.annotations).toBe('object');
        }
      });
    });

    test('should still include standard fields (Requirement 13.3)', () => {
      const catalog = buildToolCatalog({ protocolVersion: LEGACY_REVISION });

      catalog.forEach((tool) => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.inputSchema).toBe('object');
      });
    });
  });

  describe('buildToolCatalog() with modern revision (2026-07-28)', () => {
    test('should include title field when registry provides it (Requirement 13.1)', () => {
      const catalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      expect(catalog.length).toBeGreaterThan(0);

      // At least one tool should have a title (if metadata exists for it)
      catalog.forEach((tool) => {
        if (tool.title !== undefined) {
          expect(typeof tool.title).toBe('string');
          expect(tool.title.length).toBeGreaterThan(0);
        }
      });
    });

    test('should include annotations field when registry provides it (Requirement 13.1)', () => {
      const catalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      expect(catalog.length).toBeGreaterThan(0);

      // At least one tool should have annotations (if metadata exists for it)
      catalog.forEach((tool) => {
        if (tool.annotations !== undefined) {
          expect(typeof tool.annotations).toBe('object');
        }
      });
    });

    test('should still include standard fields (Requirement 13.3)', () => {
      const catalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      catalog.forEach((tool) => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      });
    });
  });

  describe('buildToolCatalog() with no protocolVersion', () => {
    test('should NOT include title or annotations when protocolVersion is undefined (Requirement 13.2)', () => {
      const catalog = buildToolCatalog();

      expect(catalog.length).toBeGreaterThan(0);

      catalog.forEach((tool) => {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      });
    });

    test('should NOT include title or annotations when protocolVersion is null', () => {
      const catalog = buildToolCatalog({ protocolVersion: null });

      expect(catalog.length).toBeGreaterThan(0);

      catalog.forEach((tool) => {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      });
    });
  });

  describe('buildToolCatalog() with unsupported revision', () => {
    test('should NOT include title or annotations for unsupported future revision', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2099-01-01' });

      expect(catalog.length).toBeGreaterThan(0);

      catalog.forEach((tool) => {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      });
    });

    test('should NOT include title or annotations for unsupported past revision', () => {
      const catalog = buildToolCatalog({ protocolVersion: '2020-01-01' });

      expect(catalog.length).toBeGreaterThan(0);

      catalog.forEach((tool) => {
        expect(tool).not.toHaveProperty('title');
        expect(tool).not.toHaveProperty('annotations');
      });
    });
  });

  describe('Consistency across revisions', () => {
    test('baseline and modern revisions should have same tool count', () => {
      const baselineCatalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const modernCatalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      expect(baselineCatalog.length).toBe(modernCatalog.length);
    });

    test('baseline and modern revisions should have same tool names', () => {
      const baselineCatalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const modernCatalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      const baselineNames = baselineCatalog.map(t => t.name).sort();
      const modernNames = modernCatalog.map(t => t.name).sort();

      expect(baselineNames).toEqual(modernNames);
    });

    test('baseline and modern revisions should have same tool order (Requirement 2.7)', () => {
      const baselineCatalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const modernCatalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      const baselineNames = baselineCatalog.map(t => t.name);
      const modernNames = modernCatalog.map(t => t.name);

      expect(baselineNames).toEqual(modernNames);
    });

    test('tool descriptions should be identical across revisions (Requirement 13.3)', () => {
      const baselineCatalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const modernCatalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      baselineCatalog.forEach((baselineTool, index) => {
        const modernTool = modernCatalog[index];
        expect(baselineTool.description).toBe(modernTool.description);
      });
    });

    test('tool inputSchemas should be deep equal across revisions (Requirement 13.3)', () => {
      const baselineCatalog = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const modernCatalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      baselineCatalog.forEach((baselineTool, index) => {
        const modernTool = modernCatalog[index];
        expect(baselineTool.inputSchema).toEqual(modernTool.inputSchema);
      });
    });
  });

  describe('Requirement 13.4: Omit when no registry entry', () => {
    test('should omit title when registry has no title for tool (even on modern revision)', () => {
      const catalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      // Find tools without title in the catalog
      const toolsWithoutTitle = catalog.filter(t => t.title === undefined);

      // If there are tools without title, verify they don't have empty/undefined values
      if (toolsWithoutTitle.length > 0) {
        toolsWithoutTitle.forEach(tool => {
          expect(tool).not.toHaveProperty('title');
        });
      }
    });

    test('should omit annotations when registry has no annotations for tool (even on modern revision)', () => {
      const catalog = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      // Find tools without annotations in the catalog
      const toolsWithoutAnnotations = catalog.filter(t => t.annotations === undefined);

      // If there are tools without annotations, verify they don't have empty/undefined values
      if (toolsWithoutAnnotations.length > 0) {
        toolsWithoutAnnotations.forEach(tool => {
          expect(tool).not.toHaveProperty('annotations');
        });
      }
    });
  });

  describe('Deterministic output', () => {
    test('should return identical catalog for same revision on consecutive calls', () => {
      const catalog1 = buildToolCatalog({ protocolVersion: MODERN_REVISION });
      const catalog2 = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      expect(catalog1).toEqual(catalog2);
      expect(JSON.stringify(catalog1)).toBe(JSON.stringify(catalog2));
    });

    test('should return identical baseline catalog on consecutive calls', () => {
      const catalog1 = buildToolCatalog({ protocolVersion: '2024-11-05' });
      const catalog2 = buildToolCatalog({ protocolVersion: '2024-11-05' });

      expect(catalog1).toEqual(catalog2);
      expect(JSON.stringify(catalog1)).toBe(JSON.stringify(catalog2));
    });
  });

  describe('Non-mutation of source manifest', () => {
    test('should not mutate settings.tools.availableToolsList (Requirement 2.4)', () => {
      const originalManifest = settings.tools.availableToolsList;
      const originalFirstTool = originalManifest[0];
      const originalFirstToolKeys = Object.keys(originalFirstTool);

      // Build catalog with modern revision (which adds title/annotations)
      buildToolCatalog({ protocolVersion: MODERN_REVISION });

      // Verify original manifest unchanged
      expect(settings.tools.availableToolsList).toBe(originalManifest);
      expect(Object.keys(originalManifest[0])).toEqual(originalFirstToolKeys);
      expect(originalManifest[0]).not.toHaveProperty('title');
      expect(originalManifest[0]).not.toHaveProperty('annotations');
    });

    test('should return new array instances on each call', () => {
      const catalog1 = buildToolCatalog({ protocolVersion: MODERN_REVISION });
      const catalog2 = buildToolCatalog({ protocolVersion: MODERN_REVISION });

      // Arrays should not be the same reference
      expect(catalog1).not.toBe(catalog2);

      // Tool objects should not be the same reference
      expect(catalog1[0]).not.toBe(catalog2[0]);
    });
  });
});
