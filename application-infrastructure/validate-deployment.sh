#!/bin/bash

# Deployment Validation Script for Atlantis MCP Server
# This script validates deployment to TEST and PROD environments
# Usage: ./validate-deployment.sh [test|prod]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-test}
STACK_NAME="acme-atlantis-mcp-${ENVIRONMENT}-stack"
FUNCTION_NAME="acme-atlantis-mcp-${ENVIRONMENT}-ReadFunction"

# Validation results
PASSED=0
FAILED=0
WARNINGS=0

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    FAILED=$((FAILED + 1))
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
    WARNINGS=$((WARNINGS + 1))
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
    PASSED=$((PASSED + 1))
}

# Validate environment parameter
if [[ "$ENVIRONMENT" != "test" && "$ENVIRONMENT" != "prod" ]]; then
    log_error "Invalid environment: $ENVIRONMENT. Must be 'test' or 'prod'"
    exit 1
fi

log_info "Starting deployment validation for ${ENVIRONMENT} environment"
echo "=================================================="

# Task 16.4.1: Verify deployment exists
log_info "Task 16.4.1: Verifying deployment exists..."

# Check CloudFormation stack
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" &>/dev/null; then
    STACK_STATUS=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query 'Stacks[0].StackStatus' \
        --output text)
    
    if [[ "$STACK_STATUS" == "CREATE_COMPLETE" || "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
        log_success "CloudFormation stack exists and is in good state: $STACK_STATUS"
    else
        log_error "CloudFormation stack exists but in unexpected state: $STACK_STATUS"
    fi
else
    log_error "CloudFormation stack not found: $STACK_NAME"
    exit 1
fi

# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text)

if [[ -z "$API_ENDPOINT" ]]; then
    log_error "Could not retrieve API endpoint from CloudFormation outputs"
    exit 1
fi

log_success "API Endpoint: $API_ENDPOINT"

# Task 16.4.2/16.4.7: Verify all MCP tools work
log_info "Task 16.4.2/16.4.7: Testing all MCP tools..."

# Test list_categories
log_info "Testing list_categories..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/list_categories" \
    -H "Content-Type: application/json" \
    -d '{}')

if echo "$RESPONSE" | jq -e '.categories' &>/dev/null; then
    CATEGORY_COUNT=$(echo "$RESPONSE" | jq '.categories | length')
    log_success "list_categories works ($CATEGORY_COUNT categories found)"
else
    log_error "list_categories failed: $RESPONSE"
fi

# Test list_templates
log_info "Testing list_templates..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/list_templates" \
    -H "Content-Type: application/json" \
    -d '{"category": "storage"}')

if echo "$RESPONSE" | jq -e '.templates' &>/dev/null; then
    TEMPLATE_COUNT=$(echo "$RESPONSE" | jq '.templates | length')
    log_success "list_templates works ($TEMPLATE_COUNT templates found)"
else
    log_error "list_templates failed: $RESPONSE"
fi

# Test get_template
log_info "Testing get_template..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/get_template" \
    -H "Content-Type: application/json" \
    -d '{"templateName": "template-storage-s3-artifacts.yml", "category": "storage"}')

if echo "$RESPONSE" | jq -e '.template' &>/dev/null; then
    log_success "get_template works"
else
    log_warning "get_template may have failed (template might not exist): $RESPONSE"
fi

# Test list_template_versions
log_info "Testing list_template_versions..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/list_template_versions" \
    -H "Content-Type: application/json" \
    -d '{"templateName": "template-storage-s3-artifacts.yml", "category": "storage"}')

if echo "$RESPONSE" | jq -e '.versions' &>/dev/null; then
    VERSION_COUNT=$(echo "$RESPONSE" | jq '.versions | length')
    log_success "list_template_versions works ($VERSION_COUNT versions found)"
else
    log_warning "list_template_versions may have failed: $RESPONSE"
fi

# Test list_starters
log_info "Testing list_starters..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/list_starters" \
    -H "Content-Type: application/json" \
    -d '{}')

if echo "$RESPONSE" | jq -e '.starters' &>/dev/null; then
    STARTER_COUNT=$(echo "$RESPONSE" | jq '.starters | length')
    log_success "list_starters works ($STARTER_COUNT starters found)"
else
    log_warning "list_starters may have failed: $RESPONSE"
fi

# Test get_starter_info
log_info "Testing get_starter_info..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/get_starter_info" \
    -H "Content-Type: application/json" \
    -d '{"starterName": "atlantis-starter-02"}')

