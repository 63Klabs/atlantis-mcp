# Requirements Document: Atlantis MCP Server - Phase 1 (Core Read-Only)

## Introduction

This document specifies the requirements for Phase 1 of the Atlantis MCP (Model Context Protocol) Server. The Atlantis MCP Server provides AI-assisted development capabilities for the 63Klabs Atlantis Templates and Scripts Platform, enabling developers to discover, validate, and utilize CloudFormation templates, starter code, and documentation through AI assistants and IDEs.

Phase 1 focuses on establishing the core MCP server infrastructure with read-only operations, public access with rate limiting, and integration with the Atlantis platform components. This phase lays the foundation for future write operations (Phase 2) and advanced AI integration features (Phases 3-4).

The MCP server follows Atlantis deployment patterns, using the atlantis-starter-02 structure as its foundation, and is deployed using the same CloudFormation templates and CI/CD pipelines that it helps developers utilize.

## Glossary

- **MCP_Server**: The Model Context Protocol server that exposes Atlantis platform capabilities to AI assistants and development tools
- **Atlantis_Platform**: The collection of CloudFormation templates, SAM configuration scripts, starter code repositories, and documentation maintained by 63Klabs
- **Template_Library**: The CloudFormation template repository stored in S3 with versioned templates for Storage, Network, Pipeline, and Service Role stacks
- **SAM_Config_Repo**: The repository containing Python scripts (config.py, deploy.py, create_repo.py, etc.) for infrastructure management
- **Starter_Code**: Pre-configured repository templates that provide serverless application scaffolding with CI/CD integration
- **Cache_Data_Package**: The @63klabs/cache-data npm package providing caching, routing, and AWS SDK integration for Lambda functions
- **Read_Lambda**: The Lambda function handling all read-only MCP operations with minimal AWS permissions
- **Rate_Limiter**: The API Gateway throttling mechanism that enforces request limits per IP address for public access
- **Template_Metadata**: Information about CloudFormation templates including version, parameters, description, and S3 location
- **Naming_Convention**: The Atlantis resource naming pattern: `<Prefix>-<ProjectId>-<StageId>-*`
- **Public_Access**: Unauthenticated API access with rate limiting for read-only operations
- **S3_Template_Bucket**: The S3 bucket hosting versioned CloudFormation templates for public or organizational use
- **GitHub_Metadata**: Repository information including name, description, README content, and release information
- **Documentation_Index**: Searchable index of Atlantis documentation and tutorial content
- **MCP_Tool**: An MCP protocol operation exposed to AI assistants (e.g., list_templates, validate_naming)
- **TTL**: Time-to-live for cached data, configurable per resource type

## Requirements

### Requirement 1: MCP Server Infrastructure

**User Story:** As a platform engineer, I want to deploy the MCP server using Atlantis patterns, so that it follows the same standards it enforces for other projects.

#### Acceptance Criteria

1. THE MCP_Server SHALL be based on the atlantis-starter-02 repository structure
2. THE MCP_Server SHALL replace example code in atlantis-starter-02 with MCP protocol implementation
3. THE MCP_Server SHALL maintain the directory structure, buildspec.yml, and deployment scripts from atlantis-starter-02
4. THE MCP_Server SHALL use the Cache_Data_Package for routing, caching, and AWS SDK integration
5. THE MCP_Server SHALL deploy using SAM configuration repository scripts (config.py, deploy.py)
6. THE MCP_Server SHALL use Atlantis CloudFormation pipeline templates for CI/CD
7. THE MCP_Server SHALL follow the Naming_Convention for all AWS resources created
8. WHEN deployed to test or main branch, THE MCP_Server SHALL trigger automatic deployment via CodePipeline
9. THE MCP_Server SHALL store its application template in the repository (not in S3 like high-level templates)
10. WHEN a GitHub release is created, THE MCP_Server SHALL be available as an installable package (this is a manual operation)

### Requirement 2: Lambda Function Separation

**User Story:** As a security engineer, I want read and write operations separated into different Lambda functions, so that read-only operations have minimal AWS permissions.

#### Acceptance Criteria

1. THE MCP_Server SHALL implement a Read_Lambda for all read-only operations
2. THE Read_Lambda SHALL have IAM permissions limited to S3 GetObject, DynamoDB read operations, and SSM GetParameter
3. THE Read_Lambda SHALL NOT have permissions for S3 PutObject, DynamoDB write operations, or repository creation
4. THE Read_Lambda SHALL handle all Phase 1 MCP tools (list_templates, get_template, list_starters, get_starter_info, search_documentation, validate_naming, check_template_updates)
5. THE MCP_Server SHALL reserve write operations for a separate Write_Lambda in Phase 2
6. THE Read_Lambda SHALL use the Cache_Data_Package routing mechanism to organize operations into modules
7. THE Read_Lambda SHALL log all operations to CloudWatch with request metadata
8. WHEN an unauthorized operation is requested, THE Read_Lambda SHALL return an error indicating the operation requires authentication

