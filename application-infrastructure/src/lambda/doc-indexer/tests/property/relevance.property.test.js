// Feature: documentation-indexer, Properties 12, 13: Relevance scoring and sort order
'use strict';

const fc = require('fast-check');
const {
	computeRelevanceScore,
	buildKeywordEntries,
	TYPE_WEIGHTS,
	SCORE_WEIGHTS,
	REPOSITORY_TYPE_WEIGHTS,
	NEUTRAL_REPOSITORY_TYPE_WEIGHT
} = require('../../lib/index-builder');

/**
 * Arbitrary for a keyword string.
 */
const keywordArb = fc.string({
	unit: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'),
	minLength: 2, maxLength: 12
});

/**
 * Arbitrary for a content entry with title, excerpt, keywords, and type.
 */
const entryArb = fc.record({
	hash: fc.string({ unit: fc.constantFrom(...'0123456789abcdef'.split('')), minLength: 16, maxLength: 16 }),
	contentPath: fc.string({ minLength: 5, maxLength: 50 }),
	title: fc.string({ minLength: 1, maxLength: 40 }),
	excerpt: fc.string({ minLength: 0, maxLength: 200 }),
	content: fc.string({ minLength: 0, maxLength: 200 }),
	type: fc.constantFrom('documentation', 'code-example', 'template-pattern'),
	subType: fc.constantFrom('guide', 'function', 'parameter'),
	keywords: fc.array(keywordArb, { minLength: 1, maxLength: 5 }),
	repository: fc.string({ minLength: 1, maxLength: 15 }),
	owner: fc.string({ minLength: 1, maxLength: 15 })
});

