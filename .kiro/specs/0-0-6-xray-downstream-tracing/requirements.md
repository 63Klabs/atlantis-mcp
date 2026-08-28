# Requirements Document

## Introduction

Every Lambda function in this stack already runs with AWS X-Ray active tracing (`Globals.Function.Tracing: "Active"` in `application-infrastructure/template.yml`, ~line 627). Despite this, the X-Ray service map does not show downstream calls to DynamoDB, S3, Bedrock, or S3 Vectors — traces stop at the Lambda node.

### Root Cause

There is a single root cause: **no `captureAWSv3Client()` X-Ray wrapping is applied to any AWS SDK v3 client anywhere in this project, so no downstream subsegments are ever recorded.** That root cause shows up in two different ways, which need different fixes but are not independent defects.

**Manifestation A — no wrapper call exists at all.** These modules construct AWS SDK v3 clients directly with no X-Ray capture wrapper anywhere in the call path (verified by inspection):

- `read-function/models/doc-index.js` (`new DynamoDBClient({})`)
- `doc-indexer/lib/dynamo-writer.js` (`new DynamoDBClient({})`)
- `auth-function/models/user.js` (`new DynamoDBClient({})`)
- `auth-function/models/voucher.js` (`new DynamoDBClient({})`)
- `layers/doc-ai-common/embedding-provider.js` (`new BedrockRuntimeClient({})`)
- `layers/doc-ai-common/assist-provider.js` (`new BedrockRuntimeClient({})`)
- `layers/doc-ai-common/vector-store-s3.js` (`new S3VectorsClient({})`)

**Manifestation B — the wrapper call exists but never executes.** The `@63klabs/cache-data` package's `tools.AWS` helper (`src/lib/tools/AWS.classes.js`) already calls `AWSXRay.captureAWSv3Client()` on its DynamoDB, S3, and SSM clients — but only after a `require('aws-xray-sdk-core')` inside a try/catch succeeds. That `require()` throws at runtime, the error is swallowed, `AWSXRay` stays `null`, and the clients are constructed unwrapped. The Read_Function uses this helper for its DynamoDB rate-limiter/auth-resolver calls and its S3-backed template/starter/agent-asset DAOs.

**Cache-data's wrapping logic is already correct.** Installing `aws-xray-sdk-core` is the *enabling condition* for Manifestation B, not a second defect to repair.

### Correction: the Lambda runtime does not provide `aws-xray-sdk-core`

A reasonable and common misconception is that because the AWS Lambda managed Node.js runtime bundles the AWS SDK for JavaScript v3 (`@aws-sdk/*`), it also bundles the X-Ray SDK. It does not. The X-Ray SDK must be included in the deployment package or supplied through a layer. This is recorded here explicitly so future maintainers do not re-litigate it.

- [AWS X-Ray Developer Guide — Lambda and X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-lambda.html): to record calls a function makes to other services, the X-Ray SDK is bundled with the function itself.
- [AWS Lambda Developer Guide — Node.js tracing](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-tracing.html): the documented Node.js instrumentation approach lists `aws-xray-sdk-core` as a `package.json` dependency of the function.

*Content was rephrased for compliance with licensing restrictions.*

### Empirical verification performed

- `aws-xray-sdk-core` is absent from `node_modules` in **all** of `read-function`, `auth-function`, `cleanup-function`, `doc-indexer`, `s3-vectors-provisioner`, and `layers/doc-ai-common`.
- `@63klabs/cache-data@1.3.11`'s `package.json` declares `aws-xray-sdk-core: ^3.12.0` under **`devDependencies`** — not `dependencies`, not `peerDependencies`, not `optionalDependencies` — so npm never installs it transitively into any deployed Lambda package.
- Of the five Lambda execution roles in `application-infrastructure/template.yml`, three attach `arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess` (`DocIndexerExecutionRole` ~line 1391, `S3VectorsProvisionerRole` ~line 1493, `ReadLambdaExecutionRole` ~line 1789) and two do not (`AuthLambdaExecutionRole` ~line 1121, `CleanupExecutionRole` ~line 1247).

### Scope

