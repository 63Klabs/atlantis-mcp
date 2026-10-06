'use strict';

/**
 * Unit tests for the index-time ranking signals added by task 17.1
 * (spec 0-0-7-tool-discovery-enhancement, design.md section 8.1/8.2, Requirements 7.1, 7.2).
 *
 * `tests/property/relevance.property.test.js` already covers these signals as GENERAL
 * properties (e.g. "score is always >= SCORE_WEIGHTS.repositoryNameMatch when the
 * repository matches"). This file complements that coverage with CONCRETE, exact-value
 * assertions so a regression that changes an individual weight constant or breaks
 * additivity between signals is caught by a specific expected number rather than only an
 * inequality.
 *
 * Covers:
 *   - `repositoryNameMatch` contributes exactly `SCORE_WEIGHTS.repositoryNameMatch` when a
 *     keyword matches `entry.repository`, and is ADDITIVE with title/excerpt matches (no
 *     double-counting) for the SAME keyword.
 *   - `pathMatch` contributes exactly `SCORE_WEIGHTS.pathMatch` when a keyword matches
 *     `entry.contentPath`, and is additive with every other signal.
 *   - `REPOSITORY_TYPE_WEIGHTS` multiplies the base score via `buildKeywordEntries`:
 *     `package`/`documentation` highest (1.1), `templates`/`app-starter` neutral (1.0),
 *     `mcp`/`management` slightly below neutral (0.95), and an absent/unrecognized
 *     `repositoryType` (`null`/`undefined`/unknown string) takes the SAME neutral weight —
 *     never penalized for an operational omission.
 */

const {
	computeRelevanceScore,
	buildKeywordEntries,
	SCORE_WEIGHTS,
	REPOSITORY_TYPE_WEIGHTS,
	NEUTRAL_REPOSITORY_TYPE_WEIGHT
} = require('../../lib/index-builder');

describe('computeRelevanceScore() — repositoryNameMatch (R7.1, design 8.1)', () => {
	it('contributes exactly SCORE_WEIGHTS.repositoryNameMatch when only the repository matches', () => {
		const entry = {
			title: 'unrelated title',
			excerpt: 'unrelated excerpt',
			keywords: ['unrelated'],
			repository: 'cache-data',
			contentPath: 'org/unrelated-repo/docs/unrelated.md/section'
		};

		expect(computeRelevanceScore('cache-data', entry)).toBe(SCORE_WEIGHTS.repositoryNameMatch);
	});

	it('is additive with a title match for the same keyword (not double-counted)', () => {
		const entry = {
			title: 'cache-data installation guide',
			excerpt: 'unrelated excerpt',
			keywords: ['unrelated'],
			repository: 'cache-data',
			contentPath: 'org/unrelated-repo/docs/unrelated.md/section'
		};

		expect(computeRelevanceScore('cache-data', entry))
			.toBe(SCORE_WEIGHTS.titleMatch + SCORE_WEIGHTS.repositoryNameMatch);
	});

	it('is additive with an excerpt match for the same keyword (not double-counted)', () => {
		const entry = {
			title: 'unrelated title',
			excerpt: 'see the cache-data readme for details',
			keywords: ['unrelated'],
			repository: 'cache-data',
			contentPath: 'org/unrelated-repo/docs/unrelated.md/section'
		};

		expect(computeRelevanceScore('cache-data', entry))
			.toBe(SCORE_WEIGHTS.excerptMatch + SCORE_WEIGHTS.repositoryNameMatch);
	});

	it('does not contribute when the keyword does not match the repository name', () => {
		const entry = {
			title: 'unrelated title',
			excerpt: 'unrelated excerpt',
			keywords: ['unrelated'],
			repository: 'atlantis-mcp',
			contentPath: 'org/unrelated-repo/docs/unrelated.md/section'
		};

		expect(computeRelevanceScore('cache-data', entry)).toBe(0);
	});
});

describe('computeRelevanceScore() — pathMatch (R7.1, design 8.1)', () => {
	it('contributes exactly SCORE_WEIGHTS.pathMatch when only the content path matches', () => {
		const entry = {
			title: 'unrelated title',
			excerpt: 'unrelated excerpt',
			keywords: ['unrelated'],
			repository: 'unrelated-repo',
			contentPath: 'org/unrelated-repo/docs/cache-data/section'
		};

		expect(computeRelevanceScore('cache-data', entry)).toBe(SCORE_WEIGHTS.pathMatch);
	});

	it('is additive with a repository-name match for the same keyword (no double-counting)', () => {
		const entry = {
			title: 'unrelated title',
			excerpt: 'unrelated excerpt',
			keywords: ['unrelated'],
			repository: 'cache-data',
			contentPath: 'org/cache-data/docs/cache-data/section'
		};

		expect(computeRelevanceScore('cache-data', entry))
			.toBe(SCORE_WEIGHTS.repositoryNameMatch + SCORE_WEIGHTS.pathMatch);
	});

	it('all five signals are fully additive when the same keyword matches every field', () => {
		const entry = {
			title: 'cache-data overview',
			excerpt: 'install cache-data via npm',
			keywords: ['cache-data'],
			repository: 'cache-data',
			contentPath: 'org/cache-data/docs/cache-data.md/section'
		};

		const expected =
			SCORE_WEIGHTS.titleMatch +
			SCORE_WEIGHTS.excerptMatch +
			SCORE_WEIGHTS.repositoryNameMatch +
			SCORE_WEIGHTS.keywordMatch +
			SCORE_WEIGHTS.pathMatch;

		expect(computeRelevanceScore('cache-data', entry)).toBe(expected);
	});
});

