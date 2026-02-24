# Requirements Document: Atlantis MCP Server - Phase 1 (Core Read-Only)

## Introduction

This document specifies the requirements for Phase 1 of the Atlantis MCP (Model Context Protocol) Server. The Atlantis MCP Server provides AI-assisted development capabilities for the 63Klabs Atlantis Templates and Scripts Platform, enabling developers to discover, validate, and utilize CloudFormation templates, starter code, and documentation through AI assistants and IDEs.

Phase 1 focuses on establishing the core MCP server infrastructure with read-only operations, public access with rate limiting, and integration with the Atlantis platform components. This phase lays the foundation for future write operations (Phase 2) and advanced AI integration features (Phases 3-4).

The MCP server follows Atlantis deployment patterns, using the atlantis-starter-02 structure as its foundation, and is deployed using the same CloudFormation templates and CI/CD pipelines that it helps developers utilize.

## Glossary

- **MCP_Server**: The Model Context Protocol server that exposes Atlantis platform capabilities to AI assistants and development tools
- **Atlantis_Platform**: The collection of CloudFormation templates, SAM configuration scripts, starter code repositories, and documentation maintained by 63Klabs
- **Template_Library**: The CloudFormation template repository stored in S3 with versioned templates for Storage, Network, Pipeline, Service Role, and Modules stacks
- **SAM_Config_Repo**: The repository containing Python scripts (config.py, deploy.py, create_repo.py, etc.) for infrastructure management
- **Starter_Code**: Pre-configured repository templates that provide serverless application scaffolding with CI/CD integration
- **Cache_Data_Package**: The @63klabs/cache-data npm package providing caching, routing, and AWS SDK integration for Lambda functions
- **Read_Lambda**: The Lambda function handling all read-only MCP operations with minimal AWS permissions
- **Rate_Limiter**: The API Gateway throttling mechanism that enforces request limits per IP address for public access
- **Template_Metadata**: Information about CloudFormation templates including version, parameters, description, S3 location, and version identifiers
- **Naming_Convention**: The Atlantis resource naming pattern: `<Prefix>-<ProjectId>-<StageId>-*`
- **Public_Access**: Unauthenticated API access with rate limiting for read-only operations
- **S3_Template_Bucket**: The S3 bucket hosting versioned CloudFormation templates for public or organizational use
- **GitHub_Metadata**: Repository information including name, description, README content, release information, and custom properties
- **Documentation_Index**: Searchable index of Atlantis documentation, tutorial content, and code patterns from templates and starters
- **MCP_Tool**: An MCP protocol operation exposed to AI assistants (e.g., list_templates, validate_naming)
- **TTL**: Time-to-live for cached data, configurable per resource type
- **Namespace**: A root-level directory in S3 buckets organizing templates and starters (e.g., atlantis/, finance/, devops/)
- **Template_Category**: Classification of templates (Storage, Network, Pipeline, Service Role, Modules)
- **Repository_Type**: GitHub custom property or CodeCommit tag identifying repository purpose (documentation, app-starter, templates, management, package, mcp)
- **Human_Readable_Version**: Template version in format vX.X.X/YYYY-MM-DD appearing in template comments
- **S3_VersionId**: S3 bucket versioning identifier for tracking template history
- **Bucket_Priority**: Order of S3 buckets to search, determined by bucket order in configuration or atlantis-mcp:IndexPriority tag - **TODO CHANGE**: Bucket Priority is established by the order of buckets in the comma delimited value passed to the CloudFormation template (and passed on to Lambda). The atlantis-mcp:IndexPriority tag is per-bucket for the **Namespace** within each bucket. (Note, this is stated correctly in Requirement 4)
- **Sidecar_Metadata**: JSON file stored alongside app starter ZIP files containing metadata (e.g., startername.json)
- **Brown_Out_Support**: Capability to return partial data when some data sources fail while continuing to serve available data

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
2. THE Read_Lambda SHALL have IAM permissions limited to S3 GetObject, S3 ListBucket, S3 GetObjectVersion, DynamoDB read operations, and SSM GetParameter
3. THE Read_Lambda SHALL NOT have permissions for S3 PutObject, DynamoDB write operations, or repository creation
4. THE Read_Lambda SHALL handle all Phase 1 MCP tools (list_templates, get_template, list_starters, get_starter_info, search_documentation, validate_naming, check_template_updates, list_template_versions, list_categories, list_template_history)
5. THE MCP_Server SHALL reserve write operations for a separate Write_Lambda in Phase 2
6. THE Read_Lambda SHALL use the Cache_Data_Package routing mechanism to organize operations into modules
7. THE Read_Lambda SHALL log all operations to CloudWatch with request metadata
8. WHEN an unauthorized operation is requested, THE Read_Lambda SHALL return an error indicating the operation requires authentication
9. THE Read_Lambda SHALL be named following Naming_Convention: `${Prefix}-${ProjectId}-${StageId}-ReadFunction`
10. THE Read_Lambda execution role SHALL support attaching additional managed policies via ReadLambdaExecRoleIncludeManagedPolicyArns CloudFormation parameter

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
10. THE Rate_Limiter SHALL apply globally across all resources (not per-bucket or per-org) for the 63klabs hosted version

