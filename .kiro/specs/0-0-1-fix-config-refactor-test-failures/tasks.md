# Implementation Plan

## Overview

This task list provides a systematic, incremental approach to fixing 217 test failures across 26 test files. Each task includes verification steps to ensure no regressions are introduced. The tasks are organized by priority phases, with high-priority service and controller tests fixed first.

**Total Affected Files:** 26 test files
**Total Failing Tests:** 217 tests
**Currently Passing Tests:** 392 tests (must remain passing)

---

## Phase 1: High Priority Service Tests (6 files)

### 1.1 Fix templates-service.test.js

- [ ] Apply fix pattern from design.md Template 1
  - Move jest.mock() calls to module level (before imports)
  - Add complete Config.getConnCacheProfile() mock structure
  - Add complete Config.settings() mock structure
  - Replace CacheableDataAccess.getData() mockResolvedValue with mockImplementation
  - Mock S3Templates.get() and S3Templates.list() with test data
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/services/templates-service.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update templates-service.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 1.2 Fix starters-service.test.js


- [ ] Apply fix pattern from design.md Template 1
  - Move jest.mock() calls to module level
  - Add complete Config mocks (getConnCacheProfile and settings)
  - Replace CacheableDataAccess.getData() mockResolvedValue with mockImplementation
  - Mock S3Starters.list() and S3Starters.get() with test data
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/services/starters-service.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update starters-service.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 1.3 Fix documentation-service.test.js

- [ ] Apply fix pattern from design.md Template 1
  - Move jest.mock() calls to module level
  - Add complete Config mocks
  - Replace CacheableDataAccess.getData() mockResolvedValue with mockImplementation
  - Mock DocIndex.get() and GitHubApi.get() with test data
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/services/documentation-service.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update documentation-service.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 1.4 Fix starters-cache-data-integration.test.js

- [ ] Apply fix pattern from design.md Template 1
  - Move jest.mock() calls to module level
  - Add complete Config mocks with cache profile settings
  - Setup CacheableDataAccess.getData() mockImplementation
  - Mock S3Starters with integration test data
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/services/starters-cache-data-integration.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update starters-cache-data-integration.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 1.5 Fix starters-repository-type-filter.test.js

- [ ] Apply fix pattern from design.md Template 1
  - Move jest.mock() calls to module level
  - Add complete Config mocks with repository type settings
  - Setup CacheableDataAccess.getData() mockImplementation
  - Mock S3Starters.list() with various repository types
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/services/starters-repository-type-filter.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update starters-repository-type-filter.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 1.6 Fix starters-cloudfront-integration.test.js

- [ ] Apply fix pattern from design.md Template 1
  - Move jest.mock() calls to module level
  - Add complete Config mocks with CloudFront settings
  - Setup CacheableDataAccess.getData() mockImplementation
  - Mock S3Starters with CloudFront integration data
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/services/starters-cloudfront-integration.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update starters-cloudfront-integration.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

---

## Phase 2: High Priority Controller Tests (6 files)

### 2.1 Fix templates-controller.test.js

