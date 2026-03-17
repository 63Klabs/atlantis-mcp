// Feature: post-deployment-static-generation, Property 3: Markdown-to-HTML conversion produces correctly placed output
// Validates: Requirements 4.3

const fc = require('fast-check');
const path = require('path');

/**
 * Derive the expected HTML filename from a markdown filename.
 * This mirrors the logic in 03-generate-markdown-docs.sh:
 *   - .md extension is replaced with .html
 *   - README.html is renamed to index.html
 *
 * @param {string} mdFileName - Markdown filename (e.g., 'guide.md', 'README.md')
 * @returns {string} Expected HTML filename
 */
function deriveHtmlFileName(mdFileName) {
  const baseName = mdFileName.replace(/\.md$/, '');
  const htmlName = `${baseName}.html`;

  if (htmlName === 'README.html') {
    return 'index.html';
  }

  return htmlName;
}

/**
 * Derive the expected output path for a converted markdown file.
 * This mirrors the output placement in 03-generate-markdown-docs.sh:
 *   Output goes to build/staging/markdown-docs/docs/<dir>/<filename>.html
 *
 * @param {string} dirName - Directory name from PUBLIC_DOC_DIRS
 * @param {string} mdFileName - Markdown filename
 * @returns {string} Expected output path relative to build root
 */
function deriveOutputPath(dirName, mdFileName) {
  const htmlFileName = deriveHtmlFileName(mdFileName);
  return path.join('build', 'staging', 'markdown-docs', 'docs', dirName, htmlFileName);
}


/**
 * Arbitrary for safe directory names: lowercase alpha with optional digits, 1-10 chars.
 */
const safeDirName = fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/)
  .filter(s => s.length >= 1);

/**
 * Arbitrary for safe markdown filenames (without .md extension): lowercase alpha with optional
 * digits and dashes, 1-15 chars. Excludes 'README' to test it separately.
 */
const safeBaseName = fc.stringMatching(/^[a-z][a-z0-9-]{0,14}$/)
  .filter(s => s.length >= 1 && s !== 'readme' && !s.endsWith('-'));

describe('Property 3: Markdown-to-HTML conversion produces correctly placed output', () => {
  it('should convert .md extension to .html for arbitrary filenames', () => {
    fc.assert(
      fc.property(
        safeBaseName,
        (baseName) => {
          const mdFileName = `${baseName}.md`;
          const htmlFileName = deriveHtmlFileName(mdFileName);

          // Extension must change from .md to .html
          expect(htmlFileName).toBe(`${baseName}.html`);
          expect(htmlFileName).toMatch(/\.html$/);
          expect(htmlFileName).not.toMatch(/\.md$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should rename README.md to index.html', () => {
    const result = deriveHtmlFileName('README.md');
    expect(result).toBe('index.html');
  });

  it('should place output in correct staging path for arbitrary directories and files', () => {
    fc.assert(
      fc.property(
        safeDirName,
        safeBaseName,
        (dirName, baseName) => {
          const mdFileName = `${baseName}.md`;
          const outputPath = deriveOutputPath(dirName, mdFileName);

          // Output must be under the correct staging directory
          expect(outputPath).toMatch(
            new RegExp(`^build/staging/markdown-docs/docs/${dirName}/`)
          );

          // Output must have .html extension
          expect(outputPath).toMatch(/\.html$/);

          // Output filename must match the derived HTML name
          const expectedHtml = `${baseName}.html`;
          expect(path.basename(outputPath)).toBe(expectedHtml);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should place README.md output as index.html in correct staging path', () => {
    fc.assert(
      fc.property(
        safeDirName,
        (dirName) => {
          const outputPath = deriveOutputPath(dirName, 'README.md');

          // README.md must become index.html
          expect(path.basename(outputPath)).toBe('index.html');

          // Must be in the correct directory
          expect(outputPath).toBe(
            path.join('build', 'staging', 'markdown-docs', 'docs', dirName, 'index.html')
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve directory name in output path for arbitrary directories', () => {
    fc.assert(
      fc.property(
        safeDirName,
        fc.constantFrom('guide.md', 'setup.md', 'README.md', 'api-reference.md'),
        (dirName, mdFileName) => {
          const outputPath = deriveOutputPath(dirName, mdFileName);

          // The directory name must appear in the output path
          const pathParts = outputPath.split(path.sep);
          expect(pathParts).toContain(dirName);

          // The directory must be at the correct position in the path hierarchy
          const docsIndex = pathParts.indexOf('docs');
          expect(pathParts[docsIndex + 1]).toBe(dirName);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should never produce a .md file in the output path', () => {
    fc.assert(
      fc.property(
        safeDirName,
        safeBaseName,
        (dirName, baseName) => {
          const mdFileName = `${baseName}.md`;
          const outputPath = deriveOutputPath(dirName, mdFileName);

          // Output path must never end with .md
          expect(outputPath).not.toMatch(/\.md$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});