### Requirement 3: Public Access with Rate Limiting

**User Story:** As a developer, I want to access the MCP server without authentication for read-only operations, so that I can quickly discover templates and documentation.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide Public_Access to all read-only operations without requiring authentication
2. THE Rate_Limiter SHALL enforce a default limit of 100 requests per hour per IP address for Public_Access
3. THE Rate_Limiter SHALL be configurable via CloudFormation deployment parameters
4. WHEN the rate limit is exceeded, THE MCP_Server SHALL return HTTP 429 (Too Many Requests) with retry-after header
5. THE MCP_Server SHALL track rate limits per IP address for unauthenticated requests
6. THE MCP_Server SHALL allow rate limit adjustment without code changes (via template parameters)
7. THE MCP_Server SHALL log rate limit violations to CloudWatch for monitoring
8. THE Rate_Limiter SHALL reset request counts every hour
9. THE MCP_Server SHALL include rate limit information in API response headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)

### Requirement 4: Template Discovery and Retrieval

**User Story:** As a developer using an AI assistant, I want to discover available CloudFormation templates, so that I can choose the appropriate template for my infrastructure needs.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a list_templates tool that returns all available CloudFormation templates from S3_Template_Bucket
2. THE list_templates tool SHALL return Template_Metadata including name, version, category (Storage, Network, Pipeline, Service Role), description, and S3 path
3. THE list_templates tool SHALL support filtering by category (Storage, Network, Pipeline, Service Role)
4. THE list_templates tool SHALL support filtering by version (latest, specific version, all versions)
5. THE MCP_Server SHALL provide a get_template tool that retrieves a specific template with full metadata
6. THE get_template tool SHALL return the template content, parameters, outputs, and version information
7. THE get_template tool SHALL parse template parameters and provide descriptions for each parameter
8. WHEN a template does not exist, THE get_template tool SHALL return an error with available template names
9. THE MCP_Server SHALL cache Template_Metadata using Cache_Data_Package with configurable TTL
10. THE MCP_Server SHALL support both public 63klabs S3 bucket and organization-specific S3 buckets (configurable via deployment parameters)

### Requirement 5: Starter Code Discovery

**User Story:** As a developer, I want to discover available starter code repositories, so that I can quickly bootstrap new serverless projects.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a list_starters tool that returns all available starter code repositories
2. THE list_starters tool SHALL retrieve starter information from S3_Template_Bucket (same location as templates)
3. THE list_starters tool SHALL return starter metadata including name, description, language (Node.js, Python), features, and GitHub URL
4. THE list_starters tool SHALL indicate which starters include cache-data integration
5. THE list_starters tool SHALL indicate which starters include CloudFront integration
6. THE MCP_Server SHALL provide a get_starter_info tool that retrieves detailed information about a specific starter
7. THE get_starter_info tool SHALL use GitHub_Metadata API to retrieve README content, latest release, and repository statistics
8. THE get_starter_info tool SHALL return example code snippets from the starter repository
9. WHEN a starter repository is private, THE get_starter_info tool SHALL indicate authentication is required for full access
10. THE MCP_Server SHALL cache starter metadata using Cache_Data_Package with configurable TTL

### Requirement 6: Documentation Search

**User Story:** As a developer, I want to search Atlantis documentation and tutorials, so that I can find relevant information for my current task.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a search_documentation tool that searches Atlantis documentation and tutorials
2. THE search_documentation tool SHALL search across atlantis and atlantis-tutorials GitHub repositories
3. THE search_documentation tool SHALL support keyword-based search with relevance ranking
4. THE search_documentation tool SHALL return search results including title, excerpt, file path, and GitHub URL
5. THE search_documentation tool SHALL support filtering by documentation type (guide, tutorial, reference, troubleshooting)
6. THE search_documentation tool SHALL retrieve full document content when requested
7. THE search_documentation tool SHALL parse Markdown documents and extract code examples
8. WHEN no results are found, THE search_documentation tool SHALL suggest related topics or alternative search terms
9. THE MCP_Server SHALL build a Documentation_Index from GitHub repositories on startup
10. THE MCP_Server SHALL refresh the Documentation_Index periodically (configurable TTL)

### Requirement 7: Naming Convention Validation

