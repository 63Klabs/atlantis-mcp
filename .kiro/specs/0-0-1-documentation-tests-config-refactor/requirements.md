# Requirements Document

## Introduction

This specification defines requirements for documenting, testing, and refactoring the configuration and settings changes made to align the Atlantis MCP Server Read Lambda with the @63klabs/cache-data package patterns. The recent updates introduced new configuration patterns including Config.settings() getter, Config.getConnCacheProfile() method, CachedSSMParameter for SSM Parameter Store access, and updated rate limiting functionality. This specification ensures these changes are properly documented, thoroughly tested, and code quality is maintained.

## Glossary

- **Config**: The configuration initialization module extending _ConfigSuperClass from @63klabs/cache-data
- **Settings**: Application configuration object containing S3, GitHub, cache, naming, and rate limit settings
- **Connections**: Connection and cache profile definitions for S3, GitHub API, and documentation index
- **CachedSSMParameter**: Tool from @63klabs/cache-data for accessing SSM Parameter Store with automatic refresh
- **Rate_Limiter**: Utility module for implementing per-IP or per-user rate limiting
- **SSM_Parameter_Store**: AWS Systems Manager Parameter Store for storing configuration parameters
- **Cache_Profile**: Configuration defining caching behavior including TTL, encryption, and refresh strategy
- **Connection_Profile**: Configuration defining connection details and associated cache profiles
- **JSDoc**: JavaScript documentation format using special comment syntax
- **Test_Harness**: Pattern for exposing private classes and methods for testing purposes

## Requirements

### Requirement 1: Document Configuration Module

**User Story:** As a developer, I want comprehensive documentation for the Config module, so that I can understand how to initialize and use the configuration system.

#### Acceptance Criteria

1. THE Config_Module SHALL have complete JSDoc documentation for all public methods
2. THE Config.init() method SHALL document all initialization steps including Cache.init(), ClientRequest.init(), Response.init(), and Connections initialization
3. THE Config.prime() method SHALL document the purpose of priming CacheableDataAccess and CachedParameterSecrets
4. THE Config.settings() getter SHALL document the return type and structure of the settings object
5. THE Config.getConnCacheProfile() method SHALL document parameters and return values for accessing connection and cache profiles
6. THE buildDocumentationIndexAsync() function SHALL document its async, non-blocking behavior
7. THE Config_Module documentation SHALL include examples showing typical initialization patterns
8. THE Config_Module documentation SHALL reference the @63klabs/cache-data package for inherited functionality

### Requirement 2: Document Settings Module

**User Story:** As a developer, I want comprehensive documentation for the settings module, so that I can understand all configuration options and their purposes.

#### Acceptance Criteria

1. THE Settings_Module SHALL have complete JSDoc documentation for all exported properties
2. THE settings.s3 object SHALL document buckets array, templatePrefix, and starterPrefix properties
3. THE settings.github object SHALL document token (CachedSSMParameter), userOrgs, repositoryTypeProperty, and validRepositoryTypes
4. THE settings.cache.ttl object SHALL document all TTL properties with their default values and purposes
5. THE settings.naming object SHALL document all naming patterns and parameters
6. THE settings.templates object SHALL document categories array and helper methods
7. THE settings.rateLimits object SHALL document public, registered, paid, and private rate limit configurations
8. THE parseCommaSeparated() function SHALL document its purpose for parsing environment variables
9. THE parseTTL() function SHALL document validation logic and default value handling
10. THE validateSettings() function SHALL document configuration validation warnings

### Requirement 3: Document Connections Module

**User Story:** As a developer, I want comprehensive documentation for the connections module, so that I can understand connection and cache profile configurations.

#### Acceptance Criteria

1. THE Connections_Module SHALL have complete JSDoc documentation for the connections array structure
2. EACH connection object SHALL document name, host, path, and cache array properties
3. EACH cache profile SHALL document profile, overrideOriginHeaderExpiration, defaultExpirationInSeconds, expirationIsOnInterval, headersToRetain, hostId, pathId, and encrypt properties
4. THE s3-templates connection SHALL document all cache profiles: templates-list, template-detail, template-versions, template-updates
5. THE s3-app-starters connection SHALL document all cache profiles: starters-list, starter-detail
6. THE github-api connection SHALL document all cache profiles: repo-metadata, repo-properties, repo-readme, repo-releases
7. THE documentation-index connection SHALL document all cache profiles: doc-index, code-patterns, doc-search
8. THE Connections_Module SHALL document the difference between production and test TTL values
9. THE Connections_Module SHALL document why host is null for S3 connections (set dynamically in services)

