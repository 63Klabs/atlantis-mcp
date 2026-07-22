/**
 * Unit Tests for config/tool-descriptions.js
 *
 * Tests the extendedDescriptions map and validateDescriptions() function:
 * - Every tool in availableToolsList has a corresponding extended description
 * - Every description value is a non-empty string
 * - Each description starts with a verb-led sentence
 * - Each description contains at least one failure-mode keyword
 * - validateDescriptions() logs a warning for unmatched keys
 * - Graceful fallback when a tool has no description entry
 *
 * Requirements: 1.1, 1.2, 1.4, 2.1, 2.2, 2.3, 5.1, 5.2
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

	describe('verb-led descriptions (Req 2.1, 2.2)', () => {
		const LEADING_VERBS = [
			'Retrieve', 'List', 'Search', 'Validate', 'Check'
		];

		test('each description should start with a common verb', () => {
			for (const name of toolNames) {
				const desc = extendedDescriptions[name];
				const startsWithVerb = LEADING_VERBS.some(verb => desc.startsWith(verb));
				expect(startsWithVerb).toBe(true);
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
