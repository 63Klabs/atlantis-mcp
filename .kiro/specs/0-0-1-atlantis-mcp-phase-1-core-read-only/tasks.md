# Implementation Tasks: Atlantis MCP Server - Phase 1 (Core Read-Only)

## Overview

This document outlines the implementation tasks for Phase 1 of the Atlantis MCP Server. Tasks are organized by functional area and should be completed in the order presented to ensure dependencies are satisfied.

## Task Status Legend

- `[ ]` - Not started
- `[~]` - Queued
- `[-]` - In progress
- `[x]` - Completed

## Tasks

### 1. Project Setup and Infrastructure

- [x] 1.1 Clone atlantis-starter-02 repository as foundation
  - [x] 1.1.1 Clone atlantis-starter-02 to new repository
  - [x] 1.1.2 Update package.json with MCP server details
  - [x] 1.1.3 Update README.md with MCP server description
  - [x] 1.1.4 Remove example code from atlantis-starter-02

- [x] 1.2 Set up Lambda function directory structure (Requirement 26)
  - [x] 1.2.1 Create src/lambda/read/ directory
  - [x] 1.2.2 Create src/lambda/write/ directory with .gitkeep (placeholder for Phase 2)
  - [x] 1.2.3 Create src/lambda/read/config/ directory
  - [x] 1.2.4 Create src/lambda/read/routes/ directory
  - [x] 1.2.5 Create src/lambda/read/controllers/ directory
  - [x] 1.2.6 Create src/lambda/read/services/ directory
  - [x] 1.2.7 Create src/lambda/read/models/ directory
  - [x] 1.2.8 Create src/lambda/read/views/ directory
  - [x] 1.2.9 Create src/lambda/read/utils/ directory
  - [x] 1.2.10 Create tests/ directory structure (unit, integration, property) at repository root

- [x] 1.3 Update buildspec.yml for Lambda function build (Requirement 26)
  - [x] 1.3.1 Add build steps for read function from src/lambda/read/
  - [x] 1.3.2 Add step to run tests before building packages
  - [x] 1.3.3 Ensure only essential node_modules are deployed to read function
  - [x] 1.3.4 Configure artifact output for read function

- [x] 1.4 Update template.yml for Lambda deployment (Requirements 1, 2, 23, 26)
  - [x] 1.4.1 Define Read_Lambda resource with CodeUri pointing to src/lambda/read/
  - [x] 1.4.2 Add commented-out Write_Lambda resource for Phase 2
  - [x] 1.4.3 Add CloudFormation parameters (Prefix, ProjectId, StageId)
  - [x] 1.4.4 Add AtlantisS3Buckets parameter (CommaDelimitedList)
  - [x] 1.4.5 Add AtlantisGitHubUserOrgs parameter (CommaDelimitedList)
  - [x] 1.4.6 Add PublicRateLimit parameter (default 100)
  - [x] 1.4.7 Add ReadLambdaExecRoleIncludeManagedPolicyArns parameter (CommaDelimitedList)
  - [x] 1.4.8 Add CacheTTL parameters for each resource type
  - [x] 1.4.9 Add GitHubToken parameter
  - [x] 1.4.10 Add LogLevel parameter (ERROR, WARN, INFO, DEBUG)
  - [x] 1.4.11 Configure Read_Lambda IAM role with minimal permissions (S3 GetObject, ListBucket, GetObjectVersion, DynamoDB read, SSM GetParameter)
  - [x] 1.4.12 Add support for attaching managed policies via ReadLambdaExecRoleIncludeManagedPolicyArns
  - [x] 1.4.13 Configure API Gateway with rate limiting
  - [x] 1.4.14 Configure DynamoDB cache table
  - [x] 1.4.15 Configure S3 cache bucket
  - [x] 1.4.16 Follow Atlantis Naming_Convention for all resources

- [x] 1.5 Install dependencies
  - [x] 1.5.1 Create package.json for read function in src/lambda/read/
  - [x] 1.5.2 Install @63klabs/cache-data in src/lambda/read/
  - [x] 1.5.3 Install AWS SDK v3 packages (@aws-sdk/client-s3, @aws-sdk/client-dynamodb, @aws-sdk/client-ssm)
  - [x] 1.5.4 Install development dependencies at root (jest, fast-check, eslint)

### 2. Configuration and Settings (Requirements 1, 19, 23)

- [x] 2.1 Implement settings.js (src/lambda/read/config/settings.js)
  - [x] 2.1.1 Parse ATLANTIS_S3_BUCKETS environment variable into array
  - [x] 2.1.2 Parse ATLANTIS_GITHUB_USER_ORGS environment variable into array
  - [x] 2.1.3 Define TTL values in settings.ttl property
  - [x] 2.1.4 Set settings.ttl.fullTemplateContent from environment (default 3600s)
  - [x] 2.1.5 Set settings.ttl.templateVersionHistory from environment (default 3600s)
  - [x] 2.1.6 Set settings.ttl.templateUpdates from environment (default 3600s)
  - [x] 2.1.7 Set settings.ttl.templateList from environment (default 1800s)
  - [x] 2.1.8 Set settings.ttl.appStarterList from environment (default 1800s)
  - [x] 2.1.9 Set settings.ttl.githubRepoList from environment (default 1800s)
  - [x] 2.1.10 Set settings.ttl.s3BucketList from environment (default 1800s)
  - [x] 2.1.11 Set settings.ttl.namespaceList from environment (default 1800s)
  - [x] 2.1.12 Set settings.ttl.categoryList from environment (default 1800s)
  - [x] 2.1.13 Set settings.ttl.documentationIndex from environment (default 3600s)
  - [x] 2.1.14 Organize settings into logical sections (s3, github, cache, logging, naming)
  - [x] 2.1.15 Define Template_Category values (storage, network, pipeline, service-role, modules)
  - [x] 2.1.16 Export settings object

