/**
 * Unit Tests for S3 Agent Assets DAO (example/edge/error cases)
 *
 * Focused, example-based unit tests for `models/s3-agent-assets.js` covering:
 * - Empty listing returns an empty list with no error (Requirement 1.3)
 * - get() issues a latest-version GetObject with no VersionId (Requirement 2.5)
 * - A missing asset returns null, which feeds the service-layer ASSET_NOT_FOUND
 *   error (Requirement 2.4)
 * - A `name` containing a path separator is NOT rejected by the DAO itself -
 *   that validation happens at the controller/schema layer (Requirement 7.3)
 * - A representative brown-out example: one bucket fails with a generic error
 *   while a second bucket still returns results (Requirement 4.2)
 *
 * Property-based coverage for direct/extension-matching listing, list-item
 * completeness, dedup ordering, namespace scoping, key construction, detail
 * completeness, SHA-256 correctness, and brown-out/partial-data properties
 * lives in the sibling `*.property.test.js` files (tasks 3.5-3.13); this file
 * intentionally sticks to example/edge/error cases to avoid duplicating that
 * coverage.
 *
 * NOTE: This DAO uses AWS.s3.client from @63klabs/cache-data package, so we
 * mock that the same way the existing s3-templates/s3-starters/s3-common DAO
 * tests do (see tests/unit/models/s3-templates-dao.test.js).
 *
 * Requirements: 1.3, 2.4, 2.5, 4.2
 */

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
// picks up the mocked AWS.s3.client / logS3Error
const S3AgentAssets = require('../../../models/s3-agent-assets');
const ErrorHandler = require('../../../utils/error-handler');

/** Registry-shaped `steering` type fixture, mirroring config/agent-asset-types.js */
const STEERING_TYPE = { name: 'steering', folder: 'steering', extensions: ['.md'] };

