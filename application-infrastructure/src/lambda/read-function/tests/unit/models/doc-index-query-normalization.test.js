/**
 * Unit tests for the query-side normalization repair in `extractQueryKeywords()`
 * (spec 0-0-7-tool-discovery-enhancement, task 2.2).
 *
 * `extractQueryKeywords()` now delegates to the shared `search-common` layer's
 * `normalizeText` (task 2.1) instead of a local implementation that filtered tokens of
 * length <= 2 and used a 14-entry stop-word list. That local policy was stricter than the
 * index side's `MIN_TOKEN_LENGTH = 2`, which made two-character partitions such as
 * `search:s3` and `search:v2` unreachable from the query side.
 *
 * Covers Requirement 6:
 * - 6.2: query-side lookup uses the same normalized-form derivation as index-side.
 * - 6.4: a single-word query that is a suffixed form of an indexed term matches the
 *   indexed term (covered here via the shared `normalizeTerm` suffix table).
 *
 * Validates: Requirements 6.2, 6.4, 15.4
 */

const DocIndex = require('../../../models/doc-index');

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

jest.mock('../../../config', () => ({
	Config: {
		settings: jest.fn(() => ({
			docIndexTable: 'test-doc-index-table',
			github: { userOrgs: ['63klabs'] }
		}))
	}
}));

describe('extractQueryKeywords() — query-side normalization repair', () => {
	const { extractQueryKeywords, SearchCommon } = DocIndex.TestHarness.getInternals();

	// -----------------------------------------------------------------
	// R6.2 / R6.4 — a bare two-character query term is no longer dropped
	// -----------------------------------------------------------------
	it('no longer reduces a bare "s3" query to zero keywords', () => {
		const keywords = extractQueryKeywords('s3');

		expect(keywords.length).toBeGreaterThan(0);
		expect(keywords).toContain('s3');
	});

	it('keeps other two-character index-reachable terms such as "v2"', () => {
		expect(extractQueryKeywords('v2')).toContain('v2');
	});

	it('still drops stop words and empty input', () => {
		expect(extractQueryKeywords('the')).toEqual([]);
		expect(extractQueryKeywords('')).toEqual([]);
	});

	// -----------------------------------------------------------------
	// R6.2 / R6.4 — queryIndex() no longer short-circuits on a bare "s3" query
	// -----------------------------------------------------------------
	it('does not short-circuit queryIndex() with the zero-keyword suggestion for a bare "s3" query', async () => {
		const client = {
			send: jest.fn(async (command) => {
				const name = command.constructor.name;

				if (name === 'GetCommand') {
					return { Item: { pk: 'version:pointer', sk: 'active', version: '20250715T060000' } };
				}

				if (name === 'QueryCommand') {
					// >! Confirms the query actually reached DynamoDB under the 's3' partition
					// >! instead of being short-circuited before any keyword was queried.
					return { Items: [] };
				}

				return {};
			})
		};
		DocIndex.setDocClient(client);

		const result = await DocIndex.queryIndex({ query: 's3', limit: 10 });

		expect(result.suggestions).not.toContain('Try using more specific keywords');

		const queriedPartitions = client.send.mock.calls
			.filter((call) => call[0].constructor.name === 'QueryCommand')
			.map((call) => call[0].input.ExpressionAttributeValues[':pk']);
		expect(queriedPartitions).toContain('search:s3');

		DocIndex.TestHarness.resetClient();
	});

	// -----------------------------------------------------------------
	// R6.2 / R15.4 — index-time and query-time token sets match through the shared module
	// -----------------------------------------------------------------
	it('delegates to the SAME shared normalize module the index side loads', () => {
		// Load the layer module the same way doc-index.js does (same env-var override from
		// jest.setup.js), so this assertion fails if doc-index.js ever stops using the real
		// shared module (e.g. reverts to a local re-implementation).
		const base = process.env.SEARCH_COMMON_LAYER_PATH;
		// eslint-disable-next-line global-require, import/no-dynamic-require
		const layerNormalize = require(`${base}/normalize`);

		expect(SearchCommon.normalizeText).toBe(layerNormalize.normalizeText);
		expect(SearchCommon.normalizeTerm).toBe(layerNormalize.normalizeTerm);
	});

	it('produces query-time token sets equal to the index-time token sets for the same term', () => {
		const base = process.env.SEARCH_COMMON_LAYER_PATH;
		// eslint-disable-next-line global-require, import/no-dynamic-require
		const { normalizeTerm } = require(`${base}/normalize`);

		const terms = ['s3', 'v2', 'cache-data', 'caching', 'templates'];

		for (const term of terms) {
			const queryTokens = extractQueryKeywords(term);
			const indexTokens = normalizeTerm(term);

			expect(queryTokens.sort()).toEqual(indexTokens.sort());
		}
	});
});
