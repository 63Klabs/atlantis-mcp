'use strict';

/**
 * Unit tests for the extended metadata and search-entry writes (spec 0-0-6, task 1.6).
 *
 * Verifies:
 *   - `content:{hash}/v:{version}:metadata` carries `githubUrl` (Requirement 4.1),
 *     `repositoryType`/`namespace` (Requirements 5.1, 5.2), and `documentHash`
 *     (Requirement 6.4)
 *   - un-derivable file-level fields are persisted as `null` rather than failing the build
 *     (Requirements 4.5, 5.4)
 *   - the fields the metadata item already stored are unchanged (additive-only change)
 *   - `search:{keyword}/v:{version}:{hash}` carries `type` and `subType` so the read path
 *     can push filters down ahead of the metadata fetch (Requirement 8.2)
 *   - `buildKeywordEntries()` threads `type`/`subType` from the content entry onto every
 *     keyword entry it produces
 *
 * The DynamoDB Document Client is replaced with a stub via `setDocClient`, so no AWS I/O
 * occurs. `batchWrite` chunks at 25 items, so assertions are made over the union of all
 * BatchWriteCommand inputs.
 */

const {
	writeContentEntries,
	writeSearchKeywords,
	setDocClient
} = require('../../lib/dynamo-writer');
const { buildKeywordEntries } = require('../../lib/index-builder');

const TABLE = 'test-DocIndex';
const VERSION = '20250715T060000';

/**
 * Build a section entry carrying the file-level values captured upstream.
 *
 * @param {Object} [overrides] - Attributes to override on the base entry
 * @returns {Object} A synthetic extracted content entry
 */
function makeEntry(overrides = {}) {
	return {
		hash: 'ea6f1a2b3c4d5e6f',
		contentPath: '63klabs/cache-data/README.md/install',
		title: 'Install',
		excerpt: 'Run npm install @63klabs/cache-data.',
		type: 'documentation',
		subType: 'guide',
		keywords: ['install', 'npm'],
		repository: 'cache-data',
		owner: '63klabs',
		documentHash: 'b1c2d3e4f5a60718',
		documentPath: '63klabs/cache-data/README.md',
		githubUrl: 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md',
		repositoryType: 'package',
		namespace: 'atlantis',
		...overrides
	};
}

