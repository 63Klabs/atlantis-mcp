/**
 * Starters Service
 *
 * Provides business logic for app starter operations with caching.
 * Implements pass-through caching using cache-data package for:
 * - Starter listing with filtering by S3 buckets and namespace
 * - Starter retrieval with metadata
 *
 * Sources starters exclusively from S3 buckets using the s3-app-starters
 * connection, following the same CacheableDataAccess/ApiRequest pattern
 * as the templates service.
 *
 * @module services/starters
 */

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { tools: { DebugAndLog, ApiRequest } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const Models = require('../models');

/**
 * List app starters with cache-data pass-through caching
 *
 * Sources starters exclusively from S3 buckets using the s3-app-starters connection.
 *
 * @param {Object} options - Filter options
 * @param {Array<string>} [options.s3Buckets] - Filter to specific S3 buckets (optional, validated against settings)
 * @param {string} [options.namespace] - Filter to a specific namespace S3 root prefix (optional)
 * @returns {Promise<Object>} { starters: Array, errors: Array, partialData: boolean }
 *
 * @example
 * // List all starters
 * const result = await Starters.list({});
 *
 * @example
 * // List starters from specific S3 buckets
 * const result = await Starters.list({ s3Buckets: ['63klabs'] });
 *
 * @example
 * // List starters filtered by namespace
 * const result = await Starters.list({ namespace: 'my-namespace' });
 */
async function list(options = {}) {
  const logName = "service.starters.list";
  const { s3Buckets, namespace } = options;

  // >! Get connection and cache profile from config
  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-app-starters', 'starters-list');

  if (!conn || !cacheProfile) {
    const errorMsg = `${logName}: Failed to get connection and/or cache profile for s3-app-starters/starters-list`;
    DebugAndLog.error(errorMsg);
    throw new Error(errorMsg);
  }

  // >! Determine which buckets to search (filtered or all)
  let bucketsToSearch = s3Buckets;

  if (!bucketsToSearch || bucketsToSearch.length === 0) {
    bucketsToSearch = Config.settings().s3.buckets;
  } else {
    // >! Validate that requested buckets are in configured buckets
    const validBuckets = Config.settings().s3.buckets;

    bucketsToSearch = bucketsToSearch.filter(b => validBuckets.includes(b));

    if (bucketsToSearch.length === 0) {
      const errorMsg = `${logName}: No valid S3 buckets specified`;
      DebugAndLog.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  // >! Set host to array of buckets (used in cache key)
  conn.host = bucketsToSearch;

  // >! Set parameters for cache key and DAO filtering
  conn.parameters = { namespace };

  // >! Define fetch function for cache miss
  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug(`${logName}.fetchFunction: Fetching starters from S3 (cache miss)`, {
      buckets: connection.host,
      namespace: connection.parameters?.namespace
    });

    const list = await Models.S3Starters.list(connection, opts);
    DebugAndLog.debug(`${logName}.fetchFunction: Fetched starters from S3`, {
      count: list.starters?.length || 0
    });

    // >! We need to wrap the list in a response format suitable for CacheableDataAccess
    if (list?.errors) {
      DebugAndLog.warn(`${logName}.fetchFunction: Starters list contains errors`, { errors: list.errors });
      return ApiRequest.error({body: list});
    } else {
      return ApiRequest.success({body: list});
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
 * Get specific app starter with cache-data pass-through caching
 *
 * Sources starter details exclusively from S3 buckets using the s3-app-starters connection.
 *
 * @param {Object} options - Starter identification
 * @param {string} options.starterName - Starter name (required)
 * @param {Array<string>} [options.s3Buckets] - Filter to specific S3 buckets (optional, validated against settings)
 * @param {string} [options.namespace] - Filter to a specific namespace S3 root prefix (optional)
 * @returns {Promise<Object>} Starter details
 * @throws {Error} STARTER_NOT_FOUND if starter not found
 *
 * @example
 * // Get starter by name
 * const starter = await Starters.get({ starterName: 'atlantis-starter-02' });
 *
 * @example
 * // Get starter from specific S3 buckets
 * const starter = await Starters.get({
 *   starterName: 'atlantis-starter-02',
 *   s3Buckets: ['63klabs']
 * });
 */
async function get(options = {}) {
  const logName = "service.starters.get";
  const { starterName, s3Buckets, namespace } = options;

  if (!starterName) {
    const errorMsg = `${logName}: starterName is required`;
    DebugAndLog.error(errorMsg);
    throw new Error(errorMsg);
  }

  // >! Get connection and cache profile from config
  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-app-starters', 'starter-detail');

  if (!conn || !cacheProfile) {
    const errorMsg = `${logName}: Failed to get connection and/or cache profile for s3-app-starters/starter-detail`;
    DebugAndLog.error(errorMsg);
    throw new Error(errorMsg);
  }

  // >! Determine which buckets to search
  let bucketsToSearch = s3Buckets;
  if (!bucketsToSearch || bucketsToSearch.length === 0) {
    bucketsToSearch = Config.settings().s3.buckets;
  } else {
    const validBuckets = Config.settings().s3.buckets;
    bucketsToSearch = bucketsToSearch.filter(b => validBuckets.includes(b));
  }

  // >! Set host to array of buckets (used in cache key)
  conn.host = bucketsToSearch;

  // >! Update pathId for logging with specific starter
  cacheProfile.pathId = `${cacheProfile.pathId}:${starterName}`;

  // >! Set parameters for cache key and DAO query
  conn.parameters = { starterName, namespace };

  // >! Define fetch function for cache miss
  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug(`${logName}.fetchFunction: Fetching starter from S3 (cache miss)`, {
      starterName: connection.parameters?.starterName,
      namespace: connection.parameters?.namespace
    });

    const starter = await Models.S3Starters.get(connection, opts);
    if (!starter) {
      const p = connection.parameters || {};

      // >! Get list of available starters to help user discover what exists
      let availableStarters = [];
      try {
        const listResult = await list({ s3Buckets });
        availableStarters = listResult.starters.map(s => s.name);
      } catch (listError) {
        DebugAndLog.warn(`${logName}.fetchFunction: Failed to get available starters`, {
          error: listError.message
        });
      }

      // >! Build helpful error message with available starters
      let errorMessage = `Starter not found: ${p.starterName}`;

      if (availableStarters.length > 0) {
        errorMessage += `\n\nAvailable starters:\n- ${availableStarters.join('\n- ')}`;
      }

      const error = new Error(errorMessage);
      error.code = 'STARTER_NOT_FOUND';
      error.availableStarters = availableStarters;
      throw error;
    }

    // >! We need to wrap the result in a response format suitable for CacheableDataAccess
    if ("errors" in starter) {
      DebugAndLog.warn(`${logName}.fetchFunction: Starter data contains errors`, { errors: starter.errors });
      return ApiRequest.error({body: starter});
    } else {
      return ApiRequest.success({body: starter});
    }

  };

  // >! Use cache-data pass-through caching
  const cacheObj = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {},
  );

  return cacheObj.getBody(true);
}

module.exports = {
  list,
  get
};
