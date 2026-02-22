# Implementation Plan: Atlantis MCP Server - Phase 1 (Core Read-Only)

## Overview

This implementation plan breaks down the Atlantis MCP Server Phase 1 into discrete, manageable tasks. The implementation follows the atlantis-starter-02 repository structure, replacing example code with MCP protocol implementation while maintaining the MVC pattern, caching strategy, and deployment workflows.

The implementation is organized into logical phases: project setup, core infrastructure, MCP tools implementation, testing, and deployment configuration. Each task includes specific requirements references and clear acceptance criteria.

## Programming Language

**Implementation Language**: JavaScript (Node.js 24.x)

All code will be written in JavaScript using Node.js 24.x runtime on arm64 architecture, following the atlantis-starter-02 patterns and using ES6+ features.

## Tasks

- [ ] 1. Project Setup and Foundation
  - Clone atlantis-starter-02 as base
  - Update project metadata and dependencies
  - Configure development environment
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Core Infrastructure Setup
  - [ ] 2.1 Update package.json with MCP dependencies
    - Add @modelcontextprotocol/sdk ^1.0.0
    - Add ajv ^8.12.0 for JSON Schema validation
    - Add js-yaml ^4.1.0 for CloudFormation parsing
    - Add fast-check ^3.15.0 for property-based testing
    - Update project name and description
    - _Requirements: 1.4, 11.1_

  - [ ] 2.2 Configure Lambda handler for MCP routing
    - Update src/index.js to support MCP protocol
    - Implement Config.init() await during cold start
    - Add error handling for top-level errors
    - Return API Gateway-compatible responses
    - _Requirements: 1.6, 2.6, 12.2_

  - [ ] 2.3 Create cache-data connections configuration
    - Create src/config/connections.js with s3-templates connection
    - Add github-api connection with cache profiles
    - Add documentation-index connection
    - Configure TTLs: 1hr/24hr prod, 5min test for templates
    - Configure TTLs: 30min prod, 5min test for GitHub
    - Configure TTLs: 6hr prod, 5min test for documentation
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [ ] 2.4 Update Config initialization
    - Modify src/config/index.js for async initialization
    - Load cache-data connections
    - Implement getConnection() helper
    - Add initialization promise caching
    - _Requirements: 1.4, 9.1_


- [ ] 3. MCP Protocol Implementation
  - [ ] 3.1 Create MCP protocol utilities
    - Create src/utils/mcp-protocol.js
    - Implement initializeMCPServer() using @modelcontextprotocol/sdk
    - Implement successResponse() formatter
    - Implement errorResponse() formatter
    - Register all 7 MCP tools with definitions
    - _Requirements: 11.1, 11.2, 11.4, 11.6_

  - [ ] 3.2 Create JSON Schema validator
    - Create src/utils/schema-validator.js
    - Define schemas for all 7 tools (list_templates, get_template, list_starters, get_starter_info, search_documentation, validate_naming, check_template_updates)
    - Implement validate() function using ajv
    - Return detailed validation errors
    - _Requirements: 11.3, 11.9, 11.10_

  - [ ] 3.3 Create MCP response view
    - Create src/views/mcp-response.js
    - Implement successResponse() with metadata
    - Implement errorResponse() with error codes
    - Include requestId, timestamp, cached flag
    - _Requirements: 11.4, 12.7_

  - [ ] 3.4 Create naming rules utility
    - Create src/utils/naming-rules.js
    - Implement parse() to extract components
    - Implement validatePrefix(), validateProjectId(), validateStageId()
    - Implement validateResource() with type-specific rules
    - Implement generateSuggestions() for invalid names
    - Support S3, DynamoDB, Lambda, CloudFormation types
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.8, 7.9_

- [ ] 4. Router Implementation
  - [ ] 4.1 Update routing logic
    - Modify src/routes/index.js for MCP tool routing
    - Extract tool name from request body or query params
    - Implement switch statement for 7 tools
    - Handle 404 for unknown tools
    - Return Response object
    - _Requirements: 2.6, 11.2_

- [ ] 5. Data Access Layer (Models/DAOs)
  - [ ] 5.1 Create S3 Templates DAO
    - Create src/models/s3-templates.js
    - Implement list() to list templates from S3
    - Implement get() to retrieve specific template
    - Parse CloudFormation YAML using js-yaml
    - Extract parameters, outputs, description
    - Filter by category and version
    - Use AWS SDK from cache-data tools
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.10_

  - [ ] 5.2 Create GitHub API DAO
    - Create src/models/github-api.js
    - Implement getRepository() for repo metadata
    - Implement getReadme() for README content
    - Implement getLatestRelease() for release info
    - Handle GitHub API rate limits gracefully
    - Return null for not found (not throw)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.9_

  - [ ] 5.3 Create Documentation Index DAO
    - Create src/models/doc-index.js
    - Implement build() to create searchable index
    - Use GitHub Search API for atlantis and atlantis-tutorials repos
    - Parse Markdown documents
    - Extract metadata (title, type, code examples)
    - Implement search() with relevance ranking
    - _Requirements: 6.1, 6.2, 6.7, 6.9_


