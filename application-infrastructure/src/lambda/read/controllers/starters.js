/**
 * Starters Controller
 *
 * Handles MCP tool requests for app starter operations.
 * Validates inputs, orchestrates service calls, and formats MCP responses.
 *
 * Supported operations:
 * - list() - List all available starter code repositories with filtering
 * - get() - Retrieve specific starter with detailed metadata
 *
 * @module controllers/starters
 */

const Services = require('../services');
const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * List all available starter code repositories
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.body - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with starter list
 *
 * @example
 * const response = await Starters.list({
 *   body: { input: { s3Buckets: ['63klabs'], namespace: '63klabs' } }
 * });
 */
async function list(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('list_starters', input);

    if (!validation.valid) {
      DebugAndLog.warn('list_starters validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'list_starters');
    }

    // >! Extract parameters (s3Buckets, namespace)
    const { s3Buckets, namespace } = input;

    DebugAndLog.info('list_starters request', {
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.Starters.list()
    const result = await Services.Starters.list({
      s3Buckets,
      namespace
    });

    DebugAndLog.info('list_starters response', {
      starterCount: result.starters ? result.starters.length : 0,
      partialData: result.partialData || false,
      errorCount: result.errors ? result.errors.length : 0
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('list_starters', result);

  } catch (error) {
    DebugAndLog.error('list_starters error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to list starters',
      error: error.message
    }, 'list_starters');
  }
}

/**
 * Get specific starter details
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.body - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with starter details
 *
 * @example
 * const response = await Starters.get({
 *   body: {
 *     input: {
 *       starterName: 'atlantis-starter-02',
 *       s3Buckets: ['63klabs'],
 *       namespace: '63klabs'
 *     }
 *   }
 * });
 */
async function get(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('get_starter_info', input);

    if (!validation.valid) {
      DebugAndLog.warn('get_starter_info validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'get_starter_info');
    }

    // >! Extract parameters (starterName, s3Buckets, namespace)
    const { starterName, s3Buckets, namespace } = input;

    DebugAndLog.info('get_starter_info request', {
      starterName,
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.Starters.get()
    const starter = await Services.Starters.get({
      starterName,
      s3Buckets,
      namespace
    });

    DebugAndLog.info('get_starter_info response', {
      starterName: starter.name,
      hasS3Package: starter.hasS3Package,
      hasSidecarMetadata: starter.hasSidecarMetadata,
      source: starter.source
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('get_starter_info', starter);

  } catch (error) {
    // >! Handle STARTER_NOT_FOUND error with available starters
    if (error.code === 'STARTER_NOT_FOUND') {
      DebugAndLog.warn('get_starter_info not found', {
        error: error.message,
        availableStarters: error.availableStarters
      });

      return MCPProtocol.errorResponse('STARTER_NOT_FOUND', {
        message: error.message,
        availableStarters: error.availableStarters || []
      }, 'get_starter_info');
    }

    DebugAndLog.error('get_starter_info error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to retrieve starter',
      error: error.message
    }, 'get_starter_info');
  }
}

module.exports = {
  list,
  get
};
