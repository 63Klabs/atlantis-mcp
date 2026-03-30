/**
 * Unit Tests for Naming Rules Utility
 *
 * Tests AWS resource naming validation against Atlantis naming conventions.
 * Updated for flexible StageId patterns, isShared, hasOrgPrefix, PascalCase
 * warnings, and the resourceName → resourceSuffix rename.
 */

const {
  validateApplicationResource,
  validateS3Bucket,
  validateNaming,
  detectResourceType,
  isValidStageId,
  checkPascalCase,
  AWS_NAMING_RULES,
  STAGE_ID_PATTERN
} = require('../../../utils/naming-rules');

describe('Naming Rules Utility', () => {
  describe('AWS_NAMING_RULES', () => {
    test('should have rules for all supported resource types', () => {
      expect(AWS_NAMING_RULES).toHaveProperty('s3');
      expect(AWS_NAMING_RULES).toHaveProperty('dynamodb');
      expect(AWS_NAMING_RULES).toHaveProperty('lambda');
      expect(AWS_NAMING_RULES).toHaveProperty('cloudformation');
    });

    test('each rule should have required properties', () => {
      Object.values(AWS_NAMING_RULES).forEach(rule => {
        expect(rule).toHaveProperty('minLength');
        expect(rule).toHaveProperty('maxLength');
        expect(rule).toHaveProperty('pattern');
        expect(rule).toHaveProperty('description');
      });
    });
  });

  describe('isValidStageId()', () => {
    test('should accept classic stage IDs', () => {
      ['test', 'beta', 'stage', 'prod'].forEach(id => {
        expect(isValidStageId(id)).toBe(true);
      });
    });

    test('should accept flexible stage IDs starting with t, b, s, p', () => {
      ['tjoe', 'tf187', 'b', 'bfeat1', 'sqa', 'pprod2'].forEach(id => {
        expect(isValidStageId(id)).toBe(true);
      });
    });

    test('should reject stage IDs not starting with t, b, s, or p', () => {
      ['invalid', 'xyz', 'dev', 'main', 'release'].forEach(id => {
        expect(isValidStageId(id)).toBe(false);
      });
    });

    test('should reject stage IDs with uppercase letters', () => {
      expect(isValidStageId('Test')).toBe(false);
      expect(isValidStageId('PROD')).toBe(false);
    });

    test('should reject stage IDs with non-alphanumeric characters', () => {
      expect(isValidStageId('t-joe')).toBe(false);
      expect(isValidStageId('t_joe')).toBe(false);
      expect(isValidStageId('t.joe')).toBe(false);
    });
  });

  describe('checkPascalCase()', () => {
    test('should return no warnings for valid PascalCase', () => {
      expect(checkPascalCase('GetPersonFunction')).toEqual([]);
      expect(checkPascalCase('MyTable')).toEqual([]);
      expect(checkPascalCase('Resource')).toEqual([]);
    });

    test('should warn when suffix does not start with uppercase', () => {
      const warnings = checkPascalCase('getPersonFunction');
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings.some(w => w.includes('should start with an uppercase letter'))).toBe(true);
    });

    test('should warn about consecutive uppercase letters', () => {
      const warnings = checkPascalCase('APIGateway');
      expect(warnings.some(w => w.includes('consecutive uppercase letters'))).toBe(true);
    });

    test('should return empty array for empty or falsy input', () => {
      expect(checkPascalCase('')).toEqual([]);
      expect(checkPascalCase(null)).toEqual([]);
      expect(checkPascalCase(undefined)).toEqual([]);
    });
  });

  describe('validateApplicationResource()', () => {
    describe('Valid Names', () => {
      test('should accept valid application resource name', () => {
        const result = validateApplicationResource('acme-myapp-test-MyFunction');

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.components).toEqual({
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'test',
          resourceSuffix: 'MyFunction'
        });
      });

      test('should accept name with multiple hyphens in resource suffix', () => {
        const result = validateApplicationResource('org-project-prod-My-Complex-Function-Name');

        expect(result.valid).toBe(true);
        expect(result.components.resourceSuffix).toBe('My-Complex-Function-Name');
      });

      test('should accept classic stage IDs', () => {
        ['test', 'beta', 'stage', 'prod'].forEach(stageId => {
          const result = validateApplicationResource(`prefix-project-${stageId}-Resource`);
          expect(result.valid).toBe(true);
        });
      });

      test('should accept flexible stage IDs (tjoe, tf187, bfeat1)', () => {
        ['tjoe', 'tf187', 'bfeat1', 'sqa', 'pprod2'].forEach(stageId => {
          const result = validateApplicationResource(`prefix-project-${stageId}-Resource`);
          expect(result.valid).toBe(true);
          expect(result.components.stageId).toBe(stageId);
        });
      });
    });

    describe('Invalid Names', () => {
      test('should reject name with too few components', () => {
        const result = validateApplicationResource('prefix-project-test');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('at least 4 components'))).toBe(true);
      });

      test('should reject empty or null name', () => {
        expect(validateApplicationResource('').valid).toBe(false);
        expect(validateApplicationResource(null).valid).toBe(false);
      });

      test('should reject non-string name', () => {
        expect(validateApplicationResource(123).valid).toBe(false);
      });

      test('should reject prefix with special characters', () => {
        const result = validateApplicationResource('pre@fix-project-test-Resource');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Prefix must contain only alphanumeric'))).toBe(true);
      });

      test('should reject invalid stage ID with regex-based message', () => {
        const result = validateApplicationResource('prefix-project-invalid-Resource');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e =>
          e.includes('StageId') && e.includes('invalid') && e.includes('Must start with t, b, s, or p')
        )).toBe(true);
      });

      test('should reject stage ID starting with wrong letter', () => {
        const result = validateApplicationResource('prefix-project-dev-Resource');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('StageId'))).toBe(true);
      });
    });

    describe('Configuration Validation', () => {
      test('should validate against expected prefix', () => {
        const result = validateApplicationResource('wrong-project-test-Resource', {
          prefix: 'expected'
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('does not match expected value'))).toBe(true);
      });

      test('should validate against expected projectId', () => {
        const result = validateApplicationResource('prefix-wrong-test-Resource', {
          projectId: 'expected'
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('does not match expected value'))).toBe(true);
      });

      test('should validate against expected stageId', () => {
        const result = validateApplicationResource('prefix-project-test-Resource', {
          stageId: 'prod'
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('does not match expected value'))).toBe(true);
      });

      test('should accept name matching all expected values', () => {
        const result = validateApplicationResource('acme-myapp-prod-Function', {
          prefix: 'acme',
          projectId: 'myapp',
          stageId: 'prod'
        });

        expect(result.valid).toBe(true);
      });
    });

    describe('Resource Type Validation', () => {
      test('should validate Lambda function name length', () => {
        const longName = 'prefix-project-test-' + 'a'.repeat(100);
        const result = validateApplicationResource(longName, {
          resourceType: 'lambda'
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('too long'))).toBe(true);
      });

      test('should validate DynamoDB table name pattern', () => {
        const result = validateApplicationResource('prefix-project-test-Table@Name', {
          resourceType: 'dynamodb'
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('naming rules'))).toBe(true);
      });

      test('should validate CloudFormation stack name pattern', () => {
        const result = validateApplicationResource('prefix-project-test-Stack', {
          resourceType: 'cloudformation'
        });

        expect(result.valid).toBe(true);
      });
    });

    describe('Partial Validation', () => {
      test('should allow partial name with partial=true', () => {
        const result = validateApplicationResource('prefix-project', {
          partial: true
        });

        expect(result.valid).toBe(true);
      });

      test('should validate available components in partial mode', () => {
        const result = validateApplicationResource('pre@fix-project', {
          partial: true
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Prefix must contain only alphanumeric'))).toBe(true);
      });
    });

    describe('Suggestions', () => {
      test('should provide suggestions for invalid names', () => {
        const result = validateApplicationResource('prefix-project-invalid-Resource');

        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      test('should suggest correct format for too few components', () => {
        const result = validateApplicationResource('prefix-project');

        expect(result.suggestions.some(s => s.includes('Expected format'))).toBe(true);
      });

      test('should suggest valid stage ID pattern', () => {
        const result = validateApplicationResource('prefix-project-invalid-Resource');

        expect(result.suggestions.some(s =>
          s.includes('starts with t, b, s, or p')
        )).toBe(true);
      });
    });

    describe('Anchor-Based Parsing with Hyphenated Components', () => {
      test('should parse name with hyphenated Prefix when prefix is provided', () => {
        const result = validateApplicationResource('my-org-person-api-prod-GetFunction', {
          prefix: 'my-org',
          projectId: 'person-api'
        });

        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('my-org');
        expect(result.components.projectId).toBe('person-api');
        expect(result.components.stageId).toBe('prod');
        expect(result.components.resourceSuffix).toBe('GetFunction');
      });

      test('should parse name with hyphenated ProjectId when projectId is provided', () => {
        const result = validateApplicationResource('acme-person-api-prod-GetFunction', {
          prefix: 'acme',
          projectId: 'person-api'
        });

        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('acme');
        expect(result.components.projectId).toBe('person-api');
        expect(result.components.stageId).toBe('prod');
        expect(result.components.resourceSuffix).toBe('GetFunction');
      });

      test('should parse name with hyphenated Prefix using only prefix option', () => {
        const result = validateApplicationResource('my-org-myapp-prod-GetFunction', {
          prefix: 'my-org'
        });

        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('my-org');
        expect(result.components.projectId).toBe('myapp');
        expect(result.components.stageId).toBe('prod');
        expect(result.components.resourceSuffix).toBe('GetFunction');
      });

      test('should misparse ambiguous name without known values (demonstrates need for disambiguation)', () => {
        // Without known values, the heuristic assigns position 2 as StageId.
        // 'person' starts with 'p' so it matches StageId pattern, leading to
        // incorrect parsing. This demonstrates why known values are needed.
        const result = validateApplicationResource('my-org-person-api-prod-GetFunction');

        // Parses but with wrong component boundaries
        expect(result.components.prefix).toBe('my');
        expect(result.components.projectId).toBe('org');
        expect(result.components.stageId).toBe('person');
        expect(result.components.resourceSuffix).toBe('api-prod-GetFunction');
      });

      test('should return ambiguity error when StageId not at position 2 and no known values', () => {
        // 'data-service-api-beta-Handler' — 'data' at pos 0, 'service' at pos 1,
        // 'api' at pos 2 doesn't match StageId, 'beta' at pos 3 does → ambiguous
        const result = validateApplicationResource('data-service-api-beta-Handler');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('Cannot unambiguously parse'))).toBe(true);
        expect(result.suggestions.some(s => s.includes('prefix') || s.includes('projectId'))).toBe(true);
      });

      test('should parse shared resource with hyphenated components', () => {
        const result = validateApplicationResource('my-org-person-api-GetFunction', {
          prefix: 'my-org',
          projectId: 'person-api',
          isShared: true
        });

        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('my-org');
        expect(result.components.projectId).toBe('person-api');
        expect(result.components.resourceSuffix).toBe('GetFunction');
        expect(result.components.stageId).toBeUndefined();
      });

      test('should parse name with both prefix and projectId containing hyphens', () => {
        const result = validateApplicationResource('my-org-person-api-test-ListFunction', {
          prefix: 'my-org',
          projectId: 'person-api'
        });

        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('my-org');
        expect(result.components.projectId).toBe('person-api');
        expect(result.components.stageId).toBe('test');
        expect(result.components.resourceSuffix).toBe('ListFunction');
      });
    });

    describe('isShared Application Resource Validation', () => {
      test('should accept 3-component names when isShared=true', () => {
        const result = validateApplicationResource('acme-myapp-MyFunction', {
          isShared: true
        });

        expect(result.valid).toBe(true);
        expect(result.components).toEqual({
          prefix: 'acme',
          projectId: 'myapp',
          resourceSuffix: 'MyFunction'
        });
        expect(result.components.stageId).toBeUndefined();
      });

      test('should reject 3-component names when isShared=false (default)', () => {
        const result = validateApplicationResource('acme-myapp-MyFunction');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('at least 4 components'))).toBe(true);
      });

      test('should require at least 3 components when isShared=true', () => {
        const result = validateApplicationResource('acme-myapp', {
          isShared: true
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('at least 3 components'))).toBe(true);
      });

      test('should accept multi-hyphen resource suffix when isShared=true', () => {
        const result = validateApplicationResource('acme-myapp-My-Complex-Resource', {
          isShared: true
        });

        expect(result.valid).toBe(true);
        expect(result.components.resourceSuffix).toBe('My-Complex-Resource');
      });

      test('should validate prefix and projectId when isShared=true', () => {
        const result = validateApplicationResource('acme-myapp-MyFunction', {
          isShared: true,
          prefix: 'acme',
          projectId: 'myapp'
        });

        expect(result.valid).toBe(true);
      });

      test('should suggest shared format when isShared=true and too few parts', () => {
        const result = validateApplicationResource('acme-myapp', {
          isShared: true
        });

        expect(result.suggestions.some(s => s.includes('ResourceSuffix'))).toBe(true);
      });
    });
  });

  describe('validateS3Bucket()', () => {
    describe('Valid Names - Basic S3 Rules', () => {
      test('should reject bucket name that is too short', () => {
        const result = validateS3Bucket('ab');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('too short'))).toBe(true);
      });

      test('should reject bucket name that is too long', () => {
        const longName = 'a'.repeat(64);
        const result = validateS3Bucket(longName);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('too long'))).toBe(true);
      });

      test('should reject bucket name with uppercase letters', () => {
        const result = validateS3Bucket('Org-Prefix-Project-us-east-1');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('S3 naming rules'))).toBe(true);
      });

      test('should reject bucket name starting with dot', () => {
        const result = validateS3Bucket('.org-prefix-project-us-east-1');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('cannot start with dot'))).toBe(true);
      });

      test('should reject bucket name ending with hyphen', () => {
        const result = validateS3Bucket('org-prefix-project-us-east-1-');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('cannot end with'))).toBe(true);
      });

      test('should reject bucket name with consecutive dots', () => {
        const result = validateS3Bucket('org..prefix-project-us-east-1');

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('disallowed pattern'))).toBe(true);
      });
    });

    describe('Pattern 1 - With OrgPrefix (AccountId-Region-an)', () => {
      test('should parse pattern1 with OrgPrefix correctly', () => {
        const result = validateS3Bucket('org-prefix-project-test-123456789012-us-east-1-an', {
          orgPrefix: 'org'
        });

        expect(result.pattern).toBe('pattern1');
        expect(result.components.orgPrefix).toBe('org');
        expect(result.components.prefix).toBe('prefix');
        expect(result.components.projectId).toBe('project');
        expect(result.components.stageId).toBe('test');
        expect(result.components.region).toBe('us-east-1');
        expect(result.components.accountId).toBe('123456789012');
        expect(result.valid).toBe(true);
      });

      test('should parse pattern1 with OrgPrefix and multi-word region', () => {
        const result = validateS3Bucket('org-prefix-project-test-123456789012-ap-southeast-2-an', {
          orgPrefix: 'org'
        });

        expect(result.pattern).toBe('pattern1');
        expect(result.components.region).toBe('ap-southeast-2');
        expect(result.components.orgPrefix).toBe('org');
        expect(result.valid).toBe(true);
      });
    });

    describe('Pattern 1 - Without OrgPrefix (AccountId-Region-an)', () => {
      test('should parse pattern1 without OrgPrefix correctly', () => {
        const result = validateS3Bucket('prefix-project-test-123456789012-us-east-1-an');

        expect(result.pattern).toBe('pattern1');
        expect(result.components.orgPrefix).toBeUndefined();
        expect(result.components.prefix).toBe('prefix');
        expect(result.components.projectId).toBe('project');
        expect(result.components.stageId).toBe('test');
        expect(result.components.region).toBe('us-east-1');
        expect(result.components.accountId).toBe('123456789012');
        expect(result.valid).toBe(true);
      });

      test('should parse pattern1 without OrgPrefix and eu-west-1 region', () => {
        const result = validateS3Bucket('prefix-project-prod-987654321098-eu-west-1-an');

        expect(result.pattern).toBe('pattern1');
        expect(result.components.region).toBe('eu-west-1');
        expect(result.components.accountId).toBe('987654321098');
        expect(result.valid).toBe(true);
      });
    });

    describe('Pattern 2 - Shared with OrgPrefix', () => {
      test('should parse pattern2 with OrgPrefix (shared)', () => {
        const result = validateS3Bucket('org-prefix-project-123456789012-us-east-1', {
          isShared: true,
          orgPrefix: 'org'
        });

        expect(result.pattern).toBe('pattern2');
        expect(result.components.orgPrefix).toBe('org');
        expect(result.components.prefix).toBe('prefix');
        expect(result.components.projectId).toBe('project');
        expect(result.components.stageId).toBeUndefined();
        expect(result.components.region).toBe('us-east-1');
        expect(result.components.accountId).toBe('123456789012');
        expect(result.valid).toBe(true);
      });

      test('should parse pattern2 with hasOrgPrefix=true disambiguation', () => {
        const result = validateS3Bucket('org-prefix-project-123456789012-us-east-1', {
          hasOrgPrefix: true
        });

        expect(result.pattern).toBe('pattern2');
        expect(result.components.orgPrefix).toBe('org');
      });
    });

    describe('Pattern 2 - Shared without OrgPrefix', () => {
      test('should parse pattern2 without OrgPrefix (shared)', () => {
        const result = validateS3Bucket('prefix-project-123456789012-us-east-1', {
          isShared: true
        });

        expect(result.pattern).toBe('pattern2');
        expect(result.components.orgPrefix).toBeUndefined();
        expect(result.components.prefix).toBe('prefix');
        expect(result.components.projectId).toBe('project');
        expect(result.components.stageId).toBeUndefined();
        expect(result.components.region).toBe('us-east-1');
        expect(result.components.accountId).toBe('123456789012');
        expect(result.valid).toBe(true);
      });
    });

    describe('hasOrgPrefix Disambiguation', () => {
      test('should use hasOrgPrefix=false to force pattern1 without OrgPrefix for segments before AccountId', () => {
        const result = validateS3Bucket('prefix-project-test-123456789012-us-east-1-an', {
          hasOrgPrefix: false
        });

        expect(result.pattern).toBe('pattern1');
        expect(result.components.orgPrefix).toBeUndefined();
        expect(result.components.prefix).toBe('prefix');
        expect(result.components.projectId).toBe('project');
        expect(result.components.stageId).toBe('test');
      });

      test('should use hasOrgPrefix=true to force pattern2 with OrgPrefix for segments before AccountId', () => {
        const result = validateS3Bucket('org-prefix-project-123456789012-us-east-1', {
          hasOrgPrefix: true
        });

        expect(result.pattern).toBe('pattern2');
        expect(result.components.orgPrefix).toBe('org');
        expect(result.components.prefix).toBe('prefix');
        expect(result.components.projectId).toBe('project');
        expect(result.components.stageId).toBeUndefined();
      });
    });

    describe('Pattern 1 - Regional with AccountId-Region-an', () => {
      test('should parse pattern1 regional bucket (acme-myapp-prod-AccountId-Region-an)', () => {
        const result = validateS3Bucket('acme-myapp-prod-123456789012-us-east-1-an');

        expect(result.pattern).toBe('pattern1');
        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('acme');
        expect(result.components.projectId).toBe('myapp');
        expect(result.components.stageId).toBe('prod');
        expect(result.components.accountId).toBe('123456789012');
        expect(result.components.region).toBe('us-east-1');
      });

      test('should parse pattern1 with ResourceName', () => {
        const result = validateS3Bucket('acme-myapp-prod-assets-123456789012-us-east-1-an', {
          prefix: 'acme',
          projectId: 'myapp'
        });

        expect(result.pattern).toBe('pattern1');
        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('acme');
        expect(result.components.projectId).toBe('myapp');
        expect(result.components.stageId).toBe('prod');
        expect(result.components.resourceName).toBe('assets');
        expect(result.components.accountId).toBe('123456789012');
        expect(result.components.region).toBe('us-east-1');
      });

      test('should parse pattern1 with OrgPrefix', () => {
        const result = validateS3Bucket('63k-acme-myapp-prod-123456789012-us-east-1-an', {
          orgPrefix: '63k',
          prefix: 'acme',
          projectId: 'myapp'
        });

        expect(result.pattern).toBe('pattern1');
        expect(result.valid).toBe(true);
        expect(result.components.orgPrefix).toBe('63k');
        expect(result.components.prefix).toBe('acme');
        expect(result.components.projectId).toBe('myapp');
        expect(result.components.stageId).toBe('prod');
        expect(result.components.accountId).toBe('123456789012');
        expect(result.components.region).toBe('us-east-1');
      });

      test('should parse pattern1 with ap-southeast-2 region', () => {
        const result = validateS3Bucket('acme-myapp-prod-123456789012-ap-southeast-2-an');

        expect(result.pattern).toBe('pattern1');
        expect(result.valid).toBe(true);
        expect(result.components.region).toBe('ap-southeast-2');
      });
    });

    describe('Pattern 2 - Global with AccountId-Region (no -an)', () => {
      test('should parse pattern2 global bucket', () => {
        const result = validateS3Bucket('acme-myapp-prod-123456789012-us-east-1');

        expect(result.pattern).toBe('pattern2');
        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('acme');
        expect(result.components.projectId).toBe('myapp');
        expect(result.components.stageId).toBe('prod');
        expect(result.components.accountId).toBe('123456789012');
        expect(result.components.region).toBe('us-east-1');
      });

      test('should parse pattern2 with ResourceName and known values', () => {
        const result = validateS3Bucket('acme-myapp-prod-assets-123456789012-us-east-1', {
          prefix: 'acme',
          projectId: 'myapp'
        });

        expect(result.pattern).toBe('pattern2');
        expect(result.valid).toBe(true);
        expect(result.components.resourceName).toBe('assets');
      });
    });

    describe('Pattern 3 - Simple (no AccountId/Region)', () => {
      test('should detect pattern3 for bucket without region', () => {
        const result = validateS3Bucket('prefix-project-test-mybucket');

        expect(result.pattern).toBe('pattern3');
        expect(result.components.prefix).toBe('prefix');
        expect(result.components.projectId).toBe('project');
        expect(result.components.stageId).toBe('test');
        expect(result.components.resourceSuffix).toBe('mybucket');
      });

      test('should parse pattern3 simple bucket (acme-myapp-prod-assets)', () => {
        const result = validateS3Bucket('acme-myapp-prod-assets');

        expect(result.pattern).toBe('pattern3');
        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('acme');
        expect(result.components.projectId).toBe('myapp');
        expect(result.components.stageId).toBe('prod');
        expect(result.components.resourceSuffix).toBe('assets');
      });

      test('should include suggestion recommending preferred patterns', () => {
        const result = validateS3Bucket('prefix-project-test-mybucket');

        expect(result.suggestions.some(s =>
          s.includes('Region-AccountId') || s.includes('preferred')
        )).toBe(true);
      });

      test('should set pattern to pattern3', () => {
        const result = validateS3Bucket('prefix-project-test-mybucket');

        expect(result.pattern).toBe('pattern3');
      });

      test('should handle pattern3 with OrgPrefix when hasOrgPrefix=true', () => {
        const result = validateS3Bucket('org-prefix-project-test-mybucket', {
          hasOrgPrefix: true
        });

        expect(result.pattern).toBe('pattern3');
        expect(result.components.orgPrefix).toBe('org');
        expect(result.components.prefix).toBe('prefix');
        expect(result.components.projectId).toBe('project');
        expect(result.components.stageId).toBe('test');
        expect(result.components.resourceSuffix).toBe('mybucket');
      });
    });

    describe('S3 Hyphenated Components with Known Values', () => {
      test('should parse S3 pattern1 with hyphenated prefix using known values', () => {
        const result = validateS3Bucket('my-org-myapp-prod-123456789012-us-east-1-an', {
          prefix: 'my-org',
          projectId: 'myapp'
        });

        expect(result.pattern).toBe('pattern1');
        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('my-org');
        expect(result.components.projectId).toBe('myapp');
        expect(result.components.stageId).toBe('prod');
      });

      test('should parse S3 pattern1 with hyphenated projectId using known values', () => {
        const result = validateS3Bucket('acme-person-api-prod-123456789012-us-east-1-an', {
          prefix: 'acme',
          projectId: 'person-api'
        });

        expect(result.pattern).toBe('pattern1');
        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('acme');
        expect(result.components.projectId).toBe('person-api');
        expect(result.components.stageId).toBe('prod');
      });

      test('should parse S3 pattern2 with hyphenated components using known values', () => {
        const result = validateS3Bucket('my-org-person-api-prod-123456789012-us-east-1', {
          prefix: 'my-org',
          projectId: 'person-api'
        });

        expect(result.pattern).toBe('pattern2');
        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('my-org');
        expect(result.components.projectId).toBe('person-api');
        expect(result.components.stageId).toBe('prod');
      });

      test('should parse S3 pattern3 with hyphenated components using known values', () => {
        const result = validateS3Bucket('my-org-person-api-prod-assets', {
          prefix: 'my-org',
          projectId: 'person-api'
        });

        expect(result.pattern).toBe('pattern3');
        expect(result.valid).toBe(true);
        expect(result.components.prefix).toBe('my-org');
        expect(result.components.projectId).toBe('person-api');
        expect(result.components.stageId).toBe('prod');
      });

      test('should parse S3 with hyphenated orgPrefix, prefix, and projectId', () => {
        const result = validateS3Bucket('a-corp-my-org-person-api-prod-123456789012-us-east-1-an', {
          orgPrefix: 'a-corp',
          prefix: 'my-org',
          projectId: 'person-api'
        });

        expect(result.pattern).toBe('pattern1');
        expect(result.valid).toBe(true);
        expect(result.components.orgPrefix).toBe('a-corp');
        expect(result.components.prefix).toBe('my-org');
        expect(result.components.projectId).toBe('person-api');
        expect(result.components.stageId).toBe('prod');
      });
    });

    describe('Component Validation', () => {
      test('should validate account ID format', () => {
        const result = validateS3Bucket('prefix-project-test-12345-us-east-1-an');

        expect(result.valid).toBe(false);
        // The -an suffix triggers pattern1 detection but no valid 12-digit AccountId
        expect(result.errors.length).toBeGreaterThan(0);
      });

      test('should validate against expected orgPrefix', () => {
        const result = validateS3Bucket('wrong-acme-myapp-prod-123456789012-us-east-1-an', {
          orgPrefix: 'expected',
          prefix: 'acme',
          projectId: 'myapp'
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('expected') || e.includes('not found'))).toBe(true);
      });

      test('should validate against expected region', () => {
        const result = validateS3Bucket('prefix-project-test-123456789012-us-east-1-an', {
          region: 'us-west-2'
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('does not match expected value'))).toBe(true);
      });

      test('should validate against expected accountId', () => {
        const result = validateS3Bucket('prefix-project-test-123456789012-us-east-1-an', {
          accountId: '999999999999'
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('does not match expected value'))).toBe(true);
      });
    });

    describe('Partial Validation', () => {
      test('should allow partial bucket name with partial=true', () => {
        const result = validateS3Bucket('org-prefix', { partial: true });

        expect(result.errors.filter(e => !e.includes('does not match expected patterns')).length).toBe(0);
      });
    });

    describe('Suggestions', () => {
      test('should provide suggestions for invalid bucket names', () => {
        const result = validateS3Bucket('Invalid-Bucket-Name');

        expect(result.suggestions.length).toBeGreaterThan(0);
      });

      test('should suggest pattern formats for incomplete names', () => {
        const result = validateS3Bucket('ab');

        expect(result.errors.length).toBeGreaterThan(0);
      });
    });
  });

  describe('PascalCase Warnings', () => {
    test('should produce suggestion when ResourceSuffix does not start with uppercase', () => {
      const result = validateApplicationResource('prefix-project-test-myFunction');

      expect(result.valid).toBe(true);
      expect(result.suggestions.some(s => s.includes('should start with an uppercase letter'))).toBe(true);
    });

    test('should produce suggestion when ResourceSuffix has consecutive uppercase (APIGateway)', () => {
      const result = validateApplicationResource('prefix-project-test-APIGateway');

      expect(result.valid).toBe(true);
      expect(result.suggestions.some(s => s.includes('consecutive uppercase letters'))).toBe(true);
    });

    test('should produce no PascalCase warnings for valid PascalCase (GetPersonFunction)', () => {
      const result = validateApplicationResource('prefix-project-test-GetPersonFunction');

      expect(result.valid).toBe(true);
      const pascalWarnings = result.suggestions.filter(s =>
        s.includes('uppercase') || s.includes('PascalCase')
      );
      expect(pascalWarnings).toHaveLength(0);
    });

    test('should not set valid to false for PascalCase violations', () => {
      const result = validateApplicationResource('prefix-project-test-apiGateway');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    test('should produce PascalCase warnings for shared resources too', () => {
      const result = validateApplicationResource('prefix-project-myFunction', {
        isShared: true
      });

      expect(result.valid).toBe(true);
      expect(result.suggestions.some(s => s.includes('should start with an uppercase letter'))).toBe(true);
    });
  });

  describe('validateNaming()', () => {
    test('should route to validateS3Bucket for s3 type', () => {
      const result = validateNaming('prefix-project-test-123456789012-us-east-1-an', {
        resourceType: 's3'
      });

      expect(result.resourceType).toBe('s3');
      expect(result).toHaveProperty('pattern');
    });

    test('should route to validateApplicationResource for application type', () => {
      const result = validateNaming('prefix-project-test-Resource', {
        resourceType: 'application'
      });

      expect(result.resourceType).toBe('application');
      expect(result).toHaveProperty('components');
    });

    test('should route to validateApplicationResource for lambda type', () => {
      const result = validateNaming('prefix-project-test-Function', {
        resourceType: 'lambda'
      });

      expect(result.resourceType).toBe('lambda');
    });

    test('should route to validateApplicationResource for dynamodb type', () => {
      const result = validateNaming('prefix-project-test-Table', {
        resourceType: 'dynamodb'
      });

      expect(result.resourceType).toBe('dynamodb');
    });

    test('should route to validateApplicationResource for cloudformation type', () => {
      const result = validateNaming('prefix-project-test-Stack', {
        resourceType: 'cloudformation'
      });

      expect(result.resourceType).toBe('cloudformation');
    });

    test('should return error for missing resourceType', () => {
      const result = validateNaming('some-name', {});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Resource type is required');
    });

    test('should return error for unknown resourceType', () => {
      const result = validateNaming('some-name', {
        resourceType: 'unknown'
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown resource type'))).toBe(true);
    });

    test('should pass config options to underlying validators', () => {
      const result = validateNaming('prefix-project-test-Resource', {
        resourceType: 'lambda',
        config: {
          prefix: 'prefix',
          projectId: 'project',
          stageId: 'test'
        }
      });

      expect(result.valid).toBe(true);
    });

    test('should pass partial option to underlying validators', () => {
      const result = validateNaming('prefix-project', {
        resourceType: 'application',
        partial: true
      });

      expect(result.valid).toBe(true);
    });

    test('should thread isShared through to application validator', () => {
      const result = validateNaming('prefix-project-MyFunction', {
        resourceType: 'application',
        config: { isShared: true }
      });

      expect(result.valid).toBe(true);
      expect(result.components.stageId).toBeUndefined();
    });

    test('should thread isShared and hasOrgPrefix through to S3 validator', () => {
      const result = validateNaming('org-prefix-project-123456789012-us-east-1', {
        resourceType: 's3',
        config: { isShared: true, hasOrgPrefix: true }
      });

      expect(result.resourceType).toBe('s3');
      expect(result.pattern).toBe('pattern2');
      expect(result.components.orgPrefix).toBe('org');
    });
  });

  describe('detectResourceType()', () => {
    test('should detect S3 bucket with -an suffix as s3', () => {
      const type = detectResourceType('acme-myapp-prod-123456789012-us-east-1-an');
      expect(type).toBe('s3');
    });

    test('should detect S3 bucket with -an suffix and ap-southeast-2 region', () => {
      const type = detectResourceType('org-prefix-project-test-123456789012-ap-southeast-2-an');
      expect(type).toBe('s3');
    });

    test('should detect S3 bucket with AccountId-Region (no -an) as s3', () => {
      const type = detectResourceType('acme-myapp-prod-123456789012-us-east-1');
      expect(type).toBe('s3');
    });

    test('should detect S3 bucket from lowercase name with region pattern', () => {
      const type = detectResourceType('org-prefix-project-test-123456789012-us-east-1-an');
      expect(type).toBe('s3');
    });

    test('should detect S3 bucket with us-west-2 region', () => {
      const type = detectResourceType('org-prefix-project-123456789012-us-west-2');
      expect(type).toBe('s3');
    });

    test('should detect application resource from classic stage ID', () => {
      expect(detectResourceType('prefix-project-test-Resource')).toBe('application');
      expect(detectResourceType('prefix-project-prod-Function')).toBe('application');
    });

    test('should detect application resource from flexible stage IDs', () => {
      expect(detectResourceType('prefix-project-tjoe-Resource')).toBe('application');
      expect(detectResourceType('prefix-project-tf187-Resource')).toBe('application');
      expect(detectResourceType('prefix-project-bfeat1-Resource')).toBe('application');
    });

    test('should not detect application resource for invalid stage IDs', () => {
      expect(detectResourceType('prefix-project-invalid-Resource')).toBeNull();
      expect(detectResourceType('prefix-project-dev-Resource')).toBeNull();
    });

    test('should return null for invalid name', () => {
      expect(detectResourceType('invalid')).toBeNull();
    });

    test('should return null for empty string', () => {
      expect(detectResourceType('')).toBeNull();
    });

    test('should return null for null input', () => {
      expect(detectResourceType(null)).toBeNull();
    });

    test('should return null for non-string input', () => {
      expect(detectResourceType(123)).toBeNull();
    });

    test('should be case-sensitive for stage detection (lowercases internally)', () => {
      const type1 = detectResourceType('prefix-project-TEST-Resource');
      const type2 = detectResourceType('prefix-project-test-Resource');

      expect(type1).toBe('application');
      expect(type2).toBe('application');
    });
  });

  describe('Error Message Quality', () => {
    test('should provide clear error messages', () => {
      const result = validateApplicationResource('invalid');

      result.errors.forEach(error => {
        expect(typeof error).toBe('string');
        expect(error.length).toBeGreaterThan(0);
      });
    });

    test('should provide actionable suggestions', () => {
      const result = validateS3Bucket('Invalid-Bucket');

      result.suggestions.forEach(suggestion => {
        expect(typeof suggestion).toBe('string');
        expect(suggestion.length).toBeGreaterThan(0);
      });
    });

    test('should include specific component in error messages', () => {
      const result = validateApplicationResource('pre@fix-project-test-Resource');

      expect(result.errors.some(e => e.includes('Prefix'))).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle name with only hyphens', () => {
      const result = validateApplicationResource('----');

      expect(result.components).toBeDefined();
    });

    test('should handle very long resource names', () => {
      const longName = 'prefix-project-test-' + 'a'.repeat(200);
      const result = validateApplicationResource(longName);

      expect(result.valid).toBe(false);
    });

    test('should handle bucket name with mixed valid separators', () => {
      const result = validateS3Bucket('org.prefix-project.test-us-east-1');

      expect(result).toHaveProperty('valid');
    });

    test('should handle undefined options gracefully', () => {
      const result = validateApplicationResource('prefix-project-test-Resource', undefined);

      expect(result.valid).toBe(true);
    });
  });
});
