/**
 * Property-Based Tests for Tier-Aware Rate Limiting
 *
 * Feature: 0-0-3-add-authentication, Properties 8, 9
 *
 * Property 8: Tier-to-rate-limit configuration mapping
 * Property 9: Rate limit headers presence
 *
 * Validates: Requirements 6.1, 6.4, 6.5, 6.6
 */

'use strict';

const fc = require('fast-check');

// Mock the @63klabs/cache-data module BEFORE requiring rate-limiter
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), log: jest.fn() },
		AWS: {
			dynamo: {
				get: jest.fn(),
				put: jest.fn(),
				update: jest.fn()
			}
		},
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn()
		}))
	}
}));

// Mock the settings module to control rate limit configs and SSM salt
jest.mock('../../config/settings', () => ({
	sessionHashSalt: { getValue: jest.fn() },
	dynamoDbSessionsTable: 'test-sessions-table',
	rateLimits: {
		public: { limitPerWindow: 50, windowInMinutes: 60 },
		registered: { limitPerWindow: 100, windowInMinutes: 60 },
		paid: { limitPerWindow: 3000, windowInMinutes: 1440 },
		private: { limitPerWindow: 6000, windowInMinutes: 1440 }
	}
}));

const { checkRateLimit, TestHarness } = require('../../utils/rate-limiter');
const settings = require('../../config/settings');
const { tools: { AWS } } = require('@63klabs/cache-data');

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const { cache } = TestHarness.getInternals();

/**
 * Create a minimal API Gateway event for rate limiter testing.
 *
 * @param {string} [sourceIp='10.0.0.1'] - Client IP address
 * @returns {Object} API Gateway event
 */
function createEvent(sourceIp = '10.0.0.1') {
	return {
		headers: {},
		requestContext: { identity: { sourceIp } }
	};
}

/* ------------------------------------------------------------------ */
/*  Setup / Teardown                                                  */
/* ------------------------------------------------------------------ */

beforeEach(() => {
	cache.clear();
	settings.sessionHashSalt.getValue.mockReset();
	settings.sessionHashSalt.getValue.mockResolvedValue('test-salt-tier-rate-limiting');
	AWS.dynamo.get.mockReset();
	AWS.dynamo.put.mockReset();
	AWS.dynamo.update.mockReset();
});

/* ------------------------------------------------------------------ */
/*  Property 8: Tier-to-rate-limit configuration mapping              */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 6.1, 6.4
 *
 * Property 8: Tier-to-rate-limit configuration mapping
 *
 * For any of the four tiers (public, registered, paid, private), the
 * rate limiter SHALL select the limitPerWindow and windowInMinutes
 * values from the corresponding settings.rateLimits[tier] configuration.
 */
describe('Property 8: Tier-to-rate-limit configuration mapping', () => {

	it('each tier selects correct limitPerWindow from settings', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom('public', 'registered', 'paid', 'private'),
				async (tier) => {
					// Reset mocks for each iteration
					cache.clear();
					AWS.dynamo.get.mockReset();
					AWS.dynamo.put.mockReset();

					// >! Mock DynamoDB to return no existing entry (new window)
					AWS.dynamo.get.mockResolvedValue({ Item: null });
					AWS.dynamo.put.mockResolvedValue({});

					const event = createEvent('10.0.0.1');
					const authInfo = {
						tier,
						identity: tier === 'public' ? '10.0.0.1' : `cognito-sub-${tier}`,
						isAuthenticated: tier !== 'public'
					};

					const result = await checkRateLimit(event, settings.rateLimits, authInfo);

					const tierConfig = settings.rateLimits[tier];
					expect(result.headers['X-RateLimit-Limit']).toBe(String(tierConfig.limitPerWindow));
				}
			),
			{ numRuns: 100 }
		);
	});

	it('each tier returns correct remaining count for new window', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom('public', 'registered', 'paid', 'private'),
				async (tier) => {
					cache.clear();
					AWS.dynamo.get.mockReset();
					AWS.dynamo.put.mockReset();

					// >! New window: no existing entry
					AWS.dynamo.get.mockResolvedValue({ Item: null });
					AWS.dynamo.put.mockResolvedValue({});

					const event = createEvent('10.0.0.2');
					const authInfo = {
						tier,
						identity: tier === 'public' ? '10.0.0.2' : `cognito-sub-new-${tier}`,
						isAuthenticated: tier !== 'public'
					};

					const result = await checkRateLimit(event, settings.rateLimits, authInfo);

					const tierConfig = settings.rateLimits[tier];
					// First request in new window: remaining = limitPerWindow - 1
					expect(result.headers['X-RateLimit-Remaining']).toBe(String(tierConfig.limitPerWindow - 1));
				}
			),
			{ numRuns: 100 }
		);
	});
});


