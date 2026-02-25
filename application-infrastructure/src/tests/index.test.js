const { tools } = require('@63klabs/cache-data');
const path = require('path');
const { readFileSync } = require('fs');

console.log(`Testing Against Node version ${tools.nodeVerMajor} (${tools.nodeVer})`);
if (tools.nodeVerMajor < 22) {
  console.log('Node version is too low, skipping tests');
  process.exit(0);
}

console.log(`Node ${tools.AWS.NODE_VER} MAJOR ${tools.AWS.NODE_VER_MAJOR} MINOR ${tools.AWS.NODE_VER_MINOR} PATCH ${tools.AWS.NODE_VER_PATCH} MAJOR MINOR ${tools.AWS.NODE_VER_MAJOR_MINOR} SDK ${tools.AWS.SDK_VER} REGION ${tools.AWS.REGION} V2 ${tools.AWS.SDK_V2} V3 ${tools.AWS.SDK_V3}`, tools.AWS.nodeVersionArray);
console.log('tools.AWS.INFO', tools.AWS.INFO);

/* ****************************************************************************
 * Basic Tests
 * 
 * Note: This file previously tested deleted modules (config/validations.js,
 * utils/index.js, views/example.view.js). Those tests have been removed
 * as the code has been reorganized into the lambda/read/ structure.
 * 
 * New tests for the reorganized code are in the unit/ and integration/ directories.
 */

describe('Basic Environment Tests', () => {
  test('should have required Node.js version', () => {
    expect(tools.nodeVerMajor).toBeGreaterThanOrEqual(22);
  });

  test('should have AWS SDK information', () => {
    expect(tools.AWS).toBeDefined();
    expect(tools.AWS.SDK_VER).toBeDefined();
    expect(tools.AWS.REGION).toBeDefined();
  });

  test('should have correct AWS SDK version', () => {
    expect(tools.AWS.SDK_V3).toBe(true);
  });
});
