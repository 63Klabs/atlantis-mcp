#!/usr/bin/env node
/**
 * Script to fix integration tests
 * 
 * This script automatically fixes common issues in integration tests:
 * 1. Adds test-helpers import
 * 2. Replaces handler(event) calls with handler(event, context)
 * 3. Adds context creation before handler calls
 * 4. Fixes duplicate jest declarations
 * 5. Fixes AWS SDK mocks
 */

const fs = require('fs');
const path = require('path');

const testFiles = [
  'rate-limiting-integration.test.js',
  'mcp-protocol-compliance.test.js',
  'caching-integration.test.js',
  'github-integration.test.js',
  's3-integration.test.js',
  'multi-source-integration.test.js'
];

function fixTestFile(filePath) {
  console.log(`\nFixing ${path.basename(filePath)}...`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  let changes = 0;

  // 1. Add test-helpers import if not present
  if (!content.includes('test-helpers')) {
    const handlerImport = content.match(/const \{ handler \} = require\('.*?'\);/);
    if (handlerImport) {
      const newImport = `${handlerImport[0]}\nconst { createMockContext, createMCPToolRequest, createMockEvent } = require('./test-helpers');`;
      content = content.replace(handlerImport[0], newImport);
      changes++;
      console.log('  ✓ Added test-helpers import');
    }
  }

  // 2. Fix handler calls without context
  // Pattern: await handler(event);
  const handlerCallPattern = /await handler\((\w+)\);/g;
  let match;
  const replacements = [];
  
  while ((match = handlerCallPattern.exec(content)) !== null) {
    const eventVar = match[1];
    const fullMatch = match[0];
    const contextVar = eventVar.replace('event', 'context');
    
    // Check if context is already defined nearby
    const beforeMatch = content.substring(Math.max(0, match.index - 500), match.index);
    if (!beforeMatch.includes(`const ${contextVar} = createMockContext()`)) {
      replacements.push({
        old: fullMatch,
        new: `const ${contextVar} = createMockContext();\n      ${fullMatch.replace(');', `, ${contextVar});`)}`
      });
    } else {
      replacements.push({
        old: fullMatch,
        new: fullMatch.replace(');', `, ${contextVar});`)
      });
    }
  }

  // Apply replacements
  for (const repl of replacements) {
    if (content.includes(repl.old)) {
      content = content.replace(repl.old, repl.new);
      changes++;
    }
  }

  if (replacements.length > 0) {
    console.log(`  ✓ Fixed ${replacements.length} handler calls`);
  }

  // 3. Fix duplicate jest declarations in github-integration.test.js
  if (filePath.includes('github-integration')) {
    const jestDeclarations = content.match(/^jest$/gm);
    if (jestDeclarations && jestDeclarations.length > 1) {
      // Remove standalone 'jest' declarations
      content = content.replace(/^jest\n/gm, '');
      changes++;
      console.log('  ✓ Removed duplicate jest declarations');
    }
  }

  // 4. Fix AWS SDK v2 mocks to v3
  if (content.includes("jest.mock('aws-sdk'")) {
    content = content.replace(
      /jest\.mock\('aws-sdk'.*?\}\);/gs,
      `// AWS SDK v3 is mocked via @aws-sdk/client-* packages in test setup`
    );
    changes++;
    console.log('  ✓ Fixed AWS SDK mock');
  }

  // Write back if changes were made
  if (changes > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✅ Applied ${changes} fixes to ${path.basename(filePath)}`);
  } else {
    console.log(`  ℹ️  No fixes needed for ${path.basename(filePath)}`);
  }

  return changes;
}

// Main execution
console.log('Starting integration test fixes...\n');
let totalChanges = 0;

for (const file of testFiles) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    totalChanges += fixTestFile(filePath);
  } else {
    console.log(`⚠️  File not found: ${file}`);
  }
}

console.log(`\n✅ Complete! Applied ${totalChanges} total fixes.`);
