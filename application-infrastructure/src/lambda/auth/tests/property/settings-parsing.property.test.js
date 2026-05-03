/**
 * Property test for settings environment variable round-trip
 *
 * **Validates: Requirements 2.4**
 *
 * Property 1: Settings environment variable round-trip
 * For any set of valid rate limit values (positive integers for limitPerWindow
 * and windowInMinutes), DynamoDB table names (non-empty strings), and
 * PARAM_STORE_PATH values, when those values are set as environment variables
 * and config/settings.js is loaded, the resulting settings object contains the
 * exact same values in the corresponding fields.
 *
 * @module tests/property/settings-parsing
 */

'use strict';

const fc = require('fast-check');

describe('Feature: update-auth-function-to-use-cache-data', () => {

	// Save original env once
	const savedEnv = { ...process.env };

	afterEach(() => {
		// Restore original env after each test
		process.env = { ...savedEnv };
	});

	/**
	 * Helper to load settings with fresh environment variables.
	 * Uses jest.isolateModules to get a completely fresh module evaluation.
	 *
	 * @param {Object} envOverrides - Environment variable overrides
	 * @returns {Object} The freshly loaded settings object
	 */
	function loadSettingsWithEnv(envOverrides) {
		// >! Clean env vars that settings.js reads to prevent leakage between iterations
		const keysToClean = [
			'MCP_PUBLIC_RATE_LIMIT', 'MCP_PUBLIC_RATE_TIME_RANGE_MINUTES',
			'MCP_REGISTERED_RATE_LIMIT', 'MCP_REGISTERED_RATE_TIME_RANGE_MINUTES',
			'MCP_PAID_RATE_LIMIT', 'MCP_PAID_RATE_TIME_RANGE_MINUTES',
			'MCP_PRIVATE_RATE_LIMIT', 'MCP_PRIVATE_RATE_TIME_RANGE_MINUTES',
			'USERS_TABLE', 'SESSIONS_TABLE', 'PARAM_STORE_PATH',
		];
		keysToClean.forEach(key => { delete process.env[key]; });

		// Apply overrides
		Object.keys(envOverrides).forEach(key => {
			process.env[key] = envOverrides[key];
		});

		let settings;
		jest.isolateModules(() => {
			// >! Mock CachedSsmParameter inside isolateModules to avoid SSM calls
			jest.mock('@63klabs/cache-data', () => ({
				tools: {
					CachedSsmParameter: jest.fn().mockImplementation((path, options) => ({
						path,
						options,
						getValue: jest.fn().mockResolvedValue('mock-value'),
					})),
				},
			}));
			settings = require('../../config/settings.js');
		});

		return settings;
	}

	it('Property 1: Settings environment variable round-trip', () => {
		fc.assert(
			fc.property(
				// Generate positive integers for rate limit values
				fc.integer({ min: 1, max: 100000 }),  // public limit
				fc.integer({ min: 1, max: 10080 }),    // public window
				fc.integer({ min: 1, max: 100000 }),   // registered limit
				fc.integer({ min: 1, max: 10080 }),    // registered window
				fc.integer({ min: 1, max: 100000 }),   // paid limit
				fc.integer({ min: 1, max: 10080 }),    // paid window
				fc.integer({ min: 1, max: 100000 }),   // private limit
				fc.integer({ min: 1, max: 10080 }),    // private window
				// Generate non-empty alphanumeric strings for table names
				fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,30}$/),  // users table
				fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{2,30}$/),  // sessions table
				// Generate a valid PARAM_STORE_PATH (starts with /, ends with /)
				fc.stringMatching(/^\/[a-zA-Z][a-zA-Z0-9/]{1,30}\/$/).filter(s => s.length >= 3),
				(
					publicLimit, publicWindow,
					registeredLimit, registeredWindow,
					paidLimit, paidWindow,
					privateLimit, privateWindow,
					usersTable, sessionsTable,
					paramStorePath
				) => {
					const settings = loadSettingsWithEnv({
						MCP_PUBLIC_RATE_LIMIT: String(publicLimit),
						MCP_PUBLIC_RATE_TIME_RANGE_MINUTES: String(publicWindow),
						MCP_REGISTERED_RATE_LIMIT: String(registeredLimit),
						MCP_REGISTERED_RATE_TIME_RANGE_MINUTES: String(registeredWindow),
						MCP_PAID_RATE_LIMIT: String(paidLimit),
						MCP_PAID_RATE_TIME_RANGE_MINUTES: String(paidWindow),
						MCP_PRIVATE_RATE_LIMIT: String(privateLimit),
						MCP_PRIVATE_RATE_TIME_RANGE_MINUTES: String(privateWindow),
						USERS_TABLE: usersTable,
						SESSIONS_TABLE: sessionsTable,
						PARAM_STORE_PATH: paramStorePath,
					});

					// Verify rate limits round-trip
					expect(settings.rateLimits.public.limitPerWindow).toBe(publicLimit);
					expect(settings.rateLimits.public.windowInMinutes).toBe(publicWindow);
					expect(settings.rateLimits.registered.limitPerWindow).toBe(registeredLimit);
					expect(settings.rateLimits.registered.windowInMinutes).toBe(registeredWindow);
					expect(settings.rateLimits.paid.limitPerWindow).toBe(paidLimit);
					expect(settings.rateLimits.paid.windowInMinutes).toBe(paidWindow);
					expect(settings.rateLimits.private.limitPerWindow).toBe(privateLimit);
					expect(settings.rateLimits.private.windowInMinutes).toBe(privateWindow);

					// Verify table names round-trip
					expect(settings.usersTable).toBe(usersTable);
					expect(settings.sessionsTable).toBe(sessionsTable);
				}
			),
			{ numRuns: 100 }
		);
	});
});
