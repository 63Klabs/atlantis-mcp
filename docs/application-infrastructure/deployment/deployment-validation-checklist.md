# Deployment Validation Checklist

This checklist guides you through validating deployments to TEST and PROD environments for the Atlantis MCP Server Phase 1.

## Overview

Task 16.4 from the implementation spec requires comprehensive deployment validation across both TEST and PROD environments. This document provides step-by-step instructions for completing all subtasks.

## Prerequisites

Before starting validation:

- [ ] All code is committed and pushed to appropriate branch
- [ ] All unit tests pass locally (`npm test`)
- [ ] All integration tests pass locally
- [ ] Code coverage meets 80% minimum
- [ ] ESLint passes with no errors
- [ ] Documentation is complete and accurate

## Task 16.4.1: Deploy to Test Environment

### Manual Deployment Steps

1. **Verify test branch is ready**:
   ```bash
   git checkout test
   git pull origin test
   git status  # Should be clean
   ```

2. **Deploy using SAM** (if not using CI/CD):
   ```bash
   cd application-infrastructure
   sam build --config-file samconfig-test.toml
   sam deploy --config-file samconfig-test.toml
   ```

3. **Or trigger CI/CD pipeline**:
   ```bash
   # Make a small change to trigger pipeline
   echo "# Deployment validation $(date)" >> README.md
   git add README.md
   git commit -m "test: Trigger TEST deployment for validation"
   git push origin test
   ```

4. **Monitor deployment**:
   - Open CodePipeline console
   - Watch pipeline stages (Source → Build → Deploy)
   - Monitor CloudFormation stack update
   - Check CloudWatch logs for errors

5. **Verify deployment completed**:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name acme-atlantis-mcp-test-stack \
     --query 'Stacks[0].StackStatus' \
     --output text
   ```
   
   Expected: `CREATE_COMPLETE` or `UPDATE_COMPLETE`

**Validation**: ✅ CloudFormation stack is in good state

---

## Task 16.4.2: Verify All MCP Tools Work in Test

### Automated Validation

Run the validation script:
```bash
cd application-infrastructure
./validate-deployment.sh test
```

### Manual Validation

Get the API endpoint:
```bash
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name acme-atlantis-mcp-test-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

echo "API Endpoint: $API_ENDPOINT"
```

Test each MCP tool:

#### 1. list_categories
```bash
curl -X POST "${API_ENDPOINT}/list_categories" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: JSON response with `categories` array

#### 2. list_templates
```bash
curl -X POST "${API_ENDPOINT}/list_templates" \
  -H "Content-Type: application/json" \
  -d '{"category": "Storage"}'
```

Expected: JSON response with `templates` array

#### 3. get_template
```bash
curl -X POST "${API_ENDPOINT}/get_template" \
  -H "Content-Type: application/json" \
  -d '{"templateName": "template-storage-s3-artifacts.yml", "category": "Storage"}'
```

Expected: JSON response with `template` object

#### 4. list_template_versions
```bash
curl -X POST "${API_ENDPOINT}/list_template_versions" \
  -H "Content-Type: application/json" \
  -d '{"templateName": "template-storage-s3-artifacts.yml", "category": "Storage"}'
```

Expected: JSON response with `versions` array

#### 5. list_starters
```bash
curl -X POST "${API_ENDPOINT}/list_starters" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: JSON response with `starters` array

#### 6. get_starter_info
```bash
curl -X POST "${API_ENDPOINT}/get_starter_info" \
  -H "Content-Type: application/json" \
  -d '{"starterName": "atlantis-starter-02"}'
```

Expected: JSON response with `starter` object

#### 7. search_documentation
```bash
curl -X POST "${API_ENDPOINT}/search_documentation" \
  -H "Content-Type: application/json" \
  -d '{"query": "CloudFormation"}'
```

Expected: JSON response with `results` array

#### 8. validate_naming
```bash
curl -X POST "${API_ENDPOINT}/validate_naming" \
  -H "Content-Type: application/json" \
  -d '{"resourceName": "acme-myapp-test-MyFunction", "resourceType": "Lambda"}'
