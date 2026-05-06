module.exports = {
  testEnvironment: 'node',
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
  collectCoverageFrom: [
    '**/*.js',
    '!**/node_modules/**',
    '!**/lambda/read/tests/**'
  ],
  moduleDirectories: ['node_modules', 'lambda/read/node_modules', 'lambda/indexer/node_modules', 'lambda/auth/node_modules', 'lambda/cleanup/node_modules'],
  projects: [
    {
      displayName: 'lambda',
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
      moduleDirectories: ['node_modules', 'lambda/read/node_modules', 'lambda/indexer/node_modules', 'lambda/auth/node_modules', 'lambda/cleanup/node_modules']
    },
    {
      displayName: 'static',
      testEnvironment: 'jsdom',
      testMatch: [
        '**/test/static/**/*.jest.mjs'
      ],
      testPathIgnorePatterns: [
        '/node_modules/'
      ]
    }
  ]
};
