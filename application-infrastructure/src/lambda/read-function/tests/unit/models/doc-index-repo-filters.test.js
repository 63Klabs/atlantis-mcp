/**
 * Unit tests for `repository`/`repositoryType`/`namespace`/`ghusers`-as-`owner` filters in
 * DocIndex.queryIndex() (spec 0-0-7-tool-discovery-enhancement, task 12.1).
 *
 * Covers Requirement 5:
 * - 5.1: `repository`/`repositoryType`/`namespace` narrow results to sections whose stored
 *   metadata matches.
 * - 5.2: a filter matching nothing returns a successful empty result, not an error.
 * - 5.3: `ghusers` is honored as an ACTUAL `owner` filter on returned results, in addition
 *   to its pre-existing crawl-scope role (restricting `conn.host`, exercised in
 *   `services/documentation.js` tests, not here).
 * - 5.7: push-down must not shrink the candidate window below the requested limit when the
 *   filtered attribute is not carried on search entries (push-down is a no-op for these
 *   three fields today; the authoritative post-fetch filter does the narrowing).
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
 * A fixture where none of `repository`/`repositoryType`/`namespace`/`owner` is carried on
 * the search-keyword entries (today's reality per design 7.3) but IS carried on content
 * metadata.
 */
function fixtureWithRepoMetadata() {
	return {
		keywordItems: {
			cache: [
				{ hash: 'doc1', relevanceScore: 30, typeWeight: 1.0, type: 'documentation', subType: 'guide' },
				{ hash: 'doc2', relevanceScore: 25, typeWeight: 1.0, type: 'documentation', subType: 'guide' },
				{ hash: 'doc3', relevanceScore: 20, typeWeight: 1.0, type: 'documentation', subType: 'guide' }
			]
		},
		metadataItems: {
			doc1: {
				title: 'Cache Data Install', excerpt: 'x', type: 'documentation', subType: 'guide',
				path: 'repo/README.md', repository: 'cache-data', repositoryType: 'package',
				namespace: null, owner: '63klabs'
			},
			doc2: {
				title: 'Atlantis MCP Overview', excerpt: 'x', type: 'documentation', subType: 'guide',
				path: 'repo/README.md', repository: 'atlantis-mcp', repositoryType: 'mcp',
				namespace: null, owner: '63klabs'
			},
			doc3: {
				title: 'Other Org Cache Notes', excerpt: 'x', type: 'documentation', subType: 'guide',
				path: 'repo/README.md', repository: 'cache-data', repositoryType: 'package',
				namespace: 'v2', owner: 'otherorg'
			}
		}
	};
}

describe('DocIndex.queryIndex() — repository/repositoryType/namespace filters (R5.1, R5.2, R5.7)', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	it('narrows results to the matching repository', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', repository: 'cache-data', limit: 10 });

		expect(result.results.map((r) => r.title).sort()).toEqual(['Cache Data Install', 'Other Org Cache Notes']);
		expect(result.totalResults).toBe(2);
	});

	it('narrows results to the matching repositoryType', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', repositoryType: 'mcp', limit: 10 });

		expect(result.results.map((r) => r.title)).toEqual(['Atlantis MCP Overview']);
		expect(result.totalResults).toBe(1);
	});

	it('narrows results to the matching namespace', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', namespace: 'v2', limit: 10 });

		expect(result.results.map((r) => r.title)).toEqual(['Other Org Cache Notes']);
		expect(result.totalResults).toBe(1);
	});

	it('combines repository and repositoryType filters', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({
			query: 'cache', repository: 'cache-data', repositoryType: 'package', limit: 10
		});

		expect(result.results.map((r) => r.title).sort()).toEqual(['Cache Data Install', 'Other Org Cache Notes']);
	});

	// -----------------------------------------------------------------
	// R5.2 — no-match returns a successful empty result, not an error
	// -----------------------------------------------------------------
	it('returns a successful empty result when the repository filter matches nothing', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', repository: 'does-not-exist', limit: 10 });

		expect(result.results).toEqual([]);
		expect(result.totalResults).toBe(0);
		expect(Array.isArray(result.suggestions)).toBe(true);
	});

	it('returns a successful empty result when the repositoryType filter matches nothing', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', repositoryType: 'app-starter', limit: 10 });

		expect(result.results).toEqual([]);
		expect(result.totalResults).toBe(0);
	});

	it('returns a successful empty result when the namespace filter matches nothing', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', namespace: 'does-not-exist', limit: 10 });

		expect(result.results).toEqual([]);
		expect(result.totalResults).toBe(0);
	});

	// -----------------------------------------------------------------
	// R5.7 — push-down is a no-op for these fields today (not carried on search entries),
	// so every candidate still reaches the authoritative post-fetch filter.
	// -----------------------------------------------------------------
	it('does not drop any candidate at push-down for repository/repositoryType/namespace (not carried on search entries today)', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', repository: 'cache-data', limit: 10 });

		// All 3 metadata hashes were read (push-down retained every candidate); the
		// authoritative post-fetch filter is what narrowed to 2.
		const batchGetCalls = client.send.mock.calls.filter((c) => c[0].constructor.name === 'BatchGetCommand');
		const readHashes = batchGetCalls.flatMap((c) => c[0].input.RequestItems[TABLE].Keys).map((k) => k.pk.slice('content:'.length));
		expect(readHashes.sort()).toEqual(['doc1', 'doc2', 'doc3']);
		expect(result.totalResults).toBe(2);
	});
});