- [ ] 6. Service Layer Implementation
  - [ ] 6.1 Create Templates Service
    - Create src/services/templates.js
    - Implement list() with cache-data pass-through caching
    - Implement get() with cache-data pass-through caching
    - Use s3-templates connection and cache profiles
    - Define fetch functions for cache misses
    - Transform DAO data into business objects
    - _Requirements: 4.1, 4.2, 4.9, 9.3_

  - [ ] 6.2 Create Starters Service
    - Create src/services/starters.js
    - Implement list() with caching
    - Implement get() with caching
    - Retrieve starter info from S3 and GitHub
    - Indicate cache-data and CloudFront integration
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.10, 9.4_

  - [ ] 6.3 Create Documentation Service
    - Create src/services/documentation.js
    - Implement search() with caching
    - Build documentation index on startup (async)
    - Implement relevance ranking algorithm
    - Extract excerpts and code examples
    - Support filtering by type
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 9.5_

  - [ ] 6.4 Create GitHub Service
    - Create src/services/github.js
    - Implement getRepoMetadata() with caching
    - Implement getReadme() with caching
    - Implement getLatestRelease() with caching
    - Handle GitHub API errors gracefully
    - Return cached data with staleness indicator on rate limit
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.7, 10.8, 10.9_

  - [ ] 6.5 Create Validation Service
    - Create src/services/validation.js
    - Implement validate() using naming-rules utility
    - Generate validation results with component breakdown
    - Generate suggestions for invalid names
    - Support partial name validation
    - _Requirements: 7.1, 7.2, 7.7, 7.8, 7.10_

- [ ] 7. Controller Layer Implementation
  - [ ] 7.1 Create Templates Controller
    - Create src/controllers/templates.js
    - Implement list() with JSON Schema validation
    - Implement get() with JSON Schema validation
    - Call Templates Service
    - Handle TEMPLATE_NOT_FOUND with available templates
    - Format MCP responses
    - _Requirements: 4.1, 4.2, 4.6, 4.8, 11.3, 11.10_

  - [ ] 7.2 Create Starters Controller
    - Create src/controllers/starters.js
    - Implement list() with JSON Schema validation
    - Implement get() with JSON Schema validation
    - Call Starters Service and GitHub Service
    - Handle private repository indication
    - Format MCP responses
    - _Requirements: 5.1, 5.6, 5.7, 5.8, 5.9_

  - [ ] 7.3 Create Documentation Controller
    - Create src/controllers/documentation.js
    - Implement search() with JSON Schema validation
    - Call Documentation Service
    - Support fullContent parameter
    - Suggest related topics when no results
    - Format MCP responses
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.8_

  - [ ] 7.4 Create Validation Controller
    - Create src/controllers/validation.js
    - Implement validate() with JSON Schema validation
    - Call Validation Service
    - Return detailed component validation
    - Include suggestions in response
    - Format MCP responses
    - _Requirements: 7.1, 7.2, 7.7, 7.8_

  - [ ] 7.5 Create Updates Controller
    - Create src/controllers/updates.js
    - Implement check() with JSON Schema validation
    - Call Templates Service for version comparison
    - Support multiple templates in single request
    - Indicate breaking changes and migration guides
    - Handle invalid template names
    - Format MCP responses
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10_


- [ ] 8. Logging and Error Handling
  - [ ] 8.1 Create logger utility
    - Create src/utils/logger.js
    - Implement logRequest() with sanitization
    - Implement logResponse() with execution time
    - Implement logError() with stack traces
    - Use DebugAndLog from cache-data
    - Support configurable log levels
    - _Requirements: 12.1, 12.2, 12.9, 12.10_

  - [ ] 8.2 Implement structured logging
    - Add request logging to router
    - Add response logging to router
    - Add error logging to controllers
    - Include requestId, tool, ipAddress, userAgent
    - Log cache operations (hit/miss/store)
    - Log external API calls (S3, GitHub, DynamoDB)
    - _Requirements: 12.1, 12.9_

  - [ ] 8.3 Implement error response formatting
    - Create error codes for all error types
    - Implement user-friendly error messages
    - Include requestId in all error responses
    - Categorize as 4xx or 5xx
    - Add context without exposing internals
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7_

