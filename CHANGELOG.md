# Changelog

All notable changes to the Atlantis MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Core MCP Server Infrastructure [Spec: 0-0-1-atlantis-mcp-phase-1-core-read-only](.kiro/specs/0-0-1-atlantis-mcp-phase-1-core-read-only/)
- **MCP Protocol v1.0 Implementation** - Full compliance with Model Context Protocol specification
  - Protocol negotiation and capability discovery
  - JSON Schema validation for all tool inputs
  - Standardized success and error response formats
  - Tool descriptions optimized for AI assistants

#### Read-Only MCP Tools
- **Template Discovery Tools**
  - `list_templates` - List available CloudFormation templates with filtering by category, version, and S3 buckets
  - `get_template` - Retrieve specific template with full metadata, parameters, and outputs
  - `list_template_versions` - List all versions of a template with Human_Readable_Version and S3_VersionId
  - `list_categories` - List template categories (Storage, Network, Pipeline, Service Role, Modules)
  
- **Starter Code Tools**
  - `list_starters` - List available app starters with language, framework, and feature information
  - `get_starter_info` - Get detailed starter information including prerequisites and example code
  
- **Documentation and Search Tools**
  - `search_documentation` - Search across documentation, tutorials, and code patterns with relevance ranking
  - Code pattern indexing from CloudFormation templates and app starter source code
  - Support for filtering by documentation type (guide, tutorial, reference, troubleshooting, template pattern, code example)
  
- **Validation and Update Tools**
  - `validate_naming` - Validate resource names against Atlantis naming conventions with suggestions
  - `check_template_updates` - Check for template updates with version comparison and changelog information

#### Multi-Source Data Aggregation
- **Multiple S3 Bucket Support**
  - Configurable via comma-delimited ATLANTIS_S3_BUCKETS environment variable
  - Bucket priority ordering for template resolution
  - S3 bucket access control via `atlantis-mcp:Allow=true` tag
  - Namespace discovery via `atlantis-mcp:IndexPriority` tag
  - Brown-out support: continue operation when some buckets fail
  
- **Multiple GitHub Organization Support**
  - Configurable via comma-delimited ATLANTIS_GITHUB_USER_ORGS environment variable
  - Organization priority ordering for repository resolution
  - GitHub custom properties for repository filtering (`atlantis_repository-type`)
  - GitHub API rate limit handling with cached data fallback
  - Brown-out support: continue operation when some orgs fail

#### Template and Repository Management
- **S3 Namespace Discovery**
  - Automatic discovery of root-level directories in S3 buckets
  - Namespace indexing based on `atlantis-mcp:IndexPriority` tag
  - Support for organizational template structure: `{namespace}/templates/v2/{category}/{templateName}`
  - Support for app starter structure: `{namespace}/app-starters/v2/{appName}.zip`
  
- **Template Versioning with Dual Identifiers**
  - Human_Readable_Version: vX.X.X/YYYY-MM-DD format from template comments
  - S3_VersionId: S3 bucket versioning identifier
  - OR condition support: retrieve template by version OR versionId
  - Version history tracking via S3 ListObjectVersions API
  
- **GitHub Custom Properties Integration**
  - Repository filtering via `atlantis_repository-type` custom property
  - Supported types: documentation, app-starter, templates, management, package, mcp
  - Automatic exclusion of repositories without custom property
  
- **App Starter Sidecar Metadata**
  - JSON metadata files stored alongside ZIP files in S3
  - Metadata includes: name, description, language, framework, features, prerequisites, author, license
  - Python script for generating metadata from GitHub repositories
  - Integration with CodeBuild and GitHub Actions workflows

#### Caching and Performance
- **Multi-Tier Caching via @63klabs/cache-data**
  - In-memory caching at Lambda instance level
  - DynamoDB caching for shared data across invocations
  - S3 caching for large objects and long-term storage
  - Configurable TTL per resource type (templates, starters, documentation)
  - Cache key generation based on connection parameters
  - Downstream caching support with ETag and Last-Modified headers

#### Security and Access Control
- **Public Access with Rate Limiting**
  - Default rate limit: 100 requests per hour per IP address
  - Configurable via CloudFormation PublicRateLimit parameter
  - API Gateway throttling with HTTP 429 responses
  - Rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
  
- **Least-Privilege IAM Permissions**
  - Read Lambda limited to: S3 GetObject/ListBucket/GetObjectVersion, DynamoDB read, SSM GetParameter
  - No write permissions in Phase 1
  - Support for attaching additional managed policies via ReadLambdaExecRoleIncludeManagedPolicyArns parameter
  
- **Input Validation and Error Handling**
  - JSON Schema validation for all MCP tool inputs
  - Comprehensive error messages with request context
  - Sanitized error responses (no internal details exposed)
  - Structured logging with CloudWatch integration

#### Deployment and Operations
- **SAM Deployment Configuration**
  - Separate configurations for test and prod environments
  - CloudFormation parameters for all configurable settings
  - Support for multiple deployment stages (test, beta, stage, prod)
  - Atlantis naming convention compliance for all resources
  