```

Expected: JSON response with `valid` boolean

#### 9. check_template_updates
```bash
curl -X POST "${API_ENDPOINT}/check_template_updates" \
  -H "Content-Type: application/json" \
  -d '{"templateName": "template-storage-s3-artifacts.yml", "category": "Storage", "currentVersion": "v1.0.0"}'
```

Expected: JSON response with `updates` object

**Validation**: ✅ All 9 MCP tools respond correctly

---

## Task 16.4.3: Verify Rate Limiting Works in Test

### Test Rate Limiting

Make rapid requests to trigger rate limit:

```bash
# Make 20 rapid requests
for i in {1..20}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${API_ENDPOINT}/list_categories" \
    -H "Content-Type: application/json" \
    -d '{}')
  
  echo "Request $i: HTTP $HTTP_CODE"
  
  if [[ "$HTTP_CODE" == "429" ]]; then
    echo "✅ Rate limiting triggered on request $i"
    break
  fi
  
  sleep 0.1
done
```

### Verify Rate Limit Headers

Check that rate limit headers are present:

```bash
curl -v -X POST "${API_ENDPOINT}/list_categories" \
  -H "Content-Type: application/json" \
  -d '{}' 2>&1 | grep -i "x-ratelimit"
```

Expected headers:
- `X-RateLimit-Limit: 100`
- `X-RateLimit-Remaining: 99`
- `X-RateLimit-Reset: <timestamp>`

### Verify 429 Response Format

When rate limited:

```bash
curl -X POST "${API_ENDPOINT}/list_categories" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response when rate limited:
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please try again later.",
  "retryAfter": 3600
}
```

**Validation**: ✅ Rate limiting enforces 100 requests/hour per IP

---

## Task 16.4.4: Verify Caching Works in Test

### Test Cache Hit/Miss

```bash
# First request (cache miss)
echo "Making first request (cache miss)..."
time curl -X POST "${API_ENDPOINT}/list_categories" \
  -H "Content-Type: application/json" \
  -d '{}' > /tmp/response1.json

# Second request (cache hit)
echo "Making second request (cache hit)..."
time curl -X POST "${API_ENDPOINT}/list_categories" \
  -H "Content-Type: application/json" \
  -d '{}' > /tmp/response2.json

# Compare responses
diff /tmp/response1.json /tmp/response2.json
```

Expected:
- Responses are identical
- Second request is faster than first

### Check Cache Metrics

View cache performance in CloudWatch:

```bash
# Get cache hit/miss metrics
aws cloudwatch get-metric-statistics \
  --namespace "AtlantisMCP" \
  --metric-name "CacheHitRate" \
  --dimensions Name=Environment,Value=test \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
  --period 3600 \
  --statistics Average
```

### Verify Cache Expiration

Wait for TTL to expire (default 30 minutes for list operations), then test again:

```bash
# Wait for cache expiration
echo "Waiting for cache to expire (30 minutes)..."
sleep 1800

# Request should be cache miss again
curl -X POST "${API_ENDPOINT}/list_categories" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Validation**: ✅ Caching works with proper TTL

---

## Task 16.4.5: Verify Brown-Out Support Works in Test

### Test Partial Data Return

Test with mixed valid/invalid sources:

```bash
# Test with invalid bucket (should still return partial data)
curl -X POST "${API_ENDPOINT}/list_templates" \
  -H "Content-Type: application/json" \
  -d '{
    "s3Buckets": ["valid-bucket", "nonexistent-bucket"]
  }'
```

Expected response:
```json
{
  "templates": [...],
  "errors": [
    {
      "source": "nonexistent-bucket",
      "sourceType": "s3",
      "error": "Bucket access not allowed",
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ],
  "partialData": true
}
```

### Test GitHub Org Failure

```bash
# Test with invalid GitHub org
curl -X POST "${API_ENDPOINT}/list_starters" \
  -H "Content-Type: application/json" \
  -d '{
    "ghusers": ["63Klabs", "nonexistent-org"]
  }'
```

Expected: Partial data with error information

### Check CloudWatch Logs

Verify warnings are logged:

