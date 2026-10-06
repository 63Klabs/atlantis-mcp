'use strict';

const path = require('path');

/**
 * Files excluded from indexing regardless of directory path. This is the global default
 * exclusion set; the per-repository-type policy matrix (see {@link EXCLUSION_POLICY} and
 * {@link getExcludedFilesForType}) derives each type's actual exclusion set from this one.
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
 * File excluded from indexing for every repository type, unconditionally. `AGENTS.md` is
 * served through the `agents-md` agent-asset channel, so indexing it would put the same
 * guidance on two surfaces with different freshness (design 10.2). This exclusion is
 * applied before the type-specific policy matrix below and cannot be overridden by any
 * classification, including `absent`.
 * @type {string}
 */
const ALWAYS_EXCLUDED_FILE = 'AGENTS.md';

/**
 * `EXCLUDED_FILES` minus `CHANGELOG.md`, used by the `package` classification so that
 * version and migration questions can be answered from the changelog (design 10.2,
 * Requirement 9.4).
 * @type {Set<string>}
 */
const PACKAGE_EXCLUDED_FILES = new Set(
	Array.from(EXCLUDED_FILES).filter((fileName) => fileName !== 'CHANGELOG.md')
);

/**
 * Repository classifications recognized by the exclusion policy matrix (design 10.2),
 * excluding `package` and `absent`, which have dedicated handling. Repository types
 * outside this known set (as well as a missing/unrecognized `repositoryType`) fall back
 * to the global default exclusion set, same as these.
 * @type {Array<string>}
 */
const GLOBAL_POLICY_REPOSITORY_TYPES = ['documentation', 'templates', 'app-starter', 'mcp', 'management'];

/**
 * Per-repository-type file-exclusion policy matrix (design 10.2, Requirements 9.3, 9.4, 9.5).
 *
 * Each entry maps a `repositoryType` classification to the `EXCLUDED_FILES`-derived set
 * that applies to it:
 * - `package` — global exclusions minus `CHANGELOG.md`.
 * - `documentation`, `templates`, `app-starter`, `mcp`, `management` — global exclusions.
 * - `absent` — no filename-based exclusions at all (an empty set); directory and
 *   extension/template-YAML rules still apply, since those are outside the scope of this
 *   matrix (design 10.2 governs `EXCLUDED_FILES` specifically).
 *
 * `fetch-failed` is intentionally absent from this matrix: carry-forward resolution
 * (design 10.3, task 16.2) happens before `isIndexable` is ever called, so by the time a
 * `repositoryType` reaches this matrix it is already a resolved classification. As a
 * last-resort safety net ahead of that work landing, an unrecognized value such as the
 * literal string `'fetch-failed'` falls through to the global default below rather than
 * throwing or silently excluding nothing.
 *
 * @type {Object<string, Set<string>>}
 */
const EXCLUSION_POLICY = {
	package: PACKAGE_EXCLUDED_FILES,
	absent: new Set()
};
for (const type of GLOBAL_POLICY_REPOSITORY_TYPES) {
	EXCLUSION_POLICY[type] = EXCLUDED_FILES;
}

/**
 * Resolve the `EXCLUDED_FILES`-derived set that applies to a given repository
 * classification, per the policy matrix in design 10.2.
 *
 * `repositoryType` is treated as the global default (full `EXCLUDED_FILES`) whenever it is
 * missing, `null`, `undefined`, or any value not present in {@link EXCLUSION_POLICY}.
 * `absent` must be passed as the explicit string `'absent'` to receive the no-exclusions
 * policy — it is never inferred from an omitted argument, so a caller that forgot to
 * resolve/pass a type does not silently get every repository's files exempted from
 * exclusion.
 *
 * @param {string} [repositoryType] - Resolved repository classification (e.g. `'package'`,
 *   `'documentation'`, `'absent'`), or omitted/unrecognized for the global default
 * @returns {Set<string>} The exclusion set to apply for `EXCLUDED_FILES` purposes
 */
function getExcludedFilesForType(repositoryType) {
	if (repositoryType && EXCLUSION_POLICY[repositoryType]) {
		return EXCLUSION_POLICY[repositoryType];
	}
	return EXCLUDED_FILES;
}

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
 * Determine whether a file should be indexed based on its path and the repository's
 * classification.
 *
 * Rules:
 * - File must not be inside an excluded directory (at any level)
 * - Extension must be one of: .md, .js, .jsx, .py, .yml, .yaml
 * - YAML files (.yml/.yaml) are only indexable when the filename matches template*.yml / template*.yaml
 * - `AGENTS.md` is never indexable, regardless of `repositoryType` (see {@link ALWAYS_EXCLUDED_FILE})
 * - Otherwise, the file-exclusion policy matrix (design 10.2, Requirements 9.3, 9.4, 9.5;
 *   see {@link EXCLUSION_POLICY} / {@link getExcludedFilesForType}) determines which
 *   `EXCLUDED_FILES`-derived set applies for the given `repositoryType`
 *
 * @param {string} filePath - File path within the archive (e.g., "src/lib/utils.js")
 * @param {string} [repositoryType] - Resolved repository classification (e.g. `'package'`,
 *   `'documentation'`, `'absent'`). Omitted/unrecognized values fall back to the global
 *   default exclusion set.
 * @returns {boolean} True if the file should be indexed
 * @example
 * isIndexable('README.md');                        // true
 * isIndexable('src/index.js');                     // true
 * isIndexable('template.yml');                     // true
 * isIndexable('config.yml');                       // false (YAML but not template*)
 * isIndexable('LICENSE.md');                       // false (excluded file)
 * isIndexable('CHANGELOG.md', 'package');          // true (package policy keeps CHANGELOG.md)
 * isIndexable('CHANGELOG.md', 'documentation');     // false (global policy excludes it)
 * isIndexable('LICENSE.md', 'absent');             // true (absent has no exclusions)
 * isIndexable('AGENTS.md', 'absent');              // false (always excluded)
 * isIndexable('.github/workflows/ci.yml');         // false (excluded dir .*)
 * isIndexable('src/tests/unit/foo.test.js');       // false (excluded dir tests)
 * isIndexable('lib/node_modules/pkg/index.js');    // false (excluded dir node_modules)
 */
function isIndexable(filePath, repositoryType) {
	if (isInExcludedDirectory(filePath)) {
		return false;
	}

	const fileName = path.basename(filePath);
	const ext = path.extname(filePath).toLowerCase();

	if (!INDEXABLE_EXTENSIONS.has(ext)) {
		return false;
	}

	if (fileName === ALWAYS_EXCLUDED_FILE) {
		return false;
	}

	if (getExcludedFilesForType(repositoryType).has(fileName)) {
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