- [ ] 9. CloudFormation Template Updates
  - [ ] 9.1 Add MCP-specific parameters
    - Add PublicRateLimit parameter (default 100)
    - Add TemplateS3Bucket parameter
    - Add TemplateS3Prefix parameter
    - Add TemplateCacheTTL parameter (default 3600)
    - Add StarterCacheTTL parameter (default 3600)
    - Add DocumentationCacheTTL parameter (default 21600)
    - Add GitHubTokenParameter parameter (optional)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.10_

  - [ ] 9.2 Update Lambda function resource
    - Rename function to MCPReadFunction
    - Set runtime to nodejs24.x
    - Set architecture to arm64
    - Set timeout to 30 seconds
    - Set memory to 1024 MB
    - Add MCP-specific environment variables
    - _Requirements: 1.7, 2.1, 13.7, 13.8, 13.9_

  - [ ] 9.3 Create IAM execution role with least privilege
    - Create MCPReadLambdaExecutionRole
    - Add CloudWatch Logs write permissions
    - Add SSM GetParameter permissions (scoped)
    - Add S3 GetObject and ListBucket permissions (scoped to template bucket)
    - NO S3 PutObject permissions
    - NO DynamoDB write permissions
    - Use cache-data managed policy for read-only cache access
    - _Requirements: 2.2, 2.3, 2.4_

  - [ ] 9.4 Create API Gateway usage plan
    - Create MCPPublicUsagePlan resource
    - Set rate limit from PublicRateLimit parameter
    - Set burst limit to 10
    - Set quota to PublicRateLimit per hour
    - Associate with API stage
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_

  - [ ] 9.5 Add CloudWatch alarms (production only)
    - Create MCPReadFunctionErrorsAlarm (errors > 1)
    - Create MCPRateLimitAlarm (429 responses > 100)
    - Condition: CreateAlarms (PROD only)
    - Send to AlarmNotificationTopic
    - _Requirements: 12.8_

  - [ ] 9.6 Add stack outputs
    - Output MCPApiEndpoint (API URL)
    - Output MCPToolsListEndpoint (tools list URL)
    - Output MCPReadFunctionArn
    - Output PublicRateLimitValue
    - Export values for cross-stack references
    - _Requirements: 1.9_


- [ ] 10. API Gateway Configuration
  - [ ] 10.1 Create OpenAPI specification
    - Create template-openapi-spec.yml
    - Define POST /mcp/tools endpoint
    - Define GET /mcp/tools/list endpoint
    - Add request/response schemas
    - Add x-amazon-apigateway-integration for Lambda
    - _Requirements: 11.2, 11.7_

  - [ ] 10.2 Add rate limit response headers
    - Implement X-RateLimit-Limit header
    - Implement X-RateLimit-Remaining header
    - Implement X-RateLimit-Reset header
    - Add headers to all responses
    - _Requirements: 3.9_

  - [ ] 10.3 Implement 429 rate limit response
    - Return 429 status when rate limit exceeded
    - Include Retry-After header
    - Return error with resetAt timestamp
    - Format as MCP error response
    - _Requirements: 3.4, 3.7_

- [ ] 11. Unit Tests - Controllers
  - [ ] 11.1 Write unit tests for Templates Controller
    - Test list() with valid category filter
    - Test list() with invalid category (validation error)
    - Test get() with valid template name
    - Test get() with invalid template name (helpful error with available templates)
    - Mock Templates Service
    - Verify JSON Schema validation
    - _Requirements: 15.4, 15.5_

  - [ ] 11.2 Write unit tests for Starters Controller
    - Test list() with language filter
    - Test list() with features filter
    - Test get() with valid starter name
    - Test get() indicating private repository
    - Mock Starters Service and GitHub Service
    - _Requirements: 15.4, 15.5_

  - [ ] 11.3 Write unit tests for Documentation Controller
    - Test search() with query
    - Test search() with type filter
    - Test search() with fullContent=true
    - Test search() with no results (suggestions)
    - Mock Documentation Service
    - _Requirements: 15.4, 15.5_

  - [ ] 11.4 Write unit tests for Validation Controller
    - Test validate() with valid name
    - Test validate() with invalid prefix
    - Test validate() with invalid projectId
    - Test validate() with partial name
    - Mock Validation Service
    - _Requirements: 15.4, 15.5_

  - [ ] 11.5 Write unit tests for Updates Controller
    - Test check() with single template
    - Test check() with multiple templates
    - Test check() with newer version available
    - Test check() with breaking changes
    - Test check() with invalid template name
    - Mock Templates Service
    - _Requirements: 15.4, 15.5_


- [ ] 12. Unit Tests - Services
  - [ ] 12.1 Write unit tests for Templates Service
    - Test list() cache hit scenario
    - Test list() cache miss scenario
    - Test get() cache hit scenario
    - Test get() cache miss scenario
    - Mock CacheableDataAccess.getData
    - Mock S3Templates DAO
    - Verify cache key format
    - _Requirements: 15.4, 15.6_

  - [ ] 12.2 Write unit tests for Starters Service
    - Test list() with caching
    - Test get() with caching
    - Mock CacheableDataAccess.getData
    - Verify cache profiles used correctly
    - _Requirements: 15.4, 15.6_

  - [ ] 12.3 Write unit tests for Documentation Service
    - Test search() with cached index
    - Test search() with index rebuild
    - Test relevance ranking algorithm
    - Test excerpt extraction
    - Mock DocIndex DAO
    - _Requirements: 15.4, 15.6_

  - [ ] 12.4 Write unit tests for GitHub Service
    - Test getRepoMetadata() with caching
    - Test getReadme() with caching
    - Test getLatestRelease() with caching
    - Test GitHub API rate limit handling
    - Mock GitHub API DAO
    - _Requirements: 15.4, 15.6_

  - [ ] 12.5 Write unit tests for Validation Service
    - Test validate() with valid name
    - Test validate() with invalid components
    - Test generateSuggestions() logic
    - Test partial name validation
    - Mock NamingRules utility
    - _Requirements: 15.4_

