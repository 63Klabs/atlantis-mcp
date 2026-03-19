/**
 * Controllers Index
 *
 * Exports all controller modules for MCP tool request handling.
 * Controllers validate inputs, orchestrate service calls, and format MCP responses.
 *
 * @module controllers
 */

const Templates = require('./templates');
const Starters = require('./starters');
const Documentation = require('./documentation');
const Validation = require('./validation');
const Updates = require('./updates');
const Tools = require('./tools');

module.exports = {
  Templates,
  Starters,
  Documentation,
  Validation,
  Updates,
  Tools
};