- [-] 2.2 Implement connections.js (src/lambda/read/config/connections.js)
  - [x] 2.2.1 Define cache-data connection profiles for S3 templates
  - [x] 2.2.2 Define cache-data connection profiles for GitHub API
  - [x] 2.2.3 Define cache-data connection profiles for documentation index
  - [x] 2.2.4 Configure cache profiles with appropriate TTLs from settings
  - [x] 2.2.5 Configure cache profiles with DynamoDB and S3 cache backends
  - [x] 2.2.6 Export connection and cache profile objects

- [x] 2.3 Implement config initialization (src/lambda/read/config/index.js)
  - [x] 2.3.1 Create async Config.init() function
  - [x] 2.3.2 Initialize cache-data Cache.init() with DynamoDB table and S3 bucket
  - [x] 2.3.3 Load GitHub token from SSM Parameter Store
  - [x] 2.3.4 Initialize DebugAndLog with log level from settings
  - [x] 2.3.5 Build documentation index asynchronously (non-blocking)
  - [x] 2.3.6 Export Config object with init(), settings(), and getConnCacheProfile() methods

### 3. Lambda Handler and Routing (Requirements 1, 2, 26)

- [x] 3.1 Implement Read Lambda handler (src/lambda/read/index.js)
  - [x] 3.1.1 Import Config from ./config
  - [x] 3.1.2 Import Routes from ./routes
  - [x] 3.1.3 Implement handler function
  - [x] 3.1.4 Call await Config.init() during cold start
  - [x] 3.1.5 Delegate to Routes.process()
  - [x] 3.1.6 Return API Gateway-compatible response
  - [x] 3.1.7 Handle top-level errors

- [x] 3.2 Implement request routing (src/lambda/read/routes/index.js)
  - [x] 3.2.1 Import ClientRequest and Response from cache-data
  - [x] 3.2.2 Import all controllers
  - [x] 3.2.3 Implement Routes.process() function
  - [x] 3.2.4 Create ClientRequest object from event
  - [x] 3.2.5 Extract MCP tool name from request
  - [x] 3.2.6 Route to appropriate controller using switch statement
  - [x] 3.2.7 Handle list_templates tool
  - [x] 3.2.8 Handle get_template tool
  - [x] 3.2.9 Handle list_template_versions tool
  - [x] 3.2.10 Handle list_categories tool
  - [x] 3.2.11 Handle list_starters tool
  - [x] 3.2.12 Handle get_starter_info tool
  - [x] 3.2.13 Handle search_documentation tool
  - [x] 3.2.14 Handle validate_naming tool
  - [x] 3.2.15 Handle check_template_updates tool
  - [x] 3.2.16 Return 404 for unknown tools
  - [x] 3.2.17 Return 405 for unsupported methods
  - [x] 3.2.18 Log routing decisions

### 4. Utilities and Protocol Support (Requirements 17, 21)

- [x] 4.1 Implement MCP protocol utilities (src/lambda/read/utils/mcp-protocol.js)
  - [x] 4.1.1 Implement successResponse() function
  - [x] 4.1.2 Implement errorResponse() function
  - [x] 4.1.3 Define MCP protocol version 1.0 constants
  - [x] 4.1.4 Implement protocol negotiation support
  - [x] 4.1.5 Implement capability discovery support

- [x] 4.2 Implement JSON Schema validator (src/lambda/read/utils/schema-validator.js)
  - [x] 4.2.1 Define JSON Schema for list_templates input
  - [x] 4.2.2 Define JSON Schema for get_template input
  - [x] 4.2.3 Define JSON Schema for list_template_versions input
  - [x] 4.2.4 Define JSON Schema for list_categories input
  - [x] 4.2.5 Define JSON Schema for list_starters input
  - [x] 4.2.6 Define JSON Schema for get_starter_info input
  - [x] 4.2.7 Define JSON Schema for search_documentation input
  - [x] 4.2.8 Define JSON Schema for validate_naming input
  - [x] 4.2.9 Define JSON Schema for check_template_updates input
  - [x] 4.2.10 Implement validate() function
  - [x] 4.2.11 Return detailed validation errors

- [x] 4.3 Implement naming rules (src/lambda/read/utils/naming-rules.js)
  - [x] 4.3.1 Define application resource naming pattern: <Prefix>-<ProjectId>-<StageId>-<ResourceName>
  - [x] 4.3.2 Define S3 bucket naming pattern: <orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>
  - [x] 4.3.3 Define alternative S3 bucket pattern: <orgPrefix>-<Prefix>-<ProjectId>-<Region>
  - [x] 4.3.4 Implement validateApplicationResource() function
  - [x] 4.3.5 Implement validateS3Bucket() function
  - [x] 4.3.6 Implement AWS resource naming rules for S3, DynamoDB, Lambda, CloudFormation
  - [x] 4.3.7 Provide suggestions for invalid names
  - [x] 4.3.8 Support partial name validation

### 5. Models / Data Access Objects (Requirements 4, 5, 6, 7, 8, 13, 20)