### Requirement 4: Document Rate Limiter Module

**User Story:** As a developer, I want comprehensive documentation for the rate limiter module, so that I can understand rate limiting implementation and future extensibility.

#### Acceptance Criteria

1. THE Rate_Limiter_Module SHALL have complete JSDoc documentation for all exported functions
2. THE checkRateLimit() function SHALL document event parameter structure, limits parameter structure, and return value structure
3. THE createRateLimitResponse() function SHALL document the 429 response format
4. THE getRateLimitStats() function SHALL document monitoring and debugging usage
5. THE getRateLimitData() function SHALL document the rate limit data structure
6. THE incrementRequestCount() function SHALL document request count tracking
7. THE cleanupExpiredEntries() function SHALL document expired entry cleanup logic
8. THE Rate_Limiter_Module SHALL document the in-memory store limitation and future DynamoDB migration plan
9. THE Rate_Limiter_Module SHALL document support for different rate plans (public, registered, paid, private)
10. THE Rate_Limiter_Module SHALL document the use of IP address or user ID for rate limit tracking

### Requirement 5: Document SSM Parameter Naming Convention

**User Story:** As a developer, I want clear documentation of SSM parameter naming conventions, so that I can correctly reference parameters in configuration.

#### Acceptance Criteria

1. THE Documentation SHALL define the SSM parameter naming pattern: PARAM_STORE_PATH + ParameterName
2. THE Documentation SHALL document the CacheData_SecureDataKey parameter usage
3. THE Documentation SHALL document the GitHubToken parameter usage and migration from GitHubTokenParameter
4. THE Documentation SHALL provide examples of CachedSSMParameter instantiation with refresh intervals
5. THE Documentation SHALL document the refreshAfter option for CachedSSMParameter (default and custom values)
6. THE Documentation SHALL document the difference between parameters that refresh and those that don't
7. THE Documentation SHALL reference the @63klabs/cache-data CachedSSMParameter documentation

### Requirement 6: Create Config Module Tests

**User Story:** As a developer, I want comprehensive tests for the Config module, so that I can verify initialization and configuration access work correctly.

#### Acceptance Criteria

1. THE Config_Tests SHALL verify Config.init() completes successfully
2. THE Config_Tests SHALL verify Config.promise() resolves after initialization
3. THE Config_Tests SHALL verify Config.prime() completes all priming tasks
4. THE Config_Tests SHALL verify Config.settings() returns the settings object
5. THE Config_Tests SHALL verify Config.getConnCacheProfile() returns correct connection and cache profiles
6. THE Config_Tests SHALL verify Cache.init() is called with correct parameters
7. THE Config_Tests SHALL verify ClientRequest.init() is called
8. THE Config_Tests SHALL verify Response.init() is called with settings
9. THE Config_Tests SHALL verify Connections is instantiated with connections array
10. THE Config_Tests SHALL verify buildDocumentationIndexAsync() is called asynchronously

### Requirement 7: Create Settings Module Tests

**User Story:** As a developer, I want comprehensive tests for the settings module, so that I can verify configuration parsing and validation work correctly.

#### Acceptance Criteria

1. THE Settings_Tests SHALL verify parseCommaSeparated() correctly parses comma-delimited environment variables
2. THE Settings_Tests SHALL verify parseCommaSeparated() handles empty strings and returns default values
3. THE Settings_Tests SHALL verify parseTTL() correctly parses numeric TTL values
4. THE Settings_Tests SHALL verify parseTTL() handles invalid values and returns defaults
5. THE Settings_Tests SHALL verify parseTTL() rejects negative values
6. THE Settings_Tests SHALL verify settings.s3.buckets is parsed from ATLANTIS_S3_BUCKETS
7. THE Settings_Tests SHALL verify settings.github.userOrgs is parsed from ATLANTIS_GITHUB_USER_ORGS
8. THE Settings_Tests SHALL verify settings.cache.ttl values are parsed from environment variables
9. THE Settings_Tests SHALL verify settings.rateLimits values are parsed from environment variables
10. THE Settings_Tests SHALL verify validateSettings() logs warnings for missing configuration

### Requirement 8: Create Connections Module Tests

