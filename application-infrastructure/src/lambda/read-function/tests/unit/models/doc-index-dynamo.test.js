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
 * Create a mock DynamoDB Document Client that routes GetCommand and QueryCommand
 * to provided handler functions.
 *
 * @param {Object} handlers - { get: fn(params), query: fn(params) }
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
		function buildSearchMockClient({ version = '20250715T060000', keywordItems = {}, metadataItems = {} } = {}) {
			return createMockClient({
				get: (params) => {
					// Version pointer
					if (params.Key.pk === 'version:pointer' && params.Key.sk === 'active') {
						if (!version) return {};
						return { Item: { pk: 'version:pointer', sk: 'active', version } };
					}
					// Content metadata
					const metaKey = `${params.Key.pk}|${params.Key.sk}`;
					if (metadataItems[metaKey]) {
						return { Item: metadataItems[metaKey] };
					}
					return {};
				},
				query: (params) => {
					// Keyword search
					const keyword = params.ExpressionAttributeValues[':pk'].replace('search:', '');
					return { Items: keywordItems[keyword] || [] };
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
			// bbb has score 20, aaa has 10+5=15, ccc has 3
			expect(result.results[0].title).toBe('Cache Data Guide');
			expect(result.results[0].relevanceScore).toBe(20);
			expect(result.results[1].relevanceScore).toBe(15);
			expect(result.results[2].relevanceScore).toBe(3);
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
