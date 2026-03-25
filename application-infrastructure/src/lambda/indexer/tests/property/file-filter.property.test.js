// Feature: documentation-indexer, Property 2: File filtering correctness
'use strict';

const fc = require('fast-check');
const path = require('path');
const { isIndexable, EXCLUDED_FILES } = require('../../lib/file-filter');

/**
 * Arbitrary that generates a random directory prefix (may be empty).
 */
const dirPrefixArb = fc.oneof(
	fc.constant(''),
	fc.stringOf(fc.constantFrom('s', 'r', 'c', 'l', 'i', 'b', '/'), { minLength: 1, maxLength: 20 })
		.map((s) => s.replace(/\/+/g, '/').replace(/^\/|\/$/g, ''))
		.map((s) => (s ? s + '/' : ''))
);

/**
 * Arbitrary that generates a valid base filename (no extension).
 */
const baseNameArb = fc.stringOf(
	fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', '-', '_'),
	{ minLength: 1, maxLength: 20 }
);

describe('Property 2: File filtering correctness', () => {

	it('Markdown files not in excluded list are indexable', () => {
		fc.assert(
			fc.property(dirPrefixArb, baseNameArb, (dir, base) => {
				const fileName = base + '.md';
				fc.pre(!EXCLUDED_FILES.has(fileName));
				const filePath = dir + fileName;
				expect(isIndexable(filePath)).toBe(true);
			}),
			{ numRuns: 100 }
		);
	});

	it('JavaScript and JSX files are always indexable', () => {
		fc.assert(
			fc.property(
				dirPrefixArb,
				baseNameArb,
				fc.constantFrom('.js', '.jsx'),
				(dir, base, ext) => {
					expect(isIndexable(dir + base + ext)).toBe(true);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('Python files are always indexable', () => {
		fc.assert(
			fc.property(dirPrefixArb, baseNameArb, (dir, base) => {
				expect(isIndexable(dir + base + '.py')).toBe(true);
			}),
			{ numRuns: 100 }
		);
	});

	it('YAML files matching template* pattern are indexable', () => {
		fc.assert(
			fc.property(
				dirPrefixArb,
				baseNameArb,
				fc.constantFrom('.yml', '.yaml'),
				(dir, suffix, ext) => {
					const filePath = dir + 'template' + suffix + ext;
					expect(isIndexable(filePath)).toBe(true);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('YAML files NOT matching template* pattern are not indexable', () => {
		fc.assert(
			fc.property(
				dirPrefixArb,
				baseNameArb.filter((b) => !b.toLowerCase().startsWith('template')),
				fc.constantFrom('.yml', '.yaml'),
				(dir, base, ext) => {
					expect(isIndexable(dir + base + ext)).toBe(false);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('excluded Markdown files are never indexable regardless of directory', () => {
		const excludedArray = Array.from(EXCLUDED_FILES);
		fc.assert(
			fc.property(
				dirPrefixArb,
				fc.constantFrom(...excludedArray),
				(dir, fileName) => {
					expect(isIndexable(dir + fileName)).toBe(false);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('files with non-indexable extensions are never indexable', () => {
		fc.assert(
			fc.property(
				dirPrefixArb,
				baseNameArb,
				fc.constantFrom('.txt', '.json', '.html', '.css', '.xml', '.csv', '.log', '.cfg', '.toml', '.ini'),
				(dir, base, ext) => {
					expect(isIndexable(dir + base + ext)).toBe(false);
				}
			),
			{ numRuns: 100 }
		);
	});
});
