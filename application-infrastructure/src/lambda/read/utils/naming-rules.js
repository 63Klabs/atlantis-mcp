/**
 * Naming Rules Utility
 *
 * Validates AWS resource names against Atlantis naming conventions.
 *
 * Application Resource Pattern: <Prefix>-<ProjectId>-<StageId>-<ResourceName>
 * S3 Bucket Pattern 1: <orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>
 * S3 Bucket Pattern 2: <orgPrefix>-<Prefix>-<ProjectId>-<Region>
 *
 * @module naming-rules
 */

/**
 * AWS resource naming rules by service
 */
const AWS_NAMING_RULES = {
  s3: {
    minLength: 3,
    maxLength: 63,
    pattern: /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
    disallowed: ['..', '.-', '-.'],
    description: 'S3 bucket names must be 3-63 characters, lowercase alphanumeric with dots and hyphens, cannot start/end with dot or hyphen, no consecutive dots'
  },
  dynamodb: {
    minLength: 3,
    maxLength: 255,
    pattern: /^[a-zA-Z0-9_.-]+$/,
    description: 'DynamoDB table names must be 3-255 characters, alphanumeric with underscore, dot, and hyphen'
  },
  lambda: {
    minLength: 1,
    maxLength: 64,
    pattern: /^[a-zA-Z0-9-_]+$/,
    description: 'Lambda function names must be 1-64 characters, alphanumeric with hyphen and underscore'
  },
  cloudformation: {
    minLength: 1,
    maxLength: 128,
    pattern: /^[a-zA-Z][a-zA-Z0-9-]*$/,
    description: 'CloudFormation stack names must be 1-128 characters, start with letter, alphanumeric with hyphen'
  }
};

/**
 * Validate application resource name
 * Pattern: <Prefix>-<ProjectId>-<StageId>-<ResourceName>
 *
 * @param {string} name - Resource name to validate
 * @param {Object} options - Validation options
 * @param {string} [options.resourceType='lambda'] - AWS resource type (lambda, dynamodb, cloudformation)
 * @param {string} [options.prefix] - Expected prefix value
 * @param {string} [options.projectId] - Expected project ID value
 * @param {string} [options.stageId] - Expected stage ID value
 * @param {Array<string>} [options.allowedStageIds] - Allowed stage ID values
 * @param {boolean} [options.partial=false] - Allow partial name validation
 * @returns {{valid: boolean, errors: Array<string>, suggestions: Array<string>, components: Object}}
 */
