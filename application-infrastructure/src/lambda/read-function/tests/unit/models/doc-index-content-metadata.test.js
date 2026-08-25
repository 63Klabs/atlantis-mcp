/**
 * Unit Tests for Documentation Index DAO — getContentMetadataByHashes()
 *
 * Tests the content-metadata lookup used by the semantic/assisted retrieval path. Since
 * spec 0-0-6 task 2.2 this delegates to the shared batched reader (`batchGetMetadata`),
 * so the semantic path uses the same chunked BatchGetItem mechanism as the keyword path
 * (Requirement 1.2):
 * - Returns a hash -> metadata item map for hashes that have stored metadata
 * - Issues batched reads (BatchGetCommand) rather than one GetItem per hash
 * - Reads the correct keys (pk=content:{hash}, sk=v:{version}:metadata)
 * - Tolerates/omits missing metadata items (Requirement 1.5)
 * - Returns an empty map for empty/invalid hashes or a missing version (no reads issued)
 * - Degrades gracefully (empty map, no throw) when the batch read fails
 * - Returns a map, so callers can preserve their own vector-rank order regardless of the
 *   order DynamoDB returned the items in (Requirement 1.4)
 *
 * Uses the setDocClient() injection pattern (mirrors doc-index-dynamo.test.js).
 */

const DocIndex = require('../../../models/doc-index');

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
 * Create a mock DynamoDB Document Client that routes BatchGetCommand to a handler function.
 *
 * @param {Object} handlers - { batchGet: fn(input) }
 * @returns {Object} Mock client with send() method
 */
function createMockClient(handlers = {}) {
	return {
		send: jest.fn(async (command) => {
			const commandName = command.constructor.name;
			if (commandName === 'BatchGetCommand' && handlers.batchGet) {
				return handlers.batchGet(command.input);
			}
			return {};
		})
	};
}

/**
 * Build a batchGet handler that resolves keys against a `{pk}|{sk} -> item` fixture map.
 *
 * @param {Object.<string, Object>} metadataItems - Fixture items keyed by `{pk}|{sk}`
 * @param {Object} [options] - Behavior options
 * @param {boolean} [options.reverseOrder=false] - Return items in reverse key order
 * @param {string} [options.tableName='test-doc-index-table'] - Table name in RequestItems
 * @returns {function(Object): Object} BatchGetCommand handler
 */
function batchGetFromFixture(metadataItems, { reverseOrder = false, tableName = 'test-doc-index-table' } = {}) {
	return (input) => {
		const keys = input.RequestItems[tableName].Keys;
		const items = keys
			.map((key) => {
				const item = metadataItems[`${key.pk}|${key.sk}`];
				return item ? { ...item, pk: key.pk, sk: key.sk } : null;
			})
			.filter((item) => item !== null);
		if (reverseOrder) {
			items.reverse();
		}
		return { Responses: { [tableName]: items } };
	};
}

describe('Documentation Index DAO — getContentMetadataByHashes()', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	it('should return a hash -> metadata map for present hashes', async () => {
		const mockClient = createMockClient({
			batchGet: batchGetFromFixture({
				'content:h1|v:v3:metadata': { title: 'Title 1', excerpt: 'Excerpt 1', path: 'repo/one.md', type: 'documentation' },
				'content:h2|v:v3:metadata': { title: 'Title 2', excerpt: 'Excerpt 2', path: 'repo/two.md', type: 'code-example' }
			})
		});
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', ['h1', 'h2']);

		expect(Object.keys(map).sort()).toEqual(['h1', 'h2']);
		expect(map.h1.title).toBe('Title 1');
		expect(map.h2.type).toBe('code-example');
		// Both hashes resolved in a single batched request (no per-hash GetItem).
		expect(mockClient.send).toHaveBeenCalledTimes(1);
		expect(mockClient.send.mock.calls[0][0].constructor.name).toBe('BatchGetCommand');
	});

	it('should read the correct content/version metadata keys', async () => {
		const mockClient = createMockClient({
			batchGet: batchGetFromFixture({
				'content:abc|v:20250715T060000:metadata': { title: 'X' }
			}, { tableName: 'some-table' })
		});
		DocIndex.setDocClient(mockClient);

		await DocIndex.getContentMetadataByHashes('some-table', '20250715T060000', ['abc']);

		expect(mockClient.send).toHaveBeenCalledTimes(1);
		const commandInput = mockClient.send.mock.calls[0][0].input;
		expect(Object.keys(commandInput.RequestItems)).toEqual(['some-table']);
		expect(commandInput.RequestItems['some-table'].Keys).toEqual([
			{ pk: 'content:abc', sk: 'v:20250715T060000:metadata' }
		]);
	});

	it('should tolerate and omit hashes with missing metadata', async () => {
		const mockClient = createMockClient({
			batchGet: batchGetFromFixture({
				'content:present|v:v3:metadata': { title: 'Present' }
			})
		});
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', ['present', 'missing']);

		expect(Object.keys(map)).toEqual(['present']);
		expect(map.missing).toBeUndefined();
	});

	it('should key items by hash even when the batch returns them out of order', async () => {
		const metadataItems = {
			'content:h1|v:v3:metadata': { title: 'First' },
			'content:h2|v:v3:metadata': { title: 'Second' },
			'content:h3|v:v3:metadata': { title: 'Third' }
		};

		const inOrderClient = createMockClient({ batchGet: batchGetFromFixture(metadataItems) });
		DocIndex.setDocClient(inOrderClient);
		const inOrder = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', ['h1', 'h2', 'h3']);

		DocIndex.TestHarness.resetClient();
		const reversedClient = createMockClient({ batchGet: batchGetFromFixture(metadataItems, { reverseOrder: true }) });
		DocIndex.setDocClient(reversedClient);
		const reversed = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', ['h1', 'h2', 'h3']);

		// The map is order-independent, so a caller walking its own ranked hits gets the
		// same enrichment (and therefore the same result ordering) either way.
		expect(reversed).toEqual(inOrder);
		expect(['h1', 'h2', 'h3'].map((hash) => reversed[hash].title)).toEqual(['First', 'Second', 'Third']);
	});

	it('should return an empty map for an empty hashes array (no reads)', async () => {
		const mockClient = createMockClient({ batchGet: batchGetFromFixture({}) });
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', []);

		expect(map).toEqual({});
		expect(mockClient.send).not.toHaveBeenCalled();
	});

	it('should return an empty map when hashes is not an array (no reads)', async () => {
		const mockClient = createMockClient({ batchGet: batchGetFromFixture({}) });
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', undefined);

		expect(map).toEqual({});
		expect(mockClient.send).not.toHaveBeenCalled();
	});

	it('should return an empty map when version is missing (no reads)', async () => {
		const mockClient = createMockClient({ batchGet: batchGetFromFixture({}) });
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', null, ['h1']);

		expect(map).toEqual({});
		expect(mockClient.send).not.toHaveBeenCalled();
	});

	it('should degrade (not throw) when the batched read fails', async () => {
		const mockClient = {
			send: jest.fn(async () => {
				throw new Error('DynamoDB read failed');
			})
		};
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', ['h1', 'h2']);

		expect(map).toEqual({});
	});
});
