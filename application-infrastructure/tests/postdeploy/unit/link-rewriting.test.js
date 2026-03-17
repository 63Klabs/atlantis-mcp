// Unit tests for markdown-to-HTML link rewriting in 03-generate-markdown-docs.sh
// Validates: Internal .md links are rewritten to .html, README.md -> index.html

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Simulate the sed-based link rewriting that 03-generate-markdown-docs.sh performs
 * on generated HTML files. This mirrors the exact sed expressions from the script.
 *
 * @param {string} html - HTML content with markdown links
 * @returns {string} HTML with rewritten links
 */
function rewriteLinks(html) {
  return html
    // README.md -> index.html (must come before generic .md -> .html)
    .replace(/href="([^"]*)README\.md/g, 'href="$1index.html')
    .replace(/href='([^']*)README\.md/g, "href='$1index.html")
    // .md" -> .html"
    .replace(/href="([^"]*)\.md"/g, 'href="$1.html"')
    .replace(/href='([^']*)\.md'/g, "href='$1.html'")
    // .md# -> .html# (links with anchors)
    .replace(/href="([^"]*)\.md#/g, 'href="$1.html#')
    .replace(/href='([^']*)\.md#/g, "href='$1.html#");
}

describe('Markdown link rewriting', () => {
  it('should rewrite README.md to index.html', () => {
    const input = '<a href="../tools/README.md">Tools</a>';
    expect(rewriteLinks(input)).toBe('<a href="../tools/index.html">Tools</a>');
  });

  it('should rewrite .md links to .html', () => {
    const input = '<a href="amazon-q.md">Amazon Q</a>';
    expect(rewriteLinks(input)).toBe('<a href="amazon-q.html">Amazon Q</a>');
  });

  it('should rewrite .md links with anchors to .html', () => {
    const input = '<a href="../troubleshooting/README.md#rate-limiting">Rate Limiting</a>';
    expect(rewriteLinks(input)).toBe('<a href="../troubleshooting/index.html#rate-limiting">Rate Limiting</a>');
  });

  it('should rewrite relative parent directory links', () => {
    const input = '<a href="../use-cases/README.md">Use Cases</a>';
    expect(rewriteLinks(input)).toBe('<a href="../use-cases/index.html">Use Cases</a>');
  });

  it('should rewrite same-directory .md links', () => {
    const input = '<a href="./cloudformation-parameters.md">Parameters</a>';
    expect(rewriteLinks(input)).toBe('<a href="./cloudformation-parameters.html">Parameters</a>');
  });

  it('should not modify external URLs', () => {
    const input = '<a href="https://github.com/63klabs/atlantis">GitHub</a>';
    expect(rewriteLinks(input)).toBe(input);
  });

  it('should not modify anchor-only links', () => {
    const input = '<a href="#section-name">Section</a>';
    expect(rewriteLinks(input)).toBe(input);
  });

  it('should handle multiple links in one line', () => {
    const input = '<a href="foo.md">Foo</a> and <a href="bar.md">Bar</a>';
    expect(rewriteLinks(input)).toBe('<a href="foo.html">Foo</a> and <a href="bar.html">Bar</a>');
  });

  it('should not modify .md inside text content (only href attributes)', () => {
    const input = '<p>Edit the file README.md for details</p>';
    // The rewrite only targets href= attributes, plain text is unaffected
    expect(rewriteLinks(input)).toBe(input);
  });
});

describe('Link rewriting via sed (integration)', () => {
  let tempDir;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-rewrite-'));
  });

  afterAll(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should rewrite links in an HTML file using sed', () => {
    const htmlContent = [
      '<html><body>',
      '<a href="../tools/README.md">Tools</a>',
      '<a href="amazon-q.md">Amazon Q</a>',
      '<a href="../troubleshooting/README.md#rate-limiting">Troubleshooting</a>',
      '<a href="https://github.com">External</a>',
      '<p>See README.md for details</p>',
      '</body></html>'
    ].join('\n');

    const testFile = path.join(tempDir, 'test.html');
    fs.writeFileSync(testFile, htmlContent);

    // >! Use execFileSync to run sed safely without shell injection
    execFileSync('sed', [
      '-i',
      '-e', 's|href="\\([^"]*\\)README\\.md|href="\\1index.html|g',
      '-e', 's|href="\\([^"]*\\)\\.md"|href="\\1.html"|g',
      '-e', 's|href="\\([^"]*\\)\\.md#|href="\\1.html#|g',
      testFile
    ], { timeout: 5000 });

    const result = fs.readFileSync(testFile, 'utf8');

    expect(result).toContain('href="../tools/index.html"');
    expect(result).toContain('href="amazon-q.html"');
    expect(result).toContain('href="../troubleshooting/index.html#rate-limiting"');
    expect(result).toContain('href="https://github.com"');
    expect(result).toContain('See README.md for details');
  });
});
