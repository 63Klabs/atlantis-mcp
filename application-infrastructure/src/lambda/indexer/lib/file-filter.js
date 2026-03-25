'use strict';

const path = require('path');

/**
 * Files excluded from indexing regardless of directory path.
 * @type {Set<string>}
 */
const EXCLUDED_FILES = new Set([
	'LICENSE.md',
	'CONTRIBUTING.md',
	'CONTRIBUTE.md',
	'CHANGELOG.md',
	'AGENTS.md',
	'SECURITY.md'
]);

/**
 * Extensions eligible for indexing.
 * @type {Set<string>}
 */
const INDEXABLE_EXTENSIONS = new Set(['.md', '.js', '.jsx', '.py', '.yml', '.yaml']);

/**
 * Regex matching CloudFormation template YAML filenames.
 * @type {RegExp}
 */
const TEMPLATE_YAML_PATTERN = /^template.*\.(yml|yaml)$/i;

/**
 * Determine whether a file should be indexed based on its path.
 *
 * Rules:
 * - Extension must be one of: .md, .js, .jsx, .py, .yml, .yaml
 * - YAML files (.yml/.yaml) are only indexable when the filename matches template*.yml / template*.yaml
 * - Files in the EXCLUDED_FILES list are never indexable
 *
 * @param {string} filePath - File path within the archive (e.g., "src/lib/utils.js")
 * @returns {boolean} True if the file should be indexed
 * @example
 * isIndexable('README.md');                  // true
 * isIndexable('src/index.js');               // true
 * isIndexable('template.yml');               // true
 * isIndexable('config.yml');                 // false (YAML but not template*)
 * isIndexable('LICENSE.md');                 // false (excluded)
 */
function isIndexable(filePath) {
	const fileName = path.basename(filePath);
	const ext = path.extname(filePath).toLowerCase();

	if (!INDEXABLE_EXTENSIONS.has(ext)) {
		return false;
	}

	if (EXCLUDED_FILES.has(fileName)) {
		return false;
	}

	if (ext === '.yml' || ext === '.yaml') {
		return TEMPLATE_YAML_PATTERN.test(fileName);
	}

	return true;
}

module.exports = { isIndexable, EXCLUDED_FILES, INDEXABLE_EXTENSIONS };
