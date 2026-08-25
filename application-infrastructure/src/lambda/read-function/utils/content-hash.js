'use strict';

const crypto = require('crypto');

/**
 * Length (in hex characters) of a content-path hash. Matches the doc-indexer's
 * `lib/hasher.js` truncation, giving a 64-bit key space that is sufficient for the
 * expected index size.
 *
 * @constant {number}
 */
const CONTENT_HASH_LENGTH = 16;

/**
 * Generate the deterministic content-path hash used as the DynamoDB content key.
 *
 * This MUST stay byte-identical to the doc-indexer's `lib/hasher.js` `hashContentPath()`
 * (SHA-256 of the path, truncated to the first 16 lowercase hex characters). The indexer
 * derives both the section key (`content:{hash}`) and the per-file document key
 * (`document:{fileHash}`) this way, so the read path can only resolve a caller-supplied
 * `filePath` to a stored item by reproducing the same transformation.
 *
 * The input is treated as an opaque lookup key: it is hashed, never used as a file-system
 * path or shell argument.
 *
 * @param {string} contentPath - Hierarchical content path (e.g. `"org/repo/file/section"`)
 * @returns {string} 16-character lowercase hex string
 * @example
 * const hash = hashContentPath('63klabs/cache-data/README.md/installation');
 * console.log(hash.length); // 16
 */
function hashContentPath(contentPath) {
  return crypto
    .createHash('sha256')
    .update(contentPath)
    .digest('hex')
    .substring(0, CONTENT_HASH_LENGTH);
}

/**
 * Strip the trailing `/{slug}` segment from a section contentPath to derive the owning
 * file's document path.
 *
 * A section contentPath is `{org}/{repo}/{filePath}/{slug}`; the document path the indexer
 * hashed into `document:{fileHash}` is the same value without the heading slug. Used as the
 * resolution fallback when a section's metadata item is missing (so `documentHash` cannot be
 * read directly).
 *
 * @param {string} contentPath - Section contentPath (`{org}/{repo}/{filePath}/{slug}`)
 * @returns {?string} The contentPath without its final segment, or `null` when the input is
 *   not a string or has no separator to strip
 * @example
 * stripSlug('63klabs/cache-data/README.md/installation');
 * // '63klabs/cache-data/README.md'
 */
function stripSlug(contentPath) {
  if (typeof contentPath !== 'string') {
    return null;
  }

  const lastSeparator = contentPath.lastIndexOf('/');
  if (lastSeparator <= 0) {
    return null;
  }

  return contentPath.slice(0, lastSeparator);
}

module.exports = {
  hashContentPath,
  stripSlug,
  CONTENT_HASH_LENGTH
};
