/**
 * Services module exports
 *
 * Provides business logic layer with caching for all MCP operations.
 * Services orchestrate data access through DAOs and implement caching strategies.
 *
 * @module services
 */

const Templates = require('./templates');
const Starters = require('./starters');
const Documentation = require('./documentation');
const Validation = require('./validation');
const VersionResolver = require('./version-resolver');

module.exports = {
  Templates,
  Starters,
  Documentation,
  Validation,
  VersionResolver
};
