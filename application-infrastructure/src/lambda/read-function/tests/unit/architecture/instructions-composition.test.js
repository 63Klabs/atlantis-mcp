/**
 * Architecture Tests for Instructions Composition
 *
 * Task 2.1: Verify that config/server-instructions.js remains the only composer
 * and utils/mcp-protocol.js is the only consumer. Forbid inline composition in
 * any formatter or helper (Requirement 1.1).
 *
 * @module tests/unit/architecture/instructions-composition
 */

const { describe, it, expect } = require('@jest/globals');
const path = require('path');
const fs = require('fs');

describe('Architecture: Instructions Composition (Task 2.1)', () => {
  const lambdaRoot = path.join(__dirname, '../../..');
  
  describe('Single Source of Truth', () => {
    it('buildInstructions() is defined only in config/server-instructions.js', () => {
      // >! Verify the single source exists
      const serverInstructionsPath = path.join(lambdaRoot, 'config/server-instructions.js');
      expect(fs.existsSync(serverInstructionsPath)).toBe(true);
      
      // >! Read and verify it exports buildInstructions
      const serverInstructions = require('../../../config/server-instructions.js');
      expect(typeof serverInstructions.buildInstructions).toBe('function');
    });
    
    it('config/server-instructions.js is the only file that exports buildInstructions', () => {
      // >! Search all JS files for 'exports.buildInstructions' or 'module.exports = { buildInstructions'
      const allFiles = getAllJsFiles(lambdaRoot);
      const filesExportingBuildInstructions = allFiles.filter(filePath => {
        // >! Skip test files (this test file imports buildInstructions for testing)
        if (filePath.includes('/tests/') || filePath.includes('.test.js') || filePath.includes('.jest.js')) {
          return false;
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        return (
          content.includes('buildInstructions') && 
          (
            content.match(/exports\.buildInstructions\s*=/) ||
            content.match(/module\.exports\s*=\s*{\s*[^}]*buildInstructions[^}]*}/)
          ) &&
          !filePath.includes('node_modules')
        );
      });
      
      // >! Exactly one file should export buildInstructions
      const relativePaths = filesExportingBuildInstructions.map(f => path.relative(lambdaRoot, f));
      expect(relativePaths).toEqual(['config/server-instructions.js']);
    });
  });
  
  describe('Single Consumer', () => {
    it('utils/mcp-protocol.js imports buildInstructions from config/server-instructions.js', () => {
      const mcpProtocolPath = path.join(lambdaRoot, 'utils/mcp-protocol.js');
      const content = fs.readFileSync(mcpProtocolPath, 'utf8');
      
      // >! Verify the import exists
      expect(content).toMatch(/require\(['"]\.\.\/config\/server-instructions['"]\)/);
      expect(content).toMatch(/buildInstructions/);
    });
    
    it('utils/mcp-protocol.js is the only non-test file that imports buildInstructions', () => {
      const allFiles = getAllJsFiles(lambdaRoot);
      const filesImportingBuildInstructions = allFiles.filter(filePath => {
        // >! Skip test files
        if (filePath.includes('/tests/') || filePath.includes('.test.js') || filePath.includes('.jest.js')) {
          return false;
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        return (
          content.match(/require\(['"].*server-instructions['"]\)/) &&
          content.includes('buildInstructions')
        );
      });
      
      const relativePaths = filesImportingBuildInstructions.map(f => path.relative(lambdaRoot, f));
      expect(relativePaths).toEqual(['utils/mcp-protocol.js']);
    });
    
    it('utils/mcp-protocol.js calls buildInstructions() exactly once (in getCapabilities, shared by every carrier)', () => {
      const mcpProtocolPath = path.join(lambdaRoot, 'utils/mcp-protocol.js');
      const content = fs.readFileSync(mcpProtocolPath, 'utf8');
      
      // >! Count buildInstructions() calls (not including the import)
      // Match both buildInstructions() and buildInstructions(options)
      const calls = content.match(/buildInstructions\([^)]*\)/g) || [];
      const nonImportCalls = calls.filter(call => !call.includes('require'));
      // Phase 3: buildInstructions is now called once in getCapabilities()
      // initializeResult calls getCapabilities() which calls buildInstructions(options)
      expect(nonImportCalls.length).toBe(1);
      
      // >! Verify it's in getCapabilities
      expect(content).toMatch(/function getCapabilities[\s\S]*?buildInstructions\(options\)/);
    });
  });
  
  describe('No Inline Composition', () => {
    it('no file contains inline instructions string composition', () => {
      const allFiles = getAllJsFiles(lambdaRoot);
      const violations = [];
      
      // >! Pattern for detecting inline composition of instructions-like strings
      const inlinePatterns = [
        /instructions:\s*['"`]This server is the authoritative/i,
        /instructions:\s*['"`].*Atlantis.*cache-data/i,
        /instructions\s*=\s*['"`]This server/i,
        /instructions\s*\+=\s*['"`]/,
        /const\s+instructions\s*=\s*['"`].*Query this server/i
      ];
      
      allFiles.forEach(filePath => {
        // >! Skip the source file itself and test files
        if (
          filePath.endsWith('config/server-instructions.js') ||
          filePath.includes('/tests/') ||
          filePath.includes('.test.js') ||
          filePath.includes('.jest.js')
        ) {
          return;
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        inlinePatterns.forEach(pattern => {
          if (pattern.test(content)) {
            violations.push({
              file: path.relative(lambdaRoot, filePath),
              pattern: pattern.source
            });
          }
        });
      });
      
      expect(violations).toEqual([]);
    });
    
    it('no controller composes instructions inline', () => {
      const controllersDir = path.join(lambdaRoot, 'controllers');
      if (!fs.existsSync(controllersDir)) {
        return; // Skip if controllers dir doesn't exist
      }
      
      const controllerFiles = getAllJsFiles(controllersDir);
      const violations = [];
      
      controllerFiles.forEach(filePath => {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // >! Check for any instructions-related composition
        if (content.match(/instructions[^;]*=.*['"`]/) && content.includes('Atlantis')) {
          violations.push(path.relative(lambdaRoot, filePath));
        }
      });
      
      expect(violations).toEqual([]);
    });
    
    it('no formatter composes instructions inline', () => {
      const utilsDir = path.join(lambdaRoot, 'utils');
      const utilFiles = getAllJsFiles(utilsDir);
      const violations = [];
      
      utilFiles.forEach(filePath => {
        // >! Skip mcp-protocol.js since it's the allowed consumer
        if (filePath.endsWith('mcp-protocol.js')) {
          return;
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        
        // >! Check for any instructions composition
        if (content.match(/instructions[^;]*=.*['"`]/) && content.includes('authoritative')) {
          violations.push(path.relative(lambdaRoot, filePath));
        }
      });
      
      expect(violations).toEqual([]);
    });
  });
  
  describe('Architectural Guarantees', () => {
    it('changing config/server-instructions.js updates both carriers', () => {
      const { buildInstructions } = require('../../../config/server-instructions.js');
      const MCPProtocol = require('../../../utils/mcp-protocol.js');
      
      // >! Call buildInstructions directly
      const directResult = buildInstructions();
      
      // >! Call through initializeResult
      const initResponse = MCPProtocol.initializeResult('test-id');
      const initInstructions = initResponse.result.instructions;
      
      // >! Call through getCapabilities
      const capabilities = MCPProtocol.getCapabilities();
      const capInstructions = capabilities.instructions;
      
      // >! All three should be identical
      expect(initInstructions).toBe(directResult);
      expect(capInstructions).toBe(directResult);
    });
    
    it('instructions content comes from buildInstructions, not hardcoded', () => {
      const MCPProtocol = require('../../../utils/mcp-protocol.js');
      const mcpProtocolPath = path.join(lambdaRoot, 'utils/mcp-protocol.js');
      const content = fs.readFileSync(mcpProtocolPath, 'utf8');
      
      // >! Verify mcp-protocol.js doesn't contain hardcoded instructions text
      expect(content).not.toMatch(/instructions:\s*['"`]This server is/);
      expect(content).not.toMatch(/instructions:\s*['"`]Query this server/);
      
      // >! Phase 3: initializeResult calls getCapabilities which calls buildInstructions
      // Verify the chain: initializeResult -> getCapabilities() -> buildInstructions(options)
      expect(content).toMatch(/buildInstructions/);
      expect(content).toMatch(/getCapabilities\(/);
      
      // >! Verify the actual runtime result matches what we expect
      const result = MCPProtocol.initializeResult('test');
      expect(result.result.instructions).toContain('Atlantis');
      expect(result.result.instructions).toContain('cache-data');
    });
  });
});

/**
 * Recursively get all .js files in a directory, excluding node_modules
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
        // >! Skip node_modules
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
