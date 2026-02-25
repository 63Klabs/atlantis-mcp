/**
 * Services module exports
 *
 * Provides business logic layer with caching for all MCP operations.
 * Services orchestrate data access through DAOs and implement caching strategies.
 *
 * @module services
 */

const Templates = require('./templates');

module.exports = {
  Templates
  // TODO: Add other services as they are implemented
  // Starters: require('./starters'),
  // Documentation: require('./documentation'),
  // Validation: require('./validation')
};