- [x] 5.1 Implement S3 Templates DAO (src/lambda/read/models/s3-templates.js)
  - [x] 5.1.1 Implement checkBucketAccess() to verify atlantis-mcp:Allow=true tag
  - [x] 5.1.2 Implement getIndexedNamespaces() to read atlantis-mcp:IndexPriority tag
  - [x] 5.1.3 Implement list() function with multi-bucket support
  - [x] 5.1.4 Implement brown-out support in list() (continue on bucket failures)
  - [x] 5.1.5 Implement get() function with multi-bucket priority search
  - [x] 5.1.6 Implement brown-out support in get() (try next bucket on failure)
  - [x] 5.1.7 Implement listVersions() using S3 ListObjectVersions API
  - [x] 5.1.8 Parse Human_Readable_Version from template comments (vX.X.X/YYYY-MM-DD)
  - [x] 5.1.9 Extract S3_VersionId from S3 API responses
  - [x] 5.1.10 Support both .yml and .yaml extensions (.yml takes precedence)
  - [x] 5.1.11 Parse CloudFormation template structure (Parameters, Outputs, Description)
  - [x] 5.1.12 Filter templates by category
  - [x] 5.1.13 Filter templates by version (Human_Readable_Version)
  - [x] 5.1.14 Filter templates by versionId (S3_VersionId)
  - [x] 5.1.15 Support OR condition when both version and versionId provided
  - [x] 5.1.16 Deduplicate templates across buckets (first occurrence wins)
  - [x] 5.1.17 Include Namespace and bucket information in responses
  - [x] 5.1.18 Log warnings when buckets are skipped (missing tags)
  - [x] 5.1.19 Return error information for failed sources

- [x] 5.2 Implement GitHub API DAO (src/lambda/read/models/github-api.js)
  - [x] 5.2.1 Implement listRepositories() with multi-user/org support
  - [x] 5.2.2 Implement brown-out support in listRepositories() (continue on user/org failures)
  - [x] 5.2.3 Implement getRepository() to retrieve repository metadata
  - [x] 5.2.4 Implement getCustomProperty() using Repository Properties API
  - [x] 5.2.5 Query atlantis_repository-type custom property
  - [x] 5.2.6 Exclude repositories without atlantis_repository-type property
  - [x] 5.2.7 Filter repositories by atlantis_repository-type value
  - [x] 5.2.8 Implement getReadme() to retrieve README content
  - [x] 5.2.9 Implement getReleases() to retrieve release information
  - [x] 5.2.10 Implement getRepositoryStats() (stars, forks, last updated)
  - [x] 5.2.11 Handle GitHub API rate limits (respect X-RateLimit-* headers)
  - [x] 5.2.12 Return cached data with staleness indicator when rate limited
  - [x] 5.2.13 Handle authentication for private repositories
  - [x] 5.2.14 Log warnings when repositories are skipped (missing custom property)
  - [x] 5.2.15 Return error information for failed sources
  - [x] 5.2.16 Include user/org name in error logs

- [-] 5.3 Implement Documentation Index DAO (src/lambda/read/models/doc-index.js)
  - [x] 5.3.1 Implement buildIndex() to create searchable documentation index
  - [x] 5.3.2 Index markdown documentation from GitHub repositories
  - [x] 5.3.3 Index CloudFormation template sections (Metadata, Parameters, Mappings, Conditions, Resources, Outputs)
  - [x] 5.3.4 Index CloudFormation resource definitions and patterns
  - [x] 5.3.5 Index Python and Node.js functions from app starters
  - [x] 5.3.6 Index cache-data package usage patterns
  - [x] 5.3.7 Index README headings from templates and starters
  - [x] 5.3.8 Index top-of-file comments from source code
  - [x] 5.3.9 Implement search() function with keyword-based search
  - [x] 5.3.10 Implement relevance ranking for search results
  - [x] 5.3.11 Return code snippets with context (file path, line numbers)
  - [x] 5.3.12 Support filtering by result type (documentation, template pattern, code example)
  - [x] 5.3.13 Build index for template repo and cache-data package at Lambda cold start
  - [x] 5.3.14 Build index for app starter code asynchronously or on-demand
  - [x] 5.3.15 Provide suggestions when no results found

- [x] 5.4 Implement S3 App Starters DAO (src/lambda/read/models/s3-starters.js)
  - [x] 5.4.1 Implement list() function with multi-bucket support
  - [x] 5.4.2 Search for ZIP files at path {namespace}/app-starters/v2/{appName}.zip
  - [x] 5.4.3 Search for sidecar metadata at path {namespace}/app-starters/v2/{appName}.json
  - [x] 5.4.4 Implement brown-out support in list() (continue on bucket failures)
  - [x] 5.4.5 Implement get() function to retrieve sidecar metadata
  - [x] 5.4.6 Skip starters without sidecar metadata and log warning
  - [x] 5.4.7 Parse sidecar metadata JSON (name, description, language, framework, features, prerequisites, author, license)
  - [x] 5.4.8 Verify ZIP file name matches GitHub repository name
  - [x] 5.4.9 Return error information for failed sources

### 6. Services (Requirements 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19)

- [x] 6.1 Implement Templates Service (src/lambda/read/services/templates.js)
  - [x] 6.1.1 Implement list() with cache-data pass-through caching
  - [x] 6.1.2 Support filtering by category
  - [x] 6.1.3 Support filtering by version (Human_Readable_Version)
  - [x] 6.1.4 Support filtering by versionId (S3_VersionId)
  - [x] 6.1.5 Support filtering by s3Buckets (validate against settings)
  - [x] 6.1.6 Set connection.host to array of buckets for cache key
  - [x] 6.1.7 Set connection.parameters for cache key and DAO filtering
  - [x] 6.1.8 Use Config.getConnCacheProfile('s3-templates', 'templates-list')
  - [x] 6.1.9 Implement get() with cache-data pass-through caching
  - [x] 6.1.10 Support version parameter (Human_Readable_Version)
  - [x] 6.1.11 Support versionId parameter (S3_VersionId)
  - [x] 6.1.12 Support OR condition when both version and versionId provided
  - [x] 6.1.13 Throw TEMPLATE_NOT_FOUND error with available templates
  - [x] 6.1.14 Implement listVersions() with cache-data pass-through caching
  - [x] 6.1.15 Use Config.getConnCacheProfile('s3-templates', 'template-versions')
  - [x] 6.1.16 Implement listCategories() function
  - [x] 6.1.17 Return category names, descriptions, and template counts
  - [x] 6.1.18 Use settings.templateCategories for category list
  - [x] 6.1.19 Implement checkUpdates() function
  - [x] 6.1.20 Compare current version with latest version from S3
  - [x] 6.1.21 Return update information (version, release date, changelog)
  - [x] 6.1.22 Indicate breaking changes and migration guide links
  - [x] 6.1.23 Support checking multiple templates in single request