- [ ] Apply fix pattern from design.md Template 2
  - Move jest.mock() calls to module level
  - Add complete Config.settings() mock
  - Mock Templates service methods (get, list)
  - Add jest.clearAllMocks() in beforeEach()
  - No CacheableDataAccess mocking needed (controllers don't use it directly)
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/controllers/templates-controller.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update templates-controller.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 2.2 Fix starters-controller.test.js

- [ ] Apply fix pattern from design.md Template 2
  - Move jest.mock() calls to module level
  - Add complete Config.settings() mock
  - Mock Starters service methods (get, list)
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/controllers/starters-controller.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update starters-controller.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 2.3 Fix documentation-controller.test.js

- [ ] Apply fix pattern from design.md Template 2
  - Move jest.mock() calls to module level
  - Add complete Config.settings() mock
  - Mock Documentation service methods (get)
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/controllers/documentation-controller.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update documentation-controller.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 2.4 Fix updates-controller.test.js

- [ ] Apply fix pattern from design.md Template 2
  - Move jest.mock() calls to module level
  - Add complete Config.settings() mock
  - Mock relevant service methods
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/controllers/updates-controller.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update updates-controller.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 2.5 Fix validation-controller.test.js

- [ ] Apply fix pattern from design.md Template 2
  - Move jest.mock() calls to module level
  - Add complete Config.settings() mock
  - Mock validation service methods
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/controllers/validation-controller.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update validation-controller.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 2.6 Fix controller-error-handling.test.js

- [ ] Apply fix pattern from design.md Template 2
  - Move jest.mock() calls to module level
  - Add complete Config.settings() mock
  - Mock service methods to throw errors for error scenarios
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/controllers/controller-error-handling.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update controller-error-handling.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

---

## Phase 3: Medium Priority Model/DAO Tests (5 files)

### 3.1 Fix s3-templates-dao.test.js

- [ ] Apply fix pattern from design.md Template 3
  - Move jest.mock() calls to module level
  - Add Config.settings() mock with s3.buckets configuration
  - Mock AWS SDK calls using aws-sdk-client-mock (if applicable)
  - Add jest.clearAllMocks() in beforeEach()
  - No CacheableDataAccess mocking needed (models don't use it)
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/models/s3-templates-dao.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update s3-templates-dao.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 3.2 Fix s3-starters-dao.test.js

- [ ] Apply fix pattern from design.md Template 3
  - Move jest.mock() calls to module level
  - Add Config.settings() mock with s3.buckets configuration
  - Mock AWS SDK calls using aws-sdk-client-mock (if applicable)
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/models/s3-starters-dao.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update s3-starters-dao.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 3.3 Fix s3-templates-or-condition.test.js

- [ ] Apply fix pattern from design.md Template 3
  - Move jest.mock() calls to module level
  - Add Config.settings() mock with s3.buckets configuration
  - Mock AWS SDK calls for OR condition testing
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/models/s3-templates-or-condition.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update s3-templates-or-condition.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 3.4 Fix github-api-dao.test.js

- [ ] Apply fix pattern from design.md Template 3
  - Move jest.mock() calls to module level
  - Add Config.settings() mock with github.userOrgs configuration
  - Mock GitHub API calls
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/models/github-api-dao.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update github-api-dao.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 3.5 Fix doc-index-dao.test.js

- [ ] Apply fix pattern from design.md Template 3
  - Move jest.mock() calls to module level
  - Add Config.settings() mock with relevant configuration
  - Mock document index operations
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/models/doc-index-dao.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update doc-index-dao.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

---

## Phase 4: Medium Priority Lambda Integration Tests (6 files)

### 4.1 Fix error-handling.test.js

- [ ] Apply comprehensive fix pattern
  - Move jest.mock() calls to module level
  - Add complete Config mocks (getConnCacheProfile and settings)
  - Mock full dependency chain: Config → Services → Models
  - Setup error scenario mocks (services throw errors)
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/lambda/error-handling.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update error-handling.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 4.2 Fix cache-scenarios.test.js

- [ ] Apply comprehensive fix pattern
  - Move jest.mock() calls to module level
  - Add complete Config mocks with cache profile settings
  - Mock CacheableDataAccess.getData() with various cache scenarios
  - Mock underlying Models for cache hit/miss scenarios
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/lambda/cache-scenarios.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update cache-scenarios.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 4.3 Fix multi-github-org-handling.test.js

- [ ] Apply comprehensive fix pattern
  - Move jest.mock() calls to module level
  - Add Config.settings() mock with multiple github.userOrgs
  - Mock GitHubApi.get() for multiple organizations
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/lambda/multi-github-org-handling.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update multi-github-org-handling.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 4.4 Fix multi-bucket-handling.test.js

- [ ] Apply comprehensive fix pattern
  - Move jest.mock() calls to module level
  - Add Config.settings() mock with multiple s3.buckets
  - Add Config.getConnCacheProfile() mock with multiple hosts
  - Mock S3 operations for multiple buckets
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/lambda/multi-bucket-handling.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update multi-bucket-handling.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 4.5 Fix brown-out-support.test.js

- [ ] Apply comprehensive fix pattern
  - Move jest.mock() calls to module level
  - Add complete Config mocks
  - Mock brown-out scenarios (service degradation)
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/lambda/brown-out-support.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update brown-out-support.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

### 4.6 Fix read-handler.test.js

- [ ] Apply comprehensive fix pattern
  - Move jest.mock() calls to module level
  - Add complete Config mocks
  - Mock Lambda event and context objects
  - Mock full handler flow: Controllers → Services → Models
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/unit/lambda/read-handler.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update read-handler.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

---

## Phase 5: Low Priority Integration/Performance Tests (3 files)

### 5.1 Fix rate-limiting-integration.test.js

- [ ] Analyze test file to determine fix pattern needed
  - May use minimal mocking (real implementations)
  - May need special timeout handling
  - May need Config mocks for test environment
- [ ] Apply appropriate fix pattern
  - Move any jest.mock() calls to module level
  - Add Config mocks if needed
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/integration/rate-limiting-integration.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update rate-limiting-integration.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 5.2 Fix lambda-performance.test.js

- [ ] Analyze test file to determine fix pattern needed
  - May need special performance measurement setup
  - May need Config mocks for test environment
  - May have longer execution times
- [ ] Apply appropriate fix pattern
  - Move any jest.mock() calls to module level
  - Add Config mocks if needed
  - Add jest.clearAllMocks() in beforeEach()
  - Ensure timeout settings are appropriate
- [ ] Run individual test file to verify
  - Command: `npm test -- application-infrastructure/src/tests/performance/lambda-performance.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update lambda-performance.test.js mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

### 5.3 Identify and fix the 3rd low priority test file

- [ ] Run full test suite to identify remaining failing test file
  - Command: `npm test`
  - Review output to find the 3rd low priority file
- [ ] Analyze test file to determine fix pattern needed
- [ ] Apply appropriate fix pattern
  - Move any jest.mock() calls to module level
  - Add Config mocks if needed
  - Add jest.clearAllMocks() in beforeEach()
- [ ] Run individual test file to verify
  - Command: `npm test -- path/to/test-file.test.js`
  - Expected: All tests pass (0 failures)
- [ ] Run full test suite to check for regressions
  - Command: `npm test`
  - Expected: No new failures, pass count increases
- [ ] Commit with descriptive message
  - Message: "fix: update [filename] mock patterns for Config refactor"
- _Requirements: 2.1, 2.2, 2.4, 2.5_

---

## Phase 6: Final Verification and Documentation

### 6.1 Run comprehensive test suite verification

- [ ] Run full test suite with verbose output
  - Command: `npm test -- --verbose`
  - Expected: All 609 tests pass (392 baseline + 217 fixed)
  - Expected: 0 test failures
  - Expected: Test execution time under 60 seconds
- [ ] Verify test suite health metrics
  - Check: Test Suites: X passed, 0 failed, Y skipped, X total
  - Check: Tests: 609 passed, 0 failed, Z skipped, 609 total
  - Check: No error messages or warnings in output
- [ ] Run unit tests separately
  - Command: `npm run test:unit`
  - Expected: All unit tests pass
- [ ] Run integration tests separately (if applicable)
  - Command: `npm run test:integration`
  - Expected: All integration tests pass
- _Requirements: 2.5, 3.1, 3.2, 3.4_

### 6.2 Update TESTING_SUMMARY.md

- [ ] Document the fix patterns used
  - Module-level jest.mock() placement
  - Complete Config mock structures
  - Model mocking instead of CacheableDataAccess mocking
  - Test isolation with jest.clearAllMocks()
- [ ] Document test file organization
  - Service tests: Use Template 1
  - Controller tests: Use Template 2
  - Model tests: Use Template 3
  - Integration tests: Use comprehensive patterns
- [ ] Add reference to design.md for detailed patterns
- [ ] Include examples of correct mock patterns
- [ ] Document common pitfalls to avoid
- _Requirements: 2.5_

### 6.3 Create completion summary

- [ ] Document final test results
  - Total tests passing: 609
  - Total tests failing: 0
  - Test files fixed: 26
  - Baseline tests preserved: 392
- [ ] Document verification steps completed
  - All individual test files verified
  - Full test suite verified after each fix
  - No regressions introduced
  - Test execution time remains reasonable
- [ ] Document lessons learned
  - Jest mock hoisting behavior
  - Importance of complete mock structures
  - Benefits of mocking at the right level (Models vs CacheableDataAccess)
  - Value of test isolation
- [ ] Create summary document in spec directory
  - File: `.kiro/specs/0-0-1-fix-config-refactor-test-failures/COMPLETION_SUMMARY.md`
- _Requirements: 2.5, 3.1_

---

## Success Criteria

- [ ] All 26 affected test files pass their tests (0 failures)
- [ ] All 392 baseline tests continue to pass (no regressions)
- [ ] Final test run shows: Test Suites: X passed, 0 failed, Y skipped
- [ ] Final test run shows: Tests: 609 passed, 0 failed, Z skipped
- [ ] Test execution time remains under 60 seconds
- [ ] All fixes follow consistent patterns from design.md
- [ ] TESTING_SUMMARY.md updated with fix patterns
- [ ] COMPLETION_SUMMARY.md created with final results

---

## Rollback Strategy

If a fix introduces new failures:

1. **Immediate Rollback**: Revert the specific file fix
   - Command: `git checkout HEAD -- path/to/test-file.test.js`
2. **Analysis**: Review the failure output to understand the issue
3. **Adjust Pattern**: Modify the fix pattern to address the issue
4. **Retry**: Apply the adjusted fix pattern
5. **Verify**: Run full test suite again

If multiple files are causing issues:

1. **Pause Fixing**: Stop applying fixes to new files
2. **Review Pattern**: Review the fix pattern templates in design.md
3. **Test Pattern**: Test the pattern on a single file
4. **Resume**: Resume fixing once pattern is validated

---

## Notes

- **Reference Implementation**: Use `application-infrastructure/src/tests/unit/services/templates-error-handling.test.js` as a working example
- **Fix Templates**: Refer to design.md for complete fix pattern templates
- **Test Isolation**: Always include jest.clearAllMocks() in beforeEach()
- **Mock Structures**: Use complete Config mock structures from design.md
- **Incremental Approach**: Fix and verify one file at a time
- **No Production Code Changes**: All changes are in test files only
