/**
 * Property-Based Tests for Filter Soundness
 *
 * Feature: 0-0-7-tool-discovery-enhancement, Property 4: Filter soundness
 *
 * For any combination of `type`, `subType`, `repository`, `repositoryType`, `namespace`,
 * and `ghusers` (as an `owner` filter), every result `DocIndex.queryIndex()` returns
 * satisfies every supplied filter — on the keyword path (the semantic path is untouched by
 * task 12.1 per design 8.4 and is out of scope here). Equivalently: no filter combination
 * ever EXPANDS the result set relative to a subset of that same combination (adding more
 * filters is monotonically non-expansive).
 *
 * This exercises the authoritative post-fetch filter block (design 7.3) and the
 * `applyIndexedFilterPushDown()` push-down (design 7.3, "Push-down") together, against a
 * small fixed fixture of candidate content so filter-combination assertions stay tractable,
 * following the mocked-DynamoDB-client convention established in
 * `tests/unit/models/doc-index-repo-filters.test.js` (task 12.1).
 *
 * `owner` is NOT exposed on `queryIndex()`'s returned result objects (confirmed by reading
 * the result-mapping block in `models/doc-index.js`: it emits `title`, `excerpt`, `filePath`,
 * `githubUrl`, `type`, `subType`, `relevanceScore`, `repository`, `repositoryType`,
 * `namespace`, `codeExamples`, `context` — no `owner`). Soundness for `ghusers` is therefore
 * asserted indirectly: the returned `totalResults` is cross-checked against the count
 * produced by filtering the known fixture directly by `owner`, which is possible because the
 * fixture's hash -> owner mapping is known up front.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.6
 */

'use strict';

const fc = require('fast-check');

