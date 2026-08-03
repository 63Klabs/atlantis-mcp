/**
 * Models Index
 *
 * Exports all data access objects (DAOs) for the read Lambda function.
 *
 * @module models
 */

const S3Templates = require('./s3-templates');
const S3Starters = require('./s3-starters');
const GitHubAPI = require('./github-api');
const DocIndex = require('./doc-index');
const S3Common = require('./s3-common');
const S3AgentAssets = require('./s3-agent-assets');

module.exports = {
  S3Templates,
  S3Starters,
  GitHubAPI,
  DocIndex,
  S3Common,
  S3AgentAssets
};
