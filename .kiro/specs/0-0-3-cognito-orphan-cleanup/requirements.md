# Requirements Document

## Introduction

This document defines the requirements for cleaning up orphaned Cognito user accounts when DynamoDB TTL deletes user records from the Users table. Currently, when a free registered user is inactive for 120+ days, DynamoDB TTL removes their record from the Users table. However, the corresponding Cognito user account remains in the User Pool, creating orphaned accounts that can still authenticate, hold stale attributes, and accumulate indefinitely.

The solution uses DynamoDB Streams on the Users table to trigger a Lambda function when TTL deletions occur. The Lambda function distinguishes TTL-triggered deletions from application-level deletions (such as key regeneration) and deletes the corresponding Cognito user account only for TTL-triggered removals.

## Glossary

- **Users_Table**: The existing DynamoDB table (`Prefix-ProjectId-StageId-Users`) storing user records keyed by HMAC-SHA256 hashed API keys, with a GSI on email and TTL enabled on the `ttl` attribute
- **User_Pool**: The existing Amazon Cognito User Pool that manages user registration, email verification, login, and password policies
- **Cleanup_Lambda**: A new Lambda function triggered by DynamoDB Streams on the Users_Table that deletes orphaned Cognito user accounts when TTL removes a user record
- **TTL_Deletion**: A DynamoDB record removal triggered by the DynamoDB TTL service, identifiable by `userIdentity.principalId` equal to `dynamodb.amazonaws.com` and `eventName` equal to `REMOVE` in the stream record
- **Application_Deletion**: A DynamoDB record removal triggered by application code (such as key regeneration in the Auth_Lambda), identifiable by a `userIdentity.principalId` that is NOT `dynamodb.amazonaws.com`
- **Old_Image**: The DynamoDB Streams record attribute containing the state of the item before it was deleted, including fields such as `cognitoSub`, `email`, and `tier`
- **Cognito_Sub**: The unique identifier (`sub`) assigned by Cognito to each user account, stored in the Users_Table `cognitoSub` field and used as the `Username` parameter for Cognito admin API calls
- **Auth_Lambda**: The existing Lambda function that handles API key regeneration, voucher redemption, and the Cognito Post-Confirmation trigger
- **Read_Lambda**: The existing Lambda function that handles `POST /mcp/v1` requests, performs API key validation, and triggers background TTL refresh for free registered users via the `refreshTtl` function in `auth-resolver.js`

---

## Requirements

### Requirement 1: Enable DynamoDB Streams on Users Table

**User Story:** As a developer, I want DynamoDB Streams enabled on the Users table with old images, so that downstream consumers can react to record deletions and access the deleted record's data.

#### Acceptance Criteria

1. THE CloudFormation template SHALL configure `StreamSpecification` on the `UsersTable` resource with `StreamViewType` set to `OLD_IMAGE`
2. THE Users_Table stream SHALL emit records for `REMOVE` events containing the full item state before deletion in the `OldImage` field
3. IF the stream fails to enable, THEN THE CloudFormation stack SHALL roll back without leaving the Users_Table in an inconsistent state

---

### Requirement 2: Cleanup Lambda Function Provisioning

**User Story:** As a developer, I want a dedicated Lambda function triggered by the Users table stream, so that Cognito cleanup logic is isolated from existing auth and read functions.

#### Acceptance Criteria

1. THE CloudFormation template SHALL define a `AWS::Serverless::Function` resource named following the `Prefix-ProjectId-StageId-CleanupFunction` pattern
2. THE Cleanup_Lambda SHALL use the Node.js 24.x runtime with arm64 architecture matching the existing Lambda functions
3. THE Cleanup_Lambda SHALL be triggered by a DynamoDB Streams event source mapped to the Users_Table stream
4. THE DynamoDB event source mapping SHALL configure `StartingPosition` to `LATEST` so that only new stream records are processed
5. THE DynamoDB event source mapping SHALL set `BatchSize` to 10 and `MaximumBatchingWindowInSeconds` to 30 to balance throughput and latency
6. THE DynamoDB event source mapping SHALL configure `MaximumRetryAttempts` to 3 to limit retries on persistent failures
7. THE CloudFormation template SHALL define a CloudWatch Log Group for the Cleanup_Lambda with retention based on the deployment environment (7 days for TEST, 90 days for PROD)
8. THE Cleanup_Lambda SHALL have a timeout of 30 seconds and memory size of 256 MB

---

### Requirement 3: Cleanup Lambda IAM Role

**User Story:** As a developer, I want the Cleanup Lambda to have least-privilege permissions, so that it can only perform the specific operations required for Cognito cleanup.

#### Acceptance Criteria

1. THE CloudFormation template SHALL define an IAM role for the Cleanup_Lambda following the `Prefix-ProjectId-StageId-CleanupExecution` naming pattern
2. THE Cleanup_Lambda IAM role SHALL include `dynamodb:GetRecords`, `dynamodb:GetShardIterator`, `dynamodb:DescribeStream`, and `dynamodb:ListStreams` permissions scoped to the Users_Table stream ARN
3. THE Cleanup_Lambda IAM role SHALL include `cognito-idp:AdminDeleteUser` permission scoped to the User_Pool ARN
4. THE Cleanup_Lambda IAM role SHALL include `ssm:GetParameter` permission scoped to the `Mcp_CognitoUserPoolId` SSM parameter ARN
5. THE Cleanup_Lambda IAM role SHALL include `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents` permissions scoped to the Cleanup_Lambda log group ARN
6. THE Cleanup_Lambda IAM role SHALL NOT include any permissions beyond those listed above

---

### Requirement 4: TTL Deletion Filtering

