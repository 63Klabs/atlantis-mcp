'use strict';

/**
 * Property-based tests for config/agent-asset-types.js tool/schema generation.
 *
 * Feature: agent-asset-tools, Property 12: Registry-driven fixed tools and assetType enum
 *
 * For any registry, tool generation produces the fixed tool set -
 * `list_agent_assets`, `get_agent_asset`, `list_agent_asset_types`, and
 * `get_agent_asset_chunk` (delivering the deferrable large-asset slice of
 * Requirement 9 as of task 10.3) - each with an input schema, a
 * non-empty description, and a JSON-RPC dispatch entry, independent of the
 * registry contents; and the generated `assetType` enumeration on
 * `list_agent_assets` and `get_agent_asset` equals exactly the set of
 * enabled type names, excluding every disabled or absent entry. Adding or
 * enabling a single entry adds exactly one accepted `assetType` value to
 * that enumeration, creates no new tool, and alters no other tool
 * definition.
 *
 * Validates: Requirements 5.2, 5.4, 5.5, 6.1, 6.5
 *
 * ## Approach (documented per task instructions)
 *
 * `generateToolDefinitions()`, `generateSchemas()`,
 * `generateExtendedDescriptions()`, `getToolDispatch(controller)`, and
 * `getEnabledTypeNames()` all take NO registry parameter - they read the
 * module-level `AGENT_ASSET_TYPES` constant fresh on every call (confirmed
 * by reading config/agent-asset-types.js: `getEnabledTypes()` calls
 * `AGENT_ASSET_TYPES.filter(...)` at call time, and `buildFixedToolSpecs()`
 * / `buildAssetTypeSchema()` call `getEnabledTypeNames()` at call time;
 * nothing is memoized beyond the one-time `validateRegistry()` check at
 * module load). To exercise these generators against MANY registry
 * variations - not just the one shipped registry - instead of a single
 * hand-written example, each fast-check run in this file:
 *
 *   1. Loads a FRESH, independent copy of the module via
 *      `jest.isolateModules()`. This is used purely for TEST ISOLATION
 *      between the 100+ fast-check runs (and from the rest of this Jest
 *      suite) so mutations from one run/file can never bleed into another;
 *      it is not required for the mutation itself to "work".
 *   2. Mutates that fresh copy's exported `AGENT_ASSET_TYPES` array in
 *      place (`.push(...)`) with fast-check-generated synthetic entries.
 *   3. Calls the fresh copy's generator functions and asserts the result
 *      against an independently-computed expectation.
 *
 * This was verified empirically before writing the full test - both via a
 * standalone `node -e` throwaway check (pushing a synthetic entry onto the
 * required module's exported `AGENT_ASSET_TYPES` array and confirming
 * `getEnabledTypeNames()`/`generateSchemas()` immediately reflected it) and
 * by the fact that the existing `tests/unit/config/agent-asset-types.test.js`
 * unit test for Requirement 5.4 already relies on, and passes with, this
 * exact `jest.isolateModules()` + `.push()` pattern. Because
 * `AGENT_ASSET_TYPES` is a `const` ARRAY REFERENCE, `.push()`ing onto the
 * reference returned by `require()` mutates the very array object the
 * module's internal closures read on every call - arrays are mutable, only
 * reassigning the binding would break the closure link, and this module
 * never reassigns it. This is option 1 from the task brief and is preferred
 * because it directly tests the literal "adding one entry" language of
 * Requirement 5.4 / Property 12 across many generated registries, rather
 * than only probing `resolveEnabledType` against the one shipped registry.
 */

const fc = require('fast-check');

const MODULE_PATH = '../../../config/agent-asset-types';

/** The fixed tool set that must always exist, regardless of registry contents. */
const FIXED_TOOL_NAMES = ['list_agent_assets', 'get_agent_asset', 'list_agent_asset_types', 'get_agent_asset_chunk'];

/** The two generic tools whose schemas carry the `assetType` enum. */
const GENERIC_TOOL_NAMES = ['list_agent_assets', 'get_agent_asset'];

/**
 * Load a fresh, independent copy of config/agent-asset-types.js so that
 * mutating its exported `AGENT_ASSET_TYPES` array cannot bleed into any
 * other fast-check run, or into the module `require`d elsewhere in this
 * suite.
 *
 * @returns {Object} A fresh module instance
 */
function loadIsolatedModule() {
	let isolatedMod;
	jest.isolateModules(() => {
		isolatedMod = require(MODULE_PATH);
	});
	return isolatedMod;
}

/**
 * Lowercase-letter/digit alphabet used to build collision-free synthetic
 * suffixes, mirroring the charset style already used elsewhere in this
 * suite (see tests/property/schema-validator-path-traversal.property.test.js).
 */
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');

