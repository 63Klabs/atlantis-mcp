# Requirements Document

## Introduction

The Documentation Indexer is a dedicated scheduled Lambda function that replaces the current in-memory documentation index built at cold start in the Read Lambda. The Indexer Lambda discovers GitHub repositories for configured organizations/users, downloads zip archives (latest release or main branch), extracts indexable content (Markdown, JSDoc, Python docstrings, CloudFormation template parameters), and stores the indexed content in a DynamoDB table using hashed keys. A main index maps content paths to hashes. The indexer supports blue-green versioned index rebuilds and runs on a configurable EventBridge schedule.

## Glossary

- **Indexer_Lambda**: The new scheduled Lambda function (`${Prefix}-${ProjectId}-${StageId}-DocIndexer`) responsible for building and storing the documentation index in DynamoDB.
- **Read_Lambda**: The existing Lambda function (`${Prefix}-${ProjectId}-${StageId}-ReadFunction`) that serves MCP requests and queries the persistent DynamoDB index for documentation search.
- **DocIndex_Table**: The DynamoDB table (`${Prefix}-${ProjectId}-${StageId}-DocIndex`) that stores indexed documentation content, the main index, and search keyword entries.
- **Main_Index**: A DynamoDB entry (pk=`mainindex`, sk=`entries`) that maps all indexed content paths to their corresponding content hashes.
- **Content_Hash**: A deterministic hash derived from a content path (e.g., `63klabs/cache-data/README.md/installation`) used as the DynamoDB partition key for content entries.
- **Blue_Green_Index**: A versioning strategy where a new index version is built completely before atomically switching the active version pointer, keeping the previous version for rollback.
- **Version_Pointer**: A DynamoDB entry that identifies which index version is currently active for queries.
- **EventBridge_Schedule**: An AWS EventBridge rule that triggers the Indexer_Lambda on a configurable cron schedule.
- **GitHub_Token**: A GitHub Personal Access Token stored as a SecureString in SSM Parameter Store, retrieved via CachedSsmParameter at runtime.
- **Content_Path**: A hierarchical string representing the location of indexed content (e.g., `org/repo/filepath/section`).
- **Markdown_Extractor**: The component that parses Markdown files, extracts heading hierarchy and section content.
- **JSDoc_Extractor**: The component that parses JavaScript/JSX files and extracts JSDoc comments, function signatures, method names, and arguments.
- **Docstring_Extractor**: The component that parses Python files and extracts docstrings, function signatures, and arguments.
- **CloudFormation_Extractor**: The component that parses CloudFormation YAML templates and extracts parameter names, descriptions, types, defaults, and constraints.
- **Excluded_Files**: Files that are skipped during indexing: LICENSE.md, CONTRIBUTING.md, CONTRIBUTE.md, CHANGELOG.md, AGENTS.md, SECURITY.md.
- **Indexable_Files**: Files matching these extensions: `.md`, `.js`, `.jsx`, `.py`, `.yml`, `.yaml` (where YAML files must match the pattern `template*.yml` or `template*.yaml`).

## Requirements

### Requirement 1: Lambda Function Infrastructure

**User Story:** As a platform operator, I want a dedicated scheduled Lambda function for documentation indexing, so that the Read Lambda does not rebuild the index on cold start and the index persists across Lambda restarts.

#### Acceptance Criteria

1. THE Indexer_Lambda SHALL be defined as an `AWS::Serverless::Function` resource in `template.yml` with FunctionName `${Prefix}-${ProjectId}-${StageId}-DocIndexer`.
2. THE Indexer_Lambda SHALL use the Node.js runtime consistent with the Read_Lambda (nodejs24.x).
3. THE Indexer_Lambda SHALL have a dedicated IAM execution role with least-privilege permissions for DynamoDB read/write on the DocIndex_Table, SSM GetParameter for the GitHub_Token, and CloudWatch Logs write access.
4. THE Indexer_Lambda SHALL receive the `ATLANTIS_GITHUB_USER_ORGS` environment variable from the existing `AtlantisGitHubUserOrgs` template parameter.
5. THE Indexer_Lambda SHALL have a configurable timeout of 900 seconds (15 minutes) to accommodate full index rebuilds.
6. THE Indexer_Lambda SHALL have a configurable memory size of 1024 MB.
7. THE Indexer_Lambda SHALL have its source code located at `application-infrastructure/src/lambda/indexer/`.

