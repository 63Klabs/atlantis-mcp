/**
 * Property-Based Tests for Auth Resolver
 *
 * Feature: 0-0-3-add-authentication, Properties 4, 5, 6, 7
 *
 * Property 4: Header extraction consistency
 * Property 5: Effective tier computation
 * Property 6: Invalid key rejection
 * Property 7: Authenticated identity uses cognitoSub
 *
 * Validates: Requirements 5.1, 5.3, 5.4, 5.6, 6.2, 6.3
 */

'use strict';

const fc = require('fast-check');
const crypto = require('crypto');

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

const { resolveAuth, TestHarness } = require('../../utils/auth-resolver');
const { extractApiKey, computeEffectiveTier } = TestHarness.getInternals();
const { tools: { AWS, CachedSsmParameter } } = require('@63klabs/cache-data');

/* ------------------------------------------------------------------ */
/*  Property 4: Header extraction consistency                         */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 5.1
 *
 * Property 4: Header extraction consistency
 *
 * For any valid API key, placing it in the `Authorization: Bearer <key>`
 * header or the `X-API-Key: <key>` header SHALL cause the auth resolver
 * to extract the same raw key value.
 */
/** Arbitrary non-whitespace-only key (extractApiKey trims whitespace-only to null) */
const nonBlankKeyArb = fc.string({ minLength: 1, maxLength: 100 })
	.filter(s => s.trim().length > 0);

