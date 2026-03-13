/**
 * Templates Service
 *
 * Provides business logic for CloudFormation template operations with caching.
 * Implements pass-through caching using cache-data package for:
 * - Template listing with filtering
 * - Template retrieval with versioning
 * - Template version history
 * - Template category discovery
 * - Template update checking
 *
 * @module services/templates
 */

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { tools: { DebugAndLog, ApiRequest } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const Models = require('../models');

/**
 * List templates with cache-data pass-through caching
 *
 * @param {Object} options - Filter options
 * @param {string} [options.category] - Template category (optional)
 * @param {string} [options.version] - Template version (Human_Readable_Version, optional)
 * @param {string} [options.versionId] - S3 object Version Id (optional)
 * @param {Array<string>} [options.s3Buckets] - Filter to specific buckets (optional, validated against settings)
 * @returns {Promise<Object>} { templates: Array, errors: Array, partialData: boolean }
 *
 * @example
 * // List all templates
 * const result = await Templates.list({});
 *
 * @example
 * // List templates by category
 * const result = await Templates.list({ category: 'Storage' });
 *
 * @example
 * // List templates from specific buckets
 * const result = await Templates.list({ s3Buckets: ['bucket1', 'bucket2'] });
 */
async function list(options = {}) {
  const { category, version, versionId, s3Buckets } = options;

  // >! Get connection and cache profile from config
  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-templates', 'templates-list');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for s3-templates/templates-list');
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
      throw new Error('No valid S3 buckets specified');
    }
  }

  // >! Set host to array of buckets (used in cache key)
  conn.host = bucketsToSearch;

  // >! Set parameters for cache key and DAO filtering
  conn.parameters = { category, version, versionId };

  // >! Define fetch function for cache miss
  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug('Fetching templates from S3 (cache miss)', {
      buckets: connection.host,
      category,
      version,
      versionId
    });
    const list = await Models.S3Templates.list(connection, opts);
    DebugAndLog.debug('Fetched templates from S3', list);
    const response = ApiRequest.responseFormat({
			success: true,
			statusCode: 200,
			body: list,
			message: "SUCCESS"
    });
    return response;
  };

  // >! Use cache-data pass-through caching
  const result = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}, // options: for functions, tokens, non-cache data
  );

  return result.body;
}

/**
 * Get specific template with cache-data pass-through caching
 *
 * @param {Object} options - Template identification
 * @param {string} options.category - Template category
 * @param {string} options.templateName - Template name
 * @param {string} [options.version] - Template version (Human_Readable_Version, optional)
 * @param {string} [options.versionId] - S3 object Version Id (optional)
 * @param {Array<string>} [options.s3Buckets] - Filter to specific buckets (optional)
 * @returns {Promise<Object>} Template details
 * @throws {Error} TEMPLATE_NOT_FOUND if template not found
 *
 * @example
 * // Get latest version of template
 * const template = await Templates.get({
 *   category: 'Storage',
 *   templateName: 'template-storage-s3-artifacts'
 * });
 *
 * @example
 * // Get specific version by Human_Readable_Version
 * const template = await Templates.get({
 *   category: 'Storage',
 *   templateName: 'template-storage-s3-artifacts',
 *   version: 'v1.3.5/2024-01-15'
 * });
 *
 * @example
 * // Get specific version by S3_VersionId
 * const template = await Templates.get({
 *   category: 'Storage',
 *   templateName: 'template-storage-s3-artifacts',
 *   versionId: 'abc123def456'
 * });
 */
