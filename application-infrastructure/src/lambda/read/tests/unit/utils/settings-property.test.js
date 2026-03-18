/**
 * Property-Based Tests for Settings Environment Variable Overrides
 *
 * Feature: 0-0-1-api-response-headers-return-NaN
 * Property 10: Environment variable overrides take effect in settings
 *
 * For any valid numeric string set as rate limit env vars,
 * settings.rateLimits reflects the parsed integer value.
 */

const fc = require('fast-check');

describe('Property 10: Environment variable overrides take effect in settings', () => {

  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('public rate limit env vars override defaults', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 1440 }),
        (limit, window) => {
          process.env.MCP_PUBLIC_RATE_LIMIT = String(limit);
          process.env.MCP_PUBLIC_RATE_TIME_RANGE_MINUTES = String(window);
          // Suppress DebugAndLog warnings during module load
          process.env.ATLANTIS_S3_BUCKETS = 'test-bucket';
          process.env.ATLANTIS_GITHUB_USER_ORGS = 'test-org';
          process.env.PARAM_STORE_PATH = '/test/';

          jest.resetModules();
          const settings = require('../../../config/settings');

          return (
            settings.rateLimits.public.limitPerWindow === limit &&
            settings.rateLimits.public.windowInMinutes === window
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('registered rate limit env vars override defaults', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 1440 }),
        (limit, window) => {
          process.env.MCP_REGISTERED_RATE_LIMIT = String(limit);
          process.env.MCP_REGISTERED_RATE_TIME_RANGE_MINUTES = String(window);
          process.env.ATLANTIS_S3_BUCKETS = 'test-bucket';
          process.env.ATLANTIS_GITHUB_USER_ORGS = 'test-org';
          process.env.PARAM_STORE_PATH = '/test/';

          jest.resetModules();
          const settings = require('../../../config/settings');

          return (
            settings.rateLimits.registered.limitPerWindow === limit &&
            settings.rateLimits.registered.windowInMinutes === window
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('paid and private rate limit env vars override defaults', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 1440 }),
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 1440 }),
        (paidLimit, paidWindow, privateLimit, privateWindow) => {
          process.env.MCP_PAID_RATE_LIMIT = String(paidLimit);
          process.env.MCP_PAID_RATE_TIME_RANGE_MINUTES = String(paidWindow);
          process.env.MCP_PRIVATE_RATE_LIMIT = String(privateLimit);
          process.env.MCP_PRIVATE_RATE_TIME_RANGE_MINUTES = String(privateWindow);
          process.env.ATLANTIS_S3_BUCKETS = 'test-bucket';
          process.env.ATLANTIS_GITHUB_USER_ORGS = 'test-org';
          process.env.PARAM_STORE_PATH = '/test/';

          jest.resetModules();
          const settings = require('../../../config/settings');

          return (
            settings.rateLimits.paid.limitPerWindow === paidLimit &&
            settings.rateLimits.paid.windowInMinutes === paidWindow &&
            settings.rateLimits.private.limitPerWindow === privateLimit &&
            settings.rateLimits.private.windowInMinutes === privateWindow
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('dynamoDbSessionsTable reads from env var', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9][a-z0-9-]{2,50}$/),
        (tableName) => {
          process.env.MCP_DYNAMODB_SESSIONS_TABLE = tableName;
          process.env.ATLANTIS_S3_BUCKETS = 'test-bucket';
          process.env.ATLANTIS_GITHUB_USER_ORGS = 'test-org';
          process.env.PARAM_STORE_PATH = '/test/';

          jest.resetModules();
          const settings = require('../../../config/settings');

          return settings.dynamoDbSessionsTable === tableName;
        }
      ),
      { numRuns: 100 }
    );
  });
});
