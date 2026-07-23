/**
 * Documentation Controller
 *
 * Handles MCP tool requests for documentation search operations.
 * Validates inputs, orchestrates service calls, and formats MCP responses.
 *
 * Supported operations:
 * - search() - Search Atlantis documentation, tutorials, and code patterns
 *
 * @module controllers/documentation
 */

const Services = require('../services');
const SchemaValidator = require('../utils/schema-validator');
const MCPProtocol = require('../utils/mcp-protocol');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');

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
 *       type: 'template pattern',
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

    // >! Extract parameters (query, type, ghusers)
    const { query, type, ghusers } = input;

    // >! Resolve caller tier (defaults to public tier). Threaded to the service for future
    // >! tier-gated retrieval-strategy selection (tasks 6.2/6.3). Search behavior is
    // >! unchanged in this task. Log the tier only; never log the auth identity/PII.
    const authInfo = props.authInfo || { tier: 'public', isAuthenticated: false };

    DebugAndLog.info('search_documentation request', {
      query,
      type: type || 'all',
      ghusersCount: ghusers ? ghusers.length : 0,
      tier: authInfo.tier
    });

    // >! Call Services.Documentation.search()
    // >! authInfo is passed through as an added field; keyword search behavior is unchanged.
    const result = await Services.Documentation.search({
      query,
      type,
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

module.exports = {
  search
};
