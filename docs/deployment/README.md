# Atlantis MCP Server - Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the Atlantis MCP Server to AWS using the Atlantis SAM Configuration Repository. The MCP server is deployed as a serverless application using AWS Lambda, API Gateway, DynamoDB, and S3.

## Prerequisites

Before deploying the Atlantis MCP Server, ensure you have:

1. **AWS Account** with appropriate permissions
2. **Atlantis SAM Configuration Repository** cloned locally
   - Repository: [atlantis-cfn-configuration-repo-for-serverless-deployments](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)
3. **Python 3.9+** installed (for deployment scripts)
4. **AWS CLI** configured with credentials
5. **Git** installed
6. **S3 Buckets** configured with Atlantis templates (see [S3 Bucket Configuration](#s3-bucket-configuration))
7. **GitHub Personal Access Token** (if accessing private repositories)

## Deployment Architecture

The Atlantis MCP Server follows the Atlantis platform deployment pattern:

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Repository                         │
│              atlantis-mcp-server-phase-1                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Push to branch
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   AWS CodePipeline                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Source  │→ │  Build   │→ │  Deploy  │→ │  Test    │   │
│  │ (GitHub) │  │(CodeBuild)│  │(CloudFrm)│  │(Optional)│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ Deploys
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Deployed Resources                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ API Gateway  │→ │Read Lambda   │→ │  DynamoDB    │     │
│  │(Rate Limit)  │  │(Node.js 24.x)│  │(Cache Table) │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│                           │                                  │
│                           ▼                                  │
│                    ┌──────────────┐                         │
│                    │  S3 Buckets  │                         │
│                    │(Templates &  │                         │
│                    │  Starters)   │                         │
│                    └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

## Branch-to-Environment Mapping

The Atlantis MCP Server uses branch-based deployments:

| Branch | Environment | Stage | Deployment Type |
|--------|-------------|-------|-----------------|
| `test` | TEST | Test | Immediate, verbose logs |
| `beta` | PROD | Beta | Gradual, production settings |
| `stage` | PROD | Stage | Gradual, production settings |
| `main` | PROD | Prod | Gradual, production settings |

**Deployment Flow:**
```
dev → test → beta → main
```

## Step 1: Clone and Configure SAM Configuration Repository

### 1.1 Clone the Repository

```bash
git clone https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments.git
cd atlantis-cfn-configuration-repo-for-serverless-deployments
```

### 1.2 Install Dependencies

```bash
pip install -r requirements.txt
```

### 1.3 Configure AWS Credentials

Ensure your AWS CLI is configured with appropriate credentials:

```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, Region, and Output format
```

## Step 2: Prepare MCP Server Repository

### 2.1 Clone MCP Server Repository

```bash
git clone https://github.com/63klabs/atlantis-mcp-server-phase-1.git
cd atlantis-mcp-server-phase-1
```

### 2.2 Review template.yml

The `template.yml` file defines all AWS resources for the MCP server. Key resources include:

- **Read_Lambda**: Lambda function for read-only MCP operations
- **API Gateway**: REST API with rate limiting
- **DynamoDB Table**: Cache storage
- **S3 Bucket**: Cache storage for large objects
- **IAM Roles**: Least-privilege execution roles

## Step 3: Configure Deployment Parameters

### 3.1 Create Configuration File

Create a configuration file for your deployment environment:

```bash
cd ../atlantis-cfn-configuration-repo-for-serverless-deployments
cp config-template.json config-mcp-server-test.json
```

### 3.2 Edit Configuration

Edit `config-mcp-server-test.json` with your deployment parameters:

```json
{
  "StackName": "atlantis-mcp-server-test",
  "Parameters": {
    "Prefix": "acme",
    "ProjectId": "mcp-server",
    "StageId": "test",
    "AtlantisS3Buckets": "acme-atlantis-templates-us-east-1,acme-finance-templates-us-east-1",
    "AtlantisGitHubUserOrgs": "63klabs,acme-org",
    "PublicRateLimit": "100",
    "GitHubToken": "/atlantis/mcp/github-token",
    "LogLevel": "INFO",
    "ReadLambdaExecRoleIncludeManagedPolicyArns": "",
    "CacheTTLTemplateList": "3600",
    "CacheTTLTemplateDetail": "86400",
    "CacheTTLTemplateVersions": "3600",
    "CacheTTLStarterList": "3600",
    "CacheTTLStarterDetail": "3600",
    "CacheTTLDocumentationIndex": "21600",
    "CacheTTLCodePatterns": "21600",
    "CacheTTLGitHubMetadata": "1800",
    "CacheTTLGitHubProperties": "3600",
    "CacheTTLFullTemplateContent": "86400"
  },
  "Tags": {
    "Environment": "test",
    "Project": "atlantis-mcp-server",
    "ManagedBy": "CloudFormation"
  }
}
```

**Parameter Descriptions:**

- **Prefix**: Organization or team identifier (e.g., "acme")
- **ProjectId**: Project identifier (e.g., "mcp-server")
- **StageId**: Environment stage (test, beta, stage, prod)
- **AtlantisS3Buckets**: Comma-delimited list of S3 buckets containing templates and starters
- **AtlantisGitHubUserOrgs**: Comma-delimited list of GitHub users/organizations
- **PublicRateLimit**: Requests per hour per IP (default: 100)
- **GitHubToken**: SSM Parameter Store path for GitHub token
- **LogLevel**: Logging level (ERROR, WARN, INFO, DEBUG, DIAG)
- **ReadLambdaExecRoleIncludeManagedPolicyArns**: Additional managed policy ARNs (comma-delimited)
- **CacheTTL***: Cache TTL values in seconds for each resource type

## Step 4: Store GitHub Token in SSM Parameter Store

If accessing private GitHub repositories, store your GitHub Personal Access Token in SSM Parameter Store:

```bash
aws ssm put-parameter \
  --name "/atlantis/mcp/github-token" \
  --value "ghp_your_token_here" \
  --type "SecureString" \
  --description "GitHub Personal Access Token for Atlantis MCP Server"
```

**Required GitHub Token Scopes:**
- `repo` (for private repositories)
- `read:org` (for organization repositories)
- `read:user` (for user repositories)

See [GitHub Token Setup](./github-token-setup.md) for detailed instructions.

## Step 5: Deploy Using SAM Configuration Scripts

### 5.1 Run config.py

The `config.py` script prepares the deployment configuration:

```bash
python config.py \
  --config config-mcp-server-test.json \
  --template ../atlantis-mcp-server-phase-1/template.yml \
  --output samconfig-mcp-server-test.toml
```

### 5.2 Run deploy.py

The `deploy.py` script deploys the CloudFormation stack:

```bash
python deploy.py \
  --config samconfig-mcp-server-test.toml \
  --region us-east-1
```

**Deployment Process:**
1. Validates CloudFormation template
2. Packages Lambda function code
3. Uploads artifacts to S3
4. Creates/updates CloudFormation stack
5. Waits for stack completion
6. Outputs API Gateway endpoint URL

### 5.3 Monitor Deployment

Monitor the deployment progress:

```bash
aws cloudformation describe-stack-events \
  --stack-name atlantis-mcp-server-test \
  --region us-east-1
```

## Step 6: Verify Deployment

### 6.1 Check Stack Status

```bash
aws cloudformation describe-stacks \
  --stack-name atlantis-mcp-server-test \
  --region us-east-1 \
  --query 'Stacks[0].StackStatus'
```

Expected output: `CREATE_COMPLETE` or `UPDATE_COMPLETE`

### 6.2 Get API Gateway Endpoint

```bash
aws cloudformation describe-stacks \
  --stack-name atlantis-mcp-server-test \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

### 6.3 Test MCP Server

Test the MCP server using curl:

```bash
curl -X POST https://your-api-endpoint.execute-api.us-east-1.amazonaws.com/Prod/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

Expected response: List of available MCP tools

## Step 7: Configure CI/CD Pipeline (Optional)

For automated deployments on git push, configure AWS CodePipeline:

### 7.1 Create Pipeline Stack

Use the Atlantis pipeline template:

```bash
aws cloudformation create-stack \
  --stack-name atlantis-mcp-server-pipeline \
  --template-url https://s3.amazonaws.com/atlantis-templates/v2/pipeline/template-pipeline-github.yml \
  --parameters \
    ParameterKey=Prefix,ParameterValue=acme \
    ParameterKey=ProjectId,ParameterValue=mcp-server \
    ParameterKey=GitHubRepo,ParameterValue=atlantis-mcp-server-phase-1 \
    ParameterKey=GitHubOwner,ParameterValue=63klabs \
    ParameterKey=GitHubBranch,ParameterValue=test \
  --capabilities CAPABILITY_IAM
```

### 7.2 Connect GitHub Repository

Follow the AWS Console instructions to connect your GitHub repository to CodePipeline.

## Step 8: Post-Deployment Configuration

### 8.1 Configure S3 Bucket Tags

Ensure your S3 buckets have the required tags:

```bash
aws s3api put-bucket-tagging \
  --bucket acme-atlantis-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis,finance,devops"}
  ]'
```

See [S3 Bucket Tagging](./s3-bucket-tagging.md) for detailed instructions.

### 8.2 Configure GitHub Custom Properties

Set up GitHub custom properties on your repositories:

```bash
# Using GitHub CLI
gh api repos/63klabs/atlantis-starter-02/properties/values \
  -X PATCH \
  -f properties[][property_name]=atlantis_repository-type \
  -f properties[][value]=app-starter
```

See [GitHub Custom Properties Setup](./github-custom-properties.md) for detailed instructions.

## Troubleshooting

### Deployment Fails with "Insufficient Permissions"

**Solution**: Ensure your AWS credentials have the following permissions:
- `cloudformation:*`
- `lambda:*`
- `apigateway:*`
- `dynamodb:*`
- `s3:*`
- `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole`
- `logs:*`

### Lambda Function Fails to Start

**Solution**: Check CloudWatch Logs:

```bash
aws logs tail /aws/lambda/acme-mcp-server-test-ReadFunction --follow
```

Common issues:
- Missing environment variables
- Invalid S3 bucket names
- GitHub token not found in SSM Parameter Store

### API Gateway Returns 429 (Rate Limit Exceeded)

**Solution**: Increase the `PublicRateLimit` parameter in your configuration and redeploy.

### Templates Not Found

**Solution**: Verify S3 bucket configuration:
1. Check bucket names in `AtlantisS3Buckets` parameter
2. Verify `atlantis-mcp:Allow=true` tag on buckets
3. Verify `atlantis-mcp:IndexPriority` tag lists correct namespaces
4. Check Lambda execution role has S3 read permissions

## Updating the Deployment

To update an existing deployment:

1. Update configuration file with new parameters
2. Run `config.py` and `deploy.py` again
3. CloudFormation will perform an update operation

```bash
python config.py --config config-mcp-server-test.json --template ../atlantis-mcp-server-phase-1/template.yml --output samconfig-mcp-server-test.toml
python deploy.py --config samconfig-mcp-server-test.toml --region us-east-1
```

## Deleting the Deployment

To remove the MCP server:

```bash
aws cloudformation delete-stack \
  --stack-name atlantis-mcp-server-test \
  --region us-east-1
```

**Warning**: This will delete all resources including the DynamoDB cache table and S3 cache bucket. Cached data will be lost.

## Multi-Region Deployment

To deploy the MCP server in multiple regions:

1. Create separate configuration files for each region
2. Deploy to each region using the SAM configuration scripts
3. Use Route53 for global load balancing (optional)

Example:

```bash
# Deploy to us-east-1
python deploy.py --config samconfig-mcp-server-test-us-east-1.toml --region us-east-1

# Deploy to us-west-2
python deploy.py --config samconfig-mcp-server-test-us-west-2.toml --region us-west-2
```

## Production Deployment Checklist

Before deploying to production:

- [ ] Review all CloudFormation parameters
- [ ] Configure appropriate cache TTL values
- [ ] Set up CloudWatch Alarms for error rates and latency
- [ ] Configure API Gateway custom domain (optional)
- [ ] Enable AWS X-Ray tracing for debugging
- [ ] Set up automated backups for DynamoDB cache table
- [ ] Configure VPC endpoints for S3 and DynamoDB (if in VPC)
- [ ] Review IAM permissions and apply least privilege
- [ ] Test rate limiting with expected load
- [ ] Document runbook for common operational tasks

## Next Steps

- [CloudFormation Parameters Reference](./cloudformation-parameters.md)
- [GitHub Token Setup](./github-token-setup.md)
- [S3 Bucket Configuration](./s3-bucket-tagging.md)
- [GitHub Custom Properties Setup](./github-custom-properties.md)
- [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md)
- [Multiple GitHub Org Configuration](./multiple-github-orgs.md)
- [Self-Hosting Guide](./self-hosting.md)

## Support

For issues or questions:
- GitHub Issues: [atlantis-mcp-server-phase-1/issues](https://github.com/63klabs/atlantis-mcp-server-phase-1/issues)
- Documentation: [README.md](../../README.md)