- [ ] 13. Unit Tests - Models/DAOs
  - [ ] 13.1 Write unit tests for S3Templates DAO
    - Test list() with S3 ListObjectsV2
    - Test list() with category filter
    - Test list() with version filter
    - Test get() with S3 GetObject
    - Test get() with template not found
    - Test parseCloudFormationTemplate()
    - Mock AWS.s3 from cache-data
    - _Requirements: 15.4, 15.5_

  - [ ] 13.2 Write unit tests for GitHub API DAO
    - Test getRepository() with valid repo
    - Test getReadme() with valid repo
    - Test getLatestRelease() with valid repo
    - Test error handling for 404
    - Test error handling for rate limit
    - Mock fetch API
    - _Requirements: 15.4, 15.5_

  - [ ] 13.3 Write unit tests for DocIndex DAO
    - Test build() with GitHub Search API
    - Test search() with keyword matching
    - Test relevance scoring algorithm
    - Test Markdown parsing
    - Test code example extraction
    - Mock GitHub API responses
    - _Requirements: 15.4, 15.5_

- [ ] 14. Unit Tests - Utilities
  - [ ] 14.1 Write unit tests for MCP Protocol utility
    - Test initializeMCPServer()
    - Test successResponse() formatting
    - Test errorResponse() formatting
    - Verify MCP protocol v1.0 compliance
    - _Requirements: 15.4_

  - [ ] 14.2 Write unit tests for Schema Validator
    - Test validate() with valid inputs for all tools
    - Test validate() with invalid inputs for all tools
    - Test detailed error messages
    - Test unknown tool handling
    - _Requirements: 15.4_

  - [ ] 14.3 Write unit tests for Naming Rules utility
    - Test parse() with valid names
    - Test parse() with invalid names
    - Test validatePrefix() with edge cases
    - Test validateProjectId() with edge cases
    - Test validateStageId() with edge cases
    - Test validateResource() for each resource type
    - Test generateSuggestions() logic
    - _Requirements: 15.4_

  - [ ] 14.4 Write unit tests for Logger utility
    - Test logRequest() with sanitization
    - Test logResponse() with execution time
    - Test logError() with stack traces
    - Test sanitizeInput() removes sensitive fields
    - Mock DebugAndLog from cache-data
    - _Requirements: 15.4_


- [ ] 15. Property-Based Tests
  - [ ]* 15.1 Write property test: Valid names always pass validation
    - **Property 1: Naming Convention Validation Correctness**
    - **Validates: Requirements 7.1, 7.2**
    - Use fast-check to generate valid Prefix, ProjectId, StageId, ResourceName
    - Verify combined name passes validation
    - Verify all components marked as valid
    - Run 100 iterations
    - _Requirements: 15.1, 15.2_

  - [ ]* 15.2 Write property test: Invalid prefixes always fail validation
    - **Property 2: Invalid Component Detection**
    - **Validates: Requirements 7.3, 7.7**
    - Use fast-check to generate invalid prefixes
    - Verify validation fails with specific error message
    - Verify error message contains "prefix"
    - Run 100 iterations
    - _Requirements: 15.1, 15.3_

  - [ ]* 15.3 Write property test: Validation provides suggestions for invalid names
    - **Property 3: Suggestion Generation**
    - **Validates: Requirements 7.8**
    - Use fast-check to generate invalid names
    - Verify suggestions array is non-empty
    - Verify suggestions are actionable
    - Run 50 iterations
    - _Requirements: 15.1, 15.3_

  - [ ]* 15.4 Write property test: Resource type validation is consistent
    - **Property 4: Cross-Resource Type Consistency**
    - **Validates: Requirements 7.9**
    - Use fast-check to generate valid base names
    - Verify validation succeeds for all resource types (S3, DynamoDB, Lambda, CloudFormation)
    - Verify resourceType field matches input
    - Run 50 iterations
    - _Requirements: 15.1, 15.2_

  - [ ]* 15.5 Write property test: Template metadata completeness
    - **Property 5: Template Metadata Completeness**
    - **Validates: Requirements 4.2, 4.6, 4.7**
    - Generate mock template responses
    - Verify all required fields present (name, version, category, description, s3Path)
    - Verify get_template includes content, parameters, outputs
    - Run 50 iterations
    - _Requirements: 15.1_

  - [ ]* 15.6 Write property test: Cache behavior consistency
    - **Property 6: Cache Hit/Miss Behavior**
    - **Validates: Requirements 9.1, 9.2, 9.3**
    - Mock cache-data with controlled hit/miss scenarios
    - Verify second request within TTL returns cached data
    - Verify cached flag set correctly
    - Run 50 iterations
    - _Requirements: 15.1, 15.6_

  - [ ]* 15.7 Write property test: Error response structure
    - **Property 7: Error Response Consistency**
    - **Validates: Requirements 11.5, 11.10, 12.5**
    - Generate various error conditions
    - Verify all errors have code, message, details, requestId
    - Verify error codes are consistent
    - Run 50 iterations
    - _Requirements: 15.1, 15.8_

  - [ ]* 15.8 Write property test: JSON Schema validation enforcement
    - **Property 8: Input Validation Enforcement**
    - **Validates: Requirements 11.3, 11.9, 11.10**
    - Generate invalid inputs for each tool
    - Verify validation fails before service calls
    - Verify detailed field-level error messages
    - Run 100 iterations
    - _Requirements: 15.1, 15.8_

  - [ ]* 15.9 Write property test: Rate limit header presence
    - **Property 9: Rate Limit Header Completeness**
    - **Validates: Requirements 3.9**
    - Generate various successful responses
    - Verify X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset present
    - Verify values are valid numbers
    - Run 50 iterations
    - _Requirements: 15.1_

  - [ ]* 15.10 Write property test: Search result relevance ordering
    - **Property 10: Search Result Ordering**
    - **Validates: Requirements 6.3**
    - Generate mock search results with relevance scores
    - Verify results ordered by relevance descending
    - Verify highest score appears first
    - Run 50 iterations
    - _Requirements: 15.1_

  - [ ]* 15.11 Write property test: Template version comparison accuracy
    - **Property 11: Version Comparison Logic**
    - **Validates: Requirements 8.4, 8.7**
    - Generate version pairs (current, latest)
    - Verify correct identification of newer versions
    - Verify breaking change detection
    - Run 50 iterations
    - _Requirements: 15.1_

  - [ ]* 15.12 Write property test: Partial name validation support
    - **Property 12: Partial Name Handling**
    - **Validates: Requirements 7.10**
    - Generate partial names (Prefix-ProjectId, Prefix-ProjectId-StageId)
    - Verify validation handles incomplete names
    - Verify missing components indicated
    - Run 50 iterations
    - _Requirements: 15.1_


