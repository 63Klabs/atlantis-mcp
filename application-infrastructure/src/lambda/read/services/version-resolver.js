/**
 * Version Resolver Service
 *
 * Detects the format of a version string and resolves it to a canonical
 * Human_Readable_Version. Supports three formats:
 * - Human_Readable_Version: `vX.X.X/YYYY-MM-DD`
 * - Short_Version: `vX.X.X`
 * - S3_VersionId: any other non-empty string
 *
 * Used by the Updates Controller to normalize `currentVersion` input
 * before performing update comparisons.
 *
 * @module services/version-resolver
 */

/** Format constant for full human-readable version strings (vX.X.X/YYYY-MM-DD) */
const HUMAN_READABLE_VERSION = 'HUMAN_READABLE_VERSION';

/** Format constant for short semver version strings (vX.X.X) */
const SHORT_VERSION = 'SHORT_VERSION';

/** Format constant for raw S3 version identifier strings */
const S3_VERSION_ID = 'S3_VERSION_ID';

/** @private Regex for Human_Readable_Version: vX.X.X/YYYY-MM-DD */
const HUMAN_READABLE_PATTERN = /^v\d+\.\d+\.\d+\/\d{4}-\d{2}-\d{2}$/;

/** @private Regex for Short_Version: vX.X.X */
const SHORT_VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;

/**
 * Detect the format of a version string.
 *
 * Classifies the input as one of three version formats using regex matching:
 * - `vX.X.X/YYYY-MM-DD` → HUMAN_READABLE_VERSION
 * - `vX.X.X` → SHORT_VERSION
 * - Any other non-empty string → S3_VERSION_ID
 *
 * @param {string} versionString - Version string to classify
 * @returns {string} One of 'HUMAN_READABLE_VERSION', 'SHORT_VERSION', or 'S3_VERSION_ID'
 *
 * @example
 * detectFormat('v1.3.4/2024-01-10'); // 'HUMAN_READABLE_VERSION'
 *
 * @example
 * detectFormat('v1.3.4'); // 'SHORT_VERSION'
 *
 * @example
 * detectFormat('3sL4kqtJlcpXroDTDmJ.xUZJFfMREQ.m'); // 'S3_VERSION_ID'
 */
function detectFormat(versionString) {
  if (HUMAN_READABLE_PATTERN.test(versionString)) {
    return HUMAN_READABLE_VERSION;
  }

  if (SHORT_VERSION_PATTERN.test(versionString)) {
    return SHORT_VERSION;
  }

  return S3_VERSION_ID;
}

/**
 * Resolve a Short_Version to its full Human_Readable_Version by searching
 * the version history for an entry whose `version` starts with the given prefix.
 *
 * @param {string} shortVersion - Short version string (e.g., 'v1.3.4')
 * @param {Object} versionHistory - Version history from Templates.listVersions()
 * @param {Array<Object>} versionHistory.versions - Array of version entries
 * @returns {string} Full Human_Readable_Version if found, or the original shortVersion if no match
 *
 * @example
 * const full = resolveShortVersion('v1.3.4', {
 *   versions: [{ version: 'v1.3.4/2024-01-10', versionId: 'abc123' }]
 * });
 * // Returns: 'v1.3.4/2024-01-10'
 */
function resolveShortVersion(shortVersion, versionHistory) {
  const versions = versionHistory && versionHistory.versions ? versionHistory.versions : [];
  const match = versions.find(entry => entry.version && entry.version.startsWith(shortVersion));

  return match ? match.version : shortVersion;
}

/**
 * Resolve an S3_VersionId to its associated Human_Readable_Version by searching
 * the version history for an entry whose `versionId` matches exactly.
 *
 * @param {string} versionId - S3 version identifier string
 * @param {Object} versionHistory - Version history from Templates.listVersions()
 * @param {Array<Object>} versionHistory.versions - Array of version entries
 * @returns {string} The associated Human_Readable_Version
 * @throws {Error} With code 'VERSION_RESOLUTION_FAILED' if no matching versionId is found
 *
 * @example
 * const full = resolveVersionId('abc123', {
 *   versions: [{ version: 'v1.3.4/2024-01-10', versionId: 'abc123' }]
 * });
 * // Returns: 'v1.3.4/2024-01-10'
 */
function resolveVersionId(versionId, versionHistory) {
  const versions = versionHistory && versionHistory.versions ? versionHistory.versions : [];
  const match = versions.find(entry => entry.versionId === versionId);

  if (match) {
    return match.version;
  }

  const error = new Error('Could not resolve version identifier to a known version');
  error.code = 'VERSION_RESOLUTION_FAILED';
  throw error;
}

/**
 * Resolve a version string to its canonical Human_Readable_Version.
 *
 * If the input is already a Human_Readable_Version, it is returned immediately.
 * For Short_Version or S3_VersionId formats, the template's version history is
 * queried via `Services.Templates.listVersions()` and the appropriate resolver
 * is called.
 *
 * @async
 * @param {string} versionString - Version string in any supported format
 * @param {Object} templateInfo - Template identification for version history lookup
 * @param {string} templateInfo.category - Template category
 * @param {string} templateInfo.templateName - Template name
 * @param {Array<string>} [templateInfo.s3Buckets] - S3 buckets filter
 * @param {string} [templateInfo.namespace] - Namespace filter
 * @returns {Promise<string>} Resolved Human_Readable_Version
 * @throws {Error} With code 'VERSION_RESOLUTION_FAILED' if S3_VersionId cannot be resolved
 *
 * @example
 * // Human_Readable_Version passes through
 * const version = await resolve('v1.3.4/2024-01-10', { category: 'storage', templateName: 'my-template' });
 * // Returns: 'v1.3.4/2024-01-10'
 *
 * @example
 * // Short_Version resolved via version history
 * const version = await resolve('v1.3.4', { category: 'storage', templateName: 'my-template' });
 * // Returns: 'v1.3.4/2024-01-10' (if found in history)
 */
async function resolve(versionString, templateInfo) {
  const format = detectFormat(versionString);

  if (format === HUMAN_READABLE_VERSION) {
    return versionString;
  }

  // Lazy require to avoid circular dependency (version-resolver is in services/)
  const Services = require('../services');

  const versionHistory = await Services.Templates.listVersions({
    category: templateInfo.category,
    templateName: templateInfo.templateName,
    s3Buckets: templateInfo.s3Buckets,
    namespace: templateInfo.namespace
  });

  if (format === SHORT_VERSION) {
    return resolveShortVersion(versionString, versionHistory);
  }

  return resolveVersionId(versionString, versionHistory);
}

module.exports = {
  detectFormat,
  resolve,
  resolveShortVersion,
  resolveVersionId,
  HUMAN_READABLE_VERSION,
  SHORT_VERSION,
  S3_VERSION_ID
};
