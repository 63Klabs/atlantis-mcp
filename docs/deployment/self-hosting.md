# Self-Hosting Guide for Atlantis MCP Server

## Overview

This comprehensive guide walks you through deploying and managing your own instance of the Atlantis MCP Server. Self-hosting gives you complete control over your MCP server deployment, allowing you to customize configurations, integrate with your organization's infrastructure, and maintain data sovereignty.

## Why Self-Host?

Self-hosting the Atlantis MCP Server provides several benefits:

1. **Data Sovereignty**: Keep all data within your AWS account
2. **Custom Configuration**: Configure S3 buckets, GitHub orgs, and rate limits for your needs
3. **Private Templates**: Use private CloudFormation templates and app starters
4. **Cost Control**: Pay only for AWS resources you use
5. **Compliance**: Meet regulatory requirements for data residency
6. **Customization**: Modify and extend the MCP server for your organization
7. **Integration**: Integrate with existing AWS infrastructure and CI/CD pipelines

## Prerequisites

Before self-hosting, ensure you have:

### AWS Requirements

- **AWS Account** with administrative access
- **AWS CLI** configured with credentials
- **IAM Permissions** to create:
  - Lambda functions
  - API Gateway
  - DynamoDB tables
  - S3 buckets
  - IAM roles and policies
  - CloudWatch Logs
  - SSM Parameter Store parameters

### Development Tools

- **Git** installed
- **Python 3.9+** installed
- **Node.js 20.x+** installed (for local testing)
- **AWS SAM CLI** installed (optional, for local testing)

### GitHub Requirements

- **GitHub Account** with access to repositories
- **GitHub Personal Access Token** with appropriate scopes
- **GitHub Custom Properties** configured on repositories (for organizations)

### Infrastructure Requirements

- **S3 Buckets** for templates and app starters
- **GitHub Organizations/Users** with repositories
- **Domain Name** (optional, for custom API endpoint)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Your AWS Account                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Atlantis MCP Server Stack                 │ │
│  │                                                        │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│ │
│  │  │ API Gateway  │→ │Read Lambda   │→ │  DynamoDB    ││ │
│  │  │(Rate Limit)  │  │(Node.js 24.x)│  │(Cache Table) ││ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘│ │
│  │                           │                            │ │
│  │                           ▼                            │ │
│  │                    ┌──────────────┐                   │ │
│  │                    │  S3 Cache    │                   │ │
│  │                    │   Bucket     │                   │ │
│  │                    └──────────────┘                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           Your S3 Buckets (Templates & Starters)       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐│ │
│  │  │   Bucket 1   │  │   Bucket 2   │  │   Bucket 3   ││ │
│  │  │  (atlantis)  │  │  (finance)   │  │  (devops)    ││ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘│ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   GitHub     │
                    │Organizations │
                    └──────────────┘
```

## Step-by-Step Deployment

### Step 1: Prepare Your Environment

#### 1.1 Clone Repositories

Clone the required repositories:

```bash
# Clone MCP Server repository
git clone https://github.com/63klabs/atlantis-mcp-server-phase-1.git
cd atlantis-mcp-server-phase-1

# Clone SAM Configuration repository
cd ..
git clone https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments.git
```

#### 1.2 Install Dependencies

```bash
# Install Python dependencies for deployment scripts
cd atlantis-cfn-configuration-repo-for-serverless-deployments
pip install -r requirements.txt

# Install Node.js dependencies for MCP server
cd ../atlantis-mcp-server-phase-1/application-infrastructure/src/lambda/read
npm install
```

### Step 2: Configure S3 Buckets

#### 2.1 Create S3 Buckets

Create S3 buckets for templates and app starters:

```bash
# Create organization templates bucket
aws s3 mb s3://acme-atlantis-templates-us-east-1 --region us-east-1

# Create department-specific buckets (optional)
aws s3 mb s3://acme-finance-templates-us-east-1 --region us-east-1
aws s3 mb s3://acme-devops-templates-us-east-1 --region us-east-1
```

#### 2.2 Enable Versioning

Enable versioning on template buckets:

```bash
aws s3api put-bucket-versioning \
  --bucket acme-atlantis-templates-us-east-1 \
  --versioning-configuration Status=Enabled