async function get(options = {}) {
  const { category, templateName, version, versionId, s3Buckets } = options;

  if (!category || !templateName) {
    throw new Error('category and templateName are required');
  }

  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-templates', 'template-detail');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for s3-templates/template-detail');
  }

  // >! Determine which buckets to search
  let bucketsToSearch = s3Buckets;
  if (!bucketsToSearch || bucketsToSearch.length === 0) {
    bucketsToSearch = Config.settings().s3.buckets;
  } else {
    const validBuckets = Config.settings().s3.buckets;
    bucketsToSearch = bucketsToSearch.filter(b => validBuckets.includes(b));
  }

  conn.host = bucketsToSearch;

  // >! Update pathId for logging with specific template
  cacheProfile.pathId = `${cacheProfile.pathId}:${category}/${templateName}`;

  // >! Set parameters for cache key and DAO query
  conn.parameters = { category, templateName, version, versionId };

  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug('Fetching template from S3 (cache miss)', {
      category,
      templateName,
      version,
      versionId
    });

    const template = await Models.S3Templates.get(connection, opts);
    if (!template) {
      const p = connection.parameters || {};

      // >! Get list of available templates to help user discover what exists
      let availableTemplates = [];
      try {
        const listResult = await list({ category: p.category, s3Buckets });
        availableTemplates = listResult.templates.map(t => t.templateName);
      } catch (listError) {
        DebugAndLog.warn('Failed to get available templates for error message', {
          error: listError.message
        });
      }

      // >! Build helpful error message with available templates
      let errorMessage = `Template not found: ${p.category}/${p.templateName}${p.version ? `:${p.version}` : ''}${p.versionId ? `?versionId=${p.versionId}` : ''}`;

      if (availableTemplates.length > 0) {
        errorMessage += `\n\nAvailable templates in category '${p.category}':\n- ${availableTemplates.join('\n- ')}`;
      }

      const error = new Error(errorMessage);
      error.code = 'TEMPLATE_NOT_FOUND';
      error.availableTemplates = availableTemplates;
      throw error;
    }
    return template;
  };

  const result = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {},
  );

  return result.body;
}

/**
 * List all versions of a specific template
 *
 * @param {Object} options - Template identification
 * @param {string} options.category - Template category
 * @param {string} options.templateName - Template name
 * @param {Array<string>} [options.s3Buckets] - Filter to specific buckets (optional)
 * @returns {Promise<Object>} Template version history with versions array
 *
 * @example
 * const versions = await Templates.listVersions({
 *   category: 'Storage',
 *   templateName: 'template-storage-s3-artifacts'
 * });
 * // Returns: { templateName, category, namespace, bucket, versions: [...] }
 */
async function listVersions(options = {}) {
  const { category, templateName, s3Buckets } = options;

  if (!category || !templateName) {
    throw new Error('category and templateName are required');
  }

  const { conn, cacheProfile } = Config.getConnCacheProfile('s3-templates', 'template-versions');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for s3-templates/template-versions');
  }

  // >! Determine which buckets to search
  let bucketsToSearch = s3Buckets;
  if (!bucketsToSearch || bucketsToSearch.length === 0) {
    bucketsToSearch = Config.settings().s3.buckets;
  } else {
    const validBuckets = Config.settings().s3.buckets;
    bucketsToSearch = bucketsToSearch.filter(b => validBuckets.includes(b));
  }

  conn.host = bucketsToSearch;
  conn.parameters = { category, templateName };

  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug('Fetching template versions from S3 (cache miss)', {
      category,
      templateName
    });
    return await Models.S3Templates.listVersions(connection, opts);
  };

  const result = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {},
  );

  return result.body;
}

/**
 * List all available template categories
 *
 * @returns {Promise<Array<Object>>} Array of category objects with name, description, and template count
 *
 * @example
 * const categories = await Templates.listCategories();
 * // Returns: [
 * //   { name: 'Storage', description: '...', templateCount: 5 },
 * //   { name: 'Network', description: '...', templateCount: 3 },
 * //   ...
 * // ]
 */
async function listCategories() {
  // >! Use settings.templates.categories for category list
  const categories = Config.settings().templates.categories;

  // Get template counts for each category
  // This is a lightweight operation that uses cached template lists
  const categoriesWithCounts = await Promise.all(
    categories.map(async (category) => {
      try {
        // Get templates for this category (will use cache if available)
        const result = await list({ category: category.name });

        return {
          name: category.name,
          description: category.description,
          templateCount: result.templates ? result.templates.length : 0
        };
      } catch (error) {
        DebugAndLog.warn(`Failed to get template count for category ${category.name}`, {
          error: error.message
        });

        return {
          name: category.name,
          description: category.description,
          templateCount: 0
        };
      }
    })
  );

  return categoriesWithCounts;
}