- [ ] 16. Error Handling Tests
  - [ ] 16.1 Write tests for S3 access errors
    - Test S3 NoSuchBucket error
    - Test S3 AccessDenied error
    - Test S3 NoSuchKey error
    - Verify error logging includes bucket and key
    - Verify user-friendly error messages
    - _Requirements: 12.3, 15.8_

  - [ ] 16.2 Write tests for GitHub API errors
    - Test GitHub 404 Not Found
    - Test GitHub 403 Rate Limit Exceeded
    - Test GitHub 500 Internal Server Error
    - Verify error logging includes repo and endpoint
    - Verify cached data returned on rate limit
    - _Requirements: 12.4, 15.8_

  - [ ] 16.3 Write tests for cache errors
    - Test DynamoDB throttling
    - Test S3 cache access failure
    - Verify fallback to fresh data fetch
    - Verify error logged but request succeeds
    - _Requirements: 12.3, 15.8_

  - [ ] 16.4 Write tests for validation errors
    - Test invalid JSON in request body
    - Test missing required fields
    - Test invalid enum values
    - Test invalid data types
    - Verify 400 status code
    - Verify detailed validation errors
    - _Requirements: 11.10, 15.8_

- [ ] 17. Rate Limiting Tests
  - [ ] 17.1 Write tests for rate limit enforcement
    - Test requests within limit succeed
    - Test requests exceeding limit return 429
    - Test rate limit headers present
    - Test Retry-After header on 429
    - Mock API Gateway usage plan behavior
    - _Requirements: 3.2, 3.3, 3.4, 3.7, 3.9, 15.7_

  - [ ] 17.2 Write tests for rate limit reset
    - Test rate limit resets after period
    - Test X-RateLimit-Reset timestamp accuracy
    - Test X-RateLimit-Remaining decrements
    - _Requirements: 3.8, 3.9, 15.7_

- [ ] 18. Deployment Configuration
  - [ ] 18.1 Update buildspec.yml
    - Verify Node.js 24 runtime version
    - Add npm ci --production for dependencies
    - Add npm test for test execution
    - Add generate-put-ssm.py execution
    - Add template-configuration.json variable replacement
    - _Requirements: 1.5, 1.8_

  - [ ] 18.2 Create template-configuration.json
    - Add parameter values for test environment
    - Add parameter values for prod environment
    - Include Prefix, ProjectId, StageId
    - Include PublicRateLimit, TemplateS3Bucket
    - Include cache TTL values
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ] 18.3 Update generate-put-ssm.py script
    - Add GitHubTokenParameter generation (optional)
    - Generate SSM put commands for test environment
    - Generate SSM put commands for prod environment
    - _Requirements: 13.5_

  - [ ] 18.4 Create deployment documentation
    - Document deployment process using SAM config repo
    - Document branch-to-environment mapping
    - Document parameter configuration
    - Document SSM parameter setup
    - _Requirements: 14.5, 14.6_


