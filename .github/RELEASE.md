# Release Process

This document describes the release process for the Atlantis MCP Server.

## Semantic Versioning

This project follows [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** version (X.0.0): Incompatible API changes or breaking changes
- **MINOR** version (0.X.0): New functionality in a backwards-compatible manner
- **PATCH** version (0.0.X): Backwards-compatible bug fixes

### Version Format

Versions follow the format: `vMAJOR.MINOR.PATCH`

Examples:
- `v0.0.1` - Initial release
- `v0.1.0` - New feature added (backwards-compatible)
- `v1.0.0` - First stable release or breaking change
- `v1.0.1` - Bug fix

## Release Workflow

### 1. Prepare Release

Before creating a release:

1. **Update version in package.json**:
   ```bash
   cd application-infrastructure/src/lambda/read
   npm version patch  # or minor, or major
   ```

2. **Update CHANGELOG.md**:
   - Change the "unreleased" section to the new version with date
   - Format: `## vX.Y.Z - YYYY-MM-DD`
   - Ensure all changes are documented under appropriate categories
   - Create a new "unreleased" section for future changes

3. **Commit changes**:
   ```bash
   git add .
   git commit -m "chore: prepare release vX.Y.Z"
   git push origin main
   ```

### 2. Create Release Tag

Create and push a git tag:

```bash
# Create annotated tag
git tag -a vX.Y.Z -m "Release vX.Y.Z"

# Push tag to GitHub
git push origin vX.Y.Z
```

### 3. Automated Release Process

Once the tag is pushed, GitHub Actions will automatically:

1. Extract version from tag
2. Extract changelog for this version
3. Create GitHub Release with changelog as release notes
4. Create release artifact (zip file)
5. Upload artifact to GitHub Release
6. Trigger S3 deployment (via deploy-to-s3.yml)

### 4. Verify Release

After the workflow completes:

1. Check GitHub Releases page for new release
2. Verify release notes are correct
3. Verify artifact is attached
4. Verify S3 deployment succeeded (if configured)

## Version Increment Guidelines

### Patch Version (0.0.X)

Increment for:
- Bug fixes
- Documentation updates
- Performance improvements (no API changes)
- Internal refactoring (no API changes)
- Dependency updates (no breaking changes)

### Minor Version (0.X.0)

Increment for:
- New MCP tools added
- New features (backwards-compatible)
- New configuration options (backwards-compatible)
- Deprecation notices (feature still works)

### Major Version (X.0.0)

Increment for:
- Breaking API changes
- Removed MCP tools
- Changed tool signatures (parameters or return types)
- Removed configuration options
- Changed behavior that breaks existing integrations
- Minimum Node.js version increase

## Breaking Changes

When introducing breaking changes:

1. **Document in CHANGELOG.md** under "Breaking Changes" section
2. **Provide migration guide** in documentation
3. **Increment MAJOR version**
4. **Update README.md** with migration instructions
5. **Consider deprecation period** before removing features

## Pre-release Versions

For testing before official release:

```bash
# Create pre-release tag
git tag -a v1.0.0-beta.1 -m "Pre-release v1.0.0-beta.1"
git push origin v1.0.0-beta.1
```

Pre-release versions will be marked as "pre-release" in GitHub.

## Hotfix Process

For urgent fixes to production:

1. Create hotfix branch from main
2. Make fix and update CHANGELOG.md
3. Increment PATCH version
4. Create tag and push
5. Merge hotfix back to main

## Release Checklist

Before creating a release tag:

- [ ] All tests pass (`npm test`)
- [ ] Code coverage meets requirements (≥80%)
- [ ] Documentation is up to date
- [ ] CHANGELOG.md is updated with all changes
- [ ] Version in package.json is updated
- [ ] Breaking changes are documented
- [ ] Migration guides are provided (if needed)
- [ ] Integration tests pass in test environment
- [ ] Security scan passes
- [ ] No hardcoded credentials or secrets

## Rollback Process

If a release has critical issues:

1. **Immediate**: Revert to previous version in production
2. **Create hotfix**: Fix issue in hotfix branch
3. **Release patch**: Create new patch release
4. **Document**: Update CHANGELOG.md with fix details

## Version History

See [CHANGELOG.md](../CHANGELOG.md) for complete version history.
