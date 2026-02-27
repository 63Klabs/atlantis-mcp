# Bugfix Requirements Document

## Introduction

After completing the Config refactoring in spec `.kiro/specs/0-0-1-documentation-tests-config-refactor/`, the production code is working correctly, but 217 tests are failing across 26 test files. This bugfix addresses the test code issues that prevent the test suite from passing.

The production Lambda function operates correctly in all environments (TEST, BETA, PROD). The failures are isolated to the test suite and do not indicate any production bugs. The root cause has been identified as incorrect Jest mock patterns that need to be updated to work with the refactored Config module.

**Impact:** Test suite cannot verify production code correctness, blocking confident deployments and future development.

**Scope:** This bugfix only modifies test files. No production code changes are required.

---

## Bug Analysis

### Current Behavior (Defect)

**Section 1: What's Broken**

1.1 WHEN a test file uses `jest.mock()` inside `beforeEach()` or `beforeAll()` hooks THEN the mock is not applied because Jest hoists `jest.mock()` calls to module level before any code executes

1.2 WHEN a test mocks `Config.getConnCacheProfile()` with incomplete conn/cacheProfile structures (missing required properties like `host`, `path`, `pathId`, `defaultExpirationInSeconds`) THEN `CacheableDataAccess.getData()` throws `TypeError: Cannot read properties of undefined`

1.3 WHEN a test mocks `CacheableDataAccess.getData()` with `mockResolvedValue()` instead of mocking the underlying Models (S3Templates, S3Starters, GitHubApi, DocIndex) THEN the test bypasses the actual service logic and doesn't test the real code path

1.4 WHEN tests don't call `jest.clearAllMocks()` in `beforeEach()` THEN mock call history from previous tests pollutes subsequent tests, causing assertion failures and flaky tests

1.5 WHEN a test file has 26 test files with these patterns THEN 217 tests fail with errors like "Cannot read properties of undefined", "Expected mock to be called but was not", and "Expected 1 call but received 2 calls"

### Expected Behavior (Correct)

**Section 2: What Should Happen**

2.1 WHEN a test file needs to mock a module THEN the `jest.mock()` call SHALL be placed at module level (before any imports) so Jest can properly hoist and apply the mock

2.2 WHEN a test mocks `Config.getConnCacheProfile()` THEN it SHALL return complete conn and cacheProfile objects with all required properties:
- conn: `{ host: [], path: '', parameters: {} }`
- cacheProfile: `{ pathId: '', defaultExpirationInSeconds: 300, hostId: '', profile: '', overrideOriginHeaderExpiration: false, expirationIsOnInterval: false, encrypt: true }`

2.3 WHEN a test needs to control data returned by services THEN it SHALL mock the underlying Models (S3Templates.get, S3Starters.list, GitHubApi.get, DocIndex.get) instead of mocking `CacheableDataAccess.getData()`, allowing the real service logic to execute

2.4 WHEN a test suite has multiple test cases THEN each test SHALL call `jest.clearAllMocks()` in `beforeEach()` to reset mock call history and ensure test isolation

2.5 WHEN all 26 test files follow these patterns THEN all 217 tests SHALL pass, the test suite SHALL show 0 failures (excluding intentionally skipped tests), and the test suite SHALL provide reliable verification of production code

### Unchanged Behavior (Regression Prevention)

**Section 3: What Must Stay the Same**

3.1 WHEN tests that are currently passing (392 tests across 8 test suites) run after the fix THEN they SHALL CONTINUE TO pass without any new failures

3.2 WHEN the test suite runs in CI/CD pipelines THEN it SHALL CONTINUE TO execute with the same commands (`npm test`, `npm run test:unit`, `npm run test:integration`) and exit codes

3.3 WHEN production code (Lambda handlers, services, controllers, models) is executed THEN it SHALL CONTINUE TO function identically to before this bugfix, with no behavioral changes

3.4 WHEN developers run tests locally during development THEN the test execution time SHALL CONTINUE TO be reasonable (under 30 seconds for unit tests) and not significantly increase

3.5 WHEN test files use the test harness pattern for private methods (documented in `.kiro/steering/test-harness-for-private-classes-and-methods.md`) THEN they SHALL CONTINUE TO work without modification

3.6 WHEN tests use `aws-sdk-client-mock` for mocking AWS SDK calls THEN they SHALL CONTINUE TO work with the same mock patterns

3.7 WHEN tests verify error handling, edge cases, and boundary conditions THEN they SHALL CONTINUE TO test the same scenarios with the same assertions

---