describe('Property 12: Relevance scoring follows defined weights', () => {

	it('title match contributes +10 to base score', () => {
		fc.assert(
			fc.property(keywordArb, (keyword) => {
				const entry = {
					title: `prefix ${keyword} suffix`,
					excerpt: 'unrelated text',
					keywords: ['unrelated']
				};

				const score = computeRelevanceScore(keyword, entry);
				expect(score).toBeGreaterThanOrEqual(SCORE_WEIGHTS.titleMatch);
			}),
			{ numRuns: 100 }
		);
	});

	it('excerpt match contributes +5 to base score', () => {
		fc.assert(
			fc.property(keywordArb, (keyword) => {
				const entry = {
					title: 'unrelated title',
					excerpt: `some text with ${keyword} inside`,
					keywords: ['unrelated']
				};

				const score = computeRelevanceScore(keyword, entry);
				expect(score).toBeGreaterThanOrEqual(SCORE_WEIGHTS.excerptMatch);
			}),
			{ numRuns: 100 }
		);
	});

	it('keyword match contributes +3 to base score', () => {
		fc.assert(
			fc.property(keywordArb, (keyword) => {
				const entry = {
					title: 'unrelated title',
					excerpt: 'unrelated excerpt',
					keywords: [keyword]
				};

				const score = computeRelevanceScore(keyword, entry);
				expect(score).toBeGreaterThanOrEqual(SCORE_WEIGHTS.keywordMatch);
			}),
			{ numRuns: 100 }
		);
	});

	it('score is zero when keyword does not match title, excerpt, or keywords', () => {
		fc.assert(
			fc.property(keywordArb, (keyword) => {
				const entry = {
					title: 'zzzzz',
					excerpt: 'zzzzz',
					keywords: ['zzzzz']
				};

				// Ensure keyword doesn't accidentally match
				fc.pre(!entry.title.includes(keyword) && !entry.excerpt.includes(keyword));

				const score = computeRelevanceScore(keyword, entry);
				expect(score).toBe(0);
			}),
			{ numRuns: 100 }
		);
	});

	it('type weight is applied correctly: documentation=1.0, template-pattern=0.9, code-example=0.8', () => {
		expect(TYPE_WEIGHTS['documentation']).toBe(1.0);
		expect(TYPE_WEIGHTS['template-pattern']).toBe(0.9);
		expect(TYPE_WEIGHTS['code-example']).toBe(0.8);
	});

	it('buildKeywordEntries applies type weight to relevance score', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('documentation', 'code-example', 'template-pattern'),
				keywordArb,
				(type, keyword) => {
					const entry = {
						hash: 'abcdef0123456789',
						title: `title with ${keyword}`,
						excerpt: 'some excerpt',
						keywords: [keyword],
						type
					};

					const keywordEntries = buildKeywordEntries([entry]);
					const typeWeight = TYPE_WEIGHTS[type];

					for (const ke of keywordEntries) {
						expect(ke.typeWeight).toBe(typeWeight);
						// Score should be base * typeWeight, rounded
						const baseScore = computeRelevanceScore(ke.keyword, entry);
						expect(ke.relevanceScore).toBe(Math.round(baseScore * typeWeight));
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Property 13: Search results sorted by relevance descending', () => {

	it('keyword entries from buildKeywordEntries can be sorted by relevance descending', () => {
		fc.assert(
			fc.property(
				fc.array(entryArb, { minLength: 2, maxLength: 10 }),
				(entries) => {
					const keywordEntries = buildKeywordEntries(entries);

					// Sort by relevance descending (as the Read Lambda would)
					const sorted = [...keywordEntries].sort((a, b) => b.relevanceScore - a.relevanceScore);

					// Verify sorted order
					for (let i = 0; i < sorted.length - 1; i++) {
						expect(sorted[i].relevanceScore).toBeGreaterThanOrEqual(sorted[i + 1].relevanceScore);
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('higher type weight produces equal or higher relevance for same base score', () => {
		fc.assert(
			fc.property(keywordArb, (keyword) => {
				const baseEntry = {
					hash: 'abcdef0123456789',
					title: `title with ${keyword}`,
					excerpt: 'some excerpt',
					keywords: [keyword]
				};

				const docEntry = { ...baseEntry, type: 'documentation' };
				const codeEntry = { ...baseEntry, type: 'code-example' };

				const docKeywords = buildKeywordEntries([docEntry]);
				const codeKeywords = buildKeywordEntries([codeEntry]);

				if (docKeywords.length > 0 && codeKeywords.length > 0) {
					// Documentation (1.0) should score >= code-example (0.8)
					const docScore = docKeywords[0].relevanceScore;
					const codeScore = codeKeywords[0].relevanceScore;
					expect(docScore).toBeGreaterThanOrEqual(codeScore);
				}
			}),
			{ numRuns: 100 }
		);
	});
});

// Feature: tool-discovery-enhancement, Requirement 7.1, 7.2: ranking inputs
describe('Task 17.1: repository-name, path, and repository-type ranking signals', () => {

	it('repository-name match contributes +repositoryNameMatch to base score', () => {
		fc.assert(
			fc.property(keywordArb, (keyword) => {
				const entry = {
					title: 'unrelated title',
					excerpt: 'unrelated excerpt',
					keywords: ['unrelated'],
					repository: `prefix-${keyword}-suffix`,
					contentPath: 'org/unrelated-repo/README.md/section'
				};

				const score = computeRelevanceScore(keyword, entry);
				expect(score).toBeGreaterThanOrEqual(SCORE_WEIGHTS.repositoryNameMatch);
			}),
			{ numRuns: 100 }
		);
	});

	it('path match contributes +pathMatch to base score', () => {
		fc.assert(
			fc.property(keywordArb, (keyword) => {
				const entry = {
					title: 'unrelated title',
					excerpt: 'unrelated excerpt',
					keywords: ['unrelated'],
					repository: 'unrelated-repo',
					contentPath: `org/unrelated-repo/docs/${keyword}/section`
				};

				const score = computeRelevanceScore(keyword, entry);
				expect(score).toBeGreaterThanOrEqual(SCORE_WEIGHTS.pathMatch);
			}),
			{ numRuns: 100 }
		);
	});

	it('repositoryNameMatch weight sits strictly between excerptMatch and keywordMatch', () => {
		expect(SCORE_WEIGHTS.repositoryNameMatch).toBeLessThan(SCORE_WEIGHTS.excerptMatch);
		expect(SCORE_WEIGHTS.repositoryNameMatch).toBeGreaterThan(SCORE_WEIGHTS.keywordMatch);
	});

	it('pathMatch is the lowest-weighted signal', () => {
		const others = [
			SCORE_WEIGHTS.titleMatch,
			SCORE_WEIGHTS.excerptMatch,
			SCORE_WEIGHTS.repositoryNameMatch,
			SCORE_WEIGHTS.keywordMatch
		];
		for (const weight of others) {
			expect(SCORE_WEIGHTS.pathMatch).toBeLessThan(weight);
		}
	});

	it('score is zero when keyword does not match title, excerpt, keywords, repository, or path', () => {
		fc.assert(
			fc.property(keywordArb, (keyword) => {
				const entry = {
					title: 'zzzzz',
					excerpt: 'zzzzz',
					keywords: ['zzzzz'],
					repository: 'zzzzz',
					contentPath: 'org/zzzzz/zzzzz.md/zzzzz'
				};

				fc.pre(
					!entry.title.includes(keyword) &&
					!entry.excerpt.includes(keyword) &&
					!entry.repository.includes(keyword) &&
					!entry.contentPath.includes(keyword)
				);

				const score = computeRelevanceScore(keyword, entry);
				expect(score).toBe(0);
			}),
			{ numRuns: 100 }
		);
	});

	it('REPOSITORY_TYPE_WEIGHTS: package and documentation are highest, templates/app-starter neutral, mcp/management slightly below neutral', () => {
		expect(REPOSITORY_TYPE_WEIGHTS['package']).toBeGreaterThan(NEUTRAL_REPOSITORY_TYPE_WEIGHT);
		expect(REPOSITORY_TYPE_WEIGHTS['documentation']).toBeGreaterThan(NEUTRAL_REPOSITORY_TYPE_WEIGHT);
		expect(REPOSITORY_TYPE_WEIGHTS['templates']).toBe(NEUTRAL_REPOSITORY_TYPE_WEIGHT);
		expect(REPOSITORY_TYPE_WEIGHTS['app-starter']).toBe(NEUTRAL_REPOSITORY_TYPE_WEIGHT);
		expect(REPOSITORY_TYPE_WEIGHTS['mcp']).toBeLessThan(NEUTRAL_REPOSITORY_TYPE_WEIGHT);
		expect(REPOSITORY_TYPE_WEIGHTS['management']).toBeLessThan(NEUTRAL_REPOSITORY_TYPE_WEIGHT);
	});

	it('an absent/unclassified repositoryType takes the neutral weight, same as templates/app-starter', () => {
		fc.assert(
			fc.property(keywordArb, fc.constantFrom(undefined, null, 'some-unclassified-type'), (keyword, repositoryType) => {
				const entry = {
					hash: 'abcdef0123456789',
					title: `title with ${keyword}`,
					excerpt: 'some excerpt',
					keywords: [keyword],
					type: 'documentation',
					repositoryType
				};
				const neutralEntry = { ...entry, repositoryType: 'templates' };

				const [absentResult] = buildKeywordEntries([entry]);
				const [neutralResult] = buildKeywordEntries([neutralEntry]);

				expect(absentResult.relevanceScore).toBe(neutralResult.relevanceScore);
			}),
			{ numRuns: 100 }
		);
	});

	it('buildKeywordEntries scales relevanceScore by both typeWeight and the repositoryType multiplier', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('documentation', 'code-example', 'template-pattern'),
				fc.constantFrom('package', 'documentation', 'templates', 'app-starter', 'mcp', 'management'),
				keywordArb,
				(type, repositoryType, keyword) => {
					const entry = {
						hash: 'abcdef0123456789',
						title: `title with ${keyword}`,
						excerpt: 'some excerpt',
						keywords: [keyword],
						type,
						repositoryType
					};

					const [result] = buildKeywordEntries([entry]);
					const baseScore = computeRelevanceScore(keyword, entry);
					const expected = Math.round(baseScore * TYPE_WEIGHTS[type] * REPOSITORY_TYPE_WEIGHTS[repositoryType]);

					expect(result.relevanceScore).toBe(expected);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('a package-repository section outranks an equal-text-relevance section from an unrelated/unclassified repository', () => {
		const sharedEntry = {
			hash: 'abcdef0123456789',
			title: 'title with widget',
			excerpt: 'some excerpt',
			keywords: ['widget'],
			type: 'documentation'
		};

		const packageEntry = { ...sharedEntry, repositoryType: 'package' };
		const unclassifiedEntry = { ...sharedEntry, repositoryType: undefined };

		const [packageResult] = buildKeywordEntries([packageEntry]);
		const [unclassifiedResult] = buildKeywordEntries([unclassifiedEntry]);

		expect(packageResult.relevanceScore).toBeGreaterThan(unclassifiedResult.relevanceScore);
	});
});
