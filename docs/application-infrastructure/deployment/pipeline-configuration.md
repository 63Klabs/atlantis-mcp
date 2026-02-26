# CodePipeline Configuration Guide

## Overview

The Atlantis MCP Server uses the Atlantis Platform's centralized pipeline templates for CI/CD. This document provides guidance on configuring CodePipeline for the test and main branches.

## Prerequisites

Before configuring the pipeline, ensure you have:

1. **Atlantis Platform Templates** deployed in your AWS account
2. **CloudFormation Service Role** with appropriate permissions
3. **S3 Artifacts Bucket** for build artifacts
4. **GitHub/CodeCommit Repository** configured
5. **SSM Parameters** for sensitive configuration

## Branch Configuration

### Test Branch (TEST Environment)

The test branch deploys to the TEST environment with the following characteristics:

- **Deployment Type**: AllAtOnce (immediate deployment)
- **Log Retention**: 7 days (configurable via `LogRetentionInDaysForDEVTEST`)
- **Alarms**: Disabled (to reduce costs)
- **Dashboard**: Disabled (to reduce costs)
- **Log Level**: DEBUG or INFO

#### Test Branch Pipeline Parameters

```yaml
# template-configuration-test.json
{
  "Parameters": {
    "Prefix": "acme",
    "ProjectId": "atlantis-mcp",
    "StageId": "test",
    "DeployEnvironment": "TEST",
    "LogLevel": "DEBUG",
    "FunctionGradualDeploymentType": "AllAtOnce",
    "LogRetentionInDaysForDEVTEST": 7,
    "AtlantisS3Buckets": "test-bucket-1,test-bucket-2",
    "AtlantisGitHubUserOrgs": "63Klabs",
    "PublicRateLimit": 100,
    "GitHubToken": "/atlantis-mcp/test/github/token"
  }
}
```

### Main Branch (PROD Environment)

The main branch deploys to the PROD environment with the following characteristics:

- **Deployment Type**: Gradual (Linear10PercentEvery3Minutes by default)
- **Log Retention**: 180 days (configurable via `LogRetentionInDaysForPROD`)
- **Alarms**: Enabled with SNS notifications
- **Dashboard**: Enabled for monitoring
- **Log Level**: INFO or WARN

#### Main Branch Pipeline Parameters

```yaml
# template-configuration-prod.json
{
  "Parameters": {
    "Prefix": "acme",
    "ProjectId": "atlantis-mcp",
    "StageId": "prod",
    "DeployEnvironment": "PROD",
    "LogLevel": "INFO",
    "FunctionGradualDeploymentType": "Linear10PercentEvery3Minutes",
    "LogRetentionInDaysForPROD": 180,
    "AlarmNotificationEmail": "alerts@example.com",
    "AtlantisS3Buckets": "prod-bucket-1,prod-bucket-2",
    "AtlantisGitHubUserOrgs": "63Klabs",
    "PublicRateLimit": 100,
    "GitHubToken": "/atlantis-mcp/prod/github/token"
  }
}
```

## Pipeline Configuration Steps

### Step 1: Create Template Configuration Files

Create separate template configuration files for each environment:

```bash
# In application-infrastructure directory
cp template-configuration.json template-configuration-test.json
cp template-configuration.json template-configuration-prod.json
```

Edit each file with environment-specific parameters as shown above.

### Step 2: Configure SSM Parameters

Store sensitive configuration in SSM Parameter Store:

```bash
# GitHub Token for TEST environment
aws ssm put-parameter \
  --name "/atlantis-mcp/test/github/token" \
  --value "ghp_your_test_token_here" \
  --type "SecureString" \
  --description "GitHub token for Atlantis MCP Server TEST environment"

# GitHub Token for PROD environment
aws ssm put-parameter \
  --name "/atlantis-mcp/prod/github/token" \
  --value "ghp_your_prod_token_here" \
  --type "SecureString" \
  --description "GitHub token for Atlantis MCP Server PROD environment"
```

### Step 3: Deploy Pipeline Using Atlantis Scripts

Use the Atlantis Configuration Repository scripts to deploy the pipeline:

```bash
# Clone the Atlantis Configuration Repository
git clone https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments.git

# Navigate to the scripts directory
cd atlantis-cfn-configuration-repo-for-serverless-deployments

# Deploy TEST pipeline
python3 config.py \
  --prefix acme \
  --project-id atlantis-mcp \
  --stage-id test \
  --branch test \
  --repository-name atlantis-mcp-server \
  --template-bucket your-template-bucket \
  --artifacts-bucket your-artifacts-bucket

# Deploy PROD pipeline
python3 config.py \
  --prefix acme \
  --project-id atlantis-mcp \
  --stage-id prod \
  --branch main \
  --repository-name atlantis-mcp-server \
  --template-bucket your-template-bucket \
  --artifacts-bucket your-artifacts-bucket
```

