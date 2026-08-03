/**
 * Unit Tests for Shared S3 Helpers (models/s3-common.js)
 *
 * Verifies that S3Common.checkBucketAccess() and S3Common.getIndexedNamespaces()
 * are behavior-equivalent to the private helpers of the same name declared in
 * models/s3-templates.js and models/s3-starters.js. The existing template and
 * starter DAOs are left unchanged by this feature, so this suite proves
 * equivalence by running the shared helper and each existing DAO helper
 * against identical mocked S3 responses and asserting identical results.
 *
 * NOTE: This DAO uses AWS.s3.client from @63klabs/cache-data package, so we
 * mock that the same way the existing s3-templates/s3-starters DAO tests do
 * (see tests/unit/models/s3-templates-dao.test.js).
 *
 * Requirements: 5.6
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

// Mock ErrorHandler so we can assert logS3Error calls made by s3-common.js
// (and, since module resolution is shared within this test file, by
// s3-templates.js as well).
const mockLogS3Error = jest.fn();
jest.mock('../../../utils/error-handler', () => ({
  logS3Error: (...args) => mockLogS3Error(...args)
}));

// Import after mocking so each module picks up the mocked AWS.s3.client / logS3Error
const S3Common = require('../../../models/s3-common');
const S3Templates = require('../../../models/s3-templates');
const S3Starters = require('../../../models/s3-starters');

describe('S3 Common Helpers (models/s3-common.js)', () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    mockLogS3Error.mockReset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('checkBucketAccess()', () => {
    it('returns true for an accessible bucket, matching the stubbed-true behavior of the existing DAO helpers', async () => {
      const result = await S3Common.checkBucketAccess('test-bucket');
      expect(result).toBe(true);
    });

    it('behaves equivalently to S3Templates.checkBucketAccess for the same bucket name', async () => {
      const bucketName = 'equivalence-bucket';

      const commonResult = await S3Common.checkBucketAccess(bucketName);
      const templatesResult = await S3Templates.checkBucketAccess(bucketName);

      expect(commonResult).toBe(templatesResult);
      expect(commonResult).toBe(true);
    });

    it('behaves equivalently to S3Starters.checkBucketAccess for the same bucket name', async () => {
      const bucketName = 'equivalence-bucket';

      const commonResult = await S3Common.checkBucketAccess(bucketName);
      const startersResult = await S3Starters.checkBucketAccess(bucketName);

      expect(commonResult).toBe(startersResult);
      expect(commonResult).toBe(true);
    });

    // NOTE ON THE ERROR PATH: checkBucketAccess()'s catch branch (which calls
    // logS3Error and returns false) is unreachable with the current stub
    // implementation - the try block unconditionally `return`s true and calls
    // nothing that could throw. This exactly mirrors the equivalent dead-code
    // stub already accepted in s3-templates.js and s3-starters.js (see their
    // own "TODO: Implement proper bucket tagging check" tests in
    // s3-templates-dao.test.js, which likewise assert the stubbed `true`
    // result rather than forcing the catch branch). There is no external
    // dependency inside the try block to mock into throwing without modifying
    // production code, which is out of scope for this test-only task.
  });

  describe('getIndexedNamespaces()', () => {
    it('maps CommonPrefixes entries to trimmed namespace strings', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [
          { Prefix: 'atlantis/' },
          { Prefix: 'finance/' },
          { Prefix: 'devops/' }
        ]
      });

      const result = await S3Common.getIndexedNamespaces('test-bucket');

      expect(result).toEqual(['atlantis', 'finance', 'devops']);
    });

    it('filters out empty-string namespace entries', async () => {
      mockS3Send.mockResolvedValueOnce({
        CommonPrefixes: [
          { Prefix: '/' },
          { Prefix: 'atlantis/' }
        ]
      });

      const result = await S3Common.getIndexedNamespaces('test-bucket');

      expect(result).toEqual(['atlantis']);
    });

    it('returns an empty array when the bucket has no namespaces', async () => {
      mockS3Send.mockResolvedValueOnce({ CommonPrefixes: [] });

      const result = await S3Common.getIndexedNamespaces('empty-bucket');

      expect(result).toEqual([]);
    });

    it('behaves equivalently to S3Templates.getIndexedNamespaces for the same S3 response', async () => {
      const s3Response = {
        CommonPrefixes: [
          { Prefix: 'atlantis/' },
          { Prefix: 'finance/' }
        ]
      };

      mockS3Send.mockResolvedValueOnce(s3Response);
      const commonResult = await S3Common.getIndexedNamespaces('equivalence-bucket');

      mockS3Send.mockResolvedValueOnce(s3Response);
      const templatesResult = await S3Templates.getIndexedNamespaces('equivalence-bucket');

      expect(commonResult).toEqual(templatesResult);
      expect(commonResult).toEqual(['atlantis', 'finance']);
    });

    it('behaves equivalently to S3Starters.getIndexedNamespaces for the same S3 response', async () => {
      const s3Response = {
        CommonPrefixes: [
          { Prefix: 'atlantis/' },
          { Prefix: 'finance/' }
        ]
      };

      mockS3Send.mockResolvedValueOnce(s3Response);
      const commonResult = await S3Common.getIndexedNamespaces('equivalence-bucket');

      mockS3Send.mockResolvedValueOnce(s3Response);
      const startersResult = await S3Starters.getIndexedNamespaces('equivalence-bucket');

      expect(commonResult).toEqual(startersResult);
    });

    it('returns an empty array and logs via logS3Error when the S3 client throws', async () => {
      const s3Error = new Error('Access Denied');
      mockS3Send.mockRejectedValueOnce(s3Error);

      const result = await S3Common.getIndexedNamespaces('failing-bucket');

      expect(result).toEqual([]);
      expect(mockLogS3Error).toHaveBeenCalledTimes(1);
      expect(mockLogS3Error).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'ListObjectsV2',
          bucket: 'failing-bucket',
          error: s3Error
        })
      );
    });
  });
});
