'use strict';

/**
 * Unit tests for `writeCorpusManifest` (spec 0-0-7, task 18.2, Requirements 8.3, 8.5).
 *
 * Verifies:
 *   - The item is written with pk=`corpus:{version}`, sk=`manifest` (design.md section 9.1)
 *   - Each repository entry carries name, owner, repositoryType, resolution, namespace,
 *     sections, ref (Requirement 8.3)
 *   - Missing per-repository fields are normalized to null/0 rather than left undefined
 *   - The item carries a numeric TTL (the same 7-day pattern as the other versioned items)
 *   - An empty repositories array still produces a well-formed item
 *
 * The DynamoDB Document Client is replaced with a stub via `setDocClient`, so no AWS I/O
 * occurs.
 */

const { writeCorpusManifest, setDocClient } = require('../../lib/dynamo-writer');

const TABLE = 'test-DocIndex';
const VERSION = '20250715T060000';

describe('writeCorpusManifest (spec 0-0-7 task 18.2)', () => {
	let writtenItem;

	beforeEach(() => {
		writtenItem = null;
		const send = jest.fn(async command => {
			writtenItem = command.input.Item;
			return {};
		});
		setDocClient({ send });
	});

	afterEach(() => {
		setDocClient(null);
		jest.restoreAllMocks();
	});

	it('writes a single item keyed by pk=corpus:{version}, sk=manifest', async () => {
		await writeCorpusManifest(TABLE, VERSION, [
			{
				name: 'cache-data',
				owner: '63klabs',
				repositoryType: 'package',
				resolution: 'resolved',
				namespace: null,
				sections: 412,
				ref: 'v1.3.17'
			}
		]);

		expect(writtenItem.pk).toBe(`corpus:${VERSION}`);
		expect(writtenItem.sk).toBe('manifest');
		expect(writtenItem.version).toBe(VERSION);
	});

	it('carries the full per-repository shape required by Requirement 8.3', async () => {
		await writeCorpusManifest(TABLE, VERSION, [
			{
				name: 'cache-data',
				owner: '63klabs',
				repositoryType: 'package',
				resolution: 'resolved',
				namespace: null,
				sections: 412,
				ref: 'v1.3.17'
			},
			{
				name: 'atlantis-mcp',
				owner: '63klabs',
				repositoryType: 'absent',
				resolution: 'absent',
				namespace: 'tools',
				sections: 87,
				ref: 'main'
			}
		]);

		expect(writtenItem.repositories).toHaveLength(2);

		const cacheData = writtenItem.repositories.find(r => r.name === 'cache-data');
		expect(cacheData).toEqual({
			name: 'cache-data',
			owner: '63klabs',
			repositoryType: 'package',
			resolution: 'resolved',
			namespace: null,
			sections: 412,
			ref: 'v1.3.17'
		});

		const atlantisMcp = writtenItem.repositories.find(r => r.name === 'atlantis-mcp');
		expect(atlantisMcp).toEqual({
			name: 'atlantis-mcp',
			owner: '63klabs',
			repositoryType: 'absent',
			resolution: 'absent',
			namespace: 'tools',
			sections: 87,
			ref: 'main'
		});
	});

	it('normalizes missing per-repository fields to null/0 instead of leaving them undefined', async () => {
		await writeCorpusManifest(TABLE, VERSION, [
			{ name: 'partial-repo' }
		]);

		expect(writtenItem.repositories[0]).toEqual({
			name: 'partial-repo',
			owner: null,
			repositoryType: null,
			resolution: null,
			namespace: null,
			sections: 0,
			ref: null
		});
	});

	it('writes a well-formed item with an empty repositories array', async () => {
		await writeCorpusManifest(TABLE, VERSION, []);

		expect(writtenItem.pk).toBe(`corpus:${VERSION}`);
		expect(writtenItem.sk).toBe('manifest');
		expect(writtenItem.repositories).toEqual([]);
	});

	it('carries a numeric TTL approximately 7 days out', async () => {
		const before = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

		await writeCorpusManifest(TABLE, VERSION, []);

		expect(typeof writtenItem.ttl).toBe('number');
		// Allow a small window for test execution time rather than asserting an exact value.
		expect(writtenItem.ttl).toBeGreaterThanOrEqual(before - 5);
		expect(writtenItem.ttl).toBeLessThanOrEqual(before + 5);
	});
});
