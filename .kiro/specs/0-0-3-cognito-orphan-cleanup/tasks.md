# Implementation Plan: Cognito Orphan Cleanup

## Overview

Implement automated cleanup of orphaned Cognito user accounts when DynamoDB TTL removes inactive user records. This involves enabling DynamoDB Streams on the Users table, creating a new Cleanup Lambda function triggered by stream events, and adding comprehensive tests. The implementation follows existing patterns (SSM caching, TestHarness, JSDoc standards) and uses JavaScript (Node.js 24.x).

## Tasks

- [x] 1. Add CloudFormation resources for DynamoDB Streams and Cleanup Lambda
  - [x] 1.1 Add StreamSpecification to UsersTable resource
    - Add `StreamSpecification` with `StreamViewType: OLD_IMAGE` to the existing `UsersTable` resource in `application-infrastructure/template.yml`
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Add CleanupExecutionRole IAM role
    - Define `CleanupExecutionRole` (`AWS::IAM::Role`) with least-privilege permissions: DynamoDB Streams read on UsersTable stream ARN, `cognito-idp:AdminDeleteUser` on User Pool ARN, `ssm:GetParameter` on the Cognito User Pool ID parameter ARN, and CloudWatch Logs permissions scoped to the Cleanup Lambda log group
    - Role name follows `Prefix-ProjectId-StageId-CleanupExecution` pattern
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 1.3 Add CleanupFunction and CleanupLambdaLogGroup
    - Define `CleanupFunction` (`AWS::Serverless::Function`) with Node.js 24.x runtime, arm64 architecture, 30s timeout, 256 MB memory, triggered by DynamoDB Streams event source (StartingPosition: LATEST, BatchSize: 10, MaximumBatchingWindowInSeconds: 30, MaximumRetryAttempts: 3, FunctionResponseTypes: ReportBatchItemFailures)
    - Function name follows `Prefix-ProjectId-StageId-CleanupFunction` pattern
    - Environment variables: `PARAM_STORE_PATH` and `DEPLOY_ENVIRONMENT`
    - Define `CleanupLambdaLogGroup` (`AWS::Logs::LogGroup`) with retention based on DeployEnvironment (7 days TEST, 90 days PROD)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 7.1, 7.2, 7.3, 7.4_

- [x] 2. Checkpoint - Validate CloudFormation template
  - Ensure the template is valid YAML and all resource references resolve correctly. Ask the user if questions arise.

- [x] 3. Implement Cleanup Lambda function
  - [x] 3.1 Create package.json for the cleanup Lambda
    - Create `application-infrastructure/src/lambda/cleanup/package.json` with project metadata and fast-check as a devDependency (AWS SDK is available in Lambda runtime, not packaged)
    - _Requirements: 2.1_

  - [x] 3.2 Implement index.js with handler and internal functions
    - Create `application-infrastructure/src/lambda/cleanup/index.js`
    - Implement `handler(event)` that iterates over `event.Records`, filters using `isTtlDeletion` and `isUserRecord`, calls `deleteOrphanedUser` for qualifying records, and returns `{ batchItemFailures }` with failed sequence numbers
    - Implement `isTtlDeletion(record)` — returns true when `eventName === 'REMOVE'` AND `userIdentity.principalId === 'dynamodb.amazonaws.com'`
    - Implement `isUserRecord(record)` — returns true when OldImage `pk` starts with `KEY#` AND `cognitoSub` is present and non-empty
    - Implement `getCachedUserPoolId()` — retrieves User Pool ID from SSM using `PARAM_STORE_PATH + 'app-stack/Mcp_CognitoUserPoolId'`, caches at module level for Lambda execution environment lifetime
    - Implement `deleteOrphanedUser(cognitoSub, userPoolId)` — calls `AdminDeleteUser`, treats `UserNotFoundException` as success, returns success/failure indicator
    - Include JSDoc documentation for all functions
    - Include `TestHarness` class exposing internals for testing
    - Use `console.info` / `console.warn` / `console.error` / `console.debug` for structured logging at appropriate levels
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4_

