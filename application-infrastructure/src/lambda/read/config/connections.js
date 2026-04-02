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

// >! Web service and cache framework package
const { tools: {DebugAndLog} } = require("@63klabs/cache-data");

// >! Application Modules
const settings = require('./settings');

// >! Script Globals
/**
 * Environment check for production vs non-production
 * environment for determining cache TTL values
 *
 * @constant {boolean}
 */
const IS_PRODUCTION = DebugAndLog.isProduction();

/**
 * Standard cache TTL values based on environment
 * @constant {number}
 * @default
 */
const TTL_NON_PROD = IS_PRODUCTION ? 3600 : 60;

/**
 * Connection and cache profile definitions.
 * 
 * This array defines all data source connections and their associated cache
 * profiles for the Atlantis MCP Server. Each connection represents a data
 * source (S3 buckets, GitHub API, documentation index) with multiple cache
 * profiles for different access patterns.
 * 
 * Connection Structure:
 * - name: Unique identifier for the connection (e.g., 's3-templates')
 * - host: Target host (set dynamically in services for S3, static for GitHub)
 * - path: Base path for requests
 * - cache: Array of cache profiles with different TTL and caching strategies
 * 
 * Cache Profile Structure:
 * - profile: Unique identifier within the connection (e.g., 'templates-list')
 * - overrideOriginHeaderExpiration: Whether to override origin cache headers
 * - defaultExpirationInSeconds: TTL for cached data
 * - expirationIsOnInterval: Whether to refresh on interval vs on-demand
 * - headersToRetain: HTTP headers to preserve in cache (comma-separated)
 * - hostId: Host identifier for cache key generation
 * - pathId: Path identifier for cache key generation
 * - encrypt: Whether to encrypt cached data
 * 
 * Dynamic Host Setting Pattern:
 * For S3 connections, the host is set to null and dynamically assigned in
 * services based on filtering requirements (e.g., specific S3 buckets from
 * settings.s3.buckets). This allows filtering by bucket while maintaining
 * consistent cache keys via hostId/pathId.
 * 
 * Production vs Test TTLs:
 * Cache profiles use different TTL values based on environment:
 * - Production (IS_PRODUCTION=true): Longer TTLs for stability and performance
 * - Test (IS_PRODUCTION=false): Shorter TTLs for rapid iteration during development
 * 
 * @type {Array<{name: string, host: string|null, path: string, cache: Array<Object>}>}
 * @example
 * // Access connection profiles via Config.getConnCacheProfile()
 * const { Config } = require('./config');
 * 
 * // Get cache profile for S3 template list
 * const profile = Config.getConnCacheProfile('s3-templates', 'templates-list');
 * console.log(profile.defaultExpirationInSeconds); // 3600 (production) or 300 (test)
 * 
 * @example
 * // Get cache profile for GitHub repository metadata
 * const profile = Config.getConnCacheProfile('github-api', 'repo-metadata');
 * console.log(profile.hostId); // 'github'
 * console.log(profile.pathId); // 'metadata'
 */
const connections = [
  // S3 Templates Connection
  {
    name: 's3-templates',
    // >! Host is set dynamically in services based on atlantisS3Buckets from settings
    // >! This allows filtering by specific buckets while maintaining cache key consistency
    host: "",
    path: settings.s3.templatePrefix, // 'templates/v2' - namespace prepended in DAO
    cache: [
      // Template list cache profile
      {
        profile: 'templates-list',
        overrideOriginHeaderExpiration: true,
        defaultExpirationInSeconds: IS_PRODUCTION ? (60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? 3600 : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? 3600 : TTL_NON_PROD,
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
    host: "",
    path: settings.s3.starterPrefix, // 'app-starters/v2' - namespace prepended in DAO
    cache: [
      // App starters list cache profile
      {
        profile: 'starters-list',
        overrideOriginHeaderExpiration: true,
        // >! Production: 1 hour TTL for starter lists (changes infrequently)
        // >! Test: 5 minute TTL for rapid iteration
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
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
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 'docs',
        pathId: 'search',
        encrypt: false
      }
    ]
  },

  // Template Chunk Internal Cache Connection
  {
    name: 'template-chunks',
    host: 'internal', // Internal processing, not external API
    path: '/chunks',
    cache: [
      // Chunk data cache profile
      {
        profile: 'chunk-data',
        overrideOriginHeaderExpiration: true,
        // >! Production: 24 hour TTL matching template-detail (chunk TTL ≤ template-detail TTL)
        // >! Test: Short TTL for rapid iteration
        defaultExpirationInSeconds: IS_PRODUCTION ? (24 * 60 * 60) : TTL_NON_PROD,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 'template-chunks',
        pathId: 'data',
        encrypt: false
      }
    ]
  }
];

module.exports = connections;
