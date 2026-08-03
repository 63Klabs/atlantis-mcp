/**
 * Agent Assets Controller
 *
 * Handles MCP tool requests for agent-asset (steering documents, hooks,
 * AGENTS.md files, and other registry-driven types) operations. Validates
 * inputs, orchestrates service calls, and formats MCP responses, mirroring
 * controllers/templates.js and controllers/starters.js.
 *
 * The asset **type** is resolved from the validated `assetType` input
 * parameter, not from the tool name: `get_agent_asset` requires it, while
 * `list_agent_assets` treats it as optional (omitted = search all enabled
 * types).
 *
 * Supported operations:
 * - list() - List agent assets across one or all enabled types
 * - get() - Retrieve one agent asset's full content
 * - listTypes() - List the enabled agent-asset types with per-type asset counts
 *
 * @module controllers/agent-assets
 */

const Services = require('../services');
const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');
const AgentAssetTypes = require('../config/agent-asset-types');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

/**
 * List agent assets, optionally filtered by asset type, S3 bucket, or namespace.
 *
 * Validates input against the `list_agent_assets` schema (whose `assetType`
 * property is already enum-constrained to the enabled registry types), then,
 * as defense in depth beyond that schema enum, re-checks a supplied
 * `assetType` against the enabled-type registry via
 * `AgentAssetTypes.resolveEnabledType` before calling the service. An unknown
 * or disabled `assetType` is rejected with `INVALID_INPUT` naming the valid
 * values, without calling the service or performing any S3 read.
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.bodyParameters - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with agent asset list
 *
 * @example
 * // List assets of a single type
 * const response = await AgentAssets.list({
 *   bodyParameters: { input: { assetType: 'steering' } }
 * });
 *
 * @example
 * // List assets across all enabled types
 * const response = await AgentAssets.list({ bodyParameters: { input: {} } });
 */
async function list(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('list_agent_assets', input);

    if (!validation.valid) {
      DebugAndLog.warn('list_agent_assets validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'list_agent_assets');
    }

    // >! Extract parameters (assetType, s3Buckets, namespace); assetType is optional
    const { assetType, s3Buckets, namespace } = input;

    // >! Defense in depth beyond the schema's assetType enum: when a type is
    // >! supplied, re-check that it still names an ENABLED registry type
    // >! before calling the service, so an unknown/disabled value never
    // >! reaches an S3 read
    if (assetType && !AgentAssetTypes.resolveEnabledType(assetType)) {
      const validAssetTypes = AgentAssetTypes.getEnabledTypeNames();
      DebugAndLog.warn('list_agent_assets invalid assetType', { assetType, validAssetTypes });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: `Invalid assetType "${assetType}". Valid values: ${validAssetTypes.join(', ')}`,
        errors: [`assetType must be one of: ${validAssetTypes.join(', ')}`]
      }, 'list_agent_assets');
    }

    DebugAndLog.info('list_agent_assets request', {
      assetType,
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.AgentAssets.list()
    const result = await Services.AgentAssets.list({
      assetType,
      s3Buckets,
      namespace
    });

    DebugAndLog.info('list_agent_assets response', {
      assetCount: result.assets ? result.assets.length : 0,
      partialData: result.partialData || false,
      errorCount: result.errors ? result.errors.length : 0
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('list_agent_assets', result);

  } catch (error) {
    // >! Map the service's strict-bucket-validation error (INVALID_INPUT,
    // >! thrown when an s3Buckets filter names an unconfigured bucket) to the
    // >! same error code, carrying the invalid bucket names
    if (error.code === 'INVALID_INPUT') {
      DebugAndLog.warn('list_agent_assets invalid input', {
        error: error.message,
        invalidBuckets: error.invalidBuckets
      });

      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: error.message,
        invalidBuckets: error.invalidBuckets
      }, 'list_agent_assets');
    }

    DebugAndLog.error('list_agent_assets error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to list agent assets',
      error: error.message
    }, 'list_agent_assets');
  }
}

/**
 * Get one agent asset's full content by assetType and name.
 *
 * Validates input against the `get_agent_asset` schema (which enforces the
 * required `assetType` enum, the required `name`, and the `name`
 * path-separator regex `^[^/\\]+$`), then, as defense in depth beyond that
 * schema enum, re-checks `assetType` against the enabled-type registry via
 * `AgentAssetTypes.resolveEnabledType` before calling the service.
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.bodyParameters - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with agent asset detail
 *
 * @example
 * const response = await AgentAssets.get({
 *   bodyParameters: {
 *     input: { assetType: 'steering', name: 'product-guidelines.md' }
 *   }
 * });
 */
