/**
 * Validation Service
 * 
 * Provides business logic for AWS resource naming validation.
 * Validates resource names against Atlantis naming conventions:
 * - Application resources: <Prefix>-<ProjectId>-<StageId>-<ResourceName>
 * - S3 buckets: <orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>
 * - S3 buckets (alt): <orgPrefix>-<Prefix>-<ProjectId>-<Region>
 * 
 * This service does NOT use caching as it performs pure validation logic
 * without external data access.
 * 
 * @module services/validation
 */

const Config = require('../config');
const NamingRules = require('../utils/naming-rules');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

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
 *   pattern?: string  // For S3 buckets: 'pattern1' or 'pattern2'
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
 * // Validate S3 bucket name
 * const result = await Validation.validateNaming({
 *   resourceName: '63k-acme-myapp-prod-us-east-1-123456789012',
 *   resourceType: 's3'
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
  const { resourceName, resourceType, partial = false } = options;

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
  const settings = Config.settings();
  const config = {
    prefix: settings.naming.parameters.prefix,
    projectId: settings.naming.parameters.projectId,
    stageId: settings.naming.parameters.stageId,
    allowedStageIds: ['test', 'beta', 'stage', 'prod']
  };

  // Add AWS region and account ID for S3 validation
  if (detectedType === 's3') {
    config.region = settings.aws.region;
    // Account ID would come from AWS STS in production, but we don't validate it strictly
  }

  DebugAndLog.debug('Using configuration for validation', {
    prefix: config.prefix || '(not set)',
    projectId: config.projectId || '(not set)',
    stageId: config.stageId || '(not set)',
    allowedStageIds: config.allowedStageIds
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
