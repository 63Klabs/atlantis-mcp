#!/usr/bin/env node

/**
 * Link Validation Script
 * 
 * Scans markdown files for links and validates that targets exist.
 * Generates a report of broken links and suggests fixes.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, dirname, resolve, relative, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

/**
 * Find all markdown files in a directory recursively
 * 
 * @param {string} dir - Directory to search
 * @param {Array<string>} excludeDirs - Directories to exclude
 * @returns {Promise<Array<string>>} Array of markdown file paths
 */
async function findMarkdownFiles(dir, excludeDirs = ['node_modules', '.git']) {
  const files = [];
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          const subFiles = await findMarkdownFiles(fullPath, excludeDirs);
          files.push(...subFiles);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message);
  }
  
  return files;
}

/**
 * Extract markdown links from file content
 * 
 * @param {string} content - File content
 * @returns {Array<{text: string, target: string, line: number}>} Array of links
 */
function extractLinks(content) {
  const links = [];
  const lines = content.split('\n');
  
  // Match markdown links: [text](target)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  
  lines.forEach((line, index) => {
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      const [, text, target] = match;
      
      // Skip external links (http/https)
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        // Remove anchor fragments for file existence check
        const targetWithoutAnchor = target.split('#')[0];
        
        if (targetWithoutAnchor) {
          links.push({
            text,
            target: targetWithoutAnchor,
            fullTarget: target,
            line: index + 1
          });
        }
      }
    }
  });
  
  return links;
}

/**
 * Check if a link target exists
 * 
 * @param {string} sourceFile - Source markdown file path
 * @param {string} target - Link target (relative or absolute)
 * @returns {Promise<{exists: boolean, resolvedPath: string}>} Validation result
 */
async function validateLinkTarget(sourceFile, target) {
  const sourceDir = dirname(sourceFile);
  
  // Resolve relative path from source file location
  const resolvedPath = isAbsolute(target) 
    ? join(projectRoot, target)
    : resolve(sourceDir, target);
  
  try {
    await stat(resolvedPath);
    return { exists: true, resolvedPath };
  } catch (error) {
    return { exists: false, resolvedPath };
  }
}

/**
 * Suggest fix for broken link
 * 
 * @param {string} sourceFile - Source markdown file
 * @param {string} target - Broken link target
 * @param {string} resolvedPath - Resolved path that doesn't exist
 * @returns {Promise<string|null>} Suggested fix or null
 */
async function suggestFix(sourceFile, target, resolvedPath) {
  // Check if file exists with .md extension
  if (!target.endsWith('.md')) {
    const withMd = resolvedPath + '.md';
    try {
      await stat(withMd);
      return target + '.md';
    } catch (error) {
      // Not found with .md extension
    }
  }
  
  // Check if it's an absolute path that should be relative
  if (isAbsolute(target)) {
    const sourceDir = dirname(sourceFile);
    const relativePath = relative(sourceDir, resolvedPath);
    
    // Check if relative path exists
    try {
      await stat(resolve(sourceDir, relativePath));
      return relativePath;
    } catch (error) {
      // Relative path doesn't exist either
    }
  }
  
  return null;
}

/**
 * Validate all links in markdown files
 * 
 * @param {Array<string>} files - Array of markdown file paths
 * @returns {Promise<Object>} Validation results
 */
async function validateLinks(files) {
  const results = {
    totalFiles: files.length,
    totalLinks: 0,
    brokenLinks: [],
    validLinks: 0
  };
  
  for (const file of files) {
    try {
      const content = await readFile(file, 'utf8');
      const links = extractLinks(content);
      
      results.totalLinks += links.length;
      
      for (const link of links) {
        const validation = await validateLinkTarget(file, link.target);
        
        if (validation.exists) {
          results.validLinks++;
        } else {
          const suggestedFix = await suggestFix(file, link.target, validation.resolvedPath);
          
          results.brokenLinks.push({
            sourceFile: relative(projectRoot, file),
            line: link.line,
            linkText: link.text,
            target: link.target,
            fullTarget: link.fullTarget,
            resolvedPath: relative(projectRoot, validation.resolvedPath),
            suggestedFix
          });
        }
      }
    } catch (error) {
      console.error(`Error processing ${file}:`, error.message);
    }
  }
  
  return results;
}

/**
 * Generate validation report
 * 
 * @param {Object} results - Validation results
 */
function generateReport(results) {
  console.log('\n=== Link Validation Report ===\n');
  console.log(`Total files scanned: ${results.totalFiles}`);
  console.log(`Total links found: ${results.totalLinks}`);
  console.log(`Valid links: ${results.validLinks}`);
  console.log(`Broken links: ${results.brokenLinks.length}\n`);
  
  if (results.brokenLinks.length === 0) {
    console.log('✓ All links are valid!\n');
    return;
  }
  
  console.log('=== Broken Links ===\n');
  
  // Group by source file
  const byFile = {};
  for (const broken of results.brokenLinks) {
    if (!byFile[broken.sourceFile]) {
      byFile[broken.sourceFile] = [];
    }
    byFile[broken.sourceFile].push(broken);
  }
  
  for (const [file, links] of Object.entries(byFile)) {
    console.log(`\n${file}:`);
    
    for (const link of links) {
      console.log(`  Line ${link.line}: [${link.linkText}](${link.fullTarget})`);
      console.log(`    Target: ${link.target}`);
      console.log(`    Resolved to: ${link.resolvedPath}`);
      
      if (link.suggestedFix) {
        console.log(`    Suggested fix: ${link.suggestedFix}`);
      }
      
      console.log('');
    }
  }
  
  console.log('\n=== Summary by Issue Type ===\n');
  
  const missingExtension = results.brokenLinks.filter(l => l.suggestedFix && l.suggestedFix.endsWith('.md'));
  const absolutePaths = results.brokenLinks.filter(l => isAbsolute(l.target));
  const movedFiles = results.brokenLinks.filter(l => !l.suggestedFix);
  
  if (missingExtension.length > 0) {
    console.log(`Missing .md extension: ${missingExtension.length} links`);
  }
  
  if (absolutePaths.length > 0) {
    console.log(`Absolute paths (should be relative): ${absolutePaths.length} links`);
  }
  
  if (movedFiles.length > 0) {
    console.log(`Moved or deleted files: ${movedFiles.length} links`);
  }
  
  console.log('');
}

/**
 * Main execution
 */
async function main() {
  console.log('Scanning for markdown files...');
  
  const files = await findMarkdownFiles(projectRoot);
  console.log(`Found ${files.length} markdown files\n`);
  
  console.log('Validating links...');
  const results = await validateLinks(files);
  
  generateReport(results);
  
  // Exit with error code if broken links found
  if (results.brokenLinks.length > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
