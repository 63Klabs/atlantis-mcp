/**
 * Unit tests for the shared batched metadata reader (spec 0-0-6, task 2.1):
 * DocIndex.batchGetMetadata(tableName, version, hashes).
 *
 * Covers Requirement 1:
 * - Builds content:{hash}/v:{version}:metadata keys and returns a hash -> item map
 * - Chunks requests at the 100-key BatchGetItem limit
 * - Retries only UnprocessedKeys with a bounded number of attempts (no unbounded loop)
 * - Omits hashes with no stored metadata rather than failing the request
 * - Returns an empty map (no reads) for empty/invalid input or a missing version
 * - Degrades gracefully on a batch request error
 *
 * Uses the setDocClient() injection pattern (mirrors doc-index-content-metadata.test.js).
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

/**
 * Build a metadata item for a hash in the shape DynamoDB would return it (with its key).
 *
 * @param {string} hash - Content hash
 * @param {string} version - Index version
 * @returns {Object} Metadata item
 */
function metaItem(hash, version = 'v3') {
	return {
		pk: `content:${hash}`,
		sk: `v:${version}:metadata`,
		title: `Title ${hash}`,
		type: 'documentation'
	};
}

/**
 * Create a mock DynamoDB Document Client that routes BatchGetCommand to a handler.
 *
 * @param {function} handler - fn(requestItems, tableName) -> { Responses, UnprocessedKeys }
 * @returns {Object} Mock client with a jest.fn() send()
 */
function createMockClient(handler) {
	return {
		send: jest.fn(async (command) => {
			if (command.constructor.name === 'BatchGetCommand') {
				return handler(command.input.RequestItems, command.input);
			}
			return {};
		})
	};
}

describe('DocIndex.batchGetMetadata()', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	it('returns a hash -> item map and reads the correct content/version keys', async () => {
		const seenKeys = [];
		const client = createMockClient((requestItems) => {
			const keys = requestItems['test-doc-index-table'].Keys;
			seenKeys.push(...keys);
			return {
				Responses: {
					'test-doc-index-table': keys.map((k) => metaItem(k.pk.slice('content:'.length)))
				}
			};
		});
		DocIndex.setDocClient(client);

		const map = await DocIndex.batchGetMetadata('test-doc-index-table', 'v3', ['h1', 'h2']);

		expect(Object.keys(map).sort()).toEqual(['h1', 'h2']);
		expect(map.h1.title).toBe('Title h1');
		// Keys use the correct content/version-metadata pattern.
		expect(seenKeys).toContainEqual({ pk: 'content:h1', sk: 'v:v3:metadata' });
		expect(seenKeys).toContainEqual({ pk: 'content:h2', sk: 'v:v3:metadata' });
	});

	it('chunks requests at the 100-key BatchGetItem limit', async () => {
		const chunkSizes = [];
		const client = createMockClient((requestItems) => {
			const keys = requestItems['test-doc-index-table'].Keys;
			chunkSizes.push(keys.length);
			return {
				Responses: {
					'test-doc-index-table': keys.map((k) => metaItem(k.pk.slice('content:'.length)))
				}
			};
		});
		DocIndex.setDocClient(client);

		const hashes = Array.from({ length: 150 }, (_, i) => `h${i}`);
		const map = await DocIndex.batchGetMetadata('test-doc-index-table', 'v3', hashes);

		// Two chunks: 100 + 50, both within the limit.
		expect(client.send).toHaveBeenCalledTimes(2);
		expect(chunkSizes.sort((a, b) => a - b)).toEqual([50, 100]);
		expect(Object.keys(map)).toHaveLength(150);
	});

	it('retries only UnprocessedKeys and resolves them on a later attempt', async () => {
		let call = 0;
		const client = createMockClient((requestItems) => {
			const keys = requestItems['test-doc-index-table'].Keys;
			call++;
			if (call === 1) {
				// Process h1; leave h2 unprocessed for a retry.
				return {
					Responses: { 'test-doc-index-table': [metaItem('h1')] },
					UnprocessedKeys: {
						'test-doc-index-table': { Keys: [{ pk: 'content:h2', sk: 'v:v3:metadata' }] }
					}
				};
			}
			return { Responses: { 'test-doc-index-table': [metaItem('h2')] } };
		});
		DocIndex.setDocClient(client);

		const map = await DocIndex.batchGetMetadata('test-doc-index-table', 'v3', ['h1', 'h2']);

		expect(client.send).toHaveBeenCalledTimes(2);
		expect(Object.keys(map).sort()).toEqual(['h1', 'h2']);
	});

	it('bounds UnprocessedKeys retries (does not loop forever)', async () => {
		const client = createMockClient(() => ({
			// Always return the same key as unprocessed.
			Responses: { 'test-doc-index-table': [] },
			UnprocessedKeys: {
				'test-doc-index-table': { Keys: [{ pk: 'content:h1', sk: 'v:v3:metadata' }] }
			}
		}));
		DocIndex.setDocClient(client);

		const map = await DocIndex.batchGetMetadata('test-doc-index-table', 'v3', ['h1']);

		// Capped at the bounded attempt limit (3); never resolves h1.
		expect(client.send).toHaveBeenCalledTimes(3);
		expect(map).toEqual({});
	});

	it('omits hashes that have no stored metadata', async () => {
		const client = createMockClient((requestItems) => {
			const keys = requestItems['test-doc-index-table'].Keys;
			// Only return an item for h1; h2 and h3 have no metadata.
			return {
				Responses: {
					'test-doc-index-table': keys
						.filter((k) => k.pk === 'content:h1')
						.map((k) => metaItem(k.pk.slice('content:'.length)))
				}
			};
		});
		DocIndex.setDocClient(client);

		const map = await DocIndex.batchGetMetadata('test-doc-index-table', 'v3', ['h1', 'h2', 'h3']);

		expect(Object.keys(map)).toEqual(['h1']);
	});

	it('deduplicates repeated hashes before issuing the request', async () => {
		const client = createMockClient((requestItems) => {
			const keys = requestItems['test-doc-index-table'].Keys;
			return {
				Responses: {
					'test-doc-index-table': keys.map((k) => metaItem(k.pk.slice('content:'.length)))
				}
			};
		});
		DocIndex.setDocClient(client);

		await DocIndex.batchGetMetadata('test-doc-index-table', 'v3', ['h1', 'h1', 'h1']);

		const keys = client.send.mock.calls[0][0].input.RequestItems['test-doc-index-table'].Keys;
		expect(keys).toHaveLength(1);
	});

	it('returns an empty map with no reads for empty/invalid input', async () => {
		const client = createMockClient(() => ({ Responses: {} }));
		DocIndex.setDocClient(client);

		expect(await DocIndex.batchGetMetadata('test-doc-index-table', 'v3', [])).toEqual({});
		expect(await DocIndex.batchGetMetadata('test-doc-index-table', 'v3', undefined)).toEqual({});
		expect(await DocIndex.batchGetMetadata('test-doc-index-table', null, ['h1'])).toEqual({});
		expect(await DocIndex.batchGetMetadata(null, 'v3', ['h1'])).toEqual({});
		expect(client.send).not.toHaveBeenCalled();
	});

	it('degrades gracefully when a batch request throws', async () => {
		const client = {
			send: jest.fn(async () => {
				throw new Error('DynamoDB unavailable');
			})
		};
		DocIndex.setDocClient(client);

		const map = await DocIndex.batchGetMetadata('test-doc-index-table', 'v3', ['h1', 'h2']);

		expect(map).toEqual({});
	});
});
