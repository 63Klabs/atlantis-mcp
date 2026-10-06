/**
 * Property-Based Tests for Manifest Never Truncating Results
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 7: Manifest never truncates results
 *
 * For any combination of result payload and corpus size, the response either fits the size
 * threshold with the corpus manifest (`indexedRepositories`) degraded, or omits the manifest
 * entirely -- and `results`/`totalResults` returned by `services/documentation.js`'s
 * `search()` are NEVER reduced because of the manifest. This is design section 9.4's binding
 * assembly order: `results` is fully built before the manifest tier is even selected, so the
 * manifest can only ever shrink/omit ITSELF, never the caller's requested results.
 *
 * Two properties are asserted against the real `assembleIndexedRepositories()` degradation
 * ladder (task 13.1), exercised end to end through `Documentation.search()`, with `DocIndex`,
 * `Corpus`, and the cache layer mocked following the `documentation-corpus-manifest.test.js`
 * convention:
 *
 * 1. For varying corpus sizes (`indexedRepositories`'s own repository count) and a
 *    `corpusManifestMaxBytes` budget biased toward each of `full`/`compact`/`count`
 *    (design 9.3's degradation ladder), `results` and `totalResults` are always exactly what
 *    `DocIndex.queryIndex()` returned -- the manifest tier selected has no bearing on them.
 * 2. For varying result-set sizes large enough to approach or exceed the OVERALL response
 *    size threshold (`ContentSizer.DEFAULT_SIZE_THRESHOLD`, 50000 bytes) when combined with
 *    the manifest, `results` are still never truncated; the response either fits with the
 *    manifest degraded to a tier that brings the total under threshold, or the manifest is
 *    omitted entirely -- and it is omitted ONLY when even the leanest `count` tier could not
 *    bring the total under threshold, never to make room for `results`.
 *
 * **Validates: Requirements 8.7, 8.8, 8.9, 13.5**
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
const ContentSizer = require('../../utils/content-sizer');

/**
 * Build a minimal, valid connection/cache-profile pair, following the convention established
 * in `documentation-corpus-manifest.test.js`.
 *
 * @returns {{conn: Object, cacheProfile: Object}}
 */
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

/**
 * Build the application config object `Documentation.search()` reads via `Config.settings()`,
 * varying only `documentation.corpusManifestMaxBytes` across tests.
 *
 * @param {number} corpusManifestMaxBytes - The manifest's own byte budget to exercise.
 * @returns {Object} A settings object shaped like `config/settings.js`'s real output.
 */
function makeSettings(corpusManifestMaxBytes) {
	return {
		github: { userOrgs: ['63klabs'] },
		docIndexTable: 'test-doc-index-table',
		documentation: {
			ai: { enabled: false, minTier: 'paid', retrievalMode: 'semantic' },
			corpusManifestMaxBytes
		}
	};
}

/** A single corpus-manifest repository entry, matching `models/corpus.js`'s shape. */
const repoArb = fc.record({
	name: fc.string({ minLength: 1, maxLength: 20 }),
	owner: fc.string({ minLength: 1, maxLength: 15 }),
	repositoryType: fc.constantFrom('package', 'documentation', 'mcp', 'app-starter', 'management', 'templates'),
	namespace: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: null }),
	sections: fc.integer({ min: 0, max: 999 }),
	ref: fc.string({ minLength: 1, maxLength: 15 })
});

/** Varying corpus sizes, from no indexed repositories up to a generously sized corpus. */
const reposArb = fc.array(repoArb, { minLength: 1, maxLength: 20 });

/**
 * A single search result object. `excerpt` is the size-controlling field: callers choose
 * `maxExcerptLength` to keep result sets small (to isolate the budget ladder) or let them
 * grow large (to approach/exceed the overall response size threshold).
 *
 * @param {number} maxExcerptLength - Upper bound on the generated `excerpt` string length.
 * @returns {fc.Arbitrary<Object>}
 */
