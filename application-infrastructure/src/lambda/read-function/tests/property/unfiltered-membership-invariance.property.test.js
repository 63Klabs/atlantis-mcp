/**
 * Property-Based Tests for Unfiltered Membership Invariance
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 5: Unfiltered membership invariance
 *
 * Task 17.2 (design 8.3) reordered `DocIndex.queryIndex()`'s pipeline to apply
 * `applyIndexedFilterPushDown()` to the FULL ranked candidate array BEFORE the
 * candidate-window slice, instead of after it, and to widen the window when any filter
 * is active. `applyIndexedFilterPushDown()` is proven (and separately unit-tested in
 * `tests/unit/models/doc-index-filter-pushdown.test.js`) to return its input UNCHANGED
 * when no filter argument is truthy, and `UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER` is kept
 * at its pre-reorder value of `3` specifically so the unfiltered case is unaffected by the
 * reorder (design 8.3 "Membership preservation proof").
 *
 * This test exercises that proof as a property, end to end through the REAL
 * `queryIndex()` function (mocked DynamoDB client only, following the convention
 * established by `tests/unit/models/doc-index-filter-pushdown.test.js` and
 * `tests/property/filter-soundness.property.test.js`): for arbitrarily generated search
 * index fixtures and queries that supply NO filter (`type`/`subType`/`repository`/
 * `repositoryType`/`namespace`/`ghusers` all absent), the final `results` array —
 * membership AND order — must be identical to a reference simulation of the OLD pipeline
 * order (`rank -> slice(limit * 3) -> batchGet -> post-filter[no-op] -> phrase boost ->
 * sort -> slice(limit)`), built independently in this file against the SAME fixture.
 *
 * The reference simulation reuses the production `EXACT_PHRASE_BOOST` weight and
 * `normalizeForPhraseMatch()` function via `DocIndex.TestHarness.getInternals()` rather
 * than duplicating that logic with hardcoded values, so this test only asserts the
 * PIPELINE-ORDERING invariant (R7.3, R7.4) and not a second, independently-drifting copy
 * of the phrase-boost formula.
 *
 * Validates: Requirements 5.6, 7.3, 7.4, 13.3
 */

'use strict';

const fc = require('fast-check');

jest.mock('../../config', () => ({
	Config: {
		settings: jest.fn(() => ({
			docIndexTable: 'test-doc-index-table',
			github: { userOrgs: ['63klabs'] }
		}))
	}
}));

jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			debug: jest.fn(),
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn()
		}
	}
}));

const DocIndex = require('../../models/doc-index');

const TABLE = 'test-doc-index-table';
const VERSION = '20250715T060000';

/**
 * Query words with no normalization surprises: none ends in a suffix-table ending
 * (`ing`/`es`/`s`/`ed`), none contains a hyphen, none is a stop word, and each is at
 * least {@link import('../../../layers/search-common/nodejs/normalize').MIN_TOKEN_LENGTH}
 * characters, so `extractQueryKeywords()` always returns exactly `[queryWord]` and this
 * test can reason about a SINGLE `search:{keyword}` partition without also exercising
 * multi-keyword aggregation or normalization edge cases (both already covered by other
 * property tests — normalization parity and filter soundness).
 *
 * @type {Array<string>}
 */
const QUERY_WORDS = ['widget', 'gadget', 'sensor', 'router', 'module', 'client'];

/**
 * Build the mocked-DynamoDB fixture (`search:{queryWord}` entries plus content metadata)
 * for a generated candidate list, and the reference OLD-pipeline simulation input in one
 * pass, so both the mock client and the reference simulation are built from the exact
 * same source data.
 *
 * @param {string} queryWord - The single query keyword (see {@link QUERY_WORDS}).
 * @param {Array<{relevanceScore: number, phraseMatch: boolean}>} candidates - Generated
 *   candidates, in the SAME order both the mock `QueryCommand` response and the
 *   reference simulation's `scoresByHash` insertion order will use.
 * @returns {{keywordItems: Object, metadataItems: Object}} Fixture for the mock client.
 */
function buildFixture(queryWord, candidates) {
	const keywordItems = {
		[queryWord]: candidates.map((c, i) => ({
			hash: `h${i}`,
			relevanceScore: c.relevanceScore,
			typeWeight: 1.0
			// >! No type/subType/repository/repositoryType/namespace carried — irrelevant
			// >! here since no filter is ever supplied in this property.
		}))
	};

	const metadataItems = {};
	candidates.forEach((c, i) => {
		metadataItems[`h${i}`] = {
			title: titleFor(queryWord, c, i),
			excerpt: 'excerpt text, nothing special',
			path: `repo/file${i}.md`
		};
	});

	return { keywordItems, metadataItems };
}

