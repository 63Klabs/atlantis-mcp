/**
 * Cache-data connection and cache profile configurations for Atlantis MCP Server
 *
 * This module defines connection profiles for different data sources (S3, GitHub API)
 * and their associated cache profiles with appropriate TTLs and caching strategies.
 *
 * Connection hosts are set dynamically in services based on filtering requirements.
 * Cache profiles use different TTLs for production vs test environments.
 *
 * @module config/connections
 */

const settings = require('./settings');

/**
 * Determine if running in production environment
 * Production environments have longer cache TTLs and more conservative settings
 *
 * @returns {boolean} True if production environment
 */
function isProduction() {
  const stageId = process.env.STAGE_ID || '';
  return stageId.toLowerCase() === 'prod' || stageId.toLowerCase() === 'production';
}

/**
 * Connection and cache profile definitions
 *
 * Each connection defines:
 * - name: Unique identifier for the connection
 * - host: Target host (set dynamically in services for S3, static for GitHub)
 * - path: Base path for requests
 * - cache: Array of cache profiles with TTL and caching strategy
 *
 * Cache profiles define:
 * - profile: Unique identifier within the connection
 * - overrideOriginHeaderExpiration: Whether to override origin cache headers
 * - defaultExpirationInSeconds: TTL for cached data
 * - expirationIsOnInterval: Whether to refresh on interval vs on-demand
 * - headersToRetain: HTTP headers to preserve in cache
 * - hostId: Host identifier for cache key generation
 * - pathId: Path identifier for cache key generation
 * - encrypt: Whether to encrypt cached data
 *
 * @type {Array<Object>}
 */
const connections = [
  // S3 Templates Connection
  {
    name: 's3-templates',
    // >! Host is set dynamically in services based on atlantisS3Buckets from settings
    // >! This allows filtering by specific buckets while maintaining cache key consistency
    host: null,
    path: settings.s3.templatePrefix, // 'templates/v2' - namespace prepended in DAO
    cache: [
      // Template list cache profile
      {
        profile: 'templates-list',
        overrideOriginHeaderExpiration: true,
        // >! Production: 1 hour TTL for template lists (changes infrequently)
        // >! Test: 5 minute TTL for rapid iteration during development
        defaultExpirationInSeconds: isProduction() ? 3600 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 's3-templates',
        pathId: 'list',
        encrypt: false
      },
      // Template detail cache profile
      {
        profile: 'template-detail',
        overrideOriginHeaderExpiration: true,
        // >! Production: 24 hour TTL for full template content (large YAML files, rarely change)
        // >! Test: 5 minute TTL for rapid iteration
        defaultExpirationInSeconds: isProduction() ? 86400 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 's3-templates',
        pathId: 'detail',
        encrypt: false
      },
      // Template versions cache profile
      {
        profile: 'template-versions',
        overrideOriginHeaderExpiration: true,
        // >! Production: 1 hour TTL for version history (moderate change rate)
        // >! Test: 1 minute TTL for rapid iteration
        defaultExpirationInSeconds: isProduction() ? 3600 : 60,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 's3-templates',
        pathId: 'versions',
        encrypt: false
      },
      // Template updates cache profile
      {
        profile: 'template-updates',
        overrideOriginHeaderExpiration: true,
        // >! Production: 1 hour TTL for update checks
        // >! Test: 5 minute TTL for rapid iteration
        defaultExpirationInSeconds: isProduction() ? 3600 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 's3-templates',
        pathId: 'updates',
        encrypt: false
      }
    ]
  },

  // S3 App Starters Connection
  {
    name: 's3-app-starters',
    // >! Host is set dynamically in services based on atlantisS3Buckets from settings
    host: null,
    path: settings.s3.starterPrefix, // 'app-starters/v2' - namespace prepended in DAO
    cache: [
      // App starters list cache profile
      {
        profile: 'starters-list',
        overrideOriginHeaderExpiration: true,
        // >! Production: 1 hour TTL for starter lists (changes infrequently)
        // >! Test: 5 minute TTL for rapid iteration
        defaultExpirationInSeconds: isProduction() ? 3600 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 's3-app-starters',
        pathId: 'list',
        encrypt: false
      },
      // Starter detail cache profile
      {
        profile: 'starter-detail',
        overrideOriginHeaderExpiration: true,
        // >! Production: 1 hour TTL for starter metadata (sidecar files)
        // >! Test: 5 minute TTL for rapid iteration
        defaultExpirationInSeconds: isProduction() ? 3600 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 's3-app-starters',
        pathId: 'detail',
        encrypt: false
      }
    ]
  },

  // GitHub API Connection
  {
    name: 'github-api',
    host: 'api.github.com',
    path: '/repos',
    cache: [
      // Repository metadata cache profile
      {
        profile: 'repo-metadata',
        overrideOriginHeaderExpiration: true,
        // >! Production: 30 minute TTL for GitHub repository metadata
        // >! Test: 5 minute TTL for rapid iteration
        // >! Respects GitHub API rate limits by caching aggressively
        defaultExpirationInSeconds: isProduction() ? 1800 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 'github',
        pathId: 'metadata',
        encrypt: false
      },
      // Repository custom properties cache profile
      {
        profile: 'repo-properties',
        overrideOriginHeaderExpiration: true,
        // >! Production: 1 hour TTL for GitHub custom properties (rarely change)
        // >! Test: 5 minute TTL for rapid iteration
        defaultExpirationInSeconds: isProduction() ? 3600 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 'github',
        pathId: 'properties',
        encrypt: false
      },
      // Repository README cache profile
      {
        profile: 'repo-readme',
        overrideOriginHeaderExpiration: true,
        // >! Production: 1 hour TTL for README content
        // >! Test: 5 minute TTL for rapid iteration
        defaultExpirationInSeconds: isProduction() ? 3600 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 'github',
        pathId: 'readme',
        encrypt: false
      },
      // Repository releases cache profile
      {
        profile: 'repo-releases',
        overrideOriginHeaderExpiration: true,
        // >! Production: 30 minute TTL for release information
        // >! Test: 5 minute TTL for rapid iteration
        defaultExpirationInSeconds: isProduction() ? 1800 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 'github',
        pathId: 'releases',
        encrypt: false
      }
    ]
  },

  // Documentation Index Connection
  {
    name: 'documentation-index',
    host: 'internal', // Internal processing, not external API
    path: '/docs',
    cache: [
      // Documentation index cache profile
      {
        profile: 'doc-index',
        overrideOriginHeaderExpiration: true,
        // >! Production: 6 hour TTL for documentation index (large, daily updates)
        // >! Test: 5 minute TTL for rapid iteration
        // >! Refresh on interval to keep index current
        defaultExpirationInSeconds: isProduction() ? 21600 : 300,
        expirationIsOnInterval: true, // Refresh on interval
        headersToRetain: '',
        hostId: 'docs',
        pathId: 'index',
        encrypt: false
      },
      // Code patterns cache profile
      {
        profile: 'code-patterns',
        overrideOriginHeaderExpiration: true,
        // >! Production: 6 hour TTL for indexed code patterns
        // >! Test: 5 minute TTL for rapid iteration
        // >! Downstream cache for processed template/starter code
        defaultExpirationInSeconds: isProduction() ? 21600 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 'docs',
        pathId: 'patterns',
        encrypt: false
      },
      // Documentation search results cache profile
      {
        profile: 'doc-search',
        overrideOriginHeaderExpiration: true,
        // >! Production: 1 hour TTL for search results
        // >! Test: 5 minute TTL for rapid iteration
        defaultExpirationInSeconds: isProduction() ? 3600 : 300,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 'docs',
        pathId: 'search',
        encrypt: false
      }
    ]
  }
];

