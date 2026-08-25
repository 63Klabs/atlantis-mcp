/**
 * Unit Tests for the `document` connection configuration (spec 0-0-6, task 5.1)
 *
 * Verifies the `document`/`doc-data` connection entry `Documentation.getDocument()` uses to
 * wrap its storage reads in CacheableDataAccess:
 * - the connection exists and is internal (DynamoDB reads only, never a GitHub fetch)
 * - the doc-data cache profile carries usable cache-key identifiers and a bounded TTL
 *
 * Requirements: 6.5, 6.6
 */

// Set required env var before loading settings
process.env.PARAM_STORE_PATH = '/test/';

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

const documentConn = connections.find(c => c.name === 'document');

describe('config/connections - document', () => {

  test('should have a connection named document', () => {
    expect(documentConn).toBeDefined();
  });

  test('should be an internal connection (no external host to fetch from)', () => {
    expect(documentConn.host).toBe('internal');
    expect(documentConn.path).toBe('/document');
  });

  describe('doc-data cache profile', () => {
    const docDataProfile = documentConn
      ? documentConn.cache.find(p => p.profile === 'doc-data')
      : undefined;

    test('should have a cache profile named doc-data', () => {
      expect(docDataProfile).toBeDefined();
    });

    test('should carry distinct cache-key identifiers', () => {
      expect(docDataProfile.hostId).toBe('document');
      expect(docDataProfile.pathId).toBe('data');
    });

    test('should have a positive TTL and not refresh on an interval', () => {
      expect(docDataProfile.defaultExpirationInSeconds).toBeGreaterThan(0);
      expect(docDataProfile.expirationIsOnInterval).toBe(false);
    });

    test('should not exceed the 7-day TTL of the stored document item', () => {
      expect(docDataProfile.defaultExpirationInSeconds).toBeLessThanOrEqual(7 * 24 * 60 * 60);
    });
  });
});