```

#### 2.3 Configure Bucket Tags

Set required tags on each bucket:

```bash
aws s3api put-bucket-tagging \
  --bucket acme-atlantis-templates-us-east-1 \
  --tagging 'TagSet=[
    {Key=atlantis-mcp:Allow,Value=true},
    {Key=atlantis-mcp:IndexPriority,Value="atlantis,finance,devops"}
  ]'
```

See [S3 Bucket Tagging](./s3-bucket-tagging.md) for detailed instructions.

#### 2.4 Upload Templates and Starters

Upload your CloudFormation templates and app starters:

```bash
# Upload templates
aws s3 cp templates/v2/ s3://acme-atlantis-templates-us-east-1/atlantis/templates/v2/ --recursive

# Upload app starters
aws s3 cp app-starters/v2/ s3://acme-atlantis-templates-us-east-1/atlantis/app-starters/v2/ --recursive
```

### Step 3: Configure GitHub

#### 3.1 Create GitHub Personal Access Token

Create a GitHub PAT with required scopes:

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Click "Generate new token (classic)"
3. Select scopes:
   - `repo` (for private repositories)
   - `read:org` (for organization repositories)
   - `read:user` (for user repositories)
4. Generate and save the token

See [GitHub Token Setup](./github-token-setup.md) for detailed instructions.

#### 3.2 Store Token in SSM Parameter Store

Store the GitHub token securely:

```bash
aws ssm put-parameter \
  --name "/atlantis/mcp/github-token" \
  --value "ghp_your_token_here" \
  --type "SecureString" \
  --description "GitHub Personal Access Token for Atlantis MCP Server" \
  --region us-east-1
```

#### 3.3 Configure GitHub Custom Properties

Set up custom properties on your repositories:

```bash
# Using GitHub CLI
gh api repos/acme-org/atlantis-starter-express/properties/values \
  -X PATCH \
  -f properties[][property_name]=atlantis_repository-type \
  -f properties[][value]=app-starter
```

See [GitHub Custom Properties Setup](./github-custom-properties.md) for detailed instructions.

### Step 4: Configure Deployment Parameters

#### 4.1 Create Configuration File

Create a configuration file for your deployment:

```bash
cd atlantis-cfn-configuration-repo-for-serverless-deployments
cp config-template.json config-mcp-server-prod.json
```

#### 4.2 Edit Configuration

Edit `config-mcp-server-prod.json`:

```json
{
  "StackName": "acme-mcp-server-prod",
  "Parameters": {
    "Prefix": "acme",
    "ProjectId": "mcp-server",
    "StageId": "prod",
    "AtlantisS3Buckets": "acme-atlantis-templates-us-east-1,acme-finance-templates-us-east-1",
    "AtlantisGitHubUserOrgs": "acme-org,63klabs",
    "PublicRateLimit": "100",
    "GitHubTokenParameter": "/atlantis/mcp/github-token",
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
    "Environment": "prod",
    "Project": "atlantis-mcp-server",
    "ManagedBy": "CloudFormation",
    "Organization": "acme"
  }
}
```

See [CloudFormation Parameters Reference](./cloudformation-parameters.md) for parameter descriptions.

### Step 5: Deploy the MCP Server

#### 5.1 Run Configuration Script

```bash
python config.py \
  --config config-mcp-server-prod.json \
  --template ../atlantis-mcp-server-phase-1/template.yml \
  --output samconfig-mcp-server-prod.toml
```

#### 5.2 Deploy to AWS

```bash
python deploy.py \
  --config samconfig-mcp-server-prod.toml \
  --region us-east-1
```

#### 5.3 Monitor Deployment

Monitor the deployment progress:

```bash
aws cloudformation describe-stack-events \
  --stack-name acme-mcp-server-prod \
  --region us-east-1 \
  --query 'StackEvents[?ResourceStatus==`CREATE_IN_PROGRESS`].[Timestamp,ResourceType,ResourceStatus]' \
  --output table
```

### Step 6: Verify Deployment

#### 6.1 Get API Endpoint

```bash
aws cloudformation describe-stacks \
  --stack-name acme-mcp-server-prod \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text
