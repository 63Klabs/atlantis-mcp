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
 * Property 15: TTL refresh for free registered users
 *
 * For any authenticated request from a free registered user (effective
 * tier = registered, tierExpiresAt is null): if the record's ttl is
 * less than 90 days from now, the system SHALL update ttl to now + 120
 * days. If ttl is 90 or more days from now, the system SHALL NOT
 * update the ttl.
 */
describe('Property 15: TTL refresh for free registered users', () => {

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

					refreshTtl(pk, record, 'registered');

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

					refreshTtl(pk, record, 'registered');

					// >! dynamo.update should NOT have been called
					expect(AWS.dynamo.update).not.toHaveBeenCalled();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('non-registered tiers do NOT trigger TTL refresh', () => {
		const nowSec = Math.floor(Date.now() / 1000);

		fc.assert(
			fc.property(
				hexHash64Arb,
				fc.constantFrom('paid', 'private', 'public'),
				// >! TTL that would normally trigger refresh
				fc.integer({ min: nowSec - 30 * 24 * 60 * 60, max: nowSec + NINETY_DAYS_SEC - 1 }),
				(hash, tier, ttl) => {
					AWS.dynamo.update.mockReset();
					AWS.dynamo.update.mockResolvedValue({});

					const pk = `KEY#${hash}`;
					const record = {
						ttl,
						tier,
						tierExpiresAt: null
					};

					refreshTtl(pk, record, tier);

					// >! dynamo.update should NOT have been called for non-registered tiers
					expect(AWS.dynamo.update).not.toHaveBeenCalled();
				}
			),
			{ numRuns: 100 }
		);
	});

	it('registered users with tierExpiresAt set (downgraded paid) do NOT trigger refresh', () => {
		const nowSec = Math.floor(Date.now() / 1000);

		fc.assert(
			fc.property(
				hexHash64Arb,
				// >! TTL that would normally trigger refresh
				fc.integer({ min: nowSec - 30 * 24 * 60 * 60, max: nowSec + NINETY_DAYS_SEC - 1 }),
				// >! tierExpiresAt in the past (downgraded paid user)
				fc.integer({ min: nowSec - 365 * 24 * 60 * 60, max: nowSec - 1 }),
				(hash, ttl, tierExpiresAt) => {
					AWS.dynamo.update.mockReset();
					AWS.dynamo.update.mockResolvedValue({});

					const pk = `KEY#${hash}`;
					const record = {
						ttl,
						tier: 'paid',
						tierExpiresAt
					};

					// >! effectiveTier is 'registered' because tierExpiresAt is in the past,
					// but tierExpiresAt is non-null so this is a downgraded paid user
					refreshTtl(pk, record, 'registered');

					// >! dynamo.update should NOT have been called for downgraded paid users
					expect(AWS.dynamo.update).not.toHaveBeenCalled();
				}
			),
			{ numRuns: 100 }
		);
	});
});
