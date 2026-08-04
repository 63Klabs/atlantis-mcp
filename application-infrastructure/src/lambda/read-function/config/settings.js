/**
 * Configuration settings for Atlantis MCP Server Read Lambda
 *
 * This module parses environment variables and provides structured configuration
 * for S3 buckets, GitHub organizations, cache TTLs, and template categories.
 *
 * @module config/settings
 */

const { tools: { DebugAndLog, CachedSsmParameter } } = require('@63klabs/cache-data');
const AgentAssetTypes = require('./agent-asset-types');

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
 * Parse a boolean environment variable.
 *
 * Recognizes `true`, `1`, `yes`, and `on` (case-insensitive) as true, and
 * `false`, `0`, `no`, and `off` as false. When the variable is unset, empty,
 * or set to an unrecognized value, a warning is logged (only for unrecognized
 * values) and the documented default is returned. This never throws so that
 * settings load cannot fail on a malformed flag.
 *
 * @param {string} envVar - Environment variable name
 * @param {boolean} [defaultValue=false] - Default value when unset or invalid
 * @returns {boolean} Parsed boolean value
 * @example
 * // DOC_AI_ENABLED unset -> false (keyword-only behavior preserved)
 * const enabled = parseBool('DOC_AI_ENABLED', false);
 */
function parseBool(envVar, defaultValue = false) {
  const value = process.env[envVar];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  DebugAndLog.warn(`Invalid boolean value for ${envVar}: ${value}, using default: ${defaultValue}`);
  return defaultValue;
}

/**
 * Parse an enumerated string environment variable, validating it against a
 * fixed set of allowed values.
 *
 * When the variable is unset or empty, `defaultValue` is returned. When it is
 * set to one of `allowedValues`, that value is returned. When it is set to an
 * unrecognized value, a warning is logged and `fallbackValue` is returned.
 * `fallbackValue` defaults to `defaultValue`, but may differ where the spec
 * requires an unset default that is distinct from the invalid-value fallback
 * (for example, retrieval mode defaults to `semantic` when unset but falls
 * back to `keyword` when misconfigured). This never throws.
 *
 * @param {string} envVar - Environment variable name
 * @param {Array<string>} allowedValues - Recognized values
 * @param {string} defaultValue - Value returned when the variable is unset/empty
 * @param {string} [fallbackValue=defaultValue] - Value returned when set but invalid
 * @returns {string} Validated setting value
 * @example
 * // Unset -> 'semantic'; invalid -> warn + 'keyword'; 'keyword' -> 'keyword'
 * const mode = parseEnum('DOC_AI_RETRIEVAL_MODE', ['keyword', 'semantic', 'semantic-assisted'], 'semantic', 'keyword');
 */
function parseEnum(envVar, allowedValues, defaultValue, fallbackValue = defaultValue) {
  const value = process.env[envVar];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  const trimmed = value.trim();
  if (allowedValues.includes(trimmed)) {
    return trimmed;
  }
  DebugAndLog.warn(`Invalid value for ${envVar}: ${value} (expected one of: ${allowedValues.join(', ')}), using: ${fallbackValue}`);
  return fallbackValue;
}

/**
 * Parse an integer environment variable with inclusive range validation.
 *
 * When the variable is unset or empty, `defaultValue` is returned. When it
 * parses to an integer within `[min, max]`, that value is returned. Otherwise
 * (non-numeric or out of range) a warning is logged and `defaultValue` is
 * returned. This never throws so that settings load cannot fail on a malformed
 * numeric value.
 *
 * @param {string} envVar - Environment variable name
 * @param {number} defaultValue - Default value when unset or invalid
 * @param {Object} [options] - Validation options
 * @param {number} [options.min=1] - Minimum allowed value (inclusive)
 * @param {number} [options.max=Infinity] - Maximum allowed value (inclusive)
 * @returns {number} Parsed integer value
 * @example
 * const topK = parseIntSetting('DOC_AI_TOP_K', 10, { min: 1 });
 */