- [x] 4. Checkpoint - Review Lambda implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Write unit tests for Cleanup Lambda
  - [x] 5.1 Create unit test file
    - Create `application-infrastructure/src/lambda/cleanup/tests/unit/cleanup-handler.test.js`
    - Mock AWS SDK clients (`SSMClient`, `CognitoIdentityProviderClient`) using Jest
    - Test cases: TTL deletion filtering (TTL vs application deletions), record type filtering (KEY# prefix, cognitoSub presence), SSM caching behavior, UserNotFoundException handling (treated as success), other Cognito errors (added to batchItemFailures), SSM failure (all records reported as failed), empty batch (returns empty batchItemFailures), logging at correct levels
    - _Requirements: 4.1, 4.2, 4.3, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.1, 8.2_

- [x] 6. Write property-based tests for Cleanup Lambda
  - [x] 6.1 Write property test for filtering correctness
    - Create `application-infrastructure/src/lambda/cleanup/tests/property/cleanup-filtering.property.test.js`
    - **Property 1: Filtering correctness — only qualifying records trigger Cognito deletion**
    - Use fast-check to generate random stream records with varying eventName, principalId, pk prefixes, and cognitoSub presence
    - Verify that AdminDeleteUser is called if and only if all four conditions are met
    - Minimum 100 iterations
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.5, 5.4, 5.5, 8.1, 8.2, 8.4**

  - [x] 6.2 Write property test for AdminDeleteUser invocation correctness
    - **Property 2: AdminDeleteUser invocation correctness**
    - Use fast-check to generate random valid cognitoSub strings and User Pool IDs
    - Verify that AdminDeleteUser is called exactly once per qualifying record with correct parameters
    - Minimum 100 iterations
    - **Validates: Requirements 5.3, 5.7**

  - [x] 6.3 Write property test for partial batch failure reporting accuracy
    - **Property 3: Partial batch failure reporting accuracy**
    - Use fast-check to generate random batches with configurable success/failure patterns
    - Verify that batchItemFailures contains exactly the sequence numbers of failed records (excluding UserNotFoundException)
    - Minimum 100 iterations
    - **Validates: Requirements 6.1, 6.3**

  - [x] 6.4 Write property test for handler robustness
    - **Property 4: Handler robustness — never throws**
    - Use fast-check to generate arbitrary objects as event input (missing fields, null, undefined, wrong types, empty batches)
    - Verify that handler never throws and always returns a valid `{ batchItemFailures: [...] }` response
    - Minimum 100 iterations
    - **Validates: Requirements 6.4**

- [x] 7. Update Jest configuration
  - [x] 7.1 Add cleanup test path to jest.config.js
    - Update `application-infrastructure/src/jest.config.js` to include `'**/lambda/cleanup/tests/**/*.test.js'` in the `testMatch` array
    - Add `'lambda/cleanup/node_modules'` to `moduleDirectories`
    - _Requirements: 2.1_

- [x] 8. Checkpoint - Run all tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Update CHANGELOG.md
  - [x] 9.1 Add changelog entry under v0.0.4 unreleased header
    - Add an `### Added` section under the existing `## [v0.0.4] (unreleased)` header
    - Entry: **Cognito Orphan Cleanup** with spec reference link `[Spec: 0-0-4-cognito-orphan-cleanup](../.kiro/specs/0-0-4-cognito-orphan-cleanup/)`
    - Sub-bullets: DynamoDB Streams enabled on Users table (OLD_IMAGE), new Cleanup Lambda triggered by TTL deletions to remove orphaned Cognito accounts, partial batch failure reporting for resilient processing, least-privilege IAM role scoped to stream, Cognito, SSM, and CloudWatch Logs
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses JavaScript (Node.js 24.x) matching existing Lambda functions
- All code follows existing patterns: SSM caching at module level, TestHarness for test access, JSDoc documentation, Atlantis naming conventions
