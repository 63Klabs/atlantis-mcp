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
		DebugAndLog: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), log: jest.fn(), info: jest.fn() },
		// >! Only DynamoDB is mocked: the Read function has no Cognito client, so a
		// >! restore or downgrade that reached for another AWS client would fail.
		AWS: {
			dynamo: {
				get: jest.fn(),
				update: jest.fn(),
				put: jest.fn(),
				delete: jest.fn(),
				scan: jest.fn(),
				query: jest.fn()
			}
		},
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn()
		}))
	}
}));

const { resolveAuth, TestHarness } = require('../../../utils/auth-resolver');
const { apiKeyHashSalt } = TestHarness.getInternals();
const { tools: { AWS, DebugAndLog } } = require('@63klabs/cache-data');

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
		DebugAndLog.warn.mockClear();
		DebugAndLog.debug.mockClear();
		DebugAndLog.info.mockClear();
		DebugAndLog.error.mockClear();
		DebugAndLog.log.mockClear();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	/* -------------------------------------------------------------- */
	/*  Test 1: No key — public tier                                  */
	/* -------------------------------------------------------------- */

	it('should return public tier with sourceIp identity when no API key header is present', async () => {
		const event = createEvent({ sourceIp: '10.0.0.42' });

		// >! The caller passes the resolved client address; the event is not read for it
		const result = await resolveAuth(event, event.requestContext.identity.sourceIp);

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
		// Requirement 24.4: the 401 body has no known request id, so it carries no id member
		expect(body).not.toHaveProperty('id');
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

		const result = await resolveAuth(event, event.requestContext.identity.sourceIp);

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

		const result = await resolveAuth(event, event.requestContext.identity.sourceIp);

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
		// >! tierExpiresAt is an ISO 8601 string (spec 0-0-7-lapsed-tier-downgrade)
		const pastIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
		const farFutureTtl = Math.floor(Date.now() / 1000) + 200 * 24 * 60 * 60;
		AWS.dynamo.get.mockResolvedValue({
			Item: {
				tier: 'paid',
				cognitoSub: 'sub-expired-456',
				tierExpiresAt: pastIso,
				ttl: farFutureTtl
			}
		});
		// >! A lapsed record is written back (Downgrade); the write is not awaited by the request
		AWS.dynamo.update.mockResolvedValue({});

		const result = await resolveAuth(event);

		// Effective tier should be 'registered', not 'paid'
		expect(result.tier).toBe('registered');
		expect(result.identity).toBe('sub-expired-456');
		expect(result.isAuthenticated).toBe(true);
		expect(result.degraded).toBe(false);

		// The Downgrade is issued exactly once (spec 0-0-7-lapsed-tier-downgrade, Requirement 9.1)
		expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
		expect(AWS.dynamo.update.mock.calls[0][0].ExpressionAttributeValues[':toTier']).toBe('registered');
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

	/* -------------------------------------------------------------- */
	/*  Test 9: TTL refresh for paid and private tiers                */
	/*  (spec 0-0-7-lapsed-tier-downgrade, Requirements 2.2, 3.3)     */
	/* -------------------------------------------------------------- */

	describe.each(['paid', 'private'])('%s record with no end date', (tier) => {

		it('should call dynamo.update once with the existence condition when ttl < 90 days from now', async () => {
			const event = createEvent({
				headers: { authorization: 'Bearer atl_ttlrefreshkey000000000000000' }
			});

			apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');

			const nowSec = Math.floor(Date.now() / 1000);
			AWS.dynamo.get.mockResolvedValue({
				Item: {
					tier,
					cognitoSub: `sub-${tier}-renew`,
					tierExpiresAt: null,
					ttl: nowSec + 30 * 24 * 60 * 60
				}
			});
			AWS.dynamo.update.mockResolvedValue({});

			const result = await resolveAuth(event);

			expect(result.tier).toBe(tier);
			expect(result.isAuthenticated).toBe(true);

			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			const updateCall = AWS.dynamo.update.mock.calls[0][0];
			expect(updateCall.ConditionExpression).toBe('attribute_exists(#pk)');
			expect(updateCall.ExpressionAttributeNames).toEqual({ '#pk': 'pk', '#ttl': 'ttl' });
			expect(updateCall.ExpressionAttributeValues[':newTtl']).toBeGreaterThan(nowSec + 100 * 24 * 60 * 60);
		});

		it('should NOT call dynamo.update when ttl >= 90 days from now', async () => {
			const event = createEvent({
				headers: { authorization: 'Bearer atl_ttlnorefreshkey0000000000000' }
			});

			apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');

			const nowSec = Math.floor(Date.now() / 1000);
			AWS.dynamo.get.mockResolvedValue({
				Item: {
					tier,
					cognitoSub: `sub-${tier}-norenew`,
					tierExpiresAt: null,
					ttl: nowSec + 100 * 24 * 60 * 60
				}
			});

			const result = await resolveAuth(event);

			expect(result.tier).toBe(tier);
			expect(AWS.dynamo.update).not.toHaveBeenCalled();
		});
	});

	/* -------------------------------------------------------------- */
	/*  Test 10: TTL refresh write failures are non-blocking          */
	/*  (Requirements 2.2, 2.3, 3.4)                                  */
	/* -------------------------------------------------------------- */

	describe('TTL refresh write outcome', () => {

		const TTL_REFRESH_FAILED = 'Auth resolver: TTL refresh failed (non-blocking)';

		/**
		 * Resolve a request for a registered user whose renewal is due, with the
		 * given outcome for the fire-and-forget `update`, then flush pending promises.
		 *
		 * @param {function(): Promise<Object>} updateImpl - Implementation for AWS.dynamo.update
		 * @returns {Promise<Object>} The resolveAuth result
		 */
		async function resolveWithRenewalDue(updateImpl) {
			const event = createEvent({
				headers: { authorization: 'Bearer atl_ttlwriteoutcomekey00000000000' }
			});

			apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');

			const nowSec = Math.floor(Date.now() / 1000);
			AWS.dynamo.get.mockResolvedValue({
				Item: {
					tier: 'registered',
					cognitoSub: 'sub-write-outcome',
					tierExpiresAt: null,
					ttl: nowSec + 30 * 24 * 60 * 60
				}
			});
			AWS.dynamo.update.mockImplementation(updateImpl);

			const result = await resolveAuth(event);

			// Let the un-awaited update promise and its catch handler run
			await new Promise(setImmediate);

			return result;
		}

		it('should not warn when update rejects with ConditionalCheckFailedException', async () => {
			const conditionalFailure = Object.assign(new Error('The conditional request failed'), {
				name: 'ConditionalCheckFailedException'
			});

			const result = await resolveWithRenewalDue(() => Promise.reject(conditionalFailure));

			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			expect(DebugAndLog.warn).not.toHaveBeenCalled();
			expect(result.tier).toBe('registered');
			expect(result.isAuthenticated).toBe(true);
		});

		it('should warn once when update rejects with another error', async () => {
			const result = await resolveWithRenewalDue(() => Promise.reject(new Error('Throttled')));

			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			expect(DebugAndLog.warn).toHaveBeenCalledTimes(1);
			expect(DebugAndLog.warn.mock.calls[0][0]).toBe(TTL_REFRESH_FAILED);
			expect(result.tier).toBe('registered');
			expect(result.isAuthenticated).toBe(true);
		});

		it('should return the same result whether update resolves or rejects', async () => {
			const resolved = await resolveWithRenewalDue(() => Promise.resolve({}));
			expect(DebugAndLog.warn).not.toHaveBeenCalled();

			const conditional = await resolveWithRenewalDue(() => Promise.reject(
				Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' })
			));

			const otherError = await resolveWithRenewalDue(() => Promise.reject(new Error('Throttled')));

			expect(conditional).toEqual(resolved);
			expect(otherError).toEqual(resolved);
		});
	});
});

