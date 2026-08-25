/**
 * Unit Tests for Documentation Index DAO — DynamoDB Integration
 *
 * Tests the DynamoDB-backed documentation index query functions:
 * - getActiveVersion() — version pointer query
 * - getMainIndex() — main index entry retrieval
 * - queryIndex() — keyword search with relevance ranking, type filtering, limits
 *
 * Uses the setDocClient() pattern to inject a mock DynamoDB Document Client.
 */

const DocIndex = require('../../../models/doc-index');
const { Config } = require('../../../config');

// Mock Config
jest.mock('../../../config', () => ({
	Config: {
		settings: jest.fn(() => ({
			docIndexTable: 'test-doc-index-table',
			github: { userOrgs: ['63klabs'] }
		}))
	}
}));

// Mock DebugAndLog
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

/**
 * Create a mock DynamoDB Document Client that routes GetCommand, QueryCommand, and
 * BatchGetCommand to provided handler functions.
 *
 * @param {Object} handlers - { get: fn(params), query: fn(params), batchGet: fn(params) }
 * @returns {Object} Mock client with send() method
 */
function createMockClient(handlers = {}) {
	return {
		send: jest.fn(async (command) => {
			const commandName = command.constructor.name;
			if (commandName === 'GetCommand' && handlers.get) {
				return handlers.get(command.input);
			}
			if (commandName === 'QueryCommand' && handlers.query) {
				return handlers.query(command.input);
			}
			if (commandName === 'BatchGetCommand' && handlers.batchGet) {
				return handlers.batchGet(command.input);
			}
			return {};
		})
	};
}

