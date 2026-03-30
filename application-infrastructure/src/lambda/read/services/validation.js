/**
 * Validation Service
 *
 * Provides business logic for AWS resource naming validation.
 * Validates resource names against Atlantis naming conventions:
 * - Application resources: <Prefix>-<ProjectId>-<StageId>-<ResourceSuffix>
 * - Shared application resources: <Prefix>-<ProjectId>-<ResourceSuffix>
 * - S3 buckets (Pattern 1 Regional): [<OrgPrefix>-]<Prefix>-<ProjectId>[-<StageId>][-<ResourceName>]-<AccountId>-<Region>-an
 * - S3 buckets (Pattern 2 Global):   [<OrgPrefix>-]<Prefix>-<ProjectId>[-<StageId>][-<ResourceName>]-<AccountId>-<Region>
 * - S3 buckets (Pattern 3 Simple):   [<OrgPrefix>-]<Prefix>-<ProjectId>[-<StageId>][-<ResourceName>]
 *
 * Supports disambiguation parameters (prefix, projectId, stageId, orgPrefix)
 * for accurate parsing of resource names with hyphenated components.
 * Caller-provided values take precedence over environment config defaults.
 *
 * This service does NOT use caching as it performs pure validation logic
 * without external data access.
 *
 * @module services/validation
 */

const { Config } = require('../config');
const NamingRules = require('../utils/naming-rules');
const { tools: { DebugAndLog, AWS } } = require('@63klabs/cache-data');

/**
 * Validate resource name against Atlantis naming conventions
 *
 * Automatically detects resource type from name pattern and validates
 * against appropriate naming rules. Verifies components against
 * template.yaml configuration (Prefix, ProjectId, StageId).
 *
 * @param {Object} options - Validation options
 * @param {string} options.resourceName - Resource name to validate (required)
 * @param {string} [options.resourceType] - Resource type (s3, dynamodb, lambda, cloudformation, application) - auto-detected if not provided
 * @param {boolean} [options.isShared=false] - When true, validates as a shared resource without a StageId component
 * @param {boolean} [options.hasOrgPrefix] - When true, indicates the S3 bucket name includes an organization prefix for disambiguation
 * @param {string} [options.prefix] - Known Prefix value for disambiguation of hyphenated components (overrides environment config)
 * @param {string} [options.projectId] - Known ProjectId value for disambiguation of hyphenated components (overrides environment config)
 * @param {string} [options.stageId] - Known StageId value for disambiguation of hyphenated components (overrides environment config)
 * @param {string} [options.orgPrefix] - Known OrgPrefix value for disambiguation of hyphenated S3 bucket components
 * @param {boolean} [options.partial=false] - Allow partial name validation (e.g., just Prefix-ProjectId)
 * @returns {Promise<Object>} Validation result with errors, suggestions, and parsed components
 *
 * Returned object structure:
 * {
 *   valid: boolean,
 *   resourceType: string,
 *   components: {
 *     prefix?: string,
 *     projectId?: string,
 *     stageId?: string,
 *     resourceName?: string,
 *     orgPrefix?: string,
 *     region?: string,
 *     accountId?: string
 *   },
 *   errors: Array<string>,
 *   suggestions: Array<string>,
 *   pattern?: string  // For S3 buckets: 'pattern1', 'pattern2', or 'pattern3'
 * }
 *
 * @example
 * // Validate application resource name
 * const result = await Validation.validateNaming({
 *   resourceName: 'acme-myapp-prod-GetUserFunction'
 * });
 * // Returns: { valid: true, resourceType: 'application', components: {...}, errors: [], suggestions: [] }
 *
 * @example
 * // Validate S3 bucket name (Pattern 1 regional with -an suffix)
 * const result = await Validation.validateNaming({
 *   resourceName: 'acme-myapp-prod-123456789012-us-east-1-an',
 *   resourceType: 's3'
 * });
 *
 * @example
 * // Validate with disambiguation for hyphenated components
 * const result = await Validation.validateNaming({
 *   resourceName: 'my-org-person-api-prod-GetPersonFunction',
 *   prefix: 'my-org',
 *   projectId: 'person-api'
 * });
 *
 * @example
 * // Validate partial name
 * const result = await Validation.validateNaming({
 *   resourceName: 'acme-myapp',
 *   partial: true
 * });
 */
async function validateNaming(options = {}) {
  const {
    resourceName,
    resourceType,
    isShared = false,
    hasOrgPrefix,
    prefix,
    projectId,
    stageId,
    orgPrefix,
    partial = false
  } = options;

  // Validate input
  if (!resourceName || typeof resourceName !== 'string') {
    return {
      valid: false,
      resourceType: null,
      components: {},
      errors: ['Resource name is required and must be a string'],
      suggestions: ['Provide a valid resource name to validate']
    };
  }

  DebugAndLog.debug('Validating resource name', {
    resourceName,
    resourceType,
    isShared,
    hasOrgPrefix,
    prefix: prefix || '(not provided)',
    projectId: projectId || '(not provided)',
    stageId: stageId || '(not provided)',
    orgPrefix: orgPrefix || '(not provided)',
    partial
  });

  // Detect resource type if not provided
  let detectedType = resourceType;
  if (!detectedType) {
    detectedType = NamingRules.detectResourceType(resourceName);

    if (!detectedType) {
      // Default to 'application' if detection fails
      detectedType = 'application';
      DebugAndLog.debug('Could not auto-detect resource type, defaulting to application', {
        resourceName
      });
    } else {
      DebugAndLog.debug('Auto-detected resource type', {
        resourceName,
        detectedType
      });
    }
  }

  // Get configuration values from settings
  // Caller-provided values take precedence over environment config defaults
  const settings = Config.settings();
  const config = {
    prefix: prefix || settings.naming.parameters.prefix,
    projectId: projectId || settings.naming.parameters.projectId,
    stageId: stageId || settings.naming.parameters.stageId,
    orgPrefix,
    isShared,
    hasOrgPrefix
  };

  // Add AWS region and account ID for S3 validation
  if (detectedType === 's3') {
    config.region = AWS.REGION;
    // Account ID would come from AWS STS in production, but we don't validate it strictly
  }

  DebugAndLog.debug('Using configuration for validation', {
    prefix: config.prefix || '(not set)',
    projectId: config.projectId || '(not set)',
    stageId: config.stageId || '(not set)',
    orgPrefix: config.orgPrefix || '(not set)',
    isShared: config.isShared,
    hasOrgPrefix: config.hasOrgPrefix !== undefined ? config.hasOrgPrefix : '(auto)'
  });

  // Validate using naming rules utility
  const result = NamingRules.validateNaming(resourceName, {
    resourceType: detectedType,
    config,
    partial
  });

  DebugAndLog.debug('Validation result', {
    resourceName,
    valid: result.valid,
    errorCount: result.errors.length,
    suggestionCount: result.suggestions.length
  });

  return result;
}

module.exports = {
  validateNaming
};
