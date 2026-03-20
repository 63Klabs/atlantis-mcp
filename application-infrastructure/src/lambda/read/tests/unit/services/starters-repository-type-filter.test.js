/**
 * Unit tests for Starters Service - S3-Only Approach
 *
 * Tests that the starters service correctly uses the s3-app-starters
 * connection exclusively, without any GitHub API dependency.
 * The repository_type field comes from sidecar metadata in S3.
 */

// Mock dependencies before importing service
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    ApiRequest: {
      success: jest.fn(({ body }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: 200 })),
      error: jest.fn(({ body, statusCode }) => ({ getBody: (parse) => parse ? body : JSON.stringify(body), statusCode: statusCode || 500 }))
    }
  }
}));

jest.mock('../../../config', () => ({
  Config: {
    settings: jest.fn(() => ({
      s3: {
        buckets: ['test-bucket'],
        starterPrefix: 'app-starters/v2'
      }
    })),
    getConnCacheProfile: jest.fn(() => ({
      conn: {
        host: [],
        path: 'app-starters/v2',
        parameters: {}
      },
      cacheProfile: {
        hostId: 's3-app-starters',
        pathId: 'starters-list',
        profile: 'default'
      }
    }))
  }
}));

jest.mock('../../../models', () => ({
  S3Starters: {
    list: jest.fn()
  }
}));

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const Starters = require('../../../services/starters');

describe('Starters Service - S3-Only Approach', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should use s3-app-starters connection (not github-api)', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [],
      errors: undefined
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      return await fetchFunction(conn, {});
    });

    await Starters.list({});

    expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-app-starters', 'starters-list');
  });

  it('should include starters with repository_type from sidecar metadata', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        {
          name: 'valid-app-starter',
          description: 'Valid app starter',
          repository_type: 'app-starter',
          hasSidecarMetadata: true,
          namespace: 'atlantis',
          bucket: 'test-bucket'
        }
      ],
      errors: undefined
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      return await fetchFunction(conn, {});
    });

    const result = await Starters.list({});

    expect(result.starters).toHaveLength(1);
    expect(result.starters[0].name).toBe('valid-app-starter');
    expect(result.starters[0].repository_type).toBe('app-starter');
  });

  it('should return starters from S3 only (no GitHub API calls)', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        { name: 's3-starter-1', hasSidecarMetadata: true },
        { name: 's3-starter-2', hasSidecarMetadata: false }
      ],
      errors: undefined
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      return await fetchFunction(conn, {});
    });

    const result = await Starters.list({});

    expect(result.starters).toHaveLength(2);
    expect(Models.S3Starters.list).toHaveBeenCalled();
  });

  it('should set namespace in connection parameters', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [],
      errors: undefined
    });

    let capturedConnection;
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      capturedConnection = conn;
      return await fetchFunction(conn, {});
    });

    await Starters.list({ namespace: 'my-namespace' });

    expect(capturedConnection.parameters).toEqual({
      namespace: 'my-namespace'
    });
  });

  it('should set host to configured S3 buckets when no filter provided', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [],
      errors: undefined
    });

    let capturedConnection;
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
      capturedConnection = conn;
      return await fetchFunction(conn, {});
    });

    await Starters.list({});

    expect(capturedConnection.host).toEqual(['test-bucket']);
  });
});