async function get(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('get_agent_asset', input);

    if (!validation.valid) {
      DebugAndLog.warn('get_agent_asset validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'get_agent_asset');
    }

    // >! Extract parameters; the schema's `required` already guarantees
    // >! assetType and name are present
    const { assetType, name, s3Buckets, namespace } = input;

    // >! Defense in depth beyond the schema's assetType enum: re-check that
    // >! assetType still names an ENABLED registry type before calling the
    // >! service, so an unknown/disabled value never reaches an S3 read
    if (!AgentAssetTypes.resolveEnabledType(assetType)) {
      const validAssetTypes = AgentAssetTypes.getEnabledTypeNames();
      DebugAndLog.warn('get_agent_asset invalid assetType', { assetType, validAssetTypes });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: `Invalid assetType "${assetType}". Valid values: ${validAssetTypes.join(', ')}`,
        errors: [`assetType must be one of: ${validAssetTypes.join(', ')}`]
      }, 'get_agent_asset');
    }

    DebugAndLog.info('get_agent_asset request', {
      assetType,
      name,
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.AgentAssets.get()
    const asset = await Services.AgentAssets.get({
      assetType,
      name,
      s3Buckets,
      namespace
    });

    DebugAndLog.info('get_agent_asset response', {
      name: asset.name,
      type: asset.type,
      namespace: asset.namespace,
      bucket: asset.bucket
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('get_agent_asset', asset);

  } catch (error) {
    // >! Handle ASSET_NOT_FOUND error with available asset names
    if (error.code === 'ASSET_NOT_FOUND') {
      DebugAndLog.warn('get_agent_asset not found', {
        error: error.message,
        availableAssets: error.availableAssets
      });

      return MCPProtocol.errorResponse('ASSET_NOT_FOUND', {
        message: error.message,
        availableAssets: error.availableAssets || []
      }, 'get_agent_asset');
    }

    // >! Map the service's strict-bucket-validation error (INVALID_INPUT,
    // >! thrown when an s3Buckets filter names an unconfigured bucket) to the
    // >! same error code, carrying the invalid bucket names
    if (error.code === 'INVALID_INPUT') {
      DebugAndLog.warn('get_agent_asset invalid input', {
        error: error.message,
        invalidBuckets: error.invalidBuckets
      });

      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: error.message,
        invalidBuckets: error.invalidBuckets
      }, 'get_agent_asset');
    }

    DebugAndLog.error('get_agent_asset error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to retrieve agent asset',
      error: error.message
    }, 'get_agent_asset');
  }
}

/**
 * List the enabled agent-asset types together with a count of the assets
 * discoverable for each type across the configured S3 buckets and indexed
 * namespaces.
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.bodyParameters - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with the enabled types and their asset counts
 *
 * @example
 * const response = await AgentAssets.listTypes({ bodyParameters: { input: {} } });
 */
async function listTypes(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('list_agent_asset_types', input);

    if (!validation.valid) {
      DebugAndLog.warn('list_agent_asset_types validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'list_agent_asset_types');
    }

    DebugAndLog.info('list_agent_asset_types request');

    // >! Call Services.AgentAssets.listTypes()
    const types = await Services.AgentAssets.listTypes();

    DebugAndLog.info('list_agent_asset_types response', {
      typeCount: types.length
    });

    // >! Return MCP-formatted response
    return MCPProtocol.successResponse('list_agent_asset_types', {
      types
    });

  } catch (error) {
    DebugAndLog.error('list_agent_asset_types error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to list agent asset types',
      error: error.message
    }, 'list_agent_asset_types');
  }
}