function validateApplicationResource(name, options = {}) {
  const {
    resourceType = 'lambda',
    prefix,
    projectId,
    stageId,
    allowedStageIds = ['test', 'beta', 'stage', 'prod'],
    partial = false
  } = options;

  const errors = [];
  const suggestions = [];
  const components = {};

  // Check if name is provided
  if (!name || typeof name !== 'string') {
    errors.push('Resource name is required and must be a string');
    return { valid: false, errors, suggestions, components };
  }

  // Split name into components
  const parts = name.split('-');

  // Minimum parts required (unless partial)
  if (!partial && parts.length < 4) {
    errors.push('Application resource name must have at least 4 components: Prefix-ProjectId-StageId-ResourceName');
    suggestions.push(`Expected format: ${prefix || 'prefix'}-${projectId || 'projectid'}-${stageId || 'stageid'}-ResourceName`);
    return { valid: false, errors, suggestions, components };
  }

  // Extract components
  if (parts.length >= 1) {
    components.prefix = parts[0];
  }
  if (parts.length >= 2) {
    components.projectId = parts[1];
  }
  if (parts.length >= 3) {
    components.stageId = parts[2];
  }
  if (parts.length >= 4) {
    components.resourceName = parts.slice(3).join('-');
  }

  // Validate Prefix
  if (components.prefix) {
    if (!/^[a-z0-9]+$/i.test(components.prefix)) {
      errors.push('Prefix must contain only alphanumeric characters');
      suggestions.push(`Use alphanumeric characters only for prefix (e.g., ${components.prefix.replace(/[^a-z0-9]/gi, '')})`);
    }
    if (prefix && components.prefix !== prefix) {
      errors.push(`Prefix '${components.prefix}' does not match expected value '${prefix}'`);
      suggestions.push(`Use prefix: ${prefix}`);
    }
  }

  // Validate ProjectId
  if (components.projectId) {
    if (!/^[a-z0-9]+$/i.test(components.projectId)) {
      errors.push('ProjectId must contain only alphanumeric characters');
      suggestions.push(`Use alphanumeric characters only for project ID (e.g., ${components.projectId.replace(/[^a-z0-9]/gi, '')})`);
    }
    if (projectId && components.projectId !== projectId) {
      errors.push(`ProjectId '${components.projectId}' does not match expected value '${projectId}'`);
      suggestions.push(`Use project ID: ${projectId}`);
    }
  }

  // Validate StageId
  if (components.stageId) {
    if (!/^[a-z0-9]+$/i.test(components.stageId)) {
      errors.push('StageId must contain only alphanumeric characters');
      suggestions.push(`Use alphanumeric characters only for stage ID (e.g., ${components.stageId.replace(/[^a-z0-9]/gi, '')})`);
    }
    if (!allowedStageIds.includes(components.stageId.toLowerCase())) {
      errors.push(`StageId '${components.stageId}' is not in allowed values: ${allowedStageIds.join(', ')}`);
      suggestions.push(`Use one of: ${allowedStageIds.join(', ')}`);
    }
    if (stageId && components.stageId !== stageId) {
      errors.push(`StageId '${components.stageId}' does not match expected value '${stageId}'`);
      suggestions.push(`Use stage ID: ${stageId}`);
    }
  }

  // Validate ResourceName (if not partial)
  if (!partial && components.resourceName) {
    const rules = AWS_NAMING_RULES[resourceType];
    if (rules) {
      // Check length
      const fullName = name;
      if (fullName.length < rules.minLength) {
        errors.push(`Resource name is too short (minimum ${rules.minLength} characters for ${resourceType})`);
      }
      if (fullName.length > rules.maxLength) {
        errors.push(`Resource name is too long (maximum ${rules.maxLength} characters for ${resourceType})`);
        suggestions.push(`Shorten resource name to ${rules.maxLength} characters or less`);
      }

      // Check pattern
      if (!rules.pattern.test(fullName)) {
        errors.push(`Resource name does not match ${resourceType} naming rules: ${rules.description}`);
      }

      // Check disallowed patterns (for S3)
      if (rules.disallowed) {
        for (const disallowed of rules.disallowed) {
          if (fullName.includes(disallowed)) {
            errors.push(`Resource name contains disallowed pattern '${disallowed}' for ${resourceType}`);
          }
        }
      }
    }
  } else if (!partial && !components.resourceName) {
    errors.push('ResourceName component is required');
    suggestions.push('Add a resource name after StageId (e.g., MyFunction, MyTable)');
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions,
    components
  };
}

/**
 * Validate S3 bucket name
 * Pattern 1: <orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>
 * Pattern 2: <orgPrefix>-<Prefix>-<ProjectId>-<Region>
 *
 * @param {string} name - S3 bucket name to validate
 * @param {Object} options - Validation options
 * @param {string} [options.orgPrefix] - Expected organization prefix
 * @param {string} [options.prefix] - Expected prefix value
 * @param {string} [options.projectId] - Expected project ID value
 * @param {string} [options.stageId] - Expected stage ID value (optional for high-level templates)
 * @param {string} [options.region] - Expected AWS region
 * @param {string} [options.accountId] - Expected AWS account ID
 * @param {boolean} [options.partial=false] - Allow partial name validation
 * @returns {{valid: boolean, errors: Array<string>, suggestions: Array<string>, components: Object, pattern: string}}
 */