### Requirement 2: DynamoDB Table for Index Storage

**User Story:** As a platform operator, I want a dedicated DynamoDB table for storing indexed documentation, so that the index is persistent, queryable, and independent of Lambda instance lifecycle.

#### Acceptance Criteria

1. THE DocIndex_Table SHALL be defined as an `AWS::DynamoDB::Table` resource in `template.yml` with TableName `${Prefix}-${ProjectId}-${StageId}-DocIndex`.
2. THE DocIndex_Table SHALL use PAY_PER_REQUEST billing mode.
3. THE DocIndex_Table SHALL have a composite primary key with partition key `pk` (String) and sort key `sk` (String).
4. THE DocIndex_Table SHALL have TTL enabled on a `ttl` attribute.
5. THE DocIndex_Table SHALL use `DeletionPolicy: Retain` in production and `DeletionPolicy: Delete` in non-production environments.
6. THE DocIndex_Table SHALL store Main_Index entries with pk=`mainindex` and sk=`entries`.
7. THE DocIndex_Table SHALL store content entries with pk=`content:{Content_Hash}` and sk=`metadata` or sk=`content`.
8. THE DocIndex_Table SHALL store search keyword entries with pk=`search:{keyword}` and sk=`{relevanceScore}`.

### Requirement 3: EventBridge Schedule

**User Story:** As a platform operator, I want the indexer to run on a configurable schedule, so that the documentation index stays current without manual intervention.

#### Acceptance Criteria

1. THE template.yml SHALL define two new parameters: `DocIndexScheduleForDEVTEST` and `DocIndexScheduleForPROD` with configurable cron expressions.
2. THE `DocIndexScheduleForDEVTEST` parameter SHALL default to a weekly schedule on Monday morning (e.g., `cron(0 8 ? * MON *)`).
3. THE `DocIndexScheduleForPROD` parameter SHALL default to a daily schedule (e.g., `cron(0 6 * * ? *)`).
4. THE EventBridge_Schedule SHALL trigger the Indexer_Lambda using the `DocIndexScheduleForPROD` expression in production environments and the `DocIndexScheduleForDEVTEST` expression in non-production environments.
5. THE schedule parameters SHALL be placed in a new "Documentation Indexer Settings" parameter group in the template Metadata.

### Requirement 4: GitHub Repository Discovery

**User Story:** As a platform operator, I want the indexer to discover all repositories for configured GitHub organizations and users, so that documentation from all relevant sources is indexed.

#### Acceptance Criteria

1. WHEN the Indexer_Lambda is triggered, THE Indexer_Lambda SHALL parse the `ATLANTIS_GITHUB_USER_ORGS` environment variable as a comma-delimited list of GitHub users/organizations.
2. FOR EACH user/organization in the list, THE Indexer_Lambda SHALL call the GitHub API to list all repositories.
3. THE Indexer_Lambda SHALL authenticate GitHub API requests using the GitHub_Token retrieved from SSM Parameter Store via CachedSsmParameter, using the same parameter path pattern as the Read_Lambda (`${PARAM_STORE_PATH}GitHubToken`).
4. IF a GitHub API request fails for one user/organization, THEN THE Indexer_Lambda SHALL log the error and continue processing remaining users/organizations (brown-out support).
5. IF the GitHub_Token is not configured or is blank, THEN THE Indexer_Lambda SHALL log an error and terminate the index build with a failure status.

### Requirement 5: Repository Archive Download

**User Story:** As a platform operator, I want the indexer to download repository archives efficiently, so that file content can be extracted without making per-file API calls.

#### Acceptance Criteria

