/**
 * Unit Tests for Corpus Manifest DAO (`models/corpus.js`)
 *
 * Covers (task 11.2):
 * - Item path: indexer-written `corpus:{version}` / `manifest` item is read and returned as-is
 * - Derivation fallback: `deriveManifestFromMainIndex` aggregation, and `getCorpusManifest()`
 *   falling through to it when the indexer item is absent
 * - Each degradation tier `getCorpusManifest()` itself can produce — the three
 *   `MANIFEST_SOURCE` outcomes (`indexer` / `derived` / `unavailable`). The full/compact/count
 *   byte-budget response-assembly ladder (R8.7-8.9) lives in `services/documentation.js` and is
 *   covered by task 13.1/13.2/13.3 — out of scope here.
 * - Version-keyed cache behavior: `getActiveVersion()` is consulted first and its result keys
 *   both the indexer-item GetItem and the main-index read, so a version change naturally
 *   produces a different key with no explicit invalidation step (R8.5, R8.6)
 *
 * Mocking strategy:
 * - `getActiveVersion` / `getMainIndex` from `./doc-index` are mocked via `jest.mock(...)`,
 *   since corpus.js only calls through those exports and never touches the main-index
 *   GetItem/QueryCommand internals directly.
 * - `readIndexerManifestItem` calls `getDocClient()` itself and issues its own `GetCommand`,
 *   so the REAL `getDocClient`/`setDocClient` from `./doc-index` are used (not mocked) and a
 *   mock DynamoDB document client is injected via `setDocClient()`, mirroring the
 *   `doc-index-dynamo.test.js` convention.
 */

const Corpus = require('../../../models/corpus');
const DocIndex = require('../../../models/doc-index');

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

// Mock Config, since doc-index.js (required by both corpus.js and this test's
// requireActual below) pulls in `../config`, which in turn needs the real `cache-data`
// Cache/CacheableDataAccess shape that the mock above does not provide.
jest.mock('../../../config', () => ({
	Config: {
		settings: jest.fn(() => ({
			docIndexTable: 'test-doc-index-table',
			github: { userOrgs: ['63klabs'] }
		}))
	}
}));

// Mock only getActiveVersion/getMainIndex from doc-index; keep getDocClient/setDocClient real
// so readIndexerManifestItem's own GetCommand call can be exercised against a mock client.
jest.mock('../../../models/doc-index', () => {
	const actual = jest.requireActual('../../../models/doc-index');
	return {
		...actual,
		getActiveVersion: jest.fn(),
		getMainIndex: jest.fn()
	};
});

const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

const TABLE_NAME = 'test-doc-index-table';

