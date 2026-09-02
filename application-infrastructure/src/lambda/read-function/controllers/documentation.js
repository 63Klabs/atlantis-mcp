/**
 * Documentation Controller
 *
 * Handles MCP tool requests for documentation search operations.
 * Validates inputs, orchestrates service calls, and formats MCP responses.
 *
 * Supported operations:
 * - search() - Search Atlantis documentation, tutorials, and code patterns
 * - getDocument() - Retrieve the full stored source file behind a search result
 * - getDocumentChunk() - Retrieve one chunk of a document too large for a single response
 *
 * @module controllers/documentation
 */

const Services = require('../services');
const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');
const ContentChunker = require('../utils/content-chunker');
const { cache: { CacheableDataAccess }, tools: { DebugAndLog, ApiRequest } } = require('@63klabs/cache-data');
const { Config } = require('../config');

/**
 * Validate that exactly one of filePath or hash is provided.
 *
 * The MCP protocol does not support oneOf at the schema root level, so this
 * validation must be done programmatically in the controller.
 *
 * @param {string|undefined} filePath - File path lookup key
 * @param {string|undefined} hash - Hash lookup key
 * @throws {Error} When neither or both parameters are provided
 * @private
 */
function validateLookupKey(filePath, hash) {
  const hasFilePath = filePath !== undefined && filePath !== null && filePath !== '';
  const hasHash = hash !== undefined && hash !== null && hash !== '';

  if (!hasFilePath && !hasHash) {
    throw new Error('Exactly one of filePath or hash is required');
  }

  if (hasFilePath && hasHash) {
    throw new Error('Cannot specify both filePath and hash - provide exactly one');
  }
}

/**
 * Search Atlantis documentation and code patterns
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.body - Request body containing tool input
 * @param {Object} [props.authInfo] - Optional resolved auth context
 *   (`{ tier, isAuthenticated, ... }`). Passed through to the service so retrieval strategy
 *   can gate on the caller's tier (tasks 6.2/6.3). Defaults to a public-tier context when
 *   omitted. Only the tier is used/logged here; identity/PII is never logged.
 * @returns {Promise<Object>} MCP-formatted response with search results
 *
 * @example
 * const response = await Documentation.search({
 *   body: {
 *     input: {
 *       query: 'S3 bucket configuration',
 *       type: 'template-pattern',
 *       subType: 'parameter',
 *       ghusers: ['63klabs']
 *     }
 *   }
 * });
 */
async function search(props) {
  try {
    // >! Validate input against JSON Schema
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('search_documentation', input);

    if (!validation.valid) {
      DebugAndLog.warn('search_documentation validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'search_documentation');
    }

    // >! Extract parameters (query, type, subType, ghusers). `type`/`subType` are optional
    // >! filters; when absent they are passed through as undefined so the service applies
    // >! no filtering (unchanged behavior).
    const { query, type, subType, ghusers } = input;

    // >! Resolve caller tier (defaults to public tier). Threaded to the service for future
    // >! tier-gated retrieval-strategy selection (tasks 6.2/6.3). Search behavior is
    // >! unchanged in this task. Log the tier only; never log the auth identity/PII.
    const authInfo = props.authInfo || { tier: 'public', isAuthenticated: false };

    DebugAndLog.info('search_documentation request', {
      query,
      type: type || 'all',
      subType: subType || 'all',
      ghusersCount: ghusers ? ghusers.length : 0,
      tier: authInfo.tier
    });

    // >! Call Services.Documentation.search()
    // >! authInfo is passed through as an added field; keyword search behavior is unchanged.
    const result = await Services.Documentation.search({
      query,
      type,
      subType,
      ghusers,
      authInfo
    });

    DebugAndLog.info('search_documentation response', {
      resultCount: result.results ? result.results.length : 0,
      hasSuggestions: result.suggestions && result.suggestions.length > 0,
      partialData: result.partialData || false,
      errorCount: result.errors ? result.errors.length : 0
    });

    // >! Return MCP-formatted response with suggestions if no results
    if (result.results && result.results.length === 0 && result.suggestions) {
      DebugAndLog.info('search_documentation no results, providing suggestions', {
        suggestionCount: result.suggestions.length
      });
    }

    return MCPProtocol.successResponse('search_documentation', result);

  } catch (error) {
    DebugAndLog.error('search_documentation error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to search documentation',
      error: error.message
    }, 'search_documentation');
  }
}

