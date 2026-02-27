#!/usr/bin/env node
/**
 * Script to fix Config.getConnCacheProfile mocks in service tests
 * 
 * This script updates all service test files to use properly structured
 * mock objects that match the cache-data library expectations.
 */

const fs = require('fs');
const path = require('path');

const helperFunction = `
  // Helper function to create properly structured mock connection and cache profile
  const createMockConnCacheProfile = (connectionName = 's3-templates', profileName = 'templates-list') => {
    return {
      conn: {
        name: connectionName,
        host: [],
        path: connectionName.includes('github') ? '/repos' : (connectionName.includes('starters') ? 'app-starters/v2' : 'templates/v2'),
        parameters: {},
        cache: []
      },
      cacheProfile: {
        profile: profileName,
        overrideOriginHeaderExpiration: true,
        defaultExpirationInSeconds: 3600,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: connectionName,
        pathId: profileName.split('-').pop(), // Extract 'list', 'detail', etc.
        encrypt: false
      }
    };
  };
`;

// Files to fix
const testFiles = [
  'tests/unit/services/templates-service.test.js',
  'tests/unit/services/starters-service.test.js',
  'tests/unit/services/documentation-service.test.js'
];

testFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${file} - file not found`);
    return;
  }

  console.log(`Processing ${file}...`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Add helper function after describe() if not already present
  if (!content.includes('createMockConnCacheProfile')) {
    content = content.replace(
      /describe\([^)]+\) => \{/,
      match => match + helperFunction
    );
  }
  
  // Replace simple mock structures with helper function calls
  content = content.replace(
    /const mockConn = \{ host: \[\], parameters: \{\} \};\s*const mockCacheProfile = \{ pathId: '[^']+' \};\s*Config\.getConnCacheProfile\.mockReturnValue\(\{\s*conn: mockConn,\s*cacheProfile: mockCacheProfile\s*\}\);/g,
    `const mockConnCache = createMockConnCacheProfile();\n      Config.getConnCacheProfile.mockReturnValue(mockConnCache);`
  );
  
  // Replace mockConn references with mockConnCache.conn
  content = content.replace(/\bmockConn\.(host|parameters)\b/g, 'mockConnCache.conn.$1');
  
  // Replace mockCacheProfile references with mockConnCache.cacheProfile
  content = content.replace(/\bmockCacheProfile\./g, 'mockConnCache.cacheProfile.');
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✓ Fixed ${file}`);
});

console.log('\nDone! All service test files have been updated.');
