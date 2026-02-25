/**
 * Validation Controller
 *
 * Handles MCP tool requests for AWS resource naming validation.
 * Validates resource names against Atlantis naming conventions and provides
 * specific error messages and suggestions for invalid names.
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
 * - Application resources: <Prefix>-<ProjectId>-<StageId>-<ResourceName>
 * - S3 buckets: <orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>
 * - S3 buckets (alt): <orgPrefix>-<Prefix>-<ProjectId>-<Region>
 *
 * Returns validation results with specific error messages and suggestions
 * for correcting invalid names.
 *
 * @param {Object} props - Request properties from router
 * @param {Object} props.body - Request body containing tool input
 * @param {Object} props.body.input - Tool input parameters
 * @param {string} props.body.input.resourceName - Resource name to validate (required)
 * @param {string} [props.body.input.resourceType] - Resource type (s3, dynamodb, lambda, cloudformation, application)
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
  const input = props.body?.input || {};

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

  // Extract parameters
  const { resourceName, resourceType } = input;

  DebugAndLog.debug('Validation controller: Validating resource name', {
    resourceName,
    resourceType: resourceType || 'auto-detect'
  });

  try {
    // Call validation service
    const result = await Services.Validation.validateNaming({
      resourceName,
      resourceType
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