jest.mock('../../config', () => ({
	Config: {
		settings: jest.fn(() => ({
			docIndexTable: 'test-doc-index-table',
			github: { userOrgs: ['63klabs', 'otherorg'] }
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
const KEYWORD = 'cache';

/**
 * Fixed candidate pool. Every candidate is reachable via the single keyword `KEYWORD` so
 * the property space is over WHICH FILTER COMBINATION is applied, not over which candidates
 * exist or whether a given query term matches them (per task guidance). Metadata values are
 * drawn from small, known sets so soundness assertions are tractable.
 *
 * @type {Array<{hash: string, type: string, subType: string, repository: string, repositoryType: string, namespace: string|null, owner: string}>}
 */
const CANDIDATES = [
	{ hash: 'doc1', type: 'documentation', subType: 'guide', repository: 'cache-data', repositoryType: 'package', namespace: null, owner: '63klabs' },
	{ hash: 'doc2', type: 'documentation', subType: 'guide', repository: 'atlantis-mcp', repositoryType: 'mcp', namespace: null, owner: '63klabs' },
	{ hash: 'doc3', type: 'documentation', subType: 'reference', repository: 'cache-data', repositoryType: 'package', namespace: 'v2', owner: 'otherorg' },
	{ hash: 'doc4', type: 'template-pattern', subType: 'parameter', repository: 'cache-data', repositoryType: 'package', namespace: null, owner: '63klabs' },
	{ hash: 'doc5', type: 'template-pattern', subType: 'parameter', repository: 'atlantis-mcp', repositoryType: 'mcp', namespace: 'v2', owner: 'otherorg' },
	{ hash: 'doc6', type: 'code-example', subType: 'function', repository: 'some-starter', repositoryType: 'app-starter', namespace: null, owner: '63klabs' },
	{ hash: 'doc7', type: 'code-example', subType: 'function', repository: 'some-starter', repositoryType: 'app-starter', namespace: 'beta', owner: 'otherorg' }
];

/**
 * Mock DynamoDB Document Client backed by {@link CANDIDATES}, following
 * `doc-index-repo-filters.test.js`'s `createMockClient` convention. All candidates are
 * returned under the single `KEYWORD` search entry (none of `repository`/`repositoryType`/
 * `namespace` is carried on the search entry, matching current indexer behavior per design
 * 7.3) and the content metadata carries the full fixture row, including `type`/`subType`.
 *
 * @returns {{send: jest.Mock}} Mock client
 */
function createMockClient() {
	const keywordItems = {
		[KEYWORD]: CANDIDATES.map((c, i) => ({
			hash: c.hash,
			relevanceScore: CANDIDATES.length - i,
			typeWeight: 1.0
			// >! type/subType/repository/repositoryType/namespace deliberately omitted here
			// >! (unknown at push-down), so the authoritative post-fetch filter below is what
			// >! settles every candidate — matching today's indexer reality (design 7.3).
		}))
	};

	const metadataItems = {};
	for (const c of CANDIDATES) {
		metadataItems[c.hash] = {
			title: `Title ${c.hash}`,
			excerpt: 'excerpt text',
			type: c.type,
			subType: c.subType,
			path: `repo/${c.hash}.md`,
			repository: c.repository,
			repositoryType: c.repositoryType,
			namespace: c.namespace,
			owner: c.owner
		};
	}

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

const TYPES = [...new Set(CANDIDATES.map((c) => c.type))];
const SUBTYPES = [...new Set(CANDIDATES.map((c) => c.subType))];
const REPOSITORIES = [...new Set(CANDIDATES.map((c) => c.repository))];
const REPOSITORY_TYPES = [...new Set(CANDIDATES.map((c) => c.repositoryType))];
const NAMESPACES = [...new Set(CANDIDATES.map((c) => c.namespace).filter((n) => n !== null))];
const OWNERS = [...new Set(CANDIDATES.map((c) => c.owner))];

/**
 * Arbitrary for a single optional filter value: either absent (`undefined`, meaning "no
 * filter supplied") or one of the known fixture values for that field.
 *
 * @param {Array<string>} values - Known fixture values for the field.
 * @returns {fc.Arbitrary<string|undefined>}
 */
function optionalFilterArb(values) {
	return fc.option(fc.constantFrom(...values), { nil: undefined });
}

/**
 * Arbitrary for a `ghusers` filter value: either absent, or a non-empty array drawn from the
 * known fixture owners (deduplicated), mirroring how a real caller supplies `ghusers`.
 */
const ghusersArb = fc.option(
	fc.uniqueArray(fc.constantFrom(...OWNERS), { minLength: 1 }),
	{ nil: undefined }
);

/**
 * Arbitrary for one full filter combination, covering the no-filter case, single filters,
 * and combinations of two or more, since every field is drawn independently and may be
 * `undefined`.
 */
const filterComboArb = fc.record({
	type: optionalFilterArb(TYPES),
	subType: optionalFilterArb(SUBTYPES),
	repository: optionalFilterArb(REPOSITORIES),
	repositoryType: optionalFilterArb(REPOSITORY_TYPES),
	namespace: optionalFilterArb(NAMESPACES),
	ghusers: ghusersArb
});

/**
 * Compute the expected result count for a filter combination by filtering the known fixture
 * directly, independent of `queryIndex()`. Used to assert `ghusers`/`owner` soundness
 * indirectly, since `owner` is not exposed on returned result objects.
 *
 * @param {Object} filters - A filter combination as produced by {@link filterComboArb}.
 * @returns {Array<Object>} The fixture candidates that satisfy every supplied filter.
 */
function expectedMatches(filters) {
	return CANDIDATES.filter((c) => {
		if (filters.type && c.type !== filters.type) return false;
		if (filters.subType && c.subType !== filters.subType) return false;
		if (filters.repository && c.repository !== filters.repository) return false;
		if (filters.repositoryType && c.repositoryType !== filters.repositoryType) return false;
		if (filters.namespace && c.namespace !== filters.namespace) return false;
		if (Array.isArray(filters.ghusers) && filters.ghusers.length > 0 && !filters.ghusers.includes(c.owner)) return false;
		return true;
	});
}

describe('Feature: 0-0-7-tool-discovery-enhancement, Property 4: Filter soundness', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	/**
	 * **Validates: Requirements 5.1, 5.2, 5.3, 5.6**
	 *
	 * Soundness: for any filter combination (including none, a single filter, and
	 * combinations of two or more), every result in `result.results` satisfies every
	 * requested filter. `type`/`subType`/`repository`/`repositoryType`/`namespace` are
	 * checked directly against the returned result fields; `ghusers` is checked indirectly
	 * via the known-fixture match count, since `owner` is not part of the result shape.
	 * A filter matching nothing still returns a successful empty result (R5.2), never an
	 * error.
	 */
	test('every returned result satisfies every supplied filter, for any filter combination', async () => {
		await fc.assert(
			fc.asyncProperty(filterComboArb, async (filters) => {
				const client = createMockClient();
				DocIndex.setDocClient(client);

				const result = await DocIndex.queryIndex({
					query: KEYWORD,
					limit: CANDIDATES.length,
					...filters
				});

				// The response is always successful-shaped, even on a no-match filter (R5.2).
				expect(Array.isArray(result.results)).toBe(true);
				expect(typeof result.totalResults).toBe('number');

				// Direct soundness: every field the result shape carries is checked against
				// what was actually requested.
				for (const r of result.results) {
					if (filters.type) expect(r.type).toBe(filters.type);
					if (filters.subType) expect(r.subType).toBe(filters.subType);
					if (filters.repository) expect(r.repository).toBe(filters.repository);
					if (filters.repositoryType) expect(r.repositoryType).toBe(filters.repositoryType);
					if (filters.namespace) expect(r.namespace).toBe(filters.namespace);
				}

				// Indirect soundness for ghusers/owner: totalResults must equal the count of
				// fixture candidates that satisfy every supplied filter (including ghusers),
				// since no returned result can contradict a supplied owner filter without
				// pushing totalResults above that bound.
				const expected = expectedMatches(filters);
				expect(result.totalResults).toBe(expected.length);

				DocIndex.TestHarness.resetClient();
			}),
			{ numRuns: 100 }
		);
	});

	/**
	 * **Validates: Requirements 5.1, 5.6**
	 *
	 * No expansion: adding MORE filters (going from a filter combination to a strict
	 * superset of it) never increases `totalResults`, against the SAME underlying fixture.
	 * This is the monotonic-non-expansiveness half of filter soundness — a filter can only
	 * narrow or leave unchanged the result set, never widen it.
	 */
	test('adding more filters never increases totalResults (monotonic non-expansion)', async () => {
		await fc.assert(
			fc.asyncProperty(filterComboArb, filterComboArb, async (base, extra) => {
				// Build a strict (or equal) superset of `base` by only ever ADDING fields that
				// `base` left unset — an already-set field in `base` is never overwritten, so
				// `superset` is guaranteed to request everything `base` requested, plus
				// possibly more.
				const superset = { ...base };
				for (const key of Object.keys(extra)) {
					if (base[key] === undefined && extra[key] !== undefined) {
						superset[key] = extra[key];
					}
				}

				const client = createMockClient();
				DocIndex.setDocClient(client);
				const baseResult = await DocIndex.queryIndex({ query: KEYWORD, limit: CANDIDATES.length, ...base });
				DocIndex.TestHarness.resetClient();

				const client2 = createMockClient();
				DocIndex.setDocClient(client2);
				const supersetResult = await DocIndex.queryIndex({ query: KEYWORD, limit: CANDIDATES.length, ...superset });
				DocIndex.TestHarness.resetClient();

				expect(supersetResult.totalResults).toBeLessThanOrEqual(baseResult.totalResults);
			}),
			{ numRuns: 100 }
		);
	});
});
