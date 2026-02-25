# Deployment Testing Guide

## Overview

This guide provides step-by-step instructions for testing automated deployments to both TEST and PROD environments for the Atlantis MCP Server.

## Prerequisites

Before testing deployments, ensure:

1. **Pipeline Configured**: CodePipeline is deployed for both test and main branches
2. **SSM Parameters**: GitHub token and other secrets are stored in SSM
3. **S3 Buckets**: Artifacts bucket is configured and accessible
4. **IAM Roles**: CloudFormation service role has necessary permissions
5. **Repository Access**: You have push access to the repository

## Testing TEST Environment Deployment

### Step 1: Prepare Test Branch

```bash
# Ensure you're on the test branch
git checkout test

# Pull latest changes
git pull origin test

# Verify branch is clean
git status
```

### Step 2: Make a Test Change

Make a small, safe change to trigger deployment:

```bash
# Update a comment in the Lambda handler
echo "// Test deployment $(date)" >> application-infrastructure/src/lambda/read/index.js

# Commit the change
git add application-infrastructure/src/lambda/read/index.js
git commit -m "test: Trigger TEST deployment"
```

### Step 3: Push to Test Branch

```bash
# Push to trigger pipeline
git push origin test
```

### Step 4: Monitor Pipeline Execution

1. **Open CodePipeline Console**:
   ```
   https://console.aws.amazon.com/codesuite/codepipeline/pipelines
   ```

2. **Select Pipeline**: Click on `acme-atlantis-mcp-test-pipeline`

3. **Watch Stages**:
   - **Source**: Should complete within seconds
   - **Build**: Should complete within 5-10 minutes
   - **Deploy**: Should complete within 5-10 minutes

### Step 5: Monitor Build Logs

1. **Open CodeBuild Console**:
   ```
   https://console.aws.amazon.com/codesuite/codebuild/projects
   ```

2. **Select Build Project**: Click on the build project for test environment

3. **View Build Logs**:
   - Check test execution output
   - Verify all tests passed
   - Check code coverage report
   - Verify npm audit passed

### Step 6: Monitor CloudFormation Deployment

1. **Open CloudFormation Console**:
   ```
   https://console.aws.amazon.com/cloudformation/home
   ```

2. **Select Stack**: Click on `acme-atlantis-mcp-test-stack`

3. **Watch Events**:
   - Monitor stack update progress
   - Check for any errors
   - Verify resources are updated

### Step 7: Verify Deployment

After deployment completes:

```bash
# Get API endpoint from CloudFormation outputs
aws cloudformation describe-stacks \
  --stack-name acme-atlantis-mcp-test-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text

# Test the API endpoint
curl -X POST https://your-api-id.execute-api.us-east-1.amazonaws.com/api/mcp/list_categories \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Step 8: Check Lambda Function

1. **Open Lambda Console**:
   ```
   https://console.aws.amazon.com/lambda/home
   ```

2. **Select Function**: Click on `acme-atlantis-mcp-test-ReadFunction`

3. **Verify**:
   - Check function code is updated
   - Verify environment variables
   - Check function configuration
   - Review recent invocations

### Step 9: Review CloudWatch Logs

1. **Open CloudWatch Console**:
   ```
   https://console.aws.amazon.com/cloudwatch/home
   ```

2. **Navigate to Log Groups**:
   - `/aws/lambda/acme-atlantis-mcp-test-ReadFunction`
   - `/aws/apigateway/acme-atlantis-mcp-test-WebApi-access-logs`

3. **Check Logs**:
   - Verify Lambda cold start logs
   - Check for any errors
   - Verify log level is DEBUG or INFO

### Step 10: Test MCP Tools

Test each MCP tool to ensure functionality:

```bash
# Set API endpoint
API_ENDPOINT="https://your-api-id.execute-api.us-east-1.amazonaws.com/api/mcp"

# Test list_categories
curl -X POST "$API_ENDPOINT/list_categories" \
  -H "Content-Type: application/json" \
  -d '{}'

# Test list_templates
curl -X POST "$API_ENDPOINT/list_templates" \
  -H "Content-Type: application/json" \
  -d '{"category": "Storage"}'

# Test validate_naming
curl -X POST "$API_ENDPOINT/validate_naming" \
  -H "Content-Type: application/json" \
  -d '{"resourceName": "acme-myapp-test-MyFunction", "resourceType": "Lambda"}'
```

### Expected Results for TEST Deployment

- ✅ Pipeline completes successfully
- ✅ All tests pass
- ✅ Code coverage meets threshold
- ✅ CloudFormation stack updates successfully
- ✅ Lambda function is deployed
- ✅ API Gateway endpoints respond correctly
- ✅ CloudWatch logs show successful invocations
- ✅ No alarms triggered (alarms disabled in TEST)

## Testing PROD Environment Deployment

### Step 1: Prepare Main Branch

```bash
# Ensure test deployment succeeded first
# Then merge test to main