```

#### 6.2 Test MCP Server

Test the MCP server:

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

#### 6.3 Test Template Discovery

```bash
curl -X POST https://your-api-endpoint/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "list_templates",
      "arguments": {}
    }
  }'
```

### Step 7: Configure CI/CD Pipeline (Optional)

#### 7.1 Create Pipeline Stack

Deploy a CI/CD pipeline for automated deployments:

```bash
aws cloudformation create-stack \
  --stack-name acme-mcp-server-pipeline \
  --template-url https://s3.amazonaws.com/atlantis-templates/v2/pipeline/template-pipeline-github.yml \
  --parameters \
    ParameterKey=Prefix,ParameterValue=acme \
    ParameterKey=ProjectId,ParameterValue=mcp-server \
    ParameterKey=GitHubRepo,ParameterValue=atlantis-mcp-server-phase-1 \
    ParameterKey=GitHubOwner,ParameterValue=acme-org \
    ParameterKey=GitHubBranch,ParameterValue=main \
  --capabilities CAPABILITY_IAM \
  --region us-east-1
```

#### 7.2 Connect GitHub Repository

Follow AWS Console instructions to connect your GitHub repository to CodePipeline.

### Step 8: Configure Monitoring

#### 8.1 Create CloudWatch Dashboard

Create a dashboard for monitoring:

```bash
aws cloudwatch put-dashboard \
  --dashboard-name acme-mcp-server-prod \
  --dashboard-body file://dashboard-config.json
```

#### 8.2 Set Up Alarms

Create CloudWatch alarms for error rates and latency:

```bash
# Error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name acme-mcp-server-prod-error-rate \
  --alarm-description "Alert when error rate exceeds 5%" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=acme-mcp-server-prod-ReadFunction

# Latency alarm
aws cloudwatch put-metric-alarm \
  --alarm-name acme-mcp-server-prod-latency \
  --alarm-description "Alert when latency exceeds 3 seconds" \
  --metric-name Duration \
  --namespace AWS/Lambda \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 3000 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=acme-mcp-server-prod-ReadFunction
```

## Configuration Management

### Environment-Specific Configurations

Maintain separate configurations for each environment:

```
config-mcp-server-test.json    # Test environment
config-mcp-server-beta.json    # Beta environment
config-mcp-server-prod.json    # Production environment
```

### Configuration Best Practices

1. **Use descriptive names**: Include organization, project, and environment in names
2. **Version control**: Store configuration files in version control
3. **Separate secrets**: Never commit secrets to version control
4. **Document parameters**: Maintain documentation of parameter purposes
5. **Review regularly**: Review configurations quarterly

## Maintenance and Operations

### Regular Maintenance Tasks

#### Weekly

- Review CloudWatch Logs for errors and warnings
- Monitor API Gateway request metrics
- Check cache hit/miss ratios

#### Monthly

- Review and rotate GitHub tokens
- Update Lambda function code if new versions available
- Review S3 bucket contents and clean up old versions
- Review CloudWatch alarm history

#### Quarterly

- Review IAM permissions and apply least privilege
- Update CloudFormation template parameters
- Review and update documentation
- Conduct security audit

### Updating the MCP Server

To update your MCP server deployment:

```bash
# Pull latest changes
cd atlantis-mcp-server-phase-1
git pull origin main

# Redeploy
cd ../atlantis-cfn-configuration-repo-for-serverless-deployments
python config.py --config config-mcp-server-prod.json --template ../atlantis-mcp-server-phase-1/template.yml --output samconfig-mcp-server-prod.toml
python deploy.py --config samconfig-mcp-server-prod.toml --region us-east-1
```

### Backup and Disaster Recovery

#### DynamoDB Cache Table

Enable point-in-time recovery:

```bash
aws dynamodb update-continuous-backups \
  --table-name acme-mcp-server-prod-CacheTable \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
```

#### S3 Cache Bucket

Enable versioning and lifecycle policies:

```bash
aws s3api put-bucket-versioning \
  --bucket acme-mcp-server-prod-cache \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-lifecycle-configuration \
  --bucket acme-mcp-server-prod-cache \
  --lifecycle-configuration file://lifecycle-policy.json