- [ ] 19. Documentation
  - [ ] 19.1 Create end-user documentation
    - Create docs/user-guide.md
    - Document each MCP tool with examples
    - Include sample inputs and outputs
    - Document rate limiting behavior
    - Document error responses
    - _Requirements: 14.1, 14.2_

  - [ ] 19.2 Create integration guides
    - Create docs/integration/claude.md for Claude integration
    - Create docs/integration/chatgpt.md for ChatGPT integration
    - Create docs/integration/cursor.md for Cursor IDE integration
    - Include setup instructions
    - Include example usage
    - _Requirements: 14.3_

  - [ ] 19.3 Create organizational documentation
    - Create docs/deployment.md for self-hosting
    - Document CloudFormation parameters
    - Document SSM parameter setup
    - Document GitHub token configuration
    - Document rate limit configuration
    - _Requirements: 14.4, 14.5, 14.6, 14.7_

  - [ ] 19.4 Create maintainer documentation
    - Create docs/architecture.md with diagrams
    - Document Lambda function design
    - Document caching strategy
    - Document data flow
    - Create docs/contributing.md
    - Document testing procedures
    - Document code organization
    - _Requirements: 14.8, 14.9, 14.10_

  - [ ] 19.5 Update README.md
    - Add project overview
    - Add quick start guide
    - Add API endpoint documentation
    - Add links to detailed documentation
    - Add deployment instructions
    - Add license information
    - _Requirements: 14.1, 14.4_

- [ ] 20. Code Coverage and Quality
  - [ ] 20.1 Configure Jest coverage reporting
    - Add coverage configuration to package.json
    - Set coverage thresholds (80% minimum)
    - Exclude test files from coverage
    - Generate HTML coverage reports
    - _Requirements: 15.10_

  - [ ] 20.2 Run coverage analysis
    - Execute npm test with coverage
    - Verify >80% coverage for controllers
    - Verify >80% coverage for services
    - Verify >80% coverage for utilities
    - Identify uncovered code paths
    - _Requirements: 15.10_

  - [ ] 20.3 Add ESLint configuration
    - Create .eslintrc.json
    - Configure rules for Node.js 24
    - Add security rules (no-eval, no-implied-eval)
    - Add best practice rules
    - Run eslint on all source files
    - _Requirements: Code quality_

- [ ] 21. Integration and End-to-End Testing
  - [ ] 21.1 Create integration test setup
    - Create test/integration/ directory
    - Configure test environment variables
    - Create mock S3 bucket setup
    - Create mock DynamoDB table setup
    - _Requirements: 15.9_

  - [ ] 21.2 Write MCP protocol compliance tests
    - Test tools/list endpoint returns all tools
    - Test each tool with valid inputs
    - Test MCP response format compliance
    - Test JSON-RPC 2.0 structure
    - Verify protocol negotiation
    - _Requirements: 11.1, 11.4, 11.7, 15.9_

  - [ ] 21.3 Write end-to-end workflow tests
    - Test complete list_templates → get_template flow
    - Test complete search_documentation → retrieve content flow
    - Test complete validate_naming → suggestions flow
    - Test complete check_template_updates flow
    - _Requirements: 15.9_


- [ ] 22. Performance Testing and Optimization
  - [ ] 22.1 Test cold start performance
    - Measure cold start time
    - Verify <2 seconds target
    - Identify optimization opportunities
    - Test with minimal dependencies
    - _Requirements: Performance_

  - [ ] 22.2 Test warm invocation performance
    - Measure cache hit latency (<100ms target)
    - Measure cache miss S3 latency (<500ms target)
    - Measure cache miss GitHub latency (<1000ms target)
    - Measure validation latency (<50ms target)
    - _Requirements: Performance_

  - [ ] 22.3 Test caching effectiveness
    - Measure cache hit rates
    - Verify in-memory cache reduces DynamoDB reads
    - Verify DynamoDB cache reduces S3 reads
    - Verify S3 cache reduces GitHub API calls
    - _Requirements: 9.1, 9.7, Performance_

- [ ] 23. Security Testing
  - [ ] 23.1 Verify IAM permissions (least privilege)
    - Review MCPReadLambdaExecutionRole policy
    - Verify NO S3 PutObject permissions
    - Verify NO DynamoDB write permissions
    - Verify NO repository creation permissions
    - Verify resource-scoped permissions only
    - _Requirements: 2.2, 2.3, Security_

  - [ ] 23.2 Test input sanitization
    - Test SQL injection attempts in inputs
    - Test XSS attempts in inputs
    - Test path traversal attempts
    - Verify all inputs validated before processing
    - Verify sensitive data not logged
    - _Requirements: 12.1, Security_

  - [ ] 23.3 Test error message security
    - Verify error messages don't expose internal details
    - Verify stack traces not returned to clients
    - Verify AWS resource ARNs not exposed
    - Verify sensitive configuration not exposed
    - _Requirements: 12.5, Security_

