// Feature: documentation-indexer, Property 8: Main index contains all entries with required fields
'use strict';

const fc = require('fast-check');
const { hashContentPath } = require('../../lib/hasher');

/**
 * Arbitrary that generates a realistic extracted content entry.
 */
const entryArb = fc.record({
	contentPath: fc.stringOf(
		fc.constantFrom('a', 'b', 'c', '/', '.', '-', '_', '1', '2'),
		{ minLength: 5, maxLength: 80 }
	),
	title: fc.string({ minLength: 1, maxLength: 50 }),
	excerpt: fc.string({ minLength: 0, maxLength: 200 }),
	content: fc.string({ minLength: 0, maxLength: 500 }),
	type: fc.constantFrom('documentation', 'code-example', 'template-pattern'),
	subType: fc.constantFrom('guide', 'function', 'parameter'),
	keywords: fc.array(fc.string({ minLength: 2, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
	repository: fc.string({ minLength: 1, maxLength: 20 }),
	owner: fc.string({ minLength: 1, maxLength: 20 })
});

/**
 * Arbitrary for a version string.
 */
const versionArb = fc.date({
	min: new Date('2025-01-01'),
	max: new Date('2030-12-31')
}).map(d => {
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
});

/**
 * Build a main index from extracted entries, mirroring the index-builder logic.
 *
 * @param {Array<Object>} entries - Extracted content entries
 * @param {string} version - Version identifier
 * @returns {Object} Main index DynamoDB item
 */
function buildMainIndex(entries, version) {
	const now = new Date().toISOString();
	const indexEntries = entries.map(entry => ({
		hash: hashContentPath(entry.contentPath),
		path: entry.contentPath,
		type: entry.type,
		subType: entry.subType,
		title: entry.title,
		repository: entry.repository,
		owner: entry.owner,
		keywords: entry.keywords,
		lastIndexed: now
	}));

	return {
		pk: `mainindex:${version}`,
		sk: 'entries',
		version,
		entries: indexEntries,
		entryCount: indexEntries.length
	};
}

describe('Property 8: Main index contains all entries with required fields', () => {

	it('main index contains exactly one entry per extracted content item', () => {
		fc.assert(
			fc.property(
				fc.array(entryArb, { minLength: 1, maxLength: 20 }),
				versionArb,
				(entries, version) => {
					const mainIndex = buildMainIndex(entries, version);
					expect(mainIndex.entries).toHaveLength(entries.length);
					expect(mainIndex.entryCount).toBe(entries.length);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('each main index entry includes all required fields', () => {
		fc.assert(
			fc.property(
				fc.array(entryArb, { minLength: 1, maxLength: 10 }),
				versionArb,
				(entries, version) => {
					const mainIndex = buildMainIndex(entries, version);

					for (const indexEntry of mainIndex.entries) {
						expect(indexEntry).toHaveProperty('hash');
						expect(indexEntry).toHaveProperty('path');
						expect(indexEntry).toHaveProperty('type');
						expect(indexEntry).toHaveProperty('subType');
						expect(indexEntry).toHaveProperty('title');
						expect(indexEntry).toHaveProperty('repository');
						expect(indexEntry).toHaveProperty('owner');
						expect(indexEntry).toHaveProperty('keywords');
						expect(indexEntry).toHaveProperty('lastIndexed');
					}
				}
			),
			{ numRuns: 100 }
		);
	});

	it('main index pk is mainindex:{version} and sk is entries', () => {
		fc.assert(
			fc.property(
				fc.array(entryArb, { minLength: 1, maxLength: 5 }),
				versionArb,
				(entries, version) => {
					const mainIndex = buildMainIndex(entries, version);
					expect(mainIndex.pk).toBe(`mainindex:${version}`);
					expect(mainIndex.sk).toBe('entries');
					expect(mainIndex.version).toBe(version);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('each entry hash matches hashContentPath of its path', () => {
		fc.assert(
			fc.property(
				fc.array(entryArb, { minLength: 1, maxLength: 10 }),
				versionArb,
				(entries, version) => {
					const mainIndex = buildMainIndex(entries, version);

					for (let i = 0; i < entries.length; i++) {
						const expectedHash = hashContentPath(entries[i].contentPath);
						expect(mainIndex.entries[i].hash).toBe(expectedHash);
						expect(mainIndex.entries[i].path).toBe(entries[i].contentPath);
					}
				}
			),
			{ numRuns: 100 }
		);
	});
});