/**
 * Get a single chunk of a large agent asset's content by assetType, name,
 * and chunkIndex, mirroring `Templates.getChunk` in `controllers/templates.js`.
 *
 * DESIGN NOTE: unlike `Templates.getChunk` (which inlines the cache-profile
 * lookup and fetch-function logic directly in the controller because there
 * is no `Services.Templates.getChunk`), this controller method is a THIN
 * wrapper that delegates all caching/orchestration to
 * `Services.AgentAssets.getChunk`, consistent with how `list`/`get`/
 * `listTypes` above delegate to their respective service methods. See the
 * design-note comment on `Services.AgentAssets.getChunk` for the full
 * reasoning.
 *
 * NOT YET EXPOSED: this tool is not wired into `tools/list` or the
 * `tools/call` dispatch map — that wiring, along with registering the
 * `get_agent_asset_chunk` schema, is deferred to task 10.3. Until 10.3
 * lands, `SchemaValidator.validate('get_agent_asset_chunk', input)` will
 * always return `{ valid: false, errors: ["Unknown tool: get_agent_asset_chunk"] }`
 * (see `utils/schema-validator.js`'s `validate()`), so this method always
 * short-circuits to `INVALID_INPUT` when called directly today. Schema-first
 * validation is used here anyway (rather than ad-hoc manual checks) for
 * consistency with every other controller method, and it starts working
 * correctly the moment task 10.3 registers the schema, with no further
 * change needed in this file.
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.bodyParameters - Request body containing tool input
 * @returns {Promise<Object>} MCP-formatted response with the requested content chunk
 *
 * @example
 * const response = await AgentAssets.getChunk({
 *   bodyParameters: {
 *     input: { assetType: 'steering', name: 'large-doc.md', chunkIndex: 0 }
 *   }
 * });
 */
async function getChunk(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('get_agent_asset_chunk', input);

    if (!validation.valid) {
      DebugAndLog.warn('get_agent_asset_chunk validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'get_agent_asset_chunk');
    }

    // >! Extract parameters; the schema's `required` (once registered in
    // >! task 10.3) guarantees assetType, name, and chunkIndex are present
    const { assetType, name, chunkIndex, s3Buckets, namespace } = input;

    // >! Defense in depth beyond the schema's assetType enum: re-check that
    // >! assetType still names an ENABLED registry type before calling the
    // >! service, so an unknown/disabled value never reaches an S3 read
    if (!AgentAssetTypes.resolveEnabledType(assetType)) {
      const validAssetTypes = AgentAssetTypes.getEnabledTypeNames();
      DebugAndLog.warn('get_agent_asset_chunk invalid assetType', { assetType, validAssetTypes });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: `Invalid assetType "${assetType}". Valid values: ${validAssetTypes.join(', ')}`,
        errors: [`assetType must be one of: ${validAssetTypes.join(', ')}`]
      }, 'get_agent_asset_chunk');
    }

    DebugAndLog.info('get_agent_asset_chunk request', {
      assetType,
      name,
      chunkIndex,
      namespace,
      s3BucketsCount: s3Buckets ? s3Buckets.length : 0
    });

    // >! Call Services.AgentAssets.getChunk()
    const body = await Services.AgentAssets.getChunk({
      assetType,
      name,
      chunkIndex,
      s3Buckets,
      namespace
    });

    // >! Check if the cached body contains an INVALID_CHUNK_INDEX error
    if (body && body.code === 'INVALID_CHUNK_INDEX') {
      DebugAndLog.warn('get_agent_asset_chunk invalid index', {
        chunkIndex,
        message: body.message
      });
      return MCPProtocol.errorResponse('INVALID_CHUNK_INDEX', {
        message: body.message,
        validRange: body.validRange
      }, 'get_agent_asset_chunk');
    }

    DebugAndLog.info('get_agent_asset_chunk response', {
      assetType: body.assetType,
      name: body.name,
      chunkIndex: body.chunkIndex,
      totalChunks: body.totalChunks
    });

    // >! Return MCP-formatted chunk response
    return MCPProtocol.successResponse('get_agent_asset_chunk', body);

  } catch (error) {
    // >! Handle ASSET_NOT_FOUND error with available asset names,
    // >! propagated from Services.AgentAssets.getChunk's internal get() call
    if (error.code === 'ASSET_NOT_FOUND') {
      DebugAndLog.warn('get_agent_asset_chunk not found', {
        error: error.message,
        availableAssets: error.availableAssets
      });

      return MCPProtocol.errorResponse('ASSET_NOT_FOUND', {
        message: error.message,
        availableAssets: error.availableAssets || []
      }, 'get_agent_asset_chunk');
    }

    // >! Map the service's strict-bucket-validation / invalid-assetType
    // >! error (INVALID_INPUT) to the same error code
    if (error.code === 'INVALID_INPUT') {
      DebugAndLog.warn('get_agent_asset_chunk invalid input', {
        error: error.message,
        invalidBuckets: error.invalidBuckets
      });

      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: error.message,
        invalidBuckets: error.invalidBuckets
      }, 'get_agent_asset_chunk');
    }

    DebugAndLog.error('get_agent_asset_chunk error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to retrieve agent asset chunk',
      error: error.message
    }, 'get_agent_asset_chunk');
  }
}

module.exports = {
  list,
  get,
  listTypes,
  getChunk
};