function resultArb(maxExcerptLength) {
	return fc.record({
		title: fc.string({ maxLength: 40 }),
		excerpt: fc.string({ maxLength: maxExcerptLength }),
		filePath: fc.string({ maxLength: 60 }),
		type: fc.constantFrom('documentation', 'template-pattern', 'code-example'),
		subType: fc.constantFrom('guide', 'function', 'parameter')
	});
}

/**
 * Compute the UTF-8 byte length of the `full` tier manifest block for a given repository list,
 * reproducing the shape `services/documentation.js`'s `buildFullManifestEntries()` produces
 * (design.md section 9.3's Data Model), so a budget can be chosen to deliberately land on a
 * desired tier.
 *
 * @param {Array<Object>} repos - Corpus manifest repositories.
 * @returns {number} Byte length of the `full` tier block.
 */
function fullBlockBytes(repos) {
	const block = {
		tier: 'full',
		repositories: repos.map((r) => ({
			name: r.name ?? null,
			owner: r.owner ?? null,
			repositoryType: r.repositoryType ?? null,
			namespace: r.namespace ?? null,
			sections: r.sections ?? null,
			ref: r.ref ?? null
		}))
	};
	return Buffer.byteLength(JSON.stringify(block), 'utf8');
}

/**
 * Compute the UTF-8 byte length of the `compact` tier manifest block, mirroring
 * `buildCompactManifestEntries()`.
 *
 * @param {Array<Object>} repos - Corpus manifest repositories.
 * @returns {number} Byte length of the `compact` tier block.
 */
function compactBlockBytes(repos) {
	const block = {
		tier: 'compact',
		repositories: repos.map((r) => ({ name: r.name ?? null, repositoryType: r.repositoryType ?? null }))
	};
	return Buffer.byteLength(JSON.stringify(block), 'utf8');
}

/**
 * Compute the UTF-8 byte length of the `count` tier manifest block, mirroring
 * `buildCountManifestSummary()`.
 *
 * @param {Array<Object>} repos - Corpus manifest repositories.
 * @returns {number} Byte length of the `count` tier block.
 */
function countBlockBytes(repos) {
	const block = { tier: 'count', repositoryCount: repos.length, omitted: true };
	return Buffer.byteLength(JSON.stringify(block), 'utf8');
}

/**
 * Pair a generated corpus with a `corpusManifestMaxBytes` budget deliberately computed to
 * land on one of the three degradation tiers (design 9.3), so the property run exercises
 * `full`, `compact`, and `count` roughly evenly rather than hoping a uniformly random budget
 * happens to land on all three. A small buffer is added above the leaner block's size so the
 * chosen budget comfortably admits that tier even when adjacent tiers are close in size for
 * small corpora.
 */