1. FOR EACH discovered repository, THE Indexer_Lambda SHALL check for a latest GitHub release using the GitHub Releases API.
2. WHEN a repository has a published release, THE Indexer_Lambda SHALL download the zip archive of the latest release tag.
3. WHEN a repository has no published release, THE Indexer_Lambda SHALL download the zip archive of the default branch (typically `main`).
4. THE Indexer_Lambda SHALL extract the downloaded zip archive in memory.
5. IF a zip archive download fails, THEN THE Indexer_Lambda SHALL log the error, skip the repository, and continue processing remaining repositories.

### Requirement 6: File Filtering

**User Story:** As a platform operator, I want the indexer to process only relevant file types and skip excluded files, so that the index contains useful content without noise.

#### Acceptance Criteria

1. THE Indexer_Lambda SHALL process only files matching these extensions from extracted archives: `.md`, `.js`, `.jsx`, `.py`, `.yml`, `.yaml`.
2. THE Indexer_Lambda SHALL process YAML files only when the filename matches the pattern `template*.yml` or `template*.yaml`.
3. THE Indexer_Lambda SHALL skip files named LICENSE.md, CONTRIBUTING.md, CONTRIBUTE.md, CHANGELOG.md, AGENTS.md, or SECURITY.md regardless of directory path.
4. THE Indexer_Lambda SHALL process all other Markdown files (`.md`) that are not in the Excluded_Files list.

### Requirement 7: Markdown Content Extraction

**User Story:** As a developer, I want Markdown documentation indexed by heading and section, so that I can search for specific topics and retrieve relevant content.

#### Acceptance Criteria

1. THE Markdown_Extractor SHALL parse Markdown files and identify heading hierarchy (H1 through H6).
2. THE Markdown_Extractor SHALL extract the content between each heading as a separate indexed section.
3. THE Markdown_Extractor SHALL generate a Content_Path for each section in the format `{org}/{repo}/{filepath}/{heading}` (e.g., `63klabs/cache-data/README.md/installation`).
4. THE Markdown_Extractor SHALL extract keywords from heading text and section content for search indexing.
5. THE Markdown_Extractor SHALL store an excerpt (first 200 characters) of each section for search result display.

### Requirement 8: JSDoc Content Extraction

**User Story:** As a developer, I want JSDoc documentation from JavaScript files indexed, so that I can search for function signatures, method descriptions, and argument documentation.

#### Acceptance Criteria

1. THE JSDoc_Extractor SHALL parse `.js` and `.jsx` files and identify JSDoc comment blocks.
2. THE JSDoc_Extractor SHALL extract function and method signatures associated with each JSDoc block.
3. THE JSDoc_Extractor SHALL extract `@param` tags including parameter names, types, and descriptions.
4. THE JSDoc_Extractor SHALL extract `@returns` tags including return type and description.
5. THE JSDoc_Extractor SHALL extract the JSDoc description text.
6. THE JSDoc_Extractor SHALL generate a Content_Path for each documented function in the format `{org}/{repo}/{filepath}/{className}/{methodName}` or `{org}/{repo}/{filepath}/{functionName}`.

### Requirement 9: Python Docstring Extraction

**User Story:** As a developer, I want Python docstrings indexed, so that I can search for Python function signatures, descriptions, and argument documentation.

#### Acceptance Criteria

1. THE Docstring_Extractor SHALL parse `.py` files and identify function and class definitions with docstrings.
2. THE Docstring_Extractor SHALL extract function signatures including parameter names and type annotations.
3. THE Docstring_Extractor SHALL extract docstring content including description, Args, Returns, and Raises sections.
4. THE Docstring_Extractor SHALL generate a Content_Path for each documented function in the format `{org}/{repo}/{filepath}/{className}/{methodName}` or `{org}/{repo}/{filepath}/{functionName}`.

### Requirement 10: CloudFormation Template Parameter Extraction

**User Story:** As a developer, I want CloudFormation template parameters indexed, so that I can search for parameter names, descriptions, types, and constraints.