- [x] 6.2 Implement Starters Service (src/lambda/read/services/starters.js)
  - [x] 6.2.1 Implement list() with cache-data pass-through caching
  - [x] 6.2.2 Support filtering by ghusers (validate against settings)
  - [x] 6.2.3 Set connection.host to array of GitHub users/orgs for cache key
  - [x] 6.2.4 Use Config.getConnCacheProfile('github-api', 'starters-list')
  - [x] 6.2.5 Aggregate starters from S3 buckets and GitHub users/orgs
  - [x] 6.2.6 Filter by atlantis_repository-type: app-starter
  - [x] 6.2.7 Indicate which starters include cache-data integration
  - [x] 6.2.8 Indicate which starters include CloudFront integration
  - [x] 6.2.9 Implement get() with cache-data pass-through caching
  - [x] 6.2.10 Prefer sidecar metadata from S3 when available
  - [x] 6.2.11 Skip starters without sidecar metadata and log warning
  - [x] 6.2.12 Return example code snippets from sidecar metadata
  - [x] 6.2.13 Indicate when starter repository is private

- [x] 6.3 Implement Documentation Service (src/lambda/read/services/documentation.js)
  - [x] 6.3.1 Implement search() with cache-data pass-through caching
  - [x] 6.3.2 Search across all configured GitHub users/orgs
  - [x] 6.3.3 Filter repositories by atlantis_repository-type custom property
  - [x] 6.3.4 Support keyword-based search with relevance ranking
  - [x] 6.3.5 Support filtering by documentation type (guide, tutorial, reference, troubleshooting, template pattern, code example)
  - [x] 6.3.6 Return search results with title, excerpt, file path, GitHub URL, result type
  - [x] 6.3.7 Indicate whether results are from documentation or code examples
  - [x] 6.3.8 Return code snippets with context (file path, line numbers, surrounding code)
  - [x] 6.3.9 Provide suggestions when no results found
  - [x] 6.3.10 Use Config.getConnCacheProfile('doc-index', 'search')

- [x] 6.4 Implement Validation Service (src/lambda/read/services/validation.js)
  - [x] 6.4.1 Implement validateNaming() function
  - [x] 6.4.2 Detect resource type from name pattern
  - [x] 6.4.3 Validate application resources: <Prefix>-<ProjectId>-<StageId>-<ResourceName>
  - [x] 6.4.4 Validate S3 buckets: <orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>
  - [x] 6.4.5 Validate alternative S3 pattern: <orgPrefix>-<Prefix>-<ProjectId>-<Region>
  - [x] 6.4.6 Verify Prefix matches template.yaml configuration
  - [x] 6.4.7 Verify ProjectId matches template.yaml configuration
  - [x] 6.4.8 Verify StageId matches allowed values
  - [x] 6.4.9 Verify ResourceName follows AWS resource naming rules
  - [x] 6.4.10 Return specific error messages for invalid components
  - [x] 6.4.11 Provide suggestions for correcting invalid names
  - [x] 6.4.12 Support validation of partial names
  - [x] 6.4.13 Validate names for S3, DynamoDB, Lambda, CloudFormation

### 7. Controllers (Requirements 14, 15, 16, 17, 18, 21)

- [x] 7.1 Implement Templates Controller (src/lambda/read/controllers/templates.js)
  - [x] 7.1.1 Implement list() function
  - [x] 7.1.2 Validate input against JSON Schema
  - [x] 7.1.3 Extract parameters (category, version, versionId, s3Buckets)
  - [x] 7.1.4 Call Services.Templates.list()
  - [x] 7.1.5 Return MCP-formatted response
  - [x] 7.1.6 Implement get() function
  - [x] 7.1.7 Validate input against JSON Schema
  - [x] 7.1.8 Extract parameters (templateName, category, version, versionId, s3Buckets)
  - [x] 7.1.9 Call Services.Templates.get()
  - [x] 7.1.10 Handle TEMPLATE_NOT_FOUND error with available templates
  - [x] 7.1.11 Return MCP-formatted response
  - [x] 7.1.12 Implement listVersions() function
  - [x] 7.1.13 Validate input against JSON Schema
  - [x] 7.1.14 Extract parameters (templateName, category, s3Buckets)
  - [x] 7.1.15 Call Services.Templates.listVersions()
  - [x] 7.1.16 Return MCP-formatted response
  - [x] 7.1.17 Implement listCategories() function
  - [x] 7.1.18 Call Services.Templates.listCategories()
  - [x] 7.1.19 Return MCP-formatted response

- [x] 7.2 Implement Starters Controller (src/lambda/read/controllers/starters.js)
  - [x] 7.2.1 Implement list() function
  - [x] 7.2.2 Validate input against JSON Schema
  - [x] 7.2.3 Extract parameters (ghusers)
  - [x] 7.2.4 Call Services.Starters.list()
  - [x] 7.2.5 Return MCP-formatted response
  - [x] 7.2.6 Implement get() function
  - [x] 7.2.7 Validate input against JSON Schema
  - [x] 7.2.8 Extract parameters (starterName, ghusers)
  - [x] 7.2.9 Call Services.Starters.get()
  - [x] 7.2.10 Return MCP-formatted response

