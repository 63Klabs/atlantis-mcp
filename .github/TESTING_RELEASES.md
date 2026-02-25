# Testing GitHub Releases

This document describes how to test the GitHub release workflow before creating an actual release.

## Prerequisites

Before testing:

1. Ensure you have push access to the repository
2. Ensure GitHub Actions are enabled
3. Ensure you have the necessary permissions to create tags

## Test Workflow Validation

### 1. Validate Workflow Syntax

Check that the workflow file is valid:

```bash
# Install act (GitHub Actions local runner) - optional
# brew install act  # macOS
# or download from https://github.com/nektos/act

# Validate workflow syntax
cat .github/workflows/release.yml | grep -E "^(name|on|jobs|steps):" 
```

### 2. Check Workflow File Structure

Verify the workflow has all required components:

```bash
# Check for required sections
grep -q "on:" .github/workflows/release.yml && echo "✓ Trigger defined"
grep -q "tags:" .github/workflows/release.yml && echo "✓ Tag trigger configured"
grep -q "create-release:" .github/workflows/release.yml && echo "✓ Release job defined"
grep -q "GITHUB_TOKEN" .github/workflows/release.yml && echo "✓ GitHub token configured"
```

## Testing with a Pre-release Tag

The safest way to test is to create a pre-release tag:

### Step 1: Prepare Test Release

```bash
# Create a test branch
git checkout -b test-release-workflow

# Update version to pre-release
cd application-infrastructure/src/lambda/read
npm version prerelease --preid=test --no-git-tag-version
cd ../../../..

# Update CHANGELOG.md with test entry
cat >> CHANGELOG.md << 'EOF'

## [0.0.1-test.1] - 2026-01-XX

### Added
- Testing release workflow

### Changed
- N/A

### Fixed
- N/A
EOF

# Commit changes
git add .
git commit -m "test: prepare test release v0.0.1-test.1"
git push origin test-release-workflow
```

### Step 2: Create Test Tag

```bash
# Create and push test tag
git tag -a v0.0.1-test.1 -m "Test release v0.0.1-test.1"
git push origin v0.0.1-test.1
```

### Step 3: Monitor Workflow Execution

1. Go to GitHub repository
2. Click "Actions" tab
3. Find "Create Release" workflow run
4. Monitor execution and check for errors

### Step 4: Verify Release Creation

1. Go to "Releases" page on GitHub
2. Verify test release was created
3. Check that it's marked as "Pre-release"
4. Verify release notes are extracted from CHANGELOG.md
5. Verify artifact (zip file) is attached

### Step 5: Verify S3 Deployment (if configured)

1. Check "Deploy Release to S3" workflow run
2. Verify it was triggered by the release
3. Check S3 bucket for uploaded artifact (if AWS credentials configured)

### Step 6: Clean Up Test Release

```bash
# Delete test tag locally
git tag -d v0.0.1-test.1

# Delete test tag remotely
git push origin :refs/tags/v0.0.1-test.1

# Delete test release on GitHub (via UI or API)
# Go to Releases page → Find test release → Delete

# Delete test branch
git checkout main
git branch -D test-release-workflow
git push origin --delete test-release-workflow
```

## Manual Testing Checklist

Before creating a real release, verify:

### Workflow Configuration
- [ ] Workflow file syntax is valid
- [ ] Tag pattern matches semantic versioning (v*.*.*)
- [ ] GitHub token permissions are correct (contents: write)
- [ ] All required steps are present

### Changelog Extraction
- [ ] CHANGELOG.md follows Keep a Changelog format
- [ ] Version sections are properly formatted
- [ ] Changelog extraction script works correctly
- [ ] Release notes are readable and complete

### Artifact Creation
- [ ] Zip file excludes unnecessary files (.git, node_modules, etc.)
- [ ] Zip file includes all necessary application files
- [ ] Zip file naming follows convention

### Release Creation
- [ ] Release is created with correct version
- [ ] Release notes are extracted from CHANGELOG.md
- [ ] Artifact is attached to release
- [ ] Release is not marked as draft
- [ ] Pre-release flag is set correctly

### S3 Deployment (if configured)
- [ ] S3 deployment workflow is triggered
- [ ] AWS credentials are configured correctly
- [ ] S3 bucket and path are correct
- [ ] Artifact is uploaded to S3

## Common Issues and Solutions

### Issue 1: Workflow Not Triggered

**Problem**: Pushing tag doesn't trigger workflow