describe('S3 Agent Assets DAO', () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockS3Send.mockReset();
  });

  describe('Requirement 1.3: empty listing returns success, not an error', () => {
    it('returns an empty asset list with no errors and partialData: false when no objects match the type prefix', async () => {
      // Namespace discovery for the bucket
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [{ Prefix: 'atlantis/' }]
      });
      // Listing under the steering/ prefix returns no objects and no nested CommonPrefixes
      mockS3Send.mockResolvedValueOnce({ Contents: [] });

      const connection = {
        host: 'test-bucket',
        path: 'utilities/v2/agent_assets',
        parameters: { assetTypes: [STEERING_TYPE] }
      };

      const result = await S3AgentAssets.list(connection, {});

      expect(result).toEqual({ assets: [], errors: undefined, partialData: false });
    });
  });

  describe('Requirement 2.5: get() reads the latest version only (no VersionId)', () => {
    it('issues a GetObjectCommand whose input has no VersionId property', async () => {
      const content = '# Product Guidelines\n\nBe consistent.\n';
      const contentBytes = Buffer.from(content, 'utf-8');

      mockS3Send.mockResolvedValueOnce({
        Body: { transformToByteArray: async () => contentBytes },
        ETag: '"9b2cf-etag"',
        LastModified: new Date('2024-01-01T00:00:00.000Z')
      });

      const connection = {
        host: 'test-bucket',
        path: 'utilities/v2/agent_assets',
        parameters: {
          assetType: STEERING_TYPE,
          name: 'product-guidelines.md',
          namespace: 'atlantis'
        }
      };

      const result = await S3AgentAssets.get(connection, {});

      expect(result).not.toBeNull();
      expect(result.name).toBe('product-guidelines.md');
      expect(result.type).toBe('steering');
      expect(result.namespace).toBe('atlantis');
      expect(result.bucket).toBe('test-bucket');
      expect(result.s3Path).toBe('s3://test-bucket/atlantis/utilities/v2/agent_assets/steering/product-guidelines.md');
      expect(result.content).toBe(content);

      // Only one S3 call: namespace was supplied directly, so no namespace-discovery call is made
      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const callArg = mockS3Send.mock.calls[0][0];
      // The GetObjectCommand input is exactly {Bucket, Key} - no VersionId key at all,
      // confirming the DAO always reads the latest object version.
      expect(callArg.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'atlantis/utilities/v2/agent_assets/steering/product-guidelines.md'
      });
      expect(callArg.input).not.toHaveProperty('VersionId');
      expect(callArg.input.VersionId).toBeUndefined();
    });
  });

  describe('Requirement 2.4: a missing asset returns null (feeds ASSET_NOT_FOUND upstream)', () => {
    it('returns null when the asset is not found in any bucket/namespace tried', async () => {
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' }); // bucket1
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' }); // bucket2

      const connection = {
        host: ['bucket1', 'bucket2'],
        path: 'utilities/v2/agent_assets',
        parameters: {
          assetType: STEERING_TYPE,
          name: 'missing-guidelines.md',
          namespace: 'atlantis'
        }
      };

      const result = await S3AgentAssets.get(connection, {});

      expect(result).toBeNull();
      expect(mockS3Send).toHaveBeenCalledTimes(2);
    });
  });

  describe('Requirement 7.3: a name containing a path separator is NOT rejected by the DAO', () => {
    // Investigated `get()` and `buildAssetKey()` in models/s3-agent-assets.js directly:
    // neither performs any validation of `name`. `buildAssetKey` is pure string
    // concatenation, and `get()` passes `name` straight through to `buildAssetKey`
    // with no regex/guard beforehand. Per design.md ("Input validation before any
    // S3 read", Property 11), rejecting a `name` containing `/` or `\` is the
    // CONTROLLER/SCHEMA layer's responsibility - SchemaValidator's `^[^/\\]+$`
    // pattern (Requirements 7.1, 7.7), wired into controllers/agent-assets.js
    // (task 6.x) and utils/schema-validator.js (task 8.2) - which runs BEFORE the
    // DAO is ever invoked. These tests document that the DAO itself has no such
    // guard, so the "no S3 read occurs" guarantee of Requirement 7.3 is enforced
    // upstream of this layer, not here.

    it('buildAssetKey() appends a "/"-containing name verbatim, without sanitizing or rejecting it', () => {
      const key = S3AgentAssets.buildAssetKey(
        'atlantis',
        'utilities/v2/agent_assets',
        'steering',
        '../secrets/file.md'
      );

      expect(key).toBe('atlantis/utilities/v2/agent_assets/steering/../secrets/file.md');
      expect(key).toContain('/');
    });

    it('buildAssetKey() appends a "\\"-containing name verbatim, without sanitizing or rejecting it', () => {
      const key = S3AgentAssets.buildAssetKey(
        'atlantis',
        'utilities/v2/agent_assets',
        'steering',
        'evil\\name.md'
      );

      expect(key).toBe('atlantis/utilities/v2/agent_assets/steering/evil\\name.md');
      expect(key).toContain('\\');
    });

    it('get() performs no defensive name validation and attempts an S3 read using the unsanitized key', async () => {
      // Simulate the (malicious) key simply not existing - the point of this
      // smoke test is that the DAO reaches S3 at all using the raw name, not
      // that it happens to find something there. If the DAO defensively
      // rejected this `name` before any S3 read, mockS3Send would never be
      // called.
      mockS3Send.mockRejectedValueOnce({ name: 'NoSuchKey' });

      const connection = {
        host: 'test-bucket',
        path: 'utilities/v2/agent_assets',
        parameters: {
          assetType: STEERING_TYPE,
          name: '../secrets/file.md',
          namespace: 'atlantis'
        }
      };

      const result = await S3AgentAssets.get(connection, {});

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      const callArg = mockS3Send.mock.calls[0][0];
      expect(callArg.input.Key).toBe('atlantis/utilities/v2/agent_assets/steering/../secrets/file.md');
      expect(result).toBeNull(); // NoSuchKey at the only bucket/namespace tried
    });
  });

  describe('Requirement 4.2: representative brown-out example', () => {
    it("skips a bucket whose listing fails with a generic error and still returns the other bucket's assets", async () => {
      // bucket1: ListObjectsV2Command fails with a generic (non-NoSuchKey) error
      mockS3Send.mockRejectedValueOnce(new Error('Access Denied'));
      // bucket2: succeeds with one matching object
      mockS3Send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'atlantis/utilities/v2/agent_assets/steering/product-guidelines.md',
            Size: 4096,
            ETag: '"etag-bucket2"',
            LastModified: new Date('2024-01-01T00:00:00.000Z')
          }
        ]
      });

      const connection = {
        host: ['bucket1', 'bucket2'],
        path: 'utilities/v2/agent_assets',
        parameters: {
          assetTypes: [STEERING_TYPE],
          namespace: 'atlantis' // explicit namespace keeps the mock sequence to one call per bucket
        }
      };

      const result = await S3AgentAssets.list(connection, {});

      expect(result.assets).toHaveLength(1);
      expect(result.assets[0]).toMatchObject({
        name: 'product-guidelines.md',
        type: 'steering',
        bucket: 'bucket2',
        namespace: 'atlantis'
      });

      expect(result.partialData).toBe(true);
      expect(result.errors).toBeDefined();
      expect(result.errors.some((e) => e.source === 'bucket1/atlantis')).toBe(true);
      expect(ErrorHandler.logS3Error).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'ListObjectsV2',
          bucket: 'bucket1'
        })
      );
    });
  });
});
