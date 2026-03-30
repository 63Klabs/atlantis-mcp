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
        'org-prefix-project-test-123456789012-us-east-1-an',
        'org-prefix-project-prod-987654321098-eu-west-1-an',
        'prefix-project-test-123456789012-us-east-1-an',
        'prefix-project-prod-111222333444-ap-southeast-2-an'
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
        'org-prefix-project-123456789012-us-east-1',
        'prefix-project-987654321098-us-west-2'
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
          // May get StageId error or ambiguity error depending on segment count
          expect(result.errors.some(e =>
            e.includes('StageId') || e.includes('Cannot unambiguously parse')
          )).toBe(true);
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
        `${prefix}-${projectId}-${stageId}-${accountId}-${region}-an`
      ).filter(name => name.length >= 3 && name.length <= 63);

      fc.assert(
        fc.property(validS3Pattern1Gen, (name) => {
          const result = validateS3Bucket(name);

          expect(result.pattern).toBe('pattern1');

          const { prefix, projectId, stageId, accountId, region } = result.components;
          const reconstructed = `${prefix}-${projectId}-${stageId}-${accountId}-${region}-an`;

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
        accountIdGen,
        regionGen
      ).filter(([org, prefix, projectId, stageId, accountId, region]) => {
        const name = `${org}-${prefix}-${projectId}-${stageId}-${accountId}-${region}-an`;
        return name.length >= 3 && name.length <= 63;
      });

      fc.assert(
        fc.property(validS3OrgGen, ([org, prefix, projectId, stageId, accountId, region]) => {
          const name = `${org}-${prefix}-${projectId}-${stageId}-${accountId}-${region}-an`;

          // Provide known values for correct parsing of orgPrefix
          const result = validateS3Bucket(name, {
            orgPrefix: org,
            prefix: prefix,
            projectId: projectId
          });

          expect(result.pattern).toBe('pattern1');
          expect(result.valid).toBe(true);

          const c = result.components;
          const reconstructed = `${c.orgPrefix}-${c.prefix}-${c.projectId}-${c.stageId}-${c.accountId}-${c.region}-an`;

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
        accountIdGen,
        regionGen
      ).map(([prefix, projectId, accountId, region]) =>
        `${prefix}-${projectId}-${accountId}-${region}`
      ).filter(name => name.length >= 3 && name.length <= 63);

      fc.assert(
        fc.property(validS3Pattern2Gen, (name) => {
          const result = validateS3Bucket(name, { isShared: true });

          expect(result.pattern).toBe('pattern2');

          const { prefix, projectId, accountId, region } = result.components;
          const reconstructed = `${prefix}-${projectId}-${accountId}-${region}`;

          expect(reconstructed).toBe(name);
        }),
        { numRuns: 100 }
      );
    });
  });

  // --- New property tests for anchor-based parsing and new S3 patterns ---

  describe('Property 13: Application resource round-trip with hyphenated components', () => {
    it('should round-trip application names with hyphenated prefix and projectId using known values', () => {
      // Generate segments that may contain hyphens (multi-segment lowercase)
      const hyphenatedSegGen = fc.tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{0,4}$/),
        fc.stringMatching(/^[a-z][a-z0-9]{0,4}$/)
      ).map(([a, b]) => `${a}-${b}`);

      const singleSegGen = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);

      // Prefix: may contain hyphens
      const prefixGen = fc.oneof(singleSegGen, hyphenatedSegGen);
      // ProjectId: may contain hyphens
      const projectIdGen = fc.oneof(singleSegGen, hyphenatedSegGen);
      // StageId: single segment matching pattern
      const stageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,4}$/);
      // ResourceSuffix: PascalCase
      const resourceSuffixGen = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{1,12}$/);

      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, resourceSuffixGen,
          (prefix, projectId, stageId, resourceSuffix) => {
            const name = `${prefix}-${projectId}-${stageId}-${resourceSuffix}`;

            // Skip names that exceed Lambda length limit
            if (name.length > 64) return;

            const result = validateApplicationResource(name, { prefix, projectId });

            expect(result.valid).toBe(true);
            expect(result.components.prefix).toBe(prefix);
            expect(result.components.projectId).toBe(projectId);
            expect(result.components.stageId).toBe(stageId);
            expect(result.components.resourceSuffix).toBe(resourceSuffix);

            // Round-trip: reconstruct from components
            const { prefix: p, projectId: pi, stageId: s, resourceSuffix: rs } = result.components;
            const reconstructed = `${p}-${pi}-${s}-${rs}`;
            expect(reconstructed).toBe(name);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 14: Application resource heuristic parsing without known values', () => {
    it('should round-trip application names with single-segment components (no hyphens) without known values', () => {
      // All single-segment (no hyphens) so heuristic can parse positionally
      const prefixGen = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);
      const projectIdGen = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);
      const stageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,4}$/);
      const resourceSuffixGen = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{1,12}$/);

      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, resourceSuffixGen,
          (prefix, projectId, stageId, resourceSuffix) => {
            const name = `${prefix}-${projectId}-${stageId}-${resourceSuffix}`;

            if (name.length > 64) return;

            // Parse WITHOUT providing known values
            const result = validateApplicationResource(name);

            expect(result.valid).toBe(true);
            expect(result.components.prefix).toBe(prefix);
            expect(result.components.projectId).toBe(projectId);
            expect(result.components.stageId).toBe(stageId);
            expect(result.components.resourceSuffix).toBe(resourceSuffix);

            // Round-trip
            const { prefix: p, projectId: pi, stageId: s, resourceSuffix: rs } = result.components;
            const reconstructed = `${p}-${pi}-${s}-${rs}`;
            expect(reconstructed).toBe(name);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 15: S3 bucket round-trip with hyphenated components (all patterns)', () => {
    const regionGen = fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-2');
    const accountIdGen = fc.stringMatching(/^\d{12}$/);

    // Generators for segments that may contain hyphens
    const hyphenatedSegGen = fc.tuple(
      fc.stringMatching(/^[a-z][a-z0-9]{0,3}$/),
      fc.stringMatching(/^[a-z][a-z0-9]{0,3}$/)
    ).map(([a, b]) => `${a}-${b}`);

    const singleSegGen = fc.stringMatching(/^[a-z][a-z0-9]{0,4}$/);
    const prefixGen = fc.oneof(singleSegGen, hyphenatedSegGen);
    const projectIdGen = fc.oneof(singleSegGen, hyphenatedSegGen);
    const stageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,3}$/);

    it('should round-trip S3 Pattern 1 (regional) with hyphenated components', () => {
      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, accountIdGen, regionGen,
          (prefix, projectId, stageId, accountId, region) => {
            const name = `${prefix}-${projectId}-${stageId}-${accountId}-${region}-an`;

            if (name.length < 3 || name.length > 63) return;

            const result = validateS3Bucket(name, { prefix, projectId });

            expect(result.pattern).toBe('pattern1');
            expect(result.components.prefix).toBe(prefix);
            expect(result.components.projectId).toBe(projectId);
            expect(result.components.stageId).toBe(stageId);
            expect(result.components.accountId).toBe(accountId);
            expect(result.components.region).toBe(region);

            // Round-trip
            const c = result.components;
            const reconstructed = `${c.prefix}-${c.projectId}-${c.stageId}-${c.accountId}-${c.region}-an`;
            expect(reconstructed).toBe(name);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should round-trip S3 Pattern 2 (global with AccountId) with hyphenated components', () => {
      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, accountIdGen, regionGen,
          (prefix, projectId, stageId, accountId, region) => {
            const name = `${prefix}-${projectId}-${stageId}-${accountId}-${region}`;

            if (name.length < 3 || name.length > 63) return;

            const result = validateS3Bucket(name, { prefix, projectId });

            expect(result.pattern).toBe('pattern2');
            expect(result.components.prefix).toBe(prefix);
            expect(result.components.projectId).toBe(projectId);
            expect(result.components.stageId).toBe(stageId);
            expect(result.components.accountId).toBe(accountId);
            expect(result.components.region).toBe(region);

            // Round-trip
            const c = result.components;
            const reconstructed = `${c.prefix}-${c.projectId}-${c.stageId}-${c.accountId}-${c.region}`;
            expect(reconstructed).toBe(name);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should round-trip S3 Pattern 3 (simple) with hyphenated components', () => {
      const resourceNameGen = fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/);

      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, resourceNameGen,
          (prefix, projectId, stageId, resourceName) => {
            const name = `${prefix}-${projectId}-${stageId}-${resourceName}`;

            if (name.length < 3 || name.length > 63) return;

            const result = validateS3Bucket(name, { prefix, projectId });

            expect(result.pattern).toBe('pattern3');
            expect(result.components.prefix).toBe(prefix);
            expect(result.components.projectId).toBe(projectId);
            expect(result.components.stageId).toBe(stageId);

            // For pattern3, resourceName is returned as resourceSuffix
            // or resourceName depending on implementation
            const suffix = result.components.resourceSuffix || result.components.resourceName;
            expect(suffix).toBe(resourceName);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 16: S3 pattern detection correctness', () => {
    const regionGen = fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-2');
    const accountIdGen = fc.stringMatching(/^\d{12}$/);
    const prefixGen = fc.stringMatching(/^[a-z][a-z0-9]{1,5}$/);
    const projectIdGen = fc.stringMatching(/^[a-z][a-z0-9]{1,5}$/);
    const stageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,3}$/);

    it('should detect pattern1 for names ending with -an', () => {
      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, accountIdGen, regionGen,
          (prefix, projectId, stageId, accountId, region) => {
            const name = `${prefix}-${projectId}-${stageId}-${accountId}-${region}-an`;

            if (name.length < 3 || name.length > 63) return;

            const result = validateS3Bucket(name);
            expect(result.pattern).toBe('pattern1');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect pattern2 for names with AccountId-Region but no -an', () => {
      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, accountIdGen, regionGen,
          (prefix, projectId, stageId, accountId, region) => {
            const name = `${prefix}-${projectId}-${stageId}-${accountId}-${region}`;

            if (name.length < 3 || name.length > 63) return;

            const result = validateS3Bucket(name);
            expect(result.pattern).toBe('pattern2');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should detect pattern3 for names without AccountId or Region', () => {
      const resourceNameGen = fc.stringMatching(/^[a-z][a-z0-9]{1,6}$/);

      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, resourceNameGen,
          (prefix, projectId, stageId, resourceName) => {
            const name = `${prefix}-${projectId}-${stageId}-${resourceName}`;

            if (name.length < 3 || name.length > 63) return;

            const result = validateS3Bucket(name);
            expect(result.pattern).toBe('pattern3');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 17: detectResourceType identifies S3 bucket names', () => {
    const regionGen = fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-2');
    const accountIdGen = fc.stringMatching(/^\d{12}$/);
    const prefixGen = fc.stringMatching(/^[a-z][a-z0-9]{1,5}$/);
    const projectIdGen = fc.stringMatching(/^[a-z][a-z0-9]{1,5}$/);
    const stageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,3}$/);

    it('should identify Pattern 1 S3 names (ending with -an)', () => {
      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, accountIdGen, regionGen,
          (prefix, projectId, stageId, accountId, region) => {
            const name = `${prefix}-${projectId}-${stageId}-${accountId}-${region}-an`;

            if (name.length < 3 || name.length > 63) return;

            expect(detectResourceType(name)).toBe('s3');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should identify Pattern 2 S3 names (AccountId-Region, no -an)', () => {
      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, accountIdGen, regionGen,
          (prefix, projectId, stageId, accountId, region) => {
            const name = `${prefix}-${projectId}-${stageId}-${accountId}-${region}`;

            if (name.length < 3 || name.length > 63) return;

            expect(detectResourceType(name)).toBe('s3');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 18: detectResourceType identifies application resource names', () => {
    it('should identify application names with StageId at position 2', () => {
      const prefixGen = fc.stringMatching(/^[a-z][a-z0-9]{1,6}$/);
      const projectIdGen = fc.stringMatching(/^[a-z][a-z0-9]{1,6}$/);
      const stageIdGen = fc.stringMatching(/^[tbsp][a-z0-9]{0,4}$/);
      const resourceSuffixGen = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{1,12}$/);

      fc.assert(
        fc.property(
          prefixGen, projectIdGen, stageIdGen, resourceSuffixGen,
          (prefix, projectId, stageId, resourceSuffix) => {
            const name = `${prefix}-${projectId}-${stageId}-${resourceSuffix}`;

            expect(detectResourceType(name)).toBe('application');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