/**
 * Build the MCP error response for a storage miss.
 *
 * A miss is not an internal failure: the document simply is not in the index yet (or its
 * item expired). The response therefore identifies what was requested and carries the
 * file-level `githubUrl` — or `null` when it could not be derived — so the client can fetch
 * the file directly. The server never fetches from GitHub itself (Requirements 6.8, 6.9).
 *
 * @param {Error} error - Error thrown by the service with `code === 'DOCUMENT_NOT_FOUND'`
 * @param {string} toolName - Tool name to attribute the error to
 * @returns {Object} MCP-formatted DOCUMENT_NOT_FOUND error response
 * @private
 */
function documentNotFoundResponse(error, toolName) {
  DebugAndLog.warn(`${toolName} document not found in storage`, {
    filePath: error.filePath || null,
    hash: error.hash || null,
    hasGithubUrl: Boolean(error.githubUrl)
  });

  return MCPProtocol.errorResponse('DOCUMENT_NOT_FOUND', {
    message: error.message,
    filePath: error.filePath || null,
    hash: error.hash || null,
    githubUrl: error.githubUrl || null
  }, toolName);
}

/**
 * Retrieve the full stored source file behind a search result (the `get_document` tool).
 *
 * Storage-only: the document is read from the documentation index and never fetched from
 * GitHub. Requires no elevated tier and is independent of the active retrieval mode
 * (Requirement 6.6).
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.bodyParameters - Request body containing tool input
 *   (`input.filePath` or `input.hash`, exactly one)
 * @param {Object} [props.authInfo] - Optional resolved auth context (`{ tier, ... }`).
 *   Passed through for logging/interface symmetry only; `get_document` applies no tier
 *   gating. Only the tier is logged; identity/PII is never logged.
 * @returns {Promise<Object>} MCP-formatted response with the document, or an
 *   INVALID_INPUT / DOCUMENT_NOT_FOUND / INTERNAL_ERROR error response
 *
 * @example
 * const response = await Documentation.getDocument({
 *   bodyParameters: {
 *     input: { filePath: '63klabs/cache-data/README.md/installation' }
 *   }
 * });
 */
async function getDocument(props) {
  try {
    // >! Validate input before any storage read. `filePath`/`hash` are opaque lookup keys.
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('get_document', input);

    if (!validation.valid) {
      DebugAndLog.warn('get_document validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'get_document');
    }

    const { filePath, hash } = input;

    // >! Validate exactly-one-of constraint (MCP schema cannot enforce this with oneOf)
    try {
      validateLookupKey(filePath, hash);
    } catch (validationError) {
      DebugAndLog.warn('get_document lookup key validation failed', {
        error: validationError.message,
        hasFilePath: Boolean(filePath),
        hasHash: Boolean(hash)
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: validationError.message,
        errors: [validationError.message]
      }, 'get_document');
    }

    const authInfo = props.authInfo || { tier: 'public', isAuthenticated: false };

    DebugAndLog.info('get_document request', {
      filePath: filePath || null,
      hash: hash || null,
      tier: authInfo.tier
    });

    const document = await Services.Documentation.getDocument({ filePath, hash, authInfo });

    // >! Null guard: the service signals a miss by throwing, but treat a null result as a
    // >! miss too rather than returning an empty success payload.
    if (!document) {
      return documentNotFoundResponse(Object.assign(
        new Error(`Document not found in storage: ${filePath || hash}`),
        { filePath: filePath || null, hash: hash || null, githubUrl: null }
      ), 'get_document');
    }

    DebugAndLog.info('get_document response', {
      filePath: document.filePath,
      hasGithubUrl: Boolean(document.githubUrl),
      contentLength: document.content ? document.content.length : 0
    });

    return MCPProtocol.successResponse('get_document', document);

  } catch (error) {
    if (error.code === 'DOCUMENT_NOT_FOUND') {
      return documentNotFoundResponse(error, 'get_document');
    }

    DebugAndLog.error('get_document error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to retrieve document',
      error: error.message
    }, 'get_document');
  }
}