/**
 * Check for template updates
 *
 * Compares current version with latest version from S3 and returns update information.
 * Supports checking multiple templates in a single request.
 *
 * @param {Object} options - Update check options
 * @param {Array<{category: string, templateName: string, currentVersion: string}>} options.templates - Templates to check
 * @param {Array<string>} [options.s3Buckets] - Filter to specific buckets (optional)
 * @returns {Promise<Array<Object>>} Array of update information objects
 *
 * @example
 * const updates = await Templates.checkUpdates({
 *   templates: [
 *     { category: 'Storage', templateName: 'template-storage-s3-artifacts', currentVersion: 'v1.3.4/2024-01-10' },
 *     { category: 'Pipeline', templateName: 'template-pipeline', currentVersion: 'v2.0.18/2024-01-05' }
 *   ]
 * });
 * // Returns: [
 * //   {
 * //     category: 'Storage',
 * //     templateName: 'template-storage-s3-artifacts',
 * //     currentVersion: 'v1.3.4/2024-01-10',
 * //     latestVersion: 'v1.3.5/2024-01-15',
 * //     updateAvailable: true,
 * //     releaseDate: '2024-01-15',
 * //     changelog: '...',
 * //     breakingChanges: false,
 * //     migrationGuide: null
 * //   },
 * //   ...
 * // ]
 */
async function checkUpdates(options = {}) {
  const { templates, s3Buckets } = options;

  if (!templates || !Array.isArray(templates) || templates.length === 0) {
    throw new Error('templates array is required');
  }

  // >! Support checking multiple templates in single request
  const updateResults = await Promise.all(
    templates.map(async (templateInfo) => {
      const { category, templateName, currentVersion } = templateInfo;

      if (!category || !templateName || !currentVersion) {
        return {
          category,
          templateName,
          currentVersion,
          error: 'category, templateName, and currentVersion are required'
        };
      }

      try {
        // Get latest version of template
        const latestTemplate = await get({
          category,
          templateName,
          s3Buckets
        });

        const latestVersion = latestTemplate.version;

        // >! Compare current version with latest version from S3
        const updateAvailable = currentVersion !== latestVersion;

        // Parse version information
        const versionInfo = parseVersionInfo(latestVersion);

        // >! Indicate breaking changes and migration guide links
        // Check if major version changed (breaking change indicator)
        const currentMajor = extractMajorVersion(currentVersion);
        const latestMajor = extractMajorVersion(latestVersion);
        const breakingChanges = currentMajor !== latestMajor && latestMajor > currentMajor;

        // Build migration guide link if breaking changes
        let migrationGuide = null;
        if (breakingChanges) {
          // Migration guide follows pattern: docs/templates/v2/{category}/{templateName}-README.md#migration
          migrationGuide = `docs/templates/v2/${category.toLowerCase()}/${templateName}-README.md#migration-from-v${currentMajor}x-to-v${latestMajor}x`;
        }

        return {
          category,
          templateName,
          currentVersion,
          latestVersion,
          updateAvailable,
          releaseDate: versionInfo.date,
          changelog: latestTemplate.description || 'No changelog available',
          breakingChanges,
          migrationGuide,
          s3Path: latestTemplate.s3Path,
          namespace: latestTemplate.namespace,
          bucket: latestTemplate.bucket
        };
      } catch (error) {
        DebugAndLog.warn(`Failed to check updates for ${category}/${templateName}`, {
          error: error.message
        });

        return {
          category,
          templateName,
          currentVersion,
          error: error.message,
          updateAvailable: false
        };
      }
    })
  );

  return updateResults;
}

/**
 * Parse version information from Human_Readable_Version
 * Format: vX.X.X/YYYY-MM-DD
 *
 * @private
 * @param {string} version - Version string
 * @returns {{version: string, date: string, major: number, minor: number, patch: number}}
 */
function parseVersionInfo(version) {
  if (!version) {
    return {
      version: null,
      date: null,
      major: 0,
      minor: 0,
      patch: 0
    };
  }

  const parts = version.split('/');
  const versionPart = parts[0] || '';
  const datePart = parts[1] || '';

  // Extract version numbers (vX.X.X)
  const versionMatch = versionPart.match(/v(\d+)\.(\d+)\.(\d+)/);
  const major = versionMatch ? parseInt(versionMatch[1], 10) : 0;
  const minor = versionMatch ? parseInt(versionMatch[2], 10) : 0;
  const patch = versionMatch ? parseInt(versionMatch[3], 10) : 0;

  return {
    version: versionPart,
    date: datePart,
    major,
    minor,
    patch
  };
}

/**
 * Extract major version number from version string
 *
 * @private
 * @param {string} version - Version string (vX.X.X/YYYY-MM-DD)
 * @returns {number} Major version number
 */
function extractMajorVersion(version) {
  if (!version) {
    return 0;
  }

  const match = version.match(/v(\d+)\./);
  return match ? parseInt(match[1], 10) : 0;
}

module.exports = {
  list,
  get,
  listVersions,
  listCategories,
  checkUpdates
};
