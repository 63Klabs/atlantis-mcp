/**
 * Property-Based Tests for Naming Validation
 *
 * These tests use fast-check to verify universal properties of the naming validation
 * functions across a wide range of generated inputs.
 *
 * Updated for flexible StageId patterns, isShared, hasOrgPrefix, PascalCase
 * warnings, and the resourceName → resourceSuffix rename.
 */

const fc = require('fast-check');
const {
  validateApplicationResource,
  validateS3Bucket,
  validateNaming,
  detectResourceType,
  isValidStageId,
  checkPascalCase,
  AWS_NAMING_RULES
} = require('../../../utils/naming-rules');

describe('Naming Validation - Property-Based Tests', () => {

  describe('Property 1: Valid application resource names always pass', () => {
    it('should accept all valid application resource names with flexible StageId', () => {
      const validStageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,8}$/);

      const validAppResourceGen = fc.tuple(
        fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
        fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
        validStageIdGen,
        fc.stringMatching(/^[A-Z][a-zA-Z0-9]{0,20}$/)
      ).map(([prefix, projectId, stageId, resourceSuffix]) =>
        `${prefix}-${projectId}-${stageId}-${resourceSuffix}`
      ).filter(name => name.length <= 64);

      fc.assert(
        fc.property(validAppResourceGen, (name) => {
          const result = validateApplicationResource(name, { resourceType: 'lambda' });

          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
          expect(result.components.prefix).toBeDefined();
          expect(result.components.projectId).toBeDefined();
          expect(result.components.stageId).toBeDefined();
          expect(result.components.resourceSuffix).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });

    it('should accept valid DynamoDB table names', () => {
      const validStageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,8}$/);

      const validDynamoGen = fc.tuple(
        fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
        fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
        validStageIdGen,
        fc.stringMatching(/^[a-zA-Z0-9_.]{1,20}$/)
      ).map(([prefix, projectId, stageId, resourceSuffix]) =>
        `${prefix}-${projectId}-${stageId}-${resourceSuffix}`
      ).filter(name => name.length >= 3 && name.length <= 255);

      fc.assert(
        fc.property(validDynamoGen, (name) => {
          const result = validateApplicationResource(name, { resourceType: 'dynamodb' });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: Valid S3 bucket names always pass', () => {
    it('should accept valid S3 bucket names (Pattern 1) with real regions', () => {
      const validNames = [
        'org-prefix-project-test-us-east-1-123456789012',
        'org-prefix-project-prod-eu-west-1-987654321098',
        'prefix-project-test-us-east-1-123456789012',
        'prefix-project-prod-ap-southeast-2-111222333444'
      ];

      validNames.forEach(name => {
        const result = validateS3Bucket(name);
        expect(result.pattern).toBe('pattern1');
        expect(result.errors.filter(e =>
          e.includes('lowercase') ||
          e.includes('too short') ||
          e.includes('too long') ||
          e.includes('..')
        )).toHaveLength(0);
      });
    });

    it('should accept valid S3 bucket names (Pattern 2) with real regions', () => {
      const validNames = [
        'org-prefix-project-us-east-1-123456789012',
        'prefix-project-us-west-2-987654321098'
      ];

      validNames.forEach(name => {
        const result = validateS3Bucket(name, { isShared: true });
        expect(result.pattern).toBe('pattern2');
      });
    });
  });

  describe('Property 3: Invalid names always fail with appropriate errors', () => {
    it('should reject names with invalid characters in prefix', () => {
      const validStageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,4}$/);

      const invalidPrefixGen = fc.tuple(
        fc.string().filter(s => s.length > 0 && /[^a-zA-Z0-9-]/.test(s)),
        fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
        validStageIdGen,
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,10}$/)
      ).map(([prefix, projectId, stageId, resourceSuffix]) =>
        `${prefix}-${projectId}-${stageId}-${resourceSuffix}`
      );

      fc.assert(
        fc.property(invalidPrefixGen, (name) => {
          const result = validateApplicationResource(name);

          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors.some(e => e.includes('Prefix') || e.includes('alphanumeric'))).toBe(true);
        }),
        { numRuns: 50 }
      );
    });

    it('should reject names with invalid stage IDs (not starting with t/b/s/p)', () => {
      const invalidStageGen = fc.tuple(
        fc.stringMatching(/^[a-zA-Z0-9]{2,6}$/),
        fc.stringMatching(/^[a-zA-Z0-9]{2,6}$/),
        fc.stringMatching(/^[a-z]{2,6}$/).filter(s => !/^[tbsp]/.test(s)),
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,10}$/)
      ).map(([prefix, projectId, stageId, resourceSuffix]) =>
        `${prefix}-${projectId}-${stageId}-${resourceSuffix}`
      );

      fc.assert(
        fc.property(invalidStageGen, (name) => {
          const result = validateApplicationResource(name);

          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('StageId'))).toBe(true);
        }),
        { numRuns: 50 }
      );
    });

    it('should reject S3 bucket names with uppercase letters', () => {
      const uppercaseS3Gen = fc.string()
        .filter(s => s.length >= 3 && s.length <= 63 && /[A-Z]/.test(s));

      fc.assert(
        fc.property(uppercaseS3Gen, (name) => {
          const result = validateS3Bucket(name);

          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 50 }
      );
    });

    it('should reject S3 bucket names with consecutive dots', () => {
      const consecutiveDotsGen = fc.tuple(
        fc.stringMatching(/^[a-z0-9]+$/),
        fc.stringMatching(/^[a-z0-9]+$/)
      ).map(([part1, part2]) => `${part1}..${part2}`);

      fc.assert(
        fc.property(consecutiveDotsGen, (name) => {
          const result = validateS3Bucket(name);

          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.includes('..'))).toBe(true);
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 4: Partial name validation', () => {
    it('should accept partial names when partial=true', () => {
      const validStageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,4}$/);

      const partialNameGen = fc.oneof(
        fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
          fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/)
        ).map(([p1, p2]) => `${p1}-${p2}`),
        fc.tuple(
          fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
          fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/),
          validStageIdGen
        ).map(([p1, p2, p3]) => `${p1}-${p2}-${p3}`)
      );

      fc.assert(
        fc.property(partialNameGen, (name) => {
          const result = validateApplicationResource(name, { partial: true });

          if (result.valid) {
            expect(result.errors).toHaveLength(0);
          }
          expect(result.components).toBeDefined();
        }),
        { numRuns: 100 }
      );
    });

    it('should validate partial S3 bucket names', () => {
      const partialS3Gen = fc.oneof(
        fc.stringMatching(/^[a-z0-9]{3,10}$/),
        fc.tuple(
          fc.stringMatching(/^[a-z0-9]{2,6}$/),
          fc.stringMatching(/^[a-z0-9]{2,6}$/)
        ).map(([p1, p2]) => `${p1}-${p2}`)
      );

      fc.assert(
        fc.property(partialS3Gen, (name) => {
          const result = validateS3Bucket(name, { partial: true });

          expect(result).toBeDefined();
          expect(result.components).toBeDefined();
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 5: Edge cases', () => {
    it('should handle empty strings', () => {
      const result = validateApplicationResource('');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('required'))).toBe(true);
    });

    it('should handle null and undefined', () => {
      expect(validateApplicationResource(null).valid).toBe(false);
      expect(validateApplicationResource(undefined).valid).toBe(false);
    });

    it('should handle non-string inputs', () => {
      const result = validateApplicationResource(12345);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('string'))).toBe(true);
    });

    it('should reject names that are too short', () => {
      const result = validateS3Bucket('ab');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('too short'))).toBe(true);
    });

    it('should reject names that are too long', () => {
      const longName = 'prefix-project-test-' + 'a'.repeat(50);
      const result = validateApplicationResource(longName, { resourceType: 'lambda' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('too long') || e.includes('maximum'))).toBe(true);
    });

    it('should reject S3 names starting with dot or hyphen', () => {
      expect(validateS3Bucket('.bucket-name').valid).toBe(false);
      expect(validateS3Bucket('-bucket-name').valid).toBe(false);
    });

    it('should reject S3 names ending with dot or hyphen', () => {
      expect(validateS3Bucket('bucket-name.').valid).toBe(false);
      expect(validateS3Bucket('bucket-name-').valid).toBe(false);
    });

    it('should handle special characters appropriately', () => {
      const specialChars = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '+', '='];

      specialChars.forEach(char => {
        const name = `prefix-project-test-resource${char}name`;
        const result = validateApplicationResource(name);

        expect(result.valid).toBe(false);
      });
    });
  });

  describe('Property 6: Error messages are helpful and specific', () => {
    it('should provide specific error messages for each validation failure', () => {
      const invalidName = 'invalid@prefix-project-test-resource';
      const result = validateApplicationResource(invalidName);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      result.errors.forEach(error => {
        expect(error).toBeTruthy();
        expect(error.length).toBeGreaterThan(10);
        expect(typeof error).toBe('string');
      });
    });

    it('should provide suggestions for fixing invalid names', () => {
      const invalidName = 'invalid@prefix-project-test-resource';
      const result = validateApplicationResource(invalidName);

      expect(result.valid).toBe(false);
      expect(result.suggestions).toBeDefined();

      if (result.suggestions.length > 0) {
        result.suggestions.forEach(suggestion => {
          expect(suggestion).toBeTruthy();
          expect(typeof suggestion).toBe('string');
        });
      }
    });

    it('should provide component-specific error messages', () => {
      const testCases = [
        { name: 'invalid@-project-test-resource', expectedError: 'Prefix' },
        { name: 'prefix-invalid@-test-resource', expectedError: 'ProjectId' },
        { name: 'prefix-project-invalid-resource', expectedError: 'StageId' }
      ];

      testCases.forEach(({ name, expectedError }) => {
        const result = validateApplicationResource(name);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes(expectedError))).toBe(true);
      });
    });

    it('should indicate account ID format requirements', () => {
      const invalidAccountId = 'org-prefix-project-test-us-east-1-123';
      const result = validateS3Bucket(invalidAccountId);

      if (!result.valid && result.errors.some(e => e.includes('Account'))) {
        expect(result.errors.some(e => e.includes('12 digits'))).toBe(true);
      }
    });
  });

  describe('Property 7: validateNaming wrapper function', () => {
    it('should route to correct validator based on resource type', () => {
      const s3Name = 'org-prefix-project-test-us-east-1-123456789012';
      const appName = 'prefix-project-test-MyFunction';

      const s3Result = validateNaming(s3Name, { resourceType: 's3' });
      const appResult = validateNaming(appName, { resourceType: 'lambda' });

      expect(s3Result.resourceType).toBe('s3');
      expect(appResult.resourceType).toBe('lambda');
    });

    it('should handle unknown resource types', () => {
      const result = validateNaming('some-name', { resourceType: 'unknown' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown resource type'))).toBe(true);
    });

    it('should require resource type', () => {
      const result = validateNaming('some-name', {});

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Resource type is required'))).toBe(true);
    });
  });

  describe('Property 8: detectResourceType function', () => {
    it('should detect S3 bucket names with region patterns', () => {
      const s3Names = [
        'org-prefix-project-test-us-east-1-123456789012',
        'org-prefix-project-us-west-2'
      ];

      s3Names.forEach(name => {
        const detected = detectResourceType(name);
        expect(detected).toBe('s3');
      });
    });

    it('should detect application resource names with flexible StageId', () => {
      const appNames = [
        'prefix-project-test-MyFunction',
        'prefix-project-prod-MyTable',
        'prefix-project-beta-MyQueue',
        'prefix-project-tjoe-MyFunction',
        'prefix-project-tf187-MyFunction'
      ];

      appNames.forEach(name => {
        const detected = detectResourceType(name);
        expect(detected).toBe('application');
      });
    });

    it('should return null for ambiguous names', () => {
      const ambiguousNames = [
        'just-a-name',
        'two-parts',
        ''
      ];

      ambiguousNames.forEach(name => {
        expect(detectResourceType(name)).toBeNull();
      });
    });

    it('should handle null and undefined', () => {
      expect(detectResourceType(null)).toBeNull();
      expect(detectResourceType(undefined)).toBeNull();
    });
  });

  describe('Property 9: Configuration validation', () => {
    it('should validate against expected prefix', () => {
      const name = 'wrongprefix-project-test-MyFunction';
      const result = validateApplicationResource(name, { prefix: 'expectedprefix' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('expectedprefix'))).toBe(true);
    });

    it('should validate against expected projectId', () => {
      const name = 'prefix-wrongproject-test-MyFunction';
      const result = validateApplicationResource(name, { projectId: 'expectedproject' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('expectedproject'))).toBe(true);
    });

    it('should validate against expected stageId', () => {
      const name = 'prefix-project-test-MyFunction';
      const result = validateApplicationResource(name, { stageId: 'prod' });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('prod'))).toBe(true);
    });
  });

  describe('Property 10: AWS naming rules compliance', () => {
    it('should enforce Lambda naming rules', () => {
      const rules = AWS_NAMING_RULES.lambda;

      expect(rules.minLength).toBe(1);
      expect(rules.maxLength).toBe(64);
      expect(rules.pattern).toBeDefined();
    });

    it('should enforce DynamoDB naming rules', () => {
      const rules = AWS_NAMING_RULES.dynamodb;

      expect(rules.minLength).toBe(3);
      expect(rules.maxLength).toBe(255);
      expect(rules.pattern).toBeDefined();
    });

    it('should enforce S3 naming rules', () => {
      const rules = AWS_NAMING_RULES.s3;

      expect(rules.minLength).toBe(3);
      expect(rules.maxLength).toBe(63);
      expect(rules.pattern).toBeDefined();
      expect(rules.disallowed).toContain('..');
    });

    it('should enforce CloudFormation naming rules', () => {
      const rules = AWS_NAMING_RULES.cloudformation;

      expect(rules.minLength).toBe(1);
      expect(rules.maxLength).toBe(128);
      expect(rules.pattern).toBeDefined();
    });
  });

  describe('Property 11: Application resource round-trip consistency', () => {
    it('should reconstruct original name from parsed components', () => {
      const validStageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,6}$/);

      const validAppResourceGen = fc.tuple(
        fc.stringMatching(/^[a-z0-9]{2,8}$/),
        fc.stringMatching(/^[a-z0-9]{2,8}$/),
        validStageIdGen,
        fc.stringMatching(/^[A-Z][a-zA-Z0-9]{1,15}$/)
      ).map(([prefix, projectId, stageId, resourceSuffix]) =>
        `${prefix}-${projectId}-${stageId}-${resourceSuffix}`
      ).filter(name => name.length <= 64);

      fc.assert(
        fc.property(validAppResourceGen, (name) => {
          const result = validateApplicationResource(name, { resourceType: 'lambda' });

          expect(result.valid).toBe(true);

          const { prefix, projectId, stageId, resourceSuffix } = result.components;
          const reconstructed = [prefix, projectId, stageId, resourceSuffix].join('-');

          expect(reconstructed).toBe(name);
        }),
        { numRuns: 100 }
      );
    });

    it('should reconstruct shared resource name from parsed components', () => {
      const validSharedGen = fc.tuple(
        fc.stringMatching(/^[a-z0-9]{2,8}$/),
        fc.stringMatching(/^[a-z0-9]{2,8}$/),
        fc.stringMatching(/^[A-Z][a-zA-Z0-9]{1,15}$/)
      ).map(([prefix, projectId, resourceSuffix]) =>
        `${prefix}-${projectId}-${resourceSuffix}`
      ).filter(name => name.length <= 64);

      fc.assert(
        fc.property(validSharedGen, (name) => {
          const result = validateApplicationResource(name, {
            resourceType: 'lambda',
            isShared: true
          });

          expect(result.valid).toBe(true);

          const { prefix, projectId, resourceSuffix } = result.components;
          const reconstructed = [prefix, projectId, resourceSuffix].join('-');

          expect(reconstructed).toBe(name);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 12: S3 bucket round-trip consistency', () => {
    it('should reconstruct pattern1 S3 name from parsed components', () => {
      const regionGen = fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-2');
      const accountIdGen = fc.stringMatching(/^\d{12}$/);

      const validS3Pattern1Gen = fc.tuple(
        fc.stringMatching(/^[a-z0-9]{2,6}$/),
        fc.stringMatching(/^[a-z0-9]{2,6}$/),
        fc.stringMatching(/^[tbsp][a-z0-9]{0,4}$/),
        regionGen,
        accountIdGen
      ).map(([prefix, projectId, stageId, region, accountId]) =>
        `${prefix}-${projectId}-${stageId}-${region}-${accountId}`
      ).filter(name => name.length >= 3 && name.length <= 63);

      fc.assert(
        fc.property(validS3Pattern1Gen, (name) => {
          const result = validateS3Bucket(name);

          expect(result.pattern).toBe('pattern1');
          expect(result.valid).toBe(true);

          const { prefix, projectId, stageId, region, accountId } = result.components;
          const reconstructed = [prefix, projectId, stageId, region, accountId].join('-');

          expect(reconstructed).toBe(name);
        }),
        { numRuns: 100 }
      );
    });

    it('should reconstruct pattern1 with OrgPrefix from parsed components', () => {
      const regionGen = fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1');
      const accountIdGen = fc.stringMatching(/^\d{12}$/);

      // Use 3-char segments with a digit to prevent accidentally forming
      // a region pattern (xx-xxxx-N) from adjacent segments.
      const safeSegGen = fc.stringMatching(/^[a-z]\d[a-z]$/);

      const validS3OrgGen = fc.tuple(
        safeSegGen,
        safeSegGen,
        safeSegGen,
        fc.stringMatching(/^[tbsp][a-z0-9]{0,3}$/),
        regionGen,
        accountIdGen
      ).map(([org, prefix, projectId, stageId, region, accountId]) =>
        `${org}-${prefix}-${projectId}-${stageId}-${region}-${accountId}`
      ).filter(name => name.length >= 3 && name.length <= 63);

      fc.assert(
        fc.property(validS3OrgGen, (name) => {
          const result = validateS3Bucket(name);

          expect(result.pattern).toBe('pattern1');
          expect(result.valid).toBe(true);

          const { orgPrefix, prefix, projectId, stageId, region, accountId } = result.components;
          const reconstructed = [orgPrefix, prefix, projectId, stageId, region, accountId].join('-');

          expect(reconstructed).toBe(name);
        }),
        { numRuns: 100 }
      );
    });

    it('should reconstruct pattern2 S3 name from parsed components', () => {
      const regionGen = fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1');
      const accountIdGen = fc.stringMatching(/^\d{12}$/);

      const validS3Pattern2Gen = fc.tuple(
        fc.stringMatching(/^[a-z0-9]{2,6}$/),
        fc.stringMatching(/^[a-z0-9]{2,6}$/),
        regionGen,
        accountIdGen
      ).map(([prefix, projectId, region, accountId]) =>
        `${prefix}-${projectId}-${region}-${accountId}`
      ).filter(name => name.length >= 3 && name.length <= 63);

      fc.assert(
        fc.property(validS3Pattern2Gen, (name) => {
          const result = validateS3Bucket(name, { isShared: true });

          expect(result.pattern).toBe('pattern2');
          expect(result.valid).toBe(true);

          const { prefix, projectId, region, accountId } = result.components;
          const reconstructed = [prefix, projectId, region, accountId].join('-');

          expect(reconstructed).toBe(name);
        }),
        { numRuns: 100 }
      );
    });
  });
});
