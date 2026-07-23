/**
 * Unit Tests for Documentation Index DAO — getContentMetadataByHashes()
 *
 * Tests the batch content-metadata lookup used by the semantic retrieval path (task 8.4):
 * - Returns a hash -> metadata item map for hashes that have stored metadata
 * - Reads the correct keys (pk=content:{hash}, sk=v:{version}:metadata)
 * - Tolerates/omits missing metadata items
 * - Returns an empty map for empty/invalid hashes or a missing version (no reads issued)
 * - Skips (and does not throw on) a per-hash read error
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
 * Create a mock DynamoDB Document Client that routes GetCommand to a handler function.
 *
 * @param {Object} handlers - { get: fn(params) }
 * @returns {Object} Mock client with send() method
 */
function createMockClient(handlers = {}) {
	return {
		send: jest.fn(async (command) => {
			const commandName = command.constructor.name;
			if (commandName === 'GetCommand' && handlers.get) {
				return handlers.get(command.input);
			}
			return {};
		})
	};
}

describe('Documentation Index DAO — getContentMetadataByHashes()', () => {
	afterEach(() => {
		DocIndex.TestHarness.resetClient();
		jest.clearAllMocks();
	});

	it('should return a hash -> metadata map for present hashes', async () => {
		const mockClient = createMockClient({
			get: (params) => {
				if (params.Key.pk === 'content:h1' && params.Key.sk === 'v:v3:metadata') {
					return { Item: { title: 'Title 1', excerpt: 'Excerpt 1', path: 'repo/one.md', type: 'documentation' } };
				}
				if (params.Key.pk === 'content:h2' && params.Key.sk === 'v:v3:metadata') {
					return { Item: { title: 'Title 2', excerpt: 'Excerpt 2', path: 'repo/two.md', type: 'code-example' } };
				}
				return {};
			}
		});
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', ['h1', 'h2']);

		expect(Object.keys(map).sort()).toEqual(['h1', 'h2']);
		expect(map.h1.title).toBe('Title 1');
		expect(map.h2.type).toBe('code-example');
		expect(mockClient.send).toHaveBeenCalledTimes(2);
	});

	it('should read the correct content/version metadata keys', async () => {
		const mockClient = createMockClient({
			get: () => ({ Item: { title: 'X' } })
		});
		DocIndex.setDocClient(mockClient);

		await DocIndex.getContentMetadataByHashes('some-table', '20250715T060000', ['abc']);

		expect(mockClient.send).toHaveBeenCalledTimes(1);
		const commandInput = mockClient.send.mock.calls[0][0].input;
		expect(commandInput.TableName).toBe('some-table');
		expect(commandInput.Key).toEqual({ pk: 'content:abc', sk: 'v:20250715T060000:metadata' });
	});

	it('should tolerate and omit hashes with missing metadata', async () => {
		const mockClient = createMockClient({
			get: (params) => {
				if (params.Key.pk === 'content:present') {
					return { Item: { title: 'Present' } };
				}
				// Missing item -> no Item key
				return {};
			}
		});
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', ['present', 'missing']);

		expect(Object.keys(map)).toEqual(['present']);
		expect(map.missing).toBeUndefined();
	});

	it('should return an empty map for an empty hashes array (no reads)', async () => {
		const mockClient = createMockClient({ get: () => ({ Item: { title: 'x' } }) });
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', []);

		expect(map).toEqual({});
		expect(mockClient.send).not.toHaveBeenCalled();
	});

	it('should return an empty map when hashes is not an array (no reads)', async () => {
		const mockClient = createMockClient({ get: () => ({ Item: { title: 'x' } }) });
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', undefined);

		expect(map).toEqual({});
		expect(mockClient.send).not.toHaveBeenCalled();
	});

	it('should return an empty map when version is missing (no reads)', async () => {
		const mockClient = createMockClient({ get: () => ({ Item: { title: 'x' } }) });
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', null, ['h1']);

		expect(map).toEqual({});
		expect(mockClient.send).not.toHaveBeenCalled();
	});

	it('should skip (not throw on) a per-hash read error and return the successful ones', async () => {
		const mockClient = createMockClient({
			get: (params) => {
				if (params.Key.pk === 'content:bad') {
					throw new Error('DynamoDB read failed');
				}
				return { Item: { title: 'Good' } };
			}
		});
		DocIndex.setDocClient(mockClient);

		const map = await DocIndex.getContentMetadataByHashes('test-doc-index-table', 'v3', ['bad', 'good']);

		expect(Object.keys(map)).toEqual(['good']);
		expect(map.good.title).toBe('Good');
	});
});
