'use strict';

/**
 * Architecture Test: No Hardcoded cacheScope
 *
 * Verifies that no executable code in the Read Function assigns a string
 * literal to a `cacheScope` property. The cache scope must come from
 * `TOOLS_LIST_CACHE_SCOPE` in utils/mcp-protocol.js (through the private
 * `modernCacheHints()` helper), so that `tools/list` and `server/discover`
 * cannot drift apart or reintroduce a value the MCP specification does not
 * allow.
 *
 * This test only reads files. It spawns no child processes and makes no
 * network calls.
 *
 * Requirements: 1.6, 5.7
 *
 * @module tests/unit/architecture/no-hardcoded-cache-scope
 */

const { describe, it, expect } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

/**
 * Root of the Read Function (three levels up from tests/unit/architecture).
 *
 * @constant {string}
 */
const LAMBDA_ROOT = path.join(__dirname, '../../..');

/**
 * Directory names the file walk does not enter.
 *
 * @constant {ReadonlyArray<string>}
 */
const SKIPPED_DIRECTORIES = ['node_modules', 'tests', 'coverage'];

// >! A cacheScope property assigned a string literal. Comments are stripped first,
// >! so JSDoc examples may show the value. Quoted keys are covered too.
const SCOPE_LITERAL = /\bcacheScope['"`]?\s*:\s*['"`]/;

/**
 * Remove block comments and whole-line or trailing // comments, keeping every
 * line break so that line numbers still match the file.
 *
 * @param {string} source - JavaScript source
 * @returns {string} Source without comments
 * @example
 * stripComments("a();\n// cacheScope: 'public'\nb();");
 * // "a();\n\nb();"
 */
function stripComments(source) {
  return source
    // >! Keep the newlines inside block comments so reported line numbers stay accurate
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

/**
 * List the .js files under a directory, skipping node_modules, tests, and coverage.
 *
 * @param {string} dir - Directory to walk
 * @returns {string[]} Absolute file paths
 * @example
 * const files = sourceFiles(LAMBDA_ROOT);
 * // ['/.../read-function/index.js', '/.../read-function/utils/mcp-protocol.js', ...]
 */
function sourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // >! Skip dependencies, tests (which assert literal values on purpose), and coverage output
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...sourceFiles(full));
      }
    } else if (entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

describe('Architecture: no hardcoded cacheScope', () => {
  it('assigns no string literal to cacheScope in executable code', () => {
    const violations = [];
    for (const file of sourceFiles(LAMBDA_ROOT)) {
      stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
        if (SCOPE_LITERAL.test(line)) {
          violations.push(`${path.relative(LAMBDA_ROOT, file)}:${index + 1}  ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('detects literals and ignores constants, spreads, and comments', () => {
    const cases = [
      { code: "cacheScope: 'server'", matches: true },
      { code: '"cacheScope": "public"', matches: true },
      { code: 'cacheScope: TOOLS_LIST_CACHE_SCOPE', matches: false },
      { code: '...modernCacheHints()', matches: false },
      { code: "// cacheScope: 'public'", matches: false }
    ];
    for (const { code, matches } of cases) {
      expect(SCOPE_LITERAL.test(stripComments(code))).toBe(matches);
    }
  });
});