function parseIntSetting(envVar, defaultValue, { min = 1, max = Infinity } = {}) {
  const value = process.env[envVar];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    DebugAndLog.warn(`Invalid value for ${envVar}: ${value} (expected integer in range [${min}, ${max}]), using default: ${defaultValue}`);
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
 * Access tiers in ascending order of privilege, used to validate
 * `DOC_AI_MIN_TIER`. Ordering: public < registered < paid < private.
 * @constant {Array<string>}
 */
const DOC_AI_TIERS = ['public', 'registered', 'paid', 'private'];

/**
 * Valid retrieval modes for `DOC_AI_RETRIEVAL_MODE`.
 * @constant {Array<string>}
 */
const DOC_AI_RETRIEVAL_MODES = ['keyword', 'semantic', 'semantic-assisted'];

/**
 * Valid vector stores for `DOC_AI_VECTOR_STORE`.
 * @constant {Array<string>}
 */
const DOC_AI_VECTOR_STORES = ['dynamodb', 's3-vectors'];

/**
 * @typedef {Object} ToolDefinition
 * @property {string} name - Tool name used for routing
 * @property {string} description - Human-readable description of the tool
 * @property {Object} inputSchema - JSON Schema for tool input validation
 */

/**
 * Application settings object
 * Organized into logical sections for S3, GitHub, cache, logging, and naming
 */
const settings = {
  // Tools Configuration
  tools: {
    /**
     * Complete list of MCP tool definitions supported by this server.
     * This is the single source of truth for tool metadata.
     *
     * The literal array below holds the base tool set (templates, starters,
     * documentation, naming validation, chunking, etc.). The registry-driven
     * agent-asset tools (`list_agent_assets`, `get_agent_asset`,
     * `list_agent_asset_types`) are appended from
     * `AgentAssetTypes.generateToolDefinitions()` so that `tools/list`,
     * `list_tools`, and `MCPProtocol.MCP_TOOLS` all discover them from this
     * single source, with the `assetType` enum reflecting the enabled
     * `AGENT_ASSET_TYPES` entries.
     * @type {Array<ToolDefinition>}
     */
    availableToolsList: [
      {
        name: 'list_tools',
        description: 'List all available MCP tools with their descriptions and input schemas. Returns the complete set of tools supported by this server.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      },
      {
        name: 'list_templates',
        description: 'List all CloudFormation templates available for deployment via Atlantis scripts, filtered by category, version, or S3 bucket. Categories include: **storage**, **network**, **pipeline**, **service-role**, and **modules**. The modules category organizes templates into subcategories (nested subdirectories). Returns template metadata such as name, category, description, namespace, and S3 location. Returns an empty array if no templates match the specified filters. Use the `category` parameter to narrow results when you know the resource type you need. To get version information for a specific template, use `list_template_versions`.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Filter by template category (storage, network, pipeline, service-role, modules)',
              enum: TEMPLATE_CATEGORIES.map(cat => cat.name)
            },
            s3Buckets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific S3 buckets from configured list'
            }
          }
        }
      },
      {
        name: 'get_template',
        description: 'Retrieve a specific CloudFormation template with full content and metadata. Returns template content, parameters, outputs, version information, and S3 location.',
        inputSchema: {
          type: 'object',
          properties: {
            templateName: {
              type: 'string',
              description: 'Name of the template to retrieve'
            },
            category: {
              type: 'string',
              description: 'Template category',
              enum: TEMPLATE_CATEGORIES.map(cat => cat.name)
            },
            version: {
              type: 'string',
              description: 'Human_Readable_Version (e.g., v1.2.3/2024-01-15)',
              pattern: '^v\\d+\\.\\d+\\.\\d+(\\/\\d{4}-\\d{2}-\\d{2})?$'
            },
            versionId: {
              type: 'string',
              description: 'S3_VersionId for specific version'
            },
            s3Buckets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific S3 buckets from configured list'
            }
          },
          required: ['templateName', 'category']
        }
      },
      {
        name: 'list_template_versions',
        description: 'List all versions of a specific CloudFormation template. Returns version history with Human_Readable_Version, S3_VersionId, last modified date, and size.',
        inputSchema: {
          type: 'object',
          properties: {
            templateName: {
              type: 'string',
              description: 'Name of the template'
            },
            category: {
              type: 'string',
              description: 'Template category',
              enum: TEMPLATE_CATEGORIES.map(cat => cat.name)
            },
            s3Buckets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific S3 buckets from configured list'
            }
          },
          required: ['templateName', 'category']
        }
      },
      {
        name: 'list_categories',
        description: 'List all available template categories with descriptions and template counts. Returns category names, descriptions, and number of templates in each category.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'list_starters',
        description: 'List all available application starter code repositories. Returns starter metadata including name, description, languages, frameworks, features, and S3 location. Starters can be used to initialize new project application repositories or reviewed for code patterns and stadards. They include a CloudFormation template and Build Spec to deploy the application and code for a Lambda function or other resources.',
        inputSchema: {
          type: 'object',
          properties: {
            s3Buckets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific S3 buckets from configured list'
            },
            namespace: {
              type: 'string',
              description: 'Filter to a specific namespace (S3 root prefix)'
            }
          }
        }
      },
      {
        name: 'get_starter_info',
        description: 'Retrieve detailed information about a specific starter code repository. Returns comprehensive metadata including languages, frameworks, features, prerequisites, and S3 location.',
        inputSchema: {
          type: 'object',
          properties: {
            starterName: {
              type: 'string',
              description: 'Name of the starter repository'
            },
            s3Buckets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific S3 buckets from configured list'
            },
            namespace: {
              type: 'string',
              description: 'Filter to a specific namespace (S3 root prefix)'
            }
          },
          required: ['starterName']
        }
      },
      {
        name: 'search_documentation',
        description: 'Search Atlantis documentation, tutorials, and code patterns. Returns search results with title, excerpt, file path, GitHub URL, and result type (documentation or code example).',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query keywords'
            },
            type: {
              type: 'string',
              description: 'Filter by result type',
              enum: ['guide', 'tutorial', 'reference', 'troubleshooting', 'template pattern', 'code example']
            },
            ghusers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific GitHub users/orgs from configured list'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'validate_naming',
        description: 'Validate resource names against Atlantis naming conventions. Supports S3 regional buckets (Pattern 1: AccountId-Region with -an suffix), global buckets (Pattern 2: AccountId-Region, Pattern 3: simple), service-role resources (ALL CAPS Prefix, no StageId), and application resources. Provide known component values (prefix, projectId) for accurate parsing of hyphenated components.',
        inputSchema: {
          type: 'object',
          properties: {
            resourceName: {
              type: 'string',
              description: 'Resource name to validate'
            },
            resourceType: {
              type: 'string',
              description: 'Type of AWS resource. "s3" and "service-role" have special validation patterns; all other values use standard application resource validation (Prefix-ProjectId-StageId-ResourceSuffix).'
            },
            isShared: {
              type: 'boolean',
              description: 'When true, validates as a shared resource without a StageId component (e.g., Prefix-ProjectId-ResourceSuffix)'
            },
            hasOrgPrefix: {
              type: 'boolean',
              description: 'When true, indicates the S3 bucket name includes an organization prefix segment for disambiguation'
            },
            prefix: {
              type: 'string',
              description: 'Known Prefix value for disambiguation of hyphenated components'
            },
            projectId: {
              type: 'string',
              description: 'Known ProjectId value for disambiguation of hyphenated components'
            },
            stageId: {
              type: 'string',
              description: 'Known StageId value for disambiguation of hyphenated components'
            },
            orgPrefix: {
              type: 'string',
              description: 'Known OrgPrefix value for disambiguation of hyphenated components'
            }
          },
          required: ['resourceName']
        }
      },
      {
        name: 'check_template_updates',
        description: 'Check if CloudFormation templates have newer versions available. Returns update information including version, release date, changelog, and migration guide links for breaking changes.',
        inputSchema: {
          type: 'object',
          properties: {
            templateName: {
              type: 'string',
              description: 'Name of the template to check'
            },
            category: {
              type: 'string',
              description: 'Template category',
              enum: TEMPLATE_CATEGORIES.map(cat => cat.name)
            },
            currentVersion: {
              type: 'string',
              description: 'Current Human_Readable_Version (e.g., v1.2.3/2024-01-15)',
              pattern: '^v\\d+\\.\\d+\\.\\d+(\\/\\d{4}-\\d{2}-\\d{2})?$'
            },
            s3Buckets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific S3 buckets from configured list'
            }
          },
          required: ['templateName', 'category', 'currentVersion']
        }
      },
      {
        name: 'get_template_chunk',
        description: 'Retrieve a specific chunk of a large CloudFormation template that was too large to return in a single get_template response.',
        inputSchema: {
          type: 'object',
          properties: {
            templateName: {
              type: 'string',
              description: 'Name of the template to retrieve'
            },
            category: {
              type: 'string',
              description: 'Template category',
              enum: TEMPLATE_CATEGORIES.map(cat => cat.name)
            },
            chunkIndex: {
              type: 'integer',
              description: 'Zero-based index of the chunk to retrieve',
              minimum: 0
            },
            version: {
              type: 'string',
              description: 'Human_Readable_Version (e.g., v1.2.3/2024-01-15)',
              pattern: '^v\\d+\\.\\d+\\.\\d+(\\/\\d{4}-\\d{2}-\\d{2})?$'
            },
            versionId: {
              type: 'string',
              description: 'S3_VersionId for specific version'
            },
            s3Buckets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to specific S3 buckets from configured list'
            },
            namespace: {
              type: 'string',
              description: 'Filter to a specific namespace (S3 root prefix)'
            }
          },
          required: ['templateName', 'category', 'chunkIndex']
        }
      },
      // >! Registry-driven agent-asset tools (list_agent_assets, get_agent_asset,
      // >! list_agent_asset_types), with the `assetType` enum reflecting the
      // >! enabled AGENT_ASSET_TYPES entries. See config/agent-asset-types.js.
      ...AgentAssetTypes.generateToolDefinitions()
    ],

  },

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
    starterPrefix: 'app-starters/v2',

    /**
     * S3 path prefix for agent assets (steering documents, hooks, AGENTS.md, etc.)
     * Used as the 's3-agent-assets' connection `path` and the agent-asset DAO `basePath`.
     * @type {string}
     */
    agentAssetPrefix: 'utilities/v2/agent_assets'
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
    userOrgs: parseCommaSeparated('ATLANTIS_GITHUB_USER_ORGS', ['63klabs']),

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
     * S3 bucket naming patterns.
     * Pattern 1 (Regional): includes AccountId-Region with `-an` suffix.
     * Pattern 2 (Global with AccountId): includes AccountId-Region, no `-an` suffix.
     * Pattern 3 (Global simple): no AccountId or Region.
     * Optional segments shown in brackets.
     * @type {{pattern1: string, pattern2: string, pattern3: string}}
     */
    s3BucketPatterns: {
      pattern1: '[<orgPrefix>-]<Prefix>-<ProjectId>[-<StageId>][-<ResourceName>]-<AccountId>-<Region>-an',
      pattern2: '[<orgPrefix>-]<Prefix>-<ProjectId>[-<StageId>][-<ResourceName>]-<AccountId>-<Region>',
      pattern3: '[<orgPrefix>-]<Prefix>-<ProjectId>[-<StageId>][-<ResourceName>]'
    },

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
  /**
   * Session hash salt from SSM Parameter Store.
   *
   * This is a CachedSsmParameter instance that retrieves and caches the
   * secret salt used for SHA-256 hashing of client identifiers in the
   * rate limiter. The salt prevents correlation of client identifiers
   * across rate limit windows.
   *
   * The parameter path is constructed as: PARAM_STORE_PATH + 'Mcp_SessionHashSalt'
   *
   * @type {CachedSsmParameter}
   */
  sessionHashSalt: new CachedSsmParameter(process.env.PARAM_STORE_PATH+'Mcp_SessionHashSalt'),

  /**
   * DynamoDB sessions table name for distributed rate limiting.
   *
   * Read from the MCP_DYNAMODB_SESSIONS_TABLE environment variable.
   * This table stores per-client rate limit counters with atomic updates
   * and TTL-based automatic cleanup.
   *
   * @type {string}
   */
  dynamoDbSessionsTable: process.env.MCP_DYNAMODB_SESSIONS_TABLE || '',

  /**
   * DynamoDB table name for the documentation index.
   *
   * Read from the DOC_INDEX_TABLE environment variable.
   * This table stores the persistent documentation index built by the
   * Indexer Lambda, including content entries, main index, search keywords,
   * and version pointers.
   *
   * @type {string}
   */
  docIndexTable: process.env.DOC_INDEX_TABLE || '',

  /**
   * Documentation configuration.
   *
   * Currently holds the AI-assisted semantic search feature configuration for
   * the `search_documentation` tool.
   *
   * @type {Object}
   */
  documentation: {
    /**
     * AI-assisted semantic search feature configuration.
     *
     * This feature augments the existing keyword search of `search_documentation`
     * with Bedrock-powered semantic retrieval. It is DISABLED by default so that
     * existing keyword-only behavior is byte-for-byte unchanged until an operator
     * explicitly enables it. All values are parsed defensively: unrecognized or
     * out-of-range values log a warning and fall back to the documented default
     * rather than throwing during settings load.
     *
     * Environment variables:
     * - `DOC_AI_ENABLED` (bool, default false) - master feature flag
     * - `DOC_AI_MIN_TIER` (default `paid`) - minimum tier for semantic search
     *   (public|registered|paid|private)
     * - `DOC_AI_RETRIEVAL_MODE` (default `semantic`) - retrieval strategy
     *   (keyword|semantic|semantic-assisted); invalid values fall back to `keyword`
     * - `DOC_AI_VECTOR_STORE` (default `s3-vectors`) - vector store backend
     *   (dynamodb|s3-vectors)
     * - `DOC_AI_EMBEDDING_MODEL` (default `amazon.titan-embed-text-v2:0`)
     * - `DOC_AI_EMBEDDING_DIMENSIONS` (int, default 1024)
     * - `DOC_AI_EMBEDDING_MAX_INPUT_TOKENS` (int, default 8000)
     * - `DOC_AI_EMBEDDING_REGION` (default '') - optional embedding client
     *   region override; empty means "use deployment region"
     * - `DOC_AI_ASSIST_MODEL` (default `amazon.nova-micro-v1:0`)
     * - `DOC_AI_ASSIST_MAX_CANDIDATES` (int, default 25)
     * - `DOC_AI_TOP_K` (int, default 10)
     * - `DOC_AI_CANDIDATE_MULTIPLIER` (int, default 3)
     * - `DOC_AI_S3_VECTOR_BUCKET` (default '')
     * - `DOC_AI_S3_VECTOR_INDEX` (default '')
     *
     * @type {Object}
     */
    ai: {
      /**
       * Master feature flag. Defaults to false so the tool behaves exactly as
       * the current keyword-only implementation until enabled.
       * @type {boolean}
       */
      enabled: parseBool('DOC_AI_ENABLED', false),

      /**
       * Minimum access tier eligible for semantic search. Requests below this
       * tier use keyword search. Invalid values fall back to `paid`.
       * @type {string}
       */
      minTier: parseEnum('DOC_AI_MIN_TIER', DOC_AI_TIERS, 'paid'),

      /**
       * Retrieval strategy. Defaults to `semantic` when unset; unrecognized
       * values fall back to the safe `keyword` behavior.
       * @type {string}
       */
      retrievalMode: parseEnum('DOC_AI_RETRIEVAL_MODE', DOC_AI_RETRIEVAL_MODES, 'semantic', 'keyword'),

      /**
       * Vector store backend. Invalid values fall back to `s3-vectors`.
       * @type {string}
       */
      vectorStore: parseEnum('DOC_AI_VECTOR_STORE', DOC_AI_VECTOR_STORES, 's3-vectors'),

      /**
       * Embedding model configuration used to embed queries and content.
       *
       * `region` optionally pins the embedding Bedrock Runtime client to a
       * fixed region, overriding the Lambda's deployment region. An empty
       * string (the default) means "use the deployment region" and is fully
       * valid; the value is a defensive string pass-through that never throws
       * during settings load. The CloudFormation `DocAiEmbeddingRegion`
       * parameter `AllowedPattern` is the real input gate. Embedding models
       * cannot use Bedrock cross-region inference profiles, so a hard
       * client-side region pin is the only cross-region mechanism available.
       * @type {{model: string, dimensions: number, maxInputTokens: number, region: string}}
       */
      embedding: {
        model: process.env.DOC_AI_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0',
        dimensions: parseIntSetting('DOC_AI_EMBEDDING_DIMENSIONS', 1024, { min: 1 }),
        maxInputTokens: parseIntSetting('DOC_AI_EMBEDDING_MAX_INPUT_TOKENS', 8000, { min: 1 }),
        // Defensive pass-through: empty string means "use deployment region".
        // Never throws; the CloudFormation AllowedPattern gates the real input.
        region: process.env.DOC_AI_EMBEDDING_REGION || ''
      },

      /**
       * Small-model assist configuration for `semantic-assisted` mode
       * (query expansion / re-ranking only; never answer synthesis).
       * @type {{model: string, maxCandidates: number}}
       */
      assist: {
        model: process.env.DOC_AI_ASSIST_MODEL || 'amazon.nova-micro-v1:0',
        maxCandidates: parseIntSetting('DOC_AI_ASSIST_MAX_CANDIDATES', 25, { min: 1 })
      },

      /**
       * Number of top results returned from semantic retrieval.
       * @type {number}
       */
      topK: parseIntSetting('DOC_AI_TOP_K', 10, { min: 1 }),

      /**
       * Multiplier applied to `topK` to determine how many candidate vectors to
       * fetch before ranking/filtering.
       * @type {number}
       */
      candidateMultiplier: parseIntSetting('DOC_AI_CANDIDATE_MULTIPLIER', 3, { min: 1 }),

      /**
       * S3 Vectors store location. Empty strings indicate the store is not yet
       * configured; used only when `vectorStore` is `s3-vectors`.
       * @type {{bucket: string, index: string}}
       */
      s3Vectors: {
        bucket: process.env.DOC_AI_S3_VECTOR_BUCKET || '',
        index: process.env.DOC_AI_S3_VECTOR_INDEX || ''
      }
    }
  },

  rateLimits: {

    /**
     * Public rate limit (requests per window per IP address).
     *
     * Applied to unauthenticated requests. Default: 50 requests per hour.
     *
     * @type {Object}
     * @property {number} limitPerWindow - Maximum requests allowed (default: 50)
     * @property {number} windowInMinutes - Time window in minutes (default: 60 = 1 hour)
     */
    public: {
      limitPerWindow: parseInt(process.env.MCP_PUBLIC_RATE_LIMIT || '50', 10),
      windowInMinutes: parseInt(process.env.MCP_PUBLIC_RATE_TIME_RANGE_MINUTES || '60', 10)
    },
    /**
     * Registered user rate limit (requests per window per user).
     *
     * Applied to authenticated free-tier users. Default: 100 requests per hour.
     *
     * @type {Object}
     * @property {number} limitPerWindow - Maximum requests allowed (default: 100)
     * @property {number} windowInMinutes - Time window in minutes (default: 60 = 1 hour)
     */
    registered: {
      limitPerWindow: parseInt(process.env.MCP_REGISTERED_RATE_LIMIT || '100', 10),
      windowInMinutes: parseInt(process.env.MCP_REGISTERED_RATE_TIME_RANGE_MINUTES || '60', 10)
    },
    /**
     * Paid user rate limit (requests per window per user).
     *
     * Applied to authenticated paid-tier users. Default: 3000 requests per day.
     *
     * @type {Object}
     * @property {number} limitPerWindow - Maximum requests allowed (default: 3000)
     * @property {number} windowInMinutes - Time window in minutes (default: 1440 = 24 hours)
     */
    paid: {
      limitPerWindow: parseInt(process.env.MCP_PAID_RATE_LIMIT || '3000', 10),
      windowInMinutes: parseInt(process.env.MCP_PAID_RATE_TIME_RANGE_MINUTES || '1440', 10)
    },
    /**
     * Private/admin rate limit (requests per window per user).
     *
     * Applied to internal/admin access. Default: 6000 requests per day.
     *
     * @type {Object}
     * @property {number} limitPerWindow - Maximum requests allowed (default: 6000)
     * @property {number} windowInMinutes - Time window in minutes (default: 1440 = 24 hours)
     */
    private: {
      limitPerWindow: parseInt(process.env.MCP_PRIVATE_RATE_LIMIT || '6000', 10),
      windowInMinutes: parseInt(process.env.MCP_PRIVATE_RATE_TIME_RANGE_MINUTES || '1440', 10)
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

  // Documentation AI: warn (never throw) when enabled without a usable vector store.
  // Semantic search falls back to keyword search when its store is not configured.
  const docAi = settings.documentation.ai;
  if (docAi.enabled) {
    if (docAi.vectorStore === 's3-vectors' && (docAi.s3Vectors.bucket === '' || docAi.s3Vectors.index === '')) {
      warnings.push('DOC_AI_ENABLED is true with s3-vectors store but DOC_AI_S3_VECTOR_BUCKET/DOC_AI_S3_VECTOR_INDEX are not set - semantic search will fall back to keyword');
    }
    if (docAi.vectorStore === 'dynamodb' && settings.docIndexTable === '') {
      warnings.push('DOC_AI_ENABLED is true with dynamodb store but DOC_INDEX_TABLE is not set - semantic search will fall back to keyword');
    }
  }

  if (warnings.length > 0) {
    DebugAndLog.warn('Configuration warnings:');
    warnings.forEach(warning => DebugAndLog.warn(`  - ${warning}`));
  }
}

// Validate settings on module load
validateSettings();

module.exports = settings;