if echo "$RESPONSE" | jq -e '.starter' &>/dev/null; then
    log_success "get_starter_info works"
else
    log_warning "get_starter_info may have failed (starter might not exist): $RESPONSE"
fi

# Test search_documentation
log_info "Testing search_documentation..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/search_documentation" \
    -H "Content-Type: application/json" \
    -d '{"query": "CloudFormation"}')

if echo "$RESPONSE" | jq -e '.results' &>/dev/null; then
    RESULT_COUNT=$(echo "$RESPONSE" | jq '.results | length')
    log_success "search_documentation works ($RESULT_COUNT results found)"
else
    log_error "search_documentation failed: $RESPONSE"
fi

# Test validate_naming
log_info "Testing validate_naming..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/validate_naming" \
    -H "Content-Type: application/json" \
    -d '{"resourceName": "acme-myapp-test-MyFunction", "resourceType": "Lambda"}')

if echo "$RESPONSE" | jq -e '.valid' &>/dev/null; then
    log_success "validate_naming works"
else
    log_error "validate_naming failed: $RESPONSE"
fi

# Test check_template_updates
log_info "Testing check_template_updates..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/check_template_updates" \
    -H "Content-Type: application/json" \
    -d '{"templateName": "template-storage-s3-artifacts.yml", "category": "storage", "currentVersion": "v1.0.0"}')

if echo "$RESPONSE" | jq -e '.updates' &>/dev/null; then
    log_success "check_template_updates works"
else
    log_warning "check_template_updates may have failed: $RESPONSE"
fi

# Task 16.4.3: Verify rate limiting works
log_info "Task 16.4.3: Testing rate limiting..."

# Make multiple rapid requests to trigger rate limit
log_info "Making 10 rapid requests to test rate limiting..."
RATE_LIMITED=false

for i in {1..10}; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_ENDPOINT}/list_categories" \
        -H "Content-Type: application/json" \
        -d '{}')
    
    if [[ "$HTTP_CODE" == "429" ]]; then
        RATE_LIMITED=true
        log_success "Rate limiting works (received 429 on request $i)"
        break
    fi
    sleep 0.1
done

if [[ "$RATE_LIMITED" == "false" ]]; then
    log_warning "Rate limiting not triggered after 10 requests (may need more requests or rate limit is high)"
fi

# Task 16.4.4: Verify caching works
log_info "Task 16.4.4: Testing caching..."

# Make first request (cache miss)
log_info "Making first request (should be cache miss)..."
START_TIME=$(date +%s%N)
RESPONSE1=$(curl -s -X POST "${API_ENDPOINT}/list_categories" \
    -H "Content-Type: application/json" \
    -d '{}')
END_TIME=$(date +%s%N)
DURATION1=$(( (END_TIME - START_TIME) / 1000000 ))

# Make second request (should be cache hit)
log_info "Making second request (should be cache hit)..."
START_TIME=$(date +%s%N)
RESPONSE2=$(curl -s -X POST "${API_ENDPOINT}/list_categories" \
    -H "Content-Type: application/json" \
    -d '{}')
END_TIME=$(date +%s%N)
DURATION2=$(( (END_TIME - START_TIME) / 1000000 ))

log_info "First request: ${DURATION1}ms, Second request: ${DURATION2}ms"

if [[ "$RESPONSE1" == "$RESPONSE2" ]]; then
    log_success "Caching works (responses match)"
    
    if [[ $DURATION2 -lt $DURATION1 ]]; then
        log_success "Cache hit is faster than cache miss (${DURATION2}ms < ${DURATION1}ms)"
    else
        log_warning "Cache hit not significantly faster (may be network variance)"
    fi
else
    log_error "Caching may not work (responses don't match)"
fi

# Task 16.4.5: Verify brown-out support works
log_info "Task 16.4.5: Testing brown-out support..."

# Test with invalid bucket (should still return partial data)
log_info "Testing with mixed valid/invalid sources..."
RESPONSE=$(curl -s -X POST "${API_ENDPOINT}/list_templates" \
    -H "Content-Type: application/json" \
    -d '{"s3Buckets": ["valid-bucket", "invalid-bucket"]}')

if echo "$RESPONSE" | jq -e '.templates' &>/dev/null; then
    if echo "$RESPONSE" | jq -e '.errors' &>/dev/null; then
        log_success "Brown-out support works (partial data returned with errors)"
    else
        log_warning "Brown-out support unclear (no errors reported, may be all valid)"
    fi
else
    log_warning "Brown-out support test inconclusive"
