# Fix Config Refactor Test Failures - Bugfix Design

## Overview

This design document provides a systematic approach to fixing 217 test failures across 26 test files caused by incorrect Jest mock patterns after the Config refactoring. The production code is working correctly in all environments (TEST, BETA, PROD). The failures are isolated to test code that needs to be updated to work with the refactored Config module.

The fix strategy uses a priority-based, incremental approach where each test file is fixed and verified before moving to the next. This ensures we don't introduce new failures and can track progress systematically.

## Glossary

- **Bug_Condition (C)**: The condition that triggers test failures - when tests use incorrect Jest mock patterns (jest.mock() in beforeEach, incomplete Config mocks, direct CacheableDataAccess mocking, or lack of test isolation)
- **Property (P)**: The desired behavior - tests pass with correct mock patterns (module-level jest.mock(), complete Config structures, Model mocking, proper test isolation)
- **Preservation**: Currently passing tests (392 tests across 8 test suites) that must remain passing after fixes
- **Module-Level Mock**: jest.mock() call placed at the top of the file before any imports, allowing Jest to properly hoist and apply the mock
- **Test Isolation**: Using jest.clearAllMocks() in beforeEach() to reset mock call history between tests
- **Model Mocking**: Mocking underlying data models (S3Templates, S3Starters, GitHubApi, DocIndex) instead of mocking CacheableDataAccess.getData() directly

## Bug Details

### Fault Condition

The bug manifests when test files use incorrect Jest mock patterns that don't work with Jest's module mocking system. The tests fail with errors like "Cannot read properties of undefined", "Expected mock to be called but was not", and "Expected 1 call but received 2 calls".

**Formal Specification:**
```
FUNCTION isBugCondition(testFile)
  INPUT: testFile of type TestFile
  OUTPUT: boolean
  
  RETURN testFile.containsJestMockInBeforeEach()
         OR testFile.hasIncompleteConfigMock()
         OR testFile.mocksCacheableDataAccessDirectly()
         OR testFile.lacksProperTestIsolation()
END FUNCTION
```

### Examples

**Example 1: Jest Mock in beforeEach**
```javascript
// Bug condition - mock inside beforeEach doesn't work
describe('Templates Service', () => {
  beforeEach(() => {
    jest.mock('@63klabs/cache-data', () => ({...})); // ❌ Wrong placement
  });
});
```

**Example 2: Incomplete Config Mock**
```javascript
// Bug condition - missing required properties
Config.getConnCacheProfile.mockReturnValue({
  conn: { host: [] }, // ❌ Missing path, parameters
  cacheProfile: { pathId: 'test' } // ❌ Missing many required properties
});
```

**Example 3: Direct CacheableDataAccess Mocking**
```javascript
// Bug condition - bypasses service logic
CacheableDataAccess.getData.mockResolvedValue({
  body: { id: 'template-1' } // ❌ Doesn't test real code path
});
```

**Example 4: Lack of Test Isolation**
```javascript
// Bug condition - mock history pollutes other tests
describe('Service Tests', () => {
  // ❌ Missing jest.clearAllMocks() in beforeEach
  it('test 1', () => { /* ... */ });
  it('test 2', () => { /* ... */ }); // May fail due to test 1's mock calls
});
```

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- All 392 currently passing tests must continue to pass
- Test execution commands (npm test, npm run test:unit) must work unchanged
- Test execution time must remain reasonable (under 30 seconds for unit tests)
- Test harness pattern for private methods must continue to work
- aws-sdk-client-mock patterns must continue to work
- Error handling and edge case tests must continue testing the same scenarios

**Scope:**
All test files that do NOT exhibit the bug condition should be completely unaffected by this fix. This includes:
- Tests that already use correct mock patterns
- Tests that don't use Config or CacheableDataAccess
- Integration tests that use real AWS SDK mocks
- Performance tests

## Hypothesized Root Cause

Based on the investigation, the root causes are:

1. **Jest Mock Hoisting Misunderstanding**: Developers placed jest.mock() inside beforeEach() hooks, not understanding that Jest hoists these calls to module level before any code executes. Calling jest.mock() inside beforeEach() has no effect.

