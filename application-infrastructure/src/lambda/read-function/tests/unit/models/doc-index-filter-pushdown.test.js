/**
 * Unit tests for `type`/`subType` filter push-down in DocIndex.queryIndex()
 * (spec 0-0-6, task 3.1).
 *
 * Covers Requirement 8:
 * - 8.2: the filter is applied to the ranked candidate set using the `type`/`subType`
 *   attributes carried on `search:{keyword}` entries BEFORE the metadata BatchGetItem,
 *   so fewer metadata items are read when a filter is supplied.
 * - 8.5: push-down does NOT change which results are returned versus post-fetch
 *   filtering — including for search entries indexed before `type`/`subType` were
 *   written (absent/null), which must survive push-down and be settled by the
 *   authoritative post-fetch metadata filter.
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
 * Collect every content hash the mock client was asked to read metadata for.
 *
 * @param {Object} client - Mock client returned by createMockClient()
 * @returns {Array<string>} Content hashes present in BatchGetItem requests
 */
function metadataHashesRead(client) {
	return client.send.mock.calls
		.filter((call) => call[0].constructor.name === 'BatchGetCommand')
		.flatMap((call) => call[0].input.RequestItems[TABLE].Keys)
		.map((key) => key.pk.slice('content:'.length));
}

/**
 * Fixture where every search entry carries `type`/`subType` (index written by
 * doc-indexer task 1.6 or later).
 *
 * @returns {Object} Fixture for createMockClient()
 */
function modernFixture() {
	return {
		keywordItems: {
			lambda: [
				{ hash: 'doc1', relevanceScore: 30, typeWeight: 1.0, type: 'documentation', subType: 'guide' },
				{ hash: 'doc2', relevanceScore: 25, typeWeight: 1.0, type: 'documentation', subType: 'parameter' },
				{ hash: 'code1', relevanceScore: 20, typeWeight: 0.8, type: 'code-example', subType: 'function' },
				{ hash: 'tmpl1', relevanceScore: 10, typeWeight: 0.9, type: 'template-pattern', subType: 'resource' }
			]
		},
		metadataItems: {
			doc1: { title: 'Lambda Guide', excerpt: 'guide', type: 'documentation', subType: 'guide', path: 'repo/README.md/lambda' },
			doc2: { title: 'Lambda Parameters', excerpt: 'params', type: 'documentation', subType: 'parameter', path: 'repo/PARAMS.md/lambda' },
			code1: { title: 'Lambda Handler', excerpt: 'code', type: 'code-example', subType: 'function', path: 'repo/src/index.js' },
			tmpl1: { title: 'Lambda Resource', excerpt: 'tmpl', type: 'template-pattern', subType: 'resource', path: 'repo/template.yml' }
		}
	};
}

