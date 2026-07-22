/**
 * Unit Tests for Auth Resolver
 *
 * Feature: 0-0-3-add-authentication, Task 7.4
 *
 * Tests: no key (public), valid key (authenticated), invalid key (401),
 * degraded mode (SSM failure), degraded mode (DynamoDB failure),
 * expired tier, TTL refresh trigger, TTL no-refresh.
 *
 * Requirements: 5.1–5.6, 18.1–18.4
 */

'use strict';

// >! Mock @63klabs/cache-data BEFORE requiring auth-resolver
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

const { resolveAuth, TestHarness } = require('../../../utils/auth-resolver');
const { apiKeyHashSalt } = TestHarness.getInternals();
const { tools: { AWS } } = require('@63klabs/cache-data');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Build an API Gateway proxy event for auth resolver testing.
 *
 * @param {Object} options - Event options
 * @param {Object} [options.headers] - Request headers
 * @param {string} [options.sourceIp] - Client source IP
 * @returns {Object} API Gateway proxy event
 */
function createEvent(options = {}) {
	return {
		headers: options.headers || {},
		requestContext: {
			identity: { sourceIp: options.sourceIp || '192.168.1.1' }
		}
	};
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Auth Resolver — resolveAuth()', () => {

	beforeEach(() => {
		apiKeyHashSalt.getValue.mockReset();
		AWS.dynamo.get.mockReset();
		AWS.dynamo.update.mockReset();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	/* -------------------------------------------------------------- */
	/*  Test 1: No key — public tier                                  */
	/* -------------------------------------------------------------- */

	it('should return public tier with sourceIp identity when no API key header is present', async () => {
		const event = createEvent({ sourceIp: '10.0.0.42' });

		const result = await resolveAuth(event);

		expect(result.tier).toBe('public');
		expect(result.identity).toBe('10.0.0.42');
		expect(result.isAuthenticated).toBe(false);
		expect(result.degraded).toBe(false);

		// SSM and DynamoDB should NOT be called for public requests
		expect(apiKeyHashSalt.getValue).not.toHaveBeenCalled();
		expect(AWS.dynamo.get).not.toHaveBeenCalled();
	});

	/* -------------------------------------------------------------- */
	/*  Test 2: Valid key — authenticated                             */
	/* -------------------------------------------------------------- */

	it('should return authenticated result with cognitoSub for a valid API key', async () => {
		const event = createEvent({
			headers: { authorization: 'Bearer atl_test1234567890abcdef1234567890ab' }
		});

		// >! Mock SSM to return a valid salt
		apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');

		// >! Mock DynamoDB to return a valid user record with TTL far in the future
		const farFutureTtl = Math.floor(Date.now() / 1000) + 200 * 24 * 60 * 60;
		AWS.dynamo.get.mockResolvedValue({
			Item: {
				tier: 'registered',
				cognitoSub: 'sub-123',
				tierExpiresAt: null,
				ttl: farFutureTtl
			}
		});

		const result = await resolveAuth(event);

		expect(result.tier).toBe('registered');
		expect(result.identity).toBe('sub-123');
		expect(result.isAuthenticated).toBe(true);
		expect(result.degraded).toBe(false);
	});

	/* -------------------------------------------------------------- */
	/*  Test 3: Invalid key — 401                                     */
	/* -------------------------------------------------------------- */

	it('should return 401 error when API key is not found in Users table', async () => {
		const event = createEvent({
			headers: { 'x-api-key': 'atl_invalidkey000000000000000000' }
		});

		apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');

		// >! DynamoDB returns no record for this key hash
		AWS.dynamo.get.mockResolvedValue({ Item: null });

		const result = await resolveAuth(event);

		expect(result.error).toBe(true);
		expect(result.errorResponse).toBeDefined();
		expect(result.errorResponse.statusCode).toBe(401);

		const body = JSON.parse(result.errorResponse.body);
		expect(body.jsonrpc).toBe('2.0');
		expect(body.error).toBeDefined();
		expect(body.error.code).toBe(-32001);
		expect(body.error.message).toMatch(/invalid api key/i);
	});

	/* -------------------------------------------------------------- */
	/*  Test 4: Degraded mode — SSM failure                           */
	/* -------------------------------------------------------------- */

	it('should return public tier with degraded=true when SSM throws an error', async () => {
		const event = createEvent({
			headers: { authorization: 'Bearer atl_somekey00000000000000000000' },
			sourceIp: '172.16.0.5'
		});

		// >! SSM throws — auth resolver should degrade gracefully
		apiKeyHashSalt.getValue.mockRejectedValue(new Error('SSM unavailable'));

		const result = await resolveAuth(event);

		expect(result.tier).toBe('public');
		expect(result.degraded).toBe(true);
		expect(result.isAuthenticated).toBe(false);
		expect(result.identity).toBe('172.16.0.5');
	});

	/* -------------------------------------------------------------- */
	/*  Test 5: Degraded mode — DynamoDB failure                      */
	/* -------------------------------------------------------------- */

	it('should return public tier with degraded=true when DynamoDB throws an error', async () => {
		const event = createEvent({
			headers: { authorization: 'Bearer atl_anotherkey0000000000000000' },
			sourceIp: '10.1.2.3'
		});

		apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');

		// >! DynamoDB throws — auth resolver should degrade gracefully
		AWS.dynamo.get.mockRejectedValue(new Error('DynamoDB connection timeout'));

		const result = await resolveAuth(event);

		expect(result.tier).toBe('public');
		expect(result.degraded).toBe(true);
		expect(result.isAuthenticated).toBe(false);
		expect(result.identity).toBe('10.1.2.3');
	});

	/* -------------------------------------------------------------- */
	/*  Test 6: Expired tier                                          */
	/* -------------------------------------------------------------- */

	it('should return effectiveTier=registered when tierExpiresAt is in the past', async () => {
		const event = createEvent({
			headers: { authorization: 'Bearer atl_expiredtierkey00000000000000' }
		});

		apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');

		// >! User has paid tier but it expired a year ago
		const pastEpoch = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
		const farFutureTtl = Math.floor(Date.now() / 1000) + 200 * 24 * 60 * 60;
		AWS.dynamo.get.mockResolvedValue({
			Item: {
				tier: 'paid',
				cognitoSub: 'sub-expired-456',
				tierExpiresAt: pastEpoch,
				ttl: farFutureTtl
			}
		});

		const result = await resolveAuth(event);

		// Effective tier should be 'registered', not 'paid'
		expect(result.tier).toBe('registered');
		expect(result.identity).toBe('sub-expired-456');
		expect(result.isAuthenticated).toBe(true);
		expect(result.degraded).toBe(false);
	});

	/* -------------------------------------------------------------- */
	/*  Test 7: TTL refresh trigger                                   */
	/* -------------------------------------------------------------- */

	it('should call dynamo.update when free registered user has ttl < 90 days from now', async () => {
		const event = createEvent({
			headers: { authorization: 'Bearer atl_ttlrefreshkey000000000000000' }
		});

		apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');

		// >! Free registered user with TTL only 30 days from now (< 90 day threshold)
		const nowSec = Math.floor(Date.now() / 1000);
		const ttlIn30Days = nowSec + 30 * 24 * 60 * 60;
		AWS.dynamo.get.mockResolvedValue({
			Item: {
				tier: 'registered',
				cognitoSub: 'sub-ttl-refresh-789',
				tierExpiresAt: null,
				ttl: ttlIn30Days
			}
		});

		// >! Mock update to resolve successfully
		AWS.dynamo.update.mockResolvedValue({});

		const result = await resolveAuth(event);

		expect(result.tier).toBe('registered');
		expect(result.isAuthenticated).toBe(true);

		// dynamo.update should have been called to refresh TTL
		expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);

		const updateCall = AWS.dynamo.update.mock.calls[0][0];
		expect(updateCall.UpdateExpression).toContain('#ttl');
		expect(updateCall.ExpressionAttributeValues[':newTtl']).toBeGreaterThan(nowSec + 100 * 24 * 60 * 60);
	});

	/* -------------------------------------------------------------- */
	/*  Test 8: TTL no-refresh                                        */
	/* -------------------------------------------------------------- */

	it('should NOT call dynamo.update when free registered user has ttl >= 90 days from now', async () => {
		const event = createEvent({
			headers: { authorization: 'Bearer atl_ttlnorefreshkey0000000000000' }
		});

		apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');

		// >! Free registered user with TTL 100 days from now (>= 90 day threshold)
		const nowSec = Math.floor(Date.now() / 1000);
		const ttlIn100Days = nowSec + 100 * 24 * 60 * 60;
		AWS.dynamo.get.mockResolvedValue({
			Item: {
				tier: 'registered',
				cognitoSub: 'sub-ttl-norefresh-101',
				tierExpiresAt: null,
				ttl: ttlIn100Days
			}
		});

		const result = await resolveAuth(event);

		expect(result.tier).toBe('registered');
		expect(result.isAuthenticated).toBe(true);

		// dynamo.update should NOT have been called
		expect(AWS.dynamo.update).not.toHaveBeenCalled();
	});
});
