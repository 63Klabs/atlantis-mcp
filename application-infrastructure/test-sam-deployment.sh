#!/bin/bash
# Test script for SAM deployment validation
# This script validates deployment prerequisites and configuration
# Run this BEFORE attempting actual deployment

set -e  # Exit on error

echo "=========================================="
echo "SAM Deployment Validation Script"
echo "Atlantis MCP Server - Phase 1"
echo "=========================================="
echo ""

# Configuration
CONFIG_FILE="${1:-samconfig-test.toml}"
STACK_NAME="atlantis-mcp-test"

if [[ "$CONFIG_FILE" == *"prod"* ]]; then
    STACK_NAME="atlantis-mcp-prod"
fi

echo "Using configuration: $CONFIG_FILE"
echo "Stack name: $STACK_NAME"
echo ""

# Check prerequisites
echo "=========================================="
echo "Step 1: Check Prerequisites"
echo "=========================================="

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo "✗ AWS CLI is not installed"
    exit 1
fi
echo "✓ AWS CLI found: $(aws --version)"

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "✗ AWS credentials not configured or invalid"
    echo "  Run: aws configure"
    exit 1
fi

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region)
echo "✓ AWS credentials valid"
echo "  Account: $AWS_ACCOUNT"
echo "  Region: $AWS_REGION"

echo ""
echo "=========================================="
echo "Step 2: Validate Configuration File"
echo "=========================================="

if [ ! -f "$CONFIG_FILE" ]; then
    echo "✗ Configuration file not found: $CONFIG_FILE"
    exit 1
fi
echo "✓ Configuration file exists"

# Check for placeholder values that need updating
echo ""
echo "Checking for placeholder values..."

PLACEHOLDERS_FOUND=0

if grep -q "123456789012" "$CONFIG_FILE"; then
    echo "⚠ WARNING: Found placeholder AWS account ID (123456789012)"
    echo "  Update DeployRole parameter with your actual account ID"
    PLACEHOLDERS_FOUND=1
fi

if grep -q "devops@example.com\|ops@example.com" "$CONFIG_FILE"; then
    echo "⚠ WARNING: Found placeholder email address"
    echo "  Update AlarmNotificationEmail parameter with your actual email"
    PLACEHOLDERS_FOUND=1
fi

if grep -q 'AtlantisS3Buckets=""' "$CONFIG_FILE"; then
    echo "⚠ WARNING: AtlantisS3Buckets is empty"
    echo "  Add at least one S3 bucket containing templates"
    PLACEHOLDERS_FOUND=1
fi

if [ $PLACEHOLDERS_FOUND -eq 1 ]; then
    echo ""
    echo "✗ Configuration contains placeholder values"
    echo "  Please update $CONFIG_FILE before deploying"
    exit 1
else
    echo "✓ No obvious placeholder values found"
fi

echo ""
echo "=========================================="
echo "Step 3: Check GitHub Token in SSM"
echo "=========================================="

# Extract GitHubTokenParameter from config
GITHUB_TOKEN_PARAM=$(grep "GitHubTokenParameter=" "$CONFIG_FILE" | cut -d'"' -f2)

if [ -z "$GITHUB_TOKEN_PARAM" ]; then
    GITHUB_TOKEN_PARAM="/atlantis-mcp/github/token"
fi

echo "Checking for GitHub token at: $GITHUB_TOKEN_PARAM"

if aws ssm get-parameter --name "$GITHUB_TOKEN_PARAM" --with-decryption &> /dev/null; then
    echo "✓ GitHub token found in SSM Parameter Store"
else
    echo "✗ GitHub token not found in SSM Parameter Store"
    echo ""
    echo "Create the token with:"
    echo "  aws ssm put-parameter \\"
    echo "    --name \"$GITHUB_TOKEN_PARAM\" \\"
    echo "    --value \"ghp_your_github_token_here\" \\"
    echo "    --type \"SecureString\" \\"
    echo "    --description \"GitHub Personal Access Token for Atlantis MCP Server\""
    echo ""
    echo "Token requirements:"
    echo "  - Scopes: repo, read:org"
    echo "  - Access to 63Klabs organization (or your configured orgs)"
    exit 1
fi

echo ""
echo "=========================================="
echo "Step 4: Check Cache-Data Storage Stack"
echo "=========================================="

# Extract Prefix from config
PREFIX=$(grep 'Prefix=' "$CONFIG_FILE" | head -1 | cut -d'"' -f2)

if [ -z "$PREFIX" ]; then
    PREFIX="acme"
fi

CACHE_STACK_NAME="${PREFIX}-cache-data-storage"

echo "Looking for Cache-Data storage stack: $CACHE_STACK_NAME"

# Check if using explicit table/bucket names or ImportValue
EXPLICIT_TABLE=$(grep "CacheDataDynamoDbTableName=" "$CONFIG_FILE" | grep -v '""' | cut -d'"' -f2)
EXPLICIT_BUCKET=$(grep "CacheDataS3BucketName=" "$CONFIG_FILE" | grep -v '""' | cut -d'"' -f2)