describe('Documentation Index DAO — DynamoDB Integration', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	// ---------------------------------------------------------------
	// getActiveVersion
	// ---------------------------------------------------------------
	describe('getActiveVersion()', () => {
		it('should return version when pointer exists', async () => {
			const mockClient = createMockClient({
				get: (params) => {
					if (params.Key.pk === 'version:pointer' && params.Key.sk === 'active') {
						return { Item: { pk: 'version:pointer', sk: 'active', version: '20250715T060000' } };
					}
					return {};
				}
			});
			DocIndex.setDocClient(mockClient);

			const version = await DocIndex.getActiveVersion('test-doc-index-table');
			expect(version).toBe('20250715T060000');
			expect(mockClient.send).toHaveBeenCalledTimes(1);
		});

		it('should return null when no pointer exists', async () => {
			const mockClient = createMockClient({
				get: () => ({})
			});
			DocIndex.setDocClient(mockClient);

			const version = await DocIndex.getActiveVersion('test-doc-index-table');
			expect(version).toBeNull();
		});

		it('should return null on DynamoDB error', async () => {
			const mockClient = createMockClient({
				get: () => { throw new Error('DynamoDB unavailable'); }
			});
			DocIndex.setDocClient(mockClient);

			const version = await DocIndex.getActiveVersion('test-doc-index-table');
			expect(version).toBeNull();
		});
	});

	// ---------------------------------------------------------------
	// getMainIndex
	// ---------------------------------------------------------------
	describe('getMainIndex()', () => {
		it('should return entries array when index exists', async () => {
			const entries = [
				{ hash: 'abc123', path: '63klabs/repo/README.md/install', type: 'documentation', title: 'Install' },
				{ hash: 'def456', path: '63klabs/repo/README.md/usage', type: 'documentation', title: 'Usage' }
			];

			const mockClient = createMockClient({
				get: (params) => {
					if (params.Key.pk === 'mainindex:20250715T060000' && params.Key.sk === 'entries') {
						return { Item: { entries, entryCount: 2 } };
					}
					return {};
				}
			});
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.getMainIndex('test-doc-index-table', '20250715T060000');
			expect(result).toHaveLength(2);
			expect(result[0].hash).toBe('abc123');
		});

		it('should return empty array when no index exists', async () => {
			const mockClient = createMockClient({
				get: () => ({})
			});
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.getMainIndex('test-doc-index-table', '20250715T060000');
			expect(result).toEqual([]);
		});

		it('should return empty array on DynamoDB error', async () => {
			const mockClient = createMockClient({
				get: () => { throw new Error('DynamoDB error'); }
			});
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.getMainIndex('test-doc-index-table', '20250715T060000');
			expect(result).toEqual([]);
		});
	});

	// ---------------------------------------------------------------
	// queryIndex
	// ---------------------------------------------------------------
	describe('queryIndex()', () => {
		/**
		 * Helper: build a mock client that serves a version pointer, keyword
		 * search results, and content metadata.
		 */
		function buildSearchMockClient({
			version = '20250715T060000',
			keywordItems = {},
			metadataItems = {},
			reverseBatchOrder = false,
			tableName = 'test-doc-index-table'
		} = {}) {
			return createMockClient({
				get: (params) => {
					// Version pointer
					if (params.Key.pk === 'version:pointer' && params.Key.sk === 'active') {
						if (!version) return {};
						return { Item: { pk: 'version:pointer', sk: 'active', version } };
					}
					return {};
				},
				query: (params) => {
					// Keyword search
					const keyword = params.ExpressionAttributeValues[':pk'].replace('search:', '');
					return { Items: keywordItems[keyword] || [] };
				},
				// Content metadata is read in batches (spec 0-0-6 task 2.2). DynamoDB returns
				// items in arbitrary order and omits keys with no stored item.
				batchGet: (params) => {
					const keys = params.RequestItems[tableName].Keys;
					const items = keys
						.map((key) => {
							const item = metadataItems[`${key.pk}|${key.sk}`];
							return item ? { ...item, pk: key.pk, sk: key.sk } : null;
						})
						.filter((item) => item !== null);
					if (reverseBatchOrder) {
						items.reverse();
					}
					return { Responses: { [tableName]: items } };
				}
			});
		}

		it('should return results sorted by relevance', async () => {
			const mockClient = buildSearchMockClient({
				keywordItems: {
					'cache': [
						{ hash: 'aaa', relevanceScore: 10, typeWeight: 1.0 },
						{ hash: 'bbb', relevanceScore: 20, typeWeight: 1.0 }
					],
					'data': [
						{ hash: 'aaa', relevanceScore: 5, typeWeight: 1.0 },
						{ hash: 'ccc', relevanceScore: 3, typeWeight: 1.0 }
					]
				},
				metadataItems: {
					'content:bbb|v:20250715T060000:metadata': {
						title: 'Cache Data Guide', excerpt: 'How to use cache-data', type: 'documentation', subType: 'guide', path: 'repo/README.md/cache'
					},
					'content:aaa|v:20250715T060000:metadata': {
						title: 'Installation', excerpt: 'Install cache-data', type: 'documentation', subType: 'guide', path: 'repo/README.md/install'
					},
					'content:ccc|v:20250715T060000:metadata': {
						title: 'Data Patterns', excerpt: 'Data access patterns', type: 'code-example', subType: 'function', path: 'repo/src/lib/dao.js'
					}
				}
			});
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: 'cache data', limit: 10 });

			expect(result.results.length).toBe(3);
			expect(result.totalResults).toBe(3);
			// Keyword scores: bbb 20, aaa 10+5=15, ccc 3. bbb's title 'Cache Data Guide'
			// contains the full query phrase 'cache data', so it also earns the query-time
			// exact-phrase boost of 20 (spec 0-0-6 task 4.1, R9.1) => 40.
			expect(result.results[0].title).toBe('Cache Data Guide');
			expect(result.results[0].relevanceScore).toBe(40);
			expect(result.results[1].relevanceScore).toBe(15);
			expect(result.results[2].relevanceScore).toBe(3);
		});

		// -----------------------------------------------------------
		// Batched metadata enrichment (spec 0-0-6 task 2.2, R1.1/R1.4/R1.5)
		// -----------------------------------------------------------
		it('should read metadata in one batched request instead of one GetItem per hash', async () => {
			const mockClient = buildSearchMockClient({
				keywordItems: {
					'cache': [
						{ hash: 'aaa', relevanceScore: 10, typeWeight: 1.0 },
						{ hash: 'bbb', relevanceScore: 20, typeWeight: 1.0 },
						{ hash: 'ccc', relevanceScore: 5, typeWeight: 1.0 }
					]
				},
				metadataItems: {
					'content:aaa|v:20250715T060000:metadata': { title: 'A', excerpt: 'a', type: 'documentation', path: 'repo/a.md' },
					'content:bbb|v:20250715T060000:metadata': { title: 'B', excerpt: 'b', type: 'documentation', path: 'repo/b.md' },
					'content:ccc|v:20250715T060000:metadata': { title: 'C', excerpt: 'c', type: 'documentation', path: 'repo/c.md' }
				}
			});
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: 'cache', limit: 10 });

			expect(result.results).toHaveLength(3);

			const commandNames = mockClient.send.mock.calls.map((call) => call[0].constructor.name);
			// Exactly one batched metadata read for all three hashes.
			expect(commandNames.filter((name) => name === 'BatchGetCommand')).toHaveLength(1);
			// The only GetItem is the version pointer — no per-hash metadata GetItem remains.
			const getKeys = mockClient.send.mock.calls
				.filter((call) => call[0].constructor.name === 'GetCommand')
				.map((call) => call[0].input.Key);
			expect(getKeys).toEqual([{ pk: 'version:pointer', sk: 'active' }]);

			const batchKeys = mockClient.send.mock.calls
				.find((call) => call[0].constructor.name === 'BatchGetCommand')[0]
				.input.RequestItems['test-doc-index-table'].Keys;
			expect(batchKeys).toHaveLength(3);
			expect(batchKeys).toContainEqual({ pk: 'content:bbb', sk: 'v:20250715T060000:metadata' });
		});

		it('should preserve ranked ordering when the batch returns items out of order', async () => {
			const options = {
				keywordItems: {
					'cache': [
						{ hash: 'aaa', relevanceScore: 10, typeWeight: 1.0 },
						{ hash: 'bbb', relevanceScore: 20, typeWeight: 1.0 }
					],
					'data': [
						{ hash: 'aaa', relevanceScore: 5, typeWeight: 1.0 },
						{ hash: 'ccc', relevanceScore: 3, typeWeight: 1.0 }
					]
				},
				metadataItems: {
					'content:bbb|v:20250715T060000:metadata': { title: 'Cache Data Guide', excerpt: 'x', type: 'documentation', path: 'repo/b.md' },
					'content:aaa|v:20250715T060000:metadata': { title: 'Installation', excerpt: 'x', type: 'documentation', path: 'repo/a.md' },
					'content:ccc|v:20250715T060000:metadata': { title: 'Data Patterns', excerpt: 'x', type: 'code-example', path: 'repo/c.md' }
				}
			};

			DocIndex.setDocClient(buildSearchMockClient(options));
			const inOrder = await DocIndex.queryIndex({ query: 'cache data', limit: 10 });

			DocIndex.TestHarness.resetClient();
			DocIndex.setDocClient(buildSearchMockClient({ ...options, reverseBatchOrder: true }));
			const outOfOrder = await DocIndex.queryIndex({ query: 'cache data', limit: 10 });

			// Ordering comes from the pre-fetch ranking, not the batch response order.
			expect(outOfOrder.results.map((r) => r.title)).toEqual(['Cache Data Guide', 'Installation', 'Data Patterns']);
			// bbb: 20 + the 20-point exact-phrase boost ('Cache Data Guide' contains
			// 'cache data') = 40 (spec 0-0-6 task 4.1, R9.1).
			expect(outOfOrder.results.map((r) => r.relevanceScore)).toEqual([40, 15, 3]);
			expect(outOfOrder.results).toEqual(inOrder.results);
		});

		it('should omit ranked hashes whose metadata item is missing', async () => {
			const mockClient = buildSearchMockClient({
				keywordItems: {
					'cache': [
						{ hash: 'present', relevanceScore: 10, typeWeight: 1.0 },
						{ hash: 'missing', relevanceScore: 20, typeWeight: 1.0 }
					]
				},
				metadataItems: {
					'content:present|v:20250715T060000:metadata': { title: 'Present', excerpt: 'x', type: 'documentation', path: 'repo/p.md' }
				}
			});
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: 'cache', limit: 10 });

			expect(result.results).toHaveLength(1);
			expect(result.totalResults).toBe(1);
			expect(result.results[0].title).toBe('Present');
		});

		it('should return empty results with suggestion when no active version', async () => {
			const mockClient = buildSearchMockClient({ version: null });
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: 'cache data' });

			expect(result.results).toHaveLength(0);
			expect(result.suggestions.length).toBeGreaterThan(0);
			expect(result.suggestions[0]).toContain('indexer');
		});

		it('should filter by type', async () => {
			const mockClient = buildSearchMockClient({
				keywordItems: {
					'lambda': [
						{ hash: 'doc1', relevanceScore: 10, typeWeight: 1.0 },
						{ hash: 'code1', relevanceScore: 8, typeWeight: 0.8 }
					]
				},
				metadataItems: {
					'content:doc1|v:20250715T060000:metadata': {
						title: 'Lambda Guide', excerpt: 'How to use Lambda', type: 'documentation', subType: 'guide', path: 'repo/README.md/lambda'
					},
					'content:code1|v:20250715T060000:metadata': {
						title: 'Lambda Handler', excerpt: 'Handler code', type: 'code-example', subType: 'function', path: 'repo/src/index.js'
					}
				}
			});
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: 'lambda', type: 'documentation' });

			expect(result.results).toHaveLength(1);
			expect(result.results[0].type).toBe('documentation');
		});

		it('should handle empty query', async () => {
			const mockClient = buildSearchMockClient();
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: '' });

			expect(result.results).toHaveLength(0);
			expect(result.suggestions).toContain('Please provide a search query');
		});

		it('should handle query with only stop words', async () => {
			const mockClient = buildSearchMockClient();
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: 'the and for' });

			expect(result.results).toHaveLength(0);
			expect(result.suggestions.length).toBeGreaterThan(0);
		});

		it('should limit results', async () => {
			const keywordItems = {
				'template': Array.from({ length: 5 }, (_, i) => ({
					hash: `h${i}`, relevanceScore: 10 - i, typeWeight: 1.0
				}))
			};
			const metadataItems = {};
			for (let i = 0; i < 5; i++) {
				metadataItems[`content:h${i}|v:20250715T060000:metadata`] = {
					title: `Template ${i}`, excerpt: `Template ${i} desc`, type: 'documentation', subType: 'guide', path: `repo/t${i}.md`
				};
			}

			const mockClient = buildSearchMockClient({ keywordItems, metadataItems });
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: 'template', limit: 2 });

			expect(result.results).toHaveLength(2);
			expect(result.totalResults).toBe(5);
		});

		it('should return excerpt truncated to 200 characters', async () => {
			const longExcerpt = 'A'.repeat(300);
			const mockClient = buildSearchMockClient({
				keywordItems: {
					'long': [{ hash: 'long1', relevanceScore: 10, typeWeight: 1.0 }]
				},
				metadataItems: {
					'content:long1|v:20250715T060000:metadata': {
						title: 'Long Content', excerpt: longExcerpt, type: 'documentation', subType: 'guide', path: 'repo/long.md'
					}
				}
			});
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: 'long content' });

			expect(result.results[0].excerpt.length).toBeLessThanOrEqual(200);
		});

		it('should provide suggestions when no results found', async () => {
			const mockClient = buildSearchMockClient({
				keywordItems: {}
			});
			DocIndex.setDocClient(mockClient);

			const result = await DocIndex.queryIndex({ query: 'nonexistent keyword' });

			expect(result.results).toHaveLength(0);
			expect(result.suggestions.length).toBeGreaterThan(0);
		});
	});
});
