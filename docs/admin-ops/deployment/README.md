# 63Klabs Atlantis MCP Server - Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the 63Klabs Atlantis MCP Server to AWS using the Atlantis SAM Configuration Repository. The MCP server is deployed as a serverless application using AWS Lambda, API Gateway, DynamoDB, and S3.

## Prerequisites

Before deploying the 63Klabs Atlantis MCP Server, ensure you have:

1. **AWS Account** with appropriate permissions
2. **Atlantis SAM Configuration Repository** cloned locally
   - Repository: [atlantis-cfn-configuration-repo-for-serverless-deployments](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)
3. **Python 3.9+** installed (for deployment scripts)
4. **AWS CLI** configured with credentials
5. **Git** installed
6. **S3 Buckets** configured with Atlantis templates (see [S3 Bucket Configuration](#s3-bucket-configuration))
7. **GitHub Personal Access Token** (if accessing private repositories)

## Deployment Architecture

The 63Klabs Atlantis MCP Server follows the 63Klabs Atlantis DevOps Platform deployment pattern:

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Repository                        │
│              atlantis-mcp-server-phase-1                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Push to branch
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   AWS CodePipeline                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Source  │→ │  Build    │→ │  Deploy  │→ │  Test    │    │
│  │ (GitHub) │  │(CodeBuild)│  │(CloudFrm)│  │(Optional)│    │
│  └──────────┘  └───────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
                       │
                       │ Deploys
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Deployed Resources                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ API Gateway  │→ │Read Lambda   │→ │  DynamoDB    │       │
│  │(Rate Limit)  │  │(Node.js 24.x)│  │(Cache Table) │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                           │                                 │
│                           ▼                                 │
│                    ┌──────────────┐                         │
│                    │  S3 Buckets  │                         │
│                    │(Templates &  │                         │
│                    │  Starters)   │                         │
│                    └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

## Branch-to-Environment Mapping

The 63Klabs Atlantis MCP Server uses branch-based deployments:

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

### How a PROD deploy reaches callers

API Gateway invokes the Read Function through its `live` alias, and CodeDeploy moves that alias to each new version. A PROD deploy (`beta`, `stage`, `main`) therefore reaches API callers gradually instead of all at once. The `test` stage is not PROD and moves its alias at once.

- **Default shift:** about 30 minutes. The default `FunctionGradualDeploymentType` is `Linear10PercentEvery3Minutes`, which sends 10% more traffic to the new version every 3 minutes.
- **Urgent fix:** to deploy faster, set `FunctionGradualDeploymentType` to `AllAtOnce` in the stage's parameter configuration (the same place you set the other template parameters, see [Step 3](#step-3-configure-deployment-parameters)) and deploy through the normal flow. The setting applies to every deploy for as long as it is set, so change it back to the default afterwards. The template only reads this parameter when `DeployEnvironment` is `PROD`. In any other environment it uses `AllAtOnce` regardless of the parameter.
- **Two versions at once:** while a shift is in progress, the previous version and the new version both answer API requests, and consecutive requests from the same client can reach different versions.
- **Seeing which version answered:** use the CloudWatch `AWS/Lambda` `Invocations` metric with the `FunctionName` and `Resource` dimensions, where `Resource` is `<function-name>:live`. Log streams written through the alias are named `YYYY/MM/DD/[<version>]<32 hex characters>`, for example `2026/10/28/[47]02639d9680684eaaa10bef683581e9ba`, where `47` is the published version the `live` alias pointed to. Streams written before the alias integration are named `[$LATEST]` in the same position.
- **Deploy time:** a PROD stack update takes about 28 minutes, because CloudFormation waits for the whole CodeDeploy shift before it finishes the alias update. The pipeline's Deploy stage takes as long. Allow about 35 minutes from push to a finished pipeline (about 5 for Build, about 28 for Deploy, about 2 for PostDeploy). The `test` stage moves its alias at once and takes about a minute.
- **First deploy after the alias integration:** this one deploy was slower and was not protected by the shift. CloudFormation updates the alias first and waits for the shift to finish, and only then updates the REST API. Until then the API still called the unqualified function ARN, which was already running the new code, so callers were not shifted gradually. The API moved to the alias once the shift completed. Every later deploy is protected, because the API already calls the alias.
- **Rollback:** `ReadLambdaErrorsAlarm` is checked by CodeDeploy during the shift. When the alarm goes to `ALARM`, CodeDeploy stops the deployment within seconds (status `Stopped`, reason `ALARM_ACTIVE`) and runs its own rollback deployment. The stack ends in `UPDATE_ROLLBACK_COMPLETE` about 40 seconds after the alarm, the alias stays on the previous version, and the stack rollback deletes the candidate version. The alarm watches the function's `Errors` metric as a whole and is not scoped to a version, so errors from either version can trigger it. When the Deploy stage fails this way, the PostDeploy stage does not run.
- **Other functions:** the Auth Function and the other functions are not behind an alias and deploy at once. Only the Read Function's API traffic is shifted gradually.

To count invocations answered through the alias over the last hour:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=acme-mcp-server-prod-ReadFunction \
               Name=Resource,Value=acme-mcp-server-prod-ReadFunction:live \
  --start-time "$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --period 300 \
  --statistics Sum \
  --region us-east-1
```

#### Recovering after a rolled-back deploy

You cannot retry the pipeline's Deploy stage after a rollback. The retry fails immediately with `ChangeSet [pipeline-changeset] does not exist (ChangeSetNotFound)`, because the failed execution's change set was consumed by the deploy that rolled back. Start a new pipeline execution instead, or push a new commit:

```bash
# Start a new execution of the stage's pipeline from its current source revision
aws codepipeline start-pipeline-execution \
  --name <pipeline-name> \
  --region us-east-1
```

The new execution builds again, creates a new change set against the stack in `UPDATE_ROLLBACK_COMPLETE`, and deploys with a full shift. The deleted candidate version is not reused, so the next version number skips it.

#### Testing the rollback

To check that the rollback path works on a stage, force the alarm into `ALARM` while a shift is in progress:

```bash
# Find the alarm name of the stage's application stack
aws cloudformation describe-stack-resource \
  --stack-name <application-stack-name> \
  --logical-resource-id ReadLambdaErrorsAlarm \
  --query StackResourceDetail.PhysicalResourceId \
  --output text \
  --region us-east-1

# Force the alarm into ALARM during a shift
aws cloudwatch set-alarm-state \
  --alarm-name <alarm-name> \
  --state-value ALARM \
  --state-reason "Rollback test" \
  --region us-east-1
```

> **Warning**: This triggers a real rollback of the deploy in progress, and the alarm notification email is sent to the `AlarmNotificationEmail` recipient. Tell the recipient first, and do not do this on a stage whose deploy you need to keep. The alarm returns to `OK` on its next evaluation if no errors occurred. Recover with a new pipeline execution as described above.

For what developers must keep compatible between the two versions, see [Gradual deployment of the Read function](../../developer/gradual-deployment.md). For the parameter itself, see the [CloudFormation Parameters Reference](./cloudformation-parameters.md).

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
git clone https://github.com/63klabs/atlantis-mcp-phase-1.git
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
  --description "GitHub Personal Access Token for 63Klabs Atlantis MCP Server"
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

### Requests Return 429 (Rate Limit Exceeded)

**Solution**: The Read function enforces the limit. The public limit is the `MCP_PUBLIC_RATE_LIMIT` environment variable (default: 50 requests per 60 minutes per client address). It is not a CloudFormation parameter. See [Public rate limit](./cloudformation-parameters.md#public-rate-limit-mcp_public_rate_limit).

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
- [Agent Asset S3 Layout](./agent-asset-layout.md)
- [Multiple GitHub Org Configuration](./multiple-github-orgs.md)
- [Self-Hosting Guide](./self-hosting.md)

## Support

For issues or questions:
- GitHub Issues: [atlantis-mcp-server-phase-1/issues](https://github.com/63klabs/atlantis-mcp-phase-1/issues)
- Documentation: [README.md](../../README.md)
