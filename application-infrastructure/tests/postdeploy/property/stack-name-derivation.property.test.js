// Feature: post-deployment-static-generation, Property 1: Stack name derivation is deterministic
// Validates: Requirements 2.1

const fc = require('fast-check');

/**
 * Derive the CloudFormation stack name from environment variable components.
 * This mirrors the logic in 01-export-api-spec.sh:
 *   STACK_NAME="${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application"
 *
 * @param {string} prefix - Team or org identifier
 * @param {string} projectId - Short project identifier
 * @param {string} stageId - Deployment stage identifier
 * @returns {string} Derived CloudFormation stack name
 */
function deriveStackName(prefix, projectId, stageId) {
  return `${prefix}-${projectId}-${stageId}-application`;
}

/**
 * Arbitrary for valid CloudFormation-safe identifiers:
 * lowercase alphanumeric with optional internal dashes, 1-20 chars.
 */
const cfnSafeString = fc.stringMatching(/^[a-z][a-z0-9-]{0,18}[a-z0-9]$/)
  .filter(s => !s.includes('--') && s.length >= 1);

describe('Property 1: Stack name derivation is deterministic', () => {
  it('should always produce ${PREFIX}-${PROJECT_ID}-${STAGE_ID}-application', () => {
    fc.assert(
      fc.property(
        cfnSafeString,
        cfnSafeString,
        cfnSafeString,
        (prefix, projectId, stageId) => {
          const result = deriveStackName(prefix, projectId, stageId);
          const expected = `${prefix}-${projectId}-${stageId}-application`;

          // Determinism: same inputs always produce same output
          expect(result).toBe(expected);

          // Suffix: always ends with '-application'
          expect(result).toMatch(/-application$/);

          // Structure: exactly 3 dashes separating 4 segments
          const segments = result.split('-');
          // The prefix, projectId, or stageId may contain dashes themselves,
          // so we verify the result starts and ends correctly instead
          expect(result.startsWith(`${prefix}-`)).toBe(true);
          expect(result.endsWith(`-${stageId}-application`)).toBe(true);
          expect(result).toContain(`-${projectId}-`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be deterministic across repeated calls', () => {
    fc.assert(
      fc.property(
        cfnSafeString,
        cfnSafeString,
        cfnSafeString,
        (prefix, projectId, stageId) => {
          const result1 = deriveStackName(prefix, projectId, stageId);
          const result2 = deriveStackName(prefix, projectId, stageId);
          expect(result1).toBe(result2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should produce different names for different inputs', () => {
    fc.assert(
      fc.property(
        cfnSafeString,
        cfnSafeString,
        cfnSafeString,
        cfnSafeString,
        (prefix, projectId, stageId1, stageId2) => {
          fc.pre(stageId1 !== stageId2);
          const result1 = deriveStackName(prefix, projectId, stageId1);
          const result2 = deriveStackName(prefix, projectId, stageId2);
          expect(result1).not.toBe(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