```bash
aws logs filter-log-events \
  --log-group-name "/aws/lambda/acme-atlantis-mcp-test-ReadFunction" \
  --filter-pattern "WARN" \
  --start-time $(($(date +%s) - 3600))000 \
  --limit 10
```

Expected: Warning logs for failed sources

**Validation**: ✅ Brown-out support returns partial data when sources fail

---

## Task 16.4.6: Deploy to Prod Environment

### Pre-Deployment Checklist

Before deploying to production:

- [ ] All TEST validations passed
- [ ] Code review completed and approved
- [ ] Security review completed
- [ ] Performance testing completed
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Deployment plan reviewed

### Deployment Steps

1. **Merge test to main**:
   ```bash
   git checkout main
   git pull origin main
   git merge test
   git push origin main
   ```

2. **Monitor pipeline**:
   - Open CodePipeline console
   - Watch `acme-atlantis-mcp-prod-pipeline`
   - Wait for manual approval stage (if configured)

3. **Review deployment plan**:
   - Check CloudFormation change set
   - Verify gradual deployment configuration
   - Review alarm configuration

4. **Approve deployment** (if manual approval required):
   ```bash
   aws codepipeline put-approval-result \
     --pipeline-name acme-atlantis-mcp-prod-pipeline \
     --stage-name ManualApproval \
     --action-name ApproveDeployment \
     --result status=Approved,summary="All validations passed" \
     --token <token-from-notification>
   ```

5. **Monitor gradual deployment**:
   - Watch Lambda traffic shifting (Linear10PercentEvery3Minutes)
   - Monitor CloudWatch alarms
   - Check for automatic rollback

6. **Verify deployment completed**:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name acme-atlantis-mcp-prod-stack \
     --query 'Stacks[0].StackStatus' \
     --output text
   ```

**Validation**: ✅ Production deployment completed successfully

---

## Task 16.4.7: Verify All MCP Tools Work in Prod

### Automated Validation

Run the validation script for production:
```bash
cd application-infrastructure
./validate-deployment.sh prod
```

### Manual Smoke Tests

Get production API endpoint:
```bash
PROD_API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name acme-atlantis-mcp-prod-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

echo "Production API Endpoint: $PROD_API_ENDPOINT"
```

Run smoke tests for all 9 MCP tools (same as Task 16.4.2 but with production endpoint).

### Verify Production Configuration

Check production-specific settings:

```bash
# Check Lambda configuration
aws lambda get-function-configuration \
  --function-name acme-atlantis-mcp-prod-ReadFunction \
  --query '{Memory: MemorySize, Timeout: Timeout, LogLevel: Environment.Variables.LOG_LEVEL}'
```

Expected:
- Memory: 1024 MB (or configured value)
- Timeout: 30 seconds
- LogLevel: INFO

**Validation**: ✅ All MCP tools work in production

---

## Task 16.4.8: Verify Monitoring and Alarms Work in Prod

### Check CloudWatch Dashboard

1. **Open CloudWatch Console**:
   ```
   https://console.aws.amazon.com/cloudwatch/home
   ```

2. **Navigate to Dashboards**:
   - Find `acme-atlantis-mcp-prod-dashboard`
   - Verify all widgets display data

3. **Verify Dashboard Widgets**:
   - Lambda invocations
   - Lambda errors
   - Lambda duration
   - API Gateway requests
   - API Gateway 4xx errors
   - API Gateway 5xx errors
   - DynamoDB cache metrics
   - S3 cache metrics

### Check CloudWatch Alarms

List all alarms:
```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix "acme-atlantis-mcp-prod" \
  --query 'MetricAlarms[].[AlarmName, StateValue]' \
  --output table
```

Expected alarms:
- `acme-atlantis-mcp-prod-ReadLambdaErrorsAlarm` - OK
- `acme-atlantis-mcp-prod-ReadLambdaThrottlesAlarm` - OK
- `acme-atlantis-mcp-prod-ReadLambdaDurationAlarm` - OK
- `acme-atlantis-mcp-prod-ApiGateway5xxAlarm` - OK
- `acme-atlantis-mcp-prod-ApiGateway4xxAlarm` - OK

### Test Alarm Notifications

Verify SNS topic is configured:
```bash
aws cloudformation describe-stacks \
  --stack-name acme-atlantis-mcp-prod-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`AlarmTopicArn`].OutputValue' \
  --output text
