module.exports = {
  testEnvironment: 'node',
  setupFiles: ['./jest.setup.js'],
  testMatch: [
    '**/lambda/read/tests/**/*.test.js',
    '**/lambda/indexer/tests/**/*.test.js',
    '**/lambda/auth/tests/**/*.test.js',
    '**/lambda/cleanup/tests/**/*.test.js',
    '**/test/static/**/*.jest.mjs'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/performance/'
  ],
  // Limit workers in CI to prevent OOM on constrained build environments
  ...(process.env.CI && { maxWorkers: 2 }),
  collectCoverageFrom: [
    'lambda/read/**/*.js',
    'lambda/indexer/**/*.js',
    'lambda/auth/**/*.js',
    'lambda/cleanup/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  moduleDirectories: ['node_modules', 'lambda/read/node_modules', 'lambda/indexer/node_modules', 'lambda/auth/node_modules', 'lambda/cleanup/node_modules'],
  projects: [
    {
      displayName: 'lambda',
      testEnvironment: 'node',
      setupFiles: ['./jest.setup.js'],
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
      moduleDirectories: ['node_modules', 'lambda/read/node_modules', 'lambda/indexer/node_modules', 'lambda/auth/node_modules', 'lambda/cleanup/node_modules']
    },
    {
      displayName: 'static',
      testEnvironment: 'jsdom',
      setupFiles: ['./jest.setup.js'],
      testMatch: [
        '**/test/static/**/*.jest.mjs'
      ],
      testPathIgnorePatterns: [
        '/node_modules/'
      ]
    }
  ]
};
