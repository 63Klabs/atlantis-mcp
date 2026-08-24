// Feature: documentation-indexer, Property 3: Markdown extraction produces valid entries
'use strict';

const fc = require('fast-check');
const { extract } = require('../../lib/extractors/markdown');

/**
 * Arbitrary that generates a valid Markdown heading level (1–6).
 */
const headingLevelArb = fc.integer({ min: 1, max: 6 });

/**
 * Arbitrary that generates heading text containing at least one alphanumeric character
 * so that slugification produces a non-empty slug.
 */
const headingTextArb = fc.tuple(
	fc.string({
		unit: fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
			'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
			'0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ' ', '-'),
		minLength: 1, maxLength: 40
	})
).map(([text]) => {
	// Ensure at least one alphanumeric character for a valid slug
	const hasAlphaNum = /[a-zA-Z0-9]/.test(text);
	return hasAlphaNum ? text.trim() || 'heading' : text.trim() + 'x';
});

/**
 * Arbitrary that generates body text for a section (may be empty).
 */
const bodyTextArb = fc.string({
	unit: fc.constantFrom(
		'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
		'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
		'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
		'0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
		' ', '.', ',', '!', '?', '-', '(', ')', ':', ';', '\n'
	),
	minLength: 0, maxLength: 300
});

/**
 * Arbitrary that generates a single Markdown section (heading + body).
 */
const sectionArb = fc.tuple(headingLevelArb, headingTextArb, bodyTextArb)
	.map(([level, heading, body]) => {
		const hashes = '#'.repeat(level);
		return `${hashes} ${heading}\n${body}`;
	});

/**
 * Arbitrary that generates a Markdown string with 1–5 sections.
 */
const markdownArb = fc.array(sectionArb, { minLength: 1, maxLength: 5 })
	.map((sections) => sections.join('\n'));

/**
 * Arbitrary that generates a context object with org and repo.
 */
const contextArb = fc.record({
	org: fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-'), minLength: 1, maxLength: 15 }),
	repo: fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'd', 'e', '1', '2', '3', '-'), minLength: 1, maxLength: 15 })
});

/**
 * Arbitrary that generates a file path.
 */
const filePathArb = fc.constantFrom('README.md', 'docs/guide.md', 'docs/api/reference.md', 'SETUP.md');

describe('Property 3: Markdown extraction produces valid entries', () => {

	// **Validates: Requirements 7.2**
	it('produces one entry per heading with a valid slug', () => {
		fc.assert(
			fc.property(markdownArb, contextArb, filePathArb, (markdown, context, filePath) => {
				const entries = extract(markdown, filePath, context);

				// Count headings that would produce non-empty slugs
				const headingPattern = /^(#{1,6})\s+(.+)$/gm;
				let match;
				const headings = [];
				while ((match = headingPattern.exec(markdown)) !== null) {
					const headingText = match[2].trim();
					// Slugify: lowercase, remove non-alphanumeric (except spaces/hyphens), collapse
					const slug = headingText
						.toLowerCase()
						.replace(/[^a-z0-9\s-]/g, '')
						.replace(/\s+/g, '-')
						.replace(/-+/g, '-')
						.replace(/^-|-$/g, '');
					if (slug) {
						headings.push({ text: headingText, slug });
					}
				}

				expect(entries.length).toBe(headings.length);
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 7.3**
	it('each entry has a content path matching {org}/{repo}/{filepath}/{heading}', () => {
		fc.assert(
			fc.property(markdownArb, contextArb, filePathArb, (markdown, context, filePath) => {
				const entries = extract(markdown, filePath, context);
				const prefix = `${context.org}/${context.repo}/${filePath}/`;

				for (const entry of entries) {
					expect(entry.contentPath.startsWith(prefix)).toBe(true);
					// The slug portion after the prefix should be non-empty
					const slug = entry.contentPath.slice(prefix.length);
					expect(slug.length).toBeGreaterThan(0);
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirement 3 (boundary-aware excerpts)**
	// Boundary-aware excerpts may extend a sentence up to the hard cap (240) but never
	// beyond it (spec 0-0-6, task 1.2), so 240 is the invariant rather than the old 200.
	it('excerpt is at most the hard cap (240 characters)', () => {
		fc.assert(
			fc.property(markdownArb, contextArb, filePathArb, (markdown, context, filePath) => {
				const entries = extract(markdown, filePath, context);

				for (const entry of entries) {
					expect(entry.excerpt.length).toBeLessThanOrEqual(240);
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirement 3 (boundary-aware excerpts)**
	// The excerpt is no longer a raw prefix of the body: it prefers the first prose
	// paragraph and normalizes whitespace. The preserved invariants are that it is
	// whitespace-trimmed and appears as a contiguous, whitespace-normalized substring of
	// the body (so no synthetic text is introduced).
	it('excerpt is a whitespace-normalized substring of the content and is trimmed', () => {
		const collapse = (s) => s.replace(/\s+/g, ' ').trim();
		fc.assert(
			fc.property(markdownArb, contextArb, filePathArb, (markdown, context, filePath) => {
				const entries = extract(markdown, filePath, context);

				for (const entry of entries) {
					expect(entry.excerpt).toBe(entry.excerpt.trim());
					expect(collapse(entry.content).includes(entry.excerpt)).toBe(true);
				}
			}),
			{ numRuns: 100 }
		);
	});

	// **Validates: Requirements 7.4**
	it('keywords array is non-empty for each entry', () => {
		fc.assert(
			fc.property(markdownArb, contextArb, filePathArb, (markdown, context, filePath) => {
				const entries = extract(markdown, filePath, context);

				for (const entry of entries) {
					expect(entry.keywords.length).toBeGreaterThan(0);
				}
			}),
			{ numRuns: 100 }
		);
	});
});
