# Implementation Plan: Documentation, Tests, and Config Refactor

## Overview

This implementation plan updates existing documentation, tests, and code to reflect the new configuration patterns introduced when aligning the Atlantis MCP Server Read Lambda with the @63klabs/cache-data package. The updates ensure consistency across all documentation, test code, and implementation code.

## Tasks

- [x] 1. Phase 1: Documentation Updates - Parameter Naming
  - [x] 1.1 Create documentation update automation script
    - Create scripts/update-documentation.js with dry-run capability
    - Define update patterns for GitHubTokenParameter → GitHubToken
    - Include summary report generation
    - _Requirements: 1.1-1.9, 2.1-2.5_
  
  - [x] 1.2 Update deployment documentation files (9 files)
    - Update docs/deployment/github-token-setup.md
    - Update docs/deployment/multiple-github-orgs.md
    - Update docs/deployment/README.md
    - Update docs/deployment/self-hosting.md
    - Update docs/deployment/cloudformation-parameters.md
    - Update docs/application-infrastructure/deployment/sam-deployment-guide.md
    - Update docs/application-infrastructure/deployment/pipeline-configuration.md
    - Update docs/application-infrastructure/security/security-validation-report.md
    - Verify PARAM_STORE_PATH + 'GitHubToken' pattern is consistent
    - _Requirements: 1.1-1.9_
  
  - [x] 1.3 Update spec documentation files (4 files)
    - Update .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/tasks.md
    - Update .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/requirements.md
    - Update .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/design.md
    - Update .kiro/specs/0-0-1-remove-api-key-requirement/design.md
    - _Requirements: 2.1-2.5_
  
  - [x] 1.4 Manual review and verification of documentation changes
    - Review all changes with git diff
    - Verify context accuracy for each change
    - Ensure code examples are updated correctly
    - Commit documentation updates with clear message
    - _Requirements: 1.1-1.9, 2.1-2.5_

- [x] 2. Phase 2: Test Code Updates
  - [x] 2.1 Search and identify test files needing updates
    - Find all test files in application-infrastructure/src
    - Find all test files in test directory
    - Identify tests with direct settings imports
    - Identify tests mocking settings module
    - Identify tests accessing connections directly
    - _Requirements: 3.1-3.8_
  
  - [x] 2.2 Update existing test patterns to use Config.settings()
    - Replace direct settings imports with Config.settings()
    - Update mocks to spy on Config.settings() getter
    - Update connection access to use Config.getConnCacheProfile()
    - Ensure Config.init() is called in test setup (beforeAll/beforeEach)
    - _Requirements: 3.1-3.8_
  
  - [ ]* 2.3 Create unit test for Config initialization precondition
    - Create test/config/config-initialization.jest.mjs
    - Test Config.settings() behavior before initialization
    - Test Config.getConnCacheProfile() requires initialization
    - Test Config.init() completes successfully
    - _Requirements: 3.3_
  
  - [ ]* 2.4 Create unit test for GitHub token type verification
    - Create test/config/config-settings-integration.jest.mjs
    - Test settings.github.token is CachedSSMParameter instance
    - Verify token instance has expected methods
    - _Requirements: 3.6_
  
  - [ ]* 2.5 Create unit test for rate limiter settings integration
    - Add test to config-settings-integration.jest.mjs
    - Test rate limiter accesses Config.settings().rateLimits
    - Verify rate limit structure is accessible
    - _Requirements: 3.7_
  
  - [ ]* 2.6 Create property-based test for connection profile retrieval
    - Create test/config/config-connection-profiles-property.jest.mjs
    - **Property 2: Connection Profile Retrieval**
    - **Validates: Requirements 3.5**
    - Test Config.getConnCacheProfile() with all valid connection/profile combinations
    - Verify returned profile structure has required properties
    - Use fast-check with 100 iterations
    - _Requirements: 3.5_
  
  - [x] 2.7 Run full test suite and verify all tests pass
    - Run npm test to execute all tests
    - Fix any test failures
    - Verify new tests pass
    - Commit test updates with clear message
    - _Requirements: 3.1-3.8_
  
  - [x] 2.8 Fix remaining test failures from Config refactoring
    - Fix service tests (starters, documentation, templates) with incorrect Config mocks
    - Update controller tests to properly mock Config.settings()
    - Fix cache scenario tests that need CacheableDataAccess.getData mocking
    - Fix brown-out support tests with missing GitHub token mocks
    - Fix multi-bucket handling tests with incomplete Config.settings() mocks
    - Ensure all tests use consistent Config mock pattern: `{ Config: { init, settings, getConnCacheProfile } }`
    - Run npm test after each batch of fixes to verify progress
    - Continue until all non-skipped tests pass
    - _Requirements: 3.1-3.8_