**User Story:** As a developer, I want comprehensive tests for the connections module, so that I can verify connection and cache profile configurations are correct.

#### Acceptance Criteria

1. THE Connections_Tests SHALL verify connections array contains all expected connections
2. THE Connections_Tests SHALL verify s3-templates connection has correct cache profiles
3. THE Connections_Tests SHALL verify s3-app-starters connection has correct cache profiles
4. THE Connections_Tests SHALL verify github-api connection has correct cache profiles
5. THE Connections_Tests SHALL verify documentation-index connection has correct cache profiles
6. THE Connections_Tests SHALL verify production TTL values are longer than test TTL values
7. THE Connections_Tests SHALL verify all cache profiles have required properties
8. THE Connections_Tests SHALL verify hostId and pathId are unique within each connection
9. THE Connections_Tests SHALL verify expirationIsOnInterval is set correctly for each profile
10. THE Connections_Tests SHALL verify encrypt flag is set correctly for each profile

### Requirement 9: Create Rate Limiter Tests

**User Story:** As a developer, I want comprehensive tests for the rate limiter module, so that I can verify rate limiting logic works correctly.

#### Acceptance Criteria

1. THE Rate_Limiter_Tests SHALL verify checkRateLimit() allows requests under the limit
2. THE Rate_Limiter_Tests SHALL verify checkRateLimit() blocks requests over the limit
3. THE Rate_Limiter_Tests SHALL verify checkRateLimit() returns correct rate limit headers
4. THE Rate_Limiter_Tests SHALL verify checkRateLimit() calculates correct Retry-After values
5. THE Rate_Limiter_Tests SHALL verify incrementRequestCount() increments the count correctly
6. THE Rate_Limiter_Tests SHALL verify getRateLimitData() initializes new entries correctly
7. THE Rate_Limiter_Tests SHALL verify getRateLimitData() resets expired entries
8. THE Rate_Limiter_Tests SHALL verify cleanupExpiredEntries() removes expired entries
9. THE Rate_Limiter_Tests SHALL verify createRateLimitResponse() returns correct 429 response
10. THE Rate_Limiter_Tests SHALL verify getRateLimitStats() returns correct statistics
11. THE Rate_Limiter_Tests SHALL verify rate limits reset after the time window expires
12. THE Rate_Limiter_Tests SHALL verify different rate limits for public, registered, paid, and private plans

### Requirement 10: Create Property-Based Tests for Rate Limiter

**User Story:** As a developer, I want property-based tests for the rate limiter, so that I can verify rate limiting properties hold for arbitrary inputs.

#### Acceptance Criteria

1. WHEN arbitrary IP addresses are provided, THE Rate_Limiter SHALL track each IP independently
2. WHEN arbitrary request counts are generated, THE Rate_Limiter SHALL correctly enforce limits
3. WHEN arbitrary time windows are provided, THE Rate_Limiter SHALL correctly calculate reset times
4. WHEN arbitrary rate limits are provided, THE Rate_Limiter SHALL correctly enforce those limits
5. FOR ALL valid IP addresses, rate limit data SHALL be initialized correctly
6. FOR ALL expired entries, cleanup SHALL remove them from the store
7. FOR ALL requests under the limit, remaining count SHALL decrease correctly
8. FOR ALL requests over the limit, Retry-After SHALL be calculated correctly

### Requirement 11: Refactor Handler Code Quality

**User Story:** As a developer, I want clean, maintainable handler code, so that I can easily understand and modify the Lambda function.

#### Acceptance Criteria

1. THE Handler SHALL remove unused imports (Response, response variable)
2. THE Handler SHALL fix variable shadowing issues (response declared twice)
3. THE Handler SHALL extract error handling logic to ErrorHandler module
4. THE Handler SHALL extract metric emission logic to separate functions
5. THE Handler SHALL simplify rate limit response creation
6. THE Handler SHALL add proper JSDoc documentation for all sections
7. THE Handler SHALL use consistent naming conventions (camelCase for variables)
8. THE Handler SHALL remove TODO comments or convert them to tracked issues
9. THE Handler SHALL ensure all code paths return proper API Gateway responses
10. THE Handler SHALL verify all error cases are handled correctly

### Requirement 12: Update References from GitHubTokenParameter to GitHubToken

**User Story:** As a developer, I want consistent naming for SSM parameters, so that I can easily understand parameter purposes.

#### Acceptance Criteria