2. **Incomplete Mock Structures After Refactoring**: The Config refactoring changed the structure of conn and cacheProfile objects. Tests were not updated to include all required properties, causing TypeError when CacheableDataAccess.getData() tries to access missing properties.

3. **Over-Mocking Pattern**: Tests mocked CacheableDataAccess.getData() directly with mockResolvedValue(), bypassing the actual service logic. This pattern doesn't test the real code path and breaks when the service logic changes.

4. **Test Isolation Gaps**: Tests didn't call jest.clearAllMocks() in beforeEach(), causing mock call history from previous tests to pollute subsequent tests, leading to assertion failures about unexpected call counts.

## Correctness Properties

Property 1: Fault Condition - Tests Pass After Applying Fix Pattern

_For any_ test file where the bug condition holds (isBugCondition returns true), the fixed test file SHALL pass all its tests (excluding intentionally skipped tests) when the fix pattern is applied, with 0 failures and all assertions passing.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Passing Tests Stay Passing

_For any_ test file where the bug condition does NOT hold (isBugCondition returns false), the test file SHALL produce exactly the same test results (same number of passes, same number of failures) after fixing all buggy test files, preserving all existing test behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

All changes are in test files only. No production code changes are required.

**Files to Modify**: 26 test files in `application-infrastructure/src/tests/`

**Specific Changes**:

1. **Move jest.mock() to Module Level**:
   - Identify all jest.mock() calls inside beforeEach() or beforeAll() hooks
   - Move them to the top of the file, before any imports
   - Ensure they are complete mock structures with all required properties

2. **Complete Config Mock Structures**:
   - Update all Config.getConnCacheProfile() mocks to include complete conn and cacheProfile objects
   - conn must have: host (array), path (string), parameters (object)
   - cacheProfile must have: pathId, defaultExpirationInSeconds, hostId, profile, overrideOriginHeaderExpiration, expirationIsOnInterval, encrypt

3. **Replace Direct CacheableDataAccess Mocking with Model Mocking**:
   - Remove mockResolvedValue() calls on CacheableDataAccess.getData()
   - Add mockImplementation() that calls the fetchFunction and returns { body }
   - Mock the underlying Models (S3Templates.get, S3Starters.list, etc.) with test data

4. **Add Test Isolation**:
   - Add jest.clearAllMocks() in beforeEach() to reset mock call history
   - Ensure each test starts with clean mock state

5. **Verify Imports After Mocking**:
   - Ensure all imports happen AFTER jest.mock() calls
   - This allows Jest to apply mocks before modules are loaded

### Fix Pattern Templates

#### Template 1: Service Test Fix Pattern

