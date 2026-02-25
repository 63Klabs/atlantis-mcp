/**
 * Unit tests for Starters Service - Cache-Data Integration Detection
 * 
 * Tests that the starters service correctly indicates which starters
 * include cache-data integration based on sidecar metadata.
 */

describe('Starters Service - Cache-Data Integration Detection', () => {
  let Starters;
  let Models;
  let CacheableDataAccess;

  beforeEach(() => {
    // Reset modules
    jest.resetModules();

    // Mock cache-data package
    const mockCacheableDataAccess = {
      getData: jest.fn()
    };

    jest.mock('@63klabs/cache-data', () => ({
      cache: {
        CacheableDataAccess: mockCacheableDataAccess
      },
      tools: {
        DebugAndLog: {
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn()
        }
      }
    }));

    CacheableDataAccess = mockCacheableDataAccess;

    // Mock Config
    jest.mock('../../../lambda/read/config', () => ({
      settings: jest.fn(() => ({
        github: {
          userOrgs: ['63klabs', 'testorg']
        },
        s3: {
          buckets: ['test-bucket-1', 'test-bucket-2'],
          starterPrefix: 'app-starters/v2'
        }
      })),
      getConnCacheProfile: jest.fn(() => ({
        conn: {
          host: [],
          path: '/repos',
          parameters: {}
        },
        cacheProfile: {
          hostId: 'github-api',
          pathId: 'starters-list',
          profile: 'default'
        }
      }))
    }));

    // Mock Models
    jest.mock('../../../lambda/read/models', () => ({
      S3Starters: {
        list: jest.fn()
      },
      GitHubAPI: {
        listRepositories: jest.fn()
      }
    }));

    Models = require('../../../lambda/read/models');

    // Import service after mocks
    Starters = require('../../../lambda/read/services/starters');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should include hasCacheDataIntegration=true for S3 starters with cache-data in sidecar metadata', async () => {
    // Mock S3 starters with cache-data integration
    const s3Starters = [
      {
        name: 'atlantis-starter-01',
        description: 'Basic starter with cache-data',
        language: 'Node.js',
        cacheDataIntegration: true,
        cloudFrontIntegration: false
      },
      {
        name: 'atlantis-starter-02',
        description: 'Advanced starter without cache-data',
        language: 'Node.js',
        cacheDataIntegration: false,
        cloudFrontIntegration: true
      }
    ];

    // Mock GitHub starters
    const githubRepos = [
      {
        name: 'github-starter-01',
        description: 'GitHub starter',
        language: 'Python',
        url: 'https://github.com/63klabs/github-starter-01',
        atlantis_repository_type: 'app-starter',
        userOrg: '63klabs'
      }
    ];

    // Mock S3Starters.list to return starters with cache-data integration
    Models.S3Starters.list.mockResolvedValue({
      starters: s3Starters,
      errors: [],
      partialData: false
    });

    // Mock GitHubAPI.listRepositories
    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: githubRepos,
      errors: [],
      partialData: false
    });

    // Mock CacheableDataAccess.getData to call fetch function
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      const result = await fetchFunction(conn, opts);
      return { body: result };
    });

    // Call the service
    const result = await Starters.list({});

    // Verify results
    expect(result.starters).toBeDefined();
    expect(result.starters.length).toBe(3);

    // Check S3 starter with cache-data integration
    const starter01 = result.starters.find(s => s.name === 'atlantis-starter-01');
    expect(starter01).toBeDefined();
    expect(starter01.hasCacheDataIntegration).toBe(true);
    expect(starter01.source).toBe('s3');
    expect(starter01.hasSidecarMetadata).toBe(true);

    // Check S3 starter without cache-data integration
    const starter02 = result.starters.find(s => s.name === 'atlantis-starter-02');
    expect(starter02).toBeDefined();
    expect(starter02.hasCacheDataIntegration).toBe(false);
    expect(starter02.source).toBe('s3');

    // Check GitHub starter (should default to false)
    const githubStarter = result.starters.find(s => s.name === 'github-starter-01');
    expect(githubStarter).toBeDefined();
    expect(githubStarter.hasCacheDataIntegration).toBe(false);
    expect(githubStarter.source).toBe('github');
    expect(githubStarter.hasSidecarMetadata).toBe(false);
  });

  it('should default hasCacheDataIntegration to false when sidecar metadata field is missing', async () => {
    // Mock S3 starters without cacheDataIntegration field
    const s3Starters = [
      {
        name: 'legacy-starter',
        description: 'Legacy starter without cache-data field',
        language: 'Node.js'
        // cacheDataIntegration field is missing
      }
    ];

    Models.S3Starters.list.mockResolvedValue({
      starters: s3Starters,
      errors: [],
      partialData: false
    });

    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: [],
      errors: [],
      partialData: false
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      const result = await fetchFunction(conn, opts);
      return { body: result };
    });

    const result = await Starters.list({});

    expect(result.starters).toBeDefined();
    expect(result.starters.length).toBe(1);

    const legacyStarter = result.starters[0];
    expect(legacyStarter.name).toBe('legacy-starter');
    expect(legacyStarter.hasCacheDataIntegration).toBe(false);
  });

  it('should handle GitHub starters without sidecar metadata (default to false)', async () => {
    // Mock only GitHub starters
    const githubRepos = [
      {
        name: 'github-only-starter',
        description: 'GitHub starter without S3 package',
        language: 'Python',
        url: 'https://github.com/testorg/github-only-starter',
        cloneUrl: 'https://github.com/testorg/github-only-starter.git',
        sshUrl: 'git@github.com:testorg/github-only-starter.git',
        defaultBranch: 'main',
        stargazersCount: 10,
        forksCount: 2,
        updatedAt: '2024-01-15T10:00:00Z',
        createdAt: '2023-01-01T10:00:00Z',
        atlantis_repository_type: 'app-starter',
        userOrg: 'testorg'
      }
    ];

    Models.S3Starters.list.mockResolvedValue({
      starters: [],
      errors: [],
      partialData: false
    });

    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: githubRepos,
      errors: [],
      partialData: false
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      const result = await fetchFunction(conn, opts);
      return { body: result };
    });

    const result = await Starters.list({});

    expect(result.starters).toBeDefined();
    expect(result.starters.length).toBe(1);

    const githubStarter = result.starters[0];
    expect(githubStarter.name).toBe('github-only-starter');
    expect(githubStarter.hasCacheDataIntegration).toBe(false);
    expect(githubStarter.source).toBe('github');
    expect(githubStarter.hasS3Package).toBe(false);
    expect(githubStarter.hasSidecarMetadata).toBe(false);
  });

  it('should preserve all other starter metadata fields when adding hasCacheDataIntegration', async () => {
    const s3Starters = [
      {
        name: 'full-metadata-starter',
        description: 'Starter with complete metadata',
        language: 'Node.js',
        framework: 'Express',
        features: ['API Gateway', 'DynamoDB', 'S3'],
        prerequisites: ['Node.js 20.x', 'AWS CLI'],
        author: '63klabs',
        license: 'MIT',
        githubUrl: 'https://github.com/63klabs/full-metadata-starter',
        repositoryType: 'app-starter',
        version: '1.0.0',
        lastUpdated: '2024-01-15',
        cacheDataIntegration: true,
        cloudFrontIntegration: false,
        namespace: 'atlantis',
        bucket: 'test-bucket-1',
        s3ZipPath: 's3://test-bucket-1/atlantis/app-starters/v2/full-metadata-starter.zip',
        zipSize: 1024000
      }
    ];

    Models.S3Starters.list.mockResolvedValue({
      starters: s3Starters,
      errors: [],
      partialData: false
    });

    Models.GitHubAPI.listRepositories.mockResolvedValue({
      repositories: [],
      errors: [],
      partialData: false
    });

    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      const result = await fetchFunction(conn, opts);
      return { body: result };
    });

    const result = await Starters.list({});

    expect(result.starters).toBeDefined();
    expect(result.starters.length).toBe(1);

    const starter = result.starters[0];
    
    // Verify hasCacheDataIntegration is added
    expect(starter.hasCacheDataIntegration).toBe(true);
    
    // Verify all original fields are preserved
    expect(starter.name).toBe('full-metadata-starter');
    expect(starter.description).toBe('Starter with complete metadata');
    expect(starter.language).toBe('Node.js');
    expect(starter.framework).toBe('Express');
    expect(starter.features).toEqual(['API Gateway', 'DynamoDB', 'S3']);
    expect(starter.prerequisites).toEqual(['Node.js 20.x', 'AWS CLI']);
    expect(starter.author).toBe('63klabs');
    expect(starter.license).toBe('MIT');
    expect(starter.githubUrl).toBe('https://github.com/63klabs/full-metadata-starter');
    expect(starter.version).toBe('1.0.0');
    expect(starter.namespace).toBe('atlantis');
    expect(starter.bucket).toBe('test-bucket-1');
    expect(starter.source).toBe('s3');
    expect(starter.hasS3Package).toBe(true);
    expect(starter.hasSidecarMetadata).toBe(true);
  });
});