#### Acceptance Criteria

1. THE CloudFormation_Extractor SHALL parse YAML files matching the `template*.yml` or `template*.yaml` pattern using a YAML parser that handles CloudFormation intrinsic functions (custom tags like `!Ref`, `!Sub`, `!If`, etc.).
2. THE CloudFormation_Extractor SHALL extract each parameter from the `Parameters` section including: name, Type, Description, Default, AllowedValues, AllowedPattern, MinLength, MaxLength, MinValue, MaxValue, and ConstraintDescription.
3. THE CloudFormation_Extractor SHALL generate a Content_Path for each parameter in the format `{org}/{repo}/{filepath}/Parameters/{parameterName}`.
4. THE CloudFormation_Extractor SHALL extract keywords from parameter names and descriptions for search indexing.

### Requirement 11: Content Hashing and Storage

**User Story:** As a platform operator, I want indexed content stored with deterministic hashed keys, so that content can be efficiently retrieved and deduplication is automatic.

#### Acceptance Criteria

1. THE Indexer_Lambda SHALL generate a Content_Hash for each Content_Path using a deterministic hash algorithm (SHA-256, truncated to a practical key length).
2. THE Indexer_Lambda SHALL store content entries in the DocIndex_Table with pk=`content:{Content_Hash}`, sk=`metadata` containing path, type, subType, title, excerpt, repository, owner, keywords, and lastIndexed timestamp.
3. THE Indexer_Lambda SHALL store content entries in the DocIndex_Table with pk=`content:{Content_Hash}`, sk=`content` containing the full extracted content text.
4. THE Indexer_Lambda SHALL store search keyword entries in the DocIndex_Table with pk=`search:{keyword}`, sk=`{relevanceScore}` for each extracted keyword.
5. FOR ALL Content_Paths, hashing the same path SHALL produce the same Content_Hash (deterministic property).

### Requirement 12: Main Index Management

**User Story:** As a platform operator, I want a main index that maps all content paths to their hashes, so that the Read Lambda can resolve paths to content efficiently.

#### Acceptance Criteria

1. THE Indexer_Lambda SHALL build a Main_Index containing all indexed Content_Paths and their corresponding Content_Hashes.
2. THE Indexer_Lambda SHALL store the Main_Index in the DocIndex_Table with pk=`mainindex`, sk=`entries`.
3. THE Main_Index entry SHALL include for each indexed item: hash, path, type, subType, title, repository, owner, keywords, and lastIndexed timestamp.
4. THE Main_Index SHALL be written atomically after all content entries are stored, so that the Read_Lambda does not read a partially built index.

### Requirement 13: Blue-Green Versioned Index Rebuilds

**User Story:** As a platform operator, I want blue-green versioned index rebuilds, so that the Read Lambda always queries a complete index and rollback is possible.

#### Acceptance Criteria

1. WHEN the Indexer_Lambda starts a rebuild, THE Indexer_Lambda SHALL generate a new version identifier (timestamp-based).
2. THE Indexer_Lambda SHALL write all new content entries and the new Main_Index with the new version identifier.
3. WHEN the new index build completes successfully, THE Indexer_Lambda SHALL update the Version_Pointer in the DocIndex_Table to point to the new version.
4. THE Indexer_Lambda SHALL retain the previous index version for rollback purposes.
5. THE Indexer_Lambda SHALL clean up index versions older than 7 days using TTL attributes on versioned entries.
6. IF the index build fails, THEN THE Indexer_Lambda SHALL leave the Version_Pointer unchanged so the Read_Lambda continues using the previous valid index.
7. WHILE the Indexer_Lambda is building a new index version, THE Read_Lambda SHALL continue querying the current active version without interruption.

### Requirement 14: Search Relevance Weighting

**User Story:** As a developer, I want search results ranked by relevance with type-based weighting, so that the most useful results appear first.

#### Acceptance Criteria

