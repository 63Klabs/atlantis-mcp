/**
 * Property-Based Test for S3 Agent Assets DAO - Complete, Verbatim Asset
 * Detail
 *
 * Feature: agent-asset-tools
 * Property 8: Complete, verbatim asset detail
 *
 * For any stored asset, `get()` returns exactly one detail object whose
 * `content` is byte-identical to the object's stored bytes and which
 * includes `name`, `type`, `namespace`, `bucket`, `s3Path`, `size`, `etag`,
 * `sha256`, `lastModified`, and `content` - and no other fields.
 *
 * **Validates: Requirements 2.1, 3.2**
 *
 * Mocks `AWS.s3.client.send` (no live AWS) following the same
 * `jest.mock('@63klabs/cache-data', ...)` + `mockS3Send` pattern used by the
 * sibling `tests/unit/models/s3-agent-assets-dao.test.js` and
 * `tests/unit/models/s3-agent-assets-list-item.property.test.js`. Generated
 * byte content uses fast-check's default `fc.string()` charset (ASCII
 * range), encoded via `Buffer.from(str, 'utf-8')`, so the encode/decode
 * round-trip is exact and the `content` comparison below is unambiguous.
 */

const crypto = require('crypto');
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

const BASE_PATH = 'utilities/v2/agent_assets';

/** Safe path-segment charset: alphanumeric plus dash/underscore, no '/' or '\\'. */
const SAFE_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('');
const safeSegmentArb = fc.string({ unit: fc.constantFrom(...SAFE_CHARS), minLength: 1, maxLength: 16 });

/** Arbitrary S3 bucket name: lowercase alphanumeric, 3-40 characters. */
const bucketArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  minLength: 3,
  maxLength: 40
});

/**
 * Arbitrary namespace: lowercase alphanumeric, 1-30 characters - a valid
 * (hyphen-free) subset of the `^[a-z0-9][a-z0-9-]*$` namespace pattern used
 * elsewhere in the codebase.
 */
const namespaceArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  minLength: 1,
  maxLength: 30
});

/** Pool of file extensions a registry type might declare (with the leading dot). */
const EXTENSION_POOL = ['.md', '.json', '.txt', '.yaml', '.kiro.hook'];

/** A synthetic type's configured extensions: 1-3 unique members of the pool. */
const extensionsArb = fc.uniqueArray(fc.constantFrom(...EXTENSION_POOL), { minLength: 1, maxLength: 3 });

/**
 * Arbitrary non-empty, quoted hex-like ETag mirroring the shape of a real
 * S3 ETag (e.g. `"9b2cf1a4..."`).
 */
const etagArb = fc.string({
  unit: fc.constantFrom(...'0123456789abcdef'.split('')),
  minLength: 8,
  maxLength: 32
}).map((hex) => `"${hex}"`);

/** Arbitrary last-modified timestamp: any valid `Date` instance. */
const lastModifiedArb = fc.date({ noInvalidDate: true });

/**
 * Arbitrary byte content as a string. Uses fast-check's default (ASCII-range)
 * charset, so `Buffer.from(str, 'utf-8')` / `.toString('utf-8')` round-trips
 * exactly, keeping the `content` comparison in the property below exact and
 * unambiguous (no invalid/lone-surrogate UTF-8 edge cases to reconcile).
 */
const contentArb = fc.string({ maxLength: 500 });

/**
 * One full scenario: a bucket, a namespace, a synthetic registry-shaped
 * asset type (`name`, `folder`, `extensions`), a filename that matches one
 * of that type's configured extensions, arbitrary byte content, and the
 * S3-object metadata (`ETag`, `LastModified`) the mocked `GetObjectCommand`
 * response will carry.
 */
const detailScenarioArb = fc.record({
  bucket: bucketArb,
  namespace: namespaceArb,
  typeName: safeSegmentArb,
  folder: safeSegmentArb,
  extensions: extensionsArb,
  basename: safeSegmentArb,
  extIndex: fc.nat({ max: 10 }),
  content: contentArb,
  etag: etagArb,
  lastModified: lastModifiedArb
});

describe('Feature: agent-asset-tools, Property 8: Complete, verbatim asset detail', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * **Validates: Requirements 2.1, 3.2**
   *
   * For any stored asset, `get()` returns exactly one detail object whose
   * `content` is byte-identical to the object's stored bytes and which
   * includes `name`, `type`, `namespace`, `bucket`, `s3Path`, `size`,
   * `etag`, `sha256`, `lastModified`, and `content` - with no other fields.
   */
  test('get() returns a complete, verbatim asset detail object for any stored asset', () => {
    return fc.assert(
      fc.asyncProperty(detailScenarioArb, async (scenario) => {
        const {
          bucket, namespace, typeName, folder, extensions,
          basename, extIndex, content, etag, lastModified
        } = scenario;

        mockS3Send.mockReset();

        const extension = extensions[extIndex % extensions.length];
        const name = `${basename}${extension}`;
        const assetType = { name: typeName, folder, extensions };
        const contentBuffer = Buffer.from(content, 'utf-8');

        // Namespace is supplied directly, so get() issues exactly one
        // GetObjectCommand (no namespace-discovery call first)
        mockS3Send.mockResolvedValueOnce({
          Body: { transformToByteArray: async () => contentBuffer },
          ETag: etag,
          LastModified: lastModified
        });

        const connection = {
          host: bucket,
          path: BASE_PATH,
          parameters: { assetType, name, namespace }
        };

        const result = await S3AgentAssets.get(connection, {});

        expect(result).not.toBeNull();

        // Independently computed SHA-256 over the exact same bytes returned
        // by the mocked S3 GetObject response (Requirement 2.3/3.2 basis)
        const expectedSha256 = crypto.createHash('sha256').update(contentBuffer).digest('hex');
        const expectedS3Path = `s3://${bucket}/${namespace}/${BASE_PATH}/${folder}/${name}`;

        expect(result.name).toBe(name);
        expect(result.type).toBe(typeName);
        expect(result.namespace).toBe(namespace);
        expect(result.bucket).toBe(bucket);
        expect(result.s3Path).toBe(expectedS3Path);
        expect(result.size).toBe(contentBuffer.length);
        expect(result.etag).toBe(etag);
        expect(result.sha256).toBe(expectedSha256);
        expect(result.content).toBe(content);
        expect(result.lastModified).toEqual(lastModified);

        // Completeness: exactly these fields are present - no more, no less
        const expectedKeys = ['name', 'type', 'namespace', 'bucket', 's3Path', 'size', 'etag', 'sha256', 'lastModified', 'content'];
        expect(Object.keys(result).sort()).toEqual([...expectedKeys].sort());

        // Only one S3 call: namespace was supplied directly, so no
        // namespace-discovery call is made
        expect(mockS3Send).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });
});
