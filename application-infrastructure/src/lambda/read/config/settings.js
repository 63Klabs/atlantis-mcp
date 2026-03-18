/**
 * Configuration settings for Atlantis MCP Server Read Lambda
 *
 * This module parses environment variables and provides structured configuration
 * for S3 buckets, GitHub organizations, cache TTLs, and template categories.
 *
 * @module config/settings
 */

const { tools: { DebugAndLog, CachedSsmParameter } } = require('@63klabs/cache-data');

/**
 * Parse comma-delimited environment variable into array
 *
 * @param {string} envVar - Environment variable name
 * @param {Array<string>} defaultValue - Default value if not set
 * @returns {Array<string>} Parsed array of values
 */
function parseCommaSeparated(envVar, defaultValue = []) {
  const value = process.env[envVar];
  if (!value || value.trim() === '') {
    return defaultValue;
  }
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
}

/**
 * Parse TTL value from environment variable
 *
 * @param {string} envVar - Environment variable name
 * @param {number} defaultValue - Default TTL in seconds
 * @returns {number} TTL in seconds
 */
function parseTTL(envVar, defaultValue) {
  const value = process.env[envVar];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    DebugAndLog.warn(`Invalid TTL value for ${envVar}: ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Template categories supported by Atlantis platform
 * @constant
 */
const TEMPLATE_CATEGORIES = [
  {
    name: 'storage',
    description: 'S3 buckets, DynamoDB tables, and data storage resources'
  },
  {
    name: 'network',
    description: 'CloudFront distributions, Route53, VPC, and networking resources'
  },
  {
    name: 'pipeline',
    description: 'CodePipeline, CodeBuild, and CI/CD infrastructure'
  },
  {
    name: 'service-role',
    description: 'IAM roles and policies for AWS services'
  },
  {
    name: 'modules',
    description: 'Reusable CloudFormation definitions and nested stacks'
  }
];

/**
 * Application settings object
 * Organized into logical sections for S3, GitHub, cache, logging, and naming
 */
const settings = {
  // S3 Configuration
  s3: {
    /**
     * List of S3 buckets to search for templates and starters
     * Parsed from ATLANTIS_S3_BUCKETS environment variable
     * @type {Array<string>}
     */
    buckets: parseCommaSeparated('ATLANTIS_S3_BUCKETS', ['63klabs']),

    /**
     * S3 path prefix for templates
     * @type {string}
     */
    templatePrefix: 'templates/v2',

    /**
     * S3 path prefix for app starters
     * @type {string}
     */
    starterPrefix: 'app-starters/v2'
  },

  // GitHub Configuration
  github: {

    /**
     * GitHub token from SSM Parameter Store.
     * 
     * This is a CachedSsmParameter instance that automatically retrieves and
     * refreshes the GitHub personal access token from AWS Systems Manager
     * Parameter Store. The token is used for GitHub API authentication.
     * 
     * The parameter path is constructed as: PARAM_STORE_PATH + 'GitHubToken'
     * Example: /atlantis/mcp/GitHubToken
     * 
     * Token refresh behavior:
     * - Cached for the lifetime specified in CachedSsmParameter configuration
     * - Automatically refreshed when cache expires
     * - Decrypted automatically if stored as SecureString
     * 
     * @type {CachedSsmParameter}
     * @example
     * // Access token value (automatically retrieved from SSM)
     * const token = await settings.github.token.getValue();
     * 
     * // Use in GitHub API request
     * const response = await fetch('https://api.github.com/user/repos', {
     *   headers: {
     *     'Authorization': `Bearer ${await settings.github.token.getValue()}`
     *   }
     * });
     */
    token: new CachedSsmParameter(process.env.PARAM_STORE_PATH+'GitHubToken'),

    /**
     * List of GitHub users/organizations to search for repositories
     * Parsed from ATLANTIS_GITHUB_USER_ORGS environment variable
     * @type {Array<string>}
     */
    userOrgs: parseCommaSeparated('ATLANTIS_GITHUB_USER_ORGS', []),

    /**
     * GitHub custom property name for repository type
     * @type {string}
     */
    repositoryTypeProperty: 'atlantis_repository-type',

    /**
     * Valid repository type values
     * @type {Array<string>}
     */
    validRepositoryTypes: [
      'documentation',
      'app-starter',
      'templates',
      'management',
      'package',
      'mcp'
    ]
  },

  // Cache Configuration
  cache: {
    /**
     * Cache TTL (Time To Live) values in seconds for different resource types.
     * 
     * TTL values control how long cached data remains valid before requiring
     * refresh from the origin. Longer TTLs reduce API calls and improve
     * performance but may serve stale data. Shorter TTLs ensure fresher data
     * but increase API calls and latency.
     * 
     * All TTL values are configurable via environment variables with sensible
     * defaults. Production deployments typically use longer TTLs than test
     * environments.
     * 
     * @type {Object}
     */
    ttl: {
      /**
       * TTL for full template content (default: 3600s = 1 hour)
       * @type {number}
       */
      fullTemplateContent: parseTTL('TTL_FULL_TEMPLATE_CONTENT', 3600),

      /**
       * TTL for template version history (default: 3600s = 1 hour)
       * @type {number}
       */
      templateVersionHistory: parseTTL('TTL_TEMPLATE_VERSION_HISTORY', 3600),

      /**
       * TTL for template update information (default: 3600s = 1 hour)
       * @type {number}
       */
      templateUpdates: parseTTL('TTL_TEMPLATE_UPDATES', 3600),

      /**
       * TTL for template list (default: 1800s = 30 minutes)
       * @type {number}
       */
      templateList: parseTTL('TTL_TEMPLATE_LIST', 1800),

      /**
       * TTL for app starter list (default: 1800s = 30 minutes)
       * @type {number}
       */
      appStarterList: parseTTL('TTL_APP_STARTER_LIST', 1800),

      /**
       * TTL for GitHub repository list (default: 1800s = 30 minutes)
       * @type {number}
       */
      githubRepoList: parseTTL('TTL_GITHUB_REPO_LIST', 1800),

      /**
       * TTL for S3 bucket list (default: 1800s = 30 minutes)
       * @type {number}
       */
      s3BucketList: parseTTL('TTL_S3_BUCKET_LIST', 1800),

      /**
       * TTL for namespace list (default: 1800s = 30 minutes)
       * @type {number}
       */
      namespaceList: parseTTL('TTL_NAMESPACE_LIST', 1800),

      /**
       * TTL for category list (default: 1800s = 30 minutes)
       * @type {number}
       */
      categoryList: parseTTL('TTL_CATEGORY_LIST', 1800),

      /**
       * TTL for documentation index (default: 3600s = 1 hour)
       * @type {number}
       */
      documentationIndex: parseTTL('TTL_DOCUMENTATION_INDEX', 3600)
    }
  },

  // Naming Convention Configuration
  naming: {
    /**
     * Application resource naming pattern
     * @type {string}
     */
    applicationResourcePattern: '<Prefix>-<ProjectId>-<StageId>-<ResourceName>',

    /**
     * S3 bucket naming pattern (primary)
     * @type {string}
     */
    s3BucketPattern: '<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>',

    /**
     * S3 bucket naming pattern (alternative)
     * @type {string}
     */
    s3BucketPatternAlt: '<orgPrefix>-<Prefix>-<ProjectId>-<Region>',

    /**
     * CloudFormation parameters
     */
    parameters: {
      prefix: process.env.PREFIX || '',
      projectId: process.env.PROJECT_ID || '',
      stageId: process.env.STAGE_ID || ''
    }
  },

  // Template Categories
  templates: {
    /**
     * Available template categories
     * @type {Array<{name: string, description: string}>}
     */
    categories: TEMPLATE_CATEGORIES,

    /**
     * Get category names only
     * @returns {Array<string>} Array of category names
     */
    getCategoryNames() {
      return TEMPLATE_CATEGORIES.map(cat => cat.name);
    },

    /**
     * Get category by name
     * @param {string} name - Category name
     * @returns {Object|null} Category object or null if not found
     */
    getCategory(name) {
      return TEMPLATE_CATEGORIES.find(cat => cat.name === name) || null;
    }
  },

  /**
   * Rate limit configuration for different access tiers.
   * 
   * Rate limits control the maximum number of requests allowed per time window
   * to prevent abuse and ensure fair resource allocation. Each tier has:
   * - limit: Maximum number of requests allowed
   * - window: Time window in seconds for the limit
   * 
   * Access tiers:
   * - public: Unauthenticated requests (identified by IP address)
   * - registered: Authenticated free-tier users
   * - paid: Authenticated paid-tier users
   * - private: Internal access
   * 
   * Rate limits are enforced per IP address for public access and per user ID
   * for authenticated access. Limits reset after the time window expires.
   * 
   * @type {Object}
   */
  rateLimits: {

    /**
     * Public rate limit (requests per window per IP address).
     * 
     * Applied to unauthenticated requests. Default: 100 requests per hour.
     * 
     * @type {Object}
     * @property {number} limit - Maximum requests allowed (default: 100)
     * @property {number} window - Time window in seconds (default: 3600 = 1 hour)
     */
    public: {
      limit: parseInt(process.env.PUBLIC_RATE_LIMIT || '100', 10),
      window: parseInt(process.env.PUBLIC_RATE_TIME_RANGE || '3600', 10)
    },
    /**
     * Registered user rate limit (requests per window per user).
     * 
     * Applied to authenticated free-tier users. Default: 500 requests per hour.
     * 
     * @type {Object}
     * @property {number} limit - Maximum requests allowed (default: 500)
     * @property {number} window - Time window in seconds (default: 3600 = 1 hour)
     */
    registered: {
      limit: parseInt(process.env.REGISTERED_RATE_LIMIT || '500', 10),
      window: parseInt(process.env.REGISTERED_RATE_TIME_RANGE || '3600', 10)
    },
    /**
     * Paid user rate limit (requests per window per user).
     * 
     * Applied to authenticated paid-tier users. Default: 2500 requests per hour.
     * 
     * @type {Object}
     * @property {number} limit - Maximum requests allowed (default: 2500)
     * @property {number} window - Time window in seconds (default: 86400 = 24 hours)
     */
    paid: {
      limit: parseInt(process.env.PAID_RATE_LIMIT || '2500', 10),
      window: parseInt(process.env.PAID_RATE_TIME_RANGE || '86400', 10)
    },
    /**
     * Private/admin rate limit (requests per window per user).
     * 
     * Applied to internal/admin access. Default: 1000 requests per hour.
     * 
     * @type {Object}
     * @property {number} limit - Maximum requests allowed (default: 1000)
     * @property {number} window - Time window in seconds (default: 86400 = 24 hours)
     */
    private: {
      limit: parseInt(process.env.PRIVATE_RATE_LIMIT || '1000', 10),
      window: parseInt(process.env.PRIVATE_RATE_TIME_RANGE || '86400', 10)
    }

  }
};

/**
 * Validate settings on module load
 * Logs warnings for missing required configuration
 */
function validateSettings() {
  const warnings = [];

  if (settings.s3.buckets.length === 0) {
    warnings.push('ATLANTIS_S3_BUCKETS not configured - template discovery will be limited');
  }

  if (settings.github.userOrgs.length === 0) {
    warnings.push('ATLANTIS_GITHUB_USER_ORGS not configured - repository discovery will be limited');
  }

  if (warnings.length > 0) {
    DebugAndLog.warn('Configuration warnings:');
    warnings.forEach(warning => DebugAndLog.warn(`  - ${warning}`));
  }
}

// Validate settings on module load
validateSettings();

module.exports = settings;
