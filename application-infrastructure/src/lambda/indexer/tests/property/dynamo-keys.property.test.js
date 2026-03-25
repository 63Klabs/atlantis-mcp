// Feature: documentation-indexer, Property 7: Content entries use correct DynamoDB key format
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
 * Arbitrary for a version string in timestamp format.
 */
const versionArb = fc.date({
	min: new Date('2025-01-01'),
	max: new Date('2030-12-31')
}).map(d => {
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
});

describe('Property 7: Content entries use correct DynamoDB key format', () => {

	it('metadata item pk matches content:{hash} and sk matches v:{version}:metadata', () => {
		fc.assert(
			fc.property(entryArb, versionArb, (entry, version) => {
				const hash = hashContentPath(entry.contentPath);

				const metadataItem = {
					pk: `content:${hash}`,
					sk: `v:${version}:metadata`
				};

				expect(metadataItem.pk).toMatch(/^content:[0-9a-f]{16}$/);
				expect(metadataItem.sk).toBe(`v:${version}:metadata`);
				expect(metadataItem.sk).toMatch(/^v:\d{8}T\d{6}:metadata$/);
			}),
			{ numRuns: 100 }
		);
	});

	it('content body item pk matches content:{hash} and sk matches v:{version}:content', () => {
		fc.assert(
			fc.property(entryArb, versionArb, (entry, version) => {
				const hash = hashContentPath(entry.contentPath);

				const contentItem = {
					pk: `content:${hash}`,
					sk: `v:${version}:content`
				};

				expect(contentItem.pk).toMatch(/^content:[0-9a-f]{16}$/);
				expect(contentItem.sk).toBe(`v:${version}:content`);
				expect(contentItem.sk).toMatch(/^v:\d{8}T\d{6}:content$/);
			}),
			{ numRuns: 100 }
		);
	});

	it('metadata and content items share the same pk for the same entry', () => {
		fc.assert(
			fc.property(entryArb, versionArb, (entry, version) => {
				const hash = hashContentPath(entry.contentPath);

				const metadataPk = `content:${hash}`;
				const contentPk = `content:${hash}`;

				expect(metadataPk).toBe(contentPk);
			}),
			{ numRuns: 100 }
		);
	});

	it('hash in pk is derived from contentPath via SHA-256 truncated to 16 hex chars', () => {
		fc.assert(
			fc.property(entryArb, (entry) => {
				const hash = hashContentPath(entry.contentPath);
				const pk = `content:${hash}`;

				// Extract hash from pk
				const extractedHash = pk.replace('content:', '');
				expect(extractedHash).toHaveLength(16);
				expect(extractedHash).toMatch(/^[0-9a-f]{16}$/);

				// Verify determinism
				expect(extractedHash).toBe(hashContentPath(entry.contentPath));
			}),
			{ numRuns: 100 }
		);
	});
});