**User Story:** As a developer, I want to validate project names against Atlantis conventions, so that my resources follow organizational standards.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a validate_naming tool that validates resource names against the Naming_Convention
2. THE validate_naming tool SHALL validate the pattern `<Prefix>-<ProjectId>-<StageId>-<ResourceName>`
3. THE validate_naming tool SHALL verify Prefix (established in template.yaml)
4. THE validate_naming tool SHALL verify ProjectId (established in template.yaml)
5. THE validate_naming tool SHALL verify StageId matches allowed values (established in template.yaml)
6. THE validate_naming tool SHALL verify ResourceName follows AWS resource naming rules for the specified resource type
7. WHEN validation fails, THE validate_naming tool SHALL return specific error messages indicating which component is invalid
8. THE validate_naming tool SHALL provide suggestions for correcting invalid names
9. THE validate_naming tool SHALL validate names for S3 buckets, DynamoDB tables, Lambda functions, and CloudFormation stacks
10. THE validate_naming tool SHALL support validation of partial names (e.g., just Prefix-ProjectId)

### Requirement 8: Template Update Checking

**User Story:** As a developer, I want to check if my CloudFormation templates have newer versions available, so that I can keep my infrastructure up to date.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a check_template_updates tool that compares template versions
2. THE check_template_updates tool SHALL accept a template name and current version as input
3. THE check_template_updates tool SHALL query S3_Template_Bucket for the latest version of the specified template
4. WHEN a newer version exists, THE check_template_updates tool SHALL return the version number, release date, and changelog summary
5. WHEN the current version is latest, THE check_template_updates tool SHALL indicate no updates are available
6. THE check_template_updates tool SHALL support checking multiple templates in a single request
7. THE check_template_updates tool SHALL indicate breaking changes in version updates
8. THE check_template_updates tool SHALL provide migration guide links for breaking changes
9. THE MCP_Server SHALL cache version information using Cache_Data_Package with short TTL (5 minutes)
10. WHEN a template name is invalid, THE check_template_updates tool SHALL return available template names

### Requirement 9: Caching Strategy

**User Story:** As a platform engineer, I want the MCP server to cache frequently accessed data, so that response times are fast and S3 costs are minimized.

#### Acceptance Criteria

1. THE MCP_Server SHALL use Cache_Data_Package for all caching operations
2. THE MCP_Server SHALL utilize cache-data's built in pass-through caching
3. THE MCP_Server SHALL configure cache expiration of Template_Metadata in cache-data cache profiles with configurable TTL (default 1 hour)
4. THE MCP_Server SHALL configure cache expiration of starter metadata in cache-data cache profiles with configurable TTL (default 1 hour)
5. THE MCP_Server SHALL configure cache expiration of Documentation_Index in cache-data cache profiles with configurable TTL (default 6 hours)
6. THE MCP_Server SHALL configure cache expiration of full template content in S3 with configurable TTL (default 24 hours)
7. THE MCP_Server SHALL enable cache-data in-memory caching for frequently accessed data within a single Lambda invocation
8. THE MCP_Server SHALL allow different TTL values for different resource types (configurable via deployment parameters)

### Requirement 10: GitHub Integration

**User Story:** As a developer, I want the MCP server to retrieve information from GitHub repositories, so that I can access the latest documentation and starter code details.

#### Acceptance Criteria

1. THE MCP_Server SHALL use GitHub API to retrieve repository metadata
2. THE MCP_Server SHALL retrieve README content from GitHub repositories
3. THE MCP_Server SHALL retrieve release information including version numbers and release notes
4. THE MCP_Server SHALL retrieve repository statistics (stars, forks, last updated)
5. THE MCP_Server SHALL support both public 63klabs repositories and private organizational repositories
6. WHEN accessing private repositories, THE MCP_Server SHALL check if there is a valid credential and have the user refresh the login if not
7. THE MCP_Server SHALL cache GitHub_Metadata using Cache_Data_Package with configurable TTL (default 30 minutes)
8. WHEN GitHub API rate limits are exceeded, THE MCP_Server SHALL return cached data with staleness indicator
9. THE MCP_Server SHALL handle GitHub API errors gracefully and return informative error messages
10. THE MCP_Server SHALL NOT clone or download full repository contents (metadata only in Phase 1)

### Requirement 11: MCP Protocol Compliance

**User Story:** As an AI assistant developer, I want the MCP server to fully comply with the MCP protocol specification, so that it works seamlessly with MCP clients.

#### Acceptance Criteria

1. THE MCP_Server SHALL implement the MCP protocol version 1.0 specification
2. THE MCP_Server SHALL expose all Phase 1 operations as MCP tools
3. THE MCP_Server SHALL provide JSON Schema definitions for all tool inputs and outputs
4. THE MCP_Server SHALL return structured responses conforming to MCP protocol format
5. THE MCP_Server SHALL handle MCP protocol errors according to specification (invalid requests, unsupported operations)
6. THE MCP_Server SHALL provide tool descriptions that AI assistants can use to determine when to invoke each tool
7. THE MCP_Server SHALL support MCP protocol negotiation and capability discovery
8. THE MCP_Server SHALL provide examples in tool descriptions showing typical usage
9. THE MCP_Server SHALL validate all tool inputs against JSON Schema before processing
10. WHEN validation fails, THE MCP_Server SHALL return MCP-compliant error responses with detailed validation messages

