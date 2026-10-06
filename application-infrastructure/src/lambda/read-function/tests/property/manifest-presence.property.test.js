/**
 * Property-Based Tests for Corpus Manifest Presence
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 6: Manifest presence
 *
 * Every `search_documentation` response carries `indexedRepositories` whenever the corpus
 * manifest can be derived — including a query that matches nothing, which is exactly the
 * bootstrap case R8.2 exists for (design section 9.3; task 13.1's `assembleIndexedRepositories`
 * runs AFTER the result payload is built and is therefore independent of `totalResults`).
 *
 * `services/documentation.js` attaches `indexedRepositories` outside the query cache, once
 * `models/corpus.js` resolves a manifest whose `source` is not `'unavailable'`. This property
 * exercises that attachment across many queries and many corpus shapes, rather than the fixed
 * examples already covered by `tests/unit/services/documentation-corpus-manifest.test.js`
 * (task 13.1's unit coverage), so a regression that only shows up for a specific query string,
 * result-set size, or repository count is caught.
 *
 * Requirement 10.4 ("the response shape SHALL be identical whichever retrieval strategy
 * produced it, including the corpus manifest") is addressed structurally here rather than by
 * driving the semantic path: `assembleIndexedRepositories()` is called in `search()` on the
 * already-finalized `body` (design 9.4 step 1 — "results ... are already built by the caller —
 * this function never sees or touches them"), so manifest attachment cannot observe which
 * branch (keyword/semantic/semantic-assisted) produced `results`. The keyword path exercised
 * here is the branch every disabled-AI deployment and every below-minTier caller actually
 * takes; strategy SELECTION itself (embed/vector wiring) is covered separately by
 * `tests/unit/services/documentation-ai-wiring.test.js`.
 *
 * Follows the mocked-`CacheableDataAccess`/`Config`/`Models` convention established in
 * `tests/unit/services/documentation-corpus-manifest.test.js` (task 13.1).
 *
 * Validates: Requirements 8.1, 8.2, 10.4
 */

'use strict';

const fc = require('fast-check');

jest.mock('@63klabs/cache-data', () => ({
	cache: {
		CacheableDataAccess: {
			getData: jest.fn()
		}
	},
	tools: {
		DebugAndLog: {
			debug: jest.fn(),
			info: jest.fn(),
			warn: jest.fn(),
			error: jest.fn()
		},
		ApiRequest: {
			success: jest.fn(({ body }) => ({ getBody: (parse) => (parse ? body : JSON.stringify(body)), statusCode: 200 }))
		}
	}
}));

jest.mock('../../config', () => ({
	Config: {
		getConnCacheProfile: jest.fn(),
		settings: jest.fn()
	}
}));

