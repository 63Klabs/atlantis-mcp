// Feature: 0-0-3-add-authentication, Properties 1, 2, 3: API key generation and hashing
'use strict';

const fc = require('fast-check');
const { generateApiKey, hashApiKey, TestHarness } = require('../../utils/api-key');

describe('Property 1: API key generation format', () => {

	it('generated key always matches atl_ + 32 hex chars', () => {
		fc.assert(
			fc.property(
				fc.constant(null),
				() => {
					const key = generateApiKey();
					expect(key).toMatch(/^atl_[0-9a-f]{32}$/);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('generated key is always exactly 36 characters long', () => {
		fc.assert(
			fc.property(
				fc.constant(null),
				() => {
					const key = generateApiKey();
					expect(key).toHaveLength(36);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('generated keys are unique across invocations', () => {
		const keys = new Set();
		fc.assert(
			fc.property(
				fc.constant(null),
				() => {
					const key = generateApiKey();
					expect(keys.has(key)).toBe(false);
					keys.add(key);
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Property 2: HMAC-SHA256 hash determinism', () => {

	it('same key + same salt produces identical hash', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				(key, salt) => {
					const hash1 = hashApiKey(key, salt);
					const hash2 = hashApiKey(key, salt);
					expect(hash1).toBe(hash2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('hash is always a 64-character lowercase hex string', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				(key, salt) => {
					const hash = hashApiKey(key, salt);
					expect(hash).toHaveLength(64);
					expect(hash).toMatch(/^[0-9a-f]{64}$/);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('different keys with same salt produce different hashes', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				(key1, key2, salt) => {
					fc.pre(key1 !== key2);
					const hash1 = hashApiKey(key1, salt);
					const hash2 = hashApiKey(key2, salt);
					expect(hash1).not.toBe(hash2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('same key with different salts produce different hashes', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				(key, salt1, salt2) => {
					fc.pre(salt1 !== salt2);
					const hash1 = hashApiKey(key, salt1);
					const hash2 = hashApiKey(key, salt2);
					expect(hash1).not.toBe(hash2);
				}
			),
			{ numRuns: 100 }
		);
	});
});

describe('Property 3: Raw API key is never persisted', () => {

	it('hash output never equals the raw key input', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				(salt) => {
					const rawKey = generateApiKey();
					const hash = hashApiKey(rawKey, salt);
					expect(hash).not.toBe(rawKey);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('hash does not contain the raw key as a substring', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				(salt) => {
					const rawKey = generateApiKey();
					const hash = hashApiKey(rawKey, salt);
					// The hex portion of the key (after atl_)
					const keyHex = rawKey.slice(4);
					expect(hash).not.toBe(keyHex);
					expect(hash.includes(rawKey)).toBe(false);
				}
			),
			{ numRuns: 100 }
		);
	});
});
