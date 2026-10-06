/**
 * Property-Based Tests for Published/Enforced Schema Identity
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 9: Schema identity
 *
 * For every tool, the published schema (the `inputSchema` carried on the
 * `settings.tools.availableToolsList` manifest entry) and the enforced
 * schema (the schema `utils/schema-validator.js` actually validates a
 * `tools/call` against) must describe the exact same validation contract:
 * any input accepted by one is accepted by the other, and any input
 * rejected by one is rejected by the other (requirements.md R3.1).
 *
 * Task 7.1 made this guarantee hold by *reference identity* for the 13
 * literally-declared base tools: `settings.js` now points each manifest
 * entry's `inputSchema` directly at the corresponding
 * `schema-validator.js` `baseSchemas.<toolName>` object, so there is only
 * one schema object in memory per base tool.
 *
 * The 4 registry-generated agent-asset tools (`list_agent_assets`,
 * `get_agent_asset`, `list_agent_asset_types`, `get_agent_asset_chunk`)
 * are a different, pre-existing shape: `config/agent-asset-types.js`
 * exposes `generateToolDefinitions()` and `generateSchemas()`, and both
 * independently call the same internal `buildFixedToolSpecs()` and build
 * a *fresh* `inputSchema` object literal on every invocation. That keeps
 * the two outputs structurally in lockstep (deep equality holds), but the
 * manifest's `inputSchema` and the validator's `schemas[name]` are two
 * distinct object instances in memory for these 4 tools, not one shared
 * object. That is not something task 7.1 was scoped to change, so this
 * test asserts the weaker (but still requirement-satisfying) deep-equality
 * guarantee for just those 4 tools, and documents why reference identity
 * is intentionally not asserted there.
 *
 * Validates: Requirements 3.1, 3.2, 3.4
 */

const fc = require('fast-check');
const settings = require('../../config/settings');
const schemaValidator = require('../../utils/schema-validator');

/**
 * The 13 literally-declared base tools whose manifest `inputSchema` is
 * wired to the *same object* as the validator's `baseSchemas` entry
 * (task 7.1). Reference identity is asserted for these.
 * @constant {string[]}
 */
const BASE_TOOL_NAMES = [
  'list_tools',
  'list_templates',
  'get_template',
  'list_template_versions',
  'list_categories',
  'list_starters',
  'get_starter_info',
  'search_documentation',
  'get_document',
  'get_document_chunk',
  'validate_naming',
  'check_template_updates',
  'get_template_chunk'
];

/**
 * The 4 registry-generated agent-asset tools. Their published and
 * enforced schemas are produced by two independent calls into
 * `AgentAssetTypes.buildFixedToolSpecs()`, so they are deep-equal but not
 * reference-identical. Only deep equality is asserted for these.
 * @constant {string[]}
 */
const AGENT_ASSET_TOOL_NAMES = [
  'list_agent_assets',
  'get_agent_asset',
  'list_agent_asset_types',
  'get_agent_asset_chunk'
];

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 9: Schema identity', () => {

  /**
   * **Validates: Requirements 3.1, 3.2, 3.4**
   *
   * Sanity check that the manifest and the validator agree on which tools
   * exist, before asserting anything about schema equivalence per tool.
   * If this fails, the property below would otherwise vacuously pass or
   * silently skip a tool.
   */
  test('every manifest tool name has a corresponding enforced schema, and vice versa', () => {
    const manifestNames = settings.tools.availableToolsList.map((tool) => tool.name).sort();
    const enforcedNames = schemaValidator.getToolNames().sort();

    expect(manifestNames).toEqual(enforcedNames);
    expect(manifestNames).toEqual(
      expect.arrayContaining([...BASE_TOOL_NAMES, ...AGENT_ASSET_TOOL_NAMES])
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.4**
   *
   * For every tool in the manifest, the published schema and the enforced
   * schema must be deeply equal: any input accepted by one is accepted by
   * the other and vice versa. This is the minimum bar R3.1 sets, and it
   * must hold for every tool regardless of how its schema is produced.
   */
  test('published and enforced schema are deeply equal for every tool', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...settings.tools.availableToolsList.map((tool) => tool.name)),
        (toolName) => {
          const manifestEntry = settings.tools.availableToolsList.find((tool) => tool.name === toolName);
          const publishedSchema = manifestEntry.inputSchema;
          const enforcedSchema = schemaValidator.getSchema(toolName);

          expect(enforcedSchema).not.toBeNull();
          expect(publishedSchema).toEqual(enforcedSchema);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.4**
   *
   * For the 13 literally-declared base tools, task 7.1 established the
   * stronger guarantee of strict object identity: `settings.js` wires the
   * manifest `inputSchema` directly at `schema-validator.js`'s
   * `baseSchemas.<toolName>` object, so there is exactly one schema object
   * per base tool. Deep equality alone would not catch a future regression
   * where someone reintroduces a separately-maintained copy that happens
   * to currently match; `toBe` catches that immediately.
   */
  test('published and enforced schema are the same object for every base tool', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BASE_TOOL_NAMES),
        (toolName) => {
          const manifestEntry = settings.tools.availableToolsList.find((tool) => tool.name === toolName);
          const publishedSchema = manifestEntry.inputSchema;
          const enforcedSchema = schemaValidator.getSchema(toolName);
          const baseSchema = schemaValidator.baseSchemas[toolName];

          expect(publishedSchema).toBe(enforcedSchema);
          expect(publishedSchema).toBe(baseSchema);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.4**
   *
   * For the 4 registry-generated agent-asset tools, object identity is NOT
   * asserted: `AgentAssetTypes.generateToolDefinitions()` (feeding the
   * manifest) and `AgentAssetTypes.generateSchemas()` (feeding the
   * validator) each independently call `buildFixedToolSpecs()`, which
   * builds a new `inputSchema` object literal every time it runs. This is
   * pre-existing behavior outside task 7.1's scope, not a regression.
   * Deep equality is asserted instead, which is sufficient to satisfy the
   * R3.1 equivalence contract (same accept/reject behavior) even without
   * a shared reference.
   */
  test('published and enforced schema are deep-equal but not reference-identical for agent-asset tools', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...AGENT_ASSET_TOOL_NAMES),
        (toolName) => {
          const manifestEntry = settings.tools.availableToolsList.find((tool) => tool.name === toolName);
          const publishedSchema = manifestEntry.inputSchema;
          const enforcedSchema = schemaValidator.getSchema(toolName);

          // Equivalent validation contract (R3.1) ...
          expect(publishedSchema).toEqual(enforcedSchema);
          // ... achieved via two independently-generated objects, not one
          // shared reference. Documenting the current shape rather than
          // asserting `.not.toBe` as a requirement: if a future change
          // makes these reference-identical too, that is a strict
          // improvement and this assertion would need to flip, not fail.
        }
      ),
      { numRuns: 50 }
    );
  });
});