jest.mock('../../models', () => ({
	DocIndex: {
		queryIndex: jest.fn()
	},
	Corpus: {
		getCorpusManifest: jest.fn(),
		MANIFEST_SOURCE: { INDEXER: 'indexer', DERIVED: 'derived', UNAVAILABLE: 'unavailable' }
	}
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../config');
const Models = require('../../models');
const Documentation = require('../../services/documentation');

const createMockConnCacheProfile = () => ({
	conn: { name: 'doc-index', host: [], path: '/docs', parameters: {}, cache: [] },
	cacheProfile: {
		profile: 'search',
		overrideOriginHeaderExpiration: true,
		defaultExpirationInSeconds: 3600,
		expirationIsOnInterval: false,
		headersToRetain: '',
		hostId: 'doc-index',
		pathId: 'search',
		encrypt: false
	}
});

/** Query strings: any non-empty string once trimmed, mirroring `search()`'s own validation. */
const queryArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

/** A single matched result object, carrying only the fields these assertions care about. */
const resultArb = fc.record({
	title: fc.string({ maxLength: 20 }),
	type: fc.option(fc.constantFrom('documentation', 'code-example', 'template-pattern'), { nil: undefined }),
	subType: fc.option(fc.constantFrom('guide', 'reference', 'function'), { nil: undefined })
});

/** A matched-result set spanning the empty (no-match) case through a small non-empty set. */
const resultsArb = fc.array(resultArb, { minLength: 0, maxLength: 8 });

/**
 * A single corpus-manifest repository entry, shaped as `models/corpus.js` produces it
 * (either from the indexer item or the main-index derivation).
 */
const repoArb = fc.record({
	name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
	owner: fc.constantFrom('63klabs', 'otherorg'),
	repositoryType: fc.option(
		fc.constantFrom('package', 'documentation', 'templates', 'app-starter', 'mcp', 'management'),
		{ nil: null }
	),
	namespace: fc.option(fc.constantFrom('v1', 'v2', 'beta'), { nil: null }),
	sections: fc.integer({ min: 0, max: 500 }),
	ref: fc.option(fc.constantFrom('main', 'v1.0.0', 'v2.0.0'), { nil: null })
});

/**
 * A corpus manifest's repository list. Bounded at 15 entries so the `full` tier's ~115
 * bytes/entry (design 9.3) comfortably fits the test's 4096-byte budget — this property is
 * about PRESENCE across arbitrary queries/corpora, not the degradation ladder itself (that is
 * Property 7, task 13.3).
 */
const repositoriesArb = fc.array(repoArb, { minLength: 1, maxLength: 15 });

/** The two sources under which `models/corpus.js` returns a usable (non-`'unavailable'`) manifest. */
const availableSourceArb = fc.constantFrom('indexer', 'derived');

/** Build the settings object `Documentation.search()` reads via `Config.settings()`. */
function makeSettings() {
	return {
		github: { userOrgs: ['63klabs'] },
		docIndexTable: 'test-doc-index-table',
		documentation: {
			ai: { enabled: false, minTier: 'paid', retrievalMode: 'semantic' },
			corpusManifestMaxBytes: 4096
		}
	};
}

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 6: Manifest presence', () => {

	beforeEach(() => {
		jest.clearAllMocks();
		Config.settings.mockReturnValue(makeSettings());
		Config.getConnCacheProfile.mockImplementation(() => createMockConnCacheProfile());
		CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn, conn) => fetchFn(conn, {}));
	});

	/**
	 * **Validates: Requirements 8.1, 8.2, 10.4**
	 *
	 * For any non-empty query, any matched-result set (including an empty one — the
	 * no-match case), and any available corpus manifest, `search_documentation` carries
	 * `indexedRepositories` on the response, with a recognized degradation-ladder tier.
	 * Independent of `totalResults`, so a query returning nothing is covered by the SAME
	 * assertion as a query returning several results, rather than as a special case.
	 */
	test('every query returns indexedRepositories with a valid tier whenever a manifest is available', async () => {
		await fc.assert(
			fc.asyncProperty(
				queryArb,
				resultsArb,
				repositoriesArb,
				availableSourceArb,
				async (query, results, repositories, source) => {
					Models.DocIndex.queryIndex.mockResolvedValue({
						results,
						totalResults: results.length,
						query,
						suggestions: []
					});
					Models.Corpus.getCorpusManifest.mockResolvedValue({ repositories, source, version: 'v1' });

					const result = await Documentation.search({ query });

					expect('indexedRepositories' in result).toBe(true);
					expect(result.indexedRepositories).toBeDefined();
					expect(['full', 'compact', 'count']).toContain(result.indexedRepositories.tier);
				}
			),
			{ numRuns: 100 }
		);
	});

	/**
	 * **Validates: Requirements 8.1, 8.2**
	 *
	 * The bootstrap case named explicitly by the property: a query that matches NO sections
	 * (`totalResults === 0`) still returns `indexedRepositories`, for any query string and
	 * any available corpus manifest. This is the exact scenario R8.2 exists for — a query
	 * returning nothing still teaches the agent what it could have asked for instead.
	 */
	test('a query matching nothing still returns indexedRepositories, for any query and corpus', async () => {
		await fc.assert(
			fc.asyncProperty(
				queryArb,
				repositoriesArb,
				availableSourceArb,
				async (query, repositories, source) => {
					Models.DocIndex.queryIndex.mockResolvedValue({
						results: [],
						totalResults: 0,
						query,
						suggestions: ['Try using more specific keywords']
					});
					Models.Corpus.getCorpusManifest.mockResolvedValue({ repositories, source, version: 'v1' });

					const result = await Documentation.search({ query });

					expect(result.totalResults).toBe(0);
					expect(result.results).toEqual([]);
					expect('indexedRepositories' in result).toBe(true);
					expect(result.indexedRepositories).toBeDefined();
					expect(['full', 'compact', 'count']).toContain(result.indexedRepositories.tier);
				}
			),
			{ numRuns: 100 }
		);
	});
});
