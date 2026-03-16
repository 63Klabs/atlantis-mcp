/**
 * Starters Service
 *
 * Provides business logic for app starter operations with caching.
 * Implements pass-through caching using cache-data package for:
 * - Starter listing with filtering by GitHub users/orgs
 * - Starter retrieval with metadata
 *
 * Aggregates starters from both S3 buckets and GitHub repositories,
 * filtering by atlantis_repository-type: app-starter custom property.
 *
 * @module services/starters
 */

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const Models = require('../models');

/**
 * List app starters with cache-data pass-through caching
 *
 * Aggregates starters from both S3 buckets and GitHub repositories.
 * Filters by atlantis_repository-type: app-starter custom property.
 *
 * @param {Object} options - Filter options
 * @param {Array<string>} [options.ghusers] - Filter to specific GitHub users/orgs (optional, validated against settings)
 * @returns {Promise<Object>} { starters: Array, errors: Array, partialData: boolean }
 *
 * Each starter object includes:
 * - hasS3Package: boolean - Whether starter has S3 package available
 * - hasSidecarMetadata: boolean - Whether starter has sidecar metadata
 * - hasCacheDataIntegration: boolean - Whether starter includes cache-data integration
 * - hasCloudFrontIntegration: boolean - Whether starter includes CloudFront integration
 *
 * @example
 * // List all starters
 * const result = await Starters.list({});
 *
 * @example
 * // List starters from specific GitHub users/orgs
 * const result = await Starters.list({ ghusers: ['63klabs', 'myorg'] });
 */
async function list(options = {}) {
  const logName = "service.starters.list";
  const { ghusers } = options;

  // >! Get connection and cache profile from config
  const { conn, cacheProfile } = Config.getConnCacheProfile('github-api', 'starters-list');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for github-api/starters-list');
  }

  // >! Determine which GitHub users/orgs to search (filtered or all)
  let usersOrgsToSearch = ghusers;
  if (!usersOrgsToSearch || usersOrgsToSearch.length === 0) {
    usersOrgsToSearch = Config.settings().github.userOrgs;
  } else {
    // >! Validate that requested users/orgs are in configured users/orgs
    const validUsersOrgs = Config.settings().github.userOrgs;
    usersOrgsToSearch = usersOrgsToSearch.filter(u => validUsersOrgs.includes(u));
    if (usersOrgsToSearch.length === 0) {
      throw new Error('No valid GitHub users/orgs specified');
    }
  }

  // >! Set host to array of users/orgs (used in cache key)
  conn.host = usersOrgsToSearch;

  // >! Set parameters for cache key - filter by app-starter repository type
  conn.parameters = { repositoryType: 'app-starter' };

  // >! Define fetch function for cache miss
  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug('Fetching starters (cache miss)', {
      usersOrgs: connection.host,
      repositoryType: 'app-starter'
    });

    // >! Get S3 buckets from settings
    const s3Buckets = Config.settings().s3.buckets;

    // >! Aggregate starters from both S3 buckets and GitHub repositories
    const [s3Result, githubResult] = await Promise.all([
      // Fetch from S3 buckets
      Models.S3Starters.list({
        host: s3Buckets,
        path: Config.settings().s3.starterPrefix,
        parameters: {}
      }, opts),

      // Fetch from GitHub repositories
      Models.GitHubAPI.listRepositories(connection, opts)
    ]);

    // >! Combine results from both sources
    const allStarters = [];
    const allErrors = [];

    // Add S3 starters
    if (s3Result.starters) {
      allStarters.push(...s3Result.starters.map(starter => ({
        ...starter,
        source: 's3',
        hasS3Package: true,
        hasSidecarMetadata: true, // S3 starters require sidecar metadata
        hasCacheDataIntegration: starter.cacheDataIntegration || false,
        hasCloudFrontIntegration: starter.cloudFrontIntegration || false
      })));
    }
    if (s3Result.errors) {
      allErrors.push(...s3Result.errors);
    }

    // Add GitHub starters (filtered by atlantis_repository-type: app-starter)
    if (githubResult.repositories) {
      allStarters.push(...githubResult.repositories.map(repo => ({
        name: repo.name,
        description: repo.description,
        language: repo.language,
        githubUrl: repo.url,
        cloneUrl: repo.cloneUrl,
        sshUrl: repo.sshUrl,
        defaultBranch: repo.defaultBranch,
        stars: repo.stargazersCount,
        forks: repo.forksCount,
        lastUpdated: repo.updatedAt,
        createdAt: repo.createdAt,
        repositoryType: repo.atlantis_repository_type,
        userOrg: repo.userOrg,
        source: 'github',
        hasS3Package: false,
        hasSidecarMetadata: false,
        hasCacheDataIntegration: false, // GitHub starters without sidecar metadata default to false
        hasCloudFrontIntegration: false // GitHub starters without sidecar metadata default to false
      })));
    }
    if (githubResult.errors) {
      allErrors.push(...githubResult.errors);
    }

    // >! Deduplicate starters by name (S3 takes precedence over GitHub)
    const uniqueStarters = deduplicateStarters(allStarters);

    const returnObject = {
      starters: uniqueStarters,
      errors: allErrors.length > 0 ? allErrors : undefined,
      partialData: allErrors.length > 0
    };

    // >! We need to wrap the list in a response format suitable for CacheableDataAccess
    // if ("errors" in list) {
    if (returnObject?.errors) {
      DebugAndLog.warn(`${logName}.fetchFunction: Starters list contains errors`, { errors: returnObject.errors });
      return ApiRequest.error({body: returnObject});
    } else {
      return ApiRequest.success({body: returnObject});
    }

  };

  // >! Use cache-data pass-through caching
  const cacheObj = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}, // options: for functions, tokens, non-cache data
  );

  return cacheObj.getBody(true);
}

