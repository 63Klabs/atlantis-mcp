/**
 * Unit Tests for config/tool-descriptions.js
 *
 * Tests the extendedDescriptions map and validateDescriptions() function:
 * - Every tool in availableToolsList has a corresponding extended description
 * - Every description value is a non-empty string
 * - Each description opens with a "Call this..." trigger sentence
 * - A representative set of descriptions names its domain-specific concrete
 *   identifiers (Requirement 4.2)
 * - Each description contains at least one failure-mode keyword
 * - validateDescriptions() logs a warning for an extended-description key with
 *   no matching manifest tool
 * - validateDescriptions() logs a warning for a manifest tool with no extended
 *   description entry (Requirement 4.4)
 * - Graceful fallback when a tool has no description entry
 *
 * Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 4.1, 4.2, 4.4, 4.6, 5.1, 5.2
 */

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			log: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			info: jest.fn(),
			debug: jest.fn()
		},
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn().mockResolvedValue('mock-value')
		}))
	}
}));

const { extendedDescriptions, validateDescriptions } = require('../../../config/tool-descriptions');
const settings = require('../../../config/settings');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

describe('config/tool-descriptions', () => {
	const toolNames = settings.tools.availableToolsList.map(t => t.name);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('extendedDescriptions coverage (Req 1.1, 5.1)', () => {
		test('should export an entry for every tool in availableToolsList', () => {
			for (const name of toolNames) {
				expect(extendedDescriptions).toHaveProperty(name);
			}
		});
	});

	describe('description values (Req 1.4)', () => {
		test('every value should be a non-empty string', () => {
			for (const name of toolNames) {
				const desc = extendedDescriptions[name];
				expect(typeof desc).toBe('string');
				expect(desc.trim().length).toBeGreaterThan(0);
			}
		});
	});

	describe('trigger-sentence descriptions (Req 4.1, 4.2)', () => {
		// Scoped to the hand-authored entries in config/tool-descriptions.js.
		// The agent-asset tool descriptions (list_agent_assets, get_agent_asset,
		// list_agent_asset_types, get_agent_asset_chunk) are generated from the
		// AGENT_ASSET_TYPES registry (config/agent-asset-types.js) and are out of
		// scope for this rewrite (task 8.1).
		const HAND_AUTHORED_TOOL_NAMES = [
			'list_tools', 'list_templates', 'get_template', 'list_template_versions',
			'list_categories', 'list_starters', 'get_starter_info', 'search_documentation',
			'get_document', 'get_document_chunk', 'validate_naming', 'check_template_updates',
			'get_template_chunk'
		];

		test('each hand-authored description should open with a "Call this" trigger sentence stating when to use the tool', () => {
			for (const name of HAND_AUTHORED_TOOL_NAMES) {
				const desc = extendedDescriptions[name];
				expect(desc.startsWith('Call this')).toBe(true);
			}
		});
	});

	describe('concrete-identifier spot-check (Req 4.2)', () => {
		// Spot-check a representative set of hand-authored descriptions rather
		// than requiring every tool to name every identifier category.
		const EXPECTED_IDENTIFIERS = {
			search_documentation: ['cache-data'],
			get_template: ['templateName', 'category'],
			validate_naming: ['Prefix-ProjectId-StageId'],
			check_template_updates: ['templateName', 'category', 'currentVersion']
		};

		test('each spot-checked description names its domain-specific identifiers', () => {
			for (const [name, identifiers] of Object.entries(EXPECTED_IDENTIFIERS)) {
				const desc = extendedDescriptions[name];
				for (const identifier of identifiers) {
					expect(desc).toContain(identifier);
				}
			}
		});
	});

	describe('failure-mode keywords (Req 2.3)', () => {
		const FAILURE_KEYWORDS = [
			'error', 'empty', 'fail', 'not found',
			'missing', 'invalid', 'not match', 'not conform'
		];

		test('each description should contain at least one failure-mode keyword', () => {
			for (const name of toolNames) {
				const desc = extendedDescriptions[name].toLowerCase();
				const hasKeyword = FAILURE_KEYWORDS.some(kw => desc.includes(kw));
				expect(hasKeyword).toBe(true);
			}
		});
	});

	describe('validateDescriptions warning (Req 5.2)', () => {
		test('should log a warning when an unmatched key is present', () => {
			// Save original state
			const originalValue = extendedDescriptions['nonexistent_tool'];

			// Add a fake key
			extendedDescriptions['nonexistent_tool'] = 'Fake description for testing.';

			jest.clearAllMocks();
			validateDescriptions();

			expect(DebugAndLog.warn).toHaveBeenCalledWith(
				expect.stringContaining('nonexistent_tool')
			);

			// Clean up
			delete extendedDescriptions['nonexistent_tool'];
		});
	});

	describe('validateDescriptions missing-description warning (Req 4.4)', () => {
		test('should log a warning when a manifest tool has no extended description entry', () => {
			// Pick a real manifest tool and temporarily remove its extended description
			const toolName = toolNames[0];
			const savedValue = extendedDescriptions[toolName];
			delete extendedDescriptions[toolName];

			jest.clearAllMocks();
			validateDescriptions();

			expect(DebugAndLog.warn).toHaveBeenCalledWith(
				expect.stringContaining(toolName)
			);

			// Clean up
			extendedDescriptions[toolName] = savedValue;
		});

		test('should not warn about missing descriptions when every manifest tool has one', () => {
			jest.clearAllMocks();
			validateDescriptions();

			const missingDescriptionWarnings = DebugAndLog.warn.mock.calls.filter(
				([message]) => message.includes('has no extended description')
			);
			expect(missingDescriptionWarnings).toHaveLength(0);
		});
	});

	describe('graceful fallback (Req 1.2)', () => {
		test('accessing a missing description key should return undefined without error', () => {
			// Pick the first tool and temporarily remove its entry
			const removedToolName = toolNames[0];
			const savedValue = extendedDescriptions[removedToolName];

			delete extendedDescriptions[removedToolName];

			// Accessing the removed key should return undefined, not throw
			expect(() => {
				const result = extendedDescriptions[removedToolName];
				expect(result).toBeUndefined();
			}).not.toThrow();

			// Restore
			extendedDescriptions[removedToolName] = savedValue;
		});
	});
});