describe('dynamo-writer metadata and search entries (spec 0-0-6 task 1.6)', () => {
	let writtenItems;

	beforeEach(() => {
		writtenItems = [];
		const send = jest.fn(async command => {
			const requestItems = command.input.RequestItems[TABLE] || [];
			for (const request of requestItems) {
				writtenItems.push(request.PutRequest.Item);
			}
			return {};
		});
		setDocClient({ send });
	});

	afterEach(() => {
		setDocClient(null);
		jest.restoreAllMocks();
	});

	describe('writeContentEntries', () => {
		it('persists githubUrl, repositoryType, namespace, and documentHash on the metadata item', async () => {
			await writeContentEntries(TABLE, VERSION, [makeEntry()]);

			expect(writtenItems).toHaveLength(1);
			const item = writtenItems[0];

			expect(item.pk).toBe('content:ea6f1a2b3c4d5e6f');
			expect(item.sk).toBe(`v:${VERSION}:metadata`);
			expect(item.githubUrl).toBe('https://github.com/63klabs/cache-data/blob/v2.0.0/README.md');
			expect(item.repositoryType).toBe('package');
			expect(item.namespace).toBe('atlantis');
			expect(item.documentHash).toBe('b1c2d3e4f5a60718');
		});

		it('leaves the previously stored metadata attributes unchanged', async () => {
			await writeContentEntries(TABLE, VERSION, [makeEntry()]);

			const item = writtenItems[0];
			expect(item.version).toBe(VERSION);
			expect(item.path).toBe('63klabs/cache-data/README.md/install');
			expect(item.type).toBe('documentation');
			expect(item.subType).toBe('guide');
			expect(item.title).toBe('Install');
			expect(item.excerpt).toBe('Run npm install @63klabs/cache-data.');
			expect(item.repository).toBe('cache-data');
			expect(item.owner).toBe('63klabs');
			expect(item.keywords).toEqual(['install', 'npm']);
			expect(typeof item.lastIndexed).toBe('string');
			expect(typeof item.ttl).toBe('number');
		});

		it('stores null for file-level fields that could not be derived', async () => {
			await writeContentEntries(TABLE, VERSION, [
				makeEntry({
					githubUrl: undefined,
					repositoryType: null,
					namespace: undefined,
					documentHash: undefined
				})
			]);

			const item = writtenItems[0];
			expect(item.githubUrl).toBeNull();
			expect(item.repositoryType).toBeNull();
			expect(item.namespace).toBeNull();
			expect(item.documentHash).toBeNull();
		});

		it('writes the file-level values onto every section of the same file', async () => {
			await writeContentEntries(TABLE, VERSION, [
				makeEntry({ hash: 'sec1', contentPath: '63klabs/cache-data/README.md/install' }),
				makeEntry({ hash: 'sec2', contentPath: '63klabs/cache-data/README.md/usage' })
			]);

			expect(writtenItems).toHaveLength(2);
			for (const item of writtenItems) {
				expect(item.documentHash).toBe('b1c2d3e4f5a60718');
				expect(item.githubUrl).toBe('https://github.com/63klabs/cache-data/blob/v2.0.0/README.md');
				expect(item.repositoryType).toBe('package');
				expect(item.namespace).toBe('atlantis');
			}
		});
	});

	describe('writeSearchKeywords', () => {
		it('persists type and subType on each search entry', async () => {
			await writeSearchKeywords(TABLE, VERSION, [
				{
					hash: 'ea6f1a2b3c4d5e6f',
					keyword: 'install',
					relevanceScore: 13,
					typeWeight: 1.0,
					type: 'documentation',
					subType: 'guide'
				},
				{
					hash: 'c9d8e7f6a5b40312',
					keyword: 'install',
					relevanceScore: 8,
					typeWeight: 0.9,
					type: 'template-pattern',
					subType: 'storage'
				}
			]);

			expect(writtenItems).toHaveLength(2);

			const documentation = writtenItems.find(item => item.hash === 'ea6f1a2b3c4d5e6f');
			expect(documentation.pk).toBe('search:install');
			expect(documentation.sk).toBe(`v:${VERSION}:ea6f1a2b3c4d5e6f`);
			expect(documentation.type).toBe('documentation');
			expect(documentation.subType).toBe('guide');
			// Existing attributes are untouched.
			expect(documentation.relevanceScore).toBe(13);
			expect(documentation.typeWeight).toBe(1.0);
			expect(documentation.version).toBe(VERSION);
			expect(typeof documentation.ttl).toBe('number');

			const template = writtenItems.find(item => item.hash === 'c9d8e7f6a5b40312');
			expect(template.type).toBe('template-pattern');
			expect(template.subType).toBe('storage');
		});

		it('stores null when an entry has no type or subType', async () => {
			await writeSearchKeywords(TABLE, VERSION, [
				{ hash: 'ea6f1a2b3c4d5e6f', keyword: 'install', relevanceScore: 3, typeWeight: 0.8 }
			]);

			const item = writtenItems[0];
			expect(item.type).toBeNull();
			expect(item.subType).toBeNull();
		});
	});

	describe('buildKeywordEntries', () => {
		it('threads type and subType from the content entry onto every keyword entry', () => {
			const keywordEntries = buildKeywordEntries([
				makeEntry({ keywords: ['install', 'npm'] }),
				makeEntry({
					hash: 'c9d8e7f6a5b40312',
					type: 'code-example',
					subType: 'lambda',
					keywords: ['handler']
				})
			]);

			expect(keywordEntries).toHaveLength(3);

			for (const entry of keywordEntries.filter(e => e.hash === 'ea6f1a2b3c4d5e6f')) {
				expect(entry.type).toBe('documentation');
				expect(entry.subType).toBe('guide');
			}

			const codeExample = keywordEntries.find(e => e.hash === 'c9d8e7f6a5b40312');
			expect(codeExample.keyword).toBe('handler');
			expect(codeExample.type).toBe('code-example');
			expect(codeExample.subType).toBe('lambda');
		});

		it('normalizes a missing subType to null', () => {
			const keywordEntries = buildKeywordEntries([
				makeEntry({ subType: undefined, keywords: ['install'] })
			]);

			expect(keywordEntries).toHaveLength(1);
			expect(keywordEntries[0].type).toBe('documentation');
			expect(keywordEntries[0].subType).toBeNull();
		});
	});
});
