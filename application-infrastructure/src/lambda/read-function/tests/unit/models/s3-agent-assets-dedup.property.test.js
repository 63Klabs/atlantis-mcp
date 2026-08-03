/**
 * Property-Based Tests for S3 Agent Assets - Priority-Order Deduplication
 * and Selection
 *
 * Feature: agent-asset-tools
 * Property 3: Priority-order deduplication and selection
 *
 * **Validates: Requirements 1.4, 2.2**
 *
 * Property test A exercises `list()`: when the same `(type, name)` pair
 * appears in more than one configured bucket, the retained item must be the
 * one from the first bucket in `connection.host` priority order, and the
 * same `name` occurring under a different type must be treated as distinct
 * (never deduplicated against the first type's entry).
 *
 * Property test B exercises `get()`: when more than one bucket holds an
 * object at the same resolved key, the returned asset must come from the
 * first bucket (in `connection.host` priority order) whose read actually
 * succeeds - including the case where one or more leading buckets fail with
 * `NoSuchKey` before a later bucket succeeds.
 *
 * S3 is mocked (no live AWS): `@63klabs/cache-data`'s `AWS.s3.client.send`
 * is stubbed per the repository's getter/module-mocking guidance.
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

const S3AgentAssets = require('../../../models/s3-agent-assets');

const ALNUM_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const alnumCharArb = fc.constantFrom(...ALNUM_CHARS);

/**
 * Build an arbitrary for alphanumeric strings of the given length bounds.
 * @param {number} minLength - Minimum string length
 * @param {number} maxLength - Maximum string length
 * @returns {import('fast-check').Arbitrary<string>} Alphanumeric string arbitrary
 */
function alnumStringArb(minLength, maxLength) {
  return fc.string({ unit: alnumCharArb, minLength, maxLength });
}

const NAMESPACE = 'atlantis';
const BASE_PATH = 'utilities/v2/agent_assets';