### Requirement 4: Multiple S3 Bucket Support

**User Story:** As an organization, I want to configure multiple S3 buckets for templates and starters, so that I can use custom templates alongside 63klabs templates with priority ordering.

#### Acceptance Criteria

1. THE MCP_Server SHALL support multiple S3_Template_Buckets configured via comma-delimited ATLANTIS_S3_BUCKETS environment variable
2. THE MCP_Server SHALL split the comma-delimited ATLANTIS_S3_BUCKETS into an array for use in Lambda functions
3. THE MCP_Server SHALL only access S3 buckets that have the tag `atlantis-mcp:Allow=true`
4. WHEN an S3 bucket does not have `atlantis-mcp:Allow=true` tag, THE MCP_Server SHALL log a warning and skip that bucket
5. THE MCP_Server SHALL discover Namespaces by examining root-level directories in each S3 bucket
6. THE MCP_Server SHALL only index Namespaces listed in the S3 bucket tag `atlantis-mcp:IndexPriority`
7. THE atlantis-mcp:IndexPriority tag SHALL contain a comma-delimited list of Namespace names (e.g., "devops,finance,atlantis")
8. THE MCP_Server SHALL use the order of buckets in ATLANTIS_S3_BUCKETS as Bucket_Priority for searching
9. WHEN searching for templates or starters, THE MCP_Server SHALL iterate through buckets in priority order
10. WHEN multiple buckets contain the same template, THE MCP_Server SHALL use the template from the highest priority bucket
11. THE MCP_Server SHALL support optional s3Buckets filtering in service layer options (validated against atlantisS3Buckets from settings)
12. WHEN s3Buckets filter is provided, THE MCP_Server SHALL only search the specified buckets
13. WHEN s3Buckets filter is not provided, THE MCP_Server SHALL search all configured buckets
14. THE MCP_Server SHALL include bucket name in cache keys to differentiate results from different buckets
15. FOR list operations, THE MCP_Server SHALL aggregate results from all buckets in priority order

### Requirement 5: Multiple GitHub Organization Support

**User Story:** As an organization, I want to configure multiple GitHub users/orgs for repositories, so that I can discover starters and documentation from multiple sources with priority ordering.

#### Acceptance Criteria

1. THE MCP_Server SHALL support multiple GitHub users/orgs configured via comma-delimited ATLANTIS_GITHUB_USER_ORGS environment variable
2. THE MCP_Server SHALL split the comma-delimited ATLANTIS_GITHUB_USER_ORGS into an array for use in Lambda functions
3. THE MCP_Server SHALL use the order of users/orgs in ATLANTIS_GITHUB_USER_ORGS as priority for searching
4. WHEN searching for repositories, THE MCP_Server SHALL iterate through users/orgs in priority order
5. WHEN multiple users/orgs contain the same repository, THE MCP_Server SHALL use the repository from the highest priority user/org
6. THE MCP_Server SHALL support optional ghusers filtering in service layer options (validated against githubUsers from settings)
7. WHEN ghusers filter is provided, THE MCP_Server SHALL only search the specified users/orgs
8. WHEN ghusers filter is not provided, THE MCP_Server SHALL search all configured users/orgs
9. THE MCP_Server SHALL include user/org name in cache keys to differentiate results from different sources
10. FOR list operations, THE MCP_Server SHALL aggregate results from all users/orgs in priority order
11. THE MCP_Server SHALL implement GitHub API rate limit handling (respect X-RateLimit-* headers)
12. THE MCP_Server SHALL cache GitHub API responses using Cache_Data_Package to reduce API calls
13. THE MCP_Server SHALL document GitHub token requirements including required scopes and rate limits
14. WHEN GitHub API rate limits are exceeded, THE MCP_Server SHALL return cached data with staleness indicator

### Requirement 6: GitHub Custom Properties and Repository Filtering

**User Story:** As an organization, I want to use GitHub custom properties to identify repository types, so that the MCP server can accurately discover and categorize repositories.

#### Acceptance Criteria

