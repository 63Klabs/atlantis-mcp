# Logging and Monitoring Verification Guide

This guide explains how to verify CloudWatch logging and monitoring for the Atlantis MCP Server after deployment.

## Prerequisites

1. Valid AWS credentials configured
2. Appropriate IAM permissions for CloudWatch Logs and Metrics
3. Stack deployed to TEST environment

## Automated Verification

### Using the Verification Script

```bash
cd application-infrastructure/scripts
./verify-logging-monitoring.sh atlantis-mcp-test us-east-1
```

The script will automatically check:
- Lambda function logs
- API Gateway logs (if enabled)
- CloudWatch metrics for API Gateway and Lambda
- Presence of API key errors

## Manual Verification

If you prefer to verify manually or the script encounters issues, follow these steps:

### Task 11.1: Verify CloudWatch Logs Capture Requests

#### Step 1: Check Lambda Function Logs

1. Go to CloudWatch Console: https://console.aws.amazon.com/cloudwatch/
2. Navigate to **Logs** → **Log groups**
3. Find log group: `/aws/lambda/acme-atlantis-mcp-test-ReadLambdaFunction`
4. Click on the log group to view log streams
5. Select the most recent log stream
6. Verify:
   - ✓ Log entries exist for recent requests
   - ✓ MCP request handling is logged
   - ✓ No API key errors (search for "API key", "Forbidden", "403")

**Using AWS CLI:**
```bash
# List recent log streams
aws logs describe-log-streams \
  --log-group-name /aws/lambda/acme-atlantis-mcp-test-ReadLambdaFunction \
  --region us-east-1 \
  --order-by LastEventTime \
  --descending \
  --max-items 5

# View recent log events
aws logs tail /aws/lambda/acme-atlantis-mcp-test-ReadLambdaFunction \
  --region us-east-1 \
  --follow

# Search for API key errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/acme-atlantis-mcp-test-ReadLambdaFunction \
  --region us-east-1 \
  --filter-pattern "\"API key\" OR \"Forbidden\" OR \"403\"" \
  --start-time $(($(date +%s) * 1000 - 3600000))
```

#### Step 2: Check API Gateway Access Logs (if logging enabled)

**Note:** In TEST environment, `ApiGatewayLoggingEnabled=FALSE` by default. If you enabled it:

1. Go to CloudWatch Console
2. Navigate to **Logs** → **Log groups**
3. Find log group matching pattern: `/aws/apigateway/atlantis-mcp-test-*`
4. Verify:
   - ✓ Access logs show successful requests (status: 200)
   - ✓ Request details are captured (IP, method, path, response time)

**Using AWS CLI:**
```bash
# Get API Gateway ID from stack outputs
API_GATEWAY_ID=$(aws cloudformation describe-stacks \
  --stack-name atlantis-mcp-test \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayId`].OutputValue' \
  --output text)

# View access logs
aws logs tail /aws/apigateway/API-Gateway-Execution-Logs_${API_GATEWAY_ID}/api \
  --region us-east-1 \
  --follow
```

#### Step 3: Check API Gateway Execution Logs (if logging enabled)

1. Same log group as access logs
2. Look for execution details:
   - ✓ Request processing steps
   - ✓ Lambda integration calls
   - ✓ No authorization errors

### Task 11.2: Verify CloudWatch Metrics Are Collected

#### Step 1: Check API Gateway Metrics

1. Go to CloudWatch Console
2. Navigate to **Metrics** → **All metrics**
3. Select **AWS/ApiGateway** namespace
4. Check metrics:
   - ✓ **Count**: Total number of API requests
   - ✓ **4XXError**: Client errors (should be 0 or low)
   - ✓ **5XXError**: Server errors (should be 0)
   - ✓ **Latency**: Response time

**Using AWS CLI:**
```bash
# Get request count
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiName,Value=atlantis-mcp-test-WebApi \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum \
  --region us-east-1

