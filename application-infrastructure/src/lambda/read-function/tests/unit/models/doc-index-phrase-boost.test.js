/**
 * Unit tests for the query-time exact-phrase relevance boost in DocIndex.queryIndex()
 * (spec 0-0-6, task 4.1).
 *
 * Covers Requirement 9:
 * - 9.1: keyword-mode candidates whose `title` or `excerpt` contains the full query phrase
 *   receive the exact-phrase boost.
 * - 9.2: the boost is computed AFTER metadata retrieval over the already-fetched top
 *   candidates, so it adds no additional DynamoDB reads.
 * - 9.3: the previously-dead `exactPhrase` weight (20) now has an actual effect.
 * - 9.4: results are still returned sorted by FINAL relevance descending; the boost changes
 *   ordering only, never membership.
 * - 9.5: semantic / semantic-assisted ranking is unaffected — the shared enrichment
 *   primitive (`getContentMetadataByHashes`) applies no boost.
 *
 * Uses the setDocClient() injection pattern; all AWS I/O is mocked.
 */

const DocIndex = require('../../../models/doc-index');

jest.mock('../../../config', () => ({
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

const TABLE = 'test-doc-index-table';
const VERSION = '20250715T060000';

/**
 * Create a mock DynamoDB Document Client backed by an in-memory fixture.
 *
 * @param {Object} fixture - Fixture definition
 * @param {Object.<string, Array<Object>>} [fixture.keywordItems] - keyword -> search entries
 * @param {Object.<string, Object>} [fixture.metadataItems] - content hash -> metadata attributes
 * @returns {{send: Function}} Mock client with a jest.fn() send()
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
 * Collect every content hash the mock client was asked to read metadata for.
 *
 * @param {{send: Function}} client - Mock client returned by createMockClient()
 * @returns {Array<string>} Content hashes present in BatchGetItem requests
 */
function metadataHashesRead(client) {
	return client.send.mock.calls
		.filter((call) => call[0].constructor.name === 'BatchGetCommand')
		.flatMap((call) => call[0].input.RequestItems[TABLE].Keys)
		.map((key) => key.pk.slice('content:'.length));
}

/**
 * Fixture where the LOWER-scoring candidate (`phrase`) is the one whose title contains the
 * literal phrase "cache-data installation", so the boost must flip the ordering.
 *
 * Base keyword scores: `plain` = 25, `phrase` = 5 + 5 = 10.
 *
 * @returns {Object} Fixture for createMockClient()
 */
function orderingFixture() {
	return {
		keywordItems: {
			'cache-data': [
				{ hash: 'plain', relevanceScore: 25, typeWeight: 1.0, type: 'documentation', subType: 'guide' },
				{ hash: 'phrase', relevanceScore: 5, typeWeight: 1.0, type: 'documentation', subType: 'guide' }
			],
			installation: [
				{ hash: 'phrase', relevanceScore: 5, typeWeight: 1.0, type: 'documentation', subType: 'guide' }
			]
		},
		metadataItems: {
			plain: {
				title: 'Caching Overview',
				excerpt: 'General notes on installation of caching layers.',
				type: 'documentation',
				subType: 'guide',
				path: '63klabs/cache-data/README.md/overview'
			},
			phrase: {
				title: 'Cache-Data Installation',
				excerpt: 'Add the package to your Lambda function.',
				type: 'documentation',
				subType: 'guide',
				path: '63klabs/cache-data/INSTALL.md/setup'
			}
		}
	};
}

describe('DocIndex.queryIndex() — query-time exact-phrase boost', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	// -----------------------------------------------------------------
	// R9.1 / R9.3 / R9.4 — the boost applies and re-orders
	// -----------------------------------------------------------------
	it('promotes a lower-scoring candidate whose title contains the full query phrase', async () => {
		const client = createMockClient(orderingFixture());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache-data installation', limit: 10 });

		// 10 + 20 = 30 beats the un-boosted 25.
		expect(result.results.map((r) => r.title)).toEqual(['Cache-Data Installation', 'Caching Overview']);
		expect(result.results.map((r) => r.relevanceScore)).toEqual([30, 25]);
	});

	it('leaves ordering alone when no candidate contains the full phrase', async () => {
		// Same keyword set (and therefore identical base scores) with the words reversed, so
		// the phrase "installation cache-data" appears in neither title nor excerpt.
		const client = createMockClient(orderingFixture());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'installation cache-data', limit: 10 });

		expect(result.results.map((r) => r.title)).toEqual(['Caching Overview', 'Cache-Data Installation']);
		expect(result.results.map((r) => r.relevanceScore)).toEqual([25, 10]);
	});

	it('boosts on an excerpt phrase match as well as a title match', async () => {
		const fixture = orderingFixture();
		// Move the phrase out of the title and into the excerpt.
		fixture.metadataItems.phrase.title = 'Getting Started';
		fixture.metadataItems.phrase.excerpt = 'See the cache-data installation notes first.';

		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache-data installation', limit: 10 });

		expect(result.results.map((r) => r.title)).toEqual(['Getting Started', 'Caching Overview']);
		expect(result.results[0].relevanceScore).toBe(30);
	});

	it('matches the phrase case-insensitively and ignoring punctuation', async () => {
		const fixture = orderingFixture();
		fixture.metadataItems.phrase.title = 'CACHE-DATA: INSTALLATION!';

		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'Cache-Data (installation)', limit: 10 });

		expect(result.results[0].title).toBe('CACHE-DATA: INSTALLATION!');
		expect(result.results[0].relevanceScore).toBe(30);
	});

	// -----------------------------------------------------------------
	// R9.4 — ordering changes, membership does not
	// -----------------------------------------------------------------
	it('changes ordering but not membership or totalResults', async () => {
		const boostedClient = createMockClient(orderingFixture());
		DocIndex.setDocClient(boostedClient);
		const boosted = await DocIndex.queryIndex({ query: 'cache-data installation', limit: 10 });

		DocIndex.TestHarness.resetClient();
		const unboostedClient = createMockClient(orderingFixture());
		DocIndex.setDocClient(unboostedClient);
		const unboosted = await DocIndex.queryIndex({ query: 'installation cache-data', limit: 10 });

		expect(boosted.totalResults).toBe(unboosted.totalResults);
		expect(boosted.results.map((r) => r.filePath).sort())
			.toEqual(unboosted.results.map((r) => r.filePath).sort());
		// Same membership, different order.
		expect(boosted.results.map((r) => r.filePath))
			.not.toEqual(unboosted.results.map((r) => r.filePath));
	});

	it('returns results sorted by final relevance descending', async () => {
		const fixture = orderingFixture();
		fixture.keywordItems['cache-data'].push(
			{ hash: 'mid', relevanceScore: 18, typeWeight: 1.0, type: 'documentation', subType: 'guide' }
		);
		fixture.metadataItems.mid = {
			title: 'Middling Result',
			excerpt: 'Nothing relevant here.',
			type: 'documentation',
			subType: 'guide',
			path: '63klabs/cache-data/MID.md/mid'
		};

		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache-data installation', limit: 10 });
		const scores = result.results.map((r) => r.relevanceScore);

		expect(scores).toEqual([30, 25, 18]);
		expect([...scores].sort((a, b) => b - a)).toEqual(scores);
	});

	// -----------------------------------------------------------------
	// R9.2 — no additional reads
	// -----------------------------------------------------------------
	it('adds no additional DynamoDB reads', async () => {
		const boostedClient = createMockClient(orderingFixture());
		DocIndex.setDocClient(boostedClient);
		await DocIndex.queryIndex({ query: 'cache-data installation', limit: 10 });

		DocIndex.TestHarness.resetClient();
		const unboostedClient = createMockClient(orderingFixture());
		DocIndex.setDocClient(unboostedClient);
		await DocIndex.queryIndex({ query: 'installation cache-data', limit: 10 });

		expect(metadataHashesRead(boostedClient).sort()).toEqual(metadataHashesRead(unboostedClient).sort());
		expect(boostedClient.send.mock.calls.length).toBe(unboostedClient.send.mock.calls.length);
	});

	it('applies the boost after filter push-down without re-widening membership', async () => {
		const fixture = orderingFixture();
		// `phrase` is the only entry that matches the phrase, but it is a code-example, so a
		// `documentation` filter must still exclude it regardless of the boost.
		fixture.keywordItems['cache-data'][1].type = 'code-example';
		fixture.keywordItems.installation[0].type = 'code-example';
		fixture.metadataItems.phrase.type = 'code-example';

		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({
			query: 'cache-data installation', type: 'documentation', limit: 10
		});

		expect(result.results.map((r) => r.title)).toEqual(['Caching Overview']);
		expect(result.totalResults).toBe(1);
		expect(metadataHashesRead(client)).toEqual(['plain']);
	});

	// -----------------------------------------------------------------
	// R9.5 — semantic / assisted enrichment is untouched
	// -----------------------------------------------------------------
	it('does not boost in the shared enrichment primitive used by the semantic path', async () => {
		// services/documentation.js buildResults() ranks by the vector hit's cosine `score`
		// and enriches via getContentMetadataByHashes. That primitive must return the stored
		// metadata verbatim, with no relevanceScore and no phrase boost applied.
		const client = createMockClient(orderingFixture());
		DocIndex.setDocClient(client);

		const byHash = await DocIndex.getContentMetadataByHashes(TABLE, VERSION, ['phrase', 'plain']);

		expect(byHash.phrase.title).toBe('Cache-Data Installation');
		expect(byHash.phrase.relevanceScore).toBeUndefined();
		expect(byHash.plain.relevanceScore).toBeUndefined();
	});
});

