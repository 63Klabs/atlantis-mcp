/**
 * Property-Based Tests for S3 Agent Assets - Brown-Out and Partial Data
 *
 * Feature: agent-asset-tools
 * Property 10: Brown-out and partial data
 *
 * For any set of sources in which some buckets lack access or some reads
 * fail, `list()` skips the inaccessible/failed sources, records each in the
 * `errors` array, sets `partialData: true`, and still returns the assets
 * from all remaining successful sources.
 *
 * **Validates: Requirements 4.2, 4.8**
 *
 * This file covers TWO distinct brown-out triggers as two separate
 * properties:
 *
 * - Property test A (Requirement 4.8, "read failure") - a bucket/namespace
 *   READ fails (a generic `ListObjectsV2Command` error, never `NoSuchKey`).
 *   This is exercised organically through the real per-type-listing code
 *   path: S3 is mocked to throw for a random non-empty, proper subset of
 *   the generated buckets while the remaining buckets return valid
 *   (possibly empty) `Contents`. A complementary (negative) case is also
 *   verified: when every bucket's read succeeds, `partialData` is `false`
 *   and `errors` is `undefined`, so the property is falsifiable rather than
 *   "always brown-out."
 * - Property test B (Requirement 4.2, "access denied") - a bucket is denied
 *   access (lacks the `atlantis-mcp:Allow=true` tag). As of this writing,
 *   `models/s3-common.js`'s `checkBucketAccess` is a stub that
 *   unconditionally resolves `true` (bucket-tagging permission is not yet
 *   configured - see its own TODO comment), so this branch cannot be
 *   triggered organically through mocked S3 responses alone. Per this
 *   task's investigation, the most direct and faithful way to exercise
 *   `list()`'s REAL access-denial branch (the
 *   `if (!allowAccess) { warn; record error; continue; }` block in
 *   `models/s3-agent-assets.js`) is to mock the `../../../models/s3-common`
 *   module itself so `checkBucketAccess` resolves `false` for a chosen
 *   subset of buckets, rather than depending on the stub ever changing.
 *
 * Because `models/s3-common` is mocked at the module level for this whole
 * file, Property test A explicitly configures the mocked
 * `checkBucketAccess` to always resolve `true` for every generated bucket -
 * the same behavior as the real (current) stub - so Property test A
 * exercises only the read-failure path, never the access-denial path.
 *
 * S3 is mocked (no live AWS): `@63klabs/cache-data`'s `AWS.s3.client.send`
 * is stubbed following the same `jest.mock('@63klabs/cache-data', ...)` +
 * `mockS3Send` pattern used throughout `tests/unit/models/s3-agent-assets-*`
 * (see e.g. `s3-agent-assets-dedup.property.test.js`,
 * `s3-agent-assets-ordering.property.test.js`). Each generated bucket is
 * given a globally-unique name and, when it is expected to succeed with an
 * asset, a filename derived from that unique bucket name - so the
 * dedup/ordering behavior already covered by Properties 3 and 4 is not
 * re-tested here; this file stays focused on the brown-out/partial-data
 * envelope itself.
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

// Mock the shared S3 helper module directly so Property test B can force
// checkBucketAccess() to resolve false for chosen buckets. The current
// checkBucketAccess() stub in models/s3-common.js always resolves true
// (bucket tagging permission is not yet configured), so mocking the module
// is the most direct way to exercise list()'s real access-denial branch.
jest.mock('../../../models/s3-common', () => ({
  checkBucketAccess: jest.fn(),
  getIndexedNamespaces: jest.fn()
}));

// Import after mocking so the DAO picks up the mocked AWS.s3.client,
// ErrorHandler, and S3Common.
const S3AgentAssets = require('../../../models/s3-agent-assets');
const S3Common = require('../../../models/s3-common');
const ErrorHandler = require('../../../utils/error-handler');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

const NAMESPACE = 'atlantis';
const BASE_PATH = 'utilities/v2/agent_assets';
/** Registry-shaped `steering` type fixture, mirroring config/agent-asset-types.js */
const STEERING_TYPE = { name: 'steering', folder: 'steering', extensions: ['.md'] };

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

/**
 * Build an arbitrary for an array of unique alphanumeric "base" strings,
 * used to derive collision-free bucket names.
 * @param {number} minLength - Minimum array length
 * @param {number} maxLength - Maximum array length
 * @returns {import('fast-check').Arbitrary<string[]>} Unique string array arbitrary
 */
function uniqueBaseArrayArb(minLength, maxLength) {
  return fc.uniqueArray(alnumStringArb(1, 10), { minLength, maxLength });
}