git checkout main
git pull origin main

# Merge test branch
git merge test

# Verify merge is clean
git status
```

### Step 2: Push to Main Branch

```bash
# Push to trigger production pipeline
git push origin main
```

### Step 3: Monitor Pipeline Execution

1. **Open CodePipeline Console**:
   ```
   https://console.aws.amazon.com/codesuite/codepipeline/pipelines
   ```

2. **Select Pipeline**: Click on `acme-atlantis-mcp-prod-pipeline`

3. **Watch Stages**:
   - **Source**: Should complete within seconds
   - **Build**: Should complete within 5-10 minutes
   - **ManualApproval**: Waits for approval (if configured)
   - **Deploy**: Should complete within 15-20 minutes (gradual deployment)

### Step 4: Review Build Artifacts

Before approving (if manual approval configured):

1. **Review Build Logs**:
   - Check all tests passed
   - Verify code coverage
   - Check npm audit results

2. **Review CloudFormation Changes**:
   - Check what resources will be updated
   - Verify no unexpected changes
   - Review parameter changes

3. **Review Deployment Plan**:
   - Verify gradual deployment configured
   - Check CloudWatch alarms are configured
   - Verify rollback plan

### Step 5: Approve Deployment (if required)

If manual approval is configured:

1. **Receive Approval Email**: Check email for approval notification

2. **Review Approval Request**:
   - Click link in email or navigate to CodePipeline
   - Review build results
   - Check deployment plan

3. **Approve Deployment**:
   ```bash
   # Via CLI
   aws codepipeline put-approval-result \
     --pipeline-name acme-atlantis-mcp-prod-pipeline \
     --stage-name ManualApproval \
     --action-name ApproveDeployment \
     --result status=Approved,summary="Reviewed and approved. All tests passed." \
     --token <token-from-notification>
   ```

   Or via Console:
   - Click "Review" button
   - Add approval comments
   - Click "Approve"

### Step 6: Monitor Gradual Deployment

1. **Watch CloudFormation Stack**:
   - Monitor stack update progress
   - Check for any errors
   - Verify gradual deployment is active

2. **Monitor Lambda Deployment**:
   - Open Lambda console
   - Check function versions
   - Monitor traffic shifting
   - Watch for automatic rollback

3. **Monitor CloudWatch Alarms**:
   - Check alarm status
   - Verify no alarms triggered
   - Monitor error rates

### Step 7: Verify Production Deployment

After deployment completes:

```bash
# Get production API endpoint
aws cloudformation describe-stacks \
  --stack-name acme-atlantis-mcp-prod-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text

# Test production endpoint
curl -X POST https://your-prod-api-id.execute-api.us-east-1.amazonaws.com/api/mcp/list_categories \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Step 8: Check Production Resources

1. **Lambda Function**:
   - Verify function is updated
   - Check alias points to new version
   - Verify environment variables

2. **API Gateway**:
   - Test all endpoints
   - Verify rate limiting
   - Check CORS configuration

3. **CloudWatch Dashboard**:
   - Open production dashboard
   - Verify metrics are reporting
   - Check for any anomalies

4. **CloudWatch Alarms**:
   - Verify alarms are configured
   - Check alarm thresholds
   - Test alarm notifications (optional)

### Step 9: Smoke Test Production

Run comprehensive smoke tests:

```bash
# Set production API endpoint
API_ENDPOINT="https://your-prod-api-id.execute-api.us-east-1.amazonaws.com/api/mcp"

# Test all MCP tools
echo "Testing list_categories..."
curl -X POST "$API_ENDPOINT/list_categories" -H "Content-Type: application/json" -d '{}'

echo "Testing list_templates..."
curl -X POST "$API_ENDPOINT/list_templates" -H "Content-Type: application/json" -d '{"category": "Storage"}'

echo "Testing get_template..."
curl -X POST "$API_ENDPOINT/get_template" -H "Content-Type: application/json" -d '{"templateName": "template-storage-s3-artifacts.yml", "category": "Storage"}'

echo "Testing list_starters..."
curl -X POST "$API_ENDPOINT/list_starters" -H "Content-Type: application/json" -d '{}'

echo "Testing validate_naming..."
curl -X POST "$API_ENDPOINT/validate_naming" -H "Content-Type: application/json" -d '{"resourceName": "acme-myapp-prod-MyFunction", "resourceType": "Lambda"}'

echo "Testing search_documentation..."
curl -X POST "$API_ENDPOINT/search_documentation" -H "Content-Type: application/json" -d '{"query": "CloudFormation"}'
```