/* ------------------------------------------------------------------ */
/*  Property 9: Rate limit headers presence                           */
/* ------------------------------------------------------------------ */

/**
 * Validates: Requirements 6.5, 6.6
 *
 * Property 9: Rate limit headers presence
 *
 * For any request processed by the rate limiter, the response SHALL
 * include X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset
 * headers with valid numeric string values. When the rate limit is
 * exceeded, the response SHALL additionally include a Retry-After header
 * and return HTTP 429.
 */
describe('Property 9: Rate limit headers presence', () => {

	it('all responses include X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset with valid numeric values', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom('public', 'registered', 'paid', 'private'),
				async (tier) => {
					cache.clear();
					AWS.dynamo.get.mockReset();
					AWS.dynamo.put.mockReset();

					// >! Mock DynamoDB for allowed request (new window)
					AWS.dynamo.get.mockResolvedValue({ Item: null });
					AWS.dynamo.put.mockResolvedValue({});

					const event = createEvent('10.0.1.1');
					const authInfo = {
						tier,
						identity: tier === 'public' ? '10.0.1.1' : `cognito-sub-headers-${tier}`,
						isAuthenticated: tier !== 'public'
					};

					const result = await checkRateLimit(event, settings.rateLimits, authInfo);

					// All three standard rate limit headers must be present
					expect(result.headers).toHaveProperty('X-RateLimit-Limit');
					expect(result.headers).toHaveProperty('X-RateLimit-Remaining');
					expect(result.headers).toHaveProperty('X-RateLimit-Reset');

					// All header values must be valid numeric strings (not NaN, not undefined)
					const limit = Number(result.headers['X-RateLimit-Limit']);
					const remaining = Number(result.headers['X-RateLimit-Remaining']);
					const reset = Number(result.headers['X-RateLimit-Reset']);

					expect(isNaN(limit)).toBe(false);
					expect(isNaN(remaining)).toBe(false);
					expect(isNaN(reset)).toBe(false);

					expect(limit).toBeGreaterThan(0);
					expect(remaining).toBeGreaterThanOrEqual(0);
					expect(reset).toBeGreaterThan(0);
				}
			),
			{ numRuns: 100 }
		);
	});

	it('429 responses include Retry-After header when rate limit exceeded', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom('public', 'registered', 'paid', 'private'),
				async (tier) => {
					cache.clear();
					AWS.dynamo.get.mockReset();
					AWS.dynamo.put.mockReset();
					AWS.dynamo.update.mockReset();

					const tierConfig = settings.rateLimits[tier];
					const futureTtl = Math.floor(Date.now() / 1000) + 3600;

					// >! Mock DynamoDB to return an exhausted rate limit entry
					AWS.dynamo.get.mockResolvedValue({
						Item: {
							remaining: 0,
							limit: tierConfig.limitPerWindow,
							ttl: futureTtl
						}
					});

					// >! Mock update to throw ConditionalCheckFailedException (remaining is 0)
					const conditionalError = new Error('The conditional request failed');
					conditionalError.name = 'ConditionalCheckFailedException';
					AWS.dynamo.update.mockRejectedValue(conditionalError);

					const event = createEvent('10.0.2.1');
					const authInfo = {
						tier,
						identity: tier === 'public' ? '10.0.2.1' : `cognito-sub-limited-${tier}`,
						isAuthenticated: tier !== 'public'
					};

					const result = await checkRateLimit(event, settings.rateLimits, authInfo);

					// Request should be denied
					expect(result.allowed).toBe(false);

					// Standard headers must still be present
					expect(result.headers).toHaveProperty('X-RateLimit-Limit');
					expect(result.headers).toHaveProperty('X-RateLimit-Remaining');
					expect(result.headers).toHaveProperty('X-RateLimit-Reset');

					// 429 response must include Retry-After
					expect(result.headers).toHaveProperty('Retry-After');

					// Retry-After must be a valid positive numeric string
					const retryAfter = Number(result.headers['Retry-After']);
					expect(isNaN(retryAfter)).toBe(false);
					expect(retryAfter).toBeGreaterThan(0);

					// Remaining should be 0
					expect(result.headers['X-RateLimit-Remaining']).toBe('0');
				}
			),
			{ numRuns: 100 }
		);
	});
});
