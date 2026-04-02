/**
 * Helper functions for injecting breadcrumb navigation and copyright footer
 * into generated documentation HTML pages.
 *
 * These functions mirror the shell logic in 03-generate-markdown-docs.sh and
 * serve as the testable specification for property-based tests.
 *
 * @module docs-nav-helpers
 */

'use strict';

/**
 * Format a kebab-case directory name for display in breadcrumbs.
 * Capitalizes the first character and replaces hyphens with spaces.
 *
 * @param {string} dirName - Kebab-case directory name (e.g., 'use-cases')
 * @returns {string} Formatted display name (e.g., 'Use cases')
 * @example
 * formatDirectoryName('use-cases');  // 'Use cases'
 * formatDirectoryName('tools');      // 'Tools'
 * formatDirectoryName('troubleshooting'); // 'Troubleshooting'
 */
function formatDirectoryName(dirName) {
  const withSpaces = dirName.replace(/-/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

/**
 * Build breadcrumb navigation HTML for a documentation page.
 *
 * For index pages the trail is: Home → Docs → Directory_Name (plain text).
 * For sub-pages the trail is: Home → Docs → Directory_Name (link) → Page_Title (plain text).
 * The "Docs" link points to /docs/ (the documentation landing page).
 * The last item always carries `aria-current="page"`.
 *
 * @param {string} dir - Raw directory name (e.g., 'integration')
 * @param {string|null} title - Page title for sub-pages, or null for index pages
 * @param {boolean} isIndex - Whether the page is an index page
 * @returns {string} Complete `<nav>` HTML string
 * @example
 * // Index page
 * buildBreadcrumbHtml('integration', null, true);
 * // '<nav aria-label="Breadcrumb" class="breadcrumb-nav"><ol>...'
 *
 * @example
 * // Sub-page
 * buildBreadcrumbHtml('integration', 'Kiro', false);
 * // '<nav aria-label="Breadcrumb" class="breadcrumb-nav"><ol>...'
 */
function buildBreadcrumbHtml(dir, title, isIndex) {
  const displayName = formatDirectoryName(dir);
  let items = '';

  items += '<li><a href="/">Home</a></li>';
  items += '<li><a href="/docs/">Docs</a></li>';

  if (isIndex) {
    items += `<li aria-current="page">${displayName}</li>`;
  } else {
    items += `<li><a href="/docs/${dir}/">${displayName}</a></li>`;
    items += `<li aria-current="page">${title}</li>`;
  }

  return `<nav aria-label="Breadcrumb" class="breadcrumb-nav"><ol>${items}</ol></nav>`;
}

/**
 * Inject breadcrumb HTML into a page immediately after the opening `<body>` tag.
 * Handles both plain `<body>` and `<body>` with attributes (e.g., `<body class="...">`).
 *
 * @param {string} html - Full HTML string of the page
 * @param {string} breadcrumbHtml - Breadcrumb `<nav>` HTML to inject
 * @returns {string} HTML with breadcrumb injected after `<body>`
 * @example
 * const page = '<html><body><h1>Hello</h1></body></html>';
 * const nav = buildBreadcrumbHtml('tools', null, true);
 * injectBreadcrumb(page, nav);
 * // '<html><body><nav aria-label="Breadcrumb" ...>...</nav><h1>Hello</h1></body></html>'
 */
function injectBreadcrumb(html, breadcrumbHtml) {
  return html.replace(/(<body[^>]*>)/i, `$1${breadcrumbHtml}`);
}

/**
 * Inject copyright footer HTML and year script before the closing `</body>` tag.
 *
 * The footer contains a `<span id="copyright-year">` placeholder that is
 * populated by an inline script using `new Date().getFullYear()`.
 *
 * @param {string} html - Full HTML string of the page
 * @returns {string} HTML with footer and year script injected before `</body>`
 * @example
 * const page = '<html><body><h1>Hello</h1></body></html>';
 * injectFooter(page);
 * // '...<footer><p>&copy; <span id="copyright-year"></span> 63Klabs. ...</footer><script>...</script></body></html>'
 */
function injectFooter(html) {
  const footer = '<footer>{{{settings.footer}}}</footer>';
  const script = "document.getElementById('copyright-year').textContent = new Date().getFullYear();";
  return html.replace('</body>', `${footer}\n<script>${script}</script>\n</body>`);
}

module.exports = {
  formatDirectoryName,
  buildBreadcrumbHtml,
  injectBreadcrumb,
  injectFooter
};
