/**
 * Property-Based Test for S3 Agent Assets DAO - List-Item Completeness
 *
 * Feature: agent-asset-tools
 * Property 2: List-item completeness
 *
 * For any asset returned by `list`, the item includes `name`, `type`,
 * `namespace`, `bucket`, `s3Path`, a numeric `size`, a non-empty `etag`,
 * and `lastModified`, each reflecting the retained source object.
 *
 * **Validates: Requirements 1.2, 3.1**
 *
 * Mocks `AWS.s3.client.send` (no live AWS) following the same
 * `jest.mock('@63klabs/cache-data', ...)` + `mockS3Send` pattern used by the
 * sibling `tests/unit/models/model-namespace-filtering.property.test.js` and
 * `tests/unit/models/s3-agent-assets-dao.test.js`.
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

/**
 * Fixed type/folder/extension combination used throughout this property
 * test, mirroring the shipped `steering` entry in
 * `config/agent-asset-types.js`.
 */
const STEERING_TYPE = { name: 'steering', folder: 'steering', extensions: ['.md'] };
const BASE_PATH = 'utilities/v2/agent_assets';

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

/**
 * Arbitrary filename: an alphanumeric base joined with the type's `.md`
 * extension, so every generated key is always a direct child matching the
 * extension filter.
 */
const filenameArb = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
  minLength: 1,
  maxLength: 20
}).map((base) => `${base}.md`);

/**
 * Arbitrary non-empty, quoted hex-like ETag mirroring the shape of a real
 * S3 ETag (e.g. `"9b2cf1a4..."`).
 */
const etagArb = fc.string({
  unit: fc.constantFrom(...'0123456789abcdef'.split('')),
  minLength: 8,
  maxLength: 32
}).map((hex) => `"${hex}"`);

/** Arbitrary object size in bytes: any non-negative integer. */
const sizeArb = fc.nat({ max: 10_000_000 });

/** Arbitrary last-modified timestamp: any valid `Date` instance. */
const lastModifiedArb = fc.date({ noInvalidDate: true });

/**
 * Arbitrary for a set of generated S3 `ListObjectsV2` `Contents` source
 * fields (filename, Size, ETag, LastModified), deduplicated on `filename`
 * so a single generated listing never has two colliding S3 keys.
 */
const entriesArb = fc.uniqueArray(
  fc.record({
    filename: filenameArb,
    size: sizeArb,
    etag: etagArb,
    lastModified: lastModifiedArb
  }),
  { selector: (entry) => entry.filename, minLength: 1, maxLength: 10 }
);

describe('Feature: agent-asset-tools, Property 2: List-item completeness', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * **Validates: Requirements 1.2, 3.1**
   *
   * For any asset returned by `list`, the item includes `name`, `type`,
   * `namespace`, `bucket`, `s3Path`, a numeric `size`, a non-empty `etag`,
   * and `lastModified`, each reflecting the retained source object.
   */
  test('every list() item includes name, type, namespace, bucket, s3Path, size, etag, and lastModified reflecting the source S3 object', () => {
    return fc.assert(
      fc.asyncProperty(
        bucketArb,
        namespaceArb,
        entriesArb,
        async (bucket, namespace, entries) => {
          mockS3Send.mockReset();

          const prefix = `${namespace}/${BASE_PATH}/${STEERING_TYPE.folder}/`;
          const contents = entries.map(({ filename, size, etag, lastModified }) => ({
            Key: `${prefix}${filename}`,
            Size: size,
            ETag: etag,
            LastModified: lastModified
          }));

          // Namespace is supplied directly, so list() issues exactly one
          // ListObjectsV2Command (no namespace-discovery call first)
          mockS3Send.mockResolvedValueOnce({ Contents: contents });

          const connection = {
            host: bucket,
            path: BASE_PATH,
            parameters: {
              assetTypes: [STEERING_TYPE],
              namespace
            }
          };

          const result = await S3AgentAssets.list(connection, {});

          expect(result.assets).toHaveLength(entries.length);

          for (const { filename, size, etag, lastModified } of entries) {
            const item = result.assets.find((asset) => asset.name === filename);
            expect(item).toBeDefined();

            // name: non-empty string, the filename portion of the generated key
            expect(typeof item.name).toBe('string');
            expect(item.name.length).toBeGreaterThan(0);
            expect(item.name).toBe(filename);

            // type: equals the type's `name`
            expect(item.type).toBe(STEERING_TYPE.name);

            // namespace: equals the generated namespace
            expect(item.namespace).toBe(namespace);

            // bucket: equals the generated bucket
            expect(item.bucket).toBe(bucket);

            // s3Path: non-empty string, starts with `s3://`
            expect(typeof item.s3Path).toBe('string');
            expect(item.s3Path.length).toBeGreaterThan(0);
            expect(item.s3Path.startsWith('s3://')).toBe(true);
            expect(item.s3Path).toBe(`s3://${bucket}/${prefix}${filename}`);

            // size: a number, equal to the generated Size
            expect(typeof item.size).toBe('number');
            expect(item.size).toBe(size);

            // etag: a non-empty string, equal to the generated ETag
            expect(typeof item.etag).toBe('string');
            expect(item.etag.length).toBeGreaterThan(0);
            expect(item.etag).toBe(etag);

            // lastModified: defined, equal to the generated LastModified
            expect(item.lastModified).toBeDefined();
            expect(item.lastModified).toEqual(lastModified);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