describe('normalizeForPhraseMatch()', () => {
	const { normalizeForPhraseMatch } = DocIndex.TestHarness.getInternals();

	it('lowercases, strips punctuation, and collapses whitespace', () => {
		expect(normalizeForPhraseMatch('Cache-Data:  Installation Guide!'))
			.toBe('cache-data installation guide');
	});

	it('preserves hyphens so hyphenated terms stay one token', () => {
		expect(normalizeForPhraseMatch('template-pattern')).toBe('template-pattern');
	});

	it('returns an empty string for empty or non-string input', () => {
		expect(normalizeForPhraseMatch('')).toBe('');
		expect(normalizeForPhraseMatch(undefined)).toBe('');
		expect(normalizeForPhraseMatch(null)).toBe('');
		expect(normalizeForPhraseMatch(42)).toBe('');
	});

	it('normalizes a punctuation-only string away entirely', () => {
		expect(normalizeForPhraseMatch('?!?')).toBe('');
	});
});

describe('applyExactPhraseBoost()', () => {
	const { applyExactPhraseBoost, EXACT_PHRASE_BOOST } = DocIndex.TestHarness.getInternals();

	it('uses a boost value of 20 (the former index-time exactPhrase weight)', () => {
		expect(EXACT_PHRASE_BOOST).toBe(20);
	});

	it('boosts a title match and leaves non-matches alone', () => {
		const candidates = [
			{ title: 'Cache-Data Installation', excerpt: '', relevanceScore: 10 },
			{ title: 'Something Else', excerpt: 'unrelated', relevanceScore: 25 }
		];

		applyExactPhraseBoost(candidates, 'cache-data installation');

		expect(candidates.map((c) => c.relevanceScore)).toEqual([30, 25]);
	});

	it('adds the boost only once when both title and excerpt match', () => {
		const candidates = [
			{ title: 'Cache-Data Installation', excerpt: 'cache-data installation steps', relevanceScore: 10 }
		];

		applyExactPhraseBoost(candidates, 'cache-data installation');

		expect(candidates[0].relevanceScore).toBe(30);
	});

	it('requires the full phrase, not merely all of its words', () => {
		const candidates = [
			{ title: 'Installation of the Cache-Data package', excerpt: '', relevanceScore: 10 }
		];

		applyExactPhraseBoost(candidates, 'cache-data installation');

		expect(candidates[0].relevanceScore).toBe(10);
	});

	it('never adds or removes candidates', () => {
		const candidates = [
			{ title: 'Cache-Data Installation', excerpt: '', relevanceScore: 10 },
			{ title: 'Other', excerpt: '', relevanceScore: 5 }
		];

		const returned = applyExactPhraseBoost(candidates, 'cache-data installation');

		expect(returned).toBe(candidates);
		expect(returned).toHaveLength(2);
	});

	it('skips the pass for a query that normalizes to an empty phrase', () => {
		const candidates = [{ title: 'Anything', excerpt: 'anything', relevanceScore: 10 }];

		applyExactPhraseBoost(candidates, '???');

		expect(candidates[0].relevanceScore).toBe(10);
	});

	it('tolerates candidates with missing title/excerpt', () => {
		const candidates = [{ relevanceScore: 10 }, { title: null, excerpt: undefined, relevanceScore: 5 }];

		applyExactPhraseBoost(candidates, 'cache-data installation');

		expect(candidates.map((c) => c.relevanceScore)).toEqual([10, 5]);
	});
});