describe('DocIndex.queryIndex() — type/subType filter push-down', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	// -----------------------------------------------------------------
	// R8.2 — fewer metadata reads when filtered
	// -----------------------------------------------------------------
	it('reads only the matching hashes metadata when a type filter is supplied', async () => {
		const client = createMockClient(modernFixture());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'lambda', type: 'documentation', limit: 10 });

		expect(metadataHashesRead(client).sort()).toEqual(['doc1', 'doc2']);
		expect(result.results.map((r) => r.title)).toEqual(['Lambda Guide', 'Lambda Parameters']);
		expect(result.totalResults).toBe(2);
	});

	it('reads only the matching hashes metadata when a subType filter is supplied', async () => {
		const client = createMockClient(modernFixture());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'lambda', subType: 'guide', limit: 10 });

		expect(metadataHashesRead(client)).toEqual(['doc1']);
		expect(result.results.map((r) => r.title)).toEqual(['Lambda Guide']);
	});

	it('reads only the intersection when both type and subType are supplied', async () => {
		const client = createMockClient(modernFixture());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({
			query: 'lambda', type: 'documentation', subType: 'parameter', limit: 10
		});

		expect(metadataHashesRead(client)).toEqual(['doc2']);
		expect(result.results.map((r) => r.title)).toEqual(['Lambda Parameters']);
	});

	it('reads strictly fewer metadata items when filtered than when unfiltered', async () => {
		const unfilteredClient = createMockClient(modernFixture());
		DocIndex.setDocClient(unfilteredClient);
		await DocIndex.queryIndex({ query: 'lambda', limit: 10 });
		const unfilteredReads = metadataHashesRead(unfilteredClient).length;

		DocIndex.TestHarness.resetClient();
		const filteredClient = createMockClient(modernFixture());
		DocIndex.setDocClient(filteredClient);
		await DocIndex.queryIndex({ query: 'lambda', type: 'documentation', limit: 10 });
		const filteredReads = metadataHashesRead(filteredClient).length;

		expect(unfilteredReads).toBe(4);
		expect(filteredReads).toBeLessThan(unfilteredReads);
	});

	it('reads every candidate when no filter is supplied', async () => {
		const client = createMockClient(modernFixture());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'lambda', limit: 10 });

		expect(metadataHashesRead(client).sort()).toEqual(['code1', 'doc1', 'doc2', 'tmpl1']);
		expect(result.totalResults).toBe(4);
	});

	// -----------------------------------------------------------------
	// R8.5 — membership identical to post-fetch filtering
	// -----------------------------------------------------------------
	it('returns the same membership and ordering as filtering the unfiltered result set', async () => {
		const unfilteredClient = createMockClient(modernFixture());
		DocIndex.setDocClient(unfilteredClient);
		const unfiltered = await DocIndex.queryIndex({ query: 'lambda', limit: 10 });

		DocIndex.TestHarness.resetClient();
		const filteredClient = createMockClient(modernFixture());
		DocIndex.setDocClient(filteredClient);
		const filtered = await DocIndex.queryIndex({ query: 'lambda', type: 'documentation', limit: 10 });

		// Post-fetch filtering of the unfiltered run is the reference behavior.
		const expected = unfiltered.results.filter((r) => r.type === 'documentation');
		expect(filtered.results).toEqual(expected);
		expect(filtered.totalResults).toBe(expected.length);
	});

	it('keeps legacy search entries with no indexed type and lets the post-fetch filter decide', async () => {
		// `legacyDoc`/`legacyCode` were indexed before task 1.6, so their search entries
		// carry no type/subType. They must NOT be dropped before the metadata fetch.
		const fixture = {
			keywordItems: {
				lambda: [
					{ hash: 'legacyDoc', relevanceScore: 30, typeWeight: 1.0 },
					{ hash: 'modernCode', relevanceScore: 25, typeWeight: 0.8, type: 'code-example', subType: 'function' },
					{ hash: 'legacyCode', relevanceScore: 20, typeWeight: 0.8 },
					{ hash: 'modernDoc', relevanceScore: 10, typeWeight: 1.0, type: 'documentation', subType: 'guide' }
				]
			},
			metadataItems: {
				legacyDoc: { title: 'Legacy Guide', excerpt: 'x', type: 'documentation', subType: 'guide', path: 'repo/a.md' },
				modernCode: { title: 'Modern Handler', excerpt: 'x', type: 'code-example', subType: 'function', path: 'repo/b.js' },
				legacyCode: { title: 'Legacy Handler', excerpt: 'x', type: 'code-example', subType: 'function', path: 'repo/c.js' },
				modernDoc: { title: 'Modern Guide', excerpt: 'x', type: 'documentation', subType: 'guide', path: 'repo/d.md' }
			}
		};

		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'lambda', type: 'documentation', limit: 10 });

		// Push-down drops only the known mismatch (modernCode); both legacy hashes are read.
		const read = metadataHashesRead(client);
		expect(read.sort()).toEqual(['legacyCode', 'legacyDoc', 'modernDoc']);
		expect(read).not.toContain('modernCode');

		// Membership is still exactly the documentation entries — legacyCode is removed by
		// the authoritative post-fetch filter, not by push-down.
		expect(result.results.map((r) => r.title)).toEqual(['Legacy Guide', 'Modern Guide']);
		expect(result.totalResults).toBe(2);
	});

	it('adopts a known type when the same hash appears under several keywords', async () => {
		// The first keyword's entry for `mixed` predates task 1.6; the second carries the type.
		const fixture = {
			keywordItems: {
				lambda: [{ hash: 'mixed', relevanceScore: 10, typeWeight: 0.8 }],
				handler: [{ hash: 'mixed', relevanceScore: 5, typeWeight: 0.8, type: 'code-example', subType: 'function' }]
			},
			metadataItems: {
				mixed: { title: 'Mixed Handler', excerpt: 'x', type: 'code-example', subType: 'function', path: 'repo/m.js' }
			}
		};

		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'lambda handler', type: 'documentation', limit: 10 });

		// The known type came from the second keyword entry, so no metadata read is needed.
		expect(metadataHashesRead(client)).toEqual([]);
		expect(result.totalResults).toBe(0);
	});

	it('does not widen the candidate window when filtering (membership unchanged)', async () => {
		// limit=1 => the pre-push-down code fetched the top limit*3 = 3 ranked hashes. Push-down
		// must filter WITHIN that window, not pull additional lower-ranked matches into it.
		const fixture = {
			keywordItems: {
				lambda: [
					{ hash: 'code1', relevanceScore: 40, typeWeight: 0.8, type: 'code-example', subType: 'function' },
					{ hash: 'code2', relevanceScore: 30, typeWeight: 0.8, type: 'code-example', subType: 'function' },
					{ hash: 'doc1', relevanceScore: 20, typeWeight: 1.0, type: 'documentation', subType: 'guide' },
					{ hash: 'doc2', relevanceScore: 10, typeWeight: 1.0, type: 'documentation', subType: 'guide' }
				]
			},
			metadataItems: {
				code1: { title: 'Code One', excerpt: 'x', type: 'code-example', path: 'repo/1.js' },
				code2: { title: 'Code Two', excerpt: 'x', type: 'code-example', path: 'repo/2.js' },
				doc1: { title: 'Doc One', excerpt: 'x', type: 'documentation', path: 'repo/1.md' },
				doc2: { title: 'Doc Two', excerpt: 'x', type: 'documentation', path: 'repo/2.md' }
			}
		};

		const client = createMockClient(fixture);
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'lambda', type: 'documentation', limit: 1 });

		// doc2 sits outside the top-3 window, so it is neither read nor counted — matching
		// the post-fetch-filter behavior exactly.
		expect(metadataHashesRead(client)).toEqual(['doc1']);
		expect(result.totalResults).toBe(1);
		expect(result.results.map((r) => r.title)).toEqual(['Doc One']);
	});

	it('issues no metadata read when push-down eliminates every candidate', async () => {
		const client = createMockClient(modernFixture());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'lambda', type: 'unknown-type', limit: 10 });

		expect(metadataHashesRead(client)).toEqual([]);
		expect(result.results).toHaveLength(0);
		expect(result.totalResults).toBe(0);
		expect(result.suggestions.length).toBeGreaterThan(0);
	});
});

