/**
 * Unit tests for the candidate-window reorder in DocIndex.queryIndex()
 * (spec 0-0-7-tool-discovery-enhancement, task 17.2, design.md section 8.3,
 * Requirements 7.3, 7.4).
 *
 * `doc-index-filter-pushdown.test.js` already covers the specific regression this reorder
 * fixes (a filter-matching candidate outside the OLD narrower window is no longer dropped —
 * see its "applies push-down BEFORE the candidate-window slice" test). This file adds
 * DIRECT unit coverage of the window-MULTIPLIER-selection logic itself:
 *
 * - An unfiltered query selects `UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER` (3): the number of
 *   metadata reads issued is capped at `limit * 3`, and the candidates read are exactly the
 *   top-ranked `limit * 3` entries in ranked order (membership AND order match pre-reorder
 *   expectations).
 * - A query supplying ANY filter (`type`, `subType`, `repository`, `repositoryType`,
 *   `namespace`, or `ghusers`) selects the wider `FILTERED_CANDIDATE_WINDOW_MULTIPLIER` (10)
 *   instead.
 *
 * Uses the setDocClient() injection pattern; all AWS I/O is mocked, following the existing
 * `doc-index-filter-pushdown.test.js` convention.
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

const { UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER, FILTERED_CANDIDATE_WINDOW_MULTIPLIER } =
	DocIndex.TestHarness.getInternals();

/**
 * Create a mock DynamoDB Document Client backed by an in-memory fixture, mirroring
 * `doc-index-filter-pushdown.test.js`'s `createMockClient`.
 *
 * @param {Object} fixture - Fixture definition
 * @param {Object.<string, Array<Object>>} fixture.keywordItems - keyword -> search entries
 * @param {Object.<string, Object>} fixture.metadataItems - content hash -> metadata attributes
 * @returns {Object} Mock client with a jest.fn() send()
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
 * Collect every content hash the mock client was asked to read metadata for, in the ORDER
 * the BatchGetCommand keys were requested (which, per the reorder, mirrors the ranked
 * candidate-window order).
 *
 * @param {Object} client - Mock client returned by createMockClient()
 * @returns {Array<string>} Content hashes present in BatchGetItem requests, in request order
 */
function metadataHashesRead(client) {
	return client.send.mock.calls
		.filter((call) => call[0].constructor.name === 'BatchGetCommand')
		.flatMap((call) => call[0].input.RequestItems[TABLE].Keys)
		.map((key) => key.pk.slice('content:'.length));
}

/**
 * Build a fixture with `count` ranked, strictly-descending-score search entries for a
 * single keyword, each with its own documentation-type metadata item so none is dropped by
 * push-down or the authoritative post-fetch filter.
 *
 * @param {number} count - Number of candidates to generate
 * @param {Object} [metadataOverrides] - Extra metadata attributes applied to every item
 *   (e.g. `{ repository: 'cache-data' }` to make every candidate filter-eligible)
 * @returns {{keywordItems: Object, metadataItems: Object, hashesInRankOrder: Array<string>}}
 */
function buildRankedFixture(count, metadataOverrides = {}) {
	const keywordItems = { widget: [] };
	const metadataItems = {};
	const hashesInRankOrder = [];

	for (let i = 0; i < count; i++) {
		const hash = `h${String(i).padStart(3, '0')}`;
		hashesInRankOrder.push(hash);
		keywordItems.widget.push({ hash, relevanceScore: count - i, typeWeight: 1.0 });
		metadataItems[hash] = {
			title: `Widget ${i}`,
			excerpt: 'x',
			type: 'documentation',
			path: `repo/${hash}.md`,
			...metadataOverrides
		};
	}

	return { keywordItems, metadataItems, hashesInRankOrder };
}

