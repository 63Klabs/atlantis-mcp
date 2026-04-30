module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/lambda/read/tests/**/*.test.js',
    '**/lambda/indexer/tests/**/*.test.js',
    '**/lambda/auth/tests/**/*.test.js',
    '**/lambda/cleanup/tests/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/performance/'
  ],
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/lambda/read/tests/**'
  ],
  moduleDirectories: ['node_modules', 'lambda/read/node_modules', 'lambda/indexer/node_modules', 'lambda/auth/node_modules', 'lambda/cleanup/node_modules']
};
