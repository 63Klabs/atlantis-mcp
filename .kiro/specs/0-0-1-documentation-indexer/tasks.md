# Implementation Plan: Documentation Indexer

## Overview

Build a dedicated scheduled Lambda function that replaces the in-memory documentation index with a persistent DynamoDB-backed index. Implementation proceeds bottom-up: core utilities first, then extractors, then orchestration, then infrastructure, and finally Read Lambda integration.

## Tasks

- [ ] 1. Set up Indexer Lambda project structure and core utilities
  - [ ] 1.1 Create project scaffold at `application-infrastructure/src/lambda/indexer/`
    - Create `package.json` with `js-yaml` and `adm-zip` as dependencies, and `jest`, `fast-check`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` as devDependencies
    - Create directory structure: `lib/`, `lib/extractors/`, `tests/`, `tests/unit/`, `tests/property/`
    - Create or update jest config to include indexer test paths (update `application-infrastructure/src/jest.config.js` to also match `**/lambda/indexer/tests/**/*.test.js`)
    - _Requirements: 1.7_

  - [ ] 1.2 Implement `lib/hasher.js` — SHA-256 content path hashing
    - Implement `hashContentPath(contentPath)` returning 16-char hex string using `crypto.createHash('sha256')`
    - _Requirements: 11.1, 11.5_

  - [ ] 1.3 Write property test for hasher (Property 1)
    - **Property 1: Content path hashing is deterministic**
    - File: `tests/property/hashing.property.test.js`
    - **Validates: Requirements 11.5**

  - [ ] 1.4 Implement `lib/file-filter.js` — file type filtering
    - Implement `isIndexable(filePath)` checking extensions (`.md`, `.js`, `.jsx`, `.py`, `.yml`, `.yaml`), YAML filename pattern (`template*.yml`/`template*.yaml`), and excluded files list (`LICENSE.md`, `CONTRIBUTING.md`, `CONTRIBUTE.md`, `CHANGELOG.md`, `AGENTS.md`, `SECURITY.md`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 1.5 Write property test for file filter (Property 2)
    - **Property 2: File filtering correctness**
    - File: `tests/property/file-filter.property.test.js`
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

- [ ] 2. Checkpoint — Verify core utilities
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Implement content extractors
  - [ ] 3.1 Implement `lib/extractors/markdown.js`
    - Parse Markdown headings (H1–H6), extract section content between headings
    - Generate Content_Path as `{org}/{repo}/{filepath}/{heading}`
    - Extract keywords from heading text and section content
    - Store excerpt (first 200 chars) per section
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 3.2 Write property test for Markdown extractor (Property 3)
    - **Property 3: Markdown extraction produces valid entries**
    - File: `tests/property/markdown-extractor.property.test.js`
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**

  - [ ] 3.3 Implement `lib/extractors/jsdoc.js`
    - Parse `.js`/`.jsx` files for JSDoc comment blocks (`/** ... */`)
    - Extract function/method signatures, `@param` tags, `@returns` tags, description text
    - Generate Content_Path as `{org}/{repo}/{filepath}/{className}/{methodName}` or `{org}/{repo}/{filepath}/{functionName}`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 3.4 Write property test for JSDoc extractor (Property 4)
    - **Property 4: JSDoc extraction produces valid entries**
    - File: `tests/property/jsdoc-extractor.property.test.js`
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**

  - [ ] 3.5 Implement `lib/extractors/python.js`
    - Parse `.py` files for function/class definitions with docstrings
    - Extract function signatures with parameter names and type annotations
    - Extract docstring sections (description, Args, Returns, Raises)
    - Generate Content_Path as `{org}/{repo}/{filepath}/{className}/{methodName}` or `{org}/{repo}/{filepath}/{functionName}`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ] 3.6 Write property test for Python extractor (Property 5)
    - **Property 5: Python docstring extraction produces valid entries**
    - File: `tests/property/python-extractor.property.test.js`
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [ ] 3.7 Implement `lib/extractors/cloudformation.js`
    - Parse YAML files using `js-yaml` with custom schema for CloudFormation intrinsic functions (`!Ref`, `!Sub`, `!If`, etc.)
    - Extract each parameter from `Parameters` section: name, Type, Description, Default, AllowedValues, AllowedPattern, MinLength, MaxLength, MinValue, MaxValue, ConstraintDescription
    - Generate Content_Path as `{org}/{repo}/{filepath}/Parameters/{parameterName}`
    - Extract keywords from parameter names and descriptions
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ] 3.8 Write property test for CloudFormation extractor (Property 6)
    - **Property 6: CloudFormation parameter extraction produces valid entries**
    - File: `tests/property/cfn-extractor.property.test.js`
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

- [ ] 4. Checkpoint — Verify extractors
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement GitHub client and archive processor
  - [ ] 5.1 Implement `lib/github-client.js`
    - `listRepositories(org, token)` — list repos for an org/user via GitHub API
    - `getLatestRelease(owner, repo, token)` — check for latest published release
    - `downloadArchive(url, token)` — download zip archive as Buffer
    - Monitor `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers on every call
    - Wait when remaining hits zero; exponential backoff (max 3 retries) on HTTP 403 rate-limit
    - In-memory cache to avoid redundant API calls within a single build run
    - _Requirements: 4.2, 4.3, 5.1, 5.2, 5.3, 15.1, 15.2, 15.3, 15.4_

  - [ ] 5.2 Write property tests for GitHub client rate limiting (Properties 17, 18)
    - **Property 17: Rate limiter waits when remaining is zero**
    - **Property 18: Exponential backoff on 403 rate limit**
    - File: `tests/property/rate-limiter.property.test.js`
    - **Validates: Requirements 15.2, 15.4**

  - [ ] 5.3 Implement `lib/archive-processor.js`
    - `extractArchive(buffer)` — extract zip archive in memory using `adm-zip`, return array of `{path, content}` entries
    - _Requirements: 5.4_

  - [ ] 5.4 Write property test for archive download selection (Property 14)
    - **Property 14: Archive download selects release or default branch correctly**
    - File: `tests/property/archive-selection.property.test.js`
    - **Validates: Requirements 5.2, 5.3**

  - [ ] 5.5 Write property tests for org parsing and brown-out resilience (Properties 15, 16)
    - **Property 15: Brown-out resilience**
    - **Property 16: Org list parsing from comma-delimited string**
    - File: `tests/property/resilience.property.test.js` and `tests/property/org-parsing.property.test.js`
    - **Validates: Requirements 4.1, 4.4, 5.5**

