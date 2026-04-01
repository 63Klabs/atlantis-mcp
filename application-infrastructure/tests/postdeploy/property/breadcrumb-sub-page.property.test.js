// Feature: docs-breadcrumb-footer, Property 2: Sub-page breadcrumb structure and content
// Validates: Requirements 1.2, 1.3, 1.4, 1.5

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

/**
 * Arbitrary for page title strings: simple alphanumeric with spaces,
 * starting with a letter, no HTML special chars.
 */
const pageTitleString = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,20}$/)
  .filter(s => s.trim().length >= 1);

describe('Property 2: Sub-page breadcrumb structure and content', () => {
  it('buildBreadcrumbHtml produces correct nav structure with exactly 4 li items for sub-pages', () => {
    fc.assert(
      fc.property(kebabCaseString, pageTitleString, (dirName, title) => {
        const html = buildBreadcrumbHtml(dirName, title, false);
        const expectedDisplayName = formatDirectoryName(dirName);

        // Req 1.3: nav element with aria-label="Breadcrumb" wrapping an ol
        expect(html).toMatch(/^<nav aria-label="Breadcrumb"[^>]*><ol>.*<\/ol><\/nav>$/);

        // Exactly 4 <li> items
        const liMatches = html.match(/<li[^>]*>.*?<\/li>/g);
        expect(liMatches).not.toBeNull();
        expect(liMatches).toHaveLength(4);

        // Req 1.2: First item — Home link to /
        expect(liMatches[0]).toBe('<li><a href="/">Home</a></li>');

        // Req 1.2: Second item — Docs link to /
        expect(liMatches[1]).toBe('<li><a href="/">Docs</a></li>');

        // Req 1.2: Third item — formatted directory name as link to /docs/{dir}/
        expect(liMatches[2]).toBe(`<li><a href="/docs/${dirName}/">${expectedDisplayName}</a></li>`);

        // Req 1.2 + 1.4: Fourth item — page title with aria-current="page"
        expect(liMatches[3]).toBe(`<li aria-current="page">${title}</li>`);
      }),
      { numRuns: 100 }
    );
  });

  it('injectBreadcrumb places sub-page breadcrumb after <body> and before main content', () => {
    fc.assert(
      fc.property(kebabCaseString, pageTitleString, (dirName, title) => {
        const breadcrumbHtml = buildBreadcrumbHtml(dirName, title, false);
        const mainContent = '<h1>Main Content</h1><p>Some text</p>';
        const page = `<!DOCTYPE html><html><head><title>Test</title></head><body>${mainContent}</body></html>`;

        const result = injectBreadcrumb(page, breadcrumbHtml);

        // Req 1.5: Breadcrumb appears after <body> and before main content
        const bodyTagEnd = result.indexOf('>', result.indexOf('<body')) + 1;
        const breadcrumbStart = result.indexOf('<nav aria-label="Breadcrumb"');
        const contentStart = result.indexOf(mainContent);

        expect(breadcrumbStart).toBeGreaterThanOrEqual(bodyTagEnd);
        expect(breadcrumbStart).toBeLessThan(contentStart);
      }),
      { numRuns: 100 }
    );
  });
});