describe('DocIndex.queryIndex() — ghusers as an owner filter (R5.3)', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	it('narrows RETURNED results to sections whose owner is in the supplied ghusers set', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', ghusers: ['63klabs'], limit: 10 });

		expect(result.results.map((r) => r.title).sort()).toEqual(['Atlantis MCP Overview', 'Cache Data Install']);
		expect(result.totalResults).toBe(2);
	});

	it('returns a successful empty result when no section owner is in the supplied ghusers set', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', ghusers: ['nonexistent-org'], limit: 10 });

		expect(result.results).toEqual([]);
		expect(result.totalResults).toBe(0);
	});

	it('does not filter by owner when ghusers is omitted (unchanged default behavior)', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 'cache', limit: 10 });

		expect(result.totalResults).toBe(3);
	});

	it('combines the owner filter with a repository filter', async () => {
		const client = createMockClient(fixtureWithRepoMetadata());
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({
			query: 'cache', repository: 'cache-data', ghusers: ['63klabs'], limit: 10
		});

		expect(result.results.map((r) => r.title)).toEqual(['Cache Data Install']);
		expect(result.totalResults).toBe(1);
	});
});

describe('applyIndexedFilterPushDown() — extended to repository/repositoryType/namespace', () => {
	const { applyIndexedFilterPushDown } = DocIndex.TestHarness.getInternals();

	const candidates = [
		{ hash: 'a', type: 'documentation', subType: 'guide', repository: 'cache-data', repositoryType: 'package', namespace: null },
		{ hash: 'b', type: 'documentation', subType: 'guide', repository: 'atlantis-mcp', repositoryType: 'mcp', namespace: null },
		{ hash: 'c', type: 'documentation', subType: 'guide', repository: null, repositoryType: null, namespace: null }
	];

	it('returns the input untouched when no filter is requested', () => {
		expect(applyIndexedFilterPushDown(candidates)).toBe(candidates);
	});

	it('drops only known repository mismatches, retaining unknown (null) values', () => {
		const kept = applyIndexedFilterPushDown(candidates, undefined, undefined, 'cache-data').map((c) => c.hash);
		expect(kept).toEqual(['a', 'c']);
	});

	it('drops only known repositoryType mismatches, retaining unknown (null) values', () => {
		const kept = applyIndexedFilterPushDown(candidates, undefined, undefined, undefined, 'mcp').map((c) => c.hash);
		expect(kept).toEqual(['b', 'c']);
	});

	it('drops only known namespace mismatches, retaining unknown (null) values', () => {
		const kept = applyIndexedFilterPushDown(candidates, undefined, undefined, undefined, undefined, 'v2').map((c) => c.hash);
		// Every candidate's namespace is null (unknown) here, so none is known to mismatch.
		expect(kept).toEqual(['a', 'b', 'c']);
	});
});