- **CI/CD Pipeline Integration**
  - CodePipeline integration via buildspec.yml
  - Automated deployment on branch push (test, main)
  - Build-time validation and testing
  - Artifact management and versioning
  
- **CloudWatch Monitoring**
  - Structured logging with configurable log levels
  - CloudWatch metrics for error rates, latency, cache performance
  - Request logging with timestamp, IP, tool name, execution time
  - Error logging with stack traces and request context

#### Testing and Quality Assurance
- **Comprehensive Test Suite**
  - Unit tests with >80% code coverage
  - Property-based tests for validation logic using fast-check
  - Integration tests for multi-source scenarios
  - End-to-end tests for MCP protocol compliance
  - Mock AWS SDK calls for isolated testing
  
- **Test Categories**
  - Lambda handler and routing tests
  - Controller input validation and error handling tests
  - Service caching and data aggregation tests
  - DAO multi-bucket and multi-org handling tests
  - Utility function tests (naming rules, schema validation, MCP protocol)

#### Documentation
- **End-User Documentation**
  - Comprehensive README with quick start guide
  - Integration guides for Claude, ChatGPT, Cursor, Kiro, Amazon Q Developer
  - Tool reference documentation with examples
  - Common use cases and patterns
  - Troubleshooting guide
  
- **Deployment Documentation**
  - CloudFormation parameter reference
  - GitHub token setup and required scopes
  - GitHub custom properties configuration
  - S3 bucket tagging guide (atlantis-mcp:Allow, atlantis-mcp:IndexPriority)
  - Sidecar metadata generation scripts and usage
  - Multiple S3 bucket configuration guide
  - Multiple GitHub organization configuration guide
  - Self-hosting deployment guide
  
- **Maintainer Documentation**
  - Architecture diagrams (high-level, component, data flow)
  - Lambda function structure and organization
  - Caching strategy and TTL configuration
  - Brown-out support implementation
  - Namespace discovery and priority ordering
  - Template versioning with dual identifiers
  - Code pattern indexing implementation
  - Testing procedures and requirements

### Changed
- N/A (initial release)

### Deprecated
- N/A (initial release)

### Removed
- N/A (initial release)

### Fixed
- N/A (initial release)

### Security
- **IAM Least Privilege**: Read Lambda restricted to minimal permissions (S3 read, DynamoDB read, SSM GetParameter)
- **Rate Limiting**: API Gateway throttling prevents abuse (default 100 req/hour per IP)
- **Input Validation**: JSON Schema validation for all MCP tool inputs prevents injection attacks
- **Credential Management**: GitHub token stored in SSM Parameter Store, never in code or environment variables
- **Error Sanitization**: Error responses exclude internal implementation details and sensitive information
- **Bucket Access Control**: S3 buckets require explicit `atlantis-mcp:Allow=true` tag for access
- **Repository Filtering**: GitHub repositories require explicit `atlantis_repository-type` custom property for inclusion

### Known Limitations
- **Phase 1 Scope**: Read-only operations only; write operations (repository creation, template modification) planned for Phase 2
- **Authentication**: Public access only in Phase 1; authentication and authorization planned for Phase 2
- **CodeCommit Support**: GitHub only in Phase 1; CodeCommit repository support planned for future phases
- **Template Comparison**: No built-in template version comparison tool in Phase 1
- **Rate Limiting Scope**: Global rate limiting across all resources; per-bucket or per-org rate limiting not supported in Phase 1

### Deployment Requirements
- **AWS Services**: Lambda, API Gateway, DynamoDB, S3, SSM Parameter Store, CloudWatch
- **Node.js Runtime**: Node.js 20.x or later
- **Dependencies**: @63klabs/cache-data package for caching and routing
- **GitHub Token**: Personal access token with repo scope for private repositories
- **S3 Bucket Tags**: `atlantis-mcp:Allow=true` and `atlantis-mcp:IndexPriority` tags required
- **GitHub Custom Properties**: `atlantis_repository-type` custom property required for repository filtering

## [0.0.1] - 2026-xx-xx

### Added
- Initial release placeholder

---

## Release Notes Format

Each release should include changes under these categories:

- **Added**: New features, tools, or capabilities
- **Changed**: Modifications to existing functionality
- **Deprecated**: Features marked for removal (with sunset date)
- **Removed**: Features removed in this version
- **Fixed**: Bug fixes and corrections
- **Security**: Security-related changes or fixes

### Breaking Changes

Breaking changes should be clearly marked and include:
- Description of the breaking change
- Migration guide link
- Deprecation timeline for old version

Example:
```markdown
### Breaking Changes
- **Tool: list_templates** - Renamed parameter `buckets` to `s3Buckets`
  - **Migration Guide**: [docs/migration/v1-to-v2.md](docs/migration/v1-to-v2.md)
  - **Deprecation**: v1.x deprecated with 6-month support period ending 2026-12-31
```

### Version Links

[Unreleased]: https://github.com/63klabs/atlantis-mcp/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/63klabs/atlantis-mcp/releases/tag/v0.0.1
