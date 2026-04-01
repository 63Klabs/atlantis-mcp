// Feature: docs-breadcrumb-footer, Property 3: Directory name formatting
// Validates: Requirements 1.6

const fc = require('fast-check');
const { formatDirectoryName } = require('../../../postdeploy-scripts/docs-nav-helpers');

/**
 * Arbitrary for kebab-case strings: lowercase letters and hyphens,
 * not starting or ending with a hyphen, minimum length 1.
 *
 * Generates strings like "abc", "my-dir", "use-cases-long".
 */
const kebabCaseString = fc
  .stringMatching(/^[a-z]+(-[a-z]+)*$/)
  .filter(s => s.length >= 1 && s.length <= 30);

describe('Property 3: Directory name formatting', () => {
  it('first character is uppercase of original, hyphens replaced with spaces, other chars unchanged', () => {
    fc.assert(
      fc.property(kebabCaseString, (dirName) => {
        const result = formatDirectoryName(dirName);

        // First character should be uppercase of original first character
        expect(result.charAt(0)).toBe(dirName.charAt(0).toUpperCase());

        // All hyphens should be replaced with spaces
        expect(result).not.toContain('-');

        // Length should be preserved (hyphens and spaces are both 1 char)
        expect(result.length).toBe(dirName.length);

        // All other characters (non-first, non-hyphen) should be unchanged
        for (let i = 1; i < dirName.length; i++) {
          if (dirName[i] === '-') {
            expect(result[i]).toBe(' ');
          } else {
            expect(result[i]).toBe(dirName[i]);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