- [ ] 24. Monitoring and Observability Setup
  - [ ] 24.1 Configure CloudWatch Logs
    - Create log group with retention policy
    - Set retention to 180 days for PROD
    - Set retention to 7 days for TEST
    - Enable structured logging
    - _Requirements: 12.1, 12.9_

  - [ ] 24.2 Configure CloudWatch Metrics
    - Emit custom metrics for tool invocations
    - Emit custom metrics for cache hit rates
    - Emit custom metrics for external API durations
    - Emit custom metrics for validation failures
    - _Requirements: 12.8_

  - [ ] 24.3 Configure X-Ray tracing
    - Enable X-Ray in Lambda function
    - Trace AWS SDK calls (S3, DynamoDB)
    - Trace external API calls (GitHub)
    - Create service map
    - _Requirements: Observability_

  - [ ] 24.4 Create CloudWatch dashboards (PROD only)
    - Create dashboard for Lambda metrics
    - Create dashboard for API Gateway metrics
    - Create dashboard for cache performance
    - Create dashboard for error rates
    - _Requirements: Observability_

  - [ ] 24.5 Create Log Insights queries
    - Create query for error rate by tool
    - Create query for average execution time by tool
    - Create query for cache hit rate
    - Create query for rate limit violations
    - _Requirements: 12.1, Observability_


- [ ] 25. Pre-Deployment Validation
  - [ ] 25.1 Run all tests
    - Execute npm test (all unit tests)
    - Execute property-based tests
    - Execute integration tests
    - Verify all tests pass
    - Verify >80% code coverage
    - _Requirements: 15.4, 15.10_

  - [ ] 25.2 Validate CloudFormation template
    - Run cfn-lint on template.yml
    - Validate parameter definitions
    - Validate resource dependencies
    - Validate IAM policies
    - Validate outputs
    - _Requirements: 1.7, 13.10_

  - [ ] 25.3 Validate OpenAPI specification
    - Validate template-openapi-spec.yml syntax
    - Verify endpoint definitions
    - Verify request/response schemas
    - Verify Lambda integrations
    - _Requirements: 11.2_

  - [ ] 25.4 Review security configuration
    - Review IAM execution role
    - Review API Gateway usage plan
    - Review environment variables
    - Review logging configuration
    - Verify no hardcoded secrets
    - _Requirements: 2.2, 2.3, Security_

  - [ ] 25.5 Validate naming conventions
    - Verify all resources follow Prefix-ProjectId-StageId-Resource pattern
    - Verify Lambda function name
    - Verify IAM role name
    - Verify API Gateway name
    - Verify CloudWatch log group name
    - _Requirements: 1.7, Naming Convention_

- [ ] 26. Deployment to Test Environment
  - [ ] 26.1 Deploy to test branch
    - Push code to test branch
    - Verify CodePipeline triggered
    - Verify CodeBuild executes buildspec.yml
    - Verify tests pass in CodeBuild
    - Verify CloudFormation stack creation
    - _Requirements: 1.8, 1.9_

  - [ ] 26.2 Verify test deployment
    - Verify Lambda function created
    - Verify API Gateway endpoint accessible
    - Verify IAM role created with correct permissions
    - Verify CloudWatch log group created
    - Verify stack outputs available
    - _Requirements: 1.9_

  - [ ] 26.3 Test API endpoints manually
    - Test POST /mcp/tools with list_templates
    - Test POST /mcp/tools with get_template
    - Test POST /mcp/tools with validate_naming
    - Test GET /mcp/tools/list
    - Verify responses follow MCP protocol
    - Verify rate limit headers present
    - _Requirements: 11.4, 3.9_

  - [ ] 26.4 Test error scenarios
    - Test invalid tool name (404)
    - Test invalid input (400)
    - Test rate limit exceeded (429)
    - Verify error responses follow MCP format
    - _Requirements: 11.5, 12.5_

  - [ ] 26.5 Verify monitoring and logging
    - Verify CloudWatch logs contain request logs
    - Verify CloudWatch logs contain error logs
    - Verify structured log format
    - Verify X-Ray traces available
    - _Requirements: 12.1, 12.9_


- [ ] 27. Production Deployment Preparation
  - [ ] 27.1 Update production parameters
    - Set PublicRateLimit for production (100 or higher)
    - Set TemplateCacheTTL for production (3600)
    - Set StarterCacheTTL for production (3600)
    - Set DocumentationCacheTTL for production (21600)
    - Configure GitHub token SSM parameter
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ] 27.2 Configure CloudWatch alarms
    - Verify MCPReadFunctionErrorsAlarm configured
    - Verify MCPRateLimitAlarm configured
    - Verify alarm actions configured
    - Test alarm notifications
    - _Requirements: 12.8_

  - [ ] 27.3 Configure gradual deployment
    - Verify Linear10PercentEvery3Minutes deployment preference
    - Verify pre-traffic hook (if needed)
    - Verify post-traffic hook (if needed)
    - Verify rollback on alarm trigger
    - _Requirements: Deployment_

  - [ ] 27.4 Create runbook documentation
    - Document deployment process
    - Document rollback procedures
    - Document troubleshooting steps
    - Document monitoring procedures
    - Document incident response
    - _Requirements: 14.8, Operational_

