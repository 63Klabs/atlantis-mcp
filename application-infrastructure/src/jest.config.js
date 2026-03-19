module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/lambda/read/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/performance/'
  ],
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/lambda/read/tests/**'
  ],
  moduleDirectories: ['node_modules', 'lambda/read/node_modules']
};