### Step 4: Verify Pipeline Configuration

After deployment, verify the pipeline configuration:

1. **Check CodePipeline Console**:
   - Navigate to AWS CodePipeline console
   - Verify pipelines exist for test and main branches
   - Check pipeline stages: Source → Build → Deploy

2. **Check CodeBuild Project**:
   - Navigate to AWS CodeBuild console
   - Verify build project exists
   - Check environment variables are set correctly

3. **Check CloudFormation Stack**:
   - Navigate to AWS CloudFormation console
   - Verify application stack exists
   - Check stack parameters match configuration

## Testing the Pipeline

### Test Branch Deployment

1. **Push to test branch**:
   ```bash
   git checkout test
   git push origin test
   ```

2. **Monitor pipeline execution**:
   - Watch CodePipeline console for progress
   - Check CodeBuild logs for test execution
   - Verify CloudFormation stack updates

3. **Verify deployment**:
   - Check Lambda function is deployed
   - Test API Gateway endpoint
   - Review CloudWatch logs

### Main Branch Deployment

1. **Merge to main branch**:
   ```bash
   git checkout main
   git merge test
   git push origin main
   ```

2. **Monitor gradual deployment**:
   - Watch CodeDeploy for gradual rollout
   - Monitor CloudWatch alarms
   - Check Lambda function versions

3. **Verify production deployment**:
   - Test API Gateway endpoint
   - Verify CloudWatch dashboard
   - Check alarm configuration

## Troubleshooting

### Build Failures

If the build fails, check:

1. **Test failures**: Review CodeBuild logs for test output
2. **Coverage thresholds**: Check if coverage meets minimum requirements
3. **Dependency issues**: Verify npm audit passes
4. **Permission issues**: Check IAM roles have necessary permissions

### Deployment Failures

If deployment fails, check:

1. **CloudFormation errors**: Review CloudFormation events
2. **Parameter validation**: Verify all required parameters are provided
3. **Resource limits**: Check AWS service quotas
4. **IAM permissions**: Verify CloudFormation service role has permissions

### Gradual Deployment Rollback

If gradual deployment triggers a rollback:

1. **Check CloudWatch alarms**: Review alarm history
2. **Review Lambda errors**: Check CloudWatch logs for errors
3. **Verify API Gateway**: Test endpoints manually
4. **Check deployment configuration**: Verify deployment preferences

## Pipeline Maintenance

### Updating Pipeline Configuration

To update pipeline configuration:

1. Update template-configuration files
2. Commit changes to repository
3. Pipeline will automatically use new configuration on next deployment

### Modifying Build Process

To modify the build process:

1. Update `buildspec.yml` in repository
2. Commit changes
3. Next build will use updated buildspec

### Changing Deployment Strategy

To change deployment strategy:

1. Update `FunctionGradualDeploymentType` parameter
2. Update template-configuration file
3. Deploy stack update

## Security Considerations

### Secrets Management

- **Never commit secrets** to repository
- Store all secrets in SSM Parameter Store or Secrets Manager
- Use IAM roles for AWS service access
- Rotate credentials regularly

### IAM Permissions

- Follow principle of least privilege
- Use resource-scoped permissions
- Avoid wildcard permissions
- Review IAM policies regularly

### Network Security

- Use VPC endpoints for AWS services (if in VPC)
- Enable API Gateway logging
- Use CloudWatch Logs encryption
- Enable X-Ray tracing for debugging

## Monitoring and Alerting

### CloudWatch Alarms (PROD only)

The following alarms are configured for production:

1. **Lambda Errors**: Triggers when Lambda function errors > 1
2. **API Gateway Errors**: Triggers when API Gateway errors > 1

### CloudWatch Dashboard (PROD only)

The production dashboard includes:

- Lambda invocation metrics
- API Gateway request metrics
- Error rates and latency
- Cache hit/miss rates

### Log Retention

- **TEST**: 7 days (configurable)
- **PROD**: 180 days (configurable)

## Cost Optimization

### TEST Environment

- Disable alarms to reduce costs
- Disable dashboard to reduce costs
- Use shorter log retention
- Use AllAtOnce deployment

### PROD Environment

- Enable alarms for critical monitoring
- Enable dashboard for visibility
- Use longer log retention for compliance
- Use gradual deployment for safety

## Additional Resources

- [Atlantis Template Repository](https://github.com/63Klabs/atlantis-cfn-template-repo-for-serverless-deployments)
- [Atlantis Configuration Repository](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)
- [SAM Deployment Guide](sam-deployment-guide.md)
- [Quick Start Guide](quick-start-sam.md)
