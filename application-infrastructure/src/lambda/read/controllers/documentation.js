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
    const input = props.body?.input || {};
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
    
    DebugAndLog.info('search_documentation request', {
      query,
      type: type || 'all',
      ghusersCount: ghusers ? ghusers.length : 0
    });
    
    // >! Call Services.Documentation.search()
    const result = await Services.Documentation.search({
      query,
      type,
      ghusers
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
