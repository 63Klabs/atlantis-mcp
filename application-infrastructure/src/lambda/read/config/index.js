/**
 * Configuration initialization module for Atlantis MCP Server Read Lambda
 * 
 * This module handles async initialization of:
 * - Cache-data Cache.init() with DynamoDB and S3
 * - GitHub token retrieval from SSM Parameter Store
 * - DebugAndLog initialization with log level
 * - Documentation index building (async, non-blocking)
 * 
 * The Config.init() function should be called once during Lambda cold start
 * before processing any requests.
 * 
 * @module config
 */

const { Cache } = require('@63klabs/cache-data').cache;
const { DebugAndLog, AWS } = require('@63klabs/cache-data').tools;
const settings = require('./settings');
const { getConnCacheProfile } = require('./connections');

/**
 * Configuration state
 * @private
 */
let initialized = false;
let githubToken = null;
let initializationError = null;

/**
 * Initialize configuration for Lambda function
 * 
 * This function performs async initialization that should happen once
 * during Lambda cold start. It is idempotent - calling multiple times
 * will only initialize once.
 * 
 * Initialization steps:
 * 1. Initialize cache-data Cache with DynamoDB table and S3 bucket
 * 2. Load GitHub token from SSM Parameter Store
 * 3. Initialize DebugAndLog with log level from settings
 * 4. Build documentation index asynchronously (non-blocking)
 * 
 * @async
 * @returns {Promise<void>}
 * @throws {Error} If critical initialization fails (cache, SSM)
 * 
 * @example
 * // In Lambda handler
 * exports.handler = async (event, context) => {
 *   await Config.init();
 *   // Process request
 * };
 */
