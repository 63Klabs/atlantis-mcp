#!/bin/bash
# Test script for SAM build validation
# This script validates that the SAM build process works correctly
# without actually deploying to AWS

set -e  # Exit on error

echo "=========================================="
echo "SAM Build Test Script"
echo "Atlantis MCP Server - Phase 1"
echo "=========================================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo "ERROR: AWS SAM CLI is not installed"
    echo "Install from: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    exit 1
fi
echo "✓ SAM CLI found: $(sam --version)"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed"
    exit 1
fi
echo "✓ Node.js found: $(node --version)"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed"
    exit 1
fi
echo "✓ Python found: $(python3 --version)"

echo ""
echo "=========================================="
echo "Step 1: Validate CloudFormation Template"
echo "=========================================="

# Validate template syntax
echo "Validating template.yml..."
sam validate --template template.yml --lint

if [ $? -eq 0 ]; then
    echo "✓ Template validation passed"
else
    echo "✗ Template validation failed"
    exit 1
fi

echo ""
echo "=========================================="
echo "Step 2: Build Lambda Functions"
echo "=========================================="

# Clean previous build
if [ -d ".aws-sam" ]; then
    echo "Cleaning previous build artifacts..."
    rm -rf .aws-sam
fi

# Build using TEST configuration
echo "Building with samconfig-test.toml..."
sam build --config-file samconfig-test.toml

if [ $? -eq 0 ]; then
    echo "✓ SAM build completed successfully"
else
    echo "✗ SAM build failed"
    exit 1
fi

echo ""
echo "=========================================="
echo "Step 3: Verify Build Artifacts"
echo "=========================================="

# Check if build directory exists
if [ ! -d ".aws-sam/build" ]; then
    echo "✗ Build directory not found"
    exit 1
fi
echo "✓ Build directory exists"

# Check if ReadLambdaFunction was built
if [ ! -d ".aws-sam/build/ReadLambdaFunction" ]; then
    echo "✗ ReadLambdaFunction build not found"
    exit 1
fi
echo "✓ ReadLambdaFunction build found"

# Check if Lambda handler exists
if [ ! -f ".aws-sam/build/ReadLambdaFunction/index.js" ]; then
    echo "✗ Lambda handler (index.js) not found"
    exit 1
fi
echo "✓ Lambda handler found"

# Check if node_modules exists
if [ ! -d ".aws-sam/build/ReadLambdaFunction/node_modules" ]; then
    echo "✗ node_modules not found in Lambda build"
    exit 1
fi
echo "✓ node_modules found"

# Check if @63klabs/cache-data is installed
if [ ! -d ".aws-sam/build/ReadLambdaFunction/node_modules/@63klabs/cache-data" ]; then
    echo "✗ @63klabs/cache-data dependency not found"
    exit 1
fi
echo "✓ @63klabs/cache-data dependency found"

# Check Lambda function structure
echo ""
echo "Checking Lambda function structure..."
REQUIRED_DIRS=(
    "config"
    "routes"
    "controllers"
    "services"
    "models"
    "views"
    "utils"
)

for dir in "${REQUIRED_DIRS[@]}"; do
    if [ ! -d ".aws-sam/build/ReadLambdaFunction/$dir" ]; then
        echo "✗ Required directory not found: $dir"
        exit 1
    fi
    echo "✓ Directory found: $dir"
done

echo ""
echo "=========================================="
echo "Step 4: Check Build Size"
echo "=========================================="

# Get build size
BUILD_SIZE=$(du -sh .aws-sam/build/ReadLambdaFunction | cut -f1)
echo "Lambda package size: $BUILD_SIZE"

# Warn if build is too large (Lambda has 250MB unzipped limit)
BUILD_SIZE_BYTES=$(du -s .aws-sam/build/ReadLambdaFunction | cut -f1)
BUILD_SIZE_MB=$((BUILD_SIZE_BYTES / 1024))

if [ $BUILD_SIZE_MB -gt 200 ]; then
    echo "⚠ WARNING: Build size is large ($BUILD_SIZE_MB MB). Consider optimizing dependencies."
elif [ $BUILD_SIZE_MB -gt 100 ]; then
    echo "⚠ Build size is moderate ($BUILD_SIZE_MB MB)"
else
    echo "✓ Build size is acceptable ($BUILD_SIZE_MB MB)"
fi

echo ""
echo "=========================================="
echo "Step 5: Verify Template Processing"
echo "=========================================="

# Check if template was processed
if [ ! -f ".aws-sam/build/template.yaml" ]; then
    echo "✗ Processed template not found"
    exit 1
fi
echo "✓ Processed template found"

echo ""
echo "=========================================="
echo "Build Test Summary"
echo "=========================================="
echo "✓ All build tests passed successfully"
echo ""
echo "Next steps:"
echo "1. Update samconfig-test.toml with your AWS account details"
echo "2. Store GitHub token in SSM Parameter Store"
echo "3. Deploy Cache-Data storage stack (if not already deployed)"
echo "4. Run: sam deploy --config-file samconfig-test.toml --guided"
echo ""
echo "For detailed deployment instructions, see:"
echo "  docs/application-infrastructure/deployment/sam-deployment-guide.md"
echo ""
