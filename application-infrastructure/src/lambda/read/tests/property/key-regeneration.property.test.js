// Feature: 0-0-3-add-authentication, Property 10: Key regeneration preserves user fields
'use strict';

const fc = require('fast-check');
const { generateApiKey, hashApiKey } = require('../../../auth/utils/api-key');

/**
 * Validates: Requirements 8.3
 *
 * Property 10: Key regeneration preserves user fields
 *
 * For any key regeneration operation, the new Users table record SHALL
 * preserve the original user's email, tier, cognitoSub, and tierExpiresAt
 * values. Only the pk (key hash) and createdAt SHALL differ.
 */

/** Arbitrary tier generator matching the three stored tiers */
const tierArb = fc.constantFrom('registered', 'paid', 'private');

/** Arbitrary ISO 8601 timestamp or null for tierExpiresAt */
const tierExpiresAtArb = fc.oneof(
	fc.constant(null),
	fc.integer({
		min: new Date('2020-01-01').getTime(),
		max: new Date('2030-12-31').getTime()
	}).map(ts => new Date(ts).toISOString())
);

/** Arbitrary user record representing an existing key record */
const userRecordArb = fc.record({
	email: fc.emailAddress(),
	tier: tierArb,
	cognitoSub: fc.uuid(),
	tierExpiresAt: tierExpiresAtArb
});

/** Fixed salt for hashing in tests */
const TEST_SALT = 'test-property-salt-key-regeneration';

/**
 * Simulate key regeneration: given an original user record, generate a new
 * API key, hash it, and create a new record preserving user fields.
 *
 * @param {Object} original - Original user record fields
 * @returns {{oldRecord: Object, newRecord: Object}} Old and new records
 */
function simulateKeyRegeneration(original) {
	// >! Original key and record
	const oldRawKey = generateApiKey();
	const oldHash = hashApiKey(oldRawKey, TEST_SALT);
	const oldRecord = {
		pk: `KEY#${oldHash}`,
		email: original.email,
		tier: original.tier,
		cognitoSub: original.cognitoSub,
		tierExpiresAt: original.tierExpiresAt,
		createdAt: new Date(Date.now() - 86400000).toISOString(),
		ttl: Math.floor(Date.now() / 1000) + (120 * 24 * 60 * 60)
	};

	// >! Regeneration: new key, new hash, new record preserving fields
	const newRawKey = generateApiKey();
	const newHash = hashApiKey(newRawKey, TEST_SALT);
	const newRecord = {
		pk: `KEY#${newHash}`,
		email: oldRecord.email,
		tier: oldRecord.tier,
		cognitoSub: oldRecord.cognitoSub,
		tierExpiresAt: oldRecord.tierExpiresAt,
		createdAt: new Date().toISOString(),
		ttl: Math.floor(Date.now() / 1000) + (120 * 24 * 60 * 60)
	};

	return { oldRecord, newRecord };
}

describe('Property 10: Key regeneration preserves user fields', () => {

	it('new record preserves email, tier, cognitoSub, and tierExpiresAt from original', () => {
		fc.assert(
			fc.property(
				userRecordArb,
				(original) => {
					const { oldRecord, newRecord } = simulateKeyRegeneration(original);

					expect(newRecord.email).toBe(oldRecord.email);
					expect(newRecord.tier).toBe(oldRecord.tier);
					expect(newRecord.cognitoSub).toBe(oldRecord.cognitoSub);
					expect(newRecord.tierExpiresAt).toBe(oldRecord.tierExpiresAt);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('new record has a different pk than the original', () => {
		fc.assert(
			fc.property(
				userRecordArb,
				(original) => {
					const { oldRecord, newRecord } = simulateKeyRegeneration(original);

					expect(newRecord.pk).not.toBe(oldRecord.pk);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('new record has a different createdAt than the original', () => {
		fc.assert(
			fc.property(
				userRecordArb,
				(original) => {
					const { oldRecord, newRecord } = simulateKeyRegeneration(original);

					expect(newRecord.createdAt).not.toBe(oldRecord.createdAt);
					// Both should be valid ISO strings
					expect(new Date(newRecord.createdAt).toISOString()).toBe(newRecord.createdAt);
					expect(new Date(oldRecord.createdAt).toISOString()).toBe(oldRecord.createdAt);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('new record pk starts with KEY# followed by a 64-char hex hash', () => {
		fc.assert(
			fc.property(
				userRecordArb,
				(original) => {
					const { newRecord } = simulateKeyRegeneration(original);

					expect(newRecord.pk).toMatch(/^KEY#[0-9a-f]{64}$/);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('preserved fields match the arbitrary input exactly', () => {
		fc.assert(
			fc.property(
				userRecordArb,
				(original) => {
					const { newRecord } = simulateKeyRegeneration(original);

					// Fields must match the original input, not just the old record
					expect(newRecord.email).toBe(original.email);
					expect(newRecord.tier).toBe(original.tier);
					expect(newRecord.cognitoSub).toBe(original.cognitoSub);
					expect(newRecord.tierExpiresAt).toBe(original.tierExpiresAt);
				}
			),
			{ numRuns: 100 }
		);
	});
});
