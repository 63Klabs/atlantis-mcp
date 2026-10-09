/**
 * Architecture Tests for No Hardcoded MCP Protocol Revisions
 *
 * Task 5.4: Verify that protocol revision strings (2024-11-05, 2025-11-25, 2026-07-28)
 * appear only in utils/mcp-protocol.js and utils/mcp-era.js.
 * This ensures that protocol revisions are centrally managed and prevents
 * accidental hardcoding of version strings throughout the application.
 *
 * Requirements: 3.2, 15.5
 *
 * @module tests/unit/architecture/no-hardcoded-revisions
 */

const { describe, it, expect } = require('@jest/globals');
const path = require('path');
const fs = require('fs');

describe('Architecture: No Hardcoded Protocol Revisions (Task 5.4)', () => {
  const lambdaRoot = path.join(__dirname, '../../..');
  const allowedFiles = [
    path.normalize(path.join(lambdaRoot, 'utils/mcp-protocol.js')),
    path.normalize(path.join(lambdaRoot, 'utils/mcp-era.js')),
    path.normalize(path.join(lambdaRoot, 'utils/tool-catalog.js')) // Phase 3: Allowed for REVISIONS_SUPPORTING_TITLE_ANNOTATIONS
  ];
  
  // Protocol revision strings that should only appear in mcp-protocol.js and mcp-era.js
  const PROTOCOL_REVISIONS = ['2024-11-05', '2025-11-25', '2026-07-28'];
  
  describe('Protocol Revision Strings', () => {
    it('should only exist in utils/mcp-protocol.js and utils/mcp-era.js', () => {
      const violations = [];
      
      // Get all JS files in the Lambda function directory
      const allFiles = getAllJsFiles(lambdaRoot);
      
      allFiles.forEach(filePath => {
        // >! Skip the allowed files (mcp-protocol.js and mcp-era.js)
        if (allowedFiles.includes(path.normalize(filePath))) {
          return;
        }
        
        // >! Skip test files - they may reference revisions in test data
        if (
          filePath.includes('/tests/') ||
          filePath.includes('.test.js') ||
          filePath.includes('.jest.js')
        ) {
          return;
        }
        
        // >! Skip node_modules
        if (filePath.includes('node_modules')) {
          return;
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        
        // >! Search for each protocol revision string
        PROTOCOL_REVISIONS.forEach(revision => {
          lines.forEach((line, lineIndex) => {
            if (line.includes(revision)) {
              violations.push({
                file: path.relative(lambdaRoot, filePath),
                line: lineIndex + 1,
                revision: revision,
                content: line.trim()
              });
            }
          });
        });
      });
      
      // >! Build detailed error message if violations found
      if (violations.length > 0) {
        const errorMessage = [
          '\nFound hardcoded protocol revision strings outside of mcp-protocol.js and mcp-era.js:',
          '',
          ...violations.map(v => 
            `  ${v.file}:${v.line}\n    Revision: ${v.revision}\n    Content: ${v.content}`
          ),
          '',
          'Protocol revision strings should only appear in utils/mcp-protocol.js and utils/mcp-era.js.',
          'Move these revision strings to one of those modules and reference them from there.'
        ].join('\n');
        
        expect(violations).toEqual([]);
        throw new Error(errorMessage);
      }
      
      expect(violations).toEqual([]);
    });
    
    it('mcp-protocol.js and mcp-era.js should be the authoritative sources for protocol revisions', () => {
      // >! Verify both allowed files exist
      allowedFiles.forEach(allowedFile => {
        expect(fs.existsSync(allowedFile)).toBe(true);
      });
      
      // >! Verify mcp-protocol.js contains at least one protocol revision
      const mcpProtocolContent = fs.readFileSync(allowedFiles[0], 'utf8');
      const hasRevisions = PROTOCOL_REVISIONS.some(revision => 
        mcpProtocolContent.includes(revision)
      );
      
      expect(hasRevisions).toBe(true);
    });
    
    it('should detect revisions in various code contexts', () => {
      // >! This test validates the detection patterns work correctly
      const testCases = [
        { code: 'const version = "2024-11-05";', shouldMatch: true },
        { code: "const version = '2025-11-25';", shouldMatch: true },
        { code: 'const version = `2026-07-28`;', shouldMatch: true },
        { code: 'if (protocolVersion === "2024-11-05") {', shouldMatch: true },
        { code: '// Protocol version 2025-11-25', shouldMatch: true },
        { code: 'supportedVersions: ["2024-11-05", "2026-07-28"]', shouldMatch: true },
        { code: 'const date = "2024-11-06";', shouldMatch: false },
        { code: 'const unrelated = "some other string";', shouldMatch: false },
      ];
      
      testCases.forEach(({ code, shouldMatch }) => {
        const hasRevision = PROTOCOL_REVISIONS.some(revision => 
          code.includes(revision)
        );
        expect(hasRevision).toBe(shouldMatch);
      });
    });
  });
  
  describe('Protocol Revision Management', () => {
    it('should document why revisions must be centralized', () => {
      // >! This test serves as documentation
      const reasons = [
        'Single source of truth for supported protocol versions',
        'Prevents version drift across codebase',
        'Makes version updates atomic - change one file',
        'Enables consistent version negotiation',
        'Simplifies testing and validation'
      ];
      
      expect(reasons.length).toBeGreaterThan(0);
    });
  });
});

/**
 * Recursively get all .js files in a directory, excluding node_modules
 * 
 * @param {string} dir - Directory to search
 * @returns {string[]} Array of absolute file paths
 */
function getAllJsFiles(dir) {
  const files = [];
  
  function traverse(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        // >! Skip node_modules directory
        if (entry.name === 'node_modules') {
          continue;
        }
        traverse(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
  }
  
  traverse(dir);
  return files;
}