This feature closes the instrumentation gap so that DynamoDB, S3, Bedrock, and S3 Vectors calls made by the Read_Function, Auth_Function, and Doc_Indexer appear as subsegments in the X-Ray trace map and timeline. It also closes the pre-existing IAM gap that prevents two functions from writing trace segments at all.

**Out of scope for downstream-subsegment instrumentation:** The Cleanup Lambda (`cleanup-function`) only calls SSM and Cognito, neither of which is a downstream service targeted by this feature. The S3 Vectors provisioner Lambda (`s3-vectors-provisioner`) is a CloudFormation custom resource that runs only during stack create/update/delete to manage the vector bucket/index lifecycle, not during live request handling or scheduled indexing; instrumenting its one-off control-plane calls is not addressed here.

**Both functions are, however, in scope for the X-Ray write-access requirement (Requirement 5).** `Globals.Function.Tracing: "Active"` applies to every `AWS::Serverless::Function` in the stack, so each function needs X-Ray write permission to emit its own function segment regardless of whether its downstream calls are instrumented.

## Glossary

- **Downstream_Tracing_Feature**: The X-Ray instrumentation capability added by this feature to the Read_Function, Auth_Function, Doc_Indexer, and Doc_Ai_Common_Layer so their DynamoDB, S3, Bedrock, and S3 Vectors calls are captured as Downstream_Subsegments, together with the X_Ray_Write_Policy attachments required for all functions to emit trace segments.
- **Read_Function**: The `ReadLambdaFunction` Lambda (CloudFormation logical ID) defined in `application-infrastructure/template.yml`, sourced from `application-infrastructure/src/lambda/read-function/`.
- **Auth_Function**: The `AuthLambdaFunction` Lambda, sourced from `application-infrastructure/src/lambda/auth-function/`.
- **Doc_Indexer**: The `DocIndexerFunction` Lambda, sourced from `application-infrastructure/src/lambda/doc-indexer/`.
- **Cleanup_Function**: The Cleanup Lambda, sourced from `application-infrastructure/src/lambda/cleanup-function/`, which calls only SSM and Cognito.
- **S3_Vectors_Provisioner**: The CloudFormation custom-resource Lambda sourced from `application-infrastructure/src/lambda/s3-vectors-provisioner/`, which runs only during stack create/update/delete operations.
- **Doc_Ai_Common_Layer**: The shared Lambda Layer sourced from `application-infrastructure/src/lambda/layers/doc-ai-common/`, attached to both the Read_Function and the Doc_Indexer, containing `embedding-provider.js`, `assist-provider.js`, and `vector-store-s3.js`.
- **Cache_Data_AWS_Helper**: The `tools.AWS` static class exported by the `@63klabs/cache-data` package, which provides `AWS.dynamo`, `AWS.s3`, and `AWS.ssm` client accessors and conditionally wraps their underlying AWS SDK v3 clients with X-Ray capture when the X_Ray_Capture_Dependency is resolvable.
- **X_Ray_Capture_Dependency**: The `aws-xray-sdk-core` npm package, which provides `captureAWSv3Client()`. The AWS Lambda managed Node.js runtime does not provide this package; it must be bundled into the deployment package or supplied via a layer.
- **X_Ray_Write_Policy**: The AWS-managed IAM policy `arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess`, which grants the permissions a Lambda function needs to submit trace segments to X-Ray.
- **Lambda_Execution_Role**: Any `AWS::IAM::Role` in `application-infrastructure/template.yml` that a Lambda function in this stack assumes: `ReadLambdaExecutionRole`, `AuthLambdaExecutionRole`, `CleanupExecutionRole`, `DocIndexerExecutionRole`, and `S3VectorsProvisionerRole`.
- **Downstream_Subsegment**: An X-Ray subsegment recorded on the active trace representing a single call from a Lambda function to a downstream AWS service (DynamoDB, S3, Bedrock, or S3 Vectors), visible as a node in the X-Ray service map and as an entry in the trace timeline.
- **Test_Double**: A mocked or stubbed AWS SDK client substituted for a real client in an automated test (for example, via `aws-sdk-client-mock` or a Jest mock/spy).

## Requirements

### Requirement 1: Bedrock Downstream Visibility

**User Story:** As a platform engineer, I want Bedrock `InvokeModel` calls made by the embedding and assist providers to appear as X-Ray subsegments, so that I can diagnose latency and failures in the semantic search retrieval path from the X-Ray service map.