- [x] 7.3 Implement Documentation Controller (src/lambda/read/controllers/documentation.js)
  - [x] 7.3.1 Implement search() function
  - [x] 7.3.2 Validate input against JSON Schema
  - [x] 7.3.3 Extract parameters (query, type, ghusers)
  - [x] 7.3.4 Call Services.Documentation.search()
  - [x] 7.3.5 Return MCP-formatted response with suggestions if no results

- [x] 7.4 Implement Validation Controller (src/lambda/read/controllers/validation.js)
  - [x] 7.4.1 Implement validate() function
  - [x] 7.4.2 Validate input against JSON Schema
  - [x] 7.4.3 Extract parameters (resourceName, resourceType)
  - [x] 7.4.4 Call Services.Validation.validateNaming()
  - [x] 7.4.5 Return MCP-formatted response with validation results and suggestions

- [-] 7.5 Implement Updates Controller (src/lambda/read/controllers/updates.js)
  - [x] 7.5.1 Implement check() function
  - [x] 7.5.2 Validate input against JSON Schema
  - [x] 7.5.3 Extract parameters (templateName, currentVersion, s3Buckets)
  - [x] 7.5.4 Call Services.Templates.checkUpdates()
  - [x] 7.5.5 Return MCP-formatted response with update information

### 8. Views (Requirement 21)

- [x] 8.1 Implement MCP Response Formatter (src/lambda/read/views/mcp-response.js)
  - [x] 8.1.1 Implement formatToolResponse() function
  - [x] 8.1.2 Format list_templates response
  - [x] 8.1.3 Format get_template response
  - [x] 8.1.4 Format list_template_versions response
  - [x] 8.1.5 Format list_categories response
  - [x] 8.1.6 Format list_starters response
  - [x] 8.1.7 Format get_starter_info response
  - [x] 8.1.8 Format search_documentation response
  - [x] 8.1.9 Format validate_naming response
  - [x] 8.1.10 Format check_template_updates response
  - [x] 8.1.11 Include tool descriptions for AI assistants
  - [x] 8.1.12 Include usage examples in tool descriptions

### 9. Error Handling and Logging (Requirement 22)

- [x] 9.1 Implement comprehensive error handling
  - [x] 9.1.1 Use DebugAndLog.error for fatal errors
  - [x] 9.1.2 Use DebugAndLog.warn for non-fatal errors (brown-out scenarios)
  - [x] 9.1.3 Use DebugAndLog.info for informational messages
  - [x] 9.1.4 Use DebugAndLog.debug for detailed debugging
  - [x] 9.1.5 Use DebugAndLog.diag for diagnostic information
  - [x] 9.1.6 Log all requests with timestamp, IP, tool name, execution time
  - [x] 9.1.7 Log all errors with stack traces and request context
  - [x] 9.1.8 Log S3 operation failures with bucket name, key, error details
  - [x] 9.1.9 Log GitHub API failures with repository, user/org, endpoint, error details
  - [x] 9.1.10 Log which specific bucket/org failed without exposing sensitive info
  - [x] 9.1.11 Return user-friendly error messages (no internal details)
  - [x] 9.1.12 Categorize errors as 4xx (client) or 5xx (server)
  - [x] 9.1.13 Include request IDs in error responses
  - [x] 9.1.14 Emit CloudWatch metrics for error rates, latency, cache performance
  - [x] 9.1.15 Implement structured logging with consistent format
  - [x] 9.1.16 Support configurable log levels via environment variables

### 10. Rate Limiting (Requirement 3)

- [x] 10.1 Configure API Gateway rate limiting
  - [x] 10.1.1 Set default rate limit to 100 requests per hour per IP
  - [x] 10.1.2 Make rate limit configurable via CloudFormation parameter
  - [x] 10.1.3 Track rate limits per IP address
  - [x] 10.1.4 Return HTTP 429 when rate limit exceeded
  - [x] 10.1.5 Include retry-after header in 429 responses
  - [x] 10.1.6 Reset request counts every hour
  - [x] 10.1.7 Include rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
  - [x] 10.1.8 Log rate limit violations to CloudWatch
  - [x] 10.1.9 Apply rate limiting globally across all resources

### 11. Testing (Requirement 25)

- [x] 11.1 Implement property-based tests for naming validation
  - [x] 11.1.1 Install fast-check for property-based testing
  - [x] 11.1.2 Test that valid application resource names always pass
  - [x] 11.1.3 Test that valid S3 bucket names always pass
  - [x] 11.1.4 Test that invalid names always fail with appropriate errors
  - [x] 11.1.5 Test partial name validation
  - [x] 11.1.6 Test edge cases (empty strings, special characters, length limits)
  - [x] 11.1.7 Verify error messages are helpful and specific

- [x] 11.2 Implement unit tests for Read Lambda
  - [x] 11.2.1 Mock AWS SDK calls (S3, DynamoDB, SSM)
  - [x] 11.2.2 Test cache hit scenarios
  - [x] 11.2.3 Test cache miss scenarios
  - [x] 11.2.4 Test rate limiting logic
  - [x] 11.2.5 Test error handling for all failure scenarios
  - [x] 11.2.6 Test brown-out support (partial data when sources fail)
  - [x] 11.2.7 Test multiple S3 bucket handling
  - [x] 11.2.8 Test multiple GitHub user/org handling
  - [x] 11.2.9 Test namespace discovery and priority ordering
  - [x] 11.2.10 Test template version handling (Human_Readable_Version and S3_VersionId)
  - [x] 11.2.11 Test sidecar metadata reading and exclusion
  - [x] 11.2.12 Test GitHub custom property filtering and exclusion
  - [x] 11.2.13 Test OR condition for version and versionId parameters
  - [x] 11.2.14 Test bucket access checking (atlantis-mcp:Allow tag)
  - [x] 11.2.15 Test namespace indexing (atlantis-mcp:IndexPriority tag)

