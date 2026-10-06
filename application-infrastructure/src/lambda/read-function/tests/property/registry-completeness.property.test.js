/**
 * Property-Based Tests for Tool Metadata Registry Completeness
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 10: Registry completeness
 *
 * Every manifest tool has a metadata entry and an extended description;
 * every metadata key names a real tool; violations fail at load.
 *
 * This test targets two independent registries built against the live
 * manifest (`settings.tools.availableToolsList`):
 *
 *  - `config/tool-metadata.js` (`TOOL_METADATA`), whose `validateRegistry()`
 *    throws at module load on a manifest tool with no entry, an entry
 *    naming an unknown tool, or an entry missing a required field
 *    (task 6.1, R2.1).
 *  - `config/tool-descriptions.js` (`extendedDescriptions`), whose
 *    `validateDescriptions()` warns in both directions: an extended-
 *    description key with no matching manifest tool, and (as of task 8.1,
 *    Requirement 4.4) a manifest tool with no extended-description entry.
 *    This test asserts the manifest-tool-has-a-description half of
 *    Property 10 directly against the live data, which `validateDescriptions()`
 *    now also enforces (as a warning, not a throw) at module load.
 *
 * Validates: Requirements 2.1, 2.3, 4.4
 */

const fc = require('fast-check');
const settings = require('../../config/settings');
const { TOOL_METADATA, validateRegistry } = require('../../config/tool-metadata');
const { extendedDescriptions } = require('../../config/tool-descriptions');

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 10: Registry completeness', () => {

  const manifestToolNames = settings.tools.availableToolsList.map((tool) => tool.name);

  /**
   * **Validates: Requirements 2.1**
   *
   * Every tool name in the live manifest has a corresponding
   * `TOOL_METADATA` entry. Iterates the real manifest (not a hardcoded
   * list) so the property tracks the manifest as it grows.
   */
  test('every manifest tool has a TOOL_METADATA entry', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...manifestToolNames),
        (toolName) => {
          expect(TOOL_METADATA[toolName]).toBeDefined();
        }
      ),
      { numRuns: manifestToolNames.length }
    );
  });

  /**
   * **Validates: Requirements 2.1**
   *
   * Every key in `TOOL_METADATA` corresponds to a real tool name in the
   * manifest — no stray or orphaned registry entries left behind by a
   * rename or removal.
   */
  test('every TOOL_METADATA key names a real manifest tool', () => {
    const metadataKeys = Object.keys(TOOL_METADATA);
    const manifestNameSet = new Set(manifestToolNames);

    fc.assert(
      fc.property(
        fc.constantFrom(...metadataKeys),
        (key) => {
          expect(manifestNameSet.has(key)).toBe(true);
        }
      ),
      { numRuns: metadataKeys.length }
    );
  });

  /**
   * **Validates: Requirements 2.3, 4.4**
   *
   * Every tool name in the manifest also has a corresponding entry in
   * `extendedDescriptions`. This holds true against the current codebase
   * state: every one of today's manifest tools (the 13 literal entries
   * plus the 4 registry-generated agent-asset tools) already has an
   * extended description. The warn-on-missing-description enforcement
   * in `validateDescriptions()` (R4.4's "warn when a tool has no
   * extended description" half) is task 8.1's job and has not landed as
   * of this test; this assertion checks the underlying data directly so
   * it is not coupled to that enforcement mechanism landing first.
   */
  test('every manifest tool has an extended description entry', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...manifestToolNames),
        (toolName) => {
          expect(extendedDescriptions[toolName]).toBeDefined();
          expect(typeof extendedDescriptions[toolName]).toBe('string');
          expect(extendedDescriptions[toolName].trim()).not.toBe('');
        }
      ),
      { numRuns: manifestToolNames.length }
    );
  });

  /**
   * **Validates: Requirements 2.1**
   *
   * "Violations fail at load": exercises `TOOL_METADATA`'s exported
   * `validateRegistry()` directly against synthetic malformed registries,
   * rather than the live registry (which cannot violate this by
   * construction — it already passed validation once at module load just
   * by being required successfully above).
   */
  describe('validateRegistry() enforcement against synthetic registries', () => {

    const validEntry = Object.freeze({
      title: 'Synthetic Tool',
      annotations: { readOnlyHint: true, openWorldHint: false },
      category: 'synthetic',
      keywords: ['synthetic'],
      relatedTools: [],
      whenToUse: 'For testing.',
      whenNotToUse: 'Never in production.',
      examples: [{ description: 'A synthetic example', arguments: {} }]
    });

    test('throws when a manifest tool has no registry entry', () => {
      const syntheticRegistry = {}; // no entry at all
      const syntheticManifestNames = ['phantom_manifest_tool'];

      expect(() => validateRegistry(syntheticRegistry, syntheticManifestNames))
        .toThrow(/no registry entry/);
    });

    test('throws when a registry entry names a tool that does not exist in the manifest', () => {
      // 'some_real_tool' satisfies the manifest-tool-has-an-entry check so
      // that only the orphaned-entry check can fire.
      const syntheticRegistry = { some_real_tool: validEntry, orphaned_tool: validEntry };
      const syntheticManifestNames = ['some_real_tool']; // does not include 'orphaned_tool'

      expect(() => validateRegistry(syntheticRegistry, syntheticManifestNames))
        .toThrow(/does not match any tool/);
    });

    test('throws when a registry entry is missing a required field', () => {
      const { title, ...entryMissingTitle } = validEntry; // eslint-disable-line no-unused-vars
      const syntheticRegistry = { some_real_tool: entryMissingTitle };
      const syntheticManifestNames = ['some_real_tool'];

      expect(() => validateRegistry(syntheticRegistry, syntheticManifestNames))
        .toThrow(/missing or invalid required field "title"/);
    });

    test('throws when a required field has an invalid shape rather than being merely absent', () => {
      const syntheticRegistry = {
        some_real_tool: { ...validEntry, keywords: [] } // present but empty, which is invalid for keywords
      };
      const syntheticManifestNames = ['some_real_tool'];

      expect(() => validateRegistry(syntheticRegistry, syntheticManifestNames))
        .toThrow(/missing or invalid required field "keywords"/);
    });

    test('does not throw for a well-formed synthetic registry matching its manifest', () => {
      const syntheticRegistry = { some_real_tool: validEntry };
      const syntheticManifestNames = ['some_real_tool'];

      expect(() => validateRegistry(syntheticRegistry, syntheticManifestNames)).not.toThrow();
    });

    /**
     * Property variant: for any non-empty subset of required fields
     * removed from an otherwise-valid entry, validation must throw.
     * Exercises the "missing a required field" failure mode broadly
     * rather than only at the two fields spot-checked above.
     */
    test('throws for any single required field removed from an otherwise-valid entry', () => {
      const requiredFields = ['title', 'annotations', 'category', 'keywords', 'relatedTools', 'whenToUse', 'whenNotToUse', 'examples'];

      fc.assert(
        fc.property(
          fc.constantFrom(...requiredFields),
          (fieldToRemove) => {
            const entry = { ...validEntry };
            delete entry[fieldToRemove];
            const syntheticRegistry = { some_real_tool: entry };

            expect(() => validateRegistry(syntheticRegistry, ['some_real_tool'])).toThrow();
          }
        ),
        { numRuns: requiredFields.length }
      );
    });
  });
});
