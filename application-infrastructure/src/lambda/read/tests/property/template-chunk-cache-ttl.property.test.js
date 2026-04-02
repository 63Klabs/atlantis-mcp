/**
 * Property-Based Tests for Chunk Cache TTL Constraint
 *
 * Feature: template-chunk-internal-cache, Property 5: Chunk cache TTL does not exceed template-detail TTL
 *
 * For any environment (production or non-production), the `chunk-data` cache
 * profile's `defaultExpirationInSeconds` should be less than or equal to the
 * `template-detail` cache profile's `defaultExpirationInSeconds`.
 *
 * Validates: Requirements 5.1
 */

const fc = require('fast-check');

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

// Mock isProduction to control environment
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

describe('Feature: template-chunk-internal-cache, Property 5: Chunk cache TTL does not exceed template-detail TTL', () => {

	/**
	 * Load connections for a specific environment by resetting the module
	 * registry and re-requiring with the desired isProduction value.
	 *
	 * @param {boolean} isProd - Whether to simulate production
	 * @returns {Array<Object>} connections array
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
		return require('../../config/connections');
	}

	// Pre-load both environments
	let prodConnections;
	let nonProdConnections;

	beforeAll(() => {
		nonProdConnections = loadConnectionsForEnv(false);
		prodConnections = loadConnectionsForEnv(true);
	});

	/**
	 * **Validates: Requirements 5.1**
	 *
	 * For any environment (production or non-production), the chunk-data
	 * TTL must be ≤ the template-detail TTL. We use fast-check to generate
	 * boolean values representing the environment flag and verify the
	 * constraint holds in both cases.
	 */
	test('chunk-data TTL ≤ template-detail TTL for any environment', () => {
		fc.assert(
			fc.property(
				fc.boolean(),
				(isProd) => {
					const connections = isProd ? prodConnections : nonProdConnections;

					const chunkProfile = findCacheProfile(connections, 'template-chunks', 'chunk-data');
					const templateProfile = findCacheProfile(connections, 's3-templates', 'template-detail');

					// Both profiles must exist
					expect(chunkProfile).toBeDefined();
					expect(templateProfile).toBeDefined();

					// Core property: chunk TTL must not exceed template-detail TTL
					expect(chunkProfile.defaultExpirationInSeconds)
						.toBeLessThanOrEqual(templateProfile.defaultExpirationInSeconds);
				}
			),
			{ numRuns: 100 }
		);
	});
});