### Step 10: Monitor Post-Deployment

Monitor for 30-60 minutes after deployment:

1. **CloudWatch Logs**:
   - Check for errors
   - Monitor invocation patterns
   - Verify log retention

2. **CloudWatch Metrics**:
   - Monitor invocation count
   - Check error rates
   - Monitor duration and memory usage

3. **CloudWatch Alarms**:
   - Verify no alarms triggered
   - Check alarm history

4. **API Gateway Metrics**:
   - Monitor request count
   - Check 4xx and 5xx errors
   - Verify latency

### Expected Results for PROD Deployment

- ✅ Pipeline completes successfully
- ✅ Manual approval received (if configured)
- ✅ Gradual deployment completes without rollback
- ✅ CloudFormation stack updates successfully
- ✅ Lambda function deployed with new version
- ✅ API Gateway endpoints respond correctly
- ✅ CloudWatch alarms configured and not triggered
- ✅ CloudWatch dashboard shows healthy metrics
- ✅ All smoke tests pass
- ✅ No errors in CloudWatch logs

## Troubleshooting Deployment Issues

### Build Failures

If build fails:

1. **Check Build Logs**:
   ```bash
   # Get latest build ID
   aws codebuild list-builds-for-project \
     --project-name acme-atlantis-mcp-test-build \
     --max-items 1
   
   # Get build logs
   aws codebuild batch-get-builds \
     --ids <build-id>
   ```

2. **Common Issues**:
   - Test failures: Fix failing tests
   - Coverage below threshold: Add more tests
   - npm audit failures: Update dependencies
   - Build timeout: Increase timeout or optimize build

### Deployment Failures

If deployment fails:

1. **Check CloudFormation Events**:
   ```bash
   aws cloudformation describe-stack-events \
     --stack-name acme-atlantis-mcp-test-stack \
     --max-items 20
   ```

2. **Common Issues**:
   - Parameter validation: Check parameter values
   - Resource limits: Check AWS service quotas
   - IAM permissions: Verify service role permissions
   - Resource conflicts: Check for naming conflicts

### Gradual Deployment Rollback

If gradual deployment rolls back:

1. **Check CloudWatch Alarms**:
   ```bash
   aws cloudwatch describe-alarm-history \
     --alarm-name acme-atlantis-mcp-prod-ReadLambdaErrorsAlarm \
     --max-records 10
   ```

2. **Check Lambda Errors**:
   - Review CloudWatch logs
   - Check error patterns
   - Verify configuration

3. **Rollback Actions**:
   - Fix the issue
   - Test in TEST environment
   - Redeploy to PROD

## Deployment Checklist

### Pre-Deployment

- [ ] All tests pass locally
- [ ] Code coverage meets threshold
- [ ] No high-severity vulnerabilities
- [ ] Changes reviewed and approved
- [ ] TEST deployment successful
- [ ] Smoke tests passed in TEST

### During Deployment

- [ ] Pipeline triggered successfully
- [ ] Build stage completes
- [ ] Tests pass in CI/CD
- [ ] Approval received (PROD only)
- [ ] CloudFormation update starts
- [ ] Gradual deployment progresses (PROD only)

### Post-Deployment

- [ ] API endpoints respond correctly
- [ ] Lambda function invokes successfully
- [ ] CloudWatch logs show no errors
- [ ] CloudWatch alarms not triggered (PROD only)
- [ ] Smoke tests pass
- [ ] Monitoring shows healthy metrics

## Rollback Procedures

### Automatic Rollback

Gradual deployment automatically rolls back if:
- CloudWatch alarms trigger
- Lambda errors exceed threshold
- Deployment fails

### Manual Rollback

If manual rollback needed:

```bash
# Cancel CloudFormation update
aws cloudformation cancel-update-stack \
  --stack-name acme-atlantis-mcp-prod-stack

# Or update to previous version
aws lambda update-alias \
  --function-name acme-atlantis-mcp-prod-ReadFunction \
  --name live \
  --function-version <previous-version>
```

## Continuous Monitoring

After successful deployment:

1. **Set up monitoring dashboard**
2. **Configure CloudWatch alarms**
3. **Enable X-Ray tracing**
4. **Review logs regularly**
5. **Monitor costs**

## Additional Resources

- [Pipeline Configuration Guide](pipeline-configuration.md)
- [Deployment Approval Guide](deployment-approval-guide.md)
- [SAM Deployment Guide](sam-deployment-guide.md)
- [Troubleshooting Guide](../../troubleshooting.md)