function validateS3Bucket(name, options = {}) {
  const {
    orgPrefix,
    prefix,
    projectId,
    stageId,
    region,
    accountId,
    partial = false
  } = options;

  const errors = [];
  const suggestions = [];
  const components = {};
  let detectedPattern = null;

  // Check if name is provided
  if (!name || typeof name !== 'string') {
    errors.push('S3 bucket name is required and must be a string');
    return { valid: false, errors, suggestions, components, pattern: null };
  }

  // Basic S3 naming rules
  const rules = AWS_NAMING_RULES.s3;

  // Check length
  if (name.length < rules.minLength) {
    errors.push(`S3 bucket name is too short (minimum ${rules.minLength} characters)`);
  }
  if (name.length > rules.maxLength) {
    errors.push(`S3 bucket name is too long (maximum ${rules.maxLength} characters)`);
    suggestions.push(`Shorten bucket name to ${rules.maxLength} characters or less`);
  }

  // Check pattern
  if (!rules.pattern.test(name)) {
    errors.push(`S3 bucket name does not match S3 naming rules: ${rules.description}`);
    suggestions.push('Use lowercase letters, numbers, dots, and hyphens only');
  }

  // Check disallowed patterns
  for (const disallowed of rules.disallowed) {
    if (name.includes(disallowed)) {
      errors.push(`S3 bucket name contains disallowed pattern '${disallowed}'`);
      suggestions.push(`Remove '${disallowed}' from bucket name`);
    }
  }

  // Check if name starts/ends with dot or hyphen
  if (name.startsWith('.') || name.startsWith('-')) {
    errors.push('S3 bucket name cannot start with dot or hyphen');
  }
  if (name.endsWith('.') || name.endsWith('-')) {
    errors.push('S3 bucket name cannot end with dot or hyphen');
  }

  // Split name into components
  const parts = name.split('-');

  // Try to detect pattern
  if (parts.length >= 6) {
    // Pattern 1: <orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>
    detectedPattern = 'pattern1';
    components.orgPrefix = parts[0];
    components.prefix = parts[1];
    components.projectId = parts[2];
    components.stageId = parts[3];
    components.region = parts[4];
    components.accountId = parts[5];
  } else if (parts.length >= 4) {
    // Pattern 2: <orgPrefix>-<Prefix>-<ProjectId>-<Region>
    detectedPattern = 'pattern2';
    components.orgPrefix = parts[0];
    components.prefix = parts[1];
    components.projectId = parts[2];
    components.region = parts[3];
  } else if (!partial) {
    errors.push('S3 bucket name does not match expected patterns');
    suggestions.push('Pattern 1: <orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>');
    suggestions.push('Pattern 2: <orgPrefix>-<Prefix>-<ProjectId>-<Region>');
    return { valid: false, errors, suggestions, components, pattern: null };
  }

  // Validate components
  if (components.orgPrefix && orgPrefix && components.orgPrefix !== orgPrefix) {
    errors.push(`Organization prefix '${components.orgPrefix}' does not match expected value '${orgPrefix}'`);
    suggestions.push(`Use organization prefix: ${orgPrefix}`);
  }

  if (components.prefix) {
    if (!/^[a-z0-9]+$/.test(components.prefix)) {
      errors.push('Prefix must contain only lowercase alphanumeric characters');
    }
    if (prefix && components.prefix !== prefix) {
      errors.push(`Prefix '${components.prefix}' does not match expected value '${prefix}'`);
      suggestions.push(`Use prefix: ${prefix}`);
    }
  }

  if (components.projectId) {
    if (!/^[a-z0-9]+$/.test(components.projectId)) {
      errors.push('ProjectId must contain only lowercase alphanumeric characters');
    }
    if (projectId && components.projectId !== projectId) {
      errors.push(`ProjectId '${components.projectId}' does not match expected value '${projectId}'`);
      suggestions.push(`Use project ID: ${projectId}`);
    }
  }

  if (components.stageId) {
    if (!/^[a-z0-9]+$/.test(components.stageId)) {
      errors.push('StageId must contain only lowercase alphanumeric characters');
    }
    if (stageId && components.stageId !== stageId) {
      errors.push(`StageId '${components.stageId}' does not match expected value '${stageId}'`);
      suggestions.push(`Use stage ID: ${stageId}`);
    }
  }

  if (components.region) {
    // Validate AWS region format
    if (!/^[a-z]{2}-[a-z]+-\d+$/.test(components.region)) {
      errors.push(`Region '${components.region}' does not match AWS region format (e.g., us-east-1)`);
      suggestions.push('Use valid AWS region format (e.g., us-east-1, eu-west-1)');
    }
    if (region && components.region !== region) {
      errors.push(`Region '${components.region}' does not match expected value '${region}'`);
      suggestions.push(`Use region: ${region}`);
    }
  }

  if (components.accountId) {
    // Validate AWS account ID (12 digits)
    if (!/^\d{12}$/.test(components.accountId)) {
      errors.push(`Account ID '${components.accountId}' must be exactly 12 digits`);
      suggestions.push('Use 12-digit AWS account ID');
    }
    if (accountId && components.accountId !== accountId) {
      errors.push(`Account ID '${components.accountId}' does not match expected value '${accountId}'`);
      suggestions.push(`Use account ID: ${accountId}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions,
    components,
    pattern: detectedPattern
  };
}

/**
 * Validate resource name based on resource type
 *
 * @param {string} name - Resource name to validate
 * @param {Object} options - Validation options
 * @param {string} options.resourceType - Resource type (s3, dynamodb, lambda, cloudformation, application)
 * @param {Object} [options.config] - Configuration values (prefix, projectId, stageId, etc.)
 * @param {boolean} [options.partial=false] - Allow partial name validation
 * @returns {{valid: boolean, errors: Array<string>, suggestions: Array<string>, components: Object, resourceType: string}}
 */
function validateNaming(name, options = {}) {
  const { resourceType, config = {}, partial = false } = options;

  if (!resourceType) {
    return {
      valid: false,
      errors: ['Resource type is required'],
      suggestions: ['Specify resourceType: s3, dynamodb, lambda, cloudformation, or application'],
      components: {},
      resourceType: null
    };
  }

  const normalizedType = resourceType.toLowerCase();

  // Route to appropriate validator
  if (normalizedType === 's3') {
    const result = validateS3Bucket(name, { ...config, partial });
    return { ...result, resourceType: 's3' };
  } else if (['dynamodb', 'lambda', 'cloudformation', 'application'].includes(normalizedType)) {
    const result = validateApplicationResource(name, {
      resourceType: normalizedType === 'application' ? 'lambda' : normalizedType,
      ...config,
      partial
    });
    return { ...result, resourceType: normalizedType };
  } else {
    return {
      valid: false,
      errors: [`Unknown resource type: ${resourceType}`],
      suggestions: ['Use one of: s3, dynamodb, lambda, cloudformation, application'],
      components: {},
      resourceType: null
    };
  }
}

/**
 * Auto-detect resource type from name pattern
 *
 * @param {string} name - Resource name
 * @returns {string|null} Detected resource type or null
 */
function detectResourceType(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }

  // S3 buckets are lowercase with specific patterns
  if (name === name.toLowerCase() && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
    const parts = name.split('-');
    // S3 buckets typically have more components and include region
    if (parts.length >= 4 && parts.some(p => /^[a-z]{2}-[a-z]+-\d+$/.test(p))) {
      return 's3';
    }
  }

  // Application resources follow Prefix-ProjectId-StageId-ResourceName pattern
  const parts = name.split('-');
  if (parts.length >= 4) {
    // Check if third component looks like a stage ID
    const potentialStageId = parts[2].toLowerCase();
    if (['test', 'beta', 'stage', 'prod'].includes(potentialStageId)) {
      return 'application';
    }
  }

  return null;
}

module.exports = {
  validateApplicationResource,
  validateS3Bucket,
  validateNaming,
  detectResourceType,
  AWS_NAMING_RULES
};
