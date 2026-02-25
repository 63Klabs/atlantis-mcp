# Quick Start - SAM Deployment

This is a quick reference for deploying the Atlantis MCP Server using AWS SAM CLI.

For detailed instructions, see [SAM Deployment Guide](sam-deployment-guide.md).

## Prerequisites Checklist

- [ ] AWS SAM CLI installed
- [ ] AWS CLI configured with credentials
- [ ] Node.js 24.x installed
- [ ] Python 3.x installed
- [ ] GitHub Personal Access Token created (with `repo` and `read:org` scopes)
- [ ] Cache-Data storage stack deployed (or explicit DynamoDB/S3 resources available)

## Quick Deployment Steps

### 1. Update Configuration

Edit `samconfig-test.toml` (or `samconfig-prod.toml`):

```toml
# MUST UPDATE these parameters:
"Prefix=YOUR_PREFIX",                    # Your org/team identifier
"ProjectId=atlantis-mcp",                # Keep or customize
"StageId=test",                          # test, prod, beta, stage
"DeployRole=arn:aws:iam::YOUR_ACCOUNT:role/CodeDeployServiceRole",
"AlarmNotificationEmail=your-email@example.com",
"AtlantisS3Buckets=your-bucket-1,your-bucket-2",  # S3 buckets with templates
"AtlantisGitHubUserOrgs=63Klabs,your-org",        # GitHub orgs to search
```

### 2. Store GitHub Token

```bash
aws ssm put-parameter \
  --name "/atlantis-mcp/github/token" \
  --value "ghp_YOUR_GITHUB_TOKEN" \
  --type "SecureString"
```

### 3. Validate Configuration

```bash
cd application-infrastructure
./test-sam-deployment.sh samconfig-test.toml
```

### 4. Build

```bash
sam build --config-file samconfig-test.toml
```

Or test the build:
```bash
./test-sam-build.sh
```

### 5. Deploy

First deployment (guided):
```bash
sam deploy --config-file samconfig-test.toml --guided
```

Subsequent deployments:
```bash
sam deploy --config-file samconfig-test.toml
```

### 6. Test

Get the API endpoint from CloudFormation outputs:
```bash
aws cloudformation describe-stacks \
  --stack-name atlantis-mcp-test \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

Test an MCP tool:
```bash
curl -X POST https://YOUR_API_ENDPOINT/list_categories \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Environment Differences

| Setting | TEST | PROD |
|---------|------|------|
| Deployment | AllAtOnce | Linear10PercentEvery3Minutes |
| Log Level | DEBUG | INFO |
| Log Retention | 7 days | 180 days |
| API Gateway Logging | FALSE | TRUE |
| CloudWatch Alarms | Not created | Created |
| CloudWatch Dashboard | Not created | Created |

## Common Issues

### Build Fails
- Run `npm install` in `src/lambda/read/`
- Check Node.js version (must be 24.x)

### Deployment Fails
- Verify AWS credentials: `aws sts get-caller-identity`
- Check DeployRole ARN is correct
- Ensure Cache-Data stack exists or use explicit table/bucket names

### GitHub Token Not Found
```bash
# Verify token exists
aws ssm get-parameter --name "/atlantis-mcp/github/token" --with-decryption
```

### S3 Bucket Access Denied
- Verify buckets have `atlantis-mcp:Allow=true` tag
- Verify buckets have `atlantis-mcp:IndexPriority` tag with namespace list

## Validation Scripts

```bash
# Test SAM build process
./test-sam-build.sh

# Validate deployment prerequisites
./test-sam-deployment.sh samconfig-test.toml

# For production
./test-sam-deployment.sh samconfig-prod.toml
```

## Local Testing

```bash
# Start API Gateway locally
sam local start-api --config-file samconfig-test.toml

# Invoke function directly
sam local invoke ReadLambdaFunction \
  --config-file samconfig-test.toml \
  --event events/test-event.json
```

## Cleanup

```bash
# Delete the stack
aws cloudformation delete-stack --stack-name atlantis-mcp-test

# Wait for deletion
aws cloudformation wait stack-delete-complete --stack-name atlantis-mcp-test
```

## CI/CD Deployment

**Important**: For production deployments through CI/CD pipelines:

1. Push code to appropriate branch (test, beta, main)
2. CodePipeline automatically triggers
3. Do NOT use `sam deploy` for CI/CD

The Atlantis Configuration Repository handles automated deployments.

## Support

- Full Guide: [SAM Deployment Guide](sam-deployment-guide.md)
- CloudFormation Parameters: [../../deployment/cloudformation-parameters.md](../../deployment/cloudformation-parameters.md)
- GitHub Issues: https://github.com/63Klabs/atlantis-mcp-server/issues