/**
 * Deduplicate starters by name (S3 takes precedence over GitHub)
 *
 * @private
 * @param {Array<Object>} starters - Array of starter objects
 * @returns {Array<Object>} Deduplicated starters
 */
function deduplicateStarters(starters) {
  const seen = new Map();
  const deduplicated = [];

  // Sort so S3 starters come first (they have priority)
  const sorted = starters.sort((a, b) => {
    if (a.source === 's3' && b.source !== 's3') {
      return -1;
    }
    if (a.source !== 's3' && b.source === 's3') {
      return 1;
    }
    return 0;
  });

  for (const starter of sorted) {
    const key = starter.name.toLowerCase();

    if (!seen.has(key)) {
      seen.set(key, true);
      deduplicated.push(starter);
    } else {
      DebugAndLog.debug(`Skipping duplicate starter: ${starter.name} from ${starter.source}`);
    }
  }

  return deduplicated;
}

/**
 * Get specific app starter with cache-data pass-through caching
 *
 * Aggregates starter details from both S3 buckets and GitHub repositories.
 * Prefers S3 sidecar metadata when available.
 *
 * @param {Object} options - Starter identification
 * @param {string} options.starterName - Starter name (required)
 * @param {Array<string>} [options.ghusers] - Filter to specific GitHub users/orgs (optional, validated against settings)
 * @returns {Promise<Object>} Starter details
 * @throws {Error} STARTER_NOT_FOUND if starter not found
 *
 * Returned starter object includes:
 * - Basic metadata (name, description, language, framework, features, prerequisites, author, license)
 * - Integration flags (hasCacheDataIntegration, hasCloudFrontIntegration)
 * - Repository information (githubUrl, cloneUrl, sshUrl, defaultBranch)
 * - Repository stats (stars, forks, lastUpdated)
 * - S3 package information (hasS3Package, s3ZipPath, zipSize)
 * - Sidecar metadata flag (hasSidecarMetadata)
 * - Example code snippets (if available in sidecar metadata)
 * - Private repository indicator (isPrivate)
 *
 * @example
 * // Get starter by name
 * const starter = await Starters.get({ starterName: 'atlantis-starter-02' });
 *
 * @example
 * // Get starter from specific GitHub users/orgs
 * const starter = await Starters.get({
 *   starterName: 'atlantis-starter-02',
 *   ghusers: ['63klabs']
 * });
 */
