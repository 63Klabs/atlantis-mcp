module.exports = {
  testEnvironment: 'node',
  setupFiles: ['./jest.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/performance/'],
  // Keep the buildspec layer loop green until tests are added (tasks 6.2 and 6.3).
  // Once tests exist under tests/, this flag has no effect on their execution.
  passWithNoTests: true,
  collectCoverageFrom: [
    'nodejs/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!jest.config.js',
    '!jest.setup.js',
    '!eslint.config.js'
  ]
};
