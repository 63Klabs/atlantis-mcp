'use strict';

/**
 * Unit tests for the per-repository-type exclusion policy matrix added to
 * `isIndexable(filePath, repositoryType)` by spec 0-0-7 task 16.1 (design 10.2,
 * Requirements 9.3, 9.4, 9.5).
 *
 * Each classification is asserted against the full candidate file set so the exact
 * exclusion set per type is pinned down, not just a sample of it:
 *   - `package`            -> global exclusions minus CHANGELOG.md
 *   - documentation/templates/app-starter/mcp/management -> full global exclusions
 *   - `absent`             -> no filename-based exclusions
 *   - omitted/unrecognized repositoryType -> falls back to the global default (same as
 *     the known non-package types), never to the `absent` no-exclusions policy
 *   - AGENTS.md             -> excluded for every classification, including `absent`
 * Directory and extension/template-YAML rules are asserted to be unaffected by
 * `repositoryType`.
 */

const { isIndexable } = require('../../lib/file-filter');

const GLOBALLY_EXCLUDED_FILES = ['LICENSE.md', 'CONTRIBUTING.md', 'CONTRIBUTE.md', 'CHANGELOG.md', 'SECURITY.md'];
const GLOBAL_POLICY_REPOSITORY_TYPES = ['documentation', 'templates', 'app-starter', 'mcp', 'management'];

describe('isIndexable repository-type exclusion policy matrix', () => {
	describe('package classification', () => {
		it('keeps CHANGELOG.md indexable', () => {
			expect(isIndexable('CHANGELOG.md', 'package')).toBe(true);
		});

		it.each(['LICENSE.md', 'CONTRIBUTING.md', 'CONTRIBUTE.md', 'SECURITY.md'])(
			'excludes %s',
			(fileName) => {
				expect(isIndexable(fileName, 'package')).toBe(false);
			}
		);

		it('excludes AGENTS.md', () => {
			expect(isIndexable('AGENTS.md', 'package')).toBe(false);
		});
	});

	describe.each(GLOBAL_POLICY_REPOSITORY_TYPES)('%s classification', (repositoryType) => {
		it.each(GLOBALLY_EXCLUDED_FILES)('excludes %s', (fileName) => {
			expect(isIndexable(fileName, repositoryType)).toBe(false);
		});

		it('excludes AGENTS.md', () => {
			expect(isIndexable('AGENTS.md', repositoryType)).toBe(false);
		});
	});

	describe('absent classification', () => {
		it.each(GLOBALLY_EXCLUDED_FILES)('does not exclude %s', (fileName) => {
			expect(isIndexable(fileName, 'absent')).toBe(true);
		});

		it('still excludes AGENTS.md unconditionally', () => {
			expect(isIndexable('AGENTS.md', 'absent')).toBe(false);
		});
	});

	describe('omitted or unrecognized repositoryType falls back to the global default', () => {
		it.each(GLOBALLY_EXCLUDED_FILES)('excludes %s when repositoryType is omitted', (fileName) => {
			expect(isIndexable(fileName)).toBe(false);
		});

		it.each(GLOBALLY_EXCLUDED_FILES)('excludes %s for an unrecognized repositoryType value', (fileName) => {
			expect(isIndexable(fileName, 'totally-unknown-type')).toBe(false);
		});

		it('excludes AGENTS.md when repositoryType is omitted', () => {
			expect(isIndexable('AGENTS.md')).toBe(false);
		});

		it('excludes AGENTS.md for an unrecognized repositoryType value', () => {
			expect(isIndexable('AGENTS.md', 'totally-unknown-type')).toBe(false);
		});

		it('does not fall back to the absent (no-exclusions) policy for null/undefined', () => {
			expect(isIndexable('LICENSE.md', null)).toBe(false);
			expect(isIndexable('LICENSE.md', undefined)).toBe(false);
		});
	});

	describe('directory, extension, and template-YAML rules are unaffected by repositoryType', () => {
		const classifications = [undefined, 'package', 'documentation', 'absent', 'totally-unknown-type'];

		it.each(classifications)('excludes a file inside an excluded directory (repositoryType=%s)', (repositoryType) => {
			expect(isIndexable('.git/config.md', repositoryType)).toBe(false);
		});

		it.each(classifications)('excludes a non-indexable extension (repositoryType=%s)', (repositoryType) => {
			expect(isIndexable('README.txt', repositoryType)).toBe(false);
		});

		it.each(classifications)('excludes a non-template YAML file (repositoryType=%s)', (repositoryType) => {
			expect(isIndexable('config.yml', repositoryType)).toBe(false);
		});

		it.each(classifications)('keeps a template YAML file indexable (repositoryType=%s)', (repositoryType) => {
			expect(isIndexable('template.yml', repositoryType)).toBe(true);
		});

		it.each(classifications)('keeps an ordinary source file indexable (repositoryType=%s)', (repositoryType) => {
			expect(isIndexable('src/index.js', repositoryType)).toBe(true);
		});
	});
});