async function get(options = {}) {
  const logName = "service.starters.get";
  const { starterName, ghusers } = options;

  if (!starterName) {
    throw new Error('starterName is required');
  }

  // >! Get connection and cache profile from config
  const { conn, cacheProfile } = Config.getConnCacheProfile('github-api', 'starter-detail');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for github-api/starter-detail');
  }

  // >! Determine which GitHub users/orgs to search (filtered or all)
  let usersOrgsToSearch = ghusers;
  if (!usersOrgsToSearch || usersOrgsToSearch.length === 0) {
    usersOrgsToSearch = Config.settings().github.userOrgs;
  } else {
    // >! Validate that requested users/orgs are in configured users/orgs
    const validUsersOrgs = Config.settings().github.userOrgs;
    usersOrgsToSearch = usersOrgsToSearch.filter(u => validUsersOrgs.includes(u));
    if (usersOrgsToSearch.length === 0) {
      throw new Error('No valid GitHub users/orgs specified');
    }
  }

  // >! Set host to array of users/orgs (used in cache key)
  conn.host = usersOrgsToSearch;

  // >! Update pathId for logging with specific starter
  cacheProfile.pathId = `${cacheProfile.pathId}:${starterName}`;

  // >! Set parameters for cache key and DAO filtering
  conn.parameters = { starterName, repositoryType: 'app-starter' };

  // >! Define fetch function for cache miss
  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug('Fetching starter details (cache miss)', {
      starterName,
      usersOrgs: connection.host
    });

    // >! Get S3 buckets from settings
    const s3Buckets = Config.settings().s3.buckets;

    // >! Aggregate starter from both S3 buckets and GitHub repositories
    const [s3Result, githubResult] = await Promise.all([
      // Fetch from S3 buckets
      Models.S3Starters.get({
        host: s3Buckets,
        path: Config.settings().s3.starterPrefix,
        parameters: { starterName }
      }, opts),

      // Fetch from GitHub repositories
      Models.GitHubAPI.getRepository({
        host: connection.host,
        parameters: { repositoryName: starterName }
      }, opts)
    ]);

    // >! Prefer S3 sidecar metadata when available
    if (s3Result) {
      DebugAndLog.debug(`Using S3 sidecar metadata for starter: ${starterName}`);

      // Enhance S3 metadata with GitHub stats if available
      let githubStats = null;
      if (githubResult) {
        githubStats = {
          stars: githubResult.stargazersCount || 0,
          forks: githubResult.forksCount || 0,
          watchers: githubResult.watchersCount || 0,
          openIssues: githubResult.openIssuesCount || 0,
          lastUpdated: githubResult.updatedAt,
          createdAt: githubResult.createdAt,
          pushedAt: githubResult.pushedAt,
          isPrivate: githubResult.private || false
        };
      }

      const returnObject = {
        name: s3Result.name,
        description: s3Result.description,
        language: s3Result.language,
        framework: s3Result.framework,
        features: s3Result.features || [],
        prerequisites: s3Result.prerequisites || [],
        author: s3Result.author,
        license: s3Result.license,
        namespace: s3Result.namespace,
        bucket: s3Result.bucket,
        githubUrl: s3Result.githubUrl || (githubResult ? githubResult.url : ''),
        cloneUrl: githubResult ? githubResult.cloneUrl : '',
        sshUrl: githubResult ? githubResult.sshUrl : '',
        defaultBranch: githubResult ? githubResult.defaultBranch : 'main',
        repositoryType: s3Result.repositoryType || 'app-starter',
        userOrg: githubResult ? githubResult.userOrg : '',
        // S3 package information
        hasS3Package: true,
        hasSidecarMetadata: true,
        s3ZipPath: s3Result.s3ZipPath,
        s3MetadataPath: s3Result.s3MetadataPath,
        zipSize: s3Result.zipSize,
        lastModified: s3Result.lastModified,
        // Integration flags from sidecar metadata
        hasCacheDataIntegration: s3Result.cacheDataIntegration || false,
        hasCloudFrontIntegration: s3Result.cloudFrontIntegration || false,
        // GitHub stats (if available)
        stats: githubStats,
        // Example code snippets from sidecar metadata
        examples: s3Result.examples || [],
        // Private repository indicator
        isPrivate: githubStats ? githubStats.isPrivate : false,
        source: 's3'
      };

      // >! We need to wrap the list in a response format suitable for CacheableDataAccess
      // if ("errors" in list) {
      return ApiRequest.success({body: returnObject});
    }

    // >! Skip starters without sidecar metadata and log warning
    if (githubResult && !s3Result) {
      DebugAndLog.warn(`Starter ${starterName} found on GitHub but has no S3 sidecar metadata, skipping`);

      // Return null to trigger STARTER_NOT_FOUND error
      return ApiRequest.error({statusCode: 404, body: null});
    }

    // Starter not found in any source
    return ApiRequest.error({statusCode: 404, body: null});
  };

  // >! Use cache-data pass-through caching
  const cacheObj = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}, // options: for functions, tokens, non-cache data
  );

  const starter = cacheObj.getBody(true);

  if (!starter) {
    // >! Get list of available starters to help user discover what exists
    let availableStarters = [];
    try {
      const listResult = await list({ ghusers });
      availableStarters = listResult.starters.map(s => s.name);
    } catch (listError) {
      DebugAndLog.warn('Failed to get available starters for error message', {
        error: listError.message
      });
    }

    // >! Build helpful error message with available starters
    let errorMessage = `Starter not found: ${starterName}`;

    if (availableStarters.length > 0) {
      errorMessage += `\n\nAvailable starters:\n- ${availableStarters.join('\n- ')}`;
    }

    const error = new Error(errorMessage);
    error.code = 'STARTER_NOT_FOUND';
    error.availableStarters = availableStarters;
    throw error;
  }

  return starter;
}

module.exports = {
  list,
  get
};