1. THE MCP_Server SHALL query GitHub custom property `atlantis_repository-type` for each repository
2. THE atlantis_repository-type custom property SHALL support values: documentation, app-starter, templates, management, package, mcp
3. THE MCP_Server SHALL use GitHub Repository Properties API to retrieve custom properties
4. WHEN atlantis_repository-type custom property is not set, THE MCP_Server SHALL fall back to repository name patterns - **CHANGE** the absence of atlantis_repository-type property should be used to EXCLUDE repos. This makes inclusion by the org deliberate
5. THE name pattern fallback SHALL identify app-starter repositories by name containing "starter" - **TODO CHANGE** no fallbacks
6. THE name pattern fallback SHALL identify SAM config repositories by name containing "sam-config" - **TODO CHANGE** no fallbacks
7. THE MCP_Server SHALL filter repositories by atlantis_repository-type when listing starters
8. THE MCP_Server SHALL filter repositories by atlantis_repository-type when searching documentation
9. THE MCP_Server SHALL document how organizations should set up custom properties on their repositories
10. THE MCP_Server SHALL support organizations that do not use custom properties through name pattern fallback - **TODO CHANGE** no fallbacks

### Requirement 7: S3 Namespace Discovery and Indexing

**User Story:** As an organization, I want the MCP server to discover and index templates from multiple namespaces in S3, so that I can organize templates by department or purpose.

#### Acceptance Criteria

1. THE MCP_Server SHALL discover Namespaces by listing root-level directories in each S3 bucket
2. THE MCP_Server SHALL only index Namespaces listed in the S3 bucket tag `atlantis-mcp:IndexPriority`
3. THE atlantis-mcp:IndexPriority tag value SHALL be a comma-delimited list of Namespace names
4. THE order of Namespaces in atlantis-mcp:IndexPriority SHALL determine indexing priority
5. WHEN atlantis-mcp:IndexPriority tag is not present, THE MCP_Server SHALL log a warning and skip that bucket
6. THE MCP_Server SHALL support Namespace directory structure: `{namespace}/templates/v2/{category}/{templateName}`
7. THE MCP_Server SHALL support Namespace directory structure: `{namespace}/app-starters/v2/{appName}.zip`
8. THE MCP_Server SHALL aggregate templates from all Namespaces across all buckets
9. WHEN multiple Namespaces contain the same template, THE MCP_Server SHALL use the template from the highest priority Namespace
10. THE MCP_Server SHALL include Namespace information in Template_Metadata responses

### Requirement 8: Template Versioning with Dual Identifiers

**User Story:** As a developer, I want to access templates by human-readable version or S3 version ID, so that I can retrieve specific versions for comparison or rollback.

#### Acceptance Criteria

1. THE MCP_Server SHALL support Human_Readable_Version in format vX.X.X/YYYY-MM-DD from template comments
2. THE MCP_Server SHALL support S3_VersionId from S3 bucket versioning
3. THE list_templates tool SHALL return both Human_Readable_Version and S3_VersionId in Template_Metadata
4. THE get_template tool SHALL accept optional version parameter (Human_Readable_Version)
5. THE get_template tool SHALL accept optional versionId parameter (S3_VersionId)
6. WHEN both version and versionId are provided, THE get_template tool SHALL treat them as OR condition (version == x OR versionId == y)
7. WHEN both version and versionId match different template versions, THE get_template tool SHALL return all matching versions
8. THE MCP_Server SHALL use AWS SDK v3 S3 GetObjectCommand with VersionId parameter to retrieve specific versions
9. THE MCP_Server SHALL parse Human_Readable_Version from template comment: `# Version: vX.X.X/YYYY-MM-DD`
10. THE MCP_Server SHALL include both version identifiers in all Template_Metadata responses

### Requirement 9: Template Version History Tools

**User Story:** As a developer, I want to list all versions of a template and view version history, so that I can track changes and compare versions.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a list_template_versions tool that returns all versions of a specific template
2. THE list_template_versions tool SHALL accept templateName and optional category as input
3. THE list_template_versions tool SHALL use S3 ListObjectVersions API to retrieve all versions
4. THE list_template_versions tool SHALL return version metadata including S3_VersionId, Human_Readable_Version, LastModified date, and size
5. THE list_template_versions tool SHALL sort versions by LastModified date (newest first)
6. THE MCP_Server SHALL provide a list_template_history tool that shows version history with changelog information
7. THE list_template_history tool SHALL include author and date information for each version
8. THE list_template_history tool SHALL parse version information from template content for each version
9. WHEN a template has no version history (single version), THE list_template_history tool SHALL return the current version only
10. THE MCP_Server SHALL cache version lists using Cache_Data_Package with short TTL (5 minutes) - **TODO CHANGE** 60 minutes

