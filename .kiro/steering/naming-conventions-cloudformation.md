---
inclusion: fileMatch
fileMatchPattern: '**/{template,cfn}*.{yml,yaml}'
---
# Naming Conventions - CloudFormation/SAM Templates

Applies to CloudFormation and SAM template files. The common rules (acronyms as words, follow existing code) also apply. Do not rename existing logical IDs: changing one replaces the resource.

| Item | Convention | Example |
|------|-----------|---------|
| Parameters | `PascalCase` | `EnvironmentName` |
| Resource logical IDs | `PascalCase` | `UserTable`, `ApiGateway` |
| Conditions | `PascalCase`, starting with `Is`, `Has`, `Use`, or `Create` | `IsProduction` |
| Mappings and their keys | `PascalCase` | `EnvironmentConfig` |
| Outputs | `PascalCase` | `UserTableName` |
| Lambda environment variables | `UPPER_SNAKE_CASE` | `TABLE_NAME` |
| Standard tag keys | `PascalCase` | `Environment` |
| Service tag keys | `serviceName:TagName` | `cacheInvalidator:AllowAccess` |

## Logical IDs and other names

- Do not give a parameter and a condition the same name. Start condition names with `Is`, `Has`, `Use`, or `Create` to keep them distinct (parameter `EnableAutoScaling`, condition `AutoScalingIsEnabled`).
- Treat acronyms as words: `ApiGatewayRestApi`, `ApiEndpoint`, `LoadBalancerDns`, `VpcCidr`. Mapping keys that are AWS values (`us-east-1`, `prod`) stay as AWS defines them.
- Name a logical ID for what the resource is, with its type when ambiguous: `UserTable`, `GetUserFunction`, `LambdaExecutionRole`.
- Use `Fn::Sub` with parameters to build physical names. Do not hard-code account IDs, regions, or environment names.

```yaml
Parameters:
  EnvironmentName:
    Type: String
    AllowedValues: [dev, prod]

Conditions:
  IsProduction: !Equals [!Ref EnvironmentName, prod]

Resources:
  UserTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub ${AWS::StackName}-users

Outputs:
  UserTableName:
    Value: !Ref UserTable
    Export:
      Name: !Sub ${AWS::StackName}-UserTableName
```

## Physical names

- Follow the physical-name pattern already used in the template or repository, and keep it the same across all resources in a stack.
- Include a stack, project, or stage identifier in the name so stacks do not collide.
- S3 bucket names must be lowercase letters, numbers, and hyphens.
- Apply the same pattern to IAM role and policy names. The logical ID stays `PascalCase`.

## Tags

- Put the tags your organization requires on every resource that supports tags. Use `PascalCase` keys such as `Environment`, `Project`, and `Owner`. Take values from parameters, not literals.
- For tags that control a specific service or tool, use `serviceName:TagName`. The service name is `camelCase` and the tag name is `PascalCase`: `cacheInvalidator:AllowAccess`.
- For GitHub custom properties, replace the colon with an underscore: `cacheInvalidator_AllowAccess`.