/**
 * Get connection by name
 *
 * @param {string} name - Connection name
 * @returns {Object|null} Connection object or null if not found
 */
function getConnection(name) {
  return connections.find(conn => conn.name === name) || null;
}

/**
 * Get cache profile from connection
 *
 * @param {string} connectionName - Connection name
 * @param {string} profileName - Cache profile name
 * @returns {Object|null} Cache profile object or null if not found
 */
function getCacheProfile(connectionName, profileName) {
  const connection = getConnection(connectionName);
  if (!connection) {
    return null;
  }

  return connection.cache.find(profile => profile.profile === profileName) || null;
}

/**
 * Get connection and cache profile together
 * Used by services to retrieve both connection and cache configuration
 *
 * @param {string} connectionName - Connection name
 * @param {string} profileName - Cache profile name
 * @returns {{conn: Object, cacheProfile: Object}|null} Connection and profile or null
 *
 * @example
 * const { conn, cacheProfile } = getConnCacheProfile('s3-templates', 'templates-list');
 * conn.host = ['bucket1', 'bucket2']; // Set dynamically in service
 * const result = await CacheableDataAccess.getData(cacheProfile, fetchFn, conn, {});
 */
function getConnCacheProfile(connectionName, profileName) {
  const connection = getConnection(connectionName);
  if (!connection) {
    return null;
  }

  const cacheProfile = connection.cache.find(profile => profile.profile === profileName);
  if (!cacheProfile) {
    return null;
  }

  // Return deep copy to prevent mutation of original connection
  return {
    conn: JSON.parse(JSON.stringify(connection)),
    cacheProfile: JSON.parse(JSON.stringify(cacheProfile))
  };
}

module.exports = {
  connections,
  getConnection,
  getCacheProfile,
  getConnCacheProfile
};