describe('Feature: agent-asset-tools, Property 3: Priority-order deduplication and selection', () => {

  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  /* ---------------------------------------------------------------- */
  /*  Property test A: list() dedup on (type, name); the same name    */
  /*  under a different type is kept distinct (Requirement 1.4)       */
  /* ---------------------------------------------------------------- */

  describe('list() retains only the first-bucket occurrence per (type, name), keeping same-name different-type entries distinct', () => {

    const perBucketMetaArb = fc.record({
      size: fc.integer({ min: 1, max: 5000000 }),
      etagSuffix: alnumStringArb(6, 20),
      dayOffset: fc.integer({ min: 0, max: 3650 })
    });

    // Generate 2-4 buckets (priority order = array order) with per-bucket
    // metadata for a shared filename, plus a random filename stem and a
    // random bucket-name suffix. Bucket count is derived from the
    // metadata array's length so the two stay in sync without needing a
    // dependent (`.chain()`) arbitrary.
    const listDedupCaseArb = fc
      .tuple(
        fc.array(perBucketMetaArb, { minLength: 2, maxLength: 4 }),
        alnumStringArb(3, 10),
        alnumStringArb(1, 20)
      )
      .map(([metaArray, bucketSuffix, filenameStem]) => {
        const buckets = metaArray.map((_, i) => `bucket-${i}-${bucketSuffix}`);
        const filename = `${filenameStem}.md`;
        return { buckets, metaArray, filename };
      });

    test('list() keeps the first bucket in priority order for a same-type duplicate and preserves the different-type entry', () => {
      return fc.assert(
        fc.asyncProperty(
          listDedupCaseArb,
          async ({ buckets, metaArray, filename }) => {
            mockS3Send.mockReset();

            // Two synthetic registry types with distinct folders so the
            // same filename under each resolves to a different S3 key.
            const typeA = { name: 'type-a', folder: 'folder-a', extensions: ['.md'] };
            const typeB = { name: 'type-b', folder: 'folder-b', extensions: ['.md'] };

            const prefixA = `${NAMESPACE}/${BASE_PATH}/${typeA.folder}/`;
            const prefixB = `${NAMESPACE}/${BASE_PATH}/${typeB.folder}/`;

            const responses = new Map();

            buckets.forEach((bucket, i) => {
              const meta = metaArray[i];

              // Every bucket carries the SAME filename under typeA's folder,
              // with distinguishable Size/ETag/LastModified per bucket.
              responses.set(`${bucket}::${prefixA}`, {
                Contents: [{
                  Key: prefixA + filename,
                  Size: meta.size,
                  ETag: `"etag-a-${i}-${meta.etagSuffix}"`,
                  LastModified: new Date(Date.UTC(2020, 0, 1 + meta.dayOffset))
                }]
              });

              // Only the first (highest-priority) bucket also carries the
              // SAME filename under typeB's folder - a different `(type,
              // name)` pair that must be treated as distinct.
              responses.set(`${bucket}::${prefixB}`, {
                Contents: i === 0
                  ? [{
                    Key: prefixB + filename,
                    Size: 42,
                    ETag: '"etag-b-0"',
                    LastModified: new Date(Date.UTC(2021, 5, 15))
                  }]
                  : []
              });
            });

            mockS3Send.mockImplementation(async (command) => {
              const input = command.input || {};
              const key = `${input.Bucket}::${input.Prefix}`;
              return responses.get(key) || { Contents: [] };
            });

            const connection = {
              host: buckets,
              path: BASE_PATH,
              parameters: {
                assetTypes: [typeA, typeB],
                namespace: NAMESPACE
              }
            };

            const result = await S3AgentAssets.list(connection, {});

            const typeAMatches = result.assets.filter(
              (asset) => asset.type === typeA.name && asset.name === filename
            );
            const typeBMatches = result.assets.filter(
              (asset) => asset.type === typeB.name && asset.name === filename
            );

            // Exactly one retained occurrence for the duplicated (type, name) pair
            expect(typeAMatches.length).toBe(1);

            const retained = typeAMatches[0];
            const firstBucketMeta = metaArray[0];

            // The retained occurrence must be the FIRST bucket in priority
            // order, not any later one.
            expect(retained.bucket).toBe(buckets[0]);
            expect(retained.size).toBe(firstBucketMeta.size);
            expect(retained.etag).toBe(`"etag-a-0-${firstBucketMeta.etagSuffix}"`);

            // The same name under a different type is distinct and is NOT
            // deduplicated away.
            expect(typeBMatches.length).toBe(1);
            expect(typeBMatches[0].type).toBe(typeB.name);
            expect(typeBMatches[0].bucket).toBe(buckets[0]);

            // No unexpected extra assets (one retained item per type).
            expect(result.assets.length).toBe(2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Property test B: get() returns the first bucket, in priority    */
  /*  order, whose read actually succeeds (Requirement 2.2)           */
  /* ---------------------------------------------------------------- */

  describe('get() returns the first successful occurrence in bucket priority order', () => {

    // Generate 2-4 buckets with distinguishable per-bucket content, plus a
    // "fail count" (reduced modulo the bucket count) representing how many
    // LEADING buckets return NoSuchKey before the first bucket that
    // succeeds. failCount === 0 covers "the first bucket always succeeds";
    // failCount > 0 covers "the first bucket(s) fail, a later one succeeds".
    const getCaseArb = fc
      .tuple(
        fc.integer({ min: 2, max: 4 }),
        alnumStringArb(3, 10),
        alnumStringArb(1, 30),
        fc.integer({ min: 0, max: 10 }),
        alnumStringArb(1, 20)
      )
      .map(([count, bucketSuffix, contentSuffix, failCountRaw, nameStem]) => {
        const buckets = Array.from({ length: count }, (_, i) => `bucket-${i}-${bucketSuffix}`);
        const contents = Array.from({ length: count }, (_, i) => `content-${i}-${contentSuffix}`);
        const failCount = failCountRaw % count;
        const name = `${nameStem}.md`;
        return { buckets, contents, failCount, name };
      });

    test("get() returns the bucket at the first non-failing index, with that bucket's exact bytes", () => {
      return fc.assert(
        fc.asyncProperty(
          getCaseArb,
          async ({ buckets, contents, failCount, name }) => {
            mockS3Send.mockReset();

            const assetType = { name: 'type-a', folder: 'folder-a', extensions: ['.md'] };

            mockS3Send.mockImplementation(async (command) => {
              const bucket = command.input.Bucket;
              const index = buckets.indexOf(bucket);

              if (index < failCount) {
                const error = new Error('The specified key does not exist.');
                error.name = 'NoSuchKey';
                throw error;
              }

              return {
                ETag: `"etag-${index}"`,
                LastModified: new Date(Date.UTC(2020, 0, index + 1)),
                Body: {
                  transformToByteArray: async () => Buffer.from(contents[index], 'utf-8')
                }
              };
            });

            const connection = {
              host: buckets,
              path: BASE_PATH,
              parameters: { assetType, name, namespace: NAMESPACE }
            };

            const asset = await S3AgentAssets.get(connection, {});

            const expectedBucket = buckets[failCount];
            const expectedContent = contents[failCount];
            const expectedBuffer = Buffer.from(expectedContent, 'utf-8');
            const expectedSha256 = crypto.createHash('sha256').update(expectedBuffer).digest('hex');

            expect(asset).not.toBeNull();
            expect(asset.bucket).toBe(expectedBucket);
            expect(asset.content).toBe(expectedContent);
            expect(asset.size).toBe(expectedBuffer.length);
            expect(asset.sha256).toBe(expectedSha256);

            // get() must stop at the first success: exactly failCount + 1
            // calls, covering buckets[0..failCount] in priority order, with
            // no calls beyond the first successful bucket.
            const calledBuckets = mockS3Send.mock.calls.map((call) => call[0].input.Bucket);
            expect(calledBuckets).toEqual(buckets.slice(0, failCount + 1));
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
