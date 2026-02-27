module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/lambda/read/tests/**/*.test.js'],
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/lambda/read/tests/**'
  ],
  moduleDirectories: ['node_modules', 'lambda/read/node_modules']
};