- [x] 11.3 Implement unit tests for Controllers
  - [x] 11.3.1 Test Templates controller list() function
  - [x] 11.3.2 Test Templates controller get() function
  - [x] 11.3.3 Test Templates controller listVersions() function
  - [x] 11.3.4 Test Templates controller listCategories() function
  - [x] 11.3.5 Test Starters controller list() function
  - [x] 11.3.6 Test Starters controller get() function
  - [x] 11.3.7 Test Documentation controller search() function
  - [x] 11.3.8 Test Validation controller validate() function
  - [x] 11.3.9 Test Updates controller check() function
  - [x] 11.3.10 Test JSON Schema validation for all controllers
  - [x] 11.3.11 Test error handling in controllers

- [x] 11.4 Implement unit tests for Services
  - [x] 11.4.1 Test Templates service list() with caching
  - [x] 11.4.2 Test Templates service get() with caching
  - [x] 11.4.3 Test Templates service listVersions() with caching
  - [x] 11.4.4 Test Templates service listCategories()
  - [x] 11.4.5 Test Templates service checkUpdates()
  - [x] 11.4.6 Test Starters service list() with caching
  - [x] 11.4.7 Test Starters service get() with caching
  - [x] 11.4.8 Test Documentation service search() with caching
  - [x] 11.4.9 Test Validation service validateNaming()
  - [x] 11.4.10 Test service-level bucket filtering
  - [x] 11.4.11 Test service-level GitHub user/org filtering

- [x] 11.5 Implement unit tests for Models/DAOs
  - [x] 11.5.1 Test S3 Templates DAO list() function
  - [x] 11.5.2 Test S3 Templates DAO get() function
  - [x] 11.5.3 Test S3 Templates DAO listVersions() function
  - [x] 11.5.4 Test S3 Templates DAO checkBucketAccess()
  - [x] 11.5.5 Test S3 Templates DAO getIndexedNamespaces()
  - [x] 11.5.6 Test S3 Templates DAO parseCloudFormationTemplate()
  - [x] 11.5.7 Test S3 Templates DAO deduplicateTemplates()
  - [x] 11.5.8 Test S3 App Starters DAO list() function
  - [x] 11.5.9 Test S3 App Starters DAO get() function
  - [x] 11.5.10 Test GitHub API DAO listRepositories()
  - [x] 11.5.11 Test GitHub API DAO getRepository()
  - [x] 11.5.12 Test GitHub API DAO getCustomProperty()
  - [x] 11.5.13 Test GitHub API DAO getReadme()
  - [x] 11.5.14 Test GitHub API DAO getReleases()
  - [x] 11.5.15 Test GitHub API DAO rate limit handling
  - [x] 11.5.16 Test Documentation Index DAO buildIndex()
  - [x] 11.5.17 Test Documentation Index DAO search()

- [x] 11.6 Implement unit tests for Utilities
  - [x] 11.6.1 Test MCP protocol utilities successResponse()
  - [x] 11.6.2 Test MCP protocol utilities errorResponse()
  - [x] 11.6.3 Test JSON Schema validator validate()
  - [x] 11.6.4 Test naming rules validateApplicationResource()
  - [x] 11.6.5 Test naming rules validateS3Bucket()
  - [x] 11.6.6 Test naming rules suggestion generation

- [x] 11.7 Achieve code coverage targets
  - [x] 11.7.1 Run code coverage analysis
  - [x] 11.7.2 Identify uncovered code paths
  - [x] 11.7.3 Add tests for uncovered paths
  - [x] 11.7.4 Verify minimum 80% code coverage achieved

### 12. Documentation (Requirement 24)

- [x] 12.1 Create end-user documentation
  - [x] 12.1.1 Write README.md with overview and quick start
  - [x] 12.1.2 Document each MCP tool with examples
  - [x] 12.1.3 Create integration guide for Claude
  - [x] 12.1.4 Create integration guide for ChatGPT
  - [x] 12.1.5 Create integration guide for Cursor
  - [x] 12.1.6 Create integration guide for Kiro
  - [x] 12.1.7 Create integration guide for Amazon Q Developer
  - [x] 12.1.8 Document common use cases and patterns
  - [x] 12.1.9 Create troubleshooting guide for users

- [x] 12.2 Create organizational documentation
  - [x] 12.2.1 Write deployment guide using SAM configuration repository
  - [x] 12.2.2 Document all CloudFormation parameters
  - [x] 12.2.3 Document GitHub token setup and required scopes
  - [x] 12.2.4 Document GitHub custom properties setup
  - [x] 12.2.5 Document S3 bucket tagging (atlantis-mcp:Allow, atlantis-mcp:IndexPriority)
  - [x] 12.2.6 Create Python script for generating sidecar metadata files
  - [x] 12.2.7 Document sidecar metadata script usage in CodeBuild
  - [x] 12.2.8 Document sidecar metadata script usage in GitHub Actions
  - [x] 12.2.9 Document multiple S3 bucket configuration
  - [x] 12.2.10 Document multiple GitHub org configuration
  - [x] 12.2.11 Create self-hosting guide