- [ ] 6. Implement DynamoDB writer and main index builder
  - [ ] 6.1 Implement `lib/dynamo-writer.js`
    - `writeContentEntries(tableName, version, entries)` — batch write content metadata and content body items (respecting 25-item batch limit)
    - `writeSearchKeywords(tableName, version, entries)` — write keyword entries with relevance scores
    - `writeMainIndex(tableName, version, indexEntries)` — write main index atomically
    - `updateVersionPointer(tableName, newVersion, previousVersion)` — update version pointer
    - `setTtlOnPreviousVersion(tableName, previousVersion, ttlTimestamp)` — set TTL on old version entries
    - All items use pk/sk patterns from design: `content:{hash}`, `mainindex:{version}`, `search:{keyword}`, `version:pointer`
    - Set `ttl` attribute on versioned entries to ~7 days from now
    - _Requirements: 2.3, 2.6, 2.7, 2.8, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4, 13.2, 13.3, 13.4, 13.5_

  - [ ] 6.2 Write property tests for DynamoDB key format and main index (Properties 7, 8, 9, 10)
    - **Property 7: Content entries use correct DynamoDB key format**
    - **Property 8: Main index contains all entries with required fields**
    - **Property 9: All versioned entries share the same version identifier**
    - **Property 10: TTL is set to approximately 7 days on versioned entries**
    - File: `tests/property/dynamo-keys.property.test.js` and `tests/property/main-index.property.test.js` and `tests/property/versioning.property.test.js`
    - **Validates: Requirements 2.7, 11.2, 11.3, 12.1, 12.2, 12.3, 13.1, 13.2, 13.5**

  - [ ] 6.3 Implement `lib/index-builder.js` — orchestrator
    - Parse `ATLANTIS_GITHUB_USER_ORGS` env var into org/user list
    - Retrieve GitHub token from SSM via `PARAM_STORE_PATH` + `GitHubToken`
    - For each org: list repos, for each repo: check release → download zip → extract → filter → run extractors → hash paths
    - Compute relevance scores per keyword entry (title +10, excerpt +5, keyword +3, exact phrase +20, type weights: documentation 1.0, template-pattern 0.9, code-example 0.8)
    - Generate version identifier (timestamp-based, e.g. `20250715T060000`)
    - Write all content entries, keyword entries, and main index via dynamo-writer
    - Update version pointer on success
    - Set TTL on previous version entries (7-day cleanup)
    - If build fails at any point, leave version pointer unchanged
    - Emit structured log messages at each checkpoint (build start, repos discovered, entries indexed, build success/failure)
    - _Requirements: 4.1, 4.4, 4.5, 5.5, 11.1, 12.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 14.1, 14.2, 14.3, 16.4_

  - [ ] 6.4 Write property tests for relevance scoring and version failure safety (Properties 11, 12, 13)
    - **Property 11: Failed build leaves version pointer unchanged**
    - **Property 12: Relevance scoring follows defined weights**
    - **Property 13: Search results sorted by relevance descending**
    - File: `tests/property/relevance.property.test.js` and `tests/property/versioning.property.test.js`
    - **Validates: Requirements 13.6, 14.1, 14.2, 14.3, 14.4**