describe('buildKeywordEntries() — REPOSITORY_TYPE_WEIGHTS multiplier (R7.2, design 8.2)', () => {
	/**
	 * Shared base entry whose keyword contributes a KNOWN base score of 18
	 * (titleMatch 10 + excerptMatch 5 + keywordMatch 3), with `type: 'documentation'`
	 * so the pre-existing `TYPE_WEIGHTS` multiplier is a known 1.0 and does not interact
	 * with the assertions below. Neither `repository` nor `contentPath` is set, so
	 * `repositoryNameMatch`/`pathMatch` never contribute, keeping the base score fixed.
	 *
	 * @param {string|null|undefined} [repositoryType] - Value under test
	 * @returns {Object} A synthetic content entry
	 */
	function makeEntry(repositoryType) {
		return {
			hash: 'abcdef0123456789',
			title: 'widget overview',
			excerpt: 'widget install guide',
			keywords: ['widget'],
			type: 'documentation',
			repositoryType
		};
	}

	const BASE_SCORE = SCORE_WEIGHTS.titleMatch + SCORE_WEIGHTS.excerptMatch + SCORE_WEIGHTS.keywordMatch; // 18

	it('applies the highest weight (1.1) for "package"', () => {
		const [result] = buildKeywordEntries([makeEntry('package')]);
		expect(REPOSITORY_TYPE_WEIGHTS['package']).toBe(1.1);
		expect(result.relevanceScore).toBe(Math.round(BASE_SCORE * 1.1));
	});

	it('applies the highest weight (1.1) for "documentation"', () => {
		const [result] = buildKeywordEntries([makeEntry('documentation')]);
		expect(REPOSITORY_TYPE_WEIGHTS['documentation']).toBe(1.1);
		expect(result.relevanceScore).toBe(Math.round(BASE_SCORE * 1.1));
	});

	it('applies the neutral weight (1.0) for "templates"', () => {
		const [result] = buildKeywordEntries([makeEntry('templates')]);
		expect(REPOSITORY_TYPE_WEIGHTS['templates']).toBe(NEUTRAL_REPOSITORY_TYPE_WEIGHT);
		expect(result.relevanceScore).toBe(BASE_SCORE);
	});

	it('applies the neutral weight (1.0) for "app-starter"', () => {
		const [result] = buildKeywordEntries([makeEntry('app-starter')]);
		expect(REPOSITORY_TYPE_WEIGHTS['app-starter']).toBe(NEUTRAL_REPOSITORY_TYPE_WEIGHT);
		expect(result.relevanceScore).toBe(BASE_SCORE);
	});

	it('applies the slightly-below-neutral weight (0.95) for "mcp"', () => {
		const [result] = buildKeywordEntries([makeEntry('mcp')]);
		expect(REPOSITORY_TYPE_WEIGHTS['mcp']).toBe(0.95);
		expect(result.relevanceScore).toBe(Math.round(BASE_SCORE * 0.95));
		// Sanity check this is a DISTINCT value from the neutral case, so the test would
		// actually fail if the weight regressed to 1.0.
		expect(result.relevanceScore).not.toBe(BASE_SCORE);
	});

	it('applies the slightly-below-neutral weight (0.95) for "management"', () => {
		const [result] = buildKeywordEntries([makeEntry('management')]);
		expect(REPOSITORY_TYPE_WEIGHTS['management']).toBe(0.95);
		expect(result.relevanceScore).toBe(Math.round(BASE_SCORE * 0.95));
	});

	it('applies the neutral weight when repositoryType is undefined (never present)', () => {
		const [result] = buildKeywordEntries([makeEntry(undefined)]);
		expect(result.relevanceScore).toBe(BASE_SCORE);
	});

	it('applies the neutral weight when repositoryType is null (resolution: "absent")', () => {
		const [result] = buildKeywordEntries([makeEntry(null)]);
		expect(result.relevanceScore).toBe(BASE_SCORE);
	});

	it('applies the neutral weight for an unrecognized repositoryType string (defensive)', () => {
		const [result] = buildKeywordEntries([makeEntry('some-future-type')]);
		expect(result.relevanceScore).toBe(BASE_SCORE);
	});

	it('never penalizes an absent repositoryType relative to a known-neutral one', () => {
		const [absent] = buildKeywordEntries([makeEntry(undefined)]);
		const [neutral] = buildKeywordEntries([makeEntry('templates')]);
		expect(absent.relevanceScore).toBe(neutral.relevanceScore);
	});

	it('ranks a package repository strictly above an absent-classification repository at equal text relevance', () => {
		const [packageResult] = buildKeywordEntries([makeEntry('package')]);
		const [absentResult] = buildKeywordEntries([makeEntry(undefined)]);
		expect(packageResult.relevanceScore).toBeGreaterThan(absentResult.relevanceScore);
	});
});
