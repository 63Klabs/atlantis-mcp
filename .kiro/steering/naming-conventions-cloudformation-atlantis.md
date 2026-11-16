---
inclusion: fileMatch
fileMatchPattern: '**/{template,cfn}*.{yml,yaml}'
---
# Naming Conventions - CloudFormation/SAM Templates (Atlantis)

Applies to templates deployed with the Atlantis platform. These rules add to, and take priority over, `naming-conventions-cloudformation.md` for physical resource names.

## Parameters

Every Atlantis template has these parameters. Keep their names and constraints exactly as shown in the starter templates.

| Parameter | Rule |
|-----------|------|
| `Prefix` | 2 to 8 characters. Lowercase letters, numbers, and hyphens. Starts with a letter and ends with a letter or number. A team or organization identifier. |
| `ProjectId` | 2 to 26 characters. Same character rules as `Prefix`. Length of `Prefix` plus `ProjectId` must not exceed 28. |
| `StageId` | 2 to 8 characters. Same character rules as `Prefix`. Short alias for the branch, such as `test` or `prod`. |
| `S3BucketNameOrgPrefix` | Empty, or 2 to 20 characters. Optional prefix that keeps bucket names unique. |

## Physical resource names

Name resources `<Prefix>-<ProjectId>-<StageId>-<ResourceId>`. `ResourceId` is `PascalCase`.

```yaml
Resources:
  AppFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${Prefix}-${ProjectId}-${StageId}-AppFunction'

  LambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Sub '${Prefix}-${ProjectId}-${StageId}-LambdaExecRole'

  AppLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub '/aws/lambda/${Prefix}-${ProjectId}-${StageId}-AppFunction'
```

- Shared resources that are not tied to a stage omit `StageId`: `<Prefix>-<ProjectId>-<ResourceId>`.
- Service roles use `PREFIX-ProjectId-ResourceSuffix` with a `PascalCase` suffix. Check the exact form with `validate_naming` (see below).
- Write the Lambda log group name with `Fn::Sub` from `Prefix`, `ProjectId`, and `StageId`. Do not use `!Ref` or `!GetAtt` on the function, which creates a circular reference.

## S3 bucket names

Bucket names must be lowercase. Use one of these patterns, with `<ResourceId>` in lowercase:

| Pattern | Use |
|---------|-----|
| `<Prefix>-<ProjectId>-<StageId>-<ResourceId>-<AccountId>-<Region>-an` with `BucketNamespace: account-regional` | Account-regional namespace. |
| `<Prefix>-<Region>-<AccountId>-<ProjectId>-<StageId>-<ResourceId>` | Global namespace. |
| Either pattern with `<S3BucketNameOrgPrefix>-` at the front | When `S3BucketNameOrgPrefix` is set, to shorten or disambiguate. |

## Validate

Check a planned name with the Atlantis MCP `validate_naming` tool before you create the resource. Pass `prefix`, `projectId`, and `stageId` when the name contains hyphenated parts.