- [ ] 7. Implement Lambda handler entry point
  - [ ] 7.1 Implement `index.js` — Lambda handler
    - Invoke `index-builder.build()` with environment variables
    - Handle errors, log structured output, return success/failure status
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 4.1, 4.5_

- [ ] 8. Checkpoint — Verify indexer Lambda code
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Add infrastructure resources to template.yml
  - [ ] 9.1 Add DocIndex DynamoDB table to `template.yml`
    - `AWS::DynamoDB::Table` with TableName `${Prefix}-${ProjectId}-${StageId}-DocIndex`
    - Composite key: pk (String) partition, sk (String) sort
    - PAY_PER_REQUEST billing, TTL on `ttl` attribute
    - DeletionPolicy: Retain in PROD, Delete otherwise
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 9.2 Add Indexer Lambda function and execution role to `template.yml`
    - `AWS::Serverless::Function` with FunctionName `${Prefix}-${ProjectId}-${StageId}-DocIndexer`
    - Runtime nodejs24.x, Timeout 900, MemorySize 1024, CodeUri `src/lambda/indexer/`
    - Dedicated IAM role with DynamoDB read/write on DocIndex table, SSM GetParameter for GitHubToken, CloudWatch Logs
    - Environment variables: `ATLANTIS_GITHUB_USER_ORGS`, `DOC_INDEX_TABLE`, `PARAM_STORE_PATH`, `DEPLOY_ENVIRONMENT`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ] 9.3 Add EventBridge schedule and parameters to `template.yml`
    - Add `DocIndexScheduleForDEVTEST` parameter (default `cron(0 8 ? * MON *)`) and `DocIndexScheduleForPROD` parameter (default `cron(0 6 * * ? *)`)
    - Add parameters to a new "Documentation Indexer Settings" parameter group in Metadata
    - Create EventBridge rule using `!If [IsProduction, DocIndexScheduleForPROD, DocIndexScheduleForDEVTEST]`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 9.4 Add CloudWatch Alarm and SNS topic for Indexer Lambda errors
    - Follow same pattern as existing `ReadLambdaErrorsAlarm` and `ReadLambdaErrorAlarmNotification`
    - Errors metric, Sum statistic, threshold > 1, 900-second period
    - Create only when `CreateAlarms` condition is true
    - _Requirements: 16.1, 16.2, 16.3_

  - [ ] 9.5 Update Read Lambda execution role and environment in `template.yml`
    - Add DynamoDB read permissions on DocIndex table to Read Lambda execution role
    - Add `DOC_INDEX_TABLE` environment variable to Read Lambda function
    - _Requirements: 18.3, 18.4_

- [ ] 10. Checkpoint — Verify infrastructure changes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Update Read Lambda to query DynamoDB index
  - [ ] 11.1 Update `config/settings.js` to add `docIndexTable`
    - Add `docIndexTable: process.env.DOC_INDEX_TABLE || ''` to settings
    - _Requirements: 18.4_

  - [ ] 11.2 Rewrite `models/doc-index.js` to query DynamoDB
    - Remove in-memory index building (`buildIndex`, `indexTemplateRepository`, `indexCacheDataPackage`, etc.)
    - Implement `getActiveVersion(tableName)` — read `version:pointer` / `active`
    - Implement `getMainIndex(tableName, version)` — read `mainindex:{version}` / `entries`
    - Implement `queryIndex(query, options)` — search keyword entries, fetch content metadata, sort by relevance
    - Return empty results with suggestion if no active version exists
    - _Requirements: 18.1, 18.2, 18.5_

  - [ ] 11.3 Update `services/documentation.js` fetch function
    - Update the fetch function inside `search()` to call `DocIndex.queryIndex()` instead of `DocIndex.search()`
    - Continue using `CacheableDataAccess` for caching search results
    - _Requirements: 18.1, 18.2, 14.4_

  - [ ] 11.4 Write unit tests for Read Lambda DynamoDB integration
    - Test version pointer query, main index query, missing version handling, search with type filtering
    - File: `application-infrastructure/src/lambda/read/tests/unit/models/doc-index-dynamo.test.js`
    - _Requirements: 18.1, 18.2, 18.5_

- [ ] 12. Create admin operations documentation
  - [ ] 12.1 Create `docs/admin-ops/documentation-indexer.md`
    - Describe how to obtain a GitHub Personal Access Token with scopes `public_repo`, `read:org`
    - Provide AWS CLI command to store token in SSM Parameter Store at `${ParameterStoreHierarchy}GitHubToken`
    - Note that SSM Parameter is created with blank value during deployment; only value needs updating
    - Describe blue-green index versioning strategy and rollback procedure
    - Describe DynamoDB schema (pk/sk patterns for mainindex, content, search entries)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required — property-based tests are mandatory for this feature
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The AWS SDK is NOT packaged as a dependency — it is available in the Lambda runtime and only in devDependencies for local testing
- All new tests use Jest (`.test.js` files) per project migration guidelines