const scenarioArb = fc.tuple(reposArb, fc.constantFrom('full', 'compact', 'count')).map(([repos, desiredTier]) => {
	const full = fullBlockBytes(repos);
	const compact = compactBlockBytes(repos);
	const count = countBlockBytes(repos);

	let maxBytes;
	if (desiredTier === 'full') {
		maxBytes = full;
	} else if (desiredTier === 'compact') {
		maxBytes = Math.max(compact, Math.min(full - 1, compact + 8));
	} else {
		maxBytes = Math.max(count, Math.min(compact - 1, count + 8));
	}

	return { repos, maxBytes };
});

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 7: Manifest never truncates results', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		Config.getConnCacheProfile.mockImplementation(() => createMockConnCacheProfile());
		CacheableDataAccess.getData.mockImplementation(async (profile, fetchFn, conn) => fetchFn(conn, {}));
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	/**
	 * **Validates: Requirements 8.7, 8.8, 13.5**
	 *
	 * Across generated corpus sizes and a `corpusManifestMaxBytes` budget biased toward each
	 * degradation tier (`full`/`compact`/`count`), `results`/`totalResults` are always exactly
	 * what the retrieval path produced, and whichever manifest tier is attached carries every
	 * repository (degraded in SHAPE, never in repository count).
	 */
	test('results and totalResults are untouched by the manifest, for any corpus size and budget tier', async () => {
		await fc.assert(
			fc.asyncProperty(scenarioArb, fc.array(resultArb(200), { minLength: 0, maxLength: 15 }), async ({ repos, maxBytes }, results) => {
				Config.settings.mockReturnValue(makeSettings(maxBytes));
				Models.DocIndex.queryIndex.mockResolvedValue({
					results, totalResults: results.length, query: 'q', suggestions: []
				});
				Models.Corpus.getCorpusManifest.mockResolvedValue({
					repositories: repos, source: 'indexer', version: 'v1'
				});

				const response = await Documentation.search({ query: 'q' });

				// The manifest can never cause the caller's requested results to be reduced.
				expect(response.results).toEqual(results);
				expect(response.results.length).toBe(results.length);
				expect(response.totalResults).toBe(results.length);

				if (response.indexedRepositories !== undefined) {
					expect(['full', 'compact', 'count']).toContain(response.indexedRepositories.tier);

					if (response.indexedRepositories.tier === 'count') {
						expect(response.indexedRepositories.repositories).toBeUndefined();
						expect(response.indexedRepositories.repositoryCount).toBe(repos.length);
						expect(response.indexedRepositories.omitted).toBe(true);
					} else {
						// `full`/`compact` degrade entry SHAPE, never the number of entries.
						expect(response.indexedRepositories.repositories).toHaveLength(repos.length);
					}
				}
			}),
			{ numRuns: 60 }
		);
	});

	/**
	 * **Validates: Requirements 8.9, 13.5**
	 *
	 * For result sets large enough to approach or exceed the overall response size threshold
	 * once combined with the manifest, `results` are still never truncated. The response
	 * either fits under `ContentSizer.DEFAULT_SIZE_THRESHOLD` with the manifest attached at
	 * some tier, or the manifest is omitted entirely -- and omission happens ONLY when even
	 * the leanest `count` tier could not bring the total under threshold, confirming the
	 * manifest degrades/omits itself rather than ever truncating `results` to make room.
	 */
	test('response fits with the manifest degraded, or the manifest is omitted, under the response size threshold', async () => {
		await fc.assert(
			fc.asyncProperty(reposArb, fc.array(resultArb(2500), { minLength: 0, maxLength: 30 }), async (repos, results) => {
				Config.settings.mockReturnValue(makeSettings(4096));
				Models.DocIndex.queryIndex.mockResolvedValue({
					results, totalResults: results.length, query: 'q', suggestions: []
				});
				Models.Corpus.getCorpusManifest.mockResolvedValue({
					repositories: repos, source: 'indexer', version: 'v1'
				});

				const response = await Documentation.search({ query: 'q' });

				// Never truncates results regardless of how the manifest resolves.
				expect(response.results).toEqual(results);
				expect(response.totalResults).toBe(results.length);

				const { indexedRepositories, ...rest } = response;
				const restBytes = ContentSizer.measure(JSON.stringify(rest)).byteLength;

				if (indexedRepositories !== undefined) {
					const manifestBytes = ContentSizer.measure(JSON.stringify(indexedRepositories)).byteLength;
					expect(restBytes + manifestBytes).toBeLessThanOrEqual(ContentSizer.DEFAULT_SIZE_THRESHOLD);
				} else {
					// Omitted only because even the leanest (`count`) tier would still push the
					// response over the hard cap -- never because `results` needed the room.
					const countBytes = countBlockBytes(repos);
					expect(restBytes + countBytes).toBeGreaterThan(ContentSizer.DEFAULT_SIZE_THRESHOLD);
				}
			}),
			{ numRuns: 25 }
		);
	});
});