1. THE Indexer_Lambda SHALL assign relevance metadata to each indexed entry based on content type: documentation (weight 1.0), template-pattern (weight 0.9), code-example (weight 0.8).
2. THE Indexer_Lambda SHALL store keyword entries with relevance scores that incorporate title match weight (+10), excerpt match weight (+5), and keyword match weight (+3).
3. THE Indexer_Lambda SHALL store an exact-phrase-match bonus (+20) when applicable.
4. THE Read_Lambda SHALL query keyword entries from the DocIndex_Table sorted by relevance score in descending order.

### Requirement 15: GitHub API Rate Limit Handling

**User Story:** As a platform operator, I want the indexer to handle GitHub API rate limits gracefully, so that index builds complete reliably without exceeding quotas.

#### Acceptance Criteria

1. THE Indexer_Lambda SHALL monitor GitHub API rate limit response headers (`X-RateLimit-Remaining`, `X-RateLimit-Reset`) on each API call.
2. IF `X-RateLimit-Remaining` reaches zero, THEN THE Indexer_Lambda SHALL wait until the reset time before making additional requests.
3. THE Indexer_Lambda SHALL use in-memory caching during the index build to avoid redundant API calls for the same resource within a single build run.
4. IF a GitHub API request returns HTTP 403 due to rate limiting, THEN THE Indexer_Lambda SHALL implement exponential backoff with a maximum of 3 retries.

### Requirement 16: Monitoring and Alerting

**User Story:** As a platform operator, I want CloudWatch alarms and SNS notifications for the indexer, so that I am alerted when index builds fail.

#### Acceptance Criteria

1. THE template.yml SHALL define a CloudWatch Alarm for Indexer_Lambda errors using the same pattern as the existing ReadLambdaErrorsAlarm (Errors metric, Sum statistic, threshold > 1, 900-second period).
2. THE template.yml SHALL define an SNS Topic for Indexer_Lambda error notifications using the same pattern as the existing ReadLambdaErrorAlarmNotification, subscribing the `AlarmNotificationEmail` parameter.
3. THE CloudWatch Alarm and SNS Topic SHALL be created only when the `CreateAlarms` condition is true (production environments).
4. THE Indexer_Lambda SHALL emit structured log messages for: index build start, repositories discovered, entries indexed, build duration, build success, and build failure.

### Requirement 17: Admin Operations Documentation

**User Story:** As a platform operator, I want documentation on GitHub credential setup and indexer architecture, so that I can configure and maintain the indexer.

#### Acceptance Criteria

1. THE documentation SHALL be created at `docs/admin-ops/documentation-indexer.md`.
2. THE documentation SHALL describe how to obtain a GitHub Personal Access Token with required scopes (`public_repo`, `read:org`).
3. THE documentation SHALL provide the AWS CLI command to store the GitHub token in SSM Parameter Store at the path aligned with the existing approach (`${ParameterStoreHierarchy}GitHubToken`).
4. THE documentation SHALL note that the SSM Parameter is created with a blank value during deployment and only the value needs to be updated.
5. THE documentation SHALL describe the blue-green index versioning strategy and rollback procedure.
6. THE documentation SHALL describe the DynamoDB schema (pk/sk patterns for mainindex, content, and search entries).

### Requirement 18: Read Lambda Integration

**User Story:** As a developer, I want the Read Lambda to query the persistent DynamoDB index instead of building an in-memory index, so that documentation search is fast and consistent across Lambda instances.

#### Acceptance Criteria

1. THE Read_Lambda SHALL query the DocIndex_Table for the active Version_Pointer to determine which index version to use.
2. THE Read_Lambda SHALL query content entries from the DocIndex_Table by Content_Hash when serving `search_documentation` tool requests.
3. THE Read_Lambda SHALL have DynamoDB read permissions on the DocIndex_Table added to its existing execution role.
4. THE Read_Lambda SHALL receive the DocIndex_Table name as an environment variable.
5. IF no active index version exists in the DocIndex_Table, THEN THE Read_Lambda SHALL return an empty result set with a suggestion to verify the indexer has run.
