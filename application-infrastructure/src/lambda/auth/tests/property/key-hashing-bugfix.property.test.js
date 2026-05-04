// Bugfix: 0-0-4-key-hashing-for-auth, Property 1: Bug Condition - scrypt Replaces HMAC-SHA256
// This test encodes the EXPECTED behavior after the fix.
// On UNFIXED code, this test FAILS — confirming the bug exists.
// On FIXED code, this test PASSES — confirming the fix works.
'use strict';

const fc = require('fast-check');
const crypto = require('crypto');
const { hashApiKey } = require('../../utils/api-key');

/**
 * **Validates: Requirements 1.1, 1.2, 1.4, 2.1**
 *
 * Property 1: Bug Condition - HMAC-SHA256 Usage Detected in hashApiKey
 *
 * For any (rawKey, salt) pair, hashApiKey(rawKey, salt) output MUST differ
 * from crypto.createHmac('sha256', salt).update(rawKey).digest('hex').
 *
 * This property FAILS on unfixed code because hashApiKey currently uses
 * HMAC-SHA256, so its output equals the HMAC-SHA256 output.
 */
describe('Property 1: Bug Condition - scrypt Replaces HMAC-SHA256', () => {

	it('hashApiKey output differs from HMAC-SHA256 for any (rawKey, salt) pair', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				(rawKey, salt) => {
					const hmacResult = crypto.createHmac('sha256', salt).update(rawKey).digest('hex');
					const hashResult = hashApiKey(rawKey, salt);

					// Expected behavior: scrypt output differs from HMAC-SHA256
					expect(hashResult).not.toBe(hmacResult);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('hashApiKey output is a 64-character lowercase hex string', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				(rawKey, salt) => {
					const hashResult = hashApiKey(rawKey, salt);
					expect(hashResult).toMatch(/^[0-9a-f]{64}$/);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('hashApiKey is deterministic (same inputs produce same output)', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 100 }),
				fc.string({ minLength: 1, maxLength: 100 }),
				(rawKey, salt) => {
					const hash1 = hashApiKey(rawKey, salt);
					const hash2 = hashApiKey(rawKey, salt);
					expect(hash1).toBe(hash2);
				}
			),
			{ numRuns: 100 }
		);
	});
});
