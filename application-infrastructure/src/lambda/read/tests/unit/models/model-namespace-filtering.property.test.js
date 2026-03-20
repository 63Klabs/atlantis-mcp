/**
 * Property-Based Tests for Model Layer Namespace Filtering
 *
 * Feature: add-namespace-filter-to-list-templates
 * Validates correctness properties for namespace filtering in the
 * S3 templates model layer.
 *
 * Property 6: Model skips namespace discovery when namespace is provided
 * Property 7: Non-existent namespace returns empty results without error
 */

const fc = require('fast-check');

// Mock @63klabs/cache-data AWS.s3.client
const mockS3Send = jest.fn();
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    AWS: {
      s3: {
        client: {
          send: mockS3Send
        }
      }
    }
  }
}));

jest.mock('../../../utils/error-handler', () => ({
  logS3Error: jest.fn()
}));

const S3Templates = require('../../../models/s3-templates');

/**
 * Arbitrary that generates valid namespace strings matching ^[a-z0-9][a-z0-9-]*$
 * with maxLength 63.
 */
const validNamespaceArb = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 1, maxLength: 62 }
).map(s => {
  const first = s.charAt(0) === '-' ? 'a' : s.charAt(0);
  return first + s.slice(1);
}).filter(s => /^[a-z0-9][a-z0-9-]*$/.test(s) && s.length <= 63);

/* ------------------------------------------------------------------ */
/*  Property 6: Model skips namespace discovery when namespace is     */
/*  provided                                                          */
/*  Validates: Requirements 4.1, 4.3, 4.5                             */
/* ------------------------------------------------------------------ */

describe('Feature: add-namespace-filter-to-list-templates, Property 6: Model skips namespace discovery when namespace is provided', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  test('list() does NOT call getIndexedNamespaces when namespace is provided', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          mockS3Send.mockReset();

          // Mock ListObjectsV2 for template listing (returns empty)
          mockS3Send.mockResolvedValue({ Contents: [] });

          const connection = {
            host: 'test-bucket',
            path: 'templates/v2',
            parameters: { namespace }
          };

          await S3Templates.list(connection, {});

          // When namespace is provided, the first S3 call should be
          // ListObjectsV2 for the template prefix, NOT for namespace discovery.
          // Namespace discovery uses Delimiter: '/' — verify it was NOT called.
          const calls = mockS3Send.mock.calls;
          const hasNamespaceDiscoveryCall = calls.some(call => {
            const input = call[0]?.input || {};
            return input.Delimiter === '/' && !input.Prefix;
          });
          expect(hasNamespaceDiscoveryCall).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('list() calls getIndexedNamespaces when namespace is omitted', async () => {
    mockS3Send.mockReset();

    // First call: namespace discovery (getIndexedNamespaces)
    mockS3Send.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: 'atlantis/' }]
    });
    // Second call: template listing
    mockS3Send.mockResolvedValueOnce({ Contents: [] });

    const connection = {
      host: 'test-bucket',
      path: 'templates/v2',
      parameters: {}
    };

    await S3Templates.list(connection, {});

    // First call should be namespace discovery with Delimiter
    const firstCallInput = mockS3Send.mock.calls[0][0]?.input || {};
    expect(firstCallInput.Delimiter).toBe('/');
  });

  test('get() does NOT call getIndexedNamespaces when namespace is provided', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          mockS3Send.mockReset();

          // Mock GetObject — return NoSuchKey so get() returns null
          mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

          const connection = {
            host: 'test-bucket',
            path: 'templates/v2',
            parameters: { category: 'storage', templateName: 'tpl', namespace }
          };

          await S3Templates.get(connection, {});

          const calls = mockS3Send.mock.calls;
          const hasNamespaceDiscoveryCall = calls.some(call => {
            const input = call[0]?.input || {};
            return input.Delimiter === '/' && !input.Prefix;
          });
          expect(hasNamespaceDiscoveryCall).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('get() calls getIndexedNamespaces when namespace is omitted', async () => {
    mockS3Send.mockReset();

    // Namespace discovery
    mockS3Send.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: 'atlantis/' }]
    });
    // GetObject — NoSuchKey for .yml
    mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });
    // GetObject — NoSuchKey for .yaml
    mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

    const connection = {
      host: 'test-bucket',
      path: 'templates/v2',
      parameters: { category: 'storage', templateName: 'tpl' }
    };

    await S3Templates.get(connection, {});

    const firstCallInput = mockS3Send.mock.calls[0][0]?.input || {};
    expect(firstCallInput.Delimiter).toBe('/');
  });

  test('listVersions() does NOT call getIndexedNamespaces when namespace is provided', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          mockS3Send.mockReset();

          // Mock ListObjectVersions — return empty
          mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

          const connection = {
            host: 'test-bucket',
            path: 'templates/v2',
            parameters: { category: 'storage', templateName: 'tpl', namespace }
          };

          await S3Templates.listVersions(connection, {});

          const calls = mockS3Send.mock.calls;
          const hasNamespaceDiscoveryCall = calls.some(call => {
            const input = call[0]?.input || {};
            return input.Delimiter === '/' && !input.Prefix;
          });
          expect(hasNamespaceDiscoveryCall).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('listVersions() calls getIndexedNamespaces when namespace is omitted', async () => {
    mockS3Send.mockReset();

    // Namespace discovery
    mockS3Send.mockResolvedValueOnce({
      CommonPrefixes: [{ Prefix: 'atlantis/' }]
    });
    // ListObjectVersions — NoSuchKey
    mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });
    // ListObjectVersions for .yaml — NoSuchKey
    mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

    const connection = {
      host: 'test-bucket',
      path: 'templates/v2',
      parameters: { category: 'storage', templateName: 'tpl' }
    };

    await S3Templates.listVersions(connection, {});

    const firstCallInput = mockS3Send.mock.calls[0][0]?.input || {};
    expect(firstCallInput.Delimiter).toBe('/');
  });
});


/* ------------------------------------------------------------------ */
/*  Property 7: Non-existent namespace returns empty results without  */
/*  error                                                              */
/*  Validates: Requirements 4.7                                        */
/* ------------------------------------------------------------------ */

describe('Feature: add-namespace-filter-to-list-templates, Property 7: Non-existent namespace returns empty results without error', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  test('list() returns empty templates for non-existent namespace', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          mockS3Send.mockReset();

          // S3 returns empty Contents for non-existent prefix
          mockS3Send.mockResolvedValue({ Contents: [] });

          const connection = {
            host: 'test-bucket',
            path: 'templates/v2',
            parameters: { namespace }
          };

          const result = await S3Templates.list(connection, {});

          expect(result.templates).toEqual([]);
          // Should not throw — verify we got a result
          expect(result).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('get() returns null for non-existent namespace', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          mockS3Send.mockReset();

          // S3 returns NoSuchKey for non-existent prefix
          mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

          const connection = {
            host: 'test-bucket',
            path: 'templates/v2',
            parameters: { category: 'storage', templateName: 'tpl', namespace }
          };

          const result = await S3Templates.get(connection, {});

          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('listVersions() returns empty versions for non-existent namespace', () => {
    return fc.assert(
      fc.asyncProperty(
        validNamespaceArb,
        async (namespace) => {
          mockS3Send.mockReset();

          // S3 returns NoSuchKey for non-existent prefix
          mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

          const connection = {
            host: 'test-bucket',
            path: 'templates/v2',
            parameters: { category: 'storage', templateName: 'tpl', namespace }
          };

          const result = await S3Templates.listVersions(connection, {});

          expect(result.versions).toEqual([]);
          expect(result).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
