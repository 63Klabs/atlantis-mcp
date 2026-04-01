// Feature: docs-breadcrumb-footer, Property 4: Footer uniqueness and position
// Validates: Requirements 2.1, 2.4

const fc = require('fast-check');
const { injectFooter } = require('../../../postdeploy-scripts/docs-nav-helpers');

/**
 * Arbitrary for HTML body content strings that do not contain </body> or </BODY>.
 * These are wrapped in a minimal Pandoc HTML structure for testing.
 */
const bodyContent = fc.string({ minLength: 0, maxLength: 200 })
  .filter(s => !s.includes('</body>') && !s.includes('</BODY>'));

describe('Property 4: Footer uniqueness and position', () => {
  it('footer markup appears exactly once and before </body>, containing copyright-year span and 63Klabs text', () => {
    fc.assert(
      fc.property(bodyContent, (content) => {
        const page = `<!DOCTYPE html><html><head><title>Test</title></head><body>${content}</body></html>`;
        const result = injectFooter(page);

        // Req 2.1 + 2.4: Footer markup appears exactly once
        const footerMatches = result.match(/<footer>/g);
        expect(footerMatches).not.toBeNull();
        expect(footerMatches).toHaveLength(1);

        const footerCloseMatches = result.match(/<\/footer>/g);
        expect(footerCloseMatches).not.toBeNull();
        expect(footerCloseMatches).toHaveLength(1);

        // Req 2.4: Footer appears before </body>
        const footerPos = result.indexOf('<footer>');
        const bodyClosePos = result.indexOf('</body>');
        expect(footerPos).toBeLessThan(bodyClosePos);

        // Req 2.2: Footer contains copyright-year span
        expect(result).toContain('<span id="copyright-year"></span>');

        // Req 2.1: Footer contains 63Klabs text
        expect(result).toContain('63Klabs');
      }),
      { numRuns: 100 }
    );
  });
});
