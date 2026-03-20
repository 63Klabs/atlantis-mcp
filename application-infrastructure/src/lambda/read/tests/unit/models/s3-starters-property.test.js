/**
 * Property-Based Tests for S3 Starters - parseSidecarMetadata()
 *
 * Tests correctness properties of the consumer's sidecar metadata parsing:
 * - Property 8: Consumer parsing preserves categorized structure
 * - Property 9: Consumer normalizes input casing to camelCase output
 * - Property 3 (consumer side): Output structure invariant
 * - Property 4 (consumer side): All output keys are camelCase
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

const fc = require('fast-check');

// Mock @63klabs/cache-data
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    AWS: {
      s3: {
        client: {
          send: jest.fn()
        }
      }
    }
  }
}));

const S3Starters = require('../../../models/s3-starters');

describe('S3 Starters - Property Tests', () => {

  // Feature: update-generate-sidecar-metadata-script.py, Property 8: Consumer parsing preserves categorized structure
  describe('Property 8: Consumer parsing preserves categorized structure', () => {
    /**
     * **Validates: Requirements 8.1**
     *
     * For any valid sidecar JSON containing languages, frameworks, and features
     * as categorized structure objects, parseSidecarMetadata should return those
     * same categorized structures with identical buildDeploy, applicationStack,
     * and postDeploy arrays.
     */
    test('parseSidecarMetadata preserves categorized structures for any generated input', () => {
      const stringArrayArb = fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 });

      const categorizedArb = fc.record({
        buildDeploy: stringArrayArb,
        applicationStack: stringArrayArb,
        postDeploy: stringArrayArb
      });

      fc.assert(
        fc.property(
          categorizedArb,
          categorizedArb,
          categorizedArb,
          (languages, frameworks, features) => {
            const input = {
              name: 'test-starter',
              languages,
              frameworks,
              features
            };

            const result = S3Starters.parseSidecarMetadata(JSON.stringify(input));

            expect(result.languages.buildDeploy).toEqual(languages.buildDeploy);
            expect(result.languages.applicationStack).toEqual(languages.applicationStack);
            expect(result.languages.postDeploy).toEqual(languages.postDeploy);

            expect(result.frameworks.buildDeploy).toEqual(frameworks.buildDeploy);
            expect(result.frameworks.applicationStack).toEqual(frameworks.applicationStack);
            expect(result.frameworks.postDeploy).toEqual(frameworks.postDeploy);

            expect(result.features.buildDeploy).toEqual(features.buildDeploy);
            expect(result.features.applicationStack).toEqual(features.applicationStack);
            expect(result.features.postDeploy).toEqual(features.postDeploy);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: update-generate-sidecar-metadata-script.py, Property 9: Consumer normalizes input casing to camelCase output
  describe('Property 9: Consumer normalizes input casing to camelCase output', () => {
    /**
     * **Validates: Requirements 8.2, 8.3**
     *
     * For any sidecar JSON where each dual-name field randomly uses snake_case
     * or camelCase key, parseSidecarMetadata should always output the camelCase
     * variant with the correct value.
     */
    test('parseSidecarMetadata always outputs camelCase keys regardless of input casing', () => {
      const dualFieldArb = fc.record({
        useSnakeDeploymentPlatform: fc.boolean(),
        deploymentPlatformValue: fc.string({ minLength: 1, maxLength: 20 }),
        useSnakeRepositoryType: fc.boolean(),
        repositoryTypeValue: fc.string({ minLength: 1, maxLength: 20 }),
        useSnakeLastUpdated: fc.boolean(),
        lastUpdatedValue: fc.string({ minLength: 1, maxLength: 30 }),
        useSnakeDevDependencies: fc.boolean(),
        devDependenciesValue: fc.array(fc.string({ minLength: 1, maxLength: 15 }), { minLength: 0, maxLength: 5 }),
        useSnakeHasCacheData: fc.boolean(),
        hasCacheDataValue: fc.boolean(),
        useSnakeRepository: fc.boolean(),
        repositoryValue: fc.string({ minLength: 1, maxLength: 50 })
      });

      fc.assert(
        fc.property(dualFieldArb, (fields) => {
          const input = { name: 'test-starter' };

          // deployment_platform / deploymentPlatform
          if (fields.useSnakeDeploymentPlatform) {
            input.deployment_platform = fields.deploymentPlatformValue;
          } else {
            input.deploymentPlatform = fields.deploymentPlatformValue;
          }

          // repository_type / repositoryType
          if (fields.useSnakeRepositoryType) {
            input.repository_type = fields.repositoryTypeValue;
          } else {
            input.repositoryType = fields.repositoryTypeValue;
          }

          // last_updated / lastUpdated
          if (fields.useSnakeLastUpdated) {
            input.last_updated = fields.lastUpdatedValue;
          } else {
            input.lastUpdated = fields.lastUpdatedValue;
          }

          // dev_dependencies / devDependencies
          if (fields.useSnakeDevDependencies) {
            input.dev_dependencies = fields.devDependenciesValue;
          } else {
            input.devDependencies = fields.devDependenciesValue;
          }

          // has_cache_data / hasCacheData
          if (fields.useSnakeHasCacheData) {
            input.has_cache_data = fields.hasCacheDataValue;
          } else {
            input.hasCacheData = fields.hasCacheDataValue;
          }

          // github_url / repository
          if (fields.useSnakeRepository) {
            input.github_url = fields.repositoryValue;
          } else {
            input.repository = fields.repositoryValue;
          }

          const result = S3Starters.parseSidecarMetadata(JSON.stringify(input));

          // Output must always use camelCase keys with correct values
          expect(result.deploymentPlatform).toBe(fields.deploymentPlatformValue);
          expect(result.repositoryType).toBe(fields.repositoryTypeValue);
          expect(result.lastUpdated).toBe(fields.lastUpdatedValue);
          expect(result.devDependencies).toEqual(fields.devDependenciesValue);
          expect(result.hasCacheData).toBe(fields.hasCacheDataValue);
          expect(result.repository).toBe(fields.repositoryValue);

          // Verify no snake_case keys exist in output
          expect(result).not.toHaveProperty('deployment_platform');
          expect(result).not.toHaveProperty('repository_type');
          expect(result).not.toHaveProperty('last_updated');
          expect(result).not.toHaveProperty('dev_dependencies');
          expect(result).not.toHaveProperty('has_cache_data');
          expect(result).not.toHaveProperty('github_url');
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: update-generate-sidecar-metadata-script.py, Property 3: Output structure invariant
  describe('Property 3: Output structure invariant', () => {
    /**
     * **Validates: Requirements 2.1, 2.2, 2.3**
     *
     * For any input to parseSidecarMetadata (valid or partial sidecar JSON),
     * the output must have languages, frameworks, and features as objects each
     * containing exactly the keys buildDeploy, applicationStack, and postDeploy
     * (each an array), and topics as a flat array.
     */
    test('parseSidecarMetadata always returns correct structure regardless of input completeness', () => {
      // Generate partial sidecar JSON: some fields present, some missing
      const partialSidecarArb = fc.record({
        name: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
        description: fc.option(fc.string({ minLength: 0, maxLength: 50 }), { nil: undefined }),
        languages: fc.option(
          fc.oneof(
            fc.record({
              buildDeploy: fc.array(fc.string(), { maxLength: 3 }),
              applicationStack: fc.array(fc.string(), { maxLength: 3 }),
              postDeploy: fc.array(fc.string(), { maxLength: 3 })
            }),
            fc.constant(undefined)
          ),
          { nil: undefined }
        ),
        frameworks: fc.option(
          fc.oneof(
            fc.record({
              buildDeploy: fc.array(fc.string(), { maxLength: 3 }),
              applicationStack: fc.array(fc.string(), { maxLength: 3 }),
              postDeploy: fc.array(fc.string(), { maxLength: 3 })
            }),
            fc.constant(undefined)
          ),
          { nil: undefined }
        ),
        features: fc.option(
          fc.oneof(
            fc.record({
              buildDeploy: fc.array(fc.string(), { maxLength: 3 }),
              applicationStack: fc.array(fc.string(), { maxLength: 3 }),
              postDeploy: fc.array(fc.string(), { maxLength: 3 })
            }),
            fc.constant(undefined)
          ),
          { nil: undefined }
        ),
        topics: fc.option(fc.array(fc.string(), { maxLength: 5 }), { nil: undefined }),
        deploymentPlatform: fc.option(fc.string(), { nil: undefined })
      }).map(obj => {
        // Remove undefined keys to simulate partial JSON
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
          if (value !== undefined) {
            cleaned[key] = value;
          }
        }
        return cleaned;
      });

      fc.assert(
        fc.property(partialSidecarArb, (input) => {
          const result = S3Starters.parseSidecarMetadata(JSON.stringify(input));

          // languages must be a categorized structure
          expect(result.languages).toBeDefined();
          expect(Array.isArray(result.languages.buildDeploy)).toBe(true);
          expect(Array.isArray(result.languages.applicationStack)).toBe(true);
          expect(Array.isArray(result.languages.postDeploy)).toBe(true);

          // frameworks must be a categorized structure
          expect(result.frameworks).toBeDefined();
          expect(Array.isArray(result.frameworks.buildDeploy)).toBe(true);
          expect(Array.isArray(result.frameworks.applicationStack)).toBe(true);
          expect(Array.isArray(result.frameworks.postDeploy)).toBe(true);

          // features must be a categorized structure
          expect(result.features).toBeDefined();
          expect(Array.isArray(result.features.buildDeploy)).toBe(true);
          expect(Array.isArray(result.features.applicationStack)).toBe(true);
          expect(Array.isArray(result.features.postDeploy)).toBe(true);

          // topics must be a flat array
          expect(Array.isArray(result.topics)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });
  });

  // Feature: update-generate-sidecar-metadata-script.py, Property 4: All output keys are camelCase
  describe('Property 4: All output keys are camelCase', () => {
    /**
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
     *
     * For any sidecar JSON with mixed casing (randomly using snake_case or
     * camelCase for dual-name fields), every top-level key in the output
     * matches the camelCase pattern (lowercase first letter, no underscores).
     */
    test('parseSidecarMetadata output keys are always camelCase regardless of input casing', () => {
      const camelCasePattern = /^[a-z][a-zA-Z0-9]*$/;

      const mixedCasingSidecarArb = fc.record({
        useSnakeDeploymentPlatform: fc.boolean(),
        useSnakeRepositoryType: fc.boolean(),
        useSnakeLastUpdated: fc.boolean(),
        useSnakeDevDependencies: fc.boolean(),
        useSnakeHasCacheData: fc.boolean(),
        useSnakeRepository: fc.boolean()
      }).map(flags => {
        const input = { name: 'test-starter' };

        if (flags.useSnakeDeploymentPlatform) {
          input.deployment_platform = 'atlantis';
        } else {
          input.deploymentPlatform = 'atlantis';
        }

        if (flags.useSnakeRepositoryType) {
          input.repository_type = 'app-starter';
        } else {
          input.repositoryType = 'app-starter';
        }

        if (flags.useSnakeLastUpdated) {
          input.last_updated = '2024-01-01';
        } else {
          input.lastUpdated = '2024-01-01';
        }

        if (flags.useSnakeDevDependencies) {
          input.dev_dependencies = ['jest'];
        } else {
          input.devDependencies = ['jest'];
        }

        if (flags.useSnakeHasCacheData) {
          input.has_cache_data = true;
        } else {
          input.hasCacheData = true;
        }

        if (flags.useSnakeRepository) {
          input.github_url = 'https://github.com/test/repo';
        } else {
          input.repository = 'https://github.com/test/repo';
        }

        return input;
      });

      fc.assert(
        fc.property(mixedCasingSidecarArb, (input) => {
          const result = S3Starters.parseSidecarMetadata(JSON.stringify(input));

          const topLevelKeys = Object.keys(result);
          for (const key of topLevelKeys) {
            expect(key).toMatch(camelCasePattern);
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