#### Acceptance Criteria

1. WHEN the embedding provider invokes the Bedrock Runtime client to generate a text embedding, THE Doc_Ai_Common_Layer SHALL record the call as a Downstream_Subsegment on the active X-Ray trace.
2. WHEN the assist provider invokes the Bedrock Runtime client to re-rank retrieval candidates, THE Doc_Ai_Common_Layer SHALL record the call as a Downstream_Subsegment on the active X-Ray trace.

### Requirement 2: S3 Vectors Downstream Visibility

**User Story:** As a platform engineer, I want S3 Vectors query, put, get, list, and delete calls to appear as X-Ray subsegments, so that I can see vector-store latency in the trace map for both query-time retrieval and index-time upserts.

#### Acceptance Criteria

1. WHEN the S3 Vectors store sends a request to the S3 Vectors client, THE Doc_Ai_Common_Layer SHALL record the call as a Downstream_Subsegment on the active X-Ray trace.

### Requirement 3: DynamoDB Downstream Visibility for Directly Constructed Clients

**User Story:** As a platform engineer, I want DynamoDB calls made through directly constructed AWS SDK clients to appear as X-Ray subsegments, so that documentation-index lookups and user/voucher lookups are visible in the trace map.

**Note:** This requirement addresses Manifestation A of the root cause — client-construction points with no X-Ray capture wrapper in the call path.

#### Acceptance Criteria

1. WHEN the Read_Function queries or retrieves items from the documentation index DynamoDB table, THE Read_Function SHALL record the call as a Downstream_Subsegment on the active X-Ray trace.
2. WHEN the Doc_Indexer writes items to the documentation index DynamoDB table, THE Doc_Indexer SHALL record the call as a Downstream_Subsegment on the active X-Ray trace.
3. WHEN the Auth_Function reads or writes items in the Users table or the Vouchers table, THE Auth_Function SHALL record the call as a Downstream_Subsegment on the active X-Ray trace.

### Requirement 4: DynamoDB and S3 Downstream Visibility for Cache-Data-Mediated Calls

**User Story:** As a platform engineer, I want DynamoDB and S3 calls made through the `@63klabs/cache-data` AWS helper to appear as X-Ray subsegments, so that cache storage operations, rate-limiting, and S3-backed template/starter/agent-asset lookups are visible in the trace map.

**Note:** This requirement addresses Manifestation B of the root cause. The Cache_Data_AWS_Helper's wrapping logic is already correct; satisfying acceptance criterion 1 is the enabling condition that lets it run.

#### Acceptance Criteria

1. THE Read_Function SHALL make the X_Ray_Capture_Dependency resolvable at runtime so the Cache_Data_AWS_Helper's existing X-Ray wrapping activates for its DynamoDB and S3 clients.
2. WHEN the Read_Function performs a DynamoDB or S3 operation through the Cache_Data_AWS_Helper while the X_Ray_Capture_Dependency is resolvable and X-Ray tracing is active, THE Read_Function SHALL record the call as a Downstream_Subsegment on the active X-Ray trace.

### Requirement 5: X-Ray Write Access for All Lambda Execution Roles

**User Story:** As a platform engineer, I want every Lambda execution role in this stack to hold X-Ray write permission, so that every function whose tracing is active can submit its trace segments instead of silently failing to report.

**Note:** `Globals.Function.Tracing: "Active"` (~line 627 of `application-infrastructure/template.yml`) applies to every `AWS::Serverless::Function` in the stack, but `AuthLambdaExecutionRole` (~line 1121) and `CleanupExecutionRole` (~line 1247) do not attach the X_Ray_Write_Policy, so those two functions cannot write trace segments at all. This is a pre-existing gap independent of the downstream-subsegment work, and it is fixed as part of this feature.

#### Acceptance Criteria

