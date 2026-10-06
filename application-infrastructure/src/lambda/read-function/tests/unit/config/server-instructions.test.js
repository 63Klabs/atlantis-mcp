/**
 * Unit Tests for config/server-instructions.js
 *
 * Tests buildInstructions() and MAX_INSTRUCTION_WORDS:
 * - Word cap is respected for a normal case and a pathologically large corpus
 * - Required substrings (platform name, cache-data forms, precedence directive)
 * - Corpus-sentence degradation at and across the CORPUS_NAME_THRESHOLD boundary
 * - Highlight preference for package/documentation repositoryType entries
 * - Graceful omission of the corpus sentence for an absent or empty corpus
 *
 * Requirements: 1.5, 1.7, 15.2
 */

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

// Mock @63klabs/cache-data (settings.js depends on it transitively)
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

const { buildInstructions, MAX_INSTRUCTION_WORDS } = require('../../../config/server-instructions');
const settings = require('../../../config/settings');

/**
 * Helper: count words the same way the module does (whitespace split).
 * @param {string} text
 * @returns {number}
 */
function wordCount(text) {
	const trimmed = text.trim();
	return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

describe('config/server-instructions', () => {
	describe('word cap (Req 1.7)', () => {
		test('normal case stays at or under MAX_INSTRUCTION_WORDS', () => {
			const instructions = buildInstructions({
				repositories: [
					{ name: 'cache-data', repositoryType: 'package' },
					{ name: 'atlantis-docs', repositoryType: 'documentation' }
				]
			});
			expect(wordCount(instructions)).toBeLessThanOrEqual(MAX_INSTRUCTION_WORDS);
		});

		test('pathologically large repositories array stays at or under MAX_INSTRUCTION_WORDS', () => {
			const repositories = Array.from({ length: 5000 }, (_, i) => ({
				name: `repo-with-a-fairly-long-descriptive-name-${i}`,
				repositoryType: i % 2 === 0 ? 'package' : 'documentation'
			}));
			const instructions = buildInstructions({ repositories });
			expect(wordCount(instructions)).toBeLessThanOrEqual(MAX_INSTRUCTION_WORDS);
		});

		test('MAX_INSTRUCTION_WORDS is exported and set to 250', () => {
			expect(MAX_INSTRUCTION_WORDS).toBe(250);
		});
	});

	describe('required substrings (Req 1.5)', () => {
		let instructions;

		beforeEach(() => {
			instructions = buildInstructions({
				repositories: [{ name: 'cache-data', repositoryType: 'package' }]
			});
		});

		test('names the Atlantis platform', () => {
			expect(instructions).toContain('Atlantis');
		});

		test('names the unscoped cache-data form', () => {
			expect(instructions).toContain('cache-data');
		});

		test('names the scoped @63klabs/cache-data form', () => {
			expect(instructions).toContain('@63klabs/cache-data');
		});

		test('contains the precedence directive language', () => {
			expect(instructions).toContain('Query this server before falling back to web search or training');
		});

		test('names every valid repository type', () => {
			for (const type of settings.github.validRepositoryTypes) {
				expect(instructions).toContain(type);
			}
		});

		test('names every template category', () => {
			for (const category of settings.templates.getCategoryNames()) {
				expect(instructions).toContain(category);
			}
		});
	});

	describe('corpus-sentence degradation (Req 1.5)', () => {
		test('at the threshold (5 repos), names are listed directly', () => {
			const repositories = Array.from({ length: 5 }, (_, i) => ({
				name: `repo-${i}`,
				repositoryType: 'app-starter'
			}));
			const instructions = buildInstructions({ repositories });

			expect(instructions).toContain('The indexed corpus currently includes:');
			for (const repo of repositories) {
				expect(instructions).toContain(repo.name);
			}
			// Should not have degraded to the counted/highlighted form.
			expect(instructions).not.toContain('repositories, including:');
		});

		test('just above the threshold (6 repos), degrades to count + highlights', () => {
			const repositories = Array.from({ length: 6 }, (_, i) => ({
				name: `repo-${i}`,
				repositoryType: 'app-starter'
			}));
			const instructions = buildInstructions({ repositories });

			expect(instructions).toContain('The indexed corpus currently includes 6 repositories, including:');
			// Degraded form should not enumerate every single repo name.
			expect(instructions).not.toContain('repo-5');
		});

		test('degraded form prefers package/documentation types for highlights', () => {
			const repositories = [
				{ name: 'mgmt-repo', repositoryType: 'management' },
				{ name: 'mcp-repo', repositoryType: 'mcp' },
				{ name: 'template-repo', repositoryType: 'templates' },
				{ name: 'starter-repo', repositoryType: 'app-starter' },
				{ name: 'cache-data', repositoryType: 'package' },
				{ name: 'atlantis-docs', repositoryType: 'documentation' }
			];
			const instructions = buildInstructions({ repositories });

			// High-value types should be named by the highlight selection.
			expect(instructions).toContain('cache-data');
			expect(instructions).toContain('atlantis-docs');
			// Low-value types should not appear in this highlight-only sentence,
			// since only two high-value repos exist (fewer than the highlight count).
			expect(instructions).not.toContain('mgmt-repo');
			expect(instructions).not.toContain('mcp-repo');
		});

		test('degraded form falls back to the first few names when no high-value types are present', () => {
			const repositories = Array.from({ length: 7 }, (_, i) => ({
				name: `plain-repo-${i}`,
				repositoryType: 'mcp'
			}));
			const instructions = buildInstructions({ repositories });

			expect(instructions).toContain('The indexed corpus currently includes 7 repositories, including:');
			expect(instructions).toContain('plain-repo-0');
			expect(instructions).toContain('plain-repo-1');
			expect(instructions).toContain('plain-repo-2');
		});
	});

	describe('empty-corpus case (Req 1.5)', () => {
		test('buildInstructions() with no options omits the corpus sentence', () => {
			const instructions = buildInstructions();

			expect(instructions).not.toContain('indexed corpus');
			expect(instructions).toContain('Atlantis');
			expect(instructions).toContain('cache-data');
			expect(instructions).toContain('Query this server before falling back to web search or training');
			// No malformed artifacts from joining an empty sentence.
			expect(instructions).not.toMatch(/\s{2,}/);
			expect(instructions.trim()).toBe(instructions);
		});

		test('buildInstructions({ repositories: [] }) omits the corpus sentence', () => {
			const instructions = buildInstructions({ repositories: [] });

			expect(instructions).not.toContain('indexed corpus');
			expect(instructions).toContain('Atlantis');
			expect(instructions).toContain('cache-data');
			expect(instructions).toContain('Query this server before falling back to web search or training');
			expect(instructions).not.toMatch(/\s{2,}/);
			expect(instructions.trim()).toBe(instructions);
		});
	});
});
