'use strict';

const crypto = require('crypto');

/**
 * Generate a deterministic 16-character hex hash from a content path
 * using SHA-256. The truncated hash provides a 64-bit key space,
 * sufficient for the expected index size (thousands of entries).
 *
 * @param {string} contentPath - Hierarchical content path (e.g., "org/repo/file/section")
 * @returns {string} 16-character lowercase hex string
 * @example
 * const hash = hashContentPath('63klabs/cache-data/README.md/installation');
 * console.log(hash); // e.g., "ea6f1a2b3c4d5e6f"
 * console.log(hash.length); // 16
 */
function hashContentPath(contentPath) {
	return crypto
		.createHash('sha256')
		.update(contentPath)
		.digest('hex')
		.substring(0, 16);
}

module.exports = { hashContentPath };