### Requirement 10: Template Categories Including Modules

**User Story:** As a developer, I want to discover templates by category including reusable modules, so that I can find the right template type for my needs.

#### Acceptance Criteria

1. THE MCP_Server SHALL support Template_Category values: Storage, Network, Pipeline, Service Role, Modules
2. THE Modules category SHALL contain reusable CloudFormation definitions (S3 buckets, CodeBuild projects, etc.)
3. THE MCP_Server SHALL provide a list_categories tool that returns all available Template_Category values
4. THE list_categories tool SHALL return category names and descriptions
5. THE list_categories tool SHALL indicate the number of templates in each category
6. THE MCP_Server SHALL store Template_Category values in settings.js for future extensibility
7. THE list_templates tool SHALL support filtering by Template_Category including Modules
8. THE MCP_Server SHALL validate category parameter against known Template_Category values
9. WHEN an invalid category is provided, THE MCP_Server SHALL return an error with available categories
10. THE MCP_Server SHALL index Modules templates for discovery and reference

### Requirement 11: App Starter Sidecar Metadata

**User Story:** As an organization, I want to store app starter metadata in sidecar JSON files, so that the MCP server can provide rich information without extracting ZIP files.

#### Acceptance Criteria

1. THE MCP_Server SHALL support Sidecar_Metadata files stored as `{appName}.json` alongside `{appName}.zip` in S3
2. THE Sidecar_Metadata file SHALL contain: name, description, language, framework, features, prerequisites, author, license
3. THE get_starter_info tool SHALL read Sidecar_Metadata from S3 when available
4. WHEN Sidecar_Metadata is not available, THE get_starter_info tool SHALL fall back to GitHub repository metadata **TODO CHANGE** - without a sidecar we won't know what github repo to use. Sure we know the name, but what user/org? So if no sidecar, we don't include. This allows orgs to be intentional about including. We should issue a warning if no sidecar found. Skip and do not extract zip.
5. THE MCP_Server SHALL prefer Sidecar_Metadata over GitHub metadata when both are available
6. THE MCP_Server SHALL document how to generate Sidecar_Metadata files during CI/CD deployment
7. THE documentation SHALL include a Python script for generating Sidecar_Metadata from GitHub repository
8. THE Python script SHALL be suitable for use in CodeBuild or GitHub Actions
9. THE Sidecar_Metadata SHALL include extracted information from GitHub custom property `atlantis_repository-type`
10. THE app starter ZIP file name SHALL match the GitHub repository name

### Requirement 12: Documentation and Code Pattern Indexing

**User Story:** As a developer, I want to search for code patterns and implementation examples from templates and starters, so that I can learn best practices and design patterns.

#### Acceptance Criteria

1. THE Documentation_Index SHALL include code patterns from CloudFormation templates
2. THE Documentation_Index SHALL include code patterns from app starter source code
3. THE Documentation_Index SHALL index CloudFormation template sections: Metadata, Parameters, Mappings, Conditions, Resources, Outputs
4. THE Documentation_Index SHALL index CloudFormation resource definitions and patterns
5. THE Documentation_Index SHALL index Python and Node.js functions from app starters
6. THE Documentation_Index SHALL index Cache_Data_Package usage patterns from app starters
7. THE Documentation_Index SHALL index README headings from templates and starters
8. THE Documentation_Index SHALL index top-of-file comments from source code files
9. THE search_documentation tool SHALL search across markdown documentation AND code patterns
10. THE search_documentation tool SHALL indicate whether results are from documentation or code examples
11. THE MCP_Server SHALL build Documentation_Index for template repo and Cache_Data_Package at Lambda cold start
12. THE MCP_Server SHALL build Documentation_Index for app starter code asynchronously or on-demand
13. THE search_documentation tool SHALL return code snippets with context (file path, line numbers, surrounding code)
14. THE search_documentation tool SHALL support filtering by result type (documentation, template pattern, code example)
15. THE MCP_Server SHALL cache indexed code patterns using Cache_Data_Package with configurable TTL

### Requirement 13: Brown-Out Support for Partial Data

**User Story:** As a developer, I want the MCP server to return available data even when some sources fail, so that I can still access information from working sources.

#### Acceptance Criteria

