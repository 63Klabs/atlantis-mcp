// Feature: docs-breadcrumb-footer, Property 1: Index page breadcrumb structure and content
// Validates: Requirements 1.1, 1.3, 1.4, 1.5

const fc = require('fast-check');
const {
  buildBreadcrumbHtml,
  injectBreadcrumb,
  formatDirectoryName
} = require('../../../postdeploy-scripts/docs-nav-helpers');

/**
 * Arbitrary for kebab-case directory names: lowercase letters and hyphens,
 * not starting or ending with a hyphen, minimum length 1.
 */
const kebabCaseString = fc
  .stringMatching(/^[a-z]+(-[a-z]+)*$/)
  .filter(s => s.length >= 1 && s.length <= 30);

describe('Property 1: Index page breadcrumb structure and content', () => {
  it('buildBreadcrumbHtml produces correct nav structure with exactly 3 li items for index pages', () => {
    fc.assert(
      fc.property(kebabCaseString, (dirName) => {
        const html = buildBreadcrumbHtml(dirName, null, true);
        const expectedDisplayName = formatDirectoryName(dirName);

        // Req 1.3: nav element with aria-label="Breadcrumb" wrapping an ol
        expect(html).toMatch(/^<nav aria-label="Breadcrumb"[^>]*><ol>.*<\/ol><\/nav>$/);

        // Exactly 3 <li> items
        const liMatches = html.match(/<li[^>]*>.*?<\/li>/g);
        expect(liMatches).not.toBeNull();
        expect(liMatches).toHaveLength(3);

        // Req 1.1: First item — Home link to /
        expect(liMatches[0]).toBe('<li><a href="/">Home</a></li>');

        // Req 1.1: Second item — Docs link to /docs/
        expect(liMatches[1]).toBe('<li><a href="/docs/">Docs</a></li>');

        // Req 1.1 + 1.4: Third item — formatted directory name with aria-current="page"
        expect(liMatches[2]).toBe(`<li aria-current="page">${expectedDisplayName}</li>`);
      }),
      { numRuns: 100 }
    );
  });

  it('injectBreadcrumb places breadcrumb after <body> and before main content', () => {
    fc.assert(
      fc.property(kebabCaseString, (dirName) => {
        const breadcrumbHtml = buildBreadcrumbHtml(dirName, null, true);
        const mainContent = '<h1>Main Content</h1><p>Some text</p>';
        const page = `<!DOCTYPE html><html><head><title>Test</title></head><body>${mainContent}</body></html>`;

        const result = injectBreadcrumb(page, breadcrumbHtml);

        // Req 1.5: Breadcrumb appears after <body> and before main content
        const bodyTagEnd = result.indexOf('>',  result.indexOf('<body')) + 1;
        const breadcrumbStart = result.indexOf('<nav aria-label="Breadcrumb"');
        const contentStart = result.indexOf(mainContent);

        expect(breadcrumbStart).toBeGreaterThanOrEqual(bodyTagEnd);
        expect(breadcrumbStart).toBeLessThan(contentStart);
      }),
      { numRuns: 100 }
    );
  });
});