1. THE Template.yml SHALL use GitHubToken as the parameter name (not GitHubTokenParameter)
2. THE Settings_Module SHALL reference GitHubToken in CachedSSMParameter instantiation
3. THE Documentation SHALL use GitHubToken consistently
4. THE Environment_Variables SHALL use PARAM_STORE_PATH + GitHubToken pattern
5. THE Comments SHALL reference GitHubToken (not GitHubTokenParameter)
6. THE Examples SHALL use GitHubToken in sample code
7. THE Migration_Guide SHALL document the naming change from GitHubTokenParameter to GitHubToken

### Requirement 13: Create Integration Tests for Config System

**User Story:** As a developer, I want integration tests for the config system, so that I can verify all components work together correctly.

#### Acceptance Criteria

1. THE Integration_Tests SHALL verify Config.init() initializes all components in correct order
2. THE Integration_Tests SHALL verify Config.settings() returns settings after initialization
3. THE Integration_Tests SHALL verify Config.getConnCacheProfile() returns profiles after initialization
4. THE Integration_Tests SHALL verify CachedSSMParameter retrieves values from SSM Parameter Store
5. THE Integration_Tests SHALL verify Cache.init() uses CachedSSMParameter for secureDataKey
6. THE Integration_Tests SHALL verify Connections are accessible after initialization
7. THE Integration_Tests SHALL verify priming completes before handler processes requests
8. THE Integration_Tests SHALL verify cold start initialization timing is logged
9. THE Integration_Tests SHALL verify error handling during initialization
10. THE Integration_Tests SHALL verify initialization is idempotent (can be called multiple times safely)

### Requirement 14: Create User Documentation for Config Patterns

**User Story:** As a developer using this codebase, I want clear user documentation for config patterns, so that I can implement similar patterns in other Lambda functions.

#### Acceptance Criteria

1. THE User_Documentation SHALL explain the Config.init() pattern and when to call it
2. THE User_Documentation SHALL explain the Config.prime() pattern and its purpose
3. THE User_Documentation SHALL explain the Config.settings() getter pattern
4. THE User_Documentation SHALL explain the Config.getConnCacheProfile() method usage
5. THE User_Documentation SHALL provide examples of CachedSSMParameter usage
6. THE User_Documentation SHALL explain the difference between init() and prime()
7. THE User_Documentation SHALL explain cold start optimization patterns
8. THE User_Documentation SHALL provide examples of connection and cache profile configuration
9. THE User_Documentation SHALL explain rate limiting configuration and usage
10. THE User_Documentation SHALL provide troubleshooting guidance for common configuration issues

### Requirement 15: Create Technical Documentation for Config Architecture

**User Story:** As a maintainer, I want technical documentation for config architecture, so that I can understand implementation details and make informed changes.

#### Acceptance Criteria

1. THE Technical_Documentation SHALL explain the _ConfigSuperClass extension pattern
2. THE Technical_Documentation SHALL explain the promise-based initialization pattern
3. THE Technical_Documentation SHALL explain the priming pattern for async dependencies
4. THE Technical_Documentation SHALL explain the Timer usage for cold start logging
5. THE Technical_Documentation SHALL explain the CachedSSMParameter refresh mechanism
6. THE Technical_Documentation SHALL explain the Connections class usage
7. THE Technical_Documentation SHALL explain the settings validation pattern
8. THE Technical_Documentation SHALL explain the environment variable parsing patterns
9. THE Technical_Documentation SHALL explain the rate limiter in-memory store and future migration to DynamoDB
10. THE Technical_Documentation SHALL provide architecture diagrams showing component relationships

### Requirement 16: Implement TestHarness for Private Classes

**User Story:** As a developer writing tests, I want access to private classes for testing, so that I can verify internal implementation without exposing them in the public API.

#### Acceptance Criteria

1. IF the Config module has private classes, THEN THE Config_Module SHALL implement TestHarness.getInternals()
2. IF the Settings module has private functions, THEN THE Settings_Module SHALL implement TestHarness.getInternals()
3. IF the Connections module has private classes, THEN THE Connections_Module SHALL implement TestHarness.getInternals()
4. IF the Rate_Limiter module has private functions, THEN THE Rate_Limiter_Module SHALL implement TestHarness.getInternals()
5. THE TestHarness classes SHALL include JSDoc with @private tag and production warning
6. THE TestHarness.getInternals() methods SHALL document returned object structure
7. THE TestHarness classes SHALL be exported alongside public classes
8. THE Tests SHALL use TestHarness.getInternals() to access private classes
9. THE Tests SHALL restore mocked methods after each test
10. THE User_Documentation SHALL NOT mention TestHarness (testing-only interface)