/** Arbitrary for a short, lowercase alphanumeric suffix. */
const suffixArb = fc.stringOf(fc.constantFrom(...SUFFIX_ALPHABET), { minLength: 3, maxLength: 12 });

/**
 * Build a fully-valid, uniquely-named synthetic AgentAssetType entry from a
 * suffix and an optional `enabled` flag. Every generated field is prefixed
 * with "synthetic" so it can never collide with the shipped `name`,
 * `toolToken`, or `folder` values (steering/hooks/agents-md/skills and
 * their tokens/folders).
 *
 * @param {string} suffix - Collision-free suffix
 * @param {boolean|undefined} enabled - `enabled` field to set; omitted (undefined) means "not set", which defaults to enabled
 * @returns {Object} A valid AgentAssetType registry entry
 */
function buildSyntheticEntry(suffix, enabled) {
	const entry = {
		name: `synthetic-${suffix}`,
		toolToken: `synthetic_${suffix}`,
		folder: `synthetic_${suffix}`,
		extensions: ['.md'],
		description: `Synthetic test type ${suffix}`
	};
	if (enabled !== undefined) {
		entry.enabled = enabled;
	}
	return entry;
}

/**
 * Arbitrary for an array of 0-5 synthetic entries with unique `name` values
 * (and therefore unique `toolToken`/`folder`, since all three are derived
 * from the same collision-free suffix per entry). Deduplicates by `name`
 * while preserving generation order, so the resulting registry order stays
 * deterministic and every entry remains individually valid.
 */
const extraEntriesArb = fc
	.array(fc.tuple(suffixArb, fc.option(fc.boolean(), { nil: undefined })), { minLength: 0, maxLength: 5 })
	.map((tuples) => {
		const seenNames = new Set();
		const entries = [];
		for (const [suffix, enabled] of tuples) {
			const entry = buildSyntheticEntry(suffix, enabled);
			if (seenNames.has(entry.name)) {
				continue;
			}
			seenNames.add(entry.name);
			entries.push(entry);
		}
		return entries;
	});