describe('Feature: agent-asset-tools, Property 10: Brown-out and partial data', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockReset();
    // Baseline: mirrors the current always-true checkBucketAccess() stub in
    // models/s3-common.js. Property test B overrides this per bucket.
    S3Common.checkBucketAccess.mockResolvedValue(true);
    S3Common.getIndexedNamespaces.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /* ------------------------------------------------------------------ */
  /*  Property test A: bucket/namespace read failure (Requirement 4.8)  */
  /* ------------------------------------------------------------------ */

  describe('Property test A: read failures brown-out with partial data (Requirement 4.8)', () => {

    // 2-5 buckets; a non-empty, proper subset (>=1, <all) fails its
    // ListObjectsV2Command with a generic (non-NoSuchKey) error; each
    // remaining bucket succeeds with valid (possibly empty) Contents, per
    // hasAssetFlags.
    const readFailureScenarioArb = fc.integer({ min: 2, max: 5 }).chain((count) => fc.tuple(
      uniqueBaseArrayArb(count, count),
      fc.uniqueArray(fc.nat({ max: count - 1 }), { minLength: 1, maxLength: count - 1 }),
      fc.array(alnumStringArb(3, 20), { minLength: count, maxLength: count }),
      fc.array(fc.boolean(), { minLength: count, maxLength: count })
    ).map(([bucketBases, failingIndicesArr, errorMessageSuffixes, hasAssetFlags]) => ({
      buckets: bucketBases.map((b) => `bucket-${b}`),
      failingIndices: new Set(failingIndicesArr),
      errorMessageSuffixes,
      hasAssetFlags
    })));

    test('list() excludes only the failing buckets, keeps succeeding-bucket assets, and records one error entry per failure', () => {
      return fc.assert(
        fc.asyncProperty(readFailureScenarioArb, async ({ buckets, failingIndices, errorMessageSuffixes, hasAssetFlags }) => {
          jest.clearAllMocks();
          S3Common.checkBucketAccess.mockResolvedValue(true);

          const prefix = `${NAMESPACE}/${BASE_PATH}/${STEERING_TYPE.folder}/`;

          mockS3Send.mockImplementation(async (command) => {
            const input = command.input || {};
            const bucketIndex = buckets.indexOf(input.Bucket);

            if (failingIndices.has(bucketIndex)) {
              throw new Error(`Simulated S3 failure ${errorMessageSuffixes[bucketIndex]}`);
            }
            if (!hasAssetFlags[bucketIndex]) {
              return { Contents: [] };
            }
            return {
              Contents: [{
                Key: `${prefix}file-${buckets[bucketIndex]}.md`,
                Size: 100 + bucketIndex,
                ETag: `"etag-${bucketIndex}"`,
                LastModified: new Date('2024-01-01T00:00:00.000Z')
              }]
            };
          });

          const connection = {
            host: buckets,
            path: BASE_PATH,
            parameters: { assetTypes: [STEERING_TYPE], namespace: NAMESPACE }
          };

          const result = await S3AgentAssets.list(connection, {});

          const failingBucketNames = new Set([...failingIndices].map((i) => buckets[i]));
          const expectedNames = buckets
            .filter((_, i) => !failingIndices.has(i) && hasAssetFlags[i])
            .map((bucket) => `file-${bucket}.md`)
            .sort();

          // Only succeeding-bucket assets are present, and none originate
          // from a failing bucket.
          expect(result.assets.map((a) => a.name).sort()).toEqual(expectedNames);
          for (const asset of result.assets) {
            expect(failingBucketNames.has(asset.bucket)).toBe(false);
          }

          expect(result.partialData).toBe(true);
          expect(result.errors).toBeDefined();
          expect(result.errors).toHaveLength(failingIndices.size);

          for (const i of failingIndices) {
            const bucket = buckets[i];
            const entry = result.errors.find((e) => e.source === `${bucket}/${NAMESPACE}`);
            expect(entry).toBeDefined();
            expect(entry.sourceType).toBe('s3');
            expect(entry.error).toBe(`Simulated S3 failure ${errorMessageSuffixes[i]}`);
            expect(typeof entry.timestamp).toBe('string');
          }

          // ErrorHandler.logS3Error is called exactly once per failing bucket
          expect(ErrorHandler.logS3Error).toHaveBeenCalledTimes(failingIndices.size);
          for (const i of failingIndices) {
            expect(ErrorHandler.logS3Error).toHaveBeenCalledWith(
              expect.objectContaining({ operation: 'ListObjectsV2', bucket: buckets[i], key: prefix })
            );
          }
        }),
        { numRuns: 100 }
      );
    });

    test('(complement) list() returns partialData: false and errors: undefined when every bucket read succeeds', () => {
      const allSucceedScenarioArb = fc.integer({ min: 1, max: 5 }).chain((count) => fc.tuple(
        uniqueBaseArrayArb(count, count),
        fc.array(fc.boolean(), { minLength: count, maxLength: count })
      ).map(([bucketBases, hasAssetFlags]) => ({
        buckets: bucketBases.map((b) => `bucket-${b}`),
        hasAssetFlags
      })));

      return fc.assert(
        fc.asyncProperty(allSucceedScenarioArb, async ({ buckets, hasAssetFlags }) => {
          jest.clearAllMocks();
          S3Common.checkBucketAccess.mockResolvedValue(true);

          const prefix = `${NAMESPACE}/${BASE_PATH}/${STEERING_TYPE.folder}/`;

          mockS3Send.mockImplementation(async (command) => {
            const input = command.input || {};
            const bucketIndex = buckets.indexOf(input.Bucket);
            if (!hasAssetFlags[bucketIndex]) {
              return { Contents: [] };
            }
            return {
              Contents: [{
                Key: `${prefix}file-${buckets[bucketIndex]}.md`,
                Size: 100 + bucketIndex,
                ETag: `"etag-${bucketIndex}"`,
                LastModified: new Date('2024-01-01T00:00:00.000Z')
              }]
            };
          });

          const connection = {
            host: buckets,
            path: BASE_PATH,
            parameters: { assetTypes: [STEERING_TYPE], namespace: NAMESPACE }
          };

          const result = await S3AgentAssets.list(connection, {});

          const expectedNames = buckets
            .filter((_, i) => hasAssetFlags[i])
            .map((bucket) => `file-${bucket}.md`)
            .sort();

          expect(result.assets.map((a) => a.name).sort()).toEqual(expectedNames);
          expect(result.partialData).toBe(false);
          expect(result.errors).toBeUndefined();
          expect(ErrorHandler.logS3Error).not.toHaveBeenCalled();
        }),
        { numRuns: 100 }
      );
    });
  });

  /* ------------------------------------------------------------------ */
  /*  Property test B: bucket access denial (Requirement 4.2)           */
  /* ------------------------------------------------------------------ */

  describe('Property test B: access-denied buckets brown-out (Requirement 4.2)', () => {

    // 2-5 buckets; a non-empty, proper subset (>=1, <all) is denied access
    // via a mocked checkBucketAccess() resolving false; the rest are
    // allowed and each returns one asset.
    const accessDenialScenarioArb = fc.integer({ min: 2, max: 5 }).chain((count) => fc.tuple(
      uniqueBaseArrayArb(count, count),
      fc.uniqueArray(fc.nat({ max: count - 1 }), { minLength: 1, maxLength: count - 1 })
    ).map(([bucketBases, deniedIndicesArr]) => ({
      buckets: bucketBases.map((b) => `bucket-${b}`),
      deniedIndices: new Set(deniedIndicesArr)
    })));

    test('list() excludes only the access-denied buckets, keeps allowed-bucket assets, records one error per denial, and logs an identifying warning', () => {
      return fc.assert(
        fc.asyncProperty(accessDenialScenarioArb, async ({ buckets, deniedIndices }) => {
          jest.clearAllMocks();

          S3Common.checkBucketAccess.mockImplementation(async (bucket) => (
            !deniedIndices.has(buckets.indexOf(bucket))
          ));
          // Namespace is supplied explicitly below, so getIndexedNamespaces
          // is never actually invoked on this path; mocked defensively
          // regardless, per the design note that it "behaves normally (or
          // is mocked to return a fixed namespace list)" for allowed buckets.
          S3Common.getIndexedNamespaces.mockResolvedValue([NAMESPACE]);

          const prefix = `${NAMESPACE}/${BASE_PATH}/${STEERING_TYPE.folder}/`;

          mockS3Send.mockImplementation(async (command) => {
            const input = command.input || {};
            const bucketIndex = buckets.indexOf(input.Bucket);
            return {
              Contents: [{
                Key: `${prefix}file-${buckets[bucketIndex]}.md`,
                Size: 100 + bucketIndex,
                ETag: `"etag-${bucketIndex}"`,
                LastModified: new Date('2024-01-01T00:00:00.000Z')
              }]
            };
          });

          const connection = {
            host: buckets,
            path: BASE_PATH,
            parameters: { assetTypes: [STEERING_TYPE], namespace: NAMESPACE }
          };

          const result = await S3AgentAssets.list(connection, {});

          const deniedBucketNames = [...deniedIndices].map((i) => buckets[i]);
          const allowedBucketNames = buckets.filter((_, i) => !deniedIndices.has(i));
          const expectedNames = allowedBucketNames.map((bucket) => `file-${bucket}.md`).sort();

          expect(result.assets.map((a) => a.name).sort()).toEqual(expectedNames);
          for (const asset of result.assets) {
            expect(deniedBucketNames).not.toContain(asset.bucket);
          }

          expect(result.partialData).toBe(true);
          expect(result.errors).toBeDefined();
          expect(result.errors).toHaveLength(deniedIndices.size);

          for (const bucket of deniedBucketNames) {
            const entry = result.errors.find((e) => e.source === bucket);
            expect(entry).toBeDefined();
            expect(entry.sourceType).toBe('s3');
            expect(entry.error).toBe('Bucket access not allowed');
            expect(typeof entry.timestamp).toBe('string');

            // A warning identifying this specific excluded bucket was logged.
            expect(DebugAndLog.warn).toHaveBeenCalledWith(expect.stringContaining(bucket));
          }

          // checkBucketAccess() is consulted for every configured bucket...
          expect(S3Common.checkBucketAccess).toHaveBeenCalledTimes(buckets.length);
          // ...but S3 is only ever read for the allowed buckets.
          expect(mockS3Send).toHaveBeenCalledTimes(allowedBucketNames.length);
        }),
        { numRuns: 100 }
      );
    });
  });
});
