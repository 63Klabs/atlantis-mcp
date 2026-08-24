'use strict';

/**
 * Unit tests for the boundary-aware excerpt builder (spec 0-0-6, task 1.2).
 *
 * Covers Requirement 3: prose preference over leading tables/code/headings, sentence and
 * word boundary trimming (never mid-word/mid-table), and the hard-cap behavior that
 * prevents a runaway sentence from producing an oversized excerpt.
 */

const {
	extract,
	buildExcerpt,
	extractFirstProseParagraph,
	trimToBoundary
} = require('../../../lib/extractors/markdown');

const SOFT_LIMIT = 200;
const HARD_CAP = 240;

describe('extractFirstProseParagraph', () => {
	it('skips a leading markdown table and its divider, returning the first prose paragraph', () => {
		const body = '| Attribute | Setting |\n|-----------|---------|\n| ttl | 300 |\n\nThis section explains the cache configuration.';
		expect(extractFirstProseParagraph(body)).toBe('This section explains the cache configuration.');
	});

	it('skips a leading fenced code block', () => {
		const body = '```js\nconst x = 1;\nconsole.log(x);\n```\n\nThe helper initializes the cache on cold start.';
		expect(extractFirstProseParagraph(body)).toBe('The helper initializes the cache on cold start.');
	});

	it('skips leading heading and blank lines', () => {
		const body = '### Overview\n\nProse describing the overview follows here.';
		expect(extractFirstProseParagraph(body)).toBe('Prose describing the overview follows here.');
	});

	it('joins consecutive prose lines into one paragraph and stops at a blank line', () => {
		const body = 'First prose line.\nSecond prose line.\n\nA later paragraph that is ignored.';
		expect(extractFirstProseParagraph(body)).toBe('First prose line. Second prose line.');
	});

	it('returns an empty string when there is no prose (only a table)', () => {
		const body = '| A | B |\n|---|---|\n| 1 | 2 |';
		expect(extractFirstProseParagraph(body)).toBe('');
	});
});

describe('trimToBoundary', () => {
	it('returns the text unchanged when within the soft limit', () => {
		expect(trimToBoundary('Short text.', 200, 240)).toBe('Short text.');
	});

	it('prefers a sentence boundary at or before the soft limit over a mid-word cut', () => {
		// maxLen=20, hardCap=24: the second sentence ends past the hard cap, so trim to the
		// first sentence rather than word-cutting at 20.
		expect(trimToBoundary('First sentence. Second sentence.', 20, 24)).toBe('First sentence.');
	});

	it('never ends mid-word when no suitable sentence boundary exists', () => {
		const text = 'word '.repeat(60).trim() + ' end.';
		const result = trimToBoundary(text, 20, 24);
		expect(result.length).toBeLessThanOrEqual(20);
		// Ends on a complete word (not a partial token) and has no trailing whitespace.
		expect(result.endsWith('word')).toBe(true);
		expect(result).toBe(result.trim());
	});

	it('does not extend past the hard cap to reach a distant sentence boundary', () => {
		// The only sentence boundary is far beyond the hard cap; must word-cut within maxLen.
		const text = 'alpha '.repeat(80).trim() + '.';
		const result = trimToBoundary(text, 20, 24);
		expect(result.length).toBeLessThanOrEqual(24);
	});
});

describe('buildExcerpt', () => {
	it('returns an empty string for empty or non-string input', () => {
		expect(buildExcerpt('')).toBe('');
		expect(buildExcerpt(null)).toBe('');
		expect(buildExcerpt(42)).toBe('');
	});

	it('prefers the first prose paragraph over a leading table', () => {
		const body = '| Setting | Value |\n|---------|-------|\n| ttl | 300 |\n\nConfigures the cache TTL in seconds.';
		expect(buildExcerpt(body)).toBe('Configures the cache TTL in seconds.');
	});

	it('trims a long prose paragraph at a boundary without ending mid-word', () => {
		const body = 'token '.repeat(100).trim();
		const excerpt = buildExcerpt(body);
		expect(excerpt.length).toBeLessThanOrEqual(SOFT_LIMIT);
		expect(excerpt.endsWith('token')).toBe(true);
		expect(excerpt).toBe(excerpt.trim());
	});

	it('never exceeds the hard cap', () => {
		const body = 'alpha '.repeat(200).trim() + '.';
		const excerpt = buildExcerpt(body);
		expect(excerpt.length).toBeLessThanOrEqual(HARD_CAP);
	});

	it('falls back to the raw body when no prose paragraph is detectable', () => {
		// A single long unbroken token (no spaces, not a table/heading/fence) is treated as
		// prose and trimmed to the soft limit.
		const body = 'x'.repeat(300);
		const excerpt = buildExcerpt(body);
		expect(excerpt).toBe('x'.repeat(SOFT_LIMIT));
	});
});

describe('extract integration (excerpt is boundary-aware)', () => {
	const context = { org: '63klabs', repo: 'cache-data' };

	it('uses the prose paragraph after a table as the section excerpt', () => {
		const md = '# Config\n| Setting | Value |\n|---------|-------|\n| ttl | 300 |\n\nControls how long entries live.';
		const entries = extract(md, 'README.md', context);
		expect(entries[0].excerpt).toBe('Controls how long entries live.');
	});
});
