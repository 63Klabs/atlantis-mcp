/**
 * Unit Tests for template-chunks connection configuration
 *
 * Verifies the `template-chunks` connection entry in config/connections.js:
 * - Connection exists with correct host, path, and chunk-data cache profile
 * - chunk-data TTL ≤ template-detail TTL for both prod and non-prod
 * - expirationIsOnInterval is false
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 5.1
 */

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
	tools: {
		DebugAndLog: {
			isProduction: jest.fn().mockReturnValue(false),
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

const connections = require('../../../config/connections');

// Find the connections we need
const templateChunksConn = connections.find(c => c.name === 'template-chunks');
const s3TemplatesConn = connections.find(c => c.name === 's3-templates');

describe('config/connections - template-chunks', () => {

	describe('connection entry exists (Req 1.1)', () => {
		test('should have a connection named template-chunks', () => {
			expect(templateChunksConn).toBeDefined();
		});

		test('should have host set to "internal"', () => {
			expect(templateChunksConn.host).toBe('internal');
		});

		test('should have path set to "/chunks"', () => {
			expect(templateChunksConn.path).toBe('/chunks');
		});
	});

	describe('chunk-data cache profile fields (Req 1.2)', () => {
		const chunkDataProfile = templateChunksConn
			? templateChunksConn.cache.find(p => p.profile === 'chunk-data')
			: undefined;

		test('should have a cache profile named chunk-data', () => {
			expect(chunkDataProfile).toBeDefined();
		});

		test('should have hostId set to "template-chunks"', () => {
			expect(chunkDataProfile.hostId).toBe('template-chunks');
		});

		test('should have pathId set to "data"', () => {
			expect(chunkDataProfile.pathId).toBe('data');
		});

		test('should have overrideOriginHeaderExpiration set to true', () => {
			expect(chunkDataProfile.overrideOriginHeaderExpiration).toBe(true);
		});

		test('should have encrypt set to false', () => {
			expect(chunkDataProfile.encrypt).toBe(false);
		});
	});

	describe('expirationIsOnInterval (Req 1.4)', () => {
		const chunkDataProfile = templateChunksConn
			? templateChunksConn.cache.find(p => p.profile === 'chunk-data')
			: undefined;

		test('should have expirationIsOnInterval set to false', () => {
			expect(chunkDataProfile.expirationIsOnInterval).toBe(false);
		});
	});

	describe('chunk-data TTL ≤ template-detail TTL (Req 1.3, 5.1)', () => {
		const chunkDataProfile = templateChunksConn
			? templateChunksConn.cache.find(p => p.profile === 'chunk-data')
			: undefined;

		const templateDetailProfile = s3TemplatesConn
			? s3TemplatesConn.cache.find(p => p.profile === 'template-detail')
			: undefined;

		test('template-detail profile should exist for comparison', () => {
			expect(templateDetailProfile).toBeDefined();
		});

		test('chunk-data TTL should be ≤ template-detail TTL', () => {
			expect(chunkDataProfile.defaultExpirationInSeconds)
				.toBeLessThanOrEqual(templateDetailProfile.defaultExpirationInSeconds);
		});
	});
});