### Requirement 12: Error Handling and Logging

**User Story:** As a platform engineer, I want comprehensive error handling and logging, so that I can troubleshoot issues and monitor MCP server health.

#### Acceptance Criteria

1. THE MCP_Server SHALL log all requests to CloudWatch with timestamp, IP address, tool name, and execution time
2. THE MCP_Server SHALL log all errors with stack traces and request context
3. WHEN S3 operations fail, THE MCP_Server SHALL log the bucket name, key, and error details
4. WHEN GitHub API operations fail, THE MCP_Server SHALL log the repository, endpoint, and error details
5. THE MCP_Server SHALL return user-friendly error messages that do not expose internal implementation details
6. THE MCP_Server SHALL categorize errors as client errors (4xx) or server errors (5xx)
7. THE MCP_Server SHALL include request IDs in all error responses for correlation with logs
8. THE MCP_Server SHALL emit CloudWatch metrics for error rates, latency, and cache performance
9. THE MCP_Server SHALL implement structured logging with consistent log format
10. THE MCP_Server SHALL support configurable log levels (ERROR, WARN, INFO, DEBUG) via environment variables

### Requirement 13: Deployment Configuration

**User Story:** As a platform engineer, I want to configure the MCP server via CloudFormation parameters, so that I can customize behavior without code changes.

#### Acceptance Criteria

1. THE MCP_Server SHALL accept a PublicRateLimit parameter (default 100 requests per hour)
2. THE MCP_Server SHALL accept a TemplateS3Bucket parameter for specifying the S3_Template_Bucket
3. THE MCP_Server SHALL accept a TemplateS3Prefix parameter for specifying the S3 key prefix
4. THE MCP_Server SHALL accept CacheTTL parameters for each resource type (templates, starters, documentation)
5. THE MCP_Server SHALL accept a GitHubTokenParameter parameter specifying the SSM parameter name for GitHub access token
6. THE MCP_Server SHALL accept a LogLevel parameter (ERROR, WARN, INFO, DEBUG)
7. THE MCP_Server SHALL accept a Prefix parameter for resource naming following Naming_Convention
8. THE MCP_Server SHALL accept a ProjectId parameter for resource naming following Naming_Convention
9. THE MCP_Server SHALL accept a StageId parameter for resource naming following Naming_Convention
10. THE MCP_Server SHALL validate all parameters during CloudFormation stack creation

### Requirement 14: Documentation

**User Story:** As a developer, I want comprehensive documentation for the MCP server, so that I can understand how to use it, deploy it, and maintain it.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide end-user documentation for developers using MCP in IDEs, CLI, or AI agents
2. THE end-user documentation SHALL include examples of each MCP tool with sample inputs and outputs
3. THE end-user documentation SHALL include integration guides for popular AI assistants (Claude, ChatGPT, Cursor)
4. THE MCP_Server SHALL provide organizational documentation for self-hosting and installation
5. THE organizational documentation SHALL include deployment instructions using SAM configuration repository
6. THE organizational documentation SHALL include configuration reference for all CloudFormation parameters
7. THE organizational documentation SHALL include instructions for connecting to private GitHub repositories
8. THE MCP_Server SHALL provide maintainer documentation for platform engineers making code changes
9. THE maintainer documentation SHALL include architecture diagrams showing Lambda functions, caching, and data flow
10. THE maintainer documentation SHALL include contribution guidelines and testing procedures

### Requirement 15: Testing

**User Story:** As a developer, I want comprehensive tests for the MCP server, so that I can verify correctness and prevent regressions.

#### Acceptance Criteria

1. THE MCP_Server SHALL include property-based tests for validate_naming tool using fast-check
2. THE property-based tests SHALL verify that valid names always pass validation
3. THE property-based tests SHALL verify that invalid names always fail validation with appropriate error messages
4. THE MCP_Server SHALL include unit tests for all business logic in Read_Lambda
5. THE unit tests SHALL mock AWS SDK calls (S3, DynamoDB, SSM)
6. THE unit tests SHALL verify cache hit and cache miss scenarios
7. THE unit tests SHALL verify rate limiting logic
8. THE unit tests SHALL verify error handling for all failure scenarios
9. THE MCP_Server SHALL include integration tests for MCP protocol compliance (deferred to Phase 2)
10. THE MCP_Server SHALL achieve minimum 80% code coverage for Phase 1 functionality