if [ -n "$EXPLICIT_TABLE" ] && [ -n "$EXPLICIT_BUCKET" ]; then
    echo "✓ Using explicit cache resources (not ImportValue)"
    echo "  DynamoDB Table: $EXPLICIT_TABLE"
    echo "  S3 Bucket: $EXPLICIT_BUCKET"
    
    # Verify resources exist
    if aws dynamodb describe-table --table-name "$EXPLICIT_TABLE" &> /dev/null; then
        echo "  ✓ DynamoDB table exists"
    else
        echo "  ✗ DynamoDB table not found: $EXPLICIT_TABLE"
        exit 1
    fi
    
    if aws s3 ls "s3://$EXPLICIT_BUCKET" &> /dev/null; then
        echo "  ✓ S3 bucket exists"
    else
        echo "  ✗ S3 bucket not found: $EXPLICIT_BUCKET"
        exit 1
    fi
else
    echo "Using ImportValue from Cache-Data storage stack"
    
    # Check if stack exists
    if aws cloudformation describe-stacks --stack-name "$CACHE_STACK_NAME" &> /dev/null; then
        echo "✓ Cache-Data storage stack found"
        
        # Get exported values
        EXPORTED_TABLE=$(aws cloudformation list-exports --query "Exports[?Name=='${PREFIX}-CacheDataDynamoDbTable'].Value" --output text)
        EXPORTED_BUCKET=$(aws cloudformation list-exports --query "Exports[?Name=='${PREFIX}-CacheDataS3Bucket'].Value" --output text)
        
        if [ -n "$EXPORTED_TABLE" ]; then
            echo "  ✓ DynamoDB table export found: $EXPORTED_TABLE"
        else
            echo "  ✗ DynamoDB table export not found"
            exit 1
        fi
        
        if [ -n "$EXPORTED_BUCKET" ]; then
            echo "  ✓ S3 bucket export found: $EXPORTED_BUCKET"
        else
            echo "  ✗ S3 bucket export not found"
            exit 1
        fi
    else
        echo "✗ Cache-Data storage stack not found: $CACHE_STACK_NAME"
        echo ""
        echo "Deploy the Cache-Data storage stack first, or specify explicit"
        echo "CacheDataDynamoDbTableName and CacheDataS3BucketName in $CONFIG_FILE"
        exit 1
    fi
fi

echo ""
echo "=========================================="
echo "Step 5: Check S3 Buckets Configuration"
echo "=========================================="

# Extract S3 buckets from config
S3_BUCKETS=$(grep "AtlantisS3Buckets=" "$CONFIG_FILE" | cut -d'"' -f2)

if [ -z "$S3_BUCKETS" ]; then
    echo "⚠ WARNING: No S3 buckets configured"
    echo "  The MCP server will not be able to list templates"
    echo "  Add buckets to AtlantisS3Buckets parameter"
else
    echo "Configured S3 buckets: $S3_BUCKETS"
    
    # Check each bucket
    IFS=',' read -ra BUCKETS <<< "$S3_BUCKETS"
    for bucket in "${BUCKETS[@]}"; do
        bucket=$(echo "$bucket" | xargs)  # trim whitespace
        
        if aws s3 ls "s3://$bucket" &> /dev/null; then
            echo "  ✓ Bucket accessible: $bucket"
            
            # Check for required tags
            TAGS=$(aws s3api get-bucket-tagging --bucket "$bucket" 2>/dev/null || echo "")
            
            if echo "$TAGS" | grep -q "atlantis-mcp:Allow"; then
                echo "    ✓ Has atlantis-mcp:Allow tag"
            else
                echo "    ⚠ Missing atlantis-mcp:Allow tag"
            fi
            
            if echo "$TAGS" | grep -q "atlantis-mcp:IndexPriority"; then
                echo "    ✓ Has atlantis-mcp:IndexPriority tag"
            else
                echo "    ⚠ Missing atlantis-mcp:IndexPriority tag"
            fi
        else
            echo "  ✗ Bucket not accessible: $bucket"
            echo "    Verify bucket exists and you have permissions"
        fi
    done
fi

echo ""
echo "=========================================="
echo "Step 6: Check IAM Permissions"
echo "=========================================="

echo "Checking if you have permissions to create CloudFormation stacks..."

# Try to validate permissions by checking if we can list stacks
if aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE &> /dev/null; then
    echo "✓ Can list CloudFormation stacks"
else
    echo "✗ Cannot list CloudFormation stacks"
    echo "  You may not have sufficient IAM permissions"
    exit 1
fi

# Check if stack already exists
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" &> /dev/null; then
    echo "⚠ Stack already exists: $STACK_NAME"
    echo "  Deployment will UPDATE the existing stack"
else
    echo "✓ Stack does not exist (will be created)"
fi

echo ""
echo "=========================================="
echo "Validation Summary"
echo "=========================================="
echo "✓ All validation checks passed"
echo ""
echo "Ready to deploy!"
echo ""
echo "Next steps:"
echo "1. Review configuration: $CONFIG_FILE"
echo "2. Build the application:"
echo "   sam build --config-file $CONFIG_FILE"
echo "3. Deploy to AWS:"
echo "   sam deploy --config-file $CONFIG_FILE --guided"
echo ""
echo "For detailed instructions, see:"
echo "  application-infrastructure/SAM-DEPLOYMENT-GUIDE.md"
echo ""
