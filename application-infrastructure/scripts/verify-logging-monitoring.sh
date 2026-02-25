#!/bin/bash
# Script to verify CloudWatch logging and monitoring for Atlantis MCP Server
# Usage: ./verify-logging-monitoring.sh <stack-name> <region>

set -e

STACK_NAME="${1:-atlantis-mcp-test}"
REGION="${2:-us-east-1}"

echo "=========================================="
echo "Verifying Logging and Monitoring"
echo "Stack: $STACK_NAME"
echo "Region: $REGION"
echo "=========================================="
echo ""

# Get stack outputs
echo "📋 Retrieving stack outputs..."
API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text)

LAMBDA_FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`ReadLambdaFunctionName`].OutputValue' \
    --output text)

API_GATEWAY_ID=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayId`].OutputValue' \
    --output text)

echo "✓ API Endpoint: $API_ENDPOINT"
echo "✓ Lambda Function: $LAMBDA_FUNCTION_NAME"
echo "✓ API Gateway ID: $API_GATEWAY_ID"
echo ""

# Check if logging is enabled
echo "🔍 Checking if API Gateway logging is enabled..."
LOGGING_ENABLED=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Parameters[?ParameterKey==`ApiGatewayLoggingEnabled`].ParameterValue' \
    --output text)

if [ "$LOGGING_ENABLED" = "FALSE" ]; then
    echo "⚠️  API Gateway logging is DISABLED in this environment"
    echo "   To enable logging, set ApiGatewayLoggingEnabled=TRUE"
    echo ""
    echo "   Skipping API Gateway log checks..."
    SKIP_API_GATEWAY_LOGS=true
else
    echo "✓ API Gateway logging is ENABLED"
    SKIP_API_GATEWAY_LOGS=false
fi
echo ""

# Task 11.1: Verify CloudWatch logs capture requests
echo "=========================================="
echo "Task 11.1: Verify CloudWatch Logs"
echo "=========================================="
echo ""

# Check Lambda function logs
echo "📝 Checking Lambda function logs..."
LAMBDA_LOG_GROUP="/aws/lambda/$LAMBDA_FUNCTION_NAME"

if aws logs describe-log-groups \
    --log-group-name-prefix "$LAMBDA_LOG_GROUP" \
    --region "$REGION" \
    --query 'logGroups[0].logGroupName' \
    --output text > /dev/null 2>&1; then
    
    echo "✓ Lambda log group exists: $LAMBDA_LOG_GROUP"
    
    # Get recent log streams
    RECENT_STREAMS=$(aws logs describe-log-streams \
        --log-group-name "$LAMBDA_LOG_GROUP" \
        --region "$REGION" \
        --order-by LastEventTime \
        --descending \
        --max-items 5 \
        --query 'logStreams[*].logStreamName' \
        --output text)
    
    if [ -n "$RECENT_STREAMS" ]; then
        echo "✓ Found recent log streams"
        
        # Check for recent log events
        RECENT_LOGS=$(aws logs filter-log-events \
            --log-group-name "$LAMBDA_LOG_GROUP" \
            --region "$REGION" \
            --start-time $(($(date +%s) * 1000 - 3600000)) \
            --max-items 10 \
            --query 'events[*].message' \
            --output text)
        
        if [ -n "$RECENT_LOGS" ]; then
            echo "✓ Lambda function has recent log entries (last hour)"
            
            # Check for API key errors
            API_KEY_ERRORS=$(aws logs filter-log-events \
                --log-group-name "$LAMBDA_LOG_GROUP" \
                --region "$REGION" \
                --start-time $(($(date +%s) * 1000 - 3600000)) \
                --filter-pattern "\"API key\" OR \"api-key\" OR \"x-api-key\" OR \"Forbidden\"" \
                --query 'events[*].message' \
                --output text)
            
            if [ -z "$API_KEY_ERRORS" ]; then
                echo "✓ No API key errors found in Lambda logs"
            else
                echo "⚠️  Found potential API key errors in Lambda logs:"
                echo "$API_KEY_ERRORS" | head -n 5
            fi
        else
            echo "⚠️  No recent log entries found (last hour)"
        fi
    else
        echo "⚠️  No log streams found"
    fi
else
    echo "❌ Lambda log group not found: $LAMBDA_LOG_GROUP"
fi
echo ""

# Check API Gateway logs (if enabled)
if [ "$SKIP_API_GATEWAY_LOGS" = "false" ]; then
    echo "📝 Checking API Gateway access logs..."
    API_ACCESS_LOG_GROUP=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --region "$REGION" \
        --query 'Stacks[0].Outputs[?OutputKey==`CloudWatchApiGatewayAccessLogGroup`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$API_ACCESS_LOG_GROUP" ]; then
        # Extract log group name from URL
        LOG_GROUP_NAME=$(echo "$API_ACCESS_LOG_GROUP" | grep -oP 'group=\K[^&]+' | sed 's/%2F/\//g')
        
        if aws logs describe-log-groups \
            --log-group-name-prefix "$LOG_GROUP_NAME" \
            --region "$REGION" \
            --query 'logGroups[0].logGroupName' \
            --output text > /dev/null 2>&1; then
            
            echo "✓ API Gateway access log group exists"
            
            # Check for recent access logs
            RECENT_ACCESS_LOGS=$(aws logs filter-log-events \
                --log-group-name "$LOG_GROUP_NAME" \
                --region "$REGION" \
                --start-time $(($(date +%s) * 1000 - 3600000)) \
                --max-items 5 \
                --query 'events[*].message' \
                --output text)
            
            if [ -n "$RECENT_ACCESS_LOGS" ]; then
                echo "✓ API Gateway has recent access log entries"
                
                # Check for successful requests (status 200)
                SUCCESS_COUNT=$(aws logs filter-log-events \
                    --log-group-name "$LOG_GROUP_NAME" \
                    --region "$REGION" \
                    --start-time $(($(date +%s) * 1000 - 3600000)) \
                    --filter-pattern "{ $.status = 200 }" \
                    --query 'length(events)' \
                    --output text)
                
                echo "✓ Found $SUCCESS_COUNT successful requests (HTTP 200) in last hour"
            else
                echo "⚠️  No recent access log entries found"
            fi
        else
            echo "❌ API Gateway access log group not found"
        fi
    else
        echo "⚠️  API Gateway access log group output not found in stack"
    fi
    echo ""
    
    echo "📝 Checking API Gateway execution logs..."
    API_EXEC_LOG_GROUP="/aws/apigateway/API-Gateway-Execution-Logs_${API_GATEWAY_ID}/api"
    
    if aws logs describe-log-groups \
        --log-group-name-prefix "$API_EXEC_LOG_GROUP" \
        --region "$REGION" \
        --query 'logGroups[0].logGroupName' \
        --output text > /dev/null 2>&1; then
        
        echo "✓ API Gateway execution log group exists"
        
        # Check for recent execution logs
        RECENT_EXEC_LOGS=$(aws logs filter-log-events \
            --log-group-name "$API_EXEC_LOG_GROUP" \
            --region "$REGION" \
            --start-time $(($(date +%s) * 1000 - 3600000)) \
            --max-items 5 \
            --query 'events[*].message' \
            --output text)
        
        if [ -n "$RECENT_EXEC_LOGS" ]; then
            echo "✓ API Gateway has recent execution log entries"
        else
            echo "⚠️  No recent execution log entries found"
        fi
    else
        echo "⚠️  API Gateway execution log group not found"
    fi
    echo ""
fi

# Task 11.2: Verify CloudWatch metrics are collected
echo "=========================================="
echo "Task 11.2: Verify CloudWatch Metrics"
echo "=========================================="
echo ""

# Check API Gateway metrics
echo "📊 Checking API Gateway metrics..."
API_GATEWAY_METRICS=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/ApiGateway \
    --metric-name Count \
    --dimensions Name=ApiName,Value="$STACK_NAME-WebApi" \
    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Sum \
    --region "$REGION" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "0")

if [ "$API_GATEWAY_METRICS" != "None" ] && [ "$API_GATEWAY_METRICS" != "0" ]; then
    echo "✓ API Gateway request count metrics: $API_GATEWAY_METRICS requests in last hour"
else
    echo "⚠️  No API Gateway request count metrics found (may need traffic)"
fi

# Check for 4xx errors
API_4XX_ERRORS=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/ApiGateway \
    --metric-name 4XXError \
    --dimensions Name=ApiName,Value="$STACK_NAME-WebApi" \
    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Sum \
    --region "$REGION" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "0")

if [ "$API_4XX_ERRORS" = "None" ] || [ "$API_4XX_ERRORS" = "0" ]; then
    echo "✓ No 4xx errors in last hour"
else
    echo "⚠️  Found $API_4XX_ERRORS 4xx errors in last hour"
fi

# Check for 5xx errors
API_5XX_ERRORS=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/ApiGateway \
    --metric-name 5XXError \
    --dimensions Name=ApiName,Value="$STACK_NAME-WebApi" \
    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Sum \
    --region "$REGION" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "0")

if [ "$API_5XX_ERRORS" = "None" ] || [ "$API_5XX_ERRORS" = "0" ]; then
    echo "✓ No 5xx errors in last hour"
else
    echo "⚠️  Found $API_5XX_ERRORS 5xx errors in last hour"
fi
echo ""

# Check Lambda metrics
echo "📊 Checking Lambda function metrics..."
LAMBDA_INVOCATIONS=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Invocations \
    --dimensions Name=FunctionName,Value="$LAMBDA_FUNCTION_NAME" \
    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Sum \
    --region "$REGION" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "0")

if [ "$LAMBDA_INVOCATIONS" != "None" ] && [ "$LAMBDA_INVOCATIONS" != "0" ]; then
    echo "✓ Lambda invocation metrics: $LAMBDA_INVOCATIONS invocations in last hour"
else
    echo "⚠️  No Lambda invocation metrics found (may need traffic)"
fi

# Check Lambda errors
LAMBDA_ERRORS=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Errors \
    --dimensions Name=FunctionName,Value="$LAMBDA_FUNCTION_NAME" \
    --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 3600 \
    --statistics Sum \
    --region "$REGION" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "0")

if [ "$LAMBDA_ERRORS" = "None" ] || [ "$LAMBDA_ERRORS" = "0" ]; then
    echo "✓ No Lambda errors in last hour"
else
    echo "⚠️  Found $LAMBDA_ERRORS Lambda errors in last hour"
fi
echo ""

# Summary
echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""
echo "✓ Logging verification complete"
echo "✓ Metrics verification complete"
echo ""
echo "Note: If no recent traffic is found, send test requests to:"
echo "  $API_ENDPOINT"
echo ""
echo "CloudWatch Console Links:"
echo "  Lambda Logs: https://console.aws.amazon.com/cloudwatch/home?region=$REGION#logStream:group=/aws/lambda/$LAMBDA_FUNCTION_NAME"
if [ "$SKIP_API_GATEWAY_LOGS" = "false" ]; then
    echo "  API Gateway Logs: https://console.aws.amazon.com/cloudwatch/home?region=$REGION#logStream:group=/aws/apigateway/API-Gateway-Execution-Logs_${API_GATEWAY_ID}/api"
fi
echo "  Metrics: https://console.aws.amazon.com/cloudwatch/home?region=$REGION#metricsV2:graph=~();namespace=~'AWS*2fLambda"
echo ""