/**
 * Deterministic title for candidate `i`, embedding the query word verbatim when
 * `phraseMatch` is set so the exact-phrase boost (R9.1/R9.2 of spec 0-0-6) is exercised
 * for a subset of candidates on every run, and omitted otherwise. The title also encodes
 * the candidate index so result identity can be checked by title string alone.
 *
 * @param {string} queryWord - The query keyword.
 * @param {{phraseMatch: boolean}} candidate - The generated candidate.
 * @param {number} i - The candidate's index (also its hash suffix).
 * @returns {string} A unique, deterministic title for this candidate.
 */
function titleFor(queryWord, candidate, i) {
	return candidate.phraseMatch
		? `A note about ${queryWord} number ${i}`
		: `Unrelated note number ${i}`;
}

/**
 * Create a mock DynamoDB Document Client backed by a fixture, following the
 * `createMockClient` convention established in `doc-index-filter-pushdown.test.js` and
 * `filter-soundness.property.test.js`.
 *
 * @param {Object} fixture - Fixture definition
 * @param {Object.<string, Array<Object>>} fixture.keywordItems - keyword -> search entries
 * @param {Object.<string, Object>} fixture.metadataItems - content hash -> metadata attributes
 * @returns {{send: jest.Mock}} Mock client
 */
function createMockClient({ keywordItems = {}, metadataItems = {} } = {}) {
	return {
		send: jest.fn(async (command) => {
			const name = command.constructor.name;

			if (name === 'GetCommand') {
				const { Key } = command.input;
				if (Key.pk === 'version:pointer' && Key.sk === 'active') {
					return { Item: { pk: 'version:pointer', sk: 'active', version: VERSION } };
				}
				return {};
			}

			if (name === 'QueryCommand') {
				const keyword = command.input.ExpressionAttributeValues[':pk'].replace('search:', '');
				return { Items: keywordItems[keyword] || [] };
			}

			if (name === 'BatchGetCommand') {
				const keys = command.input.RequestItems[TABLE].Keys;
				const items = keys
					.map((key) => {
						const hash = key.pk.slice('content:'.length);
						const attrs = metadataItems[hash];
						return attrs ? { ...attrs, pk: key.pk, sk: key.sk } : null;
					})
					.filter((item) => item !== null);
				return { Responses: { [TABLE]: items } };
			}

			return {};
		})
	};
}

/**
 * Simulate the PRE-REORDER ("OLD") pipeline order directly against the generated
 * candidate list, independent of `queryIndex()`:
 *
 * ```text
 * rank by score -> slice(limit * UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER) -> batchGet
 *   -> post-filter [no-op, no filter supplied] -> phrase boost -> sort -> slice(limit)
 * ```
 *
 * Push-down is omitted entirely rather than called with no arguments, because
 * `applyIndexedFilterPushDown()` is the identity function in that case (asserted
 * separately below) — omitting it here is equivalent to calling it, and keeps this
 * reference free of a dependency on the function under test. The `scoresByHash`
 * insertion order mirrors exactly how `queryIndex()` builds it (iterating `result.Items`
 * for the single queried keyword, in fixture order), so tie-breaking under
 * `Array.prototype.sort`'s stable sort matches the production code for identical scores.
 *
 * @param {string} queryWord - The query keyword (also the phrase-boost phrase).
 * @param {Array<{relevanceScore: number, phraseMatch: boolean}>} candidates - Generated
 *   candidates, in fixture order.
 * @param {number} limit - The requested result limit.
 * @returns {{titles: Array<string>, totalResults: number}} Expected result titles, in
 *   final order, and the expected `totalResults` (the WINDOWED candidate count — the
 *   authoritative post-fetch filter is a no-op here, but `totalResults` still reflects
 *   only the candidates that survived the pre-batchGet window, matching production
 *   behavior whenever the fixture is larger than the window).
 */
function simulateOldPipeline(queryWord, candidates, limit) {
	const { normalizeForPhraseMatch, EXACT_PHRASE_BOOST, UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER } =
		DocIndex.TestHarness.getInternals();

	// >! Build the SAME scoresByHash shape queryIndex() builds (one keyword, so
	// >! totalScore === relevanceScore), in the SAME insertion order.
	const scoresByHash = {};
	candidates.forEach((c, i) => {
		scoresByHash[`h${i}`] = { hash: `h${i}`, totalScore: c.relevanceScore };
	});
	const ranked = Object.values(scoresByHash).sort((a, b) => b.totalScore - a.totalScore);

	// >! OLD order: slice to the window IMMEDIATELY after ranking (push-down is identity
	// >! here, so there is nothing to run before this slice).
	const fetchLimit = Math.min(ranked.length, limit * UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER);
	const windowed = ranked.slice(0, fetchLimit);

	// >! batchGet: every hash in the fixture has metadata, so this is a direct lookup.
	const metadataResults = windowed.map((entry) => {
		const i = Number(entry.hash.slice(1));
		return {
			title: titleFor(queryWord, candidates[i], i),
			relevanceScore: entry.totalScore
		};
	});

	// >! Authoritative post-fetch filter: no-op, since no filter is supplied.
	const filtered = metadataResults;

	// >! Query-time exact-phrase boost, using the SAME weight and normalizer the
	// >! production code uses, so this reference tracks that logic rather than
	// >! duplicating a second, independently-drifting copy of it.
	const phrase = normalizeForPhraseMatch(queryWord);
	if (phrase !== '') {
		for (const item of filtered) {
			if (normalizeForPhraseMatch(item.title).includes(phrase)) {
				item.relevanceScore += EXACT_PHRASE_BOOST;
			}
		}
	}

	filtered.sort((a, b) => b.relevanceScore - a.relevanceScore);
	return {
		titles: filtered.slice(0, limit).map((item) => item.title),
		totalResults: filtered.length
	};
}