- [x] 12.3 Create maintainer documentation
  - [x] 12.3.1 Create architecture diagrams (high-level, component, data flow)
  - [x] 12.3.2 Document Lambda function structure and organization
  - [x] 12.3.3 Document caching strategy and TTL configuration
  - [x] 12.3.4 Document brown-out support implementation
  - [x] 12.3.5 Document namespace discovery and priority ordering
  - [x] 12.3.6 Document template versioning (dual identifiers)
  - [x] 12.3.7 Document code pattern indexing
  - [x] 12.3.8 Create contribution guidelines
  - [x] 12.3.9 Document testing procedures and requirements
  - [x] 12.3.10 Document release process

### 13. Deployment and CI/CD (Requirements 1, 23)

- [x] 13.1 Configure SAM deployment
  - [x] 13.1.1 Create samconfig.toml for test environment
  - [x] 13.1.2 Create samconfig.toml for prod environment
  - [x] 13.1.3 Configure parameter overrides for test
  - [x] 13.1.4 Configure parameter overrides for prod
  - [x] 13.1.5 Test local SAM build
  - [x] 13.1.6 Test local SAM deployment to test environment

- [x] 13.2 Configure CI/CD pipeline
  - [x] 13.2.1 Update buildspec.yml with test execution
  - [x] 13.2.2 Update buildspec.yml with code coverage reporting
  - [x] 13.2.3 Configure CodePipeline for test branch
  - [x] 13.2.4 Configure CodePipeline for main branch
  - [x] 13.2.5 Configure deployment approval for prod
  - [x] 13.2.6 Test automated deployment to test environment
  - [x] 13.2.7 Test automated deployment to prod environment

- [x] 13.3 Configure GitHub releases
  - [x] 13.3.1 Create release workflow
  - [x] 13.3.2 Configure semantic versioning
  - [x] 13.3.3 Configure changelog generation
  - [x] 13.3.4 Test GitHub release creation

### 14. Monitoring and Operations (Requirement 22)

- [x] 14.1 Configure CloudWatch monitoring
  - [x] 14.1.1 Create CloudWatch dashboard for MCP server
  - [x] 14.1.2 Add Lambda invocation metrics
  - [x] 14.1.3 Add Lambda error rate metrics
  - [x] 14.1.4 Add Lambda duration metrics
  - [x] 14.1.5 Add API Gateway request metrics
  - [x] 14.1.6 Add API Gateway 4xx error metrics
  - [x] 14.1.7 Add API Gateway 5xx error metrics
  - [x] 14.1.8 Add DynamoDB cache hit/miss metrics
  - [x] 14.1.9 Add S3 cache hit/miss metrics
  - [x] 14.1.10 Create CloudWatch alarms for error rates
  - [x] 14.1.11 Create CloudWatch alarms for latency
  - [x] 14.1.12 Configure SNS notifications for alarms

- [x] 14.2 Configure log aggregation
  - [x] 14.2.1 Configure CloudWatch Logs retention (7 days test, 30 days prod)
  - [x] 14.2.2 Create log insights queries for common troubleshooting
  - [x] 14.2.3 Create log insights query for rate limit violations
  - [x] 14.2.4 Create log insights query for brown-out scenarios
  - [x] 14.2.5 Create log insights query for cache performance
  - [x] 14.2.6 Create log insights query for error analysis

### 15. Integration and End-to-End Testing (Requirement 25)

- [x] 15.1 Implement MCP protocol compliance tests
  - [x] 15.1.1 Test protocol negotiation
  - [x] 15.1.2 Test capability discovery
  - [x] 15.1.3 Test tool listing
  - [x] 15.1.4 Test tool invocation for each tool
  - [x] 15.1.5 Test error responses conform to MCP spec
  - [x] 15.1.6 Test JSON Schema validation

- [x] 15.2 Implement multi-source integration tests
  - [x] 15.2.1 Test multiple S3 bucket aggregation
  - [x] 15.2.2 Test multiple GitHub org aggregation
  - [x] 15.2.3 Test bucket priority ordering
  - [x] 15.2.4 Test GitHub user/org priority ordering
  - [x] 15.2.5 Test namespace discovery across buckets
  - [x] 15.2.6 Test template deduplication across buckets

- [x] 15.3 Implement caching integration tests
  - [x] 15.3.1 Test cache hit scenario
  - [x] 15.3.2 Test cache miss scenario
  - [x] 15.3.3 Test cache expiration
  - [x] 15.3.4 Test cache key generation
  - [x] 15.3.5 Test downstream caching (indexed patterns)

- [x] 15.4 Implement rate limiting integration tests
  - [x] 15.4.1 Test rate limit enforcement
  - [x] 15.4.2 Test rate limit headers
  - [x] 15.4.3 Test rate limit reset
  - [x] 15.4.4 Test 429 response format

- [x] 15.5 Implement GitHub integration tests
  - [x] 15.5.1 Test GitHub API authentication
  - [x] 15.5.2 Test GitHub custom property retrieval
  - [x] 15.5.3 Test GitHub rate limit handling
  - [x] 15.5.4 Test repository filtering by custom property
  - [x] 15.5.5 Test repository exclusion when custom property missing

- [x] 15.6 Implement S3 integration tests
  - [x] 15.6.1 Test S3 bucket access checking (atlantis-mcp:Allow tag)
  - [x] 15.6.2 Test namespace indexing (atlantis-mcp:IndexPriority tag)
  - [x] 15.6.3 Test template version retrieval (Human_Readable_Version)
  - [x] 15.6.4 Test template version retrieval (S3_VersionId)
  - [x] 15.6.5 Test OR condition for version and versionId
  - [x] 15.6.6 Test sidecar metadata retrieval
  - [x] 15.6.7 Test starter exclusion when sidecar metadata missing

### 16. Final Validation and Cleanup

