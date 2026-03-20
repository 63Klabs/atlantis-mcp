/**
 * Unit tests for Starters Service - hasCacheData Detection
 *
 * Tests that the starters service correctly passes through the hasCacheData
 * field from S3 sidecar metadata. With the S3-only approach, this field
 * comes from the sidecar JSON parsed by the S3 starters model.
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
        buckets: ['test-bucket-1', 'test-bucket-2'],
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
const Models = require('../../../models');
const Starters = require('../../../services/starters');

describe('Starters Service - hasCacheData Detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should include hasCacheData=true for starters with cache-data in sidecar metadata', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        {
          name: 'atlantis-starter-01',
          description: 'Starter with cache-data',
          languages: ['Node.js'],
          hasCacheData: true,
          hasSidecarMetadata: true
        },
        {
          name: 'atlantis-starter-02',
          description: 'Starter without cache-data',
          languages: ['Node.js'],
          hasCacheData: false,
          hasSidecarMetadata: true
        }
      ],
      errors: undefined
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      return await fetchFunction(conn, opts);
    });

    const result = await Starters.list({});

    expect(result.starters).toHaveLength(2);

    const starter01 = result.starters.find(s => s.name === 'atlantis-starter-01');
    expect(starter01.hasCacheData).toBe(true);

    const starter02 = result.starters.find(s => s.name === 'atlantis-starter-02');
    expect(starter02.hasCacheData).toBe(false);
  });

  it('should default hasCacheData to false for starters without sidecar metadata', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        {
          name: 'no-sidecar-starter',
          hasCacheData: false,
          hasSidecarMetadata: false,
          languages: [],
          frameworks: []
        }
      ],
      errors: undefined
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      return await fetchFunction(conn, opts);
    });

    const result = await Starters.list({});

    expect(result.starters).toHaveLength(1);
    expect(result.starters[0].hasCacheData).toBe(false);
    expect(result.starters[0].hasSidecarMetadata).toBe(false);
  });

  it('should preserve all starter metadata fields alongside hasCacheData', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        {
          name: 'full-metadata-starter',
          description: 'Starter with complete metadata',
          languages: ['Node.js'],
          frameworks: ['Express'],
          features: ['API Gateway', 'DynamoDB', 'S3'],
          prerequisites: ['Node.js 20.x', 'AWS CLI'],
          author: '63klabs',
          license: 'MIT',
          repository: 'https://github.com/63klabs/full-metadata-starter',
          repository_type: 'app-starter',
          version: '1.0.0',
          hasCacheData: true,
          deployment_platform: 'atlantis',
          hasSidecarMetadata: true,
          namespace: 'atlantis',
          bucket: 'test-bucket-1',
          s3ZipPath: 's3://test-bucket-1/atlantis/app-starters/v2/full-metadata-starter.zip',
          zipSize: 1024000
        }
      ],
      errors: undefined
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      return await fetchFunction(conn, opts);
    });

    const result = await Starters.list({});

    expect(result.starters).toHaveLength(1);
    const starter = result.starters[0];

    expect(starter.hasCacheData).toBe(true);
    expect(starter.name).toBe('full-metadata-starter');
    expect(starter.languages).toEqual(['Node.js']);
    expect(starter.frameworks).toEqual(['Express']);
    expect(starter.features).toEqual(['API Gateway', 'DynamoDB', 'S3']);
    expect(starter.author).toBe('63klabs');
    expect(starter.hasSidecarMetadata).toBe(true);
  });
});
