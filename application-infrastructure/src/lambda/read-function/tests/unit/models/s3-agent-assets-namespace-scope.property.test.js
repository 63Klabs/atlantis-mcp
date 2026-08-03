/**
 * Property-Based Test for S3 Agent Assets DAO - Namespace Scoping
 *
 * Feature: agent-asset-tools
 * Property 5: Namespace scoping
 *
 * For any request that supplies a `namespace`, every returned asset
 * originates from that single namespace and no other namespace is read.
 *
 * **Validates: Requirements 4.3**
 *
 * Mirrors the detection technique already established for the sibling
 * templates DAO test (`tests/unit/models/model-namespace-filtering.property.test.js`,
 * Property 6): namespace discovery is issued as a `ListObjectsV2Command`
 * with `Delimiter: '/'` and NO `Prefix` (see `S3Common.getIndexedNamespaces`
 * in `models/s3-common.js`). When a `namespace` is supplied directly, the
 * DAO must never issue that shaped call - it goes straight to the single
 * provided namespace instead of discovering namespaces first.
 *
 * S3 is mocked (no live AWS): `@63klabs/cache-data`'s `AWS.s3.client.send`
 * is stubbed following the same `jest.mock('@63klabs/cache-data', ...)` +
 * `mockS3Send` pattern used throughout `tests/unit/models/s3-agent-assets-*`.
 */

const fc = require('fast-check');

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

// Import after mocking so the DAO (and the s3-common helper it depends on)
// picks up the mocked AWS.s3.client
const S3AgentAssets = require('../../../models/s3-agent-assets');

/** Registry-shaped `steering` type fixture, mirroring config/agent-asset-types.js */
const STEERING_TYPE = { name: 'steering', folder: 'steering', extensions: ['.md'] };
const BASE_PATH = 'utilities/v2/agent_assets';
const BUCKET = 'test-bucket';

/**
 * Arbitrary that generates valid namespace strings matching
 * `^[a-z0-9][a-z0-9-]*$` with maxLength 63 - the same namespace schema
 * pattern used elsewhere in the codebase (see design.md's `namespace`
 * parameter shape) and the same arbitrary shape used by the sibling
 * `model-namespace-filtering.property.test.js`.
 */
const validNamespaceArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  minLength: 1, maxLength: 62
}).map(s => {
  const first = s.charAt(0) === '-' ? 'a' : s.charAt(0);
  return first + s.slice(1);
}).filter(s => /^[a-z0-9][a-z0-9-]*$/.test(s) && s.length <= 63);

/** Arbitrary `.md` filename, unique per generated listing. */
const filenameArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  minLength: 1,
  maxLength: 12
}).map((base) => `${base}.md`);

/** A random small set of distinct filenames for the type's folder prefix (or empty). */
const filenamesArb = fc.uniqueArray(filenameArb, { minLength: 0, maxLength: 5 });

/**
 * Detect whether any recorded S3 call matches the namespace-discovery shape
 * used by `S3Common.getIndexedNamespaces` (`ListObjectsV2Command` with
 * `Delimiter: '/'` and no `Prefix`), as opposed to the per-type listing
 * shape (`Delimiter: '/'` WITH a `Prefix`).
 *
 * @param {Array<Array<Object>>} calls - `mockS3Send.mock.calls`
 * @returns {boolean} True if a namespace-discovery call occurred
 */
function hasNamespaceDiscoveryCall(calls) {
  return calls.some((call) => {
    const input = call[0]?.input || {};
    return input.Delimiter === '/' && !input.Prefix;
  });
}

describe('Feature: agent-asset-tools, Property 5: Namespace scoping', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('list()', () => {

    test('does NOT call getIndexedNamespaces when namespace is provided, and every returned asset originates from that namespace', () => {
      return fc.assert(
        fc.asyncProperty(
          validNamespaceArb,
          filenamesArb,
          async (namespace, filenames) => {
            mockS3Send.mockReset();

            const prefix = `${namespace}/${BASE_PATH}/${STEERING_TYPE.folder}/`;
            const contents = filenames.map((filename, i) => ({
              Key: `${prefix}${filename}`,
              Size: 100 + i,
              ETag: `"etag-${i}"`,
              LastModified: new Date('2024-01-01T00:00:00.000Z')
            }));

            // Namespace supplied directly -> the DAO goes straight to a
            // single ListObjectsV2Command for that namespace's type prefix
            mockS3Send.mockResolvedValueOnce({ Contents: contents });

            const connection = {
              host: BUCKET,
              path: BASE_PATH,
              parameters: { assetTypes: [STEERING_TYPE], namespace }
            };

            const result = await S3AgentAssets.list(connection, {});

            // S3 was consulted...
            expect(mockS3Send).toHaveBeenCalled();

            // ...but never for namespace discovery (Delimiter: '/' with no Prefix)
            expect(hasNamespaceDiscoveryCall(mockS3Send.mock.calls)).toBe(false);

            // The search was actually restricted to the provided namespace,
            // not merely that discovery was skipped: every returned asset
            // must carry that exact namespace.
            expect(result.assets).toHaveLength(filenames.length);
            for (const asset of result.assets) {
              expect(asset.namespace).toBe(namespace);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    test('calls getIndexedNamespaces when namespace is omitted', async () => {
      mockS3Send.mockReset();

      // First call: namespace discovery (S3Common.getIndexedNamespaces)
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      // Second call: per-type listing under the discovered namespace
      mockS3Send.mockResolvedValueOnce({ Contents: [] });

      const connection = {
        host: BUCKET,
        path: BASE_PATH,
        parameters: { assetTypes: [STEERING_TYPE] }
      };

      await S3AgentAssets.list(connection, {});

      // First call must be namespace discovery: Delimiter '/' with no Prefix
      const firstCallInput = mockS3Send.mock.calls[0][0]?.input || {};
      expect(firstCallInput.Delimiter).toBe('/');
      expect(firstCallInput.Prefix).toBeUndefined();
      expect(mockS3Send).toHaveBeenCalledTimes(2);
    });
  });

  describe('get()', () => {

    test('does NOT call getIndexedNamespaces when namespace is provided', () => {
      return fc.assert(
        fc.asyncProperty(
          validNamespaceArb,
          async (namespace) => {
            mockS3Send.mockReset();

            // Simplest deterministic outcome: NoSuchKey. The point of this
            // property is to observe which S3 calls were made, not to test
            // finding an asset.
            mockS3Send.mockRejectedValue({ name: 'NoSuchKey' });

            const connection = {
              host: BUCKET,
              path: BASE_PATH,
              parameters: { assetType: STEERING_TYPE, name: 'x.md', namespace }
            };

            await S3AgentAssets.get(connection, {});

            expect(hasNamespaceDiscoveryCall(mockS3Send.mock.calls)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('calls getIndexedNamespaces when namespace is omitted', async () => {
      mockS3Send.mockReset();

      // Namespace discovery
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      // GetObject under the discovered namespace - NoSuchKey
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = {
        host: BUCKET,
        path: BASE_PATH,
        parameters: { assetType: STEERING_TYPE, name: 'x.md' }
      };

      await S3AgentAssets.get(connection, {});

      const firstCallInput = mockS3Send.mock.calls[0][0]?.input || {};
      expect(firstCallInput.Delimiter).toBe('/');
      expect(firstCallInput.Prefix).toBeUndefined();
      expect(mockS3Send).toHaveBeenCalledTimes(2);
    });
  });
});
