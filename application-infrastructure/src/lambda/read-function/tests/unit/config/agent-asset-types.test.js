'use strict';

/**
 * Unit tests for config/agent-asset-types.js — the AGENT_ASSET_TYPES registry
 * and its generated artifacts (lookup helpers, tool definitions, schemas).
 *
 * This module has no dependency on @63klabs/cache-data, settings.js, or the
 * router (it is pure registry data plus generator functions), so these
 * tests require it directly with no mocking.
 *
 * Coverage:
 * - Shipped registry shape: every entry declares the five required
 *   non-empty fields (extensions as a non-empty array of non-empty
 *   strings), no two entries share name/toolToken/folder, and the four
 *   shipped entries (steering, hooks, agents-md, skills) match their
 *   documented shape (Requirement 5.1).
 * - `skills` ships disabled: excluded from getEnabledTypeNames() and from
 *   resolveEnabledType(), while still resolvable via getTypeByName(), and
 *   the fixed tools (list_agent_assets, get_agent_asset,
 *   list_agent_asset_types) still exist regardless — disabling a type
 *   never removes a tool, only removes it from the assetType enum
 *   (Requirement 5.5).
 * - Adding a synthetic enabled entry to the registry extends the
 *   assetType enum by exactly one accepted value and creates no new tool
 *   (Requirement 5.4).
 *
 * Requirements: 5.1, 5.4, 5.5
 */

const MODULE_PATH = '../../../config/agent-asset-types';

const {
	AGENT_ASSET_TYPES,
	validateRegistry,
	getEnabledTypeNames,
	getTypeByName,
	resolveEnabledType,
	generateToolDefinitions,
	generateSchemas
} = require(MODULE_PATH);

// The five fields every entry must declare with a non-empty value;
// `extensions` is checked separately since it must be a non-empty array of
// non-empty strings rather than a non-empty string.
const REQUIRED_STRING_FIELDS = ['name', 'toolToken', 'folder', 'description'];

// Fields that must be unique across all registry entries.
const UNIQUE_FIELDS = ['name', 'toolToken', 'folder'];

// The fixed tool set that always exists regardless of registry contents.
// As of task 10.3, this includes `get_agent_asset_chunk` (Requirement 9).
const FIXED_TOOL_NAMES = ['list_agent_assets', 'get_agent_asset', 'list_agent_asset_types', 'get_agent_asset_chunk'];

afterEach(() => {
	jest.restoreAllMocks();
});

describe('config/agent-asset-types - shipped registry shape (Requirement 5.1)', () => {
	test('every entry declares the five required non-empty fields', () => {
		for (const entry of AGENT_ASSET_TYPES) {
			for (const field of REQUIRED_STRING_FIELDS) {
				expect(typeof entry[field]).toBe('string');
				expect(entry[field].trim().length).toBeGreaterThan(0);
			}

			expect(Array.isArray(entry.extensions)).toBe(true);
			expect(entry.extensions.length).toBeGreaterThan(0);
			for (const extension of entry.extensions) {
				expect(typeof extension).toBe('string');
				expect(extension.trim().length).toBeGreaterThan(0);
			}
		}
	});

	test('no two entries share the same name, toolToken, or folder', () => {
		for (const field of UNIQUE_FIELDS) {
			const values = AGENT_ASSET_TYPES.map((entry) => entry[field]);
			expect(new Set(values).size).toBe(values.length);
		}
	});

	test('ships exactly the four documented entries, in order', () => {
		expect(AGENT_ASSET_TYPES.map((entry) => entry.name)).toEqual([
			'steering',
			'hooks',
			'agents-md',
			'skills'
		]);
	});

	test('steering entry: folder "steering", extensions [".md"], enabled', () => {
		const steering = getTypeByName('steering');
		expect(steering).not.toBeNull();
		expect(steering.folder).toBe('steering');
		expect(steering.extensions).toEqual(['.md']);
		expect(steering.enabled).not.toBe(false);
	});

	test('hooks entry: folder "hooks", extensions [".kiro.hook", ".json"], enabled', () => {
		const hooks = getTypeByName('hooks');
		expect(hooks).not.toBeNull();
		expect(hooks.folder).toBe('hooks');
		expect(hooks.extensions).toEqual(['.kiro.hook', '.json']);
		expect(hooks.enabled).not.toBe(false);
	});

	test('agents-md entry: folder "agents_md", extensions [".md"], enabled', () => {
		const agentsMd = getTypeByName('agents-md');
		expect(agentsMd).not.toBeNull();
		expect(agentsMd.folder).toBe('agents_md');
		expect(agentsMd.extensions).toEqual(['.md']);
		expect(agentsMd.enabled).not.toBe(false);
	});

	test('skills entry: folder "skills", extensions [".md"], disabled by default', () => {
		const skills = getTypeByName('skills');
		expect(skills).not.toBeNull();
		expect(skills.folder).toBe('skills');
		expect(skills.extensions).toEqual(['.md']);
		expect(skills.enabled).toBe(false);
	});
});

