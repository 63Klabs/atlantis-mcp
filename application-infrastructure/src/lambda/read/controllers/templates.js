/**
 * Templates Controller
 *
 * Handles MCP tool requests for CloudFormation template operations.
 * Validates inputs, orchestrates service calls, and formats MCP responses.
 *
 * Supported operations:
 * - list() - List all available templates with filtering
 * - get() - Retrieve specific template with full metadata
 * - listVersions() - List all versions of a template
 * - listCategories() - List all template categories
 *
 * @module controllers/templates
 */

const Services = require('../services');
const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * List all available CloudFormation templates
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.body - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with template list
 *
 * @example
 * const response = await Templates.list({
 *   body: { input: { category: 'Storage' } }
 * });
 */
async function list(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('list_templates', input);

    if (!validation.valid) {
      DebugAndLog.warn('list_templates validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'list_templates');
    }

    // >! Extract parameters (category, version, versionId, s3Buckets)
    const { category, version, versionId, s3Buckets } = input;

    DebugAndLog.info('list_templates request', {
      category,
      version,
      versionId,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.Templates.list()
    const result = await Services.Templates.list({
      category,
      version,
      versionId,
      s3Buckets
    });

    DebugAndLog.info('list_templates response', {
      templateCount: result.templates ? result.templates.length : 0,
      partialData: result.partialData || false,
      errorCount: result.errors ? result.errors.length : 0
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('list_templates', result);

  } catch (error) {
    DebugAndLog.error('list_templates error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to list templates',
      error: error.message
    }, 'list_templates');
  }
}

/**
 * Get specific template details
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.bodyParameters - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with template details
 *
 * @example
 * const response = await Templates.get({
 *   body: {
 *     input: {
 *       templateName: 'template-storage-s3-artifacts',
 *       category: 'Storage'
 *     }
 *   }
 * });
 */
async function get(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('get_template', input);

    if (!validation.valid) {
      DebugAndLog.warn('get_template validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'get_template');
    }

    // >! Extract parameters (templateName, category, version, versionId, s3Buckets)
    const { templateName, category, version, versionId, s3Buckets } = input;

    DebugAndLog.info('get_template request', {
      templateName,
      category,
      version,
      versionId,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.Templates.get()
    const template = await Services.Templates.get({
      templateName,
      category,
      version,
      versionId,
      s3Buckets
    });

    DebugAndLog.info('get_template response', {
      templateName: template.name,
      version: template.version,
      versionId: template.versionId,
      namespace: template.namespace,
      bucket: template.bucket
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('get_template', template);

  } catch (error) {
    // >! Handle TEMPLATE_NOT_FOUND error with available templates
    if (error.code === 'TEMPLATE_NOT_FOUND') {
      DebugAndLog.warn('get_template not found', {
        error: error.message,
        availableTemplates: error.availableTemplates
      });

      return MCPProtocol.errorResponse('TEMPLATE_NOT_FOUND', {
        message: error.message,
        availableTemplates: error.availableTemplates || []
      }, 'get_template');
    }

    DebugAndLog.error('get_template error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to retrieve template',
      error: error.message
    }, 'get_template');
  }
}

/**
 * List all versions of a specific template
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.body - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with version history
 *
 * @example
 * const response = await Templates.listVersions({
 *   body: {
 *     input: {
 *       templateName: 'template-storage-s3-artifacts',
 *       category: 'Storage'
 *     }
 *   }
 * });
 */
async function listVersions(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('list_template_versions', input);

    if (!validation.valid) {
      DebugAndLog.warn('list_template_versions validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'list_template_versions');
    }

    // >! Extract parameters (templateName, category, s3Buckets)
    const { templateName, category, s3Buckets } = input;

    DebugAndLog.info('list_template_versions request', {
      templateName,
      category,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.Templates.listVersions()
    const versions = await Services.Templates.listVersions({
      templateName,
      category,
      s3Buckets
    });

    DebugAndLog.info('list_template_versions response', {
      templateName: versions.templateName,
      versionCount: versions.versions ? versions.versions.length : 0
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('list_template_versions', versions);

  } catch (error) {
    DebugAndLog.error('list_template_versions error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to list template versions',
      error: error.message
    }, 'list_template_versions');
  }
}

/**
 * List all available template categories
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.body - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with category list
 *
 * @example
 * const response = await Templates.listCategories({
 *   body: { input: {} }
 * });
 */
async function listCategories(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('list_categories', input);

    if (!validation.valid) {
      DebugAndLog.warn('list_categories validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'list_categories');
    }

    DebugAndLog.info('list_categories request');

    // >! Call Services.Templates.listCategories()
    const categories = await Services.Templates.listCategories();

    DebugAndLog.info('list_categories response', {
      categoryCount: categories.length
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('list_categories', {
      categories
    });

  } catch (error) {
    DebugAndLog.error('list_categories error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to list categories',
      error: error.message
    }, 'list_categories');
  }
}

module.exports = {
  list,
  get,
  listVersions,
  listCategories
};