describe('Property 4: Header extraction consistency', () => {

	it('same key in Authorization: Bearer or X-API-Key extracts the same value', () => {
		fc.assert(
			fc.property(
				nonBlankKeyArb,
				(key) => {
					const bearerEvent = {
						headers: { authorization: `Bearer ${key}` }
					};
					const apiKeyEvent = {
						headers: { 'x-api-key': key }
					};

					const fromBearer = extractApiKey(bearerEvent);
					const fromApiKey = extractApiKey(apiKeyEvent);

					// Both headers extract the same trimmed key value
					expect(fromBearer).toBe(key.trim());
					expect(fromApiKey).toBe(key.trim());
					expect(fromBearer).toBe(fromApiKey);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('same key from either header produces the same scrypt hash', () => {
		const salt = 'test-property-salt-header-consistency';

		fc.assert(
			fc.property(
				nonBlankKeyArb,
				(key) => {
					const bearerEvent = {
						headers: { authorization: `Bearer ${key}` }
					};
					const apiKeyEvent = {
						headers: { 'x-api-key': key }
					};

					const fromBearer = extractApiKey(bearerEvent);
					const fromApiKey = extractApiKey(apiKeyEvent);

					const hashBearer = crypto.scryptSync(fromBearer, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
					const hashApiKey = crypto.scryptSync(fromApiKey, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');

					expect(hashBearer).toBe(hashApiKey);
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Property 5: Effective tier computation                            */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 5.3
 *
 * Property 5: Effective tier computation
 *
 * For any user record with a stored tier and tierExpiresAt value:
 * - tierExpiresAt null → effective tier equals stored tier
 * - tierExpiresAt in the future → effective tier equals stored tier
 * - tierExpiresAt in the past → effective tier is 'registered'
 */
describe('Property 5: Effective tier computation', () => {

	const nowSec = Math.floor(Date.now() / 1000);
	const pastEpoch = nowSec - 365 * 24 * 60 * 60; // 1 year ago
	const futureEpoch = nowSec + 365 * 24 * 60 * 60; // 1 year from now

	it('tierExpiresAt null returns stored tier', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('registered', 'paid', 'private'),
				(storedTier) => {
					const result = computeEffectiveTier(storedTier, null);
					expect(result).toBe(storedTier);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('tierExpiresAt in the future returns stored tier', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('registered', 'paid', 'private'),
				fc.integer({ min: nowSec + 60, max: futureEpoch }),
				(storedTier, expiresAt) => {
					const result = computeEffectiveTier(storedTier, expiresAt);
					expect(result).toBe(storedTier);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('tierExpiresAt in the past returns registered', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('registered', 'paid', 'private'),
				fc.integer({ min: pastEpoch, max: nowSec - 60 }),
				(storedTier, expiresAt) => {
					const result = computeEffectiveTier(storedTier, expiresAt);
					expect(result).toBe('registered');
				}
			),
			{ numRuns: 100 }
		);
	});

	it('tierExpiresAt undefined returns stored tier', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('registered', 'paid', 'private'),
				(storedTier) => {
					const result = computeEffectiveTier(storedTier, undefined);
					expect(result).toBe(storedTier);
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Property 6: Invalid key rejection                                 */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 5.4
 *
 * Property 6: Invalid key rejection
 *
 * For any API key whose HMAC-SHA256 hash does not match any KEY# record
 * in the Users table, the Read Lambda SHALL return HTTP 401 with a
 * JSON-RPC error response.
 */
describe('Property 6: Invalid key rejection', () => {

	const { apiKeyHashSalt } = TestHarness.getInternals();

	beforeEach(() => {
		// >! Mock SSM to return a valid salt
		apiKeyHashSalt.getValue.mockReset();
		apiKeyHashSalt.getValue.mockResolvedValue('test-salt-for-invalid-key-rejection');
		// >! Mock DynamoDB to return no record (key not found)
		AWS.dynamo.get.mockReset();
		AWS.dynamo.get.mockResolvedValue({ Item: null });
	});

	it('key hash not in Users table returns 401 error', async () => {
		await fc.assert(
			fc.asyncProperty(
				nonBlankKeyArb,
				async (key) => {
					const event = {
						headers: { authorization: `Bearer ${key}` },
						requestContext: { identity: { sourceIp: '10.0.0.1' } }
					};

					const result = await resolveAuth(event);

					expect(result.error).toBe(true);
					expect(result.errorResponse).toBeDefined();
					expect(result.errorResponse.statusCode).toBe(401);
					expect(result.errorResponse.headers['Content-Type']).toBe('application/json');

					const body = JSON.parse(result.errorResponse.body);
					expect(body.jsonrpc).toBe('2.0');
					expect(body.error).toBeDefined();
					expect(body.error.code).toBe(-32001);
				}
			),
			{ numRuns: 100 }
		);
	});
});

/* ------------------------------------------------------------------ */
/*  Property 7: Authenticated identity uses cognitoSub                */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 5.6, 6.2, 6.3
 *
 * Property 7: Authenticated identity uses cognitoSub
 *
 * For any authenticated request (valid API key present), the identity
 * SHALL be the user's cognitoSub. For any unauthenticated request
 * (no API key), the identity SHALL be the client IP address.
 */
describe('Property 7: Authenticated identity uses cognitoSub', () => {

	const { apiKeyHashSalt } = TestHarness.getInternals();

	it('authenticated request uses cognitoSub as identity', async () => {
		await fc.assert(
			fc.asyncProperty(
				nonBlankKeyArb,
				fc.uuid(),
				fc.constantFrom('registered', 'paid', 'private'),
				async (key, cognitoSub, tier) => {
					// >! Mock SSM to return a valid salt
					apiKeyHashSalt.getValue.mockReset();
					apiKeyHashSalt.getValue.mockResolvedValue('test-salt-for-identity');

					// >! Mock DynamoDB to return a user record with cognitoSub
					AWS.dynamo.get.mockReset();
					AWS.dynamo.get.mockResolvedValue({
						Item: {
							tier,
							cognitoSub,
							tierExpiresAt: null,
							ttl: Math.floor(Date.now() / 1000) + 120 * 24 * 60 * 60
						}
					});

					// >! Mock update to prevent TTL refresh errors
					AWS.dynamo.update.mockReset();
					AWS.dynamo.update.mockResolvedValue({});

					const event = {
						headers: { authorization: `Bearer ${key}` },
						requestContext: { identity: { sourceIp: '192.168.1.1' } }
					};

					const result = await resolveAuth(event);

					expect(result.isAuthenticated).toBe(true);
					expect(result.identity).toBe(cognitoSub);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('unauthenticated request uses sourceIp as identity', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.ipV4(),
				async (ip) => {
					const event = {
						headers: {},
						requestContext: { identity: { sourceIp: ip } }
					};

					const result = await resolveAuth(event);

					expect(result.isAuthenticated).toBe(false);
					expect(result.identity).toBe(ip);
					expect(result.tier).toBe('public');
				}
			),
			{ numRuns: 100 }
		);
	});
});