```

Check SNS subscriptions:
```bash
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name acme-atlantis-mcp-prod-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`AlarmTopicArn`].OutputValue' \
  --output text)

aws sns list-subscriptions-by-topic \
  --topic-arn "$TOPIC_ARN" \
  --query 'Subscriptions[].[Protocol, Endpoint]' \
  --output table
```

Expected: Email subscription confirmed

### Check Lambda Metrics

View Lambda function metrics:
```bash
# Invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=acme-atlantis-mcp-prod-ReadFunction \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
  --period 3600 \
  --statistics Sum

# Errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=acme-atlantis-mcp-prod-ReadFunction \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
  --period 3600 \
  --statistics Sum

# Duration
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=acme-atlantis-mcp-prod-ReadFunction \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
  --period 3600 \
  --statistics Average,Maximum
```

### Check API Gateway Metrics

```bash
# Get API Gateway ID
API_ID=$(aws cloudformation describe-stacks \
  --stack-name acme-atlantis-mcp-prod-stack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiId`].OutputValue' \
  --output text)

# Request count
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiId,Value="$API_ID" \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
  --period 3600 \
  --statistics Sum

# 4xx errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name 4XXError \
  --dimensions Name=ApiId,Value="$API_ID" \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
  --period 3600 \
  --statistics Sum

# 5xx errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name 5XXError \
  --dimensions Name=ApiId,Value="$API_ID" \
  --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
  --period 3600 \
  --statistics Sum
```

### Check CloudWatch Logs

Verify log retention:
```bash
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/acme-atlantis-mcp-prod" \
  --query 'logGroups[].[logGroupName, retentionInDays]' \
  --output table
```

Expected: 180 days retention for production

### Use CloudWatch Insights

Run sample queries from `cloudwatch-insights-queries.json`:

```bash
# Error analysis
aws logs start-query \
  --log-group-name "/aws/lambda/acme-atlantis-mcp-prod-ReadFunction" \
  --start-time $(($(date +%s) - 3600)) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20'
```

**Validation**: ✅ Monitoring and alarms are configured and working

---

## Final Validation Summary

After completing all subtasks, verify:

### TEST Environment
- [x] 16.4.1 - Deployed successfully
- [x] 16.4.2 - All 9 MCP tools work
- [x] 16.4.3 - Rate limiting enforced
- [x] 16.4.4 - Caching works with proper TTL
- [x] 16.4.5 - Brown-out support returns partial data

### PROD Environment
- [x] 16.4.6 - Deployed successfully with gradual rollout
- [x] 16.4.7 - All 9 MCP tools work
- [x] 16.4.8 - Monitoring and alarms configured

## Post-Validation Actions

After successful validation:

1. **Update task status**:
   - Mark all subtasks as completed in tasks.md

2. **Document results**:
   - Save validation script output
   - Document any issues encountered
   - Note any configuration adjustments made

3. **Notify stakeholders**:
   - Send deployment notification
   - Share validation results
   - Provide API endpoint information

4. **Monitor for 24 hours**:
   - Watch CloudWatch metrics
   - Check for any alarms
   - Review error logs
   - Monitor performance

5. **Update documentation**:
   - Update deployment guide with lessons learned
   - Document any troubleshooting steps
   - Update runbooks if needed

## Troubleshooting

If validation fails, see:
- [Deployment Testing Guide](deployment-testing-guide.md) - Troubleshooting section
- [Troubleshooting Guide](../../troubleshooting.md) - General troubleshooting
- CloudWatch Logs - Detailed error information
- CloudWatch Insights - Query patterns and analysis

## Support

For issues during validation:
- Check CloudWatch Logs for detailed errors
- Review CloudFormation events for deployment issues
- Consult deployment guides in `application-infrastructure/`
- Review integration test results
- Contact platform team for infrastructure issues
