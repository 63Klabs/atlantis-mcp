# Implementation Plan: Test Strategy Refactor - Bypass Cache Layer

## Overview

This implementation plan refactors 217 failing tests across 26 test files to bypass CacheableDataAccess.getData() mocking and instead mock DAO functions directly. The refactoring is organized into 5 phases over 3 weeks, starting with high-priority service tests and progressing through controllers, DAOs, Lambda integration tests, and finally integration/performance tests.

**Key Strategy**: Tests will mock the appropriate layer (Models for services, Services for controllers, AWS SDK for DAOs) instead of mocking the cache wrapper, making tests simpler, more robust, and resilient to Config refactoring.

## Tasks

- [x] 1. Phase 1: Refactor High Priority Service Tests (Week 1)
  - Refactor 6 service test files to mock Models instead of CacheableDataAccess
  - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 1.1 Refactor templates-service.test.js
    - Update mock setup to mock Models.S3Templates at module level
    - Update beforeEach() to include jest.clearAllMocks() and Config mocks
    - Update test assertions to verify Models.S3Templates.list/get/listVersions calls
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file: `npm test -- tests/unit/services/templates-service.test.js`
    - Verify all tests pass and execution time < 5 seconds
    - _Requirements: 2.2, 4.1, 4.4, 4.5_

  - [x] 1.2 Refactor templates-error-handling.test.js
    - Verify this file already follows correct pattern (reference implementation)
    - Update if needed to match new pattern templates
    - Ensure Models.S3Templates methods are mocked to throw errors
    - Verify error handling assertions are correct
    - Run test file to confirm it passes
    - _Requirements: 4.6, 11.1_

  - [x] 1.3 Refactor starters-service.test.js
    - Update mock setup to mock Models.S3Starters and Models.GitHubAPI
    - Update beforeEach() to include jest.clearAllMocks() and Config mocks
    - Update test assertions to verify both S3Starters and GitHubAPI calls
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file: `npm test -- tests/unit/services/starters-service.test.js`
    - _Requirements: 2.4, 4.2, 4.4, 4.5_

  - [x] 1.4 Refactor starters-cache-data-integration.test.js
    - Update to mock Models.S3Starters and Models.GitHubAPI
    - Update test assertions to verify data aggregation from multiple sources
    - Remove CacheableDataAccess.getData() mocks
    - Run test file to verify multi-source data handling
    - _Requirements: 2.4, 4.2, 7.2, 7.3_

  - [x] 1.5 Refactor starters-cloudfront-integration.test.js
    - Update to mock Models.S3Starters
    - Update test assertions to verify CloudFront URL handling
    - Remove CacheableDataAccess.getData() mocks
    - Run test file to verify CloudFront integration
    - _Requirements: 2.4, 4.2_

  - [x] 1.6 Refactor documentation-service.test.js
    - Update mock setup to mock Models.DocIndex
    - Update beforeEach() to include jest.clearAllMocks() and Config mocks
    - Update test assertions to verify Models.DocIndex.get calls
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file: `npm test -- tests/unit/services/documentation-service.test.js`
    - _Requirements: 4.3, 4.4, 4.5_

  - [x] 1.7 Phase 1 Checkpoint - Verify all service tests pass
    - Run all service tests: `npm test -- tests/unit/services/`
    - Verify zero failing tests in service layer
    - Verify test execution time reasonable (< 30 seconds total)
    - Verify no CacheableDataAccess.getData() mocks remain
    - Commit changes with message: "refactor: Phase 1 - Update service tests to mock Models directly"
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 2. Phase 2: Refactor High Priority Controller Tests (Week 1-2)
  - Refactor 6 controller test files to mock Services instead of CacheableDataAccess
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 2.1 Refactor templates-controller.test.js
    - Update mock setup to mock Services.Templates at module level
    - Update beforeEach() to include jest.clearAllMocks()
    - Update test assertions to verify Services.Templates method calls
    - Verify input validation tests still work correctly
    - Verify MCP response formatting tests still work
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file: `npm test -- tests/unit/controllers/templates-controller.test.js`
    - _Requirements: 5.1, 5.4, 5.5, 5.6, 5.8_

  - [x] 2.2 Refactor starters-controller.test.js
    - Update mock setup to mock Services.Starters at module level
    - Update beforeEach() to include jest.clearAllMocks()
    - Update test assertions to verify Services.Starters method calls
    - Verify input validation and response formatting
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file: `npm test -- tests/unit/controllers/starters-controller.test.js`
    - _Requirements: 5.2, 5.4, 5.5, 5.6, 5.8_

  - [x] 2.3 Refactor documentation-controller.test.js
    - Update mock setup to mock Services.Documentation at module level
    - Update beforeEach() to include jest.clearAllMocks()
    - Update test assertions to verify Services.Documentation method calls
    - Verify input validation and response formatting
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file: `npm test -- tests/unit/controllers/documentation-controller.test.js`
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.8_

  - [x] 2.4 Refactor controller-error-handling.test.js
    - Update to mock Services methods to throw errors
    - Verify error handling assertions test service error propagation
    - Verify MCP error response formatting
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file to verify error handling
    - _Requirements: 5.7, 11.5_

  - [x] 2.5 Refactor json-schema-validation.test.js
    - Update to mock Services if needed
    - Verify schema validation tests work independently
    - Ensure validation logic is tested without cache complexity
    - Run test file to verify validation
    - _Requirements: 5.4_

  - [x] 2.6 Refactor validation-controller.test.js
    - Update to mock Services methods
    - Verify validation controller tests work correctly
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file to verify validation controller
    - _Requirements: 5.4_

  - [x] 2.7 Phase 2 Checkpoint - Verify all controller tests pass
    - Run all controller tests: `npm test -- tests/unit/controllers/`
    - Verify zero failing tests in controller layer
    - Verify test execution time reasonable (< 30 seconds total)
    - Verify Services.* functions are mocked, not CacheableDataAccess
    - Commit changes with message: "refactor: Phase 2 - Update controller tests to mock Services directly"
    - _Requirements: 11.1, 11.2, 11.3_