```javascript
/**
 * Service Name Tests
 */

// ✅ Step 1: Mock at module level (before imports)
jest.mock('@63klabs/cache-data', () => ({
  cache: {
    CacheableDataAccess: {
      getData: jest.fn()
    }
  },
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    }
  }
}));

jest.mock('../../../lambda/read/config', () => ({
  Config: {
    init: jest.fn(),
    settings: jest.fn(),
    getConnCacheProfile: jest.fn()
  }
}));

jest.mock('../../../lambda/read/models', () => ({
  S3Templates: {
    get: jest.fn(),
    list: jest.fn()
  },
  S3Starters: {
    get: jest.fn(),
    list: jest.fn()
  },
  GitHubApi: {
    get: jest.fn()
  },
  DocIndex: {
    get: jest.fn()
  }
}));

// ✅ Step 2: Import after mocking
const { cache: { CacheableDataAccess }, tools: { DebugAndLog } } = require('@63klabs/cache-data');
const Service = require('../../../lambda/read/services/service-name');
const Models = require('../../../lambda/read/models');
const { Config } = require('../../../lambda/read/config');

describe('Service Name Tests', () => {
  beforeEach(() => {
    // ✅ Step 3: Clear mock history for test isolation
    jest.clearAllMocks();

    // ✅ Step 4: Setup complete Config mocks
    Config.getConnCacheProfile.mockReturnValue({
      conn: { 
        host: ['test-bucket-1', 'test-bucket-2'], 
        path: '/templates',
        parameters: {}
      },
      cacheProfile: { 
        pathId: 'templates-detail',
        defaultExpirationInSeconds: 300,
        hostId: 's3-templates',
        profile: 'template-detail',
        overrideOriginHeaderExpiration: false,
        expirationIsOnInterval: false,
        encrypt: true
      }
    });

    Config.settings.mockReturnValue({
      s3: {
        buckets: ['test-bucket-1', 'test-bucket-2']
      },
      templates: {
        categories: [
          { name: 'Storage', description: 'Storage templates' }
        ]
      }
    });

    // ✅ Step 5: Setup CacheableDataAccess mock to call fetchFunction
    CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
      const body = await fetchFunction(conn, opts);
      return { body };
    });
  });

  describe('method name', () => {
    it('should do something', async () => {
      // ✅ Step 6: Mock underlying Models with test data
      Models.S3Templates.get.mockResolvedValue({
        templateName: 'test-template',
        content: 'template content'
      });

      // Execute test
      const result = await Service.method();

      // Assertions
      expect(result).toBeDefined();
      expect(Models.S3Templates.get).toHaveBeenCalledTimes(1);
    });
  });
});
```

#### Template 2: Controller Test Fix Pattern

```javascript
/**
 * Controller Name Tests
 */

// ✅ Mock at module level
jest.mock('../../../lambda/read/services', () => ({
  Templates: {
    get: jest.fn(),
    list: jest.fn()
  },
  Starters: {
    get: jest.fn(),
    list: jest.fn()
  },
  Documentation: {
    get: jest.fn()
  }
}));

jest.mock('../../../lambda/read/config', () => ({
  Config: {
    settings: jest.fn()
  }
}));

// Import after mocking
const Controllers = require('../../../lambda/read/controllers');
const Services = require('../../../lambda/read/services');
const { Config } = require('../../../lambda/read/config');

describe('Controller Name Tests', () => {
  beforeEach(() => {
    // ✅ Clear mock history
    jest.clearAllMocks();

    // ✅ Setup Config mocks
    Config.settings.mockReturnValue({
      templates: {
        categories: [
          { name: 'Storage', description: 'Storage templates' }
        ]
      }
    });
  });

  describe('method name', () => {
    it('should do something', async () => {
      // Mock service response
      Services.Templates.get.mockResolvedValue({
        templateName: 'test-template',
        content: 'template content'
      });

      // Execute test
      const result = await Controllers.Templates.get({
        params: { category: 'Storage', templateName: 'test-template' }
      });

      // Assertions
      expect(result).toBeDefined();
      expect(Services.Templates.get).toHaveBeenCalledTimes(1);
    });
  });
});
```

#### Template 3: Model/DAO Test Fix Pattern

```javascript
/**
 * Model Name Tests
 */

// ✅ Mock AWS SDK and dependencies
jest.mock('@63klabs/cache-data', () => ({
  tools: {
    DebugAndLog: {
      debug: jest.fn(),
      warn: jest.fn()
    }
  }
}));

jest.mock('../../../lambda/read/config', () => ({
  Config: {
    settings: jest.fn()
  }
}));

// Import after mocking
const Models = require('../../../lambda/read/models');
const { Config } = require('../../../lambda/read/config');

describe('Model Name Tests', () => {
  beforeEach(() => {
    // ✅ Clear mock history
    jest.clearAllMocks();

    // ✅ Setup Config mocks
    Config.settings.mockReturnValue({
      s3: {
        buckets: ['test-bucket']
      }
    });
  });

  describe('method name', () => {
    it('should do something', async () => {
      // Test implementation
    });
  });
});
```

### Complete Config Mock Structure Reference

Use this as a reference for all Config.getConnCacheProfile() mocks:

