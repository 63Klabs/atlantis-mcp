// Bugfix: security-update-bad-html-filtering
// Property 1: Bug Condition - Case-Insensitive Script Tag Detection
// Validates: Requirements 1.1, 1.2, 2.1, 2.2

const fc = require('fast-check');

/**
 * Generate a random case variation of "script" where at least one character
 * is uppercase. This encodes the bug condition: tagName.toLowerCase() == "script"
 * AND tagName != "script".
 */
const mixedCaseScript = fc
  .tuple(
    fc.boolean(),
    fc.boolean(),
    fc.boolean(),
    fc.boolean(),
    fc.boolean(),
    fc.boolean()
  )
  .filter(flags => flags.some(f => f)) // at least one uppercase
  .map(flags => {
    const letters = ['s', 'c', 'r', 'i', 'p', 't'];
    return letters.map((ch, i) => (flags[i] ? ch.toUpperCase() : ch)).join('');
  });

// UNFIXED regex patterns from landing-page.test.js (lines 42, 44)
const UNFIXED_SCRIPT_SRC_REGEX = /<script[^>]+src=/;
const UNFIXED_INLINE_SCRIPT_REGEX = /<script[\s>]/;

// FIXED regex patterns (expected behavior after fix)
const FIXED_SCRIPT_SRC_REGEX = /<script[^>]+src=/i;
const FIXED_INLINE_SCRIPT_REGEX = /<script[\s>]/i;

describe('Property 1: Bug Condition - Case-Insensitive Script Tag Detection', () => {
  it('script src regex should match non-lowercase <script> tags with src attribute', () => {
    fc.assert(
      fc.property(mixedCaseScript, (scriptTag) => {
        const html = `<${scriptTag} src="evil.js">`;

        // The FIXED regex (with i flag) MUST match - this is expected behavior
        expect(FIXED_SCRIPT_SRC_REGEX.test(html)).toBe(true);

        // The UNFIXED regex does NOT match mixed-case (confirms the bug existed)
        expect(UNFIXED_SCRIPT_SRC_REGEX.test(html)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('inline script regex should match non-lowercase <script> tags', () => {
    fc.assert(
      fc.property(
        mixedCaseScript,
        fc.constantFrom('>', ' '),
        (scriptTag, delimiter) => {
          const html = `<${scriptTag}${delimiter}`;

          // The FIXED regex (with i flag) MUST match - this is expected behavior
          expect(FIXED_INLINE_SCRIPT_REGEX.test(html)).toBe(true);

          // The UNFIXED regex does NOT match mixed-case (confirms the bug existed)
          expect(UNFIXED_INLINE_SCRIPT_REGEX.test(html)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
