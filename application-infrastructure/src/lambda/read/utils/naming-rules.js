/**
 * Naming Rules Utility
 *
 * Validates AWS resource names against Atlantis naming conventions.
 *
 * Application Resource Pattern: Prefix-ProjectId-StageId-ResourceSuffix
 * Shared Application Pattern:   Prefix-ProjectId-ResourceSuffix (isShared=true)
 * S3 Bucket Pattern 1: [OrgPrefix-]Prefix-ProjectId-StageId-Region-AccountId
 * S3 Bucket Pattern 2: [OrgPrefix-]Prefix-ProjectId-Region-AccountId (shared)
 * S3 Bucket Pattern 3: [OrgPrefix-]Prefix-ProjectId-StageId-ResourceSuffix (not preferred)
 *
 * @module naming-rules
 */

/**
 * Regex pattern for valid StageId values.
 * StageId must start with t, b, s, or p followed by zero or more lowercase alphanumeric characters.
 *
 * @constant {RegExp}
 */
const STAGE_ID_PATTERN = /^[tbsp][a-z0-9]*$/;

/**
 * Check whether a StageId string is valid.
 *
 * @param {string} stageId - Stage identifier to validate
 * @returns {boolean} True when the StageId matches the pattern
 * @example
 * isValidStageId('test');  // true
 * isValidStageId('tjoe');  // true
 * isValidStageId('xyz');   // false
 */
function isValidStageId(stageId) {
  return STAGE_ID_PATTERN.test(stageId);
}

/**
 * Check a ResourceSuffix for PascalCase conformance and return warning strings.
 *
 * Warnings are advisory only and do not cause validation failure.
 *
 * @param {string} resourceSuffix - The resource suffix to check
 * @returns {string[]} Array of warning messages (empty when PascalCase is correct)
 * @example
 * checkPascalCase('GetPersonFunction'); // []
 * checkPascalCase('getPersonFunction'); // ['ResourceSuffix \'getPersonFunction\' should start with an uppercase letter (PascalCase)']
 * checkPascalCase('APIGateway');        // ['ResourceSuffix \'APIGateway\' contains consecutive uppercase letters...']
 */
function checkPascalCase(resourceSuffix) {
  const warnings = [];
  if (resourceSuffix && !/^[A-Z]/.test(resourceSuffix)) {
    warnings.push(`ResourceSuffix '${resourceSuffix}' should start with an uppercase letter (PascalCase)`);
  }
  if (resourceSuffix && /[A-Z]{2,}/.test(resourceSuffix)) {
    warnings.push(`ResourceSuffix '${resourceSuffix}' contains consecutive uppercase letters. Only the first letter of acronyms should be capitalized (e.g., 'Api' not 'API', 'Mcp' not 'MCP')`);
  }
  return warnings;
}

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
 * Validate application resource name.
 *
 * Standard pattern: Prefix-ProjectId-StageId-ResourceSuffix
 * Shared pattern:   Prefix-ProjectId-ResourceSuffix (when isShared=true)
 *
 * @param {string} name - Resource name to validate
 * @param {Object} options - Validation options
 * @param {string} [options.resourceType='lambda'] - AWS resource type (lambda, dynamodb, cloudformation)
 * @param {string} [options.prefix] - Expected prefix value
 * @param {string} [options.projectId] - Expected project ID value
 * @param {string} [options.stageId] - Expected stage ID value
 * @param {boolean} [options.isShared=false] - If true, accept 3-component names without StageId
 * @param {boolean} [options.partial=false] - Allow partial name validation
 * @returns {{valid: boolean, errors: Array<string>, suggestions: Array<string>, components: Object}}
 */