```javascript
Config.getConnCacheProfile.mockReturnValue({
  conn: { 
    host: ['bucket-1', 'bucket-2'],  // Array of S3 buckets or API hosts
    path: '/path/to/resource',        // Path to resource
    parameters: {}                     // Query parameters (will be set by service)
  },
  cacheProfile: { 
    pathId: 'unique-path-id',                    // Unique identifier for this cache path
    defaultExpirationInSeconds: 300,             // Default TTL (5 minutes)
    hostId: 'host-identifier',                   // Host identifier
    profile: 'profile-name',                     // Profile name
    overrideOriginHeaderExpiration: false,       // Whether to override origin headers
    expirationIsOnInterval: false,               // Whether expiration is on interval
    encrypt: true                                // Whether to encrypt cached data
  }
});
```

### Complete Config.settings() Mock Structure Reference

Use this as a reference for all Config.settings() mocks:

```javascript
Config.settings.mockReturnValue({
  s3: {
    buckets: ['bucket-1', 'bucket-2']
  },
  github: {
    userOrgs: ['org-1', 'org-2']
  },
  templates: {
    categories: [
      { name: 'Storage', description: 'Storage templates' },
      { name: 'Pipeline', description: 'Pipeline templates' }
    ]
  },
  starters: {
    repositoryTypes: ['template', 'starter']
  }
});
```

## Testing Strategy

### Validation Approach

The testing strategy follows a priority-based, incremental approach with verification after each file fix. This ensures we don't introduce new failures and can track progress systematically.

### Exploratory Fault Condition Checking

**Goal**: Verify that the bug condition exists in each test file before fixing it. Confirm that tests fail with the expected error patterns.

**Test Plan**: Run each test file individually before fixing to observe the failure patterns and confirm they match the expected bug conditions.

**Test Cases**:
1. **Service Test Failures**: Run service tests to confirm "Cannot read properties of undefined" errors
2. **Controller Test Failures**: Run controller tests to confirm "Expected mock to be called" errors
3. **Model Test Failures**: Run model tests to confirm mock-related failures
4. **Integration Test Failures**: Run integration tests to confirm complex failure patterns

**Expected Counterexamples**:
- TypeError: Cannot read properties of undefined (reading 'host')
- TypeError: Cannot read properties of undefined (reading 'path')
- Error: Expected mock to be called but was not
- Error: Expected 1 call but received 2 calls

### Fix Checking

**Goal**: Verify that for all test files where the bug condition holds, the fixed test file passes all its tests.

**Pseudocode:**
```
FOR ALL testFile WHERE isBugCondition(testFile) DO
  fixedFile := applyFixPattern(testFile)
  result := runTests(fixedFile)
  ASSERT result.failures = 0
  ASSERT result.passes > 0
END FOR
```

**Implementation Strategy**:
1. Fix one test file at a time
2. Run that specific test file to verify it passes
3. Run the full test suite to verify no regressions
4. Move to the next test file only after verification

### Preservation Checking

**Goal**: Verify that for all test files where the bug condition does NOT hold, the test results remain unchanged after fixing all buggy files.

**Pseudocode:**
```
FOR ALL testFile WHERE NOT isBugCondition(testFile) DO
  resultBefore := runTests(testFile)
  applyFixToAllBuggyFiles()
  resultAfter := runTests(testFile)
  ASSERT resultBefore.passes = resultAfter.passes
  ASSERT resultBefore.failures = resultAfter.failures
END FOR
```

**Testing Approach**: After each fix, run the full test suite to ensure currently passing tests remain passing. Track the pass/fail counts to detect any regressions.

**Test Plan**: 
1. Record baseline: 392 passing tests across 8 test suites
2. After each file fix, run full test suite
3. Verify pass count increases (fixed tests) and no new failures appear
4. Final verification: All 392 baseline tests still passing + all 217 previously failing tests now passing

**Test Cases**:
1. **Baseline Passing Tests**: Verify 392 tests continue to pass throughout the fix process
2. **Test Execution Time**: Verify test execution time doesn't significantly increase
3. **Test Isolation**: Verify tests don't interfere with each other after fixes
4. **Mock Cleanup**: Verify mocks are properly cleaned up between tests

