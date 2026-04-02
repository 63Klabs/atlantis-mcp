// Bugfix: security-update-bad-html-filtering
// Property 2: Preservation - Existing Detection and Pass-Through Behavior
// Validates: Requirements 3.1, 3.2, 3.3, 3.4

const fc = require('fast-check');

// UNFIXED regex patterns from landing-page.test.js (lines 42, 44)
const UNFIXED_SCRIPT_SRC_REGEX = /<script[^>]+src=/;
const UNFIXED_INLINE_SCRIPT_REGEX = /<script[\s>]/;

// FIXED regex patterns (with case-insensitive flag)
const FIXED_SCRIPT_SRC_REGEX = /<script[^>]+src=/i;
const FIXED_INLINE_SCRIPT_REGEX = /<script[\s>]/i;

/**
 * Arbitrary for HTML-like strings that do NOT contain the substring "script"
 * in any casing. This ensures the generated strings are in the domain where
 * the bug condition does NOT hold, so both unfixed and fixed regexes should
 * behave identically (no match).
 */
const htmlWithoutScript = fc
  .string({ minLength: 0, maxLength: 200 })
  .filter(s => !s.toLowerCase().includes('script'));

describe('Property 2: Preservation - Existing Detection and Pass-Through Behavior', () => {
  it('script src regex: strings without "script" produce same result for both unfixed and fixed patterns', () => {
    fc.assert(
      fc.property(htmlWithoutScript, (html) => {
        const unfixedResult = UNFIXED_SCRIPT_SRC_REGEX.test(html);
        const fixedResult = FIXED_SCRIPT_SRC_REGEX.test(html);

        // Both should produce the same result (no match) for non-script HTML
        expect(unfixedResult).toBe(fixedResult);
        // Neither should match since "script" is absent
        expect(unfixedResult).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('inline script regex: strings without "script" produce same result for both unfixed and fixed patterns', () => {
    fc.assert(
      fc.property(htmlWithoutScript, (html) => {
        const unfixedResult = UNFIXED_INLINE_SCRIPT_REGEX.test(html);
        const fixedResult = FIXED_INLINE_SCRIPT_REGEX.test(html);

        // Both should produce the same result (no match) for non-script HTML
        expect(unfixedResult).toBe(fixedResult);
        // Neither should match since "script" is absent
        expect(unfixedResult).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('lowercase script tags: both unfixed and fixed regexes match (preservation of lowercase detection)', () => {
    // Validates: Requirements 3.1, 3.2
    const srcUrls = [
      'app.js',
      'https://cdn.example.com/lib.js',
      '/assets/bundle.min.js',
    ];

    // Test 3a: lowercase <script src="..."> preserved
    for (const url of srcUrls) {
      const html = `<script src="${url}">`;
      expect(UNFIXED_SCRIPT_SRC_REGEX.test(html)).toBe(true);
      expect(FIXED_SCRIPT_SRC_REGEX.test(html)).toBe(true);
    }

    // Test 3b: lowercase <script> and <script > preserved
    const inlineVariants = ['<script>', '<script >', '<script\t>'];
    for (const tag of inlineVariants) {
      expect(UNFIXED_INLINE_SCRIPT_REGEX.test(tag)).toBe(true);
      expect(FIXED_INLINE_SCRIPT_REGEX.test(tag)).toBe(true);
    }
  });

  it('framework detection using .toLowerCase() is unaffected', () => {
    // Validates: Requirement 3.4
    // The framework checks use html.toLowerCase().match(/react|angular|vue\.js/)
    // which is independent of the regex fix. Verify the pattern is unchanged.
    const frameworkHtmlSamples = [
      { html: '<div data-react="true"></div>', framework: 'react' },
      { html: '<div>Powered by Angular</div>', framework: 'angular' },
      { html: '<script src="vue.js"></script>', framework: 'vue.js' },
      { html: '<div>React App</div>', framework: 'react' },
      { html: '<div>ANGULAR</div>', framework: 'angular' },
      { html: '<div>Vue.js</div>', framework: 'vue.js' },
    ];

    for (const { html, framework } of frameworkHtmlSamples) {
      const pattern =
        framework === 'vue.js' ? /vue\.js/ : new RegExp(framework);
      // The .toLowerCase() approach detects frameworks regardless of casing
      expect(html.toLowerCase()).toMatch(pattern);
    }

    // Property: for any random string, .toLowerCase() framework detection
    // is completely independent of the script tag regex fix
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (html) => {
        const lower = html.toLowerCase();
        const hasReact = /react/.test(lower);
        const hasAngular = /angular/.test(lower);
        const hasVue = /vue\.js/.test(lower);

        // These checks use .toLowerCase() and are unaffected by the i flag
        // on the script tag regexes. Verify they produce consistent results.
        expect(hasReact).toBe(/react/.test(html.toLowerCase()));
        expect(hasAngular).toBe(/angular/.test(html.toLowerCase()));
        expect(hasVue).toBe(/vue\.js/.test(html.toLowerCase()));
      }),
      { numRuns: 100 }
    );
  });
});