function validateApplicationResource(name, options = {}) {
  const {
    resourceType = 'lambda',
    prefix,
    projectId,
    stageId,
    isShared = false,
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

  const minParts = isShared ? 3 : 4;
  const formatLabel = isShared
    ? 'Prefix-ProjectId-ResourceSuffix'
    : 'Prefix-ProjectId-StageId-ResourceSuffix';

  // Minimum parts required (unless partial)
  if (!partial && parts.length < minParts) {
    errors.push(`Application resource name must have at least ${minParts} components: ${formatLabel}`);
    if (isShared) {
      suggestions.push(`Expected format: ${prefix || 'prefix'}-${projectId || 'projectid'}-ResourceSuffix`);
    } else {
      suggestions.push(`Expected format: ${prefix || 'prefix'}-${projectId || 'projectid'}-${stageId || 'stageid'}-ResourceSuffix`);
    }
    return { valid: false, errors, suggestions, components };
  }

  // Extract components based on isShared
  if (isShared) {
    if (parts.length >= 1) components.prefix = parts[0];
    if (parts.length >= 2) components.projectId = parts[1];
    if (parts.length >= 3) components.resourceSuffix = parts.slice(2).join('-');
  } else {
    if (parts.length >= 1) components.prefix = parts[0];
    if (parts.length >= 2) components.projectId = parts[1];
    if (parts.length >= 3) components.stageId = parts[2];
    if (parts.length >= 4) components.resourceSuffix = parts.slice(3).join('-');
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

  // Validate StageId (only when not shared)
  if (!isShared && components.stageId) {
    if (!isValidStageId(components.stageId)) {
      errors.push(`StageId '${components.stageId}' is invalid. Must start with t, b, s, or p followed by lowercase alphanumeric characters`);
      suggestions.push('StageId must match pattern: starts with t, b, s, or p (e.g., test, tjoe, beta, prod)');
    }
    if (stageId && components.stageId !== stageId) {
      errors.push(`StageId '${components.stageId}' does not match expected value '${stageId}'`);
      suggestions.push(`Use stage ID: ${stageId}`);
    }
  }

  // Validate ResourceSuffix (if not partial)
  if (!partial && components.resourceSuffix) {
    // PascalCase warnings (advisory only)
    const pascalWarnings = checkPascalCase(components.resourceSuffix);
    suggestions.push(...pascalWarnings);

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
  } else if (!partial && !components.resourceSuffix) {
    errors.push('ResourceSuffix component is required');
    suggestions.push('Add a resource suffix after ' + (isShared ? 'ProjectId' : 'StageId') + ' (e.g., MyFunction, MyTable)');
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions,
    components
  };
}

/**
 * Validate S3 bucket name against Atlantis naming conventions.
 *
 * Pattern 1: [OrgPrefix-]Prefix-ProjectId-StageId-Region-AccountId
 * Pattern 2: [OrgPrefix-]Prefix-ProjectId-Region-AccountId          (shared, no StageId)
 * Pattern 3: [OrgPrefix-]Prefix-ProjectId-StageId-ResourceSuffix    (not preferred)
 *
 * Region detection uses a regex scan so that multi-hyphen regions like us-east-1
 * are handled correctly instead of naive hyphen splitting.
 *
 * @param {string} name - S3 bucket name to validate
 * @param {Object} options - Validation options
 * @param {string} [options.orgPrefix] - Expected organization prefix
 * @param {string} [options.prefix] - Expected prefix value
 * @param {string} [options.projectId] - Expected project ID value
 * @param {string} [options.stageId] - Expected stage ID value
 * @param {string} [options.region] - Expected AWS region
 * @param {string} [options.accountId] - Expected AWS account ID
 * @param {boolean} [options.isShared=false] - If true, accept names without StageId
 * @param {boolean} [options.hasOrgPrefix] - Disambiguate whether an OrgPrefix is present
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
    isShared = false,
    hasOrgPrefix,
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

  // --- Region-aware parsing ---
  // Locate an AWS region pattern (e.g. us-east-1) within the bucket name.
  const regionRegex = /([a-z]{2})-([a-z]+)-(\d+)/;
  const regionMatch = name.match(regionRegex);

  if (regionMatch) {
    const regionStr = regionMatch[0]; // e.g. "us-east-1"
    const regionStartIdx = regionMatch.index;

    // Everything before the region (strip trailing hyphen)
    const beforeRegion = name.substring(0, regionStartIdx > 0 ? regionStartIdx - 1 : 0);
    const beforeSegments = beforeRegion ? beforeRegion.split('-') : [];

    // Everything after the region
    const afterRegion = name.substring(regionStartIdx + regionStr.length);
    const afterParts = afterRegion.startsWith('-') ? afterRegion.substring(1) : afterRegion;
    const detectedAccountId = afterParts || undefined;

    components.region = regionStr;
    if (detectedAccountId) {
      components.accountId = detectedAccountId;
    }

    // Determine pattern based on segment count, isShared, and hasOrgPrefix
    const segCount = beforeSegments.length;

    if (segCount === 4) {
      // OrgPrefix-Prefix-ProjectId-StageId  → pattern1 with OrgPrefix
      detectedPattern = 'pattern1';
      components.orgPrefix = beforeSegments[0];
      components.prefix = beforeSegments[1];
      components.projectId = beforeSegments[2];
      components.stageId = beforeSegments[3];
    } else if (segCount === 3) {
      // Ambiguous: could be pattern1 without OrgPrefix OR pattern2 with OrgPrefix
      if (hasOrgPrefix === true || (hasOrgPrefix === undefined && isShared)) {
        // OrgPrefix-Prefix-ProjectId → pattern2 with OrgPrefix (shared)
        detectedPattern = 'pattern2';
        components.orgPrefix = beforeSegments[0];
        components.prefix = beforeSegments[1];
        components.projectId = beforeSegments[2];
      } else {
        // Prefix-ProjectId-StageId → pattern1 without OrgPrefix
        detectedPattern = 'pattern1';
        components.prefix = beforeSegments[0];
        components.projectId = beforeSegments[1];
        components.stageId = beforeSegments[2];
      }
    } else if (segCount === 2) {
      // Prefix-ProjectId → pattern2 without OrgPrefix (shared)
      detectedPattern = 'pattern2';
      components.prefix = beforeSegments[0];
      components.projectId = beforeSegments[1];
    } else if (!partial) {
      errors.push('S3 bucket name does not match expected patterns');
      suggestions.push('Pattern 1: [OrgPrefix-]Prefix-ProjectId-StageId-Region-AccountId');
      suggestions.push('Pattern 2: [OrgPrefix-]Prefix-ProjectId-Region-AccountId');
    }
  } else {
    // No region found — try pattern3: [OrgPrefix-]Prefix-ProjectId-StageId-ResourceSuffix
    const parts = name.split('-');

    if (parts.length >= 4) {
      detectedPattern = 'pattern3';

      if (hasOrgPrefix === true && parts.length >= 5) {
        components.orgPrefix = parts[0];
        components.prefix = parts[1];
        components.projectId = parts[2];
        components.stageId = parts[3];
        components.resourceSuffix = parts.slice(4).join('-');
      } else {
        components.prefix = parts[0];
        components.projectId = parts[1];
        components.stageId = parts[2];
        components.resourceSuffix = parts.slice(3).join('-');
      }

      suggestions.push('Consider using the preferred S3 naming pattern with Region-AccountId suffix instead of ResourceSuffix');
    } else if (!partial) {
      errors.push('S3 bucket name does not match expected patterns');
      suggestions.push('Pattern 1: [OrgPrefix-]Prefix-ProjectId-StageId-Region-AccountId');
      suggestions.push('Pattern 2: [OrgPrefix-]Prefix-ProjectId-Region-AccountId');
      suggestions.push('Pattern 3: [OrgPrefix-]Prefix-ProjectId-StageId-ResourceSuffix');
      return { valid: false, errors, suggestions, components, pattern: null };
    }
  }

  // --- Component validation ---
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
    if (!isValidStageId(components.stageId)) {
      errors.push(`StageId '${components.stageId}' is invalid. Must start with t, b, s, or p followed by lowercase alphanumeric characters`);
      suggestions.push('StageId must match pattern: starts with t, b, s, or p (e.g., test, tjoe, beta, prod)');
    }
    if (stageId && components.stageId !== stageId) {
      errors.push(`StageId '${components.stageId}' does not match expected value '${stageId}'`);
      suggestions.push(`Use stage ID: ${stageId}`);
    }
  }

  if (components.region) {
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
 * Validate resource name based on resource type.
 *
 * Routes to the appropriate validator (S3 or application) and threads
 * isShared and hasOrgPrefix through to the underlying functions.
 *
 * @param {string} name - Resource name to validate
 * @param {Object} options - Validation options
 * @param {string} options.resourceType - Resource type (s3, dynamodb, lambda, cloudformation, application)
 * @param {Object} [options.config] - Configuration values (prefix, projectId, stageId, isShared, hasOrgPrefix, etc.)
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

  // Route to appropriate validator, threading isShared and hasOrgPrefix
  if (normalizedType === 's3') {
    const result = validateS3Bucket(name, {
      ...config,
      isShared: config.isShared,
      hasOrgPrefix: config.hasOrgPrefix,
      partial
    });
    return { ...result, resourceType: 's3' };
  } else if (['dynamodb', 'lambda', 'cloudformation', 'application'].includes(normalizedType)) {
    const result = validateApplicationResource(name, {
      resourceType: normalizedType === 'application' ? 'lambda' : normalizedType,
      ...config,
      isShared: config.isShared,
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
 * Auto-detect resource type from name pattern.
 *
 * S3 detection: all-lowercase name containing an AWS region pattern.
 * Application detection: 4+ hyphen-separated components where the third
 * component matches the flexible StageId pattern (starts with t, b, s, or p).
 *
 * @param {string} name - Resource name
 * @returns {string|null} Detected resource type or null
 */
function detectResourceType(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }

  // S3 buckets are lowercase and contain a region pattern
  if (name === name.toLowerCase() && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
    // Check if the name contains an AWS region pattern anywhere
    if (/([a-z]{2})-([a-z]+)-(\d+)/.test(name)) {
      return 's3';
    }
  }

  // Application resources follow Prefix-ProjectId-StageId-ResourceSuffix pattern
  const parts = name.split('-');
  if (parts.length >= 4) {
    const potentialStageId = parts[2].toLowerCase();
    if (isValidStageId(potentialStageId)) {
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
  isValidStageId,
  checkPascalCase,
  AWS_NAMING_RULES
};