### Unit Tests

- Test each fixed file individually to verify all tests pass
- Test that mock structures are complete and correct
- Test that test isolation works (no cross-test pollution)
- Test that error handling tests still work correctly

### Property-Based Tests

- Generate random test execution orders to verify test isolation
- Generate random mock data to verify mock structures handle various inputs
- Test that fixes work across different test file types (service, controller, model)

### Integration Tests

- Run full test suite after each fix to verify no regressions
- Test that all test commands work (npm test, npm run test:unit, npm run test:integration)
- Test that CI/CD pipeline can run tests successfully
- Test that test execution time remains reasonable

### Incremental Fix and Verification Process

**Phase 1: High Priority Service Tests (6 files)**

For each file:
1. Apply fix pattern
2. Run individual test file: `npm test -- path/to/test-file.test.js`
3. Verify all tests in that file pass
4. Run full test suite: `npm test`
5. Verify no new failures introduced
6. Commit fix with descriptive message
7. Move to next file

Files:
- templates-service.test.js
- starters-service.test.js
- documentation-service.test.js
- starters-cache-data-integration.test.js
- starters-repository-type-filter.test.js
- starters-cloudfront-integration.test.js

**Phase 2: High Priority Controller Tests (6 files)**

Same process as Phase 1.

Files:
- templates-controller.test.js
- starters-controller.test.js
- documentation-controller.test.js
- updates-controller.test.js
- validation-controller.test.js
- controller-error-handling.test.js

**Phase 3: Medium Priority Model/DAO Tests (5 files)**

Same process as Phase 1.

Files:
- s3-templates-dao.test.js
- s3-starters-dao.test.js
- s3-templates-or-condition.test.js
- github-api-dao.test.js
- doc-index-dao.test.js

**Phase 4: Medium Priority Lambda Integration Tests (6 files)**

Same process as Phase 1.

Files:
- error-handling.test.js
- cache-scenarios.test.js
- multi-github-org-handling.test.js
- multi-bucket-handling.test.js
- brown-out-support.test.js
- read-handler.test.js

**Phase 5: Low Priority Integration/Performance Tests (3 files)**

Same process as Phase 1.

Files:
- rate-limiting-integration.test.js
- lambda-performance.test.js
- (1 additional file to be identified)

**Phase 6: Final Verification**

1. Run full test suite: `npm test`
2. Verify all 609 tests pass (392 baseline + 217 fixed)
3. Verify test execution time is reasonable
4. Verify no skipped tests (except intentionally skipped)
5. Update TESTING_SUMMARY.md with final results
6. Create completion summary

### Rollback Strategy

If a fix introduces new failures:

1. **Immediate Rollback**: Revert the specific file fix
2. **Analysis**: Analyze why the fix caused new failures
3. **Adjust Pattern**: Modify the fix pattern to address the issue
4. **Retry**: Apply the adjusted fix pattern
5. **Verify**: Run full test suite again

If multiple files are causing issues:

1. **Pause Fixing**: Stop applying fixes to new files
2. **Review Pattern**: Review the fix pattern templates
3. **Test Pattern**: Test the pattern on a single file
4. **Resume**: Resume fixing once pattern is validated

### Success Metrics

- **Zero Test Failures**: All 26 affected test files pass their tests
- **No Regressions**: All 392 baseline tests continue to pass
- **Consistent Patterns**: All fixes follow the same templates
- **Reasonable Execution Time**: Test suite completes in under 60 seconds
- **Clean Test Output**: No warnings or errors in test output

## File-Specific Guidance

### High Priority: Service Tests

**Common Patterns**:
- All service tests use CacheableDataAccess.getData()
- All service tests need complete Config mocks
- All service tests need Model mocks (S3Templates, S3Starters, GitHubApi, DocIndex)
- All service tests need DebugAndLog mocks

**Specific Mock Requirements**:
- Config.getConnCacheProfile() with complete conn and cacheProfile
- Config.settings() with s3.buckets, github.userOrgs, templates.categories
- CacheableDataAccess.getData() with mockImplementation that calls fetchFunction
- Model mocks (S3Templates.get, S3Starters.list, etc.) with test data