## Bug Condition and Properties

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type TestFile
  OUTPUT: boolean
  
  // Returns true when the test file exhibits the bug condition
  RETURN (
    X.containsJestMockInBeforeEach() OR
    X.hasIncompleteConfigMock() OR
    X.mocksCacheableDataAccessDirectly() OR
    X.lacksProperTestIsolation()
  )
END FUNCTION
```

**Concrete Examples of Bug Condition:**

Test file `tests/unit/services/templates-service.test.js` exhibits C(X) because:
- Contains `jest.mock('@63klabs/cache-data')` inside `beforeEach()` hook
- Mocks `Config.getConnCacheProfile()` with `{ conn: { host: [] } }` (missing `path`, `parameters`)
- Mocks `CacheableDataAccess.getData.mockResolvedValue({ body: data })` instead of mocking `S3Templates.get()`
- Does not call `jest.clearAllMocks()` in `beforeEach()`

Test file `tests/unit/controllers/templates-controller.test.js` exhibits C(X) because:
- Contains `jest.mock('../../../lambda/read/services')` inside `beforeEach()` hook
- Does not reset mock call history between tests

### Property Specification: Fix Checking

```pascal
// Property: Fix Checking - Tests Pass After Applying Fix Pattern
FOR ALL X WHERE isBugCondition(X) DO
  X' ← applyFixPattern(X)
  result ← runTests(X')
  ASSERT result.failures = 0 AND result.passes > 0
END FOR
```

**Fix Pattern Definition:**

```pascal
FUNCTION applyFixPattern(X)
  INPUT: X of type TestFile
  OUTPUT: X' of type TestFile (fixed version)
  
  X' ← X
  
  // Step 1: Move jest.mock() to module level
  IF X.containsJestMockInBeforeEach() THEN
    X' ← moveJestMocksToModuleLevel(X')
  END IF
  
  // Step 2: Complete Config mocks
  IF X.hasIncompleteConfigMock() THEN
    X' ← addCompleteConfigMockStructure(X')
  END IF
  
  // Step 3: Mock underlying Models instead of CacheableDataAccess
  IF X.mocksCacheableDataAccessDirectly() THEN
    X' ← replaceWithModelMocks(X')
  END IF
  
  // Step 4: Add test isolation
  IF X.lacksProperTestIsolation() THEN
    X' ← addJestClearAllMocksInBeforeEach(X')
  END IF
  
  RETURN X'
END FUNCTION
```

### Property Specification: Preservation Checking

```pascal
// Property: Preservation Checking - Passing Tests Stay Passing
FOR ALL X WHERE NOT isBugCondition(X) DO
  resultBefore ← runTests(X)
  // Apply fix to other files
  applyFixToAllBuggyFiles()
  resultAfter ← runTests(X)
  
  ASSERT resultBefore.passes = resultAfter.passes
  ASSERT resultBefore.failures = resultAfter.failures