/* ------------------------------------------------------------------ */
/*  Phase 2: lapsed tier Downgrade, Restore, and the GetItem          */
/*  projection (spec 0-0-7-lapsed-tier-downgrade, Design 7, 8, 11)    */
/*  Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 9.7, 10.1, 10.2, 10.3,    */
/*  10.4, 14.1, 14.4, 14.5, 15.5, 15.6, 15.8, 15.12, 19.6-19.9,      */
/*  19.14                                                             */
/* ------------------------------------------------------------------ */

describe('Auth Resolver — lapsed tier Downgrade and Restore', () => {

	const crypto = require('crypto');

	const SALT = 'unit-test-salt-value';
	const RAW_KEY = 'atl_lapsedtierkey0000000000000000';
	const COGNITO_SUB = 'sub-lapse-3f9a1c7e-unique';
	const DAY_MS = 24 * 60 * 60 * 1000;
	const DAY_SEC = 24 * 60 * 60;

	const TIER_DOWNGRADE_FAILED = 'Auth resolver: tier downgrade failed (non-blocking)';
	const TIER_DOWNGRADE_SKIPPED = 'Auth resolver: tier downgrade skipped, user record changed or removed';

	// >! The pk the resolver derives from RAW_KEY and SALT (same scrypt parameters as resolveAuth)
	const KEY_HASH = crypto.scryptSync(RAW_KEY, SALT, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
	const PK = `KEY#${KEY_HASH}`;

	const pastIso = () => new Date(Date.now() - 30 * DAY_MS).toISOString();
	const futureIso = () => new Date(Date.now() + 200 * DAY_MS).toISOString();
	const farTtl = () => Math.floor(Date.now() / 1000) + 200 * DAY_SEC;
	const soonTtl = () => Math.floor(Date.now() / 1000) + 30 * DAY_SEC;

	/**
	 * Resolve a request for the given stored record, with the given outcome for
	 * the fire-and-forget `update`, then flush pending promises.
	 *
	 * @param {Object} item - User record returned by the mocked GetItem
	 * @param {function(): Promise<Object>} [updateImpl] - Implementation for AWS.dynamo.update
	 * @returns {Promise<Object>} The resolveAuth result
	 */
	async function resolveRecord(item, updateImpl = () => Promise.resolve({})) {
		apiKeyHashSalt.getValue.mockResolvedValue(SALT);
		AWS.dynamo.get.mockResolvedValue({ Item: { cognitoSub: COGNITO_SUB, ttl: farTtl(), ...item } });
		AWS.dynamo.update.mockImplementation(updateImpl);

		const result = await resolveAuth(createEvent({
			headers: { authorization: `Bearer ${RAW_KEY}` }
		}));

		// Let the un-awaited update promise and its handlers run
		await new Promise(setImmediate);

		return result;
	}

	/**
	 * Parse the JSON payload of a `NAME {json}` log line.
	 *
	 * @param {string} line - Log message
	 * @param {string} name - Event name prefix
	 * @returns {Object} Parsed payload
	 */
	function payloadOf(line, name) {
		expect(line.startsWith(`${name} `)).toBe(true);
		return JSON.parse(line.slice(name.length + 1));
	}

	beforeEach(() => {
		apiKeyHashSalt.getValue.mockReset();
		AWS.dynamo.get.mockReset();
		AWS.dynamo.update.mockReset();
		DebugAndLog.warn.mockClear();
		DebugAndLog.debug.mockClear();
		DebugAndLog.info.mockClear();
		DebugAndLog.error.mockClear();
		DebugAndLog.log.mockClear();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	/* -------------------------------------------------------------- */
	/*  TestHarness exposure                                          */
	/* -------------------------------------------------------------- */

	it('should expose maintainUserRecord and downgradeLapsedTier through the TestHarness', () => {
		const internals = TestHarness.getInternals();

		expect(typeof internals.maintainUserRecord).toBe('function');
		expect(typeof internals.downgradeLapsedTier).toBe('function');
	});

	/* -------------------------------------------------------------- */
	/*  Downgrade to registered (no valid fallback)                   */
	/* -------------------------------------------------------------- */

	describe('lapsed record with no valid fallback', () => {

		it('should issue one update with the registered attributes, names, condition, and REMOVE clause', async () => {
			const lapsedAt = pastIso();
			const nowSec = Math.floor(Date.now() / 1000);

			const result = await resolveRecord({ tier: 'paid', tierExpiresAt: lapsedAt });

			expect(result.tier).toBe('registered');
			expect(result.isAuthenticated).toBe(true);

			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			const call = AWS.dynamo.update.mock.calls[0][0];

			expect(call.TableName).toBe(process.env.MCP_DYNAMODB_USERS_TABLE || '');
			expect(call.Key).toEqual({ pk: PK });
			expect(call.UpdateExpression).toBe(
				'SET #tier = :toTier, #exp = :toExpiry, #ttl = :newTtl REMOVE #fbTier, #fbExp'
			);
			expect(call.ConditionExpression).toBe(
				'attribute_exists(#pk) AND #tier = :readTier AND #exp = :readExpiry'
			);
			expect(call.ExpressionAttributeNames).toEqual({
				'#pk': 'pk',
				'#tier': 'tier',
				'#exp': 'tierExpiresAt',
				'#ttl': 'ttl',
				'#fbTier': 'fallbackTier',
				'#fbExp': 'fallbackExpiresAt'
			});

			const values = call.ExpressionAttributeValues;
			expect(values[':toTier']).toBe('registered');
			expect(values[':toExpiry']).toBeNull();
			expect(values[':readTier']).toBe('paid');
			expect(values[':readExpiry']).toBe(lapsedAt);
			// >! ttl is now + 120 days with no 90-day check (the stored ttl here is 200 days out)
			expect(Object.keys(values).sort()).toEqual([':newTtl', ':readExpiry', ':readTier', ':toExpiry', ':toTier']);
			expect(values[':newTtl']).toBeGreaterThanOrEqual(nowSec + 120 * DAY_SEC - 2);
			expect(values[':newTtl']).toBeLessThanOrEqual(nowSec + 120 * DAY_SEC + 2);
		});

		it('should not issue a renewal in addition to the Downgrade when ttl is also within 90 days', async () => {
			const result = await resolveRecord({ tier: 'private', tierExpiresAt: pastIso(), ttl: soonTtl() });

			expect(result.tier).toBe('registered');
			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			const call = AWS.dynamo.update.mock.calls[0][0];
			expect(call.UpdateExpression).toContain('REMOVE #fbTier, #fbExp');
			expect(call.ExpressionAttributeValues[':toTier']).toBe('registered');
		});

		it.each([
			['registered fallback (not above registered)', { fallbackTier: 'registered', fallbackExpiresAt: null }, 'paid'],
			['public fallback', { fallbackTier: 'public', fallbackExpiresAt: null }, 'paid'],
			['unknown fallback tier', { fallbackTier: 'platinum', fallbackExpiresAt: null }, 'paid'],
			['inherited-property fallback tier', { fallbackTier: 'constructor', fallbackExpiresAt: null }, 'paid'],
			['fallback that outranks the lapsed tier', { fallbackTier: 'private', fallbackExpiresAt: null }, 'paid'],
			['fallback equal to the lapsed tier', { fallbackTier: 'paid', fallbackExpiresAt: null }, 'paid'],
			['lapsed fallback end date', { fallbackTier: 'paid', fallbackExpiresAt: pastIso() }, 'private']
		])('should write registered, with the REMOVE clause, for a %s', async (_label, fallback, storedTier) => {
			const result = await resolveRecord({ tier: storedTier, tierExpiresAt: pastIso(), ...fallback });

			expect(result.tier).toBe('registered');
			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			const call = AWS.dynamo.update.mock.calls[0][0];
			expect(call.UpdateExpression).toBe(
				'SET #tier = :toTier, #exp = :toExpiry, #ttl = :newTtl REMOVE #fbTier, #fbExp'
			);
			expect(call.ExpressionAttributeValues[':toTier']).toBe('registered');
			expect(call.ExpressionAttributeValues[':toExpiry']).toBeNull();
			// >! A fallback that is merely invalid or lapsed is not malformed: no warning
			expect(DebugAndLog.warn).not.toHaveBeenCalled();
		});

		it('should write registered and log one TIER_EXPIRY_MALFORMED warning for a malformed fallback end date', async () => {
			const result = await resolveRecord({
				tier: 'private',
				tierExpiresAt: pastIso(),
				fallbackTier: 'paid',
				fallbackExpiresAt: 'not-a-date'
			});

			expect(result.tier).toBe('registered');

			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			const call = AWS.dynamo.update.mock.calls[0][0];
			expect(call.ExpressionAttributeValues[':toTier']).toBe('registered');
			expect(call.UpdateExpression).toContain('REMOVE #fbTier, #fbExp');

			expect(DebugAndLog.warn).toHaveBeenCalledTimes(1);
			const payload = payloadOf(DebugAndLog.warn.mock.calls[0][0], 'TIER_EXPIRY_MALFORMED');
			expect(payload.field).toBe('fallbackExpiresAt');
		});
	});

	/* -------------------------------------------------------------- */
	/*  Restore of a valid fallback                                   */
	/* -------------------------------------------------------------- */

	describe('lapsed record with a valid fallback', () => {

		it('should restore the fallback tier and its end date, with the REMOVE clause, and serve the request at that tier', async () => {
			const lapsedAt = pastIso();
			const fallbackEnd = futureIso();

			const result = await resolveRecord({
				tier: 'private',
				tierExpiresAt: lapsedAt,
				fallbackTier: 'paid',
				fallbackExpiresAt: fallbackEnd
			});

			expect(result.tier).toBe('paid');
			expect(result.isAuthenticated).toBe(true);
			expect(result.identity).toBe(COGNITO_SUB);

			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			const call = AWS.dynamo.update.mock.calls[0][0];
			expect(call.UpdateExpression).toBe(
				'SET #tier = :toTier, #exp = :toExpiry, #ttl = :newTtl REMOVE #fbTier, #fbExp'
			);
			expect(call.ConditionExpression).toBe(
				'attribute_exists(#pk) AND #tier = :readTier AND #exp = :readExpiry'
			);
			const values = call.ExpressionAttributeValues;
			expect(values[':toTier']).toBe('paid');
			expect(values[':toExpiry']).toBe(fallbackEnd);
			expect(values[':readTier']).toBe('private');
			expect(values[':readExpiry']).toBe(lapsedAt);
		});

		it('should restore a fallback with no end date as a null end date', async () => {
			const result = await resolveRecord({
				tier: 'private',
				tierExpiresAt: pastIso(),
				fallbackTier: 'paid',
				fallbackExpiresAt: null
			});

			expect(result.tier).toBe('paid');
			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			const values = AWS.dynamo.update.mock.calls[0][0].ExpressionAttributeValues;
			expect(values[':toTier']).toBe('paid');
			expect(values[':toExpiry']).toBeNull();
		});

		it('should serve the request at the restored tier even when the update fails', async () => {
			const result = await resolveRecord({
				tier: 'private',
				tierExpiresAt: pastIso(),
				fallbackTier: 'paid',
				fallbackExpiresAt: futureIso()
			}, () => Promise.reject(new Error('Throttled')));

			expect(result.tier).toBe('paid');
		});
	});

	/* -------------------------------------------------------------- */
	/*  States that never get a Downgrade                             */
	/* -------------------------------------------------------------- */

	describe('records that are not lapsed', () => {

		it.each([
			['none (null end date)', { tier: 'paid', tierExpiresAt: null }, 'paid'],
			['none (absent end date)', { tier: 'private' }, 'private'],
			['active', { tier: 'paid', tierExpiresAt: futureIso() }, 'paid'],
			['malformed', { tier: 'paid', tierExpiresAt: 'garbage' }, 'registered'],
			['malformed (non-string)', { tier: 'private', tierExpiresAt: 1767225600 }, 'registered']
		])('should not downgrade a %s record', async (_label, item, expectedTier) => {
			const result = await resolveRecord(item);

			expect(result.tier).toBe(expectedTier);
			// >! ttl is 200 days out, so no renewal either: no write at all
			expect(AWS.dynamo.update).not.toHaveBeenCalled();
			expect(DebugAndLog.info).not.toHaveBeenCalled();
		});

		it('should ignore a fallback on an active record', async () => {
			const result = await resolveRecord({
				tier: 'private',
				tierExpiresAt: futureIso(),
				fallbackTier: 'paid',
				fallbackExpiresAt: futureIso()
			});

			expect(result.tier).toBe('private');
			expect(AWS.dynamo.update).not.toHaveBeenCalled();
		});

		it('should renew (not downgrade) an active record whose ttl is within 90 days', async () => {
			const result = await resolveRecord({ tier: 'paid', tierExpiresAt: futureIso(), ttl: soonTtl() });

			expect(result.tier).toBe('paid');
			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			const call = AWS.dynamo.update.mock.calls[0][0];
			expect(call.UpdateExpression).toBe('SET #ttl = :newTtl');
			expect(call.ConditionExpression).toBe('attribute_exists(#pk)');
			expect(DebugAndLog.info).not.toHaveBeenCalled();
		});

		it('should renew (not downgrade) a malformed record whose ttl is within 90 days, and keep the stored value', async () => {
			const result = await resolveRecord({ tier: 'paid', tierExpiresAt: 'garbage', ttl: soonTtl() });

			expect(result.tier).toBe('registered');
			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			const call = AWS.dynamo.update.mock.calls[0][0];
			expect(call.UpdateExpression).toBe('SET #ttl = :newTtl');
			expect(Object.keys(call.ExpressionAttributeValues)).toEqual([':newTtl']);
		});
	});

	/* -------------------------------------------------------------- */
	/*  Log lines and write outcomes                                  */
	/* -------------------------------------------------------------- */

	describe('Downgrade write outcome', () => {

		it('should log TIER_LAPSE_DOWNGRADE only after the update resolves, with fromTier and toTier', async () => {
			let resolveUpdate;
			const pending = new Promise((resolve) => {
				resolveUpdate = resolve;
			});

			const result = await resolveRecord({ tier: 'paid', tierExpiresAt: pastIso() }, () => pending);

			// >! The request has returned and the update is still pending: no line yet
			expect(result.tier).toBe('registered');
			expect(DebugAndLog.info).not.toHaveBeenCalled();

			resolveUpdate({});
			await new Promise(setImmediate);

			expect(DebugAndLog.info).toHaveBeenCalledTimes(1);
			const payload = payloadOf(DebugAndLog.info.mock.calls[0][0], 'TIER_LAPSE_DOWNGRADE');
			expect(payload).toEqual({ fromTier: 'paid', toTier: 'registered' });
		});

		it('should log TIER_LAPSE_DOWNGRADE with the restored tier as toTier for a Restore', async () => {
			await resolveRecord({
				tier: 'private',
				tierExpiresAt: pastIso(),
				fallbackTier: 'paid',
				fallbackExpiresAt: futureIso()
			});

			expect(DebugAndLog.info).toHaveBeenCalledTimes(1);
			const payload = payloadOf(DebugAndLog.info.mock.calls[0][0], 'TIER_LAPSE_DOWNGRADE');
			expect(payload).toEqual({ fromTier: 'private', toTier: 'paid' });
		});

		it('should log at debug level only when the update fails its condition', async () => {
			const conditionalFailure = Object.assign(new Error('The conditional request failed'), {
				name: 'ConditionalCheckFailedException'
			});

			const result = await resolveRecord(
				{ tier: 'paid', tierExpiresAt: pastIso() },
				() => Promise.reject(conditionalFailure)
			);

			expect(result.tier).toBe('registered');
			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			expect(DebugAndLog.warn).not.toHaveBeenCalled();
			expect(DebugAndLog.info).not.toHaveBeenCalled();
			expect(DebugAndLog.debug).toHaveBeenCalledWith(TIER_DOWNGRADE_SKIPPED);
		});

		it('should log one warning when the update fails for another reason', async () => {
			const result = await resolveRecord(
				{ tier: 'paid', tierExpiresAt: pastIso() },
				() => Promise.reject(new Error('Throttled'))
			);

			expect(result.tier).toBe('registered');
			expect(DebugAndLog.warn).toHaveBeenCalledTimes(1);
			expect(DebugAndLog.warn.mock.calls[0][0]).toBe(TIER_DOWNGRADE_FAILED);
			expect(DebugAndLog.info).not.toHaveBeenCalled();
		});

		it('should return the same result whether the update resolves, fails its condition, or fails otherwise', async () => {
			const item = { tier: 'paid', tierExpiresAt: pastIso() };

			const resolved = await resolveRecord(item);
			const conditional = await resolveRecord(item, () => Promise.reject(
				Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' })
			));
			const otherError = await resolveRecord(item, () => Promise.reject(new Error('Throttled')));

			expect(conditional).toEqual(resolved);
			expect(otherError).toEqual(resolved);
		});
	});

	/* -------------------------------------------------------------- */
	/*  One write, no other calls                                     */
	/* -------------------------------------------------------------- */

	describe('write budget and isolation', () => {

		it.each([
			['lapsed, no fallback', { tier: 'paid', tierExpiresAt: pastIso() }],
			['lapsed, valid fallback', { tier: 'private', tierExpiresAt: pastIso(), fallbackTier: 'paid', fallbackExpiresAt: null }],
			['lapsed, ttl within 90 days', { tier: 'paid', tierExpiresAt: pastIso(), ttl: soonTtl() }],
			['none, ttl within 90 days', { tier: 'paid', tierExpiresAt: null, ttl: soonTtl() }]
		])('should issue exactly one update per resolveAuth for a %s record', async (_label, item) => {
			await resolveRecord(item);

			expect(AWS.dynamo.get).toHaveBeenCalledTimes(1);
			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
		});

		it.each([
			['Downgrade', { tier: 'paid', tierExpiresAt: pastIso() }],
			['Restore', { tier: 'private', tierExpiresAt: pastIso(), fallbackTier: 'paid', fallbackExpiresAt: futureIso() }]
		])('should make no call other than the one AWS.dynamo.update on a %s', async (_label, item) => {
			await resolveRecord(item);

			// >! Nothing reaches Cognito: the Read function has no Cognito client, and the
			// >! mocked AWS object offers nothing but DynamoDB
			expect(Object.keys(AWS)).toEqual(['dynamo']);
			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			expect(AWS.dynamo.put).not.toHaveBeenCalled();
			expect(AWS.dynamo.delete).not.toHaveBeenCalled();
			expect(AWS.dynamo.scan).not.toHaveBeenCalled();
			expect(AWS.dynamo.query).not.toHaveBeenCalled();
			expect(DebugAndLog.error).not.toHaveBeenCalled();
		});
	});

	/* -------------------------------------------------------------- */
	/*  GetItem projection (Design 8)                                 */
	/* -------------------------------------------------------------- */

	describe('GetItem projection', () => {

		it('should request only the attributes auth resolution uses', async () => {
			await resolveRecord({ tier: 'registered', tierExpiresAt: null });

			expect(AWS.dynamo.get).toHaveBeenCalledTimes(1);
			const call = AWS.dynamo.get.mock.calls[0][0];

			expect(call.Key).toEqual({ pk: PK });
			expect(call.ProjectionExpression).toBe('#pk, #tier, #exp, #ttl, #sub, #fbTier, #fbExp');
			expect(call.ExpressionAttributeNames).toEqual({
				'#pk': 'pk',
				'#tier': 'tier',
				'#exp': 'tierExpiresAt',
				'#ttl': 'ttl',
				'#sub': 'cognitoSub',
				'#fbTier': 'fallbackTier',
				'#fbExp': 'fallbackExpiresAt'
			});
		});
	});

	/* -------------------------------------------------------------- */
	/*  Log hygiene                                                   */
	/* -------------------------------------------------------------- */

	describe('log hygiene', () => {

		/**
		 * Flatten every argument of every DebugAndLog call into one string.
		 *
		 * @returns {string} All logged text
		 */
		function allLoggedText() {
			const parts = [];
			for (const fn of ['error', 'warn', 'debug', 'log', 'info']) {
				for (const args of DebugAndLog[fn].mock.calls) {
					for (const arg of args) {
						if (typeof arg === 'string') {
							parts.push(arg);
						} else if (arg instanceof Error) {
							parts.push(arg.message, arg.stack || '');
						} else {
							parts.push(JSON.stringify(arg));
						}
					}
				}
			}
			return parts.join('\n');
		}

		it.each([
			['resolves', () => Promise.resolve({})],
			['fails its condition', () => Promise.reject(
				Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' })
			)],
			['fails otherwise', () => Promise.reject(new Error('Throttled'))]
		])('should log no pk, cognitoSub, or raw key when the Downgrade update %s', async (_label, updateImpl) => {
			await resolveRecord({ tier: 'paid', tierExpiresAt: pastIso() }, updateImpl);

			const text = allLoggedText();
			// >! Guard against a vacuous pass: the Downgrade must have been attempted and logged
			expect(AWS.dynamo.update).toHaveBeenCalledTimes(1);
			expect(text.length).toBeGreaterThan(0);

			expect(text).not.toContain(PK);
			expect(text).not.toContain(KEY_HASH);
			expect(text).not.toContain(COGNITO_SUB);
			expect(text).not.toContain(RAW_KEY);
		});

		it('should log no pk, cognitoSub, or raw key for a Restore or a malformed fallback end date', async () => {
			await resolveRecord({
				tier: 'private',
				tierExpiresAt: pastIso(),
				fallbackTier: 'paid',
				fallbackExpiresAt: futureIso()
			});
			await resolveRecord({
				tier: 'private',
				tierExpiresAt: pastIso(),
				fallbackTier: 'paid',
				fallbackExpiresAt: 'not-a-date'
			});

			const text = allLoggedText();
			expect(text).toContain('TIER_LAPSE_DOWNGRADE');
			expect(text).toContain('TIER_EXPIRY_MALFORMED');
			expect(text).not.toContain(PK);
			expect(text).not.toContain(KEY_HASH);
			expect(text).not.toContain(COGNITO_SUB);
			expect(text).not.toContain(RAW_KEY);
		});
	});
});

/* ------------------------------------------------------------------ */
/*  Public identity comes from the caller (spec                       */
/*  0-0-7-rate-limit-client-ip-spoofing, Design Component 4)          */
/*  Requirements: 3.2, 10.4                                           */
/* ------------------------------------------------------------------ */

describe('Auth Resolver — resolveAuth() without a client address', () => {

	// >! The event carries a sourceIp and a forwarding header. resolveAuth must read neither:
	// >! the public identity is the second argument, and with no second argument it is null.
	const SOURCE_IP = '198.51.100.7';
	const FORWARDED_FOR = '203.0.113.9, 198.51.100.7';

	/**
	 * Build an event that carries client-controlled and gateway-reported addresses.
	 *
	 * @param {Object} [headers] - Extra request headers (for example, the API key)
	 * @returns {Object} API Gateway proxy event
	 */
	function createEventWithAddresses(headers = {}) {
		const event = createEvent({
			headers: { 'X-Forwarded-For': FORWARDED_FOR, ...headers },
			sourceIp: SOURCE_IP
		});
		expect(event.requestContext.identity.sourceIp).toBe(SOURCE_IP);
		return event;
	}

	beforeEach(() => {
		apiKeyHashSalt.getValue.mockReset();
		AWS.dynamo.get.mockReset();
		AWS.dynamo.update.mockReset();
		DebugAndLog.warn.mockClear();
		DebugAndLog.error.mockClear();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('should return identity null on the no-key path', async () => {
		const result = await resolveAuth(createEventWithAddresses());

		expect(result.tier).toBe('public');
		expect(result.identity).toBeNull();
		expect(result.isAuthenticated).toBe(false);
		expect(result.degraded).toBe(false);
	});

	it('should return identity null when the hash salt is unavailable', async () => {
		apiKeyHashSalt.getValue.mockRejectedValue(new Error('SSM unavailable'));

		const result = await resolveAuth(createEventWithAddresses({
			authorization: 'Bearer atl_noaddrsaltthrows0000000000000'
		}));

		expect(result.tier).toBe('public');
		expect(result.identity).toBeNull();
		expect(result.isAuthenticated).toBe(false);
		expect(result.degraded).toBe(true);
	});

	it('should return identity null when the hash salt is empty', async () => {
		apiKeyHashSalt.getValue.mockResolvedValue('');

		const result = await resolveAuth(createEventWithAddresses({
			authorization: 'Bearer atl_noaddrsaltempty00000000000000'
		}));

		expect(result.tier).toBe('public');
		expect(result.identity).toBeNull();
		expect(result.isAuthenticated).toBe(false);
		expect(result.degraded).toBe(true);
	});

	it('should return identity null when the Users table read fails', async () => {
		apiKeyHashSalt.getValue.mockResolvedValue('unit-test-salt-value');
		AWS.dynamo.get.mockRejectedValue(new Error('DynamoDB connection timeout'));

		const result = await resolveAuth(createEventWithAddresses({
			authorization: 'Bearer atl_noaddrdynamofail0000000000000'
		}));

		expect(result.tier).toBe('public');
		expect(result.identity).toBeNull();
		expect(result.isAuthenticated).toBe(false);
		expect(result.degraded).toBe(true);
	});
});
