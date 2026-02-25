#!/bin/bash

# Test Release Workflow Script
# This script validates the release workflow configuration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${NC}  $1"
}

echo "Testing Release Workflow Configuration..."
echo ""

# Test 1: Validate workflow file exists
echo "Test 1: Workflow file exists"
if [ -f .github/workflows/release.yml ]; then
    print_success "Workflow file found"
else
    print_error "Workflow file not found: .github/workflows/release.yml"
    exit 1
fi

# Test 2: Check workflow syntax (basic)
echo ""
echo "Test 2: Workflow syntax validation"
if grep -q "^name:" .github/workflows/release.yml && \
   grep -q "^on:" .github/workflows/release.yml && \
   grep -q "^jobs:" .github/workflows/release.yml; then
    print_success "Basic workflow syntax is valid"
else
    print_error "Workflow syntax appears invalid"
    exit 1
fi

# Test 3: Check tag trigger configuration
echo ""
echo "Test 3: Tag trigger configuration"
if grep -A 3 "^on:" .github/workflows/release.yml | grep -q "tags:"; then
    print_success "Tag trigger configured"
    TAG_PATTERN=$(grep -A 5 "tags:" .github/workflows/release.yml | grep -E "^\s+-\s+" | head -1 | sed "s/^[[:space:]]*-[[:space:]]*//")
    print_info "Tag pattern: $TAG_PATTERN"
else
    print_error "Tag trigger not configured"
    exit 1
fi

# Test 4: Check required jobs
echo ""
echo "Test 4: Required jobs"
if grep -q "create-release:" .github/workflows/release.yml; then
    print_success "create-release job found"
else
    print_error "create-release job not found"
    exit 1
fi

# Test 5: Check GitHub token configuration
echo ""
echo "Test 5: GitHub token configuration"
if grep -q "GITHUB_TOKEN" .github/workflows/release.yml; then
    print_success "GitHub token configured"
else
    print_warning "GitHub token not found (may use default)"
fi

# Test 6: Check permissions
echo ""
echo "Test 6: Workflow permissions"
if grep -q "permissions:" .github/workflows/release.yml; then
    print_success "Permissions configured"
    if grep -A 5 "permissions:" .github/workflows/release.yml | grep -q "contents: write"; then
        print_info "Contents: write ✓"
    else
        print_warning "Contents: write not found"
    fi
else
    print_warning "Permissions not explicitly configured (using defaults)"
fi

# Test 7: Test changelog extraction
echo ""
echo "Test 7: Changelog extraction"
if [ -f CHANGELOG.md ]; then
    print_success "CHANGELOG.md found"
    
    # Try to extract unreleased section
    UNRELEASED_CONTENT=$(awk '/^## \[Unreleased\]/,/^## \[v?[0-9]/' CHANGELOG.md | sed '$d' | tail -n +2)
    if [ -n "$UNRELEASED_CONTENT" ]; then
        print_success "Unreleased section found in CHANGELOG.md"
        LINE_COUNT=$(echo "$UNRELEASED_CONTENT" | wc -l)
        print_info "Unreleased section has $LINE_COUNT lines"
    else
        print_warning "Unreleased section is empty or not found"
    fi
else
    print_error "CHANGELOG.md not found"
    exit 1
fi

# Test 8: Test artifact creation
echo ""
echo "Test 8: Artifact creation test"
print_info "Creating test artifact..."

zip -r test-artifact.zip . \
    -x "*.git/*" \
    -x "*.DS_Store" \
    -x "*.env*" \
    -x "*.vscode/*" \
    -x "*__pycache__/*" \
    -x "*/node_modules/*" \
    -x "*.kiro/*" \
    -x "*/.aws-sam/*" \
    -x "*/coverage/*" \
    -x "*/test-results/*" \
    -x "test-artifact.zip" \
    > /dev/null 2>&1

if [ -f test-artifact.zip ]; then
    SIZE=$(du -h test-artifact.zip | cut -f1)
    print_success "Artifact created successfully ($SIZE)"
    rm test-artifact.zip
else
    print_error "Artifact creation failed"
    exit 1
fi

# Test 9: Check package.json version
echo ""
echo "Test 9: Package version check"
if [ -f application-infrastructure/src/lambda/read/package.json ]; then
    VERSION=$(node -p "require('./application-infrastructure/src/lambda/read/package.json').version" 2>/dev/null || echo "unknown")
    if [ "$VERSION" != "unknown" ]; then
        print_success "Package version: v$VERSION"
    else
        print_warning "Could not read package version"
    fi
else
    print_warning "package.json not found"
fi

# Test 10: Check S3 deployment workflow
echo ""
echo "Test 10: S3 deployment workflow"
if [ -f .github/workflows/deploy-to-s3.yml ]; then
    print_success "S3 deployment workflow found"
    if grep -q "release:" .github/workflows/deploy-to-s3.yml && \
       grep -q "types: \[published\]" .github/workflows/deploy-to-s3.yml; then
        print_success "S3 deployment triggered on release publish"
    else
        print_warning "S3 deployment trigger configuration unclear"
    fi
else
    print_warning "S3 deployment workflow not found (optional)"
fi

# Test 11: Check release documentation
echo ""
echo "Test 11: Release documentation"
if [ -f .github/RELEASE.md ]; then
    print_success "Release documentation found"
else
    print_warning "Release documentation not found"
fi

if [ -f .github/CHANGELOG_TEMPLATE.md ]; then
    print_success "Changelog template found"
else
    print_warning "Changelog template not found"
fi

if [ -f .github/TESTING_RELEASES.md ]; then
    print_success "Testing guide found"
else
    print_warning "Testing guide not found"
fi

# Test 12: Check helper scripts
echo ""
echo "Test 12: Helper scripts"
if [ -f scripts/prepare-release.sh ]; then
    if [ -x scripts/prepare-release.sh ]; then
        print_success "prepare-release.sh found and executable"
    else
        print_warning "prepare-release.sh found but not executable"
        print_info "Run: chmod +x scripts/prepare-release.sh"
    fi
else
    print_warning "prepare-release.sh not found"
fi

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
print_success "All critical tests passed!"
echo ""
echo "Next steps:"
echo "  1. Review .github/RELEASE.md for release process"
echo "  2. Review .github/TESTING_RELEASES.md for testing guide"
echo "  3. Test with a pre-release tag (e.g., v0.0.1-test.1)"
echo "  4. Verify release creation on GitHub"
echo "  5. Clean up test releases before production release"
echo ""