1. THE MCP_Server SHALL implement Brown_Out_Support for all list and search operations
2. WHEN one S3 bucket fails, THE MCP_Server SHALL continue searching other buckets and return available results
3. WHEN one GitHub user/org fails, THE MCP_Server SHALL continue searching other users/orgs and return available results
4. THE MCP_Server SHALL include error information in responses indicating which sources failed
5. THE error information SHALL include bucket name or user/org name but SHALL NOT include sensitive details
6. THE MCP_Server SHALL log all source failures with full error details to CloudWatch
7. THE MCP_Server SHALL use DebugAndLog.error for fatal errors that prevent all data retrieval
8. THE MCP_Server SHALL use DebugAndLog.warn for non-fatal errors where partial data is available
9. THE MCP_Server SHALL indicate in responses when partial data is returned due to source failures
10. THE MCP_Server SHALL continue operation and return best available data rather than failing completely

### Requirement 14: Template Discovery and Retrieval

**User Story:** As a developer using an AI assistant, I want to discover available CloudFormation templates, so that I can choose the appropriate template for my infrastructure needs.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a list_templates tool that returns all available CloudFormation templates from configured S3 buckets
2. THE list_templates tool SHALL return Template_Metadata including name, Human_Readable_Version, S3_VersionId, category, description, Namespace, bucket name, and S3 path
3. THE list_templates tool SHALL support filtering by Template_Category (Storage, Network, Pipeline, Service Role, Modules)
4. THE list_templates tool SHALL support filtering by version (latest, specific version, all versions)
5. THE list_templates tool SHALL support filtering by s3Buckets (specific buckets from configured list)
6. THE MCP_Server SHALL provide a get_template tool that retrieves a specific template with full metadata
7. THE get_template tool SHALL return the template content, parameters, outputs, Human_Readable_Version, and S3_VersionId
8. THE get_template tool SHALL parse template parameters and provide descriptions for each parameter
9. THE get_template tool SHALL support both .yml and .yaml file extensions (.yml takes precedence if both exist)
10. WHEN a template does not exist, THE get_template tool SHALL return an error with available template names
11. THE MCP_Server SHALL cache Template_Metadata using Cache_Data_Package with configurable TTL
12. THE MCP_Server SHALL aggregate templates from all configured S3 buckets and Namespaces
13. THE MCP_Server SHALL apply Bucket_Priority when multiple buckets contain the same template
14. THE MCP_Server SHALL include Namespace and bucket information in all Template_Metadata responses
15. THE MCP_Server SHALL support retrieval of specific template versions using version or versionId parameters

### Requirement 15: Starter Code Discovery

**User Story:** As a developer, I want to discover available starter code repositories, so that I can quickly bootstrap new serverless projects.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a list_starters tool that returns all available starter code repositories
2. THE list_starters tool SHALL retrieve starter information from configured S3 buckets at path `{namespace}/app-starters/v2/{appName}.zip`
3. THE list_starters tool SHALL return starter metadata from Sidecar_Metadata files (`{appName}.json`) when available
4. THE list_starters tool SHALL return starter metadata including name, description, language (Node.js, Python), framework, features, prerequisites, and GitHub URL
5. THE list_starters tool SHALL indicate which starters include cache-data integration
6. THE list_starters tool SHALL indicate which starters include CloudFront integration
7. THE list_starters tool SHALL support filtering by ghusers (specific GitHub users/orgs from configured list)
8. THE list_starters tool SHALL aggregate starters from all configured S3 buckets and GitHub users/orgs
9. THE MCP_Server SHALL provide a get_starter_info tool that retrieves detailed information about a specific starter
10. THE get_starter_info tool SHALL prefer Sidecar_Metadata from S3 over GitHub_Metadata when both are available
11. THE get_starter_info tool SHALL use GitHub_Metadata API to retrieve README content, latest release, and repository statistics when Sidecar_Metadata is unavailable **TODO CHANGE** - without a sidecar we won't know what github repo to use. Sure we know the name, but what user/org? So if no sidecar, we don't include. This allows orgs to be intentional about including. We should issue a warning if no sidecar found. Skip and do not extract zip.
12. THE get_starter_info tool SHALL filter GitHub repositories by custom property `atlantis_repository-type: app-starter`
13. THE get_starter_info tool SHALL fall back to repository name patterns (containing "starter") when custom property is not set **TODO CHANGE** We are going to make custom properties intentional so repos can be excluded by org
14. THE get_starter_info tool SHALL return example code snippets from the starter repository
15. WHEN a starter repository is private, THE get_starter_info tool SHALL indicate authentication is required for full access
16. THE MCP_Server SHALL cache starter metadata using Cache_Data_Package with configurable TTL
17. THE app starter ZIP file name SHALL match the GitHub repository name

### Requirement 16: Documentation Search

