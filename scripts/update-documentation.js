#!/usr/bin/env node

/**
 * Documentation Update Automation Script
 * 
 * Updates documentation files to use consistent GitHubToken naming
 * instead of deprecated GitHubTokenParameter.
 * 
 * Usage:
 *   node scripts/update-documentation.js --dry-run  # Preview changes
 *   node scripts/update-documentation.js            # Apply changes
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

// Update patterns for GitHubTokenParameter → GitHubToken
const UPDATE_PATTERNS = [
  {
    name: 'Parameter name in text',
    pattern: /GitHubTokenParameter/g,
    replacement: 'GitHubToken',
    description: 'Replace GitHubTokenParameter with GitHubToken in text'
  },
  {
    name: 'YAML parameter reference',
    pattern: /GitHubTokenParameter:\s*([^\n]+)/g,
    replacement: 'GitHubToken: $1',
    description: 'Update YAML parameter references'
  },
  {
    name: 'Environment variable reference',
    pattern: /GITHUB_TOKEN_PARAMETER:\s*!Ref\s+GitHubTokenParameter/g,
    replacement: 'GITHUB_TOKEN_PARAMETER: !Ref GitHubToken',
    description: 'Update CloudFormation !Ref references'
  },
  {
    name: 'Code reference to settings.aws.githubTokenParameter',
    pattern: /settings\.aws\.githubTokenParameter/g,
    replacement: 'settings.github.token',
    description: 'Update code references to use new settings structure'
  }
];

// Files to update
const DOCUMENTATION_FILES = [
  // Deployment documentation (9 files)
  'docs/deployment/github-token-setup.md',
  'docs/deployment/multiple-github-orgs.md',
  'docs/deployment/README.md',
  'docs/deployment/self-hosting.md',
  'docs/deployment/cloudformation-parameters.md',
  'docs/application-infrastructure/deployment/sam-deployment-guide.md',
  'docs/application-infrastructure/deployment/pipeline-configuration.md',
  'docs/application-infrastructure/security/security-validation-report.md',
  
  // Spec documentation (4 files)
  '.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/tasks.md',
  '.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/requirements.md',
  '.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/design.md',
  '.kiro/specs/0-0-1-remove-api-key-requirement/design.md'
];

/**
 * Update a single file with all patterns
 * 
 * @param {string} filePath - Path to file to update
 * @param {boolean} dryRun - If true, don't write changes
 * @returns {Promise<Object>} Update results
 */
async function updateFile(filePath, dryRun = false) {
  const absolutePath = resolve(filePath);
  
  try {
    const content = await readFile(absolutePath, 'utf8');
    let updatedContent = content;
    const changes = [];
    
    // Apply each pattern
    for (const pattern of UPDATE_PATTERNS) {
      const matches = content.match(pattern.pattern);
      if (matches && matches.length > 0) {
        updatedContent = updatedContent.replace(pattern.pattern, pattern.replacement);
        changes.push({
          pattern: pattern.name,
          occurrences: matches.length
        });
      }
    }
    
    // Write changes if not dry run and changes were made
    if (!dryRun && changes.length > 0) {
      await writeFile(absolutePath, updatedContent, 'utf8');
    }
    
    return {
      filePath,
      success: true,
      changes,
      modified: changes.length > 0
    };
  } catch (error) {
    return {
      filePath,
      success: false,
      error: error.message,
      modified: false
    };
  }
}

/**
 * Generate summary report
 * 
 * @param {Array<Object>} results - Update results for all files
 * @param {boolean} dryRun - Whether this was a dry run
 */
function generateReport(results, dryRun) {
  console.log('\n' + '='.repeat(80));
  console.log(`Documentation Update Report ${dryRun ? '(DRY RUN)' : ''}`);
  console.log('='.repeat(80) + '\n');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const modified = results.filter(r => r.modified);
  
  console.log(`Total files processed: ${results.length}`);
  console.log(`Successfully processed: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Modified: ${modified.length}`);
  console.log();
  
  if (modified.length > 0) {
    console.log('Modified Files:');
    console.log('-'.repeat(80));
    for (const result of modified) {
      console.log(`\n📝 ${result.filePath}`);
      for (const change of result.changes) {
        console.log(`   - ${change.pattern}: ${change.occurrences} occurrence(s)`);
      }
    }
    console.log();
  }
  
  if (failed.length > 0) {
    console.log('Failed Files:');
    console.log('-'.repeat(80));
    for (const result of failed) {
      console.log(`\n❌ ${result.filePath}`);
      console.log(`   Error: ${result.error}`);
    }
    console.log();
  }
  
  const unmodified = successful.filter(r => !r.modified);
  if (unmodified.length > 0) {
    console.log('Unmodified Files (no changes needed):');
    console.log('-'.repeat(80));
    for (const result of unmodified) {
      console.log(`✓ ${result.filePath}`);
    }
    console.log();
  }
  
  if (dryRun) {
    console.log('⚠️  This was a DRY RUN. No files were modified.');
    console.log('   Run without --dry-run to apply changes.');
  } else {
    console.log('✅ Changes have been applied to all modified files.');
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  console.log('Starting documentation update...');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY CHANGES'}`);
  console.log();
  
  const results = [];
  
  for (const filePath of DOCUMENTATION_FILES) {
    console.log(`Processing: ${filePath}`);
    const result = await updateFile(filePath, dryRun);
    results.push(result);
  }
  
  generateReport(results, dryRun);
  
  // Exit with error code if any files failed
  const failedCount = results.filter(r => !r.success).length;
  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
