/**
 * Naming Rules Utility
 *
 * Validates AWS resource names against Atlantis naming conventions.
 * Uses anchor-based parsing to correctly handle components that contain hyphens.
 *
 * Application Resource Pattern: Prefix-ProjectId-StageId-ResourceSuffix
 * Shared Application Pattern:   Prefix-ProjectId-ResourceSuffix (isShared=true)
 *
 * S3 Bucket Pattern 1 (Regional):  [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]-AccountId-Region-an
 * S3 Bucket Pattern 2 (Global):    [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]-AccountId-Region
 * S3 Bucket Pattern 3 (Simple):    [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]
 *
 * Anchor-based parsing strategy:
 * - Known values (prefix, projectId, orgPrefix) are stripped from the left
 * - Fixed-format anchors (AccountId, Region, -an suffix) are identified from the right
 * - StageId pattern is used as a heuristic boundary when known values are absent
 * - Ambiguous names without known values return an error with disambiguation suggestion
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
 * Regex pattern for AWS region strings (e.g., us-east-1, ap-southeast-2).
 *
 * @constant {RegExp}
 */
const REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d+$/;

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
 * Validate application resource name using anchor-based parsing.
 *
 * Standard pattern: Prefix-ProjectId-StageId-ResourceSuffix
 * Shared pattern:   Prefix-ProjectId-ResourceSuffix (when isShared=true)
 *
 * Parsing strategy:
 * 1. When prefix and projectId are provided, strip them from the front to find
 *    StageId and ResourceSuffix boundaries.
 * 2. When only prefix is provided, strip prefix then use StageId pattern to
 *    find the projectId boundary.
 * 3. When no known values are provided and all hyphen-separated segments are
 *    single-segment, use StageId pattern heuristic on position 2.
 * 4. When ambiguous (hyphenated components, no known values), return an error
 *    suggesting the caller provide known values.
 *
 * @param {string} name - Resource name to validate
 * @param {Object} options - Validation options
 * @param {string} [options.resourceType='lambda'] - AWS resource type (lambda, dynamodb, cloudformation)
 * @param {string} [options.prefix] - Known prefix value (enables anchor parsing)
 * @param {string} [options.projectId] - Known projectId value (enables anchor parsing)
 * @param {string} [options.stageId] - Known stageId value
 * @param {boolean} [options.isShared=false] - If true, accept names without StageId
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

  if (!name || typeof name !== 'string') {
    errors.push('Resource name is required and must be a string');
    return { valid: false, errors, suggestions, components };
  }

  const parts = name.split('-');

  // --- Anchor-based parsing ---
  let parsed = false;

  if (prefix && projectId) {
    // Strategy 1: Both prefix and projectId known — strip from front
    const prefixDash = prefix + '-';
    const projectDash = projectId + '-';
    const expectedStart = prefixDash + projectDash;

    if (name.startsWith(expectedStart)) {
      components.prefix = prefix;
      components.projectId = projectId;
      const remainder = name.substring(expectedStart.length);

      if (isShared) {
        components.resourceSuffix = remainder || undefined;
      } else {
        // Find StageId: first hyphen-separated segment that matches StageId pattern
        const dashIdx = remainder.indexOf('-');
        if (dashIdx > 0) {
          components.stageId = remainder.substring(0, dashIdx);
          components.resourceSuffix = remainder.substring(dashIdx + 1) || undefined;
        } else if (remainder.length > 0) {
          // Only one segment left — it's the stageId with no resourceSuffix
          components.stageId = remainder;
        }
      }
      parsed = true;
    }
  }

  if (!parsed && prefix && !projectId) {
    // Strategy 2: Only prefix known — strip prefix, then find StageId boundary
    const prefixDash = prefix + '-';
    if (name.startsWith(prefixDash)) {
      components.prefix = prefix;
      const afterPrefix = name.substring(prefixDash.length);

      if (isShared) {
        // For shared: everything after prefix is projectId-resourceSuffix
        // We need at least two segments (projectId and resourceSuffix)
        const dashIdx = afterPrefix.indexOf('-');
        if (dashIdx > 0) {
          // Without projectId known, take first segment as projectId
          components.projectId = afterPrefix.substring(0, dashIdx);
          components.resourceSuffix = afterPrefix.substring(dashIdx + 1) || undefined;
        } else {
          components.projectId = afterPrefix;
        }
      } else {
        // Find StageId by scanning segments for the pattern
        const afterSegments = afterPrefix.split('-');
        let stageIdx = -1;
        for (let i = 0; i < afterSegments.length; i++) {
          if (isValidStageId(afterSegments[i])) {
            stageIdx = i;
            break;
          }
        }
        if (stageIdx > 0) {
          components.projectId = afterSegments.slice(0, stageIdx).join('-');
          components.stageId = afterSegments[stageIdx];
          if (stageIdx + 1 < afterSegments.length) {
            components.resourceSuffix = afterSegments.slice(stageIdx + 1).join('-');
          }
        } else if (stageIdx === 0 && afterSegments.length >= 2) {
          // First segment after prefix is stageId — projectId is empty, which is invalid
          components.projectId = '';
          components.stageId = afterSegments[0];
          components.resourceSuffix = afterSegments.slice(1).join('-');
        } else {
          // No StageId found — treat as ambiguous
          components.projectId = afterPrefix;
        }
      }
      parsed = true;
    }
  }

  if (!parsed) {
    // Strategy 3 & 4: No known values — use heuristic or report ambiguity
    const minParts = isShared ? 3 : 4;

    // Check if any segment contains only hyphens or if the name could be ambiguous
    // Simple heuristic: if we have exactly the right number of segments, assign positionally
    if (parts.length >= minParts) {
      // Check for potential ambiguity: if the name has more segments than expected
      // and no known values, components might contain hyphens
      if (isShared) {
        components.prefix = parts[0];
        components.projectId = parts[1];
        components.resourceSuffix = parts.slice(2).join('-');
      } else {
        // Use StageId pattern to find the boundary
        // Look for a StageId at position 2 (standard) first
        if (isValidStageId(parts[2])) {
          components.prefix = parts[0];
          components.projectId = parts[1];
          components.stageId = parts[2];
          if (parts.length >= 4) {
            components.resourceSuffix = parts.slice(3).join('-');
          }
        } else {
          // StageId not at position 2 — components likely contain hyphens
          // Try to find StageId anywhere after position 0
          let stageIdx = -1;
          for (let i = 2; i < parts.length; i++) {
            if (isValidStageId(parts[i])) {
              stageIdx = i;
              break;
            }
          }
          if (stageIdx > 0 && stageIdx + 1 < parts.length) {
            // Found a StageId but can't determine prefix/projectId boundary without known values
            errors.push('Cannot unambiguously parse resource name. Components may contain hyphens. Provide known values (prefix, projectId) for accurate parsing.');
            suggestions.push('Use the prefix, projectId, and optionally orgPrefix parameters to disambiguate hyphenated components.');
            return { valid: false, errors, suggestions, components };
          } else {
            // No valid StageId found at all
            errors.push(`StageId '${parts[2]}' is invalid. Must start with t, b, s, or p followed by lowercase alphanumeric characters`);
            suggestions.push('StageId must match pattern: starts with t, b, s, or p (e.g., test, tjoe, beta, prod)');
            // Still assign components positionally for error reporting
            components.prefix = parts[0];
            components.projectId = parts[1];
            components.stageId = parts[2];
            if (parts.length >= 4) {
              components.resourceSuffix = parts.slice(3).join('-');
            }
          }
        }
      }
      parsed = true;
    }
  }

  if (!parsed) {
    // Not enough parts
    const minParts = isShared ? 3 : 4;
    const formatLabel = isShared
      ? 'Prefix-ProjectId-ResourceSuffix'
      : 'Prefix-ProjectId-StageId-ResourceSuffix';

    if (!partial) {
      errors.push(`Application resource name must have at least ${minParts} components: ${formatLabel}`);
      if (isShared) {
        suggestions.push(`Expected format: ${prefix || 'prefix'}-${projectId || 'projectid'}-ResourceSuffix`);
      } else {
        suggestions.push(`Expected format: ${prefix || 'prefix'}-${projectId || 'projectid'}-${stageId || 'stageid'}-ResourceSuffix`);
      }
    }

    // Assign what we can
    if (parts.length >= 1) components.prefix = parts[0];
    if (parts.length >= 2) components.projectId = parts[1];
    if (!isShared && parts.length >= 3) components.stageId = parts[2];

    // Still validate assigned components even in partial mode
    if (components.prefix && !prefix && !/^[a-z0-9]+$/i.test(components.prefix)) {
      errors.push('Prefix must contain only alphanumeric characters');
      suggestions.push(`Use alphanumeric characters only for prefix (e.g., ${components.prefix.replace(/[^a-z0-9]/gi, '')})`);
    }

    return { valid: errors.length === 0, errors, suggestions, components };
  }

  // --- Component validation ---
  if (components.prefix) {
    // Only check alphanumeric format when prefix was parsed heuristically (no known value)
    if (!prefix && !/^[a-z0-9]+$/i.test(components.prefix)) {
      errors.push('Prefix must contain only alphanumeric characters');
      suggestions.push(`Use alphanumeric characters only for prefix (e.g., ${components.prefix.replace(/[^a-z0-9]/gi, '')})`);
    }
    if (prefix && components.prefix !== prefix) {
      errors.push(`Prefix '${components.prefix}' does not match expected value '${prefix}'`);
      suggestions.push(`Use prefix: ${prefix}`);
    }
  }

  if (components.projectId) {
    // Only check alphanumeric format when projectId was parsed heuristically (no known value)
    if (!prefix && !projectId && !/^[a-z0-9]+$/i.test(components.projectId)) {
      errors.push('ProjectId must contain only alphanumeric characters');
      suggestions.push(`Use alphanumeric characters only for project ID (e.g., ${components.projectId.replace(/[^a-z0-9]/gi, '')})`);
    }
    if (projectId && components.projectId !== projectId) {
      errors.push(`ProjectId '${components.projectId}' does not match expected value '${projectId}'`);
      suggestions.push(`Use project ID: ${projectId}`);
    }
  }

  if (!isShared && components.stageId) {
    if (!isValidStageId(components.stageId)) {
      // Only add if not already added above
      if (!errors.some(e => e.includes('StageId') && e.includes('invalid'))) {
        errors.push(`StageId '${components.stageId}' is invalid. Must start with t, b, s, or p followed by lowercase alphanumeric characters`);
        suggestions.push('StageId must match pattern: starts with t, b, s, or p (e.g., test, tjoe, beta, prod)');
      }
    }
    if (stageId && components.stageId !== stageId) {
      errors.push(`StageId '${components.stageId}' does not match expected value '${stageId}'`);
      suggestions.push(`Use stage ID: ${stageId}`);
    }
  }

  // Validate ResourceSuffix (if not partial)
  if (!partial && components.resourceSuffix) {
    const pascalWarnings = checkPascalCase(components.resourceSuffix);
    suggestions.push(...pascalWarnings);

    const rules = AWS_NAMING_RULES[resourceType];
    if (rules) {
      if (name.length < rules.minLength) {
        errors.push(`Resource name is too short (minimum ${rules.minLength} characters for ${resourceType})`);
      }
      if (name.length > rules.maxLength) {
        errors.push(`Resource name is too long (maximum ${rules.maxLength} characters for ${resourceType})`);
        suggestions.push(`Shorten resource name to ${rules.maxLength} characters or less`);
      }
      if (!rules.pattern.test(name)) {
        errors.push(`Resource name does not match ${resourceType} naming rules: ${rules.description}`);
      }
      if (rules.disallowed) {
        for (const disallowed of rules.disallowed) {
          if (name.includes(disallowed)) {
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
 * Try to match an AWS region pattern at a specific position in a hyphen-split array.
 * Regions are 3 hyphen-separated segments: xx-xxxxx-N (e.g., us-east-1, ap-southeast-2).
 *
 * @param {string[]} segments - Hyphen-split segments of the name
 * @param {number} startIdx - Index to start checking
 * @returns {{region: string, endIdx: number}|null} Matched region and end index, or null
 */
function matchRegionAt(segments, startIdx) {
  if (startIdx + 2 >= segments.length) return null;
  const candidate = segments[startIdx] + '-' + segments[startIdx + 1] + '-' + segments[startIdx + 2];
  if (REGION_PATTERN.test(candidate)) {
    return { region: candidate, endIdx: startIdx + 2 };
  }
  return null;
}

/**
 * Scan segments right-to-left for a region pattern.
 * Returns the region string and the index range it occupies.
 *
 * @param {string[]} segments - Hyphen-split segments
 * @returns {{region: string, startIdx: number, endIdx: number}|null}
 */
function findRegionFromRight(segments) {
  // Region occupies 3 consecutive segments. Scan from right.
  for (let i = segments.length - 3; i >= 0; i--) {
    const m = matchRegionAt(segments, i);
    if (m) {
      return { region: m.region, startIdx: i, endIdx: m.endIdx };
    }
  }
  return null;
}

/**
 * Parse prefix segments (everything before AccountId-Region or the whole name for Pattern 3)
 * using known values stripped from the left.
 *
 * @param {string} prefixStr - The string containing orgPrefix, prefix, projectId, stageId, resourceName
 * @param {Object} knownValues - Known component values for anchoring
 * @param {string} [knownValues.orgPrefix] - Known org prefix
 * @param {string} [knownValues.prefix] - Known prefix
 * @param {string} [knownValues.projectId] - Known projectId
 * @param {string} [knownValues.stageId] - Known stageId
 * @param {boolean} [knownValues.isShared=false] - Whether StageId is absent
 * @param {boolean} [knownValues.hasOrgPrefix] - Disambiguate OrgPrefix presence
 * @returns {{components: Object, errors: string[], suggestions: string[]}}
 */
function parsePrefixSegments(prefixStr, knownValues = {}) {
  const { orgPrefix, prefix, projectId, stageId, isShared = false, hasOrgPrefix } = knownValues;
  const components = {};
  const errors = [];
  const suggestions = [];
  let remaining = prefixStr;

  // Strip orgPrefix from left if known
  if (orgPrefix) {
    const orgDash = orgPrefix + '-';
    if (remaining.startsWith(orgDash)) {
      components.orgPrefix = orgPrefix;
      remaining = remaining.substring(orgDash.length);
    } else if (remaining === orgPrefix) {
      components.orgPrefix = orgPrefix;
      remaining = '';
    }
  }

  // Strip prefix from left if known
  if (prefix) {
    const prefixDash = prefix + '-';
    if (remaining.startsWith(prefixDash)) {
      components.prefix = prefix;
      remaining = remaining.substring(prefixDash.length);
    } else if (remaining === prefix) {
      components.prefix = prefix;
      remaining = '';
    }
  }

  // Strip projectId from left if known
  if (projectId) {
    const projDash = projectId + '-';
    if (remaining.startsWith(projDash)) {
      components.projectId = projectId;
      remaining = remaining.substring(projDash.length);
    } else if (remaining === projectId) {
      components.projectId = projectId;
      remaining = '';
    }
  }

  // Strip stageId from left if known
  if (stageId) {
    const stageDash = stageId + '-';
    if (remaining.startsWith(stageDash)) {
      components.stageId = stageId;
      remaining = remaining.substring(stageDash.length);
    } else if (remaining === stageId) {
      components.stageId = stageId;
      remaining = '';
    }
  }

  // If we have all known values, whatever remains is resourceName
  if (prefix && projectId) {
    if (!isShared && !stageId && remaining) {
      // Need to find StageId in remaining
      const remSegments = remaining.split('-');
      if (remSegments.length >= 1 && isValidStageId(remSegments[0])) {
        components.stageId = remSegments[0];
        if (remSegments.length > 1) {
          components.resourceName = remSegments.slice(1).join('-');
        }
      } else if (isShared || remSegments.length === 0) {
        // No stageId needed or nothing left
        if (remaining) components.resourceName = remaining;
      } else {
        // Remaining could be resourceName if stageId is optional
        components.resourceName = remaining;
      }
    } else if (remaining) {
      components.resourceName = remaining;
    }
    return { components, errors, suggestions };
  }

  // If we don't have all known values, fall back to segment-based heuristic
  if (remaining) {
    const remSegments = remaining.split('-');

    if (!components.prefix && !components.projectId) {
      // No known values at all — use positional heuristic
      if (hasOrgPrefix === true && !components.orgPrefix) {
        if (remSegments.length >= 1) {
          components.orgPrefix = remSegments[0];
          remSegments.splice(0, 1);
        }
      }
      if (remSegments.length >= 1 && !components.prefix) {
        components.prefix = remSegments[0];
        remSegments.splice(0, 1);
      }
      if (remSegments.length >= 1 && !components.projectId) {
        components.projectId = remSegments[0];
        remSegments.splice(0, 1);
      }
      if (!isShared && remSegments.length >= 1) {
        if (isValidStageId(remSegments[0])) {
          components.stageId = remSegments[0];
          remSegments.splice(0, 1);
        }
      }
      if (remSegments.length > 0) {
        components.resourceName = remSegments.join('-');
      }
    } else if (components.prefix && !components.projectId) {
      // Prefix known but not projectId — find StageId boundary
      if (isShared) {
        components.projectId = remaining;
      } else {
        // Scan for StageId
        let stageIdx = -1;
        for (let i = 0; i < remSegments.length; i++) {
          if (isValidStageId(remSegments[i])) {
            stageIdx = i;
            break;
          }
        }
        if (stageIdx > 0) {
          components.projectId = remSegments.slice(0, stageIdx).join('-');
          components.stageId = remSegments[stageIdx];
          if (stageIdx + 1 < remSegments.length) {
            components.resourceName = remSegments.slice(stageIdx + 1).join('-');
          }
        } else if (stageIdx === 0) {
          components.stageId = remSegments[0];
          if (remSegments.length > 1) {
            components.resourceName = remSegments.slice(1).join('-');
          }
        } else {
          components.projectId = remaining;
        }
      }
    } else if (components.prefix && components.projectId) {
      // Both known — remaining is stageId + resourceName
      if (!isShared && remSegments.length >= 1 && isValidStageId(remSegments[0])) {
        components.stageId = remSegments[0];
        if (remSegments.length > 1) {
          components.resourceName = remSegments.slice(1).join('-');
        }
      } else if (remaining) {
        components.resourceName = remaining;
      }
    }
  }

  return { components, errors, suggestions };
}

/**
 * Validate S3 bucket name against Atlantis naming conventions.
 *
 * Pattern 1 (Regional):  [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]-AccountId-Region-an
 * Pattern 2 (Global):    [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]-AccountId-Region
 * Pattern 3 (Simple):    [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]
 *
 * Detection logic:
 * 1. Name ends with "-an" → strip suffix, scan right-to-left for Region then AccountId → Pattern 1
 * 2. Scan right-to-left for AccountId (12 digits) followed by Region, no "-an" → Pattern 2
 * 3. No AccountId/Region found → Pattern 3
 *
 * @param {string} name - S3 bucket name to validate
 * @param {Object} options - Validation options
 * @param {string} [options.orgPrefix] - Known organization prefix
 * @param {string} [options.prefix] - Known prefix value
 * @param {string} [options.projectId] - Known project ID value
 * @param {string} [options.stageId] - Known stage ID value
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
  let components = {};
  let detectedPattern = null;

  if (!name || typeof name !== 'string') {
    errors.push('S3 bucket name is required and must be a string');
    return { valid: false, errors, suggestions, components, pattern: null };
  }

  // Basic S3 naming rules
  const rules = AWS_NAMING_RULES.s3;

  if (name.length < rules.minLength) {
    errors.push(`S3 bucket name is too short (minimum ${rules.minLength} characters)`);
  }
  if (name.length > rules.maxLength) {
    errors.push(`S3 bucket name is too long (maximum ${rules.maxLength} characters)`);
    suggestions.push(`Shorten bucket name to ${rules.maxLength} characters or less`);
  }
  if (!rules.pattern.test(name)) {
    errors.push(`S3 bucket name does not match S3 naming rules: ${rules.description}`);
    suggestions.push('Use lowercase letters, numbers, dots, and hyphens only');
  }
  for (const disallowed of rules.disallowed) {
    if (name.includes(disallowed)) {
      errors.push(`S3 bucket name contains disallowed pattern '${disallowed}'`);
      suggestions.push(`Remove '${disallowed}' from bucket name`);
    }
  }
  if (name.startsWith('.') || name.startsWith('-')) {
    errors.push('S3 bucket name cannot start with dot or hyphen');
  }
  if (name.endsWith('.') || name.endsWith('-')) {
    errors.push('S3 bucket name cannot end with dot or hyphen');
  }

  // --- Pattern detection and anchor-based parsing ---
  const segments = name.split('-');

  // Pattern 1: ends with "-an"
  if (name.endsWith('-an') && segments.length >= 2 && segments[segments.length - 1] === 'an') {
    // Strip "an" suffix
    const withoutAn = segments.slice(0, -1);

    // Scan right-to-left for Region (3 segments) then AccountId (12 digits)
    const regionMatch = findRegionFromRight(withoutAn);
    if (regionMatch) {
      components.region = regionMatch.region;

      // AccountId should be immediately before the region
      const acctIdx = regionMatch.startIdx - 1;
      if (acctIdx >= 0 && /^\d{12}$/.test(withoutAn[acctIdx])) {
        components.accountId = withoutAn[acctIdx];
        detectedPattern = 'pattern1';

        // Everything before accountId is the prefix segments
        const prefixStr = withoutAn.slice(0, acctIdx).join('-');
        const parsed = parsePrefixSegments(prefixStr, { orgPrefix, prefix, projectId, stageId, isShared, hasOrgPrefix });
        components = { ...parsed.components, ...components };
        errors.push(...parsed.errors);
        suggestions.push(...parsed.suggestions);
      } else {
        // No valid AccountId before region — still Pattern 1 but report error
        detectedPattern = 'pattern1';
        errors.push('Pattern 1 (Regional) detected but no valid 12-digit AccountId found before Region');
        suggestions.push('AccountId must be exactly 12 digits, placed before the Region in Pattern 1');
        const prefixStr = withoutAn.slice(0, regionMatch.startIdx).join('-');
        const parsed = parsePrefixSegments(prefixStr, { orgPrefix, prefix, projectId, stageId, isShared, hasOrgPrefix });
        components = { ...parsed.components, ...components };
        errors.push(...parsed.errors);
        suggestions.push(...parsed.suggestions);
      }
    } else if (!partial) {
      errors.push('S3 bucket name ends with -an but no valid Region pattern found');
      suggestions.push('Pattern 1 (Regional): [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]-AccountId-Region-an');
    }
  } else {
    // Check for Pattern 2: scan for AccountId (12 digits) followed by Region
    let foundPattern2 = false;
    const regionMatch = findRegionFromRight(segments);

    if (regionMatch) {
      const acctIdx = regionMatch.startIdx - 1;
      if (acctIdx >= 0 && /^\d{12}$/.test(segments[acctIdx])) {
        components.region = regionMatch.region;
        components.accountId = segments[acctIdx];
        detectedPattern = 'pattern2';
        foundPattern2 = true;

        const prefixStr = segments.slice(0, acctIdx).join('-');
        const parsed = parsePrefixSegments(prefixStr, { orgPrefix, prefix, projectId, stageId, isShared, hasOrgPrefix });
        components = { ...parsed.components, ...components };
        errors.push(...parsed.errors);
        suggestions.push(...parsed.suggestions);
      }
    }

    if (!foundPattern2) {
      // Pattern 3: no AccountId/Region
      detectedPattern = 'pattern3';
      const parsed = parsePrefixSegments(name, { orgPrefix, prefix, projectId, stageId, isShared, hasOrgPrefix });
      components = { ...parsed.components };
      errors.push(...parsed.errors);
      suggestions.push(...parsed.suggestions);

      if (!components.prefix && !partial) {
        errors.push('S3 bucket name does not match expected patterns');
        suggestions.push('Pattern 1: [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]-AccountId-Region-an');
        suggestions.push('Pattern 2: [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]-AccountId-Region');
        suggestions.push('Pattern 3: [OrgPrefix-]Prefix-ProjectId[-StageId][-ResourceName]');
      }

      // For pattern3, rename resourceName to resourceSuffix for backward compat
      if (components.resourceName !== undefined) {
        components.resourceSuffix = components.resourceName;
        delete components.resourceName;
      }

      if (detectedPattern === 'pattern3' && components.prefix) {
        suggestions.push('Consider using the preferred S3 naming pattern with AccountId-Region suffix');
      }
    }
  }

  // --- Component validation ---
  if (components.orgPrefix && orgPrefix && components.orgPrefix !== orgPrefix) {
    errors.push(`Organization prefix '${components.orgPrefix}' does not match expected value '${orgPrefix}'`);
    suggestions.push(`Use organization prefix: ${orgPrefix}`);
  } else if (orgPrefix && !components.orgPrefix) {
    errors.push(`Expected organization prefix '${orgPrefix}' not found in bucket name`);
    suggestions.push(`Use organization prefix: ${orgPrefix}`);
  }

  if (components.prefix) {
    if (!prefix && !/^[a-z0-9]+$/.test(components.prefix)) {
      errors.push('Prefix must contain only lowercase alphanumeric characters');
    }
    if (prefix && components.prefix !== prefix) {
      errors.push(`Prefix '${components.prefix}' does not match expected value '${prefix}'`);
      suggestions.push(`Use prefix: ${prefix}`);
    }
  }

  if (components.projectId) {
    if (!projectId && !/^[a-z0-9]+$/.test(components.projectId)) {
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
    if (!REGION_PATTERN.test(components.region)) {
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
 * Validate service-role resource name.
 *
 * Pattern: PREFIX-ProjectId-ResourceSuffix
 * - PREFIX is ALL CAPS (uppercase letters and digits only, starts with uppercase letter)
 * - No StageId component (always treated as shared)
 * - ProjectId is lowercase
 *
 * Parsing strategy:
 * 1. If prefix and projectId are provided: strip them from the front, remainder is ResourceSuffix.
 * 2. If only prefix is provided: strip prefix, take next segment as projectId, remainder is ResourceSuffix.
 * 3. If no known values: split by hyphen, first segment is PREFIX (must be ALL CAPS),
 *    positional assignment for projectId and ResourceSuffix. Minimum 3 segments required.
 *
 * @param {string} name - Resource name to validate
 * @param {Object} options - Validation options
 * @param {string} [options.prefix] - Known PREFIX value (ALL CAPS)
 * @param {string} [options.projectId] - Known ProjectId value
 * @param {boolean} [options.partial=false] - Allow partial name validation
 * @returns {{valid: boolean, errors: Array<string>, suggestions: Array<string>, components: Object}}
 * @example
 * validateServiceRoleResource('ACME-myapp-CodePipelineServiceRole');
 * // { valid: true, errors: [], suggestions: [], components: { prefix: 'ACME', projectId: 'myapp', resourceSuffix: 'CodePipelineServiceRole' } }
 *
 * @example
 * validateServiceRoleResource('ACME-person-api-CloudFormationRole', { prefix: 'ACME', projectId: 'person-api' });
 * // { valid: true, errors: [], suggestions: [], components: { prefix: 'ACME', projectId: 'person-api', resourceSuffix: 'CloudFormationRole' } }
 */
function validateServiceRoleResource(name, options = {}) {
  const { prefix, projectId, partial = false } = options;

  const errors = [];
  const suggestions = [];
  const components = {};

  if (!name || typeof name !== 'string') {
    errors.push('Resource name is required and must be a string');
    return { valid: false, errors, suggestions, components };
  }

  const parts = name.split('-');
  let parsed = false;

  // --- Strategy 1: Both prefix and projectId known ---
  if (prefix && projectId) {
    const expectedStart = prefix + '-' + projectId + '-';
    if (name.startsWith(expectedStart)) {
      components.prefix = prefix;
      components.projectId = projectId;
      const remainder = name.substring(expectedStart.length);
      components.resourceSuffix = remainder || undefined;
      parsed = true;
    }
  }

  // --- Strategy 2: Only prefix known ---
  if (!parsed && prefix && !projectId) {
    const prefixDash = prefix + '-';
    if (name.startsWith(prefixDash)) {
      components.prefix = prefix;
      const afterPrefix = name.substring(prefixDash.length);
      const afterSegments = afterPrefix.split('-');

      if (afterSegments.length >= 2) {
        // First segment after prefix is projectId, rest is ResourceSuffix
        components.projectId = afterSegments[0];
        components.resourceSuffix = afterSegments.slice(1).join('-') || undefined;
      } else if (afterSegments.length === 1) {
        components.projectId = afterSegments[0];
      }
      parsed = true;
    }
  }

  // --- Strategy 3: No known values — positional assignment ---
  if (!parsed) {
    if (parts.length >= 3) {
      components.prefix = parts[0];
      components.projectId = parts[1];
      components.resourceSuffix = parts.slice(2).join('-') || undefined;
      parsed = true;
    }
  }

  // --- Not enough segments ---
  if (!parsed) {
    if (!partial) {
      errors.push('Service-role resource name must have at least 3 components: PREFIX-ProjectId-ResourceSuffix');
      suggestions.push('Expected format: PREFIX-ProjectId-ResourceSuffix (e.g., ACME-myapp-CodePipelineServiceRole)');
    }

    // Assign what we can
    if (parts.length >= 1) components.prefix = parts[0];
    if (parts.length >= 2) components.projectId = parts[1];

    // Still validate prefix even in partial mode
    if (components.prefix && !prefix && !/^[A-Z][A-Z0-9]*$/.test(components.prefix)) {
      errors.push(`Service-role Prefix '${components.prefix}' must be ALL CAPS (uppercase letters and digits only)`);
      suggestions.push('Prefix must match pattern: starts with uppercase letter, only uppercase letters and digits (e.g., ACME, AWS1)');
    }

    return { valid: errors.length === 0, errors, suggestions, components };
  }

  // --- Component validation ---

  // Validate PREFIX: must be ALL CAPS
  if (components.prefix) {
    if (!prefix && !/^[A-Z][A-Z0-9]*$/.test(components.prefix)) {
      errors.push(`Service-role Prefix '${components.prefix}' must be ALL CAPS (uppercase letters and digits only)`);
      suggestions.push('Prefix must match pattern: starts with uppercase letter, only uppercase letters and digits (e.g., ACME, AWS1)');
    }
    if (prefix && components.prefix !== prefix) {
      errors.push(`Prefix '${components.prefix}' does not match expected value '${prefix}'`);
      suggestions.push(`Use prefix: ${prefix}`);
    }
  }

  // Validate ProjectId
  if (components.projectId) {
    if (projectId && components.projectId !== projectId) {
      errors.push(`ProjectId '${components.projectId}' does not match expected value '${projectId}'`);
      suggestions.push(`Use project ID: ${projectId}`);
    }
  }

  // Validate ResourceSuffix
  if (!partial && components.resourceSuffix) {
    const pascalWarnings = checkPascalCase(components.resourceSuffix);
    suggestions.push(...pascalWarnings);
  } else if (!partial && !components.resourceSuffix) {
    errors.push('ResourceSuffix component is required');
    suggestions.push('Add a resource suffix after ProjectId (e.g., CodePipelineServiceRole, CloudFormationRole)');
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions,
    components
  };
}

/**
 * Validate resource name based on resource type.
 *
 * Routes to the appropriate validator based on the resource type:
 * - 's3' → validateS3Bucket()
 * - 'service-role' → validateServiceRoleResource()
 * - Any other value → validateApplicationResource() with type-specific length limits
 *   when the type is known in AWS_NAMING_RULES; unknown types skip length validation.
 *
 * The provided resourceType string is always preserved in the result object.
 *
 * @param {string} name - Resource name to validate
 * @param {Object} options - Validation options
 * @param {string} options.resourceType - Resource type ('s3' and 'service-role' have special handling; all others use standard application resource validation)
 * @param {Object} [options.config] - Configuration values
 * @param {string} [options.config.prefix] - Known prefix value
 * @param {string} [options.config.projectId] - Known projectId value
 * @param {string} [options.config.stageId] - Known stageId value
 * @param {string} [options.config.orgPrefix] - Known orgPrefix value
 * @param {boolean} [options.config.isShared] - Shared resource flag
 * @param {boolean} [options.config.hasOrgPrefix] - OrgPrefix disambiguation flag
 * @param {boolean} [options.partial=false] - Allow partial name validation
 * @returns {{valid: boolean, errors: Array<string>, suggestions: Array<string>, components: Object, resourceType: string}}
 */
function validateNaming(name, options = {}) {
  const { resourceType, config = {}, partial = false } = options;

  if (!resourceType) {
    return {
      valid: false,
      errors: ['Resource type is required'],
      suggestions: ['Specify resourceType: s3, service-role, dynamodb, lambda, cloudformation, or any AWS resource type'],
      components: {},
      resourceType: null
    };
  }

  const normalizedType = resourceType.toLowerCase();

  if (normalizedType === 's3') {
    const result = validateS3Bucket(name, {
      ...config,
      isShared: config.isShared,
      hasOrgPrefix: config.hasOrgPrefix,
      partial
    });
    return { ...result, resourceType: 's3' };
  } else if (normalizedType === 'service-role') {
    const result = validateServiceRoleResource(name, { ...config, partial });
    return { ...result, resourceType: 'service-role' };
  } else {
    // ALL other types route to application resource validation
    // Known types (in AWS_NAMING_RULES) get length limits applied; unknown types skip length checks
    const result = validateApplicationResource(name, {
      resourceType: normalizedType,
      ...config,
      isShared: config.isShared,
      partial
    });
    return { ...result, resourceType: normalizedType };
  }
}

/**
 * Auto-detect resource type from name pattern.
 *
 * S3 detection (in order):
 *   1. Ends with "-an" and contains Region pattern → s3
 *   2. All-lowercase, contains AccountId (12 digits) followed by Region → s3
 *
 * Service-role detection:
 *   First hyphen-separated segment is ALL CAPS (matches /^[A-Z][A-Z0-9]*$/),
 *   3+ segments, and name is not all-lowercase.
 *
 * Application detection:
 *   4+ hyphen-separated segments where the third segment (0-indexed position 2)
 *   matches the StageId pattern (starts with t, b, s, or p).
 *
 * @param {string} name - Resource name
 * @returns {string|null} 's3', 'service-role', 'application', or null
 */
function detectResourceType(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }

  // S3 Pattern 1: ends with "-an" and contains a Region pattern
  if (name.endsWith('-an') && name === name.toLowerCase()) {
    const segments = name.split('-');
    if (segments.length >= 2 && segments[segments.length - 1] === 'an') {
      const withoutAn = segments.slice(0, -1);
      const regionMatch = findRegionFromRight(withoutAn);
      if (regionMatch) {
        return 's3';
      }
    }
  }

  // S3 Pattern 2: all-lowercase with AccountId (12 digits) followed by Region
  if (name === name.toLowerCase() && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
    const segments = name.split('-');
    const regionMatch = findRegionFromRight(segments);
    if (regionMatch) {
      const acctIdx = regionMatch.startIdx - 1;
      if (acctIdx >= 0 && /^\d{12}$/.test(segments[acctIdx])) {
        return 's3';
      }
      // Also detect S3 if there's a region but no accountId (legacy compat)
      return 's3';
    }
  }

  // Service-role: first segment is ALL CAPS, 3+ segments, not all-lowercase
  const parts = name.split('-');
  if (parts.length >= 3 && name !== name.toLowerCase()) {
    if (/^[A-Z][A-Z0-9]*$/.test(parts[0])) {
      return 'service-role';
    }
  }

  // Application resources: 4+ segments with valid StageId at position 2
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
  validateServiceRoleResource,
  validateNaming,
  detectResourceType,
  isValidStageId,
  checkPascalCase,
  AWS_NAMING_RULES,
  STAGE_ID_PATTERN
};
