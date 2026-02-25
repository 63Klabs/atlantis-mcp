# Verification Scripts

This directory contains scripts for verifying the Atlantis MCP Server deployment.

## verify-logging-monitoring.sh

Verifies CloudWatch logging and monitoring for the deployed stack.

### Usage

```bash
./verify-logging-monitoring.sh [stack-name] [region]
```

### Parameters

- `stack-name` (optional): CloudFormation stack name. Default: `atlantis-mcp-test`
- `region` (optional): AWS region. Default: `us-east-1`

### Examples

```bash
# Verify TEST environment (default)
./verify-logging-monitoring.sh

# Verify specific stack
./verify-logging-monitoring.sh atlantis-mcp-prod us-east-1

# Verify with explicit parameters
./verify-logging-monitoring.sh atlantis-mcp-test us-east-1
```

### What It Checks

#### Task 11.1: CloudWatch Logs
- Lambda function logs exist and capture requests
- API Gateway access logs (if logging enabled)
- API Gateway execution logs (if logging enabled)
- No API key errors in logs

#### Task 11.2: CloudWatch Metrics
- API Gateway request count metrics
- API Gateway 4xx/5xx error metrics
- Lambda invocation metrics
- Lambda error metrics

### Prerequisites

- AWS CLI installed and configured
- Appropriate IAM permissions to read CloudWatch logs and metrics
- Stack must be deployed to the target environment

### Output

The script provides:
- ✓ Success indicators for passing checks
- ⚠️ Warning indicators for missing data or issues
- ❌ Error indicators for failures
- CloudWatch console links for manual inspection

### Notes

- If API Gateway logging is disabled (`ApiGatewayLoggingEnabled=FALSE`), API Gateway log checks will be skipped
- Metrics require recent traffic to the API. If no metrics are found, send test requests first
- The script checks for logs and metrics from the last hour
