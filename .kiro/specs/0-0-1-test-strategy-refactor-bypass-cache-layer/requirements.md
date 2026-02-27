# Requirements Document

## Introduction

This document defines requirements for refactoring the test strategy in the atlantis-mcp project to simplify testing by bypassing the CacheableDataAccess.getData() layer and testing fetch functions directly. The current approach of mocking CacheableDataAccess.getData() is complex, brittle, and has resulted in 217 failing tests across 26 test files after a Config refactoring.

## Glossary

- **CacheableDataAccess**: External class from @63klabs/cache-data package that provides caching wrapper functionality
- **Fetch_Function**: Business logic functions that retrieve data (e.g., S3Templates.list, S3Templates.get, GitHubAPI.fetchRepositories)
- **Service_Layer**: Business logic layer that orchestrates data access through CacheableDataAccess.getData()
- **DAO_Layer**: Data Access Object layer containing fetch functions that interact with AWS services
- **Test_Subject**: The actual business logic being tested (fetch functions, not caching mechanism)
- **Cache_Layer**: The CacheableDataAccess.getData() wrapper that handles caching logic
- **Mock_Complexity**: The difficulty and brittleness of mocking CacheableDataAccess.getData() behavior
- **Direct_Testing**: Testing fetch functions by calling them directly without going through the cache layer

## Requirements

### Requirement 1: Simplify Test Strategy

**User Story:** As a developer, I want to test business logic directly without mocking complex caching mechanisms, so that tests are simpler, more maintainable, and focus on actual functionality.

#### Acceptance Criteria

1. WHEN testing service layer functions, THE Test_Suite SHALL call DAO fetch functions directly
2. WHEN testing DAO layer functions, THE Test_Suite SHALL mock only AWS SDK clients (S3Client, DynamoDBClient)
3. THE Test_Suite SHALL NOT mock CacheableDataAccess.getData() in unit tests
4. THE Test_Suite SHALL focus on testing business logic, not caching behavior
5. WHEN a fetch function is called directly, THE Test_Suite SHALL verify correct parameters are passed
6. WHEN a fetch function returns data, THE Test_Suite SHALL verify correct data transformation and filtering

### Requirement 2: Eliminate CacheableDataAccess.getData() Mocking

**User Story:** As a developer, I want to eliminate brittle mocks of CacheableDataAccess.getData(), so that Config refactorings don't break 217 tests.

#### Acceptance Criteria

1. THE Test_Suite SHALL NOT include jest.mock('@63klabs/cache-data') for CacheableDataAccess
2. WHEN testing Services.Templates.list(), THE Test_Suite SHALL mock Models.S3Templates.list() directly
3. WHEN testing Services.Templates.get(), THE Test_Suite SHALL mock Models.S3Templates.get() directly
4. WHEN testing Services.Starters.list(), THE Test_Suite SHALL mock Models.S3Starters.list() and Models.GitHubAPI.fetchRepositories() directly
5. THE Test_Suite SHALL NOT attempt to mock the caching mechanism's internal behavior
6. THE Test_Suite SHALL NOT need to understand cache profile structures or cache key generation

### Requirement 3: Test Fetch Functions Directly

**User Story:** As a developer, I want to test fetch functions with their actual signatures (connection, options), so that tests verify real function behavior.

#### Acceptance Criteria

1. WHEN testing S3Templates.list(), THE Test_Suite SHALL call S3Templates.list(connection, options) directly
2. WHEN testing S3Templates.get(), THE Test_Suite SHALL call S3Templates.get(connection, options) directly
3. WHEN testing GitHubAPI.fetchRepositories(), THE Test_Suite SHALL call GitHubAPI.fetchRepositories(connection, options) directly
4. THE Test_Suite SHALL mock AWS SDK clients (S3Client, DynamoDBClient) for DAO tests
5. THE Test_Suite SHALL verify fetch functions handle connection parameters correctly
6. THE Test_Suite SHALL verify fetch functions handle options parameters correctly
7. THE Test_Suite SHALL verify fetch functions return data in expected format

### Requirement 4: Update Service Layer Tests

**User Story:** As a developer, I want service layer tests to mock DAO functions directly, so that I can test service orchestration logic without cache complexity.

#### Acceptance Criteria

1. WHEN testing Templates service, THE Test_Suite SHALL mock Models.S3Templates methods
2. WHEN testing Starters service, THE Test_Suite SHALL mock Models.S3Starters and Models.GitHubAPI methods
3. WHEN testing Documentation service, THE Test_Suite SHALL mock Models.DocIndex methods
4. THE Test_Suite SHALL verify services call DAO methods with correct parameters
5. THE Test_Suite SHALL verify services transform DAO responses correctly
6. THE Test_Suite SHALL verify services handle DAO errors appropriately
7. THE Test_Suite SHALL NOT mock CacheableDataAccess.getData() in service tests

### Requirement 5: Update Controller Layer Tests

**User Story:** As a developer, I want controller layer tests to mock service functions directly, so that I can test request/response handling without cache or DAO complexity.

#### Acceptance Criteria

1. WHEN testing Templates controller, THE Test_Suite SHALL mock Services.Templates methods
2. WHEN testing Starters controller, THE Test_Suite SHALL mock Services.Starters methods
3. WHEN testing Documentation controller, THE Test_Suite SHALL mock Services.Documentation methods
4. THE Test_Suite SHALL verify controllers validate input correctly
5. THE Test_Suite SHALL verify controllers call services with correct parameters
6. THE Test_Suite SHALL verify controllers format responses correctly
7. THE Test_Suite SHALL verify controllers handle service errors appropriately
8. THE Test_Suite SHALL NOT mock CacheableDataAccess.getData() in controller tests

