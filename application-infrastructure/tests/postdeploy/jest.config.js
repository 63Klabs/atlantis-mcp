const path = require('path');

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.property.test.js', '**/*.test.js'],
  rootDir: '.',
  modulePaths: [path.resolve(__dirname, '../../src/node_modules')]
};
