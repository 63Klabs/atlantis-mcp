/**
 * Bug Condition Exploration Property Test: Starters Tools Use GitHub API Instead of S3
 *
 * This test encodes the EXPECTED (correct) behavior for starters tools.
 * On UNFIXED code, these tests FAIL — confirming the bug exists.
 * After the fix, these tests PASS — confirming the bug is resolved.
 *
 * Bug: services/starters.js uses Config.getConnCacheProfile('github-api', ...)
 * instead of Config.getConnCacheProfile('s3-app-starters', ...).
 * The tool schemas expose 'ghusers' instead of 's3Buckets'/'namespace'.
 * The sidecar parser reads singular 'language'/'framework' instead of plural arrays.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.7, 1.9**
 */

const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Mocks — set up BEFORE requiring the modules under test
// ---------------------------------------------------------------------------

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
      success: jest.fn((opts) => opts),
      error: jest.fn((opts) => opts)
    },
    CachedSsmParameter: jest.fn().mockImplementation(() => ({
      getValue: jest.fn().mockResolvedValue('mock-value')
    }))
  }
}));

jest.mock('../../../config', () => ({
  Config: {
    getConnCacheProfile: jest.fn(),
    settings: jest.fn()
  }
}));

jest.mock('../../../models', () => ({
  S3Starters: {
    list: jest.fn(),
    get: jest.fn(),
    parseSidecarMetadata: jest.fn()
  },
  GitHubAPI: {
    listRepositories: jest.fn(),
    getRepository: jest.fn()
  }
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { Config } = require('../../../config');
const Models = require('../../../models');
const Starters = require('../../../services/starters');

// Import parseSidecarMetadata directly from the real (unmocked) s3-starters model
// We need the REAL implementation to test the sidecar parsing bug
const { parseSidecarMetadata } = jest.requireActual('../../../models/s3-starters');

// Import settings directly (real module) to inspect tool schemas
// We need the REAL settings to verify the schema definitions
const settings = jest.requireActual('../../../config/settings');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearMockCalls() {
  CacheableDataAccess.getData.mockClear();
  Config.getConnCacheProfile.mockClear();
  Config.settings.mockClear();
  if (Models.S3Starters.list) Models.S3Starters.list.mockClear();
  if (Models.S3Starters.get) Models.S3Starters.get.mockClear();
  if (Models.GitHubAPI.listRepositories) Models.GitHubAPI.listRepositories.mockClear();
  if (Models.GitHubAPI.getRepository) Models.GitHubAPI.getRepository.mockClear();
}

function setupMocks() {
  Config.getConnCacheProfile.mockImplementation((connName, profileName) => ({
    conn: {
      name: connName,
      host: [],
      path: 'app-starters/v2',
      parameters: {},
      cache: []
    },
    cacheProfile: {
      profile: profileName,
      overrideOriginHeaderExpiration: true,
      defaultExpirationInSeconds: 1800,
      expirationIsOnInterval: false,
      headersToRetain: '',
      hostId: connName,
      pathId: profileName,
      encrypt: false
    }
  }));

  Config.settings.mockReturnValue({
    s3: { buckets: ['63klabs'], starterPrefix: 'app-starters/v2' },
    github: { userOrgs: ['63klabs'] }
  });

  CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn) => {
    const result = await fetchFunction(conn, {});
    return {
      getBody: (raw) => result?.body ?? null
    };
  });

  Models.S3Starters.list.mockResolvedValue({
    starters: [{ name: 'test-starter', description: 'A test starter' }],
    errors: undefined,
    partialData: false
  });

  Models.S3Starters.get.mockResolvedValue({
    name: 'test-starter',
    description: 'A test starter',
    namespace: '63klabs',
    bucket: '63klabs'
  });

  Models.GitHubAPI.listRepositories.mockResolvedValue({
    repositories: [],
    errors: undefined
  });

  Models.GitHubAPI.getRepository.mockResolvedValue(null);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Bug Condition Exploration: Starters Tools Use GitHub API Instead of S3', () => {

  beforeEach(() => {
    clearMockCalls();
    setupMocks();
  });

  // -----------------------------------------------------------------------
  // Test 1a: list() should use 's3-app-starters' connection, not 'github-api'
  // **Validates: Requirements 1.1**
  // -----------------------------------------------------------------------
  test('1a: Services.Starters.list() calls Config.getConnCacheProfile with s3-app-starters and starters-list', async () => {
    await Starters.list({});

    // The EXPECTED (correct) behavior: service uses 's3-app-starters'
    // On UNFIXED code: service calls Config.getConnCacheProfile('github-api', 'starters-list')
    expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-app-starters', 'starters-list');
  });

  // -----------------------------------------------------------------------
  // Test 1b: get() should use 's3-app-starters' connection, not 'github-api'
  // **Validates: Requirements 1.2**
  // -----------------------------------------------------------------------
  test('1b: Services.Starters.get() calls Config.getConnCacheProfile with s3-app-starters and starter-detail', async () => {
    await Starters.get({ starterName: 'test-starter' });

    // The EXPECTED (correct) behavior: service uses 's3-app-starters'
    // On UNFIXED code: service calls Config.getConnCacheProfile('github-api', 'starter-detail')
    expect(Config.getConnCacheProfile).toHaveBeenCalledWith('s3-app-starters', 'starter-detail');
  });

  // -----------------------------------------------------------------------
  // Test 1c: list() should accept { s3Buckets, namespace } not { ghusers }
  // **Validates: Requirements 1.3**
  // -----------------------------------------------------------------------
  test('1c: Services.Starters.list() accepts s3Buckets and namespace parameters', async () => {
    await Starters.list({ s3Buckets: ['63klabs'], namespace: 'myns' });

    // Verify the connection was set up with the s3Buckets as host
    expect(CacheableDataAccess.getData).toHaveBeenCalledTimes(1);
    const conn = CacheableDataAccess.getData.mock.calls[0][2];

    // The EXPECTED (correct) behavior: conn.host is set to the s3Buckets array
    // On UNFIXED code: the service destructures { ghusers } so s3Buckets/namespace are ignored
    // and conn.host is set to github userOrgs instead
    expect(conn.host).toEqual(['63klabs']);

    // Also verify namespace is passed through in parameters
    expect(conn.parameters).toHaveProperty('namespace', 'myns');
  });

  // -----------------------------------------------------------------------
  // Test 1d: settings.js list_starters schema should have s3Buckets property
  // **Validates: Requirements 1.5, 1.7**
  // -----------------------------------------------------------------------
  test('1d: list_starters tool schema in settings has s3Buckets property (not ghusers)', () => {
    const listStartersTool = settings.tools.availableToolsList.find(
      t => t.name === 'list_starters'
    );

    expect(listStartersTool).toBeDefined();

    const schemaProps = listStartersTool.inputSchema.properties;

    // The EXPECTED (correct) behavior: schema has s3Buckets and namespace
    // On UNFIXED code: schema has ghusers instead
    expect(schemaProps).toHaveProperty('s3Buckets');
    expect(schemaProps).not.toHaveProperty('ghusers');
  });

  // -----------------------------------------------------------------------
  // Test 1e: parseSidecarMetadata should return arrays for languages/frameworks
  // **Validates: Requirements 1.9**
  // -----------------------------------------------------------------------
  test('1e: parseSidecarMetadata returns arrays for languages and frameworks', () => {
    const metadata = parseSidecarMetadata(
      '{"languages":["Node.js"],"frameworks":["Express"]}'
    );

    // The EXPECTED (correct) behavior: languages and frameworks are arrays
    // On UNFIXED code: it reads singular 'language'/'framework' fields,
    // so metadata.languages is undefined and metadata.language is '' (empty string)
    expect(Array.isArray(metadata.languages)).toBe(true);
    expect(metadata.languages).toEqual(['Node.js']);
    expect(Array.isArray(metadata.frameworks)).toBe(true);
    expect(metadata.frameworks).toEqual(['Express']);
  });

  // -----------------------------------------------------------------------
  // Test 1f: Property-based test — for any valid starter name, get_starter_info
  // schema should accept s3Buckets without validation error
  // **Validates: Requirements 1.2, 1.5**
  // -----------------------------------------------------------------------
  test('1f: Property: for any valid starter name, get_starter_info schema accepts s3Buckets', () => {
    // Arbitrary: valid starter name strings (lowercase alphanumeric with hyphens)
    const starterNameArb = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
      { minLength: 1, maxLength: 50 }
    ).filter(s => /^[a-z0-9][a-z0-9-]*$/.test(s));

    const getStarterInfoTool = settings.tools.availableToolsList.find(
      t => t.name === 'get_starter_info'
    );

    return fc.assert(
      fc.property(
        starterNameArb,
        (starterName) => {
          // The EXPECTED (correct) behavior: get_starter_info schema has s3Buckets
          // On UNFIXED code: schema has ghusers, so s3Buckets would be unknown
          const schemaProps = getStarterInfoTool.inputSchema.properties;

          // s3Buckets should be a valid property in the schema
          expect(schemaProps).toHaveProperty('s3Buckets');
          expect(schemaProps).toHaveProperty('starterName');
          expect(schemaProps).not.toHaveProperty('ghusers');
        }
      ),
      { numRuns: 50 }
    );
  });
});
