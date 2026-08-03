/**
 * Unit Tests for config/connections.js - s3-agent-assets connection
 *
 * Verifies the `s3-agent-assets` connection entry added for the Agent Assets
 * MCP Tools feature:
 * - Connection exists with `assets-list` and `asset-detail` cache profiles,
 *   each resolving to a numeric `defaultExpirationInSeconds` (Requirement 8.1)
 * - Production TTLs are >= 3600 seconds for both profiles (Requirement 8.4)
 * - Test/non-production TTLs are <= 300 seconds and strictly less than the
 *   corresponding production TTL for both profiles (Requirement 8.5)
 *
 * `IS_PRODUCTION` is computed once at module load from
 * `DebugAndLog.isProduction()`, so both environments are exercised by
 * resetting the module registry and re-requiring `config/connections` with
 * a controllable `isProduction` mock, mirroring the established pattern in
 * tests/property/template-chunk-cache-ttl.property.test.js.
 *
 * Requirements: 8.1, 8.4, 8.5
 */

'use strict';

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

// Controllable isProduction mock so the module can be reloaded under both
// production and non-production conditions (see loadConnectionsForEnv below).
const mockIsProduction = jest.fn().mockReturnValue(false);

jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			isProduction: (...args) => mockIsProduction(...args),
			log: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			info: jest.fn(),
			debug: jest.fn()
		},
		CachedSsmParameter: jest.fn().mockImplementation(() => ({
			getValue: jest.fn().mockResolvedValue('mock-value')
		}))
	}
}));

/**
 * Load a fresh copy of config/connections.js under a specific simulated
 * environment by resetting the module registry and re-requiring, so the
 * module-load-time `IS_PRODUCTION`/`TTL_NON_PROD` computation picks up the
 * desired `isProduction()` value.
 *
 * @param {boolean} isProd - Whether to simulate a production environment
 * @returns {Array<Object>} The connections array for that environment
 */
function loadConnectionsForEnv(isProd) {
	mockIsProduction.mockReturnValue(isProd);
	jest.resetModules();
	jest.doMock('@63klabs/cache-data', () => ({
		tools: {
			DebugAndLog: {
				isProduction: (...args) => mockIsProduction(...args),
				log: jest.fn(),
				error: jest.fn(),
				warn: jest.fn(),
				info: jest.fn(),
				debug: jest.fn()
			},
			CachedSsmParameter: jest.fn().mockImplementation(() => ({
				getValue: jest.fn().mockResolvedValue('mock-value')
			}))
		}
	}));
	return require('../../../config/connections');
}

/**
 * Find a cache profile by connection name and profile name.
 *
 * @param {Array<Object>} connections - The connections array
 * @param {string} connName - Connection name
 * @param {string} profileName - Cache profile name
 * @returns {Object|undefined} The cache profile object
 */
function findCacheProfile(connections, connName, profileName) {
	const conn = connections.find(c => c.name === connName);
	if (!conn) return undefined;
	return conn.cache.find(p => p.profile === profileName);
}

describe('config/connections - s3-agent-assets', () => {

	let prodConnections;
	let nonProdConnections;

	beforeAll(() => {
		nonProdConnections = loadConnectionsForEnv(false);
		prodConnections = loadConnectionsForEnv(true);
	});

	afterAll(() => {
		jest.resetModules();
	});

	describe('connection and cache profile shape (Req 8.1)', () => {
		test('should have a connection named s3-agent-assets', () => {
			const conn = nonProdConnections.find(c => c.name === 's3-agent-assets');
			expect(conn).toBeDefined();
		});

		test('should expose exactly an assets-list and an asset-detail cache profile', () => {
			const conn = nonProdConnections.find(c => c.name === 's3-agent-assets');
			const profileNames = conn.cache.map(p => p.profile);
			expect(profileNames).toEqual(expect.arrayContaining(['assets-list', 'asset-detail']));
			expect(profileNames.length).toBe(2);
		});

		test('assets-list defaultExpirationInSeconds should be a number', () => {
			const profile = findCacheProfile(nonProdConnections, 's3-agent-assets', 'assets-list');
			expect(profile).toBeDefined();
			expect(typeof profile.defaultExpirationInSeconds).toBe('number');
			expect(Number.isNaN(profile.defaultExpirationInSeconds)).toBe(false);
		});

		test('asset-detail defaultExpirationInSeconds should be a number', () => {
			const profile = findCacheProfile(nonProdConnections, 's3-agent-assets', 'asset-detail');
			expect(profile).toBeDefined();
			expect(typeof profile.defaultExpirationInSeconds).toBe('number');
			expect(Number.isNaN(profile.defaultExpirationInSeconds)).toBe(false);
		});
	});

	describe('production TTLs are >= 3600 seconds (Req 8.4)', () => {
		test('assets-list production TTL should be >= 3600', () => {
			const profile = findCacheProfile(prodConnections, 's3-agent-assets', 'assets-list');
			expect(profile.defaultExpirationInSeconds).toBeGreaterThanOrEqual(3600);
		});

		test('asset-detail production TTL should be >= 3600', () => {
			const profile = findCacheProfile(prodConnections, 's3-agent-assets', 'asset-detail');
			expect(profile.defaultExpirationInSeconds).toBeGreaterThanOrEqual(3600);
		});
	});

	describe('test TTLs are <= 300 seconds and below production TTLs (Req 8.5)', () => {
		test('assets-list test TTL should be <= 300', () => {
			const profile = findCacheProfile(nonProdConnections, 's3-agent-assets', 'assets-list');
			expect(profile.defaultExpirationInSeconds).toBeLessThanOrEqual(300);
		});

		test('asset-detail test TTL should be <= 300', () => {
			const profile = findCacheProfile(nonProdConnections, 's3-agent-assets', 'asset-detail');
			expect(profile.defaultExpirationInSeconds).toBeLessThanOrEqual(300);
		});

		test('assets-list test TTL should be strictly less than its production TTL', () => {
			const testProfile = findCacheProfile(nonProdConnections, 's3-agent-assets', 'assets-list');
			const prodProfile = findCacheProfile(prodConnections, 's3-agent-assets', 'assets-list');
			expect(testProfile.defaultExpirationInSeconds).toBeLessThan(prodProfile.defaultExpirationInSeconds);
		});

		test('asset-detail test TTL should be strictly less than its production TTL', () => {
			const testProfile = findCacheProfile(nonProdConnections, 's3-agent-assets', 'asset-detail');
			const prodProfile = findCacheProfile(prodConnections, 's3-agent-assets', 'asset-detail');
			expect(testProfile.defaultExpirationInSeconds).toBeLessThan(prodProfile.defaultExpirationInSeconds);
		});
	});
});