describe('DocIndex.queryIndex() — candidate window multiplier selection (R7.3, R7.4, design 8.3)', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	it('exposes the documented window multiplier constants', () => {
		expect(UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER).toBe(3);
		expect(FILTERED_CANDIDATE_WINDOW_MULTIPLIER).toBe(10);
	});

	// -----------------------------------------------------------------
	// Unfiltered query: UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER (3)
	// -----------------------------------------------------------------
	it('reads exactly limit * UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER metadata items when no filter is supplied', async () => {
		const limit = 2;
		// 20 candidates, far more than limit * 3 = 6, so the window is the binding constraint.
		const fixture = buildRankedFixture(20);
		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		await DocIndex.queryIndex({ query: 'widget', limit });

		const read = metadataHashesRead(client);
		expect(read).toHaveLength(limit * UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER);
	});

	it('reads the top-ranked candidates, in ranked order, for an unfiltered query (membership and order preserved)', async () => {
		const limit = 2;
		const fixture = buildRankedFixture(20);
		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		await DocIndex.queryIndex({ query: 'widget', limit });

		const read = metadataHashesRead(client);
		const expectedWindow = fixture.hashesInRankOrder.slice(0, limit * UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER);
		expect(read).toEqual(expectedWindow);
	});

	// -----------------------------------------------------------------
	// Filtered query: FILTERED_CANDIDATE_WINDOW_MULTIPLIER (10), one case per filter kind
	// -----------------------------------------------------------------
	it.each([
		['type', { type: 'documentation' }],
		['subType', { subType: 'guide' }],
		['repository', { repository: 'cache-data' }],
		['repositoryType', { repositoryType: 'package' }],
		['namespace', { namespace: 'atlantis' }],
		['ghusers', { ghusers: ['63klabs'] }]
	])('reads up to limit * FILTERED_CANDIDATE_WINDOW_MULTIPLIER metadata items when the %s filter is active', async (filterName, filterOptions) => {
		const limit = 2;
		// Every candidate's metadata carries values that satisfy whichever filter is under
		// test, isolating the assertion to the WINDOW SIZE rather than post-fetch narrowing.
		const metadataOverrides = {
			type: 'documentation',
			subType: 'guide',
			repository: 'cache-data',
			repositoryType: 'package',
			namespace: 'atlantis',
			owner: '63klabs'
		};
		// 20 candidates, far more than limit * 10 = 20... use 30 so the window still binds.
		const fixture = buildRankedFixture(30, metadataOverrides);
		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		await DocIndex.queryIndex({ query: 'widget', limit, ...filterOptions });

		const read = metadataHashesRead(client);
		expect(read).toHaveLength(limit * FILTERED_CANDIDATE_WINDOW_MULTIPLIER);
	});

	it('reads strictly more candidates when a filter is active than when the same query is unfiltered (same ranked pool)', async () => {
		const limit = 1;
		const metadataOverrides = { repository: 'cache-data' };
		const fixture = buildRankedFixture(30, metadataOverrides);

		const unfilteredClient = createMockClient(fixture);
		DocIndex.setDocClient(unfilteredClient);
		await DocIndex.queryIndex({ query: 'widget', limit });
		const unfilteredCount = metadataHashesRead(unfilteredClient).length;

		DocIndex.TestHarness.resetClient();
		const filteredClient = createMockClient(fixture);
		DocIndex.setDocClient(filteredClient);
		await DocIndex.queryIndex({ query: 'widget', limit, repository: 'cache-data' });
		const filteredCount = metadataHashesRead(filteredClient).length;

		expect(unfilteredCount).toBe(limit * UNFILTERED_CANDIDATE_WINDOW_MULTIPLIER);
		expect(filteredCount).toBe(limit * FILTERED_CANDIDATE_WINDOW_MULTIPLIER);
		expect(filteredCount).toBeGreaterThan(unfilteredCount);
	});

	// -----------------------------------------------------------------
	// Window never exceeds the available ranked pool (Math.min guard)
	// -----------------------------------------------------------------
	it('reads every candidate (not more) when the ranked pool is smaller than the window', async () => {
		const limit = 10;
		// Only 4 candidates exist; limit * 3 = 30 would exceed the pool.
		const fixture = buildRankedFixture(4);
		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		await DocIndex.queryIndex({ query: 'widget', limit });

		const read = metadataHashesRead(client);
		expect(read).toHaveLength(4);
		expect(read.sort()).toEqual([...fixture.hashesInRankOrder].sort());
	});
});
