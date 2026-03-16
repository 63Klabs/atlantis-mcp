/**
 * Documentation Service
 *
 * Provides business logic for documentation search operations with caching.
 * Implements pass-through caching using cache-data package for:
 * - Documentation and code pattern search across GitHub repositories
 * - Filtering by documentation type (guide, tutorial, reference, troubleshooting, template pattern, code example)
 * - Keyword-based search with relevance ranking
 * - Suggestions when no results found
 *
 * Searches across:
 * - Markdown documentation from GitHub repositories
 * - CloudFormation template sections and patterns
 * - Python and Node.js code from app starters
 * - cache-data package usage patterns
 * - README headings and top-of-file comments
 *
 * @module services/documentation
 */

const { cache: { CacheableDataAccess } } = require('@63klabs/cache-data');
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const { Config } = require('../config');
const Models = require('../models');

/**
 * Search documentation with cache-data pass-through caching
 *
 * Searches across all configured GitHub users/orgs repositories,
 * filtering by atlantis_repository-type custom property.
 * Returns search results with title, excerpt, file path, GitHub URL, and result type.
 *
 * @param {Object} options - Search options
 * @param {string} options.query - Search query (keywords, required)
 * @param {string} [options.type] - Filter by type (documentation, template-pattern, code-example)
 * @param {string} [options.subType] - Filter by subType (guide, tutorial, reference, troubleshooting, function, resource)
 * @param {number} [options.limit=10] - Maximum results to return
 * @param {Array<string>} [options.ghusers] - Filter to specific GitHub users/orgs (optional, validated against settings)
 * @returns {Promise<Object>} { results: Array, totalResults: number, query: string, suggestions: Array, errors: Array, partialData: boolean }
 *
 * Each result object includes:
 * - title: string - Result title
 * - excerpt: string - Brief excerpt (max 200 chars)
 * - filePath: string - File path in repository or S3
 * - githubUrl: string - GitHub URL to full document (if available)
 * - type: string - Result type (documentation, template-pattern, code-example)
 * - subType: string - Result subtype (guide, tutorial, reference, troubleshooting, function, resource)
 * - relevanceScore: number - Relevance ranking score
 * - repository: string - Repository name (if from GitHub)
 * - repositoryType: string - Repository type (documentation, app-starter, templates, package, mcp)
 * - namespace: string - S3 namespace (if from S3)
 * - codeExamples: Array - Code snippets with context (if type is code-example)
 * - context: Object - Additional context (line numbers, function name, template section, etc.)
 *
 * @example
 * // Search all documentation
 * const result = await Documentation.search({ query: 'cache-data' });
 *
 * @example
 * // Search for specific type
 * const result = await Documentation.search({
 *   query: 'Lambda function',
 *   type: 'code-example'
 * });
 *
 * @example
 * // Search with subtype filter
 * const result = await Documentation.search({
 *   query: 'getting started',
 *   type: 'documentation',
 *   subType: 'tutorial'
 * });
 *
 * @example
 * // Search specific GitHub users/orgs
 * const result = await Documentation.search({
 *   query: 'CloudFormation',
 *   ghusers: ['63klabs']
 * });
 */
async function search(options = {}) {
  const { query, type, subType, limit = 10, ghusers } = options;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('query is required and must be a non-empty string');
  }

  // >! Get connection and cache profile from config
  const { conn, cacheProfile } = Config.getConnCacheProfile('doc-index', 'search');

  if (!conn || !cacheProfile) {
    throw new Error('Failed to get connection and cache profile for doc-index/search');
  }

  // >! Determine which GitHub users/orgs to search (filtered or all)
  let usersOrgsToSearch = ghusers;
  if (!usersOrgsToSearch || usersOrgsToSearch.length === 0) {
    usersOrgsToSearch = Config.settings().github.userOrgs;
  } else {
    // >! Validate that requested users/orgs are in configured users/orgs
    const validUsersOrgs = Config.settings().github.userOrgs;
    usersOrgsToSearch = usersOrgsToSearch.filter(u => validUsersOrgs.includes(u));
    if (usersOrgsToSearch.length === 0) {
      throw new Error('No valid GitHub users/orgs specified');
    }
  }

  // >! Set host to array of users/orgs (used in cache key)
  conn.host = usersOrgsToSearch;

  // >! Set parameters for cache key and DAO filtering
  conn.parameters = {
    query: query.trim(),
    type,
    subType,
    limit
  };

  // >! Define fetch function for cache miss
  const fetchFunction = async (connection, opts) => {
    DebugAndLog.debug('Searching documentation (cache miss)', {
      query: connection.parameters.query,
      type: connection.parameters.type,
      subType: connection.parameters.subType,
      limit: connection.parameters.limit,
      usersOrgs: connection.host
    });

    // >! Call Models.DocIndex.search() to perform the search
    const searchResult = await Models.DocIndex.search({
      query: connection.parameters.query,
      type: connection.parameters.type,
      subType: connection.parameters.subType,
      limit: connection.parameters.limit
    });

    // >! Return search results with metadata
    const returnObject = {
      results: searchResult.results || [],
      totalResults: searchResult.totalResults || 0,
      query: connection.parameters.query,
      suggestions: searchResult.suggestions || [],
      // No errors from DocIndex.search, but we include the field for consistency
      errors: undefined,
      partialData: false
    };

    // >! We need to wrap the list in a response format suitable for CacheableDataAccess
    // if ("errors" in list) {
    return ApiRequest.success({body: returnObject});
  };

  // >! Use cache-data pass-through caching
  const cacheObj = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    conn,
    {}, // options: for functions, tokens, non-cache data
  );

  return cacheObj.getBody(true);
}

module.exports = {
  search
};