- [-] 3. Phase 3: Refactor Medium Priority DAO Tests (Week 2)
  - Verify and update 5 DAO test files to ensure only AWS SDK clients are mocked
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 3.1 Review and update s3-templates-dao.test.js
    - Verify S3Client is mocked using aws-sdk-client-mock
    - Verify no higher-level abstractions are mocked
    - Update beforeEach() to include s3Mock.reset() and jest.clearAllMocks()
    - Verify test assertions check AWS SDK command construction
    - Run test file: `npm test -- tests/unit/models/s3-templates-dao.test.js`
    - _Requirements: 6.1, 6.5, 6.6, 6.8_

  - [x] 3.2 Review and update s3-starters-dao.test.js
    - Verify S3Client is mocked using aws-sdk-client-mock
    - Verify no higher-level abstractions are mocked
    - Update beforeEach() to include s3Mock.reset() and jest.clearAllMocks()
    - Verify test assertions check AWS SDK command construction
    - Run test file: `npm test -- tests/unit/models/s3-starters-dao.test.js`
    - _Requirements: 6.2, 6.5, 6.6, 6.8_

  - [x] 3.3 Review and update github-api-dao.test.js
    - Verify fetch() or HTTP client is mocked appropriately
    - Verify no higher-level abstractions are mocked
    - Update beforeEach() to include jest.clearAllMocks()
    - Verify test assertions check API request construction
    - Run test file: `npm test -- tests/unit/models/github-api-dao.test.js`
    - _Requirements: 6.3, 6.6, 6.7, 6.8_

  - [x] 3.4 Review and update doc-index-dao.test.js
    - Verify DynamoDBClient is mocked using aws-sdk-client-mock
    - Verify no higher-level abstractions are mocked
    - Update beforeEach() to include ddbMock.reset() and jest.clearAllMocks()
    - Verify test assertions check DynamoDB command construction
    - Run test file: `npm test -- tests/unit/models/doc-index-dao.test.js`
    - _Requirements: 6.4, 6.5, 6.6, 6.8_

  - [x] 3.5 Review and update s3-templates-or-condition.test.js
    - Verify S3Client is mocked using aws-sdk-client-mock
    - Verify OR condition logic is tested correctly
    - Update beforeEach() to include s3Mock.reset() and jest.clearAllMocks()
    - Run test file to verify OR condition handling
    - _Requirements: 6.1, 6.5, 6.6_

  - [x] 3.6 Phase 3 Checkpoint - Verify all DAO tests pass
    - Run all DAO tests: `npm test -- tests/unit/models/`
    - Verify zero failing tests in DAO layer
    - Verify only AWS SDK clients are mocked
    - Verify test execution time reasonable (< 30 seconds total)
    - Commit changes with message: "refactor: Phase 3 - Verify DAO tests mock only AWS SDK clients"
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 4. Phase 4: Refactor Medium Priority Lambda Integration Tests (Week 2-3)
  - Refactor 6 Lambda integration test files to mock Services layer
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ] 4.1 Refactor read-handler.test.js
    - Update mock setup to mock Services.Templates, Services.Starters, Services.Documentation
    - Update beforeEach() to include jest.clearAllMocks() and Config.init mock
    - Update test assertions to verify Lambda handler routes requests correctly
    - Verify Routes.process delegation works
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file: `npm test -- tests/unit/lambda/read-handler.test.js`
    - _Requirements: 7.1, 7.5, 7.6, 7.7_

  - [ ] 4.2 Refactor multi-bucket-handling.test.js
    - Update to mock Models.S3Templates with multiple bucket responses
    - Update test assertions to verify multi-bucket aggregation
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file to verify multi-bucket handling
    - _Requirements: 7.2_

  - [ ] 4.3 Refactor multi-github-org-handling.test.js
    - Update to mock Models.GitHubAPI with multiple org responses
    - Update test assertions to verify multi-org aggregation
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file to verify multi-org handling
    - _Requirements: 7.3_

  - [ ] 4.4 Refactor error-handling.test.js (Lambda)
    - Update to mock Services methods to throw errors
    - Verify Lambda error handling and response formatting
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file to verify Lambda error handling
    - _Requirements: 7.4, 11.5_

  - [ ] 4.5 Refactor rate-limiting.test.js
    - Update to mock Services methods
    - Verify rate limiting logic works independently of cache
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file to verify rate limiting
    - _Requirements: 7.5_

  - [ ] 4.6 Refactor namespace-discovery.test.js
    - Update to mock Models methods for namespace discovery
    - Verify namespace discovery logic
    - Remove all CacheableDataAccess.getData() mocks
    - Run test file to verify namespace discovery
    - _Requirements: 7.1_

  - [ ] 4.7 Phase 4 Checkpoint - Verify all Lambda integration tests pass
    - Run all Lambda tests: `npm test -- tests/unit/lambda/`
    - Verify zero failing tests in Lambda layer
    - Verify Services.* functions are mocked
    - Verify test execution time reasonable (< 30 seconds total)
    - Commit changes with message: "refactor: Phase 4 - Update Lambda tests to mock Services directly"
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 5. Phase 5: Refactor Low Priority Integration and Performance Tests (Week 3)
  - Update 3 integration/performance test files
  - _Requirements: 1.1, 1.2, 1.3, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ] 5.1 Refactor caching-integration.test.js
    - Create separate integration tests for caching behavior
    - Test CacheableDataAccess.getData() with real fetch functions
    - Verify cache hits return cached data
    - Verify cache misses call fetch functions
    - Verify cache expiration works correctly
    - Label tests clearly as caching integration tests
    - Run test file: `npm test -- tests/integration/caching-integration.test.js`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ] 5.2 Refactor multi-source-integration.test.js
    - Update to test multi-source data aggregation
    - Mock appropriate layers for integration testing
    - Verify multi-bucket and multi-org scenarios
    - Run test file to verify multi-source integration
    - _Requirements: 7.2, 7.3_

  - [ ] 5.3 Refactor lambda-performance.test.js
    - Update to measure realistic Lambda execution time
    - Mock appropriate layers to simulate production
    - Verify performance tests measure actual business logic
    - Run test file to verify performance measurement
    - _Requirements: 11.3_

  - [ ] 5.4 Phase 5 Checkpoint - Verify all integration/performance tests pass
    - Run all integration tests: `npm test -- tests/integration/`
    - Run all performance tests: `npm test -- tests/performance/`
    - Verify zero failing tests
    - Verify integration tests clearly labeled
    - Commit changes with message: "refactor: Phase 5 - Update integration and performance tests"
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 6. Documentation and Final Verification
  - Create comprehensive documentation for new testing patterns
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ] 6.1 Create MIGRATION_GUIDE.md
    - Document step-by-step instructions for updating tests
    - Include before/after examples for each test type
    - Document common pitfalls and solutions
    - Include troubleshooting guide
    - Save to `.kiro/specs/0-0-1-test-strategy-refactor-bypass-cache-layer/MIGRATION_GUIDE.md`
    - _Requirements: 10.7_

  - [ ] 6.2 Create TESTING_PATTERNS.md
    - Document test pattern templates for each layer
    - Include mock setup examples for Controllers, Services, DAOs, Lambda
    - Document common assertions and best practices
    - Include quick reference guide
    - Save to `application-infrastructure/src/tests/TESTING_PATTERNS.md`
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ] 6.3 Update tests/README.md
    - Explain new testing strategy and rationale
    - Explain why CacheableDataAccess.getData() is not mocked
    - Link to TESTING_PATTERNS.md
    - Provide examples of each test type
    - Document test organization and execution commands
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ] 6.4 Final Checkpoint - Run full test suite
    - Run complete test suite: `npm test`
    - Verify zero failing tests (all 217 previously failing tests now pass)
    - Verify test execution time < 5 minutes
    - Verify test coverage maintained or improved
    - Verify no console errors or warnings
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 6.5 Final Checkpoint - Verify CI/CD pipeline
    - Push changes to test branch
    - Verify CI/CD pipeline runs successfully
    - Verify all tests pass in CI/CD environment
    - Verify no flaky tests
    - _Requirements: 11.2, 11.4_

  - [ ] 6.6 Final Checkpoint - Code review and merge
    - Create pull request with all changes
    - Request code review from team
    - Address review feedback
    - Merge to main branch after approval
    - _Requirements: 11.1, 11.2_

## Notes

- Each phase builds on the previous phase - complete phases in order
- Run tests after each file update to catch issues early
- Use verification checklist after each file (see design document)
- Commit after each successful phase to enable easy rollback
- If more than 3 files in a phase fail, pause and reassess approach
- Production code (services layer) continues using CacheableDataAccess.getData() for caching
- Only test files are modified - no changes to production service interfaces
- Test pattern templates are provided in design document for reference
- Mock setup must be at module level before imports
- Always include jest.clearAllMocks() in beforeEach()
- Verify both function calls (with correct parameters) and results in assertions
