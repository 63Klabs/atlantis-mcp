// Feature: post-deployment-static-generation, Property 5: Consolidation preserves directory structure without collisions
// Validates: Requirements 6.2, 6.4

const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Simulate the consolidation step from 04-consolidate-and-deploy.sh.
 * Merges staging directories and public assets into build/final/.
 *
 * @param {string} baseDir - Base directory for the simulation
 * @param {string} publicDir - Path to the static public assets directory
 */
function simulateConsolidation(baseDir, publicDir) {
  const finalDir = path.join(baseDir, 'build', 'final');
  const stagingDir = path.join(baseDir, 'build', 'staging');

  // Remove build/final/ if it exists from a previous run
  if (fs.existsSync(finalDir)) {
    fs.rmSync(finalDir, { recursive: true, force: true });
  }

  // Create build/final/
  fs.mkdirSync(finalDir, { recursive: true });

  // Copy api-docs staging contents
  const apiDocsDir = path.join(stagingDir, 'api-docs');
  if (fs.existsSync(apiDocsDir)) {
    copyRecursive(apiDocsDir, finalDir);
  }

  // Copy markdown-docs staging contents
  const markdownDocsDir = path.join(stagingDir, 'markdown-docs');
  if (fs.existsSync(markdownDocsDir)) {
    copyRecursive(markdownDocsDir, finalDir);
  }

  // Copy static public assets to build/final/ root
  if (fs.existsSync(publicDir)) {
    copyRecursive(publicDir, finalDir);
  }
}

/**
 * Recursively copy all files from source directory into destination directory,
 * preserving subdirectory structure.
 *
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Recursively collect all files under a directory as a map of relative paths to content.
 *
 * @param {string} dir - Directory to scan
 * @returns {Map<string, string>} Map of relative paths to file content
 */
function collectFiles(dir) {
  const result = new Map();
  if (!fs.existsSync(dir)) return result;

  const walk = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const relativePath = path.relative(dir, fullPath);
        result.set(relativePath, fs.readFileSync(fullPath, 'utf8'));
      }
    }
  };

  walk(dir);
  return result;
}

/**
 * Arbitrary for safe directory/file names: lowercase alpha with optional digits, 1-8 chars.
 */
const safeFileName = fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/)
  .filter(s => s.length >= 1);

/**
 * Arbitrary for file content that includes a unique marker.
 */
const fileContent = fc.string({ minLength: 1, maxLength: 50 });