/**
 * Retrieve one chunk of a document too large to return in a single `get_document` response
 * (the `get_document_chunk` tool).
 *
 * Mirrors `controllers/templates.js` `getChunk()`: uses `CacheableDataAccess` (the
 * `document-chunks`/`doc-chunk-data` connection profile) to cache individual chunk results
 * keyed by lookup key and chunk index. On cache miss, re-resolves the document from storage
 * via `Services.Documentation.getDocument`, serializes it, splits it with `ContentChunker`,
 * and returns the requested chunk. Concatenating chunks `0..totalChunks - 1` reproduces the
 * serialized `get_document` payload.
 *
 * @param {Object} props - Request properties from ClientRequest
 * @param {Object} props.bodyParameters - Request body containing tool input
 *   (`input.chunkIndex` plus exactly one of `input.filePath` / `input.hash`)
 * @param {Object} [props.authInfo] - Optional resolved auth context (`{ tier, ... }`),
 *   logged only; no tier gating is applied.
 * @returns {Promise<Object>} MCP-formatted chunk response, or an INVALID_INPUT /
 *   INVALID_CHUNK_INDEX / DOCUMENT_NOT_FOUND / INTERNAL_ERROR error response
 *
 * @example
 * const response = await Documentation.getDocumentChunk({
 *   bodyParameters: {
 *     input: { filePath: '63klabs/cache-data/README.md/installation', chunkIndex: 0 }
 *   }
 * });
 */
async function getDocumentChunk(props) {
  try {
    // >! Validate input before any storage read.
    const input = props.bodyParameters?.input || {};
    const validation = SchemaValidator.validate('get_document_chunk', input);

    if (!validation.valid) {
      DebugAndLog.warn('get_document_chunk validation failed', {
        errors: validation.errors,
        input
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: 'Input validation failed',
        errors: validation.errors
      }, 'get_document_chunk');
    }

    const { filePath, hash, chunkIndex } = input;

    // >! Validate exactly-one-of constraint (MCP schema cannot enforce this with oneOf)
    try {
      validateLookupKey(filePath, hash);
    } catch (validationError) {
      DebugAndLog.warn('get_document_chunk lookup key validation failed', {
        error: validationError.message,
        hasFilePath: Boolean(filePath),
        hasHash: Boolean(hash)
      });
      return MCPProtocol.errorResponse('INVALID_INPUT', {
        message: validationError.message,
        errors: [validationError.message]
      }, 'get_document_chunk');
    }

    const authInfo = props.authInfo || { tier: 'public', isAuthenticated: false };

    DebugAndLog.info('get_document_chunk request', {
      filePath: filePath || null,
      hash: hash || null,
      chunkIndex,
      tier: authInfo.tier
    });

    // >! Get connection and cache profile for document-chunks
    const { conn, cacheProfile } = Config.getConnCacheProfile('document-chunks', 'doc-chunk-data');

    if (!conn || !cacheProfile) {
      const errorMsg = 'get_document_chunk: Failed to get connection and/or cache profile for document-chunks/doc-chunk-data';
      DebugAndLog.error(errorMsg);
      throw new Error(errorMsg);
    }

    // >! Set parameters for cache key generation and fetch function
    conn.parameters = { filePath, hash, chunkIndex };

    // >! Define fetch function that reads all parameters from connection.parameters
    const fetchFunction = async (connection, _opts) => {
      const { filePath, hash, chunkIndex } = connection.parameters;

      // >! Re-resolve the document via the service (storage-only; never a GitHub fetch)
      const document = await Services.Documentation.getDocument({ filePath, hash, authInfo });

      // >! Serialize and chunk
      const serialized = JSON.stringify(document);
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
          filePath: document.filePath,
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
      DebugAndLog.warn('get_document_chunk invalid index', {
        chunkIndex,
        message: body.message
      });
      return MCPProtocol.errorResponse('INVALID_CHUNK_INDEX', {
        message: body.message,
        validRange: body.validRange
      }, 'get_document_chunk');
    }

    DebugAndLog.info('get_document_chunk response', {
      filePath: body.filePath,
      chunkIndex: body.chunkIndex,
      totalChunks: body.totalChunks
    });

    return MCPProtocol.successResponse('get_document_chunk', body);

  } catch (error) {
    if (error.code === 'DOCUMENT_NOT_FOUND') {
      return documentNotFoundResponse(error, 'get_document_chunk');
    }

    DebugAndLog.error('get_document_chunk error', {
      error: error.message,
      stack: error.stack
    });

    return MCPProtocol.errorResponse('INTERNAL_ERROR', {
      message: 'Failed to retrieve document chunk',
      error: error.message
    }, 'get_document_chunk');
  }
}

module.exports = {
  search,
  getDocument,
  getDocumentChunk
};