**User Story:** As a developer, I want to search Atlantis documentation and tutorials, so that I can find relevant information for my current task.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a search_documentation tool that searches Atlantis documentation, tutorials, and code patterns
2. THE search_documentation tool SHALL search across all configured GitHub users/orgs repositories
3. THE search_documentation tool SHALL filter repositories by custom property `atlantis_repository-type` (all values: documentation, app-starter, templates, management, package, mcp)
4. THE search_documentation tool SHALL fall back to repository name patterns when custom property is not set
5. THE search_documentation tool SHALL support keyword-based search with relevance ranking
6. THE search_documentation tool SHALL return search results including title, excerpt, file path, GitHub URL, and result type
7. THE search_documentation tool SHALL support filtering by documentation type (guide, tutorial, reference, troubleshooting, template pattern, code example)
8. THE search_documentation tool SHALL retrieve full document content when requested
9. THE search_documentation tool SHALL parse Markdown documents and extract code examples
10. THE search_documentation tool SHALL index and search code patterns from CloudFormation templates
11. THE search_documentation tool SHALL index and search code patterns from app starter source code
12. THE search_documentation tool SHALL indicate whether results are from documentation or code examples
13. THE search_documentation tool SHALL return code snippets with context (file path, line numbers, surrounding code)
14. WHEN no results are found, THE search_documentation tool SHALL suggest related topics or alternative search terms
15. THE MCP_Server SHALL build a Documentation_Index from GitHub repositories on startup for template repo and Cache_Data_Package
16. THE MCP_Server SHALL build Documentation_Index for app starter code asynchronously or on-demand
17. THE MCP_Server SHALL refresh the Documentation_Index periodically (configurable TTL)
18. THE MCP_Server SHALL cache indexed code patterns using Cache_Data_Package with configurable TTL

### Requirement 17: Naming Convention Validation

**User Story:** As a developer, I want to validate project names against Atlantis conventions, so that my resources follow organizational standards.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a validate_naming tool that validates resource names against the Naming_Convention
2. THE validate_naming tool SHALL validate the pattern `<Prefix>-<ProjectId>-<StageId>-<ResourceName>` **TODO UPDATE** S3 buckets follow a different naming pattern, `<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>` where orgPrefix and StageId are optional. `<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<ResourceName>` is also accepted for S3 where orgPrefix and StageId is optional. HOWEVER StageId is never optional in Application templates, but is is optional in High Level templates since some resources may be shared (such as DynamoDB tables, S3 buckets). `<orgPrefix>-<Prefix>-<ProjectId>-<StageId>-<Region>-<AccountId>` is preferred for S3 buckets (with orgPrefix and Stageid optional)
3. THE validate_naming tool SHALL verify Prefix (established in template.yaml)
4. THE validate_naming tool SHALL verify ProjectId (established in template.yaml)
5. THE validate_naming tool SHALL verify StageId matches allowed values (established in template.yaml)
6. THE validate_naming tool SHALL verify ResourceName follows AWS resource naming rules for the specified resource type
7. WHEN validation fails, THE validate_naming tool SHALL return specific error messages indicating which component is invalid
8. THE validate_naming tool SHALL provide suggestions for correcting invalid names
9. THE validate_naming tool SHALL validate names for S3 buckets, DynamoDB tables, Lambda functions, and CloudFormation stacks
10. THE validate_naming tool SHALL support validation of partial names (e.g., just Prefix-ProjectId)

### Requirement 18: Template Update Checking

**User Story:** As a developer, I want to check if my CloudFormation templates have newer versions available, so that I can keep my infrastructure up to date.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide a check_template_updates tool that compares template versions
2. THE check_template_updates tool SHALL accept a template name and current version as input
3. THE check_template_updates tool SHALL query configured S3 buckets for the latest version of the specified template
4. WHEN a newer version exists, THE check_template_updates tool SHALL return the Human_Readable_Version, S3_VersionId, release date, and changelog summary
5. WHEN the current version is latest, THE check_template_updates tool SHALL indicate no updates are available
6. THE check_template_updates tool SHALL support checking multiple templates in a single request
7. THE check_template_updates tool SHALL indicate breaking changes in version updates
8. THE check_template_updates tool SHALL provide migration guide links for breaking changes
9. THE MCP_Server SHALL cache version information using Cache_Data_Package with short TTL (5 minutes) **TODO CHANGE** 60 minutes
10. WHEN a template name is invalid, THE check_template_updates tool SHALL return available template names

### Requirement 19: Caching Strategy

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
9. THE MCP_Server SHALL include bucket name and Namespace in cache keys to differentiate results from different sources
10. THE MCP_Server SHALL include GitHub user/org in cache keys to differentiate results from different sources
11. THE MCP_Server SHALL support downstream caching for processed data (e.g., indexed code patterns cached separately from raw templates) 
**TODO UPDATE** All TTLs should be stored in settings.js in a ttl property within settings. For example settings.ttl.fullTemplateContent and set by the environment variable from deployment.

