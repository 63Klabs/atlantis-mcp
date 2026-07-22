'use strict';

const { build } = require('./lib/index-builder');

/**
 * Lambda handler entry point for the Documentation Indexer.
 *
 * Invoked on a schedule by EventBridge. Orchestrates a full index
 * rebuild by calling index-builder.build() which reads its
 * configuration from environment variables:
 *   - ATLANTIS_GITHUB_USER_ORGS
 *   - DOC_INDEX_TABLE
 *   - PARAM_STORE_PATH
 *
 * @param {Object} event - EventBridge scheduled event
 * @returns {Object} Result with status and build details
 */
exports.handler = async (event) => {
  console.log(JSON.stringify({
    level: 'INFO',
    event: 'handler_invoked',
    source: event.source || 'unknown',
    time: event.time || new Date().toISOString()
  }));

  try {
    const result = await build();

    console.log(JSON.stringify({
      level: 'INFO',
      event: 'handler_complete',
      status: 'success',
      version: result.version,
      totalEntries: result.totalEntries,
      totalRepos: result.totalRepos,
      duration: result.duration
    }));

    return {
      statusCode: 200,
      body: {
        status: 'success',
        version: result.version,
        totalEntries: result.totalEntries,
        totalRepos: result.totalRepos,
        duration: result.duration
      }
    };
  } catch (error) {
    console.error(JSON.stringify({
      level: 'ERROR',
      event: 'index_build_failure',
      error: error.message,
      stack: error.stack
    }));

    return {
      statusCode: 500,
      body: {
        status: 'failure',
        error: error.message
      }
    };
  }
};
