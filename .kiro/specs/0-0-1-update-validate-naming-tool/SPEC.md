# Update Validate Naming Tool

All resource names must follow:

```
Prefix-ProjectId-StageId-ResourceName
```

Unless it is a shared resource deployed separately from the application stack:

```
Prefix-ProjectId-ResourceName
```

S3 buckets have alternatives:

```
Prefix-ProjectId-StageId-Region-AccountId (specific deployment instance, no Resource identifier)
Prefix-ProjectId-Region-AccountId (shared instance, no Resource identifier)
Prefix-ProjectId-StageId-ResourceName (not preferred)
```

Or, if the organization requires an additional `S3OrgPrefix` identifier:

```
S3BucketNameOrgPrefix-Prefix-ProjectId-StageId-Region-AccountId (specific deployment instance, no Resource identifier)
S3BucketNameOrgPrefix-Prefix-ProjectId-Region-AccountId (shared instance, no Resource identifier)
S3BucketNameOrgPrefix-Prefix-ProjectId-StageId-ResourceName (not preferred)
```

Where:

* **S3BucketNameOrgPrefix** = organization prefix for all S3 buckets (lowercase)
* **Prefix** = team or org identifier (lowercase)
* **ProjectId** = short identifier for the application (lowercase)
* **StageId** = test, beta/stage, prod (lowercase)
* **ResourceName** = Purpose of resource: Users, Sessions, Queue, Orders, etc. (Pascal Case, Only first letter of Acronyms are capital, e.g. Api, Mcp)

**AI must respect these naming conventions in all generated example code, IAM roles, and infrastructure.**

These names will be provided to the CloudFormation template as parameters (Prefix, ProjectId, and StageId, S3BucketNameOrgPrefix).

Correct example:

```
acme-person-api-test-GetPersonFunction
acme-schedules-prod-RefreshStepFunction
acme-schedules-prod-Sessions
acme-schedules-test-ApiResponseCount
acorp-acme-orders-test-123456789012-xy-east (s3 bucket with S3BucketNameOrgPrefix of acorp and stage id)
acorp-acme-orders-123456789012-xy-east (s3 bucket with S3BucketNameOrgPrefix of acorp and no stage id)
```

We need to update the naming validation tool to accept a resource type. For now, since only S3 has alternatives, if it is an S3 type then validate against the s3 rules.

Also, if it is being deployed as a shared resource (not an application stack) then it does not require a stageId.

While test, beta, stage, and prod are recommended stage ids, the stage id can actualy be t*, b*, s*, and p* where the first letter identifies the traditional stage id. This allows tjoe (for joe's test), tf187 (feature 187 test), etc.

Review documentation and tests to determine if anything else needs to be updated.

Ask any clarifying questions or make recomendations that I should pick from in SPEC-QUESTIONS.md and I will answer them there before we move on to the requirements stage.