### Requirement 20: GitHub Integration

**User Story:** As a developer, I want the MCP server to retrieve information from GitHub repositories, so that I can access the latest documentation and starter code details.

#### Acceptance Criteria

1. THE MCP_Server SHALL use GitHub API to retrieve repository metadata
2. THE MCP_Server SHALL retrieve GitHub custom property `atlantis_repository-type` using Repository Properties API
3. THE MCP_Server SHALL retrieve README content from GitHub repositories
4. THE MCP_Server SHALL retrieve release information including version numbers and release notes
5. THE MCP_Server SHALL retrieve repository statistics (stars, forks, last updated)
6. THE MCP_Server SHALL support both public 63klabs repositories and private organizational repositories
7. THE MCP_Server SHALL support multiple GitHub users/orgs configured via ATLANTIS_GITHUB_USER_ORGS
8. WHEN accessing private repositories, THE MCP_Server SHALL check if there is a valid credential and have the user refresh the login if not
9. THE MCP_Server SHALL cache GitHub_Metadata using Cache_Data_Package with configurable TTL (default 30 minutes)
10. THE MCP_Server SHALL implement GitHub API rate limit handling (respect X-RateLimit-* headers)
11. WHEN GitHub API rate limits are exceeded, THE MCP_Server SHALL return cached data with staleness indicator
12. THE MCP_Server SHALL handle GitHub API errors gracefully and return informative error messages
13. THE MCP_Server SHALL NOT clone or download full repository contents (metadata only in Phase 1)
14. THE MCP_Server SHALL document GitHub token requirements including required scopes and rate limits

### Requirement 21: MCP Protocol Compliance

**User Story:** As an AI assistant developer, I want the MCP server to fully comply with the MCP protocol specification, so that it works seamlessly with MCP clients.

#### Acceptance Criteria

1. THE MCP_Server SHALL implement the MCP protocol version 1.0 specification
2. THE MCP_Server SHALL expose all Phase 1 operations as MCP tools (list_templates, get_template, list_template_versions, list_template_history, list_categories, list_starters, get_starter_info, search_documentation, validate_naming, check_template_updates)
3. THE MCP_Server SHALL provide JSON Schema definitions for all tool inputs and outputs
4. THE MCP_Server SHALL return structured responses conforming to MCP protocol format
5. THE MCP_Server SHALL handle MCP protocol errors according to specification (invalid requests, unsupported operations)
6. THE MCP_Server SHALL provide tool descriptions that AI assistants can use to determine when to invoke each tool
7. THE MCP_Server SHALL support MCP protocol negotiation and capability discovery
8. THE MCP_Server SHALL provide examples in tool descriptions showing typical usage
9. THE MCP_Server SHALL validate all tool inputs against JSON Schema before processing
10. WHEN validation fails, THE MCP_Server SHALL return MCP-compliant error responses with detailed validation messages

### Requirement 22: Error Handling and Logging

**User Story:** As a platform engineer, I want comprehensive error handling and logging, so that I can troubleshoot issues and monitor MCP server health.

#### Acceptance Criteria

1. THE MCP_Server SHALL log all requests to CloudWatch with timestamp, IP address, tool name, and execution time
2. THE MCP_Server SHALL log all errors with stack traces and request context
3. WHEN S3 operations fail, THE MCP_Server SHALL log the bucket name, key, and error details
4. WHEN GitHub API operations fail, THE MCP_Server SHALL log the repository, endpoint, and error details **TODO CHANGE** Include user/org as well
5. THE MCP_Server SHALL return user-friendly error messages that do not expose internal implementation details
6. THE MCP_Server SHALL categorize errors as client errors (4xx) or server errors (5xx) **TODO CHANGE** The MCP_Server, when returning an error handled by the Lambda function should utilize the base resposnes provided by the 63klabs/cache-data package.
7. THE MCP_Server SHALL include request IDs in all error responses for correlation with logs
8. THE MCP_Server SHALL emit CloudWatch metrics for error rates, latency, and cache performance
9. THE MCP_Server SHALL implement structured logging with consistent log format
10. THE MCP_Server SHALL support configurable log levels (ERROR, WARN, INFO, DEBUG) via environment variables **TODO CHANGE** Cache data already implements this. Use DebugAndLog.error, DebugAndLog.warn, info, debug, diag as needed from the cache-data package.
11. THE MCP_Server SHALL use DebugAndLog.error for fatal errors that prevent all data retrieval
12. THE MCP_Server SHALL use DebugAndLog.warn for non-fatal errors where partial data is available (Brown_Out_Support)
13. THE MCP_Server SHALL log which specific bucket/org failed for troubleshooting without exposing sensitive information

