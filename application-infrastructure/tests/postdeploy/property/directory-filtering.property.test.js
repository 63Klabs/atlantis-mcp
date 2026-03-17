// Feature: post-deployment-static-generation, Property 4: Only permitted directories are processed
// Validates: Requirements 4.1, 9.2

const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Simulate the markdown doc generator's directory filtering logic.
 * This mirrors the core loop in 03-generate-markdown-docs.sh:
 *   - Iterates over PUBLIC_DOC_DIRS
 *   - Skips directories not found under docs/
 *   - Only produces output for directories in PUBLIC_DOC_DIRS that exist
 *
 * @param {string} baseDir - Base directory for the simulation
 * @param {Array<string>} publicDocDirs - Directories permitted for generation
 * @returns {Array<string>} Directory names that produced output
 */
function simulateDirectoryFiltering(baseDir, publicDocDirs) {
  const processedDirs = [];

  for (const dir of publicDocDirs) {
    const sourceDir = path.join(baseDir, 'docs', dir);

    // Skip directories that do not exist (mirrors script WARN + continue)
    if (!fs.existsSync(sourceDir)) {
      continue;
    }

    // Create output directory and a placeholder file (mirrors Pandoc output)
    const outputDir = path.join(baseDir, 'build', 'staging', 'markdown-docs', 'docs', dir);
    fs.mkdirSync(outputDir, { recursive: true });

    // Convert any .md files found
    const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const htmlName = file === 'README.md'
        ? 'index.html'
        : file.replace(/\.md$/, '.html');
      fs.writeFileSync(
        path.join(outputDir, htmlName),
        `<html><body>Converted: ${file}</body></html>`
      );
    }

    if (files.length > 0) {
      processedDirs.push(dir);
    }
  }

  return processedDirs;
}


/**
 * Collect all directory names under the markdown-docs staging output.
 *
 * @param {string} baseDir - Base directory for the simulation
 * @returns {Array<string>} Directory names that have output files
 */
function collectOutputDirs(baseDir) {
  const stagingDocsDir = path.join(baseDir, 'build', 'staging', 'markdown-docs', 'docs');
  if (!fs.existsSync(stagingDocsDir)) {
    return [];
  }

  return fs.readdirSync(stagingDocsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'css')
    .map(entry => entry.name);
}

/**
 * Arbitrary for safe directory names: lowercase alpha with optional digits, 2-8 chars.
 */
const safeDirName = fc.stringMatching(/^[a-z][a-z0-9]{1,7}$/)
  .filter(s => s.length >= 2);

describe('Property 4: Only permitted directories are processed', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dir-filtering-'));
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should only produce output for directories listed in PUBLIC_DOC_DIRS', () => {
    fc.assert(
      fc.property(
        // Generate a set of all available directories (superset)
        fc.array(safeDirName, { minLength: 2, maxLength: 6 }),
        // Generate a subset to use as PUBLIC_DOC_DIRS
        fc.array(safeDirName, { minLength: 1, maxLength: 4 }),
        (allDirs, publicDocDirs) => {
          const uniqueAllDirs = [...new Set(allDirs)];
          const uniquePublicDirs = [...new Set(publicDocDirs)];
          if (uniqueAllDirs.length < 2 || uniquePublicDirs.length === 0) return;

          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));

          // Create docs/ directories for all available dirs with a markdown file
          for (const dir of uniqueAllDirs) {
            const dirPath = path.join(baseDir, 'docs', dir);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(path.join(dirPath, 'README.md'), `# ${dir}\n\nContent.`);
          }

          // Run the simulation with only the permitted directories
          simulateDirectoryFiltering(baseDir, uniquePublicDirs);

          // Collect which directories actually got output
          const outputDirs = collectOutputDirs(baseDir);

          // Every output directory must be in PUBLIC_DOC_DIRS
          for (const outputDir of outputDirs) {
            expect(uniquePublicDirs).toContain(outputDir);
          }

          // No directory outside PUBLIC_DOC_DIRS should have output
          const nonPermittedDirs = uniqueAllDirs.filter(d => !uniquePublicDirs.includes(d));
          for (const dir of nonPermittedDirs) {
            expect(outputDirs).not.toContain(dir);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should skip directories in PUBLIC_DOC_DIRS that do not exist under docs/', () => {
    fc.assert(
      fc.property(
        // Directories that exist on disk
        fc.array(safeDirName, { minLength: 1, maxLength: 3 }),
        // Directories in PUBLIC_DOC_DIRS that do NOT exist on disk
        fc.array(safeDirName, { minLength: 1, maxLength: 3 }),
        (existingDirs, missingDirs) => {
          const uniqueExisting = [...new Set(existingDirs)];
          const uniqueMissing = [...new Set(missingDirs)]
            .filter(d => !uniqueExisting.includes(d));
          if (uniqueExisting.length === 0 || uniqueMissing.length === 0) return;

          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));

          // Only create directories for the "existing" set
          for (const dir of uniqueExisting) {
            const dirPath = path.join(baseDir, 'docs', dir);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(path.join(dirPath, 'README.md'), `# ${dir}\n\nContent.`);
          }

          // PUBLIC_DOC_DIRS includes both existing and missing directories
          const allPublicDirs = [...uniqueExisting, ...uniqueMissing];
          simulateDirectoryFiltering(baseDir, allPublicDirs);

          const outputDirs = collectOutputDirs(baseDir);

          // Only existing directories should produce output
          for (const dir of uniqueExisting) {
            expect(outputDirs).toContain(dir);
          }

          // Missing directories should not produce output
          for (const dir of uniqueMissing) {
            expect(outputDirs).not.toContain(dir);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce no output when PUBLIC_DOC_DIRS is empty', () => {
    fc.assert(
      fc.property(
        fc.array(safeDirName, { minLength: 1, maxLength: 4 }),
        (allDirs) => {
          const uniqueAllDirs = [...new Set(allDirs)];
          if (uniqueAllDirs.length === 0) return;

          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));

          // Create docs/ directories
          for (const dir of uniqueAllDirs) {
            const dirPath = path.join(baseDir, 'docs', dir);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(path.join(dirPath, 'README.md'), `# ${dir}\n\nContent.`);
          }

          // Run with empty PUBLIC_DOC_DIRS
          simulateDirectoryFiltering(baseDir, []);

          const outputDirs = collectOutputDirs(baseDir);
          expect(outputDirs).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should handle PUBLIC_DOC_DIRS with no overlap with existing directories', () => {
    fc.assert(
      fc.property(
        fc.array(safeDirName, { minLength: 1, maxLength: 3 }),
        fc.array(safeDirName, { minLength: 1, maxLength: 3 }),
        (existingDirs, requestedDirs) => {
          const uniqueExisting = [...new Set(existingDirs)];
          // Ensure requested dirs have no overlap with existing
          const uniqueRequested = [...new Set(requestedDirs)]
            .filter(d => !uniqueExisting.includes(d));
          if (uniqueExisting.length === 0 || uniqueRequested.length === 0) return;

          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));

          // Create only the existing directories
          for (const dir of uniqueExisting) {
            const dirPath = path.join(baseDir, 'docs', dir);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(path.join(dirPath, 'README.md'), `# ${dir}\n\nContent.`);
          }

          // Request only non-existing directories
          simulateDirectoryFiltering(baseDir, uniqueRequested);

          const outputDirs = collectOutputDirs(baseDir);
          expect(outputDirs).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
