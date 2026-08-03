/**
 * Shared S3 Helpers
 *
 * Provides the S3 bucket-access and namespace-discovery helpers shared across
 * S3-backed Data Access Objects. Behavior-equivalent to the private
 * `checkBucketAccess` and `getIndexedNamespaces` helpers separately declared
 * in `models/s3-templates.js` and `models/s3-starters.js`.
 *
 * This module is a small, intentional duplication of those private helpers:
 * the existing template/starter DAOs are left unchanged (so their current
 * tests continue to pass) while the agent-asset DAO consumes this shared
 * module instead of re-declaring its own copies.
 *
 * @module models/s3-common
 */

const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { tools: { DebugAndLog, AWS } } = require('@63klabs/cache-data');
const ErrorHandler = require('../utils/error-handler');

/**
 * Check if a bucket has the atlantis-mcp:Allow=true tag.
 *
 * Bucket-level tag checking requires GetBucketTagging permission, which is
 * not yet configured, so access is currently assumed to be allowed whenever
 * the bucket is reachable. This mirrors the stubbed behavior of the private
 * helper of the same name in `models/s3-templates.js` / `models/s3-starters.js`.
 *
 * @param {string} bucketName - S3 bucket name
 * @returns {Promise<boolean>} True if bucket has Allow tag set to true
 * @example
 * const allowed = await checkBucketAccess('63klabs');
 * if (!allowed) {
 *   // brown-out: skip this bucket and continue with the remaining sources
 * }
 */
async function checkBucketAccess(bucketName) {
  try {
    // Note: Bucket tags require GetBucketTagging permission
    // For now, we'll assume access is allowed if bucket exists
    // TODO: Implement proper bucket tagging check when permissions are configured
    return true;
  } catch (error) {
    // >! Log S3 operation failures with bucket name, key, error details
    ErrorHandler.logS3Error({
      operation: 'GetObjectTagging',
      bucket: bucketName,
      key: '',
      error
    });
    return false;
  }
}

/**
 * Discover indexed namespaces (root-level prefixes) for a bucket.
 *
 * Issues a `ListObjectsV2Command` with `Delimiter: '/'` and maps the
 * returned `CommonPrefixes` to namespace names, matching the private helper
 * of the same name in `models/s3-templates.js` / `models/s3-starters.js`.
 *
 * @param {string} bucketName - S3 bucket name
 * @returns {Promise<string[]>} Array of namespace names in discovery order
 * @example
 * const namespaces = await getIndexedNamespaces('63klabs');
 * // => ['atlantis']
 */
async function getIndexedNamespaces(bucketName) {
  try {
    // TODO: Implement bucket tag reading when permissions are configured
    // For now, discover namespaces by listing root-level directories
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Delimiter: '/',
      MaxKeys: 100
    });

    const response = await AWS.s3.client.send(command);
    const namespaces = (response.CommonPrefixes || [])
      .map(prefix => prefix.Prefix.replace(/\/$/, ''))
      .filter(ns => ns.length > 0);

    DebugAndLog.debug(`Discovered namespaces in ${bucketName}: ${namespaces.join(', ')}`);
    return namespaces;
  } catch (error) {
    // >! Log S3 operation failures with bucket name, key, error details
    ErrorHandler.logS3Error({
      operation: 'ListObjectsV2',
      bucket: bucketName,
      error
    });
    return [];
  }
}

module.exports = {
  checkBucketAccess,
  getIndexedNamespaces
};
