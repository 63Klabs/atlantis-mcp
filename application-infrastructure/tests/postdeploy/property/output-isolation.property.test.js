// Feature: post-deployment-static-generation, Property 2: Generator output isolation
// Validates: Requirements 3.3, 4.2, 4.4, 8.4

const fc = require('fast-check');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Simulate the API doc generator's file operations.
 * This mirrors the logic in 02-generate-api-docs.sh:
 *   - Reads from build/staging/api-spec/openapi.json
 *   - Writes only to build/staging/api-docs/docs/api/
 *
 * @param {string} baseDir - Base directory for the simulation
 * @param {string} specContent - Content of the OpenAPI spec file
 * @returns {{outputDir: string, outputFile: string}} Paths of generated output
 */
function simulateApiDocGenerator(baseDir, specContent) {
  const specFile = path.join(baseDir, 'build', 'staging', 'api-spec', 'openapi.json');
  const outputDir = path.join(baseDir, 'build', 'staging', 'api-docs', 'docs', 'api');
  const outputFile = path.join(outputDir, 'index.html');

  // Verify spec exists (mirrors script validation)
  if (!fs.existsSync(specFile)) {
    throw new Error(`OpenAPI spec not found at ${specFile}`);
  }

  // Create output directory and write output (mirrors Redoc CLI output)
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, `<html><body>Generated from: ${specContent}</body></html>`);

  return { outputDir, outputFile };
}

/**
 * Simulate the markdown doc generator's file operations.
 * This mirrors the logic in 03-generate-markdown-docs.sh:
 *   - Reads from docs/<dir>/ directories
 *   - Writes only to build/staging/markdown-docs/docs/<dir>/
 *   - Copies to a temp working dir first, never modifies original docs/
 *
 * @param {string} baseDir - Base directory for the simulation
 * @param {Array<string>} publicDocDirs - List of directory names to process
 * @returns {Array<string>} Paths of generated output files
 */
function simulateMarkdownDocGenerator(baseDir, publicDocDirs) {
  const outputFiles = [];

  for (const dir of publicDocDirs) {
    const sourceDir = path.join(baseDir, 'docs', dir);

    if (!fs.existsSync(sourceDir)) {
      continue; // Skip missing dirs (mirrors script warning behavior)
    }

    // Create temp working directory (mirrors script behavior)
    const tmpDir = path.join(baseDir, 'build', 'tmp', 'markdown', dir);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Copy source files to temp dir
    const files = fs.readdirSync(sourceDir);
    for (const file of files) {
      fs.copyFileSync(path.join(sourceDir, file), path.join(tmpDir, file));
    }

    // Create output directory
    const outputDir = path.join(baseDir, 'build', 'staging', 'markdown-docs', 'docs', dir);
    fs.mkdirSync(outputDir, { recursive: true });

    // Convert .md files to .html (simulated)
    for (const file of files) {
      if (file.endsWith('.md')) {
        let htmlName = file.replace(/\.md$/, '.html');
        if (htmlName === 'README.html') {
          htmlName = 'index.html';
        }
        const outputFile = path.join(outputDir, htmlName);
        fs.writeFileSync(outputFile, `<html><body>Converted: ${file}</body></html>`);
        outputFiles.push(outputFile);
      }
    }

    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Clean up the parent tmp/markdown directory if empty
  const tmpMarkdownParent = path.join(baseDir, 'build', 'tmp', 'markdown');
  if (fs.existsSync(tmpMarkdownParent) && fs.readdirSync(tmpMarkdownParent).length === 0) {
    fs.rmSync(tmpMarkdownParent, { recursive: true, force: true });
  }
  // Clean up build/tmp if empty
  const tmpParent = path.join(baseDir, 'build', 'tmp');
  if (fs.existsSync(tmpParent) && fs.readdirSync(tmpParent).length === 0) {
    fs.rmSync(tmpParent, { recursive: true, force: true });
  }

  // Copy CSS stylesheet to staging
  const cssDir = path.join(baseDir, 'build', 'staging', 'markdown-docs', 'docs', 'css');
  fs.mkdirSync(cssDir, { recursive: true });
  fs.writeFileSync(path.join(cssDir, 'style.css'), 'body { font-family: sans-serif; }');
  outputFiles.push(path.join(cssDir, 'style.css'));

  return outputFiles;
}

/**
 * Recursively collect all file paths under a directory.
 *
 * @param {string} dir - Directory to scan
 * @returns {Array<string>} Array of absolute file paths
 */
function collectFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Compute a snapshot of file paths and their content hashes under a directory.
 *
 * @param {string} dir - Directory to snapshot
 * @returns {Map<string, string>} Map of relative paths to content strings
 */
function snapshotDirectory(dir) {
  const snapshot = new Map();
  if (!fs.existsSync(dir)) return snapshot;

  const files = collectFiles(dir);
  for (const file of files) {
    const relativePath = path.relative(dir, file);
    snapshot.set(relativePath, fs.readFileSync(file, 'utf8'));
  }
  return snapshot;
}

/**
 * Arbitrary for safe directory/file names: lowercase alpha with optional digits, 1-10 chars.
 */
const safeFileName = fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/)
  .filter(s => s.length >= 1);