**Solutions**:
- Verify tag pattern matches `v*.*.*`
- Check GitHub Actions are enabled for repository
- Verify workflow file is in `.github/workflows/` directory
- Check workflow file has correct `on.push.tags` configuration

### Issue 2: Changelog Extraction Fails

**Problem**: Release notes are empty or incorrect

**Solutions**:
- Verify CHANGELOG.md format matches Keep a Changelog
- Check version section exists in CHANGELOG.md
- Verify version format: `## [X.Y.Z] - YYYY-MM-DD`
- Test extraction script locally:
  ```bash
  VERSION="v0.0.1"
  awk "/^## \[$VERSION\]/,/^## \[v[0-9]/" CHANGELOG.md | sed '$d' | tail -n +2
  ```

### Issue 3: Artifact Creation Fails

**Problem**: Zip file creation fails or is incomplete

**Solutions**:
- Check disk space is sufficient
- Verify zip command is available
- Test zip creation locally:
  ```bash
  zip -r test.zip . -x "*.git/*" -x "*/node_modules/*"
  ```
- Check exclusion patterns are correct

### Issue 4: Permission Denied

**Problem**: Workflow fails with permission error

**Solutions**:
- Verify `permissions` section in workflow:
  ```yaml
  permissions:
    contents: write
    packages: write
  ```
- Check repository settings → Actions → General → Workflow permissions
- Ensure "Read and write permissions" is enabled

### Issue 5: S3 Deployment Fails

**Problem**: S3 upload fails or doesn't trigger

**Solutions**:
- Verify AWS credentials are configured as secrets
- Check IAM role has S3 PutObject permission
- Verify S3 bucket name and path are correct
- Check `deploy-to-s3.yml` workflow is configured correctly

## Testing in CI/CD Pipeline

To test the complete flow in CI/CD:

1. **Create test environment**:
   - Use a separate test repository or branch
   - Configure test AWS account (if testing S3 deployment)

2. **Test with pre-release versions**:
   - Use version format: `v0.0.1-test.1`, `v0.0.1-beta.1`, etc.
   - These won't affect production releases

3. **Verify all steps**:
   - Tag creation triggers workflow
   - Changelog extraction works
   - Artifact creation succeeds
   - Release creation succeeds
   - S3 deployment succeeds (if configured)

4. **Clean up**:
   - Delete test tags
   - Delete test releases
   - Remove test artifacts from S3

## Automated Testing

For automated testing of the workflow:

```bash
#!/bin/bash
# test-release-workflow.sh

set -e

echo "Testing release workflow..."

# 1. Validate workflow syntax
echo "✓ Validating workflow syntax..."
yamllint .github/workflows/release.yml || echo "Warning: yamllint not installed"

# 2. Check required sections
echo "✓ Checking workflow structure..."
grep -q "on:" .github/workflows/release.yml
grep -q "tags:" .github/workflows/release.yml
grep -q "create-release:" .github/workflows/release.yml

# 3. Test changelog extraction
echo "✓ Testing changelog extraction..."
VERSION="v0.0.1"
CHANGELOG_CONTENT=$(awk "/^## \[$VERSION\]/,/^## \[v[0-9]/" CHANGELOG.md | sed '$d' | tail -n +2)
if [ -z "$CHANGELOG_CONTENT" ]; then
    echo "Warning: No changelog content found for $VERSION"
fi

# 4. Test artifact creation
echo "✓ Testing artifact creation..."
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
    > /dev/null 2>&1

if [ -f test-artifact.zip ]; then
    echo "✓ Artifact created successfully ($(du -h test-artifact.zip | cut -f1))"
    rm test-artifact.zip
else
    echo "✗ Artifact creation failed"
    exit 1
fi

echo "✓ All tests passed!"
```

Save this as `scripts/test-release-workflow.sh` and run:

```bash
chmod +x scripts/test-release-workflow.sh
./scripts/test-release-workflow.sh
```

## Final Verification

Before creating your first production release:

1. ✅ Test workflow with pre-release tag
2. ✅ Verify release creation on GitHub
3. ✅ Verify changelog extraction
4. ✅ Verify artifact attachment
5. ✅ Verify S3 deployment (if configured)
6. ✅ Clean up test releases and tags
7. ✅ Document any issues encountered
8. ✅ Update this testing guide if needed

## Next Steps

After successful testing:

1. Follow the release process in [.github/RELEASE.md](.github/RELEASE.md)
2. Use `scripts/prepare-release.sh` to prepare releases
3. Monitor GitHub Actions for each release
4. Verify releases are created correctly
5. Update documentation as needed
