/**
 * Validation Controller
 *
 * Handles MCP tool requests for AWS resource naming validation.
 * Validates resource names against Atlantis naming conventions and provides
 * specific error messages and suggestions for invalid names.
 *
 * Supports disambiguation parameters (prefix, projectId, stageId, orgPrefix)
 * for accurate parsing of resource names with hyphenated components.
 *
 * @module controllers/validation
 */

const Services = require('../services');
const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Validate resource name against Atlantis naming conventions
 *
 * Validates resource names against Atlantis naming conventions:
 * - Application resources: <Prefix>-<ProjectId>-<StageId>-<ResourceSuffix>
 * - S3 Pattern 1 (Regional): [<OrgPrefix>-]<Prefix>-<ProjectId>[-<StageId>][-<ResourceName>]-<AccountId>-<Region>-an
 * - S3 Pattern 2 (Global):   [<OrgPrefix>-]<Prefix>-<ProjectId>[-<StageId>][-<ResourceName>]-<AccountId>-<Region>
 * - S3 Pattern 3 (Simple):   [<OrgPrefix>-]<Prefix>-<ProjectId>[-<StageId>][-<ResourceName>]
 *
 * Returns validation results with specific error messages and suggestions
 * for correcting invalid names.
 *
 * @param {Object} props - Request properties from router
 * @param {Object} props.body - Request body containing tool input
 * @param {Object} props.body.input - Tool input parameters
 * @param {string} props.body.input.resourceName - Resource name to validate (required)
 * @param {string} [props.body.input.resourceType] - Resource type (s3, dynamodb, lambda, cloudformation, application)
 * @param {boolean} [props.body.input.isShared] - When true, validates as a shared resource without StageId
 * @param {boolean} [props.body.input.hasOrgPrefix] - When true, indicates S3 bucket includes org prefix
 * @param {string} [props.body.input.prefix] - Known Prefix value for disambiguation of hyphenated components
 * @param {string} [props.body.input.projectId] - Known ProjectId value for disambiguation of hyphenated components
 * @param {string} [props.body.input.stageId] - Known StageId value for disambiguation of hyphenated components
 * @param {string} [props.body.input.orgPrefix] - Known OrgPrefix value for disambiguation of hyphenated S3 components
 * @returns {Promise<Object>} MCP-formatted response with validation results
 *
 * @example
 * // Valid application resource name
 * const result = await validate({
 *   body: {
 *     input: {
 *       resourceName: 'acme-myapp-prod-GetUserFunction'
 *     }
 *   }
 * });
 * // Returns: { valid: true, resourceType: 'application', components: {...}, errors: [], suggestions: [] }
 *
 * @example
 * // Invalid resource name with suggestions
 * const result = await validate({
 *   body: {
 *     input: {
 *       resourceName: 'invalid-name',
 *       resourceType: 'application'
 *     }
 *   }
 * });
 * // Returns: { valid: false, errors: [...], suggestions: [...] }
 */
const validate = async (props) => {
  DebugAndLog.info('Validation controller: validate() called');

  // Extract input from request body
  const input = props.bodyParameters?.input || {};

  // Validate input against JSON Schema
  const validation = SchemaValidator.validate('validate_naming', input);

  if (!validation.valid) {
    DebugAndLog.warn('Validation controller: Invalid input', {
      errors: validation.errors
    });

    return MCPProtocol.errorResponse(
      'INVALID_INPUT',
      {
        message: 'Invalid input parameters',
        errors: validation.errors
      },
      'validate_naming'
    );
  }

  // Extract parameters including disambiguation values
  const { resourceName, resourceType, isShared, hasOrgPrefix, prefix, projectId, stageId, orgPrefix } = input;

  DebugAndLog.debug('Validation controller: Validating resource name', {
    resourceName,
    resourceType: resourceType || 'auto-detect',
    isShared: isShared || false,
    hasOrgPrefix: hasOrgPrefix !== undefined ? hasOrgPrefix : 'auto',
    prefix: prefix || '(not provided)',
    projectId: projectId || '(not provided)',
    stageId: stageId || '(not provided)',
    orgPrefix: orgPrefix || '(not provided)'
  });

  try {
    // Call validation service with disambiguation parameters
    const result = await Services.Validation.validateNaming({
      resourceName,
      resourceType,
      isShared,
      hasOrgPrefix,
      prefix,
      projectId,
      stageId,
      orgPrefix
    });

    DebugAndLog.info('Validation controller: Validation completed', {
      resourceName,
      valid: result.valid,
      resourceType: result.resourceType,
      errorCount: result.errors.length,
      suggestionCount: result.suggestions.length
    });

    // Return MCP-formatted response with validation results
    return MCPProtocol.successResponse('validate_naming', {
      resourceName,
      valid: result.valid,
      resourceType: result.resourceType,
      components: result.components,
      errors: result.errors,
      suggestions: result.suggestions,
      pattern: result.pattern // For S3 buckets: 'pattern1' or 'pattern2'
    });

  } catch (error) {
    DebugAndLog.error('Validation controller: Error during validation', {
      resourceName,
      resourceType,
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse(
      'VALIDATION_ERROR',
      {
        message: 'Error occurred during validation',
        error: error.message
      },
      'validate_naming'
    );
  }
};

module.exports = {
  validate
};
