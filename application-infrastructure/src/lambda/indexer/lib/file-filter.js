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
 * Directory patterns excluded from indexing at any level in the tree.
 * Supports simple wildcards: `.*` matches any directory starting with `.`
 * (e.g., `.git`, `.github`, `.kiro`). Literal names match exactly.
 *
 * @type {Array<string>}
 */
const EXCLUDED_DIRECTORIES = [
	'.*',
	'node_modules',
	'tests',
	'test',
	'build',
	'dist',
	'coverage'
];

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
 * Convert a simple directory exclusion pattern to a RegExp.
 * Supports `*` as a wildcard matching zero or more characters.
 *
 * @param {string} pattern - Directory name pattern (e.g., ".*", "node_modules")
 * @returns {RegExp} Compiled regex anchored to match the full directory name
 */
function patternToRegex(pattern) {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	return new RegExp(`^${escaped}$`);
}

/**
 * Pre-compiled regexes for excluded directory patterns.
 * @type {Array<RegExp>}
 */
const EXCLUDED_DIR_REGEXES = EXCLUDED_DIRECTORIES.map(patternToRegex);

/**
 * Check whether any directory segment in a file path matches an excluded
 * directory pattern.
 *
 * @param {string} filePath - File path (e.g., "src/.git/config" or "tests/unit/foo.js")
 * @returns {boolean} True if the path contains an excluded directory
 */
function isInExcludedDirectory(filePath) {
	const segments = filePath.split('/');
	// Check all segments except the last (which is the filename)
	for (let i = 0; i < segments.length - 1; i++) {
		const dir = segments[i];
		for (const regex of EXCLUDED_DIR_REGEXES) {
			if (regex.test(dir)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Determine whether a file should be indexed based on its path.
 *
 * Rules:
 * - File must not be inside an excluded directory (at any level)
 * - Extension must be one of: .md, .js, .jsx, .py, .yml, .yaml
 * - YAML files (.yml/.yaml) are only indexable when the filename matches template*.yml / template*.yaml
 * - Files in the EXCLUDED_FILES list are never indexable
 *
 * @param {string} filePath - File path within the archive (e.g., "src/lib/utils.js")
 * @returns {boolean} True if the file should be indexed
 * @example
 * isIndexable('README.md');                        // true
 * isIndexable('src/index.js');                     // true
 * isIndexable('template.yml');                     // true
 * isIndexable('config.yml');                       // false (YAML but not template*)
 * isIndexable('LICENSE.md');                       // false (excluded file)
 * isIndexable('.github/workflows/ci.yml');         // false (excluded dir .*)
 * isIndexable('src/tests/unit/foo.test.js');       // false (excluded dir tests)
 * isIndexable('lib/node_modules/pkg/index.js');    // false (excluded dir node_modules)
 */
function isIndexable(filePath) {
	if (isInExcludedDirectory(filePath)) {
		return false;
	}

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

module.exports = {
	isIndexable,
	isInExcludedDirectory,
	EXCLUDED_FILES,
	EXCLUDED_DIRECTORIES,
	INDEXABLE_EXTENSIONS
};
