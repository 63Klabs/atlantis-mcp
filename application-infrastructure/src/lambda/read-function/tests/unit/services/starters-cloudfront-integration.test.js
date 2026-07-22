/**
 * Unit Tests: Starters Service - S3 Sidecar Metadata Fields
 *
 * Tests that the starters service correctly passes through sidecar metadata
 * fields from S3 starters, including deployment_platform and hasCacheData.
 * With the S3-only approach, all metadata comes from sidecar JSON files.
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');

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

describe('Starters Service - S3 Sidecar Metadata Fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should pass through deployment_platform from sidecar metadata', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        {
          name: 'atlantis-starter',
          deployment_platform: 'atlantis',
          hasCacheData: true,
          hasSidecarMetadata: true
        }
      ],
      errors: undefined
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      return await fetchFunction(conn, opts);
    });

    const result = await Starters.list({});

    expect(result.starters).toHaveLength(1);
    expect(result.starters[0].deployment_platform).toBe('atlantis');
    expect(result.starters[0].hasCacheData).toBe(true);
  });

  it('should handle starters without sidecar metadata (hasSidecarMetadata: false)', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        {
          name: 'no-sidecar-starter',
          hasSidecarMetadata: false,
          languages: [],
          frameworks: [],
          deployment_platform: '',
          hasCacheData: false
        }
      ],
      errors: undefined
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      return await fetchFunction(conn, opts);
    });

    const result = await Starters.list({});

    expect(result.starters).toHaveLength(1);
    expect(result.starters[0].hasSidecarMetadata).toBe(false);
    expect(result.starters[0].hasCacheData).toBe(false);
  });

  it('should handle mixed starters with and without sidecar metadata', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        {
          name: 'full-metadata-starter',
          deployment_platform: 'atlantis',
          hasCacheData: true,
          hasSidecarMetadata: true,
          languages: ['Node.js'],
          frameworks: ['Express']
        },
        {
          name: 'minimal-starter',
          hasSidecarMetadata: false,
          languages: [],
          frameworks: [],
          deployment_platform: '',
          hasCacheData: false
        }
      ],
      errors: undefined
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      return await fetchFunction(conn, opts);
    });

    const result = await Starters.list({});

    expect(result.starters).toHaveLength(2);

    const fullStarter = result.starters.find(s => s.name === 'full-metadata-starter');
    expect(fullStarter.hasSidecarMetadata).toBe(true);
    expect(fullStarter.hasCacheData).toBe(true);

    const minimalStarter = result.starters.find(s => s.name === 'minimal-starter');
    expect(minimalStarter.hasSidecarMetadata).toBe(false);
    expect(minimalStarter.hasCacheData).toBe(false);
  });

  it('should preserve all sidecar metadata fields through the service', async () => {
    Models.S3Starters.list.mockResolvedValue({
      starters: [
        {
          name: 'complete-starter',
          description: 'Complete starter with all fields',
          languages: ['Node.js'],
          frameworks: ['Express'],
          topics: ['serverless', 'aws'],
          dependencies: ['express'],
          devDependencies: ['jest'],
          hasCacheData: true,
          deployment_platform: 'atlantis',
          features: ['API Gateway', 'DynamoDB'],
          prerequisites: ['Node.js 20+'],
          author: '63Klabs',
          license: 'MIT',
          repository: 'https://github.com/63klabs/complete-starter',
          repository_type: 'app-starter',
          version: '1.0.0',
          last_updated: '2024-01-15',
          hasSidecarMetadata: true,
          namespace: 'atlantis',
          bucket: 'test-bucket-1',
          s3ZipPath: 's3://test-bucket-1/atlantis/app-starters/v2/complete-starter.zip',
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

    expect(starter.name).toBe('complete-starter');
    expect(starter.languages).toEqual(['Node.js']);
    expect(starter.frameworks).toEqual(['Express']);
    expect(starter.topics).toEqual(['serverless', 'aws']);
    expect(starter.hasCacheData).toBe(true);
    expect(starter.deployment_platform).toBe('atlantis');
    expect(starter.repository).toBe('https://github.com/63klabs/complete-starter');
    expect(starter.hasSidecarMetadata).toBe(true);
  });
});
