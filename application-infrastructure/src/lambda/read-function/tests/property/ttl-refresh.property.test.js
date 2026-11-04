/**
 * Property-Based Tests for TTL Refresh and User Record Format
 *
 * Feature: 0-0-3-add-authentication, Properties 14, 15
 *
 * Property 14: User record format invariant
 * Property 15: TTL refresh for free registered users
 *
 * Validates: Requirements 2.3, R19 UPDATE
 */

'use strict';

const fc = require('fast-check');

// Mock the @63klabs/cache-data module BEFORE requiring auth-resolver
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), log: jest.fn() },
		AWS: {
			dynamo: {
				get: jest.fn(),
				update: jest.fn()
			}
		},
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn()
		}))
	}
}));

const { TestHarness } = require('../../utils/auth-resolver');
const { refreshTtl, NINETY_DAYS_SEC, ONE_TWENTY_DAYS_SEC } = TestHarness.getInternals();
const { tools: { AWS } } = require('@63klabs/cache-data');

// >! Arbitrary for 64-char lowercase hex strings (HMAC-SHA256 hash output)
const hexHash64Arb = fc.stringMatching(/^[0-9a-f]{64}$/);

/* ------------------------------------------------------------------ */
/*  Property 14: User record format invariant                         */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 2.3
 *
 * Property 14: User record format invariant
 *
 * For any user record created in the Users table, the pk SHALL start
 * with KEY# followed by a 64-character hex string, and the record
 * SHALL contain non-null values for email, tier, cognitoSub, createdAt,
 * and ttl.
 */