describe('config/agent-asset-types - skills disabled (Requirement 5.5)', () => {
	test('getEnabledTypeNames() excludes "skills"', () => {
		const enabledNames = getEnabledTypeNames();
		expect(enabledNames).not.toContain('skills');
		expect(enabledNames).toEqual(['steering', 'hooks', 'agents-md']);
	});

	test('resolveEnabledType("skills") returns null', () => {
		expect(resolveEnabledType('skills')).toBeNull();
	});

	test('getTypeByName("skills") still returns the entry (disabled, not absent)', () => {
		const skills = getTypeByName('skills');
		expect(skills).not.toBeNull();
		expect(skills.name).toBe('skills');
		expect(skills.enabled).toBe(false);
	});

	test('fixed tools exist in generateToolDefinitions() regardless of "skills" being disabled', () => {
		const toolNames = generateToolDefinitions().map((tool) => tool.name);
		for (const fixedName of FIXED_TOOL_NAMES) {
			expect(toolNames).toContain(fixedName);
		}
		expect([...toolNames].sort()).toEqual([...FIXED_TOOL_NAMES].sort());
	});

	test('"skills" is absent from the assetType enum on both generic tool schemas', () => {
		const schemas = generateSchemas();
		expect(schemas.get_agent_asset.properties.assetType.enum).not.toContain('skills');
		expect(schemas.list_agent_assets.properties.assetType.enum).not.toContain('skills');
	});
});

describe('config/agent-asset-types - synthetic enabled entry (Requirement 5.4)', () => {
	// A minimal, valid, uniquely-named entry used to prove the one-entry
	// contract without depending on real S3 folders or descriptions.
	const syntheticEntry = {
		name: 'synthetic-type',
		toolToken: 'synthetic_type',
		folder: 'synthetic',
		extensions: ['.txt'],
		description: 'A synthetic test type'
	};

	test('validateRegistry() accepts a synthetic registry with the entry appended', () => {
		const syntheticRegistry = [...AGENT_ASSET_TYPES, syntheticEntry];
		expect(() => validateRegistry(syntheticRegistry)).not.toThrow();
	});

	test('adding the entry extends the assetType enum by exactly one value and creates no new tool', () => {
		// `generateToolDefinitions`/`generateSchemas`/`getEnabledTypeNames` read
		// the module-level `AGENT_ASSET_TYPES` constant directly (they take no
		// registry parameter), so to observe the effect of "adding an entry" we
		// load an independent copy of the module via jest.isolateModules() and
		// mutate ITS array in place. This proves the live contract - the
		// generators recompute from the current array on every call - without
		// ever touching the AGENT_ASSET_TYPES reference imported at the top of
		// this file, so no mutation bleeds into the other tests in this suite.
		let isolatedMod;
		jest.isolateModules(() => {
			isolatedMod = require(MODULE_PATH);
		});

		// Sanity check: the isolated copy starts out identical to the shipped
		// registry (3 enabled types, "skills" excluded, 4 fixed tools).
		const namesBefore = isolatedMod.getEnabledTypeNames();
		const toolNamesBefore = isolatedMod.generateToolDefinitions().map((tool) => tool.name);
		expect(namesBefore).toEqual(['steering', 'hooks', 'agents-md']);
		expect([...toolNamesBefore].sort()).toEqual([...FIXED_TOOL_NAMES].sort());

		// Add the synthetic entry as the only source change.
		isolatedMod.AGENT_ASSET_TYPES.push(syntheticEntry);

		const namesAfter = isolatedMod.getEnabledTypeNames();
		const toolNamesAfter = isolatedMod.generateToolDefinitions().map((tool) => tool.name);

		// Exactly one accepted assetType value was added.
		expect(namesAfter.length).toBe(namesBefore.length + 1);
		expect(namesAfter).toEqual([...namesBefore, 'synthetic-type']);

		// No new tool was created; the fixed tool set is unchanged.
		expect(toolNamesAfter.length).toBe(toolNamesBefore.length);
		expect([...toolNamesAfter].sort()).toEqual([...FIXED_TOOL_NAMES].sort());

		// The new value is reflected in both generic tools' assetType enum.
		const schemasAfter = isolatedMod.generateSchemas();
		expect(schemasAfter.get_agent_asset.properties.assetType.enum).toContain('synthetic-type');
		expect(schemasAfter.list_agent_assets.properties.assetType.enum).toContain('synthetic-type');

		// The mutated registry (module-level AGENT_ASSET_TYPES, taken as the
		// default parameter) is still valid.
		expect(() => isolatedMod.validateRegistry()).not.toThrow();

		// Confirm the original, top-level-imported registry used by the rest
		// of this suite was never touched by the isolated mutation.
		expect(AGENT_ASSET_TYPES.map((entry) => entry.name)).toEqual([
			'steering',
			'hooks',
			'agents-md',
			'skills'
		]);
	});
});