/** Arbitrary for a single generated candidate. */
const candidateArb = fc.record({
	relevanceScore: fc.integer({ min: 0, max: 500 }),
	phraseMatch: fc.boolean()
});

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 5: Unfiltered membership invariance', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	/**
	 * Direct unit assertion backing the property below: `applyIndexedFilterPushDown()`
	 * returns the SAME array reference, unmodified, when no filter argument is supplied —
	 * the premise the reorder's membership-preservation proof (design 8.3) depends on.
	 * (Also covered in `tests/unit/models/doc-index-filter-pushdown.test.js`; reasserted
	 * here so this file's property is self-contained and its premise is verified
	 * alongside it.)
	 */
	test('applyIndexedFilterPushDown() is the identity function when no filter is requested', () => {
		const { applyIndexedFilterPushDown } = DocIndex.TestHarness.getInternals();
		const candidates = [{ hash: 'a', type: 'documentation' }, { hash: 'b', type: 'code-example' }];

		expect(applyIndexedFilterPushDown(candidates)).toBe(candidates);
	});

	/**
	 * **Validates: Requirements 5.6, 7.3, 7.4, 13.3**
	 *
	 * For arbitrary search-index fixtures (varying candidate counts, relevance scores,
	 * and phrase-boost eligibility) and arbitrary query/limit combinations, with NO filter
	 * supplied, `queryIndex()`'s returned `results` — membership AND order — are
	 * identical to the OLD pre-reorder pipeline simulated independently against the same
	 * fixture.
	 */
	test('returns the same membership and order as the pre-reorder pipeline for any unfiltered fixture', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom(...QUERY_WORDS),
				fc.integer({ min: 1, max: 8 }),
				fc.array(candidateArb, { minLength: 0, maxLength: 40 }),
				async (queryWord, limit, candidates) => {
					const { keywordItems, metadataItems } = buildFixture(queryWord, candidates);
					const client = createMockClient({ keywordItems, metadataItems });
					DocIndex.setDocClient(client);

					const result = await DocIndex.queryIndex({ query: queryWord, limit });

					const expected = simulateOldPipeline(queryWord, candidates, limit);

					expect(result.results.map((r) => r.title)).toEqual(expected.titles);
					expect(result.totalResults).toBe(expected.totalResults);

					DocIndex.TestHarness.resetClient();
				}
			),
			{ numRuns: 40 }
		);
	});

	/**
	 * **Validates: Requirements 5.6, 7.4**
	 *
	 * Sanity check at a fixed, hand-computed scale: with more candidates than
	 * `limit * UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER`, the window still only ever
	 * reaches into the top-ranked slice, and the final `limit`-sized result is exactly
	 * the top-`limit` candidates by score — confirming the property above isn't vacuously
	 * true because every generated fixture happens to be small.
	 */
	test('a fixture larger than the candidate window still returns the top-limit candidates by score', async () => {
		const queryWord = 'widget';
		const limit = 2;
		// >! UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER is 3, so with limit=2 the window is 6.
		// >! 10 candidates, strictly descending scores, none with a phrase match, so
		// >! ranking alone decides the outcome.
		const candidates = Array.from({ length: 10 }, (_, i) => ({
			relevanceScore: 100 - i,
			phraseMatch: false
		}));

		const { keywordItems, metadataItems } = buildFixture(queryWord, candidates);
		const client = createMockClient({ keywordItems, metadataItems });
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: queryWord, limit });

		expect(result.results.map((r) => r.title)).toEqual([
			titleFor(queryWord, candidates[0], 0),
			titleFor(queryWord, candidates[1], 1)
		]);
		// >! Window is limit * UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER = 2 * 3 = 6, not the
		// >! full 10-candidate fixture — totalResults reflects the windowed candidate set
		// >! (no filter ever removes anything from it here).
		expect(result.totalResults).toBe(6);
	});
});