### Requirement 6: Update DAO Layer Tests

**User Story:** As a developer, I want DAO layer tests to mock only AWS SDK clients, so that I can test data access logic without external dependencies.

#### Acceptance Criteria

1. WHEN testing S3Templates DAO, THE Test_Suite SHALL mock S3Client using aws-sdk-client-mock
2. WHEN testing S3Starters DAO, THE Test_Suite SHALL mock S3Client using aws-sdk-client-mock
3. WHEN testing GitHubAPI DAO, THE Test_Suite SHALL mock fetch() or HTTP client
4. WHEN testing DocIndex DAO, THE Test_Suite SHALL mock DynamoDBClient using aws-sdk-client-mock
5. THE Test_Suite SHALL verify DAOs construct correct AWS SDK commands
6. THE Test_Suite SHALL verify DAOs handle AWS SDK responses correctly
7. THE Test_Suite SHALL verify DAOs handle AWS SDK errors appropriately
8. THE Test_Suite SHALL NOT mock CacheableDataAccess.getData() in DAO tests

### Requirement 7: Update Lambda Integration Tests

**User Story:** As a developer, I want Lambda integration tests to mock service layer functions, so that I can test Lambda handler logic without cache complexity.

#### Acceptance Criteria

1. WHEN testing read handler, THE Test_Suite SHALL mock Services.Templates, Services.Starters, Services.Documentation methods
2. WHEN testing multi-bucket handling, THE Test_Suite SHALL mock Models.S3Templates with multiple bucket responses
3. WHEN testing multi-org handling, THE Test_Suite SHALL mock Models.GitHubAPI with multiple org responses
4. WHEN testing error handling, THE Test_Suite SHALL mock service methods to throw errors
5. THE Test_Suite SHALL verify Lambda handler routes requests correctly
6. THE Test_Suite SHALL verify Lambda handler formats responses correctly
7. THE Test_Suite SHALL NOT mock CacheableDataAccess.getData() in Lambda tests

### Requirement 8: Preserve Caching Behavior in Production

**User Story:** As a developer, I want production code to continue using CacheableDataAccess.getData() for caching, so that performance benefits are maintained.

#### Acceptance Criteria

1. THE Service_Layer SHALL continue to use CacheableDataAccess.getData() in production code
2. THE Service_Layer SHALL pass fetch functions to CacheableDataAccess.getData() as callbacks
3. THE Service_Layer SHALL pass connection and cache profile to CacheableDataAccess.getData()
4. THE Production_Code SHALL NOT be modified to remove caching functionality
5. THE Production_Code SHALL maintain current caching behavior and performance characteristics
6. THE Test_Strategy SHALL test business logic independently of caching mechanism

### Requirement 9: Maintain Test Coverage

**User Story:** As a developer, I want to maintain or improve test coverage after refactoring, so that code quality is not reduced.

#### Acceptance Criteria

1. THE Test_Suite SHALL maintain at least current test coverage percentage
2. THE Test_Suite SHALL test all public methods in service layer
3. THE Test_Suite SHALL test all public methods in DAO layer
4. THE Test_Suite SHALL test all controller endpoints
5. THE Test_Suite SHALL test error handling paths
6. THE Test_Suite SHALL test edge cases and boundary conditions
7. THE Test_Suite SHALL include property-based tests where appropriate

### Requirement 10: Document New Testing Patterns

**User Story:** As a developer, I want clear documentation of the new testing patterns, so that future tests follow the same approach.

#### Acceptance Criteria

1. THE Documentation SHALL explain why CacheableDataAccess.getData() is not mocked
2. THE Documentation SHALL provide examples of testing service layer functions
3. THE Documentation SHALL provide examples of testing DAO layer functions
4. THE Documentation SHALL provide examples of testing controller layer functions
5. THE Documentation SHALL explain how to mock AWS SDK clients correctly
6. THE Documentation SHALL explain how to test fetch functions directly
7. THE Documentation SHALL include a migration guide for updating existing tests

### Requirement 11: Fix All 217 Failing Tests

**User Story:** As a developer, I want all 217 failing tests to pass after refactoring, so that the test suite is reliable and CI/CD can proceed.

#### Acceptance Criteria

1. WHEN the refactoring is complete, THE Test_Suite SHALL have zero failing tests
2. THE Test_Suite SHALL pass in CI/CD pipeline
3. THE Test_Suite SHALL execute in reasonable time (under 5 minutes)
4. THE Test_Suite SHALL not have flaky tests that fail intermittently
5. THE Test_Suite SHALL provide clear error messages when tests fail
6. THE Test_Suite SHALL be maintainable and easy to update when code changes

### Requirement 12: Separate Caching Tests

**User Story:** As a developer, I want separate integration tests for caching behavior, so that caching functionality is still validated.

#### Acceptance Criteria

1. WHERE caching behavior needs testing, THE Test_Suite SHALL create separate integration tests
2. THE Integration_Tests SHALL test CacheableDataAccess.getData() with real fetch functions
3. THE Integration_Tests SHALL verify cache hits return cached data
4. THE Integration_Tests SHALL verify cache misses call fetch functions
5. THE Integration_Tests SHALL verify cache expiration works correctly
6. THE Integration_Tests SHALL be clearly labeled as caching integration tests
7. THE Unit_Tests SHALL NOT test caching behavior