/**
 * Create a mock DynamoDB Document Client that routes GetCommand to a handler function,
 * mirroring the convention in doc-index-dynamo.test.js.
 *
 * @param {Object} handlers - { get: fn(params) }
 * @returns {Object} Mock client with send()
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

describe('Corpus Manifest DAO', () => {
	afterEach(() => {
		DocIndex.setDocClient(null);
		jest.clearAllMocks();
	});

	// ---------------------------------------------------------------
	// Item path (indexer-written manifest item)
	// ---------------------------------------------------------------
	describe('item path — indexer-written manifest item', () => {
		it('returns the item\'s repositories array as-is and does not read the main index', async () => {
			DocIndex.getActiveVersion.mockResolvedValue('20250715T060000');
			const repositories = [
				{ name: 'repo-a', owner: '63klabs', repositoryType: 'package', resolution: 'resolved', namespace: null, sections: 12, ref: 'main' }
			];
			const mockClient = createMockClient({
				get: (params) => {
					if (params.Key.pk === 'corpus:20250715T060000' && params.Key.sk === 'manifest') {
						return { Item: { pk: params.Key.pk, sk: params.Key.sk, repositories } };
					}
					return {};
				}
			});
			DocIndex.setDocClient(mockClient);

			const result = await Corpus.getCorpusManifest(TABLE_NAME);

			expect(result).toEqual({ repositories, source: Corpus.MANIFEST_SOURCE.INDEXER, version: '20250715T060000' });
			expect(DocIndex.getMainIndex).not.toHaveBeenCalled();
		});

		it('readIndexerManifestItem returns null when the item has no Item (not found)', async () => {
			const mockClient = createMockClient({ get: () => ({}) });
			DocIndex.setDocClient(mockClient);

			const result = await Corpus.readIndexerManifestItem(TABLE_NAME, '20250715T060000');

			expect(result).toBeNull();
		});

		it('readIndexerManifestItem returns null and warns when the GetItem call throws', async () => {
			const mockClient = createMockClient({ get: () => { throw new Error('DynamoDB unavailable'); } });
			DocIndex.setDocClient(mockClient);

			const result = await Corpus.readIndexerManifestItem(TABLE_NAME, '20250715T060000');

			expect(result).toBeNull();
			expect(DebugAndLog.warn).toHaveBeenCalled();
		});

		it('readIndexerManifestItem returns null when the item exists but repositories is not an array', async () => {
			const mockClient = createMockClient({
				get: () => ({ Item: { pk: 'corpus:v1', sk: 'manifest' } })
			});
			DocIndex.setDocClient(mockClient);

			const result = await Corpus.readIndexerManifestItem(TABLE_NAME, 'v1');

			expect(result).toBeNull();
		});
	});

	// ---------------------------------------------------------------
	// Derivation fallback
	// ---------------------------------------------------------------
	describe('derivation fallback', () => {
		it('deriveManifestFromMainIndex aggregates entries by owner/repository into one entry per distinct repository', () => {
			const entries = [
				{ hash: 'a1', repository: 'repo-a', owner: '63klabs', type: 'documentation' },
				{ hash: 'a2', repository: 'repo-a', owner: '63klabs', type: 'documentation' },
				{ hash: 'b1', repository: 'repo-b', owner: '63klabs', type: 'package' },
				{ hash: 'c1', repository: 'repo-c', owner: 'otherorg', type: 'documentation' }
			];

			const derived = Corpus.deriveManifestFromMainIndex(entries);

			expect(derived).toHaveLength(3);

			const repoA = derived.find((e) => e.name === 'repo-a' && e.owner === '63klabs');
			const repoB = derived.find((e) => e.name === 'repo-b' && e.owner === '63klabs');
			const repoC = derived.find((e) => e.name === 'repo-c' && e.owner === 'otherorg');

			expect(repoA).toEqual({ name: 'repo-a', owner: '63klabs', repositoryType: null, resolution: null, namespace: null, sections: 2, ref: null });
			expect(repoB).toEqual({ name: 'repo-b', owner: '63klabs', repositoryType: null, resolution: null, namespace: null, sections: 1, ref: null });
			expect(repoC).toEqual({ name: 'repo-c', owner: 'otherorg', repositoryType: null, resolution: null, namespace: null, sections: 1, ref: null });
		});

		it('deriveManifestFromMainIndex groups entries missing owner/repository together, not per-entry', () => {
			const entries = [
				{ hash: 'x1', type: 'documentation' },
				{ hash: 'x2', type: 'documentation' }
			];

			const derived = Corpus.deriveManifestFromMainIndex(entries);

			expect(derived).toHaveLength(1);
			expect(derived[0]).toEqual({ name: null, owner: null, repositoryType: null, resolution: null, namespace: null, sections: 2, ref: null });
		});

		it('deriveManifestFromMainIndex returns an empty array for an empty entries list', () => {
			expect(Corpus.deriveManifestFromMainIndex([])).toEqual([]);
		});

		it('getCorpusManifest falls back to getMainIndex and returns a derived manifest when the indexer item is absent', async () => {
			DocIndex.getActiveVersion.mockResolvedValue('20250715T060000');
			const mockClient = createMockClient({ get: () => ({}) }); // no Item -> absent
			DocIndex.setDocClient(mockClient);

			const mainIndexEntries = [
				{ hash: 'a1', repository: 'repo-a', owner: '63klabs', type: 'documentation' },
				{ hash: 'b1', repository: 'repo-b', owner: '63klabs', type: 'package' }
			];
			DocIndex.getMainIndex.mockResolvedValue(mainIndexEntries);

			const result = await Corpus.getCorpusManifest(TABLE_NAME);

			expect(result.source).toBe(Corpus.MANIFEST_SOURCE.DERIVED);
			expect(result.version).toBe('20250715T060000');
			expect(result.repositories).toHaveLength(2);
			expect(DocIndex.getMainIndex).toHaveBeenCalledWith(TABLE_NAME, '20250715T060000');
		});
	});

	// ---------------------------------------------------------------
	// Degradation tiers — the three MANIFEST_SOURCE outcomes getCorpusManifest() can produce.
	//
	// Scoping note: "each degradation tier" for this task is the set of outcomes corpus.js
	// itself is responsible for (WHERE the manifest comes from): indexer / derived /
	// unavailable. The full/compact/count byte-budget ladder (R8.7-8.9) is assembled in
	// services/documentation.js against MCP_CORPUS_MANIFEST_MAX_BYTES and is covered by
	// task 13.1-13.3, not here.
	// ---------------------------------------------------------------
	describe('degradation tiers (MANIFEST_SOURCE outcomes)', () => {
		it('source: indexer — when the indexer item is present', async () => {
			DocIndex.getActiveVersion.mockResolvedValue('v1');
			const repositories = [{ name: 'repo-a', owner: '63klabs', repositoryType: 'package', resolution: 'resolved', namespace: null, sections: 3, ref: 'main' }];
			DocIndex.setDocClient(createMockClient({ get: () => ({ Item: { repositories } }) }));

			const result = await Corpus.getCorpusManifest(TABLE_NAME);

			expect(result.source).toBe(Corpus.MANIFEST_SOURCE.INDEXER);
			expect(result.repositories).toEqual(repositories);
		});

		it('source: derived — when the indexer item is absent but the main index has entries', async () => {
			DocIndex.getActiveVersion.mockResolvedValue('v1');
			DocIndex.setDocClient(createMockClient({ get: () => ({}) }));
			DocIndex.getMainIndex.mockResolvedValue([
				{ hash: 'a1', repository: 'repo-a', owner: '63klabs', type: 'documentation' }
			]);

			const result = await Corpus.getCorpusManifest(TABLE_NAME);

			expect(result.source).toBe(Corpus.MANIFEST_SOURCE.DERIVED);
			expect(result.repositories).toHaveLength(1);
		});

		it('source: unavailable — when there is no active version', async () => {
			DocIndex.getActiveVersion.mockResolvedValue(null);

			const result = await Corpus.getCorpusManifest(TABLE_NAME);

			expect(result).toEqual({ repositories: null, source: Corpus.MANIFEST_SOURCE.UNAVAILABLE, version: null });
			expect(DebugAndLog.warn).toHaveBeenCalled();
			expect(DocIndex.getMainIndex).not.toHaveBeenCalled();
		});

		it('source: unavailable — when the indexer item is absent and the main index is empty', async () => {
			DocIndex.getActiveVersion.mockResolvedValue('v1');
			DocIndex.setDocClient(createMockClient({ get: () => ({}) }));
			DocIndex.getMainIndex.mockResolvedValue([]);

			const result = await Corpus.getCorpusManifest(TABLE_NAME);

			expect(result).toEqual({ repositories: null, source: Corpus.MANIFEST_SOURCE.UNAVAILABLE, version: 'v1' });
			expect(DebugAndLog.warn).toHaveBeenCalled();
		});

		it('source: unavailable — when the indexer item is absent and the main index read throws', async () => {
			DocIndex.getActiveVersion.mockResolvedValue('v1');
			DocIndex.setDocClient(createMockClient({ get: () => ({}) }));
			DocIndex.getMainIndex.mockRejectedValue(new Error('main index unreadable'));

			const result = await Corpus.getCorpusManifest(TABLE_NAME);

			expect(result).toEqual({ repositories: null, source: Corpus.MANIFEST_SOURCE.UNAVAILABLE, version: 'v1' });
			expect(DebugAndLog.warn).toHaveBeenCalled();
		});
	});

	// ---------------------------------------------------------------
	// Version-keyed cache behavior
	// ---------------------------------------------------------------
	describe('version-keyed cache behavior', () => {
		it('always reads getActiveVersion first and uses that version to build the corpus:{version} GetItem key', async () => {
			DocIndex.getActiveVersion.mockResolvedValue('version-A');
			const mockClient = createMockClient({
				get: (params) => ({ Item: { repositories: [{ name: 'repo-a', owner: '63klabs', repositoryType: null, resolution: null, namespace: null, sections: 1, ref: null }] } }, params)
			});
			DocIndex.setDocClient(mockClient);

			await Corpus.getCorpusManifest(TABLE_NAME);

			expect(DocIndex.getActiveVersion).toHaveBeenCalledWith(TABLE_NAME);
			expect(mockClient.send).toHaveBeenCalledTimes(1);
			const sentCommand = mockClient.send.mock.calls[0][0];
			expect(sentCommand.input.Key).toEqual({ pk: 'corpus:version-A', sk: 'manifest' });
		});

		it('issues GetItem against a different corpus:{version} key when the active version changes across calls, with no explicit invalidation step', async () => {
			const mockClient = createMockClient({ get: () => ({}) }); // indexer item always absent -> exercise main-index key too
			DocIndex.setDocClient(mockClient);
			DocIndex.getMainIndex.mockResolvedValue([{ hash: 'h1', repository: 'repo-a', owner: '63klabs', type: 'documentation' }]);

			DocIndex.getActiveVersion.mockResolvedValueOnce('version-A');
			const first = await Corpus.getCorpusManifest(TABLE_NAME);

			DocIndex.getActiveVersion.mockResolvedValueOnce('version-B');
			const second = await Corpus.getCorpusManifest(TABLE_NAME);

			expect(first.version).toBe('version-A');
			expect(second.version).toBe('version-B');

			const getItemKeys = mockClient.send.mock.calls.map((call) => call[0].input.Key);
			expect(getItemKeys).toEqual([
				{ pk: 'corpus:version-A', sk: 'manifest' },
				{ pk: 'corpus:version-B', sk: 'manifest' }
			]);

			expect(DocIndex.getMainIndex).toHaveBeenNthCalledWith(1, TABLE_NAME, 'version-A');
			expect(DocIndex.getMainIndex).toHaveBeenNthCalledWith(2, TABLE_NAME, 'version-B');
		});
	});
});