- [x] 16.1 Code quality validation
  - [x] 16.1.1 Run ESLint and fix all issues
  - [x] 16.1.2 Run code formatter (Prettier)
  - [x] 16.1.3 Remove all console.log statements (use DebugAndLog)
  - [x] 16.1.4 Remove all TODO comments
  - [x] 16.1.5 Verify no hardcoded credentials or secrets
  - [x] 16.1.6 Verify all imports use relative paths

- [x] 16.2 Documentation review
  - [x] 16.2.1 Review all JSDoc comments for accuracy
  - [x] 16.2.2 Review README.md for completeness
  - [x] 16.2.3 Review integration guides for accuracy
  - [x] 16.2.4 Review deployment guide for accuracy
  - [x] 16.2.5 Review architecture diagrams for accuracy

- [x] 16.3 Testing review
  - [x] 16.3.1 Verify all unit tests pass
  - [x] 16.3.2 Verify all integration tests pass
  - [x] 16.3.3 Verify all property-based tests pass
  - [x] 16.3.4 Verify code coverage meets 80% minimum
  - [x] 16.3.5 Review test coverage report for gaps

- [x] 16.4 Deployment validation
  - [x] 16.4.1 Deploy to test environment
  - [x] 16.4.2 Verify all MCP tools work in test
  - [x] 16.4.3 Verify rate limiting works in test
  - [x] 16.4.4 Verify caching works in test
  - [x] 16.4.5 Verify brown-out support works in test
  - [x] 16.4.6 Deploy to prod environment
  - [x] 16.4.7 Verify all MCP tools work in prod
  - [x] 16.4.8 Verify monitoring and alarms work in prod

- [x] 16.5 Performance validation
  - [x] 16.5.1 Test cold start performance
  - [x] 16.5.2 Test warm invocation performance
  - [x] 16.5.3 Test cache hit performance
  - [x] 16.5.4 Test cache miss performance
  - [x] 16.5.5 Verify Lambda memory configuration is optimal
  - [x] 16.5.6 Verify Lambda timeout configuration is appropriate

- [x] 16.6 Security validation
  - [x] 16.6.1 Review IAM permissions for least privilege
  - [x] 16.6.2 Verify no secrets in environment variables
  - [x] 16.6.3 Verify all secrets retrieved from SSM
  - [x] 16.6.4 Verify rate limiting prevents abuse
  - [x] 16.6.5 Verify error messages don't leak sensitive information
  - [x] 16.6.6 Run security scan on dependencies

- [x] 16.7 Update CHANGELOG.md
  - [x] 16.7.1 Document all Phase 1 features
  - [x] 16.7.2 Document all MCP tools
  - [x] 16.7.3 Document deployment requirements
  - [x] 16.7.4 Document breaking changes (if any)
  - [x] 16.7.5 Document known limitations

## Task Dependencies

### Critical Path

The following tasks must be completed in order:

1. **Project Setup** (Section 1) → All other sections depend on this
2. **Configuration and Settings** (Section 2) → Required by all runtime components
3. **Lambda Handler and Routing** (Section 3) → Required by Controllers
4. **Utilities and Protocol Support** (Section 4) → Required by Controllers and Services
5. **Models/DAOs** (Section 5) → Required by Services
6. **Services** (Section 6) → Required by Controllers
7. **Controllers** (Section 7) → Required by Router
8. **Views** (Section 8) → Required by Controllers
9. **Error Handling and Logging** (Section 9) → Required by all components
10. **Rate Limiting** (Section 10) → Required for deployment
11. **Testing** (Section 11) → Can be done in parallel with implementation
12. **Documentation** (Section 12) → Can be done in parallel with implementation
13. **Deployment and CI/CD** (Section 13) → Requires completed implementation
14. **Monitoring and Operations** (Section 14) → Requires deployment
15. **Integration and E2E Testing** (Section 15) → Requires deployment
16. **Final Validation and Cleanup** (Section 16) → Final step

### Parallel Work Opportunities

The following sections can be worked on in parallel:

- **Testing** (Section 11) can be done alongside implementation (Sections 5-8)
- **Documentation** (Section 12) can be done alongside implementation (Sections 5-8)
- **Unit tests for each component** can be written immediately after implementing that component

### Blocking Dependencies

- **Controllers** (Section 7) are blocked until Services (Section 6) are complete
- **Services** (Section 6) are blocked until Models/DAOs (Section 5) are complete
- **Integration Tests** (Section 15) are blocked until Deployment (Section 13) is complete
- **Final Validation** (Section 16) is blocked until all other sections are complete

## Notes

### Implementation Order Recommendation

For optimal development flow, implement in this order:

1. Complete Project Setup (Section 1)
2. Complete Configuration (Section 2)
3. Implement one complete vertical slice (e.g., list_templates):
   - DAO → Service → Controller → Route → Handler → Test
4. Repeat for remaining tools
5. Add Views, Error Handling, Rate Limiting
6. Complete Documentation
7. Deploy and test
8. Final validation

### Testing Strategy

- Write unit tests immediately after implementing each component
- Run tests frequently during development
- Use TDD (Test-Driven Development) for complex logic (naming validation, brown-out support)
- Write integration tests after deployment
- Use property-based tests for validation logic

### Code Review Checkpoints

Recommended code review checkpoints:

1. After completing Project Setup and Configuration
2. After completing first vertical slice (list_templates)
3. After completing all DAOs
4. After completing all Services
5. After completing all Controllers
6. Before deployment
7. After integration testing

### Phase 1 Scope Reminder

Phase 1 is **read-only operations only**. The following are explicitly out of scope:

- Write operations (repository creation, template modification)
- Authentication and authorization
- User-specific features
- Advanced AI integration
- CodeCommit repository support
- Template version comparison tool

These features will be addressed in future phases.
