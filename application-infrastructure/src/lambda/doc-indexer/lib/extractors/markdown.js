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
 * Maximum (soft) excerpt length in characters. Excerpts are trimmed at a sentence or
 * word boundary at or near this length.
 * @type {number}
 */
const MAX_EXCERPT_LENGTH = 200;

/**
 * Hard cap for an excerpt in characters. A sentence boundary may extend the excerpt past
 * {@link MAX_EXCERPT_LENGTH} up to this cap so a sentence is not cut short, but never
 * beyond it (prevents a runaway sentence from producing an oversized excerpt).
 * @type {number}
 */
const EXCERPT_HARD_CAP = 240;

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
 * Scan a section body for the first descriptive prose paragraph, skipping leading
 * non-prose markup: fenced code blocks, markdown table rows and dividers, heading lines,
 * and blank lines. Consecutive prose lines are joined into a single paragraph.
 *
 * @param {string} body - Section body text (may begin with tables, code fences, etc.)
 * @returns {string} The first prose paragraph, or an empty string when none is found
 * @example
 * extractFirstProseParagraph('| A | B |\n|---|---|\n\nThis explains the table.');
 * // "This explains the table."
 */
function extractFirstProseParagraph(body) {
	const lines = body.split('\n');
	let inFence = false;
	const paragraph = [];

	for (const line of lines) {
		const trimmed = line.trim();

		// Toggle fenced code block state on ``` or ~~~ fences (skip the fence and its body).
		if (/^(```|~~~)/.test(trimmed)) {
			inFence = !inFence;
			if (paragraph.length > 0) {
				break;
			}
			continue;
		}
		if (inFence) {
			continue;
		}

		const isBlank = trimmed.length === 0;
		const isHeading = /^#{1,6}\s+/.test(trimmed);
		const isTableRow = /^\|/.test(trimmed);
		const isTableDivider = /^\|?\s*:?-{2,}/.test(trimmed);

		if (isBlank || isHeading || isTableRow || isTableDivider) {
			// A blank line (or new block) after prose ends the first paragraph.
			if (paragraph.length > 0) {
				break;
			}
			continue;
		}

		// Descriptive prose line: accumulate into the current paragraph.
		paragraph.push(trimmed);
	}

	return paragraph.join(' ').trim();
}

/**
 * Trim text to a coherent excerpt: collapse whitespace, then cut at a sentence boundary
 * near the soft limit (extending up to the hard cap so a sentence is not cut short), or
 * failing that at the last word boundary at or before the soft limit. Never ends
 * mid-word.
 *
 * @param {string} text - Source text to trim
 * @param {number} [maxLen=MAX_EXCERPT_LENGTH] - Soft length limit
 * @param {number} [hardCap=EXCERPT_HARD_CAP] - Absolute maximum length
 * @returns {string} Boundary-trimmed excerpt (no trailing partial word)
 * @example
 * trimToBoundary('First sentence. Second sentence that runs long...', 20);
 * // "First sentence."
 */
function trimToBoundary(text, maxLen = MAX_EXCERPT_LENGTH, hardCap = EXCERPT_HARD_CAP) {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean.length <= maxLen) {
		return clean;
	}

	// Collect sentence-boundary positions (index just past the terminal punctuation).
	const sentenceEnds = [];
	const sentenceRe = /[.!?]+(?=\s|$)/g;
	let match;
	while ((match = sentenceRe.exec(clean)) !== null) {
		sentenceEnds.push(match.index + match[0].length);
	}

	// Prefer the smallest sentence boundary in [maxLen, hardCap] (a complete sentence just
	// past the soft limit); otherwise the largest sentence boundary in [minLen, maxLen].
	const minLen = Math.floor(maxLen / 2);
	let boundary = -1;
	for (const pos of sentenceEnds) {
		if (pos >= maxLen && pos <= hardCap) {
			boundary = pos;
			break;
		}
	}
	if (boundary === -1) {
		for (const pos of sentenceEnds) {
			if (pos <= maxLen && pos >= minLen) {
				boundary = pos;
			}
			if (pos > maxLen) {
				break;
			}
		}
	}
	if (boundary > 0) {
		return clean.slice(0, boundary).trim();
	}

	// No suitable sentence boundary: cut at the last word boundary at or before maxLen.
	const slice = clean.slice(0, maxLen);
	const lastSpace = slice.lastIndexOf(' ');
	if (lastSpace > 0) {
		return slice.slice(0, lastSpace).trim();
	}

	// A single word longer than maxLen: an exact cut is unavoidable.
	return slice.trim();
}

/**
 * Build a coherent excerpt for a section body. Prefers the first descriptive prose
 * paragraph (skipping leading tables, code fences, headings, and blanks) and trims it at
 * a sentence or word boundary so the excerpt never ends mid-word or mid-table.
 *
 * @param {string} body - Section body text
 * @returns {string} Boundary-aware excerpt (empty string for empty/non-string input)
 * @example
 * buildExcerpt('| Setting | Value |\n|---|---|\n\nConfigures the cache TTL in seconds.');
 * // "Configures the cache TTL in seconds."
 */
function buildExcerpt(body) {
	if (!body || typeof body !== 'string') {
		return '';
	}
	const prose = extractFirstProseParagraph(body);
	const source = prose.length > 0 ? prose : body;
	return trimToBoundary(source, MAX_EXCERPT_LENGTH, EXCERPT_HARD_CAP);
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
		const excerpt = buildExcerpt(section.body);

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

module.exports = {
	extract,
	slugifyHeading,
	extractKeywords,
	parseSections,
	buildExcerpt,
	extractFirstProseParagraph,
	trimToBoundary
};
