'use strict';

const { extract, slugifyHeading, extractKeywords, parseSections } = require('../../../lib/extractors/markdown');

describe('Markdown Extractor', () => {

	const context = { org: '63klabs', repo: 'cache-data' };

	describe('slugifyHeading', () => {
		it('converts heading to lowercase hyphenated slug', () => {
			expect(slugifyHeading('Getting Started')).toBe('getting-started');
		});

		it('removes special characters', () => {
			expect(slugifyHeading('API Reference (v2)')).toBe('api-reference-v2');
		});

		it('collapses multiple hyphens', () => {
			expect(slugifyHeading('foo  --  bar')).toBe('foo-bar');
		});

		it('trims leading and trailing hyphens', () => {
			expect(slugifyHeading('  Hello World  ')).toBe('hello-world');
		});

		it('returns empty string for non-alphanumeric heading', () => {
			expect(slugifyHeading('!!!')).toBe('');
		});
	});

	describe('extractKeywords', () => {
		it('extracts meaningful words and removes stop words', () => {
			const keywords = extractKeywords('Install the cache-data package');
			expect(keywords).toContain('install');
			expect(keywords).toContain('cache-data');
			expect(keywords).toContain('package');
			expect(keywords).not.toContain('the');
		});

		it('deduplicates keywords', () => {
			const keywords = extractKeywords('install install install');
			expect(keywords).toEqual(['install']);
		});

		it('returns empty array for stop-words-only text', () => {
			const keywords = extractKeywords('the a an');
			expect(keywords).toHaveLength(0);
		});
	});

	describe('parseSections', () => {
		it('parses H1 through H6 headings', () => {
			const md = '# H1\nbody1\n## H2\nbody2\n### H3\nbody3\n#### H4\nbody4\n##### H5\nbody5\n###### H6\nbody6';
			const sections = parseSections(md);
			expect(sections).toHaveLength(6);
			expect(sections[0]).toEqual({ heading: 'H1', level: 1, body: 'body1' });
			expect(sections[5]).toEqual({ heading: 'H6', level: 6, body: 'body6' });
		});

		it('returns empty array for content with no headings', () => {
			expect(parseSections('Just some text\nwith no headings')).toEqual([]);
		});

		it('handles empty string', () => {
			expect(parseSections('')).toEqual([]);
		});

		it('captures multi-line body content', () => {
			const md = '# Title\nLine 1\nLine 2\nLine 3';
			const sections = parseSections(md);
			expect(sections[0].body).toBe('Line 1\nLine 2\nLine 3');
		});

		it('ignores text before the first heading', () => {
			const md = 'Preamble text\n# First Heading\nBody';
			const sections = parseSections(md);
			expect(sections).toHaveLength(1);
			expect(sections[0].heading).toBe('First Heading');
		});
	});

	describe('extract', () => {
		it('produces one entry per heading', () => {
			const md = '# Installation\nRun npm install\n## Usage\nImport the module';
			const entries = extract(md, 'README.md', context);
			expect(entries).toHaveLength(2);
		});

		it('generates correct content path', () => {
			const md = '# Installation\nSome content';
			const entries = extract(md, 'README.md', context);
			expect(entries[0].contentPath).toBe('63klabs/cache-data/README.md/installation');
		});

		it('sets type to documentation and subType to guide', () => {
			const md = '# Title\nContent';
			const entries = extract(md, 'README.md', context);
			expect(entries[0].type).toBe('documentation');
			expect(entries[0].subType).toBe('guide');
		});

		it('stores excerpt as first 200 characters of body', () => {
			const longBody = 'x'.repeat(300);
			const md = `# Title\n${longBody}`;
			const entries = extract(md, 'README.md', context);
			expect(entries[0].excerpt).toHaveLength(200);
			expect(entries[0].excerpt).toBe(longBody.substring(0, 200));
		});

		it('excerpt equals full body when body is shorter than 200 chars', () => {
			const md = '# Title\nShort body';
			const entries = extract(md, 'README.md', context);
			expect(entries[0].excerpt).toBe('Short body');
			expect(entries[0].excerpt).toBe(entries[0].content);
		});

		it('extracts non-empty keywords', () => {
			const md = '# Installation Guide\nRun npm install to set up the package';
			const entries = extract(md, 'README.md', context);
			expect(entries[0].keywords.length).toBeGreaterThan(0);
			expect(entries[0].keywords).toContain('installation');
			expect(entries[0].keywords).toContain('guide');
		});

		it('returns empty array for empty content', () => {
			expect(extract('', 'README.md', context)).toEqual([]);
		});

		it('returns empty array for null content', () => {
			expect(extract(null, 'README.md', context)).toEqual([]);
		});

		it('returns empty array for non-string content', () => {
			expect(extract(42, 'README.md', context)).toEqual([]);
		});

		it('returns empty array for content with no headings', () => {
			expect(extract('Just plain text', 'README.md', context)).toEqual([]);
		});

		it('handles nested file paths', () => {
			const md = '# Config\nDetails';
			const entries = extract(md, 'docs/guides/setup.md', context);
			expect(entries[0].contentPath).toBe('63klabs/cache-data/docs/guides/setup.md/config');
		});

		it('skips headings that produce empty slugs', () => {
			const md = '# !!!\nContent\n# Valid\nMore content';
			const entries = extract(md, 'README.md', context);
			expect(entries).toHaveLength(1);
			expect(entries[0].title).toBe('Valid');
		});

		it('preserves original heading text as title', () => {
			const md = '# Getting Started (Quick)\nContent';
			const entries = extract(md, 'README.md', context);
			expect(entries[0].title).toBe('Getting Started (Quick)');
		});
	});
});