END FOR
```

**Preservation Goal:**
The 392 currently passing tests across 8 test suites must continue to pass after fixing the 26 buggy test files. No new test failures should be introduced.

---

## Affected Test Files

### High Priority: Service Tests (6 files)
- `application-infrastructure/src/tests/unit/services/templates-service.test.js`
- `application-infrastructure/src/tests/unit/services/starters-service.test.js`
- `application-infrastructure/src/tests/unit/services/documentation-service.test.js`
- `application-infrastructure/src/tests/unit/services/starters-cache-data-integration.test.js`
- `application-infrastructure/src/tests/unit/services/starters-repository-type-filter.test.js`
- `application-infrastructure/src/tests/unit/services/starters-cloudfront-integration.test.js`

### High Priority: Controller Tests (6 files)
- `application-infrastructure/src/tests/unit/controllers/templates-controller.test.js`
- `application-infrastructure/src/tests/unit/controllers/starters-controller.test.js`
- `application-infrastructure/src/tests/unit/controllers/documentation-controller.test.js`
- `application-infrastructure/src/tests/unit/controllers/updates-controller.test.js`
- `application-infrastructure/src/tests/unit/controllers/validation-controller.test.js`
- `application-infrastructure/src/tests/unit/controllers/controller-error-handling.test.js`

### Medium Priority: Model/DAO Tests (5 files)
- `application-infrastructure/src/tests/unit/models/s3-templates-dao.test.js`
- `application-infrastructure/src/tests/unit/models/s3-starters-dao.test.js`
- `application-infrastructure/src/tests/unit/models/s3-templates-or-condition.test.js`
- `application-infrastructure/src/tests/unit/models/github-api-dao.test.js`
- `application-infrastructure/src/tests/unit/models/doc-index-dao.test.js`

### Medium Priority: Lambda Integration Tests (6 files)
- `application-infrastructure/src/tests/unit/lambda/error-handling.test.js`
- `application-infrastructure/src/tests/unit/lambda/cache-scenarios.test.js`
- `application-infrastructure/src/tests/unit/lambda/multi-github-org-handling.test.js`
- `application-infrastructure/src/tests/unit/lambda/multi-bucket-handling.test.js`
- `application-infrastructure/src/tests/unit/lambda/brown-out-support.test.js`
- `application-infrastructure/src/tests/unit/lambda/read-handler.test.js`

### Low Priority: Integration/Performance Tests (3 files)
- `application-infrastructure/src/tests/integration/rate-limiting-integration.test.js`
- `application-infrastructure/src/tests/performance/lambda-performance.test.js`
- (1 additional file to be identified)

---

## Reference Materials

### Investigation Documentation
- **Root Cause Analysis:** `.kiro/specs/0-0-1-documentation-tests-config-refactor/TEST_FAILURE_INVESTIGATION.md`
- **Fix Summary:** `.kiro/specs/0-0-1-documentation-tests-config-refactor/TEST_FIX_SUMMARY.md`

### Proof of Concept
- **Fixed Test File:** `application-infrastructure/src/tests/unit/services/templates-error-handling.test.js`
  - This file demonstrates the correct fix pattern
  - All tests in this file pass after applying the fix
  - Use as reference template for fixing other test files

### Test Standards
- **Test Harness Pattern:** `.kiro/steering/test-harness-for-private-classes-and-methods.md`
- **Test Requirements:** `.kiro/steering/test-requirements.md`
- **Test Execution Monitoring:** `.kiro/steering/test-execution-monitoring.md`

---

## Success Criteria

1. **Zero Test Failures:** All 26 affected test files pass their tests (excluding intentionally skipped tests)
2. **No Regressions:** All 392 currently passing tests continue to pass
3. **Test Suite Health:** Final test run shows `Test Suites: X passed, Y skipped, X total` with 0 failed
4. **Consistent Patterns:** All fixed test files follow the same mock patterns for maintainability
5. **Documentation Updated:** Test patterns documented in `application-infrastructure/src/tests/TESTING_SUMMARY.md`

---

## Counterexamples

### Counterexample 1: Jest Mock in beforeEach

**Input:** Test file with `jest.mock()` inside `beforeEach()`

```javascript
describe('Templates Service', () => {
  beforeEach(() => {
    jest.mock('@63klabs/cache-data', () => ({...})); // Bug condition
  });
});
```

**Expected After Fix:**

```javascript
// Mock at module level
jest.mock('@63klabs/cache-data', () => ({
  cache: { CacheableDataAccess: { getData: jest.fn() } },
  tools: { DebugAndLog: { debug: jest.fn(), warn: jest.fn() } }
}));

describe('Templates Service', () => {
  beforeEach(() => {
    jest.clearAllMocks(); // Clear call history only
  });
});
```

### Counterexample 2: Incomplete Config Mock

**Input:** Config mock missing required properties

```javascript
Config.getConnCacheProfile.mockReturnValue({
  conn: { host: [] }, // Missing path, parameters
  cacheProfile: { pathId: 'test' } // Missing many required properties
});
```

**Expected After Fix:**

```javascript
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
```

### Counterexample 3: Mocking CacheableDataAccess Directly

**Input:** Test mocks `CacheableDataAccess.getData()` with hardcoded data

```javascript
CacheableDataAccess.getData.mockResolvedValue({
  body: { id: 'template-1', name: 'Test Template' }
});
```

**Expected After Fix:**

```javascript
// Mock the underlying Model instead
S3Templates.get.mockResolvedValue({
  id: 'template-1',
  name: 'Test Template'
});

// Let CacheableDataAccess.getData() call the real logic
CacheableDataAccess.getData.mockImplementation(async (cacheProfile, fetchFunction, conn, opts) => {
  const body = await fetchFunction(conn, opts);
  return { body };
});
```

---

## Notes

- **No Production Code Changes:** This bugfix only modifies test files in `application-infrastructure/src/tests/`
- **Test Execution Time:** Fix should not significantly impact test execution time
- **CI/CD Compatibility:** Tests must pass in both local development and CI/CD environments
- **Incremental Approach:** Tests can be fixed incrementally, verifying each file before moving to the next
- **Pattern Consistency:** All fixes should follow the same patterns for long-term maintainability