1. THE Downstream_Tracing_Feature SHALL attach the X_Ray_Write_Policy to every Lambda_Execution_Role in `application-infrastructure/template.yml`.
2. THE Downstream_Tracing_Feature SHALL add the X_Ray_Write_Policy to `AuthLambdaExecutionRole` and to `CleanupExecutionRole`, which are the two Lambda_Execution_Roles lacking it prior to this feature.
3. THE Downstream_Tracing_Feature SHALL grant X-Ray write permission by attaching the AWS-managed X_Ray_Write_Policy, consistent with the pattern already used by `ReadLambdaExecutionRole`, `DocIndexerExecutionRole`, and `S3VectorsProvisionerRole`, rather than by defining a custom inline X-Ray policy.
4. THE Downstream_Tracing_Feature SHALL introduce no IAM permission change other than the X_Ray_Write_Policy attachments described in acceptance criteria 1 through 3.
5. WHERE a Lambda function is out of scope for downstream-subsegment instrumentation, THE Downstream_Tracing_Feature SHALL still attach the X_Ray_Write_Policy to that function's Lambda_Execution_Role so the function can emit its own trace segment.

### Requirement 6: Minimal Dependency Footprint

**User Story:** As a platform maintainer, I want any new dependency required for X-Ray instrumentation to be limited to the smallest footprint necessary and declared so that it actually ships, so that the deployed Lambda packages remain small and the instrumentation is not silently inert.

**Note:** Declaring the X_Ray_Capture_Dependency only as a devDependency is the exact mistake that produced Manifestation B in `@63klabs/cache-data@1.3.11`; acceptance criterion 2 exists to prevent repeating it.

#### Acceptance Criteria

1. THE Downstream_Tracing_Feature SHALL add the X_Ray_Capture_Dependency only to the Lambda functions and the Lambda Layer that construct or use an AWS SDK v3 client requiring instrumentation under this feature.
2. THE Downstream_Tracing_Feature SHALL declare the X_Ray_Capture_Dependency as a production dependency of each function and layer that requires it, because the AWS Lambda managed Node.js runtime does not provide the X_Ray_Capture_Dependency.
3. THE Downstream_Tracing_Feature SHALL treat the AWS SDK for JavaScript v3 as provided by the Lambda runtime rather than as a bundled production dependency in any function or layer.

### Requirement 7: Behavior Preservation When X-Ray Is Unavailable or Disabled

**User Story:** As a developer, I want the application to behave identically whether or not X-Ray is enabled, so that local development and automated tests are unaffected by the instrumentation.

#### Acceptance Criteria

1. WHILE X-Ray tracing is disabled, THE Downstream_Tracing_Feature SHALL leave request handling, responses, and downstream call results unchanged from behavior prior to this feature.
2. IF the X_Ray_Capture_Dependency cannot be loaded at runtime, THEN THE Downstream_Tracing_Feature SHALL continue making DynamoDB, S3, Bedrock, and S3 Vectors calls without producing an error caused by the instrumentation.
3. WHILE an automated test substitutes a Test_Double for a DynamoDB, S3, Bedrock, or S3 Vectors client, THE Downstream_Tracing_Feature SHALL allow the Test_Double to intercept the call in the same way it did before this feature.

### Requirement 8: Consistent Instrumentation Across the Shared Layer

**User Story:** As a maintainer, I want the Bedrock and S3 Vectors instrumentation implemented once in the shared layer, so that both the Read_Function and the Doc_Indexer automatically get consistent tracing without duplicated code.

#### Acceptance Criteria

1. THE Doc_Ai_Common_Layer SHALL implement its Bedrock and S3 Vectors client instrumentation in a location shared by the Read_Function and the Doc_Indexer, rather than duplicating it per consuming function.
2. WHEN either the Read_Function or the Doc_Indexer loads the Doc_Ai_Common_Layer, THE Doc_Ai_Common_Layer SHALL apply the same instrumentation regardless of which function loaded it.

### Requirement 9: Automated Test Coverage

**User Story:** As a maintainer, I want automated tests verifying the instrumentation logic, so that regressions in X-Ray coverage or in disabled-tracing behavior are caught before deployment.

#### Acceptance Criteria

1. THE Downstream_Tracing_Feature SHALL include Jest tests verifying that each instrumented client-construction point applies the X-Ray capture wrapper when X-Ray tracing is active and the X_Ray_Capture_Dependency is resolvable.
2. THE Downstream_Tracing_Feature SHALL include Jest tests verifying that each instrumented client-construction point produces a functioning, uninstrumented client when X-Ray tracing is disabled or the X_Ray_Capture_Dependency is unavailable.
