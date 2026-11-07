/**
 * Scan test: no Auth function source sets or throws a 403 or 404
 *
 * Reads every non-test .js file under the Auth function (excluding node_modules, tests, and
 * coverage), strips comments, and fails when executable code sets a status of 403 or 404.
 *
 * >! CloudFront rewrites every origin response with status 403 or 404 to /index.html with
 * >! status 200, so a JSON client would parse the landing page. The Auth function must use
 * >! the constants in utils/status-codes.js instead.
 *
 * @module tests/unit/no-rewritten-statuses
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Root of the Auth function (this file is at <root>/tests/unit). */
const AUTH_FUNCTION_ROOT = path.resolve(__dirname, '..', '..');

/** Directory names that are not scanned. */
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'tests', 'coverage']);

/**
 * Matches a call or assignment that sets a 403 or 404 status, for example
 * `setStatusCode(404)`, `error.statusCode = 403`, or `{ statusCode: 404 }`.
 * The pattern needs the call or assignment form, so a bare number is not a match.
 */
const REWRITTEN_STATUS_PATTERN = /\b(setStatusCode\(\s*|statusCode\s*[:=]\s*)(403|404)\b/;

/**
 * Replace comments with blank text, keeping line breaks so line numbers stay correct.
 *
 * >! The scanner walks the text once and tracks string and template literals, so a "//" inside
 * >! a string (a URL, for example) is not mistaken for a comment. Regular expression literals
 * >! are not tracked; the Auth sources contain none that hold a quote or comment marker, and
 * >! the self-check below would not hide one that matters because it only strips, never adds.
 *
 * @param {string} source - JavaScript source text
 * @returns {string} Source with line and block comments removed, newlines preserved
 * @example
 * stripComments('a(); // b\n/* c *\/ d();'); // 'a(); \n d();' (spacing aside)
 */
function stripComments(source) {
	let output = '';
	let index = 0;
	let quote = null;

	while (index < source.length) {
		const char = source[index];
		const next = source[index + 1];

		if (quote) {
			output += char;
			if (char === '\\' && index + 1 < source.length) {
				output += next;
				index += 2;
				continue;
			}
			if (char === quote) {
				quote = null;
			}
			index += 1;
			continue;
		}

		if (char === '"' || char === '\'' || char === '`') {
			quote = char;
			output += char;
			index += 1;
		} else if (char === '/' && next === '/') {
			// Line comment: skip to the end of the line, keep the newline
			while (index < source.length && source[index] !== '\n') {
				index += 1;
			}
		} else if (char === '/' && next === '*') {
			// Block comment: skip to the closing marker, keep the newlines
			index += 2;
			while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
				if (source[index] === '\n') {
					output += '\n';
				}
				index += 1;
			}
			index += 2;
		} else {
			output += char;
			index += 1;
		}
	}

	return output;
}

/**
 * Find the lines of a source text that set a 403 or 404 status in executable code.
 *
 * @param {string} source - JavaScript source text
 * @returns {Array<{line: number, text: string}>} 1-based line numbers and trimmed line text
 * @example
 * findRewrittenStatuses('response.setStatusCode(404);'); // [{ line: 1, text: 'response.setStatusCode(404);' }]
 */
function findRewrittenStatuses(source) {
	return stripComments(source)
		.split('\n')
		.map((text, offset) => ({ line: offset + 1, text: text.trim() }))
		.filter(({ text }) => REWRITTEN_STATUS_PATTERN.test(text));
}

/**
 * List every non-test .js file under a directory.
 *
 * @param {string} directory - Absolute directory path
 * @returns {Array<string>} Absolute file paths
 */
function listSourceFiles(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return EXCLUDED_DIRECTORIES.has(entry.name) ? [] : listSourceFiles(fullPath);
		}
		return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
	});
}

describe('Detector self-check', () => {
	it.each([
		'response.setStatusCode(404);',
		'response.setStatusCode( 403 );',
		'error.statusCode = 403;',
		'const body = { statusCode: 404 };'
	])('matches %s', (code) => {
		expect(findRewrittenStatuses(code)).toHaveLength(1);
	});

	it.each([
		'response.setStatusCode(UNKNOWN_ROUTE_STATUS);',
		'error.statusCode = USER_NOT_FOUND_STATUS;',
		'// response.setStatusCode(404);',
		'/* error.statusCode = 403; */',
		'/**\n * @example\n * response.setStatusCode(404);\n */'
	])('does not match %s', (code) => {
		expect(findRewrittenStatuses(code)).toHaveLength(0);
	});

	it('reports the line number of a match', () => {
		const matches = findRewrittenStatuses('const a = 1;\n// note\nresponse.setStatusCode(404);\n');
		expect(matches).toEqual([{ line: 3, text: 'response.setStatusCode(404);' }]);
	});
});

describe('Auth function source', () => {
	const files = listSourceFiles(AUTH_FUNCTION_ROOT);

	it('finds source files to scan', () => {
		// >! A vacuous pass (wrong root, nothing found) would hide a regression
		expect(files.length).toBeGreaterThan(0);
	});

	it('sets no 403 or 404 status anywhere', () => {
		const offenders = files.flatMap((file) => {
			const relative = path.relative(AUTH_FUNCTION_ROOT, file);
			return findRewrittenStatuses(fs.readFileSync(file, 'utf8'))
				.map(({ line, text }) => `${relative}:${line}: ${text}`);
		});

		expect(offenders).toEqual([]);
	});
});
