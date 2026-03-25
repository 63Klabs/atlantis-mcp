// Feature: documentation-indexer, Property 1: Content path hashing is deterministic
'use strict';

const fc = require('fast-check');
const { hashContentPath } = require('../../lib/hasher');

describe('Property 1: Content path hashing is deterministic', () => {

	it('hashing the same path twice produces identical results', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 500 }),
				(contentPath) => {
					const hash1 = hashContentPath(contentPath);
					const hash2 = hashContentPath(contentPath);
					expect(hash1).toBe(hash2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('hash is always a 16-character lowercase hex string', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 0, maxLength: 500 }),
				(contentPath) => {
					const hash = hashContentPath(contentPath);
					expect(hash).toHaveLength(16);
					expect(hash).toMatch(/^[0-9a-f]{16}$/);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('different paths produce different hashes (with high probability)', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 200 }),
				fc.string({ minLength: 1, maxLength: 200 }),
				(path1, path2) => {
					fc.pre(path1 !== path2);
					const hash1 = hashContentPath(path1);
					const hash2 = hashContentPath(path2);
					expect(hash1).not.toBe(hash2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('handles content paths with special characters', () => {
		fc.assert(
			fc.property(
				fc.stringOf(
					fc.oneof(
						fc.char(),
						fc.constant('/'),
						fc.constant('.'),
						fc.constant('-'),
						fc.constant('_'),
						fc.constant('#')
					),
					{ minLength: 1, maxLength: 300 }
				),
				(contentPath) => {
					const hash = hashContentPath(contentPath);
					expect(hash).toHaveLength(16);
					expect(hash).toMatch(/^[0-9a-f]{16}$/);
				}
			),
			{ numRuns: 100 }
		);
	});
});