- [ ] 28. Production Deployment
  - [ ] 28.1 Deploy to beta/stage environment
    - Merge test to beta branch
    - Verify CodePipeline triggered
    - Verify gradual deployment starts
    - Monitor deployment progress
    - Verify no alarms triggered
    - _Requirements: 1.8_

  - [ ] 28.2 Verify beta/stage deployment
    - Test all MCP tools in beta
    - Verify caching behavior
    - Verify rate limiting
    - Verify monitoring and alarms
    - Verify performance meets targets
    - _Requirements: Deployment_

  - [ ] 28.3 Deploy to production (main)
    - Merge beta to main branch
    - Verify CodePipeline triggered
    - Monitor gradual deployment
    - Monitor CloudWatch alarms
    - Monitor error rates
    - Monitor latency metrics
    - _Requirements: 1.8_

  - [ ] 28.4 Verify production deployment
    - Test all MCP tools in production
    - Verify cache hit rates
    - Verify rate limiting working
    - Verify alarms configured
    - Verify X-Ray tracing enabled
    - _Requirements: Deployment_

- [ ] 29. Post-Deployment Validation
  - [ ] 29.1 Perform smoke tests
    - Test list_templates tool
    - Test get_template tool
    - Test list_starters tool
    - Test search_documentation tool
    - Test validate_naming tool
    - Test check_template_updates tool
    - Verify all tools return expected results
    - _Requirements: All tool requirements_

  - [ ] 29.2 Monitor production metrics
    - Monitor Lambda invocations
    - Monitor error rates
    - Monitor latency (p50, p95, p99)
    - Monitor cache hit rates
    - Monitor rate limit violations
    - _Requirements: 12.8, Observability_

  - [ ] 29.3 Test with real AI assistants
    - Test integration with Claude
    - Test integration with ChatGPT (if supported)
    - Test integration with Cursor IDE
    - Verify MCP protocol compatibility
    - Verify tool discovery works
    - _Requirements: 11.1, 11.7, 14.3_

  - [ ] 29.4 Gather initial feedback
    - Test with internal users
    - Document any issues found
    - Document feature requests
    - Document performance observations
    - _Requirements: Operational_


- [ ] 30. Final Checkpoint and Documentation
  - [ ] 30.1 Update CHANGELOG.md
    - Add entry under "Unreleased" section
    - Document all 7 MCP tools added
    - Document public access with rate limiting
    - Document caching strategy
    - Reference spec: 0-0-1-atlantis-mcp-phase-1-core-read-only
    - _Requirements: Changelog Convention_

  - [ ] 30.2 Create release notes
    - Document Phase 1 features
    - Document API endpoints
    - Document rate limits
    - Document known limitations
    - Document Phase 2 roadmap
    - _Requirements: Documentation_

  - [ ] 30.3 Update project README
    - Add Phase 1 completion status
    - Add API documentation links
    - Add deployment instructions
    - Add usage examples
    - Add troubleshooting section
    - _Requirements: 14.1, 14.5_

  - [ ] 30.4 Archive spec artifacts
    - Ensure requirements.md is complete
    - Ensure design.md is complete
    - Ensure tasks.md is complete
    - Archive any spec questions/decisions
    - _Requirements: Spec Management_

  - [ ] 30.5 Final checkpoint - Ensure all tests pass
    - Run full test suite (unit + property + integration)
    - Verify >80% code coverage
    - Verify all CloudFormation validations pass
    - Verify all security checks pass
    - Verify deployment successful in all environments
    - Ask the user if questions arise
    - _Requirements: 15.10, All requirements_

## Notes

- Tasks marked with `*` are optional property-based tests and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Checkpoints (tasks 25, 26, 29, 30.5) ensure incremental validation
- All tests must be written in Jest (not Mocha) per test-requirements.md
- All code must follow Atlantis naming convention: Prefix-ProjectId-StageId-Resource
- All IAM policies must follow least privilege principle (no AWS managed policies)
- All deployments must use Atlantis platform scripts (no manual deployments)

## Implementation Order Recommendation

1. **Foundation** (Tasks 1-4): Set up project structure, dependencies, and core infrastructure
2. **Data Layer** (Task 5): Implement DAOs for S3, GitHub, and documentation
3. **Service Layer** (Task 6): Implement services with caching
4. **Controller Layer** (Task 7): Implement controllers with validation
5. **Infrastructure** (Tasks 3, 8-10): Implement MCP protocol, logging, API Gateway
6. **Testing** (Tasks 11-17): Write comprehensive unit and property tests
7. **Deployment** (Tasks 18-19): Configure deployment and documentation
8. **Quality** (Tasks 20-24): Ensure coverage, security, monitoring
9. **Deployment** (Tasks 25-29): Deploy to test, then production
10. **Finalization** (Task 30): Update documentation and complete spec

## Success Criteria

Phase 1 is complete when:
- All 7 MCP tools are implemented and tested
- Public access with rate limiting is working
- Multi-tier caching is operational
- >80% code coverage achieved
- All tests pass (unit + property + integration)
- Deployed successfully to test and production
- Documentation is complete
- Monitoring and alarms are configured
- Real AI assistants can discover and use the tools