### Requirement 23: Deployment Configuration

**User Story:** As a platform engineer, I want to configure the MCP server via CloudFormation parameters, so that I can customize behavior without code changes.

#### Acceptance Criteria

1. THE MCP_Server SHALL accept a PublicRateLimit parameter (default 100 requests per hour)
2. THE MCP_Server SHALL accept an AtlantisS3Buckets parameter (CommaDelimitedList) for specifying multiple S3 buckets
3. THE MCP_Server SHALL accept an AtlantisGitHubUserOrgs parameter (CommaDelimitedList) for specifying multiple GitHub users/orgs
4. THE MCP_Server SHALL accept a ReadLambdaExecRoleIncludeManagedPolicyArns parameter (CommaDelimitedList) for attaching additional managed policies to Read Lambda execution role
5. THE ReadLambdaExecRoleIncludeManagedPolicyArns parameter SHALL follow the pattern from Atlantis templates with proper validation
6. THE MCP_Server SHALL accept CacheTTL parameters for each resource type (templates, starters, documentation)
7. THE MCP_Server SHALL accept a GitHubTokenParameter parameter specifying the SSM parameter name for GitHub access token
8. THE MCP_Server SHALL accept a LogLevel parameter (ERROR, WARN, INFO, DEBUG)
9. THE MCP_Server SHALL accept a Prefix parameter for resource naming following Naming_Convention
10. THE MCP_Server SHALL accept a ProjectId parameter for resource naming following Naming_Convention
11. THE MCP_Server SHALL accept a StageId parameter for resource naming following Naming_Convention
12. THE MCP_Server SHALL validate all parameters during CloudFormation stack creation
13. THE MCP_Server SHALL split comma-delimited AtlantisS3Buckets into an array in Lambda environment
14. THE MCP_Server SHALL split comma-delimited AtlantisGitHubUserOrgs into an array in Lambda environment
**TODO UPDATE** These should be included in settings.js, and organized as properties and sub properties within settings in an organized manner

### Requirement 24: Documentation

**User Story:** As a developer, I want comprehensive documentation for the MCP server, so that I can understand how to use it, deploy it, and maintain it.

#### Acceptance Criteria

1. THE MCP_Server SHALL provide end-user documentation for developers using MCP in IDEs, CLI, or AI agents
2. THE end-user documentation SHALL include examples of each MCP tool with sample inputs and outputs
3. THE end-user documentation SHALL include integration guides for popular AI assistants (Claude, ChatGPT, Cursor) **TODO UPDATE** Inclue Kiro and Amazon Q Developer
4. THE MCP_Server SHALL provide organizational documentation for self-hosting and installation
5. THE organizational documentation SHALL include deployment instructions using SAM configuration repository
6. THE organizational documentation SHALL include configuration reference for all CloudFormation parameters
7. THE organizational documentation SHALL include instructions for connecting to private GitHub repositories
8. THE organizational documentation SHALL include instructions for setting up GitHub custom properties on repositories
9. THE organizational documentation SHALL include instructions for configuring S3 bucket tags (atlantis-mcp:Allow, atlantis-mcp:IndexPriority)
10. THE organizational documentation SHALL include a Python script for generating Sidecar_Metadata files during CI/CD
11. THE Python script SHALL be suitable for use in CodeBuild or GitHub Actions
12. THE organizational documentation SHALL include examples of multiple S3 bucket and GitHub org configurations
13. THE MCP_Server SHALL provide maintainer documentation for platform engineers making code changes
14. THE maintainer documentation SHALL include architecture diagrams showing Lambda functions, caching, and data flow
15. THE maintainer documentation SHALL include contribution guidelines and testing procedures

### Requirement 25: Testing

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
9. THE unit tests SHALL verify Brown_Out_Support scenarios where some sources fail
10. THE unit tests SHALL verify multiple S3 bucket and GitHub org handling
11. THE unit tests SHALL verify Namespace discovery and priority ordering
12. THE unit tests SHALL verify template version handling (both Human_Readable_Version and S3_VersionId)
13. THE unit tests SHALL verify Sidecar_Metadata reading and fallback to GitHub metadata **TODO CHANGE** we aren't going to fall back if no sidecar
14. THE unit tests SHALL verify GitHub custom property filtering and name pattern fallback **TODO CHANGE** We aren't going to fall back if no custom property
15. THE MCP_Server SHALL include integration tests for MCP protocol compliance (deferred to Phase 2)
16. THE MCP_Server SHALL achieve minimum 80% code coverage for Phase 1 functionality