describe('applyIndexedFilterPushDown()', () => {
	const { applyIndexedFilterPushDown } = DocIndex.TestHarness.getInternals();

	const candidates = [
		{ hash: 'a', type: 'documentation', subType: 'guide' },
		{ hash: 'b', type: 'code-example', subType: 'function' },
		{ hash: 'c', type: null, subType: null },
		{ hash: 'd', type: 'documentation', subType: null }
	];

	it('returns the input untouched when no filter is requested', () => {
		expect(applyIndexedFilterPushDown(candidates)).toBe(candidates);
	});

	it('drops only known mismatches for type', () => {
		expect(applyIndexedFilterPushDown(candidates, 'documentation').map((c) => c.hash))
			.toEqual(['a', 'c', 'd']);
	});

	it('drops only known mismatches for subType', () => {
		expect(applyIndexedFilterPushDown(candidates, null, 'guide').map((c) => c.hash))
			.toEqual(['a', 'c', 'd']);
	});

	it('preserves ranked order of the retained candidates', () => {
		expect(applyIndexedFilterPushDown(candidates, 'documentation', 'guide').map((c) => c.hash))
			.toEqual(['a', 'c', 'd']);
	});

	it('treats an absent attribute the same as null (backward compatibility)', () => {
		const legacy = [{ hash: 'legacy' }, { hash: 'modern', type: 'code-example' }];
		expect(applyIndexedFilterPushDown(legacy, 'documentation').map((c) => c.hash))
			.toEqual(['legacy']);
	});
});