```

## Security Considerations

### IAM Permissions

Follow least privilege principles:

1. **Lambda execution role**: Only grant permissions for required S3 buckets and DynamoDB tables
2. **API Gateway**: Use resource policies to restrict access if needed
3. **SSM Parameter Store**: Restrict access to GitHub token parameter
4. **CloudWatch Logs**: Ensure logs don't contain sensitive information

### Network Security

Consider these security enhancements:

1. **VPC Integration**: Deploy Lambda in VPC for private network access
2. **VPC Endpoints**: Use VPC endpoints for S3 and DynamoDB access
3. **API Gateway**: Configure custom domain with TLS certificate
4. **WAF**: Add AWS WAF for additional protection

### Data Security

1. **Encryption at rest**: Enable encryption for DynamoDB and S3
2. **Encryption in transit**: Use HTTPS for all API calls
3. **Token rotation**: Rotate GitHub tokens regularly
4. **Audit logging**: Enable CloudTrail for API audit logs

## Cost Optimization

### Estimated Monthly Costs

For a typical deployment with moderate usage:

| Service | Usage | Estimated Cost |
|---------|-------|----------------|
| Lambda | 1M requests, 512MB, 3s avg | $20 |
| API Gateway | 1M requests | $3.50 |
| DynamoDB | 5GB storage, on-demand | $1.25 |
| S3 | 10GB storage, 1M requests | $0.50 |
| CloudWatch Logs | 5GB logs | $2.50 |
| **Total** | | **~$28/month** |

### Cost Optimization Tips

1. **Adjust cache TTLs**: Longer TTLs reduce Lambda invocations
2. **Use provisioned concurrency**: For consistent performance (increases cost)
3. **Enable S3 Intelligent-Tiering**: Automatically move infrequently accessed objects to cheaper storage
4. **Set log retention**: Reduce CloudWatch Logs retention period
5. **Monitor usage**: Set up billing alarms for unexpected costs

## Troubleshooting

### Common Issues

See [Deployment Guide - Troubleshooting](./README.md#troubleshooting) for common deployment issues.

### Getting Help

- **GitHub Issues**: [atlantis-mcp-server-phase-1/issues](https://github.com/63klabs/atlantis-mcp-server-phase-1/issues)
- **Documentation**: [README.md](../../README.md)
- **Community**: Join discussions in GitHub Discussions

## Advanced Topics

### Custom Domain Configuration

Configure a custom domain for your API:

```bash
# Create certificate in ACM
aws acm request-certificate \
  --domain-name mcp.acme.com \
  --validation-method DNS \
  --region us-east-1

# Create custom domain in API Gateway
aws apigateway create-domain-name \
  --domain-name mcp.acme.com \
  --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/abc123

# Create Route53 record
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890ABC \
  --change-batch file://route53-change.json
```

### Multi-Region Deployment

Deploy to multiple regions for high availability:

```bash
# Deploy to us-east-1
python deploy.py --config samconfig-mcp-server-prod-us-east-1.toml --region us-east-1

# Deploy to eu-west-1
python deploy.py --config samconfig-mcp-server-prod-eu-west-1.toml --region eu-west-1

# Configure Route53 for global load balancing
```

### Integration with Existing Infrastructure

Integrate with existing AWS infrastructure:

1. **VPC Integration**: Deploy Lambda in existing VPC
2. **Shared DynamoDB**: Use existing DynamoDB tables
3. **Centralized Logging**: Forward logs to centralized logging solution
4. **SSO Integration**: Integrate with AWS SSO for authentication

## Next Steps

- [Deployment Guide](./README.md)
- [CloudFormation Parameters Reference](./cloudformation-parameters.md)
- [Multiple S3 Bucket Configuration](./multiple-s3-buckets.md)
- [Multiple GitHub Org Configuration](./multiple-github-orgs.md)
- [GitHub Token Setup](./github-token-setup.md)
- [S3 Bucket Tagging](./s3-bucket-tagging.md)

## Support

For issues or questions:
- GitHub Issues: [atlantis-mcp-server-phase-1/issues](https://github.com/63klabs/atlantis-mcp-server-phase-1/issues)
- Documentation: [README.md](../../README.md)
