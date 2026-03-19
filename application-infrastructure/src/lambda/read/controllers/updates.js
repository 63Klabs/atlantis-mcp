/**
 * Updates Controller
 *
 * Handles MCP tool requests for template update checking.
 * Validates inputs, orchestrates service calls, and formats MCP responses.
 *
 * Supported operations:
 * - check() - Check if newer versions of templates are available
 *
 * @module controllers/updates
 */

const Services = require('../services');
const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * Check for template updates
 *
 * Compares current template version with latest available version and returns
 * update information including version numbers, release dates, changelog,
 * breaking changes indicator, and migration guide links.
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.body - Request body containing tool input
 * @param {Object} props.body.input - Tool input parameters
 * @param {string} props.body.input.templateName - Name of template to check (required)
 * @param {string} props.body.input.currentVersion - Current Human_Readable_Version (required)
 * @param {string} [props.body.input.category] - Template category (optional)
 * @param {Array<string>} [props.body.input.s3Buckets] - Filter to specific buckets (optional)
 * @returns {Promise<Object>} MCP-formatted response with update information
 *
 * @example
 * const response = await Updates.check({
 *   body: {
 *     input: {
 *       templateName: 'template-storage-s3-artifacts',
 *       currentVersion: 'v1.3.4/2024-01-10',
 *       category: 'Storage'
 *     }
 *   }
 * });
 * // Returns: {
 * //   updateAvailable: true,
 * //   currentVersion: 'v1.3.4/2024-01-10',
 * //   latestVersion: 'v1.3.5/2024-01-15',
 * //   releaseDate: '2024-01-15',
 * //   changelog: '...',
 * //   breakingChanges: false,
 * //   migrationGuide: null
 * // }
 */
async function check(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('check_template_updates', input);

    if (!validation.valid) {
      DebugAndLog.warn('check_template_updates validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'check_template_updates');
    }

    // >! Extract parameters (templateName, currentVersion, category, s3Buckets, namespace)
    const { templateName, currentVersion, category, s3Buckets, namespace } = input;

    DebugAndLog.info('check_template_updates request', {
      templateName,
      currentVersion,
      category,
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.Templates.checkUpdates()
    // The service expects an array of templates to check
    const updateResults = await Services.Templates.checkUpdates({
      templates: [{
        category,
        templateName,
        currentVersion
      }],
      s3Buckets,
      namespace
    });

    // Extract the single result (we only checked one template)
    const updateInfo = updateResults[0];

    // Check if there was an error
    if (updateInfo.error) {
      DebugAndLog.warn('check_template_updates error from service', {
        templateName,
        currentVersion,
        error: updateInfo.error
      });

      return MCPProtocol.errorResponse('UPDATE_CHECK_FAILED', {
        message: updateInfo.error,
        templateName,
        currentVersion
      }, 'check_template_updates');
    }

    DebugAndLog.info('check_template_updates response', {
      templateName: updateInfo.templateName,
      currentVersion: updateInfo.currentVersion,
      latestVersion: updateInfo.latestVersion,
      updateAvailable: updateInfo.updateAvailable,
      breakingChanges: updateInfo.breakingChanges
    });

    // >! Return MCP-formatted response with update information
    return MCPProtocol.successResponse('check_template_updates', {
      templateName: updateInfo.templateName,
      category: updateInfo.category,
      currentVersion: updateInfo.currentVersion,
      latestVersion: updateInfo.latestVersion,
      updateAvailable: updateInfo.updateAvailable,
      releaseDate: updateInfo.releaseDate,
      changelog: updateInfo.changelog,
      breakingChanges: updateInfo.breakingChanges,
      migrationGuide: updateInfo.migrationGuide,
      s3Path: updateInfo.s3Path,
      namespace: updateInfo.namespace,
      bucket: updateInfo.bucket
    });

  } catch (error) {
    DebugAndLog.error('check_template_updates error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to check template updates',
      error: error.message
    }, 'check_template_updates');
  }
}

module.exports = {
  check
};
