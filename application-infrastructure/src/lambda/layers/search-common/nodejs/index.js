'use strict';

/**
 * search-common Lambda Layer — shared code root.
 *
 * Runtime layout: everything under this `nodejs/` directory is extracted to
 * `/opt/nodejs/` in the Lambda execution environment. The read-function (query
 * path) and doc-indexer (index path) both attach this layer, so the single
 * normalization implementation (index-time and query-time tokenization) lives
 * here exactly once instead of being duplicated per function.
 *
 * Intended require path for consuming functions (added in task 1.2+):
 *   const { normalizeTerm, normalizeText } = require('/opt/nodejs/normalize');
 * The absolute `/opt/nodejs/<module>` path resolves regardless of NODE_PATH.
 *
 * Dependencies: this layer bundles NO production npm dependencies (R6.3 /
 * guiding constraint 6) — normalization is a small deterministic suffix table,
 * not a general stemmer, so no third-party dependency is needed.
 *
 * Populated by later tasks in spec 0-0-7-tool-discovery-enhancement:
 *   - Task 1.2: normalize.js (nodejs/normalize.js)
 */

module.exports = {};
