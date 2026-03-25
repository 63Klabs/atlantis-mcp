'use strict';

/**
 * Heading pattern matching Markdown headings H1–H6.
 * Captures the heading level (number of # chars) and the heading text.
 * @type {RegExp}
 */
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;

/**
 * Common stop words excluded from keyword extraction.
 * @type {Set<string>}
 */
const STOP_WORDS = new Set([
	'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
	'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'are',
	'this', 'that', 'not', 'can', 'will', 'do', 'if', 'you', 'your',
	'we', 'our', 'has', 'have', 'had', 'been', 'would', 'could', 'should',
	'may', 'might', 'shall', 'its', 'also', 'into', 'than', 'then',
	'each', 'which', 'their', 'them', 'these', 'those', 'such', 'when',
	'how', 'what', 'where', 'who', 'all', 'any', 'both', 'no', 'so',
	'up', 'out', 'about', 'just', 'more', 'some', 'other', 'over'
]);

/**
 * Maximum excerpt length in characters.
 * @type {number}
 */
const MAX_EXCERPT_LENGTH = 200;

/**
 * Minimum keyword length to include.
 * @type {number}
 */
const MIN_KEYWORD_LENGTH = 2;

/**
 * Normalize a heading string into a URL-friendly slug for use in content paths.
 *
 * @param {string} heading - Raw heading text (e.g., "Getting Started")
 * @returns {string} Lowercase, hyphen-separated slug (e.g., "getting-started")
 * @example
 * slugifyHeading('Getting Started');  // "getting-started"
 * slugifyHeading('API Reference (v2)'); // "api-reference-v2"
 */
function slugifyHeading(heading) {
	return heading
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

/**
 * Extract keywords from a text string by tokenizing, lowercasing,
 * removing stop words, and deduplicating.
 *
 * @param {string} text - Source text to extract keywords from
 * @returns {Array<string>} Array of unique, lowercase keyword strings
 * @example
 * extractKeywords('Install the cache-data package');
 * // ["install", "cache-data", "package"]
 */
function extractKeywords(text) {
	const words = text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter(word => word.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(word));

	return [...new Set(words)];
}

/**
 * Parse a Markdown string into sections based on headings (H1–H6).
 * Each heading starts a new section; the content between headings
 * belongs to the preceding heading's section.
 *
 * @param {string} content - Raw Markdown file content
 * @returns {Array<{heading: string, level: number, body: string}>} Parsed sections
 * @example
 * const sections = parseSections('# Title\nSome text\n## Sub\nMore text');
 * // [
 * //   { heading: 'Title', level: 1, body: 'Some text' },
 * //   { heading: 'Sub', level: 2, body: 'More text' }
 * // ]
 */
function parseSections(content) {
	const lines = content.split('\n');
	const sections = [];
	let currentHeading = null;
	let currentLevel = 0;
	let bodyLines = [];

	for (const line of lines) {
		const match = line.match(HEADING_PATTERN);

		if (match) {
			if (currentHeading !== null) {
				sections.push({
					heading: currentHeading,
					level: currentLevel,
					body: bodyLines.join('\n').trim()
				});
			}

			currentHeading = match[2].trim();
			currentLevel = match[1].length;
			bodyLines = [];
		} else if (currentHeading !== null) {
			bodyLines.push(line);
		}
	}

	if (currentHeading !== null) {
		sections.push({
			heading: currentHeading,
			level: currentLevel,
			body: bodyLines.join('\n').trim()
		});
	}

	return sections;
}

/**
 * Extract indexed entries from a Markdown file. Each heading (H1–H6)
 * produces one entry with a content path, title, excerpt, full content,
 * type metadata, and extracted keywords.
 *
 * Content type is "documentation" with subType "guide".
 *
 * @param {string} content - Raw Markdown file content
 * @param {string} filePath - File path within the repository (e.g., "README.md")
 * @param {{org: string, repo: string}} context - Repository context
 * @returns {Array<{contentPath: string, title: string, excerpt: string, content: string, type: string, subType: string, keywords: Array<string>}>} Extracted entries
 * @example
 * const entries = extract('# Install\nRun npm install', 'README.md', { org: '63klabs', repo: 'cache-data' });
 * // [{
 * //   contentPath: '63klabs/cache-data/README.md/install',
 * //   title: 'Install',
 * //   excerpt: 'Run npm install',
 * //   content: 'Run npm install',
 * //   type: 'documentation',
 * //   subType: 'guide',
 * //   keywords: ['install', 'run', 'npm']
 * // }]
 */
function extract(content, filePath, context) {
	if (!content || typeof content !== 'string') {
		return [];
	}

	const sections = parseSections(content);
	const entries = [];

	for (const section of sections) {
		const slug = slugifyHeading(section.heading);

		if (!slug) {
			continue;
		}

		const contentPath = `${context.org}/${context.repo}/${filePath}/${slug}`;
		const excerpt = section.body.substring(0, MAX_EXCERPT_LENGTH);

		const headingKeywords = extractKeywords(section.heading);
		const bodyKeywords = extractKeywords(section.body);
		const keywords = [...new Set([...headingKeywords, ...bodyKeywords])];

		if (keywords.length === 0) {
			keywords.push(slug.replace(/-/g, ' ').trim() || section.heading.toLowerCase());
		}

		entries.push({
			contentPath,
			title: section.heading,
			excerpt,
			content: section.body,
			type: 'documentation',
			subType: 'guide',
			keywords
		});
	}

	return entries;
}

module.exports = { extract, slugifyHeading, extractKeywords, parseSections };
