'use strict';

/**
 * Unit tests for dynamo-writer.writeDocumentEntries and the removal of the per-section
 * body write (spec 0-0-6, task 1.5).
 *
 * Verifies:
 *   - one `document:{fileHash}` item per source file, de-duplicated across the file's
 *     sections (Requirement 2.1)
 *   - the key omits the index version so retrieval needs no version (Requirement 2.4)
 *   - every build refreshes the 7-day TTL on the same key (Requirements 2.2, 2.3)
 *   - writeContentEntries no longer writes a `v:{version}:content` body item
 *     (Requirements 2.1, 2.5)
 *   - un-derivable file-level fields are stored as null instead of failing (Requirement 6.3)
 *
 * The DynamoDB Document Client is replaced with a stub via setDocClient, so no AWS I/O
 * occurs. batchWrite chunks at 25 items, so each test asserts over the union of all
 * BatchWriteCommand inputs.
 */

const {
	writeContentEntries,
	writeDocumentEntries,
	setDocClient,
	SEVEN_DAYS_SECONDS
} = require('../../lib/dynamo-writer');

const TABLE = 'test-DocIndex';
const VERSION = '20250715T060000';

/**
 * Build a section entry for a file, sharing the file-level values across sections.
 *
 * @param {Object} overrides - Attributes to override on the base entry
 * @returns {Object} A synthetic extracted entry
 */
function makeEntry(overrides = {}) {
	return {
		hash: 'aaaaaaaaaaaaaaaa',
		contentPath: '63klabs/cache-data/README.md/install',
		documentHash: 'b1c2d3e4f5a60718',
		documentPath: '63klabs/cache-data/README.md',
		fileContent: '# Cache Data\n\nRun npm install @63klabs/cache-data\n',
		githubUrl: 'https://github.com/63klabs/cache-data/blob/v2.0.0/README.md',
		repositoryType: 'package',
		namespace: 'docs',
		repository: 'cache-data',
		owner: '63klabs',
		title: 'Install',
		excerpt: 'Run npm install...',
		type: 'documentation',
		subType: 'guide',
		keywords: ['install'],
		...overrides
	};
}

describe('dynamo-writer document items', () => {
	let send;
	let writtenItems;

	beforeEach(() => {
		writtenItems = [];
		send = jest.fn(async command => {
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

	it('writes exactly one item per file, de-duplicated across that file\'s sections', async () => {
		const entries = [
			makeEntry({ hash: 'sec1', contentPath: '63klabs/cache-data/README.md/install' }),
			makeEntry({ hash: 'sec2', contentPath: '63klabs/cache-data/README.md/usage' }),
			makeEntry({ hash: 'sec3', contentPath: '63klabs/cache-data/README.md/api' }),
			// A second file in the same repository gets its own document item.
			makeEntry({
				hash: 'sec4',
				documentHash: 'c9d8e7f6a5b40312',
				documentPath: '63klabs/cache-data/CHANGELOG.md',
				fileContent: '# Changelog\n\n## v2.0.0\n'
			})
		];

		await writeDocumentEntries(TABLE, VERSION, entries);

		const documentItems = writtenItems.filter(item => item.pk.startsWith('document:'));
		expect(documentItems).toHaveLength(2);

		const readme = documentItems.find(item => item.pk === 'document:b1c2d3e4f5a60718');
		expect(readme.content).toBe('# Cache Data\n\nRun npm install @63klabs/cache-data\n');
		expect(readme.documentPath).toBe('63klabs/cache-data/README.md');
		expect(readme.githubUrl).toBe('https://github.com/63klabs/cache-data/blob/v2.0.0/README.md');
		expect(readme.repositoryType).toBe('package');
		expect(readme.namespace).toBe('docs');
		expect(readme.repository).toBe('cache-data');
		expect(readme.owner).toBe('63klabs');

		const changelog = documentItems.find(item => item.pk === 'document:c9d8e7f6a5b40312');
		expect(changelog.content).toBe('# Changelog\n\n## v2.0.0\n');
	});

	it('keys the item without the index version', async () => {
		await writeDocumentEntries(TABLE, VERSION, [makeEntry()]);

		expect(writtenItems).toHaveLength(1);
		const item = writtenItems[0];

		expect(item.pk).toBe('document:b1c2d3e4f5a60718');
		expect(item.sk).toBe('content');
		expect(item.pk).not.toContain(VERSION);
		expect(item.sk).not.toContain(VERSION);
		// The version is recorded as an attribute only, so readers need not supply it.
		expect(item.version).toBe(VERSION);
	});

	it('refreshes the 7-day TTL on the same key on every build', async () => {
		const nowSeconds = 1_700_000_000;
		const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowSeconds * 1000);

		await writeDocumentEntries(TABLE, VERSION, [makeEntry()]);
		const first = writtenItems[0];
		expect(first.ttl).toBe(nowSeconds + SEVEN_DAYS_SECONDS);

		// A later build upserts the same key with a further-out TTL.
		const laterSeconds = nowSeconds + 3 * 24 * 60 * 60;
		nowSpy.mockReturnValue(laterSeconds * 1000);
		writtenItems = [];
		await writeDocumentEntries(TABLE, '20250718T060000', [makeEntry()]);
		const second = writtenItems[0];

		expect(second.pk).toBe(first.pk);
		expect(second.sk).toBe(first.sk);
		expect(second.ttl).toBe(laterSeconds + SEVEN_DAYS_SECONDS);
		expect(second.ttl).toBeGreaterThan(first.ttl);
	});

	it('stores null for file-level fields that could not be derived', async () => {
		await writeDocumentEntries(TABLE, VERSION, [
			makeEntry({ githubUrl: undefined, repositoryType: undefined, namespace: null })
		]);

		const item = writtenItems[0];
		expect(item.githubUrl).toBeNull();
		expect(item.repositoryType).toBeNull();
		expect(item.namespace).toBeNull();
	});

	it('skips entries with no documentHash rather than failing the build', async () => {
		await expect(writeDocumentEntries(TABLE, VERSION, [
			makeEntry({ documentHash: null }),
			makeEntry()
		])).resolves.toBeUndefined();

		expect(writtenItems).toHaveLength(1);
		expect(writtenItems[0].pk).toBe('document:b1c2d3e4f5a60718');
	});

	it('no longer writes a per-section body item from writeContentEntries', async () => {
		await writeContentEntries(TABLE, VERSION, [
			makeEntry({ hash: 'sec1' }),
			makeEntry({ hash: 'sec2' })
		]);

		expect(writtenItems).toHaveLength(2);
		for (const item of writtenItems) {
			expect(item.sk).toBe(`v:${VERSION}:metadata`);
		}
		expect(writtenItems.some(item => item.sk === `v:${VERSION}:content`)).toBe(false);
		expect(writtenItems.some(item => 'content' in item)).toBe(false);
	});
});