### Requirement 17: Validate Documentation Accuracy

**User Story:** As a developer, I want accurate documentation that matches implementation, so that I can trust the documentation when using the code.

#### Acceptance Criteria

1. THE Documentation_Validation_Tests SHALL verify all documented parameters exist in function signatures
2. THE Documentation_Validation_Tests SHALL verify all documented return types match actual return values
3. THE Documentation_Validation_Tests SHALL verify all documented examples execute without errors
4. THE Documentation_Validation_Tests SHALL verify all documented error types are actually thrown
5. THE Documentation_Validation_Tests SHALL verify all documented properties exist in objects
6. THE Documentation_Validation_Tests SHALL verify all JSDoc @param names match function parameter names
7. THE Documentation_Validation_Tests SHALL verify all JSDoc @returns descriptions match actual behavior
8. THE Documentation_Validation_Tests SHALL verify all JSDoc @example code is syntactically correct
9. THE Documentation_Validation_Tests SHALL verify all internal links in documentation resolve correctly
10. THE Documentation_Validation_Tests SHALL verify no hallucinated features are documented

### Requirement 18: Create Migration Guide for Config Changes

**User Story:** As a developer maintaining other Lambda functions, I want a migration guide for config changes, so that I can update other functions to use the new patterns.

#### Acceptance Criteria

1. THE Migration_Guide SHALL document the change from direct settings access to Config.settings()
2. THE Migration_Guide SHALL document the change from GitHubTokenParameter to GitHubToken
3. THE Migration_Guide SHALL document the change to CachedSSMParameter usage
4. THE Migration_Guide SHALL document the change to Config.getConnCacheProfile() method
5. THE Migration_Guide SHALL provide before/after code examples for each change
6. THE Migration_Guide SHALL document breaking changes and compatibility considerations
7. THE Migration_Guide SHALL document the timeline for deprecating old patterns
8. THE Migration_Guide SHALL provide troubleshooting guidance for migration issues
9. THE Migration_Guide SHALL document testing strategies for verifying migrations
10. THE Migration_Guide SHALL document rollback procedures if migrations fail

### Requirement 19: Implement Code Quality Improvements

**User Story:** As a developer, I want high-quality, maintainable code, so that I can easily understand and modify the codebase.

#### Acceptance Criteria

1. THE Codebase SHALL have no unused imports or variables
2. THE Codebase SHALL have no variable shadowing issues
3. THE Codebase SHALL have consistent naming conventions (camelCase for variables, PascalCase for classes)
4. THE Codebase SHALL have no TODO comments without corresponding tracked issues
5. THE Codebase SHALL have proper error handling for all async operations
6. THE Codebase SHALL have proper JSDoc documentation for all public functions and classes
7. THE Codebase SHALL have no magic numbers (use named constants)
8. THE Codebase SHALL have no deeply nested code (max 3 levels)
9. THE Codebase SHALL have no functions longer than 50 lines (extract helper functions)
10. THE Codebase SHALL pass all linting rules without warnings

### Requirement 20: Create Round-Trip Property Tests for Config Serialization

**User Story:** As a developer, I want property-based tests for config serialization, so that I can verify config data can be serialized and deserialized correctly.

#### Acceptance Criteria

1. FOR ALL valid settings objects, serializing then deserializing SHALL produce equivalent objects
2. FOR ALL valid connection objects, serializing then deserializing SHALL produce equivalent objects
3. FOR ALL valid cache profile objects, serializing then deserializing SHALL produce equivalent objects
4. FOR ALL valid rate limit configurations, serializing then deserializing SHALL produce equivalent objects
5. THE Round_Trip_Tests SHALL verify no data loss during serialization
6. THE Round_Trip_Tests SHALL verify type preservation during serialization
7. THE Round_Trip_Tests SHALL verify nested object structure preservation
8. THE Round_Trip_Tests SHALL verify array order preservation
9. THE Round_Trip_Tests SHALL verify special values (null, undefined, NaN) are handled correctly
10. THE Round_Trip_Tests SHALL verify CachedSSMParameter objects are not serialized (runtime-only)

