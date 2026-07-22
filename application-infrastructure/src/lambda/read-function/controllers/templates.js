/**
 * Templates Controller
 *
 * Handles MCP tool requests for CloudFormation template operations.
 * Validates inputs, orchestrates service calls, and formats MCP responses.
 *
 * Supported operations:
 * - list() - List all available templates with filtering
 * - get() - Retrieve specific template with full metadata
 * - getChunk() - Retrieve a specific chunk of a large template's content
 * - listVersions() - List all versions of a template
 * - listCategories() - List all template categories
 *
 * @module controllers/templates
 */

const Services = require('../services');
const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');
const ContentChunker = require('../utils/content-chunker');
const { cache: { CacheableDataAccess }, tools: { DebugAndLog, ApiRequest } } = require('@63klabs/cache-data');
const { Config } = require('../config');

/**
 * List all available CloudFormation templates
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.body - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with template list
 *
 * @example
 * const response = await Templates.list({
 *   body: { input: { category: 'storage' } }
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

    // >! Extract parameters (category, s3Buckets, namespace)
    const { category, s3Buckets, namespace } = input;

    DebugAndLog.info('list_templates request', {
      category,
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.Templates.list()
    const result = await Services.Templates.list({
      category,
      s3Buckets,
      namespace
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
 *       category: 'storage'
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

    // >! Extract parameters (templateName, category, version, versionId, s3Buckets, namespace)
    const { templateName, category, version, versionId, s3Buckets, namespace } = input;

    DebugAndLog.info('get_template request', {
      templateName,
      category,
      version,
      versionId,
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.Templates.get()
    const template = await Services.Templates.get({
      templateName,
      category,
      version,
      versionId,
      s3Buckets,
      namespace
    });

    // >! Null guard: handle edge case where service returns null instead of throwing
    if (!template) {
      DebugAndLog.warn('get_template null result', { templateName, category });
      return MCPProtocol.errorResponse('TEMPLATE_NOT_FOUND', {
        message: `Template not found: ${category}/${templateName}`,
        availableTemplates: []
      }, 'get_template');
    }

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
 *       category: 'storage'
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

    // >! Extract parameters (templateName, category, s3Buckets, namespace)
    const { templateName, category, s3Buckets, namespace } = input;

    DebugAndLog.info('list_template_versions request', {
      templateName,
      category,
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.Templates.listVersions()
    const versions = await Services.Templates.listVersions({
      templateName,
      category,
      s3Buckets,
      namespace
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

/**
 * Retrieve a specific chunk of a large template's content.
 *
 * Uses CacheableDataAccess to cache individual chunk results keyed by
 * template identity and chunk index. On cache miss, fetches the full template,
 * serializes it to JSON, splits it into chunks using ContentChunker, and
 * returns the requested chunk.
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.bodyParameters - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted chunk response or error
 *
 * @example
 * const response = await Templates.getChunk({
 *   bodyParameters: {
 *     input: {
 *       templateName: 'template-storage-s3-artifacts',
 *       category: 'storage',
 *       chunkIndex: 0
 *     }
 *   }
 * });
 */
async function getChunk(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('get_template_chunk', input);

    if (!validation.valid) {
      DebugAndLog.warn('get_template_chunk validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'get_template_chunk');
    }

    // >! Extract parameters
    const { templateName, category, chunkIndex, version, versionId, s3Buckets, namespace } = input;

    DebugAndLog.info('get_template_chunk request', {
      templateName,
      category,
      chunkIndex,
      version,
      versionId,
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Get connection and cache profile for template-chunks
    const { conn, cacheProfile } = Config.getConnCacheProfile('template-chunks', 'chunk-data');

    if (!conn || !cacheProfile) {
      const errorMsg = 'get_template_chunk: Failed to get connection and/or cache profile for template-chunks/chunk-data';
      DebugAndLog.error(errorMsg);
      throw new Error(errorMsg);
    }

    // >! Resolve S3 buckets (default from settings if not provided)
    let bucketsToSearch = s3Buckets;
    if (!bucketsToSearch || bucketsToSearch.length === 0) {
      bucketsToSearch = Config.settings().s3.buckets;
    }

    // >! Set host to resolved bucket list (used in cache key)
    conn.host = bucketsToSearch;

    // >! Set parameters for cache key generation and fetch function
    conn.parameters = { templateName, category, chunkIndex, version, versionId, s3Buckets, namespace };

    // >! Define fetch function that reads all parameters from connection.parameters
    const fetchFunction = async (connection, opts) => {
      const {
        templateName, category, chunkIndex,
        version, versionId, s3Buckets, namespace
      } = connection.parameters;

      // >! Fetch full template via Services.Templates.get()
      const template = await Services.Templates.get({
        templateName, category, version, versionId, s3Buckets, namespace
      });

      // >! TEMPLATE_NOT_FOUND: throw so CacheableDataAccess does not cache the error
      if (!template) {
        const error = new Error(`Template not found: ${category}/${templateName}`);
        error.code = 'TEMPLATE_NOT_FOUND';
        error.availableTemplates = [];
        throw error;
      }

      // >! Serialize and chunk
      const serialized = JSON.stringify(template);
      const chunks = ContentChunker.chunk(serialized);

      // >! INVALID_CHUNK_INDEX: return as ApiRequest.error() so it IS cached
      if (chunkIndex < 0 || chunkIndex >= chunks.length) {
        return ApiRequest.error({
          body: {
            code: 'INVALID_CHUNK_INDEX',
            message: `chunkIndex ${chunkIndex} is out of range. Valid range: 0-${chunks.length - 1}`,
            validRange: { min: 0, max: chunks.length - 1 }
          }
        });
      }

      // >! Return the specific chunk
      return ApiRequest.success({
        body: {
          chunkIndex,
          totalChunks: chunks.length,
          templateName,
          category,
          content: chunks[chunkIndex]
        }
      });
    };

    // >! Use CacheableDataAccess pass-through caching
    const cacheObj = await CacheableDataAccess.getData(
      cacheProfile,
      fetchFunction,
      conn,
      {},
    );

    // >! Extract result body
    const body = cacheObj.getBody(true);

    // >! Check if cached body contains INVALID_CHUNK_INDEX error
    if (body && body.code === 'INVALID_CHUNK_INDEX') {
      DebugAndLog.warn('get_template_chunk invalid index', {
        chunkIndex,
        message: body.message
      });
      return MCPProtocol.errorResponse('INVALID_CHUNK_INDEX', {
        message: body.message,
        validRange: body.validRange
      }, 'get_template_chunk');
    }

    DebugAndLog.info('get_template_chunk response', {
      templateName: body.templateName,
      category: body.category,
      chunkIndex: body.chunkIndex,
      totalChunks: body.totalChunks
    });

    // >! Return MCP-formatted chunk response
    return MCPProtocol.successResponse('get_template_chunk', body);

  } catch (error) {
    // >! Handle TEMPLATE_NOT_FOUND error with available templates
    if (error.code === 'TEMPLATE_NOT_FOUND') {
      DebugAndLog.warn('get_template_chunk not found', {
        error: error.message,
        availableTemplates: error.availableTemplates
      });

      return MCPProtocol.errorResponse('TEMPLATE_NOT_FOUND', {
        message: error.message,
        availableTemplates: error.availableTemplates || []
      }, 'get_template_chunk');
    }

    DebugAndLog.error('get_template_chunk error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to retrieve template chunk',
      error: error.message
    }, 'get_template_chunk');
  }
}

module.exports = {
  list,
  get,
  getChunk,
  listVersions,
  listCategories
};