async function init() {
  // >! Idempotent initialization - only run once per Lambda instance
  if (initialized) {
    return;
  }

  // >! If previous initialization failed, throw the error again
  if (initializationError) {
    throw initializationError;
  }

  try {
    // Step 1: Initialize DebugAndLog with log level from settings
    // >! Initialize logging first so we can log subsequent initialization steps
    const logLevel = mapLogLevel(settings.logging.level);
    DebugAndLog.init({ logLevel });
    
    DebugAndLog.info('Initializing Atlantis MCP Server Read Lambda configuration');
    DebugAndLog.debug('Settings:', {
      s3Buckets: settings.s3.buckets,
      githubUserOrgs: settings.github.userOrgs,
      cacheTable: settings.cache.dynamoDbTable,
      cacheBucket: settings.cache.s3Bucket,
      logLevel: settings.logging.level
    });

    // Step 2: Initialize cache-data Cache with DynamoDB table and S3 bucket
    // >! Cache initialization is critical - Lambda cannot function without it
    if (!settings.cache.dynamoDbTable || !settings.cache.s3Bucket) {
      throw new Error('Cache configuration missing: CACHE_DYNAMODB_TABLE and CACHE_S3_BUCKET required');
    }

    DebugAndLog.info('Initializing cache-data Cache', {
      dynamoDbTable: settings.cache.dynamoDbTable,
      s3Bucket: settings.cache.s3Bucket
    });

    // >! Initialize Cache with DynamoDB and S3 backends
    // >! This must complete before any cache operations
    await Cache.init({
      dynamoDbTable: settings.cache.dynamoDbTable,
      s3Bucket: settings.cache.s3Bucket,
      // Use AWS region from settings
      region: settings.aws.region
    });

    DebugAndLog.info('Cache initialized successfully');

    // Step 3: Load GitHub token from SSM Parameter Store
    // >! GitHub token is required for private repository access
    // >! Non-blocking - if it fails, we log warning and continue
    try {
      DebugAndLog.info('Loading GitHub token from SSM Parameter Store', {
        parameter: settings.aws.githubTokenParameter
      });

      githubToken = await loadGitHubToken();
      
      if (githubToken) {
        DebugAndLog.info('GitHub token loaded successfully');
      } else {
        DebugAndLog.warn('GitHub token not found - private repository access will be limited');
      }
    } catch (error) {
      // >! Non-fatal error - log warning and continue
      // >! MCP server can still function with public repositories only
      DebugAndLog.warn('Failed to load GitHub token from SSM', {
        parameter: settings.aws.githubTokenParameter,
        error: error.message
      });
    }

    // Step 4: Build documentation index asynchronously (non-blocking)
    // >! Documentation index building is async and non-blocking
    // >! Lambda can start processing requests while index builds in background
    buildDocumentationIndexAsync();

    // Mark as initialized
    initialized = true;
    DebugAndLog.info('Configuration initialization complete');

  } catch (error) {
    // >! Store initialization error so subsequent calls fail fast
    initializationError = error;
    DebugAndLog.error('Configuration initialization failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Load GitHub token from SSM Parameter Store
 * 
 * @async
 * @private
 * @returns {Promise<string|null>} GitHub token or null if not found
 * @throws {Error} If SSM API call fails
 */
async function loadGitHubToken() {
  const parameterName = settings.aws.githubTokenParameter;
  
  if (!parameterName) {
    DebugAndLog.warn('GitHub token parameter name not configured');
    return null;
  }

  try {
    // >! Use AWS.ssm from cache-data tools for SSM operations
    const ssm = AWS.ssm;
    
    // >! Retrieve parameter with decryption enabled for SecureString parameters
    const result = await ssm.get({
      Name: parameterName,
      WithDecryption: true
    });

    if (result && result.Parameter && result.Parameter.Value) {
      return result.Parameter.Value;
    }

    return null;
  } catch (error) {
    // >! Handle ParameterNotFound error gracefully
    if (error.name === 'ParameterNotFound') {
      DebugAndLog.warn('GitHub token parameter not found in SSM', {
        parameter: parameterName
      });
      return null;
    }
    
    // >! Re-throw other errors (permission issues, etc.)
    throw error;
  }
}

/**
 * Build documentation index asynchronously (non-blocking)
 * 
 * This function starts the documentation index building process in the background.
 * It does not block Lambda initialization - the Lambda can start processing
 * requests while the index builds.
 * 
 * The documentation index includes:
 * - Template repository documentation
 * - Cache-data package documentation
 * - App starter code patterns (on-demand)
 * 
 * @private
 */
function buildDocumentationIndexAsync() {
  // >! Start async index building without blocking
  // >! Use setImmediate to defer execution until after init() completes
  setImmediate(async () => {
    try {
      DebugAndLog.info('Starting documentation index build (async)');
      
      // TODO: Implement documentation index building in models/doc-index.js
      // For now, just log that we would build the index
      DebugAndLog.debug('Documentation index building deferred to models/doc-index.js implementation');
      
      // When implemented, this will:
      // 1. Index template repo documentation
      // 2. Index cache-data package documentation
      // 3. Index CloudFormation template patterns
      // 4. Store indexed data in cache for fast search
      
    } catch (error) {
      // >! Non-fatal error - log warning but don't fail Lambda
      DebugAndLog.warn('Documentation index build failed', {
        error: error.message
      });
    }
  });
}

/**
 * Map log level string to DebugAndLog numeric level
 * 
 * @private
 * @param {string} level - Log level string (ERROR, WARN, INFO, DEBUG, DIAG)
 * @returns {number} Numeric log level for DebugAndLog
 */
function mapLogLevel(level) {
  const levelMap = {
    'ERROR': 1,
    'WARN': 2,
    'INFO': 3,
    'DEBUG': 4,
    'DIAG': 5
  };
  
  return levelMap[level.toUpperCase()] || 3; // Default to INFO
}

/**
 * Get settings object
 * 
 * @returns {Object} Settings object
 * 
 * @example
 * const settings = Config.settings();
 * console.log(settings.s3.buckets);
 */
function getSettings() {
  return settings;
}

/**
 * Get connection and cache profile
 * 
 * This is a convenience method that delegates to connections.getConnCacheProfile()
 * 
 * @param {string} connectionName - Connection name
 * @param {string} profileName - Cache profile name
 * @returns {{conn: Object, cacheProfile: Object}|null} Connection and profile or null
 * 
 * @example
 * const { conn, cacheProfile } = Config.getConnCacheProfile('s3-templates', 'templates-list');
 * conn.host = ['bucket1', 'bucket2'];
 * const result = await CacheableDataAccess.getData(cacheProfile, fetchFn, conn, {});
 */
function getConnCacheProfileWrapper(connectionName, profileName) {
  return getConnCacheProfile(connectionName, profileName);
}

/**
 * Get GitHub token
 * 
 * @returns {string|null} GitHub token or null if not loaded
 * 
 * @example
 * const token = Config.getGitHubToken();
 * if (token) {
 *   // Use token for GitHub API requests
 * }
 */
function getGitHubToken() {
  return githubToken;
}

/**
 * Check if configuration is initialized
 * 
 * @returns {boolean} True if initialized
 */
function isInitialized() {
  return initialized;
}

/**
 * Reset initialization state (for testing only)
 * 
 * @private
 */
function reset() {
  initialized = false;
  githubToken = null;
  initializationError = null;
}

module.exports = {
  init,
  settings: getSettings,
  getConnCacheProfile: getConnCacheProfileWrapper,
  getGitHubToken,
  isInitialized,
  // Export for testing
  _reset: reset
};