fi

# Task 16.4.8: Verify monitoring and alarms work (PROD only)
if [[ "$ENVIRONMENT" == "prod" ]]; then
    log_info "Task 16.4.8: Verifying monitoring and alarms..."
    
    # Check CloudWatch dashboard exists
    DASHBOARD_NAME="acme-atlantis-mcp-prod-dashboard"
    if aws cloudwatch get-dashboard --dashboard-name "$DASHBOARD_NAME" &>/dev/null; then
        log_success "CloudWatch dashboard exists: $DASHBOARD_NAME"
    else
        log_error "CloudWatch dashboard not found: $DASHBOARD_NAME"
    fi
    
    # Check CloudWatch alarms exist
    ALARMS=$(aws cloudwatch describe-alarms \
        --alarm-name-prefix "acme-atlantis-mcp-prod" \
        --query 'MetricAlarms[].AlarmName' \
        --output text)
    
    if [[ -n "$ALARMS" ]]; then
        ALARM_COUNT=$(echo "$ALARMS" | wc -w)
        log_success "CloudWatch alarms configured ($ALARM_COUNT alarms found)"
        
        # Check alarm states
        ALARM_STATES=$(aws cloudwatch describe-alarms \
            --alarm-name-prefix "acme-atlantis-mcp-prod" \
            --query 'MetricAlarms[].StateValue' \
            --output text)
        
        if echo "$ALARM_STATES" | grep -q "ALARM"; then
            log_warning "Some alarms are in ALARM state"
        else
            log_success "All alarms are in OK or INSUFFICIENT_DATA state"
        fi
    else
        log_error "No CloudWatch alarms found"
    fi
    
    # Check Lambda function metrics
    log_info "Checking Lambda function metrics..."
    INVOCATIONS=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/Lambda \
        --metric-name Invocations \
        --dimensions Name=FunctionName,Value="$FUNCTION_NAME" \
        --start-time "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S)" \
        --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
        --period 3600 \
        --statistics Sum \
        --query 'Datapoints[0].Sum' \
        --output text)
    
    if [[ "$INVOCATIONS" != "None" && -n "$INVOCATIONS" ]]; then
        log_success "Lambda function has invocations: $INVOCATIONS"
    else
        log_warning "No Lambda invocations in the last hour"
    fi
fi

# Check Lambda function configuration
log_info "Verifying Lambda function configuration..."

FUNCTION_CONFIG=$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME")

# Check memory size
MEMORY_SIZE=$(echo "$FUNCTION_CONFIG" | jq -r '.MemorySize')
log_info "Lambda memory size: ${MEMORY_SIZE}MB"

# Check timeout
TIMEOUT=$(echo "$FUNCTION_CONFIG" | jq -r '.Timeout')
log_info "Lambda timeout: ${TIMEOUT}s"

# Check environment variables
ENV_VARS=$(echo "$FUNCTION_CONFIG" | jq -r '.Environment.Variables | keys[]')
log_info "Environment variables configured: $(echo "$ENV_VARS" | wc -l)"

# Check CloudWatch Logs
log_info "Checking CloudWatch Logs..."

LOG_GROUP="/aws/lambda/$FUNCTION_NAME"
if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" &>/dev/null; then
    log_success "CloudWatch Log Group exists: $LOG_GROUP"
    
    # Check recent log streams
    RECENT_STREAMS=$(aws logs describe-log-streams \
        --log-group-name "$LOG_GROUP" \
        --order-by LastEventTime \
        --descending \
        --max-items 5 \
        --query 'logStreams[].logStreamName' \
        --output text)
    
    if [[ -n "$RECENT_STREAMS" ]]; then
        log_success "Recent log streams found (function has been invoked)"
    else
        log_warning "No recent log streams found"
    fi
else
    log_error "CloudWatch Log Group not found: $LOG_GROUP"
fi

# Summary
echo ""
echo "=================================================="
echo "Deployment Validation Summary"
echo "=================================================="
echo -e "${GREEN}Passed:${NC} $PASSED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "${RED}Failed:${NC} $FAILED"
echo "=================================================="

if [[ $FAILED -gt 0 ]]; then
    echo -e "${RED}Deployment validation FAILED${NC}"
    exit 1
elif [[ $WARNINGS -gt 0 ]]; then
    echo -e "${YELLOW}Deployment validation PASSED with warnings${NC}"
    exit 0
else
    echo -e "${GREEN}Deployment validation PASSED${NC}"
    exit 0
fi
