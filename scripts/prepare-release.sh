#!/bin/bash

# Prepare Release Script
# This script helps prepare a new release by updating version and changelog

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if version type is provided
if [ -z "$1" ]; then
    print_error "Usage: $0 <patch|minor|major>"
    print_info "Examples:"
    print_info "  $0 patch  # Bug fixes (0.0.X)"
    print_info "  $0 minor  # New features (0.X.0)"
    print_info "  $0 major  # Breaking changes (X.0.0)"
    exit 1
fi

VERSION_TYPE=$1

# Validate version type
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
    print_error "Invalid version type: $VERSION_TYPE"
    print_error "Must be one of: patch, minor, major"
    exit 1
fi

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    print_warning "You are not on main branch (current: $CURRENT_BRANCH)"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    print_error "You have uncommitted changes. Please commit or stash them first."
    exit 1
fi

print_info "Preparing $VERSION_TYPE release..."

# Update version in package.json
cd application-infrastructure/src/lambda/read
print_info "Updating version in package.json..."
npm version $VERSION_TYPE --no-git-tag-version

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version")
print_info "New version: v$NEW_VERSION"

cd ../../../../

# Update CHANGELOG.md
print_info "Updating CHANGELOG.md..."

# Get current date
RELEASE_DATE=$(date +%Y-%m-%d)

# Replace [Unreleased] with version and date
sed -i.bak "s/## \[Unreleased\]/## [Unreleased]\n\n### Added\n- TODO\n\n### Changed\n- TODO\n\n### Fixed\n- TODO\n\n## [$NEW_VERSION] - $RELEASE_DATE/" CHANGELOG.md

# Update version links at bottom
echo "" >> CHANGELOG.md
echo "[Unreleased]: https://github.com/63klabs/atlantis-mcp/compare/v$NEW_VERSION...HEAD" >> CHANGELOG.md
echo "[$NEW_VERSION]: https://github.com/63klabs/atlantis-mcp/releases/tag/v$NEW_VERSION" >> CHANGELOG.md

# Remove backup file
rm CHANGELOG.md.bak

print_info "CHANGELOG.md updated"

# Show what changed
print_info "Changes made:"
echo "  - Version updated to v$NEW_VERSION"
echo "  - CHANGELOG.md updated with release date: $RELEASE_DATE"

print_warning "Next steps:"
echo "  1. Edit CHANGELOG.md and replace TODO items with actual changes"
echo "  2. Review all changes: git diff"
echo "  3. Commit changes: git add . && git commit -m 'chore: prepare release v$NEW_VERSION'"
echo "  4. Push to main: git push origin main"
echo "  5. Create and push tag: git tag -a v$NEW_VERSION -m 'Release v$NEW_VERSION' && git push origin v$NEW_VERSION"
echo ""
print_info "After pushing the tag, GitHub Actions will automatically create the release"