/**
 * Arbitrary for markdown file content.
 */
const markdownContent = fc.constantFrom(
  '# Title\n\nSome content.',
  '## Section\n\nMore content here.',
  '# README\n\nProject readme.',
  '# Guide\n\n- Step 1\n- Step 2'
);

describe('Property 2: Generator output isolation', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'output-isolation-'));
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('API doc generator should not modify files outside its staging directory', () => {
    fc.assert(
      fc.property(
        // Generate a set of pre-existing directory names to place outside staging
        fc.array(safeFileName, { minLength: 1, maxLength: 5 }),
        fc.array(safeFileName, { minLength: 1, maxLength: 3 }),
        (outsideDirs, outsideFiles) => {
          // Set up the base directory structure
          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));

          // Create the OpenAPI spec file (required input)
          const specDir = path.join(baseDir, 'build', 'staging', 'api-spec');
          fs.mkdirSync(specDir, { recursive: true });
          fs.writeFileSync(path.join(specDir, 'openapi.json'), '{"openapi":"3.0.0"}');

          // Create pre-existing files outside the api-docs staging directory
          const docsDir = path.join(baseDir, 'docs');
          for (const dir of outsideDirs) {
            const dirPath = path.join(docsDir, dir);
            fs.mkdirSync(dirPath, { recursive: true });
            for (const file of outsideFiles) {
              fs.writeFileSync(
                path.join(dirPath, `${file}.md`),
                `# ${file}\n\nOriginal content.`
              );
            }
          }

          // Create a pre-existing file in a sibling staging directory
          const siblingDir = path.join(baseDir, 'build', 'staging', 'markdown-docs');
          fs.mkdirSync(siblingDir, { recursive: true });
          fs.writeFileSync(path.join(siblingDir, 'existing.html'), '<html>existing</html>');

          // Snapshot everything outside the api-docs staging directory
          const docsSnapshot = snapshotDirectory(docsDir);
          const siblingSnapshot = snapshotDirectory(siblingDir);
          const specSnapshot = snapshotDirectory(specDir);

          // Run the simulated API doc generator
          simulateApiDocGenerator(baseDir, '{"openapi":"3.0.0"}');

          // Verify: docs/ directory is unchanged
          const docsAfter = snapshotDirectory(docsDir);
          expect(docsAfter.size).toBe(docsSnapshot.size);
          for (const [filePath, content] of docsSnapshot) {
            expect(docsAfter.get(filePath)).toBe(content);
          }

          // Verify: sibling staging directory is unchanged
          const siblingAfter = snapshotDirectory(siblingDir);
          expect(siblingAfter.size).toBe(siblingSnapshot.size);
          for (const [filePath, content] of siblingSnapshot) {
            expect(siblingAfter.get(filePath)).toBe(content);
          }

          // Verify: api-spec staging directory is unchanged
          const specAfter = snapshotDirectory(specDir);
          expect(specAfter.size).toBe(specSnapshot.size);
          for (const [filePath, content] of specSnapshot) {
            expect(specAfter.get(filePath)).toBe(content);
          }

          // Verify: output was created in the correct location
          const outputFile = path.join(baseDir, 'build', 'staging', 'api-docs', 'docs', 'api', 'index.html');
          expect(fs.existsSync(outputFile)).toBe(true);
          expect(fs.readFileSync(outputFile, 'utf8').length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Markdown doc generator should not modify files outside its staging directory', () => {
    fc.assert(
      fc.property(
        // Generate directory names for PUBLIC_DOC_DIRS
        fc.array(safeFileName, { minLength: 1, maxLength: 4 }),
        // Generate markdown file names per directory
        fc.array(safeFileName, { minLength: 1, maxLength: 3 }),
        markdownContent,
        (publicDocDirs, mdFileNames, content) => {
          const uniqueDirs = [...new Set(publicDocDirs)];
          if (uniqueDirs.length === 0) return; // Skip empty sets

          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));

          // Create source docs/ directories with markdown files
          const docsDir = path.join(baseDir, 'docs');
          for (const dir of uniqueDirs) {
            const dirPath = path.join(docsDir, dir);
            fs.mkdirSync(dirPath, { recursive: true });
            for (const fileName of mdFileNames) {
              fs.writeFileSync(path.join(dirPath, `${fileName}.md`), content);
            }
            // Add a README.md to test the rename behavior
            fs.writeFileSync(path.join(dirPath, 'README.md'), '# README\n\nProject readme.');
          }

          // Create a pre-existing file in a sibling staging directory
          const siblingDir = path.join(baseDir, 'build', 'staging', 'api-docs');
          fs.mkdirSync(siblingDir, { recursive: true });
          fs.writeFileSync(path.join(siblingDir, 'existing.html'), '<html>existing</html>');

          // Snapshot everything outside the markdown-docs staging directory
          const docsSnapshot = snapshotDirectory(docsDir);
          const siblingSnapshot = snapshotDirectory(siblingDir);

          // Run the simulated markdown doc generator
          simulateMarkdownDocGenerator(baseDir, uniqueDirs);

          // Verify: original docs/ directory is byte-for-byte identical
          const docsAfter = snapshotDirectory(docsDir);
          expect(docsAfter.size).toBe(docsSnapshot.size);
          for (const [filePath, fileContent] of docsSnapshot) {
            expect(docsAfter.has(filePath)).toBe(true);
            expect(docsAfter.get(filePath)).toBe(fileContent);
          }

          // Verify: sibling staging directory is unchanged
          const siblingAfter = snapshotDirectory(siblingDir);
          expect(siblingAfter.size).toBe(siblingSnapshot.size);
          for (const [filePath, fileContent] of siblingSnapshot) {
            expect(siblingAfter.get(filePath)).toBe(fileContent);
          }

          // Verify: temp working directories are cleaned up
          const tmpMarkdownDir = path.join(baseDir, 'build', 'tmp', 'markdown');
          expect(fs.existsSync(tmpMarkdownDir)).toBe(false);

          // Verify: output was created in the correct staging location
          const markdownStagingDir = path.join(baseDir, 'build', 'staging', 'markdown-docs', 'docs');
          expect(fs.existsSync(markdownStagingDir)).toBe(true);
          for (const dir of uniqueDirs) {
            const outputDirPath = path.join(markdownStagingDir, dir);
            expect(fs.existsSync(outputDirPath)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('No generator should create files outside the build/ directory tree', () => {
    fc.assert(
      fc.property(
        fc.array(safeFileName, { minLength: 1, maxLength: 3 }),
        fc.array(safeFileName, { minLength: 1, maxLength: 2 }),
        (publicDocDirs, mdFileNames) => {
          const uniqueDirs = [...new Set(publicDocDirs)];
          if (uniqueDirs.length === 0) return;

          const baseDir = fs.mkdtempSync(path.join(tempDir, 'run-'));

          // Create source structure
          const docsDir = path.join(baseDir, 'docs');
          for (const dir of uniqueDirs) {
            const dirPath = path.join(docsDir, dir);
            fs.mkdirSync(dirPath, { recursive: true });
            for (const fileName of mdFileNames) {
              fs.writeFileSync(path.join(dirPath, `${fileName}.md`), '# Content');
            }
          }

          // Create API spec
          const specDir = path.join(baseDir, 'build', 'staging', 'api-spec');
          fs.mkdirSync(specDir, { recursive: true });
          fs.writeFileSync(path.join(specDir, 'openapi.json'), '{"openapi":"3.0.0"}');

          // Snapshot the base directory (excluding build/)
          const topLevelBefore = new Set();
          if (fs.existsSync(baseDir)) {
            for (const entry of fs.readdirSync(baseDir)) {
              if (entry !== 'build') {
                topLevelBefore.add(entry);
              }
            }
          }

          // Run both generators
          simulateApiDocGenerator(baseDir, '{"openapi":"3.0.0"}');
          simulateMarkdownDocGenerator(baseDir, uniqueDirs);

          // Verify: no new top-level directories were created
          const topLevelAfter = new Set();
          for (const entry of fs.readdirSync(baseDir)) {
            if (entry !== 'build') {
              topLevelAfter.add(entry);
            }
          }
          expect(topLevelAfter.size).toBe(topLevelBefore.size);
          for (const entry of topLevelBefore) {
            expect(topLevelAfter.has(entry)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