# Check for 4xx errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name 4XXError \
  --dimensions Name=ApiName,Value=atlantis-mcp-test-WebApi \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum \
  --region us-east-1

# Check for 5xx errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name 5XXError \
  --dimensions Name=ApiName,Value=atlantis-mcp-test-WebApi \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum \
  --region us-east-1
```

#### Step 2: Check Lambda Function Metrics

1. Go to CloudWatch Console
2. Navigate to **Metrics** → **All metrics**
3. Select **AWS/Lambda** namespace
4. Filter by function name: `acme-atlantis-mcp-test-ReadLambdaFunction`
5. Check metrics:
   - ✓ **Invocations**: Number of Lambda invocations
   - ✓ **Errors**: Lambda execution errors (should be 0)
   - ✓ **Duration**: Execution time
   - ✓ **Throttles**: Throttled invocations (should be 0)

**Using AWS CLI:**
```bash
FUNCTION_NAME="acme-atlantis-mcp-test-ReadLambdaFunction"

# Get invocation count
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=$FUNCTION_NAME \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum \
  --region us-east-1

# Check for errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=$FUNCTION_NAME \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum \
  --region us-east-1
```

## Generating Test Traffic

If no metrics or logs are found, generate test traffic:

```bash
# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name atlantis-mcp-test \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

# Send test request (list_templates)
curl -X POST "${API_ENDPOINT}/mcp/list_templates" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "list_templates",
    "params": {},
    "id": 1
  }'

# Send test request (list_starters)
curl -X POST "${API_ENDPOINT}/mcp/list_starters" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "list_starters",
    "params": {},
    "id": 2
  }'
```

Wait 1-2 minutes for metrics to appear in CloudWatch.

## Expected Results

### Task 11.1: CloudWatch Logs
- ✓ Lambda function logs exist and show request processing
- ✓ No API key errors in logs
- ✓ API Gateway logs capture requests (if logging enabled)
- ✓ Execution logs show Lambda integration (if logging enabled)

### Task 11.2: CloudWatch Metrics
- ✓ API Gateway Count metric shows requests
- ✓ API Gateway 4XXError metric is 0 or low
- ✓ API Gateway 5XXError metric is 0
- ✓ Lambda Invocations metric shows function calls
- ✓ Lambda Errors metric is 0

## Troubleshooting

### No Logs Found
- Verify stack is deployed: `aws cloudformation describe-stacks --stack-name atlantis-mcp-test --region us-east-1`
- Check if logging is enabled: Look for `ApiGatewayLoggingEnabled` parameter
- Generate test traffic to create logs

### No Metrics Found
- Metrics require recent traffic (last hour)
- Send test requests to generate metrics
- Wait 1-2 minutes for metrics to appear
- Check metric dimensions match your stack name

### API Key Errors in Logs
- This should NOT happen after removing API key requirement
- If found, verify:
  - MCPPublicApiKey resource is removed from template
  - MCPPublicUsagePlan resource is removed from template
  - MCPUsagePlanKey resource is removed from template
  - Stack was redeployed after changes

## CloudWatch Console Links

Replace `<REGION>` and `<FUNCTION_NAME>` with your values:

- **Lambda Logs**: https://console.aws.amazon.com/cloudwatch/home?region=<REGION>#logStream:group=/aws/lambda/<FUNCTION_NAME>
- **API Gateway Logs**: https://console.aws.amazon.com/cloudwatch/home?region=<REGION>#logStream:group=/aws/apigateway/
- **Metrics Dashboard**: https://console.aws.amazon.com/cloudwatch/home?region=<REGION>#metricsV2:

## Completion Criteria

Task 11 is complete when:
- ✓ Lambda function logs capture requests without API key errors
- ✓ API Gateway logs capture requests (if logging enabled)
- ✓ CloudWatch metrics show API Gateway request counts
- ✓ CloudWatch metrics show Lambda invocations
- ✓ No 4xx/5xx errors related to missing API keys
- ✓ All metrics are being collected as expected