describe('Property 5: Consolidation preserves directory structure without collisions', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidation-'));
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Every file from every staging directory is present at correct relative path in build/final/', () => {
    fc.assert(
      fc.property(
        // Generate file names for api-docs staging (under docs/api/)
        fc.array(safeFileName, { minLength: 1, maxLength: 3 }),
        // Generate directory names for markdown-docs staging
        fc.array(safeFileName, { minLength: 1, maxLength: 3 }),
        // Generate file names for markdown-docs per directory
        fc.array(safeFileName, { minLength: 1, maxLength: 3 }),
        // Generate file names for public assets
        fc.array(safeFileName, { minLength: 1, maxLength: 2 }),
        fileContent,
        (apiFiles, mdDirs, mdFiles, publicFiles, content) => {
          const uniqueApiFiles = [...new Set(apiFiles)];
          const uniqueMdDirs = [...new Set(mdDirs)];
          const uniqueMdFiles = [...new Set(mdFiles)];
          const uniquePublicFiles = [...new Set(publicFiles)];
          if (uniqueApiFiles.length === 0 || uniqueMdDirs.length === 0 ||
              uniqueMdFiles.length === 0 || uniquePublicFiles.length === 0) return;

          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));
          const stagingDir = path.join(baseDir, 'build', 'staging');
          const publicDir = path.join(baseDir, 'public');

          // Set up api-docs staging: build/staging/api-docs/docs/api/<file>.html
          const apiDocsDir = path.join(stagingDir, 'api-docs', 'docs', 'api');
          fs.mkdirSync(apiDocsDir, { recursive: true });
          for (const file of uniqueApiFiles) {
            fs.writeFileSync(
              path.join(apiDocsDir, `${file}.html`),
              `api-doc:${file}:${content}`
            );
          }

          // Set up markdown-docs staging: build/staging/markdown-docs/docs/<dir>/<file>.html
          for (const dir of uniqueMdDirs) {
            const mdDir = path.join(stagingDir, 'markdown-docs', 'docs', dir);
            fs.mkdirSync(mdDir, { recursive: true });
            for (const file of uniqueMdFiles) {
              fs.writeFileSync(
                path.join(mdDir, `${file}.html`),
                `md-doc:${dir}/${file}:${content}`
              );
            }
          }

          // Set up public assets
          fs.mkdirSync(publicDir, { recursive: true });
          for (const file of uniquePublicFiles) {
            fs.writeFileSync(
              path.join(publicDir, `${file}.html`),
              `public:${file}:${content}`
            );
          }

          // Run consolidation
          simulateConsolidation(baseDir, publicDir);

          // Collect all files from build/final/
          const finalDir = path.join(baseDir, 'build', 'final');
          const finalFiles = collectFiles(finalDir);

          // Verify every api-docs file is present at correct path
          for (const file of uniqueApiFiles) {
            const expectedPath = path.join('docs', 'api', `${file}.html`);
            expect(finalFiles.has(expectedPath)).toBe(true);
            expect(finalFiles.get(expectedPath)).toBe(`api-doc:${file}:${content}`);
          }

          // Verify every markdown-docs file is present at correct path
          for (const dir of uniqueMdDirs) {
            for (const file of uniqueMdFiles) {
              const expectedPath = path.join('docs', dir, `${file}.html`);
              expect(finalFiles.has(expectedPath)).toBe(true);
              expect(finalFiles.get(expectedPath)).toBe(`md-doc:${dir}/${file}:${content}`);
            }
          }

          // Verify every public asset is present at root
          for (const file of uniquePublicFiles) {
            const expectedPath = `${file}.html`;
            expect(finalFiles.has(expectedPath)).toBe(true);
            expect(finalFiles.get(expectedPath)).toBe(`public:${file}:${content}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('No file from one staging directory overwrites a file from another', () => {
    fc.assert(
      fc.property(
        // Generate unique subdirectory names for markdown-docs (must not collide with "api")
        fc.array(safeFileName, { minLength: 1, maxLength: 4 })
          .map(dirs => dirs.filter(d => d !== 'api' && d !== 'css'))
          .filter(dirs => dirs.length >= 1),
        fc.array(safeFileName, { minLength: 1, maxLength: 3 }),
        (mdDirs, mdFiles) => {
          const uniqueMdDirs = [...new Set(mdDirs)];
          const uniqueMdFiles = [...new Set(mdFiles)];
          if (uniqueMdDirs.length === 0 || uniqueMdFiles.length === 0) return;

          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));
          const stagingDir = path.join(baseDir, 'build', 'staging');
          const publicDir = path.join(baseDir, 'public');

          // Create api-docs with a known file
          const apiDocsDir = path.join(stagingDir, 'api-docs', 'docs', 'api');
          fs.mkdirSync(apiDocsDir, { recursive: true });
          fs.writeFileSync(
            path.join(apiDocsDir, 'index.html'),
            'SOURCE:api-docs'
          );

          // Create markdown-docs with files in separate directories
          for (const dir of uniqueMdDirs) {
            const mdDir = path.join(stagingDir, 'markdown-docs', 'docs', dir);
            fs.mkdirSync(mdDir, { recursive: true });
            for (const file of uniqueMdFiles) {
              fs.writeFileSync(
                path.join(mdDir, `${file}.html`),
                `SOURCE:markdown-docs:${dir}/${file}`
              );
            }
          }

          // Create a public asset that does NOT collide with docs/ paths
          fs.mkdirSync(publicDir, { recursive: true });
          fs.writeFileSync(
            path.join(publicDir, 'index.html'),
            'SOURCE:public'
          );

          // Run consolidation
          simulateConsolidation(baseDir, publicDir);

          // Verify api-docs file was not overwritten by markdown-docs
          const finalDir = path.join(baseDir, 'build', 'final');
          const apiIndexPath = path.join(finalDir, 'docs', 'api', 'index.html');
          expect(fs.existsSync(apiIndexPath)).toBe(true);
          expect(fs.readFileSync(apiIndexPath, 'utf8')).toBe('SOURCE:api-docs');

          // Verify markdown-docs files are intact
          for (const dir of uniqueMdDirs) {
            for (const file of uniqueMdFiles) {
              const filePath = path.join(finalDir, 'docs', dir, `${file}.html`);
              expect(fs.existsSync(filePath)).toBe(true);
              expect(fs.readFileSync(filePath, 'utf8')).toBe(
                `SOURCE:markdown-docs:${dir}/${file}`
              );
            }
          }

          // Verify public landing page is at root
          const publicIndexPath = path.join(finalDir, 'index.html');
          expect(fs.existsSync(publicIndexPath)).toBe(true);
          expect(fs.readFileSync(publicIndexPath, 'utf8')).toBe('SOURCE:public');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Previous build/final/ is removed before consolidation', () => {
    fc.assert(
      fc.property(
        safeFileName,
        fileContent,
        (staleFile, content) => {
          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));
          const finalDir = path.join(baseDir, 'build', 'final');
          const stagingDir = path.join(baseDir, 'build', 'staging');
          const publicDir = path.join(baseDir, 'public');

          // Create a stale file in build/final/ from a "previous run"
          fs.mkdirSync(path.join(finalDir, 'stale'), { recursive: true });
          fs.writeFileSync(
            path.join(finalDir, 'stale', `${staleFile}.html`),
            `stale:${content}`
          );

          // Create minimal staging content
          const apiDocsDir = path.join(stagingDir, 'api-docs', 'docs', 'api');
          fs.mkdirSync(apiDocsDir, { recursive: true });
          fs.writeFileSync(path.join(apiDocsDir, 'index.html'), 'fresh-api-doc');

          // Create minimal public content
          fs.mkdirSync(publicDir, { recursive: true });
          fs.writeFileSync(path.join(publicDir, 'index.html'), 'fresh-landing');

          // Run consolidation
          simulateConsolidation(baseDir, publicDir);

          // Verify stale file is gone
          const staleDir = path.join(finalDir, 'stale');
          expect(fs.existsSync(staleDir)).toBe(false);

          // Verify fresh content is present
          expect(fs.readFileSync(path.join(finalDir, 'docs', 'api', 'index.html'), 'utf8'))
            .toBe('fresh-api-doc');
          expect(fs.readFileSync(path.join(finalDir, 'index.html'), 'utf8'))
            .toBe('fresh-landing');
        }
      ),
      { numRuns: 100 }
    );
  });
});