describe('Property 14: User record format invariant', () => {

	// >! Arbitrary for generating valid user records
	const userRecordArb = fc.record({
		pk: hexHash64Arb.map(hex => `KEY#${hex}`),
		email: fc.emailAddress(),
		tier: fc.constantFrom('registered', 'paid', 'private'),
		cognitoSub: fc.uuid(),
		createdAt: fc.integer({
			min: new Date('2020-01-01').getTime(),
			max: new Date('2030-12-31').getTime()
		}).map(ts => new Date(ts).toISOString()),
		ttl: fc.integer({ min: 1, max: 2147483647 })
	});

	it('pk starts with KEY# followed by exactly 64 hex characters', () => {
		fc.assert(
			fc.property(
				userRecordArb,
				(record) => {
					expect(record.pk).toMatch(/^KEY#[0-9a-f]{64}$/);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('all required fields are non-null', () => {
		fc.assert(
			fc.property(
				userRecordArb,
				(record) => {
					expect(record.email).not.toBeNull();
					expect(record.email).toBeDefined();
					expect(record.email.length).toBeGreaterThan(0);

					expect(record.tier).not.toBeNull();
					expect(record.tier).toBeDefined();
					expect(['registered', 'paid', 'private']).toContain(record.tier);

					expect(record.cognitoSub).not.toBeNull();
					expect(record.cognitoSub).toBeDefined();

					expect(record.createdAt).not.toBeNull();
					expect(record.createdAt).toBeDefined();

					expect(record.ttl).not.toBeNull();
					expect(record.ttl).toBeDefined();
					expect(typeof record.ttl).toBe('number');
					expect(record.ttl).toBeGreaterThan(0);
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Property 15: TTL refresh for free registered users                */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements R19 UPDATE
 *
 * Property 15: TTL refresh for every record without an end date
 *
 * For any record with no end date (tierExpiresAt is null or absent), of
 * any tier: if the record's ttl is less than 90 days from now, the
 * system SHALL update ttl to now + 120 days, conditional on the record
 * existing. If ttl is 90 or more days from now, or absent, the system
 * SHALL NOT write. Records with an end date are not renewed in phase 1.
 *
 * Validates: Requirements 3.1, 3.2, 3.5 (0-0-7-lapsed-tier-downgrade)
 */
describe('Property 15: TTL refresh for every record without an end date', () => {

	beforeEach(() => {
		AWS.dynamo.update.mockReset();
		AWS.dynamo.update.mockResolvedValue({});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('ttl < now + 90 days triggers update to now + 120 days', () => {
		const nowSec = Math.floor(Date.now() / 1000);

		fc.assert(
			fc.property(
				hexHash64Arb,
				// >! TTL between now-30d and now+89d (less than 90 days from now)
				fc.integer({ min: nowSec - 30 * 24 * 60 * 60, max: nowSec + NINETY_DAYS_SEC - 1 }),
				(hash, ttl) => {
					AWS.dynamo.update.mockReset();
					AWS.dynamo.update.mockResolvedValue({});

					const pk = `KEY#${hash}`;
					const record = {
						ttl,
						tier: 'registered',
						tierExpiresAt: null
					};

					refreshTtl(pk, record);

					// >! dynamo.update should have been called
					expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);

					const callArgs = AWS.dynamo.update.mock.calls[0][0];
					expect(callArgs.Key).toEqual({ pk });
					expect(callArgs.UpdateExpression).toBe('SET #ttl = :newTtl');

					// >! New TTL should be approximately now + 120 days
					const newTtl = callArgs.ExpressionAttributeValues[':newTtl'];
					const expectedTtl = Math.floor(Date.now() / 1000) + ONE_TWENTY_DAYS_SEC;
					// Allow 2 second tolerance for test execution time
					expect(newTtl).toBeGreaterThanOrEqual(expectedTtl - 2);
					expect(newTtl).toBeLessThanOrEqual(expectedTtl + 2);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('ttl >= now + 90 days does NOT trigger update', () => {
		const nowSec = Math.floor(Date.now() / 1000);

		fc.assert(
			fc.property(
				hexHash64Arb,
				// >! TTL at or beyond 90 days from now
				fc.integer({ min: nowSec + NINETY_DAYS_SEC, max: nowSec + 365 * 24 * 60 * 60 }),
				(hash, ttl) => {
					AWS.dynamo.update.mockReset();
					AWS.dynamo.update.mockResolvedValue({});

					const pk = `KEY#${hash}`;
					const record = {
						ttl,
						tier: 'registered',
						tierExpiresAt: null
					};

					refreshTtl(pk, record);

					// >! dynamo.update should NOT have been called
					expect(AWS.dynamo.update).not.toHaveBeenCalled();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('every tier with no end date and ttl within 90 days is renewed', () => {
		const nowSec = Math.floor(Date.now() / 1000);

		fc.assert(
			fc.property(
				hexHash64Arb,
				fc.constantFrom('registered', 'paid', 'private'),
				fc.constantFrom(null, undefined),
				// >! TTL that triggers a renewal (less than 90 days from now)
				fc.integer({ min: nowSec - 30 * 24 * 60 * 60, max: nowSec + NINETY_DAYS_SEC - 1 }),
				(hash, tier, tierExpiresAt, ttl) => {
					AWS.dynamo.update.mockReset();
					AWS.dynamo.update.mockResolvedValue({});

					const pk = `KEY#${hash}`;
					const record = { ttl, tier, tierExpiresAt };

					refreshTtl(pk, record);

					// >! Exactly one write, whatever the tier
					expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);

					const callArgs = AWS.dynamo.update.mock.calls[0][0];
					expect(callArgs.Key).toEqual({ pk });

					// >! New TTL is now + 120 days (1 second tolerance)
					const newTtl = callArgs.ExpressionAttributeValues[':newTtl'];
					const expectedTtl = Math.floor(Date.now() / 1000) + ONE_TWENTY_DAYS_SEC;
					expect(newTtl).toBeGreaterThanOrEqual(expectedTtl - 1);
					expect(newTtl).toBeLessThanOrEqual(expectedTtl + 1);

					// >! The write must not recreate a deleted record
					expect(callArgs.ConditionExpression).toBe('attribute_exists(#pk)');
					expect(callArgs.ExpressionAttributeNames).toEqual({ '#pk': 'pk', '#ttl': 'ttl' });
				}
			),
			{ numRuns: 100 }
		);
	});

	it('records with an end date are not renewed (phase 1)', () => {
		const nowSec = Math.floor(Date.now() / 1000);

		// >! End dates as ISO strings, plus other non-null values of any type
		const endDateArb = fc.oneof(
			fc.date({ min: new Date('2020-01-01'), max: new Date('2035-12-31'), noInvalidDate: true })
				.map(d => d.toISOString()),
			fc.integer({ min: nowSec - 365 * 24 * 60 * 60, max: nowSec + 365 * 24 * 60 * 60 }),
			fc.string(),
			fc.boolean()
		);

		fc.assert(
			fc.property(
				hexHash64Arb,
				fc.constantFrom('registered', 'paid', 'private'),
				// >! TTL that would otherwise trigger a renewal
				fc.integer({ min: nowSec - 30 * 24 * 60 * 60, max: nowSec + NINETY_DAYS_SEC - 1 }),
				endDateArb,
				(hash, tier, ttl, tierExpiresAt) => {
					AWS.dynamo.update.mockReset();
					AWS.dynamo.update.mockResolvedValue({});

					const pk = `KEY#${hash}`;
					const record = { ttl, tier, tierExpiresAt };

					refreshTtl(pk, record);

					// >! dynamo.update should NOT have been called when an end date exists
					expect(AWS.dynamo.update).not.toHaveBeenCalled();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('a record with no ttl attribute causes no write', () => {
		fc.assert(
			fc.property(
				hexHash64Arb,
				fc.constantFrom('registered', 'paid', 'private'),
				fc.constantFrom(null, undefined),
				(hash, tier, tierExpiresAt) => {
					AWS.dynamo.update.mockReset();
					AWS.dynamo.update.mockResolvedValue({});

					const pk = `KEY#${hash}`;
					// >! No ttl property at all
					const record = { tier, tierExpiresAt };

					refreshTtl(pk, record);

					expect(AWS.dynamo.update).not.toHaveBeenCalled();
				}
			),
			{ numRuns: 100 }
		);
	});
});