**Expected Test Structure**:
- Module-level mocks for @63klabs/cache-data, config, models
- beforeEach with jest.clearAllMocks() and mock setup
- Individual tests that mock specific Model methods
- Assertions on service return values and mock call counts

### High Priority: Controller Tests

**Common Patterns**:
- All controller tests call service methods
- All controller tests need Config.settings() mocks
- All controller tests need service mocks

**Specific Mock Requirements**:
- Config.settings() with relevant configuration
- Service mocks (Templates.get, Starters.list, etc.) with test data
- No CacheableDataAccess mocking (controllers don't use it directly)

**Expected Test Structure**:
- Module-level mocks for services and config
- beforeEach with jest.clearAllMocks() and Config.settings() setup
- Individual tests that mock specific service methods
- Assertions on controller return values and service call counts

### Medium Priority: Model/DAO Tests

**Common Patterns**:
- Model tests may use AWS SDK mocks (aws-sdk-client-mock)
- Model tests need Config.settings() for bucket/org configuration
- Model tests may not need CacheableDataAccess mocks

**Specific Mock Requirements**:
- Config.settings() with s3.buckets or github.userOrgs
- AWS SDK mocks using aws-sdk-client-mock (if applicable)
- DebugAndLog mocks for logging

**Expected Test Structure**:
- Module-level mocks for config and dependencies
- beforeEach with jest.clearAllMocks() and Config.settings() setup
- Individual tests that may use AWS SDK mocks
- Assertions on model return values and AWS SDK call counts

### Medium Priority: Lambda Integration Tests

**Common Patterns**:
- Integration tests test full Lambda handler flow
- Integration tests may need multiple layers of mocks
- Integration tests may test error scenarios

**Specific Mock Requirements**:
- Complete mock chain: Config → Services → Models
- Event and context mocks for Lambda handlers
- Error scenario mocks

**Expected Test Structure**:
- Module-level mocks for all dependencies
- beforeEach with comprehensive mock setup
- Individual tests that simulate Lambda invocations
- Assertions on handler return values and error handling

### Low Priority: Integration/Performance Tests

**Common Patterns**:
- May use real AWS SDK calls (not mocked)
- May have longer execution times
- May test rate limiting or performance characteristics

**Specific Mock Requirements**:
- Minimal mocking (may use real implementations)
- Config mocks for test environment
- May need special timeout handling

**Expected Test Structure**:
- May not follow standard mock patterns
- May need custom setup/teardown
- May need special assertions for performance metrics

## Reference Implementation

The proof-of-concept fix is in:
`application-infrastructure/src/tests/unit/services/templates-error-handling.test.js`

This file demonstrates:
- ✅ Module-level jest.mock() calls
- ✅ Complete Config.getConnCacheProfile() mock structure
- ✅ Complete Config.settings() mock structure
- ✅ CacheableDataAccess.getData() mockImplementation pattern
- ✅ Model mocking (S3Templates.get, S3Templates.list)
- ✅ Test isolation with jest.clearAllMocks()
- ✅ Proper import order (after mocking)
- ✅ Clean test structure with descriptive test names

Use this file as a reference when fixing other test files.

## Summary

This design provides a systematic, incremental approach to fixing 26 test files with 217 failing tests. The key principles are:

1. **Consistency**: All fixes follow the same patterns
2. **Incrementality**: Fix and verify one file at a time
3. **Safety**: Preserve all currently passing tests
4. **Maintainability**: Document patterns for future reference
5. **Verification**: Run tests after each fix to catch regressions early

The fix templates provide complete, reusable patterns for service tests, controller tests, model tests, and integration tests. The incremental verification process ensures we don't introduce new failures and can track progress systematically.

By following this design, we will achieve:
- Zero test failures across all 26 affected test files
- No regressions in the 392 currently passing tests
- Consistent mock patterns across the entire test suite
- Clear documentation for future test development
