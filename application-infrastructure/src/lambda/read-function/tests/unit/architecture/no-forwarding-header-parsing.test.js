/**
 * Architecture Tests: no forwarding-header parsing in function source
 *
 * Guards the rule that the Read and Auth functions never read a client address
 * themselves. The address comes from cache-data (ClientRequest.getClientIp()), which,
 * with CACHE_DATA_TRUSTED_PROXY_HOPS=0, is requestContext.identity.sourceIp as API
 * Gateway recorded it. Application code that reads X-Forwarded-For (or a similar
 * header) lets any caller who uses the raw execute-api URL pick its rate-limit bucket.
 *
 * The test reads every non-test .js file under the Read and Auth function directories,
 * strips comments, and fails on any of these patterns:
 *
 *   x-forwarded-for              /x-forwarded-for/i
 *   cloudfront-viewer-address    /cloudfront-viewer-address/i
 *   x-real-ip                    /x-real-ip/i
 *   Forwarded header             /\bforwarded\b\s*['"\]:]/i
 *   identity.sourceIp read       /identity\s*\??\.\s*sourceIp/ (also the bracket form)
 *
 * The Auth function's Cognito handler reads CloudFront-Viewer-Country from client
 * metadata. That is a different header and a different field, and none of the patterns
 * above match it.
 *
 * No file is allow-listed. A file that matches is a file to change.
 *
 * Spec: .kiro/specs/0-0-7-rate-limit-client-ip-spoofing/ (design.md, Components 6)
 * Requirements: 1.2, 5.1, 5.2, 10.7
 *
 * Assertions:
 *   S1  The scan found the expected function source (guards against a vacuous pass)
 *   S2  No source file matches a forbidden pattern
 *   S3  The scan does not match CloudFront-Viewer-Country
 *   S4  The comment stripper keeps code and drops comments
 *
 * @module tests/unit/architecture/no-forwarding-header-parsing
 */

'use strict';

const { describe, it, expect, beforeAll } = require('@jest/globals');
const fs = require('fs');
const path = require('path');

// lambda/ is four levels above this file: architecture -> unit -> tests -> read-function -> lambda
const LAMBDA_ROOT = path.resolve(__dirname, '../../../..');
const SCANNED_ROOTS = Object.freeze([
  path.join(LAMBDA_ROOT, 'read-function'),
  path.join(LAMBDA_ROOT, 'auth-function')
]);

// Directory names never scanned: dependencies, tests, coverage output, and layers
const SKIPPED_DIRECTORIES = Object.freeze(['node_modules', 'tests', 'coverage', 'layers']);
const SPEC_DIR = '.kiro/specs/0-0-7-rate-limit-client-ip-spoofing/';