**User Story:** As a developer, I want the Cleanup Lambda to process only TTL-triggered deletions, so that application-level deletions (such as key regeneration) do not accidentally remove Cognito accounts.

#### Acceptance Criteria

1. WHEN a DynamoDB Streams record has `eventName` equal to `REMOVE` AND `userIdentity.principalId` equal to `dynamodb.amazonaws.com`, THE Cleanup_Lambda SHALL classify the record as a TTL_Deletion and proceed with Cognito cleanup
2. WHEN a DynamoDB Streams record has `eventName` equal to `REMOVE` AND `userIdentity.principalId` NOT equal to `dynamodb.amazonaws.com`, THE Cleanup_Lambda SHALL skip the record without performing any Cognito operations
3. WHEN a DynamoDB Streams record has `eventName` NOT equal to `REMOVE` (such as `INSERT` or `MODIFY`), THE Cleanup_Lambda SHALL skip the record without performing any operations
4. THE Cleanup_Lambda SHALL log the event type and filtering decision at the `info` level for each processed stream record
5. FOR ALL stream records processed by the Cleanup_Lambda, only records matching both `REMOVE` event name AND `dynamodb.amazonaws.com` principal SHALL trigger Cognito deletion (filtering correctness property)

---

### Requirement 5: Cognito User Deletion

**User Story:** As an administrator, I want orphaned Cognito users deleted when their DynamoDB record expires, so that the User Pool does not accumulate stale accounts.

#### Acceptance Criteria

1. WHEN the Cleanup_Lambda processes a TTL_Deletion, THE Cleanup_Lambda SHALL extract the `cognitoSub` value from the Old_Image of the stream record
2. THE Cleanup_Lambda SHALL retrieve the Cognito User Pool ID from the SSM parameter at `{ParameterStoreHierarchy}app-stack/Mcp_CognitoUserPoolId`
3. THE Cleanup_Lambda SHALL call `AdminDeleteUser` on the User_Pool using the extracted `cognitoSub` as the `Username` parameter
4. IF the Old_Image does not contain a `cognitoSub` field, THEN THE Cleanup_Lambda SHALL log a warning and skip the record without calling Cognito
5. IF the Old_Image `pk` does not start with `KEY#`, THEN THE Cleanup_Lambda SHALL skip the record without calling Cognito (voucher records and other non-user records are not associated with Cognito accounts)
6. WHEN `AdminDeleteUser` succeeds, THE Cleanup_Lambda SHALL log the deletion at the `info` level including the `cognitoSub` and email from the Old_Image
7. FOR ALL TTL_Deletions with a valid `cognitoSub` and `KEY#` prefix pk, the Cleanup_Lambda SHALL call `AdminDeleteUser` exactly once per record (idempotence property — processing the same stream record twice produces the same outcome)

---

### Requirement 6: Error Handling and Resilience

**User Story:** As a developer, I want the Cleanup Lambda to handle errors gracefully, so that a single failed deletion does not block processing of other records in the batch.

#### Acceptance Criteria

1. IF `AdminDeleteUser` returns a `UserNotFoundException` error, THEN THE Cleanup_Lambda SHALL log a warning and treat the record as successfully processed (the user was already deleted)
2. IF `AdminDeleteUser` returns any other error, THEN THE Cleanup_Lambda SHALL log the error at the `error` level including the `cognitoSub`, error message, and error code
3. WHEN processing a batch of stream records, THE Cleanup_Lambda SHALL use partial batch failure reporting by returning `batchItemFailures` containing only the sequence numbers of records that failed with non-recoverable errors
4. THE Cleanup_Lambda SHALL NOT throw an unhandled exception that causes the entire batch to be retried
5. IF the SSM parameter retrieval for the User Pool ID fails, THEN THE Cleanup_Lambda SHALL log the error and report all records in the current batch as failed (since no Cognito operations can proceed)
6. THE Cleanup_Lambda SHALL cache the User Pool ID from SSM for the lifetime of the Lambda execution environment to minimize SSM API calls

---

### Requirement 7: Cleanup Lambda Environment Configuration

**User Story:** As a developer, I want the Cleanup Lambda configured with the correct environment variables, so that it can locate the SSM parameter path and operate in the correct deployment context.

#### Acceptance Criteria

1. THE Cleanup_Lambda SHALL receive the `PARAM_STORE_PATH` environment variable set to the `ParameterStoreHierarchy` parameter value
2. THE Cleanup_Lambda SHALL receive the `DEPLOY_ENVIRONMENT` environment variable set to the `DeployEnvironment` parameter value
3. THE Cleanup_Lambda SHALL use `PARAM_STORE_PATH` combined with `app-stack/Mcp_CognitoUserPoolId` to construct the full SSM parameter name for the User Pool ID
4. THE Cleanup_Lambda SHALL NOT receive the Users_Table name or User Pool ID directly as environment variables (the table stream is the event source; the User Pool ID is retrieved from SSM at runtime)

---

### Requirement 8: Non-User Record Filtering

**User Story:** As a developer, I want the Cleanup Lambda to ignore non-user records in the stream, so that voucher record deletions and other non-user items do not trigger Cognito operations.

#### Acceptance Criteria

1. WHEN a TTL_Deletion Old_Image has a `pk` value starting with `VOUCHER#`, THE Cleanup_Lambda SHALL skip the record without calling Cognito
2. WHEN a TTL_Deletion Old_Image has a `pk` value that does not start with `KEY#`, THE Cleanup_Lambda SHALL skip the record without calling Cognito
3. THE Cleanup_Lambda SHALL log skipped non-user records at the `debug` level including the `pk` prefix
4. FOR ALL stream records, only records with Old_Image `pk` starting with `KEY#` AND containing a `cognitoSub` field SHALL trigger Cognito deletion (record type filtering property)
