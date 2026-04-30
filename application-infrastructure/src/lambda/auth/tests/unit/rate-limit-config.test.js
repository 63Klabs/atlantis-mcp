// Feature: 0-0-3-user-profile-enhancement, Unit tests for rate limit config utility
'use strict';

const { getRateLimitConfig, TestHarness } = require('../../utils/rate-limit-config');
const { REQUIRED_TIERS, TIER_ENV_VARS } = TestHarness.getInternals();

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Set all rate limit environment variables to valid defaults.
 */
function setAllEnvVars() {
	process.env.MCP_PUBLIC_RATE_LIMIT = '50';
	process.env.MCP_PUBLIC_RATE_TIME_RANGE_MINUTES = '60';
	process.env.MCP_REGISTERED_RATE_LIMIT = '100';
	process.env.MCP_REGISTERED_RATE_TIME_RANGE_MINUTES = '60';
	process.env.MCP_PAID_RATE_LIMIT = '3000';
	process.env.MCP_PAID_RATE_TIME_RANGE_MINUTES = '1440';
	process.env.MCP_PRIVATE_RATE_LIMIT = '6000';
	process.env.MCP_PRIVATE_RATE_TIME_RANGE_MINUTES = '1440';
}

/**
 * Clear all rate limit environment variables.
 */
function clearAllEnvVars() {
	delete process.env.MCP_PUBLIC_RATE_LIMIT;
	delete process.env.MCP_PUBLIC_RATE_TIME_RANGE_MINUTES;
	delete process.env.MCP_REGISTERED_RATE_LIMIT;
	delete process.env.MCP_REGISTERED_RATE_TIME_RANGE_MINUTES;
	delete process.env.MCP_PAID_RATE_LIMIT;
	delete process.env.MCP_PAID_RATE_TIME_RANGE_MINUTES;
	delete process.env.MCP_PRIVATE_RATE_LIMIT;
	delete process.env.MCP_PRIVATE_RATE_TIME_RANGE_MINUTES;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('getRateLimitConfig', () => {
	beforeEach(() => {
		setAllEnvVars();
	});

	afterEach(() => {
		clearAllEnvVars();
	});

	it('should return config for all four tiers when env vars are set', () => {
		const config = getRateLimitConfig();

		expect(config).toEqual({
			public: { limitPerWindow: 50, windowInMinutes: 60 },
			registered: { limitPerWindow: 100, windowInMinutes: 60 },
			paid: { limitPerWindow: 3000, windowInMinutes: 1440 },
			private: { limitPerWindow: 6000, windowInMinutes: 1440 }
		});
	});

	it('should return numeric values parsed from string env vars', () => {
		process.env.MCP_PUBLIC_RATE_LIMIT = '999';
		process.env.MCP_PUBLIC_RATE_TIME_RANGE_MINUTES = '120';

		const config = getRateLimitConfig();

		expect(config.public.limitPerWindow).toBe(999);
		expect(config.public.windowInMinutes).toBe(120);
		expect(typeof config.public.limitPerWindow).toBe('number');
		expect(typeof config.public.windowInMinutes).toBe('number');
	});

	it('should throw when a rate limit env var is missing', () => {
		delete process.env.MCP_REGISTERED_RATE_LIMIT;

		expect(() => getRateLimitConfig()).toThrow(
			'Missing rate limit environment variable: MCP_REGISTERED_RATE_LIMIT'
		);
	});

	it('should throw when a window env var is missing', () => {
		delete process.env.MCP_PAID_RATE_TIME_RANGE_MINUTES;

		expect(() => getRateLimitConfig()).toThrow(
			'Missing rate limit environment variable: MCP_PAID_RATE_TIME_RANGE_MINUTES'
		);
	});

	it('should throw when a rate limit env var is empty string', () => {
		process.env.MCP_PRIVATE_RATE_LIMIT = '';

		expect(() => getRateLimitConfig()).toThrow(
			'Missing rate limit environment variable: MCP_PRIVATE_RATE_LIMIT'
		);
	});

	it('should throw when a rate limit value is not a valid number', () => {
		process.env.MCP_PUBLIC_RATE_LIMIT = 'abc';

		expect(() => getRateLimitConfig()).toThrow(
			'Invalid rate limit value for MCP_PUBLIC_RATE_LIMIT: abc'
		);
	});

	it('should throw when a rate limit value is zero', () => {
		process.env.MCP_REGISTERED_RATE_LIMIT = '0';

		expect(() => getRateLimitConfig()).toThrow(
			'Invalid rate limit value for MCP_REGISTERED_RATE_LIMIT: 0'
		);
	});

	it('should throw when a rate limit value is negative', () => {
		process.env.MCP_PAID_RATE_LIMIT = '-10';

		expect(() => getRateLimitConfig()).toThrow(
			'Invalid rate limit value for MCP_PAID_RATE_LIMIT: -10'
		);
	});

	it('should throw when a window value is not a valid number', () => {
		process.env.MCP_PRIVATE_RATE_TIME_RANGE_MINUTES = 'xyz';

		expect(() => getRateLimitConfig()).toThrow(
			'Invalid rate limit window for MCP_PRIVATE_RATE_TIME_RANGE_MINUTES: xyz'
		);
	});

	it('should throw when a window value is zero', () => {
		process.env.MCP_PUBLIC_RATE_TIME_RANGE_MINUTES = '0';

		expect(() => getRateLimitConfig()).toThrow(
			'Invalid rate limit window for MCP_PUBLIC_RATE_TIME_RANGE_MINUTES: 0'
		);
	});
});

describe('TestHarness', () => {
	it('should expose REQUIRED_TIERS with all four tiers', () => {
		expect(REQUIRED_TIERS).toEqual(['public', 'registered', 'paid', 'private']);
	});

	it('should expose TIER_ENV_VARS with correct env var names', () => {
		expect(TIER_ENV_VARS.public.limit).toBe('MCP_PUBLIC_RATE_LIMIT');
		expect(TIER_ENV_VARS.public.window).toBe('MCP_PUBLIC_RATE_TIME_RANGE_MINUTES');
		expect(TIER_ENV_VARS.registered.limit).toBe('MCP_REGISTERED_RATE_LIMIT');
		expect(TIER_ENV_VARS.paid.limit).toBe('MCP_PAID_RATE_LIMIT');
		expect(TIER_ENV_VARS.private.limit).toBe('MCP_PRIVATE_RATE_LIMIT');
	});
});