// >! Each pattern is linear time: no nested quantifiers, no overlapping alternation
const FORBIDDEN_PATTERNS = Object.freeze([
  { name: 'x-forwarded-for header', regex: /x-forwarded-for/i },
  { name: 'cloudfront-viewer-address header', regex: /cloudfront-viewer-address/i },
  { name: 'x-real-ip header', regex: /x-real-ip/i },
  { name: 'Forwarded header', regex: /\bforwarded\b\s*['"\]:]/i },
  { name: 'read of identity.sourceIp', regex: /identity\s*\??\.\s*sourceIp|identity\s*\??\.?\s*\[\s*['"]sourceIp['"]\s*\]/ }
]);

/**
 * Remove comments from JavaScript source while keeping string and template
 * literal contents intact, so a URL such as 'https://example.com' is not cut at
 * the double slash. Removed comment characters are replaced by nothing, except
 * that newlines are kept so line numbers stay correct.
 *
 * Regular expression literals are not tracked. A regex literal that holds an
 * unbalanced quote could confuse the scan; S2 would then report a surprising
 * match rather than miss one silently.
 *
 * @private
 * @param {string} source - JavaScript source text
 * @returns {string} The source without // and block comments
 * @example
 * stripComments("const a = 1; // x-forwarded-for\n"); // "const a = 1; \n"
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
    } else if (char === '/' && next === '/') {
      // Line comment: skip to the end of the line, keep the newline
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
    } else if (char === '/' && next === '*') {
      // Block comment: skip to the closing marker, keep newlines
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') {
          output += '\n';
        }
        index += 1;
      }
      index += 2;
    } else {
      if (char === '"' || char === '\'' || char === '`') {
        quote = char;
      }
      output += char;
      index += 1;
    }
  }

  return output;
}

/**
 * Collect every .js file under a directory, skipping the directories in
 * SKIPPED_DIRECTORIES at any depth.
 *
 * @private
 * @param {string} directory - Absolute directory path
 * @returns {Array.<string>} Absolute paths of .js files, sorted
 * @throws {Error} When the directory does not exist, so a moved function cannot make the test pass vacuously
 */
function collectSourceFiles(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(
      `Required directory not found: ${directory}\n` +
      'If a function directory moved, update SCANNED_ROOTS in no-forwarding-header-parsing.test.js.'
    );
  }

  const files = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...collectSourceFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  });

  return files.sort();
}

/**
 * Find the forbidden patterns that match the code (comments removed) of a source text.
 *
 * @private
 * @param {string} source - JavaScript source text
 * @returns {Array.<{name: string, line: number}>} One entry per matching pattern, with the first matching line
 */
function findViolations(source) {
  const code = stripComments(source);
  const lines = code.split('\n');
  const found = [];

  FORBIDDEN_PATTERNS.forEach(pattern => {
    const lineIndex = lines.findIndex(line => pattern.regex.test(line));
    if (lineIndex !== -1) {
      found.push({ name: pattern.name, line: lineIndex + 1 });
    }
  });

  return found;
}

/**
 * Assert that a violations list is empty, rendering one block per violation
 * so a single failing run lists every problem.
 *
 * @private
 * @param {Array.<string>} violations - Rendered violation messages
 * @returns {void}
 */
function expectNoViolations(violations) {
  expect(violations.join('\n\n')).toBe('');
}

describe('Architecture: no forwarding-header parsing in function source', () => {
  let sourceFiles;

  beforeAll(() => {
    // >! Read files only; fails with a clear message if a function directory is missing
    sourceFiles = SCANNED_ROOTS.flatMap(collectSourceFiles);
  });

  it('S1: the scan found the expected function source', () => {
    const relative = sourceFiles.map(file => path.relative(LAMBDA_ROOT, file).split(path.sep).join('/'));
    const violations = [];

    ['read-function/index.js', 'read-function/utils/rate-limiter.js', 'read-function/utils/auth-resolver.js',
      'auth-function/index.js'].forEach(expected => {
      if (!relative.includes(expected)) {
        violations.push(`Expected ${expected} among the scanned files, but it was not found. The scan would pass vacuously.`);
      }
    });

    expectNoViolations(violations);
  });

  it('S2: no non-test source file reads a forwarding header or identity.sourceIp', () => {
    const violations = [];

    sourceFiles.forEach(file => {
      const relative = path.relative(LAMBDA_ROOT, file).split(path.sep).join('/');
      findViolations(fs.readFileSync(file, 'utf8')).forEach(violation => {
        violations.push(
          `${relative} (line ${violation.line}, comments removed) matches: ${violation.name}.\n` +
          'The client address must come from clientRequest.getClientIp() (cache-data), not from the event.\n' +
          `See ${SPEC_DIR}design.md (Components 6).`
        );
      });
    });

    expectNoViolations(violations);
  });

  it('S3: the scan does not match CloudFront-Viewer-Country', () => {
    const source = [
      'const countryCode = event.request.clientMetadata',
      '  ? event.request.clientMetadata[\'CloudFront-Viewer-Country\']',
      '  : undefined;'
    ].join('\n');

    expect(findViolations(source)).toEqual([]);
  });

  it('S4: the comment stripper keeps code and drops comments', () => {
    expect(findViolations('// X-Forwarded-For is documented here\n/* identity.sourceIp */\nconst a = 1;')).toEqual([]);
    expect(findViolations('const url = \'https://example.com\'; const h = headers[\'X-Forwarded-For\'];'))
      .toEqual([{ name: 'x-forwarded-for header', line: 1 }]);
    expect(findViolations('const ip = event.requestContext?.identity?.sourceIp;'))
      .toEqual([{ name: 'read of identity.sourceIp', line: 1 }]);
  });
});
