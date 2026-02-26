# Requirements Document

## Introduction

This specification defines requirements for updating existing documentation and tests to reflect configuration and settings changes made to align the Atlantis MCP Server Read Lambda with the @63klabs/cache-data package patterns. The recent updates introduced new configuration patterns including Config.settings() getter, Config.getConnCacheProfile() method, and CachedSSMParameter for SSM Parameter Store access. This specification ensures that existing documentation, tests, and code references are updated to use the new patterns consistently.

## Glossary

- **Config**: The configuration initialization module extending _ConfigSuperClass from @63klabs/cache-data
- **Settings**: Application configuration object containing S3, GitHub, cache, naming, and rate limit settings
- **Connections**: Connection and cache profile definitions for S3, GitHub API, and documentation index
- **CachedSSMParameter**: Tool from @63klabs/cache-data for accessing SSM Parameter Store with automatic refresh
- **Rate_Limiter**: Utility module for implementing per-IP or per-user rate limiting
- **SSM_Parameter_Store**: AWS Systems Manager Parameter Store for storing configuration parameters
- **GitHubTokenParameter**: Old parameter name (deprecated) - should be updated to GitHubToken
- **GitHubToken**: New parameter name for GitHub access token in SSM Parameter Store
- **JSDoc**: JavaScript documentation format using special comment syntax

## Requirements

### Requirement 1: Update Documentation Files

**User Story:** As a developer, I want all documentation to use consistent parameter naming, so that I don't get confused by outdated references.

#### Acceptance Criteria

1. THE docs/deployment/github-token-setup.md SHALL use GitHubToken instead of GitHubTokenParameter
2. THE docs/deployment/multiple-github-orgs.md SHALL use GitHubToken instead of GitHubTokenParameter
3. THE docs/deployment/README.md SHALL use GitHubToken instead of GitHubTokenParameter
4. THE docs/deployment/self-hosting.md SHALL use GitHubToken instead of GitHubTokenParameter
5. THE docs/deployment/cloudformation-parameters.md SHALL use GitHubToken instead of GitHubTokenParameter
6. THE docs/application-infrastructure/deployment/sam-deployment-guide.md SHALL use GitHubToken instead of GitHubTokenParameter
7. THE docs/application-infrastructure/deployment/pipeline-configuration.md SHALL use GitHubToken instead of GitHubTokenParameter
8. THE docs/application-infrastructure/security/security-validation-report.md SHALL use GitHubToken instead of GitHubTokenParameter
9. ALL documentation SHALL consistently reference PARAM_STORE_PATH + 'GitHubToken' pattern

### Requirement 2: Update Spec Documentation

**User Story:** As a developer, I want spec documents to reflect current naming conventions, so that future work uses the correct patterns.

#### Acceptance Criteria

1. THE .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/tasks.md SHALL update GitHubTokenParameter references
2. THE .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/requirements.md SHALL update GitHubTokenParameter references
3. THE .kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/design.md SHALL update GitHubTokenParameter references
4. THE .kiro/specs/0-0-1-remove-api-key-requirement/design.md SHALL update GitHubTokenParameter references
5. ALL spec documents SHALL use GitHubToken consistently

### Requirement 3: Update Existing Tests to Use Config.settings()

**User Story:** As a developer, I want existing tests to use the new Config.settings() pattern, so that tests validate the current implementation.

#### Acceptance Criteria

1. THE existing tests SHALL be reviewed for direct settings imports
2. THE tests SHALL be updated to use Config.settings() instead of direct settings access where appropriate
3. THE tests SHALL verify Config.init() is called before accessing settings
4. THE tests SHALL mock Config.settings() instead of mocking settings module directly
5. THE integration tests SHALL verify Config.getConnCacheProfile() works correctly
6. THE tests SHALL verify CachedSSMParameter is used for GitHub token access
7. THE tests SHALL verify rate limiter uses the new settings structure
8. ALL test mocks SHALL reflect the current code structure

### Requirement 4: Verify JSDoc Documentation Matches Current Implementation

**User Story:** As a developer, I want JSDoc comments to accurately describe the current code, so that I can trust the inline documentation.

#### Acceptance Criteria

1. THE Config module JSDoc SHALL document Config.settings() getter
2. THE Config module JSDoc SHALL document Config.getConnCacheProfile() method
3. THE Settings module JSDoc SHALL document settings.github.token (CachedSSMParameter)
4. THE Settings module JSDoc SHALL NOT reference deprecated settings.aws.githubTokenParameter
5. THE Connections module JSDoc SHALL document the connections array structure
6. THE Rate Limiter JSDoc SHALL document the updated rate limit structure
7. THE Handler JSDoc SHALL document Config usage patterns
8. ALL JSDoc @param and @returns SHALL match actual function signatures

### Requirement 5: Update Test Documentation

**User Story:** As a developer, I want test documentation to reflect the current testing approach, so that I understand how to run and maintain tests.

#### Acceptance Criteria

1. THE application-infrastructure/src/tests/README.md SHALL document Config.settings() testing patterns
2. THE test documentation SHALL explain how to mock Config.settings()
3. THE test documentation SHALL explain how to test CachedSSMParameter usage
4. THE test documentation SHALL document integration test setup for config system
5. THE TESTING_SUMMARY.md SHALL reflect current test coverage for config modules
6. THE test documentation SHALL provide examples of testing with the new patterns

### Requirement 6: Find and Update Old Code Patterns

**User Story:** As a developer, I want all code to use the new config patterns consistently, so that there are no deprecated patterns in active code.

#### Acceptance Criteria

1. THE codebase SHALL be searched for any remaining direct settings imports (excluding config module itself)
2. THE codebase SHALL be searched for settings.aws.githubTokenParameter references
3. THE codebase SHALL be searched for old connection access patterns
4. ANY found deprecated patterns SHALL be updated to use Config.settings() or Config.getConnCacheProfile()
5. THE index-old.js file SHALL remain as reference but not be imported anywhere
6. THE search SHALL exclude node_modules, test fixtures, and archived files

### Requirement 7: Update Handler Code Documentation

**User Story:** As a developer, I want the Lambda handler to have clear documentation about config usage, so that I understand the initialization flow.

#### Acceptance Criteria

1. THE lambda/read/index.js SHALL have JSDoc documenting Config.init() call
2. THE handler SHALL have JSDoc documenting Config.prime() call
3. THE handler SHALL have JSDoc explaining cold start initialization
4. THE handler SHALL have JSDoc documenting Config.settings() usage
5. THE handler SHALL have comments explaining rate limiter integration with config
6. THE handler documentation SHALL reference the config module documentation

### Requirement 8: Validate All Documentation Links

**User Story:** As a developer, I want all documentation links to work, so that I can navigate between related documents.

#### Acceptance Criteria

1. THE documentation SHALL be scanned for broken internal links
2. THE documentation SHALL be scanned for references to moved or renamed files
3. ALL broken links SHALL be fixed to point to correct locations
4. THE documentation SHALL use relative paths for internal links
5. THE documentation SHALL verify links to config module files are correct

