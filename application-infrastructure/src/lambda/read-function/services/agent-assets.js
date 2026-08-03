/**
 * Agent Assets Service
 *
 * Provides business logic for agent-asset (steering documents, hooks,
 * AGENTS.md files, and future registry-driven types) operations with
 * caching. Mirrors services/templates.js: pass-through caching via
 * `CacheableDataAccess` for:
 * - Asset listing across one or all enabled types
 * - Asset retrieval with content-identity metadata (size, etag, sha256)
 * - Enabled-type discovery with per-type asset counts
 *
 * Unlike the templates/starters services, an invalid `s3Buckets` filter is
 * REJECTED rather than silently filtered: every requested bucket must
 * already be configured, or the request throws before any S3 read
 * (Requirement 4.6). Similarly, `assetType` is re-validated against the
 * enabled-type registry before any S3 read (Requirements 5.5, 7.8).
 *
 * @module services/agent-assets
 */

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { tools: { DebugAndLog, ApiRequest } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const Models = require('../models');
const AgentAssetTypes = require('../config/agent-asset-types');
const ContentChunker = require('../utils/content-chunker');

/**
 * Explicit all-types marker used as the `assetType` cache-key component of
 * `list()` when the caller omits `assetType`, so a single-type list and an
 * all-types list are cached under distinct keys (Requirement 8.2).
 * @constant {string}
 */
const ALL_TYPES_MARKER = '*all*';

/**
 * Resolve which S3 buckets to search, applying STRICT validation of a
 * caller-supplied `s3Buckets` filter.
 *
 * Unlike `services/templates.js` and `services/starters.js` (which silently
 * drop any unconfigured bucket from the filter), this throws when the filter
 * names ANY bucket that is not in `Config.settings().s3.buckets`, and
 * performs no S3 read (Requirement 4.6).
 *
 * @private
 * @param {Array<string>} [s3Buckets] - Caller-supplied bucket filter (optional)
 * @param {string} logName - Caller's log name, used to prefix error/log messages
 * @returns {Array<string>} Buckets to search, in configured priority order
 * @throws {Error} With `code = 'INVALID_INPUT'` and `invalidBuckets` naming
 *   every requested bucket that is not configured
 */
function resolveBucketsStrict(s3Buckets, logName) {
  const configuredBuckets = Config.settings().s3.buckets;

  if (!s3Buckets || s3Buckets.length === 0) {
    return configuredBuckets;
  }

  // >! Reject the request when ANY requested bucket is not configured,
  // >! rather than silently filtering it out, and perform no S3 read
  const invalidBuckets = s3Buckets.filter((bucket) => !configuredBuckets.includes(bucket));

  if (invalidBuckets.length > 0) {
    const errorMsg = `${logName}: Invalid s3Buckets filter - bucket(s) not in configured list: ${invalidBuckets.join(', ')}`;
    DebugAndLog.error(errorMsg);
    const error = new Error(errorMsg);
    error.code = 'INVALID_INPUT';
    error.invalidBuckets = invalidBuckets;
    throw error;
  }

  return s3Buckets;
}

/**
 * Resolve an `assetType` value to its registry entry, re-validating that it
 * names a currently ENABLED type before any S3 read.
 *
 * This is defense-in-depth beyond the controller/schema `enum` check: an
 * unknown `assetType`, or one that names a disabled entry (e.g. `skills`),
 * throws rather than resolving (Requirements 5.5, 7.8).
 *
 * @private
 * @param {string} assetType - The `assetType` value supplied by a caller
 * @param {string} logName - Caller's log name, used to prefix error/log messages
 * @returns {import('../config/agent-asset-types').AgentAssetType} The resolved, enabled registry entry
 * @throws {Error} With `code = 'INVALID_INPUT'` and `validAssetTypes` naming
 *   the currently enabled `assetType` values
 */
function resolveTypeStrict(assetType, logName) {
  const resolved = AgentAssetTypes.resolveEnabledType(assetType);

  if (!resolved) {
    const validAssetTypes = AgentAssetTypes.getEnabledTypeNames();
    const errorMsg = `${logName}: Invalid assetType "${assetType}". Valid values: ${validAssetTypes.join(', ')}`;
    DebugAndLog.error(errorMsg);
    const error = new Error(errorMsg);
    error.code = 'INVALID_INPUT';
    error.validAssetTypes = validAssetTypes;
    throw error;
  }

  return resolved;
}

/**
 * List agent assets with cache-data pass-through caching.
 *
 * When `assetType` is supplied, it is validated against the enabled-type
 * registry (throwing `INVALID_INPUT` for an unknown/disabled value) and the
 * search is restricted to that single type. When `assetType` is omitted, the
 * search spans every enabled type, in registry order. Either way, the
 * resolved type object(s) are passed to the DAO via
 * `conn.parameters.assetTypes`, while `conn.parameters.assetType` carries the
 * requested type name (or the all-types marker) purely so that a
 * single-type list and an all-types list cache under distinct keys
 * (Requirement 8.2).
 *
 * @param {Object} [options={}] - Filter options
 * @param {string} [options.assetType] - Agent asset type to search (optional; omit for all enabled types)
 * @param {Array<string>} [options.s3Buckets] - Filter to specific buckets (optional; every entry must already be configured)
 * @param {string} [options.namespace] - Filter to a specific namespace S3 root prefix (optional)
 * @returns {Promise<Object>} `{ assets: Array, errors: Array, partialData: boolean }`
 * @throws {Error} With `code = 'INVALID_INPUT'` when `assetType` is unknown/disabled or `s3Buckets` names an unconfigured bucket
 *
 * @example
 * // List assets across all enabled types
 * const result = await AgentAssets.list({});
 *
 * @example
 * // List assets of a single type
 * const result = await AgentAssets.list({ assetType: 'steering' });
 *
 * @example
 * // List assets from specific buckets (every bucket must already be configured)
 * const result = await AgentAssets.list({ s3Buckets: ['63klabs'] });
 */
async function list(options = {}) {
  const logName = 'service.agent-assets.list';
  const { assetType, s3Buckets, namespace } = options;

  // >! Get connection and cache profile from config
  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-agent-assets', 'assets-list');

  if (!conn || !cacheProfile) {
    const errorMsg = `${logName}: Failed to get connection and/or cache profile for s3-agent-assets/assets-list`;
    DebugAndLog.error(errorMsg);
    throw new Error(errorMsg);
  }

  // >! Resolve the search set: a supplied assetType is validated and yields a
  // >! single-entry set; an omitted assetType yields all enabled types, in
  // >! registry order (Requirement 1.1). Validation happens before any S3 read.
  const assetTypes = assetType
    ? [resolveTypeStrict(assetType, logName)]
    : AgentAssetTypes.getEnabledTypes();

  // >! Strict bucket validation: reject any unconfigured bucket named in the
  // >! filter before any S3 read (Requirement 4.6)
  const bucketsToSearch = resolveBucketsStrict(s3Buckets, logName);

  // >! Set host to array of buckets (used in cache key)
  conn.host = bucketsToSearch;

  // >! Cache-key parameters: `assetType` is the requested type name (or the
  // >! all-types marker when omitted) so a single-type list and an all-types
  // >! list cache under distinct keys; `assetTypes` carries the resolved
  // >! registry entry object(s) that the DAO actually consumes
  conn.parameters = {
    assetType: assetType || ALL_TYPES_MARKER,
    assetTypes,
    namespace
  };

  // >! Define fetch function for cache miss
  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug(`${logName}.fetchFunction: Fetching agent assets from S3 (cache miss)`, {
      buckets: connection.host,
      assetType: connection.parameters?.assetType,
      namespace: connection.parameters?.namespace
    });

    const result = await Models.S3AgentAssets.list(connection, opts);
    DebugAndLog.debug(`${logName}.fetchFunction: Fetched agent assets from S3`, {
      count: result.assets?.length || 0
    });

    // >! Wrap the result in a response format suitable for CacheableDataAccess
    if (result?.errors) {
      DebugAndLog.warn(`${logName}.fetchFunction: Asset list contains errors`, { errors: result.errors });
      return ApiRequest.error({ body: result });
    } else {
      return ApiRequest.success({ body: result });
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
 * Get one agent asset's full content with cache-data pass-through caching.
 *
 * `assetType` is required and is re-validated against the enabled-type
 * registry before any S3 read (throwing `INVALID_INPUT` for an
 * unknown/disabled value, Requirements 5.5, 7.8). The resolved registry
 * entry object (not just its name) is passed to the DAO via
 * `conn.parameters.assetType`, since `models/s3-agent-assets.js`'s `get()`
 * reads `.folder` and `.name` directly off that value.
 *
 * @param {Object} options - Asset identification
 * @param {string} options.assetType - Agent asset type to retrieve from (required)
 * @param {string} options.name - Asset filename, no path separators (required)
 * @param {Array<string>} [options.s3Buckets] - Filter to specific buckets (optional; every entry must already be configured)
 * @param {string} [options.namespace] - Filter to a specific namespace S3 root prefix (optional)
 * @returns {Promise<Object>} Asset detail object
 * @throws {Error} With `code = 'INVALID_INPUT'` when `assetType`/`name` are missing, `assetType` is unknown/disabled, or `s3Buckets` names an unconfigured bucket
 * @throws {Error} With `code = 'ASSET_NOT_FOUND'` and `availableAssets` when the asset does not exist for that type in any successfully read source
 *
 * @example
 * // Get an asset by type and name
 * const asset = await AgentAssets.get({ assetType: 'steering', name: 'product-guidelines.md' });
 *
 * @example
 * // Get an asset from specific buckets
 * const asset = await AgentAssets.get({
 *   assetType: 'hooks',
 *   name: 'on-save.kiro.hook',
 *   s3Buckets: ['63klabs']
 * });
 */
async function get(options = {}) {
  const logName = 'service.agent-assets.get';
  const { assetType, name, s3Buckets, namespace } = options;

  if (!assetType || !name) {
    const errorMsg = `${logName}: assetType and name are required`;
    DebugAndLog.error(errorMsg);
    throw new Error(errorMsg);
  }

  // >! Re-validate assetType against the enabled-type registry before any S3
  // >! read (defense in depth beyond the controller/schema check)
  const resolvedType = resolveTypeStrict(assetType, logName);

  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-agent-assets', 'asset-detail');

  if (!conn || !cacheProfile) {
    const errorMsg = `${logName}: Failed to get connection and/or cache profile for s3-agent-assets/asset-detail`;
    DebugAndLog.error(errorMsg);
    throw new Error(errorMsg);
  }

  // >! Strict bucket validation: reject any unconfigured bucket named in the
  // >! filter before any S3 read (Requirement 4.6)
  const bucketsToSearch = resolveBucketsStrict(s3Buckets, logName);

  conn.host = bucketsToSearch;

  // >! Update pathId for logging with the specific asset identity
  cacheProfile.pathId = `${cacheProfile.pathId}:${assetType}/${name}`;

  // >! The DAO's get() reads connection.parameters.assetType.folder/.name, so
  // >! the RESOLVED registry entry object is passed here, not the raw string
  conn.parameters = { assetType: resolvedType, name, namespace };

  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug(`${logName}.fetchFunction: Fetching agent asset from S3 (cache miss)`, {
      assetType: connection.parameters?.assetType?.name,
      name: connection.parameters?.name,
      namespace: connection.parameters?.namespace
    });

    const asset = await Models.S3AgentAssets.get(connection, opts);
    if (!asset) {
      // >! Build the list of available asset names for this type to help
      // >! discovery; fall back gracefully to an empty array on listing failure
      let availableAssets = [];
      try {
        const listResult = await list({ assetType, s3Buckets, namespace });
        availableAssets = listResult.assets.map((a) => a.name);
      } catch (listError) {
        DebugAndLog.warn(`${logName}.fetchFunction: Failed to get available assets`, {
          error: listError.message
        });
      }

      // >! Build helpful error message with available assets
      let errorMessage = `Asset not found: ${assetType}/${name}`;

      if (availableAssets.length > 0) {
        errorMessage += `\n\nAvailable assets of type '${assetType}':\n- ${availableAssets.join('\n- ')}`;
      }

      const error = new Error(errorMessage);
      error.code = 'ASSET_NOT_FOUND';
      error.availableAssets = availableAssets;
      throw error;
    }

    // >! Wrap the result in a response format suitable for CacheableDataAccess
    if ('errors' in asset) {
      DebugAndLog.warn(`${logName}.fetchFunction: Asset data contains errors`, { errors: asset.errors });
      return ApiRequest.error({ body: asset });
    } else {
      return ApiRequest.success({ body: asset });
    }
  };

  const cacheObj = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {},
  );

  return cacheObj.getBody(true);
}

/**
 * List the enabled agent-asset types together with a count of the assets
 * discoverable for each type across the configured S3 buckets and indexed
 * namespaces.
 *
 * Counts are obtained by calling this module's own cache-backed `list()` for
 * each enabled type, mirroring `services/templates.js`'s `listCategories()`
 * count pattern, so repeated calls to `listTypes()` do not add extra S3 load
 * once the underlying per-type lists are cached.
 *
 * @returns {Promise<Array<Object>>} `[{ name, folder, description, assetCount }]` for each enabled type
 *
 * @example
 * const types = await AgentAssets.listTypes();
 * // Returns: [
 * //   { name: 'steering', folder: 'steering', description: '...', assetCount: 7 },
 * //   { name: 'hooks', folder: 'hooks', description: '...', assetCount: 3 },
 * //   { name: 'agents-md', folder: 'agents_md', description: '...', assetCount: 1 }
 * // ]
 */
async function listTypes() {
  const logName = 'service.agent-assets.listTypes';
  const enabledTypes = AgentAssetTypes.getEnabledTypes();

  const typesWithCounts = await Promise.all(
    enabledTypes.map(async (type) => {
      try {
        // >! Cache-backed: reuses the same list() cache entry as a direct
        // >! single-type list_agent_assets call
        const result = await list({ assetType: type.name });
        const assets = result.assets || [];

        return {
          name: type.name,
          folder: type.folder,
          description: type.description,
          assetCount: assets.length
        };
      } catch (error) {
        DebugAndLog.warn(`${logName}: Failed to get asset count for type ${type.name}`, {
          error: error.message
        });

        return {
          name: type.name,
          folder: type.folder,
          description: type.description,
          assetCount: 0
        };
      }
    })
  );

  return typesWithCounts;
}

/**
 * Get a single chunk of a large agent asset's content, with cache-data
 * pass-through caching, mirroring `Templates.getChunk` in
 * `controllers/templates.js`.
 *
 * DESIGN NOTE — service/controller split vs the `Templates.getChunk`
 * precedent: for templates, ALL of the chunk logic (cache-profile lookup,
 * `conn` setup, the `fetchFunction` that re-fetches the full template and
 * chunks it, and the `CacheableDataAccess.getData` call) lives inline in the
 * CONTROLLER — there is no `Services.Templates.getChunk`. That precedent
 * pre-dates this codebase's now-established MVC convention, where services
 * own caching/data-orchestration and controllers own validation/response
 * formatting (see every other agent-asset and template operation:
 * `list`/`get`/`listTypes` each have a thin controller delegating to a
 * service that owns the cache profile and fetch function). This function
 * deliberately relocates that orchestration to the SERVICE layer so
 * `Controllers.AgentAssets.getChunk` can be a thin wrapper, consistent with
 * `Controllers.AgentAssets.get` calling `Services.AgentAssets.get`, rather
 * than literally copying the templates controller's inline layering.
 *
 * The cache-miss `fetchFunction` reuses THIS module's own cache-backed
 * `get()` to fetch the full asset (mirroring how the templates controller's
 * chunk fetch function calls `Services.Templates.get(...)`), so `get()`'s
 * `ASSET_NOT_FOUND`/`INVALID_INPUT` errors propagate unchanged rather than
 * being re-implemented here; the controller maps them to MCP error
 * responses exactly as it already does for `get`.
 *
 * @param {Object} options - Chunk identification
 * @param {string} options.assetType - Agent asset type to retrieve from (required)
 * @param {string} options.name - Asset filename, no path separators (required)
 * @param {number} options.chunkIndex - Zero-based index of the chunk to retrieve (required)
 * @param {Array<string>} [options.s3Buckets] - Filter to specific buckets (optional; every entry must already be configured)
 * @param {string} [options.namespace] - Filter to a specific namespace S3 root prefix (optional)
 * @returns {Promise<Object>} `{ chunkIndex, totalChunks, assetType, name, content }` on success, or
 *   `{ code: 'INVALID_CHUNK_INDEX', message, validRange }` when `chunkIndex` is out of range
 * @throws {Error} With `code = 'INVALID_INPUT'` when `assetType`/`name` are missing, `assetType` is unknown/disabled, or `s3Buckets` names an unconfigured bucket (propagated from `get()`)
 * @throws {Error} With `code = 'ASSET_NOT_FOUND'` and `availableAssets` when the asset does not exist for that type in any successfully read source (propagated from `get()`)
 *
 * @example
 * // Get chunk 0 of a large steering document
 * const chunk = await AgentAssets.getChunk({ assetType: 'steering', name: 'large-doc.md', chunkIndex: 0 });
 */
async function getChunk(options = {}) {
  const logName = 'service.agent-assets.getChunk';
  const { assetType, name, chunkIndex, s3Buckets, namespace } = options;

  const { conn, cacheProfile } = Config.getConnCacheProfile('agent-asset-chunks', 'chunk-data');

  if (!conn || !cacheProfile) {
    const errorMsg = `${logName}: Failed to get connection and/or cache profile for agent-asset-chunks/chunk-data`;
    DebugAndLog.error(errorMsg);
    throw new Error(errorMsg);
  }

  // >! Strict bucket validation: reject any unconfigured bucket named in the
  // >! filter before any S3 read (Requirement 4.6)
  const bucketsToSearch = resolveBucketsStrict(s3Buckets, logName);

  conn.host = bucketsToSearch;

  // >! Update pathId for logging with the specific asset identity + chunk
  // >! index, mirroring Templates.getChunk's pathId convention
  cacheProfile.pathId = `${cacheProfile.pathId}:${assetType}/${name}:${chunkIndex}`;

  // >! Cache-key parameters include chunkIndex so each chunk caches
  // >! distinctly (Requirement 9.2)
  conn.parameters = { assetType, name, chunkIndex, s3Buckets, namespace };

  const fetchFunction = async (connection, _opts) => {
    const {
      assetType: connAssetType, name: connName, chunkIndex: connChunkIndex,
      s3Buckets: connS3Buckets, namespace: connNamespace
    } = connection.parameters;

    // >! Reuse this module's own cache-backed get() to fetch the full asset.
    // >! ASSET_NOT_FOUND / INVALID_INPUT propagate unchanged - the controller
    // >! catches and maps them, matching Templates.getChunk's pattern
    const asset = await get({
      assetType: connAssetType,
      name: connName,
      s3Buckets: connS3Buckets,
      namespace: connNamespace
    });

    // >! Serialize and chunk the full asset object
    const serialized = JSON.stringify(asset);
    const chunks = ContentChunker.chunk(serialized);

    // >! INVALID_CHUNK_INDEX: return as ApiRequest.error() so it IS cached,
    // >! matching Templates.getChunk's INVALID_CHUNK_INDEX shape verbatim
    if (connChunkIndex < 0 || connChunkIndex >= chunks.length) {
      return ApiRequest.error({
        body: {
          code: 'INVALID_CHUNK_INDEX',
          message: `chunkIndex ${connChunkIndex} is out of range. Valid range: 0-${chunks.length - 1}`,
          validRange: { min: 0, max: chunks.length - 1 }
        }
      });
    }

    // >! Return the specific chunk
    return ApiRequest.success({
      body: {
        chunkIndex: connChunkIndex,
        totalChunks: chunks.length,
        assetType: connAssetType,
        name: connName,
        content: chunks[connChunkIndex]
      }
    });
  };

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
  get,
  listTypes,
  getChunk
};
