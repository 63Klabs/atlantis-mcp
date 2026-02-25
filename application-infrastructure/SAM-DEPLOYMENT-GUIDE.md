# SAM Deployment Guide - Atlantis MCP Server

This guide explains how to configure and deploy the Atlantis MCP Server using AWS SAM for local development and testing.

## Prerequisites

1. **AWS SAM CLI** installed ([Installation Guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html))
2. **AWS CLI** configured with appropriate credentials
3. **Node.js 24.x** installed
4. **Python 3.x** installed (for build scripts)
5. **Cache-Data Storage Stack** deployed (provides DynamoDB table and S3 bucket for caching)

## Configuration Files

- `samconfig-test.toml` - Configuration for TEST environment
- `samconfig-prod.toml` - Configuration for PROD environment

## Required Parameter Overrides

Before deploying, you MUST update the following parameters in your samconfig file:

### Critical Parameters (Must Update)

1. **DeployRole**: IAM role ARN for CodeDeploy
   ```
   DeployRole=arn:aws:iam::YOUR_ACCOUNT_ID:role/CodeDeployServiceRole
   ```

2. **AlarmNotificationEmail**: Email address for CloudWatch alarms
   ```
   AlarmNotificationEmail=your-email@example.com
   ```

3. **Prefix**: Your organization/team identifier (2-8 characters)
   ```
   Prefix=acme
   ```

4. **ProjectId**: Application identifier (2-26 characters)
   ```
   ProjectId=atlantis-mcp
   ```

5. **StageId**: Environment stage (2-8 characters)
   ```
   StageId=test  # or prod, beta, stage
   ```

### MCP Server Configuration

6. **AtlantisS3Buckets**: Comma-delimited list of S3 buckets containing templates
   ```
   AtlantisS3Buckets=my-templates-bucket,another-bucket
   ```
   - Buckets must have `atlantis-mcp:Allow=true` tag
   - Buckets must have `atlantis-mcp:IndexPriority` tag with namespace list

7. **AtlantisGitHubUserOrgs**: Comma-delimited list of GitHub users/orgs
   ```
   AtlantisGitHubUserOrgs=63Klabs,myorg,myuser
   ```

8. **GitHubTokenParameter**: SSM Parameter Store path for GitHub token
   ```
   GitHubTokenParameter=/atlantis-mcp/github/token
   ```
   - Token must have `repo` and `read:org` scopes
   - Store token in SSM Parameter Store before deployment

### Optional Parameters

9. **ReadLambdaExecRoleIncludeManagedPolicyArns**: Additional IAM policies
   ```
   ReadLambdaExecRoleIncludeManagedPolicyArns=arn:aws:iam::aws:policy/CustomPolicy
   ```

10. **CacheDataDynamoDbTableName**: Override cache table name
    ```
    CacheDataDynamoDbTableName=my-cache-table
    ```
    - Leave empty to use ImportValue from Cache-Data storage stack

11. **CacheDataS3BucketName**: Override cache bucket name
    ```
    CacheDataS3BucketName=my-cache-bucket
    ```
    - Leave empty to use ImportValue from Cache-Data storage stack

## Environment-Specific Differences

### TEST Environment (samconfig-test.toml)

- **DeployEnvironment**: TEST
- **FunctionGradualDeploymentType**: AllAtOnce (immediate deployment)
- **LogLevel**: DEBUG (verbose logging)
- **LogRetention**: 7 days
- **ApiGatewayLoggingEnabled**: FALSE (to reduce costs)
- **Alarms**: Not created (to reduce costs)
- **Dashboard**: Not created (to reduce costs)

### PROD Environment (samconfig-prod.toml)

- **DeployEnvironment**: PROD
- **FunctionGradualDeploymentType**: Linear10PercentEvery3Minutes (gradual rollout)
- **LogLevel**: INFO (standard logging)
- **LogRetention**: 180 days
- **ApiGatewayLoggingEnabled**: TRUE (full logging)
- **Alarms**: Created for error monitoring
- **Dashboard**: Created for operational visibility

## Deployment Steps

### 1. Update Configuration

Edit the appropriate samconfig file (`samconfig-test.toml` or `samconfig-prod.toml`) and update all required parameters.

### 2. Store GitHub Token in SSM

```bash
aws ssm put-parameter \
  --name "/atlantis-mcp/github/token" \
  --value "ghp_your_github_token_here" \
  --type "SecureString" \
  --description "GitHub Personal Access Token for Atlantis MCP Server"
```

### 3. Build the Application

```bash
cd application-infrastructure
sam build --config-file samconfig-test.toml
```

### 4. Validate the Template

```bash
sam validate --config-file samconfig-test.toml
```

### 5. Deploy to AWS

For first-time deployment (guided):
```bash
sam deploy --config-file samconfig-test.toml --guided
```

For subsequent deployments:
```bash
sam deploy --config-file samconfig-test.toml
```

### 6. Verify Deployment

After deployment, check the CloudFormation outputs:
```bash
aws cloudformation describe-stacks \
  --stack-name atlantis-mcp-test \
  --query 'Stacks[0].Outputs'
```

## Testing the Deployment

### 1. Get API Endpoint

From CloudFormation outputs, find the `ApiEndpoint` value:
```
https://abc123xyz.execute-api.us-east-1.amazonaws.com/api/mcp/
```

### 2. Test MCP Tool

```bash
curl -X POST \
  https://abc123xyz.execute-api.us-east-1.amazonaws.com/api/mcp/list_categories \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response:
```json
{
  "categories": [
    {"name": "Storage", "description": "..."},
    {"name": "Network", "description": "..."},
    ...
  ]
}
```

## Troubleshooting

### Build Failures

1. **Missing dependencies**: Run `npm install` in `src/lambda/read/`
2. **Python script errors**: Ensure Python 3.x is installed and build-scripts dependencies are available

### Deployment Failures

1. **IAM permissions**: Ensure your AWS credentials have sufficient permissions
2. **DeployRole not found**: Update the DeployRole ARN in samconfig
3. **Cache-Data stack not found**: Deploy the Cache-Data storage stack first

### Runtime Errors

1. **GitHub token not found**: Verify SSM parameter exists and Lambda has permission to read it
2. **S3 bucket access denied**: Verify buckets have `atlantis-mcp:Allow=true` tag
3. **Rate limit errors**: Check CloudWatch logs for detailed error messages

## CI/CD Deployment

For production deployments, use the Atlantis Configuration Repository scripts instead of SAM CLI:

1. Push code to appropriate branch (test, beta, main)
2. CodePipeline automatically triggers
3. CodeBuild runs tests and builds artifacts
4. CloudFormation deploys the stack

Do NOT use `sam deploy` for production CI/CD deployments.

## Local Development

For local testing with SAM Local:

```bash
# Start API Gateway locally
sam local start-api --config-file samconfig-test.toml

# Invoke function directly
sam local invoke ReadLambdaFunction \
  --config-file samconfig-test.toml \
  --event events/list-templates.json
```

## Parameter Reference

See `docs/deployment/cloudformation-parameters.md` for detailed parameter descriptions.

## Security Notes

1. **Never commit credentials** to version control
2. **Use SSM Parameter Store** for all secrets
3. **Apply least privilege** IAM policies
4. **Enable API Gateway logging** in production
5. **Monitor CloudWatch alarms** for security events

## Support

For issues or questions:
- GitHub Issues: https://github.com/63Klabs/atlantis-mcp-server/issues
- Documentation: See `docs/` directory
- Security: See `SECURITY.md`