- [x] 3. Checkpoint - Verify documentation and tests updated
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Phase 3: JSDoc Documentation Updates
  - [x] 4.1 Update Config module JSDoc (application-infrastructure/src/lambda/read/config/index.js)
    - Add JSDoc for Config.init() with cold start explanation
    - Add JSDoc for Config.prime() cache priming
    - Note: Config.settings() and Config.getConnCacheProfile() inherited from _ConfigSuperClass
    - Verify no deprecated patterns in JSDoc
    - _Requirements: 4.1-4.2, 7.1-7.6_
  
  - [x] 4.2 Update Settings module JSDoc (application-infrastructure/src/lambda/read/config/settings.js)
    - Document settings.github.token as CachedSSMParameter
    - Remove any references to deprecated settings.aws.githubTokenParameter
    - Document rate limits structure
    - Document cache TTL structure
    - _Requirements: 4.3-4.4_
  
  - [x] 4.3 Update Connections module JSDoc (application-infrastructure/src/lambda/read/config/connections.js)
    - Document connections array structure
    - Document cache profile properties
    - Document dynamic host setting pattern
    - _Requirements: 4.5_
  
  - [x] 4.4 Update Rate Limiter JSDoc (application-infrastructure/src/lambda/read/utils/rate-limiter.js)
    - Document integration with Config.settings()
    - Document rate limit structure access
    - _Requirements: 4.6_
  
  - [x] 4.5 Update Handler JSDoc (application-infrastructure/src/lambda/read/index.js)
    - Document Config.init() call and cold start behavior
    - Document Config.prime() call
    - Document Config.settings() usage
    - Add comments explaining rate limiter integration with config
    - _Requirements: 4.7, 7.1-7.6_
  
  - [x] 4.6 Verify JSDoc accuracy across all modules
    - Check @param names match function signatures
    - Check @returns types match actual return values
    - Ensure @example code is executable
    - Verify no deprecated patterns in examples
    - Commit JSDoc updates with clear message
    - _Requirements: 4.1-4.8_

- [x] 5. Phase 4: Code Search and Refactor
  - [x] 5.1 Search for deprecated patterns in codebase
    - Search for direct settings imports (excluding config module)
    - Search for settings.aws.githubTokenParameter references
    - Search for old connection access patterns
    - Verify index-old.js is not imported anywhere
    - Document search results
    - _Requirements: 6.1-6.6_
  
  - [x] 5.2 Refactor code to use new Config patterns
    - Update direct settings imports to use Config.settings()
    - Update old parameter name references to new pattern
    - Update direct connections access to use Config.getConnCacheProfile()
    - Ensure no imports of index-old.js
    - _Requirements: 6.1-6.6_
  
  - [x] 5.3 Test refactored code
    - Run unit tests
    - Run integration tests
    - Verify no regressions
    - Commit refactored code with clear message
    - _Requirements: 6.1-6.6_

- [x] 6. Phase 5: Test Documentation Updates
  - [x] 6.1 Update test README with new patterns
    - Add section on Config.settings() testing patterns
    - Document how to mock Config.settings()
    - Document how to test CachedSSMParameter usage
    - Document integration test setup for config system
    - Add testing examples for new patterns
    - _Requirements: 5.1-5.6_
  
  - [x] 6.2 Update TESTING_SUMMARY.md (if exists)
    - Reflect current test coverage for config modules
    - Document new test cases added
    - Update test statistics
    - _Requirements: 5.5_
  
  - [x] 6.3 Commit test documentation updates
    - Verify documentation is clear and complete
    - Commit with clear message
    - _Requirements: 5.1-5.6_

- [-] 7. Phase 6: Link Validation and Repair
  - [x] 7.1 Create link validation automation script
    - Create scripts/validate-links.js
    - Scan for all markdown links
    - Check if link targets exist
    - Generate validation report
    - _Requirements: 8.1-8.5_
  
  - [x] 7.2 Run link validation and identify broken links
    - Execute link validation script
    - Review broken links report
    - Categorize link issues (moved files, wrong paths, etc.)
    - _Requirements: 8.1-8.3_
  
  - [x] 7.3 Fix broken documentation links
    - Update paths for moved files
    - Convert absolute paths to relative paths
    - Add missing file extensions
    - Remove links to deleted files
    - _Requirements: 8.1-8.5_
  
  - [-] 7.4 Verify link fixes and commit
    - Re-run link validation script
    - Verify all links work
    - Test links manually from source file locations
    - Commit link fixes with clear message
    - _Requirements: 8.1-8.5_

- [ ] 8. Phase 7: Final Verification and Summary
  - [ ] 8.1 Run full test suite verification
    - Run all unit tests
    - Run all integration tests
    - Run all property-based tests
    - Verify all tests pass
    - _Requirements: All_
  
  - [ ] 8.2 Review all documentation changes
    - Verify all 13 documentation files updated
    - Check consistent naming throughout
    - Verify all links work
    - Check code examples use current patterns
    - _Requirements: 1.1-1.9, 2.1-2.5_
  
  - [ ] 8.3 Review all code changes
    - Verify no deprecated patterns remain
    - Check JSDoc is accurate
    - Verify test code uses new patterns
    - Run final code quality checks
    - _Requirements: 3.1-3.8, 4.1-4.8, 6.1-6.6_
  
  - [ ] 8.4 Generate and review summary report
    - List all files updated
    - Document all changes made
    - Note any manual review items
    - Create final commit with comprehensive message
    - _Requirements: All_

## Notes

- Tasks marked with `*` are optional test-related sub-tasks and can be skipped for faster completion
- Each phase builds on the previous phase
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and implementation details
- All automation scripts include dry-run mode for safety
- Documentation updates use consistent patterns across all files
- Test updates ensure Config.init() is called before accessing settings
- JSDoc updates focus on accuracy and completeness
- Link validation ensures all documentation is navigable
- Final verification ensures all requirements are met