describe('Feature: agent-asset-tools, Property 12: Registry-driven fixed tools and assetType enum', () => {
	/**
	 * **Validates: Requirements 5.2, 5.4, 5.5, 6.1, 6.5**
	 *
	 * For any registry - the shipped entries plus any number of additional
	 * valid synthetic entries, each independently enabled, disabled, or
	 * defaulted - generation always yields exactly the fixed tool set, each
	 * tool has a non-empty description and an input-schema object, every
	 * fixed tool name has a corresponding schema and extended description,
	 * the dispatch map routes each fixed tool name to the right controller
	 * method, and the `assetType` enum on both generic tools equals exactly
	 * the current `getEnabledTypeNames()` output - no more, no less.
	 */
	test('generation always yields the fixed tool set and an assetType enum matching exactly the enabled names', () => {
		fc.assert(
			fc.property(extraEntriesArb, (extraEntries) => {
				const isolatedMod = loadIsolatedModule();

				const baseEnabledNames = isolatedMod.getEnabledTypeNames();

				for (const entry of extraEntries) {
					isolatedMod.AGENT_ASSET_TYPES.push(entry);
				}

				const expectedEnabledNames = [
					...baseEnabledNames,
					...extraEntries.filter((entry) => entry.enabled !== false).map((entry) => entry.name)
				];

				// --- getEnabledTypeNames() reflects the mutated registry exactly ---
				expect(isolatedMod.getEnabledTypeNames()).toEqual(expectedEnabledNames);

				// --- generateToolDefinitions(): exactly the fixed tool set, each well-formed ---
				const toolDefs = isolatedMod.generateToolDefinitions();
				expect(toolDefs).toHaveLength(FIXED_TOOL_NAMES.length);
				const toolDefNames = toolDefs.map((tool) => tool.name);
				expect([...toolDefNames].sort()).toEqual([...FIXED_TOOL_NAMES].sort());
				for (const tool of toolDefs) {
					expect(typeof tool.description).toBe('string');
					expect(tool.description.trim().length).toBeGreaterThan(0);
					expect(tool.inputSchema).toBeTruthy();
					expect(typeof tool.inputSchema).toBe('object');
				}

				// --- generateSchemas(): a well-formed schema for each fixed tool, no more ---
				const schemas = isolatedMod.generateSchemas();
				expect([...Object.keys(schemas)].sort()).toEqual([...FIXED_TOOL_NAMES].sort());
				for (const toolName of FIXED_TOOL_NAMES) {
					const schema = schemas[toolName];
					expect(schema.type).toBe('object');
					expect(schema.properties).toBeTruthy();
					expect(typeof schema.properties).toBe('object');
				}

				// --- generateExtendedDescriptions(): non-empty per fixed tool, no more ---
				const extended = isolatedMod.generateExtendedDescriptions();
				expect([...Object.keys(extended)].sort()).toEqual([...FIXED_TOOL_NAMES].sort());
				for (const toolName of FIXED_TOOL_NAMES) {
					expect(typeof extended[toolName]).toBe('string');
					expect(extended[toolName].trim().length).toBeGreaterThan(0);
				}

				// --- getToolDispatch(controller): each fixed tool name -> the right method, no more ---
				const mockController = {
					list: () => 'list',
					get: () => 'get',
					listTypes: () => 'listTypes',
					getChunk: () => 'getChunk'
				};
				const dispatch = isolatedMod.getToolDispatch(mockController);
				expect([...Object.keys(dispatch)].sort()).toEqual([...FIXED_TOOL_NAMES].sort());
				expect(dispatch.list_agent_assets).toBe(mockController.list);
				expect(dispatch.get_agent_asset).toBe(mockController.get);
				expect(dispatch.list_agent_asset_types).toBe(mockController.listTypes);
				expect(dispatch.get_agent_asset_chunk).toBe(mockController.getChunk);

				// --- assetType enum: exactly the enabled names, on both generic tools ---
				for (const toolName of GENERIC_TOOL_NAMES) {
					expect(schemas[toolName].properties.assetType.enum).toEqual(expectedEnabledNames);
				}
			}),
			{ numRuns: 100 }
		);
	});

	/**
	 * **Validates: Requirements 5.2, 5.4, 5.5, 6.1, 6.5**
	 *
	 * Adding a single, freshly-enabled registry entry as the only source
	 * change adds exactly one accepted `assetType` value to the enum on both
	 * generic tools, creates no new tool (the tool count stays at the fixed
	 * tool set size), and leaves every other tool definition - including the
	 * unrelated `list_agent_asset_types` tool and the non-`assetType` parts
	 * of the two generic tools' schemas - unaltered.
	 */
	test('enabling one additional entry adds exactly one accepted assetType value and creates no new tool', () => {
		fc.assert(
			fc.property(suffixArb, fc.constantFrom(true, undefined), (suffix, enabledFlag) => {
				const isolatedMod = loadIsolatedModule();

				const namesBefore = isolatedMod.getEnabledTypeNames();
				const toolDefsBefore = isolatedMod.generateToolDefinitions();
				const schemasBefore = isolatedMod.generateSchemas();
				const listTypesDefBefore = toolDefsBefore.find((tool) => tool.name === 'list_agent_asset_types');

				const newEntry = buildSyntheticEntry(suffix, enabledFlag);
				isolatedMod.AGENT_ASSET_TYPES.push(newEntry);

				const namesAfter = isolatedMod.getEnabledTypeNames();
				const toolDefsAfter = isolatedMod.generateToolDefinitions();
				const schemasAfter = isolatedMod.generateSchemas();
				const listTypesDefAfter = toolDefsAfter.find((tool) => tool.name === 'list_agent_asset_types');

				// Exactly one accepted assetType value was added, additively (not a replacement).
				expect(namesAfter).toHaveLength(namesBefore.length + 1);
				expect(namesAfter).toEqual([...namesBefore, newEntry.name]);

				// No new tool was created; the fixed tool set is unchanged.
				expect(toolDefsAfter).toHaveLength(toolDefsBefore.length);
				expect([...toolDefsAfter.map((tool) => tool.name)].sort()).toEqual(
					[...toolDefsBefore.map((tool) => tool.name)].sort()
				);

				// The unrelated list_agent_asset_types tool definition is byte-for-byte unchanged.
				expect(listTypesDefAfter).toEqual(listTypesDefBefore);

				// Every non-assetType part of the two generic tools' schemas is unchanged;
				// only assetType.enum grows by exactly the new name.
				for (const toolName of GENERIC_TOOL_NAMES) {
					const before = schemasBefore[toolName];
					const after = schemasAfter[toolName];

					expect(after.type).toBe(before.type);
					expect(after.required).toEqual(before.required);
					expect(after.additionalProperties).toBe(before.additionalProperties);
					expect(Object.keys(after.properties).sort()).toEqual(Object.keys(before.properties).sort());

					for (const propName of Object.keys(before.properties)) {
						if (propName === 'assetType') {
							continue;
						}
						expect(after.properties[propName]).toEqual(before.properties[propName]);
					}

					expect(after.properties.assetType.type).toBe(before.properties.assetType.type);
					expect(after.properties.assetType.description).toBe(before.properties.assetType.description);
					expect(after.properties.assetType.enum).toHaveLength(before.properties.assetType.enum.length + 1);
					expect(after.properties.assetType.enum).toEqual([...before.properties.assetType.enum, newEntry.name]);
				}
			}),
			{ numRuns: 100 }
		);
	});
});
